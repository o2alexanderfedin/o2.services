---
status: investigating
trigger: "Three tracked defects: #78 (imageIsPresent does not retry ETIMEDOUT -> 7 silent skips), #79 (speculation-agents straggler bound is absolute wall-clock, no load gate), #59 (slow-specs failure message names --reporter=json, the instrument that lies)"
created: 2026-08-05T13:35:00Z
updated: 2026-08-05T13:35:00Z
---

## Current Focus

hypothesis: (multi-defect session; per-defect focus below)
test: read each site by symbol before forming hypotheses
expecting: three independent confirmations or refutations
next_action: Read tools/aot/lift.node.test.ts imageIsPresent() in full, including its docblock

## Symptoms

expected: |
  #78: imageIsPresent() returns a truthful answer about image presence, or fails loudly; a slow
       daemon must not be indistinguishable from an absent image
  #79: the straggler-threshold assertion in speculation-agents.node.test.ts holds regardless of
       machine load, because it compares two spans measured in the same run
  #59: slow-specs' failure message names a measurement procedure that actually works
actual: |
  #78: retry set is {EAGAIN, EMFILE, ENFILE, ENOMEM}; execFileSync timeout yields code
       'ETIMEDOUT' (errno -60, signal SIGTERM), which is a string but not in the set -> returns
       false -> 7 integration cases skip silently
  #79: absolute wall-clock bound; under two concurrent full node suites read
       "expected 1336.34 to be greater than 1542.23"
  #59: failure message tells the next person to re-measure with --reporter=json, which stamps
       startTime at the FIRST CASE, not at file pickup (143 ms against a real 4664 ms)
errors: |
  #79: expected 1336.34 to be greater than 1542.23
reproduction: |
  #78: make `docker image inspect` take >60s (or plant the throw) and observe skip
  #79: run node suite under concurrent load
  #59: read the failure message text
started: |
  #78: introduced with the retry set; docblock claims the unnamed-skip bug was fixed
  #79: pre-existing absolute bound
  #59: pre-existing message text

## Eliminated

## Evidence

- timestamp: 78-1
  checked: execFileSync failure shapes, measured directly (node, this host, /tmp/measure-shapes.mjs)
  found: |
    nonzero-exit   -> code undefined, status 7        (typeof code !== 'string')
    missing-binary -> code 'ENOENT', errno -2         (string, not in retry set)
    timeout        -> code 'ETIMEDOUT', errno -60, signal 'SIGTERM', status null
  implication: |
    All three currently fall through `typeof code !== 'string' || !HOST_SPAWN_RETRY_CODES.has(code)`
    to `return false`. The first two are MEASURED absence and are correct. ETIMEDOUT is
    NOT measured absence — the call never got to ask — and returning false asserts a fact
    that was never observed. #78 confirmed real.

- timestamp: 78-2
  checked: tools/aot/lift.ts:722-735 (resolveImage)
  found: |
    The production driver already distinguishes this exact pair, with the reasoning written out:
    "A daemon that never answered is not a missing image. Reporting `image-absent` here ...
    would send someone to pull six gigabytes they already have."
  implication: The gate contradicts the driver's own stated principle. Fix shape is not mine to invent.

- timestamp: 78-3
  checked: tools/aot/lift.node.test.ts:1326-1334 (despiteAFullProcessTable)
  found: |
    "A host too loaded to fork and a host too loaded to answer an inspect are the same
    condition wearing two labels; only one of them was retried." Added 2026-08-02 against a
    reproduced failure — applied to the wrapper, never to the gate.
  implication: |
    The gate is the pre-2026-08-02 wrapper. The repo already decided this question once.

- timestamp: 78-4
  checked: 7 x it.skipIf(!HAVE_IMAGE) at 2515/2529/2546/2574/2588/2622/2633 + beforeAll:2478
  found: exactly seven cases plus the beforeAll early return
  implication: the "seven cases skip silently" count in the report is exact.

- timestamp: 79-1
  checked: baseline + loaded runs of the criterion-3 case, both instruments printed together
  found: |
    | load | whole-arm median | old threshold | frozen solo | old margin | judgement median | new threshold | elapsed solo | new margin |
    | 4.5  | 19 ms  | 29 ms  | 705 ms | 24x   | 19 ms | 29 ms | 249 ms | 8.6x |
    | 9.6  | 542 ms | 813 ms | 829 ms | 1.02x | 29 ms | 43 ms | 250 ms | 5.8x |
    | 16-27| -      | -      | -      | -     | 40 ms | 60 ms | 247 ms | 4.1x |
  implication: |
    Reproduced the mechanism: at load 9.6 the OLD bound was 16 ms from the reported failure
    (829 vs 813). Numerator moved 1.2x, denominator 28x. Wait-bound vs CPU-bound asymmetry.

- timestamp: 79-2
  checked: plant — solo replaced by a healthy already-settled dispatch
  found: FIRST ATTEMPT LEFT IT GREEN. stragglers() reads `now - startedAt` only and cannot
    tell an in-flight task from a settled one; the healthy dispatch also started at the top
    of the job, so it cleared the threshold.
  implication: the fix was incomplete. Added the in-flight precondition. Plant then went red.

- timestamp: 59-1
  checked: ran slow-specs unplanted
  found: the drift guard FIRED FOR REAL and printed the corrected message in full — no plant
    needed. Failure is 157 files vs 150 recorded, caused by 3 untracked files belonging to
    concurrent agents (bench-driver, job-entry-points, opt-in-only-sources). HEAD is 154.
  implication: pre-existing and not mine; my diff touches none of the drift inputs.

## Resolution

root_cause: |
  #78 `ETIMEDOUT` is a string, so it passed `typeof code !== 'string'` and then missed
      HOST_SPAWN_RETRY_CODES -> `return false` -> the gate asserted an absence it never
      measured -> 7 silent skips. Same defect despiteAFullProcessTable fixed 2026-08-02.
  #79 the assertion re-derived the production rule and got a stricter one: final duration
      vs elapsed, and whole-arm median vs median-at-judgement. The two spans answer to load
      differently (SIGSTOPped = wait-bound; healthy = CPU-bound).
  #59 the message named `--reporter=json`, which stamps startTime at the first case.
fix: |
  #78 three-way verdict (present / measured absence / could-not-ask), ETIMEDOUT retried,
      retries bounded by duration, and a case that names an indeterminate gate.
  #79 put the three frozen dispatches to production `stragglers()` at the scheduler's own
      judgement instant with the sample it held, plus an in-flight precondition.
  #59 message now names MEASURED_NODE_SPANS's procedure and the solo /usr/bin/time -p step.
verification: |
  #78 plant (real ETIMEDOUT via timeout:1) -> red with measurement; pre-fix reconstruction
      -> green with 7 silent skips and 0 containers; happy path proved present:true.
  #79 two plants, both halves red; 3 load regimes green.
  #59 guard fired naturally and printed the new text; control (tolerance 7) -> 9/9 green.
files_changed:
  - tools/aot/lift.node.test.ts
  - packages/node/src/speculation-agents.node.test.ts
  - packages/node/src/slow-specs.node.test.ts
commit: 4f8a8cf
