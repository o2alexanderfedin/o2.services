# Open deficiencies — o2.services

Audit taken on branch `develop` at `42d4784`, working tree clean, 2026-08-01.
Read-only: nothing in this sweep changed a source file.

**Every finding below was verified by opening the file.** Where a claim is quoted, it is
quoted from the current tree, not from a planning document. Categories that turned up
nothing are recorded as such in [Negative results](#negative-results) — that is a
finding too.

## Status — 2026-08-01, end of session

**28 of 33 closed and merged to `develop`.** The suite was green through every one of
them before the fix and after it, which is the point: each was something a passing suite
could not see, or saw and mislabelled.

| Group | Findings | State |
|---|---|---|
| Guard blindness | D11, D13, D19, D20 | closed — `test:mutations` was **red** when this audit was taken and is now 40/40 |
| Swallowed failures | D01, D02, D05, D08 | closed |
| AOT correctness | D03, D06, D07, D17 | closed — **D17 closed as already-fixed**, no gate added |
| Timing bounds | D12, D14, D15, D16, D18, D26 | closed |
| False claims | D23, D24, D25, D27–D32 | closed |

**Five open, each for a stated reason — none of them "we ran out of time":**

- **D09** — move `PeerVerifier` to `@o2/net`. **Deliberately not done.** Plan 18-02 recorded
  that it should not move until a browser node is given `trustedIssuers`, or it becomes an
  export with no traced call path from a browser entry point — which is exactly what Phase
  22's reachability guard is specified to fail on.
- **D10** — `bin/bench.ts` does not exit after a full run. Large, and it belongs with Phase 23.
- **D21** — the 18 real-artifact AOT tests are inert because their fixtures live in `/tmp`
  and are gone. Medium; needs a fixture-location decision, not a code fix.
- **D22** — AUTH-04's cost has never been measured against distinct user keys. **Scheduled to
  Phase 19 criterion 5 by owner ruling**, 2026-08-01. Do not close it here.
- **D33** — 29 dead exports and ~67 dormant ones. **Phase 18 is actively wiring several of
  them**, so deleting now would fight the milestone. Re-run after Phase 18 verifies.

Two corrections this audit's own numbers needed, found while closing it:

- The "22 built, not wired" figure it cites was wrong in five rows, all **understating**
  shipped work. The true split is **17 built-not-wired, 18 partial, 1 not started** — and
  `requirements-ledger.node.test.ts` now fails if a named symbol acquires a caller, so the
  rows cannot silently expire again.
- `SLOW_NODE_SPECS` is now **derived** from its own measurements rather than hand-listed. It
  cannot fully enforce itself: four runs of the same tree within an hour selected 23, 29, 28
  and 36 files, so the guard checks structure and a stated drift tolerance, not equality.

## What was run

| Command | Result |
|---|---|
| `npx tsc --noEmit` | **exit 0**, no diagnostics (own exit code, not a pipeline's) |
| `npx vitest run --project node --reporter=verbose` | **exit 0** — 109 files passed, 2 skipped; 1548 tests passed, 19 skipped; 286.69 s |
| `npx vitest run --project node purity vocabulary mutation-guard` | **exit 0** — 3 files, 97 tests, all pass, 846 ms |
| `npm run test:unit` | **exit 0** — 102 files, 1411 tests, **24.03 s** at load 9.06 |
| `npx vitest run --project node --reporter=json` | per-file spans, used for D23 |

No test fails today. Every finding below is something the passing suite cannot see, or
something it sees and mislabels.

---

## Summary

| id | severity | effort | one line | touches |
|---|---|---|---|---|
| D01 | correctness | small | A local blockstore write failure is reported as "that executor is gone" | `net/src/combine.ts` |
| D02 | correctness | small | The `#encode` throw documented as "fail loudly" is swallowed two lines away | `net/src/rpc.ts` |
| D03 | correctness | small | `o2-lift` can exit 0 having done nothing — the exact mode its own docblock calls the worst available | `tools/aot/cli.ts` |
| D04 | correctness | small | A corrupt certificate file is indistinguishable from never having enrolled | `node/src/identity-store.ts` |
| D05 | correctness | small | Six verify paths report a codec defect as a forgery verdict | `core/src/{enrollment,naming,capability,discovery}.ts` |
| D06 | correctness | small | Toolchain provenance degrades wholesale to `unknown` and the artifact still says `ok: true` | `tools/aot/lift.ts` |
| D07 | correctness | small | `disassembler-failed` is reported for a read failure the code has proved did not happen | `tools/aot/lift.ts` |
| D08 | correctness | small | Three worker entry points drop a `postMessage` rejection, turning a reply into a timeout | 3 worker files |
| D09 | correctness | medium | The browser tier structurally cannot verify peers, because `PeerVerifier` lives in `@o2/node` | `node/src/peer-verifier.ts`, both barrels |
| D10 | correctness | large | `bin/bench.ts` does not exit after a full run and can stall for tens of minutes | `node/src/bin/bench.ts` |
| D11 | guard-blind | small | Mutation ledger entries `B1`/`B2` record a signature one word off the test they name | `node/src/mutation-ledger.ts` |
| D12 | guard-blind | small | `churn.test.ts`'s 30 %-killed case asserts a negative over a set a wall-clock timeout can add to | `net/src/churn.test.ts` |
| D13 | guard-blind | small | `purity.node.test.ts` has no instrument check and does not scan the demo it ships | `node/src/purity.node.test.ts` |
| D14 | guard-blind | small | A 50 ms budget with neither population stated, running in three browser engines | `core/src/start-outcome.test.ts` |
| D15 | guard-blind | small | Two bounds derived by arithmetic from the constant under test | `browser/…/worker-executor.browser.test.ts`, `node/src/execution-deadline.node.test.ts` |
| D16 | guard-blind | small | A 1 s bound taken from requirement prose, nested inside its own 5 s wait | `node/src/background-tab.e2e.test.ts` |
| D17 | guard-blind | small | `lift.node.test.ts` has timing bounds and no load gate — 6 known failures at load ~45 | `tools/aot/lift.node.test.ts` |
| D18 | guard-blind | small | Three bounds name an upper population but never the fast one | `net/src/egress.test.ts`, `net/src/sovereign-egress.test.ts`, `node/src/transport-bounds.node.test.ts` |
| D19 | guard-blind | small | Two repo-scanning guards silently drop a file they cannot read | `node/src/{trust-anchors,acceptance-traceability}.node.test.ts` |
| D20 | guard-blind | medium | The cheap mutation guard never checks that a `signature` still matches anything | `node/src/mutation-ledger.ts`, `mutation-guard.node.test.ts` |
| D21 | guard-blind | medium | The 18 real-artifact AOT tests are inert because their fixtures live in `/tmp` | `packages/aot/src/*.real.node.test.ts` |
| D22 | guard-blind | medium | AUTH-04's per-owner limiter has never been measured against distinct user keys | `core/src/enrollment.ts` + a new spec |
| D23 | hygiene | small | `SLOW_NODE_SPECS` is stale — every number in its docblock is now false | `vitest.config.ts` |
| D24 | hygiene | small | `counting-executor.ts` claims a composition `browser-node.ts` explicitly does not use | `net/src/counting-executor.ts` |
| D25 | hygiene | small | Two comments claim `grantConsent` is the only way to open the gate; it is not | `browser/demo/main.ts`, `browser/src/tab-api.ts` |
| D26 | hygiene | small | "coordinator.ts reads `kind` in exactly one place" — it reads it in six | `net/src/churn.test.ts` |
| D27 | hygiene | small | Two exclusivity claims that are true only under a scope the sentence does not state | `core/…/module-provenance.ts`, `node/src/fabric-node.ts` |
| D28 | hygiene | small | The planning docs still carry the "neither vitest project" claim the source retired | `.planning/REQUIREMENTS.md`, `.planning/ROADMAP.md` |
| D29 | hygiene | small | `.continue-here.md`'s open-follow-ups list is stale in two entries | `.planning/.continue-here.md` |
| D30 | hygiene | small | Four low-consequence silent swallows | 4 files |
| D31 | hygiene | small | Nothing runs the cheap guards before a commit, and they scan tracked files only | `.githooks/pre-commit` |
| D32 | hygiene | small | Five of the 22 "Built, not wired" rows say a mechanism has no caller and it does | `.planning/REQUIREMENTS.md` |
| D33 | hygiene | medium | 29 dead exports, ~67 dormant ones, and a superseded worker module with no importer | many, one file each |

Counts: **10 correctness**, **12 guard-blind**, **11 hygiene** — 33 findings.

---

# CORRECTNESS

## D01 — a local blockstore failure is reported as "that executor is gone"

`remoteCombineDispatch` wraps its whole body in `catch { return null }`, and `null` is
defined by the interface to mean one specific thing.

**Evidence.** `packages/net/src/combine.ts:137-139`:

```ts
      await options.blockstore.put(reply.bytes)
      return response.resultCid
    } catch {
      return null
```

`packages/core/src/reduce.ts:263-266` defines the return:

> Resolving to `null` means that executor is gone — the caller falls through to the next
> in the rendezvous ranking and recomputes there.

The comment that authorises the wrapping, `combine.ts:74-78`, enumerates a body the code
has outgrown: *"The whole body is wrapped, which covers the RPC rejection **and** an
unparseable input CID string."* The body now also contains `await
options.blockstore.put(reply.bytes)` (`:136`) and `await blockCid(reply.bytes)` (`:128`).

**What is lost.** A local write failure — `FsBlockstore.put`'s `writeFile`/`rename` on
ENOSPC or EACCES (`packages/node/src/fs-blockstore.ts:80-82`), or a browser
`QuotaExceededError`. `executeReduce` (`reduce.ts:374-382`) then walks the entire
rendezvous ranking recomputing on every other executor, where the same local write fails
again, and finally reports every executor in the fabric as failed. A full disk is
reported as a dead fabric.

**Severity** correctness. **Effort** small.
**Closes it:** narrow the `try` to the remote call and the CID parse, or catch with a
binding and re-throw anything that is not an RPC/parse failure.
**Parallel-safe:** yes — `packages/net/src/combine.ts` only.

## D02 — the throw documented as "fail loudly" is swallowed two lines away

**Evidence.** `packages/net/src/rpc.ts:231-238`:

```ts
  #encode(frame: …): Uint8Array<ArrayBuffer> {
    const encoded = encodeCanonical(frame)
    if (!encoded.ok) {
      // A control frame that cannot be encoded is a programming error in this
      // package, not a peer's fault — fail loudly rather than send a partial frame.
      throw new Error(`rpc frame not encodable: ${JSON.stringify(encoded.error)}`)
```

`packages/net/src/rpc.ts:294-300` puts `#encode` inside the try and discards it:

```ts
    try {
      if (this.#closed) return
      await this.#transport.send(from, this.#encode({ k: 'res', id, body: reply }))
    } catch {
      // The requester will time out. Nothing useful to do here — and throwing
      // would surface inside the transport's delivery path.
    } finally {
```

The comment is written for a *send* failure and is correct about that. It does not cover
`#encode`, which is inside the same try and throws by design.

**What is lost.** A handler that produced a reply DAG-CBOR rejects (a non-finite number,
an `undefined`, a non-canonical type). "Fail loudly" becomes silence; the requestor gets
`RpcFailure{kind:'timeout'}` after the full budget (60 s in the demo tier), and a
reply-encoding bug is attributed to network latency. This module is pure and has no
logger, so nothing anywhere records it.

**Severity** correctness. **Effort** small.
**Closes it:** hoist the `#encode(...)` call above the `try`, or `catch (cause)` and
re-throw when the failure did not come from `transport.send`.
**Parallel-safe:** yes — `packages/net/src/rpc.ts` only. Note D26 also names
`churn.test.ts`, a different file.

## D03 — `o2-lift` can exit 0 having done nothing

**Evidence.** `tools/aot/cli.ts:158-176`. The docblock:

> …the failure mode of getting that wrong is the worst available: the command runs,
> prints nothing, and exits 0.

and the code that produces exactly that mode:

```ts
function invokedAsCommand(): boolean {
  const entry = process.argv[1]
  if (entry === undefined) return false
  try {
    return pathToFileURL(realpathSync(entry)).href === import.meta.url
  } catch {
    return false
  }
}

if (invokedAsCommand()) process.exitCode = await main(process.argv.slice(2))
```

If `realpathSync` throws — a dangling symlink in `node_modules/.bin`, `ELOOP`, `EACCES`
on a path component, `ENOTDIR` — `main()` is never called and `process.exitCode` is never
set. This matters more here than usual, because the repo's own rule is *"never trust an
exit code as evidence"* and this is a tool that produces one.

**Severity** correctness. **Effort** small.
**Closes it:** `catch (cause)` and re-throw, or compare the un-realpathed forms as a
fallback before giving up. A `false` return should be reachable only when `argv[1]`
genuinely names a different file.
**Parallel-safe:** yes — `tools/aot/cli.ts` only.

## D04 — a corrupt certificate is indistinguishable from never having enrolled

**Evidence.** `packages/node/src/identity-store.ts:139-151`. The ENOENT case is handled
precisely, and then the parse failure is collapsed into the same value:

```ts
  } catch (cause) {
    if (isNotFound(cause)) return null
    throw cause
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
```

The 14-line docblock above (`:120-136`) reasons carefully about *validation* and about
why `parseKeyHex` is applied here, and says nothing about why a truncated file should read
as "no certificate". The sibling `loadOrCreateSeed` throws `MalformedSeedFileError` for the
analogous case (`:79`) — so the file itself establishes the opposite convention.

**What is lost.** "certificate.json exists and is truncated" — precisely the crash-mid-write
case that this module's own rename-based atomic write exists to prevent.
`fabric-node.ts:507-515` reads `null` as "no cached certificate", silently re-enrols, and
with no `--provider-addr` simply runs uncertificated. The corrupt file is never reported
and never removed, so it is re-parsed and re-discarded on every subsequent start.

**Severity** correctness. **Effort** small.
**Closes it:** throw a named error as `loadOrCreateSeed` does, or return a distinct
`{ kind: 'malformed' }` the caller can report. Either way the caller must be able to tell
the two apart.
**Parallel-safe:** yes — `packages/node/src/identity-store.ts`, plus its caller in
`fabric-node.ts` if a new variant is introduced. Coordinate with D09 if both touch
`fabric-node.ts`.

## D05 — six verify paths report a codec defect as a forgery verdict

Each of these wraps an `ed25519.verify` *and* the payload builder that feeds it. Turning a
verify throw into "invalid" is sound; turning an encode throw into "invalid" is a wrong
accusation.

| Site | Swallow | Deliberate throw inside the same `try` |
|---|---|---|
| `packages/core/src/enrollment.ts:253` | `catch { holdsKey = false }` | `possessionChallenge` → `enrollment.ts:144` `'challenge not encodable'` |
| `packages/core/src/enrollment.ts:276` | `catch { holdsOwner = false }` | same |
| `packages/core/src/enrollment.ts:355` | `catch { valid = false }` | `enrollment.ts:137` `'certificate not encodable'` |
| `packages/core/src/naming.ts:116` | `catch { valid = false }` | `naming.ts:48` |
| `packages/core/src/capability.ts:178` | `catch { valid = false }` | `capability.ts:74` |
| `packages/core/src/discovery.ts:119` | `catch { return false }` | `discovery.ts:96` |

**Evidence** for the representative case, `packages/core/src/enrollment.ts:247-255`:

```ts
    try {
      holdsKey = ed25519.verify(
        fromHex(request.proofOfPossession),
        possessionChallenge(request.nodeKey, request.userKey),
        fromHex(request.nodeKey),
      )
    } catch {
      holdsKey = false
    }
```

and `enrollment.ts:142-145`:

```ts
export function possessionChallenge(nodeKey: PublicKeyHex, userKey: PublicKeyHex): Uint8Array<ArrayBuffer> {
  const encoded = encodeCanonical({ purpose: 'o2-enrol', nodeKey, userKey })
  if (!encoded.ok) throw new Error('challenge not encodable')
```

**What is lost.** "this record cannot be canonically encoded", reported instead as
`bad-proof-of-possession` / `bad-signature` / `bad-owner-proof`. By the repo's own rule —
*"a refusal that names the wrong thing is a defect even when the operation correctly
fails"* — this is a defect six times over. Not currently reachable from the wire
(`packages/net/src/protocol.ts:216,:615` pre-check finiteness), but `verifyCertificate`
and `verifyCapabilityRecord` are exported public API, and the pre-check does not cover a
field added later.

**Severity** correctness. **Effort** small.
**Closes it:** move the payload build above the `try` in all six. Costs nothing and
removes the ambiguity entirely.
**Parallel-safe:** yes — four files under `packages/core/src`, none of which any other
finding here touches.

## D06 — toolchain provenance degrades wholesale to `unknown`, and the artifact still says `ok: true`

**Evidence.** `tools/aot/lift.ts:847-851`:

```ts
    try {
      meta = parseMeta(await readFile(join(workDir, 'meta.txt'), 'utf8'))
    } catch {
      meta = new Map()
    }
```

with no comment, and `:858-866`:

```ts
      // The digest, never the tag. `:arm64` is mutable and a mutable cache key is not
      // a cache key.
      'elfconv-image': resolved.reference,
      'elfconv-commit': meta.get('elfconv-commit') ?? 'unknown',
      'elflift-sha256': meta.get('elflift-sha256') ?? 'unknown',
      clang: meta.get('clang') ?? 'unknown',
      'wasi-sdk': meta.get('wasi-sdk') ?? 'unknown',
      wasmedge: meta.get('wasmedge') ?? 'unknown',
```

One unread file turns all five provenance fields into `'unknown'` while the artifact is
emitted `ok: true`, indistinguishable from one whose toolchain genuinely could not be
identified. The empty map has a second effect: `readUndecoded` (`:682`) then takes the
`why: 'no-bitcode'` arm, a second wrong label from the same swallow. Given that this
record is what the adjacent comment calls the cache key, an artifact signed against
five `unknown`s is the determinism claim quietly weakening.

**Severity** correctness. **Effort** small.
**Closes it:** treat an unreadable `meta.txt` as a lift failure, or add a distinct
`provenance-unreadable` field so `ok: true` cannot be returned with no provenance.
**Parallel-safe:** shares `tools/aot/lift.ts` with D07 — do the two together.

## D07 — `disassembler-failed` is reported for a failure that did not happen

**Evidence.** `tools/aot/lift.ts:680-690`:

```ts
  if (meta.get('undecoded-probe') === 'failed') return { kind: 'not-run', why: 'disassembler-failed' }
  const callSitesRaw = meta.get('undecoded-callsites')
  if (callSitesRaw === undefined) return { kind: 'not-run', why: 'no-bitcode' }

  let text: string
  try {
    text = await readFile(join(workDir, 'undecoded.txt'), 'utf8')
  } catch {
    return { kind: 'not-run', why: 'disassembler-failed' }
  }
```

Reaching that catch requires `undecoded-callsites` to be present, and the container script
emits that key and writes `/o2/undecoded.txt` in the same branch (`lift.ts:406-410`). So by
construction the disassembler *did* run. A host-side read failure of the bind-mounted file
is then stamped with a reason that is false, sending a reader into the container to debug a
tool that worked. Fail-safe on the verdict, wrong on the reason — which is exactly the
class this project counts as a defect.

**Severity** correctness. **Effort** small.
**Closes it:** add a `why: 'undecoded-unreadable'` arm to the `UndecodedProbe` union
(`lift.ts:223`) and return it here.
**Parallel-safe:** shares `tools/aot/lift.ts` with D06.

## D08 — three worker entry points drop a `postMessage` rejection

**Evidence**, identical shape at all three:

| Site | Live? |
|---|---|
| `packages/browser/src/task-executor.worker.ts:23` | **yes** — `packages/browser/src/worker-factory.ts:11` |
| `packages/node/src/task-executor.worker-thread.ts:17` | **yes** — `worker-thread.ts:25` → `fabric-node.ts:138` |
| `packages/core/src/executor/task-worker.ts:73` | **no** — imported only by `worker.browser.test.ts`; superseded, see D33 |

```ts
    void runTask(event.data).then((response) => {
      self.postMessage(response)
    })
```

`runTask` itself never rejects (fully wrapped at `task-run.ts:92`), so the only rejection
is a `postMessage` throw — `DataCloneError` on an uncloneable response. That becomes an
unhandled rejection and the parent's pending entry simply times out, which is the same
"a node that is gone" misattribution as D01.

The contrast is in this repo already: `packages/node/src/peer-verifier.ts:250-251` writes
down why *its* `void` is safe —

```ts
    // `verify` resolves for every outcome including failure — the catch is inside it — so
    // there is no rejection here to leave unhandled.
    void this.verify(event.detail.toString())
```

**Severity** correctness (currently latent — every response field is cloneable today).
**Effort** small.
**Closes it:** `.catch(...)` posting a failure response, or the one-line justification
`peer-verifier.ts` already models if the argument holds. Only the first two sites need
fixing; the third is dead code that should be deleted instead.
**Parallel-safe:** yes — three distinct files, none shared with another finding.

## D09 — the browser tier structurally cannot verify peers

Recorded as Phase 17 deferred item 2 and **still open**; item 3's fourth mechanism depends
on it, so the two are one fix.

**Evidence.** `packages/node/src/peer-verifier.ts` exists; `packages/net/src/peer-verifier.ts`
does not. `packages/browser` does not depend on `@o2/node` — the only occurrence of that
string under `packages/browser/src` is prose at `index.ts:4` and `browser-node.ts:355`.
Consequently:

| | `fabric-node.ts` | `browser-node.ts` |
|---|---|---|
| `PeerVerifier` | imported `:135`, constructed `:1118` | absent (prose mention only, `:205`) |
| `trustedIssuers` | `:332` | absent |
| `ownRecords` | `:622` | `:439`, wired `:781` — **this half has landed** |

The module imports nothing Node-only: `@libp2p/interface` types, `@o2/core`, `@o2/libp2p`,
`@o2/net`, all of which `@o2/browser` already depends on. So this is a packaging fact, not
a capability one — which is what makes it worth fixing rather than accepting. It is the
exact asymmetry `fabric-node.ts`'s "why there is no second class" section exists to
prevent, and the project's stated position is that all nodes have equal functionality.

Note what has changed since the entry was written: browser-tier identity, the `enrollment`
option and `ownRecords` have all landed (`browser-node.ts:221`, `:400`, `:439`, `:988`).
**Only the verifier half remains**, and it is blocked solely by the file's location.

**Severity** correctness. **Effort** medium.

**CORRECTED 2026-08-12 — this entry said *"move the file to
`packages/net/src/peer-verifier.ts`"*, and that destination is not merely wrong but
impossible: it would redden `purity.node.test.ts` on the first run.** The old sentence is
quoted rather than deleted because the *shape* of the fix it names is right and only the
address is wrong, and a reader needs to see which half was retracted. Both halves of the
refusal are in one file. `packages/node/src/purity.node.test.ts:45` puts `net` in
`PORTABLE`; `:94` forbids `/^@libp2p\//` to every `PORTABLE` package on the ground that
*"libp2p modules belong in an adapter package"*; and `packages/node/src/peer-verifier.ts:174`
imports `Libp2p` and `PeerId` from `@libp2p/interface`. Being type-only does not save it —
`specifiersOf` (`:151-159`) matches the specifier in `from '…'` and never looks at whether
the binding was a type, which is deliberate and is why the guard reaches
`import type` at all.

**The correct destination is `@o2/libp2p`**, which `purity.node.test.ts:53` classes as
`DUAL_TARGET`: the only rules that tier carries are `NO_PLATFORM` (`:100-103`) — no `node:`
builtin and no `@o2/node` — and this module imports neither. `Libp2pTransport`
(`packages/libp2p/src/libp2p-transport.ts:225`) is the exact precedent, and the package's own
barrel already states the reasoning for a different symbol in the same words this move needs:
`packages/libp2p/src/index.ts:41-48` says a `@libp2p/interface` type is *"what
`purity.node.test.ts` forbids in `@o2/core` and `@o2/net` outright"*, and that both `@o2/node`
and `@o2/browser` depend on this package so either tier can name it *"without `@o2/browser`
acquiring `@o2/node`"* — which is precisely this entry's goal. `nodeKeyForPeerId`, imported at
`peer-verifier.ts:171`, is declared in that same package and becomes a relative import.

**Closes it:** move the file to `packages/libp2p/src/peer-verifier.ts`, re-export from
`packages/libp2p/src/index.ts`, and wire `trustedIssuers` + `PeerVerifier` into `BrowserNode`.
No code inside the module changes — **but one manifest does**: `packages/libp2p/package.json`
does not currently depend on `@o2/net`, and the module imports `RpcFailure`, `encodeRequest`
and `parseResponse` from it (`:172-173`), so that dependency has to be added. It is the safe
direction and not a cycle: `packages/net/package.json` depends on `@o2/core` and
`multiformats` only, so `@o2/net` does not reach back, which is the same layering
`@o2/libp2p` → `@o2/core` already has.
**Parallel-safe:** partly — touches `packages/node/src/peer-verifier.ts`,
`packages/net/src/index.ts`, `packages/browser/src/browser-node.ts`,
`packages/node/src/fabric-node.ts`, and **`mutation-ledger.ts` entries `M33`/`M34`/`M35`,
whose `file` field names the old path**. Do not run this concurrently with D11/D20.

## D10 — `bin/bench.ts` does not exit, and can stall for tens of minutes

Recorded as Phase 16 deferred item 1, reproduced independently in 16-05 on 2026-08-01, and
**still open**. Confirmed here: `packages/node/src/bin/bench.ts` contains no `process.exit`,
no `unref`, and no `getActiveResourcesInfo` instrumentation.

**Symptom 1** — the process writes its artifact and stays alive at 0 % CPU with all work
done; must be SIGTERMed. Reproduces at load 6.77, and survived the 16-05 combine fix, so
the refused real-transport reduce is ruled out as the cause.
**Symptom 2** — an intermittent multi-minute stall in the leg after the real ladder;
present at load 8.35, absent at 5.58 and 6.77. Consistent with serialised 30 s
`RpcEndpoint` timeouts under contention, not a deadlock.

**Why it matters beyond tidiness:** a 30 s timeout firing under load can silently turn a
measured rung into an em-dashed one in `.planning/BENCHMARK-RESULTS.md`. A published
number that quietly became an absence is worse than a failure.

**Severity** correctness. **Effort** large.
**Closes it:** instrument `FabricNode.stop()` against `process.getActiveResourcesInfo()`
across the ladder and find what does not return to its pre-ladder count. Phase 23 already
rewrites this driver for out-of-process fabrics, which would make both symptoms
structurally impossible — this is its natural home.
**Parallel-safe:** yes in principle, but it is Phase 23's; do not fix it piecemeal.

---

# GUARD-BLIND

## D11 — mutation ledger `B1`/`B2` record a signature one word off the test they name

This is the *same* drift class the Phase 16 deferred item recorded for `M2b` — recurring in
a new place, and the entry that predicted it was right.

**Evidence.** `packages/node/src/mutation-ledger.ts:494` and `:507` both read:

```ts
    signature: 'bin/bench.ts: two call sites, real admission at both, five sentinels twice',
```

The test they name, `packages/node/src/serve-agent-hooks.node.test.ts:202`:

```ts
  it('bin/bench.ts: two call sites, real admission at both, six sentinels twice', () => {
```

**five** against **six**. Traced: commit `e34660f` (*feat(17-02)*) renamed three titles at
once — `three`→`four` twice and `five`→`six` once — and moved no signature with them. The
ledger's `B1`/`B2` signature was last set in `25b6246` and has not moved since.

The same commit **accidentally healed `M2b`**: the ledger said `four sentinels`, the test
had drifted to `three`, and 17-02 renamed the test to `four`. So the recorded open item is
now closed by coincidence while two new ones opened silently in the same commit. Nothing
noticed either, because of D20.

Verified across all 37 entries: `B1` and `B2` are the only title-like signatures that do
not appear in their `caughtBy` file. `M2c`'s compound `describe > it` form and `M7`'s
runtime-rendered `63 raw bytes inside a 106-byte frame` (built at
`sovereign-block-refusal.node.test.ts:276-277`, observed value recorded at `:268-269`)
both check out.

**Severity** guard-blind — `npm run test:mutations` would report `B1`/`B2` as
`wrong-signature` failures today. **Effort** small.
**Closes it:** change `five` to `six` in both entries.
**Parallel-safe:** shares `mutation-ledger.ts` with D20 and D09 — sequence those three.

## D12 — the 30 %-killed churn case asserts a negative over a set a timeout can add to

Confirmed open, and the mechanism is sharper than "a flaky timing test": **there is no
duration assertion in the case at all**, which is why it does not look like a timing test.

**Evidence.** The hazard is a constructor argument, `packages/net/src/churn.test.ts:119`:

```ts
  const requestorRpc = new RpcEndpoint(network.connect('requestor'), { timeoutMs: 400 })
```

The assertion it endangers, `packages/net/src/churn.test.ts:191-194`:

```ts
      // And the departures are attributed, not merely survived.
      const nodeFailures = outcome.shards.flatMap((s) => s.failures)
      expect(nodeFailures.every((f) => f.kind === 'node')).toBe(true)
      for (const failure of nodeFailures) expect(dead).toContain(failure.nodeId)
```

with `dead = ['n2','n5','n8']` (`:165`). Under load a *live* node's RPC exceeds 400 ms,
`rpc.ts:188` rejects with `kind:'timeout'`, `churn.ts:83-87` turns any throw into
`kind:'node'` naming the attempted peer, and `:194` fails on a nodeId that is not in
`dead`. This is the failure recorded in the Phase 14 deferred item at what was then
`:192`.

**The 400 ms buys this case nothing.** The three dead nodes are removed with
`fabric.network.disconnect(nodeId)` (`:168`), and `MemoryNetwork.route` throws
`TransportError{kind:'unknown-peer'}` **synchronously** for an unregistered peer
(`packages/core/src/transport/memory.ts:87`) — which the case's own comment at `:161-164`
says: *"the dial fails rather than hanging"*. Departure is detected on the next tick,
never by an expiry.

Measured now, 4 runs at 1-min load 13.93→16.98 on 8 cores: this case runs in **26 / 38 /
57 / 62 ms**. The recorded failure was at load 17.52. A gate sited by the
`transport-bounds` method would sit between 16.98 and 17.52 — uncomfortably tight, which
argues for removing the dependence rather than gating it.

The sibling cases avoid this by asserting counts against named constants (`:236` against
`DEFAULT_MAX_TASK_FAILURES`, `:524` `expect(attempts).toBe(5)`), or by not asserting
*which* nodes failed (`:200`). This is the only case in the file that asserts a negative
over a set a wall-clock expiry can add to.

**Severity** guard-blind. **Effort** small.
**Closes it:** raise `timeoutMs` at `:119` — it costs this case nothing — and give the one
case that genuinely spends the timeout (`:200`) its own endpoint or a per-call override.
Failing that, inject the dispatch failure as `:538` already does.
**Parallel-safe:** yes — `packages/net/src/churn.test.ts`. D26 touches the same file at
`:526`; do them together.

## D13 — `purity.node.test.ts` has no instrument check, and does not scan the demo it ships

Two gaps in one file, and this repo has already shipped this exact bug once — recorded at
`mutation-ledger.ts:29-35`, where a disclosure-gate pattern matched nothing and *"every
absence assertion built on it passed for as long as it existed."*

**(a) The extractor is unproven.** `packages/node/src/purity.node.test.ts:87-96`:

```ts
function specifiersOf(source: string): string[] {
  const found: string[] = []
  const pattern = /(?:from|import)\s*['"]([^'"]+)['"]/g
```

Every assertion in the file has the shape `expect(violations).toEqual([])`. If
`specifiersOf` ever returned `[]` — a regex edit, a syntax the pattern does not reach —
all of them pass vacuously. `expect(files.length).toBeGreaterThan(0)` (`:102`, `:136`)
guards the *file list* against being empty but says nothing about the specifier list.
There is no synthetic-violation case anywhere in the file's 186 lines.

Both sibling guards do have one: `vocabulary.node.test.ts:518` —
`describe('the checker can fail — proved by mutation, not assumed')` — and
`disclosure-gate.node.test.ts:286` — *"the publishing patterns are live instruments, not
decoration"*.

**(b) The scan misses shipping browser code.** `sourceFiles` is called only on
`packages/<pkg>/src` (`:101`, `:135`). `packages/browser/demo/main.ts` — 692 lines, the
public demo, bundled by Vite and served to real tabs — is outside that and is never
scanned. The docblock at `:71-72` reads:

> Shipping code is unaffected: every non-test file, and every test that runs in the
> browser, is still scanned.

That is defensible as a statement about the `*.node.test.ts` exemption it sits under, but
it reads as a universal claim and is not one: a `node:` import in `demo/main.ts` would
break the demo build and this guard would not see it.

**Severity** guard-blind. **Effort** small.
**Closes it:** add a synthetic-source case asserting `specifiersOf` finds a known
specifier and that a planted `node:fs` import produces a violation; add
`packages/browser/demo` to the scanned roots; narrow the `:71-72` sentence to the
exemption it is actually about.
**Parallel-safe:** yes — `packages/node/src/purity.node.test.ts` only.

## D14 — a 50 ms budget with neither population stated, in three browser engines

**Evidence.** `packages/core/src/start-outcome.test.ts:221` and `:236`:

```ts
expect(elapsed).toBeLessThan(BUDGET_MS)      // BUDGET_MS = 50, declared at :206
```

Comment `:201-203`: *"generous enough not to flake on a loaded machine and still three
orders of magnitude under what materialising two million objects costs."* Neither number is
given — not what the fast path measures, not what the pathological path costs. The file
carries no `.node.`/`.browser.` suffix, so it runs in Node **and** chromium, firefox and
webkit, where 50 ms is the tightest wall-clock bound in the repo.

**Severity** guard-blind. **Effort** small.
**Closes it:** state the two measured figures and site 50 between them — or replace the
clock with the instrument the test actually means (assert `report()` does not iterate
`count`).
**Parallel-safe:** yes.

## D15 — two bounds derived by arithmetic from the constant under test

The repo's stated method is that a threshold is sited between two measured populations,
never by arithmetic on the thing being tested.

**Evidence.**
- `packages/browser/src/worker-executor.browser.test.ts:291` — `expect(elapsed).toBeLessThan(deadlineMs * 8)` (`deadlineMs = 600` → 4800 ms, inside a 60 s test budget). The file header (`:20-33`) documents the framework-vs-executor timeout *ordering*, not this bound, and records that this host once hit load average 130 with a single-integer guest taking over 10 s.
- `packages/node/src/execution-deadline.node.test.ts:93` — `expect(elapsed).toBeLessThan(deadlineMs * 4)` (`deadlineMs = 1_500` → 6000 ms, inside a 30 s budget). The measured window includes two real libp2p nodes, a dial, and both blocks pulled over the wire (`:67-70`), none of which the deadline bounds.

**Severity** guard-blind. **Effort** small.
**Closes it:** measure each window at a stated load and site the bound between that and the
framework budget. In the second case the discriminating claim is already carried by
`:91`'s `/exceeded \d+ms/` and `:115`'s constant relation, so the number could simply be
widened toward `DEFAULT_RPC_TIMEOUT_MS`.
**Parallel-safe:** yes — two independent files.

## D16 — a 1 s bound from requirement prose, nested inside its own 5 s wait

**Evidence.** `packages/node/src/background-tab.e2e.test.ts:212`:

```ts
expect(throttledWithinMs).toBeLessThan(1_000)
```

The measured window (`:207-210`) spans a Playwright CDP `evaluate` round trip plus a
`waitForFunction` poll, both across a process boundary, inside a case with a 180 s budget.
The 1 s comes from the BROW-03 requirement text ("throttles within a second"), not from
measurement — and the polling wait it is nested inside is set to 5 s (`:209`), so the
bound and its own wait disagree by 5×.

**Severity** guard-blind. **Effort** small.
**Closes it:** measure the round-trip floor (an `evaluate` that does nothing) and the
throttled reading, then site the bound between them; or move the measurement inside the
page so it stops timing Playwright.
**Parallel-safe:** yes.

## D17 — `lift.node.test.ts` has timing bounds and no load gate

Recorded as Phase 17 deferred item 5 and as `.continue-here.md` follow-up 3; **still open**.
Confirmed: the file imports no `loadavg` and contains no gate.

**Evidence.** Six assertions failed at 1-min load ≈45 and all 73 passed at 4.41 on the same
commit with no source change. The failing group is image-resolution budget behaviour —
`resolveImage(...)` bounded by `IMAGE_RESOLVE_CAP_MS` against a **stubbed** `docker`
(`tools/aot/lift.node.test.ts:1077`), so what is measured is how long a stub subprocess
takes to be scheduled. Separately `:1065`:

```ts
expect(elapsed).toBeLessThan(8_000)             // against timeoutMs: 400
```

with the comment at `:1046-1048` calling it *"deliberately loose: it is twenty times the
requested timeout and still an order of magnitude under the minute this used to take"* —
one real population (the 60 s pre-fix behaviour) and one end by arithmetic.

This file is also the single slowest in the project at **236.8 s**, so it is the one where
a load-induced failure costs the most to re-run.

**Severity** guard-blind. **Effort** small (the gate) / medium (siting it properly).
**Closes it:** apply the `transport-bounds.node.test.ts:505-515` gate to the
timing-bounded describe block only, siting `LOAD_CEILING` on the 45-vs-4.41 readings
already recorded.
**Parallel-safe:** yes — `tools/aot/lift.node.test.ts` only. Independent of D06/D07, which
touch `lift.ts`.

## D18 — three bounds name an upper population but never the fast one

Lower risk than D14–D17, listed so the gap is on the record.

- `packages/net/src/egress.test.ts:224` — `expect(Date.now() - started).toBeLessThan(1_000)`; comment `:211` gives the 10 s control only.
- `packages/net/src/sovereign-egress.test.ts:172` — `expect.soft(elapsed).toBeLessThan(1_000)`; same 10 s control at `:129-132`. `expect.soft`, so it reports rather than short-circuits.
- `packages/node/src/transport-bounds.node.test.ts:699` — `expect(Date.now() - started).toBeLessThan(5_000)`; comment `:696-698` cites the 20 s send timeout. Note the sibling at `:334` in the same file *does* state its 7–50 ms population, so the method is present here and simply was not applied to this line.

The first two carry no suffix and therefore also run in three browser engines, where 1 s is
a much smaller multiple of ambient noise than in Node.

**Severity** guard-blind. **Effort** small.
**Closes it:** state the fast-path measurement beside each.
**Parallel-safe:** `transport-bounds.node.test.ts` is also touched by D18's third bullet
only; no conflict with other findings.

## D19 — two repo-scanning guards silently drop a file they cannot read

**Evidence.**
- `packages/node/src/trust-anchors.node.test.ts:205` — `catch { continue // staged deletion, or a file this checkout does not have }`
- `packages/node/src/acceptance-traceability.node.test.ts:205` — same shape

A file that cannot be read never enters `REPO.scanned` / `CORPUS`, and a file that is not
scanned cannot violate the guard. Directly relevant given this repo's shared-checkout
hazard, where a concurrent agent removing a file mid-scan lands exactly here.

**Both are substantially mitigated** — `trust-anchors.node.test.ts:238-244` asserts
`scanned.length > 120` plus three named files, and `acceptance-traceability.node.test.ts:636-639`
asserts a `TEST_FILE_FLOOR` plus three named files. So a wholesale failure is caught; a
single newly-added file dropping out is not.

**Severity** guard-blind. **Effort** small.
**Closes it:** count the drops and assert the count is zero, or re-throw anything that is
not ENOENT.
**Parallel-safe:** yes.

## D20 — the cheap mutation guard never checks that a `signature` still matches anything

This is the hole that let D11 happen, and the Phase 16 deferred item named it precisely.

**Evidence.** `packages/node/src/mutation-ledger.ts:816-859` — `problemsWith` checks the
`find` text's occurrence count, `caughtBy` presence on disk, `why` length, and that
`signature.length !== 0`. It never compares the signature against anything:

```ts
  if (entry.signature.length === 0) {
    problems.push(
      `${entry.id}: declares no failure signature, so a non-zero exit from an unrelated ` +
        'flake would be accepted as proof the guard fired',
    )
  }
```

`packages/node/src/mutation-guard.node.test.ts:116` mirrors exactly that and no more:

```ts
      expect(entry.signature.length, `${entry.id} declares no failure signature`).toBeGreaterThan(0)
```

So a signature that has drifted off its test is invisible until someone runs the full
`npm run test:mutations` — which plants 37 real defects and is not part of any routine
run. By the project's own standard, the read count proves the bound's placement: this
guard reads the signature's *length* and never its *content*.

**Severity** guard-blind. **Effort** medium.
**Closes it:** in `problemsWith`, when a signature looks like a test title (no leading
`expected `/`AssertionError`/`Error: `), assert it appears in at least one `caughtBy`
file — splitting a `describe > it` compound on `' > '` and requiring each half. That turns
a rename into an immediate red instead of a survivor found on the next full mutation run.
Nine of the 37 signatures are assertion-output strings and must stay exempt; the
classifier needs to be explicit about which arm each entry is in.
**Parallel-safe:** shares `mutation-ledger.ts` with D11 and D09. Sequence: D11 (one-word
fix) → D20 (the check that would have caught it) → D09.

## D21 — the 18 real-artifact AOT tests are inert, and nothing says so

**Evidence.** 19 tests skipped in the passing `--project node` run; 18 of them are the
real-artifact suites, gated on fixtures under `/tmp`:

- `packages/aot/src/elf.real.node.test.ts` — 13 tests, each `skipIf(<fixture> === undefined)`, fixtures from `process.env['O2_ELF_FIXTURES'] ?? '/tmp/ecvout/elf'`
- `packages/aot/src/wasi-real.node.test.ts:98` — `describe.skipIf(LIFTED === undefined)`, 5 tests, from `/tmp/ecvout/r1/hello.wasm`

Verified directly: `/tmp/ecvout/elf` and `/tmp/ecvout/r1` both **exist and are empty**
(dirs dated Jul 31, contents gone).

Every skip is conditional and carries a written reason — *"`/tmp` does not survive a
reboot, and a suite that fails because a scratch directory was cleaned is a suite people
start ignoring"* — so this is **not** a silent-skip defect. The deficiency is what the
design costs: these are precisely the tests that check this project's real-artifact
assumptions against something other than fixtures it wrote itself, both files argue in
their own docblocks that synthetic fixtures *"share their author's misconceptions"*, and
they are inert right now with the suite reporting green. `wasi-real.node.test.ts:21-25`
says its premise was *"an assumption stated in three comments and tested against fixtures
built to satisfy it"* until that file existed — and it is back to that today.

**Severity** guard-blind. **Effort** medium.
**Closes it:** regenerate the fixtures (one documented `docker run`, recipe at
`elf.real.node.test.ts:20-32`; the `ghcr.io/yomaytk/elfconv:arm64` image is already local)
**and** move the default location out of `/tmp` to a gitignored path under the repo so a
reboot does not silently disarm them. A test that asserts the fixture directory is
populated, skipping loudly with the regeneration command when it is not, would turn this
from an absence into a message.
**Parallel-safe:** yes — two spec files plus a fixture path constant.

## D22 — AUTH-04's cost has never been measured

Phase 17 deferred item 4, re-measured in 17-05 and unchanged. **Still open.**

**Evidence.** The limiter keys on the field the requester supplies —
`packages/core/src/enrollment.ts:287` and `:318`:

```ts
    const recent = (this.#history.get(request.userKey) ?? []).filter((at) => at > now - this.#windowMs)
…
    this.#history.set(request.userKey, [...recent, now])
```

Twenty *distinct* user keys therefore enrol unslowed, verified in 17-05 across a real
process boundary against a spawned `--issues-certificates` agent: all twenty accepted,
twenty distinct subject keys issued. `enrollment.ts:265` records the awareness in a
comment, so this is a known and deliberately-scoped bound, not an oversight — but by the
project's own rule, *unmeasured is not met*.

**Severity** guard-blind. **Effort** medium.
**Closes it:** decide what bounds a *provider* rather than an owner (per-connection,
per-source, or proof-of-work), then measure it. Until then the AUTH-04 row should not read
as satisfied.
**Parallel-safe:** yes — `packages/core/src/enrollment.ts` plus a new spec.

---

# HYGIENE

## D23 — `SLOW_NODE_SPECS` is stale, and every number in its docblock is now false

The list has a stated rule. Measured against it today, the list selects 9 of the 23 files
that qualify.

**Evidence.** `vitest.config.ts:5-31` states the rule and the readings:

> `vitest run --project node --reporter=json` on 2026-07-29 gave a per-file span for every
> file in the project: median 37 ms, p75 267 ms, p90 1070 ms, total 252.7 s. The nine files
> below are every file that came in at or above 1 s.
> …`npm run test:unit` runs 66 files / 946 tests in **6.46 s**, against `npm run test:node`
> at 75 files / 1080 tests in **210 s**.

Measured now (`--reporter=json`, 111 files, load 9–27):

| claimed | measured now |
|---|---|
| median 37 ms | **99 ms** |
| p75 267 ms | **497 ms** |
| p90 1070 ms | **3820 ms** |
| total 252.7 s | 286.7 s |
| `test:unit` 66 files / 946 tests / **6.46 s** | **102 files / 1411 tests / 24.03 s** (at load 9.06) |
| `test:node` 75 files / 1080 tests / 210 s | **111 files / 1567 tests / 286.7 s** |

All nine listed files still qualify — nothing is wrongly listed. **Fourteen files now
qualify and are absent**, including the 2nd and 3rd slowest files in the entire project:

| ms | file |
|---|---|
| 22350 | `packages/node/src/enrollment.node.test.ts` |
| 21698 | `packages/node/src/certificate-verification.node.test.ts` |
| 14712 | `packages/node/src/tree-reduce-agents.node.test.ts` |
| 12059 | `packages/node/src/peer-gate.node.test.ts` |
| 6278 | `packages/node/src/orphan-leash.node.test.ts` |
| 6142 | `packages/node/src/signed-artifact.node.test.ts` |
| 4714 | `packages/node/src/capability-dispatch.node.test.ts` |
| 3542 | `packages/node/src/node-records.node.test.ts` |
| 2738 | `packages/node/src/peer-verifier.node.test.ts` |
| 2205 | `packages/node/src/execution-deadline.node.test.ts` |
| 1966 | `packages/node/src/egress-manifest.node.test.ts` |
| 1796 | `packages/node/src/node-enrollment.node.test.ts` |
| 1330 | `packages/node/src/relaying.node.test.ts` |
| 1246 | `packages/node/src/named-refusal.node.test.ts` |

These are the Phase 17 files, added after the 2026-07-29 measurement — which is the whole
explanation. The consequence is that `test:unit`, whose entire purpose is a fast inner
loop, is **3.7× its recorded figure**, and one unexcluded file (`enrollment.node.test.ts`,
22.3 s) accounts for nearly the whole 24.03 s wall clock on its own.

**Severity** hygiene — no behavioural risk, but the docblock states measurements as fact
and every one is now wrong, which is the "a number written down that nothing checks" case.
**Effort** small.
**Closes it:** re-measure, rewrite the docblock's figures, and add the 14 files. Consider a
test asserting that no file outside `SLOW_NODE_SPECS` exceeded the cut on the last
measurement — that is what would stop this recurring.
**Parallel-safe:** yes — `vitest.config.ts` only.

## D24 — `counting-executor.ts` claims a composition `browser-node.ts` explicitly does not use

**Evidence.** `packages/net/src/counting-executor.ts:41-42`:

> Plan 13.1-05 Task 1 composes it as the outermost wrapper of the executor in both
> `fabric-node.ts` and `browser-node.ts` and exposes its readings on the node.

`packages/browser/src/browser-node.ts:883-884`:

```ts
    const counter = new CountingExecutor(guardSovereignty(provenance(worker), sovereignty))
    const executor = new GovernedExecutor(counter, governor)
```

`GovernedExecutor` is outermost. The same file says so at `:846-848`: *"`CountingExecutor`
sits **inside** `GovernedExecutor`, not outside it, and the deviation from
`fabric-node.ts`'s outermost composition is deliberate."* Only `fabric-node.ts:1202` still
matches the claim.

**Severity** hygiene. **Effort** small. **Closes it:** one sentence.
**Parallel-safe:** yes.

## D25 — two comments claim `grantConsent` is the only way to open the gate

**Evidence.**
- `packages/browser/demo/main.ts:12` — *"`start` takes a `GrantedConsent`, which only `grantConsent` mints."*
- `packages/browser/src/tab-api.ts:206` (on `grantConsent`) — *"This is the only thing that opens the gate."*

Falsified three ways:
1. `packages/browser/src/consent.ts:154` — `readConsent` also mints: `{ ok: true, consent: new GrantedConsent(record, MINTED) }`. `consent.ts:74` says so itself — *"no other way to obtain one than to have **written, or to have found**, a consent record"* — two paths, not one.
2. `packages/browser/demo/main.ts:95-99` — `requireConsent()`, which `start` actually calls (`main.ts:218`), goes through `readConsent(store)` and never through `grantConsent`. A returning visitor starts with `grantConsent` never running.
3. `start` does not take a `GrantedConsent` at all: `packages/browser/src/tab-api.ts:271-275` declares `start(options: { relayAddrs, blockstoreName, trustAnchors? })`, and `main.ts:218` discards `requireConsent()`'s return value.

**Severity** hygiene — the gate itself is sound (`new GrantedConsent` is reachable only at
`consent.ts:154` and `:183`, both behind the module-private `MINTED` symbol, verified). It
is the description that is wrong. **Effort** small.
**Parallel-safe:** yes.

## D26 — "coordinator.ts reads `kind` in exactly one place" — it reads it in six

**Evidence.** `packages/net/src/churn.test.ts:526`:

> …what matters is the policy the kind selects, and `coordinator.ts` reads `kind` in
> exactly one place.

`packages/core/src/coordinator.ts` reads it at `:264`, `:492`, `:594`, `:611`, `:612`,
`:616`. The comment is a paraphrase of `coordinator.ts:489-490`, which carries the
qualifier the paraphrase dropped: *"this is the only place `kind` is read **for policy**"*.
The original is true; the copy is not.

**Severity** hygiene. **Effort** small. **Closes it:** restore the two dropped words.
**Parallel-safe:** shares `churn.test.ts` with D12 — do them together.

## D27 — two exclusivity claims true only under a scope the sentence does not state

- `packages/core/src/executor/module-provenance.ts:44-45` — *"`ResolveFailure` has exactly one consumer, `describeResolveFailure`, in the same file."* The narrow claim (no distant `switch` on `.kind`) holds. "Exactly one consumer" does not: `naming.ts:86`, `naming.ts:156`, and `module-provenance.ts:71` itself. It is also re-exported publicly at `packages/core/src/index.ts:221`, so the consumer count is not bounded by this repo at all.
- `packages/node/src/fabric-node.ts:4-5` — *"this factory is the only place that knows which concrete implementation is in use."* True of `FabricNode`, not of the package: `packages/node/src/bin/bench.ts` constructs `MemoryBlockstore` at `:206`, `:362`, `:418`, `:719` and `WasmExecutor` at `:382`, `:424`, `:726`, and calls `serveAgent` itself at `:388`, `:429`.

**Severity** hygiene. **Effort** small. **Closes it:** add the scope the sentences assume.
**Parallel-safe:** yes.

## D28 — the planning docs still carry the claim the source retired

Phase 15's deferred item is marked **CLOSED by Plan 15-05**, and in the source it is: all
five sites now carry the corrected statement (`browser-node.ts:964`, `:999-1000`,
`browser-node-contract.node.test.ts:26`, `serve-agent-hooks.node.test.ts:117-128`,
`sovereign-block-refusal.node.test.ts:55`, `mutation-ledger.ts:140-151`). The correction
stopped at the package boundary.

**Evidence.** `.planning/REQUIREMENTS.md:431` still states it as the WIRE-03 rationale:

> …relay to dial, so it runs in **neither** vitest project — the `node` project has no…

and `.planning/ROADMAP.md:595` still cites that as authoritative:

> The recorded root cause is one sentence shared by all four — `BrowserNode.start()` needs
> a real `indexedDB` and a relay to dial, so it runs in **neither** vitest project. Full
> statement in REQUIREMENTS.md under WIRE-03

The claim is false — `packages/node/src/browser-capability.e2e.test.ts` starts that
factory against a live tab today — and these two documents are where a planner would look
first. This is the same false statement that the Phase 15 entry says *"stood unmeasured
for four plans"* because everybody inherited it.

**Severity** hygiene. **Effort** small.
**Closes it:** rewrite both to the corrected statement — the `browser` project cannot host
such a test because a Circuit Relay v2 server does not run in a browser; the `e2e` project
can and needs no relay.
**Parallel-safe:** yes — two planning files, no source.

## D29 — `.continue-here.md`'s open-follow-ups list is stale in two entries

**Evidence.** `.planning/.continue-here.md:110-124`:
- Item 4 — *"`perf-workload.ts` holds production `serveAgent` sites no plan ever names"* — **closed**. `packages/node/src/serve-agent-hooks.node.test.ts:231-247` now guards it (`it('bench/src/perf-workload.ts: the third production serveAgent file')`). All six production `serveAgent` sites across five files are covered.
- Item 5 — *"`M2b`'s mutation signature drifted… says 'four sentinels' where the test says 'three'"* — **stale as written**. `M2b` now matches; the drift moved to `B1`/`B2` (D11) in the same commit that healed it.

Items 2 and 3 are confirmed still open here as D12 and D17.

**Severity** hygiene. **Effort** small.
**Parallel-safe:** yes.

## D30 — four low-consequence silent swallows

Listed for completeness; none carries a stated reason, and each collapses two distinct
situations into one value.

- `packages/browser/demo/main.ts:523` — `catch { return null }` in `computePeers`. The comment at `:514-517` argues the probe "costs no timeout" because a non-speaker fails negotiation immediately; a peer that *does* speak the protocol but is wedged burns the demo's `rpcTimeoutMs: 60_000` (`:261`) and is then silently dropped from the tally. The reasoning covers one of the two cases the catch handles.
- `packages/node/src/seed-server.ts:351` — `catch { return null }` in `readUrlPort`; a malformed join URL yields a `null` port with no diagnostic, in a function whose sibling `readWsPort` carries a comment about a bug that shipped once already.
- `packages/browser/src/consent.ts:104` and `:206` — `catch { return null }` on `JSON.parse` and on the `localStorage` access. Both are benign (they collapse to "no consent", which shows the gate) but neither says so.

**Severity** hygiene. **Effort** small.
**Parallel-safe:** yes — three files.

## D31 — nothing runs the cheap guards before a commit, and they scan tracked files only

**Evidence.** `.githooks/pre-commit` (the configured `core.hooksPath`) enforces branch
naming and nothing else — it runs no test, no `tsc`, no guard. `vocabulary.node.test.ts:360`
scans `git ls-files`, i.e. **committed** state, and `disclosure-gate.node.test.ts:74` the
same.

This has already produced a defect. The Phase 17 deferred record for `vocabulary.node.test.ts`
states it plainly:

> the guard scans `git ls-files`. 17-06 found this only because it ran the guard *after*
> committing; the verification pass that introduced it reported its guards green from a run
> that could not have read the file it was about to write.

**This must not be closed by adding CI.** The absence of `.github/workflows` is a
deliberately enforced invariant — `disclosure-gate.node.test.ts:211-214` asserts the
directory does not exist, and `:225` asserts no workflow file exists tracked *or*
untracked, because public hosting is public disclosure and forfeits EPO/China patent
rights. Any fix must stay local.

**Severity** hygiene (it is an ordering hazard, not a wrong behaviour). **Effort** small.
**Closes it:** a `pre-push` hook, or a `pre-commit` step, running the three cheap guards
(`purity`, `vocabulary`, `mutation-guard` — 846 ms together) plus `tsc --noEmit` against
the staged tree.
**Parallel-safe:** yes — `.githooks/` only.

## D32 — five of the 22 "Built, not wired" rows are now false, in the optimistic direction

The brief's figure is right: `.planning/REQUIREMENTS.md` marks exactly **22** rows
**Built, not wired** (legend at `:32` — *"Mechanism exists and is unit-verified; nothing
calls it"*; 24 occurrences of the string, less the legend and the prose mention at `:358`).
**17 are accurate.** Five say a mechanism has no production caller and it does.

Root cause: `REQUIREMENTS.md` was last committed in `34af9b4` on 2026-07-31; the Phase
17-04/17-05 wiring landed on 2026-08-01.

| Row | Doc claim | Measured |
|---|---|---|
| AUTH-01 (`:565`) | "`requestEnrollment` / `EnrollmentAuthority` have no production caller" | **False** — `requestEnrollment` at `packages/node/src/fabric-node.ts:555` and `packages/browser/src/browser-node.ts:413`; `new EnrollmentAuthority` at `fabric-node.ts:1077` and `browser-node.ts:797` |
| AUTH-04 (`:568`) | same | **False**, same evidence |
| AUTH-02 (`:566`) | "`verifyCertificate` is reachable only through `discoverExecutors`, which has no caller" | **False** — `packages/node/src/peer-verifier.ts:477`, reached from `PeerVerifier.start(...)` at `fabric-node.ts:1118` |
| SCHED-03 (`:579`) | "no node supplies `serveAgent`'s `capacity` hook, so every offer is accepted" | **False** — `capacity: admission` at `fabric-node.ts:1300` and `browser-node.ts:1009`, backed by `new LocalCapacity` at `fabric-node.ts:986` / `browser-node.ts:899`, plus `bin/bench.ts:405,444` and `perf-workload.ts:196,223` |
| NET-06 (`:575`) | "no node supplies `serveAgent`'s `index` hook, so none serves a record" | **Half false** — `index: records ?? 'serves-no-records'` at `fabric-node.ts:1278` / `browser-node.ts:988`, non-null once the node holds a certificate. The *reading* half is genuinely unwired, so this row should read `Partial` |

SCHED-03 is the sharpest: the doc says every offer is accepted, while
`serve-agent-hooks.node.test.ts` asserts the opposite for five files and four mutation-ledger
entries (`M2a`, `M2b`, `B1`, `B2`) exist solely to plant the sentinel back. The requirements
ledger contradicts the guard.

**Two internal contradictions in the same document:** `:357` says *"The 36 entries marked
Built, not wired above"* and `:21` says *"For 36 requirements the trace does not arrive"* —
36 is the 22 Built-not-wired rows **plus** the 14 `Partial` rows, two markers merged under
one label. And `:14`'s arithmetic — *"35 of 72 are `[x]` … down from 68 … the 37 that
moved"* — does not close: 68 − 35 = 33.

**Severity** hygiene — nothing behaves wrongly, but this is the document a planner reads
first, and it currently under-reports shipped work. **Effort** small.
**Closes it:** re-verify the five rows against call sites and re-mark them; reconcile 22 vs
36; fix the arithmetic. Longer-term, `acceptance-traceability.node.test.ts` already parses
this ledger — extending it to assert that a row claiming "no production caller" has none
would make this class of drift impossible, and is the same fix shape as D20.
**Parallel-safe:** yes — `.planning/REQUIREMENTS.md` only. Do it after D09, which changes
`peer-verifier.ts`'s path.

## D33 — 29 dead exports and ~67 dormant ones, most named by no requirement row

A full sweep of 234 exported **value** symbols across `packages/{core,net,node,browser}/src`,
with prose comments and barrel re-exports excluded from the caller search (both produce
false "wired" signals in this codebase), gives:

| package | wired | test-only | dead |
|---|---:|---:|---:|
| core | 56 | 41 | 15 |
| net | 24 | 11 | 2 |
| node | 12 | 16 | 4 |
| browser | 19 | 26 | 8 |
| **total** | **111** | **94** | **29** |

A barrel-resolved import graph from the five real entry points (`browser/demo/main.ts`,
`node/src/bin/{agent,bench,seed}.ts`, `tools/aot/cli.ts`) agrees independently: **18
non-test modules are unreachable from any runnable entry point.**

About 27 of the 94 are deliberate test infrastructure (`core/src/executor/fixtures.ts`,
`node/src/capability-fixture.ts`, `net/src/conformance.ts`, `browser/src/wasm-probes.ts`,
`browser/src/synthetic-artifact.ts`) and are not capability gaps. Netting those out leaves
**~67 genuinely dormant exports.** The 22 requirement rows are requirement-shaped, so one
row can hide a dozen symbols — the two counts measure different things and do not conflict.

**Worth acting on — zero references anywhere, not even a test:**

- `packages/node/src/identity-store.ts:166` — `hasSeed`
- `packages/browser/src/disclosure.ts:31` — `CONSENT_VERSION_NOTE`
- `packages/browser/src/capability-harness.ts:153` — `installCapabilityHarness` (self-invoked at `:235`; the module has no importer)
- `packages/core/src/executor/task-worker.ts` — an entire **superseded** worker entry (`runJobInWorker:35`), imported only by `worker.browser.test.ts`. The live paths are `browser/src/task-executor.worker.ts` (via `worker-factory.ts:11`) and `node/src/task-executor.worker-thread.ts` (via `worker-thread.ts:25` → `fabric-node.ts:138`). This is the D08 site that needs deleting rather than fixing.

**Dormant and named by no row** (the doc's blind spots, not contradictions):
`DutyCycleGovernor` (`core/src/governor.ts:29`, zero production references — SCHED-04 records only that `GovernedExecutor` is browser-only, and the browser actually uses
`VisibilityGovernor`); `localDispatch` (`core/src/reduce.ts:547`); `planWithOffers`
(`core/src/placement.ts:217`); the record-*reading* side — `RpcRecordIndex`
(`net/src/discovery.ts:35`), `rpcAdmission` (`:95`), `FallbackRecordIndex`
(`core/src/discovery.ts:319`), `verifyCapabilityRecord` (`core/src/discovery.ts:115`);
`remoteDispatch` (`net/src/churn.ts:63`); the rest of `quorum.ts` beyond the two named
symbols (`attestationRank:49`, `describeAttestation:61`, `sharedRelay:169`,
`classifyAttestation:202`); `checkLease`/`shouldRenew` (`core/src/lease.ts:376,392`) and
all of `coverage.ts`; 24 dormant exports in `browser/src/streaming-load.ts` where AOT-05
names only `loadArtifact`; and `seed-server.ts`'s `lanAddresses`/`localHostname`/
`relayAddrForHost` despite `bin/seed.ts` being a live entry point.

Most of the remaining 29 "dead" are over-exported module-private constants (`TASK_ENTRYPOINT`
and `MAX_PARTITIONS` at `core/src/executor/wasm.ts:34,37`; `MIN_D`/`MAX_D` at
`core/src/placement.ts:57,58`; `DEFAULT_WATCHDOG_MS`/`DEFAULT_MAX_TASK_FAILURES` at
`core/src/coordinator.ts:83,138`; and similar) — real code, wrongly public.

**Severity** hygiene. **Effort** medium.
**Closes it:** delete the four zero-reference symbols and the superseded `task-worker.ts`;
drop `export` from the module-private constants; and record the undeclared dormant symbols
against a row so "built, not wired" is counted at the symbol level rather than inferred.
**Parallel-safe:** the deletions are, each touching one file. Do not run concurrently with
D08 (shares `task-worker.ts`) or D04 (shares `identity-store.ts`).

---

# Negative results

Categories checked that produced nothing, which is worth recording:

- **TODO / FIXME / XXX / HACK markers: none.** The project's claim holds. Every hit for `@ts-expect-error` is a deliberate compile-time contract guard with a docblock explaining that widening the type turns the suppression into an "unused directive" error — `agent-contract.test.ts` (7), `browser-node-contract.node.test.ts`, `remote-executor-contract.test.ts`, `speculation.test.ts`, `enrollment.test.ts`. The single `eslint-disable` (`streaming-load.browser.test.ts:412`) is a `no-console` suppression annotated *"the measurement is the deliverable"*.
- **Silent skips: none.** All 22 skip sites are `skipIf`/`ctx.skip` with a machine-readable condition and a written rationale. `it.skip`, `describe.skip`, `.todo`, `.fails`, `xit`, `this.skip()` return zero hits outside comments and string fixtures. Roughly 40 `if (…) return` early exits were checked individually and are all discriminated-union narrowing placed immediately *after* an `expect()` on the same condition — the assertion fires first. `lift.node.test.ts:1437-1457` documents the one place that pattern was previously abused, and the `liftedArtifact()` helper that now throws instead.
- **`tsc --noEmit`: clean**, exit 0, captured directly rather than through a pipeline.
- **The three named guards pass**, 97 tests in 846 ms.
- **`imageIsPresent()` is fixed** (`tools/aot/lift.node.test.ts:1400`): it retries only on host-exhaustion errnos and returns `false` only for a docker that ran and exited non-zero. **`removeContainer` (`tools/aot/lift.ts:724`) swallows deliberately and the reason still holds** — verified against `run()` at `lift.ts:437`, whose promise has no reject path, so only a synchronous `spawn()` throw reaches it.
- **`transport-bounds.node.test.ts` is the reference implementation** of the load-gate method (`:480-515`) and Phase 14's deferred item about it is genuinely closed — the fix chosen was a gate sited on eight readings (passes 7.70–11.55, failures 12.4–18.12, ceiling 12) rather than the ratio the entry proposed.
- **Phase 14's `acceptance-traceability` item is closed**: `:622` now reads `expect(locate('SCHED-06')?.satisfied).toBe(true)`.
- **Phase 17 item 1 is closed**: `fabric-node.ts`'s `audienceKeyOf` paragraph was rewritten by 17-05.
- **A large body of exclusivity comments was spot-checked and holds** — including every third-party line-number pin into `node_modules` (`@libp2p/utils`, yamux `muxer.js`, `abstract-stream-muxer.js`, yamux `constants.js`, `main-event`), and internal claims in `peer-verifier.ts`, `capability-dispatch.node.test.ts`, `ports.ts`, `net/src/index.ts`, `speculation.ts`, `placement.ts`, `consent.ts`, `wasm.ts`, `admission.node.test.ts`, `capability-authorizer.ts`, `sovereignty-guard.ts`, `browser-node.ts`, `built-bundle.e2e.test.ts`, `fabric-node.ts`. All 104 distinct `packages/*/src` paths cited inside comments resolve; the only three misses are deliberate placeholders.
