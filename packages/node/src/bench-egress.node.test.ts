import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { stripComments } from './strip-comments.ts'

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
 * **The limit worth naming, and the sentence that should not have been copied.** This
 * file's stripper was regex-based until 2026-08-04, so a comment opener inside a string
 * literal was treated as opening a comment. The limit was stated here together with a
 * defence — *the failure direction is the safe one: over-stripping can only report a
 * satisfied requirement as unmet, which fails loudly, never the reverse* — and that
 * defence is sound **here**, because every requirement below is a `patterns` conjunction
 * and therefore a presence check.
 *
 * It was then copied verbatim into four sibling guards where it is false, three of which
 * assert *absence* and so fail OPEN under over-stripping. A true sentence about this file
 * became a false one about `trust-anchors`, `requirements-ledger` and
 * `sovereign-block-refusal` by being carried across with the code. {@link stripComments}
 * is now shared, and `strip-comments.node.test.ts` measures it against what it replaced.
 */

const BENCH = 'packages/node/src/bin/bench.ts'

/**
 * Read once at module scope, the way `vocabulary.node.test.ts` computes `REPO`
 * once. The two functions below are plain functions over a string and never touch
 * the filesystem, which is what lets the planted cases feed them synthetic sources.
 */
const BENCH_SOURCE: string = readFileSync(fileURLToPath(new URL('./bin/bench.ts', import.meta.url)), 'utf8')

// Stripping is not decoration — it is the whole reason this guard is worth having.
// `bin/bench.ts` *names* every identifier below in its own prose: the doc comment on
// `Fabric.guard`, the paragraph explaining why `memoryFabric` builds its own tap, and
// `runnerFor`'s doc naming `submitJobWithEgress` against "the bare `submitJob` this driver
// used to call". Match the raw text and a reader could delete all four call sites, leave
// the comments describing them, and keep this file green — a guard satisfied by a
// description of the thing it guards.
//
// `stripComments` is the shared tokenizer. Of the five guards that carried the regex it
// replaced, this one is the only one whose "the failure direction is the safe one" claim
// held: every requirement here is a `patterns` conjunction, i.e. a presence check, so
// over-stripping reports a satisfied requirement as unmet and fails loudly. The claim was
// copied verbatim into four siblings where it was false — see `strip-comments.ts`.

interface CallSiteRequirement {
  /**
   * Named so whoever broke one knows which call site to open without reading this
   * file first.
   */
  readonly name: string
  /**
   * Every pattern must match for the requirement to be satisfied. Plural because
   * several of these are conjunctions in the source — a value constructed *and*
   * passed, a manifest indexed *and* read, a limit declared *and* passed *and*
   * printed — and a requirement met by half of itself is the shape mutation 4
   * already walked through once.
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
  {
    name: 'the run declares one admission limit to both rigs and prints it in the report',
    patterns: [
      /const\s+DECLARED_ADMISSION_LIMIT\s*=\s*\d+/,
      /maxConcurrentTasks\s*:\s*DECLARED_ADMISSION_LIMIT/,
      /\bmaxConcurrent\s*:\s*DECLARED_ADMISSION_LIMIT/,
      /Declared run configuration/,
      /\$\{SHARDS\}/,
      /\$\{DECLARED_ADMISSION_LIMIT\}/,
    ],
    reason:
      'SCHED-06 gave FabricNode an admission limit and submitJob has no re-pick, so a limit below ' +
      'what this workload puts on one node turns refusals into failed runs — a published curve ' +
      'silently shaped by a limit nobody wrote down. Four halves are required and each fails ' +
      'differently: the constant declares the value, the FabricNode.start sites make it true of the ' +
      'real-transport rig, the LocalCapacity constructions make it true of the memory-transport rig ' +
      '— without which the two published curves are measured under different node behaviour, one ' +
      'admitting and one not — and the report line is the only one of the four a reader of ' +
      '.planning/BENCHMARK-RESULTS.md can see. Deleting the line leaves the source correct and the ' +
      'published table silent about what it was measured under, which is the gap this requirement ' +
      'exists to close.',
    satisfying:
      'const DECLARED_ADMISSION_LIMIT = 64\n' +
      '        maxConcurrentTasks: DECLARED_ADMISSION_LIMIT,\n' +
      '      maxConcurrent: DECLARED_ADMISSION_LIMIT,\n' +
      '    `- Declared run configuration: **${SHARDS} shards** per job, and every node in both rigs' +
      ' admitting at **${DECLARED_ADMISSION_LIMIT}**`,\n',
  },
  {
    name: 'the benchmark holds its own signing key and signs a record per rig',
    patterns: [/const\s+BENCH_SIGNING_SEED\s*=\s*new\s+Uint8Array\(32\)\.fill\(/, /\bsignName\s*\(/],
    reason:
      'DET-03 put a signature check on every production dispatch, so a rig that dispatches without ' +
      'a record measures the path this fabric had before the phase while claiming to measure the one ' +
      'it has now — and the published figures would exclude a per-dispatch cost every real node pays. ' +
      'Both halves are required: a key declared and never used signs nothing, and a signName call with ' +
      'no constant seed makes the run irreproducible.',
    satisfying:
      'const BENCH_SIGNING_SEED = new Uint8Array(32).fill(0x2b)\n' +
      '  const moduleRecord = signName(BENCH_SIGNING_SEED, { name: BENCH_MODULE_NAME, cid: moduleCid })\n',
  },
  {
    name: 'every rig wraps its executor and every rig’s spec carries the record',
    patterns: [
      /\bguardModuleProvenance\s*\(/,
      /new\s+SignedNameResolver\s*\(/,
      /\bmoduleRecord\s*:/,
      /\btrustAnchors\s*:\s*\[/,
    ],
    reason:
      'A guard constructed and not passed, or a record signed and not attached, is the half-satisfied ' +
      'shape mutation 4 in this file already walked through once — it type-checks, it runs, and it ' +
      'measures the wrong thing silently. Four halves, one per leg: guardModuleProvenance and ' +
      'SignedNameResolver are how memoryFabric and wasmInProcess wrap their raw WasmExecutors, ' +
      'trustAnchors is how realFabric asks FabricNode.start for the same guard, and moduleRecord is ' +
      'what makes the dispatched task satisfiable by any of them. Drop the last and every rig refuses ' +
      'every shard; drop any of the first three and that rig alone is measuring the pre-phase path.',
    satisfying:
      '  const provenance = (inner: Executor, anchor: string): Executor =>\n' +
      '    guardModuleProvenance(inner, { resolver: new SignedNameResolver([anchor]), now: () => Date.now() })\n' +
      '        trustAnchors: [BENCH_TRUST_ANCHOR],\n' +
      '        moduleRecord: fabric.moduleRecord,\n',
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
      // `toEqual` rather than `toContain` on purpose: it asserts the other five are
      // still satisfied by the same source, so one planted case doubles as the
      // control for the rest.
      //
      // Exactly one fragment is omitted per case, so what this buys is each entry
      // shown reported unmet **on its own**. There is deliberately no source omitting
      // two at once: the one-at-a-time reading is the stronger one, because `toEqual`
      // makes every other entry the control for the omitted one.
      expect(unmetRequirements(plantedSource(name))).toEqual([name])
    })
  }

  it('reports every requirement when every identifier appears only inside a comment', () => {
    // The defect this guard would otherwise have: bin/bench.ts names all of these in
    // its own doc comments, so a raw-text match could be satisfied by the prose
    // describing a call site that had been deleted.
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
