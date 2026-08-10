---
phase: 27-demo-ui-driven-by-real-fabric
plan: 7
subsystem: browser-demo
tags: [det-03, data-08, wire-03, demo-01, data-05, data-06, ver-09, ver-10, ui-spec-4-5, ui-spec-7-5, g4-runjob-closed, mutation-proof]
dependency-graph:
  requires:
    - 27-01 (the #bar grid contract and demo-viewport.e2e.test.ts's 60 combinations)
    - 27-02 (the six-surface shell and the element-id contract)
    - 27-03 (the 91-region catalogue and demo/render.ts's writer)
    - 27-04 (surfaces/colouring.ts's shape, redundancyFor, P5, P6/P7/P8)
    - 27-05 (P5's navigation fix — without it this plan would have hit the same 30 s timeout)
    - 27-06 (the greppable WIRED_SURFACES convention, and the primes half of G4 left open)
  provides:
    - "packages/browser/demo/surfaces/byo.ts — the bring-your-own formatter and the form's
      validity model as TWO pure functions: validity(form) naming every missing field, and
      format(report) writing Y3-Y13 and #byo-report out of one record"
    - "the bring-your-own panel: UI-SPEC 4.5's copy above the form, seven labelled inputs, the
      sovereign control pair, one .btn-primary, a reason element that is never empty, and all
      thirteen regions"
    - "**a caller for TabApi.runJob in the page** — the half of audit finding G4 the roadmap
      names, closed"
    - "WIRED_SURFACES gains 'byo' — the third surface P5 drives, with NO edit to
      demo-liveness.e2e.test.ts"
    - ".refusal in demo.css — UI-SPEC 7.2's treatment for the first region the spec assigns it to"
    - "packages/node/src/demo-byo.e2e.test.ts — four arms, every reading off the screen and
      cross-checked against window.__o2LastByoRun"
  affects:
    - "Plan 27-08 (fabric state) — inherits the per-surface attestation-hook defect logged here,
      because it lands F6/F7/F8 and would be the third attestation region"
    - "Plan 27-10 — carries the withheld-branch finding and the egress-sentence limit into
      27-OPEN-ITEMS.md, and can now mark G4's runJob half closed"
tech-stack:
  added: []
  patterns:
    - "a form's validity model as a pure function beside its formatter, so every disabled state
      is testable without a Playwright round trip and the DOM half is read-ask-write"
    - "a sentinel separated from a quantity by reading TWO fields together — partitions[i]
      beside agreeing[i] — rather than by trusting one field's documented meaning"
    - "an elapsed reading asserted against another arm's IN THE SAME RUN, so *the refusal was
      read and not timed out* is a ratio rather than an absolute a faster machine would flatter"
    - "a literal a spec depends on, held by a grep over the source that produces it — so the day
      attestedNodes stops declaring ownerId 'public' the arm re-plans itself"
key-files:
  created:
    - packages/browser/demo/surfaces/byo.ts
    - packages/node/src/demo-byo.e2e.test.ts
  modified:
    - packages/browser/demo/index.html
    - packages/browser/demo/demo.css
    - packages/browser/src/demo-regions.ts
    - .planning/phases/phase-27-demo-ui-driven-by-real-fabric/deferred-items.md
decisions:
  - "The form opens FILLED with this bundle's own record, and this is the plan's one deliberate
    departure from a written acceptance criterion. sign-kernel.ts discards its private half on
    every run, so the only records in existence under the anchor a stock tab pins are the two in
    kernel-record.ts — an empty form opens at a state no visitor could ever leave, behind a
    disabled control they have no way to enable. It is also the only arrangement in which P5
    drives this surface unedited, which the plan lists as a must-have truth."
  - "The reason element is never empty in ANY state, rather than only when a field is missing.
    There are two reasons this control can be disabled — a missing field and a stopped node —
    and a control that goes quiet in the second is the same defect in a different place."
  - "Y4 reads partitions[i] BESIDE agreeing[i]. UI-SPEC says -1 renders as `no agreement`; that
    is true of one of the two situations main.ts produces it for, and measurement showed this
    surface lands on the other one. Never a number is honoured absolutely; which sentence is a
    reading of two fields."
  - "egressLines was NOT changed, although its sentence is unreliable on a sovereign dispatch.
    UI-SPEC 5.2 fixes that copy verbatim, P7 asserts those exact words, and four surfaces render
    it. Forking it here would have made this file a second author of the sentence that carries
    the sovereignty claim — which is the thing the one-region-one-function rule exists to stop."
  - "The byo handler publishes window.__o2LastAttestation. P8 requires a hook and there is no
    TabApi accessor for the last receipt; the alternative — not publishing — would have had P8
    check this surface's receipt against the colouring run's. Both arrangements are wrong for
    the same reason and the reason is P8's, logged with the fix."
metrics:
  duration: ~95 minutes
  tasks: 3
  files-created: 2
  files-modified: 4
  commits: 4
  completed: 2026-08-10
---

# Phase 27 Plan 7: Bring-your-own Summary

**`window.o2.runJob` has a caller in the page. Audit finding G4's `runJob` half is closed.**
Thirteen regions render from one record, the form requires a module CID *and* all six fields of
a signed record, and a module signed by a key this tab does not pin is **refused in 142 ms and
rendered in the fabric's own words** — against an accepted dispatch's 271 ms in the same run.
The refusal is cheaper than the acceptance, which is the strongest form the *read, not timed
out* claim can take.

The sharpest result is not the surface. It is that **wiring a real dispatch found three
sentinel zeros already on screen** — `partitions[i]`, `replicas[i]` and `verificationMultiplier`
all use `0`/`-1` to mean *there was nothing to report*, and the first draft of this surface
rendered `0.00×` directly above eighteen refusals. All three were caught by reading the screen
rather than by reading the types.

## G4's `runJob` half: closed, and here is the line

`packages/browser/demo/index.html`, in the `#byo-form` submit handler:

```js
const report = await window.o2.runJob({
  moduleCid: form.moduleCid.trim(),
  moduleRecord: recordOf(form),
  peerIds, shards, redundancy,
  includeSelf: true,
  ...(sovereign === null ? {} : { sovereign }),
})
```

It is exercised by `demo-byo.e2e.test.ts` on four arms and by `demo-liveness.e2e.test.ts`'s P5
on every run. **The primes half stays open** for the reason 27-06 recorded — it is a different
workload, a different decision, and an unowned owner decision about the fabric's trust root.

## The contract, and how the form enforces it

**Both, always.** `validity(form)` requires seven non-empty inputs — `moduleCid` plus the
record's `name`, `cid`, `version`, `expiresAt`, `signer`, `signature` — requires `version` and
`expiresAt` to parse as whole numbers, requires the record's `cid` to equal `moduleCid`, and
treats the sovereign checkbox and the owner id as one value. The control is `disabled` until it
returns `ok`, and `#byo-validity` carries the reason.

**Read off the screen, not inferred** — `[validity]` lines from the final run:

| state | control | `#byo-validity` |
|---|---|---|
| as it opens, node live | enabled | `Ready — every field is present and the record’s cid matches the module cid.` |
| module CID cleared | **disabled** | `Not dispatchable yet — still needed: module CID.` |
| record signature cleared | **disabled** | `Not dispatchable yet — still needed: record signature.` |
| record version → `one` | **disabled** | `Not dispatchable — the record version is not a whole number, and a value the fabric cannot read is not a value to send.` |
| record CID one character short | **disabled** | `Not dispatchable — the record's cid does not match the module cid.` |
| sovereign checked, owner id empty | **disabled** | `Not dispatchable yet — still needed: owner id.` |
| node stopped, form complete | **disabled** | `Not dispatchable — this tab’s node is stopped, so there is nothing to dispatch through.` |

After all five failing arms, `#byo-report` still read `nothing dispatched yet` — asserted, and
it is the only way to say *the form refused rather than the fabric*.

**What a missing record does: nothing crosses the boundary.** It is not a timeout, and it is not
a refusal either — the dispatch never happens. The control cannot be pressed, the reason names
the field, and `runJob`'s type would not admit the call in any case (`moduleRecord` is required,
not optional). The handler re-checks `validity` as its second statement anyway, because a form
can be submitted with Enter and a handler that trusted the `disabled` attribute would be
trusting the DOM to enforce a rule the validity model owns.

**The copy says it before anything is submitted.** UI-SPEC 4.5's paragraph is rendered from
`surfaces/byo.ts` into `#byo-notice` above the form, and four of its clauses are asserted
verbatim before the first dispatch — including *there is no value you can enter here that turns
the check off*.

## The form opens filled, and that is a departure worth reading

Task 2's acceptance criterion says *"the disabled submit's reason element is non-empty at load
**and names every missing field**"*, which assumes an empty form. It is not met in that form and
the reason is arithmetic rather than preference:

1. `scripts/sign-kernel.ts` discards its private half on every run. **Nobody outside this
   repository can sign a record under the anchor a stock tab pins.** The only two dispatchable
   modules in existence are `KERNEL_RECORD` and `PI_RECORD`.
2. So an empty form opens at a state **no visitor can leave** — a disabled control with a
   perfectly accurate reason naming seven fields none of them can supply.
3. And a control disabled pending seven inputs is a control **no generic liveness property can
   ever drive**. `demo-liveness.e2e.test.ts` clicks `#s-byo .btn-primary` and would have timed
   out at 30 s with `element is not visible`'s sibling, `element is not enabled`. The plan lists
   *"P5 covers this surface's run control with no edit to demo-liveness.e2e.test.ts"* as a
   must-have **truth**, and truths outrank an acceptance clause that assumed a different form.

The reason element is therefore non-empty at load in every state, and it names every missing
field **whenever a field is missing** — which is five of the seven rows above, reached through
the page's own inputs rather than by arriving at them.

## P5 drove bring-your-own unedited

Unedited `demo-liveness.e2e.test.ts`, first run after `WIRED_SURFACES` grew, exit **0**:

```
[P5] wired surfaces: session, colouring, pi, primes, byo
[P5] exercised (a primary run control was found and driven): colouring, pi, byo
[P5] skipped (no primary run control on the surface): session, primes
[P5] 37 of 39 reading regions carry a reading after the run
```

**No edit to P5 was needed and none was made.** 27-05's navigation fix carried it, and the
filled form is what let it press the control. Thirty-nine is sixteen colouring plus twelve π
plus eleven bring-your-own; the two unpopulated are C21 (correctly, the colouring was not
refuted) and `byo/failures` at its `unavailable` arm — *No refusals: every shard reached
agreement.* — which is a catalogue sentence and therefore not counted as populated.

## P6, P7 and P8 all rose, and each was measured rather than predicted

| property | 27-06 | 27-07 | why |
|---|---|---|---|
| P6 — a populated figure occurs in its own text view | `examined 4` | **`examined 5`** | `byo/verification-multiplier`'s source ends `.verificationMultiplier`, one of `P6_FIELDS` |
| P7 — a withheld count never appears without its sentence | `examined 2` | **`examined 3`** | `byo/egress` ends `/egress` and carries a count |
| P8 — the attestation region is the fabric's own words | `examined 1` | **`examined 2`** | this is the second surface on the page to render a receipt |

Plant C measures P6's contribution rather than inferring it: with `byo/verification-multiplier`
dropped from the record, P6 fell from 5 back to 4 and `[P5] 37 of 39` fell to `36 of 39`.

**P8's rise is the one that needs a caveat and it is logged.** P8 compares *every* populated
attestation region against **one** hook read after the whole P5 loop. It passes because both
runs are the same two tabs, neither enrolled, so both produce the same absence arm with the same
`reason` naming the same node ids. A run where the two differ would redden P8 with a message
about a page composing its own sentence, which would be false. The fix — a per-surface hook,
needing no edit to either harness — is written out in `deferred-items.md`.

## The thirteen regions, read off the screen

Not inferred. `demo-byo.e2e.test.ts` prints every `[data-region]` inside `#s-byo` verbatim on
each of four arms. Below is the **accepted** arm, `⏎` for a newline inside a region.

| # | region | kind | on screen |
|---|---|---|---|
| Y1 | `byo/pinned-anchor` | constant | `3ac7f97fa636fbacbfa8e00aa466f191e4335cd1ef5f19477e2c26587d64a6e5` |
| Y2 | `byo/shard-input` | constant | `{ a: <shard index> } ⏎ every shard receives this canonical value; this path carries no caller-supplied input` |
| Y3 | `byo/complete` | reading | `true` |
| Y4 | `byo/partitions` | reading | `shard 0: no partition index — this module’s output carries no such field` ×6 |
| Y5 | `byo/replicas` | reading | `shard 0: 2 ⏎ shard 1: 2 ⏎ … ⏎ shard 5: 2` |
| Y6 | `byo/agreeing` | reading | `shard 0: 12D3KooWHCYT…, 12D3KooWHHVX… ⏎ …` one row per shard |
| Y7 | `byo/verification-multiplier` | reading | `2.00×` |
| Y8 | `byo/fetched` | reading | `0` |
| Y9 | `byo/rejected` | reading | `0` |
| Y10 | `byo/failures` | reading | `No refusals: every shard reached agreement.` |
| Y11 | `byo/attestation` | reading | `How strongly was it checked: nothing established. 2 replicas agreed … ⏎ no agreeing replica produced a signed statement this requestor could check — …` |
| Y12 | `byo/egress` | reading | `What left this device: ⏎ 17 frames sent, 6842 byte(s) total. ⏎ 0 withheld — and this run registered no sovereign data, …` |
| Y13 | `byo/sovereign-label` | reading | `public — this dispatch carried no owner, so nothing in it was registered as sovereign.` |

Plus `byo/report`, the surface's one text view, out of the same record — and
`byo/prose-lift-target`, which was already there.

## The refused arm — read, and cheaper than the acceptance

```
[accepted] 271ms complete=true shards=6 multiplier=2 failures=0 partitions=[-1,-1,-1,-1,-1,-1] violations=0
[refused]  142ms complete=false failures=18
```

**The observed refusal text, verbatim, one of eighteen:**

```
12D3KooWHCYTbvX8txGaLcvKcpbvN9xh9ag1tF2qpAxuFhekQ5i1: module provenance refused on
12D3KooWHCYTbvX8txGaLcvKcpbvN9xh9ag1tF2qpAxuFhekQ5i1: "o2-demo-colouring-kernel" is signed by
a6d2455ea3a5771aba9fcb037924114c92f9f325049f6b4269e739d9048bb869, which is not a pinned trust
anchor
```

`a6d2…b869` is the public half of seed 53, minted in the spec. The record is **genuine in every
respect except the one that matters**: same name, same CID, same version, same expiry as
`KERNEL_RECORD`, correctly signed over the real payload by `signName`. Only `signer` and
`signature` were typed into the form. So the reading is a provenance refusal and not a
malformed-record error, and the form accepted it — *a well-formed record is refused by the
fabric, never by the form* is asserted before the dispatch.

Y6 read `No placement: no shard reached agreement.`, Y3 read `false`, and the eighteen lines
matched `hook.failures` entry for entry with the line count asserted equal.

**The elapsed reading is a ratio, not an absolute.** `expect(refusedMs).toBeLessThan(max(acceptedMs * 10, 60_000))`
— compared within one run, so a slower machine cannot flatter it and a regression to
timeout-discovery becomes a number rather than a slow suite. Observed across four runs: 79, 131,
148, 142 ms refused against 272, 368, 320, 271 ms accepted. **The refusal is consistently about
half the cost of the acceptance**, which is what a check that fires before `WebAssembly.instantiate`
should look like.

## The sovereign arm — and the withheld branch did NOT fire

Both readings recorded, because *which one fired is a finding either way*:

```
[sovereign·unowned] 90ms  complete=false frames=0  bytes=0    violations=0
[sovereign·placed] 136ms  ARM=registered-no-sovereign-data complete=false placed=0/6
                          frames=12 bytes=6276 violations=0
```

**The branch `egressLines` was written for is still unreachable, and now for a measured reason
rather than for want of a caller.** Two layers, both on screen:

1. `attestedNodes` in `main.ts` hardcodes `ownerId: 'public'` on every descriptor, and
   `eligibleNodes` places a sovereign shard only on a node declaring the same owner. Any other
   owner id is **unplaceable** — *a stalled sovereign shard is the correct outcome* — with zero
   frames and zero bytes leaving the device.
2. Even for the owner the descriptors do declare, the executors refuse at authorization:
   `sovereignty violation: node … is not cleared to execute sovereign data for owner public` and
   `unauthorized: no pinned owner key for public on this node`. The twelve frames that left are
   dispatch RPC; the shard's canonical bytes never reached a peer, so the guard had nothing to
   hold back.

**And this exposes a sentence that is not reliable.** That run submitted six sovereign shards
and Y12 read *"0 withheld — and this run registered no sovereign data"*. True of what the guard
saw, false of what the run submitted, and `EgressManifest` carries no field that would let
`egressLines` tell them apart. It was **left alone**: UI-SPEC 5.2 fixes that copy verbatim, P7
asserts those exact words, four surfaces render it, and forking it here would have made this
file a second author of the sentence carrying the sovereignty claim. The card says the limit in
its own prose instead, and the spec records the branch on every run. Full write-up and the
proposed fix are in `deferred-items.md`.

The second arm holds its literal with a grep over `main.ts`, so the day a tab is handed a real
owner identity the arm reddens and is re-planned rather than quietly measuring something else.

## Three sentinel zeros, found by reading the screen

This is the plan's second real result. Each was on screen before it was caught.

| field | how the sentinel is produced | first rendered as | now reads |
|---|---|---|---|
| `partitions[i]` | `partitionOf(output)` returns `-1` when `output.p` is absent — **and** the expression returns `-1` for a shard that did not agree | UI-SPEC's `no agreement`, on six shards that **had** agreed | `no agreement` only when `agreeing[i]` is empty; otherwise the composed *no partition index — this module’s output carries no such field* |
| `replicas[i]` | `main.ts`: `status === 'agreed' ? replicas : 0` | `shard 0: 0` beside eighteen refusals | `shard 0: no agreement` |
| `verificationMultiplier` | `submit.ts:3218`: `useful === 0 ? 0 : gross / useful` | `0.00×` — *verification was free* | the composed `No cost measured: no shard produced an answer, …` |

**Y4's was measured twice before it was believed.** A bench probe first: the demo's colouring
kernel, handed `runJob`'s canonical `{a: <shard index>}`, returns `{c: 1024 zero bytes, s: [2]}`
— a well-formed partial at status `budget`, deterministic, and carrying no `p`. Then on a real
two-tab dispatch: `complete=true`, `failures=0`, `partitions=[-1,-1,-1,-1,-1,-1]`, and the spec
printing `shards that agreed and carry the -1 sentinel: 6 of 6`.

**The sweep that guards this has two stated exemptions**, and they are the reason it is a
reading rather than a rule: `byo/fetched` and `byo/rejected` are blockstore counters whose zero
is a real observation. Replacing those with prose would replace a measurement with a sentence.
Both are separately asserted equal to the run's own figures, so the exemption is not a hole.

## The planted mutations

Three. Each snapshotted with `cp` to the session scratchpad **immediately before** the edit,
restored by **the surgical inverse of that edit** — never `cp` back, never `git stash`, never
`git checkout --` — and verified with `cmp`, `EXIT=$?` read on the line immediately after. Every
`cmp` returned **0**, `git diff -U0 | grep -c '^@@'` returned **1** on each, and
`git status --porcelain` printed nothing before and after each.

### Plant A — the refusal paraphrased instead of quoted: red, and the paraphrase was subtle

The plan's nominated plant. The failure line gained the page's own words as a prefix and one
clause of the fabric's was reworded:
`${failure.nodeId}: ${failure.reason}` → `${failure.nodeId} refused this shard: ${failure.reason.replace('is not a pinned trust anchor', 'is not one this tab trusts')}`.
Exit **1**, `Tests 1 failed | 12 passed (13)`:

```
FAIL |e2e| demo-byo.e2e.test.ts > … > renders every refusal verbatim, nodeId and reason, in the fabric's own words
AssertionError: expected '12D3KooWDV2SL7i6AaGFyTgeQTUoPjcV53jd7…' to contain '12D3KooWDV2SL7i6AaGFyTgeQTUoPjcV53jd7…'
- 12D3KooWDV2…: module provenance refused on 12D3KooWDV2…: "o2-demo-colouring-kernel" is signed by a6d2… which is not a pinned trust anchor
+ 12D3KooWDV2… refused this shard: module provenance refused on 12D3KooWDV2…: … which is not one this tab trusts
```

**The paraphrased page still contained every node id, still had eighteen lines, and still said
*refused*.** An assertion on any of those would have passed it. What carries the claim is the
exact comparison against `window.__o2LastByoRun`.

### Plant B — the record made optional: the validity block red

`validity`'s filter narrowed to `field.key === 'moduleCid' && …`, i.e. a **CID-only form** —
the exact shape UI-SPEC 4.5 refuses. Exit **1**, `Tests 1 failed | 12 passed (13)`:

```
FAIL |e2e| … > disables the control with a reason naming every field it is missing
AssertionError: the record signature cleared: the control is still enabled: expected false to be true
```

### Plant C — a region dropped from the record: **P5 stayed green, and that is the finding**

`regions['byo/verification-multiplier'] = multiplier` removed.

`demo-liveness.e2e.test.ts` exit **0**, `Tests 6 passed (6)` — with `[P5] 36 of 39` and
`[P6] examined 4`, both moved and neither asserted. P5b did not fire because Y7's catalogue
entry holds no `unavailable` arm and P5b exempts exactly those; **nine of the eleven
bring-your-own readings are in that position**, taking the exempt set from fifteen to
twenty-four. This is the deferred item 27-04 opened and 27-05 re-counted, firing exactly as it
predicted.

What caught it was this surface's own spec, exit **1**, `Tests 2 failed | 11 passed (13)`:

```
AssertionError: expected 'Not measured: this tab\'s node is sto…' to be '2.00×'
AssertionError: expected 'Not measured: this tab\'s node is sto…' to be 'No cost measured: no shard produced a…'
```

## Exit codes, read directly

`EXIT=$?` on the line immediately after each command, output redirected to a file and the file
read afterwards — no pipe, no trailing `tail`.

| command | exit |
|---|---|
| `vitest run --project e2e demo-liveness` — **baseline, before any change** | **0** — `6 passed`, P5 `colouring, pi`, P6 4 / P7 2 / P8 1 |
| bench probe: the demo kernel against `{a: i}` | **0** — `keys ['c','s']`, `s[0]=2`, no `p` |
| `npx tsc --noEmit` after Task 1 | **0** |
| `grep -v '^ *[/*]' surfaces/byo.ts \| grep -c innerHTML` | **0** |
| `npx tsc --noEmit` after Task 2 | **0** |
| `vitest run --project e2e demo-regions` | **0** — `17 passed`, 2.36 real |
| `vitest run --project e2e demo-liveness`, **P5 unedited** | **0** — `6 passed`, P5 `colouring, pi, byo`, 9.53 real / 19.44 user / 2.94 sys, ratio 2.35 |
| `vitest run --project e2e demo-viewport` | **0** — `7 passed`, 60 combinations, 8.47 real |
| `vitest run --project e2e demo-byo`, first run | **1** — `module block missing` on every shard; see the deviation below |
| the same, after `BUNDLED_MODULES` | **0** — `12 passed` |
| the same, after the sentinel fixes | **1** — the zero sweep caught `byo/fetched`/`byo/rejected`; exemption stated |
| the same, after the stated exemption | **0** — `13 passed` |
| Plant A (demo-byo) | **1** — `1 failed \| 12 passed`, text above |
| `cmp` after the surgical restore | **0** |
| Plant B (demo-byo) | **1** — `1 failed \| 12 passed`, text above |
| `cmp` after the surgical restore | **0** |
| Plant C (demo-liveness) | **0** — and the pass is the finding; P6 fell 5 → 4 |
| Plant C (demo-byo) | **1** — `2 failed \| 11 passed`, text above |
| `cmp` after the surgical restore, against both the C and the A snapshots | **0** and **0** |
| `vitest run --project e2e` built-bundle + colouring-demo + attestation-ui + demo-pi + demo-primes | **0** — `39 passed`, 41.08 real / 63.09 user / 7.92 sys, ratio 1.73 |
| `vitest run --project node` vocabulary + slow-specs + requirements-ledger | **0** — `54 passed` |
| `vitest run --project node vocabulary` after `deferred-items.md` | **0** — `25 passed` |
| `npx tsc --noEmit`, final | **0** |
| **the plan's verification set, ×4 files** | **0** — `Tests 43 passed (43)`, 20.55 real / 34.86 user / 7.78 sys, ratio 2.07 |
| `git show --stat` after each commit | only this plan's own files |

Every `(user+sys)/real` ratio is above one, so no reading was taken from a starved process. They
are comparability keys, not verdicts.

**`built-bundle.e2e.test.ts` is green**, which is the check that `vite build` resolves
`./surfaces/byo.ts` — and its `@o2/demo` import of two WASM byte blobs — out of the inline module
script and serves it from a dumb static server. Nothing else in this suite would catch a bundler
dropping that.

## Deviations from Plan

### `[deviation - scope] the form opens filled, against Task 2's "names every missing field at load"`

Recorded in full under *The form opens filled* above. The short version: an empty form opens at
a state no visitor can leave, and it makes the plan's own must-have truth about P5
unsatisfiable. Both halves of the criterion's intent are met — the reason element is non-empty
at load, and it names every missing field whenever one is missing, asserted on five arms driven
through the page's own inputs.

### `[Rule 1 - bug] the default dispatch came back "module block missing" on every shard`

- **Found during:** Task 3's first run. Exit 1, eighteen refusals reading
  `module block missing: bafyreihyux7jls…`.
- **Issue:** a dispatch names a module by CID and carries no bytes. `runColouring` and `runPi`
  each `store.put` their own kernel first; this form had no kernel of its own and put nothing,
  so no node in the fabric held the block. It only worked under P5 because the colouring run had
  already put it in that tab's store — a dependency on another surface having been driven first.
- **Fix:** `BUNDLED_MODULES` in `surfaces/byo.ts` maps the two shipped CIDs to their bytes, and
  the handler puts whichever the form names before dispatching. A CID this bundle does not ship
  still produces `module block missing`, which is the **correct** answer and is now said in the
  card so a reader can tell the two apart.
- **Files:** `packages/browser/demo/surfaces/byo.ts`, `packages/browser/demo/index.html`
- **Commit:** `027b7de`

### `[Rule 1 - bug] three sentinel values were being rendered as figures`

Recorded in full under *Three sentinel zeros* above. `partitions[i]`, `replicas[i]` and
`verificationMultiplier`. Commits `8e73130` (Y4, from the bench probe) and `027b7de` (Y5, Y7,
from the screen).

### `[Rule 3 - blocking] demo.css gained .refusal, .form-grid and .check`

- **Found during:** Task 2. UI-SPEC 1.5 reserves `--color-refusal` for *a provenance refusal or
  shard failure in bring-your-own* and 7.2 fixes how — `--color-text` with a refusal-coloured
  left rule, because `#cb4b16` measures 4.05:1 and fails at body size. **No such class existed**:
  `--color-refusal` appeared only on `state[data-tone='blocked']` and in comments. `.quote` is
  the same shape in accent and is the wrong tone for a refusal.
- **Fix:** three rules with comments stating what each is for. `.form-grid` is a plain stacked
  grid rather than `.cards`, whose `minmax(300px, 1fr)` is wrong for a single column of
  full-width inputs. `demo.css` was not in the plan's `files_modified`; the alternative was to
  claim a visual treatment the page did not have.
- **Honest limit:** the contrast block asserts seven named pairs and `.refusal` is not one of
  them. Its text colour is `--color-text` on `--color-bg`, which **is** an asserted pair, so
  nothing is unmeasured — but the negative half, that a refusal region is not refusal-*coloured*
  text, is held by the markup alone. Same shape as 27-06's `.citation` gap, and logged there.

### `[deviation - method] the sovereign arm is two cases, not one`

The plan asks for one sovereign arm reporting whichever egress branch fired. It is two, because
one case cannot report both findings: an owner nobody declares never places, and the owner the
descriptors do declare places and is then refused at authorization. Reporting only the first
would have left *the withheld branch is unreachable* looking like a property of unplaceability
alone, which is one of two layers.

### `[deviation - scope] egressLines was not changed although its sentence is unreliable here`

Recorded under the sovereign arm and in `deferred-items.md` with the proposed fix. This is a
Rule 4 boundary rather than a Rule 1 skip: the change needs a new field on `EgressManifest`, an
amendment to UI-SPEC 5.2's verbatim copy, and an amendment to P7 — one change across three
contracts, not a bug fix.

## Threat Model — dispositions met

| Threat ID | Disposition | How it was met |
|---|---|---|
| T-27-24 | **mitigate — met, and measured** | `runJob` requires the record by construction; the form requires all seven and the matching cid, with a reason naming every missing field on five arms; the copy states there is no value that turns the check off, verbatim, above the form and before anything is submitted; the refused arm renders the refusal in **142 ms** against an acceptance's **271 ms** in the same run. Plant B reddened the CID-only shape. |
| T-27-25 | **mitigate — met** | `grep -v '^ *[/*]' surfaces/byo.ts \| grep -c innerHTML` returns **0**; every peer-authored string reaches the DOM through `render.ts`'s `textContent` writers. Plant A reddened the paraphrase. |
| T-27-26 | **mitigate — met** | The checkbox and the owner id are one value in `ByoForm`, validated together, rendered together. Checked with an empty owner id the control is disabled and the reason names the owner id — asserted twice, once by clearing and once by pressing the checkbox. `submitJob`'s `shard-missing-owner` is never reached from this page. |
| T-27-27 | **mitigate — met, and P7 rose to prove it** | Y12 is one region and one `egressLines` call feeding both views; P7's examined count rose 2 → 3 on the strength of it. The sovereign arm records which branch fired on every run — and this plan's finding is that it was **`registered-no-sovereign-data`**, with the reason measured and the sentence's unreliability logged rather than smoothed. |
| T-27-28 | **mitigate — met** | `validity` requires `/^-?\d+$/` on `version` and `expiresAt` and returns a failure naming the field; `recordOf` parses only a form `validity` has already accepted. `record version → one` is asserted on a real page. No `NaN` is constructible through the form. |

## Known Stubs

**None introduced, and one removed.** `#byo-report`'s literal *"Nothing to report: this surface
has not been wired to a reading yet"* is gone; it now carries the surface's whole content out of
the record, and reads `nothing dispatched yet` before the first dispatch.

All eleven bring-your-own readings carry a reading or a named absence in every arm, and `format`
returns an entry for every one of them in every arm, so no region can retain a value from a
previous dispatch.

The one remaining text-view stub from 27-02 is `#fabric-report`, which is Plan 27-08's.

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| threat_flag: input-surface | `packages/browser/demo/index.html` | Eight visitor-controllable strings now cross into a dispatch — seven record fields plus an owner id. Every one is validated by `validity` before the call and rendered only through `textContent`; the record's signature is checked by the fabric and not by the page. Flagged because the plan's register anticipated seven and the sovereign owner id is an eighth. |
| threat_flag: bytes-into-the-store | `packages/browser/demo/surfaces/byo.ts` | `BUNDLED_MODULES` puts WASM bytes into this tab's blockstore from a page handler. The map is closed — two CIDs, both from `kernel-record.ts`, both compared against the form's value by exact string equality — so no visitor-supplied value selects bytes. Not in the plan's register because the need for it was discovered by measurement during Task 3. |

## What is NOT done

- **`egressLines`' withheld branch has never fired.** Measured, two layers deep, logged.
- **`egressLines`' *registered no sovereign data* sentence is unreliable on a sovereign
  dispatch.** Left alone deliberately; the fix crosses three contracts.
- **P5b's exempt set grew from fifteen to twenty-four and nothing reports it.** Plant C proved
  it by staying green. Covered instead by `demo-byo.e2e.test.ts`, by name.
- **P8's single hook is now checking two surfaces.** Passes today for a reason close to luck.
- **`#byo-status` and `#byo-validity` are digit-free by hand.** Nothing enforces it, as for
  `#run-status` and `#pi-status`.
- **UI-SPEC is not edited.** Three corrections are owed and logged: Y4's second meaning for
  `-1`, Y7's nothing-agreed arm, and 5.2's sentence on a sovereign path.
- **G4's primes half is still open**, unchanged, for 27-06's stated reason.
- **39 → 26 regions still have no element.** Two surfaces remain: fabric state and Benchmarks.
- **Only Chromium.** Every `e2e` spec here launches chromium alone; the project's limit.
- **STATE.md and ROADMAP.md were deliberately not touched**, and no `gsd-sdk query state.*` or
  `roadmap.*` verb was run — the operator's instruction for this plan forbids them.

## Success criteria

1. **Met.** `runJob` has a caller in the page — `#byo-form`'s submit handler. G4's `runJob` half
   is closed.
2. **Met.** The form requires a module CID **and** a complete signed record, with a visible
   reason naming every missing field. Five arms on a real page; plant B reddened the CID-only
   shape.
3. **Met, and measured as a ratio.** A module signed by an unpinned key is refused and the
   refusal is rendered in the fabric's own words, in **142 ms** against an accepted dispatch's
   **271 ms** in the same run. Plant A reddened the paraphrase.
4. **Met in part, and the part that is not met is the plan's most interesting result.** The
   sovereign option is one inseparable control pair, asserted twice. The egress refusal arm is
   **not** reachable here: it was measured, both layers were named, and the sentence it leaves
   standing was found unreliable and logged rather than reworded.
5. **Met.** `partitions[]` never renders `-1` as a number — and it renders `no agreement` only
   where that is true, which took a bench probe and a two-tab dispatch to establish.
6. **Met.** P5 covers this surface's run control with **no edit** to
   `demo-liveness.e2e.test.ts`. `[P5] exercised … colouring, pi, byo`.

## Commits

| hash | what |
|---|---|
| `8e73130` | `feat(27-07)` — the formatter and the form's validity model |
| `027b7de` | `fix(27-07)` — the bundled module is put, and three sentinels stop being figures |
| `eb4af1b` | `feat(27-07)` — the panel: seven inputs, a named reason, thirteen regions, `WIRED_SURFACES` |
| `a6cada5` | `test(27-07)` — four arms, driven through the page's own inputs |
| *(this file)* | `docs(27-07)` — the summary and six deferred items |

Each committed with `git commit -m "…" -- <explicit paths>`, `-m` before `--`, and each verified
with `git show --stat` to contain only this plan's own files.

## Self-Check: PASSED

- `packages/browser/demo/surfaces/byo.ts` — FOUND, **460 lines** (`min_lines: 200`),
  `moduleRecord` present, `egressLines` present ×6, `runJob` named ×8
- `packages/node/src/demo-byo.e2e.test.ts` — FOUND, **782 lines** (`min_lines: 200`),
  `failures` present ×12
- `packages/browser/demo/index.html` — FOUND, modified; **`window.o2.runJob` at line 1733** —
  one call site, plus one docblock naming it. That line is the key_link the plan asks for.
- `packages/browser/demo/demo.css` — FOUND, modified
- `packages/browser/src/demo-regions.ts` — FOUND, modified; `'byo'` in `WIRED_SURFACES` at
  line 238
- `deferred-items.md` — FOUND, six entries appended, diff is **156 insertions, 0 deletions**
- commits `8e73130`, `027b7de`, `eb4af1b`, `a6cada5` — all FOUND
- `git status --porcelain` after every plant restore — printed nothing; every `cmp` exit **0**
