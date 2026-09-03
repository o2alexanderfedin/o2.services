/**
 * RUN-02 criterion 2 and RUN-03 criterion 4 — a volunteer who was given nothing.
 *
 * This is the phase's answer to the clause the user-story form of the goal dropped, and which
 * `.planning/ROADMAP.md` flags in its own note: *"a volunteer can see both that control and
 * the fabric's state **without being given operator access**"* — a second actor the operator's
 * story cannot speak for.
 *
 * ## Six readings, and what each one is for
 *
 * 1. **A volunteer's own tab**, running, with `?relay=` naming a local workerd.
 * 2. **The flip**, performed from the harness with the key — the operator's act, done where
 *    the operator is and never from a page.
 * 3. **Two surfaces, read on BOTH sides.** Criterion 2's verb is *change*, and a change is a
 *    two-reading claim: an after-reading alone is satisfied by a page that always said halted.
 *    So the status page is opened **before** the flip and must report admitting, and the demo
 *    tab's title is read before and polled after.
 * 4. **The credential reading, taken from outside the page** with `page.on('request')` over
 *    the whole request set, with the set proved **non-empty** first. A filter over an empty
 *    list passes for the wrong reason — the floor case `built-bundle.e2e.test.ts` records for
 *    this exact shape.
 * 5. **Operator access is a real capability that was WITHHELD, not an absence of any
 *    capability at all** — two observations, labelled with what each proves. This is what stops
 *    criterion 2 being satisfied by a fabric with no access control: the read is open **and**
 *    the write is not.
 * 6. **The build's output**, read from `dist/`. A page that is only in `demo/` is a page no
 *    volunteer can reach.
 *
 * ## Why the built bundle rather than a dev server
 *
 * `built-bundle.e2e.test.ts`'s reason, and correction 1 of this phase is why it is not
 * negotiable here: `policy.html` was linked from `index.html` and **absent from `dist/`** for
 * as long as it existed, and every guard that could have caught it read the source tree. A
 * proof that reads `demo/` cannot see a build that omits a file.
 *
 * ## Scope fence
 *
 * One local `workerd`, `--local-protocol http`, its own `mkdtemp --persist-to`,
 * `CLOUDFLARE_API_TOKEN: ''`, `WRANGLER_SEND_METRICS: 'false'`. Nothing deployed, no remote
 * resource, no secret written anywhere.
 */

import { execFileSync, spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { createServer } from 'node:http'
import type { Server } from 'node:http'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import type { Browser, BrowserContext, Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ADMISSION_KEY_HEADER } from '../../cloudflare/src/admission-flag.ts'
import { STOPPED_TITLE_PREFIX } from '../../browser/src/computing-indicator.ts'

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const DIST = join(ROOT, 'packages', 'browser', 'dist')
const CLOUDFLARE_DIR = fileURLToPath(new URL('../../cloudflare', import.meta.url))
const HOST = '127.0.0.1'
/** Its own port: 8791–8798 and 8801–8803 are taken by the specs already in the tree. */
const PORT = 8807
const REGION = 'bootstrap-eu'
const TEST_KEY = 'phase-36-volunteer-local-operator-key'
const NOTE = 'phase 36 — the eu slice, halted while a volunteer watched'

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
}

let worker: ChildProcess | undefined
let persistDir: string
let server: Server
let baseUrl: string
let browser: Browser
let workerPeerId: string

const workerOrigin = (): string => `http://${HOST}:${String(PORT)}`

async function readSelf(): Promise<Record<string, unknown>> {
  const response = await fetch(`${workerOrigin()}/self`, { signal: AbortSignal.timeout(5_000) })
  if (!response.ok) throw new Error(`/self answered ${String(response.status)}`)
  const body: unknown = await response.json()
  if (typeof body !== 'object' || body === null) throw new Error('/self answered no object')
  return { ...body }
}

async function waitForReady(timeoutMs: number): Promise<string> {
  const deadline = Date.now() + timeoutMs
  let lastError: unknown
  while (Date.now() < deadline) {
    try {
      const self = await readSelf()
      if (typeof self['peerId'] === 'string') return self['peerId']
    } catch (cause) {
      lastError = cause
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error(`workerd was not ready in ${String(timeoutMs)} ms: ${String(lastError)}`)
}

async function postAdmission(
  body: unknown,
  key: string | null,
): Promise<{ status: number; text: string }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (key !== null) headers[ADMISSION_KEY_HEADER] = key
  const response = await fetch(`${workerOrigin()}/admission`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5_000),
  })
  return { status: response.status, text: await response.text() }
}

const haltBody = (): unknown => ({
  region: REGION,
  halted: true,
  versions: 'all',
  since: Date.now(),
  note: NOTE,
})

beforeAll(async () => {
  // The REAL production build, so `dist/` is what a volunteer would be served. Built here
  // rather than assuming a previous build is current — see correction 1 in this phase's plan.
  execFileSync('npx', ['vite', 'build', '--config', 'packages/browser/vite.config.ts'], {
    cwd: ROOT,
    stdio: 'ignore',
  })

  persistDir = await mkdtemp(join(tmpdir(), 'o2-volunteer-'))
  worker = spawn(
    'npx',
    [
      'wrangler',
      'dev',
      '--port',
      String(PORT),
      '--local-protocol',
      'http',
      '--persist-to',
      persistDir,
      '--var',
      `O2_REGION:${REGION}`,
      '--var',
      `O2_ADMISSION_KEY:${TEST_KEY}`,
    ],
    {
      cwd: CLOUDFLARE_DIR,
      env: { ...process.env, CLOUDFLARE_API_TOKEN: '', WRANGLER_SEND_METRICS: 'false' },
      stdio: ['ignore', 'ignore', 'pipe'],
      // **Its own process group, so `afterAll` can kill the whole tree — measured, not
      // precautionary.** `npx wrangler dev` is a parent that spawns `workerd` as a grandchild,
      // and `SIGTERM` to the parent alone leaves that grandchild alive holding the port. The
      // next run of this file then died in `beforeAll` with
      // `Fatal uncaught kj::Exception … ::bind: Address already in use; 127.0.0.1:8807`,
      // presenting as a 120-second `fetch failed` with no cause visible — which is why the
      // stderr above is piped rather than ignored.
      detached: true,
    },
  )
  // **The worker's own stderr is surfaced, and it is not decoration.** Every other workerd
  // spec in this tree passes `stdio: 'ignore'`, and that silence hid a real defect for one
  // run of this file: `Uncaught TypeError: Can't read from request stream after response has
  // been sent`, once per refused `POST /admission`, followed by `GET /self` answering 500.
  // The visible symptom was a status page that could not be read; the cause was two lines
  // away in `worker.ts`. A runtime that is telling you what went wrong is worth listening to.
  worker.stderr?.on('data', (chunk: Buffer) => process.stdout.write(`[workerd] ${chunk.toString()}`))
  workerPeerId = await waitForReady(120_000)

  // A deliberately dumb static server — no module resolution, no transforms, no fallbacks.
  // What GitHub Pages is, which is what the artifact has to be tested against.
  server = createServer((request, response) => {
    const path = (request.url ?? '/').split('?')[0] ?? '/'
    const file = join(DIST, normalize(path === '/' ? '/index.html' : path))
    if (!file.startsWith(DIST)) {
      response.writeHead(403).end()
      return
    }
    readFile(file).then(
      (bytes) => {
        response.writeHead(200, {
          'content-type': MIME[extname(file)] ?? 'application/octet-stream',
        })
        response.end(bytes)
      },
      () => {
        response.writeHead(404).end('not found')
      },
    )
  })
  await new Promise<void>((resolve) => server.listen(0, HOST, resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('no server port')
  baseUrl = `http://${HOST}:${String(address.port)}`

  browser = await chromium.launch()
}, 400_000)

afterAll(async () => {
  try {
    await browser?.close().catch(() => {})
    await new Promise<void>((resolve) => server?.close(() => resolve()))
    // The GROUP, not the process — see the `detached` note at the spawn.
    if (worker?.pid !== undefined) {
      try {
        process.kill(-worker.pid, 'SIGTERM')
      } catch {
        worker.kill('SIGTERM')
      }
    }
    // And wait for the port to actually free, rather than trusting the signal. A `SIGTERM`
    // returns as soon as it is delivered; the socket is released when the process exits.
    const deadline = Date.now() + 20_000
    while (Date.now() < deadline) {
      try {
        await fetch(`${workerOrigin()}/self`, { signal: AbortSignal.timeout(500) })
      } catch {
        break
      }
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
  } finally {
    await rm(persistDir, { recursive: true, force: true }).catch(() => {})
  }
}, 120_000)

/** Open the status page in a context that carries nothing, and collect every request it makes. */
async function openStatus(): Promise<{
  readonly context: BrowserContext
  readonly page: Page
  readonly requests: { url: string; headers: Record<string, string> }[]
}> {
  // A FRESH context: no storage state, no consent, no cookie, nothing carried over from the
  // volunteer's demo tab. This is what "given nothing" means operationally.
  const context = await browser.newContext()
  const page = await context.newPage()
  const requests: { url: string; headers: Record<string, string> }[] = []
  // Registered BEFORE `goto`, which is what makes the collected set complete. The plant that
  // registers it after is watched reddening the non-empty assertion below.
  page.on('request', (request) => {
    requests.push({ url: request.url(), headers: request.headers() })
  })
  await page.goto(`${baseUrl}/status.html?self=${encodeURIComponent(workerOrigin())}`)
  // Wait for the placeholder to be REPLACED rather than for a particular verdict. Waiting for
  // the admitting text would make an `unreachable` render — the named failure this page has
  // precisely so a reader can tell it from a halt — time out at 30 s with no diagnosis, and
  // the assertion below is what should be reporting which of the three arms was painted.
  await page.waitForFunction(
    () => !(document.getElementById('objects')?.textContent ?? '').includes('Reading…'),
    null,
    { timeout: 30_000 },
  )
  return { context, page, requests }
}

describe('RUN-02 / RUN-03 — a volunteer sees the stop, and cannot cause one', () => {
  it('shows a volunteer the halt in both places, from a context given nothing', async () => {
    // ── (1) The volunteer's own tab. ──────────────────────────────────────────────────
    const tabContext = await browser.newContext()
    const tab = await tabContext.newPage()
    const relayAddr = `/ip4/${HOST}/tcp/${String(PORT)}/ws/p2p/${workerPeerId}`
    await tab.goto(`${baseUrl}/index.html?relay=${encodeURIComponent(relayAddr)}`)
    await tab.waitForFunction(() => typeof window.o2 !== 'undefined', null, { timeout: 60_000 })
    await tab.click('#allow')
    await tab.evaluate(
      async (addr: string) =>
        void (await window.o2.start({
          relayAddrs: [addr],
          blockstoreName: `volunteer-${String(Date.now())}`,
          // A short poll so the halt arrives inside this case's own budget. Configuration,
          // not a bypass — see `TabApi.start`'s field docblock.
          admissionPollIntervalMs: 1_000,
        })),
      relayAddr,
    )
    const titleBefore = await tab.title()
    expect(
      titleBefore.startsWith(STOPPED_TITLE_PREFIX),
      'criterion 2 needs a CHANGE, and a tab already carrying the stopped marker before the ' +
        'flip would make the after-reading meaningless.',
    ).toBe(false)

    // ── (3a) The status page BEFORE the flip. ─────────────────────────────────────────
    const before = await openStatus()
    const textBefore = (await before.page.textContent('#objects')) ?? ''
    expect(
      textBefore,
      'the status page did not report this object admitting before the flip. If it says ' +
        '"Could not be read", the page reached nothing and the after-reading below would be ' +
        'about a page that never worked rather than about a halt.',
    ).toContain('Admitting new tasks')
    expect(textBefore).not.toContain('NOT ADMITTING NEW TASKS')

    // ── (4) The credential reading, from OUTSIDE the page, over the whole request set. ──
    expect(
      before.requests.length,
      'the request collector saw nothing at all, so every header assertion below would pass ' +
        'over an empty list and prove nothing. This is the floor, not a formality.',
    ).toBeGreaterThan(0)
    // And it saw the request that matters, not only the page's own assets.
    expect(before.requests.filter((r) => r.url.startsWith(workerOrigin())).length).toBeGreaterThan(0)
    for (const request of before.requests) {
      const names = Object.keys(request.headers).map((name) => name.toLowerCase())
      expect(names, `${request.url} carried an Authorization header`).not.toContain('authorization')
      expect(names, `${request.url} carried a Cookie header`).not.toContain('cookie')
      expect(
        names,
        `${request.url} carried the operator's admission key header`,
      ).not.toContain(ADMISSION_KEY_HEADER.toLowerCase())
    }

    // ── (5a) The volunteer CANNOT write, observed from the page's own context. ─────────
    //
    // **T-36-04 working, and the expected outcome is a rejection with no status to read.**
    // A cross-origin POST carrying a bespoke header and a JSON body triggers an OPTIONS
    // preflight; `POST /admission` deliberately carries no CORS header at all, so the browser
    // blocks the request BEFORE the object's key check ever runs and the page sees an opaque
    // network failure. Asserting a status code here would be asserting something that does
    // not exist. An executor who "fixes" this by adding ACAO to `/admission` has removed the
    // mitigation.
    const blocked = await before.page.evaluate(
      async ([origin, header, body]: readonly string[]) => {
        try {
          await fetch(`${String(origin)}/admission`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', [String(header)]: 'anything' },
            body: String(body),
          })
          return 'the browser allowed it'
        } catch (cause) {
          return `blocked: ${cause instanceof Error ? cause.name : String(cause)}`
        }
      },
      [workerOrigin(), ADMISSION_KEY_HEADER, JSON.stringify(haltBody())] as const,
    )
    expect(
      blocked,
      'a page reached the operator write surface. `POST /admission` must carry no CORS header ' +
        'at all, so a cross-origin write dies at the unanswered preflight.',
    ).not.toBe('the browser allowed it')

    // ── (5b) The key is the BOUNDARY, read from the harness where there is no CORS. ────
    //
    // CORS is not the boundary and this is the reading that says so: a caller that is not a
    // browser is never preflighted, meets the key, and is refused with a status code that can
    // actually be read. The two observations are not substitutes for one another.
    const noKey = await postAdmission(haltBody(), null)
    expect(noKey.status).toBe(401)
    const wrongKey = await postAdmission(haltBody(), 'phase-36-volunteer-local-operator-keY')
    expect(wrongKey.status).toBe(401)
    expect(
      (await readSelf())['admission'],
      'a refused write moved the directive anyway',
    ).toMatchObject({ halted: false })

    // ── (2) The flip. The operator's act, from the harness, with the key. ──────────────
    const flip = await postAdmission(haltBody(), TEST_KEY)
    expect(flip.status, `the flip was refused: ${flip.text}`).toBe(200)

    // ── (3b) Both surfaces AFTER the flip. ────────────────────────────────────────────
    await before.page.reload()
    await before.page.waitForFunction(
      () => (document.getElementById('objects')?.textContent ?? '').includes('NOT ADMITTING'),
      null,
      { timeout: 30_000 },
    )
    const textAfter = (await before.page.textContent('#objects')) ?? ''
    expect(textAfter).toContain('NOT ADMITTING NEW TASKS')
    expect(textAfter).toContain(NOTE)
    expect(textAfter).toContain(REGION)

    // The volunteer's own tab, in browser chrome, where a visitor looking at another tab
    // would actually find out.
    await tab.waitForFunction(
      (prefix: string) => document.title.startsWith(prefix),
      STOPPED_TITLE_PREFIX,
      { timeout: 60_000 },
    )
    expect((await tab.title()).startsWith(STOPPED_TITLE_PREFIX)).toBe(true)

    console.log(
      `[RUN-03 volunteer] requests observed=${String(before.requests.length)}; ` +
        `write with no key=${String(noKey.status)}, wrong key=${String(wrongKey.status)}; ` +
        `from the page: ${blocked}`,
    )

    await before.context.close()
    await tabContext.close()
  }, 300_000)

  it('emits status.html AND policy.html into the build output', () => {
    // **Read from `dist/`, never from `demo/`.** A guard that reads the source tree cannot
    // see a build that omits a file, which is exactly how `policy.html` came to 404 on the
    // published site while existing in the repository the whole time. The build ran in
    // `beforeAll`, from the real config.
    expect(existsSync(join(DIST, 'status.html'))).toBe(true)
    expect(existsSync(join(DIST, 'policy.html'))).toBe(true)
    expect(existsSync(join(DIST, 'index.html'))).toBe(true)
  })
})
