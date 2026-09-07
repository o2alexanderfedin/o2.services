# 39-06 — SUMMARY: the switch can be watched from outside, and the object it would be watched on refuses the write

**The instrument was built, proved able to see the property, and then it found that the exercise
it was built for cannot be performed today.** The deployed object answers **409 to every write to
`POST /admission`, whatever key is presented** — not because of the key, but because it carries no
region label. That is measured rather than reasoned: a local `workerd` booted with **no**
`O2_REGION`, which is the deployed object's own reported configuration, refuses a correctly-keyed
halt twice, addressed two different ways, with a body containing `serves no region`, and does not
move. **Zero requests of any kind were sent to the deployed object.**

`REQUIREMENTS.md`, `ROADMAP.md`, `STATE.md` and `OWNER-ACTIONS.md` were **not** touched. `RUN-07`
is not claimed closed: this plan builds the instrument and the comparison rule, and whether the
control is actually exercised in front of a cohort is an act, not a mechanism — and it is an act
that is presently blocked.

## What landed

- `tools/run/switch-observation.mjs` — plain ESM, zero dependencies, one platform import
  (`node:process`) used only by the CLI arm at the bottom. Exports `sampleAdmission`,
  `observedWindow`, `largestGapMs`, `withinBaseline`, `observationReport`, `renderedVerdicts`,
  `disagrees`, `longestDisagreementRun`, the four Phase 36 constants restated, the status page's
  two verdict literals, `DEGRADED_GAP_FACTOR` and `DISAGREEMENT_RUN_FOR_STOP`.
- `packages/node/src/switch-observation.node.test.ts` — 25 cases, including two local
  `wrangler dev` children on their own ports (8825, 8826) with their own `mkdtempSync` persist
  directories.
- `.planning/phases/phase-39-the-public-run/39-KILL-SWITCH-DURING-RUN.md` — the baseline, the
  band, the plane distinction, the owner's six-step script with its preconditions, and five stop
  arms.

All three in commit `8db138f`. `git show --stat` lists exactly those three files and nothing
else.

## The finding: the switch cannot be flipped in production today

`refuseMisaddressed` in `packages/cloudflare/src/admission-flag.ts` opens with a branch that does
not look at the request at all — *"an object with no region label refuses every region-addressed
write"* — and `worker.ts` calls it unconditionally on the way to the store, after the key check
and before `writeDirective`. The deployed `/self`, read live 2026-09-04 and quoted in this plan's
own `<interfaces>` block rather than re-read by any agent, answers
`"admission":{"region":null,…}`. `readDirective` fills that field from the object's own
deployment label and never from a request, so a `null` there says the label never arrived — which
is exactly the input every write is refused on.

**The composition of those two facts is an inference, so it was replaced with a reading.** The
spec boots a second child with no `O2_REGION` and asserts, in one case, that it reports
`region: null` *and* refuses a correctly-keyed halt `409` — addressed `null` and addressed
`bootstrap-eu`, both — and that the object does not move afterwards. The `region: null` assertion
comes first on purpose: a child that reported a region anyway would not be the deployed shape and
the refusal would be about something else.

What releases it is `36-RUNBOOK.md` **act 2**, an owner act that was never performed: redeploy
with `--var O2_REGION:<one of the three names>`. **Act 1**, `wrangler secret put
O2_ADMISSION_KEY`, was also never performed and is the other precondition. §0 and §3 of the
document give both checks as scripts with what to read back and what means stop; the region check
is read-only and costs one request.

Phase 36's own runbook already said an unlabelled object refuses every region-addressed write. It
did not say that the *deployed* object is such an object. That is what is new here, and it is why
criterion 5's exercise had to be priced before it was scheduled rather than improvised while
several hundred volunteers are connected.

## The two planes, which is the correction the plan made to its own instrument

Phase 36's `PROPAGATION_WINDOW_MS = 29_880` is a **tab-side** figure: the maximum over six
browser tabs of the delay between the write returning and that tab's own thirty-second poll
noticing, recorded inside each page. This sampler reads `GET /self`, which is the **object's own
state**, and that state changes at the write. Its window is therefore bounded by its own sampling
cadence **by construction** and can never reproduce 29 880 ms.

Comparing the two in milliseconds would have compared different quantities. What is comparable is
the ratio, and that is not a convenience — it is `propagation-window.ts`'s own finding, taken
across a fifteen-fold change of interval inside one run: *"the window's dominant term is the poll
interval and nothing else contributes materially."*

So `withinBaseline(windowMs, intervalMs = PROPAGATION_INTERVAL_MS)` answers **three** things
rather than one: the `ratio`, the `within` band verdict, and `comparable` — whether the
millisecond band is about the same quantity at all. At any cadence other than 30 000 ms the tool
prints *"not comparable to the published 29 880 ms band, which describes a series taken at
30 000 ms over 6 tabs"* and reports the ratio instead of a verdict it has no right to give.

**Six readings of the live arm, taken across every run of the spec after the grid landed, all at
a 1 000 ms cadence and all `measured`:**

| run | window | ratio | largest gap |
|---|---:|---:|---:|
| plant 1 | 999 ms | 0.999 | 1 006 ms |
| plant 2 | 998 ms | 0.998 | 1 008 ms |
| green (grid) | 1 001 ms | 1.001 | 1 007 ms |
| green | 1 000 ms | 1.000 | 1 004 ms |
| green | 1 002 ms | 1.002 | 1 002 ms |
| green (final) | 995 ms | 0.995 | 1 004 ms |

Spread 0.995 to 1.002, against Phase 36's **0.996** at a cadence thirty times longer. Two planes,
two cadences a factor of 30 apart, both at a ratio of about 1 — which is the same shape
`propagation-window.ts` reported with its two arms, and it is the only comparison the two
readings support. The raw milliseconds have nothing to say to each other.

## The harness was wrong before the instrument was, and the instrument said so

The first run of the live arm printed

```
[switch-observation arm] kind=degraded window=2022 ms interval=1000 ms ratio=2.022 gap=2022 ms samples=4
```

Nothing was broken. The arm was written the obvious way — sample, sleep, write, sleep, sample —
so the write's round trip landed *between* two waits and the series carried a hole of two
intervals exactly where the flip happened. A window read across a hole is an upper bound, and
`observationReport` said `degraded` because that is what it is for.

The repair is the arm now sampling on an **absolute grid** while the flip is written beside it,
which is the CLI's own arrangement rather than a convenience. The reading moved from 2 022 ms at
ratio 2.022 to the table above. **The degraded classification proved itself by firing on a real
series before it ever fired on a synthetic one.**

## The straddle: running the CLI before trusting it found a live defect

The CLI was exercised against a throwaway origin in the scratchpad that flipped mid-run. It
printed, in one sample,

```
[switch-observation] 2026-09-07T09:16:33.922Z halted=false region=null since=null status=halted:1 admitting:0
…
[switch-observation] verdict stop
```

`/self` said not-halted and the status page said halted, and the verdict came back `stop`. Again
nothing was broken: the sampler reads `/self` and *then* the status page, about a millisecond
apart, and the flip landed between the two reads. **Every run that observes a transition at all
produces exactly one such sample**, so a stop rule keyed on a single disagreement fires on
precisely the runs that worked.

Fixed under deviation rule 1. The predicate is now two exported functions rather than four lines
inside the CLI — `disagrees(halted, verdicts)` for one sample and `longestDisagreementRun` for
the series — and the stop needs `DISAGREEMENT_RUN_FOR_STOP = 2` consecutive. One straddle is two
reads at two moments; two in a row is one of the routes being stale, which is the thing the rule
exists to catch. Both are covered by cases, including the straddle itself as a fixture.

## The limitation that would have made the document script a read-back that cannot happen

`--status` is **inert against the page this project publishes.** `status.html` is a shell;
`status.ts` builds every card inside `render()` and assigns `root.innerHTML` in the browser, so a
`GET` on the published page returns markup containing neither verdict string. The CLI proof above
passed only because the scratchpad origin served the verdicts in raw HTML — the wrong shape.

This is the same class of error as the plane conflation: an instrument documented to read
something it cannot read. It is now measured rather than caveated — a case reads
`packages/browser/demo/status.html` and asserts `renderedVerdicts` answers `{halted: 0,
admitting: 0}` — and the case is also what retires the note, because server-rendering the page
reddens it.

Three consequences, all carried into the document: the sampler carries `/self` only, the status
page is read back in the owner's own browser at step 4, and **stop arm B cannot fire against this
deployment** — which is said out loud so nobody reads its silence as agreement. Step 1's command
line no longer passes `--status`, and the exercise's cost is correspondingly **36 Durable Object
requests**, not 72.

## The RED, verbatim

```
 FAIL  |node| packages/node/src/switch-observation.node.test.ts [ packages/node/src/switch-observation.node.test.ts ]
Error: Cannot find module '../../../tools/run/switch-observation.mjs' imported from /Volumes/ProjectsSSD/Projects/o2.services/packages/node/src/switch-observation.node.test.ts
 ❯ packages/node/src/switch-observation.node.test.ts:91:1
```

`Test Files 1 failed (1)`, `Tests no tests`, exit `1`, at `wall clock 0.64 s` on a host the
banner reported quiet at load/core 0.39. The spec was written first and every case failed at the
import, which is what says the module's shape is checked by this file at runtime — `tsc` sees
`any` through the `@ts-expect-error TS7016` suppression and checks nothing.

## Both plants, watched red, verbatim

Each was planted by a one-line edit, run, restored by the **inverse of that same edit**, and
`cmp`-verified against a snapshot taken immediately before planting. `cmp` exit `0` and silent
both times, and the post-restore file also `cmp`s clean against the plant-1 snapshot — so the two
plant/restore cycles left the file byte-identical to where it started.

**Plant 1 — `sampleAdmission` answers `halted: false` on an unparseable body instead of
throwing.** T-39-29. One line: the first guard's `throw` replaced by
`return { halted: false, region: null, versions: 'all', since: null, note: '' }`.

```
 FAIL  |node| … > the sampler reads a directive or refuses to answer > throws on a body that is not shaped like `/self`, and never answers a default
AssertionError: T-39-29: `sampleAdmission` answered rather than threw for null. A sampler that reads an unreadable body as "not halted" reports a working fabric during an outage, and the mid-run exercise would record a clean run it never saw.: expected [Function] to throw an error
```

`Tests 1 failed | 21 passed (22)`, exit `1`.

**Plant 2 — `observedWindow` answers `0` instead of `null` for a list that begins already
halted.** T-39-30, and the plan named it as the one this class of instrument most often fails.
One line: `if (series[0].halted) return null` → `return 0`. It is a **distinct early return**
rather than a consequence of the search, precisely so the plant is a one-word edit.

```
 FAIL  |node| … > the window, and the transitions it must refuse to invent > answers null — never zero — for a sample list that begins already halted
AssertionError: T-39-30: a list that begins halted carries no observed transition. Answering 0 makes an unobserved flip indistinguishable from an instantaneous one.: expected +0 to be null

- Expected:
null

+ Received:
0
```

`Tests 1 failed | 21 passed (22)`, exit `1`. **Neither plant stayed green.** The `toBeNull()` in
that case is deliberate rather than stylistic: `0` is falsy, so a truthiness check would have
passed the plant.

## Every command, with the exit code read on the next line

| command | exit |
|---|---|
| `npx vitest run --project node switch-observation` (RED, module absent) | `1` |
| `/usr/bin/time -p npx vitest run --project node switch-observation` (first run, one of my own assertions had bad arithmetic) | `1` |
| `/usr/bin/time -p npx vitest run --project node switch-observation` (22 passed) | `0` |
| `/usr/bin/time -p npx vitest run --project node switch-observation` (grid arm, 22 passed) | `0` |
| `npx tsc --noEmit` | `0`, zero lines |
| `npx vitest run --project node switch-observation` (**planted 1**) | `1` |
| `cmp <tool> <snapshot-before-plant-1>` after the surgical restore | `0`, silent |
| `npx vitest run --project node switch-observation` (**planted 2**) | `1` |
| `cmp <tool> <snapshot-before-plant-2>` after the surgical restore | `0`, silent |
| `cmp <tool> <snapshot-before-plant-1>` again, after both cycles | `0`, silent |
| `node tools/run/switch-observation.mjs --self … --status … --interval 1000 --for 8000` (straddle defect found) | `1` |
| `/usr/bin/time -p npx vitest run --project node switch-observation` (24 passed, after the straddle fix) | `0` |
| `node tools/run/switch-observation.mjs …` (re-exercised, verdict `observed`) | `0` |
| `node tools/run/switch-observation.mjs --interval 5000` (no `--self`) | `2` |
| `node tools/run/switch-observation.mjs --self <dead origin> …` | `2` |
| `bash scripts/cheap-guards.sh` (two failures — one of them mine) | `1` |
| `bash scripts/cheap-guards.sh` (after the vocabulary fix) | `1`, sole failure `slow-specs` |
| `npx tsc --noEmit` (after the status-page corrections) | `0`, zero lines |
| `/usr/bin/time -p npx vitest run --project node switch-observation` (**final**, 25 passed) | `0` |
| `bash scripts/cheap-guards.sh` (final, 400 of 401) | `1`, sole failure `slow-specs` |
| `O2_SKIP_GUARDS=1 git commit -- <three paths>` | `0` |

`EXIT=$?` was on the line immediately after each, with output redirected to a file rather than
piped.

## Host conditions and cost

The final run:

```
[host conditions] host was quiet — load/core 0.38 before, 0.38 after (8 cores, ceiling 4.00)
[host conditions] wall clock 9.26 s

real 10.00
user 1.47
sys 0.38
```

`(user+sys)/real` is **0.185**, which is the expected shape for a spawn-bearing spec and not a
starved process: it boots two `wrangler dev` children sequentially and then spends four seconds
sleeping on a 1 000 ms sampling grid, so `real` legitimately exceeds CPU time. Every run in the
table above reported the host quiet, between load/core 0.31 and 0.58 against a ceiling of 4.00,
so every duration quoted here is quotable.

**Zero relay reservations and zero requests to the deployed object.** This spec opens no libp2p
connection at all — it speaks HTTP to two loopback ports. `ANNOUNCE_MULTIADDRS` is overridden to
loopback anyway, because `wrangler.jsonc` announces the deployed host and a local relay left at
that value hands its clients an address pointing at production. Nothing was deployed, published or
released, and the three `ocr-checks-worker*` scripts were not read or touched.

## The guard that reddened on my own prose — three times, and it was right each time

`vocabulary.node.test.ts` refused a docblock in the spec that described three forbidden strings
using the plural of a word the guard bans, because it reads as cryptocurrency to a reviewer who
greps rather than stopping to check the sense. Reworded to *strings*; nothing about the code
moved.

Then it refused this summary twice more. Once for the same word — used here, in a sentence
*about* the guard, to name the size of a plant. And once for a word that frames volunteered
compute as paid work, used idiomatically about a classification proving itself. **The guard is
right in all three cases and it is right for the same reason each time:** it scans text, not
intent, and a reviewer greping this repository will not stop to check whether the sentence
containing the word was discussing the word. A report about a vocabulary guard has to obey the
vocabulary guard. Both are reworded and the findings are described here rather than quoted.

That is now the fourth and fifth time in this repository's memory that a guard fired on an
agent's own edit and was right about it.

## Deviations from plan

Six, each inside the plan's own latitude or forced by a measurement, and none of the four
deviation rules fired except rule 1 on the straddle.

1. **The constants are imported from `../../browser/src/propagation-window.ts`, not from
   `@o2/browser`.** The plan's action says the latter. The barrel does not export
   `propagation-window.ts` — checked — and adding the export is outside this plan's writable set.
   `kill-switch-propagation.e2e.test.ts:68` is the tree's standing precedent for reaching it by
   relative path, and the plan's stated intent — *"two copies that cannot silently disagree"* — is
   fully preserved: the case asserts all four and names both sides in each failure message.
2. **`withinBaseline` takes an optional second argument and answers `comparable`.** The plan
   specifies `withinBaseline(windowMs)`; that call still works and still answers about the
   production interval. The addition is what the plane distinction requires — see above — and
   without it the tool would print a band verdict about a quantity the band is not about.
3. **`DEGRADED_GAP_FACTOR` is 1.5, not 1.** The plan says *"a gap longer than the poll interval"*.
   Taken literally that fires on every healthy run, because a sampler that waits an interval and
   then issues a request produces gaps of interval plus round trip — measured here at 1 002 to
   1 008 ms on a 1 000 ms grid. A missed sample doubles the gap; 1.5 separates the two
   populations, and it is stated as a judgement at the constant rather than buried.
4. **A second `wrangler dev` child, unlabelled.** Not in the plan. It is what turns the
   region-null finding from a two-step inference into one reading, and the finding is what this
   plan hands the owner. One extra boot, sequential, on its own port and its own persist
   directory.
5. **One commit for all three files rather than a commit per TDD gate.** Task 2's own action says
   *"commit with explicit paths naming all three files"* and its acceptance criterion requires
   `git show --stat` to list exactly those three. A separately-committed RED spec on a shared
   branch would also redden every concurrent agent's sweep. The RED was watched and recorded; the
   gate sequence is in this document rather than in the git history.
6. **`--status` is not passed in the document's step 1**, on the measurement in the section above.

## What this does NOT establish, stated rather than left to be found

**That the deployed object would behave as the local one does once it is labelled.** Everything
here is local `workerd`, which is the same limit Phase 36's ledger row already records for the
propagation figure. What is established is that an object *in the deployed object's reported
configuration* refuses every halt.

**Anything about a cohort.** The live arm is one process sampling one object. Criterion 5 exists
because *"a control that works at three tabs and not at three hundred is a control nobody has"*,
and nothing here is three hundred of anything. The sampler is the instrument that would take the
reading; the reading has not been taken.

**Anything on the tab-side plane.** The sampler cannot see inside a volunteer's tab and must not
claim to. The one tab-side observation in the exercise is the owner's own tab at step 4, a
population of one, compared as *within one poll interval* rather than against a band taken over
six.

**Open question 2 stays open.** The mechanism under both figures is a Durable-Object-storage poll,
not Workers KV, whose roughly sixty-second global propagation is what that question is framed in
terms of and which this project has still not measured.

## For plan 39-07

This spec moves the `node` project from **256 to 257** test files against a recorded 248 with a
tolerance of 5. `slow-specs/file-count-drift` was already red on this branch before this plan and
is still the sole failure of the guard set — 400 of 401 pass. `vitest.config.ts` was not touched.

## Threat flags

None. No new network endpoint, auth path, file access pattern or schema change. The sampler holds
no credential and has no write path, and a case asserts its text contains neither a
request-shaping option, nor the admission key header's name, nor `Authorization` — with that
case's own limits stated in its docblock. `request.cf` and `CF-Connecting-IP` are never read,
logged, snapshotted or committed. The document names the operator key only as an environment
variable and never a value, and names no hosted object's physical location.

## Known stubs

None. §6 of `39-KILL-SWITCH-DURING-RUN.md` is an empty table awaiting a reading, which is a
deliberate record-keeping slot for an owner act and not a stub: the plan asks for the observed
window to be recorded there after the exercise, and the exercise is blocked on §0.

## Self-Check: PASSED

- `tools/run/switch-observation.mjs` — FOUND
- `packages/node/src/switch-observation.node.test.ts` — FOUND
- `.planning/phases/phase-39-the-public-run/39-KILL-SWITCH-DURING-RUN.md` — FOUND
- commit `8db138f` — FOUND, `git show --stat` lists exactly those three files, 1 922 insertions
- the document carries `**Dated:** 2026-09-07` in its first 20 lines
- `grep -v '^#' <doc> | grep -c` returns 6 for `29 880`, 2 for `1 500`, 5 for `30 000`, 2 for
  `0.996`; `once, at submit` returns 1
- six bold-numbered steps in §3, step 5 is the un-halt
- `grep -inE 'frankfurt|london|são|sao paulo|virginia|us-east|eu-west'` on the document returns
  nothing, exit `1`
- `grep -c 'workers.dev\|github.io'` on the spec returns `0`, exit `1`
- ports 8825 and 8826 and the persist prefix `o2-switch-observation-` are used by no other file in
  the tree — `git grep` on the tracked set returns nothing else
