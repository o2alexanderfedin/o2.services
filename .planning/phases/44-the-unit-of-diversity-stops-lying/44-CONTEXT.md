# Phase 44 — The Unit of Diversity Stops Lying — CONTEXT

**Discussion output is `docs/architecture/RFC-0003-RESPONSE-05-operator-identity-and-quorum-diversity.md`**
(commit `a85c23b`, amended `1b1e5fd`), plus the seven success criteria in
`.planning/ROADMAP.md` Phase 44. Both are committed and approved. This file records only
what was measured on **2026-09-16** while scoping, and the decisions that measurement forced.
Nothing here re-derives the design.

## What was measured while scoping, and was not known when the phase was written

### 1. This repository's own benchmark publishes `independent` for one user's machines

`packages/node/src/bin/bench.ts:1371` starts each worker with `operatorId: bench-worker-${i}`
— N distinct operator names. Its user key comes from `ownerOfWorker(i)` (`:1098-1101`), which
returns `BENCH_USER_SEED` **unconditionally unless `--sovereign` is passed**. The attestation
rung is `--discover`, not `--sovereign`. So the two workers whose agreement
`bench-attestation.node.test.ts:21` reports as *"two separate operators agreed"* are **two
processes under one user key**, and their `independent` label is exactly the defect this phase
is about, live, in a benchmark this milestone intends to publish.

**Consequence, and it is a change of meaning rather than of strings**: under derivation those
two workers share one `operatorId`, `classifyAttestation` returns `owner-domain`, and
`bench-attestation`'s two-node expectation must move `independent` → `owner-domain`. That is
the truthful reading — they are one owner's machines — and the move is a finding to record,
not a fixture to repair quietly. The rung that pairs with it (`owner-attested` at one node) is
untouched, so the file keeps the contrast that makes it a real instrument.

### 2. The multi-process quorum fixtures survive, because they already hold distinct user keys

`quorum-agents.node.test.ts:349-352` spawns each agent with its own `--user-key` file written
by `writeUserKey(name, fill)` (`:298-303`), whose seed is `new Uint8Array(SEED_BYTES).fill(fill)`
— distinct per agent. Distinct user keys derive to distinct operator ids, so every
`insufficient-operators` / `shared-relay-dependency` distinction in that file keeps its
meaning. Only the **strings** change. The same holds for `certificate-verification`,
`owner-domain-agents` and the other `--operator-id` spawn sites.

The comment at `quorum-agents.node.test.ts:1082` — *"the assertion that fails if the fixture is
built with one shared `--operator-id` — the single most likely way to get it wrong"* — describes
a mistake that **derivation makes unrepresentable**, and says so after this phase.

### 3. The type the ROADMAP calls `CertificateRefusal` does not exist

Measured: `grep -rn "CertificateRefusal"` over `packages/` returns nothing. The union is
`EnrollmentRefusal` (`enrollment.ts:790`) and its five arms are `bad-proof-of-possession`,
`bad-owner-proof`, `rate-limited`, `issuance-budget-exhausted`, `stale-challenge`. The new arm
goes there. **Follow the code, not the document's name for it.**

### 4. `issuer` appears zero times in `quorum.ts`, and RFC-0003 names neither word

Both re-measured today and both still hold: `grep -c issuer packages/core/src/quorum.ts` → `0`;
`grep -niEc "sybil|operator"` over `RFC-0003-Decentralized-Cloud-Security-Architecture-v0.2.md`
→ `0`. §14 lists exactly twelve threats; §15 lists eight invariants.

## Decisions this forced

| decision | why |
|---|---|
| The derivation lives in `@o2/core` and the browser **calls it** | `packages/browser` already depends on `@o2/core`. Criterion 3 then holds *structurally* — the browser cannot drift from the provider because there is one function — rather than by two spellings that happen to agree today |
| The spelling is the browser's: `visitor:` + the first 16 hex characters of `userKey` | ROADMAP criterion 3, and the reason is deployment: the shipped page already derives this and the provider is the side that has not moved yet. A different prefix refuses every live visitor on its first enrolment |
| `EnrollmentRequest.operatorId` stays **required on the wire** | The codec at `protocol.ts:355/:495` and the X.509 extension both carry it. Making it optional is a wire change this phase does not need: the field stops being an *input* without ceasing to be a *field* |
| The **parameter** is removed from every client-facing surface | `fabric-node.ts:451`, `browser-node.ts:576`, `tab-api.ts:970`, `capability-harness.ts:83`, `bin/agent.ts --operator-id`. A caller who cannot state it cannot be refused for stating it wrong, and the compiler enumerates the sweep |
| Refuse on mismatch, never overwrite | Design doc §A.2.i. A certificate says what the applicant asked for, or the applicant was told no |

## The trap this phase's own test must avoid

Criterion 7 plants a mutation reverting `enrollment.ts:1356` to `request.operatorId`. **If
criterion 2's test builds its requests through the client builder, that builder has already
derived the value, the mutation copies an already-correct string, the certificates come out
byte-identical and the plant stays green** — a blind instrument, which this repository counts
as worse than a missing case.

So criterion 2's test **hand-rolls its requests**: same `userKey`, one carrying the derived
name and one carrying an attacker-chosen name. Under the fix the second is refused; under the
mutation it is issued under the chosen name and the two certificates disagree. The expected
values are written as literals, never recomputed from the same call under test.

## Scope fence

- Issuance side only. No verifier-side derivation check — it is in no criterion.
- Phase 45 is untouched and stays owner-gated on `.planning/OWNER-ACTIONS.md` row 3c.
- `AttestationReceipt.issuers` is **additive and imposes no refusal**. A quorum that would be
  refused for single-issuer today is still composed; the dimension only becomes visible.
- No agent deploys, creates a Cloudflare resource, or cuts a release.
- The SUMMARY must not call this a Sybil fix. The ROADMAP says that sentence verbatim and the
  design document had to be corrected on exactly this point.
