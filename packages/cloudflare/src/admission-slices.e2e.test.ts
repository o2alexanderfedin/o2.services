/**
 * RUN-02, criterion 1's server half — three objects, one flipped, the other two observed still
 * admitting **in the same run**, and `instance` unchanged across the flip.
 *
 * ## What each half of the reading is for
 *
 * The criterion is *"flipping one region's slice is observed leaving the other two admitting
 * work"*, and it names the failure it was written against: *"A global-only switch fails this
 * criterion by construction: one bad region would take offline volunteers whose region was
 * never affected."* So the `us` and `sam` readings are not a formality — they are the half that
 * distinguishes a slice from a switch, and they are taken **after** the flip, from the same
 * three ports, in the same run.
 *
 * The **floor** is taken first: three objects all reporting `halted: true` from the start would
 * let every after-reading pass while measuring nothing. Three distinct region labels and three
 * `halted: false` is what says the instrument was reading something.
 *
 * `instance` carries the *no redeploy* clause, in the platform's own terms.
 * `worker.ts` states what it means: *"`instance` is fixed at construction, so two readings
 * carrying one `peerId` and two `instance` values are an identity that crossed a construction
 * boundary, while two readings carrying one of each are the same live object answering twice."*
 * Three unchanged `instance` values across the flip is the platform saying no construction and
 * no eviction happened between the two readings — which is a stronger statement than "we did
 * not run `wrangler deploy`", because it also excludes a restart nobody asked for.
 *
 * ## What this file does NOT prove, said here rather than left to be noticed
 *
 * These are three **local `workerd` processes on three ports**, not three sited Cloudflare
 * objects. Siting three objects under three names is Phase 33's subject. What is proved here is
 * that the *mechanism* slices: a write names a region, an object that serves another region
 * refuses it, and one object's state moves while two others do not. Where those objects
 * physically are does not enter the reading.
 *
 * The scope fence: `--local-protocol http`, a fresh `mkdtemp` per child so no earlier run's
 * state can reach this one — `hosted-record-store.e2e.test.ts` produced a false green exactly
 * that way once — `CLOUDFLARE_API_TOKEN: ''`, `WRANGLER_SEND_METRICS: 'false'`, and nothing
 * deployed.
 */

import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ADMISSION_KEY_HEADER } from './admission-flag.ts'
import { HOSTED_OBJECT_NAMES } from './hosted-object.ts'
import type { AdmissionDirective } from '@o2/libp2p'
import type { HostedObjectName } from './hosted-object.ts'

const PACKAGE_DIR = fileURLToPath(new URL('..', import.meta.url))
const HOST = '127.0.0.1'

/** Its own three: 8791–8798 are taken by the seven workerd e2e specs already in the tree. */
const PORTS: Readonly<Record<HostedObjectName, number>> = {
  'bootstrap-us': 8801,
  'bootstrap-eu': 8802,
  'bootstrap-sam': 8803,
}

/**
 * The key these three objects are configured with.
 *
 * A test key, injected by `--var`, never a secret and never written to a deployed object. It is
 * here as a literal so that the *wrong key* arm below can be a different literal — an assertion
 * whose two sides are the same variable proves nothing about the comparison it is testing.
 */
const TEST_KEY = 'phase-36-local-workerd-operator-key'

interface SelfReport {
  readonly peerId: string
  readonly instance: string
  readonly admission: AdmissionDirective
}

const children: ChildProcess[] = []
const persistDirs: string[] = []

/**
 * Read `/self` and narrow it at the boundary.
 *
 * A cast would make a route that stopped reporting `admission` present as `undefined` inside a
 * comparison rather than as a failure where it happened — the argument
 * `stop-closes-the-billed-socket.e2e.test.ts` and `inbound-listener.e2e.test.ts` both make
 * about this same route.
 */
async function readSelf(port: number): Promise<SelfReport> {
  const response = await fetch(`http://${HOST}:${String(port)}/self`, {
    signal: AbortSignal.timeout(5_000),
  })
  if (!response.ok) throw new Error(`/self on ${String(port)} answered ${String(response.status)}`)
  const body: unknown = await response.json()
  if (
    typeof body !== 'object' ||
    body === null ||
    !('peerId' in body) ||
    typeof body.peerId !== 'string' ||
    !('instance' in body) ||
    typeof body.instance !== 'string' ||
    !('admission' in body)
  ) {
    throw new Error(`/self answered a body this test cannot read: ${JSON.stringify(body)}`)
  }
  const admission = body.admission
  if (
    typeof admission !== 'object' ||
    admission === null ||
    !('halted' in admission) ||
    typeof admission.halted !== 'boolean' ||
    !('region' in admission) ||
    !('versions' in admission) ||
    !('since' in admission) ||
    !('note' in admission) ||
    typeof admission.note !== 'string'
  ) {
    throw new Error(`/self reported an admission field this test cannot read: ${JSON.stringify(admission)}`)
  }
  return {
    peerId: body.peerId,
    instance: body.instance,
    admission: admission as unknown as AdmissionDirective,
  }
}

interface WriteResult {
  readonly status: number
  readonly body: string
}

async function postAdmission(
  port: number,
  directive: Partial<AdmissionDirective>,
  key: string | null,
): Promise<WriteResult> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (key !== null) headers[ADMISSION_KEY_HEADER] = key
  const response = await fetch(`http://${HOST}:${String(port)}/admission`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      region: null,
      halted: false,
      versions: 'all',
      since: null,
      note: '',
      ...directive,
    }),
    signal: AbortSignal.timeout(5_000),
  })
  return { status: response.status, body: await response.text() }
}

async function waitForReady(port: number, timeoutMs: number): Promise<SelfReport> {
  const deadline = Date.now() + timeoutMs
  let lastError: unknown
  while (Date.now() < deadline) {
    try {
      return await readSelf(port)
    } catch (cause) {
      lastError = cause
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error(
    `workerd on ${String(port)} did not become ready within ${String(timeoutMs)} ms: ${String(lastError)}`,
  )
}

beforeAll(async () => {
  // **Sequentially, waiting for each `/self` before starting the next.** Three workerd
  // processes racing to bind and compile is a source of flake with nothing to do with the
  // property under test.
  for (const region of HOSTED_OBJECT_NAMES) {
    const persistDir = await mkdtemp(join(tmpdir(), `o2-admission-${region}-`))
    persistDirs.push(persistDir)
    children.push(
      spawn(
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
          // `--var` MERGES with the file's `vars` rather than replacing them — measured
          // 2026-08-27 and recorded at `worker.ts`'s `O2_VERSION` docblock — so
          // `ANNOUNCE_MULTIADDRS` survives this injection.
          '--var',
          `O2_REGION:${region}`,
          '--var',
          `O2_ADMISSION_KEY:${TEST_KEY}`,
        ],
        {
          cwd: PACKAGE_DIR,
          env: { ...process.env, CLOUDFLARE_API_TOKEN: '', WRANGLER_SEND_METRICS: 'false' },
          stdio: 'ignore',
        },
      ),
    )
    await waitForReady(PORTS[region], 120_000)
  }
}, 400_000)

afterAll(async () => {
  try {
    for (const child of children) child.kill('SIGTERM')
  } finally {
    for (const dir of persistDirs) await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}, 120_000)

describe('RUN-02 criterion 1 — one region halted, the other two still admitting', () => {
  it('flips one object and leaves the other two admitting, with every `instance` unchanged', async () => {
    // ---- The floor. Three objects, three labels, none of them halted. ----
    const before = new Map<HostedObjectName, SelfReport>()
    for (const region of HOSTED_OBJECT_NAMES) before.set(region, await readSelf(PORTS[region]))

    for (const region of HOSTED_OBJECT_NAMES) {
      const report = before.get(region)
      expect(
        report?.admission.region,
        `criterion 1's floor: the object on ${String(PORTS[region])} was started with ` +
          `--var O2_REGION:${region} and reports ${JSON.stringify(report?.admission.region)}. ` +
          'Three objects that cannot name themselves are not three slices.',
      ).toBe(region)
      expect(
        report?.admission.halted,
        `criterion 1's floor: ${region} reports halted BEFORE anything was written to it, so ` +
          'the after-reading below would pass while measuring nothing.',
      ).toBe(false)
    }
    // Three distinct instances, which is also three distinct objects rather than one answering
    // on three ports.
    expect(new Set([...before.values()].map((report) => report.instance)).size).toBe(3)

    // ---- The flip. ONE write, to ONE port, naming that port's own region. ----
    const written = await postAdmission(
      PORTS['bootstrap-eu'],
      {
        region: 'bootstrap-eu',
        halted: true,
        versions: 'all',
        since: Date.now(),
        note: 'phase 36 — the eu slice, halted at run time',
      },
      TEST_KEY,
    )
    // Asserted before anything below, because an unaccepted write would make every assertion
    // that follows pass for the wrong reason.
    expect(
      written.status,
      `the flip itself was refused (${written.status}): ${written.body}`,
    ).toBe(200)

    const flippedAt = Date.now()

    // ---- The after-reading, all three ports, same run. ----
    const after = new Map<HostedObjectName, SelfReport>()
    for (const region of HOSTED_OBJECT_NAMES) after.set(region, await readSelf(PORTS[region]))

    const eu = after.get('bootstrap-eu')
    expect(eu?.admission.halted).toBe(true)
    expect(eu?.admission.note).toBe('phase 36 — the eu slice, halted at run time')
    expect(eu?.admission.region).toBe('bootstrap-eu')
    // `since` inside this run's own wall-clock window, so the reading is of a directive written
    // by this run rather than one left behind.
    expect(eu?.admission.since ?? 0).toBeGreaterThan(flippedAt - 60_000)
    expect(eu?.admission.since ?? Number.MAX_SAFE_INTEGER).toBeLessThanOrEqual(flippedAt)

    // **The half that makes this a slice.** Read from the same three ports, in the same run,
    // after the flip — not inferred from the absence of a write to them.
    for (const region of ['bootstrap-us', 'bootstrap-sam'] as const) {
      expect(
        after.get(region)?.admission.halted,
        `criterion 1: ${region} is halted after a write addressed to bootstrap-eu. That is a ` +
          'global switch wearing a region field, and it is the failure the criterion names: ' +
          'one bad region would take offline volunteers whose region was never affected.',
      ).toBe(false)
    }

    // ---- No redeploy, in the platform's own terms. ----
    for (const region of HOSTED_OBJECT_NAMES) {
      expect(
        after.get(region)?.instance,
        `no-redeploy reading INCONCLUSIVE for ${region}: \`instance\` moved from ` +
          `${String(before.get(region)?.instance)} to ${String(after.get(region)?.instance)}, ` +
          'which means the object was reconstructed between the two readings. Every conclusion ' +
          'about "no redeploy" would then be about two different objects. Re-take the reading; ' +
          'do not subtract it.',
      ).toBe(before.get(region)?.instance)
      expect(after.get(region)?.peerId).toBe(before.get(region)?.peerId)
    }

    // Printed rather than only asserted, on `[BROW-08 socket]`'s precedent: the no-redeploy
    // claim is a pair of readings, and a reader of the run should be able to see both rather
    // than take an equality's word for it.
    for (const region of HOSTED_OBJECT_NAMES) {
      console.log(
        `[RUN-02 slice] ${region} instance before=${String(before.get(region)?.instance)} ` +
          `after=${String(after.get(region)?.instance)} ` +
          `halted=${String(after.get(region)?.admission.halted)}`,
      )
    }
  }, 120_000)

  it('refuses a write addressed to a region it does not serve, and does not move', async () => {
    // An operator tool that fans one command out to every endpoint — which is what a tool
    // written for a global switch does — gets a refusal here rather than a third halted object.
    const before = await readSelf(PORTS['bootstrap-us'])
    const refused = await postAdmission(
      PORTS['bootstrap-us'],
      { region: 'bootstrap-eu', halted: true, versions: 'all', since: Date.now(), note: 'fan-out' },
      TEST_KEY,
    )
    expect(refused.status).toBe(409)
    // Both region names, as independent literals rather than read off the response.
    expect(refused.body).toContain('bootstrap-eu')
    expect(refused.body).toContain('bootstrap-us')

    const after = await readSelf(PORTS['bootstrap-us'])
    expect(after.admission.halted).toBe(false)
    expect(after.admission.note).toBe(before.admission.note)
  }, 60_000)

  it('refuses a write with no key and a write with the wrong key, and does not move', async () => {
    const noKey = await postAdmission(
      PORTS['bootstrap-sam'],
      { region: 'bootstrap-sam', halted: true, versions: 'all', since: Date.now(), note: 'x' },
      null,
    )
    expect(noKey.status).toBe(401)
    const wrongKey = await postAdmission(
      PORTS['bootstrap-sam'],
      { region: 'bootstrap-sam', halted: true, versions: 'all', since: Date.now(), note: 'x' },
      'phase-36-local-workerd-operator-kex',
    )
    expect(wrongKey.status).toBe(401)
    expect((await readSelf(PORTS['bootstrap-sam'])).admission.halted).toBe(false)
  }, 60_000)
})
