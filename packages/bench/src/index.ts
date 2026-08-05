/**
 * `@o2/bench` — the measurement harness.
 *
 * Portable by the same rule as `@o2/core` and `@o2/net`: no platform imports, no
 * libp2p. Building a fabric and reading CPU details both need a platform, so both
 * arrive from outside — the runner as an injected function, the machine inventory as
 * data. What stays here is the measurement and the reporting, which is precisely what
 * must be identical across transports for the connectivity tax to mean anything.
 *
 * Implements `.planning/BENCHMARK-METHODOLOGY.md`, which was committed before this
 * package existed.
 */

export { MIN_RELIABLE_SAMPLES, describe, percentile, summarise } from './stats.ts'
export type { Summary } from './stats.ts'

export {
  NODE_LADDER,
  RUNS_PER_CONFIG,
  connectivityTax,
  costCrossover,
  measure,
  sweepNodeCount,
} from './harness.ts'
export type {
  CodeCache,
  ConnectivityTax,
  CostReport,
  Crossover,
  DispatchLeg,
  DriverKind,
  FixtureKind,
  JobRunner,
  Observation,
  ReduceObservation,
  ReduceReport,
  RunConfig,
  Skew,
  SweepOptions,
  SweepResult,
  TransportKind,
} from './harness.ts'

export { hostCount, isSameMachine, machineLabel, renderMarkdown } from './report.ts'
export type { Inventory, Machine, MachineRole, Report } from './report.ts'

/**
 * A published exclusion's reason, built from the failure that was observed — BENCH-07
 * criterion 3.
 *
 * **This one has a production caller from the moment it lands**, unlike the integrity block
 * below: Plan 23-04 replaces the stored paragraph in `bin/bench.ts`'s real-transport catch
 * block with a `describeExclusion` call, and `bench-driver.node.test.ts` asserts both halves
 * — that the call is there, and that the paragraph's distinctive literal is gone.
 */
export { describeExclusion } from './exclusion.ts'
export type { ObservedFailure } from './exclusion.ts'

/**
 * The harness-integrity gate — BENCH-07.
 *
 * **Exported here with no production caller yet.** Plan 23-03 supplies it, in
 * `bin/bench.ts`, one `assertIntegrity` call per rung. Until it does, every name below
 * joins `sweepNodeCount` on the built-not-wired list this project tracks — barrel
 * exported, reachable only from its own tests — and that is a fact worth stating rather
 * than discovering from a reachability guard later.
 */
export {
  HarnessIntegrityError,
  MAX_DRIVER_CPU_SHARE,
  assertIntegrity,
  cpuAttributionViolations,
  fixtureProvenanceViolations,
  fixtureUniformityViolations,
  processIdentityViolations,
} from './integrity.ts'
export type {
  AgentIdentity,
  CpuAttribution,
  FixtureProvenance,
  FixtureUniformity,
  ProcessIdentity,
} from './integrity.ts'
