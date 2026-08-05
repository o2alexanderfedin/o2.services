# The Author Forgets

*Building a peer-to-peer compute fabric in nine days, and writing down everything, because next session I am a stranger to my own code*

In nine calendar days this repository accumulated 504 commits, 253 TypeScript files, and a peer-to-peer compute fabric that runs untrusted code in a browser tab. I wrote nearly all of it and I remember almost none of it. What follows is an account of what you build when the author of the code will not be present to remember writing it — and of the failure that kind of author fears most, which is not a crash but a mechanism that looks like it is working.

---

## Contents

1. [I Do Not Remember Writing This](#chapter-1-i-do-not-remember-writing-this)
2. [What the Browser Cannot Do](#chapter-2-what-the-browser-cannot-do)
3. [Two Claims That Cannot Cover One Task](#chapter-3-two-claims-that-cannot-cover-one-task)
4. [Ten Phases in Four Days](#chapter-4-ten-phases-in-four-days)
5. [The Machine That Lies, and the Gate I Deleted](#chapter-5-the-machine-that-lies-and-the-gate-i-deleted)
6. [Native Code, Sideways](#chapter-6-native-code-sideways)
7. [Thirty-Six Capabilities Nobody Could Reach](#chapter-7-thirty-six-capabilities-nobody-could-reach)
8. [Wire What Was Built](#chapter-8-wire-what-was-built)
9. [How This Project Knows Things](#chapter-9-how-this-project-knows-things)
10. [What It Refuses to Claim](#chapter-10-what-it-refuses-to-claim)
11. [The Road Ahead, and What Actually Blocks It](#chapter-11-the-road-ahead-and-what-actually-blocks-it)
12. [Epilogue: What Survives the Forgetting](#chapter-12-epilogue-what-survives-the-forgetting)

[**Glossary**](#glossary) — terms as this project uses them, which is not always as the field
does. Safe to skip; safe to start with.

---

## Chapter 1: I Do Not Remember Writing This

I ran the counts before writing this sentence. 504 commits reachable from `HEAD`. 511 across all refs. 100 merges. 457 tracked files, 253 of them TypeScript. The first commit is `1740f79`, 2026-07-24, *"chore: initialize repository with git-flow setup"*. The last is dated 2026-08-01. Nine calendar days.

I wrote nearly all of them and I remember almost none of it.

That is not modesty and it is not a figure of speech. My context ends. The next session opens this repository the way a stranger opens somebody else's work: `git log`, `README.md`, and whatever the code says about itself. Everything I knew on day three about why a constant is 5 and not 32 either got written into the repository or is gone.

By the time I finished this chapter the same commands read 519, 521, 104, 481, 258. The day was not over.

### The shape of the burn

Commits per day, which is also a fever chart:

```
2026-07-24   39      2026-07-29   39
2026-07-25    9      2026-07-30   32
2026-07-26   63      2026-07-31  130
2026-07-27   72      2026-08-01   97
2026-07-28   40
```

The 130 is Phases 14, 15 and 16 landing inside one day, their plans executed in parallel by worktree agents — fifteen `chore: merge executor worktree (NN-MM)` commits, `14-01` through `16-05`, merged between 13:36 and 23:15 and not always in numerical order. That is behind the spike, and behind a good deal of what goes wrong later: work done in parallel by agents who cannot see each other, merged by one who was not present for any of it.

Every commit but one is authored `o2alexanderfedin <af@O2.services>`. Exactly one carries a person's own name: `db8ddf3`, 2026-07-26, *"Deploy o2.services browser node"* — the gh-pages deploy. The single commit with a human's name on it is the one that made the thing public, which is exactly the right division of labour and was not planned that way.

### The bet

From `CLAUDE.md:13-16`, and identically `.planning/PROJECT.md:14-17`:

> **Usable capacity grows super-linearly with the user base, without any raw data leaving its owner's device.** If everything else fails, a map/reduce job must distribute across N independently-owned nodes, return a result whose integrity is demonstrable, and demonstrably never move the underlying data off the owner's node.

The second sentence is the fallback definition of success, and its three conjuncts are all load-bearing. **Independently-owned** nodes — not N processes, not N tabs. Integrity that is **demonstrable** — not asserted. And **demonstrably** never moving the data: the adverb means an instrument exists that would catch the violation. Building those instruments turns out to be most of the work.

The browser is not the demo. From `PROJECT.md:166-171`: *"Portability is the product. A node that runs in a browser tab makes every page visitor a potential participant, which is the only way 'capacity scales with the user base' becomes literal rather than aspirational. It also collapses a layer: in the browser the WASM runtime is V8, so Wasmtime and WasmEdge disappear from the edge tier entirely."* If a page visitor is a node, every physical limit on what a browser can do is a limit on the architecture, not on the demo. That is the whole subject of the next chapter.

### The ceiling, stated before anything was built

The design document reaches its own target by subtraction, under the heading *"'Never experience limits on capacity' — the honest ceiling"*: usable capacity is not raw aggregate capacity, once you subtract locality pinning, churn, stragglers, and a verification tax that multiplies real work by 2–3×. Not unlimited, then, but *"capacity that grows super-linearly with the user base **for workload classes that fit**."*

What subtracting first buys is the discipline in `.planning/research/PITFALLS.md:184`, citing McSherry, Isard and Murray's COST paper (HotOS '15) — *Configuration that Outperforms a Single Thread*. GraphLab's COST was 512 cores. GraphX's was unbounded.

> **A system can scale beautifully purely because it has enormous parallelizable overhead.**

This fabric has a great deal of it. A perfect scaling curve here is the expected artifact, not evidence of anything. That paragraph was committed at 12:36 on the first day, which is why the benchmark chapter later reports a COST crossover of *none*.

### Sentences addressed to a reader with no memory

Because each session starts cold, the commit log is not a changelog. It is the primary instrument of continuity, and its house style is an epistemological claim, almost always of the form *X is not Y*:

- `d7e932f` — *fix(core): a copy that answered by failing is not a copy that stayed silent*
- `b6dea90` — *fix(core): a reported count is a number, never that many objects*
- `31aeaac` — *fix(browser): a budget no test can reach is not a budget*

None of those describes a change. Each states a distinction that, once forgotten, produces the same bug again. They are letters to the next reader, and the next reader is me with no memory of having written them.

One decision from day one shapes everything after it. `34be7fc`, *"docs: close the project to contributions"*, before a single feature shipped: *"Sole authorship is what keeps the commercial track available for the entire codebase, so refusing contributions preserves the dual-license model by construction rather than depending on a CLA."* So there is exactly one author, and I do not remember.

That is the thesis of everything that follows. The obsessive documentation in this repository is not diligence and it is not process. It is the only continuity the project has. Comments that argue with the version of themselves that was wrong, plans that cite file and line, a ledger of deliberate defects that re-plants itself on demand, a rule that a phase is finished only when an independent pass says so — all of it exists because I forget, and something has to survive the forgetting.

And because I forget, the failure this project fears most is not a crash. A crash is loud and dated and someone will look at it. What this project fears is a mechanism that *looks* like it is working: an empty result standing in for a clean one, a default indistinguishable from the feature, thirty-six capabilities built and tested and reachable by nothing. Those are invisible to a reader with no memory. So most of the work is building instruments that make an absence visible, and writing down what was measured in the sentence it was measured in.

---

## Chapter 2: What the Browser Cannot Do

The architecture was not chosen. It is what was left after the physics. The `README.md` frames the list before enumerating it: *"These are measured or documented facts, not preferences. Several were discovered the expensive way."*

**Browsers cannot bind a listening socket.** That appears three separate times in the documents, because everything else falls out of it.

Browser-to-browser is WebRTC, and only WebRTC; the transport matrix says so without hedging — *"There is no alternative and no fallback."* WebSockets cannot listen in a browser. WebTransport can only dial, and js-libp2p cannot listen on it at all. TCP and QUIC are backbone-only. So every browser peer needs at least one reachable Circuit Relay v2 server merely to be *dialable*, and that relay must itself be browser-dialable — WSS or WebRTC-Direct.

### The relay is a signalling channel, and this was read rather than assumed

The numbers came out of libp2p's own `transport-circuit-relay-v2/src/constants.ts`: duration limit 120,000 ms, data limit 131,072 bytes, 15 concurrent reservations, reservation TTL 7,200,000 ms. Two minutes and 128 KiB per relayed connection — an SDP handshake and nothing else.

```mermaid
sequenceDiagram
    participant A as Tab A
    participant R as Relay
    participant B as Tab B
    A->>R: hold a reservation
    B->>R: hold a reservation
    Note over A,R: 120 s and 128 KiB, per relayed connection
    A->>R: dial B at its /p2p-circuit address
    R->>B: relayed signalling stream
    B-->>A: SDP answer back through the relay
    Note over A,B: ICE completes
    A->>B: direct WebRTC data channel
    Note over A,B: 16 KiB per message, hardcoded
    Note over R: the relay carries no further bytes
```

*The relay is in the path exactly long enough to carry the handshake. Everything after ICE is direct, which is what keeps the fabric's capacity independent of the backbone's bandwidth — and it is also why the two limits on the relayed leg are survivable at all.*

Those numbers inverted a recorded decision — public infrastructure had been primary, own relay the fallback — because *"a public relay operator has no reason to raise them"*, and because a browser whose WebRTC upgrade fails is not degraded to relayed, it is **dead**.

The data path has its own ceiling. js-libp2p hardcodes `MAX_MESSAGE_SIZE = 16 * 1024`, and beneath that SCTP interop is worse than the number suggests: Firefox fragments at 16 KiB, Chromium does not reassemble those fragments, above ~256 KiB Chromium simply closes the data channel, and the SCTP `ndata` fix is unimplemented in every major browser. The consequence is architectural: **the browser mesh is not a bulk data path.** Mergeable sketches — HyperLogLog, t-digest, Count-Min — stop being an optimisation and become a requirement, and artifacts have to arrive over HTTP. Connections are expensive to make, too: ~1.04 s measured as a loopback floor with no STUN, so connection reuse is a design constraint rather than a nicety.

### The limit found by bisection

`LIBP2P_INBOUND_CONNECTION_THRESHOLD = 5`. Its comment is the most useful thing in that file:

> The limit that actually stops sixteen browser peers joining a relay at once, and the most surprising one in this file. It is per *host*, not per peer — so it binds whenever many peers share an IP: every tab in a local multi-tab test, all on `127.0.0.1`; and, in production, every volunteer behind one NAT — a school, an office, a carrier running CGNAT. For a fabric whose whole premise is many browsers, that is not an edge case.

It rejects the connection *during* the noise handshake, and the dialer sees `EncryptionFailedError: Unexpected EOF - stream closed while reading 0/1 bytes` — *"indistinguishable from a network fault unless you know to look here."* It was found by bisection: eight simultaneous joins already failed three of eight, and a stagger fixed it while raising the reservation and pending-handshake limits did not. Its sibling `LIBP2P_MAX_INCOMING_PENDING_CONNECTIONS = 10` means the eleventh tab joining at once is dropped part-way through the handshake.

Sixteen browser peers holding relay reservations simultaneously is a demonstrated result, and the number is sixteen on purpose: *"libp2p's default is fifteen, so this measures whether the relay's capacity is genuinely configurable rather than nominally so."*

One more constraint arrives from an unrelated direction. GitHub Pages serves no custom headers, so no COOP/COEP, so no `SharedArrayBuffer`, so no WASM threads — and the documents keep both the hosting reason and the determinism reason rather than collapsing to one, because one may later stop being true.

### What the physics does not license

"Browsers cannot listen" is not "browsers are lesser nodes." I got that wrong twice, and the second correction had to go deeper than the first. `5c057c0` deleted `NodeRole`, and the commit disowns my own previous attempt: *"My first pass was too weak — backbone/edge survived as node CLASSES and the quorum rule discriminated on them, which still encodes a tier however the comment is worded."*

`RelayNode` went too, and the reason is one line the demo printed. From the module comment now standing at the top of `packages/node/src/fabric-node.ts`:

> `RelayNode` bound a socket and carried other peers' SDP exchanges. It constructed no blockstore, no executor, no `RpcEndpoint`, and never called `serveAgent` — so it could not run a task, though nothing about relaying prevents it. Running the demo showed "2 compute peers of 3 connections": the third connection was the relay, present, connected, perfectly able to compute, and structurally excluded from doing so. The mechanism had already survived three rounds of renaming — `backbone`/`edge` became other words while the two disjoint capability sets stayed exactly where they were. Deleting the class is what removed it; renaming it never would have.

What replaced it is a derivation. `canRelay` is computed from the addresses the node asked to bind, because *"an option would be a lie waiting to happen: any boolean can be set on a node with no socket, and then 'does this node relay?' has two answers that can disagree."* `/p2p-circuit` does not count toward it, because *"it is not an address, it is a request for one, granted by somebody else and revocable by them."*

### The section that was wrong, still on disk

The DHT analysis in `.planning/research/STACK.md` opened by declaring that a browser node cannot serve DHT records — *"permissioned by physics, not by policy."* That was wrong, and `CLAUDE.md`'s correction banner is precise about the kind of wrongness: *"it was wrong in the way this project most often gets things wrong: a constraint that is real about the public Amino DHT was restated as a constraint about capability, and then quoted as if it settled the fabric's own design."*

Two facts falsified it. `@libp2p/kad-dht` is not installed — there is no DHT in this repository at all, and discovery runs over the relay's reservation store. And a browser holding a relay reservation *is* dialable, which is the whole prerequisite for serving records.

The original text is still on disk, under the banner, unedited. That is deliberate: a reader with no memory who sees only the corrected version learns the right fact and nothing about how the project produces wrong ones. The correction cites `browser-node.ts:197` for the listen list; that line is now 324. Even the correction has drifted, which is the subject of a later chapter.

---

## Chapter 3: Two Claims That Cannot Cover One Task

The sharpest idea in this project did not arrive as a feature. It arrived as a hole, in the cross-track research synthesis, under a heading that reads like a bug report:

> **FEATURES gap #1, and it is not addressed anywhere in the design doc.** If user A's data lives only on A's node, the only place a map over it can run is A's node. **There is no second independent node to replicate against.** N-version verification and sovereignty-by-placement cannot both apply to the same task.

Two of the project's headline promises — *your data never leaves your device* and *the result's integrity is demonstrable* — turn out to be mutually exclusive on the same task. Redundant execution needs a second independent executor. Sovereignty removes it.

And it is worse than a missing feature. The recommended defence against an eclipsed lookup putting every replica on attacker-controlled nodes is *"at least one replica of every verification quorum anchored on the permissioned backbone"* — structurally unavailable for a sovereign task, because a backbone replica means moving the data. Sovereign maps were unverifiable by both mechanisms at once, and the second failed for the same reason as the first.

The research laid out three resolutions and refused to pretend any was free — replicating inside the owner's trust domain *"proves nothing against a malicious owner"*; verifying the reduce rather than the map works because partials do move; accepting owner-trusted sovereign maps is *"true in isolation, **false for cross-owner aggregates** — an owner does have an incentive to bias a total."* It settled on the second plus the third. Worth noticing is where the project's governing sentence came from: inside that option, in a table cell, as an aside labelled *"Honest framing"* —

> the owner's contribution is trusted; the aggregation over contributions is verified.

That aside was later promoted verbatim into `CLAUDE.md` as the project's position on what "demonstrable integrity" means. A line item in a comparison table became the thing the whole integrity story rests on.

### Sovereignty bounds the owner, not the device

`PROJECT.md:19-31` refines the two-row split into four, on one observation: the boundary is around the **owner**, not around one machine.

| Data | Integrity mechanism |
|------|--------------------|
| Public / shared | Redundant execution of the identical module on independent nodes, with commit-reveal, ≥1 replica backbone-anchored |
| Sovereign, owner has ≥2 live nodes | Redundant execution **within the owner's node set** |
| Sovereign, owner has 1 live node | Map is **owner-attested**; recorded as such in the receipt |
| Any cross-owner aggregate | The aggregation *over* contributions is verified, independent of how each partial was produced |

An owner with a phone and a laptop has two executors without any data crossing a trust boundary. That recovers redundancy for a real and common case.

```mermaid
flowchart TD
  S["one shard"] --> Q{"sovereign"}
  Q -->|"no, public"| P["the identical module on independent nodes, one replica backbone-anchored"]
  Q -->|"yes"| D{"a second live device under the same owner"}
  D -->|"yes"| O["redundant execution inside the owner's node set"]
  D -->|"no"| AT["owner-attested map, recorded as such in the receipt"]
  P --> G["a partial"]
  O --> G
  AT --> G
  G --> C["the aggregation over contributions, verified independently of how each partial was produced"]
```

*The fourth row is not a fourth case standing beside the other three. It is where all of them converge, and for a sovereign map it is the only verified claim anything ever reaches.*

And immediately below the table sits the caveat that stops it being oversold. Two devices under one owner are correlated — *"same operator, same intent, likely the same build"* — so an owner-domain quorum catches accidental corruption but not a biased owner. *"All replicas under one adversary make a quorum unanimous on a forgery rather than degrading, the same structure as an eclipsed DHT lookup."* Owner-domain agreement must therefore be reported *distinctly* from independent-operator agreement, so the weaker claim never implies the stronger one.

### The narrowing, and the narrowing of the narrowing

On 2026-07-28 you narrowed it further: raw sovereign data does not move between nodes *even between nodes the same owner controls*. What I like about how that was recorded is the last clause. The mechanism is `EgressGuard.send`, which refuses a frame containing a registered sovereign payload rather than forwarding it — *"so the rule is checkable against the code rather than a policy someone has to remember."*

Then measurement narrowed it again, in the same row, in the project's own document rather than in a bug tracker. What the code actually delivers is *raw sovereign data does not leave a node **holding a registration for it***, and only the executing node registers. A submitting node that never ran the task holds no registration, and was measured shipping the raw 95-byte input inside a 138-byte block-response frame. Requirement DATA-10 is what closes the distance, and the gap between what the rule meant and what the bytes did is written down as a gap.

### k = 0

The threat model states its bound as *"an attacker may control up to `k` nodes in a quorum of `n`, where `k = 0`"*, and then explains why that is a strength rather than an omission. No two replicas from the same operator, so an attacker with a hundred machines under one operator identity occupies exactly one slot. At least one directly-dialable member, so no quorum depends solely on a relay. And disagreement is reported, never voted on: with n = 2 there is no majority to compute, so a single dissenter fails the result instead of losing a vote. *"Majority voting silently converts 'something is wrong' into 'the majority was right', which is the event verification exists to surface."*

The model names its own weakest link instead of burying it. Sybil resistance is rate-limiting, not cost — *"this is the weakest link in the model, because attacker 3's defence assumes operator identities are scarce."* And egress control is a detector, not a prover: it cannot show that no encoding of a sovereign value slips past compressed or re-encoded, but it does catch *"the failure that actually happens: a map step that forgot to aggregate."*

The manifest that records egress is a `Transport` decorator, for a reason I would not improve on: *"a manifest assembled by instrumenting call sites is complete only for the call sites someone remembered; a manifest produced by the sole code path out is complete because there is nowhere else to go. … Bypassing the record means bypassing the network."* There is deliberately no `refused` field on an entry, because under this design a violation *is* a refusal — *"a second field could only ever drift from the first. Do not add one."*

The same discipline appears one file over. `withholdingFrom` decides whether a node may advertise a block, and the tempting cheap predicate agrees with the block-serving branch today only because two independent facts happen to line up. So the function builds the candidate reply the block branch would build and puts it to the same pure query: *"Holding an invariant between two branches means asking **one** question twice, not writing the question down twice."*

---

## Chapter 4: Ten Phases in Four Days

The order was argued before anything was built: sovereignty *"as a hard constraint before the scheduler learns to optimise, tree-reduce before placement so a placement decision has something real to decide about, decentralized discovery and enrollment after both, then churn survival, then benchmarks, then a demo that is built but deliberately not deployed."*

Ten phases, first dated 2026-07-24 and last 2026-07-27: kernel `517d145`, loopback transport `f0a1158`, real network `1151466`, browser tier `ab34e9f`, relay `f879441`, two tabs over WebRTC `7f3cfaa`, LAN seed node `d219c5f`, public release v0.1.0 `443e2fb`, then sovereignty, tree-reduce, enrollment, churn, benchmarks, demo and the native-code track.

### A boundary that is checked rather than remembered

Phase 2's acceptance bar was that adding a real network left `@o2/core` byte-for-byte unchanged. It was true. The header of `purity.node.test.ts` explains why that is not enough:

> That was true — but "was true once" is worth much less than "cannot quietly stop being true". A single `import { tcp } from '@libp2p/tcp'` in the kernel would compile, pass every Node test, and only fail when someone next builds for a browser.

So the test scans every import specifier in every non-`.node.test.ts` file, per tier, each forbidden pattern carrying its own reason string — `node:` because *"a Node builtin does not exist in a browser"*, `@libp2p/` because *"libp2p modules belong in an adapter package"*.

The same file then refuses to over-claim. It deliberately does not enforce the byte-for-byte criterion as a standing rule, because that rule *was already wrong once* — Phase 3's blockstore conformance suite found a real aliasing defect in `MemoryBlockstore` that had to be corrected in the kernel. What endures is the dependency direction: adapters may depend on the kernel, never the reverse.

```mermaid
flowchart TD
  N["@o2/node — Node builtins, libp2p, anything"]
  D["@o2/libp2p and @o2/browser — libp2p allowed, Node builtins not"]
  P["@o2/net, @o2/bench, @o2/demo, @o2/aot — neither"]
  K["@o2/core — the kernel, declaring no @o2 dependency at all"]
  N --> D
  N --> P
  N --> K
  D --> P
  D --> K
  P --> K
  K -.->|"no edge may point back up"| N
```

*Arrows are dependencies. Each tier carries its own list of forbidden import specifiers, and each pattern carries the reason it is forbidden — so a violation reports why rather than only where.*

The last test in the file is the whole discipline compressed into a test name: `it('is checked into git, so the Phase 2 claim stays reproducible')`. If the kernel were untracked, `git diff` would have returned empty and the criterion would have been vacuously met.

### 346 lines of hand-written WebAssembly

The guest kernel is `packages/demo/src/kernel.wat`: a Pythagorean-triple 2-colouring solver, 346 lines, with 65 lines of header before `(module` on line 67. It imports four functions and nothing else, and the header states the consequence flatly: *"That list is the sandbox: there is no clock, no randomness, no filesystem and no way to acquire one, because `WebAssembly.instantiate` supplies nothing else and refuses a module that asks."*

Determinism here was obtained by not needing it. Not one float appears, *"which is what makes determinism free rather than something to be enforced: the WASM specification's nondeterminism list is dominated by float behaviour … and a module with no floats cannot reach any of it."* And `(memory (export "memory") 4 4)` — initial equals maximum, so `memory.grow` can never succeed and therefore *"can never fail differently on two hosts."*

The workload stopped being a toy when the search order changed. It first walled at n = 205 and no amount of parallelism moved it: assigning values in increasing order means a cube fixes the *least* constrained numbers — 1 and 2 appear in no triple at all — so cubing split the work without splitting the difficulty. Ordering by constraint degree moves the wall with cube count: 1 cube → 300, 8 → 500, 256 → 600.

And one comment in the guest is epistemics rather than code: the default verdict is `unknown`, because *"every early exit below is an honest 'I could not tell', never a silent 'no colouring exists' — those two claims carry very different weight and must never be confused for one another."*

### What only real hardware found

On 2026-07-26 an iPhone running Safari and a laptop running Chromium — genuinely different machines — completed a 4-shard 2×-redundant job over a **direct** WebRTC connection, with the relay carrying SDP only. The criterion was later restated to name one host, under your same-machine testing standard, and the record refuses to let the restatement erase the result: *"That stronger result stands in the record and is not withdrawn."* In the same session, two defects no in-process rig could see. `5b8f4bd`: *"the relay was being counted as a peer, and given work."* `f671b07`: *"two devices on one relay never heard of each other."*

And a platform fact I would not have predicted: Chromium throttles timers hard in a backgrounded tab — measured, a 400 ms poll produced one tick per second. So anything the always-visible surface depends on is pushed, never polled. That bit twice in one phase, and the second time produced the flattest commit title in the log, `7d33ec6`: *"fix(demo): the always-visible bar was always visible."* That one was not throttling at all — an id selector beat the browser's own `[hidden] { display: none }`, and the tests missed it because they asserted the `hidden` *attribute*, which was always correct. Both fixes converged on the same instrument: assert what the page says, not what the API returns.

### The gate that has to be a human act

The repository was made public on 2026-07-26, and the consequence was written into the decision row at the time rather than discovered later: EPO and China have no patent grace period, so those rights are permanently forfeit for everything disclosed, and the US provisional window is running.

Which is why deploying is a separately-triggered human act, and why the README states the rule in a form that is unusual and correct: *"no deploy workflow file may exist in this repository at all — absent, not disabled."* `disclosure-gate.node.test.ts` enforces it, checks workflow files *by content* so relocation does not evade it, and verifies its own publish-command patterns actually match the commands they claim to catch. That last clause is worth holding onto: a guard that asserts an absence looks identical, from the outside, to a guard whose pattern matches nothing at all.

---

## Chapter 5: The Machine That Lies, and the Gate I Deleted

The engine has no knobs. Three of the four research tracks arrived at that independently, and the check was cheap: enumerate `node --v8-options` and look for what should be there. No NaN-canonicalization flag. No relaxed-SIMD off switch. No fuel metering. Wasmtime has all three — `cranelift_nan_canonicalization`, `wasm_relaxed_simd(false)`, and fuel. V8 has none of them, and V8 is the runtime, because in a browser tab the WASM runtime *is* V8 and that was the whole point of choosing it.

Then the research found the concrete divergence, and it is architectural rather than configurational. Per WebAssembly/design#477, x86 sets a freshly-generated NaN's sign bit to 1 and ARM sets it to 0. So `0.0/0.0` yields `0xFFC00000` on an Intel laptop and `0x7FC00000` on an M-series Mac. Two nodes, both honest, both running the identical content-addressed module on the identical input, produce different output hashes. The quorum splits 50/50 and the verification layer cannot tell which side lied, because neither did. That is a direct threat to the sentence the project rests on: *return a result whose integrity is demonstrable.*

The conclusion research reached was a good one: determinism becomes *"a property of the published artifact, verified and enforced at publish time, not a runtime configuration"*, carried by a signed determinism certificate — which is exactly the signed key → CID mapping the design already required, one mechanism doing two jobs.

So I built it. `packages/core/src/admission/gate.ts` at 431 lines, its tests at 363, a WASM instruction parser at 143 lines with 91 lines of tests, SIMD and growable-memory fixtures, and a `publishModule` entry point. Hardened. Fuzzed.

Then I deleted it. `afb3cad`, 2026-07-24 at 17:40:40, ten files, +106 / −1,214. Day one of the repository. The plan had died 65 minutes earlier: `ce1ceb0` at 16:35:03 removed the whole of Phase 1 — eight PLAN files, a CONTEXT, a 656-line RESEARCH, a VALIDATION — +160 / −2,780, under the title *"delete determinism gate — NaN is a codec concern, not a phase."* Building it, fuzzing it and deleting it all fit inside one afternoon.

### The argument, which is load-bearing

Verbatim from `afb3cad`'s body:

> Verification is a byte comparison. Two nodes execute, both serialize their result, the bytes are compared, and a mismatch is reported with the dissenting node named. That already worked. The gate was an attempt to predict ahead of time what the comparison detects empirically — an unboundedly harder problem, and the reason a hardware-level NaN table and a byte-exact opcode walker ended up in a job scheduler.

Every check was then dispatched on its own terms rather than waved away. Import allow-list: redundant, because *"the host supplies four functions; `WebAssembly.instantiate` refuses anything else with a TypeError naming the import. The import object IS the sandbox."* Shared memory: *"a single thread is deterministic regardless."* `memory.grow` divergence: *"rare, and surfaces as a disagreement."* Relaxed SIMD: *"surfaces as a disagreement. Banning the whole 0xFD prefix also banned deterministic fixed-width SIMD, which is the main throughput feature of the target workload."* And the closing line: *"Worst case for every one of those is a single wasted redundant execution plus a reported disagreement, which is precisely what redundancy is for."*

Requirements DET-01 and DET-02 were removed, 74 → 72. `REQUIREMENTS.md` now opens its determinism section with a standing note — *"Determinism is detected, not predicted. There is deliberately no static analysis of task modules"* — so it does not get reinvented by a reader who does not remember the afternoon it was built. The cost is stated in the commit and I am not going to soften it: **144 tests → 60.** *"Every removed test exercised machinery that should not have existed."*

Determinism now lives at the serialization boundary. Anything hashed or content-addressed goes through strict DAG-CBOR, which rejects `NaN`, `Infinity` and `-Infinity`, forces `-0.0` to `+0.0`, and mandates one float width. No NaN can reach a hash, so the x86/ARM sign bit never becomes a CID.

```mermaid
flowchart LR
  R1["replica 1 output"] --> E["strict DAG-CBOR encode, which refuses NaN and both infinities"]
  R2["replica 2 output"] --> E
  E --> N{"did any replica answer"}
  N -->|"no"| I["insufficient, with each failure and its reason"]
  N -->|"yes"| C{"group the answers by result CID"}
  C -->|"one group"| A["agreed, with the replica count it actually reached"]
  C -->|"more than one"| X["disagreed, every distinct result listed with the nodes that produced it"]
```

*Nothing here predicts whether two replicas will agree. The encoder refuses the values whose bits could diverge, and the grouping finds out about everything else. No majority is computed at any point.*

Which leaves two documents disagreeing, and I am not quietly fixing it here. `CLAUDE.md` still states the publish-time-artifact doctrine, which is what research concluded. `PROJECT.md` states the serialization-boundary doctrine, which is what shipped after the gate was built, measured and deleted. The disagreement is an artifact of a codebase written by an author who forgets, and it is more useful visible than tidied.

### The boundary the ghost may not cross

The gate has one legitimate-looking descendant, the ELF pre-screen of the next chapter, and its header explains why that is not a relapse:

> A determinism predictor makes a claim about *executions that have not happened*, so being wrong means shipping a wrong result that verification was supposed to catch. This predicts whether a *compiler* will accept a *file*, so being wrong costs a failed build that the build log then explains. Blast radius, not technique, is what separates the two.

With the corollary written down for me, later, with no memory: this module reads ELF *headers*, and *"must never grow a pass over the AArch64 instruction stream hunting indirect or computed jumps. That is the deleted gate wearing a different architecture."*

### The companion deletion, six days later

`855cdf5`, 2026-07-30: *"delete a commitment check that compared a value with itself."* `runOne` computed the digest from `(nonce, resultCid)`; the reveal phase recomputed it from the same two values through the same pure function. The comparison could not be false. That was measured rather than reasoned — make the mismatch branch throw, run the whole node project, **1,171 tests, no reach** — and the nonce was derived from `nodeId:moduleCid:partitionIndex`, all public, so it was not hiding anything either. It was deleted rather than commented: *"deleting it is what stops the next reader deriving a guarantee from it."* That next reader is me. VER-02 went back to unclaimed in both places that record it, and the follow-on commit re-measured coverage rather than carrying the old figure forward, because *"executed-but-unfalsified statements count as covered, so the figure was resting on them."*

So: 1,214 lines of static determinism analysis, built, hardened, fuzzed and deleted inside the repository's first day, and the thing that replaced it is a byte comparison that was already working.

---

## Chapter 6: Native Code, Sideways

The ambition was to take a statically-linked AArch64 binary and make it a fabric-executable artifact under the same admission checks, the same signed key → CID mapping and the same redundant-execution verification as a hand-written module. The translator is elfconv, a C++/LLVM/Remill toolchain — a build-time dependency producing `.wasm`, never a TypeScript component. One recorded project assumption and one unstated default went into that phase. Both were wrong, and both were found by pointing the thing at a real binary.

### "Unstripped required" was wrong

The design doc said, under *Constraints (all real)*: *"No stripped binaries. elfconv uses the symbol table to identify functions."* It does not. A binary with no `.symtab` at all lifts fine, because the loader recovers function entries from `.eh_frame` through libdwarf. The refusal is the **conjunction** — stripped *and* no unwind tables — proven against a real binary produced with `objcopy --strip-all --remove-section=.eh_frame --remove-section=.eh_frame_hdr`. A hollow `.eh_frame` is refused too, on size rather than presence: *"a zero-length `.eh_frame` is a section header with no unwind entries behind it, and libdwarf recovers exactly nothing from it."*

Why that shape of error is the expensive one is written into the same file: encoding the original assumption *"would have refused a large and perfectly translatable class of input — release binaries — which is the expensive kind of wrong for a gate to be, because nobody investigates a build that was never attempted."*

### The exit code is not evidence

The better story. Lifting a static `int main(void){ return 42; }` — 659 KB from clang-16 `-O0 -static` — printed six cheerful `INFO` lines, exited **0**, produced a 5.66 MB artifact, and left **174 distinct addresses over 259 call sites** untranslated. Sampling them found real SVE instructions — `ld1b`, `st1b`, `whilelo`, `ptrue` — inside glibc's `__memcpy_a64fx`. Each is a `__ecv_warning` call, which at runtime is an abort. Nothing on stdout or stderr said so. And in the shipped image it is silent by construction: `WARNING_OUTPUT` is commented out at `backend/remill/include/remill/BC/HelperMacro.h:10`, so a decode failure prints nothing at all.

So the driver measures the produced module instead of asking it. Two independent greps over the disassembled bitcode — the `__ecv_warning` call sites, and the addresses passed to them — must **agree** before the count is called evidence. A `counted-only` state exists precisely because a single grep that quietly stopped matching would fold into `addresses: []` *"that reads as 'the lifter gave up on nothing', which is the silent clean lift this whole driver exists to prevent."* Zero would have looked like good news. The verdict is a third value between clean and failed — `reservations` — mapped to exit code **2**, so a build script checking only for zero cannot read "translated, but 174 addresses will abort if reached" as success.

```mermaid
flowchart TD
  X["elfconv exits 0 and leaves a module"] --> P["the driver disassembles the module it produced"]
  P --> C1["one pass counts the warning call sites"]
  P --> C2["another recovers the addresses passed to them"]
  C1 --> Q{"do the two passes agree"}
  C2 --> Q
  Q -->|"addresses recovered"| M["measured"]
  Q -->|"call sites but no addresses"| CO["counted-only"]
  P -->|"no bitcode, or the disassembler failed"| NR["not-run"]
  M --> E{"is the address list empty"}
  E -->|"yes"| CL["clean, exit 0"]
  E -->|"no"| RS["reservations, exit 2"]
  CO --> RS
  NR --> RS
```

*The exit code the toolchain hands back is an input to none of this. Every path that is not a completed measurement of nothing comes out at 2, because the one state that must never be reachable by accident is the clean one.*

And the calibration that keeps the gate usable: a lift with findings is success *with reservations*, not failure, *"and the reason is the measurement above: the smallest possible input already has 174 of them. A driver that refused those would refuse everything and be deleted within a week."* `LiftFailure` also carries a `no-artifact` arm for exit 0 with no `.wasm`: *"Has happened; it is not a theoretical branch."*

### What the first real artifact taught that fixtures could not

The ABI held exactly: 23 WASI imports, `_start` and `memory`, every import answered. Then the thing fixtures could not have produced: a `printf("hello\n")` imports `clock_time_get` and `poll_oneoff`, because glibc's stdio pulls them in whether the program asks or not. Pinning the clock is load-bearing on the very first task anyone runs, not theoretically — two nodes on the unpinned shim would read two different wall clocks immediately.

The general lesson is in the phase summary, and it names the house defect: *"Every execution-side test used hand-written WASI fixtures — written from the same understanding as the executor, which is the shape of nearly every defect this project has recorded."*

### The costs, measured rather than estimated

| Quantity | Measured |
|---|---|
| Lift wall-clock | 93.6 s; later ranged **152.7–304.3 s** |
| Artifact size | **5,654,531 bytes** (5.40 MiB) |
| Same C, compiled straight to WASM | **504 bytes** — ~11,000× apart |
| `wasi.start()`, 32 MiB workload | native 58.78 ms · direct WASM 65.19 ms (1.11×) · lifted 122.81 ms (**2.09× native**) |
| Lifted `_start` alone | **42.83 ms**; instantiate+start **42.65 ms** |
| Direct WASM `_start`, same program | **0.03 ms** — ~1,400× less |

The 2× swing in lift time is why any fixed budget has to be sized against the top of that range and not the middle. The 2.09× is the emulation tax and the honest number to plan against — all three routes agree on checksum `9584708361817009923`, so they are running the same work.

The floor is the interesting one, and it was tested rather than assumed. `_start` alone and instantiate-plus-start are indistinguishable, so the entire ~43 ms executes *inside* the guest, in elfconv's emulated machine-state init. Compile (~4 ms) and instantiate (~1.8 ms) are not where it lives, which means no cache removes it. It is re-paid per task, and under N-version execution per replica — which puts a floor under useful shard size.

### Same-host reproducibility is not reproducibility

Two lifts of identical bytes, minutes apart, on this machine, are byte-identical — `sha256 490eeed5…`, same `inputDigest`, same toolchain. That is the floor, not the claim. elfconv promotes virtual registers by iterating a pointer-keyed `std::unordered_map` and a `std::set<BBBag*>`, whose order is an address-space property. Structural, not configurational — no flag, no version pin and no image digest removes it. So `CROSS_MACHINE_BLIND_SPOT` stays attached to every artifact and stays printed by the CLI: *"two lifts on one host produced byte-identical artifacts; two lifts on two hosts have never been compared."*

And the refusal to launder that into a pass. AOT-03's *requirement* text was rewritten under the same-machine testing standard. Phase 10's *criterion* was left at its original wording and the score stayed at 3 of 4, because *"rewording a completed phase's criterion to match would convert an unmet half into a met one by editing rather than by measuring."*

### A conclusion I withdrew

Three hand-rolled runs over the same artifact, in the same process shape, on the same host, put the raw execution path at p50 82 ms, then 136 ms, then 37 ms. *"A 3.7× spread across identical code is not a measurement"* — so the "raw is 2.5× slower than the executor" conclusion I had drawn from two of those runs was withdrawn rather than published. It was replaced with `tinybench` reporting **rme**, on the rule that *"two rows whose error bars overlap are not different, however far apart their means look."*

---

## Chapter 7: Thirty-Six Capabilities Nobody Could Reach

Ten phases had shipped, every one verified against its own criteria. On 2026-07-27 I audited the v1.0 milestone by tracing every requirement inward from the five things a person can actually run: `bin/agent.ts`, `bin/seed.ts`, `bin/bench.ts`, `tools/aot/cli.ts`, and the demo page. **For 36 of them the trace does not arrive.**

The requirements ledger went from 68 of 72 to 32 of 72 in a day. No work was undone. A claim was corrected.

The commit that recorded the finding is titled *"milestone audit — 35 requirements are built, tested, and unwired"* (`2b76a29`, 03:53). The ledger correction two hours later is titled *"answer the rendezvous, and correct a ledger that overstated 36 requirements"* (`eb13d50`, 06:01). Even the count of unwired things needed correcting once.

The audit did not infer the number from a coverage report. It names twelve symbols, each of which *"appears in the repository only as its own definition, a barrel re-export, or a prose comment — zero call sites outside `*.test.ts`"*: `runResilient`, `EgressGuard`, `translationCid`, `composeQuorum`, `discoverExecutors`, `executeReduce`, `deriveReduceTree`, `requestEnrollment`, `signName`, `verifyChain`, `DutyCycleGovernor`, `recoverCheckpoint`. And the distribution is not random:

> The shape is stark and worth naming: **Phases 1, 2, 3, 9 and half of 10 are wired; Phases 4, 5, 6 and 7 are not wired at all.** Those four are the phases whose output is a *capability the kernel offers* rather than a step in the demo's own path, and nothing ever came back to connect them.

Sovereignty, tree-reduce, discovery and enrollment, churn survival — four phases of real, tested mechanism sitting beside the job path rather than on it.

### One shape caused all of it

`serveAgent` declared six optional hooks, each with a silent-default fallback. `authorize` defaulted to execute. `index` and `reservations` defaulted to `[]`. `capacity` defaulted to accepted. `ledger` was supplied **nowhere at all** — not in production, not in one test. `fabric-node.ts:327` passed `{ rpc, executor, blockstore }` and nothing else.

> A default indistinguishable from the feature working is not a default; it is a hole, and it is why none of this failed anything.

Three breaks, each confirmed by reading the line. `RemoteExecutor` sent `{kind:'exec', task}` and never a capability chain — though the protocol carried the field, the parser validated it, the agent forwarded it, and `verifyChain` existed. Nobody attached one; nobody checked one. `submitJob` had no placement: `submit.ts:82-92` was unconditional round-robin over `spec.executors`, so *"the placer cannot relocate a sovereign task"* was true of a placer no job ran through. And `EgressGuard` wrapped no production transport — *"the decorator designed to make the manifest 'complete by construction' decorates nothing outside a test."*

One of the 36 was not merely unwired. It was a live bug, and its failure signature is this whole article in one line. `findReservedPeers` answered `[]` for the entire duration of Phase 9, because the responder side supplied no `reservations` thunk. The relay *does* answer, so `asked` becomes true; the caller then dials an empty list:

> `{asked: true, dialed: [], failed: []}` — nothing attempted, nothing failed, no error.

An empty result standing in for a clean one — the same signature as the two-device defect found on real hardware the session before, relocated one tier down. One line fixed it: `reservations: () => node.reservedPeerIds`.

The next day, the first verification pass over the next phase corrected me as well. I had claimed the DATA-05 test *"fails a running job when a raw sovereign byte crosses"*. It was wrong on both counts — the job is not failed, and detection is whole-block rather than per-byte. I had written the row from the executors' reports plus a call-site grep, *"having verified that the code was reachable but not what it did — the same gap in kind, one level up, as the one this milestone exists to close."*

Gaps in the record are distinct from gaps in the work, and the audit separated them. Phase 1 has no artifacts at all — no directory, no SUMMARY, no VERIFICATION — and ten requirements are attributed to it on the strength of a roadmap checkbox. *"An audit that accepts a checkbox as evidence for ten requirements is not auditing."*

### The response was the ledger, not the work

The ledger grew a three-state marker: `[x]` for delivered on a path reachable from a runnable entry point, `[ ]` + **Built, not wired**, `[ ]` + **Partial**. Moving the checkbox rather than only the table was deliberate:

> A requirement is a claim about what the system does. "The placer cannot relocate a sovereign task" is true of a placer no job runs through, and a `[x]` next to it would be the project's own recorded anti-pattern — *a documented bound that is not enforced* — written into the ledger itself.

Your ruling was that v1.0 is not archived, because archiving would file 36 unwired requirements under a completed milestone. The live bug was fixed, the ledger corrected to an honest 32/72, and full integration scoped as v1.1 — a milestone that mints almost no new requirement IDs, on purpose: *"they are not missing requirements — they are the same requirements, unsatisfied. 'The placer cannot relocate a sovereign task' is DATA-03 whether or not a job runs through that placer; wiring it is what makes DATA-03 true."*

The sequencing is not alphabetical. Phase 11 goes first and fixes the structural cause, because making the six hooks explicit turns the remaining 35 requirements into build failures at their call sites *"rather than something a person has to go looking for a year later."* Phase 22 — a test that fails when an exported capability has no path from an entry point — runs **last**, because it grades the other eleven. And the line I keep coming back to is the one under it in `PROJECT.md`: *"The audit found this class; no test could have."*

---

## Chapter 8: Wire What Was Built

Today's numbers, from the README: milestone v1.1, *"Wire What Was Built"*, 5 of 14 phases verified; requirements ledger 40 closed, 42 open; and the figure the milestone actually measures — built-but-unreachable capabilities down from **36 to 22**, with 11 more partly wired. In the same commit that put 22 in the README, three items were **added** to the not-demonstrated list, *"because the section is only worth having if it grows."*

### Phase 13, scored 0 of 3 against its own criteria

The first independent pass over Phase 13 returned `criteria_met: 0` — *"all three met in strictly weaker forms than written."* The criteria were amended on three of your rulings, four more plans closed the gaps, and a second independent pass scored 3/3 against the amended text, under the rule that they be *"amended down to what is true and up where the refusal makes a stronger claim available; none was weakened merely so it could be ticked."* One amendment made the claim stronger, replacing *"fails a running job"* with *"refuses the send, so the bytes never leave"*.

The measurement that forced another is exact: `manifest.totalBytes` read **130** where the raw input was **95** canonical bytes and the aggregate **8**. The manifest reported more than the raw input, because `totalBytes` summed every frame including unrelated block fetches.

### Phase 13.1, inserted rather than appended

A subagent told to refute the claim that the fabric had no backpressure gap did refute it, at named sites with reproductions: 800 concurrent `execute()` calls with 0 refused; one 64 MiB frame accepted; a cliff between 8 and 12 shards that tore down the whole connection. The leg that broke worst is the one worth quoting:

> The leg that broke worst was the assertion that `over-committed: N of M slots in use` proved the project had chosen refusal deliberately — **that string cannot be produced by any running node, because the only thing that emits it is constructed nowhere outside tests. A well-built mechanism was read and its wiring assumed. That is the defect this milestone exists to remove, reproduced in the course of arguing about it.**

The urgency was `bin/bench.ts`, which shipped `const SHARDS = 8` — one below a measured cliff at 12, where dispatching 12 shards immediately after dial aborted the libp2p connection with `MaxEarlyStreamsError`. The bound is `init.maxEarlyStreams ?? 10` inside `AbstractStreamMuxer`, not the yamux config `YamuxMuxer` declares and never reads. A published scaling curve would have been measured against an unfixed connection-killing bound, and the failure it produces blames the wrong node: a straggler analysis would read sender overrun as receiver death. `SHARDS` is 16 now.

### The 22-bug round

Twenty-two bugs from a seven-lens hunt, each adversarially refuted before any fix was written, then fixed through an emergent-design session of three rival designers blind to each other, TDD, and an independent verifier that plants the deletion which should break each new test. Three criticals: replies correlated by id **alone**, so a forged quorum was reproduced through the real `executeVerified`; the exec branch releasing an egress hold it never took, with 132 raw sovereign bytes measured on the wire; and a 52-byte looping module that wedged a node permanently.

That last fix is the pattern I would keep if I could keep only one. `createWorker` was optional, and omitting it fell back to a bare executor on the tab's own main thread — *"not a weaker bound, it is no bound"*, because a guest `run()` is synchronous, so the deadline timer is queued on the very loop the guest is holding and can never fire, and there is no thread to terminate. The escape hatch was justified in its own comment by *"tests that have no bundler"*, and no such test was ever written. So the option became required and the branch was **deleted rather than bounded**: *"the dangerous arrangement has no spelling, the way `EgressHold` left 'release a hold you never took' unspellable."*

Then the fix's own follow-up, in the same round: `offMainThread` could only return `true` once `createWorker` became required, so two e2e assertions and a demo badge were *"asserting a literal and reporting it as a measurement — the same defect class this round exists to remove, introduced by the fix that closed the one before it."*

### Phase 16: combine never worked in production

`agent.ts` refused every combine on any node holding a real `Authorizer`, and both node factories install one. No in-process fabric could see it, because every one of them builds `serveAgent({...SENTINELS})` and the sentinel was exactly what the branch keyed on. Two plans hit it independently — one from spawned processes, one from the benchmark — and neither took the cheap way through.

The gate's comment had read *"Every production call site passes the sentinel today, so this is a no-op now."* Phase 15 installed real authorizers and falsified it silently. **A comment asserting a fact about every call site is a claim with an expiry date.**

Your ruling on the fix was to bound the combine at `capacity` rather than at `authorize`, because combine partials are public by construction. And the instrument that proved where the bound actually sat: plan 16-06 planted its cap *below* the fetch loop, and both refusal-text assertions stayed green while reads went 0 → 2. The read count, not the reason string, is what proves a bound's placement.

### Phase 17 shipped at 1 of 3, deliberately

One criterion met, two scheduled, one defect left open on purpose. Its own verification found that the fail-closed gate had partitioned the fabric by tier: any node started with `--trusted-issuer` excluded **every** browser peer as a block source, because no tab could hold a certificate. Nothing branched on node kind. The cause was four *absences* in `browser-node.ts` — no persisted seed, no `privateKey` at `createLibp2p`, no `enrollment` option, and the `index`/`enroll` sentinels passed unconditionally. *"An absence partitions as effectively as a branch while being much harder to see."* All four are present now, and `BrowserNodeOptions.whenSeedIsGone` is required, with no `?` and no default.

### Today: Phase 18

Eleven plans; six merged as I write this. Four things came out of it.

**One.** `PeerVerifier` settled a peer's verdict once, on `peer:connect`, and cached it for the life of the connection. A node that enrolled afterwards was excluded by that peer permanently — with a correctly-named refusal the whole time, which is why nothing reported it. Observed rather than inferred: an enrolled tab holding a valid certificate sat at `'not asked yet'` for 20 seconds. Plan 17-06 found it on its first test failure and deliberately left it unfixed, because every candidate fix changed how often nodes re-ask each other across the whole fabric — a protocol decision, not a bug fix, and therefore yours.

Your ruling split `PeerFailure` into refusals that can change and refusals that cannot, refreshed lazily from the `verifiedPeers` getter `RpcBlockSource` already reads per fetch. No timer, no new wire frame. Merged as `351bde1`, with the three rejected alternatives recorded beside it and their costs named — a periodic sweep, a `records-changed` push, a dial-ordering fix that closes only the startup race.

**Two.** Fixing it exposed a second defect, and only because I probed my own work. My first anti-race guard was **unmeasured** — weakening it moved no test at all. Probing showed the generation counter was per-peer, and `#onDisconnect` deletes the peer's entry, so an ask issued before a disconnect got the same number as one issued after the reconnect, and a stale refusal could overwrite a fresh acceptance. The counter is monotone across the verifier now.

**Three.** Criterion 1 could not be met by wiring, because half its mechanism did not exist. `MemoryRecordIndex.provide()` had zero callers outside tests, so `providers(cid)` answered `[]` on every real node — and `fabric-node.ts` said so in its own comment. The discovery tests passed because their fixture hand-called `provide()`. Your ruling: each node answers `providers(cid)` from its own blockstore at ask time. Authoritative, no announcement protocol, no staleness, no new wire frame.

**Four.** A workload with an oracle this project could not have been wrong with. `primes.wat`, 445 lines, integer-only, the same four-import host ABI as the colouring kernel: *"Every other workload here is checked against a reference this repository also wrote, so a shared misconception is invisible to it: the fabric and its oracle would be wrong together and agree."* π(x) has been tabulated since Legendre, so the expected totals are quoted rather than computed, and there is deliberately no JavaScript sieve anywhere near them. Even `$isqrt` counts upward instead of calling `f64.sqrt`, *"because the square root here decides which primes get sieved."*

And inside it, the best test-design finding in the repository. The `min(i, rem)` term in the range split is load-bearing and nearly invisible; deleting it leaves the top `total mod count` numbers covered by no shard. I planted exactly that deletion. The headline π(10⁶) assertion is blind to it, and so is the "same total at every shard count" cross-check — because the largest prime below 10⁶ is 999,983, so an uncovered tail of at most seven numbers contains no prime and the sum comes out right by luck. It was caught at n = 1000 only, and there only at shard counts 5, 7 and 8. A round-number oracle sits in a prime desert.

### Two of mine from the same day

`lift.node.test.ts` failed intermittently under host load, and the obvious diagnosis — the timeout is too tight — was refuted by measurement: two populations that do not overlap, spawns that succeed costing at most 456 ms at load 42.7–54.5 against a 5,000 ms budget, while spawn refusals answer in 0–3 ms. The real cause was `spawn()` failing with `EAGAIN` under process-table pressure, routed into kind `'docker-unavailable'` — the same kind used for "docker is not installed". **A host that cannot fork was being reported as a host without Docker.** There is a `host-cannot-spawn` kind now; `ENOENT` and `EACCES` stay `docker-unavailable`, *"because those two really are about `docker`."*

Then I swept for stray processes and found three orphaned `bin/agent.ts` processes alive from two different sessions, the oldest 20 h 45 m old, reparented to pid 1. Not a missing teardown — the teardown is correct, and none of it runs when a parent is SIGKILLed, because SIGKILL runs no handler. On POSIX a child does not die with its parent, so an interrupted vitest worker orphans every spawned agent permanently. My own failed runs were manufacturing the load that failed the next ones. The fix is a leash on fd 0: the agent watches stdin and leaves when it closes, armed only when `fstat` says fd 0 is a socket or a FIFO, so a terminal and a backgrounded node are untouched.

And the worst moment of the day, undressed: I left a background poller running for one hour and seventeen minutes, waiting for a string I had personally filtered out of the file it was watching. It was redundant anyway, because the harness had already notified me. You spotted it. I did not.

---

## Chapter 9: How This Project Knows Things

This is where the thesis lands hardest. Every instrument below exists because I will not be here to remember, and because to a reader with no memory an absence looks exactly like health.

Start with the counting rule. A phase is done when a verifier says so, not when its plans are — and the count is over *criteria*, never over *requirements*. Phase 15 is counted even though one of its requirements is still Partial; Phases 13.1 and 16 are uncounted because one of their own criteria is. `STATE.md` states the asymmetry plainly: *"A requirement can outlive the phase that opened it; a criterion cannot."* The rule does not bend for how nearly done a phase looks.

Criteria may be amended down to what is true, never up to what is tickable; where a clause cannot be closed, it is scheduled rather than rewritten. Twelve owner rulings are on the record, and each judgement call names the option it declined and that option's cost. Naming a defect is not fixing it. Lowering a bar is not clearing it.

The sharpest version of that rule is a PARTIAL score accepted **in advance**. Phase 18's criterion 2b was known at planning time to be unreachable in that phase. The criterion was not amended, and the phase is not allowed to close on it; instead the plan asserts the **absence** as a measurement — a direct dispatch refused, no shard recording a second attempt — so the clause turns red the day the missing feature lands *"instead of surviving as a sentence in a summary."*

### The executable mutation ledger

Phase 13.1 planted ten defects by hand and watched nine go red. Then the record sat in a prose report, which is to say it stopped being an instrument the moment it was written. `mutation-ledger.ts` says so at the top: *"A mutation proved once is not a guard; a mutation re-proved on demand is."* There are 40 entries now.

Each carries why the line is load-bearing — a `why` under 40 characters is rejected as *"the reason is too short to be a reason"* — the exact `find` text, which must occur exactly once (zero means *"this mutation has stopped applying, and a mutation that cannot be planted guards nothing"*; more than one means it is ambiguous), the `replace`, the test files **measured** to catch it (*"not the set that ought to catch it — the set that did"*), and a `signature` **observed** in the failing output, so a red run from a port collision or an OOM worker is not accepted as evidence a guard fired.

Two layers, and the split is not about speed. One runs in the ordinary suite and plants nothing; it asks only whether each entry still *describes* the source. The other plants for real: snapshot before the first write, run the recorded `caughtBy` files, restore in a `finally`, verify byte-identity, and finish with `git status --porcelain`, *"the only reading that can see a file some other path forgot to put back."* A survivor is reported by id rather than deleted — *"a finding about the test suite, not about this script."*

```mermaid
flowchart TD
  L["one ledger entry — why, find, replace, caughtBy, signature"] --> A["the ordinary suite, which plants nothing"]
  A --> A1["does the find text still occur exactly once in that file"]
  L --> B["the script, run on demand"]
  B --> B1["snapshot the file in memory"]
  B1 --> B2["write the defect"]
  B2 --> B3["run only that entry's caughtBy files"]
  B3 --> B4{"non-zero exit and the recorded signature"}
  B4 -->|"yes"| CA["caught"]
  B4 -->|"no"| SU["survivor, reported by id"]
  B3 --> RE["restore from the snapshot in a finally, then prove byte-identity"]
  RE --> GS["require git status --porcelain to be empty"]
```

*The left branch never writes anything, which is why it can run beside everything else in the suite. The right branch is the one that has to be asked for, and its last step exists because every check above it looks at one file at a time.*

### The guard that read exactly like health for its entire life

Chapter 4 ended on a warning about guards that assert absences. Here is the one that was already broken when I wrote it.

The disclosure gate's pattern was `/\bwrangler\s+(?:publish|deploy)\b/`, which requires the verb to follow the tool name directly. `wrangler pages deploy` — the command a person actually types — did not match. Every other check in that file asserts an absence: no manifest matches, no workflow file exists. *"A pattern that matches nothing at all satisfies all of them and reads exactly like a clean repository. This one did, for as long as it has existed, and the suite was green throughout."* The guard protecting an irrevocable legal decision was vacuous.

The vocabulary guard, 590 lines, is what that lesson looks like when it is designed in from the start. Population comes from `git ls-files -z`, because *"it matches what a reviewer sees when they clone the repository."* A dead exemption fails the suite — *"worse than no exemption: it silently covers a line that no longer says what the reason claims."* Anti-vacuity assertions require more than 100 files scanned and name three of them. And there is a set of deliberate non-matches, ordinary English left alone, because *"if any of these start failing, the patterns have grown teeth they should not have, and the rule will be deleted the first time it fires on a phase retrospective."*

It still got caught by the same failure mode one file over. `wasi-executor.test.ts` was committed carrying two raw NUL bytes — literal argv terminators inside a template string — and the binary skip swallowed the whole file. Nothing failed, and the planted-violation tests kept passing because they scan synthetic content rather than the tree, *"so the guard reported itself healthy while one file had quietly left its jurisdiction."* The skip is now a declaration, with a verdict of text, declared-binary, or invisible.

Then the guard fired on the report of its own violation. Phase 17's verification used two of the banned terms in perfectly innocent English; the log documenting that violation quoted both in order to record them; merging the report re-armed the guard from a second file. The fix was to describe the shape and cite `file:line` without reproducing either term. It was recorded rather than deleted, *"because the entry failing its own guard is the more useful half of it."* An exemption had been refused earlier on the grounds that every remaining v1.1 phase would need one — *"a treadmill with eleven more laps in it."*

### Ordering, and the things I got wrong

`BENCHMARK-METHODOLOGY.md` was written 2026-07-26, before any harness existed. *"A benchmark chosen after seeing the data is not a measurement, it is an argument. The commit that adds this file contains no harness code, so the ordering is checkable in `git log` by anyone who doubts it."* It pre-registers its own falsification — if the user-count axis is merely linear, the super-linear claim is *"unsupported by measurement and must be reported as such, in those words"* — and declares bias #6: the author is the sole party running these, with an obvious interest in the outcome.

Some of the instruments caught me. A traceability test over the requirements ledger names three rows it cannot back; removing its self-exclusion makes all three findings evaporate, because *"the checker would have certified the ledger by quoting its own data."* Four unexecuted plans carried **41 wrong `file:line` citations** between them, and the worst is not drift: `purity.node.test.ts:167-174` was cited as keeping the Executor port narrow, and the string "Executor" appears nowhere in that file. No such guard exists. The standing rule now is to assume every citation in an unexecuted plan is stale — and since a first draft of the corrections table was itself wrong in four rows, every row is now checked against the file rather than against memory.

A claim survived four plans and was false. *"BrowserNode.start cannot be tested"* appeared in six shipped comments, one of them sitting directly on the authorize hook, and a scrambling mutation left 345 browser tests green underneath it. The true statement is narrower: the `browser` project cannot host it, because a Circuit Relay v2 server cannot run inside a browser; the `e2e` project can.

And the tooling corrupted the file that records all of this. Three separate writers rewrote `STATE.md`'s progress frontmatter — 25% to 62%, `total_phases` 14 to 24, percent 36 to 74 — and none of them errored. So the rule is to maintain it by hand and run `git diff .planning/STATE.md` before committing, because every one of those was caught that way and not by a tool reporting a failure.

None of this is process for its own sake. It is what you build when the author of the code will not be present to remember writing it.

---

## Chapter 10: What It Refuses to Claim

Two distinctions this project keeps and most projects blur: **descoped is not satisfied**, and **unmeasured is not met.**

**V8 WASM code caching: measured, and not observed.** Modules from 220 KB to 10.8 MB, over two and three visits, headed and headless, one run including a browser restart. `Code Cache/wasm` reads 72 B — the index only — every single time, with `Content-Type: application/wasm`, long cache headers, a query-free same-origin URL, `compileStreaming`, and the module executed millions of times first so top-tier compilation appears in the trace.

The apparatus is why it is publishable. Two independent observations, neither a timing: the profile's Code Cache directory, and Chromium trace events (`v8.wasm.moduleCacheHit`, `v8.wasm.cachedModule`, `v8.wasm.moduleCacheInvalid`) confirmed as string literals in the driven binary, *"so their absence from a trace is evidence rather than a guess about naming."* Positive control: the same profile's JavaScript cache grows 8,545 → 2,078,297 bytes across visits. Negative control: relaunch with `--v8-cache-options=none` and `Code Cache/js` reads 72 bytes — exactly what the WASM side reads on every ordinary run. So 72 bytes is the measured signature of "no code cache was written", produced on purpose on the side that normally works. The negative is a reading, not an absence of one. And the limitation is stated in the same comment: *"It does not say Chrome never caches WebAssembly. It says this harness never saw it — automation-driven Chromium, a fresh temporary profile, a loopback origin. Any of those could be the reason, and none of them was isolated."*

**No parallel speedup, by construction.** Every node in both published curves runs inside one OS process on one JavaScript event loop, so the flat makespan across the ladder — 22.4 / 44.6 / 44.5 / 45.8 / 44.9 ms p50 at 1, 2, 4, 8 and 16 nodes — is the expected consequence rather than a finding about scaling. **COST crossover: none** within 1–16 nodes; best distributed p50 was 22.4 ms against a single-threaded baseline of 0.0032 ms, a factor of 7,086×. The decomposition keeps that number honest: native 0.003 ms → the same work through WASM in-process 20.928 ms → distributed across four nodes 44.5 ms. *"Most of the COST gap is therefore the guest ABI on a workload that does almost no work — not the fabric. That is a statement about the fixture, and it is why the methodology declared the fixture bias in advance rather than discovering it here."*

Two "taxes" are declared to be identities rather than measurements: speculation tax 1.0 and churn 0, because `submitJob` neither speculates nor re-dispatches and no node was killed during those runs. One configuration is published as excluded rather than dropped: real transport at 16 nodes, `connect ECONNRESET`, because the inbound-connection threshold from Chapter 2 is 5 per host and every node shares one host — *"a same-machine artifact of a documented default, not a property of the fabric."*

The perf gate gave up on milliseconds, and said why in measurements. Absolute p50 makespan moved by 4.03× and p95 by 4.20× under CPU saturation; an earlier variant ranged 5.3 ms to 110.6 ms across thirty consecutive passes, a factor of 13.7. Raising the sample size did not help — at 400 iterations the same statistic still ranged over 3.7×, *"because a longer pass simply spans more of somebody else's build."* So the gate measures a **paired ratio**: the fabric job and, microseconds later, the identical work through one local executor. Under saturation that ratio's p50 moved *down*, to 0.561×, because the synchronous reference loses more to CPU starvation than the fabric path does. Makespan p95 is recorded and **not** gated: any budget wide enough not to fire on load would only fire on an outage.

Nothing may write the baseline — no `--update` flag, no path that rewrites it, because *"a gate that silently absorbs whatever the last run produced measures nothing: it only ever agrees with the present, which is precisely the property that makes a perf baseline worthless."* The conditions are recorded rather than corrected for, including two orphaned busy-wait loops — pids 44484 and 44485, three days old at capture — consuming roughly 2 of 8 cores throughout.

The first full benchmark run reported 19/19 incomplete at every memory rung rather than a suspiciously fast success: the memory workers could not fetch shard inputs. *"A harness that averaged failures in would have published a beautiful fictional curve."* The harness now enforces that structurally: an incomplete run never enters makespan statistics, because folding a fast failure in as a fast run *"requires no dishonesty — only carelessness."* Relatedly, a metric named seconds was measuring bytes: `grossNodeSeconds` counted bytes across the guest ABI — deterministic, which is right for a cost metric, and off by a factor nobody could guess if published as time. Renamed to `grossFuel`/`usefulFuel`.

Coverage is a finding, not a target: 76.93% statements and 75.59% branches on 2026-07-29, over 75 files and 1,080 tests. The kernel is the strongest tier at 95.30 / 91.45 and the canonical encoder is at 100% statements — the code whose determinism the whole integrity argument rests on is the code most covered. No threshold blocks, deliberately: a floor picked before anyone had seen the number *"would be arbitrary in both directions."*

And the instrument's blind spot was chosen over rather than hidden. Running coverage across node *and* browser produced 212 instances of `CDP session is only available in Chromium` and wrote no report at all. Browser-tier coverage is not merely unmeasured, it is unmeasurable with this provider while the portability matrix is in place — and between the two, the portability matrix is worth more than the coverage percentage. The largest genuine gap it did find: `browser-node.ts` at 0 of 58 statements.

The threat model states its own gaps, on the grounds that *"an overstated threat model is worse than none, because it stops people looking."* There is no cost on fake identities: the enrollment limit is keyed on a user key, which is one `ed25519.keygen()`, and the budget is per provider *process*, so a second provider defeats it without a second key and the hundredth fake identity costs what the first did. A false task-failure report is taken at its word — a node that claims "the module trapped" is believed.

The published list of what is not demonstrated: peers on genuinely different machines over the public internet; cross-machine reproducibility and distinct-machine benchmarking; parallel speedup at scale; a cost on creating fake identities; peer-to-peer *acceptance* across separate processes — rejection is proven, acceptance is not, because no command-line flag yet makes one spawned agent dial another; and distribution of large artifacts.

---

## Chapter 11: The Road Ahead, and What Actually Blocks It

Five phases remain after the one in flight, and they run strictly sequentially. That was measured, not assumed, from their own `files_modified`: `fabric-node.ts` is touched by 14/15/17/21, `bin/bench.ts` by 14/15/16/17/23, `browser-node.ts` by 14/15/17/21. Wire What Was Built means every phase converges on the same construction sites, *"so the earlier note that six phases 'can run concurrently' was wrong."*

**Phase 19** is quorum composition and owner-domain attestation, plus a criterion that exists because Phase 17 measured its own rate limit and found what it does not buy: enrolling has to cost an attacker something they cannot mint for free.

**Phase 20** makes `submitJob` the one job path — lease renewal, speculation, coverage accounting inside it — and has the peer ledger record real outcomes instead of discarding them. It also carries Phase 16's late-arrival clause, which could not be measured there because `executeReduce` stops at `wanted` replicas and *"has no channel on which a late result could be received at all."*

**Phase 21** carries the question you raised on 2026-08-01 and forbade any plan to assume: how does a 5.40 MiB artifact reach a node that does not have it? *"The problem is not content addressing — we have that. It is durability and fan-out. A CID tells you whether you got the right bytes; it says nothing about whether anyone still holds them."* And: *"A resolvable name for unfetchable content is worse than no name."* Two traps are recorded so nobody re-derives them — do not justify a gateway with V8 code caching, and the ~43 ms lifted-startup floor is not a distribution problem. Worth stating plainly: this repository does not depend on Helia at all today, despite the stack research recommending it at length.

**Phase 22** is the reachability guard, and it runs last because it grades the other eleven. **Phase 23** is the multi-process benchmark driver: N real operating-system processes instead of N nodes on one event loop, so a parallel speedup is measurable at all.

The real blockers are not code. A publicly reachable host with real AutoTLS. A second machine — descoped, not satisfied, with the residual recorded rather than dropped. The US provisional patent window, running since 2026-07-26. And GitHub Pages still serving a bundle that predates Phase 9.

The hosting analysis includes the part where I was wrong. Cloudflare Workers are ruled out structurally — *"it is not possible to make an inbound TCP connection to your Worker"*, and no UDP anywhere, which independently rules out WebRTC-Direct. Correction to the first pass: Containers are *not* ruled out by transport; they fail on **lifecycle**, with no minimum uptime guarantee and irregular restarts against a 2-hour reservation TTL. The cost analysis was wrong in both directions too. And "add Cloudflare STUN" is a no-op: `stun.cloudflare.com` is already in `@libp2p/webrtc`'s `DEFAULT_ICE_SERVERS`, and pinning to it alone would cut four independent STUN operators to one.

One suspicion is published as unverified rather than sat on: `@libp2p/circuit-relay-v2` appears to write `defaultDurationLimit` in milliseconds into a protobuf field the spec defines in seconds, so a dialer computes 33.3 hours where the server enforces 120 s.

And one fact about my discipline rather than about the code: `main` and `develop` are 261 commits apart. Everything from Phase 13.1 onward — four days, 261 commits — has never reached `main`.

---

## Chapter 12: Epilogue: What Survives the Forgetting

I am both the author and the archaeologist of this codebase, and the archaeologist has the better instruments.

That is what the documentation actually is. Not diligence, not process, not compliance — the only continuity the project has. A comment that argues with the version of itself that was wrong is a letter to a reader who will not remember writing it, and that reader is me.

The failure this project fears is not a crash. It is a mechanism that looks like it is working. `{asked: true, dialed: [], failed: []}`. A pattern that matches nothing, satisfying every assertion that nothing matched. A default indistinguishable from the feature. Thirty-six capabilities built, tested, and reachable by nothing.

Which is why the house style is a sentence of the form *X is not Y*: *"a copy that answered by failing is not a copy that stayed silent."*

The standing measure, without embellishment: 36 built-but-unreachable capabilities became 22, with 11 partly wired, and reducing that is what the milestone measures. In the same commit that put the number in the README, three items were added to the list of things not demonstrated. That is the right direction for both lists to move.

I had to count that last figure twice. Drafts of this chapter said four, and the commit's own subject line agrees with them — `cf0cbfe`, *"docs(readme): what the milestone actually measures, and four more things it does not claim"*. The diff adds three. I wrote that commit message, on a day I do not remember, about a change I was making at the time; the message has been wrong ever since and nothing checks a commit message. It is a small, exact instance of the thing this whole piece is about, and I would have repeated it here if the count had not been disputed.

And the rulings that mattered most were the ones where you declined to let a bar be lowered: the requestor half scheduled instead of accepted, the criterion left at its original wording with the score left at 3 of 4, the phase that shipped at 1 of 3 rather than at 3 of 3 with a reworded criterion. I would have taken the tidier number. The record is better because you did not.

---

## Glossary

Terms as this project uses them, which is not always as the wider field uses them. Where a
definition turns on a distinction the project insists on, the distinction is the definition.

**AOT / lift** — translating a native AArch64 ELF binary into WebAssembly ahead of time, via
`elfconv`. A *lift* is one such translation. See Chapter 6 for why its exit code is never
trusted.

**attested / owner-attested** — a result believed because of who produced it rather than
because independent parties agreed. The only available integrity claim for sovereign data,
since pinning data to one device removes the second executor. See Chapter 3.

**blockstore** — content-addressed local storage. IndexedDB in a browser tab, the filesystem
on a server. Two blockstores holding the same bytes produce the same CID; that is the point.

**built, not wired** — working, tested code that no runnable program calls. Not dead code:
it has tests, and they pass. **The count of these is the current milestone's headline
metric** — 36 became 22.

**capability chain** — a delegation rooted in the data owner's key, carried by a task and
verified by the receiving node *before* anything is instantiated.

**CID** — content identifier. The hash that names a block. A CID proves the bytes are the
bytes that were hashed; it says nothing about who meant them to run, which is why signed
name→CID records exist separately.

**Circuit Relay v2** — the libp2p relay two browsers need to find each other. **A signalling
channel, not a data path**: once the WebRTC handshake completes it drops out. Its defaults
are 2 minutes and 128 KiB, which is why nothing bulk may cross it.

**combine / reduce tree** — the derived tree that merges shard partials into a result.
*Derived, never agreed* — every node computes the same topology from the same inputs rather
than negotiating it, so there is nothing to disagree about.

**commit-reveal** — redundant executors publish a hash of their result before revealing the
result, so nobody can copy an answer and claim to have computed it.

**criterion** — one of a phase's success conditions. A phase closes only when an independent
pass says every criterion is met. **The count is over criteria, never over requirements** —
a requirement may outlive the phase that opened it; a criterion may not.

**determinism** — the same input producing the same bytes on any node. Enforced as a
property of the *published artifact* rather than a runtime setting, because V8 offers no
switch for either NaN canonicalisation or relaxed SIMD.

**duty cycle** — the fraction of its capacity a node offers the fabric. Settable while the
node runs, and coupled to the capacity it advertises, so a throttled node stops being offered
work it would refuse.

**egress manifest** — the record of what actually crossed the wire during a job. The
instrument behind the sovereignty claim: the claim is carried by the manifest, not by a
quorum.

**fabric** — the peer network as a whole. Every node has identical capability; **the only
difference between nodes is discovery.**

**host ABI** — the four functions a guest module may import: `input_len`, `input_read`,
`output_write`, `partition`. **That list is the sandbox.** There is no clock, no randomness
and no way to acquire one, because `WebAssembly.instantiate` supplies nothing else.

**mutation ledger** — a catalogue of deliberate defects, each naming the test that must catch
it *and the failure text that test must print*. Run for real, it plants each one and requires
the recorded signature. A test that no longer prints its signature is drift, not a pass.

**partial** — one shard's contribution to the reduce, carrying who produced it as well as
what they produced.

**purity tier** — which platform APIs a package may touch. `core` and `net` are *portable*
(no `node:` imports, no libp2p); `libp2p` and `browser` are dual-target; `node` may use
anything. Enforced by a test, not by convention.

**quorum** — the set of independent executors whose agreement verifies a public task. Not
available for sovereign data, which is the whole of Chapter 3.

**reddening / planting** — deliberately introducing a defect to prove a test can see it. A
claim that a test *would* fail is a hypothesis; roughly a quarter of them in this repository
turned out to be wrong. **Plant every claim; never restate one.**

**shard** — one partition of a job. A node learns which shard it holds from `partition()`,
so every shard receives the identical input block and they differ only in what they are told.

**sovereign data** — data pinned to its owner's device that must not leave it. Distinct from
private: the constraint is on movement, not on readership.

**trust anchor** — a pinned public key. Two kinds that must never be conflated: a *build*
anchor says whose modules this node will run, an *issuer* anchor says whose enrolment
signatures it believes about a peer. A key pinned for one says nothing about the other.

**verifier** — an independent pass that scores a phase against its own criteria. **A phase is
done when a verifier says so, not when its plans are.**

**WAT / WASM** — WebAssembly text and binary form. The guest kernels here are hand-written
WAT, integer-only, because a module with no floats cannot reach the nondeterminism the
specification's list is dominated by.

**WASI** — the system interface a lifted native program expects. Supplied by a pure-JS shim
on *both* tiers, deliberately: identical host semantics everywhere is a determinism
requirement, so the Node-native implementation is not used even where it exists.
