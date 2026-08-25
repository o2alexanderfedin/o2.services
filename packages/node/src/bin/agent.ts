/**
 * A standalone fabric agent process.
 *
 * Started with a blockstore directory, it listens, serves task dispatches and block
 * requests, and prints one JSON line describing how to reach it and who it says it is:
 *
 *   { "peerId": "12D3Koo…", "multiaddrs": ["/ip4/127.0.0.1/tcp/54321/p2p/12D3Koo…"],
 *     "trustAnchors": ["…"], "nodeKey": "…", "certificate": null, "issuerKey": null,
 *     "peers": [], "dutyCycle": 1, "relays": [], "pid": 12345,
 *     "inboundConnectionThreshold": …, "maxIncomingPendingConnections": … }
 *
 * The last two are shown as ellipses rather than as numbers **deliberately**: both are
 * derived from this node's reservation limit unless `--inbound-threshold` pins the first, so
 * what a given start comes to is a reading and not a constant, and a figure written down
 * here would be a prediction that goes stale the next time the derivation moves. That is the
 * whole point of announcing them; see the keys themselves.
 *
 * The handshake is deliberately a single line on stdout rather than a fixed port or
 * a discovery service: the OS assigns the port, so parallel runs cannot collide,
 * and the parent learns the address without polling.
 *
 * A node started with no `--port` and one or more `--relay-addr` binds nothing, so its
 * `multiaddrs` are `/p2p-circuit` addresses alone and `relays` is what makes it reachable.
 * See `--port` below for why that case exists and why it is a route rather than a class.
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
 * `pid` is this process's own operating-system process id, and it is here because a parent
 * that spawned a child and read an address has proved neither that the address belongs to
 * that child nor that the child is the process now holding it. `child.pid` names a process
 * the parent started; the handshake names an address somebody is serving; nothing joined
 * them until this key existed. BENCH-07's first integrity check is exactly that
 * correspondence — a benchmark that quietly ran its nodes inside the driver's own process
 * would satisfy both halves separately and fail `handshake.pid === child.pid`. A pid is
 * public by construction, exactly as the fields above it are: `ps` prints it to every
 * account on the host.
 *
 * Adding a field is additive for existing parents: each reads only the keys it names. That
 * is why `pid` is one line rather than a protocol change — every reader of this line in
 * this repository destructures `peerId` and `multiaddrs` and ignores the rest.
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
 * **Policy numbers are not key material and go on argv as values.**
 * `--max-issued-per-window`, `--max-concurrent-tasks` and `--duty-cycle` are all of that
 * kind. The distinction is worth stating because the file rule above is easy to extend by
 * analogy into a config file nobody needs: what makes `--user-key` a path is that its
 * contents are a secret, and a provider's issuance budget is the opposite — every refusal
 * carries the limit onto the wire, so the peer that met it can read the threshold.
 *
 * ## Two things a provider must state, and a third it may not
 *
 * `--issues-certificates` and `--max-issued-per-window` travel together or the process
 * exits 2. There is **no switch here for the library's no-aggregate-budget opt-out**, the
 * same posture `--trust-anchor` takes for DET-03's: a shipped binary should not carry one.
 * And there is deliberately **no certificate-lifetime flag** — the owner's 2026-08-02
 * correction rules lifetimes out of the cost argument, so `certificateLifetimeMs` keeps
 * its default and revocation stays non-renewal on the certificate's own clock.
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
import { cpus, hostname, platform, release, totalmem } from 'node:os'
import { parseArgs } from 'node:util'
import {
  canonicalCid,
  checkpointChain,
  checkpointsInto,
  decodeCanonical,
  delegate,
  jobIdOf,
  publicNodes,
  recoverCheckpoint,
  remainingWork,
} from '@o2/core'
import type {
  Delegation,
  Executor,
  LeaseEvent,
  NodeDescriptor,
  PublicKeyHex,
  ShardAttestation,
  ShardResult,
  SubmitOptions,
  Task,
} from '@o2/core'
import {
  DEFAULT_BUDGET,
  KERNEL_RECORD,
  KERNEL_TRUST_ANCHOR,
  PRIMES_RECORD,
  PRIME_COUNT_KEY,
  buildInput,
  kernelBytes,
  primesKernelBytes,
  projectPrimeCount,
  readPrimeCount,
} from '@o2/demo'
import { SEED_BYTES, audienceKeyOf, identityFromSeed, parseKeyHex, peerIdForNodeKey } from '@o2/libp2p'
import {
  MIN_SOVEREIGN_COMBINE_REPLICAS,
  RemoteExecutor,
  discoverCandidates,
  reduceSovereignJob,
  rpcAdmission,
  submitJobWithEgress,
} from '@o2/net'
import type { CapabilitySupplier } from '@o2/net'
import { CID } from 'multiformats/cid'
import { FabricNode } from '../fabric-node.ts'
import { FsBlockstore } from '../fs-blockstore.ts'
import { armOrphanLeash } from '../orphan-leash.ts'
import { ReservationWatcher } from '../reservation-watch.ts'

const { values } = parseArgs({
  options: {
    dir: { type: 'string' },
    // The TCP port this node binds, and **deliberately without a default** — which is
    // the whole mechanism rather than a tidy-up.
    //
    // It carried `default: '0'` until 2026-08-04, and that default was load-bearing in the
    // wrong direction: with it, `values.port` is `'0'` whether an operator typed `--port 0`
    // or typed nothing, the listen list below could not be written conditionally, and so
    // **no argv could produce a node that binds nothing**. `canRelay`
    // (`fabric-node.ts:1083`) is a predicate over exactly that list, so every process this
    // binary ever started enrolled `discoverability: 'seed'` with `relayIds: []`. Phase
    // 19's criterion 1 asks that a quorum whose members all hang off one relay be refused
    // *through this binary*, and that reading did not exist — `19-VERIFICATION.md` scored
    // the criterion PARTIAL for it, and the assertion that was standing in for it could not
    // fail at the type level.
    //
    // Dropping the default costs nothing anywhere else: `undefined` and no `--relay-addr`
    // reaches the same `/ip4/127.0.0.1/tcp/0` it always did — see the `listen` expression
    // below, which states all three cases in one place.
    //
    // **Not a node kind.** A node that binds nothing has identical capability to one that
    // binds a port: it executes tasks, serves blocks, answers records and attests results
    // for every peer that reaches it, and nothing anywhere branches on the choice. It is
    // reachable by a different route, which is a fact about routes. `STATE.md`'s cardinal
    // rule is that a decision keying on node kind is wrong, and this phase already
    // retracted a quorum rule (`0314208`) for being exactly that — the same sentence every
    // other flag in this block carries, and it is meant literally here too.
    port: { type: 'string' },
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
    // ## The flag fold, examined at last and declined — do not carry it forward again
    //
    // 14-CONTEXT.md Risk 3 recorded a collision: Phase 14 proposed `--trust-anchor` on this
    // binary while Phase 15 was adding `--owner-key`, neither could block on the other, and
    // the note said *"whichever phase touches this block next should fold all three into
    // one flags object rather than accreting a fourth."* Phase 18 carried it forward
    // (three plans, three waves, one file), and 19-09 carried it forward once more naming
    // Plan 19-07 as the successor with nothing behind it.
    //
    // **19-07 is that plan, it looked, and the instruction is discharged as declined.**
    // Three measurements, each checkable:
    //
    //   1. `parseArgs`'s `options` **is** one flags object, and has been since the first
    //      flag. The instruction's literal words are already satisfied by the shape of the
    //      call; what it wanted was never written down by any of the three phases that
    //      passed it on.
    //   2. The one concrete fold consistent with the wording — a compound value flag
    //      grouping several settings — is refused twice **by this file, by name**:
    //      `--trust-anchor` and `--trusted-issuer` are both repeatable rather than
    //      comma-separated *"because a comma-split string would be a parser nobody asked
    //      for"*. A fold that reintroduced that parser to satisfy a note would be
    //      overturning a recorded decision to close an unrecorded one.
    //   3. The flags the note names are not one subject. This file already states that
    //      `--trust-anchor` and `--trusted-issuer` must not be conflated — *"a module and
    //      a peer are different subjects"* — and the three that genuinely are one subject
    //      (`--owner-id`, `--owner-key`, `--can-execute-sovereign`) **are already folded**,
    //      into the single `sovereignty` object at the `FabricNode.start` call below.
    //
    // So the fold is done where it is coherent and refused where it is not. What is left
    // is sixteen flags in one `options` object — counted, 2026-08-03 — each documented at
    // its own key, which is the shape a reader wants when they are looking for one of them.
    // If a future phase wants a different structure it should say which structure and why,
    // rather than inheriting a sentence.
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
    // AUTH-02 / AUTH-04 — **the third flag in a family of three, and the one that decides who
    // gets in at all.** An agent given `--port` is relay-capable, because `canRelay` is
    // derived from the listen list; until this flag existed, the binary every cross-process
    // proof spawns could hold a door but could not be told to close one.
    //
    // ## The disambiguation is mandatory, because these three are one word apart in the
    // source and a world apart in what they authorise
    //
    //   - `--trust-anchor` pins whose *build* records this node will run a module for
    //     (DET-03). Subject: **a module**.
    //   - `--trusted-issuer` pins whose *enrolment signature* this node will believe about a
    //     peer it is already talking to (AUTH-02, **selection**). Subject: **a peer this node
    //     talks to**. It gates block sources; it does not gate the door.
    //   - `--admit-issuer` pins whose certificate gets a peer a **circuit reservation on this
    //     node** (AUTH-02, **admission**). Subject: **a peer asking to come in**.
    //
    // Three subjects, and a key pinned for one says nothing whatever about the others. None
    // of the three may be folded into another.
    //
    // Repeatable, with the identical `multiple: true` shape as the two above, for the reason
    // both of them state by name: pinning two providers is ordinary configuration and a
    // comma-split string would be a parser nobody asked for.
    //
    // **Omitting it is a stated absence, not a safe default.** Absent, the posture stays
    // exactly `'admits-any-peer'` and every existing argv site keeps working unchanged — see
    // the ternary at `FabricNode.start` for why this one cannot use the conditional-spread
    // idiom its two siblings use.
    //
    // Hex-validated below, through the same `parseKeyHex` / `refuse` / exit-2 loop, because
    // `fromHex` zero-fills rather than throwing: a mistyped value would otherwise produce a
    // node that refuses **every** peer a reservation with nothing anywhere reporting that the
    // input was never hex.
    //
    // Per-node setting, never a node kind. Every agent process built by this binary executes
    // tasks, serves blocks, answers records and attests results identically whatever is
    // passed here. What differs is who may reserve a circuit *through* it.
    'admit-issuer': { type: 'string', multiple: true },
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
    // BENCH-07 criterion 3: inbound connections **per second, per host** this node accepts,
    // pinned rather than derived.
    //
    // **What it is for, and it is not tuning.** `.planning/BENCHMARK-RESULTS.md` excludes a
    // real-transport rung with a paragraph naming libp2p's inbound cap of five per host as
    // the cause. That paragraph was attached without measuring anything, and the constant it
    // names is not necessarily the value a node runs at: `FabricNode.start` derives this
    // limit as `max(libp2p's default, the reservation limit)`, and that coupling landed
    // after the run the paragraph describes. Making the value settable is what turns "the
    // cap is the cause" from an assertion into an attempt somebody can run — a rung pinned
    // back to the blamed value beside the same rung at the derived one.
    //
    // **A rate, not a count**, which is why raising the reservation and pending limits did
    // not fix the failure this exists to reproduce and staggering the joins did. The
    // neighbouring `maxIncomingPendingConnections` is the count, and it is left derived here
    // deliberately: pinning one lever at a time is the whole point of the flag.
    //
    // **A per-node setting, not a node kind** — the same sentence every other flag in this
    // block carries. A node at five accepts exactly the requests a node at fifteen does; it
    // accepts them more slowly from one host, and nothing anywhere branches on the value.
    //
    // **The `--port` rule does not apply to this flag and is restated so it is not
    // forgotten.** This is not `--relay-addr`: an agent given `--inbound-threshold` and no
    // `--port` still takes the `relayAddrs.length === 0` row of the `listen` table below and
    // binds `/ip4/127.0.0.1/tcp/0`. Do not add a defensive `--port 0` beside it — that
    // would quietly change what the rig binds while looking like caution.
    //
    // `type: 'string'` because `parseArgs` has no integer type; the parse and the range
    // check are the validator below.
    'inbound-threshold': { type: 'string' },
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
    // AUTH-04's cost clause: how many certificates this provider will sign per window, to
    // anybody. Five things about it, and each decides behaviour.
    //
    // **What it is for.** Phase 17 measured that the per-user rate limit buys no cost at
    // all: it is keyed on `userKey`, a fresh user key is one `ed25519.keygen()`, and twenty
    // requests under twenty distinct user keys all succeeded unslowed with the guard in
    // place. This is the bound on a quantity no request field can rotate around, and since
    // the record lives under `--dir` (`fs-issuance.ts`) it is a bound a restart does not
    // hand back.
    //
    // **A value on argv, not a file, and saying so is what stops the analogy.**
    // `--user-key` names a file because argv is world-readable in `ps` and a private key
    // on a command line is a private key everybody has. This is a **policy number**, not
    // credential material — publishing it discloses nothing an operator would not tell a
    // peer anyway, since every refusal carries the limit onto the wire so the peer that
    // hit it can read the threshold. So the file rule does not apply here, and a config
    // file for it would be machinery nobody needs.
    //
    // **Required alongside `--issues-certificates`, and there is no way to opt out.** The
    // standing rule on this binary is that a half-configured enrolment is refused rather
    // than defaulted, because the fields become part of a statement a provider signs — and
    // a provider silently signing an unbounded number of certificates is precisely the
    // state this flag exists to end. The library's opt-out
    // (`'issues-without-an-aggregate-budget'`) stays reachable for callers that must state
    // it, and this binary carries no switch for it, exactly as it carries none for
    // `--trust-anchor`'s.
    //
    // **The operator trade, which is real and is not mitigated here.** A small budget
    // starves honest enrolment as readily as an attacker's — `serveAgent` serves enrolment
    // unauthenticated, so anyone who can dial this process can spend its window. The answer
    // is another provider: trust is pinned per verifier, so several coexist by
    // construction and nothing global has to recover. That answer is an argument rather
    // than a measurement; `enrollment-cost.node.test.ts` says so in its own header.
    //
    // **A per-node configuration, not a node kind.** Every agent process built by this
    // binary has identical capability whatever this is set to — the same sentence every
    // other flag here carries. A provider at 3 serves exactly the requests a provider at
    // 3 000 does.
    //
    // `type: 'string'` because `parseArgs` has no integer type; the parse and the range
    // check are the validator below.
    'max-issued-per-window': { type: 'string' },
    // NET-05, the joining node's side. Repeatable.
    //
    // **This is not `--peer-addr`.** That flag establishes ongoing peering with a node
    // this one can already reach and changes nothing about this node's own reachability.
    // This one asks the far side for a *reservation*, which is how a node that cannot
    // listen becomes dialable at all — the browser's situation, reproduced here in a
    // process a test can spawn. Two flags, deliberately, because they are two mechanisms.
    //
    // **Whether this node still relays for others depends on `--port`, and only on it.**
    // `canRelay` is derived from the listen list, so:
    //
    //   - `--relay-addr X --port 0` (or any port) — binds a real address of its own *and*
    //     asks X for a circuit. A relay client and a relay server at once, and its
    //     certificate says `discoverability: 'seed'` with `relayIds: []`, because a
    //     directly dialable node depends on no relay to be found. **This is what every
    //     invocation did before 2026-08-04**, when `--port` still had a default.
    //   - `--relay-addr X` with no `--port` — binds **nothing**. The listen list is
    //     `['/p2p-circuit']` alone, `canRelay` is false, this node carries no stranger's
    //     handshake, and it enrols `discoverability: 'via-relay'` with X's peer id in
    //     `relayIds`. That is the browser's topology, and this binary now produces it —
    //     the sentence that stood here, *"this binary has no way to produce one"*, was
    //     true when it was written and is why quorum rule 2 had no across-process reading
    //     at all until Plan 19-19.
    //
    // The distinction is a **binding choice, not a node kind**: both processes execute
    // tasks, serve blocks, answer records and attest results identically, and nothing
    // branches on which one this is. What differs is how a peer reaches it.
    //
    // Measured at `quorum-agents.node.test.ts`, which reads both arms off the
    // certificates a provider **process** signed rather than off the spawn arguments.
    //
    // Every outcome is reported by name and **none is fatal** — the same disposition
    // `--duty-cycle`'s SIGHUP re-read takes, and the opposite of `--provider-addr`'s. A
    // relay that is full, and a relay that is not there, are different conditions with
    // opposite responses, and both are better than a node that dies or a node that goes
    // quiet. A node that got into no relay still executes tasks, serves blocks and
    // answers records for every peer that can reach it directly.
    'relay-addr': { type: 'string', multiple: true },
    // CHURN-03, ROADMAP Phase 20 criterion 7 — **this binary's coordinator leg**, and the
    // count of shards it runs. Absent, this process submits nothing and is exactly the
    // serving node it has always been; every one of the 19 existing argv sites in this
    // repository is byte-identical with this flag added, because every line of the block at
    // the foot of this file is inside `if (values.coordinate !== undefined)`.
    //
    // ## Why a serving binary grew a coordinator at all
    //
    // Criterion 7 reads *"a coordinator writes a checkpoint during a live job run through
    // `bin/agent.ts`"*, and until this flag existed the honest answer was that no such
    // coordinator could exist: `grep -c 'submitJob' packages/node/src/bin/agent.ts` returned
    // **0**, so `checkpoint-agents.node.test.ts` recorded the substitution *"a job run
    // **across** `bin/agent.ts` processes"* and 20-VERIFICATION.md scored the criterion
    // PARTIAL on precisely the difference. The write half has since been closed on the
    // browser tier — `demo/main.ts`'s `runColouring` passes `checkpointsInto(node.store)` —
    // so what was left was this entry point.
    //
    // **`bin/bench.ts` was tried first and is the wrong host**, and the reason is recorded
    // here so nobody moves it back: that driver is a multi-workload sweep, one checkpoint
    // handle cannot name its many differently-shaped jobs (a handle applied across the sweep
    // makes every rung refuse `checkpoint-names-another-job`, measured 2026-08-18), and its
    // store is an `mkdtemp` its own `close()` deletes — so a checkpoint written there names
    // a block that is gone before anything could resume from it. This binary has neither
    // problem: one job, and a `--dir` an operator chose that outlives the process.
    //
    // **The workload is the demo colouring kernel and nothing about it is a fixture.**
    // `KERNEL_RECORD` is signed by `KERNEL_TRUST_ANCHOR`, which is already this binary's
    // default `--trust-anchor`, so a coordinator started with no anchor flags dispatches a
    // module every stock agent in this repository will accept. Importing a test fixture here
    // would have made the one runnable coordinator run something no operator can.
    coordinate: { type: 'string' },
    // The problem size the coordinated job runs at — the `n` of `buildInput(n, budget)`,
    // defaulting to {@link COORDINATED_N}. A knob rather than a constant because the cost of
    // one cube is what decides whether a departure lands mid-job or after it, and that is a
    // property of the host rather than of this source.
    'coordinate-n': { type: 'string' },
    // CHURN-04 — how long the coordinated job's tasks may go silent before a shard is taken
    // back and placed somewhere else, in milliseconds. Absent means `DEFAULT_LEASE_MS`
    // (30 000), which is what this leg ran at before this flag existed and what it still
    // runs at unless an operator says otherwise.
    //
    // ## It is a parameter, not a gate, and the ruling requires that distinction to be made
    //
    // `.planning/consults/2026-08-18-owner-ruling-role-selector-vs-feature-gate.md` puts the
    // burden on a flag to say which it is, in its own docblock, where a reader meets it. This
    // one is neither of the ruling's two cases and the third is the honest answer: **the
    // capability is not behind it at all.** `submitJob` grants a lease per dispatch, expires
    // it on silence and re-places the shard on an untried node with this flag absent exactly
    // as with it present — the flag moves a *duration*, the way `--coordinate-n` moves a
    // problem size. There IS a correct default, it is 30 000, and it is what ships.
    //
    // ## Why an operator needs it, stated as the number rather than as a preference
    //
    // A lease bounds how long a requestor waits on a holder that has gone quiet, so the only
    // sane size for it is a property of the workload. `RENEW_AT` is two-thirds, so a dispatch
    // must be outstanding 20 s before renewal is even asked about and 30 s before the
    // deadline bites, while a cube at the default `--coordinate-n 300` measures ~60 ms on
    // this host — a factor of ~330. At that ratio the lease is not a bound on anything this
    // job does; it is a constant that can never be reached. An operator running minute-long
    // tasks wants it larger, and one running a fabric of tabs that vanish wants it smaller,
    // and neither can say so by editing a source file.
    'lease-ms': { type: 'string' },
    // Where the coordinated job's **content-addressed state** lives: the shard inputs, the
    // shard results, and the checkpoint blocks. Defaults to `--dir`, which is the case the
    // criterion is about — a store an operator named, that outlives the process that wrote
    // it.
    //
    // **It is separate from `--dir` because a peer id is not job state.** `--dir` also holds
    // this node's identity seed (`fabric-node.ts`, search `loadOrCreateSeed`), so two
    // processes pointed at one `--dir` are one peer id wearing two processes. A *second
    // requestor* that inherits the first one's identity is a weaker claim than the criterion
    // makes, so the hand-off is staged on the store alone and each process keeps its own
    // `--dir`. What crosses between them is a directory of content-addressed blocks and one
    // CID — nothing else, by construction.
    //
    // The module and the shard input are put into **`node.store`** rather than into this
    // store, deliberately: peers fetch them off this node over the wire, and the wire serves
    // `--dir`. A job store that no peer can read would produce a fabric where every dispatch
    // fails to fetch its input.
    'job-store': { type: 'string' },
    // CHURN-03's read half on this binary: checkpoint handles to resume from, **newest
    // first**, passed straight to `SubmitOptions.resumeFrom`.
    //
    // One is the ordinary case — a requestor departed, published a handle, and this process
    // is handed that CID and the same job description. More than one is the recovery case:
    // `recoverCheckpoint` takes the newest **readable** handle and reports how many it had
    // to skip, because a chain cannot be walked backwards past a block that is gone.
    //
    // A CID is public by construction, exactly as `--trust-anchor` and `--owner-key` are: it
    // is a hash of content, it is printed on this process's own stdout when it writes one,
    // and it names a block anybody holding the store can already read.
    'resume-from': { type: 'string', multiple: true },
    // AUTH-03 / MR-02 / VER-09 — **the sovereign coordinator leg's owner half.** Repeatable;
    // each value is the path to a file holding one owner's 32-byte seed, an owner that has
    // authorised this process to ask the fabric to compute over its data.
    //
    // ## Why this is a ROLE SELECTOR and not a feature gate, which is the whole reason it
    // ## may exist at all
    //
    // `.planning/consults/2026-08-15-owner-ruling-off-by-default-flag.md` rules that a
    // capability reachable only behind an off-by-default flag is **not shipped** — *"It must
    // work with no flag."* `.planning/consults/2026-08-18-owner-ruling-role-selector-vs-
    // feature-gate.md` refines it with a test that is about the **default**, not about the
    // word "flag": *would the capability be correct if the flag defaulted on?* If yes it is
    // a feature gate and the first ruling applies; if **no default would be correct, because
    // the flag names which of several roles this process takes**, it is a role selector and
    // the ruling does not apply.
    //
    // This flag has no correct default and the reason is not stylistic: its value is *whose
    // data this process acts for*. A default would have to name some particular owner, and
    // there is no owner a shipped binary could name — the same argument `--owner-key` and
    // `--can-execute-sovereign` already carry on the serving side, where defaulting would
    // pin every agent to an owner it was never given. An agent with no owner seed has
    // nothing to coordinate a sovereign job over, exactly as an agent with no
    // `--coordinate` has no job to coordinate.
    //
    // ## A path, never the seed itself — this binary's standing rule
    //
    // argv is world-readable in `ps` to every account on the host, so a private key on a
    // command line is a private key everybody has. `--user-key` is a path for that reason
    // and this is the same rule applied to the same kind of value. The file must be exactly
    // `SEED_BYTES` long and a missing one is exit 2 rather than a fresh key — minting one
    // would root a capability chain at an owner nobody controls and report success.
    //
    // ## Why the requestor holds an owner's ROOT key here, stated as the limit it is
    //
    // `capability.ts` supports multi-link chains — *"the owner delegates to a coordinator,
    // the coordinator may delegate onward"* — so a real deployment would hand this process a
    // delegation rather than a seed. It is not modelled here because no production surface
    // in this repository carries a delegation between processes, and every requestor that
    // mints a chain today signs with the owner's own key: `bin/bench.ts`'s
    // `sovereignSupplierFor`, and `sovereign-aggregation.node.test.ts`'s `dispatchAs`. This
    // flag is that same arrangement made runnable, not a new trust model.
    'sovereign-owner': { type: 'string', multiple: true },
    // MR-02 — **the sovereign coordinator leg's data half.** Repeatable; each value is the
    // path to a file holding one row of the correspondingly-positioned `--sovereign-owner`'s
    // data, as the bytes that owner's guest will read.
    //
    // **Paired by position, and the counts must be equal or the process exits 2.** Two
    // repeatable flags read in order is the only pairing available without inventing a
    // separator parser, which this file refuses twice by name — `--trust-anchor` and
    // `--trusted-issuer` are repeatable rather than comma-separated *"because a comma-split
    // string would be a parser nobody asked for"*.
    //
    // **The bytes are not interpreted here.** They become the shard's `value` unchanged, so
    // what an owner's guest reads is what the operator put in the file. The leg dispatches
    // `@o2/demo`'s prime-counting kernel, so a well-formed row is `buildPrimesInput(n)`'s
    // eight bytes; anything else is refused *by the guest*, and `readPrimeCount` turns that
    // refusal into a named failure rather than a zero summed into the aggregate. Validating
    // the shape here would put the coordinator in the business of understanding the owner's
    // data, which is the one thing a sovereign requestor must not need to do.
    //
    // **This row must already be resident on its owner's node**, and that is the premise
    // rather than an omission: `submitJobWithEgress` registers every sovereign shard's
    // canonical bytes on this process's own `EgressGuard` for the job's duration, so an
    // owner that did not already hold its row would ask this process for the block and the
    // guard would refuse the reply. The job completing at all is therefore evidence that no
    // raw row crossed the wire — `sovereign-aggregation.node.test.ts` states the same
    // consequence from the other side, and seeds each owner's `--dir` before its agent
    // starts. That is what "the owner's data lives on the owner's node" means as a fact
    // about a blockstore rather than as a slogan.
    'sovereign-row': { type: 'string', multiple: true },
  },
})

const USAGE =
  'usage: agent.ts --dir <blockstore-dir> [--port <n>] [--owner-id <id — the enrolled user key when --user-key is given> [--owner-key <hex>] [--can-execute-sovereign]] [--trust-anchor <hex> ...] [--issues-certificates --max-issued-per-window <n>] [--provider-addr <multiaddr> --user-key <path> --operator-id <id>] [--trusted-issuer <hex> ...] [--admit-issuer <hex> ...] [--peer-addr <multiaddr> ...] [--max-concurrent-tasks <n>] [--inbound-threshold <n>] [--duty-cycle <n>] [--relay-addr <multiaddr> ...] [--coordinate <shards> [--coordinate-n <n>] [--lease-ms <ms>] [--job-store <dir>] [--resume-from <cid> ...]] [--sovereign-owner <seed-path> --sovereign-row <row-path> ... (paired, at least twice)]\n'

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

// AUTH-04: the two halves of a provider's configuration travel together or the process
// does not start, which is `--provider-addr`'s rule applied to the other side of the same
// exchange. A provider with no stated budget is the unbounded issuance criterion 5 exists
// to end, and a budget on a process that issues nothing is a policy about nothing — so
// both directions are refused rather than one of them silently ignored.
if (values['issues-certificates'] && values['max-issued-per-window'] === undefined) {
  refuse('--issues-certificates requires --max-issued-per-window <n>')
}
if (!values['issues-certificates'] && values['max-issued-per-window'] !== undefined) {
  refuse(
    `--max-issued-per-window ${values['max-issued-per-window']} was given to a process that issues no certificates; add --issues-certificates or drop it`,
  )
}

// Refused here rather than clamped, for `--max-concurrent-tasks`'s recorded reason: the
// binary and `EnrollmentAuthority` must not disagree about which values exist. Without it
// `Number('plenty')` reaches the authority as `NaN`, every `issued.length >= NaN`
// comparison is `false`, and the provider signs without limit — with nothing anywhere
// reporting that the input was never a number. Zero is rejected with the rest: a provider
// that would sign nothing is better refused at the command line than left answering every
// peer with a refusal nobody configured.
if (values['max-issued-per-window'] !== undefined) {
  const budget = Number(values['max-issued-per-window'])
  if (!Number.isInteger(budget) || budget < 1) {
    refuse(`--max-issued-per-window ${values['max-issued-per-window']} is not an integer of at least 1`)
  }
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

// The identical loop for the identical reason, and **separate rather than merged with the
// one above**: the message has to name which flag was rejected, and an operator who passed
// both would otherwise be told the wrong one. The consequence of skipping it is worse here
// than for `--trusted-issuer` — a zero-filled admission key does not merely stop this node
// trusting anybody, it stops every peer obtaining a reservation, and the peers see only
// `PERMISSION_DENIED`.
for (const issuer of values['admit-issuer'] ?? []) {
  if (parseKeyHex(issuer) === null) {
    refuse(`--admit-issuer ${issuer} is not 64 lowercase hex characters`)
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

// BENCH-07: refused here rather than clamped, for the reason every other numeric flag on
// this binary is. Without it `Number('five')` reaches `connectionManager` as `NaN`, every
// rate comparison against it is `false`, and the node accepts inbound connections at no
// rate limit at all — with nothing anywhere reporting that the input was never a number.
// That is the exact shape of failure this flag exists to *measure*, so producing it by
// accident would make an attempt unreadable. Zero is rejected with the rest: a node that
// accepted no inbound connection per second would refuse every peer, which is a
// configuration better named at the command line than discovered from a dead rung.
if (values['inbound-threshold'] !== undefined) {
  const rate = Number(values['inbound-threshold'])
  if (!Number.isInteger(rate) || rate < 1) {
    refuse(`--inbound-threshold ${values['inbound-threshold']} is not an integer of at least 1`)
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
 * CHURN-03 — the coordinator leg's inputs, refused here rather than defaulted.
 *
 * Every check below is the same disposition every numeric flag above takes: a value this
 * process cannot act on is exit 2 with the input quoted, never a clamp and never a
 * silently-substituted default. Three of them are *dependency* checks in
 * `--issues-certificates`/`--max-issued-per-window`'s shape, and they exist because the
 * failure they prevent is invisible: `--resume-from` on a process that submits nothing
 * would start a perfectly healthy serving node that quietly ignored the one argument the
 * operator cared about, and the only symptom would be work being done twice somewhere else.
 */
if (values.coordinate !== undefined) {
  const shards = Number(values.coordinate)
  if (!Number.isInteger(shards) || shards < 1) {
    refuse(`--coordinate ${values.coordinate} is not an integer of at least 1`)
  }
  // The coordinator dispatches to peers and never to itself: its own id is absent from the
  // descriptor set it builds, so a coordinator with no peer has an empty executor set and
  // every shard ends `never-placed`. That is a job that reports a clean failure and teaches
  // nobody anything, so it is refused at the command line instead.
  if ((values['peer-addr'] ?? []).length === 0) {
    refuse('--coordinate requires at least one --peer-addr to dispatch to')
  }
}
if (values['coordinate-n'] !== undefined) {
  if (values.coordinate === undefined) {
    refuse(`--coordinate-n ${values['coordinate-n']} was given to a process that coordinates no job; add --coordinate <shards> or drop it`)
  }
  const n = Number(values['coordinate-n'])
  if (!Number.isInteger(n) || n < 1) {
    refuse(`--coordinate-n ${values['coordinate-n']} is not an integer of at least 1`)
  }
}
if (values['lease-ms'] !== undefined) {
  if (values.coordinate === undefined) {
    refuse(`--lease-ms ${values['lease-ms']} was given to a process that coordinates no job; add --coordinate <shards> or drop it`)
  }
  // Refused here rather than clamped, and refused *before* `LeaseTable` sees it. The table
  // throws `RangeError` on a non-positive lease, which on this path would be an unhandled
  // rejection out of a node that is already started and serving other peers' work. An
  // operator's typo belongs with the usage line — `--max-concurrent-tasks`' recorded reason.
  const leaseMs = Number(values['lease-ms'])
  if (!Number.isInteger(leaseMs) || leaseMs < 1) {
    refuse(`--lease-ms ${values['lease-ms']} is not an integer of at least 1`)
  }
}
if (values['job-store'] !== undefined && values.coordinate === undefined) {
  refuse(`--job-store ${values['job-store']} was given to a process that coordinates no job; add --coordinate <shards> or drop it`)
}
for (const handle of values['resume-from'] ?? []) {
  if (values.coordinate === undefined) {
    refuse(`--resume-from ${handle} was given to a process that coordinates no job; add --coordinate <shards> or drop it`)
  }
  // Parsed here and parsed again at the call site, deliberately: a malformed CID is an
  // operator's typo and belongs with the usage line, while `submitJob`'s own
  // `checkpoint-unreadable` is a statement about a block that is missing or corrupt. Two
  // different conditions with two different responses — fix the command, or accept that the
  // checkpoint is gone — and collapsing them would report the second for the first.
  try {
    CID.parse(handle)
  } catch (cause) {
    refuse(
      `--resume-from ${handle} is not a CID: ${cause instanceof Error ? cause.message : String(cause)}`,
    )
  }
}

/**
 * The sovereign coordinator leg's configuration, refused at parse time rather than at
 * dispatch time — AUTH-03 / MR-02 / VER-09.
 *
 * Every refusal below names a condition under which the leg could **start and then produce
 * nothing**, which is the failure mode this whole region exists to remove: a sovereign shard
 * that is never placed comes back `unplaceable` with nothing anywhere obviously wrong, and
 * `--owner-id`'s own docblock records the day that cost. An operator's misconfiguration
 * belongs with the usage line, before a socket is bound.
 */
const sovereignOwners = values['sovereign-owner'] ?? []
const sovereignRows = values['sovereign-row'] ?? []
if (sovereignOwners.length !== sovereignRows.length) {
  refuse(
    `--sovereign-owner was given ${String(sovereignOwners.length)} time(s) and --sovereign-row` +
      ` ${String(sovereignRows.length)}; they are read in order and pair one row to one owner,` +
      ' so the counts must be equal',
  )
}
if (sovereignOwners.length > 0) {
  // Two, and it is `MIN_SOVEREIGN_COMBINE_REPLICAS`' sibling rather than a round number.
  // `deriveReduceTree` **promotes** a lone contribution instead of combining it, so a job
  // with one owner-pinned row produces an aggregation with no combine in it at all and
  // `reduceSovereignJob` refuses it by name. One row is therefore a job this process could
  // dispatch and could never aggregate — the shape MR-02 is about — and refusing it here is
  // cheaper than discovering it after two spawns and a dispatch.
  //
  // A second row may belong to the *same* owner: what the aggregation requires is two
  // **contributions**, not two identities, which `reduce-sovereign.test.ts` measures
  // directly. So passing one seed file twice is legal and means one owner contributing two
  // rows.
  if (sovereignOwners.length < 2) {
    refuse(
      '--sovereign-owner/--sovereign-row must be given at least twice: a sovereign aggregation' +
        ' combines contributions, and a single contribution is promoted rather than combined',
    )
  }
  if ((values['peer-addr'] ?? []).length === 0) {
    refuse('--sovereign-owner requires at least one --peer-addr to dispatch to')
  }
  // Discovery verifies each candidate's certificate **offline** against the issuers this
  // process pins, and a process pinning none qualifies nobody — so the leg would find no
  // executor and report a curve measured on nothing. Named here rather than at the lookup,
  // for the reason above.
  if ((values['trusted-issuer'] ?? []).length === 0) {
    refuse(
      '--sovereign-owner requires at least one --trusted-issuer <hex>: a sovereign candidate is' +
        " qualified by the certificate a provider signed about it, and this process pins nobody's",
    )
  }
}

/**
 * Read the user seed named by `--user-key`, refusing anything that is not exactly the
 * right size.
 *
 * `flag` names the option in the refusal because two flags now pass through here —
 * `--user-key`, this process's own enrolment identity, and `--sovereign-owner`, an owner that
 * authorised this process to act for it. Both name a **user** key, which is why one reader
 * serves both; an operator who mistyped one path needs to be told which one.
 *
 * A wrong-length file is exit 2 for the same reason `loadOrCreateSeed` throws on one:
 * reinterpreting a truncated file as a key would enrol this node under a user key nobody
 * holds, and the only symptom would be a certificate naming a stranger.
 *
 * The bytes are copied out of Node's `Buffer` pool rather than handed on as a view into a
 * shared slab — the same reason `loadOrCreateSeed` and `FsBlockstore.get` copy.
 */
async function readUserSeed(path: string, flag = '--user-key'): Promise<Uint8Array> {
  let raw: Buffer
  try {
    raw = await readFile(path)
  } catch (cause) {
    refuse(`${flag} ${path} could not be read: ${cause instanceof Error ? cause.message : String(cause)}`)
  }
  if (raw.length !== SEED_BYTES) {
    refuse(`${flag} ${path} holds ${String(raw.length)} bytes, expected exactly ${String(SEED_BYTES)}`)
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

/**
 * One owner's contribution to a sovereign job: the key its chain is rooted at, the seed that
 * signs it, the bytes of its row, and the CID its own node answers a provider lookup for.
 */
interface Contribution {
  readonly ownerKey: PublicKeyHex
  readonly seed: Uint8Array
  readonly value: Uint8Array<ArrayBuffer>
  readonly cid: CID
}

/**
 * The sovereign coordinator leg's contributions, loaded **before `FabricNode.start`** —
 * AUTH-03 / MR-02 / VER-09.
 *
 * **Here rather than inside the leg at the bottom of this file, and the position is the
 * point.** Every failure below is an operator's typo — a seed file that is not there, one
 * that is the wrong length, a row file that cannot be read — and `refuse` is exit 2 *plus the
 * usage line*, which is the right answer to a typo and the wrong answer to hand a process
 * that has already bound a socket, started a worker thread and begun serving other peers'
 * work. `--peer-addr`'s dial failure records the same distinction from the other side, and
 * has to stop the node before refusing precisely because it cannot be checked this early.
 * These can be, so they are.
 *
 * `[]` when the flag is absent, which is what makes the leg at the bottom one comparison
 * against zero.
 */
const contributions: Contribution[] = []
for (const [index, seedPath] of sovereignOwners.entries()) {
  // `identityFromSeed` and not a second derivation: it is this repository's one
  // seed→public-key route, and `--owner-id`'s docblock records why a second one here would be
  // the extra source of truth this tree keeps refusing to create. The value it returns is
  // byte-for-byte what a provider signs into `NodeCertificate.userKey` for the same seed,
  // which is what makes the shard's `ownerId` and the descriptor's `ownerId` comparable at all.
  const seed = await readUserSeed(seedPath, '--sovereign-owner')
  const ownerKey = (await identityFromSeed(seed)).nodeKey
  const rowPath = sovereignRows[index] as string
  let raw: Buffer
  try {
    raw = await readFile(rowPath)
  } catch (cause) {
    refuse(
      `--sovereign-row ${rowPath} could not be read: ${cause instanceof Error ? cause.message : String(cause)}`,
    )
  }
  // Copied out of Node's `Buffer` pool rather than handed on as a view into a shared slab —
  // `readUserSeed` and `FsBlockstore.get` copy for the same reason.
  const value = new Uint8Array(raw.byteLength)
  value.set(raw)
  const encoded = await canonicalCid(value)
  if (!encoded.ok) {
    // Not `refuse`: an encoding this process could not perform is not a usage error, and the
    // usage line is the wrong thing to print at somebody whose command line was fine. Same
    // distinction the `--coordinate` leg draws for its own input.
    process.stderr.write(
      `agent.ts: --sovereign-row ${rowPath} will not canonicalise: ${JSON.stringify(encoded.error)}\n`,
    )
    process.exit(1)
  }
  contributions.push({ ownerKey, seed, value, cid: encoded.cid })
}

/** Which seed roots the chain for a given owner. Built once; read per dispatch. */
const seedFor = new Map<PublicKeyHex, Uint8Array>(
  contributions.map((one) => [one.ownerKey, one.seed]),
)


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

/**
 * NET-05's reporting line, subscribed **here** — before `FabricNode.start` — and the
 * position is the entire mechanism rather than a detail.
 *
 * **This used to sit after the settle loop below, and that cost a defect that looked for
 * three weeks like a flake.** The relay dial happens *inside* `start`, and `start` then
 * builds a transport, resolves a certificate, opens a blockstore, spawns a worker thread
 * and serves an agent before this file regains control. The refusal needs only identify's
 * round trip plus one HOP round trip to an already-connected relay. So the refusal
 * routinely arrived, was classified, and was pushed onto the watcher's failure list
 * *before anything was listening* — and `onFailure` had no replay, so nothing was ever
 * written. The node then reported the fourth outcome below, which cannot distinguish a
 * full relay from a silent one: precisely the ambiguity NET-05 exists to remove.
 *
 * Measured at roughly one run in five, and **the correlation ran backwards**, which is
 * what made it look like noise: a contended host *delays* the refusal and the late
 * subscription wins, while an idle host answers in milliseconds and the subscription
 * loses. Slower was greener.
 *
 * Subscribing here is safe and total. The watcher observes through the `logger` injected
 * into libp2p, and libp2p does not exist until `start` constructs it, so there is no
 * window in which a failure can be recorded before this line runs.
 */
watcher?.onFailure((failure) => {
  process.stderr.write(`agent.ts: relay reservation ${failure.kind}: ${failure.status}\n`)
})

/**
 * The same subscription for the **granted** case, and it is here rather than after the
 * settle loop for the reason the docblock above spent three weeks learning.
 *
 * **What this exists to fix.** Assertions about which relays a node holds have been
 * reading `agent.relays` — a snapshot taken once, at handshake time. libp2p's circuit
 * relay makes *exactly one attempt, ever*, and the settle loop below exits on the first
 * of four conditions, so a reservation granted after that snapshot is invisible to it
 * permanently. On the admitted arm that reads as a node holding no relay when it holds
 * one; on the stranger arm the same staleness has the opposite sign, and a clause
 * asserting `relays === []` passes *because* the evidence arrived late. One defect, one
 * loud instance and two silent ones.
 *
 * A line per grant, written **as each arrives** rather than once, is the live reading a
 * snapshot cannot be: a reader can wait for the relay it cares about instead of hoping
 * it had already landed.
 *
 * **stdout is untouched.** The handshake line stays byte-identical, because the bench
 * drivers parse BENCH-06/07 off it — so nothing that reads this process needs revisiting.
 * Grants go to stderr, beside the refusals, which is where a reader already looks.
 */
watcher?.onGrant((grant) => {
  process.stderr.write(`agent.ts: relay reservation granted: ${grant.relay}\n`)
})

/**
 * The addresses this process asks libp2p to bind, stated as one expression because the
 * three cases have to be readable together.
 *
 * | `--port` | `--relay-addr` | binds | `canRelay` | certificate |
 * |---|---|---|---|---|
 * | given | either | that port | true | `seed`, `relayIds: []` |
 * | absent | absent | `tcp/0` | true | `seed`, `relayIds: []` |
 * | absent | given | **nothing** | false | `via-relay`, the relay named |
 *
 * The first two rows are what this binary has always done — the middle row is the old
 * `default: '0'` restated where it can be seen beside the case it used to exclude, and it
 * is why dropping that default changed no existing invocation.
 *
 * **The third row is keyed on `--port` being absent, not on `--relay-addr` being present**,
 * which is why the default had to go: `parseArgs` cannot otherwise tell *not passed* from
 * *passed as `0`*, and an operator who wants a relayed node that is also directly dialable
 * must still be able to say so. Every pre-existing spawn site of this binary that passes
 * `--relay-addr` therefore states `--port 0` — three call sites, all in
 * `reservation-exhaustion.node.test.ts`, all of which are about a node that is still
 * serving directly when its relay refuses it.
 *
 * `[]` rather than an omitted key, deliberately. `FabricNode.start` reads
 * `options.listen ?? (viaRelay ? [] : [...])`, so omitting it would produce the same
 * addresses by way of a default stated in another file; passing `[]` makes this binary's
 * own choice legible where the flags that decided it are.
 *
 * **Not a node kind** — see `--port`'s and `--relay-addr`'s docs above. This expression
 * chooses a route, never a class, and every capability is identical on all three rows.
 */
const listen =
  values.port !== undefined
    ? [`/ip4/127.0.0.1/tcp/${values.port}`]
    : relayAddrs.length === 0
      ? ['/ip4/127.0.0.1/tcp/0']
      : []

node = await FabricNode.start({
  // AUTH-02 — who this agent admits if it relays, stated by name.
  //
  // **A ternary rather than the conditional spread its two sibling flags use, and the
  // difference is forced by the type rather than chosen.** `trustedIssuers` and
  // `sovereignty` are *optional*, so `exactOptionalPropertyTypes` makes an absent key and an
  // explicit `undefined` different things and those sites write
  // `...(values[…] === undefined ? {} : { … })`. `relayAdmission` is **required**: there is no
  // key to omit, this site takes a value either way, and the shape is therefore a ternary
  // whose absent arm is the literal open posture. Writing a conditional spread here would not
  // compile, and writing one that did would mean the field had stopped being required.
  //
  // Absent `--admit-issuer`, this is byte-for-byte the value this line held before the flag
  // existed, which is what keeps all 19 existing argv sites behaving identically.
  //
  // **There is still no `--admit-any-peer` flag, and that is not the gap this closes.**
  // Whether this binary should **refuse to start** when an operator states neither a pinned
  // issuer nor an explicit open posture is an open owner ruling, deliberately not decided
  // here. Its cost was measured when `--trusted-issuer` landed: 19 argv-construction sites
  // across 18 `*.node.test.ts` files spawn this binary, and 3 more spawn `bin/seed.ts`; none
  // of them is a published measurement. That is the whole price of the fail-closed answer,
  // and the owner is entitled to see it before ruling.
  relayAdmission:
    values['admit-issuer'] === undefined ? 'admits-any-peer' : new Set(values['admit-issuer']),
  // BROW-01 — what this process says about *itself* when a peer asks for start counts:
  // one `other` row, which is the coarsest label the range has and carries no version and
  // no machine. Open because BROW-02's whole purpose is to make a blocklist's silence
  // visible, and an agent that withheld its own row would be manufacturing a little of
  // that silence — while an operator who wants it withheld has a named value to write
  // here. **No flag yet, and that is the gap**: the choice is an option rather than argv,
  // so an operator states it by editing this line. Adding `--withholds-start-report`
  // belongs with whatever else this entry point next learns to say, not smuggled in here.
  startReporting: 'reports-its-own-start',
  blockstoreDir: values.dir,
  listen,
  trustAnchors,
  // AUTH-04: absence is "this process issues no certificates", and presence carries the
  // aggregate budget, because `FabricNodeOptions` cannot express a provider that never
  // stated one. Validated above, so `Number` here cannot produce anything the authority
  // would misread; and `exactOptionalPropertyTypes` makes an absent key and an explicit
  // `undefined` different types, so a non-provider adds no key at all.
  //
  // No `certificateLifetimeMs` beside it, and the omission is a decision rather than an
  // oversight — the owner's 2026-08-02 correction rules certificate lifetimes out of this
  // argument, so a knob for the neighbouring option would invite exactly the renewal
  // tuning that correction forbids. Revocation here is non-renewal on the certificate's
  // own clock, not a shorter clock and not a list.
  ...(values['issues-certificates']
    ? { issuesCertificates: Number(values['max-issued-per-window']) }
    : {}),
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
  // BENCH-07 — same conditional-spread idiom, same `exactOptionalPropertyTypes` reason, and
  // one extra consequence that is the whole point of the flag: with it absent the key is
  // absent, so the node keeps the value its own derivation gives it rather than being pinned
  // to a parsed `NaN`. An unflagged agent therefore announces the *derived* figure below,
  // which is the reading the published exclusion's constant has to be compared against.
  ...(values['inbound-threshold'] === undefined
    ? {}
    : { inboundConnectionThreshold: Number(values['inbound-threshold']) }),
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
  // AUTH-04 — **somebody else's answer is not this operator's mistake.**
  //
  // A node whose enrolment the provider refused — because that provider has signed its
  // stated number of certificates for the window — was configured perfectly well. So it
  // leaves with **exit 1** and the provider's own words, and never through `refuse`, which
  // is exit 2 *and prints the usage line*. Telling an operator whose provider is merely
  // busy that their command line is wrong is the failure this branch exists to prevent,
  // and it is the same distinction `--relay-addr` already draws between a malformed input
  // and a relay that answered no.
  //
  // **It is still fatal, and that is deliberate rather than an omission.** The plan for
  // this work asked for a started node with `certificate: null` on the handshake line
  // instead. That would overturn `FabricNodeOptions.enrollment`'s recorded contract
  // (17-CONTEXT.md decision 9): a node told to enrol, unable to, and running anyway is a
  // node whose identity claim is absent — the shape `.planning/PROJECT.md` records as a
  // hole — and every caller of that option, in this binary and out of it, currently relies
  // on "enrol or do not start". Changing it is a decision about the library's contract and
  // does not belong inside a flag addition. What the plan's sentence was *for* — that an
  // exhausted provider is not a misconfigured node — is delivered here by the exit code
  // and by the absence of the usage line, and both are asserted in
  // `enrollment-cost.node.test.ts`.
  //
  // Nothing needs stopping on this path: `FabricNode.start`'s own `undo` stack releases
  // everything it acquired before it rejected, which is the guarantee that lets this be one
  // line rather than a shutdown sequence.
}).catch((cause: unknown): never => {
  process.stderr.write(`agent.ts: ${cause instanceof Error ? cause.message : String(cause)}\n`)
  process.exit(1)
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
  // The reporting subscription is NOT here. It is taken before `start`, and the comment
  // there says why — a refusal recorded during `start` reached a watcher nobody was
  // listening to, and the line was silently lost. Two claims that used to stand in this
  // spot were false and are recorded here so neither is reintroduced:
  //
  //   1. *"The wait cannot end until the failure has already been recorded, so a replay
  //      would report it first and the subscription would never fire."* Inverted. The
  //      failure is usually recorded long before the wait **starts**, which is exactly
  //      how it was lost.
  //   2. *"libp2p keeps retrying a reservation for the life of the node."* Not in
  //      `@libp2p/circuit-relay-v2@4.2.9` on this configuration: there is exactly one
  //      attempt, ever. `relay:discover` fires only from `_onPeerIdentify`;
  //      `RelayDiscovery.startDiscovery()` returns early once `running` is set, and
  //      `running` clears only on `relay:found-enough-relays`, which a node that never
  //      succeeds never emits; and the refresh timer is armed only on success. **A single
  //      lost attempt is permanent**, which is why the whole requirement rested on one
  //      message being printed once.
  //
  // What remains here is the wait, which needs `node` and therefore cannot move.
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
    // AUTH-02 — this node's admission posture, and it is here for a **proof requirement**
    // rather than for tidiness.
    //
    // A fixture that spawns a closed-arm agent has to be able to assert *that arm is really
    // closed*. Without a published posture a typo in argv produces an open agent and the
    // reading passes for the wrong reason — which is the single most likely way a
    // cross-process admission proof lies, and this repository has already carried two
    // criteria at PARTIAL for exactly that shape of tautology.
    //
    // Public by construction, on the same ground as `trustAnchors` immediately above: these
    // are pinned issuer **public** keys, and the open value is a sentinel naming a behaviour
    // every peer discovers by trying. Adding a field is additive under the module comment's
    // own rule for this line — *every reader destructures the keys it names* — so no existing
    // reader of the handshake breaks.
    //
    // A sorted array rather than the `Set`, because JSON has no set and
    // `JSON.stringify(new Set())` is `{}` — which would publish the fail-closed posture as an
    // empty object indistinguishable from a missing field.
    relayAdmission:
      values['admit-issuer'] === undefined ? 'admits-any-peer' : [...values['admit-issuer']].sort(),
    nodeKey: node.nodeKey,
    certificate: node.certificate,
    issuerKey: node.issuerKey,
    peers,
    dutyCycle: node.dutyCycle,
    relays: node.circuitAddrs,
    // BENCH-07 — see the module comment. `process.pid` and never a value passed in or
    // derived: the claim is that *this* process is the one serving the addresses above it,
    // and only this process can state that about itself.
    pid: process.pid,
    // BENCH-06 — the host this process is actually running on, stated by the process that
    // is running on it, for exactly the reason `pid` immediately above is.
    //
    // **The parent cannot supply this and have it mean anything.** A driver that filled a
    // machine record in on a child's behalf would be publishing its own host under the
    // child's name, so a rig that had silently fallen back to in-process nodes would
    // produce an inventory indistinguishable from a genuinely distributed one — which is
    // the same tautology `announcedPid` exists to break, applied to the quantity BENCH-06
    // is actually about. `hostCount` over these announcements is what makes the published
    // SAME-MACHINE label an observation rather than a declaration; until this key existed
    // the driver's inventory was a one-element array built from its own `hostname()`, so
    // the label could not have come out any other way and no plant against it could fail.
    //
    // Additive under the module comment's own rule for this line — *every reader
    // destructures the keys it names* — so no existing parent of this binary breaks.
    //
    // `roles` and `physicalCores` are deliberately **not** here. An agent does not know
    // what position a rig put it in, and `os.cpus()` reports logical CPUs with no portable
    // way to ask for physical ones; both are the driver's to fill, and a process guessing
    // at either would be announcing an opinion beside six measurements.
    machine: {
      hostId: hostname(),
      // `?? 'unknown'` rather than the bare optional, matching the driver's own reading of
      // the same call: `JSON.stringify` drops an `undefined` value, so the bare form would
      // publish a *missing key* on a host that reports no CPUs and an absent field is not
      // the same statement as an unknown model.
      cpuModel: cpus()[0]?.model ?? 'unknown',
      logicalCores: cpus().length,
      totalMemoryBytes: totalmem(),
      os: platform(),
      kernel: release(),
      runtime: `node ${process.version}`,
    },
    // BENCH-07 criterion 3 — the two inbound limits, read off the **started node's own
    // getters** and never off `values`, and the difference is the whole reason these keys
    // exist.
    //
    // Only one of them can be set on this command line, and neither has to be: absent the
    // flag, `FabricNode.start` derives both from the reservation limit. A run that published
    // what it *passed* instead of what the node ended up with would reproduce, at the
    // reporting layer, precisely the defect it is being built to remove — the published
    // exclusion names a constant the code does not necessarily run at, and it names it
    // because somebody wrote down the intent rather than reading the node.
    //
    // Both are public by construction, exactly as every field above: a rate limit is
    // announced to any peer that meets it.
    inboundConnectionThreshold: node.inboundConnectionThreshold,
    maxIncomingPendingConnections: node.maxIncomingPendingConnections,
  })}\n`,
)

/**
 * NET-05's whole point, on stderr rather than on the handshake line.
 *
 * **Four outcomes, four different words, and the distinction is the deliverable.** A
 * relay that granted, a relay that was reached and refused for want of capacity, and a
 * relay that was never reached at all demand different responses — carry on, try another
 * relay or wait, and fix the address. Collapsing any two of them into "no circuit address
 * appeared" is the silence this requirement exists to replace.
 *
 * **The fourth arrived with task #53, and it exists because the third could state a
 * falsehood.** "No relay granted a reservation yet" was derived from `circuitAddrs` being
 * empty — but a grant and the circuit address it produces are two events, and the settle
 * loop above is bounded. A node whose grant landed just after that bound printed *no relay
 * granted* about a relay that had, in fact, granted. That is an absence claim made from a
 * reading that cannot see the thing it denies, which is the shape this repository has
 * already had to correct on the demo's refusals line. The watcher observes grants directly,
 * so the two cases are now separated by name rather than merged into the weaker one.
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
    process.stderr.write(
      watcher.grants.length === 0
        ? `agent.ts: no relay granted a reservation yet; still serving directly\n`
        : `agent.ts: a relay granted a reservation but no circuit address had appeared yet; ` +
          `still serving directly\n`,
    )
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

/**
 * CHURN-03 / ROADMAP Phase 20 criterion 7 — **the coordinator leg.**
 *
 * Everything below runs only when `--coordinate` was given. With the flag absent this block
 * is one comparison against `undefined` and the process is byte-for-byte the serving node it
 * was before the flag existed — which is the standing rule on this binary and the reason
 * `--discover` is written the same way in `bin/bench.ts`.
 *
 * ## Where it sits, and why that is at the very bottom
 *
 * After the handshake line, so a parent that spawned this process already knows how to reach
 * it and has already dialled it if it wanted to. After the signal handlers, so the job can be
 * interrupted — a coordinator that could not be stopped mid-job could not depart mid-job, and
 * departing mid-job is the whole of the criterion this closes. After the SIGHUP re-read, so
 * an operator can still move the duty cycle of a node that is coordinating.
 *
 * ## What it writes on stdout, and why it is one line per checkpoint
 *
 * The module comment's rule for the handshake line is that it is the **first** line and that
 * every parent parses up to the first newline. This block writes further lines after it, and
 * they are additive under exactly that rule: no existing reader gets to them, because no
 * existing spawn passes `--coordinate`.
 *
 * A line **per confirmed checkpoint** rather than a summary at the end, and this is not a
 * convenience. A departed requestor is precisely one that never reaches the end of its job —
 * `JobResult` is the thing it does not get — so a handle published at the end is a handle
 * nobody would ever read. The line is written from inside the sink, after the block has been
 * read back out of the store, so a handle on stdout is a handle whose block is already
 * retrievable.
 *
 * ## The workload, and the one thing it is not
 *
 * The demo colouring kernel under {@link KERNEL_RECORD}, signed by `KERNEL_TRUST_ANCHOR` —
 * which is this binary's own default `--trust-anchor`. So a coordinator started with no
 * anchor flag dispatches a module every stock agent accepts, and nothing here reaches into a
 * test fixture. `shards` copies of one input value, which is the demo page's own shape: a
 * cube is distinguished by `partition()` inside the guest, not by its input block.
 */
if (values.coordinate !== undefined) {
  /**
   * The default problem size, and the reason it is a default rather than a constant.
   *
   * 300 is the first rung of the demo's own ladder (`colouring-surface`'s fixtures), so it is
   * a size this project already runs and reads answers from. `--coordinate-n` exists because
   * the cost of one cube decides whether a departure lands *mid*-job or after it, and that is
   * a property of the host rather than of this source — a fixture that needs a slower cube on
   * a fast machine states so in argv instead of editing this line.
   */
  const COORDINATED_N = 300
  /**
   * One replica per shard.
   *
   * **Stated rather than inherited, and it is a scoping decision.** Redundancy is criterion
   * 2's and criterion 3's subject and it is not this leg's: what a checkpoint records is the
   * *agreed* result of a shard, and a shard agrees at one replica exactly as it does at
   * three. Running this leg at a higher redundancy would multiply every dispatch without
   * changing a single field of a `JobCheckpoint`, and would make the smallest fabric that can
   * coordinate a job larger for no reading.
   */
  const COORDINATED_REDUNDANCY = 1

  const shards = Number(values.coordinate)
  const n = values['coordinate-n'] === undefined ? COORDINATED_N : Number(values['coordinate-n'])

  /**
   * The job's content-addressed state: shard inputs, shard results, checkpoint blocks.
   *
   * `node.store` when `--job-store` is absent, which is the case the criterion names — a
   * store an operator chose with `--dir`, on disk, outliving this process. A separate
   * directory when it is present, so a *successor* process can be handed the job's state
   * without inheriting this node's identity seed. See `--job-store`.
   */
  const jobStore =
    values['job-store'] === undefined ? node.store : await FsBlockstore.open(values['job-store'])

  // Into `node.store` and not into `jobStore`: this is what peers fetch off this node over
  // the wire, and the wire serves `--dir`. `submitJob` also puts the shard input into
  // `jobStore` on its own account — that copy is what a *resume* reads, and it is a different
  // question from what a *peer* reads.
  const moduleCid = await node.store.put(kernelBytes)
  const input = buildInput(n, DEFAULT_BUDGET)
  const encodedInput = await canonicalCid(input)
  if (!encodedInput.ok) {
    // Not `refuse`: the node is started and serving other peers' work by now, and a usage
    // line is the wrong answer to an encoding this process could not perform. Exit 1 with the
    // reason, on `--provider-addr`'s side of that distinction rather than on `--duty-cycle`'s,
    // because a coordinator that cannot build its own input has nothing left to do.
    process.stderr.write(
      `agent.ts: the coordinated job's input will not canonicalise: ${JSON.stringify(encodedInput.error)}\n`,
    )
    await node.stop().catch(() => {})
    process.exit(1)
  }
  await node.store.put(encodedInput.bytes)

  /**
   * The id `submitJob` will file this job's checkpoints under, derived here **before** the
   * call that derives it again internally.
   *
   * Reported rather than used: this process passes handles, not ids. It is on the line below
   * because a resume is refused by name when the handle names another job
   * (`checkpoint-names-another-job`), and an operator holding a CID and a refusal needs to be
   * able to see *which* job each of the two is about. `demo/main.ts` derives it by the same
   * recipe for the same reason, and `submit.test.ts` holds the two derivations together.
   */
  const jobId = await jobIdOf(
    moduleCid,
    Array.from({ length: shards }, () => encodedInput.cid),
  )

  const resumeFrom = (values['resume-from'] ?? []).map((handle) => CID.parse(handle))
  /**
   * What this process was handed, read through the production recovery path.
   *
   * **A report, not a second read half.** `submitJob` recovers again from the same handles;
   * this call exists so an operator resuming can see what the checkpoint *says* — how many
   * shards it answers, which ones are left, and how many handles were unreadable — before the
   * job runs, rather than inferring it afterwards from a shard's `ending`. `remainingWork` is
   * `checkpoint.ts`'s own answer to "what is left", and this is its first caller outside a
   * spec.
   */
  const recovered = resumeFrom.length === 0 ? null : await recoverCheckpoint(resumeFrom, jobStore)

  process.stdout.write(
    `${JSON.stringify({
      coordinating: {
        jobId,
        shards,
        n,
        redundancy: COORDINATED_REDUNDANCY,
        moduleCid: moduleCid.toString(),
        inputCid: encodedInput.cid.toString(),
        jobStore: values['job-store'] ?? values.dir,
        peers,
        resumeFrom: resumeFrom.map((handle) => handle.toString()),
        // `null` when nothing was offered, and a stated absence when something was offered
        // and none of it read back — two different conditions, so two different values.
        recovered:
          recovered === null
            ? null
            : {
                from: recovered.cid.toString(),
                skipped: recovered.skipped,
                carried: recovered.checkpoint.completed
                  .map((shard) => shard.partitionIndex)
                  .sort((a, b) => a - b),
                remaining: [...remainingWork(recovered.checkpoint)],
              },
      },
    })}\n`,
  )

  /**
   * This process's sink, over the job's own store.
   *
   * **This docblock opened *"The one sink implementation in this repository"* until
   * 2026-08-18, and it was loose when written and false by the end of that day.**
   * `checkpointsInto` (`core/checkpoint.ts`) is the one sink *implementation*; this is one
   * *use* of it, and there are four — `browser/demo/main.ts`'s `runColouring`, `runPi` and
   * `runPrimes`, and this leg. `checkpoint-optout-scope.node.test.ts` pins both figures, so
   * a second implementation and a fifth use are each a decision rather than a diff.
   *
   * `checkpointsInto` reads each handle's block back out through the same validating reader a
   * resume would use, so `confirmed` is a statement that the bytes came back and not that
   * they were written. The wrapper below prints one line per publish and says which of the
   * two it was — a handle that did not confirm is a resume nobody can perform, and reporting
   * it as a checkpoint would be publishing a promise the store cannot keep.
   */
  const written = checkpointsInto(jobStore)

  /**
   * What this coordinator states about checkpointing — the field `SubmitOptions` made
   * **required** so that silence and consent could not read the same way.
   *
   * A named binding rather than an inline literal, so that what this process states sits at
   * one place a reader can find. The other legal value of this field is the sentinel
   * `'checkpoints-nothing'`, and **five** of the repository's nine production submit sites
   * say it for reasons written beside each of them. **This sentence read "six" until
   * 2026-08-18**, and the figure is re-derived here rather than decremented: the owner ruled
   * that day that the demo page's `runPi` and `runPrimes` keep checkpoints, and a scan of
   * comment-stripped production source now finds five sentinel sites against four sinks.
   * Whether "six" was right when it was written is not asserted — what is asserted is the
   * count `checkpoint-optout-scope.node.test.ts` floors on every run. This is the leg that
   * says the other thing, and it is the whole of ROADMAP criterion 7's first clause.
   */
  const checkpoints: SubmitOptions['checkpoints'] = {
    publish: async (handle, checkpoint): Promise<void> => {
      await written.publish(handle, checkpoint)
      // Read off the sink rather than assumed: `publish` sorts the handle into `confirmed`
      // or `unconfirmed`, and only one of those is a checkpoint a successor could resume
      // from.
      const confirmed = written.newest()?.toString() === handle.toString()
      process.stdout.write(
        `${JSON.stringify({
          checkpoint: handle.toString(),
          confirmed,
          completed: checkpoint.completed
            .map((shard) => shard.partitionIndex)
            .sort((a, b) => a - b),
        })}\n`,
      )
    },
  }

  const executors: readonly Executor[] = peers.map(
    (peerId) => new RemoteExecutor(peerId, node.rpc, 'dispatches-unauthenticated'),
  )

  /**
   * `submitJobWithEgress`, never bare `submitJob` — DATA-05/DATA-06, and the guard that
   * says so caught this leg on its first run.
   *
   * `sovereign-block-refusal.node.test.ts` pins the set of production files permitted to
   * call `submitJob` directly at three, and reported this file the moment it did:
   * *"packages/node/src/bin/agent.ts calls bare submitJob. That is a new production submit
   * path, and `submitJobWithEgress`'s sovereign registration does not cover it — a submitter
   * using it holds the raw row and is unguarded."* It is right, and the remedy it names first
   * is the one taken: this leg runs only public shards today, so it registers nothing, and a
   * coordinator that later grew a `label: 'sovereign'` shard would otherwise have reached the
   * fabric with the owner's bytes unregistered on every guard. Routing through the wrapper
   * now costs one argument and removes that future silently.
   *
   * `[node.egress]` and not `[]`: the guard `FabricNode.start` already wraps this node's
   * transport in is the one that records what actually left, so a manifest sliced off it
   * describes this job's frames rather than an empty list.
   */
  /**
   * The expiries in a job's lease history, each with **how long its lease actually ran** —
   * CHURN-04.
   *
   * Paired with its own `granted` event by `taskId` **and** `generation`, because a
   * re-dispatched task has several grants and only one of them is this expiry's. `heldMs`
   * is `null` where that grant is not in the history — an absence written as one rather
   * than as a zero, which a reader could not tell from a lease that bit instantly.
   *
   * This is the figure that says the lease is what did the bounding: it is `--lease-ms`
   * when the flag is given and `DEFAULT_LEASE_MS` when it is not, plus whatever the last
   * renewal probe spent going unanswered. So it is never *below* the lease, and a reading
   * below the lease would mean a shard was taken off a node that still held it.
   */
  function expiries(
    history: readonly LeaseEvent[],
  ): readonly { taskId: string; nodeId: string; generation: number; heldMs: number | null }[] {
    const grantedAt = new Map<string, number>()
    for (const event of history) {
      if (event.kind === 'granted') grantedAt.set(`${event.taskId}#${String(event.generation)}`, event.at)
    }
    return history
      .filter((event) => event.kind === 'expired')
      .map((event) => {
        const at = grantedAt.get(`${event.taskId}#${String(event.generation)}`)
        return {
          taskId: event.taskId,
          nodeId: event.nodeId,
          generation: event.generation,
          heldMs: at === undefined ? null : event.at - at,
        }
      })
  }

  const result = await submitJobWithEgress(
    {
      moduleCid,
      // DET-03/DATA-08 — the signed mapping, not a bare CID, so every executor this reaches
      // checks the module against its own pinned anchors before the bytes are fetched.
      moduleRecord: KERNEL_RECORD,
      shards: Array.from({ length: shards }, () => ({ value: input, label: 'public' as const })),
      executors,
      nodes: publicNodes(peers.map((nodeId) => ({ nodeId }))),
      redundancy: COORDINATED_REDUNDANCY,
      // VER-03/VER-04. A coordinator on a hand-built fabric is routinely one operator with no
      // certificates at all, which is the topology this leg exists to run on;
      // `'refuses-the-shard'` here would refuse every shard of every run of it.
      onQuorumShortfall: 'runs-at-available-redundancy',
      // CHURN-04 — the production admission path, and the channel lease renewal takes its
      // evidence from. This node's own id is absent from `nodes` above, so the self-offer
      // branch `rpcAdmission` carries for the demo's sake is never reached from here.
      admit: rpcAdmission(node.rpc),
      // CHURN-04 — the lease this job's dispatches are held under. Spread rather than
      // written as `leaseMs: …`: absent is `DEFAULT_LEASE_MS`, and an explicit `undefined`
      // is a different thing to `LeaseTableOptions`' `??`. See `--lease-ms`.
      ...(values['lease-ms'] === undefined ? {} : { leaseMs: Number(values['lease-ms']) }),
    },
    jobStore,
    [node.egress],
    { checkpoints, ...(resumeFrom.length === 0 ? {} : { resumeFrom }) },
  )

  /**
   * The audit view of how this job got here — `checkpointChain`'s first caller outside a spec.
   *
   * Distinct from recovery on purpose, and the distinction is visible on a hand-off:
   * `checkpointLogOf` seeds this run's first checkpoint with the handle it resumed from as its
   * `previous`, so walking back from this run's newest handle crosses into the **departed**
   * requestor's history. A chain longer than this process's own publishes is therefore
   * positive evidence that the two runs are one job rather than two.
   *
   * It stops rather than fails at the first missing link, because an incomplete history is
   * normal — blocks are collected. So the number below is a floor on the lineage, not a claim
   * about all of it.
   */
  const newest = written.newest()
  const chain =
    newest === null
      ? []
      : await checkpointChain(newest, jobStore, (previous) => {
          try {
            return CID.parse(previous)
          } catch {
            return null
          }
        })

  process.stdout.write(
    `${JSON.stringify({
      job: result.ok
        ? {
            ok: true,
            jobId,
            complete: result.job.complete,
            redispatches: result.job.redispatches,
            /**
             * **Which kind of trouble this job had, not merely how much** — CHURN-01,
             * CHURN-04.
             *
             * `redispatches` above is a count, and a count cannot tell an expiry from a
             * surrender. `JobResult.leaseHistory`'s own docblock says why that distinction
             * is the one worth carrying: *"`expired` is a holder that went silent,
             * `surrendered` is one that answered with a failure, `renewed` is one that
             * proved it was still working"*. Until this line existed the history reached
             * `JobResult` and stopped there, so the one production coordinator in this
             * repository could re-dispatch a shard off an expired lease and print nothing
             * that said so — the requirement's own words are *"re-dispatched on lease
             * expiry"*, and an operator could not tell whether that had happened.
             *
             * A tally and the expired task ids, rather than the whole array: a 16-shard job
             * produces tens of events and stdout here is read by an operator and by
             * `lease-expiry.e2e.test.ts`, both of which want *which shards lost a lease to
             * silence*. The tally is over every kind the table can emit, built from the
             * events themselves rather than from a fixed key list, so a new `LeaseEvent`
             * kind appears here without this line being edited.
             */
            leases: {
              kinds: result.job.leaseHistory.reduce<Record<string, number>>((tally, event) => {
                tally[event.kind] = (tally[event.kind] ?? 0) + 1
                return tally
              }, {}),
              expired: expiries(result.job.leaseHistory),
            },
            speculationMultiplier: result.job.speculationMultiplier,
            shards: result.job.shards.map((shard) => ({
              partitionIndex: shard.partitionIndex,
              ending: shard.ending,
              // The count and not the ids: what a resume claims is that a carried shard was
              // dispatched **zero** times by this requestor, and `attempted` is `submitJob`'s
              // own record of the nodes it went to.
              attempted: shard.attempted.length,
              status: shard.verification.status,
              resultCid:
                shard.verification.status === 'agreed'
                  ? shard.verification.resultCid.toString()
                  : null,
            })),
            // DATA-05/DATA-06 — the manifest this job's frames produced, summarised rather
            // than dropped. A wrapper whose product never reaches an operator would be a
            // guard nobody can read, which is the shape this repository keeps finding.
            egress: result.manifests.map((manifest) => ({
              entries: manifest.entries.length,
              totalBytes: manifest.totalBytes,
              violations: manifest.violations.length,
              registeredSovereign: manifest.registeredSovereign,
            })),
            checkpoints: {
              confirmed: written.confirmed.map((handle) => handle.toString()),
              unconfirmed: written.unconfirmed.map(({ handle, reason }) => ({
                handle: handle.toString(),
                reason,
              })),
              chain: chain.length,
            },
          }
        : { ok: false, error: result.error },
    })}\n`,
  )
}

/**
 * AUTH-03 / MR-02 / VER-09 — **the sovereign coordinator leg.**
 *
 * Everything below runs only when `--sovereign-owner` was given. With the flag absent this
 * block is one comparison against zero and the process is byte-for-byte the serving node it
 * was before the flag existed — the standing rule on this binary, the same shape
 * `--coordinate` above is written in.
 *
 * **The owners and their rows were loaded before `FabricNode.start`**, above, so every
 * refusal an operator can cause by typing the command line wrongly has already happened by
 * the time this block runs — see {@link contributions} for why that position is load-bearing
 * rather than tidy. What is left here is the fabric's answers, and those are reported rather
 * than refused with a usage line.
 *
 * ## What it is, in one sentence
 *
 * Each owner's row is already resident on that owner's own node; this process asks each of
 * those nodes to compute a partial over its own row, carrying a capability chain rooted at
 * that owner's key, and then aggregates the partials redundantly across the same nodes. No
 * row moves. `PROJECT.md` splits the integrity claim on exactly this line — *the owner's
 * contribution is trusted; the aggregation over contributions is verified* — and this leg is
 * that sentence made runnable.
 *
 * ## Why it may exist at all, given the flag ruling
 *
 * `.planning/consults/2026-08-15-owner-ruling-off-by-default-flag.md` rules that a capability
 * behind an off-by-default flag is not shipped. `.planning/consults/2026-08-18-owner-ruling-
 * role-selector-vs-feature-gate.md` refines it: a flag that could correctly have defaulted
 * **on** is a feature gate and the ruling applies; a flag for which **no** default would be
 * correct, because it names which role this process takes, is a role selector and the ruling
 * does not. `--sovereign-owner`/`--sovereign-row` name *whose data this process acts for and
 * which rows it contributes*, and a shipped binary can default to neither. The argument is
 * written out in full at `--sovereign-owner`'s own key above, where a reader meets it — which
 * is the burden that ruling places on any new flag claiming the exemption.
 *
 * ## The workload, and why it is the prime-counting kernel rather than a fixture
 *
 * `@o2/demo`'s `primesKernelBytes`, vouched for by `PRIMES_RECORD` — signed under
 * `KERNEL_TRUST_ANCHOR`, which is this binary's own default `--trust-anchor`. So a stock
 * agent started with no anchor flag accepts it, and this leg needs no build authority of its
 * own. That is not a convenience: the alternative was a signing seed committed in this
 * source, and a *deployed* node pinning a publicly-known anchor would run any module anybody
 * signed with it. `bin/bench.ts` may hold such a seed because it starts its own throwaway
 * nodes; this binary's peers are somebody else's agents.
 *
 * **And the guest genuinely reads the owner's row**, which is the property MR-02 turns on.
 * `sovereign-aggregation.node.test.ts` states the trap in full: every *other* fixture in this
 * repository emits the partition index — a number the host supplied — so a partial projected
 * from one is a pure function of something the requestor already held, and the aggregate
 * would be identical whether the guests read anything at all. π(n) is a function of the eight
 * bytes in the owner's own block and of nothing else, and the aggregate is the sum of the
 * owners' counts, which is decomposable and checkable against a table this project did not
 * write.
 *
 * ## Redundancy, twice, on two different axes — conflating them is the standing error
 *
 * The dispatch is `redundancy: 1` because a sovereign shard runs on the one node holding its
 * owner's row: pinning removes the second independent executor. The *combine* reads only
 * content-addressed partials, is runnable anywhere, and is therefore redundant at
 * {@link MIN_SOVEREIGN_COMBINE_REPLICAS}. The map cannot be redundant and the aggregation
 * must be; that is the whole of the split, and neither number is a dial this leg exposes.
 */
if (sovereignOwners.length > 0) {
  /**
   * How long this process waits for the peers it dialled to clear verification.
   *
   * A dial is not a verdict: `PeerVerifier` fetches and checks a peer's certificate after the
   * connection is up, and `discoverCandidates` is handed `verifiedPeers` rather than the
   * connected set because *"a provider list steers where work goes, so a peer that has not
   * cleared verification does not get to contribute one"*. Without this wait the lookup below
   * would run against an empty set on a fast start and report that nothing qualified — a
   * race, reported as a fabric with no candidates.
   *
   * Bounded rather than unbounded: a peer that never verifies is a real condition and the
   * honest answer is to proceed and let the lookup say what it found, not to hang.
   */
  const VERDICT_DEADLINE_MS = 30_000
  /**
   * How long a minted chain is good for.
   *
   * One hour, computed per dispatch rather than at module load so a slow run cannot expire a
   * chain minted for it. The expiry is a constraint and not a formality: an unbounded
   * delegation is the thing AUTH-03 exists to make impossible, and `verifyChain` checks it
   * against the *serving* node's clock. A configuration choice, not a measurement.
   */
  const CHAIN_TTL_MS = 3_600_000

  /**
   * AUTH-03's requestor half: the chain one candidate is dispatched under.
   *
   * ## A function OF THE NODE ID, and that is not incidental
   *
   * `CandidateOptions.dispatch` takes a function of the node id returning the supplier,
   * because a chain's audience must be the node it is sent to: *"a chain minted for node A is
   * refused at node B with `wrong-audience`"*. One supplier shared across a candidate set can
   * name at most one audience. `audienceKeyOf` derives that key from the peer id, and it is
   * the identical derivation the serving node applies to its own `libp2p.peerId` — nothing is
   * exchanged to make the two agree.
   *
   * ## Signed with the seed of the task's OWN owner, never one fixed seed
   *
   * `delegate` derives the chain's `issuer` from the key that signs it, and
   * `authorizeCapability` refuses a chain whose root is not the serving node's pinned
   * `ownerKey`. A leg that signed every shard with one seed would therefore have every worker
   * cleared for the *other* owner refuse every shard — reported as `unplaceable` with nothing
   * anywhere obviously wrong, which is the failure `bin/bench.ts`'s `sovereignSupplierFor`
   * records having actually had.
   *
   * ## `[]` for anything not owner-labelled is the correct answer, not a stub
   *
   * A public task has no owner and therefore no key a chain could be rooted at, and
   * `authorizeCapability` returns `null` for one before it ever looks at a chain. This leg
   * submits no public shard, so the branch is a statement of the contract rather than a live
   * case — and a throw there would be wrong, because the supplier is per-executor and an
   * executor built here could in principle be handed one.
   *
   * ## Copied from `bin/bench.ts` and from `capability-fixture.ts`, deliberately not imported
   *
   * `capability-fixture.ts` is test-only and outside the barrel, and importing it from a
   * runnable entry point would manufacture exactly the reachability finding this leg exists to
   * remove. `bin/bench.ts` is a sibling entry point, not a library. **The three must be kept
   * in step by hand**, which is said at each of them.
   */
  function sovereignSupplierFor(nodeId: string): CapabilitySupplier {
    return (task: Task): readonly Delegation[] => {
      if (task.label !== 'sovereign' || task.ownerId === undefined) return []
      const seed = seedFor.get(task.ownerId)
      // A throw and never an empty list: `[]` is the *correct* answer for a public task and
      // would here be indistinguishable from one, so an owner this process cannot root a
      // chain at has to stop the dispatch rather than send it unauthenticated.
      if (seed === undefined) {
        throw new Error(
          `--sovereign-owner: a task is pinned to owner ${task.ownerId}, which is none of this` +
            ' process’s owners, so no chain can be rooted at it',
        )
      }
      return [
        delegate(seed, {
          ownerId: task.ownerId,
          audience: audienceKeyOf(nodeId),
          abilities: ['execute'],
          expiresAt: Date.now() + CHAIN_TTL_MS,
        }),
      ]
    }
  }

  /**
   * How strongly one shard was attested — VER-09's display half on this binary.
   *
   * Composed from `ShardAttestation`'s own fields, exactly as `bin/bench.ts`'s
   * `strengthReading` is, so the two entry points cannot come to describe one result
   * differently. `description` is the string `attestationReceipt` already filled from
   * `describeAttestation`; rendering it rather than re-deriving it is what keeps this a
   * display of the fabric's verdict instead of a second opinion about it.
   */
  function strengthReading(attestation: ShardAttestation): string {
    if ('kind' in attestation) {
      return (
        `none established (agreeing ${attestation.agreeing}, verified ${attestation.verified}) — ` +
        attestation.reason
      )
    }
    return (
      `${attestation.strength} (replicas ${attestation.replicas},` +
      ` operators ${attestation.operators.length}) — ${attestation.description}`
    )
  }

  // A dial is not a verdict — see {@link VERDICT_DEADLINE_MS}. Membership rather than a
  // count: a count of two is satisfied by the wrong two peers.
  const verdictDeadline = Date.now() + VERDICT_DEADLINE_MS
  while (
    !peers.every((peerId) => node.verifiedPeers.includes(peerId)) &&
    Date.now() < verdictDeadline
  ) {
    await new Promise((resolve) => setTimeout(resolve, 25))
  }

  /**
   * The candidate set, one lookup per contribution.
   *
   * **Per owner, because a lookup is about one owner's clearance**, and the union is what
   * goes to `submitJob`: `eligibleNodes` narrows each shard to its own owner's nodes, so the
   * merged pool is what a real multi-owner requestor holds and the narrowing still happens
   * per shard. A per-owner *submission* would place each shard against a pool containing only
   * its owner, which would make the placement claim vacuous.
   *
   * Deduplicated by node id, because two lookups may qualify the same node and `submitJob`
   * correlates `executors` to `nodes` by that id.
   */
  const trustedIssuers = new Set<PublicKeyHex>(values['trusted-issuer'] ?? [])
  const executorsById = new Map<string, RemoteExecutor>()
  const descriptorsById = new Map<string, NodeDescriptor>()
  let excluded = 0
  for (const contribution of contributions) {
    const found = await discoverCandidates(
      { inputCid: contribution.cid, sovereignFor: contribution.ownerKey },
      {
        rpc: node.rpc,
        peers: () => node.verifiedPeers,
        // NET-06 / SCHED-01 — the composed asking index this node already builds, rather
        // than the bare `RpcRecordIndex` this helper used to construct for itself. It
        // reaches the DHT first and falls back to the peers below, so a records lookup is
        // no longer bounded by whom this process happens to be connected to.
        index: node.recordIndex,
        trustedIssuers,
        now: () => Date.now(),
        peerIdFor: peerIdForNodeKey,
        // AUTH-03 — **one argument, and it is the whole requestor half.** Every
        // `RemoteExecutor` this helper builds inherits what is written here, which is why the
        // dispatch below constructs none of its own. The sentinel
        // `'dispatches-unauthenticated'` is what every other production candidate site in
        // this repository writes, and it is correct there because every shard those sites
        // submit is public; it would be wrong here, and a shard dispatched under it is
        // refused at the executor with `unauthorized: no capability chain supplied`.
        dispatch: sovereignSupplierFor,
      },
    )
    for (const executor of found.executors) {
      if (!executorsById.has(executor.nodeId)) executorsById.set(executor.nodeId, executor)
    }
    for (const descriptor of found.nodes) {
      if (!descriptorsById.has(descriptor.nodeId)) descriptorsById.set(descriptor.nodeId, descriptor)
    }
    excluded += found.excluded.length
  }
  const executors = [...executorsById.values()]
  const descriptors = [...descriptorsById.values()]

  // The module, and the guard the demo page carries for the same reason: a kernel rebuilt
  // without being re-signed produces a provenance refusal at dispatch on every peer, and this
  // says so here instead of leaving an operator to read `module-not-vouched-for` off three
  // agents at once.
  const moduleCid = await node.store.put(primesKernelBytes)
  if (moduleCid.toString() !== PRIMES_RECORD.cid.toString()) {
    process.stderr.write(
      `agent.ts: the bundled primes kernel hashes to ${moduleCid.toString()} but the committed` +
        ` record vouches for ${PRIMES_RECORD.cid.toString()} — rebuilt without re-signing\n`,
    )
    await node.stop().catch(() => {})
    process.exit(1)
  }

  const sovereignShards = contributions.map((one) => ({
    value: one.value,
    label: 'sovereign' as const,
    ownerId: one.ownerKey,
  }))
  const distinctOwners = new Set(sovereignShards.map((one) => one.ownerId)).size

  process.stdout.write(
    `${JSON.stringify({
      coordinatingSovereign: {
        owners: distinctOwners,
        rows: sovereignShards.length,
        moduleCid: moduleCid.toString(),
        inputCids: contributions.map((one) => one.cid.toString()),
        candidates: executors.map((one) => one.nodeId),
        // The descriptors' own owner ids, which is the half a requestor cannot forge: a
        // discovery-derived `NodeDescriptor.ownerId` **is** `certificate.userKey`. Printing
        // them beside the shards' owner ids is what lets a reader see that the two agree
        // rather than take it on trust.
        descriptorOwners: descriptors.map((one) => one.ownerId),
        excluded,
      },
    })}\n`,
  )

  const dispatched = await submitJobWithEgress(
    {
      moduleCid,
      // DET-03/DATA-08 — the signed mapping, not a bare CID, so every executor this reaches
      // checks the module against its own pinned anchors before the bytes are fetched.
      moduleRecord: PRIMES_RECORD,
      shards: sovereignShards,
      executors,
      // The **discovered** descriptors, never `publicNodes`: that helper hardcodes
      // `ownerId: 'public'`, `eligibleNodes` matches owner ids exactly, and a sovereign shard
      // against a pool of `public` descriptors is `unplaceable` — which is precisely the
      // state the demo page's bring-your-own arm is measured in.
      nodes: descriptors,
      // 1, and it is the honest figure rather than a weakened one: each owner runs one node
      // here, and pinning data to one owner removes the second independent executor by
      // construction. That is the half redundancy cannot carry, which is why the aggregation
      // below asks for two.
      redundancy: 1,
      // A coordinator on a hand-built fabric is routinely a small operator set with no
      // composable quorum, which is the topology this leg exists to run on;
      // `'refuses-the-shard'` here would refuse every shard of every run of it.
      onQuorumShortfall: 'runs-at-available-redundancy',
    },
    node.store,
    [node.egress],
    {
      // CHURN-03 — this leg keeps no checkpoints, and the reason is its own rather than
      // borrowed. A checkpoint record is a block in the same `node.store` this process serves
      // block requests from, and it **names** result CIDs; whether that is safe for a job
      // whose results are owner-pinned is a question about `sovereignCids` and the serving
      // path, and it is unmeasured. `browser/demo/main.ts`'s sovereign run records the
      // identical open question at its own site. Taking that decision silently, inside a leg
      // about sovereignty, is the one thing that must not happen here.
      checkpoints: 'checkpoints-nothing',
      // DATA-10's at-rest half. `FabricNode` resolves this to a real `FsSovereignCids` when
      // it has a blockstore directory, which it always does on this binary; the sentinel arm
      // cannot be passed to `submitJob`, so the narrowing says so rather than being cast away.
      ...(node.sovereignCids === 'forgets-sovereignty-between-jobs'
        ? {}
        : { sovereignCids: node.sovereignCids }),
    },
  )

  const shards: readonly ShardResult[] = dispatched.ok ? dispatched.job.shards : []
  const agreed = shards.filter((one) => one.verification.status === 'agreed').length

  /**
   * **VER-09's reading, on the sovereign path and from a runnable entry point.**
   *
   * The row is about *an owner with fewer than two live nodes*: the task executes once and
   * the receipt records it as **owner-attested rather than verified**. Each shard here is
   * pinned to an owner running one node, so `classifyAttestation` — one expression for every
   * case — reaches that label, and this line renders it through the same `description` the
   * demo page's receipt panel renders.
   *
   * Printed **per shard** and **before** the aggregation, so a leg that is about to exit
   * non-zero has still said what the fabric attested. A reader handed a failure with no
   * receipt has to re-run to learn whether the shard was never placed or placed and
   * unaccounted for.
   */
  for (const shard of shards) {
    process.stdout.write(
      `${JSON.stringify({
        sovereignAttestation: {
          partitionIndex: shard.partitionIndex,
          ownerId: sovereignShards[shard.partitionIndex]?.ownerId ?? null,
          status: shard.verification.status,
          ranOn:
            shard.verification.status === 'agreed'
              ? shard.verification.agreeing.map((replica) => replica.nodeId)
              : [],
          attempted: shard.attempted,
          /**
           * MR-02 — **this owner's own contribution**, which is what "each owner computes a
           * local partial over its own data" reduces to as a number.
           *
           * `readPrimeCount` **throws** on a shard the guest refused rather than returning
           * zero, and that distinction is the reason it exists: a refusal reported as a count
           * of zero is indistinguishable from a range that genuinely held no primes. Caught
           * here so the line still prints for a shard that failed — as `null`, which a reader
           * cannot mistake for a count — rather than taking the whole leg down before the
           * receipt above it has been written.
           */
          count: ((): number | null => {
            if (shard.verification.status !== 'agreed') return null
            try {
              return readPrimeCount(shard.verification.output)
            } catch {
              return null
            }
          })(),
          reading: strengthReading(shard.attestation),
        },
      })}\n`,
    )
  }

  /**
   * MR-02's aggregation half.
   *
   * Everything above is the *map*: each partial was computed by the node holding its owner's
   * row, and `PROJECT.md` says that half is owner-attested rather than verified. What carries
   * the verification claim for owner-pinned data is the aggregation **over** those partials,
   * and it is redundant at {@link MIN_SOVEREIGN_COMBINE_REPLICAS} because a combine reads only
   * content-addressed partials and is runnable anywhere.
   *
   * Attempted only where the fabric can carry it, and it says so when it cannot: a run whose
   * candidate set came back with one executor has no second node to combine on, and printing
   * the refusal rather than skipping silently is the same rule the zero-refusal below follows.
   */
  const combineExecutors = executors.map((executor) => executor.nodeId)
  let aggregationRefusal: string | null = null
  if (!dispatched.ok) {
    aggregationRefusal = `the dispatch above did not return a job: ${JSON.stringify(dispatched.error)}`
    process.stdout.write(
      `${JSON.stringify({ sovereignAggregation: { attempted: false, reason: aggregationRefusal } })}\n`,
    )
  } else if (combineExecutors.length < MIN_SOVEREIGN_COMBINE_REPLICAS) {
    aggregationRefusal =
      `this fabric qualified ${String(combineExecutors.length)} combine executor(s) and a` +
      ` sovereign aggregation is verified at ${String(MIN_SOVEREIGN_COMBINE_REPLICAS)}`
    process.stdout.write(
      `${JSON.stringify({ sovereignAggregation: { attempted: false, reason: aggregationRefusal } })}\n`,
    )
  } else {
    const reduced = await reduceSovereignJob(
      dispatched.job,
      {
        moduleCid,
        moduleRecord: PRIMES_RECORD,
        shards: sovereignShards,
        executors,
        nodes: descriptors,
        redundancy: 1,
        onQuorumShortfall: 'runs-at-available-redundancy',
      },
      {
        rpc: node.rpc,
        executors: combineExecutors,
        // This process's own store: it is what peers fetch the leaves from and where each
        // combine's result comes back to.
        blockstore: node.store,
        // `projectPrimeCount` **throws** on a shard the guest refused rather than returning
        // zero, and that is load-bearing here: a refusal summed into the aggregate is
        // indistinguishable from a range that genuinely held no primes, and the total would
        // be quietly short by exactly the primes that owner was meant to count.
        project: projectPrimeCount,
        // Stated rather than defaulted. No agent this leg dispatches to is configured to sign
        // a combine, so the honest statement is that this requestor checks no combine
        // signature; the aggregation's verification here is redundancy and agreement, which
        // is what `minReplicas` and `disagreements` read.
        trustedIssuers: 'checks-no-combine-signatures',
        // EGR-01's evidence, carried from the dispatch rather than rebuilt: the arm refuses
        // unless the weakest guard registered at least as many sovereign rows as the job
        // pinned. A manifest reporting zero registrations for a job with sovereign shards is
        // a guard that was never given them.
        egress: dispatched.manifests,
        redundancy: MIN_SOVEREIGN_COMBINE_REPLICAS,
      },
    )

    if (!reduced.ok) aggregationRefusal = reduced.reason
    /**
     * The aggregate, and **the coverage cannot be dropped on the way to the number.**
     * `CoveredAggregate` has no `.value` shortcut for exactly that reason: printing the
     * aggregate without its denominator is the failure that type exists to prevent, so the
     * line carries both or it carries the refusal.
     *
     * `total` is fetched from the store rather than assumed. `ReduceOutcome` carries
     * `rootCid`, and the merged block is read back through the same blockstore the combines
     * wrote to — an aggregate nobody re-read is a claim about a CID rather than about a value.
     */
    let total: number | null = null
    if (reduced.ok && reduced.aggregate.value.outcome.rootCid !== null) {
      const rootBytes = await node.store.get(CID.parse(reduced.aggregate.value.outcome.rootCid))
      if (rootBytes !== undefined) {
        const merged = decodeCanonical(rootBytes) as {
          counts?: Record<string, unknown>
        }
        const counted = merged.counts?.[PRIME_COUNT_KEY]
        total = typeof counted === 'number' ? counted : null
      }
    }

    process.stdout.write(
      `${JSON.stringify({
        sovereignAggregation: reduced.ok
          ? {
              attempted: true,
              ok: true,
              combines: reduced.aggregate.value.outcome.combines,
              minReplicas: reduced.aggregate.value.outcome.minReplicas,
              disagreements: reduced.aggregate.value.outcome.disagreements.length,
              coverage: {
                covered: reduced.aggregate.coverage.covered,
                total: reduced.aggregate.coverage.total,
                complete: reduced.aggregate.coverage.complete,
              },
              contributors: reduced.aggregate.value.contributions.map((one) => one.ownerId),
              egress: {
                registeredSovereign: reduced.aggregate.value.egress.registeredSovereign,
                pinnedShards: reduced.aggregate.value.egress.pinnedShards,
              },
              rootCid: reduced.aggregate.value.outcome.rootCid,
              total,
            }
          : { attempted: true, ok: false, reason: reduced.reason },
      })}\n`,
    )
  }

  /**
   * **A non-zero exit and never a reported zero.**
   *
   * A leg printing `0 of 2 agreed` is indistinguishable from a leg that was never wired, and
   * both look like a line that ran — which is the exact shape the flag ruling exists to
   * remove. So the process leaves with the fabric's own words: each shard's status, and each
   * node's refusal as that node worded it, which is where a chain the worker rejected arrives
   * (`unauthorized: …`).
   *
   * `--coordinate` above does not do this, deliberately: that leg reports a `JobResult` an
   * operator reads, and a public job at redundancy 1 has ordinary partial outcomes. A
   * sovereign leg has no ordinary partial outcome — either the owner's node ran the owner's
   * row under a chain rooted at the owner's key, or the claim this leg exists to make was not
   * made.
   */
  if (agreed !== sovereignShards.length || aggregationRefusal !== null) {
    const said = shards
      .map((shard) => {
        const failures =
          shard.verification.status === 'agreed'
            ? ''
            : shard.verification.failures
                .map((failure) => `; ${failure.nodeId}: ${failure.reason}`)
                .join('')
        return `shard ${String(shard.partitionIndex)}: ${shard.verification.status}${failures}`
      })
      .join(' | ')
    process.stderr.write(
      `agent.ts: --sovereign-owner: ${String(agreed)} of ${String(sovereignShards.length)}` +
        ` owner-pinned shards agreed across ${String(distinctOwners)} owner(s)` +
        `${aggregationRefusal === null ? '' : `, aggregation refused — ${aggregationRefusal}`}` +
        `${said === '' ? `; submit refused: ${dispatched.ok ? 'no shard returned' : dispatched.error.kind}` : `; ${said}`}\n`,
    )
    await node.stop().catch(() => {})
    process.exit(1)
  }
}
