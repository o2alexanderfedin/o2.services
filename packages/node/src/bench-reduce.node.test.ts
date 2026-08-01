import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * `bin/bench.ts`'s reduce leg, and the artifact it produces — MR-03, MR-04, MR-05.
 *
 * **What this is.** Two guards in the idiom `bench-egress.node.test.ts` established:
 * a call-site shape guard over the driver's source, and a published-artifact guard
 * over `.planning/BENCHMARK-RESULTS.md`. Both read one file, require the shapes that
 * carry a property to be present, and are proved able to report their absence by
 * planting.
 *
 * **What this is not.** Behavioural. It runs no benchmark, for a fact about the file
 * rather than for effort: `bin/bench.ts` drives its ladders from a top-level `main()`
 * that executes on import, so exercising it means running the benchmark. Read a green
 * result as *"the wiring is written down and the last published run contained a reduce
 * table"*, **never** as *"the reduce was measured on this commit"*. What would measure
 * that is extracting the ladder loop from `main()` behind an exported function a test
 * could drive with a two-rung ladder and one iteration — a restructuring Phase 23 is
 * already scheduled to perform for its own reasons, and the right place for it.
 *
 * **The limit worth naming**, inherited with the idiom: {@link stripComments} is
 * regex-based, so a comment opener inside a string literal would be treated as opening
 * a comment. The failure direction is the safe one — over-stripping can only report a
 * satisfied requirement as unmet, which fails loudly, never the reverse.
 */

const BENCH = 'packages/node/src/bin/bench.ts'
const RESULTS = '.planning/BENCHMARK-RESULTS.md'

/** Repo root, resolved the way `vocabulary.node.test.ts` resolves its own `ROOT`. */
const ROOT: string = fileURLToPath(new URL('../../..', import.meta.url))

const BENCH_SOURCE: string = readFileSync(fileURLToPath(new URL('./bin/bench.ts', import.meta.url)), 'utf8')
const RESULTS_DOCUMENT: string = readFileSync(`${ROOT}${RESULTS}`, 'utf8')

/**
 * The tree shape `bin/bench.ts`'s shard count produces, **measured**.
 *
 * Measured 2026-07-31 by calling the production `deriveReduceTree` over the production
 * projection's output — 16 partials of the form `{counts: {'partition-N': 1}, rows: 1}`
 * under contributor ids `shard-0`…`shard-15`, at `DEFAULT_FANOUT` — which reported
 * `nodes: 5, depth: 2` (layout L1:4, L2:1). Confirmed end to end by a `--quick` run of
 * this driver, whose memory-transport table reads `tree depth 2` and `combines 5` on
 * every rung.
 *
 * **These are deliberately not the figures in 16-02-SUMMARY.md**, and the difference is
 * the whole reason this comment is long. That summary measured `nodes: 3, depth: 2`
 * over **8** leaves, and 16-04-PLAN.md instructed this file to transcribe them. But
 * `bin/bench.ts` ships `SHARDS = 16` — raised from 8 by phase 13.1 — so 8 is not the
 * leaf count this artifact is produced at, and transcribing `3` would have made this
 * requirement fail against a correct run. The identical measurement method re-run at 8
 * leaves reproduces 16-02's `nodes: 3, depth: 2` exactly, which is what licenses using
 * the method at 16 rather than re-deriving anything.
 *
 * Equality rather than `>= 1`, because any other value is a finding: it would mean the
 * tree is not the shape `deriveReduceTree` produces for this leaf count and fanout.
 */
const MEASURED_TREE_DEPTH = 2
const MEASURED_COMBINES = 5

/**
 * Strips `//` line comments and block comments.
 *
 * The whole reason this guard is worth having. `bin/bench.ts` *names* every identifier
 * below in its own prose — the doc on `Fabric.rpc`, the paragraph on why the projection
 * decodes the output, the comment on why `complete` was deliberately not extended.
 * Match the raw text and a reader could delete every call site, leave the comments
 * describing them, and keep this file green.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, '')
}

interface CallSiteRequirement {
  /** Named so whoever broke one knows which call site to open. */
  readonly name: string
  /** Every pattern must match. Plural because several are conjunctions in the source. */
  readonly patterns: readonly RegExp[]
  /**
   * Patterns that must **not** match. Empty for all but one requirement, and that one
   * is the reason this field exists: "the shape is absent" and "a different shape is
   * present" are different failures, and only a forbidden pattern catches the second.
   */
  readonly forbidden?: readonly RegExp[]
  /** Why the shape carries a property, not merely that the shape is there. */
  readonly reason: string
  /** A minimal fragment satisfying it, used to build the planted sources below. */
  readonly satisfying: string
}

const REQUIREMENTS: readonly CallSiteRequirement[] = [
  {
    name: 'the measured job path calls reduceJob with a projection',
    patterns: [/\breduceJob\s*\(/, /\bproject\s*[,:]/],
    reason:
      'This is the wiring criterion 4’s first clause promises: the reduce runs on the same job path ' +
      'that already calls submitJobWithEgress, not beside it. Deleting the call leaves every reduce ' +
      'figure at its not-measured sentinel and the published table entirely em-dashed, which reads ' +
      'like an unmeasurable configuration rather than like a deleted feature.',
    satisfying: '      const reduced = await reduceJob(result.job, { rpc: fabric.rpc, project, })\n',
  },
  {
    name: 'the reduce figures are read off the result, not written down',
    patterns: [/reduced\.tree\.depth/, /reduced\.outcome\.combines/, /reduced\.outcome\.recomputes/],
    reason:
      'A benchmark that writes its own numbers down measures nothing. All three halves are required ' +
      'and each fails differently: tree depth comes from the derived topology, combines from what ' +
      'executeReduce actually placed, recomputes from what it had to retry. A literal in any one of ' +
      'them would survive every other check in this file.',
    satisfying:
      '          treeDepth: reduced.tree.depth,\n' +
      '          combines: reduced.outcome.combines,\n' +
      '          recomputes: reduced.outcome.recomputes,\n',
  },
  {
    name: 'combineExecutors is derived from executedBy, not written down',
    patterns: [/new\s+Set\s*\(\s*reduced\.outcome\.executedBy\.values\(\)\s*\)/],
    reason:
      'MR-05 is the claim that rendezvous hashing spreads combines across executors, and the only ' +
      'evidence for it in the published table is this column. A hardcoded `combineExecutors: 2` ' +
      'satisfies every other requirement in this file and turns the one number that carries MR-05 ' +
      'into an assertion. The Set is also what makes it *distinct* executors rather than a count of ' +
      'combines.',
    satisfying: '          combineExecutors: new Set(reduced.outcome.executedBy.values()).size,\n',
  },
  {
    name: 'completeness is NOT coupled to the reduce',
    patterns: [/const\s+complete\s*=\s*result\.ok\s*&&\s*result\.job\.complete/],
    forbidden: [/const complete =[^\n]*reduce/],
    reason:
      'makespan is summarised over `complete` runs in @o2/bench, so appending `&& reduceOk` here ' +
      'would condition every published p50/p95/p99 on the reduce having succeeded — the same ' +
      'interval measured over a different population, and a silent redefinition of the primary ' +
      'metric that no change to BENCHMARK-METHODOLOGY.md §2.1’s wording would reveal. It would move ' +
      '`incomplete` off its pre-reduce meaning too. Both halves are required: the presence pattern ' +
      'catches deletion, the forbidden pattern catches the append, and neither alone catches both.',
    satisfying: '    const complete = result.ok && result.job.complete\n',
  },
  {
    name: 'the fabric supplies the submitting node’s own endpoint as rpc',
    patterns: [/readonly\s+rpc\s*:\s*RpcEndpoint/, /\brpc\s*:\s*callerRpc\b/, /\brpc\s*:\s*requestor\.rpc\b/],
    reason:
      'A combine is dispatched from the submitter’s endpoint — the same one every RemoteExecutor is ' +
      'built over and the one whose serveAgent the combine nodes fetch their leaves back through. A ' +
      'second endpoint would be a second peer as far as the workers are concerned. Three halves, one ' +
      'per site: the field on Fabric, and one supply from each of the two rigs — and a rig that ' +
      'stopped supplying it would leave that transport’s whole reduce curve unmeasured while the ' +
      'other stayed green.',
    satisfying:
      '  readonly rpc: RpcEndpoint\n' + '    rpc: callerRpc,\n' + '    rpc: requestor.rpc,\n',
  },
  {
    name: 'the projection decodes the output rather than the partition index',
    patterns: [/partitionOf\s*\(/],
    reason:
      'A projection of the form `(_output, partitionIndex) => …` produces identical values with one ' +
      'less step and makes every leaf a pure function of an integer the driver already holds — so ' +
      'nothing any executor computed would enter the aggregate, and a guest returning any agreed ' +
      'output whatsoever would give the identical root. The reduce leg would then time a tree walk ' +
      'over values the requestor invented. This is the only requirement that catches that revert, ' +
      'because such a driver satisfies every other check here.',
    // The pattern requires a *call*, not a declaration: a `partitionOf` defined and
    // never applied leaves the projection keyed on the index just as surely as one
    // that was deleted, so the fragment below has to invoke it.
    satisfying: '  counts: { [`partition-${partitionOf(output)}`]: 1 },\n',
  },
]

/** The names of the requirements `source` does not satisfy, in declaration order. */
function unmetRequirements(source: string): string[] {
  const stripped = stripComments(source)
  return REQUIREMENTS.filter(
    ({ patterns, forbidden }) =>
      !patterns.every((pattern) => pattern.test(stripped)) ||
      (forbidden ?? []).some((pattern) => pattern.test(stripped)),
  ).map(({ name }) => name)
}

/** Every fragment except `omit`, joined — a source satisfying five of the six. */
function plantedSource(omit: string): string {
  return REQUIREMENTS.filter(({ name }) => name !== omit)
    .map(({ satisfying }) => satisfying)
    .join('')
}

function describeUnmet(names: readonly string[]): string[] {
  return names.map((name) => {
    const reason = REQUIREMENTS.find((requirement) => requirement.name === name)?.reason ?? ''
    return `${BENCH} — missing: ${name}. Why it matters: ${reason}`
  })
}

describe('the reduce call site in bin/bench.ts', () => {
  it('satisfies every call-site requirement in the real source', () => {
    // Anti-vacuity: a truncated or replaced file would make "nothing unmet" mean
    // nothing, and readFileSync would not have thrown on it.
    expect(BENCH_SOURCE.length).toBeGreaterThan(5_000)
    expect(BENCH_SOURCE).toContain('async function memoryFabric')

    expect(describeUnmet(unmetRequirements(BENCH_SOURCE))).toEqual([])
  })

  it('closes the makespan bracket before it opens the reduce', () => {
    const stripped = stripComments(BENCH_SOURCE)

    // Guarded against absence FIRST, and separately, because `indexOf` returns -1 for
    // a string that is not there: a source with the reduceJob call *deleted* would
    // make the ordering comparison below false and fail with a message accusing the
    // driver of widening the bracket — a true failure with a wrong diagnosis. Absence
    // is reported as absence here, and by requirement 1 above, which is where it
    // belongs.
    expect(
      stripped.indexOf('const makespanMs ='),
      `${BENCH} no longer closes a makespan bracket at all`,
    ).toBeGreaterThanOrEqual(0)
    expect(
      stripped.indexOf('reduceJob('),
      `${BENCH} no longer calls reduceJob — see the call-site requirements above`,
    ).toBeGreaterThanOrEqual(0)

    // The one requirement no pattern set can express: a driver that moved the reduce
    // inside the bracket satisfies all six patterns above and silently redefines the
    // primary metric.
    expect(
      stripped.indexOf('const makespanMs ='),
      'the reduce must be timed AFTER the makespan bracket closes. ' +
        '.planning/BENCHMARK-METHODOLOGY.md §2.1 defines makespan to the last shard’s result being ' +
        'available to the requestor; a combine happens after that, so a reduce inside the bracket ' +
        'redefines the primary metric across every previously published number.',
    ).toBeLessThan(stripped.indexOf('reduceJob('))
  })
})

describe('the call site guard can report absence — proved by planting, not assumed', () => {
  for (const { name } of REQUIREMENTS) {
    it(`reports exactly "${name}" when only that call site is gone`, () => {
      // `toEqual` rather than `toContain`: it asserts the other five are still
      // satisfied by the same source, so one planted case doubles as the control for
      // the rest.
      expect(unmetRequirements(plantedSource(name))).toEqual([name])
    })
  }

  it('reports the coupling requirement when `complete` grows a reduce term', () => {
    // The failure the forbidden pattern exists for, and the one a presence-only check
    // cannot see: the expression is still there, with `&& reduceOk` appended.
    const coupled = plantedSource('completeness is NOT coupled to the reduce').concat(
      '    const complete = result.ok && result.job.complete && reduce.ok\n',
    )
    expect(unmetRequirements(coupled)).toEqual(['completeness is NOT coupled to the reduce'])
  })

  it('reports every requirement when every identifier appears only inside a comment', () => {
    const commentsOnly = [
      '// The driver used to call reduceJob(result.job, {rpc, executors, blockstore, project}).',
      '/*',
      ' * It read reduced.tree.depth, reduced.outcome.combines and reduced.outcome.recomputes,',
      ' * and derived new Set(reduced.outcome.executedBy.values()).size from the outcome.',
      ' * Fabric carried readonly rpc: RpcEndpoint, supplied as rpc: callerRpc and rpc: requestor.rpc.',
      ' * The projection called partitionOf(output) to decode the guest’s bytes.',
      ' */',
      '// const complete = result.ok && result.job.complete',
      'const theCallSitesThemselvesAreGone = true',
    ].join('\n')

    expect(unmetRequirements(commentsOnly)).toEqual(REQUIREMENTS.map(({ name }) => name))
  })
})

const REDUCE_HEADER =
  '| nodes | reduce p50 | reduce p95 | tree depth | combines | recomputes | combine executors |'

interface ReduceRow {
  readonly nodes: number | null
  readonly treeDepth: number | null
  readonly combines: number | null
  readonly combineExecutors: number | null
}

/**
 * Every data row under every reduce table in `document`.
 *
 * A plain function over a string, deliberately separate from the file read above —
 * that separation is what lets the planted synthetic documents feed it, and it is why
 * `bench-egress.node.test.ts` is shaped the way it is. An em dash parses as `null`
 * rather than as a number, so "unmeasured" and "zero" stay distinguishable here
 * exactly as they are in the rendered table.
 */
function reduceRows(document: string): readonly ReduceRow[] {
  const lines = document.split('\n')
  const rows: ReduceRow[] = []
  const numberAt = (cells: readonly string[], index: number): number | null => {
    const raw = cells[index]
    if (raw === undefined) return null
    const parsed = Number(raw)
    return raw !== '' && Number.isFinite(parsed) ? parsed : null
  }

  for (let i = 0; i < lines.length; i++) {
    if (lines[i]?.trim() !== REDUCE_HEADER) continue
    for (let j = i + 1; j < lines.length; j++) {
      const line = lines[j]?.trim() ?? ''
      if (!line.startsWith('|')) break
      // The `|---|---|` separator carries no data.
      if (/^\|[\s|:-]+\|$/.test(line)) continue
      const cells = line
        .split('|')
        .slice(1, -1)
        .map((cell) => cell.trim())
      rows.push({
        nodes: numberAt(cells, 0),
        treeDepth: numberAt(cells, 3),
        combines: numberAt(cells, 4),
        combineExecutors: numberAt(cells, 6),
      })
    }
  }
  return rows
}

interface ArtifactRequirement {
  readonly name: string
  readonly reason: string
  readonly holds: (document: string) => boolean
}

const ARTIFACT_REQUIREMENTS: readonly ArtifactRequirement[] = [
  {
    name: 'a Reduce tree section',
    reason:
      'Criterion 4’s first clause is that the driver reports the reduce as part of its measured job ' +
      'path. A reader of the published artifact can check the source for nothing; the heading is ' +
      'where the claim becomes visible to them.',
    holds: (document) => document.includes('## Reduce tree'),
  },
  {
    name: 'the reduce table header row',
    reason:
      'The columns are the report’s contract with a reader — which figures were measured, in which ' +
      'order. A renamed or reordered column silently changes what a copied row means, and the ' +
      'parser below indexes by position.',
    holds: (document) => document.includes(REDUCE_HEADER),
  },
  {
    name: 'at least one measured reduce row',
    reason:
      'Tree depth and combines are MEASURED figures for this driver’s shard count and fanout, not a ' +
      'loose bound: `deriveReduceTree` over 16 contributions at fanout 4 gives nodes 5, depth 2, and ' +
      'the same method at 8 reproduces 16-02’s nodes 3, depth 2. A row reading anything else means ' +
      'the tree is not the shape that function produces, which is a finding rather than a formatting ' +
      'question — so this is an equality, and `>= 1` would have measured presence instead of shape.',
    holds: (document) =>
      reduceRows(document).some(
        (row) => row.treeDepth === MEASURED_TREE_DEPTH && row.combines === MEASURED_COMBINES,
      ),
  },
  {
    name: 'at least one row with two or more combine executors',
    reason:
      'MR-05’s visible claim: rendezvous assignment put combines on more than one executor. "At ' +
      'least one row" and never "every row", because the nodes=1 rung of LADDER has one executor by ' +
      'construction and runs every combine in the tree itself — the same structural fact the unmet ' +
      'list already records for that rung’s verification tax.',
    holds: (document) => reduceRows(document).some((row) => (row.combineExecutors ?? 0) >= 2),
  },
]

function unmetArtifact(document: string): string[] {
  return ARTIFACT_REQUIREMENTS.filter(({ holds }) => !holds(document)).map(({ name }) => name)
}

/** A document with the structure and no values — every cell an em dash. */
const EM_DASH_ONLY_DOCUMENT = [
  '## Reduce tree — memory transport (SAME-MACHINE: 4 processes on 1 host — not 4 nodes)',
  '',
  REDUCE_HEADER,
  '|---|---|---|---|---|---|---|',
  '| 1 | — | — | — | — | — | — |',
  '| 2 | — | — | — | — | — | — |',
  '',
].join('\n')

/**
 * A document whose rows carry a **spine's** figures rather than a tree's.
 *
 * A left fold over 16 leaves combines 15 times at depth 15 — the shape Plan 16-03's
 * Mutation B captures, and the one a `deriveReduceTree` that had stopped grouping by
 * fanout would produce. Structurally valid, numerically wrong.
 */
const FOLD_SHAPED_DOCUMENT = [
  '## Reduce tree — memory transport (SAME-MACHINE: 4 processes on 1 host — not 4 nodes)',
  '',
  REDUCE_HEADER,
  '|---|---|---|---|---|---|---|',
  '| 1 | 1.2ms | 1.5ms | 15 | 15 | 0 | 1 |',
  '| 4 | 1.3ms | 1.9ms | 15 | 15 | 0 | 3 |',
  '',
].join('\n')

describe('the published artifact carries the reduce table', () => {
  it('satisfies every artifact requirement in the committed document', () => {
    // Anti-vacuity, same reasoning as the source guard above.
    expect(RESULTS_DOCUMENT.length).toBeGreaterThan(2_000)
    expect(RESULTS_DOCUMENT).toContain('## Makespan')

    expect(unmetArtifact(RESULTS_DOCUMENT)).toEqual([])
  })

  it('reports the two value requirements against a structurally valid but empty table', () => {
    // Without this, "nothing unmet" against the real document would mean nothing. The
    // two structural requirements stay met, which is what makes this a control as well
    // as a falsification.
    expect(unmetArtifact(EM_DASH_ONLY_DOCUMENT)).toEqual([
      'at least one measured reduce row',
      'at least one row with two or more combine executors',
    ])
  })

  it('reports a wrong value, not only a missing one', () => {
    // Without this the value requirement could be satisfied by any number at all and
    // would be measuring presence rather than shape.
    expect(unmetArtifact(FOLD_SHAPED_DOCUMENT)).toContain('at least one measured reduce row')
    // …and the executors requirement is *met* by the same document, so the failure is
    // attributed to the column that actually disagrees.
    expect(unmetArtifact(FOLD_SHAPED_DOCUMENT)).not.toContain(
      'at least one row with two or more combine executors',
    )
  })

  it('parses an em dash as unmeasured rather than as a zero', () => {
    // The distinction the whole rendering rule exists to preserve, asserted on the
    // parser too: a row of em dashes must not read as a row of zeros, or a refused
    // reduce would satisfy a `>= 0` bound somewhere later.
    const rows = reduceRows(EM_DASH_ONLY_DOCUMENT)
    expect(rows).toHaveLength(2)
    expect(rows[0]?.treeDepth).toBeNull()
    expect(rows[0]?.combines).toBeNull()
    expect(rows[0]?.nodes).toBe(1)
  })
})
