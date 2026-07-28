# Phase 13: Egress Manifest Completeness - Context

**Gathered:** 2026-07-27
**Status:** Ready for planning
**Mode:** Autonomous — decisions below resolved from the existing `EgressGuard` API and
the surrounding code's own structure. One real gap (production registration of guarded
payloads) is flagged, not resolved; see "Risks".

<domain>
## Phase Boundary

`EgressGuard` (`packages/net/src/egress.ts`) is a `Transport` decorator, built and
unit-verified in Phase 4, reused as a *test instrument* in Phase 12
(`packages/net/src/sovereign-execution.test.ts`). It decorates zero production
transports. Both node factories construct their `RpcEndpoint` over the raw,
un-decorated transport:

- `packages/node/src/fabric-node.ts:327` — `const rpc = new RpcEndpoint(transport, ...)`
- `packages/browser/src/browser-node.ts:197` — `const rpc = new RpcEndpoint(transport, ...)`

(The roadmap's own research note and `sovereign-execution.test.ts:499-500` cite
`fabric-node.ts:311` / `browser-node.ts:181` — those line numbers have drifted since that
comment was written; the construction is at 327 / 197 today. Re-grep before planning
starts, in case they drift again.)

**In scope:** DATA-05, DATA-06 — wrap both `RpcEndpoint` constructions so every
outbound frame is recorded by construction, and make the resulting manifest reachable
from outside a test.

**Out of scope:** registering *which* bytes are sovereign in production (see Risks —
this is a real gap, not a Phase 13 deliverable); a cross-process RPC for pulling one
node's manifest out of another live process (not needed — see `<specifics>`); the
reduce tree (Phase 16); quorum composition (Phase 19); discovery of node sets (Phase 18).
</domain>

<decisions>
## Implementation Decisions

### 1. A per-job manifest comes off the per-node guard by slicing `entries`, not by resetting

`EgressGuard` is constructed once, at node startup, and lives for the node's whole
process lifetime — it has to be, because it wraps the transport the node's `RpcEndpoint`
is built on, and that transport outlives any one job. A manifest is job-scoped. The gap
between the two is closed with the API that already exists, not a new one:

`EgressGuard.manifest` (`egress.ts:97-108`) returns a **fresh array** on every read
(`const entries = [...this.#entries]`). So a caller that holds a reference to the guard
can read `guard.manifest.entries.length` immediately before calling `submitJob`, call it,
read `guard.manifest.entries.length` again, and slice the delta:

```ts
const before = guard.manifest.entries.length
const result = await submitJob(spec, blockstore)
const jobEntries = guard.manifest.entries.slice(before)
```

`violations` for the job is `jobEntries.map(e => e.violation).filter(...)`; `totalBytes`
is the sum over `jobEntries`. **Do not use `EgressGuard.reset()` for this** — reset
discards history, which is wrong the moment two jobs run back-to-back and a caller wants
to inspect the first job's manifest after the second has started. Slicing is
non-destructive and composes with concurrent reads.

This means `EgressGuard` needs no new method. It does need to be **reachable** from
outside the node factory — see decision 2's structural corollary below.

### 2. `JobResult` gains no manifest field; the manifest is attached where `@o2/net` is already in scope

`submitJob`/`JobResult` live in `@o2/core` (`packages/core/src/job/submit.ts`).
`purity.node.test.ts`'s `'has no dependency edge from @o2/core to any adapter package'`
test asserts `packages/core/package.json` has **zero** `@o2/*` dependencies — not just no
`@o2/net` import scan, the whole family is barred structurally. `JobResult` cannot carry
an `EgressManifest`-typed field (that type is defined in `@o2/net`) without breaking that
test.

So the manifest is not part of `JobResult`. It is sibling metadata, computed and attached
at whichever call site already imports both `submitJob` (`@o2/core`) and `EgressGuard`
(`@o2/net`) — that is every real caller of `submitJob` today: `packages/node/src/bin/
bench.ts:226`, `packages/browser/demo/main.ts:307` and `:541`, and any Phase-13 test
harness. `@o2/net` is already permitted to import from `@o2/core` (`egress.ts:27` does
this today: `import type { Transport } from '@o2/core'`) so the reverse direction is fine
— a thin helper (e.g. `submitJobWithEgress(spec, blockstore, guard)` returning `{job,
egress}`) could live in `@o2/net` if the planner wants one shared implementation instead
of repeating the before/after slice at each call site. Either placement satisfies the
constraint; which one is planner's discretion.

**Structural corollary — the node classes need a new field, not a type change.**
`FabricNode.transport`/`BrowserNode.transport` are typed as the concrete `Libp2pTransport`
class (`packages/libp2p/src/libp2p-transport.ts:76`), not the `Transport` port, because
callers rely on members `Transport` does not declare: `.stop()` (`fabric-node.ts:485`,
`browser-node.ts:290`) and `.peers` used directly by `RpcBlockSource`'s thunk
(`fabric-node.ts:334`, `browser-node.ts:201`) and by `packages/browser/demo/main.ts`
(five call sites reading `n.transport.peers`/`.webrtcAddrs`/`.circuitAddrs`).
`EgressGuard implements Transport` — it has no `.stop()`. Swapping `this.transport`'s
type to `EgressGuard` would break every one of those call sites.

**So: keep `transport: Libp2pTransport` exactly as it is, and add a second field** —
`readonly egress: EgressGuard` is the natural name — constructed by wrapping `transport`
and handed to `RpcEndpoint` in its place:

```ts
const guard = new EgressGuard(transport, sovereignty.ownerId)
const rpc = new RpcEndpoint(guard, ...)
```

`transport.peers`/`.stop()` keep working unchanged (`RpcBlockSource`'s thunk and both
`.stop()` methods keep reading/calling the unwrapped `transport`, not `rpc`'s transport);
`rpc`'s actual sends now go through `guard`, so every RPC frame is recorded; and
`node.egress.manifest` is the new, previously-nonexistent read surface criterion 2 needs.

One more wrinkle this forces: the `ownerId` argument to `new EgressGuard(...)` should be
the *same* resolved owner id that feeds `guardSovereignty` a few lines later — currently
`options.sovereignty ?? { ownerId: '', canExecuteSovereign: false }` is inlined at the
`guardSovereignty` call site (`fabric-node.ts:345-348`, `browser-node.ts:229-231`), which
is *after* `transport`/`rpc` are constructed (`:326-330`, `:196-197`). That default
resolution has to be hoisted above the transport/`RpcEndpoint` construction in both files
so one resolved `sovereignty` local feeds both the guard and `guardSovereignty` — not two
independently-defaulted copies that could drift.

### 3. The empty-manifest trap must be guarded explicitly in Phase 13's own tests

Phase 12 already established the pattern this phase must repeat, not merely reference:
`sovereign-execution.test.ts:339` and `:503` both assert `manifest.entries.length
toBeGreaterThan(0)` *alongside* `manifest.violations.toEqual([])`. A manifest with zero
entries reports zero violations trivially — that is indistinguishable from "the guard was
never wired" without the entries-length assertion. Phase 13's production-wiring proof
(wherever it lives — `fabric-node.node.test.ts`-style same-process multi-node test, or a
new file) must assert the delta-sliced `jobEntries.length > 0` for every criterion-1/2/3
test, not just `violations == []`. A clean manifest and an absent one must never look
alike in Phase 13's own passing test output.
</decisions>

<code_context>
## Existing Code Insights

### `EgressGuard` itself — `packages/net/src/egress.ts`
- Wraps a `Transport` (`@o2/core` port); implements `Transport` itself, so it drops
  into anything that constructs an `RpcEndpoint`.
- `guard(label, payload)` (`:72-74`) registers a byte pattern as sovereign. **Nothing in
  production calls this today** — the only call sites in the whole repo are inside
  `sovereign-execution.test.ts` (`:152`, standing in for "the owner declared this payload
  sovereign"). See Risks.
- `send()` (`:76-86`) scans **before** sending — a frame that fails mid-flight is still
  counted, by design ("recording after a successful send would miss exactly the frames
  that failed mid-flight, which are still frames that left").
- `manifest` getter (`:97-108`) returns a fresh `{nodeId, ownerId, entries, totalBytes,
  violations}` object every call — the property decision 1 relies on.
- `reset()` (`:111-113`) exists ("discard the record, e.g. between jobs") but decision 1
  above recommends the slice approach over it, for concurrency safety.

### The two call sites — exact current state
- `packages/node/src/fabric-node.ts:326-330` builds `transport` then `rpc` over it
  raw; `guardSovereignty(...)` wrapping the executor happens later, at `:345-348`, with
  its own inlined `options.sovereignty ?? {ownerId: '', canExecuteSovereign: false}`
  default.
- `packages/browser/src/browser-node.ts:196-200` — identical shape; `guardSovereignty`
  at `:228-234` with the identical inlined default.
- Both files' class bodies declare `readonly transport: Libp2pTransport` (`fabric-node.ts
  :213`, `browser-node.ts:93`) and both `.stop()` methods call `this.transport.stop()`
  (`fabric-node.ts:485`, `browser-node.ts:290`) — the reason decision 2 adds a field
  rather than changing `transport`'s type.

### The prepared seam — `packages/net/src/sovereign-execution.test.ts`
- `ownerFabric()` (`:97-239`) is a hand-built fabric, not `FabricNode`/`BrowserNode` —
  it constructs `EgressGuard` itself per owned node (`:151-152`) over a `MemoryNetwork`
  transport, exactly the shape Phase 13 needs to reproduce inside the real node
  factories.
- The "criterion 3" test (`:462-507`) submits a sovereign shard through the real
  `submitJob` (not hand-called `executeVerified`) and asserts pushdown by comparing
  encoded-output size to encoded-input size, **plus** reads `owned.guard.manifest`
  directly because the test holds the `OwnerNode` object in-process. Its own comment
  (`:498-501`) names this exact wiring gap as Phase 13's job.
- The falsification test (`:348-370`) proves the detector fires: a module that echoes
  its input (`MODULE_ECHOES_INPUT`) makes `manifest.violations` contain the registered
  label. This is the pattern any Phase 13 criterion-1 test should reuse, pointed at real
  `FabricNode`/`BrowserNode` instances instead of the hand-built fabric.

### `submit.ts` — `JobResult` shape (`packages/core/src/job/submit.ts:70-98`)
`{moduleCid, shards, complete, grossFuel, usefulFuel, verificationMultiplier}` — no
manifest field, and per decision 2, none should be added here.

### `purity.node.test.ts` — the boundary that makes decision 2 non-optional
`packages/node/src/purity.node.test.ts`'s `'has no dependency edge from @o2/core to any
adapter package'` test (`:~186-196`) reads `packages/core/package.json`'s `dependencies`
and asserts no key starts with `@o2/`. This is the actual enforcement mechanism —
stronger than an import-specifier scan, since it also blocks a type-only import via
`package.json` peer/dev listings if a build tool ever needed one declared there.

### `sovereignty-guard.ts` — `NodeSovereignty`
`packages/core/src/executor/sovereignty-guard.ts:34-39`: `{ownerId: OwnerId,
canExecuteSovereign: boolean}` — this is the shape both node factories already default
to `{ownerId: '', canExecuteSovereign: false}`, and the shape decision 2's hoisted local
should reuse for both the guard and `guardSovereignty`.
</code_context>

<specifics>
## Specific Ideas

**Same-process multi-node tests are sufficient evidence, by this repo's own precedent.**
`fabric-node.node.test.ts:230` says outright: "`startNode` is the same factory call
`bin/agent.ts` makes — no test-only path." Two `FabricNode.start()` calls inside one
Vitest process, talking over real TCP sockets, are treated elsewhere in this repo as
equivalent to "started via `bin/agent.ts`" for verification purposes (Phase 12's
`sovereignty-placement.node.test.ts` genuinely spawns a child process, but
`fabric-node.node.test.ts`'s DATA-09 test does not, and both are accepted evidence). A
Phase 13 test does not need a true separate-OS-process harness to satisfy criterion 1 or
2 — it needs two real `FabricNode` (or one `FabricNode` + one `BrowserNode`) instances in
one process, each exposing `.egress`, talking over the real transport.

**No cross-process manifest-retrieval RPC is needed for this phase's criteria.** Criterion
2 says "retrievable from the job's own result metadata after completion" — satisfied by
the sibling-attachment pattern in decision 2, read from the same process that called
`submitJob`. Nothing in Phase 13's three criteria requires fetching a *different*, still-
running remote node's manifest over the wire. If a later phase needs that (an operator
UI showing another peer's egress, say), it needs a new protocol message — flag it then,
do not build it now.
</specifics>

<deferred>
## Deferred Ideas

- **Production registration of guarded payloads** — nobody calls `EgressGuard.guard()`
  outside a test today, and Phase 13 does not have to fix that (see Risks — it is flagged,
  not silently deferred without comment).
- **A cross-process "give me your manifest" RPC** — not needed for Phase 13's criteria;
  see `<specifics>`.
- **Naming a degraded/owner-attested result distinctly in the manifest** — VER-08/09/10,
  Phase 19, per 12-CONTEXT.md's own deferral. Phase 13 does not change how a receipt's
  strength is labelled, only what the manifest reports.
</deferred>

## Risks — flagged, not resolved

**1. Nothing in production ever calls `EgressGuard.guard()`.** The detector half of
DATA-05 ("fails if raw sovereign bytes cross") only fires for byte patterns someone
registered. Today that registration happens exactly once anywhere in the repo, inside
`sovereign-execution.test.ts:152`, standing in for an act — "the owner declares this
payload sovereign" — that no production code path performs. Wiring the transport
decorator (this phase's stated scope) makes `entries`/`totalBytes` real by construction
regardless; it does **not** by itself make `violations` catch anything in a real
deployment, only in a test that calls `.guard()` on the newly-exposed `node.egress`
field before dispatch — exactly like `sovereign-execution.test.ts` already does. That is
sufficient to satisfy criterion 1 as a *test*, which is what the criterion actually asks
for ("a stream tap... fails a running job"), but the planner should decide explicitly
whether "production registration of sovereign payloads" is a real, separate gap worth
naming in the phase's own follow-up notes, or genuinely out of scope until a future phase
gives a node a reason to know which of its own blocks are sovereign at rest.

**2. Concurrent jobs on one node make the before/after slice in decision 1 attribution-
unsound.** If two jobs run concurrently through the same node's `submitJob` call (or two
different callers share one `FabricNode`), their `entries.length` windows can overlap —
a byte-count taken as "job B's manifest" could include frames sent by job A while both
were in flight. Nothing in the current job model prevents this, and no test in the repo
exercises concurrent `submitJob` calls against one guard. Acceptable for this phase if
scoped explicitly (documented as "manifest attribution assumes one job in flight per
node at a time"), but the planner should say so rather than let it be discovered later.

**3. The roadmap's "Research: None ... the change is two call sites" undersells the
actual diff.** Both decisions above show the real change touches: a new field
(`egress`) on both node classes, a hoisted sovereignty-default resolution above the
transport/RPC construction in both files, and a manifest-attachment convention at every
`submitJob` call site outside `@o2/core`. None of it is algorithmically novel — consistent
with "Research: None" — but "two call sites" is optimistic about the diff's shape, and
the planner should size the work against this context file, not the roadmap line alone.
