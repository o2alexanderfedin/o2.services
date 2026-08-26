/**
 * The hosted tier's deployed entry point — the module wrangler builds and Cloudflare runs.
 *
 * ## Why this file is an entry point in the reachability sense, not just in wrangler's
 *
 * `packages/node/src/reachability.ts` walks the call graph from a list of **modules the
 * fabric is entered through**, and states the rule it applies: the three runnable modules it
 * leaves out are defensible because *"adding them changes no barrel verdict"*. That reading
 * is false for this file, which is the whole point of it — a deployed Worker is definitionally
 * a way the fabric is entered, and it is the only caller `@o2/cloudflare`'s barrel has. The
 * 2026-08-08 owner ruling that excluded `tools/aot/bench-lifted.ts` drew exactly this line:
 * that file is *"a benchmark driver, not a way the fabric is entered."* This one is the other
 * side of it.
 *
 * ## What it is allowed to answer, and why the list is this short
 *
 * `GET /self` and nothing else. Every route is a surface, and this tier's surfaces are not
 * this phase's subject — Phase 30 owns the inbound listener, Phase 31 the record store, Phase
 * 32 the relay. A route added here "while we are in the file" would be a capability shipped
 * without the phase that measures it, which is the shape `descoped is not satisfied` names.
 *
 * ## What it does NOT do
 *
 * It does not upgrade a WebSocket and does not accept a libp2p dial. Criterion 2 is an owner
 * act at the Cloudflare boundary in any case, and the listener's own requirements belong to
 * Phase 30 — Inbound Listener Correctness & Hibernation — by the roadmap's division.
 *
 * **It also does not construct the libp2p node, and that is a decision rather than an
 * omission.** `hosted-libp2p.ts` landed with this commit and `createHostedFabric` is reached
 * from no production path here. The alternative was a `fabric()` method on this class that
 * nothing calls, and an uncalled member on the deployed class is precisely the *"wired is not
 * used"* shape `CLAUDE.md` records being caught three times on the DHT. Until Phase 30's
 * listener exists there is nothing for a running node to do: it cannot be dialled, and a
 * bootstrap that cannot be dialled is not a bootstrap. So the assembly is delivered, proven by
 * spec, and left uncalled **with the reason recorded**.
 *
 * **Uncalled is not the same as unbundled, and this paragraph said otherwise until it was
 * measured.** It read *"`@chainsafe/libp2p-noise` therefore still does not reach this
 * bundle"*, which was a prediction from the fact that nothing calls `createHostedFabric`. The
 * build says the opposite: `wrangler deploy --dry-run` emits 583.94 KiB in which `noise`
 * appears **43 times** and `pureJsCrypto` twice. The reason is ordinary — `alarm()` imports
 * `hostedExpirySweep` from `hosted-libp2p.ts`, and esbuild pulls that module's graph in;
 * only the symbols nothing reaches are shaken out, which is why `kadDHT` and
 * `circuitRelayServer` appear **0** times in the same bundle while noise does not.
 *
 * That makes `hosted-tier-deploy.node.test.ts`'s `diffieHellman` case a **live reading** as of
 * this commit rather than the loud skip it has been, and it passes: `diffieHellman` 0,
 * `node:crypto` 0. Open question 1 — whether wrangler honours the package's legacy top-level
 * `browser` field and bundles the pure-JS path — is answered by measurement instead of by
 * argument, and a regression in that mechanism now arrives red.
 *
 * What this object DOES gain is {@link BootstrapObject.alarm}, which is called by the
 * platform and needs no network stack — see its own doc.
 *
 * **CORRECTED 2026-08-26, same day.** The claim above is wrong about its conclusion and right only about one resolver. `ERR_PACKAGE_PATH_NOT_EXPORTED` is **Node's** ESM resolver refusing a package-specifier import; `exports` is consulted only for package specifiers and a FILE PATH does not go through it at all. Three wrangler builds settled it: by specifier esbuild also fails (*"Could not resolve"*, exit 1); **by path it builds — exit 0, 153.30 KiB, `webSocketToMaConn` three times in the emitted bundle.** The listener is writable today. What was actually done was to measure Node and conclude about wrangler. What is genuinely open is what `STACK.md:146` and `ARCHITECTURE.md:484-506` already recorded: the listener's four requirements — `direction: 'inbound'`, `remoteAddr` from `CF-Connecting-IP`, an explicit `bufferedAmount`, and a hibernation-aware socket — of which three belong to **Phase 30** by the roadmap's own division.
 */

import { HostedNode, stubFor } from './hosted-object.ts'
import type { HostedObjectName, HostedObjectNamespace } from './hosted-object.ts'
import { hostedExpirySweep } from './hosted-libp2p.ts'
import type { DurableObjectAlarms, DurableObjectStorage } from './durable-object-storage.d.ts'

/**
 * The two members of the platform's object state that this tier uses.
 *
 * Declared here rather than imported from `@cloudflare/workers-types`, on
 * `durable-object-storage.d.ts`'s stated discipline: an interface declared as narrowly as it
 * is used is one a fixture can implement completely, and a complete fake is the only kind
 * that can honestly claim to model the platform.
 */
export interface HostedObjectState {
  /**
   * Both halves of the platform's storage API, because this object uses both.
   *
   * The real `state.storage` carries them together; they are declared apart
   * (`durable-object-storage.d.ts`) so that `DoDatastore`'s fixture is not made to arm
   * alarms it never touches. An intersection here is what says this object needs both.
   */
  readonly storage: DurableObjectStorage & DurableObjectAlarms
}

/** The bindings this Worker is deployed with. One namespace, because there is one object. */
export interface HostedEnv {
  readonly BOOTSTRAP: HostedObjectNamespace<HostedStub>
}

/** What a stub can be asked. `fetch` is the platform's own stub surface. */
export interface HostedStub {
  fetch: (request: Request) => Promise<Response>
}

/**
 * The deployed Durable Object.
 *
 * The class the platform instantiates; every claim worth asserting locally is on
 * {@link HostedNode}, which this holds rather than extends. That split is deliberate — a class
 * extending the platform's own base cannot be constructed in a Node test, so anything put
 * inside it would be unreachable by any spec, and unreachable code in a phase about guards is
 * the thing to avoid rather than the thing to explain.
 */
export class BootstrapObject {
  readonly #node: HostedNode
  readonly #state: HostedObjectState

  constructor(state: HostedObjectState) {
    this.#state = state
    this.#node = new HostedNode(state.storage)
  }

  /**
   * The Durable Object alarm — ARCHITECTURE step 7 arriving on the platform's own timer.
   *
   * **Nothing is memoised across this call and that is the design.** Cloudflare evicts the
   * instance that armed an alarm and constructs a fresh one to handle it, so an
   * `ExpirySweep` captured at assembly time would be gone by the time it was needed.
   * `hostedExpirySweep` arms from nothing on every call, which makes the schedule
   * self-repairing rather than dependent on a construction that happened once.
   *
   * It does **not** construct libp2p. Sweeping needs a datastore, an alarm surface and this
   * node's own peer id; waking a network stack to delete expired rows would make the
   * cheapest thing this object does the most expensive one.
   *
   * That an alarm survives eviction and fires on a fresh instance is the one claim here no
   * local run settles — ARCHITECTURE's *"request, fire, evict, re-read from a new
   * instance"* is an owner act at the Cloudflare boundary and is reported open.
   */
  async alarm(): Promise<void> {
    const sweep = await hostedExpirySweep({
      storage: this.#state.storage,
      alarms: this.#state.storage,
    })
    await sweep.run()
  }

  /**
   * `GET /self` — the node's own stable name.
   *
   * This is the reading criterion 2 is settled by: an owner dialling the deployed object
   * twice, days apart and across an eviction, must see one PeerId. The value returned here
   * comes from the seed in this object's storage, so the answer is the store's and not the
   * isolate's — which is the whole difference between a Durable Object and the plain Worker
   * that returned three different PeerIds to three consecutive requests.
   */
  async fetch(request: Request): Promise<Response> {
    if (new URL(request.url).pathname !== '/self') {
      return new Response('not found', { status: 404 })
    }
    const identity = await this.#node.identity()
    return Response.json({ peerId: identity.peerId, nodeKey: identity.nodeKey })
  }
}

/**
 * Which object a request is served by.
 *
 * **A constant, never derived from the request.** Criterion 6's subject is precisely that a
 * visitor cannot cause an object to be created, and an object is created by its first `get()`.
 * A `?region=` parameter here would be the defect, and it would be invisible: the request
 * would succeed, the object would exist, and its siting would be permanent.
 *
 * Choosing which of the three regions a given request belongs to is Phase 33's subject and is
 * not answered by taking the visitor's word for it.
 */
const SERVED_BY: HostedObjectName = 'bootstrap-us'

export default {
  async fetch(request: Request, env: HostedEnv): Promise<Response> {
    return stubFor(env.BOOTSTRAP, SERVED_BY).fetch(request)
  },
}
