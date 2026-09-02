/**
 * Criterion 4 — what the funnel's store actually holds, read off the disk it holds it on.
 *
 * *"Telemetry is aggregate-only and raw IP is discarded at collection: a dump of everything
 * stored contains no IP address and no cross-session identifier, **checked against the store
 * rather than against the collector's intent**."*
 *
 * ## The instrument, and why it is not a route
 *
 * `--persist-to` puts the Durable Object's whole storage in a SQLite file. This spec reads that
 * file directly and scans **every row of `_cf_KV`** — every key the object holds, with its raw
 * stored bytes. That is strictly wider than `queryKeys({})`, which is the instrument criterion 4
 * names: `DoDatastore._allKeys` skips keys whose value is not bytes and keys that do not
 * round-trip through `Key`, so a value hidden under either would be invisible to it and is not
 * invisible here.
 *
 * It also adds **no production surface**. A `GET /funnel?dump=1` would have been a capability
 * shipped for a test to read, and this phase's own header amendment argues against exactly that.
 *
 * The bytes are scanned raw rather than decoded first. Miniflare wraps a stored `Uint8Array` in
 * a V8 serialisation envelope, so a decode step is a place a value could be lost; a scan over
 * the bytes cannot skip anything it does not understand.
 *
 * ## The positive control, in two halves, because an absence needs one
 *
 * MEMORY, and this repository has nearly closed a criterion on an empty read before.
 *
 * **The live half needs no plant.** `request.cf` on a local `wrangler dev` is populated from
 * this machine's real public address — measured 2026-09-02, thirty-three properties including
 * `city`, `postalCode`, `latitude`, `longitude` and `asOrganization`. So every request in this
 * spec puts a street-level location derived from the client address inside the handler. The
 * store afterwards contains the two-letter country and none of the rest: the thing that must
 * be absent was demonstrably present, at a resolution far past the IP address the criterion
 * names, and the store shows what survived.
 *
 * **The planted half is in the SUMMARY.** Making the collector store the address turns case 4
 * red naming the key and the value; making it store a per-visit handle turns the same case red
 * naming the field. Both were watched.
 *
 * ## Two absences, two cases, and neither is redundant
 *
 * Criterion 4 forbids two different things and they fail differently. **Case 4 catches a
 * per-visit FIELD** — an identifier written inside the one journal value. **Case 5 catches a
 * per-visit KEY** — a row appearing per visit. Under a one-key journal, an identifier written
 * inside the value adds no key, so case 5 cannot see it and would stay green; a key that
 * appears per visit carries no forbidden substring, so case 4 would stay green. Do not delete
 * either as a restatement of the other.
 *
 * ## Scope
 *
 * Local `workerd` only. `CLOUDFLARE_API_TOKEN` blanked, `WRANGLER_SEND_METRICS` off,
 * `--persist-to` a fresh `mkdtemp` that is removed afterwards. Nothing is deployed and no
 * remote resource is created.
 */

import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { FUNNEL_SCHEMA_DIGEST } from '@o2/net'
import { CLIENT_ADDRESS_HEADER } from './websocket-connection.ts'
import { CLIENT_COUNTRY_HEADER } from './funnel-collector.ts'

const PACKAGE_DIR = fileURLToPath(new URL('..', import.meta.url))
const HOST = '127.0.0.1'
/** Its own port. Every other e2e spec in this package holds one of 8791-8795. */
const PORT = 8798
const ORIGIN = `http://${HOST}:${String(PORT)}`

/**
 * A client address this arrangement SENDS, so its absence from the store is an absence of a
 * value that was demonstrably at the door.
 *
 * `inbound-listener.e2e.test.ts:275-340` records the measurement this rests on: a local workerd
 * stamps `CF-Connecting-IP: 127.0.0.1` on its own, **and passes an explicitly-sent one
 * through**. That case was written first as *"send no header, expect a refusal"* and failed
 * because one arrived anyway. Sending a distinctive one means the scan below is looking for a
 * value nothing else in the arrangement could produce.
 *
 * From `192.0.2.0/24`, which RFC 5737 reserves for documentation, so it can never be anyone's.
 */
const SENT_CLIENT_ADDRESS = '192.0.2.199'

let worker: ChildProcess | undefined
let persistDir: string

async function waitForReady(timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  let lastError: unknown
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${ORIGIN}/self`, { signal: AbortSignal.timeout(3000) })
      if (response.ok) return
      lastError = new Error(`/self answered ${String(response.status)}`)
    } catch (cause) {
      lastError = cause
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error(`workerd did not become ready within ${String(timeoutMs)} ms: ${String(lastError)}`)
}

interface StoredRow {
  readonly key: string
  readonly bytes: Buffer
}

/**
 * Every row the object's storage holds, straight off the persisted SQLite file.
 *
 * Read `immutable=1` and read-only, so this cannot perturb the store it is measuring. The
 * `-wal` file is checkpointed by opening the database normally first; without that a value
 * written moments ago can be in the write-ahead log and invisible to an immutable read, which
 * would make every absence below an absence in a file nothing had been written to yet.
 */
function dumpStore(): StoredRow[] {
  const objectDir = join(persistDir, 'v3', 'do', 'o2-bootstrap-BootstrapObject')
  const files = readdirSync(objectDir).filter(
    (name) => name.endsWith('.sqlite') && name !== 'metadata.sqlite',
  )
  const rows: StoredRow[] = []
  for (const file of files) {
    const db = new DatabaseSync(join(objectDir, file), { readOnly: true })
    for (const row of db.prepare('select key, value from _cf_KV').all()) {
      const record = row as { key: unknown; value: unknown }
      // **`node:sqlite` hands a BLOB back as a `Uint8Array`, NOT as a `Buffer`, and reading
      // that wrongly is how this instrument first failed.** The original line tested
      // `Buffer.isBuffer(value)` and fell back to `Buffer.from(String(value))`, which renders a
      // `Uint8Array` as the comma-separated decimal string `255,15,66,123,...`. Every scan
      // below then searched that rendering and found nothing — and the plant that stores the
      // client address in the record was watched staying GREEN because of it, with
      // `"plantedClientAddress":"192.0.2.199"` sitting in the file the whole time. A decode
      // step is a place a value can be lost, and this one lost all of them.
      rows.push({
        key: String(record.key),
        bytes:
          record.value instanceof Uint8Array
            ? Buffer.from(record.value.buffer, record.value.byteOffset, record.value.byteLength)
            : Buffer.from(String(record.value), 'utf8'),
      })
    }
    db.close()
  }
  return rows
}

/**
 * The funnel record's own JSON, decoded out of its miniflare envelope.
 *
 * Miniflare wraps a stored `Uint8Array` in a V8 serialisation header, so the JSON starts at the
 * first `{` and ends at the last `}`. Sliced rather than deserialised properly, because the
 * only thing this needs is the text the object actually wrote, and a real deserialiser would be
 * a second place a field could be dropped between the store and the assertion.
 */
function funnelRecord(): Record<string, unknown> {
  const row = dumpStore().find((one) => one.key === '/journal/funnel')
  if (row === undefined) throw new Error('the store holds no /journal/funnel key')
  const text = row.bytes.toString('latin1')
  return JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)) as Record<
    string,
    unknown
  >
}

/** Everything the store holds, as one string, for a scan that cannot skip a row. */
function dumpAsText(): string {
  return dumpStore()
    .map((row) => `${row.key}=${row.bytes.toString('latin1')}`)
    .join('\n')
}

async function report(body: Record<string, unknown>, extra: Record<string, string> = {}): Promise<number> {
  const response = await fetch(`${ORIGIN}/funnel`, {
    method: 'POST',
    // `text/plain` — CORS-safelisted, which is what makes `navigator.sendBeacon` work from a
    // page that is already unloading. See `worker.ts`'s `#bankFunnel`.
    headers: { 'Content-Type': 'text/plain', [CLIENT_ADDRESS_HEADER]: SENT_CLIENT_ADDRESS, ...extra },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  })
  return response.status
}

async function readFunnel(): Promise<Record<string, never> & { entered: Record<string, number> }> {
  const response = await fetch(`${ORIGIN}/funnel`, { signal: AbortSignal.timeout(10_000) })
  return (await response.json()) as never
}

beforeAll(async () => {
  persistDir = mkdtempSync(join(tmpdir(), 'o2-funnel-collector-'))
  worker = spawn(
    'npx',
    [
      'wrangler',
      'dev',
      '--port',
      String(PORT),
      '--local-protocol',
      'http',
      // **Not optional here, and its absence is a standing finding.** Without it the object's
      // storage goes to a default location shared with every other local run, and this spec's
      // whole claim is about what one arrangement's store holds.
      '--persist-to',
      persistDir,
    ],
    {
      cwd: PACKAGE_DIR,
      env: { ...process.env, CLOUDFLARE_API_TOKEN: '', WRANGLER_SEND_METRICS: 'false' },
      stdio: 'ignore',
    },
  )
  await waitForReady(120_000)
}, 150_000)

afterAll(() => {
  worker?.kill('SIGTERM')
  if (persistDir !== undefined) rmSync(persistDir, { recursive: true, force: true })
})

describe('RUN-04 — the funnel counts on a real workerd', () => {
  it('the floor: a fresh object answers six honest zeros', async () => {
    const before = await readFunnel()
    // Six literals. Without this every absence below is an absence in an empty store.
    expect(before.entered).toEqual({
      'page-load': 0,
      consent: 0,
      'wss-bootstrap': 0,
      'ice-gathering': 0,
      'connection-classified': 0,
      'first-task': 0,
    })
    expect((before as unknown as { schemaDigest: string }).schemaDigest).toBe(FUNNEL_SCHEMA_DIGEST)
  })

  it('takes reports across stages and moves the counts', async () => {
    expect(
      await report({
        stage: 'page-load',
        kind: 'entered',
        hourBucket: 9,
        population: 'opted-in-only', networkClass: 'cellular',
      }),
    ).toBe(204)
    expect(
      await report(
        {
          stage: 'ice-gathering',
          kind: 'entered',
          hourBucket: 9,
          population: 'opted-in-only', networkClass: 'cellular',
        },
        { [CLIENT_COUNTRY_HEADER]: 'DE' },
      ),
    ).toBe(204)
    expect(
      await report({
        stage: 'wss-bootstrap',
        kind: 'stalled',
        hourBucket: 9,
        population: 'opted-in-only', networkClass: 'cellular',
      }),
    ).toBe(204)

    const after = await readFunnel()
    // The second floor, and the one that makes the absences below mean something: a store that
    // never accepted a write cannot be shown to hold no address.
    expect(after.entered['page-load']).toBe(1)
    expect(after.entered['ice-gathering']).toBe(1)
    expect((after as unknown as { stalledAt: Record<string, number> }).stalledAt['wss-bootstrap']).toBe(1)
  })

  it('refuses a report the schema does not admit, and stores nothing for it', async () => {
    expect(await report({ stage: 'ice-gathered', kind: 'entered', hourBucket: 9, population: 'opted-in-only', networkClass: 'cellular' })).toBe(400)
    expect(await report({ stage: 'page-load', kind: 'entered', hourBucket: 99, population: 'opted-in-only', networkClass: 'cellular' })).toBe(400)
    // Still one page-load, not two: a refused report is not a stored one.
    expect((await readFunnel()).entered['page-load']).toBe(1)
  })
})

describe('criterion 4 — the dump, checked against the store and not against the intent', () => {
  /**
   * **This case was written first asserting only that SOME country cell existed, and that
   * version tested nothing it claimed.** The `ice-gathering` report above supplies
   * `CF-IPCountry: DE` explicitly, so its cell proves a header was read and says nothing about
   * anything derived from the address. The report below deliberately supplies NO country, so
   * the only place its country can come from is `request.cf` — which the platform populates
   * from the client address, measured verbatim in `funnel-collector.test.ts`.
   */
  it('POSITIVE CONTROL: something derived from the client address DID reach the store', async () => {
    const before = (await readFunnel()) as unknown as { webrtcAttempts: Record<string, number> }
    // No country header, so the country can only come from `request.cf`.
    expect(
      await report(
        {
          stage: 'ice-gathering',
          kind: 'entered',
          hourBucket: 9,
          population: 'opted-in-only',
          // `wifi` is used here and nowhere else in this file, so the cell this produces
          // cannot be confused with one an earlier report made.
          networkClass: 'wifi',
        },
        {},
      ),
    ).toBe(204)
    const after = (await readFunnel()) as unknown as { webrtcAttempts: Record<string, number> }

    const arrived = Object.keys(after.webrtcAttempts).filter((cell) => !(cell in before.webrtcAttempts))
    expect(arrived.length, 'the report that supplied no country produced no cell at all').toBe(1)
    const [country] = (arrived[0] ?? '').split('|')
    // **Compared within this run rather than against a literal**, because the answer is this
    // host's own location and writing it down would encode this machine. What is asserted is
    // that it is a REAL country and not the "we were not told" value — which is only possible
    // if the platform's address-derived record reached the handler.
    expect(
      country,
      'the country came back as ZZ, so nothing derived from the client address reached the ' +
        'store on this run and every absence in the next case is vacuous',
    ).not.toBe('ZZ')
    expect(country).toMatch(/^[A-Z]{2}$/)

    // And the store is not empty, which is the other half of the same floor.
    expect(
      dumpAsText(),
      'the store holds no funnel record at all, so every absence below is vacuous',
    ).toContain('/journal/funnel')
  })

  it('holds no IP address and no cross-session identifier — every key, every byte', () => {
    const rows = dumpStore()
    const keys = rows.map((row) => row.key)
    const dump = dumpAsText()
    const where = `keys held: ${keys.join(', ')}`

    // The address this arrangement SENT, which workerd passes through to the handler.
    expect(dump, `the client address is in the store. ${where}`).not.toContain(SENT_CLIENT_ADDRESS)
    // And the one workerd stamps on its own.
    expect(dump, `the loopback client address is in the store. ${where}`).not.toContain('127.0.0.1')

    // Any IPv4 dotted quad at all, and any IPv6 form.
    const ipv4 = /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/
    const ipv6 = /\b(?:[0-9a-fA-F]{1,4}:){2,}[0-9a-fA-F]{0,4}\b/
    expect(ipv4.exec(dump)?.[0] ?? null, `an IPv4 address is in the store. ${where}`).toBeNull()
    expect(ipv6.exec(dump)?.[0] ?? null, `an IPv6 address is in the store. ${where}`).toBeNull()

    // The finer half of the platform's geolocation record — present in the handler on every
    // request, absent here. This is what the two-letter rule is FOR.
    for (const finer of ['San Jose', 'California', 'Los_Angeles', 'Zoox']) {
      expect(dump, `${finer} is in the store. ${where}`).not.toContain(finer)
    }

    // A cross-session identifier: any run of >= 16 hex or >= 22 base64url characters, inside
    // the FUNNEL's own value. The identity seed is a different key with its own phase and its
    // own disclosure line, and is excluded by KEY rather than by narrowing the pattern.
    const funnelRows = rows.filter((row) => row.key === '/journal/funnel')
    expect(funnelRows.length, `no funnel record found. ${where}`).toBe(1)
    const record = funnelRecord()

    // **`schemaDigest` is excluded BY NAME and the reason is not that it is inconvenient.** It
    // is sixteen hex characters, so it matches the pattern; it is also a hand-written literal
    // in `funnel-schema.ts` that is identical in every record every object ever writes, which
    // is the exact opposite of a per-visit value. Excluding it by name leaves the pattern able
    // to catch anything else of that shape; widening the pattern to let it through would have
    // blinded the scan to a real handle of the same width.
    const { schemaDigest, ...visitorFields } = record
    expect(schemaDigest, 'the record carries no schema digest, so the floor below is false').toBe(
      FUNNEL_SCHEMA_DIGEST,
    )
    const scanned = JSON.stringify(visitorFields)

    // THE FLOOR, and it is here because this scan was measured passing over nothing. Before the
    // BLOB decoding was repaired the value rendered as `255,15,66,...` and every pattern below
    // matched none of it — a green that said only that the reader was broken.
    expect(scanned, `the scanned text holds no counters at all. ${where}`).toContain('entered')
    expect(scanned.length, `the scanned text is too short to hold anything. ${where}`).toBeGreaterThan(200)

    const handleLike = /[0-9a-fA-F]{16,}|[A-Za-z0-9_-]{22,}/
    expect(
      handleLike.exec(scanned)?.[0] ?? null,
      `an identifier-shaped run is in the funnel record. ${where}`,
    ).toBeNull()
    // And the consent record's own shape, which would be a visitor identifier if it appeared.
    expect(scanned, `a consent-shaped key is in the funnel record. ${where}`).not.toContain('o2:consent')
  })

  it('two correlatable visits add NO new key — the per-visit key, which case 4 cannot see', async () => {
    const before = dumpStore().map((row) => row.key).sort()
    // Same country, same class, same hour, different stages: exactly what a naive
    // implementation would want a handle to join up.
    await report(
      { stage: 'consent', kind: 'entered', hourBucket: 9, population: 'opted-in-only' },
      { [CLIENT_COUNTRY_HEADER]: 'DE' },
    )
    await report(
      {
        stage: 'connection-classified',
        kind: 'entered',
        hourBucket: 9,
        population: 'opted-in-only',
        connectionClass: 'relayed',
      },
      { [CLIENT_COUNTRY_HEADER]: 'DE' },
    )
    const after = dumpStore().map((row) => row.key).sort()
    expect(
      after,
      `the store gained a key between two visits: ${after.filter((key) => !before.includes(key)).join(', ')}`,
    ).toEqual(before)
  })
})
