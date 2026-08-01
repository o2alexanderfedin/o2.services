/**
 * A standalone fabric agent process.
 *
 * Started with a blockstore directory, it listens, serves task dispatches and block
 * requests, and prints one JSON line describing how to reach it:
 *
 *   { "peerId": "12D3Koo…", "multiaddrs": ["/ip4/127.0.0.1/tcp/54321/p2p/12D3Koo…"] }
 *
 * The handshake is deliberately a single line on stdout rather than a fixed port or
 * a discovery service: the OS assigns the port, so parallel runs cannot collide,
 * and the parent learns the address without polling.
 *
 * This exists so "two processes" means two real ones. Three nodes inside one Vitest
 * process share a heap, an event loop, and a module registry — which is enough to
 * exercise the transport but not enough to prove the boundary. A separate process
 * shares nothing but the socket.
 */

import { parseArgs } from 'node:util'
import { KERNEL_TRUST_ANCHOR } from '@o2/demo'
import { FabricNode } from '../fabric-node.ts'

const { values } = parseArgs({
  options: {
    dir: { type: 'string' },
    port: { type: 'string', default: '0' },
    // DATA-09's serving-side clearance (`FabricNodeOptions.sovereignty`), exposed
    // here so a test can spawn a real agent process already cleared for a given
    // owner rather than reaching in and mutating a running node. Omitting
    // `--owner-id` entirely keeps the safe default (cleared for nobody) — this
    // is a per-node clearance flag, not a node kind: every agent process built by
    // this binary has identical capability regardless of whether it is passed.
    'owner-id': { type: 'string' },
    // AUTH-03's pinned trust anchor (`NodeSovereignty.ownerKey`): the ed25519 public
    // key, hex-encoded, that a capability chain naming `--owner-id` must be rooted at.
    // Without it this process refuses every sovereign task naming that owner, because
    // it has no key to verify a chain against — the safe default, and the same shape as
    // omitting `--can-execute-sovereign`.
    //
    // A **public** key on a command line is fine, and nothing in this repository ever
    // accepts a private one on an interface like this — `enrollment.ts`'s stated rule.
    // Where the owner's private half actually comes from is Phase 17's concern; this
    // phase pins only the public half, by configuration.
    //
    // Flag collision, recorded rather than resolved (14-CONTEXT.md Risk 3): Phase 14
    // proposed a `--trust-anchor` flag on this same binary and it landed above. Phase
    // 15 does not depend on Phase 14 and must not block on it, so this is a third flag
    // rather than a refactor. Whichever phase touches this block next should fold all
    // three into one flags object rather than accreting a fourth.
    'owner-key': { type: 'string' },
    'can-execute-sovereign': { type: 'boolean', default: false },
    // DET-03/DATA-08's per-node build authority (`FabricNodeOptions.trustAnchors`),
    // repeatable. Four things about it, all of which decide behaviour:
    //
    // Supplying it **replaces** the default rather than extending it, so an operator
    // running an agent for another build authority is not still trusting the demo's.
    //
    // The default is the demo's committed anchor because that is the only artifact
    // this repository ships, and its signing key's private half was discarded at
    // generation time (`packages/demo/scripts/sign-kernel.ts`) — so the default can
    // never authorise anything except the one record this repository committed. Out
    // of the box this binary runs exactly that module and refuses every other.
    //
    // Per-node setting, not a node kind: every agent process built by this binary is
    // identical whether or not it is passed, exactly as `--owner-id` is.
    //
    // And there is no flag that turns provenance off. The omission is deliberate — a
    // shipped binary should not carry one.
    'trust-anchor': { type: 'string', multiple: true },
  },
})

if (values.dir === undefined) {
  process.stderr.write(
    'usage: agent.ts --dir <blockstore-dir> [--port <n>] [--owner-id <id> [--owner-key <hex>] [--can-execute-sovereign]] [--trust-anchor <hex> ...]\n',
  )
  process.exit(2)
}

// Resolved once so the line printed below reports what was actually pinned rather
// than re-deriving it and risking the two disagreeing.
const trustAnchors = values['trust-anchor'] ?? [KERNEL_TRUST_ANCHOR]

const node = await FabricNode.start({
  blockstoreDir: values.dir,
  listen: [`/ip4/127.0.0.1/tcp/${values.port}`],
  trustAnchors,
  ...(values['owner-id'] === undefined
    ? {}
    : {
        sovereignty: {
          ownerId: values['owner-id'],
          // Same conditional-spread idiom as the enclosing one, and required for the
          // same reason: `exactOptionalPropertyTypes` makes an absent key and an
          // explicit `undefined` different types, and `NodeSovereignty.ownerKey` is
          // optional. Omitting it is what pins this process to no key at all.
          ...(values['owner-key'] === undefined ? {} : { ownerKey: values['owner-key'] }),
          canExecuteSovereign: values['can-execute-sovereign'],
        },
      }),
})

// The parent waits for exactly this line before dialling.
//
// `trustAnchors` is the set handed to `FabricNode.start` above, not a restatement of
// the source's intent — which is the point of printing it. An anchor is a public key,
// so publishing it discloses nothing, and it turns "the default is what the source
// says" into a reading a parent process can take across a real process boundary.
// Adding a field is additive for the parents that parse this line; they read named
// fields.
process.stdout.write(
  `${JSON.stringify({ peerId: node.peerId, multiaddrs: node.multiaddrs, trustAnchors })}\n`,
)

let stopping = false
const shutdown = (): void => {
  if (stopping) return
  stopping = true
  void node.stop().then(
    () => process.exit(0),
    () => process.exit(1),
  )
}

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
