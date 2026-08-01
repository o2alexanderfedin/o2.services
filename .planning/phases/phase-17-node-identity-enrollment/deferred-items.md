# Phase 17 — deferred items

Out-of-scope findings recorded during execution rather than fixed, per the executor's
scope boundary. Each names the file, the measurement, and what would close it.

## 1. A false claim in `packages/node/src/fabric-node.ts:1029-1032` — **CLOSED by 17-05**

**Closed 2026-08-01.** 17-05 rewrote the paragraph, as this entry asked. It now records that
the `createLibp2p` call passes an Ed25519 `privateKey` derived on-device by
`identityFromSeed`, that `audienceKeyOf`'s two throwing branches are therefore *still*
unreachable through this factory, and that measuring them needs an **injectable**
`privateKey` option which no phase has added — a present-tense statement in place of the
prediction. Comment only; no behaviour changed. The original entry is kept below unedited.



**Found during:** 17-04 Task 3, re-reading `#compose`.

The comment above `const audience = audienceKeyOf(libp2p.peerId)` says:

> Verified against source on 2026-07-31: the `createLibp2p` call above passes `addresses`,
> `transports`, `connectionEncrypters`, `streamMuxers`, `connectionManager`, `services` and
> a conditionally-spread `logger`, and **no `privateKey`**

`fabric-node.ts:919` passes `privateKey: identity.privateKey`. Plan 17-01 added that line and
did not update this comment, so the file now states as verified a fact about itself that is
false.

The comment's **conclusion** survives — the identity is still Ed25519, derived from a seed, so
`audienceKeyOf`'s two throwing branches remain unreachable through this factory — but its
stated reason does not, and its forward-looking sentence ("Phase 17 adds exactly that option
for identity resolution, so the assertion belongs to whichever phase adds the injection
point") now describes a phase that has already landed. Phase 17 added identity resolution but
**no** injectable `privateKey` option, so the branch is still unreachable and still unmeasured
— which is worth saying in the present tense rather than as a prediction.

**Not fixed here** because nothing in 17-04 touches `audienceKeyOf` or the `createLibp2p`
call, and rewriting a neighbouring comment would put an unreviewable edit in a plan whose
diff is meant to be readable. **What would close it:** 17-05 rewrites the paragraph to say
that the call passes an Ed25519 `privateKey` derived on-device, that the throwing branches are
therefore still unreachable, and that measuring them needs an injectable key option no phase
has added.

## 2. `PeerVerifier` is unreachable from the browser tier

**Found during:** 17-04 Task 2.

`packages/node/src/peer-verifier.ts` imports nothing Node-only — `@libp2p/interface` types,
`@o2/core`, `@o2/libp2p`, `@o2/net`, every one of which `@o2/browser` already depends on. But
`@o2/browser`'s `package.json` does not depend on `@o2/node` (measured: the only occurrence of
the string `@o2/node` anywhere under `packages/browser` is a prose mention in
`src/index.ts:4`), so a browser tab structurally cannot construct one.

This is a **packaging** fact, not a capability one, and it is recorded rather than silently
accepted because a capability available to one tier and not the other is the shape
`fabric-node.ts`'s "why there is no second class" section exists to prevent.

**What would close it:** move the file to `packages/net/src/peer-verifier.ts` and re-export
from both barrels. No code inside the module changes. Plan 17-04's `must_haves.artifacts`
pins the path to `packages/node/src/peer-verifier.ts`, so the move belongs to a plan that can
state it.

## 3. A browser node cannot obtain a certificate at all — carried forward from 17-03

**Re-measured during:** 17-04, and unchanged.

`packages/browser/src/browser-node.ts` has no identity seed, no `privateKey` on its
`createLibp2p` call (`:387-397`), no `enrollment` option, no `certificate` field, and passes
`index: 'serves-no-records'` (`:622`) and `enroll: 'issues-no-certificates'` (`:626`)
unconditionally. So *"a browser node enrols and is verified on identical terms"* is a claim
this repository still cannot make.

**Why 17-04 did not close it.** Nothing here branches on node kind, so this is not the Phase 16
defect recurring — it is four absent mechanisms, each of which is its own decision:

1. a persisted identity seed in the browser tier (IndexedDB or the libp2p keychain — a new
   storage surface, and the browser's is evicted silently under pressure, which makes
   "persisted" a claim needing its own measurement);
2. an `enrollment` option plus the dial and `enrolOverRpc` round trip on `BrowserNode.start`;
3. `ownRecords` at the `index` hook — portable, and the only one of the four that is a
   straight copy;
4. `trustedIssuers` and a `PeerVerifier`, which item 2 above blocks outright.

Item 1 alone is an architectural decision about browser-tier persistence, and item 4 cannot be
done at all until the packaging move lands. Doing any subset would produce a browser node that
holds an identity it cannot persist, or verifies peers it cannot be verified by — asymmetries
worse than the current honest absence.

**It is not structurally unprovable.** `packages/node/src/browser-capability.e2e.test.ts` already
drives a real tab, so the `e2e` project can measure the whole of it once the mechanisms exist.

## 4. AUTH-04's cost is still unmeasured — carried forward from 17-02

Twenty *distinct* user keys still enrol unslowed; the limit is keyed on `userKey`. 17-04 adds
nothing here and nothing here changed. **Re-measured in 17-05 across a real process
boundary** — twenty distinct user keys against a spawned `--issues-certificates` agent, all
twenty accepted, twenty distinct subject keys issued — and the finding is unchanged.
Recorded so it does not go quiet.

## 5. `tools/aot/lift.node.test.ts` fails under host load and has no load gate

**Found during:** 17-05's final full-project sweep. **Out of scope, not fixed.**

Six assertions in that file failed at a 1-minute load average of ~45 and all 73 passed at
4.41 on the same commit, with no source change between the two runs. The failing group is
image-resolution budget behaviour — `resolveImage(...)` bounded by `IMAGE_RESOLVE_CAP_MS`
against a **stubbed** `docker` — so what is being measured is how long a stub subprocess
takes to be scheduled, which on a contended host exceeds the cap.

It imports nothing this plan touched (`grep -cE "bin/agent|fabric-node|enrollment|
certificate-verification|trustedIssuers"` returns **0**; its only first-party import is
`./lift.ts`), so this is pre-existing and load-induced rather than a regression.

**What would close it:** the load gate `transport-bounds.node.test.ts` already uses — read
`os.loadavg()[0]` and skip loudly above a stated threshold — applied to the timing-bounded
describe block only. A wall-clock assertion on a contended host is a measurement of the
host. Not done here: this plan's scope boundary forbids fixing failures in unrelated files,
and silently widening a budget would remove the only reading that bounds it.

---

## `vocabulary.node.test.ts` failed on `17-VERIFICATION.md` — CLOSED 2026-08-01

**Found during:** 17-06, on the post-commit vocabulary run. **Closed by the orchestrator in
`36458ad`, before this entry was merged.**

**What failed:** two of the five `BANNED` readings, both in `17-VERIFICATION.md` and
neither in source — one an ordinary English past participle about acquiring something, the
other the opening of a common idiom about giving someone their due. Both arrived in
`f6a172b`, an ancestor of 17-06's base; 17-06 caused neither.

**How it was closed:** the two sentences were reworded. **Not** by adding a path exemption
— `vocabulary.node.test.ts`'s own comment records that the bias is toward exempting as
little as possible, and its `EXEMPT_LINES` are keyed by phrase precisely so an exemption
names the exact text it forgives. An exemption for incidental English would have forgiven
every future occurrence in that file, which is how a guard stops guarding.

The judgement 17-06 deferred was the right one to defer and the wrong one to resolve in
its favour: the test is named *"no cryptojacking vocabulary reaches a reviewer who greps"*,
so what the sentence meant does not matter. A reviewer grepping this repository must find
nothing, including in a document arguing against the vocabulary.

**The lesson worth keeping, which is why this entry survives its own fix:** *this entry
originally failed the guard too.* Describing the violation meant quoting it, and the quotes
re-armed the same two readings from a second file — so the merge that carried the report of
the problem also carried the problem. A finding about forbidden text cannot be written
down in the forbidden text. Describe the shape, cite the `file:line`, and let the reader
open it.

**Also relevant:** the guard scans `git ls-files`. 17-06 found this only because it ran the
guard *after* committing; the verification pass that introduced it reported its guards green
from a run that could not have read the file it was about to write.
