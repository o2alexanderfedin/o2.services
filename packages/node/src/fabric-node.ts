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
import { autoTLS } from '@ipshipyard/libp2p-auto-tls'
import type { AutoTLS } from '@ipshipyard/libp2p-auto-tls'
import { circuitRelayServer, circuitRelayTransport } from '@libp2p/circuit-relay-v2'
import { yamux } from '@chainsafe/libp2p-yamux'
import { http } from '@libp2p/http'
import { identify, identifyPush } from '@libp2p/identify'
import { kadDHT, passthroughMapper } from '@libp2p/kad-dht'
import { keychain } from '@libp2p/keychain'
import { ping } from '@libp2p/ping'
import { tcp } from '@libp2p/tcp'
import { webSockets } from '@libp2p/websockets'
import { multiaddr } from '@multiformats/multiaddr'
import type { TLSCertificate } from '@libp2p/interface'
import type { Datastore } from 'interface-datastore'
import { AbiExecutor, WasiExecutor } from '@o2/aot'
import {
  DEFAULT_ISSUANCE_WINDOW_MS,
  DEFAULT_MAX_CONCURRENT_TASKS,
  DutyCycleGovernor,
  EnrollmentAuthority,
  LocalCapacity,
  MemoryBlockstore,
  SelfRecordIndex,
  SignedNameResolver,
  StartOutcomeLedger,
  WorkerExecutor,
  attestResults,
  guardModuleProvenance,
  guardSovereignty,
  isStartBrowserLabel,
  publishCapabilities,
  requestEnrollment,
  subtleUserSigner,
  verifyCapabilityRecord,
  verifyCertificate,
} from '@o2/core'
import type {
  Blockstore,
  BrowserFamily,
  CanonicalValue,
  Executor,
  IssuanceBudget,
  NodeCertificate,
  NodeSovereignty,
  PublicKeyHex,
  RecordIndex,
  ResultAttestor,
  SelfRecordIndexOptions,
  StartOutcome,
  StartReport,
  StartReportingConsent,
} from '@o2/core'
import {
  CountingExecutor,
  EgressGuard,
  FetchingBlockstore,
  GovernedExecutor,
  RpcBlockSource,
  RpcEndpoint,
  RpcRecordIndex,
  UNREACHABLE_PROVIDER,
  authorizeCapability,
  encodeRequest,
  enrolOverRpc,
  parseResponse,
  serveAgent,
  withholdingFrom,
} from '@o2/net'
import type { EnrolOutcome } from '@o2/net'
import { createLibp2p } from 'libp2p'
import { peerIdFromString } from '@libp2p/peer-id'
import type { Libp2p, PeerId } from '@libp2p/interface'
import { FsBlockstore } from './fs-blockstore.ts'
import { FsIssuance } from './fs-issuance.ts'
import { FsSovereignCids } from './sovereign-cids.ts'
import type { SovereignCids } from '@o2/net'
import {
  LIBP2P_INBOUND_CONNECTION_THRESHOLD,
  DHT_QUERY_TIMEOUT_MS,
  DhtProviderAnnouncer,
  DhtRecordIndex,
  ObservingBlockstore,
  RecordPublisher,
  LIBP2P_MAX_CONNECTIONS,
  LIBP2P_MAX_INCOMING_PENDING_CONNECTIONS,
  Libp2pTransport,
  O2_KAD_PROTOCOL,
  O2_RECORD_NAMESPACE,
  RELAY_DATA_LIMIT_BYTES,
  RELAY_DURATION_LIMIT_MS,
  O2_MAX_RESERVATIONS,
  RELAY_MAX_RESERVATIONS,
  RELAY_RESERVATION_TARGET,
  RELAY_MAX_RESERVATION_TTL_MS,
  PeerVerifier,
  admitsAnyPeer,
  audienceKeyOf,
  generateSeed,
  identityFromSeed,
  nodeKeyForPeerId,
  o2RecordSelector,
  o2RecordValidator,
  discoverRelays,
  peerIdForNodeKey,
  providerRecordPolicy,
  relayServiceCid,
  topUpRelays,
} from '@o2/libp2p'
import type { NodeIdentity, PeerVerdict, RelayAdmission, SweepOutcome } from '@o2/libp2p'
import type { KadDHT } from '@libp2p/kad-dht'
import {
  IDENTITY_FILE,
  PROVIDER_FILE,
  loadCertificate,
  loadOrCreateSeed,
  saveCertificate,
} from './identity-store.ts'
import type { ReservationWatcher } from './reservation-watch.ts'
import { workerThread } from './worker-thread.ts'

/**
 * NET-03's configuration surface — where to get a certificate, and how fast.
 *
 * Every field is optional and every default is the production one, so `autoTls: {}` is a
 * node that asks Let's Encrypt through `registration.libp2p.direct`. The overrides exist
 * because a claim about certificate acquisition that can only be checked by deploying is
 * not a claim this project accepts as measured.
 */
export interface AutoTlsOptions {
  /** ACME directory URL. Defaults to Let's Encrypt's production endpoint. */
  readonly acmeDirectory?: string
  /** The service that answers the dns-01 challenge. Defaults to `registration.libp2p.direct`. */
  readonly forgeEndpoint?: string
  /** The zone certificates are issued under. Defaults to `libp2p.direct`. */
  readonly forgeDomain?: string
  /**
   * How long to coalesce address changes before ordering a certificate.
   *
   * The library defaults to 5 s so a node adding addresses one at a time during start
   * does not order once per address. A test that has to wait out this debounce on every
   * case pays it in wall clock, so it is exposed — not because 5 s is wrong.
   */
  readonly provisionDelayMs?: number
  /**
   * How long one acquisition attempt may take before it is abandoned and retried.
   * Defaults to the library's 120 s.
   */
  readonly provisionTimeoutMs?: number
}

export interface FabricNodeOptions {
  /**
   * Backing store for the acquired certificate and the RSA keys behind it.
   *
   * AutoTLS writes the issued PEM here and reads it back on the next start, which is the
   * half of "without manual certificate management" that is about *not re-acquiring*.
   * libp2p defaults to an in-memory store, so a node given none acquires afresh every
   * start — correct, and wasteful against a CA that rate-limits.
   *
   * Typed as libp2p's `Datastore` rather than a path: the browser tier stores in
   * IndexedDB, a backbone node on disk, and a test in memory, and this package has no
   * business choosing.
   */
  readonly datastore?: Datastore
  /**
   * How long this node keeps another node's provider record before sweeping it. **1 hour
   * by default** — {@link PROVIDER_RECORD_VALIDITY_MS}.
   *
   * One number rather than three: `providerRecordPolicy` derives the sweep interval and
   * the republish threshold from it, so the staleness bound stays `1.25 ×` this value.
   * Raise it for a deployment of long-lived server nodes, which pay a republish walk per
   * block per cycle and gain nothing from forgetting quickly; lower it where the peer set
   * churns and a record that outlives its provider costs a dial timeout on the read path.
   */
  readonly providerRecordValidityMs?: number
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
   * SCHED-03. Read on every request to decide whether this node is **paused** —
   * alive, reachable, unchanged in what it can do, and declining all work right now.
   *
   * A thunk rather than a flag, because an operator toggles it while the node runs:
   * hold your own boolean and hand over a closure that reads it. `AgentOptions.paused`
   * carries the full argument for the state and for what it does and does not decline.
   *
   * **Optional here and required there**, which is the shape `SeedServerOptions.relayAdmission`
   * already takes for the same reason. The mechanism must not be reachable by silence —
   * so `serveAgent` refuses to compile without a stated posture — while a factory that
   * is told nothing threads the named opt-out through a ternary and is byte-identical
   * to the node that existed before this option did. Omitting it is not a node that
   * might pause; it is a node that never does, said by the line below.
   */
  readonly paused?: () => boolean
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
   * Whether this process holds a provider signing key and answers enrollment requests, and
   * **how many certificates it will sign per window if it does** — AUTH-01, AUTH-04.
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
   * **It carries the budget rather than sitting beside it, and that is the whole shape of
   * it.** It used to be a `boolean`. A separate optional `maxIssuedPerWindow` beside it
   * would have left the one mechanism that bounds an attacker switched off whenever a
   * caller forgot the second field, with `tsc --noEmit` at exit 0 — the failure
   * `IssuanceBudget`'s own docblock records this phase measuring twice. Folded in, *a
   * provider with no stated budget is not a state this type can express*: a caller either
   * names a number or writes `'issues-without-an-aggregate-budget'` and thereby says so.
   * Absence still means "does not issue at all", which is the safe default and is the one
   * omission that selects nothing dangerous.
   *
   * **The key is generated on-device and is never passed in.** There is no option here
   * that accepts key material, and `bin/agent.ts`'s `--issues-certificates` is a boolean
   * for the same reason: argv is world-readable in `ps`, so a key on a command line is a
   * key every account on the host has read. (The *budget* is a policy number rather than
   * key material, so it does reach argv, as `--max-issued-per-window`.) The key is written
   * to `.provider.key`, a **different file from `.identity.key`**, so `issuerKey !==
   * nodeKey` always holds and a provider-signed certificate is never confusable with a
   * self-signed one.
   *
   * A process given no `blockstoreDir` has nowhere to persist the key and gets a fresh one
   * per start — the same deployment choice `blockstoreDir`'s own doc frames above, and not
   * a different kind of node. It also has nowhere to persist the *issuance record*, and
   * says so by name at the construction site rather than by omission.
   */
  readonly issuesCertificates?: IssuanceBudget
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
   * **Something that can *sign*, not a `userKey` hex string, and the difference is
   * load-bearing.** `EnrollmentAuthority.enrol` requires an `ownerProof`: the *user's*
   * signature over the same challenge bytes the node signs, refused by name as
   * `bad-owner-proof` when it is absent or wrong. That proof can only be produced by
   * whoever holds the user's private half, so a node configured with a public key alone
   * could name a user key and would be refused on every attempt. `requestEnrollment`
   * accordingly takes `userKey` from **whatever signs** rather than accepting it as a
   * field, so naming somebody else's user key is not a thing this option can be asked to
   * do. Consent is a value here, not a check.
   *
   * **A `CryptoKeyPair` is accepted too, and on this tier that is the unusual case rather
   * than the expected one.** The union exists because the browser tier's visitor key is a
   * non-extractable `CryptoKey` (see `BrowserNodeOptions` for the measurement), and one
   * enrolment API serves both tiers — which is this project's whole bet. A backbone
   * operator normally fills the bytes arm, because a key from a file survives a restart and
   * moves between machines, and a WebCrypto pair generated in-process does neither. The arm
   * is here for a host that already holds its key inside `subtle` — not as an upgrade path.
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
    readonly userPrivateKey: Uint8Array | CryptoKeyPair
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
  /**
   * Extra multiaddrs to publish alongside the ones this node bound.
   *
   * A relay behind a port-forward binds `/ip4/0.0.0.0/tcp/9000/ws` and is *reached* at its
   * router's address; a relay in a container binds the container's address and is reached
   * at the host's. In both cases the bound address alone is not the whole truth, and this
   * is the field that adds the rest.
   *
   * It is also how a node becomes eligible for `autoTls`, which provisions only when an
   * address is neither loopback nor RFC 1918 — its proxy for "somebody could dial me".
   *
   * **Append, and deliberately not replace.** libp2p offers `announce` for the replacing
   * form and it is the wrong one here, for a reason that is measured rather than
   * stylistic: `address-manager/index.js:256` returns the announce list *and returns
   * early*, so a node using it never reaches `:294`, where AutoTLS's DNS mapping is folded
   * in. Set `announce` and the certificate still arrives and the listener still upgrades —
   * but the node never publishes the `/tls/sni/<name>/ws` address that mapping produces,
   * which is the one a browser is meant to dial. `auto-tls.node.test.ts` reads both.
   */
  readonly appendAnnounce?: readonly string[]
  /**
   * NET-03 — acquire and renew a TLS certificate with no operator involvement.
   *
   * Present enables it; absent leaves the node exactly as it was. With no fields set the
   * defaults are the production ones: Let's Encrypt as the certificate authority and
   * `registration.libp2p.direct` as the DNS delegate, which together require the node to
   * hold a genuinely public address — see `announce`.
   *
   * The three endpoint fields exist so the whole path can be **run** rather than reasoned
   * about: `local-acme.ts` starts an ACME authority, a DNS zone and a forge on loopback,
   * and `auto-tls.node.test.ts` points these at it. What that measures and what it cannot
   * is written at the top of `local-acme.ts`; the short form is that everything except the
   * *identity of the CA* is the same code doing the same thing.
   */
  readonly autoTls?: AutoTlsOptions
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
  /**
   * Who this node grants a circuit reservation to — AUTH-02, AUTH-04.
   *
   * **Required, with no `?` and no default**, and that is the whole of the design. An
   * omitted value would let a caller mean *"admit everyone"* without ever having said so,
   * at the one boundary where the difference between silence and consent is the entire
   * security claim. `trustAnchors` above is required for the identical reason and states
   * the argument at length; `.planning/PROJECT.md`'s Key Decision — *an optional hook with
   * a silent default is a hole* — is the rule both obey.
   *
   * The union's three values, and what each admits, are documented in full at
   * {@link RelayAdmission} in `@o2/libp2p`, together with the deployment requirement a
   * relay that pins issuers takes on and the reservation-TTL revocation window. That is
   * also where the **asymmetry with {@link FabricNodeOptions.trustedIssuers}** is argued:
   * the reservation path never reads an empty set as permission, because `'admits-any-peer'`
   * carries that meaning instead — so the two mechanisms do not read one value two ways,
   * they read different types.
   *
   * **This is read, and Plan 24-03 is what made it so. The paragraph that stood here said
   * the opposite, and it was corrected on 2026-08-06 rather than left to be believed.** It
   * read *"Nothing reads this yet … No `connectionGater` is constructed below … every
   * construction site in this repository writes `'admits-any-peer'`"*, and three of those
   * four clauses are false **in this same file**. {@link relayAdmissionGate} takes this
   * value as its `admission` argument; `createLibp2p` below is handed
   * `connectionGater: { denyInboundRelayReservation: gate }` by a conditional spread; and
   * `bin/agent.ts` writes a pinned `new Set(values['admit-issuer'])` when `--admit-issuer`
   * is given. The spread is conditional because the gate returns `undefined` for
   * `'admits-any-peer'`, so an open node supplies **no gater method at all** and is
   * byte-identical to the tree before this field existed — which is the property that made
   * arming it safe, not a leftover of the wave that deferred it.
   *
   * **The one clause that survives is `circuitRelayServer`'s.** Its arguments are still
   * capacity-only, deliberately, and `relay-admission.node.test.ts`'s census pins that:
   * admission is a `ConnectionGater` question and capacity is a relay-server one, and
   * folding either into the other is the defect that census exists to catch.
   *
   * **Threading the option one wave before arming it was still the right move**, and that
   * half of the old paragraph was true — a site that had already stated what it means did
   * not break when the value started being consulted.
   *
   * **What being read costs, stated here because this is where a deployment reads it.** A
   * relay that pins issuers asks a joining peer for its records over the fabric's own RPC
   * before granting the reservation, so it must be able to reach that peer at that moment;
   * the ask is retried, because the first request is *destroyed* rather than delayed. The
   * verdict is taken **at the grant and at each renewal**, which is what makes
   * {@link FabricNodeOptions.reservationTtlMs} this node's revocation window — measured, and
   * argued in full at that field. Every verdict lands in {@link FabricNode.admissionDecisions},
   * which is in-process only: across a process boundary a refusal reaches the joiner as an
   * undifferentiated `PERMISSION_DENIED` carrying no reason at all.
   *
   * Per-node **configuration**, not a node kind. Every `FabricNode` has the identical
   * executor, transport, relay capability and protocol surface whatever is passed here —
   * exactly as `sovereignty`, `trustAnchors` and `trustedIssuers` do. It is a value on
   * *this* node's options describing who *it* admits, and it says nothing about what kind
   * of thing a peer is.
   *
   * A node that binds no listening address relays for nobody — `canRelay` is derived from
   * the listen list, for the reason the module comment's "why relaying is derived and not
   * configured" section gives — so on such a node this states a posture that is never
   * reached. It is still required there, because a field whose presence depended on
   * another option's value would be a second answer to "does this node relay?" and the
   * whole of that section is about there being one.
   */
  readonly relayAdmission: RelayAdmission
  /**
   * Whether this node's own start row may leave this machine — BROW-01.
   *
   * **Required, with no `?` and no default**, on the identical ground {@link
   * FabricNodeOptions.relayAdmission} states one field up: an omitted value would let a
   * caller publish a fact about the machine they are running on without ever having said
   * so. The union's two values and what each costs are documented in full at
   * {@link StartReportingConsent} in `@o2/core`.
   *
   * ## Why this tier has the field, when the defect was found in a browser
   *
   * BROW-01 was a browser-tier defect: a visitor's decline changed what their page
   * rendered while their node went on serving the row. This tier had no such contradiction
   * because it had **no consent concept at all** — and that absence is the same failure
   * seen from the other side. The standing rule this file's module comment states in the
   * imperative is that all nodes have equal functionality and only discovery differs; a
   * visitor who can decline beside an operator who cannot is that rule broken, in the
   * direction the whole sovereignty claim rests on.
   *
   * So the choice exists here on identical terms, `ownStartLedger` below is byte-identical
   * to `browser-node.ts`'s, and `serve-agent-hooks.node.test.ts` requires it to stay that
   * way.
   *
   * ## What every site in this repository currently states, and why
   *
   * `'reports-its-own-start'` — which is what the tree already did before this field
   * existed, so threading it changed no behaviour anywhere. That is the same move Plan
   * 24-01 made for `relayAdmission`, and for the same reason: a site that has already
   * written down what it means does not break when somebody starts choosing differently.
   * The withholding arm is not decoration — `packages/node/src/start-reporting.node.test.ts`
   * stands up two real nodes over TCP and reads what each answers a peer that asks.
   *
   * **Not reachable from argv, deliberately, and this is a gap with a name.** `bin/agent.ts`
   * states the open value at its one construction site. An operator who wants the other one
   * edits that line or builds a `FabricNode` themselves; a flag is a separate decision,
   * taken alongside whatever else that entry point learns to say.
   *
   * Per-node **value**, not a node kind — exactly as `sovereignty`, `trustAnchors` and
   * `relayAdmission` are. Every `FabricNode` has the identical executor, transport, relay
   * capability and protocol surface whatever is passed here.
   */
  readonly startReporting: StartReportingConsent
  /** Concurrent reservations to accept from others. Defaults to libp2p's 15. */
  readonly maxReservations?: number
  /**
   * How long a circuit reservation this node grants stays valid — and, since Phase 24,
   * **this node's revocation window.**
   *
   * The subject first, because a docblock whose opening sentence is a security window on a
   * field whose meaning was never stated is a footnote without a text. This is the TTL
   * written into every reservation this node grants, passed straight through to
   * `circuitRelayServer`'s `reservationTtl`. Defaults to
   * {@link RELAY_MAX_RESERVATION_TTL_MS}. A peer holding a reservation is reachable through
   * this node and appears in `reservedPeerIds`, which is what both advertisement surfaces are
   * derived from.
   *
   * ## Why it is also the revocation window, measured rather than assumed
   *
   * {@link FabricNodeOptions.relayAdmission} is consulted at every reservation **grant**.
   * Nothing re-checks a peer mid-reservation — deliberately; a connection-level re-check is a
   * fabric-wide behaviour change of the class this repository has already held for an owner
   * ruling once. So the question that decides whether the window is bounded at all is whether
   * a **renewal** is a grant. `24-CONTEXT.md`'s sub-decision 3 flagged it as a measurement
   * not yet taken and warned that a "no" would make the window unbounded.
   *
   * **Measured 2026-08-06, and the answer is yes**, in
   * `enrol-through-a-closed-door.node.test.ts`. The renewal path is not a special case in
   * libp2p: the joining side re-sends a `HopMessage.Type.RESERVE`, the relay handles it in the
   * same `handleReserve` that calls `denyInboundRelayReservation`, and the server's store only
   * resets its `retimeableSignal` on a grant it actually made. Withdrawing admission from a
   * peer already holding a reservation, changing nothing else, was observed re-consulting the
   * gate at **30 027 ms** and dropping the peer from the store at **40 028 ms** against a
   * 40 000 ms TTL. So the window is the TTL, as a number, and not by construction alone.
   *
   * ## The floor a short TTL cannot buy past
   *
   * Shortening this does **not** shorten the window below 30 s.
   * `@libp2p/circuit-relay-v2`'s transport refreshes at
   * `min(max(expiry - REFRESH_TIMEOUT, REFRESH_TIMEOUT_MIN), 2**31 - 1)` with
   * `REFRESH_TIMEOUT` 5 min and `REFRESH_TIMEOUT_MIN` **30 s** — for any TTL under five
   * minutes the first term is negative and the clamp wins. Below ~30 s a reservation
   * therefore expires before its holder ever tries to renew it, which is churn rather than
   * revocation. That is a property of the installed package, not of this option.
   *
   * ## What this window is not
   *
   * It is not a certificate lifetime, and a lapsed certificate is not cached as a permanent
   * refusal: `PeerVerifier`'s `FINAL` set deliberately excludes `expired`, so an expired
   * verdict is re-askable, and the same reasoning is why this gate re-decides from scratch at
   * every grant instead of memoising.
   */
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
  /**
   * Total connections to keep before the connection manager prunes.
   *
   * Defaults to `max(libp2p's 300, maxReservations * 2)`. Raising `maxReservations`
   * past ~300 without this silently caps the relay: excess peers start cleanly and
   * hold no reservation. See `LIBP2P_MAX_CONNECTIONS` for the measurement.
   */
  readonly maxConnections?: number
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
 * libp2p's own ceiling on a reservation, and therefore the budget this gate lives inside.
 *
 * `@libp2p/circuit-relay-v2/dist/src/constants.js` sets
 * `DEFAULT_RESERVATION_COMPLETION_TIMEOUT = 5_000`, and the **joining** side wraps its whole
 * reserve in `AbortSignal.timeout` of it. A gate that blocks `handleReserve` for longer than
 * that fails the reservation on the client's clock whatever verdict it eventually reaches —
 * so the peer would be refused *without having been judged*, which is a different thing from
 * being refused, and only one of the two is a gate.
 *
 * Not imported, because the package does not export it. Pinned against the installed source
 * by `enrol-through-a-closed-door.node.test.ts`, so a release that moves it fails there
 * loudly instead of turning every number below into an arbitrary one.
 */
const LIBP2P_RESERVATION_COMPLETION_TIMEOUT_MS = 5_000

/**
 * How long the whole admission lookup may take before the peer is refused.
 *
 * Sited against the ceiling above with margin, not chosen by preference. The margin matters:
 * the ceiling is measured on the *joiner's* clock and starts before ours does — it covers
 * opening the connection and writing the RESERVE as well as waiting for our answer — so a
 * budget equal to the ceiling would be a budget that is already over.
 */
export const RELAY_ADMISSION_DEADLINE_MS = 3_500

/**
 * How long one `records` ask may take before it is abandoned and re-issued.
 *
 * **This is a retry interval, not a patience setting, and the difference is the whole design
 * of this gate.** Measured 2026-08-06 in `enrol-through-a-closed-door.node.test.ts`: a
 * `records` request that arrives at a joining peer between `Libp2pTransport.start` — which
 * calls `libp2p.handle`, and is therefore what makes identify advertise `/o2/rpc/1.0.0` — and
 * `serveAgent`'s `onMessage` subscription is delivered into an **empty handler set** and
 * dropped. `Libp2pTransport.#dispatch` is `for (const handler of [...this.#handlers])
 * handler(from, message)`; with no handlers that loop does nothing, no reply is ever written,
 * and the caller can only learn about it by giving up. The request is **destroyed, not
 * delayed**, so waiting longer on the same request cannot ever succeed — only asking again
 * can. In the same measurement the peer became answerable 5 ms after the hook fired, and a
 * second ask was answered in 4 ms with a certificate that verified.
 *
 * That is also the mechanism behind the unexplained 30 s silence `peer-verifier.ts`'s header
 * records from 2026-08-01.
 */
export const RELAY_ADMISSION_ATTEMPT_MS = 700

/** Pause between asks, so a peer that is still starting is not spun on. */
export const RELAY_ADMISSION_RETRY_GAP_MS = 100

/**
 * How many admission decisions a node keeps.
 *
 * A refusal nobody can read is a refusal that cannot be acted on, so the reasons are kept —
 * but this is a per-reservation event on a process meant to run for weeks, and an unbounded
 * array is a leak with a good justification attached. The newest are what an operator or a
 * test is looking at, so the oldest go.
 */
const ADMISSION_LOG_LIMIT = 64

/** What this relay decided about one peer's reservation, and why — AUTH-02 / AUTH-04. */
export interface AdmissionDecision {
  readonly peerId: string
  /** `true` when the reservation was granted. */
  readonly admitted: boolean
  /** Operator-facing, in the register of this fabric's other refusals. */
  readonly reason: string
  /** How many `records` asks it took. `0` when no ask was needed. */
  readonly attempts: number
  readonly ms: number
}

export interface RelayAdmissionGateOptions {
  /** Who this relay admits. `'admits-any-peer'` produces **no gate at all** — see below. */
  readonly admission: RelayAdmission
  /**
   * The endpoint to ask over, as a thunk.
   *
   * A thunk because of a hard ordering fact rather than for taste: `createLibp2p` has to be
   * given its `connectionGater` at construction, and the `RpcEndpoint` does not exist until
   * after `Libp2pTransport.start`, which needs the libp2p node. Returning `null` means "this
   * relay is not serving yet", and that is refused rather than waited on — a relay that
   * cannot ask has not decided.
   */
  readonly rpc: () => RpcEndpoint | null
  readonly deadlineMs?: number
  readonly attemptMs?: number
  readonly retryGapMs?: number
  /** Observes every decision, admitted and refused alike. */
  readonly onDecision?: (decision: AdmissionDecision) => void
}

/**
 * Build the `denyInboundRelayReservation` hook for a relay, or **nothing at all**.
 *
 * ## Why this is a module-level factory
 *
 * So a test can exercise the predicate without standing up a relay. `24-CONTEXT.md` makes
 * that non-discretionary, and the reason is that a predicate reachable only through a live
 * libp2p node is a predicate nobody will test the edges of.
 *
 * ## `'admits-any-peer'` returns `undefined`, and that is not a stylistic choice
 *
 * The open posture supplies **no method**, never a method that returns `false`. The call site
 * in `@libp2p/circuit-relay-v2` is
 * `await this.components.connectionGater.denyInboundRelayReservation?.(connection.remotePeer)`
 * — optional-called — so an absent method is the genuine no-op, byte for byte the behaviour
 * every node in this repository had before this plan. A method that decided to allow is a
 * different thing from a node that was never asked, and only one of them is honest about a
 * benchmark rig: 24-02's pre-gate baseline was taken on a fabric where nothing was consulted,
 * and it stays comparable only while that remains true.
 *
 * ## An empty set admits nobody, and does not spend a round trip finding out
 *
 * `RelayAdmission`'s union exists so that "admit everyone" has a *name* and cannot be arrived
 * at by omission. An empty set is therefore genuinely fail-closed. It is also decidable with
 * no I/O — no certificate can chain to a pinned issuer when nothing is pinned — so this
 * refuses immediately rather than asking a peer a question whose answer cannot matter.
 *
 * ## No admit-while-pending
 *
 * Every path out of the loop below is a decision. A lookup that runs out of budget refuses;
 * it does not fall through to "allow" while something is still in flight. That failure has
 * been found by measurement in this repository once already — an async gate that answers
 * "allow" while a lookup is outstanding is a fail-open hole wearing a gate's clothes.
 *
 * ## What this gate deliberately does NOT reuse
 *
 * `PeerVerifier`, though the two ask the same question over the same wire. Three reasons,
 * each sufficient:
 *
 *   1. **They pin different sets.** `FabricNodeOptions.trustedIssuers` names whose *enrolment
 *      signature* this node will believe about a peer it is already talking to — selection.
 *      `relayAdmission` names whose certificate gets a peer *in at all* — admission. Folding
 *      one into the other is the conflation the union was introduced to prevent.
 *   2. **Their failure dispositions are opposite.** `PeerVerifier.verifiedPeers` is
 *      fail-*open* on an empty anchor set, deliberately and permanently. This is fail-closed.
 *      That asymmetry is written at `RelayAdmission`'s docblock and again at that early
 *      return, and sharing an implementation would be the way it gets "fixed" back.
 *   3. **Its retry floor is longer than this gate's whole budget.**
 *      `DEFAULT_VERDICT_RETRY_FLOOR_MS` is 5 000 ms — sited, correctly for its own purpose,
 *      against the 30 s RPC default. A gate that must settle inside libp2p's 5 s reservation
 *      ceiling cannot wait a floor of that size for a second ask, and the second ask is the
 *      only one that works.
 */
export function relayAdmissionGate(
  options: RelayAdmissionGateOptions,
): ((source: PeerId) => Promise<boolean>) | undefined {
  // The one production caller of the predicate that reads the union. The decision about what
  // the union *means* lives in `@o2/libp2p` and is made once, here, rather than once per
  // reader.
  if (admitsAnyPeer(options.admission)) return undefined

  const issuers = options.admission
  if (typeof issuers === 'string') {
    // **Unreachable today, and fail-closed if it ever stops being.** `admitsAnyPeer` above is
    // the decision; this branch exists only because that predicate returns `boolean` rather
    // than narrowing, and making it a type guard would change an exported signature in
    // `@o2/libp2p` for one call site's convenience.
    //
    // The disposition is the load-bearing part. `RelayAdmission` has exactly one string
    // member today, so nothing reaches here — but if a second is added, this gate does not
    // understand the posture it was handed, and a gate that does not understand its posture
    // must refuse rather than stand aside. Returning `undefined` here would read as tidier
    // and would be a fail-*open* hole opened by a future union member.
    return async (source: PeerId): Promise<boolean> => {
      options.onDecision?.({
        peerId: source.toString(),
        admitted: false,
        reason: `this relay was given an admission posture it does not understand (${issuers}), so it admits nobody`,
        attempts: 0,
        ms: 0,
      })
      return true
    }
  }

  const deadlineMs = options.deadlineMs ?? RELAY_ADMISSION_DEADLINE_MS
  const attemptMs = options.attemptMs ?? RELAY_ADMISSION_ATTEMPT_MS
  const retryGapMs = options.retryGapMs ?? RELAY_ADMISSION_RETRY_GAP_MS

  return async (source: PeerId): Promise<boolean> => {
    const peerId = source.toString()
    const startedAt = Date.now()
    let attempts = 0

    // `true` denies. Naming both arms means neither is the fall-through.
    const decide = (admitted: boolean, reason: string): boolean => {
      options.onDecision?.({ peerId, admitted, reason, attempts, ms: Date.now() - startedAt })
      return !admitted
    }

    if (issuers.size === 0) {
      return decide(false, `this relay pins no certificate issuer, so it admits no peer — ${peerId} refused`)
    }

    // Step 1, and the only thing this gate learns for free: a peer id derived from an
    // Ed25519 key *is* the node key, already proved over Noise. It is what a certificate
    // would have to name, and it is available with no I/O of any kind.
    const expected = nodeKeyForPeerId(peerId)
    if (expected === null) {
      return decide(false, `peer id ${peerId} names no Ed25519 key, so no certificate can be expected of it`)
    }

    const deadline = startedAt + deadlineMs
    let lastReason = `${peerId} was not asked for a certificate within ${deadlineMs}ms`

    while (Date.now() < deadline) {
      const rpc = options.rpc()
      if (rpc === null) {
        lastReason = `this relay was not yet serving when ${peerId} asked for a reservation`
        await new Promise((resolve) => setTimeout(resolve, retryGapMs))
        continue
      }

      attempts += 1
      let body: CanonicalValue | null = null
      try {
        body = await withBudget(rpc.request(peerId, encodeRequest({ kind: 'records', nodeKey: expected })), attemptMs)
      } catch (cause) {
        // The destroyed-request case, and the reason this is a loop. Retry rather than wait.
        lastReason = `${peerId} did not answer a records request within ${attemptMs}ms`
        void cause
      }

      if (body === null) {
        await new Promise((resolve) => setTimeout(resolve, retryGapMs))
        continue
      }

      const response = parseResponse(body)
      if (response === null || response.kind !== 'records') {
        // An answer, just not one to this question. Definitive: a peer that replies with the
        // wrong frame will reply with the wrong frame again.
        return decide(false, `${peerId} answered a records request with ${response === null ? 'an unparseable frame' : `a ${response.kind} frame`}`)
      }
      if (response.records === null) {
        // The peer answered and said it holds nothing. **Definitive, and composing with two
        // measured facts rather than with an assumption:** a peer that enrols after this
        // point gets another verdict at its next reservation, and there are exactly two ways
        // it reaches one — a reconnection, which re-enters this hook off the identify
        // topology event, or a renewal, which re-consults this hook at the 30 s refresh
        // floor. Both were measured on 2026-08-06. Holding the reservation open here in the
        // hope of a certificate arriving would cost every unenrolled peer the full budget and
        // still not be admission.
        return decide(false, `${peerId} holds no provider-issued certificate, so it is not admitted to this relay`)
      }

      const { certificate } = response.records
      if (certificate.nodeKey !== expected) {
        // Not redundant with the signature check below, and the difference is the whole of
        // what admission means: the peer proved possession of exactly one key over Noise, so
        // a certificate naming a different one is somebody else's, presented perhaps by a
        // node that copied it off the wire.
        return decide(
          false,
          `${peerId} presented a certificate for ${certificate.nodeKey}, but its peer id implies ${expected}`,
        )
      }

      const verdict = verifyCertificate(certificate, issuers, Date.now())
      if (!verdict.ok) return decide(false, `${peerId} refused: ${verdict.reason}`)
      return decide(true, `${peerId} holds a certificate from a pinned issuer`)
    }

    // Out of budget. **Refuse.** This is the branch that must never become "allow".
    return decide(false, lastReason)
  }
}

/**
 * Settle `work` within `ms`, or reject.
 *
 * `RpcEndpoint.request` takes no per-request budget — it uses the endpoint's own
 * `timeoutMs`, which on a `FabricNode` defaults to 30 s, six times libp2p's whole reservation
 * ceiling. Racing it is therefore the only way to bound one ask. The loser is left to settle
 * on its own and its rejection is swallowed, because an abandoned ask that rejects later must
 * not surface as an unhandled rejection in an unrelated part of the process.
 */
async function withBudget<T>(work: Promise<T>, ms: number): Promise<T> {
  work.catch(() => {})
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`no answer within ${ms}ms`))
        }, ms)
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
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
  // Three arguments, and the middle one is what holds the user's *private* half: `userKey`
  // comes from it rather than from a field, and it signs the `ownerProof` the authority
  // refuses enrollment without. A `CryptoKeyPair` becomes a `UserSigner` here — the one
  // place this package converts, so nothing downstream has to know which arm was taken.
  const user =
    enrollment.userPrivateKey instanceof Uint8Array
      ? enrollment.userPrivateKey
      : await subtleUserSigner(enrollment.userPrivateKey)
  const request = await requestEnrollment(identity.seed, user, {
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
 * **`extensions: []` is a statement rather than an omission, and the field is required so
 * that it has to be one.** The seam exists so a later build can add a capability field
 * without every older peer reporting the record as `invalid-capability-record`; this build
 * publishes no extension, and says so. Adding one here is a **breaking change for every
 * peer built before the seam existed** — it is the last such change, which is the whole
 * argument for paying for the seam now, and it is not softened by leaving the field off.
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
              // Stated, not omitted — see `fabric-node.ts`'s `ownRecords` doc. A record
              // with none signs the payload it signed before the seam existed.
              extensions: [],
            }),
          },
    withhold,
  })
}

/**
 * The family this node files **its own** start row under — BROW-02.
 *
 * `'other'`, and that is the honest label rather than a placeholder: `BROWSER_FAMILIES`'
 * own comment says *"`other` is not a failure — it is an honest label"*, and a process
 * that is not a browser at all is exactly what it is for.
 *
 * **Not a `'node'` family, deliberately.** The label range is a disclosure boundary —
 * `parseCounts` (`@o2/net`) refuses any label `isStartBrowserLabel` rejects — so an
 * invented family would not widen the range, it would leave this node's row on the floor
 * at the first wire boundary it crossed, silently, with the local report and every merged
 * report disagreeing and nothing naming why. Widening the range is a separate decision and
 * is not taken here.
 *
 * Typed as `BrowserFamily` rather than as a bare string so that renaming the family list
 * is a compile error at this line instead of a row peers quietly drop.
 */
const OWN_START_FAMILY: BrowserFamily = 'other'

/**
 * This node's own start outcome, or the named statement that it has none to report —
 * BROW-02.
 *
 * ## Why a node records a row about itself at all
 *
 * `serveAgent`'s report branch records only what a **peer** told it, so without this a
 * node asked for its counts hands the asker back the asker's own row. `mergeOverlapping`
 * takes the maximum per `(browser, result)` key, so a merged report across two nodes reads
 * 1 and across twenty nodes reads 1 — a metric that cannot exceed the local reading
 * whatever the fabric does. The arithmetic is worked through in
 * `.planning/phases/phase-20-single-job-path-ledger-churn-resilience/20-CONTEXT.md`.
 *
 * ## Why the sentinel arm is a guard and no longer a reachable state
 *
 * A label this build cannot file is not a row: `parseCounts` drops it at the wire, so
 * filing it locally would give this node a report a peer can never corroborate, with the
 * two readings disagreeing and nothing saying which is wrong. A node whose own label is
 * outside the coarse range therefore has **nothing to report**, and says so by name.
 *
 * No node reaches that state now, on either tier, and the tiers arrive at the same place by
 * different routes — which is the standing rule holding rather than breaking. Here
 * {@link OWN_START_FAMILY} is a constant the type checker has already accepted. On the
 * browser tier the label is derived from a user-agent string this build has never seen, and
 * `browserLabel` used to interpolate the major unbounded while `isStartBrowserLabel`
 * admitted four digits — so a five-digit visitor started and reported nothing whatever.
 * That composer is now bounded by `MAX_BROWSER_MAJOR`, the ceiling the predicate is derived
 * from. The arm stays because the parameter is a `string` and this predicate is where the
 * range is enforced; it is defensive, and saying so is cheaper than claiming a reach it
 * does not have.
 *
 * A node reaching this function **started** — there is no path through `#compose` that
 * arrives here otherwise — so the result arm is not a value a caller chooses. That is why
 * it is derived here rather than taken as a `FabricNodeOptions` field; see the plan
 * summary for the measured fan-out a required field would have carried.
 *
 * `browser-node.ts` holds the byte-identical function over its own label, which is the
 * standing rule this file's module comment states in the imperative: all nodes have equal
 * functionality, and a browser label and `'other'` are two values of one field rather than
 * two kinds of node.
 */
function ownStartOutcome(label: string): StartOutcome | 'reports-no-start-outcome' {
  return isStartBrowserLabel(label)
    ? { browser: label, result: { kind: 'started' } }
    : 'reports-no-start-outcome'
}

/**
 * A ledger holding this node's own row, ready for `serveAgent`'s hook — BROW-02, BROW-01.
 *
 * Both arguments are **required unions with named members** and neither is an optional: an
 * omitted one would let this line mean "report nothing" without anything having said so,
 * which is the hole `.planning/PROJECT.md`'s Key Decision *"an optional hook with a
 * silent default is a hole"* names and which this repository has twice measured as
 * `tsc --noEmit` exit 0 beside a failing behavioural assertion.
 *
 * ## Two refusals, kept apart on purpose
 *
 * The body has two guards and they are deliberately not merged into one condition, even
 * though the ledger they produce is identical. They answer different questions and only
 * one of them is the owner's:
 *
 * - `consent` is **may this row leave at all**. It is whoever started this node answering
 *   for it, and it is the whole of BROW-01 at this tier.
 * - `outcome` is **is there a row this build could file**. A label outside the coarse
 *   range is refused by `parseCounts` at the wire, so filing it locally would give this
 *   node a reading no peer can corroborate.
 *
 * Merging them would make a consenting node whose label is unfileable indistinguishable
 * from one that withheld, and the next reader would have one condition to re-derive two
 * meanings from. DATA-10 made the same call for the same reason — a CID-keyed durable set
 * and a payload-keyed job-scoped guard were kept as two mechanisms rather than one.
 *
 * ## Why this tier has the choice at all
 *
 * Because the standing rule is that **all nodes have equal functionality and only
 * discovery differs**, and BROW-01 was found as a browser-tier defect. A tab whose visitor
 * can decline, beside a server process that cannot, would be that rule broken in the
 * direction this project's whole claim rests on. The label a node files is a per-node
 * value — `'other'` here, a visitor's family there — and so is whether it files one.
 *
 * `browser-node.ts` holds the byte-identical function.
 */
function ownStartLedger(
  outcome: StartOutcome | 'reports-no-start-outcome',
  consent: StartReportingConsent,
): StartOutcomeLedger {
  const held = new StartOutcomeLedger()
  if (consent === 'withholds-its-own-start') return held
  if (outcome !== 'reports-no-start-outcome') held.record(outcome)
  return held
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
   * Who advertises a block, and what a node's signed records say — SCHED-01, NET-06.
   *
   * The **asking** index, reaching past this node's own connections through the DHT and
   * falling back to the peers it is connected to. Deliberately not the same object as the
   * one `serveAgent` answers from: see the composition site for why a serving index that
   * walked the DHT would not terminate.
   */
  readonly recordIndex: RecordIndex
  /**
   * The local tier, without network fallback.
   *
   * Typed as the port, not as the adapter: nothing outside this file needs to know
   * whether the blocks are on disk or in a heap, and a caller that could ask would
   * be one kind-check away from behaving differently on the answer.
   */
  readonly store: Blockstore
  /**
   * This node's Kademlia handle, typed — SCHED-01 / NET-06.
   *
   * `libp2p` above is exposed as the widened `Libp2p`, whose `services` is an open map, so
   * a caller reaching through it holds `unknown` and can do nothing with it that does not
   * involve an assertion. Naming the service here is what lets a caller — or a case — build
   * a second index over the same keyspace, which is how *"the DHT carried this answer"* is
   * told apart from *"the RPC fallback did"*.
   */
  readonly dht: KadDHT
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
  readonly #maxConnections: number
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
  /** See {@link registrationRefusal}. Mutable because it is written once, after start. */
  #registrationRefusal: string | undefined
  readonly #publisher: RecordPublisher | null
  readonly #announcer: DhtProviderAnnouncer
  /**
   * BROW-02 — what this node has been told about how starting went, including its own row.
   *
   * Private, and the reading is {@link startReport}. A public field would hand a caller
   * `record` and `mergeOverlapping`, so reading what a peer said would be one property
   * access away from writing it — and this ledger is unauthenticated wire input, which is
   * the one thing that must not also be locally writable by whoever renders it.
   */
  readonly #startLedger: StartOutcomeLedger
  /**
   * AUTH-02 — what this relay decided about the reservations it was asked for.
   *
   * **A refusal nobody can read is a refusal nobody can act on**, and until this existed the
   * relay's side of admission was a boolean returned into libp2p and lost. The joining side
   * already had its half — libp2p reports `reservation failed with status PERMISSION_DENIED`
   * and `classifyReservationFailure` turns it into a named `refused` — but that tells the
   * refused peer only *that* it was refused, never *why*, and the why is knowable only here.
   *
   * The array is the live one the gate appends to, exposed through
   * {@link admissionDecisions} as a copy so a caller cannot rewrite this node's own record of
   * who it turned away.
   */
  readonly #admissionLog: readonly AdmissionDecision[]

  private constructor(parts: {
    libp2p: Libp2p
    transport: Libp2pTransport
    rpc: RpcEndpoint
    egress: EgressGuard
    blockstore: FetchingBlockstore
    recordIndex: RecordIndex
    store: Blockstore
    dht: KadDHT
    publisher: RecordPublisher | null
    announcer: DhtProviderAnnouncer
    executor: GovernedExecutor
    counter: CountingExecutor
    governor: DutyCycleGovernor
    compute: WorkerExecutor
    admission: LocalCapacity
    limit: number
    pending: number
    inboundPerSecond: number
    maxConnections: number
    identity: NodeIdentity
    authority: EnrollmentAuthority | null
    certificate: NodeCertificate | null
    verifier: PeerVerifier
    relayFailures: readonly RelayDialFailure[]
    sovereignCids: SovereignCids | 'forgets-sovereignty-between-jobs'
    startLedger: StartOutcomeLedger
    admissionLog: readonly AdmissionDecision[]
  }) {
    this.libp2p = parts.libp2p
    this.transport = parts.transport
    this.rpc = parts.rpc
    this.egress = parts.egress
    this.blockstore = parts.blockstore
    this.recordIndex = parts.recordIndex
    this.dht = parts.dht
    this.#publisher = parts.publisher
    this.#announcer = parts.announcer
    this.store = parts.store
    this.executor = parts.executor
    this.#counter = parts.counter
    this.#governor = parts.governor
    this.#compute = parts.compute
    this.admission = parts.admission
    this.#limit = parts.limit
    this.#pending = parts.pending
    this.#inboundPerSecond = parts.inboundPerSecond
    this.#maxConnections = parts.maxConnections
    this.#identity = parts.identity
    this.#authority = parts.authority
    this.certificate = parts.certificate
    this.#verifier = parts.verifier
    this.#admissionLog = parts.admissionLog
    this.#relayFailures = parts.relayFailures
    this.#sovereignCids = parts.sovereignCids
    this.#startLedger = parts.startLedger
  }

  /**
   * What this node has been told about start outcomes, its own row included — BROW-02.
   *
   * Readable without a round trip, which is the whole reason it is here: a caller that
   * already holds this node can render what its peers reported to it without asking the
   * fabric for something the fabric just told it.
   *
   * **Reading cannot mutate.** `report()` computes a fresh {@link StartReport} — plain
   * data with no methods and no reference back to the ledger — so a caller holding one
   * cannot add a row, and two calls a second apart are two independent snapshots rather
   * than two views of one object.
   *
   * A node that has been told nothing still reports **one**: its own start, recorded at
   * construction. That is the difference between this and every earlier build, where a
   * peer asking any node in this repository was answered `counts: []`.
   */
  get startReport(): StartReport {
    return this.#startLedger.report()
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
    // SCHED-01 — the local-only tier, wrapped so the provider announcer learns what this
    // node comes to hold. **It announces nothing here**, and cannot: `libp2p.services.dht`
    // does not exist until `createLibp2p` below, which needs the identity that is read
    // beside these very blocks. `observeWith` is called once the DHT exists and replays
    // whatever was put in between, so nothing put during start is unaccounted for. See
    // `dht-provider-announcer.ts`'s header for why the moment a block arrives is the one
    // moment a node must not advertise it.
    const store = new ObservingBlockstore(
      options.blockstoreDir === undefined
        ? new MemoryBlockstore()
        : await FsBlockstore.open(options.blockstoreDir),
    )

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
    const limit = canRelay ? (options.maxReservations ?? O2_MAX_RESERVATIONS) : 0
    // Coupled deliberately — see the options' documentation.
    const pending =
      options.maxIncomingPendingConnections ??
      Math.max(LIBP2P_MAX_INCOMING_PENDING_CONNECTIONS, limit)
    const inboundPerSecond =
      options.inboundConnectionThreshold ??
      Math.max(LIBP2P_INBOUND_CONNECTION_THRESHOLD, limit)
    // The ceiling the other three never reach. Reservations and everything this node
    // dials for itself — DHT queries, job traffic — come out of ONE budget, so sizing
    // it at the reservation count alone would leave a full relay unable to dial at all.
    // Doubling is the simplest split that keeps a reserved-to-capacity relay working,
    // and it is a choice rather than a derivation.
    const maxConnections =
      options.maxConnections ?? Math.max(LIBP2P_MAX_CONNECTIONS, limit * 2)

    // AUTH-02 / AUTH-04 — **the whole of arming the door, and it is one key below.**
    //
    // The gate goes on `createLibp2p`'s top-level `connectionGater` and **not** into
    // `circuitRelayServer`'s arguments, which keep taking capacity limits and nothing else.
    // That separation is deliberate and is guarded: capacity is about how many, admission is
    // about who, and a relay that refuses for one reason while an operator reads the other is
    // the ambiguity NET-05 exists to remove.
    //
    // `relayAdmissionGate` returns `undefined` for `'admits-any-peer'`, and the conditional
    // spread means the *method is absent* rather than present-and-permissive — see that
    // factory's docblock for why a node that was never asked and a node that decided to allow
    // must not be the same thing.
    //
    // The `rpc` thunk is forced by ordering: the endpoint is built ~200 lines below, out of a
    // transport that needs the node this call is creating.
    let serving: RpcEndpoint | null = null
    const admissionLog: AdmissionDecision[] = []
    const gate = relayAdmissionGate({
      admission: options.relayAdmission,
      rpc: () => serving,
      onDecision: (decision) => {
        // Bounded, because this is a per-reservation event on a long-lived process and an
        // unbounded array is a leak with a good reason attached. The newest are what an
        // operator or a test is looking at.
        admissionLog.push(decision)
        if (admissionLog.length > ADMISSION_LOG_LIMIT) admissionLog.splice(0, admissionLog.length - ADMISSION_LOG_LIMIT)
      },
    })

    const libp2p = await createLibp2p({
      // AUTH-01. Without this line libp2p mints a fresh ephemeral key on every start, so
      // a node has no identity that outlives its process and no certificate could refer
      // to it — which is exactly what every start did before this phase.
      privateKey: identity.privateKey,
      ...(gate === undefined ? {} : { connectionGater: { denyInboundRelayReservation: gate } }),
      ...(options.datastore === undefined ? {} : { datastore: options.datastore }),
      addresses: {
        listen,
        // Absent rather than empty when unset, and the reason is *not* that an empty array
        // would behave differently — it would not. `address-manager/index.js:55` defaults
        // `appendAnnounce` to `[]` and `:275` only folds the list in when it is non-empty,
        // so the two are indistinguishable at runtime. The conditional spread is here so a
        // node that never asked for this option builds the same config object it built
        // before the option existed, which is the property a regression reads.
        ...(options.appendAnnounce === undefined
          ? {}
          : { appendAnnounce: [...options.appendAnnounce] }),
      },
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
        maxConnections,
        maxIncomingPendingConnections: pending,
        // Per *host*, so a burst of tabs from one machine — or of volunteers behind
        // one NAT — would otherwise be rejected mid-handshake.
        inboundConnectionThreshold: inboundPerSecond,
      },
      services: {
        identify: identify(),
        identifyPush: identifyPush(),
        ping: ping(),
        // SCHED-01 / NET-06 — the fabric's own keyspace, on its own wire.
        //
        // **`clientMode` is stated, and that is a correctness requirement rather than a
        // style rule.** Left unset, `@libp2p/kad-dht` installs a `self:peer:update`
        // listener that promotes to server mode on any address passing
        // `!isPrivate(ma) && !Circuit.exactMatch(ma)` — measured 2026-08-14, see
        // `.planning/consults/2026-08-14-kad-dht-server-mode-promotion.md`. That predicate
        // reads the *relay's* address for a relayed peer, so an unset `clientMode` makes a
        // node's DHT role follow whichever relay answered first, with nothing in the code
        // saying so. Here it follows the same fact the relay server follows.
        //
        // **`canRelay` means "binds a listening socket", NOT "a browser can dial me".**
        // The same measurement showed the default `/ip4/127.0.0.1/tcp/0` satisfies
        // `canRelay` and does *not* satisfy kad's own promotion predicate, because
        // loopback is private. A node serving records to its LAN peers over TCP is the
        // intent here; reachability from a tab is a separate question this flag does not
        // answer and does not claim to.
        dht: kadDHT({
          protocol: O2_KAD_PROTOCOL,
          // **`peerInfoMapper`, and leaving it unset made the whole keyspace inert.**
          // Measured 2026-08-23 on two nodes on loopback: both promote to `server`, both
          // advertise `/o2/kad/1.0.0`, identify completes and each holds the other as a
          // peer — and a `put` yields **no events at all** while `getClosestPeers` never
          // returns. The routing tables were empty. `kad-dht` defaults
          // `peerInfoMapper` to `removePrivateAddressesMapper` (`src/kad-dht.ts:179`), and
          // `onPeerConnect` drops any peer left with zero addresses after mapping
          // (`:403-406`), so **every peer whose only address is private was silently never
          // added.**
          //
          // That default is correct for Amino, whose whole point is a public network, and
          // wrong for this one. `/o2/kad/1.0.0` is a *private* keyspace whose membership is
          // decided by a certificate, not by address class: its peers are on loopback in
          // tests, on a LAN in the multi-machine demo, and behind a relay in every browser
          // tab. `removePublicAddressesMapper` — kad-dht's own suggestion for a LAN DHT —
          // would be the same mistake mirrored. `passthroughMapper` is what says the fabric
          // decides who is in it.
          //
          // What this does **not** do is admit anybody: `relay-admission.ts` and the
          // certificate gate are unchanged, and a peer that reaches a routing table still
          // has to verify to be dispatched to.
          peerInfoMapper: passthroughMapper,
          clientMode: !canRelay,
          // NET-06 — provider-record lifetime, stated for the same reason `clientMode` is.
          //
          // Left unset the fabric inherits 48 h / 1 h / 24 h, which are sited against a
          // long-running IPFS daemon. `providerRecordPolicy` derives all three from one
          // number so the staleness bound stays `1.25 × validity` rather than becoming an
          // accident between three independently-chosen figures. The reading that makes
          // this necessary — that `providers.provideValidity` is declared, spread in, and
          // read by nothing, while the honoured knob lives in `reprovide` — is in the
          // constant's own docblock, because this project drew the wrong conclusion from
          // it twice.
          reprovide: providerRecordPolicy(options.providerRecordValidityMs),
          // Mandatory, not optional: kad-dht dispatches a validator on the key's
          // namespace and `put` throws `No validator available for key type "o2"`
          // without one. It is also the gate that makes `/o2/<nodeKey>` ownable — see
          // `o2RecordValidator`'s own doc for what a disinterested storer can and
          // cannot check.
          validators: { [O2_RECORD_NAMESPACE]: o2RecordValidator(() => Date.now()) },
          // Registering `validators` without `selectors` makes a keyspace that accepts
          // every write and errors on every read — `bestRecord` throws
          // `MissingSelectorError` when the namespace is unknown, and `DhtRecordIndex`'s
          // own catch turns that into a silent *"the DHT holds nothing"*. Measured
          // 2026-08-23; see `o2RecordSelector` for the rule and for how it presented.
          selectors: { [O2_RECORD_NAMESPACE]: o2RecordSelector },
        }),
        // NET-03. Three services rather than one, because AutoTLS is an orchestrator over
        // capabilities libp2p does not install by default:
        //
        // - `keychain` holds the ACME account key and the certificate key. Without it
        //   AutoTLS refuses to start — it names `@libp2p/keychain` in its own
        //   `serviceDependencies` — and, more to the point, a fresh account key per start
        //   would order a new certificate on every restart.
        // - `http` is where the forge request is made from. AutoTLS reads it off
        //   `components.http`, which libp2p core does not provide; a service registered
        //   under that name is what supplies it.
        //
        // **`autoConfirmAddress` is stated as `true`, and that is a decision rather than a
        // convenience.** Left false, AutoTLS adds `@libp2p/autonat` to its dependencies and
        // will not start without it, because it wants a *third party* to confirm the
        // address it is about to certify. This node's addresses are not observed — they are
        // the ones an operator wrote into `listen`/`announce` — so there is nothing for
        // AutoNAT to add here beyond a dependency and a start-up delay. A deployment that
        // wants observed-address verification should add AutoNAT and reconsider this line;
        // nothing else in the file depends on it.
        ...(options.autoTls === undefined
          ? {}
          : {
              keychain: keychain(),
              http: http(),
              // **The cast is over an optionality TypeScript cannot see through, and it
              // widens nothing.** `AutoTLSComponents` declares `keychain` and `http` as
              // *required*, while libp2p types every member of a conditionally-spread
              // service map as *optional* — so the compiler reads a node that might have
              // `autoTLS` without `keychain`. That node cannot exist: the three are spread
              // by one ternary and arrive together or not at all. `unknown` rather than
              // `any` because a function taking `unknown` is assignable to one taking
              // anything, which is exactly the contravariance being asserted, and because
              // no `any` appears in this package's production source.
              autoTLS: autoTLS({
                autoConfirmAddress: true,
                ...(options.autoTls.acmeDirectory === undefined
                  ? {}
                  : { acmeDirectory: options.autoTls.acmeDirectory }),
                ...(options.autoTls.forgeEndpoint === undefined
                  ? {}
                  : { forgeEndpoint: options.autoTls.forgeEndpoint }),
                ...(options.autoTls.forgeDomain === undefined
                  ? {}
                  : { forgeDomain: options.autoTls.forgeDomain }),
                ...(options.autoTls.provisionDelayMs === undefined
                  ? {}
                  : { provisionDelay: options.autoTls.provisionDelayMs }),
                ...(options.autoTls.provisionTimeoutMs === undefined
                  ? {}
                  : { provisionTimeout: options.autoTls.provisionTimeoutMs }),
              }) as unknown as (components: unknown) => AutoTLS,
            }),
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
    // AUTH-02 — the gate's `rpc` thunk resolves from here on. Before this line it answers
    // `null`, which the gate treats as *"this relay is not serving yet"* and **refuses**
    // rather than waits on: a relay that cannot ask a peer anything has not decided anything,
    // and the one disposition a gate may never take is to admit while it does not know.
    //
    // The window is real but narrow and it is on the relay's own start, not the joiner's — a
    // relay is normally listening for minutes before anyone dials it.
    serving = rpc

    // AUTH-01 / AUTH-04 — the provider signing key, when this process was told to hold
    // one. A **separate file** from `.identity.key`, so `issuerKey !== nodeKey` always
    // holds; and generated on-device, because no option in this phase accepts key material
    // and argv is world-readable in `ps` (17-CONTEXT.md decision 6).
    //
    // The two *optional* issuance numbers — `maxPerWindow` and `windowMs` — are left
    // exactly as `enrollment.ts` declares them. Cited rather than restated: nothing in
    // this phase's criteria asks for other numbers, a knob nobody sets is a knob that
    // drifts from the tests, and a value copied into a comment is a value that can
    // disagree with its source. `certificateLifetimeMs` is left alone for a stronger
    // reason — the owner's 2026-08-02 correction rules certificate lifetimes out of the
    // cost argument entirely, so a knob here would invite exactly the tuning it forbids.
    //
    // **AUTH-04, and this is the line that turns the mechanism on in production.** Both
    // required options carried a named sentinel for one wave; both now carry the real
    // thing.
    //
    //   - the **budget** comes from the caller, because `FabricNodeOptions` cannot express
    //     a provider that never stated one (see `issuesCertificates`). There is no default
    //     here and there must not be: a defaulted budget is a policy nobody chose.
    //   - the **history** is a file under this node's own `<dir>`, beside `.identity.key`
    //     and `.provider.key`, carrying exactly the authority the filesystem permissions
    //     there already carry. `FsIssuance`'s header has the argument for why it is not a
    //     wire frame; the short form is that `serveAgent` serves enrolment
    //     unauthenticated.
    //
    // **A node with no `blockstoreDir` says so by name rather than falling back quietly.**
    // It has nowhere durable to write, exactly as it has nowhere to persist its identity
    // seed or its sovereign-CID set, and the sentinel is what makes that a reading rather
    // than an absence a reader has to infer — the identical shape `sovereignCids` uses a
    // few lines below. Reaching that arm reproduces Phase 17's measured defect exactly,
    // which is why it has to be asked for rather than arrived at.
    const authority =
      options.issuesCertificates === undefined
        ? null
        : new EnrollmentAuthority({
            providerPrivateKey:
              options.blockstoreDir === undefined
                ? generateSeed()
                : await loadOrCreateSeed(options.blockstoreDir, PROVIDER_FILE),
            maxIssuedPerWindow: options.issuesCertificates,
            issuance:
              options.blockstoreDir === undefined
                ? ('remembers-only-within-this-process' as const)
                : // The retained window is `enrollment.ts`'s own default, read from the
                  // module the authority defaults from rather than restated here, so the
                  // record cannot compact past a bound the authority still consults.
                  await FsIssuance.open(options.blockstoreDir, {
                    retainMs: DEFAULT_ISSUANCE_WINDOW_MS,
                  }),
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

    // SCHED-01 / NET-06 — this node's *asking* index, reaching past its own connections.
    //
    // **The serving side is untouched**: `serveAgent` still gets `index: records`, the
    // `SelfRecordIndex` built from this node's own store. That separation is load-bearing.
    // If the serving index were this one, a peer asking us about node X would make us walk
    // the DHT on X's behalf — the recursive-fetch shape `Blockstore.has`'s docblock
    // records, where two nodes pointed at each other handed one another the same pending
    // promise and neither could ever answer. `SelfRecordIndex` answers about itself and
    // nothing else, which is what terminates.
    //
    // Both composition arguments are required by the type, so this cannot be built to
    // answer *less* than the RPC index alone already answers.
    const pinnedIssuers = new Set(options.trustedIssuers ?? [])
    const rpcIndex = new RpcRecordIndex(rpc, () => verifier.verifiedPeers)
    const recordIndex = new DhtRecordIndex({
      dht: libp2p.services.dht,
      providersFrom: rpcIndex,
      recordsFallback: rpcIndex,
      // A DHT is untrusted transport: a value proves nothing by being stored, only by
      // verifying. The `nodeKey` clause is the one that matters here — both signatures can
      // be valid on a record that is simply about somebody else, and a DHT read is exactly
      // where that arrives, because the key is chosen by whoever wrote the value.
      verify: (nodeKey, found) =>
        found.certificate.nodeKey === nodeKey &&
        verifyCertificate(found.certificate, pinnedIssuers, Date.now()).ok &&
        verifyCapabilityRecord(found.capabilities, Date.now()),
      timeoutMs: DHT_QUERY_TIMEOUT_MS,
      // A requestor is not its own candidate — see `DhtRecordIndexOptions.self`.
      self: identity.nodeKey,
      // Without this a lookup yields a node key libp2p holds no address for, and the
      // candidate is undialable — a successful discovery that cannot be acted on.
      addresses: (info) => {
        void libp2p.peerStore.merge(info.id, { multiaddrs: info.multiaddrs }).catch(() => {})
      },
    })



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

    // AOT-04 — this node runs both ABIs, and **the artifact chooses, never the node**.
    // There is no `--wasi` flag on `bin/agent.ts`, no second factory and no option: a
    // node's capability is not a property of how it was started. The module's own
    // declared import namespace decides which host object it meets, and
    // `WebAssembly.instantiate` remains the sandbox either way — routing wrongly costs
    // one honest instantiation failure naming the missing import and cannot produce a
    // wrong result. `abi-router.ts` carries the full argument.
    //
    // **Innermost, deliberately.** Everything outside these parentheses is unchanged,
    // so the sovereignty gate and the provenance guard apply to a translated artifact
    // exactly as they do to a source-compiled one. That is half of what "the same
    // admission and verification path" means, and composing the router *outside*
    // either of them would quietly exempt translated work from a guard this project
    // treats as unconditional. `fabric-node.node.test.ts`'s DATA-09 block dispatches a
    // sovereign WASI task for precisely that reading — the native assertions beside it
    // cannot tell the two compositions apart, because `guardSovereignty` returns
    // before `inner.execute` and the native arm stays guarded either way.
    //
    // The router compiles to decide and never instantiates, so "refused before
    // instantiation" is untouched: provenance is still the last guard before the
    // executor that reaches `WebAssembly.instantiate`, and the router sits beneath it.
    //
    // **The asymmetry here is within one node, not between kinds.** `compute` is the
    // killable thread (BROW-04/SCHED-06), so a native module runs there and a WASI
    // module runs inline on this thread — which means the per-task wall-clock deadline
    // bounds the native arm and **does not bound the WASI arm**. Stated rather than
    // discovered: a WASI guest that never returns holds this thread, and nothing here
    // can interrupt it. It cannot be fixed at this line — `WorkerExecutor` posts to a
    // thread running `@o2/core`'s `runTask`, and `@o2/core` may declare no dependency
    // on any other `@o2` package at all (`purity.node.test.ts`), so the killable path
    // cannot reach
    // `WasiExecutor` from where it stands. Closing it means moving the ABI choice into
    // `runTask`, which is a change to the kernel's dependency shape and not to this
    // composition. **`browser-node.ts` carries the identical bound and the identical
    // gap**, so this is one node's asymmetry between two artifacts, not a difference
    // in capability between a tab and a server.
    //
    // **Reachability, recorded here so Phase 22 does not rediscover it as a finding.**
    // The router is reachable from `bin/agent.ts` (through this factory) and from the
    // browser demo (through `BrowserNode.start`). It is deliberately **not** reachable
    // from `bin/bench.ts`, which constructs `WasmExecutor` directly at three sites
    // because that benchmark measures the native ABI on purpose. That is a decision.
    // What is **not** established is that no *other* construction path can yield a
    // node running one ABI and not the other: `task-worker.ts`,
    // `task-executor.worker.ts` and those three bench sites all still build bare
    // native executors, and this comment is a note rather than a guard. A
    // source-scanning check in `purity.node.test.ts`'s style would be the guard.
    const abi = new AbiExecutor({
      blockstore,
      native: compute,
      wasi: new WasiExecutor({ nodeId: libp2p.peerId.toString(), blockstore }),
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
    // provenance, provenance innermost — now against the ABI router rather than
    // directly against `compute`, with the router delegating to `compute` or to the
    // WASI executor. No guard moved and none was added between them.
    const counter = new CountingExecutor(guardSovereignty(provenance(abi), sovereignty))
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

    // BROW-02 — this node's own serve-side ledger, holding this node's own row.
    //
    // **Both halves are needed and neither is sufficient.** Handing `serveAgent` a real
    // ledger stops the report branch answering `counts: []`; recording this node's own
    // outcome into it is what lets a peer that asks learn something it did not itself
    // supply. Without the second, `serveAgent` holds only what peers told it, a peer
    // asking is handed back its own row, and `mergeOverlapping`'s maximum-per-key makes
    // every merged report read 1 however many nodes are running.
    //
    // Both arguments are stated rather than defaulted: `ownStartOutcome` returns a required
    // union whose other arm is a named sentinel, so a node with nothing fileable to report
    // says so by name rather than by an absent row — and `startReporting` is whoever started
    // this node answering for it, required on this interface for the same reason.
    //
    // BROW-01 — **this is the line the choice has to reach.** One tier over it was found
    // not reaching it, which made a visitor's opt-out cosmetic; here the choice did not
    // exist to reach anything, which is the same failure seen from the other side. See
    // `FabricNodeOptions.startReporting`.
    const startLedger = ownStartLedger(ownStartOutcome(OWN_START_FAMILY), options.startReporting)

    // ── SCHED-01 / NET-06 — the two halves that make the DHT something this node USES ──
    //
    // Constructed here, before the node, so both are readable off it; started below, once
    // there is a node for a refusal to be recorded against.

    // Registration. This node puts its own signed records into the fabric's keyspace under
    // its own key, so a peer that has never met it can still find out what it can run.
    //
    // **Published from the same object that serves them.** `records` is the
    // `SelfRecordIndex` handed to `serveAgent`, so what goes into the DHT and what this
    // node answers over RPC cannot come to disagree — there is one source, read twice.
    //
    // A node holding no certificate has nothing to register: there is no signed statement
    // of who it is, so there is no record for the keyspace to be about. It still serves.
    const ownRecordsForDht = certificate === null ? undefined : await records.recordsFor(certificate.nodeKey)
    const publisher =
      ownRecordsForDht === undefined
        ? null
        : new RecordPublisher(libp2p.services.dht, ownRecordsForDht)

    // Provider announcement — owner ruling of 2026-08-23.
    //
    // `DhtRecordIndex.providers` unions what `findProviders` answers with what the RPC
    // index answers, and nothing in this repository had ever called `dht.provide` — so the
    // first half of that union was empty by construction and the DHT could only ever
    // restate what this node already knew from the peers it was connected to.
    //
    // **The predicate is the value the serving index was given, not a second construction
    // of the same idea.** `withholdingFrom`'s own docblock says why: holding an invariant
    // between two branches means asking one question twice, not writing the question down
    // twice — and a provider record is read by strangers and outlives the query that made
    // it, so it is where a second, agreeing-today copy would cost the most.
    const announcer = new DhtProviderAnnouncer({
      dht: libp2p.services.dht,
      withhold: withholdingFrom(egressDisposition),
    })
    store.observeWith((cid) => {
      announcer.observe(cid)
      // Peer arrival covers the blocks a node already holds; this covers the peers it
      // already has. A requestor connects and *then* stores its module and inputs, so
      // without this every block it holds would be stored after its last arrival and
      // never announced. Collapsed to one sweep per turn — see `sweepSoon`.
      announcer.sweepSoon()
    })

    const node = new FabricNode({
      libp2p,
      transport,
      rpc,
      egress,
      blockstore,
      recordIndex,
      store,
      dht: libp2p.services.dht,
      publisher,
      announcer,
      executor,
      counter,
      governor,
      compute,
      admission,
      limit,
      pending,
      inboundPerSecond,
      maxConnections,
      identity,
      authority,
      certificate,
      verifier,
      relayFailures,
      sovereignCids,
      startLedger,
      admissionLog,
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
      // SCHED-03. The posture the operator stated, or the named opt-out — never an
      // omission, because `AgentOptions.paused` has no default to fall through to.
      //
      // **This is not the capacity hook one line up and must never be folded into it.**
      // `LocalCapacity.slots` floors at 1 precisely so that throttling cannot express a
      // stop — *"at zero slots `#decide` would refuse everything, which is a node that
      // has left rather than a node that is going slowly"* — so the two answer different
      // questions and a paused node states its capacity unchanged while declining.
      //
      // A per-node setting, not a node kind: `browser-node.ts` threads the identical
      // ternary over its own option, and `serve-agent-hooks.node.test.ts` counts both.
      paused: options.paused ?? 'never-pauses',
      reservations: () => node.reservedPeerIds,
      // BROW-02. **The named opt-out is gone from this file**, because there is no longer
      // a node this factory can build that has been told nothing: every node holds a
      // ledger and every node's own start is the first row in it. See the construction
      // above for why the own row is the load-bearing half.
      //
      // (The opt-out literal is described rather than written out, deliberately, and this
      // paragraph tripped over it on first draft. `serve-agent-hooks.node.test.ts` counts
      // raw text across the whole of this file, comments included, and now requires
      // **zero** occurrences of it here — the same rule the `capacity:` block in
      // `browser-node.ts` and `trust-anchors.node.test.ts` already write down for their
      // own matchers: the instrument cannot tell a construction from a mention.)
      //
      // A per-node holding, not a node kind: `browser-node.ts` passes the identically
      // named value derived by the identical pair of functions over its own label, and
      // that guard counts both. Any node may hold one, on the same terms as any other —
      // the only difference between nodes is discovery.
      ledger: startLedger,
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

    // Started here, and the trigger is start **and every peer arrival** rather than start
    // alone.
    //
    // **Publishing once registered nothing, and the comment this replaces called that an
    // acceptable start.** It is not. A put against an empty routing table does not merely
    // time out, it *succeeds*: `kad-dht` writes the record to the local datastore before it
    // walks to the closest peers (`content-fetching/index.ts:149-158`), so the one-shot
    // reported success, reached nobody, and left the record in the only place that already
    // had it. Every `dht.get` from every other node therefore missed and `DhtRecordIndex`
    // degraded to its RPC fallback — silently, and always.
    //
    // `peer:identify` rather than `peer:connect`: kad-dht populates its routing table
    // through a topology registered on the DHT protocol, and a topology fires once identify
    // has said which protocols the peer speaks. A put on `peer:connect` walks a table the
    // arriving peer is not in yet. The announcer sweeps on the same signal for the same
    // reason — an announcement is a walk of that same table. Nothing here is timed.
    //
    // Not awaited, and failure is not fatal: `publishRecords` returns its refusal rather
    // than throwing, because a node whose DHT is not reachable yet is a working node that
    // still answers records over RPC to anyone who asks it directly.
    const onPeerArrival = (listener: () => void): (() => void) => {
      const onIdentify = (): void => {
        listener()
      }
      libp2p.addEventListener('peer:identify', onIdentify)
      return () => {
        libp2p.removeEventListener('peer:identify', onIdentify)
      }
    }
    if (publisher !== null) {
      undo.push(() => {
        publisher.stop()
      })
      void publisher.start(onPeerArrival).then((outcome) => {
        if (outcome.kind === 'refused') node.noteRegistrationRefused(outcome.reason)
      })
    }
    const stopSweeping = onPeerArrival(() => {
      void announcer.sweep()
    })
    undo.push(stopSweeping)

    // NET-05 — the two halves of relay discovery, joined here and nowhere else.
    //
    // A node that binds a listening socket is the one whose certificate says `'seed'`
    // (`discoverability: canRelay ? 'seed' : 'via-relay'` above), so `canRelay` decides
    // which half this process performs. There is no third case and no option: a node
    // either offers the service or looks for it.
    //
    // **Announcing.** One `provide` of the well-known key. It is not repeated on a timer
    // because it does not have to be — kad-dht's reprovider republishes a node's *own*
    // provider records within `threshold` of expiry and exempts them from the sweep, which
    // is the one place its `isSelf` branch is what keeps a record alive. Not awaited and not fatal: a
    // relay whose keyspace is not reachable yet is a working relay, and everything that
    // reaches it by configured address is untouched.
    //
    // **Looking.** Bounded by `RELAY_RESERVATION_TARGET`, which is a divisor on the
    // fabric's own capacity rather than a preference — that constant carries the
    // arithmetic. Re-run on peer arrival for the same reason registration is: the first
    // attempt happens against a routing table that may still be empty, and a relay this
    // node could use may only become findable once a third node has joined.
    if (canRelay) {
      // **Re-announced on peer arrival, and a one-shot here was written first and was
      // wrong in exactly the way registration was.** `provide` walks to the closest peers;
      // at start there are none, so the walk either blocks until the first peer arrives or
      // completes against whoever was there then — and every node that joins afterwards
      // never hears it. Measured: with a single start-time announcement,
      // `relay-discovery.node.test.ts` timed out at 40 s having found nothing.
      //
      // kad-dht's reprovider does republish a node's own provider records, but on its own
      // clock — a quarter of `PROVIDER_RECORD_VALIDITY_MS`, so fifteen minutes. That is a
      // durability mechanism, not a joining one.
      let announcing: Promise<void> | null = null
      const announceRelayService = (): void => {
        if (announcing !== null) return
        announcing = (async () => {
          try {
            for await (const _event of libp2p.services.dht.provide(await relayServiceCid())) {
              // Events are progress. `provide` reports success by not throwing.
            }
          } catch {
            // A relay that could not announce is still a relay to everyone holding its
            // address. Counted nowhere on purpose: there is no reading this would support
            // that `registrationPeers` does not already give.
          } finally {
            announcing = null
          }
        })()
      }
      announceRelayService()
      const stopAnnouncing = onPeerArrival(announceRelayService)
      undo.push(stopAnnouncing)
    } else {
      const topUp = async (): Promise<void> => {
        await topUpRelays({
          target: RELAY_RESERVATION_TARGET,
          // An approximation, and stated as one: a relay may publish more than one circuit
          // address for this node, so this can over-count and stop early. Over-counting
          // spends fewer slots than the target rather than more, which is the safe
          // direction for a number whose whole purpose is to be a ceiling.
          reserved: () =>
            libp2p.getMultiaddrs().filter((ma) => ma.toString().includes('/p2p-circuit')).length,
          discover: () => discoverRelays({ index: recordIndex, self: identity.nodeKey }),
          connect: async (nodeKey) => {
            const spelling = peerIdForNodeKey(nodeKey)
            if (spelling === null) return
            const peerId = peerIdFromString(spelling)
            // Connecting is what reserves — the `/p2p-circuit` listen entry is what turns
            // a connection into a reservation, and it is already in `listen` above.
            await libp2p.dial(peerId)
          },
        })
      }
      void topUp()
      const stopTopUp = onPeerArrival(() => {
        void topUp()
      })
      undo.push(stopTopUp)
    }

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
   * Why this node's records are not in the keyspace, or `undefined` if nothing refused.
   *
   * Registration happens on the way up and cannot fail a start — see the publish site. So
   * the refusal has to land *somewhere a reader can find it*, or a node that silently never
   * registered is indistinguishable from one that did. This is that somewhere.
   *
   * `undefined` covers two different states on purpose, because no caller can act
   * differently on them: the put succeeded, or it has not finished yet.
   */
  get registrationRefusal(): string | undefined {
    return this.#registrationRefusal
  }

  /** Recorded by the start path's publish; see {@link registrationRefusal}. */
  noteRegistrationRefused(reason: string): void {
    this.#registrationRefusal = reason
  }

  /**
   * How many peers stored this node's records at its most recent publish — SCHED-01.
   *
   * **Zero is not a failure and is not an error, and reading it as one is the trap this
   * getter exists to remove.** `kad-dht` writes a record to the local datastore before it
   * walks to the closest peers, so a publish against an empty routing table succeeds and
   * reaches nobody. Zero therefore means *registered with itself and nobody else* — a real
   * state, and the one every node is in until its first peer arrives. A node that has met
   * peers and still reads zero is the reading worth acting on.
   *
   * Zero for a node holding no certificate too, which has nothing to publish at all;
   * {@link FabricNode.registrationRefusal} is what tells the two apart.
   */
  get registrationPeers(): number {
    return this.#publisher?.peers ?? 0
  }

  /** How many of this node's blocks are currently advertised in the keyspace — SCHED-01. */
  get announcedBlocks(): number {
    return this.#announcer.announcedCount
  }

  /**
   * Announce the blocks this node holds and retract the ones it may no longer advertise.
   *
   * Runs on its own whenever a peer arrives, which is when there is a routing table worth
   * walking. Exposed because a caller that has just stored blocks and wants them findable
   * *now* would otherwise be waiting on somebody else's connection — and because a sweep
   * is the only thing that retracts, so a caller that has just made data sovereign has a
   * way to say so without waiting either.
   */
  async announceHeldBlocks(): Promise<SweepOutcome> {
    return this.#announcer.sweep()
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
   * Total connections this node keeps before the connection manager prunes.
   *
   * Read it when a relay's reservations stop being granted for no stated reason: past
   * this figure the excess peers start cleanly and hold nothing.
   */
  get maxConnections(): number {
    return this.#maxConnections
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
  /**
   * Every admission decision this relay has made, newest last — AUTH-02 / AUTH-04.
   *
   * Empty on a node stating `'admits-any-peer'`, and empty **because nothing was ever
   * consulted** rather than because everything was allowed. That distinction is the whole of
   * why the open posture supplies no gater method at all, and it is readable here: a relay
   * that admits any peer produces no decisions, not a list of approvals.
   *
   * A copy, so this node's record of who it turned away is not writable through its own
   * getter. Bounded at {@link ADMISSION_LOG_LIMIT}.
   */
  get admissionDecisions(): readonly AdmissionDecision[] {
    return [...this.#admissionLog]
  }

  get reservedPeerIds(): readonly string[] {
    const service: unknown = this.libp2p.services['relay']
    if (!hasReservations(service)) return []
    return [...service.reservations.keys()].map((peer) => peer.toString())
  }

  /**
   * NET-03 — the certificate this node acquired for itself, or `undefined`.
   *
   * `undefined` covers three different situations and deliberately does not distinguish
   * them, because none of them is an error a caller can act on differently: `autoTls` was
   * not configured, it was configured and no acquisition has completed yet, or the node
   * holds no address AutoTLS considers dialable. The reason for the last one is in
   * `AutoTlsOptions`; the log line is `not fetching certificate as we have no public
   * addresses`.
   *
   * Reading through `libp2p.services` rather than caching the value at construction: the
   * certificate is replaced on renewal, and a field captured once would go stale in a way
   * a long-lived relay is exactly the process to notice.
   */
  get tlsCertificate(): TLSCertificate | undefined {
    const service: unknown = this.libp2p.services['autoTLS']
    if (service === null || typeof service !== 'object' || !('certificate' in service)) {
      return undefined
    }
    return service.certificate as TLSCertificate | undefined
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
