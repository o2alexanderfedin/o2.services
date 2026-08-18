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
  jobIdOf,
  publicNodes,
  recoverCheckpoint,
  remainingWork,
  submitJob,
} from '@o2/core'
import type { Executor, SubmitOptions } from '@o2/core'
import { DEFAULT_BUDGET, KERNEL_RECORD, KERNEL_TRUST_ANCHOR, buildInput, kernelBytes } from '@o2/demo'
import { SEED_BYTES, identityFromSeed, parseKeyHex } from '@o2/libp2p'
import { RemoteExecutor, rpcAdmission } from '@o2/net'
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
  },
})

const USAGE =
  'usage: agent.ts --dir <blockstore-dir> [--port <n>] [--owner-id <id — the enrolled user key when --user-key is given> [--owner-key <hex>] [--can-execute-sovereign]] [--trust-anchor <hex> ...] [--issues-certificates --max-issued-per-window <n>] [--provider-addr <multiaddr> --user-key <path> --operator-id <id>] [--trusted-issuer <hex> ...] [--admit-issuer <hex> ...] [--peer-addr <multiaddr> ...] [--max-concurrent-tasks <n>] [--inbound-threshold <n>] [--duty-cycle <n>] [--relay-addr <multiaddr> ...] [--coordinate <shards> [--coordinate-n <n>] [--job-store <dir>] [--resume-from <cid> ...]]\n'

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
   * The one sink implementation in this repository, over the job's own store.
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
   * `'checkpoints-nothing'`, and six of the repository's production submitters say it for
   * reasons written beside each of them; this one is the leg that says the other thing, and it
   * is the whole of ROADMAP criterion 7's first clause.
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

  const result = await submitJob(
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
    },
    jobStore,
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
