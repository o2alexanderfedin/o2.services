---
phase: 36-the-kill-switch-and-a-status-page
plan: 1
subsystem: runtime-control
tags: [kill-switch, admission, region-slice, version-slice, status-page, workerd, durable-object, volunteer, propagation, e2e]
requires:
  - .planning/phases/phase-35-conditions-of-entry-in-the-browser/35-01-SUMMARY.md
  - .planning/phases/phase-31-hosted-record-store-expiry-and-the-capability-it-never-advertises/31-01-SUMMARY.md
provides:
  - "RUN-02 Done — a halt written at runtime to one region's object stops that region's tabs taking new work while two other regions' tabs are observed still taking it, in one run, with every object's `instance` unchanged across the flip"
  - "RUN-03 Done — a read-only status page in the build's output, reachable with no account, key or cookie, reporting admitting before the flip and halted after it"
  - "criterion 1 — three objects, three region labels, one flipped; the version slice a within-run pair against this tree's own build stamp; the global-switch plant watched red at the write path"
  - "criterion 2 — a volunteer's own tab title and the status page, both read on BOTH sides of the flip, from a fresh context, with the outgoing request set proved non-empty and credential-free"
  - "criterion 3 — 29 880 ms over 6 tabs at a 30 000 ms poll, measured at two intervals, published where a volunteer reads it, with an anti-staleness guard"
  - "criterion 4 — status.html and policy.html both in dist/, proved by running the build and reading the output"
  - "THE PAUSE INVERSION CLOSED — before this phase a paused tab refused every peer and went on computing its own work"
  - "a live 404 repaired: policy.html was linked from the demo and had never been in the published build"
affects:
  - packages/libp2p/src/admission-directive.ts
  - packages/libp2p/src/admission-directive.test.ts
  - packages/libp2p/src/index.ts
  - packages/cloudflare/src/admission-flag.ts
  - packages/cloudflare/src/admission-flag.test.ts
  - packages/cloudflare/src/admission-slices.e2e.test.ts
  - packages/cloudflare/src/worker.ts
  - packages/browser/src/kill-switch.ts
  - packages/browser/src/kill-switch.test.ts
  - packages/browser/src/propagation-window.ts
  - packages/browser/src/browser-node.ts
  - packages/browser/src/computing-indicator.ts
  - packages/browser/src/computing-indicator.test.ts
  - packages/browser/src/colouring-surface.node.test.ts
  - packages/browser/src/tab-api.ts
  - packages/browser/demo/main.ts
  - packages/browser/demo/status.html
  - packages/browser/demo/status.ts
  - packages/browser/vite.config.ts
  - packages/net/src/index.ts
  - packages/node/src/kill-switch-regions.e2e.test.ts
  - packages/node/src/kill-switch-volunteer.e2e.test.ts
  - packages/node/src/kill-switch-propagation.e2e.test.ts
  - packages/node/src/status-page-address.node.test.ts
  - packages/node/src/reachability-guard.node.test.ts
  - packages/node/src/reachability-dispositions.ts
  - packages/node/src/serve-agent-hooks.node.test.ts
  - vitest.config.ts
decisions:
  - "The flag lives in Durable Object storage, not Workers KV — the scope fence forbids creating a KV namespace, and the object every tab already dials is the cheapest place a boolean can live. This SUBSTITUTES the mechanism open question 2 is framed around, and the substitution is disclosed rather than slipped in."
  - "The slice IS the object: each region's object holds its own directive, so one region cannot reach another by construction rather than by care."
  - "An object with no operator key refuses EVERY write. The temptation runs the other way and it is what turns a kill switch into a kill switch anyone can pull."
  - "A failed poll never halts. An operator's silence is not a stop order."
  - "`inFlight > 0` outranks `halted` in the tab title, so the marker is a claim about NEW work — which is what RUN-02's words are about."
metrics:
  duration: "one session, 2026-09-02"
  tasks_completed: "9 of 10 — Task 10's REQUIREMENTS.md rows are blocked on a concurrent session's uncommitted edit to that file"
  commits: 9
---

# Phase 36 Plan 1: The Kill Switch and a Status Page — Summary

A runtime, region-and-version-sliced stop for the cohort, banked on each bootstrap object's own
storage, applied by each tab to **its own** work as well as to its peers', and visible to a
volunteer who was given nothing.

---

## Read this first: the name oversells it

"Kill switch" is the roadmap's word. What was built stops a tab **taking on new work**. It does
not stop work already running — a tab that accepted 128 shards finishes them — and it takes
about thirty seconds to arrive. Phase 35's Stop button is the thing that ends in-flight work.
The tab's title says *"Not taking new work"* rather than *"Stopped"* for exactly this reason,
and the precedence rule that produces it is deliberate: a halted tab still draining **is**
computing, and a title claiming otherwise is something a visitor could catch by watching their
own fan.

---

## THE PHASE'S CENTRAL FINDING — the pause inversion, and it is now closed

**Before this phase, a paused tab refused every peer and went on computing its own work.** That
is the exact inverse of the rule the tree already stated, twice, in its own comments.

### The mechanism

`AgentOptions.paused` is consulted inside `serveAgent`, which answers **peers**. A tab running
its own work does not go through it: `rpcAdmission`'s first branch short-circuits the wire for
an offer addressed to the submitter — *"a node does not learn its own capacity over a wire"* —
and the port it consulted there was `BrowserNode.admission`, a bare `LocalCapacity` that has
never heard of `paused`. Three call sites in `demo/main.ts` did this: the `admit:` port on the
colouring run, and `capacity:` on both `prefers-local-combining` placements.

The tree's own two sentences, which the wiring did not match:

- `browser-node.ts` at the `authorize` hoist — *"a tab that admitted its own work by a rule
  other than the one it admits a peer's by would be more permissive to itself than to everybody
  else. One value, two readers, no way for them to disagree."*
- `demo/main.ts` at the two ports — *"Both ports are **this tab's own**, not second copies… A
  tab admitting its own work by a different rule would be more permissive to itself than to
  everybody else."*

### What closed it

`BrowserNode.localAdmission` — the one reading every local path takes, built once beside
`authorize` and closing over the **same** `paused` binding `serveAgent` is handed, not a second
copy. The bound goes on the one reading rather than at the three call sites, which is Phase 31's
recorded pattern. Its refusal is `pausedAnswer`'s `offer` arm in `LocalAdmission` clothing:
capacity published **unchanged**, `standing: 'declining-all-work'`, and `pausedRefusal`'s string
imported from `@o2/net` rather than composed a second time. All three call sites moved, and
`colouring-surface.node.test.ts`'s exact-line equality moved with them in the same commit.

### The observable, which is what settles it — not the commit subject

Three tabs, three regions, one local `workerd` each, one halted. Each tab is asked to start a
**new** run before the flip and again after it. Same run, quiet host (`load/core 0.91`):

```
[RUN-02 regions] bootstrap-us  new run after the flip -> took-the-work complete=true  found=true  statuses=found/found/found/budget
[RUN-02 regions] bootstrap-eu  new run after the flip -> took-no-work  complete=false found=false statuses=unagreed/unagreed/unagreed/unagreed
[RUN-02 regions] bootstrap-sam new run after the flip -> took-the-work complete=true  found=true  statuses=found/found/found/budget
[RUN-02 regions] eu title carried the stopped marker within 30 s: true (title = "■ Not taking new work — o2.services — node")
```

Every shard on the halted tab is `unagreed` — an unplaceable shard has no result for anything to
agree with — while the other two tabs' identical runs complete.

### The plant, watched red — Task 6 plant A

`demo/main.ts`'s `admit:` port reverted from `node.localAdmission` to `node.admission`, i.e. the
pre-phase wiring restored:

```
[RUN-02 regions] bootstrap-eu new run after the flip -> took-the-work complete=true found=true
                 statuses=found/found/found/budget
AssertionError: criterion 1: the eu tab took a new run after its own region was halted. It
said: took-the-work complete=true found=true statuses=found/found/found/budget. A halt a tab
applies to its peers and not to itself stops nothing — see `BrowserNode.localAdmission`.:
expected 'took-the-work complete=true found=tru…' to contain 'took-no-work'
```

**With the old port the halted tab took the work.** That is the defect, reproduced on demand and
watched failing. Restored by the surgical inverse; `cmp` silent.

A second plant — `paused:` deleted from `BrowserNode.start` — reddens the same arm with the same
text, so both halves of the wiring are covered by a behavioural case rather than by a source
scan.

---

## EVERY PLANT THAT STAYED GREEN, AND WHAT EACH REVEALED

Three plants stayed green. The plan flagged two of them in advance; the third did not exist in
the plan because the instrument it exposes was invented during execution.

### Green 1 — Task 5's `paused`-unwired plant. **Nothing at all catches it, including `tsc`.**

`paused: () => killSwitch?.halted() ?? false,` deleted from `BrowserNode.start`, then:

```
npx vitest run --project node kill-switch.test.ts computing-indicator.test.ts
  colouring-surface.node.test.ts serve-agent-hooks.node.test.ts
EXIT=0   Tests  58 passed (58)
npx tsc --noEmit
EXIT=0
```

**What it revealed.** `BrowserNodeOptions.paused` is optional, so deleting the wiring does not
even fail to compile — there is no type-level backstop, and no unit-level case anywhere carries
it. The *entire* claim that the switch reaches the node rests on **one** file:
`packages/node/src/kill-switch-regions.e2e.test.ts`, which was written later in the same phase
and where the same plant (plant B) does redden. Before that file existed, this wiring was
unguarded by anything. No source-text assertion was invented to make it look covered.

### Green 2 — Task 6's client-side region plant. **Region slicing here is structural.**

`kill-switch.ts`'s `readAdmission` made to drop the directive's region (`region: null`), so the
client cannot tell which region a halt names:

```
EXIT=0   Tests  1 passed (1)
[RUN-02 regions] bootstrap-eu new run after the flip -> took-no-work …
[RUN-02 regions] bootstrap-us / bootstrap-sam -> took-the-work …
```

**What it revealed.** The slice *is* the object. Each tab polls only the object it dials, so a
tab never has occasion to check a region and dropping the check changes nothing observable. The
region slice is enforced **at the write**, not at the read.

**The case that actually carries the claim** is Task 3's mis-addressed-write case in
`admission-slices.e2e.test.ts` — `POST` to the `us` port naming `bootstrap-eu`, refused **409**
with `us`'s directive unchanged afterwards — and that case *was* watched red under Task 3's
global-switch plant. The client-side plant is kept rather than deleted, and it is not restated
as a pass.

### Green 3 — the instrument the plan specified could not see the property. Twice.

Not a planted mutation but the same class of finding, and the more expensive one.

**(a) The counter cannot see an admission halt.** The plan's instrument was: sample
`tasksExecuted` over a window before the flip and an equal window after, expect the halted tab's
counter to stop. Written, run on a quiet host, and it produced

```
[RUN-02 regions] bootstrap-us  before=47 after=23 ratio=0.489
[RUN-02 regions] bootstrap-eu  before=47 after=32 ratio=0.681   ← the HALTED tab
[RUN-02 regions] bootstrap-sam before=45 after=41 ratio=0.911
```

**The halted tab was the middle of the three, and nothing was broken.** `submitJob` dispatches
every shard under one `Promise.all`, so admission for all 128 shards is decided **once, at
submit**; the counter afterwards is a queue *draining* work the tab already accepted, which no
admission control can or should stop. Had the arithmetic happened to fall the other way, this
would have been a green criterion resting on a reading that meant nothing.

**(b) An admission probe that repeats a job measures the checkpoint, not admission.** With the
verdict moved onto new submissions, the halted tab still came back accepted — while a direct
call to `node.localAdmission.would()` on the same tab, seconds later, refused with
`paused: 12D3KooWHE9t… is declining all work right now`. Two readings of one object disagreeing
meant one was about something else.

A log of every `admit` decision the page made settled it: **132 calls on the halted tab, none
refused, and none of them from the after-probe at all** — 128 from the long run, 4 from the
before-probe. The after-probe consulted admission **zero times**. Cause: CHURN-03's checkpoint
resume, working as designed. A job's id is derived from its module and input CIDs, so an
identical run is the identical job; `runColouring` resumes from the handle the first probe wrote
and every carried shard is `CARRIED_NOT_PLACED` — placed by nobody, so `admit` is never asked.
The two probes now name different `n`, so they are different inputs, different CIDs, different
jobs.

---

## What closed, criterion by criterion

### Criterion 1 — no redeploy, sliced by region and by client version. **CLOSED.**

Three `wrangler dev` children on 8801–8803, each with its own `mkdtemp --persist-to` and its own
`--var O2_REGION`, spawned sequentially. The floor first: three distinct labels, three
`halted: false`, three distinct `instance` values. Then **one** `POST /admission` to **one**
port.

```
[RUN-02 slice] bootstrap-us  instance before=84f8fee4-eda3-4e82-95b0-d4a9ba5403bf after=84f8fee4-eda3-4e82-95b0-d4a9ba5403bf halted=false
[RUN-02 slice] bootstrap-eu  instance before=1f0533cb-8f74-40df-bb95-9a561469d421 after=1f0533cb-8f74-40df-bb95-9a561469d421 halted=true
[RUN-02 slice] bootstrap-sam instance before=af837e9d-294e-43c3-a755-7d6709d7ed25 after=af837e9d-294e-43c3-a755-7d6709d7ed25 halted=false
```

`instance` is fixed at construction, so three unchanged values across the flip is **the
platform's own statement** that no construction and no eviction happened between the two
readings — a stronger claim than "we did not run `wrangler deploy`", because it also excludes a
restart nobody asked for.

The **version slice**, a within-run pair against this tree's own build stamp:

```
[RUN-02 version] this build = 2.0.0-rc.10;
                 arm A slice = 2.0.0-rc.10-a-version-no-build-carries -> admitting;
                 arm B slice = 2.0.0-rc.10 -> halted
```

The version is `clientVersionFrom(buildIdentity())` — the tree's own producer and the client's
own split — never a literal in the spec, which would pass on a tree whose version had moved.

**Plants watched red.** The global switch, planted at the write path and fanned at all three
ports as an operator with no slice would:

```
AssertionError: criterion 1: bootstrap-us is halted after a write addressed to bootstrap-eu.
That is a global switch wearing a region field, and it is the failure the criterion names: one
bad region would take offline volunteers whose region was never affected.: expected true to be
false
… > refuses a write addressed to a region it does not serve, and does not move
AssertionError: expected 200 to be 409
```

The plan warned this plant might stay green if a body validation fired first. It went
**200 ← 409**: the write was *accepted* once the region branch was gone, so the region check was
the only thing carrying that refusal. No reordering was needed.

And `isHaltedFor` made to ignore `versions` — "global-only" in its second sense — red in **both**
the e2e arm and the pure spec:

```
FAIL |e2e| … > leaves this build admitting under a halt naming a version that is not its own
AssertionError: expected true to be false
FAIL |node| … > leaves a client whose version is not named in the slice admitting
FAIL |node| … > leaves a client whose version could NOT be read admitting under a version slice
```

### Criterion 2 — a volunteer verifies the stop from their own tab. **CLOSED.**

Both surfaces, read on **both sides** of the flip, because the criterion's verb is *change* and
a change is a two-reading claim. The status page is opened in a `browser.newContext()` with no
storage state, no consent and nothing carried over, **before** the flip, and reports *"Admitting
new tasks"*; after the flip it reports *"NOT ADMITTING NEW TASKS"* with the operator's note and
the region. The demo tab's title is read before (undecorated) and polled after until it carries
`■ Not taking new work — `.

```
[RUN-03 volunteer] requests observed=13; write with no key=401, wrong key=401;
                   from the page: blocked: TypeError
```

The request set is proved **non-empty first** — a filter over an empty list passes for the wrong
reason — and then every request is asserted free of `Authorization`, `Cookie` and the admission
key header, read from **outside** the page with `page.on('request')` registered before `goto`.

**Operator access is a withheld capability, not an absent one**, and that is two observations
with different subjects:
- *from the page*: a cross-origin `POST /admission` dies at an unanswered preflight, because
  that route carries no CORS header at all. There is no status code to read and none is
  asserted. Adding `Access-Control-Allow-Origin` there would remove the mitigation.
- *from the harness*, where there is no CORS: `401` with no key and `401` with a wrong key, both
  status codes read, with the object's directive unchanged afterwards. **CORS is not the
  boundary; the key is.**

### Criterion 3 — the window measured and published. **CLOSED on its own terms.**

Six tabs, one local `workerd`, `t0` taken on the line immediately after the write's body is read
to completion, each tab recording its own observation moment inside its own page. Three runs on
a quiet host (`load/core 0.61 / 0.63 / 0.66`), `real 41.76 / 42.55 / 41.65` s against
`user 16.40 / 16.57 / 16.74` and `sys 4.71 / 4.84 / 4.70` — `(user+sys)/real` ≈ **0.50**, which
is what a spec that spends most of its time waiting on a timer should look like.

| run | window at 2 000 ms | ratio | window at 30 000 ms | ratio |
|-----|-------------------:|------:|--------------------:|------:|
| 1   | 1 874              | 0.937 | 29 869              | 0.996 |
| 2   | 1 859              | 0.929 | 29 884              | 0.996 |
| 3   | 1 874              | 0.937 | 29 891              | 0.996 |

Per-tab elapsed times — the maximum is a maximum *of* these:

- run 1 @ 2 000 ms: `1604, 83, 528, 973, 1470, 1874`; @ 30 000 ms: `27640, 28071, 28540, 28974, 29415, 29869`
- run 2 @ 2 000 ms: `1277, 1830, 298, 823, 1363, 1859`; @ 30 000 ms: `27592, 28050, 28494, 28960, 29394, 29884`
- run 3 @ 2 000 ms: `1548, 46, 515, 953, 1452, 1874`; @ 30 000 ms: `27595, 28041, 28507, 28963, 29450, 29891`

Later readings taken with the literal already in place: **29 828**, **29 801**, **29 837** ms.

**What the two arms say together, which one arm could not.** The raw window moved by a factor of
**15.9** while the interval moved by 15, and both ratios stayed at or under 1. So the window's
dominant term is the poll interval and nothing else contributes materially. The per-tab spread
is the tabs' poll *phases* — six tabs start about 450 ms apart — not jitter.

Published as `PROPAGATION_WINDOW_MS = 29_880` with `PROPAGATION_BAND = 1_500`, hand-written on
`data-cost.ts`'s model, rendered on the status page, and guarded on every run. **The band is
justified against the spread in writing**: three runs varied by 22 ms, so the band is ~70× the
observed variation — because the small spread is *structural* (the harness waits until every tab
has polled once and then writes, so the last tab always waits nearly a whole interval), and what
can actually move is host scheduling between that check and the write. A band at 22 ms would
redden on a busy afternoon.

**Plants watched red.** One tab given a 3 600 000 ms interval so it never polls again:
`TimeoutError: page.waitForFunction: Timeout 26000ms exceeded` — an unbounded maximum presents
as never resolving, which proves the window is a maximum over the **population**. And the
literal moved by an order of magnitude:

```
AssertionError: RUN-02: the published propagation window is 2988 ms and this run measured 29801
ms over 6 tabs at a 30000 ms poll — a difference of 26813 ms against a band of ±1500 ms. The
figure a volunteer reads on the status page and the figure this fabric actually delivers have
diverged; fix whichever moved — the literal if the mechanism changed, the mechanism if it
regressed.: expected 26813 to be less than or equal to 1500
```

### Criterion 4 — a status page a volunteer can reach. **CLOSED.**

`status.html` + `status.ts`, on `policy.html`'s shape: own inline styles, no framework, no region
catalogue, one named reader. It renders each object's region, halt state, version slice, `since`,
the operator's note, node `version`, `peerId`, `instance`, the traffic split, the relay journal,
**the site's own build identity** (labelled as a different thing from the node's, because reading
one as the other cost this project a false report on 2026-09-01), and the propagation figure.

It starts no node, fetches no artifact bytes, asks for no consent and stores nothing.

**An unreachable object renders a NAMED failure**, not an empty state — *"Could not be read —
answered HTTP 401"*. That was built in from the start rather than after a re-plant loop, and it
is what let the key-gated plant redden instead of passing (see below). A status page that
reported the fabric healthy precisely when it could not see it would be the one defect it must
not have.

Proved present by **running the production build and reading `dist/`**:

```
dist/status.html  2.87 kB   <meta name="o2-build" content="2.0.0-rc.10 13b5d0f-dirty"
dist/policy.html  9.87 kB   <meta name="o2-build" content="2.0.0-rc.10 13b5d0f-dirty"
dist/index.html 101.12 kB   <meta name="o2-build" content="2.0.0-rc.10 13b5d0f-dirty"
```

**Plants watched red.** (1) `GET /self` gated on the operator key — the page rendered *"Could not
be read — answered HTTP 401"* and the assertion distinguished it from a halt. *(First attempt at
this plant reddened in `beforeAll` instead, because the harness's own `readSelf` sends no key;
that is a red proving nothing about criterion 2, so the plant was sharpened to give the operator
the key and leave the page without one.)* (2) `status.html` dropped from `rollupOptions.input`:
`expect(existsSync(join(DIST, 'status.html'))).toBe(true)` → `expected false to be true`. (3) The
request collector registered after `goto`: *"the request collector saw nothing at all, so every
header assertion below would pass over an empty list and prove nothing. This is the floor, not a
formality.: expected 0 to be greater than 0"*. (4) The default origin moved by one character —
the drift guard named both sides and told the reader which to fix.

---

## The two corrections this plan carried, and three more the tree forced

### Carried from the plan

**1. `policy.html` was linked from the demo and had never been in the published build.**
Confirmed against the live site on 2026-09-02: `.../policy.html` returned **404** while the site
root returned **200** as the control, with the string `policy.html` present in the live bundle.
`vite.config.ts` declared no `rollupOptions.input`, so Vite built `index.html` only. The link is
assigned from JavaScript, which is why it never showed in a grep over served HTML; and every
guard that could have caught it reads the **source tree**, where the file has always existed.
Repaired by naming all three pages as inputs. `scripts/deploy-pages.sh` copies `$DIST/.` wholesale
and checks `index.html` and `bootstrap.json` by name — read before the change landed, not assumed.

**2. `SERVED_BY` and the no-`searchParams` rule were respected rather than relaxed.**
`hosted-tier-deploy.node.test.ts` is **untouched and green**. The region arrives as a `--var` on
`env`, the write route is selected by **pathname** and authenticated by a **header**.

### Forced by the tree during execution

**3. A defect this phase introduced and repaired, found by listening to the runtime.** Refusing
`POST /admission` before reading its body left the request stream dangling:

```
[workerd] ✘ [ERROR] Uncaught TypeError: Can't read from request stream after response has been sent.
```

— once per refused write, and the next `GET /self` on that object answered **500**. So two
correctly-refused POSTs from a stranger could take a region's status reading offline. The body is
now read first, bounded at 8 192 bytes on `#bankFunnel`'s precedent, and the key is checked after.
It was found only because `kill-switch-volunteer.e2e.test.ts` **pipes the worker's stderr** where
every other workerd spec in this tree passes `stdio: 'ignore'`. The same piping then caught
`Fatal uncaught kj::Exception … ::bind: Address already in use; 127.0.0.1:8807` — a `workerd`
grandchild surviving `SIGTERM` to its `npx wrangler` parent. Those specs now spawn `detached` and
kill the process group, then wait for the port to free.

**4. Three guards moved, each with a stated reason, none by raising a ceiling to hide a red.**

- `reachability-guard` refused the barrel export twice. The first time nothing called
  `isHaltedFor` or `clientVersionFrom`, so the **barrel line was narrowed** rather than the
  ceiling raised — they entered `@o2/libp2p`'s barrel in the commit that gave them a caller.
  The second time the guard's own derived arm named the class and the fix verbatim: *"these
  become reachable the moment the window.o2 assignment is traced… add them to
  GLOBAL_OBJECT_HOP"*. Both registered; `UNREACHABLE_CEILING` 116→118 and `DISPOSITION_CEILING`
  68→70, **by exactly two, matched to exactly two rows**.
- `ORPHAN_MODULE_CEILING` 31→32, named to `demo/status.ts`, whose mechanism the list already
  accepts seven times: an HTML `<script type="module">` entry no TypeScript graph can see, like
  `demo/nav.ts` and the six `demo/surfaces/*.ts`. Giving it a production importer was considered
  and rejected as fake wiring.
- `serve-agent-hooks.node.test.ts`'s `'paused: options.paused'` assertion moved to the hoisted
  form, with a **second** assertion added so the hoisted binding is proved to actually reach
  `serveAgent`. The `'never-pauses'` count stays exactly 1. `fabric-node.ts` is untouched: it has
  no second local reader, and the divergence is stated at the assertion.

**5. A plan-order change, forced.** Task 5 ran before Task 4, because Task 4's e2e spec calls
`isHaltedFor`, `@o2/libp2p` exports only `.`, and the barrel could not carry a callable with no
production caller. Task 7 ran before Task 6 for a different reason: the host sat at load average
98–135 under another project's build, and Task 6's verdict and Task 8's committed literal must
not be taken from a run whose banner says oversubscribed. No dependency was violated.

---

## Open question 2 — carried, NOT closed

`.planning/REQUIREMENTS.md` § Open questions, item 2 asks whether Workers KV's ~60 s global
propagation is acceptable for this control, or whether the push-over-an-open-socket path must
ship in the same phase.

**This phase produced the number and did not rule on it.** Criterion 3's own sentence licenses
exactly that: *"Open question 2 governs what is done about that number; this criterion only
requires that it exists."*

**The number:** `29 880 ms`, over `N = 6` tabs, at a `30 000 ms` poll interval, single host,
ratio `window / interval` = `0.996`, measured 2026-09-02.

**The disclosure, which must travel with it:** the mechanism measured is a **Durable Object
storage poll**, not Workers KV. The scope fence forbids creating a KV namespace, and the object
every tab already dials is the cheapest place a boolean can live — so **the ~60 s KV propagation
figure the question is framed around remains unmeasured by this phase.** What the number says is
what a *poll* costs. It does not say what KV costs, and it does not say what happens at cohort
scale. That sentence is not only here: it is `PROPAGATION_COVERS` in
`packages/browser/src/propagation-window.ts`, rendered on the status page, because a propagation
figure quoted without its mechanism is how a number about one thing becomes an answer about
another.

**The push path was deliberately not built.** Building a Durable Object broadcast over the
already-open socket would settle the question in the other direction by fait accompli. The
roadmap's sequencing is *"a Durable Object broadcast layered on **only if** the sub-minute window
proves unacceptable in practice"*, and "in practice" is Phase 39.

---

## What was NOT proved

- **No reading was taken on a deployed object.** Every `workerd` is local, on its own port, with
  its own `--persist-to` temporary directory, `CLOUDFLARE_API_TOKEN: ''`. Nothing was deployed,
  no remote resource was created, `wrangler.jsonc` is unedited, and the three `ocr-checks-worker*`
  scripts are untouched.
- **The three "regions" are three local processes, not three sited objects.** Siting three objects
  under three names is **Phase 33's** subject and is not pre-empted here.
- **The population is single-host tabs and is not a cohort.** Six tabs on one machine says nothing
  about three hundred across the internet — **Phase 39 criterion 5** exists because *"a control
  that works at three tabs and not at three hundred is a control nobody has."*
- **One client build exists**, so the version slice is proved through storage and the wire and
  **not across two real builds**. There is no second version to run.
- **The production key and region label are owner acts that have not been performed.** See
  `36-RUNBOOK.md`. Until they are, the control is inert in production — and inert in the *safe*
  direction: an object with no key refuses every write, including the owner's.
- **The refusal *reason* is not on the page's surface.** `TabColouringRun` carries no per-shard
  refusal reason and `runColouring` resolves rather than throwing when every shard is unplaceable,
  so *"refused with a reason naming the halt"* is not reachable from `window.o2` without widening
  `TabApi`. What is asserted is the fact the criterion is about. The reason string is composed at
  `BrowserNode.localAdmission` from `pausedRefusal` and was read verbatim off a live tab during
  diagnosis: `paused: 12D3KooWHE9t… is declining all work right now`.
- **`SCHED-03`'s paused state is untouched as a mechanism** and is not counted toward any of the
  above. What is counted is the remote sliced source for it, the closing of the self-versus-peer
  asymmetry, and the volunteer-visible evidence.

---

## Gates

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | **exit 0** |
| `npx vitest run --project node` | exit 1 — `229 of 232 files passed`, `3334 passed / 6 failed / 2 skipped`. **All six failures are in `acceptance-traceability`, `requirements-ledger` and `state-frontmatter`, which read `REQUIREMENTS.md`, `ROADMAP.md` and `STATE.md` — the three files a concurrent session holds uncommitted. None touches anything this phase wrote.** Banner: `HOST WAS OVERSUBSCRIBED … load/core 25.84` |
| `--project e2e`, this phase's four specs | **exit 0** individually on quiet hosts: `admission-slices` 6/6, `kill-switch-regions` 1/1, `kill-switch-volunteer` 2/2, `kill-switch-propagation` 1/1 |
| `--project e2e`, Phase 35's readings | **exit 0** — `computing-indicator.e2e` + `built-bundle.e2e` 12/12; `stop-closes-the-billed-socket` + `hosted-record-store` 4/4 |
| `--project browser` | **exit 0** — `kill-switch.test.ts` + `computing-indicator.test.ts`, `81 passed` across chromium, firefox and webkit |

`aot` is a lane, not a subset; it is untouched by this plan and is not part of this phase's gate.

`vitest.config.ts`: `files` 228 → 236, `unitFiles` 150 → 158, each move dated and named.

---

## Outstanding, and why

**The `RUN-02` and `RUN-03` ledger rows in `.planning/REQUIREMENTS.md` are NOT flipped.** That
file currently holds another session's uncommitted `AUTH-06` addition, and committing it by
explicit path would carry the foreign hunk in under this phase's message. Reported rather than
done, per the coordinator's instruction. Both criteria pairs are ready to flip to `Done` with the
verdicts this summary records.

`.planning/ROADMAP.md` and `.planning/STATE.md` are deliberately untouched — the owner updates
those, and both currently carry another session's work as well.
