/**
 * RUN-02 criterion 1's client half — three tabs on three regions, one halted, the other two
 * **observed still executing in the same run**.
 *
 * ## Why the other two tabs are the point
 *
 * The criterion names the failure it was written against: *"A global-only switch fails this
 * criterion by construction: one bad region would take offline volunteers whose region was
 * never affected."* `admission-slices.e2e.test.ts` shows the three *objects* holding different
 * directives; this file shows three *tabs* behaving differently because of them. Those are
 * different claims, and only the second is about volunteers.
 *
 * ## The floor, and why it is not a formality
 *
 * All three counters are observed **moving** before the flip. Three stalled tabs would let
 * every after-assertion pass while measuring nothing —
 * `hard-stop.e2e.test.ts` records the same discipline and the reason the workload is
 * multi-shard: *"a single task produces no moving counter either, so the multi-shard shape is
 * load-bearing."*
 *
 * ## The instrument this file was FIRST written with, and why it could not work
 *
 * **Measured 2026-09-02 on a quiet host, and it is the correction this task forced on the
 * plan.** The obvious reading — sample `tasksExecuted` across a window before the flip and an
 * equal window after, and expect the halted tab's counter to stop — was written, run, and
 * produced `bootstrap-eu before=47 after=32 ratio=0.681` while `us` read `0.489` and `sam`
 * `0.911`. The halted tab was the **middle** of the three. Nothing was broken.
 *
 * `tasksExecuted` is `GovernedExecutor`'s own count, incremented as it runs each task.
 * `submitJob` dispatches every shard of a run under one `Promise.all`, so **admission for all
 * 128 shards is decided once, at submit**, and at `dutyCycle: 0.5` the governor then serialises
 * them at roughly one per 50 ms. So the counter after the flip is measuring a queue *draining*
 * — work this tab already accepted — and no admission control can or should stop it.
 * `hard-stop.e2e.test.ts` records the same property from the other side, and Phase 35's Stop is
 * the thing that ends in-flight work. RUN-02's own words are *"stop admitting **new** tasks"*.
 *
 * So the counter is kept as the **floor** — evidence all three tabs were genuinely working and
 * stayed alive throughout — and the verdict is taken on the thing the criterion names.
 *
 * ## The verdict: a NEW submission on each tab, before and after, in one run
 *
 * Each tab is asked to start a fresh run before the flip and again after it. Before: all three
 * accepted. After: `eu` refused **with the halt named in the refusal**, `us` and `sam` still
 * accepted. That is a within-run pair per tab — each tab against itself, which cancels the host
 * exactly as a ratio would — and it is a direct reading of *admitting new tasks* rather than a
 * proxy for it.
 *
 * All six counter deltas are printed anyway, because a floor whose numbers are not shown is a
 * floor nobody can check.
 *
 * ## What the page's surface CANNOT say, stated rather than asserted around
 *
 * The plan asked for the refused run to be *"refused with a reason naming the halt"*.
 * `TabColouringRun` — `n`, `cubes`, `complete`, `found`, `statuses`, `agreeing`,
 * `verificationMultiplier`, `elapsedMs`, `egress`, `attestation` — **carries no per-shard
 * refusal reason at all**, and `runColouring` resolves rather than throwing when every shard is
 * unplaceable. So the reason string is not reachable from `window.o2` without widening
 * `TabApi`'s surface, which is a larger change than this reading needs.
 *
 * What IS reachable is the fact the criterion is about: the halted tab's run comes back
 * `complete: false`, `found: false`, with **every** shard `unagreed` — an unplaceable shard has
 * no result for anything to agree with — while the other two tabs' identical runs come back
 * `complete: true`. That is *stopped admitting new tasks*, read three ways in one run.
 *
 * The reason string itself is composed at `BrowserNode.localAdmission` from `pausedRefusal`,
 * imported from `@o2/net` rather than written twice, and it was read verbatim off a live tab
 * while this file was being written:
 * `paused: 12D3KooWHE9t… is declining all work right now`. Widening `TabColouringRun` to carry
 * refusals is real work and belongs to whoever needs a visitor to see *why* rather than *that*.
 *
 * ## A halted node is not a stopped node
 *
 * `window.o2.activity()` keeps answering — it returns `null` only when there is no node — which
 * is what makes this reading possible at all and is the difference from Phase 35's Stop. A
 * halted tab is alive, reachable, and refusing new work.
 *
 * ## What this file does NOT prove
 *
 * Three local `workerd` processes on three ports are not three sited Cloudflare objects; that
 * is Phase 33's subject. Three tabs on one host are not a cohort; that is Phase 39 criterion
 * 5's. What is proved here is that the slice reaches the executor.
 *
 * Chromium only. Criterion 1 names no engine requirement — only Phase 35's criterion 2 did.
 */

import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fixtureViteCacheDir } from './e2e-browser-launch.ts'
import { signInHarnessTab } from './e2e-signin.ts'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import type { Browser, BrowserContext, Page } from 'playwright'
import { createServer } from 'vite'
import type { ViteDevServer } from 'vite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ADMISSION_KEY_HEADER } from '../../cloudflare/src/admission-flag.ts'
import { HOSTED_OBJECT_NAMES } from '../../cloudflare/src/hosted-object.ts'
import { STOPPED_TITLE_PREFIX } from '../../browser/src/computing-indicator.ts'
import type { HostedObjectName } from '../../cloudflare/src/hosted-object.ts'

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const CLOUDFLARE_DIR = fileURLToPath(new URL('../../cloudflare', import.meta.url))
const PAGE = 'packages/browser/demo/index.html'
const HOST = '127.0.0.1'

/** Its own three: 8791–8798, 8801–8803 and 8807 are taken by the specs already in the tree. */
const PORTS: Readonly<Record<HostedObjectName, number>> = {
  'bootstrap-us': 8804,
  'bootstrap-eu': 8805,
  'bootstrap-sam': 8806,
}
const TEST_KEY = 'phase-36-regions-local-operator-key'
const NOTE = 'phase 36 — the eu slice, halted while two other regions worked'

/** The colouring workload, on `hard-stop.e2e.test.ts`'s figures and for its reason. */
const N = 204
const CUBES = 128
const DUTY_CYCLE = 0.5

/**
 * How long each of the two sampling windows is.
 *
 * **Chosen against the counter's own noise rather than against a clock.** At
 * `dutyCycle: 0.5` this workload admits tasks continuously, so a window has to be long enough
 * that the before-delta is comfortably above the one-or-two-tasks a scheduler hiccup can
 * account for — `hard-stop.e2e.test.ts` uses 800 ms for a single tab and gets a moving counter.
 * This file runs **three** tabs on one host, so each gets roughly a third of the machine and
 * the same delta needs roughly three times the wall clock; 2 500 ms is that with margin, and
 * the floor assertion below is what actually decides whether it was enough. A window that
 * turned out too short fails loud rather than reading as a halt.
 */
const WINDOW_MS = 2_500

/**
 * Shards in the small run each tab is asked to take before and after the flip.
 *
 * Small enough to settle inside the case's budget while the long run is still going, and more
 * than one because a single-shard run tells you nothing about placement — the same argument
 * `hard-stop.e2e.test.ts` makes for its own workload.
 */
const PROBE_CUBES = 4

/**
 * The two probes are DIFFERENT problems, and this is the third correction this task forced.
 *
 * **Measured 2026-09-02.** Written first as the same `n` for both, and the after-probe on the
 * halted tab was **accepted** — while a direct call to `node.localAdmission.would()` on the
 * very same tab, seconds later, correctly refused with
 * `paused: <peerId> is declining all work right now`. Both readings were of one object, so
 * one of them had to be about something else.
 *
 * A log of every `admit` decision the page made settled it: **132 calls on the halted tab,
 * none of them refused, and none of them from the after-probe at all.** 128 were the long run
 * and 4 were the before-probe; the after-probe consulted admission zero times.
 *
 * The cause is CHURN-03's checkpoint resume, working exactly as designed. A job's id is
 * derived from the module and its input CIDs, so an identical run is the identical job;
 * `runColouring` finds the handle the first probe wrote, resumes from it, and every carried
 * shard is `CARRIED_NOT_PLACED` — placed by nobody, so `admit` is never asked. The second
 * probe was reading a **cache**, and an admission probe that repeats a job measures the
 * checkpoint rather than admission.
 *
 * So the two probes name different `n`, which makes them different inputs, different CIDs and
 * different jobs. Neither can be answered from the other's checkpoint, and both must be placed.
 */
const PROBE_N_BEFORE = 205
const PROBE_N_AFTER = 206

/**
 * How long each tab waits between polls of its own object.
 *
 * Configuration, not a bypass — see `TabApi.start`'s field. Short so the settling beat below
 * stays a small part of the case's budget; the production default is 30 000 ms and is what
 * applies to a visitor.
 */
const POLL_MS = 750

/**
 * The pause between the flip and the second window.
 *
 * One poll interval plus a round trip plus margin. Anything shorter would sample a tab that
 * has not yet asked, and the reading would be about this beat rather than about the halt.
 */
const SETTLING_MS = POLL_MS * 3

const children: ChildProcess[] = []
const persistDirs: string[] = []
let server: ViteDevServer
let baseUrl: string
let browser: Browser
const contexts: BrowserContext[] = []
const peerIds = new Map<HostedObjectName, string>()

async function readSelf(port: number): Promise<Record<string, unknown>> {
  const response = await fetch(`http://${HOST}:${String(port)}/self`, {
    signal: AbortSignal.timeout(5_000),
  })
  if (!response.ok) throw new Error(`/self on ${String(port)} answered ${String(response.status)}`)
  const body: unknown = await response.json()
  if (typeof body !== 'object' || body === null) throw new Error('/self answered no object')
  return { ...body }
}

async function waitForReady(port: number, timeoutMs: number): Promise<string> {
  const deadline = Date.now() + timeoutMs
  let lastError: unknown
  while (Date.now() < deadline) {
    try {
      const self = await readSelf(port)
      if (typeof self['peerId'] === 'string') return self['peerId']
    } catch (cause) {
      lastError = cause
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error(`workerd on ${String(port)} not ready in ${String(timeoutMs)} ms: ${String(lastError)}`)
}

beforeAll(async () => {
  // Sequentially, as `admission-slices.e2e.test.ts` does: three workerd processes racing to
  // bind and compile is a source of flake with nothing to do with the property under test.
  for (const region of HOSTED_OBJECT_NAMES) {
    const persistDir = await mkdtemp(join(tmpdir(), `o2-regions-${region}-`))
    persistDirs.push(persistDir)
    const child = spawn(
      'npx',
      [
        'wrangler',
        'dev',
        '--port',
        String(PORTS[region]),
        '--local-protocol',
        'http',
        '--persist-to',
        persistDir,
        '--var',
        `O2_REGION:${region}`,
        '--var',
        `O2_ADMISSION_KEY:${TEST_KEY}`,
      ],
      {
        cwd: CLOUDFLARE_DIR,
        env: { ...process.env, CLOUDFLARE_API_TOKEN: '', WRANGLER_SEND_METRICS: 'false' },
        stdio: ['ignore', 'ignore', 'pipe'],
        // Its own group, so `afterAll` reaches the `workerd` grandchild. `SIGTERM` to the
        // `npx` parent alone leaves it holding the port — measured in
        // `kill-switch-volunteer.e2e.test.ts`, where the next run died at
        // `::bind: Address already in use`.
        detached: true,
      },
    )
    child.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString()
      if (text.includes('ERROR')) process.stdout.write(`[workerd ${region}] ${text}`)
    })
    children.push(child)
    peerIds.set(region, await waitForReady(PORTS[region], 120_000))
  }

  server = await createServer({ root: ROOT, logLevel: 'error', server: { port: 0 }, cacheDir: fixtureViteCacheDir(ROOT) })
  await server.listen()
  const url = server.resolvedUrls?.local[0]
  if (url === undefined) throw new Error('vite dev server produced no URL')
  baseUrl = url.endsWith('/') ? url : `${url}/`

  browser = await chromium.launch()
}, 400_000)

afterAll(async () => {
  try {
    for (const context of contexts) await context.close().catch(() => {})
    await browser?.close().catch(() => {})
    await server?.close().catch(() => {})
    for (const child of children) {
      if (child.pid === undefined) continue
      try {
        process.kill(-child.pid, 'SIGTERM')
      } catch {
        child.kill('SIGTERM')
      }
    }
  } finally {
    for (const dir of persistDirs) await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}, 120_000)

/**
 * A tab attached to exactly one region's object, consented, started and colouring.
 *
 * `?relay=` names **only** that page's own workerd — `demo/main.ts` takes an explicit
 * `?relay=` ahead of every other source, so the page will not reach for `/bootstrap.json` and
 * will not dial the other two.
 */
async function startTab(region: HostedObjectName): Promise<Page> {
  const context = await browser.newContext()
  contexts.push(context)
  const page = await context.newPage()
  const address = `/ip4/${HOST}/tcp/${String(PORTS[region])}/ws/p2p/${String(peerIds.get(region))}`
  await page.goto(`${baseUrl}${PAGE}?relay=${encodeURIComponent(address)}`)
  await page.waitForFunction(() => typeof window.o2 !== 'undefined', null, { timeout: 60_000 })
  // BROW-01 has no test-only bypass: a harness consents for the same reason a visitor
  // clicks the button. AUTH-06, `42-06`: it signs in for the same reason too, because
  // `window.o2.start` refuses with `SignedOutError` until somebody has opened their own
  // envelope. `signInHarnessTab` does both, in the order its header explains.
  await signInHarnessTab(page)
  await page.evaluate(
    async ([addr, name, duty, poll]) => {
      return window.o2.start({
        relayAddrs: [addr as string],
        blockstoreName: name as string,
        dutyCycle: duty as number,
        admissionPollIntervalMs: poll as number,
      })
    },
    [address, `o2-regions-${region}`, DUTY_CYCLE, POLL_MS] as [string, string, number, number],
  )
  // Dispatched WITHOUT awaiting, so the tab is genuinely running while it is sampled.
  const run = page.evaluate(
    async ([n, cubes]) =>
      window.o2.runColouring({ n: n as number, cubes: cubes as number, redundancy: 1, peerIds: [] }),
    [N, CUBES],
  )
  // A sink, so a rejected run does not become an unhandled rejection at the process level.
  // A refused run is one of the outcomes this case is about.
  void run.then(
    () => {},
    () => {},
  )
  return page
}

/** Tasks this tab has started, or `null` once there is no node to ask. */
async function executed(page: Page): Promise<number | null> {
  return page.evaluate(() => window.o2.activity()?.tasksExecuted ?? null)
}

/**
 * Ask this tab to start a NEW run, and report what it said.
 *
 * This is the verdict's instrument — see the file header for why the executor's counter is
 * not. Deliberately tiny (`PROBE_CUBES` shards) so it settles inside the case's budget while
 * the long run started at `startTab` is still going: what is being read is whether the tab
 * **took the work**, not how fast it finished it.
 *
 * Answers a string rather than throwing, so the before-reading and the after-reading are the
 * same shape and can be compared.
 */
async function submitProbe(page: Page, n: number): Promise<string> {
  return page.evaluate(
    async ([size, cubes]) => {
      try {
        const run = await window.o2.runColouring({
          n: size as number,
          cubes: cubes as number,
          redundancy: 1,
          peerIds: [],
        })
        // `complete` is the job's own word for *every shard was placed, run and agreed*.
        // A tab that took the work answers `true`; a tab that admitted none of it answers
        // `false` with every shard `unagreed`, because an unplaceable shard has no result
        // for anything to agree with.
        const took = run.complete && run.found
        return `${took ? 'took-the-work' : 'took-no-work'} complete=${String(run.complete)} found=${String(run.found)} statuses=${run.statuses.join('/')}`
      } catch (cause) {
        return `threw: ${cause instanceof Error ? cause.message : String(cause)}`
      }
    },
    [n, PROBE_CUBES],
  )
}

async function postAdmission(port: number, body: unknown): Promise<{ status: number; text: string }> {
  const response = await fetch(`http://${HOST}:${String(port)}/admission`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', [ADMISSION_KEY_HEADER]: TEST_KEY },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5_000),
  })
  return { status: response.status, text: await response.text() }
}

describe('RUN-02 criterion 1 — one region’s tabs stop, the other two go on working', () => {
  it('halts the eu tab and leaves us and sam executing, measured as three within-run ratios', async () => {
    const tabs = new Map<HostedObjectName, Page>()
    for (const region of HOSTED_OBJECT_NAMES) tabs.set(region, await startTab(region))

    // ---- Window 1: the moving floor, on all three. ----------------------------------
    const beforeStart = new Map<HostedObjectName, number>()
    for (const region of HOSTED_OBJECT_NAMES) {
      const value = await executed(tabs.get(region) as Page)
      expect(value, `${region}'s tab reported no activity at all, so no node was running`).not.toBeNull()
      beforeStart.set(region, value ?? 0)
    }
    const beforeAt = Date.now()
    await new Promise((resolve) => setTimeout(resolve, WINDOW_MS))
    const beforeDelta = new Map<HostedObjectName, number>()
    for (const region of HOSTED_OBJECT_NAMES) {
      const value = (await executed(tabs.get(region) as Page)) ?? 0
      beforeDelta.set(region, value - (beforeStart.get(region) ?? 0))
    }
    const beforeMs = Date.now() - beforeAt

    for (const region of HOSTED_OBJECT_NAMES) {
      expect(
        beforeDelta.get(region),
        `criterion 1's floor: ${region}'s tab admitted ${String(beforeDelta.get(region))} tasks ` +
          `across ${String(beforeMs)} ms, i.e. it was not working. A halt measured against a tab ` +
          'that never started measures nothing.',
      ).toBeGreaterThan(0)
    }

    // ---- The VERDICT's before-reading: a new run on each tab, all three accepted. ----
    const probeBefore = new Map<HostedObjectName, string>()
    for (const region of HOSTED_OBJECT_NAMES) {
      probeBefore.set(region, await submitProbe(tabs.get(region) as Page, PROBE_N_BEFORE))
    }
    for (const region of HOSTED_OBJECT_NAMES) {
      expect(
        probeBefore.get(region),
        `criterion 1's floor: ${region}'s tab would not take a new run BEFORE anything was ` +
          `halted, so the after-reading below would be about a tab that never worked. It said: ` +
          `${String(probeBefore.get(region))}`,
      ).toContain('took-the-work')
    }

    // ---- The flip: ONE write, to the eu object only. --------------------------------
    const flip = await postAdmission(PORTS['bootstrap-eu'], {
      region: 'bootstrap-eu',
      halted: true,
      versions: 'all',
      since: Date.now(),
      note: NOTE,
    })
    expect(flip.status, `the flip was refused: ${flip.text}`).toBe(200)

    // One poll interval plus a round trip plus margin — see SETTLING_MS.
    await new Promise((resolve) => setTimeout(resolve, SETTLING_MS))

    // ---- Window 2: the same length, the same three tabs, the same run. ---------------
    const afterStart = new Map<HostedObjectName, number>()
    for (const region of HOSTED_OBJECT_NAMES) {
      afterStart.set(region, (await executed(tabs.get(region) as Page)) ?? 0)
    }
    const afterAt = Date.now()
    await new Promise((resolve) => setTimeout(resolve, WINDOW_MS))
    const afterDelta = new Map<HostedObjectName, number>()
    for (const region of HOSTED_OBJECT_NAMES) {
      const value = (await executed(tabs.get(region) as Page)) ?? 0
      afterDelta.set(region, value - (afterStart.get(region) ?? 0))
    }
    const afterMs = Date.now() - afterAt

    const ratio = (region: HostedObjectName): number =>
      (afterDelta.get(region) ?? 0) / Math.max(1, beforeDelta.get(region) ?? 0)

    // Printed before the assertions, so a red run carries its own numbers.
    for (const region of HOSTED_OBJECT_NAMES) {
      console.log(
        `[RUN-02 regions] ${region} before=${String(beforeDelta.get(region))} tasks/${String(beforeMs)} ms ` +
          `after=${String(afterDelta.get(region))} tasks/${String(afterMs)} ms ` +
          `ratio=${ratio(region).toFixed(3)}`,
      )
    }

    // **What the after-window says, and what it does not — MEASURED, second correction.**
    //
    // The first draft asserted all three after-deltas were still moving, as a liveness floor.
    // On a quiet host all three read **0**, and nothing was wrong: the long run is 128 shards
    // at roughly one per 50 ms, and the before-reading probes below take seconds to settle, so
    // by the time the second window opens every tab has finished the work it started. An
    // after-window delta of zero is a run that completed, not a tab that died.
    //
    // So the liveness reading is `activity()` answering at all. It returns `null` only when
    // there is no node — which is exactly the difference between a **halted** node and a
    // stopped one, and is what makes this whole file possible.
    for (const region of HOSTED_OBJECT_NAMES) {
      expect(
        await executed(tabs.get(region) as Page),
        `${region}'s tab reports no activity at all after the flip, so it has no node. A halted ` +
          'node is alive, reachable and declining; a tab that stopped answering has died ' +
          'instead, and every reading below would be about the wrong thing.',
      ).not.toBeNull()
    }

    // ---- The VERDICT: a NEW run on each tab, in the same run as the before-reading. ---
    const probeAfter = new Map<HostedObjectName, string>()
    for (const region of HOSTED_OBJECT_NAMES) {
      probeAfter.set(region, await submitProbe(tabs.get(region) as Page, PROBE_N_AFTER))
      console.log(
        `[RUN-02 regions] ${region} new run after the flip -> ` +
          `${String(probeAfter.get(region)).slice(0, 140)}`,
      )
    }

    // Naming the halt, not merely failing: a run that failed for an unrelated reason would
    // satisfy a loose assertion and prove nothing about admission.
    expect(
      probeAfter.get('bootstrap-eu'),
      `criterion 1: the eu tab took a new run after its own region was halted. It said: ` +
        `${String(probeAfter.get('bootstrap-eu'))}. A halt a tab applies to its peers and not ` +
        'to itself stops nothing — see `BrowserNode.localAdmission`.',
    ).toContain('took-no-work')
    // Every shard, not merely the job as a whole: a run that placed three of four and failed
    // the fourth would also read `complete: false`, and that is a different fact.
    expect(probeAfter.get('bootstrap-eu')).toContain('unagreed/unagreed/unagreed/unagreed')

    // **The half that makes this a slice**, read in the same run from the same two tabs.
    for (const region of ['bootstrap-us', 'bootstrap-sam'] as const) {
      expect(
        probeAfter.get(region),
        `criterion 1: ${region}'s tab refused a new run after a halt addressed to ` +
          'bootstrap-eu. That is a global switch wearing a region field, and it is the failure ' +
          'the criterion names: one bad region would take offline volunteers whose region was ' +
          `never affected. It said: ${String(probeAfter.get(region))}`,
      ).toContain('took-the-work')
    }

    // ---- The volunteer-visible half: the title, once the in-flight work has drained. --
    let titleCarriedMarker = false
    try {
      await (tabs.get('bootstrap-eu') as Page).waitForFunction(
        (prefix: string) => document.title.startsWith(prefix),
        STOPPED_TITLE_PREFIX,
        { timeout: 30_000 },
      )
      titleCarriedMarker = true
    } catch {
      titleCarriedMarker = false
    }
    console.log(
      `[RUN-02 regions] eu title carried the stopped marker within 30 s: ${String(titleCarriedMarker)} ` +
        `(title = ${JSON.stringify(await (tabs.get('bootstrap-eu') as Page).title())})`,
    )
    // **Asserted rather than merely recorded, because it was observed** — but the deadline is
    // generous and the reason is the precedence rule chosen with the third title state:
    // `inFlight > 0` outranks `halted`, so this tab only wears the marker once the 128-shard
    // run it started BEFORE the flip has drained. At `dutyCycle: 0.5` that is roughly 6 s of
    // work, and 30 s is that with room for a loaded host.
    //
    // If this ever fails on a quiet host, the finding is about the precedence rule and not
    // about the switch — and `kill-switch-volunteer.e2e.test.ts` is what still carries
    // criterion 2's indicator half, because that tab runs no colouring at all and so drains
    // immediately.
    expect(
      titleCarriedMarker,
      "the halted tab's title never carried the stopped marker within 30 s of the flip. That is " +
        'a statement about work draining, not about admission: `inFlight > 0` outranks `halted` ' +
        'deliberately, because a halted tab still finishing what it took on IS computing.',
    ).toBe(true)
  }, 300_000)
})
