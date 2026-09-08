# Phase 39 — exercising the kill switch DURING the run, and the band the reading is judged against

**Dated:** 2026-09-07
**Requirement:** `RUN-07` · **Phase 39 criterion 5** · **Plan:** 39-06
**Tool:** `tools/run/switch-observation.mjs` · **Spec:** `packages/node/src/switch-observation.node.test.ts`
**Baseline:** `packages/browser/src/propagation-window.ts`

Every act in §3 is the owner's. No agent flips the switch, writes to the deployed object,
deploys, publishes or creates a Cloudflare resource. What an agent built is the **instrument** —
a read-only sampler that timestamps the transition from outside — and the **comparison rule**, so
that the mid-run exercise produces a reading rather than an impression while several hundred
volunteers are connected.

---

## 0. READ THIS FIRST — the exercise is blocked today, and here is the reading that says so

**The deployed object refuses every write to `POST /admission`, whatever key is presented.** Not
because of the key: because of the region label.

`refuseMisaddressed` in `packages/cloudflare/src/admission-flag.ts` opens with a branch that has
nothing to do with the request — *"an object with no region label refuses every region-addressed
write"* — and `worker.ts` calls it unconditionally on the way to the store. The deployed `/self`,
read live on 2026-09-04 and carried here rather than re-read by any agent, answers

```
"admission":{"region":null,"halted":false,"versions":"all","since":null,"note":""}
```

`admission.region` is `null`. `readDirective` fills that field from the object's own deployment
label and never from a request, so a `null` there says the label never arrived — and that is
exactly the input on which every write is refused **409**.

**This was measured, not inferred.** The spec boots a second local `workerd` with **no**
`O2_REGION`, which is the deployed object's own reported configuration, presents the correct
operator key, and watches two halts refused: one addressed `null` and one addressed
`bootstrap-eu`. Both come back `409` with a body containing `serves no region`, and the object
does not move. The case is *"refuses a correctly-keyed halt with 409 when the object carries no
region label"*.

**What releases it is `36-RUNBOOK.md` act 2**, which is an owner act and was never performed:
redeploy the script with `--var O2_REGION:<one of bootstrap-us, bootstrap-eu, bootstrap-sam>`.
The check that it worked is read-only and costs one request:

```
curl -s https://<origin>/self
```

Read back `admission.region`. **A `null` there means the mid-run exercise cannot run at all** —
step 3 below would answer 409 in front of a live cohort. A region name means act 2 landed.

`36-RUNBOOK.md` act 1 — `wrangler secret put O2_ADMISSION_KEY` — is the other precondition and
was also never performed. Its own reading is in §3.

---

## 1. What Phase 36 measured, and on what

Four constants, published in `packages/browser/src/propagation-window.ts`, hand-written from a
measurement and compared against a fresh reading by
`packages/node/src/kill-switch-propagation.e2e.test.ts`:

| constant | value | what it is |
|---|---|---|
| `PROPAGATION_WINDOW_MS` | **29 880** ms | the window, from the write returning to the LAST tab noticing |
| `PROPAGATION_BAND` | **1 500** ms | how far a fresh reading may drift before the guard reddens — 5 % of the interval |
| `PROPAGATION_POPULATION` | **6** | how many tabs the maximum was taken over |
| `PROPAGATION_INTERVAL_MS` | **30 000** ms | the poll interval it was measured at |

The ratio is **0.996** — 29 880 against a 30 000 ms poll. Three runs on 2026-09-02 read 29 869,
29 884 and 29 891 ms, a spread of 22 ms; a fourth, taken with the literal already in place, read
29 828.

**Every one of those readings is a local `workerd`.** The ledger row says so in its own words:

> **No deployed reading**: every measurement is local `workerd`.

So criterion 5 is not a re-run of Phase 36. It is the same control observed on the deployed
object with a real cohort on it, compared against the numbers Phase 36 published. Six tabs on one
machine is not a cohort, and `PROPAGATION_COVERS` already says so: *"what a control does at six
is not what it does at three hundred, and nobody here has measured the second thing."*

### The volunteer-visible observables

Three things a person outside this repository can see, and they are what the exercise reads back:

- **The tab title.** `STOPPED_TITLE_PREFIX` in `packages/browser/src/computing-indicator.ts` is
  `■ Not taking new work — `. Its precedence rule is deliberate and matters during the exercise:
  **`inFlight > 0` outranks `halted`**, because *"a halted tab still draining is computing, and a
  title claiming otherwise is something a visitor could catch by watching their own fan."*
- **The status page**, `packages/browser/demo/status.ts`, which renders exactly two verdicts:
  `NOT ADMITTING NEW TASKS` when halted, `Admitting new tasks` otherwise. There is no third.
  **It paints itself in the browser** — `status.html` is a shell and `render()` assigns
  `innerHTML` — so this surface is read back **in a browser** and not by `curl`. See §2.
- **The refusal.** A keyless or wrong-key write answers **401**. An object with no key configured
  answers 401 to everyone, including its owner — `authoriseWrite` states the reasoning at the
  function, and the failure points toward the fabric continuing to work rather than toward
  anyone being able to stop it.

---

## 2. What "matches" means, numerically, and why it is a ratio

### The band, both ways

The pass band is the observed window inside **29 880 ± 1 500 ms at a 30 000 ms poll** — a
millisecond range of **28 380 to 31 380 ms**, equivalently a **ratio to the poll interval of
0.946 to 1.046**. The arm that survives a change of cadence is the simpler one: **a ratio at or
under 1** means nothing needed more than a single poll to hear.

### Why the ratio and not the milliseconds

`propagation-window.ts` records the finding that settles this, taken across two intervals inside
one run:

> The raw window moved by very nearly the interval's own factor — 1 874 → 29 869, a factor of
> **15.9** against the interval's 15 — while the ratio stayed at or under 1 in both. **So the
> window's dominant term is the poll interval and nothing else contributes materially.**

A cohort of three hundred should therefore move the **ratio** and not the milliseconds. If the
milliseconds move while the ratio does not, the poll interval changed and nothing else did. A
reading outside the band is a **finding** — a second mechanism, a stopped poll, an interval that
moved — and not a failure of this document.

### The two planes, and conflating them would make every figure here a lie

**This is the correction plan 39-06 made to its own instrument, and it governs how §3's numbers
are read.**

Phase 36's 29 880 ms is a **tab-side** figure: the maximum over six browser tabs of the delay
between the write returning and that tab's own thirty-second poll noticing, recorded inside each
page. The sampler in `tools/run/switch-observation.mjs` reads `/self`, which is the **object's
own state**, and that state changes at the write. Its observed window is therefore bounded by its
own sampling interval **by construction**, and it can never reproduce 29 880 ms.

So the sampler answers `comparable` beside `within`. Applying the millisecond band to a series
sampled at 5 000 ms compares two different quantities, and the tool refuses to pretend otherwise:
it prints *"not comparable to the published 29 880 ms band, which describes a series taken at
30 000 ms over 6 tabs"* and reports the ratio instead.

**Measured, on a local object, three runs of the spec's own arm at a 1 000 ms cadence: ratio
1.001, 1.000 and 1.002.** Against Phase 36's tab-side 0.996 at a cadence thirty times longer.
Two planes, two cadences a factor of 30 apart, both at a ratio of about 1 — which is the same
statement `propagation-window.ts` made with its two arms, and it is the only comparison the two
readings support.

**Where the tab-side plane IS observed during the exercise: step 4's own tab.** That is the one
observation on Phase 36's plane, it is a population of one, and it is compared the way step 4
words it — *within one poll interval* — rather than against a band taken over six.

### What the sampler can and cannot read, and `--status` is the honest half of it

**`--status` is inert against the page this project publishes, and every line will read
`status=halted:0 admitting:0`.** `status.html` is a shell; `status.ts` builds every card inside
`render()` and assigns `root.innerHTML` in the browser, so a `GET` on the published page returns
markup containing neither verdict string. That is measured rather than supposed — a spec case
reads `packages/browser/demo/status.html` and asserts the counts are `{0, 0}`, and it is also
what retires this note: server-render the page and the case reddens.

`{0, 0}` is a **no-claim**, not *the page says admitting*, so nothing false-stops. But it has two
consequences the script below obeys:

- **The sampler carries `/self` only.** The status page's read-back in step 4 is done in the
  owner's own browser, which is where the painting happens.
- **Stop arm B can only fire against a server-rendered page.** Against this deployment the counts
  are always `{0, 0}`, `disagrees` answers false, and the arm never fires. It is kept because the
  page may be server-rendered later and because a second origin may be configured; it is named
  here so nobody reads its silence as agreement.

Pass `--status` only against a server-rendered page. Against this one it costs a request per
sample to learn nothing.

### The two ways the exercise produces something other than a number

Both are reported as themselves and neither is rounded into a reading:

- **A sample gap wider than 1.5 × the sampling interval → `degraded`.** The window is then an
  **upper bound**: the flip could have landed anywhere inside the hole. The factor is not 1
  because a sampler that waits an interval and *then* issues a request produces gaps of interval
  plus round trip on every healthy run; a missed sample doubles the gap, and 1.5 sits between
  the two populations.
- **No observed transition → `null`, and never `0`.** A window of zero says *the switch flipped
  between two samples a millisecond apart*, which is a measurement. `null` says *I arrived after
  it had already flipped*, which is the absence of one. A sampler that cannot tell them apart
  hands the owner a perfect propagation figure off a run in which nothing was observed. That
  plant was run and watched red.

---

## 3. The owner's script, step by step, with what each step reads back and what means stop

**When.** At a stage boundary in `.planning/phases/phase-39-the-public-run/39-RUNBOOK.md` §4 —
after that stage's four readings and **before** the next invitation goes out. The sampler's
verdict is read beside the funnel's, in the same vocabulary and with the same exit codes: `0`
observed, `1` stop, `2` refused.

**Preconditions, checked before step 1.** Both are `36-RUNBOOK.md` acts, both are the owner's,
and neither had been performed as of this document's date. Each check is one request.

```
curl -s https://<origin>/self
```

Read back `admission.region`. **`null` → STOP, and do not proceed**: every write will answer 409.
See §0. A region name means act 2 landed.

```
curl -i -X POST https://<origin>/admission \
  -H 'Content-Type: application/json' \
  -d '{"region":"<the region /self reported>","halted":false,"versions":"all","since":null,"note":""}'
```

No key header, deliberately. Read back **401**, and read the body: *"this object has no operator
key configured"* means act 1 was never done and the switch is unflippable; *"no
`X-O2-Admission-Key` header was presented"* means the key is set and doing its job. **A 200 here
is the defect this whole control exists against** — anyone who finds the route can halt your
volunteers. Stop and unset nothing until it is fixed.

**Hold the key in the environment and never on a command line.** The value must not enter a shell
history, a log, a fixture or this repository. The sampler holds no credential at all and has no
write path — a spec case reads its text and refuses one.

```
export O2_ADMISSION_KEY='<the value, pasted into a shell that does not record it>'
```

---

**1. Start the sampler.** It writes nothing and sends one `GET` per route per interval.

```
node tools/run/switch-observation.mjs --self https://<origin>/self --interval 5000 --for 180000
EXIT=$?
```

**`--status` is deliberately not passed.** Against this deployment it costs a request per sample
to learn nothing, because the published status page paints itself in the browser — §2 says so and
a spec case measures it. The page is read back in step 4, in a browser.

`EXIT=$?` goes on the line **immediately** after: no pipe, no trailing `tail`, no `echo` between.
zsh has no `PIPESTATUS`; it is `pipestatus[1]`.

**Read back:** the first `[switch-observation]` line, carrying an ISO timestamp,
`halted=false`, the region, `since=null`, and `status=not read`. **A first line reading
`halted=true` means the fabric is already halted and there is no transition to observe — stop and
find out why.** Leave it running; the rest of the script happens underneath it. At 5 000 ms for
180 000 ms that is 36 samples, so **36 Durable Object requests** for the whole exercise — against
the 1 438 `tools/run/stage-budget.mjs` estimates for stage 1, i.e. 2.5 % of one stage.

**2. Open one of your own tabs on the published page and let it take work.** The
volunteer-visible marker needs somewhere to appear, and a tab you own is the only one you may
watch.

**Read back:** the tab title carrying the computing marker, i.e. the page is actually executing.
**`inFlight > 0` outranks `halted` in the title**, so a tab still draining after step 3 correctly
shows computing — **that is not a failure**, and §4 says why.

**3. Write the halt.** One request, to one object, naming the one region the deployment has.

```
curl -i -X POST https://<origin>/admission \
  -H "X-O2-Admission-Key: $O2_ADMISSION_KEY" \
  -H 'Content-Type: application/json' \
  -d "{\"region\":\"<the region /self reported>\",\"halted\":true,\"versions\":\"all\",\"since\":$(($(date +%s) * 1000)),\"note\":\"phase 39 mid-run exercise\"}"
EXIT=$?
```

`date +%s` is seconds on this host, so `since` is multiplied to milliseconds.

**Production has ONE region today, so this halt is cohort-global.** `RUN-02`'s switch slices by
region and with one region the slice is everybody. Phase 33 has no directory and no plan, and its
three objects are blocked on `.planning/OWNER-ACTIONS.md` row 2 — about $15 a month. Do not write
a regional script this deployment cannot execute.

**Read back:** HTTP **200** and the directive echoed. **409 → stop**, and re-read §0: the write
named a region this object does not serve, or the object serves none. **401 → stop**: the key is
wrong or absent, and nothing was written.

**4. Read the halt back on all three surfaces.** Not one of them — all three, because two
agreeing and one not is the finding.

- **`/self`:** `admission.halted` is `true` and `admission.since` is set, inside the last minute.
  The sampler prints both on every line; you do not need a separate request.
- **The status page, in a browser tab you open on it** — not by `curl`, and not from the
  sampler's output: `NOT ADMITTING NEW TASKS`. §2 says why this surface has to be read this way.
- **Your own tab from step 2:** its title carries `■ Not taking new work — ` **within one poll
  interval** — 30 000 ms. This is the one observation on Phase 36's tab-side plane and it is a
  population of one, so it is a presence check and not a band comparison.

**5. Un-halt, and read all three back again.** *The un-halt is part of the exercise, not an
afterthought: a control exercised and left on is an outage.*

```
curl -i -X POST https://<origin>/admission \
  -H "X-O2-Admission-Key: $O2_ADMISSION_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"region":"<the region /self reported>","halted":false,"versions":"all","since":null,"note":""}'
EXIT=$?
```

**Read back:** HTTP **200**; then the sampler's next line showing `halted=false` and `since=null`;
then the status page back to `Admitting new tasks`; then your own tab's title losing the marker
within one poll interval. **All three must return. If any one of them does not, the cohort is
still halted and that is an outage you caused — do not send the next invitation, fix it.**

**6. Record the sampler's final lines in this document.** It prints three: the reading, the
baseline it is compared against, and the verdict. Paste them verbatim into §6 below, together
with the sampling interval, the date, and roughly how many volunteers were connected. A window
with no population beside it is a number about nothing.

### What means STOP

Any one of these, and the next invitation does not go out. They are conditions, not steps — the
six numbered steps above are the script; these are what refuses it.

- **Arm A — no observed transition inside three poll intervals**, 90 000 ms at the production
  poll. The sampler answers `kind: not-observed` and exits `1`. It is `null`, not a window of
  zero.
- **Arm B — the status page and `/self` disagreeing for two consecutive samples.** One sample
  straddling the flip is not a disagreement: the two routes are read about a millisecond apart
  and the flip lands between them. That was measured while building this, and the rule was
  corrected to require a run of two. Two in a row means one of the routes is stale — believe
  neither, and find out which.
- **Arm C — a keyless write succeeding.** Anything other than 401 from the precondition check
  above.
- **Arm D — the un-halt in step 5 not reading back on all three surfaces.**
- **Arm E — `admission.region` reading `null`** at the precondition check, so the write cannot be
  addressed at all. See §0.

---

## 4. What this exercise cannot establish

**It observes admission, and admission is not compute.** Phase 36 lost a reading to exactly this
and the finding is recorded in `36-01-SUMMARY.md`: `submitJob` dispatches every shard under one
`Promise.all`, so admission for all 128 shards is decided **once, at submit**. A counter still
moving afterwards is a queue *draining* work the tab already accepted, which no admission control
can or should stop. Phase 36's own instrument read

```
[RUN-02 regions] bootstrap-eu  before=47 after=32 ratio=0.681   ← the HALTED tab
```

— the middle of three, with nothing broken. **So do not read a still-moving counter, or a tab
still showing the computing marker, as a failed kill switch during this exercise.** The thing that
ends in-flight work is the Stop button, and `BROW-08` carries it separately.

**It is a single deployed object with one region.** The regional half of `RUN-02`'s slice cannot
be exercised until Phase 33 exists, so this reading says nothing about one region halting while
another admits — that was measured on three local `workerd` children in Phase 36 and has no
deployed counterpart.

**It does not settle open question 2.** The mechanism under both Phase 36's number and this one is
a **Durable-Object-storage poll**, not Workers KV, whose roughly sixty-second global propagation
is what that question is framed in terms of and which this project has still not measured.

**One tab is not a cohort either.** Step 4's tab-side observation is a population of one. It says
the marker appears; it does not say what the marker's window is at three hundred. Criterion 5
asks for the control to be *exercised* during the run and its behaviour compared against the quiet
figure — which this script does — and not for the tab-side window to be re-measured over a cohort
nobody can instrument from outside.

**The sampler cannot see inside a volunteer's tab, and must not claim to.** It reads two public
routes. Everything it reports is object-side.

---

## 5. What the instrument cost, and what it is

`tools/run/switch-observation.mjs` — plain ESM, no dependencies, no credential, no write path.
One `GET /self` and one `GET` on the status page per interval, and nothing else, ever. Its exit
codes are `stage-budget.mjs`'s, deliberately, because the owner reads the two side by side at a
stage boundary: `0` observed, `1` stop, `2` refused.

`packages/node/src/switch-observation.node.test.ts` holds 24 cases, including two local `wrangler
dev` children — each with its own port and its own `mkdtemp` persist directory, and neither
contacting any deployed origin.

---

## 6. The reading, once the exercise has been performed

**Not yet performed.** It is blocked on §0's two preconditions.

When it is, paste here: the date, the sampling interval, roughly how many volunteers were
connected, the three `[switch-observation]` summary lines verbatim, and whether your own tab's
title carried the marker inside one poll interval.

| field | value |
|---|---|
| date | |
| sampling interval | |
| connected volunteers (from `39-PARTICIPANT-COUNT.md`) | |
| observed window | |
| ratio to the sampling interval | |
| `kind` — measured, degraded or not-observed | |
| own tab carried `■ Not taking new work — ` within one poll interval | |
| un-halt read back on all three surfaces | |
