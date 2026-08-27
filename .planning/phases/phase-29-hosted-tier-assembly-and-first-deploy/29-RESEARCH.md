# Phase 29: Hosted Tier Assembly & First Deploy (Remainder) — Research

**Researched:** 2026-08-27
**Domain:** Cloudflare Durable Object hosted libp2p tier — inbound WebSocket listener, deploy
configuration, owner-executed billing/dial verification
**Confidence:** HIGH on "what exists in the tree and passes" (all MEASURED); LOW-to-MEDIUM on
"what CONTEXT.md says remains" (the central finding below is that this framing is stale)

---

**Before reading the constraints below, read "THE FINDING THAT CHANGES THE PLAN" immediately after this section.** The constraints were captured in `29-CONTEXT.md` against a tree state this research shows was already stale at capture time — the vendoring decision below should not be treated as settled until that finding is reconciled with the owner.

---

<user_constraints>

## User Constraints (from CONTEXT.md)

### Locked Decisions
- **Copy `websocket-to-conn.ts` into this repository and refactor the copy** — the owner's
  2026-08-27 instruction. **Flagged above**: this instruction appears to have been given without
  visibility into `websocket-connection.ts`/`hibernatable-socket.ts`, which already exist, are
  tested, and solve the same requirements a different way. Reconcile before executing literally.
- One deploy, not two — `workers_dev` subdomain is an account property; libp2p appends
  `/p2p/<peerId>` itself. **Already reflected in `wrangler.jsonc`** (`workers_dev: true`,
  `preview_urls: false`).
- Autonomous execution stops at the Cloudflare boundary. Criteria 1 and 2 are owner acts, plan
  tasks for them are runbook items, never agent tasks.
- Agent-side work is `wrangler deploy --dry-run --outdir=<scratch>` with
  `WRANGLER_SEND_METRICS=false` only. Never `--remote`, never a real deploy, never touch
  `ocr-checks-worker*`.
- Ordering is the whole control for criterion 1: billing alert timestamp must precede the first
  deploy's timestamp.

### Claude's Discretion
- The adapter's internal shape (already resolved in the tree as a hand-written class — see
  finding above).
- How the two-dial evidence is recorded.
- Test file placement/naming.
- Whether the adapter lives in `packages/cloudflare/src/` or `packages/libp2p/src/` — **already
  resolved in the tree**: `packages/cloudflare/src/`. See Q2 below for the reasoning that
  applies whichever way the vendoring question is reconciled.

### Deferred Ideas (OUT OF SCOPE for this plan)
- To Phase 30: `remoteAddr` correctness at >5 clients/sec scale (code exists; the **scale
  test** itself needs a real deployed node and is Phase 30's criterion 1, not Phase 29's), the
  yamux 30s-keepalive-prevents-hibernation open decision (named, not taken, in
  `hibernatable-socket.ts`), whether workerd accepts close code 1012, whether `binaryType` may
  be assigned on a hibernatable socket.
- To Phase 31: every DHT record; the datastore refuses record-shaped keys until then (already
  guarded — do not re-plan).
- Not closed by this phase: `NET-03`'s AutoTLS route.
</user_constraints>

---

## THE FINDING THAT CHANGES THE PLAN — read this before anything else below

**The "minimal inbound listener" that `29-CONTEXT.md` describes as work this plan must still
deliver is already written, wired, tested, and merged to this branch — and it was merged
*before* `29-CONTEXT.md` was captured, not after.**

This is the same failure shape `29-REPORT.md` finding 1 already burned two hours on and named
explicitly: a conclusion reached without reading what the tree already contains. It reproduced
one level up — this time in the hand-off between sessions rather than inside one session — and
the owner's own standing instruction (*"look in the code, we ran a series of experiments before
deciding"*) applies here just as directly.

### The evidence, in order

1. **The commits exist, on this exact branch, hours before `29-CONTEXT.md` was written.**
   `[MEASURED: git log]`
   ```
   389fd61  2026-08-26 00:35  feat(29): the minimal inbound listener, written in TypeScript over a PUBLIC base class
   c5ba478  2026-08-26 01:48  feat(cloudflare): the two workerd globals js-libp2p cannot construct without
   2e8c13f  2026-08-26 13:15  feat(cloudflare): the DO assembly and the expiry alarm, which are one deliverable
   caa46c6  2026-08-26 14:05  feat(cloudflare): the inbound listener, held against the hibernation API
   38f6f3e  2026-08-26 17:35  docs(cloudflare): one deploy is enough
   9062710  2026-08-26 17:52  Merge feature/phase-29-hosted-tier — "the hosted tier built to its deploy gate"
   5352277  2026-08-27 00:28  docs(phase-29): capture context for the phase remainder   <- 29-CONTEXT.md
   ```
   `git diff --stat 9062710..5352277 -- packages/cloudflare/` is **empty** — nothing touched
   the package between the merge and the context capture. `[MEASURED]`

2. **`.planning/HANDOFF.json`** (timestamp `2026-08-26T23:50:00.000Z`, 38 minutes before
   `29-CONTEXT.md`) states directly: *"THE TREE IS FULLY CLEAN AND SYNCED... nothing is in
   flight. Two things wait on the owner and neither is blocked by anything here. (1)
   Cloudflare: billing alert FIRST, then ONE deploy — not two."* Its own `decisions` array
   records: *"The listener is WRITTEN, not borrowed"* with the rationale *"`webSocketToMaConn`
   is not on `@libp2p/websockets`' public surface... The owner's 'we write TypeScript' is what
   settled it."* `[READ: .planning/HANDOFF.json]` — this is a **different, and contradictory,
   decision** from `29-CONTEXT.md`'s "copy the upstream file and refactor the copy."

3. **`.planning/.continue-here.md`** (same session) states: *"Phase 29 — 3 of 7 criteria.
   Phase 30 — requirement 4 done, criteria 1-3 deploy-gated. The hosted tier is now waiting on
   ONE owner act and nothing else."* `[READ]`

4. **The code itself is not a copy of `websocket-to-conn.ts`.** `packages/cloudflare/src/
   websocket-connection.ts` is a hand-written `CloudflareWebSocketConnection extends
   AbstractMultiaddrConnection`, built directly against the public `@libp2p/utils` entry point.
   Its own module docblock states the same three-option analysis `29-CONTEXT.md` presents
   (package-specifier import fails, file-path import is outside `exports`/semver, so vendor or
   write) and resolves it the other way: write ~40 lines against the public base class rather
   than vendor upstream's private subclass. `[READ: packages/cloudflare/src/
   websocket-connection.ts:1-40]`

5. **All four of `29-CONTEXT.md`'s "Deferred to Phase 30" items are already implemented and
   wired**, not deferred:
   - `direction: 'inbound'` — fixed by the constructor (`super({ ...init, direction:
     'inbound' })`), cannot be omitted by a caller. `[READ: websocket-connection.ts]`
   - `remoteAddr` from `CF-Connecting-IP` — `remoteAddrFromRequest()`, throws
     `MissingClientAddressError` rather than defaulting to loopback. `[READ:
     websocket-connection.ts]`
   - The `bufferedAmount` policy — **already decided and shipped**: `sendData()` returns
     `canSendMore: true` unconditionally, with a docblock stating the cost ("this connection
     applies no backpressure") rather than hiding it. `[READ: websocket-connection.ts]`
   - The hibernation-aware socket, called "the largest genuinely-new engineering item on this
     tier" in `ARCHITECTURE.md` — `packages/cloudflare/src/hibernatable-socket.ts`,
     `state.acceptWebSocket()` (never `socket.accept()`), a revived socket closed with 1012
     rather than resumed, keyed by socket identity so a miss on eviction *is* the detection.
     `[READ: hibernatable-socket.ts]`

6. **The end-to-end wiring exists in `worker.ts`.** `fetch()` checks
   `request.headers.get('Upgrade') === 'websocket'`, constructs `WebSocketPair`, calls
   `acceptInboundSocket()` (which does the `CF-Connecting-IP` refusal, hibernation adoption,
   and un-awaited `upgradeInbound()`), and returns the 101 with the client half. libp2p is
   constructed via `createHostedFabric()` (`hosted-libp2p.ts`) on **first inbound upgrade**,
   not before. `[READ: worker.ts]`

7. **`hosted-libp2p.ts` already configures the private DHT with all four required settings**
   (`protocol: O2_KAD_PROTOCOL`, `clientMode: false`, `peerInfoMapper: passthroughMapper`,
   `selectors: { [O2_RECORD_NAMESPACE]: o2RecordSelector }`), plus `circuitRelayServer()` with
   `addresses.announce` required (refuses to construct on an empty announce list) and the
   inbound-upgrade service registered as `services.inbound`. `[READ: hosted-libp2p.ts]`

8. **All of it passes, right now, on this machine.** `[MEASURED]`
   ```
   $ npx vitest run --project node packages/cloudflare/src/hibernatable-socket.test.ts \
       packages/cloudflare/src/websocket-connection.test.ts \
       packages/cloudflare/src/hosted-libp2p.node.test.ts \
       packages/node/src/hosted-tier-deploy.node.test.ts
   Test Files  4 passed (4)
        Tests  53 passed (53)
   EXIT=0
   ```

9. **I independently reproduced the bundle claim by running the one command the safety
   boundary permits**, not by trusting the docblock. `[MEASURED]`
   ```
   $ cd packages/cloudflare && WRANGLER_SEND_METRICS=false npx wrangler deploy --dry-run \
       --outdir=<scratchpad>/dryrun-out
   Total Upload: 1867.80 KiB / gzip: 405.69 KiB
   EXIT=0, no auth prompt, no network resource created
   ```
   Grepping the emitted `worker.js` myself: `noise` × 50, `pureJsCrypto` × 2, `kadDHT` × 12,
   `circuitRelayServer` × 4, `diffieHellman` × 0, `node:crypto` × 0, `Dynamic require` × 0.
   These are close to but not bit-identical to the numbers frozen in code comments (`noise`
   ×43, `kadDHT` ×11, `circuitRelayServer` ×3 at an earlier point in the same day) — small
   drift is expected as commits landed between the comment being written and this reading, and
   it does not change the conclusion: noise, kadDHT and circuitRelayServer are all solidly
   present, `diffieHellman`/`node:crypto` are solidly absent, and the guard in
   `hosted-tier-deploy.node.test.ts` is reading a real, non-vacuous bundle.

### What this means for the plan

**The engineering "this plan" was scoped to deliver is not absent — it exists, is tested, and
passed independently in this session.** The two things that are genuinely still open are
exactly `29-CONTEXT.md`'s criteria 1 and 2, which were *already* owner acts regardless of any
of this. Nothing above changes who performs criteria 1 and 2, and nothing above closes them —
they still need a real billing alert and a real deploy.

What it does change: a plan that opens with "write/copy the listener" would either (a) duplicate
work that already exists and passes, or (b) — if read as "replace the hand-written listener with
a vendored copy of upstream" — **discard tested code that already avoids the exact hazard
(`bufferedAmount`-driven `repeatingTask` polling) the vendoring decision exists to fix**, in
favor of code that would need to reintroduce and then re-neutralize that same hazard.

**Recommendation to the planner, stated as a recommendation rather than a unilateral override:**
open the plan with a short reconciliation step — confirm with the owner whether `29-CONTEXT.md`'s
2026-08-27 decision was made with awareness of `caa46c6`/`218a771`/`HANDOFF.json` (all dated
2026-08-26, all describing the opposite conclusion). Two honest outcomes exist and this research
cannot pick between them:
- **The owner did not have this state in view** when the decision was recorded — in which case
  the "remainder" collapses to the two runbook items below, no vendoring, and `29-CONTEXT.md`
  should be corrected the same way `29-REPORT.md` finding 1 was retracted.
- **The owner wants the vendored copy anyway**, for a reason not stated in `29-CONTEXT.md` (e.g.
  wanting the listener to track upstream's own future fixes, or distrust of the hand-rolled
  class for a reason this research did not surface) — in which case the plan should do the swap
  deliberately, with the existing tests as the regression bar, and Section "If the copy is still
  wanted" below gives the refactor list to do it correctly.

Everything below answers the assigned questions against **both** branches, so the plan is usable
either way once the reconciliation happens.

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| HOST-01 | A deployed Durable Object is a dialable WSS peer with a persisted identity | Code path exists end-to-end (`worker.ts` → `hosted-libp2p.ts` → `websocket-connection.ts`/`hibernatable-socket.ts`) and passes locally; the deploy-and-dial itself is criterion 2, an owner act. `REQUIREMENTS.md:1868` still reads "Not started" — **stale**, written before the merge at `9062710` |
| HOST-05 | Durable Object storage through `interface-datastore` | **MET** per `29-REPORT.md` criterion 3 — do not re-plan |
| HOST-08 | Exactly one call site may obtain a stub | **MET** per `29-REPORT.md` criterion 4, guard plant watched red — do not re-plan |
| HOST-10 | Billing alert before first object exists | **OPEN — owner act.** No Cloudflare account configuration exists under this repo's control (confirmed: `grep -i "budget\|billing\|alert" node_modules/wrangler/config-schema.json` → no match, `EXIT=1`) |
| HOST-11 | No preview deployments | **MET** per `29-REPORT.md` criterion 5 — do not re-plan |
| HOST-12 | Closed `idFromName()` set | **MET** per `29-REPORT.md` criterion 6 — do not re-plan |
| NET-03 | Certificate requirement (carried from Phase 3) | **MET as a report** — second route, not closure; do not re-plan |
</phase_requirements>

---

## Project Constraints (from CLAUDE.md)

- **Commit with explicit paths**, never a bare `git commit` — concurrent-agent hazard on a
  shared working tree.
- **`git add` only between test runs, never during one** — two specs snapshot
  `git status --porcelain` around themselves.
- **Never `git stash`/`git checkout --` a path you do not own.**
- **Run vitest by project** (`--project node|aot|browser|e2e|perf`), never a bare path; `aot` is
  its own lane, run alone.
- **`EXIT=$?` read immediately after the command**, never after a pipe/tail/echo.
- **A proof that cannot fail is not a proof** — plant the mutation, watch it go red, restore,
  record the observed text.
- **Prefer a comparative reading to an absolute one** where measurement is involved.
- **Descoped is not satisfied; unmeasured is not met.**
- **ABSOLUTE SAFETY BOUNDARY (this session's task brief, consistent with CLAUDE.md's spirit)**:
  `wrangler deploy --dry-run` only, `WRANGLER_SEND_METRICS=false`, never `--remote`, never touch
  the `ocr-checks-worker*` scripts.

---

## Summary

Phase 29's remaining engineering — the minimal inbound listener without which criterion 2
cannot be attempted — is **already built, wired, and passing** in `packages/cloudflare/src/`
(`websocket-connection.ts`, `hibernatable-socket.ts`, `hosted-libp2p.ts`, `worker.ts`,
`workerd-shims.ts`), committed to this branch on 2026-08-26, hours before `29-CONTEXT.md` was
captured on 2026-08-27. All 53 tests across the four relevant spec files pass; an independent
`wrangler deploy --dry-run` I ran in this session reproduces the bundle characteristics claimed
in the code's own comments (noise/kadDHT/circuitRelayServer present, `diffieHellman`/
`node:crypto` absent, no dynamic-require trap). `29-CONTEXT.md`'s framing — that a "copy
`websocket-to-conn.ts` and refactor" decision is still to be executed, and that the four
Phase-30-owned listener requirements are still deferred — does not match the tree, and the
mismatch traces to a session hand-off gap rather than to any defect in the code itself.

**Primary recommendation:** before planning any listener-writing task, reconcile
`29-CONTEXT.md`'s vendoring decision against `.planning/HANDOFF.json`'s "the listener is
WRITTEN, not borrowed" decision (same date, opposite conclusion, and the later document does not
cite or contradict the earlier one — it reads as if it never saw it). If the existing code
stands, the plan is almost entirely the owner runbook: billing alert, then one deploy, then the
two-dial-with-eviction-and-redeploy test. If the owner still wants the vendored copy for reasons
of their own, do the swap as a deliberate, tested replacement using the refactor list in Q1/Q9
below, keeping the 53 existing tests as the regression bar so nothing already proven is lost.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| WSS upgrade handshake (`Upgrade: websocket` → 101) | API/Backend (Cloudflare Worker `fetch`) | — | Platform-terminated; `worker.ts` is the only caller of the Durable Object stub |
| Stable node identity across eviction | Database/Storage (Durable Object storage via `DoDatastore`) | API/Backend (`HostedNode`) | Identity must survive isolate recycling; storage is the only durable substrate on this tier |
| libp2p protocol stack (Noise, yamux, kad-dht, circuit-relay) | API/Backend (constructed inside the DO on first upgrade) | — | No browser/CDN tier exists on this path; TLS is terminated by Cloudflare's edge ahead of this tier |
| Backpressure / flow control on the inbound socket | API/Backend (`CloudflareWebSocketConnection.sendData`) | — | workerd's `WebSocket` has no `bufferedAmount`; the answer (`canSendMore: true`, no backpressure) is a deliberate policy owned by this class, not the platform |
| Session survival across Durable Object eviction | API/Backend (`HibernatableSockets` registry, keyed by socket identity) | Database/Storage (identity only; Noise/yamux session state is NOT persisted and cannot be) | A revived socket is closed with 1012 rather than resumed — this is a design conclusion, not a gap |
| Billing/cost control | Operator (Cloudflare dashboard/API, outside this codebase) | — | No wrangler config key exists for billing alerts (`config-schema.json` has none); this is entirely an owner act |
| Preview-deployment prevention | API/Backend (`wrangler.jsonc` `preview_urls: false`) + CI (`DEMO-04` guard forbidding a deploy workflow) | — | Config alone cannot see a hand-run deploy with a flag; CI absence covers that half |

---

## Standard Stack

No new libraries are needed for the remainder. Everything the listener uses is already in the
tree and already pinned:

| Library | Version | Purpose | Status |
|---------|---------|---------|--------|
| `@libp2p/utils` | (per root pin) | `AbstractMultiaddrConnection`, the public base class the hand-written listener extends | Already a dependency, already used |
| `libp2p` | `3.3.6` | `createLibp2p` in `hosted-libp2p.ts` | Already wired |
| `@chainsafe/libp2p-noise` | `17.0.0` | Encryption; bundled via legacy `browser` field, pure-JS X25519, no `diffieHellman` | Confirmed absent from bundle by measurement in this session |
| `@libp2p/kad-dht` | `16.4.0` | Private keyspace `/o2/kad/1.0.0` | Already configured with all four required settings |
| `@libp2p/circuit-relay-v2` | `4.2.9` | `circuitRelayServer()` | Already wired, `announce` required by construction |
| `wrangler` | `4.125.0` | Deploy tooling, dry-run only in this repo | Pinned at root `package.json:38` |

**No new runtime dependency is added or needed**, whichever way the vendoring reconciliation
goes — the "copy" path vendors ~109 lines of already-permissively-licensed source with no new
package; the existing hand-written path adds nothing at all.

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Hand-written `CloudflareWebSocketConnection` (current) | Vendored copy of `websocket-to-conn.ts`, refactored | Vendoring tracks upstream's exact behavior and future fixes at the cost of inheriting its `bufferedAmount`/`repeatingTask` polling design, which must then be re-neutralized for workerd — the hand-written class never has this problem because it was never built around a property that doesn't exist on this platform |
| Third-party libp2p-for-workerd adapter (`cf-libp2p-ws-transport`) | — | Rejected in `STACK.md:140-152` — targets a plain Worker (no stable identity) and is version-skewed against libp2p v3. Not reconsidered here; nothing changes this verdict |

---

## Architecture Patterns

### System Architecture Diagram — the inbound path as it exists today

```
 outside peer (js-libp2p, Node or browser)
        │  dial /dns4/<name>/tcp/443/tls/ws/p2p/<peerId>
        ▼
 Cloudflare edge (TLS terminated with Cloudflare's own commercial cert — NET-03's "second route")
        │  HTTP request, Upgrade: websocket, header CF-Connecting-IP: <real client IP>
        ▼
 export default { fetch }  (worker.ts)
        │  stubFor(env.BOOTSTRAP, 'bootstrap-us')   <- SERVED_BY is a module constant, never request-derived (HOST-12)
        ▼
 BootstrapObject.fetch(request)   (the Durable Object, one instance, identity persisted in storage)
        │  Upgrade header present?
        ├─ no  → GET /self → HostedNode.identity() → { peerId, nodeKey }   (criterion 2's cheap check)
        └─ yes → #upgrade(request)
                  │  1. #fabricOnce() → createHostedFabric()  (hosted-libp2p.ts, built on FIRST upgrade only)
                  │       - createLibp2p({ websockets(), circuitRelayTransport(), noise(), yamux(),
                  │                        identify(), ping(), keychain(), kadDHT(hostedDhtInit),
                  │                        relay: circuitRelayServer(...), inbound: inboundUpgradeService() })
                  │  2. new WebSocketPair() → { client, server }
                  │  3. acceptInboundSocket({ socket: server, request, upgrade, state, sockets })
                  │        (hibernatable-socket.ts)
                  │        a. remoteAddrFromRequest(request)   — REFUSES if CF-Connecting-IP absent (req. 2)
                  │        b. sockets.adopt(state, server, {...}) → state.acceptWebSocket(server)  (req. 4: hibernation, never socket.accept())
                  │             → new CloudflareWebSocketConnection({ direction: 'inbound' fixed, remoteAddr, ... })  (req. 1, req. 3)
                  │        c. upgrade.upgradeInbound(connection)  — NOT awaited (would deadlock before the 101 ships)
                  │  4. return new Response(null, { status: 101, webSocket: client })
                  ▼
 peer's Noise handshake completes against the object's persisted PeerId → identify → kad-dht / relay reachable
```

Frames after upgrade arrive at the **platform-invoked** methods `webSocketMessage` /
`webSocketClose` / `webSocketError` on `BootstrapObject`, which delegate to the same
`HibernatableSockets` registry keyed by socket identity — a socket object the current instance
has never seen (post-eviction) is closed with `1012` rather than treated as live.

### Recommended Project Structure (already the actual structure — nothing to change)
```
packages/cloudflare/src/
├── worker.ts                 # deployed entry point, fetch/alarm/webSocket* handlers
├── hosted-object.ts           # HostedNode, the closed 3-name enumeration, stubFor (the one call site)
├── hosted-identity.ts         # PeerId seed persisted through DoDatastore
├── do-datastore.ts            # interface-datastore over Durable Object storage, refuses record-shaped keys
├── hosted-libp2p.ts            # createLibp2p assembly: DHT init, relay init, inbound upgrade seam
├── websocket-connection.ts    # CloudflareWebSocketConnection (MultiaddrConnection), remoteAddrFromRequest
├── hibernatable-socket.ts     # HibernatableSockets registry, acceptInboundSocket, the 1012-close design
├── workerd-shims.ts           # process.versions / BroadcastChannel shims libp2p needs to construct at all
├── expiry-alarm.ts            # alarm-driven sweep glue (identity-only store today; DHT sweep is Phase 31)
└── wrangler.jsonc              # deploy config: preview_urls false, workers_dev true, one DO binding
```

### Pattern: Build the network stack lazily, on first upgrade, never at construction
**What:** `BootstrapObject#fabricOnce()` memoizes a `Promise<HostedFabric>`, created only inside
`#upgrade()`.
**When to use:** Any Durable Object where most invocations (e.g. `GET /self`, `alarm()`) must
not pay for a full libp2p stack.
**Why it matters here:** `worker.ts`'s own docblock records the measured proof this is
per-symbol tree-shaking, not per-module — an *uncalled* `createLibp2p` import still bundled
noise at 583.94 KiB; wiring the caller grew the bundle to 1867.80 KiB but did not change
whether esbuild would have shaken it (it wouldn't have, for an imported-but-uncalled module,
either way — the growth is *because* the listener now actually reaches kadDHT/circuitRelayServer
symbols the earlier build didn't call).

### Anti-Patterns to Avoid (each already measured as a real failure mode in this codebase)
- **Faking `bufferedAmount` through a Proxy** — measured making libp2p reject every frame with
  `Incorrect binary type`. The correct move is to not read the property at all and state the
  cost of not doing so (as the current code does).
- **Awaiting `upgradeInbound()` before returning the 101** — deadlocks by construction; no byte
  moves until the response is sent.
- **`socket.accept()` for a socket that should hibernate** — mutually exclusive with
  `state.acceptWebSocket()`; measured killing the connection at 6 minutes idle vs. 15+ minutes
  surviving on the hibernation path.
- **Deriving `remoteAddr` from a hardcoded loopback address** — measured collapsing the entire
  internet into libp2p's per-host 5-connections/second inbound cap.
- **Deriving the served object's name from the request** — an object is sited permanently by its
  first `get()`; a `searchParams`-derived name is an unrecoverable defect, not a bug to patch.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| MultiaddrConnection base behavior (close/reset/abort bookkeeping) | A from-scratch state machine | `@libp2p/utils`' `AbstractMultiaddrConnection` (already used) | Public, stable entry point; the platform-specific 40-60 lines are the only genuinely new code either implementation path needs |
| A general-purpose libp2p-for-workerd adapter | `cf-libp2p-ws-transport` or similar | The project's own ~60-line listener | Version-skewed against v3, and built against a plain-Worker assumption with no stable identity (`STACK.md:140-152`, unchanged by this research) |
| DHT keyspace isolation | Custom protocol namespacing | `@libp2p/kad-dht`'s `protocol` + `clientMode` + `peerInfoMapper` + `selectors` (all four, already set in `hosted-libp2p.ts`) | Two of the four fail *silently* if omitted — measured and recorded in `CLAUDE.md` at the cost of two days |

**Key insight:** every "don't hand-roll" item on this tier was already resolved by prior phases;
the remainder genuinely has nothing new to avoid hand-rolling — the risk in this phase is the
opposite one, discarding working code in favor of re-deriving it.

---

## Common Pitfalls

### Pitfall: Trusting a planning document's staleness date over the tree's commit history
**What goes wrong:** A context/decision document is treated as authoritative because it is the
most recently *dated* artifact, when the tree's own commit log shows work landed and was
hand-off-recorded (`HANDOFF.json`, `.continue-here.md`) hours before that document was written.
**Why it happens:** Session boundaries don't guarantee the next session's context-gathering step
read every file that changed; a document capturing "what remains" is only as good as the state
it was captured against.
**How to avoid:** Before planning from any `*-CONTEXT.md`, diff the phase's own package
directory between the document's commit and the branch's current `HEAD`, and check
`.planning/HANDOFF.json` / `.planning/.continue-here.md` for a more recent state snapshot.
**Warning signs:** A decision document proposing to "build" something whose files already exist
and already have passing tests.

### Pitfall: `bufferedAmount` absence read as "unset" rather than "absent from the prototype"
**What goes wrong:** Code that does `websocket.bufferedAmount ?? 0` or similar defaults silently
computes `undefined < N` as `false` every time, permanently reporting no room to send.
**Why it happens:** Most WebSocket implementations do have the property; workerd's does not
(confirmed by the consult's own prototype-key enumeration, quoted in `29-CONTEXT.md`).
**How to avoid:** State the policy explicitly and document its cost, as the current
`sendData()` does, rather than deriving a value from a property that isn't there.
**Warning signs:** A `repeatingTask`/polling loop that starts and a `'drain'` event that never
fires.

### Pitfall: Believing "Phase 30 owns X" means X is not yet built
**What goes wrong:** `29-CONTEXT.md`'s phase-boundary section is a **planning boundary**
(what's chargeable to which phase for reporting purposes), not a **build boundary**. All four
things labeled "Phase 30's" in this repo are already implemented in files whose own commit
messages self-label "Phase 30's requirement 4."
**How to avoid:** Read the phase boundary as "which criteria close where," and separately check
whether the underlying code has already landed — the two questions have different answers here.

---

## Code Examples

### The refusal pattern used throughout this tier (worth reusing, not reinventing)
```typescript
// Source: packages/cloudflare/src/websocket-connection.ts (read in this session)
export function remoteAddrFromRequest(request: Request): Multiaddr {
  const client = request.headers.get(CLIENT_ADDRESS_HEADER)
  if (client === null || client.length === 0) throw new MissingClientAddressError()
  return multiaddr(`/${client.includes(':') ? 'ip6' : 'ip4'}/${client}/tcp/443/tls/ws`)
}
```
A fallback here is exactly the measured defect (§19 of the 2026-08-24 consult): a loopback
default that collapses every distinct client into libp2p's per-host inbound cap. Refuse loudly
at the first request instead.

### The un-awaited upgrade (the second failure mode a naive port would reintroduce)
```typescript
// Source: packages/cloudflare/src/hibernatable-socket.ts (read in this session)
void init.upgrade.upgradeInbound(connection).catch(() => {
  init.socket.close(UPGRADE_FAILED, UPGRADE_FAILED_REASON)
  init.sockets.forget(init.socket)
})
```

---

## Q1 — The upstream file's refactor list, verified against the real files

`node_modules/@libp2p/websockets/src/websocket-to-conn.ts` (109 lines) and
`node_modules/@libp2p/utils/src/abstract-multiaddr-connection.ts` were both read in full this
session. **The trace in `29-CONTEXT.md` is CORRECT, and I confirm it rather than merely repeat
it** `[MEASURED: read node_modules/@libp2p/websockets/src/websocket-to-conn.ts]`:

```
DEFAULT_MAX_BUFFERED_AMOUNT = 4 MiB, DEFAULT_BUFFERED_AMOUNT_POLL_INTERVAL = 10 (ms)

sendData():
  canSendMore = this.websocket.bufferedAmount < this.maxBufferedAmount
    workerd: bufferedAmount is ABSENT from the prototype (consult §16, quoted key list has no
    such member) → reads as `undefined` → `undefined < 4194304` → false → canSendMore = false
  if (!canSendMore) this.checkBufferedAmountTask.start()   <- repeatingTask, fires every 10ms

checkBufferedAmount() [invoked every 10ms once started]:
  if (this.websocket.bufferedAmount === 0) { stop(); dispatch 'drain' }
    workerd: `undefined === 0` → false, always → task NEVER stops, 'drain' NEVER fires
```

So the trace is right: a 10ms `repeatingTask` timer starts on the very first send and never
stops. **`repeatingTask`'s mechanism, read in full** `[MEASURED: cat node_modules/@libp2p/utils/src/repeating-task.ts]`:
its `runTask()` runs the callback inside a `Promise.resolve().then(...)`, and in the `.finally()`
of that chain does `timeout = setTimeout(runTask, interval)` — a genuine `setTimeout`/`clearTimeout`
recursion, not a `while(true)` busy loop. `stop()` calls `clearTimeout(timeout)` and aborts a
controller. So the per-tick CPU cost is negligible (one property comparison), and the mechanism
itself carries no CPU hazard.

**What it does carry is a live, recurring platform timer that never gets cancelled** on workerd,
because the only path that calls `stop()` (`bufferedAmount === 0`) can never become true. I also
read `@libp2p/utils/src/abstract-multiaddr-connection.ts` in full (93 lines) to check whether the
*base class itself* needs this polling for anything — it does not: `close()` (lines 49-86) awaits
a `'drain'` event only when `this.writableNeedsDrain` is true (line 73), and that flag is driven
by `AbstractMessageStream`'s write-queue accounting from the `canSendMore` value `sendData()`
returns **per call**, never by a re-read of `bufferedAmount`. So the `repeatingTask` machinery is
entirely internal to `websocket-to-conn.ts`'s own subclass, not a base-class requirement — which
is also why `CloudflareWebSocketConnection` (which always returns `canSendMore: true`) needs no
polling at all: `writableNeedsDrain` never becomes true for it, so `close()` never waits on a
`'drain'` that would never arrive.

Whether a live `setTimeout`-recursion timer keeps a Durable Object "active" for billing purposes
the same way an open WebSocket does is **UNVERIFIED** in this session — it was not deployed, and
the official Durable Objects billing model (duration of the object being "active") is described
in `PITFALLS.md` citing official Cloudflare pricing docs, not measured against this specific
case. This is exactly the kind of "genuinely still unknown" item Q10 asks for; it is the one fact
that would make the copy-refactor concretely worse than the current code rather than just
structurally different, and it should be measured on a real deploy before it is used as a
deciding argument either way.

**Beyond `bufferedAmount`, the other DOM/WebSocket surfaces `websocket-to-conn.ts` touches, and
their status:**

| API touched by upstream | Present on workerd? | How established |
|---|---|---|
| `websocket.bufferedAmount` (read) | **Absent from prototype** | MEASURED (§16 of the 2026-08-24 consult, prototype key enumeration) |
| `addEventListener('close', cb, { once: true })` | UNVERIFIED | Not deployed this session; workerd's `WebSocket`/`EventTarget` was not probed for the options-object overload. The current hand-rolled code sidesteps this entirely — it never passes `{ once: true }` |
| `evt.wasClean`, `evt.code`, `evt.reason` on close events | UNVERIFIED | Same reason. The current code's `close` handler reads none of these fields at all (`socket.addEventListener('close', () => { connection.onRemoteCloseWrite() })`) |
| `evt.data instanceof ArrayBuffer` on message events | **Confirmed working** | MEASURED in the 2026-08-24 consult (§9): "Cloudflare accepts `server.binaryType = 'arraybuffer'` and then delivers genuine `ArrayBuffer` frames (`ctor: "ArrayBuffer"`, `isArrayBuffer: true`)." The current code uses exactly this check |
| `websocket.close(1006)` (upstream's `sendReset`) | UNVERIFIED for code 1006 specifically | The current code uses `1011` for `sendReset` instead, citing that 1011 is "the one workerd is known accepted" (per `hibernatable-socket.ts`'s own docblock) — i.e. this was already investigated and 1006 was deliberately avoided, not overlooked |
| `websocket.send(ArrayBuffer)` | **Confirmed working** | Same §9 measurement; the current code copies into a fresh `Uint8Array`'s buffer before `send()`, citing that the caller may reuse the source list |

**Conclusion for Q1:** if the vendoring path is taken, the refactor list is: (1) remove the
`bufferedAmount` read and the `checkBufferedAmountTask` entirely, replacing with a stated policy
(`canSendMore: true` or a real one, the same decision the current code already made); (2) do not
carry over `{ once: true }`, `evt.wasClean`, `evt.code`, `evt.reason` without first verifying
them against a real deployed object — the current code's total avoidance of these fields is not
an oversight, it is the conservative reading of exactly what's been measured versus assumed;
(3) keep the `evt.data instanceof ArrayBuffer` check and the `send(ArrayBuffer)` call, both
independently confirmed working; (4) change `sendReset`'s close code from `1006` to `1011`.

---

## Q2 — Where should the (already-written) listener live, and does `websocket-connection.ts` already do the job?

**It already exists at `packages/cloudflare/src/websocket-connection.ts`, and it already does
the job.** `[READ]` This directly answers the second half of the question: the copy would be
redundant with what's there, not a gap-filler.

**Why `packages/cloudflare/src/` and not `packages/libp2p/src/`, stated as the reason either
way (per Claude's Discretion in `29-CONTEXT.md`) even though the tree has already chosen:**
- `packages/libp2p/src/` holds code shared by **both** the browser and Node tiers (e.g.
  `dht-record-sweep.ts`, `relay-reservations.ts`, `providerRecordPolicy`) — its own convention,
  read from `hosted-libp2p.ts`'s imports, is "one definition for both tiers."
- `CloudflareWebSocket`, `WebSocketPair`, `state.acceptWebSocket`, and `CF-Connecting-IP` are
  **exclusively** a Cloudflare/workerd concept — there is no browser or Node equivalent that
  would share this code. Putting it in `packages/libp2p/src/` would put a platform-specific
  adapter beside genuinely portable code, breaking that package's own stated convention.
- This matches how `hosted-identity.ts`, `hosted-object.ts`, `do-datastore.ts` are already
  placed — `packages/cloudflare/src/` is consistently "everything that only makes sense on this
  platform," and `packages/libp2p/src/` is consistently "everything both tiers share."

**Conclusion: `packages/cloudflare/src/` is correct, and the placement question is already
resolved by precedent as well as by the current code's location.**

---

## Q3 — The minimal listener, end to end, named in this repo's own terms

Answered fully in the Architecture Patterns diagram above. In one line per hop:
`worker.ts#fetch` → `worker.ts#BootstrapObject.#upgrade` → `new WebSocketPair()` →
`hibernatable-socket.ts#acceptInboundSocket` → `websocket-connection.ts#remoteAddrFromRequest`
+ `HibernatableSockets#adopt` (→ `state.acceptWebSocket`, never `socket.accept()`) →
`new CloudflareWebSocketConnection({ direction: 'inbound' fixed })` →
`upgrade.upgradeInbound(connection)` (from `hosted-libp2p.ts#inboundUpgradeService`, the seam to
`components.upgrader`) → `new Response(null, { status: 101, webSocket: client })`.

`direction: 'inbound'` is fixed by the constructor rather than passed as an option — a stronger
guarantee than "Phase 29's share is just this one field," since it cannot be omitted by any
future caller. The other three ARCHITECTURE §14/§16/§17/§19 requirements are present in the same
code, which is the crux of the central finding above.

---

## Q4 — Does `createLibp2p` exist, and does the listener pull noise into the bundle? (re-measured)

Yes to both, confirmed independently this session (not just read from a comment):

```
$ npx wrangler deploy --dry-run --outdir=<scratch>   [MEASURED, EXIT=0]
Total Upload: 1867.80 KiB / gzip: 405.69 KiB

grep counts on worker.js:
  noise                50
  pureJsCrypto          2
  kadDHT               12
  circuitRelayServer    4
  diffieHellman         0
  node:crypto           0
  "Dynamic require"     0
```

These are close to, but not bit-identical to, the numbers frozen in `worker.ts`'s and
`hosted-tier-deploy.node.test.ts`'s own comments (`noise` ×43, `kadDHT` ×11,
`circuitRelayServer` ×3, recorded earlier in the same day the listener landed). The direction and
magnitude both confirm the comments' claim — the assembly is real, not vacuous — and the small
drift is unremarkable (a handful of commits landed between the comment being frozen and this
reading). The `hosted-tier-deploy.node.test.ts` guard reads this live rather than trusting either
number, and it currently passes with the real (non-skip) assertion active — the "skips loudly"
branch described in `29-CONTEXT.md` open item (a) **has already flipped**.

---

## Q5 — The open-question-1 guard: exactly what flips it, and it has already flipped

**File:** `packages/node/src/hosted-tier-deploy.node.test.ts`, test `'keeps diffieHellman out of
the bundle — OR says why it cannot answer yet'`.

**The flip condition, read from the code:** `if (!emitted.includes('pureJsCrypto') &&
!emitted.includes('noise')) { ctx.skip() }` — i.e. it skips only while the bundle contains
neither string. Once anything calls `createLibp2p` (which happened when `worker.ts` wired the
listener in `caa46c6`), noise is pulled into the bundle and the skip condition is false, so the
real assertions (`expect(emitted).not.toContain('diffieHellman')`,
`.not.toContain('node:crypto')`) run for real. **This already happened** — the test passed in
this session's run without hitting the skip branch, and my own independent bundle build confirms
`noise` is present (×50) while `diffieHellman`/`node:crypto` are both 0.

---

## Q6 — The reachability register: which rows moved, and the current live number

**File:** `packages/node/src/reachability-guard.node.test.ts`, constant `UNREACHABLE_CEILING`.

`[MEASURED: grep + read the file's own change log, which is unusually explicit]` The number's
history, entirely in-file:
```
71 -> 74   (2026-08-25)  three do-datastore.ts rows — predicted to REVERSE when the node deploys and dials
74 -> 80   (2026-08-26)  six hosted-object.ts/hosted-identity.ts rows
80 -> 84   (2026-08-26)  four websocket-connection.ts rows
84 -> 87   (2026-08-26)  three dht-record-sweep.ts rows
87 -> 97   (2026-08-26)  ten rows, expiry-alarm.ts + hosted-libp2p.ts
97 -> 103  (2026-08-26, "Phase 30")  six inbound-listener rows
```
**Current value: `UNREACHABLE_CEILING = 103`.** `[MEASURED: grep -n "UNREACHABLE_CEILING = " packages/node/src/reachability-guard.node.test.ts]`

**Which rows the listener was expected to move, and which only a real deploy can move — stated
by the file itself, not inferred by me:** every row on this tier has a caller that is a platform
entry point (`fetch`, `alarm`, `webSocketMessage`) that "nothing in this repository invokes."
The file's own comment states this explicitly after the prediction from the 74→80 raise failed to
come true: *"The 2026-08-25 note says the three `do-datastore.ts` rows are expected to be
REVERSED by wiring within the milestone... The wiring landed on 2026-08-26 and the three did not
move... it closes when the node deploys and dials. Nothing deploys."* **So the correct
prediction for the plan to test is: none of these 103 rows will close from any amount of further
local wiring. They close only when a real deploy makes the platform actually call these
entry points** — which is exactly criterion 2's owner act, not a code task.

---

## Q7 — Criterion 2's evidence, concretely

**What must be captured, and how:**
1. **Cheap check (no dial needed):** `GET https://<name>.<subdomain>.workers.dev/self` returns
   `{ peerId, nodeKey }` from `HostedNode.identity()` — already implemented in `worker.ts`'s
   `fetch()` for the non-Upgrade path. This is the plain-HTTP route the question asks for. Two
   calls to this endpoint, one before and one after forcing an eviction, with the same `peerId`,
   is a cheap first-pass check the owner can run from a browser or `curl` with no libp2p
   dependency.
2. **The real check:** an outside `libp2p` process (Node, per the 2026-08-24 consult's own
   methodology) dials `/dns4/<name>.<subdomain>.workers.dev/tcp/443/tls/ws/p2p/<peerId>`,
   completes identify, and records `remotePeer`. Repeat after (a) forcing an eviction and (b)
   performing a redeploy. All three readings must show the same PeerId.
3. **Forcing an eviction:** **UNVERIFIED in this session** — no deploy was performed, so no
   eviction-forcing mechanism was tested. Durable Objects are typically evicted after a period
   of inactivity or can be forced via a new deployment/migration; the exact cheapest lever (idle
   wait vs. a dashboard action vs. `wrangler versions` operations) needs to be established by the
   owner at deploy time and recorded as part of the runbook evidence, not assumed here.
4. **Evidence to capture, concretely:** three timestamped JSON blobs (`{ at, source: 'self-http'
   | 'libp2p-dial', peerId }`) — one baseline, one post-eviction, one post-redeploy — saved
   alongside the deploy log so the timestamps can be checked against each other and against
   criterion 1's alert timestamp.

---

## Q8 — Criterion 1's evidence, established from the CLI only, not from documentation

`[MEASURED]` `wrangler --help` lists no billing/budget/alert subcommand — its command tree
(`auth`, `deploy`, `versions`, `tail`, `d1`, `kv`, `r2`, etc.) contains nothing under a
billing/notifications category. `[MEASURED]` `grep -i "budget\|billing\|alert\|spend"
node_modules/wrangler/config-schema.json` → **no match, exit 1**. So a billing alert cannot be
expressed in `wrangler.jsonc` or created via any `wrangler` subcommand available in this
repository's toolchain — it is **entirely outside wrangler's surface**, consistent with
`29-CONTEXT.md`'s own framing of it as a dashboard-level control.

**What carries a timestamp on each side, established as an UNVERIFIED-but-precise target rather
than guessed:**
- The billing-alert side: Cloudflare's account-level Notifications/Billing configuration has its
  own creation timestamp, visible wherever that alert is configured (dashboard, or the
  Cloudflare API's notification-policy resource, which is separate from anything `wrangler`
  touches). This session could not read that surface without touching the account, and did not.
- The deploy side: `wrangler deploy`'s own output includes a Version ID and the deployment is
  listed by `wrangler deployments list`, both timestamped by Cloudflare. `wrangler deployments
  --help` (available, not run against a real deploy in this session) would confirm the exact
  field name at deploy time.

**Marked UNVERIFIED and precisely bounded, per the task's own instruction:** exactly which
dashboard screen or API field the owner should screenshot/copy for the alert's creation
timestamp — this needs the owner's own account access, which this session correctly did not use.

---

## Q9 — Keeping a vendored copy honest (answered for the "owner still wants it" branch)

**Proposal, in the shape this repo already uses elsewhere (`slow-specs`, the reachability
register, `DoDatastore`'s classification set — all "read the real thing back, don't restate it"):**
a guard that reads `node_modules/@libp2p/websockets/package.json`'s installed version and
`node_modules/@libp2p/websockets/src/websocket-to-conn.ts`'s current byte length/hash, compares
against a constant pinned in the vendored file's own header comment, and fails loudly (not
silently) when they diverge — signaling "go re-read the upstream diff before trusting the
vendored copy is still equivalent." It would live beside the vendored file itself (e.g.
`packages/cloudflare/src/websocket-connection.vendored-guard.test.ts`), in the same package,
following the pattern `do-datastore.ts`'s own header already uses for its provenance comment.
This is not built anywhere in the tree today — there is no vendored file to guard, since the
hand-written path was taken instead.

---

## Q10 — Genuinely unknown, to be discovered only at deploy time

- Whether a live, never-stopping 10ms `repeatingTask` (the hazard the vendoring decision exists
  to fix) actually keeps a Durable Object billed as "active" the way an open WebSocket does —
  **not measured**, would only matter if the vendored path is chosen.
- Whether workerd accepts close code `1012` (`CLOSED_AFTER_HIBERNATION`) — `1011` is known
  accepted (used by `sendReset`), `1012` is not yet confirmed. `[UNVERIFIED, named openly in
  hibernatable-socket.ts's own docblock]`
- Whether `binaryType` may be assigned on a hibernatable socket at all — deliberately not
  asserted either way in the current code, because the spike lesson that required setting it was
  measured only on the `addEventListener` (non-hibernating) path.
- Whether the yamux `enableKeepAlive: true, keepAliveInterval: 30_000` default means a live
  connection **never** actually hibernates in practice (a frame every 30 seconds would keep
  waking the object) — named as an open decision in `hibernatable-socket.ts`, not taken.
- Whether an alarm survives an eviction and fires on a freshly-reconstructed instance —
  `ARCHITECTURE.md`'s own methodology ("request, fire, evict, re-read from a new instance") is
  stated as needing a real deployed alarm; nothing local reproduces this credibly.
- The exact lever to force an eviction for criterion 2's test, and the exact Cloudflare
  dashboard/API surface for the billing alert's timestamp (Q7/Q8, both above).
- Whether the small drift between the frozen bundle-measurement comments (`noise` ×43, `kadDHT`
  ×11) and this session's independent reading (`noise` ×50, `kadDHT` ×12) reflects a benign
  dependency/commit drift or something worth tracking — not investigated further, since neither
  the direction nor the pass/fail status of any guard is affected.

---

## Validation Architecture

`workflow.nyquist_validation` is `true` in `.planning/config.json` — this section is required
and is answered honestly about its own limits.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 4.1.10, run by project (`node`, `browser`, `aot`, `e2e`, `perf`) |
| Config file | `vitest.config.ts` (root) |
| Quick run command | `npx vitest run --project node packages/cloudflare/src/<file>.test.ts` |
| Full suite command | `npx vitest run --project node` (this package's specs only need the `node` project; the browser project separately runs `@o2/cloudflare`'s 18 files × 3 engines per `.continue-here.md`'s own last recorded run) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| HOST-05, HOST-08, HOST-11, HOST-12 | MET, do not re-plan | unit | `npx vitest run --project node packages/node/src/hosted-tier-deploy.node.test.ts` | ✅ (53 tests, all passing, verified this session) |
| HOST-01 | Listener code path exists and passes locally | unit + build | `npx vitest run --project node packages/cloudflare/src/{hibernatable-socket,websocket-connection,hosted-libp2p.node}.test.ts` + `wrangler deploy --dry-run` | ✅ verified this session, EXIT=0 |
| HOST-10 (billing alert) | **Cannot be automated at all** — no CLI/config surface exists (Q8) | manual, owner-captured | n/a | n/a |
| HOST-01/criterion 2 (dial-twice) | **Cannot be automated locally** — requires a real deployed peer | manual, owner-captured | `curl https://<name>.workers.dev/self` (cheap check) + a real libp2p dial (real check) | n/a |

### Sampling Rate
- **Per task commit** (if the reconciliation concludes any code change is still needed):
  `npx vitest run --project node packages/cloudflare/src/<changed-file>.test.ts`
- **Per wave merge:** `npx vitest run --project node` plus `npx vitest run --project browser`
  (per `.continue-here.md`'s own last recorded green run: 207/208 node files, 18 browser files ×
  3 engines)
- **Phase gate:** the two owner-act runbook items, which **no automated suite in this repository
  can substitute for** — this is stated honestly rather than papered over with a proxy test, per
  `CLAUDE.md`'s "descoped is not satisfied; unmeasured is not met."

### Wave 0 Gaps
None — the existing test infrastructure (`hosted-tier-deploy.node.test.ts`,
`hibernatable-socket.test.ts`, `websocket-connection.test.ts`, `hosted-libp2p.node.test.ts`)
already covers every requirement this phase's remaining code touches. **If the reconciliation
concludes the vendored-copy path should be taken instead**, the one new gap is a spec for the
vendored file's refactored `sendData`/`checkBufferedAmount` behavior, following the same
plant-and-watch-red discipline the existing files already use — no new framework or fixture is
needed, `do-storage.fixture.ts` and the existing `CloudflareWebSocket` fixture pattern cover it.

---

## Security Domain

`security_enforcement` is absent from `.planning/config.json` — treated as enabled.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No | No user-facing auth on this tier; the "identity" here is the libp2p PeerId, authenticated by Noise, not by a login |
| V3 Session Management | Partial | libp2p's Noise session IS the session; already handled by `@chainsafe/libp2p-noise`, never hand-rolled |
| V4 Access Control | Yes | The closed `idFromName()` enumeration + one-call-site guard (HOST-08/HOST-12, already MET) is the access-control boundary — it prevents visitor-controlled object creation, the actual attack surface on this tier |
| V5 Input Validation | Yes | `remoteAddrFromRequest` refuses malformed/absent `CF-Connecting-IP` rather than defaulting; `acceptWebSocket`'s message handler resets on non-`ArrayBuffer` frames rather than attempting to parse them |
| V6 Cryptography | Yes | Noise (`@chainsafe/libp2p-noise`) and PeerId derivation are library-provided, never hand-rolled; the pure-JS X25519 path used on workerd is the package's own shipped `browser` field, not a project-authored crypto substitute |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Visitor-derived object name creating unbounded Durable Objects | Denial of Service / Elevation of Privilege | Closed name enumeration, guarded (already MET, HOST-12) |
| Spoofed/absent `CF-Connecting-IP` collapsing the per-host inbound rate limit | Denial of Service | `MissingClientAddressError` refusal rather than a loopback default (already implemented) |
| Preview deployment multiplying a billing bug across 60+ instances | Denial of Service (cost) | `preview_urls: false` + `DEMO-04` CI guard (already MET) |
| No billing ceiling on a paid, always-on tier | Denial of Service (cost) | Billing alert BEFORE first object — the actual open criterion 1, an owner act with no code substitute |

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `29-CONTEXT.md`'s vendoring decision was made without visibility into `websocket-connection.ts`/`hibernatable-socket.ts`/`HANDOFF.json` | THE FINDING | If wrong (owner saw all of it and still wants the vendored copy for an unstated reason), the plan should still do the reconciliation step — it costs one conversation and prevents a wasted rewrite either way |
| A2 | A live 10ms `repeatingTask` timer inside a Durable Object contributes to "active" billing time the same way an open WebSocket connection does | Q1, Q10 | If wrong, the entire hazard motivating the vendoring decision is smaller than stated; if right, it's a real reason to prefer the current no-poller design over a vendored copy |
| A3 | Small numeric drift between frozen bundle-count comments (noise ×43) and this session's independent reading (noise ×50) reflects ordinary commit drift, not a regression | Q4 | Low — no guard's pass/fail status depends on the exact count, only presence/absence of `diffieHellman`/`node:crypto`, both independently confirmed 0 |

**If this table's items are resolved before planning starts:** A1 needs one owner
conversation; A2 needs one deploy plus a Durable Objects billing/analytics reading, both are
owner-act territory anyway; A3 needs nothing further.

---

## What is measured vs. what is inferred

Every load-bearing claim in this research, in one table. "Measured" means a command was run in
this session and its exit code read directly; "Read" means a file was opened and quoted, not
executed; "Inferred" means reasoned from the above rather than directly observed.

| Claim | Status | Evidence |
|---|---|---|
| The listener commits (`389fd61`...`caa46c6`) exist on this branch, dated 2026-08-26, before `29-CONTEXT.md` (`5352277`, 2026-08-27 00:28) | **Measured** | `git log --format="%H %ad %s" --date=iso` |
| Nothing touched `packages/cloudflare/` between the merge (`9062710`) and `29-CONTEXT.md`'s capture | **Measured** | `git diff --stat 9062710..5352277 -- packages/cloudflare/` → empty |
| `.planning/HANDOFF.json` records "The listener is WRITTEN, not borrowed" as a decision, timestamped 38 minutes before `29-CONTEXT.md` | **Read** | `.planning/HANDOFF.json` `decisions[0]`, `timestamp` field |
| `.planning/.continue-here.md` records the hosted tier as built and deploy-gated | **Read** | file's `<current_state>` block |
| `websocket-connection.ts` is a hand-written class, not a copy of `websocket-to-conn.ts` | **Read** | full file read, compared against upstream |
| All four Phase-30-labeled listener requirements (`direction`, `remoteAddr`, `bufferedAmount` policy, hibernation) are implemented and wired | **Read** | `websocket-connection.ts`, `hibernatable-socket.ts`, `worker.ts` |
| 53 tests across 4 spec files pass | **Measured** | `npx vitest run --project node <4 files>`, EXIT=0, "53 passed (53)" |
| `wrangler deploy --dry-run` succeeds with no auth, no network resource created | **Measured** | run in this session, EXIT=0, no credential prompt |
| Bundle contains noise/kadDHT/circuitRelayServer, excludes diffieHellman/node:crypto, no dynamic-require trap | **Measured** | independent `grep -o` counts on the emitted `worker.js` in this session |
| Small count drift between frozen code comments (noise ×43) and this session's reading (noise ×50) | **Measured**, cause **inferred** | both counts independently taken; the drift's cause (ordinary commit churn) is inferred, not traced commit-by-commit |
| The open-question-1 guard's skip condition and that it no longer fires | **Read** (condition) + **Measured** (that it didn't skip in this run) | test source + this session's passing run with no skip output |
| `UNREACHABLE_CEILING` is currently 103, and its full history 71→74→80→84→87→97→103 | **Measured** | `grep -n "UNREACHABLE_CEILING = "` + read the file's own inline change log |
| These 103 rows close only on a real deploy, never from further local wiring | **Read** (the file states this as its own conclusion from a falsified prediction) | `reachability-guard.node.test.ts`'s own comment history |
| No wrangler CLI command or config-schema key covers billing alerts | **Measured** | `wrangler --help` output read; `grep -i "budget\|billing\|alert\|spend" config-schema.json` → EXIT=1, no match |
| `repeatingTask` recurses via `setTimeout`/`clearTimeout`, not a busy loop | **Measured** | `cat node_modules/@libp2p/utils/src/repeating-task.ts`, full source read |
| `AbstractMultiaddrConnection` itself never polls `bufferedAmount`; only `websocket-to-conn.ts`'s subclass does | **Measured** | `cat node_modules/@libp2p/utils/src/abstract-multiaddr-connection.ts`, full source read |
| `29-CONTEXT.md`'s decision was made without awareness of the above (A1) | **Inferred** | the decision document neither cites nor contradicts `HANDOFF.json`/`caa46c6`; it reads as unaware, but the owner's actual state of knowledge cannot be observed from the tree |
| A live `setTimeout`-recursion timer keeps a Durable Object "active" for billing the way an open socket does | **Unverified / inferred risk only** | not deployed this session; no official source measured against this specific mechanism |
| Whether workerd accepts close code 1012, whether `binaryType` may be set on a hibernatable socket, whether the alarm survives eviction, the cheapest eviction-forcing lever, the exact billing-alert dashboard/API surface | **Unverified** | all explicitly named as open in the existing code's own docblocks or in this research (Q7, Q8, Q10) |

---

## Open Questions

1. **Does the owner want to keep, or replace, the already-working listener?**
   - What we know: it exists, passes, and was hand-off-recorded as complete before
     `29-CONTEXT.md` was captured.
   - What's unclear: whether the 2026-08-27 vendoring decision was made with or without that
     knowledge.
   - Recommendation: ask before planning any listener-writing task; do not build in parallel
     with what's already there.

2. **What is the cheapest way to force a Durable Object eviction for criterion 2's test?**
   - What we know: eviction happens on inactivity or certain platform operations; §12 of the
     2026-08-24 consult observed one after a 6-minute idle non-hibernating connection, and §17
     after 15 minutes on a hibernating one.
   - What's unclear: whether there's a faster, deliberate trigger (e.g. a dashboard action)
     rather than waiting.
   - Recommendation: the owner runbook should budget real wall-clock wait time for this step
     unless a faster trigger is found at deploy time.

---

## The owner runbook

**Both remaining criteria are owner acts. This is the entire executable plan for them — nothing
here is a task an agent performs.**

### Step 1 — Billing alert (criterion 1), BEFORE any deploy
1. In the Cloudflare dashboard (or via the Notifications/Billing API — not `wrangler`, which has
   no surface for this, confirmed above), configure a budget alert at the owner's stated $15/month
   threshold.
2. **Capture the alert's configuration timestamp** — screenshot or API response showing when it
   was created. This is timestamp A.
3. Do not proceed to Step 2 until timestamp A is captured and saved.

### Step 2 — The one deploy (criterion 2's precondition)
1. From `packages/cloudflare/`, run the real deploy: `npx wrangler deploy` (no `--dry-run` — this
   is the owner's action, outside this session's permitted tool use).
2. **Capture the deploy's timestamp** (Version ID + `wrangler deployments list` timestamp, or the
   dashboard's own deployment log entry). This is timestamp B.
3. **Verify timestamp A precedes timestamp B.** A deploy log that predates the alert refutes
   criterion 1 outright — check this before treating criterion 1 as satisfied.
4. Note the resulting hostname: `<name>.<subdomain>.workers.dev` (the account's `workers_dev`
   subdomain, an account property — no second deploy is needed to learn it, per the "one deploy"
   decision already reflected in `wrangler.jsonc`).

### Step 3 — Criterion 2's evidence
1. **Cheap check, immediately after deploy:** `curl https://<name>.<subdomain>.workers.dev/self`
   → record `{ peerId, nodeKey }` as reading #1.
2. **Real check:** from an outside machine running Node/libp2p, dial
   `/dns4/<name>.<subdomain>.workers.dev/tcp/443/tls/ws/p2p/<peerId>`, complete identify, record
   the resolved `remotePeer` as reading #2 (must equal reading #1's `peerId`).
3. **Force or wait for an eviction** (exact fastest lever unverified — see Open Question 2), then
   repeat both checks as reading #3.
4. **Perform a second, real redeploy** (same one-deploy mechanism), then repeat both checks as
   reading #4.
5. Criterion 2 is satisfied only if all four readings return the identical `peerId`. Any
   divergence — especially readings #3/#4 differing from #1/#2 — fails the criterion and points
   back at `hosted-identity.ts`'s seed-persistence path for investigation.

---

## Sources

### Primary (HIGH confidence — read or measured directly in this session)
- `packages/cloudflare/src/{worker,websocket-connection,hibernatable-socket,hosted-libp2p,workerd-shims,do-datastore,hosted-object,hosted-identity}.ts` — read in full or in relevant part
- `packages/cloudflare/wrangler.jsonc` — read in full
- `packages/node/src/hosted-tier-deploy.node.test.ts` — read in full
- `packages/node/src/reachability-guard.node.test.ts` — grepped and read relevant sections
- `.planning/HANDOFF.json`, `.planning/.continue-here.md` — read in full
- `git log` / `git show` / `git diff --stat` against this exact branch (`feature/phase-29-hosted-tier-assembly-and-first-deploy`, HEAD `5352277`)
- `npx vitest run --project node <4 files>` — EXIT=0, 53/53 passing, run in this session
- `npx wrangler deploy --dry-run --outdir=<scratch>` — EXIT=0, run in this session, output independently grepped
- `node_modules/@libp2p/websockets/src/websocket-to-conn.ts` (109 lines) — read in full
- `node_modules/@libp2p/utils/src/abstract-multiaddr-connection.ts` (93 lines) — read in full, including `close()` lines 49-86 and the `writableNeedsDrain` check at line 73
- `node_modules/@libp2p/utils/src/repeating-task.ts` — read in full to confirm the `setTimeout`/`clearTimeout` recursion mechanism cited in Q1
- `node_modules/wrangler/config-schema.json`, `npx wrangler --help`, `npx wrangler deploy --help` — read/grepped directly

### Secondary (MEDIUM confidence — cited from this repo's own prior measurements, not re-verified by a real deploy this session)
- `.planning/consults/2026-08-24-cloudflare-as-a-fabric-node-measured.md` §7, §9, §12-17, §19
- `.planning/consults/2026-08-25-noise-diffiehellman-on-workerd-measured.md` §4-7
- `.planning/research/v2.0/ARCHITECTURE.md:478-518`, `.planning/research/v2.0/STACK.md:120-152`, `.planning/research/v2.0/PITFALLS.md`

### Tertiary (LOW confidence — named as unverified in this research)
- Whether a live, never-cancelled `setTimeout`-recursion timer (confirmed via `repeating-task.ts`'s own source) affects Durable Object billing the way an open socket does — the mechanism is measured, its billing consequence is not
- The exact eviction-forcing lever and exact billing-alert dashboard/API surface

## Metadata

**Confidence breakdown:**
- What exists in the tree and passes: HIGH — independently re-run, not just read
- What `29-CONTEXT.md` says remains: LOW as literally stated, HIGH that it needs reconciliation
- Owner-act evidence requirements: MEDIUM — the mechanism is clear, the exact dashboard/CLI
  screens are UNVERIFIED without touching the account

**Research date:** 2026-08-27
**Valid until:** Re-verify immediately if any further commits land on `packages/cloudflare/` —
this research's central claim is a snapshot of `HEAD 5352277` and will go stale the moment the
reconciliation conversation produces a code change.
