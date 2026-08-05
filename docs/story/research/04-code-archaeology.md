# o2.services — code archaeology

Read-only survey of `/Volumes/ProjectsSSD/Projects/o2.services` at `feature/bug-fixes-22`
(HEAD `516fd13`), 2026-08-01. Everything below is quoted verbatim from source with
`file:line`. Nothing was modified.

---

## 1. System shape

Eight npm workspaces under `packages/`, plus a `tools/` tree for build-time drivers.
Dependency edges (from each `package.json`):

| Package | Depends on | What it is |
|---|---|---|
| `@o2/core` | *(no `@o2/*` deps at all)* — `@ipld/dag-cbor`, `@noble/*`, `multiformats` | The kernel: ports, canonical encoding, WASM executor, placement, discovery, reduce, quorum, enrollment, capability chains, coordinator |
| `@o2/net` | `@o2/core` | The wire protocol and the serving half of a node — `serveAgent`, RPC, egress guard, combine dispatch, churn. Portable: no libp2p |
| `@o2/libp2p` | `@o2/core`, `libp2p@3.3.6`, `@libp2p/{crypto,interface,peer-id}` | The `Transport` port implemented over libp2p; identity derivation; the measured-constants file |
| `@o2/browser` | `@o2/core`, `@o2/net`, `@o2/libp2p`, `@o2/demo`, webrtc/websockets/circuit-relay | `BrowserNode`, IndexedDB blockstore, worker executor, visibility governor, demo page |
| `@o2/node` | `@o2/core`, `@o2/net`, `@o2/libp2p`, tcp/websockets/relay-server | `FabricNode`, fs blockstore, seed server, `bin/agent.ts`, `bin/bench.ts` — **and every guard test** |
| `@o2/demo` | `@o2/core` only | The two hand-written WASM guest kernels and their host-side codecs |
| `@o2/aot` | `@o2/core`, `@bjorn3/browser_wasi_shim` | ELF admission screening, WASI executor, translation cache keys |
| `@o2/bench` | `@o2/core`, `@o2/net` | Measurement harness, stats, perf gate, committed baseline |

`FabricNode` states the architecture in its own header — and states why the obvious
second class was deleted:

> ```
> * ## Why there is no second class
> *
> * There was one, for two phases, and the way it failed is the reason this comment is
> * long. `RelayNode` bound a socket and carried other peers' SDP exchanges. It
> * constructed no blockstore, no executor, no `RpcEndpoint`, and never called
> * `serveAgent` — so it could not run a task, though nothing about relaying prevents
> * it. Running the demo showed "2 compute peers of 3 connections": the third
> * connection was the relay, present, connected, perfectly able to compute, and
> * structurally excluded from doing so. The mechanism had already survived three
> * rounds of renaming — `backbone`/`edge` became other words while the two disjoint
> * capability sets stayed exactly where they were. Deleting the class is what removed
> * it; renaming it never would have.
> *
> * The standing rule this enforces: **all nodes have equal functionality, and the
> * only difference is discovery.** … If a decision keys on what kind of node
> * something is, it is wrong.
> ```
> — `packages/node/src/fabric-node.ts:16-33`

That rule then reappears as a *derivation* rather than a flag:

> ```
> // The whole of the relay/compute distinction, reduced to one predicate over the
> // addresses this node actually asked to bind. `/p2p-circuit` does not count: it
> // is not an address, it is a request for one, granted by somebody else and
> // revocable by them. A node holding only that cannot carry a stranger's
> // handshake and must not claim it can.
> const canRelay = listen.some((address) => !address.includes('/p2p-circuit'))
> ```
> — `packages/node/src/fabric-node.ts:918-923`

> ```
> * An option would be a lie waiting to happen: any boolean can be set on a node with
> * no socket, and then "does this node relay?" has two answers that can disagree.
> * Derivation leaves one answer, read off the listen list, and it is the same answer
> * whether the caller thought about it or not. That is the difference between the rule
> * being true and the rule being asserted.
> ```
> — `packages/node/src/fabric-node.ts:43-47`

### The purity tiers — `packages/node/src/purity.node.test.ts`

Three tiers, enforced by scanning every import specifier in every non-`.node.test.ts`
`.ts` file of each package, plus each `package.json`'s declared dependencies.

> ```
> * Phase 2's acceptance bar was that adding a real network left `@o2/core`
> * byte-for-byte unchanged. That was true — but "was true once" is worth much less
> * than "cannot quietly stop being true". A single `import { tcp } from
> * '@libp2p/tcp'` in the kernel would compile, pass every Node test, and only fail
> * when someone next builds for a browser.
> *
> * So the rule is checked rather than remembered: the portable packages may not
> * reference a platform. `@o2/node` exists to hold everything that must.
> ```
> — `purity.node.test.ts:9-18`

**Tier 1 — portable** (`purity.node.test.ts:28`): `core`, `net`, `bench`, `demo`, `aot`.
Forbidden specifiers (`:46-52`), each carrying its reason:

```ts
{ pattern: /^node:/,        why: 'a Node builtin does not exist in a browser' },
{ pattern: /^libp2p$/,      why: 'libp2p belongs behind the Transport port, not in the kernel' },
{ pattern: /^@libp2p\//,    why: 'libp2p modules belong in an adapter package' },
{ pattern: /^@chainsafe\//, why: 'libp2p crypto modules belong in an adapter package' },
{ pattern: /^@o2\/node$/,   why: 'a portable package must not depend on the Node adapters' },
```

**Tier 2 — dual-target** (`:36`): `libp2p`, `browser`. May use libp2p, may not touch a
platform — *"`@o2/libp2p` is the middle tier: both `@o2/node` and `@o2/browser` depend on it,
so a `node:` import here would break the browser build."*

**Tier 3 — `@o2/node`**: everything that must touch a platform.

The exemption is the suffix, and the suffix is load-bearing rather than decorative:

> ```
> * `*.node.test.ts` is exempt, and only that suffix.
> *
> * The suffix is not a comment, it is the gate: `vitest.config.ts` excludes
> * `**​/*.node.test.ts` from the browser project, so such a file never runs anywhere
> * but Node and never reaches a bundle. `@o2/demo` commits a `.wasm` next to the
> * `.wat` it was compiled from, and the test that proves the two match has to read
> * both off disk. Refusing that would not make the package more portable — it would
> * only mean the committed binary went unchecked, which is a worse trade than the one
> * this rule exists to prevent.
> ```
> — `purity.node.test.ts:61-69`

And the test refuses to over-claim. It explicitly declines to enforce the original
Phase 2 criterion, because that criterion was *already wrong once*:

> ```
> * Phase 2's criterion — "the kernel is byte-for-byte unchanged" — … is deliberately
> * *not* asserted here as a standing rule: that would forbid legitimate kernel
> * fixes, and it already did — Phase 3's blockstore conformance suite found a real
> * aliasing defect in `MemoryBlockstore` that had to be corrected in `@o2/core`.
> *
> * What endures is the dependency direction. Adapters may depend on the kernel;
> * the kernel may never depend on an adapter.
> ```
> — `purity.node.test.ts:155-165`

Last test in the file closes the vacuity hole: `it('is checked into git, so the Phase 2
claim stays reproducible')` (`:176`) — *"If the kernel were untracked, `git diff` would have
trivially returned empty and the Phase 2 criterion would have been vacuously 'met'."*
(`:177-179`)

---

## 2. The guest kernel — `packages/demo/src/kernel.wat`

A Pythagorean-triple 2-colouring solver, 346 lines of hand-written WebAssembly text.
The header runs 65 lines before the first `(module`. Read in full:

> ```wat
> ;; The Pythagorean-triple colouring kernel — the guest side of the demo.
> ;;
> ;; It imports exactly the four functions of the o2 host ABI and nothing else. That
> ;; list *is* the sandbox: there is no clock, no randomness, no filesystem and no way
> ;; to acquire one, because `WebAssembly.instantiate` supplies nothing else and
> ;; refuses a module that asks. No static analysis is involved, and none is needed.
> ;;
> ;; Everything here is integer arithmetic. Not one float appears, which is what makes
> ;; determinism free rather than something to be enforced: the WASM specification's
> ;; nondeterminism list is dominated by float behaviour (NaN bit patterns, NaN sign,
> ;; relaxed SIMD), and a module with no floats cannot reach any of it.
> ```
> — `packages/demo/src/kernel.wat:1-11`

The search-order argument, with the failure it avoids named by its exact stall point:

> ```wat
> ;; SEARCH ORDER — why the host ships one.
> ;;
> ;; Values are assigned in the order the host supplies, which is by descending number
> ;; of triples the value appears in. The obvious alternative, increasing value order,
> ;; is close to the worst possible choice: it stalls at n = 205, because value 205's
> ;; triples reach back to values in the sixties and chronological backtracking must
> ;; re-enumerate a hundred and forty levels of irrelevant choices before it can revise
> ;; one of them. Deciding the most constrained values first puts each conflict within a
> ;; few levels of the choice that caused it — and it makes the cube decomposition
> ;; informative, because the values a cube fixes are then the ones the rest of the
> ;; search is most sensitive to.
> ;;
> ;; Because the order is arbitrary, a triple can no longer be checked "when its largest
> ;; element is assigned". So the guest tracks assignment explicitly and, after
> ;; assigning a value, checks only the triples containing it whose three members are
> ;; all assigned.
> ```
> — `kernel.wat:14-29`

The output-frame argument — why the answer is a *fixed 1034 bytes* whatever `n` is:

> ```wat
> ;; Fixed width is the whole trick. Strict DAG-CBOR admits exactly one encoding of a
> ;; value, so a guest that emits a *variable*-width field has to branch on magnitude
> ;; to stay minimal — and a guest that gets that branch wrong produces bytes the
> ;; codec rightly rejects. The status is a one-byte *byte string* rather than a CBOR
> ;; integer for exactly this reason: integers below 24 must be packed into the type
> ;; byte, so `18 00` for zero is non-minimal and would be refused. Emitting one raw
> ;; byte has one encoding regardless of value, so there is no branch to get wrong.
> ```
> — `kernel.wat:59-65`

The four imports, and the memory declaration that removes an entire disagreement class:

> ```wat
>   ;; ---- the entire host contact surface ----
>   (import "o2" "input_len"    (func $input_len (result i32)))
>   (import "o2" "input_read"   (func $input_read (param i32 i32) (result i32)))
>   (import "o2" "output_write" (func $output_write (param i32 i32)))
>   (import "o2" "partition"    (func $partition (result i32)))
>
>   ;; initial === maximum. `memory.grow` can therefore never succeed, so it can never
>   ;; fail *differently* on two hosts — one less way for two honest nodes to disagree.
>   (memory (export "memory") 4 4)
> ```
> — `kernel.wat:68-78`

Four more passages worth quoting because each is an epistemics claim, not a coding one:

> ```wat
>     ;; Default verdict: unknown. Every early exit below is an honest "I could not
>     ;; tell", never a silent "no colouring exists" — those two claims carry very
>     ;; different weight and must never be confused for one another.
>     (local.set $status (i32.const 2))
> ```
> — `kernel.wat:152-154`

> ```wat
>       ;; Both bounds are checked *before* either value reaches address arithmetic, so
>       ;; a malformed block cannot make an offset wrap around into somewhere plausible.
>       ;; Past MAX_N the fixed layout has no room; say so rather than scribble.
> ```
> — `kernel.wat:178-180`

> ```wat
>       ;; A block that claims more than it carries is a block, not a licence to read
>       ;; past it. Every section must lie inside the bytes actually delivered.
> ```
> — `kernel.wat:195-196`

> ```wat
>               ;; Signed, deliberately: with k = 0 the depth reaches -1, and an
>               ;; unsigned compare would read that as four billion and keep going.
>               (if (i32.lt_s (local.get $i) (local.get $k))
> …
>               ;; The budget is what makes a shard's cost bounded and its result
>               ;; reproducible: two nodes running the same shard stop at the same
>               ;; step, so "unknown" is itself a deterministic answer.
> ```
> — `kernel.wat:289-295`

Also: the belt-and-braces zeroing loop, whose comment explains why it exists despite
being provably redundant —

> ```wat
>       ;; Linear memory starts zeroed and `run` is called once per instance, so this is
>       ;; belt and braces — but a host that ever reused an instance would otherwise
>       ;; inherit the previous shard's assignments, and that failure would present as
>       ;; nondeterminism rather than as the state bug it is.
> ```
> — `kernel.wat:206-210`

### `packages/demo/src/primes.wat` — the external oracle

445 lines. Same four-import ABI, same integer-only discipline, but its *reason for
existing* is different and stated in the first sentence:

> ```wat
> ;; The prime-counting kernel — a workload whose answer was not produced by this project.
> ;;
> ;; Every other workload here is checked against a reference this repository also wrote,
> ;; so a shared misconception is invisible to it: the fabric and its oracle would be
> ;; wrong together and agree. This one counts the primes below N, and π(x) has been
> ;; tabulated in the mathematical literature since Legendre. The expected values are
> ;; therefore an *external* oracle — the fabric can be measured against a number nobody
> ;; here chose.
> ```
> — `packages/demo/src/primes.wat:1-8`

Integer square root, justified rather than assumed:

> ```wat
> ;; That is also why
> ;; `$isqrt` counts upward instead of calling `f64.sqrt` — the square root here decides
> ;; *which primes get sieved*, so an answer that is off by one at the boundary is not a
> ;; rounding detail, it is a wrong prime count.
> ```
> — `primes.wat:29-32`

And the single best passage in the repository about test design — a `min(i, rem)` term
whose deletion is nearly invisible to the obvious test:

> ```wat
> ;; **That term is load-bearing and it is nearly invisible to the obvious test.** Deleting
> ;; it leaves the top `total mod count` numbers of [2, N] covered by no shard at all.
> ;; Measured by planting exactly that mutation and running the four quoted π(10^n) bounds
> ;; at shard counts 1..8: it was caught at **n = 1000 only**, and there only at shard
> ;; counts 5, 7 and 8. At 10^4, 10^5 and 10^6 every shard count still produced the right
> ;; total, because a power of ten sits far above the prime below it — 999 983 for 10^6 —
> ;; so the uncovered tail contains no prime and the sum comes out right by luck. The
> ;; sweep in `primes-reduce.node.test.ts` exists because of that measurement; a headline
> ;; assertion at 10^6 alone would certify this defect as passing.
> ```
> — `primes.wat:56-64`

Plus the refusal-vs-zero distinction, which is the same idea as the colouring kernel's
"unknown" status applied to a summable quantity:

> ```wat
> ;; A refusal emits `status = 1` with a count of **zero**, and the host side must read
> ;; the status rather than the count. A shard that could not run contributes zero to a
> ;; sum, which is indistinguishable from a range that genuinely held no primes — so
> ;; `readPrimeCount` throws on a refusal instead of returning the zero. Silently summing
> ;; a refusal would turn a failed shard into a quietly wrong π(x).
> ```
> — `primes.wat:105-109`

Neither kernel is built by an automatic step; `primes.wat:10-19` names the exact route
and says why: *"Compiling by any other route (a bare `wat2wasm`, a different feature set)
produces different bytes, and `primes-build.node.test.ts` will refuse them. That test is
the reason the route is stated here rather than remembered."*

The host side of that ABI is `packages/core/src/executor/wasm.ts`:

> ```
> * **The import object is the sandbox.** A module importing anything else — a
> * clock, an RNG, a WASI function — fails at `WebAssembly.instantiate` with a
> * TypeError naming the import. There is no allow-list to maintain, because the
> * runtime enforces it.
> *
> * There is deliberately no static determinism analysis here. Divergence is
> * *detected*, not predicted: two nodes run the task, their outputs are serialized
> * and compared, and a mismatch is reported with the dissenting node named…
> ```
> — `packages/core/src/executor/wasm.ts:11-19`

---

## 3. The best source comments — 25 verbatim

Selected for: a recorded measurement, a rejected obvious approach, or a correction of an
earlier claim by this same repository.

### 3.1 A default that refuses to be derived

> ```
> * **This is a configuration choice, not a derived quantity.** No arithmetic over
> * shard counts, replica counts or peer counts produced it, and none may be
> * written into this doc, into any other comment, or into a summary. Three
> * separate attempts to derive a per-node concurrent-`exec` figure from real code
> * produced three different wrong answers; the most recent was wrong because
> * `planPlacement` takes `ordered.slice(0, redundancy)` over *distinct* nodes
> * (`sovereignty.ts`), so no node ever holds two replicas of one shard.
> *
> * What may be stated is the shipped value — 64 — and the measured defect it sits
> * below: the roadmap's probe fired 4 peers × 200 concurrent `exec` requests at
> * one node and an instrument inside that node read **800 simultaneous
> * `execute()` calls and zero refusals**. 800 is that probe's reading, not a model
> * of anything.
> ```
> — `packages/core/src/placement.ts:576-588`

Same doc, further down, refusing to claim the bound is safe:

> ```
> * **This default is not claimed to put that refusal out of reach.** Whether the
> * refusal is reached under any workload this project runs is **unmeasured**:
> * nothing in this repository reads a node's concurrent `exec` count under a demo
> * or benchmark workload, and no arithmetic substitutes for reading it.
> ```
> — `packages/core/src/placement.ts:626-630`

### 3.2 The trap that a "tidy" offer branch would reintroduce

> ```
> * The trap it closes, recorded because it is this phase's largest risk and will
> * otherwise be reintroduced: reserving on `offer` **leaks**. An `exec` request
> * carries no shard id …, so no serving node can correlate an offer reservation with the
> * exec that would redeem it. And there is a live prober: `browser/demo/main.ts`
> * sends `{kind:'offer', shardId:'probe'}` to every connected peer on every
> * `computePeers()` call. A reserving offer branch would let one demo tab
> * permanently occupy a slot named `probe` on every peer it can see, after which
> * every later tab's probe is refused with `probe is already in flight here` —
> * a node that fills its own slot table from liveness probes and then refuses
> * all work.
> ```
> — `packages/core/src/placement.ts:492-503`

### 3.3 An instrument that says what it cannot prove

> ```
> * What it is **not**: it measures slots held, not `execute` invocations. …
> * It also cannot exceed `slots`, because
> * `#decide` returns the refusal before `#inFlight.add` is ever reached, so
> * `peakInFlight <= slots` is arithmetic and can never fail. Reading it as
> * evidence that a bound held is therefore wrong; what it can say is that the
> * limit was actually *reached* rather than never approached.
> ```
> — `packages/core/src/placement.ts:461-470`

Its complement:

> ```
> * - This counter counts `execute()` calls that actually happened. It can read any
> *   number at all, which is what makes an assertion about it falsifiable. Under a
> *   mutation that removes the slot acquisition it jumps to the dispatched request
> *   count, which is exactly the roadmap's measured defect reproduced inside the
> *   suite.
> ```
> — `packages/net/src/counting-executor.ts:25-30`

### 3.4 A libp2p knob deliberately not turned

> ```
> // Bare on purpose. `yamux({ maxEarlyStreams: N })` is available here and is
> // the obvious next idea after NET-09's per-peer send gate; it is wrong twice.
> //
> // It is unmeasurable from outside. `YamuxMuxer` spreads its init into
> // `AbstractStreamMuxer`, whose constructor uses a hardcoded
> // `init.maxEarlyStreams ?? 10`, and `earlyStreams` is a private field libp2p
> // never hands out — so nothing in this repository could read whether a raised
> // value took effect. And it protects nothing: a peer running default yamux
> // still aborts at 10 whatever this node sets, and the tear-down happens on the
> // *receiver's* muxer. Shipping it would add a mechanism this project could
> // only report, not measure, which is the failure this milestone exists to
> // remove.
> ```
> — `packages/node/src/fabric-node.ts:947-958`

### 3.5 A limit found by bisection, not by reading docs

> ```
> * Inbound connections per second libp2p accepts **from a single host** by default.
> *
> * The limit that actually stops sixteen browser peers joining a relay at once, and the
> * most surprising one in this file. It is per *host*, not per peer — so it binds
> * whenever many peers share an IP:
> *
> *   - every tab in a local multi-tab test, all on `127.0.0.1`;
> *   - and, in production, every volunteer behind one NAT — a school, an office, a
> *     carrier running CGNAT. …
> *
> * Exceeding it rejects the connection *during* the noise handshake, which the dialer
> * reports as `EncryptionFailedError: Unexpected EOF - stream closed while reading 0/1
> * bytes` — indistinguishable from a network fault unless you know to look here.
> *
> * Found by bisection: eight simultaneous joins already failed three of eight, and
> * adding a stagger fixed it, while raising the reservation and pending-handshake
> * limits did not.
> ```
> — `packages/libp2p/src/constants.ts:46-63`

### 3.6 A ceiling sited against three recorded numbers

> ```
> * Sited against three figures somebody actually recorded, not against a workload
> * anybody computed:
> *
> *   - **above** the 100 KiB block `fabric-node.node.test.ts` deliberately carries
> *     to exercise the chunking and reassembly paths;
> *   - **above** the largest artifact this project has produced — a 5.6 MB elfconv
> *     output, ~4.8 MB after summarisation (`10-VERIFICATION.md:16,146`);
> *   - **below** the 64 MiB frame the roadmap measured accepted.
> *
> * If some workload's frame size ever matters here, measure it and record the
> * measured figure with its date. Do not compute one from demo or job source.
> ```
> — `packages/libp2p/src/constants.ts:102-112`

### 3.7 A comment that says it was false until a named date

> ```
> * Worth stating because a reader arriving from Phase 13.1 will expect otherwise. But
> * **not for the reason this comment gave until 2026-07-31**, which was false in a way
> * worth leaving visible: it claimed `registerSovereignInputs` never runs on a refusal.
> * No such function exists in this repository, and the mechanism that does — the
> * `takeSovereignHold` call at `agent.ts:385` — runs *before* `options.authorize` at
> * `agent.ts:405`, not after. The hold is taken, and it is still held while the refusal
> * is built.
> *
> * The conclusion survives on the real reason…
> ```
> — `packages/net/src/capability-authorizer.ts:18-26`

### 3.8 A required option, and the false justification for it having been optional

> ```
> * This was optional until SCHED-06, justified by "tests that have no bundler". No
> * such test was ever written, and the reason recorded here — that `BrowserNode.start`
> * *"needs a real `indexedDB` and a relay to dial"*, leaving `demo/main.ts` as the only
> * construction site there has ever been — was **corrected on 2026-07-31**: it is false
> * in both halves. `start-unwind.browser.test.ts` starts this factory to success in
> * three engines, and `capability-harness.ts` constructs it with a bundler for
> * `browser-capability.e2e.test.ts`. Both pass a factory, as `demo/main.ts` always did.
> * What survives the correction is the conclusion: the escape hatch was cut for a
> * caller that does not exist, and it was the only thing between an untrusted peer's
> * module and this tab's main thread.
> ```
> — `packages/browser/src/browser-node.ts:293-302`

Immediately above it, why a Worker is not optional:

> ```
> * A guest `run()` is a synchronous
> * call, so on this tab's main thread the wall-clock deadline cannot fire — the timer
> * is queued on the loop the guest is holding — and there is no thread to terminate.
> * The bound is not weaker there, it is absent, and a 52-byte `loop br 0` from any
> * peer wedged the tab permanently, `stop()` included.
> ```
> — `packages/browser/src/browser-node.ts:287-291`

### 3.9 Two throttles on one path

> ```
> // **The visibility duty cycle is deliberately not passed as `dutyCycle`.** It is
> // the obvious next line and it is wrong: this tab already paces every task
> // through `GovernedExecutor`, and two independent throttles on one path produce
> // a number nobody can predict — a backgrounded tab would both run tasks slower
> // *and* refuse them earlier, from two mechanisms neither of which knows about
> // the other. The slot count is what this tab will hold at once; the governor is
> // how fast it runs them. They are different questions and only one of them is
> // this object's.
> ```
> — `packages/browser/src/browser-node.ts:914-921`

### 3.10 A comment written so that a *counting test* cannot misread it

> ```
> // The wording above avoids spelling that construction out, and deliberately:
> // `browser-node-contract.node.test.ts` counts the constructor call as raw text across
> // this whole file, comments included, and requires zero. Its own comment says "zero
> // *constructions*, not zero mentions" — the intent is right and the instrument cannot
> // tell the two apart, so this file does not put the text where it would be counted.
> ```
> — `packages/browser/src/browser-node.ts:904-908`

### 3.11 The side channel a "simplification" would open

> ```
> * **The tempting cheaper version is wrong, and it is worth naming.**
> * `guard.registrations.includes(cid.toString())` agrees with the block branch today,
> * but only because two independent facts happen to line up: {@link takeSovereignHold}
> * uses the CID string as the label, *and* registers exactly that CID's bytes.
> * {@link EgressGuard.guard} takes an arbitrary label for an arbitrary payload, so
> * neither fact is guaranteed by anything. The moment a payload is registered under
> * any other label, the label-keyed predicate advertises a block the block branch
> * refuses — the exact side channel, reintroduced by a line that reads like a
> * simplification.
> ```
> — `packages/net/src/sovereign-egress.ts:110-118`

And the invariant it protects, stated as a method rather than a rule:

> ```
> * Holding an invariant between two branches means asking **one** question twice, not
> * writing the question down twice.
> ```
> — `packages/net/src/sovereign-egress.ts:104-105`

### 3.12 A manifest complete by construction

> ```
> * **Every job emits a manifest of what left, complete by construction.** The phrase
> * matters. A manifest assembled by instrumenting call sites is complete only for the
> * call sites someone remembered; a manifest produced by the *sole* code path out is
> * complete because there is nowhere else to go. So this is a `Transport` decorator:
> * recording is not something the sender does in addition to sending, it is part of
> * sending. Bypassing the record means bypassing the network.
> ```
> — `packages/net/src/egress.ts:11-16`

> ```
> * There is deliberately **no** `refused` field on {@link EgressEntry}: under this
> * design a `violation` *is* a refusal, by construction, so a second field could
> * only ever drift from the first. Do not add one.
> ```
> — `packages/net/src/egress.ts:56-58`

### 3.13 A field with no authentication, said out loud

> ```
> * **Nothing authenticates this field.** One peer can invent N ids for one partial and
> * inflate the aggregate N-fold, which is this fix's cost: a silent undercount becomes
> * a forgeable overcount. Under the project's own split — a sovereign map is
> * owner-attested and the aggregation over contributions is verified — the only honest
> * source for this value is the Noise-authenticated peer the partial arrived from, and
> * the collection path that would mint it does not exist yet. Do not populate it from
> * anything a requestor chose.
> ```
> — `packages/core/src/reduce.ts:119-124`

### 3.14 A constant that says precisely what it does *not* bound

> ```
> * **What it bounds, stated precisely, because the obvious reading is wrong.** This
> * is a ceiling on the *number of inputs* one combine may **merge**. It is not a
> * ceiling on what one combine frame may cause to be transferred or to stay
> * resident. …
> * No product of the two is written here, because a residency figure that
> * nobody measured against a running node is not a guarantee — if one is ever
> * wanted, measure it and record it with its date.
> ```
> — `packages/core/src/reduce.ts:91-106`

### 3.15 A widened union instead of a fabricated `Task`

> ```
> * The rejected alternative is worth naming, because it is the one that keeps this type
> * unchanged and is therefore the tempting one: build a `Task` literal for the combine.
> * `Task` requires `moduleCid`, `inputCid`, `partitionIndex` and `partitionCount`, and a
> * combine has **none** of them … Every one of those four fields would have had to be
> * fabricated, and an authorizer that later read one would be admitting or refusing on
> * the strength of a CID naming nothing. A refusal that names the wrong thing is a defect
> * in this repository even when the job correctly fails, so the type widened instead.
> ```
> — `packages/net/src/agent.ts:89-98`

### 3.16 A slot deliberately *not* taken, because taking it would be theatre

> ```
> // **No capacity slot is taken here, and that is a measurement rather than an
> // omission.** `LocalCapacity` bounds how many units of work are in flight *at
> // once*, and `EnrollmentAuthority.enrol` is fully synchronous — it verifies two
> // signatures and signs one payload with no `await` anywhere in it. Nothing can
> // interleave between a take and a release around a synchronous call, so the
> // count could never read above one and the bound would never bind. Taking a slot
> // here would be a reported bound rather than a measured one, which is the defect
> // this repository keeps finding.
> ```
> — `packages/net/src/agent.ts:692-699`

### 3.17 An error vs a refusal

> ```
> // A node holding no signing key answers `error`, not a refusal `result`. The
> // distinction is which question was answered: a refusal says *your request was
> // not granted* and names which of three things was wrong with it, while this
> // says *I am not somewhere that grants them*, which is a fact about this node.
> // Collapsing the two would tell a requestor to fix its proof when it should be
> // asking somebody else.
> ```
> — `packages/net/src/agent.ts:685-690`

### 3.18 A default that would partition the fabric on upgrade

> ```
> * - **`capacity: null` means the node stated nothing, and leaves it unbounded by
> *   the requestor** — not assumed full. The safe-looking alternative is wrong:
> *   assuming full would make every node running the previous build undiscoverable
> *   to a node running this one, which is a fabric that partitions itself on an
> *   upgrade.
> ```
> — `packages/net/src/protocol.ts:158-162`

### 3.19 The cost of a union lookup, accepted and measured

> ```
> * The lookup now pays the **slowest** peer instead of the fastest, and a peer that
> * answers nothing costs the full `RpcEndpoint` budget … on **every** lookup …
> * Both are accepted, and the second is measured rather than asserted …
> *
> * A peer that fails *fast* — an unknown id, a partitioned link — costs nothing, because
> * the transport rejects before any budget is entered. The expensive case is silence,
> * not absence.
> *
> * No probe deadline is adopted for it. {@link DEFAULT_PROBE_TIMEOUT_MS} exists in this
> * file and is a number chosen for a different question … and reusing it here would be a
> * quantity nobody measured for this one.
> ```
> — `packages/net/src/discovery.ts:55-71`

### 3.20 Why re-asking a peer verdict is a fabric-wide ruling

> ```
> * Seeding covers a peer that was already connected. It does **not** cover a peer whose
> * *answer* changes afterwards, and that turned out to be the more common case: a node that
> * enrols after a peer has connected to it was excluded by that peer for the life of the
> * connection, silently. It was found by measurement rather than review — a gate dialled a
> * browser tab before the tab's `serveAgent` was up, and the refusal that settled would have
> * stood for ever even though the tab held a valid certificate from the pinned issuer
> * throughout.
> …
> * **This is a fabric-wide behaviour, not a local fix**, which is why it was held for an
> * owner ruling rather than patched when it was found (2026-08-01).
> ```
> — `packages/node/src/peer-verifier.ts:67-86`

And, in the same header, a "packaging fact, not a capability one" that says which tier
is unmeasured:

> ```
> * … Until that happens, peer verification is measured for the Node tier and
> * UNMEASURED for the browser tier. Nothing here reads what kind of node a peer is; there
> * is no field to branch on.
> ```
> — `packages/node/src/peer-verifier.ts:94-97`

### 3.21 The reuse that looks right until two lines are read side by side

> ```
> * The obvious reuse is `new RpcRecordIndex(rpc, () => [peerId]).recordsFor(expected)` — a
> * single-element thunk does ask exactly one peer. It is wrong, and it looks right until
> * two of that class's lines are read side by side. `#ask` wraps `rpc.request` in a
> * `try/catch` that returns `null` … So an unreachable peer and a peer answering `records: null`
> * are the same value, and there is no surviving error object for an `unreachable` verdict's
> * `detail` to come from — that arm is not constructible through the class at all.
> * Skip-and-continue is correct for a multi-peer lookup and wrong for a per-peer verdict.
> ```
> — `packages/node/src/peer-verifier.ts:31-39`

### 3.22 A deleted 1,214-line gate, and the boundary its ghost must not cross

> ```
> * A 1,214-line admission gate that predicted nondeterminism from a WASM instruction
> * stream was built, hardened, fuzzed, and deleted. The rule that replaced it stands:
> * divergence is *detected* by running a module twice and comparing bytes, never
> * predicted. Nothing here contradicts that, and the distinction is not that this
> * code reads fewer bytes — it is where a wrong answer lands. A determinism predictor
> * makes a claim about *executions that have not happened*, so being wrong means
> * shipping a wrong result that verification was supposed to catch. This predicts
> * whether a *compiler* will accept a *file*, so being wrong costs a failed build
> * that the build log then explains. Blast radius, not technique, is what separates
> * the two.
> *
> * The corollary is a boundary: this module reads ELF *headers*. It must never grow a
> * pass over the AArch64 instruction stream hunting indirect or computed jumps. That
> * is the deleted gate wearing a different architecture.
> ```
> — `packages/aot/src/elf.ts:32-46`

Directly above it, the corrected assumption:

> ```
> * ## Stripped is not disqualifying — the recorded assumption was wrong
> *
> * This project's notes said elfconv required unstripped binaries. Measurement says
> * otherwise: a stripped input translates fine **as long as `.eh_frame` survives**,
> * because the loader recovers function entries from the unwind tables via libdwarf.
> * … Encoding the original assumption would have refused
> * a large and perfectly translatable class of input — release binaries — which is
> * the expensive kind of wrong for a gate to be, because nobody investigates a build
> * that was never attempted.
> ```
> — `packages/aot/src/elf.ts:18-28`

### 3.23 A per-node config that is honestly named as an open disagreement

> ```
> * **Per node, and that is a disagreement this file does not close.** Two honest
> * nodes configured differently reach different verdicts on the same
> * content-addressed module and input, and the verdict is then committed to and
> * compared as though it were the module's answer. What this file does is make that
> * disagreement diagnosable — the refusal names the cap and the attempted length —
> * rather than mysterious.
> ```
> — `packages/core/src/executor/wasm.ts:44-51`

### 3.24 Quorum rules that are about the graph, not about node kinds

> ```
> *   2. **No single relay every member is discovered through.** Not a rule about kinds
> *      of node — **all nodes have equal functionality** and a browser peer fills any
> *      slot a server can. It is a statement about the discovery *graph*: if every
> *      member is found only via relay R, then R failing loses the whole quorum, and
> *      the redundancy was never real. Three browser peers discoverable through three
> *      different relays pass; three servers published behind one do not. The rule
> *      reads the actual discovery paths, never a node's category.
> ```
> — `packages/core/src/quorum.ts:10-17`

### 3.25 A benchmark baseline that no code may write

> ```
> * Nothing in this repository writes to this file. No `--update` flag exists, and the
> * gate has no path that rewrites it. If the gate goes red, the two honest responses are
> * to fix the regression or to decide — in a commit whose message says so — that the new
> * cost is understood and intended, and then edit these numbers by hand. A gate that
> * silently absorbs whatever the last run produced measures nothing: it only ever agrees
> * with the present, which is precisely the property that makes a perf baseline
> * worthless.
> ```
> — `packages/bench/src/perf-baseline.ts:6-12`

With the measurement that justified using ratios rather than milliseconds:

> ```
> * Absolute milliseconds are not a stable measurement on a developer machine, and that is
> * a measurement rather than an opinion. Under CPU saturation the absolute p50 makespan
> * moved by a factor of 4.03 and the p95 by 4.20, while the paired coordination ratio's
> * p50 moved by a factor of 0.56 — that is, *down*: the synchronous reference loses more
> * to CPU starvation than the fabric path does. Across the 32 unsaturated passes the
> * ratio's p50 never rose more than 7 % above its baseline.
> ```
> — `packages/bench/src/perf-baseline.ts:38-43`

### Bonus — the blind spot as a field, not a caveat

> ```
> * A node that cannot reach a peer cannot report that it cannot reach a peer. So the
> * reported population is never the visited population, and the gap is *exactly* the
> * blocklist cliff this measurement exists to expose. {@link StartReport} therefore
> * carries its blind spots as a field, and {@link describeStartReport} renders them
> * in the same block as the numbers … a figure that vanishes between
> * the method and the result is indistinguishable, to a reader, from one removed
> * because it was inconvenient.
> ```
> — `packages/core/src/start-outcome.ts:12-19`

---

## 4. The guard tests — the repo testing its own discipline

Three mechanisms, all living in `packages/node/src/` because they read real files off
disk and spawn real processes.

### 4.1 `vocabulary.node.test.ts` — a banned-words guard (590 lines)

**Mechanism only** — the list itself is not reproduced here.

The rule exists for a commercial-survival reason, stated up front:

> ```
> * The reason is not squeamishness. Coinhive became the second-most-blocked domain
> * across 130M Malwarebytes users; Firefox blocks the whole category by default via
> * the Disconnect list; Google banned the whole category from the Chrome Web Store;
> * Salon's opt-in flow was pilloried anyway. Consent did not save any of them — the
> * explicitly opt-in AuthedMine was blocked too. A blocklist entry is origin-level
> * and effectively permanent, and its failure mode is invisible: nobody reports that
> * the page was blocked, it just contributes nothing.
> *
> * The demo ships a policy page written for the human reviewer who decides that.
> * That reviewer greps. They do not read intent, they do not open a design document
> * to check which sense of an ambiguous word was meant …
> ```
> — `vocabulary.node.test.ts:10-22`, with two words redacted. Quoting the header
> verbatim trips the guard the header exists to explain, which is the same recursion
> that made Phase 17 rewrite a deferred-items entry rather than exempt it.

How it works:

1. **Population = `git ls-files -z`** (`:360`), never a directory walk — *"it excludes
   `node_modules`, `dist`, and everything gitignored for free, and — more importantly —
   it matches what a reviewer sees when they clone the repository, which is the population
   this rule is actually about."* (`:355-357`)
2. **Matching** is a small table of `{term, pattern: RegExp, why}` records (`:47`), with
   `\b` anchors and inflection alternations. `rawMatches()` (`:291`) reports every hit as
   `{file, line, column, term, match, text}` *before* any exemption is applied — *"Separated
   from the exemption layer so the mutation tests can prove the matcher itself fires,
   independently of where a file happens to live."* (`:288-290`)
3. **Two exemption tiers, both carrying prose reasons.** `EXEMPT_PATHS` (whole trees, five
   entries) and `EXEMPT_LINES` (keyed on an exact *phrase*, not a line number, *"because
   several of these files are edited by concurrent work, and an exemption that fires on an
   unrelated edit is how a guard gets deleted."* — `:129-133`). A line exemption only covers
   a match falling **inside** the phrase's span (`lineExemptionFor`, `:266-283`), so
   *"exempting … on a roadmap line would also exempt anything else later added to that line"*
   is prevented (`:262-264`).
4. **Dead-exemption check.** `used` collects the keys of exemptions that actually fired;
   any that never fire fail the suite — *"A dead exemption is worse than no exemption: it
   silently covers a line that no longer says what the reason claims, and the next person
   to write that line gets a free pass."* (`:496-499`)
5. **Anti-vacuity checks.** `it('read the files it claims to have read')` asserts >100 files
   scanned and names three specific ones (`:406-411`); another asserts exempt paths are
   `< scanned.length / 4` (`:417`).
6. **The NUL story — the best beat in the file.** A binary skip keyed on "contains a NUL"
   swallowed a real `.ts` file whole:

   > ```
   > * `wasi-executor.test.ts` was committed carrying two raw NUL bytes — literal argv
   > * terminators inside a template string — and the binary skip above swallowed the
   > * whole file. Nothing failed. No entry appeared in `EXEMPT_PATHS`. The
   > * planted-violation tests below kept passing, because they scan synthetic content
   > * rather than the tree, so the guard reported itself healthy while one file had
   > * quietly left its jurisdiction.
   > ```
   > — `vocabulary.node.test.ts:423-430`

   The fix makes the skip a *declaration*: `BINARY_EXTENSIONS` (`:206`), and
   `nulVerdict()` returns `'text' | 'declared-binary' | 'invisible'` (`:232-237`).
   *"A NUL inside one of these extensions is a binary; a NUL anywhere else is a violation in
   its own right"* (`:200-202`). Two complementary tests: `'has no file that escaped the scan
   by looking like a binary'` (`:434`) and `'still skips the binaries it is meant to skip'`
   (`:445`) — *"If `invisible` were empty because nothing is ever skipped, the guard would be
   scanning WASM bytes for English and the empty result would prove nothing."* (`:446-448`)
7. **Proof the checker can fail.** A whole `describe` block plants each banned term in
   synthetic content at an unexempted path and requires a catch (`:518-541`), plus an
   inflection sweep requiring ≥13 hits across 5 terms (`:543-558`), plus deliberate
   non-matches — ordinary English and the pronoun — because *"If any of these start failing,
   the patterns have grown teeth they should not have, and the rule will be deleted the
   first time it fires on a phase retrospective."* (`:579-581`)

### 4.2 `purity.node.test.ts`

Covered in §1. Mechanism: regex over every `from '…'` / `import '…'` specifier
(`specifiersOf`, `:87-96`) in every non-`.node.test.ts` `.ts` file, plus each
`package.json`'s `dependencies` keys, per tier; violations are accumulated into a string
list and compared to `[]` so the failure message names file, specifier and reason
(`:110`).

### 4.3 The mutation ledger — `mutation-ledger.ts` (859 lines) + `mutation-guard.mutate.ts` (243) + `mutation-guard.node.test.ts` (222)

**The idea.** Every deliberate defect this repository has proved a test can see is written
down as *data*, with the test that caught it and the exact failure text observed.

> ```
> * Phase 13.1's verification planted ten defects by hand and watched nine of them go
> * red. That exercise established something real and then threw it away: the record
> * lived in a report, so if somebody later deletes one of these lines, nothing
> * re-checks that a test still notices. A mutation proved once is not a guard; a
> * mutation re-proved on demand is.
> ```
> — `mutation-ledger.ts:7-11`

**The `Mutation` record** (`:50-89`) — `id`, `why` (prose), `file`, `find` (must occur
**exactly once**), `replace` (empty = delete), `caughtBy` (files *measured* to fail),
`signature` (a substring **observed** in the failing output), optional `project`.

On `caughtBy`: *"Not the set that ought to catch it — the set that did, on the run recorded
in each entry."* (`:70-71`)

On `signature`:

> ```
> * It is a substring **observed** in the failing run's output, not a prediction. Each
> * one below was read off a real planted run on 2026-07-29 and pasted back. It exists
> * so that "the suite went red" is not accepted on its own: a mutation that trips an
> * unrelated flake, a port collision or an OOM would also produce a non-zero exit,
> * and that is not evidence the guard saw anything.
> ```
> — `mutation-ledger.ts:38-43`

**Two layers, and the split is not about speed.**

- Layer 1, `mutation-guard.node.test.ts`, runs in the ordinary suite and **plants nothing**.
  It asks only whether each entry still *describes* the source. Its own header names the
  failure mode as one this repo has already shipped:

  > ```
  > * That is not a hypothetical failure mode in this repository. The disclosure gate
  > * shipped with a pattern for `wrangler pages deploy` that required the verb to
  > * follow the tool name directly, so it matched nothing; every absence assertion
  > * built on it passed for as long as it existed, and the repository read clean the
  > * whole time. Same shape, one file over.
  > ```
  > — `mutation-guard.node.test.ts:18-22`

- Layer 2, `mutation-guard.mutate.ts` (`npm run test:mutations`), plants for real:
  snapshot in memory *before* the first write (`:112`), write the defect, `spawnSync('npx',
  ['vitest','run','--project', entry.project ?? 'node', ...entry.caughtBy])` (`:135`),
  restore in a `finally` (`:143`), verify byte-identity (`:149`), then require **both** a
  non-zero exit **and** the recorded signature (`:159-177`). Verdicts are one of
  `'caught' | 'survived' | 'wrong-signature' | 'drifted' | 'not-restored'` (`:62`).

  Why a script and not a spec:

  > ```
  > * A `*.test.ts` that rewrote `agent.ts` would do it while vitest was running other
  > * files in the same worker pool, and whichever sibling imported the mutated module
  > * next would fail for reasons nobody could reconstruct.
  > ```
  > — `mutation-guard.mutate.ts:22-25`

  SIGINT/SIGTERM handlers restore everything outstanding (`:76-82`), and the last check is
  whole-tree: *"Everything above is per file; this is the only reading that can see a file
  some other path forgot to put back."* (`:224-225`) — `git status --porcelain` must be
  empty. A survivor is reported as *"a finding about the test suite, not about this script.
  Report it by id rather than deleting the entry."* (`:238-239`)

**Health checks on the ledger itself** — `problemsWith()` (`:816-859`) rejects an entry
whose `why` is under 40 characters (*"the reason is too short to be a reason"*), whose
signature is empty (*"a non-zero exit from an unrelated flake would be accepted as proof the
guard fired"*), whose `find` occurs 0 times (*"this mutation has stopped applying, and a
mutation that cannot be planted guards nothing"*) or more than once (*"the mutation is
ambiguous — narrow it until it names one site"*).

**41 entries currently** (`M1`–`M35`, `M2a/b/c`, `M3a/b`, `B1`, `B2`). Four whose reasoning
is worth reading in full:

**`M2b`** — an entry that documents its own *previous false justification*:

> ```
> * The same reversion on the browser factory, and the only instrument that sees it
> * is still the structural count in `serve-agent-hooks.node.test.ts` — a weaker
> * guard than `M2a` has, which is why this is a separate entry rather than one
> * strong result covering two call sites. **The reason is not that the factory is
> * unreachable.** That claim stood here until 2026-07-31 and was false: the `e2e`
> * project drives a real tab from Node, and `M30` below plants a defect in this
> * same file and watches a live tab catch it. What is missing for *this* entry is
> * narrower and is the whole of it — nothing drives an over-committed refusal
> * through a browser tab, so the admission bound has never been read there. The
> * `browser` project genuinely cannot host such a test, because a Circuit Relay v2
> * server *"will not work in browsers"* in `@libp2p/circuit-relay-v2`'s own words;
> * the `e2e` project can, and closing this is a matter of writing the case.
> ```
> — `mutation-ledger.ts:139-151`

**`M9` / `M20`** — the same guarantee pinned twice, because the two catch different edits:

> ```
> * A reply is matched against the peer its request went to, and this expression is the
> * whole of that. Keying on the id alone restores the state where any peer that could
> * reach this node could answer a request it was never sent — ids are a per-endpoint
> * counter and every RemoteExecutor in a job shares one endpoint, so a sibling id is one
> * increment away and the first frame wins. That is enough to forge N-version agreement
> * out of a single machine, which is the one claim redundant execution exists to make.
> ```
> — `mutation-ledger.ts:395-401` (M9: `` return `${peer}\u0000${id}` `` → `return String(id)`)

> ```
> * … M9 catches a key that stops naming the peer, which breaks
> * both sides at once and is obviously wrong on sight. This catches the edit that
> * looks reasonable: a receive path made tolerant so a peer whose address is spelled
> * slightly differently still gets its reply matched. …
> * Pinned on the call rather than on the key's body so the entry survives the separator being
> * respelled — `27633c7` already respelled it once, from a raw byte to an escape.
> ```
> — `mutation-ledger.ts:410-419` (M20)

**`M22`** — the "improvement" that silently removes the point of the module:

> ```
> * VER-01. Reporting a disagreement is the one thing this module exists to do, and a
> * majority rule is the "obvious" improvement that silently removes it: two colluding
> * replicas out-vote an honest one, the fabric publishes their answer as verified, and
> * the honest result appears nowhere in the record. The line is load-bearing precisely
> * because the edit that breaks it reads like a fix — `groups.size > 1` must mean
> * disagreement however the sizes are distributed.
> ```
> — `mutation-ledger.ts:534-539`

**`M30`** — the largest measured hole in the ledger, and the reason `caughtBy` must
sometimes be an e2e file:

> ```
> * AUTH-03 in the browser tier, and the entry that closes the largest measured hole
> * this ledger has ever recorded. Plan 15-03 planted exactly this scrambling — the
> * owner id and owner key transposed, the audience replaced by an eight-character
> * literal, the clock frozen at zero — and nothing in the repository moved: `tsc`
> * exited 0, the substring count in `serve-agent-hooks.node.test.ts` stayed at 1, and
> * 345 browser tests passed in three engines. … What makes it the defect a reviewer would least
> * expect to be caught is that the mutated node still *refuses* — it simply refuses
> * for the wrong reason, naming the owner key where the owner id belongs, so every
> * assertion of the form "the job failed" passes. Only a test that reads the refusal
> * **text** against a live tab sees it…
> ```
> — `mutation-ledger.ts:669-682`

**`M31`** — an entry that writes down what it deliberately does *not* catch:

> ```
> * **What this
> * mutation deliberately does not catch is worth writing down**: the two bound cases
> * declare their saturation by reserving a slot directly on the node's own
> * `LocalCapacity`, so `would()` still sees a full table and still refuses — they stay
> * green. Only the three release readings see it, which is why `caughtBy` names the
> * in-process file and not the real-node one.
> ```
> — `mutation-ledger.ts:706-712`

**`M25`** — an entry that records a bug report *failing to reproduce*, and what was
guarded instead:

> ```
> * B19 as reported did not reproduce — `settleRace` stopped inventing a `taskId`, and
> * `RaceOutcome.losers` is a `RaceLoser[]`, so the hollow field has no spelling there. …
> * Stated honestly:
> * `discarded` has no reader in this repository yet, so this guards a record that is
> * written and not yet consumed.
> ```
> — `mutation-ledger.ts:586-595`

Several entries also encode *maintenance events* on themselves — e.g. `M3a` was
*"Re-indented on 2026-07-30 when the accumulation budget's `try`/`finally` wrapped the loop;
same line, two spaces deeper, and the find text was moved with it rather than dropped."*
(`:165-168`)

---

## 5. Test scale

Counted on disk, 2026-08-01:

| Metric | Count |
|---|---|
| Test **files** (`*.test.ts`, `-type f`) | **132** |
| `it(` / `test(` call sites | **1,533** |
| `describe(` blocks | **451** |
| Source `.ts` files under `packages/` + `tools/` | 265 |
| Portable specs (plain `*.test.ts`, run in *both* node and browser) | 65 |
| `*.node.test.ts` (packages) | 46 (+3 in `tools/`) |
| `*.browser.test.ts` | 8 |
| `*.e2e.test.ts` | 9 |
| `*.perf.test.ts` | 1 |

### Four vitest projects (`vitest.config.ts:143-239`)

> ```
> * Four projects, split by what a test needs rather than by what it covers:
> *
> *   node     everything that runs in a plain Node process
> *   browser  the same portable specs, in real Chromium
> *   e2e      specs that drive Playwright themselves — see below
> *   perf     the perf gate, present only under `O2_PERF=1` — see `PERF_GATE`
> ```
> — `vitest.config.ts:82-87`

- **`node`** (~114 files): `packages/*/src/**/*.test.ts` + `tools/**/*.node.test.ts`,
  excluding browser/e2e/perf. `tools/` is here because *"they shell out to containers and
  could not run in a browser even in principle"* (`:148-150`).
- **`browser`** (73 files × **3 engines**): the 65 portable specs plus the 8
  `*.browser.test.ts`, under Playwright with `instances: [chromium, firefox, webkit]`
  (`:195`). The rationale is a standing owner ruling, and it forbids over-claiming:

  > ```
  > * Three engines on one host are three independent implementations with
  > * three independent storage backends. They are **not** three machines,
  > * and no result obtained here may be labelled cross-machine or
  > * distributed-hardware — the ruling is explicit about that.
  > *
  > * A spec that fails in only one engine is the finding this matrix exists
  > * to produce. Narrowing the matrix back to hide such a failure would
  > * destroy the only instrument that can see it.
  > ```
  > — `vitest.config.ts:186-193`

  The whole dual-run exists to catch platform leakage: *"The kernel has no platform imports,
  so the same test files run unchanged in Node and in a real browser. Any test that only
  passes in one of them means a platform assumption leaked into `@o2/core`, which is exactly
  what this config exists to catch."* (`:73-77`)
- **`e2e`** (9 files, `fileParallelism: false`): real Chromium + real relay + real Vite per
  file. Serialised deliberately —

  > ```
  > * Each of these launches its own Chromium, its own relay, and its own
  > * Vite server. Run in parallel they contend for CPU and sockets, and the
  > * symptom is a timeout in whichever one lost — a flake that looks like a
  > * WebRTC or relay bug and is neither. Observed once under load from a
  > * concurrent `git push`…
  > ```
  > — `vitest.config.ts:207-212`

  Files: `background-tab`, `browser-capability`, `browser-enrollment`, `built-bundle`,
  `code-cache`, `colouring-demo`, `many-tabs`, `seed-discovery`, `two-tabs`.
- **`perf`** (1 file, only under `O2_PERF=1`, `fileParallelism: false`):
  `packages/bench/src/perf-gate.perf.test.ts`. *"It stands up three fabrics and runs 303 jobs
  plus 303 reference passes, its numbers are only meaningful against the committed baseline
  in `perf-baseline.ts`…"* (`:58-61`). Both halves of the gating are needed:
  *"the exclusions keep the file out of the default projects, and the conditional keeps the
  project that does run it out of the default run. Either one alone leaves the gate either
  running everywhere or reachable nowhere."* (`:63-66`)

### The `test:unit` split, measured rather than guessed

> ```
> * Measured, not guessed from filenames. `vitest run --project node
> * --reporter=json` on 2026-07-29 gave a per-file span for every file in the
> * project: median 37 ms, p75 267 ms, p90 1070 ms, total 252.7 s. The nine files
> * below are every file that came in at or above 1 s.
> *
> * The effect was then measured on the script itself rather than predicted from
> * that table: `npm run test:unit` runs 66 files / 946 tests in **6.46 s**, against
> * `npm run test:node` at 75 files / 1080 tests in **210 s**. Roughly 33× faster for
> * 88 % of the files.
> ```
> — `vitest.config.ts:7-15`

Each of the nine excluded files carries its own measured cost *and* its mechanism inline
(`vitest.config.ts:31-39`), e.g. `tools/aot/lift.node.test.ts` at `217.1 s — 48 docker
invocations via execFileSync`, `packages/net/src/churn.test.ts` at `1.1 s — 800k-iteration
churn loop`. And the naive proxy is explicitly refuted:

> ```
> * Filename was *not* a usable signal, and neither was the obvious mechanical
> * proxy. Grepping for `node:child_process` or `docker` selects a different set:
> * `disclosure-gate` (528 ms), `purity` (219 ms) and `vocabulary` all spawn real
> * processes and are fast, while `transport-bounds` (9.85 s) and `admission`
> * (7.61 s) — the 2nd and 3rd slowest — import neither.
> ```
> — `vitest.config.ts:23-28`

### Coverage is explicitly not a gate

> ```
> * Deliberately no `thresholds` block. A floor picked before anyone had seen the
> * number would be arbitrary in both directions: high enough to block work that
> * is fine, or low enough to certify a regression as passing. Setting one is a
> * separate deliberate act, taken against a number that exists.
> ```
> — `vitest.config.ts:96-99`

Every coverage `exclude` entry carries its reason (`:112-140`) — including the one that
records a measured distortion:

> ```
> // The mutation-planting driver behind `npm run test:mutations`. … Being a plain script, no spec loads it, so the v8
> // provider read it as 0 of 85 statements and dragged `packages/node/src` from
> // 70.38% to 54.94% on a run where no covered code had changed. The tool that
> // measures the guards is not itself one of the guards.
> ```
> — `vitest.config.ts:132-139`

---

## 6. Things that made me stop and read twice

1. **A negative result with a calibrated instrument.** `code-cache.e2e.test.ts` exists to
   report that V8's WASM code cache *never fired* — and spends its header proving the
   instrument works, including a self-correction:

   > ```
   > * The control is deliberately described as *the page's JavaScript* rather than as a
   > * particular file. An earlier version served a 600 KB module with long cache headers
   > * and called that the control; re-serving it with `Cache-Control: no-store` was then
   > * expected to collapse the number and did not — the figure is dominated by the
   > * modules Vite serves, and the claim that the header mattered was wrong.
   > …
   > * Relaunched
   > * with Chromium's `--v8-cache-options=none`, `Code Cache/js` reads **72 bytes** —
   > * exactly what `Code Cache/wasm` reads on every ordinary run. So 72 bytes is the
   > * measured signature of "no code cache was written", produced on purpose on the side
   > * that normally works…
   > ```
   > — `packages/node/src/code-cache.e2e.test.ts:54-67`

   With a results table at `:73-78`: 220 KB / 1.1 MB / 4.8 MB / 10.8 MB modules, 2–3 visits,
   `72 B (index only)` every time.

2. **A test timeout raised twice, and the second mistake left on the record.**

   > ```
   > * The figure was then set wrong once before landing, which is worth leaving on the
   > * record because it is the same error twice. 60 s was chosen against the ~25 s the
   > * whole file measures idle across all three engines — the typical case. Hours later
   > * the same LLVM build reached a load average of 130, and the n=300 cube exceeded
   > * 60 s in Firefox. Sizing a bound to the typical case is precisely the mistake the
   > * paragraph above describes.
   > *
   > * 120 s is ~5x the idle whole-file cost, and was verified against the host at that
   > * 16x oversubscription rather than against a quiet one.
   > ```
   > — `packages/demo/src/kernel.test.ts:26-34`

   And the diagnosis it follows: *"Nothing was wrong with the kernel; the machine was
   busy. A correctness suite that goes red because another process is compiling is not
   reporting on the code…"* (`:19-24`)

3. **A test that documents what it *cannot* catch, with the measurement.**

   > ```
   > * **A second pin, not a feature proof, and the distinction was measured rather than
   > * assumed.** Deriving `peerId` from `nodeKey` instead of from the private key does
   > * **not** redden this — measured: 17/17 still pass. It cannot, and the reason is this
   > * plan's own premise: the two derivations are byte-identical, so no assertion can
   > * distinguish them. What this does catch is a genuine confusion between the two
   > * namespaces — assigning `peerId` the `nodeKey` string reddens four tests here.
   > ```
   > — `packages/libp2p/src/identity.test.ts:80-85`

4. **A diagnostic corrected against an eight-node experiment.**

   > ```
   > * Measured 2026-07-31 on an
   > * eight-node in-process fabric with this dispatcher's fetch-back removed: the root
   > * combine fell through **all eight** executors and the run reported
   > * `recomputes: 0`, `combines: 2`, `executedBy.size: 2`, `rootCid: null`, and `failed`
   > * naming the root. So the diagnostics that do survive a reduce which failed everywhere
   > * are **`failed`** … and **`executedBy`** … `recomputes` measures churn among *successes* and
   > * reads zero on total failure.
   > ```
   > — `packages/net/src/combine.ts:37-44`

   And the cost it accepts rather than hides: *"every failure collapses to `null` here, and
   **the reason string the peer sent is lost by construction.** That is stated as a cost
   rather than elided."* (`:24-27`)

5. **The reduce tree's whole design is three sentences, and each deletes machinery.**

   > ```
   > * **Topology is derived, not agreed.** The tree is a pure function of the sorted
   > * contributions, so every participant computes the identical tree independently and
   > * *zero* messages are spent reaching agreement. …
   > * **Assignment is derived too.** Rendezvous (HRW) hashing ranks every candidate node
   > * for every combine. The winner is the executor; the rest of the ranking *is* the
   > * fallback list, already known locally. …
   > * **A combine is a pure function of content-addressed inputs.** So repair is not
   > * recovery — there is no state to transfer, no checkpoint to restore, no partial
   > * progress to reconcile. … A late result from the presumed-dead node is
   > * harmless: it carries the same CID as the recomputed one, so it dedupes into
   > * nothing.
   > ```
   > — `packages/core/src/reduce.ts:8-31`

   And a precision that most codebases would get wrong: *"Commutativity is **not** strictly
   required here, and saying otherwise would be imprecise. … the property the tests actually
   enforce is associativity."* (`:42-46`)

6. **Discovery as an intersection, with a table of what each fact proves alone** —
   `packages/core/src/discovery.ts:11-23`. The self-signed capability record *"sounds like
   security theatre until you see what it is bolted to. On its own it is worthless: an
   attacker generates a keypair and claims anything. It becomes meaningful only because the
   same `nodeKey` must also carry a certificate a *pinned provider* signed…"*

7. **A `LateOutcome` union with a member that carries nothing**, present only to make the
   next omission a compile error:

   > ```
   > * One list per shard rather than one map per outcome. Parallel maps were how the
   > * hole appeared: a copy that answered *with a failure* was neither silent nor
   > * disagreeing, and every reader had to remember to consult a third structure that
   > * did not exist. `'agreed'` is here purely so the merge's enumeration is exhaustive —
   > * it carries nothing — which turns a fifth outcome invented later into a compile
   > * error rather than a silent omission.
   > ```
   > — `packages/core/src/coordinator.ts:279-284`

8. **The benchmark harness enforces three methodology rules structurally**, including:
   *"An incomplete run never enters makespan statistics. It is counted separately. Folding a
   fast failure in as a fast run is the standard way to make an unreliable system look quick,
   and it requires no dishonesty — only carelessness."* — `packages/bench/src/harness.ts:12-14`

9. **`DEFAULT_MAX_CONCURRENT_TASKS` states where its own bound does not apply**: *"a tab's
   own local executor takes **no** admission slot … A slot count is therefore a statement
   about work *peers sent this node*, and a reading taken from a node that is also executing
   locally is a reading of two different things unless the local path is excluded."*
   — `packages/core/src/placement.ts:600-604`

10. **The mutation ledger has an entry (`M19`) whose defect is text on a rendered HTML
    page**, caught only by an e2e test driving a live tab — which is what forced the
    `Mutation.project` field to exist at all (`mutation-ledger.ts:80-88`, `:463-480`).
