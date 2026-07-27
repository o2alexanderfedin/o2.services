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
import qrcode from 'qrcode-terminal'
import { SeedServer } from '../seed-server.ts'

const { values } = parseArgs({
  options: {
    dir: { type: 'string', default: '.o2-seed' },
    port: { type: 'string', default: '5173' },
    'ws-port': { type: 'string', default: '0' },
    reservations: { type: 'string', default: '64' },
  },
})

const seed = await SeedServer.start({
  blockstoreDir: values.dir ?? '.o2-seed',
  httpPort: Number(values.port),
  wsPort: Number(values['ws-port']),
  maxReservations: Number(values.reservations),
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
