# 39-02 — SUMMARY: the funnel asks the origin whether it is a collector before it sends it anything

The defect this plan closes was recorded, not hypothetical. `funnelEndpointFromRelay` derives
`https://<host>/funnel` from the relay a tab bootstrapped through. That is true of the deployed
Cloudflare Worker — which is why the derivation was added at all, after a run of 6 615 relay
reservations reported nothing — and **false of any self-hosted seed**, which serves libp2p
WebSocket on that port and answers `400`. The beacon failed immediately, so nothing hung and
nothing was logged: the funnel *looked configured and collected nothing*. Criterion 2's words
are *"reporting live at the moment the first invite is sent"*, so a silent drop is a criterion-2
**failure that presents as a criterion-2 pass**, and `RUN-07`'s staged go/no-go could not tell
"nobody came" from "nothing was collected".

The repair is **probe before targeting**: derive the origin exactly as before, and install the
send port only once the origin has answered with a funnel-shaped body. Every failure closes to
the pre-derivation inert reporter, so the change can only ever make the funnel quieter than it
already was.

`REQUIREMENTS.md`, `ROADMAP.md` and `STATE.md` were **not touched**. `RUN-07` is not claimed
closed here — this plan removes the defect that made the staged go/no-go unexecutable; whether
each stage's reading is actually taken between invitations is an act, not a mechanism.

## What landed

- `packages/browser/src/funnel-reporter.ts` — `FUNNEL_PROBE_TIMEOUT_MS`, `FunnelProbePort`,
  `probeFunnelTarget`, `fetchProbePort`. No new import, no new origin literal, nothing read at
  module scope.
- `packages/browser/src/funnel-probe.test.ts` — 11 cases, run in the `node` project and in
  chromium, firefox and webkit (33 results).
- `packages/browser/demo/main.ts` — the derivation site now probes the derived branch and
  targets the configured branch immediately, plus a `funnelFacts()` export.
- `packages/node/src/funnel-probe.e2e.test.ts` — two arms against one stand-in HTTP server that
  differs between them only in what it answers.

## What the probe does, on each of the four arrangements

| the derived origin answers | the probe answers | the reporter | what a report costs |
|---|---|---|---|
| `400` on every path — a self-hosted seed's websocket port | `null` | stays inert, `active` is `false` | nothing is sent |
| a funnel-shaped body carrying a `schemaDigest` string | the endpoint | `target()` installs the beacon port; the held stages flush in composition order, each carrying the hour it happened | every stage reached |
| `200` with a body that is JSON and is **not** a collector | `null` | stays inert | nothing is sent — the port is not installed |
| nothing at all — the endpoint came from `?funnel=` | the probe is never called | targeted immediately, exactly as before | unchanged |

The third row is the one the whole function exists for. A `200` from a static host, a captive
portal or a router's admin page is precisely the shape that would install a port to nowhere
while looking configured, and a status check cannot see it. **The validation is on the body.**
Absent field, non-string field, JSON that is an array, and the literal `null` are all refused —
four assertions in one case.

The digest is deliberately **not** compared against `FUNNEL_SCHEMA_DIGEST`. Its job at this seam
is to prove *this is a collector*; comparing it here would make a page refuse a collector whose
schema had just moved, and the funnel would go silent on exactly the deployment that had been
updated. `37-RUNBOOK.md` step 5 already owns that comparison, as an operator reading one
collector between two moments. A case asserts the permissiveness rather than leaving it in prose
(*"accepts a collector whose schema has MOVED"*, digest `ffffffffffffffff`).

## The RED steps, verbatim

### Task 1 — the unit arms, before the function existed

`EXIT=$?` on the line immediately after; the run was `exit=1`. Three engines, three identical
refusals with three different wordings, which is worth keeping because it is the only place in
this plan where the same fact is stated by three implementations:

```
 ❯ |browser (chromium)| packages/browser/src/funnel-probe.test.ts (0 test)
 ❯ |browser (webkit)| packages/browser/src/funnel-probe.test.ts (0 test)
 ❯ |browser (firefox)| packages/browser/src/funnel-probe.test.ts (0 test)

Caused by: SyntaxError: The requested module '/packages/browser/src/funnel-reporter.ts' does not provide an export named 'FUNNEL_PROBE_TIMEOUT_MS'
Caused by: SyntaxError: The requested module 'http://localhost:63315/packages/browser/src/funnel-reporter.ts' doesn't provide an export named: 'FUNNEL_PROBE_TIMEOUT_MS'
Caused by: SyntaxError: Importing binding name 'FUNNEL_PROBE_TIMEOUT_MS' is not found.
```

`[host conditions] host was quiet — load/core 0.43 before, 0.55 after (8 cores, ceiling 4.00)`

### Task 2 — both arms, against the wiring as it stood on `develop`

The e2e was written and run **before** the demo page was changed, so the first red is the defect
itself rather than a plant of it. `exit=1`, both arms:

```
AssertionError: RUN-07: the page posted 2 report(s) to a collector that answered 400 on every path. The derived origin is a self-hosted seed's websocket port, not a collector, and a report sent there is a report lost silently — [POST /funnel, POST /funnel, GET /self] upgrades=1: expected 2 to be +0 // Object.is equality
```

```
AssertionError: RUN-07 control: the collector was not probed exactly once — [POST /funnel, POST /funnel, GET /self] upgrades=0: expected +0 to be 1 // Object.is equality
```

`[host conditions] host was quiet — load/core 0.49 before, 0.40 after (8 cores, ceiling 4.00)`,
wall clock 25.26 s.

That first message is the defect printed as a number: **two reports left this page for a host
that answered 400 to everything**, and before this plan nothing anywhere would have said so.

### The same two arms after the wiring

```
[funnel-probe] derived http://127.0.0.1:58010/funnel; arm B log [GET /funnel, GET /self, POST /funnel, POST /funnel] upgrades=0
 ✓ posts nothing to a stand-in that answers 400, and says the funnel is inert  3247ms
 ✓ probes and then posts its stages to a stand-in answering a funnel-shaped body  1305ms
```

`[host conditions] host was quiet — load/core 0.42 before, 0.50 after (8 cores, ceiling 4.00)`,
wall clock 5.63 s.

## The positive control, and the control on the instrument that reads it

Arm A's zero is a measurement only because arm B exists. The two arms are the same page, the
same relay address, the same consent, the same `start`, and the same stand-in process — they
differ in **one** thing, which is what that server answers on `/funnel`. Without arm B, arm A
would pass on any page that never reached the funnel at all, which is the
absence-with-no-positive-control failure this repository has already shipped once.

There is a second instrument, and it needed a control of its own. `funnel.active` is module
state in `demo/main.ts`, and the scope fence puts `tab-api.ts` out of reach, so it is read
through a module export — `funnelFacts()` — reached by importing the same URL the page already
loaded. A dynamic import that resolved to a **different module instance** would answer
`active: false` for a reason that has nothing to do with a collector, and arm A would pass on
an artefact. So `funnelFacts()` answers two fields, and every read asserts the second: a fresh
instance re-runs `funnel.enter('page-load')` on a reporter nobody armed and reports
`furthest: 'page-load'`, while the page's own instance has consented and reports
`furthest: 'consent'`. Both arms read `'consent'`.

## The plants

Each was run on its own, watched red, and restored by reversing exactly the lines it changed —
never by `cp` of a whole file, because `demo/main.ts` is a file a concurrent agent may be
writing. Each restore was verified `cmp`-clean against a snapshot taken immediately before that
plant. **Both `cmp` calls exited `0`. Neither plant stayed green.**

### Plant 1 — the `schemaDigest` check deleted, so the probe accepts any `ok` response

`return typeof digest === 'string' ? endpoint : null` became `return endpoint`. One case
reddened, in all three engines, and it was the case aimed at:

```
AssertionError: expected 'http://127.0.0.1:8796/funnel' to be null
 ❯ packages/browser/src/funnel-probe.test.ts:100:87
```

The other ten stayed green, which is the discrimination the plant was testing for: the 400 case
and the not-JSON case are refused by other clauses, so a plant that reddened everything would
have proved the cases are not separable. The named claim — *a `200` that is not a collector is
refused* — is carried by exactly one case and that case is the one that fell.

### Plant 2 — the wiring reverted to the unconditional `funnel.target(...)`

Arm A reddened with the POST count in the message, which is what the plan asked for and what
makes the failure a number rather than `expected true to be false`:

```
AssertionError: RUN-07: the page posted 2 report(s) to a collector that answered 400 on every path. The derived origin is a self-hosted seed's websocket port, not a collector, and a report sent there is a report lost silently — [POST /funnel, POST /funnel, GET /self] upgrades=1: expected 2 to be +0 // Object.is equality
```

Arm B reddened too, on the missing probe:

```
AssertionError: RUN-07 control: the collector was not probed exactly once — [POST /funnel, POST /funnel, GET /self] upgrades=0: expected +0 to be 1 // Object.is equality
```

## The cost term, which plan 39-04 consumes

**One additional `GET` per visit, to the derived collector origin.** It carries no report and no
identifier; it reveals only that a browser reached the origin, which the WebSocket bootstrap
already revealed. That is T-39-08's accepted disposition and T-39-09's counted one.

The e2e made the denominator sharper than the plan assumed, and the correction is a finding
rather than a convenience. The first red printed `GET /self` in the stand-in's log, in **both**
arms — that is `kill-switch.ts` polling the admission field off the node this tab bootstrapped
through. So the page was already making HTTP requests to this origin before any funnel existed,
and a request filter keyed on the method alone would have counted that poll and reported the
probe's cost as two requests instead of one. The filter is keyed on `GET /funnel`, and the
docblock beside it says why.

## Two things the plan predicted that did not happen, reported rather than absorbed

**The `slow-specs.node.test.ts` file-count guard did not redden.** The plan states that the node
project holds 241 collectable files against a recorded 236, that the drift is exactly at
`FILE_COUNT_TOLERANCE`, and that the first node-project spec this phase adds reddens it —
`packages/browser/src/funnel-probe.test.ts` is collected by the `node` project as well as the
`browser` one, so it is that spec. `vitest.config.ts` now records `files: 248`, and the guard
passes 15/15 both standalone and inside the commit hook. The recorded measurement moved between
the plan being written and this plan running. `vitest.config.ts` was not edited; 39-07 still
owns the re-derivation for the phase.

**No commit needed `O2_SKIP_GUARDS=1`.** The full cheap-guard set ran on the commit and passed
401/401 across nine files, including `reachability-guard`, `purity`, `requirements-ledger`,
`acceptance-traceability` and `state-frontmatter`.

## The correction the e2e needed, and why it is written down

`funnelFactsOf` first read the page's module through an arrow function passed to
`page.evaluate`. Vitest transforms this spec file before Playwright stringifies that callback,
so a dynamic `import()` inside it arrives in the browser as `__vite_ssr_dynamic_import__` — a
name that exists in the runner and not in the page:

```
Error: page.evaluate: ReferenceError: __vite_ssr_dynamic_import__ is not defined
```

It failed at the point where **both arms had already passed every assertion about the log**, so
the wiring was already correct when this surfaced. The fix is a string expression, which
Playwright hands to the page untouched. Recorded in the spec's own docblock, because the next
fixture that wants to reach a page module will hit it.

## Commands run, with exit codes read on the line immediately after

| command | exit |
|---|---|
| `grep -c "://" packages/browser/src/funnel-reporter.ts` — before the task | `5` |
| `npx vitest run --project browser funnel-probe` — **RED**, no such export | 1 |
| `npx vitest run --project browser funnel-probe` — GREEN, 11 cases × 3 engines | 0 |
| `npx vitest run --project node funnel-reporter` — the origin-literal scans | 0 |
| `npx vitest run --project browser funnel-probe` — **plant 1** | 1 |
| `cmp` after restoring plant 1 | 0 |
| `npx vitest run --project browser funnel-probe` — after restore | 0 |
| `npx vitest run --project e2e funnel-probe` — **RED**, both arms, unchanged wiring | 1 |
| `npx vitest run --project e2e funnel-probe` — GREEN, both arms | 0 |
| `npx vitest run --project e2e funnel-probe` — **plant 2** | 1 |
| `cmp` after restoring plant 2 | 0 |
| `npx tsc --noEmit` | 0 |
| `npx vitest run --project node funnel-reporter funnel-probe` — 51 cases | 0 |
| `npx vitest run --project e2e demo-regions built-bundle disclosure-before-optin demo-viewport embedded-webview` — 43 cases | 0 |
| `npx vitest run --project e2e funnel-probe funnel-attribution` | 0 |
| `npx vitest run --project e2e funnel-live` | 0 |
| `npx vitest run --project node slow-specs` | 0 |
| `npx vitest run --project node opt-in-only-sources purity reachability-guard stored-value-guard checkpoint-optout-scope disclosure-four-elements browser-client-publish` — 136 cases | 0 |
| `grep -c "://" packages/browser/src/funnel-reporter.ts` — after the task | `5` |

`grep -n 'schemaDigest' packages/browser/src/funnel-reporter.ts` returns two lines, `472` in the
docblock and **`522` inside `probeFunnelTarget`**.

`funnel-live.e2e.test.ts` is the live evidence for the fourth arrangement and was run for that
reason. It drives the page with an explicit `?funnel=` against a local `wrangler dev` with its
own `--persist-to`, and all six stages moved exactly as before this plan —
`entered[ page-load=3 consent=3 wss-bootstrap=3 ice-gathering=2 connection-classified=2
first-task=2 ] stalledAt[ wss-bootstrap=1 ]`. **An explicit `?funnel=` still wins, unchanged and
unprobed.**

`funnel-attribution.e2e.test.ts` was run for the same reason: the two funnel e2e specs are the
blast radius of a change at this seam, and the five demo-page specs the phase brief names are
not.

## Where this differs from the precedent it follows, stated rather than hidden

`funnelFacts()` is exported from `demo/main.ts` on `signinFacts`'s stated rule — *"exported here
rather than added to `TabApi`"* — and it differs from that precedent in one respect: **nothing
in the production page consumes it.** `index.html` imports `signinFacts` and renders from it;
`funnelFacts` exists so that "the funnel is inert" is observable at all, which is the property
`RUN-07`'s staged go/no-go rests on, and its only caller today is the e2e. It grows no
`window.o2` surface, and `reachability-guard` treats `demo/main.ts` as an entry point rather
than as a barrel, so no disposition register moved. The fence reason is worth naming: adding a
`TabApi` method would have required `packages/browser/src/tab-api.ts`, which is outside this
plan's writable set.

## Threat register

| id | disposition | how it stands after this plan |
|---|---|---|
| T-39-06 | mitigate | The body must carry a `schemaDigest` string. A bare `200` from any host is refused — asserted in four forms in one case, and the plant that removed the check reddened exactly that case. |
| T-39-07 | accept | Unchanged: the origin still comes from the relay the visit already bootstrapped through, and there is still no literal fallback. |
| T-39-08 | accept | The probe is one `GET` carrying no report and no identifier. The page already polls `/self` on the same origin. |
| T-39-09 | mitigate | Counted: **+1 request per visit**, measured at the stand-in's own log rather than reasoned about. |
| T-39-10 | mitigate | This is the defect closed. `FunnelReporter.active` reads `false` for an uninstalled port, and the page's own reading of it is asserted in both arms. |
| T-39-11 | accept | The probe reads; it grants nothing. |

No new threat surface was introduced: the probe adds one outbound read to an origin the page
already speaks HTTP to, and it installs strictly less than the code it replaced.

## Deviation from the workflow's per-task commit rule

The generic execution workflow commits each task. This plan's Task 2 acceptance is *"`git show
--stat` lists exactly the four files"*, which a per-task commit cannot satisfy — a Task 1 commit
would leave Task 2's showing two. So both tasks landed in **one** `feat` commit, made only after
both plants were restored `cmp`-clean and nothing planted was staged, and the summary follows in
its own `docs` commit.

## Commits

| commit | what |
|---|---|
| `21dfc99` | `feat(39-02)` — the probe, its 11 cases, the wiring, and the two behavioural arms |
| `c271aa3` | `docs(39-02)` — this summary |
| `4135004` | `docs(39-02)` — comments only, no behaviour: the two sites that said *"loses nothing at all"* now carry the round-trip residue below, and so does this file |

## What this plan does not know

It does not know that the **deployed** collector answers the probe as a collector. Nothing here
touched `o2-bootstrap.af-4a0.workers.dev` — the money fence forbids it — so the good-shape body
in both fixtures is the one recorded in the plan from a reading taken on 2026-09-04, reproduced
from `FUNNEL_SCHEMA_DIGEST` and the field set. The worker's `GET /funnel` was read in source
instead: it answers `Response.json(totals, { headers: FUNNEL_CORS_HEADERS })` with
`Access-Control-Allow-Origin: *`, which is what a cross-origin probe needs to read the body at
all. **A live read of the deployed collector before the first invitation is `37-RUNBOOK.md` step
2 and remains an owner act.** If that read ever returned a body without a `schemaDigest`, this
change would make the published page inert — which is the same inertness it had before, and is
why the fence closes this way round.

## The one thing this change costs, on the working path

`#held` makes a late target safe, and "safe" is narrower than the phrase this summary first
used. Before the probe, the send port was installed **synchronously** inside `start()`, so a
visitor who consented, started and then closed the tab immediately still delivered stages one
and two and the terminal `stalled()` beacon. Now those reports sit in the hold until the probe
answers: `stalled()` on `pagehide` finds `#send === null`, pushes the report, and a tab that
dies before the probe resolves takes all of them with it.

The window is **one round trip against a healthy collector, and `FUNNEL_PROBE_TIMEOUT_MS` — ten
seconds — against one that hangs**. Nothing is lost against a collector that refuses, because
nothing was ever collected there; the residue is entirely on the path that works. So the visits
this change makes invisible are exactly the shortest ones, and any figure taken from this funnel
is over visits that survived a round trip past `start`. `BENCH-08`'s denominator now carries two
qualifiers rather than one: the opted-in subset, that did not bounce inside one round trip. Plan
39-04 reads these counts and this is the term it has to carry.

Both the module's own docblock and the comment at the wiring site say this; neither says "loses
nothing at all", which is what they said when this plan was first committed.

It also does not know what a **real** self-hosted seed answers. The 400 arm is a stand-in that
answers 400 on every path, which is what a seed's websocket port is reported to do; it is the
defect's shape, measured, and not the seed itself.
