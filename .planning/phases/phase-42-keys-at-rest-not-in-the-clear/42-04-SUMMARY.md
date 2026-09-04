---
phase: 42-keys-at-rest-not-in-the-clear
plan: 04
subsystem: browser
tags: [auth-06, signin, passphrase, argon2id, disclosure, plants, expected-red]
requires:
  - "42-01's `sealWithKey` / `openWithKey` / `openSecret` / `parseSealedSecret` / `deriveSealKey` on `@o2/core`"
  - "42-02's `PASSPHRASE_MIN_LENGTH` / `WeakPassphraseError` / `assertUsablePassphrase` on `@o2/libp2p` — shared, not re-invented"
  - "42-03's `IdbIdentityStore.loadOrCreateSalt` / `loadOrMintSealedSeed`, `BrowserNodeOptions.identityProtection`, `plantLegacyIdentitySeed`"
provides:
  - "the owner's ruling of 2026-09-04, built: not logged in -> a screen explaining what this is and an invitation; logged in -> a node already running"
  - "`packages/browser/src/signin.ts` — the eight states as a pure function, with the precedence that carries BROW-01, BROW-06 and criterion 4"
  - "`#signin` on the demo page, AFTER `#gate`, with the whole entry surface DERIVED rather than flagged"
  - "`register` and `unlock` on `TabApi`, and the sealed identity on the visitor's own path — `identityProtection: { kind: 'passphrase', … }` for the first time"
  - "`unsealIdentity`, `storedIdentityKind`, `forgetIdentity` on `browser-node.ts`; `storedSeedKind`, `forgetStoredIdentity` on `IdbIdentityStore` — all OFFLINE, so a relay-less page still registers"
  - "`DISCLOSURE_VERSION` `'8'` and `policy.html` in the SAME commit as the behaviour they describe"
  - "`signin-journey.e2e.test.ts` — the whole journey off a real tab: register, reload, log in, wrong passphrase, start over, adopt, certificate"
  - "the measured expected-red list: 37 e2e files, not the plan's 21, with the mechanism for each — `42-06`'s contract"
  - "attribution: the author named on `policy.html` and on the `#signin` explainer, per the owner's instruction of 2026-09-04"
affects:
  - packages/browser/src/signin.ts
  - packages/browser/src/signin.test.ts
  - packages/browser/src/tab-api.ts
  - packages/browser/src/disclosure.ts
  - packages/browser/src/browser-node.ts
  - packages/browser/src/idb-identity-store.ts
  - packages/browser/demo/index.html
  - packages/browser/demo/main.ts
  - packages/browser/demo/policy.html
  - packages/node/src/signin-journey.e2e.test.ts
tech-stack:
  added: []
  patterns:
    - "an eight-state surface is a PURE FUNCTION plus a renderer; a page that sets a flag in eight places gets one of them wrong"
    - "a named absence is a non-empty string, so an instrument that waits for 'non-empty text' reads the absence as a reading"
    - "a refusal assertion must race the refusal against the SUCCESS it forbids, or its red is a bare TimeoutError that says nothing about what arrived"
    - "a guard's grep is part of its jurisdiction: a comment quoting a forbidden literal reddens the guard as surely as the code would"
    - "sealing inside the node-start path cannot serve a page whose visitor must sign in before a relay exists — the identity acts have to be resolvable offline"
decisions:
  - "`#signin` follows `#gate` rather than preceding it — BROW-06's arm A waits for `#gate` to be un-hidden immediately after load, and it stayed GREEN through this plan"
  - "unlock reveals `#main`; the start is ATTEMPTED afterwards and its failure is a reported state, never a blocked screen"
  - "`refused` is ordered ABOVE `unlocked` — the plan listed the reverse, and the must-not-be-reachable property it also states forces this order"
  - "`stale-consent` is decided on the consent gap ALONE — consulting the identity store to decide a consent state is the ordering inversion the precedence forbids"
  - "the surface renders `SealedIdentityUnlockError` BY CLASS NAME, inside a human sentence"
  - "only `SealedIdentityUnlockError` reaches the `refused` state, so `#signin-startover` is unreachable from a mistyped-short or mismatched passphrase"
  - "AUTH-06 is NOT ticked here: `42-06` closes the 37 files this plan leaves red, and `42-05` carries the owner's remaining decisions"
metrics:
  completed: 2026-09-04
---

# Phase 42 Plan 4: The Way In — Summary

A visitor arrives at a page that tells them what it is, chooses four ordinary words, and
their node is running — and comes back tomorrow as the same node, because those four words
are the only thing that opens the envelope this browser now holds.

**This plan ends with the `e2e` lane RED on 37 files, deliberately.** Every one of them is
listed below with the mechanism and the observed first failure, because `42-06`'s contract is
to close exactly those and no others.

---

## The ruling, and what it cost to implement honestly

The owner wrote, 2026-09-04:

> 1. when the user is not logged in, he/she should see a screen explaining what this is, and
>    an invite to login or register.
> 2. when the user is logged in, he/she should have the o2 p2p cloud node started
>    automatically.

and settled the two ambiguities: **"log in / register" means a LOCAL PASSPHRASE** — no email,
no account database, no server, no third-party identity provider — and **auto-start on unlock
with a visible switch**.

Both are built. Neither was re-opened.

---

## The two plants

Snapshot taken with `cp` **immediately before** each plant; each reversed by the **surgical
inverse of this agent's own edit** — never `cp`, never `git checkout --`, never `git stash`;
each restoration verified with `cmp` against that snapshot. Both plants went into
`packages/browser/demo/index.html`, which this plan declared as a plant target in its
frontmatter.

### Plant 1 — the silent re-mint, arriving from the UI

The `#signin-login` handler's `await window.o2.unlock(given)` wrapped so that a failure falls
through to `startOver()` + `register(given)` — a wrong passphrase quietly producing a working
tab under a new name. That is criterion 4's defect entering through a door criterion 4 was not
looking at.

`EXIT=1`, **2 failed | 6 passed**, on a quiet host (`load/core 1.89 before, 1.14 after`),
wall clock 72.99 s.

```
AssertionError: the wrong passphrase did not refuse: the start SUCCEEDED and this tab came up
as 12D3KooWHSwvYPtPJrLS25vUcrDPPYtajLYbrNXfUqFn5yXKhpLv, which it must not have — that is the
silent re-mint criterion 4 forbids, arriving from the UI instead of from the store: expected
'12D3KooWHSwvYPtPJrLS25vUcrDPPYtajLYbr…' to be null
```

**The peer id is in that message because the assertion was strengthened before the plant, not
after it.** `42-03`'s summary records the shape being avoided: a first plant whose whole
message read `expected 'not an Error: null' to be …`, which says the refusal is missing and
says nothing about what arrived instead. So the wait was rewritten to race the two outcomes —
`readRefusalOrStart` resolves on **either** the refusal text or a running node, and reports
which — and the reading is the same one a green run takes, not a plant-only path.

**The knock-on is recorded rather than treated as noise.** The T-42-24 case went red too:

```
TimeoutError: page.waitForSelector: Timeout 60000ms exceeded.
  - waiting for locator('#signin-startover') to be visible
    119 × locator resolved to hidden <button hidden="" id="signin-startover" …>
```

With nothing refusing, the `refused` state is never entered, so the control that is reachable
only from it is never revealed. That is the reachability property being read from the other
side, and it is a consequence of the plant rather than a second defect.

**`cmp` after restoration: exit `0`.** `git status --porcelain` clean.

### Plant 2 — start over reachable without the refusal

`$('signin-startover').hidden = state.kind !== 'refused'` replaced by
`$('signin-startover').hidden = false`.

`EXIT=1`, **1 failed | 7 passed**, quiet host (`load/core 0.98 before, 0.96 after`), wall
clock 13.10 s.

```
AssertionError: the control that destroys this visitor’s identity was on screen before
anything had refused to open: expected true to be false // Object.is equality
```

**`cmp` after restoration: exit `0`.**

Neither plant left the file green. Both were watched failing.

---

## The exact wording a visitor is shown

Quoted verbatim, because the plan asks a reader to be able to judge whether the visitor was
actually told what it costs.

**The refusal — and the answer to the plan's question is: the surface renders the class name,
INSIDE a human sentence.** Both, deliberately: the sentence is for the visitor, and
`SealedIdentityUnlockError` is the one word a visitor can search for and a guard can match on,
so hiding it would leave the two describing different things.

> That passphrase did not open the identity stored in this browser
> (SealedIdentityUnlockError). Nothing has been changed and nothing has been lost — your
> identity is still here, exactly as it was. Try again; it is case-sensitive.

**The start-over cost**, revealed in the `refused` state and nowhere else:

> Starting over makes you a different node. The identity in this browser is deleted and cannot
> be brought back — not by us and not by anyone. There is no server here and no account, and
> the only party that has ever seen anything of yours is an enrolment provider, which saw a
> signature made with the public half of your key and never the private half and never your
> passphrase. So there is nothing anywhere to recover from and no support channel to ask. If
> you had joined a provider you would have to enrol again, and the signed statement they gave
> your old key would no longer name you.

That is the sentence this repository can now **justify** rather than assert. The e2e case
asserts all three clauses separately — *different node*, *enrol again*, *why nobody can undo
it* — so a rewrite that dropped one fails naming which.

**The explainer, `#signin-why`:**

> There is no account here. No email, no password database, no server and no other company:
> the passphrase you choose never leaves this page. It is what keeps the identity this browser
> holds — the name other participants know you by — readable only by you, so that losing this
> device does not hand it to whoever finds it. It is held for this visit only and asked for
> again next time. If you later choose to join a provider, that is a separate step and **the
> provider never sees your private key**.

The unconditional form, which is what `enrollment.ts:44-47` guarantees. The page nowhere
claims a provider retains nothing — that is true only of a provider run without a
`blockstoreDir`, and a claim a visitor cannot check must not be made.

---

## What `DISCLOSURE` version 8 says, and what went false in version 7

Version 7 told a visitor:

> That key is the name other participants know you by while the work runs, and this page makes
> a fresh one each visit and does not keep it — so two visits are two different nodes rather
> than one, and nothing joins them together.

**Every clause of that is now false for a registered visitor**, and the last one is false in
the direction that matters most: it told somebody they were unlinkable across visits, and they
are not. It remains **true for a visitor who has not registered**, because nothing runs and no
key is made until they do — so version 8 states both, in the order a visitor meets them.

Three answers moved and all three had to:

- ***Does this page remember me?*** — rewritten. Nothing runs and no key is made until you
  register or log in; the key is then stored in this browser **encrypted** under a passphrase
  you choose; the passphrase is held for one visit and written nowhere; nobody can send it
  back to you and the page offers to start you over as a different node instead; and the
  carry-over is now *sealed in place* rather than *kept and reused* — a key an earlier build
  left here in the clear becomes the same key, encrypted, so the visitor keeps the node they
  already were.
- ***How do I stop it?*** — its last clause said starting again *"begins it under a new node
  key"*. That was version 7's consequence and is now false. It says the same node comes back,
  and adds that closing the tab is what makes the page forget the passphrase.
- ***What leaves my device?*** — **checked and unchanged**, and the check is reported because
  the plan asks for it. Its *"no identifiers beyond the key named below"* clause is still true:
  what leaves is still that key and nothing else. What changed is that it is the same key next
  time, which the answer below it now states.

`CONSENT_VERSION_NOTE` says what version 7 said, why it went false, and what the visitor gets
instead. `demo/policy.html` was mirrored **in the same commit** (`dc82351` — `git show --stat`
lists both), and the static-file clause gained one sentence recording that *"It runs no
server-side process. It is a static file"* **survives this change and survives because of
it**: the owner ruled a local passphrase precisely so that logging in adds no server, no
account database and no third party.

This is the **fourth** bump of this kind (v1→2, v4→5, v6→7, v7→8). The parallel is stated in
the file rather than left for a reader to notice a fourth time.

---

## `consent.test.ts` flipped branch unaided

The plan predicted it and the run is the evidence, not the reading:

```
npx vitest run --project node packages/browser/src/signin.test.ts packages/browser/src/consent.test.ts
✓ consent.test.ts (24 tests)   ✓ signin.test.ts (13 tests)
Tests  37 passed (37)          EXIT=0
```

**No edit was made to `consent.test.ts`.** Its case reads `demo/main.ts`'s **raw source** for
exactly one `identityProtection` arm and demands whichever disclosure sentence that arm owes;
the demo flipped from the no-new-secret arm to the passphrase arm, and the case took the other
branch by itself.

That guard's jurisdiction is raw source, so the retired literal had to disappear from the file
**including from comments**. The rewritten paragraph above the arm therefore **paraphrases**
the old value rather than quoting it:

```
grep -c "identityProtection: { kind: 'writes-no-new-secret' }" packages/browser/demo/main.ts  ->  0
```

unfiltered, comments included.

---

## What landed

### `packages/browser/src/signin.ts` — the eight states as a pure function

No DOM, no storage, no side effect at import. `signinState` is total over its input, and the
**precedence is the whole point**:

| # | branch | why it is where it is |
|---|---|---|
| 1 | `declined` | declining writes **no** consent record, so every branch below would read this visitor as *never asked* and put the gate back in front of somebody who just dismissed it |
| 2 | `stale-consent` | the terms or the anchors moved under a stored consent |
| 3 | `awaiting-consent` | never asked, or an unreadable store |
| 4 | `refused` | **criterion 4 written as an ordering** — a wrong passphrase must never be overtaken by a stale `unlocked` flag |
| 5 | `unlocked` | reveals `#main`. **Not** "a node is running" |
| 6 | `login` / `adopt` / `register` | what is in the store decides which invitation is shown |

`signin.test.ts` **enumerates** the two must-not-be-reachable orderings rather than exampling
them — 24 combinations for the stale-consent one, 6 for the refusal one, each with a floor
assertion on the loop count so an enumeration that stopped early fails instead of passing by
asserting nothing.

### The `#signin` section

A sibling of `#gate` and `#main`, placed **immediately after `#gate`** — and BROW-06's guard
stayed green through the whole plan, which is the measurement that arrangement rests on. Ids,
all load-bearing for `42-06`: `#signin-headline`, `#signin-why`, `#signin-passphrase`,
`#signin-passphrase-again`, `#signin-register`, `#signin-login`, `#signin-status`,
`#signin-startover`, `#signin-startover-cost`, plus two beyond the plan's list —
`#signin-adopt` (the standing notice the `adopt` state needs, which the plan describes but does
not name) and `#signin-author` (the attribution).

The section carries **no** UI-SPEC region. `grep -c 'data-region' packages/browser/demo/index.html`
reads **117 before and 117 after**, and `grep -o 'data-region' … | wc -l` reads 117 both ways
too. The comment at the section explains why the attribute's literal spelling is not written
out in it: that count is asserted unmoved, and a prose mention would move it. It did, on the
first draft — 119 — and the comment was reworded rather than the criterion reinterpreted.

The Phase 38 contract is written at the section, naming `38-01-PLAN.md` and `#entry-notice`:
this is `#signin` and not `#entry` because a shared prefix is a collision a reader makes even
where a selector does not; the notice is about **where the page is open** and this is about
**who is using it**; it renders above and never replaces.

### Register and unlock resolve offline, and that is a correctness requirement

`unsealIdentity` on `browser-node.ts` composes the **same** `resolveProtectedSeed` that
`BrowserNode.start` composes — same store, same `sealedUnderSameKey` / `openWithKey` /
`openSecret` order — and stops before libp2p exists. Every act is an IndexedDB act.

The reason is measured, not preferred: sealing otherwise happens inside the node-start path,
and four e2e fixtures serve this page from a static host with **no relay**. If registering
could only seal by starting, the page would be unreachable behind its own entry screen on
every one of them. So the sequence is **open the envelope → reveal `#main` → attempt the
start**, and a start that fails paints `#state` `'blocked'` exactly as it does today while the
visitor stays signed in. *"Started automatically"* is the whole of that: no further click
after unlock, and never a silent start on load.

`whenAbsent` is the difference between the two controls: **register** mints and seals,
**log in** refuses. A login that quietly created an identity would turn a visitor whose browser
had been cleared into a *new* node wearing the same intention.

### The passphrase, held for one visit

One module-scoped variable in `demo/main.ts`. Never `localStorage`, never `sessionStorage`,
never IndexedDB, never a URL, never a log, never the funnel's payload.

```
grep -n "passphrase" packages/browser/demo/main.ts \
  | grep -ci "localStorage\|sessionStorage\|setItem\|funnel\|console\.log"   ->  0
```

`requireSignIn()` throws `SignedOutError` when it is empty, and **there is no fallback arm**.
Falling through to the no-new-secret arm would be the silent re-mint criterion 4 forbids,
arriving from the UI instead of from the store.

`autoStart` grew **no** passphrase parameter, on this file's own standing rule — *a page that
was found rather than configured must not be configurable by whatever found it*. The value
comes from the visitor, at the surface they are looking at, and can come from nowhere else.

### Registering is not enrolling

Written as a table in the code at the `identityProtection` line, because two words that both
mean *sign up* in English name two unrelated acts here: this authenticates a **person** to
**their own browser** with a passphrase held in page memory; enrolment authenticates a **node**
to a **provider** with a key pair this script cannot read. **Neither credential may reach the
other**, and nothing on the sign-in path calls into `packages/core/src/enrollment.ts`.

### Attribution — the owner's instruction of 2026-09-04

Executed in the two places named, and nowhere else. `demo/policy.html` carries it near the top
in its own box, where a blocklist reviewer reaches it before the technical sections — for that
reader, *a named person with a public profile stands behind this* is the missing reassurance.
The `#signin` explainer carries one line. Both are plain factual attributions with no
endorsement framing and no third-party badge, widget or image.

`README.md` was **not** touched, as instructed — and the attribution landed there on `develop`
during this session, by another agent (`38f1e56`).

`DISCLOSURE`'s *"Whose work is it?"* was **not** touched. That line answers *whose compute job
is running on this visitor's machine right now*; a fixed author name there would make the
disclosure false in exactly the way versions 1, 4, 5 and 6 were each bumped to repair.

**The link is not a request**, and it was measured rather than reasoned about:
`built-bundle.e2e.test.ts`'s *"makes no request to any origin but its own, over the whole
request set"* **passed** in the full sweep below, on the built bundle, with the link present.
A comment at each site says nothing may turn it into a `preconnect`, a `prefetch`, a
`dns-prefetch` or an image.

---

## THE EXPECTED RED — 37 files, not 21, and the miscount has a named cause

**This is `42-06`'s input.** A file that greens for a reason other than the one predicted here
is a finding, not a relief.

Measured by one full `e2e` sweep, `EXIT=1`, **37 failed | 26 passed (63 files)**,
**121 failed | 156 passed | 47 skipped (324 tests)**, on a quiet host
(`load/core 1.09 before, 0.98 after`), wall clock 2252.15 s.

### The plan said 21. The arithmetic reproduces, and so does the cause of the gap

The plan's grep found *"16 e2e files click `#allow`"* plus *"5 further files that call
`window.o2.grantConsent()` and `window.o2.autoStart(...)`"*. Both counts are right. What it
missed is the **`grantConsent` + `window.o2.start(...)`** cohort: the `identityProtection` line
lives inside `api.start`, and `autoStart` reaches it *through* `start`, so `SignedOutError`
hits every file that starts a node through the demo page whether or not it names `autoStart`.

**That is the identical failure class `42-03` recorded one wave earlier** — *"a grep over an
option cannot enumerate the callers that reach it through a page's own API and never name
it"* — and the plan repeated it. The enumerator that can see them is the lane itself, which is
also `42-03`'s conclusion. The plan's 21 was an estimate; the 37 below is a measurement.

### Mechanism (a) — `#allow` no longer reveals `#main`

The gate now reveals `#signin`. A spec that clicks `#allow` and waits for `#main`, `#join` or a
`#state` tone times out. **14 files.**

| file | failed | observed first failure |
|---|---|---|
| `artifact-fetch-gate.e2e.test.ts` | 1 of 2 | `TimeoutError: page.waitForFunction` at `:233`, on `#main` un-hidden after `#allow`. **Arm A — *no artifact bytes before consent* — PASSED**, which is the constraint that decided where `#signin` goes |
| `attestation-ui.e2e.test.ts` | 8 of 8 | `TimeoutError: page.waitForFunction` in `openPage` at `:344`, `#main` after `#allow` |
| `built-bundle.e2e.test.ts` | 2 of 9 | `TimeoutError: page.waitForFunction` in `consent` at `:113`, `#main` after `#allow`. **The bundle BUILDS — 7 of 9 passed, including both no-foreign-request cases** |
| `demo-bench.e2e.test.ts` | 6 skipped, `beforeAll` failed | `TimeoutError: page.waitForSelector … waiting for locator('#main') to be visible`, at `:138` after `page.click('#allow')` |
| `demo-byo.e2e.test.ts` | 17 of 17 | `TimeoutError: page.waitForSelector … locator('#main') to be visible` |
| `demo-fabric.e2e.test.ts` | 9 skipped of 18 | `TimeoutError: page.waitForSelector … locator('#main') to be visible` |
| `demo-liveness.e2e.test.ts` | 6 skipped, `beforeAll` failed | same, in `openTab` at `:200` |
| `demo-pi.e2e.test.ts` | 10 of 10 | `TimeoutError: page.waitForSelector … locator('#main') to be visible` |
| `demo-primes.e2e.test.ts` | 14 skipped, `beforeAll` failed | same, at `:248` |
| `demo-regions.e2e.test.ts` | 9 skipped of 18 | `TimeoutError: page.waitForSelector … locator('#main') to be visible` |
| `demo-viewport.e2e.test.ts` | 7 of 7 | `TimeoutError: page.waitForFunction` in `openAt` at `:301`, `#main` after `#allow` |
| `disclosure-before-optin.e2e.test.ts` | 1 of 1 | `TimeoutError: page.waitForFunction` at `:122` — this file also exercises the **decline** path, whose landing surface changed from `#main` to `#signin` |
| `quorum-ui.e2e.test.ts` | 4 of 4 | `TimeoutError: page.waitForFunction` in `openEnrolledTab` at `:367` |
| `visitor-enrolment.e2e.test.ts` | 6 of 8 | `TimeoutError: locator.waitFor … waiting for locator('#enrol-offer') to be visible` — `#enrol-offer` lives inside `#main`, which is never revealed |

### Mechanism (b) — `SignedOutError` from `window.o2.start` / `autoStart`

A harness that grants consent in a `page.evaluate` and then starts a node has not signed in.
**23 files.** Every one reports the same refusal, verbatim:

> `page.evaluate: SignedOutError: nobody is signed in on this page: register with a passphrase
> or log in with the one you chose. Starting a node without one would mint an identity this
> browser cannot open again, which is a different node under the same name`

| file | failed |
|---|---|
| `background-tab.e2e.test.ts` | 3 of 3 |
| `colouring-demo.e2e.test.ts` | 8 of 8 |
| `computing-indicator.e2e.test.ts` | 3 of 3 |
| `duty-cycle-tab.e2e.test.ts` | 6 of 6 |
| `funnel-attribution.e2e.test.ts` | 3 of 6 |
| `funnel-live.e2e.test.ts` | 2 of 2 |
| `gated-seed.e2e.test.ts` | 3 of 4 |
| `hard-stop.e2e.test.ts` | 1 of 1 |
| `kill-switch-propagation.e2e.test.ts` | 1 of 1 |
| `kill-switch-regions.e2e.test.ts` | 1 of 1 |
| `kill-switch-volunteer.e2e.test.ts` | 1 of 2 |
| `many-tabs.e2e.test.ts` | 1 of 1 |
| `owner-domain-tabs.e2e.test.ts` | 1 of 1 — surfaces as `TimeoutError: page.waitForFunction` (180 s) in `openEnrolledTab` at `:307`, because the start it is waiting on is the one that throws |
| `peer-ledger.e2e.test.ts` | 6 of 7 — surfaces as `AssertionError: expected [ …(3) ] to deeply equal []`, the three engines' exclusion reasons, each quoting the refusal |
| `relay-latch.e2e.test.ts` | 3 skipped, `beforeAll` failed in `openPeer` at `:119` |
| `seed-binary-join.e2e.test.ts` | 1 of 2 |
| `seed-discovery.e2e.test.ts` | 3 of 9 |
| `static-rendezvous.e2e.test.ts` | 5 of 5 — same `AssertionError: expected [ …(3) ] to deeply equal []` shape as `peer-ledger` |
| `tab-refusals.e2e.test.ts` | 3 of 3 |
| `turn-end-to-end.e2e.test.ts` | 2 of 2 |
| `turn-fallback.e2e.test.ts` | 4 of 5 |
| `two-tabs.e2e.test.ts` | 6 of 6 |
| `packages/cloudflare/src/stop-closes-the-billed-socket.e2e.test.ts` | 1 of 1 — **the one file outside `packages/node/src`**, and the plan's blast-radius grep did not look there |

### `42-03`'s claim that its repair "survives 42-04" is FALSE, and this is where it is recorded

`42-03` re-drove `gated-seed` and `owner-domain-tabs` with `plantLegacyIdentitySeed`, arguing
*"a legacy seed under a future passphrase is migrated in place with the same peer id, so both
fixtures stay green through the flip."* The migration half of that is true and this plan's
adopt case reads it end to end. The **conclusion** is false: those fixtures reach identity
resolution through `o2.start`, which now throws `SignedOutError` **before the store is
touched**, so the plant is never consulted. `42-06`'s fix is to make them register first —
after which the planted seed is adopted exactly as `42-03` predicted, and the coverage it
added survives.

### Files that PASSED and are named so their green is auditable too

`cold-start-seed-race` (capability harness — `42-03` re-drove it for this reason),
`gated-admission`, `tab-pinning`, `browser-enrollment`, `aot-tab`, `browser-capability`,
`admission-slices`, `checkpoint-coordinator`, `code-cache`, `ported-lift`, `sovereign-agent`,
`libsodium-absence`, `ice-servers-alive`, `x509-bundle`, `relay-service-journal`,
`funnel-collector`, `hosted-record-store`, `hosted-rendezvous`, `inbound-listener`,
`refused-write-does-not-poison`, `turn-credential`, `turn-sharding`,
`packages/libp2p/src/relay-service-log`, `packages/libp2p/src/traffic-split`,
**`lease-expiry`** (2 of 2 — `42-03`'s documented flake did not fire in this sweep), and
**`signin-journey`** itself.

---

## Lanes, exit codes and host conditions

Every `EXIT` was read on the line **immediately** after its command — no pipe, no trailing
`tail`, no `echo` between. (This shell is zsh, which has no `PIPESTATUS`; it is
`pipestatus[1]`.)

| Run | EXIT | Result | `[host conditions]` |
|---|---|---|---|
| RED, `signin-journey` before the surface existed | `1` | 5 failed — *"waiting for locator('#signin') to be visible"* | quiet — 1.57 / 1.34, wall 125.98 s |
| `signin.test.ts`, node lane | `0` | 13 passed | quiet — 1.17 / 1.17 |
| `signin.test.ts` + `consent.test.ts`, node lane | `0` | **37 passed** — the evidence `consent.test.ts` flipped unaided | quiet — 0.96 / 0.94 |
| **`browser` lane over `packages/browser/src`** | `0` | **84 files, 951 passed** | quiet — 0.90 / 1.64, wall 35.18 s |
| `signin-journey`, first implementation run | `1` | 2 failed — the named-absence reader (deviation 1) | quiet — 1.50 / 1.43 |
| `signin-journey`, green | `0` | 5 passed | quiet — 1.26 / 1.23 |
| `signin-journey` with task 3's cases | `0` | **8 passed** | quiet — 1.61 / 3.30 |
| `signin-journey` after the assertion was strengthened | `0` | 8 passed | quiet — 2.78 / 2.33 |
| Plant 1 | `1` | 2 failed \| 6 passed | quiet — 1.89 / 1.14, wall 72.99 s |
| Plant 2 | `1` | 1 failed \| 7 passed | quiet — 0.98 / 0.96, wall 13.10 s |
| `vocabulary.node.test.ts` after the fix | `0` | 25 passed | quiet — 0.74 / 0.74 |
| **Cheap guards, at each of the three commits** | `0` | **400 passed (400)** every time, no `O2_SKIP_GUARDS` anywhere on this branch | quiet |
| **`node` lane, full, alone** | `0` | **244 files, 3496 passed \| 2 skipped** | **OVERSUBSCRIBED — 0.74 before, 6.17 after.** Nothing failed, so pass/fail stands; every duration in that run is void and none is quoted |
| **`e2e` lane, full** | `1` | **37 failed \| 26 passed (63)** — the expected red, enumerated above | quiet — 1.09 / 0.98, wall 2252.15 s |
| Whole-tree `tsc --noEmit` | `0` | clean at every step after the RED | — |

### The `aot` lane was not run, and here is the reading that says it could not have moved

```
$ git diff develop..HEAD --name-only | grep -c "^tools/"
0
$ git diff develop..HEAD --stat -- tools/
(empty)
```

`vitest.config.ts` gives the `aot` project exactly one include — `tools/**/*.node.test.ts` —
and this branch changes no file under `tools/`. `42-03`'s precedent, with the same measurement
and the same stated cost (~20 minutes serialised) for anybody who wants it green anyway.

### The node lane's file count

`find packages/*/src -name '*.test.ts' | wc -l` read **360 before and 361 after** — it moved by
exactly one, `signin-journey.e2e.test.ts`. The `node` project's own count moved by one too, to
**244**, because `signin.test.ts` matches `packages/*/src/**/*.test.ts` in both the `node` and
`browser` projects. `slow-specs.node.test.ts` stayed green at every commit (it is one of the
nine cheap guards, 400/400 each time) and `vitest.config.ts` was **not touched** — it belongs
to Phase 39's `39-07`.

---

## Deviations from plan

**1. The peer-id reader read a NAMED ABSENCE as a reading, and the case reported it as a
mismatch.** The first implementation run failed with
`expected 'No peer id: this tab has not joined.' to match /^12D3Koo/`. The page writes the
`session/peer-id` region only after `waitForWebrtcAddr` resolves, seconds after the node is up;
until then the region holds its named-absence sentence, which is a **non-empty string**. The
reader waited for *"non-empty"* and got the absence. It now reads
`window.o2.addresses().peerId`, and the failure is recorded at the function so the next person
does not re-introduce it. This repository uses named absences instead of blanks everywhere, so
this is a class rather than an incident.

**2. `refused` is ordered ABOVE `unlocked`; the plan lists the reverse.** The plan's own
must-not-be-reachable property — *"a `refused` input must not produce `unlocked`"* — cannot
hold under its stated order. The dangerous direction is a wrong passphrase arriving at a
running node, so the refusal wins. The cost is named in the docblock rather than hidden: a page
that forgets to clear `refusal` after a successful unlock strands its visitor on the refusal
screen — and the criterion-4 case enters the wrong passphrase and then the right one on the
same page, which is exactly the reading that catches it.

**3. `stale-consent` is decided on the consent gap ALONE.** The plan's table conditions it on a
sealed record being present. Consulting the identity store to decide a *consent* state is the
ordering inversion the precedence exists to forbid, and the page has distinguished the two gaps
in its gate copy since before this module existed without knowing anything about an identity.
Both states render `#gate`, so the difference is only what the gate may say.

**4. `declined` is evaluated FIRST, ahead of the consent gaps.** Under the plan's literal order
it is unreachable: declining writes no consent record, so `readConsent` reports `never-asked`
and `awaiting-consent` would win every time. It is a **consent** fact, not an identity one, so
the precedence the plan actually states — *consent before anything about identity* — is
unbroken.

**5. `autocomplete` is set per mode in JavaScript rather than fixed in the markup.** The plan
says the two inputs carry `new-password` and `current-password` *"respectively"*, which would
put `current-password` on the **confirmation** field — a field that only ever appears while
choosing a NEW passphrase, and the wrong hint for a password manager. One field serves both
modes, so `#signin-passphrase` is `new-password` while registering and `current-password` while
logging in, and `#signin-passphrase-again` is `new-password`. Both values are present in the
page and each names the act it describes.

**6. Only `SealedIdentityUnlockError` reaches the `refused` state.** A passphrase under the
length floor, two fields that do not match, and a login against an empty database are reported
in `#signin-status` and leave the state alone. Otherwise **`#signin-startover` would be
revealed to somebody who mistyped once**, which is the failure T-42-24's own wording warns
about, and plant 2's property would be true by accident rather than by design.

**7. Seven exports and two element ids beyond the plan's list.** Deviation rule 3 — each is
something the surface cannot be built without:

- `unsealIdentity`, `storedIdentityKind`, `forgetIdentity` on `browser-node.ts`;
  `storedSeedKind`, `forgetStoredIdentity` on `IdbIdentityStore`. The first exists because
  sealing lived inside the start path (see above); the others because the page must know which
  invitation to show *before* a passphrase is typed, and because start-over must destroy an
  identity in one transaction. **None is on `packages/browser/src/index.ts`'s barrel**, which
  is deliberate: `reachability-guard.node.test.ts`'s jurisdiction is barrel exports, and a
  symbol whose only caller sits inside the `window.o2` literal reads as unreachable. `demo/main.ts`
  imports them relatively, on the rule that file already states at `IdbCheckpoints`.
- `signinFacts` and `startOver`, exported from `demo/main.ts` for `index.html`'s inline script.
  `TabApi` grew **exactly** the two methods the plan's `<interfaces>` block names. These are the
  page reading and driving its own module — the same relationship it already has with
  `./nav.ts` and `./surfaces/*.ts` — and a harness driving start-over clicks the control the
  visitor clicks.
- `#signin-adopt` (the standing notice the `adopt` state needs, which the plan describes and
  does not name) and `#signin-author` (the attribution).

**8. Two comments were reworded because a guard's grep is part of its jurisdiction.** The
`data-region` count moved 117 → 119 on prose mentions in a new comment, and the
`stores nothing` grep hit a comment forbidding that exact phrase. Both were reworded rather
than the criteria reinterpreted: the count is now 117 both ways and the phrase grep returns
nothing.

**9. `vocabulary.node.test.ts` reddened on a banned word inside one of this plan's own
comments.** The word is the one that spelling-of-a-region-attribute sentence used for *"the
thing itself"*, and it is described rather than quoted here **because quoting it reddens the
same guard against this summary** — which it did, on the first attempt to commit this file, and
the second reword is recorded for the same reason the first is. `MEMORY.md` carries the class
from `42-03`: *a green you did not watch fail is worse than a gap you reported*, and its
sibling, *a guard is reddened by a word in your own docblock*. The comment now says *"its
literal spelling"*; the guard reads 25 passed, `EXIT=0`.

**10. The branch base moved under this agent mid-session.** The brief cites `develop` at
`d3bfe47`. A concurrent agent advanced it to `5415ef9` (`6963da9` *merge: name the author in
README*, `cdf642c` *the consent gate is this demo's policy*) and, in doing so, left the shared
working tree checked out on `develop` with this plan's first file staged. `feature/42-signin`
was reset onto `5415ef9` before the first commit, so **the actual base is `5415ef9`, not
`d3bfe47`**. Neither incoming change touches a file in this diff.

**11. The certificate case plants a certificate rather than enrolling for one.** The plan says
*"if the fixture enrolled one"*; this fixture stands up no provider. What is read is criterion
1's deliberate exemption — that sealing the seed leaves the certificate record untouched and
readable — and `resolveCertificate` returns `null` before touching the store when no enrolment
is configured, so the planted record is inert during the start. `browser-enrollment` and
`visitor-enrolment` are where a provider actually signs one.

---

## The open product question, for the owner and decided by nobody here

**The workload surfaces are now behind a twenty-character passphrase.** A visitor arriving from
a Telegram link meets a consent gate, then a form asking for four ordinary words, before they
see the thing they came for. For a cohort that is **spendable exactly once**, that is a
conversion cliff, and nothing in this plan measures how steep it is.

The floor itself is not the question — it is 20 because the attacker is offline with a disk
image and Argon2id prices a guess at roughly two per second per core, and because
`identity-protection.ts` exists so the two tiers cannot disagree about what protects the same
class of secret. The question is whether there should be a **look-around path**: a way to see
the page working without registering.

There is deliberately none today, for two reasons. The ruling names two states, not three, and
a third state every visitor would take is the ruling reversed while claiming to implement it.
And `consent.test.ts` requires **exactly one** `identityProtection` arm in `demo/main.ts` — a
guest arm would put both in the file and the case would report a page that had *silently chosen
a branch*.

If the owner wants one, it is a cheap follow-up against a surface that now exists. **State it;
do not decide it.** `42-06`'s summary carries it forward.

---

## What this plan does NOT claim

- **AUTH-06 is not ticked.** 37 e2e files are red by design and `42-06` closes them; `42-05`
  carries the owner's remaining decisions. A requirement whose lane is red is not met.
- **`STATE.md`, `ROADMAP.md` and `REQUIREMENTS.md` were not touched**, per the brief. What
  should move is reported to the orchestrator rather than written here.
- **Nothing is merged.** `42-06` continues on this same branch and the two merge together.
- **The passphrase protects nothing while the node is running.** libp2p holds the seed in
  memory for Noise, and design §3.9 names the gap: *"derivation moves the risk from at-rest to
  at-use — the enclave closes that gap"*, and a tab has no enclave. T-42-26, accepted.

---

## Self-Check: PASSED

Files claimed created, verified present: `packages/browser/src/signin.ts`,
`packages/browser/src/signin.test.ts`, `packages/node/src/signin-journey.e2e.test.ts`, this
summary. Commits claimed, verified in `git log`: `f65fd0c`, `dc82351`, `7ad7eca`.
