/**
 * The Benchmarks surface's formatter — UI-SPEC section 4.7, K1 and K2.
 *
 * # Everything below is a transcription. Nothing here is a reading.
 *
 * This is the one surface on the page that blocks nothing, reads nothing, and calls no
 * method on `window.o2`. Every figure it renders was measured in a Node process on one
 * machine on 2026-08-02 and committed to `docs/perf/prime-and-pi-benchmarks.md`; this file
 * copies them out of that document and adds nothing.
 *
 * **Transcribed, never derived.** The document already prints a `speedup` column and an
 * `efficiency` column, so nothing here divides anything. Where the document prints `3.64x`
 * this prints `3.64x`; where it prints `0.998` this prints `0.998`. That literalness is not
 * fussiness — it is what makes P9 in `packages/node/src/demo-bench.e2e.test.ts` checkable at
 * all. P9 reads the committed markdown and requires every figure string on this surface to
 * occur in it verbatim, so **a rounded figure is a figure that does not occur in the
 * document** and reddens exactly like an invented one. UI-SPEC section 4.7 names inventing a
 * number here as the defect this surface is most likely to introduce.
 *
 * ## There is no text view, and that is UI-SPEC's own list rather than an omission
 *
 * Section 2.2 enumerates six `<pre class="text-view">` elements — `#run-report`,
 * `#verify-report`, `#primes-report`, `#pi-report`, `#byo-report` and `#fabric-report` — and
 * this surface is not among them. The rule that produces those six is *one reading, one
 * render pass, both views*: a text view exists so that the rendered cards and the plain-text
 * rendering of the **same reading** cannot format one value two ways. Nothing on this
 * surface is a reading, so there is no second formatter to keep honest and there is nothing
 * for P6 to hold here.
 *
 * That is written down because an absent seventh `<pre>` otherwise looks like the thing
 * somebody forgot. {@link format} therefore returns a `SurfaceRender` whose `text` is
 * **empty**, and the page writes its regions with `writeReading` rather than `applyRender`,
 * because `applyRender`'s last parameter is a text-view id and this surface has none.
 *
 * ## Why the figures are rendered as monospace text rather than as a `<table>`
 *
 * The house pattern for a `cited` region on this page is the Primes surface's published
 * oracle (N10, Plan 27-06): a `<pre class="citation">` inside a `.scroller`, written by
 * `render.ts`'s `textContent` writer, with the provenance travelling **inside the same
 * region as the numbers** so a figure cannot be lifted out of the page without the statement
 * of where it came from. This surface follows it. A `<table>` would need markup assembled
 * per cell, and the one writer this page has assigns `textContent` and never `innerHTML` —
 * for the reason `render.ts`'s header gives at length.
 *
 * ## No DOM, no globals, one record
 *
 * Nothing here touches `document`, `window` or `window.o2`, and there is no `innerHTML`.
 * {@link format} takes nothing — the same signature `surfaces/primes.ts` has, and for a
 * related reason: there is no reading to pass it, and there never will be.
 */

import type { SurfaceRender } from '../render.ts'

/**
 * The path of the one document every figure on this surface comes from.
 *
 * Named once. It appears in three places on screen — both citation blocks and the
 * catalogue's `data-source` — and three hand-typed copies of a path are three things that
 * can drift apart from the file they name.
 */
export const SOURCE_DOCUMENT = 'docs/perf/prime-and-pi-benchmarks.md'

/**
 * UI-SPEC section 4.7 requirement 1, **verbatim**, and it sits at the top of the surface
 * rather than in a footnote.
 *
 * ## It does not match the document's own header sentence, and that is reported here
 *
 * The committed document opens:
 *
 * > Measured 2026-08-02 on one machine: 8 physical cores, Node 23.11, V8's built-in
 * > WebAssembly. Every number below was produced by a run recorded here; none is an
 * > estimate, and the ones that disagreed with what was predicted are marked as such.
 *
 * UI-SPEC's fixed copy keeps the first sentence almost exactly — a dash where the document
 * has a colon — and replaces the second, because *"none is an estimate"* is a claim about
 * the document and *"none of them is a reading from your tab"* is the claim a visitor needs.
 * The two disagree in wording; the disagreement is written down rather than reconciled
 * silently, because UI-SPEC section 11 fixes this string and a plan that quietly reworded it
 * would be editing the copywriting contract from inside a surface.
 *
 * Every figure in it — the date, the core count, the engine version — occurs in the
 * committed document, which is what keeps P9 whole over the provenance line as well as over
 * the tables.
 */
export const PROVENANCE: string =
  'Measured 2026-08-02 on one machine — 8 physical cores, Node 23.11, V8\'s built-in ' +
  'WebAssembly. Every figure on this screen comes from that recorded run. None of them is ' +
  'a reading from your tab.'

/**
 * The closing lines of every citation block on this surface — the N10 shape, one workload
 * over.
 *
 * The Primes surface's oracle says *"Published in the mathematical literature; not computed
 * here"*. These figures were not published by anybody else: they were measured by this
 * repository, elsewhere and at another time, so the first line says that instead. The last
 * line is the same sentence N10 ends on, and it is the one a reader who skims should land
 * on.
 */
function citation(section: string): string[] {
  return [
    '',
    'Measured in a run recorded elsewhere and at another time; not computed here.',
    `Source: ${SOURCE_DOCUMENT}, ${section}.`,
    'It was not this tab, and no part of this screen is a reading from this tab.',
  ]
}

/**
 * K1 — section 5 of the document, *Real parallel speedup*, both kernels at 1, 2, 4 and 8
 * processes.
 *
 * Eight rows and eight columns, transcribed cell for cell. `wall`, `sum guest` and
 * `straggler` are the document's own column names; `speedup` and `efficiency` are columns
 * the document already computed, and this file does not recompute them.
 */
export const SPEEDUP: readonly (readonly string[])[] = [
  ['primes', 'N = 3x10^8', '1', '2915.2', '2864.3', '2864.3', '1.00x', '100%'],
  ['primes', 'N = 3x10^8', '2', '1504.3', '2865.7', '1449.7', '1.94x', '97%'],
  ['primes', 'N = 3x10^8', '4', '861.7', '3138.9', '800.1', '3.38x', '85%'],
  ['primes', 'N = 3x10^8', '8', '800.0', '4889.5', '693.7', '3.64x', '46%'],
  ['pi', '1.5x10^9 terms', '1', '3510.0', '3459.4', '3459.4', '1.00x', '100%'],
  ['pi', '1.5x10^9 terms', '2', '1819.3', '3500.5', '1758.3', '1.93x', '96%'],
  ['pi', '1.5x10^9 terms', '4', '939.5', '3469.0', '874.0', '3.74x', '93%'],
  ['pi', '1.5x10^9 terms', '8', '904.6', '5938.4', '774.7', '3.88x', '49%'],
]

const SPEEDUP_HEADERS: readonly string[] = [
  'kernel',
  'domain',
  'processes',
  'wall [ms]',
  'sum guest [ms]',
  'straggler [ms]',
  'speedup',
  'efficiency',
]

/**
 * K2, first table — section 4 of the document, *Fabric overhead*, at redundancy 1 and 2.
 *
 * `tax` is the document's own dimensionless column, total divided by local. It is
 * transcribed and not recomputed here for the same reason `speedup` is.
 */
export const OVERHEAD: readonly (readonly string[])[] = [
  ['primes 10^6', '1', '1', '6.02', '6.65', '0.10', '6.77', '1.12x'],
  ['primes 10^6', '1', '2', '5.89', '11.95', '0.03', '12.00', '2.04x'],
  ['primes 10^6', '2', '1', '6.08', '6.48', '0.46', '6.93', '1.14x'],
  ['primes 10^6', '4', '1', '8.06', '8.04', '0.38', '8.57', '1.06x'],
  ['primes 10^6', '8', '1', '11.80', '8.53', '0.76', '9.69', '0.82x'],
  ['primes 10^6', '8', '2', '8.80', '16.14', '1.27', '17.30', '1.96x'],
  ['pi 10^6', '1', '1', '0.80', '0.90', '0.03', '0.93', '1.16x'],
  ['pi 10^6', '1', '2', '0.81', '1.70', '0.02', '1.71', '2.12x'],
  ['pi 10^6', '4', '1', '1.59', '1.85', '0.30', '2.12', '1.33x'],
  ['pi 10^6', '8', '2', '1.94', '3.15', '0.86', '4.00', '2.06x'],
]

const OVERHEAD_HEADERS: readonly string[] = [
  'workload',
  'shards',
  'redundancy',
  'local [ms]',
  'map [ms]',
  'reduce [ms]',
  'total [ms]',
  'tax',
]

/** K2, second table — section 2 of the document, *Decomposition cost*. */
export const DECOMPOSITION: readonly (readonly string[])[] = [
  ['primes', '1', '3.878', '3.888', '0.998'],
  ['primes', '2', '3.850', '3.888', '0.990'],
  ['primes', '4', '3.829', '3.888', '0.985'],
  ['primes', '8', '3.816', '3.888', '0.981'],
  ['primes', '16', '3.780', '3.888', '0.972'],
  ['pi', '8', '0.645', '0.644', '1.003'],
  ['pi', '16', '0.660', '0.644', '1.025'],
]

const DECOMPOSITION_HEADERS: readonly string[] = [
  'kernel',
  'shards',
  'sum [ms]',
  'one shard [ms]',
  'ratio',
]

/**
 * K2, third table — section 3 of the document, *Instantiate, cold*.
 *
 * UI-SPEC's K2 row asks for the p50 and the module size. The document also prints p90 and
 * p99 for both kernels; leaving them off is a transcription of fewer cells, never a
 * different figure, and it is the only place on this surface where a column of the source
 * table is not carried across.
 */
export const INSTANTIATE: readonly (readonly string[])[] = [
  ['primes', '0.060', '1187'],
  ['pi', '0.053', '549'],
]

const INSTANTIATE_HEADERS: readonly string[] = ['kernel', 'p50 [ms]', 'module [bytes]']

/**
 * A fixed-width text table: header row, then one line per row, columns padded to the widest
 * cell in the column and separated by two spaces.
 *
 * Two spaces rather than one, deliberately: P9 splits the rendered text into figure strings
 * on runs of digits, and columns that touch would join two figures into a third that occurs
 * in no document.
 */
function table(headers: readonly string[], rows: readonly (readonly string[])[]): string[] {
  const widths = headers.map((header, column) =>
    Math.max(header.length, ...rows.map((row) => (row[column] ?? '').length)),
  )
  const line = (cells: readonly string[]): string =>
    `  ${cells.map((cell, column) => cell.padEnd(widths[column] ?? 0)).join('  ')}`.trimEnd()
  return [line(headers), ...rows.map(line)]
}

/**
 * The whole Benchmarks surface — the provenance line and the two cited region groups, from
 * one pass.
 *
 * `text` is empty, and that emptiness is the surface's claim rather than an oversight: see
 * this file's header, and `demo-bench.e2e.test.ts`, which asserts the page carries no
 * seventh text view.
 */
export function format(): SurfaceRender {
  const regions: Record<string, string> = {}

  regions['bench/prose-provenance'] = PROVENANCE

  // ---- K1: section 5, real parallel speedup ----
  regions['bench/speedup'] = [
    'Real parallel speedup — separate operating-system processes, one per shard, each',
    'competing for a real core. Best of 3 runs.',
    '',
    ...table(SPEEDUP_HEADERS, SPEEDUP),
    ...citation('section 5'),
  ].join('\n')

  // ---- K2: sections 4, 2 and 3 — overhead, decomposition, cold instantiate ----
  regions['bench/overhead'] = [
    'Fabric overhead — map and reduce through the real request/response machinery,',
    'measured against a same-moment local reference. 9 repetitions, p50. The tax',
    'column is dimensionless — total divided by local.',
    '',
    ...table(OVERHEAD_HEADERS, OVERHEAD),
    '',
    'Decomposition cost — the same domain split N ways, with each shard\'s guest time',
    'summed. A ratio above 1.0 means the split duplicates work.',
    '',
    ...table(DECOMPOSITION_HEADERS, DECOMPOSITION),
    '',
    'Instantiate, cold.',
    '',
    ...table(INSTANTIATE_HEADERS, INSTANTIATE),
    ...citation('sections 2, 3 and 4'),
  ].join('\n')

  return { regions, text: [] }
}
