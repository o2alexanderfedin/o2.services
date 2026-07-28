import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * `bin/bench.ts`'s egress leg, held by something other than the type-checker.
 *
 * 13-VERIFICATION.md's mutation 4 reverted the benchmark driver to bare `submitJob`
 * and found the regression caught by `tsc --noEmit` alone — and only because the
 * `result.manifests[0]` read had been left behind to fail on. An edit removing the
 * call and its manifest read together would have passed the whole suite. That is
 * the guard nobody was watching, and this file is it.
 *
 * **What this is.** A call-site shape guard, in the idiom this package already uses
 * for `purity.node.test.ts` (no platform import inside a portable package) and
 * `disclosure-gate.node.test.ts` (no script publishes anything): read one source,
 * require the shapes that carry a property to be present, and prove the matcher can
 * report their absence.
 *
 * **What this is not.** Behavioural. It runs no benchmark and observes no frame.
 * That was considered and rejected on a fact about the file rather than on effort:
 * `bin/bench.ts` drives its ladders and a real-libp2p sweep from a top-level
 * `main()` that executes on import, so exercising it means running the benchmark —
 * minutes of real TCP nodes standing up and tearing down, inside a suite that has
 * to stay runnable on every change. The shape check costs one file read. Read a
 * green result here as "the wiring is still written down", never as "the manifest
 * was measured".
 *
 * **The limit worth naming.** {@link stripComments} is regex-based, so a comment
 * opener inside a string literal would be treated as opening a comment. Confirmed
 * absent from `bin/bench.ts`, and the failure direction is the safe one:
 * over-stripping can only report a satisfied requirement as unmet, which fails
 * loudly, never the reverse.
 */

const BENCH = 'packages/node/src/bin/bench.ts'

/**
 * Read once at module scope, the way `vocabulary.node.test.ts` computes `REPO`
 * once. The two functions below are plain functions over a string and never touch
 * the filesystem, which is what lets the planted cases feed them synthetic sources.
 */
const BENCH_SOURCE: string = readFileSync(fileURLToPath(new URL('./bin/bench.ts', import.meta.url)), 'utf8')

/**
 * Strips `//` line comments and block comments.
 *
 * Not decoration — it is the whole reason this guard is worth having.
 * `bin/bench.ts` *names* every identifier below in its own prose: the doc comment
 * on `Fabric.guard`, the paragraph explaining why `memoryFabric` builds its own
 * tap, and `runnerFor`'s doc naming `submitJobWithEgress` against "the bare
 * `submitJob` this driver used to call". Match the raw text and a reader could
 * delete all four call sites, leave the comments describing them, and keep this
 * file green — a guard satisfied by a description of the thing it guards.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, '')
}

interface CallSiteRequirement {
  /**
   * Named so whoever broke one knows which call site to open without reading this
   * file first.
   */
  readonly name: string
  /**
   * Every pattern must match for the requirement to be satisfied. Plural because
   * two of these are conjunctions in the source — a value constructed *and* passed,
   * a manifest indexed *and* read — and a requirement met by half of itself is the
   * shape mutation 4 already walked through once.
   */
  readonly patterns: readonly RegExp[]
  /** Why the shape carries a property, not merely that the shape is there. */
  readonly reason: string
  /** A minimal fragment satisfying it, used to build the planted sources below. */
  readonly satisfying: string
}

const REQUIREMENTS: readonly CallSiteRequirement[] = [
  {
    name: 'realFabric hands the submitting node’s own tap to the job path',
    patterns: [/\bguard\s*:\s*requestor\.egress\b/],
    reason:
      'Amended ROADMAP criterion 2 promises the manifest of the *submitting* node, and this is the ' +
      'site that supplies it. FabricNode.start already built the guard and constructed rpc over it, ' +
      'so realFabric only has to surface the field — which is why deleting one line is enough to ' +
      'leave the real-libp2p sweep reporting egress for nobody.',
    satisfying: '    guard: requestor.egress,\n',
  },
  {
    name: 'memoryFabric builds a tap for the submitting endpoint and supplies that same one',
    patterns: [/const\s+requestorGuard\s*=\s*new\s+EgressGuard\s*\(/, /\bguard\s*:\s*requestorGuard\b/],
    reason:
      'This rig has no FabricNode to inherit a guard from, so it constructs one over the identical ' +
      'Transport port rather than leaving the in-process ladder unrecorded. Its worker endpoints are ' +
      'deliberately built over a raw transport and carry no tap: under the amended criterion the ' +
      'submitting node’s manifest is what is promised, so an untapped worker endpoint here is the ' +
      'scope of the criterion rather than a hole in it. Both halves are required — a guard ' +
      'constructed and not passed records nothing.',
    satisfying:
      "  const requestorGuard = new EgressGuard(network.connect('requestor'), 'requestor')\n" +
      '    guard: requestorGuard,\n',
  },
  {
    name: 'the measured job path calls submitJobWithEgress with a guard array',
    patterns: [/\bsubmitJobWithEgress\s*\(/, /\[\s*fabric\.guard\s*\]/],
    reason:
      'Bare submitJob returns no manifests at all, so this one call is the driver’s entire egress ' +
      'leg. The guard array is what makes the manifest that comes back the submitting node’s own, ' +
      'rather than an argument nobody supplied.',
    satisfying: '    const result = await submitJobWithEgress(spec, fabric.blockstore, [fabric.guard])\n',
  },
  {
    name: 'the returned manifest is read, not merely requested',
    patterns: [/\bresult\.manifests\s*\[/, /\.entries\.length\b/, /\.totalBytes\b/],
    reason:
      'The half mutation 4 showed the type-checker catches only incidentally — it flagged the ' +
      'reverted call because this read was still there to fail on, and an edit removing both ' +
      'together would have passed the whole suite. A manifest requested and discarded is not a ' +
      'measurement, and these two figures are what the run prints.',
    satisfying:
      '      const manifest = result.manifests[0]\n' +
      '      egressEntries += manifest.entries.length\n' +
      '      egressBytes += manifest.totalBytes\n',
  },
]

/**
 * The names of the requirements `source` does not satisfy, in declaration order.
 *
 * A plain function over content, separated from the file read above so the planted
 * cases can prove it reports something. A scan that reports nothing against the
 * real file proves nothing until it has been watched reporting something.
 */
function unmetRequirements(source: string): string[] {
  const stripped = stripComments(source)
  return REQUIREMENTS.filter(({ patterns }) => !patterns.every((pattern) => pattern.test(stripped))).map(
    ({ name }) => name,
  )
}

/** Every fragment except `omit`, joined — a source satisfying three of the four. */
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

describe('bin/bench.ts still routes its jobs through the submitting node’s tap', () => {
  it('satisfies every call-site requirement in the real source', () => {
    // Anti-vacuity: a wrong path or an empty read would make "nothing unmet" mean
    // nothing. readFileSync would have thrown on a wrong path, but a truncated or
    // replaced file would not, and this is the reading the whole file rests on.
    expect(BENCH_SOURCE.length).toBeGreaterThan(5_000)
    expect(BENCH_SOURCE).toContain('async function memoryFabric')
    expect(BENCH_SOURCE).toContain('async function realFabric')

    expect(describeUnmet(unmetRequirements(BENCH_SOURCE))).toEqual([])
  })
})

describe('the scan can report an unmet requirement — proved by planting, not assumed', () => {
  for (const { name } of REQUIREMENTS) {
    it(`reports exactly "${name}" when only that call site is gone`, () => {
      // `toEqual` rather than `toContain` on purpose: it asserts the other three are
      // still satisfied by the same source, so one planted case doubles as the
      // control for the rest.
      expect(unmetRequirements(plantedSource(name))).toEqual([name])
    })
  }

  it('reports all four when every identifier appears only inside a comment', () => {
    // The defect this guard would otherwise have: bin/bench.ts names all four of
    // these in its own doc comments, so a raw-text match could be satisfied by the
    // prose describing a call site that had been deleted.
    const commentsOnly = [
      '// realFabric used to pass guard: requestor.egress in its returned object.',
      '/*',
      " * const requestorGuard = new EgressGuard(network.connect('requestor'), 'requestor')",
      ' * …and then guard: requestorGuard at the bottom of the literal.',
      ' */',
      '// The driver called await submitJobWithEgress(spec, store, [fabric.guard]).',
      '/* It read result.manifests[0], then .entries.length and .totalBytes off it. */',
      'const theCallSitesThemselvesAreGone = true',
    ].join('\n')

    expect(unmetRequirements(commentsOnly)).toEqual(REQUIREMENTS.map(({ name }) => name))
  })
})
