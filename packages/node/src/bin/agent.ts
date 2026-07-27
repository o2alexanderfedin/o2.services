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
    'can-execute-sovereign': { type: 'boolean', default: false },
  },
})

if (values.dir === undefined) {
  process.stderr.write(
    'usage: agent.ts --dir <blockstore-dir> [--port <n>] [--owner-id <id> [--can-execute-sovereign]]\n',
  )
  process.exit(2)
}

const node = await FabricNode.start({
  blockstoreDir: values.dir,
  listen: [`/ip4/127.0.0.1/tcp/${values.port}`],
  ...(values['owner-id'] === undefined
    ? {}
    : {
        sovereignty: {
          ownerId: values['owner-id'],
          canExecuteSovereign: values['can-execute-sovereign'],
        },
      }),
})

// The parent waits for exactly this line before dialling.
process.stdout.write(`${JSON.stringify({ peerId: node.peerId, multiaddrs: node.multiaddrs })}\n`)

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
