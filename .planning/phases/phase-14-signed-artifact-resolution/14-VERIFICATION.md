---
phase: 14-signed-artifact-resolution
verified: 2026-07-31T23:29:20Z
status: passed
score: 3/3 must-haves verified
overrides_applied: 0
requirements:
  - id: DET-03
    status: satisfied
  - id: DATA-08
    status: satisfied
warnings:
  - "The phase's central guard has no entry in the project's standing mutation ledger (`packages/node/src/mutation-ledger.ts`, 31 entries). 14-CONTEXT.md called for mutation testing 'per the project's standing verification pattern'. The probes were run ad hoc during execution and re-run by this verification, but they are not re-run by `npm run test:mutations`. Mitigated, not closed, by `trust-anchors.node.test.ts:336-350`."
  - "ROADMAP marks this phase `Mode: mvp`, but the Phase 14 goal is declarative rather than a User Story ('As a …, I want to …, so that ….'). Verified against the three Success Criteria, which are well-formed and are the contract."
---

# Phase 14: Signed Artifact Resolution — Verification Report

**Phase Goal:** A production node resolves a task's module through a `key → CID` mapping signed by a trusted build authority — never a bare CID — on the live dispatch path
**Verified:** 2026-07-31T23:29:20Z
**Status:** passed
**Re-verification:** No — initial verification
**Host load at verification:** `16:21 up 7 days, load averages: 7.47 9.49 10.36` (8 cores). No criterion below rests on a timing measurement.

---

## Goal Achievement

| # | Criterion | Verdict |
|---|-----------|---------|
| 1 | Resolution goes through a signed `key → CID` mapping; a bare CID is refused, naming the missing signature | **MET** |
| 2 | A mapping signed outside the pinned anchors is refused at resolution time, before `WebAssembly.instantiate` | **MET** |
| 3 | `bin/agent.ts` against a real signed artifact resolves and executes end to end | **MET** |

**Score: 3/3**

---

## Criterion 1 — a bare CID is refused, and the refusal names what was missing

> *A production node resolving a task's module CID does so through a signed `key → CID` mapping; resolving a bare, unsigned CID directly is refused, with the refusal naming the missing signature.*

**Verdict: MET**

### The mechanism, located by grep rather than by summary

`packages/core/src/executor/module-provenance.ts:119-149` — `guardModuleProvenance(inner, provenance)` wraps an `Executor`. Its `execute` has exactly four exits (`:131`, `:136`, `:142`, `:146`) and only the last reaches `inner.execute`:

- `:131-133` — `task.moduleRecord === undefined` → `no-record` refusal.
- `:135-138` — `resolver.accept(record, now())` fails → `unresolvable`.
- `:142-144` — record genuine but `signed !== dispatched` → `cid-mismatch`.
- `:146` — `return inner.execute(task)`.

The refusal wording is `module-provenance.ts:85-96`. The `no-record` arm (`:88`) reads `no signed name record arrived for ${moduleCid} — a bare CID names bytes, not a publisher`, so the refusal names both the absent record and the CID it was absent for. The `switch` has no `default` arm, so a fourth variant is a compile error.

### It is on the production path, and cannot be omitted

| Site | Evidence |
|------|----------|
| Node tier composition | `packages/node/src/fabric-node.ts:670` — `new CountingExecutor(guardSovereignty(provenance(compute), sovereignty))` |
| Browser tier composition | `packages/browser/src/browser-node.ts:513` — `new CountingExecutor(guardSovereignty(provenance(worker), sovereignty))` |
| Not optional at the type level | `fabric-node.ts:183` and `browser-node.ts:125` both declare `readonly trustAnchors: readonly PublicKeyHex[] \| 'runs-unsigned-artifacts'` — **no `?`**. A node cannot be constructed without stating whose modules it will run. |
| Wire carriage | `packages/net/src/protocol.ts:352-354` encodes `moduleRecord` only when present; `:519-524` decodes and rejects a malformed one (`return null`) |
| Submit path | `packages/core/src/job/submit.ts:247` builds the record once and spreads it into both the sovereign and public task branches (`:257`, `:265`) |
| Port field | `packages/core/src/ports.ts:70` — `readonly moduleRecord?: NameRecord`, optional at the port so unrelated task literals keep compiling, enforced at the executor boundary |

**The escape hatch is real but never taken in production.** `'runs-unsigned-artifacts'` makes `provenance` the identity function (`fabric-node.ts:653-654`, `browser-node.ts:412-413`). I grepped every occurrence in the repository: **all 22 non-declaration uses are in `*.test.ts` files.** No production caller passes it. `packages/node/src/trust-anchors.node.test.ts:255-284` enforces that boundary and, at `:286-312`, proves its own checker can fail by planting the literal rather than assuming an empty result means health.

**`bin/agent.ts` has no off-switch at all.** `packages/node/src/bin/agent.ts:50-51` states the omission is deliberate; `:65` reads `values['trust-anchor'] ?? [KERNEL_TRUST_ANCHOR]`. `packages/node/src/bin/seed.ts:41` writes the identical expression, and `trust-anchors.node.test.ts:352-364` compares the two files textually so they cannot drift.

### Commands run

```
$ npx vitest run --project node packages/node/src/signed-artifact.node.test.ts --reporter=verbose
 ✓ refuses a bare CID, naming the missing record and the module it was missing for  420ms
 Test Files  1 passed (1)   Tests  5 passed (5)

$ npx vitest run --project node packages/node/src/trust-anchors.node.test.ts \
    packages/demo/src/kernel-build.node.test.ts packages/core/src/executor/module-provenance.test.ts
 Test Files  3 passed (3)   Tests  36 passed (36)
```

`signed-artifact.node.test.ts:341-342` asserts the refusal text contains `'signed name record'` **and** the dispatched CID — substrings taken from production wording, not a whole-sentence match.

---

## Criterion 2 — refused before instantiation, not merely reported as refused

> *A mapping signed by a key outside the node's pinned trust anchors is refused at resolution time, before `WebAssembly.instantiate` runs, rather than being accepted because the CID itself is well-formed.*

**Verdict: MET**

This is an ordering claim, so the question is whether an instrument exists that distinguishes *"a refusal was reported"* from *"the module never ran"* — and whether that instrument has ever been observed taking the positive value. Both instruments below have.

### Instrument A — the inner executor's call counter (in-process)

`packages/core/src/executor/module-provenance.test.ts:40-59` defines a counting fake whose `calls` increments on every `execute`. The counter is read in **every** case in the file:

| Line | Assertion | Case |
|------|-----------|------|
| `:100` | `calls === 0` | bare CID |
| `:122` | `calls === 0` | perfectly-signed record from an unpinned key |
| `:145` | `calls === 0` | record altered after signing |
| `:171` | `calls === 0` | genuine record vouching for a different artifact |
| `:194` | `calls === 0` | genuine record, expired |
| `:265` | `calls === 0` | reports which node refused |
| **`:227`** | **`calls === 1`** | **record verifies and names exactly the dispatched CID** |
| **`:249`** | **`calls === 1`** | **carries the inner executor nodeId** |

The counter is seen at **0 six times and at 1 twice**. It is a reading, not a silence.

Nothing in the file stubs the resolver — every record is produced by real `signName` and offered to a real `SignedNameResolver` (`:1-9`, `:88-91`), so the guard cannot be agreed with by a cooperative double.

### Instrument B — the agent's own blockstore directory (cross-process)

Stronger than A, because it is measured on the far side of a real process boundary and is *upstream* of instantiation: `WasmExecutor`/`WorkerExecutor` reach `blockstore.get(task.moduleCid)` **before** `WebAssembly.instantiate`, so a module block that never landed on the agent's disk was never instantiated.

`packages/node/src/signed-artifact.node.test.ts:227-230` — `blockNames(dir)` lists the agent's `FsBlockstore` directory, filtering `.tmp-` exactly as `fs-blockstore.ts:45` does.

| Line | Assertion | Meaning |
|------|-----------|---------|
| **`:305`** | **`toContain(moduleCid)`** | **the positive reading — a permitted module IS fetched and persisted** |
| `:347` | `not.toContain(moduleCid)` | bare CID: never fetched |
| `:383` | `not.toContain(moduleCid)` | unpinned key: never fetched |
| `:431-432` | `not.toContain` both CIDs | substitution: neither fetched |
| `:477` | `not.toContain(moduleCid)` | stock agent, unknown authority: never fetched |

Line 305 is what makes the four `not.toContain` readings meaningful. Its own comment names the role: *"The positive reading of the instrument every refusal below relies on."* The setup is deliberately hostile to a vacuous pass — the submitter holds the bytes and the socket is open (`:277-280`, `:391-396`), so the agent *could* have fetched them and did not.

### The ordering is structural, not incidental

`provenance` is the **innermost** wrapper at both composition sites (`fabric-node.ts:670`, `browser-node.ts:513`) — nothing sits between it and the executor that reaches instantiation. Sovereignty is deliberately checked outside it (`fabric-node.ts:647-650`).

### The unpinned-key case specifically

`signed-artifact.node.test.ts:350-384` dispatches a structurally perfect record — correct CID, unexpired, version 1, genuine Ed25519 signature that verifies against its own signer — whose only defect is who signed it. Assertions at `:380-381` require the reason to contain the impostor's public key **and** `'not a pinned trust anchor'`; `:383` requires the block was never fetched. This is exactly criterion 2's "rather than being accepted because the CID itself is well-formed".

The substitution case (`:386-433`) covers the attack a signature check alone misses: a record genuinely signed by the pinned key that vouches for a *different* artifact. `:427-428` requires **both** CIDs in the reason — a reason naming only one would mean the guard compared nothing.

### Browser tier

```
$ npx vitest run --project e2e packages/node/src/two-tabs.e2e.test.ts --reporter=verbose
 ✓ refuses a job whose record no tab pinned, and says so in words                                29ms
 ✓ refuses the demo's own genuine record, because these tabs asked for a different authority     33ms
 Test Files  1 passed (1)   Tests  6 passed (6)
```

`two-tabs.e2e.test.ts:367-396` dispatches the demo's own **genuine** committed `KERNEL_RECORD` at tabs pinned to a different authority and requires the refusal — proving anchors *replace* rather than join.

---

## Criterion 3 — `bin/agent.ts`, end to end, in a real process

> *Running `bin/agent.ts` against a real signed artifact resolves and executes it end to end, proving `signName`/`SignedNameResolver` sit on the production dispatch path rather than only in their own spec.*

**Verdict: MET**

An in-process test would not satisfy this, so I checked for real spawned-process coverage. It exists:

- `packages/node/src/signed-artifact.node.test.ts:1` — `import { spawn } from 'node:child_process'`
- `:87` — `const AGENT = fileURLToPath(new URL('./bin/agent.ts', import.meta.url))`
- `:138-142` — `spawn(process.execPath, [AGENT, '--dir', dir, ...extraArgs], …)` — a real OS process sharing nothing with the test but a socket
- `:144-166` — the parent waits for the child's one-line JSON handshake before dialling

The accepted case (`:261-306`) is a genuine end-to-end dispatch:

| Step | Evidence |
|------|----------|
| Only the submitter holds the module | `:280` — `submitter.store.put(MODULE_WRITES_PARTITION)`; the child must pull it over the wire |
| The record is really signed | `:286` → `recordFor(...)` → `:232-234` `signName(priv, …)` with a real Ed25519 key (`:89-96`) |
| It executed | `:295` `result.ok === true`; `:298` shard verification `'agreed'` |
| It executed **in the spawned process** | `:302` — `expect(shard.verification.agreeing).toEqual([agent.peerId])`. Its comment: *"Without this the whole file would be compatible with the job having quietly run in-process."* |
| The module really was resolved | `:305` — the module CID is present in the **agent's own** blockstore directory |

The binary's runtime configuration is read *out of the process*, not restated from source: `bin/agent.ts:89-91` prints `trustAnchors` on the handshake line, and the test asserts `toEqual` (never `toContain`, which would pass against a merged set) at `:272` for the flag case and `:444` for the stock no-flag case.

### Command and result

```
$ npx vitest run --project node packages/node/src/signed-artifact.node.test.ts --reporter=verbose
 ✓ runs a signed artifact end to end, and the agent it ran on pins exactly the flag it was given  608ms
 ✓ refuses a bare CID, naming the missing record and the module it was missing for                420ms
 ✓ refuses a record signed by a key it was not started with, naming that key                      436ms
 ✓ refuses a valid record that vouches for a different artifact, naming both CIDs                 474ms
 ✓ pins exactly the demo anchor when started with no flag, and refuses a record signed by anyone else  430ms
 Test Files  1 passed (1)   Tests  5 passed (5)   Duration 3.01s
```

Run twice (16:22:30 and 16:22:51), both 5/5.

### One nuance, stated rather than glossed

The artifact executed end to end through `bin/agent.ts` is `MODULE_WRITES_PARTITION` signed with a real Ed25519 key — a real module, really signed, really resolved in a real process. The demo's *committed* `KERNEL_RECORD` is executed end to end on the browser tier instead (`colouring-demo.e2e.test.ts`, shown load-bearing by Probe B below), while `bin/agent.ts`'s relationship to it is proven as the stock default anchor (`:435-478`). Both halves of criterion 3 are covered; they are covered by two files rather than one.

---

## Mutation Probes (re-run by this verification)

Both probes were planted, measured, and restored by `cp` from a scratch baseline in `/tmp/p14-baseline/`, verified with `cmp`. **No `git checkout`, `git restore`, `git stash`, `git reset` or `git clean` was used on any file** — this working tree is shared.

### Probe A — delete the `provenance(...)` wrapper from `fabric-node.ts`

`packages/node/src/fabric-node.ts:670`, `guardSovereignty(provenance(compute), sovereignty)` → `guardSovereignty(compute, sovereignty)`.

```
$ npx vitest run --project node packages/node/src/signed-artifact.node.test.ts --reporter=verbose
 Test Files  1 failed (1)
      Tests  4 failed | 1 passed (5)

AssertionError: expected 'agreed' to be 'insufficient'
 ❯ packages/node/src/signed-artifact.node.test.ts:419:40
 ❯ packages/node/src/signed-artifact.node.test.ts:470:40
```

**Red, and red in the right shape.** Every refusal became `agreed` — the unguarded node executed the bare CID, the impostor-signed record and the substituted artifact. A guard that merely reported without blocking would have failed differently.

Restored: `cp /tmp/p14-baseline/fabric-node.ts …` → `cmp` clean, `git status --short` empty.

### Probe B — empty the demo's trust anchors

`packages/browser/demo/main.ts:248`, `trustAnchors: options.trustAnchors ?? [KERNEL_TRUST_ANCHOR]` → `trustAnchors: []`.

```
$ npx vitest run --project e2e packages/node/src/colouring-demo.e2e.test.ts --reporter=verbose
 × DEMO-01 — runs every cube on two nodes and shows which two  1188ms
   → expected false to be true

AssertionError: expected false to be true
 ❯ packages/node/src/colouring-demo.e2e.test.ts:153:26
    153|     expect(run.complete).toBe(true)

 Test Files  1 failed (1)   Tests  1 failed | 5 passed (6)
```

**Red.** The claim that emptying the demo's anchors now breaks the visitor-facing demo — where before this phase it would have changed nothing — is confirmed. An empty anchor set means the resolver trusts nobody, so the demo's own kernel stops running. The five cases that still pass do not dispatch a job through the fabric (verification-only and bar-rendering), which is the expected blast radius.

Restored, then re-run to confirm the restoration is genuinely green:

```
$ npx vitest run --project e2e packages/node/src/colouring-demo.e2e.test.ts
 Test Files  1 passed (1)   Tests  6 passed (6)
```

`git status --short` empty across the whole tree after both restores.

---

## Typecheck

```
$ npx tsc --noEmit
tsc exit code: 0
(0 lines of output)
```

---

## Requirements Coverage

| Requirement | Description | Status | Evidence |
|-------------|-------------|--------|----------|
| DET-03 | Artifacts resolve only through a `key → CID` mapping signed by a trusted build authority, never by a bare CID | **SATISFIED** | `module-provenance.ts:119-149` composed at `fabric-node.ts:670` / `browser-node.ts:513`; `trustAnchors` required at `fabric-node.ts:183` / `browser-node.ts:125`; 5/5 spawned-process cases; Probes A and B both red |
| DATA-08 | Artifact `key → CID` mappings are signed by a trusted build authority and never resolved by CID alone | **SATISFIED** | `protocol.ts:352-354` / `:519-524` carriage; `submit.ts:247` threading; `module-provenance.ts:140-144` compares `record.cid` against `task.moduleCid`; `kernel-record.ts:46` committed anchor with its private half discarded (`sign-kernel.ts:24`, `:94`) |

Both ticked in `.planning/REQUIREMENTS.md` (lines 63 and 174), with the traceability rows (543, 563) moved off **Built, not wired** and the headline count corrected 33 → 35 — the `acceptance-traceability.node.test.ts` join requires all three to agree.

```
$ npx vitest run --project node packages/node/src/acceptance-traceability.node.test.ts
 Test Files  1 passed (1)   Tests  40 passed (40)
```

The spot-check at `:610-624` pins `DATA-05`, `MR-02`, `SCHED-06`, `DATA-10`, `WIRE-01` — none of which this edit touches.

---

## Anti-Patterns

Scanned all 49 non-`.planning` files changed between `50d0b96` (the commit before 14-01) and `HEAD`:

| Gate | Result |
|------|--------|
| `TBD` / `FIXME` / `XXX` (blocker) | **none** |
| `TODO` / `HACK` / `PLACEHOLDER` (warning) | **none** |

---

## Warnings (non-blocking)

### W-1 — the central guard is absent from the standing mutation ledger

`packages/node/src/mutation-ledger.ts` holds **31** entries driving `npm run test:mutations`. None references `guardModuleProvenance`, `module-provenance.ts`, `trustAnchors`, or the demo anchors — verified by grep for the mechanism and by `git log 50d0b96..HEAD -- packages/node/src/mutation-ledger.ts`, which is empty for this phase's commits.

14-CONTEXT.md ("Specific Ideas") asked for exactly this: *"Mutation-test the guard, per the project's standing verification pattern."* The probes were run — ad hoc during execution, and again by this verification — but they are not re-run on demand by the project's own harness, so this specific guarantee is not protected the way M1–M26 protect theirs.

**Why this is a warning and not a blocker:** `trust-anchors.node.test.ts:336-350` asserts that both production files still compose `guardModuleProvenance`, and `:463-478` holds a census of the three files that resolve a module CID which fails when a fourth appears. Combined with Probes A and B both going red, the wiring is genuinely defended today. What is missing is the *on-demand re-proof*, not the defence.

**Suggested closure (out of this phase's scope):** two ledger entries — delete `provenance(` from `fabric-node.ts:670` caught by `signed-artifact.node.test.ts`, and `[KERNEL_TRUST_ANCHOR]` → `[]` in `demo/main.ts:248` caught by `colouring-demo.e2e.test.ts`. Both mutations are proven catchable above, so the entries would be recording a measurement rather than a hope.

### W-2 — MVP mode with a non-User-Story goal

ROADMAP.md:402 marks this phase `Mode: mvp`, but the goal at `:401` is declarative rather than the `As a …, I want to …, so that ….` form MVP-mode verification expects. Verification proceeded against the three Success Criteria (`ROADMAP.md:406-409`), which are well-formed and are the contract. Recorded as an observation about roadmap consistency, not a defect in the delivered work.

---

## Deferred Items — not scored against this phase

The three entries in `deferred-items.md` were checked for bearing on a criterion; none has any:

| Item | Bearing on a criterion |
|------|------------------------|
| `churn.test.ts` wall-clock flake | None — builds no `moduleRecord`; load-sensitive |
| `transport-bounds.node.test.ts` retained-bytes bound | None — no path from this phase's files to libp2p stream retention |
| `acceptance-traceability` spot-check | Already fixed by `9e721e4`; 40/40 pass here |

---

## Gaps Summary

None. All three Success Criteria are met with runnable evidence located in production source by grep and confirmed by tests executed during this verification, not by SUMMARY.md claims.

The strongest single reading is that the two independent "did the module actually run" instruments — an in-process call counter and a cross-process blockstore-directory census — both exist, and **both have been observed taking their positive value as well as their negative one**. That is what turns criterion 2's ordering claim from an assertion into a measurement.

The one substantive shortfall is procedural (W-1): the guard is defended by tests but not registered in the project's own mutation harness, so the defence is not re-proved on demand.

**Score: 3/3**

---

_Verified: 2026-07-31T23:29:20Z_
_Verifier: Claude (gsd-verifier)_
