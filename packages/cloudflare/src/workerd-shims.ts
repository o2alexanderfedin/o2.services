/**
 * The two globals workerd lacks that stop js-libp2p constructing at all.
 *
 * Both were found by **running**, in the order they broke, and the order is recorded in
 * `.planning/consults/2026-08-24-cloudflare-as-a-fabric-node-measured.md` §8. Neither is a
 * prohibition: the same consult dialled a real peer from a deployed Worker — TCP →
 * multistream-select → Noise → yamux, remote PeerId verified, 26 ms — once these were in
 * place. So this file is the difference between "the platform cannot" and "two fields are
 * missing", and it is worth reading in that order.
 *
 * ## Gap 1 — `process.versions` is `{}`
 *
 * `libp2p`'s `userAgent()` reads `process.versions.node` unconditionally
 * (`node_modules/libp2p/dist/src/user-agent.js:5`), so **one absent field stops the entire
 * stack from constructing**. The consult records that passing a `userAgent` option does not
 * help — the platform version is read regardless of it — so there is no configuration route
 * and it has to be a global.
 *
 * ## Gap 2 — no `BroadcastChannel`
 *
 * `mortice@3.3.1`, libp2p's mutex, constructs one on its primary path
 * (`node_modules/mortice/dist/src/node.js:22`). A Worker isolate is one process and one
 * thread, so same-isolate delivery is the entire semantics required.
 *
 * **Switching mortice to its `browser` build is NOT the alternative, and this was checked
 * rather than assumed.** The package does ship a `browser` field mapping `node.js` →
 * `browser.js` and stubbing `node:cluster`/`node:worker_threads` to `false`, which looks
 * like the same remedy gap 3 takes. It is the wrong one twice over: `browser.js:9`
 * constructs a `BroadcastChannel` too, so the shim would still be needed; and `browser.js:7`
 * decides primacy with `Boolean(globalThis.document)`, which is **false in a Worker**, so
 * mortice would return a `MorticeChannelWorker` that waits on a primary no isolate is
 * running. The node build's `cluster.isPrimary` is what makes the Worker the primary, and
 * being the primary is the only reason its channel never has to deliver anything.
 *
 * ## Gap 3 is deliberately not here
 *
 * `node:crypto` has no `diffieHellman`, which `@chainsafe/libp2p-noise`'s node build calls.
 * That one is a **bundler-resolution** problem rather than a platform gap — the package
 * already ships a `browser` field mapping that exact file to a pure-JS X25519 — and the fix
 * is a per-package condition override in the build, not a global written here. The consult's
 * recorded trap belongs beside it: `--conditions=node` applied *globally* pulls `ws` in
 * through `@libp2p/websockets`, and Cloudflare rejects the **upload** with `Uncaught Error:
 * Dynamic require of "events" is not supported` — an error about the bundle, arriving at
 * deploy time, naming neither the package nor the cause.
 *
 * ## What is proven here and what only a deploy can settle
 *
 * The **logic** below is proven in `--project node` against injected scopes: what it writes,
 * what it leaves alone, and that a scope it could not repair makes it throw rather than
 * return. What no local run can settle is whether workerd's `process.versions` accepts the
 * write at all — a frozen or getter-only object would refuse it. That is why
 * {@link installWorkerdShims} **verifies its own postcondition and throws**: a shim that
 * silently failed to shim would surface later as `userAgent()` throwing on a field nobody
 * connected to this file, which is exactly the shape of failure the consult had to run a
 * deployment to diagnose the first time.
 */

/** The version string reported for a platform that has no Node version. */
export const SHIMMED_NODE_VERSION = '0.0.0'

/** The channel name → the live channels on it, within this isolate. */
const CHANNELS = new Map<string, Set<MinimalBroadcastChannel>>()

/**
 * A same-isolate `BroadcastChannel` — the whole of gap 2.
 *
 * Declared as narrowly as `mortice` uses it, which is the discipline
 * `durable-object-storage.d.ts` states for its own declaration. The used surface was read
 * off the package rather than off the spec: `postMessage`, `addEventListener`,
 * `removeEventListener` and `close` across `main/channel.js` and `workers/channel.js`, plus
 * an optional-chained `unref?.()` at `node.js:26`.
 *
 * Delivery goes to the OTHER channels of the same name and never back to the sender, which
 * is what the platform does. **In this deployment it is expected to deliver nothing at all**
 * — the Worker is mortice's primary and the channel exists for cross-process workers that a
 * single isolate does not have — so the delivery path is written to be correct rather than
 * because anything is known to exercise it.
 */
export class MinimalBroadcastChannel {
  readonly name: string
  readonly #listeners = new Set<(event: { readonly data: unknown }) => void>()
  #closed = false

  constructor(name: string) {
    this.name = name
    const peers = CHANNELS.get(name) ?? new Set<MinimalBroadcastChannel>()
    peers.add(this)
    CHANNELS.set(name, peers)
  }

  postMessage(data: unknown): void {
    if (this.#closed) throw new Error('cannot post to a closed BroadcastChannel')
    for (const peer of CHANNELS.get(this.name) ?? []) {
      if (peer === this) continue
      peer.#deliver(data)
    }
  }

  addEventListener(type: string, listener: (event: { readonly data: unknown }) => void): void {
    if (type === 'message') this.#listeners.add(listener)
  }

  removeEventListener(type: string, listener: (event: { readonly data: unknown }) => void): void {
    if (type === 'message') this.#listeners.delete(listener)
  }

  close(): void {
    this.#closed = true
    this.#listeners.clear()
    const peers = CHANNELS.get(this.name)
    peers?.delete(this)
    if (peers?.size === 0) CHANNELS.delete(this.name)
  }

  #deliver(data: unknown): void {
    for (const listener of this.#listeners) listener({ data })
  }
}

/** What {@link installWorkerdShims} found and did, per gap. */
export interface ShimReport {
  readonly processVersions: 'already-present' | 'installed'
  readonly broadcastChannel: 'already-present' | 'installed'
}

/** As much of `process` as `userAgent()` reads. */
export interface ProcessLike {
  versions?: Record<string, string | undefined>
}

/** The shape of the global object this touches — no more of it than is written. */
export interface ShimScope {
  process?: ProcessLike
  BroadcastChannel?: unknown
}

/** Raised when a scope could not be repaired, rather than returning a report that lies. */
export class ShimRefusedError extends Error {
  constructor(what: string) {
    super(
      `${what} could not be installed on this scope — js-libp2p will fail to construct. ` +
        'A frozen or getter-only global is the expected cause; the alternative to this ' +
        'throw is a failure later, in third-party code, that names nothing connected to it.',
    )
    this.name = 'ShimRefusedError'
  }
}

/**
 * Gap 1 alone, separated so it can be applied to a second object.
 *
 * `user-agent.js` imports `node:process` rather than reading the global, and whether those
 * are the same object on workerd is the one thing here no local run can settle — see the
 * side-effect section at the foot of this file.
 */
export function installNodeVersion(scope: ShimScope): ShimReport['processVersions'] {
  const version = scope.process?.versions?.['node']
  if (typeof version === 'string' && version.length > 0) return 'already-present'
  const existing = scope.process
  // TWO mechanisms, and which one actually fires was MEASURED rather than reasoned — the
  // first reading of it was wrong. Under V8 in strict mode (an ES module always is) a frozen
  // object, a getter-only property and Node's own real `process.versions` **all three throw**
  // on assignment; that was probed, not assumed, and it means the `catch` is the mechanism
  // and not the fallback. The read-back below is the second line, for a host object that
  // ACCEPTS the write and keeps its value — which V8 does not do and a platform binding
  // could. Its case uses a Proxy, because that is the only shape available locally that
  // behaves the way a refusing host object would.
  try {
    if (existing === undefined) {
      scope.process = { versions: { node: SHIMMED_NODE_VERSION } }
    } else if (existing.versions === undefined) {
      existing.versions = { node: SHIMMED_NODE_VERSION }
    } else {
      existing.versions['node'] = SHIMMED_NODE_VERSION
    }
  } catch {
    throw new ShimRefusedError('process.versions.node')
  }
  const after = scope.process?.versions?.['node']
  if (typeof after !== 'string' || after.length === 0) {
    throw new ShimRefusedError('process.versions.node')
  }
  return 'installed'
}

/**
 * Fill both gaps on `scope`, idempotently, and report what was actually needed.
 *
 * **Nothing already present is overwritten.** That is what makes importing this module
 * harmless in Node and in a browser, and it is asserted rather than assumed: the spec calls
 * it on the real `globalThis` under Node and requires both fields to report
 * `already-present`. A shim that replaced a working global would be a portability bug in a
 * file whose whole purpose is portability.
 */
export function installWorkerdShims(scope: ShimScope): ShimReport {
  const processVersions = installNodeVersion(scope)

  let broadcastChannel: ShimReport['broadcastChannel'] = 'already-present'
  if (typeof scope.BroadcastChannel !== 'function') {
    scope.BroadcastChannel = MinimalBroadcastChannel
    broadcastChannel = 'installed'
    if (typeof scope.BroadcastChannel !== 'function') throw new ShimRefusedError('BroadcastChannel')
  }

  return { processVersions, broadcastChannel }
}

/**
 * The side effect, which is the point of the file.
 *
 * `ARCHITECTURE.md:119-122` requires this to run **before `libp2p` is ever imported**, and an
 * import for side effect is the only ordering primitive ES modules offer. Every module that
 * reaches libp2p on this tier must import this one first; nothing here can enforce that, so
 * it is stated where a reader of the assembly will be.
 *
 * Under Node and in a browser this is a no-op by construction — both fields already exist —
 * which is what lets the spec beside it run in the ordinary lane.
 */
installWorkerdShims(globalThis as ShimScope)

/**
 * ## The one assumption this file rests on, named rather than buried
 *
 * `user-agent.js:1` is `import process from 'node:process'`, **not** a read of the global,
 * so writing `globalThis.process` only fixes the consumer if the two are the same object.
 * Under `nodejs_compat` — which `wrangler.jsonc` sets — workerd installs `globalThis.process`
 * from that same module, so they are; and the consult's shim was measured working in a
 * deployed Worker, which is the strongest evidence available for it.
 *
 * **It was written the other way first, patching the `node:process` namespace as well, and
 * that was removed after a browser-lane run** — Vite externalises `node:process`, so the
 * static import made this file unloadable in all three engines and cost the shim its
 * cross-engine coverage for a branch that is expected never to be taken. Insurance that
 * breaks the thing it insures is not insurance. Recorded here so the trade is visible: if the
 * first deploy fails inside `userAgent()` with the global already set, this paragraph is the
 * place to look, and the repair is one line in the Durable Object assembly — which is
 * workerd-only and can import `node:process` freely — rather than in this portable file.
 */
