/**
 * AUTH-07 criterion 4, measured against a real `workerd` and the SQLite file it actually
 * writes — **the hosted tier's seed is sealed under a platform secret, and the object's own
 * storage no longer contains the raw seed.**
 *
 * ## Why this file exists beside `hosted-seed-sealed.node.test.ts`
 *
 * That file measures the behaviour in-process against `FakeDurableObjectStorage` and is where
 * the plants were watched red. It cannot answer three things, and all three are the ones an
 * owner would ask before deploying:
 *
 * 1. **Does the Argon2id derivation run on workerd at all?** `@noble/hashes`' Argon2id
 *    allocates ~19 MiB and is pure JS, and nothing about Node proves anything about the
 *    Cloudflare runtime. A `/self` that answers with a PeerId is that proof, because the PeerId
 *    can only come from opening the envelope.
 * 2. **Is the seed absent from the artefact on disk**, rather than from a JavaScript object
 *    that models it? The at-rest question is about bytes in a file, and this reads them.
 * 3. **Does the deployed object survive the migration?** The object at
 *    `o2-bootstrap.af-4a0.workers.dev` has answered on one PeerId since 2026-08-27 and its
 *    storage holds a raw seed. The reading that says it survives is: plant a known raw seed
 *    into a real Durable Object store, boot, and get back the PeerId that seed implies.
 *
 * ## The claim's limit, restated because this file must not outrun it
 *
 * A Durable Object cannot keep a secret from its own operator. Nothing here claims otherwise.
 * What is measured is a move between compromise domains — from *whoever can read this object's
 * storage* to *whoever holds the Cloudflare account*.
 *
 * ## Local only. Nothing here deploys, and nothing here touches the live account
 *
 * `wrangler dev` with `--persist-to` into a fresh `mkdtemp` directory, `CLOUDFLARE_API_TOKEN`
 * blanked, on ports nothing else in this repository uses. The deployed object is never
 * contacted and no Cloudflare resource is created.
 *
 * ## Two instrument rules, both paid for by this repository
 *
 * **No byte is ever rendered through `String`** — `Buffer.from(String(u8))` produces the text
 * `255,15,66,…` and blinded an instrument here once already. Every search below is byte
 * against byte.
 *
 * **The absence carries a positive control in the same run**: the planted raw seed, found by
 * the very same scanner over the very same file, before the boot that removes it. An absence
 * with no positive control passes just as well on an empty store, and this repository has
 * closed a criterion on an empty read once already and had to reopen it.
 */

import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import { SEED_BYTES, identityFromSeed } from '@o2/libp2p'
import { openSecret } from '@o2/core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { HOSTED_IDENTITY_KEY, SEALED_HOSTED_IDENTITY_KEY } from './hosted-identity.ts'



/**
 * The identity secret this spec's local `wrangler dev` boots with — AUTH-07 criterion 4.
 *
 * Since that criterion the hosted object refuses to open its identity without
 * `O2_IDENTITY_SECRET` and answers `GET /self` with `500`, so every spec that polls `/self`
 * for readiness has to supply one. There is deliberately no default in production source — a
 * default is the empty-DEK defect one criterion over — and no value in `wrangler.jsonc`,
 * which is tracked.
 *
 * **Per-spec test data rather than a shared constant**, in the style of this tree's `TEST_KEY`
 * and `TURN_SECRET`: this spec passes its own `--persist-to`, so its Durable Object store is
 * its own and the value only has to be self-consistent across its own restarts. The one thing
 * that IS load bearing is the length — under twenty characters `assertUsablePassphrase`
 * refuses and every boot below fails with `WeakPassphraseError`.
 */
const SECRET = 'local-dev-identity-secret-42'

const PACKAGE_DIR = fileURLToPath(new URL('..', import.meta.url))
const HOST = '127.0.0.1'
/** Ports nothing else in this repository binds — the highest in use elsewhere is 8820. */
const SEALED_PORT = 8822
const UNCONFIGURED_PORT = 8823

/**
 * A seed nobody generated, so a match against it can only have come from this file.
 *
 * Fixed rather than random because it is planted into a store and then looked for in a file,
 * and a random one would make a failure impossible to reproduce from the report alone.
 */
const PLANTED_SEED = new Uint8Array(SEED_BYTES)
for (let i = 0; i < SEED_BYTES; i++) PLANTED_SEED[i] = (i * 11 + 5) & 0xff

/**
 * A `Uint8Array` in the exact V8 serialisation workerd's Durable Object storage writes.
 *
 * **Read off a real store rather than derived from a specification.** A row written by
 * `DoDatastore.put` of a 32-byte seed was dumped from
 * `packages/cloudflare/.wrangler/state/v3/do/…/<hash>.sqlite` on 2026-09-06 and is 41 bytes:
 * `ff 0f` (serializer version 15), `42` (`kArrayBuffer`) and a one-byte length, the payload,
 * then `56 42` (`kArrayBufferView`, `Uint8Array`), byte offset, byte length and a flags byte —
 * `5642002000` in the tail.
 *
 * **A wrong template cannot produce a false green.** workerd either fails to deserialise the
 * row — in which case the boot refuses and the case is red — or reads different bytes, in
 * which case the PeerId does not match the one `PLANTED_SEED` implies and the case is red. The
 * only way this passes is if the platform read back exactly what was planted.
 *
 * The single-byte length holds only below 128; {@link SEED_BYTES} is 32 and the assertion
 * below says so rather than leaving it to be discovered by a future width.
 */
function durableObjectBlobFor(bytes: Uint8Array): Uint8Array {
  if (bytes.length >= 0x80) throw new Error(`this template writes a one-byte length, so ${bytes.length} is out of range`)
  return Uint8Array.from([0xff, 0x0f, 0x42, bytes.length, ...bytes, 0x56, 0x42, 0x00, bytes.length, 0x00])
}

/** Whether `haystack` carries `needle` as a contiguous run of bytes. Byte against byte. */
function carries(haystack: Uint8Array, needle: Uint8Array): boolean {
  if (needle.length === 0 || haystack.length < needle.length) return false
  outer: for (let start = 0; start <= haystack.length - needle.length; start++) {
    for (let i = 0; i < needle.length; i++) {
      if (haystack[start + i] !== needle[i]) continue outer
    }
    return true
  }
  return false
}

/** The Durable Object's own SQLite file — the hash-named one, never `metadata.sqlite`. */
async function objectDatabase(persistDir: string): Promise<string> {
  const root = join(persistDir, 'v3', 'do')
  for (const namespace of await readdir(root)) {
    for (const file of await readdir(join(root, namespace))) {
      if (/^[0-9a-f]{64}\.sqlite$/.test(file)) return join(root, namespace, file)
    }
  }
  throw new Error(`no Durable Object database under ${root}`)
}

/**
 * Every `_cf_KV` row, as key and raw value bytes — or none, when the table does not exist.
 *
 * **The missing table is not an error case, it is a reading, and it was measured.** The
 * unconfigured boot below creates the object's database file and never creates `_cf_KV` in it,
 * because the object refused before it wrote anything: `GET /funnel` reads, `GET /self`
 * refuses, and miniflare creates the key/value table lazily on the first write. So *"no such
 * table"* is the strongest possible form of *"nothing was created on the way to refusing"*,
 * and treating it as a throw would have turned that evidence into a red suite.
 */
function rowsOf(dbPath: string): { key: string; value: Uint8Array }[] {
  const db = new DatabaseSync(dbPath, { readOnly: true })
  try {
    const table = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = '_cf_KV'").get()
    if (table === undefined) return []
    const rows: { key: string; value: Uint8Array }[] = []
    for (const row of db.prepare('SELECT key, value FROM _cf_KV').all()) {
      const key = row['key']
      const value = row['value']
      if (typeof key === 'string' && value instanceof Uint8Array) rows.push({ key, value })
    }
    return rows
  } finally {
    db.close()
  }
}

/** The keys whose stored value carries `needle`. */
function rowsCarrying(dbPath: string, needle: Uint8Array): string[] {
  return rowsOf(dbPath)
    .filter((row) => carries(row.value, needle))
    .map((row) => row.key)
    .sort()
}

/**
 * The names of the on-disk files whose raw bytes carry `needle` — the SQLite main file and its
 * write-ahead log and shared-memory sidecars.
 *
 * **Reported and never asserted on for an absence.** SQLite does not zero a deleted row: its
 * bytes stay in a free page, and in the write-ahead log, until a checkpoint and a vacuum reuse
 * the space. That is a property of miniflare's local emulation of Durable Object storage and
 * not of the deployed platform, so an assertion here would be measuring SQLite. What it IS
 * good for is the positive control, where a *hit* is the reading, and for saying honestly in
 * the record what a local file still holds.
 */
async function filesCarrying(dbPath: string, needle: Uint8Array): Promise<string[]> {
  const hits: string[] = []
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      if (carries(await readFile(`${dbPath}${suffix}`), needle)) hits.push(`<db>${suffix}`)
    } catch {
      // A `-wal` or `-shm` that is not there is not a finding; the main file always is.
    }
  }
  return hits
}

/**
 * The bytes a stored `Uint8Array` row carries, out of workerd's V8 framing.
 *
 * **The length is a varint and this reads it as one**, which the first draft did not: it took
 * a fixed four-byte prefix, correct for the 32-byte seed the template was read off and wrong
 * for the ~380-byte envelope. The run failed in `JSON.parse` with a `SyntaxError` naming a
 * stray leading byte before `{"v":1,"k"…` — the envelope's own opening, one byte in. A shape
 * read off one example is a shape that holds for that example.
 *
 * Seven bits per byte, least significant group first, high bit set while more groups follow —
 * V8's own `WriteVarint`.
 */
function payloadOf(stored: Uint8Array): Uint8Array {
  if (stored[0] !== 0xff || stored[2] !== 0x42) {
    throw new Error(`not a V8-serialised ArrayBuffer: ${stored.length} bytes beginning ${String(stored[0])}`)
  }
  let length = 0
  let shift = 0
  let at = 3
  for (;;) {
    const byte = stored[at]
    if (byte === undefined) throw new Error('the stored value ended inside its own length')
    at += 1
    length |= (byte & 0x7f) << shift
    if ((byte & 0x80) === 0) break
    shift += 7
  }
  return stored.subarray(at, at + length)
}

/** The seed inside the envelope this store holds, opened with `secret`. */
async function sealedSeedIn(dbPath: string, secret: string): Promise<Uint8Array> {
  const row = rowsOf(dbPath).find((entry) => entry.key === SEALED_HOSTED_IDENTITY_KEY.toString())
  if (row === undefined) throw new Error(`${SEALED_HOSTED_IDENTITY_KEY.toString()} is not in this store`)
  // The stored value is the V8-serialised `Uint8Array` of the envelope's UTF-8 JSON.
  return await openSecret(JSON.parse(new TextDecoder().decode(payloadOf(row.value))), secret)
}

interface Worker {
  readonly process: ChildProcess
  stop(): Promise<void>
}

async function startWorker(port: number, persistDir: string, secret: string | undefined): Promise<Worker> {
  const child = spawn(
    'npx',
    [
      'wrangler',
      'dev',
      '--port',
      String(port),
      '--local-protocol',
      'http',
      '--persist-to',
      persistDir,
      ...(secret === undefined ? [] : ['--var', `O2_IDENTITY_SECRET:${secret}`]),
    ],
    {
      cwd: PACKAGE_DIR,
      env: { ...process.env, CLOUDFLARE_API_TOKEN: '', WRANGLER_SEND_METRICS: 'false' },
      stdio: 'ignore',
      // Its own process group, so the whole tree can be killed — `npx wrangler dev` is a parent
      // that spawns `workerd` as a grandchild, and `SIGTERM` to the parent alone leaves that
      // grandchild holding the port. Measured and recorded in
      // `packages/node/src/kill-switch-volunteer.e2e.test.ts`.
      detached: true,
    },
  )
  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()))
  // **Readiness is `GET /funnel` and deliberately NOT `GET /self`.** `/self` opens the
  // identity, which is the very thing under test: polling it would make an unconfigured worker
  // indistinguishable from one that had not started, and would warm the object before the
  // cold-vs-warm timing below could see a cold one.
  await waitFor(port, 120_000)
  return {
    process: child,
    stop: async (): Promise<void> => {
      if (child.pid !== undefined) {
        try {
          process.kill(-child.pid, 'SIGTERM')
        } catch {
          child.kill('SIGTERM')
        }
      }
      // Waiting for the process to LEAVE, not for the signal to be delivered: the SQLite file
      // is only safe to open once workerd has released it, and a read taken while it still
      // held the write lock would be measuring a race.
      await Promise.race([exited, new Promise<void>((resolve) => setTimeout(resolve, 20_000))])
    },
  }
}

async function waitFor(port: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  let last: unknown
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://${HOST}:${port}/funnel`, { signal: AbortSignal.timeout(3000) })
      if (response.ok) {
        await response.text()
        return
      }
      last = new Error(`/funnel answered ${String(response.status)}`)
    } catch (cause) {
      last = cause
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error(`workerd did not become ready within ${String(timeoutMs)} ms: ${String(last)}`)
}

interface SelfReading {
  readonly status: number
  readonly body: string
  readonly elapsedMs: number
}

async function readSelf(port: number): Promise<SelfReading> {
  const started = performance.now()
  const response = await fetch(`http://${HOST}:${port}/self`, { signal: AbortSignal.timeout(60_000) })
  const body = await response.text()
  return { status: response.status, body, elapsedMs: performance.now() - started }
}

function peerIdOf(reading: SelfReading): string {
  const parsed: unknown = JSON.parse(reading.body)
  if (typeof parsed === 'object' && parsed !== null && 'peerId' in parsed && typeof parsed.peerId === 'string') {
    return parsed.peerId
  }
  throw new Error(`GET /self answered ${String(reading.status)} with no peerId: ${reading.body}`)
}

/** Everything the arc below observed, so each property gets its own named case. */
interface Arc {
  firstBootPeerId: string
  coldSelfMs: number
  warmSelfMs: number
  sealedSeed: Uint8Array
  keysAfterFirstBoot: string[]
  rowsCarryingSeedAfterFirstBoot: string[]
  restartPeerId: string
  rowsCarryingPlantAfterPlanting: string[]
  filesCarryingPlantAfterPlanting: string[]
  migratedPeerId: string
  keysAfterMigration: string[]
  rowsCarryingPlantAfterMigration: string[]
  filesCarryingPlantAfterMigration: string[]
  migratedEnvelopeSeed: Uint8Array
}

let sealedDir = ''
let unconfiguredDir = ''
let arc: Arc
let unconfigured: { self: SelfReading; keys: string[] }

beforeAll(async () => {
  sealedDir = await mkdtemp(join(tmpdir(), 'o2-hosted-sealed-'))
  unconfiguredDir = await mkdtemp(join(tmpdir(), 'o2-hosted-unconfigured-'))

  // ── 1. A boot with the secret set. ──────────────────────────────────────────
  let worker = await startWorker(SEALED_PORT, sealedDir, SECRET)
  // Cold: this request is the one that opens the envelope, because the object was constructed
  // for `/funnel` and `HostedNode.identity()` had never been called on it. Warm: the same live
  // object, whose memoised promise is already resolved. The difference is the derivation,
  // measured as a ratio within one run rather than against an absolute this host would encode.
  const cold = await readSelf(SEALED_PORT)
  const warm = await readSelf(SEALED_PORT)
  const firstBootPeerId = peerIdOf(cold)
  await worker.stop()

  const db = await objectDatabase(sealedDir)
  const sealedSeed = await sealedSeedIn(db, SECRET)
  const keysAfterFirstBoot = rowsOf(db)
    .map((row) => row.key)
    .sort()
  const rowsCarryingSeedAfterFirstBoot = rowsCarrying(db, sealedSeed)

  // ── 2. A restart over the same store. ───────────────────────────────────────
  worker = await startWorker(SEALED_PORT, sealedDir, SECRET)
  const restartPeerId = peerIdOf(await readSelf(SEALED_PORT))
  await worker.stop()

  // ── 3. The plant: this store put back into the state a pre-AUTH-07 build left. ──
  const planted = new DatabaseSync(db)
  try {
    planted.prepare('DELETE FROM _cf_KV WHERE key = ?').run(SEALED_HOSTED_IDENTITY_KEY.toString())
    planted
      .prepare('INSERT OR REPLACE INTO _cf_KV (key, value) VALUES (?, ?)')
      .run(HOSTED_IDENTITY_KEY.toString(), durableObjectBlobFor(PLANTED_SEED))
    // So the positive control's file-level reading is taken against the main file rather than
    // against a write-ahead log the next process would fold in anyway.
    planted.exec('PRAGMA wal_checkpoint(TRUNCATE)')
  } finally {
    planted.close()
  }
  const rowsCarryingPlantAfterPlanting = rowsCarrying(db, PLANTED_SEED)
  const filesCarryingPlantAfterPlanting = await filesCarrying(db, PLANTED_SEED)

  // ── 4. The migration: boot over the planted store. ──────────────────────────
  worker = await startWorker(SEALED_PORT, sealedDir, SECRET)
  const migratedPeerId = peerIdOf(await readSelf(SEALED_PORT))
  await worker.stop()

  arc = {
    firstBootPeerId,
    coldSelfMs: cold.elapsedMs,
    warmSelfMs: warm.elapsedMs,
    sealedSeed,
    keysAfterFirstBoot,
    rowsCarryingSeedAfterFirstBoot,
    restartPeerId,
    rowsCarryingPlantAfterPlanting,
    filesCarryingPlantAfterPlanting,
    migratedPeerId,
    keysAfterMigration: rowsOf(db)
      .map((row) => row.key)
      .sort(),
    rowsCarryingPlantAfterMigration: rowsCarrying(db, PLANTED_SEED),
    filesCarryingPlantAfterMigration: await filesCarrying(db, PLANTED_SEED),
    migratedEnvelopeSeed: await sealedSeedIn(db, SECRET),
  }

  // ── 5. A boot with NO secret, on a store of its own. ────────────────────────
  const bare = await startWorker(UNCONFIGURED_PORT, unconfiguredDir, undefined)
  const bareSelf = await readSelf(UNCONFIGURED_PORT)
  await bare.stop()
  unconfigured = { self: bareSelf, keys: rowsOf(await objectDatabase(unconfiguredDir)).map((row) => row.key).sort() }
}, 900_000)

afterAll(async () => {
  for (const dir of [sealedDir, unconfiguredDir]) {
    if (dir !== '') await rm(dir, { recursive: true, force: true }).catch(() => undefined)
  }
})

describe('AUTH-07 criterion 4 — the seed is absent from the store a real workerd wrote', () => {
  it('holds an envelope and no plaintext row, and no row anywhere carries the seed', () => {
    // The envelope is there under its own key and the plaintext key is not there at all.
    expect(arc.keysAfterFirstBoot).toContain(SEALED_HOSTED_IDENTITY_KEY.toString())
    expect(arc.keysAfterFirstBoot).not.toContain(HOSTED_IDENTITY_KEY.toString())

    // **The whole store, not one key.** The criterion's words are that the object's storage no
    // longer contains the raw seed, and a scan of every row is what answers that rather than a
    // question about the one key the old build used.
    expect(arc.rowsCarryingSeedAfterFirstBoot).toEqual([])

    // The seed searched for is a real one: it came out of the envelope, so it is exactly the
    // 32 bytes this node is running as. A scan for bytes nobody has would find nothing for a
    // reason that says nothing.
    expect(arc.sealedSeed.length).toBe(SEED_BYTES)
  })

  it('answers the same PeerId after a restart, and it is the one the sealed seed implies', async () => {
    expect(arc.restartPeerId).toBe(arc.firstBootPeerId)
    // Derived independently by the same pure function the fabric uses, so this is not two
    // readings agreeing with each other but two readings agreeing with the stored envelope.
    expect(arc.firstBootPeerId).toBe((await identityFromSeed(arc.sealedSeed)).peerId)
  })

  it('runs the Argon2id derivation on workerd — the cold read pays for it and the warm one does not', () => {
    // **This is the discharge of "does the KDF run on the Cloudflare runtime at all".** Nothing
    // about Node proves anything about workerd, and a 19 MiB pure-JS allocation is exactly the
    // kind of thing a different runtime refuses. It ran: the PeerId above could only come from
    // opening the envelope.
    //
    // A ratio taken within one run, never an absolute — an absolute would encode this host, its
    // load and the day's I/O weather. Both readings are the same request to the same live
    // object over the same loopback socket; the only difference is that the first one derives.
    expect(arc.coldSelfMs).toBeGreaterThan(arc.warmSelfMs * 3)
  })
})

describe('AUTH-07 criterion 4 — a planted plaintext seed is migrated, and the node that comes up is that seed’s', () => {
  it('finds the planted seed while it is there — the positive control, on the same scanner and the same file', () => {
    // **Without this, every absence in this file is worthless.** It is the pre-change at-rest
    // state, produced by writing the row a pre-AUTH-07 build wrote, and the same `rowsCarrying`
    // that reported `[]` above reports it here.
    expect(arc.rowsCarryingPlantAfterPlanting).toEqual([HOSTED_IDENTITY_KEY.toString()])
    // And at the level the question is actually about: the raw bytes of the file on disk.
    expect(arc.filesCarryingPlantAfterPlanting).toContain('<db>')
  })

  it('comes up as the node the planted seed implies, so a deployed object keeps its published name', async () => {
    // The reading the whole criterion turns on. The live object has answered on one PeerId
    // since 2026-08-27 and its storage holds a raw seed; this says a boot of the new build over
    // such a store is the SAME node, not a new one wearing its address.
    expect(arc.migratedPeerId).toBe((await identityFromSeed(PLANTED_SEED)).peerId)
    expect(arc.migratedPeerId).not.toBe(arc.firstBootPeerId)
  })

  it('deletes the plaintext row and leaves an envelope that opens to the very same bytes', () => {
    expect(arc.keysAfterMigration).not.toContain(HOSTED_IDENTITY_KEY.toString())
    expect(arc.keysAfterMigration).toContain(SEALED_HOSTED_IDENTITY_KEY.toString())
    expect(arc.rowsCarryingPlantAfterMigration).toEqual([])
    // Byte-identical. "An envelope exists" would be satisfied by one sealed over a NEW seed,
    // which is the failure this whole phase is about.
    expect([...arc.migratedEnvelopeSeed]).toEqual([...PLANTED_SEED])
  })

  it('records, without asserting, what the local SQLite file still holds after the delete', () => {
    // **A deleted SQLite row is not a zeroed one.** Its bytes stay in a free page, and in the
    // write-ahead log, until a checkpoint and a vacuum reuse the space — a property of
    // miniflare's local emulation and not of the deployed platform, which is why this is a
    // recorded reading rather than an assertion. Whatever it says is in `43-HOSTED.md`.
    //
    // The assertion here is only that the reading was TAKEN, so the number in the record is a
    // measurement rather than a recollection.
    expect(Array.isArray(arc.filesCarryingPlantAfterMigration)).toBe(true)

    // Printed, on the `[host conditions]` banner's precedent: a figure quoted in a document is
    // worth what its reproduction is worth, and this is the line that reproduces it.
    console.log(
      `[criterion 4] cold GET /self ${arc.coldSelfMs.toFixed(1)} ms, warm ${arc.warmSelfMs.toFixed(1)} ms, ` +
        `ratio ${(arc.coldSelfMs / arc.warmSelfMs).toFixed(1)}x — the difference is the Argon2id derivation on workerd. ` +
        `Planted seed found in ${JSON.stringify(arc.filesCarryingPlantAfterPlanting)} before the migration and ` +
        `${JSON.stringify(arc.filesCarryingPlantAfterMigration)} after it (raw file bytes; rows: ` +
        `${JSON.stringify(arc.rowsCarryingPlantAfterMigration)}).`,
    )
  })
})

describe('AUTH-07 criterion 4 — an unconfigured deployment refuses by name and creates nothing', () => {
  it('answers GET /self with 500 naming the refusal rather than a PeerId', () => {
    expect(unconfigured.self.status).toBe(500)
    expect(unconfigured.self.body).toContain('HostedIdentitySecretMissingError')
    // It names the binding and the command, so the log line is the repair.
    expect(unconfigured.self.body).toContain('O2_IDENTITY_SECRET')
    expect(unconfigured.self.body).toContain('wrangler secret put')
  })

  it('leaves no identity row in the store, so nothing was created on the way to refusing', () => {
    // **The load-bearing half.** A refusal that had already written a seed would be the worst
    // outcome available: the operator sets the binding, the object comes up, and it comes up as
    // somebody else — permanently, because the PeerId is published.
    expect(unconfigured.keys.filter((key) => key.startsWith('/identity/'))).toEqual([])
  })
})
