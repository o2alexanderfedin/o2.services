# Design spec — WASM guest capabilities: handlers, host I/O, and sockets

**Status:** design, approved in conversation 2026-08-17. Not implemented.
**Supersedes:** nothing. **Builds on:**
`docs/superpowers/specs/2026-08-11-capability-registration-design.md` (advertisement and its
trust model) and `docs/superpowers/specs/2026-08-11-dht-record-index-design.md` (the name→record
index this design's `blob` and `dns` services need).

---

## 0. Provenance — what was read, and what was not

Read in the tree at `main` `64163c2` while writing this:

- `packages/core/src/executor/wasm.ts` — the native ABI, its four imports, `TASK_ENTRYPOINT`
- `packages/core/src/executor/worker-executor.ts` — thread isolation, the kill switch, and the
  sentence about synchronous guest calls that decides §6
- `packages/aot/src/wasi-executor.ts` — the preview1 surface, its 23 imports, the `sock_*` stubs
- `packages/aot/src/abi-router.ts` — per-artifact ABI selection
- `packages/core/src/canonical/encode.ts` — DAG-CBOR guarantees and the recorded rejection of protobuf
- `packages/core/src/ports.ts` — `Task`, `Executor`, `Blockstore`

**Not read, and therefore not relied on:** the scheduler's placement path, `EgressGuard`'s
internals, and the gossipsub wiring. Claims about those are marked as assumptions where they appear.

**Nothing in this document has been measured.** Every number is a constraint quoted from an
existing file or from the platform, not a benchmark taken for this design. Where a figure would
need measuring before it can be trusted, §10 says so.

---

## 1. Problem

Guests today can compute and nothing else. That is enough for map/reduce over supplied data and
not enough for the fabric to run real work: no external API can be called, no database or object
store reached, no connection held open, and no guest can talk to another guest except by finishing
and handing bytes back to the scheduler.

The goal is to reach parity with a serverless platform's programming model — a handler, outbound
HTTP, object storage, a key–value store, sockets — without discarding the two properties the
fabric already has: an auditable sandbox, and an integrity story per class of work.

## 2. What already exists — the premise this design corrects

The starting assumption for this work was that guests communicate only through console I/O. That
is true of one of the two ABIs and false of the other.

| ABI | entry | guest imports | used by |
|---|---|---|---|
| native `o2` | exported `run` | `input_len`, `input_read`, `output_write`, `partition` | hand-written task modules |
| WASI preview1 | `_start` | 23 from `wasi_snapshot_preview1` | elfconv-lifted ELF binaries |

`abi-router.ts` chooses **per artifact** by reading the module's declared imports. Console I/O is
the WASI path. The native path is already handler-shaped: an exported function, an input buffer,
an output buffer.

**Consequence for scope.** "Make guests act like Lambda functions" is mostly an extension of an
ABI that exists, not new construction. The genuinely new work is host I/O and its policy.

Two further facts from the tree bound the design before any choice is made:

- **The import object is the sandbox.** `wasm.ts` states it and means it: a module importing
  anything the host did not supply fails at `WebAssembly.instantiate`, naming the import. There is
  no allow-list, because there is nothing to list. Every capability added widens this object, so
  the sandbox stops being free the moment I/O exists.
- **WASI preview1 has no `sock_connect`.** It has `sock_accept`, `sock_recv`, `sock_send`,
  `sock_shutdown` — all for sockets the host pre-opened. Outbound connections are unreachable in
  preview1 without a nonstandard extension. The stubs in `wasi-executor.ts` that return
  `ERRNO_NOTSUP` are therefore a seam for *inbound* sockets only, and cannot be the whole answer.

## 3. Constraints that bind this design

| constraint | source | what it forbids |
|---|---|---|
| No `SharedArrayBuffer` on the demo tier | GitHub Pages sends no COOP/COEP headers | `Atomics.wait` as the *baseline* suspension mechanism |
| A guest `run()` cannot be interrupted from its own thread | `worker-executor.ts` | any host call that simply awaits |
| 16 KiB max WebRTC message; Chromium closes above 256 KiB | js-libp2p, recorded in `CLAUDE.md` | unchunked socket streams on the browser mesh |
| Browsers cannot open listening sockets | platform | guests listening for inbound TCP in a tab |
| Sovereign data must not leave the owner's device | the project's core value claim | egress grants on sovereign-labelled tasks |
| DAG-CBOR is the canonical encoding | `encode.ts` (DET-05) | protobuf or any non-canonical codec on a hashed path |

---

## 4. The host surface

Five imports in the `o2` namespace, and never more, whatever services are added later:

```
o2.call(reqPtr, reqLen)    -> i32   open an operation; handle, or negative errno
o2.poll(handle)            -> i32   readable bytes; 0 = pending, <0 = error or EOF
o2.read(handle, ptr, cap)  -> i32   drain response bytes into guest memory
o2.write(handle, ptr, len) -> i32   push bytes — socket send, HTTP request body
o2.close(handle)           -> void  release
```

The request is DAG-CBOR: `{op: 'http.fetch', url, method, headers}`,
`{op: 'sock.open', proto: 'tcp', host, port}`, `{op: 'kv.get', ns, key}`.

**Why this shape.**

*It is the Unix lifecycle, which is why one surface covers every workload asked for.* Open, read,
write, poll, close describes HTTP, sockets, key–value, files, and guest-to-guest messaging without
distinction. A new service is a new `op` string. It is never a new import.

*`poll`-then-`read` mirrors the ABI already here.* The native path is `input_len()` then
`input_read(ptr, len)` — learn the length, allocate, copy. Same two-step, same reason, so a guest
author meets one idiom rather than two.

*The sandbox stays one auditable object.* A guest holding no grant sees five imports that refuse
everything, which is behaviourally what exists today. Adding a service later costs zero new
imports and zero new sandbox surface. This is the property most worth protecting: the alternative
is an import allow-list, which this codebase has removed twice and should not reacquire.

### 4.1 What this surface deliberately does not do

It does not give the guest a callback, a thread, or an event loop. The guest asks and polls;
the host never calls into the guest. That keeps re-entrancy out of the design entirely, and it is
what makes the deadline in §7 enforceable — there is no host→guest call that could be in flight
when the thread is terminated.

---

## 5. Grants, and the third integrity lane

### 5.1 Grants are signed data

```
{ ops: { 'http.fetch': { hosts: ['api.example.com'], methods: ['GET'] },
         'kv.get':     { ns: 'orders' } },
  issuer, expires, signature }
```

Carried with the task, checked host-side on **every** `call`. This reuses machinery that exists —
signed records, pinned trust anchors, the `guardModuleProvenance` shape — rather than inventing an
authorization system.

A grant is data, so it is revocable, auditable, and transportable. It is never code, and it is
never a property of how a node was started. That last point is the same rule
`abi-router.ts` already states for executor selection: a node's capability must not depend on its
command line.

### 5.2 Effectful work leaves the N-version lane

Replaying an effectful task does not verify it; it performs the effect twice. Byte-comparison is
the wrong instrument, and no change of serialization format alters that — the problem is the
second execution, not the second encoding.

The integrity table therefore gains a third row:

| data / task | integrity mechanism |
|---|---|
| public | N-version redundant execution with commit–reveal |
| sovereign | owner-attested map, verified aggregation |
| **effectful** | **at-most-once placement + a signed effect log** |

The effect log records every `call`, its request digest, its response digest, the transport used
and — where a proxy was involved — the operator's peer ID, signed by the executing node.

**State the weakness in these words, in the code and in any UI:** an effect log lets a requestor
see what the guest touched and challenge it. It does not let them re-derive the answer. That is a
strictly weaker claim than byte-equality, and "verified" must not be allowed to quietly cover both.

### 5.3 The fetch/compute split — how most work keeps real verification

Most work that needs the network is *read-then-compute*, not effectful. It does not need the weak
lane:

1. One node performs the external call under an effect grant.
2. The response is canonically encoded and content-addressed into the blockstore.
3. The job dispatches N replicas over that **pinned CID**, with **no grant at all**.

The fetch is at-most-once and audited. The computation is fully deterministic, byte-comparable,
and stays in the existing N-version lane unchanged.

This is a first-class pattern, not an optimisation. Enrichment, inference against a hosted
endpoint, and scraping all fit it. Only work whose *purpose* is the side effect — posting,
writing, charging — needs the weak lane, and that is a much smaller set than "anything that
touches the network".

### 5.4 The one hard refusal

**A sovereign-labelled task receives no egress grant.** Not configurable, not a policy default.
Egress plus sovereign data is exfiltration, and the sovereignty claim is the product rather than a
preference. Enforced where the refusal already lives (`sovereignty-guard.ts`, `EgressGuard`), and
refused by name.

---

## 6. Suspension, and why one binary suffices

Every capability here is asynchronous, and the guest has nowhere to yield: its `run()` is a
synchronous call inside a worker.

| mechanism | availability | cost |
|---|---|---|
| **Asyncify** (Binaryen pass) | everywhere | ~2× module size, some speed; `binaryen` is already a dependency |
| `Atomics.wait` + SAB | needs COOP/COEP — **not** GitHub Pages | near zero |
| JSPI | engine-dependent | near zero |
| reactor/poll-only | everywhere | guest must be a state machine; breaks unmodified recompiles |

**Asyncify is the baseline** because the demo tier cannot set headers.

The property that makes this cheap: an asyncified module **unwinds only when `poll` returns
pending**. On a host with `Atomics.wait` or JSPI the host answers synchronously, `poll` returns
ready on the first try, and the unwind path never runs. So the faster mechanisms are host-side
optimisations that drive asyncify's cost toward zero — not an ABI fork, and not a second artifact
to publish. **One binary runs under all three.**

Asyncify is applied at publish time, to modules that declare I/O ops, alongside the determinism
normalization that already happens there.

---

## 7. Services

Vocabulary mirrors WASI Preview 2 so a guest-side adapter can later be replaced by jco-generated
bindings without changing host semantics. The AWS column is what the adapter presents to guest
code; it is not a wire-compatibility claim.

| ops | WASI-P2 vocabulary | AWS shape | backed by |
|---|---|---|---|
| `http.*` | `wasi:http/outgoing-handler` | — | host fetch, egress-accounted |
| `sock.*` | `wasi:sockets/tcp` | — | three transports (§8) |
| `blob.*` | `wasi:blobstore` | S3 | Helia + blockstore |
| `kv.*` | `wasi:keyvalue` | DynamoDB | signed owner-scoped records |
| `fs.*` | `wasi:filesystem` | EFS | virtual FS over `blob` |
| `msg.*` | — | SQS / SNS | gossipsub and direct streams |
| `dns.*` | `ip-name-lookup` | Route 53 | the DHT record index |

**`blob` fits the fabric as it already is.** Content-addressed storage exists; the only gap is
that S3 keys are mutable and CIDs are not. Objects stay immutable and CID-addressed; buckets and
keys become a thin pointer layer of signed records over the DHT record index.

**`kv` is deliberately under-built in v1.** Multi-writer strong consistency across a P2P mesh is a
consensus project, not a service. Version one: **each namespace has an owner keypair, writes must
carry that owner's signature, readers verify.** Single-writer is trivially consistent, needs no
quorum, and matches the sovereignty model. Multi-writer is a later separate design, not a v1
compromise to be papered over.

**`fs` is read-mostly and layered on `blob`.** Backing preview1's `path_open` with the same
virtual filesystem is a secondary benefit for elfconv-lifted binaries.

---

## 8. Sockets: three transports, chosen by destination

The guest sees one socket API. The host selects the mechanism from the target, never from
configuration.

| target | mechanism | browser |
|---|---|---|
| another guest on the fabric | a libp2p stream, directly | **yes, today** |
| public TCP/TLS | libp2p stream → Node **exit node** that opens the real socket | yes, via exit node |
| WebSocket / HTTP endpoint | host performs it natively | yes, no exit node |

Guest-to-guest needs no proxy: the transport exists and is already authenticated. It should be
built first despite being the last capability asked for.

Three properties to design in rather than discover:

**The exit node sees plaintext unless the guest terminates TLS itself.** With guest-side TLS the
exit node is a byte pipe and confidentiality holds. Without it, the traffic is visible to a
stranger's node. The transport and the operator's peer ID therefore appear in the effect log, so
the choice is declared rather than silently trusted.

**An unguarded exit node is an open proxy.** Grants are host-scoped, and the exit node re-checks
the grant independently rather than trusting the executing node — the same defence-in-depth shape
as the existing relay admission.

**Chunking is mandatory, not an optimisation.** 16 KiB per message on the browser mesh, with
explicit flow control. Without it the failure mode is silent truncation.

### 8.1 Advertisement builds on the existing trust model

A node advertises which ops it can serve, and the scheduler matches before dispatch. This is a new
producer for the `CapabilityRecord` seam and the `DiscoveryOptions.understands` hook, both of
which exist without one today.

Per the capability-registration design, these claims are **self-signed and covered by
self-punishment, not by proof**: a node claiming `http.fetch` it cannot serve loses the dispatch
and is marked, which is what makes the claim costly to falsify. This design adds no new trust
assumption; it adds a claim kind to an existing mechanism.

---

## 9. Error handling

Negative errno mirroring WASI's space where meaningful, so the adapter maps directly to POSIX
errno. A number alone is insufficient — refusals are **named** in the outcome, and three classes
must stay distinguishable because each has a different responsible party:

| class | meaning | who acts |
|---|---|---|
| `grant-refused` | guest asked for something not granted | guest author, or it is an attack |
| `service-failed` | granted, but the world said no (DNS, 500, reset) | retry — this is data, not a defect |
| `host-unavailable` | this node cannot serve that op at all | **the scheduler**: placement was wrong |

`host-unavailable` must feed back into placement (§8.1) rather than merely being reported.

**Caps belong to the task and grant, never to the node.** `wasm.ts`'s `maxOutputBytes` docblock
records the inherited version of this defect: a per-node cap means two honest nodes reach
different verdicts on the same module and input, and the verdict is then committed to as though it
were the module's answer. I/O caps must not repeat it.

**In-flight operations are cancelled when the deadline fires.** `WorkerExecutor` terminates the
thread; without explicit cancellation, sockets and fetches outlive the guest that opened them.

---

## 10. Testing

- **Anti-vacuity first.** A guest holding no grant must see all five imports refuse everything,
  and a module declaring no I/O must behave identically to today's sandbox. Without this assertion
  every claim below is decoration.
- **Plants, watched failing.** Delete the grant check → reddens. Delete the exit node's
  independent re-check → reddens. Both observed red, both restored by surgical inverse and
  verified with `cmp`.
- **At-most-once.** A redundancy-2 job carrying an effect grant, counting host-side `call`s,
  asserting exactly one.
- **A real asyncified module**, not a mock. Otherwise §6's claim is untested.
- **Backpressure.** Push more than 16 KiB through a socket; assert chunking, not truncation.
- **Both tiers.** The same specs under the `browser` project, per the existing rule that one suite
  runs unchanged on every target.
- In-process fabric over `@libp2p/memory` for deterministic multi-node runs.

**Not yet measured, and needed before the numbers in this document are trusted:** asyncify's real
size and speed cost on a representative guest; `poll` round-trip latency under the worker
boundary; and whether an exit node's added hop is acceptable for interactive workloads.

---

## 11. Delivery

Each layer is independently useful and gets its own implementation plan. This document is the
architecture; it is **not** a single plan's worth of work.

| # | layer | unlocks | depends on |
|---|---|---|---|
| 0 | handler ABI — named exports, structured request/response | many functions per module | — |
| 1 | capability bus — five imports, grants, refusals | everything below | 0 |
| 2 | effect lane — at-most-once placement, signed effect log | effectful work stops mis-claiming verification | 1 |
| 3 | `http.*` + the fetch/compute split | fetch-and-compute | 1, 2 |
| 4 | `blob.*`, `kv.*`, `fs.*` | storage-backed workloads | 1, DHT record index |
| 5 | `sock.*` guest-to-guest | actor messaging, streaming pipelines | 1 |
| 6 | `sock.*` public, exit nodes, `dns.*` | long-lived services against the internet | 5, 8.1 |

Layers 0 and 1 are the first plan. Layer 5 precedes layer 6 deliberately: it needs no proxy, no
exit-node trust model, and no new transport.

---

## 12. Alternatives rejected, with reasons

**Adopt WASI Preview 2 and the component model now.** Real standard, existing guest SDKs, someone
else versions the interfaces. Rejected for v1 because it is a large surface to implement
correctly, adds a third ABI alongside native and preview1, has an unproven browser story via jco
here, and gives up the one-auditable-object sandbox. Its *vocabulary* is adopted (§7) so the
migration stays open.

**Extend preview1 in place.** Smallest step, and elfconv binaries would benefit immediately.
Rejected because preview1 has no `sock_connect` and no HTTP, so it cannot express outbound
connections at all, and because it does nothing for the native ABI.

**A separate import namespace per service.** Reads more naturally. Rejected because it makes the
sandbox an allow-list that grows with every service — the exact thing removed twice already.

**Protobuf for result serialization.** Rejected, and `encode.ts` already records why: protobuf's
own documentation states its serialization is not canonical, field order is undefined, non-minimal
varints are legal, and unknown fields are retained. DAG-CBOR additionally refuses NaN and
±Infinity outright and normalizes `-0.0`, which is what keeps WASM's nondeterministic NaN sign bit
off every hashed path. Changing codec would lose three guarantees and add field-order instability.

**Host→guest callbacks for I/O completion.** Rejected: re-entrancy, and it would make the
terminate-on-deadline mechanism unsound.

---

## 13. Open questions

1. **Multi-writer `kv`.** Deferred deliberately (§7). Needs its own design; do not let a v1
   single-writer store grow a quorum by accretion.
2. **Exit-node economics and abuse.** Grant scoping and independent re-checking bound *what* is
   proxied, not *how much*. Rate limiting and accounting are unspecified here.
3. **Existing Lambda artifacts.** "Runs unmodified" applies to WASM modules. A Linux binary or a
   language-runtime zip reaches the fabric only through the elfconv lift path, which today exits
   `0` on binaries it only partly translated. Separate track, not a consequence of this design.
4. **Effect-log auditing UX.** The log makes effects inspectable; nothing here specifies who
   inspects them or when a challenge is raised.
5. **Normalized comparison.** Comparing semantically rather than byte-wise would widen what
   N-version can cover. Every normalization is also a class of true disagreement made invisible.
   If pursued, it should be a per-workload declaration, never a global setting.
