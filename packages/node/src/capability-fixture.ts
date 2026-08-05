/**
 * The capability chains the node-tier specs dispatch with — AUTH-03.
 *
 * **This module is test-only.** It is imported by relative path from the node-tier
 * specs and is deliberately **not** re-exported from `packages/node/src/index.ts`, so
 * it exposes no capability that Phase 22's reachability guard could trace to an entry
 * point. A barrel-exported fixture would hand that guard a real finding this phase
 * invented. The precedent is `packages/core/src/executor/fixtures.ts`, which lives
 * beside production source and is reached the same way.
 *
 * `packages/node` is in neither `PORTABLE` nor `DUAL_TARGET`
 * (`purity.node.test.ts`), so nothing here is constrained in what it may import —
 * confirmed by reading that file rather than assumed. It imports `@o2/libp2p` for
 * `audienceKeyOf`, which a portable package could not.
 *
 * **The private keys below are seeded fixtures and are never a deployment key.**
 * Where an owner's private key actually comes from in a real deployment — the
 * Argon2id-derived user key of design §3.9, and the provider-signed node certificate
 * of AUTH-01/02 — is Phase 17's `enrollment.ts`. Phase 15 pins only the public half,
 * by configuration, and says so.
 */

import { delegate } from '@o2/core'
import type { Delegation, PublicKeyHex, Task } from '@o2/core'
import type { CapabilitySupplier } from '@o2/net'
import { audienceKeyOf } from '@o2/libp2p'

/**
 * A public key derived through `delegate` rather than through `@noble/curves`.
 *
 * Deliberate, and the justification is repeated here rather than pointed at: `delegate`
 * computes the issuer's public key as part of signing and is the only public-key
 * derivation `@o2/core` exposes. The alternative is adding `@noble/curves` to
 * `packages/node/package.json` — it is not a declared dependency of `@o2/node` today,
 * and only resolves in the specs that import it because the root install hoists it —
 * which would mean an `npm install` in a working tree several agents share.
 *
 * A second property worth having: this is the *same* derivation `delegate` uses when
 * it signs, so a fixture cannot disagree with itself and produce a `bad-signature` that
 * sends a reader hunting through `verifyChain`.
 */
function publicKeyOf(priv: Uint8Array): PublicKeyHex {
  return delegate(priv, {
    ownerId: 'throwaway',
    audience: 'throwaway',
    abilities: ['execute'],
    expiresAt: 1,
  }).issuer
}

/**
 * Seeded rather than random, so a failure is reproducible and a reader can tell which
 * principal is which from the test alone — `capability.test.ts:12-15`'s pattern.
 *
 * **Seeds 111/112/113, and the choice is load-bearing.** Non-overlapping seeds are
 * what stop one file's fixture from satisfying another file's assertion: two files
 * sharing a seed share a key, and a chain minted in one would verify in the other for
 * reasons neither test states. The plan for this module specified 41/42/43. Those were
 * already taken — `fabric-node.node.test.ts` itself declares `publisher = keypair(41)`
 * and `impostor = keypair(42)` under a comment claiming they are distinct from every
 * other fixture key in the repository, and that file is this module's first importer.
 * Re-grepped 2026-07-31: 1, 2, 3, 7, 9, 11, 12, 21-24, 30, 31, 40-42, 50, 60, 61,
 * 70-73, 80-82 and 90-99 are all in use; 111-113 are free.
 */
function keypair(seed: number): { priv: Uint8Array; pub: PublicKeyHex } {
  const priv = new Uint8Array(32).fill(seed)
  return { priv, pub: publicKeyOf(priv) }
}

/** The data owner. Every chain in this module is rooted at her key. */
const owner = keypair(111)
/** An intermediate the owner may delegate through. */
const coordinator = keypair(112)
/** Uninvited — holds no delegation from anybody, and issues a link anyway. */
const thirdParty = keypair(113)

/** The owner id every fixture chain is scoped to, and every node here is pinned to. */
export const OWNER_ID = 'alice'

/**
 * The owner's public key, hex-encoded — what a serving node pins as
 * `NodeSovereignty.ownerKey` and what `bin/agent.ts` receives as `--owner-key`.
 *
 * A public key, so passing it on a command line discloses nothing. The private half
 * never leaves this module.
 */
export const OWNER_KEY: PublicKeyHex = owner.pub

/**
 * Sixty seconds, computed **at call time rather than at module load**.
 *
 * A constant evaluated when this module is first imported would start expiring the
 * moment the suite began, and these suites spawn real processes and dial real sockets.
 * A slow run could then expire a fixture mid-test and produce an `expired` refusal in a
 * test about something else entirely.
 */
function defaultExpiry(): number {
  return Date.now() + 60_000
}

/**
 * owner → node, directly. `abilities: ['execute']`.
 *
 * The accepted single-link case. `nodeId` is the serving node's peer id string; the
 * audience is derived from it with `audienceKeyOf`, which is the identical key that
 * node derives from its own `libp2p.peerId`. Nothing is exchanged to make those agree.
 */
export function directChainFor(
  nodeId: string,
  ownerId: string = OWNER_ID,
  expiresAt: number = defaultExpiry(),
): Delegation[] {
  return [
    delegate(owner.priv, {
      ownerId,
      expiresAt,
      audience: audienceKeyOf(nodeId),
      abilities: ['execute'],
    }),
  ]
}

/**
 * owner → coordinator (`['execute', 'delegate']`) → node (`['execute']`).
 *
 * The accepted **depth** case: two links, the first of which actually granted
 * `delegate`, so the second is a legitimate re-delegation.
 */
export function delegatedChainFor(
  nodeId: string,
  ownerId: string = OWNER_ID,
  expiresAt: number = defaultExpiry(),
): Delegation[] {
  return [
    delegate(owner.priv, {
      ownerId,
      expiresAt,
      audience: coordinator.pub,
      abilities: ['execute', 'delegate'],
    }),
    delegate(coordinator.priv, {
      ownerId,
      expiresAt,
      audience: audienceKeyOf(nodeId),
      abilities: ['execute'],
    }),
  ]
}

/**
 * owner → coordinator (`['execute']` **only**) → node. Refused as `not-delegable`.
 *
 * **This is the fixture whose point is easiest to miss, so: it and
 * `delegatedChainFor` are both length 2, both parse, and both are signature-valid.
 * They differ in exactly one ability string.** A check that counted links would accept
 * both. That is what makes this pair a proof that delegation *depth* is checked rather
 * than merely the chain's presence — the coordinator was never granted `delegate` and
 * re-delegated anyway, and `verifyChain` refuses at the second link
 * (`capability.ts:193-198`) with *"link 1 was re-delegated, but its issuer was never
 * granted \"delegate\""*.
 */
export function undelegableChainFor(
  nodeId: string,
  ownerId: string = OWNER_ID,
  expiresAt: number = defaultExpiry(),
): Delegation[] {
  return [
    delegate(owner.priv, {
      ownerId,
      expiresAt,
      audience: coordinator.pub,
      abilities: ['execute'],
    }),
    delegate(coordinator.priv, {
      ownerId,
      expiresAt,
      audience: audienceKeyOf(nodeId),
      abilities: ['execute'],
    }),
  ]
}

/**
 * owner → coordinator (`['execute', 'delegate']`), then link 1 issued by an uninvited
 * third party. The links do not join up. Refused as `broken-link`.
 *
 * **Why this exists alongside `undelegableChainFor`, when 15-CONTEXT.md decision 8
 * originally concluded one of the two could be dropped.** `broken-link` is not a
 * paraphrase in this repository — it is a named `ChainFailure` kind
 * (`capability.ts:92`) with its own text, ``link ${index} is issued by ${found}, but
 * link ${index - 1} delegated to ${expected}`` (`:107-108`), reached at `:162-167` —
 * **and it is the failure kind ROADMAP criterion 3 names in its own words**: *"a chain
 * with a broken delegation link is refused"*. Verified by grep: `broken-link` occurs in
 * `capability.ts` and in `capability.test.ts` and nowhere else, so without this fixture
 * the kind the criterion literally names would never cross a wire, never appear in a
 * refusal a requestor reads, and have no cross-process evidence at all — and an auditor
 * checking criterion 3 against the source would correctly conclude it was answered with
 * a different mechanism.
 *
 * It strengthens the depth argument rather than diluting it. This chain is also length
 * 2 and also parses: three same-length, same-parse chains, one accepted and two refused
 * for two differently-named reasons, is a sharper reading than two.
 */
export function brokenLinkChainFor(
  nodeId: string,
  ownerId: string = OWNER_ID,
  expiresAt: number = defaultExpiry(),
): Delegation[] {
  return [
    delegate(owner.priv, {
      ownerId,
      expiresAt,
      audience: coordinator.pub,
      abilities: ['execute', 'delegate'],
    }),
    // Issued by the third party, whom the link above delegated nothing to.
    delegate(thirdParty.priv, {
      ownerId,
      expiresAt,
      audience: audienceKeyOf(nodeId),
      abilities: ['execute'],
    }),
  ]
}

/**
 * A `CapabilitySupplier` for one serving node: a direct owner→node chain for a
 * sovereign task carrying an owner, and an empty array for anything else.
 *
 * One helper drives every repaired call site in the node tier. The empty return for a
 * public task is not a refusal and not a stub — a public task has no owner and
 * therefore no key a chain could be rooted at, and `authorizeCapability` returns `null`
 * for one before it ever looks at the chain.
 *
 * The chain is minted **per task**, from `task.ownerId`, because one `RemoteExecutor`
 * serves every shard of a job and shards may name different owners. That is the whole
 * reason `CapabilitySupplier` is a function of the task rather than a fixed array.
 */
export function chainSupplierFor(nodeId: string): CapabilitySupplier {
  return (task: Task): readonly Delegation[] =>
    task.label === 'sovereign' && task.ownerId !== undefined
      ? directChainFor(nodeId, task.ownerId)
      : []
}
