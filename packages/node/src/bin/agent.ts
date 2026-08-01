/**
 * A standalone fabric agent process.
 *
 * Started with a blockstore directory, it listens, serves task dispatches and block
 * requests, and prints one JSON line describing how to reach it and who it says it is:
 *
 *   { "peerId": "12D3Koo…", "multiaddrs": ["/ip4/127.0.0.1/tcp/54321/p2p/12D3Koo…"],
 *     "trustAnchors": ["…"], "nodeKey": "…", "certificate": null, "issuerKey": null }
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
 * provider-signed certificate, and the public half of the provider key when this process
 * holds one. Nothing secret crosses it, and nothing secret may be added to it — a parent
 * process reads this line and so does anything that can read this process's stdout.
 *
 * `certificate` and `issuerKey` are **present and `null`** rather than absent when there
 * is nothing to report. An absent field and a stated absence read identically to
 * `JSON.parse`, and only one of them is a statement. `certificate` carries the *whole*
 * certificate rather than a summary, because a parent has to be able to compare what this
 * node advertised against what a peer fetches from it over the `records` request, and a
 * summary would make that comparison impossible.
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
 */

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
  'usage: agent.ts --dir <blockstore-dir> [--port <n>] [--owner-id <id> [--owner-key <hex>] [--can-execute-sovereign]] [--trust-anchor <hex> ...] [--issues-certificates] [--provider-addr <multiaddr> --user-key <path> --operator-id <id>] [--trusted-issuer <hex> ...]\n'

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

const node = await FabricNode.start({
  blockstoreDir: values.dir,
  listen: [`/ip4/127.0.0.1/tcp/${values.port}`],
  trustAnchors,
  issuesCertificates: values['issues-certificates'],
  // The same conditional-spread idiom as `sovereignty` below, and required for the same
  // reason: `exactOptionalPropertyTypes` makes an absent key and an explicit `undefined`
  // different types. An absent flag must add no key at all.
  ...(enrollment === undefined ? {} : { enrollment }),
  ...(values['trusted-issuer'] === undefined ? {} : { trustedIssuers: values['trusted-issuer'] }),
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
//
// The three identity fields are read the same way and for the same reason. `nodeKey` is
// this node's public key, and it is what makes `certificate` mean something rather than
// being a string this binary chose to print: `peerIdForNodeKey(nodeKey)` must equal
// `peerId`, so the certificate is demonstrably about the key the peer id is derived from.
// See the module comment for why all three are always present and why `null` is stated
// rather than omitted.
process.stdout.write(
  `${JSON.stringify({
    peerId: node.peerId,
    multiaddrs: node.multiaddrs,
    trustAnchors,
    nodeKey: node.nodeKey,
    certificate: node.certificate,
    issuerKey: node.issuerKey,
  })}\n`,
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
