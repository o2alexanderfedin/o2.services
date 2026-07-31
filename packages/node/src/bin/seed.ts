/**
 * `o2 seed` — run a node another device on your network can join.
 *
 * Prints the URL to open, and a QR code so a phone can reach it without anyone
 * typing an address. The `.local` name is offered first: macOS and most Linux
 * desktops already publish it over mDNS/Bonjour, iOS resolves it natively, and unlike
 * an IP it survives the DHCP lease changing.
 *
 * A browser cannot do mDNS itself, so the one URL is unavoidable. Everything after it
 * is derived: the page asks its own origin for `/bootstrap.json` and is told to dial
 * the very host it already reached.
 */

import { parseArgs } from 'node:util'
import { KERNEL_TRUST_ANCHOR } from '@o2/demo'
import qrcode from 'qrcode-terminal'
import { SeedServer } from '../seed-server.ts'

const { values } = parseArgs({
  options: {
    dir: { type: 'string', default: '.o2-seed' },
    port: { type: 'string', default: '5173' },
    'ws-port': { type: 'string', default: '0' },
    reservations: { type: 'string', default: '64' },
    // The same repeatable flag `bin/agent.ts` takes, with the identical default
    // expression — read that binary's comment for the four things the flag decides.
    // Not a different default, and not a differently-spelled same default:
    // `trust-anchors.node.test.ts` compares the two files' expressions textually, and
    // that comparison only means something if both are written the same way.
    //
    // The seed's own reason for that value, on top of the shared one: `o2 seed` exists
    // to serve the colouring demo to another device, and `packages/browser/demo/index.html`
    // feeds `computePeers()` straight into `runColouring`'s `peerIds`, so this node
    // really does receive kernel dispatches from a visitor's tab. A seed that refused
    // the very kernel it is serving would make DEMO-01 fail in the field with a refusal
    // nobody could read.
    'trust-anchor': { type: 'string', multiple: true },
  },
})

const trustAnchors = values['trust-anchor'] ?? [KERNEL_TRUST_ANCHOR]

const seed = await SeedServer.start({
  blockstoreDir: values.dir ?? '.o2-seed',
  httpPort: Number(values.port),
  wsPort: Number(values['ws-port']),
  maxReservations: Number(values.reservations),
  trustAnchors,
})

const line = (text = ''): void => {
  process.stdout.write(`${text}\n`)
}

// One line, because there is one node. Two lines here — "relay" and "seed node" —
// were the visible symptom of two peer ids in one process, only one of which would
// run a task.
line()
line('  o2 seed node')
line('  ───────────────────────────────────────────────')
line(`  peer id    ${seed.node.peerId}`)
line(`  it does    executes tasks, serves blocks, relays for peers that cannot listen`)
line(`  capacity   ${seed.node.capacity.limit} reservations`)
// DET-03: what this process will actually run a module for, so an operator can see it
// without reading the source.
//
// **Nothing asserts this line.** No test spawns `bin/seed.ts`, so its presence and its
// wording are unmeasured. What would measure them is a test that spawns the binary with
// `--port 0 --ws-port 0 --dir <tmp>` and reads stdout; that is not done here because the
// binary boots a Vite dev server, which is a minute of test time for one line of output.
// The property the line reports is covered from two sides instead:
// `trust-anchors.node.test.ts` compares this binary's default expression with
// `bin/agent.ts`'s in source, and Plan 14-05 reads the agent's actual pinned set out of
// its handshake across a real process boundary.
line(
  `  trusts     ${trustAnchors.length} pinned anchor${trustAnchors.length === 1 ? '' : 's'}` +
    `${values['trust-anchor'] === undefined ? ' (the demo default — pass --trust-anchor to replace it)' : ' (from --trust-anchor)'}`,
)
line()
line('  Open on another device:')
line(`    ${seed.joinUrl}`)
for (const url of seed.joinUrlsByIp) line(`    ${url}   (if .local is blocked)`)
line()

qrcode.generate(seed.joinUrl, { small: true }, (code) => {
  line(code)
})

line('  The page asks this origin who to dial, so nothing is hardcoded.')
line('  Ctrl-C to stop.')
line()

let stopping = false
const shutdown = (): void => {
  if (stopping) return
  stopping = true
  void seed.stop().then(
    () => process.exit(0),
    () => process.exit(1),
  )
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
