# 39-PARTICIPANT-COUNT — what criterion 4 can publish from the run, and what it may not

**Dated:** 2026-09-07
**Requirement:** BENCH-06 · **Phase 39 criterion 4** · **Plan:** 39-04
**Evidence:** `packages/bench/src/participants.test.ts` (9 cases) and
`packages/node/src/machine-claim-guard.node.test.ts` (11 cases), both
`npx vitest run --project node`, exit `0`, both plants watched red and restored.

Criterion 4 asks for a map/reduce job spread over independently-owned devices, *"each machine read
off its own announced handshake line rather than off the driver, and the distinct-machine count
published beside the curve"*. This document says which half of that a run can produce today, which
half it cannot, and what the second half is actually waiting on. It is a record of a boundary, not a
plan to cross one.

---

## 1. What can be published from the run, today

A distinct **participant** count, over peer ids, labelled as peers.

`distinctParticipants(outcome.executedBy)` in `packages/bench/src/report.ts` answers the number of
distinct executor peer ids in a `ReduceOutcome`, with `LOCAL_COMBINE_EXECUTOR` removed. It reads the
same field `harness.ts`'s `combineExecutors` already reads — `executedBy` is contribution id →
executor peer id, `packages/core/src/reduce.ts:398` — and it is **distinct** rather than
per-contribution, so three contributions answered by two peers are two participants. The local
pseudo-executor is excluded rather than counted because `reduce.ts:355` calls it *"an id no peer can
present"*: a run whose every combine stayed inside the requestor's own process observed no
participant at all, and answering `1` there would publish the requestor as a participant in its own
run.

`participantLabel` in the same file renders the reading, and when nothing announced a machine it
produces exactly this sentence:

> `N distinct peers — machine count not measured; peers are tabs, and two tabs on one device are two peers`

The caveat travels inside the string with the number, for `machineLabel`'s reason: a label that sits
in a separate paragraph gets separated from its figure the first time somebody copies the figure out.
And the trailing clause is the whole point — a peer id is what a browser tab has, so two tabs open on
one laptop are two peers and one device. Publishing that pair as a device count is the exact
over-count `BENCH-06`'s own row forbids.

**What the peer count is not.** It is not identity-hardened. Nothing stops one operator presenting
many peer ids, so the figure is an upper bound on independent participants rather than a measurement
of them. That is accepted rather than mitigated (threat `T-39-17`) precisely because the label says
*peers*: criterion 4's real claim rides on the machine half, and the machine half stays unmeasured.

**The shape the label takes once a source exists.** `participantLabel` accepts
`announcedMachines: number | null`, and given a number it prints `5 distinct peers on 3 announced
machines`. The field has **no default**, deliberately: an optional field defaulting to a number would
reproduce the defect `packages/node/src/bench-inventory.ts` records in its own header — a `hostCount`
that was `1` by construction, whose published label no plant could falsify — and the only thing that
would legitimately fill it is an `AnnouncedMachine`, which does not exist on the browser job path.
`null` is the honest reading today and the type says so rather than a comment saying so.

---

## 2. What may not be published, and why it is a rule rather than a caution

A machine count with no announced-machine source behind it. Criterion 4 states the prohibition in its
own words — *"a same-host figure may not be published in its place"* — and the reason it is a rule is
that the same-host figure is the one that will be lying around, already measured, looking quotable, at
exactly the moment somebody wants a headline.

`packages/node/src/machine-claim-guard.node.test.ts` is what refuses it. It scans every tracked `.md`
and `.html` under `.planning/`, `docs/perf/`, `packages/browser/demo/` and the repository root, minus
`-PLAN.md` — a plan is a prompt written to an agent, not a sentence published to a reader — and it
reddens the `node` lane on a numeral used as a count of machines. A hit is **cleared** when the same
paragraph names where the machines were announced: the literal `announcedMachine`, `AnnouncedMachine`,
or the phrase `announced handshake`. So the guard does not forbid the number; it forbids the number
without its provenance, which is `report.ts`'s standing rule about the same-machine label applied to
published copy instead of to a type.

**The guard is proved able to see a claim, in the same run that asserts none exists.** An absence
measured with a blind instrument is this repository's most-repeated failure, so case A runs first and
feeds the predicate a fixture that contains a claim, asserting **exactly one** hit rather than merely
"something was found". The plant confirmed the control is load-bearing rather than decorative:
weakening the number-adjacency test so it can never match left the corpus case **green** — an absence
assertion satisfied perfectly by an instrument that cannot see anything — while case A went red with
*"the instrument did not see the fixture … case C's absence is then vacuous"*.

**The guard also had to be corrected by its own first reading, and that correction is part of the
record.** Its first run over the real corpus returned nine hits, and all nine were one defect: the gap
between the numeral and the noun was unrestricted, so a numeral bound across a preposition into a
different phrase. Verbatim, from `docs/perf/prime-and-pi-benchmarks.md:5` — *"Measured 2026-08-02 on
one machine: 8 physical cores"* — where the `02` of a **date** was read as the count of the machines
in *"on one machine"*, whose actual count word is `one`; and from `29-REPORT.md:118`, *"exits 0 on a
machine"*, where the numeral is an **exit code**. Both sentences are honest same-host disclosures,
which is the opposite of the thing being guarded against, so the nine were an instrument defect and
not findings. A numeral now counts a noun only across adjectives. The residual is stated in the
guard's own source: it sees numerals and not English number-words, so *"across one machine"* is
invisible to it — a deliberate boundary, because the forbidden figure is a count published beside a
curve and that is written with a numeral, while *"on one machine"* is the sentence this corpus already
uses correctly in four places.

---

## 3. The three routes to the missing half, and what each costs

### (a) Announce a coarse machine descriptor on the job path

A per-visit datum — enough to tell two tabs on one laptop from two laptops — announced with the peer
so the reduce outcome can be grouped by it. This is the only route that produces the number criterion
4 actually asks for.

**It exceeds what the page promises.** `packages/browser/src/disclosure.ts` commits to *"no
identifiers beyond a peer key generated in this tab"*, and `packages/browser/src/browser-id.ts`
refuses `platform` and `hardwareConcurrency` **by name** for that reason. Announcing a machine datum
is therefore a disclosure change, which means a `DISCLOSURE_VERSION` bump, which re-asks every
returning visitor for consent.

**The bump is to `'9'`, not to `'7'`.** The plan that commissioned this document said `'7'`; that was
correct against a tree at version 6 and was overtaken the same week. `disclosure.ts:194` reads `'8'`
today — `a255a4f` took 6 to 7 and `dc82351` took 7 to 8, both on 2026-09-04.

**This is an owner's ruling and not an engineering choice**, because what it spends is a cohort's
willingness to be asked, and that is spendable once.

### (b) Announce nothing, and publish distinct peers only

Costs nothing, changes no disclosure, re-asks nobody. It leaves `BENCH-06`'s distinct-machine half
exactly where its own row already puts it: descoped and unmeasured. This is what §1 builds, and it is
what a run reports if no ruling is made before it.

### (c) Derive the number from `/self`'s counters or from the funnel

**Foreclosed.** Not re-argued here: `39-COUNTER-READING.md` §4 measured it against a running
`workerd`. `relayService.inboundHopStreams` counts streams and cannot tell a RESERVE from a CONNECT,
`traffic.direct`/`traffic.relayed` carry no peer identity at all, and the funnel's store is aggregate
by construction with a schema frozen at digest `3911527f1a04abee`. A figure captioned as a device
count and derived from any of them would be precisely the substitution criterion 4 forbids.

### The sequencing fact that makes (a) cheap, if it is chosen soon

**The published page is behind the tree, so the next release cut re-asks everyone once regardless** —
and a disclosure change ruled on *before* that cut therefore rides a re-ask that is already owed
rather than buying a second one.

Read 2026-09-07 off the locally-held `origin/gh-pages` ref, which is the publication mechanism:
commit `edf132a`, committed `2026-09-02T01:59:49+00:00`. That predates the version `'5'` bump
(`3cfc0f6`, `2026-09-02T22:30:44+00:00`) by about twenty hours, and therefore predates `'6'`, `'7'`
and `'8'` as well — all three landed on 2026-09-04. The instrument has a positive control: the word
`passphrase`, which is version 8's headline change, appears 34 times in the tree's
`packages/browser/demo/index.html` and **zero** times in the published `index.html` or its bundle, so
the grep can see the word and the publish genuinely does not carry it. **Stated with its caveat**:
this is the last-fetched state of a remote-tracking ref read locally. Nothing was fetched, nothing was
deployed and nothing was published to produce this reading.

---

## 4. The task that cannot complete before the run

Plainly: the distinct-machine count is not takeable now, and no amount of work in this repository
makes it takeable. It waits on two things, in order — **(i)** the owner's ruling on §3, because the
only route that produces the number spends a disclosure version and a cohort's consent; and **(ii)**
the run itself, because the number is a reading of what connected and cannot be derived from anything
already measured.

Until both, criterion 4's distinct-machine half stays **descoped and unmeasured — not met**, exactly
as `REQUIREMENTS.md`'s own carried-ids row for `BENCH-06` words it, and no same-host figure may be
published in its place. `BENCH-06` is not ticked by this plan and this document does not close it.
What this plan leaves behind is the half that needs no ruling — a peer count that says it is a peer
count — and a mechanism that reddens if anybody publishes the other half without having measured it.
