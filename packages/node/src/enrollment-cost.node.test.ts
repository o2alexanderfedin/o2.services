import { spawn } from 'node:child_process'
import type { ChildProcessByStdio } from 'node:child_process'
import type { Readable, Writable } from 'node:stream'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomBytes } from 'node:crypto'
import { verifyCertificate } from '@o2/core'
import type { NodeCertificate } from '@o2/core'
import { SEED_BYTES } from '@o2/libp2p'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

/**
 * AUTH-04, criterion 5 — issuance is finite per provider per window, and a restart does
 * not hand the window back. Measured on the binary the criterion names.
 *
 * ## What this establishes
 *
 * A provider run by `bin/agent.ts --issues-certificates --max-issued-per-window <n>`
 * refuses enrolment **by name** once it has signed `n` certificates in the window, however
 * many free user keys the requester mints — and it goes on refusing after it has been
 * stopped and started again on the same `--dir`. That is the hole Phase 17 measured and
 * named in two parts: the per-user limiter is keyed on `userKey`, which is one
 * `ed25519.keygen()`, and the aggregate budget was per provider **process**.
 *
 * **The restart is the load-bearing reading, and without it nothing here is evidence.** A
 * per-process budget passes every other assertion in this file. So the first provider is
 * stopped, asserted dead, and the second is asserted to be a different process by pid
 * before anything is read from it — the discipline `certificate-verification.node.test.ts`
 * already applies to its offline-verification claim.
 *
 * ## What it does NOT establish, in the plan's own words
 *
 * **A bound made durable, not a per-identity price.** Nothing here makes one identity cost
 * an attacker something they can pay unilaterally; there is no such price in this design
 * and none was built. What is finite is issuance per provider per window, on a quantity no
 * request field can rotate around, and what is new is that exhausting it survives the
 * process.
 *
 * **One reading of criterion 5 this file cannot satisfy, recorded here rather than
 * discovered at verification.** The criterion asks for the N-th identity to be
 * *"demonstrably more expensive than the first"*. What is demonstrated below is that the
 * N-th is **refused** — an unpayable cost inside the window rather than a larger one. A
 * verifier reading the criterion as requiring a *graduated* price should score this
 * PARTIAL, and that is the honest outcome: a criterion is not rewritten to let a phase
 * close.
 *
 * **And the bound has a cost that falls on honest users too.** An attacker who consumes a
 * provider's window also denies enrolment to everybody else against that provider for the
 * rest of it — `serveAgent` serves enrolment unauthenticated, so anyone who can dial can
 * spend it. The architectural answer is the one the whole design rests on: trust is
 * **pinned per verifier**, so a starved provider is routed around by trusting or running
 * another, and nothing global has to recover because nothing global was ever agreed. That
 * answer is an argument and not a reading — every fixture in this repository is
 * single-provider — except for the one half measured below, which is that a second
 * provider is genuinely a second issuer that a peer pinning the first refuses by name.
 *
 * ## No wall-clock claim appears anywhere in this file
 *
 * The measurement is a **refusal**, not a duration. This host has invalidated timing
 * readings under load twice, and *"refused because the provider has signed its quota"* is
 * the stronger claim anyway. The two timeouts below bound wedged processes so they are
 * reported as wedged rather than as hangs; nothing is asserted against them.
 */

const AGENT = fileURLToPath(new URL('./bin/agent.ts', import.meta.url))

/** See `enrollment.node.test.ts` for why an enrolling agent gets more than a plain one. */
const ANNOUNCE_BUDGET_MS = 60_000

/** stdin is piped and never written to — it is what arms `bin/agent.ts`'s orphan leash. */
type AgentProcess = ChildProcessByStdio<Writable, Readable, Readable>

interface Handshake {
  readonly peerId: string
  readonly multiaddrs: string[]
  readonly nodeKey: string
  readonly certificate: NodeCertificate | null
  readonly issuerKey: string | null
}

interface Agent extends Handshake {
  readonly dir: string
  readonly child: AgentProcess
  readonly pid: number
}

/** What a process that left before announcing said on its way out. */
interface Departure {
  readonly code: number | null
  readonly stderr: string
  readonly stdout: string
}

let workdir: string
const agents: Agent[] = []

function launch(dir: string, extraArgs: readonly string[]): AgentProcess {
  return spawn(process.execPath, [AGENT, '--dir', dir, ...extraArgs], {
    stdio: ['pipe', 'pipe', 'pipe'],
  })
}

/** Spawn an agent and wait for its one-line handshake. Fails loudly if it leaves first. */
async function spawnAgent(dir: string, extraArgs: readonly string[] = []): Promise<Agent> {
  const child = launch(dir, extraArgs)
  const handshake = await new Promise<Handshake>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`agent in ${dir} did not announce in time: ${stderr}`)),
      ANNOUNCE_BUDGET_MS,
    )
    let stdout = ''
    let stderr = ''
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    child.stdout.on('data', (chunk: Buffer) => {
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
    child.on('exit', (code) => {
      clearTimeout(timer)
      reject(new Error(`agent in ${dir} exited early with ${String(code)}: ${stderr}`))
    })
  })

  const agent: Agent = { ...handshake, dir, child, pid: child.pid as number }
  agents.push(agent)
  return agent
}

/**
 * Spawn an agent that is expected **not** to announce, and read how it left.
 *
 * The refusals this file is about are readable only from outside: an enroller the provider
 * turned away writes to stderr and leaves, and the exit code is what separates *"your
 * command line is wrong"* from *"somebody else said no"*.
 *
 * **A handshake line is rejected immediately rather than waited out**, and that is not
 * tidiness. Every plant this file is armed against — the aggregate check removed, the
 * durable record made forgetful — turns a refusal into a *successful* enrolment, so the
 * child announces and then serves for ever. Without this arm the reading is the announce
 * budget expiring, sixty seconds later, under a message that names no cause; with it the
 * failure is immediate and says the enroller was certified when it should have been
 * refused. A check whose failure mode is a timeout is a check somebody calls a flake.
 */
async function spawnUntilExit(dir: string, extraArgs: readonly string[]): Promise<Departure> {
  const child = launch(dir, extraArgs)
  return await new Promise<Departure>((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error(`agent in ${dir} neither announced nor exited: ${stderr}`))
    }, ANNOUNCE_BUDGET_MS)
    let stderr = ''
    let stdout = ''
    const done = (outcome: Departure | Error): void => {
      clearTimeout(timer)
      if (outcome instanceof Error) {
        child.kill('SIGKILL')
        reject(outcome)
      } else resolve(outcome)
    }
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
      if (!stdout.includes('\n')) return
      done(
        new Error(
          `agent in ${dir} announced instead of leaving — it was certified where a refusal was expected: ${stdout.slice(0, stdout.indexOf('\n'))}`,
        ),
      )
    })
    child.on('exit', (code) => {
      done({ code, stderr, stdout })
    })
  })
}

/** SIGTERM, then wait for the process to actually be gone. */
async function stopAgent(agent: Agent): Promise<void> {
  if (agent.child.exitCode !== null || agent.child.signalCode !== null) return
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      agent.child.kill('SIGKILL')
      resolve()
    }, 10_000)
    agent.child.on('exit', () => {
      clearTimeout(timer)
      resolve()
    })
    agent.child.kill('SIGTERM')
  })
}

/** Stop one agent out of turn, so `afterEach` does not wait on it a second time. */
async function stopAgentNow(agent: Agent): Promise<void> {
  const at = agents.indexOf(agent)
  if (at >= 0) agents.splice(at, 1)
  await stopAgent(agent)
}

/**
 * Write a **freshly generated** user key file.
 *
 * Fresh on every call, deliberately: a fresh user key is one keygen, and the population
 * this file measures is exactly the one the per-user limiter does not bound. If these keys
 * were shared, a refusal below could be the rate limiter's and the whole reading would be
 * the one Phase 17 already had.
 */
async function freshUserKey(name: string): Promise<string> {
  await mkdir(workdir, { recursive: true })
  const path = join(workdir, `${name}.key`)
  await writeFile(path, randomBytes(SEED_BYTES), { mode: 0o600 })
  return path
}

/** The flags an enroller needs, against a given provider. */
async function enrollerArgs(name: string, providerAddr: string): Promise<string[]> {
  return [
    '--provider-addr',
    providerAddr,
    '--user-key',
    await freshUserKey(name),
    '--operator-id',
    `${name}-ops`,
  ]
}

beforeEach(async () => {
  workdir = await mkdtemp(join(tmpdir(), 'o2-cost-'))
})

afterEach(async () => {
  await Promise.all(agents.splice(0).map((a) => stopAgent(a).catch(() => {})))
  await rm(workdir, { recursive: true, force: true })
}, 40_000)

describe('AUTH-04 — criterion 5, across real bin/agent.ts processes', () => {
  /**
   * One test, because every step is a precondition for the next: a budget that was never
   * spent cannot be exhausted, a provider that was not stopped cannot have resumed, and a
   * refusal from a provider that is merely gone says nothing about a budget.
   *
   * The budget is **one**, so the reading is a handful of spawns rather than twenty. The
   * count is not what makes the reading — nothing below depends on it — and twenty
   * children would have bought a timeout to misreport as a flake.
   */
  it('refuses by name past its stated budget, and still refuses after being restarted on the same directory', async () => {
    const providerDir = join(workdir, 'provider')
    const provider = await spawnAgent(providerDir, [
      '--issues-certificates',
      '--max-issued-per-window',
      '1',
    ])
    expect(provider.issuerKey).not.toBeNull()
    const issuerKey = provider.issuerKey as string
    const providerAddr = provider.multiaddrs[0] as string

    // ---- the first identity is cheap ------------------------------------------------
    const first = await spawnAgent(
      join(workdir, 'n1'),
      await enrollerArgs('n1', providerAddr),
    )
    expect(first.certificate).not.toBeNull()
    const certificate = first.certificate as NodeCertificate
    expect(certificate.issuer).toBe(issuerKey)
    expect(verifyCertificate(certificate, new Set([issuerKey]), Date.now()).ok).toBe(true)

    // ---- the second is refused, and refused for the right reason ---------------------
    // A fresh user key, which is the population the per-user limiter does not bound. So
    // the aggregate refusal is asserted by its own text, and the rate limiter's is
    // asserted **absent**: `certificate: null` alone would equally describe a provider
    // that was simply unreachable.
    const second = await spawnUntilExit(
      join(workdir, 'n2'),
      await enrollerArgs('n2', providerAddr),
    )
    expect(second.stderr).toContain('this provider has issued 1 certificates')
    expect(second.stderr).toContain('(limit 1)')
    expect(second.stderr).not.toContain('has enrolled')
    expect(second.stdout).toBe('')

    // **An exhausted provider is not a misconfigured node.** `refuse` — the one exit-2
    // path on this binary — prints the usage line, and an operator whose provider is
    // merely busy must not be told their command line is wrong.
    expect(second.code).not.toBe(2)
    expect(second.stderr).not.toContain('usage: agent.ts')

    // A refusal is an answer, not a dropped frame: the provider is still serving.
    expect(provider.child.exitCode).toBeNull()
    expect(provider.child.signalCode).toBeNull()

    // ---- the restart, which is the only reading here a per-process budget would fail --
    const firstPid = provider.pid
    await stopAgentNow(provider)
    expect(provider.child.exitCode === null && provider.child.signalCode === null).toBe(false)

    const resumed = await spawnAgent(providerDir, [
      '--issues-certificates',
      '--max-issued-per-window',
      '1',
    ])
    // A genuinely different process, and the same provider: a new pid, and the same
    // signing key, which is what makes it *this* provider resuming rather than another
    // one starting.
    expect(resumed.pid).not.toBe(firstPid)
    expect(resumed.issuerKey).toBe(issuerKey)

    const third = await spawnUntilExit(
      join(workdir, 'n3'),
      await enrollerArgs('n3', resumed.multiaddrs[0] as string),
    )
    expect(third.stderr).toContain('this provider has issued 1 certificates')
    expect(third.stderr).not.toContain('has enrolled')
    expect(third.code).not.toBe(2)

    // ---- a second provider is a second provider, not a second budget -----------------
    // Recorded in the same run so the restart reading is demonstrably about one
    // provider's memory rather than about providers in general. A peer that pinned the
    // first issuer takes nothing from this one: `verifyCertificate` refuses by name.
    const other = await spawnAgent(join(workdir, 'provider-2'), [
      '--issues-certificates',
      '--max-issued-per-window',
      '1',
    ])
    expect(other.issuerKey).not.toBe(issuerKey)

    const fourth = await spawnAgent(
      join(workdir, 'n4'),
      await enrollerArgs('n4', other.multiaddrs[0] as string),
    )
    expect(fourth.certificate).not.toBeNull()
    const fromOther = fourth.certificate as NodeCertificate
    expect(fromOther.issuer).toBe(other.issuerKey)

    const judged = verifyCertificate(fromOther, new Set([issuerKey]), Date.now())
    expect(judged.ok).toBe(false)
    if (judged.ok) return
    expect(judged.failure.kind).toBe('untrusted-issuer')
  }, 300_000)
})

describe('AUTH-04 — a provider states its budget or does not start', () => {
  /**
   * A mistyped budget is refused **at parse**, with the flag and the value named.
   *
   * Without the check the provider starts with `NaN` and then admits or refuses everybody
   * depending on a comparison nobody wrote down, with nothing anywhere reporting that the
   * input was never a number — the same failure `--trusted-issuer`'s validator exists to
   * prevent, and the reason both name the value back rather than only the flag.
   */
  it('exits 2 naming the flag and the value when the budget is not a whole number', async () => {
    for (const bad of ['plenty', '0', '2.5', '-1']) {
      // `--flag=value` rather than `--flag value`, and only because of `-1`. **Measured
      // 2026-08-03**: `parseArgs` refuses the separated form for a value beginning with a
      // dash — `ERR_PARSE_ARGS_INVALID_OPTION_VALUE: Option '--max-issued-per-window'
      // argument is ambiguous` — and that is exit **1** from the parser, before this
      // binary's own validator has seen anything. Written as `=` so all four values reach
      // the check this case exists to prove, rather than three of them proving it and the
      // fourth proving something about Node. The same is true of every string flag on this
      // binary and is not specific to this one.
      const departure = await spawnUntilExit(join(workdir, `bad-${bad}`), [
        '--issues-certificates',
        `--max-issued-per-window=${bad}`,
      ])
      expect(departure.code, `--max-issued-per-window ${bad}`).toBe(2)
      expect(departure.stderr).toContain('--max-issued-per-window')
      expect(departure.stderr).toContain(bad)
      expect(departure.stderr).toContain('usage: agent.ts')
    }
  }, 120_000)

  /**
   * There is **no way to run a provider with no aggregate budget from this binary**, and
   * that is the same posture `--trust-anchor` already takes: the opt-out literal exists in
   * the library for callers that must state it, and the shipped binary carries no switch
   * for it. A provider silently signing an unbounded number of certificates is exactly the
   * state criterion 5 exists to end.
   */
  it('exits 2 when --issues-certificates is given without a budget, and starts when both are', async () => {
    const half = await spawnUntilExit(join(workdir, 'half'), ['--issues-certificates'])
    expect(half.code).toBe(2)
    expect(half.stderr).toContain('--issues-certificates requires --max-issued-per-window')
    expect(half.stderr).toContain('usage: agent.ts')

    // The reverse half: a budget is a statement about issuing, so it is refused on a
    // process that issues nothing rather than accepted and ignored.
    const stray = await spawnUntilExit(join(workdir, 'stray'), ['--max-issued-per-window', '5'])
    expect(stray.code).toBe(2)
    expect(stray.stderr).toContain('--max-issued-per-window')

    // The control, in the same test: an exit 2 on its own is equally well explained by a
    // binary that cannot start at all.
    const complete = await spawnAgent(join(workdir, 'whole'), [
      '--issues-certificates',
      '--max-issued-per-window',
      '3',
    ])
    expect(complete.issuerKey).not.toBeNull()
  }, 120_000)
})
