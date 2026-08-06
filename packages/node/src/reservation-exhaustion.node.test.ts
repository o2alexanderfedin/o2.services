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
 * ## This file reads an OPEN DOOR as evidence — AUTH-02, recorded 2026-08-06
 *
 * `grep -cE "enrol|provider-addr|issuesCertificates"` over this file returns **0**. Its three
 * agents never enrol and obtain reservations regardless, which was an ambient fact until Plan
 * 24-03 armed `connectionGater.denyInboundRelayReservation` on `FabricNode`. It is now a
 * **stated dependency**: this file measures capacity refusal, and capacity refusal is only
 * observable on a relay that would otherwise have admitted the peer.
 *
 * **This file owns no `relayAdmission` literal to assert on.** Its relay is a spawned
 * `bin/seed.ts`, and that binary deliberately has no admission flag — 24-01 recorded pinning
 * the seed's posture as *"a later decision and deliberately not taken here"* — so the value
 * lives in `seed-server.ts`, a production file this fixture does not own and must not pin
 * from here. The assertion available to it is therefore **behavioural: joiner A was granted**,
 * asserted before B's refusal is read, and the note at A's arm explains why that ordering is
 * the difference between this case's title being satisfied and being satisfied by the wrong
 * mechanism.
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

/**
 * The half of "still serving directly" that this file used to assert nowhere.
 *
 * **Verification warning W10, 2026-08-04.** Both surviving cases claimed a node refused by a
 * relay, or unable to reach one, *"still serves every peer that can reach it directly"* — and
 * asserted only `relays === []` and `exitCode === null`. Neither reads a dialable address,
 * though `multiaddrs` has been on the handshake since the file was written. The docblock at the
 * head of this file names that exact failure mode, twelve lines above the assertions that missed
 * it, which is why it survived: **the claim was made in prose and checked nowhere.**
 *
 * Proved rather than argued: with `bin/agent.ts` planted to bind nothing, this file exited **0,
 * 1 passed** — a node serving no one satisfied every assertion about it serving directly.
 *
 * A `/p2p-circuit` address is excluded deliberately. It is exactly what these two nodes do not
 * have, and counting one would make the check pass for the node it exists to catch.
 */
function expectStillServingDirectly(node: AgentHandshake, label: string): void {
  const direct = node.multiaddrs.filter((address) => !address.includes('/p2p-circuit'))
  expect(direct, `${label} announced no non-circuit address: ${JSON.stringify(node.multiaddrs)}`).not.toHaveLength(0)
}

/**
 * Spawn an agent and read its one-line handshake, by name.
 *
 * **`--port 0` is stated rather than left to a default, and every case below depends on
 * it.** Until 2026-08-04 `bin/agent.ts` gave `--port` a default of `'0'`, so an agent
 * given `--relay-addr` bound a real address *and* asked for a circuit; Plan 19-19 removed
 * that default so that omitting `--port` alongside `--relay-addr` now produces a node that
 * binds **nothing** — the browser's topology, which quorum rule 2 needs a process to be
 * able to express.
 *
 * This file wants the old behaviour, and not incidentally: cases B and C assert that a node
 * refused by a full relay, and a node whose relay is not there, each *started anyway* and is
 * *still serving directly*. A node binding nothing would announce a handshake carrying no
 * dialable address at all, and both of those sentences would quietly stop being true while
 * the assertions stayed green. So the binding is now said out loud here.
 */
async function startAgent(name: string, extra: readonly string[]): Promise<Started & AgentHandshake> {
  const { child, stderr } = launch(AGENT, ['--dir', join(workdir, name), '--port', '0', ...extra])
  const out = await waitForStdout(child, stderr, '\n', `agent ${name}`)
  const line = out.slice(0, out.indexOf('\n'))
  const parsed = JSON.parse(line) as AgentHandshake
  return { ...parsed, child, stderr, stdout: out }
}

/**
 * Wait for `probe` to hold, polling. A sleep would be a guess about a retry loop.
 *
 * **`detail` is a thunk, and that is the whole point of it rather than a style choice.**
 * The evidence a timeout needs is what the process said *during* the wait, so a string
 * built at the call site reports the state before the waiting started — which is empty,
 * every time. This file shipped exactly that: case C passed `` `… stderr was ${c.stderr()}` ``,
 * a template literal evaluated on entry, so it appeared to carry a diagnostic and carried
 * a snapshot of nothing. Evaluated here, at the throw, it carries what actually arrived.
 */
async function until(
  probe: () => boolean,
  timeoutMs: number,
  what: string,
  detail?: () => string,
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (probe()) return
    await new Promise((r) => setTimeout(r, 50))
  }
  throw new Error(`timed out waiting for ${what}${detail === undefined ? '' : `; ${detail()}`}`)
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
    //
    // **A's grant is this file's posture assertion — AUTH-02, added 2026-08-06.** See the
    // header for why this file has no `relayAdmission` literal of its own to read: its relay
    // is a spawned `bin/seed.ts`, whose posture is a literal inside `seed-server.ts`, and
    // reaching into a production file from a fixture that does not own it would pin a line
    // this file has no business pinning. The available instrument is therefore behavioural,
    // and this is it.
    //
    // **Asserted BEFORE B's refusal is read, and the ordering is the whole point.** Under a
    // seed that pinned an issuer, A is refused too — none of these agents enrols — and B would
    // then be "refused" for the wrong reason while this case's title still read as satisfied.
    // That is a tautology of exactly the kind this repository has already carried two criteria
    // at PARTIAL for.
    const a = await startAgent('a', ['--relay-addr', relayAddr])
    await until(() => a.relays.length > 0 || a.stderr() !== '', REFUSAL_BUDGET_MS, 'a to settle')
    expect(
      a.relays.length,
      `a reported no circuit, so this seed is not admitting every peer and B's refusal below ` +
        `would be about admission rather than capacity; stderr was ${a.stderr()}`,
    ).toBeGreaterThan(0)
    expect(a.relays[0]).toContain('/p2p-circuit')
    expect(a.stderr()).not.toContain('at-capacity')
    // And not refused for admission either. `bin/agent.ts` prints
    // `relay reservation <kind>: <status>`, so a certificate refusal reads `refused:
    // PERMISSION_DENIED` — a distinct string from the `at-capacity: RESERVATION_REFUSED` this
    // file is about. Naming it here is what makes the two failure modes separable in a run.
    expect(a.stderr()).not.toContain('PERMISSION_DENIED')

    // ---- B: the relay is full. --------------------------------------------------
    // The deliverable. B reports `at-capacity` BY NAME, and the reading is separated from
    // "the relay was not there" by the fact that B reached it: the seed granted A through
    // the very same address, in this run.
    const b = await startAgent('b', ['--relay-addr', relayAddr])
    await until(
      () => b.stderr().includes('at-capacity'),
      REFUSAL_BUDGET_MS,
      'b to be refused by name',
      // The file's own deliverable was the one wait that reported nothing on failure,
      // while C's reported a snapshot taken before the wait. Both now name what arrived.
      () => `b's stderr was ${JSON.stringify(b.stderr())}`,
    )
    expect(b.stderr()).toContain('relay reservation at-capacity: RESERVATION_REFUSED')
    // Named refusal, not an outage: nothing about B's report says unreachable.
    expect(b.stderr()).not.toContain('unreachable')
    // And it started anyway. A node that got into no relay still serves every peer that
    // can reach it directly, which is why it announced a handshake at all.
    expect(b.relays).toStrictEqual([])
    expect(b.child.exitCode).toBeNull()
    expectStillServingDirectly(b, 'b')

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
      'c to name its unreachable relay',
      () => `c's stderr was ${JSON.stringify(c.stderr())}`,
    )
    expect(c.stderr()).toContain('relay /ip4/127.0.0.1/tcp/1/ws unreachable:')
    // The other half of the distinction: C says unreachable and never says at-capacity.
    expect(c.stderr()).not.toContain('at-capacity')
    expect(c.relays).toStrictEqual([])
    // Not fatal. It announced, so it is serving.
    expect(c.child.exitCode).toBeNull()
    expect(c.peerId).not.toBe('')
    expectStillServingDirectly(c, 'c')
  }, PROCESS_TEST_TIMEOUT)
})
