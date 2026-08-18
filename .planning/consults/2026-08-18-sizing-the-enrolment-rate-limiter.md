# Sizing the enrolment rate limiter before stable user keys ship

**Date:** 2026-08-18
**Task:** #22 — *Size the enrolment rate limiter before shipping stable user keys*
**Status:** analysis complete; **no default changed** (see *What was deliberately not done*)

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
| `maxPerWindow` | **5** | `packages/core/src/enrollment.ts:878` (`?? 5`) |
| `windowMs` | **3 600 000 ms — 1 hour** | `:880`, from `DEFAULT_ISSUANCE_WINDOW_MS` at `:759` |
| `certificateLifetimeMs` | **30 days** (`30 * 24 * 3_600_000`) | `:881` |
| `maxIssuedPerWindow` | **caller-supplied, no default** | `:879`; `fabric-node.ts:2244` |

Neither `bin/agent.ts` nor `bin/seed.ts` overrides the first two, and `fabric-node.ts:2209`
records that as a decision rather than an oversight — *"a knob nobody sets is a knob that drifts
from the tests."* The aggregate budget is the one an operator does set: `bin/agent.ts:927` reads
`--max-issued-per-window`, and `bin/bench.ts:1310` passes
`'issues-without-an-aggregate-budget'`.

**So the standing policy is 5 certificates per user key per hour, and a certificate lives 720
windows.**

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
