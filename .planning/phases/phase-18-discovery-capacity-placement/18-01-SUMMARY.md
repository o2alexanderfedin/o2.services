---
phase: phase-18-discovery-capacity-placement
plan: 01
subsystem: auth
tags: [libp2p, cli, certificates, peer-verification, admission, spawn-tests]

requires:
  - phase: phase-17-node-identity-enrollment/17-03
    provides: "the startup path: a node generates its identity, enrols via `--provider-addr`, and persists its certificate"
  - phase: phase-17-node-identity-enrollment/17-04
    provides: "`PeerVerifier`, `FabricNodeOptions.trustedIssuers`, and the gate — `RpcBlockSource` reads the verified subset"
provides:
  - "`--peer-addr` on `bin/agent.ts`, repeatable: a spawned agent can be told to dial a named peer, establishing an ongoing peering rather than a one-shot enrollment round trip"
  - "`peers` on the handshake line — the peer ids actually reached, read off each `Connection`, present as `[]` rather than absent"
  - "`--max-concurrent-tasks`, reaching `FabricNodeOptions.maxConcurrentTasks` unclamped, so a later phase can make a spawned agent's refusal certain rather than hope for it"
  - "AUTH-02's accepting half measured cross-process for the first time, with a same-wire negative control and a no-anchor control"
  - "A named refusal and a non-zero exit for a `--peer-addr` that cannot be dialled, with no handshake line"
affects: [phase-18-discovery-capacity-placement/18-02, phase-18-discovery-capacity-placement/18-04, phase-18-discovery-capacity-placement/18-05, phase-18-discovery-capacity-placement/18-08, phase-18-discovery-capacity-placement/18-11]

tech-stack:
  added: []
  patterns:
    - "Read the identity off the connection, never off the configured string: a peer id from a `Connection` is the peer reached, one parsed from argv is a claim about who was meant to be"
    - "A stated absence on the observable surface: `peers: []` is a statement that this process reached nobody, and an absent field would not be"
    - "Order a negative control after a positive one has succeeded, so 'not ready yet' stops being an available explanation for the negative"
    - "Refuse at the binary and leave the class's own guard reachable, rather than sanitising and producing a silently different node"

key-files:
  created:
    - packages/node/src/peer-dial.node.test.ts
    - .planning/phases/phase-18-discovery-capacity-placement/deferred-items.md
  modified:
    - packages/node/src/bin/agent.ts
    - packages/node/src/certificate-verification.node.test.ts

key-decisions:
  - "The dial runs after `start()` returns rather than becoming a `FabricNodeOptions` field: `relayAddrs` already occupies the factory position and means something else — it asks for a reservation and changes this node's whole reachability. A peer dial changes nothing about how this node is reachable."
  - "Acceptance is read from its consequence, not from a verdict. `verdictFor` does not cross a process boundary and this plan adds no frame that would carry one; the consequence — a block fetched from the accepted peer — is what the gate actually controls."
  - "No second validator for `--peer-addr`'s format. `multiaddr()` throws and the dial catch turns that into the same named refusal, so a hand-written parser would only sit beside libp2p's own and disagree with it eventually."
  - "The three-flag fold `bin/agent.ts` asks for is deliberately still not done, and the reason is now written into the file: three Phase 18 plans add a flag to that object in three waves."
  - "`node.stop()` before `refuse` is swallowed with `.catch(() => {})` — a rejecting stop would replace the named refusal with an unhandled rejection and a different exit code."

requirements-completed: [AUTH-02]

duration: 1h20m
completed: 2026-08-01
---

# Phase 18 Plan 01: A flag that dials a peer — Summary

**`bin/agent.ts` parsed eleven flags and none of them dialled a peer, so a node started by it
had zero peers and nothing in this phase could be exercised through it. It now has
`--peer-addr`, reports on its handshake line which peers it actually reached, and a spawned
node that pins a dialled peer's issuer accepts that peer — measured by executing a task whose
module and input exist in exactly one blockstore in the world, beside a node that pinned a
different issuer and failed the identical dispatch and a node that pinned nobody and
succeeded.**

## Performance

- **Duration:** ~1 h 20 min
- **Tasks:** 2 of 2
- **Files created:** 2 · **modified:** 2

## Commits

| Commit | Task | What |
|---|---|---|
| `edb21fa` | 1 | a flag that dials a peer, and one that states this node's slot limit |
| `9748608` | 2 | the accepting half of AUTH-02, across five processes |
| `bd6df2d` | 2 (Rule 1) | name the defect a refusal test is looking for, instead of timing out on it |

## Verification

| Check | Result |
|---|---|
| `npx tsc --noEmit` (repo root) | exit 0, against a resolver **proven** to read this worktree |
| `npx vitest run --project node peer-dial.node.test.ts` | 6 passed, stable over **5 consecutive runs** (10.1 – 15.2 s) |
| `npx vitest run --project node certificate-verification two-process` | 2 files, 5 passed — the regression bar the plan names |
| `npx vitest run --project node vocabulary.node.test.ts` (after committing) | 24 passed |
| `npm run test:node` (baseline, before any change) | 108 files, **1528 passed**, 19 skipped, **exit 0** |
| `npm run test:node` (after, first run) | 109 files, 1531 passed + 3 docker failures — see below |
| `npm run test:node` (after, re-run) | 109 files, **107 passed \| 2 skipped**, **1534 passed**, 19 skipped, **exit 0** |

**The delta against the baseline is exactly this plan's six tests** — 108 → 109 files,
1528 → 1534 passed — and no test changed status.

**The three failures in the first run are `tools/aot/lift.node.test.ts` losing docker under
load, not a regression.** All three read `expected 'docker-unavailable' to be …`. Docker was
**up** at the time (`docker info` succeeded; `docker ps` showed a live `o2-lift-…` container),
the file **passed 73 of 73 in isolation** immediately afterwards, and the **full-suite re-run
above is green with the identical tree**. Nothing in this plan is reachable from `tools/aot`.
Recorded as deferred item 2 with what would close it.

### The resolver proof, because a wholesale `node_modules` symlink is silently wrong

The main install's `@o2/*` entries are **relative** symlinks (`../../packages/core`), so
following them through a symlinked `node_modules` resolves back into the main checkout — `tsc`
and `vitest` would then verify the wrong tree and report clean without reading a line of these
changes. A farm was built instead: 184 third-party entries symlinked at the main install, and a
real `@o2` directory whose nine entries point at **this worktree's** packages by absolute path.
Proven with `createRequire` before anything was believed:

```
@o2/core    /Volumes/…/agent-afa51022ce0ef62f2/packages/core/src/index.ts
@o2/net     /Volumes/…/agent-afa51022ce0ef62f2/packages/net/src/index.ts
@o2/libp2p  /Volumes/…/agent-afa51022ce0ef62f2/packages/libp2p/src/index.ts
@o2/node    /Volumes/…/agent-afa51022ce0ef62f2/packages/node/src/index.ts
@o2/browser /Volumes/…/agent-afa51022ce0ef62f2/packages/browser/src/index.ts
```

The probe script was deleted afterwards.

## A setup finding that would have invalidated everything: the worktree was on the wrong base

**Found before any edit, and it is worth recording because nothing would have failed loudly.**
The worktree branch `worktree-agent-afa51022ce0ef62f2` was created from **`main`** (`c62bae5`),
not from `feature/phase-18-discovery-capacity-placement` (`f3b0d8c`). `git merge-base
--is-ancestor HEAD feature/phase-18-…` reported HEAD was **not** an ancestor.

The symptom that caught it: `bin/agent.ts` was **72 lines with four flags**, while the plan
describes eleven flags at `:52-180`. On `main` that file predates Phases 14, 15 and 17 entirely —
there is no `--trust-anchor`, no `--provider-addr`, no `--trusted-issuer`. Every one of the
plan's `file:line` citations would have been "stale", and the natural conclusion would have been
that the plan was wrong rather than that the checkout was.

Fixed by `git reset --hard feature/phase-18-discovery-capacity-placement` on a **verified clean
tree** (`git status --porcelain` returned zero lines first). After the reset `bin/agent.ts` is
322 lines and every citation resolves.

## What each task measured

### Task 1 — the two flags

`--peer-addr` is repeatable and dialled **after** `FabricNode.start` resolves and **before** the
handshake line is written, so a parent that has read the line knows every dial already
succeeded. The peer id pushed onto `peers` is read off the returned `Connection`, which is the
rule `fabric-node.ts:994-1000` already states for `relayPeerIds`.

`--max-concurrent-tasks` is validated against `LocalCapacity`'s own guard restated —
`Number.isInteger(n) && n >= 1` — so the binary and the class cannot disagree about which values
exist, and then threaded with the conditional-spread idiom so an absent flag adds no key at all
and the node takes `DEFAULT_MAX_CONCURRENT_TASKS` from `@o2/core` rather than a second copy of
the constant stated at the binary.

### Task 2 — five processes, three readings, one dispatch

`peer-dial.node.test.ts`, six tests. The load-bearing one spawns **P** (issues certificates),
**A** (enrolled under P), and three agents that differ from each other in exactly one argument:

| Agent | Pins | Dials | Outcome |
|---|---|---|---|
| **V** | P's issuer key | A | `ok: true`, output `{a: 1}` |
| **W** | a well-formed key nobody holds | A | `ok: false`, naming the module CID it could not fetch |
| **U** | nobody | A | `ok: true`, output `{a: 1}` |

The module and the input are written into A's directory with `FsBlockstore` **before A is
spawned**, so the bytes exist on exactly one node and the submitter — which computed the CIDs by
writing them there — holds neither. P is stopped and its death asserted before any verdict is
reached, so "the authority was still answering" is not an available explanation for V's
acceptance.

Both outcomes are read as the **echoed input**, not as a bare `ok`, so a node that answered
success without executing would not pass. W's failure is asserted **by text** — it names a block
that could not be fetched and the module CID — because a refusal naming the wrong thing is a
defect even when the dispatch correctly fails, and this dispatch could equally have failed for
want of provenance, for a dead process, or on a timeout.

The slot-limit test spawns two agents differing in one flag and sends each the same two
concurrent dispatches over **distinct `inputCid`s** — load-bearing, because the exec slot key is
derived from `inputCid` plus `partitionIndex` and one shared input would hit the dedupe branch
(`already in flight here`) instead of the over-committed branch under test. The one-slot agent
refuses exactly one with `over-committed: 1 of 1 slots in use`; the agent without the flag
answers both. `1 of 1` is the value that says the flag arrived — a node that ignored it would
say `1 of 64`.

## Every reddening claim, planted and watched

Nothing below is restated from the plan. Each row was written into the source, run, observed,
and reverted — with `git diff --stat` confirming an empty diff after each revert. `fabric-node.ts`
was mutated and restored by exact inverse edit, never by `git checkout`.

| # | Mutation | Where | Reddened | Failure observed |
|---|---|---|---|---|
| 1 | delete `peers.push(…)`, keep the dial | `bin/agent.ts` | the acceptance test | `expected [] to strictly equal [ Array(1) ]` — **at the `peers` precondition, first** |
| 2 | `node.dial(address)` → `(await node.dial(address), address)` | `bin/agent.ts` | the acceptance test | `expected [ Array(1) ] to strictly equal [ Array(1) ]` |
| 3 | `refuse(…)` in the dial catch → `continue` | `bin/agent.ts` | **both** refusal tests | `announced instead of refusing: {…,"peers":[]}` |
| 4 | drop the `maxConcurrentTasks` conditional spread | `bin/agent.ts` | the slot-limit test | `expected [ {ok:true}, …(1) ] to have a length of 1 but got 2` |
| 5 | the check → `Math.max(1, Number(…))` | `bin/agent.ts` | **both** slot-refusal tests | `announced instead of refusing` (0 clamped to 1); `expected 1 to be 2` |
| 6 | thunk → `() => transport.peers` | `fabric-node.ts:1138` | the acceptance test | `expected true to be false` — **W succeeded** |

**All six held.** Three carry more than their own weight:

- **#1 fails at the `peers` assertion before the dispatch**, which is exactly what the plan
  claimed the ordering would buy: a reader of a red run learns *"never connected"* rather than
  *"block not found"*.
- **#6 is Plan 17-05's Mutation A re-read across a process boundary**, and it is the one that
  proves this file measures the **gate** rather than the dial. With the gate reverted, W — which
  dialled the same peer and pins a different issuer — fetches the block and succeeds, and the
  three readings collapse into one.
- **#5 demonstrates why the clamp is forbidden rather than merely disliked.** With
  `Math.max(1, …)`, `--max-concurrent-tasks 0` starts a node with one slot and announces
  normally: an operator's mistake became a silently different node, which is precisely what
  `fabric-node.ts:352-355` says the guard exists to prevent.

## Findings — what the plan got wrong

### 1. The rationale for the "reading, not an echo" claim is FALSE

> *"`peers` holds A's **peer id**, which is never a substring of the multiaddr the test passed
> unless the test built it that way"*

**Measured:** a `FabricNode`'s advertised address is
`/ip4/127.0.0.1/tcp/52337/p2p/12D3KooWAST72kif2tK24PVMs6bLCbunQZ9di9FGCjkUHo1schj5`. The peer id
**is** a substring of the multiaddr, always, because `getMultiaddrs()` appends `/p2p/<peerId>`.

The claim's *conclusion* survives and the mutation still reddens — but for a different reason
than the plan gives. The assertion discriminates because it compares against the **bare** peer
id with `toStrictEqual`, which an echo of the whole address string cannot satisfy. It does
**not** discriminate because the id is absent from the address. The test comment now says the
accurate thing, so the next reader does not repeat the false version.

### 2. Two stale `until`-helper citations, already corrected once and copied forward anyway

| Plan says | Actually |
|---|---|
| `relaying.node.test.ts:80` | **`:89`** |
| `rendezvous-wire.node.test.ts:77` | **`:89`** |
| `relayed-job.node.test.ts:35` | `:35` — correct |

These are notable not because they are wrong but because **17-04-SUMMARY.md already recorded
both of these exact corrections**, and 18-01-PLAN.md reproduces the pre-correction numbers. A
correction written into a summary does not propagate into the next phase's plans on its own.

### 3. The plan's design leaves a verdict race it does not name — corrected in the test

The plan says V's and W's readings are made safe by asserting `peers` on the handshake line,
*"this is the precondition `peer-gate.node.test.ts` asserts with a poll and this test gets for
free from the line's ordering."*

The line's ordering proves the **connection**, not the **verdict**. A verdict is an asynchronous
records round trip kicked off from `peer:connect`; V's `verifiedPeers` is empty until it lands,
so a dispatch that arrives first reads `ok: false` and the acceptance half becomes a flake — the
exact failure shape `peer-gate.node.test.ts` polls to avoid.

Corrected two ways, both stronger than the plan:

1. **V's reading is taken under a poll** with a stated deadline, which is sound rather than a
   workaround for a reason the source states in advance — `fabric-node.ts:1133-1137`: the block
   source is a thunk read *per fetch*, so *"a retry after the verdict lands succeeds without
   reconnecting and with no invalidation step anywhere."*
2. **W's and U's readings are taken after V's has succeeded.** W dialled A in the same window V
   did, so a verdict that has demonstrably landed on V has had at least as long to land on W —
   which removes "W was not ready yet" as an explanation for W's failure. Neither W nor U is
   itself racy (W is fail-closed both before and after its verdict; U short-circuits and needs
   no verdict at all), so only one reading needed the poll.

**Measured stable over five consecutive runs**, 10.1 – 15.2 s.

### 4. Citations verified correct

Every other `file:line` in the plan was re-read against source before being relied on:
`bin/agent.ts:52-180`, `:19-44`, `:74-78`, `:99-108`, `:182-219`, `:215-219`, `:300-309`;
`fabric-node.ts:333-356`, `:352-355`, `:537`, `:887-905`, `:994-1000`, `:1100-1140`, `:1118-1123`,
`:1138`, `:1313-1334`, `:1320-1334`, `:1415-1419`. The eleven-flag count is correct. 18-CONTEXT's
`net/src/agent.ts:729-730` and `:817` are correct.

## Deviations from Plan

### Auto-fixed

**1. [Rule 1 — Bug] `spawnRefusal`'s comment promised a fast named failure it did not deliver**

- **Found during:** planting reddening claim #3.
- **Issue:** the helper's own doc said it *"rejects if the process announces instead — so 'it
  started anyway' is a named failure rather than a hang"*. It only watched for `exit`, so the
  mutation these two tests exist to catch produced **two 60 006 ms anonymous timeouts** naming
  no step. A guard whose red run says nothing is most of a guard missing.
- **Fix:** watch stdout for a whole handshake line and fail immediately, quoting it.
- **Measured:** 60 006 ms anonymous timeout → **409 ms** failure reading
  `agent unreachable announced instead of refusing: {…,"peers":[]}` — the exact silent absence
  the refusal exists to prevent, now visible in the failure message.
- **Files:** `packages/node/src/peer-dial.node.test.ts` · **Commit:** `bd6df2d`

**2. [Rule 2 — Missing critical functionality] `await node.stop()` before `refuse` is swallowed**

- **Issue:** the plan's code is a bare `await node.stop()`. `refuse` calls `process.exit(2)`, and
  a `stop()` that itself rejects would replace the named refusal with an unhandled rejection and
  a **different exit code** — turning *"the address could not be dialled"* into no statement at
  all, which is the one thing this branch exists to produce.
- **Fix:** `await node.stop().catch(() => {})`, with the reason in the comment beside it.
  Shutdown is best-effort here; the refusal is not.
- **Files:** `packages/node/src/bin/agent.ts` · **Commit:** `edb21fa`

### Departures from the plan's letter, each with its reason

**3. Three tests beyond the plan's list.** The plan names one acceptance test and describes the
refusal paths only inside its `<proof>` block. Written as tests instead: a malformed multiaddr
(which is the *only* thing that proves "there is no second format validator" is a statement
about behaviour rather than about source), and a non-integer `--max-concurrent-tasks` (`Number`
reads `plenty` as NaN, a different way of being wrong from `0` being out of range).

**4. The dispatch order is W and U *after* V, not the plan's implied parallel pair.** Reason in
finding 3 above.

**5. `expect(a.peers).toStrictEqual([])` on the dialling-nobody agent.** Not in the plan.
`toEqual` treats `undefined` as `[]`, so only `toStrictEqual` can tell a stated absence from an
absent field — which is the whole of the rule the module comment states for `certificate` and
`issuerKey` and now for `peers`.

**No existing assertion was weakened, altered or deleted.** The only change to an existing test
file is `certificate-verification.node.test.ts`'s **header prose**, updating the two places that
record the accepting half as UNMEASURED to name the file that now measures it. Both files are
retained: this one kills both authorities before any verdict, which the cross-process file does
not do for its no-anchor control.

## Limits, in the words the plan requires

- ***Gating anything other than the block source on `verifiedPeers` is UNMEASURED, not
  descoped.*** `RpcBlockSource.fetch` is still the only production consumer of `verifiedPeers`
  there is, so *"accepts that peer"* means block fetching and nothing else. Dispatch candidate
  selection and quorum membership remain ungated; Plan 18-05 adds the first production caller
  for candidate selection and it is that plan's decision to state whether it reads the verified
  subset.
- ***The slot limit's placement consequence is not measured here.*** This plan measures only
  that a spawned agent given `--max-concurrent-tasks 1` refuses with `over-committed: 1 of 1
  slots in use`. Publishing `{slots, inFlight}` in an offer answer is 18-04's, and a requestor
  bounding its own placement across shards is 18-06's.
- ***`--relay-addr` and reservation-failure reporting are not in this plan*** — NET-05, Plan
  18-11. `--peer-addr` deliberately does **not** ask for a reservation; the two are two
  mechanisms and get two flags.

## ALL NODES HAVE EQUAL FUNCTIONALITY — checked by mechanism, not by vocabulary

Both new flags are **per-node settings**, and nothing anywhere branches on either. Grepped for
the mechanism rather than the word: no `if` was added on any node attribute, `peers` is built by
one unconditional loop over whatever addresses were passed, and `maxConcurrentTasks` reaches
`LocalCapacity` as a number. A node given `--peer-addr` and a node not given it differ in what
they **did**, never in what they can do — being dialled and dialling are the same protocol seen
from its two ends. The three agents in the acceptance test are the demonstration: identical
binaries, identical capability, one argument apart, and the argument changes which peers each
one accepts rather than what any of them is.

`--max-concurrent-tasks` is the same statement about capacity: a node with one slot serves
exactly the same requests as one with sixty-four and just holds fewer at a time. The one-slot
agent in the slot test **runs one of the two dispatches** — it is not a node that refuses work,
it is a node that is busy.

## An optional hook with a silent default is a hole — where that applies here

No new `FabricNodeOptions` field was added, so no new optional hook exists to leave a silent
default in. The discipline applies instead at the observable surface: `--peer-addr`'s absence is
reported as `peers: []` on the handshake line rather than by omitting the field, because *"an
absent field and a stated absence read identically to `JSON.parse`, and only one of them is a
statement."* `--max-concurrent-tasks`'s absence adds **no key at all** to the `FabricNode.start`
call, so the node takes the shipped constant rather than a second copy of it stated here.

## Known stubs

None.

## Deferred items

Recorded in `.planning/phases/phase-18-discovery-capacity-placement/deferred-items.md`:

1. **`SLOW_NODE_SPECS` is stale against its own stated 1 s rule.** `peer-dial.node.test.ts` runs
   ~10–15 s and spawns eight agent processes, so by that rule it belongs in the list. Not added,
   because the list was derived when `test:unit` ran 66 files in 6.46 s and it now runs **98
   files in 25.31 s** — many files from phases 15–17 are also above the cut and also absent, so
   adding only the newest makes the list look maintained without making it honest.
2. **`tools/aot/lift.node.test.ts` loses docker under full-suite load**, measured above.

## Threat flags

None. Both new flags carry public values — a multiaddr and an integer — and the module comment's
standing rule that no flag on this binary accepts key material is unchanged and now restated for
`--peer-addr`. `peers` publishes peer ids, which are derived from public keys and are already
printed by every node in this repository. No new network endpoint, wire frame, auth path, file
access pattern or schema at a trust boundary was introduced: `FabricNode.dial` and the `records`
request both predate this plan, and this plan supplies a caller for the first from a binary that
had none.

## Self-Check: PASSED

Files claimed created, listed off disk:

```
FOUND  packages/node/src/peer-dial.node.test.ts                          27238 bytes   592 lines
FOUND  .planning/phases/phase-18-…/deferred-items.md
FOUND  .planning/phases/phase-18-…/18-01-SUMMARY.md
```

Files claimed modified: `packages/node/src/bin/agent.ts` (322 → **458** lines),
`packages/node/src/certificate-verification.node.test.ts` (header prose only, no assertion
changes).

Commits claimed, found in `git log --oneline`:

```
FOUND  bd6df2d  test(18-01): name the defect a refusal test is looking for, instead of timing out on it
FOUND  9748608  test(18-01): the accepting half of AUTH-02, across five processes
FOUND  edb21fa  feat(18-01): a flag that dials a peer, and one that states this node's slot limit
```

No commit in this plan deleted a tracked file: `git diff --diff-filter=D --name-only HEAD~1 HEAD`
was run after each and returned empty every time.
