---
phase: 17-node-identity-enrollment
verified: 2026-08-01T03:50:00Z
status: gaps_found
score: 1/3 success criteria fully met (2 PARTIAL)
requirements: [AUTH-01, AUTH-02, AUTH-04]
typecheck: "npx tsc --noEmit — exit 0"
mutations_planted: 3
mutations_caught: 3
gaps:
  - truth: "A second node started via `bin/agent.ts` verifies the first node's certificate offline, with no live call to any certificate authority, before treating it as a legitimate peer"
    status: partial
    reason: >-
      The offline claim is falsified properly and the rejecting half is proved cross-process,
      but the *accepting* verifier is an in-process `FabricNode` (`startNode('b')`), not a
      spawned `bin/agent.ts`. The criterion names the binary; an in-process test is not
      evidence for that clause. The spawned-verifier test covers only the fail-closed half.
    artifacts:
      - path: "packages/node/src/certificate-verification.node.test.ts"
        issue: "line 302 — the verifier B is `startNode('b', …)`, in-process; lines 367-370 state the accepting half is unmeasured through a spawned agent because no flag makes one dial a peer"
      - path: "packages/node/src/bin/agent.ts"
        issue: "no bootstrap/dial/connect flag; `--provider-addr` dials only a provider, which itself holds no certificate, so a spawned verifier can never reach an `ok: true` verdict"
    missing:
      - "A flag on `bin/agent.ts` that makes a spawned agent dial a named multiaddr, so a spawned `--trusted-issuer` verifier can be shown *accepting* an enrolled peer across a real process boundary"
  - truth: "Enrolling many node identities in a burst through the same entry point is rate-limited — refused beyond a stated threshold rather than accepted unbounded — making mass fake-node creation measurably costly"
    status: partial
    reason: >-
      The rate-limiting clause is fully met and cross-process. The cost clause is NOT met.
      The limiter keys on `userKey`; a user key is one `ed25519.keygen()` call, so 20 distinct
      user keys yield 20 certificates unslowed. Nothing is made costly. The threshold is
      additionally per-provider-*uptime*, so a second provider process has a fresh budget for
      an already-exhausted user key.
    artifacts:
      - path: "packages/core/src/enrollment.ts"
        issue: "line 287 — `#history` is keyed on `request.userKey` only; there is no cost term (no PoW, no stake, no out-of-band identity check) anywhere on the issuance path"
      - path: "packages/node/src/enrollment.node.test.ts"
        issue: "lines 533-556 — 20 distinct user keys produce 20 distinct nodeKeys, all accepted; lines 566-591 — the same user key refused by provider 1 is accepted by provider 2"
    missing:
      - "A cost term at the limiter (proof-of-work, stake, or an out-of-band user-key attestation) so that minting a fresh user key is not free"
      - "Issuance history that survives a provider restart, if the stated threshold is to mean anything across process lifetimes"
  - truth: "A browser node can obtain and advertise a provider-signed certificate (project cardinal rule: all nodes have equal functionality)"
    status: failed
    reason: >-
      Criteria 1-3 are established for the Node tier only. `browser-node.ts` has no on-device
      seed, passes no `privateKey` to `createLibp2p`, has no `enrollment` option, holds no
      certificate, and passes the `'serves-no-records'` / `'issues-no-certificates'` sentinels
      unconditionally. Nothing branches on node kind — the mechanisms are simply absent.
      Consequence: a Node agent run with `--trusted-issuer` refuses every browser peer as a
      block source. No later ROADMAP phase covers browser enrollment.
    artifacts:
      - path: "packages/browser/src/browser-node.ts"
        issue: "line 387 `createLibp2p({…})` with no `privateKey`; line 622 `index: 'serves-no-records'`; line 626 `enroll: 'issues-no-certificates'` — both unconditional"
      - path: "packages/browser/package.json"
        issue: "no dependency on `@o2/node`, so `PeerVerifier` is structurally unreachable from a tab (recorded in the phase's own deferred-items.md item 2)"
    missing:
      - "An on-device seed source for the browser tier (IndexedDB / keychain) feeding `createLibp2p({ privateKey })`"
      - "An `enrollment` path on `BrowserNode` reaching a provider over the browser-dialable transports"
      - "`peer-verifier.ts` moved to a package both tiers depend on"
human_verification:
  - test: "Decide whether a per-user-key enrollment limit is an acceptable v1.1 answer to AUTH-04's 'so mass fake-node creation is costly', or whether the ROADMAP criterion should be amended to drop the cost clause."
    expected: "Either a cost term is scheduled, or criterion 3's wording is amended to claim only rate-limiting."
    why_human: "A scope decision about what AUTH-04 promises, not a fact about the code."
  - test: "Decide whether Phase 17 may close with criteria 1-3 established for the Node tier only, given the project's cardinal rule that all nodes have equal functionality."
    expected: "Either a browser-enrollment phase is scheduled, or the tier asymmetry is accepted and recorded in ROADMAP.md."
    why_human: "Weighs a stated project invariant against milestone scope."
---

# Phase 17: Node Identity & Enrollment — Verification Report

**Phase Goal:** A node generates its identity key on-device and completes a rate-limited, provider-signed enrollment before it is treated as a peer, and a peer verifies that certificate offline
**Verified:** 2026-08-01T03:50:00Z
**Status:** gaps_found
**Re-verification:** No — initial verification
**Branch verified:** `feature/phase-17-node-identity-enrollment` at `ee2bac5`

Every reading below was taken by this verifier from production source located by grep and from
commands this verifier ran. No SUMMARY.md claim is carried forward untested.

---

## Criterion 1 — on-device identity, rate-limited enrollment, certificate as the advertised identity

> Starting a node via `bin/agent.ts` for the first time generates an identity key on-device and
> completes a rate-limited enrollment flow against a provider, receiving a provider-signed
> certificate — observable as the node's advertised identity being a certificate rather than a
> bare libp2p peer ID

### Verdict: **MET**

| Clause | Evidence (`file:line`) |
|---|---|
| identity key generated on-device | `packages/node/src/identity-store.ts:68-92` — `loadOrCreateSeed` reads `<dir>/.identity.key`, mints a 32-byte seed with mode `0600` via tmp+`rename` when absent, and throws `MalformedSeedFileError` on a wrong-length file rather than minting over it |
| that seed is what libp2p dials | `packages/node/src/fabric-node.ts:884` (`await loadOrCreateSeed(options.blockstoreDir, IDENTITY_FILE)`) → `fabric-node.ts:919` (`privateKey: identity.privateKey` on `createLibp2p`) |
| enrollment is part of starting, via the binary | `packages/node/src/bin/agent.ts:108` `--provider-addr`, `:133` `--user-key` (a **path**, never key material on argv), `:140` `--operator-id`; `agent.ts:247` builds the `enrollment` option; `agent.ts:190-193` exits 2 if either companion flag is missing |
| the provider is a configuration of the same binary | `packages/node/src/bin/agent.ts:178` `--issues-certificates` (boolean; signing key generated on-device into `<dir>/.provider.key`, `fabric-node.ts:1075-1081`) |
| rate-limited | `packages/core/src/enrollment.ts:287-300` — the limiter is consulted on the same `enrol` issuance path the binary uses (see criterion 3) |
| advertised identity is the certificate | `packages/node/src/bin/agent.ts:306-307` prints `certificate` and `issuerKey` on the handshake line; `fabric-node.ts:789` `nodeKey`, `:801` `issuerKey` |

**Command:**
`npx vitest run --project node packages/node/src/enrollment.node.test.ts packages/node/src/certificate-verification.node.test.ts`
**Result:** `Test Files 2 passed (2) | Tests 9 passed (9)`, 14.26s.

The load-bearing test is `packages/node/src/enrollment.node.test.ts:264-345`, and it is
genuinely cross-process:

- `.identity.key` is asserted **absent** before the spawn (`:279`) and present at exactly
  `SEED_BYTES` after (`:290-291`) — so "generated on-device" cannot be satisfied by a
  pre-existing file.
- The certificate is asserted `issuer !== nodeKey` (`:307`) and `issuer === provider.issuerKey`
  (`:306`), where `provider` is a separately spawned OS process.
- `peerIdForNodeKey(alice.nodeKey) === alice.peerId` (`:313`) — this is what stops the printed
  certificate being a string the binary chose to print; it is demonstrably about the key the
  peer id is derived from.
- Step 6 (`:317-322`) re-fetches the certificate over the production `records` RPC from a
  **third** process and `verifyCertificate` passes on the fetched copy. That is what makes the
  reading not a self-report.
- Step 7 (`:326-340`) restarts the same directory and gets the same `nodeKey`, `peerId`, and
  byte-identical certificate including `issuedAt` — "for the first time" made measurable.

**Not accepted on the executors' word:** I planted mutation **M3** against this exact mechanism
(below); it turns this test red.

---

## Criterion 2 — a second node verifies the certificate offline, and rejects a bad one by name

> A second node started via `bin/agent.ts` verifies the first node's certificate offline, with no
> live call to any certificate authority, before treating it as a legitimate peer, and rejects a
> self-signed or forged certificate with a named reason

### Verdict: **PARTIAL**

**What is established.**

The offline claim is falsified, not argued, and by the strong technique. In
`packages/node/src/certificate-verification.node.test.ts:294-299`, both provider processes are
stopped **and their death asserted** (`exitCode !== null || signalCode !== null`) *before* the
verifier is constructed. Every verdict taken afterwards is therefore demonstrably reached with
no authority alive to have been consulted. "The provider was still answering" is not an
available explanation. Confirmed: this is exactly what the test does.

| Clause | Evidence | Status |
|---|---|---|
| verification is offline (no live CA call) | `certificate-verification.node.test.ts:294-299` both providers killed and asserted dead before `startNode('b')` at `:302`; `packages/node/src/peer-verifier.ts:78` imports the pure `verifyCertificate` from `@o2/core` and the only network I/O on the path is a `records` RPC **to the peer itself**, not to an authority | MET |
| rejects with a named reason | `certificate-verification.node.test.ts:322-328` — verdict is `{ kind: 'untrusted-issuer', issuer: p2.issuerKey }`, a `toStrictEqual` on the whole failure object, and the refused peer is a spawned agent process | MET |
| the reason is about a *connected* peer, not an empty network | `:331-333` — `b.transport.peers` contains C, `verifiedPeers` does not; and `:339-340` the successful half (`b.blockstore.get(cidOnA)` returns the seeded bytes) shows the instrument reading both ways | MET |
| **verified by a second node started via `bin/agent.ts`** | `:302` the verifier is `startNode('b', …)` — an **in-process** `FabricNode`, not a spawned process | **NOT MET** |
| the fail-closed half through a spawned agent | `:372-431` — a spawned `--trusted-issuer` agent refuses an unverifiable peer as a block source (`module block missing: <cid>`, reason asserted, not only `ok === false`), against an identical spawn without the flag that succeeds | MET |
| the **accepting** half through a spawned agent | none anywhere in the repository | **NOT MET** |

**Command:** as above — all 9 tests pass. Additionally
`npx vitest run --project node …peer-gate.node.test.ts …peer-verifier.node.test.ts …node-records.node.test.ts …` →
`Test Files 7 passed (7) | Tests 104 passed (104)`.

**Why PARTIAL and not MET.** The criterion names `bin/agent.ts`, and the brief for this
verification is explicit that an in-process test is not evidence for that clause. I independently
confirmed the cause rather than taking the test comment's word: `bin/agent.ts` parses exactly
eleven options (`agent.ts:53-179`) and none of them makes the process dial an arbitrary peer.
`--provider-addr` does dial — but only a provider, and a provider's own handshake carries
`certificate: null` (asserted at `enrollment.node.test.ts:274`), so a spawned verifier pointed at
one could only ever reach a `no-records` verdict. The accepting half is unreachable through the
binary as it stands, by construction and not by omission of a test.

---

## Criterion 3 — the burst is rate-limited, and mass fake-node creation is measurably costly

> Attempting to enroll many node identities in a burst through the same entry point is
> rate-limited — refused beyond a stated threshold rather than accepted unbounded — making mass
> fake-node creation measurably costly

### Verdict: **PARTIAL**

**The rate-limiting clause: MET, and well measured.**

`packages/node/src/enrollment.node.test.ts:472-517` sends 20 `enrol` requests with 20 distinct
node keys under **one** user key over the production
`rpc.request(peer, encodeRequest({kind:'enrol', …}))` path to a spawned `--issues-certificates`
agent. The split is never written down in the test: `expect(accepted).toHaveLength(first.limit)`
(`:508`) reads the threshold **out of the refusal the peer received**, which is what makes the
threshold *stated* rather than merely *known to the provider*. `limit: 5` and
`windowMs: 3_600_000` are asserted as literals at `:499` because the refusal is required to
carry them onto the wire, and every refusal is asserted to name the same limit (`:511-513`). The
provider is asserted alive afterwards (`:516-517`) — a refusal, not a dropped frame.

Implementation: `packages/core/src/enrollment.ts:287-300`, and the ordering there is correct —
possession and owner-consent are checked *before* the limiter is touched (`:264-285`), so a
cross-user attempt cannot consume a victim's window.

**The cost clause: NOT MET.** This is my independent judgement, and I do not think a per-user-key
limit satisfies "making mass fake-node creation measurably costly".

The limiter's only key is `request.userKey` (`enrollment.ts:287`). A user key is one
`ed25519.keygen()`. `enrollment.node.test.ts:533-556` measures the consequence directly: 20
requests under 20 distinct user keys yield **20 accepted certificates with 20 distinct
`nodeKey`s** (`:554`), unslowed, against a spawned provider. There is no work factor, no stake,
no out-of-band check, and nothing on the issuance path that a mass creator would have to pay.
The criterion's own verb is *"making … measurably costly"*; the honest measurement here shows
the cost is zero and does not change with N. Refusing beyond a threshold that is free to reset is
not a cost, it is a speed bump keyed on a variable the attacker controls.

It is weaker still than "per user key" implies. `enrollment.node.test.ts:566-591` shows a user
key exhausted against one spawned provider being accepted immediately by a **second** spawned
provider — the history is a `Map` in the authority object (`enrollment.ts:287`,
`enrol-agent.test.ts:247-249`), so the threshold is per provider *uptime*. A mass creator does
not even need a second user key; a second provider, or a provider restart, suffices.

I record the mitigating fact plainly: this is not a hidden defect. The repository publishes the
counter-measurement beside the positive one, in a test whose title says
`rate-limiting measured, cost unmeasured`, and states at `enrollment.node.test.ts:522-527` that
no deletion turns that assertion red because there is nothing in the mechanism to remove. That is
the right disposition. It is still a criterion clause that is not met.

---

## Mutations planted by this verifier

Baseline copies were taken with `cp` into `/tmp/p17-baseline/` and every restore was confirmed
with `cmp`. No `git checkout` / `restore` / `stash` / `reset` / `clean` was used at any point —
this working tree is shared.

### M1 — the rate guard removed

`packages/core/src/enrollment.ts:288`: `if (recent.length >= this.#maxPerWindow) {` → `if (false) {`

**Command:** `npx vitest run --project node packages/node/src/enrollment.node.test.ts`
**Result:** `Tests 2 failed | 5 passed (7)`

- `refuses past the threshold the refusal states, under one user key` — `AssertionError: expected 0 to be greater than 0`
- `a second provider process has a fresh budget for the same user key` — `AssertionError: expected false to be true`

The rate limit is genuinely load-bearing and genuinely observed across a real process boundary.

**And the finding the executors reported, independently reproduced:** the third test —
`does nothing at all against twenty distinct user keys` — **stayed green under M1**. Removing the
entire rate guard changes nothing about the distinct-user-key measurement, because there is no
mechanism there for a mutation to remove. This corroborates their E11 result from a different
mutation than the one they used.

**Restored:** `cp` + `cmp` → `RESTORED-M1-OK`.

### M2 — the verified-peer gate disabled

`packages/node/src/peer-verifier.ts:200-202`: the body of `get verifiedPeers()` replaced with
`return this.#peers()` (trust-anchor filter removed).

**Command:** `npx vitest run --project node packages/node/src/certificate-verification.node.test.ts packages/node/src/peer-gate.node.test.ts`
**Result:** `Tests 4 failed | 3 passed (7)`

- criterion 2's dead-provider test — `expected [ …(2) ] to not include '12D3KooWFhFe8v5…'`
- the spawned-agent `--trusted-issuer` test — `expected true to be false`
- `peer-gate` block-source test — `expected Uint8Array[192,193,194] to be undefined`
- `peer-gate` named-exclusion test — `expected [ …(2) ] to not include '12D3KooWGWFknLm…'`

Both cross-process tests die. The gate is not decorative and the tests are not asserting around
it.

**Restored:** `cp` + `cmp` → `RESTORED-M2-OK`.

### M3 — the on-device seed never reused

`packages/node/src/identity-store.ts:78`: `if (existing !== undefined) {` →
`if (existing !== undefined && target === '') {` (always false; chosen over deleting the branch
so the mutation does not fail typecheck for an unrelated reason).

**Command:** `npx vitest run --project node packages/node/src/enrollment.node.test.ts packages/node/src/identity-store.node.test.ts packages/node/src/node-identity.node.test.ts`
**Result:** `Tests 7 failed | 29 passed (36)`

Including criterion 1's own cross-process test —
`generates an identity on-device, enrols against a provider process, and advertises a
certificate a peer can fetch and verify` — failing on
`expected '12D3KooWPonUkDMx…' to be '12D3KooWHkgS5vEV…'`, i.e. step 7's restart identity.

**Restored:** `cp` + `cmp` → `RESTORED-M3-OK`.

**All three mutations were caught.** The phase's central mechanisms — the seed on disk, the
issuance limiter, and the verified-peer gate — are each observed by at least one test that runs
across real process boundaries.

---

## The four open items — independent judgement

### 1. Criterion 3's cost clause — **CONFIRMED unmet. This is a real gap, not a wording quibble.**

Refuted nothing; confirmed everything. 20 distinct user keys, 20 certificates, unslowed
(`enrollment.node.test.ts:533-556`, run and green). M1 leaves that test green, reproduced
independently.

**My answer to the question posed:** a per-user-key limit does **not** satisfy
*"making mass fake-node creation measurably costly"*. The limit is keyed on a value the attacker
mints for free, so the marginal cost of the N-th fake node is identical to the first. The clause
asks for a cost and there is no cost term anywhere on the issuance path. I would additionally
note the weaker fact the executors did not lead with: even the per-user-key limit is defeated
without a second user key, because the budget is per provider process.

The honest framing in the repository is the right one — but the criterion as written in
ROADMAP.md is not met, and that is what this verification records. Closing it needs either a cost
term at the limiter or an amendment to the criterion.

### 2. The threshold is per provider *uptime*, and surviving a restart is "unmeasured and false" — **CONFIRMED, and the assertion reads exactly as claimed.**

The words are at `packages/node/src/enrollment.node.test.ts:559-564`:
*"it is a threshold per provider uptime … That the threshold survives a provider restart is
**unmeasured and false**, and this is the reading that says so."* The test beneath it
(`:566-591`) spawns `scope-provider-1` and `scope-provider-2` as two real processes, exhausts the
first for `BURST_USER_SEED` one request at a time (explicitly serial, so the refusal cannot be a
concurrency artefact), and shows the eighth node key refused by the first and accepted by the
second. Green in my run. The same fact is stated at `packages/net/src/enrol-agent.test.ts:245-249`
and traced to `#history` being a `Map` in the authority object, which I confirmed at
`packages/core/src/enrollment.ts:287`.

This is a correct, well-evidenced self-report. Credit where due: it is asserted, not merely
commented.

### 3. Criterion 2's accepting side unmeasured through `bin/agent.ts` — **CONFIRMED. There is no real-process coverage of the accepting half anywhere.**

I checked this independently rather than accepting the docstring at
`certificate-verification.node.test.ts:367-370`. The verifier in the dead-provider test is
`startNode('b', …)` at `:302` — in-process. The spawned-verifier test at `:372` proves only the
fail-closed direction. And `bin/agent.ts` really does have no way to close it: the eleven parsed
options at `agent.ts:53-179` contain no bootstrap/dial/connect flag, and the one flag that does
dial (`--provider-addr`) dials a provider whose handshake carries `certificate: null`
(`enrollment.node.test.ts:274`) — so a spawned verifier aimed at it could only reach
`no-records`. Not an oversight in the tests; a missing capability in the binary.

Phase 18's bootstrap flag is a plausible closer, but Phase 18's ROADMAP entry does not name
AUTH-02 or certificate acceptance, so I am **not** deferring this gap. It is recorded as a gap
against Phase 17.

### 4. A browser node cannot obtain a certificate — **CONFIRMED, and I judge it a gap, not an acceptable scoping.**

Verified from source, not from the report. `packages/browser/src/browser-node.ts:387` calls
`createLibp2p({…})` with **no `privateKey`** — so a browser identity is libp2p's default random
Ed25519 key, minted fresh per tab, with nothing on disk. `grep` for `seed`, `privateKey`,
`enrollment`, `certificate`, `trustedIssuers` across that file returns **only** two hits:
`:622 index: 'serves-no-records'` and `:626 enroll: 'issues-no-certificates'`, both
unconditional. Nothing branches on node kind. These are absent mechanisms, exactly as reported.
The phase's own `deferred-items.md` item 2 records the narrower packaging half (`@o2/browser`
does not depend on `@o2/node`, so `PeerVerifier` is structurally unreachable from a tab).

**Statement for the record:** criteria 1, 2 and 3 are established **for the Node tier only**.

**Is that acceptable?** I do not think it is, and here is the behavioural consequence rather than
the philosophical one. AUTH-02's gate is fail-closed by design: `peer-verifier.ts:200-202`
filters `verifiedPeers` to peers with an `ok` verdict, and a peer that serves no records can
never earn one. So the moment an operator passes `--trusted-issuer` — the flag this phase exists
to add — that node stops treating **every browser peer in the fabric** as a usable block source.
Phase 17 has therefore introduced a mechanism that partitions the fabric by tier, which is the
precise shape the project's cardinal rule (*all nodes have equal functionality; the only
difference is discovery*) exists to prevent, and which `fabric-node.ts`'s own "why there is no
second class" section is written to forbid.

No later phase in ROADMAP.md covers browser enrollment, so this is not deferrable to one. It is
recorded as a `failed` gap with a human decision requested: schedule a browser-enrollment phase,
or amend ROADMAP.md to state the tier asymmetry explicitly so it stops being implicit.

---

## Typecheck

**Command:** `npx tsc --noEmit`
**Result:** exit `0`. Re-run after all three mutations were restored.

---

## Requirements coverage

| Requirement | Description | Status | Evidence |
|---|---|---|---|
| AUTH-01 | Node identity key generated on-device, public half certified by a provider | SATISFIED (Node tier) | `identity-store.ts:68-92`, `fabric-node.ts:884,919`, `bin/agent.ts:108,133,140,247`; `enrollment.node.test.ts:264-345` green |
| AUTH-02 | A node verifies a peer's provider-signed certificate offline | PARTIAL | Offline falsified with dead authorities (`certificate-verification.node.test.ts:294-299`); accepting half not proved through `bin/agent.ts` |
| AUTH-04 | Enrollment is provider-gated and rate-limited, so mass fake-node creation is costly | PARTIAL | Gated and rate-limited: `core/src/enrollment.ts:287-300`, `enrollment.node.test.ts:472-517`. Costly: not met |

**Ledger not edited.** `.planning/REQUIREMENTS.md:182,184,188` carry AUTH-01/02/04 as `[ ]`, with
traceability rows at `:565,566,568` reading **Built, not wired**. Per the brief — *tick only what
is individually established* — nothing is ticked: AUTH-02 and AUTH-04 are partial, and ticking
AUTH-01 alone would require changing its traceability status, which the legend
(`acceptance-traceability.node.test.ts:158` — `[x]` iff the verdict begins `Done`) couples to the
checkbox. I confirmed the guard is green as it stands:

**Command:** `npx vitest run --project node packages/node/src/acceptance-traceability.node.test.ts …` (7 files)
**Result:** `Test Files 7 passed (7) | Tests 104 passed (104)`

**Recorded for whoever closes these:** the traceability text *"requestEnrollment /
EnrollmentAuthority have no production caller"* (`:565`, `:568`) and *"verifyCertificate is
reachable only through discoverExecutors, which has no caller"* (`:566`) are now **factually
stale** — all three have production callers on the startup path. The wording should be updated
when the statuses move. Widening `RECOGNISED_STATUSES` to accommodate new wording is not the fix.

---

## Anti-patterns

Grepped the phase's changed files (`git diff --stat 42e854e~1..ee2bac5 -- packages/`, 39 files)
for `TBD|FIXME|XXX`: **none**. No unreferenced debt markers. The words *unmeasured*, *unwired*
and *false* appear frequently in comments, but each is a recorded negative measurement with the
reading beside it, not deferred work — the disposition this repository asks for.

---

## Gaps summary

Three things stand between this phase and its stated goal, and only one of them is a coding
oversight.

The **cost clause of criterion 3** is a design gap: the limiter keys on a value that is free to
mint, so nothing on the issuance path becomes more expensive as N grows. The repository measures
and publishes this rather than hiding it, which is the right conduct, but the criterion asks for
a cost and there is none.

The **accepting half of criterion 2** is a missing capability in `bin/agent.ts`, not a missing
test: no flag makes a spawned agent dial a peer, so the reading the criterion names cannot be
taken. The rejecting half and the offline property are both properly established, the latter by
the strong falsification of killing both authorities and asserting them dead first.

The **browser tier** has none of this phase's mechanisms, and the fail-closed gate this phase
added means a Node agent configured with `--trusted-issuer` will now exclude every browser peer.
That converts an implicit tier asymmetry into an observable partition of the fabric, against the
project's cardinal rule, with no later phase scheduled to close it.

Criterion 1 is met, cross-process, and survives a mutation aimed at its centre.

**1/3**

---

_Verified: 2026-08-01T03:50:00Z_
_Verifier: Claude (gsd-verifier)_
