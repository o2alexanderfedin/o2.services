/**
 * The published report — BENCH-04, BENCH-06, and criteria 2 and 5.
 *
 * A number without its provenance is not a result. This module defines the shape a
 * published run has to have, and the shape is what enforces the methodology: the
 * machine inventory and the same-machine label are **required fields**, so a report
 * cannot be constructed without them.
 *
 * ## The same-machine label is a type, not a footnote
 *
 * `hosts` is required and `sameMachine` is derived from it, never declared. Sixteen node
 * identities on one laptop share a CPU, a memory bus, a page cache and a scheduler — and
 * where they are one process, an event loop as well; that is a legitimate measurement of
 * software scaling with hardware contention included and the network excluded, and it is
 * **not** a measurement of sixteen machines. Reporting it as sixteen machines would be
 * the most misleading thing this project could publish, which is why BENCH-06 exists and
 * why the label is computed rather than supplied.
 *
 * `renderMarkdown` puts the label in the heading of every table it emits, so it
 * survives being copy-pasted out of context — which is exactly how caveats normally
 * get separated from their numbers.
 *
 * Pure module. The driver supplies the inventory, because reading CPU details needs a
 * platform and this package must not.
 */

import { describe } from './stats.ts'
import type { Summary } from './stats.ts'
import type { ConnectivityTax, Crossover, SweepResult } from './harness.ts'

/** What a machine in the run actually is. Omitting relay/aggregator flatters a result. */
export type MachineRole = 'worker' | 'relay' | 'aggregator' | 'requestor'

export interface Machine {
  readonly hostId: string
  readonly roles: readonly MachineRole[]
  readonly cpuModel: string
  readonly physicalCores: number
  readonly logicalCores: number
  readonly totalMemoryBytes: number
  readonly os: string
  readonly kernel: string
  readonly runtime: string
}

export interface Inventory {
  readonly machines: readonly Machine[]
  /** Nodes that participated, which is not the same as machines. */
  readonly nodeCount: number
}

/** Distinct hosts the run actually spanned. */
export function hostCount(inventory: Inventory): number {
  return new Set(inventory.machines.map((machine) => machine.hostId)).size
}

/**
 * True when every node ran on one host — derived, never declared.
 *
 * A caller able to *assert* "these were distinct machines" would eventually assert one
 * that was not, which is the same reasoning that makes attestation strength derived
 * from certificates rather than passed in.
 */
export function isSameMachine(inventory: Inventory): boolean {
  return hostCount(inventory) <= 1 && inventory.nodeCount > 1
}

/**
 * The label that must appear wherever the numbers appear.
 *
 * **Every number in this label is one of exactly two counted quantities**, and each is
 * bound to a name below so the noun beside it can be checked against where it came from:
 * `inventory.nodeCount`, and `hostCount(inventory)` derived from the machine list. There
 * is no third. In particular **nothing here counts processes** — `Inventory` carries no
 * such field and this module has no platform with which to ask for one — so a label
 * naming processes would be an invented measurement wearing the clothes of a disclosure,
 * which is worse than no disclosure.
 *
 * It read `N processes on 1 host — not N nodes` until 2026-08-04, with `nodeCount`
 * interpolated into *both* halves. The driver counts node identities and never processes
 * — `bin/bench.ts` passes `Math.max(...NODE_LADDER)` — and every identity it counted ran
 * inside the one process that published them, which the report's own `unmet` list said in
 * the paragraph directly beneath. So the label asserted a unit nobody had counted and
 * denied the one that had been. The same-machine disclosure BENCH-06 requires is
 * load-bearing and is kept; what changed is that the noun is now the counted one, and the
 * claim being denied is the uncounted one — distinct machines, which is what BENCH-06 is
 * about. `N processes` belongs to a driver that counts processes; that is Phase 23's.
 */
export function machineLabel(inventory: Inventory): string {
  const hosts = hostCount(inventory)
  const nodes = inventory.nodeCount
  if (nodes <= 1) return `single node on ${hosts} host`
  return isSameMachine(inventory)
    ? `SAME-MACHINE: ${nodes} nodes on ${hosts} host — a node count, not a machine count`
    : `${nodes} nodes across ${hosts} hosts`
}

export interface Report {
  readonly title: string
  /** ISO timestamp, supplied by the driver — this package has no clock. */
  readonly at: string
  readonly inventory: Inventory
  /** Single-threaded baseline for the COST crossover. */
  readonly baseline: Summary
  readonly memoryTransport: readonly SweepResult[]
  readonly realTransport: readonly SweepResult[]
  /**
   * The process-per-node curve, kept deliberately apart from `realTransport`.
   *
   * The obvious alternative — append these rungs to `realTransport` and let the new
   * `driver` column tell them apart — is the one `connectivityTax` used to collapse
   * without saying so: it keyed a `Map` on `config.nodes`, so two entries at one node
   * count became whichever was appended last. That is now a `RangeError`, and this
   * field is why the error never has to fire on a well-formed report.
   *
   * Optional, so a report built before this driver existed still renders. That is the
   * opposite choice from `RunConfig`'s three provenance fields, and for the opposite
   * reason: an absent curve is a fact about the run, while an absent provenance field
   * is a fact about the author.
   */
  readonly multiProcess?: readonly SweepResult[]
  readonly connectivity: readonly ConnectivityTax[]
  readonly crossover: Crossover
  /** Requirements this run does **not** satisfy, stated in the report itself. */
  readonly unmet: readonly string[]
  /**
   * Configurations from the pre-registered ladder that could not be measured.
   *
   * Published rather than dropped. The methodology commits to this explicitly: a rung
   * that vanishes between the plan and the results is indistinguishable from a rung
   * removed because its number was inconvenient, and the reader has no way to tell.
   */
  readonly excluded?: readonly { readonly config: string; readonly reason: string }[]
}

const bytes = (n: number): string => `${(n / 1024 ** 3).toFixed(1)} GiB`
const ratio = (n: number): string => (Number.isFinite(n) ? `${n.toFixed(2)}×` : '—')
/**
 * Adaptive precision.
 *
 * A fixed one decimal renders a 0.002ms baseline as `0.0ms`, which erases the number
 * the COST crossover is measured against — the reader is left unable to check the very
 * ratio the section reports.
 */
const ms = (n: number): string => {
  if (!Number.isFinite(n)) return '—'
  if (n === 0) return '0ms'
  if (n < 0.01) return `${n.toFixed(4)}ms`
  if (n < 1) return `${n.toFixed(3)}ms`
  return `${n.toFixed(1)}ms`
}

/**
 * The driver and fixture a curve's numbers came from, **read off the curve**.
 *
 * Never interpolated from a literal at the call site. A heading naming a driver the
 * numbers did not come from is worse than a heading naming none — it is a provenance
 * claim that is confidently wrong — and the only defence against it is reading the value
 * out of the data being rendered. An empty curve says `no runs` rather than reaching
 * through `undefined` into a template.
 */
function provenanceOf(curve: readonly SweepResult[]): string {
  const config = curve[0]?.config
  return config === undefined ? 'no runs' : `${config.driver} driver, ${config.fixture} fixture`
}

/**
 * Just the driver — for the makespan headings, which already name their fixture in the
 * table body beneath and their transport in the heading itself.
 */
function driverOf(curve: readonly SweepResult[]): string {
  const config = curve[0]?.config
  return config === undefined ? 'no runs' : `${config.driver} driver`
}

/**
 * One rung per row — BENCH-04, and BENCH-07's provenance columns.
 *
 * `driver` and `fixture` sit immediately after `nodes`, before any measured quantity, so
 * a reader meets the provenance before the number it qualifies. There is deliberately
 * **no `leg` column**: its value is the same in every published row, and a constant is
 * not a result — the same status this file already gives the two reduce columns the
 * sweep never varies. `leg` rides in the raw observations, which is where the check on
 * it lives.
 */
function sweepTable(results: readonly SweepResult[]): string {
  if (results.length === 0) return '_no runs_\n'
  const rows = results.map((point) => {
    const { makespan, cost } = point
    return `| ${point.config.nodes} | ${point.config.driver} | ${point.config.fixture} | ${ms(makespan.p50)} | ${ms(makespan.p95)} | ${ms(makespan.p99)} | ${makespan.n} | ${point.incomplete} | ${cost.grossNodeSeconds.toFixed(3)} | ${cost.usefulNodeSeconds.toFixed(3)} | ${ratio(cost.verificationTax)} | ${ratio(cost.speculationTax)} | ${cost.churnTax.toFixed(2)} | ${ms(point.coldStartMs ?? Number.NaN)} |`
  })
  return [
    '| nodes | driver | fixture | p50 | p95 | p99 | n | incomplete | gross n·s | useful n·s | verif. tax | spec. tax | churn/task | cold start |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|',
    ...rows,
    '',
  ].join('\n')
}

/**
 * The reduce leg, one row per rung — MR-03, MR-04, MR-05.
 *
 * **A configuration whose reduce was never measured renders every cell after `nodes`
 * as an em dash, and never as its numeric value.** `0 | 0 | 0` would read as "the
 * reduce ran and did nothing", which is a different claim from "this was not
 * measured", and only one of them is true. `ms`'s existing em-dash-for-non-finite
 * behaviour is the precedent this follows; the four counts need the rule stated
 * explicitly because a count of zero is finite and would otherwise print.
 */
function reduceTable(results: readonly SweepResult[]): string {
  if (results.length === 0) return '_no runs_\n'
  const rows = results.map((point) => {
    const { reduce } = point
    if (reduce.ms.n === 0) return `| ${point.config.nodes} | — | — | — | — | — | — |`
    return `| ${point.config.nodes} | ${ms(reduce.ms.p50)} | ${ms(reduce.ms.p95)} | ${reduce.treeDepth} | ${reduce.combines} | ${reduce.recomputes} | ${reduce.combineExecutors} |`
  })
  return [
    '| nodes | reduce p50 | reduce p95 | tree depth | combines | recomputes | combine executors |',
    '|---|---|---|---|---|---|---|',
    ...rows,
    '',
  ].join('\n')
}

/**
 * Render the report as Markdown fit to publish.
 *
 * Gross and useful node-seconds are adjacent columns in every table — BENCH-04 is a
 * property of the layout, not of the author remembering.
 */
export function renderMarkdown(report: Report): string {
  const label = machineLabel(report.inventory)
  const out: string[] = []

  out.push(`# ${report.title}`, '')
  out.push(`**${label}**`, '')
  out.push(`Run at ${report.at}. Methodology pre-registered in`)
  out.push('[`BENCHMARK-METHODOLOGY.md`](./BENCHMARK-METHODOLOGY.md), committed before')
  out.push('this harness existed.', '')

  if (report.unmet.length > 0) {
    out.push('## What these numbers do NOT establish', '')
    for (const item of report.unmet) out.push(`- ${item}`)
    out.push('')
  }

  out.push('## Machine inventory', '')
  out.push('| host | roles | CPU | cores (phys/log) | RAM | OS | runtime |')
  out.push('|---|---|---|---|---|---|---|')
  for (const m of report.inventory.machines) {
    out.push(
      `| ${m.hostId} | ${m.roles.join(', ')} | ${m.cpuModel} | ${m.physicalCores}/${m.logicalCores} | ${bytes(m.totalMemoryBytes)} | ${m.os} ${m.kernel} | ${m.runtime} |`,
    )
  }
  out.push('')

  out.push(`## Makespan — memory transport, ${driverOf(report.memoryTransport)} (${label})`, '')
  out.push(sweepTable(report.memoryTransport))

  out.push(`## Makespan — real transport, ${driverOf(report.realTransport)} (${label})`, '')
  out.push(sweepTable(report.realTransport))

  // Emitted only when the curve exists. A report from before this driver existed
  // renders unchanged apart from its two new columns — no third heading, and no empty
  // table a reader would take for a measured absence.
  if (report.multiProcess !== undefined) {
    out.push(`## Makespan — real transport, ${driverOf(report.multiProcess)} (${label})`, '')
    out.push(sweepTable(report.multiProcess))
  }

  // Placed adjacent to makespan on purpose: the reduce is a *segment of the same job*,
  // and a reader who finds the two tables side by side can add the columns if they
  // prefer the other definition of makespan — one that ends at the aggregate rather
  // than at the last shard. A reader given only the sum could not subtract them.
  // Putting these at the bottom of the file would invite reading them as
  // supplementary, which is the one thing they are not.
  out.push(
    `## Reduce tree — memory transport (${label}) — ${provenanceOf(report.memoryTransport)}`,
    '',
  )
  out.push(reduceTable(report.memoryTransport))

  out.push(
    `## Reduce tree — real transport (${label}) — ${provenanceOf(report.realTransport)}`,
    '',
  )
  out.push(reduceTable(report.realTransport))

  if (report.excluded !== undefined && report.excluded.length > 0) {
    // The one heading that needs a fallback, and it needs it in the case exclusions
    // actually arise in: a rung reaches `excluded` precisely by *failing*, so a run
    // whose every real rung failed has a populated `excluded` and an **empty**
    // `realTransport`. Reading the memory curve instead is still a derivation and not a
    // guess — both trivial ladders are swept by the same driver on the same fixture,
    // within one run. Only when both are empty does the heading say `no runs`.
    const from =
      report.realTransport.length > 0 ? report.realTransport : report.memoryTransport
    out.push(`## Configurations excluded, and why — ${provenanceOf(from)}`, '')
    out.push('| configuration | reason |')
    out.push('|---|---|')
    for (const item of report.excluded) out.push(`| ${item.config} | ${item.reason} |`)
    out.push('')
  }

  out.push(`## Connectivity tax — ${provenanceOf(report.memoryTransport)}`, '')
  if (report.connectivity.length === 0) {
    out.push('_not computed — one of the two curves is missing_', '')
  } else {
    out.push('| nodes | memory p50 | real p50 | tax |')
    out.push('|---|---|---|---|')
    for (const tax of report.connectivity) {
      out.push(`| ${tax.nodes} | ${ms(tax.memoryP50Ms)} | ${ms(tax.realP50Ms)} | ${ratio(tax.ratio)} |`)
    }
    out.push('')
  }

  // Derived from the memory curve because `costCrossover(baseline, memoryResults)` is
  // what the driver computes it over — the heading names the curve the number is
  // actually defined against, not the one a reader might assume.
  out.push(`## COST crossover — ${provenanceOf(report.memoryTransport)}`, '')
  out.push(`Single-threaded baseline: ${describe(report.baseline)}`, '')
  if (report.crossover.found) {
    out.push(
      `**Crossover at ${report.crossover.nodes} nodes** — distributed p50 ${ms(report.crossover.distributedP50Ms)} vs baseline p50 ${ms(report.crossover.baselineP50Ms)}.`,
      '',
    )
  } else {
    out.push(`**No crossover.** ${report.crossover.reason}.`, '')
    out.push(
      `Best distributed p50 was ${ms(report.crossover.bestP50Ms)} at ${report.crossover.bestAtNodes ?? '—'} ${report.crossover.bestAtNodes === 1 ? 'node' : 'nodes'}, against a baseline p50 of ${ms(report.crossover.baselineP50Ms)} — a factor of ${ratio(report.crossover.bestP50Ms / report.crossover.baselineP50Ms)}.`,
      '',
    )
  }

  return out.join('\n')
}
