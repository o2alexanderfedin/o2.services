/**
 * `NET-15` — a scheduled, repeated drill that takes one region out and reports bounded,
 * measured degradation, read as a delta between two arms of ONE run.
 *
 * ## The arrangement this reuses, and the one thing it adds
 *
 * `admission-slices.e2e.test.ts` already boots three local `wrangler dev` children on three
 * ports, sequentially, readiness-polled — this file copies that boot exactly. What it adds is
 * the KILL: `SIGTERM` to one child mid-run, and a synthetic population driven through both the
 * up and the down arrangement so the loss can be read as a delta rather than assumed from the
 * topology.
 *
 * **Ports 8831/8832/8833.** Re-verified at write time with
 * `grep -rnoE '\b8[0-9]{3}\b' packages/*\/src/*.ts` over the tracked tree: the four-digit ports
 * already in use are 8000-8063, 8115-8192, 8410-8555, 8625, 8787, 8791-8810, 8814-8826, 8835,
 * 8836, 8938 — none of them 8831, 8832 or 8833.
 *
 * ## The reading is comparative inside one run, never against a threshold
 *
 * `CLAUDE.md` § Measurement: an absolute threshold silently encodes the machine, the load and
 * the I/O weather of the day it was written. Every degradation assertion below compares arm A
 * to arm B of this same run, or compares a count against the literal implied by the harness's
 * own uniform one-third distribution — never against a hard-coded latency, duration or byte
 * figure.
 *
 * ## What "assertion 3" measures and what it does not, stated once here
 *
 * The stalled-report sum's magnitude (`PER_REGION`) is *arithmetic*, fixed by this harness's
 * own choice to distribute the population one-third per region and to re-report a failed third
 * as `stalled`. It is not a reading and must not be quoted as a measured fraction. What IS
 * measured is: the killed region actually stopped answering (assertion 1); the loss did not
 * fan out past it (assertion 2); and the survivors absorbed the re-reports rather than
 * dropping them (assertion 3's own case). A harness that silently dropped the failed third
 * would satisfy assertions 1 and 2 and fail assertion 3, which is the point of having it.
 *
 * ## `agent-now`, and what stays `waits on owner act 2`
 *
 * Every object here is a local `wrangler dev` child on loopback — `CLOUDFLARE_API_TOKEN: ''`,
 * `WRANGLER_SEND_METRICS: 'false'`, a fresh `--persist-to` per child, nothing deployed. This is
 * criterion 3's agent-side half and criterion 4's locally observable half. The live reading
 * against three DEPLOYED regions, and cross-region dialability observed on the real fabric,
 * are `waits on owner act 2` and are not claimed here.
 *
 * The platform's own per-request geolocation object — the one `CLAUDE.md` records a local
 * `wrangler dev` populating from this machine's real public address — is never read, logged or
 * written anywhere in this file. The emitted table carries region addresses and counts only,
 * checked below against plan 33-04's `rawLocationClaims` (Tier 1 term list and Tier 2
 * attribution matcher, both applied) rather than by eye.
 */

import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { noise } from '@chainsafe/libp2p-noise'
import { yamux } from '@chainsafe/libp2p-yamux'
import { identify } from '@libp2p/identify'
import { webSockets } from '@libp2p/websockets'
import { multiaddr } from '@multiformats/multiaddr'
import { createLibp2p } from 'libp2p'
import type { Libp2p } from 'libp2p'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { FUNNEL_STAGES } from '@o2/net'
import type { FunnelStage } from '@o2/net'
import { rawLocationClaims } from '../../node/src/location-claims.ts'
import { HOSTED_OBJECT_NAME, HOSTED_OBJECT_NAMES } from './hosted-object.ts'
import type { HostedObjectName } from './hosted-object.ts'

/**
 * The identity secret this spec's local `wrangler dev` boots with — AUTH-07 criterion 4.
 * Per-spec test data, in the style of `admission-slices.e2e.test.ts`'s own `SECRET`: this spec
 * passes its own `--persist-to`, so the value only has to be self-consistent with itself. Must
 * be at least twenty characters or `assertUsablePassphrase` refuses.
 */
const SECRET = 'local-dev-identity-secret-42-region-loss'

const PACKAGE_DIR = fileURLToPath(new URL('..', import.meta.url))
const HOST = '127.0.0.1'

/** Its own three — see the header comment for the grep that confirmed them free. */
const PORTS: Readonly<Record<HostedObjectName, number>> = {
  'bootstrap-us': 8831,
  'bootstrap-eu': 8832,
  'bootstrap-sam': 8833,
}

/** The second region, by `HOSTED_OBJECT_NAMES`'s own order — the one this drill kills. */
const KILLED_REGION: HostedObjectName = HOSTED_OBJECT_NAME.eu

/**
 * Where the killed region's failed reports are re-reported as `stalled`.
 *
 * A fixed choice rather than a round-robin: assertion 3 sums across the two survivors, so
 * which one receives a given re-report is an implementation detail of THIS harness and not
 * part of what the drill claims.
 */
const REDIRECT_SURVIVOR: HostedObjectName = HOSTED_OBJECT_NAME.us

/** A literal multiple of 3 — arm A's population, one third of it addressed to each region. */
const POPULATION_SIZE = 12
/** `POPULATION_SIZE / 3`, its own literal so the arithmetic in assertions 1 and 3 is visible. */
const PER_REGION = 4

/** Every region except the one named. */
function survivorsOf(killed: HostedObjectName): readonly HostedObjectName[] {
  return HOSTED_OBJECT_NAMES.filter((region) => region !== killed)
}

/** A `Map#get` that refuses to hand back `undefined` silently. */
function mustGet<K, V>(map: ReadonlyMap<K, V>, key: K): V {
  const value = map.get(key)
  if (value === undefined) throw new Error(`no map entry found for ${JSON.stringify(key)}`)
  return value
}

const children = new Map<HostedObjectName, ChildProcess>()
const persistDirs = new Map<HostedObjectName, string>()

interface SelfReport {
  readonly peerId: string
  readonly region: string | null
}

/** Read `/self` and narrow it at the boundary — the argument every reader of this route makes. */
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
    !('admission' in body)
  ) {
    throw new Error(`/self answered a body this test cannot read: ${JSON.stringify(body)}`)
  }
  const admission = body.admission
  if (typeof admission !== 'object' || admission === null || !('region' in admission)) {
    throw new Error(`/self reported an admission field this test cannot read: ${JSON.stringify(admission)}`)
  }
  const region = admission.region
  if (region !== null && typeof region !== 'string') {
    throw new Error(`/self reported a region that is neither a string nor null: ${JSON.stringify(region)}`)
  }
  return { peerId: body.peerId, region }
}

async function waitForReady(port: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  let lastError: unknown
  while (Date.now() < deadline) {
    try {
      await readSelf(port)
      return
    } catch (cause) {
      lastError = cause
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error(`workerd on ${String(port)} did not become ready within ${String(timeoutMs)} ms: ${String(lastError)}`)
}

/**
 * Poll until a port refuses a connection, with a bounded timeout — the local stand-in for a
 * region's loss. Any response at all, even a 500, counts as "still up"; only a transport-level
 * refusal counts as down.
 */
async function waitForDown(port: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      await fetch(`http://${HOST}:${String(port)}/self`, { signal: AbortSignal.timeout(2_000) })
    } catch {
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 300))
  }
  throw new Error(`port ${String(port)} was still answering after ${String(timeoutMs)} ms — the kill did not take`)
}

/** Every numeric field of a plain object, read without a cast — `Object.entries` on `object`. */
function numberMap(value: unknown, context: string): Map<string, number> {
  if (typeof value !== 'object' || value === null) {
    throw new Error(`${context} is not an object: ${JSON.stringify(value)}`)
  }
  const map = new Map<string, number>()
  for (const [key, raw] of Object.entries(value)) {
    if (typeof raw !== 'number') throw new Error(`${context}.${key} is not a number: ${JSON.stringify(raw)}`)
    map.set(key, raw)
  }
  return map
}

interface FunnelTotals {
  readonly entered: ReadonlyMap<string, number>
  readonly stalledAt: ReadonlyMap<string, number>
}

async function readFunnel(port: number): Promise<FunnelTotals> {
  const response = await fetch(`http://${HOST}:${String(port)}/funnel`, {
    signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok) throw new Error(`GET /funnel on ${String(port)} answered ${String(response.status)}`)
  const body: unknown = await response.json()
  if (
    typeof body !== 'object' ||
    body === null ||
    !('entered' in body) ||
    !('stalledAt' in body)
  ) {
    throw new Error(`GET /funnel on ${String(port)} answered a body this test cannot read: ${JSON.stringify(body)}`)
  }
  return {
    entered: numberMap(body.entered, `GET /funnel on ${String(port)}'s entered`),
    stalledAt: numberMap(body.stalledAt, `GET /funnel on ${String(port)}'s stalledAt`),
  }
}

/** One stage's counter, refusing an absent key rather than reading it as zero. */
function countAt(totals: ReadonlyMap<string, number>, stage: FunnelStage, context: string): number {
  const value = totals.get(stage)
  if (value === undefined) throw new Error(`${context} carries no counter for stage '${stage}'`)
  return value
}

async function report(port: number, body: Record<string, unknown>): Promise<number> {
  const response = await fetch(`http://${HOST}:${String(port)}/funnel`, {
    method: 'POST',
    // `text/plain` — CORS-safelisted, the same header `funnel-collector.e2e.test.ts` uses.
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  })
  return response.status
}

/** One `wss-bootstrap`/`entered` report, the only kind arm A ever sends. */
function enteredReport(): Record<string, unknown> {
  return {
    stage: 'wss-bootstrap',
    kind: 'entered',
    hourBucket: 9,
    population: 'opted-in-only',
    networkClass: 'cellular',
  }
}

/** One `wss-bootstrap`/`stalled` re-report — what a real client sends when its own region fails. */
function stalledReport(): Record<string, unknown> {
  return {
    stage: 'wss-bootstrap',
    kind: 'stalled',
    hourBucket: 9,
    population: 'opted-in-only',
    networkClass: 'cellular',
  }
}

/**
 * Arm A — all three regions answering. `PER_REGION` `entered` reports to each, asserted `204`
 * at the moment each is made: a POST that silently failed here would look like the loss the
 * drill is measuring.
 */
async function driveArmA(): Promise<void> {
  for (const region of HOSTED_OBJECT_NAMES) {
    for (let i = 0; i < PER_REGION; i++) {
      const status = await report(PORTS[region], enteredReport())
      expect(status, `arm A: a POST to ${region} was refused (${String(status)})`).toBe(204)
    }
  }
}

/**
 * Arm B — the identical population and distribution, with `killed` down. A POST addressed to
 * `killed` must fail AT THE TRANSPORT (the kill actually took); caught and re-reported as
 * `stalled` to `redirectTo`, exactly as a real client would behave.
 */
async function driveArmB(killed: HostedObjectName, redirectTo: HostedObjectName): Promise<void> {
  for (const region of HOSTED_OBJECT_NAMES) {
    for (let i = 0; i < PER_REGION; i++) {
      if (region === killed) {
        let failedAtTransport = false
        try {
          await report(PORTS[region], enteredReport())
        } catch {
          failedAtTransport = true
        }
        expect(
          failedAtTransport,
          `arm B: a POST to the killed region ${region} did not fail at the transport — the kill did not take`,
        ).toBe(true)
        const status = await report(PORTS[redirectTo], stalledReport())
        expect(
          status,
          `arm B: the stalled re-report to the surviving region ${redirectTo} was refused (${String(status)})`,
        ).toBe(204)
      } else {
        const status = await report(PORTS[region], enteredReport())
        expect(status, `arm B: a POST to the surviving region ${region} was refused (${String(status)})`).toBe(204)
      }
    }
  }
}

/** The worker's own dialable address, built from a PeerId `/self` already reported. */
function workerAddress(port: number, peerId: string): string {
  return `/ip4/${HOST}/tcp/${String(port)}/ws/p2p/${peerId}`
}

/** A dialling node — `inbound-listener.e2e.test.ts`'s own shape, raised inbound limits included. */
async function dialer(): Promise<Libp2p> {
  const node = await createLibp2p({
    transports: [webSockets()],
    connectionEncrypters: [noise()],
    streamMuxers: [yamux()],
    services: { identify: identify() },
    connectionManager: { inboundConnectionThreshold: 100, maxIncomingPendingConnections: 100 },
  })
  await node.start()
  return node
}

beforeAll(async () => {
  // **Sequentially, waiting for each `/self` before starting the next** — three workerd
  // processes racing to bind and compile is a source of flake unrelated to this drill's
  // property, exactly `admission-slices.e2e.test.ts`'s own stated discipline.
  for (const region of HOSTED_OBJECT_NAMES) {
    const persistDir = await mkdtemp(join(tmpdir(), `o2-region-loss-${region}-`))
    persistDirs.set(region, persistDir)
    children.set(
      region,
      spawn(
        'npx',
        [
          'wrangler',
          'dev',
          '--port',
          String(PORTS[region]),
          '--local-protocol',
          'http',
          '--var',
          `O2_IDENTITY_SECRET:${SECRET}`,
          '--persist-to',
          persistDir,
          '--var',
          `O2_REGION:${region}`,
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
    for (const child of children.values()) child.kill('SIGTERM')
  } finally {
    for (const dir of persistDirs.values()) await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}, 120_000)

describe('NET-15 — a region taken out, read as a delta between two arms of one run', () => {
  it(
    'takes a floor, drives an identical population through both arms with bootstrap-eu killed between them, and reports a bounded degradation with the moving stage named and survivor identities unchanged',
    async () => {
      // ---- The floor. Taken first: three objects that already carried counts would let ----
      // ---- every delta below pass while measuring nothing. ----
      const floor = new Map<HostedObjectName, FunnelTotals>()
      for (const region of HOSTED_OBJECT_NAMES) floor.set(region, await readFunnel(PORTS[region]))
      for (const region of HOSTED_OBJECT_NAMES) {
        for (const stage of FUNNEL_STAGES) {
          expect(
            countAt(mustGet(floor, region).entered, stage, `${region} floor entered`),
            `${region}'s floor entered['${stage}'] must be 0 before anything is driven`,
          ).toBe(0)
          expect(
            countAt(mustGet(floor, region).stalledAt, stage, `${region} floor stalledAt`),
            `${region}'s floor stalledAt['${stage}'] must be 0 before anything is driven`,
          ).toBe(0)
        }
      }
      const regionLabels = new Set<string>()
      for (const region of HOSTED_OBJECT_NAMES) {
        const self = await readSelf(PORTS[region])
        expect(self.region, `${region}'s own /self must report its own region label`).toBe(region)
        if (self.region !== null) regionLabels.add(self.region)
      }
      expect(regionLabels.size, 'the floor: three distinct region labels').toBe(3)

      // ---- Arm A: dialability, then the population. ----
      const armAPeerIds = new Map<HostedObjectName, string>()
      for (const region of HOSTED_OBJECT_NAMES) {
        const node = await dialer()
        try {
          const self = await readSelf(PORTS[region])
          const connection = await node.dial(multiaddr(workerAddress(PORTS[region], self.peerId)), {
            signal: AbortSignal.timeout(30_000),
          })
          expect(
            connection.remotePeer.toString(),
            `${region}'s dial must return the PeerId its own /self reports`,
          ).toBe(self.peerId)
          armAPeerIds.set(region, connection.remotePeer.toString())
        } finally {
          await node.stop()
        }
      }
      expect(new Set(armAPeerIds.values()).size, 'arm A: three dials must return three distinct PeerIds').toBe(3)

      await driveArmA()
      const armAFunnel = new Map<HostedObjectName, FunnelTotals>()
      for (const region of HOSTED_OBJECT_NAMES) armAFunnel.set(region, await readFunnel(PORTS[region]))

      // ---- The kill. One object in the arrangement — the local stand-in for a region's ----
      // ---- loss. Not restarted; its persist directory is not removed. ----
      mustGet(children, KILLED_REGION).kill('SIGTERM')
      await waitForDown(PORTS[KILLED_REGION], 60_000)

      const survivors = survivorsOf(KILLED_REGION)

      // ---- Arm B: dialability after the loss. ----
      //
      // A manual try/catch rather than `.rejects.toThrow()`: a resolved `Connection` carries
      // libp2p component internals vitest's own pretty-printer cannot format, which turns a
      // clean assertion failure into an opaque `PrettyFormatPluginError` when this rejects. A
      // boolean plus a message keeps the failure legible, on `driveArmB`'s own precedent.
      const killedDialer = await dialer()
      try {
        let killedDialRejected = false
        try {
          await killedDialer.dial(multiaddr(workerAddress(PORTS[KILLED_REGION], mustGet(armAPeerIds, KILLED_REGION))), {
            signal: AbortSignal.timeout(10_000),
          })
        } catch {
          killedDialRejected = true
        }
        expect(
          killedDialRejected,
          `${KILLED_REGION}'s dial must fail within a bounded timeout after the kill`,
        ).toBe(true)
      } finally {
        await killedDialer.stop()
      }

      for (const region of survivors) {
        const node = await dialer()
        try {
          const self = await readSelf(PORTS[region])
          const connection = await node.dial(multiaddr(workerAddress(PORTS[region], self.peerId)), {
            signal: AbortSignal.timeout(30_000),
          })
          expect(
            connection.remotePeer.toString(),
            `${region}'s arm B dial must return the same PeerId it returned in arm A — identity stability across the loss`,
          ).toBe(mustGet(armAPeerIds, region))
        } finally {
          await node.stop()
        }
      }

      // ---- Arm B: the population, with the killed region's share re-reported. ----
      await driveArmB(KILLED_REGION, REDIRECT_SURVIVOR)
      const armBFunnel = new Map<HostedObjectName, FunnelTotals>()
      for (const region of survivors) armBFunnel.set(region, await readFunnel(PORTS[region]))

      // ---- Assertion 1: the killed region's last-known counter, pinned. Arm B never reads ----
      // ---- bootstrap-eu's /funnel again — the surface is gone — so this arm-A reading IS its ----
      // ---- last-known value, unmoved by construction. ----
      const killedArmAEntered = countAt(
        mustGet(armAFunnel, KILLED_REGION).entered,
        'wss-bootstrap',
        `${KILLED_REGION} arm A entered`,
      )
      expect(
        killedArmAEntered,
        `assertion 1: ${KILLED_REGION} must have received exactly its own third of arm A's population before it was killed`,
      ).toBe(PER_REGION)

      // ---- Assertion 2: each survivor's entered delta is identical across the two arms. ----
      for (const region of survivors) {
        const armAEntered = countAt(mustGet(armAFunnel, region).entered, 'wss-bootstrap', `${region} arm A entered`)
        const armBEntered = countAt(mustGet(armBFunnel, region).entered, 'wss-bootstrap', `${region} arm B entered`)
        const armADelta = armAEntered
        const armBDelta = armBEntered - armAEntered
        expect(
          armBDelta,
          `assertion 2: ${region}'s entered['wss-bootstrap'] moved by ${String(armADelta)} in arm A and by ` +
            `${String(armBDelta)} in arm B — the loss must be bounded to ${KILLED_REGION}`,
        ).toBe(armADelta)
      }

      // ---- Assertion 3: the stalled sum, summed across survivors — arithmetic, not a ----
      // ---- measured fraction (see the header docblock). ----
      let stalledSumArmA = 0
      let stalledSumArmB = 0
      for (const region of survivors) {
        const armAStalled = countAt(mustGet(armAFunnel, region).stalledAt, 'wss-bootstrap', `${region} arm A stalledAt`)
        const armBStalled = countAt(mustGet(armBFunnel, region).stalledAt, 'wss-bootstrap', `${region} arm B stalledAt`)
        stalledSumArmA += armAStalled
        stalledSumArmB += armBStalled - armAStalled
      }
      expect(stalledSumArmA, 'assertion 3: no stalled re-report exists before the kill').toBe(0)
      expect(
        stalledSumArmB,
        'assertion 3: the survivors must together absorb exactly the killed region\'s own share of the ' +
          'population as stalled re-reports — a run that dropped them silently would fail here',
      ).toBe(PER_REGION)

      // ---- Assertion 4: wss-bootstrap is the only stage whose stalledAt moved. ----
      for (const stage of FUNNEL_STAGES) {
        let delta = 0
        for (const region of survivors) {
          const a = countAt(mustGet(armAFunnel, region).stalledAt, stage, `${region} arm A stalledAt[${stage}]`)
          const b = countAt(mustGet(armBFunnel, region).stalledAt, stage, `${region} arm B stalledAt[${stage}]`)
          delta += b - a
        }
        if (stage === 'wss-bootstrap') {
          expect(delta, "assertion 4: 'wss-bootstrap' is the stage that moved").toBe(PER_REGION)
        } else {
          expect(delta, `assertion 4: '${stage}' must not move between the arms`).toBe(0)
        }
      }

      // ---- The two-arm table: stage, region, metric, arm A, arm B. Region addresses and ----
      // ---- counts only — no place name, checked below rather than by eye. ----
      const lines: string[] = [
        '# region-loss-drill two-arm table',
        '# arm A: three regions answering. arm B: the second region terminated between the arms.',
        '# values are wss-bootstrap funnel counters; a region name here is an address, never a',
        '# location claim.',
        'stage,region,metric,armA,armB',
      ]
      for (const stage of FUNNEL_STAGES) {
        for (const region of HOSTED_OBJECT_NAMES) {
          const a = mustGet(armAFunnel, region)
          const aEntered = countAt(a.entered, stage, `${region} arm A entered[${stage}]`)
          const aStalled = countAt(a.stalledAt, stage, `${region} arm A stalledAt[${stage}]`)
          if (region === KILLED_REGION) {
            lines.push(`${stage},${region},entered,${String(aEntered)},unreachable`)
            lines.push(`${stage},${region},stalledAt,${String(aStalled)},unreachable`)
            continue
          }
          const b = mustGet(armBFunnel, region)
          const bEntered = countAt(b.entered, stage, `${region} arm B entered[${stage}]`)
          const bStalled = countAt(b.stalledAt, stage, `${region} arm B stalledAt[${stage}]`)
          lines.push(`${stage},${region},entered,${String(aEntered)},${String(bEntered)}`)
          lines.push(`${stage},${region},stalledAt,${String(aStalled)},${String(bStalled)}`)
        }
      }
      const tableText = lines.join('\n')

      // A fixed, non-randomised path so a CI workflow can upload it by name — see
      // `.github/workflows/region-loss-drill.yml`.
      const tableDir = join(tmpdir(), 'o2-region-loss-drill')
      await mkdir(tableDir, { recursive: true })
      const tablePath = join(tableDir, 'two-arm-table.csv')
      await writeFile(tablePath, tableText, 'utf8')
      console.log(tableText)

      const claims = rawLocationClaims(tablePath, tableText, HOSTED_OBJECT_NAMES)
      expect(claims, `the emitted table contains a location claim: ${JSON.stringify(claims)}`).toEqual([])
    },
    300_000,
  )
})
