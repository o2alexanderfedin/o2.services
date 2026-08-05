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
import { parseKeyHex } from '@o2/libp2p'
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
    // AUTH-02 — **a different flag for a different claim, and the separation is the whole
    // point of it.** `--trust-anchor` above pins whose *build* records this seed will run a
    // module for (DET-03). This pins whose *enrollment* signature it will believe about a
    // peer. A module and a peer are different subjects, and a key pinned for one says
    // nothing about the other, so neither flag may be folded into the other.
    //
    // Repeatable, with the identical `multiple: true` shape as `--trust-anchor` and as
    // `bin/agent.ts`'s flag of the same name: pinning two providers is ordinary
    // configuration and a comma-separated string would be a parser nobody asked for.
    //
    // Omitting it means this seed verifies nobody and treats every connected peer as
    // usable, which is what every node did before this flag existed. That absence is
    // stated in `FabricNodeOptions.trustedIssuers`, not defaulted here — which is why
    // there is no `KERNEL_*` fallback on this line where `--trust-anchor` has one.
    //
    // **It gates block sources, not the door.** A seed given this flag still grants a
    // circuit reservation to every peer that completes a handshake and still publishes all
    // of them in `/bootstrap.json`. See `RelayAdmission` for who gets in.
    'trusted-issuer': { type: 'string', multiple: true },
  },
})

const trustAnchors = values['trust-anchor'] ?? [KERNEL_TRUST_ANCHOR]

/** How this binary refuses a flag it cannot use. Same shape and exit code as `bin/agent.ts`. */
function refuse(reason: string): never {
  process.stderr.write(`seed.ts: ${reason}\n`)
  process.exit(2)
}

// `fromHex` does not validate and does not throw — it zero-fills. A mistyped
// `--trusted-issuer` would otherwise produce a seed that refuses every peer as
// `untrusted-issuer` with nothing anywhere reporting that the input was never hex, because
// `publicKeyFromRaw` accepts 32 zero bytes as a perfectly good key. This is `bin/agent.ts`'s
// validator, reached from the other binary rather than reimplemented, and the message names
// **which** flag and **which** value was rejected so an operator who passed several does not
// have to guess.
for (const issuer of values['trusted-issuer'] ?? []) {
  if (parseKeyHex(issuer) === null) {
    refuse(`--trusted-issuer ${issuer} is not 64 lowercase hex characters`)
  }
}

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
  // Absent adds no key at all — `exactOptionalPropertyTypes` makes an omitted key and an
  // explicit `undefined` different types, and a seed told nothing must pin nothing rather
  // than pin an empty set.
  ...(values['trusted-issuer'] === undefined ? {} : { trustedIssuers: values['trusted-issuer'] }),
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
// AUTH-02, and **printed as its own line saying its own noun**, because an operator who
// reads only this banner must not be able to confuse the two pinnings. The line above says
// what this node will *run*; this one says whose word it takes about *who a peer is*. They
// are one word apart in the source and a world apart in what they authorise, so the output
// spells the difference out rather than printing two counts of "trusted keys".
//
// The label is deliberately not "trusts": `trust-anchors.node.test.ts` finds the anchor
// line by searching for that word, and a second line containing it would be found first
// by half the runs and neither assertion would say which.
const trustedIssuers = values['trusted-issuer'] ?? []
line(
  trustedIssuers.length === 0
    ? '  issuers    none pinned — every connected peer is treated as usable (pass --trusted-issuer <hex>)'
    : `  issuers    ${trustedIssuers.length} pinned certificate issuer${trustedIssuers.length === 1 ? '' : 's'} (from --trusted-issuer)`,
)
// Sub-decision 1's deployment requirement, said where an operator running the command
// reads it rather than only in a planning document. It is a no-op today — this node admits
// every peer and also answers enrolment — and it is printed anyway, because the moment a
// deployment separates the provider from the relay it becomes the difference between a
// fabric anyone can join and one nobody new can.
line('  admits     every peer that completes a handshake (certificate-gated admission is not armed)')
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
