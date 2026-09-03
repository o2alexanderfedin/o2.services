/**
 * RUN-03 — a read-only view over what the fabric already publishes, reachable with nothing.
 *
 * ## What a volunteer can do here and what they cannot
 *
 * Read. That is the whole of it. This page starts no node, requests no artifact bytes, asks
 * for no consent, stores nothing, and sends no credential of any kind. It fetches `GET /self`
 * from each configured bootstrap object and renders what comes back.
 *
 * It **cannot** write. `POST /admission` carries no CORS header, so a cross-origin write from
 * this page is refused by the browser at the preflight, before the object's key check is ever
 * reached — and behind that, the key is the actual boundary. Both are read separately in
 * `kill-switch-volunteer.e2e.test.ts`, because they are not substitutes for one another: CORS
 * stops a page, and the key stops everything else.
 *
 * ## Why this page's cross-origin fetch is not a P10 regression
 *
 * A reviewer will read it as one, so the answer is here rather than in a planning document.
 *
 * P10 — `built-bundle.e2e.test.ts`'s *"makes no request to any origin but its own, over the
 * whole request set"* — governs **the demo page before consent**. It exists so that a visitor
 * who has not opted in is not announced to anybody: a tab that has not agreed to participate
 * should not have told a third party it exists. That is a rule about a page which *is* asking
 * for participation and has not yet been granted it.
 *
 * This page asks for nothing. It has no gate to be before, it recruits nobody, it starts no
 * worker and it fetches no task bytes — BROW-06 is about artifact bytes, and there are none
 * here. A reader who opens it has already chosen to look at the fabric's state, and the state
 * lives on the object, which is on another origin by construction: the client is a static page
 * and the object is a Worker, and they cannot share one.
 *
 * ## Why the default origin is a constant here and not read from `wrangler.jsonc`
 *
 * `wrangler.jsonc` is JSONC — it carries comments by design, Vite's JSON handling will not
 * parse it, and a build-time plugin to reach a file two packages away is a mechanism this page
 * does not need. So the origin is a named constant, and
 * `packages/node/src/status-page-address.node.test.ts` reads **both files off disk** and
 * asserts the constant equals `switchEndpointFor(<ANNOUNCE_MULTIADDRS>)`. That is
 * `data-cost.ts`'s anti-drift shape — two independently obtainable values compared, **neither
 * computed from the other** — and it keeps *one address* true with no build step.
 */

import { ADMITTING, clientVersionFrom } from '@o2/libp2p'
import type { AdmissionDirective } from '@o2/libp2p'

/**
 * The object this page reads when nobody named one.
 *
 * The deployed bootstrap's own announced address, run through `switchEndpointFor`. Guarded
 * against drift from `packages/cloudflare/wrangler.jsonc` — see the file header.
 */
export const DEFAULT_STATUS_ORIGIN = 'https://o2-bootstrap.af-4a0.workers.dev'

/**
 * What one object answered, or why it could not be read.
 *
 * **A named failure, not an empty state, and the distinction is what the page is for.** A
 * volunteer who cannot tell *this object says it is admitting* from *this page could not reach
 * this object* has been told nothing. Worse, an unreachable object rendering as "admitting"
 * would be a status page that reports the fabric healthy precisely when it is not — which is
 * the one failure a status page must not have. So `unreachable` is its own arm and it says so
 * on screen.
 */
type ObjectReading =
  | { readonly kind: 'read'; readonly origin: string; readonly self: SelfBody }
  | { readonly kind: 'unreachable'; readonly origin: string; readonly detail: string }

interface SelfBody {
  readonly peerId: string
  readonly nodeKey: string
  readonly instance: string
  readonly version: string
  readonly traffic: unknown
  readonly relayService: unknown
  readonly admission: AdmissionDirective
}

/**
 * Which objects to read: `?self=` if the reader named any, otherwise the default.
 *
 * Comma-separated, so three regions render side by side once Phase 33 sites them. The
 * precedent is `demo/main.ts`'s `?relay=`, which exists for the same reason — *"what makes one
 * bundle work on a static host"* — and it is what lets an operator point this page at a local
 * object without a second build.
 */
export function originsFrom(search: string): readonly string[] {
  const named = new URLSearchParams(search)
    .getAll('self')
    .flatMap((value) => value.split(','))
    .map((value) => value.trim())
    .filter((value) => value !== '')
  return named.length > 0 ? named : [DEFAULT_STATUS_ORIGIN]
}

/** Read one object. Never throws — a failure is a value, for the reason on {@link ObjectReading}. */
export async function readObject(origin: string): Promise<ObjectReading> {
  try {
    const response = await fetch(`${origin}/self`, { signal: AbortSignal.timeout(10_000) })
    if (!response.ok) {
      return { kind: 'unreachable', origin, detail: `answered HTTP ${String(response.status)}` }
    }
    const body: unknown = await response.json()
    const self = readSelfBody(body)
    if (self === null) {
      return { kind: 'unreachable', origin, detail: 'answered a body this page cannot read' }
    }
    return { kind: 'read', origin, self }
  } catch (cause) {
    return {
      kind: 'unreachable',
      origin,
      detail: cause instanceof Error ? cause.message : String(cause),
    }
  }
}

function readSelfBody(body: unknown): SelfBody | null {
  if (typeof body !== 'object' || body === null) return null
  const source: Record<string, unknown> = { ...body }
  const text = (key: string): string =>
    typeof source[key] === 'string' ? (source[key] as string) : 'not reported'
  const admission = source['admission']
  return {
    peerId: text('peerId'),
    nodeKey: text('nodeKey'),
    instance: text('instance'),
    version: text('version'),
    traffic: source['traffic'] ?? null,
    relayService: source['relayService'] ?? null,
    admission: readDirective(admission),
  }
}

function readDirective(value: unknown): AdmissionDirective {
  if (typeof value !== 'object' || value === null) return ADMITTING
  const source: Record<string, unknown> = { ...value }
  const versions = source['versions']
  return {
    region: typeof source['region'] === 'string' ? (source['region'] as string) : null,
    halted: source['halted'] === true,
    versions:
      versions === 'all'
        ? 'all'
        : Array.isArray(versions)
          ? versions.filter((entry): entry is string => typeof entry === 'string')
          : 'all',
    since: typeof source['since'] === 'number' ? (source['since'] as number) : null,
    note: typeof source['note'] === 'string' ? (source['note'] as string) : '',
  }
}

/**
 * This page's own build identity, from the stamp `stampBuildIdentity` put in its head.
 *
 * **The site's own, never a node's.** `vite.config.ts` records the misreading that closed on
 * 2026-09-01: the deployed node's `/self` version was read as the client's, `gh-pages` sat a
 * release behind what the node answered, and the client was reported stale when it was not. A
 * status page showing both side by side is what makes that misreading impossible rather than
 * merely unlikely — so this is rendered beside the node's `version`, labelled as a different
 * thing.
 */
function thisSiteBuild(): { readonly identity: string; readonly version: string } {
  const raw = document.querySelector('meta[name="o2-build"]')?.getAttribute('content') ?? null
  return {
    identity: raw ?? 'not stamped (a dev server serves this page untransformed)',
    version: clientVersionFrom(raw) ?? 'unreadable',
  }
}

const escape = (value: string): string =>
  value.replace(/[&<>"]/gu, (ch) => `&#${String(ch.charCodeAt(0))};`)

function renderObject(reading: ObjectReading): string {
  if (reading.kind === 'unreachable') {
    // Named, so a reader can tell this from a halt and from an admitting object. See
    // `ObjectReading`.
    return `
      <section class="card unreachable">
        <h2>${escape(reading.origin)}</h2>
        <p class="verdict">Could not be read — ${escape(reading.detail)}</p>
        <p class="sub">
          This says nothing about whether the fabric is running. It says this page could not
          reach this object.
        </p>
      </section>`
  }
  const { self } = reading
  const directive = self.admission
  const slice =
    directive.versions === 'all' ? 'every client version' : directive.versions.join(', ')
  const since = directive.since === null ? 'never set' : new Date(directive.since).toISOString()
  return `
    <section class="card ${directive.halted ? 'halted' : 'admitting'}">
      <h2>${escape(reading.origin)}</h2>
      <p class="verdict">${directive.halted ? 'NOT ADMITTING NEW TASKS' : 'Admitting new tasks'}</p>
      <dl>
        <dt>region</dt><dd>${escape(directive.region ?? 'unlabelled')}</dd>
        <dt>applies to</dt><dd>${escape(slice)}</dd>
        <dt>set at</dt><dd>${escape(since)}</dd>
        <dt>operator's note</dt><dd>${escape(directive.note === '' ? '(none)' : directive.note)}</dd>
        <dt>node build</dt><dd>${escape(self.version)}</dd>
        <dt>peer id</dt><dd>${escape(self.peerId)}</dd>
        <dt>node key</dt><dd>${escape(self.nodeKey)}</dd>
        <dt>instance</dt><dd>${escape(self.instance)}</dd>
        <dt>traffic split</dt><dd><code>${escape(JSON.stringify(self.traffic))}</code></dd>
        <dt>relay service</dt><dd><code>${escape(JSON.stringify(self.relayService))}</code></dd>
      </dl>
    </section>`
}

/** Read every configured object and paint. Exported so the e2e can drive a repaint. */
export async function render(root: HTMLElement, search: string): Promise<void> {
  const origins = originsFrom(search)
  const readings = await Promise.all(origins.map((origin) => readObject(origin)))
  const build = thisSiteBuild()
  root.innerHTML = `
    ${readings.map(renderObject).join('')}
    <section class="card">
      <h2>This page</h2>
      <dl>
        <dt>client build</dt><dd>${escape(build.identity)}</dd>
        <dt>client version</dt><dd>${escape(build.version)}</dd>
      </dl>
      <p class="sub">
        The build this <em>page</em> came from, which is a different thing from the node build
        above it. Reading one as the other has cost this project a false report already.
      </p>
    </section>`
}

/**
 * Paint, when there is a document to paint into.
 *
 * **Guarded, and the guard is `consent.ts`'s rule rather than defensiveness**: *"a module that
 * reads browser globals when it is loaded cannot be imported by a Node test at all."* This
 * file exports {@link DEFAULT_STATUS_ORIGIN}, which `status-page-address.node.test.ts` reads
 * in the `node` lane to check it against `wrangler.jsonc` — and an unguarded
 * `document.getElementById` here made that spec fail at import with `Tests no tests`, before
 * a single case ran. Every other reference to a browser global in this file is already inside
 * a function, which is the same discipline stated once at the one place it was not.
 */
if (typeof document !== 'undefined') {
  const root = document.getElementById('objects')
  if (root !== null) void render(root, location.search)
}
