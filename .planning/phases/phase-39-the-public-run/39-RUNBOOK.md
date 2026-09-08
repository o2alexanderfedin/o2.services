# Phase 39 — the staged invite runbook, and the arithmetic that says whether the next stage goes

**Dated:** 2026-09-07
**Requirement:** `RUN-07` · **Phase 39 criterion 3** · **Plan:** 39-05
**Tool:** `tools/run/stage-budget.mjs` · **Spec:** `packages/node/src/stage-budget.node.test.ts`

Every act in this document is the owner's. No agent sends an invitation, publishes a figure,
deploys, cuts a release, or creates a Cloudflare resource — and no agent took any reading quoted
below off the deployed object. Where a number here is attributed to the deployed node it is a
**recorded** reading with its date, carried forward from the file that took it, and the live read
is itself an owner act.

The reason this document is arithmetic rather than a schedule: on 2026-09-03 the first real
traffic took the hosted tier down mid-day, and the control that was supposed to catch it could
not have. So the rule this runbook works to is **a stage that cannot state its expected request
cost before it is sent is a stage that must not be sent**, and the tool refuses rather than
defaults so that a stage cannot be sent while merely looking priced.

---

## 1. What this inherits from Phase 37’s runbook, and deliberately does not restate

`.planning/phases/phase-37-the-six-stage-funnel-and-a-frozen-telemetry-schema/37-RUNBOOK.md`
already names the five things that have to happen around the funnel. This document discharges
them rather than duplicating them; where a line below says SKIPPED or DISCHARGED, that is the
whole of what is owed.

- Its **step 1** — deploy the Worker carrying `/funnel` — is discharged by the release-cut owner
  row that plan 39-08 writes into `.planning/OWNER-ACTIONS.md`. Nothing here re-plans a deploy.
- Its **step 2** — the pre-invite `curl` of `/funnel`, recorded with its date — is discharged by
  §4 reading 1 below, taken once **before stage 1** and then compared against on every later
  stage. It is also Phase 39 criterion 2's timestamped evidence, so it is the one reading in this
  document that cannot be skipped or reconstructed afterwards.
- Its **step 3** — point the published page at the collector — is **DISCHARGED BY CONSTRUCTION**
  and must not be re-planned as a `?funnel=` link. The collector origin is derived from the relay
  the page bootstraps through, and the deployed relay is the collector; the owner's own smoke
  visit moved `entered['page-load']` and `entered['consent']` from 0 to 1, which is that step's
  own stated evidence. Since plan 39-02 the page also **probes** the derived origin and installs
  no send port unless the body comes back collector-shaped, so a page can no longer look
  configured while collecting nothing.
- Its **step 4** — the documented balancing test — is **SKIPPED**, dated 2026-09-04 by its own
  terms, because the ruling on the telemetry's legal basis was **consent** (reading A). The code
  already implemented reading A, so nothing moved and no balancing test is owed.
- Its **step 5** — confirm the freeze held — is discharged by the `schemaDigest` equality check
  in §4 reading 1, run at **every** between-stage reading and not only at the first. Its rule is
  carried unchanged: if the digest has moved, find out what changed and revert it — never record
  the new digest.

---

## 2. The stages

Sized so the first one is small enough that its own cost is not the interesting number, and each
later one is roughly triple the last. The join rate of 0.3 in stage 1 is an **assumption, not a
measurement** — it is the one input here nobody has read yet, and §4 is what replaces it: the
funnel's own `first-task ÷ consent` ratio after stage 1 is the measured join rate that sizes
stage 2. That substitution is the whole mechanism by which the estimate stops being trusted.

| Stage | Region | Cohort slice | Invites | Estimate flags | Estimate (DO requests) |
|---|---|---|---|---|---|
| **1** | the one production region | the smallest reachable slice — people the owner can follow up with individually if the node misbehaves | **25** | `--invites 25 --join-rate 0.3` | **1438** |
| **2** | the one production region | a second slice with no overlap with stage 1, sized off stage 1's *measured* join rate rather than the assumed one | **75** | `--invites 75 --join-rate <measured>` | **4313** at 0.3 |
| **3** | the one production region | the remainder of the Telegram cohort | **200** | `--invites 200 --join-rate <measured>` | **11500** at 0.3 |
| **4** | a second region | — | — | — | **BLOCKED**, see the note |
| **5** | a third region | — | — | — | **BLOCKED**, see the note |

**Stage 1's arithmetic, shown rather than only answered.** 25 invitees are 25 visits. Each visit
spends 1 request probing whether the derived origin is a collector, so 25 × 1 = 25. Each visit
posts at most 7 funnel reports — six `enter` reports, one per stage, plus one terminal `stalled`
— so 25 × 7 = 175. At an assumed 0.3 join rate, 7.5 of them hold a relay reservation, and a
reservation costs about 165 Durable Object requests, so 7.5 × 165 = 1237.5. The three terms come
to 1437.5, rounded up to **1438**. Against the 10 000 000 requests the Workers Paid plan includes
each month that is **0.014 %** — which is the point of stage 1: whatever it teaches, it does not
teach it by costing anything.

**On the regional arms — stated plainly rather than left to be inferred.** **Production has ONE
region today.** `HOST-06`, `HOST-07` and `NET-15` are all open, **Phase 33** has no directory and
no plan, and its three objects are blocked on `.planning/OWNER-ACTIONS.md` row 2 — about $15 a
month. So stages 4 and 5 are **blocked, not omitted**: `RUN-07` asks for staging by region *and*
by cohort slice, the cohort-slice arms are executable with one region and are what stages 1 to 3
use, and the regional arm has exactly one value until Phase 33 exists. This document names no
hosted object's physical location and none of the rows above should be read as doing so.

A consequence worth writing down before it is discovered during a run: with one region, a
production halt is **cohort-global**. `RUN-02`'s kill switch slices by region, and with one
region the slice is everybody.

---

## 3. Owner acts in this document, and what number means stop

Each of these is the owner's, none is an agent's, and each has an exact script below.

| # | Act | Where | What means stop |
|---|---|---|---|
| A | Take the pre-invite `/funnel` reading, once, before stage 1 | §4 reading 1 | a `schemaDigest` other than the recorded `3911527f1a04abee`, or a `population` other than `opted-in-only` |
| B | Send a stage's invitations | §2 | the previous stage's verdict was not `go` |
| C | Read the Durable Object **request** count for the period | §4 reading 3 | see §5 — it is the tool that answers, not the reader |
| D | Run the tool and act on its exit code | §4 reading 4 | exit `1` is stop, exit `2` is refused |

These belong in `.planning/OWNER-ACTIONS.md` beside the seven acts already there. **This plan does
not write them there** — that file is the owner's ledger and it is extended by him, or by plan
39-08 for the release-cut row.

---

## 4. What is read between stages, in order

All four are read **after** a stage and **before** the next invitation. Reading 4 consumes the
first three. `<origin>` is the deployed node's origin, which `.planning/OWNER-ACTIONS.md` row 8
already writes out; substitute it once.

### Reading 1 — the funnel, and the digest that must not have moved

```
curl -s https://<origin>/funnel
```

Read back: the six stage counts, the `population`, and the `schemaDigest`.

The pre-invite baseline, **recorded 2026-09-04 and carried here rather than re-read by any
agent**: `population` is `opted-in-only`, `schemaDigest` is `3911527f1a04abee`, and all six
stages are zero. Every later reading compares its digest against that string.

**Different digest → STOP and revert.** The schema moved between the pre-invite reading and
recruitment, and the correct response is to find out what changed and put it back — **never to
record the new digest**. `packages/net/src/funnel-schema.test.ts` says the same thing in its own
failure message.

Two qualifiers travel with every count this endpoint reports, and a figure quoted without them is
wrong. The population is the **opted-in subset** — under the consent ruling a page load before
consent cannot be counted at all. And since plan 39-02 the send port is installed only after the
collector probe answers, so a visit that consents, starts and closes inside one round trip loses
its first two stages and its terminal `stalled`. **The denominator is therefore the opted-in
subset that did not bounce inside one round trip**, and both qualifiers belong beside any ratio
taken from it — including the measured join rate that sizes the next stage.

### Reading 2 — the coarse arrival signal, cross-referenced

```
curl -s https://<origin>/self
```

Read back `relayService.inboundHopStreams` and `traffic.direct`.

What they do and do not count is measured in
`.planning/phases/phase-39-the-public-run/39-COUNTER-READING.md`, and the negative half matters
more than the positive one: **`traffic.relayed` reads zero at every point even while the node is
carrying a relayed connection**, so it is not an arrival signal and must not be read as one.
`relayService.inboundHopStreams` moves 0→1 on a reservation and again on a connect through it;
`traffic.direct` accrues on the direct legs and banks at close.

This reading exists because reading 1 is aggregate and unauthenticated by design. A poisoned
funnel count would move a stop decision, and the mitigation is this cross-reading rather than an
authentication the collector deliberately does not have. **If the funnel says people arrived and
`inboundHopStreams` has not moved, believe neither and stop.**

### Reading 3 — the Durable Object request count, which is the meter that binds

In the Cloudflare dashboard: **Workers & Pages → the Worker → Metrics → Durable Objects**, and
read the **requests** figure for the current billing period, together with how many days of the
period have elapsed.

**Read the Durable Object *request* meter, not the Workers *invocation* meter.** They are not the
same number and they are not close: on 2026-09-03 they read **1 100 232** and **1 966** on the
same day. Only the first one binds, because every WebSocket message counts as a Durable Object
request, so the driver is protocol chattiness per connection and not visitor count. A reader who
takes the invocation figure will conclude there is nothing to worry about, three orders of
magnitude too low.

### Reading 4 — the verdict

```
node tools/run/stage-budget.mjs --invites 25 --join-rate 0.3 --measured-delta <delta> \
  --period-total <from reading 3> --days-elapsed <from reading 3> --days-in-period 30
EXIT=$?
```

`<delta>` is reading 3's request count **minus** the same figure read before the stage — the
requests this stage actually cost. `EXIT=$?` goes on the line **immediately** after the command:
no pipe, no trailing `tail`, no `echo` in between. In zsh a piped command's status is
`pipestatus[1]`, not `PIPESTATUS`.

Four lines come back, prefixed `[stage-budget]` — the estimate, the projection, the verdict and
the reason — and the exit code says the same thing:

| exit | meaning |
|---|---|
| `0` | `go` — the next stage may be sent |
| `1` | `stop` — it may not, and the reason line names which arm fired and both numbers it compared |
| `2` | **refused** — an input was absent or was not a number, so no cost could be stated at all, which is itself a stop |

---

## 5. The stop rule, as numbers

Two arithmetic conditions, both **strictly greater than**, so a reading exactly at a boundary is
a `go`. Both are in `stageVerdict`, both are covered by the spec, and the constants are:
included **10 000 000** Durable Object requests per month on Workers Paid at $5/month, overage
**$0.15** per million, tolerance factor **3**.

**Arm 1 — the estimate was wrong by more than the stated factor.** Stop when the measured delta
exceeds 3 × the estimate. For stage 1 that allowance is 3 × 1438 = **4314 requests**; a stage 1
that costs more than that stops the run. The factor is a stated judgement sited against the
estimate's own admitted error rather than against a measurement: the model carries two ceilings
and one floor, so it can be wrong either way by a factor rather than by a percentage, and three
is where "the model is coarse" stops explaining the gap. The floor is the one that matters at
scale — the estimate treats **one join as one reservation**, and a reservation is renewed, so a
cohort that stays online costs more than the estimate says.

**Arm 2 — the projection overruns the included allowance.** Stop when the period total scaled to
the whole period exceeds 10 000 000. The worked example is the incident's own numbers:

```
[stage-budget] estimate 2875 requests for 50 invites at join rate 0.3
[stage-budget] projection 11002320 requests for the period against 10000000 included
[stage-budget] verdict stop
[stage-budget] reason the period projects to 11002320 requests against 10000000 included — 1100232 in 3 of 30 days; overage is $0.15 per million
```

**Say plainly what that stop is and is not about, because the money reading is misleading.** An
overage of 1 002 320 requests at $0.15 per million is about **fifteen cents for the month**. The
bill is not the reason to stop. To reach overage comparable to the $5 plan fee itself the period
would have to project near **43 000 000** requests, more than four times the allowance. What arm
2 actually catches is a **rate**, and a rate is what took the tier down: on 2026-09-03 the
failure was a *cap*, refused at the edge with the Worker script never running, not a bill — and a
spending alert, which is `.planning/OWNER-ACTIONS.md` row 1, is a control on money and would not
have caught it. So a stop here means: **the ambient rate is already at the shape of the plan's
ceiling before the cohort arrives, and the term the model under-counts is the one that grows with
the cohort.** Find out what is generating it before adding to it.

**Arm 3 — a cliff in the funnel, and it is not arithmetic.** Stop when **any funnel stage's count
is zero while the stage before it is not**. Six stages that descend are a population; a stage
that reads zero under a non-zero one is not attrition, it is something broken between the two —
and that is the single thing the funnel exists to show. No tolerance applies: one is not zero.

---

## 6. Recorded as inferred

Carried verbatim from Phase 39 criterion 3, because the criterion states its own limit and this
document does not get to state a smaller one:

> Staged rollout is **inferred from general release practice and recorded as inferred**: no named
> volunteer-computing precedent for staged rollout of a compute cohort was found, and this
> criterion does not pretend otherwise.

The shape of the stages above — small first, roughly tripling, a reading between each — is
general release practice and nothing more. It is **not** evidence about volunteer computing, and
no summary of this phase may cite it as such. What *is* evidence, and is cited for a different
claim, is that a Telegram-recruited cohort of a few hundred is spendable exactly once: SETI@home's
move to BOINC lost roughly half of its ~600 000 volunteers to added platform complexity alone,
with no bug and no bad actor.

---

## 7. What this runbook does not do

No agent sends an invitation, posts to Telegram, publishes a figure, deploys, cuts a release, or
creates a Cloudflare resource. Every act in §3 is the owner's, and the acts already agreed are in
`.planning/OWNER-ACTIONS.md`. Nothing in this plan wrote to that file.

Neither does this document open the gate. `RUN-01`'s seven conditions are in
`.planning/phases/phase-39-the-public-run/39-GO-NO-GO.md` and all seven read `GO`; the
preconditions listed *below* that table do not, and three of them — the release cut, the
front-door request budget, and the pre-invite funnel reading — sit in front of stage 1. This
runbook says how to stage the invitations **once** they may be sent. It does not say they may be.
