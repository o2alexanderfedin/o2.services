/**
 * A complete fabric node inside a browser tab.
 *
 * Same composition as the Node one — `Transport`, `Blockstore`, `Executor` behind
 * ports — with only the concrete adapters differing:
 *
 *   `Transport`  → libp2p over WebRTC, signalled through a Circuit Relay v2 peer
 *   `Blockstore` → IndexedDB, wrapped in network fallback
 *   `Executor`   → the kernel's `WasmExecutor`, on a thread this tab can kill
 *
 * ## Why the transport list looks like this
 *
 * A browser cannot bind a listening socket, so:
 *
 *   - `webSockets()` exists only to *dial* the relay. It can never listen.
 *   - `circuitRelayTransport()` makes `/p2p-circuit` dialable and lets this node
 *     hold a reservation, which is the only way it becomes addressable at all.
 *   - `webRTC()` is the sole browser↔browser option. There is no alternative and no
 *     fallback.
 *
 * Listening on `['/p2p-circuit', '/webrtc']` is likewise not a choice — it is the
 * only combination a browser can offer. The relay carries the SDP exchange; once ICE
 * completes the data flows directly between tabs and the relay drops out, which is
 * what keeps the fabric's capacity independent of the backbone's bandwidth.
 */

import { ed25519 } from '@noble/curves/ed25519.js'
import { noise } from '@chainsafe/libp2p-noise'
import { yamux } from '@chainsafe/libp2p-yamux'
import { circuitRelayTransport } from '@libp2p/circuit-relay-v2'
import { identify, identifyPush } from '@libp2p/identify'
import { kadDHT, passthroughMapper } from '@libp2p/kad-dht'
import { peerIdFromString } from '@libp2p/peer-id'
import { ping } from '@libp2p/ping'
import { webRTC } from '@libp2p/webrtc'
import { webSockets } from '@libp2p/websockets'
import { multiaddr } from '@multiformats/multiaddr'
import { AbiExecutor, WasiExecutor } from '@o2/aot'
import {
  CertificateHolder,
  DEFAULT_ISSUANCE_WINDOW_MS,
  DEFAULT_MAX_CONCURRENT_TASKS,
  EnrollmentAuthority,
  DutyCycleGovernor,
  LocalCapacity,
  SelfRecordIndex,
  SignedNameResolver,
  StartOutcomeLedger,
  DEFAULT_KDF_PARAMS,
  attestResults,
  deriveSealKey,
  guardModuleProvenance,
  guardSovereignty,
  isStartBrowserLabel,
  publishCapabilities,
  openSecret,
  openWithKey,
  requestEnrollment,
  sealedUnderSameKey,
  subtleUserSigner,
  encodeCanonical,
  TURN_MINT_PURPOSE,
  toHex,
  verifyCapabilityRecord,
  verifyCertificate,
} from '@o2/core'
import type {
  Admission,
  Blockstore,
  Executor,
  IssuanceBudget,
  NodeCertificate,
  NodeRecords,
  NodeSovereignty,
  Offer,
  PublicKeyHex,
  RecordIndex,
  ResultAttestor,
  SealedSecret,
  SelfRecordIndexOptions,
  StartOutcome,
  StartReport,
  StartReportingConsent,
} from '@o2/core'
import {
  DHT_QUERY_TIMEOUT_MS,
  DhtProviderAnnouncer,
  DhtRecordIndex,
  ObservingBlockstore,
  RecordPublisher,
  startCertificateRenewal,
  Libp2pTransport,
  O2_KAD_PROTOCOL,
  O2_RECORD_NAMESPACE,
  PeerVerifier,
  SEED_BYTES,
  SeedLengthError,
  assertUsablePassphrase,
  audienceKeyOf,
  generateSeed,
  identityFromSeed,
  o2RecordSelector,
  o2RecordValidator,
  RELAY_RESERVATION_TARGET,
  discoverRelays,
  peerIdForNodeKey,
  providerRecordPolicy,
  topUpRelays,
} from '@o2/libp2p'
import type { IdentityProtection, NodeIdentity, PeerVerdict, SweepOutcome } from '@o2/libp2p'
import type { KadDHT } from '@libp2p/kad-dht'
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
  enrolOverRpc,
  // SCHED-03's refusal string, imported rather than composed a second time here: one
  // sentence a requestor reads, in one place, on `pausedRefusal`'s own discipline.
  pausedRefusal,
  serveAgent,
  withholdingFrom,
} from '@o2/net'
import type { Authorizer, EnrolOutcome, LocalAdmission, SovereignCids } from '@o2/net'
import { createLibp2p } from 'libp2p'
import type { Libp2p } from '@libp2p/interface'
import { currentBrowserLabel } from './browser-id.ts'
import type { HeldPeer } from './dial-plan.ts'
import { iceConfiguration } from './ice-configuration.ts'
import { turnCredentialHolder } from './turn-credentials.ts'
import { IdbBlockstore } from './idb-blockstore.ts'
import {
  IdbIdentityStore,
  SealedIdentityNeedsPassphraseError,
  SealedIdentityUnlockError,
} from './idb-identity-store.ts'
import { IdbIssuance } from './idb-issuance.ts'
import { IdbSovereignCids } from './idb-sovereign-cids.ts'
import { installSubtleDigestFallback } from './subtle-digest-fallback.ts'
import { VisibilityGovernor } from './visibility-governor.ts'
import { browserWorkerExecutor } from './worker-executor.ts'
import type { WorkerExecutor } from '@o2/core'
import type { WorkerFactory } from './worker-executor.ts'

export interface BrowserNodeOptions {
  /** Relays to reserve on. At least one is required to be addressable at all. */
  readonly relayAddrs: readonly string[]
  /**
   * Where to fetch a TURN credential from — NET-12. **Off by default**, and the default is the
   * whole reason this is an option rather than a constant: roughly forty existing e2e specs
   * construct a node with no minting endpoint, and every one of them must keep getting the
   * explicit STUN list and nothing else.
   *
   * **An endpoint rather than a caller-supplied credential, and that is forced rather than
   * preferred.** A mint request must be signed by the node key the certificate names, and the
   * private half of that key lives in here — `identityFromSeed(seed)` — while the certificate
   * lives in this tab's `IdbIdentityStore`. A caller has neither, so a caller cannot build the
   * request. This node fetches its own credential, and the fetch is lazy: `@libp2p/webrtc`
   * re-invokes `rtcConfiguration` once per connection in both directions
   * (`private-to-private/transport.js:100` and `:131`), which is what makes "short-lived"
   * possible at all and is a measured reading of the installed package.
   *
   * A failed fetch means *no rung right now*, never an error: the configuration handed onward
   * still carries the explicit STUN list, never `{}`. See THE TRAP in `ice-configuration.ts`.
   */
  readonly turnEndpoint?: string
  /**
   * Which region's rung to ask for. Defaults to `bootstrap-us`, the one object every request
   * is served by today.
   */
  readonly turnRegion?: string
  /** Refetch this long before the stated expiry. A harness lowers it to exercise rotation. */
  readonly turnRefreshMarginMs?: number
  /**
   * Forces `iceTransportPolicy: 'relay'`, making a direct candidate impossible **by policy**.
   * Only a harness sets this. It proves *the rung carries a pair when no direct candidate is
   * usable*; it says nothing about how often real networks make direct candidates unusable,
   * and it must never be defaulted on.
   */
  readonly iceRelayOnly?: boolean
  /**
   * How long this tab keeps another node's provider record before sweeping it. **1 hour
   * by default** — {@link PROVIDER_RECORD_VALIDITY_MS}.
   *
   * Byte-identical in meaning to `FabricNodeOptions.providerRecordValidityMs`, and both
   * tiers thread the same derivation, so a tab and a backbone node forget on the same
   * schedule. That matters here more than it looks: a tab is the shortest-lived provider
   * in the fabric, and a record about it is the one most likely to outlive what it
   * describes.
   */
  readonly providerRecordValidityMs?: number
  /**
   * How long the renewal loop waits before asking again after a refused or unreachable
   * exchange — AUTH-04. Defaults to `RENEWAL_RETRY_FLOOR_MS`. Exists so a test can reach
   * the retry path inside a run; production leaves it alone.
   */
  readonly renewalRetryFloorMs?: number
  /**
   * SCHED-03. Read on every request to decide whether this tab is **paused** — alive,
   * reachable, unchanged in what it can do, and declining all work right now.
   *
   * A thunk rather than a flag, because a visitor toggles it while the tab runs: hold
   * your own boolean and hand over a closure that reads it. A tab is the case the state
   * was most obviously missing for — closing it loses the relay reservation and every
   * block in IndexedDB's reach, and throttling cannot reach zero because
   * `LocalCapacity.slots` floors at 1 on purpose. `AgentOptions.paused` carries the
   * full argument.
   *
   * **Optional here and required there**, exactly as `FabricNodeOptions.paused` states
   * it: the mechanism must not be reachable by silence, while a factory told nothing
   * threads the named opt-out and is byte-identical to the tab that existed before this
   * option did. A per-node setting and not a node kind — the two factories thread the
   * identical ternary.
   */
  readonly paused?: () => boolean
  /**
   * This tab's clearance to execute sovereign data, and the owner key it judges
   * capability chains against — DATA-09's serving-side gate (`guardSovereignty`,
   * `@o2/core`), applied unconditionally inside the `Executor` this factory composes
   * below, and AUTH-03's `authorize` hook at the `serveAgent` call, same as
   * `fabric-node.ts`.
   *
   * Optional, and the default is the safe one: cleared for nobody, pinned to nobody
   * (`canExecuteSovereign: false`, no `ownerKey`). A tab started with no `sovereignty`
   * option therefore refuses every sovereign-labelled task **twice over** — the
   * authorizer for want of a pinned owner key, `guardSovereignty` for want of
   * clearance — and the first is the one a requestor observes, because `authorize`
   * runs before `execute`. `ownerId` is consequently consulted on every sovereign
   * dispatch, before clearance is looked at.
   *
   * Per-node clearance, not a node class — every `BrowserNode` has the identical
   * executor, transport, relay-reservation behaviour and authorizer regardless of this
   * setting, mirroring `fabric-node.ts`'s "why there is no second class".
   */
  readonly sovereignty?: NodeSovereignty
  /**
   * The build authorities this tab will run a module for — DET-03, DATA-08.
   *
   * **Mirrors `FabricNodeOptions.trustAnchors` exactly** (`packages/node/src/fabric-node.ts`),
   * which carries the long form of this reasoning; the two docs are meant to be read
   * together, the way the `sovereignty` docs on either side already are. Same type, same
   * three admitted values, same requiredness — because a browser node is not a lesser
   * node, and "the tab is only the demo" is precisely the reasoning that would put the
   * hole here rather than in the Node tier.
   *
   * An anchor is the public half of a signing key, pinned in advance. A CID proves the
   * bytes are the bytes that were hashed and says nothing about who meant them to run; a
   * `NameRecord` signed by one of these keys says that, and `guardModuleProvenance`
   * (`@o2/core`) refuses any task whose module did not arrive with one — before the
   * module's bytes are fetched, let alone instantiated.
   *
   * **Required, with no `?` and no default.** `.planning/PROJECT.md`'s Key Decision —
   * *an optional hook with a silent default is a hole* — and the same convention
   * `createWorker` above adopted for the same reason. Whichever default were chosen here,
   * a tab would get it without anyone deciding.
   *
   * Three values and what each admits:
   *
   * - **`[pub, …]`** — this tab runs a module exactly when a record signed by one of
   *   these keys names its CID.
   * - **`[]`** — this tab trusts nobody, and therefore refuses every module. That is the
   *   safe reading of an empty set and it is deliberately **not** special-cased into
   *   meaning something friendlier: a caller who wanted the escape hatch has a word for
   *   it, and an empty array is not that word.
   * - **`'runs-unsigned-artifacts'`** — no guard is composed at all and this tab reverts
   *   to resolving bare CIDs, as every node did before this phase. Written down at the
   *   call site rather than reached by omission precisely because it is the one value
   *   that turns DET-03 off, and a value that turns a guarantee off must cost somebody a
   *   decision.
   *
   * **The `TabApi` surface above this one is deliberately stricter and admits no
   * opt-out at all** — `start` takes an optional anchor *list* that defaults to the
   * demo's own committed authority, and `runJob` requires a record. There is no value a
   * page or a harness can pass through `window.o2` that yields a tab resolving bare
   * CIDs. The escape hatch belongs to whoever constructs a node in TypeScript and has
   * written down that they want one; it is not part of the tab's contract. See
   * `tab-api.ts`.
   *
   * Per-node **configuration**, not a node kind. Every `BrowserNode` has the identical
   * executor, transport and relay-reservation behaviour whatever is passed here —
   * exactly as `sovereignty` does — and nothing anywhere branches on what kind of node
   * something is.
   */
  readonly trustAnchors: readonly PublicKeyHex[] | 'runs-unsigned-artifacts'
  /**
   * Provider keys whose certificates this tab accepts from a peer — AUTH-02.
   *
   * **The same shape as `FabricNodeOptions.trustedIssuers`** (`packages/node/src/fabric-node
   * .ts`), field for field, and that file carries the long form of every argument below —
   * the two docs are meant to be read together, as `trustAnchors`, `sovereignty` and
   * `enrollment` already are. It is the same shape because a tab verifies on identical
   * terms: **all nodes have equal functionality, and the only difference is discovery.**
   *
   * A list of **issuers**, never of peers: pinning is about who signed, never about who is
   * talking. A peer whose certificate chains to one of these is verified; every other
   * connected peer is excluded from the block source's peer list, by name and with a
   * verdict a caller can read through {@link BrowserNode.verdictFor}.
   *
   * **Omitting it means this tab verifies nobody and treats every connected peer as
   * usable**, which is what every browser node in this repository did before this field
   * existed and what every existing test relies on. That is 17-CONTEXT.md decision 9's
   * third row, and — copied deliberately from the Node tier — it is a **stated** absence
   * rather than a safe default: the alternative, an empty verified set for a tab that
   * pinned nothing, would be indistinguishable from a network outage, which is the failure
   * shape NET-05 exists to eliminate one tier down. **In a tab that reading is sharper than
   * it is on the backbone**, because the only peer a fresh tab has is the relay it
   * reserved on, so a fail-closed default would empty the block source of the one peer the
   * page can fetch through and the demo would stop loading blocks with nothing named. So a
   * tab that pins nobody does no verification work at all: it never subscribes, never asks
   * a peer for records, and `verdictFor` is undefined by construction rather than by
   * winning a race. See `PeerVerifier.verifiedPeers`'s early return, which is where that
   * lives and which is deliberately **not** symmetric with `RelayAdmission` — that type's
   * docblock in `@o2/libp2p` carries the matching half of the asymmetry.
   *
   * Per-node configuration, not a node kind. Every `BrowserNode` has the identical
   * executor, transport, relay behaviour and protocol surface whatever is passed here —
   * exactly as `sovereignty` and `trustAnchors` do.
   *
   * `trustAnchors` above is a different pinning and the two must not be conflated: an
   * anchor says whose *build* records this tab will run a module for, and an issuer says
   * whose *enrollment* signature it will believe about a peer. A module and a peer are
   * different subjects, and a key pinned for one says nothing about the other.
   */
  readonly trustedIssuers?: readonly PublicKeyHex[]
  /**
   * Whether this tab's own start row may leave this device — BROW-01.
   *
   * **Required, with no `?` and no default**, on the same ground as `trustAnchors` above
   * and `FabricNodeOptions.relayAdmission`: this is the boundary where the difference
   * between silence and consent is the entire claim, and `.planning/PROJECT.md`'s Key
   * Decision — *an optional hook with a silent default is a hole* — is about exactly it.
   * The union's two values and what each costs are documented in full at
   * {@link StartReportingConsent} in `@o2/core`.
   *
   * ## The defect this field exists to close, recorded because it was a live one
   *
   * `DISCLOSURE.reporting` promises a visitor, in the words they read before deciding:
   * *"Sends one line — which browser family, and whether the node started or was blocked…
   * **Off unless you turn it on.**"* Two things sent that line and only one of them was
   * gated. `demo/main.ts`'s `startReport` honoured the choice by sending `outcome: null`.
   * This factory recorded the tab's own row into its **serve-side** ledger at
   * construction, with no reference to consent, because this interface carried none — and
   * `serveAgent`'s report branch hands that ledger to every peer that asks. So the page
   * withheld the line and the node served it, and a control that changed only what the
   * local page rendered is the sovereignty claim failing in miniature.
   *
   * It was measured rather than reasoned about, over the real wire, in
   * `packages/node/src/peer-ledger.e2e.test.ts`: a chromium context whose visitor turned
   * reporting off answered a relay's `report` request with
   * `chromium | chromium 151 | edge 120 | firefox 153 | safari 26`, its own `edge 120`
   * among them.
   *
   * ## Whose answer this is
   *
   * A page's, from the visitor's own consent record — `demo/main.ts` derives it from the
   * `GrantedConsent` that `requireConsent()` returns, which is the value minted when the
   * visitor answered the disclosure. Nothing else on a visitor's path supplies it and no
   * parameter of `TabApi.start` carries one, for the reason `trustAnchors` gives one field
   * up: a page that was found rather than configured must not be configurable by whatever
   * found it.
   *
   * Per-node **value**, not a node kind. `FabricNodeOptions.startReporting` is the same
   * field with the same type over there, because a browser node is not a lesser node and
   * "the tab is only the demo" is precisely the reasoning that would have left the hole
   * here rather than in the Node tier.
   *
   * ## The precedent cited above is one this interface does not have — defect #55
   *
   * The first paragraph argues this field's required-with-no-default shape *"on the same
   * ground as `trustAnchors` above and `FabricNodeOptions.relayAdmission`"*, and closes by
   * saying a browser node is not a lesser node. But **`BrowserNodeOptions` has no
   * `relayAdmission` field**, so an argument against tier asymmetry was sitting inside an
   * instance of one. Flagged by Plan 24-01 and closed here.
   *
   * **The absence is a consequence of topology, not of tier, and that is the whole
   * correction.** Measured 2026-08-06: this module imports only `circuitRelayTransport` from
   * `@libp2p/circuit-relay-v2` — never `circuitRelayServer`. **The services list gained a
   * `dht` on 2026-08-15 and this paragraph used to say the list was `identify` and
   * `identifyPush` and nothing else; that is corrected rather than deleted, because the
   * argument runs through it.** The claim it was making is unaffected: `circuitRelayServer`
   * is still never imported here, and a `kadDHT` service grants no reservation. A
   * `BrowserNode` therefore still **runs no relay server, grants no reservation, and has no
   * reservation to gate.** The same fact is stated on the answering side by the
   * named-absence sentinel this factory passes as `serveAgent`'s `reservations` hook. The tab
   * is not being trusted less; it is not holding a door.
   *
   * (That sentinel is deliberately **not** spelled out here. `serve-agent-hooks.node.test.ts`
   * counts its occurrences in this file's **raw** source and requires exactly one, because a
   * raw-text scan cannot tell a construction from a mention — the identical hazard
   * `relay-admission.node.test.ts` records for its own matchers. Naming it in this paragraph
   * took that count to 2 and reddened that guard, which is how this sentence came to be
   * written the way it is.)
   *
   * **`BrowserNodeOptions` must not gain a `relayAdmission` field to make the symmetry
   * look complete.** A required posture on an interface with nothing to gate is a value
   * nobody can act on and a second vocabulary for one fact — exactly what
   * *"certificate-holding is a per-node FACT, never a node kind"* forbids.
   *
   * **What carries this paragraph is not this paragraph**, and saying so is the point: a
   * sentence is not executable and no mutation of it can redden anything. The machine-checked
   * half is in `packages/node/src/relay-admission.node.test.ts`, whose gater census requires
   * that this file contain `denyDialMultiaddr` — which *opens* dialling — and must **not**
   * contain the reservation-deny method. That negative is now a protected property rather
   * than a "nothing moved" claim, and it and this sentence landed together so neither can be
   * reverted without the other reddening.
   */
  readonly startReporting: StartReportingConsent
  /** IndexedDB database name. Distinct names give one origin several independent nodes. */
  readonly blockstoreName?: string
  /**
   * What this tab does when its stored seed is not there — AUTH-01.
   *
   * **Required, with no `?` and no default**, and this is the field the whole of
   * `idb-identity-store.ts` exists to hand a decision to. A node's seed *is* its name:
   * `identityFromSeed` derives the peer id every peer dials and the `nodeKey` a
   * certificate is signed over, so losing it is not losing a cache — it is becoming
   * somebody else.
   *
   * A tab's storage is evicted silently under pressure, which this repository records
   * as a property of IndexedDB. That is a *durability* difference from a Node process's
   * `blockstoreDir` file, and it is the only one: delete that directory and a
   * `FabricNode` loses the identical three values. What differs is that a disk does not
   * do it while nobody is looking. So the branch that a Node process reaches by an
   * operator's `rm` is one a tab reaches on an ordinary Tuesday, and it must be a
   * decision rather than whatever the code happened to do.
   *
   * Two values, and what each costs:
   *
   * - **`'mints-a-new-identity'`** — generate a fresh seed, store it, carry on. The tab
   *   comes back up with a **different peer id**, so every peer that had it in a peer
   *   store now has a stale address; and any certificate that survived alongside is
   *   refused by `resolveCertificate`'s own identity check, because its `nodeKey`
   *   derives the *old* peer id. The node then re-enrols if it was configured to, or
   *   runs uncertificated — and a peer pinned to `--trusted-issuer` will not take blocks
   *   from it until it holds one again. This is the right value for a visitor's tab,
   *   where refusing to start means a blank page for a fault nobody can act on.
   * - **`'refuses-to-start-without-its-seed'`** — reject `start()`, naming the store. The
   *   right value wherever the identity is load-bearing and a silent rename would be
   *   worse than an outage: a long-lived kiosk, or a test that would otherwise pass by
   *   measuring a node it accidentally re-created.
   *
   * A first run has no seed either, and it takes the same branch by construction —
   * because "the seed was evicted" and "there has never been one" are the same
   * observation from inside a tab, and a field that pretended to tell them apart would
   * be inventing the distinction. `'refuses-to-start-without-its-seed'` therefore cannot
   * bootstrap; a caller choosing it is saying the seed is provisioned elsewhere.
   */
  readonly whenSeedIsGone: 'mints-a-new-identity' | 'refuses-to-start-without-its-seed'
  /**
   * What this tab will do with the long-lived secrets it persists — AUTH-06.
   *
   * **Required, with no `?` and no default**, and the precedent is the field directly above
   * this one, in that field's own words: *this factory refuses to make this decision for its
   * caller.* A default here would be a default about **where a secret lives on somebody
   * else's device**, which is exactly the class of decision that has to be written down by a
   * person rather than inherited from a library.
   *
   * The two arms and what each costs — `identity-protection.ts` carries the long form:
   *
   * - **`{ kind: 'passphrase', passphrase }`** — every secret this tab persists is sealed
   *   under an Argon2id key derived from it, and a database written by an older build is
   *   migrated in place on the first start that supplies one: same bytes, same peer id. A
   *   wrong passphrase on a later start throws {@link SealedIdentityUnlockError} and mints
   *   nothing.
   * - **`{ kind: 'writes-no-new-secret' }`** — a promise, not an absence. This tab persists
   *   no new secret at all. It adopts a pre-existing plaintext record if one is there, so a
   *   visitor who upgrades keeps their peer id and is *told* that the record is readable by
   *   anyone who copies the profile ({@link BrowserNode.identityIsUnprotected}); otherwise it
   *   mints a per-session identity that never reaches IndexedDB and is **a different node on
   *   the next start**.
   *
   * ## Why this is required where the Node tier's is optional, and the asymmetry is measured
   *
   * `FabricNodeOptions.identityProtection` defaults to `writes-no-new-secret` because
   * `blockstoreDir:` appears at 169 call sites across roughly thirty files, and a required
   * field there would have been a sweep nobody could review. `whenSeedIsGone:` appears at 22
   * sites across 12 files, and every one of them is a place this option goes too. That is
   * affordable, so it is required — a count, not a preference.
   *
   * ## The one combination that cannot hold
   *
   * `writes-no-new-secret` together with
   * `whenSeedIsGone: 'refuses-to-start-without-its-seed'` describes a node that will not
   * write a secret and will not start without a stored one, which can never start at all
   * once its storage is evicted — and a tab's storage is evicted silently. It is refused at
   * `start` by name ({@link ContradictoryIdentityPolicyError}) rather than left to present
   * as a node that stopped working for no stated reason.
   */
  readonly identityProtection: IdentityProtection
  /**
   * Enrol with a provider on the way up, and hold the certificate it signs — AUTH-01.
   *
   * **The same shape as `FabricNodeOptions.enrollment`** (`packages/node/src/fabric-node.ts`),
   * field for field, and that file carries the long form of every argument below; the two
   * docs are meant to be read together, as `trustAnchors` and `sovereignty` already are.
   * It is the same shape because a browser node enrols on identical terms — **all nodes
   * have equal functionality, and the only difference is discovery.**
   *
   * That last clause is the one this option exists to make true again. A node started
   * with `--trusted-issuer` takes blocks only from peers whose certificate verifies
   * (`PeerVerifier`), and until this field existed no tab could hold one — so the gate
   * excluded every browser peer, and the fabric partitioned by tier. Nothing branched on
   * node kind to do it; four mechanisms were simply absent here, and an absence
   * partitions just as effectively as a branch.
   *
   * ## That clause was false in one direction — flagged 2026-08-06, CLOSED 2026-08-14
   *
   * The 2026-08-06 correction that stood here read, of *"all nodes have equal functionality,
   * and the only difference is discovery"*: **"The other half is open, and this module is
   * the reason. Measured on this file: nothing here constructs a peer verifier, `#compose`
   * installs no selection gate, and `PeerVerifier` appears in this file only in the
   * paragraph above — as prose. So a tab takes blocks from any peer, while the Node peer it
   * just enrolled with may be refusing half the fabric."** Every clause of that was true
   * when written. It is quoted rather than deleted because the gap it names is the one the
   * sibling {@link BrowserNodeOptions.trustedIssuers} field now closes, and because the
   * reasoning — an absence partitions as effectively as a branch — is what a reader should
   * take from this docblock.
   *
   * **What *this* field closed is the half where a tab could not *be* verified.** A tab can
   * hold a certificate, so a Node peer started with `--trusted-issuer` will take blocks from
   * it. That half is AUTH-01's and is unchanged by anything below.
   *
   * **What closed the other half was a `git mv`, not a browser implementation.** The
   * correction diagnosed the cause exactly right — *"`PeerVerifier` lives in `@o2/node`;
   * `@o2/browser` does not depend on that package and must not, so the absence here is a
   * package boundary and not a decision about tabs"* — and the fix follows from the
   * diagnosis: the module imported nothing Node-only, so it moved to `@o2/libp2p`, the
   * dual-target tier both platform packages already depend on. `#compose` now constructs a
   * verifier and reads `verifiedPeers` into the block source, mirroring `fabric-node.ts`
   * line for line. `DEFICIENCIES.md` **D09** (*"the browser tier structurally cannot verify
   * peers"*) describes a structure that no longer exists.
   *
   * **One thing did not change and must not be read as having changed.** A tab that passes
   * no `trustedIssuers` still takes blocks from every connected peer — that is the stated
   * absence, not an oversight, and the argument for it is on that field. So *"a tab takes
   * blocks from any peer"* remains a true description of the **default** tab; what is no
   * longer true is that it is the only tab available.
   *
   * **Something that can *sign*, not a `userKey` hex string, and the difference is
   * load-bearing.** `EnrollmentAuthority.enrol` requires an `ownerProof` — the *user's*
   * signature over the same challenge the node signs — and refuses by name as
   * `bad-owner-proof` without it. A public key cannot sign, so a node configured with one
   * would be refused on every attempt. `requestEnrollment` takes the `userKey` from
   * whatever signs rather than accepting it as a field, so naming somebody else's user key
   * is not a thing this option can be asked to do.
   *
   * **A `CryptoKeyPair` is accepted here, and on this tier it is the better answer.** Bytes
   * in a tab can be read by whatever served the page; a pair from
   * `crypto.subtle.generateKey({ name: 'Ed25519' }, false, ['sign', 'verify'])` cannot be —
   * `webcrypto-ed25519.browser.test.ts` measures `exportKey` on the private half being
   * refused in chromium, firefox and webkit alike. Handed one, the composition below turns
   * it into a `UserSigner` through `@o2/core`'s `subtleUserSigner` and the private half
   * never enters this package's memory at all.
   *
   * **What that costs, so it is chosen rather than discovered:** a browser-held key cannot
   * be reconstructed from bytes, so it does not move between devices and does not survive
   * losing the origin's storage. Bytes remain the right answer for a key a person owns
   * across machines — which is why the union has two arms rather than a replacement.
   *
   * **And it needs a secure context.** `crypto.subtle` is `undefined` on
   * `http://<host>.local` (`insecure-context.browser.test.ts` records that outage), so a
   * LAN visitor cannot *create* such a pair — `localhost`, `127.0.0.1` and HTTPS can. This
   * option does not probe for that: a caller can only fill this arm holding a pair, which
   * they can only hold where `subtle` worked.
   *
   * `discoverability` and `relayIds` are **absent on purpose**, as they are in the Node
   * tier: they are derived from what this node can actually do, at the composition below.
   */
  readonly enrollment?: {
    readonly userPrivateKey: Uint8Array | CryptoKeyPair
    readonly operatorId: string
    readonly providerAddr: string
  }
  /**
   * Whether this tab holds a provider signing key and answers enrollment requests, and
   * **how many certificates it will sign per window if it does** — AUTH-01, AUTH-04.
   *
   * Mirrors `FabricNodeOptions.issuesCertificates`, including the reason it carries the
   * budget rather than sitting beside a second optional field: a provider that never
   * stated a bound is not a state this type can express. Absence means "does not issue at
   * all", which is the safe default — a node that signed certificates because nobody said
   * otherwise would be a trust root by accident.
   *
   * There is no browser-shaped reason for this to be here rather than absent, and that
   * is the point — issuing needs a signing key and a durable place to keep it, and this
   * tier now has both (`idb-identity-store.ts` for the key, `idb-issuance.ts` for the
   * record the budget is spent against). Leaving it off would have left one capability a
   * `FabricNode` has and a `BrowserNode` cannot, which is the shape this option exists to
   * delete.
   */
  readonly issuesCertificates?: IssuanceBudget
  readonly rpcTimeoutMs?: number
  /**
   * Tasks this tab will run at once before it refuses an `exec` request with its
   * own words — SCHED-06.
   *
   * Defaults to `DEFAULT_MAX_CONCURRENT_TASKS` (`@o2/core`, which is the only place
   * that carries the value), mirroring `fabric-node.ts`. Per-node capacity, not a
   * node class: every `BrowserNode` has the identical executor, transport and
   * relay-reservation behaviour whatever this is set to.
   *
   * **This is not the duty cycle and must never be derived from it** — see the note
   * beside the `LocalCapacity` construction in `start`.
   */
  readonly maxConcurrentTasks?: number
  /**
   * The share of wall clock this tab will spend running tasks — SCHED-04.
   *
   * A number in `(0, 1]`, defaulting to **1**. This is the *user's* cap, and it composes
   * with the visibility governor rather than replacing it: the effective rate is the
   * **lower** of the two, so a backgrounded tab at a user cap of 1 still throttles to the
   * background rate, and a foregrounded tab at 0.25 still runs at 0.25. BROW-03 is
   * unchanged by this option existing.
   *
   * Per-node and not a node kind, exactly as on the Node tier. A starting value rather
   * than a fixed one — {@link BrowserNode.setDutyCycle} moves it on a running tab, which
   * is the half of SCHED-04 that neither tier had.
   *
   * Passed straight through, never clamped: `DutyCycleGovernor` refuses anything outside
   * `(0, 1]` with a `RangeError` naming the value.
   */
  readonly dutyCycle?: number
  /**
   * Largest single inbound frame this tab will accumulate before it aborts the
   * stream — NET-08.
   *
   * Defaults to `MAX_INBOUND_MESSAGE_BYTES` (`@o2/libp2p`). The first
   * `Libp2pTransportOptions` field this factory has ever passed, mirroring
   * `fabric-node.ts`; the send-side gate's own bounds are deliberately not exposed
   * here, for the reason given there.
   */
  readonly maxMessageBytes?: number
  /**
   * Duty cycle to fall back to while the tab is hidden.
   *
   * BROW-03. Defaults to 0.1 — a backgrounded tab throttles hard but never stops, so
   * a task already in flight still finishes.
   */
  readonly backgroundDutyCycle?: number
  /**
   * Permit dialling loopback and private addresses.
   *
   * libp2p refuses them by default in a browser, which is right for the public
   * internet and wrong for a relay on `127.0.0.1`. Only enable for local testing.
   */
  readonly allowPrivateAddrs?: boolean
  /**
   * Builds the Worker that tasks execute on — BROW-04, SCHED-06.
   *
   * Required, and injected rather than defaulted. Those are two separate facts and
   * only the second follows from the bundler: `?worker` is Vite syntax
   * (`worker-factory.ts`), so the *spelling* of a thread belongs to whatever bundles
   * the page. *Having* one is not the page's choice. A guest `run()` is a synchronous
   * call, so on this tab's main thread the wall-clock deadline cannot fire — the timer
   * is queued on the loop the guest is holding — and there is no thread to terminate.
   * The bound is not weaker there, it is absent, and a 52-byte `loop br 0` from any
   * peer wedged the tab permanently, `stop()` included.
   *
   * This was optional until SCHED-06, justified by "tests that have no bundler". No
   * such test was ever written, and the reason recorded here — that `BrowserNode.start`
   * *"needs a real `indexedDB` and a relay to dial"*, leaving `demo/main.ts` as the only
   * construction site there has ever been — was **corrected on 2026-07-31**: it is false
   * in both halves. `start-unwind.browser.test.ts` starts this factory to success in
   * three engines, and `capability-harness.ts` constructs it with a bundler for
   * `browser-capability.e2e.test.ts`. Both pass a factory, as `demo/main.ts` always did.
   * What survives the correction is the conclusion: the escape hatch was cut for a
   * caller that does not exist, and it was the only thing between an untrusted peer's
   * module and this tab's main thread.
   */
  readonly createWorker: WorkerFactory
  /**
   * How long one task may hold this tab's thread before it is killed — SCHED-06.
   *
   * Defaults to `DEFAULT_TASK_DEADLINE_MS` (`@o2/core`, the only place the value
   * lives). An option rather than only a constant for the same reason
   * `maxConcurrentTasks` is one: a test that wants to observe the bound has to be
   * able to make it certain rather than hope for it. Per-node, and not a node class —
   * nothing anywhere branches on it.
   */
  readonly taskDeadlineMs?: number
}

/**
 * The only listen set a browser can offer, named so `canRelay` can be *derived* from it.
 *
 * Written down once rather than inline at `createLibp2p` because a second reader of this
 * list exists now, and two copies of a listen list is exactly how a derived property
 * starts disagreeing with the thing it was derived from.
 */
const BROWSER_LISTEN = ['/p2p-circuit', '/webrtc'] as const

/**
 * Whether this node can be a seed a newcomer dials cold — derived, never configured.
 *
 * `fabric-node.ts` derives the same property from its own listen list, and the predicate
 * here is that one widened by a protocol a Node listen list never contains. Both
 * `/p2p-circuit` and `/webrtc` are **relay-mediated**: a browser's WebRTC address is
 * expressed relative to the relay that carries its SDP exchange, so it is not an address
 * anybody can reach without first reaching the relay. `fabric-node.ts`'s predicate —
 * "some listen address that is not `/p2p-circuit`" — would read `/webrtc` as a bindable
 * socket and answer `true` here, and the certificate would then claim `seed`
 * discoverability for a node no newcomer can dial.
 *
 * **This is not a branch on node kind.** It is a function of the listen list, and a Node
 * process configured with `listen: ['/p2p-circuit']` gets the same answer for the same
 * reason. The distinction is the whole of `PROJECT.md`'s rule: the browser's difference
 * is *discovery*, and this is the one place discovery is read.
 */
function canRelayFrom(listen: readonly string[]): boolean {
  return listen.some((address) => !address.includes('/p2p-circuit') && !address.includes('/webrtc'))
}

/**
 * Obtain this tab's certificate, or establish that it was never asked for — AUTH-01.
 *
 * **The browser-tier twin of `resolveCertificate` in `packages/node/src/fabric-node.ts`**,
 * and deliberately the same shape: same three-arm outcome, same `UNREACHABLE_PROVIDER`
 * prefix, same one throw site, same reuse-a-persisted-certificate decision, same
 * `peerIdForNodeKey` identity check. Read that one for what each step is for; only the
 * store differs, and it differs because a tab has IndexedDB where a process has a
 * directory.
 *
 * It is a separate function rather than a shared one because `@o2/browser` does not
 * depend on `@o2/node` and must not — see this plan's summary for the packaging finding.
 * The duplication is real and is recorded rather than hidden.
 */
/**
 * The bytes a TURN mint request is signed over — the SIGNER's side, NET-12.
 *
 * `@o2/cloudflare`'s `turnMintPayload` builds the identical object on the verifier's side. Only
 * {@link TURN_MINT_PURPOSE} crosses the package boundary, because a callable on `@o2/core`'s
 * barrel reachable solely through the `window.o2` hop would need room in a disposition register
 * that is full and frozen. `dag-cbor` sorts keys so field ORDER cannot drift; the field SET is
 * held identical by `turn-mint-payload.node.test.ts`, which builds both sides and compares bytes.
 */
function turnMintBytes(nodeKey: string, region: string, requestedAt: number): Uint8Array {
  const encoded = encodeCanonical({ purpose: TURN_MINT_PURPOSE, nodeKey, region, requestedAt })
  if (!encoded.ok) throw new Error(`TURN mint payload is not encodable: ${String(encoded.error.kind)}`)
  return encoded.bytes
}

async function resolveCertificate(parts: {
  enrollment: BrowserNodeOptions['enrollment']
  identity: NodeIdentity
  rpc: RpcEndpoint
  libp2p: Libp2p
  identityStore: IdbIdentityStore
  canRelay: boolean
  relayPeerIds: readonly string[]
  /**
   * Whether the persisted certificate may satisfy this call — AUTH-04. The Node tier's
   * twin carries the full argument; the short form is that a renewal must not be allowed
   * to hand back the very certificate it is replacing, which would make the loop a no-op
   * that reports success.
   */
  reuse: 'may-reuse-a-persisted-certificate' | 'must-obtain-a-fresh-certificate'
}): Promise<NodeCertificate | null> {
  const { enrollment, identity, rpc, libp2p, identityStore, canRelay, relayPeerIds } = parts

  // Nobody asked. `null` means exactly this, here and nowhere else — which is why the
  // failure paths below throw rather than widening this return type.
  if (enrollment === undefined) return null

  // A persisted, unexpired certificate is reused and the provider is not contacted at
  // all. The identity check goes through `peerIdForNodeKey` rather than comparing
  // `nodeKey` strings for the reason the Node tier's copy gives at length: a `nodeKey`
  // that is not valid lowercase hex yields `null`, which is not `identity.peerId`, so a
  // hand-edited record fails closed instead of being compared string to string.
  //
  // The case this catches in a tab is the one `whenSeedIsGone` describes: storage was
  // evicted, a new seed was minted, and a certificate naming the *old* node survived —
  // or, just as real, an origin whose database was copied between profiles.
  const loaded =
    parts.reuse === 'may-reuse-a-persisted-certificate'
      ? await identityStore.loadCertificate()
      : null
  if (
    loaded !== null &&
    peerIdForNodeKey(loaded.nodeKey) === identity.peerId &&
    loaded.expiresAt > Date.now()
  ) {
    return loaded
  }

  // The dial, inside a `try/catch` that assigns rather than returns — so an unreachable
  // provider arrives as the `unreachable` arm with the operator-facing prefix, and not as
  // a raw libp2p dial error one step before `enrolOverRpc` is entered.
  type Dialed =
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

  // Signs a local structure and touches no network, so it depends on nothing from the
  // dial. The middle argument is what holds the user's *private* half: `userKey` comes
  // from it rather than from a field, and it signs the `ownerProof` the authority refuses
  // enrollment without. A `CryptoKeyPair` becomes a `UserSigner` here — the one place this
  // package converts, so nothing downstream has to know which arm the visitor took.
  const user =
    enrollment.userPrivateKey instanceof Uint8Array
      ? enrollment.userPrivateKey
      : await subtleUserSigner(enrollment.userPrivateKey)
  const request = await requestEnrollment(identity.seed, user, {
    operatorId: enrollment.operatorId,
    discoverability: canRelay ? 'seed' : 'via-relay',
    relayIds: canRelay ? [] : [...relayPeerIds],
  })

  const outcome: EnrolOutcome = dialed.ok
    ? await enrolOverRpc(rpc, dialed.peerId, request)
    : dialed

  if (!outcome.ok) {
    // One throw site for all three failure kinds and both routes into `unreachable`, so
    // the operator-facing format cannot differ between "the provider refused you" and
    // "nothing answered at that address".
    throw new Error(
      `enrollment with ${enrollment.providerAddr} failed (${outcome.kind}): ${outcome.reason}`,
    )
  }

  await identityStore.saveCertificate(outcome.certificate)
  return outcome.certificate
}

/**
 * The store name a tab uses when its caller named none.
 *
 * A literal in `#compose` until 2026-08-14, when {@link enrolledIssuer} became a second
 * reader of it. Two copies of a database name is a defect that presents as a node with no
 * identity rather than as an error, so there is one.
 */
const DEFAULT_BLOCKSTORE_NAME = 'o2-blocks'

/**
 * The identity database's name, derived from the blockstore's — see `idb-identity-store.ts`
 * for why the two are separate databases in the first place.
 */
function identityStoreName(blockstoreName: string): string {
  return `${blockstoreName}-identity`
}

/**
 * Thrown when a caller asks for a node that can never start — AUTH-06.
 *
 * `writes-no-new-secret` promises this tab persists no new secret. `whenSeedIsGone:
 * 'refuses-to-start-without-its-seed'` promises it will not run without a stored one.
 * Together they describe a node that cannot bootstrap and, once IndexedDB is evicted —
 * which happens silently, under storage pressure, and is the recorded difference between a
 * tab and a `blockstoreDir` — can never start again.
 *
 * Refused at `start` by name rather than left to present as a tab that stopped working,
 * because the two fields are set in different places by different people and the
 * contradiction is invisible from either one of them.
 */
export class ContradictoryIdentityPolicyError extends Error {
  constructor() {
    super(
      "identityProtection: { kind: 'writes-no-new-secret' } and whenSeedIsGone: "
        + "'refuses-to-start-without-its-seed' cannot both hold — the first says this tab persists no "
        + 'new secret and the second says it will not start without a persisted one, so this node could '
        + 'never bootstrap and, once its storage were evicted, could never start again. Supply a '
        + "passphrase, or choose 'mints-a-new-identity'.",
    )
    this.name = 'ContradictoryIdentityPolicyError'
  }
}

/** What {@link resolveProtectedSeed} hands back: the bytes, and whether they are in the clear. */
interface HeldSeed {
  readonly seed: Uint8Array<ArrayBuffer>
  /**
   * `true` on exactly one path — a pre-AUTH-06 plaintext record adopted by a tab that
   * supplied no passphrase. It exists so *"this identity is readable by anyone who copies
   * this profile"* is a value a caller can act on rather than a fact nobody is told.
   */
  readonly unprotected: boolean
}

/**
 * One derived key per start, for both of this tab's secrets — AUTH-06.
 *
 * The salt is read (or created) and the key derived **outside every transaction**, because
 * Argon2id is asynchronous and costs hundreds of milliseconds, and awaiting it inside an
 * IndexedDB transaction would commit that transaction out from under the check it exists to
 * carry. `idb-identity-store.ts`'s `loadOrMintSealedSeed` states the constraint at length
 * and gives the measured race it is the fix for.
 *
 * `null` means the caller promised to write no new secret, so no key exists and none is
 * needed.
 */
interface SealBinding {
  readonly key: Uint8Array
  readonly salt: Uint8Array<ArrayBuffer>
}

/**
 * Read, migrate or mint one of this tab's two long-lived secrets — AUTH-06.
 *
 * Both call sites take the **same** {@link SealBinding}, not a second derivation, so one
 * database cannot end up with two keys; and the provider signing key is sealed under the
 * same passphrase as the node seed because it is the higher-value of the two — the trust
 * root every certificate this tab ever signs verifies against.
 *
 * ## The unlock failure throws before `whenSeedIsGone` is reachable, and that is criterion 4
 *
 * `whenSeedIsGone` governs the **absent** case only. A record that is present and does not
 * open is not an absent record, so the mint arm below is unreachable from an unlock failure
 * — which is the whole of what criterion 4 forbids, because the function this replaced
 * minted whenever it found nothing and a decrypt failure that fell through would have walked
 * into a silent re-mint: a working tab, a different peer id, an orphaned certificate, and
 * nothing anywhere saying so.
 *
 * ## The key is derived once, and the envelope decides whether it is the right one
 *
 * `openWithKey` is tried only when {@link sealedUnderSameKey} says the envelope's salt and
 * cost parameters are the ones this key was derived under. Never *try and fall back on
 * failure*: matching parameters plus a failed open **is** the wrong passphrase, and a
 * fallback derivation would spend another Argon2id producing the same key and the same
 * refusal. `openSecret` — which derives from the envelope's own parameters — is the path for
 * a record written under older ones, which is criterion 5 on this tier.
 */
async function resolveProtectedSeed(options: {
  readonly store: IdbIdentityStore
  readonly protection: IdentityProtection
  readonly binding: SealBinding | null
  readonly legacy: () => Promise<Uint8Array<ArrayBuffer> | null>
  readonly sealed: (binding: SealBinding, mint: () => Uint8Array<ArrayBuffer>) => Promise<SealedSecret>
  readonly mint: () => Uint8Array<ArrayBuffer>
}): Promise<HeldSeed> {
  const { store, protection, binding } = options

  if (protection.kind !== 'passphrase' || binding === null) {
    // **Reported, never repaired.** Deleting somebody's identity because they supplied no
    // passphrase is a worse outcome than the exposure it would close: the tab would come
    // back as a stranger, with every certificate naming it orphaned.
    const existing = await options.legacy()
    if (existing !== null) return { seed: existing, unprotected: true }
    return { seed: options.mint(), unprotected: false }
  }

  const envelope = await options.sealed(binding, options.mint)
  let opened: Uint8Array
  try {
    opened = sealedUnderSameKey(envelope, DEFAULT_KDF_PARAMS, binding.salt)
      ? openWithKey(binding.key, envelope)
      : await openSecret(envelope, protection.passphrase)
  } catch (cause: unknown) {
    throw new SealedIdentityUnlockError(store.name, cause)
  }
  // A decrypted blob is external data, whatever produced it — the same rule
  // `parseSealedSecret` states for a stored envelope, applied to what comes out of one.
  if (opened.length !== SEED_BYTES) throw new SeedLengthError(opened.length)
  const seed = new Uint8Array(SEED_BYTES)
  seed.set(opened)
  return { seed, unprotected: false }
}

/**
 * The issuer this origin's node enrolled with, or `null` — AUTH-02's production anchor.
 *
 * ## Why a tab has to ask this *before* it starts
 *
 * `BrowserNodeOptions.trustedIssuers` is read by `PeerVerifier.start`, which `#compose`
 * builds **before** `resolveCertificate` — deliberately, so the enrolment dial's
 * `peer:connect` reaches a live listener. So a tab cannot pin the provider it is about to
 * enrol with in the same `start` call: at the moment the set is fixed, the certificate
 * naming that provider does not exist yet. This function is the way round that ordering,
 * and it is not a workaround for it — the anchor it returns was obtained by *this origin's
 * own* enrolment on an earlier start, which is exactly what makes it an anchor rather than
 * a peer's word for a peer's identity.
 *
 * **The consequence, stated plainly rather than left to be discovered: a tab pins nobody
 * until it has enrolled once.** That is not a weakening of anything, because a tab that
 * never enrolled has no independently-held key to pin *with*; `demo/main.ts`'s
 * `peerCertificate` has made the identical argument since Phase 22 — *"a tab enrolled by
 * nobody has no anchor and therefore names nobody, which is the honest answer and not a
 * degradation."* It is also what keeps a first visit working: pinning an issuer a fresh tab
 * cannot verify anybody against would empty its block source of the relay that is its only
 * peer, for no gain.
 *
 * ## What is deliberately not checked here
 *
 * Neither the expiry nor the `nodeKey`. Both are `resolveCertificate`'s business and it
 * applies them to decide whether to *reuse* the certificate; they are the wrong questions
 * for this one. A certificate that has lapsed, or that names a seed this origin has since
 * lost, still names the provider this origin enrolled with — and that provider's key is no
 * less this tab's anchor for the certificate around it having gone stale. Refusing to pin
 * on an expired certificate would mean a tab silently *widened* who it takes blocks from
 * at the moment its own paperwork lapsed, which is the wrong direction for a gate to fail.
 */
export async function enrolledIssuer(blockstoreName?: string): Promise<PublicKeyHex | null> {
  const store = await IdbIdentityStore.open(
    identityStoreName(blockstoreName ?? DEFAULT_BLOCKSTORE_NAME),
  )
  try {
    return (await store.loadCertificate())?.issuer ?? null
  } finally {
    store.close()
  }
}

/**
 * The **user** this origin's node enrolled as, or `null` — AUTH-03's browser tier.
 *
 * {@link enrolledIssuer}'s sibling, reading the other field of the same stored certificate,
 * and every word of that function's ordering argument applies here unchanged: the
 * certificate is resolved *inside* `BrowserNode.start`, so a caller composing
 * `BrowserNodeOptions` cannot derive anything from the one this start is about to obtain.
 * It reads the certificate an **earlier** start stored.
 *
 * ## What it is for, and why it is not a configuration parameter
 *
 * A tab enrolled with its own key **is a node of that user's owner domain** — it is the
 * person's own device, holding the person's own key. `BrowserNodeOptions.sovereignty`
 * exists to say so, and `TabApi.start` deliberately carries no parameter for it
 * (`tab-api.ts:816`): an origin that was found rather than configured must not get to
 * declare whose sovereign work this device will run. Reading it back out of *this origin's
 * own* stored certificate is the same move `enrolledIssuer` makes and is not configuration
 * arriving from anywhere.
 *
 * ## Clearing a tab for its own owner opens nothing, and that is worth stating
 *
 * `canExecuteSovereign` decides whether the executor's sovereignty guard will *consider* a
 * task; it does not decide who may send one. `authorizeCapability` still requires a
 * delegation chain rooted at this key and addressed to this node, and the private half of a
 * visitor's key is minted `extractable: false` and never leaves the browser profile that
 * made it. So the only parties who can use the clearance are the owner's own tabs — which
 * is precisely the set `owner-domain` is a claim about.
 *
 * **The one-start delay is inherited and is the same delay.** A first visit enrols and is
 * cleared for nobody; from the next start onwards the tab is an owner node of its own
 * owner. `enrolledIssuer` has carried that shape since Phase 22 and states why it is right
 * rather than merely tolerable.
 */
/**
 * Which invitation this origin's visitor is owed — AUTH-06, plan `42-04`.
 *
 * {@link enrolledIssuer}'s shape exactly, reading a different record of the same database:
 * open the default identity store for this origin, ask it one question, close it. The name
 * is derived here rather than by the caller for the reason {@link DEFAULT_BLOCKSTORE_NAME}
 * exists at all — *two copies of a database name is a defect that presents as a node with no
 * identity rather than as an error.*
 *
 * It writes nothing and opens no envelope, so a page may call it before a visitor has typed
 * anything. That is the whole point: *which field do I show you* precedes the passphrase.
 */
export async function storedIdentityKind(
  blockstoreName?: string,
): Promise<'none' | 'sealed' | 'legacy-plaintext'> {
  const store = await IdbIdentityStore.open(
    identityStoreName(blockstoreName ?? DEFAULT_BLOCKSTORE_NAME),
  )
  try {
    return await store.storedSeedKind()
  } finally {
    store.close()
  }
}

/**
 * Destroy this origin's stored identity — T-42-24, the escape hatch behind *start over*.
 *
 * {@link storedIdentityKind}'s shape, writing where that one reads. It exists because a
 * forgotten passphrase is otherwise a permanent lockout: the seal is against an offline
 * attacker holding a disk image, so a recovery path would be a second way in and would
 * defeat the thing it is a recovery for. There is no server, no account and no third party
 * holding anything of this visitor's — the one party that ever saw anything, an enrolment
 * provider, saw a signature over the **public** half — so there is nothing anywhere to
 * recover from and nothing here can invent one.
 *
 * **The cost is the visitor's to accept, and the surface must say what it is** before this is
 * reached: they become a different node, they must enrol again, and the certificate the old
 * key holds is abandoned. The difference between this act and the defect criterion 4 forbids
 * is not the outcome — both end with a different node — it is **who decided, and whether they
 * were told**.
 */
export async function forgetIdentity(blockstoreName?: string): Promise<void> {
  const store = await IdbIdentityStore.open(
    identityStoreName(blockstoreName ?? DEFAULT_BLOCKSTORE_NAME),
  )
  try {
    await store.forgetStoredIdentity()
  } finally {
    store.close()
  }
}

/**
 * Open this origin's identity under a passphrase, without starting anything — AUTH-06.
 *
 * ## Why the sign-in surface cannot get here through `start`
 *
 * Sealing happens inside the node-start path, and a start needs a relay. Four e2e fixtures
 * serve the demo page from a static host with **no relay at all** — `demo-regions` waits for
 * `#state`'s tone to become `'blocked'` for exactly that reason — so if registering could
 * only seal by starting a node, registering would fail on every one of them and the page
 * would be unreachable behind its own entry screen. Every act below is an IndexedDB act, and
 * every one of them succeeds offline.
 *
 * That is also what makes *"the node starts automatically"* honest rather than a slogan: what
 * signs a visitor in is **opening their envelope**, and the start is attempted afterwards. A
 * start that fails is a reported state on a page whose visitor is still signed in.
 *
 * ## It reuses {@link resolveProtectedSeed} rather than repeating its decisions
 *
 * The `sealedUnderSameKey` / `openWithKey` / `openSecret` order is a correctness property —
 * *matching parameters plus a failed open **is** the wrong passphrase* — and two copies of it
 * would drift. So this composes the same function `start` composes, with the same store, and
 * the only thing it does differently is stop before libp2p exists.
 *
 * `whenAbsent` is the difference between the two controls the page renders. **Register**
 * mints and seals; **log in** refuses, because a login that quietly created an account is a
 * login that turns a mistyped passphrase into a second identity — which is criterion 4's
 * failure arriving through a door criterion 4 was not looking at.
 *
 * A wrong passphrase throws {@link SealedIdentityUnlockError}. No branch below mints on that
 * path: a record that is present and does not open is not an absent record.
 */
export async function unsealIdentity(options: {
  readonly passphrase: string
  readonly blockstoreName?: string
  readonly whenAbsent: 'mints-and-seals-a-new-identity' | 'refuses-to-mint'
}): Promise<NodeIdentity> {
  const protection: IdentityProtection = { kind: 'passphrase', passphrase: options.passphrase }
  // Before anything is derived, so a short passphrase costs a string length rather than an
  // Argon2id derivation and its refusal cannot be confused with a decryption failure.
  assertUsablePassphrase(protection)
  const store = await IdbIdentityStore.open(
    identityStoreName(options.blockstoreName ?? DEFAULT_BLOCKSTORE_NAME),
  )
  try {
    const salt = await store.loadOrCreateSalt()
    const binding: SealBinding = {
      salt,
      key: await deriveSealKey(options.passphrase, salt, DEFAULT_KDF_PARAMS),
    }
    const held = await resolveProtectedSeed({
      store,
      protection,
      binding,
      legacy: async () => store.legacyPlaintextSeed(),
      sealed: async (bound, mint) =>
        store.loadOrMintSealedSeed(bound.key, DEFAULT_KDF_PARAMS, bound.salt, mint),
      mint: () => {
        if (options.whenAbsent === 'refuses-to-mint') {
          throw new Error(
            `no identity in ${store.name}: there is nothing here for a passphrase to open, so `
              + 'this browser has not registered yet',
          )
        }
        return generateSeed()
      },
    })
    return identityFromSeed(held.seed)
  } finally {
    store.close()
  }
}

export async function enrolledUserKey(blockstoreName?: string): Promise<PublicKeyHex | null> {
  const store = await IdbIdentityStore.open(
    identityStoreName(blockstoreName ?? DEFAULT_BLOCKSTORE_NAME),
  )
  try {
    return (await store.loadCertificate())?.userKey ?? null
  } finally {
    store.close()
  }
}

/**
 * What this node answers a peer's `records` and `providers` requests with — AUTH-01,
 * SCHED-01.
 *
 * Byte-for-byte `fabric-node.ts`'s `ownRecords`, for the reason that file gives; the five
 * decisions it carries are written down there and are not restated here, because two
 * copies of a rationale drift and this file's whole claim is that it does not diverge from
 * that one. A node holding no certificate still holds blocks, and under owner ruling D1 it
 * answers for them — `records: 'holds-no-records'` is about a signed identity and says
 * nothing about bytes.
 */
/**
 * This tab's records as they stand right now — the browser twin of `fabric-node.ts`'
 * `recordsFrom`, split out for the identical reason. One function computes it and the
 * index, the DHT publisher and `BrowserNode.certificate` all read through it, so a
 * certificate that changes under them cannot leave the three disagreeing.
 */
function recordsFrom(
  certificate: NodeCertificate | null,
  identity: NodeIdentity,
  canExecuteSovereign: boolean,
): NodeRecords | 'holds-no-records' {
  if (certificate === null) return 'holds-no-records'
  return {
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
  }
}

function ownRecords(
  holder: CertificateHolder,
  identity: NodeIdentity,
  canExecuteSovereign: boolean,
  store: Blockstore,
  withhold: SelfRecordIndexOptions['withhold'],
): SelfRecordIndex {
  return new SelfRecordIndex({
    nodeKey: identity.nodeKey,
    store,
    // A thunk — AUTH-04 renewal. A tab renews on the same fraction a server does, because
    // this module's own rule is that all nodes have equal functionality and the only
    // difference is discovery. A tab that could not renew would be a tab that expired.
    records: () => recordsFrom(holder.current, identity, canExecuteSovereign),
    withhold,
  })
}

/**
 * This tab's own start outcome, or the named statement that it has none to report —
 * BROW-02.
 *
 * ## Why a node records a row about itself at all
 *
 * `serveAgent`'s report branch records only what a **peer** told it, so without this a
 * node asked for its counts hands the asker back the asker's own row. `mergeOverlapping`
 * takes the maximum per `(browser, result)` key, so a merged report across two tabs reads
 * 1 and across twenty tabs reads 1 — a metric that cannot exceed the local reading
 * whatever the fabric does. The arithmetic is worked through in
 * `.planning/phases/phase-20-single-job-path-ledger-churn-resilience/20-CONTEXT.md`.
 *
 * ## Why the sentinel arm is a guard and no longer a reachable state
 *
 * A label this build cannot file is not a row: `parseCounts` drops it at the wire, so
 * filing it locally would give this tab a report a peer can never corroborate, with the
 * two readings disagreeing and nothing saying which is wrong. The honest answer to such a
 * label is that this tab has nothing to report.
 *
 * **This tier used to reach that answer, and the reason it did was a defect.**
 * `currentBrowserLabel()` derives its answer from a user-agent string this build has never
 * seen, and `browserLabel` interpolated the major unbounded while `isStartBrowserLabel`
 * admitted four digits — so a five-digit visitor started and reported nothing whatever,
 * which is the silence BROW-02 exists to expose, produced by the reporter. `browserLabel`
 * is now bounded by `MAX_BROWSER_MAJOR`, the ceiling that predicate is derived from, and
 * drops an out-of-range version to the family alone. Every label this tier composes is one
 * the wire admits.
 *
 * The arm stays because the parameter is a `string` and this predicate is where the range
 * is enforced — a caller other than the one composer is a refactor away, and a guard that
 * has to be re-derived at that point is a guard that will not be. It is defensive now, and
 * saying so is cheaper than a fixture pretending to reach it.
 *
 * A node reaching this function **started** — there is no path through `#compose` that
 * arrives here otherwise — so the result arm is not a value a caller chooses. That is why
 * it is derived here rather than taken as a `BrowserNodeOptions` field; see the plan
 * summary for the measured fan-out a required field would have carried.
 *
 * `fabric-node.ts` holds the byte-identical function over its own label, which is the
 * standing rule that file's module comment states in the imperative: all nodes have equal
 * functionality, and a browser label and `'other'` are two values of one field rather than
 * two kinds of node.
 */
function ownStartOutcome(label: string): StartOutcome | 'reports-no-start-outcome' {
  return isStartBrowserLabel(label)
    ? { browser: label, result: { kind: 'started' } }
    : 'reports-no-start-outcome'
}

/**
 * A ledger holding this tab's own row, ready for `serveAgent`'s hook — BROW-02, BROW-01.
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
 * - `consent` is **may this row leave at all**. It is the visitor's answer to
 *   `DISCLOSURE.reporting`, and it is the whole of BROW-01 at this tier.
 * - `outcome` is **is there a row this build could file**. A label outside the coarse
 *   range is refused by `parseCounts` at the wire, so filing it locally would give this
 *   tab a reading no peer can corroborate.
 *
 * Merging them would make a consenting visitor whose label is unfileable indistinguishable
 * from one who declined, and the next reader would have one condition to re-derive two
 * meanings from. DATA-10 made the same call for the same reason — a CID-keyed durable set
 * and a payload-keyed job-scoped guard were kept as two mechanisms rather than one.
 *
 * ## Why the consent is taken here rather than applied when a report goes out
 *
 * Because a row that was never recorded cannot be forgotten about. See
 * {@link StartReportingConsent} in `@o2/core`, which carries that argument in full; the
 * short form is that `serveAgent`'s report branch is not the only thing that will ever
 * read a ledger, and an egress filter has to be re-derived at each site that does.
 *
 * ## What a visitor's later change of mind does, stated rather than left to be found
 *
 * The consent is read **once, at construction**. A visitor who turns reporting *on* after
 * their node started is not counted until it restarts, which is the safe direction and is
 * the only one this reaches: `revokeConsent` stops the node before it forgets the consent,
 * and the gate that re-grants is only rendered while no node is running. The unsafe
 * direction is therefore not reachable from the page — but it *is* reachable by calling
 * `window.o2.grantConsent` directly with a narrower `reporting` while a node runs, and
 * that residue is recorded here rather than in a plan nobody reads.
 *
 * `fabric-node.ts` holds the byte-identical function.
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

export class BrowserNode {
  readonly libp2p: Libp2p
  readonly transport: Libp2pTransport
  readonly rpc: RpcEndpoint
  /**
   * Wraps `transport` so every outbound RPC frame is recorded — DATA-05/DATA-06.
   *
   * A new field, not a type change to `transport` — mirrors `fabric-node.ts`.
   * `rpc` is constructed over this field, not over `transport`.
   */
  readonly egress: EgressGuard
  /** IndexedDB plus network fallback — what the executor reads from. */
  readonly blockstore: FetchingBlockstore
  readonly store: ObservingBlockstore<IdbBlockstore>
  /** See {@link registrationRefusal}. Written once, after start. */
  #registrationRefusal: string | undefined
  readonly #publisher: RecordPublisher | null
  readonly #announcer: DhtProviderAnnouncer
  /**
   * Who advertises a block, and what a node's signed records say — SCHED-01, NET-06.
   *
   * The **asking** index. Same composition as the backbone's, deliberately: a tab differs
   * in what it can listen on, never in what it may ask.
   */
  readonly recordIndex: RecordIndex
  /**
   * This tab's Kademlia handle, typed — the same reading `FabricNode.dht` carries, and
   * present here for the reason every pair on these two classes is: a tab differs from a
   * backbone node in what it can listen on, never in what it may ask.
   */
  readonly dht: KadDHT
  /**
   * This tab's durable sovereign-CID set — DATA-10.
   *
   * Exposed for the reason `FabricNode.sovereignCids` is, and the reason is the same
   * sentence one tier over: a submitter has to hand it to its own job. `submitJob`'s
   * blockstore-put is where this node comes to hold the row, the put writes into *this*
   * node's {@link store}, so it is *this* node's set that has to record it. A page that
   * omits it holds the row unguarded the moment its job's holds are given back — which
   * is the whole of the at-rest gap, and is why the option exists rather than being
   * inferred from the shard label alone.
   *
   * **No `'forgets-sovereignty-between-jobs'` arm here, and the asymmetry with the Node
   * tier is a storage fact rather than a capability.** That tier answers the sentinel for
   * a node started with no `blockstoreDir`: there is nowhere durable to record anything,
   * and saying so beats a set that quietly evaporates on exit. A tab has no such state —
   * `IdbSovereignCids.open` runs unconditionally in `start`, because an origin that cannot
   * open IndexedDB cannot host a `BrowserNode` at all. So the absence has no spelling
   * here, which is the right shape: it is not a thing a tab can be without.
   *
   * What it does **not** promise, stated because the honest limit belongs at the field a
   * caller reads: IndexedDB is evicted silently under storage pressure, so a tab that
   * loses this database comes back not knowing a row was sovereign.
   * `idb-sovereign-cids.ts` records that at length, including that it is unmeasured.
   */
  readonly sovereignCids: SovereignCids
  /** Where this tab's seed, provider key and certificate live across reloads — AUTH-01. */
  readonly identityStore: IdbIdentityStore
  /**
   * Whether this tab's identity is readable by anyone who copies this browser profile —
   * AUTH-06.
   *
   * `true` on exactly one path: a pre-AUTH-06 plaintext record adopted by a tab started
   * with `identityProtection: { kind: 'writes-no-new-secret' }`. It is **reported and never
   * repaired** — deleting somebody's identity because they supplied no passphrase is a worse
   * outcome than the exposure it would close, since the tab would come back as a stranger
   * with every certificate naming it orphaned. The exposure closes the moment a passphrase
   * is supplied, at which point the same bytes are sealed in place and the peer id does not
   * move.
   *
   * A value rather than only a log line, so a surface above this one can act on it. `start`
   * additionally says it once, by name, on the console.
   */
  readonly identityIsUnprotected: boolean
  /**
   * This tab's provider-signed certificate, or `null` when it holds none — AUTH-01.
   *
   * `null` is the answer for a node nobody asked to enrol, and it is not a failure. Nor
   * is it a lesser tier: a node with a certificate executes tasks, holds blocks and takes
   * quorum slots on exactly the terms as one without, and what the certificate buys is
   * being taken *by a peer that pinned an issuer*. Public, because a certificate is a
   * public signed statement — every peer is meant to be able to read it. Mirrors
   * `FabricNode.certificate`, which carries the long form.
   */
  readonly #certificates: CertificateHolder
  /**
   * Governed: throttles with tab visibility.
   *
   * Typed as the concrete `GovernedExecutor` rather than the `Executor` port so the
   * always-visible surface (BROW-04) can read `executed` and `dutyCycle`. It still
   * satisfies the port everywhere one is wanted.
   */
  readonly executor: GovernedExecutor
  /**
   * The same executor, with this tab's signature over whatever it returns — VER-08.
   *
   * **The outermost layer, and the one `serveAgent` serves from.** {@link executor} is
   * the layer beneath it, typed concretely because BROW-04's always-visible surface reads
   * `executed` and `dutyCycle` off it; this field is that stack with the signing wrapper
   * on top, typed as the port because a caller composing a job wants an `Executor` and
   * nothing more. Both names reach the same worker, the same counter and the same
   * governor — the counter still increments, because the wrapper delegates.
   *
   * ## Why it is exposed rather than left private to the factory
   *
   * Plan 19-15 composed the wrapper and handed it only to `serveAgent`, which made every
   * result that *left* this tab signed and every result dispatched to it **in-process**
   * unsigned. That reading was stated at the composition below and it was truthful: a
   * node's signed statement to itself establishes nothing it did not already hold.
   *
   * It is the wrong shape for the receipt, and Plan 19-11 measured why. A page composing
   * its own job puts its own executor in the list — `demo/main.ts` does it on every run,
   * not only on `includeSelf` — so an unsigned self-replica made `receiptFor` report the
   * named absence for **every** job the demo has ever submitted, including one this tab
   * ran entirely by itself. The receipt's audience is not this tab. It is whoever is
   * shown the answer, and for them *"a node this provider enrolled computed this, once,
   * and it was not independently verified"* is a real statement where *"this requestor
   * cannot account for who ran it"* is a false one about a job the requestor ran itself.
   *
   * **Nothing here is special-cased into a label.** A self-dispatch through this field
   * produces a signed outcome on exactly the terms a peer's does, is verified by
   * `receiptFor` on exactly the terms a peer's is, and is refused on the same terms if the
   * signature or the certificate does not check out. A tab nobody enrolled composes this
   * field too and it is then the identity — `attestResults` returns its argument for a
   * node holding no identity — so such a tab's self-replica stays unaccounted and its
   * receipt stays the named absence. The strength follows what was established.
   */
  readonly signingExecutor: Executor
  readonly governor: VisibilityGovernor
  /**
   * The user's cap — SCHED-04. Distinct from {@link governor}, which stays the
   * environment signal.
   *
   * Private because the two are easy to confuse and only one of them is settable: a caller
   * wanting to change the cap uses {@link setDutyCycle}, and a caller wanting the effective
   * rate reads {@link dutyCycle}, which is already the lower of the two.
   */
  readonly #capGovernor: DutyCycleGovernor
  /**
   * This tab's execution admission control — SCHED-06.
   *
   * `admission.slots` is the declared limit and `admission.peakInFlight` says
   * whether it was ever **reached**. It does **not** say whether it *held*:
   * `LocalCapacity.offer()` returns its refusal before the reservation is taken, so
   * `peakInFlight <= slots` is arithmetic and cannot fail. The reading that can
   * falsify the bound is {@link executorPeakInFlight}.
   */
  readonly admission: LocalCapacity
  /**
   * How this tab answers an offer addressed to **itself** — SCHED-03 and RUN-02.
   *
   * ## What was wrong before this member existed, measured rather than supposed
   *
   * `AgentOptions.paused` is consulted at `net/src/agent.ts`, inside `serveAgent`, and
   * `serveAgent` answers **peers**. A tab running its own work does not go through it:
   * `rpcAdmission`'s first branch short-circuits the wire for an offer addressed to the
   * submitter — *"a node does not learn its own capacity over a wire"* — and the port it
   * consults there was {@link BrowserNode.admission}, a bare `LocalCapacity` that has never
   * heard of `paused`. Two more sites did the same on the `prefers-local-combining`
   * placement.
   *
   * **So a paused tab refused every peer and went on computing its own work.** That is the
   * exact inverse of the rule this file already states twice in its own words — see the
   * `authorize` hoist below, *"a tab that admitted its own work by a rule other than the one
   * it admits a peer's by would be more permissive to itself than to everybody else. One
   * value, two readers, no way for them to disagree"* — and `demo/main.ts` says the same
   * about the two ports it passes. The sentences were right and the wiring did not match
   * them.
   *
   * ## What this is
   *
   * The **one reading every local path takes**, with `paused` folded in. The bound goes on
   * the one reading rather than at the three call sites, which is Phase 31's recorded
   * pattern: *"a bound is enforced on the one reading every path takes, never at the call
   * sites."* It closes over the **same** `paused` value that goes to `serveAgent`, not a
   * second copy of it, so the two readers cannot disagree.
   *
   * Its refusal is `pausedAnswer`'s `offer` arm in `LocalAdmission` clothing: capacity
   * published **unchanged**, `standing: 'declining-all-work'`, and `pausedRefusal`'s string
   * rather than a second one composed here. The figures say *my capabilities have not
   * shrunk*; the standing says *and I am not taking work anyway*.
   *
   * {@link BrowserNode.admission} stays exposed unchanged, because `demo/main.ts` reads
   * `admission.slots` and that reading is about **capacity**, which this does not move.
   */
  readonly localAdmission: LocalAdmission
  /**
   * The one authorizer this tab serves with — AUTH-03.
   *
   * **Exposed so there is exactly one of it.** `serveAgent` consults this when a *peer*
   * asks this tab to do work; `reduceJob`'s `prefers-local-combining` placement consults
   * the same value when this tab asks *itself*. Building a second `authorizeCapability`
   * for the local path would be a second place one decision is made, able to disagree
   * with the first with nothing able to catch the disagreement — the objection
   * `reduce-job.ts` records against a second issuer set on `submitJob`, one hook over.
   *
   * Read-only and never re-derived: the audience and owner key it closes over are
   * settled at construction, and a caller that could swap it could make this tab admit
   * to itself what it refuses to everyone else.
   */
  readonly authorize: Authorizer
  /** The instrument {@link executorPeakInFlight} reads. */
  readonly #counter: CountingExecutor
  /**
   * The thread tasks run on.
   *
   * Never absent — {@link BrowserNodeOptions.createWorker} is required, so "a tab
   * computing with nothing able to interrupt it" has no spelling. Same move
   * `EgressHold` made against "release a hold you never took". `stop()` kills this,
   * which is what makes "one click drops CPU to zero" a property of the platform
   * rather than of this code behaving.
   */
  readonly worker: WorkerExecutor
  /**
   * Peers whose work this node has run, and how much of it — BROW-04.
   *
   * The surface must say what is running *and for whom*. A `Task` is addressed
   * entirely by CID and names no requestor, so this is recorded where the answer
   * exists: at the point this node begins running it, which is the only point at
   * which both facts are known.
   *
   * Requests this node turned away are not here. They stay legible through
   * {@link admission} — `slots`, `inFlight`, `peakInFlight` — which is what a
   * refusal is a fact about.
   */
  readonly servedFor: Map<string, number> = new Map<string, number>()
  readonly #activityListeners = new Set<() => void>()

  /**
   * Subscribe to "this node is now doing something different".
   *
   * Pushed rather than polled for the reason measured in this phase: Chromium
   * throttles timers hard in a tab that is not in front, so a background tab
   * serving a peer's work would show a stale surface — or none — for as long as
   * nobody was looking at it, which is the case BROW-04 exists for.
   */
  onActivity(listener: () => void): () => void {
    this.#activityListeners.add(listener)
    return () => {
      this.#activityListeners.delete(listener)
    }
  }

  #announce(): void {
    for (const listener of this.#activityListeners) listener()
  }

  private constructor(parts: {
    recordIndex: RecordIndex
    dht: KadDHT
    publisher: RecordPublisher | null
    announcer: DhtProviderAnnouncer
    libp2p: Libp2p
    transport: Libp2pTransport
    rpc: RpcEndpoint
    egress: EgressGuard
    blockstore: FetchingBlockstore
    store: ObservingBlockstore<IdbBlockstore>
    sovereignCids: SovereignCids
    identityStore: IdbIdentityStore
    identityIsUnprotected: boolean
    certificates: CertificateHolder
    executor: GovernedExecutor
    signingExecutor: Executor
    governor: VisibilityGovernor
    capGovernor: DutyCycleGovernor
    worker: WorkerExecutor
    admission: LocalCapacity
    localAdmission: LocalAdmission
    authorize: Authorizer
    counter: CountingExecutor
    startLedger: StartOutcomeLedger
    verifier: PeerVerifier
  }) {
    this.libp2p = parts.libp2p
    this.transport = parts.transport
    this.rpc = parts.rpc
    this.egress = parts.egress
    this.blockstore = parts.blockstore
    this.store = parts.store
    this.recordIndex = parts.recordIndex
    this.dht = parts.dht
    this.#publisher = parts.publisher
    this.#announcer = parts.announcer
    this.sovereignCids = parts.sovereignCids
    this.identityStore = parts.identityStore
    this.identityIsUnprotected = parts.identityIsUnprotected
    this.#certificates = parts.certificates
    this.executor = parts.executor
    this.signingExecutor = parts.signingExecutor
    this.governor = parts.governor
    this.#capGovernor = parts.capGovernor
    this.worker = parts.worker
    this.admission = parts.admission
    this.localAdmission = parts.localAdmission
    this.authorize = parts.authorize
    this.#counter = parts.counter
    this.#startLedger = parts.startLedger
    this.#verifier = parts.verifier
  }

  /** AUTH-02 — per-peer verdicts. See {@link BrowserNodeOptions.trustedIssuers}. */
  readonly #verifier: PeerVerifier

  /**
   * The connected peers this tab will fetch a block from — AUTH-02.
   *
   * The same list `RpcBlockSource` reads, so this is a reading of the gate rather than a
   * parallel account of it. A tab given no `trustedIssuers` returns the connected set
   * unchanged; see that option's doc for why that is stated rather than defaulted.
   *
   * Mirrors `FabricNode.verifiedPeers` — same getter, same source, same wording — because
   * a test that measures the two tiers against each other should not have to know which
   * one it is holding.
   */
  get verifiedPeers(): readonly string[] {
    return this.#verifier.verifiedPeers
  }

  /**
   * Why a peer is or is not verified — AUTH-02.
   *
   * `undefined` means no verdict has been computed: either this tab pins nobody and
   * therefore verifies nobody, or the records round trip for that peer has not landed yet.
   * Those two are different states and a caller that cares distinguishes them by whether
   * it configured `trustedIssuers` at all.
   */
  verdictFor(peerId: string): PeerVerdict | undefined {
    return this.#verifier.verdictFor(peerId)
  }

  /**
   * BROW-02 — what this tab has been told about start outcomes, its own row included.
   *
   * Private, and the reading is {@link startReport}. A public field would hand a page
   * `record` and `mergeOverlapping`, so reading what a peer said would be one property
   * access away from writing it — and this ledger is unauthenticated wire input, which is
   * the one thing that must not also be locally writable by whoever renders it.
   */
  readonly #startLedger: StartOutcomeLedger

  /**
   * What this tab has been told about start outcomes, its own row included — BROW-02.
   *
   * Readable without a round trip, which is the whole reason it is here: a page that
   * already holds this node can render what its peers reported to it without asking the
   * fabric for something the fabric just told it.
   *
   * **Reading cannot mutate.** `report()` computes a fresh {@link StartReport} — plain
   * data with no methods and no reference back to the ledger — so a page holding one
   * cannot add a row, and two calls a second apart are two independent snapshots rather
   * than two views of one object.
   *
   * A tab that has been told nothing still reports **one**: its own start, recorded at
   * construction. Identical to the Node tier's reading, on identical terms — the only
   * difference between nodes is discovery.
   */
  get startReport(): StartReport {
    return this.#startLedger.report()
  }

  /**
   * The most `execute()` calls ever running at once inside this tab.
   *
   * SCHED-06's criterion 1 is read off this: it counts calls that *happened*, so it
   * can read any number, where `admission.peakInFlight` cannot exceed `slots` by
   * construction.
   *
   * Composed **inside** `GovernedExecutor` rather than outside it — see the note at
   * the construction. It therefore counts tasks actually running, not tasks parked
   * on the governor's serialization chain waiting for a slice.
   */
  get executorPeakInFlight(): number {
    return this.#counter.peakInFlight
  }

  /**
   * The share of wall clock this tab currently spends running tasks — SCHED-04.
   *
   * **The effective rate, not the user's cap**: it is the lower of the user's cap and the
   * visibility governor's, so a backgrounded tab reads the background rate whatever the
   * user asked for. That is the composition working, not a lost setting — foreground the
   * tab and the user's cap is what binds again.
   *
   * Read through the governor rather than echoing a stored option, so it reports what is
   * in force after any {@link setDutyCycle} call and after any visibility change.
   */
  get dutyCycle(): number {
    return this.#capGovernor.dutyCycle
  }

  /**
   * Move this tab's cap while it is running — the half of SCHED-04 no tier had.
   *
   * Honoured by the **next task started** and by the **next offer answered**. A task
   * already executing is not disturbed: `GovernedExecutor` paces between tasks, and a
   * guest `run()` is synchronous with no fuel in V8, so there is no point at which a
   * running task could be slowed even in principle.
   *
   * Both effects come from one object. The cap governor is inside {@link executor}, so the
   * pacing changes; it is inside `admission`, so `admission.slots` changes with no
   * reconstruction and the very next offer answer carries the lower figure.
   *
   * **This sets the user's cap, never the environment's.** Backgrounding still throttles
   * on top of whatever is set here, because the two compose by taking the lower — see
   * {@link dutyCycle}.
   *
   * Throws a `RangeError` naming the value for anything outside `(0, 1]`. The guard is the
   * governor's own, reached rather than duplicated.
   */
  setDutyCycle(value: number): void {
    this.#capGovernor.setDutyCycle(value)
  }

  /** Calls currently inside the inner executor. */
  get executorInFlight(): number {
    return this.#counter.inFlight
  }

  /**
   * Join the fabric, or leave the tab as it was found.
   *
   * Same split as `FabricNode.start`, and this half is where it matters most:
   * `demo/main.ts` catches a rejected start, classifies it for the UI, and the user
   * can press the button again. Every failed retry used to strand a whole libp2p
   * node plus an open IndexedDB connection, so an unreachable — or hostile — relay
   * was a remotely triggered way to exhaust a visitor's tab.
   *
   * The blockstore is opened *before* `createLibp2p`, which is exactly why a
   * hand-written catch after the node gets it wrong. Releases run newest-first, so
   * acquisition order is the only order anybody has to think about.
   *
   * **Measured on this factory, in Chromium, Firefox and WebKit** —
   * `start-unwind.browser.test.ts`. It stood unmeasured for two milestones behind
   * "needs a real `indexedDB` and a relay to dial", which was true of the Node project
   * and never of the browser one: the `browser` project has a real `indexedDB`, and an
   * undialable relay address is a failure that costs nothing to arrange. What the
   * three cases read is the *effect* of the unwind rather than the rejection — an
   * `indexedDB.deleteDatabase` that is not blocked (the store was closed) and no
   * surviving `ConnectionMonitor` heartbeat (libp2p was stopped), both from outside,
   * because a rejected `start` hands its caller no object to interrogate. Asserting
   * only that `start` rejects would pass just as happily with this whole `catch`
   * deleted.
   *
   * Running it against that deletion is how the numbers above stopped being a claim:
   * three failed attempts left three live libp2p nodes and a blocked delete, in all
   * three engines. The `visibilitychange` release below was found the same way, and
   * did not exist until it was.
   */
  static async start(options: BrowserNodeOptions): Promise<BrowserNode> {
    const undo: (() => Promise<void> | void)[] = []
    try {
      return await BrowserNode.#compose(options, undo)
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
    options: BrowserNodeOptions,
    undo: (() => Promise<void> | void)[],
  ): Promise<BrowserNode> {
    // Before anything hashes. A LAN origin — `http://10.144.82.249:5173`, what a phone
    // reaches this page on — is not a secure context, so `crypto.subtle` is `undefined`
    // there. `@libp2p/kad-dht` computes every Kademlia ID through
    // `multiformats/hashes/sha2`, whose browser entry is `crypto.subtle.digest`, so
    // `createLibp2p` below threw `Cannot read properties of undefined (reading 'digest')`
    // out of `RoutingTable.start` and the tab never joined. `hash.ts` removed that
    // dependency from the imports this repository writes; this removes it from the ones it
    // does not. No-op in a secure context and in Node — see the module's own docblock for
    // why it installs `digest` and deliberately nothing else.
    installSubtleDigestFallback()

    const blockstoreName = options.blockstoreName ?? DEFAULT_BLOCKSTORE_NAME
    // SCHED-01 — wrapped so the provider announcer learns what this tab comes to hold, on
    // the identical reasoning `fabric-node.ts` states at its own store: the DHT does not
    // exist until `createLibp2p` below, so the wrapper buffers what is put in between and
    // `observeWith` replays it. `inner` is the `IdbBlockstore` itself, which this decorator
    // must not swallow — an open IndexedDB connection is what blocks a `deleteDatabase`,
    // and `start-unwind.browser.test.ts` reads exactly that.
    const store = new ObservingBlockstore(await IdbBlockstore.open(blockstoreName))
    undo.push(() => store.inner.close())

    // A separate database from the blocks, deliberately — see `idb-identity-store.ts`.
    // Opened here rather than lazily because `createLibp2p` below needs the derived key,
    // and the release goes on the line after the acquisition, as everything in this
    // method does.
    const identityStore = await IdbIdentityStore.open(identityStoreName(blockstoreName))
    undo.push(() => identityStore.close())

    // AUTH-01/AUTH-06 — this tab's own name, and the two decisions this factory refuses to
    // make for its caller. `whenSeedIsGone` says what an ABSENT seed costs;
    // `identityProtection` says where a secret may live on this device. All that happens
    // here is that the branches are taken by values somebody wrote down.
    //
    // A minted seed is persisted **before** anything is derived from it, so a tab that
    // crashes between generating and using one comes back as the node it just became
    // rather than as a third.
    //
    // **Read, seal and write in ONE transaction — task #49, and it was measured.** This was
    // a read, then on `null` a mint and a separate write, with nothing spanning the two.
    // Four tabs of one profile opening one cold origin together minted four identities and
    // the last write won, so three of them ran as nodes whose seed was not the stored one
    // and came back on their next start as somebody else — the silent arrival at exactly the
    // state `whenSeedIsGone` exists to make loud.
    // `IdbIdentityStore.loadOrMintSealedSeed` carries the reasoning and the constraint it
    // puts on `mint`; `idb-identity-store.browser.test.ts` carries the reading and its plant.
    //
    // The refusing branch mints nothing, and it says so **inside** that transaction rather
    // than through a separate read: `mint` throws, which is how a caller states *"there is
    // nothing here and I will not create one"* without a second read that could disagree
    // with the first. Nothing about the fix widens what a refusing node will accept.
    if (
      options.identityProtection.kind !== 'passphrase' &&
      options.whenSeedIsGone === 'refuses-to-start-without-its-seed'
    ) {
      throw new ContradictoryIdentityPolicyError()
    }
    // Before anything is derived from it, so a passphrase under the floor costs a string
    // length rather than an Argon2id derivation and its refusal cannot be confused with a
    // decryption failure.
    assertUsablePassphrase(options.identityProtection)

    // The expensive half, and it runs **outside every transaction** — one Argon2id
    // derivation per start, shared by both of this tab's secrets. `resolveProtectedSeed`
    // carries why that is a correctness requirement rather than an economy.
    const protection = options.identityProtection
    let binding: SealBinding | null = null
    if (protection.kind === 'passphrase') {
      const salt = await identityStore.loadOrCreateSalt()
      binding = { salt, key: await deriveSealKey(protection.passphrase, salt, DEFAULT_KDF_PARAMS) }
    }

    /**
     * `whenSeedIsGone`, as the callback the transaction consults when it finds nothing.
     *
     * A refusal expressed this way is decided by the same read that would have decided the
     * write. Expressed as a separate `loadSeed()` before the transaction, it would be a
     * second read that can disagree with the first — which is the shape of the defect this
     * whole path exists to have removed.
     */
    const mintOrRefuse = (): Uint8Array<ArrayBuffer> => {
      if (options.whenSeedIsGone === 'refuses-to-start-without-its-seed') {
        throw new Error(
          `no seed in ${identityStore.name}: this node was started with 'refuses-to-start-without-its-seed', and starting anyway would give it a different peer id and invalidate any certificate naming the old one`,
        )
      }
      return generateSeed()
    }

    const held = await resolveProtectedSeed({
      store: identityStore,
      protection,
      binding,
      legacy: async () => identityStore.legacyPlaintextSeed(),
      sealed: async (bound, mint) =>
        identityStore.loadOrMintSealedSeed(bound.key, DEFAULT_KDF_PARAMS, bound.salt, mint),
      mint: mintOrRefuse,
    })
    // `let`, because the provider branch far below resolves the second secret under the
    // same binding and either of the two can be the one in the clear.
    let identityIsUnprotected = held.unprotected
    const identity = await identityFromSeed(held.seed)

    // NET-12 — the TURN rung, built here because this is the only place that holds both halves
    // a mint request needs: `identity.seed` signs it, and this tab's certificate names who is
    // asking. The certificate is resolved further down (`resolveCertificate`), AFTER libp2p
    // exists, so it is read through this cell rather than captured now. That is safe for a
    // measured reason rather than a hopeful one: `rtcConfiguration`'s function form is invoked
    // per connection, and the first connection cannot precede the end of `start`.
    let turnCertificate: NodeCertificate | null = null
    const turnRegion = options.turnRegion ?? 'bootstrap-us'
    const turnHolder =
      options.turnEndpoint === undefined || options.turnEndpoint === ''
        ? null
        : turnCredentialHolder({
            endpoint: options.turnEndpoint,
            ...(options.turnRefreshMarginMs === undefined
              ? {}
              : { refreshMarginMs: options.turnRefreshMarginMs }),
            requestBody: () => {
              // A tab that enrolled nowhere holds `null` here, and it still asks. **The gate
              // decides membership, not the caller**: a tab that pre-judged its own request
              // would be a second, weaker copy of the admission rule living on the side that
              // cannot be trusted with it. The hosted minter refuses a missing or unpinned
              // certificate by name, and the holder turns that refusal into "no rung" — which
              // `iceConfiguration` renders as the explicit STUN list, never `{}`.
              const requestedAt = Date.now()
              return {
                certificate: turnCertificate,
                nodeKey: identity.nodeKey,
                region: turnRegion,
                requestedAt,
                signature: toHex(ed25519.sign(turnMintBytes(identity.nodeKey, turnRegion, requestedAt), identity.seed)),
              }
            },
          })

    const libp2p = await createLibp2p({
      // The only listen set a browser can offer.
      addresses: { listen: [...BROWSER_LISTEN] },
      // AUTH-01: the derived key, so this tab's peer id is `identity.peerId` and survives
      // a reload. Without it libp2p generates a fresh Ed25519 key per start, and the tab's
      // certificate — which names `identity.nodeKey` — would name a peer id nobody was
      // dialling. `identity.peerId` is computed from this same key's public half rather
      // than from `nodeKey`, so the two cannot disagree.
      privateKey: identity.privateKey,
      transports: [
        webSockets(),
        // NET-12 — the FUNCTION form, even when there is no credential to fetch. The package
        // re-invokes it per connection, so this is the seam a short-lived credential arrives
        // through. Passing a plain object here would mean changing the call shape twice, and
        // the value it returns always carries an explicit `iceServers` — a configuration
        // without that key is an instruction to use four defaults this project never chose,
        // one of which stopped resolving. See `ice-configuration.ts`.
        webRTC({
          rtcConfiguration: async () =>
            iceConfiguration({
              turn: (await turnHolder?.rung()) ?? null,
              relayOnly: options.iceRelayOnly === true,
            }),
        }),
        circuitRelayTransport(),
      ],
      connectionEncrypters: [noise()],
      streamMuxers: [yamux()],
      services: {
        identify: identify(),
        identifyPush: identifyPush(),
        // Required BY the DHT rather than chosen: `KadDHTComponents` declares `ping`, so
        // `kadDHT()` does not type-check without it. It is a liveness probe and grants
        // nothing — the argument above about holding no door is untouched.
        ping: ping(),
        // SCHED-01 / NET-06 — the same private keyspace the backbone uses, on the same
        // wire, so a tab and a backbone node are peers in one DHT rather than two.
        //
        // **`clientMode: true`, stated, and the value is the conservative one on purpose.**
        // Measured 2026-08-14: left unset, kad-dht promotes on any address passing
        // `!isPrivate(ma) && !Circuit.exactMatch(ma)`, and a tab's `/webrtc` listen address
        // is `<relay>/p2p-circuit/webrtc/p2p/<self>` — a WebRTC multiaddr, not an exact
        // Circuit match. So an unset `clientMode` would make this tab a DHT **server** when
        // its relay happens to be public and a client when the relay is on a LAN, with
        // nothing in the code saying so. See
        // `.planning/consults/2026-08-14-kad-dht-server-mode-promotion.md`.
        //
        // **Why client rather than server, stated as a limit rather than a conclusion.**
        // Whether a tab can usefully *answer* a query is unmeasured: kad-dht registers its
        // handler without `runOnLimitedConnection` — the string appears nowhere in
        // `@libp2p/kad-dht@16.4.0`'s source — so a relayed inbound connection would not
        // negotiate the protocol at all, and whether a WebRTC-upgraded one does has not
        // been read here. Declaring server mode on that basis would put a possibly
        // unanswerable peer into every routing table. A client still **puts** its own
        // record and **reads** everyone else's, which is what this tier needs.
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
          clientMode: true,
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
          validators: { [O2_RECORD_NAMESPACE]: o2RecordValidator(() => Date.now()) },
          // Registering `validators` without `selectors` makes a keyspace that accepts
          // every write and errors on every read — `bestRecord` throws
          // `MissingSelectorError` when the namespace is unknown, and `DhtRecordIndex`'s
          // own catch turns that into a silent *"the DHT holds nothing"*. Measured
          // 2026-08-23; see `o2RecordSelector` for the rule and for how it presented.
          selectors: { [O2_RECORD_NAMESPACE]: o2RecordSelector },
        }),
      },
      ...(options.allowPrivateAddrs === true
        ? { connectionGater: { denyDialMultiaddr: async () => false } }
        : {}),
    })
    undo.push(() => libp2p.stop())

    // Connecting to a relay is what triggers the reservation that makes this tab
    // addressable. Without at least one, nothing can ever reach it.
    //
    // The peer ids are collected because a certificate has to name the relays a node is
    // reachable through when it is not reachable cold — `relayIds` below. Same collection
    // `fabric-node.ts` makes at its own dial loop.
    //
    // **The absent `catch` is the decision, not an omission, and the two tiers diverge
    // here on purpose.** A failed dial propagates, `start` rejects, and `#compose`'s
    // unwind closes the store and stops libp2p. `fabric-node.ts` does the opposite under
    // NET-05: it catches, records the address and reason on `FabricNode.relayFailures`,
    // and keeps the node running. Both are right for their platform. That process binds a
    // real listening port, so a relay it could not enter costs it circuit reachability and
    // nothing else; a tab binds no socket, so a tab with no reservation cannot be reached
    // by anyone, and starting it would hand the visitor a node that silently does nothing
    // — the ambiguity NET-05 removed on the other tier, reintroduced on this one. Each
    // side is measured as its own disposition: `start-unwind.browser.test.ts` — *"closes
    // the blockstore and stops libp2p when a relay dial fails"* — holds this one in all
    // three engines, and `reservation-exhaustion.node.test.ts` case C holds the other
    // cross-process through `bin/agent.ts`. **Do not add a `catch` here to match that
    // file.** W-2 of `18-VERIFICATION.md` is that the divergence was recorded on neither
    // side, which is what makes it read as drift.
    const relayPeerIds: string[] = []
    for (const address of options.relayAddrs) {
      const connection = await libp2p.dial(multiaddr(address))
      relayPeerIds.push(connection.remotePeer.toString())
    }

    // NET-08: the first `Libp2pTransportOptions` this factory has ever passed — the
    // option surface existed and no node reached it. Key omitted rather than set to
    // an explicit `undefined`, because `exactOptionalPropertyTypes` makes those
    // different types; the same idiom threads `rpcTimeoutMs` below.
    const transport = await Libp2pTransport.start(
      libp2p,
      options.maxMessageBytes === undefined ? {} : { maxMessageBytes: options.maxMessageBytes },
    )
    // Resolved once, here, so the identical value feeds both `egress`'s ownerId
    // and `guardSovereignty`'s clearance check below — mirrors `fabric-node.ts`.
    const sovereignty = options.sovereignty ?? { ownerId: '', canExecuteSovereign: false }
    // AUTH-03: this tab's own identity is the audience a capability chain must end at,
    // so a chain minted for another node is refused here by `wrong-audience`. Computed
    // once, because it cannot change while the node runs, and eagerly, before
    // `serveAgent` below — so there is no path by which this tab serves with an
    // authorizer whose audience was never derived. Mirrors `fabric-node.ts`, which
    // carries the long form of what that ordering claim does and does not cover.
    const audience = audienceKeyOf(libp2p.peerId)
    // DET-03/DATA-08: resolved once, here, beside where `sovereignty` is resolved once
    // and for the identical stated reason — two independently defaulted copies could
    // drift. Mirrors `fabric-node.ts`, which builds the same wrapper from the same
    // option; the placement argument is below, at the composition.
    const anchors = options.trustAnchors
    const provenance =
      anchors === 'runs-unsigned-artifacts'
        ? (inner: Executor): Executor => inner
        : (inner: Executor): Executor =>
            guardModuleProvenance(inner, {
              resolver: new SignedNameResolver(anchors),
              // A thunk, never a captured number — see `ModuleProvenance.now`. A tab that
              // read the clock here would keep running an expired record for as long as
              // it stayed open, which for a tab is potentially days.
              now: () => Date.now(),
            })
    // DATA-05/DATA-06: every outbound RPC frame is recorded by construction —
    // `rpc` is built over this guard, not over the raw `transport`, below.
    const egress = new EgressGuard(transport, sovereignty.ownerId)
    const rpc = new RpcEndpoint(
      egress,
      options.rpcTimeoutMs === undefined ? {} : { timeoutMs: options.rpcTimeoutMs },
    )
    // AUTH-02 — per-peer verdicts, computed offline against the pinned issuer keys.
    //
    // **Constructed before `resolveCertificate` rather than after it, which is where
    // `fabric-node.ts` puts it, and the difference is placement rather than behaviour.**
    // That file builds its verifier after the provider dial and relies on `start`'s
    // seeding loop over `peers()` to catch the `peer:connect` that already fired. Here the
    // verifier exists first, so the enrolment dial's `peer:connect` reaches a live
    // listener. Both paths funnel into the same memoised `verify`, so neither is a
    // correctness claim — but this one is the cheaper of the two and it is the ordering
    // the block source below forces anyway.
    //
    // A tab given no `trustedIssuers` gets a verifier that subscribes to nothing, asks
    // nobody anything, and answers `verifiedPeers` with the connected set unchanged — so
    // this line costs a tab that pins nobody exactly one allocation.
    const verifier = PeerVerifier.start({
      libp2p,
      rpc,
      peers: () => transport.peers,
      trustedIssuers: new Set(options.trustedIssuers ?? []),
    })

    // Blocks this tab lacks are pulled from whichever peers are connected **and verified**.
    // AUTH-02's browser leg, and the line this whole move existed for: the thunk read
    // `() => transport.peers` — the raw connected set — from the day this file was written
    // until 2026-08-14, because `PeerVerifier` was not importable here. See
    // `BrowserNodeOptions.enrollment`'s CLOSED note.
    //
    // Still a thunk, and now for two reasons rather than one, exactly as `fabric-node.ts`
    // states: a peer that connects later is usable immediately, and a peer that connects
    // later is usable *once verified* — which is what makes the fail-closed window between
    // connect and verdict cost nothing durable, since the source is read per fetch and a
    // retry after the verdict lands succeeds without reconnecting.
    const blockstore = new FetchingBlockstore(store, new RpcBlockSource(rpc, () => verifier.verifiedPeers))

    // AUTH-01 — the enrollment round trip, over the fabric's own protocol, before this
    // factory returns anything. Mirrors `fabric-node.ts` step for step, including where
    // the releases go: this is the first `await` in `#compose` that can *reject* after
    // `transport` and `rpc` exist, so they are pushed on the undo stack immediately above
    // it rather than left to `libp2p.stop()` alone.
    undo.push(() => transport.stop())
    undo.push(() => rpc.close())
    // On the stack for the same reason and in the same place, because the verifier is
    // built above this line: it holds two `libp2p` listeners, and a `#compose` that rejects
    // here would otherwise leave them attached to a node nobody holds a reference to. A
    // no-op for a tab that pins nobody — `PeerVerifier.start` never subscribed.
    undo.push(() => verifier.stop())
    const certificate = await resolveCertificate({
      enrollment: options.enrollment,
      identity,
      rpc,
      libp2p,
      identityStore,
      canRelay: canRelayFrom(BROWSER_LISTEN),
      relayPeerIds,
      reuse: 'may-reuse-a-persisted-certificate',
    })

    // NET-12 — the cell the TURN mint request reads. Set once, here, because this is the first
    // line at which this tab knows what certificate it holds.
    turnCertificate = certificate

    // AUTH-04 renewal — one cell, read by the index, the publisher and this tab's own
    // accessor. `CertificateHolder`'s doc says why it is a type rather than a local.
    const certificates = new CertificateHolder(certificate)

    // DATA-05 — the tap and the local-only tier, bound once and handed to both readers
    // below, exactly as `fabric-node.ts` does and for the identical reason: the withholding
    // predicate and the `block` branch must consult the same guard, and one value passed
    // twice cannot disagree.
    //
    // DATA-10's at-rest half, the same closure the Node tier makes — this tier is not
    // exempt from it. Name derived by suffix from the blockstore's, exactly as the
    // identity database is, so one origin can hold several independent nodes.
    const sovereignCids = await IdbSovereignCids.open(`${blockstoreName}-sovereign`)
    undo.push(() => sovereignCids.close())
    const egressDisposition = { guard: egress, sovereignInputs: store, sovereignCids }

    // AUTH-01 / SCHED-01 — what this node answers a peer's `records` *and* `providers`
    // requests with, from the identical expression `fabric-node.ts` uses. Unconditional
    // since owner ruling D1; the store is this tier's local-only `IdbBlockstore`, never
    // `blockstore`, which has network fallback and would turn a question about this tab
    // into a fetch.
    const records = ownRecords(
      certificates,
      identity,
      sovereignty.canExecuteSovereign,
      store,
      withholdingFrom(egressDisposition),
    )

    // SCHED-01 / NET-06 — this tab's *asking* index, reaching past the peers it happens to
    // be connected to. Byte-identical composition to `fabric-node.ts`'s, which is the
    // point: a tab differs from a backbone node in what it can LISTEN on, never in what it
    // may ask. The serving side stays `records` — see the node tier for why a serving index
    // that walked the DHT would not terminate.
    const pinnedIssuers = new Set(options.trustedIssuers ?? [])
    const rpcIndex = new RpcRecordIndex(rpc, () => verifier.verifiedPeers)
    const recordIndex = new DhtRecordIndex({
      dht: libp2p.services.dht,
      providersFrom: rpcIndex,
      recordsFallback: rpcIndex,
      verify: (nodeKey, found) =>
        found.certificate.nodeKey === nodeKey &&
        verifyCertificate(found.certificate, pinnedIssuers, Date.now()).ok &&
        verifyCapabilityRecord(found.capabilities, Date.now()),
      timeoutMs: DHT_QUERY_TIMEOUT_MS,
      // A requestor is not its own candidate — see `DhtRecordIndexOptions.self`.
      self: identity.nodeKey,
      addresses: (info) => {
        void libp2p.peerStore.merge(info.id, { multiaddrs: info.multiaddrs }).catch(() => {})
      },
    })

    // AUTH-01 — the provider signing key, persisted so a node that issues certificates
    // stays the same issuer across a reload. Generated and stored on first use rather
    // than at every start, for the reason the seed is: a trust root whose key changed
    // silently would invalidate every certificate it had ever signed.
    let authority: EnrollmentAuthority | null = null
    if (options.issuesCertificates !== undefined) {
      // One transaction, for the reason the node seed above gives at length: this is the
      // same read-then-write pair on the same store, and a trust root that changed silently
      // because two tabs raced would invalidate every certificate it had signed. Fixed in
      // the same pass rather than left, because *"the other one has the same shape"* is how
      // a closed defect comes back.
      //
      // AUTH-06 — sealed under the **same binding** as the node seed, not a second
      // derivation and not a second passphrase, so one database cannot end up behind two
      // keys. It is the higher-value of the two secrets: the trust root every certificate
      // this tab ever signs verifies against.
      const providerHeld = await resolveProtectedSeed({
        store: identityStore,
        protection,
        binding,
        legacy: async () => identityStore.legacyPlaintextProviderSeed(),
        sealed: async (bound, mint) =>
          identityStore.loadOrMintSealedProviderSeed(bound.key, DEFAULT_KDF_PARAMS, bound.salt, mint),
        // A provider signing key has no `whenSeedIsGone` of its own: `refuses-to-start-without-its-seed`
        // is about the identity peers dial, and a tab told to issue certificates that had no
        // signing key would have nothing to refuse *for*. It mints.
        mint: generateSeed,
      })
      const providerPrivateKey = providerHeld.seed
      identityIsUnprotected = identityIsUnprotected || providerHeld.unprotected
      // AUTH-04, and this is the line that turns the mechanism on for a tab. Both required
      // issuance options carried a named sentinel for one wave; both now carry the real
      // thing, and they are the **same** two things `fabric-node.ts` passes.
      //
      //   - the **budget** comes from the caller, because `BrowserNodeOptions` cannot
      //     express a provider that never stated one. No default, deliberately.
      //   - the **history** is an IndexedDB database of this tab's own, named by suffix
      //     from the blockstore's exactly as the identity store and the sovereign-CID set
      //     are, so one origin can hold several independent nodes.
      //
      // **The one asymmetry with the Node tier, and it is bounded and stated rather than
      // mentioned.** `record` is synchronous because `enrol` is, and IndexedDB has no
      // synchronous API, so a tab's write is durable one turn later where a file's append
      // has already returned. Because a write is scheduled on *every* `record` rather than
      // batched, what is not yet durable is what was recorded since the last turn — one,
      // for a tab answering one enrolment frame at a time. `idb-issuance.ts` carries the
      // argument and `idb-issuance.browser.test.ts` asserts the count.
      //
      // That is a platform fact of the same kind as a blockstore on IndexedDB, and it is
      // **not** a capability difference: this tab's running budget is exact from the
      // instant it signs, and only what a reload would recover lags.
      const issuance = await IdbIssuance.open(`${blockstoreName}-issuance`, {
        // `enrollment.ts`'s own default, read from the module the authority defaults from
        // rather than restated here, so the record cannot compact past a bound the
        // authority still consults.
        retainMs: DEFAULT_ISSUANCE_WINDOW_MS,
      })
      undo.push(() => issuance.close())
      authority = new EnrollmentAuthority({
        providerPrivateKey,
        maxIssuedPerWindow: options.issuesCertificates,
        issuance,
      })
    }

    // BROW-03: every task this tab runs — its own and other peers' — is paced by
    // the visibility governor. Wrapping here rather than at the submit site means a
    // backgrounded tab throttles work it is *serving*, which is the case that
    // actually affects a visitor.
    const governor = new VisibilityGovernor(
      options.backgroundDutyCycle === undefined
        ? {}
        : { backgroundDutyCycle: options.backgroundDutyCycle },
    )
    // BROW-02: the third acquisition, and the one that survives its own node. The
    // governor's constructor takes a `visibilitychange` listener on the *document* —
    // a resource that outlives every object this factory built, because the page does.
    // A `start` that failed after this line therefore left a listener nobody had a
    // handle to remove, and `demo/main.ts` lets a visitor press Start again after a
    // failure, so they accumulate one per attempt. Measured in Chromium, Firefox and
    // WebKit before this line existed — `start-unwind.browser.test.ts`, which reads it
    // from `document` rather than from the node.
    undo.push(() => governor.stop())
    const nodeId = libp2p.peerId.toString()
    // BROW-04, SCHED-06: tasks run on a thread this tab can kill, unconditionally.
    // There is no other arrangement — see `BrowserNodeOptions.createWorker`.
    const worker = browserWorkerExecutor({
      nodeId,
      blockstore,
      createWorker: options.createWorker,
      ...(options.taskDeadlineMs === undefined ? {} : { deadlineMs: options.taskDeadlineMs }),
    })
    // DATA-09: guarded unconditionally, with no opt-in required to get the
    // refusal — `options.sovereignty` defaults to cleared-for-nobody (see
    // `BrowserNodeOptions.sovereignty`'s doc). Wrapped *inside* the governor
    // rather than around it, so `this.executor` stays exactly a
    // `GovernedExecutor` (BROW-04's `.executed`/`.dutyCycle` surface,
    // unaffected by what runs underneath) while every path that reaches
    // `.execute` — a remote dispatch via `serveAgent` below, and a page's own
    // local self-dispatch (`includeSelf`, `demo/main.ts`) alike — passes
    // through the identical guard.
    //
    // DATA-05/DATA-06 no longer appear in this chain, mirroring `fabric-node.ts`: a
    // sovereign task's input is declared by `serveAgent`, which is also the layer that
    // gives the hold back once the reply frame has settled. `store` (the local-only
    // `IdbBlockstore`) is still the registration blockstore and is handed to
    // `serveAgent` below, never `blockstore` (network fallback). A page's own
    // self-dispatch therefore declares nothing — and no longer takes a hold nothing
    // gave back; the demo's self-dispatch goes through `submitJobWithEgress`, which
    // holds for the job's lifetime.
    //
    // SCHED-06: `CountingExecutor` sits **inside** `GovernedExecutor`, not outside
    // it, and the deviation from `fabric-node.ts`'s outermost composition is
    // deliberate on two counts. `this.executor` must stay exactly a
    // `GovernedExecutor` for BROW-04's `.executed`/`.dutyCycle` surface — the same
    // constraint the sovereignty comment above is written around — and a counter
    // outside the governor would count tasks *parked on its serialization chain* as
    // in flight, which is precisely not what "how many tasks is this tab running at
    // once" means. Inside, it counts tasks actually running.
    //
    // DET-03/DATA-08: `provenance` is the **innermost guard**, with no other guard
    // between it and the executor that reaches `WebAssembly.instantiate`. That is what
    // makes "refused before instantiation" true by construction rather than by
    // inspecting whatever happens to be layered above it this month — the same argument
    // `fabric-node.ts` gives at its own composition, and the same ordering. AOT-04's
    // `AbiExecutor` sits beneath it and is not a guard: it compiles the module to
    // decide which host object it meets and never instantiates one, so it refuses
    // nothing and there is still nothing between `provenance` and instantiation that
    // could answer ahead of it.
    //
    // Sovereignty stays **outside** it, also mirroring `fabric-node.ts`: a tab that may
    // not decrypt an owner's data should say *that*, whatever module was named. The
    // clearance answer is about this node; the provenance answer is about the
    // dispatcher's record and would bury it.
    //
    // **It wraps the router, and the router's two arms are both inside it.** 14-04's
    // plan described this line as a null-coalescing pair whose second arm built a
    // main-thread executor directly, and instructed that the guard wrap the pair as a
    // whole so neither arm escaped. That expression no longer exists: `createWorker`
    // became required and the main-thread fallback was deleted outright (see
    // `BrowserNodeOptions.createWorker`). AOT-04 has since put a second arm back — the
    // WASI executor — and the instruction's *point* is what decided where it went:
    // guard the thing that reaches instantiation rather than something sitting near it,
    // which here means wrapping the router rather than one of the executors under it.
    // Neither arm escapes, and a third would not either.
    //
    // The wording above avoids spelling that construction out, and deliberately:
    // `browser-node-contract.node.test.ts` counts the constructor call as raw text across
    // this whole file, comments included, and requires zero. Its own comment says "zero
    // *constructions*, not zero mentions" — the intent is right and the instrument cannot
    // tell the two apart, so this file does not put the text where it would be counted.
    // The same rule `trust-anchors.node.test.ts` writes down for its own matchers.
    // AOT-04 — this tab runs both ABIs, and **the artifact chooses, never the node**.
    // Composed for the reason every line in this block is: a `BrowserNode` that could
    // not run a translated artifact while a `FabricNode` could would be a difference in
    // capability between node kinds, which is the one thing this project does not
    // permit. `fabric-node.ts` builds the byte-identical expression over its own two
    // values, and its comment carries the full argument for the wrap order.
    //
    // **Innermost, so nothing outside these parentheses changes.** The sovereignty
    // gate, the provenance guard and the duty-cycle governor apply to a translated
    // artifact exactly as they do to a source-compiled one. The router compiles to
    // decide and never instantiates, so `provenance` is still the last guard before
    // the executor that reaches `WebAssembly.instantiate`.
    //
    // **The asymmetry is within one node, not between kinds.** `worker` is the
    // killable thread, so a native module runs there while a WASI module runs inline
    // on this tab's main thread — which means BROW-04's wall-clock deadline bounds the
    // native arm and **does not bound the WASI arm**. Both are the same node with the
    // same capability; what differs is which artifact is running, which is the same
    // rule as everywhere else in this composition. Said in those words because "the
    // browser handles WASI differently" read out of context is exactly the sentence
    // this project deletes classes over — `fabric-node.ts` carries the identical bound
    // and the identical gap, from the identical cause: `WorkerExecutor` posts to a
    // thread running `@o2/core`'s `runTask`, and `@o2/core` may declare no dependency
    // on any other `@o2` package at all, so the killable path cannot reach
    // `WasiExecutor` from where it stands. Closing it is a change to the kernel's
    // dependency shape, not to this line.
    //
    // A line comment in these two files must not contain the two characters that open
    // a block comment. Several source-scanning guards strip comments with a
    // non-greedy `/[*] … [*]/` regex, so one of those sequences inside a `//` comment
    // swallows the file from there to the next block-comment terminator. Measured on
    // 2026-08-04: writing the glob form of "any o2 package" here turned
    // `trust-anchors`, `requirements-ledger` and `mutation-guard` red at once, each
    // reporting that a composition present three lines away was absent.
    const abi = new AbiExecutor({
      blockstore,
      native: worker,
      wasi: new WasiExecutor({ nodeId, blockstore }),
    })
    const counter = new CountingExecutor(guardSovereignty(provenance(abi), sovereignty))
    // SCHED-04 — the user's cap, composed **over** the visibility governor rather than
    // replacing it. `environment: governor` is what makes `dutyCycle` return the lower of
    // the two, so BROW-03's background throttle still binds at any user cap and the user's
    // cap still binds on a visible tab. Passing `VisibilityGovernor` alone here would give
    // the tab a live environment reading and still no settable cap, which is the whole of
    // what this plan is for.
    const capGovernor = new DutyCycleGovernor({
      dutyCycle: options.dutyCycle ?? 1,
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      environment: governor,
    })
    const executor = new GovernedExecutor(counter, capGovernor)

    // VER-08 / VER-09 / VER-10 — this tab's signing identity, resolved **once**, on one
    // line, for both verbs. The byte-identical expression `fabric-node.ts` builds, over
    // this tier's own two values.
    //
    // `identity.seed` is what `requestEnrollment` signed with above and
    // `certificate.nodeKey` is its public half, so the two cannot disagree. Neither is a
    // `BrowserNodeOptions` field and neither is re-derived: a tab signing with anything
    // but the key its certificate names produces attestations that verify for nobody, and
    // there is no reason to make that expressible from a page.
    //
    // **The literal, not a branch.** A tab nobody enrolled reaches this line by the same
    // route as one that was, and states that it signs nothing. A `certificate === null`
    // branch around the composition below is a thing a later edit could extend; a named
    // literal is a thing that edit would have to write down.
    //
    // **This is not a node class, and the whole point of doing both tiers in one pass is
    // that it cannot become one.** Signing is not a capability a tier confers. A tab
    // holding a certificate signs exactly as a server holding one does, from the same
    // wrapper over the same values in the same place; a node holding none says so
    // identically on both tiers. The only asymmetry in this leg is where each tier
    // persists its seed — `IdbIdentityStore` here, a file there — and that is a storage
    // fact, not a capability.
    const attestor: ResultAttestor =
      certificate === null ? 'signs-nothing' : { nodeSeed: identity.seed, certificate }

    // The signing layer is **outermost** — outside `GovernedExecutor`, with nothing
    // composed after it — so it signs the outcome that actually leaves this tab and no
    // layer added later can alter an answer after it was signed. Everything beneath it is
    // untouched and the order still matters exactly as the block above states: provenance
    // innermost against the worker, sovereignty outside provenance, the counter inside
    // the governor.
    //
    // **What this layer is for.** A result leaving this tab carries this tab's signature
    // over it, checkable by somebody who was not present — so a receipt downstream is a
    // statement about nodes a provider certified rather than about node id strings the
    // requestor chose.
    //
    // **What it is not for: correctness.** A signature on a wrong answer is a signed
    // wrong answer. `executeVerified`'s N-version comparison remains the only thing that
    // says an answer is right, and this is written at the line because somebody will read
    // "results are signed now" and propose reducing redundancy.
    //
    // `executor` — not this — is what `BrowserNode.executor` holds, because that field
    // must stay exactly a `GovernedExecutor` for BROW-04's surface, which is also why the
    // counter sits where it does.
    //
    // **What followed that sentence was retracted by Plan 19-11 and is left visible,
    // because the reasoning was sound and the scope was not.** It read: a page dispatching
    // to its own node in-process gets the unsigned outcome, *"and that is the truthful
    // reading: nothing left the tab, and a node's signed statement to itself establishes
    // nothing it did not already hold."* True of what the **tab** learns; false of what
    // the **receipt** reports, and the receipt is shown to somebody who was not here. The
    // measured consequence was that every job the demo page has ever submitted carried a
    // self-replica, so `receiptFor` reported the named absence on all of them — including
    // a job one enrolled tab ran entirely by itself, which is `owner-attested` and is
    // exactly the label criterion 3 asks this surface to display.
    //
    // So this value is now also held on the class, as `signingExecutor`, and a page
    // composing a job uses that. `BrowserNode.executor`'s type is untouched, no branch was
    // added, and a tab holding no identity is unaffected — `attestResults` returns its
    // argument for one, so its self-replica stays unaccounted and its receipt stays the
    // named absence. See the field for the full account.
    const signing = attestResults(executor, attestor)
    // SCHED-06 — this tab's own admission control, handed to `serveAgent` below.
    //
    // **`dutyCycle: capGovernor` — and this reverses what this comment used to say.**
    //
    // It used to read that the duty cycle was *deliberately not* passed here, because
    // "two independent throttles on one path produce a number nobody can predict — a
    // backgrounded tab would both run tasks slower *and* refuse them earlier, from two
    // mechanisms neither of which knows about the other". That is recorded rather than
    // deleted, because the reasoning was sound and the premise was not.
    //
    // They are not two throttles. `GovernedExecutor` is the **mechanism** — the thing that
    // actually makes a task wait. The slot count is the **statement about** that mechanism:
    // advisory, reserving nothing, read by a requestor deciding where to send work. One
    // cap, seen twice. And the two now share an object, so neither can fail to know about
    // the other — which was the specific fear.
    //
    // Criterion 3 requires a cap to be observable in what a requestor is offered next, and
    // the offer answer carries a slot count derived from the duty cycle, so this argument
    // is the whole of that requirement on this tier.
    //
    // What is genuinely given up, stated: a throttled tab now refuses earlier as well as
    // running slower. That is intended — a tab at a low cap still advertising a high slot
    // count would be inviting work it will not get to.
    //
    // `fabric-node.ts` makes the identical change in the same phase (Plan 18-08), so the
    // two tiers agree here as they now agree on layer order. A reader finding one without
    // the other should treat that as the defect.
    //
    // Constructed after `libp2p` because the node id comes from it, and thrown
    // straight out of `start` when the option is nonsense: `LocalCapacity`'s own
    // `RangeError` guard is reached rather than bypassed by a clamp.
    const admission = new LocalCapacity({
      nodeId,
      maxConcurrent: options.maxConcurrentTasks ?? DEFAULT_MAX_CONCURRENT_TASKS,
          // **The user's cap, never the composed value** — and the difference is a measured
      // one rather than a nicety. `capGovernor.dutyCycle` is `min(user, visibility)`, so
      // feeding it here would make a backgrounded tab advertise
      // `floor(8 × 0.05) → 1` slot and refuse five of the six shards of a job it had
      // already accepted. That is exactly what happened: `background-tab.e2e.test.ts`
      // went from complete to incomplete, twice out of twice, and passed again the moment
      // this read the user's cap instead.
      //
      // Which vindicates half of the comment above and not the other half. The visibility
      // duty cycle really should not feed a capacity — a tab that goes to the background
      // must honour what it took on and merely run it slower, which is BROW-03. What was
      // wrong was extending that to the *user's* cap: somebody who caps their own machine
      // is saying "do not give me as much", and that belongs in the slot count.
      //
      // One object still, so nothing can drift: `setDutyCycle` moves the cap that both
      // this and the pacing read.
      dutyCycle: {
        get dutyCycle(): number {
          return capGovernor.ownDutyCycle
        },
        yieldSlice: (): Promise<void> => Promise.resolve(),
      },
    })
    // BROW-02 — this tab's own serve-side ledger, holding this tab's own row.
    //
    // **Both halves are needed and neither is sufficient.** Handing `serveAgent` a real
    // ledger stops the report branch answering `counts: []`; recording this tab's own
    // outcome into it is what lets a peer that asks learn something it did not itself
    // supply. Without the second, `serveAgent` holds only what peers told it, a peer
    // asking is handed back its own row, and `mergeOverlapping`'s maximum-per-key makes
    // every merged report read 1 however many tabs are open.
    //
    // Both arguments are stated rather than defaulted: `ownStartOutcome` returns a required
    // union whose other arm is a named sentinel, so a tab with nothing fileable to report
    // says so by name rather than by an absent row — and `startReporting` is the visitor's
    // own answer to `DISCLOSURE.reporting`, required on this interface for the same reason.
    //
    // BROW-01 — **this is the line the consent has to reach, and until it did the opt-out
    // was cosmetic.** A tab whose visitor declined withheld the line from its own screen
    // and served the identical row to every peer that asked, because the row was already
    // in the ledger by the time anything consulted the choice. Recorded at the option's
    // docblock above with the measurement that showed it.
    const startLedger = ownStartLedger(
      ownStartOutcome(currentBrowserLabel()),
      options.startReporting,
    )

    // AUTH-03 — built once, here, and handed to **both** consumers below.
    //
    // It was constructed inline in the `serveAgent` call until 2026-08-18. It is hoisted
    // because a second consumer arrived: the placement ruling lets this tab combine in
    // its own process, and a tab that admitted its own work by a rule other than the one
    // it admits a peer's by would be more permissive to itself than to everybody else.
    // One value, two readers, no way for them to disagree.
    const authorize = authorizeCapability({
      ownerId: sovereignty.ownerId,
      ...(sovereignty.ownerKey === undefined ? {} : { ownerKey: sovereignty.ownerKey }),
      audience,
      now: Date.now,
    })

    // SCHED-03 / RUN-02 — built once, here, and read by every LOCAL path, exactly as
    // `authorize` one line up is built once and read by both consumers. Same site, same
    // stated reason. See {@link BrowserNode.localAdmission} for what was wrong before it.
    //
    // **`paused` is read from ONE binding, and that is the whole of the design.** The value
    // below is what the `serveAgent` call at the bottom of this function also passes, so a
    // peer's offer and this tab's own offer consult the same predicate at the same instant.
    // Resolving the option twice would be two readers with nothing able to catch them
    // disagreeing — the objection this file already records against a second authorizer.
    //
    // The named opt-out is written here, once, which is where the factory now states the
    // posture a caller who said nothing gets. `serve-agent-hooks.node.test.ts` counts it and
    // its note is the reason it must stay exactly one: driving it to zero would be a factory
    // that had either hard-wired a pause nobody asked for or dropped the hook.
    const paused = options.paused ?? 'never-pauses'
    const localAdmission: LocalAdmission = {
      would: (offer: Offer): Admission => {
        if (typeof paused === 'function' && paused()) {
          // `pausedAnswer`'s `offer` arm, verbatim in its two claims. Capacity is published
          // UNCHANGED — the figures say "my capabilities have not shrunk" — and `standing`
          // is what says "and I am not taking work anyway". A refusal that reported zero
          // slots would be a node claiming to have shrunk, which is a different and false
          // statement, and it would be read as such by a requestor's headroom map.
          return {
            accepted: false,
            reason: pausedRefusal(nodeId),
            capacity: { slots: admission.slots, inFlight: admission.inFlight },
            standing: 'declining-all-work',
          }
        }
        return admission.would(offer)
      },
    }

    // ── SCHED-01 / NET-06 — registration and provider announcement, and a tab does both ──
    //
    // Constructed here, before the node, so both are readable off it; started below, once
    // there is a node for a refusal to be recorded against. Byte-identical composition to
    // `fabric-node.ts`'s, which is the point: `clientMode: true` above says this tab does
    // not ANSWER a query, and says nothing whatever about what it may WRITE.
    //
    // A kad client puts to the servers closest to the key, which is exactly what makes a
    // tab findable by a peer that has never met it — the gap `rendezvous.ts` opens with:
    // *"no tab can be dialled cold, and none of them will ever announce itself."* This is
    // the announcement.
    // A thunk, so a renewed certificate reaches the keyspace. A value record outlives the
    // certificate inside it, so a tab that renewed without republishing would be discarded
    // by every reader running `verifyCertificate` while believing it was enrolled.
    const publisher =
      certificate === null
        ? null
        : new RecordPublisher(libp2p.services.dht, () => {
            const held = recordsFrom(
              certificates.current,
              identity,
              sovereignty.canExecuteSovereign,
            )
            return held === 'holds-no-records' ? undefined : held
          })
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

    // AUTH-06 — said once, by name, because a fact nobody is told is the defect that
    // returning it as a value exists to close. `fabric-node.ts` writes the same sentence to
    // stderr; a tab's stderr is the console, and this is the first `console.` call in
    // `packages/browser/src` — deliberately, because there is nowhere else a tab can say
    // something to the person sitting in front of it that is not a UI decision this factory
    // has no business making.
    if (identityIsUnprotected) {
      console.warn(
        `${identityStore.name} holds this tab's identity in the clear — anyone who copies this browser `
          + 'profile can speak as this node. It was adopted rather than deleted, because losing it would '
          + 'make this tab a different node and orphan any certificate naming it. Supply '
          + 'identityProtection: { kind: \'passphrase\', … } to seal the same bytes in place.',
      )
    }

    const node = new BrowserNode({
      libp2p,
      transport,
      rpc,
      egress,
      blockstore,
      store,
      recordIndex,
      dht: libp2p.services.dht,
      publisher,
      announcer,
      sovereignCids,
      identityStore,
      identityIsUnprotected,
      certificates,
      executor,
      signingExecutor: signing,
      governor,
      capGovernor,
      worker,
      admission,
      localAdmission,
      authorize,
      counter,
      startLedger,
      verifier,
    })
    serveAgent({
      rpc,
      // VER-08 — the signing layer, which is the outermost one. Every `exec` reply this
      // tab sends is composed from an outcome that passed through it.
      executor: signing,
      blockstore,
      // DATA-05: the same guard `rpc` is built over, plus the local-only tier that
      // says which payloads are sovereign — so a sovereign task's input is guarded
      // for exactly as long as its reply frame takes to settle, and a dispatch that
      // declared nothing gives nothing back.
      egress: egressDisposition,
      // AUTH-03, and the argument is byte-identical to `fabric-node.ts`'s — read that
      // one for what the hook is and why the conditional spread is required.
      //
      // **Why this tier is wired at all**, when all three of Phase 15's success
      // criteria name `bin/agent.ts` and none names a browser: leaving this call on the
      // sentinel would mean two node classes with different capability sets — one that
      // verifies a caller's authority and one that does not — which is the exact shape
      // whose deletion this module's own comment records, one milestone earlier. And it
      // costs one argument.
      //
      // **What checks it.** Two instruments, and the weaker one is named first because
      // it is the one a reader will find by grepping. A count of one occurrence of the
      // factory call's own name in this file — a substring count over source text, taken
      // by `serve-agent-hooks.node.test.ts` — reads 1 whatever arguments are passed:
      // `ownerId: sovereignty.ownerKey`, an `audience` derived from some other node, or a
      // `now` that never advances all satisfy it. That file's argument-equality check
      // catches those three, but only by requiring this call's text to match
      // `fabric-node.ts`'s, so a defect planted identically in both would pass it.
      //
      // (The name is described rather than written out above, deliberately. The
      // instrument counts raw text across this whole file, comments included, and
      // cannot tell a construction from a mention — the same rule
      // `browser-node-contract.node.test.ts` and `trust-anchors.node.test.ts` already
      // write down for their own matchers, and the one this comment tripped over on
      // first draft.)
      //
      // **The behavioural one is `packages/node/src/browser-capability.e2e.test.ts`**,
      // which dispatches three sovereign tasks to a live tab pinned to a real owner and
      // reads the refusal *text* plus this node's own executor call count: a chain that
      // is absent, one that has expired, and one that is valid, refused, refused and
      // accepted, with the executor never called for either refusal. Mutation-ledger
      // entry `M30` is that case planted against — transpose the two owner fields,
      // hardcode the audience and freeze the clock, and it goes red because the tab then
      // refuses for the wrong reason rather than the right one.
      //
      // The reason this stood unmeasured for four plans is worth leaving visible, because
      // it was a false statement everybody inherited: *"a tab holding no relay reservation
      // has no address any peer can dial, so it runs in neither vitest project"*. The
      // **`browser`** project indeed cannot host it — a Circuit Relay v2 server *"will not
      // work in browsers"* in `@libp2p/circuit-relay-v2`'s own words. The **`e2e`** project
      // has no such limit, and it needs no relay at all: the tab dials a Node submitter's
      // WebSocket listener directly, and the dispatch comes back along the connection the
      // tab itself opened.
      // Hoisted above the node construction so the local-combine path reads the same
      // value — see the `const authorize` there, and `BrowserNode.authorize`.
      authorize,
      // AUTH-01. Both of these were **unconditional sentinels** until this plan, and that
      // is what partitioned the fabric: a peer started with `--trusted-issuer` takes
      // blocks only from peers whose certificate verifies, and a tab that could not hold
      // one was excluded from every such peer's block set. Nothing branched on node kind
      // to do it — the option that would carry a certificate was simply absent, and an
      // absence partitions as effectively as a branch.
      //
      // Now derived, in the same expression `fabric-node.ts` uses, from values a caller
      // decided: `authority` is non-null exactly when this node was told to issue
      // certificates. Its sentinel is still the answer for a node that was asked for none —
      // a named absence, which is the convention, and not a silent default, which is the
      // hole.
      //
      // **`index` no longer has a sentinel here, and that is owner ruling D1.** A tab
      // holding no certificate still holds blocks, so it answers `records: null` and a real
      // provider list rather than refusing to speak; the named absence moved inward, to
      // `records: 'holds-no-records'`, where it describes the identity half alone. The
      // `providers` half is answered by every node, and *"a `providers` request answers `[]`
      // from every node because `provide()` is never called"* — true of this file from Phase
      // 6 to Phase 17 — is retired rather than deleted, so the change is findable.
      index: records,
      enroll: authority ?? 'issues-no-certificates',
      // SCHED-06. This hook answered "accepts everything" for the whole of two
      // milestones, so `serveAgent`'s `exec` branch ran `executor.execute` with
      // nothing counting what was in flight — a probe measured 800 simultaneous
      // executions and zero refusals. `LocalCapacity` existed the entire time and
      // was constructed nowhere outside two test files. `ARCHITECTURE.md` §7.2 said
      // *an over-committed node just says no, and the requestor resamples*; only
      // the half that resamples had shipped.
      //
      // **Measured on this factory since Plan 19-04 (WIRE-03), and the reading is a
      // number.** `packages/node/src/tab-refusals.e2e.test.ts` starts a tab through
      // `window.o2` with `maxConcurrentTasks: 1`, has a Node-tier peer dispatch two
      // `exec` requests concurrently over the connection the tab opened, and reads the
      // second one's own reply frame: `over-committed: 1 of 1 slots in use`. The same
      // construction at `maxConcurrentTasks: 2` answers `over-committed: 2 of 2 slots
      // in use`, which is what says the figure tracks this option rather than the
      // order two requests happened to arrive in — and, because a refusal naming
      // `2 of 2` states its own occupancy, it is also the evidence that two tasks ran
      // at once in one tab. Planting this hook's own named opt-out on this line turns
      // both cases red; the sovereign-egress case in the same file stays green.
      //
      // (The opt-out is described rather than written out, deliberately, and this
      // paragraph tripped over it on first draft — `serve-agent-hooks.node.test.ts`
      // requires **zero** occurrences of that literal in this file and counts raw text
      // across the whole of it, comments included. Same rule the `authorize:` block below
      // and `browser-node-contract.node.test.ts` already write down for their own
      // matchers: the instrument cannot tell a construction from a mention, so this file
      // does not put the text where it would be counted.)
      //
      // **Two claims that stood here are retired rather than deleted, because the
      // second is the shape this milestone exists to remove.** The first was *"needs a
      // real `indexedDB` and a relay to dial, so it runs in neither vitest project"* —
      // false, and retired earlier by `start-unwind.browser.test.ts`, which starts this
      // factory to success in three engines, and by `browser-capability.e2e.test.ts`,
      // which starts it against a live tab with no relay at all. The second replaced it
      // and was true when written: *"nothing drives a refusal through this hook, so the
      // number this node would answer an over-committed requestor with has never been
      // read"*. It is false now. Both are left visible because one false sentence about
      // testability kept four items deferred across four plans, and a reader deciding
      // whether some other hook here is reachable needs the history rather than a clean
      // line that tells them nothing.
      //
      // What is still true and is a different claim: the *bound* — that no more than
      // `slots` tasks ever ran at once — is falsifiable only from a counter around the
      // executor, and on this tier that is {@link BrowserNode.executorPeakInFlight},
      // which no e2e case reads. `admission.node.test.ts` reads its Node-tier twin.
      // What the file above measures is the refusal and its wording, which is what a
      // requestor is actually told.
      capacity: admission,
      // SCHED-03. The posture the visitor stated, or the named opt-out — never an
      // omission, because `AgentOptions.paused` has no default to fall through to.
      //
      // **This is not the capacity hook one line up and must never be folded into it.**
      // The slot floor of 1 exists so that throttling cannot express a stop, so a tab
      // that wants to stop taking work has no way to say so through `capacity` — and
      // closing the tab is not that statement either, because it takes the relay
      // reservation and the tab's discoverability with it.
      //
      // A per-node setting, not a node kind: `fabric-node.ts` threads the identical
      // ternary over its own option, and `serve-agent-hooks.node.test.ts` counts both.
      paused,
      // BROW-02. **The named opt-out is gone from this file**, because there is no longer
      // a tab this factory can build that has been told nothing: every node holds a ledger
      // and every node's own start is the first row in it. See the construction above for
      // why the own row is the load-bearing half.
      //
      // (The opt-out literal is described rather than written out, deliberately, and this
      // paragraph tripped over it on first draft. `serve-agent-hooks.node.test.ts` counts
      // raw text across the whole of this file, comments included, and now requires
      // **zero** occurrences of it here — the same rule the `capacity:` block above and
      // `browser-node-contract.node.test.ts` already write down for their own matchers:
      // the instrument cannot tell a construction from a mention.)
      //
      // A per-node holding, not a node kind: `fabric-node.ts` passes the identically named
      // value derived by the identical pair of functions over its own label, and that
      // guard counts both. Any node may hold one, on the same terms as any other — the
      // only difference between nodes is discovery. If this row ever diverges from the
      // Node factory's without a stated reason, something has started keying on node kind.
      ledger: startLedger,
      reservations: 'relays-for-nobody',
      onDispatch: (from) => {
        node.servedFor.set(from, (node.servedFor.get(from) ?? 0) + 1)
        node.#announce()
      },
      // VER-08 / VER-09 / VER-10 — the node's own signing identity, for **both** verbs,
      // and **the same value the executor above was wrapped with**. One identity resolved
      // on one line and reaching both: two derivations from one source are two things
      // that can drift, and the drift has a specific shape — a node that signed its map
      // results and not the aggregation over them would satisfy the letter of this leg
      // and none of its purpose.
      //
      // The two verbs reach it by different routes because the codebase is shaped that
      // way: `exec` runs through an `Executor` and signs through the wrapper composed
      // above; a combine passes through no executor at all, so its signer arrives here.
      //
      // A tab holding no certificate passes the named absence to **both**, so no
      // construction path through this factory signs one verb and not the other. Signing
      // is not a capability a tier confers — if this row ever diverges from the Node
      // factory's without a stated reason, something has started keying on node kind,
      // which is the failure Phases 16 and 17 each shipped once.
      attest: attestor,
    })

    // Started here, and the trigger is start **and every peer arrival**.
    //
    // **Published once was published nowhere, and a tab is the case where that bit
    // hardest.** A put against an empty routing table does not fail — `kad-dht` writes the
    // record to the local datastore before it walks to the closest peers — so the one-shot
    // reported success and left the record in the only place that already had it. A tab
    // starts behind a relay with an empty table *by definition*, so every tab registered
    // with nobody, and every `dht.get` for a tab missed.
    //
    // `peer:identify` rather than `peer:connect`: kad-dht populates its routing table
    // through a topology registered on the DHT protocol, and that fires once identify has
    // said which protocols the peer speaks. The announcer sweeps on the same signal for the
    // same reason — an announcement walks the same table. Nothing here is timed.
    //
    // Published from the same object that serves them, so what a peer reads from the DHT
    // and what this tab answers over RPC cannot come to disagree. Not awaited and not
    // fatal, for the reason given at the Node factory's identical line.
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

    // AUTH-04 — a tab keeps its certificate alive on the same terms a server does.
    //
    // Not an optional extra for this tier: a tab is the node most likely to be running
    // when its certificate lapses, because it has no operator watching it and no restart
    // to fall back on. Without this it would go on executing while every peer's
    // `PeerVerifier` demoted it and every relay's admission gate refused its reservation
    // renewal — visible to the user as a tab that simply stopped being given work.
    //
    // The republish is what makes it visible: a value record outlives the certificate
    // inside it, and the publisher reads through the same holder.
    if (options.enrollment !== undefined) {
      undo.push(
        startCertificateRenewal({
          holder: certificates,
          renew: async () =>
            resolveCertificate({
              enrollment: options.enrollment,
              identity,
              rpc,
              libp2p,
              identityStore,
              canRelay: canRelayFrom(BROWSER_LISTEN),
              relayPeerIds,
              reuse: 'must-obtain-a-fresh-certificate',
            }),
          renewed: async () => {
            // `resolveCertificate` already wrote IndexedDB; the keyspace is what is left.
            if (publisher !== null) await publisher.publish()
          },
          ...(options.renewalRetryFloorMs === undefined
            ? {}
            : { retryFloorMs: options.renewalRetryFloorMs }),
        }),
      )
    }

    undo.push(
      onPeerArrival(() => {
        void announcer.sweep()
      }),
    )

    // NET-05 — a tab looks for relays and never offers itself as one.
    //
    // There is no `canRelay` branch here because there is no case to branch on: the relay
    // server *"will not work in browsers"* in its own package's words, and a tab's
    // certificate says `'via-relay'` for the same reason. So this tier performs only the
    // looking half, and it is the tier that needs it most — a tab's every address runs
    // through a relay, so losing that relay removes it from the fabric entirely, and it
    // cannot be told about a replacement because being told requires being reachable.
    //
    // Bounded by `RELAY_RESERVATION_TARGET`, byte-identical to the backbone's ceiling, and
    // the constant carries the arithmetic: 64 slots per relay make `k` a divisor on how
    // many tabs the fabric can hold at once.
    const topUpRelayReservations = async (): Promise<void> => {
      await topUpRelays({
        target: RELAY_RESERVATION_TARGET,
        // An approximation and stated as one, exactly as the backbone states it: one relay
        // may publish more than one circuit address for this tab, so this can over-count
        // and stop early. Over-counting spends fewer slots than the ceiling rather than
        // more, which is the safe direction for a number whose whole job is to be a
        // ceiling.
        reserved: () =>
          libp2p.getMultiaddrs().filter((ma) => ma.toString().includes('/p2p-circuit')).length,
        discover: () => discoverRelays({ index: recordIndex, self: identity.nodeKey }),
        connect: async (nodeKey) => {
          const spelling = peerIdForNodeKey(nodeKey)
          if (spelling === null) return
          // Connecting is what reserves: `/p2p-circuit` is already in this tab's listen
          // list, and libp2p turns a connection to a relay into a reservation because of
          // it.
          await libp2p.dial(peerIdFromString(spelling))
        },
      })
    }
    void topUpRelayReservations()
    undo.push(
      onPeerArrival(() => {
        void topUpRelayReservations()
      }),
    )

    return node
  }

  /**
   * Why this tab's records are not in the keyspace, or `undefined` if nothing refused.
   *
   * A tab is the case this reading matters most for: it is behind a relay, its routing
   * table may be empty for a while after start, and a silent failure would be
   * indistinguishable from a successful registration nobody can find.
   */
  /**
   * This tab's provider-signed certificate, or `null` when it holds none — AUTH-01.
   *
   * `null` is the answer for a node nobody asked to enrol, and it is not a failure. Nor
   * is it a lesser tier: a node with a certificate executes tasks, holds blocks and takes
   * quorum slots on exactly the terms as one without, and what the certificate buys is
   * being taken *by a peer that pinned an issuer*. Public, because a certificate is a
   * public signed statement — every peer is meant to be able to read it. Mirrors
   * `FabricNode.certificate`, which carries the long form.
   *
   * **A getter rather than a field, since AUTH-04 renewal** — the certificate a running
   * tab holds is replaced about two-thirds of the way through its life, and a caller that
   * read a field once would hold one this tab has stopped presenting to peers.
   */
  get certificate(): NodeCertificate | null {
    return this.#certificates.current
  }

  get registrationRefusal(): string | undefined {
    return this.#registrationRefusal
  }

  /** Recorded by the start path's publish; see {@link registrationRefusal}. */
  noteRegistrationRefused(reason: string): void {
    this.#registrationRefusal = reason
  }

  /**
   * How many peers stored this tab's records at its most recent publish — SCHED-01.
   *
   * Zero is a real state, not a failure: `kad-dht` writes a record locally before walking
   * to the closest peers, so a publish with an empty routing table succeeds and reaches
   * nobody. See {@link FabricNode.registrationPeers} for the full reading — the two are one
   * measurement on two tiers.
   */
  get registrationPeers(): number {
    return this.#publisher?.peers ?? 0
  }

  /** How many of this tab's blocks are currently advertised in the keyspace — SCHED-01. */
  get announcedBlocks(): number {
    return this.#announcer.announcedCount
  }

  /** Announce the blocks this tab holds, and retract the ones it may no longer advertise. */
  async announceHeldBlocks(): Promise<SweepOutcome> {
    return this.#announcer.sweep()
  }

  get peerId(): string {
    return this.libp2p.peerId.toString()
  }

  get multiaddrs(): readonly string[] {
    return this.libp2p.getMultiaddrs().map((ma) => ma.toString())
  }

  /**
   * The `/webrtc` addresses another tab can dial.
   *
   * Empty until a relay reservation exists, because a browser's WebRTC address is
   * expressed relative to the relay that will carry its SDP exchange.
   */
  get webrtcAddrs(): readonly string[] {
    return this.multiaddrs.filter((ma) => ma.includes('/webrtc'))
  }

  get circuitAddrs(): readonly string[] {
    return this.multiaddrs.filter((ma) => ma.includes('/p2p-circuit'))
  }

  /**
   * Every peer this tab holds an open connection to, and whether that connection can
   * carry a job — defect 32.
   *
   * ## Why this exists beside `transport.peers`
   *
   * `transport.peers` is `libp2p.getPeers()`, which is *"every peer with at least one
   * connection"* and says nothing about what those connections can do. A relayed circuit
   * is `limited` — 2 minutes and 128 KiB, verified defaults — and `PROJECT.md` records
   * that the relay is a signalling channel that may not carry a job. So a pair whose only
   * connection is a circuit is **connected and unusable**, and every reading built on
   * `transport.peers` alone reports it as fine. Measured: a firefox↔webkit pair holding
   * nothing but a circuit answered each other's `offer`, so `computePeers()` counted it,
   * because the RPC protocol is registered `runOnLimitedConnection: true`.
   *
   * ## Why `carriesWork` is a positive test
   *
   * A pair that upgraded successfully routinely keeps the signalling circuit open beside
   * the WebRTC connection — measured, three connections with two of them limited. The
   * question is therefore whether a usable connection is *present*, never whether an
   * unusable one is absent.
   *
   * ## What it is not
   *
   * It is not a peer classification and nothing branches on node kind here: a peer is
   * described by the connection this tab holds to it, which is a fact about this tab's
   * own socket table. The same peer is `carriesWork: true` from one tab and `false` from
   * another in the same instant, and both are right.
   */
  get heldPeers(): readonly HeldPeer[] {
    const carries = new Map<string, boolean>()
    for (const connection of this.libp2p.getConnections()) {
      // A closing connection can still appear here — the `close` event may not have been
      // processed in this tick — and counting one as usable would report a pair as fine
      // at exactly the moment it stopped being so. libp2p's own dialler filters on the
      // same field for the same reason.
      if (connection.status !== 'open') continue
      const peer = connection.remotePeer.toString()
      carries.set(peer, (carries.get(peer) ?? false) || connection.limits === undefined)
    }
    return [...carries].map(([peer, carriesWork]) => ({ peer, carriesWork }))
  }

  async dial(address: string): Promise<string> {
    const connection = await this.libp2p.dial(multiaddr(address))
    return connection.remotePeer.toString()
  }

  /**
   * Stop everything — BROW-04's "one click provably drops CPU to zero".
   *
   * The thread dies first. Closing the connections before killing it would leave
   * a window in which the node is unreachable but still burning cycles, which is
   * the worst of both and exactly what a visitor pressing Stop does not want.
   */
  async stop(): Promise<void> {
    this.worker.terminate()
    this.rpc.close()
    // AUTH-02, and before the transport for `fabric-node.ts`'s stated reason: the verifier
    // holds two listeners on `libp2p`, and a stopped tab that kept them would react to a
    // `peer:connect` by issuing a records request through an endpoint it has already
    // closed. A no-op for a tab that pins nobody — it never subscribed.
    this.#verifier.stop()
    await this.transport.stop()
    await this.libp2p.stop()
    this.governor.stop()
    this.store.inner.close()
    // Closed last and beside the blockstore, because an open IndexedDB connection is what
    // blocks a `deleteDatabase` — the effect `start-unwind.browser.test.ts` reads.
    this.identityStore.close()
  }
}
