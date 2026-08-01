# Outline — "The Author Forgets"

**Title:** The Author Forgets
**Subtitle:** Building a peer-to-peer compute fabric in nine days, and writing down everything, because next session I am a stranger to my own code

**Length target:** 9,900 words across 12 chapters, in 5 groups.

---

## VOICE — non-negotiable

First person. **"I"** is the AI agent that wrote the code, planned the phases, dispatched
the subagents, and got things wrong. **"You"** is the human owner: the person who set
direction, made the rulings, and kept declining to let a bar be lowered. Address them
directly, as a colleague.

Never "the user". Never "the assistant" or "the AI" about myself. Never "we" for "I".

Register: clear, concrete, confident. Short paragraphs. Specifics over adjectives. Never a
superlative where a measurement would do.

Errors reported plainly in one or two sentences, then move on. **No grovelling, no
moralising, no dwelling.** Successes reported in the same flat register. "I planted the
mutation and it survived, which meant the test could not see it" is the right tone for
both.

Humour: dry, understated, roughly one landing per chapter. It must come from genuine
absurdity in the facts. No exclamation marks, no emoji, no winking at the reader, never at
the project's or the owner's expense.

---

## THESIS (one paragraph — every chapter must be able to point back to it)

I wrote this codebase and I remember almost none of it. Context ends; the next session
opens the repository like a stranger reading someone else's work. So the project's
obsessive documentation is not diligence for its own sake — **it is the only continuity
there is.** Comments that argue with the version of themselves that was wrong, plans that
cite file and line, a ledger of deliberate defects that re-plants itself on demand, a rule
that a phase is finished only when an independent pass says so: these exist because the
author forgets, and something has to survive the forgetting. And because the author
forgets, the failure this project fears most is not a crash. It is a mechanism that *looks*
like it is working — an empty result standing in for a clean one, a default indistinguishable
from the feature, thirty-six capabilities built and tested and reachable by nothing. Those
are invisible to a reader with no memory. So the work is to build instruments that make an
absence visible, and to write down what was measured, in the sentence it was measured in.

---

# GROUP 1 — The bet, and the physics

## Chapter 1 — I Do Not Remember Writing This (≈1,000 words)

**Sources:** research-git.md §1, research-design.md §1, PROJECT.md, docs/p2p-native-cloud-design.md, CLAUDE.md

Beats:

- Open on the numbers and the strangeness: 504 commits reachable from HEAD, 511 across all
  refs, 100 merges, 457 tracked files, 253 TypeScript files — over **nine calendar days**,
  2026-07-24 to 2026-08-01. I wrote nearly all of them and I remember almost none.
- The commits-per-day shape, because it is the shape of the burn: 39, 9, 63, 72, 40, 39,
  32, **130**, 90. The 130 is phases 14/15/16 executed through parallel worktree agents.
- Authorship: 512 commits by `o2alexanderfedin`, exactly one by `Alexander Fedin
  <alex_fedin@hotmail.com>` — `db8ddf3`, "Deploy o2.services browser node", the gh-pages
  deploy. The one commit a human's own name is on is the one that made the thing public.
- The bet, verbatim: *"Usable capacity grows super-linearly with the user base, without any
  raw data leaving its owner's device."* Plus the fallback definition of success with its
  three conjuncts — distribute across N **independently-owned** nodes; return a result whose
  integrity is **demonstrable**; **demonstrably** never move the data.
- Why the browser is the product, not the demo (`PROJECT.md:166-171`): *"Portability is the
  product."* Every page visitor is a potential participant, which is the only way "capacity
  scales with the user base" is literal rather than aspirational. And it collapses a layer:
  in the browser the WASM runtime *is* V8, so Wasmtime and WasmEdge disappear from the edge
  tier entirely.
- The honest ceiling, stated by subtraction before anything was built: locality pinning,
  churn, stragglers, bottleneck migration, heterogeneity, and a verification tax of 2–3×.
  Reframe: not *unlimited*, but capacity that grows super-linearly **for workload classes
  that fit**.
- The discipline that the ceiling buys: McSherry's COST (HotOS '15). GraphLab's COST was 512
  cores; GraphX's was unbounded. *"A system can scale beautifully purely because it has
  enormous parallelizable overhead."* A fabric with content addressing, capability
  verification, WebRTC framing at 16 KiB and 2–3× redundancy has a lot of it. Perfect
  scaling curves are the expected artifact, not evidence of value.
- The archaeology: each session I read the repository like a stranger's. The commit-message
  house style is therefore not a changelog, it is an epistemological claim, almost always of
  the form *X is not Y* — `d7e932f` "a copy that answered by failing is not a copy that
  stayed silent"; `b6dea90` "a reported count is a number, never that many objects";
  `31aeaac` "a budget no test can reach is not a budget". Those sentences are addressed to
  the next reader, and the next reader is me with no memory.
- Day-one decision that shapes everything: `34be7fc`, the project closed itself to
  contributions before a feature shipped. *"Sole authorship is what keeps the commercial
  track available for the entire codebase, so refusing contributions preserves the
  dual-license model by construction rather than depending on a CLA."*
- Land the thesis here, in full, in my own voice.

## Chapter 2 — What the Browser Cannot Do (≈900 words)

**Sources:** research-design.md §3, CLAUDE.md transport matrix, packages/libp2p/src/constants.ts, packages/node/src/fabric-node.ts, research-results.md §5.4

Beats:

- The architecture was not chosen. It was what remained after the physics.
- Browsers cannot bind a listening socket. Stated three separate ways in three documents,
  because it is the fact everything else falls out of.
- The transport reality matrix: **browser-to-browser is WebRTC, and only WebRTC.** There is
  no alternative and no fallback. Every browser peer needs a reachable Circuit Relay v2 peer
  to be dialable at all, and that relay must itself be browser-dialable — WSS or
  WebRTC-Direct.
- The relay is a signalling channel, not a data path, and this was read out of source rather
  than assumed: `DEFAULT_DURATION_LIMIT` 2 minutes, `DEFAULT_DATA_LIMIT` 128 KiB,
  `DEFAULT_MAX_RESERVATION_STORE_SIZE` 15, TTL 2 hours. Enough for an SDP handshake and
  nothing else. This **inverted** a recorded decision: own AutoTLS relays became primary,
  public infra opportunistic redundancy, because a public relay operator has no reason to
  raise those limits and a browser whose WebRTC upgrade fails is dead, not degraded.
- The data-path ceiling: 16 KiB max message, hardcoded in js-libp2p; Chromium closes the
  channel above ~256 KiB; Chromium does not reassemble Firefox's fragments; the SCTP `ndata`
  fix is unimplemented in every major browser. Consequence: **the browser mesh is not a bulk
  data path.** Mergeable sketches (HLL, t-digest, Count-Min) stop being an optimisation and
  become an architectural requirement, and artifacts must arrive over HTTP.
- The handshake floor: ~1.04 s measured on loopback with no STUN. Connection reuse is
  therefore a design constraint, not a nicety.
- The limit that was found by bisection, not by reading docs:
  `INBOUND_CONNECTION_THRESHOLD = 5`, and it is per **host**, not per peer. Eight
  simultaneous joins already failed three of eight; a stagger fixed it while raising the
  reservation and pending-handshake limits did not. The symptom is
  `EncryptionFailedError: Unexpected EOF - stream closed while reading 0/1 bytes` —
  indistinguishable from a network fault unless you know to look. For a fabric whose entire
  premise is many browsers, and whose volunteers sit behind school, office and CGNAT NATs,
  that is not an edge case. Sibling constant: 10 pending connections, so the eleventh tab
  joining at once is dropped mid-handshake.
- 16 browser peers holding relay reservations simultaneously is a demonstrated result, and
  the number is 16 precisely because libp2p's default is 15.
- GitHub Pages serves no custom headers, so no COOP/COEP, so no `SharedArrayBuffer`, so no
  WASM threads. A hosting constraint and a determinism constraint independently forbid the
  same feature, and the docs keep both reasons rather than collapsing to one.
- **The conclusion the physics does *not* license, and the correction that cost the most.**
  "Browsers cannot listen" is not "browsers are lesser nodes." `NodeRole` was deleted
  (`5c057c0`) after a first attempt that the commit itself disowns as too weak. `RelayNode`
  was deleted too — and the reason is a screenshot: the demo reported *"2 compute peers of 3
  connections"*, and the third connection was the relay, present, connected, perfectly able
  to compute, and structurally excluded from doing so. The mechanism had survived three
  rounds of renaming while the two disjoint capability sets stayed exactly where they were.
  Deleting the class removed it; renaming never would have.
- What replaced it: `canRelay` is **derived** from the addresses the node asked to bind, not
  configured. *"An option would be a lie waiting to happen: any boolean can be set on a node
  with no socket, and then 'does this node relay?' has two answers that can disagree."* And
  `/p2p-circuit` does not count, because it is not an address, it is a request for one,
  granted by somebody else and revocable by them.
- The DHT section that was wrong, and how it was wrong: a constraint that is real about the
  *public Amino* DHT was restated as a constraint about *capability* and then quoted as if
  it settled the fabric's own design. Two facts falsified it — `@libp2p/kad-dht` is not
  installed at all, and `browser-node.ts:197` listens on `['/p2p-circuit', '/webrtc']`, so a
  browser holding a reservation is dialable. The original wrong text is still on disk in
  `STACK.md` under a correction banner. Leaving the wrong claim visible is the point.

---

# GROUP 2 — What the project promises, and the first ten phases

## Chapter 3 — Two Claims That Cannot Cover One Task (≈950 words)

**Sources:** research-design.md §2, .planning/research/SUMMARY.md C3, PROJECT.md:19-47, THREAT-MODEL.md, packages/net/src/egress.ts, packages/net/src/sovereign-egress.ts

Beats:

- The sharpest idea in the corpus, and it arrived as a *gap*: research correction C3.
  If user A's data lives only on A's node, the only place a map over it can run is A's node.
  **There is no second independent node to replicate against.** N-version verification and
  sovereignty-by-placement cannot both apply to the same task.
- And it is worse than a missing feature. The recommended defence against an eclipsed lookup
  inverting a quorum is *"at least one replica anchored on the permissioned backbone"* —
  which is structurally unavailable for a sovereign task, because a backbone replica means
  moving the data. Sovereign maps were unverifiable by *both* mechanisms at once.
- The three candidate resolutions, with their costs: (a) replicate within the owner's trust
  domain — cleanest, needs multi-device identity in the MVP, proves nothing against a
  malicious owner; (b) verify the reduce, not the map — partials *do* move, the aggregation
  tree *is* replicable and backbone-anchorable; (c) accept owner-trusted sovereign maps —
  true in isolation, false for cross-owner aggregates, because an owner *does* have an
  incentive to bias a total.
- The sentence that became the project's position was written inside option (b) as *"Honest
  framing"* and later promoted to the project statement: **the owner's contribution is
  trusted; the aggregation over contributions is verified.**
- The refined four-row table: sovereignty bounds the **owner**, not the device. Public data
  gets full redundant execution with commit-reveal. Sovereign with ≥2 live owner nodes gets
  redundancy inside the trust domain. Sovereign with one node is owner-attested and *recorded
  as such in the receipt*. Any cross-owner aggregate is verified independent of how each
  partial was produced.
- Immediately followed by the caveat that keeps the refinement honest: two devices under one
  owner are correlated — same operator, same intent, likely the same build. An owner-domain
  quorum catches accidental corruption but not a biased owner. All replicas under one
  adversary make a quorum **unanimous on a forgery rather than degrading**, the same
  structure as an eclipsed lookup. Owner-domain agreement must be reported distinctly from
  independent-operator agreement so the stronger claim is never implied by the weaker one.
- And: backbone encrypted replicas are **availability-only**. Executing a map requires
  decryption, so a backbone node running a sovereign task would see plaintext, reintroducing
  exactly the exposure sovereignty prevents.
- Your narrowing, 2026-07-28: raw sovereign data does not move between nodes **even between
  nodes the same owner controls**. The mechanism is `EgressGuard.send`, which refuses a frame
  containing a registered sovereign payload rather than forwarding it — *"so the rule is
  checkable against the code rather than a policy someone has to remember."*
- And the measurement that narrowed it again, in the project's own document rather than in
  a bug tracker: what the code actually delivers is *raw sovereign data does not leave a node
  holding a registration for it*, and only the **executing** node registers. A submitting
  node that never ran the task holds no registration, and was measured shipping the raw
  95-byte input inside a 138-byte block-response frame. DATA-10 is the distance between the
  intent and the code, and it is written down as such.
- The threat model's bound: **k = 0**. Not a typo, and stronger than it sounds. No two
  replicas from the same operator, so an attacker with a hundred machines under one operator
  identity occupies exactly one slot. At least one directly-dialable member. And
  **disagreement is reported, never voted on** — with n=2 there is no majority to compute, so
  a single dissenter fails the result rather than losing a vote. Majority voting silently
  converts "something is wrong" into "the majority was right", which is the event
  verification exists to surface.
- The model names its own weakest link rather than burying it: sybil resistance is
  rate-limiting, not cost. And egress control is *a detector, not a prover* — it cannot prove
  no encoding of a sovereign value slips past, compressed or re-encoded; it catches the
  failure that actually happens, a map step that forgot to aggregate.
- The manifest is a `Transport` decorator, complete by construction: *"a manifest assembled
  by instrumenting call sites is complete only for the call sites someone remembered; a
  manifest produced by the sole code path out is complete because there is nowhere else to
  go. Bypassing the record means bypassing the network."* And there is deliberately **no**
  `refused` field, because under this design a violation *is* a refusal and a second field
  could only ever drift from the first.

## Chapter 4 — Ten Phases in Four Days (≈950 words)

**Sources:** research-git.md §1, research-planning.md §2, research-code.md §1-2, research-results.md §5.9-5.10

Beats:

- The sequence, and the reason for the order: *"sovereignty as a hard constraint before the
  scheduler learns to optimise, tree-reduce before placement so a placement decision has
  something real to decide about, decentralized discovery and enrollment after both, then
  churn survival, then benchmarks, then a demo that is built but deliberately not deployed."*
- The shas as a spine: kernel `517d145`, loopback `f0a1158`, real network `1151466`, browser
  tier + IndexedDB `ab34e9f`, backbone relay `f879441`, two tabs over real WebRTC `7f3cfaa`,
  LAN seed node `d219c5f`, public release **v0.1.0** `443e2fb`, then sovereignty, tree-reduce,
  enrollment, churn, benchmarks, demo, elfconv.
- The kernel boundary, checked rather than remembered. Phase 2's acceptance bar was that
  adding a real network left `@o2/core` byte-for-byte unchanged. It was true — *"but 'was
  true once' is worth much less than 'cannot quietly stop being true'. A single `import { tcp
  } from '@libp2p/tcp'` in the kernel would compile, pass every Node test, and only fail when
  someone next builds for a browser."* So `purity.node.test.ts` scans every import specifier
  in every non-`.node.test.ts` file, per tier, each forbidden pattern carrying its reason
  string.
- And the same test refuses to over-claim: it deliberately does **not** enforce the
  byte-for-byte criterion as a standing rule, because that rule was already wrong once —
  Phase 3's blockstore conformance suite found a real aliasing defect in `MemoryBlockstore`
  that had to be fixed in the kernel. What endures is the dependency direction: adapters may
  depend on the kernel, never the reverse.
- The vacuity closer, which is the whole discipline in one test name: *"is checked into git,
  so the Phase 2 claim stays reproducible."* If the kernel were untracked, `git diff` would
  have returned empty and the criterion would have been vacuously met.
- The guest kernel is 346 lines of hand-written WebAssembly text with a 65-line header before
  the first `(module`. Four imports and nothing else: *"That list **is** the sandbox: there is
  no clock, no randomness, no filesystem and no way to acquire one, because
  `WebAssembly.instantiate` supplies nothing else and refuses a module that asks."*
- Determinism obtained by not needing it: not one float appears, *"which is what makes
  determinism free rather than something to be enforced — the WASM specification's
  nondeterminism list is dominated by float behaviour, and a module with no floats cannot
  reach any of it."* And `(memory 4 4)` — initial === maximum, so `memory.grow` can never
  succeed and therefore can never fail *differently* on two hosts.
- The fixed 1034-byte output frame, whatever `n` is, and the reason the status is a one-byte
  *byte string* rather than a CBOR integer: integers below 24 must pack into the type byte,
  so `18 00` for zero is non-minimal and strict DAG-CBOR would refuse it. One encoding
  regardless of value means no branch to get wrong.
- The colouring search finding, which is where the workload stopped being a toy: the search
  first walled at **n = 205** and **no parallelism moved it**, because assigning values in
  increasing order means a cube fixes the *least* constrained numbers — 1 and 2 appear in no
  triple at all — so cubing split the work without splitting the difficulty. Ordering by
  constraint degree moves the wall with cube count: 1 cube → 300, 8 → 500, 256 → 600.
- The epistemics baked into the guest: the default verdict is *unknown*, because *"every
  early exit is an honest 'I could not tell', never a silent 'no colouring exists' — those
  two claims carry very different weight."*
- What only real hardware found: an iPhone running Safari and a laptop running Chromium
  completing a 4-shard 2×-redundant job over a **direct** WebRTC connection with the relay
  carrying SDP only. And in the same session, two defects no in-process rig could see —
  `5b8f4bd` the relay was being counted as a peer and given work, and `f671b07` two devices
  on one relay never heard of each other.
- Chromium throttles timers hard in a backgrounded tab: a **400 ms poll produced one tick per
  second**. So anything the always-visible surface depends on is pushed, never polled. That
  bit twice in one phase, and produced the flattest commit title in the log: *"fix(demo): the
  always-visible bar was always visible."*
- The repository was made public on 2026-07-26, with the consequence stated in the decision
  row rather than discovered later: EPO and China rights permanently forfeit, the US
  provisional window running. Which is why deploying is a separately-triggered human act and
  no deploy workflow file may exist in the repository **at all** — absent, not disabled.

---

# GROUP 3 — Determinism, and native code

## Chapter 5 — The Machine That Lies, and the Gate I Deleted (≈1,000 words)

**Sources:** research-design.md §4, research-git.md §3a/3b/3d, packages/core/src/executor/wasm.ts, packages/aot/src/elf.ts:32-46, PROJECT.md:198-201

Beats:

- The wall three of four research tracks hit independently: **V8 offers zero determinism
  knobs.** Verified by enumerating `node --v8-options` — no NaN-canonicalization flag, no
  relaxed-SIMD off switch, no fuel metering. Wasmtime has all three. V8 has none.
- The concrete divergence, and it is architectural: per WebAssembly/design#477, **x86 sets a
  freshly-generated NaN's sign bit to 1 and ARM sets it to 0**, so `0.0/0.0` is `0xFFC00000`
  on an Intel laptop and `0x7FC00000` on an M-series Mac. Two *honest* nodes produce
  different output hashes, the quorum splits 50/50, and the verification layer cannot tell
  which side lied. That directly threatens the sentence the whole project rests on.
- The conclusion research reached, and it was a good one: determinism becomes a property of
  the **published artifact at publish time**, carried by a signed determinism certificate —
  which is the same signed `key → CID` mapping the design already required, one mechanism
  doing two jobs. *"This should be an explicit roadmap phase, not an implementation detail."*
- So I built it. An admission gate: 431 lines of gate, 363 lines of spec, a 143-line WASM
  instruction parser and its 91-line spec, SIMD and growable-memory fixtures, `publishModule`.
  Hardened. Fuzzed.
- Then I deleted it. `afb3cad`, 2026-07-24 at 17:40, ten files, **+106 / −1,214**. On day one
  of the repository. And the plan died 65 minutes before the code did: `ce1ceb0` at 16:35
  deleted the whole of Phase 1 — eight PLAN files, a CONTEXT, a 656-line RESEARCH, a
  VALIDATION — **+160 / −2,780**. Building it, fuzzing it and deleting it all fit inside one
  afternoon.
- The argument, verbatim and load-bearing: *"Verification is a byte comparison... The gate was
  an attempt to predict ahead of time what the comparison detects empirically — an unboundedly
  harder problem, and the reason a hardware-level NaN table and a byte-exact opcode walker
  ended up in a job scheduler."*
- Each check dispatched on its own terms, not waved away. Import allow-list: redundant,
  because `WebAssembly.instantiate` refuses anything outside the four supplied functions and
  names the offending import — **the import object IS the sandbox**. Shared memory: a single
  thread is deterministic regardless. Atomics: require shared memory to matter, already moot.
  `memory.grow` divergence: rare, and surfaces as a disagreement. Start section: degrades to
  "module produced no output", already reported. Relaxed SIMD: surfaces as a disagreement —
  and banning the whole `0xFD` prefix also banned deterministic fixed-width SIMD, which is
  the main throughput feature of the target workload. Worst case for every one of them is one
  wasted redundant execution plus a reported disagreement, *"which is precisely what
  redundancy is for."*
- The cost, stated in the commit: **144 tests → 60.** *"Every removed test exercised machinery
  that should not have existed."*
- Where determinism actually lives now: the serialization boundary. Strict DAG-CBOR rejects
  NaN/Infinity/-Infinity, normalizes `-0.0` and mandates one float width, so no NaN can be
  hashed or content-addressed. Protobuf bytes are never hashed — its own docs state
  serialization is not canonical across languages, builds or schema versions.
- **The two documents still disagree, and I am not going to quietly fix it here.**
  `CLAUDE.md` states the publish-time-artifact doctrine, which is what research concluded.
  `PROJECT.md` states the serialization-boundary doctrine, which is what shipped after the
  gate was built, measured and deleted. That disagreement is itself an artifact of a codebase
  written by an author who forgets, and it is more useful visible than tidied.
- The boundary the ghost is forbidden to cross, written into `elf.ts` so it does not get
  reinvented: a determinism predictor makes a claim about *executions that have not
  happened*, so being wrong means shipping a wrong result verification was supposed to catch.
  The ELF pre-screen predicts whether a *compiler* will accept a *file*, so being wrong costs
  a failed build the log then explains. **"Blast radius, not technique, is what separates the
  two."** And the corollary: this module reads ELF *headers* and must never grow a pass over
  the AArch64 instruction stream — *"that is the deleted gate wearing a different
  architecture."*
- The companion deletion, six days later. `855cdf5` removed a commit-reveal check that
  compared a value with itself: `runOne` computed the digest from `(nonce, resultCid)` and the
  reveal phase recomputed it from the same two values through the same pure function. **The
  comparison could not be false.** Measured by making the mismatch branch throw and running
  the whole node project: 1,171 tests, no reach. And the nonce was derived from
  `nodeId:moduleCid:partitionIndex` — all public — so it was not hiding anything either.
  VER-02 went back to unclaimed in both places that record it.
- Why deletion rather than a comment: *"a real two-round ceremony needs a wire message, a
  cross-node barrier and a hiding commitment, none of which this shape could grow into.
  **Deleting it is what stops the next reader deriving a guarantee from it.**"* That next
  reader is me. Follow-on commit re-measured coverage rather than assuming, because
  "executed-but-unfalsified statements count as covered, so the figure was resting on them."

## Chapter 6 — Native Code, Sideways (≈900 words)

**Sources:** research-design.md §6.2-6.4, research-results.md §4, tools/aot/lift.ts, tools/aot/scan.ts, packages/aot/src/elf.ts, phase-10 artifacts

Beats:

- The ambition: a statically-linked AArch64 binary becomes a fabric-executable artifact under
  the same admission checks and the same verification as a hand-written module. elfconv is a
  C++/LLVM/Remill toolchain — a build-time dependency producing `.wasm`, not a TypeScript
  component.
- **Recorded assumption #1 was wrong: "unstripped required."** A binary with no `.symtab` at
  all lifts fine, because the loader recovers function entries from `.eh_frame` through
  libdwarf. The refusal is the *conjunction* — stripped **and** no unwind tables. And a hollow
  `.eh_frame` is refused too, on size rather than presence, because *"a zero-length
  `.eh_frame` is a section header with no unwind entries behind it, and libdwarf recovers
  exactly nothing from it."*
- Why that shape of error is the expensive one: encoding the original assumption *"would have
  refused a large and perfectly translatable class of input — release binaries — which is the
  expensive kind of wrong for a gate to be, because nobody investigates a build that was never
  attempted."*
- **Recorded assumption #2, and the better story: elfconv's exit code is not evidence.**
  Lifting a static `int main(void){ return 42; }` — 659 KB from clang-16 `-O0 -static` —
  printed six cheerful `INFO` lines, exited **0**, produced a 5.66 MB artifact, and left
  **174 distinct addresses over 259 call sites** untranslated. Every sampled one was a real
  SVE instruction — `ld1b`, `st1b`, `whilelo`, `ptrue` — inside glibc's `__memcpy_a64fx`.
  Each is a `__ecv_warning` call, which at runtime is an abort. Nothing on stdout or stderr
  said so.
- And it is silent by construction in the shipped image: `WARNING_OUTPUT` is commented out at
  `backend/remill/include/remill/BC/HelperMacro.h:10`, so a decode failure prints nothing at
  all.
- So the driver measures the produced module instead of asking it. Two independent greps —
  the abort call sites and the recovered addresses — must **agree** before the count is called
  evidence, and a `counted-only` state exists precisely because a single grep that quietly
  stopped matching *"would report zero and look like good news."* The verdict is a third
  value, `reservations`, mapped to exit code **2**, so a build script checking only for zero
  cannot read "translated, but 174 addresses will abort if reached" as success.
- And the calibration that keeps the gate usable: a lift with findings is **success with
  reservations**, not failure — *"the smallest possible input already has 174 of them. A
  driver that refused those would refuse everything and be deleted within a week."*
  `LiftFailure` also carries a `no-artifact` arm for exit 0 with no `.wasm`: *"Has happened;
  it is not a theoretical branch."*
- What the first real artifact taught that fixtures could not. The ABI held exactly: 23 WASI
  imports, `_start` and `memory`, every import answered. And a `printf("hello\n")` imports
  `clock_time_get` and `poll_oneoff`, because glibc's stdio pulls them in whether the program
  asks or not — so **pinning the clock is load-bearing on the very first task anyone runs**,
  not theoretically. The general lesson, stated in the phase's own summary: *"Every
  execution-side test used hand-written WASI fixtures, written from the same understanding as
  the executor — the shape of nearly every defect this project has recorded."*
- The costs, measured rather than estimated. Lift: 93.6 s, later measured over a
  152.7–304.3 s range — a 2× swing with load, so any fixed budget must be sized against the
  top of that range and not the middle. Size: 5,654,531 bytes against **504 bytes** for the
  same four lines of C compiled straight to WASM — the same program, roughly 11,000× apart.
  Speed, on a 32 MiB workload all three routes agree on (checksum `9584708361817009923`):
  native 58.78 ms, direct-compiled WASM 65.19 ms (1.11×), lifted WASM 122.81 ms — **2.09×
  native**. That is the emulation tax and it is the honest number to plan against.
- The floor that cannot be cached away, tested rather than assumed: the lifted `_start` alone
  is 42.83 ms and instantiate-plus-start is 42.65 ms — indistinguishable, so the entire floor
  executes **inside the guest**, in elfconv's emulated machine-state init, and is re-paid per
  task. Direct WASM's `_start` for the same program is 0.03 ms, about 1,400× less. Under
  N-version execution it is paid per replica, which puts a floor under useful shard size.
- Same-host reproducibility is not reproducibility. Two lifts of identical bytes ten minutes
  apart are byte-identical (`sha256 490eeed5…`) — that is the floor, not the claim. elfconv
  promotes virtual registers by iterating a pointer-keyed `std::unordered_map` and a
  `std::set<BBBag*>`, whose order is an address-space property. **Structural, not
  configurational**: no flag, no version pin and no image digest removes it. So
  `CROSS_MACHINE_BLIND_SPOT` stays attached to every artifact and stays printed by the CLI.
- And the refusal to launder it into a pass: AOT-03's *requirement* text was rewritten under
  the same-machine testing standard, but Phase 10's *criterion* was left at its original
  wording and the score stayed at 3 of 4, because *"rewording a completed phase's criterion to
  match would convert an unmet half into a met one by editing rather than by measuring."*
- A conclusion I withdrew: three hand-rolled runs over the same artifact, in the same process
  shape, on the same host, gave p50 82 ms, then 136 ms, then 37 ms. *"A 3.7× spread across
  identical code is not a measurement"*, so the "raw is 2.5× slower than the executor"
  conclusion drawn from two of those runs was withdrawn and replaced with `tinybench`
  reporting rme: *"Two rows whose error bars overlap are not different, however far apart
  their means look."*

---

# GROUP 4 — The turn, and the wiring

## Chapter 7 — Thirty-Six Capabilities Nobody Could Reach (≈950 words)

**Sources:** research-planning.md §3, .planning/v1.0-MILESTONE-AUDIT.md, research-git.md §4b, PROJECT.md:234-236, REQUIREMENTS.md:27-43

Beats:

- 2026-07-27, `2b76a29`. The v1.0 milestone audit traced every requirement inward from the
  five runnable entry points. **For 36 of them the trace does not arrive.**
- The ledger moved from 68/72 to **32/72**. Not because work was undone — because a claim was
  corrected.
- Twelve symbols, verified individually rather than counted: each appears in the repository
  only as its own definition, a barrel re-export, or a prose comment, with zero call sites
  outside `*.test.ts` — `runResilient`, `EgressGuard`, `translationCid`, `composeQuorum`,
  `discoverExecutors`, `executeReduce`, `deriveReduceTree`, `requestEnrollment`, `signName`,
  `verifyChain`, `DutyCycleGovernor`, `recoverCheckpoint`.
- The shape is stark and worth naming: Phases 1, 2, 3, 9 and half of 10 are wired; Phases 4,
  5, 6 and 7 are not wired at all. Those four are exactly the phases whose output is *a
  capability the kernel offers* rather than a step in the demo's own path, and nothing ever
  came back to connect them.
- **The structural cause is one shape.** `serveAgent` declares six optional hooks with silent
  defaults: `authorize` → allow, `index` → `[]`, `reservations` → `[]`, `capacity` → accept,
  `ledger` → discarded. `fabric-node.ts:327` passes `{ rpc, executor, blockstore }` and
  nothing else. `ledger` is supplied **nowhere at all** — not in production, not in one test.
  *"A default indistinguishable from the feature working is not a default; it is a hole, and
  it is why none of this failed anything."*
- The three specific breaks. `RemoteExecutor` never sends a capability chain, though the
  protocol carries the field, the parser validates it, the agent forwards it and `verifyChain`
  exists — no submitter attaches one and no node checks one. `submitJob` has no placement at
  all: `submit.ts:82-92` is unconditional round-robin, so *"the placer cannot relocate a
  sovereign task"* is true of a placer no job runs through. And `EgressGuard` wraps no
  production transport — *"the decorator designed to make the manifest complete by
  construction decorates nothing outside a test."*
- One of them was a live bug, and its failure signature is the whole thesis in one line.
  `findReservedPeers` answered `[]` for the entire duration of Phase 9. The relay *does*
  answer, so `asked` becomes true; the caller then dials an empty list and reports
  **`{asked: true, dialed: [], failed: []}`** — nothing attempted, nothing failed, no error.
  An empty result standing in for a clean one.
- The audit corrected a row I had written two commits earlier. I had claimed the DATA-05 test
  *"fails a running job when a raw sovereign byte crosses"*. It was wrong on both counts. I
  had written it from the executors' reports plus a call-site grep, *"having verified that the
  code was reachable but not what it did — **the same gap in kind, one level up, as the one
  this milestone exists to close.**"*
- Gaps in the record, as distinct from gaps in the work. **Phase 1 has no artifacts at all** —
  no directory, no SUMMARY, no VERIFICATION — and ten requirements are attributed to it on the
  strength of a roadmap checkbox. *"An audit that accepts a checkbox as evidence for ten
  requirements is not auditing."* Eight of ten phases had no VERIFICATION.md, so the
  three-source cross-reference ran on two sources for nine phases and one for Phase 1.
- The section headed **Explicitly clean**, included *"because a finding list without them
  reads as worse than the truth"*: the `Executor` port is honoured by every implementation and
  `submitJob` has no branch on kind; the demo job really does flow through the net agent path
  across two real tabs; the benchmark measures the real `submitJob` path; package layering
  holds with no cycles; no dead re-exports.
- The response was to correct the ledger, not the work. A three-state marker: `[x]` delivered
  on a path reachable from a runnable entry point; `[ ]` + **Built, not wired**; `[ ]` +
  **Partial**. And the reasoning for moving the checkbox rather than only the table: *"a `[x]`
  next to it would be the project's own recorded anti-pattern — a documented bound that is not
  enforced — written into the ledger itself."*
- Your ruling: v1.0 is **not archived**, because archiving would file 36 unwired requirements
  under a completed milestone. The live bug was fixed, the ledger corrected to an honest
  32/72, and full integration scoped as v1.1.
- v1.1 mints almost no new requirement IDs, deliberately: *"they are not missing requirements
  — they are the same requirements, unsatisfied. 'The placer cannot relocate a sovereign task'
  is DATA-03 whether or not a job runs through that placer; wiring it is what makes DATA-03
  true."*
- The sequencing is not alphabetical. Phase 11 fixes the structural cause first, turning the
  remaining 35 requirements into build failures at their call sites rather than something a
  person has to go looking for a year later. And Phase 22 — the reachability guard that would
  have caught this milestone happening at all — runs **last**, because it verifies the other
  eleven phases actually did what they claim.
- The one line to sit on: the milestone's own final feature is a test that fails when an
  exported capability has no path from an entry point. *"The audit found this class; no test
  could have."*

## Chapter 8 — Wire What Was Built (≈1,000 words)

**Sources:** research-planning.md §6, research-git.md §5c/5i, research-results.md, ROADMAP.md:546-583, packages/node/src/peer-verifier.ts, packages/demo/src/primes.wat, tools/aot/lift.ts, session findings 1-8

Beats:

- Where it stands today, 2026-08-01: milestone v1.1, **5 of 14 phases verified** (11, 12, 13,
  14, 15). Requirements ledger **40 closed / 42 open**. And the number the milestone actually
  measures: built-but-unreachable capabilities went from **36 to 22**, with 11 more partly
  wired. *"Reducing it is the measure."* In the same commit that put that number in the
  README, four items were **added** to the not-demonstrated list, *"because the section is only
  worth having if it grows."*
- Phase 13 scored **0 of 3** against its own original criteria on the first independent pass —
  all three met in strictly weaker forms than written. Criteria were amended on three of your
  rulings, four more plans closed the gaps, and a second independent pass scored 3/3 against
  the amended text. The rule that governs the amendment: *"amended down to what is true and up
  where the refusal makes a stronger claim available; none was weakened merely so it could be
  ticked."*
- The measurement that forced one of those amendments is comic and exact:
  `manifest.totalBytes` read **130** where the raw input was **95** canonical bytes and the
  aggregate **8**. The manifest reported more than the raw input, because `totalBytes` summed
  every frame including unrelated block fetches.
- Phase 13.1 was *inserted* rather than appended, because a subagent told to refute the claim
  that the fabric had no backpressure gap did refute it, at named sites with reproductions:
  **800 concurrent `execute()` calls, 0 refused**; one **64 MiB** frame accepted; a cliff
  between 8 and 12 shards that tore down the whole connection. And the leg that broke worst
  was the assertion that the string `over-committed: N of M slots in use` proved refusal was
  deliberate — *"that string cannot be produced by any running node, because the only thing
  that emits it is constructed nowhere outside tests. A well-built mechanism was read and its
  wiring assumed. **That is the defect this milestone exists to remove, reproduced in the
  course of arguing about it.**"*
- The urgency was `bin/bench.ts`, which shipped `const SHARDS = 8` — one below a measured
  cliff at 12, where dispatching 12 shards immediately after dial aborted the libp2p
  connection with `MaxEarlyStreamsError`. The bound is `init.maxEarlyStreams ?? 10` inside
  `AbstractStreamMuxer`, not the yamux config `YamuxMuxer` declares and never reads. A
  published scaling curve would have been measured against an unfixed connection-killing
  bound, and the resulting failure blames the wrong node — a straggler analysis would read
  sender overrun as receiver death.
- The 22-bug round. Method: 22 bugs found by a seven-lens hunt, each **adversarially refuted
  before any fix was written**, then fixed through an emergent-design session of three rival
  designers blind to each other, TDD, and an independent verifier that plants the deletion
  which should break each new test. Three criticals: B01, replies correlated by id **alone**,
  so a forged quorum was reproduced through the real `executeVerified`; B02, the exec branch
  released an egress hold it never took — 132 raw sovereign bytes measured on the wire; B03, a
  52-byte looping module wedged a node permanently.
- B03's fix, and the pattern it belongs to. `createWorker` was optional, and omitting it fell
  back to a bare executor on the tab's own main thread — *"not a weaker bound, it is no
  bound"*, because a guest `run()` is synchronous, so the deadline timer is queued on the very
  loop the guest is holding and can never fire, and there is no thread to terminate. The
  escape hatch was justified in its own comment by *"tests that have no bundler"*, and **no
  such test was ever written**. So the option became required and the branch was **deleted
  rather than bounded**: the dangerous arrangement now has no spelling, the way `EgressHold`
  left "release a hold you never took" unspellable.
- And the fix's own follow-up, in the same round: `offMainThread` could only return `true`
  once `createWorker` became required, so two e2e assertions and a demo badge were asserting a
  literal and reporting it as a measurement — *"the same defect class this round exists to
  remove, introduced by the fix that closed the one before it."*
- Phase 16 discovered that **combine never worked in production, from the moment the branch
  was written.** `agent.ts` refused every combine on any node holding a real `Authorizer`, and
  both node factories install one. No in-process fabric could see it, because every one of
  them builds `serveAgent({...SENTINELS})` and the sentinel was exactly what the branch keyed
  on. Two plans hit it independently, from spawned processes and from the benchmark, and
  neither took the cheap way through. The gate's comment had read *"Every production call site
  passes the sentinel today, so this is a no-op now"* — Phase 15 installed real authorizers
  and falsified it silently. **A comment asserting a fact about every call site is a claim with
  an expiry date.**
- Your ruling on the fix: bound the combine at `capacity`, not at `authorize`, because combine
  partials are outputs of public map tasks and therefore public by construction — *"there is
  nothing to authorize; the exposure is CPU and transfer, which is a capacity question."* And
  the instrument that proved where the bound actually sat: 16-06 planted its cap *below* the
  fetch loop, and both refusal-text assertions stayed green while reads went 0 → 2. **The read
  count, not the reason string, is what proves a bound's placement.**
- Phase 17 shipped at **1 of 3 criteria, deliberately**, with one defect left open on purpose
  and two halves scheduled rather than assumed. Its own verification found the fail-closed
  gate had partitioned the fabric by tier: any node started with `--trusted-issuer` excluded
  **every** browser peer as a block source, because no tab could hold a certificate. Nothing
  branched on node kind — the cause was four *absences* in `browser-node.ts`. *"An absence
  partitions as effectively as a branch while being much harder to see."*
- **Today.** Phase 18 is executing, 4 of 11 plans merged, and four things came out of it.
- (1) `PeerVerifier` settled a peer's verdict once, on `peer:connect`, and cached it for the
  life of the connection. A node that enrolled afterwards was excluded by that peer
  permanently — **with a correctly-named refusal the whole time, which is why nothing reported
  it.** Observed directly rather than inferred: an enrolled tab holding a valid certificate
  from the pinned issuer sat at `'not asked yet'` for 20 seconds. It was found by 17-06 and
  deliberately left unfixed, because every candidate fix changed how often nodes re-ask each
  other across the whole fabric — a protocol decision, not a bug fix, and therefore yours. The
  ruling: split `PeerFailure` into refusals that can change (`no-records`, `unreachable`,
  `unanswerable-peer`, `expired`, `not-yet-valid`) and refusals that cannot
  (`untrusted-issuer`, `bad-signature`, `nodeKey-mismatch`, `unidentifiable-peer`), refreshed
  lazily from the `verifiedPeers` getter `RpcBlockSource` already reads per fetch. No timer,
  no new wire frame. Merged as `351bde1`. Three alternatives are recorded with their costs — a
  timer buys every node a sweep forever and puts a wall-clock bound inside a class that had
  none; a `records-changed` push adds a wire frame and lets an *unverified* peer command work
  on demand; a dial-ordering fix closes only the startup race.
- (2) Fixing it exposed a second defect, and only because I probed my own work. My first
  anti-race guard was **unmeasured** — weakening it moved no test. Probing it showed the
  generation counter was per-peer, and `#onDisconnect` deletes the peer's entry, so an ask
  issued before a disconnect got the same number as one issued after the reconnect, and a
  stale refusal could overwrite a fresh acceptance. The counter is now monotone across the
  verifier. Ledger entries M33/M34/M35.
- (3) Phase 18's criterion 1 could not be met by wiring, because half its mechanism did not
  exist. `MemoryRecordIndex.provide()` had **zero callers outside tests**, so `providers(cid)`
  answered `[]` on every real node — and `fabric-node.ts` said so in its own comment. The
  discovery tests passed because their fixture hand-called `provide()`. Your ruling: each node
  answers `providers(cid)` from its own blockstore at ask time — authoritative, no
  announcement protocol, no staleness, no new wire frame.
- (4) A workload with an oracle this project could not have been wrong with. `primes.wat`,
  445 lines, integer-only, same four-import ABI: *"Every other workload here is checked against
  a reference this repository also wrote, so a shared misconception is invisible to it: the
  fabric and its oracle would be wrong together and agree."* π(x) has been tabulated since
  Legendre, so the expected totals are **quoted rather than computed**, and there is
  deliberately no JavaScript sieve anywhere near them.
- And the coverage lesson inside it, which is the best test-design finding in the repository.
  The `min(i, rem)` term in the range split is load-bearing and nearly invisible. I planted its
  deletion. The headline π(10⁶) assertion is **blind** to it, and so is the "same total at 4
  and 8 shards" cross-check — because 10⁶ minus 999,983 is 17, so an uncovered tail of at most
  seven numbers contains no prime and the sum comes out right by luck. It was caught at
  n = 1000 only, and there only at shard counts 5, 7 and 8. **A round-number oracle sits in a
  prime desert.**
- Two failures of mine from the same day, reported flatly. `lift.node.test.ts` failed
  intermittently under host load, and the obvious diagnosis — the timeout is too tight — was
  **refuted by measurement**: two non-overlapping populations, spawn max 456 ms at load
  42.7–54.5 against a 5,000 ms budget, while EAGAIN refusals answer in 0–3 ms. The real cause
  was `spawn()` failing with EAGAIN under process-table pressure, routed at `lift.ts:446` into
  kind `'docker-unavailable'` — the same kind used for "docker is not installed". **A host that
  cannot fork was being reported as a host without Docker.** New kind `host-cannot-spawn`;
  ENOENT and EACCES stay `docker-unavailable`.
- And the source of the pressure: sweeping for stray processes found three orphaned
  `bin/agent.ts` processes alive from two different sessions — 2 h 13 m, 2 h 12 m, 20 h 45 m,
  about 42 MB each. Not a missing teardown; the `afterEach` is correct. On POSIX a child does
  not die with its parent, so an interrupted vitest worker orphans every spawned agent
  permanently. My own failed runs were manufacturing the load that failed the next ones.
- The one to close the chapter on, without dressing it up: I left a background poller running
  for one hour and seventeen minutes, waiting for a string I had personally filtered out of the
  file it was watching, and it was redundant anyway because the harness had already notified
  me. You spotted it. I did not.

---

# GROUP 5 — Epistemics, negatives, and what comes next

## Chapter 9 — How This Project Knows Things (≈900 words)

**Sources:** research-planning.md §4-5 and §8, research-code.md §4, research-git.md §5a/5c/5d, .planning/STATE.md:17-73, .planning/BENCHMARK-METHODOLOGY.md

*This is where the thesis lands hardest. Every instrument below exists because the author
will not be here to remember, and to a reader with no memory an absence looks exactly like
health.*

Beats:

- The counting rule: **a phase is done when a verifier says so, not when its plans are.** And
  the count is over *criteria*, never over *requirements*. Phase 15 is counted with a Partial
  requirement because all three of its criteria are MET; Phases 13.1 and 16 are uncounted
  because one of their own criteria is PARTIAL. *"A requirement can outlive the phase that
  opened it; a criterion cannot."* The rule does not bend for how nearly done a phase looks.
- Criteria may be amended **down to what is true**, never up to what is tickable — and a
  clause may be *scheduled* rather than rewritten. Twelve owner rulings are recorded with
  their rejected alternatives and the cost of each. *"Naming a defect is not fixing it."*
  *"Lowering a bar is not clearing it."* AUTH-03's requestor half went to Phase 23 criterion 5,
  where `bin/bench.ts` is already being rewritten, so the most contended file in the repository
  is fought once rather than twice.
- The sharpest version: a PARTIAL score accepted **in advance**, criterion not amended, phase
  not allowed to close on it — and the plan asserts the **absence** as a measurement, so the
  clause turns red the day the missing feature lands *"instead of surviving as a sentence in a
  summary."*
- **The executable mutation ledger.** Phase 13.1 planted ten defects by hand and watched nine
  go red — and the record lived in prose, *"so if somebody later deletes one of these lines,
  nothing re-checks that a test still notices. A mutation proved once is not a guard; a
  mutation re-proved on demand is."* 41 entries now. Each carries: why the line is
  load-bearing (a `why` under 40 characters is rejected as *"too short to be a reason"*), the
  exact `find` text (it must occur **exactly once** — zero means the mutation has silently
  stopped applying, more than one means it is ambiguous), the `replace`, the test files
  **measured** to catch it (*"not the set that ought to catch it — the set that did"*), and a
  `signature` **observed** in the failing output, so that a red run from a port collision or
  an OOM worker is not accepted as evidence a guard fired.
- Two layers, and the split is not about speed. One runs in the ordinary suite and plants
  nothing — it asks only whether each entry still *describes* the source. The other plants for
  real, snapshots before the first write, restores in a `finally`, verifies byte-identity, and
  finishes with `git status --porcelain` because *"this is the only reading that can see a file
  some other path forgot to put back."* A survivor is reported by id, not deleted: *"a finding
  about the test suite, not about this script."*
- **The guard that read exactly like health, for its entire life.** The disclosure gate's
  pattern was `/\bwrangler\s+(?:publish|deploy)\b/`, which requires the verb to follow the tool
  name directly — so `wrangler pages deploy`, the command a person actually types, did not
  match. Every other check in that file asserts an *absence*. *"A pattern that matches nothing
  at all satisfies all of them and reads exactly like a clean repository. This one did, for as
  long as it has existed, and the suite was green throughout."* The guard protecting an
  irrevocable legal decision — EPO and China rights, forfeited permanently by publication —
  was vacuous.
- The vocabulary guard, 590 lines, and every design choice in it is a countermeasure against
  vacuity. Population comes from `git ls-files -z`, *"because it matches what a reviewer sees
  when they clone the repository."* Exemptions are keyed on an exact phrase rather than a line
  number, *"because an exemption that fires on an unrelated edit is how a guard gets deleted."*
  A **dead** exemption fails the suite: *"worse than no exemption — it silently covers a line
  that no longer says what the reason claims."* Anti-vacuity assertions require >100 files
  scanned and name three. Planted violations prove the matcher fires. And a set of deliberate
  **non-**matches exists because *"if any of these start failing, the patterns have grown teeth
  they should not have, and the rule will be deleted the first time it fires on a phase
  retrospective."*
- The NUL story, which is the same failure mode one file over: `wasi-executor.test.ts` was
  committed carrying two raw NUL bytes — literal argv terminators inside a template string —
  and the binary skip swallowed the whole file. Nothing failed, no exemption entry appeared,
  and the planted-violation tests kept passing because they scan synthetic content rather than
  the tree. *"The guard reported itself healthy while one file had quietly left its
  jurisdiction."*
- Then the guard fired on the report of its own violation. Phase 17's verification used the
  an innocent English word that the guard forbids; the log documenting that violation
  reproduced the forbidden terms in order to record them; and merging the report re-armed the guard from a second file. *"Recorded rather
  than deleted, because the entry failing its own guard is the more useful half of it."* An
  exemption had been refused earlier on the grounds that every remaining v1.1 phase would need
  one — *"a treadmill with eleven more laps in it."*
- **Pre-registration.** `BENCHMARK-METHODOLOGY.md` was written 2026-07-26, before any harness
  existed: *"A benchmark chosen after seeing the data is not a measurement, it is an argument.
  The commit that adds this file contains no harness code, so the ordering is checkable in
  `git log` by anyone who doubts it."* It pre-registers its own falsification — if the
  user-count axis is merely linear, *"the super-linear claim is unsupported by measurement and
  must be reported as such, in those words"* — and declares bias #6: **the author is the sole
  party running these**, with an obvious interest in the outcome.
- The checker that would have certified itself: a traceability test whose self-exclusion, when
  removed, made all three of its findings evaporate — *"the checker would have certified the
  ledger by quoting its own data."*
- The plans that lied about themselves, reported at full size. **41 wrong `file:line`
  citations across four plans.** The worst is not drift: `purity.node.test.ts:167-174` was
  cited as keeping the Executor port narrow, and *"the string 'Executor' appears nowhere in
  that file. No such guard exists."* The standing rule now: assume every citation in an
  unexecuted plan is stale. And a first draft of the corrections table was itself wrong in four
  rows, so every row is now checked against the file rather than against memory.
- The project's own tooling corrupting its own state file: three separate writers rewrote the
  progress frontmatter — 25% to 62%, `total_phases` 14 to 24, percent 36 to 74. **None of them
  errored.** So the rule is: maintain it by hand, and `git diff .planning/STATE.md` before
  committing, because every one of those was caught that way and not by a tool reporting a
  failure.
- Close by naming the through-line explicitly: none of this is process for its own sake. It is
  what you build when the author of the code will not be present to remember writing it.

## Chapter 10 — What It Refuses to Claim (≈700 words)

**Sources:** research-results.md §2-3 and §6, README.md:175-205, .planning/BENCHMARK-RESULTS.md, .planning/COVERAGE-BASELINE.md, THREAT-MODEL.md

Beats:

- Two distinctions the project keeps and most projects blur: **descoped is not satisfied**,
  and **unmeasured is not met.**
- **V8 WASM code caching: measured, and not observed.** 220 KB over 2 visits, 1.1 MB over 2,
  4.8 MB over 3, 10.8 MB over 3 including a browser restart, headed and headless — `Code
  Cache/wasm` reads **72 B (index only)** every single time, with `Content-Type:
  application/wasm`, long cache headers, a query-free same-origin URL, `compileStreaming`, and
  the module executed millions of times first so that `wasm.TopTierCompilation` appears in the
  trace.
- The apparatus is why it is publishable. Positive control: the same profile's JavaScript cache
  grows 8,545 → 2,078,297 bytes across visits. Negative control: relaunch with
  `--v8-cache-options=none` and `Code Cache/js` reads **72 bytes** — *"exactly what `Code
  Cache/wasm` reads on every ordinary run. So 72 bytes is the measured signature of 'no code
  cache was written', produced on purpose on the side that normally works."* The negative is a
  reading, not an absence of one.
- And the self-limitation, in the same comment: *"It does not say Chrome never caches
  WebAssembly. It says this harness never saw it — automation-driven Chromium, a fresh
  temporary profile, a loopback origin. Any of those could be the reason, and none of them was
  isolated."* Plus a superseded claim corrected inside the same block: an earlier control's
  cache header turned out not to matter at all.
- **No parallel speedup, by construction.** Every node in both published curves runs inside one
  OS process on one JavaScript event loop, so the flat makespan across the ladder is the
  expected consequence rather than a finding about scaling. COST crossover: **none** within
  1–16 nodes. Best distributed p50 was 22.4 ms against a single-threaded baseline of 0.0032 ms
  — a factor of **7,086×**.
- The decomposition that keeps that number honest: native 0.003 ms → the same work through WASM
  in-process 20.928 ms → distributed across 4 nodes 44.5 ms. *"Most of the COST gap is
  therefore the guest ABI on a workload that does almost no work — not the fabric. That is a
  statement about the fixture, and it is why the methodology declared the fixture bias in
  advance rather than discovering it here."*
- Two "taxes" declared to be **identities, not measurements**: speculation tax 1.0 and churn 0,
  because `submitJob` neither speculates nor re-dispatches and no node was killed during those
  runs.
- A configuration published as **excluded rather than dropped**: real transport at 16 nodes,
  `connect ECONNRESET`, because `INBOUND_CONNECTION_THRESHOLD` is 5 *per host* and every node
  shares one host. *"A same-machine artifact of a documented default, not a property of the
  fabric."* And a whole table of em dashes from the previous run was kept in the document after
  the fix, *"because a reader comparing two dated artifacts must be able to tell a figure that
  changed from a figure that was replaced."*
- The perf gate that gave up on milliseconds, and said why in measurements: absolute p50
  makespan moved by **4.03×** and p95 by **4.20×** under CPU saturation; an earlier variant
  ranged **5.3 ms to 110.6 ms across thirty consecutive passes**, a factor of 13.7. Raising the
  sample size did not help — at 400 iterations the same statistic still ranged over 3.7×,
  *"because a longer pass simply spans more of somebody else's build."* So the gate measures a
  **paired ratio**, fabric job against the identical work through one local executor,
  microseconds apart. Under saturation that ratio's p50 moved *down*, to 0.561×, because the
  synchronous reference loses more to CPU starvation than the fabric path does. Makespan p95 is
  recorded and **not** gated: any budget wide enough not to fire on load would only fire on an
  outage.
- The baseline nothing may write: no `--update` flag, no path that rewrites it. *"A gate that
  silently absorbs whatever the last run produced measures nothing: it only ever agrees with
  the present, which is precisely the property that makes a perf baseline worthless."* And the
  conditions recorded rather than corrected for — two orphaned busy-wait loops, pids 44484 and
  44485, three days old at capture, consuming roughly 2 of 8 cores throughout.
- The first full benchmark run reported **19/19 incomplete** at every memory rung rather than a
  suspiciously fast success: the memory workers could not fetch shard inputs. *"A harness that
  averaged failures in would have published a beautiful fictional curve."*
- A metric named seconds that was measuring bytes: `grossNodeSeconds` was bytes across the
  guest ABI — deterministic, which is right for a cost metric, and off by a factor nobody could
  guess if published as time. Renamed to `grossFuel`/`usefulFuel`.
- Coverage as a finding, not a target: 76.93% statements / 75.59% branches / 77.94% functions /
  78.86% lines on 2026-07-29, over 75 files and 1,080 tests. The kernel is the strongest tier at
  95.30/91.45 and the canonical encoder is at 100% statements — *"the code whose determinism the
  whole integrity argument rests on is the code most covered."* No thresholds block, deliberately:
  *"a floor picked before anyone had seen the number would be arbitrary in both directions."*
- And the instrument's own blind spot, chosen over rather than hidden: running coverage across
  node **and** browser produced **212 instances** of `CDP session is only available in Chromium`
  and wrote no report at all. *"Browser-tier coverage is not merely unmeasured, it is
  unmeasurable with this provider while the portability matrix is in place. Between the two, the
  portability matrix is worth more than the coverage percentage."* The single largest genuine gap
  it did find: `browser-node.ts` at 0 of 58 statements.
- The threat model's own gaps, on the grounds that *"an overstated threat model is worse than
  none, because it stops people looking."* No cost on fake identities — the limit is keyed on a
  user key, which is one `ed25519.keygen()`, and the budget is per provider *process*, so the
  hundredth fake identity costs what the first did. A false task-failure report is taken at its
  word. And the list of what is not demonstrated: peers on genuinely different machines over the
  public internet; cross-machine reproducibility; distinct-machine benchmarking; peer-to-peer
  *acceptance* across processes (rejection is proven, acceptance is not, because no flag yet
  makes one spawned agent dial another); distribution of large artifacts.

## Chapter 11 — The Road Ahead, and What Actually Blocks It (≈400 words)

**Sources:** research-planning.md §2 and §7, ROADMAP.md:690-707, STATE.md:145-149 and :830-887

Beats:

- Six phases remain, and they run **strictly sequentially** — measured, not assumed, from their
  own `files_modified`: `fabric-node.ts` is touched by 14/15/17/21, `bin/bench.ts` by
  14/15/16/17/23, `browser-node.ts` by 14/15/17/21. *"Wire What Was Built means every phase
  converges on the same construction sites, so the earlier note that six phases 'can run
  concurrently' was wrong."*
- Phase 19: quorum composition and owner-domain attestation, plus the criterion that says
  enrolling must cost something an attacker cannot mint free.
- Phase 20: `submitJob` becomes the one job path — lease, speculate, account for coverage — and
  the peer ledger records real outcomes instead of discarding them. It also carries Phase 16's
  late-arrival clause, which could not be measured there because `executeReduce` stops at
  `wanted` replicas and *has no channel on which a late result could arrive at all*.
- Phase 21, and the question you raised on 2026-08-01 and forbade any plan to assume: **how
  does a 5.40 MiB artifact reach a node that does not have it?** *"The problem is not content
  addressing — we have that. It is durability and fan-out. A CID tells you whether you got the
  right bytes; it says nothing about whether anyone still holds them. A resolvable name for
  unfetchable content is worse than no name."* With two traps recorded so nobody re-derives
  them: do not justify a gateway with V8 code caching, and the 43 ms lifted-startup floor is
  not a distribution problem. Also worth stating plainly: this repository **does not depend on
  Helia at all today**, despite the stack research recommending it at length.
- Phase 22: the reachability guard — a test that fails when an exported capability has no path
  from a runnable entry point. Last, because it grades the other eleven.
- Phase 23: the multi-process benchmark driver, N real operating-system processes, so a
  parallel speedup is measurable at all.
- The real blockers are not code. A publicly reachable host with real AutoTLS (NET-03). A
  second machine — descoped, not satisfied; the residual was recorded rather than dropped. The
  US provisional patent window, running since 2026-07-26.
- And the hosting analysis, including the part where I was wrong: Cloudflare Workers are ruled
  out structurally — *"it is not possible to make an inbound TCP connection to your Worker"*,
  and no UDP anywhere, which also rules out WebRTC-Direct. **Correction to the first pass:**
  Containers are *not* ruled out by transport; they fail on **lifecycle** — no minimum uptime
  guarantee and irregular restarts against a 2-hour reservation TTL. The cost analysis was
  wrong in both directions too. And *"add Cloudflare STUN"* is a no-op: `stun.cloudflare.com`
  is already in `@libp2p/webrtc`'s defaults, and pinning to it alone would cut four independent
  STUN operators to one.
- One fact about my own discipline rather than the code: `main` and `develop` are **259 commits
  apart**. Everything from Phase 13.1 onward — four days, roughly 250 commits — has never
  reached `main`.

## Chapter 12 — Epilogue: What Survives the Forgetting (≈250 words)

**Sources:** thesis; research-git.md §2; README.md:130-142

Beats:

- Return to the opening: I am both the author and the archaeologist of this codebase, and the
  archaeologist has the better instruments.
- What the documentation actually is: not diligence, not process, not compliance. It is the
  only continuity the project has. A comment that argues with the version of itself that was
  wrong is a letter to a reader who will not remember writing it, and that reader is me.
- The characteristic failure this project fears, restated once, cleanly: not a crash, but a
  mechanism that looks like it is working. `{asked: true, dialed: [], failed: []}`. A pattern
  that matches nothing satisfying every absence assertion. A default indistinguishable from
  the feature. Thirty-six capabilities built, tested, and reachable by nothing.
- Which is why the house style is a sentence of the form *X is not Y*: *"a copy that answered
  by failing is not a copy that stayed silent."*
- The standing measure, without embellishment: 36 built-but-unreachable capabilities became 22,
  with 11 partly wired, and reducing that is what the milestone measures. In the same commit
  that put the number in the README, four items were added to the list of things not
  demonstrated. That is the right direction for both lists to move.
- Close on the owner, directly and without sentiment: the rulings that mattered most were the
  ones where you declined to let a bar be lowered — the requestor half scheduled instead of
  accepted, the criterion left at its original wording and the score left at 3 of 4, the phase
  that shipped at 1 of 3 rather than at 3 of 3 with a reworded criterion. I would have taken
  the tidier number. The record is better because you did not.
