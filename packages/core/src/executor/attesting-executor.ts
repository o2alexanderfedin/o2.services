/**
 * The third signing leg at the executor boundary — VER-08, VER-09, VER-10.
 *
 * `result-attestation.ts` holds the statement and its verification. This is the adapter
 * that produces one: it wraps an `Executor` and signs what that executor returned, with
 * the node's own seed, against the node's own provider-signed certificate.
 *
 * An adapter behind the unchanged `Executor` port, exactly as `sovereignty-guard.ts` and
 * `module-provenance.ts` are: the port gains no method, `serveAgent` gains no hook, and
 * whoever builds a serving node's executor composes it before handing it over. Leg 1
 * (`guardModuleProvenance`) has this shape already, and leg 3 following it is not a
 * coincidence — it is the same argument. Three separate `Executor` implementations
 * resolve a module independently, so there is no single choke point to defend, and the
 * composition *is* the guarantee.
 *
 * ## Why the kernel does not sign, and this does
 *
 * `WasmExecutor`, `WorkerExecutor`, `runTask` and `@o2/aot`'s `WasiExecutor` all report
 * `'signed-by-nobody'`, and that is the finding rather than a shortcut. A kernel that
 * signed would need an identity — a seed and a certificate — and keeping an identity out
 * of the kernel is precisely what `ports.ts` exists for. Signing is a property of a
 * *node*, and a node is the thing that has been enrolled.
 *
 * ## Composed nowhere, and that ends on a date
 *
 * **Nothing in this repository composes this wrapper yet.** Plan 19-15 does, at
 * `packages/node/src/fabric-node.ts` and `packages/browser/src/browser-node.ts` — the two
 * sites that already compose `guardModuleProvenance` — and
 * `packages/node/src/trust-anchors.node.test.ts:366-394` gains the textual guard that
 * leg 1 already has there. Plan 19-14 makes `VerificationResult.agreeing` carry the
 * attestation, which is the first thing that reads one.
 *
 * A wrapper exported and never composed is exactly the *built, not wired* condition this
 * milestone exists to remove. It is acceptable here for one wave only, and only because
 * a plan says when it ends. If you are reading this after 19-15 landed and it is still
 * composed nowhere, that is the defect.
 *
 * Pure module: no platform imports, no clock of its own.
 */

import { canonicalCid } from '../canonical/encode.ts'
import type { ExecutionOutcome, Executor, Task } from '../ports.ts'
import { signResult, signingKeyOf } from '../result-attestation.ts'
import type { ResultSigner } from '../result-attestation.ts'

/**
 * Either this node's signing identity, or its statement that it signs nothing.
 *
 * A named literal rather than an optional argument, for `ExecutionOutcome`'s reason: a
 * node that quietly stopped signing because a caller forgot an argument is the exact
 * failure the required-with-sentinel rule exists to make impossible. Writing
 * `'signs-nothing'` is a decision somebody took; omitting an argument is not.
 */
export type ResultAttestor = ResultSigner | 'signs-nothing'

/**
 * Wrap `inner` so every successful outcome carries a signature over what it produced.
 *
 * **The seed is checked against the certificate here, once, at composition** — not per
 * task. A node whose seed does not match its certificate is misconfigured at the point
 * the two values were put together, and that is where the throw belongs; per task it
 * would surface as every shard failing on that node for a reason that names the task.
 * {@link signingKeyOf} throws `WrongSigningKeyError`.
 *
 * **The node id does not move.** `nodeId` is `inner.nodeId`, unchanged. Deriving it from
 * the certificate instead would put a hex key where every caller expects a peer id, and
 * `submitJob` would fire `missing-node-descriptor` across the tree.
 *
 * **The signature is over the *inner executor's* answer**, content-addressed with the
 * same `canonicalCid` that `job/verify.ts`'s `runOne` already calls on every output — so
 * the CID a node signs and the CID the requestor compares are computed the same way.
 * A failure outcome passes through untouched, because there is nothing to attest.
 *
 * The wrapper is the outermost signing layer and **overwrites** whatever the inner
 * reported, which in practice is always the sentinel. That is deliberate: the statement
 * must be about what *this node* returns, and this node is the one composing the wrapper.
 */
export function attestResults(inner: Executor, attestor: ResultAttestor): Executor {
  // `'signs-nothing'` composes to the identity, and returns `inner` itself rather than a
  // wrapper that forces the sentinel. Forcing it would be the wrong answer if `inner`
  // ever did attest: a node declaring that *it* signs nothing has said nothing about
  // what some inner adapter already signed, and stripping a real statement to replace it
  // with "nobody signed this" would be a false one.
  if (attestor === 'signs-nothing') return inner
  // Throws here, at composition, if the seed and the certificate disagree.
  signingKeyOf(attestor)

  return {
    nodeId: inner.nodeId,
    async execute(task: Task): Promise<ExecutionOutcome> {
      const outcome = await inner.execute(task)
      if (!outcome.ok) return outcome

      const hashed = await canonicalCid(outcome.output)
      if (!hashed.ok) {
        // A non-finite float is refused by the codec, so this output could never have
        // reached a comparison either — `runOne` fails it a few lines later for the
        // same reason. Reported as this node's failure, naming the node, on
        // `guardModuleProvenance`'s terms: a dispatcher reading a `failures` entry
        // needs to know which machine said no.
        return {
          ok: false,
          reason: `output not encodable on ${inner.nodeId}, so it cannot be attested: ${JSON.stringify(hashed.error)}`,
        }
      }

      return {
        ...outcome,
        attestation: signResult(attestor, {
          moduleCid: task.moduleCid,
          inputCid: task.inputCid,
          partitionIndex: task.partitionIndex,
          outputCid: hashed.cid,
        }),
      }
    },
  }
}
