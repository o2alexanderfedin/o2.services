---
phase: phase-17-node-identity-enrollment
plan: 02
subsystem: net
tags: [AUTH-01, AUTH-02, AUTH-04, wire-protocol, enrollment]
requires:
  - "@o2/core enrollment.ts — EnrollmentAuthority, requestEnrollment, verifyCertificate (Phase 6)"
  - "@o2/net protocol.ts — certificateToValue/parseCertificate (Phase 6)"
provides:
  - "AgentRequest/AgentResponse `enrol` — the ninth request kind, both directions"
  - "AgentOptions.enroll — the eighth required serveAgent hook"
  - "enrolOverRpc / EnrolOutcome — the requesting half, three named failure arms"
  - "parseCertificate exported from @o2/net — one validator for wire and disk"
  - "UNREACHABLE_PROVIDER — the string 17-03 must reuse for a failed dial"
affects:
  - "every serveAgent call site in the repository (46, across 20 files)"
tech-stack:
  added: []
  patterns:
    - "named-absence sentinel on a required hook ('issues-no-certificates')"
    - "three-arm failure union rather than ok:false with an optional field"
key-files:
  created:
    - packages/net/src/enrol-client.ts
    - packages/net/src/enrol-protocol.test.ts
    - packages/net/src/enrol-agent.test.ts
  modified:
    - packages/net/src/protocol.ts
    - packages/net/src/agent.ts
    - packages/net/src/index.ts
    - packages/node/src/serve-agent-hooks.node.test.ts
    - packages/node/src/fabric-node.ts
    - packages/node/src/bin/bench.ts
    - packages/browser/src/browser-node.ts
    - packages/bench/src/perf-workload.ts
decisions:
  - "enrol is the NINTH request kind, not the eighth — protocol.ts already said eight"
  - "no capacity slot on the enrol branch: enrol() is synchronous, so a concurrency bound cannot bind"
  - "all three EnrollmentRefusal arms encoded, including bad-owner-proof which 17-CONTEXT.md omits"
metrics:
  tasks: 3
  commits: 3
  duration: ~25 min
  completed: 2026-08-01
---

# Phase 17 Plan 02: Enrollment on the wire, and the eighth hook — Summary

A node can now ask another node to certify it, over the same `RpcEndpoint` every other
request kind travels on, and gets back either a certificate or a refusal that names which
of three things was wrong. Whether a given process issues certificates is an eighth
required `serveAgent` hook, so omitting it fails `tsc --noEmit`.

## What was built

| Piece | Where | What it does |
|---|---|---|
| `enrol` request kind | `protocol.ts:136` (request arm), `:181` (response arm) | The ninth kind, both directions |
| `parseEnrollmentRequest` | `protocol.ts:297` | Seven fields, all required and typed, `null` on anything malformed |
| `parseEnrollmentRefusal` | `protocol.ts:362` | All **three** arms; unknown kind → `null` |
| `parseCertificate` | `protocol.ts:246` | Now exported — one validator for wire and disk |
| `AgentOptions.enroll` | `agent.ts:269` | The eighth required hook |
| enrol handler branch | `agent.ts:666` | Issues, or says by name that it does not |
| `enrolOverRpc` | `enrol-client.ts` | The requesting half, three named failure arms |

## Measurements

**AUTH-04's split, measured rather than predicted.** Twenty requests naming one user key
with twenty distinct node keys against one authority at its shipped defaults:

- **5 accepted, 15 refused.**

The test never writes `5` as the split — it asserts `accepted.length ===
refused[0].refusal.limit`, so the threshold is read out of the refusal itself. The
refusal's `limit` (5) and `windowMs` (3_600_000) are asserted as literals because the
refusal is *required* to carry them onto the wire; a threshold readable only from the
provider's source is not stated to the peer that hit it. `retryAfterMs > 0` is asserted
and every refusal in the burst states the same limit.

**The honest counter-measurement, asserted next to it.** Twenty requests naming twenty
**distinct** user keys, one node key each, against the same authority: **all 20 succeed.**
No deletion turns that test red, and that is the finding. Generating a fresh user key is
one keygen call, so an attacker holding many user keys is not slowed at all.

> **Criterion 3 is reported as: rate-limiting measured; cost unmeasured.**

**The limit's scope.** A third test enrols past the limit against one authority and then
succeeds immediately against a second — `#history` is a `Map` in the object, so the
threshold is per provider *uptime*, not per wall-clock window. A restarted provider has a
fresh budget. Asserted rather than left for a reader to infer.

**Mutation checks** (planted, then restored with `cp` and confirmed byte-identical with
`cmp`):

| Mutation | Result |
|---|---|
| `enrollment.ts:288` rate guard → `false` | burst test **red**; counter-measurement stayed **green**, as predicted |
| `agent.ts` enrol branch inverted | 6 of 8 agent tests **red** |

## Corrections — every incorrect citation, for 17-03..17-05

**The plan's `<interfaces>` block misdescribes `@o2/core`'s enrollment API in three ways
that would not compile.** These are not drift; they are wrong.

| Claim | Where claimed | Truth |
|---|---|---|
| "seven request kinds, nothing more" in `protocol.ts`' header; `enrol` is the **eighth** | 17-02 Task 1 action; objective | The header already said **eight**. `enrol` is the **ninth**. Now reads "nine". |
| `requestEnrollment(nodePrivateKey, fields)` — 2 params, `userKey` passed in `fields` | 17-02 interfaces | **3 params**: `(nodePrivateKey, userPrivateKey, fields)`. `userKey` is *derived*, and `fields` omits `nodeKey`/`userKey`/`proofOfPossession`/`ownerProof`. `enrollment.ts:176` |
| `EnrollmentRequest` has **six** fields; "a loop over the six field names" | 17-02 interfaces, Task 1 behavior | **Seven.** `ownerProof` is omitted from the plan entirely. `enrollment.ts:149` |
| `EnrollmentRefusal` has **two** arms | 17-02 interfaces; 17-CONTEXT.md decision 4 | **Three.** `bad-owner-proof` is missing. `enrollment.ts:193` |
| `enrol()` checks "possession first, then the window" | 17-02 interfaces; 17-CONTEXT.md | **Three** steps: possession → owner consent → window. `enrollment.ts:243/269/287` |
| `RpcError` has four arms | 17-02 interfaces | **Five** — `send-refused` (NET-09) is omitted. `rpc.ts:27` |
| 29 `serveAgent` calls across 12 files; **four** production sites | 17-02 interfaces table | **46 calls across 20 files; six production sites.** `packages/bench/src/perf-workload.ts` holds two that no plan names — the *same* miss `serve-agent-hooks.node.test.ts` already records for `RemoteExecutor` one phase earlier. It now has a sentinel row. |
| `sovereign-execution.test.ts` has 3 calls | 17-02 interfaces table | **4** |

Line-number drift (all uniformly low; re-grep before citing):

| Symbol | Cited | Actual |
|---|---|---|
| `possessionChallenge` | :117 | `enrollment.ts:142` |
| `EnrollmentRequest` | :124-132 | `:149` |
| `requestEnrollment` | :135 | `:176` |
| `EnrollmentRefusal` | :144-146 | `:193` |
| `EnrollmentAuthority` | :166 | `:217` |
| `issuedWithin` | :188-190 | `:239` |
| issuance defaults | :178-180 | `:229-231` |
| clock-as-parameter comment | :162-165 | `:214-215` |
| `#history` | :173 | `:224` |
| window filter / rate guard | :213 / :214 | `:287` / `:288` |
| `verifyCertificate` | :265 | `:339` |
| `untrusted-issuer` guard | :270 | `:344` |
| `certificateToValue` | `protocol.ts:150` | `:220` |
| `parseCertificate` | `:172` | `:246` |
| parser-discipline doc | `:164-171` | `:236-240` |
| `encodeRequest` | `:255-281` | `:498` |
| `parseRequest` | `:338-388` | `:648` |
| `encodeResponse` records case | `:436` / `:446-452` / `:449-454` | `:819`, records at `:829` |
| `parseResponse` records case | `:481` / `:501-508` | `:870`, records at `:890` |
| `AgentOptions` | `agent.ts:66-153` | `:114-270` |
| handler chain | `agent.ts:166-201` | `:568-799` |
| records branch | `agent.ts:176-181` | `:600` |
| `RpcBlockSource.fetch` | `agent.ts:46` | `:48` |
| `DEFAULT_RPC_TIMEOUT_MS` | `rpc.ts:23` | `:25` |

**One claim I did *not* write into source**, per the coordinator's warning about 17-01: I
made no assertion anywhere about hex case round-tripping. `@o2/net` is not routed through
`parseKeyHex` (a portable package may not import `@o2/libp2p`), so the wire parser keeps
its existing string typing, exactly as the plan's "Out of scope" says.

## Deviations from plan

### Auto-fixed

**1. [Rule 3 — Blocking] The `enrol` arm fell through into the `exec` branch**
- **Found during:** Task 1. Widening `AgentRequest` made `tsc` report six errors in
  `agent.ts` — the trailing `else` is where a new request kind lands by default.
- **Fix:** Added the `enrol` branch in Task 1's commit (answering by name), replaced in
  Task 2 with the real hook. Every commit typechecks and passes its suite.
- **Commit:** `7ba800e`, refined in `e34660f`

**2. [Rule 2 — Missing critical] 17 call sites and two production files the plan never named**
- **Found during:** Task 2's sweep. The plan's table would have left `tsc` failing.
- **Fix:** All 46 sites state the hook. `perf-workload.ts` gained a sentinel-count row
  recording that this is the second occurrence of one class of defect.
- **Commit:** `e34660f`

**3. [Rule 2 — Missing critical] `bad-owner-proof` end-to-end, and refusal *text***
- **Found during:** Task 3, reinforced by the coordinator mid-run. The plan asserts refusal
  *kinds*; the project rule is that a refusal naming the wrong thing is a defect even when
  the request correctly fails.
- **Fix:** All three arms now assert their exact reason string, and the third arm is
  exercised end to end over the wire.
- **Commit:** `b2acd87`

### Deliberate departures

**No `capacity` slot on the enrol branch.** The success criteria say a request branch that
does work must take and release a slot like `exec` and `combine`. It does not, and the
reason is measured rather than stylistic: `EnrollmentAuthority.enrol` is **fully
synchronous** (`enrollment.ts:243` — no `async`, no `await`). `LocalCapacity` bounds
*concurrent* work; nothing can interleave between a take and a release around a synchronous
call, so the count could never read above one and the bound would never bind. Adding one
would be a *reported* bound rather than a measured one — the precise defect class this
project keeps finding. The branch's real bound is AUTH-04's rate limit. What that leaves
open is stated in the source comment: forged requests are refused before the limiter and
cost two signature verifications each, bounded only by NET-08's inbound message ceiling.

**Module-comment count changed from "eight" to "nine", not "seven" to "eight."**

## Known stubs

None. `AgentOptions.enroll` is `'issues-no-certificates'` at all six production sites,
which is the truthful value today — no factory can be given a signing key until 17-03.

## What 17-03 inherits

- `enrolOverRpc` and `EnrolOutcome` from `@o2/net`.
- `UNREACHABLE_PROVIDER` (`'provider unreachable'`) — 17-03 Task 3 **must** reuse this
  string when `libp2p.dial` rejects, because the operator-facing case (a provider address
  with nothing listening) fails *before* `enrolOverRpc` is entered and never reaches its
  `unreachable` arm. Assert on that string, not on whatever libp2p said.
- `parseCertificate` from `@o2/net` for the disk path.
- The `enroll` hook line at `fabric-node.ts:770`, ready to take a real authority.

## Verification

- `npx tsc --noEmit` — clean, against a resolver **proven** to read this worktree
  (`createRequire(...).resolve('@o2/core')` → worktree `packages/core/src/index.ts`; a
  wholesale `node_modules` symlink would have resolved `@o2/*` back to the main checkout
  because those links are relative).
- `npx vitest run --project node` — **1427 passed**, 18 skipped.
- `npx vitest run --project browser` — **3147 passed** (3 engines).
- Both new test files pass in the browser project across chromium/firefox/webkit — a
  browser node enrols on identical terms, which is the equal-functionality rule holding.
- `vocabulary.node.test.ts` and `purity.node.test.ts` run **after** committing: pass.
- Every new test watched failing first.
- No assertion anywhere was weakened.

## Self-Check: PASSED
