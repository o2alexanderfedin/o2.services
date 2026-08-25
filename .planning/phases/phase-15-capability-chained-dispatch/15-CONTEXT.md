# Phase 15: Capability-Chained Dispatch - Context

> **Numbers in this document are configuration choices or measurements, not derived claims.
> Any quantity describing runtime behaviour must be measured before it is written down
> anywhere, including in a source comment.**

**Gathered:** 2026-07-28
**Status:** Ready for planning
**Mode:** Autonomous — every grey area below is resolved, with reasoning, from the
existing `capability.ts` API, the Phase 11 hook contract, and one property measured
against a running libp2p node rather than assumed (decision 1). Two consequences are
flagged rather than resolved: the four existing test files this phase's refusal will
break, and the fact that `delegate` still reaches no runnable entry point afterwards.

<domain>
## Phase Boundary

`verifyChain` (`packages/core/src/capability.ts:148`) and the whole delegation format
were built and fuzzed in Phase 4. Classified by grep, every reference to it today is
(a) its own definition, (b) a barrel re-export at `packages/core/src/index.ts:198`, or
(c) `packages/core/src/capability.test.ts`. **Zero production callers.** `delegate`
(`capability.ts:79`) is identical: definition, barrel, and two test files
(`capability.test.ts`, `packages/net/src/distributed.test.ts:609`). `describeFailure`
(`capability.ts:101`) is weaker still — barrel-exported, called only from inside
`verifyChain` itself at `capability.ts:152`, and reached from no test directly.

The wire already carries the field. `AgentRequest`'s `exec` variant declares
`capability?: readonly Delegation[]` (`packages/net/src/protocol.ts:56-61`), encodes it
at `:304-305`, and parses it — every field validated, a malformed link refusing the
whole frame rather than truncating — at `:422-433`. The only caller that has ever
populated it is `distributed.test.ts:628`, a round-trip encode/parse assertion.
`RemoteExecutor.execute` sends `encodeRequest({ kind: 'exec', task })`
(`packages/net/src/remote-executor.ts:39`) with no `capability` key at all.

The serving half is the same shape. `Authorizer` (`packages/net/src/agent.ts:61-64`) is
consulted before the executor at `agent.ts:215-225` — ordering that is the whole
"before instantiation" claim — and every production call site passes the sentinel:
`packages/node/src/fabric-node.ts:419`, `packages/browser/src/browser-node.ts:272`,
`packages/node/src/bin/bench.ts:152` and `:177`. The only real `Authorizer` functions in
the repository are `distributed.test.ts:534` and `:580`.

**In scope:** AUTH-03 — a chain minted by the requestor, attached by `RemoteExecutor`,
verified by a real `authorize` hook on a node started from `bin/agent.ts`, with the
refusal naming the link that broke.

**Out of scope:** signed module records (Phase 14 — a chain proves the *caller* may ask,
a `NameRecord` proves the *module* is the one the build authority meant to ship; they
compose, see `sovereignty-guard.ts:16-19`); node identity certificates and where the
owner's private key actually comes from (Phase 17, AUTH-01/02/04); `remoteDispatch`
(`packages/net/src/churn.ts:51`), the second `exec` sender in the repo, which has no
production caller today and belongs to the churn phase; discovery (Phase 18).
</domain>

<decisions>
## Implementation Decisions

### 1. The audience key is derived from the libp2p peer id — no new key material, no new wire message

`VerifyOptions.audience` (`capability.ts:132-133`) is an ed25519 public key in hex, and
the chain must end by delegating to *this node*. Nothing in the repository derives such
a key today — `grep publicKey packages/*/src` returns nothing outside tests.

**Measured, not assumed.** Against a real `createLibp2p` node built with this repo's own
module set: `peerId.type === 'Ed25519'`, `peerId.publicKey.raw` is 32 bytes, and
`peerIdFromString(peerId.toString()).publicKey.raw` returns the byte-identical key. So
both ends compute the same `PublicKeyHex` from a string they already exchange — the
serving node from its own `libp2p.peerId`, the requestor from the `nodeId` it already
passes to `new RemoteExecutor(nodeId, rpc)`. No enrollment, no new protocol request, no
key file.

The helper belongs in `@o2/libp2p`, which already imports `peerIdFromString`
(`packages/libp2p/src/libp2p-transport.ts:29`) and is the middle tier both `@o2/node` and
`@o2/browser` depend on. It must **refuse loudly** when `publicKey` is absent or
`type !== 'Ed25519'` rather than return something `verifyChain` will silently reject with
`wrong-audience` — an RSA identity would otherwise present as a capability failure.

*Assumption, labelled:* the browser tier's `createLibp2p`
(`packages/browser/src/browser-node.ts:196-205`) takes the same default. It is the same
function with no `privateKey` option, so it should; verify it in the browser project
rather than inheriting the Node measurement.

This binding is also the reason to prefer it: only the holder of that private key could
have completed the noise handshake as that peer id, so the chain's audience and the
authenticated transport identity are the same key by construction.

### 2. A chain is demanded for `label: 'sovereign'` tasks, and only those

AUTH-03 says the chain is *"rooted at the data owner's key"*. A `label: 'public'` task
has no owner (`ShardSpec`, `packages/core/src/job/submit.ts:29-31`) and therefore no root
key — demanding a chain for one would mean inventing an owner to root it at.

This keys on the **task's own label**, which is data that already crossed the wire and is
already the discriminator used by `guardSovereignty` (`sovereignty-guard.ts:53`) and by
`parseRequest`, which refuses an `exec` frame carrying no label at all
(`protocol.ts:409-410`). Every node runs the byte-identical authorizer; nothing here reads
what kind of node anything is.

It also keeps `bin/bench.ts` — which dispatches `label: 'public'` shards exclusively
(`bench.ts:270`) — and the demo's colouring job on their current path, so the scaling
curve is not silently re-measured against a new per-dispatch verification cost.

### 3. The chain rides on `RemoteExecutor`, as a required third constructor argument with a named sentinel

`Executor.execute(task)` (`packages/core/src/ports.ts:56-`) takes a `Task` and nothing
else, and `submitJob` calls `executeVerified(task, selectedExecutors)`
(`submit.ts:237`) with no channel for extra per-dispatch data. Widening the kernel port
to carry an `@o2/net` concern is the wrong direction and
`purity.node.test.ts:284` — *"has no dependency edge from `@o2/core` to any adapter
package"* — exists to keep it that way.
**Citation corrected 2026-08-25 (audit finding F-17, raised by `15-VERIFICATION.md:26`).**
It read `purity.node.test.ts:167-174`, which is the docblock and body of `violationsIn()`,
a helper that renders forbidden imports in one file's source and says nothing about
`Executor`, capability chains or a port. The claim above is sound and its evidence was
misfiled; the line now cited is the case that actually holds it. Note what is still true
and was true when the verification raised this: **no test asserts that the `Executor` port
carries no chain** — the dependency-direction rule forbids the import that would be needed,
which is a different and weaker statement.

`RemoteExecutor` is already one instance per remote node — exactly the granularity
`audience` needs, since a chain minted for node A is refused at node B with
`wrong-audience` (`capability.ts:203-205`). So the chain is construction state on the
adapter, alongside `nodeId`.

**Supplier, not a fixed array:** `(task: Task) => readonly Delegation[]`. One
`RemoteExecutor` serves every shard of a job, and shards may name different owners, so
the chain has to be selected per task. Thunks are this repository's house style for
exactly this reason — `RpcBlockSource`'s `peers` thunk (`agent.ts:38-42`) and
`AgentOptions.reservations` (`agent.ts:114`) are both thunks so the answer is live rather
than a snapshot.

**Required, with the sentinel `'dispatches-unauthenticated'`.** `.planning/PROJECT.md`'s
Key Decision *"An optional hook with a silent default is a hole"* (`PROJECT.md:235`) is
the whole reason this milestone exists, and an optional third argument reproduces the
defect precisely: a `RemoteExecutor` built without one would dispatch unauthenticated and
nothing would fail. Prove the omission is a compile error the same way Phase 11 did —
`packages/net/src/agent-contract.test.ts:52-103` is the pattern, `@ts-expect-error` per
omitted argument, which also fails loudly if the argument is ever widened back to
optional.

**Size the diff honestly: 44 `new RemoteExecutor(...)` sites** — measured, not estimated, by
`grep -rn "new RemoteExecutor(" packages --include="*.ts" | wc -l`, and re-measured with the
same command on 2026-07-29, still 44. Four are production
(`packages/browser/demo/main.ts:306` and `:549`, `packages/node/src/bin/bench.ts:187` and
`:222`); the rest are tests, concentrated in `distributed.test.ts` (7),
`fabric-node.node.test.ts` (7), `sovereign-execution.test.ts` (6),
`egress-manifest.node.test.ts` (5), `two-process.node.test.ts` (5),
`sovereignty-placement.node.test.ts` (3). Every test site takes the sentinel. Plan 15-02's
`<interfaces>` block carries the site-by-site enumeration and is the one home for that list;
re-grep rather than trusting either copy's line numbers.

### 4. The owner's public key is configuration on the existing `NodeSovereignty` record, not a second option

The serving node needs `VerifyOptions.ownerKey`. It must not learn it from the request —
a chain that carried its own root anchor would verify against itself.

Add `ownerKey?: PublicKeyHex` to `NodeSovereignty`
(`packages/core/src/executor/sovereignty-guard.ts:34-39`) rather than adding a sibling
`FabricNodeOptions` field. `ownerId` and `ownerKey` name the same owner and must never
disagree; 13-CONTEXT.md decision 2 already had to hoist the sovereignty default in both
factories precisely because two independently-defaulted copies can drift
(`fabric-node.ts:344-348`, `browser-node.ts:213-216`). One record, resolved once, feeding
`egress`, `guardSovereignty`, and now the authorizer.

`guardSovereignty` ignores the new field. Absent means **no pinned owner key**, and the
authorizer refuses every sovereign task naming that owner with a stated reason — the safe
default, consistent with `canExecuteSovereign: false`.

### 5. The authorizer is one named factory in `@o2/net`, with an injected clock

`authorizeCapability({ ownerId, ownerKey, audience, now })` returning an `Authorizer`.
`@o2/net` already imports `Delegation` from `@o2/core` (`agent.ts:16`) and owns the
`Authorizer` type (`agent.ts:61-64`), and this mirrors `registerSovereignInputs`
(`packages/net/src/sovereign-egress.ts`) — the DATA-05 analogue that is likewise a small
`@o2/net` adapter both node factories compose.

`now: () => number`, supplied as `Date.now` by both factories. `verifyChain` takes `now`
as a value and states why: *"Injected so verification is deterministic in tests and has
no clock port"* (`capability.ts:135`). A thunk keeps that property one layer up, so the
expiry branch is testable against a frozen clock instead of a sleep.

Everything here is `@noble/curves` ed25519 — pure JS, no `crypto.subtle`, which is why
`capability.test.ts` already runs in the browser project (`vitest.config.ts`'s `browser`
project includes `packages/*/src/**/*.test.ts` with no suffix exclusion for it). The
kernel's "never require a secure context" constraint is satisfied by construction, not by
a check.

Refusal precedence inside the authorizer, all reasons naming the owner or the link:
1. task is not `sovereign` → `null`, unchanged behaviour;
2. no `ownerKey` pinned, or `task.ownerId !== node.ownerId` → refuse, naming the owner
   asked for and the owner this node is pinned to;
3. otherwise `verifyChain(capability, { ownerKey, ownerId: task.ownerId, audience,
   ability: 'execute', now: now() })` and return `result.reason` verbatim on failure.

### 6. `bin/agent.ts` gains `--owner-key <hex>`

Alongside `--owner-id` and `--can-execute-sovereign` (`packages/node/src/bin/agent.ts:22-35`),
threaded into the same optional `sovereignty` object at `:47-54`, with the usage string at
`:39` updated. A **public** key on a command line is fine; nothing here ever accepts a
private one, matching `enrollment.ts`'s stated rule (`enrollment.ts:8-11`).

14-CONTEXT.md Risk 3 already flagged flag accretion and proposed `--trust-anchor` for
Phase 14. Phase 15 does not depend on Phase 14 and must not block on it: add the flag,
note the collision, and leave a combined flags-object refactor to whichever phase lands
second.

### 7. Both factories are wired; the criteria are proven on the Node tier

All three success criteria name `bin/agent.ts`, so the evidence is Node-tier. Wire
`browser-node.ts:264-278` identically anyway — leaving the browser on the sentinel would
reintroduce exactly the two-disjoint-capability-sets shape whose deletion the
`fabric-node.ts:16-33` module comment records, and it costs one argument.

Consequence to plan for: `packages/node/src/serve-agent-hooks.node.test.ts:28` and `:38`
assert `occurrences(FABRIC_NODE, "'serves-unauthenticated'") === 1` and the same for
`BROWSER_NODE`. Both become `0`. `bench.ts` stays at `2` (`:47-54`), because decision 2
leaves the public-only benchmark unauthorized-by-declaration. That file is the milestone's
burn-down count; update it deliberately, in the same commit, not as a follow-up fix.

### 8. Criterion 3's chains are `capability.test.ts`'s existing shapes, lifted onto the wire

`directChain()` (`capability.test.ts:28-30`) and `delegatedChain()` (`:33-41`) already
build owner→executor and owner→intermediate→executor with seeded keys
(`keypair(seed)`, `:12-15`). The broken-delegation case has two distinct existing forms
and the phase should use the one that isolates *depth*:
- **`broken-link`** (`capability.test.ts:102-118`): alice delegates to the coordinator,
  mallory issues link 1. `verifyChain` returns `broken-link` at index 1.
- **`not-delegable`** (`:165-174`): alice grants the coordinator `execute` but not
  `delegate`; the coordinator re-delegates anyway. Refused at `capability.ts:193-198`.

Use `not-delegable`. It is the sharper proof of criterion 3's *"delegation depth is
checked and not merely the chain's presence"*: both chains are length 2, both parse, both
are signature-valid, and they differ in exactly one ability string. A check that counted
links would accept both.

**Amended 2026-07-28 — use both, not one.** The reasoning above is right about which chain
proves *depth* most sharply and wrong to conclude the other can be dropped. `broken-link`
is not a paraphrase in this repository, it is a named `ChainFailure` kind (`capability.ts:92`)
with its own message (`:107-108`) reached at `:162-167`, and it is the kind ROADMAP
criterion 3 names in its own words — *"a chain with a broken delegation link is refused"*.
Verified by grep: `broken-link` occurs in `capability.ts` and in `capability.test.ts:102-118`
and nowhere else, so with only `not-delegable` dispatched, the kind the criterion literally
names would never cross a wire, never appear in a refusal a requestor reads, and have no
cross-process evidence at all — and an auditor checking criterion 3 against the source would
correctly conclude it was answered with a different mechanism. Plan 15-03 adds
`brokenLinkChainFor` to the node-tier fixture and Plan 15-04 dispatches **three** chains in
`it` 3. All three are length 2 and all three parse, so the depth argument is strengthened
rather than diluted: one accepted and two refused for two different named reasons is a
sharper reading than one and one.

### 9. The refusal reaches the requestor unchanged, with no protocol change

`agent.ts:222-225` returns `{ ok: false, reason: 'unauthorized: ' + refusal }`;
`RemoteExecutor` returns `response.outcome` verbatim (`remote-executor.ts:57`). So the
submitter reads `describeFailure`'s own text — e.g. *"link 1 was re-delegated, but its
issuer was never granted \"delegate\""* (`capability.ts:118`) — prefixed with
`unauthorized:`. Do not reword these messages to make an assertion pass.

This refusal is observable where DATA-05's is not, and the reason is structural: the
authorizer refuses *before* `executor.execute`, so `registerSovereignInputs` never runs
and the reply frame is scanned against nothing. Phase 13.1's criterion 6 (a sovereignty
refusal arriving as an RPC timeout) does not apply here, and the plan should say so rather
than leave a reader to wonder.
</decisions>

<code_context>
## Existing Code Insights

### The mechanism, complete and unreached
- `packages/core/src/capability.ts:52-60` — `Delegation {issuer, audience, ownerId,
  abilities, expiresAt, signature}`. `expiresAt` is absolute Unix ms, *"so it cannot
  drift"* (`:57`).
- `capability.ts:63-76` — `payloadOf` sorts `abilities` before encoding, so two callers
  listing the same abilities in a different order produce the same signature. The wire's
  `delegationToValue` (`protocol.ts:308-318`) does **not** sort — it copies as-is, and
  round-trip fidelity is what `distributed.test.ts:606-635` proves. Verification
  re-derives the payload, so ordering survives; do not "fix" either side.
- `capability.ts:148-210` — `verifyChain`. Checks in order: non-empty, root issuer,
  owner scope, signature, expiry, ability, `delegate` on the previous link, and finally
  that the chain ends at `options.audience`. Returns `expiresAt = Math.min(...)` over the
  chain (`:208-209`) — a long-lived tail cannot extend a short-lived root.
- `capability.ts:89-98` — the nine `ChainFailure` kinds; `:101-122` — `describeFailure`,
  every message carrying an index.

### The wire slot, plumbed and unpopulated
- `packages/net/src/protocol.ts:56-61` — the `exec` variant with `capability?`.
- `:304-305` — encoded only when present, so today's frames are byte-identical to
  pre-Phase-15 ones.
- `:320-336` — `parseDelegation`, every field typed; `:426-431` — one bad link refuses
  the whole request rather than truncating to a prefix that happens to verify.

### The hook, explicit since Phase 11 and still a sentinel everywhere
- `packages/net/src/agent.ts:61-64` — `Authorizer`.
- `:72-78` — the doc already names AUTH-03 and says the hook is consulted *before* the
  executor.
- `:211-231` — the `try` that turns a throw into a named outcome; `:215-221` the
  authorize call, `:222-225` the two-branch outcome. `onDispatch` fires earlier, at
  `:202`, so a refused dispatch is still counted as a dispatch.
- Production sentinels: `fabric-node.ts:419`, `browser-node.ts:272`, `bench.ts:152`,
  `bench.ts:177`. Test authorizers: `distributed.test.ts:534` (refuses an empty chain,
  asserts `executed === 0`), `:580` (accepts everything).

### Where the wiring lands in the two factories
- `packages/node/src/fabric-node.ts:344-355` — `transport`, then the once-resolved
  `sovereignty` (`:348`), then `egress` (`:351`), then `rpc` over the guard (`:352`).
- `:376-379` — `registerSovereignInputs(guardSovereignty(new WasmExecutor(...),
  sovereignty), {blockstore: store, guard: egress})`. The authorizer is **not** another
  layer here; it is a `serveAgent` argument at `:411-425`.
- `packages/browser/src/browser-node.ts:216`, `:219`, `:220`, `:256-262`, `:264-278` —
  the identical sequence, with `GovernedExecutor` outermost.

### `bin/agent.ts` — the entry point all three criteria name
`packages/node/src/bin/agent.ts:22-35` parses `--dir`, `--port`, `--owner-id`,
`--can-execute-sovereign`; `:44-55` starts the node; `:58` writes the one-line address
handshake the parent waits on. It **serves only** — it never calls `submitJob`, so the
submitter in any spawn test is a `FabricNode` in the test process. That is not a
weakening of "through `bin/agent.ts`"; `egress-refusal.node.test.ts:26-29` states the
position explicitly and Phase 13 was verified on it.

### The spawn-test harness to copy verbatim
`packages/node/src/egress-refusal.node.test.ts` is the closest analogue and the newest:
- `:45` `AGENT` path, `:62-95` `spawnAgent(name, extraArgs)` with the handshake wait,
  `:120-133` `stopAgent` with SIGTERM-then-SIGKILL, `:148-156` temp-dir lifecycle.
- `:109-117` a submitter with a *deliberately chosen* RPC budget and a written reason.
- `:243-244` asserts the child is still alive after the refusal — without it, "the process
  died mid-dispatch" explains the failure equally well.
- `:252-269` a **control job through the same two processes, ordered after the refusal**,
  changing exactly one argument. Phase 15 needs the same structure with the chain as the
  changed argument.

`packages/node/src/sovereignty-placement.node.test.ts:136` shows the flag form
(`spawnAgent('alice', ['--owner-id', 'alice', '--can-execute-sovereign'])`) that gains
`'--owner-key', <hex>`.

### The four files this phase's refusal will break
Each dispatches a sovereign task through a `FabricNode` that currently serves
unauthenticated:
- `packages/node/src/fabric-node.node.test.ts:228-264` — DATA-09. `:262-263` expects a
  cleared node to **accept**; it will now refuse for want of a chain. `:259-260` expects
  the uncleared node's reason to contain `'sovereignty'`; after this phase `authorize`
  fires first and the reason names the missing owner-key pin instead. Both assertions
  change. Do not reword the refusal to satisfy the old string.
- `packages/node/src/egress-manifest.node.test.ts:146`, `:210`, `:256`, `:325` — four
  sovereign submits through in-process `FabricNode`s started at `:107`, `:241`, `:310`.
- `packages/node/src/egress-refusal.node.test.ts:216` (expects failure — will still fail,
  but for a *different* reason, which silently invalidates the test) and `:255` (the
  control, expects `agreed`).
- `packages/node/src/sovereignty-placement.node.test.ts:172`.

`@o2/net`'s sovereign suites are unaffected: `sovereign-execution.test.ts:119`, `:177`,
`:212`, `sovereign-egress.test.ts:87` and `submit-with-egress.test.ts:59`, `:84` all pass
`authorize: 'serves-unauthenticated'` to their own `serveAgent` calls.

### The instrument that already exists for "the module was never fetched"
`FabricNode` builds `rpc` over `egress` (`fabric-node.ts:351-355`), so **every** outbound
frame from the submitter is recorded — including block replies served back to a child.
`EgressEntry` is `{to, bytes, violation?}` (`packages/net/src/egress.ts:32-40`) and
`sliceManifest(guard, from)` (`packages/net/src/submit-with-egress.ts:56`) returns the
delta. Counting `entries.filter(e => e.to === child.peerId)` before and after a dispatch
is a real cross-process measurement of whether the child came back for the module.
</code_context>

<specifics>
## How each success criterion is measured

**Criterion 1 — "carries a capability chain attached by `RemoteExecutor`, and the
receiving node's `authorize` hook verifies it before calling `WebAssembly.instantiate`."**

Two separable claims, two instruments.

*(a) The chain is attached and arrives intact.* Directly measurable in process: a
`serveAgent` whose `authorize` captures its `capability` argument and compares it to the
minted chain, driven through a real `RpcEndpoint` — `distributed.test.ts:509-566` is the
shape, with the capture replacing the counter. This proves attachment, encoding, and
parse together; the round-trip half is already pinned at `distributed.test.ts:606-635`.

*(b) Verification happens before instantiation.* **No instrument in this repository
observes `WebAssembly.instantiate` directly, and none should be invented.** The two
honest proxies:
- In process, against `bin/agent.ts`'s own code path minus the process boundary: a
  counting `Executor` stub, `expect(executed).toBe(0)` — `distributed.test.ts:519-526`,
  `:561`. This measures "the executor was never called", which is stronger than
  "instantiate was never reached", because `WasmExecutor.execute` (`wasm.ts:106`) is the
  only caller of `WebAssembly.instantiate` **on the `serveAgent` dispatch path**. Amended
  2026-07-28: the unqualified form of that sentence was wrong —
  `packages/aot/src/wasi-executor.ts:827` is a second caller in the repository, off this
  path. The qualifier is what makes the claim true, and the plans carry it.
- Across two spawned processes, where no stub can be installed: count the submitter's
  outbound frames to that child over the dispatch, using `sliceManifest`. Only the
  submitter holds the module (the property `two-process.node.test.ts:17-27` establishes),
  so a child that never came back for it never compiled anything. **Assert the two counts
  as a relation between readings, never against a literal, and record what was read.** No
  arithmetic deriving either figure belongs anywhere — not in a plan, not in a summary, not
  in a source comment. The roadmap's own Phase 13 amendment note (`ROADMAP.md:332-340`)
  exists because a byte figure was asserted rather than read.

If the planner wants a literal instantiate counter across a process boundary, say plainly
that it is unmeasured and would need a new hook; do not report the proxy as the thing.

**Criterion 2 — "no capability chain, or one that has expired, is refused before
instantiation, and the refusal names the missing or expired link, observable in the node's
response."**

Fully measurable, as a string, at the submitter. `outcome.reason` must be:
- absent chain → contains `no capability chain supplied` (`capability.ts:104`);
- expired → contains `expired at` **and** `link 0`, i.e. the index survives
  (`capability.ts:112`);
- both prefixed `unauthorized: ` by `agent.ts:225`.

The expiry case needs `expiresAt` in the past relative to the *child's* `Date.now()`.
Same machine, same clock — the testing standard makes this exact rather than approximate;
mint with `expiresAt: Date.now() - 1_000` and no sleep is required. "Before
instantiation" is measured as in criterion 1(b).

**Criterion 3 — "a validly delegated sub-chain is accepted, and a chain with a broken
delegation link is refused, proving delegation depth is checked and not merely the chain's
presence."**

**Three** dispatches to the same live child — decision 8 **as amended**; the paragraph here
said two until 2026-07-29 and was the last place in the phase still saying it. One accepted
and two refused for two differently-named reasons, each differing from the accepted chain in
exactly one thing:
- accepted, `delegatedChainFor` → `outcome.ok === true` and the output equals the
  single-node reference;
- refused for depth, `undelegableChainFor`, which differs in exactly one ability string →
  `outcome.reason` contains `was re-delegated, but its issuer was never granted`
  (`capability.ts:118`);
- refused for a broken link, `brokenLinkChainFor`, whose link 1 is issued by a third party →
  `outcome.reason` contains `is issued by`, `delegated to` and `link 1`
  (`capability.ts:107-108`) — the failure kind ROADMAP criterion 3 names in its own words.

**The discriminating assertion is that all three chains have length 2 and all three parse**
— assert that explicitly, or the test proves only that a two-link chain sometimes fails.

**Mutation, per this project's standing pattern.** **Three** mutations, each planted,
watched fail, and reverted:
1. Drop the `capability` key in `RemoteExecutor.execute` — criterion 1 and 2's accepted
   cases must fail.
2. Replace the authorizer with `() => null` in `fabric-node.ts` — criterion 2 and 3's
   refusal cases must fail.
3. Replace the authorizer with `() => null` in `browser-node.ts` — **added 2026-07-29, and
   planted precisely because its result is expected to be thin.** No test in the repository
   constructs a `BrowserNode` and no sovereign task is dispatched to one anywhere in this
   phase, so whatever turns red *is* the measurement of how thin that tier's guard is. It is
   recorded as that measurement, not reported as a mutation caught, and nothing is added
   after the fact to make the capture look better.

Report which tests break, as observed, not as predicted — 13-05 recorded that a mutation
broke four tests where the plan named one, and reporting the observation is the house
rule. That rule governs the three expectations above too: they say what is expected, and
the summary says what happened.

**Vocabulary.** `packages/node/src/vocabulary.node.test.ts` scans every git-tracked file,
and this phase's subject matter sits one synonym away from a listed term. Read that file's
`BANNED` array before writing any plan or summary; write *delegation* or *capability
chain*. `CLAUDE.md`'s and `docs/p2p-native-cloud-design.md`'s exemptions are per-file and
do not extend here.

**Amended 2026-07-28 — "git-tracked" is load-bearing and was being read as "every file".**
`scanRepository()` enumerates with `execFileSync('git', ['ls-files', '-z'])`
(`vocabulary.node.test.ts:360`), which lists tracked files only. A file is therefore covered
once it is committed and **not before**, so running the test against an uncommitted file
proves nothing whatever about it. `.planning/ROADMAP.md` is tracked and *is* covered. Plan
15-04 Task 3 carries the manual check for whatever is not yet committed, and reports it as a
manual reading distinct from the test's, since the two cover different file sets.

**Amended 2026-07-29 — the uncovered half is now smaller than that amendment says, and the
amendment was stating a stale reading as a present fact.** Re-measured today:
`git status --short -- .planning/phases/phase-15-capability-chained-dispatch/` no longer
reports `??` for anything, and `git ls-files` on the same directory lists all five files. So
this CONTEXT and all four plans **are** tracked and **are** covered by the guard. What
remains invisible to it is every `15-0N-SUMMARY.md` this phase has yet to write, until they
are committed. The manual check in Plan 15-04 Task 3 stands unchanged — its subject is the
summaries, not the plans — and that task's own `??` reading, correct when it was taken, is
the one thing in this phase to re-run rather than quote.
</specifics>

<deferred>
## Deferred Ideas

- **Where the owner's private key comes from in a real deployment.** Phase 15 mints
  chains from seeded fixture keys, exactly as `capability.test.ts:12-20` does. The
  Argon2id-derived user key of design §3.9 and the provider-signed node certificate of
  AUTH-01/02 are Phase 17. This phase pins the *public* half by configuration and says so.
- **A capability chain on `remoteDispatch`** (`packages/net/src/churn.ts:51`) — the second
  `exec` sender. Barrel-exported, called only from `churn.test.ts`. It needs the identical
  treatment when the churn coordinator is wired; doing it now would wire a path nothing
  reaches.
- **Ability granularity beyond `execute`/`read`/`delegate`** (`capability.ts:49`, *"Coarse
  on purpose"*). Nothing in this phase needs a finer scope.
- **Revocation.** The format has expiry and no revocation list, deliberately. Out of
  scope; do not add one to satisfy a criterion that does not ask for it.
- **Verifying the chain's audience actually holds the key.** `verifyChain` compares the
  final audience as a string and never asks it to sign anything — decision 1 makes that
  binding real by deriving the audience from the noise-authenticated peer id, but a
  challenge-response proof of possession is Phase 17's `possessionChallenge`
  (`enrollment.ts:117`), not this phase's.
</deferred>

## Risks — flagged, not resolved

**1. `delegate` still reaches no runnable entry point after this phase, and Phase 22 will
say so.** Phase 22's criterion 1 (`ROADMAP.md:514`, in the entry at `:507-516`) requires every barrel-exported
capability to have a traced call path from one of five entry points: `bin/agent.ts`,
`bin/seed.ts`, `bin/bench.ts`, `tools/aot/cli.ts`, the browser demo. This phase makes
`verifyChain` reachable from `bin/agent.ts` (the serving side). It does **not** make
`delegate` reachable from anything, because the only two submitting entry points dispatch
public work: `bench.ts:270` (`label: 'public'`) and the demo's colouring job. The minting
side will live entirely in tests. Options, none free: give `bin/bench.ts` a sovereign leg
with a minted chain (changes what the benchmark measures); give the demo one (it has no
owner and no key); or accept that AUTH-03's requestor half is entry-point-unreachable and
record it as a known Phase 22 finding rather than letting Phase 22 discover it. **Decide
this in the plan, in writing.** It is the same class of defect the milestone exists to
remove, and shipping it silently would be worse than shipping it named.

**Decided 2026-07-28, third option, plus one thing this risk did not anticipate.** The
requestor half is accepted as entry-point-unreachable and recorded — in
`remote-executor.ts`'s class comment (Plan 15-02) and under Phase 22 in the roadmap (Plan
15-04 Task 3). What the risk missed is that ROADMAP Phase 15's own **goal** line says
*"both ends wired for the first time"*, which this decision makes false. So Plan 15-04
Task 3 also amends that line to say what is true — the serving end wired and verified end
to end, the requestor end wired to a required constructor argument that every production
call site declines — with an amendment note in the form the Phase 13 entry uses, recording
the declined `bin/bench.ts` sovereign leg and its real cost (`realFabric`'s workers carry no
sovereignty configuration at `bench.ts:209`; `memoryFabric`'s nodes serve on
`authorize: 'serves-unauthenticated'` at `:177`, so the leg would prove nothing there and
the two curves would stop measuring the same thing; six phases modify that file). A goal
line the phase's own summary contradicts is the same defect one level up.

**2. Four existing test files break, and one of them breaks quietly.** Enumerated in
`<code_context>` above. `egress-refusal.node.test.ts:216` is the dangerous one: it already
expects that submission to fail, so it will keep passing while measuring a completely
different refusal — the authorize refusal, not the egress one — and DATA-05's proof would
silently evaporate. Its assertions at `:228-239` (shard stalls at alice, exactly one
failure, `other` never tried) would still hold for the wrong reason. That file must gain a
valid chain so it keeps testing egress, and the change must be called out, not folded into
a bulk update.

**3. `fabric-node.node.test.ts:259-260`'s refusal string changes meaning.** After this
phase, an uncleared node refuses a sovereign task at `authorize` (missing owner-key pin)
before `guardSovereignty` ever runs, so DATA-09's own refusal path becomes unreachable
from that test. The DATA-09 proof needs a node that is *pinned and chained* but **not**
`canExecuteSovereign`, or the phase quietly removes an existing guarantee's only
production-path test.

**4. Phase 14 touches the same three files.** Both phases add a `bin/agent.ts` flag, both
extend the serving node's per-dispatch checks, and 14-CONTEXT.md decision 2 composes a new
executor adapter at `fabric-node.ts:376-379` and `browser-node.ts:256-262` — the same
lines decision 4 here modifies. They are independent in logic and adjacent in text.
Whichever lands second should re-grep rather than trust the line numbers in either context
document.

**5. `agent-contract.test.ts` covers `serveAgent`'s seven hooks and nothing covers
`RemoteExecutor`'s argument.** (Corrected 2026-07-29: this said *eight arguments*. The file
declares its own scope — `describe('AgentOptions requires all seven hooks — the compile-time
proof')` at `agent-contract.test.ts:42` — and carries exactly seven omission cases at
`:52-103`: `authorize`, `index`, `capacity`, `reservations`, `ledger`, `onDispatch`, `egress`.
`AgentOptions`' other three fields — `rpc`, `executor`, `blockstore` — are plain dependencies
with no sentinel and no omission case. Plan 15-02 carried the same wrong figure and is
corrected to match.) Decision 3 makes the dispatching side symmetric with the serving
side, but the compile-time proof only exists for one of them today. If the planner
downgrades decision 3 to an optional argument, say so explicitly and record that a
`RemoteExecutor` with no chain is a hole nothing will report — do not let it become the
default by omission.
