/**
 * Harness integrity — BENCH-07, and the mechanism this phase's first success criterion
 * is checked by.
 *
 * ## What this file is for, and what it deliberately is not
 *
 * These are checks on whether the **harness measured what it claims**, kept in their own
 * module, separate from the measurement, so that they can be exercised without running a
 * benchmark. Nothing here times anything, builds anything, or knows what a fabric is.
 * Every function takes plain data that somebody else observed and returns the readings
 * that data fails, as strings a human can act on.
 *
 * They are **not** measurement failures. A configuration that could not be measured
 * becomes an excluded row in the published report, with its reason, because a rung that
 * vanishes between the plan and the results is indistinguishable from a rung removed for
 * being inconvenient. A violation here says something else entirely: *the measurement
 * that came back is not of the thing it claims*. Publishing that as a rung with a caveat
 * is how a defect in a harness becomes a finding about a fabric.
 *
 * ## Why they are pure functions with planted-input tests
 *
 * **Nothing in CI runs `bin/bench.ts`.** Its `main()` executes on import, so no suite can
 * load it without running a full sweep, and every guard the repository has over that file
 * is either a source-text read or a spawn with a temporary working directory. These
 * checks therefore fire when a human runs the benchmark — not when a change breaks it.
 *
 * That is the whole argument for this shape. A check buried inside the driver would have
 * no execution anywhere that could show it working, so its first real exercise would be
 * the run whose result depends on it. Pure functions over plain data can be planted
 * against, and `integrity.test.ts` plants against every one of them.
 *
 * **What that does not prove**, stated because it bounds what a later plan may claim: it
 * does not prove the driver builds its observation from the live fabric rather than from
 * a constant. That half is held by a source-shape guard and by the call-site count in
 * Plan 23-03, not by an execution, and it is **unmeasured**. What would measure it is an
 * entry point that runs one rung under a stub fabric with a planted defect and asserts
 * the abort, which needs `main()` split from the module body.
 *
 * Pure module: no `node:*` import, no platform global, nothing from `@o2/core`. That is
 * also what lets this file's tests run under the browser project without a suffix.
 */

/**
 * The ceiling on the driver's own CPU time as a share of the shard compute it dispatched.
 *
 * **A declared threshold, fixed in the 2026-08-05 methodology amendment before any data
 * existed**, so it cannot be tuned afterwards to whatever a first run happened to
 * produce. It is deliberately *not* derived from how a driver is expected to behave —
 * no such derivation is written here, and one should not be added, because a number
 * reasoned out in a comment is exactly the shape this phase exists to remove. What share
 * a rung actually reaches is a quantity the run measures and publishes beside it.
 *
 * The reading it supports is the falsifier that does not depend on the harness telling
 * the truth about its own process table: a run that fell back to in-process nodes keeps
 * the work in the driver's process, whatever it says it spawned.
 */
export const MAX_DRIVER_CPU_SHARE = 0.5

/**
 * A rung whose measurement is not of the thing it claims.
 *
 * Callers branch on `instanceof` and on the fields, never on the message string. The
 * message exists for the human reading a failed run, which is the only place this ever
 * fires.
 *
 * **This is the one class of failure `bin/bench.ts` must not convert into an excluded
 * row.** An excluded row says "this configuration could not be measured"; this error
 * says "the measurement that came back is not of the thing it claims", and the two
 * demand opposite responses — publish the first, refuse to publish anything on the
 * second.
 */
export class HarnessIntegrityError extends Error {
  /** The rung it was raised at, e.g. `process-per-node, 8 nodes`. */
  readonly at: string
  /** Every reading that rung failed, in the order they were taken. */
  readonly violations: readonly string[]

  constructor(detail: { readonly at: string; readonly violations: readonly string[] }) {
    super(
      `the harness did not measure what it claims at ${detail.at}: ${detail.violations.join('; ')}`,
    )
    this.name = 'HarnessIntegrityError'
    this.at = detail.at
    this.violations = detail.violations
  }
}

/**
 * **The** gate. One function, one call per rung, every violation list concatenated.
 *
 * The shape is chosen over four inline `if` branches in the driver, and the reason is
 * not tidiness. A source-text guard — which is the only kind of guard this repository
 * can put over `bin/bench.ts` — matches identifiers, not data flow, so it cannot tell a
 * checker that was called and read from one that was called and discarded. The property
 * has to come from somewhere else, and here it comes from there being exactly **one**
 * consumer: one place where a rung's verdict is acted on, and one line whose deletion
 * turns the gate off, which is a deletion a test can name.
 */
export function assertIntegrity(at: string, violations: readonly string[]): void {
  if (violations.length === 0) return
  throw new HarnessIntegrityError({ at, violations })
}

/** One spawned agent, as three independently-observed facts about the same process. */
export interface AgentIdentity {
  /** `child.pid` — proves a process was spawned. */
  readonly childPid: number
  /** The pid that process printed on its own handshake line. */
  readonly announcedPid: number
  /** The peer id that same line carried. */
  readonly peerId: string
}

/** What a rung observed about the processes it claims to have run on. */
export interface ProcessIdentity {
  /** The rung's node count — what the curve will be plotted against. */
  readonly expected: number
  /** `process.pid` of the driver itself. */
  readonly driverPid: number
  readonly agents: readonly AgentIdentity[]
  /** The node id each built executor addresses. */
  readonly executorNodeIds: readonly string[]
  /** The in-process submitting node, which is never one of its own executors. */
  readonly submitterPeerId: string
}

/**
 * Eight readings over one rung's process observation.
 *
 * `child.pid` proves a process was spawned. It does **not** prove that the process which
 * announced an address is that process, and it does not prove any executor addresses it
 * — which is why the announcement and membership readings exist beside the count.
 *
 * The two cardinality readings are the ones that stop an **absent** instrument from
 * reading as a clean rung. An empty `executorNodeIds` satisfies "no executor addresses
 * an unannounced node" and "the submitter is not among the executors" vacuously, and an
 * empty `agents` satisfies distinctness, self-exclusion and announcement the same way.
 * An empty result is not a clean run; more often it is a wiring slip.
 *
 * Every message names the offending value, because a violation a reader cannot act on is
 * a failed run with extra steps.
 */
export function processIdentityViolations(observed: ProcessIdentity): readonly string[] {
  const violations: string[] = []
  const { agents, executorNodeIds, expected, driverPid, submitterPeerId } = observed

  if (agents.length === 0) {
    violations.push(
      `no agent process was observed at all, against a rung declaring ${expected}: an instrument that read nothing looks exactly like a working one that saw nothing, and the first is the likelier`,
    )
  } else if (agents.length !== expected) {
    violations.push(
      `${agents.length} agent processes were observed where the rung declares ${expected} nodes`,
    )
  }

  const pids = agents.map((agent) => agent.childPid)
  const repeated = pids.find((pid, index) => pids.indexOf(pid) !== index)
  if (repeated !== undefined) {
    violations.push(
      `process id ${repeated} was observed on more than one agent: two node identities sharing a process is the fallback this rung exists to detect`,
    )
  }

  if (pids.includes(driverPid)) {
    violations.push(
      `the driver's own process id ${driverPid} appears among the agents it spawned, so at least one node ran inside the process that is measuring it`,
    )
  }

  for (const agent of agents) {
    if (agent.announcedPid !== agent.childPid) {
      violations.push(
        `the agent at ${agent.peerId} announced process id ${agent.announcedPid} from a child whose process id is ${agent.childPid}: the process that published the address is not the process that was spawned`,
      )
    }
  }

  if (executorNodeIds.length !== expected) {
    violations.push(
      `${executorNodeIds.length} executors were built where the rung declares ${expected} nodes: every membership reading below passes vacuously on an empty set, so this count is what stands between an absent fabric and a clean rung`,
    )
  }

  const announced = new Set(agents.map((agent) => agent.peerId))
  for (const nodeId of executorNodeIds) {
    // The submitter gets its own reading below, with a sharper message; reporting it
    // twice would say less, not more.
    if (nodeId === submitterPeerId) continue
    if (!announced.has(nodeId)) {
      violations.push(
        `the executor for ${nodeId} addresses a node that no observed agent announced`,
      )
    }
  }

  if (executorNodeIds.includes(submitterPeerId)) {
    violations.push(
      `the submitting node ${submitterPeerId} appears among its own executors, so the rung dispatched at least one shard to the process that submitted it`,
    )
  }

  return violations
}

/** The driver's own CPU against the shard compute it dispatched, for one rung. */
export interface CpuAttribution {
  /** `process.cpuUsage()` delta across the rung, in milliseconds. */
  readonly driverCpuMs: number
  /** Total compute the rung's shards reported, in milliseconds. */
  readonly shardComputeMs: number
  /** Defaults to {@link MAX_DRIVER_CPU_SHARE}. */
  readonly maxShare?: number
}

/**
 * Three readings, and the two non-positive ones come first and separately.
 *
 * A zero numerator and a zero denominator are different failures with different causes —
 * a clock never sampled against a fabric that reported no compute — and folding them
 * into one would hide the case that matters most: with both zero there is no ratio to
 * take, so a single ceiling check would pass a run in which nothing was measured at all.
 */
export function cpuAttributionViolations(observed: CpuAttribution): readonly string[] {
  const violations: string[] = []
  const maxShare = observed.maxShare ?? MAX_DRIVER_CPU_SHARE

  if (observed.shardComputeMs <= 0) {
    violations.push(
      `the shard compute total read ${observed.shardComputeMs}ms: a rung that dispatched work and measured none of it has an unread instrument, not a fast fabric`,
    )
  }
  if (observed.driverCpuMs <= 0) {
    violations.push(
      `the driver's own CPU delta read ${observed.driverCpuMs}ms: a process that ran a rung spent CPU on it, so this is a clock that was never sampled`,
    )
  }

  if (observed.shardComputeMs > 0 && observed.driverCpuMs > 0) {
    const share = observed.driverCpuMs / observed.shardComputeMs
    if (share >= maxShare) {
      violations.push(
        `the driver spent ${observed.driverCpuMs}ms of its own CPU against ${observed.shardComputeMs}ms of shard compute — a share of ${share.toFixed(3)}, at or above the declared ceiling of ${maxShare}`,
      )
    }
  }

  return violations
}

/** The status every shard of a rung ended on. */
export interface FixtureUniformity {
  /**
   * One status per shard, as plain strings.
   *
   * Deliberately not the demo package's own status type: this package is portable and
   * must not acquire a dependency on the demo package in order to compare a string.
   */
  readonly statuses: readonly string[]
  /** The one status a correctly-parameterised fixture produces on every shard. */
  readonly expected: string
  readonly shards: number
}

/**
 * Uniformity, because a makespan ratio over a lopsided split reads the split.
 *
 * An **empty** vector is reported as an unread instrument and nothing else: every status
 * in an empty vector equals the expected one, so uniformity is the one thing it cannot
 * be evidence of.
 */
export function fixtureUniformityViolations(observed: FixtureUniformity): readonly string[] {
  const { statuses, expected, shards } = observed

  if (statuses.length === 0) {
    return [
      `the shard status vector is empty against a rung of ${shards} shards: every status in an empty vector matches, so this is an instrument that read nothing rather than a fixture that ran uniformly`,
    ]
  }

  const violations: string[] = []
  if (statuses.length !== shards) {
    violations.push(
      `the shard status vector holds ${statuses.length} entries against a rung of ${shards} shards: [${statuses.join(', ')}]`,
    )
  }

  const different = statuses.filter((status) => status !== expected)
  if (different.length > 0) {
    violations.push(
      `${different.length} of ${statuses.length} shards ended on something other than ${expected}: [${statuses.join(', ')}]`,
    )
  }

  return violations
}

/** What a rung declared it ran, against the module it actually dispatched. */
export interface FixtureProvenance {
  /** The `RunConfig.fixture` value the call site wrote down. */
  readonly declared: string
  /** The module CID the rung's fabric was handed. */
  readonly moduleCid: string
  /** Fixture name to registered module CID, supplied by whoever registered them. */
  readonly expected: Readonly<Record<string, string>>
}

/**
 * The only reading here that is a fact about the **bytes that were dispatched**.
 *
 * `RunConfig.fixture` is filled in by the call site, so every heading, every column and
 * every ratio downstream inherits whatever the caller typed. A rung that declares the
 * saturating fixture while its fabric was handed the trivial module is a wiring slip
 * that produces a fast, flat curve and a large apparent speedup — with the word
 * `saturating` printed beside it, in a report whose whole claim is that its figures say
 * where they came from. Comparing CIDs is what makes that claim checkable.
 */
export function fixtureProvenanceViolations(observed: FixtureProvenance): readonly string[] {
  const registered = observed.expected[observed.declared]

  if (registered === undefined) {
    const known = Object.keys(observed.expected).join(', ')
    return [
      `the rung declares the fixture ${observed.declared}, which has no registered module CID — registered fixtures are: ${known}`,
    ]
  }

  if (registered !== observed.moduleCid) {
    return [
      `the rung declares the fixture ${observed.declared}, whose registered module is ${registered}, but it dispatched ${observed.moduleCid}`,
    ]
  }

  return []
}
