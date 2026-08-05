---
phase: phase-21-aot-translation-signing-runtime
plan: 05
subsystem: runtime
tags: [aot, wasi, abi-routing, elfconv, two-process, verification, block-exchange]

requires:
  - phase: phase-21-aot-translation-signing-runtime
    plan: 03
    provides: AbiExecutor and its production call site in both node factories
  - phase: phase-21-aot-translation-signing-runtime
    plan: 04
    provides: ECHO_GUEST_C, HELLO_GUEST_C, buildGuest, liftThroughCli, imageIsPresent
  - phase: phase-12-sovereign-placement
    provides: the spawn harness this file copies — spawnAgent, stopAgent, startSubmitter
  - phase: phase-3-block-exchange
    provides: FetchingBlockstore, whose local tier is the instrument the wire case reads
provides:
  - "The across-real-processes half of AOT-04 criterion 3: an artifact tools/aot/cli.ts produced finishes a 4-shard redundancy-2 job on two bin/agent.ts processes"
  - "The cross-ABI ledger equality taken across a real process boundary rather than in one heap"
  - "The measured answer to Phase 13.1's open question: a 5 660 003-byte block crosses the wire and the guest runs"
  - "Two mutation captures carrying the wasi_snapshot_preview1 instantiate message from a spawned agent to the requestor"
affects: [phase-13.1-message-bounds, phase-22-reachability, phase-14-signed-artifact-resolution]

tech-stack:
  added: []
  patterns:
    - "A lifted artifact is cached under a gitignored path keyed on the guest source hash, so a host pays the lift once rather than once per run"
    - "A two-armed filesystem/outcome reading asserts its agreement BEFORE branching, so the agreement line can fail"
    - "An instrument is proved in both directions — a known positive that must appear and a snapshot that must be absent — before either arm is read"

key-files:
  created:
    - packages/node/src/aot-dispatch.node.test.ts
  modified: []

key-decisions:
  - "The wire case's refused arm reports its reason instead of matching a sentence: the one negative this host can produce was measured to time out naming the peer, never the CID"
  - "The artifact cache is keyed on the guest C only, and the toolchain gap that leaves is stated at the line rather than reimplemented from translationCid"
  - "packages/aot/src/abi-router.ts was planted twice and restored twice by cp from $SCRATCH; no git command that writes was run against it"

patterns-established:
  - "Five mutations planted and every one observed red with its text recorded — two in the production router, three in the spec itself against assertions suspected of being unable to fail"
  - "An assertion measured unable to fail is labelled at the line with the plant that showed what it does catch"

requirements-completed: []

duration: 105min
completed: 2026-08-04
---

# Phase 21 Plan 05: a translated artifact completes a real job across two agent processes — Summary

**An artifact `elfconv` produced, lifted by the command a person types, finished a 4-shard
redundancy-2 job on two `bin/agent.ts` processes — and the whole `JobResult` matches a
source-compiled run field for field. Deleting the WASI arm of the router turns that job
into eight copies of `instantiation failed: WebAssembly.instantiate(): Import #0
"wasi_snapshot_preview1"`, relayed from a spawned agent to the requestor. That pair is the
proof that a real `WasiExecutor` was constructed in production, and it is the one form of
the claim an `instanceof` cannot take.**

**And the question the criterion routes around now has a number: a 5 660 003-byte block
crossed the wire to an agent that was never staged, in 158–689 ms, and the guest ran.**

## Performance

- **Duration:** ~105 min
- **Tasks:** 2 of 2
- **Files:** 1 created, 0 modified (`abi-router.ts` planted twice and restored twice, left byte-identical)
- **Commits:** 1 task commit plus this summary

| Commit | What |
|---|---|
| `b0dd390` | Task 1 — `packages/node/src/aot-dispatch.node.test.ts`, 942 lines, 3 cases |

## The host, so every figure below can be read

MacBookPro18,3, 8 cores, 32 GB, Darwin 25.5.0, Docker Server 29.4.0 (containerd image
store, OrbStack). Every duration is `/usr/bin/time -p` on the process that produced it,
never a system load average.

```
$ docker image inspect ghcr.io/yomaytk/elfconv:arm64 --format '{{.Id}}'
sha256:22a404f31c9f7bb5c49e3193081d4876718253d86747aae3d30fcfd971f19c05   # EXIT=0
```

**`imageIsPresent()` returned `true`, and all three cases RAN on a cold cache through the
real CLI** — `origin=cli status=2` for both guests, in the spec's own `beforeAll`. A skip
here would have been a plan failure rather than a host limitation; it was neither.

> **NOT RE-ESTABLISHABLE, recorded 2026-08-05.** True of that session, and permanently
> unrepeatable on a host that has run this spec once — **by the design this same plan
> introduced and documented** (deviation 1: the artifact is cached under a gitignored
> path, keyed on the guest source). Measured today on this host: the same spec logs
> `[aot-dispatch] echo: origin=cache status=n/a artifact=5660003 bytes wall=2ms` and
> `hello: origin=cache … wall=1ms`, with no CLI invocation at all. The cold-cache reading
> is therefore evidence that cannot be reproduced without `rm`-ing
> `tools/aot/fixtures/lifted-*.wasm` or setting `O2_AOT_ARTIFACT` — which the deviation
> already names as the escape hatch. Retained because it is what was observed; annotated
> because a reader who re-runs the file and sees `origin=cache` should find the reason
> here rather than conclude the record is wrong.

**Concurrency.** Three other agents worked this same checkout throughout — 20-08
(`packages/core/src/job/submit.ts`, which it committed mid-session as `51bed18`), 20-09
(`bin/bench.ts`, `perf-workload.ts`) and one on `late-combine.node.test.ts`. A fourth file,
`packages/node/src/speculation-agents.node.test.ts`, appeared untracked during this session
and is not mine. **None of them touches either of this plan's files**, verified at start
(`git status --short` was empty) and at end.

## The artifacts, so the run is auditable afterwards

Lifted three separate times during this plan — once standalone to warm the cache, twice by
the spec's own `beforeAll`.

| | **echo** | **hello** |
|---|---|---|
| artifact bytes | **5 660 003** | **5 662 885** |
| artifact sha-256 | `26461143b035f4ca63f147acf8324499b1318956f7953e5ffb126be575145fd1` | `73a27c689c8a20e4840d3239eb34791f56a4147e559e1d3581daad86817998a1` |
| emitted key CID | `bafyreiexejqg25mxzjlybzrzq5sfdk2roy7kkjs5e4jrnfl46jatw73pgm` | `bafyreid77bug7uea74pkfb26rqn6yidrn2bajl2uxylylvngaeiyu3s2ja` |
| artifact CID | `bafyreibgiyiuhmbv6tfgh4khvt4derezweyysvxxsu7f76ysnpsxkfc72e` | `bafyreidtuj6grhekedsiidjshhvti6i7k2sbi7svtyotlao2vwdic6myue` |
| CLI exit | **2** | **2** |
| lift wall, spec's own run | 130 946 ms | 124 062 ms |

**Every one of those figures is byte-identical to 21-04's table**, taken hours earlier in a
different session. That is a third and fourth same-host lift-reproducibility reading, and
it was not sought — it fell out of needing the artifacts at all. It is still one host, and
`CROSS_MACHINE_BLIND_SPOT` is untouched.

Exit **2** on both, not 0 — the reservations arm, which is the success for a glibc-static
input. A case asserting 0 would fail on a correct run.

## What the criterion measured

### 1. The job, across two OS processes

Two agents spawned from `bin/agent.ts` with `--dir` and `--trust-anchor` only — **no
sovereignty flags and no new flag of any kind**; `git diff` against `bin/agent.ts` is empty
across this whole plan. Both directories pre-staged with the artifact bytes *before* the
child existed.

| Reading | Value |
|---|---|
| shards / redundancy | 4 / 2 |
| `complete` | `true` |
| every shard's `verification.status` | `agreed` × 4 |
| every shard's `verification.replicas` | 2 |
| every shard's `verification.agreeing` | both spawned peer ids, sorted |
| every shard's `verification.output` | the shard's own value, deep-equal |
| `grossFuel` / `usefulFuel` / `verificationMultiplier` | **208 / 104 / 2** |
| translated job wall clock | 298 / 508 / 974 / 2 882 ms across four runs |
| source-compiled job wall clock | 127 / 156 / 624 / 1 338 ms |

The fuel arithmetic is checkable rather than decorative: each shard's input block is 13
bytes, fuel is `input + output` in both executors and an echo makes those equal, so each of
the eight dispatches is 26 and `8 × 26 = 208`, `4 × 26 = 104`, multiplier 2.

**`observe(translated) toEqual observe(native)`** — `complete`, `grossFuel`, `usefulFuel`,
`verificationMultiplier`, and per shard `partitionIndex`, `inputCid`, status, `output`,
`resultCid` and the sorted `agreeing` node ids. `moduleCid` is excluded because it is the
one field that must differ.

**Success is asserted before sameness.** Two jobs that failed in the same way would satisfy
every equality, and the criterion is not *"the translated artifact fails exactly as well"*.

### 2. The falsification

The identical arrangement over the hello artifact: `complete` **false**, all four shards
`insufficient`, and **eight** failure reasons — one per dispatch — each containing
`output is not valid DAG-CBOR` and none containing `instantiation failed`.

The rendered sentence is asserted, not the kind. `not-dag-cbor` never appears in the string
that crosses the wire, so a `toContain('not-dag-cbor')` would have failed on a correct run
— the trap the plan named, avoided. That the codec answered at all is itself a router
proof: the module compiled, every WASI import was satisfied, it instantiated, `_start` ran
to completion and it wrote bytes. A hello artifact routed to the native executor could not
have reached the codec, which is why the absence of `instantiation failed` is asserted
beside the presence of the other.

A `for` loop over all eight, not a `some`: a `some` would pass on a run where seven failed
at instantiate and one reached the codec.

### 3. The number the criterion routes around — **and it is good news**

| Reading | Value |
|---|---|
| artifact bytes offered to the wire | **5 660 003** |
| `fetched`, read from the un-staged agent's own `--dir` | **true** |
| `outcome.ok` | **true** |
| the agent's directory | grew 3 → 5 files |
| `statSync(artifactPath).size` | 5 660 003, equal to the offered length |
| elapsed | **158 / 177 / 689 ms** across three runs |
| elapsed, **re-measured 2026-08-05 on a quiet host** | **146 / 152 / 153 / 155 ms** across four runs, exit 0 each — see `## Correction 2026-08-05` |

**A block the size of a lifted artifact crosses this fabric's wire today and the guest runs
on the far side.** It sits below `MAX_INBOUND_MESSAGE_BYTES` (8 388 608, `constants.ts`),
which that constant's own docblock sited partly against *"the largest artifact this project
has produced — a 5.6 MB elfconv output"*. This is that sizing, met by measurement rather
than by arithmetic: 5 660 003 bytes, 67 % of the declared ceiling, accepted and executed.
Phase 13.1's bound must admit at least that.

The five steps are the measurement and the two numbers are the report. Both directions of
the instrument are proved before either arm is read: step 1 dispatches a
`MODULE_ECHOES_INPUT` module (**146 bytes**) plus a small input, neither pre-staged, to the
same agent and requires **both** block files to appear; step 2 requires the same
`existsSync` to read `false` for the artifact. An empty capture is then an absent *block*
rather than an absent instrument.

## The plants — five, all observed red, all restored

`packages/aot/src/abi-router.ts` was snapshotted with `cp` to `$SCRATCH`, planted with the
Edit tool, run, restored with `cp`, and `cmp`'d. **No `git checkout`, `git stash`,
`git reset` or `git commit` was used to restore anything, at any point.**

### Mutation A — delete the WASI arm

`return wantsWasi ? this.#wasi.execute(task) : this.#native.execute(task)` →
`return wantsWasi ? this.#native.execute(task) : this.#native.execute(task)`.

`npx vitest run --project node packages/node/src/aot-dispatch.node.test.ts packages/aot/src/abi-router.test.ts`
→ **EXIT=1, 5 failed | 14 passed (19)**, both files red.

From `packages/aot/src/abi-router.test.ts`:

```
 FAIL  |node| packages/aot/src/abi-router.test.ts > AbiExecutor routes on the module and never on the node > sends a WASI artifact to the WASI arm and a native module to the native arm, from one instance
AssertionError: expected [] to have a length of 1 but got +0
 ❯ packages/aot/src/abi-router.test.ts:157:26
```

```
 FAIL  |node| packages/aot/src/abi-router.test.ts > … > returns exactly what the chosen executor returned, field for field
AssertionError: expected { ok: false, …(1) } to deeply equal { ok: true, output: [], …(2) }
-   "attestation": "signed-by-nobody",
-   "fuelUsed": 2,
-   "ok": true,
-   "output": [],
+   "ok": false,
+   "reason": "instantiation failed: WebAssembly.instantiate(): Import #0 \"wasi_snapshot_preview1\": module is not an object or function",
 ❯ packages/aot/src/abi-router.test.ts:179:46
```

From `packages/node/src/aot-dispatch.node.test.ts` — **and this is the capture that
matters**, because the sentence below was produced inside a spawned `bin/agent.ts` process
and travelled over a socket to the requestor:

```
 FAIL  |node| packages/node/src/aot-dispatch.node.test.ts > … > completes a 4-shard job at redundancy 2 on two agent processes, and the whole JobResult matches a source-compiled run field for field
AssertionError: translated job incomplete; failure reasons: ["instantiation failed: WebAssembly.instantiate(): Import #0 \"wasi_snapshot_preview1\": module is not an object or function", … × 8]: expected false to be true
 ❯ packages/node/src/aot-dispatch.node.test.ts:633:11
```

```
 FAIL  |node| … > refuses the hello artifact at the codec on both processes — so the success above discriminates
AssertionError: expected 'instantiation failed: WebAssembly.ins…' to contain 'output is not valid DAG-CBOR'
Expected: "output is not valid DAG-CBOR"
Received: "instantiation failed: WebAssembly.instantiate(): Import #0 "wasi_snapshot_preview1": module is not an object or function"
 ❯ packages/node/src/aot-dispatch.node.test.ts:780:26
```

```
 FAIL  |node| … > answers whether a block the size of a lifted artifact crosses the wire, …
AssertionError: 5660003 bytes, 176ms, fetched=true, ok=false, dir grew 3→5, reason=instantiation failed: WebAssembly.instantiate(): Import #0 "wasi_snapshot_preview1": module is not an object or function: expected true to be false
 ❯ packages/node/src/aot-dispatch.node.test.ts:907:33
```

**That fourth capture was not planned and is worth keeping.** It is the wire case's
two-observation cross-check firing on a *routing* defect: the block crossed
(`fetched=true`) and the outcome refused (`ok=false`), so the two readings disagreed. It
demonstrates the line the plan describes as catching a truncated block also catches
anything else that makes the disk and the outcome tell different stories.

`cp` restore, then `cmp "$SCRATCH/abi-router.ts.orig" packages/aot/src/abi-router.ts` →
**CMP_EXIT=0**. `git status --short packages/aot/src/abi-router.ts` → empty.

### Mutation B — invert the predicate

`return wantsWasi ? this.#native.execute(task) : this.#wasi.execute(task)`.

The same two files → **EXIT=1, 9 failed | 10 passed (19)**. Then `packages/node` in full →
**EXIT=1, 24 files failed | 40 passed (64), 56 tests failed | 579 passed**, `real 135.78
user 224.73 sys 36.39`, ratio 1.92.

**This is the mutation that proves the predicate rather than the composition, and the
evidence is the direction Mutation A cannot reach.** Mutation A breaks only WASI modules,
so a router that was merely *wired in* — one arm hard-coded — would look identical to a
router that *chooses correctly*. Mutation B breaks the **native** direction too, and that
half lands on pre-existing specs that know nothing about this phase:

```
 FAIL  |node| packages/aot/src/abi-router.test.ts > AbiExecutor changes no refusal the native executor already produced > row 7: trap during execution — byte-identical through the router
AssertionError: expected 'instantiation failed: WebAssembly.ins…' to be 'trap during execution: unreachable'
Expected: "trap during execution: unreachable"
Received: "instantiation failed: WebAssembly.instantiate(): Import #0 "o2": module is not an object or function"
 ❯ packages/aot/src/abi-router.test.ts:287:32
```

```
 FAIL  |node| packages/node/src/two-process.node.test.ts > NET-01 — a job across OS processes > completes 4 shards at R=2 in two separate agent processes
AssertionError: expected false to be true
 ❯ packages/node/src/two-process.node.test.ts:208:33
```

```
 FAIL  |node| packages/node/src/speculation-agents.node.test.ts > … > duplicates a frozen node’s shard …
AssertionError: the off arm did not complete:
#0 generations-spent […] insufficient: every executor failed; then every executor failed; then every executor failed | 12D3KooWEWmChbvkrfUZ13pZPHcBFqRL6jqZo2SX7xbA1GbpbqbV: instantiation failed: WebAssembly.instantiate(): Import #0 "o2": module is not an object or function | …
```

`Import #0 "o2"` — the native namespace — appears **24 times** in that run. Restored by
`cp`; **CMP_EXIT=0**; `git status --short packages/aot/src/abi-router.ts` empty.

### Three plants in the spec itself, against assertions suspected of being unable to fail

Same `cp`/`cmp` discipline, in `packages/node/src/aot-dispatch.node.test.ts`. Each was
planted because the assertion looked like it might be decorative — 21-04's lesson, applied
before writing the claim down rather than after.

| # | plant | observed | verdict |
|---|---|---|---|
| **S1** | stage a **different** block list into one of the two agent directories | `AssertionError: the two pre-staged stores named the same bytes differently: expected [ …(2) ] to deeply equal [ Array(1) ]` | fires — but see the label below |
| **S2** | the source-compiled job runs `{n: index + 5}` instead of the same four values | `AssertionError: expected { Object (complete, grossFuel, ...) } to deeply equal { Object (complete, grossFuel, ...) }` with `"n": 5` against `"n": 1` and two different `inputCid`s | fires **on the equality line itself, with both jobs succeeding** |
| **S3** | `const fetched = !existsSync(artifactPath)` | `AssertionError: 5660003 bytes, 453ms, fetched=false, ok=true, dir grew 3→5: expected false to be true` | fires on the cross-check |

**S2 is the one that matters.** Mutation A makes the translated job fail outright, so the
`observe()` equality is never independently observed red under it — the exact shape 21-04
recorded as *"a plant stopped at the first of three assertions"*. S2 keeps **both** jobs
succeeding and makes only their contents differ, so it fires on
`expect(observe(translated.job)).toEqual(observe(native.job))` and nowhere else. Without it
the criterion's single strongest line would have been carried by an inference.

All three restores `cmp`'d to **exit 0**.

## Assertions that cannot fail, labelled rather than left to be read as evidence

**`expect(aliceCids.map(String)).toEqual(bobCids.map(String))`.** Two `FsBlockstore.put`
calls over the same bytes in one process compute `CID.create(1, dagCbor.code, sha256(bytes))`
twice and cannot disagree, so **no behaviour of the code under test can make this fail.**
S1 shows what it *does* catch — a future edit staging different block lists — and the line
now says so in the source. The plan asked for it as a runtime guard; it is a structural one,
and it is labelled rather than deleted for 21-04's stated reason: a reader who finds an
equality beside real ones reads all of them as evidence.

**The wire case's step 5 was rewritten because the plan's ordering made it unable to fail.**
Written after the branch — as the plan's five steps specify — `expect(fetched).toBe(outcome.ok)`
reads `true === true` on whichever arm ran, because that arm has just asserted both halves
separately. It is now asserted **before** the branch, so a disagreement fires on that line
and each arm adds only what is specific to it. S3 confirms it can fail.

**The refused arm of the wire case did not occur on this host** and its remaining assertion
(`reason.length > 0`) has not been seen to fire. That is stated rather than implied. What
carries the arm structurally is the pre-branch cross-check plus an `if (outcome.ok) throw`
that makes it non-vacuous.

## Plan claims measured false

### 1. The refused arm's expected refusal text — **measured wrong for the reachable negative**

The plan requires, on the not-fetched arm, that `outcome.reason` *"contain
`artifactCid.toString()`"*. A known-negative was written to prove that assertion could
fire — a module CID no store held, dispatched to the same agent. It came back:

```
Received: "dispatch to 12D3KooWAe4ihoYPG9pFd9SLjx24Hia9GAjbteXjnqxjW6enYYjr failed: rpc to 12D3KooWAe4ihoYPG9pFd9SLjx24Hia9GAjbteXjnqxjW6enYYjr timed out after 60000ms"
```

**Sixty seconds, naming the peer, never the CID.** The cause is structural and is a finding
in its own right: `serveAgent`'s block branch answers out of the node's **network-fallback**
blockstore, not its local tier, so two mutually-connected nodes each ask the other for a
block neither holds and both spend their whole RPC budget before either can say
`module block missing`.

The plan's expectation is right for the failure mode this measurement is *about* — a peer
that answers with something unusable, an oversized frame or a block that fails its
`blockCid` check, all of which surface promptly as `module block missing: <cid>` — and
wrong for *"nothing can answer"*. So the arm now reports its reason rather than matching a
sentence, and the reason is recorded at the line with its date. The known-negative dispatch
itself was **removed** rather than kept: it cost 60 s of wall clock per run to re-learn a
fact now written down.

### 2. `<interfaces>` describes a spawn that would silently disarm the orphan leash

The plan gives the harness to copy as:

```ts
type AgentProcess = ChildProcessByStdio<null, Readable, Readable>
  // spawn(process.execPath, [AGENT, '--dir', dir, ...extraArgs], {stdio:['ignore','pipe','pipe']})
```

**Both halves are false of the file it names.** `sovereignty-placement.node.test.ts` uses
`ChildProcessByStdio<Writable, Readable, Readable>` and `stdio: ['pipe','pipe','pipe']`, and
its own comment says why: *"`bin/agent.ts` watches fd 0 and leaves when it closes… Handing
it `ignore` would put `/dev/null` on fd 0 and silently opt this file out."* Copying the
plan's version would have produced a file that spawns agents no interrupted run can reap —
a defect `orphan-leash.node.test.ts` exists to prevent, reintroduced by following the plan
literally. The real harness was copied.

The same block also omits `--trust-anchor` from `spawnAgent` (without it every dispatch is
refused by `guardModuleProvenance` before placement can be observed) and omits
`moduleRecord` and the required `onQuorumShortfall` from its `JobSpec` quote.

### 3. The line citations are stale again — with two exact exceptions

21-01, 21-02 and 21-04 each found this; located by content, never by offset.

| plan citation | actual |
|---|---|
| `fs-blockstore.ts:42` `open` / `:54` `put` / `:59` write / `:101-103` `#pathFor` | `:57` / `:69` / `:81` / `:116-118` |
| `fabric-node.ts:271-274`, `:359` (the `FetchingBlockstore` composition) | `:1680` |
| `core/src/ports.ts:51-53` (`ExecutionOutcome`'s two-arm union) | `:104-106` |
| `fixtures.ts:134` `MODULE_ECHOES_INPUT` / `:113` `MODULE_WRITES_PARTITION` | `:179` / `:128` |
| `sovereignty-placement.node.test.ts:57-90` `spawnAgent` / `:102-116` `stopAgent` / `:183-189` | `:90-127` / `:146-159` / `:242-250` |
| `admission.test.ts:144-164` `observe` / `:255` | `:152-164` / `:257` |
| **`packages/net/src/block.ts:108-123`, the `put` at `:120`, the rejection at `:112-118`** | **exact** |
| **`wasi-executor.ts:752` and the `not-dag-cbor` arm at `:693-694`** | **exact** |

The two exact ones are worth naming: both were cited from files this phase had already read
closely. The stale ones are all from files the plan cited from memory.

### 4. Task 1 is marked `tdd="true"` and no RED/GREEN split is possible

The task's only artifact is a spec, and every production symbol it exercises landed in
21-03. A RED commit would have been a passing test. The falsifiability the TDD marker is
*for* is delivered by Task 2's captures instead, and by the three spec-level plants above —
which is a stronger reading than a RED commit would have been, because it shows the
assertions can fail *after* the implementation exists rather than before it.

## Deviations from plan

### 1. [Rule 3 — blocking] The artifact is cached under a gitignored path, keyed on the guest source

Not in the plan. The plan puts two ~2-minute lifts in `beforeAll`, and `vitest.config.ts`
records in its own words what that costs: *"work done in `beforeAll`/`beforeEach` is
invisible to the instrument this table is derived from."* Measured here, directly (see the
span section): a run whose hook performed a real lift read **2 804 ms** to the JSON reporter
against `real 116.38 s`.

`vitest.config.ts` is not this plan's file, so the entry that would exclude this spec from
`test:unit` cannot be added by me. Caching does not make the cost visible — it makes it
happen **once per host** instead of once per run, which is the part I can fix from inside my
own file. The path is `tools/aot/fixtures/lifted-<label>-<sha256 of the C, 16 hex>.wasm`,
matching `.gitignore`'s `tools/aot/fixtures/lifted-*.wasm`, so a warmed host leaves
`git status --porcelain` unchanged — which `bench-attestation.node.test.ts` depends on.

**The limit is stated at the line rather than papered over:** the key covers the guest C and
not the toolchain, so a re-pull of `ELFCONV_IMAGE_TAG` that moved the image would not move
the hash. Reimplementing `translationCid` there would be a second source of truth; deleting
the file, or setting `O2_AOT_ARTIFACT`, is the escape hatch.

### 2. [Rule 1 — bug] The wire cross-check was ordered so it could not fail

Fixed by hoisting it above the branch. Recorded above.

### 3. [Rule 1 — bug] The refused arm's reason assertion was written from an assumption

Fixed by measurement. Recorded above.

### 4. `observe` picks fields rather than spreading the verification

`admission.test.ts`'s `observe` spreads the whole `VerificationResult`, which across two
real processes would drag in per-node attestations that are not properties of the artifact.
This one names exactly the fields the plan lists — `partitionIndex`, `inputCid`, status,
`output`, `resultCid` — plus the **sorted `agreeing` node ids**, which is a real
cross-check and was measured to hold. Reimplemented rather than imported, with the
one-line reason the plan asked for.

## Span movement — reported rather than left to be discovered

| run | instrument | reading |
|---|---|---|
| warm cache | `--reporter=json` file span | **4 101 ms** |
| warm cache | solo `/usr/bin/time -p real` | **5.28 s** (`user 8.21 sys 1.88`) |
| hook performed a real CLI lift | `--reporter=json` file span | **2 804 ms** |
| the same run | solo `real` | **116.38 s** (`user 8.62 sys 1.91`) |
| fully cold, both guests lifted | solo `real` | **260.67 s**; per-case durations 1 607 + 1 248 + 980 = 3 835 ms |

**The two instruments agree on a warm host and disagree by two orders of magnitude on a
cold one**, which is exactly `vitest.config.ts`'s recorded failure mode with a fresh
measurement attached. On a warm host this file is a **4.1 s** entry — above `SLOW_CUTOFF_MS`
— and belongs in `MEASURED_NODE_SPANS`; on a first run on a new host it is ~260 s that the
JSON reporter will file at ~4 s. Whoever owns that table should know both numbers.

**The file-count drift is now exactly at tolerance.** `NODE_PROJECT_FILES` computed by
`slow-specs.node.test.ts`'s own rule: **149** against a recorded `files: 144`, **drift 5,
tolerance 5**. 21-04 recorded drift 3; this plan adds one file and another agent's
`speculation-agents.node.test.ts` adds the other. `slow-specs.node.test.ts` passes 9/9
today, and **the next test file added anywhere in the node project reddens it.**

> **The prediction came true and has since been cleared. Three readings, 2026-08-05.**
> 20-11's `checkpoint-agents.node.test.ts` was the next file added; drift went to **6 of 5**
> and `slow-specs.node.test.ts` went red, which `21-VERIFICATION.md` records as W2 and
> attributes — correctly — to a concurrent phase rather than to this plan. The table was
> then retaken in full on 2026-08-05 at `files: 150`, and a run today reads
> `npx vitest run --project node packages/node/src/slow-specs.node.test.ts` → **EXIT=0,
> 9 passed**. So the sentence above is a dated snapshot that was accurate, then false, and
> is now accurate again — which is the property of every count in a summary and the reason
> this note records the reading and its date rather than editing the number.

## What was measured, at the end

| run | result | detail |
|---|---|---|
| `npx tsc --noEmit`, **final** | **EXIT=0** | whole tree |
| `npx vitest run --project node`, **final and whole** | **EXIT=1**, 2 failed \| **147 passed (149 files)**; 3 tests failed \| **2140 passed** \| 2 skipped; `real 696.93 user 330.57 sys 72.50`, ratio **0.58** | both failing files are other agents'; `aot-dispatch.node.test.ts` is **green inside it** and does not appear in the failure list |
| `npx vitest run --project node packages/aot packages/node` | **EXIT=1**, 2 failed \| 71 passed (73 files); 2 tests failed \| 898 passed \| 2 skipped | an earlier reading; both failures attributed below |
| `npx vitest run --project node packages/node/src/aot-dispatch.node.test.ts` | **EXIT=0**, 3 passed | cold and warm |
| `npx vitest run --project node packages/node/src/slow-specs.node.test.ts` | **EXIT=0**, 9 passed | drift 5 of 5 |

Every exit code was read with `EXIT=$?` on the line immediately after the command, output
redirected to a file and the file grepped afterwards. No pipe, no trailing `tail`.

The 0.58 CPU-time ratio on the whole run is lower than the 1.36 `vitest.config.ts` records
for its own baseline, and it is a comparability key rather than a verdict: this run
overlapped three other agents' work, and much of its wall clock is spent waiting on spawned
child processes rather than being denied CPU.

### Three intermediate readings that cleared on their own, recorded because re-running before diagnosing is the rule that produced them

**`npx tsc --noEmit` read EXIT=1 twice mid-session**, with three errors, all
`packages/node/src/speculation-agents.node.test.ts — Cannot find name 'PUBLIC_AGENTS'` and
**zero in either of this plan's files**. That file is another agent's, was untracked, and did
not exist when this plan started. It was re-run rather than diagnosed, then re-run again at
the end and came back **0** with nothing on this side changing. Nothing outside this plan's
two files was touched.

### The failures in each run, attributed by the diff in their own messages

| run | file | what it said | the evidence |
|---|---|---|---|
| final | `acceptance-traceability.node.test.ts` | `"BENCH-03 is now named in a title by packages/node/src/speculation-agents.node.test.ts — delete this exemption"` | **The finding names the causing file, and it is not mine.** |
| final | `late-combine.node.test.ts` | `expected 1500 to be greater than 7294.76…`, and a second case red | A within-run ratio between a constant `RPC_TIMEOUT_MS` and a measured healthy time. **21-02 and 21-04 both recorded this identical file failing this identical way**, and an agent is live on it now. |
| earlier | `bench-attestation.node.test.ts` | `expected ' M packages/bench/src/perf-workload.t…' to be ' M packages/bench/src/perf-workload.t…'` | The `git status --porcelain` sweep. The three lines that moved are `packages/core/src/job/submit.test.ts`, `submit.ts` and `packages/net/src/reduce-job.test.ts`, all going from staged to gone — 20-08 committed them mid-run as `51bed18`. **No file of this plan appears in the diff.** It passes in the final run. |
| earlier | `speculation-agents.node.test.ts` | `ReferenceError: PUBLIC_AGENTS is not defined` | The same untracked mid-edit file the `tsc` errors named. Green in the final run. |

`packages/aot` is green in every run above, and `packages/node/src/aot-dispatch.node.test.ts`
is green in every run above.

**The final run reports 149 files**, which is exactly the count the drift arithmetic below
predicts — the two instruments agree.

## A finding for whoever owns the block path

**A dispatch naming a module block nobody holds costs a full RPC timeout, not a prompt
refusal.** `serveAgent` answers a `block` request out of `node.blockstore` — the
network-fallback tier — rather than out of `node.store`, so two connected nodes each ask the
other for a block neither has. Measured on this host on 2026-08-04 with a 60 000 ms
requestor budget:

```
dispatch to <peer> failed: rpc to <peer> timed out after 60000ms
```

`FetchingBlockstore`'s `#inFlight` map de-duplicates *within* a node, so this is not an
infinite loop; it is a mutual wait that unwinds on timeouts. Not fixed here — neither file
is this plan's — and stated as a measurement rather than as a diagnosis of intent, since the
serving branch's own comment shows the fallback tier was a deliberate choice for the case
where a node legitimately can relay a block onward.

## Known limits, stated rather than implied

- **Two OS processes on ONE host.** It is the strongest available check that the translated
  artifact is byte-deterministic across processes — two V8 instances, two
  `WebAssembly.compile` calls, two WASI environments, one compared digest — and it is
  **not** evidence about a second machine. `CROSS_MACHINE_BLIND_SPOT` is untouched on both
  artifacts and still printed by the CLI.
- **The browser tier's runtime behaviour is still unmeasured.** The composition landed in
  21-03 and is structurally present; nothing here runs a translated artifact in a tab. That
  is the gap `WIRE-03` carries and it must not be reported as met.
- **The sovereignty path was not exercised here.** Every shard is `public`; `guardSovereignty`
  is traversed and no-ops. DATA-09's WASI reading is `fabric-node.node.test.ts`'s.
- **The refused arm of the wire case never ran**, so its remaining assertion has not been
  observed red. What the arm rests on is the pre-branch cross-check, which S3 shows can fail.
- **The WASI arm is still unbounded by a wall-clock deadline**, carried forward from 21-03
  untouched. A WASI guest that never returns holds the agent's main thread. Nothing here
  changes that and nothing here measures it.
- **`REACHABILITY_BLIND_SPOT` stays on both artifacts.** 174 untranslated addresses each;
  neither guest reached one on this host, on these runs, which is not a statement that they
  are unreachable in general.
- **The re-tag half of AOT-02 remains a closed measured negative on this host.** Not
  re-litigated; nothing here touches `resolveImage`.
- **`clean → 0` is still unmeasured from the CLI.** Both guests here are `reservations`.

## Which criteria I believe are now met, and which are not

**A verifier decides this; what follows is what I measured.**

Roadmap criterion 3 / AOT-04's runtime clause, taken phrase by phrase:

| clause | state | reading |
|---|---|---|
| *"A translated artifact produced by `tools/aot/cli.ts`"* | **met** | the spec's own `beforeAll` ran `tools/aot/cli.ts` as a program, `origin=cli status=2`, key CID printed and logged |
| *"dispatched to a live node started via `bin/agent.ts`"* | **met** | two spawned processes, `--dir` and `--trust-anchor` only, no new flag; `git diff` on `bin/agent.ts` empty |
| *"executes successfully"* | **met** | `complete: true`, four shards `agreed`, each output the shard's own value |
| *"the node constructs a real `WasiExecutor` in production"* | **met, by equality and mutation** | the field-for-field match with a source-compiled run, plus Mutation A turning that job into eight `wasi_snapshot_preview1` instantiate failures |
| *"completing the same admission and verification path as a source-compiled module"* | **met** | same provenance guard, same capacity gate, redundancy 2 with both peer ids in every shard's `agreeing`, and `observe()` equal including both fuel totals and the multiplier |
| the wire-transfer question (21-CONTEXT risk 3) | **answered as a number** | 5 660 003 bytes crossed in 158–689 ms and executed |

**Not met, and named:** the browser tier's runtime behaviour (WIRE-03); anything
cross-machine (AOT-03's descoped half); AOT-02's re-tag clause (a measured negative from
21-02, untouched here).

**`.planning/REQUIREMENTS.md`, `STATE.md` and `ROADMAP.md` were not modified**, per the
execution instruction naming this plan's two files in a shared working tree. AOT-04's row
currently says its outstanding half is *"the ABI verified against a real elfconv artifact
rather than a hand-written fixture, across real processes (Plan 21-05)"* — **that sentence
is now false**, and its owner should know. Every clause of it is measured above.

## Self-Check: PASSED

- `packages/node/src/aot-dispatch.node.test.ts` — FOUND, **942 lines** (plan asked for ≥ 220), 3 cases
- `b0dd390` — FOUND in `git log`; `git show --stat` shows **one file**, in a checkout where three other agents had work staged and unstaged throughout
- `packages/aot/src/abi-router.ts` — byte-identical to its post-21-03 state; both `cmp` restores exited **0**; `git status --short packages/aot/src/abi-router.ts` empty
- All three spec-level plants restored, each `cmp`'d to **0**
- No `git checkout`, `git stash`, `git reset`, `git clean` or `git branch` was run at any point; every `git add` and every `git commit` named this plan's files explicitly
- `npx tsc --noEmit` — **EXIT=0** on the whole tree, read directly from `$?`
- `npx vitest run --project node packages/node/src/aot-dispatch.node.test.ts` — **EXIT=0**, read directly from `$?`
- `npx vitest run --project node` (whole project) — **EXIT=1**, 147 of 149 files passing; both failing files named above with the evidence that neither is this plan's

## Correction 2026-08-05 — one figure was reported false and the report is what was wrong

**Original wording, retained verbatim and unchanged in the table above:**

> | elapsed | **158 / 177 / 689 ms** across three runs |

`21-VERIFICATION.md`'s row 2 records this as *"Not reproducible at that magnitude.
Measured 4 657 ms here."* **That verdict does not survive re-measurement, and the original
figures do.**

Re-measured 2026-08-05 on this host, four consecutive runs of
`npx vitest run --project node --reporter=verbose packages/node/src/aot-dispatch.node.test.ts`,
exit code read with `EXIT=$?` on the next line, no pipe:

| run | 1-minute load | `[aot-dispatch] wire:` |
|---|---|---|
| 1 | 2.68 | `5660003 bytes, 152ms, fetched=true, ok=true, dir grew 3→5` |
| 2 | 4.77 | `5660003 bytes, 146ms, fetched=true, ok=true, dir grew 3→5` |
| 3 | 4.55 | `5660003 bytes, 153ms, fetched=true, ok=true, dir grew 3→5` |
| 4 | 4.66 | `5660003 bytes, 155ms, fetched=true, ok=true, dir grew 3→5` |

All four exit 0. All four sit **at or below the lowest** of the three originally recorded
values, and the spread across them is 9 ms. The verification's 4 657 ms was taken during a
pass that says of itself that it deliberately avoided a full sweep because *"three agents
were editing the tree throughout"* — so the disagreement is the host, not the figure, and
the direction of the disagreement is the one a contended host produces.

**Two things are corrected, not one.**

1. The summary's `158 / 177 / 689 ms` stands. The re-measured band is added beside it in
   the table above rather than replacing it, because two readings on two days at two loads
   are two readings.
2. `21-VERIFICATION.md`'s row 2 is itself measured false and now carries a dated note
   saying so. A refutation with a number in it is not a refutation until the number is
   taken under conditions the original claim can be compared against — *"a number that
   agrees with a theory is not the theory's proof"*, which cuts both ways.

**What was true in the verification's finding and is kept:** `689 ms` against `146 ms` is
itself a 4.7× spread within the original three runs, so an absolute wall clock here was
never a reproducible quantity. That is an argument for recording the load beside it, which
this correction does, and not an argument that the figures were wrong.

---
*Phase: phase-21-aot-translation-signing-runtime*
*Completed: 2026-08-04*
*Corrected: 2026-08-05*
