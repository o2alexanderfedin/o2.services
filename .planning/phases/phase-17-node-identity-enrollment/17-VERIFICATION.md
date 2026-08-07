---
phase: 17-node-identity-enrollment
verified: 2026-08-01T03:50:00Z
amended: 2026-08-07T08:16:20Z
status: human_needed
score: 3/3 success criteria met (criterion 3 closed 2026-08-07, carrying Phase 24 criterion 8's bound verbatim)
original_status: gaps_found
original_score: 1/3 success criteria fully met (2 PARTIAL)
requirements: [AUTH-01, AUTH-02, AUTH-04]
typecheck: "npx tsc --noEmit — exit 0 (2026-08-01), re-run exit 0 (2026-08-05), re-run exit 0 (2026-08-07, real 1.37 user 2.12 sys 0.40)"
mutations_planted: 3
mutations_caught: 3
amendment_mutations_planted: 4
amendment_mutations_caught: 4
third_amendment_mutations_planted: 2
third_amendment_mutations_caught: 1
fourth_amendment_mutations_planted: 2
fourth_amendment_mutations_caught: 2
carried_bound: >-
  Criterion 3 closes ONLY by carrying Phase 24 criterion 8's stated bound verbatim, per owner
  ruling 2026-08-07 (the NARROW reading, confirmed over the wider one): "The default posture of
  `bin/agent.ts`, `bin/seed.ts` and `bin/bench.ts` is **open**, and must be: nineteen
  `bin/agent.ts` and three `bin/seed.ts` argv sites depend on it, and
  `reservation-exhaustion.node.test.ts` arm A is a **live behavioural guard** on it — read at the
  source, lines 285-317: 'a seed whose no-flag posture had become anything but
  `admits-any-peer` reddens here, by name, before B is ever read', backed by
  `expect(a.stderr()).not.toContain('PERMISSION_DENIED')`. Criterion 8 is MET **of a fabric an
  operator has closed**, and this repository ships open by default on purpose." Both option types
  make `relayAdmission` required with no default, so the API cannot express silence; only argv has
  a default. A carried criterion inherits no more than its destination delivered.
gaps_closed:
  - truth: "A second node started via `bin/agent.ts` verifies the first node's certificate offline, with no live call to any certificate authority, before treating it as a legitimate peer"
    closed_by: "Plan 18-01 — `--peer-addr` on `bin/agent.ts` (`9748608`, 2026-08-01)"
    evidence: >-
      `packages/node/src/peer-dial.node.test.ts` — a spawned `--trusted-issuer --peer-addr`
      agent (V) fetches a module held in exactly one blockstore on the dialled peer (A) and
      runs it, against a byte-identical spawned negative control pinning another issuer (W)
      which is refused `block missing`, and a no-anchor control (U) which succeeds. V is
      never given the provider's address, so it could not have consulted the authority.
      Planted red by this verifier (R1).
  - truth: "A browser node can obtain and advertise a provider-signed certificate (project cardinal rule: all nodes have equal functionality)"
    closed_by: "`3775323` + `c885271`, 2026-08-01 — on-device IndexedDB seed, `privateKey` at `createLibp2p`, an `enrollment` option, a held certificate"
    evidence: >-
      `packages/node/src/browser-enrollment.e2e.test.ts` — the same gate node with the same
      pinned issuer excludes an uncertificated tab by name (`no-records`) and then contains
      an enrolled tab in `verifiedPeers`, with the certificate's `nodeKey` resolving through
      `peerIdForNodeKey` to that tab's own peer id. Planted red by this verifier (R3).
  - truth: "Enrolling many node identities in a burst through the same entry point is rate-limited — refused beyond a stated threshold rather than accepted unbounded — making mass fake-node creation measurably costly"
    closed_by: >-
      Phase 24 criterion 8 (MET 2026-08-06, `580e461`) for the cost clause itself, PLUS commit
      `8719029` (2026-08-06, `relay-admission.node.test.ts` +204, ledger entry M68) for the
      composing link the 2026-08-06 amendment declined on — one certificate admits exactly one
      identity.
    evidence: >-
      Re-planted by the fourth-pass verifier on 2026-08-07 and WATCHED going red, which the
      2026-08-06 pass could not do. `packages/node/src/fabric-node.ts` in `relayAdmissionGate`,
      `if (certificate.nodeKey !== expected)` -> `... && expected === ''`: `PLANTED_P1_EXIT=1`,
      `Tests 1 failed | 59 passed (60)`, the failure being arm 1 of
      `relay-admission.node.test.ts`'s new case — `AssertionError: expected false to be true` at
      `:1466`, i.e. the door ADMITTED a peer holding somebody else's certificate. Matched clean
      baselines on the same two files, same command, before and after: 60 passed, exit 0 twice.
      The both-ways control holds: the identical edit in `packages/node/src/peer-verifier.ts:678`
      leaves the new door case GREEN while reddening `peer-verifier.node.test.ts`'s own borrowed
      row (`expected true to be false` at `:482`) — two copies of one comparison, two separate
      guards, neither standing in for the other.
    bound: "Closes carrying `carried_bound` above verbatim. See the 2026-08-07 amendment for the two limits stated at the verdict."
gaps: []
deferred: []
human_verification:
  - test: "Decide who owns the one leg of AUTH-02 that no phase currently names: a browser tab cannot pin an issuer. `BrowserNodeOptions` has no `trustedIssuers` field, `peer-verifier.ts` lives in `@o2/node`, and `@o2/browser` does not depend on it."
    expected: "Either a phase is given the leg, or the asymmetry is recorded in ROADMAP.md as accepted. AUTH-02 cannot be ticked while it stands."
    why_human: >-
      A scheduling decision, and it is NOT a criterion-3 matter and NOT a Phase 17 defect — a tab
      is now taken by pinning peers on identical terms. It is carried unchanged from the
      2026-08-05 amendment. Phase 24's own note records that the front door has no
      `trustedIssuers` either, which is a different leg of the same absence. The phase scores 3/3
      on its criteria; this item is why `status` is `human_needed` rather than `passed`.
  - test: "Adjudicate the reading of criterion 3's word `costly`. This close delivers a BOUND made durable plus DEVALUATION (an unissued identity buys nothing at a closed door), not a GRADUATED price — the N-th identity is refused inside the window rather than priced above the first."
    expected: "Confirm the 2026-08-04 devaluation ruling governs criterion 3 as it governed Phase 19 criterion 5, which closed at 5/5 on it (`ac7b214`)."
    why_human: >-
      An owner reading, not a measurement. It is recorded rather than assumed because
      `REQUIREMENTS.md`'s AUTH-04 row states in its own words that a verifier reading the clause
      as requiring a rising cost should score it PARTIAL, and `8719029`'s own message repeats it.
      This verifier applied the 2026-08-04 ruling because the owner routed criterion 3's cost
      clause to criterion 8 and criterion 8 is MET on that ruling — but the ruling is the owner's
      to confirm, not a verifier's to assume.
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

This is a correct, well-evidenced self-report, and it deserves saying: it is asserted, not merely
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
never obtain one. So the moment an operator passes `--trusted-issuer` — the flag this phase exists
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

---
---

# AMENDMENT — 2026-08-05, re-verification against the current tree

**Amended:** 2026-08-05T02:11:20Z
**Tree:** `cb01e76`, branch `feature/phase-18-discovery-capacity-placement` (shared checkout)
**Status after amendment:** `gaps_found`
**Score after amendment: 2/3** (criterion 1 MET, criterion 2 **MET — newly**, criterion 3 PARTIAL)

Everything above stays as it was written on 2026-08-01 and is still the correct record of that
day. This amendment records what four days of landed work changed, what it did not, and which of
the sentences above are now **false as statements about the current tree**. Nothing here was taken
from a SUMMARY. Every verdict below rests on a command this verifier ran or a plant it watched go
red.

**Citations in this amendment are by grep-able SYMBOL, not by line.** The original report cites
by line and those numbers have drifted — `loadOrCreateSeed(options.blockstoreDir, IDENTITY_FILE)`
is no longer at `fabric-node.ts:884` but at `:1186`, and `privateKey: identity.privateKey` is at
`:1221`, not `:919`. The mechanism is unchanged; the numbers rotted. This is the same rot the
ROADMAP recorded as warnings W2 and W9.

---

## Criterion 1 — regression check: **still MET**

**Command:** `npx vitest run --project node packages/node/src/enrollment.node.test.ts packages/node/src/enrollment-cost.node.test.ts packages/node/src/peer-dial.node.test.ts packages/node/src/certificate-verification.node.test.ts packages/node/src/fs-issuance.node.test.ts`
**Result:** `Test Files 5 passed (5) | Tests 27 passed (27)`, `EXIT=0`.

The cross-process criterion-1 test — *generates an identity on-device, enrols against a provider
process, and advertises a certificate a peer can fetch and verify* — is green, and the mechanism
it names is intact under its current symbols: `loadOrCreateSeed(options.blockstoreDir,
IDENTITY_FILE)` feeding `privateKey: identity.privateKey` at `createLibp2p` in
`packages/node/src/fabric-node.ts`.

**Second suite, run for regression rather than for a criterion:**
`peer-gate`, `peer-verifier`, `node-enrollment`, `node-identity`, `identity-store`,
`acceptance-traceability`, `requirements-ledger`, `enrollment-dos` →
`Test Files 8 passed (8) | Tests 125 passed (125)`, `EXIT=0`.
`npx tsc --noEmit` → `EXIT=0`.

---

## Criterion 2 — **PARTIAL → MET**

> A second node started via `bin/agent.ts` verifies the first node's certificate offline, with no
> live call to any certificate authority, before treating it as a legitimate peer, and rejects a
> self-signed or forged certificate with a named reason

### What changed

Plan **18-01** added `--peer-addr` to `bin/agent.ts` (`9748608`, 2026-08-01), which is exactly the
capability the 2026-08-01 report named as missing. The flag is real production surface: the parse
entry `'peer-addr': { type: 'string', multiple: true }`, the dial loop
`for (const address of values['peer-addr'] ?? [])`, and a refusal that names the flag and its
value — `--peer-addr <addr> could not be dialled` — before any handshake line is printed.

### The reading, and why it is a reading

`packages/node/src/peer-dial.node.test.ts`, `describe('AUTH-02 — a spawned agent dials a peer and
accepts it')`. Five OS processes: a spawned provider **P**, a spawned enrolled peer **A**, and
three spawned verifiers that differ from each other in exactly one argument —

| Arm | Argument that differs | Outcome asserted |
|---|---|---|
| **V** | `--trusted-issuer <P's issuer>` | `{ ok: true, output: { a: 1 } }` — it fetched a module and an input that exist in **one** blockstore in the world (A's, seeded with `FsBlockstore` *before A was spawned*) and ran them |
| **W** | `--trusted-issuer <64 hex nobody holds>` | `ok: false`, and the reason asserted by **text** — `block missing` naming `moduleCid` |
| **U** | no `--trusted-issuer` at all | `{ ok: true, output: { a: 1 } }` |

W is what stops "V accepted A" collapsing into "the bytes were reachable anyway". U is what stops
it collapsing into "the dial itself is what made the fetch work". All three read
`peers: [a.peerId]` off their own handshake lines first, so "it never connected" is not available
either.

### The offline clause, cross-process — and it is stronger than a timing argument

The provider **P is stopped and its death asserted** before any dispatch. But the load-bearing
fact is not the ordering: **V is never told P's address.** Its arguments are `--dir`,
`--trust-anchor`, `--trusted-issuer <hex>` and `--peer-addr <A>`. A 64-character public key is not
dialable, and `bin/agent.ts` has no other flag that could reach an authority. A spawned verifier
therefore *cannot* consult the CA, by construction, and the in-process dead-authority reading
above (`certificate-verification.node.test.ts`, both providers killed and asserted dead before the
verifier exists) remains as the falsification. `PeerVerifier` imports the pure `verifyCertificate`
from `@o2/core`, takes its anchors as an argument, and the only network I/O on the path is
`this.#rpc.request(peerId, encodeRequest({ kind: 'records', nodeKey: expected }))` — to the peer
itself.

### The named-refusal clause

Unchanged and still MET: `{ kind: 'untrusted-issuer', issuer: p2.issuerKey }` under `toStrictEqual`
against a spawned agent, with the literal self-signed shape (`issuer === nodeKey`) and
`bad-signature` refused by name in `packages/net/src/enrol-protocol.test.ts` and
`packages/node/src/peer-verifier.node.test.ts`.

### Plant R1 — the accepting reading watched going red

I did not accept the three-arm design as sufficient on inspection.

`packages/node/src/peer-verifier.ts`, in `get verifiedPeers()`:
`return peers.filter((peer) => this.#verdicts.get(peer)?.ok === true)` →
`… ?.ok === true && peer === '')` (always false, chosen over deleting the branch so the plant
cannot fail typecheck for an unrelated reason).

**Command:** `npx vitest run --project node packages/node/src/peer-dial.node.test.ts`
**Result:** `PLANTED_EXIT=1` — `Tests 1 failed | 5 passed (6)`:

```
× fetches a block held only by the dialled peer, refuses the identical dispatch when it pins
  another issuer, and succeeds when it pins nobody
Error: timed out waiting for V to accept A and fetch the module from it
```

The failure is the **accepting** half specifically, which is the clause that was NOT MET. Restored
by `cp` from `/tmp/p17-reverify-baseline/`, `cmp` exit 0. No git command touched the file.

### Verdict

**MET.** Every clause of criterion 2 is now measured, and the two clauses that were NOT MET are
each carried by a spawned process. This is not a widening: the criterion's text is unchanged and
the code caught up to it.

Recorded for the record: ROADMAP Phase 18 criterion 2d is the same clause, and Phase 18's own
RULING A states the convention that a routed clause does not close the routing phase. That rule
governs *rewriting a criterion*, not *re-reading a criterion after the work lands*. The work
landed; the reading is taken.

---

## Criterion 3 — **PARTIAL, still** — and the reason has changed, which matters more than the score

> Attempting to enroll many node identities in a burst through the same entry point is
> rate-limited — refused beyond a stated threshold rather than accepted unbounded — making mass
> fake-node creation measurably costly

### Both 2026-08-01 escapes are closed, and both are measured

The original report listed two `missing` items. Both were delivered.

**1 — "a cost term at the limiter … so that minting a fresh user key is not free."**
Plan 19-05 added `maxIssuedPerWindow` to `EnrollmentAuthority`: a bound on how many certificates
one provider signs per window *whoever asked*, checked after the per-user window and immediately
before issuance, refused as `{ kind: 'issuance-budget-exhausted', limit, windowMs, retryAfterMs }`
and reported on the wire as `this provider has issued N certificates in the last Xms (limit N)`.
The refusal names the provider's budget and **not** the requester — asserted, including
`Object.keys(refusal)` containing neither `userKey` nor `nodeKey`.

The exact population that defeated the old limiter is run against it with a control in the same
run (`packages/core/src/enrollment.test.ts`, *refuses past its stated number however many free
keygens the requester mints*): 20 fresh user keys against `maxIssuedPerWindow: 5` → **5 accepted**,
every refusal `issuance-budget-exhausted`; the identical 20 against an authority stating
`'issues-without-an-aggregate-budget'` → **20 accepted**.

The sentinel is **not reachable from the entry point the criterion names**:
`bin/agent.ts` refuses `--issues-certificates` without `--max-issued-per-window <n>`, refuses the
flag without the other, and refuses a value below 1 or non-numeric by name — each measured as a
real exit-2 spawn in `enrollment-cost.node.test.ts`.

**2 — "issuance history that survives a provider restart."**
Plan 19-07 added `FsIssuance` over `<dir>/.issuance`, written with a synchronous append so the
record precedes the reply. Measured across real processes in
`packages/node/src/enrollment-cost.node.test.ts`: a provider at budget 1 certifies the first
enroller; a second enroller **under a freshly generated user key** — the population the per-user
limiter does not bound — is refused with the aggregate reason on stderr and no usage line; the
provider is stopped and confirmed dead; it **restarts on the same `--dir` as a different pid with
the same issuer key and still refuses**; and a provider on another directory is a different
provider whose certificate a peer pinning the first refuses `untrusted-issuer` by name.

### Two plants, both watched going red

**M54, through the repository's own harness** (`node --experimental-strip-types
packages/node/src/mutation-guard.mutate.ts --only=M54`) — the aggregate issuance block deleted
from `packages/core/src/enrollment.ts`:

```
M54  packages/core/src/enrollment.ts … caught (1.3s)
M54  PASS  caught  exit 1 with the recorded signature
git status --porcelain is empty — the tree is as it was found.
```

**R2, mine, because nothing in the mutation ledger pins the durable half.**
`packages/node/src/fs-issuance.ts`, in `FsIssuance.open`: `return new FsIssuance(path, kept)` →
`return new FsIssuance(path, kept.filter(() => false))` — the ledger still appends, and forgets
everything on reconstruction.

**Command:** `npx vitest run --project node packages/node/src/fs-issuance.node.test.ts packages/node/src/enrollment-cost.node.test.ts`
**Result:** `PLANTED_R2_EXIT=1` — `Tests 5 failed | 7 passed (12)`, and the cross-process one
failed at exactly the restart step:

```
× refuses by name past its stated budget, and still refuses after being restarted on the same directory
Error: agent in …/n3 announced instead of leaving — it was certified where a refusal was expected
```

Restored by `cp`, `cmp` exit 0.

### The cost clause is still NOT MET — and it is an ADMISSION property, not a SELECTION one

This is the finding of this amendment, and it is worth more than the score.

The aggregate budget bounds **how many certificates a provider signs**. The criterion asks that
**mass fake-node creation** be costly. Those are the same thing only if a node without a
certificate cannot be a node. In this tree it plainly can:

- `packages/node/src/peer-verifier.ts` — `get verifiedPeers()` opens
  `if (this.#trustedIssuers.size === 0) return this.#peers()`. Pinned nobody means trust
  everybody.
- `packages/node/src/fabric-node.ts` — `readonly trustedIssuers?: readonly PublicKeyHex[]`,
  optional, defaulting to `new Set(options.trustedIssuers ?? [])`. Nothing in the tree pins one
  by default.
- `packages/node/src/seed-server.ts` — grep for `trustedIssuers`, `certificate`, `verifyCert`
  returns **nothing**. Every reservation holder is published to every arriving peer, unfiltered.

So an unissued identity today joins, is advertised, is dialled, and is used by every peer that
pinned nobody. Bounding issuance therefore bounds only which peers a *pinning* node will
**select**, not who may **join**. That is why the counter cannot deliver "costly", and it is the
milestone's own conclusion: the owner ruled on 2026-08-04 that Phase 19's criterion 5 — the
routed cost clause — is answered by **Phase 24 criterion 8**, in these words: *"A price only
deters when the thing bought is worth something … under gated admission an unissued identity is
worth NOTHING."*

The enrol path is additionally cheaper for the attacker than for the defender, measured rather
than argued: `packages/node/src/enrollment-dos.node.test.ts`, *costs an attacker less to mint an
identity than it costs the provider to refuse it* — nine readings across a thirty-fold range of
host load, all inside **2.96–3.16×**, and 3758–7501× for the replay arm, because
`possessionChallenge` carries no nonce. And one dialer can spend a three-certificate window and
lock out an honest enroller by name. That exposure is **accepted deliberately** by owner decision,
not mitigated — it is recorded here because a criterion clause asking for cost cannot be scored
met against a path where the attacker pays a third of what the defender does.

### Verdict

**PARTIAL.** The rate-limiting clause is met in full, is durable, and is stated on the wire. The
cost clause is not met, cannot be met by the enrolment counter, and belongs to **Phase 24
criterion 8**. Phase 17 is not counted as closing on it — the ROADMAP's own standing rule.

---

## The 2026-08-01 browser gap — **CLOSED, and the closure is measured**

The tracked defect *"a browser node cannot obtain a certificate — equal-functionality gap opened
by Phase 17"* stayed closed. Verified from source and from a live tab, not from a summary.

`packages/browser/src/browser-node.ts` now carries, all of which the original report recorded as
absent:

- an on-device seed with a stated policy for its loss —
  `whenSeedIsGone: 'mints-a-new-identity' | 'refuses-to-start-without-its-seed'`, over
  `IdbIdentityStore`;
- `privateKey: identity.privateKey` passed to `createLibp2p`;
- an `enrollment` option and a real round trip — `requestEnrollment(identity.seed,
  enrollment.userPrivateKey, …)` inside `resolveCertificate`, with the certificate persisted via
  `identityStore.saveCertificate(outcome.certificate)`;
- a public `readonly certificate: NodeCertificate | null` on `BrowserNode`;
- `serveAgent` hooks that are no longer unconditional sentinels: `index: records`, and
  `enroll: authority ?? 'issues-no-certificates'` — a tab can itself issue.

**The reading:** `packages/node/src/browser-enrollment.e2e.test.ts`, four tests, `EXIT=0`. One
gate node with one pinned issuer is asked about a tab **twice**: an uncertificated tab is excluded
and the refusal named `no-records`; an enrolled tab reaches `verdictFor(...) === 'verified'` and
appears in `gate.verifiedPeers` — the same list `RpcBlockSource` reads. The certificate's
`nodeKey` resolves through `peerIdForNodeKey` to that tab's own peer id, and its `userKey` is
derived from a private key the tab was configured with rather than passed as a field.

**Plant R3 — because a 3.2 s wall clock for a Playwright + Vite + two-FabricNode e2e is not
plausible on its face, and plausibility is not evidence.** In
`packages/browser/src/browser-node.ts`, `resolveCertificate`:
`if (enrollment === undefined) return null` → `if (enrollment === undefined || enrollment !==
undefined) return null`.

**Result:** `PLANTED_R3_EXIT=1` — the enrolling test fails on `expected null not to be null` at
`expect(held).not.toBeNull()`, where `held` is read out of the live tab via
`page.evaluate(() => window.o2capability.certificate())`; the other three stay green. The file is
live, the timing is genuine, and the instrument reads both ways. Restored by `cp`, `cmp` exit 0.

**One leg of AUTH-02 is still open, and no phase names it.** A tab still cannot **pin** an issuer:
`BrowserNodeOptions` has no `trustedIssuers` field, `peer-verifier.ts` lives in `@o2/node`, and
`packages/browser/package.json` has no `@o2/node` dependency. This is materially different from
the defect Phase 17 opened — a tab is now *taken* by pinning peers on identical terms, so the
fabric no longer partitions — but a tab cannot *refuse* anyone, which is functionality rather than
discovery. REQUIREMENTS.md's AUTH-02 row already calls it *"the remaining leg"*; Phase 24's own
note records that `SeedServerOptions` has no `trustedIssuers` either. It is escalated above for a
routing decision rather than filed against Phase 17, whose criterion 2 names `bin/agent.ts`.

---

## What in the 2026-08-01 report is now measured FALSE

Every one of these was true when written. They are listed because the report reads like current
evidence and is now partly stale — and because in this repository a wrong recorded diagnosis has
been the rule rather than the exception.

| Claim above | Now | Evidence |
|---|---|---|
| *"`bin/agent.ts` … no bootstrap/dial/connect flag"* and *"the accepting half is unreachable through the binary … by construction"* | **FALSE** | `'peer-addr': { type: 'string', multiple: true }` and its dial loop in `bin/agent.ts`; `peer-dial.node.test.ts` takes the accepting reading across five processes |
| *"the history is a `Map` in the authority object … so the threshold is per provider **uptime**"* | **FALSE as a diagnosis** | Since 19-07 the record is `FsIssuance` over `<dir>/.issuance`, and `enrollment-cost.node.test.ts` measures a restart on the same directory **still refusing**. Two providers now have two budgets because they are two *directories*, by design — the observable in `enrollment.node.test.ts` is unchanged, its stated cause is not |
| *"20 distinct user keys yield 20 certificates unslowed … nothing is made costly"* | **CONDITIONAL now** | True only against a provider that states a budget ≥ 20; the surviving cross-process test pins `--max-issued-per-window 64` deliberately so it stays a reading about the *per-user* limiter. Against a stated budget below the population, 5 of 20 are accepted and the rest refused `issuance-budget-exhausted` |
| *"`browser-node.ts:387` `createLibp2p({…})` with no `privateKey`; `:622 index: 'serves-no-records'`; `:626 enroll: 'issues-no-certificates'` — both unconditional"* | **FALSE** | `privateKey: identity.privateKey`; `index: records`; `enroll: authority ?? 'issues-no-certificates'` |
| *"No later phase in ROADMAP.md covers browser enrollment, so this is not deferrable to one"* | **MOOT** | It was closed without a phase, on the same day, by `3775323` and `c885271` |
| *"Closing [the cost clause] needs either a cost term at the limiter or an amendment to the criterion"* | **INCOMPLETE, not false** | A cost term at the limiter landed and the clause is still not met, because the clause is about admission. The third option the report did not see is the one the owner took |
| Line-number citations throughout (`fabric-node.ts:884,919`, `peer-verifier.ts:200-202`, `enrollment.ts:287-300`, `browser-node.ts:387`) | **DRIFTED** | e.g. `loadOrCreateSeed(…, IDENTITY_FILE)` is at `:1186` and `privateKey: identity.privateKey` at `:1221`. Cite by symbol |

One claim I re-tested and **confirmed still true**: `@o2/browser` does not depend on `@o2/node`,
so `PeerVerifier` remains structurally unreachable from a tab.

---

## Mutations planted by this amendment

All baselines taken with `cp` into `/tmp/p17-reverify-baseline/`; every restore confirmed with
`cmp` exit 0. No `git checkout` / `restore` / `stash` / `reset` / `clean` at any point — the tree
is shared, and it was checked for a concurrent `vitest run` immediately before each plant.

| id | file | mutation | run | result |
|---|---|---|---|---|
| **R1** | `packages/node/src/peer-verifier.ts` | `verifiedPeers` filter made always-false | `peer-dial.node.test.ts` | **caught** — `timed out waiting for V to accept A and fetch the module from it` |
| **R2** | `packages/node/src/fs-issuance.ts` | `FsIssuance.open` forgets its record on reconstruction | `fs-issuance` + `enrollment-cost` | **caught** — 5 failed, incl. the cross-process restart: *"n3 announced instead of leaving — it was certified where a refusal was expected"* |
| **R3** | `packages/browser/src/browser-node.ts` | `resolveCertificate` always returns `null` | `browser-enrollment.e2e.test.ts` | **caught** — `expected null not to be null` on the tab's own `certificate()` |
| **M54** | `packages/core/src/enrollment.ts` | aggregate issuance budget deleted (repo harness) | `enrollment.test.ts` | **caught** — recorded signature, tree byte-identical after |

Final tree check: `git status --porcelain` shows only two other verifiers' `*-VERIFICATION.md`
files. None of the three files I planted in appears.

---

## Amended requirements coverage

| Requirement | Status | Change | Evidence |
|---|---|---|---|
| AUTH-01 | SATISFIED, **both tiers** | was "Node tier only" | `loadOrCreateSeed` → `privateKey` on both factories; `enrollment.node.test.ts` (Node, cross-process) and `browser-enrollment.e2e.test.ts` (live tab) |
| AUTH-02 | PARTIAL | accepting half **closed**; one leg opened for routing | `peer-dial.node.test.ts` closes the `bin/agent.ts` half. Still open: a tab cannot pin an issuer |
| AUTH-04 | PARTIAL | rate-limiting now aggregate + durable; cost clause moved to Phase 24 | `enrollment-cost.node.test.ts`, `fs-issuance.node.test.ts`, `enrollment.test.ts`; cost clause = Phase 24 criterion 8 |

**Ledger still not edited** — AUTH-02 and AUTH-04 remain partial, and `requirements-ledger` /
`acceptance-traceability` are green as they stand (125/125 in the second suite above). Note for
whoever moves them: REQUIREMENTS.md's AUTH-04 row already names Phase 19, and the owner has since
moved the cost clause again, to Phase 24. That row will need a second correction.

---

## What closing the last gap requires — and where it lives

**Criterion 3's cost clause. Phase 17 cannot close it; Phase 24 can.** The work is
certificate-gated **admission**: a node that cannot present a provider-issued certificate cannot
reserve a circuit, be advertised by `SeedServer`, or be dialled. Concretely — a `trustedIssuers`
field on `SeedServerOptions` and a check where there is none today, a gater or ACL on
`circuitRelayServer`, which is constructed with capacity limits only, and a resolution of the
topology fact Phase 24 already records: enrolment is a **direct** dial on both tiers and does not
route through a reservation, and for a browser tab the provider and the relay are the same node at
the same address. Nothing in that list belongs to Phase 17, and none of it should be attempted
here.

**Not to be filed against Phase 17, recorded so it is not re-filed:** the enrol-branch DoS. It is
measured (`enrollment-dos.node.test.ts`), priced (2.96–3.16×), and **accepted deliberately** by
owner decision rather than mitigated. The mitigation everyone reaches for is measured not to work:
a capacity slot on the `enrol` branch served 8 of 8 concurrent enrolments, because `enrol` is
synchronous so the bound never binds.

---

## Amended gaps summary

Two of the three things standing between this phase and its goal on 2026-08-01 are gone, and both
were closed by real mechanisms watched failing under a plant rather than by argument.

**Criterion 2 is met.** `--peer-addr` gave the binary the one capability it lacked, and the
accepting reading is now taken across five processes with a negative control and a no-anchor
control on the same wire. A verifier spawned this way is never given the authority's address, so
"offline" is a property of what it *can* do, not of when the provider died.

**The browser gap is closed.** A tab holds its own seed across reloads, enrols, holds a
certificate naming its own peer id, and is taken by a `--trusted-issuer` node as a block source —
read off a live tab, with the excluded case run first in the same file so the instrument is known
to read both ways.

**Criterion 3 is still PARTIAL, and now for a better-understood reason.** Both escapes the
original report used to defeat the cost clause are closed and measured. What remains is not a
missing counter but a missing door: every certificate check in this repository gates *selection*,
none gates *admission*, so an unissued identity still costs nothing because it still buys
something. That is Phase 24 criterion 8 by owner ruling, and Phase 17 does not close on it.

**2/3**

---

_Amended: 2026-08-05T02:11:20Z_
_Verifier: Claude (gsd-verifier), goal-backward re-verification_

---

## Amendment — 2026-08-06: criterion 3 stays **PARTIAL**, and the score stays **2/3**

**Score: 2/3 → 2/3 criteria.** Everything above — the 2026-08-01 initial pass and the
2026-08-05 amendment — is left standing; **nothing in either is retracted**, and the frontmatter
above is untouched. This amendment adds a reading and changes no score.

This is a re-verification triggered by the destination phase landing: `24-VERIFICATION.md`'s
dated amendment of 2026-08-06 (`580e461`) re-scored Phase 24 criterion 8 from PARTIAL to **MET**,
which is RULING A's precondition for the criterion carried into it. It is an independent pass:
**every reading below was executed in this verifier's own process** and none of it is transcribed
from `24-VERIFICATION.md`, from any `24-*-SUMMARY.md`, or from `STATE.md`. Both plants below are
this verifier's own; neither is `M54`, `M66` nor `R2`.

**Re-verified:** 2026-08-06/07 (UTC `2026-08-07T04:31:56Z`), at `1028cc1`, working tree clean
before and after, `git status --porcelain` empty at both ends.
**Verdict:** criterion 3 **PARTIAL**, phase **2/3**, `status: gaps_found` — unchanged.

**The short form.** The carry is sound and its precondition is satisfied. The clauses genuinely
match, and the match is mechanical rather than rhetorical — this verifier found the exact
production line that turns criterion 8's *"an unissued identity buys nothing"* into criterion 3's
*"mass fake-node creation is costly"*, and read it. **What it then found is that nothing observes
that line.** Removing it leaves eight test files and every one of their tests green across five
independent runs. Criterion 3's own word is *measurably*, and the link that carries the cost is
**unmeasured**. Separately, the file that owns the door's refusal reasons reddens **fail-open**
on an unmutated tree, twice in twelve executions, and no artifact in `.planning/` records it.

---

### The criterion text is unchanged — checked rather than assumed

`.planning/ROADMAP.md:491` was extracted to a file, and the two quotations of it inside this
document — at `17-VERIFICATION.md:175-177` (initial pass) and `17-VERIFICATION.md:568-570`
(2026-08-05 amendment) — were extracted and byte-compared against it:

```
CMP_ROADMAP_VS_ORIGINAL=0
CMP_ROADMAP_VS_AMENDMENT=0
```

`git log -L491,491:.planning/ROADMAP.md` returns **exactly one commit** —
`c3e6fe1adf86356d261d3e2a791d2afc908209ae` (2026-07-27, *"docs: create milestone v1.1 roadmap
(12 phases, 44 requirements)"*) — and the diff hunk it prints is the line's **addition**. The
line has never been edited since the milestone was written.

> 3. Attempting to enroll many node identities in a burst through the same entry point is
>    rate-limited — refused beyond a stated threshold rather than accepted unbounded — making
>    mass fake-node creation measurably costly

`criterion_text_unchanged: true`. This amendment scores against the same contract the 2026-08-01
pass did, and it does not rewrite it. **RULING A is honoured in both directions**: the criterion
was not softened to let the phase close, and it was not stretched to keep the phase open.

### The destination, quoted, and its verdict read at the source

`.planning/ROADMAP.md:1189` was extracted and byte-compared against the quotation carried at
`24-VERIFICATION.md:173-177`: `CMP_CRIT8=0`. `git log -L1189,1189:.planning/ROADMAP.md` returns
exactly one commit — `3cc5a83` (2026-08-04) — so criterion 8's words are unedited too.

> 8. Enrolment's cost is bounded by admission, not by a counter: a node that cannot present a
>    provider-issued certificate cannot join the fabric, advertise itself, or be dialled by
>    another node — so an identity that was never issued buys nothing, and the N-th identity
>    costs an attacker a provider's willingness to sign it

`git show --stat 580e461` — *"verify(24): criterion 8 is MET with a stated bound — 0/1 becomes
1/1"*, 2026-08-06 21:10:56 -0700, **one file changed, 513 insertions, 0 deletions**. It is an
append-only dated amendment to `24-VERIFICATION.md`, exactly as claimed; no existing line of that
file was rewritten. Criterion 8 reads **MET**, at 1/1, on the evidence of four gap-closure plans
(`68be6a9`, `afe8b0b`, `241a9cc`, `1b7f99d`), two of the destination verifier's own plants, and a
`--project e2e` reading in three engines.

### The bound criterion 8's MET carries, quoted verbatim

This is reproduced word for word from `24-VERIFICATION.md:819-826`, because a carried criterion
cannot inherit more than its destination delivered and this amendment would have to carry it if
it closed:

> **The bound this MET carries, stated at the verdict rather than in a footnote.** The default
> posture of `bin/agent.ts`, `bin/seed.ts` and `bin/bench.ts` is **open**, and must be: nineteen
> `bin/agent.ts` and three `bin/seed.ts` argv sites depend on it, and
> `reservation-exhaustion.node.test.ts` arm A is a **live behavioural guard** on it — read at the
> source, lines 285-317: *"a seed whose no-flag posture had become anything but
> `'admits-any-peer'` reddens here, by name, before B is ever read"*, backed by
> `expect(a.stderr()).not.toContain('PERMISSION_DENIED')`. Criterion 8 is MET **of a fabric an
> operator has closed**, and this repository ships open by default on purpose.

**This verifier checked the bound's substance rather than accepting the sentence.** The
default-open ternary is real and is in both binaries — `packages/node/src/bin/seed.ts:197-198`
and `packages/node/src/bin/agent.ts:900-901`, both reading
`values['admit-issuer'] === undefined ? 'admits-any-peer' : new Set(values['admit-issuer'])` —
and `reservation-exhaustion.node.test.ts:285-317` does contain arm A in the words quoted, with
the `PERMISSION_DENIED` assertion at the line. The arithmetic *"nineteen plus three"* originates
in `24-06-PLAN.md:275` and is carried by the destination; this verifier did **not** independently
recount it and does not certify the two integers.

The bound is not why criterion 3 stays open. It is recorded because the ledger edits below need
it, and because if a later verifier does close criterion 3 it must carry the block above intact.

---

### The crux: do the two clauses actually match? **Yes — and the match is mechanical**

This is the question that could have gone the other way, and it was asked of the source rather
than of the two roadmap sentences.

**Criterion 3's carried half is its cost clause**, and the 2026-08-05 amendment above named
precisely what was missing from it, in its own words at `17-VERIFICATION.md:637-639`:

> The aggregate budget bounds **how many certificates a provider signs**. The criterion asks that
> **mass fake-node creation** be costly. Those are the same thing only if a node without a
> certificate cannot be a node.

Criterion 8 delivers exactly that conjunct — *"a node that cannot present a provider-issued
certificate cannot join the fabric, advertise itself, or be dialled by another node"*. It is the
same proposition, not an adjacent one, and the three specific facts the 2026-08-05 amendment
listed as falsifying it (`peer-verifier.ts` failing open, `FabricNodeOptions.trustedIssuers`
optional, `seed-server.ts` with no certificate check) are the three the destination phase closed.
**The clauses match. The routing was correct and the owner ruling of 2026-08-04 was not a
rewrite.**

**And the composition needs a third link that neither roadmap sentence names.** Criterion 3 is
about *mass* creation — the marginal cost of the N-th identity. Bounded issuance plus "an
unissued identity buys nothing" only yields a per-identity price if **one certificate admits
exactly one identity**. If a certificate could be presented at the door by a second peer id, an
attacker buys one signature and mints N nodes, and the N-th identity is free again — which is
verbatim the defect the 2026-08-01 pass recorded.

**That link exists in production source, and this verifier found and read it.**
`packages/node/src/fabric-node.ts:899` derives `expected = nodeKeyForPeerId(peerId)` — the node
key the joining peer already proved possession of over Noise — and `:949-958` refuses when the
presented certificate names a different one:

```ts
      if (certificate.nodeKey !== expected) {
        // Not redundant with the signature check below, and the difference is the whole of
        // what admission means: the peer proved possession of exactly one key over Noise, so
        // a certificate naming a different one is somebody else's, presented perhaps by a
        // node that copied it off the wire.
        return decide(
          false,
          `${peerId} presented a certificate for ${certificate.nodeKey}, but its peer id implies ${expected}`,
        )
      }
```

The docblock states the check is load-bearing and **not** redundant with the signature check
below it, and it is right: `verifyCertificate(certificate, issuers, now)` takes the certificate
and the pinned issuer set and cannot know which peer is holding it.

---

### Why criterion 3 still does not close: **the composing link is unmeasured**

**Plant P1 — this verifier's own, unledgered.** `packages/node/src/fabric-node.ts`, in
`relayAdmissionGate`, the certificate-to-peer binding neutralised while leaving every type,
every symbol and both refusal strings byte-for-byte intact:

```diff
-      if (certificate.nodeKey !== expected) {
+      if (certificate.nodeKey !== expected && expected === '') {
```

`expected` is a 64-character lowercase hex string at that point (it is null-checked at `:900`),
so the guard is dead and a certificate naming **any** node key is carried straight to
`verifyCertificate`. A relay that pins issuer A now admits any peer that presents *any*
A-signed certificate, including one lifted off the wire from a node that legitimately holds it.

**It was not caught. Five runs, eight files, all green.**

| Run | Command (all `npx vitest run --project node`) | Exit | Result |
|---|---|---|---|
| P1-a | `relay-admission.node.test.ts` | **0** | 37 passed |
| P1-b | `relay-admission.node.test.ts` | **0** | 37 passed |
| P1-c | `relay-admission.node.test.ts` | **0** | 37 passed |
| P1-d | `relay-admission.node.test.ts` | **0** | 37 passed |
| P1-wide | `closed-fabric-agents` + `admission` + `admission-agents` + `enrol-through-a-closed-door` + `enrolment-needs-no-reservation` + `reservation-exhaustion` + `peer-verifier` | **0** | **7 files, 43 passed** |

Every exit code read with `EXIT=$?` on the immediately following line. The plant was restored
with `cp`, confirmed with `cmp` **exit 0**, `git diff --quiet` over the **whole tree** exit 0, and
`shasum -a 256` back to `d6688f731cd472525ef21f1f331e708465686005c7c27ade7788da106ca15648`.

**The absence was then confirmed from the other direction, by reading rather than by grepping
for green.** The borrowed-certificate case does exist in this repository — exactly once, at
`packages/node/src/peer-verifier.node.test.ts:448`, *"refuses a certificate borrowed from another
node as nodeKey-mismatch, naming both keys"*, and `17-05-SUMMARY.md:304` records this phase's own
executor planting `peer-verifier.ts`'s copy of the check and watching it redden. **That guards
`PeerVerifier`, which is SELECTION.** The relay gate's copy — ADMISSION — has no counterpart:
neither `relay-admission.node.test.ts`, nor `closed-fabric-agents.node.test.ts`, nor
`gated-admission.e2e.test.ts`, nor `gated-seed.e2e.test.ts` contains a peer that presents a
certificate it does not own. Their axis is *enrolled versus unenrolled* — presence and absence —
and the borrowed axis is not on it. A grep of `.planning/` for `nodeKey !== expected`,
`its peer id implies` and `presented a certificate for` returns three hits, **all three about
`peer-verifier.ts`**, none about the door.

**The judgement, and it is this verifier's own.** Criterion 3's verb is *"making mass fake-node
creation **measurably** costly"*. On a closed fabric the price of the N-th identity is a
provider's signature **only while a signature cannot be re-presented**, and that premise is
carried by one unobserved `if`. This repository's own convention is *"a proof that cannot fail is
not a proof"* and *"unmeasured is not met"*. The cost clause is therefore still **not measured**,
and criterion 3 is **PARTIAL**.

This is not a claim that the mechanism is wrong. It is correct by reading, its docblock states
its purpose accurately, and this verifier believes it works. It is a claim that **nothing in the
repository would notice if it stopped**, which is the difference between a delivered property and
a believed one — and the whole reason RULING A exists.

---

### A second finding, recorded in no artifact: the door's own test reddens **fail-open**

While establishing the baseline for P1, `relay-admission.node.test.ts` failed **on an unmutated
tree**, at the assertion the file's own comment calls *"the load-bearing arm"*:

```
 FAIL  |node| packages/node/src/relay-admission.node.test.ts > AUTH-02 — the relay consults
 RelayAdmission at the reservation, and only there > refuses a peer with no certificate, admits
 one from the pinned issuer, and refuses one from another — each by name
AssertionError: expected [ …(2) ] to not include '12D3KooWGBms8uwLisZMUcZs3HoNfuL3ws4oc…'
 ❯ packages/node/src/relay-admission.node.test.ts:1132:41
    1131|       expect(theirs.certificate).not.toBeNull()
    1132|       expect(relay.reservedPeerIds).not.toContain(theirs.peerId)
```

`theirs` is a node enrolled with **providerB**, meeting a relay that pins **providerA**. The
observed event is that it **held a reservation** — the exact thing criterion 8 says cannot
happen, on a tree whose two mutated files were `shasum`-confirmed identical to `HEAD`.

**Frequency, measured rather than guessed.** Twelve executions of that arm across this session —
one four-file run, one three-file run and ten single-file runs, six on the clean tree and four
under P1 (P1 provably does not change that arm's expected outcome, since a certificate from an
unpinned issuer is refused by `verifyCertificate` either way): **2 failures in 12**, both with the
identical assertion and the identical shape, at host loads of 7.54 and 10.90 with passes observed
at loads from 6.78 to 15.60. Load does not separate them.

**What this verifier did not establish** is whether the race is in the fixture or in the gate —
whether `theirs` reached the reservation before `denyInboundRelayReservation` was consulted, or
whether the fixture read `reservedPeerIds` at a moment the store had not yet settled. Both
readings are available and neither was measured. **Severity: WARNING**, not a blocker for
criterion 8 — that verdict is the destination phase's and this pass does not re-adjudicate it.
But it is a counter-observation against the property criterion 3's cost clause would inherit, it
was reproduced twice from a clean tree, and it appears in **no** `.planning/` artifact:
`24-VERIFICATION.md` contains no occurrence of `flak`, `intermittent` or `nondeterministic`.

---

### The watched red that does work — criterion 3's rate-limiting half is genuinely load-bearing

Because a plant that stays green is worth nothing unless the instrument is shown to read at all,
a second plant was made on the half of criterion 3 that **is** met.

**Plant P2 — this verifier's own, unledgered.** `packages/core/src/enrollment.ts:509`, the
aggregate issuance budget neutralised without deleting a symbol:

```diff
-      if (issued.length >= this.#maxIssuedPerWindow) {
+      if (issued.length >= this.#maxIssuedPerWindow && this.#windowMs < 0) {
```

**Matched clean baseline**, same three files, same command, tree `shasum`-identical:
`P2_MATCHED_BASELINE_EXIT=0` — **39 passed (39)**, `real 8.54 user 12.53 sys 2.36`, load 11.86.

**Planted:** `PLANTED_P2_EXIT=1` — **10 failed | 29 passed (39)**, `real 6.14`, load 6.15. The
cross-process one died at exactly the step that carries the claim:

```
 FAIL  packages/node/src/enrollment-cost.node.test.ts > AUTH-04 — criterion 5, across real
 bin/agent.ts processes > refuses by name past its stated budget, and still refuses after being
 restarted on the same directory
Error: agent in /var/folders/.../o2-cost-1Ceia3/n2 announced instead of leaving — it was
certified where a refusal was expected: {"peerId":"12D3KooWG4RP7ugou3aQnYhkZb1zKuFoqtkHN1qn7rt…",
"certificate":{"nodeKey":"5cbfe2e1…","issuer":"b0adfa66…", …}}
```

and nine more by name, including *"refuses past its stated number however many free keygens the
requester mints"*, *"names the provider's own budget and says nothing about the requester"*,
*"slides the aggregate window rather than closing the provider forever"*, *"refuses on
reconstruction from the same directory, having forgotten nothing"* and *"refuses at the same
point whether or not the stale entries were dropped"*.

Restored with `cp`, `cmp` **exit 0**, `shasum -a 256` back to
`fc69e72d112e4d248dbdb94312d44cc58d4a48dc2ec8a460f1e97cb4b638f0f6`.

**So the instrument reads.** A mutation to the aggregate budget reddens ten tests across three
files in two seconds. A mutation to the admission binding reddens nothing across eight files in
five runs. The contrast is the finding, and it is why P1's silence is a measurement rather than
an absence of effort.

---

### What this amendment does **not** dispute

Recorded plainly so a later reader does not re-open settled ground.

| Claim | Disposition |
|---|---|
| Criterion 3's **rate-limiting** clause is MET, durable, and stated on the wire | **Confirmed, re-run.** 19 tests, exit 0 — see the table below |
| Criterion 8 is **MET** | **Not disputed.** That verdict is `24-VERIFICATION.md`'s and this pass does not re-adjudicate it |
| RULING A's precondition is satisfied for criterion 3 | **Confirmed.** The destination landed, and it landed MET |
| Criterion 3's cost clause and criterion 8 are the **same** clause, not adjacent ones | **Confirmed at the source**, and this verifier went looking for the adjacency and did not find it |
| Criterion 3's text is unchanged | **Confirmed**, `cmp` exit 0 twice and one commit in `git log -L` |
| Criteria 1 and 2 | **Not re-opened.** Untouched by this pass |

**The disagreement is narrow and it is a single word.** Not *whether* the carry was right — it
was — but whether what the destination delivered reaches criterion 3's *measurably*. It does not,
by one unobserved `if`.

### What closing criterion 3 requires

One test, and it is cheap. At a relay pinning issuer A, a peer that holds a genuine, unexpired,
A-signed certificate **for a different node key** asks for a reservation and is refused by name,
against a control in the same run that is admitted — the `peer-verifier.node.test.ts:448` shape,
moved to the door. It must redden when `fabric-node.ts:949` is neutralised, and that must be
watched rather than assumed.

Once that exists, criterion 3 closes at **3/3** by a further dated amendment **carrying criterion
8's stated bound verbatim** — the block quoted above, unabridged.

The flake in `relay-admission.node.test.ts` arm 3 should be diagnosed in the same pass, because
the two questions touch the same door and a closure written over an unexplained fail-open reading
would be worth less than the reading.

---

### What this verifier ran, and read directly

Every exit code was captured with `EXIT=$?` on the line **immediately** following the command —
no pipes, no trailing filter, no `tail`. Host: 8 cores, `uptime` load average recorded per row.
Runs are `npx vitest run --project node <paths>` unless stated; **the full node project was never
run**, and `bench-attestation.node.test.ts` and `discover-arm.node.test.ts` were never invoked —
a sibling verifier was working Phase 19 in this same tree and both of those snapshot
`git status --porcelain` around themselves.

| # | Command | Exit | Result | `/usr/bin/time -p` | load |
|---|---|---|---|---|---|
| 1 | `npx tsc --noEmit` | **0** | zero output | `real 1.22 user 2.00 sys 0.46` | 8.62 |
| 2 | `enrollment` + `enrollment-cost` + `fs-issuance` `--reporter=verbose` | **0** | 3 files, **19 passed** | `real 12.77 user 27.22 sys 5.06` | 9.61 |
| 3 | `closed-fabric-agents` + `relay-admission` + `reservation-exhaustion` + `enrol-through-a-closed-door` | **0** | 4 files, **45 passed** | `real 60.75 user 20.85 sys 3.78` | 10.53 |
| 4 | **P1 planted** — `relay-admission` + `closed-fabric-agents` + `enrol-through-a-closed-door` | **1** | 1 failed / 43 passed | `real 61.10` | 10.90 |
| 5 | **restored** — `relay-admission` | **1** | **1 failed / 36 passed — same assertion, clean tree** | `real 22.97 user 7.27 sys 1.40` | 7.54 |
| 6 | **restored** — `relay-admission` | **0** | 37 passed | `real 23.58 user 7.21 sys 1.48` | 6.78 |
| 7-10 | **restored** — `relay-admission` ×4 | **0**×4 | 37 passed ×4 | — | 15.60 / 11.22 / 11.53 / 11.10 |
| 11-14 | **P1 re-planted** — `relay-admission` ×4 | **0**×4 | **37 passed ×4 — the plant is not caught** | — | 11.21 / 11.02 / 9.98 / 8.98 |
| 15 | **P1 planted** — 7-file admission + verifier suite | **0** | **7 files, 43 passed** | `real 62.71 user 61.00 sys 10.84` | 9.19 |
| 16 | **P2 planted** — `enrollment-cost` + `fs-issuance` + `core/enrollment.test.ts` | **1** | **10 failed / 29 passed** | `real 6.14 user 9.03 sys 1.70` | 6.15 |
| 17 | **restored, matched baseline** — same three files as row 16 | **0** | **39 passed** | `real 8.54 user 12.53 sys 2.36` | 11.86 |

Row 4's red and row 5's red are **the same event**, and rows 11-14 are what attribute it: the
plant does not move that arm, so the failure in row 4 was the flake and not the mutation. Row 16's
red *is* attributable — row 17 is its matched clean baseline on a `shasum`-identical tree.

Rows 2, 3 and 17 are spawn- and network-bound (six real `bin/agent.ts` processes in row 3), so
`real` legitimately exceeds CPU time; the ratios are recorded as a comparability key, not as a
verdict.

**Tree discipline.** `git status --porcelain` was empty before the session, before every restore,
and at the end. Baselines were taken with `cp` into `/tmp/p17-baseline/`, every restore confirmed
with `cmp` **exit 0** and `shasum -a 256` back to the pre-plant digest, and `git diff --quiet`
over the whole tree read **exit 0** after each. **No `git add`, `commit`, `stash`, `checkout --`,
`restore`, `reset` or `clean` was used at any point**, and no process this verifier did not start
was signalled. Before each plant, `git status --porcelain <file>` was read to confirm the file
was not mid-edit by the sibling agent.

---

### LEDGER EDITS RECOMMENDED (not applied)

A verifier may not write `.planning/STATE.md`, `.planning/ROADMAP.md` or
`.planning/REQUIREMENTS.md`. Each of these is a **false or stale** statement at `1028cc1`, not a
matter of taste.

**L1 — `.planning/ROADMAP.md:1140`, the Phase 17 row. Its verdict is right and its reason is
false.** It reads *"Phase 24 landed 2026-08-06 and criterion 8 verified PARTIAL, so criterion 3
does NOT close"*. Criterion 8 verified **MET** on 2026-08-06 (`580e461`), and line 1147 of the
same file says so. The score stays 2/3 but the reason must be replaced: *"criterion 8 landed MET
on 2026-08-06 and RULING A's precondition is satisfied; criterion 3 nonetheless stays PARTIAL by
the amendment of 2026-08-06 to `17-VERIFICATION.md` — the link that composes criterion 8's MET
into this criterion's cost clause (`fabric-node.ts:949`, one certificate admits one identity) is
present in source and observed by no test, so the cost is not **measurably** carried."* This is
the urgent one: a reader who believes criterion 8 is PARTIAL stops looking, which is the precise
shape this repository has been bitten by.

**L2 — `.planning/ROADMAP.md:1147`, the Phase 24 row.** It states *"Phase 17 criterion 3 and
Phase 19 criterion 5 were both carried into criterion 8 and **can now close**"*. For criterion 3
that anticipation is now falsified by an actual attempt. Append: *"Phase 17's amendment of
2026-08-06 declined to close criterion 3 — the carry is sound and the precondition is met, but
the admission gate's certificate-to-peer binding is unobserved, so the inherited cost is not
measured. See `17-VERIFICATION.md`'s third amendment."* Phase 19's half is untouched by this pass
and is its own verifier's to answer.

**L3 — `.planning/STATE.md:456`, Current Position.** Reads *"Phase: 24 … **0/1 on criteria, NOT
closed and NOT counted**"*, contradicting lines 9, 224, 228 and 236 of the same file, which record
24 closed at 1/1 on 2026-08-06. Stale; correct to 1/1 with the bound named.

**L4 — `.planning/STATE.md:426-447`, the uncounted-phases paragraph.** It says 17 and 19 *"are
next and are one amendment each away"*. That amendment has now been written for 17 and it did not
close. Correct to: *"17 stays 2/3 — its amendment of 2026-08-06 found the carry sound and the
precondition met, and declined anyway, on an unobserved link. RULING A held a third time, and this
is the first time it held against a destination that landed MET."*

**L5 — no `REQUIREMENTS.md` edit is recommended.** AUTH-04's disposition is unchanged by this
pass.

**RECOMMENDED source/test repairs — not ledger, but they belong in the same pass:**

- **S1** — the missing test named under *"What closing criterion 3 requires"* above. Without it
  `fabric-node.ts:949` is an unguarded load-bearing line, and its own docblock says it is
  load-bearing.
- **S2** — diagnose `relay-admission.node.test.ts` arm 3's fail-open flake, 2 in 12 here. If the
  race is in the gate rather than the fixture it is a criterion 8 defect; if it is in the fixture
  the file needs a settle-and-re-read, because as written it can report a closed door open.
- **S3** — `CLOSED_RELAY_CAPABLE`'s docblock in `closed-fabric-agents.node.test.ts` was already
  recorded by the destination verifier (W6) as describing a protection it does not have. Still
  true at `1028cc1`. Unrelated to this criterion; restated so it is not lost.

---

### Verdict

| | |
|---|---|
| **Criterion 1** | MET — unchanged, not re-opened |
| **Criterion 2** | MET — unchanged, not re-opened |
| **Criterion 3** | **PARTIAL** — rate-limiting clause MET and re-run green; cost clause carried to Phase 24 criterion 8, whose MET is real but whose composition into *"mass fake-node creation"* rests on an unobserved line |
| **Score** | **2 / 3** |
| **Phase** | `gaps_found` — unchanged |

**2/3**

---

_Amended: 2026-08-06 (UTC `2026-08-07T04:31:56Z`) at `1028cc1`, working tree clean before and
after; both plants restored with `cp`, confirmed with `cmp` exit 0, `shasum -a 256` back to the
pre-plant digest, and `git diff --quiet` over the whole tree exit 0._
_Verifier: Claude (gsd-verifier), third pass — goal-backward re-verification against the
destination phase._
_No source, test, ledger, roadmap or state file was modified. Nothing was staged, committed or
stashed. Every exit code above was read with `EXIT=$?` on the immediately following line._

---

## Amendment — 2026-08-07: criterion 3 **CLOSES**, and the score becomes **3/3**

**Score: 2/3 → 3/3 criteria.** Everything above — the 2026-08-01 initial pass and the amendments
of 2026-08-05 and 2026-08-06 — is left standing; **nothing in any of them is retracted**. The
2026-08-06 pass was right on the day it was written, and this amendment closes the criterion on
the exact evidence that pass specified and could not then find.

**Re-verified:** 2026-08-07T08:16:20Z, at `ba5c473`, branch
`feature/phase-18-discovery-capacity-placement`. Working tree `git status --porcelain` **empty**
before the session, after every restore, and at the end.
**Scope: criterion 3 ONLY.** Criteria 1 and 2 are MET and were **not re-adjudicated**, by
instruction. Phase 24 criterion 8's MET is **not re-adjudicated** either — that verdict is the
destination phase's.
**Verdict:** criterion 3 **MET**, phase **3/3**, carrying criterion 8's stated bound verbatim.

**The short form.** The 2026-08-06 amendment declined for one named, measured reason: bounded
issuance plus *"an unissued identity buys nothing"* only yields a per-identity price **if one
certificate admits exactly one identity**, that binding lives in `fabric-node.ts`'s
`relayAdmissionGate`, and **no test observed it** — plant P1 stayed green across eight files and
five runs while the control reddened. Commit `8719029` claims to close exactly that. **This
verifier did not take the claim.** It re-planted P1 itself, watched it go red, ran the both-ways
control the commit rests on, and watched both halves of that behave as claimed. The declining
verifier's own closure specification is satisfied, and it is satisfied by measurement rather than
by a commit message.

---

### What the 2026-08-06 pass said would close it, quoted from four hundred lines above

> One test, and it is cheap. At a relay pinning issuer A, a peer that holds a genuine, unexpired,
> A-signed certificate **for a different node key** asks for a reservation and is refused by name,
> against a control in the same run that is admitted — the `peer-verifier.node.test.ts:448` shape,
> moved to the door. It must redden when `fabric-node.ts:949` is neutralised, and that must be
> watched rather than assumed.

Delivered by `8719029` — *"test(auth-04): a borrowed certificate is refused AT THE DOOR, and the
proof runs both ways"*, 2026-08-06 21:50:55 -0700. `git show --stat`: **two files, 240 insertions,
1 deletion** — `relay-admission.node.test.ts` +204 and `mutation-ledger.ts` +37. No production
source changed, which is the right shape for a gap that was an absence of observation rather than
an absence of mechanism.

The criterion text is unchanged and was re-checked rather than assumed: `.planning/ROADMAP.md:491`
reads verbatim as quoted at the head of this section, and `git log -L491,491:.planning/ROADMAP.md`
still returns **exactly one commit** — `c3e6fe1` (2026-07-27), the line's addition. Criterion 8 at
`ROADMAP.md:1189` is likewise unedited (`git log -L` → `3cc5a83` alone). **RULING A is honoured in
both directions: nothing was softened to let this phase close, and nothing was stretched to keep
it open.**

---

### The case that now exists, read at the source rather than from its title

`packages/node/src/relay-admission.node.test.ts:1374`, inside
`describe('AUTH-02 — the relay consults RelayAdmission at the reservation, and only there')`:

> `it('refuses a peer presenting a certificate issued to a different peer, and admits the peer that certificate names')`

Its subject is the production symbol: line 14 of that file is
`import { FabricNode, relayAdmissionGate } from './fabric-node.ts'` — the door's own predicate, not
a re-implementation. Nothing in the fixture is forged: a real `EnrollmentAuthority`, a real
`requestEnrollment`, one certificate whose `nodeKey` is asserted to be the rightful peer's
(`:1409`) and whose `expiresAt` is asserted to be in the future (`:1410`). The premise is asserted
rather than assumed — `borrower.nodeKey !== rightful.nodeKey` and
`borrower.peerId !== rightful.peerId` at `:1388-1389`, so two colliding seeds cannot make the
reading pass for an unrelated reason.

**One certificate, served at two addresses on one `MemoryNetwork`, asked by one gate pinning that
authority.** Arm 1 (`:1466`): the borrower answers a `records` ask about *its own* key with the
document naming somebody else, and is refused — `true` denies. Arm 2 (`:1471`): the peer that
certificate names, same gate, same pinned set, moments later — **admitted**.

Arm 2 is what makes arm 1 a reading rather than a claim, and this verifier agrees with that
reasoning after checking it: a certificate that the same gate admits cannot be unsigned, cannot be
expired and cannot be from an unpinned issuer, so the borrower's refusal has nowhere else to come
from. It is closed from the other side by three negatives at `:1493-1495` — the refusal must **not**
contain `refused:` (the prefix every `verifyCertificate` failure reaches an operator through),
`not a pinned provider`, or `holds no provider-issued certificate`. And `:1499-1503` records the
key each server was *asked* about, so the borrower's server must have been asked for the
**borrower's own** key — which is the fact `expected` rests on, and the fact that makes the refusal
about *who is holding* the document rather than about the document.

---

### Plant P1-R — the same plant as 2026-08-06, re-planted, and this time it **reddens**

**Counted before running, because an unapplied plant and a green plant are identical in a log.**
`grep -c "if (certificate.nodeKey !== expected) {"` → `packages/node/src/fabric-node.ts` **1**,
`packages/node/src/peer-verifier.ts` **1**. Exactly one target site per file, so each plant's own
effect is one line and the effect count is known before the run rather than inferred from it.

`packages/node/src/fabric-node.ts` was `shasum -a 256` **`d6688f731cd472525ef21f1f331e708465686005c7c27ade7788da106ca15648`** before planting —
**byte-identical to the digest the 2026-08-06 amendment recorded at `1028cc1`**. The plant target is
therefore provably the same source the earlier pass measured green, and the difference between the
two results cannot be a difference in the production file.

Applied, in `relayAdmissionGate`:

```diff
-      if (certificate.nodeKey !== expected) {
+      if (certificate.nodeKey !== expected && expected === '') {
```

`git diff --stat` immediately after: **`1 file changed, 1 insertion(+), 1 deletion(-)`**, one hunk,
and `git status --porcelain` over the whole tree showed **`M packages/node/src/fabric-node.ts`**
and nothing else. Every type, symbol and both refusal strings byte-intact; `expected` is a
64-character lowercase hex string at that point (null-checked at `:900`), so the guard is dead and
a certificate naming **any** node key is carried straight to `verifyCertificate`.

**Command** (identical to the baseline command, same two files, same order):
`npx vitest run --project node packages/node/src/relay-admission.node.test.ts packages/node/src/peer-verifier.node.test.ts`

**`PLANTED_P1_EXIT=1`** — read with `EXIT=$?` on the immediately following line, no pipe, no
trailing filter. `Tests 1 failed | 59 passed (60)`, `real 28.67 user 10.74 sys 2.10`, load 32.45.
Verbatim:

```
 ❯ |node| packages/node/src/relay-admission.node.test.ts (38 tests | 1 failed) 24442ms
     × refuses a peer presenting a certificate issued to a different peer, and admits the peer
       that certificate names 28ms

 FAIL  |node| packages/node/src/relay-admission.node.test.ts > AUTH-02 — the relay consults
 RelayAdmission at the reservation, and only there > refuses a peer presenting a certificate
 issued to a different peer, and admits the peer that certificate names
AssertionError: expected false to be true // Object.is equality

- Expected
+ Received

- true
+ false

 ❯ packages/node/src/relay-admission.node.test.ts:1466:63
    1465|       // ---- arm 1: the borrower. `true` denies. --------------------…
    1466|       expect(await gate?.(peerIdFromString(borrower.peerId))).toBe(tru…
```

**The failure is semantically the defect and not a side effect.** `true` denies; the door returned
`false`, meaning it **admitted** a peer presenting a certificate issued to somebody else. That is
precisely the property whose absence the 2026-08-06 pass declined on.

**Restored by the surgical inverse of this verifier's own edit — not by `cp`.** The one planted
line was reversed by the exact inverse substitution, then: `cmp` against a snapshot taken
*immediately before planting* → **`CMP_P1_RESTORE_EXIT=0`**; `shasum -a 256` back to
`d6688f73…`; `git diff --quiet` over the **whole tree** → exit 0; `git status --porcelain` →
**empty**. No `git checkout --`, `restore`, `stash`, `reset`, `clean`, `add` or `commit` at any
point.

---

### Plant P4 — the both-ways control, which is what stops the green being vacuous

`8719029`'s central claim is not that the new case reddens. It is that the new case reddens for
the **door's** copy of the comparison and not for `peer-verifier.ts`'s — two copies, two guards,
neither standing in for the other. Without that second column, a case that merely tracked
`peer-verifier`'s behaviour would prove nothing about admission. **So it was run.**

`packages/node/src/peer-verifier.ts:678` — the SELECTION-side copy, guarded since 17-05 — planted
with the identical edit (the ledger's note cites `:527`; the line has drifted to `:678` and the
citation is stale, see F2 below):

```diff
-    if (certificate.nodeKey !== expected) {
+    if (certificate.nodeKey !== expected && expected === '') {
```

`git diff --stat` → `1 file changed, 1 insertion(+), 1 deletion(-)`; whole-tree status
`M packages/node/src/peer-verifier.ts` **and nothing else** — `fabric-node.ts` provably clean, so
the two plants never overlapped.

**Same command. `PLANTED_P4_EXIT=1`**, `Tests 2 failed | 58 passed (60)`,
`real 25.47 user 9.55 sys 1.86`, load 45.78:

```
 ❯ |node| packages/node/src/peer-verifier.node.test.ts (22 tests | 2 failed) 2938ms
     × refuses a certificate borrowed from another node as nodeKey-mismatch, naming both keys 21ms
     × never re-asks a refusal that cannot change, however often the gate is read 61ms

 FAIL  … > AUTH-02 — the five peer-level refusals > refuses a certificate borrowed from another
 node as nodeKey-mismatch, naming both keys
AssertionError: expected true to be false // Object.is equality
 ❯ packages/node/src/peer-verifier.node.test.ts:482:24
    482|     expect(verdict.ok).toBe(false)
```

and, in the same run, **`packages/node/src/relay-admission.node.test.ts` passed in full** — the
file does not appear in the failure list, and the summary reads `Test Files 1 failed | 1 passed
(2)` with the 38 relay-admission tests among the 58 that passed.

**Both halves hold, as claimed:**

| Plant | `relay-admission` new case | `peer-verifier` borrowed row | Exit |
|---|---|---|---|
| `fabric-node.ts:949` (P1-R) | **RED** — `expected false to be true` | green | **1** |
| `peer-verifier.ts:678` (P4) | **green** | **RED** — `expected true to be false` | **1** |

The new case observes **the door**. It is not a second reading of `PeerVerifier` wearing a
different title, and it does not pass because some sibling check happened to fire. This is the
column that makes the close a measurement.

**Restored** by the surgical inverse: `CMP_P4_RESTORE_EXIT=0`, `shasum -a 256` back to
`2a36ca52e5a2f69d5589fdd8bfdad538aa85fd4196d84aebbcf35b2d0c6594d8`, whole-tree `git diff --quiet`
exit 0, `git status --porcelain` empty.

---

### Attribution — matched clean baselines on both sides of both plants

A red is worth nothing without a green it can be compared to on the same files, the same command
and the same tree.

- **Before any plant:** `BASE1_EXIT=0`, `Test Files 2 passed (2) | Tests 60 passed (60)`,
  `real 30.59 user 11.56 sys 2.70`, load 38.07.
- **After both restores:** `BASE2_POST_RESTORE_EXIT=0`, `Tests 60 passed (60)`,
  `real 28.63 user 10.83 sys 2.04`, load 70.78, `git status --porcelain` empty.

Sixty green, one line planted, fifty-nine green and one red at the arm the plant disables;
restore, sixty green again. The comparison is within one session on one host, which is the
comparative reading this repository's conventions ask for rather than an absolute threshold.

**`npx tsc --noEmit` → `TSC_EXIT=0`**, `real 1.37 user 2.12 sys 0.40`, on the restored tree.

**The repository's own guard, run rather than cited:**
`npx vitest run --project node packages/node/src/mutation-guard.node.test.ts` →
**`MUTATION_GUARD_EXIT=0`**, `Tests 148 passed (148)`, `real 2.69`. M68 is a real ledger entry, its
`find`/`replace` pair is byte-identical to the plant this verifier ran, and its recorded signature
— *"AssertionError: expected false to be true"* against the test title
*"refuses a peer presenting a certificate issued to a different peer, and admits the peer that
certificate names"* — **matches what this verifier independently observed**. So the mutation is
pinned by the harness, not only described in a report, which is this repository's own standing rule.

---

### The known flake: **not observed**, and not re-raised

The 2026-08-06 pass recorded `relay-admission.node.test.ts` arm 3 reddening fail-open on an
unmutated tree, 2 in 12; the owner records that this was later refuted as a concurrent agent's live
plant, at a cost of 111 executions and a `node_modules` patch.

**This verifier observed it zero times in four executions of that file** — baseline, under P1-R,
under P4, and the post-restore baseline. Under P1-R the file reported `38 tests | 1 failed` with
the **only** `×` being the new case, so arm 3 passed in that run too. Arm 3's assertion shape
(`expected [ …(2) ] to not include '12D3Koo…'`) is distinct from the P1-R failure
(`expected false to be true` at `:1466`), so the two can never be confused, and P1-R's red is not
attributable to it.

**No new evidence, so no defect is raised.** Recorded as four more clean observations for whoever
holds the tally, and nothing more.

---

### The adjudication — what the cost clause now rests on, and what it does not

The chain criterion 3's cost clause needs, with the state of each link measured rather than
asserted:

| # | Link | State | Where it is measured |
|---|---|---|---|
| 1 | Issuance is bounded by a quantity the requester cannot mint | **MET** | `maxIssuedPerWindow` + `FsIssuance`; plant P2 (2026-08-06) reddened 10 tests across 3 files against a matched baseline. Not re-run here — it is not in this pass's scope and it was watched red by the previous verifier |
| 2 | An unissued identity buys nothing — it cannot join, be advertised, or be dialled | **MET** | Phase 24 criterion 8, `580e461`. **Not re-adjudicated by this pass** |
| 3 | **One certificate admits exactly one identity** — without which an attacker buys one signature and mints N nodes | **MET as of `8719029`, and now MEASURED** | `relay-admission.node.test.ts:1374`; plant P1-R **watched red at exit 1 by this verifier**, with the both-ways control P4 confirming the case observes the door and not the selector |

Link 3 was the sole ground of the 2026-08-06 decline, in that verifier's own words: *"nothing in
the repository would notice if it stopped."* Something now would. Criterion 3's verb is
*measurably*, and the composition is now measured end to end.

**The criterion closes at 3/3, carrying Phase 24 criterion 8's stated bound VERBATIM**, per the
owner ruling of 2026-08-07 confirming the NARROW reading over the wider one. A carried criterion
inherits no more than its destination delivered:

> **The bound this MET carries, stated at the verdict rather than in a footnote.** The default
> posture of `bin/agent.ts`, `bin/seed.ts` and `bin/bench.ts` is **open**, and must be: nineteen
> `bin/agent.ts` and three `bin/seed.ts` argv sites depend on it, and
> `reservation-exhaustion.node.test.ts` arm A is a **live behavioural guard** on it — read at the
> source, lines 285-317: *"a seed whose no-flag posture had become anything but
> `'admits-any-peer'` reddens here, by name, before B is ever read"*, backed by
> `expect(a.stderr()).not.toContain('PERMISSION_DENIED')`. Criterion 8 is MET **of a fabric an
> operator has closed**, and this repository ships open by default on purpose.

*"The fabric"* is read as a fabric this repository can be **deployed and operated as**, with an
admission posture stated on every relay-capable door — **not** the default argv. Both option types
make `relayAdmission` **required with no default**, so the API cannot express silence; only argv
has a default.

**The bound's substance was re-checked at `ba5c473` rather than transcribed.** The default-open
ternary is live in both binaries — `bin/seed.ts:198` and `bin/agent.ts:901`, both reading
`values['admit-issuer'] === undefined ? 'admits-any-peer' : new Set(values['admit-issuer'])` — and
`reservation-exhaustion.node.test.ts:285-317` still carries arm A in the words quoted, with
`expect(a.stderr()).not.toContain('PERMISSION_DENIED')` at `:317`. The arithmetic *"nineteen plus
three"* originates at `24-06-PLAN.md:275`; **this verifier did not recount it and does not certify
the two integers**, exactly as the 2026-08-06 pass did not.

#### Two further limits, stated at the verdict rather than in a footnote

**LIMIT 1 — the borrowed case is measured at the PREDICATE, not at a live reservation.** The new
case calls `relayAdmissionGate` directly over `MemoryNetwork`; its own docblock says so
(*"It cannot show libp2p really consults the gate at a reservation"*). The reservation leg is
carried by a **different** case in the same file — the three live arms at `:1035`, which start real
`FabricNode`s on real `/ip4/127.0.0.1/tcp/0/ws` listeners and distinguish three peers by identity
at a real reservation — together with the structural row at `:670` that pins there being exactly
one production caller of the predicate. **The close rests on the conjunction of two readings, not
on one.** This verifier judges the conjunction sound: the live case establishes that this predicate
is what libp2p consults and that the gated peer's own id is what reaches it; the new case
establishes that the predicate binds the certificate to that id. It is recorded because a later
reader should know the borrowed peer was never a live joiner.

**LIMIT 2 — this is a BOUND plus DEVALUATION, not a GRADUATED price.** The N-th identity is refused
inside the window rather than priced above the first. `REQUIREMENTS.md`'s AUTH-04 row says so in its
own words, and `8719029`'s message repeats it: *"it does NOT convert a bound into a graduated
cost."* This verifier applied the owner's devaluation ruling of 2026-08-04 — under gated admission
an unissued identity is worth nothing, so the price of the N-th identity is a provider's signature,
which is the unmintable thing — because the owner routed criterion 3's cost clause to criterion 8
**on that ruling** and criterion 8 is MET **on that ruling**, and because Phase 19 criterion 5,
whose text is the stricter *"the N-th … demonstrably more expensive than the first"*, closed at 5/5
on it (`ac7b214`). **A reader who takes criterion 3's `costly` to require a rising per-identity
price has the same answer today as on 2026-08-01.** That reading is escalated for owner
confirmation in the frontmatter rather than settled here, because it is a reading and not a
measurement.

#### What this close is NOT

- It is **not** a rewrite of criterion 3. `ROADMAP.md:491` is unedited, one commit in `git log -L`.
- It is **not** a re-adjudication of criterion 8, of criterion 1, or of criterion 2.
- It is **not** a claim that the enrolment DoS surface shrank. `serveAgent`'s `enrol` branch still
  takes no authorization step, refuse-over-mint still sits at ~3.07-3.09× and the replay ratio at
  ~9351-9577×. That exposure is **accepted deliberately** by owner decision and is not this
  criterion's to carry — recorded so it is not re-filed.
- It is **not** a claim that the repository is closed by default. It ships open, on purpose, and
  that is the whole of the carried bound.

---

### Findings that are **not** about criterion 3

Recorded because they were found while doing this work, not because they bear on the verdict.

**F1 — `ROADMAP.md:1140` and `:1147` are now stale in the opposite direction from before.** Both
rows were correctly updated after the 2026-08-06 decline and both now assert that criterion 3 does
not close and that *"no test observes"* the binding. `8719029` landed **within the hour** of the
row being written and both statements are false at `ba5c473`. `:1147` additionally poses *"the two
verdicts arguably rest on the same unguarded binding and disagree — an owner adjudication"*; that
question is now **answered by the code** rather than needing an adjudication — the binding is
guarded, so Phase 19's close and Phase 17's close agree. See L1/L2 below.

**F2 — a stale line citation inside the mutation ledger.** `mutation-ledger.ts` M68's `why` text
cites the selection-side copy as `peer-verifier.ts:527`; it is at **`:678`** at `ba5c473`, moved by
`c12bf86` and `e642d96`. The `find`/`replace` pair is string-based and therefore unaffected — the
guard passes 148/148 — so this is a prose citation rotting, the same rot the 2026-08-05 amendment
recorded as warnings W2 and W9 and answered with *"cite by symbol"*. **Not a defect; a two-word
fix** whenever that block is next touched.

**F3 — the `verifiedPeers` cache row is a second guard on the same comparison.** Under P4, a
second `peer-verifier.node.test.ts` row reddened: *"never re-asks a refusal that cannot change,
however often the gate is read"* (`:743`). That row asserts a refusal is memoised, so neutralising
the `nodeKey-mismatch` branch flips it too. Noted as a **strength** — the selection-side binding
has two independent observers, where the door now has one.

**F4 — this pass ran on a host at 1-minute load 32-71**, far above the 6-15 the 2026-08-06 pass
recorded, and the readings did not change shape: the same 60 tests, the same wall times to within
2 s, no new intermittency. Recorded as a comparability key, not as a verdict.

---

### LEDGER EDITS RECOMMENDED (not applied)

**A verifier may not write `.planning/STATE.md`, `.planning/ROADMAP.md` or
`.planning/REQUIREMENTS.md`, and this verifier wrote none of them.** Each item below is a **false**
statement at `ba5c473`, not a matter of taste.

**L1 — `.planning/ROADMAP.md:1140`, the Phase 17 row. Verdict and reason are now both false.** It
reads *"2 of 3 criteria"*, *"criterion 3's COST clause not met"*, and *"The binding exists in
`fabric-node.ts`; **no test observes it** (neutralising it is green across 8 files and 5 runs …).
One test at the door closes this"*. That test landed in `8719029` within the hour. Replace the
score with **3/3** and the reason with: *"Criterion 3 CLOSED 2026-08-07 by the fourth amendment to
`17-VERIFICATION.md`. The link the 2026-08-06 decline named — one certificate admits exactly one
identity, `fabric-node.ts` `relayAdmissionGate` — was guarded by `8719029` and the plant was
**re-planted and watched red by the verifier** (exit 1, `expected false to be true` at
`relay-admission.node.test.ts:1466`), with the both-ways control confirming the case observes the
door and not `peer-verifier.ts`. **Closes carrying Phase 24 criterion 8's stated bound verbatim**:
the binaries' default argv posture is open and must be, so the close is of a fabric an operator has
closed."* Also tick `ROADMAP.md:56`'s Phase 17 checkbox **only if** the human-verification items in
the frontmatter are dispositioned — they are the AUTH-02 browser-pinning leg and the `costly`
reading, neither of which is a criterion-3 gap.

**L2 — `.planning/ROADMAP.md:1147`, the Phase 24 row.** It ends *"Criterion 3 needs a third link
neither criterion names, one certificate admitting exactly one identity, and no test observes it.
**The two verdicts arguably rest on the same unguarded binding and disagree — an owner
adjudication**"*. Append: *"Resolved by code rather than by adjudication: `8719029` guarded that
binding at the door, and Phase 17's fourth amendment (2026-08-07) re-planted it, watched it redden
and closed criterion 3 at 3/3 carrying this row's bound verbatim. **17 and 19 now agree**, and
`24-VERIFICATION.md`'s criterion 8 verdict is untouched by either."*

**L3 — `.planning/STATE.md:475`** (and the same claim at `:35`, `:292`, `:1678`). It records
*"**Phase 17 criterion 3 DECLINED and stays 2/3** (`a3d2215`) — the first [time RULING A held
against a destination that landed MET]"*. Correct to: *"17 declined on 2026-08-06 (`a3d2215`),
`8719029` closed the named gap the same evening, and the fourth amendment of 2026-08-07 CLOSED
criterion 3 at **3/3** on a re-planted, watched red. RULING A held, then was satisfied — which is
the outcome it exists to produce."* The `11 of 15` tallies that depend on 17 being uncounted need
recomputing with 17 counted; **this verifier did not recount them and does not certify any tally.**

**L4 — `.planning/REQUIREMENTS.md:274` and `:694`, AUTH-04.** The `[ ]` marker and the row's
*"What remains open, and why the marker has not moved"* paragraph are now the only thing holding
AUTH-04 open on the cost clause. Recommended: record that the composing binding is guarded and
watched (`M68`, `relay-admission.node.test.ts`), **and keep the marker's disposition an owner
decision**, because the row's own stated ground for staying `[ ]` is the graduated-cost reading —
LIMIT 2 above — which is a reading rather than a measurement. **This verifier does not recommend
ticking AUTH-04 without that reading confirmed**, and `acceptance-traceability.node.test.ts`
couples the checkbox to the traceability verdict text, so the two must move together or not at all.

**L5 — AUTH-02** is unchanged by this pass and its remaining leg (a tab cannot pin an issuer) is
still escalated in the frontmatter, unresolved since 2026-08-05.

**RECOMMENDED source/test repairs — not ledger:**

- **S1 — CLOSED.** The missing door test named by the 2026-08-06 pass now exists and is guarded by
  `M68`. Nothing further.
- **S2 — carried, unresolved.** `relay-admission.node.test.ts` arm 3's fail-open reading. **Not
  observed here (0 in 4)** and the owner records the 2026-08-06 sighting as refuted — a concurrent
  agent's live plant. Carried only so the tally is not lost; **no new evidence and no defect
  raised.**
- **S3 — carried, unchanged.** `CLOSED_RELAY_CAPABLE`'s docblock in
  `closed-fabric-agents.node.test.ts` still describes a protection it does not have (destination
  verifier's W6). Unrelated to this criterion; restated so it is not lost.
- **S4 — new, cosmetic.** F2 above: M68's `peer-verifier.ts:527` citation should read `:678`, or
  better, cite by symbol.

---

### What this verifier ran, and read directly

Every exit code was captured with `EXIT=$?` on the line **immediately** following the command — no
pipes, no trailing filter, no `tail`. Host: 8 cores; `uptime` 1-minute load recorded per row. Runs
are `npx vitest run --project node <paths>`; **the full node project was never run**, and
`bench-attestation.node.test.ts` and `discover-arm.node.test.ts` were **never invoked** — both
snapshot `git status --porcelain` around themselves and this pass moves the working tree. No file
was created or deleted inside the repository at any point; the two pre-plant snapshots and all
captured output live outside it, under the session scratchpad.

| # | Command | Exit | Result | `/usr/bin/time -p` | load |
|---|---|---|---|---|---|
| 1 | **baseline** — `relay-admission` + `peer-verifier` | **0** | 2 files, **60 passed** | `real 30.59 user 11.56 sys 2.70` | 38.07 |
| 2 | **P1-R planted** (`fabric-node.ts:949`) — same two files | **1** | **1 failed / 59 passed** — the new door case, arm 1 | `real 28.67 user 10.74 sys 2.10` | 32.45 |
| 3 | **P4 planted** (`peer-verifier.ts:678`) — same two files | **1** | **2 failed / 58 passed** — `peer-verifier`'s borrowed row **and** its memoisation row; `relay-admission` **passed in full** | `real 25.47 user 9.55 sys 1.86` | 45.78 |
| 4 | **restored** — `mutation-guard.node.test.ts` | **0** | **148 passed** — M68 still describes the source | `real 2.69 user 1.15 sys 0.36` | 63.14 |
| 5 | **restored** — `npx tsc --noEmit` | **0** | zero output | `real 1.37 user 2.12 sys 0.40` | — |
| 6 | **restored, matched baseline** — same two files as rows 1-3 | **0** | **60 passed** | `real 28.63 user 10.83 sys 2.04` | 70.78 |

Rows 1-3 and 6 are spawn- and network-bound (the three live admission arms start real `FabricNode`
listeners), so `real` legitimately exceeds CPU time; the ratios are a comparability key, not a
verdict. Rows 1 and 6 are the matched clean baselines that make rows 2 and 3 attributable.

**Tree discipline.** `git status --porcelain` was **empty** before the session, before and after
every restore, and at the end. Snapshots were taken with `cp` into the session scratchpad
*immediately before* each plant and used **only** as the `cmp` reference — **every restore was the
surgical inverse of this verifier's own one-line edit, never a `cp` back**. Each restore was
confirmed by `cmp` **exit 0**, by `shasum -a 256` back to the pre-plant digest, and by
`git diff --quiet` over the **whole tree** exit 0. Plant-target occurrence counts were read
**before** each plant (**1** in each file) so an unapplied plant could not be mistaken for a green
one. **No `git add`, `commit`, `stash`, `checkout --`, `restore`, `reset` or `clean` was used at any
point**, no process this verifier did not start was signalled, no other agent was spawned, and the
two planted files were never modified simultaneously.

---

### Verdict

| | |
|---|---|
| **Criterion 1** | MET — unchanged, not re-opened |
| **Criterion 2** | MET — unchanged, not re-opened |
| **Criterion 3** | **MET** — rate-limiting clause MET since 2026-08-05; cost clause carried to Phase 24 criterion 8 (MET), and the composing link that the 2026-08-06 pass declined on — one certificate admits exactly one identity — is now guarded by `relay-admission.node.test.ts`, **re-planted and watched red at exit 1 by this verifier**, with the both-ways control holding. **Closes carrying criterion 8's stated bound verbatim** |
| **Score** | **3 / 3** |
| **Phase** | `human_needed` — no gaps remain; two items await an owner decision, neither of which is a criterion-3 gap |

**3/3**

---

_Amended: 2026-08-07T08:16:20Z at `ba5c473`, working tree clean before and after; both plants
restored by the surgical inverse of this verifier's own edit, confirmed with `cmp` exit 0,
`shasum -a 256` back to the pre-plant digest, and `git diff --quiet` over the whole tree exit 0._
_Verifier: Claude (gsd-verifier), fourth pass — goal-backward re-verification of criterion 3 only._
_No source, test, ledger, roadmap or state file was modified. Nothing was staged, committed or
stashed. Every exit code above was read with `EXIT=$?` on the immediately following line._
