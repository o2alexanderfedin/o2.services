/**
 * A standalone fabric agent process.
 *
 * Started with a blockstore directory, it listens, serves task dispatches and block
 * requests, and prints one JSON line describing how to reach it and who it says it is:
 *
 *   { "peerId": "12D3Koo…", "multiaddrs": ["/ip4/127.0.0.1/tcp/54321/p2p/12D3Koo…"],
 *     "trustAnchors": ["…"], "nodeKey": "…", "certificate": null, "issuerKey": null,
 *     "peers": [] }
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
 * On POSIX a child does not die with its parent. Every spawn site of this binary is a
 * test, every one of them tears its agents down in an `afterEach`, and none of that runs
 * when the parent is killed rather than asked: an interrupted run, a killed Vitest worker,
 * a harness torn down mid-test. `SIGKILL` runs no handler by definition, so nothing on
 * the *parent* side can be made to cover it. **Measured, not reasoned:** a sweep on
 * 2026-08-01 found three agent processes from two different sessions still listening,
 * reparented to pid 1, the oldest 20h45m old at 14.5 MB. That is process-table pressure
 * this repository already has a name for — `tools/aot/lift.ts`'s `host-cannot-spawn`.
 *
 * So the answer has to live here, in the child, and it is stdin. A parent that spawns
 * this binary with a pipe on fd 0 holds the write end; when that parent dies — however it
 * dies — the kernel closes it and this process reads EOF. No handler on the parent side,
 * no bookkeeping, no timer, and it covers the one case no exit handler can.
 *
 * **The leash arms only when fd 0 is a socket or a FIFO, and that condition is the whole
 * design.** Three readings of fd 0 have to be told apart, and `fstat` tells them apart
 * exactly:
 *
 * | How this process was started | fd 0 | Leash |
 * |---|---|---|
 * | `spawn(…, { stdio: ['pipe', …] })` | socket (libuv uses `socketpair`) | armed |
 * | `some-command \| agent.ts` | FIFO | armed |
 * | `spawn(…, { stdio: ['ignore', …] })` | character device (`/dev/null`) | not armed |
 * | an operator at a terminal | character device (tty) | not armed |
 * | `agent.ts < /dev/null`, `nohup agent.ts &` | character device | not armed |
 *
 * The two rows that must not arm are the same row to `fstat`, which is what makes the
 * gate safe rather than lucky: **`/dev/null` returns EOF on the very first read**, so an
 * ungated version of this would exit during startup at every caller that ignores stdin —
 * and until the commit that added this, that was *every* caller. An operator's terminal
 * is a character device too, so it is excluded by the same clause, and so is a node
 * deliberately backgrounded away from its shell. Nothing here reads stdin for content;
 * the pipe carries no data, only the fact that it is still open.
 *
 * The consequence a caller has to know: **a spawn site that ignores stdin gets no leash.**
 * That is opt-in by construction — the parent asks for supervision by handing over a pipe
 * — and `orphan-leash.node.test.ts` both demonstrates the leash against a `SIGKILL`ed
 * parent and guards every spawn site in this package against quietly opting out again.
 */

import { fstatSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { parseArgs } from 'node:util'
import { KERNEL_TRUST_ANCHOR } from '@o2/demo'
import { SEED_BYTES, parseKeyHex } from '@o2/libp2p'
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
    //
    // **Phase 18 accreted instead, and the reason is recorded here rather than left to
    // look like an oversight.** Three plans in Phase 18 each add a flag to this same
    // `parseArgs` object, in three different waves: 18-01's `--peer-addr` and
    // `--max-concurrent-tasks`, 18-08's `--duty-cycle`, and 18-11's `--relay-addr`. A
    // refactor landed in wave 1 would be re-litigated twice before the phase ended, and
    // each re-litigation would touch a file two other plans hold open. The instruction is
    // therefore carried forward rather than discharged: whichever phase touches this file
    // next **with no other plan behind it** should do the fold.
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
  },
})

const USAGE =
  'usage: agent.ts --dir <blockstore-dir> [--port <n>] [--owner-id <id> [--owner-key <hex>] [--can-execute-sovereign]] [--trust-anchor <hex> ...] [--issues-certificates] [--provider-addr <multiaddr> --user-key <path> --operator-id <id>] [--trusted-issuer <hex> ...] [--peer-addr <multiaddr> ...] [--max-concurrent-tasks <n>]\n'

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

// Resolved once so the line printed below reports what was actually pinned rather
// than re-deriving it and risking the two disagreeing.
const trustAnchors = values['trust-anchor'] ?? [KERNEL_TRUST_ANCHOR]

/**
 * How long a leash-triggered stop may take before this process leaves anyway.
 *
 * `stopAgent` in the spawning tests gives a wedged node 10 s and then `SIGKILL`s it. On
 * this path there is no parent left to do that — being parentless is the whole reason
 * this path ran — so the deadline has to be local, or a node that wedges in `stop()`
 * becomes exactly the orphan this leash exists to prevent. 5 s rather than 10 because
 * nothing is waiting on a clean unwind here: no parent will read an exit code and no peer
 * is owed a goodbye.
 *
 * **Unmeasured, and said rather than left to be assumed:** nothing in this repository
 * induces a wedged `stop()`, so this budget's *expiry* is reasoned and not observed. What
 * is observed is the ordinary path — `orphan-leash.node.test.ts` sees the process gone
 * 250–500 ms after its parent dies, an order of magnitude inside this.
 */
const LEASH_STOP_BUDGET_MS = 5_000

/**
 * Is fd 0 a pipe somebody is holding open, rather than `/dev/null` or a terminal?
 *
 * See the module comment for the table this implements and why the distinction is the
 * whole design. A closed or unreadable fd 0 is *not* a leash: `fstat` is the only thing
 * consulted, and if it cannot answer, this process is supervised by nobody and says so by
 * declining to arm rather than by guessing.
 */
function parentHoldsAPipe(): boolean {
  try {
    const fd0 = fstatSync(0)
    return fd0.isSocket() || fd0.isFIFO()
  } catch {
    return false
  }
}

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

if (parentHoldsAPipe()) {
  const leashBroke = (): void => {
    // Unreffed so this timer is never the reason the process stays up; the node's own
    // listener keeps the loop alive long enough for it to fire, and if `stop()` finishes
    // first the process is already gone.
    setTimeout(() => process.exit(0), LEASH_STOP_BUDGET_MS).unref()
    shutdown()
  }
  // `end` is EOF: the last writer closed. `error` is the same fact arriving as ECONNRESET,
  // which a socketpair can report when the peer is killed rather than closed — and an
  // unhandled `error` on this stream would take the process down with a stack trace
  // instead of an unwind, which is a worse way to be right.
  process.stdin.on('end', leashBroke)
  process.stdin.on('error', leashBroke)
  process.stdin.resume()
  process.stdin.unref()
}

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
process.stdout.write(
  `${JSON.stringify({
    peerId: node.peerId,
    multiaddrs: node.multiaddrs,
    trustAnchors,
    nodeKey: node.nodeKey,
    certificate: node.certificate,
    issuerKey: node.issuerKey,
    peers,
  })}\n`,
)

// Declared with `shutdown` above, alongside the leash, so the three ways this process can
// be told to stop read as one paragraph rather than being separated by the handshake.
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
