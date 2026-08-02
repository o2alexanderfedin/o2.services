/**
 * NET-05 criterion 4, across real processes: a full relay says so, to a real joiner.
 *
 * ## What was already measured, and what was not
 *
 * `relaying.node.test.ts` proves the mechanism in one process: a `FabricNode` relay with
 * `maxReservations: 1`, a bare libp2p peer filling it, and a second peer reading
 * `at-capacity` off a `ReservationWatcher`. That is the protocol reading and it stays.
 *
 * **What it cannot show is that any process a person can run reaches it.** Before this
 * file, `ReservationWatcher` was constructed in exactly two places, both of them tests.
 * `bin/agent.ts` never built one, so a real agent that failed to reserve went silent in
 * exactly the way the requirement exists to forbid — and `bin/seed.ts` printed no address
 * an agent could be pointed at, so the criterion's own configuration could not be reached
 * without reading `seed-server.ts`.
 *
 * ## The three readings, and why the middle one is the deliverable
 *
 * | joiner | relay state | what it must report |
 * |---|---|---|
 * | A | one slot free | a granted circuit |
 * | **B** | **full** | **`at-capacity` by name** |
 * | C | unreachable address | `unreachable`, and **still start** |
 *
 * B and C are the pair that matters. A node that cannot reserve and a node whose relay was
 * never there both end up with no `/p2p-circuit` address, and from the outside those look
 * identical — while demanding opposite responses: wait and retry this relay, versus fix
 * the address. **The distinction is measured rather than argued**: B's dial to the seed
 * SUCCEEDS in the same run that its reservation is refused, so "named refusal" and
 * "network outage" are shown to be two different readings and not two names for silence.
 *
 * ## C used to crash, and that is a production change this file forced
 *
 * `FabricNode.start` dialled its relays with a bare `await` and no `try`. Because that
 * runs before the node exists, no caller could catch it and keep the node, and in
 * `bin/agent.ts` — where `start` is a top-level `await` — an unreachable relay surfaced as
 * an **unhandled rejection**: a stack trace, a nonzero exit, and none of the named-refusal
 * reporting every other flag in that binary does. NET-05's own wording is that a node
 * which could not get into one relay can still work, so the dial is now non-fatal and the
 * failure is named. C is the case that holds that.
 *
 * ## Cost
 *
 * One seed process and three agent processes. Spawning the seed was called *a minute of
 * test time* in three files until it was measured at **590 ms**; that estimate is retired
 * and this file does not re-litigate it.
 */
import { spawn } from 'node:child_process'
import type { ChildProcessByStdio } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Readable, Writable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const AGENT = fileURLToPath(new URL('./bin/agent.ts', import.meta.url))
const SEED = fileURLToPath(new URL('./bin/seed.ts', import.meta.url))

/** Matches `certificate-verification.node.test.ts`; the seed's own banner needs far less. */
const ANNOUNCE_BUDGET_MS = 60_000
/** Four processes, one of them booting a dev server. */
const PROCESS_TEST_TIMEOUT = 180_000
/** libp2p retries a reservation internally; the refusal is not instantaneous. */
const REFUSAL_BUDGET_MS = 45_000

type Child = ChildProcessByStdio<Writable, Readable, Readable>

interface Started {
  readonly child: Child
  /** Everything the process has written to stderr so far, accumulating. */
  stderr(): string
  readonly stdout: string
}

let workdir: string
const children: Child[] = []

/**
 * `'pipe'` on fd 0 throughout, and it is load-bearing rather than cosmetic: both binaries
 * arm an orphan leash by watching fd 0, and `'ignore'` hands them a character device,
 * which opts the leash out. `orphan-leash.node.test.ts` fails any spawn site that does.
 */
function launch(bin: string, args: readonly string[]): { child: Child; stderr: () => string } {
  const child: Child = spawn(process.execPath, [bin, ...args], { stdio: ['pipe', 'pipe', 'pipe'] })
  children.push(child)
  let stderr = ''
  child.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk.toString()
  })
  return { child, stderr: () => stderr }
}

/** Wait for a process to write a line containing `sentinel`, and return what it wrote. */
async function waitForStdout(
  child: Child,
  stderrOf: () => string,
  sentinel: string,
  label: string,
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label} never wrote ${JSON.stringify(sentinel)}: ${stderrOf()}`)),
      ANNOUNCE_BUDGET_MS,
    )
    let out = ''
    child.stdout.on('data', (chunk: Buffer) => {
      out += chunk.toString()
      if (!out.includes(sentinel)) return
      clearTimeout(timer)
      resolve(out)
    })
    child.on('exit', (code) => {
      clearTimeout(timer)
      reject(new Error(`${label} exited early with ${String(code)}: ${stderrOf()}`))
    })
  })
}

interface AgentHandshake {
  readonly peerId: string
  readonly multiaddrs: string[]
  readonly relays: string[]
}

/** Spawn an agent and read its one-line handshake, by name. */
async function startAgent(name: string, extra: readonly string[]): Promise<Started & AgentHandshake> {
  const { child, stderr } = launch(AGENT, ['--dir', join(workdir, name), ...extra])
  const out = await waitForStdout(child, stderr, '\n', `agent ${name}`)
  const line = out.slice(0, out.indexOf('\n'))
  const parsed = JSON.parse(line) as AgentHandshake
  return { ...parsed, child, stderr, stdout: out }
}

/** Wait for `probe` to hold, polling. A sleep would be a guess about a retry loop. */
async function until(probe: () => boolean, timeoutMs: number, what: string): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (probe()) return
    await new Promise((r) => setTimeout(r, 50))
  }
  throw new Error(`timed out waiting for ${what}`)
}

beforeEach(async () => {
  workdir = await mkdtemp(join(tmpdir(), 'o2-reservation-'))
})

afterEach(async () => {
  await Promise.all(
    children.splice(0).map(
      (child) =>
        new Promise<void>((resolve) => {
          if (child.exitCode !== null || child.signalCode !== null) return resolve()
          const timer = setTimeout(() => {
            child.kill('SIGKILL')
            resolve()
          }, 10_000)
          child.on('exit', () => {
            clearTimeout(timer)
            resolve()
          })
          child.kill('SIGTERM')
        }),
    ),
  )
  await rm(workdir, { recursive: true, force: true })
  // 40 s, which must exceed the 10 s SIGKILL fallback above or that fallback can never
  // fire and a wedged process is reported as an anonymous hook timeout naming no step.
}, 40_000)

describe('NET-05 criterion 4 — a full seed refuses a real joiner by name', () => {
  it('grants the first joiner, refuses the second as at-capacity, and names an unreachable relay without dying', async () => {
    // One reservation, so a single joiner fills it. `--port 0` and `--ws-port 0` keep the
    // dev server off fixed ports; the seed treats 0 as "pick one".
    const seed = launch(SEED, [
      '--dir',
      join(workdir, 'seed'),
      '--port',
      '0',
      '--ws-port',
      '0',
      '--reservations',
      '1',
    ])
    const banner = await waitForStdout(seed.child, seed.stderr, 'Ctrl-C to stop.', 'seed')

    // The address the operator is meant to use, read off the banner rather than rebuilt
    // here — which is the point of printing it. Loopback specifically: the seed binds
    // 0.0.0.0 and libp2p expands that per interface, so the listing also carries LAN
    // addresses that a CI host may not be able to dial back to itself.
    const relayAddr = banner
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.startsWith('relay '))
      .map((l) => l.slice('relay '.length).trim())
      .find((addr) => addr.includes('/ip4/127.0.0.1/'))
    expect(relayAddr, `no loopback relay address in the seed banner:\n${banner}`).toBeDefined()
    if (relayAddr === undefined) return
    expect(banner).toContain('capacity   1 reservations')

    // ---- A: the relay has room. -------------------------------------------------
    const a = await startAgent('a', ['--relay-addr', relayAddr])
    await until(() => a.relays.length > 0 || a.stderr() !== '', REFUSAL_BUDGET_MS, 'a to settle')
    expect(a.relays.length, `a reported no circuit; stderr was ${a.stderr()}`).toBeGreaterThan(0)
    expect(a.relays[0]).toContain('/p2p-circuit')
    expect(a.stderr()).not.toContain('at-capacity')

    // ---- B: the relay is full. --------------------------------------------------
    // The deliverable. B reports `at-capacity` BY NAME, and the reading is separated from
    // "the relay was not there" by the fact that B reached it: the seed granted A through
    // the very same address, in this run.
    const b = await startAgent('b', ['--relay-addr', relayAddr])
    await until(() => b.stderr().includes('at-capacity'), REFUSAL_BUDGET_MS, 'b to be refused by name')
    expect(b.stderr()).toContain('relay reservation at-capacity: RESERVATION_REFUSED')
    // Named refusal, not an outage: nothing about B's report says unreachable.
    expect(b.stderr()).not.toContain('unreachable')
    // And it started anyway. A node that got into no relay still serves every peer that
    // can reach it directly, which is why it announced a handshake at all.
    expect(b.relays).toStrictEqual([])
    expect(b.child.exitCode).toBeNull()

    // ---- C: the relay is not there. ---------------------------------------------
    // Port 1 is never listening. Before this plan this case did not produce a named
    // refusal OR a quiet start — it produced an unhandled rejection from the relay dial
    // inside `FabricNode.start`, which is why that dial is now non-fatal.
    const c = await startAgent('c', ['--relay-addr', '/ip4/127.0.0.1/tcp/1/ws'])
    // Polled, not read once: the failure lines are written after the handshake, so
    // reading immediately races the flush rather than the behaviour.
    await until(
      () => c.stderr().includes('unreachable:'),
      REFUSAL_BUDGET_MS,
      `c to name its unreachable relay; stderr was ${c.stderr()}`,
    )
    expect(c.stderr()).toContain('relay /ip4/127.0.0.1/tcp/1/ws unreachable:')
    // The other half of the distinction: C says unreachable and never says at-capacity.
    expect(c.stderr()).not.toContain('at-capacity')
    expect(c.relays).toStrictEqual([])
    // Not fatal. It announced, so it is serving.
    expect(c.child.exitCode).toBeNull()
    expect(c.peerId).not.toBe('')
  }, PROCESS_TEST_TIMEOUT)
})
