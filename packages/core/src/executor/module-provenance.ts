/**
 * DET-03 / DATA-08 at the executor boundary — the refusal that makes a bare CID
 * unexecutable rather than merely discouraged.
 *
 * `naming.ts` has held the mechanism since Phase 4: a `NameRecord` is a signed
 * assertion that a name maps to a CID, and `SignedNameResolver` accepts one only
 * from a key pinned at construction. Nothing called it. Every module in the fabric
 * became bytes by way of `blockstore.get(task.moduleCid)` — a CID that proves the
 * bytes are the bytes that were hashed, and says nothing at all about who meant them
 * to run. This adapter is what stands between the two.
 *
 * An adapter behind the unchanged `Executor` port, per Phase 2's standing rule and
 * exactly as `sovereignty-guard.ts` is: the port gains no method, `serveAgent` gains
 * no hook, and whoever builds a serving node's executor wraps it before handing it
 * over. That wrapping is the guarantee — there is no single choke point to defend,
 * because three separate `Executor` implementations resolve `task.moduleCid`
 * independently.
 *
 * The ordering is the entire "before instantiation" claim. `inner.execute` for a
 * real `WasmExecutor` is what reaches `blockstore.get` and then
 * `WebAssembly.instantiate`; every path through `execute` below either returns a
 * refusal or calls `inner.execute`, never both and never in the other order. That is
 * a property of the code, and `module-provenance.test.ts` reads the inner executor's
 * call counter in every test rather than trusting it.
 *
 * **Why `accept` and not `resolve`.** `accept` verifies the signature against the
 * pinned anchors, checks expiry, checks the monotonic version, *and* stores. Calling
 * it on every dispatch is what gives this guard rollback protection for nothing: a
 * peer replaying a genuinely-signed older record for a name this node has already
 * seen at a higher version is refused by the resolver itself, not by anything written
 * here. `resolve` alone would only read back what some earlier call had stored — and
 * there is no earlier call, because nothing on this path ever hands the resolver a
 * record except the line below.
 *
 * **Why the CID comparison is not redundant.** `accept` returning ok says the record
 * is genuine. It says nothing about whether it is a record *for this task*. Without
 * step 3, a valid record for any artifact the build authority ever signed would
 * authorise execution of any other CID a dispatcher chose to name. This is the whole
 * check, not a belt-and-braces addition to it.
 *
 * **Where the mismatch case lives, and why it is not a sixth `ResolveFailure`.** The
 * expected move is to widen `naming.ts`'s `ResolveFailure` union, on the grounds that
 * an exhaustively-switched union makes every consumer fail loudly until updated. That
 * buys nothing here, and the reason has to state its scope or it is false. **What is
 * true: `describeResolveFailure`, in `naming.ts`, is the only exhaustive `switch` over
 * `ResolveFailure`'s discriminant anywhere in the repository** — so widening the union
 * makes exactly one function fail to compile, in the same file as the union, and there
 * is no distant switch to make fail.
 *
 * What is *not* true, and was written here as though it were, is that the type has one
 * consumer. It is referenced at `naming.ts:86` and `:156` and again below at `:71`, and
 * it is re-exported publicly from `packages/core/src/index.ts`, so the consumer count is
 * not bounded by this repository at all. The exhaustive-switch count is; that is the one
 * the argument needs, and it is the one to re-check before widening. The cost is real,
 * though. It would put a variant `SignedNameResolver` can
 * never itself return inside the resolver's own failure type, which is a false
 * statement about that type. And the mismatch is not a resolution failure at all:
 * resolution succeeded. It is the *dispatcher* that attached a record for a different
 * artifact. So it lives with the code that can detect it.
 *
 * **What this is not.** It is not AUTH-03's capability chain (`capability.ts`, Phase
 * 15): a chain proves the *caller* may ask, this proves the *module* is the one the
 * build authority meant to ship. They compose and do not substitute — the same
 * distinction `sovereignty-guard.ts` draws for its own subject. And it is not a
 * determinism analysis: nothing here inspects the module's bytes or predicts its
 * behaviour. Divergence is detected by comparison, as it always was; this decides
 * only whether these bytes are the ones that were vouched for.
 *
 * Pure module: no platform imports, so it lives in `@o2/core`.
 */

import type { ResolveFailure, SignedNameResolver } from '../naming.ts'
import type { ExecutionOutcome, Executor, Task } from '../ports.ts'

/** Why a task's module was refused. */
export type ModuleRefusal =
  /** The task arrived with no record at all — a bare CID. */
  | { readonly kind: 'no-record'; readonly moduleCid: string }
  /** The record itself did not survive the resolver. */
  | { readonly kind: 'unresolvable'; readonly failure: ResolveFailure; readonly reason: string }
  /** The record is genuine, and vouches for some other artifact. */
  | {
      readonly kind: 'cid-mismatch'
      readonly name: string
      readonly signed: string
      readonly dispatched: string
    }

/**
 * Exhaustive by construction, with no `default` arm — the shape
 * `describeResolveFailure` already uses, so a fourth variant is a compile error
 * rather than a silent fallthrough into wording nobody wrote.
 */
export function describeModuleRefusal(refusal: ModuleRefusal): string {
  switch (refusal.kind) {
    case 'no-record':
      return `no signed name record arrived for ${refusal.moduleCid} — a bare CID names bytes, not a publisher`
    case 'unresolvable':
      // The resolver's own five messages already read as refusal text. Rewording them
      // here would give one fact two spellings, and an operator two things to grep for.
      return refusal.reason
    case 'cid-mismatch':
      return `the signed name record for "${refusal.name}" vouches for ${refusal.signed}, but the task dispatched ${refusal.dispatched} — the record is for a different artifact`
  }
}

/** What a serving node checks a task's module record against. */
export interface ModuleProvenance {
  /** Anchors are pinned at this resolver's construction and cannot be added to. */
  readonly resolver: SignedNameResolver
  /**
   * Required, never defaulted — `capability.ts`'s `VerifyOptions.now` carries the
   * same rule for the same reason: injected so verification is deterministic in
   * tests and needs no clock port. A thunk rather than a number because expiry is
   * decided once per dispatch, not once per node; a node that read the clock at
   * construction would keep executing an expired record for as long as it stayed up.
   */
  readonly now: () => number
}

/**
 * Wrap `inner` so a task is refused unless it carries a record that verifies against
 * a pinned anchor *and* names the CID the task actually dispatched.
 *
 * There is no exempt case. Unlike `guardSovereignty`, which is a no-op for public
 * work, DET-03 has no label qualifier: a module is vouched for or it does not run.
 */
export function guardModuleProvenance(inner: Executor, provenance: ModuleProvenance): Executor {
  const refuse = (refusal: ModuleRefusal): ExecutionOutcome => ({
    ok: false,
    // The node id is in the string for `guardSovereignty`'s reason: a dispatcher
    // reading a `failures` entry needs to know which machine said no.
    reason: `module provenance refused on ${inner.nodeId}: ${describeModuleRefusal(refusal)}`,
  })

  return {
    nodeId: inner.nodeId,
    async execute(task: Task): Promise<ExecutionOutcome> {
      const record = task.moduleRecord
      if (record === undefined) {
        return refuse({ kind: 'no-record', moduleCid: task.moduleCid.toString() })
      }

      const accepted = provenance.resolver.accept(record, provenance.now())
      if (!accepted.ok) {
        return refuse({ kind: 'unresolvable', failure: accepted.failure, reason: accepted.reason })
      }

      const signed = accepted.cid.toString()
      const dispatched = task.moduleCid.toString()
      if (signed !== dispatched) {
        return refuse({ kind: 'cid-mismatch', name: record.name, signed, dispatched })
      }

      return inner.execute(task)
    },
  }
}
