/**
 * A standalone fabric agent process.
 *
 * Started with a blockstore directory, it listens, serves task dispatches and block
 * requests, and prints one JSON line describing how to reach it and who it says it is:
 *
 *   { "peerId": "12D3Koo…", "multiaddrs": ["/ip4/127.0.0.1/tcp/54321/p2p/12D3Koo…"],
 *     "trustAnchors": ["…"], "nodeKey": "…", "certificate": null, "issuerKey": null,
 *     "peers": [], "dutyCycle": 1 }
 *
 * The handshake is deliberately a single line on stdout rather than a fixed port or
 * a discovery service: the OS assigns the port, so parallel runs cannot collide,
 * and the parent learns the address without polling.
 *
 * This exists so "two processes" means two real ones. Three nodes inside one Vitest
 * process share a heap, an event loop, and a module registry — which is enough to
 * exercise the transport but not enough to prove the boundary. A separate process
 * shares nothing but the socket.
 *
 * ## What may cross the handshake line, and what may never
 *
 * Every field on that line is **public by construction**: a peer id, listen addresses,
 * pinned build-authority public keys, this node's own public `nodeKey`, the whole of the
 * provider-signed certificate, the public half of the provider key when this process
 * holds one, and the peer ids this process dialled. Nothing secret crosses it, and
 * nothing secret may be added to it — a parent process reads this line and so does
 * anything that can read this process's stdout.
 *
 * `certificate` and `issuerKey` are **present and `null`** rather than absent when there
 * is nothing to report. An absent field and a stated absence read identically to
 * `JSON.parse`, and only one of them is a statement. `certificate` carries the *whole*
 * certificate rather than a summary, because a parent has to be able to compare what this
 * node advertised against what a peer fetches from it over the `records` request, and a
 * summary would make that comparison impossible.
 *
 * `peers` is the same rule applied to a third field, and it is **present and `[]`** when
 * no `--peer-addr` was given rather than absent. A peer id is public by construction
 * exactly as `peerId` and `nodeKey` above are — it is derived from a public key and is
 * printed by every node in this repository — so publishing the ones this process reached
 * discloses nothing. What it buys is that a parent knows the dial happened *before* it
 * asserts anything about the dial's consequences: the line is written after the dials, so
 * a parent that has read it is reading a completed peering rather than an intention.
 *
 * Adding a field is additive for existing parents: each reads only the keys it names.
 *
 * ## No flag on this binary accepts key material
 *
 * argv is world-readable in `ps` to every account on the host, so a private key on a
 * command line is a private key everybody has. `--issues-certificates` is therefore a
 * boolean and the provider signing key is generated on-device into `<dir>/.provider.key`;
 * `--user-key` names a **file** holding the user's 32-byte seed and never the seed itself.
 * Public keys — `--owner-key`, `--trust-anchor`, `--trusted-issuer` — are fine on a
 * command line and are passed as hex.
 *
 * ## This process stops when the process that spawned it goes away
 *
 * On POSIX a child does not die with its parent, and `SIGKILL` runs no handler, so no
 * amount of care in the spawning test covers an interrupted run. The leash lives in
 * `../orphan-leash.ts` — read that module for the `fstat` table that decides when it arms
 * and why an operator at a terminal is excluded by the same clause that excludes
 * `/dev/null`. It is shared with `bin/seed.ts` rather than copied into it.
 */

import { readFile } from 'node:fs/promises'
import { parseArgs } from 'node:util'
import { KERNEL_TRUST_ANCHOR } from '@o2/demo'
import { SEED_BYTES, identityFromSeed, parseKeyHex } from '@o2/libp2p'
import { FabricNode } from '../fabric-node.ts'
import { armOrphanLeash } from '../orphan-leash.ts'
import { ReservationWatcher } from '../reservation-watch.ts'

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
    //
    // ## AUTH-05 — this flag and `--user-key` name ONE value, and the collision was real
    //
    // An enrolling process derives its owner id from `--user-key` (see the check below
    // `readUserSeed`), and this flag survives for a process that does **not** enrol. Both
    // halves matter, so both are written down.
    //
    // The collision that made it necessary: `OwnerId` is an opaque string
    // (`core/src/sovereignty.ts`), and *two different kinds of string flowed into that one
    // field from two directions*. A discovery-derived descriptor sets
    // `ownerId = certificate.userKey` — a 64-character hex ed25519 key
    // (`net/src/discover-candidates.ts`) — while this flag took whatever an operator
    // typed. A `PlacementRequest.ownerId` holding an operator label therefore matched no
    // discovery-derived descriptor, and a sovereign shard came back `unplaceable` **with
    // nothing anywhere obviously wrong**. `net/src/sovereign-execution.test.ts` dodged it
    // by making its owner id *be* a hex key; a real deployment could not.
    //
    // **A disagreement between the two is exit 2, never a precedence rule.** Letting
    // either win would produce a node that starts, serves, and is cleared for an identity
    // the fabric will never ask about — the same silent stall, moved one step earlier and
    // made harder to see. `--owner-id` passed *equal* to the derived key is accepted, so
    // every spawn that already does the right thing keeps working unchanged.
    //
    // **What this does NOT unify, and it is the honest limit.** A *requestor* choosing
    // which owner to pin a shard to still passes whatever string it holds; if that string
    // is not a user key the shard is still unplaceable, correctly. What is closed is that
    // a node's own clearance can no longer disagree with the certificate a provider signed
    // about it.
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
    //
    // **Phase 18 accreted instead, and the reason is recorded here rather than left to
    // look like an oversight.** Three plans in Phase 18 each add a flag to this same
    // `parseArgs` object, in three different waves: 18-01's `--peer-addr` and
    // `--max-concurrent-tasks`, 18-08's `--duty-cycle`, and 18-11's `--relay-addr`. A
    // refactor landed in wave 1 would be re-litigated twice before the phase ended, and
    // each re-litigation would touch a file two other plans hold open. The instruction is
    // therefore carried forward rather than discharged: whichever phase touches this file
    // next **with no other plan behind it** should do the fold.
    //
    // **Phase 19 carries it forward once more, and this time the successor is named.**
    // Plan 19-09 (which added the owner-id derivation below) added no flag at all and
    // still declined the fold, because **Plan 19-07 touches this same file after it** —
    // wave 7, `depends_on: ["05", "09", "15"]` — for AUTH-04's durable issuance ledger.
    // Doing the fold here would have handed that plan a rewritten `parseArgs` object to
    // rebase onto for no benefit it asks for. 19-07 is the phase's **last** touch of this
    // binary and therefore the plan with nothing behind it.
    //
    // **This flag is deliberately NOT derived the way `--owner-id` now is.** It would be
    // tempting: when a node enrols, the natural root for a capability chain naming its
    // owner *is* that owner's user key, whose public half this binary now derives anyway.
    // But defaulting it would silently pin every already-enrolling agent to an owner key
    // it was never given, turning `authorizeCapability`'s "no pinned owner key" refusal —
    // the safe default — into an acceptance nobody asked for. A clearance may be derived
    // from a signed statement; a trust anchor is configuration, and the operator supplies
    // it.
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
    // AUTH-01: the multiaddr of a node that issues certificates. Supplying it makes
    // enrollment part of starting: this process dials that address, asks to be certified,
    // and **does not start at all** if it is refused or the address is unreachable. That
    // is `FabricNodeOptions.enrollment`'s stated contract, not a choice made here — a node
    // told to enrol, unable to, and running anyway is a node whose identity claim is
    // silently absent.
    //
    // Per-node setting, not a node kind: every agent process built by this binary has
    // identical capability whether or not it is passed.
    'provider-addr': { type: 'string' },
    // AUTH-01: the path to a **file** holding the 32 raw bytes of the user key several of
    // this operator's nodes may share. Three things about it, each of which decides
    // behaviour.
    //
    // **It is a path and not `--user-key <hex>`, and that is not a style preference.**
    // `EnrollmentAuthority.enrol` requires an `ownerProof` — the *user's* signature over
    // the same possession challenge the node signs — and refuses `bad-owner-proof` without
    // one. Only the private half can produce that, so a hex **public** key on this flag
    // could not work: every enrollment would be refused, by a correctly-named refusal,
    // which is the hardest shape of defect to see. And a hex **private** key on this flag
    // would be visible in `ps` output to every account on the host, which is why no flag
    // on this binary accepts key material at all (see the module comment).
    //
    // **The file must already exist and be exactly 32 bytes; a missing one is exit 2, not
    // a fresh key.** `.identity.key` is created on first use because a node's own identity
    // is this node's to mint. A *user* key is not: it identifies the person or
    // organisation several nodes belong to, and it is signed into `NodeCertificate.userKey`
    // by a provider and derived from for `CapabilityRecord.sovereignFor`. Minting one to
    // cover a typo'd path would enrol this node under a user nobody controls and report
    // success — a placeholder written into a signed statement, which is the same hole
    // `--operator-id` has no default for.
    //
    // **A path is not a secret, but the file it names is.** Only the bytes are sensitive
    // and they never reach argv.
    //
    // **AUTH-05: the public half of this file is also this node's owner id.** The
    // certificate carries it as `NodeCertificate.userKey`, `ownRecords` publishes it as
    // the `sovereignFor` entry a sovereign discovery query is matched against, and — since
    // Plan 19-09 — `FabricNodeOptions.sovereignty.ownerId` is derived from it here rather
    // than typed separately into `--owner-id`. One value, three readers, no way for them
    // to disagree. See `--owner-id` above for the collision that made this necessary.
    'user-key': { type: 'string' },
    // AUTH-01: who runs this hardware. Required whenever `--provider-addr` is given and
    // deliberately without a default, because it is signed into the certificate as
    // `NodeCertificate.operatorId` and is the unit of quorum diversity: a silent default
    // would make every node one operator, or every node its own, and Phase 19 would
    // inherit an anti-affinity rule that means nothing. Nothing verifies that the operator
    // id is *true*; what is enforced is that somebody *stated* it.
    'operator-id': { type: 'string' },
    // AUTH-02: issuer keys this node pins, repeatable. A peer whose certificate chains to
    // one of these is verified and may be asked for a block; every other connected peer is
    // excluded by name, with a verdict this node can state.
    //
    // Repeatable rather than comma-separated, because pinning two providers is ordinary
    // configuration and a comma-split string would be a parser nobody asked for — the same
    // shape `--trust-anchor` above already uses.
    //
    // Omitting it entirely means this node verifies nobody and treats every connected peer
    // as usable, which is what every node did before this phase. That absence is stated in
    // `FabricNodeOptions.trustedIssuers`, not defaulted here.
    //
    // **This is the whole of this node's trust and there is no live authority to correct a
    // mistake.** An operator who pins the wrong key gets a node that talks to the wrong
    // fabric. The exit-2 check below catches a value that is not 64 lowercase hex
    // characters; it cannot catch a well-formed key belonging to somebody else, and this
    // design does not protect against that.
    //
    // Not to be conflated with `--trust-anchor`: an anchor says whose *build* records this
    // node will run a module for, an issuer says whose *enrollment* signature it will
    // believe about a peer. A module and a peer are different subjects.
    'trusted-issuer': { type: 'string', multiple: true },
    // AUTH-02's **accepting** half, across a real process boundary: the multiaddr of a peer
    // this process dials once it is up, so a spawned node can be shown to *accept* a peer
    // and not only to refuse one. Until this flag existed no phase could take that reading
    // — `certificate-verification.node.test.ts` says so about itself, in the word
    // "unmeasured" — because a verifier has to be connected to the peer it verifies and
    // nothing on this binary made a spawned agent connect to anything.
    //
    // Repeatable, like `--trust-anchor` and `--trusted-issuer` above and for the identical
    // reason: dialling two peers is ordinary configuration, and a comma-split string would
    // be a parser nobody asked for.
    //
    // **It is not `--provider-addr`, and conflating the two would delete one of them.**
    // That flag dials a provider to be certified, once; the connection's purpose ends with
    // the certificate and no ongoing peering is established. This one establishes exactly
    // that ongoing peering: the peer stays connected, `PeerVerifier` reaches a verdict on
    // it, and — if the verdict is `ok` — `RpcBlockSource` may fetch blocks from it.
    //
    // Per-node setting, not a node kind: every agent process built by this binary has
    // identical capability whether or not it is passed, the same sentence `--owner-id`,
    // `--trust-anchor` and `--issues-certificates` each already carry. Being dialled and
    // dialling are the same protocol seen from its two ends, so a node that was given this
    // flag and a node that was not differ in what they *did*, never in what they can do.
    //
    // A multiaddr is public and goes on argv, unlike anything holding key material.
    'peer-addr': { type: 'string', multiple: true },
    // SCHED-06's slot limit (`FabricNodeOptions.maxConcurrentTasks`): how many tasks this
    // node runs at once before it refuses an `exec` request with its own words. Three
    // things about it.
    //
    // The option it reaches already carries the argument for why it is an option at all —
    // *"a test that wants to observe [a refusal] has to be able to make one certain rather
    // than hope for it"*. That argument only reached callers inside this process until now;
    // a spawned agent could not be given a limit, so a later phase could not OBSERVE a
    // refusal from one, only hope for one.
    //
    // A per-node capacity, not a node kind. A node with two slots serves exactly the same
    // requests as one with sixty-four and nothing anywhere branches on the value — it just
    // holds fewer at a time.
    //
    // **Passed straight through and never clamped.** The exit-2 check below refuses a bad
    // value at the binary so an operator reads which input was rejected, and
    // `LocalCapacity`'s own `RangeError` guard stays reachable for every other caller.
    // Sanitising here would turn an operator's mistake into a silently different node.
    //
    // `type: 'string'` because `parseArgs` has no integer type; the parse and the range
    // check are the validator below.
    'max-concurrent-tasks': { type: 'string' },
    // SCHED-04: the share of wall clock this node spends running tasks, in (0, 1].
    //
    // **The starting value, not a fixed one.** The requirement asks for a cap an operator
    // can set on a node that is already running, and a flag alone cannot do that. The
    // control file and `SIGHUP` handler below are the other half; this is where the process
    // begins.
    //
    // A per-node setting, not a node kind. A node at 0.1 serves exactly the same requests
    // as one at 1, more slowly and fewer at a time, and nothing anywhere branches on it.
    //
    // **Why a file and a signal, and not a wire frame.** `serveAgent` serves
    // unauthenticated. A frame that set a node's CPU cap would let any peer able to dial
    // this process throttle a machine it does not own, and bounding that needs an
    // authorization surface this phase has no reason to open. `<dir>/.duty-cycle` is
    // reached only by whoever can already write the directory this agent was handed.
    //
    // Note *which* property of `--dir` is being used: `.identity.key` and `.provider.key`
    // live there because they are **secret**, and this file lives there because it is
    // **owned**. A duty cycle is not a secret — it is published on the handshake line and
    // implied by every offer answer. The directory is the ownership boundary, and that is
    // the only reason the control file shares it.
    //
    // `type: 'string'` because `parseArgs` has no number type; the parse and the range check
    // are the validator below.
    'duty-cycle': { type: 'string' },
    // AUTH-01/AUTH-04: this process holds a provider signing key, generated on-device into
    // `<dir>/.provider.key` on first start, and answers enrollment requests with a real
    // issuance decision instead of saying by name that it issues none.
    //
    // **A boolean, and deliberately not `--provider-key <hex>`**: argv is world-readable in
    // `ps`, so no flag on this binary may accept key material. The key lands in a file that
    // is deliberately **not** `.identity.key`, so `issuerKey !== nodeKey` always holds and
    // a provider-signed certificate can never be confused with a self-signed one.
    //
    // This is a per-node setting, not a node kind: every agent process built by this binary
    // has identical capability regardless of whether it is passed. Said again explicitly
    // because this is the flag most likely to be misread later as a class — a process that
    // issues certificates executes tasks, holds blocks, serves records and relays exactly
    // as every other one does, and anyone who writes "the provider node" in prose is
    // recreating the class `fabric-node.ts` records as deleted.
    'issues-certificates': { type: 'boolean', default: false },
    // NET-05, the joining node's side. Repeatable.
    //
    // **This is not `--peer-addr`.** That flag establishes ongoing peering with a node
    // this one can already reach and changes nothing about this node's own reachability.
    // This one asks the far side for a *reservation*, which is how a node that cannot
    // listen becomes dialable at all — the browser's situation, reproduced here in a
    // process a test can spawn. Two flags, deliberately, because they are two mechanisms.
    //
    // **This node still relays for others, and `--relay-addr` does not change that.** It
    // is worth saying because the opposite is easy to assume: `canRelay` is derived from
    // the listen list, this binary always passes `--port` (default `0`), so an agent given
    // a relay address binds a real address of its own *and* asks for a circuit. It is a
    // relay client and a relay server at once. A node that bound nothing would be the
    // browser case, and this binary has no way to produce one.
    //
    // Every outcome is reported by name and **none is fatal** — the same disposition
    // `--duty-cycle`'s SIGHUP re-read takes, and the opposite of `--provider-addr`'s. A
    // relay that is full, and a relay that is not there, are different conditions with
    // opposite responses, and both are better than a node that dies or a node that goes
    // quiet. A node that got into no relay still executes tasks, serves blocks and
    // answers records for every peer that can reach it directly.
    'relay-addr': { type: 'string', multiple: true },
  },
})

const USAGE =
  'usage: agent.ts --dir <blockstore-dir> [--port <n>] [--owner-id <id — the enrolled user key when --user-key is given> [--owner-key <hex>] [--can-execute-sovereign]] [--trust-anchor <hex> ...] [--issues-certificates] [--provider-addr <multiaddr> --user-key <path> --operator-id <id>] [--trusted-issuer <hex> ...] [--peer-addr <multiaddr> ...] [--max-concurrent-tasks <n>] [--duty-cycle <n>] [--relay-addr <multiaddr> ...]\n'

/**
 * The one exit-2 path, extended rather than duplicated.
 *
 * The reason comes first and the usage line follows it, so an operator reads *which* input
 * was refused before reading the full grammar — and a parent process asserting on `usage`
 * still finds it.
 */
function refuse(reason: string): never {
  process.stderr.write(`agent.ts: ${reason}\n${USAGE}`)
  process.exit(2)
}

if (values.dir === undefined) refuse('--dir is required')

// Exit 2 rather than a default, and the reason is the same one `--operator-id`'s own
// comment gives: both of these become fields of a statement a provider signs. A default
// for either would write a placeholder into that statement, and `operatorId` is the unit
// of quorum diversity — a silent default would make every node one operator, or every node
// its own. Refusing to start is the only honest answer to a half-configured enrollment.
if (values['provider-addr'] !== undefined) {
  if (values['user-key'] === undefined) refuse('--provider-addr requires --user-key <path>')
  if (values['operator-id'] === undefined) refuse('--provider-addr requires --operator-id <id>')
}

// `fromHex` does not validate and does not throw — it zero-fills. A mistyped
// `--trusted-issuer` would otherwise produce a node that refuses every peer as
// `untrusted-issuer` with nothing anywhere reporting that the input was never hex, because
// `publicKeyFromRaw` accepts 32 zero bytes as a perfectly good key. `parseKeyHex` is the
// phase's one validator; the message names **which** flag and **which** value was
// rejected, so an operator who passed several does not have to guess.
for (const issuer of values['trusted-issuer'] ?? []) {
  if (parseKeyHex(issuer) === null) {
    refuse(`--trusted-issuer ${issuer} is not 64 lowercase hex characters`)
  }
}

// **No second validator for `--peer-addr`'s format, deliberately.** `multiaddr()` throws on
// a malformed address, and the dial loop's catch below turns that throw into the same named
// refusal an unreachable address gets — so a bad multiaddr is already exit 2 with the value
// in the message. A validator here would be a second parser sitting beside libp2p's own,
// and the two would disagree the first time libp2p accepted a form this one had not heard
// of. One refusal, composed by the parser that actually has to read the address.

// SCHED-06: refused here rather than clamped, and the check is `LocalCapacity`'s own guard
// restated against a string — integer, at least 1 — so the binary and the class cannot
// disagree about which values exist. `Number` is what turns argv into the number that
// reaches the option, so it is what the check has to run against; anything it reads as NaN
// or as a fraction is named back with the value the operator actually typed.
if (values['max-concurrent-tasks'] !== undefined) {
  const slots = Number(values['max-concurrent-tasks'])
  if (!Number.isInteger(slots) || slots < 1) {
    refuse(`--max-concurrent-tasks ${values['max-concurrent-tasks']} is not an integer of at least 1`)
  }
}

// SCHED-04: refused here rather than clamped, for `--max-concurrent-tasks`'s reason — the
// binary and `DutyCycleGovernor` must not disagree about which values exist, so this is that
// class's own guard restated against a string. Zero is rejected along with everything else
// outside (0, 1]: a node that ran tasks 0% of the time would accept work it would never
// start, which is a worse answer than refusing to start at all.
if (values['duty-cycle'] !== undefined) {
  const cap = Number(values['duty-cycle'])
  if (!Number.isFinite(cap) || cap <= 0 || cap > 1) {
    refuse(`--duty-cycle ${values['duty-cycle']} is not a number in (0, 1]`)
  }
}

/**
 * Read the user seed named by `--user-key`, refusing anything that is not exactly the
 * right size.
 *
 * A wrong-length file is exit 2 for the same reason `loadOrCreateSeed` throws on one:
 * reinterpreting a truncated file as a key would enrol this node under a user key nobody
 * holds, and the only symptom would be a certificate naming a stranger.
 *
 * The bytes are copied out of Node's `Buffer` pool rather than handed on as a view into a
 * shared slab — the same reason `loadOrCreateSeed` and `FsBlockstore.get` copy.
 */
async function readUserSeed(path: string): Promise<Uint8Array> {
  let raw: Buffer
  try {
    raw = await readFile(path)
  } catch (cause) {
    refuse(`--user-key ${path} could not be read: ${cause instanceof Error ? cause.message : String(cause)}`)
  }
  if (raw.length !== SEED_BYTES) {
    refuse(`--user-key ${path} holds ${String(raw.length)} bytes, expected exactly ${String(SEED_BYTES)}`)
  }
  const seed = new Uint8Array(SEED_BYTES)
  seed.set(raw)
  return seed
}

const enrollment =
  values['provider-addr'] === undefined
    ? undefined
    : {
        userPrivateKey: await readUserSeed(values['user-key'] as string),
        operatorId: values['operator-id'] as string,
        providerAddr: values['provider-addr'],
      }

/**
 * AUTH-05 — this process's owner id, derived from the user key it enrols under.
 *
 * `identityFromSeed` is the repository's one seed→public-key derivation, and its own doc
 * pins the property that makes it the right call here: `nodeKey` is
 * `toHex(ed25519.getPublicKey(seed))`, *byte for byte* what `requestEnrollment` computes
 * when it fills `NodeCertificate.userKey` from this same private key. So the value below
 * cannot disagree with the value the provider signs — not because two places were kept in
 * step, but because there is one derivation. (It is applied to the **user** seed rather
 * than the node seed; the function is named for its usual subject, not for its only one.
 * Deriving it a second way here — through `@noble/curves`, which is not a declared
 * dependency of this package — would be the second source of truth this repository keeps
 * refusing to create.)
 *
 * `undefined` for a process that does not enrol, which is what leaves `--owner-id` as the
 * only way to clear such a node — see that flag's doc.
 */
const enrolledOwnerId =
  enrollment === undefined ? undefined : (await identityFromSeed(enrollment.userPrivateKey)).nodeKey

/**
 * A passed `--owner-id` that disagrees with the enrolled user key is exit 2.
 *
 * **Not a precedence rule, and the choice is the whole point of the check.** Whichever
 * value won, the loser's operator would get a node that starts, serves every peer, and is
 * cleared for an identity nothing in the fabric will ever ask about: a sovereign shard
 * pinned to the real owner comes back `unplaceable`, with nothing failing and nothing
 * logged. That is precisely the silent stall AUTH-05 exists to close, relocated from
 * discovery time to configuration time and made *harder* to see rather than easier.
 *
 * Both values are named, because an operator who mistyped one of two 64-character hex
 * strings needs to be shown which two strings were compared.
 *
 * Equal values are accepted, deliberately, so a caller that already passes the correct hex
 * key keeps working — this check refuses a disagreement, never a repetition.
 */
if (
  enrolledOwnerId !== undefined &&
  values['owner-id'] !== undefined &&
  values['owner-id'] !== enrolledOwnerId
) {
  refuse(
    `--owner-id ${values['owner-id']} disagrees with the user key --user-key derives, ` +
      `${enrolledOwnerId}; they are one value (AUTH-05) and a node cleared for an owner ` +
      'the fabric will never ask about is refused rather than started',
  )
}

/** The enrolled user key when there is one, the operator's label when there is not. */
const ownerId = enrolledOwnerId ?? values['owner-id']

// Resolved once so the line printed below reports what was actually pinned rather
// than re-deriving it and risking the two disagreeing.
const trustAnchors = values['trust-anchor'] ?? [KERNEL_TRUST_ANCHOR]

/**
 * The node, once it exists.
 *
 * `let` rather than `const`, and the leash is armed *before* `FabricNode.start` below,
 * because the startup window is not free: an enrolling agent dials a provider and waits
 * on it, and a parent killed during that wait would orphan this process before there was
 * anything to shut down. Leaving during startup is safe to do abruptly — `identity-store`
 * writes the identity key and the certificate through a rename, which is atomic on POSIX,
 * so a process that leaves mid-write leaves either the old file or the new one.
 */
let node: FabricNode | undefined

let stopping = false
const shutdown = (): void => {
  if (stopping) return
  stopping = true
  if (node === undefined) {
    process.exit(0)
  }
  void node.stop().then(
    () => process.exit(0),
    () => process.exit(1),
  )
}

armOrphanLeash(shutdown)

/**
 * NET-05: the first production process ever to construct one.
 *
 * `ReservationWatcher` existed, was exported, and was reached only by two tests. It
 * observes libp2p's own reported reservation status through the `logger` injection point,
 * because libp2p throws that status as an untyped `Error` inside a retry loop where no
 * caller can catch it.
 *
 * Built only when a relay was actually asked for. A node with no `--relay-addr` never
 * attempts a reservation, so a watcher on it would report nothing forever and its presence
 * would suggest a measurement that is not happening.
 */
const relayAddrs = values['relay-addr'] ?? []
const watcher = relayAddrs.length === 0 ? undefined : new ReservationWatcher()

node = await FabricNode.start({
  blockstoreDir: values.dir,
  listen: [`/ip4/127.0.0.1/tcp/${values.port}`],
  trustAnchors,
  issuesCertificates: values['issues-certificates'],
  // The same conditional-spread idiom as `sovereignty` below, and required for the same
  // reason: `exactOptionalPropertyTypes` makes an absent key and an explicit `undefined`
  // different types. An absent flag must add no key at all.
  ...(enrollment === undefined ? {} : { enrollment }),
  ...(values['trusted-issuer'] === undefined ? {} : { trustedIssuers: values['trusted-issuer'] }),
  // Validated above, so `Number` here cannot produce anything `LocalCapacity` would throw
  // on — and the key is omitted entirely when the flag is absent, so the node takes
  // `DEFAULT_MAX_CONCURRENT_TASKS` from `@o2/core` rather than a second copy of it stated
  // here. Same conditional-spread idiom, same `exactOptionalPropertyTypes` reason.
  ...(values['max-concurrent-tasks'] === undefined
    ? {}
    : { maxConcurrentTasks: Number(values['max-concurrent-tasks']) }),
  ...(values['duty-cycle'] === undefined ? {} : { dutyCycle: Number(values['duty-cycle']) }),
  // Both keys or neither: a watcher with no relay to watch reports nothing, and a relay
  // with no watcher is the silence NET-05 exists to end.
  ...(watcher === undefined ? {} : { relayAddrs, reservationWatcher: watcher }),
  // AUTH-05: `ownerId` above, not `values['owner-id']` — an enrolling process is cleared
  // for the user key its certificate names, which is the identity a sovereign discovery
  // query and a discovery-derived `NodeDescriptor` both ask about. A process that enrols
  // and passes no clearance flags therefore reaches this key with
  // `canExecuteSovereign: false` and no `ownerKey`, which refuses every sovereign task
  // exactly as it did before — the safe default is unchanged, only the identity it is
  // stated *about* is now the true one rather than the empty string.
  ...(ownerId === undefined
    ? {}
    : {
        sovereignty: {
          ownerId,
          // Same conditional-spread idiom as the enclosing one, and required for the
          // same reason: `exactOptionalPropertyTypes` makes an absent key and an
          // explicit `undefined` different types, and `NodeSovereignty.ownerKey` is
          // optional. Omitting it is what pins this process to no key at all.
          ...(values['owner-key'] === undefined ? {} : { ownerKey: values['owner-key'] }),
          canExecuteSovereign: values['can-execute-sovereign'],
        },
      }),
})

// AUTH-02: the peers this process was told to reach, dialled **after** `FabricNode.start`
// has resolved and **before** the handshake line is written, so a parent that has read the
// line knows every dial already succeeded.
//
// **Why this is here and not a `FabricNodeOptions` field.** `relayAddrs` already occupies
// the factory position and means something else entirely: it asks libp2p for a
// *reservation* and switches this node into the browser topology, changing how the node is
// reachable. A plain peer dial changes nothing about this node's own reachability, so it
// belongs at the call site rather than in the factory. Plan 18-11 adds `--relay-addr` for
// the other meaning; two flags, deliberately, because they are two mechanisms.
//
// **Nothing has to be seeded for the verdict to land.** `PeerVerifier` subscribes to
// `peer:connect` when the factory builds it, which is strictly before `start` resolves, so
// a peer dialled here is caught by that subscription like any other.
//
// The peer id is read off the `Connection` rather than parsed out of the configured string,
// for the reason `fabric-node.ts` states where it collects `relayPeerIds`: a peer id read
// off a connection is the peer actually **reached**, one parsed out of a string is a claim
// about who was *meant* to be. This line reports the first kind.
const peers: string[] = []
for (const address of values['peer-addr'] ?? []) {
  try {
    peers.push(await node.dial(address))
  } catch (cause) {
    // Stop before refusing. `refuse` calls `process.exit(2)`, and a started node holds a
    // bound socket, a worker thread and two libp2p listeners; `FabricNode.start`'s own
    // `undo` stack covers a failure *inside* it and does not cover one after it returned.
    //
    // The stop is swallowed rather than awaited bare: a `stop()` that itself rejects would
    // replace this named refusal with an unhandled rejection and a different exit code,
    // turning "the address could not be dialled" into no statement at all. Shutdown is
    // best-effort here; the refusal is not.
    await node.stop().catch(() => {})
    refuse(
      `--peer-addr ${address} could not be dialled: ${cause instanceof Error ? cause.message : String(cause)}`,
    )
  }
}

// The parent waits for exactly this line before dialling.
//
// `trustAnchors` is the set handed to `FabricNode.start` above, not a restatement of
// the source's intent — which is the point of printing it. An anchor is a public key,
// so publishing it discloses nothing, and it turns "the default is what the source
// says" into a reading a parent process can take across a real process boundary.
// Adding a field is additive for the parents that parse this line; they read named
// fields.
//
// The three identity fields are read the same way and for the same reason. `nodeKey` is
// this node's public key, and it is what makes `certificate` mean something rather than
// being a string this binary chose to print: `peerIdForNodeKey(nodeKey)` must equal
// `peerId`, so the certificate is demonstrably about the key the peer id is derived from.
// See the module comment for why all three are always present and why `null` is stated
// rather than omitted.
//
// `peers` is read the same way and carries the same guarantee: `[]` is a statement that
// this process reached nobody, not the absence of a statement, and every entry in it came
// off a `Connection` that was actually established.
/**
 * NET-05: settle the relay question before announcing.
 *
 * A reservation is not held when `start` resolves. The dial returns as soon as the
 * connection is up; libp2p then asks for the reservation inside its own retry loop, so a
 * circuit address appears — or a refusal arrives — some time afterwards. Reading
 * `circuitAddrs` immediately would report `[]` for a node that is about to be granted one,
 * which is a false statement rather than an early one.
 *
 * So this waits for whichever answer comes first: a circuit, a named refusal, or an
 * unreachable relay already recorded during `start`. All three resolve it — this is not a
 * wait for success, it is a wait for **an answer** — and the budget bounds the case where
 * none arrives, which is itself reported below as the fourth outcome rather than hidden by
 * a longer timeout.
 *
 * The budget is spent only by a node that asked for a relay. Every other agent announces
 * exactly as immediately as it did before this flag existed.
 */
const RELAY_SETTLE_BUDGET_MS = 30_000
if (watcher !== undefined) {
  // Subscribed BEFORE the wait below, not after, and that ordering is the whole of the
  // mechanism rather than a detail. A subscription taken afterwards would be dead code for
  // the startup refusal — the wait cannot end until the failure has already been recorded,
  // so a replay of `watcher.failures` would report it first and the subscription would
  // never fire. Measured: removing the subscription while such a replay existed changed
  // nothing, and the test still passed. One reporting path, and it is this one.
  //
  // It also outlives startup, which is the reason to prefer it: libp2p keeps retrying a
  // reservation for the life of the node, so a relay that fills up an hour from now
  // refuses this node then, and that refusal is reported by the same line. **That later
  // case is not measured by any test** — `reservation-exhaustion.node.test.ts` only
  // exercises the startup one.
  watcher.onFailure((failure) => {
    process.stderr.write(`agent.ts: relay reservation ${failure.kind}: ${failure.status}\n`)
  })

  const deadline = Date.now() + RELAY_SETTLE_BUDGET_MS
  while (
    Date.now() < deadline &&
    node.circuitAddrs.length === 0 &&
    watcher.failures.length === 0 &&
    node.relayFailures.length === 0
  ) {
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}

//
// `relays` is the grant side of NET-05: the relays this node holds a circuit through,
// read off `circuitAddrs` rather than off the configured list, so it names relays that
// actually granted rather than relays that were asked. `[]` is a statement.
process.stdout.write(
  `${JSON.stringify({
    peerId: node.peerId,
    multiaddrs: node.multiaddrs,
    trustAnchors,
    nodeKey: node.nodeKey,
    certificate: node.certificate,
    issuerKey: node.issuerKey,
    peers,
    dutyCycle: node.dutyCycle,
    relays: node.circuitAddrs,
  })}\n`,
)

/**
 * NET-05's whole point, on stderr rather than on the handshake line.
 *
 * **Three outcomes, three different words, and the distinction is the deliverable.** A
 * relay that granted, a relay that was reached and refused for want of capacity, and a
 * relay that was never reached at all demand different responses — carry on, try another
 * relay or wait, and fix the address. Collapsing any two of them into "no circuit address
 * appeared" is the silence this requirement exists to replace.
 *
 * stderr, because stdout's first line is a machine-read handshake and every parent in this
 * repository parses only up to its first newline. A second stdout line would be tolerated
 * by all of them today, which is exactly why it should not be relied on.
 *
 * **None of this is fatal.** A node that got into no relay still executes tasks, serves
 * blocks and answers records for every peer that can reach it directly — and killing it
 * would be a worse answer than the one NET-05 exists to replace.
 */
if (watcher !== undefined) {
  for (const failure of node.relayFailures) {
    process.stderr.write(`agent.ts: relay ${failure.address} unreachable: ${failure.reason}\n`)
  }
  if (node.circuitAddrs.length === 0 && node.relayFailures.length === 0) {
    process.stderr.write(`agent.ts: no relay granted a reservation yet; still serving directly\n`)
  }
}

// Declared with `shutdown` above, alongside the leash, so the three ways this process can
// be told to stop read as one paragraph rather than being separated by the handshake.
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)

/** The control file, under the directory this agent was already handed. */
const DUTY_CYCLE_FILE = '.duty-cycle'

/**
 * SCHED-04 — re-read the cap on a running node.
 *
 * **Deliberately not on `shutdown`'s path.** `SIGHUP`'s default disposition is to
 * terminate the process, so the existence of this handler is the only thing keeping the
 * node alive through one; wiring it to the shutdown path would have looked tidy and would
 * have made the signal do exactly what having no handler does.
 *
 * **Every failure is named and none is fatal**, which is the opposite disposition from
 * `--provider-addr`'s in this same file, and the difference is worth stating because the
 * two rules will otherwise read as inconsistent. That check runs *before the node exists*,
 * where refusing to start is the honest answer to a half-configured process. This one runs
 * while the node is **serving other peers' work**, and a control file somebody mistyped is
 * not a reason to drop those connections. So a bad file writes one line to stderr and
 * leaves the running cap exactly where it was.
 */
process.on('SIGHUP', () => {
  void (async () => {
    const path = `${String(values.dir)}/${DUTY_CYCLE_FILE}`
    let text: string
    try {
      text = await readFile(path, 'utf8')
    } catch {
      process.stderr.write(`agent.ts: ${path} could not be read; duty cycle unchanged\n`)
      return
    }
    const cap = Number(text.trim())
    if (text.trim() === '' || !Number.isFinite(cap) || cap <= 0 || cap > 1) {
      process.stderr.write(
        `agent.ts: ${path} holds ${JSON.stringify(text.trim())}, expected a number in (0, 1]; duty cycle unchanged\n`,
      )
      return
    }
    node?.setDutyCycle(cap)
  })().catch(() => {
    // Unreachable in practice — every step above handles its own failure — but a throw
    // escaping here would become an unhandled rejection and kill a node that is serving.
    process.stderr.write('agent.ts: duty-cycle re-read failed; duty cycle unchanged\n')
  })
})
