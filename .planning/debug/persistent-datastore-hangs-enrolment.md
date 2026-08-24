# A persistent libp2p datastore hangs enrolment — CLOSED 2026-08-23, and the title was wrong

> **RESOLVED.** A persistent datastore does not hang enrolment. `packages/node/src/fs-datastore.ts`
> is wired by default into every node given a `blockstoreDir`, and the three specs that
> failed — `dht-registration`, `enrol-through-a-closed-door`, `provider-expiry` — pass with it.
> The fault was in the two implementations that had been tried, not in this fabric.
>
> The whole note is kept, title included, because it is the record of a week spent on a
> diagnosis that was wrong in a specific and repeatable way: **every elimination below was
> sound, and the claim they were assembled into was not.** What settled it was making the
> suspect property — asynchrony — a variable rather than a description, which none of the
> ten readings did.

**2026-08-23.** Attempted under the work register's W2 (`RFC-0003-RESPONSE-04`). **Backed out
of the tree**; the tree is byte-identical to before the attempt, checked by `git status`.

## The claim, stated so it could be falsified — and it was, 2026-08-23

**The claim was:** *"Give `createLibp2p` a datastore whose operations are asynchronous, and
this fabric's enrolment RPC never completes. A datastore whose operations are synchronous is
fine, and so is everything else about persistence."*

**It is false.** Measured the same day it was written, by the reading this note itself asked
for — and it is preserved rather than rewritten because it was the working hypothesis for
ten eliminations above and a reader needs to know which of them rested on it.

A `MemoryDatastore` was wrapped in a proxy that awaits a macrotask before delegating every
operation, and wired through `FabricNodeOptions.datastore`. Zero filesystem, purely
asynchronous. Enrolment **completed**:

| Arm | Datastore calls | Result |
|---|---|---|
| Joiner only, 0 ms yield | 24 get / 23 put / 2 query | enrolled, 646 ms |
| Joiner only, 5 ms per op | 24 / 23 / 2 | enrolled |
| Joiner only, 25 ms per op | 24 / 23 / 2 | enrolled |
| **Both nodes**, 0 ms yield | 47 / 44 / 4 | enrolled |

So **asynchrony is not the cause, and neither is per-operation latency** — 25 ms on every
call is two orders of magnitude above what a filesystem costs, and it still enrolled.

**What this leaves.** Two real implementations — `datastore-level@13.0.1` and a hand-written
`FsDatastore` on `BaseDatastore` — reproduce the hang, and an asynchronous in-memory store
does not. The remaining difference between them is therefore **not** the async boundary and
**not** the delay. Candidates, none measured: `query`'s result semantics under a real store
(the probe's `query` returned an empty async iterable four times and was never consumed
lazily), batch/commit paths that `MemoryDatastore` short-circuits, or `@libp2p/keychain`,
which reads and writes `components.datastore` directly.

The two hypotheses in the next section were framed against the async explanation. **They are
weaker now than when they were written**, because both are about ordering across an await
boundary and an await boundary alone has been shown not to do it.

## What was tried, in order, and what each reading eliminated

| Step | Reading | What it rules out |
|---|---|---|
| Wire `datastore-level@13.0.1`, run `provider-expiry.node.test.ts` | 3/3 fail — *"provider unreachable … rpc timed out after 20000ms"* during enrolment | — |
| Ablate **only** the construction (`if (false &&`) | Same case green | Anything other than the datastore |
| Raise the enrolment RPC timeout 20 s → 90 s | Hits the framework's own 60 s ceiling instead, `(user+sys)/real ≈ 0.08` | **Slowness.** The process is idle; this is a hang |
| `UV_THREADPOOL_SIZE=32` | Still fails | The obvious native-binding-starves-libuv story |
| Substitute `MemoryDatastore` on the identical wiring, twice | 2/2 pass | **Supplying a datastore at all.** The wiring is right |
| Replace level with a hand-written `FsDatastore` on `datastore-core`'s `BaseDatastore` | Fails the same way | **`datastore-level` specifically.** It is not the library |
| Probe every `FsDatastore` call to stderr | 249 calls, all `/peers/...` get and put, no throw, still flowing | **The datastore being stuck.** It answers throughout |
| Run `node-identity` + `relaying` with `FsDatastore` wired | 24/24 pass — including the case that **restarts a node on the same directory** | **Persistence in general.** Restart-and-reload works |
| Run `enrol-through-a-closed-door` + `dht-registration` | 6 cases fail, all at enrolment | — |
| Back out; re-run all three files | 12/12 pass | — |

Under `DEBUG=libp2p:peer-store*,libp2p:identify*` the failing case **passes**. So it is a
race, and adding observation moves it — which is why the cause is not named below.

## What the shape of it suggests, marked as a hypothesis and not a finding

The failure is confined to **enrolment**, which is the one exchange where the far peer holds
no certificate yet, and it appears only once peer-store reads and writes stop resolving in a
microtask. Two mechanisms in this repository are sensitive to exactly that ordering and are
where the next attempt should look:

- `PeerVerifier` subscribes to libp2p's connect and identify events and issues a `records`
  request of its own. A peer without a certificate is the case it re-asks on, floored by
  `DEFAULT_VERDICT_RETRY_FLOOR_MS`.
- NET-09's per-peer send gate (`MAX_CONCURRENT_STREAMS_PER_PEER` 8,
  `MAX_INBOUND_MESSAGES_IN_FLIGHT_PER_PEER` 4, `MAX_QUEUED_SENDS_PER_PEER` 256) queues
  outbound work per peer. An enrolment request queued behind requests that cannot complete
  is a hang with idle CPU, which is what was measured.

**Neither is confirmed, and the falsification above makes both less likely — the reading
below is still the cheapest next step, but start by diffing what a real store does that an
async in-memory one does not.** Instrument NET-09's
per-peer send gate to record its queue depth at the instant the enrolment request is
admitted, and run the failing case with an asynchronous datastore wired. If the queue is
full of `records` requests aimed at a peer that holds no certificate — which is what a
peer mid-enrolment is — hypothesis 2 is confirmed and the fix belongs in how `PeerVerifier`
paces its re-ask, not in the datastore. If the queue is shallow, hypothesis 2 is dead and
the next place to look is libp2p's own peer-store locking, where the same reasoning applies
one layer down.

Take that reading **before** trying another datastore implementation. Two have already been
tried and the second told us nothing the first had not — and a third would now be the fourth
store measured, since the async in-memory probe above is effectively one that works.

## What the attempt was worth even so

Three things are now known that were not:

1. **Persistence is not the blocker.** A node restarted on its own directory reloads its
   identity and works — measured, 24/24, before this was backed out.
2. **The defect is a genuine one in this repository**, not a property of a dependency. Two
   independent datastore implementations reproduce it; a synchronous one does not.
3. **The audit's premise stands and its ordering was wrong.** `RFC-0003-RESPONSE-04` put W2
   after W1 on the grounds of the provider-record footprint. The real gate is this defect.

## Cost, so a later reader can judge whether to pay it again

`datastore-level` was installed and uninstalled; `interface-datastore` and `interface-store`
likewise; a `FsDatastore` on `BaseDatastore` was written, typechecked, and deleted rather
than left unwired — this repository already carries 27 modules with no production importer
and the same document that counts them should not add the 28th. Its design is worth
repeating if the defect is fixed: a flat directory, one file per key, atomic
`write`-then-`rename` as `FsBlockstore` does, and **base32 names** — because APFS is
case-insensitive by default and peer IDs are mixed-case base58, so percent-encoding or
base64url would silently collide two keys that differ only in case.
