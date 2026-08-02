import { execFileSync, spawn } from 'node:child_process'
import type { ChildProcessByStdio } from 'node:child_process'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Readable, Writable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

/**
 * A spawned agent does not outlive the process that spawned it, including when that
 * process is killed rather than asked.
 *
 * ## What was actually leaking
 *
 * On POSIX a child does not die with its parent. Every `bin/agent.ts` spawn site in this
 * package tears its agents down in an `afterEach`, and every one of those teardowns is
 * correct — SIGTERM, then SIGKILL on a budget, with the `hookTimeout` raised so the
 * framework's clock cannot fire first. None of it runs when the parent is killed instead
 * of unwound: an interrupted run, a killed Vitest worker, a harness torn down mid-test.
 * **`SIGKILL` runs no handler, by definition**, so no amount of care on the parent side
 * can cover it, and a fix that only demonstrates a graceful parent has demonstrated the
 * case that was never broken.
 *
 * Found by sweeping for strays on 2026-08-01: three agent processes alive from two
 * different sessions, reparented to pid 1, the oldest 20h45m old, each holding a
 * process-table slot and ~14–43 MB. That is the host pressure `tools/aot/lift.ts` gave a
 * name to as `host-cannot-spawn`; this is one of the things that produces it.
 *
 * ## Why these tests spawn a driver rather than spawning an agent directly
 *
 * The subject is what happens to an agent when *its parent* dies, so the parent has to be
 * a process this file can kill — and it cannot be the Vitest worker, because killing that
 * takes the run down with it. So each test writes a small driver, has the driver spawn the
 * agent and report its pid, `SIGKILL`s the driver, and then watches the agent. The driver
 * holds the write end of the agent's stdin pipe, exactly as a Vitest worker does; nothing
 * about the topology is simulated.
 *
 * ## Nothing here trusts an exit code
 *
 * An exit code is a statement made by a process that exited. The claim under test is about
 * a process that might not have, so every assertion polls for the pid itself with
 * `kill(pid, 0)` and reports what it found. Once the driver is dead the agent's parent is
 * pid 1, which reaps it on exit, so a pid that answers is a process that is running rather
 * than a zombie waiting to be collected.
 */

const AGENT = fileURLToPath(new URL('./bin/agent.ts', import.meta.url))
const SEED = fileURLToPath(new URL('./bin/seed.ts', import.meta.url))
const BIN_DIR = fileURLToPath(new URL('./bin/', import.meta.url))
const NODE_SRC = fileURLToPath(new URL('.', import.meta.url))

/**
 * How long the agent gets to leave after its parent is `SIGKILL`ed.
 *
 * Measured at ~250 ms on this machine, unloaded. 10 s is not an estimate of the mechanism
 * — EOF on a closed pipe is immediate — it is headroom for a loaded host, and it is the
 * same 10 s the spawning tests already give a wedged agent before they resort to SIGKILL.
 */
const LEASH_BUDGET_MS = 10_000

/**
 * How long the control agent is watched before its survival is believed.
 *
 * Deliberately shorter than {@link LEASH_BUDGET_MS}: this one asserts a process is *still
 * there*, and every second spent confirming that is a second of runtime bought for a
 * result already visible in the first. The strays that motivated this file survived for
 * hours, not seconds.
 */
const CONTROL_WATCH_MS = 3_000

const POLL_MS = 100

/**
 * The binaries under test, and what each one needs to be driven honestly.
 *
 * Both are long-running servers spawned by tests, so both carry the leash and both are
 * checked the same way. They differ only in how they announce and in how long their
 * startup writes take to drain — see {@link Binary.settleMs}, which is not a fudge factor
 * and is the finding that made the first version of the seed case worthless.
 */
interface Binary {
  readonly label: string
  readonly path: string
  readonly args: (dir: string) => readonly string[]
  /** Substring that means startup is finished, not merely begun. */
  readonly sentinel: string
  /**
   * How long to let the child's startup writes drain before killing its parent.
   *
   * **Measured, and it inverted a result.** The seed writes a banner, a QR code and three
   * more lines *after* its first newline. Killing the driver the moment a first line
   * appeared closed the read end of a pipe the seed was still writing to, and the seed died
   * of EPIPE in ~50 ms — with the leash armed *and* with it disarmed, and in the `'ignore'`
   * control too. All three arms went green, and none of them was measuring the leash.
   *
   * The agent announces once, at the end, so it never had this problem and 0 is honest for
   * it. Stating both values here rather than applying one number to both keeps the seed's
   * cost off the agent's case and keeps the reason attached to the binary that has it.
   */
  readonly settleMs: number
  /** Anything the reader needs that is specific to this binary. */
  readonly note: string
}

const BINARIES: readonly Binary[] = [
  {
    label: 'agent',
    path: AGENT,
    args: (dir) => ['--dir', dir],
    // The handshake line, which is the only thing it writes.
    sentinel: '\n',
    settleMs: 0,
    note: 'announces once, at the end of startup, and writes nothing after',
  },
  {
    label: 'seed',
    path: SEED,
    // Not an ephemeral port, and worth knowing before relying on it: Vite treats a
    // requested port of 0 as its own default and then increments past anything already
    // bound. Two seeds started together were measured landing on 5174 and 5175, so
    // concurrent runs do not collide — but nothing here may assume the port is arbitrary.
    args: (dir) => ['--dir', dir, '--port', '0', '--ws-port', '0'],
    sentinel: 'Ctrl-C to stop.',
    settleMs: 1_500,
    note: 'writes a banner, a QR code and three more lines after its first newline',
  },
]

/**
 * The driver, written to the workdir at run time rather than committed beside this file.
 *
 * It lives here because its behaviour is the premise of every assertion below — which
 * `stdio` it hands the child, and that it reports the pid only *after* the child has
 * finished announcing. A reader checking whether the demonstration is honest should not
 * have to open a second file to do it.
 *
 * **`fd0` arrives as an argument and is never written as a literal here.** That is not
 * style: the guard at the bottom of this file fails any spawn site that puts `'ignore'` on
 * a binary's fd 0, and a control that hard-coded the string would be caught by the very
 * rule it exists to justify. Passing it in keeps the guard free of self-exemptions.
 */
const DRIVER_SOURCE = `
import { spawn } from 'node:child_process'

const [bin, fd0, specJson] = process.argv.slice(2)
const { args, sentinel } = JSON.parse(specJson)
const child = spawn(process.execPath, [bin, ...args], { stdio: [fd0, 'pipe', 'pipe'] })

let out = ''
let announced = false
child.stdout.on('data', (chunk) => {
  out += String(chunk)
  if (announced || out.indexOf(sentinel) === -1) return
  announced = true
  // Reported only now. A pid printed at spawn time would let the test kill this process
  // during the child's startup, which is a different claim from the one being made.
  process.stdout.write(JSON.stringify({ pid: child.pid }) + '\\n')
})

let err = ''
child.stderr.on('data', (chunk) => {
  err += String(chunk)
})
child.on('exit', (code) => {
  process.stdout.write(JSON.stringify({ childExited: code, stderr: err }) + '\\n')
})

// Never leave unbidden: the test decides when this process dies, and it kills it.
setInterval(() => {}, 60_000)
`

type DriverProcess = ChildProcessByStdio<Writable, Readable, Readable>

interface Driver {
  readonly child: DriverProcess
  readonly childPid: number
}

let workdir: string
const drivers: Driver[] = []

/** Does a process with this pid exist? `EPERM` is an answer of yes. */
function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (cause) {
    return (cause as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/** What a surviving process actually is, so a red run names it rather than a number. */
function describeProcess(pid: number): string {
  try {
    return execFileSync('ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8' }).trim()
  } catch {
    return '<no ps output>'
  }
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Poll until the pid is gone, and return a sentence either way.
 *
 * A verdict string rather than a boolean so the failing comparison prints what survived
 * and for how long. `expect(false).toBe(true)` names nothing, and this is a test whose
 * whole subject is a process nobody can see.
 */
async function waitForGone(pid: number, budgetMs: number): Promise<string> {
  const deadline = Date.now() + budgetMs
  for (;;) {
    if (!isAlive(pid)) return `child ${String(pid)} gone`
    if (Date.now() >= deadline) {
      return `child ${String(pid)} SURVIVED ${String(budgetMs)}ms after its parent was SIGKILLed: ${describeProcess(pid)}`
    }
    await sleep(POLL_MS)
  }
}

/** Spawn a driver, wait for it to report a fully started child's pid. */
async function startDriver(binary: Binary, name: string, fd0: 'pipe' | 'ignore'): Promise<Driver> {
  const driverPath = join(workdir, `${name}.mjs`)
  await writeFile(driverPath, DRIVER_SOURCE)

  const spec = JSON.stringify({ args: binary.args(join(workdir, name)), sentinel: binary.sentinel })
  const child: DriverProcess = spawn(process.execPath, [driverPath, binary.path, fd0, spec], {
    stdio: ['pipe', 'pipe', 'pipe'],
  })

  const childPid = await new Promise<number>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`driver ${name} reported no child in time: ${stderr}`)), 60_000)
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
      const line = JSON.parse(stdout.slice(0, newline)) as { pid?: number; childExited?: number; stderr?: string }
      if (typeof line.pid !== 'number') {
        reject(new Error(`driver ${name} reported a child exit instead of a pid: ${JSON.stringify(line)}`))
        return
      }
      resolve(line.pid)
    })
    child.on('exit', (code) => {
      clearTimeout(timer)
      reject(new Error(`driver ${name} exited early with ${String(code)}: ${stderr}`))
    })
  })

  // The child has announced, but announcing is not the same as having finished writing.
  // See `Binary.settleMs` for the measurement that distinction cost.
  await sleep(binary.settleMs)

  const driver: Driver = { child, childPid }
  drivers.push(driver)
  return driver
}

beforeEach(async () => {
  workdir = await mkdtemp(join(tmpdir(), 'o2-orphan-leash-'))
})

/**
 * Teardown that assumes nothing survived gracefully, because this file deliberately
 * creates a process that does survive.
 *
 * Everything is `SIGKILL`ed unconditionally: the drivers are already dead in the passing
 * case and killing a dead pid is a caught `ESRCH`, while the control's agent is an orphan
 * by design and no polite signal is owed to it. A file that demonstrates a leak has to be
 * the one file that certainly cleans up after itself.
 */
afterEach(async () => {
  for (const { child, childPid } of drivers.splice(0)) {
    try {
      child.kill('SIGKILL')
    } catch {
      // Already gone — the ordinary case for the driver in every test here.
    }
    try {
      process.kill(childPid, 'SIGKILL')
    } catch {
      // Already gone — the ordinary case for a leashed child.
    }
  }
  await rm(workdir, { recursive: true, force: true })
}, 30_000)

// `$label` and not `$label.ts`: vitest reads `$a.b` as a nested property path, so the
// dotted form resolved `label.ts` and every suite was titled `bin/undefined` — which is
// only visible when one of them fails, and is exactly then that it matters.
describe.each(BINARIES)('a spawned $label binary does not outlive a SIGKILLed parent', (binary) => {
  it('leaves when the parent holding its stdin pipe is SIGKILLed', async () => {
    const { child, childPid } = await startDriver(binary, `${binary.label}-leashed`, 'pipe')

    // The premise, stated rather than assumed: there is a live process to lose. Without
    // this, a test that never started one would pass for the wrong reason.
    expect(isAlive(childPid), `${binary.label} ${String(childPid)} was not running before its parent was killed`).toBe(
      true,
    )

    // SIGKILL and not SIGTERM. SIGTERM would run the driver's handlers, and a parent that
    // gets to run handlers is the case that was never broken.
    child.kill('SIGKILL')

    expect(await waitForGone(childPid, LEASH_BUDGET_MS)).toBe(`child ${String(childPid)} gone`)
  }, 90_000)

  /**
   * The control, and it is load-bearing three times over.
   *
   * It proves the assertion above can fail — a process whose fd 0 is `/dev/null` really
   * does survive its parent, so the first test is measuring the leash rather than some
   * unrelated tidiness in the harness. It pins the gate's other half: the leash arms only
   * for a socket or a FIFO, and **a terminal is a character device exactly as `/dev/null`
   * is**, so this is also the evidence that an operator running the binary by hand keeps a
   * node that stays up. Measured separately under a real pty (`script -q /dev/null node
   * …`): fd 0 reports a character device with `isatty` true, and the leash does not arm.
   *
   * The third thing it catches is specific to `bin/seed.ts` and was caught by it. Killing
   * the driver before the seed's startup writes had drained killed the seed by EPIPE
   * instead of by EOF — which is *also* a dead process, so the leashed case above went
   * green while measuring nothing. This control went green at the same moment, and that
   * disagreement is what exposed it. See `Binary.settleMs`.
   *
   * Independently confirmed against a planted mutation: with `armOrphanLeash(shutdown)`
   * commented out of `bin/seed.ts`, the leashed case survived the full 10 s budget.
   *
   * The orphan it creates is killed in `afterEach`, unconditionally.
   */
  it('survives that same parent when fd 0 is a character device, which is what makes the leash a leash', async () => {
    const { child, childPid } = await startDriver(binary, `${binary.label}-unleashed`, 'ignore')

    expect(isAlive(childPid), `${binary.label} ${String(childPid)} was not running before its parent was killed`).toBe(
      true,
    )
    child.kill('SIGKILL')

    const verdict = await waitForGone(childPid, CONTROL_WATCH_MS)
    expect(verdict).toBe(
      `child ${String(childPid)} SURVIVED ${String(CONTROL_WATCH_MS)}ms after its parent was SIGKILLed: ${describeProcess(childPid)}`,
    )
  }, 90_000)
})

/**
 * Every spawn site of every binary hands it a pipe, checked against the sources.
 *
 * The runtime fix is opt-in by construction: a process spawned with `'ignore'` on fd 0 gets
 * `/dev/null`, and `/dev/null` is a character device, so the leash does not arm and the
 * process leaks exactly as before. That is the right shape — it is what keeps an operator's
 * terminal safe — but it means the fix can be undone one spawn site at a time by anyone
 * writing a new test, with no failure anywhere to say so. The tests above cover the
 * mechanism; this covers its adoption.
 *
 * **This used to read `bin/agent.ts` and nothing else**, which is how it stayed silent
 * while `bin/seed.ts` had no leash at all. It now derives the list from the directory, so a
 * binary added later is covered without anyone remembering to add it here.
 */
describe('every bin spawn site keeps the leash', () => {
  /** `'inherit'` is here too: it puts the *Vitest worker's* stdin on the child, which is not this parent's pipe. */
  const OPTED_OUT = /stdio:\s*\[\s*'(?:ignore|inherit)'/

  it('passes no ignored or inherited stdin to any bin it spawns', async () => {
    const bins = (await readdir(BIN_DIR)).filter((name) => name.endsWith('.ts')).sort()
    expect(bins.length, 'found no binaries to guard').toBeGreaterThan(0)

    const files = (await readdir(NODE_SRC)).filter((name) => name.endsWith('.test.ts')).sort()

    const spawnSites: string[] = []
    const optedOut: string[] = []
    for (const file of files) {
      const source = await readFile(join(NODE_SRC, file), 'utf8')
      if (!bins.some((bin) => source.includes(`bin/${bin}`)) || !source.includes('spawn(')) continue
      spawnSites.push(file)
      if (OPTED_OUT.test(source)) optedOut.push(file)
    }

    expect(optedOut).toEqual([])

    // A guard that found nothing to guard passes silently and forever. The count is the ten
    // files that spawned a binary when the seed was leashed; a new spawn site raises it and
    // is welcome to, but it may not fall.
    expect(
      spawnSites.length,
      `expected the known bin spawn sites, found ${spawnSites.join(', ')}`,
    ).toBeGreaterThanOrEqual(10)
  })
})

/**
 * Every binary in `bin/` either arms the leash or is a declared exception.
 *
 * The guard above is about the **parent** handing over a pipe. This one is about the
 * **child** doing anything with it, and they are genuinely separate: for six days
 * `bin/seed.ts` would have been handed a perfectly good pipe and ignored it, because it
 * never called the mechanism at all. Nothing failed, because nothing looked.
 *
 * Written as a whitelist over the real directory rather than a list of known binaries, so
 * a new `bin/*.ts` fails here until somebody decides which it is. That is the point: the
 * decision is cheap to make and expensive to forget.
 */
describe('every bin either arms the leash or says why not', () => {
  /**
   * Binaries that legitimately do not arm it, each with the reason.
   *
   * `bench.ts` is one-shot: it is `await main()` at module scope over the memory transport,
   * it binds no socket, and the process ends when the work does. There is nothing to
   * outlive a parent. **This changes when it grows `--discover`** — plan 18-06 has it
   * spawning agents, at which point it is both a parent and long-lived, and this entry
   * should be deleted rather than amended.
   */
  const EXEMPT: readonly { readonly bin: string; readonly why: string }[] = [
    { bin: 'bench.ts', why: 'one-shot: await main() at module scope, no listener, exits when the work does' },
  ]

  it('arms it in every binary that outlives its own startup', async () => {
    const bins = (await readdir(BIN_DIR)).filter((name) => name.endsWith('.ts')).sort()
    expect(bins.length, 'found no binaries to guard').toBeGreaterThan(0)

    const missing: string[] = []
    for (const bin of bins) {
      if (EXEMPT.some((entry) => entry.bin === bin)) continue
      const source = await readFile(join(BIN_DIR, bin), 'utf8')
      if (!source.includes('armOrphanLeash(')) missing.push(bin)
    }

    expect(
      missing,
      `these binaries never call armOrphanLeash and are not in EXEMPT: ${missing.join(', ')}. ` +
        `Either arm the leash (see ../orphan-leash.ts) or add an entry saying why the process ` +
        `cannot outlive its parent.`,
    ).toEqual([])

    // An exemption for a binary that no longer exists is a stale claim, and the next reader
    // would take it for a live one.
    expect(EXEMPT.map((entry) => entry.bin).filter((bin) => !bins.includes(bin))).toEqual([])
  })
})
