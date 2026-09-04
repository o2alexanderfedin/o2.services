import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import type { ChildProcessByStdio } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Readable, Writable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openSecret } from '@o2/core'
import { PASSPHRASE_MIN_LENGTH, SEED_BYTES, identityFromSeed, peerIdForNodeKey } from '@o2/libp2p'
import { FsBlockstore } from './fs-blockstore.ts'
import {
  IDENTITY_FILE,
  PROVIDER_FILE,
  SEALED_IDENTITY_FILE,
  SEALED_PROVIDER_FILE,
  loadCertificate,
  loadOrCreateSealedSeed,
} from './identity-store.ts'

/**
 * AUTH-06 — the node tier's secrets at rest, measured across real operating-system
 * processes.
 *
 * Four of the phase's five criteria live here, one describe block each, and the mapping is
 * written down rather than left to be inferred:
 *
 * | criterion | describe block |
 * |---|---|
 * | 2 — the instrument can see a plaintext secret | `criterion 2 — the positive control` |
 * | 1 — a completed enrolment leaves no plaintext secret | `criterion 1 — the store holds neither secret` |
 * | 3 — one passphrase file, two starts, one peer id | `criterion 3 — the same node across a restart` |
 * | 4 — a wrong passphrase refuses and mints nothing | `criterion 4 — a wrong passphrase refuses by name` |
 *
 * **Criterion 2 is written FIRST and it is not politeness about ordering.** Criterion 1 is
 * an ABSENCE assertion, and an absence assertion over a directory the instrument cannot
 * read passes for the wrong reason — as does one over an empty directory. So the control
 * is built by hand in the pre-change shape, and the same `dumpDirectory` that reports
 * "nothing here" for a sealed store is watched finding both needles in an unsealed one.
 *
 * ## Why the decode is written the way it is, quoted from the instrument that failed
 *
 * `packages/cloudflare/src/funnel-collector.e2e.test.ts`'s `dumpStore` carries this at the
 * point of its own decode, and it is quoted verbatim because it is the exact defect a dump
 * instrument arrives with:
 *
 * > **`node:sqlite` hands a BLOB back as a `Uint8Array`, NOT as a `Buffer`, and reading
 * > that wrongly is how this instrument first failed.** The original line tested
 * > `Buffer.isBuffer(value)` and fell back to `Buffer.from(String(value))`, which renders a
 * > `Uint8Array` as the comma-separated decimal string `255,15,66,123,...`. Every scan
 * > below then searched that rendering and found nothing — and the plant that stores the
 * > client address in the record was watched staying GREEN because of it, with
 * > `"plantedClientAddress":"192.0.2.199"` sitting in the file the whole time. A decode
 * > step is a place a value can be lost, and this one lost all of them.
 *
 * So nothing in this file renders a value in order to search it. `dumpDirectory` returns
 * the `Buffer` `readFileSync` produced and every scan is `Buffer.includes` over raw bytes,
 * because a 32-byte seed has no textual rendering to search for in the first place.
 *
 * ## No absolute timing assertion appears anywhere below
 *
 * The `it` budgets are budgets — they exist so a wedged child process is reported as a
 * wedged child process rather than as an anonymous hook timeout — and nothing here asserts
 * on a duration. Argon2id at `DEFAULT_KDF_PARAMS` has read 374 ms, 436 ms and 501 ms across
 * two hosts, so a millisecond bound sited here would encode this machine.
 *
 * Node-only by necessity: the subject is a filesystem and a set of child processes.
 */

const AGENT = fileURLToPath(new URL('./bin/agent.ts', import.meta.url))

/**
 * At least {@link PASSPHRASE_MIN_LENGTH} characters, which is asserted below rather than
 * counted by hand — a constant that silently fell under the floor would make every case in
 * this file refuse for a reason that has nothing to do with its subject.
 */
const SPEC_PASSPHRASE = 'identity-at-rest-spec-passphrase'
const OTHER_PASSPHRASE = 'a-completely-different-passphrase'
const PROVIDER_PASSPHRASE = 'the-provider-process-passphrase'

/** Fixed patterns, not random — a failing run must be reproducible. */
const KNOWN_SEED = new Uint8Array(SEED_BYTES).fill(0xd1)
const KNOWN_PROVIDER_SEED = new Uint8Array(SEED_BYTES).fill(0xd2)
const USER_SEED = new Uint8Array(SEED_BYTES).fill(0xd3)

/**
 * How long a spawned agent gets to print its handshake line.
 *
 * Sized the same way and for the same reason as `enrollment.node.test.ts`'s: nothing here
 * asserts on wall-clock time, and this number exists only so a genuinely wedged process is
 * reported as a wedged process rather than as a hang.
 */
const ANNOUNCE_BUDGET_MS = 60_000

/** One file, as `readFileSync` produced it. Never a rendering of one. */
interface DumpedFile {
  readonly path: string
  readonly bytes: Buffer
}

/**
 * Every file in `dir`, recursively, **dotfiles included**.
 *
 * **The absence of a `startsWith('.')` filter is the point of this helper and is written
 * down so nobody adds one.** `FsBlockstore.open` filters dotted names because that filter
 * *is* its block counter (`fs-blockstore.ts:60`); a dump instrument that copied the same
 * predicate would skip `.identity.key`, `.provider.key`, `.identity.key.enc` and
 * `.certificate.json` — which is to say every file this phase is about — and would then
 * satisfy every absence assertion below while reading nothing at all.
 *
 * `readdirSync` returns dotted entries without being asked; only a filter can lose them.
 */
function dumpDirectory(dir: string): DumpedFile[] {
  const found: DumpedFile[] = []
  if (!existsSync(dir)) return found
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      found.push(...dumpDirectory(path))
      continue
    }
    if (!entry.isFile()) continue
    found.push({ path, bytes: readFileSync(path) })
  }
  return found
}

/** Raw bytes in raw bytes. No encoding, no rendering, no separator. */
function containsSubsequence(haystack: Buffer, needle: Uint8Array): boolean {
  return haystack.includes(Buffer.from(needle))
}

/** The path of the first dumped file holding `needle`, or `null`. */
function findNeedle(files: readonly DumpedFile[], needle: Uint8Array): string | null {
  for (const file of files) {
    if (containsSubsequence(file.bytes, needle)) return file.path
  }
  return null
}

/**
 * The floor, asserted before any absence is.
 *
 * A dump of nothing satisfies every `not.toContain` in this file, and this instrument has
 * a recorded ancestor that passed over nothing for a whole phase.
 *
 * The byte floor is `2 * SEED_BYTES` — as many bytes as the two secrets this file searches
 * for — because a dump smaller than its own needles cannot have found them and cannot have
 * lost them either. It is sited against the smallest directory any case here builds, which
 * is criterion 2's hand-built control at exactly two 32-byte files, and every sealed
 * directory holds several times it.
 *
 * `minFiles` is a parameter and defaults to two because **one case legitimately reads a
 * directory holding exactly one file**: a migrated directory, after the plaintext has been
 * unlinked, is the envelope and nothing else. The byte floor is what carries the claim
 * there, and lowering the file count for that one call is not the same as lowering it for
 * criterion 1 — whose directories hold a certificate, blocks and two envelopes.
 */
function expectDumpIsNotEmpty(files: readonly DumpedFile[], where: string, minFiles = 2): void {
  expect(
    files.length,
    `${where}: the dump found ${files.length} files — an absence assertion over a dump this ` +
      'small is passing because the instrument read nothing, not because the bytes are gone',
  ).toBeGreaterThanOrEqual(minFiles)
  const total = files.reduce((sum, one) => sum + one.bytes.length, 0)
  expect(total, `${where}: the dump holds ${total} bytes in total`).toBeGreaterThanOrEqual(2 * SEED_BYTES)
}

/**
 * A directory listing plus a digest of each file's bytes, for the byte-identical comparison.
 *
 * A digest rather than a rendering of the bytes, and the difference is this file's own rule
 * applied to itself: `Buffer.prototype.toString` is a rendering, and this file asserts that
 * it scans no value through one. `digest('hex')` is a hash of the bytes, which changes when
 * any byte does and is what a comparison needs.
 */
function snapshotDirectory(dir: string): string[] {
  return dumpDirectory(dir)
    .map((one) => `${one.path} ${one.bytes.length} ${createHash('sha256').update(one.bytes).digest('hex')}`)
    .sort()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** The two keys this file reads off the agent's announcement. The line carries more. */
interface Handshake {
  readonly peerId: string
  readonly multiaddrs: readonly string[]
}

/**
 * Validate the announcement line rather than asserting a shape onto it.
 *
 * The line comes out of another process, which makes it external data — the same rule
 * `parseSealedSecret` states for a stored envelope, applied to a pipe.
 */
function parseHandshake(line: string): Handshake {
  const value: unknown = JSON.parse(line)
  if (!isRecord(value)) throw new Error(`the agent's first line is not a JSON object: ${line}`)
  const peerId = value['peerId']
  if (typeof peerId !== 'string') throw new Error(`the agent announced no peerId: ${line}`)
  const raw = value['multiaddrs']
  if (!Array.isArray(raw)) throw new Error(`the agent announced no multiaddrs: ${line}`)
  const multiaddrs: string[] = []
  for (const one of raw) {
    if (typeof one !== 'string') throw new Error(`the agent announced a non-string multiaddr: ${line}`)
    multiaddrs.push(one)
  }
  return { peerId, multiaddrs }
}

/**
 * stdin is piped and never written to, so the child's type carries a `Writable` for it.
 *
 * The pipe is the point rather than the type: `bin/agent.ts` watches fd 0 and leaves when
 * it closes, which is what stops a spawned agent outliving a parent that was killed rather
 * than asked. See `orphan-leash.node.test.ts`, which demonstrates it and guards the line.
 */
type AgentProcess = ChildProcessByStdio<Writable, Readable, Readable>

interface Agent {
  readonly handshake: Handshake
  readonly child: AgentProcess
  readonly dir: string
  /**
   * Everything the process has written to stderr so far.
   *
   * A reader rather than a snapshot, because it keeps accumulating after the handshake
   * resolves — stdout and stderr are two pipes and nothing orders a write on one against a
   * write on the other at the reading end, so a line the process emitted BEFORE its
   * announcement can still arrive after it.
   */
  readonly stderr: () => string
}

/** What a process that refused to start left behind. */
interface Departure {
  readonly code: number | null
  readonly stderr: string
}

let workdir: string
const children: AgentProcess[] = []

/**
 * Write a passphrase file with a trailing newline, deliberately.
 *
 * An operator produces one of these with a text editor or a heredoc, and both append a
 * newline. The flag strips exactly one, and every case in this file exercises that path
 * rather than a hand-trimmed string no real file ever holds.
 */
async function writePassphraseFile(name: string, passphrase: string): Promise<string> {
  const path = join(workdir, `${name}.passphrase`)
  await writeFile(path, `${passphrase}\n`, { mode: 0o600 })
  return path
}

/** A user key file, which `bin/agent.ts` refuses to mint for itself. */
async function writeUserKey(name: string, seed: Uint8Array): Promise<string> {
  const path = join(workdir, `${name}.key`)
  await writeFile(path, seed, { mode: 0o600 })
  return path
}

/**
 * Spawn one agent and resolve its single announcement line.
 *
 * The spawn discipline — piped stdin, the announce timer, stderr accumulated so a refusal
 * is legible, an early exit turned into a rejection rather than a hang — is
 * `enrollment.node.test.ts`'s, copied rather than invented. **What is deliberately not
 * copied is its formatting**: that helper renders values with `String(...)`, and this file
 * asserts about itself that no value is scanned through a string rendering, so the same
 * facts are rendered with `JSON.stringify` instead. The shape is the discipline; the
 * formatter is not.
 */
async function spawnAgent(name: string, extraArgs: readonly string[] = []): Promise<Agent> {
  const dir = join(workdir, name)
  const child: AgentProcess = spawn(process.execPath, [AGENT, '--dir', dir, ...extraArgs], {
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  children.push(child)
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')

  // Hoisted out of the promise so it survives the handshake — see `Agent.stderr`.
  let stderr = ''
  child.stderr.on('data', (chunk: string) => {
    stderr += chunk
  })

  const handshake = await new Promise<Handshake>((resolve, reject) => {
    let stdout = ''
    const timer = setTimeout(
      () => reject(new Error(`agent ${name} did not announce in time: ${stderr}`)),
      ANNOUNCE_BUDGET_MS,
    )
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk
      const newline = stdout.indexOf('\n')
      if (newline === -1) return
      clearTimeout(timer)
      try {
        resolve(parseHandshake(stdout.slice(0, newline)))
      } catch (cause) {
        reject(cause instanceof Error ? cause : new Error(JSON.stringify(cause)))
      }
    })
    child.on('exit', (code) => {
      clearTimeout(timer)
      reject(new Error(`agent ${name} exited early with ${JSON.stringify(code)}: ${stderr}`))
    })
  })

  return { handshake, child, dir, stderr: () => stderr }
}

/**
 * Wait until the process has said something, rather than asserting it already has.
 *
 * The two lines this file reads are written before the announcement — `bin/agent.ts`
 * resolves the protection before `FabricNode.start`, and `fabric-node.ts` reports an
 * unprotected seed during it — but they travel on a different pipe, so an assertion taken
 * the instant the handshake resolves is a race rather than a reading. A budget, never an
 * assertion about a duration.
 */
async function waitForStderr(agent: Agent, needle: string, budgetMs = 10_000): Promise<void> {
  const deadline = Date.now() + budgetMs
  while (Date.now() < deadline) {
    if (agent.stderr().includes(needle)) return
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  expect(agent.stderr(), `the agent never said ${JSON.stringify(needle)}`).toContain(needle)
}

/**
 * Spawn one agent that is expected NOT to start, and resolve what it said on its way out.
 *
 * Separate from `spawnAgent` rather than a flag on it: a helper that resolves on either
 * outcome would let a case that meant to observe a refusal pass against a process that
 * started perfectly well.
 */
async function spawnAgentExpectingDeparture(name: string, extraArgs: readonly string[] = []): Promise<Departure> {
  const dir = join(workdir, name)
  const child: AgentProcess = spawn(process.execPath, [AGENT, '--dir', dir, ...extraArgs], {
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  children.push(child)
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')

  return new Promise<Departure>((resolve, reject) => {
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(
      () => reject(new Error(`agent ${name} neither refused nor exited: ${stderr}`)),
      ANNOUNCE_BUDGET_MS,
    )
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk
    })
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk
      if (!stdout.includes('\n')) return
      clearTimeout(timer)
      reject(new Error(`agent ${name} announced instead of refusing: ${stdout}`))
    })
    child.on('exit', (code) => {
      clearTimeout(timer)
      resolve({ code, stderr })
    })
  })
}

/** SIGTERM, then wait for the process to actually be gone. */
async function stopAgent(child: AgentProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      resolve()
    }, 10_000)
    child.on('exit', () => {
      clearTimeout(timer)
      resolve()
    })
    child.kill('SIGTERM')
  })
}

/** Stop one agent out of turn, so a restart can rebind and `afterEach` does not wait twice. */
async function stopAgentNow(agent: Agent): Promise<void> {
  const at = children.indexOf(agent.child)
  if (at >= 0) children.splice(at, 1)
  await stopAgent(agent.child)
}

/**
 * The bytes inside an envelope on disk, recovered with the passphrase that sealed them.
 *
 * The needle every scan below searches for is the REAL seed, recovered this way, never a
 * synthetic one — a scan for bytes that were never in the directory finds nothing whatever
 * the directory holds.
 */
async function openEnvelope(dir: string, file: string, passphrase: string): Promise<Uint8Array> {
  const raw = await readFile(join(dir, file), 'utf8')
  const parsed: unknown = JSON.parse(raw)
  return openSecret(parsed, passphrase)
}

beforeEach(async () => {
  workdir = await mkdtemp(join(tmpdir(), 'o2-identity-at-rest-'))
})

/**
 * Inner 10 s, outer 40 s — and the order is the point. `stopAgent` gives a wedged process
 * 10 s before SIGKILL, and this hook may be waiting on as many as four of them. A test arms
 * two clocks and the framework's must be the larger, or a wedged agent is reported as an
 * anonymous hook timeout naming no step.
 */
afterEach(async () => {
  await Promise.all(children.splice(0).map((child) => stopAgent(child).catch(() => {})))
  await rm(workdir, { recursive: true, force: true })
}, 40_000)

describe('criterion 2 — the positive control, so criterion 1 cannot pass on a blind instrument', () => {
  /**
   * The FIRST case in the file, deliberately.
   *
   * The directory is built by hand in the **pre-change shape** rather than by running the
   * pre-change code: a pre-change run is not reproducible once the change has landed, and
   * this control has to keep working for exactly as long as criterion 1 does.
   */
  it('finds both plaintext secrets in a directory written in the pre-change shape', async () => {
    // `mkdtemp` made `workdir`, not this subdirectory — create it before writing into it.
    const dir = join(workdir, 'legacy-shape')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, IDENTITY_FILE), KNOWN_SEED, { mode: 0o600 })
    await writeFile(join(dir, PROVIDER_FILE), KNOWN_PROVIDER_SEED, { mode: 0o600 })

    const files = dumpDirectory(dir)
    expectDumpIsNotEmpty(files, 'the hand-built pre-change directory')

    const identityAt = findNeedle(files, KNOWN_SEED)
    expect(identityAt, 'the dump did not find the plaintext identity seed it wrote itself').not.toBeNull()
    expect(identityAt).toBe(join(dir, IDENTITY_FILE))

    const providerAt = findNeedle(files, KNOWN_PROVIDER_SEED)
    expect(providerAt, 'the dump did not find the plaintext provider key it wrote itself').not.toBeNull()
    expect(providerAt).toBe(join(dir, PROVIDER_FILE))
  })

  it('holds a spec passphrase no shorter than the floor the store enforces', () => {
    for (const passphrase of [SPEC_PASSPHRASE, OTHER_PASSPHRASE, PROVIDER_PASSPHRASE]) {
      expect(passphrase.length).toBeGreaterThanOrEqual(PASSPHRASE_MIN_LENGTH)
    }
  })
})

describe('criterion 1 — after a completed enrolment the store holds neither secret', () => {
  /**
   * Two participants, because a completed enrolment has two and because the provider's
   * directory holds the higher-value secret: a provider signing key is the trust root every
   * certificate it ever issued verifies against.
   *
   * The needles are the REAL seeds, recovered by opening each envelope with its own
   * passphrase. A scan for a synthetic 32 bytes would find nothing whatever the directory
   * held, which is the shape of an absence assertion that cannot fail.
   */
  it('leaves no seed and no provider key in either participant\'s directory, dotfiles included', async () => {
    const providerPassphraseFile = await writePassphraseFile('provider', PROVIDER_PASSPHRASE)
    const enrolleePassphraseFile = await writePassphraseFile('enrollee', SPEC_PASSPHRASE)
    const userKey = await writeUserKey('enrollee-user', USER_SEED)

    const provider = await spawnAgent('provider', [
      '--issues-certificates',
      '--max-issued-per-window',
      '64',
      '--identity-passphrase-file',
      providerPassphraseFile,
    ])
    const providerAddr = provider.handshake.multiaddrs.find(
      (addr) => addr.includes('/tcp/') && !addr.includes('/p2p-circuit'),
    )
    expect(providerAddr, 'the provider announced no dialable tcp address').not.toBeUndefined()

    const enrollee = await spawnAgent('enrollee', [
      '--provider-addr',
      providerAddr ?? '',
      '--user-key',
      userKey,
      '--operator-id',
      'harbour-ops',
      '--identity-passphrase-file',
      enrolleePassphraseFile,
    ])

    // The enrolment completed: `bin/agent.ts` announces only after `FabricNode.start`
    // resolves, and a node given `--provider-addr` does not start without a certificate.
    // Read back off the disk as well, so "completed" is a file that parses rather than a
    // line a process chose to print.
    expect(await loadCertificate(enrollee.dir)).not.toBeNull()

    // The needles, recovered before the processes are stopped so a failure to open is
    // attributable to the envelope rather than to a teardown.
    const enrolleeSeed = await openEnvelope(enrollee.dir, SEALED_IDENTITY_FILE, SPEC_PASSPHRASE)
    const providerSeed = await openEnvelope(provider.dir, SEALED_IDENTITY_FILE, PROVIDER_PASSPHRASE)
    const providerKey = await openEnvelope(provider.dir, SEALED_PROVIDER_FILE, PROVIDER_PASSPHRASE)
    expect(enrolleeSeed.length).toBe(SEED_BYTES)
    expect(providerSeed.length).toBe(SEED_BYTES)
    expect(providerKey.length).toBe(SEED_BYTES)
    // Three distinct secrets, or a scan that found none of them proves less than it looks.
    expect(Buffer.from(providerKey).equals(Buffer.from(providerSeed))).toBe(false)
    expect(Buffer.from(enrolleeSeed).equals(Buffer.from(providerSeed))).toBe(false)

    await stopAgentNow(enrollee)
    await stopAgentNow(provider)

    for (const [where, dir] of [
      ['the enrollee', enrollee.dir],
      ['the provider', provider.dir],
    ] as const) {
      const files = dumpDirectory(dir)
      expectDumpIsNotEmpty(files, where)

      for (const [what, needle] of [
        ["the enrollee's seed", enrolleeSeed],
        ["the provider's seed", providerSeed],
        ["the provider's signing key", providerKey],
      ] as const) {
        const at = findNeedle(files, needle)
        expect(at, `${where}'s directory holds ${what} in the clear, in ${JSON.stringify(at)}`).toBeNull()
      }

      // A direct question rather than an inference about a file's contents: the plaintext
      // file is gone by name.
      expect(existsSync(join(dir, IDENTITY_FILE))).toBe(false)
      expect(existsSync(join(dir, PROVIDER_FILE))).toBe(false)
      expect(existsSync(join(dir, SEALED_IDENTITY_FILE))).toBe(true)
    }

    // And the provider really did hold a second secret, so "no provider key on disk" is a
    // statement about a directory that had one to lose.
    expect(existsSync(join(provider.dir, SEALED_PROVIDER_FILE))).toBe(true)
    expect(existsSync(join(enrollee.dir, SEALED_PROVIDER_FILE))).toBe(false)
  }, 180_000)
})

describe('criterion 3 — the same node across a restart, one passphrase file', () => {
  /**
   * Two separate operating-system processes, not two nodes in one process, because the
   * claim is about a restart. The second process reads an envelope the first one wrote and
   * derives the identity out of it; nothing is shared but the directory and the file.
   */
  it('gives an operator who starts the agent twice with one passphrase file the same peer id', async () => {
    const passphraseFile = await writePassphraseFile('stable', SPEC_PASSPHRASE)

    const first = await spawnAgent('stable', ['--identity-passphrase-file', passphraseFile])
    expect(existsSync(join(first.dir, SEALED_IDENTITY_FILE))).toBe(true)
    await stopAgentNow(first)

    const second = await spawnAgent('stable', ['--identity-passphrase-file', passphraseFile])
    expect(second.handshake.peerId).toBe(first.handshake.peerId)
  }, 180_000)
})

describe('criterion 4 — a wrong passphrase refuses by name and mints nothing', () => {
  /**
   * The failure mode this case exists for is not contrived: the function it replaces
   * **mints when it finds nothing**, so a decrypt failure that returned `null` would walk
   * straight into a silent re-mint, present as a successful start, burn the enrolment
   * quota and orphan the certificate the old seed was issued against.
   *
   * The third start is what makes the middle one a reading rather than an appearance: a
   * refusal that had quietly rewritten the envelope would still exit non-zero and would
   * still leave a directory of the right shape, and only the original peer id coming back
   * shows that nothing moved.
   */
  it('exits non-zero naming the refusal, changes not one byte on disk, and the right passphrase still opens the original identity', async () => {
    const right = await writePassphraseFile('right', SPEC_PASSPHRASE)
    const wrong = await writePassphraseFile('wrong', OTHER_PASSPHRASE)

    const first = await spawnAgent('sealed', ['--identity-passphrase-file', right])
    await stopAgentNow(first)
    const before = snapshotDirectory(first.dir)
    expect(before.length).toBeGreaterThanOrEqual(1)

    const departure = await spawnAgentExpectingDeparture('sealed', ['--identity-passphrase-file', wrong])
    expect(departure.code, `the agent started under a wrong passphrase: ${departure.stderr}`).not.toBe(0)
    expect(departure.stderr).toContain('SealedIdentityUnlockError')

    // Byte-identical: no new envelope, no new file, nothing rewritten.
    expect(snapshotDirectory(first.dir)).toStrictEqual(before)

    const third = await spawnAgent('sealed', ['--identity-passphrase-file', right])
    expect(third.handshake.peerId).toBe(first.handshake.peerId)
  }, 180_000)

  /**
   * The same criterion at the unit level, and the two cases below are ONE reading rather
   * than two: the first shows the refusal, the second shows the mint branch exists at all.
   * A refusal case on its own cannot distinguish "no mint happened" from "this function
   * never mints", and it is the reachability of the mint branch from everywhere EXCEPT the
   * failed unlock that the criterion is about.
   */
  it('rejects a wrong passphrase by name instead of minting', async () => {
    const dir = join(workdir, 'unit-wrong')
    const created = await loadOrCreateSealedSeed(dir, SEALED_IDENTITY_FILE, IDENTITY_FILE, {
      kind: 'passphrase',
      passphrase: SPEC_PASSPHRASE,
    })
    expect(created.seed.length).toBe(SEED_BYTES)

    const thrown: unknown = await loadOrCreateSealedSeed(dir, SEALED_IDENTITY_FILE, IDENTITY_FILE, {
      kind: 'passphrase',
      passphrase: OTHER_PASSPHRASE,
    }).then(
      () => null,
      (cause: unknown) => cause,
    )
    expect(thrown instanceof Error ? thrown.name : `not an Error: ${JSON.stringify(thrown)}`).toBe(
      'SealedIdentityUnlockError',
    )

    // And the envelope still opens under the right passphrase afterwards.
    const again = await loadOrCreateSealedSeed(dir, SEALED_IDENTITY_FILE, IDENTITY_FILE, {
      kind: 'passphrase',
      passphrase: SPEC_PASSPHRASE,
    })
    expect(Buffer.from(again.seed).equals(Buffer.from(created.seed))).toBe(true)
  }, 60_000)

  it('does mint against an empty directory given a passphrase — the branch the refusal must never reach', async () => {
    const dir = join(workdir, 'unit-mint')
    const minted = await loadOrCreateSealedSeed(dir, SEALED_IDENTITY_FILE, IDENTITY_FILE, {
      kind: 'passphrase',
      passphrase: SPEC_PASSPHRASE,
    })
    expect(minted.seed.length).toBe(SEED_BYTES)
    expect(minted.unprotected).toBe(false)
    expect(existsSync(join(dir, SEALED_IDENTITY_FILE))).toBe(true)
    expect(existsSync(join(dir, IDENTITY_FILE))).toBe(false)
    const opened = await openEnvelope(dir, SEALED_IDENTITY_FILE, SPEC_PASSPHRASE)
    expect(Buffer.from(opened).equals(Buffer.from(minted.seed))).toBe(true)
  }, 60_000)

  it('refuses an envelope it has no passphrase for rather than minting over an identity that exists', async () => {
    const dir = join(workdir, 'unit-needs')
    await loadOrCreateSealedSeed(dir, SEALED_IDENTITY_FILE, IDENTITY_FILE, {
      kind: 'passphrase',
      passphrase: SPEC_PASSPHRASE,
    })

    const thrown: unknown = await loadOrCreateSealedSeed(dir, SEALED_IDENTITY_FILE, IDENTITY_FILE, {
      kind: 'writes-no-new-secret',
    }).then(
      () => null,
      (cause: unknown) => cause,
    )
    expect(thrown instanceof Error ? thrown.name : `not an Error: ${JSON.stringify(thrown)}`).toBe(
      'SealedIdentityNeedsPassphraseError',
    )
  }, 60_000)
})

describe('the migration — an operator who upgrades keeps the identity they had', () => {
  it('seals the same bytes it found, proves the envelope opens, and only then unlinks the plaintext', async () => {
    const dir = join(workdir, 'legacy-upgrade')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, IDENTITY_FILE), KNOWN_SEED, { mode: 0o600 })

    const result = await loadOrCreateSealedSeed(dir, SEALED_IDENTITY_FILE, IDENTITY_FILE, {
      kind: 'passphrase',
      passphrase: SPEC_PASSPHRASE,
    })

    // The same bytes: the peer id does not churn across the migration.
    expect(Buffer.from(result.seed).equals(Buffer.from(KNOWN_SEED))).toBe(true)
    expect(result.unprotected).toBe(false)
    expect(existsSync(join(dir, SEALED_IDENTITY_FILE))).toBe(true)
    const opened = await openEnvelope(dir, SEALED_IDENTITY_FILE, SPEC_PASSPHRASE)
    expect(Buffer.from(opened).equals(Buffer.from(KNOWN_SEED))).toBe(true)
    expect(existsSync(join(dir, IDENTITY_FILE))).toBe(false)

    // And the plaintext bytes are gone from the directory, not merely from that one name.
    // One file: the envelope, and nothing else. The byte floor is what makes this a
    // reading — an envelope is several hundred bytes and an empty directory is none.
    const files = dumpDirectory(dir)
    expectDumpIsNotEmpty(files, 'the migrated directory', 1)
    expect(files.map((one) => one.path)).toStrictEqual([join(dir, SEALED_IDENTITY_FILE)])
    expect(findNeedle(files, KNOWN_SEED)).toBeNull()
  }, 60_000)

  it('adopts a plaintext identity under no passphrase, reports it unprotected, and does NOT delete it', async () => {
    const dir = join(workdir, 'legacy-adopt')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, IDENTITY_FILE), KNOWN_SEED, { mode: 0o600 })

    const result = await loadOrCreateSealedSeed(dir, SEALED_IDENTITY_FILE, IDENTITY_FILE, {
      kind: 'writes-no-new-secret',
    })

    expect(Buffer.from(result.seed).equals(Buffer.from(KNOWN_SEED))).toBe(true)
    // Reported, never repaired: deleting somebody's identity because they supplied no
    // passphrase is worse than the exposure it would close.
    expect(result.unprotected).toBe(true)
    expect(existsSync(join(dir, IDENTITY_FILE))).toBe(true)
    expect(existsSync(join(dir, SEALED_IDENTITY_FILE))).toBe(false)
  }, 60_000)
})

describe('a node given no passphrase writes no secret at all', () => {
  it('returns a per-process identity and leaves the directory empty', async () => {
    const dir = join(workdir, 'ephemeral')
    const first = await loadOrCreateSealedSeed(dir, SEALED_IDENTITY_FILE, IDENTITY_FILE, {
      kind: 'writes-no-new-secret',
    })
    expect(first.seed.length).toBe(SEED_BYTES)
    expect(first.unprotected).toBe(false)
    expect(dumpDirectory(dir)).toStrictEqual([])

    // Per-process by construction, which is the honest cost of persisting nothing and is
    // asserted rather than left as a sentence.
    const second = await loadOrCreateSealedSeed(dir, SEALED_IDENTITY_FILE, IDENTITY_FILE, {
      kind: 'writes-no-new-secret',
    })
    expect(Buffer.from(second.seed).equals(Buffer.from(first.seed))).toBe(false)
    expect(dumpDirectory(dir)).toStrictEqual([])
  }, 60_000)

  /**
   * **"and says so" — the second half of the phase's fifth truth, which nothing else here
   * reads.** A node that persists nothing is only the right answer if its operator is told;
   * a silent default that costs somebody their peer id is the same defect as a silent
   * re-mint, one step earlier.
   *
   * Both lines are read in ONE spawn, because a directory holding a pre-AUTH-06 plaintext
   * seed reaches both at once: `bin/agent.ts` says the process writes no identity, and
   * `fabric-node.ts` says the identity already there is readable by anyone who copies the
   * directory. The plaintext file is asserted to SURVIVE, which is the T-42-13 decision —
   * reported, never deleted — read rather than described.
   *
   * Reddened by deleting either `process.stderr.write` call.
   */
  it('says so on stderr — and names a plaintext seed it adopted without deleting it', async () => {
    const dir = join(workdir, 'told')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, IDENTITY_FILE), KNOWN_SEED, { mode: 0o600 })

    // No `--identity-passphrase-file`, which is the whole configuration under test.
    const agent = await spawnAgent('told')

    await waitForStderr(agent, 'no identity passphrase was given')
    await waitForStderr(agent, "holds this node's identity seed in the clear")
    expect(agent.stderr()).toContain('--identity-passphrase-file')

    // Adopted, not re-minted: the peer id is the one the plaintext seed implies, which is
    // what makes an upgrade keep the operator's node rather than replace it.
    expect(agent.handshake.peerId).toBe(peerIdForNodeKey((await identityFromSeed(KNOWN_SEED)).nodeKey))

    await stopAgentNow(agent)

    // Reported, never repaired. The file is still there and no envelope was written beside
    // it, because this node was given no passphrase to write one with.
    expect(existsSync(join(dir, IDENTITY_FILE))).toBe(true)
    expect(existsSync(join(dir, SEALED_IDENTITY_FILE))).toBe(false)
  }, 120_000)
})

describe('the envelopes are not counted among the blocks', () => {
  /**
   * Mirrors `node-identity.node.test.ts:147`. `FsBlockstore.open`'s filter IS the block
   * counter, so a `.enc` suffix on a dotted name has to keep starting with a dot — and the
   * three blocks below are what stop a zero that means "the filter works" reading
   * identically to a zero that means "the directory is empty".
   */
  it('reports zero blocks over a directory holding both envelopes, and three after three blocks', async () => {
    const dir = join(workdir, 'counted')
    for (const [sealed, legacy] of [
      [SEALED_IDENTITY_FILE, IDENTITY_FILE],
      [SEALED_PROVIDER_FILE, PROVIDER_FILE],
    ] as const) {
      await loadOrCreateSealedSeed(dir, sealed, legacy, { kind: 'passphrase', passphrase: SPEC_PASSPHRASE })
    }
    expect(readdirSync(dir)).toContain(SEALED_IDENTITY_FILE)
    expect(readdirSync(dir)).toContain(SEALED_PROVIDER_FILE)

    const store = await FsBlockstore.open(dir)
    expect(store.size).toBe(0)

    const n = 3
    for (let i = 0; i < n; i++) await store.put(new Uint8Array([i, i + 1, i + 2]))
    expect((await FsBlockstore.open(dir)).size).toBe(n)
  }, 60_000)
})

describe('a short passphrase refuses before anything is derived', () => {
  /**
   * `@libp2p/keychain` enforces 20 characters against NIST SP 800-132
   * (`node_modules/@libp2p/keychain/src/keychain.ts:100-102`); this repository has no
   * reason to be weaker than a library already in its own tree.
   */
  it('rejects by name and names the floor it applied', async () => {
    const dir = join(workdir, 'weak')
    const thrown: unknown = await loadOrCreateSealedSeed(dir, SEALED_IDENTITY_FILE, IDENTITY_FILE, {
      kind: 'passphrase',
      passphrase: 'short',
    }).then(
      () => null,
      (cause: unknown) => cause,
    )
    expect(thrown instanceof Error ? thrown.name : `not an Error: ${JSON.stringify(thrown)}`).toBe(
      'WeakPassphraseError',
    )
    expect(thrown instanceof Error ? thrown.message : '').toContain(`${PASSPHRASE_MIN_LENGTH}`)

    // Nothing was written on the way to refusing.
    expect(dumpDirectory(dir)).toStrictEqual([])
  })
})
