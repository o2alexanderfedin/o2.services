# Phase 14: Signed Artifact Resolution - Context

**Gathered:** 2026-07-27
**Status:** Ready for planning
**Mode:** Autonomous — decisions below resolved from recorded project principles, the
existing `naming.ts` API, and the Phase 12 precedent for how an optional `Task` field is
made non-optional in effect. One asymmetry with Phase 12 is flagged rather than silently
folded into a decision; see "Risks".

<domain>
## Phase Boundary

`signName`/`SignedNameResolver` (`packages/core/src/naming.ts`) are complete and
unit-verified from Phase 4 and have no production caller. Every module today resolves
by bare CID at `packages/core/src/executor/wasm.ts:62`
(`this.#blockstore.get(task.moduleCid)`), inside `WasmExecutor.execute`. This phase
routes production resolution through a signed `key → CID` mapping before that line runs.

**In scope:** DET-03, DATA-08 — a production node refuses to instantiate a module whose
CID did not arrive with a valid signed record; the refusal names the missing/invalid
signature; `bin/agent.ts` executes a real signed artifact end to end.

**Out of scope:** AUTH-03 capability chains (Phase 15 — a chain proves the *caller* may
ask; this phase proves the *module* is the one the build authority meant to ship — they
compose, they do not substitute). Discovery of trust anchors at runtime (never in
scope — `SignedNameResolver` has no method to learn one; anchors are supplied once, at
construction, full stop). AOT translation identity (Phase 21 — see "Specifics" below,
this is the one place getting it wrong couples two phases).
</domain>

<decisions>
## Implementation Decisions

### 1. Who signs, and how a node learns the anchor

**Production:** the project has exactly one build authority by construction — CLAUDE.md
records sole authorship, no external contributions accepted. The signing key is an
Ed25519 keypair held outside the repository (never committed); its public half is the
one trust anchor a production node is configured with. Concretely, this mirrors the
existing `FabricNodeOptions.sovereignty?: NodeSovereignty` shape at
`packages/node/src/fabric-node.ts:107-118` (optional, defaults to the safe value): add
`trustAnchors?: readonly PublicKeyHex[]` (from `capability.ts`, already imported by
`naming.ts`), default `[]`. An empty anchor set means the resolver trusts nobody and
therefore refuses every signed record — the safe default, and consistent with "resolving
a bare CID is refused" being the base case rather than an opt-in. Thread it into
`bin/agent.ts` as a new CLI flag alongside the existing `--owner-id` (see
`packages/node/src/bin/agent.ts:24-35`), e.g. `--trust-anchor <hex>` (repeatable). This is
per-node *configuration*, not per-node *capability* — every agent process remains
identical; a node simply may or may not have been told which key to trust, exactly as
`--owner-id` states clearance rather than defining a class of node.

**Tests:** follow `naming.test.ts`'s existing pattern exactly — an ephemeral fixture
keypair (`keypair(seed)`, `packages/core/src/naming.test.ts:15-18`), `signName` over a
fixture module CID, the public half passed as the sole trust anchor when constructing the
resolver under test. No new pattern needed here; only wiring.

### 2. Blast radius — every site that submits a job with a `moduleCid`

`WasmExecutor` itself (`packages/core/src/executor/wasm.ts`) does **not** change — same
reasoning as `guardSovereignty`'s "the `Executor` port does not change" precedent
(`packages/core/src/executor/sovereignty-guard.ts:10-14`). It stays a low-level primitive
that resolves whatever CID it is given. A new adapter wraps it — call it
`resolveSignedModule` or similar — refusing before `inner.execute` runs, the same shape
as `guardSovereignty`.

Where that wrap must land, concretely:
- **`packages/node/src/fabric-node.ts:345-347`** — the production serving executor.
  Currently `guardSovereignty(new WasmExecutor(...), ...)`. Compose the new guard here too.
- **`packages/browser/src/browser-node.ts:228-230`** — same composition, browser tier.
- **`packages/core/src/executor/task-worker.ts:38-42`** (DET-07 Worker loopback) —
  raw `WasmExecutor`, no `guardSovereignty` either today. Out of scope by the same logic
  Phase 12 used for `runResilient`/bench harness primitives: this is a single-process
  loopback slice proving the kernel runs in a Worker, not "the live dispatch path".
- **`packages/node/src/bin/bench.ts:117,187,298`** — all three fabric builders construct
  raw `WasmExecutor`s directly and use a bare fixture CID
  (`MODULE_WRITES_PARTITION`, `packages/core/src/executor/fixtures.ts`) with no signature
  anywhere. Precedent (Phase 12) is that the benchmark harness measures a different thing
  and is allowed to stay on the unguarded primitive — **but flag this to the planner
  explicitly**, don't silently carry it forward; if bench.ts's executors go through
  `serveAgent`/`RemoteExecutor` (they do, in `memoryFabric`/`realFabric`), the guard could
  be added cheaply with a fixture-signed record, which would be the more honest
  benchmark. Claude's discretion.
- **`packages/browser/demo/main.ts:301` (`runColouring`)** — the actual visitor-facing
  demo path. `kernelBytes` (`packages/demo/src/kernel.ts`) is static, bundle-embedded WASM
  with no signature today. **This one cannot be waved through as dev-only** — see Risk 1.
- **`packages/browser/demo/main.ts:543` (`runJob`)** — takes an arbitrary
  `CID.parse(options.moduleCid)` from the caller. Confirmed test/E2E-harness-only: it
  backs `packages/browser/src/tab-api.ts`'s `TabApi.runJob`, driven by Playwright, never
  by a real visitor. Development-only surface; fine to leave resolving a bare CID, since
  nothing reaches it except the test harness that dials it directly — same status as
  `MemoryNetwork`/`@libp2p/memory` fabrics elsewhere in the project.
- **`packages/core/src/executor/task-worker.ts`** — see above, out of scope.

### 3. Compile-time or runtime — runtime, at two enforced boundaries, not a Phase-11-style hook

This is per-dispatch *data* (which module, signed by whom), not a fixed
node-construction-time *hook* — Phase 11's mechanism (`AgentOptions`'s six required named
arguments) doesn't fit; there's no finite set of call sites to make exhaustive at compile
time, the way there was for `serveAgent(...)`.

Instead, follow the precedent `12-VERIFICATION.md` (Criterion 2, lines 215-270)
established for `Task.label`: the port-level field stays **optional** on `Task`
(`packages/core/src/ports.ts:25-46`) — call it `moduleRecord?: NameRecord` — so the ~65+
raw `Task` literals in unrelated tests keep compiling. But it is enforced **non-optional
in effect** at both production construction boundaries, exactly where `Task.label` was:
1. **In-process**: `packages/core/src/job/submit.ts` — wherever it builds a `Task`
   (currently :220-236), require a `NameRecord` for `spec.moduleCid` before dispatch,
   the same way `requestFor` already refuses a broken sovereign shard.
2. **At the wire**: `packages/net/src/protocol.ts` — `parseRequest`'s `exec` branch
   already carries a second optional field alongside `task` for exactly this shape
   (`capability?: readonly Delegation[]`, decoded at :422-433, encoded at :304-305). A
   `moduleRecord` field follows the identical plumbing pattern — this is not a new kind of
   wire extension, it's the second instance of one that already exists once.
3. **The refusal itself** happens in the new Executor adapter (decision 2), which is what
   makes "before `WebAssembly.instantiate` runs" true — `serveAgent`
   (`packages/net/src/agent.ts:184-195`) calls `executor.execute(request.task)` only after
   `authorize` passes; the signed-module guard sits inside that `executor`, same position
   as `guardSovereignty`.

**A `NameRecord`'s `cid` must be checked against `task.moduleCid`, not substituted for
it.** `SignedNameResolver.accept`/`.resolve` return whatever CID the record claims;
nothing stops a hostile dispatcher from attaching a *valid* record for some other,
unrelated name while still pointing `task.moduleCid` at a different bare CID. The new
adapter must verify `record.cid.toString() === task.moduleCid.toString()` in addition to
the record verifying against a pinned anchor — otherwise a legitimately-signed record for
"wordcount" would rubber-stamp execution of an arbitrary unrelated module. This is not
optional; it is the entire point of the check. Flag to the planner: `naming.ts`'s
`ResolveFailure` union has no variant for this mismatch case today — either add one there
(then every switch over `ResolveFailure` becomes non-exhaustive until updated, which is
the intended "loud" failure mode per `describeKeyFailure`'s own comment in
`cache-key.ts:99-102`) or represent it as a distinct failure local to the new adapter.
Claude's discretion; state the choice explicitly in the plan.
</decisions>

<code_context>
## Existing Code Insights

### The mechanism that exists and is unreached
`packages/core/src/naming.ts`:
- `NameRecord {name, cid, version, expiresAt, signer, signature}` — a signed assertion.
- `signName(privateKey, fields)` — pure, synchronous-shaped (returns, doesn't await).
- `SignedNameResolver` — construction-time `trustAnchors: Iterable<PublicKeyHex>`, no
  method to add one afterward (asserted by a test:
  `expect('addTrustAnchor' in resolver).toBe(false)`). `.accept(record, now)` verifies
  signature + anchor + expiry + monotonic version, and **also stores** the record (so
  later `.resolve(name, now)` needs no record supplied again — but nothing stops a
  dispatch-time `.accept()` call on every request too, which composes fine with the
  monotonic-version rollback protection). `.resolve(name, now)` looks up only what was
  previously accepted.
- Both exported from the `@o2/core` barrel (`packages/core/src/index.ts:199-203`).

### The bare-CID resolution point on the live dispatch path
`packages/core/src/executor/wasm.ts:62-65` — `WasmExecutor.execute`:
```ts
const moduleBytes = await this.#blockstore.get(task.moduleCid)
if (moduleBytes === undefined) {
  return { ok: false, reason: `module block missing: ${task.moduleCid.toString()}` }
}
```
This is the *only* place a CID becomes a module's bytes on the whole dispatch path — every
other file that mentions `moduleCid` (`checkpoint.ts`, `verify.ts`, `task-worker.ts`,
`wasi-executor.ts`, `worker-executor.ts`, `protocol.ts`) receives or forwards a `Task`,
none of them independently resolve one.

### The adapter pattern to copy
`packages/core/src/executor/sovereignty-guard.ts` — `guardSovereignty(inner, node)`
wraps an `Executor`, checks `task.label === 'sovereign'` before calling `inner.execute`,
refuses with a named reason otherwise. Composed at:
- `packages/node/src/fabric-node.ts:345-347`
- `packages/browser/src/browser-node.ts:228-230`

Both compose it with `WasmExecutor` at construction; a new signed-module guard composes
the same way, at the same two sites.

### The wire boundary already has the second-field slot
`packages/net/src/protocol.ts:56-60` — the `exec` request variant:
```ts
| {
    readonly kind: 'exec'
    readonly task: Task
    readonly capability?: readonly Delegation[]
  }
```
`capability` is AUTH-03/Phase 15's field, plumbed but not yet populated by any production
`RemoteExecutor` call (confirmed: Phase 15 is still TBD). A `moduleRecord?: NameRecord`
field follows the identical shape — optional, encoded only if present
(`packages/net/src/protocol.ts:304-305` pattern), decoded and validated in `parseRequest`.

### Where production modules currently come from, per entry point
- `packages/node/src/bin/agent.ts` — **serves only**; never calls `submitJob` itself.
  It is the target of dispatch, not a submitter. Its role in this phase is the
  `--trust-anchor` flag and constructing its guarded executor with a resolver.
- `packages/node/src/bin/seed.ts` — same: serves, relays; no `submitJob` call.
- `packages/node/src/bin/bench.ts` — submits, using the raw `WasmExecutor` fabrics
  described in Decision 2. Fixture module, no signature today.
- `packages/browser/demo/main.ts` — submits, using `kernelBytes`
  (`packages/demo/src/kernel.ts:23`), generated at build time by
  `packages/demo/scripts/build-kernel.mjs` into `packages/demo/src/kernel-bytes.ts`. This
  script is the natural place to add a `signName` step producing a companion
  `NameRecord` (e.g. `kernel-record.ts`) — implementation detail for the plan, not
  decided here.

### AOT — a different concept, composing in one direction
`packages/aot/src/cache-key.ts`'s `translationCid`/`TranslationKey`/`TranslationRecord`
answer "is this the same *translation* (input + toolchain + target + features)" — a
build-time reproducibility identity, computed and compared, **never signed**, no trust
anchor anywhere in that file. `TranslationRecord.artifactCid` is the CID of the translated
`.wasm` bytes themselves — a plain content-integrity CID like any other module's.

Phase 14's signing is a different, later step that any artifact CID passes through
regardless of origin: once Phase 21 (AOT-02/AOT-04, still TBD) produces an
`artifactCid`, that CID becomes eligible to be the `cid` in a `NameRecord` the build
authority signs — exactly the same signing/resolution path a source-compiled `.wasm`
goes through. **They are not the same concept and do not merge**: `translationCid` names
a build recipe for cache/reproducibility purposes; `signName` asserts provenance for
execution purposes. Getting this right means Phase 14 builds artifact-type-agnostic
signing (keyed on nothing but a CID), and Phase 21 must not invent a second, competing
notion of "trusted artifact" — it only needs to produce a CID and hand it to whatever
signs things, which is unchanged by this phase.
</code_context>

<specifics>
## Specific Ideas

**Mutation-test the guard, per the project's standing verification pattern.** Add the
forbidden branch — accept a record whose `cid` doesn't match `task.moduleCid`, or skip
the anchor check — and confirm a test fails. Phase 4 and Phase 12 both proved their
central guarantee this way; Phase 14's criterion 2 ("refused... before
`WebAssembly.instantiate` runs, rather than accepted because the CID itself is
well-formed") is exactly the kind of claim that must be falsified before it's believed.

**Criterion 3's "real signed artifact... end to end" almost certainly needs a
`bin/agent.ts`-process test**, mirroring Plan 12-03
(`.planning/phases/phase-12-sovereignty-pinned-placement/12-03-PLAN.md`): spawn a real
agent process, dispatch a task carrying a genuinely signed `NameRecord` via
`RemoteExecutor` over real RPC, confirm it executes; spawn a second scenario with an
unsigned or wrongly-signed record and confirm the named refusal.

**The refusal reason should name what's missing**, per the project's "every exclusion is
named" convention (Phase 6) and matching `describeResolveFailure`'s existing five
messages (`packages/core/src/naming.ts:69-82`) — those read naturally as the refusal text
already; the adapter mostly needs to surface `result.reason` (or the new mismatch
message) into `ExecutionOutcome.reason`.
</specifics>

<deferred>
## Deferred Ideas

- **Capability chains (AUTH-03)** — Phase 15. A signed module record proves the module;
  a capability chain proves the caller. Do not conflate them into one check.
- **AOT translation signing** — Phase 21. `translationCid` stays unsigned; only its
  *output* CID ever enters this phase's mapping, and only once Phase 21 wires the lift
  pipeline to call it.
- **Discovery of who the build authority even is, for a peer with no static config** —
  never in scope for any phase; `SignedNameResolver` is permanently construction-pinned
  by design (STATE.md: "the resolver has no method to learn a new anchor").
- **Signing the benchmark's fixture module** — Claude's discretion in Decision 2; not
  required by any ROADMAP criterion, but flagged as more honest than leaving it bare.
</deferred>

<risks>
## Risks — flagged, not resolved

**1. DET-03 is not sovereignty-shaped — it has no "public path is exempt" clause, and
that's a real problem for the demo.** `guardSovereignty` is a no-op for `label: 'public'`
tasks, so Phase 12's blast radius was limited to sovereign shards. DET-03's ROADMAP
criterion 1 says a production node resolving *a task's module CID* — no label
qualifier — must do so through a signed mapping. Read literally, this means
`packages/browser/demo/main.ts`'s `runColouring` (the actual public-facing demo, Phase 9
criterion 1's "real job someone cares about") is squarely in scope, not exempt as
dev-only. That means `packages/demo/scripts/build-kernel.mjs` needs a real signing step
before this phase can call itself done without quietly carrying an unsigned public path
forward — which is exactly the kind of gap the v1.0 audit exists to catch. Suggested
resolution for the planner: generate and commit a demo-scoped `NameRecord` for
`kernelBytes` at build time (a demo signing key held the same way the eventual
build-authority key is — outside git, or accepted as a documented, lower-stakes exception
if a demo key is committed for the browser tier only). Say explicitly which, don't leave
it implicit.

**2. The `record.cid` vs. `task.moduleCid` mismatch check (Decision 3) has no home in
today's types.** `ResolveFailure` is exhaustively switched in `describeResolveFailure`;
adding a mismatch variant there is the "loud by construction" choice this project
consistently prefers, but it means every existing exhaustive switch over `ResolveFailure`
needs a new arm — check `naming.test.ts` and any other consumer for one before assuming
this is a two-line change.

**3. `bin/agent.ts` gains a fourth per-node configuration flag** (`--owner-id`,
`--can-execute-sovereign`, now `--trust-anchor`). Not a problem on its own, but the
planner should check whether a combined flags-object refactor is now worth it rather
than three more `parseArgs` entries accreting independently — Claude's discretion, not a
blocker.
</risks>
