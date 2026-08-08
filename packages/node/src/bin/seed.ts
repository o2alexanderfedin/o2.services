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
    // **It gates block sources, not the door.** A seed given *this flag alone* still grants
    // a circuit reservation to every peer that completes a handshake and still publishes all
    // of them in `/bootstrap.json`. The door is `--admit-issuer` below.
    'trusted-issuer': { type: 'string', multiple: true },
    // AUTH-02 / AUTH-04 — **the third flag in a family of three, and the one that decides who
    // gets in at all.** A seed binds a real listening socket, so it always relays; until this
    // flag existed the front door of the LAN demo could hold a door open and could not be
    // told to close one, which is the structural fact `24-VERIFICATION.md` scored criterion 8
    // PARTIAL on. Added 2026-08-06 on the owner ruling of that date.
    //
    // ## The disambiguation is mandatory, because these three are one word apart in the
    // source and a world apart in what they authorise
    //
    //   - `--trust-anchor` pins whose *build* records this seed will run a module for
    //     (DET-03). Subject: **a module**.
    //   - `--trusted-issuer` pins whose *enrolment signature* this seed will believe about a
    //     peer it is already talking to (AUTH-02, **selection**). Subject: **a peer this seed
    //     talks to**. It gates block sources; it does not gate the door.
    //   - `--admit-issuer` pins whose certificate gets a peer a **circuit reservation on this
    //     seed** (AUTH-02, **admission**). Subject: **a peer asking to come in**.
    //
    // Three subjects, and a key pinned for one says nothing whatever about the others. None
    // of the three may be folded into another.
    //
    // Repeatable, with the identical `multiple: true` shape as the two above and as
    // `bin/agent.ts`'s flag of the same name: pinning two providers is ordinary configuration
    // and a comma-split string would be a parser nobody asked for.
    //
    // **Omitting it is a stated absence, not a safe default.** Absent, the posture stays
    // exactly `'admits-any-peer'` and every existing argv site keeps working unchanged — see
    // the ternary at `SeedServer.start` for why this one cannot use the conditional-spread
    // idiom its two siblings use.
    //
    // Hex-validated below in its **own** loop, for a reason stated at that loop.
    //
    // Per-node setting, never a node kind. Every seed this binary starts executes tasks,
    // serves blocks, answers records and relays identically whatever is passed here. What
    // differs is who may reserve a circuit *through* it.
    'admit-issuer': { type: 'string', multiple: true },
    // AUTH-01/04 — where a peer this seed will not yet admit should go to be enrolled.
    //
    // **The companion of `--admit-issuer` above, and only meaningful beside it.** Pinning an
    // admission issuer closes the door; this names the door a joiner is meant to knock on
    // first. Without it a closed seed is joinable by nobody who is not already certificated,
    // which the option's docblock has always called operator error — and which, until this
    // flag existed, an operator had no way to avoid.
    //
    // **Singular, where the two issuer flags are repeatable**, and the asymmetry is deliberate
    // rather than an oversight. Pinning several issuers is ordinary — a fabric can believe more
    // than one authority — but publishing several provider addresses would make a joining page
    // choose between them with no basis on which to choose, and a page that picks the wrong one
    // reports a dial timeout. One address, or none.
    'enrollment-provider': { type: 'string' },
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

// The identical loop for the identical reason, and **separate rather than merged with the
// one above**: the message has to name which flag was rejected, and an operator who passed
// both would otherwise be sent to the wrong one. The consequence of skipping it is worse
// here than for `--trusted-issuer` — a zero-filled admission key does not merely stop this
// seed trusting anybody, it stops **every** peer obtaining a reservation, and the peers see
// only `PERMISSION_DENIED`, which carries no reason across a process boundary at all. On the
// one node every browser tab in this fabric reserves on, that is the whole LAN demo dark
// with nothing anywhere reporting that the input was never hex.
for (const issuer of values['admit-issuer'] ?? []) {
  if (parseKeyHex(issuer) === null) {
    refuse(`--admit-issuer ${issuer} is not 64 lowercase hex characters`)
  }
}

// AUTH-01/04 — the shape of `--enrollment-provider`, and **only** its shape.
//
// Reachability is deliberately not checked. A provider on another network is unreachable
// *from this seed* and perfectly reachable from the phone that will use it, so a connectivity
// probe here would refuse correct configurations and is the wrong test at the wrong end.
//
// What is checked is what a mistyped value costs: the page dials it verbatim, and a multiaddr
// with no `/p2p/` component names a host without naming a peer, so libp2p cannot authenticate
// whoever answers. That failure surfaces in a browser tab as a dial timeout with no reason —
// the same silent shape `--admit-issuer`'s validator exists to prevent one tier down.
const enrollmentProvider = values['enrollment-provider']
if (enrollmentProvider !== undefined) {
  if (!enrollmentProvider.startsWith('/')) {
    refuse(`--enrollment-provider ${enrollmentProvider} is not a multiaddr (it must start with /)`)
  }
  if (!enrollmentProvider.includes('/p2p/')) {
    refuse(
      `--enrollment-provider ${enrollmentProvider} names no peer — it needs a /p2p/<peerId> component`,
    )
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
  // AUTH-02 — who this seed admits, stated by name.
  //
  // **A ternary rather than the conditional spread the line above uses, and the difference is
  // forced by the type rather than chosen.** `trustedIssuers` is *optional*, so
  // `exactOptionalPropertyTypes` makes an absent key and an explicit `undefined` different
  // things and that site writes a spread. `relayAdmission` is **required**: there is no key to
  // omit, this site takes a value either way, and the shape is therefore a ternary whose
  // absent arm is the literal open posture. Writing a conditional spread here would not
  // compile, and writing one that did would mean the field had stopped being required.
  //
  // Absent `--admit-issuer`, this is byte-for-byte the value `seed-server.ts` held as a
  // literal before this flag existed, which is what keeps the three `bin/seed.ts` argv sites
  // and every browser tab that has not yet enrolled behaving identically.
  relayAdmission:
    values['admit-issuer'] === undefined ? 'admits-any-peer' : new Set(values['admit-issuer']),
  // Conditional spread, so an unnamed provider leaves the option absent rather than
  // `undefined` — `BootstrapInfo` distinguishes the two and a page reads that distinction.
  ...(enrollmentProvider === undefined ? {} : { enrollmentProvider }),
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
// AUTH-02 — **this seed's own door, in whichever of its two states it is actually in.**
//
// **Corrected 2026-08-06.** This said *"(certificate-gated admission is not armed)"*, and
// after Plan 24-03 armed `denyInboundRelayReservation` on `FabricNode` that parenthetical
// became false: the mechanism exists, and this seed simply held the open posture. An
// operator-facing line that misstates whether a security mechanism exists is the shape this
// repository files as a defect, so it was changed to state *this seed's* posture rather than
// the mechanism's existence.
//
// **Two-armed since Plan 24-06**, and it was one line until then because there was one
// posture. Now that `--admit-issuer` exists, a single-armed banner would lie to whichever
// half of the operators is in the other arm — and `relay-admission.node.test.ts` asserts both
// arms are present for exactly that reason, a missing arm being invisible to a guard that
// only checks the one it was written against.
//
// **The open arm's text is unchanged, deliberately**, so a guard that already reads it still
// finds it. The closed arm names the count **and** the sorted keys: a fixture spawning a
// closed seed has to be able to assert this seed pinned *what it was told*, not merely that
// it pinned something — a typo in a spawn argument otherwise produces an open seed and the
// reading passes for the wrong reason. Public by construction, on the same ground
// `bin/agent.ts` publishes the identical value on its handshake line: these are pinned issuer
// **public** keys.
//
// Sub-decision 1's deployment requirement rides on the closed arm, said where an operator
// who has just closed a door reads it rather than only in a planning document. It is not
// hypothetical for a seed: this is the node every browser tab reserves on, so an operator who
// pins issuers here without a reachable provider has a fabric nobody new can join. Plan 24-05
// measured that enrolment itself survives a closed provider — `resolveCertificate` dials
// plain and reserves nothing — so the failure this warns about is *no provider*, not *a
// closed one*.
//
// The label stays `admits`. `trust-anchors.node.test.ts` finds the anchor line by searching
// for `trusts` and `issuers` is already taken by `--trusted-issuer`, so a second line
// carrying either word would be found first by half the runs.
const admitIssuers = [...(values['admit-issuer'] ?? [])].sort()
line(
  admitIssuers.length === 0
    ? '  admits     every peer that completes a handshake (this seed pins no admission issuer)'
    : `  admits     only peers certified by ${admitIssuers.length} pinned admission issuer${admitIssuers.length === 1 ? '' : 's'} (from --admit-issuer): ${admitIssuers.join(' ')}` +
        ` — a relay that pins issuers must serve enrolment itself or name a provider a joining peer can reach without a reservation`,
)

// AUTH-01/04 — **which of the two states the sentence above leaves this seed in, resolved.**
//
// The `admits` line states a deployment requirement; until 2026-08-08 it stated one an operator
// could not satisfy, and could not tell whether they had. This line answers it by name.
//
// Printed only when it carries information. An open seed admits every peer and needs no
// provider, so a line there would be an answer to a question nobody asked — the same argument
// `SeedServerOptions.enrollmentProvider` makes for not defaulting the field.
//
// **Carries neither `trusts` nor `issuers`.** `trust-anchors.node.test.ts` locates the anchor
// line by searching for `trusts`, and `issuers` already belongs to `--trusted-issuer`; a line
// here holding either word would be found first by half the runs. `enrol at` shares no word
// with either label.
if (admitIssuers.length > 0 || enrollmentProvider !== undefined) {
  line(
    enrollmentProvider === undefined
      ? '  enrol at   NOBODY — this seed admits only certificated peers and names no provider,' +
          ' so no new peer can join it (pass --enrollment-provider)'
      : `  enrol at   ${enrollmentProvider} (from --enrollment-provider)` +
          (admitIssuers.length === 0
            ? ' — published for joiners, though this seed admits every peer anyway'
            : ''),
  )
}
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
