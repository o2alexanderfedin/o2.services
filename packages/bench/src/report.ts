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
 * `hosts` is required and `sameMachine` is derived from it, never declared. Sixteen
 * processes on one laptop share a CPU, a memory bus, a page cache and a scheduler;
 * that is a legitimate measurement of software scaling with hardware contention
 * included and the network excluded, and it is **not** a measurement of sixteen nodes.
 * Reporting it as sixteen nodes would be the most misleading thing this project could
 * publish, which is why BENCH-06 exists and why the label is computed rather than
 * supplied.
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

/** The label that must appear wherever the numbers appear. */
export function machineLabel(inventory: Inventory): string {
  const hosts = hostCount(inventory)
  if (inventory.nodeCount <= 1) return `single node on ${hosts} host`
  return isSameMachine(inventory)
    ? `SAME-MACHINE: ${inventory.nodeCount} processes on 1 host — not ${inventory.nodeCount} nodes`
    : `${inventory.nodeCount} nodes across ${hosts} hosts`
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

function sweepTable(results: readonly SweepResult[]): string {
  if (results.length === 0) return '_no runs_\n'
  const rows = results.map((point) => {
    const { makespan, cost } = point
    return `| ${point.config.nodes} | ${ms(makespan.p50)} | ${ms(makespan.p95)} | ${ms(makespan.p99)} | ${makespan.n} | ${point.incomplete} | ${cost.grossNodeSeconds.toFixed(3)} | ${cost.usefulNodeSeconds.toFixed(3)} | ${ratio(cost.verificationTax)} | ${ratio(cost.speculationTax)} | ${cost.churnTax.toFixed(2)} | ${ms(point.coldStartMs ?? Number.NaN)} |`
  })
  return [
    '| nodes | p50 | p95 | p99 | n | incomplete | gross n·s | useful n·s | verif. tax | spec. tax | churn/task | cold start |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|',
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

  out.push(`## Makespan — memory transport (${label})`, '')
  out.push(sweepTable(report.memoryTransport))

  out.push(`## Makespan — real transport (${label})`, '')
  out.push(sweepTable(report.realTransport))

  if (report.excluded !== undefined && report.excluded.length > 0) {
    out.push('## Configurations excluded, and why', '')
    out.push('| configuration | reason |')
    out.push('|---|---|')
    for (const item of report.excluded) out.push(`| ${item.config} | ${item.reason} |`)
    out.push('')
  }

  out.push('## Connectivity tax', '')
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

  out.push('## COST crossover', '')
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
