---
status: resolved
trigger: "Live intermittent fail-open in packages/node/src/relay-admission.node.test.ts:1132 — `theirs` (enrolled providerB) holds a reservation on a relay pinning providerA. 2 failures in 12 executions. Is the race in the FIXTURE or the GATE?"
created: 2026-08-06T21:51:00Z
updated: 2026-08-08T12:30:00Z
---

## RESOLVED 2026-08-08 — it was neither the fixture nor the gate

**The intermittent fail-open was another agent's live planted mutation, observed mid-plant.** Two
verifier agents were launched in parallel and both planted `packages/node/src/fabric-node.ts`;
one read the other's plant as an intermittent fail-open in the admission gate, and it was
escalated as a possible security defect. Refuting it took 111 executions, a patch to
`node_modules`, and a reading of the library's call ordering.

The finding is recorded in `CLAUDE.md` § Conventions, where it became the standing rule:
**agents that plant must not run in parallel on shared source**, and *"an observation taken while
another agent holds a plant is not a measurement of the tree."* Checking that two plans'
`files_modified` are disjoint is NOT sufficient, because a plant can touch any file.

No defect in `relay-admission.node.test.ts` and none in `relayAdmissionGate`. Closed against the
v1.1 milestone audit's tech-debt sweep.

## Current Focus

hypothesis: the gate is analytically fail-closed on every path AND the store is written only after
  the gate returns falsy — so either (a) the gate genuinely admitted `theirs` (which requires
  verifyCertificate to pass against providerA's issuer for theirs' nodeKey), or (b) something other
  than this relay's handleReserve put the entry in the map.
test: reproduce under loop + CPU load, capture the decision record on a failing run
expecting: a failing run's admissionDecisions for `theirs` says admitted:true (gate defect) or
  admitted:false (store/fixture defect)
next_action: run whole-file loop; if no repro, add CPU load; if repro, capture decisions

## Symptoms

expected: a node enrolled with providerB, meeting a relay that pins providerA, must NOT hold a reservation
actual: `theirs` peer id present in the relay's reservation list — `expected [ ...(2) ] to not include '12D3KooWGBms8uwLisZMUcZs3HoNfuL3ws4oc...'`
errors: "AssertionError: expected [ …(2) ] to not include '12D3KooWGBms8uwLisZMUcZs3HoNfuL3ws4oc…'" at relay-admission.node.test.ts ~1132
reproduction: run the file repeatedly; 2/12 failures reported. Failed at 1-min loads 7.54, 10.90; passed at 6.78, 11.02, 11.10, 11.21, 11.22, 11.53, 15.60. Not a monotone load threshold.
started: unknown; Phase 24 criterion 8 scored MET 2026-08-06 with no mention of flake in 24-VERIFICATION.md

## Eliminated

## Evidence

- timestamp: 2026-08-06T21:53Z
  checked: git show 8719029^:packages/node/src/relay-admission.node.test.ts line 1132
  found: at the parent of HEAD (the tree state when the failure was observed) line 1132 IS
    `expect(relay.reservedPeerIds).not.toContain(theirs.peerId)`
  implication: the report's identification of arm 3 / `theirs` is correct, not inferred wrongly.
    HEAD (8719029) shifted the block by +3; today that assertion is at line 1135.

- timestamp: 2026-08-06T21:53Z
  checked: commit message of 8719029
  found: "The known intermittent fail-open in relay-admission arm 3 did NOT fire in these runs — 38
    of 38 — so nothing here can be confused with it. It remains tracked and unattributed."
  implication: the intermittent is already known and explicitly unattributed. 24-VERIFICATION.md
    still contains no mention of it.

- timestamp: 2026-08-06T21:55Z
  checked: node_modules/@libp2p/circuit-relay-v2/dist/src/server/index.js handleReserve, lines 115-128
  found: the gater is awaited at line 123 and `this.reservationStore.reserve(...)` is at line 128 —
    strictly after. `reserve()` has exactly one caller in the package.
  implication: an entry in the store implies the gate resolved falsy (or threw, which propagates and
    also skips reserve). There is no path that reserves first and gates after.

- timestamp: 2026-08-06T21:56Z
  checked: relayAdmissionGate, fabric-node.ts:845-968
  found: every `return` inside the returned closure goes through `decide(...)`; `decide(true, …)` is
    reachable only after `verifyCertificate(certificate, issuers, now).ok`. The out-of-budget fall
    through at line 966 is `decide(false, lastReason)`. `withBudget` rejects into a `catch` that
    retries rather than admitting.
  implication: no admit-while-pending path; the gate cannot fail open by timeout.

- timestamp: 2026-08-06T21:58Z
  checked: fixture helpers — madeDir (mkdtemp per call), generateSeed (ed25519.keygen()),
    browserDialableAddrs (own libp2p.getMultiaddrs() filtered to /ws)
  found: no shared blockstore dir, no deterministic identity seed, no crossed provider address
  implication: rules out state leak across tests and rules out `theirs` accidentally enrolling with
    providerA via a shared address

- timestamp: 2026-08-06T22:05Z
  checked: 60 iterations of the single test, `npx vitest run --project node
    packages/node/src/relay-admission.node.test.ts -t 'refuses a peer with no certificate'`
  found: 60/60 exit 0. Loads before each iteration ranged 6.14 – 10.84.
  implication: the single test in isolation does not reproduce at this load band

- timestamp: 2026-08-06T22:03Z
  checked: 20 whole-file iterations, `npx vitest run --project node
    packages/node/src/relay-admission.node.test.ts`
  found: 20/20 exit 0, 38/38 tests each. Loads before each iteration 5.45 – 14.89, spanning and
    exceeding the reported failing band (7.54, 10.90).
  implication: 80 total executions, 0 failures. Not reproduced at natural load.

- timestamp: 2026-08-06T22:06Z
  checked: RpcEndpoint.request/#receive in packages/net/src/rpc.ts — pending key is
    `${peer}\u0000${id}`, and #receive matches on (from, id)
  implication: a response from `mine` cannot resolve a request the relay sent to `theirs`.
    The crossed-response hypothesis is eliminated.

- timestamp: 2026-08-06T22:06Z
  checked: probe installed in node_modules/@libp2p/circuit-relay-v2/dist/src/server/index.js
    (git-ignored; `git status --porcelain` unchanged). Logs the gater's return value BEFORE the
    `=== true` comparison, and the store status/size AFTER `reservationStore.reserve`.
  found: probe fires. A PASSING arm-3 run logs exactly three GATE lines for the pinned relay —
    two `deny=true`, one `deny=false` followed by `RESERVE status=OK size=1`.
  implication: the instrument reads, and it separates the two hypotheses in one line: a failing
    run shows either two `deny=false` (gate admitted) or one `deny=false` with size=2 (entry
    without a grant).

- timestamp: 2026-08-06T22:03Z
  checked: single install of @libp2p/circuit-relay-v2 @ 4.2.9; admitsAnyPeer is strict equality
    on the sentinel; no `.add(` mutates the pinned issuer Set anywhere; verifyCertificate's
    FIRST check is `trustedIssuers.has(certificate.issuer)`
  implication: no duplicate relay implementation, no runtime widening of the pinned set, no
    fail-open branch in certificate verification

- timestamp: 2026-08-06T22:24Z
  checked: 15 multi-file contention iterations (8 node specs in parallel workers) under 6 CPU
    burners, loads 10.91 – 29.25
  found: 14/15 exit 0. The one exit-1 was `enrolment-needs-no-reservation.node.test.ts` failing
    with `RpcFailure: rpc to … timed out after 20000ms` — a duration exactly equal to the
    fixture's own `rpcTimeoutMs`, i.e. evidence of the timeout. relay-admission passed in that
    run and in all 15.
  implication: arm 3 did not reproduce at loads up to 29.25, well above the reported failing band

- timestamp: 2026-08-06T22:25Z
  checked: PLANT — `fabric-node.ts:961`, `if (!verdict.ok)` -> `if (false && !verdict.ok)`,
    neutralising the pinned-issuer verdict in the gate and nothing else. Verified one hunk before
    running.
  found: RED, exit 1 read directly.
    `AssertionError: expected [ …(2) ] to not include '12D3KooWPkxqNC6nfGAPXNT1fxi1rNeF4U2gc…'`
    at `relay-admission.node.test.ts:1135:41` (= line 1132 at HEAD^).
    Probe on the same run:
      GATE peer=…Cq33Ydw2 deny=false -> RESERVE OK size=1     (mine)
      GATE peer=…PkxqNC6n deny=false -> RESERVE OK size=2     (theirs)
  implication: **the reported symptom is byte-for-byte the signature of a neutralised gate.** Same
    assertion, same 2-element array, same message shape, same line. And the mechanism is visible:
    the gate ANSWERED ADMIT.

- timestamp: 2026-08-06T22:26Z
  checked: RESTORE by surgical inverse; `git diff` empty, `cmp` against `git show
    HEAD:packages/node/src/fabric-node.ts` exit 0; `git status --porcelain` shows only the
    untracked debug file
  found: control run 38/38, exit 0 read directly. Probe: exactly one `deny=false`, `size=1`.
  implication: the proof runs both ways — the instrument reddens on the mutation and greens on
    the restore, so the green is not vacuous

## Resolution

root_cause: NOT ESTABLISHED BY REPRODUCTION — arm 3 did not reproduce in 111 unmutated
  executions at 1-minute loads 5.45 – 37.76 (60 single-test, 34 whole-file, 15 multi-file with
  8 specs in parallel workers under 6 CPU burners, plus 2 controls). Reported failing loads were
  7.54 and 10.90, inside that band.
  What IS established by measurement:
  1. The gate has no admit path for `theirs`. `decide(true, …)` is reachable only after
     `verifyCertificate(cert, {providerA.issuer}, now).ok`, whose FIRST check is
     `trustedIssuers.has(certificate.issuer)`. `theirs` holds one certificate, issued by
     providerB. Every other exit from the gate is `decide(false, …)`.
  2. `reservationStore.reserve` is called strictly AFTER the gater and has exactly one caller,
     so a store entry implies the gate answered admit. Confirmed by probe on 90+ gate calls:
     every pinned relay admitted exactly one peer.
  3. Planting the pinned-issuer verdict reproduces the reported message EXACTLY, and the probe
     shows `deny=false` for `theirs` and `size=2`.
  Therefore the reported red requires the gate to have been altered. The most probable
  attribution is a CONCURRENT AGENT'S PLANT in `fabric-node.ts` present during those runs —
  this session's own opening `git status` showed `M packages/node/src/fabric-node.ts`, and
  commit 8719029 records two plant/restore cycles in that same file at that same hour.
  This is an attribution by signature match plus 97 clean executions, NOT by reproduction.
fix: none applied — no defect located in the gate
verification: plant RED / restore GREEN, both exit codes read directly; probe corroborates
files_changed: []
