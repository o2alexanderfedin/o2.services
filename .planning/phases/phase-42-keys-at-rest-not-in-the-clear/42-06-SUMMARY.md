---
phase: 42-keys-at-rest-not-in-the-clear
plan: 06
subsystem: testing
tags: [auth-06, signin, e2e-sweep, autostart, brow-06, brow-07, brow-08, plants]
requires:
  - "42-04's `#signin` on the demo page, `TabApi.register` / `TabApi.unlock`, and `SignedOutError` out of `api.start`"
  - "42-04's measured expected-red list — 37 e2e files with the mechanism and observed first failure for each. That list, not the plan's grep-derived 21, was this plan's worklist"
  - "42-03's `plantLegacyIdentitySeed`, whose adoption this plan finally reads end to end"
provides:
  - "`packages/node/src/e2e-signin.ts` — one door: `signInDemoTab` presses the page's own controls, `signInHarnessTab` / `registerHarnessTab` call the API halves for fixtures that never touch the DOM"
  - "37 e2e files taught the new front door, and the whole `e2e` lane green"
  - "`autostarted-switch.e2e.test.ts` — BROW-07 and BROW-08 read on a node nobody pressed Start for, with the press counted rather than assumed absent"
  - "the stale-consent ordering re-read at a second HTTP server's own log, and planted red"
  - "a THIRD failure mechanism 42-04's list does not carry: unlocking now STARTS a node, which collides with every harness that owns its own blockstore and with every reading taken of a nodeless tab"
  - "T-42-27 read in `visitor-enrolment.e2e.test.ts`, in the two forms that file could reach, with the positive control the absence half needs"
  - "42-03-SUMMARY.md's *it survives 42-04* claim corrected in place and dated"
affects:
  - packages/node/src/e2e-signin.ts
  - packages/node/src/autostarted-switch.e2e.test.ts
  - packages/node/src/visitor-enrolment.e2e.test.ts
  - packages/node/src/demo-fabric.e2e.test.ts
  - packages/node/src/demo-primes.e2e.test.ts
  - packages/node/src/colouring-demo.e2e.test.ts
  - packages/node/src/owner-domain-tabs.e2e.test.ts
  - packages/node/src/kill-switch-volunteer.e2e.test.ts
  - packages/cloudflare/src/stop-closes-the-billed-socket.e2e.test.ts
  - .planning/phases/phase-42-keys-at-rest-not-in-the-clear/42-03-SUMMARY.md
tech-stack:
  added: []
  patterns:
    - "a harness that drives `window.o2` must SYNCHRONISE with the page's own render before it registers, or it races a tick that starts a second node"
    - "a premise stated by the ABSENCE of a line in a spec is stated by nothing: `#join` is counted by a listener installed before the page's own script"
    - "a reading of a nodeless tab is now taken BEFORE sign-in, where nodelessness is a guarantee rather than a race"
    - "a fixture that needs its own `blockstoreName` must give relay discovery nothing to find, or the page starts a node under the default store beside it"
    - "an absence assertion over storage needs a positive control drawn from the same dump"
decisions:
  - "the worklist is 42-04's measured 37, not the plan's 21 — the plan's own tables were wrong about `#allow` counts in three files and about which fixtures keep their `#join`"
  - "`signInHarnessTab` waits for `#signin` to be visible between granting consent and registering; the wait is the sync point, not politeness"
  - "`colouring-demo` signs in through the DOM rather than the API, because `#run` and `#verify` live inside `#main`"
  - "`demo-fabric`'s non-joining tab and `kill-switch-volunteer`'s tab are opened with NO `?relay=`, so the page starts nothing and the fixture's own start is the only one"
  - "`owner-domain-tabs` lets the page's node come up and stops it before starting its own — its three tabs need three stores and the page's auto-start uses the default"
  - "the plant reddens the render-level ordering only; `artifact-fetch-gate` arm A stays green and the measured reason is recorded rather than the plant widened"
  - "AUTH-06 is still NOT ticked here — 42-05 is the owner's checkpoint"
metrics:
  completed: 2026-09-04
---

# Phase 42 Plan 06: Everything Else Learns the New Way In — Summary

**Thirty-seven e2e files taught the door `42-04` moved, through one shared helper; the visible
switch read on a node nobody pressed Start for; and a third failure mechanism `42-04` could not
have seen, because it only appears once a file is repaired.**

## Performance

- **Tasks:** 3 of 3
- **Files modified:** 45 (41 in the sweep commit, 4 in the switch commit)
- **Commits:** `3db368b` (the sweep, 41 files), `483c880` (the switch, the three repairs and
  the `42-03` correction, 5 files), `a625800` + this one (the summary)
- **The lane:** `e2e` **64 files / 332 tests, all passed**, `EXIT=0`, on a quiet host

---

## THE AUDIT — which of the 37 closed, and how each one greened

`42-04-SUMMARY.md`'s *THE EXPECTED RED* is the baseline, taken from that document rather than
re-derived. Every file below was run **on its own**, `EXIT` read on the line immediately after
the command. The `[host conditions]` banner for each run is in the run log; every one read
**quiet**, and the two highest were `3.75` and `3.36` before, both still under the 4.00 ceiling.

**Reconciliation of the 37 against this repository's own greps, done before any edit:** sixteen
files click `#allow` (mechanism (a)'s fourteen, plus `kill-switch-volunteer` and
`owner-domain-tabs`, whose `#allow` sites did not time out because neither waits on `#main`
straight after); twenty-one call `window.o2.grantConsent()` inside a `page.evaluate` and never
touch the DOM; `visitor-enrolment` is in both lists. 16 + 21 = **37**, and the set matches
`42-04`'s file-for-file.

### Mechanism (a) — `#allow` no longer reveals `#main`. Fourteen files.

| file | `42-04` predicted | run | reason matched? |
|---|---|---|---|
| `artifact-fetch-gate` | 1 of 2 — `waitForFunction` on `#main` at `:233`; **arm A passed** | `EXIT=0`, 2 passed | **yes**, and arm A still passes |
| `attestation-ui` | 8 of 8 — `openPage` at `:344` | `EXIT=0`, 8 passed | yes |
| `built-bundle` | 2 of 9 — `consent` at `:113` | `EXIT=0`, 9 passed | yes |
| `demo-bench` | 6 skipped, `beforeAll` failed at `:138` | `EXIT=0`, 6 passed | yes |
| `demo-byo` | 17 of 17 | `EXIT=0`, 17 passed | yes, **plus mechanism (c)** — 2 spent `#join` presses |
| `demo-fabric` | 9 skipped of 18 | first `EXIT=1`, **4 failed**; after repair `EXIT=0`, 18 passed | **FINDING — mechanism (c)** |
| `demo-liveness` | 6 skipped, `beforeAll` failed at `:200` | `EXIT=0`, 6 passed | yes, plus 1 spent `#join` |
| `demo-pi` | 10 of 10 | `EXIT=0`, 10 passed | yes, plus 1 spent `#join` |
| `demo-primes` | 14 skipped, `beforeAll` failed at `:248` | `EXIT=0`, 14 passed | yes, **plus mechanism (c)** |
| `demo-regions` | 9 skipped of 18 | `EXIT=0`, **19** passed | yes (+1 new case, below) |
| `demo-viewport` | 7 of 7 — `openAt` at `:301` | `EXIT=0`, 7 passed | yes, plus 1 spent `#join` |
| `disclosure-before-optin` | 1 of 1 at `:122` | `EXIT=0`, 1 passed | yes |
| `quorum-ui` | 4 of 4 — `openEnrolledTab` at `:367` | `EXIT=0`, 4 passed | yes |
| `visitor-enrolment` | 6 of 8 — `#enrol-offer` never visible | first `EXIT=1` (my own new assertion — below); after repair `EXIT=0`, 8 passed | yes for the sweep; the red was mine |

### Mechanism (b) — `SignedOutError` out of `start` / `autoStart`. Twenty-three files.

| file | `42-04` predicted | run | reason matched? |
|---|---|---|---|
| `background-tab` | 3 of 3 | `EXIT=0`, 3 passed | yes |
| `colouring-demo` | 8 of 8 | first `EXIT=1`, **2 failed**; after repair `EXIT=0`, 8 passed | **FINDING — mechanism (c)** |
| `computing-indicator` | 3 of 3 | `EXIT=0`, 3 passed | yes |
| `duty-cycle-tab` | 6 of 6 | `EXIT=0`, 6 passed | yes |
| `funnel-attribution` | 3 of 6 | `EXIT=0`, 6 passed | yes |
| `funnel-live` | 2 of 2 | `EXIT=0`, 2 passed | yes |
| `gated-seed` | 3 of 4 | `EXIT=0`, 4 passed | yes — **and this is `42-03`'s correction, read** |
| `hard-stop` | 1 of 1 | `EXIT=0`, 1 passed | yes |
| `kill-switch-propagation` | 1 of 1 | `EXIT=0`, 1 passed | yes |
| `kill-switch-regions` | 1 of 1 | `EXIT=0`, 1 passed | yes |
| `kill-switch-volunteer` | 1 of 2 | `EXIT=0`, 2 passed | yes, **plus mechanism (c)** |
| `many-tabs` | 1 of 1 | `EXIT=0`, 1 passed | yes — 16 tabs register concurrently against one origin |
| `owner-domain-tabs` | 1 of 1 — 180 s `waitForFunction` at `:307` | `EXIT=0`, 1 passed | yes, **plus mechanism (c)** |
| `peer-ledger` | 6 of 7 | `EXIT=0`, 7 passed | yes |
| `relay-latch` | 3 skipped, `beforeAll` at `:119` | `EXIT=0`, 3 passed | yes |
| `seed-binary-join` | 1 of 2 | `EXIT=0`, 2 passed | yes |
| `seed-discovery` | 3 of 9 | `EXIT=0`, 9 passed | yes (three call sites) |
| `static-rendezvous` | 5 of 5 | `EXIT=0`, 5 passed | yes |
| `tab-refusals` | 3 of 3 | `EXIT=0`, 3 passed | yes |
| `turn-end-to-end` | 2 of 2 | `EXIT=0`, 2 passed | yes |
| `turn-fallback` | 4 of 5 | `EXIT=0`, 5 passed | yes |
| `two-tabs` | 6 of 6 | `EXIT=0`, 6 passed | yes |
| `packages/cloudflare/src/stop-closes-the-billed-socket` | 1 of 1 | `EXIT=0`, 1 passed | yes — it imports the helper across the package boundary by relative path, which resolves |

**33 of 36 files were green on the first per-file pass. Three were not, and all three are one
finding.**

### Files that were passing and now fail

**None, and this is now measured rather than argued.** The twenty-six files `42-04` names as
passing were re-run in the whole-lane sweep above and every one of them passed —
including **`lease-expiry`**, whose documented flake did not fire in either plan's sweep, and
including `built-bundle`'s two no-foreign-request cases, which the brief singled out and which
still pass with the attribution link present (it is an `<a href>`, not a request). One node-lane test that passed in `42-04`'s run is **skipped** in this
plan's — `transport-bounds.node.test.ts`, one case — and it is a *self-declared, load-gated
skip* in a file this branch does not touch: `if (load >= LOAD_CEILING)` with `LOAD_CEILING = 12`
and its own sentence *"a contended host inflates them past a threshold sited on a quiet one. The
counter assertion above is ungated and still ran."* The node lane's banner read
**OVERSUBSCRIBED — 9.68 after**, which is the condition that fires it. Totals reconcile exactly:
`42-04` read 3496 passed + 2 skipped = 3498; this plan reads 3495 + 3 = 3498.

---

## THE FINDING — a third mechanism, and it is only visible after a file is repaired

`42-04` measured two mechanisms and both are exactly right. There is a **third**, and `42-04`
could not have seen it, because it does not fire until a file has been taught to sign in:

> **Unlocking STARTS a node.** `revealMain` ends with `if (relayAddrs.length > 0) await
> joinNow()`, and `joinNow` calls `autoStart({})` — the **default** blockstore. So the moment a
> fixture signs in, the page starts a node of its own, under `o2-blocks`, beside whatever the
> fixture was about to start under its own `blockstoreName`.

That collides with three different things, and each one cost a file:

**(c1) A fixture that owns its own store.** Two `BrowserNode`s in one tab is two reservations on
one relay and a `window.o2.activity()` reporting whichever finished last. It hit
`owner-domain-tabs` (three tabs, three stores, one profile — the page's node would have made all
three ONE node) and `kill-switch-volunteer` (whose start carries `admissionPollIntervalMs` and
cannot be the page's).

**(c2) A reading taken of a NODELESS tab.** `demo-fabric`'s `stopped` arm reported **33 regions**
carrying a live figure where the catalogue's stopped sentence belongs, and its two-tab count went
to three because the third tab had reserved as well. `demo-primes`' *"state one: no node has ever
existed in this tab"* became a race against a relay dial.

**(c3) A spent control.** `#join` is disabled while `joinNow` runs and stays disabled after it
succeeds, so a press afterwards waits on a button the page has already used.

**The `signInHarnessTab` race, measured.** For the twenty-one files that never touch the DOM the
collision is *nondeterministic*, which is worse. `demo/index.html`'s reconcile tick calls
`renderEntry()` **once**, when `consent.granted` changes. A harness that grants consent and
registers in one `page.evaluate` is racing that tick against Argon2id: tick first and nothing
starts, ever; register first and the page reveals `#main` and starts a node under `o2-blocks`.
The tick period is 1 s and Argon2id is about half of that on this host. `signInHarnessTab`
removes the coin by waiting for `#signin` to be **visible** between the two calls — the page's
own evidence that `renderEntry` has already run with `unlocked` false, after which nothing
re-renders it.

### How each of the three reds was repaired, and why not otherwise

| file | what went red | repair | why not the other way |
|---|---|---|---|
| `demo-fabric` | 4 failed: 33 stopped-sentence regions carrying live figures, `#report` at a real percentage, the slider enabled, and the two-tab wait timing out at 120 s | the non-joining tab is opened with **no `?relay=`** | it could have been repaired by stopping the page's node, but a tab that has not joined *is* a tab with no relay in reach — that is the state the arm was always about, and giving discovery nothing to find is the honest version of it |
| `colouring-demo` | 2 failed: `page.click('#verify')` — *element is not visible* | it signs in through **the DOM** (`#allow` + `signInDemoTab`) rather than the API | `#run` and `#verify` live inside `#main`, and a tab signed in through the API alone leaves the entry surface on screen. Safe here and **not safe everywhere**: this page is served with no `?relay=` and this origin serves no `/bootstrap.json`, so revealing `#main` starts nothing |
| `visitor-enrolment` | 3 failed on **my own new assertion**, not on the sweep | the call-site filter excluded the declaration by name | `function requireSignIn(): string {` contains the substring `requireSignIn()` — `():` opens with it — so the filter counted the declaration as a call site and reported two where there is one. The whole enrolment journey ahead of it had already passed |

---

## `#join`: the plan predicted four fixtures keep their press. Measured, none did.

`git grep` at `42-04`'s last commit found **10** press sites. Every one was on a fixture served
with `?relay=` in its query string, so every one is now spent. **All ten were deleted**; one new
press was added, in `autostarted-switch.e2e.test.ts`, where restarting after `#stop` is
deliberately the visitor's own control.

```
$ git grep -c "click('#join')\|locator('#join').click()" c904204 -- packages/node/src packages/cloudflare/src
10
$ git grep -n "click('#join')\|locator('#join').click()" HEAD -- packages/node/src packages/cloudflare/src
HEAD:packages/node/src/autostarted-switch.e2e.test.ts:346:  await page.click('#join')
```

The plan's *"four of these fixtures serve the page from a static host with no relay, where
auto-start fails by design and `#join` is not spent at all"* is false in both halves: there were
no such fixtures among the press sites, and on a page with no relay `#join` is left **disabled**
by `revealMain`, so a press there would not have worked either.

---

## THE PLANT — one target, watched, and the half that stayed green is the finding

**Target:** `packages/browser/demo/index.html`, `renderEntry`'s gate branch. The fail-open the
plan names: skip the gate when a sealed identity is present.

```diff
-        if (state.kind === 'awaiting-consent' || state.kind === 'stale-consent') {
+        if (
+          (state.kind === 'awaiting-consent' || state.kind === 'stale-consent') &&
+          facts.stored !== 'sealed'
+        ) {
```

`git status --short -- packages/browser/demo/index.html` was empty immediately before the plant
(no concurrent writer), and `cp` took the snapshot on the same line.

**Run under the plant — `EXIT=1`, quiet host (load/core 1.30 before, 1.29 after), wall 11.63 s:**

```
 ❯ |e2e| packages/node/src/autostarted-switch.e2e.test.ts (7 tests | 1 failed) 5665ms
     × puts the gate in front of the passphrase field when the stored consent has gone 2ms
 ✓ |e2e| packages/node/src/artifact-fetch-gate.e2e.test.ts (2 tests) 3807ms
     ✓ asks the gateway for nothing at all with consent absent, and says consent is why  1643ms
     ✓ asks the gateway for the artifact once consent is granted — the floor under the zero above  1984ms
```

Verbatim failure text:

```
 FAIL  |e2e| packages/node/src/autostarted-switch.e2e.test.ts > BROW-01/BROW-06 on the auto-start
 path — the gate comes back FIRST > puts the gate in front of the passphrase field when the
 stored consent has gone
AssertionError: a returning visitor whose consent record has gone was not asked again. This is
the one path 42-04 created that could bypass BROW-01: a browser holding a sealed identity whose
owner never answered the disclosure now in force.: expected false to be true
```

**`artifact-fetch-gate` arm A stayed GREEN, and it is said plainly here rather than fixed by
widening the plant.** Two independent measured reasons, either of which alone is sufficient:

1. **Arm A's context holds no sealed identity.** It is a cold `browser.newPage()` that never
   registers, so `facts.stored` is `absent` and the planted condition is never satisfied. The
   plant cannot reach a page that has never signed in — which is exactly what arm A is.
2. **No render-level plant can move a gateway log.** `fetchModule`'s consent check is
   `requireConsent()` in `demo/main.ts`, not in `renderEntry`. The render decides what is on
   *screen*; the network gate is one call earlier and a different mechanism.

**So the ordering claim is carried in two places, and the split is worth stating because it is
easy to read as one claim.** The **render** carries BROW-01's on-screen ordering — *ask before
the passphrase field is shown* — and that is what the plant reddens, in the new
`autostarted-switch` case. The **network** gate is `requireConsent()`, and it is carried by
`artifact-fetch-gate` arm A and by `autostarted-switch`'s own gateway-log case, neither of which
any plant inside `index.html` or `signin.ts` can reach. Reaching it would need a plant in
`demo/main.ts`, which this plan's `plant_targets` does not declare and which `38-01` may be
holding.

**Restoration:** by the surgical inverse of the plant edit — the four-line `if` replaced by the
one-line `if`, in place. Never `cp`, never `git checkout --`, never `git stash`.

```
$ cmp packages/browser/demo/index.html <snapshot>
cmp EXIT=0
$ git status --short -- packages/browser/demo/index.html
(empty)
```

Two independent checks, because the hunk count is a one-way alarm and never the check.

**The assertion was strengthened BEFORE planting, and this is the third plan in a row to have to
say so.** The first draft of `autostarted-switch`'s `beforeAll` waited for `#gate` to be
un-hidden — an assertion wearing a timeout. Under the plant that wait would have expired in the
hook, every case in the file would have reported `beforeAll failed` with a bare `TimeoutError`,
and the plant record would have carried a hook timeout instead of the case's own sentence. The
hook now waits for *whichever* entry surface the page chose and records which; the assertion
carries the red.

---

## `42-03`'s "it survives `42-04`" claim — corrected, dated, not deleted

`.planning/phases/phase-42-keys-at-rest-not-in-the-clear/42-03-SUMMARY.md` gained a dated block
under the claim rather than an edit to it. The correction, in short: the **migration** half is
exactly right and this plan reads it end to end (`gated-seed` 4 of 4, `owner-domain-tabs` 1 of
1); the **conclusion** — *"so both fixtures stay green through the flip"* — is false, because
both reach identity resolution through `window.o2.start`, which throws `SignedOutError` before
the store is touched at all. The repair is one line each and it is *register first*.

The class matters more than the incident, and it is recorded there: a survival claim was made by
reasoning about the mechanism the change was *about* — identity storage — and missed a refusal
sited one call earlier, on a path with no identity in it. `42-04` recorded the same class from
the other side in the same week. Only running the fixture settles it.

---

## T-42-27 — the two credentials, and which reading was actually in reach

The plan offers two forms and asks which one the file could reach. **The stronger one is out of
reach**, measured rather than assumed: the enrolment round trip is a libp2p stream over a
WebSocket to the seed, so `page.on('request')` sees one upgrade and no frames, and a
Noise-encrypted payload would say nothing about the plaintext anyway. So
`visitor-enrolment.e2e.test.ts` takes the second form **and a storage reading beside it**:

- **The source.** `requireSignIn()` is the only way to obtain the held passphrase, and it must
  have exactly one call site. The assertion reads `demo/main.ts` off disk and requires that site
  to be, verbatim,
  `identityProtection: { kind: 'passphrase', passphrase: requireSignIn() },`.
- **What this origin actually wrote.** Every value in every object store of every database the
  tab holds, joined and searched for the passphrase — with the **positive control** the search
  needs, which is the provider's own issuer key. Without it the absence would be an absence from
  an empty dump, which is the failure `42-03`'s plant 2 already recorded once.

---

## The claims audit

**`demo/policy.html` — the clause SURVIVES, and `42-04`'s note is present beside it.** It is now
at `:221` (the plan cites `:196`; the line moved when `42-04` added the sign-in paragraphs).
Read in full:

> It runs no server-side process. It is a static file. The only infrastructure it uses is a
> relay peer, which carries the connection handshake between browsers and then drops out of the
> data path. **This survives the sign-in described above, and it survives because of it.**
> Stated explicitly so a reader does not assume the claim was overlooked when the page grew a way
> to log in: the credential is a *local passphrase*, chosen deliberately over an
> email-and-password account and over a third-party login precisely so that logging in adds no
> server, no account database and no other company. Registering here contacts nothing.

**`demo/status.html:32-35` and `:43-47` — both SURVIVE, both are page-scoped, and neither is
edited.** Quoted in full because the brief asked for a measurement rather than an assumption:

> `:32-35`, an HTML comment: *"RUN-03. Written for a volunteer who has been given nothing: no
> account, no key, no cookie. Everything on **this page** comes from `GET /self`, which is
> public, plus this page's own build stamp. **It** starts no node, runs no worker, asks for no
> permission and stores nothing — see `status.ts` for why that is not a P10 regression."*
>
> `:43-47`, visitor-facing: *"What the fabric's bootstrap objects are publishing about
> themselves, read live. Nothing **here** needs an account, a key or a cookie, and nothing on
> **this page** can change anything — the operator's write surface is not reachable from any web
> page."*

Both take *the status page* as their subject and say so in their own words — `:33` by *"Everything
on this page"* and *"It starts no node"*, `:44` by *"nothing on this page can change anything"* in
the same breath. `status.html` still starts no node, still asks for nothing and still stores
nothing; this plan changed no page source at all. **Neither goes false and neither is edited.**

**The one residual, recorded for the owner and deliberately not fixed by an agent.** A reader
could take `:44`'s *"Nothing **here** needs an account"* as *"nothing in this system needs an
account"* rather than *"nothing on this page"*. That reading is now slightly less true than it
was: the demo page asks for a passphrase. It is still not an account — no email, no password
database, no server, no third party, which is exactly what `policy.html:221` now says at
length — so the sentence is not false on any reading. Editing another phase's shipped copy on an
ambiguity nobody has complained about is scope this plan does not have.

---

## BENCH-06 — a consequence, stated, and nothing ticked

Under `writes-no-new-secret` the demo minted a fresh key each visit, so distinct peer ids counted
**visits or tabs** — which is what `BENCH-06` forbids. A sealed, reused identity restores the
per-**origin** property, and this plan has now read it on the visitor's own path:
`autostarted-switch`'s *"is the same node when it is started again"* case asserts that a stop and
a start in one visit produce an identical peer id, which could not hold before `42-04`.
`cold-start-seed-race.e2e.test.ts` (*"N tabs opening one cold origin at once hold ONE identity"*)
and `gated-seed.e2e.test.ts:60` both pin the same property from the harness side.

That puts Phase 39's zero-network machine-count bound back within reach. **It is stated as a
consequence and nothing is ticked**: `BENCH-06` is Phase 39's, and a phase that quietly closes
another phase's criterion is a phase whose gate nobody read.

---

## Lanes, exit codes and host conditions

Every `EXIT` was read on the line **immediately** after its command — no pipe, no trailing
`tail`, no `echo` between. (This shell is zsh, which has no `PIPESTATUS`; it is `pipestatus[1]`.)

| Run | EXIT | Result | `[host conditions]` |
|---|---|---|---|
| `relay-latch`, the first file swept — the approach validated before the other 36 | `0` | 3 passed | quiet — 1.03 / 1.13, wall 75.97 s |
| **36 files, each run alone** | 33×`0`, 3×`1` | see the audit table | quiet on every run; highest 3.75 before |
| the three repaired, re-run alone | `0` each | `demo-fabric` 18 passed, `visitor-enrolment` 8 passed, `colouring-demo` 8 passed | quiet |
| `autostarted-switch`, first run | `1` | 1 failed — `#state` read `working`, not `live` (below) | quiet — 2.32 / 2.23 |
| `autostarted-switch`, green | `0` | **7 passed** | quiet — 1.58 / 1.69, wall 7.43 s |
| **Plant** | `1` | 1 failed \| 8 passed — the stale-consent case red, arm A green | quiet — 1.30 / 1.29, wall 11.63 s |
| **`browser` lane, alone** | `0` | **408 files, 6741 passed** | quiet — 1.21 / 2.73, wall 166.34 s; `real 169.98 user 282.90 sys 42.18`, `(user+sys)/real` **1.91** |
| **`node` lane, alone, separate from `aot`** | `0` | **244 files, 3495 passed \| 3 skipped** | **OVERSUBSCRIBED — 2.67 before, 9.68 after.** Nothing failed, so pass/fail stands; every duration in that run is void and none is quoted |
| **`e2e` lane, whole, alone** | `0` | **64 files, 332 passed \| 0 failed \| 0 skipped** | quiet — 2.54 / 1.27, wall 1326.14 s; `real 1327.68 user 969.93 sys 223.57`, `(user+sys)/real` **0.90** |
| Whole-tree `tsc --noEmit` | `0` | clean at every step | — |
| Cheap guards, at each commit | `0` | 400 passed (400), no `O2_SKIP_GUARDS` anywhere on this branch | quiet |

### The whole-`e2e`-lane run — the verdict, and the arithmetic against `42-04`

**`EXIT=0`. 64 files passed (64). 332 tests passed (332). Nothing failed and nothing skipped.**
Host **quiet** — load/core 2.54 before, 1.27 after, ceiling 4.00 — wall clock 1326.14 s, and
from `/usr/bin/time -p`: `real 1327.68`, `user 969.93`, `sys 223.57`, so `(user+sys)/real` is
**0.90**. That ratio is a comparability key rather than a verdict: this lane spawns a Chromium,
a relay and a Vite server per file and spends most of its wall clock waiting on them, so `real`
legitimately exceeds CPU time.

The counts reconcile exactly against `42-04`'s sweep, which is the point of quoting them:

| | `42-04` | this plan | why |
|---|---|---|---|
| files | 63 (26 passed, **37 failed**) | **64, all passed** | +1: `autostarted-switch.e2e.test.ts` |
| tests | 324 (156 passed, 121 failed, **47 skipped**) | **332, all passed, 0 skipped** | +7 (`autostarted-switch`) +1 (`demo-regions`' `P1a-signin`) = 332 |
| wall | 2252.15 s | **1326.14 s** | the 926 s difference is timeouts that no longer happen — a suite failing on `waitForFunction` pays its full budget, and `owner-domain-tabs` alone was spending 180 s of it |

The 47 skips are gone because every one of them was a `beforeAll` that could not get past
`#main`: a skipped test is a test that did not run, and *"descoped is not satisfied"* applies to
a skip as much as to a scope cut.

**The first whole-lane attempt was killed by a session interruption** after three files
(`autostarted-switch` 7 passed, `ported-lift` 4 passed, `code-cache` 13 passed) and produced no
verdict. It is recorded rather than dropped, because a run that was started and did not finish is
not a run that was not started. The second attempt is the one above; it was launched detached so
an interruption could not kill it again, and it began while another agent's `cpp2rust` build held
a core — which is why the *before* figure is 2.54 rather than the ~1.0 the per-file runs saw.

### The `aot` lane was not run, and here is the reading that says it could not have moved

```
$ git diff develop..HEAD --name-only | grep -c '^tools/'
0
$ git diff develop..HEAD --stat -- tools/
(empty)
```

`vitest.config.ts` gives the `aot` project exactly one include — `tools/**/*.node.test.ts` — and
this branch changes no file under `tools/`. Re-measured on this branch rather than inherited from
`42-04`, which is what the brief asked for; the answer is the same and the command is above.

### The counts the plan asks for

```
$ git grep -c "isVisible('#main')\|waitForSelector('#main'" c904204 -- packages/node/src   # BEFORE
11   (built-bundle 2, demo-bench 1, demo-byo 1, demo-fabric 1, demo-liveness 1,
      demo-pi 1, demo-primes 1, demo-regions 1, disclosure-before-optin 2)

$ git grep -c "isVisible('#main')\|waitForSelector('#main'" HEAD -- packages/node/src      # AFTER
7    (autostarted-switch 1, built-bundle 3, disclosure-before-optin 2, e2e-signin 1)
```

Every surviving site is one where `#main` really is expected **after sign-in**, and none was
re-pointed at a running node:

- `e2e-signin.ts:1` — the helper's own final wait. It is the reason the other eight went away.
- `disclosure-before-optin.ts:2` — `:72`'s *"`#main` is not visible before consent"*, untouched,
  and a **new** one asserting `#main` is still not visible after consent alone.
- `built-bundle.ts:3` — one in the decline case (`#main` never revealed), two in the P10/BROW-01
  cases that read the page before consent.
- `autostarted-switch.ts:1` — the stale-consent reading, `#main` not visible with the gate up.

```
$ grep -rl "signInDemoTab(" packages/node/src | grep -c e2e.test.ts
17     (16 swept files + the new autostarted-switch; the plan's floor is 14)
$ grep -rl "signInHarnessTab(\|registerHarnessTab(" packages/node/src packages/cloudflare/src | grep -c e2e.test.ts
20     (21 minus colouring-demo, which moved to the DOM path — see the findings)
$ grep -rn "window.o2.autoStart" packages/node/src | wc -l
10     (9 calls + 1 mention in cold-start-seed-race's docblock)
$ grep -c "window.o2.register" packages/node/src/cold-start-seed-race.e2e.test.ts
0      # it is NOT in this sweep; a mechanical edit that put one there would be a finding
$ grep -c "gatewayLog" packages/node/src/artifact-fetch-gate.e2e.test.ts
7      # unchanged from c904204
$ grep -c "node not started" packages/node/src/artifact-fetch-gate.e2e.test.ts
5      # unchanged from c904204
$ grep -o 'data-region' packages/browser/demo/index.html | wc -l
117    # unchanged
$ grep -rn "provider stores nothing" packages/browser/demo
(nothing)
$ git diff develop..HEAD --name-only | grep -c 'vitest.config.ts'
0      # Phase 39's 39-07, untouched
```

**`autoStart` and `register`, side by side as the plan asks — and the plan's comparison cannot
be made the way it words it.** The grep returns **10** hits: nine real call sites
(`owner-domain-tabs` 2, `seed-discovery` 3, `peer-ledger`, `relay-latch`, `seed-binary-join`,
`static-rendezvous` 1 each) and one prose mention in `cold-start-seed-race`'s docblock. **All
nine are preceded by a sign-in — but the sign-in is a harness call OUTSIDE the evaluate**, not a
line inside it, because a passphrase does not cross `page.evaluate` as a closure and because the
`#signin` wait that removes the render race cannot happen inside one. So the two numbers are: **9
`autoStart` call sites, 9 preceded by `signInHarnessTab` or `signInDemoTab` in the same
function.** Counting `window.o2.register` *inside* evaluates would read **0**, and that zero is a
property of where the helper lives rather than of what the fixtures do — which is why it is
reported this way rather than as the plan's literal comparison.

### The test-file count, and a defect in the instrument the plan names

The plan asks for `find packages/*/src -name '*.test.ts' | wc -l` and says it moves by exactly
one. **That command counts directories as well as files** — `packages/*/src/**/__screenshots__/<spec>.test.ts`
are vitest browser-mode screenshot *directories*, and there are 36 of them, created and removed by
browser-lane runs. So the number it returns drifts with which browser tests last ran, and it read
**363** here against `42-04`'s 361 for that reason and not because two files arrived.

Measured with `-type f`, it moves by exactly one, and so does the tracked count:

```
$ find packages/*/src -name '*.test.ts' -type f | wc -l          → 327
$ git ls-tree -r c904204 --name-only | grep -cE '^packages/[^/]+/src/.*\.test\.ts$'  → 326
$ git ls-tree -r HEAD     --name-only | grep -cE '^packages/[^/]+/src/.*\.test\.ts$'  → 327
$ npx vitest list --project node --filesOnly | wc -l             → 244   (0 of them `.e2e.`)
```

`NODE_MEASUREMENT.files` is 242 against 244, drift 2 on a tolerance of 5, and
`slow-specs.node.test.ts` passed in every cheap-guard run. `vitest.config.ts` was not touched.

---

## Deviations from plan

**1. [Rule 3 — blocking] The worklist is 37, not the plan's 21, and `files_modified` named 25.**
The plan's Class A table also miscounts three files (`disclosure-before-optin` has one `#allow`
click, not five; `demo-viewport` has one, not two; `built-bundle` clicks `#decline` once, not
twice), and its Class B list names five files where twenty-one call `grantConsent` in an evaluate.
`42-04`'s measured list was used instead, exactly as the brief instructs. Twelve files outside
`files_modified` were swept: `background-tab`, `colouring-demo`, `computing-indicator`,
`duty-cycle-tab`, `funnel-attribution`, `funnel-live`, `gated-seed`, `hard-stop`,
`kill-switch-propagation`, `kill-switch-regions`, `many-tabs`, `tab-refusals`, `turn-end-to-end`,
`turn-fallback`, `two-tabs`, and `packages/cloudflare/src/stop-closes-the-billed-socket`.

**2. [Rule 2 — missing critical functionality] `signInHarnessTab` exists at all.** The plan says
the harness files get `await window.o2.register(E2E_PASSPHRASE)` *"in the same evaluate,
immediately after `grantConsent()`"*. Measured, that is a coin flip against the reconcile tick —
see THE FINDING. Doing what the plan says would have produced a suite that passes on this host
today and starts two nodes per tab on a slower one.

**3. [Rule 1 — bug] The plan's title reading is not enough, and `computing-indicator` already
says why.** The plan says wait for `activity()` non-null and read the title. A started-but-idle
tab carries the page's own title, deliberately. `autostarted-switch` therefore asserts the idle
title **as its own reading** and dispatches work before reading the busy one.

**4. [Rule 1 — bug] `#state` reads `working`, not `live`, at the instant a node first exists.**
Found by running: `joinNow` goes on waiting for a WebRTC address after the node is up, which is
the distinction `demo-viewport.e2e.test.ts` already records for `#bar`. Repaired as a **second**
reading rather than a relaxed one: the bar readings stay at the earlier instant, and the tone is
asserted once the join has settled.

**5. [Rule 3 — blocking] The orphan-module ceiling, 32 → 33, raised by exactly one and named.**
`e2e-signin.ts` is a new test-only module imported by relative path from specs, which the traced
graph does not walk — the same mechanism as `e2e-browser-launch.ts`, already on that list. The
cheap guard caught it at the first commit attempt and refused the commit, which is the guard
working. Barrel-exporting it was considered and rejected for `capability-fixture.ts`'s stated
reason: it would trade one honest orphan for three rows that read like unwired features.

**6. Two comment-only files updated as the plan asks.** `cold-start-seed-race.e2e.test.ts:99`
gained the sentence saying why it is **not** in this sweep (it drives `installCapabilityHarness`
with its own passphrase and never sees `#signin`), plus what `42-04` changes about why its
reading matters. `requirements-ledger.node.test.ts:1273`'s description of `visitor-enrolment`'s
choreography now says *signs in* and records that the `#join` press left.

**7. One assertion added to `demo-regions`, as the plan asks, plus its snapshot field.** `#signin`
must declare **zero** `[data-region]`; the region query is document-wide while the undeclared-text
walker is `#main`-rooted, so a region added to the entry surface later would enumerate into P1a
from outside every catalogued surface. `-1` rather than `0` when the section is missing, so an
absent `#signin` fails the reading instead of satisfying it.

---

## What this plan did NOT do

- **`AUTH-06` is not ticked.** `42-05` is the owner's checkpoint and it has not run.
- **`STATE.md` and `REQUIREMENTS.md` were not edited.** What should move is reported to the
  owner, not written by this agent.
- **Nothing was merged.** The branch is `feature/42-signin`.
- **`status.html` was not edited**, for the reason in the claims audit.
- **The `aot` lane was not run**, for the reading above.
- **No money, no deployment, no public disclosure**, and the three `ocr-checks-worker*` scripts
  are untouched (`git diff develop..HEAD --name-only | grep -c ocr-checks-worker` → 0).
