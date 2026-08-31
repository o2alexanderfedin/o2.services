import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import type { Server } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'

import {
  DAEMON_PROBE_TIMEOUT_MS,
  IMAGE_PROBE_TIMEOUT_MS,
  classifyImageProbe,
  classifyReach,
  describeGate,
  gateOnImage,
  isRunnable,
  isUndetermined,
  probeDockerReach,
} from './docker-gate.ts'
import type { DockerReach, ProbeOutcome } from './docker-gate.ts'

/**
 * AOT-GATE — a refusal that names the right thing, proved against a daemon that is really
 * not there.
 *
 * ## What went wrong, measured
 *
 * On 2026-08-12, with this host's OrbStack daemon wedged — its socket accepting and never
 * answering — `tools/aot/lift.node.test.ts` went **RED** while **47 cases** across
 * `elflift-wasi-gate`, `echo-guest` and `elfconv-differential` **SKIPPED**. One host, one
 * cause, two dispositions, and the red said *"the gate never found out … this host could
 * not be asked"* — a sentence about this machine's process table, for a container runtime
 * that had died.
 *
 * The mechanism was not "lift is stricter than its siblings". It was that `lift`'s gate
 * asked `docker image inspect`, which answers two questions through one exit code, and
 * **which wrong answer you got depended on how the daemon was down**:
 *
 * - socket refusing → exit 1 → read as *the image is absent* → **silent skip, false claim**
 * - socket accepting and hanging → `ETIMEDOUT` → read as *the host could not ask* → **red**
 *
 * Both are `daemon-unreachable`, and neither was named.
 *
 * ## What this file has to hold, and it is not "the gate skips"
 *
 * A gate that always skips would satisfy the brief and destroy the suite. So every case
 * below is about **telling conditions apart**, and three of them drive the real `docker`
 * client against conditions this host can really be put into:
 *
 * | case | condition, constructed | expected |
 * |---|---|---|
 * | refusing socket | `DOCKER_HOST` at a path that does not exist | `daemon-unreachable` |
 * | wedged socket | a `net` server that accepts and never writes | `daemon-unreachable` |
 * | no client | a `docker` path that is not an executable | `docker-absent` |
 * | a client that answers | a stub that prints `linux` and exits 0 | `daemon-answering` |
 *
 * The last row is the one that keeps this honest. A `probeDockerReach` reduced to a
 * constant — the shape "make it always skip" takes — fails it, and fails the `docker-absent`
 * row too.
 *
 * ## And a real lift must still be able to go red
 *
 * Nothing here weakens that. `lift.node.test.ts`'s seven integration cases stay gated on
 * `image-present` and on nothing else, so a daemon that answers and an image that is here
 * put every one of them on the hook exactly as before — see `liftedArtifact()` there, which
 * turns a failed lift into a named red rather than an early return. The last case in this
 * file asserts the disposition table itself, so a future edit that quietly moves a red into
 * the skip column has to move this line too.
 */



const dirs: string[] = []
const servers: Server[] = []

function scratch(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  dirs.push(dir)
  return dir
}

/** What a stub `docker` was asked, one argv per line, in the order it was asked. */
function readLog(path: string): readonly string[] {
  if (!existsSync(path)) return []
  return readFileSync(path, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
}

/** A `docker` that is a shell script, so a probe can be given an answer without a daemon. */
function stubDocker(body: string): string {
  const path = join(scratch('o2-gate-stub-'), 'docker')
  writeFileSync(path, `#!/bin/sh\n${body}\n`)
  chmodSync(path, 0o755)
  return path
}

/**
 * How long a trivial `#!/bin/sh` stub takes to spawn **on this host, in this run**.
 *
 * ## Why this is measured rather than written down — and it cost a whole lane to find out
 *
 * `PROBE_BUDGET_MS` below was the literal `3_000`, sited on 2026-08-12 against a quiet host
 * where the real `docker` client answered in 180 ms. **On 2026-08-30 a full `aot` lane turned
 * four cases in this file red**, all four of them stub cases — cases that never touch the
 * daemon at all — each failing at ~3 004 ms with *"THE DOCKER DAEMON IS NOT ANSWERING"*. The
 * daemon was up: `docker version` measured `real 0.04` three times on the same host minutes
 * later. What exceeded 3 000 ms was **spawning a two-line shell script**, because the lane's
 * own elfconv containers had the machine saturated.
 *
 * That is the failure mode `CLAUDE.md` § Measurement names outright: *"An absolute threshold
 * silently encodes the machine, the load and the I/O weather of the day it was written, and
 * then fails somewhere else for reasons that have nothing to do with the code."* The old
 * docblock even carried the evidence against itself — it recorded a stub spawn at *p90 328 ms
 * under load average 54* and then sited the budget ten times that, which is not a margin on a
 * machine that can be an order of magnitude slower again.
 *
 * So the budget is now a **ratio taken inside the same run**: the calibration below spawns the
 * cheapest possible stub three times and keeps the slowest, and every probe budget is sited
 * against that. On a quiet host it reads a few milliseconds and the floor holds the old
 * behaviour; under a loaded lane it scales with the thing that actually slowed down.
 *
 * The subject of these cases is the gate's **classification**, never the wait. Making the wait
 * load-adaptive therefore weakens no claim: the shipped defaults are asserted separately, by
 * the last case in this file, so a change to `DAEMON_PROBE_TIMEOUT_MS` still cannot hide here.
 */
const STUB_SPAWN_MS: number = (() => {
  const probe = stubDocker('exit 0')
  let slowest = 0
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const started = Date.now()
    // A generous ceiling: this call is the calibration, so it must not itself be the thing
    // that times out. If even this cannot complete the host is not in a state to be measured.
    spawnSync(probe, ['version'], { timeout: 60_000, encoding: 'utf8' })
    slowest = Math.max(slowest, Date.now() - started)
  }
  return slowest
})()

/**
 * The wait handed to the probe — **20× the calibration, floored at the historical 3 s.**
 *
 * Twenty rather than three, because the reading it has to survive is a spawn under a machine
 * running container work, and the 2026-08-30 lane showed that population sitting at least an
 * order of magnitude above the quiet one. Floored so a quiet host keeps exactly the behaviour
 * the two wedged-socket cases were sited against: they deliberately wait this long, and
 * shortening it below 3 s would change what they measure.
 */
const PROBE_BUDGET_MS: number = Math.max(3_000, STUB_SPAWN_MS * 20)

/**
 * Wide enough for four spawns of the real `docker` client plus two deliberate waits of
 * {@link PROBE_BUDGET_MS}, and it scales with them for the reason {@link STUB_SPAWN_MS}
 * gives — a case budget pinned while the wait inside it moves is a case that times out
 * instead of failing on its subject.
 */
const CASE_BUDGET_MS: number = Math.max(30_000, PROBE_BUDGET_MS * 10)

// Printed rather than assumed: a reader diagnosing a red in this file needs to know which
// population the run was taken in, and the number is worthless after the run.
console.log(
  `[docker-gate calibration] stub spawn ${String(STUB_SPAWN_MS)} ms -> probe budget ` +
    `${String(PROBE_BUDGET_MS)} ms, case budget ${String(CASE_BUDGET_MS)} ms`,
)

vi.setConfig({ testTimeout: CASE_BUDGET_MS })

/**
 * A unix socket that accepts a connection and never writes a byte — the wedged daemon,
 * reproduced rather than described.
 *
 * The path is short and directly under `/tmp` on purpose: `sun_path` is 104 bytes on macOS
 * and a `mkdtemp` under `$TMPDIR` overruns it. A first attempt did exactly that and the
 * server died `listen EINVAL`, which is worth recording because the failure names the
 * argument rather than the length.
 */
function wedgedSocket(): Promise<string> {
  const path = join('/tmp', `o2gate-${String(process.pid)}-${String(servers.length)}.sock`)
  rmSync(path, { force: true })
  const server = createServer((socket) => {
    socket.on('error', () => {})
  })
  servers.push(server)
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(path, () => {
      resolve(path)
    })
  })
}

afterAll(() => {
  for (const server of servers) server.close()
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
})

/** A synthetic observation. Every field is stated, so no default can carry an assertion. */
function outcome(fields: Partial<ProbeOutcome>): ProbeOutcome {
  return {
    status: fields.status ?? null,
    errno: fields.errno ?? null,
    stdout: fields.stdout ?? '',
    stderr: fields.stderr ?? '',
    message: fields.message ?? null,
  }
}

const ANSWERING = (): DockerReach => ({ kind: 'daemon-answering', serverOs: 'linux' })
const UNREACHABLE = (): DockerReach => ({
  kind: 'daemon-unreachable',
  detail: 'failed to connect to the docker API at unix:///nonexistent/does-not-exist.sock',
})

// ---------------------------------------------------------------------------
// The classifier, over observations written down rather than provoked.
// ---------------------------------------------------------------------------

describe('the reach classifier tells four conditions apart', () => {
  it('calls exit 0 a daemon that answered, and keeps what it said', () => {
    expect(classifyReach(outcome({ status: 0, stdout: 'linux' }))).toEqual({
      kind: 'daemon-answering',
      serverOs: 'linux',
    })
  })

  it('calls a refused connection unreachable, carrying the client’s own words', () => {
    // Verbatim from this host on 2026-08-12, docker 29.4.0, with
    // DOCKER_HOST=unix:///nonexistent/does-not-exist.sock. Kept as a literal because the
    // end-to-end case below must be shown to produce this same shape.
    const stderr =
      'failed to connect to the docker API at unix:///nonexistent/does-not-exist.sock; ' +
      'check if the path is correct and if the daemon is running: dial unix ' +
      '/nonexistent/does-not-exist.sock: connect: no such file or directory'
    const reach = classifyReach(outcome({ status: 1, stderr }))
    expect(reach.kind).toBe('daemon-unreachable')
    expect(reach.kind === 'daemon-unreachable' && reach.detail).toBe(stderr)
  })

  it('calls a client that never came back unreachable, not a host that could not ask', () => {
    // The measured wedge. `spawnSync`'s timeout reports ETIMEDOUT with a null status —
    // and reading that as "this host could not put the question" is the whole defect.
    const reach = classifyReach(
      outcome({ errno: 'ETIMEDOUT', message: 'spawnSync docker ETIMEDOUT' }),
    )
    expect(reach.kind).toBe('daemon-unreachable')
    expect(isUndetermined(reach)).toBe(false)
  })

  it('calls ENOENT an absent client, which is a statement about docker and not the daemon', () => {
    expect(classifyReach(outcome({ errno: 'ENOENT', message: 'spawn docker ENOENT' })).kind).toBe(
      'docker-absent',
    )
  })

  it('calls a host that could not fork undetermined, which is the one red', () => {
    // EAGAIN is not a state a spec can put this machine into, so it is asserted here and
    // the wiring that feeds it is asserted separately by the end-to-end cases.
    const reach = classifyReach(outcome({ errno: 'EAGAIN', message: 'spawn docker EAGAIN' }))
    expect(reach.kind).toBe('undetermined')
    expect(isUndetermined(reach)).toBe(true)
  })
})

describe('an exit code is an answer only if a daemon produced it', () => {
  it('is an absent image when the daemon is still there to have said so', () => {
    // Verbatim from this host, live daemon, a tag that does not exist.
    const gate = classifyImageProbe(
      'ghcr.io/yomaytk/elfconv:no-such-tag-exists',
      outcome({
        status: 1,
        stderr: 'Error response from daemon: No such image: ghcr.io/yomaytk/elfconv:no-such-tag-exists',
      }),
      ANSWERING,
    )
    expect(gate.kind).toBe('image-absent')
    expect(describeGate(gate)).toContain('NOT PRESENT')
  })

  it('is an unreachable daemon on the SAME exit code when nothing answered', () => {
    // The pair that carried the defect: exit 1 both times, two different findings, and the
    // exit code cannot tell them apart. Only the second probe can.
    const gate = classifyImageProbe(
      'ghcr.io/yomaytk/elfconv:arm64',
      outcome({
        status: 1,
        stderr: 'failed to connect to the docker API at unix:///nonexistent/does-not-exist.sock',
      }),
      UNREACHABLE,
    )
    expect(gate.kind).toBe('daemon-unreachable')
    expect(describeGate(gate)).toContain('THE DOCKER DAEMON IS NOT ANSWERING')
    expect(describeGate(gate)).not.toContain('NOT PRESENT')
  })

  it('is present on exit 0, and never asks the daemon a second time', () => {
    let asked = 0
    const gate = classifyImageProbe('ghcr.io/yomaytk/elfconv:arm64', outcome({ status: 0 }), () => {
      asked += 1
      return ANSWERING()
    })
    expect(gate.kind).toBe('image-present')
    // The re-probe costs a spawn. On the path that succeeds it must cost nothing.
    expect(asked).toBe(0)
  })

  it('is undetermined when the inspect hung and the daemon is demonstrably fine', () => {
    // The narrow surviving red: the daemon answers `version` and the inspect never came
    // back, so nothing observed whether the image is here. Not a skip — nobody found out.
    const gate = classifyImageProbe(
      'ghcr.io/yomaytk/elfconv:arm64',
      outcome({ errno: 'ETIMEDOUT' }),
      ANSWERING,
    )
    expect(gate.kind).toBe('undetermined')
    expect(describeGate(gate)).toContain('NOBODY FOUND OUT')
  })

  it('is an unreachable daemon when the inspect hung because the daemon had stopped', () => {
    // Same observation as the case above, different second reading. This is the pair that
    // makes the re-probe a measurement rather than a formality.
    const gate = classifyImageProbe(
      'ghcr.io/yomaytk/elfconv:arm64',
      outcome({ errno: 'ETIMEDOUT' }),
      UNREACHABLE,
    )
    expect(gate.kind).toBe('daemon-unreachable')
  })

  it('is undetermined when the host itself could not fork, whatever the daemon is doing', () => {
    const gate = classifyImageProbe(
      'ghcr.io/yomaytk/elfconv:arm64',
      outcome({ errno: 'EAGAIN' }),
      () => {
        throw new Error('a host that cannot fork must not be asked to fork again')
      },
    )
    expect(gate.kind).toBe('undetermined')
    expect(gate.kind === 'undetermined' && gate.code).toBe('EAGAIN')
  })
})

// ---------------------------------------------------------------------------
// The probe, against conditions this host is really put into.
// ---------------------------------------------------------------------------

describe('the probe reads this host rather than a constant', () => {
  it('reports a daemon that answers, so a gate stuck on "skip" cannot pass this file', () => {
    // The anti-degeneracy case. Everything else here asserts a refusal; this one asserts
    // that the probe can still say yes, and it says yes to a stub rather than to the real
    // daemon so the assertion holds on a host that has none.
    const reach = probeDockerReach({
      docker: stubDocker('echo linux'),
      timeoutMs: PROBE_BUDGET_MS,
    })
    expect(describeGate(reach)).toBe('the docker daemon answered')
    expect(reach.kind === 'daemon-answering' && reach.serverOs).toBe('linux')
    expect(isRunnable(reach)).toBe(true)
  })

  it('reports an unreachable daemon when DOCKER_HOST points at a socket that is not there', () => {
    // The real client, against a real absence. This is the fast half of the condition that
    // was measured on 2026-08-12 — and the half that used to be reported as an ABSENT
    // IMAGE, silently.
    const reach = probeDockerReach({
      env: { ...process.env, DOCKER_HOST: 'unix:///nonexistent/does-not-exist.sock' },
      timeoutMs: PROBE_BUDGET_MS,
    })
    expect(describeGate(reach)).toContain('THE DOCKER DAEMON IS NOT ANSWERING')
    expect(isUndetermined(reach)).toBe(false)
    expect(isRunnable(reach)).toBe(false)
  })

  it('reports an unreachable daemon when the socket accepts and never answers', async () => {
    // The slow half, and the one that actually went red: a socket that connects and hangs.
    // `spawnSync` kills the client at its budget and reports ETIMEDOUT — the observation
    // the old gate turned into a sentence about this machine's process table.
    const socket = await wedgedSocket()
    const reach = probeDockerReach({
      env: { ...process.env, DOCKER_HOST: `unix://${socket}` },
      timeoutMs: PROBE_BUDGET_MS,
    })
    expect(describeGate(reach)).toContain('THE DOCKER DAEMON IS NOT ANSWERING')
    expect(isUndetermined(reach)).toBe(false)
  })

  it('reports an absent client when there is nothing at the path to run', () => {
    const reach = probeDockerReach({
      docker: '/nonexistent/definitely-not-docker',
      timeoutMs: PROBE_BUDGET_MS,
    })
    expect(describeGate(reach)).toContain('NO DOCKER CLIENT')
  })
})

describe('the image gate never puts the image question to a daemon that is not there', () => {
  it('names the daemon, not the image, when the socket is not there', async () => {
    // End to end through `gateOnImage`, which is what every spec calls. The image named
    // here IS present on hosts that have it — so a gate that asked anyway and read the
    // exit code would say "absent" about an image it never looked for.
    const gate = gateOnImage('ghcr.io/yomaytk/elfconv:arm64', {
      env: { ...process.env, DOCKER_HOST: 'unix:///nonexistent/does-not-exist.sock' },
      timeoutMs: PROBE_BUDGET_MS,
    })
    expect(gate.kind).toBe('daemon-unreachable')
    expect(describeGate(gate)).not.toContain('NOT PRESENT')
  })

  it('never spawns an inspect at all — proved by a stub that logs what it was asked', () => {
    // The claim above is about ORDER, and a `kind` cannot show order. This stub refuses the
    // daemon question and would answer the image question happily; if the gate asked it,
    // `image` would appear in the log.
    const dir = scratch('o2-gate-log-')
    const log = join(dir, 'argv.log')
    const docker = stubDocker(
      `echo "$@" >> ${log}\n` +
        'case "$1" in\n' +
        '  version) echo "failed to connect to the docker API" 1>&2; exit 1 ;;\n' +
        '  *) echo sha256:deadbeef; exit 0 ;;\n' +
        'esac',
    )
    const gate = gateOnImage('ghcr.io/yomaytk/elfconv:arm64', {
      docker,
      timeoutMs: PROBE_BUDGET_MS,
    })
    expect(gate.kind).toBe('daemon-unreachable')
    const asked = readLog(log)
    expect(asked).toEqual(['version --format {{.Server.Os}}'])
    // Said twice, because the whole defect is an image verdict produced without asking.
    expect(asked.join('\n')).not.toContain('image inspect')
  })

  it('says present when a daemon answers and the inspect succeeds', () => {
    const docker = stubDocker(
      'case "$1" in\n' +
        '  version) echo linux; exit 0 ;;\n' +
        '  *) echo sha256:deadbeef; exit 0 ;;\n' +
        'esac',
    )
    const gate = gateOnImage('ghcr.io/yomaytk/elfconv:arm64', {
      docker,
      timeoutMs: PROBE_BUDGET_MS,
    })
    expect(isRunnable(gate)).toBe(true)
    expect(describeGate(gate)).toContain('is present on this host')
  })

  it('says absent when a daemon answers and the inspect does not', () => {
    // The good skip, kept working. Without this the block above would pass just as well if
    // `image-absent` had become unreachable.
    const docker = stubDocker(
      'case "$1" in\n' +
        '  version) echo linux; exit 0 ;;\n' +
        '  *) echo "Error response from daemon: No such image: x" 1>&2; exit 1 ;;\n' +
        'esac',
    )
    const gate = gateOnImage('ghcr.io/yomaytk/elfconv:arm64', {
      docker,
      timeoutMs: PROBE_BUDGET_MS,
    })
    expect(gate.kind).toBe('image-absent')
    expect(describeGate(gate)).toContain('NOT PRESENT')
    expect(isRunnable(gate)).toBe(false)
    expect(isUndetermined(gate)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// The dispositions, written down where a change to them cannot be quiet.
// ---------------------------------------------------------------------------

describe('the disposition of every outcome is recorded, so moving one is a visible edit', () => {
  it('reddens exactly one condition, and it is the one nobody measured', () => {
    const conditions: readonly { readonly gate: DockerReach; readonly red: boolean }[] = [
      { gate: { kind: 'daemon-answering', serverOs: 'linux' }, red: false },
      { gate: { kind: 'daemon-unreachable', detail: 'socket refused' }, red: false },
      { gate: { kind: 'docker-absent', detail: 'spawn docker ENOENT' }, red: false },
      { gate: { kind: 'undetermined', code: 'EAGAIN', detail: 'no room to fork' }, red: true },
    ]
    for (const { gate, red } of conditions) {
      expect(isUndetermined(gate), describeGate(gate)).toBe(red)
    }
  })

  it('gives each condition a sentence no other condition produces', () => {
    // A shared prefix is how four named refusals become one unread line.
    const sentences = [
      describeGate({ kind: 'image-present', image: 'x' }),
      describeGate({ kind: 'image-absent', image: 'x', detail: 'no such image' }),
      describeGate({ kind: 'daemon-unreachable', detail: 'socket refused' }),
      describeGate({ kind: 'docker-absent', detail: 'ENOENT' }),
      describeGate({ kind: 'undetermined', code: 'EAGAIN', detail: 'no room' }),
    ]
    expect(new Set(sentences.map((s) => s.slice(0, 12))).size).toBe(sentences.length)
  })

  it('ships the budgets the siblings were already using', () => {
    // `PROBE_BUDGET_MS` above is 3 s so the wedged-socket cases do not cost twenty. These
    // are what a real run gets, and shortening them is a change to every AOT spec's gate.
    expect(DAEMON_PROBE_TIMEOUT_MS).toBe(20_000)
    expect(IMAGE_PROBE_TIMEOUT_MS).toBe(60_000)
  })
})
