/**
 * A fabric node. There is one node class on this side, and this is it.
 *
 * Every part is behind a port, and **for a `FabricNode`** this factory is the only place
 * that knows which concrete implementation is in use:
 *
 *   `Transport`  → libp2p over TCP and WebSockets, plus a circuit when it needs one
 *   `Blockstore` → the filesystem when given a directory, memory when not
 *   `Executor`   → the kernel's `WasmExecutor`, on a thread this process can kill
 *
 * **The scope is the class, not the package, and the sentence has to say so.** It read
 * "the only place" without it, which `bin/bench.ts` falsifies: that driver builds
 * `MemoryBlockstore` and `WasmExecutor` itself and calls `serveAgent` directly, without
 * going through this factory at all. That is deliberate — the benchmark is measuring the
 * kernel over a chosen transport, not a node's startup — but it means "nothing else in
 * `@o2/node` names a concrete implementation" is not a claim this file can make. What it
 * can claim, and what the port boundary is worth, is that no code holding a `FabricNode`
 * learns what is behind its ports from anywhere but here.
 *
 * A node is symmetric. It executes tasks, holds blocks, serves records, and relays
 * for peers that cannot be dialled — all of it, on every node. There is no
 * client/worker distinction in the code and no relay/compute one either, only in
 * what a given process happens to do.
 *
 * ## Why there is no second class
 *
 * There was one, for two phases, and the way it failed is the reason this comment is
 * long. `RelayNode` bound a socket and carried other peers' SDP exchanges. It
 * constructed no blockstore, no executor, no `RpcEndpoint`, and never called
 * `serveAgent` — so it could not run a task, though nothing about relaying prevents
 * it. Running the demo showed "2 compute peers of 3 connections": the third
 * connection was the relay, present, connected, perfectly able to compute, and
 * structurally excluded from doing so. The mechanism had already survived three
 * rounds of renaming — `backbone`/`edge` became other words while the two disjoint
 * capability sets stayed exactly where they were. Deleting the class is what removed
 * it; renaming it never would have.
 *
 * The standing rule this enforces: **all nodes have equal functionality, and the
 * only difference is discovery.** A browser binds no listening socket, so it cannot
 * be a seed a newcomer dials cold and must be found through a peer that can. Once
 * connected, peers are indistinguishable. If a decision keys on what kind of node
 * something is, it is wrong.
 *
 * ## Why relaying is derived and not configured
 *
 * The relay service is enabled from what this node *can do*, never from a flag
 * naming what it *is*. A node that has bound a real listening address can be dialled
 * cold, so it can carry a stranger's handshake. A node reachable only through
 * somebody else's circuit cannot carry anyone's, and advertising the service would
 * offer capacity that does not exist.
 *
 * An option would be a lie waiting to happen: any boolean can be set on a node with
 * no socket, and then "does this node relay?" has two answers that can disagree.
 * Derivation leaves one answer, read off the listen list, and it is the same answer
 * whether the caller thought about it or not. That is the difference between the rule
 * being true and the rule being asserted.
 *
 * ## What the relay tuning is for
 *
 * A browser peer is not dialable by anything. The only way two tabs reach each other
 * is for both to hold a reservation on a publicly reachable Circuit Relay v2 peer,
 * which then carries the WebRTC SDP exchange; once ICE completes the relay drops out
 * of the data path entirely.
 *
 * That last point is what the tuning below is *for*. libp2p's defaults exist to stop
 * a relay being abused as a free proxy: 2 minutes and 128 KiB per relayed
 * connection. Those are correct for signalling and fatal for anything else — which
 * is why the architecture treats a circuit as a signalling channel and fetches
 * artifacts by another route. Raising them here is about accommodating slow ICE on
 * bad networks, not about moving bulk data.
 *
 * Module set assembled from libp2p's own `packages/integration-tests`: TCP + noise +
 * yamux is the most-exercised path in the ecosystem. `identify` is not optional in
 * practice — relay discovery, AutoNAT, and DCUtR all depend on it. WebSockets is
 * present unconditionally because a browser cannot dial plain TCP, and a node
 * without that transport is unreachable from the tier this project exists for,
 * however good its address looks in a log.
 */

import { noise } from '@chainsafe/libp2p-noise'
import { circuitRelayServer, circuitRelayTransport } from '@libp2p/circuit-relay-v2'
import { yamux } from '@chainsafe/libp2p-yamux'
import { identify, identifyPush } from '@libp2p/identify'
import { ping } from '@libp2p/ping'
import { tcp } from '@libp2p/tcp'
import { webSockets } from '@libp2p/websockets'
import { multiaddr } from '@multiformats/multiaddr'
import {
  DEFAULT_MAX_CONCURRENT_TASKS,
  DutyCycleGovernor,
  EnrollmentAuthority,
  LocalCapacity,
  MemoryBlockstore,
  SelfRecordIndex,
  SignedNameResolver,
  WorkerExecutor,
  attestResults,
  guardModuleProvenance,
  guardSovereignty,
  publishCapabilities,
  requestEnrollment,
} from '@o2/core'
import type {
  Blockstore,
  Executor,
  NodeCertificate,
  NodeSovereignty,
  PublicKeyHex,
  ResultAttestor,
  SelfRecordIndexOptions,
} from '@o2/core'
import {
  CountingExecutor,
  EgressGuard,
  FetchingBlockstore,
  GovernedExecutor,
  RpcBlockSource,
  RpcEndpoint,
  UNREACHABLE_PROVIDER,
  authorizeCapability,
  enrolOverRpc,
  serveAgent,
  withholdingFrom,
} from '@o2/net'
import type { EnrolOutcome } from '@o2/net'
import { createLibp2p } from 'libp2p'
import type { Libp2p } from '@libp2p/interface'
import { FsBlockstore } from './fs-blockstore.ts'
import { FsSovereignCids } from './sovereign-cids.ts'
import type { SovereignCids } from '@o2/net'
import {
  LIBP2P_INBOUND_CONNECTION_THRESHOLD,
  LIBP2P_MAX_INCOMING_PENDING_CONNECTIONS,
  Libp2pTransport,
  RELAY_DATA_LIMIT_BYTES,
  RELAY_DURATION_LIMIT_MS,
  RELAY_MAX_RESERVATIONS,
  RELAY_MAX_RESERVATION_TTL_MS,
  audienceKeyOf,
  generateSeed,
  identityFromSeed,
  peerIdForNodeKey,
} from '@o2/libp2p'
import type { NodeIdentity } from '@o2/libp2p'
import {
  IDENTITY_FILE,
  PROVIDER_FILE,
  loadCertificate,
  loadOrCreateSeed,
  saveCertificate,
} from './identity-store.ts'
import { PeerVerifier } from './peer-verifier.ts'
import type { PeerVerdict } from './peer-verifier.ts'
import type { ReservationWatcher } from './reservation-watch.ts'
import { workerThread } from './worker-thread.ts'

export interface FabricNodeOptions {
  /**
   * Directory backing the persistent blockstore.
   *
   * Optional, and the fallback is `MemoryBlockstore`. Persistence is a deployment
   * choice — whether this process should survive its own restart — and not a kind of
   * node: a node with a memory store holds blocks, serves them to peers, and runs
   * tasks against them exactly as one with a directory does. Making it required was
   * the last thing forcing a caller who only wanted to relay to reach for a
   * different class.
   */
  readonly blockstoreDir?: string
  /**
   * This node's clearance to execute sovereign data, and the owner key it judges
   * capability chains against — DATA-09's serving-side gate (`guardSovereignty`,
   * `@o2/core`), applied unconditionally to the `Executor` this factory hands to
   * `serveAgent` below, and AUTH-03's `authorize` hook at that same call.
   *
   * Optional, and the default is the safe one: cleared for nobody, pinned to nobody
   * (`canExecuteSovereign: false`, no `ownerKey`). A node started with no
   * `sovereignty` option therefore refuses every sovereign-labelled task **twice
   * over** — the authorizer refuses it for want of a pinned owner key, and
   * `guardSovereignty` would refuse it for want of clearance — and the first of those
   * is the one a requestor observes, because `authorize` runs before `execute`.
   *
   * `ownerId` is consequently consulted on **every** sovereign dispatch, by the
   * authorizer, before clearance is looked at. (Until Phase 15 this doc said the
   * opposite — that `ownerId` mattered only once `canExecuteSovereign` was `true`, so
   * the default's placeholder was never read. That stopped being true when a real
   * authorizer was installed at the `serveAgent` call below.)
   *
   * This is a per-node clearance, not a node class: every `FabricNode` has the
   * identical executor, transport, relay capability and authorizer regardless of this
   * setting — see the module comment's "why there is no second class".
   */
  readonly sovereignty?: NodeSovereignty
  /**
   * Whether this process holds a provider signing key and answers enrollment requests —
   * AUTH-01, AUTH-04.
   *
   * A **per-node setting, not a node kind.** Every `FabricNode` has the identical
   * executor, transport, relay capability and protocol surface regardless of it — exactly
   * as `sovereignty` above does, and exactly as `bin/agent.ts` says of `--owner-id`. A
   * provider is a *configuration of the one node type*; anyone who writes "the provider
   * node" in prose is recreating the class the module comment's "why there is no second
   * class" section records as deleted, and this option is the thing that would let them.
   * Nothing anywhere branches on it except the two lines that build the authority and hand
   * it to `serveAgent`.
   *
   * **The key is generated on-device and is never passed in.** There is no option here
   * that accepts key material, and Plan 17-05's `--issues-certificates` is a boolean for
   * the same reason: argv is world-readable in `ps`, so a key on a command line is a key
   * every account on the host has read. It is written to `.provider.key`, a **different
   * file from `.identity.key`**, so `issuerKey !== nodeKey` always holds and a
   * provider-signed certificate is never confusable with a self-signed one.
   *
   * A process given no `blockstoreDir` has nowhere to persist it and gets a fresh provider
   * key per start — the same deployment choice `blockstoreDir`'s own doc frames above, and
   * not a different kind of node.
   */
  readonly issuesCertificates?: boolean
  /**
   * The provider to enrol with, and the user this node belongs to — AUTH-01.
   *
   * Absent means this node was never told to enrol: it still generates and persists an
   * identity key, `certificate` is `null`, and it starts. Present means enrollment is
   * **fatal when it fails** — `start()` rejects with the refusal reason and leaves no
   * listening socket behind. Both rows are written down rather than inferred
   * (17-CONTEXT.md decision 9), because a node told to enrol, unable to, and running
   * anyway is a node whose identity claim is silently absent — the shape
   * `.planning/PROJECT.md` records as a hole.
   *
   * **One object rather than three optional fields**, and that is the whole point: every
   * field here is required whenever *any* of them is given, so the requirement is a fact
   * about the type rather than a runtime check somebody can forget. A default for either
   * of the last two would write a placeholder into a signed statement, and `operatorId` is
   * the unit of quorum diversity (`enrollment.ts`) — a silent default would make every
   * node one operator, or every node its own, and Phase 19 would inherit a meaningless
   * anti-affinity rule.
   *
   * **`userPrivateKey`, not a `userKey` hex string, and the difference is load-bearing.**
   * `EnrollmentAuthority.enrol` requires an `ownerProof`: the *user's* signature over the
   * same challenge bytes the node signs, refused by name as `bad-owner-proof` when it is
   * absent or wrong. That proof can only be produced by whoever holds the user's private
   * half, so a node configured with a public key alone could name a user key and would be
   * refused on every attempt. `requestEnrollment` accordingly **derives** `userKey` from
   * this value rather than accepting it as a field, so naming somebody else's user key is
   * not a thing this option can be asked to do. Consent is a value here, not a check.
   *
   * That makes this the one option on this interface that takes key material, and it is
   * deliberately **not** reachable from argv: `issuesCertificates` above is a boolean and
   * Plan 17-05's `--issues-certificates` is too, precisely because argv is world-readable
   * in `ps`. A user key must reach this field from a file or a prompt; a
   * `--user-key <hex>` flag would be a regression rather than an addition, and could not
   * work anyway — a public key cannot sign.
   *
   * **This round trip runs on this node's own `rpcTimeoutMs`.** A provider that accepts a
   * connection and then never answers delays `start()` by that budget —
   * `DEFAULT_RPC_TIMEOUT_MS` (`rpc.ts`, whose value this phase writes down once, in
   * `enrol-client.ts`) unless a caller set one. `rpcTimeoutMs` is the lever; a second
   * `RpcEndpoint` with a shorter budget is not, because its constructor subscribes to
   * `transport.onMessage` and allocates request ids from its own counter, so two endpoints
   * over one transport would each see the other's frames and collide on ids.
   *
   * **Labelled assumption:** `userPrivateKey` is deliberately not unified with
   * `sovereignty.ownerId`. They are different types today — `OwnerId` is an opaque string,
   * a user key is an ed25519 key — and unifying them is AUTH-05 / Phase 19's decision.
   *
   * `discoverability` and `relayIds` are **absent from this object on purpose.** They are
   * derived from what this node can actually do, for the reason the module comment's "why
   * relaying is derived and not configured" section gives in full: an option would be a
   * lie waiting to happen, and a signed certificate is the worst possible place for a
   * field with two answers.
   */
  readonly enrollment?: {
    readonly userPrivateKey: Uint8Array
    readonly operatorId: string
    readonly providerAddr: string
  }
  /**
   * The build authorities this node will run a module for — DET-03, DATA-08.
   *
   * An anchor is the public half of a signing key, pinned in advance. A CID proves
   * the bytes are the bytes that were hashed and says nothing about who meant them to
   * run; a `NameRecord` signed by one of these keys says that, and
   * `guardModuleProvenance` (`@o2/core`) refuses any task whose module did not arrive
   * with one — before the module's bytes are fetched, let alone instantiated.
   *
   * **Required, with no `?` and no default**, and that is the whole of the design.
   * `.planning/PROJECT.md`'s Key Decision — *an optional hook with a silent default is
   * a hole* — is what `AgentOptions.egress` names in its own doc and what
   * `AgentOptions`'s six required fields each spell out with a literal-string escape.
   * Whichever default were chosen here, a node would get it without anyone deciding,
   * and the existing `FabricNode.start` / `SeedServer.start` call sites would not have
   * to say which one they meant.
   *
   * Three values and what each admits:
   *
   * - **`[pub, …]`** — this node runs a module exactly when a record signed by one of
   *   these keys names its CID.
   * - **`[]`** — this node trusts nobody, and therefore refuses every module. That is
   *   the safe reading of an empty set and it is deliberately **not** special-cased
   *   into meaning something friendlier: a caller who wanted the escape hatch has a
   *   word for it, and an empty array is not that word.
   * - **`'runs-unsigned-artifacts'`** — no guard is composed at all and this node goes
   *   back to resolving bare CIDs, as every node did before this phase. It is written
   *   down at the call site rather than reached by omission precisely because it is
   *   the one value that turns DET-03 off, and a value that turns a guarantee off must
   *   cost somebody a decision.
   *
   * Per-node **configuration**, not a node kind. Every `FabricNode` has the identical
   * executor, transport, relay behaviour and protocol surface whatever is passed here
   * — exactly as `sovereignty` does, and nothing anywhere branches on what kind of
   * node something is. The only branch is over a value an operator supplied, in the
   * same sense `--owner-id` states a clearance without defining a class. See the
   * module comment's "why there is no second class".
   *
   * **Any divergence between two running nodes lives in an argv default in a binary,
   * never here.** As of this phase there is none: `bin/agent.ts` and `bin/seed.ts`
   * write the same default expression, and
   * `packages/node/src/trust-anchors.node.test.ts` compares the two textually and
   * fails if they stop matching.
   */
  readonly trustAnchors: readonly PublicKeyHex[] | 'runs-unsigned-artifacts'
  /**
   * Provider keys whose certificates this node accepts from a peer — AUTH-02.
   *
   * A list of **issuers**, never of peers: pinning is about who signed, never about who is
   * talking. A peer whose certificate chains to one of these is verified; every other
   * connected peer is excluded from the block source's peer list, by name and with a
   * verdict a caller can read through {@link FabricNode.verdictFor}.
   *
   * **Omitting it means this node verifies nobody and treats every connected peer as
   * usable**, which is what every node in this repository did before this phase and what
   * every existing test relies on. That is 17-CONTEXT.md decision 9's third row, and it is
   * a **stated** absence rather than a safe default: the alternative — an empty verified
   * set for a node that pinned nothing — would be indistinguishable from a network outage,
   * which is the failure shape NET-05 exists to eliminate one tier down. So a node that
   * pins nobody does no verification work at all: it never subscribes, never asks a peer
   * for records, and `verdictFor` is undefined by construction rather than by winning a
   * race. See `PeerVerifier`'s own comment for why the early return is where that lives.
   *
   * Per-node configuration, not a node kind. Every `FabricNode` has the identical executor,
   * transport, relay behaviour and protocol surface whatever is passed here — exactly as
   * `sovereignty` and `trustAnchors` do. It says which *provider* this node believes, in
   * the same sense `--owner-id` states a clearance without defining a class.
   *
   * `trustAnchors` above is a different pinning and the two must not be conflated: an
   * anchor says whose *build* records this node will run a module for, and an issuer says
   * whose *enrollment* signature it will believe about a peer. A module and a peer are
   * different subjects, and a key pinned for one says nothing about the other.
   */
  readonly trustedIssuers?: readonly PublicKeyHex[]
  /**
   * Tasks this node will run at once before it refuses an `exec` request with its
   * own words — SCHED-06.
   *
   * Defaults to `DEFAULT_MAX_CONCURRENT_TASKS` (`@o2/core`, which is the only place
   * that carries the value). Like `sovereignty` above, this is a per-node capacity
   * and **not** a node class: every `FabricNode` has the identical executor,
   * transport and relay capability whatever this is set to, nothing anywhere
   * branches on it, and a node with two slots serves exactly the same requests as
   * one with sixty-four — it just holds fewer at a time. See the module comment's
   * "why there is no second class".
   *
   * It is an option rather than only a constant for two reasons, both about being
   * able to *see* the refusal rather than assume it. A test that wants to observe
   * one has to be able to make one certain rather than hope for it. And
   * `bin/bench.ts` declares its own value explicitly, so a published scaling curve
   * states the admission limit it was measured under instead of inheriting whatever
   * default happened to ship that week.
   *
   * Passed straight through, never clamped: `LocalCapacity`'s constructor refuses a
   * value below 1 with a `RangeError` naming it, and sanitising here would turn a
   * caller's mistake into a silently different node.
   */
  readonly maxConcurrentTasks?: number
  /**
   * The share of wall clock this node will spend running tasks — SCHED-04.
   *
   * A number in `(0, 1]`, defaulting to **1**: unthrottled, which is exactly how
   * every node behaved before this option existed. A node at 1 pays nothing for the
   * governor's presence — no sleep and no serialisation — which is why every
   * concurrency test in this package passes unedited.
   *
   * Per-node, and **not** a node class: nothing branches on it, and a node at 0.1
   * serves precisely the same requests as one at 1, more slowly and fewer at a time.
   * Same rule as `maxConcurrentTasks` above.
   *
   * It is a starting value rather than a fixed one. {@link FabricNode.setDutyCycle}
   * moves it on a process that is already running, which is what makes this a control
   * rather than a configuration — and is the half of SCHED-04 that no tier had.
   *
   * Passed straight through, never clamped: `DutyCycleGovernor`'s constructor refuses
   * anything outside `(0, 1]` with a `RangeError` naming the value, and sanitising
   * here would turn a caller's mistake into a silently different node.
   */
  readonly dutyCycle?: number
  /**
   * How long one task may hold its thread before it is killed — SCHED-06.
   *
   * Defaults to `DEFAULT_TASK_DEADLINE_MS` (`@o2/core`, the only place the value
   * lives, and the same default the browser tier takes). This node serves
   * unauthenticated, so the bound is what stands between any peer that can dial
   * `/o2/rpc/1.0.0` and a wedged process: a guest `run()` is synchronous and V8 has
   * no fuel, so no timer on the executing thread will ever fire.
   *
   * An option rather than only a constant for the same reason `maxConcurrentTasks` is
   * one: a test that wants to observe the bound has to be able to make it certain
   * rather than hope for it. Per-node, and not a node class — nothing branches on it.
   */
  readonly taskDeadlineMs?: number
  /**
   * Largest single inbound frame this node will accumulate before it aborts the
   * stream — NET-08.
   *
   * Defaults to `MAX_INBOUND_MESSAGE_BYTES` (`@o2/libp2p`, which carries the value).
   * This is the first `Libp2pTransportOptions` field this factory has ever passed:
   * before it, both node factories called `Libp2pTransport.start(libp2p)` bare, so
   * the whole option surface was unreachable from a node however well it was built.
   *
   * The send-side gate's own bounds — `maxConcurrentStreamsPerPeer` and
   * `maxQueuedSendsPerPeer` — are deliberately **not** exposed here. They are
   * protocol-safety values sited against libp2p's operative `maxEarlyStreams`
   * default of 10, not deployment choices, and a knob would invite somebody to raise
   * the concurrency past 10 and reintroduce the connection tear-down the gate exists
   * to prevent.
   */
  readonly maxMessageBytes?: number
  /**
   * Multiaddrs to listen on. Port 0 asks the OS for a free port.
   *
   * Binding at least one non-`/p2p-circuit` address here is what makes this node
   * able to relay for others — see the module comment. Include a browser-dialable
   * one (`/ws` or `/wss`) if browsers are meant to reach it; nothing else in this
   * list is dialable from a tab.
   */
  readonly listen?: readonly string[]
  /** Overrides the RPC request timeout; mainly useful to keep tests quick. */
  readonly rpcTimeoutMs?: number
  /**
   * Relays to reserve a `/p2p-circuit` address on.
   *
   * Supplying any switches the node into the topology a browser peer is forced
   * into: reachable only through someone else. Adds the circuit-relay transport and
   * listens on `/p2p-circuit`.
   */
  readonly relayAddrs?: readonly string[]
  /** Observes relay reservation outcomes — see NET-05. */
  readonly reservationWatcher?: ReservationWatcher
  /** Concurrent reservations to accept from others. Defaults to libp2p's 15. */
  readonly maxReservations?: number
  readonly reservationTtlMs?: number
  readonly durationLimitMs?: number
  readonly dataLimitBytes?: bigint
  /**
   * Simultaneous inbound handshakes to permit.
   *
   * Defaults to `max(libp2p's 10, maxReservations)`. This is not a knob to leave
   * alone: a burst of browser tabs all joining at once is the normal case, and the
   * default of ten silently drops the excess *during* the noise handshake. Raising
   * `maxReservations` without raising this makes the extra capacity unreachable.
   */
  readonly maxIncomingPendingConnections?: number
  /**
   * Inbound connections per second to accept from one host.
   *
   * Defaults to `max(libp2p's 5, maxReservations)` because libp2p's default of five
   * is far too low for this fabric: it is a *per-host* rate limit, so every peer
   * behind one NAT — or every tab in a local test — shares the budget. See
   * `LIBP2P_INBOUND_CONNECTION_THRESHOLD`.
   */
  readonly inboundConnectionThreshold?: number
}

/**
 * What a node knows about the reservations it is holding for others, by name rather
 * than by symptom.
 *
 * Every field is read from the live reservation store. There is deliberately no
 * lifetime "granted total": `@libp2p/circuit-relay-v2@4.2.9` declares a
 * `relay:reservation` event in its type definitions but **never dispatches it** —
 * the name appears only in `.d.ts` files, and `CircuitRelayServer` emits nothing at
 * all. A counter built on it would silently read zero forever, which is the exact
 * failure mode NET-05 exists to eliminate. `relaying.node.test.ts` pins that
 * finding, so if a later release starts emitting, the test tells us.
 *
 * A node that bound no listening address relays for nobody: its limit is zero and
 * `atCapacity` is trivially true, because there is no capacity for it to be under.
 * That is the right answer to "should I try to reserve here?" and it needs no
 * separate flag to read.
 */
/**
 * A relay this node was told to use and could not reach — NET-05, the joiner's side.
 *
 * Distinct from a reservation *refusal*, which is what `ReservationWatcher` reports:
 * there the dial SUCCEEDED and the relay declined to hold a slot. Here the relay was
 * never reached at all. The two demand opposite responses — wait and retry this one,
 * versus try a different one — and collapsing them into "no circuit address appeared"
 * is precisely the ambiguity NET-05 exists to remove.
 */
export interface RelayDialFailure {
  /** The address as configured, so an operator can see which line was wrong. */
  readonly address: string
  /** libp2p's own words. Never synthesised here. */
  readonly reason: string
}

export interface RelayCapacity {
  readonly granted: number
  readonly limit: number
  readonly remaining: number
  readonly atCapacity: boolean
}

interface RelayService {
  readonly reservations: {
    readonly size: number
    keys(): IterableIterator<{ toString(): string }>
  }
}

/**
 * Obtain this node's certificate, or establish that it was never asked for — AUTH-01.
 *
 * A module-level helper rather than inline code so `#compose` stays readable, and the one
 * place in this file that throws on an enrollment failure. `FabricNode.start`'s `undo`
 * stack is what releases the socket when it does; nothing here stops libp2p itself,
 * because a release that ran twice would be a shutdown error replacing the caller's real
 * one.
 */
async function resolveCertificate(parts: {
  enrollment: FabricNodeOptions['enrollment']
  identity: NodeIdentity
  rpc: RpcEndpoint
  libp2p: Libp2p
  blockstoreDir?: string
  canRelay: boolean
  relayPeerIds: readonly string[]
}): Promise<NodeCertificate | null> {
  const { enrollment, identity, rpc, libp2p, blockstoreDir, canRelay, relayPeerIds } = parts

  // Decision 9 row 1: nobody asked. `null` means exactly this, here and nowhere else —
  // which is why the failure paths below throw rather than widening this return type.
  if (enrollment === undefined) return null

  // Decision 11 — a persisted, unexpired certificate is reused and the provider is not
  // contacted at all.
  //
  // The identity check is written through `peerIdForNodeKey` rather than as
  // `loaded.nodeKey === identity.nodeKey`, for two reasons. It is the same guarantee — the
  // derivation is injective, so the two agree on every well-formed input — plus one more:
  // a `nodeKey` that is not valid lowercase hex yields `null`, which is not
  // `identity.peerId`, so a hand-edited or older-build file fails closed instead of being
  // compared string to string. The real-world case it catches is a directory cloned from
  // another host, where the certificate is intact, unexpired, genuinely signed, and names
  // somebody else.
  //
  // **This is `peerIdForNodeKey`'s production call site.** A capability exported from a
  // barrel with no traced call path from a runnable entry point is what Phase 22's guard
  // is specified to fail on (`.planning/ROADMAP.md`, section `### Phase 22: Reachability
  // Guard`, criterion 1 — cited by section because the roadmap's line numbers move as
  // phases are inserted). If this line ever goes, that export goes with it.
  if (blockstoreDir !== undefined) {
    const loaded = await loadCertificate(blockstoreDir)
    if (
      loaded !== null &&
      peerIdForNodeKey(loaded.nodeKey) === identity.peerId &&
      loaded.expiresAt > Date.now()
    ) {
      return loaded
    }
  }

  // The dial, inside a `try/catch` that **assigns rather than returns**.
  //
  // This is not defensive padding; it is the only route into the `unreachable` arm an
  // operator will ever take. `libp2p.dial` rejects for any genuinely unreachable address,
  // and that rejection escapes one step *before* `enrolOverRpc` is entered — so without
  // this catch the line on stderr is a raw libp2p dial error and `EnrolOutcome`'s
  // three-arm design produces two arms in production. Once a dial has succeeded the peer
  // is by definition reachable, so the arm's other route is an `rpc.request` failure.
  //
  // The failure arm is deliberately assignable to `EnrolOutcome` — same `ok`, same `kind`,
  // same `reason`, and the same `UNREACHABLE_PROVIDER` prefix `@o2/net` exports for it — so
  // the throw below cannot tell the two routes apart. One mapping, one operator-facing
  // string, and the tests assert on *that* string rather than on whatever libp2p said.
  type Dialed =
    // Discriminated on `ok` so the narrowing below needs no non-null assertion.
    | { readonly ok: true; readonly peerId: string }
    | { readonly ok: false; readonly kind: 'unreachable'; readonly reason: string }

  let dialed: Dialed
  try {
    const connection = await libp2p.dial(multiaddr(enrollment.providerAddr))
    dialed = { ok: true, peerId: connection.remotePeer.toString() }
  } catch (cause) {
    dialed = {
      ok: false,
      kind: 'unreachable',
      reason: `${UNREACHABLE_PROVIDER} ${enrollment.providerAddr}: ${cause instanceof Error ? cause.message : String(cause)}`,
    }
  }

  // Built unconditionally, above the branch: `requestEnrollment` signs a local structure
  // and touches no network, so it depends on nothing from the dial. `discoverability` and
  // `relayIds` both fall out of `canRelay`, which is derived from the listen list for
  // precisely the reason the module comment's "why relaying is derived" section gives.
  //
  // Three arguments, and the middle one is the user's *private* key: `userKey` is derived
  // inside, and the same bytes sign the `ownerProof` the authority refuses enrollment
  // without.
  const request = requestEnrollment(identity.seed, enrollment.userPrivateKey, {
    operatorId: enrollment.operatorId,
    discoverability: canRelay ? 'seed' : 'via-relay',
    relayIds: canRelay ? [] : [...relayPeerIds],
  })

  // Both routes collapse into one value in one statement, so `outcome` is definitely
  // assigned and no branch can be forgotten. `dialed.ok` narrows `peerId` to `string` on
  // the first arm; the second arm is already the `unreachable` member of `EnrolOutcome`.
  const outcome: EnrolOutcome = dialed.ok
    ? await enrolOverRpc(rpc, dialed.peerId, request)
    : dialed

  if (!outcome.ok) {
    // One throw site for all three of `EnrolOutcome`'s failure kinds and for both routes
    // into `unreachable`, so the operator-facing format cannot differ between "the
    // provider refused you" and "nothing answered at that address".
    throw new Error(
      `enrollment with ${enrollment.providerAddr} failed (${outcome.kind}): ${outcome.reason}`,
    )
  }

  if (blockstoreDir !== undefined) await saveCertificate(blockstoreDir, outcome.certificate)
  return outcome.certificate
}

/**
 * This node's own records, in the shape a peer's `records` request is answered from —
 * AUTH-01, SCHED-01.
 *
 * Five decisions live here, each written down because each is one somebody will otherwise
 * re-litigate.
 *
 * **This index answers two independent questions about one node.** `recordsFor` is about a
 * signed identity and is empty for a node nobody certified. `providers` is about bytes and
 * is answered for every node, certificate or not, because **holding a block is not a
 * capability enrollment confers**. The text retired here — *"`provide()` is never called,
 * so a `providers` request still answers `[]` from every node. Phase 17 publishes; Phase 18
 * queries"* — is retired by owner ruling D1, and saying so matters rather than deleting it
 * quietly: a reader who finds the two halves conditional on each other will reunite them,
 * and a node answering `[]` for blocks it really holds would be lying about itself in order
 * to keep a sentinel true. A node is still not a directory — it answers for itself and for
 * nobody else, which is `SelfRecordIndex`'s whole shape.
 *
 * **`providers` reads the local-only tier and never `blockstore`.** A `FetchingBlockstore`
 * would answer "yes" for anything *obtainable* rather than anything *held*, and would pull
 * the block over the wire to answer a question about it. This is the same rule
 * `AgentOptions.egress.sovereignInputs` already states, for the same reason, which is why
 * the argument is `store`.
 *
 * **`features: []` is honest, not a stub.** No feature-detection dependency exists in this
 * repository — `wasm-feature-detect` is recommended in `CLAUDE.md` and is not installed,
 * and `packages/browser/src/wasm-probes.ts` builds probe modules and detects no engine
 * features. `discoverExecutors` only excludes on features a caller actually asked for
 * (`core/src/discovery.ts:279-285`), so an empty list excludes nobody. Populating it
 * belongs with Phase 18's `discoverExecutors` wiring, which is the first thing that reads
 * the field.
 *
 * **`sovereignFor` carries `certificate.userKey`, never `sovereignty.ownerId`**, and the
 * reason has to be written down or somebody will "simplify" it back.
 * `CapabilityRecord.sovereignFor` is `readonly PublicKeyHex[]` and its only consumer
 * compares it against a user key — `core/src/discovery.ts:286-290`,
 * `if (sovereignFor !== undefined && !capabilities.sovereignFor.includes(sovereignFor))`,
 * where `ExecutorQuery.sovereignFor` is `PublicKeyHex`: the same hex ed25519 key the
 * certificate carries as `userKey`. `OwnerId` is an opaque string (`sovereignty.ts`), so
 * publishing it here would bake an operator's label into a signed statement Phase 18's
 * sovereign branch could never match. That is exactly the defect 17-CONTEXT.md decision 10
 * forbids — *a signed certificate is the worst possible place for a field with two
 * answers* — and it would have landed on the one field this plan configures rather than
 * derives. The repository's own fixture dodges it by making the owner id *be* a hex key
 * (`net/src/sovereign-execution.test.ts`); deriving from `certificate.userKey` gets the
 * same result without depending on an operator having typed a hex string into
 * `--owner-id`. Only `canExecuteSovereign` is read from `sovereignty`.
 *
 * **The record's validity window is the certificate's own.** That needs no new policy
 * number, and it makes a node whose certificate has expired stop advertising capabilities
 * at exactly the moment it stops being verifiable — the answer somebody would otherwise
 * have to invent.
 */
function ownRecords(
  certificate: NodeCertificate | null,
  identity: NodeIdentity,
  canExecuteSovereign: boolean,
  store: Blockstore,
  withhold: SelfRecordIndexOptions['withhold'],
): SelfRecordIndex {
  return new SelfRecordIndex({
    nodeKey: identity.nodeKey,
    store,
    records:
      certificate === null
        ? 'holds-no-records'
        : {
            certificate,
            capabilities: publishCapabilities(identity.seed, {
              features: [],
              sovereignFor: canExecuteSovereign ? [certificate.userKey] : [],
              issuedAt: certificate.issuedAt,
              expiresAt: certificate.expiresAt,
            }),
          },
    withhold,
  })
}

function hasReservations(value: unknown): value is RelayService {
  if (value === null || typeof value !== 'object') return false
  const candidate = (value as { reservations?: unknown }).reservations
  return (
    candidate !== null &&
    typeof candidate === 'object' &&
    typeof (candidate as { size?: unknown }).size === 'number' &&
    typeof (candidate as { keys?: unknown }).keys === 'function'
  )
}

export class FabricNode {
  readonly libp2p: Libp2p
  readonly transport: Libp2pTransport
  readonly rpc: RpcEndpoint
  /**
   * Wraps `transport` so every outbound RPC frame is recorded — DATA-05/DATA-06.
   *
   * A new field, not a type change to `transport`: `EgressGuard` has no `.stop()`
   * and delegates `.peers` to the wrapped transport, but `transport` itself stays
   * the concrete `Libp2pTransport` every existing caller of `.stop()`/`.peers`
   * relies on. `rpc` is constructed over this field, not over `transport`.
   */
  readonly egress: EgressGuard
  /** Local blocks plus network fallback. This is what the executor reads from. */
  readonly blockstore: FetchingBlockstore
  /**
   * The local tier, without network fallback.
   *
   * Typed as the port, not as the adapter: nothing outside this file needs to know
   * whether the blocks are on disk or in a heap, and a caller that could ask would
   * be one kind-check away from behaving differently on the answer.
   */
  readonly store: Blockstore
  readonly executor: Executor
  /**
   * This node's execution admission control — SCHED-06.
   *
   * Named `admission` and not `capacity` because `capacity` on this class already
   * means something else and has since NET-05: the relay *reservation* capacity
   * below. Two unrelated meanings of one word on one object is how a reader ends up
   * asserting the wrong number.
   *
   * `admission.slots` is the declared limit and `admission.peakInFlight` says
   * whether the limit was ever **reached**. It does **not** say whether the limit
   * **held**: `LocalCapacity.offer()` returns its refusal before the reservation is
   * taken, so `peakInFlight <= slots` is an arithmetic property of that class and
   * cannot fail, whatever `serveAgent` does. The reading that can falsify the bound
   * is {@link executorPeakInFlight}, which counts calls that actually happened and
   * can therefore read any number at all.
   */
  readonly admission: LocalCapacity
  /**
   * This node's provider-signed certificate, or `null` when it holds none — AUTH-01.
   *
   * `null` means this node was **never told to enrol**, which is a stated configuration
   * and not a failure. It does not mean enrollment was attempted and did not work: a node
   * told to enrol and unable to never reaches this field at all, because it does not
   * start. Those two are different events and only one of them produces an object.
   *
   * Public because a certificate is a public signed statement — every peer is meant to be
   * able to read and verify it, and Plan 17-04 serves it through the `index` hook. Holding
   * one is not a capability: a node with a certificate executes tasks, holds blocks and
   * relays on exactly the same terms as one without. Until 17-04 lands, nobody can fetch
   * it, which is a deliberate one-plan gap rather than a resting state.
   */
  readonly certificate: NodeCertificate | null
  /**
   * The instrument {@link executorPeakInFlight} reads.
   *
   * **No longer the same object as {@link executor}.** SCHED-04 wrapped the counter in
   * a `GovernedExecutor`, so the counter is now one layer in rather than the outermost
   * one, and a caller reaching `node.executor` passes through the pacing before it is
   * counted. That is the browser tier's order and it is deliberate: a counter outside
   * the governor would count tasks parked on its serialisation chain as in flight,
   * which is not what "how many tasks is this node running at once" means.
   */
  readonly #counter: CountingExecutor
  /**
   * This node's duty-cycle cap — SCHED-04.
   *
   * Held so {@link FabricNode.setDutyCycle} can move it on a running process, and so
   * {@link FabricNode.dutyCycle} can read it. The same object is inside
   * {@link executor} and inside `admission`, which is what makes one call change both
   * the pacing and the advertised slot count.
   */
  readonly #governor: DutyCycleGovernor
  /** The thread tasks run on. Held only so {@link FabricNode.stop} can end it. */
  readonly #compute: WorkerExecutor
  readonly #limit: number
  readonly #pending: number
  readonly #inboundPerSecond: number
  /**
   * This node's identity — AUTH-01.
   *
   * Private, and deliberately: `seed` is the one secret this class holds, and a public
   * field would put it one property access away from anything holding a node. The two
   * public readings are {@link nodeKey} and {@link FabricNode.peerId}.
   */
  readonly #identity: NodeIdentity
  /**
   * The provider signing key, when this process holds one.
   *
   * Also private. A public `authority` would invite a caller to issue certificates around
   * the wire, which would make the issuance path something other than the one
   * `serveAgent`'s `enrol` branch rate-limits. {@link issuerKey} is the public reading.
   */
  readonly #authority: EnrollmentAuthority | null
  readonly #relayFailures: readonly RelayDialFailure[]
  readonly #sovereignCids: SovereignCids | 'forgets-sovereignty-between-jobs'
  /**
   * AUTH-02 — this node's per-peer verdicts.
   *
   * Private, because the two readings a caller needs are {@link verifiedPeers} and
   * {@link verdictFor}, and a public field would expose `verify()` — an awaitable this
   * class deliberately does not offer, since adding one purely so a test could await a
   * verdict would be new public surface with no production caller.
   */
  readonly #verifier: PeerVerifier

  private constructor(parts: {
    libp2p: Libp2p
    transport: Libp2pTransport
    rpc: RpcEndpoint
    egress: EgressGuard
    blockstore: FetchingBlockstore
    store: Blockstore
    executor: GovernedExecutor
    counter: CountingExecutor
    governor: DutyCycleGovernor
    compute: WorkerExecutor
    admission: LocalCapacity
    limit: number
    pending: number
    inboundPerSecond: number
    identity: NodeIdentity
    authority: EnrollmentAuthority | null
    certificate: NodeCertificate | null
    verifier: PeerVerifier
    relayFailures: readonly RelayDialFailure[]
    sovereignCids: SovereignCids | 'forgets-sovereignty-between-jobs'
  }) {
    this.libp2p = parts.libp2p
    this.transport = parts.transport
    this.rpc = parts.rpc
    this.egress = parts.egress
    this.blockstore = parts.blockstore
    this.store = parts.store
    this.executor = parts.executor
    this.#counter = parts.counter
    this.#governor = parts.governor
    this.#compute = parts.compute
    this.admission = parts.admission
    this.#limit = parts.limit
    this.#pending = parts.pending
    this.#inboundPerSecond = parts.inboundPerSecond
    this.#identity = parts.identity
    this.#authority = parts.authority
    this.certificate = parts.certificate
    this.#verifier = parts.verifier
    this.#relayFailures = parts.relayFailures
    this.#sovereignCids = parts.sovereignCids
  }

  /**
   * Relays this node was told to use and could not reach — NET-05.
   *
   * `[]` for a node given no `relayAddrs`, and `[]` for one that reached every relay it
   * was given. A non-empty list is the difference between *"no circuit address appeared
   * because the relay was full"* and *"because it was never there"*, which are the two
   * readings NET-05 exists to keep apart. The refusal side is
   * {@link FabricNodeOptions.reservationWatcher}; this is the unreachable side.
   *
   * Read after `start` resolves. A node with entries here started anyway, deliberately —
   * see the loop that fills it.
   */
  get relayFailures(): readonly RelayDialFailure[] {
    return this.#relayFailures
  }

  /**
   * This node's durable sovereign-CID set — DATA-10.
   *
   * Exposed because a submitter has to hand it to its own job: `submitJob`'s
   * blockstore-put is where this node comes to hold the row, and the put writes into
   * *this* node's store, so it is *this* node's set that has to record it. A submitter
   * that omits it holds the row unguarded once its job's holds are given back — which is
   * the whole of the at-rest gap, and is why the option exists rather than being inferred.
   *
   * `'forgets-sovereignty-between-jobs'` on a node with no `blockstoreDir`: there is
   * nowhere durable to record anything, and saying so is better than a set that quietly
   * evaporates on exit.
   */
  get sovereignCids(): SovereignCids | 'forgets-sovereignty-between-jobs' {
    return this.#sovereignCids
  }

  /**
   * The hex ed25519 public key a `NodeCertificate` names as this node's subject — AUTH-01.
   *
   * The same identity {@link FabricNode.peerId} reports, in the other namespace:
   * `peerIdForNodeKey(node.nodeKey) === node.peerId` holds for every node this factory
   * builds, by construction rather than by a lookup. Neither is independently settable, so
   * the two cannot disagree.
   */
  get nodeKey(): PublicKeyHex {
    return this.#identity.nodeKey
  }

  /**
   * The provider key this process signs certificates with, or `null` when it holds none.
   *
   * `null` means this node was not told to issue — a stated configuration, not a failure
   * and not a lesser kind of node. It is never equal to {@link nodeKey}: the two keys come
   * from different files and therefore different bytes, which is what keeps a
   * provider-signed certificate distinguishable from a self-signed one.
   */
  get issuerKey(): PublicKeyHex | null {
    return this.#authority?.issuerKey ?? null
  }

  /**
   * The most `executor.execute()` calls ever running at once on this node.
   *
   * SCHED-06's criterion 1 is read off this. It counts calls that *happened*, so it
   * can read any number — which is what makes an assertion about it falsifiable,
   * and is the whole difference between it and `admission.peakInFlight`. Deleting
   * the `capacity.offer(...)` acquisition in `@o2/net`'s `serveAgent` exec branch
   * turns it red by making it read the dispatched request count.
   *
   * The one thing that will otherwise be misread: it sees **every** call on this
   * node's executor, including a caller reaching `node.executor` directly. A local
   * call takes no slot, because admission lives on `serveAgent`'s exec branch and a
   * local call never reaches it. So `executorPeakInFlight <= admission.slots` is a
   * claim about a run in which every dispatch arrived over RPC, and a test asserting
   * it has to say so.
   *
   * **Since SCHED-04 the counter sits inside the governor**, so at a duty cycle below
   * 1 this reads tasks *running*, never tasks *queued* — a dispatch waiting its turn
   * on the serialisation chain has not reached the counter yet. At a duty cycle of 1
   * nothing waits and the reading is what it was before the governor existed, which is
   * why the concurrency specs in this package needed no edit.
   */
  get executorPeakInFlight(): number {
    return this.#counter.peakInFlight
  }

  /**
   * The share of wall clock this node currently spends running tasks — SCHED-04.
   *
   * Reads through the governor rather than echoing a stored option, so it reports what
   * is in force after any {@link setDutyCycle} call.
   */
  get dutyCycle(): number {
    return this.#governor.dutyCycle
  }

  /**
   * Move this node's cap while it is running — the half of SCHED-04 no tier had.
   *
   * Honoured by the **next task started** and by the **next offer answered**. A task
   * already executing is not disturbed, which is `GovernedExecutor`'s between-tasks
   * rule: a guest `run()` is synchronous and V8 has no fuel, so there is no point at
   * which a running task could be slowed even in principle.
   *
   * Both effects come from the one object. The governor is inside {@link executor}, so
   * the pacing changes; it is inside `admission`, so `admission.slots` changes with no
   * reconstruction and the very next offer answer carries the lower figure.
   *
   * Throws a `RangeError` naming the value for anything outside `(0, 1]`. The guard is
   * the governor's own, reached rather than duplicated here — a second copy is a second
   * thing that can drift.
   */
  setDutyCycle(value: number): void {
    this.#governor.setDutyCycle(value)
  }

  /** Calls currently inside `executor.execute()` on this node. */
  get executorInFlight(): number {
    return this.#counter.inFlight
  }

  /**
   * Compose a node, or leave the process as it was found.
   *
   * The composition itself is `#compose` below, which pushes a release onto `undo`
   * on the line after each acquisition. Splitting the two is what keeps that
   * adjacency: a `try` wrapped around the whole body would re-indent two hundred
   * lines and put the release set a screen away from the thing it releases, which is
   * how the leak this method exists to close got written in the first place.
   *
   * Releases run newest-first, and each one's own failure is swallowed on its own —
   * a `libp2p.stop()` that rejects must not strand the releases below it, and must
   * not replace the caller's error with a shutdown error. What the caller is told is
   * always why the *start* failed.
   *
   * This is a discipline made cheap, not an invariant made structural. Nothing stops
   * a future edit from acquiring without pushing. What has gone is the distance:
   * omitting it is now a visible one-line gap rather than a missing branch a hundred
   * lines below.
   */
  static async start(options: FabricNodeOptions): Promise<FabricNode> {
    const undo: (() => Promise<void> | void)[] = []
    try {
      return await FabricNode.#compose(options, undo)
    } catch (cause) {
      for (const release of undo.reverse()) {
        try {
          await release()
        } catch {
          // Nothing to do about it, and reporting it would report the wrong failure.
        }
      }
      throw cause
    }
  }

  static async #compose(
    options: FabricNodeOptions,
    undo: (() => Promise<void> | void)[],
  ): Promise<FabricNode> {
    const store: Blockstore =
      options.blockstoreDir === undefined
        ? new MemoryBlockstore()
        : await FsBlockstore.open(options.blockstoreDir)

    // AUTH-01 — resolved **here**, and the position is forced rather than chosen:
    // `createLibp2p` below needs the key, so identity resolution has to precede it.
    //
    // The seed lives beside the blocks because that is the one directory a deployment has
    // already told us it wants to survive a restart. A process given no directory has
    // nowhere to persist and gets a fresh identity per start — a deployment choice, in the
    // framing `blockstoreDir`'s own doc uses, and not a kind of node.
    const seed =
      options.blockstoreDir === undefined
        ? generateSeed()
        : await loadOrCreateSeed(options.blockstoreDir, IDENTITY_FILE)
    const identity = await identityFromSeed(seed)

    const relayAddrs = options.relayAddrs ?? []
    const viaRelay = relayAddrs.length > 0

    const listen = [
      ...(options.listen ?? (viaRelay ? [] : ['/ip4/127.0.0.1/tcp/0'])),
      // Asks libp2p to reserve on any relay it connects to.
      ...(viaRelay ? ['/p2p-circuit'] : []),
    ]

    // The whole of the relay/compute distinction, reduced to one predicate over the
    // addresses this node actually asked to bind. `/p2p-circuit` does not count: it
    // is not an address, it is a request for one, granted by somebody else and
    // revocable by them. A node holding only that cannot carry a stranger's
    // handshake and must not claim it can.
    const canRelay = listen.some((address) => !address.includes('/p2p-circuit'))

    // Zero when this node cannot relay, so every number downstream — the inbound
    // limits, `capacity` — falls out of the same fact rather than being decided
    // twice.
    const limit = canRelay ? (options.maxReservations ?? RELAY_MAX_RESERVATIONS) : 0
    // Coupled deliberately — see the options' documentation.
    const pending =
      options.maxIncomingPendingConnections ??
      Math.max(LIBP2P_MAX_INCOMING_PENDING_CONNECTIONS, limit)
    const inboundPerSecond =
      options.inboundConnectionThreshold ??
      Math.max(LIBP2P_INBOUND_CONNECTION_THRESHOLD, limit)

    const libp2p = await createLibp2p({
      // AUTH-01. Without this line libp2p mints a fresh ephemeral key on every start, so
      // a node has no identity that outlives its process and no certificate could refer
      // to it — which is exactly what every start did before this phase.
      privateKey: identity.privateKey,
      addresses: { listen },
      transports: viaRelay
        ? [tcp(), webSockets(), circuitRelayTransport()]
        : [tcp(), webSockets()],
      connectionEncrypters: [noise()],
      // Bare on purpose. `yamux({ maxEarlyStreams: N })` is available here and is
      // the obvious next idea after NET-09's per-peer send gate; it is wrong twice.
      //
      // It is unmeasurable from outside. `YamuxMuxer` spreads its init into
      // `AbstractStreamMuxer`, whose constructor uses a hardcoded
      // `init.maxEarlyStreams ?? 10`, and `earlyStreams` is a private field libp2p
      // never hands out — so nothing in this repository could read whether a raised
      // value took effect. And it protects nothing: a peer running default yamux
      // still aborts at 10 whatever this node sets, and the tear-down happens on the
      // *receiver's* muxer. Shipping it would add a mechanism this project could
      // only report, not measure, which is the failure this milestone exists to
      // remove. The full argument, including the fact that
      // `@chainsafe/libp2p-yamux`'s own `defaultConfig.maxEarlyStreams` is declared
      // and never read, is in `@o2/libp2p`'s constants doc.
      streamMuxers: [yamux()],
      connectionManager: {
        maxIncomingPendingConnections: pending,
        // Per *host*, so a burst of tabs from one machine — or of volunteers behind
        // one NAT — would otherwise be rejected mid-handshake.
        inboundConnectionThreshold: inboundPerSecond,
      },
      services: {
        identify: identify(),
        identifyPush: identifyPush(),
        ping: ping(),
        ...(canRelay
          ? {
              relay: circuitRelayServer({
                reservations: {
                  maxReservations: limit,
                  reservationTtl: options.reservationTtlMs ?? RELAY_MAX_RESERVATION_TTL_MS,
                  defaultDurationLimit: options.durationLimitMs ?? RELAY_DURATION_LIMIT_MS,
                  defaultDataLimit: options.dataLimitBytes ?? RELAY_DATA_LIMIT_BYTES,
                },
              }),
            }
          : {}),
      },
      ...(options.reservationWatcher === undefined
        ? {}
        : { logger: options.reservationWatcher.logger }),
    })
    // `createLibp2p` has bound a socket by this line, and a rejected `start` that
    // leaves one listening is a leak the caller has no handle to close.
    undo.push(() => libp2p.stop())

    // SCHED-06 — this node's own admission control, handed to `serveAgent` below.
    //
    // Constructed here, before the relay dials and before the transport, so a
    // nonsense limit is refused while there is least to unwind. `LocalCapacity`'s
    // constructor throws a `RangeError` naming the value for anything below 1, and
    // this factory passes `options.maxConcurrentTasks` straight through so that
    // guard is *reached* rather than bypassed by a clamp.
    //
    // `libp2p.peerId.toString()` is the same value the executor's `nodeId` is
    // resolved from below, so the capacity's node id and the executor's cannot
    // drift — the pattern this factory already applies to `sovereignty`.
    //
    // SCHED-04 — the cap this node paces itself to, and the first production
    // `DutyCycleGovernor` on either tier.
    //
    // Built before `admission` because the capacity reads it. `environment` is a
    // named absence rather than an omission: this tier has no visibility signal to
    // compose with, and saying so is what stops a reader assuming one was forgotten.
    const governor = new DutyCycleGovernor({
      dutyCycle: options.dutyCycle ?? 1,
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      environment: 'no-environment-governor',
    })

    // `dutyCycle: governor` — and this line reverses a decision recorded next to
    // `browser-node.ts`'s own construction, so it is argued rather than just changed.
    //
    // The objection on record was that *"two independent throttles on one path produce
    // a number nobody can predict"*. That holds only if these are two throttles, and
    // they are not. `GovernedExecutor` is the **mechanism** — it is what actually makes
    // a task wait. The slot count is the **statement about** that mechanism: advisory,
    // reserving nothing, and read by a requestor deciding where to send work. One cap,
    // seen twice. `CapacityOptions`' own doc already argued for exactly this coupling —
    // *"A node at 25% does not run a quarter of a task; it runs fewer of them."*
    //
    // Criterion 3 requires a cap to be observable in what a requestor is offered next.
    // The offer answer carries a slot count and the slot count derives from the duty
    // cycle, so this one argument is the whole of that requirement.
    //
    // What is genuinely given up, said plainly: a throttled node now refuses earlier as
    // well as running slower. That is intended. A node at a low cap still advertising a
    // high slot count would be inviting work it will not get to, which is the precise
    // failure a load hint exists to prevent.
    const admission = new LocalCapacity({
      nodeId: libp2p.peerId.toString(),
      maxConcurrent: options.maxConcurrentTasks ?? DEFAULT_MAX_CONCURRENT_TASKS,
      dutyCycle: governor,
    })

    // Connecting is what triggers the reservation; the `/p2p-circuit` listen entry
    // above is what makes libp2p ask for one.
    //
    // AUTH-01: the peer ids are collected here because a certificate has to name the
    // relays this node depends on. They come from the `Connection` rather than from the
    // configured address string for two reasons — `multiaddr@13` removed `getPeerId()`,
    // and, the better one, a peer id read off a connection is the peer actually
    // **reached**, while one parsed out of a configured string is a claim about who was
    // *meant* to be reached. A signed statement is the worst possible place for the second
    // kind of fact.
    // NET-05: **a relay this node cannot reach is a named condition, not a reason to
    // kill a node that can still work.** This loop used to let the dial throw. Because
    // it runs inside `start`, before the node exists, the throw could not be caught by
    // any caller that wanted to keep the node — and in `bin/agent.ts`, where `start` is
    // a top-level `await`, it surfaced as an unhandled rejection: a stack trace, a
    // nonzero exit, and none of the named-refusal reporting every other flag in that
    // binary does.
    //
    // The disposition now matches the one the flag doc states: a node given several
    // relays and able to reach only some of them keeps running on the ones it reached,
    // and a node that reached none still serves everything that does not need a
    // circuit. Which relays failed, and why, is reported rather than inferred from an
    // empty `circuitAddrs` — the exact ambiguity NET-05 exists to remove.
    //
    // **The browser tier does the opposite, and that divergence is deliberate.**
    // `browser-node.ts`'s dial loop has no `catch`: the failure propagates, `start`
    // rejects, and the tab unwinds. The reason is the platform, not an oversight — this
    // process binds a real listening port and remains useful to anyone who can reach it
    // directly, while a tab binds nothing, so a tab holding no reservation cannot be
    // reached at all and starting it would produce a node nobody can dial with no named
    // reason why. Each side is measured as its own disposition:
    // `reservation-exhaustion.node.test.ts` case C drives this one cross-process through
    // `bin/agent.ts` and reads `relay … unreachable:` off stderr with `exitCode` null;
    // `start-unwind.browser.test.ts` — *"closes the blockstore and stops libp2p when a
    // relay dial fails"* — reads the other in all three engines. **Do not make them
    // agree.** W-2 of `18-VERIFICATION.md` is that this paragraph used to describe the
    // change without recording that the two tiers now differ, which is a trap for
    // whoever reads the other file first.
    const relayPeerIds: string[] = []
    const relayFailures: RelayDialFailure[] = []
    for (const address of relayAddrs) {
      try {
        const connection = await libp2p.dial(multiaddr(address))
        relayPeerIds.push(connection.remotePeer.toString())
      } catch (cause) {
        relayFailures.push({ address, reason: cause instanceof Error ? cause.message : String(cause) })
      }
    }

    // NET-08: the first `Libp2pTransportOptions` this factory has ever passed — the
    // option surface existed and no node reached it. The key is omitted rather than
    // set to an explicit `undefined`, because `exactOptionalPropertyTypes` makes
    // those different types; the same idiom threads `rpcTimeoutMs` into
    // `RpcEndpoint` a few lines below.
    const transport = await Libp2pTransport.start(
      libp2p,
      options.maxMessageBytes === undefined ? {} : { maxMessageBytes: options.maxMessageBytes },
    )
    // Resolved once, here, so the identical value feeds both `egress`'s ownerId
    // and `guardSovereignty`'s clearance check below — not two independently
    // defaulted copies that could drift (13-CONTEXT.md decision 2).
    const sovereignty = options.sovereignty ?? { ownerId: '', canExecuteSovereign: false }
    // AUTH-03: this node's own identity is the audience a capability chain must end
    // at, so a chain minted for another node is refused here by `wrong-audience`.
    // Computed **once**, because it cannot change while the node runs, and computed
    // **eagerly, before `serveAgent`** below — so there is no path by which this node
    // serves with an authorizer whose audience was never derived.
    //
    // What that ordering claim is, and what it is not. It is "no node serves with an
    // underived audience". It is *not* "an identity that cannot yield an audience key
    // stops the node from starting" — that second claim is **unmeasured**, no assertion
    // anywhere can fail on it, and none was written.
    //
    // **Corrected 2026-08-01 (Plan 17-05), because this paragraph stated as verified a
    // fact about its own file that had stopped being true.** It read: *"the `createLibp2p`
    // call above passes … and **no `privateKey`** — so every identity this factory
    // produces is libp2p's Ed25519 default"*. Plan 17-01 added `privateKey:
    // identity.privateKey` to that call and did not update this comment.
    //
    // The **conclusion** survives and the reason is now the true one: that key is derived
    // by `identityFromSeed` from a 32-byte on-device seed through
    // `generateKeyPairFromSeed('Ed25519', seed)`, so it is Ed25519 by construction and
    // `audienceKeyOf`'s two throwing branches are still unreachable through this factory.
    // What changed is only *why* — not "libp2p's default" but "the one algorithm this
    // repository derives".
    //
    // It is still unreachable and still unmeasured, and no phase has added what would
    // change that: an **injectable** `privateKey` on `FabricNodeOptions`, driven from a
    // test with a secp256k1 or RSA key. Phase 17 added identity *resolution*, which always
    // yields Ed25519, not an injection point — so this is a present-tense statement rather
    // than the prediction it used to be.
    //
    // Accepting the *risk* that such an identity stops the node from starting is the
    // right call — the alternative is a node that serves with an authorizer no chain
    // can satisfy, refusing everything with `wrong-audience` and looking like a
    // capability problem. But that is a judgement about the risk, not evidence that the
    // branch works, and nothing here states a truth with no test behind it.
    const audience = audienceKeyOf(libp2p.peerId)
    // DATA-05/DATA-06: every outbound RPC frame is recorded by construction —
    // `rpc` is built over this guard, not over the raw `transport`, below.
    const egress = new EgressGuard(transport, sovereignty.ownerId)
    const rpc = new RpcEndpoint(
      egress,
      options.rpcTimeoutMs === undefined ? {} : { timeoutMs: options.rpcTimeoutMs },
    )

    // AUTH-01 / AUTH-04 — the provider signing key, when this process was told to hold
    // one. A **separate file** from `.identity.key`, so `issuerKey !== nodeKey` always
    // holds; and generated on-device, because no option in this phase accepts key material
    // and argv is world-readable in `ps` (17-CONTEXT.md decision 6).
    //
    // The two *optional* issuance numbers are left exactly as `enrollment.ts` declares
    // them. Cited rather than restated: nothing in this phase's criteria asks for other
    // numbers, a knob nobody sets is a knob that drifts from the tests, and a value copied
    // into a comment is a value that can disagree with its source.
    //
    // The two **required** ones are written out below as named sentinels, and both say
    // the same thing: this tier does not yet have what the option is for. Neither is
    // omitted, because an omission would be indistinguishable from a decision — and for
    // `issuance` specifically, defaulting it to the in-process history is *precisely* the
    // per-process budget Phase 17 measured as defeated, with nothing anywhere failing.
    //
    // **Plan 19-07 is where each gets its durable form on this tier** — a ledger over
    // `<dir>/`, beside `.provider.key`, and an aggregate number to go with it. Until then
    // this node states that it has neither, which is a reading a host can take rather
    // than an absence a reader has to infer.
    const authority =
      options.issuesCertificates !== true
        ? null
        : new EnrollmentAuthority({
            providerPrivateKey:
              options.blockstoreDir === undefined
                ? generateSeed()
                : await loadOrCreateSeed(options.blockstoreDir, PROVIDER_FILE),
            maxIssuedPerWindow: 'issues-without-an-aggregate-budget',
            issuance: 'remembers-only-within-this-process',
          })

    // AUTH-01 — the enrollment round trip, over the fabric's own protocol, before this
    // factory returns anything.
    //
    // `transport` and `rpc` are released here rather than left to `libp2p.stop()` alone,
    // because this is the first `await` in `#compose` that can *reject* after they exist:
    // the discipline this method's doc describes is a release pushed on the line after
    // each acquisition, and until now nothing between them and the end could throw.
    undo.push(() => transport.stop())
    undo.push(() => rpc.close())
    const certificate = await resolveCertificate({
      enrollment: options.enrollment,
      identity,
      rpc,
      libp2p,
      ...(options.blockstoreDir === undefined ? {} : { blockstoreDir: options.blockstoreDir }),
      canRelay,
      relayPeerIds,
    })

    // DATA-05 — the tap and the local-only tier that says which payloads are sovereign,
    // bound **once** and handed to both readers below. Two object literals saying the same
    // thing would be two places to change, and the invariant underneath this line is
    // precisely that the withholding predicate and the `block` branch consult the *same*
    // guard: one value passed twice cannot disagree, whereas two copies diverge the first
    // time one is edited.
    //
    // DATA-10's at-rest half. A node with a `blockstoreDir` records sovereign CIDs beside
    // its blocks and keeps refusing them after the job ends; one without a directory has
    // nowhere durable to put them and says so by name rather than by omission — an
    // in-memory node loses the set on exit either way, and pretending otherwise would be
    // the silent default this option's shape exists to prevent.
    const sovereignCids =
      options.blockstoreDir === undefined
        ? ('forgets-sovereignty-between-jobs' as const)
        : await FsSovereignCids.open(options.blockstoreDir)
    const egressDisposition = { guard: egress, sovereignInputs: store, sovereignCids }

    // AUTH-01 / SCHED-01 — what this node answers a peer's `records` *and* `providers`
    // requests with. See `ownRecords` for the five decisions it carries. Unconditional
    // since owner ruling D1: a node holding no certificate still holds blocks, and
    // answering `[]` about blocks it really has would be lying about itself.
    //
    // **The predicate names exactly the set `refusedReason` consults**, so `providers` can
    // never advertise a block the `block` branch would refuse. It is built here rather than
    // inside the helper so the guard it reads is unmistakably the one `serveAgent` is
    // given, and it is `withholdingFrom` rather than a comparison against
    // `egress.registrations`: that cheaper form is keyed on a registration *label* while
    // the `block` branch is keyed on a *payload*, and 18-02 planted it and measured this
    // node advertising, over the wire, a block its own `block` branch refused in the same
    // test. Holding an invariant between two branches means asking one question twice, not
    // writing the question down twice.
    const records = ownRecords(
      certificate,
      identity,
      sovereignty.canExecuteSovereign,
      store,
      withholdingFrom(egressDisposition),
    )

    // AUTH-02 — per-peer verdicts, computed offline against the pinned issuer keys.
    //
    // Constructed **after** `resolveCertificate`, which dials the provider: that
    // connection's `peer:connect` has therefore already fired with nobody listening, and
    // it is `start`'s seeding loop over `peers()` that catches it. Same mechanism as the
    // relay case the loop exists for.
    //
    // A node given no `trustedIssuers` gets a verifier that subscribes to nothing, asks
    // nobody anything, and answers `verifiedPeers` with the connected set unchanged — so
    // this line costs a node that pins nobody exactly one allocation.
    const verifier = PeerVerifier.start({
      libp2p,
      rpc,
      peers: () => transport.peers,
      trustedIssuers: new Set(options.trustedIssuers ?? []),
    })

    // Blocks this node lacks are pulled from whichever peers are connected **and
    // verified**. AUTH-02, and 17-CONTEXT.md decision 8: this line is the whole of the
    // gate. Reading the verified subset here means an unverified peer is never asked for a
    // block and never appears as a dispatch candidate — structurally, because there is
    // nowhere left to forget the check. `Transport` deliberately learns nothing about
    // certificates, so `libp2p-transport.ts` stays a three-member datagram port; the
    // argument for keeping it that way is in its own module comment.
    //
    // Still a thunk, and now for two reasons rather than one. A peer that connects later
    // is usable immediately, as before — and a peer that connects later is usable *once
    // verified*, which is what makes the fail-closed window between connect and verdict
    // cost nothing durable: the source is read per fetch, so a retry after the verdict
    // lands succeeds without reconnecting and with no invalidation step anywhere.
    const blockstore = new FetchingBlockstore(store, new RpcBlockSource(rpc, () => verifier.verifiedPeers))

    // The node's own peer id is its executor id, so a disagreement names the
    // machine that produced the dissenting result.
    //
    // DATA-09: guarded unconditionally, with no opt-in required to get the
    // refusal — `options.sovereignty` defaults to cleared-for-nobody (see
    // `FabricNodeOptions.sovereignty`'s doc). Wrapped once, here, rather than
    // only at the `serveAgent` call below, so a caller that dispatches through
    // `node.executor` directly — bypassing RPC entirely — gets the identical
    // refusal a remote dispatch would.
    //
    // DATA-05/DATA-06 no longer appear in this chain. A sovereign task's input is
    // declared to this node's tap by `serveAgent`, which is the layer that also gives
    // the hold back once the reply frame has settled; an executor decorator knew
    // *whether* it had declared anything and had nowhere to say so, and the serve path
    // released regardless. `store` (the local-only tier) is still the registration
    // blockstore and is handed to `serveAgent` below, never `blockstore` (network
    // fallback) — sovereign data must already be resident locally, never fetched over
    // the network merely to be declared sovereign.
    //
    // The narrowing that follows, stated rather than left to be found: a dispatch that
    // bypasses RPC entirely — `node.executor.execute()` — now declares nothing. It
    // also no longer takes a hold nothing ever gave back, which is the unbounded
    // growth that route used to carry.
    //
    // SCHED-06: `CountingExecutor` is composed **outermost**, outside the sovereignty
    // gate. Outermost is what makes it the instrument criterion 1 is read off: nothing
    // can reach this node's executor without passing through it, so
    // `executorPeakInFlight` is a count of calls that really happened rather than of
    // slots the node believes it granted. See that getter for what the reading does
    // and does not license.
    // DET-03/DATA-08: resolved once, here, next to where `sovereignty` is resolved
    // once and for the identical stated reason — two independently defaulted copies
    // could drift.
    //
    // The wrapper sits **closest to the thing it guards**, with no layer between it
    // and the executor that reaches `WebAssembly.instantiate`. That is what makes
    // "refused before instantiation" true by construction rather than by inspecting
    // whatever happens to be layered above it this month.
    //
    // And sovereignty is checked **first**, outside it, deliberately: a node that may
    // not decrypt an owner's data should say *that*, whatever module was named. The
    // clearance answer is about this node and is the more useful one to return; the
    // provenance answer is about the dispatcher's record and would bury it.
    const anchors = options.trustAnchors
    const provenance =
      anchors === 'runs-unsigned-artifacts'
        ? (inner: Executor): Executor => inner
        : (inner: Executor): Executor =>
            guardModuleProvenance(inner, {
              resolver: new SignedNameResolver(anchors),
              // A thunk, never a captured number — see `ModuleProvenance.now`. A node
              // that read the clock here would keep running an expired record for its
              // whole uptime.
              now: () => Date.now(),
            })

    const compute = new WorkerExecutor({
      nodeId: libp2p.peerId.toString(),
      blockstore,
      createThread: workerThread,
      ...(options.taskDeadlineMs === undefined ? {} : { deadlineMs: options.taskDeadlineMs }),
    })
    // SCHED-06 + SCHED-04. The counter sits **inside** the governor, which is a change
    // from this tier's previous order and brings it into line with `browser-node.ts`.
    //
    // The reason is that tier's, quoted rather than re-derived: a counter outside the
    // governor would count tasks parked on its serialisation chain as in flight, which
    // is precisely not what "how many tasks is this node running at once" means. The
    // two tiers now agree on layer order, which is what the equal-functionality rule is
    // actually about.
    //
    // Everything inside is unchanged and the order still matters: sovereignty outside
    // provenance, provenance innermost against `compute`.
    const counter = new CountingExecutor(guardSovereignty(provenance(compute), sovereignty))
    const executor = new GovernedExecutor(counter, governor)

    // VER-08 / VER-09 / VER-10 — this node's signing identity, resolved **once**, on one
    // line, for both verbs.
    //
    // The seed and the certificate are the values this factory already holds: `identity`
    // is what `requestEnrollment` signed with and `certificate.nodeKey` is its public
    // half, so the two cannot disagree. Neither is an option and neither is re-derived. A
    // node signing with anything but the key its certificate names produces attestations
    // that verify for nobody, and `signingKeyOf` throws at composition when they diverge —
    // there is no reason to make that state expressible from outside.
    //
    // **The literal, not a branch, and the difference is what a later reader can do to
    // it.** A node nobody enrolled reaches this line by the same route as one that was,
    // and states that it signs nothing. A `certificate === null` branch wrapped around
    // the composition below would be a thing a later edit could extend — one more
    // condition under which this node quietly stops signing; a named literal is a thing
    // that edit would have to write down.
    //
    // **A per-node setting, not a node kind**, and `browser-node.ts` builds this from the
    // byte-identical expression over its own two values. A tab that has been enrolled
    // signs exactly as a server that has been; a node that has not says so identically on
    // both tiers. The only asymmetry anywhere in this leg is where each tier persists its
    // seed, and that is not in this file.
    const attestor: ResultAttestor =
      certificate === null ? 'signs-nothing' : { nodeSeed: identity.seed, certificate }

    // The signing layer is **outermost** — outside `GovernedExecutor`, with nothing
    // composed after it. It signs the outcome that actually leaves this node, so no layer
    // added later can alter an answer after it was signed. That is the same argument the
    // three orderings below it make, one layer further out, and **none of those three
    // moves**: provenance stays innermost against `compute`, sovereignty stays outside
    // provenance, and the counter stays inside the governor.
    //
    // Unconditional, on `serveAgent`'s own terms below: there is no construction path
    // through this factory that yields a node whose results carry neither a signature nor
    // its stated absence of one.
    //
    // **What this layer is for.** A result leaving this node carries this node's
    // signature over it, checkable by somebody who was not present, so a receipt
    // downstream is a statement about nodes a provider certified rather than about node
    // id strings the requestor chose.
    //
    // **What it is not for: correctness.** A signature on a wrong answer is a signed
    // wrong answer, signed exactly as convincingly as a right one. `executeVerified`'s
    // N-version comparison is still the only thing in this design that says an answer is
    // right, and this is written at the line because somebody will read "results are
    // signed now" and propose reducing redundancy.
    //
    // `node.executor` below stays the `GovernedExecutor` — BROW-04 requires the concrete
    // type on the browser tier and both tiers agree on this stack's shape — so a caller
    // reaching a node's executor in-process gets the unsigned outcome. That is the
    // truthful reading: nothing left the node, and a node's signed statement to itself
    // establishes nothing it did not already hold.
    const signing = attestResults(executor, attestor)

    const node = new FabricNode({
      libp2p,
      transport,
      rpc,
      egress,
      blockstore,
      store,
      executor,
      counter,
      governor,
      compute,
      admission,
      limit,
      pending,
      inboundPerSecond,
      identity,
      authority,
      certificate,
      verifier,
      relayFailures,
      sovereignCids,
    })

    // Unconditional, and that is the point: there is no construction path through
    // this factory that yields a node which will not compute. A node that relays
    // reaches this line by the same route as one that does not.
    //
    // `reservations` is a thunk over the node, which is why the node is constructed
    // first — the same ordering `BrowserNode.start` uses for `onDispatch`, and for
    // the same reason: the handler has to close over an object that does not exist
    // until the constructor returns.
    //
    // Without it this answered `[]` forever. `reservedPeerIds` held exactly the
    // right data and nothing asked it, so `findReservedPeers` — documented in the
    // demo as *the only route on a static host* — got a real answer containing
    // nobody. That produces `{asked: true, dialed: [], failed: []}`: nothing
    // attempted, nothing failed, no error to notice. The same signature as the
    // two-device defect found on hardware, one tier down. The LAN demo hid it,
    // because `SeedServer` reads `reservedPeerIds` in-process and never asks over
    // the wire.
    serveAgent({
      rpc,
      // VER-08 — the signing layer, which is the outermost one. Every `exec` reply this
      // node sends is composed from an outcome that passed through it.
      executor: signing,
      blockstore,
      // DATA-05: the same guard `rpc` is built over, plus the local-only tier that
      // says which payloads are sovereign — so a sovereign task's input is guarded
      // for exactly as long as its reply frame takes to settle, and a dispatch that
      // declared nothing gives nothing back.
      egress: egressDisposition,
      // AUTH-03: `verifyChain` has been complete and fuzzed since Phase 4 with zero
      // production callers, and this hook has been explicit since Phase 11 with a
      // named sentinel at every production call site. This line is where the two meet.
      //
      // **Every node runs this identical authorizer.** What differs between two nodes
      // is the owner they were configured with and the identity they were assigned —
      // never what kind of node they are. A browser node passes the byte-identical
      // argument (`packages/browser/src/browser-node.ts`).
      //
      // The conditional spread is required by `exactOptionalPropertyTypes`, which makes
      // an absent key and an explicit `undefined` different types; `bin/agent.ts` builds
      // its own `sovereignty` object with the same idiom. An absent `ownerKey` is not a
      // pass — `authorizeCapability` refuses every sovereign task naming this owner
      // when it has no key to root a chain at.
      authorize: authorizeCapability({
        ownerId: sovereignty.ownerId,
        ...(sovereignty.ownerKey === undefined ? {} : { ownerKey: sovereignty.ownerKey }),
        audience,
        now: Date.now,
      }),
      // AUTH-01 / SCHED-01. **The sentinel is gone from this file**, because there is no
      // longer a node this factory can build that has nothing to answer: one holding a
      // certificate answers with it and with its own signed capability record, and one
      // holding none answers `records: null` and a real provider list — two truthful
      // statements rather than one refusal to speak.
      //
      // What changed is the `providers` half. This comment used to read *"`providers` still
      // answers `[]`, because `provide()` is never called"*, and that was accurate for
      // every node from Phase 6 to Phase 17: the request kind was served by a branch whose
      // index had never had anything provided into it. Owner ruling D1 replaced the
      // announcement with an answer computed from this node's own store at ask time, so the
      // decision is findable rather than merely gone.
      //
      // Both halves are public statements whose entire purpose is to be read by a stranger.
      // Nothing secret crosses this boundary and nothing may later be added that does —
      // which is what the withholding predicate at the construction site is for.
      //
      // A per-node configuration, not a node kind: `browser-node.ts` builds this from the
      // identical expression over its own store and its own guard, and
      // `serve-agent-hooks.node.test.ts` counts both.
      index: records,
      // AUTH-01 / AUTH-04. The sentinel is now the *fallback*, not the only value: a node
      // started with `issuesCertificates` answers enrollment requests with a real
      // authority, and one that was not says by name that it issues none.
      //
      // A per-node setting, not a node kind — see `FabricNodeOptions.issuesCertificates`
      // and `AgentOptions.enroll`. The literal still appears exactly once in this file,
      // which is what `serve-agent-hooks.node.test.ts` counts.
      enroll: authority ?? 'issues-no-certificates',
      // SCHED-06. This hook answered "accepts everything" for the whole of two
      // milestones, so `serveAgent`'s `exec` branch ran `executor.execute` with
      // nothing counting what was in flight. `LocalCapacity` existed that entire
      // time and was constructed nowhere outside two test files, so the one thing
      // able to emit `over-committed: N of M slots in use` could not be reached from
      // a running node. `ARCHITECTURE.md` §7.2 said *an over-committed node just says
      // no, and the requestor resamples*; only the half that resamples had shipped.
      //
      // Measured against this factory before this line changed, at 64 concurrent
      // `exec` requests from two real peers over TCP: 64 simultaneous
      // `executor.execute()` calls, zero refusals, and 32 of the 64 requestors' RPCs
      // timed out waiting (`packages/node/src/admission.node.test.ts`, 2026-07-29).
      // With this line, the same run refuses by name and holds the declared bound.
      capacity: admission,
      reservations: () => node.reservedPeerIds,
      ledger: 'keeps-no-ledger',
      onDispatch: 'reports-no-dispatch',
      // VER-08 / VER-09 / VER-10 — the node's own signing identity, for **both** verbs,
      // and **the same value the executor above was wrapped with**. One identity resolved
      // on one line and reaching both, rather than two derivations from one source: two
      // derivations are two things that can drift, and the drift has a specific shape —
      // a node that signed its map results and not the aggregation over them would
      // satisfy the letter of this leg and none of its purpose, which is why one plan
      // turned both verbs on rather than two.
      //
      // The two verbs reach it by different routes because the codebase is shaped that
      // way and not by preference: `exec` runs through an `Executor`, so it signs through
      // the wrapper composed above; a combine passes through no executor at all —
      // `serveAgent` performs it itself — so its signer has to arrive here.
      //
      // A node holding no certificate passes the named absence to **both**, so there is
      // no construction path through this factory that signs one verb and not the other.
      //
      // A per-node setting, not a node kind — see this hook's own doc in `agent.ts`.
      attest: attestor,
    })

    return node
  }

  get peerId(): string {
    return this.libp2p.peerId.toString()
  }

  /**
   * The connected peers this node will fetch a block from — AUTH-02.
   *
   * The same list `RpcBlockSource` reads, so this is a reading of the gate rather than a
   * parallel account of it. A node given no `trustedIssuers` returns the connected set
   * unchanged; see that option's doc for why that is stated rather than defaulted.
   */
  get verifiedPeers(): readonly string[] {
    return this.#verifier.verifiedPeers
  }

  /**
   * Why a peer is or is not verified — AUTH-02.
   *
   * `undefined` means no verdict has been computed: either this node pins nobody and
   * therefore verifies nobody, or the records round trip for that peer has not landed yet.
   * Those two are different states and a caller that cares distinguishes them by whether
   * it configured `trustedIssuers` at all.
   */
  verdictFor(peerId: string): PeerVerdict | undefined {
    return this.#verifier.verdictFor(peerId)
  }

  /** Addresses a peer can dial to reach this node. */
  get multiaddrs(): readonly string[] {
    return this.libp2p.getMultiaddrs().map((ma) => ma.toString())
  }

  /**
   * The relayed subset — the only kind of address a browser peer ever has.
   *
   * Empty until a relay has granted a reservation, which is why callers wait on it
   * rather than reading it immediately after `start`.
   */
  get circuitAddrs(): readonly string[] {
    return this.multiaddrs.filter((ma) => ma.includes('/p2p-circuit'))
  }

  /** The browser-dialable subset. A browser cannot use anything else. */
  get browserDialableAddrs(): readonly string[] {
    return this.multiaddrs.filter((ma) => ma.includes('/ws') || ma.includes('/wss'))
  }

  /**
   * Whether this node is carrying circuits for other peers.
   *
   * Read off the live service rather than off a remembered flag, so it cannot drift
   * from what libp2p is actually doing. Callers use it to describe a node, never to
   * decide what to ask it for: every node answers the same requests.
   */
  get relays(): boolean {
    return hasReservations(this.libp2p.services['relay'])
  }

  /** Simultaneous inbound handshakes this node will accept. */
  get maxIncomingPendingConnections(): number {
    return this.#pending
  }

  /** Inbound connections per second this node accepts from one host. */
  get inboundConnectionThreshold(): number {
    return this.#inboundPerSecond
  }

  /**
   * Current reservation capacity, reported by name.
   *
   * NET-05: a relay at capacity must say so. Without this, a node that cannot
   * reserve sees only "no circuit address appeared", which is indistinguishable
   * from the relay being unreachable — and the two need completely different
   * responses (try another relay vs. wait and retry).
   */
  get capacity(): RelayCapacity {
    const service: unknown = this.libp2p.services['relay']
    const granted = hasReservations(service) ? service.reservations.size : 0
    return {
      granted,
      limit: this.#limit,
      remaining: Math.max(0, this.#limit - granted),
      atCapacity: granted >= this.#limit,
    }
  }

  /**
   * Peer ids currently holding a reservation here.
   *
   * This is the whole of the rendezvous a LAN demo needs. Two browsers on the same
   * relay are mutually dialable the moment each knows the other exists, and neither
   * can announce itself — a browser binds no listening socket, which is the *only*
   * difference between nodes in this fabric. A node that relays already holds the
   * list as a consequence of doing its job; publishing it adds no state and no
   * authority.
   *
   * Read from the live store on demand, for the same reason `capacity` is: libp2p
   * declares a `relay:reservation` event and never dispatches it.
   */
  get reservedPeerIds(): readonly string[] {
    const service: unknown = this.libp2p.services['relay']
    if (!hasReservations(service)) return []
    return [...service.reservations.keys()].map((peer) => peer.toString())
  }

  /** Dial a peer and return its peer id. */
  async dial(address: string): Promise<string> {
    const connection = await this.libp2p.dial(multiaddr(address))
    return connection.remotePeer.toString()
  }

  async stop(): Promise<void> {
    this.rpc.close()
    // Before the transport, and not optional: a task in flight holds a live thread,
    // and a thread nobody killed keeps the process alive after everything else has
    // been shut down. `terminate()` is idempotent, and it resolves anything pending
    // rather than leaving a caller awaiting a promise that will never settle.
    this.#compute.terminate()
    // AUTH-02, and before the transport: the verifier holds two listeners on `libp2p`, and
    // a stopped node that kept them would react to a `peer:connect` by issuing a records
    // request through an endpoint it has already closed.
    this.#verifier.stop()
    await this.transport.stop()
    await this.libp2p.stop()
  }
}
