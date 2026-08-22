# Sizing the enrolment rate limiter before stable user keys ship

**Date:** 2026-08-18
**Task:** #22 — *Size the enrolment rate limiter before shipping stable user keys*
**Status:** analysis complete; **no default changed** (see *What was deliberately not done*)
*(SUPERSEDED 2026-08-22 — the default **was** changed, six hours after this file was committed:
`DEFAULT_MAX_PER_WINDOW = 32` at `packages/core/src/enrollment.ts:803`, landed in `20f7f7c`
2026-08-18 00:41:45 against this file's only commit `78c801f` 2026-08-17 18:21:16. See the
ADOPTED amendment at the foot.)*

---

## The question

Security constraint 4: `EnrollmentAuthority`'s per-user limiter keys on `request.userKey` and
**has never fired**, because a per-tab user key is random today. A stable per-passphrase
`userKey` (task #21) makes it live for the first time, shared across every tab, device and
browser profile of one owner. The task's stated worry:

> one person opening `maxPerWindow + 1` tabs gets rate-limited — a functional regression, not
> a security one.

Three deliverables were asked for: compute the blast radius from the configured numbers, check
whether the persisted-certificate reuse path absorbs most of it, and pick a defensible
`maxPerWindow`.

---

## 1. The configured numbers, read from the tree

| knob | value | site |
|---|---|---|
| `maxPerWindow` | **5** *(SUPERSEDED — 32; see the amendment below)* | `packages/core/src/enrollment.ts:878` (`?? 5`) |
| `windowMs` | **3 600 000 ms — 1 hour** | `:880`, from `DEFAULT_ISSUANCE_WINDOW_MS` at `:759` |
| `certificateLifetimeMs` | **30 days** (`30 * 24 * 3_600_000`) | `:881` |
| `maxIssuedPerWindow` | **caller-supplied, no default** | `:879`; `fabric-node.ts:2244` |

### AMENDED 2026-08-22 — this table is the reading of 2026-08-17 18:21, and the tree has moved

`20f7f7c` (2026-08-18 00:41:45, six hours after this file's only commit `78c801f`,
2026-08-17 18:21:16) raised the per-user default to `DEFAULT_MAX_PER_WINDOW = 32`, declared at
`packages/core/src/enrollment.ts:803` and read once at `:926`
(`options.maxPerWindow ?? DEFAULT_MAX_PER_WINDOW`). There is no `?? 5` anywhere in that file
today, and the cited `:878` is now prose inside the `x509` option's docblock rather than a
default site. The rest of the column drifted with it: `windowMs` `:928` (still
`DEFAULT_ISSUANCE_WINDOW_MS` at `:759`), `certificateLifetimeMs` `:929`, `maxIssuedPerWindow`
declared at `:838` and read at `:927`, passed from `fabric-node.ts:2265`. Re-read with
`grep -n 'DEFAULT_MAX_PER_WINDOW' packages/core/src/enrollment.ts`.

The table is left as it was rather than back-edited, because §6 and §7's derivation is what it
feeds and the 5 is what that derivation argues against.

Neither `bin/agent.ts` nor `bin/seed.ts` overrides the first two, and `fabric-node.ts:2209`
records that as a decision rather than an oversight — *"a knob nobody sets is a knob that drifts
from the tests."* The aggregate budget is the one an operator does set: `bin/agent.ts:927` reads
`--max-issued-per-window`, and `bin/bench.ts:1310` passes
`'issues-without-an-aggregate-budget'`.

**So the standing policy is 5 certificates per user key per hour, and a certificate lives 720
windows.** *(SUPERSEDED 2026-08-18 — 32 per hour since `20f7f7c`. The 720-window certificate
lifetime is unchanged, at `enrollment.ts:929`.)*

---

## 2. The reuse path absorbs the steady state completely

`resolveCertificate` (`packages/browser/src/browser-node.ts:629-636`) returns a persisted,
unexpired certificate **and does not contact the provider at all**. The gate is
`peerIdForNodeKey(loaded.nodeKey) === identity.peerId && loaded.expiresAt > Date.now()` — bound
to the *node* seed, not to the user key.

A certificate lasts **30 days = 720 one-hour windows**, so a returning visitor consumes zero
issuances in 719 of every 720 hours.

## 3. The unit of consumption is a node identity, not a tab

IndexedDB is per-origin, and this repository already records the consequence:
`static-rendezvous.e2e.test.ts:38` lists `context.newPage()` ×2 on one context as sharing **one
storage backend** — that is precisely why that file uses separate engine launches instead. So
N tabs of one browser profile share one `o2-blocks-identity` database, hence one seed, hence one
certificate.

**The task's premise does not hold in steady state.** Opening `maxPerWindow + 1` tabs of one
profile consumes **one** issuance, not six — the first tab enrols and the rest reuse. This is
the answer to *"does the persisted-certificate reuse path absorb most of it?"*: **yes, nearly
all of it.**

---

## 4. Where it does bind: the cold-start burst

`browser-node.ts:1304-1310` is:

```
const stored = await identityStore.loadSeed()
if (stored !== null)            seed = stored
else if (whenSeedIsGone === 'mints-a-new-identity') {
  seed = generateSeed()
  await identityStore.saveSeed(seed)
}
```

**There is no lock, no transaction and no cross-tab coordination between the read and the
write.** N tabs opening simultaneously against a *fresh* profile each read `null`, each mint a
distinct seed, and each go on to enrol separately — because each one's `loadCertificate()` finds
nothing naming *its* seed. With `maxPerWindow` at 5, the sixth simultaneous cold tab is refused.

**This is a structural reading of unlocked code, not a runtime measurement, and it is labelled
that way on purpose.** No runtime witness exists and none can be taken today, because no default
path passes `enrollment` at all — which is the same fact that explains why the limiter has never
fired. What would measure it: N `context.newPage()` on one context against a cleared origin with
`enrollment` supplied, counting issuances at the provider. That measurement becomes possible
only once #21 lands, and it should be taken then rather than asserted from this document.

### A separate defect found on the way, filed rather than fixed here

The same missing lock makes `saveSeed` **last-writer-wins**, so N−1 of those cold-start tabs run
as nodes whose seed is *not* the one in storage. On reload each becomes a different node and any
certificate naming the old one is orphaned — exactly the case `whenSeedIsGone` exists to make
loud. That is a correctness bug independent of rate limiting and is filed as its own task.

### CLOSED 2026-08-21 — the missing transaction is now present, and the defect just filed is fixed

**The bound §4 reads was real when this was written and no longer exists.** Task #49
(`a75750a`, 2026-08-21 01:06:06) replaced the `loadSeed()` / `generateSeed()` / `saveSeed()`
trio quoted above with `IdbIdentityStore.loadOrMintSeed`
(`packages/browser/src/idb-identity-store.ts:130-141`), which `get`s the seed, mints on a miss
and `put`s it **inside one `readwrite` transaction**. `browser-node.ts:1379` calls it on the
`whenSeedIsGone === 'mints-a-new-identity'` branch, and the refusing branch still reads and
never mints. The code block quoted above is not in the file at all any more —
`browser-node.ts:1300-1315` is an unrelated start-unwind docblock.

IndexedDB serialises `readwrite` transactions with overlapping scope **across connections in
one origin**, which is to say across tabs, so the loser adopts the winner's seed rather than
keeping the one it minted — the browser already provides the mutual exclusion §4 says is
missing, and nothing had to invent one. `visitorKeyPair()`
(`packages/browser/src/visitor-key.ts:146-172`) got the same treatment as a compare-and-set,
which is the more relevant of the two here: the limiter keys on `request.userKey` — the visitor
key — not on the node seed.

**This is measured, not inferred.** `packages/node/src/cold-start-seed-race.e2e.test.ts:286-313`
releases four tabs of one profile against a shared wall-clock instant and asserts
`distinct === 1`, reading `release-spread=1-2ms distinct=1 of 4 changed-across-restart=0` on
three trials (recorded at
`.planning/consults/2026-08-21-chromium-mdns-ice-blocks-tab-to-tab.md:218-222`). The 1–2 ms
spread is what makes the green a reading of the race rather than of tabs that never overlapped.

So N simultaneous cold tabs of one profile now converge on one seed and one visitor key and
consume **one** issuance, not N. §5's session-restore row falls from "up to 20" to 1 and is not
refused, and §7's 5 → 32 recommendation loses the only common unbounded case it was sized
against — the number belongs on a re-derivation rather than on this paragraph. Note also that
`enrollment.ts:789-790` still repeats the pre-fix wording (*"not in one transaction and there is
no cross-tab lock"*) beside the constant, and should be re-read against this.

One further premise in §4 fell earlier, in `20f7f7c`: *"no default path passes `enrollment` at
all"*. `resolveCertificate` (`packages/browser/src/browser-node.ts:605-687`) now runs the
enrolment round trip on the browser tier with a persisted, non-extractable visitor key. **The
measurement §4 names is therefore possible, and it has still not been taken.**

---

## 5. The blast radius, stated honestly

One owner consumes one issuance per **distinct storage scope holding no live certificate** —
per device × per browser profile × per origin — plus one per 30-day renewal, plus one per
silent IndexedDB eviction.

| scenario | issuances in one hour | refused at 5? |
|---|---|---|
| N tabs, one profile, returning visitor | **0** | no |
| N tabs, one profile, first visit, opened one at a time | **1** | no |
| 3 devices × 2 profiles, all first-visiting within one hour | **6** | **yes, the 6th** |
| session restore of ~20 tabs on a fresh profile | **up to 20** | **yes, from the 6th** |

The last row is the realistic failure. Browsers restoring a previous session routinely reopen
twenty or more tabs at once, and that is the one case that is both common and unbounded by
anything above.

*(SUPERSEDED 2026-08-22 — both halves of this table moved. The verdict column reads the
pre-`20f7f7c` default of 5, which has been 32 since 2026-08-18, so neither "yes" occurs at the
shipped default. And the last row is no longer "up to 20" but **1**: a cold origin's tabs now
share one transaction and converge on one identity — see CLOSED 2026-08-21 in §4, measured at
`distinct=1 of 4`. The 3-devices × 2-profiles row is untouched by that fix, because distinct
storage scopes are still distinct; it is only no longer refused.)*

---

## 6. What the per-user bound is actually for — which decides the number

`enrollment.ts:67-73` already settles this, and it is the load-bearing paragraph:

> Only the second one bounds an attacker, because nothing in an enrolment request is scarce:
> `userKey`, `operatorId` and `relayIds` are all requester-chosen, and a fresh user key is one
> `ed25519.keygen()`. **Phase 17 measured that — twenty requests under twenty distinct user keys
> all succeeded, and deleting the per-user guard left the reading unchanged.**

So `maxPerWindow` bounds **no attacker**. Its only remaining function is to stop one
honest-but-buggy client — a page in a re-enrolment loop — from consuming a provider's whole
aggregate window. It is a blast-radius bound on **accidents**, not a security control.

That inverts the sizing trade. A value that buys no security should be sized so it never
refuses an honest owner; the security work stays entirely with `maxIssuedPerWindow`.

---

## 7. Recommendation

**Raise the `maxPerWindow` default from 5 to 32**, with this basis recorded beside it:
*(ADOPTED 2026-08-18 in `20f7f7c` — `enrollment.ts:803`, whose docblock carries §6's and §7's
argument verbatim at the constant. But read CLOSED 2026-08-21 in §4 before inheriting the
basis: the session-restore burst the first bullet rests on is now one issuance, not twenty.)*

- it must exceed a **session-restore burst on a fresh profile**, the only common unbounded case
  (§5), and 20+ tabs is ordinary;
- it must stay **far below any aggregate budget an operator would set**, so one buggy client
  still cannot consume a provider's whole window — which is the bound's only real job (§6);
- it is **not** a security number, so tuning it downward buys nothing and costs honest owners.

32 is one power of two above the ~20-tab restore case, leaving headroom for device and profile
fan-out inside the same hour without approaching a plausible aggregate budget.

**The number is a recommendation and not a ruling.** Anyone changing it should read §6 first: a
reader who takes `maxPerWindow` for an anti-abuse control will size it down and reintroduce
exactly the functional regression this document exists to prevent.

---

## What was deliberately not done

**The default was not changed.** The regression cannot occur until stable user keys ship (#21),
because no default path passes `enrollment` today — so changing a production default now would
be a policy edit with no live consumer and no test that could witness the difference. The
recommendation is recorded here so #21's design can adopt it in the same change that makes it
matter, together with the measurement §4 names.

### ADOPTED 2026-08-18 — the condition this section named was met the same night

**The default was changed, six hours after this file was committed.** This section asked for
adoption "in the same change that makes it matter" — the change that ships stable user keys
(#21). That change is `20f7f7c` (2026-08-18 00:41:45), and `packages/core/src/enrollment.ts:761-803`
carries §6's and §7's reasoning at the constant, quoting the paragraph above by name and
answering it: *"This is that change, so this is that adoption."* The default is
`DEFAULT_MAX_PER_WINDOW = 32` at `:803`, read once at `:926`.

The premise this section rests on — *"no default path passes `enrollment` today"* — fell in the
same commit. `resolveCertificate` (`packages/browser/src/browser-node.ts:605-687`) runs the
enrolment round trip on the browser tier with a persisted, non-extractable visitor key, and
`visitor-key.ts:45-49` records that the raised bound was sized against exactly that premise.
Four specs now import the constant and assert against it: `packages/net/src/enrol-agent.test.ts`,
`packages/node/src/enrollment.node.test.ts`, `packages/node/src/owner-domain-tabs.e2e.test.ts`
and `packages/browser/src/visitor-key.browser.test.ts`.

**What is still outstanding is the measurement, not the number.** §4 named it: N
`context.newPage()` on one context against a cleared origin with `enrollment` supplied, counting
issuances at the provider. It is possible now and has not been taken — and since the cold-start
burst it would have counted has itself been closed (CLOSED 2026-08-21 in §4), what that
measurement should feed is a re-derivation of 32 rather than a confirmation of it.
