/**
 * RUN-02 — two writes this object correctly refuses must not take its status reading
 * offline.
 *
 * ## The defect, measured, and repaired with no regression guard behind it
 *
 * `#writeAdmission` was written first as *check the key, return 401, never touch the
 * body* — which reads like the careful order and is not. `workerd` answered every refused
 * write with `Uncaught TypeError: Can't read from request stream after response has been
 * sent`, one per refusal, and **the next `GET /self` on that object answered 500**. So a
 * refusal poisoned the instance, and an unauthenticated stranger could take a region's
 * status page offline with two POSTs it was correctly refused.
 *
 * The repair is in the tree — `worker.ts` reads `await request.text()` **before** the key
 * check, bounded by `MAX_ADMISSION_BODY_BYTES` — and its own docblock says so. Nothing
 * measured it: a search for `request stream`, `bodyUsed` or `arrayBuffer()` across this
 * package's specs returned nothing before this file.
 *
 * ## Which arm carries the plant, and this is a divergence worth stating
 *
 * The brief for this file named the **409** shape — a `POST` addressed to a region this
 * object does not serve. That case is here and it is the right shape for *"a legitimate
 * refusal, not malformed input"*. But it cannot carry the plant **by construction**: the
 * region check runs after `parseDirective`, which cannot run until the body has been
 * read, so a 409 consumes the body on every ordering of this method. A file that sent
 * only mis-addressed writes would stay green under the restored defect.
 *
 * The arm that goes red is the **401**: a well-formed directive with no key, and one with
 * the wrong key. Restore *check the key, return 401, never touch the body* — move the
 * `authoriseWrite` block above `const raw = await request.text()` — and the second `GET
 * /self` after those two POSTs answers 500 rather than 200. Both arms are here, each
 * labelled with what it is for.
 *
 * ## `instance`, and the fail-open it closes
 *
 * "The next `GET /self` answers 200" is not sufficient on its own. If a poisoned object
 * were torn down and rebuilt, a fresh instance would answer 200 while the defect was
 * live, and a status-only reading would call that a pass. `worker.ts` states what the
 * field means: *"`instance` is fixed at construction, so two readings carrying one
 * `peerId` and two `instance` values are an identity that crossed a construction
 * boundary."* So every reading here is compared against the floor's `instance`, and a
 * moved value fails as loudly as a 500 — the platform saying the object died and came
 * back is not this object surviving.
 *
 * ## `workerd`'s stderr is piped, and that is the only reason the defect was found
 *
 * Every other e2e spec in this package spawns with `stdio: 'ignore'`. The `Uncaught
 * TypeError` above is printed by `workerd` and by nothing else — no HTTP status, no
 * assertion and no vitest output carries it — so a run that discards stderr sees a 500
 * and no cause. This file pipes it, forwards `ERROR` lines live, keeps the whole
 * transcript, and puts it in the failure message of every assertion below.
 *
 * It does **not** assert that the message is absent. An absence read off a pipe with no
 * positive control passes exactly as loudly when the pipe is broken as when the object is
 * healthy, and this repository has closed a criterion on an empty read before. The
 * instrument is the status code; the transcript is the diagnosis, printed either way.
 *
 * The scope fence, copied from `admission-slices.e2e.test.ts`: `--local-protocol http`, a
 * fresh `mkdtemp` per child so no earlier run's state can reach this one,
 * `CLOUDFLARE_API_TOKEN: ''`, `WRANGLER_SEND_METRICS: 'false'`, and nothing deployed.
 */

import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ADMISSION_KEY_HEADER } from './admission-flag.ts'
import type { AdmissionDirective } from '@o2/libp2p'
import type { HostedObjectName } from './hosted-object.ts'

const PACKAGE_DIR = fileURLToPath(new URL('..', import.meta.url))
const HOST = '127.0.0.1'

/** Its own port: 8791–8798, 8801–8810 and 8814–8817 are taken by the specs already in the tree. */
const PORT = 8820

/** The region this one object serves. Every refusal below is judged against it. */
const REGION: HostedObjectName = 'bootstrap-us'

/** A region this object does **not** serve, for the mis-addressed arm. */
const OTHER_REGION: HostedObjectName = 'bootstrap-eu'

/**
 * The key this object is configured with.
 *
 * A test value injected by `--var`, never a secret and never written to a deployed
 * object. It is a literal here so the *wrong key* arm can be a different literal — an
 * assertion whose two sides are the same variable proves nothing about the comparison it
 * is testing.
 */
const TEST_KEY = 'phase-36-refused-write-local-operator-key'

/** A key that is well-formed and wrong. Differs from {@link TEST_KEY} in more than case. */
const WRONG_KEY = 'phase-36-refused-write-local-operator-KEY-but-not-the-one'

interface SelfReport {
  readonly status: number
  readonly peerId: string
  readonly instance: string
  /**
   * `null` when the route did not answer 200.
   *
   * A named absence rather than a fabricated directive behind a cast: a 500 is the
   * reading this file exists to catch, and inventing a directive to keep the shape whole
   * would make the very failure under test present as `halted: false` in a comparison.
   */
  readonly admission: AdmissionDirective | null
}

let child: ChildProcess | undefined
let persistDir: string | undefined

/** Everything `workerd` wrote to stderr, in order. Printed on failure and at the end. */
const stderrLog: string[] = []

/** The transcript, trimmed, for an assertion message. */
function transcript(): string {
  const text = stderrLog.join('')
  const tail = text.length > 4_000 ? `…${text.slice(-4_000)}` : text
  return tail.length === 0 ? '(workerd wrote nothing to stderr)' : tail
}

/**
 * Read `/self` and narrow it at the boundary.
 *
 * The status is returned rather than thrown on, because a **500 is the reading this file
 * is about** — throwing would turn the defect into an error in the harness instead of a
 * failed expectation naming what happened.
 */
async function readSelf(): Promise<SelfReport> {
  const response = await fetch(`http://${HOST}:${String(PORT)}/self`, {
    signal: AbortSignal.timeout(5_000),
  })
  if (!response.ok) {
    return { status: response.status, peerId: '', instance: '', admission: null }
  }
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
  // Narrowed at the boundary rather than cast blind, on the argument
  // `stop-closes-the-billed-socket.e2e.test.ts` and `inbound-listener.e2e.test.ts` both
  // make about this route: a field that stopped being reported would otherwise present as
  // `undefined` inside a comparison instead of as a failure where it happened.
  const admission = body.admission
  if (
    typeof admission !== 'object' ||
    admission === null ||
    !('halted' in admission) ||
    typeof admission.halted !== 'boolean' ||
    !('region' in admission) ||
    !('note' in admission) ||
    typeof admission.note !== 'string'
  ) {
    throw new Error(`/self reported an admission field this test cannot read: ${JSON.stringify(admission)}`)
  }
  return {
    status: response.status,
    peerId: body.peerId,
    instance: body.instance,
    admission: admission as unknown as AdmissionDirective,
  }
}

interface WriteResult {
  readonly status: number
  readonly body: string
}

/**
 * POST a complete, well-formed directive.
 *
 * Well-formed on purpose and in every arm: a body that failed `JSON.parse` would be
 * refused at 400, which is a **different** early return and would make this file a test
 * of malformed input rather than of a correctly refused write. The body is a few hundred
 * bytes, far under `MAX_ADMISSION_BODY_BYTES` (8 192), so no arm here reaches the 413
 * return either.
 */
async function postAdmission(
  directive: Partial<AdmissionDirective>,
  key: string | null,
): Promise<WriteResult> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (key !== null) headers[ADMISSION_KEY_HEADER] = key
  const response = await fetch(`http://${HOST}:${String(PORT)}/admission`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      region: REGION,
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

async function waitForReady(timeoutMs: number): Promise<SelfReport> {
  const deadline = Date.now() + timeoutMs
  let last = 'never answered'
  while (Date.now() < deadline) {
    try {
      const report = await readSelf()
      if (report.status === 200 && report.peerId.length > 0) return report
      last = `answered ${String(report.status)}`
    } catch (cause) {
      last = String(cause)
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error(
    `workerd on ${String(PORT)} did not become ready within ${String(timeoutMs)} ms: ${last}\n` +
      `workerd stderr:\n${transcript()}`,
  )
}

/** The floor reading, taken once, before any write. Every later reading is compared to it. */
let floor: SelfReport

beforeAll(async () => {
  persistDir = await mkdtemp(join(tmpdir(), 'o2-refused-write-'))
  child = spawn(
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
      // `--var` MERGES with the file's `vars` rather than replacing them — measured
      // 2026-08-27 and recorded at `worker.ts`'s `O2_VERSION` docblock.
      '--var',
      `O2_REGION:${REGION}`,
      '--var',
      `O2_ADMISSION_KEY:${TEST_KEY}`,
    ],
    {
      cwd: PACKAGE_DIR,
      env: { ...process.env, CLOUDFLARE_API_TOKEN: '', WRANGLER_SEND_METRICS: 'false' },
      // **The one thing this file does differently from every other workerd spec here.**
      // See the docblock: the dangling-stream TypeError exists only on this stream.
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
    stderrLog.push(text)
    if (text.includes('ERROR') || text.includes('TypeError')) {
      process.stdout.write(`[workerd ${REGION}] ${text}`)
    }
  })

  floor = await waitForReady(120_000)
}, 400_000)

afterAll(async () => {
  process.stdout.write(
    `[RUN-02 refused write] workerd stderr, ${String(stderrLog.join('').length)} bytes:\n` +
      `${transcript()}\n`,
  )
  try {
    if (child?.pid !== undefined) {
      try {
        process.kill(-child.pid, 'SIGTERM')
      } catch {
        child.kill('SIGTERM')
      }
    }
  } finally {
    if (persistDir !== undefined) await rm(persistDir, { recursive: true, force: true }).catch(() => {})
  }
}, 120_000)

describe('a correctly refused write leaves the object answering', () => {
  it('reads a floor: this object serves its region, is admitting, and answers 200', () => {
    // The positive control. Every case below asserts "still 200 and the same instance";
    // all of them would pass against an object that had been broken from the start if
    // nothing established that it ever worked.
    expect(floor.status).toBe(200)
    expect(floor.admission?.region).toBe(REGION)
    expect(floor.admission?.halted).toBe(false)
    expect(floor.instance.length).toBeGreaterThan(0)
    expect(floor.peerId.length).toBeGreaterThan(0)
  })

  it('survives two writes addressed to a region it does not serve', async () => {
    // The shape an operator tool written for a global switch produces: one command fanned
    // out to every endpoint. Each is a complete directive with the right key — refused for
    // exactly one reason, that it names somebody else's region.
    const first = await postAdmission(
      { region: OTHER_REGION, halted: true, since: Date.now(), note: 'fan-out, first' },
      TEST_KEY,
    )
    const second = await postAdmission(
      { region: OTHER_REGION, halted: true, since: Date.now(), note: 'fan-out, second' },
      TEST_KEY,
    )

    // Asserted first: a write that was ACCEPTED would make the reading below pass for the
    // wrong reason, and a 400 would mean this arm sent malformed input rather than a
    // legitimate write.
    expect(first.status, `first mis-addressed write: ${first.body}`).toBe(409)
    expect(second.status, `second mis-addressed write: ${second.body}`).toBe(409)
    // Both region names, as independent literals rather than read off the response.
    expect(first.body).toContain(OTHER_REGION)
    expect(first.body).toContain(REGION)

    const after = await readSelf()
    expect(
      after.status,
      `two correctly refused writes took the status reading offline. ` +
        `workerd stderr:\n${transcript()}`,
    ).toBe(200)
    expect(
      after.instance,
      'the object was reconstructed between the floor and this reading, so "it still ' +
        'answers" is about a different object. Re-take the reading; do not subtract it.',
    ).toBe(floor.instance)
    // And the refusals were refusals: nothing moved.
    expect(after.admission?.halted).toBe(false)
    expect(after.admission?.note).toBe(floor.admission?.note)
  }, 60_000)

  it('survives two writes carrying a body and no usable key — the arm the plant lives on', async () => {
    // **This is the case that goes red when `authoriseWrite` moves back above
    // `await request.text()`.** Both POSTs carry a complete JSON body that the method
    // never reads under that ordering, and it is the unread stream that poisons the
    // instance. Two, not one, because the recorded failure was *"an unauthenticated
    // caller could take a region's status offline by sending two POSTs it was correctly
    // refused"* — and the second is the one whose reply the first refusal's dangling
    // stream lands on.
    const noKey = await postAdmission(
      { halted: true, since: Date.now(), note: 'a stranger, with no key' },
      null,
    )
    const wrongKey = await postAdmission(
      { halted: true, since: Date.now(), note: 'a stranger, with the wrong key' },
      WRONG_KEY,
    )

    expect(noKey.status, `write with no key: ${noKey.body}`).toBe(401)
    expect(wrongKey.status, `write with the wrong key: ${wrongKey.body}`).toBe(401)

    const after = await readSelf()
    expect(
      after.status,
      'two POSTs this object correctly refused with 401 took its status reading offline — ' +
        'the request stream was left dangling by a refusal that answered before reading ' +
        'the body. This is the exact defect `worker.ts` records at `#writeAdmission`. ' +
        `workerd stderr:\n${transcript()}`,
    ).toBe(200)
    expect(
      after.instance,
      'the object was reconstructed after the refusals, so a 200 here is a fresh instance ' +
        'rather than a surviving one.',
    ).toBe(floor.instance)
    expect(after.admission?.halted, 'a refused write moved the directive anyway').toBe(false)
    expect(after.admission?.region).toBe(REGION)
  }, 60_000)

  it('still answers after both arms together, from the same instance', async () => {
    // The whole sequence's residue, read once more. Four refusals have now reached this
    // object across two arms; a defect that needed more than two to surface shows up here.
    const after = await readSelf()
    expect(after.status, `after four refused writes. workerd stderr:\n${transcript()}`).toBe(200)
    expect(after.instance).toBe(floor.instance)
    expect(after.peerId).toBe(floor.peerId)
    expect(after.admission?.halted).toBe(false)

    // Printed rather than only asserted, on `[RUN-02 slice]`'s precedent: the survival
    // claim is a pair of readings and a reader of the run should see both.
    process.stdout.write(
      `[RUN-02 refused write] instance floor=${floor.instance} after=${after.instance}; ` +
        `four refusals, /self still ${String(after.status)}\n`,
    )
  }, 60_000)
})
