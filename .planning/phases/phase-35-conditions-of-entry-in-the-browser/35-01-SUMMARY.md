---
phase: 35-conditions-of-entry-in-the-browser
plan: 1
subsystem: browser-tier
tags: [consent, disclosure, browser, playwright, workerd, egress, gdpr-open-question, e2e]
requires:
  - .planning/phases/phase-32-the-relay-role-and-the-two-counters/32-01-SUMMARY.md
provides:
  - "BROW-06 Done — the artifact fetch takes a consent, read at a gateway server's own log with a positive control"
  - "BROW-07 Done — the indicator is in document.title, read from outside the page with a second page in front, in three engines"
  - "BROW-08 Done, both halves — an in-flight task observed not completing, and connectionSeconds ceasing to accrue on a local workerd"
  - "BROW-09 Partial — four elements each asserted with a plant each, ordering proved; the telemetry legal-basis sentence is the owner's and is pending"
  - "BROW-10 Done — a measured byte figure beside the CPU disclosure, with a guard that reddens on drift"
  - "a browser tab dialling a LOCAL workerd, proved for the first time in this repository"
  - "one plant that stayed GREEN and the widened plant that carried the claim"
affects:
  - packages/browser/src/gateway-module.ts
  - packages/browser/src/gateway-module.node.test.ts
  - packages/browser/src/computing-indicator.ts
  - packages/browser/src/computing-indicator.test.ts
  - packages/browser/src/disclosure.ts
  - packages/browser/src/data-cost.ts
  - packages/browser/src/index.ts
  - packages/browser/demo/main.ts
  - packages/browser/demo/policy.html
  - packages/node/src/artifact-fetch-gate.e2e.test.ts
  - packages/node/src/computing-indicator.e2e.test.ts
  - packages/node/src/hard-stop.e2e.test.ts
  - packages/node/src/disclosure-four-elements.node.test.ts
  - packages/node/src/disclosure-before-optin.e2e.test.ts
  - packages/node/src/colouring-demo.e2e.test.ts
  - packages/node/src/requirements-ledger.node.test.ts
  - packages/cloudflare/src/stop-closes-the-billed-socket.e2e.test.ts
  - .planning/REQUIREMENTS.md
tech-stack:
  added: []
  patterns:
    - "a zero is measured at the server that would have answered, never as a filtered request list"
    - "the counter an instrument reads is chosen by measurement, because a plausible name is not a measurement"
    - "a settling beat is sited against an observed latency and the latency is written down rather than tuned away"
    - "a disclosed literal and the run it is checked against must be independently obtainable"
decisions:
  - "The consent gate sits inside fetchModuleForDispatch and NOT at the call site, so removing it can produce a real logged request"
  - "The computing indicator is unconditional on visibility state — the only design an automated harness can read"
  - "The indicator carries a 4 s dwell, because a throttled tab idles 950 ms between tasks and would otherwise strobe"
  - "The data cost is egress only, with the unmeasured inbound leg named as excluded rather than estimated"
  - "The telemetry legal basis is NOT chosen here; both readings are drafted and the choice is the owner's"
metrics:
  duration: ~3 h
  completed: 2026-09-02
---

# Phase 35 — Conditions of Entry in the Browser

Five requirements, five criteria. **Four criteria closed; criterion 4 closed except one
sentence that is not an engineering judgement.** Every plant is recorded below with the text it
actually produced, and the one that stayed green is recorded first, because it is the most
useful thing in this document.

---

## The plant that stayed GREEN, and the widened plant that carried the claim

Criterion 3 names its own plant by hand: *replace the hard interrupt with a cooperative stop*.
The plan's smallest version of it was to remove `this.worker.terminate()` from
`browser-node.ts`'s `stop()` and leave the rest intact.

**That plant left `hard-stop.e2e.test.ts` GREEN.** Observed:

```
[BROW-08] window 1: 0 -> 13 tasks in 804 ms; Stop at +804 ms; outstanding 115/128;
          waited 21337 ms; shards finished 13/128; run complete=false
✓ interrupts a running job: the work stops moving and the run never reports completion
```

The plan had predicted the reason and pre-authorised the widening: `stop()` still called
`this.rpc.close()`, so a worker that survived had its completion swallowed at the RPC boundary
rather than observed. A green there says nothing about whether the task ran on.

The plant that carries the claim is therefore the wider one criterion 3 actually names — a
`stop()` reduced to *stop accepting new tasks*, leaving **both** the worker and the RPC alive
(only `#verifier.stop()`, `transport.stop()`, `libp2p.stop()` and `governor.stop()` remain).
Observed, verbatim:

```
AssertionError: BROW-08: the run held across Stop resolved with complete=true and 128 of 128
shards finished. Measured in this run: tasksExecuted moved 10 in 1144 ms (0.0087 tasks/ms),
118 of 128 shards were outstanding at Stop, which at that rate would have taken 13499 ms; the
wait after Stop was 40498 ms, i.e. 3x. A job that completed anyway means Stop let the in-flight
work run on, which is the cooperative behaviour criterion 3 names as failing.:
expected true to be false
```

**So BROW-08's first half is carried by the wide plant and not by the narrow one**, and the
narrow one is recorded here rather than deleted, because *removing `terminate()` alone is not a
detectable change* is a fact about this codebase that the next person to reason about Stop
needs.

---

## Task 1 — BROW-06: the fetch takes a consent

`fetchModuleForDispatch` now requires a `GrantedConsent` (or the `ConsentGap` saying why there
is none) and checks it **first**, ahead of even the blank-gateway refusal.

**The ordering inside `demo/main.ts#fetchModule` had to move, and that is the whole reason the
criterion was testable.** It opened with `required()`, which throws `node not started`. With
that ordering the un-consented state was unreachable *through the fetch*: no network log could
tell a consent gate from a node-state gate, and removing the consent check would have changed
nothing an instrument could see. That is the shape of a proof that cannot fail. The order is
now **consent → fetch → `required()` for the blockstore put**.

`artifact-fetch-gate.e2e.test.ts` stands a **second HTTP server on its own port** and reads
that server's own log — not a filtered request list. Two arms:

| arm | gateway server log | page-side `page.on('request')` | outcome |
|---|---|---|---|
| consent absent | `[]` | no request to the gateway origin | refusal naming consent; **did not throw** |
| consent granted | `["/bafyreihyux…omm5m"]` | exactly one | threw `node not started` from the put, i.e. past the gate |

Arm B is the floor. Arm A also asserts the call **did not throw**, because a `node not started`
there would mean the criterion is being satisfied by the wrong mechanism.

**Plant** (consent check disabled, parameter left in place) — observed verbatim:

```
AssertionError: BROW-06: with no consent recorded, the gateway server was asked for
/bafyreihyux7jlsrv4sbeyqucghtarabmugo322frpsc5h2ed4ezb3omm5m. A reviewer watching network
traffic reads a fetch as preparation-to-run; the gate has to sit in front of the request, not
in front of the execution.: expected [ Array(1) ] to deeply equal []
```

A real request, logged at the server, with consent absent. Restored by the surgical inverse;
`cmp` silent.

### What this adds over P10, and the caveat it does not close

P10 (`built-bundle.e2e.test.ts:149-219`) asserts *no foreign origin before consent* over the
whole request set. It is structurally blind to a **same-origin** artifact fetch, which BROW-06
forbids just as firmly.

**The second ingress path is answered by reading rather than assumed.** There is no bitswap
route in this repository: `bitswap` and `helia` appear in no source file under any package's
`src` directory nor under `packages/browser/demo`; the single occurrence in the tree is the
word "Helia" inside a prose docblock at `packages/node/src/job-entry-points.node.test.ts:190`.
Every remaining ingress needs a started node, and `demo/main.ts:1055` reads
`const granted = requireConsent()` as the first statement of `start()`, before
`probeEnvironment()` and before `BrowserNode.start` at `:1133`.

**The caveat, stated because the honest version is narrower than it sounds:**
`BrowserNodeOptions` carries **no consent field** — `browser-node.ts:272-310` says so at
length, *"no parameter of `TabApi.start` carries one"* — so the start-path gate is a **page
convention rather than a type**. It holds for this demo page. An embedding host calling
`BrowserNode.start` directly would not be gated by it and nothing would notice. The **fetch**
gate is a type and does not have that hole.

---

## Task 2 — BROW-07: an indicator the browser chrome carries

`packages/browser/src/computing-indicator.ts` is a pure module over a title port. The
decoration is `● Computing — ` prepended to the page's own title, set **unconditionally**
whenever tasks are in flight.

**Unconditional is the requirement, not a shortcut.** `background-tab.e2e.test.ts:16-42`
records that Chromium under automation never reports a page as hidden — *"`page.bringToFront()`
changes nothing and fires no `visibilitychange`, in headless and headed mode… There is no CDP
visibility override either."* Any indicator conditioned on `document.hidden` would be
untestable in the very harness criterion 2 names.

**The catalogue did not move.** `document.title` is browser chrome, carries no `data-region`,
and is not a figure — so none of THE TRAP's five edits was owed.

### The dwell, which is a finding rather than a comfort

`CountingExecutor` sits **inside** `GovernedExecutor` (`browser-node.ts:1826` states the
ordering), so a task waiting for its slice is not counted as in flight. `VisibilityGovernor`
sleeps `sliceMs * (1/duty − 1)` per slice (`visibility-governor.ts:153`) with `sliceMs`
defaulting to 50 (`:75`), so **at this page's own `backgroundDutyCycle` of 0.05 the gap between
tasks is 950 ms** and an instantaneous reading finds the executor idle almost every time.

A backgrounded, throttled tab is exactly the state BROW-07 is about. An indicator sampling
`executorInFlight` alone would blink off for most of the interval in which a visitor is most
likely to look at it. So `demo/main.ts` polls at 250 ms and clears the title only after
in-flight has been zero for **4 s** — about four times the 950 ms gap. Stop clears it
immediately and does not wait out the dwell.

**Residue, stated rather than left to be discovered:** a visitor who sets a cap far below the
background one by hand — `setDutyCycle(0.005)` gives a 9.95 s gap — makes the gap longer than
the dwell and the indicator will blink for them.

### The reading, and the plant criterion 2 names by hand

Green in **chromium, firefox and webkit**: one `BrowserContext`, two pages, the second
`bringToFront()`ed, `page.title()` read from the harness. Title is the base before start, the
base while started and idle, decorated while work is in flight, and back to the base when the
work drains.

**Plant** — page-body-only (`document.body.dataset['computing']` written; `document.title`
never decorated). RED in all three engines, observed verbatim (identical but for the engine
name):

```
AssertionError: BROW-07: with work in flight and a second page in front, chromium's tab strip
read "o2.services — node". A visitor looking at another tab has the title and the favicon and
nothing else; if the title does not say so, nothing does.:
expected 'o2.services — node' to be '● Computing — o2.services — node' // Object.is equality
```

```
AssertionError: BROW-07: … firefox's tab strip read "o2.services — node". …
expected 'o2.services — node' to be '● Computing — o2.services — node'
```

```
AssertionError: BROW-07: … webkit's tab strip read "o2.services — node". …
expected 'o2.services — node' to be '● Computing — o2.services — node'
```

**What this does not prove:** that an operating system's window manager painted those
characters in a tab strip. Nothing in an automated harness can prove that.

---

## Task 3 — BROW-08's first half: an in-flight task that does not complete

### The counter had to be chosen by measurement, and the obvious one was wrong

`activity().tasksExecuted` is `GovernedExecutor`'s `#executed`. At a duty cycle of 1 that
counter increments **before** `inner.execute(task)` with no serialisation, and `submitJob`
dispatches every shard under one `Promise.all` — so it counts tasks **admitted**, not tasks
**finished**, and it went `0 → 128` inside the first 800 ms window. The first draft failed its
own outstanding-work guard: *"expected 0 to be greater than 0"*. That is the guard working and
the instrument not.

Below 1 the governor serialises and `#executed` is incremented **after** `await previous` and
`await yieldSlice()`, one task at a time. The case therefore runs at `dutyCycle: 0.5`, which
also sharpens the subject: serialised, exactly **one** task is inside the executor when Stop
arrives, and criterion 3's sentence is about that task.

### The reading, with both numbers

```
[BROW-08] window 1: 0 -> 13 tasks in 803 ms; Stop at +803 ms; outstanding 115/128;
          waited 21310 ms; shards finished 13/128; run complete=false
```

- **Window 1 (the moving floor):** `tasksExecuted` 0 → 13 across 803 ms — 0.0162 tasks/ms.
- **Outstanding at Stop:** 115 of 128 shards. Asserted positive, because a run that had already
  finished proves nothing and must fail the case rather than pass it.
- **The post-Stop wait is derived inside the run**, never typed in: outstanding ÷ this run's own
  measured rate × 3, clamped. 21 310 ms here.
- **After Stop:** `activity()` is `null`, `#bar` is not visible, and **13 of 128 shards came
  back finished** — the other 115 `unagreed` with empty `agreeing` lists, i.e. never executed
  anywhere. The job resolved `complete: false`.

### Open question 2 is read NODE-LOCAL here and is not settled

`.planning/REQUIREMENTS.md` § Open questions item 2 asks whether a stop must propagate across
the fabric. **BROW-08 is about this tab's Stop dropping this tab's CPU to zero**, and that is
the only reading this phase measured. The global-propagation reading belongs to Phase 36's kill
switch. This is stated in the file's own docblock as well, so nobody later reads this phase as
having answered it.

---

## Task 4 — BROW-08's second half: the billed socket closes

### A browser tab dialling a LOCAL workerd — a first for this repository, and it works

No existing e2e had one; Phase 32's tabs dialled the deployed WSS relay. Proved with a
throwaway probe before anything was built on it. **The address form that worked:**

```
/ip4/127.0.0.1/tcp/<port>/ws/p2p/<peerId>
```

handed to the demo through its own `?relay=` parameter, from an `http://localhost` Vite origin
— the transport matrix's "insecure `ws://` for localhost only" cell. The probe's numbers:

```
workerd peerId 12D3KooWLuqdzuGWXdvCJ9Z7Cbe1cCbSVoHyZ8H6uVtvwqvukT4d  traffic direct 0
start: { ok: true, peerId: 12D3KooWCXFz6JFrTFJ84hasfcBw5jk4AftYTS62VaPvJ99XQkvm }
t0 connectionSeconds 2.069   t1 4.081   t2 6.106   t3 8.119
page peers ["12D3KooWLuqdzuGWXdvCJ9Z7Cbe1cCbSVoHyZ8H6uVtvwqvukT4d"]
after-stop 9.967, 9.967, 9.967
```

The tab held the workerd as a peer and `/self` reported the connection accruing at wall-clock
rate. **No deploy, no remote resource, `CLOUDFLARE_API_TOKEN` blanked, `--persist-to` a fresh
`mkdtemp` directory that was removed.**

### The four reads, green

```
[BROW-08 socket] t0=0.182 t1=4.196 t2=9.970 t3=9.970
                 (window 4000 ms; before=4.014 s, after=0.000 s)
```

Verdict is the **ratio** of the two windows inside one run: `after / before = 0.000`. The floor
— `before` must exceed half the window — is what stops a socket that never opened satisfying
"stopped accruing" trivially. `t0` before the tab dialled was asserted **zero**, and a non-zero
reading there fails the case naming the arrangement rather than being subtracted out.

### The settling beat is a measurement, and the first value was wrong

`SETTLE_MS` was 2 000 ms on the strength of the probe, in which the counter was frozen 1 500 ms
after Stop. On a host at load 29 the case then failed:

```
AssertionError: BROW-08: after Stop the connection went on accruing at 78.2 % of its pre-Stop
rate. On this platform cost is held sockets, so a stop that leaves the socket open has not
stopped anything the operator pays for. t0=0.494 t1=4.550 t2=6.771 t3=9.944
(window 4000 ms; before=4.056 s, after=3.173 s): expected 0.7822978303747536 to be less than 0.1
```

**The counter went on climbing for about 5.2 s after Stop and then froze.** That is a real
property of the arrangement and not noise: **the object learns of the close some seconds after
the tab initiates it, and the delay grows with host load.** The tab does not control it —
`libp2p.stop()` has returned — and from the operator's side those seconds are genuinely billed.
Criterion 3 asks that the accrual *stops*, not that it stops instantaneously, so the beat is
now 20 s, about four times the worst reading taken. **Written down rather than tuned away.**

### The plant

`stop()` made to skip `await this.transport.stop()` and `await this.libp2p.stop()` while
leaving `worker.terminate()` in place — exactly the failure BROW-08's own sentence names.
Observed verbatim:

```
AssertionError: BROW-08: after Stop the connection went on accruing at 100.0 % of its pre-Stop
rate, 20000 ms after Stop returned. On this platform cost is held sockets, so a stop that
leaves the socket open has not stopped anything the operator pays for. t0=0.170 t1=4.182
t2=24.207 t3=28.217 (window 4000 ms; before=4.012 s, after=4.010 s):
expected 0.999501495513459 to be less than 0.1
```

### A finding about a file this phase did not edit

`packages/cloudflare/src/hosted-record-store.e2e.test.ts` spawns `wrangler dev` **without
`--persist-to`**, so it inherits `packages/cloudflare/.wrangler/state` and carries Durable
Object storage across runs. Its own comment records what that cost: a case *"passed for the
wrong reason twice"* because a record written by an earlier run was still there. Not edited
here; recorded so somebody can decide.

---

## Task 5 — BROW-09: four things, before opt-in

Version 2's six lines were true and **incomplete**. Criterion 4 names four things and the
module carried three; the fourth — *what telemetry is sent* — had **no line at all**. The
`reporting` extra describes the **opt-in** report, so a visitor learned what happens if they
tick the box and nothing whatever about what happens if they do not, which is the state every
visitor is in when they read it. Nothing caught it because **no test asserted the disclosure's
completeness** — every existing guard checked something else.

### What changed

1. **Element 3 now leads with the guarantee.** Version 2 answered *What leaves my device?* as a
   list of exclusions, which is accurate and reads as a caveat. The answer now opens *"Your own
   data never leaves this device"* and the exclusions follow. That is a change of **standing**,
   not of fact: data staying on its owner's device is the whole claim this project makes, and a
   visitor meeting it as a mitigation is being told the wrong thing about what they are joining.
2. **Element 4 is a new line**, written off two code paths rather than composed — the request
   path (`startReport` passes `outcome: allowed ? outcome : null`) and the serve path
   (`startReporting: 'withholds-its-own-start'` → `ownStartLedger` returns an empty ledger).
   Both are stated, because saying only the first is the defect
   `BrowserNodeOptions.startReporting` records at length: *"the page withheld the line and the
   node served it"*.
3. `DISCLOSURE_VERSION` `'2'` → `'3'` with a `CONSENT_VERSION_NOTE` saying what changed;
   `demo/policy.html` moved in the same commit so the three readers cannot drift.

### "Selling point rather than a caveat" made mechanical

Taste is not checkable, so the guard is: the guarantee must appear in the answer's **first
sentence**, and no word from `['but ', 'however', 'except', 'unless', 'although', 'apart from']`
may appear **before** it.

### The five plants, all watched red

| # | plant | observed |
|---|---|---|
| 1 | *what runs* answer's substance removed (`WebAssembly` → `program`) | `BROW-09: 0 of the disclosure's 7 lines state what code would run. Exactly one must… expected +0 to be 1` |
| 2 | *whose work* answer's substance removed (`A shared job.` deleted) | `BROW-09: 0 of the disclosure's 7 lines state whose work would run… expected +0 to be 1` |
| 3 | sovereignty guarantee moved behind a qualification | `BROW-09 element 3: "but" appears at character 33, before the guarantee at 51. A guarantee that arrives after a concession has been demoted to one.: expected 33 to be greater than 51` |
| 4 | telemetry line deleted | `BROW-09: 0 of the disclosure's 6 lines state what is reported about the visit… expected +0 to be 1` |
| 5 | **ordering** — `#gate-terms` rendered only inside the `#allow` click handler | `BROW-09: the gate does not show the question "What would run?" before the opt-in control can be clicked: expected '\n      \n      \n      This page can…' to contain 'What would run?'` |

Each restored by the surgical inverse; `cmp` silent every time.

### A correction the tree forced on the plan

**The plan named the wrong file for the ordering plant.** It says *"in `demo/main.ts`, render
`#gate-terms` only after `#allow` is clicked"*. The gate is not rendered in `main.ts` at all —
it is rendered by the **inline module script in `demo/index.html`** (`$('gate-terms')
.replaceChildren(...)`, fed by `window.o2.disclosure()`), and that is where the plant was
placed.

### A guard over an ABSENCE

`disclosure-four-elements.node.test.ts` also asserts the disclosure contains none of
`legitimate interest`, `legal basis` or `GDPR`. An agent adding either basis sentence would be
recording a compliance ruling as a code change, and this case makes that loud rather than
quiet.

---

## Task 6 — BROW-10: a data cost in bytes, measured

### The three readings, and the one that was kept

Three runs of `colouring-demo.e2e.test.ts`'s two-tab DEMO-01 case (n = 204, 8 cubes,
redundancy 2, one tab dispatching to one peer over a loopback relay), reporting
`run.egress.totalBytes`:

| run | `totalBytes` | `entries` |
|---|---:|---:|
| 1 | 11 387 | 22 |
| 2 | 10 971 | 18 |
| 3 | 11 387 | 22 |

**Spread 416 bytes, 3.8 % of the mean.** It is not measurement noise — the entry count moved
with it, so what varies is *how many frames left*, which follows how the two tabs happened to
dial each other.

`DISCLOSED_DATA_COST_BYTES = 11_000`, hand-written, round, inside the spread.

### The band, justified against what varies

`DATA_COST_BAND = 2` — a factor applied both ways, about **twenty-six times the observed
spread**. That margin is what the varying quantity requires: the frames that leave follow peer
count and dialling, so a band sited at the observed spread would go red the first time a third
tab joined, which is a fabric working rather than a figure going stale. A factor of two still
catches the failure the guard exists for — an outbound volume that has doubled.

### What the figure covers, and what it excludes by name

**Egress only.** `EgressManifest.totalBytes` is *"What actually left, in bytes"*
(`packages/net/src/egress.ts:43-66`). A visitor on mobile data pays both directions, so why is
the inbound leg not in the number? **Because nothing on this page measures it** —
`TabActivity.fetched` counts *blocks*, not bytes, and the byte counters that exist are the
hosted tier's. Criterion 5 asks for a figure *"taken from a real run of that task rather than
estimated"*, so an unmeasured component is excluded **and named as excluded**, in
`DATA_COST_COVERS` and in the sentence the visitor reads.

The WebAssembly module is **not** counted as an inbound cost and deliberately not listed as
one: `runColouring` does `node.store.put(kernelBytes)` from a constant compiled into the page
bundle, so its 1 200 bytes arrive with the page and not per run. Counting them would be
double-counting a page load.

Neither side of the comparison is derived from the other, in source or in test.
`DISCLOSURE_VERSION` `'3'` → `'4'`.

### Both plants, watched red

| # | plant | observed |
|---|---|---|
| 1 | `DISCLOSED_DATA_COST_BYTES` 11 000 → 110 000 | `BROW-10: this run sent 10971 bytes and the page discloses 110000 — a factor of 0.10, outside the band of 2. The disclosed figure and what the task actually costs have diverged: fix the FIGURE if the workload changed on purpose, and fix the WORKLOAD if it did not… expected 10971 to be greater than or equal to 55000` |
| 2 | data-cost line deleted from `DISCLOSURE.lines` | node lane: `BROW-09: 0 of the disclosure's 7 lines state what one run costs a data allowance… expected +0 to be 1`; e2e: `BROW-10: the gate shows no data cost in bytes before the opt-in control can be clicked: expected '…' to contain '11 kilobytes'` |

Plant 2's second half exists because the plan required it: the ordering e2e loops over
`DISCLOSURE.lines`, so a **deleted** line disappears from the loop with it and the loop cannot
notice its absence. The assertion by name is what can.

---

## Task 7 — the telemetry legal basis: NOT chosen here

**This is a `checkpoint:decision` and it is the owner's.** `.planning/REQUIREMENTS.md`
§ Open questions item 3 records that the sources consulted **disagreed with each other** and
that it is *"settled by legal review, not engineering judgement"*. Threat T-35-09's disposition
is `transfer`.

Both readings are drafted so the ruling is a choice between two written sentences. They are
reproduced verbatim in the checkpoint returned with this plan. **Nothing else in the phase
waits on it** — criteria 1, 2, 3 and 5 are closed and none of them depends on which sentence
wins, and the factual half of element 4 (what is sent) has already landed, because that is an
engineering fact and is settled.

BROW-09 therefore lands **Partial**, and what is pending is exactly one sentence: the basis on
which the minimal record — if there is to be one — is collected. What it blocks: `RUN-05` and
the funnel Phase 37 measures, whose population depends on the ruling (reading A makes the
funnel measurable only over a self-selected opted-in subset; reading B measures the whole
population and owes a documented balancing test before recruitment).

---

## The two corrections this plan carried forward, restated so they survive it

1. **`packages/browser/vite.config.ts:144` does not count regions.** It is a sentence inside
   `stampBuildIdentity`'s docblock explaining why the build stamp is a `<meta>` and not a
   visible element. The real enforcers are `packages/node/src/demo-regions.e2e.test.ts:170-183`
   (three tally assertions), `packages/browser/demo/render.ts:68/84/87` (which throws in both
   directions), and `packages/node/src/demo-region-properties.ts:31`.
2. **`bar` IS in `WIRED_SURFACES`** (`demo-regions.ts`), so a new `bar` catalogue entry must
   resolve to a real element in the same commit or `render.ts` throws at paint time, before any
   test runs. **This phase owed neither**: the indicator lives in `document.title`, which is
   browser chrome and carries no `data-region`.

---

## Deviations from the plan

| # | deviation | why |
|---|---|---|
| 1 | Branch is `feature/v2-remaining-phases`, not `feature/phase-35-…` | Instructed. Three agents share one working tree; a branch switch would drag two others' in-progress files with it |
| 2 | `ROADMAP.md` and `STATE.md` were **not** touched | Instructed. The coordinator is making those edits in a quiet window so nobody's line-number citations shift |
| 3 | Ordering plant went in `demo/index.html`, not `demo/main.ts` | The plan named the wrong file — the gate is rendered by index.html's inline module script |
| 4 | Task 3's plant was widened | Pre-authorised by the plan; the narrow plant stayed green, recorded above |
| 5 | `computing-indicator.ts` is **not** in the barrel | `gateway-module.ts`'s stated precedent: the demo's `window.o2` hop is not traced, so a barrel entry would add an exported-but-unreachable symbol for no consumer |
| 6 | `data-cost.ts` **is** in the barrel | Checked before adding, as the plan required. One consumer and it is not a page: the guard in `packages/node` must hold the disclosed literal beside a measured run, and the two must be independently obtainable. These are constants, not callables |
| 7 | Task 3's workload runs at `dutyCycle: 0.5` | Forced by measurement: at 1 the counter saturates and the case cannot have a moving floor |
| 8 | `SETTLE_MS` raised 2 s → 20 s in Task 4 | Forced by measurement: a ~5.2 s close latency on a loaded host |

---

## A guard this phase broke and fixed in its own files

The full `--project node` run found `trust-anchors.node.test.ts` red:

```
AssertionError: expected 49 to be less than 48
 ❯ packages/node/src/trust-anchors.node.test.ts:348:30
```

That bound counts how far the provenance opt-out literal has spread through the test suite, and
this phase's two new e2e fixtures took the population from 47 to 49. **Fixed in the new files
and never by raising the ceiling:** neither relay executes anything, so neither had a decision
to record with that literal, and both now pin `KERNEL_TRUST_ANCHOR` — `colouring-demo.e2e.test.ts`'s
choice, and the value a visitor's tab and `bin/seed.ts` both pin with no flags. The stale
comments claiming the opt-out was *"stated rather than defaulted"* were corrected with it.

**The pre-existing red the orchestrator warned about had cleared** before the first commit of
this phase: `reachability-guard.node.test.ts`'s `libp2p/relayedBudgetPerDirection` failure was
green in every pre-commit hook run here. No commit needed `O2_SKIP_GUARDS`.

---

## Two more findings the ledger guards produced, both mine and both fixed here

Flipping the five rows reddened two guards, and neither was a formatting complaint.

1. **`acceptance-traceability.node.test.ts` — `RECOGNISED_STATUSES` has no `Done, both halves`.**
   Observed: `BROW-08 at .planning/REQUIREMENTS.md:1863 reads "Done, both halves"`. The status
   word is a join key, not a headline. Rewritten as `**Done** — both halves. …`.

2. **`requirements-ledger.node.test.ts` — a `Partial` row must carry a claim the file can read,
   or be recorded as carrying none.** Observed: `BROW-09 is Partial and carries no claim this
   file can read, and is not recorded as such`.

   BROW-09's open leg is **not a symbol with no caller** and cannot be made into one: the act
   that closes it is a **ruling**, not a run. So it goes in `REREAD_REGISTER` — the register
   whose whole membership criterion is *the entry's claim cannot be machine-checked* — with the
   two witnesses measured rather than typed (`disclosure-before-optin.e2e.test.ts` and
   `disclosure-four-elements.node.test.ts`, both of which title-name the id), and
   `REREAD_REGISTER_CEILING` raised 3 → 4 with the reason written beside it in the same commit,
   exactly as `HOST-13`'s raise was.

   **The bucket is an uncomfortable fit and the entry says so.** `Because` offers
   `experiment-not-run`, `entry-point-not-driven` and `tier-or-configuration`; none of the three
   is *awaiting a legal ruling*. `experiment-not-run` is chosen because it is the only one whose
   claim is true — *the thing that would close this has not been done* — rather than one that
   points at a code path that is not the obstacle. If a fourth bucket is ever wanted, this is
   the entry that wants it.

   The entry also records **what would close it**, so the promise is specific: the ruling lands
   in `DISCLOSURE`, the version bumps again, `policy.html` mirrors it, and
   `disclosure-four-elements.node.test.ts` — which today asserts the **absence** of any basis
   sentence — has that guard inverted in the same commit, so it cannot be left half-turned.

---

## The four gates

| gate | result | population |
|---|---|---|
| `npx tsc --noEmit` | exit **0** | — |
| `npx vitest run --project browser` | exit **0** | 360 files, 6045 tests (chromium, firefox, webkit) |
| `npx vitest run --project e2e` | exit **0** | 49 files, 262 tests |
| `npx vitest run --project node` | exit **0** on the third run | 221 files, 3205 passed, 2 skipped |

`aot` is a separate lane, not part of this phase's gate, and was not run.

**The node lane took three runs and both reds are recorded rather than smoothed over.** The
third run is the clean one — `Test Files 221 passed (221)`, `Tests 3205 passed | 2 skipped`,
exit code read directly, host quiet at the start (load/core 1.04) and at 12.65 by the end,
which is this lane driving eight workers rather than a neighbour.

- **Run 1 — `trust-anchors.node.test.ts`, `expected 49 to be less than 48`.** Mine. Fixed in my
  own files, never by raising the ceiling — see the section above.
- **Run 2 — `closed-fabric-agents.node.test.ts`**, a timeout waiting for an enrolled arm's relay
  reservation to appear. The run's own banner reported the host oversubscribed (load/core 2.21
  before, **13.37** after — this spec spawns many node processes). Re-run in isolation on a host
  at load 10.73: **7 of 7 passed, exit 0.** It is outside this phase's file set, touches nothing
  this phase changed, and is recorded here as a load-sensitive spec rather than attributed to
  the code. A red taken on an oversubscribed host is re-run before it is attributed; this one
  was.

---

## What was NOT proved

- **No reading was taken on a deployed object.** Every workerd reading is local, on its own port
  with its own `--persist-to` directory. Nothing was deployed and no remote resource was
  created; the three `ocr-checks-worker*` scripts are untouched.
- **The three-engine indicator reading proves the title carries the glyph while the page is not
  the front page of its context.** It does not prove an operating system's window manager
  rendered it, and nothing in an automated harness can.
- **The consent gate on the start path is a page convention, not a type.** `BrowserNodeOptions`
  carries no consent field, so an embedding host calling `BrowserNode.start` directly is
  ungated. The *fetch* gate does not have that hole.
- **`/self` offers no connection count**, so Task 4's isolation is by construction — a fresh
  workerd on its own port whose address is handed to exactly one page — rather than measured.
  What is measured is the precondition, `connectionSeconds` zero before the tab dials.
- **The inbound leg of the data cost is unmeasured** and is named as excluded rather than
  estimated.
- **Open question 2 is read node-local** for this phase and is not settled.

---

## What closed, and what did not

| criterion | requirement | verdict |
|---|---|---|
| 1 — network log shows zero task-artifact requests | BROW-06 | **Closed.** Read at a second server's own log, with a positive control and a planted-out arm that produced a real logged request |
| 2 — unfocused indicator, three engines, body-only watched failing | BROW-07 | **Closed.** Green in chromium, firefox and webkit with a second page in front; the page-body-only plant was watched red in all three |
| 3 — hard interrupt **and** the billed socket closes | BROW-08 | **Closed, both halves.** An in-flight task observed not completing with the cooperative arm watched failing, and `connectionSeconds` ceasing to accrue on a local workerd with the socket-left-open arm watched failing |
| 4 — four things, before opt-in | BROW-09 | **Closed except one sentence.** Four elements each asserted with a plant each, ordering proved with its own plant. **Partial** pending the owner's ruling on the telemetry legal basis |
| 5 — bytes for a representative task, from a real run | BROW-10 | **Closed.** A measured figure beside the CPU disclosure and before opt-in, with a guard that reddens on drift |

**BROW-01 and BROW-04 are untouched and are counted toward none of the above.**
