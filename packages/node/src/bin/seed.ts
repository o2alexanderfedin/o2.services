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
 *
 * ## This process stops when the process that spawned it goes away
 *
 * The same leash `bin/agent.ts` carries, from the same module, for the same reason: on
 * POSIX a child does not die with its parent and `SIGKILL` runs no handler. A seed leaks
 * harder than an agent when it leaks — it holds a Vite dev server, a libp2p node, and a
 * low TCP port. **Measured on the machine this was written on:** a `bin/seed.ts` five days
 * and twenty-three hours old, 40 MB resident, still holding port 5173.
 *
 * That one was started by hand in a terminal and its shell was still alive, so it was the
 * operator's and not a leak — and `../orphan-leash.ts`'s `fstat` gate is exactly what keeps
 * this change from killing it. A tty is a character device; the leash does not arm.
 */

import { parseArgs } from 'node:util'
import { KERNEL_TRUST_ANCHOR } from '@o2/demo'
import qrcode from 'qrcode-terminal'
import { armOrphanLeash } from '../orphan-leash.ts'
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

/**
 * The server, once it exists.
 *
 * `let` rather than `const`, and the leash below is armed *before* `SeedServer.start`,
 * because the startup window is not free: standing up a libp2p node and a Vite dev server
 * takes long enough to be interrupted, and a parent killed during it would orphan this
 * process before there was anything to shut down. Both halves tolerate not existing —
 * `shutdown` checks, and leaving during startup is safe to do abruptly.
 */
let seed: SeedServer | undefined

let stopping = false
const shutdown = (): void => {
  if (stopping) return
  stopping = true
  if (seed === undefined) {
    process.exit(0)
  }
  void seed.stop().then(
    () => process.exit(0),
    () => process.exit(1),
  )
}

// Declared together so the three ways this process can be told to stop read as one
// paragraph, and armed here so the startup below is covered rather than only the run.
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
armOrphanLeash(shutdown)

seed = await SeedServer.start({
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
// NET-05: the address an agent is actually pointed at.
//
// **Nothing printed here was dialable by a peer before this line.** The join URLs below
// are HTTP, for a browser; `--relay-addr` needs a multiaddr, and an operator who wanted
// one had to read `seed-server.ts` to learn how to build it. A criterion whose own
// configuration is unreachable without reading the source is not configured, it is
// guessed at.
//
// Every one of them, not the first. This node binds `0.0.0.0`, so libp2p expands it to
// one address per interface and which comes first is not fixed — printing "the" address
// would print a LAN IP on one host and loopback on another, and the operator on the other
// side of the room needs the one this listing does not privilege.
for (const address of seed.node.browserDialableAddrs) {
  line(`  relay      ${address}`)
}
// DET-03: what this process will actually run a module for, so an operator can see it
// without reading the source.
//
// **This line is asserted**, in both its branches, by `trust-anchors.node.test.ts` — it
// spawns this binary and reads the banner back. It previously said the opposite, on the
// grounds that spawning the seed cost *a minute of test time for one line of output*.
// Measured while adding the leash above: the full banner appears **590 ms** after spawn.
// The estimate was wrong by two orders of magnitude, and it had been repeated in two other
// files as a reason not to look.
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
