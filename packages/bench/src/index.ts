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
  JobRunner,
  Observation,
  RunConfig,
  Skew,
  SweepOptions,
  SweepResult,
  TransportKind,
} from './harness.ts'

export { hostCount, isSameMachine, machineLabel, renderMarkdown } from './report.ts'
export type { Inventory, Machine, MachineRole, Report } from './report.ts'
