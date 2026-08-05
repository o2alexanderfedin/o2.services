import { spawn } from 'node:child_process'
import type { ChildProcessByStdio } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Readable, Writable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

/**
 * BENCH-07 — the process that announced an address is the process the parent spawned.
 *
 * ## What `child.pid` does not say
 *
 * A parent that spawns `bin/agent.ts` and reads the handshake line holds two facts that
 * look like one: it started *a* process, and it read *an* address. Nothing connects them.
 * A harness that fell back to starting nodes inside its own process — the exact failure
 * the multi-process benchmark driver has to refuse rather than report a curve about —
 * would still have a `child.pid` for something, and would still read an address from
 * somewhere. Both readings survive the fallback, so neither of them is the check.
 *
 * The correspondence is the check, and it costs one key on a line the binary already
 * writes: the announcing process states its own `process.pid`, and the parent compares it
 * with the pid it was given by `spawn`.
 *
 * ## Why the assertion is an equality and not a presence test
 *
 * `toBeDefined()` and `toBeGreaterThan(0)` both pass against a constant. The whole content
 * of the claim is *which* process is speaking, so the only assertion that carries it is
 * `toBe(child.pid)` — and that is what a planted `pid: 0` reddens where the weaker forms
 * would not.
 *
 * ## The backwards-compatibility half is checked here rather than assumed
 *
 * `peerId` and `multiaddrs` are read off the same parsed line, because the argument for a
 * one-line addition being additive is that every existing parent still finds what it
 * names. That argument is cheap to state and cheap to check, so it is checked.
 *
 * Node-only by necessity: the subject is an operating-system process.
 */

const AGENT = fileURLToPath(new URL('./bin/agent.ts', import.meta.url))

/**
 * stdin is piped and never written to, so the child's type carries a `Writable` for it.
 *
 * The pipe is the point rather than the type. `bin/agent.ts` watches fd 0 and leaves when
 * it closes; `'ignore'` would put `/dev/null` there and silently opt this file out of the
 * leash. See `orphan-leash.node.test.ts`, which demonstrates that and guards this line.
 */
type AgentProcess = ChildProcessByStdio<Writable, Readable, Readable>

/** Every key this file reads. The line carries more; a reader takes what it names. */
interface Handshake {
  readonly peerId: string
  readonly multiaddrs: readonly string[]
  readonly pid: number
}

let workdir: string
let child: AgentProcess | undefined

/**
 * Spawn one agent and resolve its single announcement line.
 *
 * No `--port`: with no `--relay-addr` either, `bin/agent.ts`'s `listen` table binds
 * `/ip4/127.0.0.1/tcp/0`, which is what the `/tcp/` assertion below reads. The rule that
 * would apply here if this file grew a relay flag is stated in `bench-fabric.ts`.
 */
async function spawnAgent(dir: string): Promise<{ child: AgentProcess; handshake: Handshake }> {
  const spawned: AgentProcess = spawn(process.execPath, [AGENT, '--dir', dir], {
    stdio: ['pipe', 'pipe', 'pipe'],
  })

  const handshake = await new Promise<Handshake>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`the agent did not announce in time: ${stderr}`)), 30_000)
    let stdout = ''
    let stderr = ''
    spawned.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    spawned.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
      const newline = stdout.indexOf('\n')
      if (newline === -1) return
      clearTimeout(timer)
      try {
        resolve(JSON.parse(stdout.slice(0, newline)) as Handshake)
      } catch (cause) {
        reject(cause instanceof Error ? cause : new Error(String(cause)))
      }
    })
    // An early exit is turned into a legible failure rather than a hang, and it carries
    // the child's stderr — which is where `refuse` writes and where a crash lands.
    spawned.on('exit', (code) => {
      clearTimeout(timer)
      reject(new Error(`the agent exited early with ${String(code)}: ${stderr}`))
    })
  })

  return { child: spawned, handshake }
}

/** SIGTERM, then wait for the process to actually be gone. */
async function stopAgent(agent: AgentProcess): Promise<void> {
  if (agent.exitCode !== null || agent.signalCode !== null) return
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      agent.kill('SIGKILL')
      resolve()
    }, 10_000)
    agent.on('exit', () => {
      clearTimeout(timer)
      resolve()
    })
    agent.kill('SIGTERM')
  })
}

beforeEach(async () => {
  workdir = await mkdtemp(join(tmpdir(), 'o2-agent-handshake-'))
})

/**
 * Inner 10 s, outer 20 s — and the order is the point.
 *
 * `stopAgent` gives a wedged process 10 s before SIGKILL. Vitest's default `hookTimeout`
 * is also 10 s, so with no explicit budget the framework's clock fires first, the SIGKILL
 * fallback never runs, and a wedged agent is reported as an anonymous hook timeout naming
 * no step. The same reasoning `two-process.node.test.ts` records for its own teardown.
 */
afterEach(async () => {
  if (child !== undefined) await stopAgent(child).catch(() => {})
  child = undefined
  await rm(workdir, { recursive: true, force: true })
}, 20_000)

describe('BENCH-07 — an agent states its own process id on the line it already prints', () => {
  it('announces a pid equal to the pid its parent was handed, alongside the keys every existing reader takes', async () => {
    const spawned = await spawnAgent(join(workdir, 'a'))
    child = spawned.child
    const { handshake } = spawned

    // The premise, stated rather than assumed: `spawn` gave this parent a pid at all.
    expect(typeof child.pid).toBe('number')

    // The reading. Equality, because "a pid is present" is satisfied by any constant and
    // the claim is about *which* process is speaking.
    expect(handshake.pid).toBe(child.pid)

    // The two keys every pre-existing parent of this binary parses, checked here so the
    // "one added key is additive" argument is a reading rather than a sentence.
    expect(typeof handshake.peerId).toBe('string')
    expect(handshake.peerId.length).toBeGreaterThan(0)
    expect(handshake.multiaddrs.some((ma) => ma.includes('/tcp/'))).toBe(true)

    // And it leaves when asked, so this file resides nothing beyond its own run. Read off
    // the process rather than off the signal that was sent: `kill` states an intention.
    await stopAgent(child)
    expect(child.exitCode !== null || child.signalCode !== null).toBe(true)
  }, 30_000)
})
