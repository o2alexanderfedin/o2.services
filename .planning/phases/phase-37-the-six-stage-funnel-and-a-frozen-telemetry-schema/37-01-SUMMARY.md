---
phase: 37-the-six-stage-funnel-and-a-frozen-telemetry-schema
plan: 1
subsystem: telemetry
tags: [funnel, telemetry, schema-freeze, workerd, durable-object, privacy, webrtc, gdpr-open-question, e2e]
requires:
  - .planning/phases/phase-35-conditions-of-entry-in-the-browser/35-01-SUMMARY.md
provides:
  - "RUN-04 Done — six stages instrumented, all six observed moving on real tabs against a local workerd, and the whole vector readable over one HTTP read while a tab is still running"
  - "RUN-05 Partial — the schema is frozen by a digest guard and the store is proved to hold no address and no cross-session identifier; the telemetry's LEGAL BASIS is the owner's and is pending"
  - "criterion 2 — five attribution arms, each moving exactly one drop counter, with the two-counter plant watched red across the arms that can see it"
  - "criterion 3 — a hand-written digest compared against the field set on every run, in both lanes"
  - "criterion 4 — the Durable Object's persisted SQLite read directly, every row scanned, with a positive control richer than the criterion asks for"
  - "criterion 5 — a proxy-label guard over 438 files, and no counter initialised to anything but zero"
  - "the measured reason a global wrapper cannot be installed from a statement in demo/main.ts"
affects:
  - packages/net/src/funnel-schema.ts
  - packages/net/src/funnel-schema.test.ts
  - packages/net/src/index.ts
  - packages/cloudflare/src/funnel-journal.ts
  - packages/cloudflare/src/funnel-journal.test.ts
  - packages/cloudflare/src/funnel-collector.ts
  - packages/cloudflare/src/funnel-collector.test.ts
  - packages/cloudflare/src/funnel-collector.e2e.test.ts
  - packages/cloudflare/src/worker.ts
  - packages/cloudflare/src/worker.test.ts
  - packages/browser/src/funnel-reporter.ts
  - packages/browser/src/funnel-reporter.test.ts
  - packages/browser/src/funnel-reporter.node.test.ts
  - packages/browser/src/ice-observer.ts
  - packages/browser/src/ice-observer.test.ts
  - packages/browser/src/ice-observer-install.ts
  - packages/browser/src/disclosure.ts
  - packages/browser/demo/main.ts
  - packages/browser/demo/policy.html
  - packages/node/src/funnel-live.e2e.test.ts
  - packages/node/src/funnel-attribution.e2e.test.ts
  - packages/node/src/proxy-figures.node.test.ts
  - packages/node/src/disclosure-four-elements.node.test.ts
  - packages/node/src/reachability-guard.node.test.ts
  - vitest.config.ts
  - .planning/REQUIREMENTS.md
tech-stack:
  added: []
  patterns:
    - "a global a library captures at module evaluation can only be wrapped by a module imported before it, never by a statement"
    - "a store is dumped from its persisted file rather than through a route, so proving an absence costs no production surface"
    - "an absence scan needs a floor asserting the text it scanned is real, because a broken decoder reports a clean sheet"
    - "a legitimate constant that matches a forbidden pattern is excluded BY NAME, never by widening the pattern"
    - "the arming point of a measurement is a value, so a pending legal ruling changes data rather than code"
decisions:
  - "The reporter is armed at CONSENT while open question 3 is pending — the intersection of both readings, lawful under either, and a ruling can only widen it"
  - "The funnel goes over plain HTTP and not over the fabric, because a measurement of where visitors fall out must not ride the channel that falls out with them"
  - "text/plain plus navigator.sendBeacon, so the terminal report needs no preflight — a preflight cannot be sent from a page that is already unloading"
  - "networkClass travels in the body and country on the request: a visitor must not choose which country their visit is filed under, and sendBeacon cannot set headers"
  - "Stage five counts a COMPUTE peer, not the relay — counting the relay put the roadmap's stages four and five in the wrong order"
  - "Stage six is executed >= 1 and executorInFlight === 0, not tasksExecuted, which counts admissions"
  - "The endpoint has no default and no origin literal, enforced by a source scan, because a default would make every e2e run post to the owner's deployed object"
metrics:
  completed: 2026-09-02
---

# Phase 37 Plan 1: The Six-Stage Funnel and a Frozen Telemetry Schema — Summary

Six named stages counted from a visitor's browser, banked in a Durable Object where eviction
cannot reach them, and readable through one HTTP request while a tab is still running — on a
schema designed backward from exactly three questions and frozen by a digest that reddens when
a field is added.

---

## The plants that did NOT redden, and what carried the claim instead

This goes first because it is the most valuable thing here. **Five instruments in this phase
were green for reasons that had nothing to do with the property they claimed**, and four of
those were found by a plant that should have reddened and did not.

### 1. The IP plant stayed GREEN, and the store had the address in it the whole time

Task 3's headline plant makes the collector store the client address. The dump case stayed
green. It was **not** accepted: the plant was investigated, and the address was found sitting in
the persisted file as `"plantedClientAddress":"192.0.2.199"`.

**`node:sqlite` returns a BLOB as a `Uint8Array`, not a `Buffer`.** The dump tested
`Buffer.isBuffer(value)` and fell through to `Buffer.from(String(value))`, which renders a
`Uint8Array` as the decimal string `255,15,66,123,...`. Every scan then searched *that* — so no
IPv4 pattern, no identifier pattern and no literal could ever have matched anything.

Repaired, the plant reddens naming the key and the value:

```
AssertionError: the client address is in the store. keys held: /identity/seed, /journal/funnel:
expected '/identity/seed=... /journal/funnel=...' not to contain '192.0.2.199'
```

### 2. Repairing that revealed the identifier scan had been vacuous — and then falsely positive

With the decoder fixed, the per-visit-handle plant reddened — **on the schema digest**, a
legitimate sixteen-hex-character literal that is identical in every record every object ever
writes. So the scan had been searching comma-separated decimals (vacuous), and then flagged the
one value that is provably not a per-visit anything.

`schemaDigest` is now excluded **by name**, never by widening the pattern — a wider pattern
would have blinded the scan to a real handle of the same width — and the case gained a floor
asserting the scanned text contains counters and is longer than 200 characters. The plant then
named the plant:

```
AssertionError: an identifier-shaped run is in the funnel record.
keys held: /identity/seed, /journal/funnel:
expected 'cfdccdc6ec5546e0abdd26cf8a4d222d' to be null
```

### 3. The positive control tested something it did not claim

It asserted that *some* country cell existed after the reports — but the report that produced
that cell had supplied `CF-IPCountry: DE` explicitly, so it proved a header was read and said
nothing about anything derived from the address. It now sends a report with **no country header
at all** and asserts the answer is not `ZZ`, compared inside the run rather than against a
literal that would encode this machine. Withholding `request.cf` reddens it:

```
AssertionError: the country came back as ZZ, so nothing derived from the client address reached
the store on this run and every absence in the next case is vacuous: expected 'ZZ' not to be 'ZZ'
```

### 4. The zero-seed source scan missed a bracketed assignment

Task 6's seed plant reddened the *value* case and left the *source-scan* case green. The pattern
matched `'page-load': 12` and missed `seeded['wss-bootstrap'] = 7`, which is exactly how a seed
would be written into a record built by a helper. Widened with an optional `]`; the plant then
reddens both:

```
AssertionError: funnel-journal.ts seeds the stage "wss-bootstrap" with a non-zero value.
A counter that starts at an estimate is a backfill that happened before anybody published
anything.: expected true to be false
```

### 5. ARM 1 of criterion 2 cannot see the two-counter plant, and could not have

The two-counter plant reddened arms 2, 3 and 4, each naming both counters that moved. **Arm 1
stayed green** because it sends nothing at all — a visit that ends before consent reports nothing
under the pending arming point, so a defect in the terminal report is invisible to it. Recorded
rather than deleted. **Criterion 2 is carried by arms 2, 3, 4 and 5, not by arm 1.**

### 6. And the largest one — a plant that could not fail, arriving as a real red

`ice-observer.test.ts` proves the wrapper reports once over a fake `RTCPeerConnection`, in both
lanes, with eight cases. It says **nothing** about whether libp2p's real one ever passes through
it. The live arrangement is what asked: two real browser contexts completed a genuine
browser-to-browser WebRTC dial, each held the other as a peer, and `ice-gathering` stayed at
**0**:

```
AssertionError: RUN-04 stage four: a real browser-to-browser dial happened and the ICE observer
saw nothing. The wrapper is installed before `BrowserNode.start`; if this is red, check that
ordering first — entered[ page-load=3 consent=3 wss-bootstrap=3 ice-gathering=0
connection-classified=3 first-task=0 ] ...: expected 0 to be greater than 0
```

The cause is one line of `node_modules/@libp2p/webrtc/dist/src/webrtc/index.browser.js`:

```js
export const RTCPeerConnection = globalThis.RTCPeerConnection;
```

**A `const`, captured when that module evaluates.** libp2p holds the constructor the page had at
bundle-load time and never reads the global again. Import statements are hoisted above every
statement in the importing module, so **no line of `demo/main.ts` can run early enough** — the
install had to move out of `api.start()` into a module imported *first, for its side effect*,
which is the register `packages/cloudflare/src/workerd-shims.ts` established for the identical
problem one tier over. With that change `ice-gathering` moves, and the plan's pre-authorised
widening was needed exactly as written.

---

## What closed, and what did not

| | verdict |
|---|---|
| **Criterion 1** — six stages, live | **Closed on local `workerd`**, over the population the arming point admits. Two caveats below. |
| **Criterion 2** — one failure, one counter | **Closed** on the four arms that can see the plant; two drop counters are structurally unreachable and are named below. |
| **Criterion 3** — three questions, frozen | **Closed.** |
| **Criterion 4** — aggregate-only, IP discarded | **Closed**, checked against the store rather than against the collector's intent. |
| **Criterion 5** — no proxy read as a measurement | **Closed.** |
| **`RUN-04`** | **Done.** |
| **`RUN-05`** | **Partial** — the legal basis is the owner's and is not chosen here. |

### Criterion 1 owes two caveats, and neither is a formality

1. **The whole-population reading depends on open question 3.** The funnel measures a
   **self-selected opted-in subset**. Stage one is held and flushed at consent, so its count
   equals stage two's by construction and the first drop-off — how many visitors arrive and never
   consent — **is not measurable at all** under the current arming point.
2. **No reading has been taken on a deployed object.** The criterion's own words are *reporting
   live before recruitment begins in Phase 39*, and the last mile of that is a reading on the
   deployed collector. That is money, it is an owner act by the 2026-08-25 ruling, and it is
   `37-RUNBOOK.md` step 2.

---

## Every raw number

### The live vectors — one tab, then two, on a local `workerd`

```
before consent: entered[ page-load=0 consent=0 wss-bootstrap=0 ice-gathering=0
                         connection-classified=0 first-task=0 ]  stalledAt[ all zero ]
armed:          entered[ page-load=1 consent=1 wss-bootstrap=0 ice-gathering=0
                         connection-classified=0 first-task=0 ]  stalledAt[ all zero ]
running:        entered[ page-load=1 consent=1 wss-bootstrap=1 ice-gathering=0
                         connection-classified=0 first-task=0 ]  stalledAt[ all zero ]
did not move:   ice-gathering, connection-classified, first-task
after leaving:  entered[ ...unchanged... ]                        stalledAt[ wss-bootstrap=1 ]
after webrtc:   entered[ page-load=3 consent=3 wss-bootstrap=3 ice-gathering=2
                         connection-classified=2 first-task=0 ]   stalledAt[ wss-bootstrap=1 ]
after the job:  entered[ page-load=3 consent=3 wss-bootstrap=3 ice-gathering=2
                         connection-classified=2 first-task=1 ]   stalledAt[ wss-bootstrap=1 ]
```

**`before consent` is all zeros and that is the load-bearing reading of this phase.** It is the
one observation that would break the claim that the pending arming point is the *intersection* of
both legal readings rather than a choice between them, and it is asserted live rather than
argued.

**Which stages a single tab cannot reach, and why.** `ice-gathering` needs a browser-to-browser
dial, which one tab against a WSS relay never attempts. `connection-classified` needs a compute
peer, which is not the relay. `first-task` needs work, which nothing dispatched. A second browser
context, a real `/webrtc` dial and a real job over the demo's own committed kernel move all
three.

### The attribution arms — each with its own `workerd`, its own port, its own storage

```
arm 1  no consent           entered[ all zero ]                              stalledAt[ all zero ]
arm 2  consent, then leave  entered[ page-load=1 consent=1 ]                 stalledAt[ consent=1 ]
arm 3  dead relay port      entered[ page-load=1 consent=1 ]                 stalledAt[ consent=1 ]
arm 4  relay only           entered[ page-load=1 consent=1 wss-bootstrap=1 ] stalledAt[ wss-bootstrap=1 ]
arm 5  two tabs on WebRTC   entered[ page-load=2 consent=2 wss-bootstrap=2
                                     ice-gathering=2 connection-classified=2 ]
                                                                 stalledAt[ connection-classified=2 ]
```

Every arm asserted a six-zero floor before its page opened. The two-counter plant's observed
text, verbatim:

```
AssertionError: criterion 2: 2 drop counters moved for one induced failure (consent,
wss-bootstrap). A funnel where one failure moves two counters cannot tell anyone where a cohort
was lost. before entered[ ... ] stalledAt[ all zero ] after entered[ ... ] stalledAt[ consent=1
wss-bootstrap=1 ]: expected [ 'consent', 'wss-bootstrap' ] to deeply equal [ 'consent' ]
```

### The schema and its bounds

| | |
|---|---|
| `FUNNEL_SCHEMA_DIGEST` | `3911527f1a04abee` |
| `FUNNEL_SCHEMA_FROZEN_AT` | `2026-09-02` |
| `FUNNEL_MAX_CELLS` | **13 676** — 6 + 6 + 144 + 3 380 + 10 140 |
| `FUNNEL_RECORD_CEILING_BYTES` | **476 224 B**, derived from the cell bounds |
| a saturated record, measured | **415 606 B** — all 676 country codes x 5 classes x 3 connection classes |
| the measured storage wall | **4 194 304 B** (`do-datastore.ts:231`) |

So a fully saturated record is about **a tenth** of what the platform refuses.

Digests observed under the three Task 1 plants: a seventh field gives `264024eb07655a7e`; a field
answering nothing gives `a21842af557f43bb`; a fourth question gives `289856e4e8023a10`. Each
differs from the frozen literal, which is what "adding a field reddens the suite" means
mechanically. The fourth-question plant additionally reddens the literal `3`:

```
AssertionError: expected 4 to be 3
```

and the answerless-field plant reddens the question mapping:

```
AssertionError: RUN-05: the field "plantedAnswerlessField" answers none of the three questions,
so it is not collected. Either name the question it answers or delete the field — criterion 3
does not have a third option.: expected 0 to be greater than 0
```

### The journal's two plants

Removing the rollback refusal:

```
AssertionError: promise resolved "{ ...(7) }" instead of rejecting
```

on both the lower-total case and the lower-cell case. Making a malformed value read as zeros
reddens all three malformed cases with the same text — **after** the first of those cases was
rewritten, because the original `{"entered":"nope"}` fixture was carried by the *population*
check rather than by the counter validation it claimed to test, and stayed green under the plant.

### The proxy guard

**438** files scanned, **26** occurrences of the five bounds, **0** unlabelled. The
label-removal plant, on `.planning/ROADMAP.md`:

```
.planning/ROADMAP.md:2509 quotes the proxy figure "10-20%" (relay-required) with no proxy label
within 400 characters. RUN-04: no published figure exists for what fraction of a general
audience cannot participate, so this number is somebody else's measurement of something else.
Say so beside it, or remove it.
```

— five such lines from one removed word, one per registry entry.

### The scope-fence plant

Giving the reporter a deployed-origin default:

```
RUN-04 scope fence: the reporter names a deployed host, so a page that configured nothing would
post to it. The endpoint is configuration and has no default.: expected true to be false
```

and, from the second case in the same file:

```
RUN-04 scope fence: the reporter carries an absolute origin literal. Even a localhost one is a
default, and a default is what turns "configure the collector" into "remember to configure the
collector".: expected 'https://...' to be null
```

### The reporter's and observer's plants

Making `enter(stage)` send on every call reddens the idempotence case (`expected true to be
false`). Removing the `icegatheringstatechange` listener reddens four of the observer's eight
cases (`expected +0 to be 1`), including *installing twice does not report twice*.

### The disarm plant, on the live arrangement

Making `armFunnel()` a no-op leaves every counter at the floor with the whole vector printed:

```
AssertionError: criterion 1: the held stage-one report did not arrive — entered[ page-load=0
consent=0 wss-bootstrap=0 ice-gathering=0 connection-classified=0 first-task=0 ]
stalledAt[ all zero ] population=opted-in-only: expected +0 to be 1
```

---

## What local `workerd` actually supplies — measured, recorded so nobody rediscovers it

A throwaway probe answered `GET /funnel?probe=1` with every request header and every key of
`request.cf`. **workerd refuses a custom HTTP method** (`ERROR: Unrecognized request method.`),
so the probe moved to a query parameter.

**Five headers arrived, and `CF-IPCountry` was not among them:**

```
accept = */*
accept-encoding = br, gzip
cf-connecting-ip = 127.0.0.1
host = 127.0.0.1:8797
user-agent = curl/8.7.1
```

`cf-connecting-ip` is stamped **without being asked**, which confirms
`inbound-listener.e2e.test.ts:331`'s recorded finding and hands criterion 4 its control for free.

**`request.cf` EXISTS on a local `wrangler dev`, and it is not empty.** Thirty-three properties,
populated from this machine's real public address. **The shape is the reading's; the values
below are synthetic** — this block carried the operator's own location and network until
2026-09-02:

```
country = 'US'          city = 'EXAMPLE-CITY'       region = 'EXAMPLE-REGION'
regionCode = 'XX'       continent = 'NA'        colo = 'XXX'
postalCode = '00000'    latitude = '0.00000'   longitude = '0.00000'
asn = 64496             asOrganization = 'Example Networks, Inc.'
timezone = 'Etc/UTC'   isEUCountry = False   clientTcpRtt = 7
```

**Two consequences, and both changed the work.**

1. The country path is **exercisable locally** after all: the collector reads `CF-IPCountry`
   first (the documented edge contract) and `request.cf.country` second (what workerd actually
   supplies). It remains **unmeasured on the edge** — no deployed reading exists.
2. Criterion 4's positive control is far stronger than the criterion asks for. **A street-level
   location, an ISP and a network fingerprint are one property access away from the collector on
   every request**, and the store afterwards holds two letters. `latitude` and `longitude` arrive
   as *strings*, which matters only because a naive `typeof === 'number'` filter would not have
   excluded them.

**A finding that belongs to a different phase:** `wrangler dev` populates `request.cf` from the
host's real public address, so any local e2e run in this repository has genuine geolocation of
the developer's machine inside the Worker. Nothing here stores it; it is written down because it
is a property of the *test arrangement* that nobody had recorded.

---

## The observables chosen by measurement, and why each

**Stage three — `BrowserNode.start` resolving with a peer held.** A browser has no listening
socket, so it can only be on the fabric by way of a relay reservation, and a start that could not
reach one rejects with `no-relay-reachable` before the line runs. `peer:connect` and
`peer:identify` were rejected because they also fire for peers reached later over WebRTC, so they
would report stage three for a visit that never dialled a bootstrap node.

**Stage five — the first CLASSIFIED peer that is not a relay.** This is a correction the live run
forced. With every peer counted, stage five fired within one 250 ms poll of stage three — the
tab's own bootstrap connection — so a single tab reported the roadmap's **fifth** stage while its
**fourth** stayed at zero. The relay *is* stage three; counting it again as stage five reported
one fact twice under two names and made the drop between them structurally zero.

`pathTo` supplies the class. `control-only` stays its own value, because a relayed pair that
carries control frames and no work is not a peer this visitor can compute with, and folding it in
would inflate stage five against stage six. **`relayed` is a value this tier does not produce**,
and that is stated rather than hidden: in a browser every relayed circuit is a *limited*
connection, so `pathTo` has already separated it as `control-only`, and anything left that
carries work is a direct WSS or WebRTC connection — which `classifyConnection` also calls
`direct`, deliberately, because a direct browser-to-browser address still names the relay that
signalled it.

**Stage six — `executed >= 1` and `executorInFlight === 0`.** Phase 35 measured
`activity().tasksExecuted` going `0 -> 128` inside 800 ms because `GovernedExecutor` increments
`#executed` **before** `inner.execute(task)`: it counts tasks *admitted*. The criterion's word is
*executed*. `CountingExecutor.execute` raises `#inFlight` as its first statement and lowers it in
a `finally`, and `GovernedExecutor` raises `#executed` in the statement immediately before
calling it — both synchronous — so the intermediate state is **never observable between two
polls** and no sampling rate can miss a completion.

---

## Deviations from the plan

### Two defects in this phase's own collector, found by review before the browser side was built

**1. `#bankFunnel` accrued, set the in-memory memo, then wrote.** Wrong twice. A refused write
left the memo holding counts storage had rejected, so `GET /funnel` reported numbers the next
eviction would erase — the exact loss the journal exists to prevent, arriving through the route
meant to prevent it. And two reports arriving together both accrued from the same base, so the
second offered a total below the first's, `writeFunnelJournal` refused it by name, and the memo
was then permanently below storage: **every later report on that instance refused until an
eviction**. A terminal report leaves on `pagehide` and unloads arrive in bursts, so this is the
ordinary case rather than a race.

Accrue and bank are now one link in the promise chain, and a refusal makes the memo a **fresh
read** rather than the stale base, so the refusal is self-healing. Two cases in `worker.test.ts`
read both halves: two concurrent POSTs both answered 204 with the count moved by exactly two, and
a refused write answered 500 with `GET /funnel` reporting what storage actually holds.

**2. `networkClass` was carried in a request header, and `navigator.sendBeacon` cannot set one.**
The terminal `stalledAt` report has to be a beacon, so a header-carried class would have been
systematically absent from exactly the reports that say where visitors were lost. It is a field
on `FunnelReport` now — also its honest home, since the browser's `effectiveType` is the only
source there has ever been for it. Country stays on the request: a visitor must not choose which
country their visit is filed under.

### Barrel exports were sequenced against the reachability guard, twice

`reachability-guard.node.test.ts` holds every unreachable callable barrel export **by name**, and
everything below `BootstrapObject.fetch` is unreachable for the hosted tier's standing reason —
the Workers runtime invokes it and no call expression in this repository does. So each callable
published costs a register row.

Task 1 therefore published **constants only** and held the predicates back until Task 2 gave them
a caller — the plan's own `<action>` anticipated this and said to check the guard first. Task 2
then published **three** callables rather than nine: `parseFunnelReport` moved into `@o2/net`
beside `parseRequest`/`parseResponse` (where a wire contract's parser belongs, and which keeps
four predicates module-private), and the journal's read/write pair was deliberately **not** added
to `@o2/cloudflare`'s barrel because `worker.ts` imports it relatively. `UNREACHABLE_CEILING`
moved 113 -> 116, by exactly the three that arrived, with the reason dated beside it. The
orphan-module ceiling was **not** moved; both new hosted-tier modules got a production importer
instead.

### `vitest.config.ts` moved, and the plan's file list did not name it for every task

`NODE_PROJECT_FILES` went 219 -> **228**, nine files, seven of them this phase's. **Counted, not
adjusted** — the walk was re-run rather than seven added to 219, which is the arithmetic that
table's own docblock records going wrong before. Cross-checked against `git ls-files` filtered by
the same globs. `unitFiles` moved by the same nine, by the identity `files - excludedInNode`.
The span table is untouched: all seven are pure and each ran well under the 1 000 ms cut. The
three e2e specs move neither count, because `relative()` filters the `.e2e.` suffix out of the
population the drift assertion reads.

### `disclosure-four-elements.node.test.ts` moved, and it got stronger

Element 4's pinned phrase had to change because the sentence it pinned became false — see below.
The case now asserts **three** states where it asserted two: declined and counted nowhere,
consented and counted coarsely, and the separate start report unchanged. A new case requires the
enumeration of the counted record to be **closed** and to say what it does not hold. The
legal-basis absence guard was **not** touched and stays armed.

### The disclosure had become FALSE, and the version bump is the repair

Version 4 said *"it does not count your visit and it sends nothing about you anywhere"*. That was
true of every build that carried it and stopped being true the moment the funnel was armed at
consent. `demo/policy.html` carried the same claim in its own words — *"The visit is not counted
and no record of it is sent anywhere"* — and went false the same way.

`DISCLOSURE_VERSION` is `'5'`. The repaired line states three states; a new line enumerates the
whole record — six named steps, a two-letter country, a coarse connection label, an hour in UTC —
says the list is complete, and says what is **not** in it. `policy.html` moved in the same commit.
This is the register `disclosure.ts`'s own version-2 note established: *"version 1 had become
FALSE... The bump is therefore the repair, not the paperwork."*

### Two extra files the plan did not name

`packages/cloudflare/src/funnel-collector.ts` and its spec — the plan's Task 3 explicitly permits
this: *"a pure `funnelDimensionsFrom(headers)` is testable in the node lane and a method on the
object is not."* And `packages/browser/src/ice-observer-install.ts`, whose reason is the measured
`@libp2p/webrtc` finding above.

### A stray empty file

An empty file named `=` appeared in the working tree at 15:30, from a shell redirect of mine
during the Task 4 commit. Removed. It was never staged and nothing referenced it.

---

## Two structural findings about criterion 2

Both had to be built around rather than worked around.

1. **`stalledAt['first-task']` can never move.** A visit that reached the last stage did not
   stall. `FunnelReporter.stalled` returns without sending for exactly that case and
   `funnel-reporter.test.ts` reads it. So there are **five** reachable drop counters, not six,
   and an arm for the sixth would be an arm asserting that nothing happens.
2. **Under the pending arming point, `stalledAt['page-load']` cannot move either.** A visit that
   ends before consenting reports nothing at all. Arm 1 asserts that as its whole finding — the
   entire vector unchanged — which is simultaneously the honest reading of the event and the
   strongest possible statement of the scope fence.

`stalledAt['ice-gathering']` is reachable in principle and is **NOT exercised**: a tab that
reaches ICE gathering against a live peer proceeds to a classified connection inside the same
250 ms poll, so no arrangement in this fabric leaves a visit's furthest stage there. Reported
rather than smoothed over.

**A note on what `stalledAt[k]` means, because the plan's arm table and the implementation use
different conventions and the difference is visible in the numbers above.** It is keyed on the
furthest stage **entered**, not on the stage an attempt failed at. So arm 3 — a relay dial to a
port nothing listens on — moves `stalledAt['consent']` rather than `stalledAt['wss-bootstrap']`:
the visit reached consent and got no further, and filing it under stage three would claim the tab
arrived somewhere it never did. The consequence is that arms 2 and 3 land in the same bucket, so
the funnel cannot separate *did not try* from *tried and failed at the relay*. That is a real
limitation of the current schema and is stated rather than designed away.

---

## Open question 3 — the telemetry's legal basis, which is the owner's

**No agent chose anything, and the guard that would catch one doing so is still armed.**
`packages/node/src/disclosure-four-elements.node.test.ts` asserts that `legitimate interest`,
`legal basis` and `GDPR` appear **nowhere** in the disclosure, and it passes.

**The engineering recommendation on record — carry telemetry consent on the same gate as
`BROW-06` rather than showing a second banner — is a design recommendation and not a compliance
ruling.** It settles nothing.

### Reading A — consent

Only visitors who agreed may be counted, **including in aggregate**. The funnel is then a
measurement over a self-selected opted-in subset, and that self-selection is a property of the
numbers that must be published beside them. Stage one equals stage two by construction and the
first drop-off is not measurable.

**This is what the code implements today**, because it is the **intersection** of the two
readings: reading A permits only consent-armed collection; reading B permits consent-armed
collection *and* page-load-armed collection. The pending default is lawful under either, and a
ruling can only ever **widen** it. Collecting under the wrong basis is the irreversible error;
not collecting yet is the reversible one. The *before consent* vector above — six zeros, taken
live on a real tab — is the observation that shows this claim holds in the built system and not
only in the design.

### Reading B — legitimate interest

The funnel measures the whole population and the consent drop-off becomes measurable for the
first time. Two things become owed. The disclosure must state the minimal record's contents
**exactly** — the line added in this phase already enumerates all five kinds of value, says the
list is complete, and says what is not in it, and it should be **checked against the ruling
rather than assumed to satisfy it**. And a **documented balancing test** is owed before
recruitment; it is `37-RUNBOOK.md` step 4 and no agent writes it.

### What changes in code when the ruling lands

Under **reading A**: nothing. Under **reading B**, three values and one assertion:

| where | from | to |
|---|---|---|
| `packages/browser/src/funnel-reporter.ts` `FUNNEL_ARMING` | `'at-consent'` | `'at-page-load'` |
| `packages/browser/src/funnel-reporter.ts` `FUNNEL_PENDING_POPULATION` | `'opted-in-only'` | `'all-visitors'` |
| `packages/cloudflare/src/worker.ts` `FUNNEL_POPULATION_PENDING_RULING` | `'opted-in-only'` | `'all-visitors'` |
| `funnel-attribution.e2e.test.ts` ARM 1 | the whole vector is unchanged | `stalledAt['page-load']` moved by exactly one |

And, whichever way it goes, the absence guard in `disclosure-four-elements.node.test.ts` must be
**inverted in the same commit** as the sentence lands, never left half-turned — the requirement
Phase 35's summary already names.

`population` is stored beside the counts and echoed in every `GET /funnel` response precisely so
that a count and what it is a count of cannot be separated by whoever quotes it.

---

## What was NOT proved

- **Nothing was read on a deployed object.** No local run can stand in for it. The country and
  network-class path is exercised locally with a supplied header and with `request.cf`, and is
  **unmeasured on the edge**.
- **This is not a population measurement.** The funnel has seen a handful of synthetic visits in
  one process on one machine. `RUN-04`'s own sentence stands unchanged: **no published figure
  exists for what fraction of a general audience cannot participate.**
- **The terminal report depends on `pagehide` firing.** Measured in a Playwright harness driven
  by navigation — never by closing a context, because a beacon in flight when the browser dies is
  a beacon that never arrives — and not on a real visitor's device, and not on mobile Safari.
- **`stalledAt['ice-gathering']` is not exercised**, for the structural reason above.
- **Counts are unauthenticated and a visitor can inflate their own**, exactly as
  `start-report.ts` already accepts for the same reason: authenticating a visitor is what
  criterion 4 forbids. Accepted, recorded beside the figures, not mitigated.
- **`networkClass` is self-reported.** It is the browser's own `effectiveType`, so it is the one
  dimension a visitor could choose. Safari and Firefox implement neither `type` nor
  `effectiveType`, so `unknown` is the expected answer on both and is not a failure.
- **Cloudflare's Tor pseudo-country `T1` carries a digit**, so the schema's two-uppercase-letters
  rule files it as `ZZ` — a Tor visit is indistinguishable from a visit whose country the edge
  never stamped. The rule was **not** widened to rescue it: `[A-Z][A-Z0-9]` would admit 936 codes
  to save one, and a field whose width the sender chooses is the fingerprint these lists exist to
  prevent. Recorded so a later phase can reopen it deliberately.
- **The digest is a change detector, not a commitment.** A 64-bit FNV-1a over a canonical
  rendering, chosen because it is deterministic, dependency-free and identical in both lanes.
  Nothing here treats it as unforgeable.

---

## Scope fence

Nothing was deployed. No remote resource was created. No third-party analytics service was
contacted — the collector is this repository's own Worker, and `demo/policy.html` now says so to
a visitor. The three `ocr-checks-worker*` scripts are unchanged. Every reading came from a local
`wrangler dev --local-protocol http --persist-to <a fresh mkdtemp>` with `CLOUDFLARE_API_TOKEN`
blanked and `WRANGLER_SEND_METRICS` off, on ports 8796-8798 and 8810-8814, and every temporary
directory was removed afterwards.

The demo's visible surface did not move: the funnel's readout is `GET /funnel` on the hosted
tier, an operator's reading rather than a visitor's figure, so no `data-region` is owed and
`UI_SPEC_TALLY` is untouched.

---

## The four gates, each read from a directly-read exit code

Every exit code below was taken with `EXIT=$?` on the line immediately after the command, with
no pipe and no trailing `tail` — the convention `CLAUDE.md` records a trailing `tail` having
broken more than once.

| gate | result | conditions |
|---|---|---|
| `npx vitest run --project node` | **exit 0** — 228 files, 3 289 passed, 2 skipped | `real 179.03  user 782.23  sys 196.92`, ratio **5.47** |
| `npx vitest run --project e2e` | **exit 0** — 52 files, 275 passed | `real 855.83  user 628.27  sys 152.67`, host quiet at 1.36 |
| `npx vitest run --project browser` | **exit 0** — 375 files, 6 270 passed (chromium, firefox, webkit) | `real 111.57  user 219.87  sys 32.93`, host quiet at 2.99 |
| `npx tsc --noEmit` | **exit 0** | — |

`aot` is a lane and not a subset. It is untouched by this phase and was not run.

**Two reds were taken under load and both were re-run before being attributed, neither being
this phase's.**

1. The node lane's first run failed one case —
   `fabric-node.node.test.ts > NET-01 ... completes 4 shards at R=2 across two worker nodes` —
   with the suite's own banner reading *"HOST WAS OVERSUBSCRIBED AND 1 TEST(S) FAILED — load/core
   0.71 before, 5.56 after"*. Run alone it passed 15/15, and a second full node run passed
   **228/228**. Nothing in this phase touches that file or the NET-01 path.
2. The browser lane's first run collected **no tests at all**, aborting on
   `page.goto: NS_ERROR_FAILURE` from the Firefox provider at load 5.04 — a harness failure, not
   a code one. Re-run on a quiet host it passed 375/375.

The node lane's own duration is quoted from the run that was **green**; the first run's is not
quoted at all, because a duration measured on a suite that did not pass is not a duration for
that suite.

---

## Self-Check: PASSED

Every file this summary names exists on disk. Every commit it rests on is in the history of
`feature/v2-remaining-phases`:

| commit | task |
|---|---|
| `6001395` | T1 — three questions, six stage names, and a freeze that is a guard |
| `0b6fe35` | T2 — six counters banked where eviction cannot reach them, and one HTTP read |
| `72e27e5` | T3 — the raw IP is discarded at collection, proved against the store |
| `90143e3` | fix — the funnel banks as one chain, and the class rides in the body |
| `3cfc0f6` | T4 — six stages instrumented, and the disclosure repaired to match |
| `b80522e` | T5 — all six stages moving on real tabs, read while they are running |
| `0aa467f` | T6 — five attribution arms, and a guard that catches a proxy dressed as a measurement |
