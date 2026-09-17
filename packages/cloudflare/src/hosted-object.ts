/**
 * The hosted tier's Durable Object and the one place its stubs are obtained —
 * Phase 29 criteria 3, 4 and 6.
 *
 * ## Three separate irreversibilities live in this file
 *
 * They are together because each one's guard reads this file, and a rule spread over three
 * files is a rule with three places to be edited out of.
 *
 * 1. **An object's location is fixed by its very first `get()` and never changes.** A stray
 *    `get()` in an unrelated module sites the object permanently wherever that call came
 *    from, and the only repair is a new name — not a redeploy, not a migration. So exactly
 *    one function in this repository may obtain a stub, and `hosted-tier-siting.node.test.ts`
 *    fails when a second appears.
 * 2. **A name derived from visitor-controlled input lets a visitor create objects.** The name
 *    set is therefore a closed enumeration in source ({@link HOSTED_OBJECT_NAME}), and the
 *    same guard refuses a call whose argument is not one of its members.
 * 3. **The store must not accept a DHT record until Phase 31 lands the expiry sweep.** That
 *    refusal is `DoDatastore`'s and is already built; what this file adds is the production
 *    construction of it, so the refusal is on a real path rather than only in a spec.
 *
 * ## What this object does NOT do yet, stated rather than implied
 *
 * **It does not listen.** Criterion 2 — an outside peer dialling
 * `/dns4/<name>/tcp/443/tls/ws/p2p/<peerId>` — is an owner act at the Cloudflare boundary by
 * ruling, and the inbound half additionally has a **measured blocker** that the phase's own
 * research does not record. `.planning/consults/2026-08-24-…-measured.md` §9 gives the
 * listener as `server.accept()` → `webSocketToMaConn()` → `upgrader.upgradeInbound()` and
 * calls it "about forty lines [needing] no new transport". Measured 2026-08-26 against the
 * pinned `@libp2p/websockets@10.1.17`:
 *
 * - the barrel exports exactly one symbol, `webSockets` — `Object.keys(await
 *   import('@libp2p/websockets'))` is `['webSockets']`
 * - the deep path is refused by Node with `ERR_PACKAGE_PATH_NOT_EXPORTED`, because the
 *   package's `exports` map declares only `.` and `./filters`
 *
 * So `webSocketToMaConn` is not reachable through any supported import of the pinned package,
 * and the recipe cannot be written as it stands.
 *
 * **CORRECTED 2026-08-26, SAME DAY, AND THE CORRECTION IS LARGER THAN THE CLAIM.** The reading above is WRONG about the conclusion and right only about one resolver. `ERR_PACKAGE_PATH_NOT_EXPORTED` is **Node's** ESM resolver refusing a package-specifier import; `exports` is consulted only for package specifiers, and a FILE PATH does not go through it at all. Measured the same day with three wrangler builds: importing `@libp2p/websockets/dist/src/websocket-to-conn.js` by specifier fails in esbuild too (*"Could not resolve"*, exit 1), and importing the same file BY PATH builds — **exit 0, 153.30 KiB, and `webSocketToMaConn` appears three times in the emitted bundle**. So the function is reachable and the listener is writable today. What I did was measure Node and conclude about wrangler.
 *
 * **What is actually open is what the research already said was open**, which is the second half of the error: `.planning/research/v2.0/STACK.md:146` states the listener *"is already measured working against the exact pinned versions this project runs … it is already built"*, and `ARCHITECTURE.md:484-506` names FOUR requirements for it — `direction: 'inbound'` (§14; omitted, both ends negotiate yamux as clients and every stream is refused while the dial still looks fine), `remoteAddr` from `CF-Connecting-IP` (§19; omitted, libp2p rate-limits the whole internet as one host at 5/s), an explicit answer for `bufferedAmount` (§16; absent from workerd's WebSocket prototype), and a **hibernation-aware** socket (§17), which that document calls *"the largest genuinely-new engineering item on this tier"* and scopes as its own task. Three of those four belong to **Phase 30 — Inbound Listener Correctness & Hibernation**, by the roadmap's own division.
 *
 * What IS here is everything the identity claim needs: the store, the seed, and a PeerId that
 * is the same on a second instantiation over the same storage.
 */

import { DoDatastore } from './do-datastore.ts'
import { hostedIdentity } from './hosted-identity.ts'
import type { DurableObjectStorage } from './durable-object-storage.d.ts'
import type { NodeIdentity } from '@o2/libp2p'

/**
 * Every name an object of this class may be created under — Phase 29 criterion 6.
 *
 * A `const` object with a derived union rather than an `enum`, following
 * {@link REFUSED_NAMESPACE} in `do-datastore.ts` and the owner ruling of 2026-08-25 it
 * records: this tree holds string-literal unions and no enums, and an enum would fuse our
 * identifier with the wire name.
 *
 * **Three names, one per region, and the set is closed.** Phase 33 owns `bootstrap-us`,
 * `-eu` and `-sam` as a milestone risk — *"no document claims where any of them runs"* — so
 * the names are declared here now and the guard closes the set before anything can widen it.
 * A fourth region is a source edit and a code review, which is the point: an object's
 * location is fixed by its first `get()`, so the set of names IS the set of sitings.
 */
export const HOSTED_OBJECT_NAME = {
  us: 'bootstrap-us',
  eu: 'bootstrap-eu',
  sam: 'bootstrap-sam',
} as const

/** One of {@link HOSTED_OBJECT_NAME}'s values. */
export type HostedObjectName = (typeof HOSTED_OBJECT_NAME)[keyof typeof HOSTED_OBJECT_NAME]

/** The closed set as an array, derived rather than written twice — see {@link REFUSED_NAMESPACE}. */
export const HOSTED_OBJECT_NAMES: readonly HostedObjectName[] = Object.values(HOSTED_OBJECT_NAME)

/**
 * The Durable Object platform's own jurisdiction union — declared at the platform's width, not
 * narrowed to what this fabric happens to use.
 *
 * Read 2026-09-13 out of the installed `@cloudflare/workerd-darwin-arm64` binary's own bundled
 * type text (`node_modules/@cloudflare/workerd-darwin-arm64/bin/workerd`), not out of
 * documentation: `type DurableObjectJurisdiction = "eu" | "fedramp" | "fedramp-high" | "us"`.
 * `HOST-06`'s ledger row (`.planning/REQUIREMENTS.md:2193`) names three of these four; the
 * fabric uses exactly one, {@link HOSTED_JURISDICTION}'s `eu`. The union stays at the
 * platform's full width rather than a narrowed three- or one-member alias, because a wider
 * union here would let a typo in an unused member compile silently — this is what refuses an
 * undeclared value at the earliest point a creation call can exist, before
 * {@link HOSTED_JURISDICTION} is even read.
 */
export type DurableObjectJurisdiction = 'eu' | 'fedramp' | 'fedramp-high' | 'us'

/**
 * The one jurisdiction this fabric actually places an object under.
 *
 * One member, because exactly one region — `bootstrap-eu` — is placed by binding
 * jurisdiction. **`bootstrap-us` is deliberately absent from this object.** Wrapping the
 * already-created `us` object in any jurisdiction would derive a different object ID than the
 * plain namespace it was created through, orphaning the live identity — see
 * {@link euJurisdictionOf}'s docblock for the mechanism. `bootstrap-sam` is absent for a
 * different reason: no South-American jurisdiction value exists in
 * {@link DurableObjectJurisdiction} at all, so `sam` is carried as a
 * {@link HostedLocationHint} instead and never as a jurisdiction.
 */
export const HOSTED_JURISDICTION: Record<'eu', DurableObjectJurisdiction> = { eu: 'eu' }

/**
 * The location-hint set, closed in source because the platform closes nothing.
 *
 * Measured 2026-09-13 against a local `workerd`: passing `{ locationHint: 'notareal' }` as the
 * options a stub is obtained with was accepted and returned a live stub — the platform
 * validates no hint value at all. This set, and {@link UnknownLocationHintError}, are the only
 * refusal of a mistyped hint that exists anywhere in this system.
 */
export const HOSTED_LOCATION_HINT = { sam: 'sam' } as const

/** One of {@link HOSTED_LOCATION_HINT}'s values. */
export type HostedLocationHint = (typeof HOSTED_LOCATION_HINT)[keyof typeof HOSTED_LOCATION_HINT]

/** The closed set as an array, derived rather than written twice — see {@link HOSTED_OBJECT_NAMES}. */
export const HOSTED_LOCATION_HINTS: readonly HostedLocationHint[] = Object.values(HOSTED_LOCATION_HINT)

/** The options {@link stubFor}'s third argument accepts — the non-binding location hint. */
export interface HostedObjectGetOptions {
  readonly locationHint: HostedLocationHint
}

/**
 * The platform surface {@link stubFor} needs, declared as narrowly as it is used.
 *
 * The same discipline `durable-object-storage.d.ts` states for its own declaration: a
 * narrower interface is one a fixture can implement COMPLETELY, and a complete fake is the
 * only kind that can honestly claim to model the platform. `@cloudflare/workers-types` is
 * deliberately not a dependency — it would bring the whole platform surface for two methods.
 *
 * `jurisdiction` is optional so a fixture that never exercises the `eu` path — the `us` and
 * `sam` cases among them — can still implement this interface COMPLETELY without inventing a
 * method the platform namespace it stands in for would not be asked to provide either.
 */
export interface HostedObjectNamespace<Stub> {
  idFromName: (name: string) => unknown
  get: (id: unknown, options?: HostedObjectGetOptions) => Stub
  jurisdiction?: (jurisdiction: DurableObjectJurisdiction) => HostedObjectNamespace<Stub>
}

/** Thrown when a name outside {@link HOSTED_OBJECT_NAMES} reaches {@link stubFor}. */
export class UnknownHostedObjectNameError extends Error {
  constructor(name: string) {
    super(
      `"${name}" is not one of the hosted tier's ${String(HOSTED_OBJECT_NAMES.length)} declared ` +
        `object names (${HOSTED_OBJECT_NAMES.join(', ')}) — refusing to site an object under it`,
    )
    this.name = 'UnknownHostedObjectNameError'
  }
}

/**
 * Thrown by {@link euJurisdictionOf} when the namespace it was given cannot be narrowed by
 * jurisdiction at all — a runtime missing the method is refused by name rather than crashing
 * on `undefined(...)`.
 */
export class UnsupportedJurisdictionError extends Error {
  constructor(jurisdiction: string) {
    const declared = Object.values(HOSTED_JURISDICTION)
    super(
      `"${jurisdiction}" is not one of the hosted tier's ${String(declared.length)} declared ` +
        `jurisdictions (${declared.join(', ')}) — refusing to site an object under it`,
    )
    this.name = 'UnsupportedJurisdictionError'
  }
}

/** Thrown when a value outside {@link HOSTED_LOCATION_HINTS} would reach {@link stubFor}. */
export class UnknownLocationHintError extends Error {
  constructor(hint: string) {
    super(
      `"${hint}" is not one of the hosted tier's ${String(HOSTED_LOCATION_HINTS.length)} declared ` +
        `location hints (${HOSTED_LOCATION_HINTS.join(', ')}) — refusing to site an object under it`,
    )
    this.name = 'UnknownLocationHintError'
  }
}

/**
 * **The one call site in this repository that may obtain a stub.**
 *
 * The runtime check is not redundant beside the type. `HostedObjectName` is erased at the
 * boundary this actually guards: a name that arrived from a request is a `string`, and the
 * only thing that can refuse it is a value check. The type stops a typo at compile time; this
 * stops a visitor at run time, and criterion 6 is about the second.
 *
 * A `Set` lookup rather than `includes`, so adding a fourth region does not quietly make this
 * linear in a path that runs on every request.
 *
 * **The third argument is passed through untouched, with no branch on it.** Measured
 * 2026-09-13 against a local `workerd`: obtaining a stub with an explicit `undefined` in that
 * position returns a live stub, identically to omitting the argument entirely — so an
 * `if (options)` here would be a branch guarding nothing. The difference
 * between the three placements is carried entirely by what the CALLER hands to this function
 * ({@link euJurisdictionOf} narrowing `namespace` first, or {@link samLocationHint} supplying
 * `options`), never by a branch inside it.
 */
const DECLARED_NAMES: ReadonlySet<string> = new Set<string>(HOSTED_OBJECT_NAMES)

export function stubFor<Stub>(
  namespace: HostedObjectNamespace<Stub>,
  name: HostedObjectName,
  options?: HostedObjectGetOptions,
): Stub {
  if (!DECLARED_NAMES.has(name)) throw new UnknownHostedObjectNameError(name)
  return namespace.get(namespace.idFromName(name), options)
}

/**
 * Narrows a namespace to the `eu` jurisdiction before anything is sited under it.
 *
 * Returns a **namespace**, never a stub — narrowing and siting are two separate platform
 * calls, and collapsing them into one function would hide exactly the distinction `HOST-06`
 * exists to make visible. Call {@link stubFor} on the RESULT to site the object:
 * `stubFor(euJurisdictionOf(env.BOOTSTRAP), HOSTED_OBJECT_NAME.eu)`.
 *
 * Throws {@link UnsupportedJurisdictionError} before calling anything, when the namespace does
 * not implement `jurisdiction` at all — a runtime that does not offer the method must be
 * refused by name rather than crash on `undefined(...)`.
 *
 * **There is no equivalent helper for `bootstrap-us`, and the absence is the placement.**
 * Deriving a name through `namespace.jurisdiction('eu')` first produces a different object ID
 * than deriving that same name straight off the plain namespace — narrowing by jurisdiction
 * changes the namespace the ID is derived against. The `bootstrap-us` object was created
 * through the plain namespace and has carried real traffic since 2026-08-27. Wrapping its path
 * in any jurisdiction now would address a new, different object and permanently orphan the
 * live one. So `us` is sited on the plain namespace with no helper wrapping it — deliberately,
 * not an omission left to fill in later.
 */
export function euJurisdictionOf<Stub>(namespace: HostedObjectNamespace<Stub>): HostedObjectNamespace<Stub> {
  if (typeof namespace.jurisdiction !== 'function') {
    throw new UnsupportedJurisdictionError(HOSTED_JURISDICTION.eu)
  }
  return namespace.jurisdiction(HOSTED_JURISDICTION.eu)
}

/**
 * The `sam` region's non-binding location hint, ready to pass as {@link stubFor}'s third
 * argument: `stubFor(env.BOOTSTRAP, HOSTED_OBJECT_NAME.sam, samLocationHint())`.
 *
 * Takes no parameter: `sam` is the only region placed by hint rather than jurisdiction, so
 * there is nothing to choose between. Throws {@link UnknownLocationHintError} if the value it
 * is about to return has fallen out of {@link HOSTED_LOCATION_HINTS} — a check on this
 * function's own output, so a future edit that widens {@link HOSTED_LOCATION_HINT} without
 * widening the array derived from it is caught here rather than silently trusted.
 */
export function samLocationHint(): HostedObjectGetOptions {
  const hint = HOSTED_LOCATION_HINT.sam
  if (!HOSTED_LOCATION_HINTS.includes(hint)) throw new UnknownLocationHintError(hint)
  return { locationHint: hint }
}

/**
 * The hosted node's state, assembled over one Durable Object's storage.
 *
 * A plain class taking `DurableObjectStorage` rather than a class extending the platform's
 * `DurableObject`: the platform base class is what a deploy needs and is what a local test
 * cannot construct, and everything worth asserting here is on this side of that line. The
 * deployed class is a thin subclass, and it is deliberately the only part of this file that
 * no local spec can reach.
 */
export class HostedNode {
  readonly #store: DoDatastore
  readonly #identitySecret: string | undefined
  #identity: Promise<NodeIdentity> | undefined

  /**
   * @param identitySecret the platform secret this object's seed is sealed under — AUTH-07
   * criterion 4. Threaded in rather than read from a global because a Durable Object receives
   * its bindings as a constructor argument and nothing here may reach for an ambient one.
   * `undefined` is a configuration this object **refuses**, by name, without minting anything;
   * see `hosted-identity.ts`'s `HostedIdentitySecretMissingError`.
   */
  constructor(storage: DurableObjectStorage, identitySecret: string | undefined) {
    this.#store = new DoDatastore(storage)
    this.#identitySecret = identitySecret
  }

  /** The store this node persists through — the production construction of `DoDatastore`. */
  get store(): DoDatastore {
    return this.#store
  }

  /**
   * This node's identity, opened on first call and read from storage on every later one.
   *
   * Memoised so that a second call within one instantiation cannot re-read and cannot mint —
   * but the memo is NOT what makes the PeerId stable. Stability comes from the store, and the
   * spec proves it by constructing a **second** `HostedNode` over the same storage, which
   * shares no memo with the first. A test that only called this twice on one instance would
   * be asserting the memo.
   *
   * **The PROMISE is memoised, not the resolved value, and since AUTH-07 that is load bearing
   * rather than tidy** — `#fabricOnce` in `worker.ts` already says why in its own words. The
   * previous shape assigned after awaiting, so two concurrent callers both saw `undefined` and
   * both ran the load. That was harmless while the load was storage operations only, because a
   * Durable Object's input gate serialises those. Opening the envelope is an Argon2id
   * derivation — ~400 ms of work that is *not* a storage operation — so awaiting it opens the
   * gate, and two concurrent `GET /self` calls on a fresh object could each have derived, each
   * have minted, and reported two different PeerIds. One promise, one derivation.
   */
  async identity(): Promise<NodeIdentity> {
    this.#identity ??= hostedIdentity(this.#store, this.#identitySecret)
    return await this.#identity
  }
}
