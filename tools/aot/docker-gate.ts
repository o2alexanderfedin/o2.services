/**
 * The question every AOT spec asks before it runs anything — asked in the one order that
 * keeps its two halves apart.
 *
 * ## The defect this exists to remove
 *
 * "Is the elfconv image here?" and "is there a daemon to ask?" are two questions, and
 * `docker image inspect` answers them through one exit code. Measured on this host on
 * 2026-08-12, with docker 29.4.0 against macOS 26.5.2 / arm64:
 *
 * | condition | exit | stderr |
 * |---|---|---|
 * | image genuinely absent | 1 | `Error response from daemon: No such image: …` |
 * | daemon refusing connections (`DOCKER_HOST` at a socket that is not there) | 1 | `failed to connect to the docker API at unix://…: dial unix …: connect: no such file or directory` |
 * | daemon wedged (socket accepts, never answers) | — | the client never returns; `spawnSync` kills it at its budget and reports `ETIMEDOUT` |
 *
 * Every gate in `tools/aot/` used to read the first two as the same thing and the third as
 * a fourth thing again, and which of those you got was decided by *how* the daemon was
 * down rather than by anything about the repository:
 *
 * - `lift.node.test.ts`'s gate retried `ETIMEDOUT` and then reported *"the gate never found
 *   out … this host could not be asked"* — a **RED** naming this machine's process table,
 *   for a wedged daemon. That is what was measured on 2026-08-12: `lift.node.test.ts` red
 *   while 47 cases in the sibling specs skipped, on one host, from one cause.
 * - The same gate read the refusing-daemon row above as `present: false, undetermined: null`
 *   — a **silent skip claiming the image is absent**, which is a thing nothing observed.
 *   `echo-guest.ts`'s `imageIsPresent()` did the same.
 * - `elfconv-differential`, `elflift-wasi-gate` and `wasi-preview1-surface` each carried
 *   their own copy of a `dockerAvailable()` that asks `docker version` — the right question
 *   — and then collapsed its answer into a boolean, so "docker is not installed" and "the
 *   daemon is not answering" arrived as one sentence.
 *
 * Five copies of one predicate, disagreeing about a condition all five meet at once.
 *
 * ## The order, which is the whole fix
 *
 * **Ask the daemon first, with `docker version`, and only then ask about the image.** An
 * unreachable daemon can then never be reported as an absent image, because the image
 * question is not put at all. And when an inspect *does* fail, the daemon is asked again:
 * an exit code is an answer only if something answered it. That re-probe is a measurement
 * rather than a regex over the client's wording — this repository's rule about attributing
 * a failure by measurement, applied to a message docker is free to reword.
 *
 * ## What is a skip and what is a red
 *
 * Four outcomes, three of them skips with their own sentence, one of them red:
 *
 * | outcome | what was observed | disposition |
 * |---|---|---|
 * | {@link DockerReach} `daemon-answering` + `image-present` | the image is here | **run** |
 * | `image-absent` | a daemon answered, and said no such image | skip, named |
 * | `daemon-unreachable` | the client ran and no daemon answered it | skip, named |
 * | `docker-absent` | there is no `docker` on this host | skip, named |
 * | `undetermined` | the question never got put, or got put and never came back from a daemon that is otherwise alive | **red** |
 *
 * The red is `lift.node.test.ts`'s, preserved rather than invented here: a gate that skips
 * for a reason it did not measure has claimed something, and the claim is false. It is
 * narrowed to the one condition it was written for. A host that has no docker, or a daemon
 * that is down, is an *observation* — the same observation the three sibling specs have
 * always skipped on.
 *
 * ## What this must never become
 *
 * A gate that cannot fail. Two things hold that line and both are asserted in
 * `docker-gate.node.test.ts`: the classifier tells all five arms apart from synthetic
 * observations, and the probe is shown to read *reality* — a stub `docker` that exits 0 is
 * `daemon-answering`, the real client pointed at a socket that is not there is
 * `daemon-unreachable`, and a path that is not an executable is `docker-absent`. A
 * `probeDockerReach` that had been reduced to a constant fails at least two of those.
 *
 * Node-only, and deliberately not a spec: `vitest.config.ts`'s node project collects only
 * `tools/**​/*.node.test.ts`, so this is importable from any of them. Nothing in
 * `packages/` may import it. It depends on `node:child_process` and on nothing in this
 * repository, so a spec that only needs the gate does not pull the lifter in behind it.
 */

import { spawnSync } from 'node:child_process'

/**
 * What one run of the `docker` client left behind, reduced to the four things any
 * classification here reads.
 *
 * Named as its own type so {@link classifyReach} and {@link classifyImageProbe} can be
 * given observations that never happened on this host — a full process table, a daemon
 * that dies between two probes — and still be shown to tell them apart. An arm nothing
 * can call directly is an arm no test can show still fires.
 */
export interface ProbeOutcome {
  /** `spawnSync`'s exit status. `null` when the child was killed or never started. */
  readonly status: number | null
  /**
   * The errno of a spawn that failed, or `ETIMEDOUT` when `spawnSync` killed the client at
   * its budget. Measured on this host: a `spawnSync` timeout reports
   * `code: 'ETIMEDOUT'`, `status: null`, `signal: 'SIGTERM'`.
   */
  readonly errno: string | null
  /** What the client printed, trimmed — the daemon's OS, or an image id. */
  readonly stdout: string
  /** Whatever the client managed to say before it stopped, trimmed. */
  readonly stderr: string
  /** The thrown error's message, for the arms where the errno alone is not a sentence. */
  readonly message: string | null
}

/**
 * Whether there is a daemon to ask, and — when there is not — which of three things
 * stopped the asking.
 *
 * `undetermined` is the only arm that is not an observation about the environment, and it
 * is the only one that reddens a run.
 */
export type DockerReach =
  | { readonly kind: 'daemon-answering'; readonly serverOs: string }
  | { readonly kind: 'daemon-unreachable'; readonly detail: string }
  | { readonly kind: 'docker-absent'; readonly detail: string }
  | { readonly kind: 'undetermined'; readonly code: string; readonly detail: string }

/**
 * Whether the toolchain image can be used here, carrying the reach failure through
 * unchanged when there was one.
 *
 * The three non-image arms are {@link DockerReach}'s own, restated rather than flattened:
 * a caller that skips wants to print *which* condition it skipped on, and that sentence is
 * the entire subject of this module.
 */
export type ImageGate =
  | { readonly kind: 'image-present'; readonly image: string }
  | { readonly kind: 'image-absent'; readonly image: string; readonly detail: string }
  | { readonly kind: 'daemon-unreachable'; readonly detail: string }
  | { readonly kind: 'docker-absent'; readonly detail: string }
  | { readonly kind: 'undetermined'; readonly code: string; readonly detail: string }

/**
 * The errnos that say there is no `docker` to run — statements about the command, not
 * about the daemon and not about this host.
 *
 * `lift.ts`'s `classifySpawnFailure` keeps the same two out of its host-exhaustion set for
 * the same reason, in its own words: *"those two are statements about the command"*.
 */
const DOCKER_NOT_THERE_CODES: ReadonlySet<string> = new Set(['ENOENT', 'EACCES'])

/**
 * The errnos that mean the question never left this host, and are therefore worth putting
 * again.
 *
 * `lift.ts`'s `HOST_EXHAUSTION_CODES`, restated because this is a gate answering a
 * disposition rather than a lift answering a `LiftFailure`. Measured on this host on
 * 2026-08-01 and recorded in that file: under `RLIMIT_NPROC` below the live process count,
 * 6 of 6 spawns failed `EAGAIN` in **0–3 ms** — which is why a retry costs nothing on the
 * one host it helps.
 */
const HOST_EXHAUSTION_CODES: ReadonlySet<string> = new Set([
  'EAGAIN',
  'EMFILE',
  'ENFILE',
  'ENOMEM',
])

/**
 * How many times a probe that never left this host is put again.
 *
 * Four, matching `lift.node.test.ts`'s `HOST_SPAWN_ATTEMPTS`, and bounded by a deadline as
 * well as by a count for the reason that file's `RETRY_ENVELOPE_SHARE` exists: attempts
 * multiplied by a budget is how a gate spends more wall clock than the case that contains
 * it. Only {@link HOST_EXHAUSTION_CODES} is retried — a daemon that is down does not come
 * back inside a gate, and asking it four times only makes the skip slower.
 */
const COULD_NOT_ASK_ATTEMPTS = 4

/**
 * How long the client gets to print the daemon's OS.
 *
 * 20 000 ms, which is the figure `elfconv-differential.node.test.ts`,
 * `elflift-wasi-gate.node.test.ts` and `wasi-preview1-surface.node.test.ts` have each used
 * since they were written, adopted here rather than re-sited so that routing them through
 * this module changes their reason string and not their verdict.
 *
 * Measured on this host on 2026-08-12: a live daemon answers `docker version --format
 * '{{.Server.Os}}'` in **0.18 s real**, and a socket that accepts without answering never
 * returns at all — `timeout 12 docker version` came back **124**. The two populations are
 * two orders of magnitude apart and nothing sits in the gap, which is what makes an
 * absolute defensible here: there is no second arm to compare against, because the second
 * arm is "no answer, ever".
 *
 * **The trade this makes, stated rather than discovered.** A daemon so swamped that it
 * needs more than 20 s to print one word is treated as unreachable, and the specs skip.
 * That is the threshold the three siblings above have always applied; `lift.node.test.ts`
 * used to retry such a host and could sometimes still run. It now agrees with them.
 */
export const DAEMON_PROBE_TIMEOUT_MS: number = 20_000

/**
 * How long `docker image inspect` gets, once a daemon is known to be answering.
 *
 * 60 000 ms — `lift.ts`'s `IMAGE_RESOLVE_CAP_MS`, restated rather than imported so that a
 * spec needing only the gate does not pull the lifter, `@o2/aot` and the ELF screen in
 * behind it. The number is generous by construction: the daemon has already answered a
 * question in this same run, so this budget is only ever reached by a daemon that stopped
 * answering between the two — which {@link classifyImageProbe} then goes and measures.
 */
export const IMAGE_PROBE_TIMEOUT_MS: number = 60_000

/** Where a probe runs, so a spec can point it at a stub, a bad socket, or nothing at all. */
export interface ProbeOptions {
  /** The client to run. Defaults to `docker` on `PATH`. */
  readonly docker?: string
  /** Overrides the child's environment wholesale — `DOCKER_HOST` is the reason this exists. */
  readonly env?: Readonly<Record<string, string | undefined>>
  /**
   * Overrides BOTH budgets — {@link DAEMON_PROBE_TIMEOUT_MS} and
   * {@link IMAGE_PROBE_TIMEOUT_MS} — because a caller that wants a short probe wants both
   * halves short. A spec pointing this at a wedged socket sets it to seconds so the case
   * measures the classification rather than the wait.
   */
  readonly timeoutMs?: number
}

/**
 * The errno of a failed spawn, without asserting a shape onto the thrown value.
 *
 * `in` rather than a cast: `noUncheckedIndexedAccess` and this repository's standing rule
 * against type assertions both apply to a gate as much as to a driver, and the property
 * really is optional on `Error`.
 */
function errnoOf(error: Error | undefined): string | null {
  if (error === undefined) return null
  if (!('code' in error)) return null
  const { code } = error
  return typeof code === 'string' ? code : null
}

/** One `spawnSync` reduced to a {@link ProbeOutcome}. */
function runProbe(
  command: string,
  argv: readonly string[],
  options: ProbeOptions,
  timeoutMs: number,
): ProbeOutcome {
  const ran = spawnSync(command, [...argv], {
    encoding: 'utf8',
    timeout: timeoutMs,
    ...(options.env === undefined ? {} : { env: { ...options.env } }),
  })
  return {
    status: ran.status,
    errno: errnoOf(ran.error),
    stdout: (ran.stdout ?? '').trim(),
    stderr: (ran.stderr ?? '').trim(),
    message: ran.error?.message ?? null,
  }
}

/** The detail line for an outcome that produced no usable stderr. */
function detailOf(outcome: ProbeOutcome, fallback: string): string {
  if (outcome.stderr !== '') return outcome.stderr
  if (outcome.message !== null) return outcome.message
  return fallback
}

/**
 * Which of the four reach conditions one `docker version` was.
 *
 * Pure, and exported for the reason `lift.ts` exports `classifySpawnFailure`: the
 * host-exhaustion arm fires only on a machine that has run out of process slots, which is
 * not a state a spec can put this machine into, so the classification and the wiring that
 * feeds it are shown to work separately.
 *
 * A non-zero exit is `daemon-unreachable` rather than a fifth kind. The client was asked
 * for the *server's* OS; every way of failing to produce it is a way of there being no
 * server to speak for, and the detail carries the client's own words so a reader is never
 * left with the classification alone.
 */
export function classifyReach(outcome: ProbeOutcome): DockerReach {
  if (outcome.errno !== null) {
    if (DOCKER_NOT_THERE_CODES.has(outcome.errno)) {
      return { kind: 'docker-absent', detail: detailOf(outcome, outcome.errno) }
    }
    if (outcome.errno === 'ETIMEDOUT') {
      // The client ran and never came back. That is the wedged daemon, exactly: the
      // socket accepts, the request goes out, nothing answers it.
      return { kind: 'daemon-unreachable', detail: detailOf(outcome, 'the client never returned') }
    }
    return { kind: 'undetermined', code: outcome.errno, detail: detailOf(outcome, outcome.errno) }
  }
  if (outcome.status === 0) return { kind: 'daemon-answering', serverOs: outcome.stdout }
  return {
    kind: 'daemon-unreachable',
    detail: detailOf(outcome, `\`docker version\` exited ${String(outcome.status)}`),
  }
}

/**
 * Which of the five gate conditions one `docker image inspect` was, given a way to ask the
 * daemon again.
 *
 * `daemonAfter` is a thunk rather than a value so the re-probe costs nothing on the path
 * that succeeds, and so a spec can hand it an answer this host would not give. **It is
 * what makes an exit code an answer**: `Error response from daemon: No such image` and
 * `failed to connect to the docker API` are both exit 1, and the difference between them
 * is not in the exit code but in whether a daemon was there to produce it.
 */
export function classifyImageProbe(
  image: string,
  inspect: ProbeOutcome,
  daemonAfter: () => DockerReach,
): ImageGate {
  if (inspect.errno !== null) {
    if (DOCKER_NOT_THERE_CODES.has(inspect.errno)) {
      return { kind: 'docker-absent', detail: detailOf(inspect, inspect.errno) }
    }
    if (HOST_EXHAUSTION_CODES.has(inspect.errno)) {
      return {
        kind: 'undetermined',
        code: inspect.errno,
        detail: detailOf(inspect, inspect.errno),
      }
    }
    // Anything else — `ETIMEDOUT` above all — is the client failing to come back, which
    // says nothing by itself about which end stopped. Go and find out.
    return carry(daemonAfter(), {
      kind: 'undetermined',
      code: inspect.errno,
      detail:
        `\`docker image inspect ${image}\` did not come back (${inspect.errno}) and the ` +
        `daemon is still answering, so nothing here observed whether the image is present`,
    })
  }
  if (inspect.status === 0) return { kind: 'image-present', image }
  return carry(daemonAfter(), {
    kind: 'image-absent',
    image,
    detail: detailOf(inspect, `\`docker image inspect\` exited ${String(inspect.status)}`),
  })
}

/**
 * The reach failure if there was one, and otherwise the caller's own verdict.
 *
 * One place where a `DockerReach` becomes an `ImageGate`, so the two type's shared arms
 * cannot drift into saying different things about the same observation.
 */
function carry(reach: DockerReach, whenAnswering: ImageGate): ImageGate {
  switch (reach.kind) {
    case 'daemon-answering':
      return whenAnswering
    case 'daemon-unreachable':
      return { kind: 'daemon-unreachable', detail: reach.detail }
    case 'docker-absent':
      return { kind: 'docker-absent', detail: reach.detail }
    case 'undetermined':
      return { kind: 'undetermined', code: reach.code, detail: reach.detail }
  }
}

/**
 * Is there a daemon on this host, and if not, why not.
 *
 * Retried only while the question is failing to leave this host — see
 * {@link COULD_NOT_ASK_ATTEMPTS}. Every other answer is an answer and is returned at once.
 */
export function probeDockerReach(options: ProbeOptions = {}): DockerReach {
  const timeoutMs = options.timeoutMs ?? DAEMON_PROBE_TIMEOUT_MS
  const docker = options.docker ?? 'docker'
  const deadline = Date.now() + timeoutMs
  const spent: number[] = []
  let last: DockerReach = {
    kind: 'undetermined',
    code: 'none',
    detail: 'no attempt was made',
  }
  for (let attempt = 1; attempt <= COULD_NOT_ASK_ATTEMPTS; attempt++) {
    const started = Date.now()
    last = classifyReach(
      runProbe(docker, ['version', '--format', '{{.Server.Os}}'], options, timeoutMs),
    )
    spent.push(Date.now() - started)
    if (last.kind !== 'undetermined' || !HOST_EXHAUSTION_CODES.has(last.code)) return last
    // The worst attempt this run has already produced is the estimate for the next one.
    if (Date.now() + Math.max(...spent) > deadline) break
  }
  if (last.kind !== 'undetermined') return last
  return {
    kind: 'undetermined',
    code: last.code,
    detail:
      `\`${docker} version\` failed with ${last.code} on each of ${spent.length} attempt(s) ` +
      `costing ${spent.join(' ms, ')} ms — the question never left this host, so nothing ` +
      `here observed whether a daemon is running. (${last.detail})`,
  }
}

/**
 * Is the toolchain image usable here — asked in two steps so that neither answer can wear
 * the other's name.
 *
 * The daemon is asked first and the image second, and the image question is not put at all
 * unless a daemon answered the first one. See this module's docblock for the three measured
 * conditions that used to arrive as one exit code.
 */
export function gateOnImage(image: string, options: ProbeOptions = {}): ImageGate {
  const docker = options.docker ?? 'docker'
  const reach = probeDockerReach(options)
  if (reach.kind !== 'daemon-answering') {
    // The second argument is unreachable by the guard above — `carry` is used anyway so
    // that a reach failure becomes a gate in exactly one place in this file.
    return carry(reach, { kind: 'image-present', image })
  }
  const timeoutMs = options.timeoutMs ?? IMAGE_PROBE_TIMEOUT_MS
  const deadline = Date.now() + timeoutMs
  const spent: number[] = []
  let last: ImageGate = { kind: 'undetermined', code: 'none', detail: 'no attempt was made' }
  for (let attempt = 1; attempt <= COULD_NOT_ASK_ATTEMPTS; attempt++) {
    const started = Date.now()
    last = classifyImageProbe(
      image,
      runProbe(docker, ['image', 'inspect', image, '--format', '{{.Id}}'], options, timeoutMs),
      () => probeDockerReach(options),
    )
    spent.push(Date.now() - started)
    if (last.kind !== 'undetermined' || !HOST_EXHAUSTION_CODES.has(last.code)) return last
    if (Date.now() + Math.max(...spent) > deadline) break
  }
  if (last.kind !== 'undetermined') return last
  return {
    kind: 'undetermined',
    code: last.code,
    detail:
      `\`${docker} image inspect ${image}\` failed with ${last.code} on each of ` +
      `${spent.length} attempt(s) costing ${spent.join(' ms, ')} ms — the question never ` +
      `left this host, so whether the image is present is a thing nothing here observed. ` +
      `(${last.detail})`,
  }
}

/**
 * The one condition that must redden a run rather than skip it.
 *
 * A skip for a reason nobody measured is a claim, and the claim is false. Everything else
 * here was seen happening.
 */
export function isUndetermined(gate: DockerReach | ImageGate): boolean {
  return gate.kind === 'undetermined'
}

/** Whether the thing the caller wanted is available: a daemon, or the image itself. */
export function isRunnable(gate: DockerReach | ImageGate): boolean {
  return gate.kind === 'daemon-answering' || gate.kind === 'image-present'
}

/**
 * The sentence a skipped suite prints instead of nothing.
 *
 * Each begins with a different clause on purpose. A reader scanning a run has to be able to
 * tell an absent image from a dead daemon from a host that could not ask, without opening
 * the file — that is the whole of what this module buys, and a shared prefix would spend it.
 */
export function describeGate(gate: DockerReach | ImageGate): string {
  switch (gate.kind) {
    case 'daemon-answering':
      return 'the docker daemon answered'
    case 'image-present':
      return `${gate.image} is present on this host`
    case 'image-absent':
      return `the docker daemon answered and ${gate.image} is NOT PRESENT on this host: ${gate.detail}`
    case 'daemon-unreachable':
      return `THE DOCKER DAEMON IS NOT ANSWERING on this host — nothing was asked about any image: ${gate.detail}`
    case 'docker-absent':
      return `there is NO DOCKER CLIENT on this host: ${gate.detail}`
    case 'undetermined':
      return `NOBODY FOUND OUT (${gate.code}): ${gate.detail}`
  }
}
