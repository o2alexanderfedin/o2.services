/**
 * Criterion 1's negative proof, taken by a LOCAL RUNTIME — and the reading, put in the tree as
 * an assertion, of why that runtime cannot carry the proof at all. `jurisdiction-closed.node.test.ts`
 * (this plan's other half) takes the proof at the compiler; this file records what happens if a
 * later agent tries to take it here instead, so nobody has to re-discover it by hand.
 *
 * ## What is measured, and why the runtime is a blind instrument for this specific question
 *
 * Measured 2026-09-13 against a throwaway worker on a local `wrangler dev`:
 * `namespace.jurisdiction(v)` throws the SAME message for every `v` — the permitted values and
 * the hint value alike, byte-identical. A local arm that "watched `sam` fail" would therefore be
 * reporting a property of the RUNTIME (it has not implemented jurisdiction restrictions at all)
 * and not of the VALUE, which is exactly the kind of blind instrument this project has already
 * recorded catching twelve of in one run. So this file does not attempt criterion 1's negative
 * proof — it records the measurement that rules the attempt out, as an executable assertion
 * rather than a docblock, so a future workerd release that starts implementing jurisdictions
 * reddens here instead of silently making a comment false.
 *
 * ## The subject is a throwaway worker, never this repository's own worker
 *
 * `worker.ts` states that a route added there is a capability shipped by a phase; this is a
 * measurement of the PLATFORM, not a capability of the node, so it gets its own scratch worker
 * with one Durable Object class and a `fetch` that reports what two platform calls did rather
 * than doing anything a real node needs.
 *
 * ## The scratch object sites with a fresh, unique id — never a name-derived one
 *
 * `packages/node/src/hosted-tier-deploy.node.test.ts:198-215` pins the set of tracked `.ts`
 * files that so much as name the platform call that derives a stable id from a string — string
 * literals included — to exactly two: `hosted-object.ts` and `hosted-identity.test.ts`. This
 * file is a tracked `.ts` file, and plans 33-01 and 33-02 have both committed to that list
 * staying at two. Nothing measured here needs a stable name, only a stub, so a fresh unique id
 * per request is sufficient and this file never spells the identifier that would grow that
 * list to three.
 *
 * ## Loopback only, nothing deployed, nothing created in the account
 *
 * `hermetic-fixtures.node.test.ts` holds the rule that a spec must not dial a real external
 * endpoint — a node-lane spec broke it once this week by dialling a live provider on every run,
 * and being outcome-stable it could never redden. This file dials `127.0.0.1` and nothing else,
 * with `CLOUDFLARE_API_TOKEN: ''` so even a misconfigured wrangler invocation has no credential
 * to reach the account with.
 *
 * Purpose: `HOST-06`. The live at-creation refusal from Cloudflare's own API is `waits on owner
 * act 2` and is not claimed here or anywhere in this plan.
 */

import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { HOSTED_JURISDICTION, HOSTED_LOCATION_HINT } from './hosted-object.ts'

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const WRANGLER_BIN = join(REPO_ROOT, 'node_modules/.bin/wrangler')

const HOST = '127.0.0.1'
/**
 * **8835.** `.planning/phases/33-three-regions-and-a-relay-killed-on-purpose/33-CONTEXT.md`
 * names 8794, 8801-8803, 8814, 8816, 8818, 8819 as taken; this plan's own PLAN.md widens that
 * to 8791-8798, 8801-8810, 8814-8820, 8822-8826. Re-verified at write time, 2026-09-13: a grep
 * for every four-digit `8xxx` literal across every package's `src` directory lists 8826 below
 * and 8836 above as the nearest neighbours, with 8835 itself absent from that output.
 */
const PORT = 8835

/** What the scratch Durable Object's `fetch` always answers on success — never a place name. */
const FIXED_RESPONSE = 'scratch-durable-object-fixed-response'

/**
 * The platform's own refusal text, typed exactly ONCE in this file. Every other case compares
 * two OBSERVED strings against each other rather than re-typing this literal, so a
 * copy-paste-off-by-one-character mistake cannot silently compare the literal to itself.
 */
const EXPECTED_REFUSAL = 'Jurisdiction restrictions are not implemented in workerd.'

/**
 * The scratch worker's entry module, written to the `mkdtemp` directory rather than imported —
 * see the header docblock for why this cannot be a route on this repository's own `worker.ts`.
 *
 * One fetch handler, three query-driven modes:
 *   - `?jurisdiction=<v>` — attempts `env.BOOTSTRAP.jurisdiction(v)`, catches, reports the
 *     thrown error's `name`/`message` as JSON. Never actually reaches a `.get(` call: the
 *     measured fact is that this throws before anything is sited.
 *   - `?hint=<v>` — attempts `env.BOOTSTRAP.get(id, { locationHint: v })` with a fresh unique
 *     id, forwards the ORIGINAL incoming request to the resulting stub on success (so the
 *     caller reads back {@link FIXED_RESPONSE}), reports a thrown error as JSON on failure.
 *   - no query at all — the positive control: obtains a stub with no options, forwarded the
 *     same way. Without this arm every other reading is equally satisfied by a worker that
 *     fails on everything.
 *
 * Every forward passes the WORKER's own incoming `Request` straight to `stub.fetch(request)`,
 * the same shape `worker.ts:1390` already uses — a stub's `fetch` is a platform-internal call
 * routed to the object, never a real network dial, so no fabricated URL string is needed or
 * used anywhere in this file.
 */
function scratchWorkerSource(): string {
  return `
interface BootstrapNamespace {
  jurisdiction: (jurisdiction: string) => unknown
  newUniqueId: () => unknown
  get: (id: unknown, options?: { locationHint: string }) => { fetch: (input: string) => Promise<Response> }
}

interface Env {
  readonly BOOTSTRAP: BootstrapNamespace
}

export class ScratchObject {
  constructor(_ctx: unknown, _env: unknown) {}
  async fetch(_request: Request): Promise<Response> {
    return new Response(${JSON.stringify(FIXED_RESPONSE)})
  }
}

function describeError(cause: unknown): { name: string; message: string } {
  return cause instanceof Error
    ? { name: cause.name, message: cause.message }
    : { name: 'UnknownThrow', message: String(cause) }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const jurisdictionValue = url.searchParams.get('jurisdiction')
    const hintValue = url.searchParams.get('hint')

    if (jurisdictionValue !== null) {
      try {
        env.BOOTSTRAP.jurisdiction(jurisdictionValue)
        return Response.json({ ok: true })
      } catch (cause) {
        return Response.json({ ok: false, ...describeError(cause) })
      }
    }

    if (hintValue !== null) {
      try {
        const id = env.BOOTSTRAP.newUniqueId()
        const stub = env.BOOTSTRAP.get(id, { locationHint: hintValue })
        return await stub.fetch(request)
      } catch (cause) {
        return Response.json({ ok: false, ...describeError(cause) })
      }
    }

    const id = env.BOOTSTRAP.newUniqueId()
    const stub = env.BOOTSTRAP.get(id)
    return await stub.fetch(request)
  },
}
`
}

function scratchWranglerConfig(): string {
  return JSON.stringify(
    {
      name: 'o2-placement-runtime-scratch',
      main: 'worker.ts',
      compatibility_date: '2026-08-25',
      durable_objects: {
        bindings: [{ name: 'BOOTSTRAP', class_name: 'ScratchObject' }],
      },
      migrations: [{ tag: 'v1', new_sqlite_classes: ['ScratchObject'] }],
      send_metrics: false,
    },
    null,
    2,
  )
}

let scratchDir = ''
let persistDir = ''
let child: ChildProcess | null = null

async function readScratch(query: string): Promise<{ status: number; text: string }> {
  const response = await fetch(`http://${HOST}:${String(PORT)}/${query}`, {
    signal: AbortSignal.timeout(5_000),
  })
  return { status: response.status, text: await response.text() }
}

interface ThrownReading {
  readonly name: string
  readonly message: string
}

async function askJurisdiction(value: string): Promise<ThrownReading> {
  const { text } = await readScratch(`?jurisdiction=${encodeURIComponent(value)}`)
  const body: unknown = JSON.parse(text)
  if (
    typeof body !== 'object' ||
    body === null ||
    !('name' in body) ||
    !('message' in body) ||
    typeof body.name !== 'string' ||
    typeof body.message !== 'string'
  ) {
    throw new Error(`unexpected jurisdiction reading: ${text}`)
  }
  return { name: body.name, message: body.message }
}

async function askHint(value: string): Promise<string> {
  const { text } = await readScratch(`?hint=${encodeURIComponent(value)}`)
  return text
}

async function askControl(): Promise<string> {
  const { text } = await readScratch('')
  return text
}

async function waitForReady(timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  let lastError: unknown
  while (Date.now() < deadline) {
    try {
      const { status, text } = await readScratch('')
      if (status === 200 && text === FIXED_RESPONSE) return
      lastError = new Error(`unexpected readiness reading: ${String(status)} ${text}`)
    } catch (cause) {
      lastError = cause
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error(`scratch worker on ${String(PORT)} did not become ready within ${String(timeoutMs)} ms: ${String(lastError)}`)
}

beforeAll(async () => {
  scratchDir = await mkdtemp(join(tmpdir(), 'o2-placement-runtime-'))
  persistDir = await mkdtemp(join(tmpdir(), 'o2-placement-runtime-persist-'))
  await writeFile(join(scratchDir, 'worker.ts'), scratchWorkerSource())
  await writeFile(join(scratchDir, 'wrangler.jsonc'), scratchWranglerConfig())

  // `npx` from a temp directory does not resolve a local `wrangler` — spawned by absolute
  // path instead, with `cwd` set to the scratch directory so wrangler's own config discovery
  // finds THIS `wrangler.jsonc` rather than the repository's.
  child = spawn(
    WRANGLER_BIN,
    ['dev', '--port', String(PORT), '--local-protocol', 'http', '--persist-to', persistDir],
    {
      cwd: scratchDir,
      env: { ...process.env, CLOUDFLARE_API_TOKEN: '', WRANGLER_SEND_METRICS: 'false' },
      stdio: 'ignore',
    },
  )

  await waitForReady(120_000)
}, 150_000)

afterAll(async () => {
  try {
    child?.kill('SIGTERM')
  } finally {
    await rm(scratchDir, { recursive: true, force: true }).catch(() => {})
    await rm(persistDir, { recursive: true, force: true }).catch(() => {})
  }
}, 60_000)

describe('a local runtime refuses every jurisdiction value identically, and validates no hint at all', () => {
  it('refuses the permitted jurisdiction value, with the platform’s own exact message', async () => {
    const reading = await askJurisdiction(HOSTED_JURISDICTION.eu)
    expect(reading.message).toBe(EXPECTED_REFUSAL)
  })

  it('refuses the hint value with the SAME message as the permitted value — compared, not re-typed', async () => {
    const permitted = await askJurisdiction(HOSTED_JURISDICTION.eu)
    const hint = await askJurisdiction(HOSTED_LOCATION_HINT.sam)
    // Two OBSERVED strings, compared to each other. Never `toBe(EXPECTED_REFUSAL)` a second
    // time — that would prove the platform is consistent with a literal, not that it treats
    // the two VALUES identically.
    expect(hint.message).toBe(permitted.message)
  })

  it('cannot distinguish the two — which is why criterion 1 is taken at the compiler, not here', async () => {
    // The whole conclusion of this file, asserted rather than left in prose:
    // `jurisdiction-closed.node.test.ts` takes criterion 1's negative proof at `tsc`, where a
    // permitted value and the hint value produce DIFFERENT outcomes. Cloudflare's own API
    // during owner act 2 is the live half. Neither is this file — this file is the reading
    // that says why a LOCAL runtime arm would prove nothing.
    const permitted = await askJurisdiction(HOSTED_JURISDICTION.eu)
    const hint = await askJurisdiction(HOSTED_LOCATION_HINT.sam)
    expect(hint.message).toBe(permitted.message)
    expect(hint.name).toBe(permitted.name)
  })

  it('the positive control: asking for no jurisdiction at all reaches a live object', async () => {
    // Without this the three readings above are equally satisfied by a worker that fails on
    // everything — this is what proves the harness reads a WORKING object.
    const body = await askControl()
    expect(body).toBe(FIXED_RESPONSE)
  })

  it('the declared hint is unvalidated by the platform — a live object, no error', async () => {
    const body = await askHint(HOSTED_LOCATION_HINT.sam)
    expect(body).toBe(FIXED_RESPONSE)
  })

  it('an UNDECLARED hint is equally unvalidated — the platform checks nothing, only this fabric’s own closed set does', async () => {
    // `not-a-declared-hint`, deliberately not a place name: the platform's own permissiveness
    // is the reading, and this is why `HOSTED_LOCATION_HINT` exists at all — the closed set
    // in source is the only refusal of a mistyped hint anywhere in this system.
    const body = await askHint('not-a-declared-hint')
    expect(body).toBe(FIXED_RESPONSE)
  })
})
