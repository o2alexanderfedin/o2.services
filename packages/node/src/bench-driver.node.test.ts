import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { stripComments } from './strip-comments.ts'

/**
 * `bin/bench.ts`'s process-per-node driver, its integrity gate and its speedup section,
 * held by something other than the type-checker.
 *
 * **What this is.** A call-site shape guard in `bench-egress.node.test.ts`'s exact idiom:
 * read one source, strip its comments, require the shapes that carry a property, and
 * prove the matcher can report each one absent by planting. It reads source text, so what
 * it proves is that a call site **is written** — never that it runs.
 *
 * **What does carry execution, so that a green here is not mistaken for one.**
 * `coverage-agents.node.test.ts` spawns this driver with `--quick` and asserts it exits 0
 * inside 180 s; `discover-arm.node.test.ts` and `bench-attestation.node.test.ts` spawn it
 * and read printed lines. **None of them runs a rung of the speedup sweeps**, which are
 * skipped under `--quick` for the reason stated at `SPEEDUP_LADDER` — a saturating fixture
 * across spawned processes is minutes of work, and an integrity failure aborts the run by
 * design, which would redden a guard about coverage rendering for a reason about neither.
 * So: nothing in any suite executes a rung of this driver, which was already true of every
 * other rung of it, because its `main()` runs on import. The four readings this file is
 * about fire when a human runs the benchmark, not when a change breaks it. The readings
 * themselves are exercised against planted data in `packages/bench/src/integrity.test.ts`.
 *
 * **Why the gate is asserted as one consumer rather than as four calls.** A source-text
 * guard matches identifiers, not data flow, so it cannot tell a checker that was called
 * and read from one that was called and discarded. The property comes from there being
 * exactly one place that reads all four lists, and from one line whose deletion turns it
 * off — which is a deletion this file can name.
 */

const BENCH = 'packages/node/src/bin/bench.ts'

/** Read once at module scope. Every function below is a plain function over a string. */
const BENCH_SOURCE: string = readFileSync(
  fileURLToPath(new URL('./bin/bench.ts', import.meta.url)),
  'utf8',
)

function occurrences(text: string, needle: string): number {
  return text.split(needle).length - 1
}

interface DriverRequirement {
  /** Named so whoever broke one knows which call site to open without reading this file. */
  readonly name: string
  /** Read against the **comment-stripped** source. */
  readonly check: (stripped: string) => boolean
  /** Why the shape carries a property, not merely that the shape is there. */
  readonly reason: string
  /** A minimal fragment contributing to it, joined to build the planted sources below. */
  readonly satisfying: string
  /**
   * The fragment that BREAKS it, for a requirement asserted as an absence or as a count.
   *
   * Omitting a fragment cannot break either kind — an empty source satisfies "this
   * identifier does not appear" and "these two counts are equal" — so those requirements
   * are planted by **addition** instead. Which requirements those are is not a detail to
   * be discovered: it is the same fact that makes the comments-only case below report
   * five names rather than eight, and both are stated rather than engineered around.
   */
  readonly breaking?: string
}

const REQUIREMENTS: readonly DriverRequirement[] = [
  {
    name: 'the process fabric is built and driven by a runner that disposes each rung',
    check: (source) =>
      /\bprocessFabric\s*\(/.test(source) &&
      /function\s+processRunnerFor\s*\(/.test(source) &&
      occurrences(source, 'processRunnerFor(') >= 2,
    reason:
      'BENCH-07 criterion 1 is about operating-system processes, and processFabric is the only ' +
      'thing in this repository that spawns them for a benchmark rung. processRunnerFor is ' +
      'required both declared and called, because a runner nobody calls is the built-not-wired ' +
      'shape this milestone exists to remove — and it is a separate runner from runnerFor for a ' +
      'behavioural reason: it holds one fabric at a time, so an earlier rung’s idle agents are ' +
      'not resident, each holding a libp2p node and a heap, while a later rung is measured.',
    satisfying:
      'function processRunnerFor(build: (nodes: number) => Promise<ProcessFabric>): ProcessRunner {\n' +
      '  return { run: runnerOver(acquire, state) }\n' +
      '}\n' +
      '    const proc = processRunnerFor(async (nodes) => processFabric(nodes, kernelBytes, SATURATING_RECORD, {}))\n',
  },
  {
    name: 'all four readings are taken and the gate is the thing that reads them',
    check: (source) =>
      /\bassertIntegrity\s*\(/.test(source) &&
      /\bprocessIdentityViolations\s*\(/.test(source) &&
      /\bcpuAttributionViolations\s*\(/.test(source) &&
      /\bfixtureUniformityViolations\s*\(/.test(source) &&
      /\bfixtureProvenanceViolations\s*\(/.test(source),
    reason:
      'Criterion 1 names identity, and the other three are what stop a rung from being believed ' +
      'about itself: the CPU share is the falsifier that does not depend on the harness telling ' +
      'the truth about its own process table, uniformity is what makes a makespan ratio a ' +
      'reading about the fabric rather than about a lopsided split, and provenance is the only ' +
      'one of the four that is a fact about the bytes that were dispatched. Four halves, and a ' +
      'rung missing any of them publishes a figure nothing checked.',
    satisfying:
      '  const identity = processIdentityViolations(observed.identity)\n' +
      '  const cpu = cpuAttributionViolations(observed.cpu)\n' +
      "  const uniformity = fixtureUniformityViolations({ statuses, shards: SHARDS, expected: 'budget' })\n" +
      '  const provenance = fixtureProvenanceViolations({ declared, moduleCid, expected: FIXTURE_CIDS })\n' +
      '  assertIntegrity(at, [...identity, ...cpu, ...uniformity, ...provenance])\n',
  },
  {
    name: 'the gate has one consumer, not four inline branches',
    check: (source) =>
      occurrences(source, 'assertIntegrity(') <= 2 &&
      !/\.length\s*>\s*0\s*\)?\s*\{?\s*throw/.test(source),
    reason:
      'Phrased as an absence deliberately. A source-text guard cannot see data flow, so it ' +
      'cannot distinguish a violation list that was computed and read from one that was ' +
      'computed and dropped. What it CAN see is whether there is one consumer or four, and one ' +
      'consumer is what makes "the gate is off" a one-line deletion that a test can name. Two ' +
      'occurrences are allowed because two sweeps check integrity; four inline length-then-throw ' +
      'branches are the shape this refuses.',
    satisfying: '',
    breaking:
      '  if (identity.length > 0) { throw new HarnessIntegrityError({ at, violations: identity }) }\n',
  },
  {
    name: 'every catch in the file re-throws a harness-integrity failure',
    check: (source) =>
      occurrences(source, 'catch (') === occurrences(source, 'instanceof HarnessIntegrityError'),
    reason:
      'An excluded row says "this configuration could not be measured"; a harness-integrity ' +
      'failure says "the measurement that came back is not of the thing it claims", and the two ' +
      'demand opposite responses — publish the first, publish nothing on the second. Propagation ' +
      'out of main() is therefore a property of EVERY catch between a raise site and the top, ' +
      'not of the raise site. A count equality is what makes it that; a presence pattern could ' +
      'only ever prove that one catch behaves, which is the guard this file replaces.',
    satisfying:
      '    } catch (cause) {\n' +
      '      if (cause instanceof HarnessIntegrityError) throw cause\n' +
      '    }\n',
    breaking: '    } catch (cause) {\n      return null\n    }\n',
  },
  {
    name: 'the ideal bound comes from a serial calibration, and the report says so',
    check: (source) =>
      /\bcalibratePerShard\s*\(/.test(source) && source.includes('one call in flight at a time'),
    reason:
      'The bound is serialTotal ÷ maxShard, and the measured job supplies neither: submitJob ' +
      'dispatches a generation concurrently, so the driver’s own intervals overlap and their sum ' +
      'is not a serial total; nothing in the wire protocol reports a shard’s execution time ' +
      'either. calibratePerShard is what makes the driver-side clock a per-shard clock. The ' +
      'sentence is required as a LITERAL surviving comment-stripping, because it is a claim ' +
      'about how a published number was measured and therefore belongs beside the number in the ' +
      'report, not only in this file’s prose.',
    satisfying:
      'async function calibratePerShard(fabric: ProcessFabric): Promise<readonly number[]> {}\n' +
      "          'one call in flight at a time, so each measurement is that shard’s own duration',\n",
  },
  {
    name: 'no pre-registered speedup constant, and no eight-partition figure',
    check: (source) => !source.includes('PREREGISTERED_IDEAL_SPEEDUP') && !source.includes('6.3'),
    reason:
      'Asserted negatively, and the reason is not style. The withdrawn constant was computed ' +
      'from isolated per-shard measurements at EIGHT partitions; SHARDS is sixteen. Publishing ' +
      'it beside sixteen-partition observations would put a bound for one configuration next to ' +
      'numbers from another, and a reader has no way to tell. Its reappearance is a regression ' +
      'in what the report claims, not a preference about constants.',
    satisfying: '',
    breaking: 'const PREREGISTERED_IDEAL_SPEEDUP = 6.3\n',
  },
  {
    name: 'the three confound readings are published beside the ratio',
    check: (source) =>
      source.includes('churn/task | spec. tax | generations | speculated') &&
      /\bredispatches\b/.test(source) &&
      /\bspeculationMultiplier\b/.test(source),
    reason:
      'A ratio at redundancy 1 without these is a finding about the harness, which criterion 2 ' +
      'forbids. placeAgain sits inside an unconditional generation loop bounded only by the ' +
      'lease table, and the speculation allowance does not read redundancy at all — so holding ' +
      'redundancy at 1 removes one confound and leaves two. The table header is what is matched ' +
      'rather than the identifiers alone, because the property is that they reach the READER: ' +
      'redispatches and speculationMultiplier already ship per rung, so what is new is that all ' +
      'three appear in the same row as the ratio they qualify.',
    satisfying:
      "  '| nodes | driver | p50 makespan | speedup | incomplete | driver CPU share | churn/task | spec. tax | generations | speculated |',\n" +
      '    redispatches: measured.cost.churnTax,\n' +
      '    speculationMultiplier: measured.cost.speculationTax,\n',
  },
  {
    name: 'the speedup headings do not collide with the coverage guard’s stdout regex',
    check: (source) =>
      occurrences(source, '  speedup, ') >= 2 &&
      occurrences(source, 'transport, ${nodes} node(s)…') === 2,
    reason:
      'coverage-agents.node.test.ts asserts that the matches of ' +
      '/^ {2}(memory|real) transport, (\\d+) node\\(s\\)…$/ over a --quick run’s stdout are ' +
      'EXACTLY five specific entries. A speedup rung printed in the transport form would break ' +
      'an equality assertion in a file about coverage rendering. Both halves are required: the ' +
      'speedup rungs must announce themselves under their own prefix, and the count of headings ' +
      'in the transport form must stay at two — one per published sweep — so a third cannot be ' +
      'added without this reporting it.',
    satisfying:
      '      process.stdout.write(`  memory transport, ${nodes} node(s)…\\n`)\n' +
      '      process.stdout.write(`  real transport, ${nodes} node(s)…\\n`)\n' +
      '      process.stdout.write(`  speedup, process-per-node, ${nodes} node(s)…\\n`)\n' +
      '      process.stdout.write(`  speedup, in-process, ${nodes} node(s)…\\n`)\n',
  },
  {
    name: 'an excluded rung’s reason is built from the observation, and the stored paragraph is gone',
    check: (source) =>
      /\bdescribeExclusion\s*\(/.test(source) &&
      !source.includes('a documented default, not a property of the fabric'),
    reason:
      'BENCH-07 criterion 3 asks for a measurement showing the per-host inbound cap is still the ' +
      'cause of the excluded rung. What stood in this file asserted that cause for every failure ' +
      'mode there is: one stored paragraph, naming a specific libp2p limit, attached to whatever ' +
      'the catch block caught, with nothing read off the error but its message — and naming a ' +
      'constant the code does not necessarily run at, since the node factory derives that limit ' +
      'from the reservation limit and the coupling landed after the excluding run. Both halves ' +
      'are required and neither is sufficient: a file that calls describeExclusion and still ' +
      'carries the paragraph publishes the paragraph, and a file that dropped the paragraph ' +
      'without building a reason from the observation publishes nothing at all where a figure ' +
      'belongs.',
    satisfying:
      '        reason: describeExclusion({\n' +
      '          errorName: cause instanceof Error ? cause.name : typeof cause,\n' +
      '          message: detail,\n' +
      '        }),\n',
    // Planted by ADDITION, because the absence half holds over a source with no code in it —
    // this is the paragraph itself, restored verbatim from the committed report.
    breaking:
      "          '`INBOUND_CONNECTION_THRESHOLD = 5` **per host**, and every node here shares one ' +\n" +
      "          'host, so beyond ~5 concurrent dials to the requestor the noise handshake is ' +\n" +
      "          'killed and the failure reads like a network fault. A same-machine artifact of ' +\n" +
      "          'a documented default, not a property of the fabric.',\n",
  },
  {
    name: 'the disputed rung is attempted one lever at a time, and the block publishes a section',
    check: (source) =>
      source.includes(
        '## The excluded rungs, re-measured — in-process and process-per-node drivers, trivial fixture',
      ) &&
      /\bCRITERION_3_ATTEMPTS\b/.test(source) &&
      /\brunAttempt\s*\(/.test(source) &&
      /\bcriterionThreeSection\s*\(/.test(source),
    reason:
      'Three independent levers could each explain the excluded rung — raise the inbound option, ' +
      'stagger the joins, or change which side receives the dials — and adopting the spawn ' +
      'pattern moves the process split AND the dial direction at once. A block that varied two ' +
      'things could not attribute an outcome to either. The heading literal is matched rather ' +
      'than the identifiers alone because the property is that the attempts reach the READER: a ' +
      'factorial that ran and published nothing is a measurement nobody can check, and this ' +
      'driver has no execution in any suite that would show it running.',
    satisfying:
      'const CRITERION_3_ATTEMPTS: readonly Attempt[] = []\n' +
      'async function runAttempt(attempt: Attempt): Promise<AttemptOutcome> {}\n' +
      '      criterionThree.push(await runAttempt(attempt))\n' +
      '    ...criterionThreeSection(criterionThree),\n' +
      "    '## The excluded rungs, re-measured — in-process and process-per-node drivers, trivial fixture',\n",
  },
  {
    name: 'the calibration labels its task and reads whether each call ran',
    check: (source) => {
      const body = source.slice(source.indexOf('async function calibratePerShard'))
      return (
        body.includes("label: 'public'") &&
        /\bconst\s+outcome\s*=\s*await\s+executor\.execute\s*\(/.test(body) &&
        /if\s*\(!outcome\.ok\)/.test(body)
      )
    },
    reason:
      'Measured on 2026-08-05, and this requirement exists because the defect was published ' +
      'before it was found. `Executor.execute` reports failure by RETURNING `{ok: false, ' +
      'reason}` and never by throwing, so a loop that discards the outcome measures a refusal ' +
      'as though it were a shard. `Task.label` is optional in process and REQUIRED at the wire ' +
      '— parseRequest’s exec branch refuses a frame carrying neither `public` nor `sovereign`, ' +
      'so an unlabelled task cannot reach guardSovereignty as a no-op — and this call site had ' +
      'no label. All sixteen calls came back `malformed request` in 1.2–4.3 ms each, against the ' +
      '~90 ms the same shard costs in the rung’s own dispatch intervals, and the run published ' +
      'an ideal bound of 8.71× derived from sixteen refusal round trips. Both halves are ' +
      'required and each fails differently: without the label every call is refused, and without ' +
      'the check a refusal is indistinguishable from a fast shard. A wrong bound looks exactly ' +
      'like a right one, which is why this cannot be left to the reader of the number.',
    satisfying:
      'async function calibratePerShard(fabric: ProcessFabric): Promise<readonly number[]> {\n' +
      '    const outcome = await executor.execute({\n' +
      "      label: 'public',\n" +
      '    })\n' +
      '    if (!outcome.ok) {\n' +
      '      throw new Error(`the serial calibration did not run`)\n' +
      '    }\n' +
      '}\n',
  },
]

/**
 * Requirements satisfied by an empty source, and therefore not reported by the
 * comments-only case below.
 *
 * A requirement asserted as an absence or as a count equality holds vacuously over a source
 * with no code in it. That is a property of the assertion, not a hole in the guard — each of
 * those is planted by **addition** instead, and each of those plants is watched below.
 *
 * **Measured by running each check against the empty source, not inferred from
 * {@link DriverRequirement.breaking}.** The inference was exact while every requirement was
 * purely a presence or purely an absence, and Plan 23-04 broke that: its first new
 * requirement is **both** — describeExclusion must appear and the stored paragraph must not
 * — so it needs a breaking fragment *and* is reported over an empty source, and the proxy
 * would have put it on the wrong side. A list that says which checks are vacuous is worth
 * having; one that says which checks were *declared* vacuous is worth nothing.
 */
const VACUOUS_ON_AN_EMPTY_SOURCE: readonly string[] = REQUIREMENTS.filter(({ check }) =>
  check(''),
).map(({ name }) => name)

/**
 * The names of the requirements `source` does not satisfy, in declaration order.
 *
 * A plain function over content, separated from the file read above so the planted cases
 * can prove it reports something. A scan that reports nothing against the real file proves
 * nothing until it has been watched reporting something.
 */
function unmetRequirements(source: string): string[] {
  const stripped = stripComments(source)
  return REQUIREMENTS.filter(({ check }) => !check(stripped)).map(({ name }) => name)
}

/**
 * A source satisfying every requirement except `name`.
 *
 * Two shapes, because there are two kinds of requirement. A presence requirement is broken
 * by leaving its fragment out; an absence or count requirement is broken by adding one.
 */
function plantedSource(name: string): string {
  const target = REQUIREMENTS.find((requirement) => requirement.name === name)
  const whole = REQUIREMENTS.map(({ satisfying }) => satisfying).join('')
  if (target?.breaking !== undefined) return whole + target.breaking
  return REQUIREMENTS.filter((requirement) => requirement.name !== name)
    .map(({ satisfying }) => satisfying)
    .join('')
}

function describeUnmet(names: readonly string[]): string[] {
  return names.map((name) => {
    const reason = REQUIREMENTS.find((requirement) => requirement.name === name)?.reason ?? ''
    return `${BENCH} — missing: ${name}. Why it matters: ${reason}`
  })
}

describe('bin/bench.ts spawns its nodes, checks that it did, and says what it measured', () => {
  it('satisfies every call-site requirement in the real source', () => {
    // Anti-vacuity: a wrong path or an empty read would make "nothing unmet" mean nothing.
    // readFileSync would have thrown on a wrong path, but a truncated or replaced file
    // would not, and this is the reading the whole file rests on. Both function names are
    // separately pinned by `bench-egress.node.test.ts`; they are re-read here because this
    // file's own planted sources are short, and a scan that passed over one of them by
    // accident would look identical to a scan that passed over the driver.
    expect(BENCH_SOURCE.length).toBeGreaterThan(5_000)
    expect(BENCH_SOURCE).toContain('async function memoryFabric')
    expect(BENCH_SOURCE).toContain('async function realFabric')

    expect(describeUnmet(unmetRequirements(BENCH_SOURCE))).toEqual([])
  })

  it('holds the catch-count equality on the real source, with both counts above zero', () => {
    // The equality alone is satisfied by a file with no catch blocks at all, and this
    // driver has three. Reading the counts rather than only their equality is what stops
    // that from being the reading.
    const stripped = stripComments(BENCH_SOURCE)
    const catches = occurrences(stripped, 'catch (')
    expect(catches).toBeGreaterThan(0)
    expect(occurrences(stripped, 'instanceof HarnessIntegrityError')).toBe(catches)
  })
})

describe('the scan can report an unmet requirement — proved by planting, not assumed', () => {
  for (const { name } of REQUIREMENTS) {
    it(`reports exactly "${name}" when only that call site is wrong`, () => {
      const unmet = unmetRequirements(plantedSource(name))
      // Asserted non-empty before it is compared, so a matcher that has stopped reading
      // cannot pass as a driver with nothing wrong in it.
      expect(unmet.length).toBeGreaterThan(0)
      // `toEqual` rather than `toContain` on purpose: it asserts every other requirement
      // is still satisfied by the same source, so one planted case doubles as the control
      // for the rest.
      expect(unmet).toEqual([name])
    })
  }

  /**
   * Every satisfying fragment, verbatim, with each line turned into a line comment.
   *
   * **Built from the fragments rather than hand-written, and that is a measured
   * correction rather than a preference.** A hand-written paragraph *describing* the call
   * sites was tried first and it made this case useless: it happened to spell
   * `cpuAttributionViolations` without its parenthesis and to name only one of the two
   * speedup headings, so it failed the presence checks whether or not the source was
   * stripped — and deleting the `stripComments` call left the whole file green. Composing
   * it from `satisfying` guarantees the property the case is for: unstripped, this source
   * satisfies every presence requirement; stripped, it satisfies none of them.
   */
  const commentsOnly: string = [
    ...REQUIREMENTS.flatMap(({ satisfying }) =>
      satisfying.split('\n').map((line) => `// ${line}`),
    ),
    'const theCallSitesThemselvesAreGone = true',
  ].join('\n')

  it('reports every presence requirement when the call sites survive only as comments', () => {
    // The defect this guard would otherwise have: bin/bench.ts names all of these in its
    // own doc comments, so a raw-text match could be satisfied by prose describing a call
    // site that had been deleted.
    //
    // It reports eight names and not eleven, and that is a property of the assertions rather
    // than of the stripper: an absence requirement and a count equality both hold over a
    // source with no code in it. Those three are in `VACUOUS_ON_AN_EMPTY_SOURCE`, which is
    // computed by running each check against the empty source, and each is planted by
    // addition above.
    //
    // **Moved 7 → 8 by Plan 23-05, and the reason is stated rather than left to be
    // reconstructed:** the eleventh requirement — the calibration labels its task and reads
    // whether each call ran — is a pure presence check, so it is reported over a source with
    // no code in it and joins this list. It was added because the defect it guards had
    // already been published: sixteen refused calls were measured as shard durations and a
    // derived ideal bound was rendered off them. A number that moves without its comment is
    // how a guard becomes decoration, which is this file's own thesis about itself.
    const expected = REQUIREMENTS.map(({ name }) => name).filter(
      (name) => !VACUOUS_ON_AN_EMPTY_SOURCE.includes(name),
    )
    expect(expected.length).toBe(8)
    expect(unmetRequirements(commentsOnly)).toEqual(expected)
  })

  it('would satisfy those same five if the comments were NOT stripped', () => {
    // The other half, and without it the case above cannot distinguish a stripper from a
    // fixture that was never satisfiable. Read against the raw text, every presence
    // requirement holds — which is exactly the reading that makes stripping load-bearing.
    const unstripped = REQUIREMENTS.filter(({ check }) => !check(commentsOnly)).map(
      ({ name }) => name,
    )
    expect(unstripped).toEqual([])
  })
})
