---
phase: phase-17-node-identity-enrollment
plan: 03
subsystem: node
tags: [AUTH-01, AUTH-04, identity, enrollment, libp2p, startup, certificate]

requires:
  - phase: phase-17-01
    provides: "generateSeed / identityFromSeed / peerIdForNodeKey / parseKeyHex, loadOrCreateSeed + IDENTITY_FILE + PROVIDER_FILE, and the widened FsBlockstore filter"
  - phase: phase-17-02
    provides: "the enrol wire kind, enrolOverRpc / EnrolOutcome / UNREACHABLE_PROVIDER, parseCertificate exported from @o2/net, and the ninth serveAgent hook"
  - phase: phase-6
    provides: "requestEnrollment, EnrollmentAuthority, verifyCertificate, NodeCertificate"
provides:
  - "FabricNode.nodeKey / issuerKey / certificate — a running node's identity as node state"
  - "FabricNodeOptions.issuesCertificates and FabricNodeOptions.enrollment"
  - "createLibp2p receives a persisted key, so a node's peer id survives its process"
  - "@o2/node CERTIFICATE_FILE / loadCertificate / saveCertificate — the disk path, guarded by the wire's parser plus parseKeyHex"
  - "resolveCertificate — the first production caller of requestEnrollment, EnrollmentAuthority and peerIdForNodeKey"
affects: [17-04, 17-05, phase-19, phase-22]

tech-stack:
  added: []
  patterns:
    - "a failure path that throws exactly one string, built at one site, for every arm and every route into it"
    - "a release pushed onto the undo stack on the line after each acquisition, extended to the first await that can reject"
    - "reuse-on-restart proved by switching the provider OFF rather than by reading a counter"

key-files:
  created:
    - packages/node/src/node-identity.node.test.ts
    - packages/node/src/node-enrollment.node.test.ts
  modified:
    - packages/node/src/fabric-node.ts
    - packages/node/src/identity-store.ts
    - packages/node/src/identity-store.node.test.ts
    - packages/node/src/index.ts

key-decisions:
  - "FabricNodeOptions.enrollment carries `userPrivateKey`, NOT the plan's `userKey: PublicKeyHex`. The plan's shape cannot produce an ownerProof and would be refused `bad-owner-proof` on every attempt."
  - "libp2p.stop() is NOT called from the enrollment failure path. FabricNode.start's existing `undo` unwinder already does it; a second call would replace the caller's error with a shutdown error."
  - "Reuse-on-restart is measured by stopping the provider, not by issuedWithin. No test-visible route to that counter exists and none was added — a public authority field would put issuance one property access away from every node holder."
  - "The plan's missing-field reddening claim was measured false as written (`issuer` is caught by both layers). The test now drops `signature`, which isolates parseCertificate."

requirements-completed: [AUTH-01]

metrics:
  tasks: 3
  commits: 6
  duration: ~35 min
  completed: 2026-08-01
---

# Phase 17 Plan 03: Identity and enrollment on the startup path — Summary

**A `FabricNode` now resolves a persisted on-device identity before `createLibp2p`, so its
peer id survives its process; and when given a provider address it completes an enrollment
round trip over the fabric's own protocol before `start()` returns, holds the
provider-signed certificate as node state, reuses an unexpired one on restart without
contacting anybody, and — when it cannot enrol — does not start at all.**

## Performance

- **Duration:** ~35 min
- **Tasks:** 3 of 3 (three TDD gate pairs)
- **Files created:** 2 · **Files modified:** 4
- **Commits:** 6

## Task commits

| # | Gate | Hash | Message |
|---|---|---|---|
| 1 | RED | `a482809` | `test(17-03): a certificate read back off disk, asserted before it can be` |
| 1 | GREEN | `42dde8c` | `feat(17-03): the certificate on disk, guarded by the parser that guards the wire` |
| 2 | RED | `726c41b` | `test(17-03): a node restarted is a different node, measured before it is fixed` |
| 2 | GREEN | `fc65f0e` | `feat(17-03): one on-device seed becomes the peer id libp2p dials by` |
| 3 | RED | `96b54e7` | `test(17-03): the enrollment round trip on start, asserted before it exists` |
| 3 | GREEN | `534d057` | `feat(17-03): a node told to enrol gets a certificate, or does not start` |

Every RED gate was watched failing. Task 2's RED is worth naming: it failed on the
**pre-phase behaviour itself** rather than on a missing import — two starts against one
directory reported two different peer ids, which is the defect the plan exists to remove.

## Corrections — every wrong claim and citation, for 17-04 and 17-05

### The plan's `<interfaces>` block is wrong in a way that would not compile

| # | Plan says | Truth |
|---|---|---|
| **C1** | `requestEnrollment(nodePrivateKey, fields)` with `fields.userKey: PublicKeyHex` | **3 params** — `(nodePrivateKey, userPrivateKey, fields)`, `enrollment.ts:176`. Exactly what 17-02's summary already recorded, restated unchanged in this plan. |
| **C2** | `FabricNodeOptions.enrollment` holds `userKey: PublicKeyHex` | **Unbuildable, and not merely a compile error.** `EnrollmentAuthority.enrol` verifies an `ownerProof` — the *user's* signature over the possession challenge — at `enrollment.ts:269-285`, and refuses `bad-owner-proof` without it. A public key cannot sign, so a node configured the plan's way would be refused on **every** attempt with a correctly-named refusal, which is the hardest kind of defect to spot. The option now takes `userPrivateKey: Uint8Array`. |
| **C3** | *"In `start`, catch anything thrown from this step, `await libp2p.stop()`, and rethrow."* | **Already done, and doing it again would be a defect.** `FabricNode.start` is now a thin wrapper over `#compose` with an `undo` stack; `undo.push(() => libp2p.stop())` sits immediately after `createLibp2p`. A second `libp2p.stop()` in the enrollment path would run during the unwind too and could replace the caller's real error with a shutdown error — which `start`'s own doc says must never happen. |

### Line drift in `packages/node/src/fabric-node.ts`

The plan's construction-order table is off by **roughly +200 to +330 lines** throughout,
because `start` was split into `start` + `#compose` by an earlier phase. **Re-grep; do not
cite this table from the plan.**

| Plan cites | Actual (this commit) |
|---|---|
| `:271-274` store block | **`:766`** |
| `:278-289` listen / `canRelay` | **`:790-798`** |
| `:303` `createLibp2p` | **`:812`** |
| `:340-342` relay dial loop | **`:898`** |
| `:344` `Libp2pTransport.start` | **`:909`** |
| `:348` `sovereignty` | **`:916`** |
| `:351-355` `egress` / `rpc` | **`:945-946`** |
| `:359` `RpcBlockSource` | **`:992`** |
| `:377` executor id binding | **`:1051`** (and `:884` for `LocalCapacity`) |
| `:381-392` `new FabricNode` | **`:1058`** |
| `:411-425` `serveAgent` | **`:1093`** |
| `:430-432` `get peerId` | **`:1153`** |
| `:104-113` `blockstoreDir` doc | **`:147`** |
| `enroll` hook line (17-02 said `:770`) | **`:1130`** |

### Other citations

| # | Cited | Actual |
|---|---|---|
| C4 | `enrollment.ts:178-180` issuance defaults | **`:229-231`** — as 17-01 and 17-02 both already recorded. The comment in `fabric-node.ts` cites the corrected range. |
| C5 | `fabric-node.node.test.ts:206`/`:214` restart assertion | **`:253`/`:261`** — 17-01's correction confirmed again. |
| C6 | `egress-refusal.node.test.ts:97-108` "the reasoning it records for its own budget" | The `rpcTimeoutMs: 10_000` is at **`:172`**; `:97-108` is a type declaration and an interface. The *clock* reasoning the coordinator flagged is at **`:215-223`** (the `afterEach` doc), and that is what this plan's new files reuse. |
| C7 | `enrollment.ts:186-247` for `issuedWithin` and `enrol` | `issuedWithin` **`:239`**, `enrol` **`:243`**. |
| C8 | `seed-server.ts:191-195` / `:180-200` | `SeedServer.start`'s `FabricNode.start` call is unchanged by this plan and still passes no new option; the range was not re-verified because nothing needed to change there. |
| C9 | "29 calls / 12 files" (17-02 corrected to 46/20) | **49 `serveAgent(` occurrences across 22 files** at this commit, counted by grep, including the declaration in `agent.ts`. **Six production files**, `packages/bench/src/perf-workload.ts` among them. No new hook was added by this plan, so no call site needed editing — but the count was taken, not transcribed. |

## Deviations from plan

### [Rule 1 — Bug] The `enrollment` option shape could not work

- **Found during:** Task 3, reading `enrollment.ts` before implementing rather than trusting the plan.
- **Issue:** C2 above. The plan specifies `userKey: PublicKeyHex`. `requestEnrollment` derives `userKey` from a private key *by design* — its own doc says *"naming somebody else's user key is not a thing this function can be asked to do"* — and `enrol` refuses `bad-owner-proof` when the user's signature is absent.
- **Fix:** `enrollment.userPrivateKey: Uint8Array`. The doc records why, records that this is the one option on the interface taking key material, and records that it is deliberately **not** reachable from argv — `--user-key <hex>` would be a regression *and* could not work, because a public key cannot sign.
- **Consequence for 17-05:** `--user-key <hex>` as specified **cannot be implemented**. The flag must name a *file* holding a 32-byte seed (the `loadOrCreateSeed` shape), or the key must come from a prompt. `parseKeyHex`'s remaining committed call site in 17-05 is `--trusted-issuer`, not `--user-key`.
- **Commit:** `534d057`

### [Rule 1 — Bug] A `<proof>` reddening claim that does not hold as written

- **Found during:** Task 1 mutation verification.
- **Issue:** The plan pairs `expect(await loadCertificate(dirWithMissingField)).toBeNull()` with *"reddened by deleting the `parseCertificate(...)` call"*. Planted and measured: with `issuer` as the dropped field it reddens **0** tests, because the `parseKeyHex` narrowing also rejects a missing `issuer` — `/^[0-9a-f]{64}$/.test(undefined)` coerces to the string `'undefined'` and is false. A field caught by both layers isolates neither.
- **Fix:** The test drops `signature`, which is outside the narrowing's three keys, so it reddens for exactly one reason. The `issuer` case is kept as a second assertion with the overlap stated in the docblock. Re-measured: the mutation now reddens **2**.
- **Commit:** `42dde8c`

### [Rule 2 — Missing critical] `transport` and `rpc` had no release on the unwind stack

- **Found during:** Task 3.
- **Issue:** `#compose` pushes `libp2p.stop()` and nothing else. Until this plan, nothing between `Libp2pTransport.start` and the end of `#compose` could reject, so the gap was inert. The enrollment step is the first `await` that can.
- **Fix:** `undo.push(() => transport.stop())` and `undo.push(() => rpc.close())` immediately before the enrollment call — the discipline `#compose`'s own doc describes ("a release pushed on the line after each acquisition"). Releases run newest-first, which reproduces `FabricNode.stop()`'s order.
- **Commit:** `534d057`

### [Deliberate departure] Reuse-on-restart is measured by stopping the provider

The plan offers `issuedWithin(userKey, now) === 1` "if a construction path for that
exists", falling back to `issuedAt` equality. **No such path exists and none was added** —
`issuesCertificates` is a boolean by design and `#authority` is private so that nothing can
issue certificates around the wire.

`issuedAt` equality alone is weak: it shows the timestamp did not change, not that nobody
was contacted. So the test does something strictly stronger — it **stops the provider**
before the restart. A node that re-enrolled could not possibly succeed (the sibling test
proves an unreachable provider makes `start()` reject), so a node that starts anyway
holding a byte-identical certificate demonstrably contacted nobody. That is decision 11's
*"and do not contact the provider"* read directly rather than inferred from a count.

## Measurements taken

### Mutation verification — 13 planted, measured, restored, `cmp`-confirmed byte-identical

| # | Mutation | Reddened |
|---|---|---|
| M1 | `parseCertificate(...)` deleted from `loadCertificate` | **2** (missing-field, discoverability) — **0** before the test was corrected |
| M2 | `parseKeyHex` narrowing deleted | 1 |
| P1 | `privateKey: identity.privateKey` deleted from `createLibp2p` | 2 (restart, both-ways derivation) |
| P2 | no-directory `generateSeed()` → constant seed | 1 |
| P3 | authority reads `IDENTITY_FILE` instead of `PROVIDER_FILE` | 1 |
| P4 | leading dot dropped from `IDENTITY_FILE` | 2 — **one of them `fabric-node.node.test.ts`'s restart assertion** |
| E1 | `enrolOverRpc` call removed, `null` returned | **9 of 10** — every enrollment assertion except the regression bar |
| E2 | `canRelay ? 'seed' : 'via-relay'` → literal `'seed'` | 1 |
| E3 | `relayPeerIds.push(connection.remotePeer…)` deleted | 1 |
| E4 | the `throw` replaced by `return null` | 2 (both fatal-when-asked-for cases) |
| E5 | the dial `try/catch` deleted | 1 (the `UNREACHABLE_PROVIDER` assertion) |
| E6 | `peerIdForNodeKey(loaded.nodeKey) === identity.peerId` deleted | 1 (another node's certificate) |
| E7 | `expiresAt > Date.now()` deleted | 1 (expired certificate) |

**E1 not reddening the tenth test is the point of that test.** "A node not told to enrol
starts with `certificate` null" is a regression bar, not a feature proof — no deletion in
this plan turns it red, and it says so in its own docblock. Its value is that a deletion
*elsewhere*, making enrollment unconditional, would.

**P4 is the one that matters most.** It confirms — on the **production** path, where 17-01
could only confirm it at the store level — that `fabric-node.node.test.ts:261`'s
`expect(reopened.size).toBe(sizeBeforeRestart)` is genuinely what the dot rule protects.
This plan is what first writes non-block files into a real running node's blockstore
directory, and that assertion is what would have caught it.

### What an operator reads without the `UNREACHABLE_PROVIDER` mapping

Measured under E5, against a real address with nothing bound to it:

```
connection error 127.0.0.1:62849: connect ECONNREFUSED 127.0.0.1:62849
```

It names neither the word "provider" nor the multiaddr the operator actually configured.
With the mapping, the message names both plus the failure kind. This is exactly what 17-02
handed forward, now measured rather than accepted.

### The three-state table, all three rows exercised

| Configuration | Behaviour, measured |
|---|---|
| no `enrollment` | starts, `certificate` null, `nodeKey` a 64-char hex string, `issuerKey` null |
| `enrollment` given, provider issues none | `start()` rejects with `this node issues no certificates`, and a second node **binds the same explicit port afterwards** |
| `enrollment` given, nothing listening | `start()` rejects naming the address and `provider unreachable` |

The socket assertion is a real port obtained by binding and releasing an ephemeral one, not
a guessed number.

## Verification

| Command | Result |
|---|---|
| `npx tsc --noEmit` (repo root) | **exit 0** |
| `npx vitest run --project node` | **1487 passed**, 18 skipped, 2 files skipped |
| `npx vitest run --project browser` | **3198 passed** (213 files, 3 engines) |
| `npx vitest run --project e2e` | **40 passed** (8 files) |
| `vocabulary` + `purity` + `serve-agent-hooks` + `trust-anchors`, run **after** committing | **66 passed** |

`--project perf` was **not run**, and that is a decision rather than an omission: it exists
only under `O2_PERF=1` (`vitest.config.ts:68`) and its assertions *are* wall-clock
measurements. Load average was between 14 and 30 for the whole of this plan, so any number
it produced would be a measurement of the machine's contention. Nothing this plan adds is
timing-based.

The four files the plan requires be **run and not modified** — `fabric-node.node.test.ts`,
`two-process.node.test.ts`, `egress-refusal.node.test.ts`,
`sovereignty-placement.node.test.ts` — all pass unchanged, and none appears in
`git diff --name-only`. **No assertion anywhere was weakened.**

### Resolver provenance

The worktree had no `node_modules`. A farm was built — 184 third-party entries symlinked
from the main install, `@o2/*` repointed at **this worktree's** `packages/*` with absolute
links — and proved with `createRequire(...).resolve` before any result was trusted:

```
WORKTREE @o2/core     -> …/agent-ac1513dfd36197afa/packages/core/src/index.ts
WORKTREE @o2/net      -> …/agent-ac1513dfd36197afa/packages/net/src/index.ts
WORKTREE @o2/node     -> …/agent-ac1513dfd36197afa/packages/node/src/index.ts
WORKTREE @o2/libp2p   -> …/agent-ac1513dfd36197afa/packages/libp2p/src/index.ts
MAIN     vitest, typescript, @libp2p/crypto, @noble/curves, libp2p
```

A wholesale `node_modules` symlink would have resolved `@o2/*` back to the main checkout,
because those links are relative — `tsc` and `vitest` would have reported clean without
reading a line of this worktree.

## Known stubs

None. Every export added here has a production call path or a test that exercises it.

## Equal functionality — one gap, stated rather than hidden

**A browser node still cannot do what a Node node now can, and this plan widened that gap.**
`browser-node.ts:387` calls `createLibp2p` with **no `privateKey`**, so a browser peer gets
a fresh ephemeral identity per tab and has no `enrollment` option to pass. After this plan a
Node process has a certificate and a browser tab structurally cannot obtain one.

This is **not** a decision keyed on node kind — nothing in `fabric-node.ts` or
`resolveCertificate` reads what kind of node anything is, and `BrowserNode` is a
pre-existing second factory, not a second class of node. But it is a real functional
asymmetry, it is the shape the project's standing rule exists to catch, and reporting it is
the whole point of the rule. 17-CONTEXT.md defers it ("Browser-tier identity persistence")
and the plan's Out of Scope does not mention it at all.

**What closing it needs:** the seed in IndexedDB (the `idb-blockstore.ts` pattern),
`privateKey` at `browser-node.ts:387`, and the same `enrollment` option. Nothing in the
mechanism is Node-specific — `identityFromSeed`, `requestEnrollment` and `enrolOverRpc` are
all portable and all three already run in the browser project. **Until that lands, "a
browser node enrolls and is verified on identical terms" is a claim this repository cannot
make.**

## Unmeasured — stated, not descoped

- **The insecure-context branch.** Unchanged from 17-01: both vitest projects run on a
  secure origin, so a LAN `http://` origin is never exercised anywhere in this repository.
  This plan adds no new `crypto.subtle` reference and no new instrument for it. AUTH-02's
  "offline verification with no live call to any authority" holds by construction on the
  reuse path — `loadCertificate` + `peerIdForNodeKey` + an expiry comparison, no network —
  but that is an argument from the code, not a measurement in a non-secure context.
- **AUTH-04's cost claim.** Unchanged from 17-02 and not improved here: the limiter is
  keyed on `userKey`, twenty distinct user keys still all enrol unslowed, and this plan
  adds no cost to obtaining a user key. **Rate-limiting measured; cost unmeasured.**
- **Certificate renewal before expiry.** Re-enrollment happens only at start. A node that
  stays up past `certificateLifetimeMs` keeps presenting an expired certificate and nothing
  here notices.
- **Nothing pins the provider.** The node accepts a certificate from whoever answers the
  configured address. Pinning is 17-04's trusted-issuer set; until then a wrong
  `providerAddr` yields a certificate from the wrong fabric with nothing on this path
  reporting it.
- **Cross-process.** Everything here is in-process over real libp2p sockets. A real
  `bin/agent.ts` spawn against a fresh directory is 17-05's.

## Notes for 17-04 and 17-05

1. **`FabricNode.certificate` is public; `#authority` and `#identity.seed` are not.** 17-04
   serves the certificate through the `index` hook — it is already node state and needs no
   new plumbing.
2. **`resolveCertificate` is `peerIdForNodeKey`'s only production call site**
   (`fabric-node.ts:441`, the reuse branch). If 17-04 restructures the reuse path, that
   export must come out of the `@o2/libp2p` barrel with it or Phase 22's guard fails on it.
3. **`nodeKeyForPeerId` still has no production caller.** 17-01 committed it to "17-03's
   verifier, deriving the expected `nodeKey` on `peer:connect`" — that verifier is 17-04's,
   not this plan's, and the plan correctly puts it out of scope. It remains an untraced
   barrel export until 17-04 lands.
4. **`--user-key <hex>` cannot be built** (see C2). Plan for a key *file* or a prompt.
5. **The `enrol` hook is live at `fabric-node.ts:1130`** as `authority ?? 'issues-no-certificates'`.
   The literal still appears exactly once, so `serve-agent-hooks.node.test.ts:87`'s count is
   unchanged — verified, not assumed.
6. **`.certificate.json` is the third non-block file in a node's blockstore directory.**
   Anything a later phase writes there must be dot-prefixed; the filter *is* the counter.

## Threat flags

| Flag | File | Description |
|------|------|-------------|
| `threat_flag: key-material-in-option` | `packages/node/src/fabric-node.ts` | `FabricNodeOptions.enrollment.userPrivateKey` is the first option on this interface to accept a private key. It is required — an `ownerProof` cannot be produced without it — and its doc records that it must not reach argv. A future `--user-key <hex>` would put a user's signing key in `ps` output for every account on the host. |
| `threat_flag: secret-at-rest` | `packages/node/src/fabric-node.ts` | `.provider.key` now lands in a real node's `blockstoreDir` on the production path. Anything that can read that directory can issue certificates in this node's name. `0o600` on create is the whole of the protection; filesystem isolation is the deployment's problem and this design does not provide it. |

## Self-Check: PASSED

Created files:

- `packages/node/src/node-identity.node.test.ts` — FOUND
- `packages/node/src/node-enrollment.node.test.ts` — FOUND

Commits: `a482809`, `42dde8c`, `726c41b`, `fc65f0e`, `96b54e7`, `534d057` — all FOUND.

Constraint checks:

- `.planning/STATE.md`, `.planning/ROADMAP.md` — **not modified** (`git diff --name-only`
  over the whole plan lists exactly the six files above).
- `fabric-node.node.test.ts`, `two-process.node.test.ts`, `egress-refusal.node.test.ts`,
  `sovereignty-placement.node.test.ts` — **not modified**, and all run green.
- `npx tsc --noEmit` — exit 0, against a resolver proved to read this worktree.
- Working tree clean; every planted mutation restored and `cmp`-confirmed byte-identical.
