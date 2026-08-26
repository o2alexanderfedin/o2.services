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
 * The platform surface {@link stubFor} needs, declared as narrowly as it is used.
 *
 * The same discipline `durable-object-storage.d.ts` states for its own declaration: a
 * narrower interface is one a fixture can implement COMPLETELY, and a complete fake is the
 * only kind that can honestly claim to model the platform. `@cloudflare/workers-types` is
 * deliberately not a dependency — it would bring the whole platform surface for two methods.
 */
export interface HostedObjectNamespace<Stub> {
  idFromName: (name: string) => unknown
  get: (id: unknown) => Stub
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
 * **The one call site in this repository that may obtain a stub.**
 *
 * The runtime check is not redundant beside the type. `HostedObjectName` is erased at the
 * boundary this actually guards: a name that arrived from a request is a `string`, and the
 * only thing that can refuse it is a value check. The type stops a typo at compile time; this
 * stops a visitor at run time, and criterion 6 is about the second.
 *
 * A `Set` lookup rather than `includes`, so adding a fourth region does not quietly make this
 * linear in a path that runs on every request.
 */
const DECLARED_NAMES: ReadonlySet<string> = new Set<string>(HOSTED_OBJECT_NAMES)

export function stubFor<Stub>(
  namespace: HostedObjectNamespace<Stub>,
  name: HostedObjectName,
): Stub {
  if (!DECLARED_NAMES.has(name)) throw new UnknownHostedObjectNameError(name)
  return namespace.get(namespace.idFromName(name))
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
  #identity: NodeIdentity | undefined

  constructor(storage: DurableObjectStorage) {
    this.#store = new DoDatastore(storage)
  }

  /** The store this node persists through — the production construction of `DoDatastore`. */
  get store(): DoDatastore {
    return this.#store
  }

  /**
   * This node's identity, minted on first call and read from storage on every later one.
   *
   * Memoised so that a second call within one instantiation cannot re-read and cannot mint —
   * but the memo is NOT what makes the PeerId stable. Stability comes from the store, and the
   * spec proves it by constructing a **second** `HostedNode` over the same storage, which
   * shares no memo with the first. A test that only called this twice on one instance would
   * be asserting the memo.
   */
  async identity(): Promise<NodeIdentity> {
    this.#identity ??= await hostedIdentity(this.#store)
    return this.#identity
  }
}
