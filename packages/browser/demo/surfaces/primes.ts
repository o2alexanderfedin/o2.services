/**
 * The Primes surface's formatter — UI-SPEC section 4.3, N1 through N12.
 *
 * # This is **Option A**, taken 2026-08-17, and it closes audit finding G4
 *
 * This file used to open with the opposite paragraph. UI-SPEC section 10 offered two
 * dispositions and Phase 27 shipped the smaller one — *ship the absence*: no run control, every
 * reading permanently at its `unavailable` sentence, and the reason stated on screen. That was
 * honest and it was not done, and the header said so in those words.
 *
 * The three facts it rested on have each been answered:
 *
 * 1. **A signed record now vouches for the prime-counting module.** `PRIMES_RECORD` in
 *    `packages/demo/src/kernel-record.ts`, signed by `KERNEL_TRUST_ANCHOR` alongside the
 *    colouring and π records. All three were re-signed together under a new anchor, because
 *    `sign-kernel.ts` discards its private half the moment it signs and the old records could
 *    not be extended.
 * 2. **The input is carried by a method built for it.** `TabApi.runPrimes` builds the eight-byte
 *    block with `buildPrimesInput(n)` and projects with `projectPrimeCount`. `runJob`'s
 *    `{ value: { a: i } }` shards were never going to carry it, and it was not asked to.
 * 3. **The trust-root change was made deliberately and is recorded.** Both node binaries default
 *    to `KERNEL_TRUST_ANCHOR`, so regenerating changed what a stock `o2 agent` and a stock
 *    `o2 seed` will run. That is the cost, it was paid once, and all three records were
 *    committed in the same change.
 *
 * ## Why this surface was worth the trust-root change
 *
 * Every other check on this page is written by the same hand as the thing it checks.
 * `verifyColouring` re-derives the triples from the definition, which is a strong check — but a
 * misconception held in both the fabric and its verifier is invisible to the pair. π(x) was
 * tabulated in the mathematical literature long before this repository existed. It is the one
 * oracle on the page whose authority does not come from here, and until now it had nothing to
 * check.
 *
 * **Its blind spot travels with it**, in {@link STATED_WEAKNESS}, on screen. Published values are
 * quoted at powers of ten, and a power of ten sits far from the prime below it — so a guest that
 * silently lost the top of its range would return the right total anyway. What closes that is
 * `packages/node/src/primes-reduce.node.test.ts`, which tiles `[2, N]` at every shard count from
 * one to eight and requires the per-shard counts to sum to the published value each time. This
 * surface does not re-derive that and must not be described as if it did.
 *
 * ## What did NOT change, and it is the interesting one
 *
 * `primes/per-shard` (N9) is still a permanent absence. The mockup drew a table of per-shard
 * counts and {@link import('../../src/tab-api.ts').TabPrimesRun} carries the total and not the
 * shard rows — which is still true now that a run really happens. It states the field it would
 * need rather than being filled with plausible rows. Wiring the workload did not turn every
 * absence on this surface into a reading, and pretending otherwise would have been the easy
 * mistake.
 *
 * ## No DOM, no globals, one record
 *
 * {@link format} takes a {@link PrimesState} and returns a {@link SurfaceRender}: already-formatted
 * strings for all twelve regions, and the lines of `#primes-report`. Both come out of one pass,
 * so the rendered cards and the text view cannot format one value two ways — UI-SPEC section
 * 2.2's rule, which P6 in `packages/node/src/demo-region-properties.ts` holds against a real
 * page. Nothing here touches `document`, `window` or `window.o2`, and there is no `innerHTML`.
 */

import { PRIME_MAX_N } from '@o2/demo'
import { REGIONS } from '../../src/demo-regions.ts'
import type { Region } from '../../src/demo-regions.ts'
import type { TabPrimesRun } from '../../src/tab-api.ts'
import { attestationLines, egressLines } from '../render.ts'
import type { SurfaceRender } from '../render.ts'

/**
 * UI-SPEC section 4.3's surface-level copy, **verbatim**, rendered once as a panel above the
 * cards.
 *
 * **Rewritten 2026-08-17.** This constant was `NO_DISPATCH_PATH` and it said this workload had
 * no dispatch path from a browser tab. That statement became false the day `PRIMES_RECORD` was
 * signed, and a page that kept it would have been claiming an absence it no longer had — the
 * exact failure this surface's own header warned about in the other direction.
 *
 * Held here rather than as static prose in `index.html` for the reason Plan 27-05 removed the
 * lone-tab card's static copy: a sentence a spec asserts must have one author, and a sentence
 * typed into the markup and typed again into a spec is two sentences that can drift. The page
 * writes this constant into the panel by `textContent`; `demo-primes.e2e.test.ts` compares the
 * screen against this same export.
 */
export const DISPATCH_INTENT: string =
  'This workload counts the primes at or below a bound, split across every device this tab ' +
  'can see, and merged with the same verified tree-reduce the π series uses. Its answer is an ' +
  'integer with a published value, so the check below is an equality and not a tolerance — ' +
  'and the value it is checked against was tabulated in the mathematical literature long ' +
  'before this repository existed.'

/**
 * The mockup's stated-weakness panel, **verbatim**, and it matters more here than anywhere.
 *
 * The oracle is the one check on this page whose authority does not come from this repository,
 * and this paragraph is the statement of where that authority runs out. **It is unchanged by
 * Option A**, and that is the point: wiring the workload gave the oracle something to check and
 * did nothing whatever about the direction in which it is blind.
 *
 * Prose, not a figure region — UI-SPEC section 4.3 says so explicitly, and the catalogue's
 * tally of twelve depends on it staying prose.
 */
export const STATED_WEAKNESS: string =
  'The oracle is blind in one direction. Published π values are quoted at powers of ten, and ' +
  'a power of ten sits far from the prime below it, so a guest that loses the top of its ' +
  'range returns the right total anyway. That hole is what the π series closes.'

/**
 * The published prime-counting function at four powers of ten — N10.
 *
 * **`cited`, and never a reading.** These are values published in the mathematical literature
 * long before this repository existed; that is exactly why the surface exists, since a
 * verifier sharing an author with the fabric cannot catch a misconception held in both. The
 * provenance travels in the same region as the numbers, so a figure cannot be separated from
 * the statement of where it came from.
 *
 * Written as `[exponent, count]` and the label composed, rather than as a hand-typed
 * `'10⁴'`: the superscript block is what `DIGIT` in `../../src/demo-regions.ts` had to be
 * widened for, and one table with the exponent typed twice is a table that can disagree with
 * itself about which x a count belongs to.
 */
export const ORACLE: readonly (readonly [exponent: number, count: number])[] = [
  [4, 1229],
  [5, 9592],
  [6, 78498],
  [7, 664579],
]

/**
 * The bound the page sends — **fixed, and deliberately not scaled by the peer count.**
 *
 * This is the one place the Primes surface parts company with the π surface next to it, and the
 * reason is the oracle. π's term count rises with the devices available, because more terms is a
 * tighter remainder bound and the claim gets stronger. π(x) has no such dial: the published
 * table has values *at powers of ten*, so moving the bound off one leaves the comparison with
 * nothing to compare against. A second device therefore makes this run shorter and does not make
 * its claim stronger, which the surface says in its own words rather than leaving to be noticed.
 *
 * **10⁵ rather than 10⁶, and the reason is the visitor rather than the mathematics.** Both are
 * published; `primes-reduce.node.test.ts` agrees with the table at 10⁴, 10⁵ *and* 10⁶ over eight
 * shards. A lone tab is the first state anybody sees this page in, and it executes every shard
 * itself — so the bound that decides whether a first run feels interactive is the bound a lone
 * tab must sieve. The larger claim is made in the Node suite, where nobody is waiting.
 */
export const PRIMES_N: number = 100_000

/**
 * The shard count the page will send. N2 displays this; the dispatch calls the same function.
 *
 * `4 x (1 + peers)`, the π surface's rule imported in spirit rather than in code — the two
 * surfaces sizing their shard counts by one expression would couple two workloads that have
 * different reasons for it. Here the effect is to split one fixed range more finely as devices
 * arrive.
 */
export function shardsFor(peers: number): number {
  return 4 * (1 + peers)
}

/** U+2070..U+2079, indexed by digit. The only way this file produces a superscript. */
const SUPERSCRIPTS = '⁰¹²³⁴⁵⁶⁷⁸⁹'

/** `4` -> `10⁴`. Composed from {@link SUPERSCRIPTS} so no exponent is typed as a glyph. */
function powerOfTen(exponent: number): string {
  const digits = String(exponent)
    .split('')
    .map((digit) => SUPERSCRIPTS[Number(digit)] ?? digit)
    .join('')
  return `10${digits}`
}

/**
 * The published count for a bound, or `null` if the table has no value at it.
 *
 * **`null` is a real answer and not a failure**, and it is what keeps N11 honest: a bound off a
 * power of ten has no published value, so the only truthful comparison is that there is none.
 * Returning a nearest-neighbour or an interpolation would manufacture an oracle, which is the
 * one thing this surface exists not to do.
 */
function publishedCountFor(n: number): number | null {
  for (const [exponent, count] of ORACLE) {
    if (n === 10 ** exponent) return count
  }
  return null
}

/**
 * Where the oracle's counts were checked against this repository's own kernel.
 *
 * **Amended 2026-08-17.** This block used to end by saying that no part of the screen was a
 * reading from the visitor's tab, which was true under Option B and is false now. The Node
 * measurement is still named, because it covers bounds this page does not send — the point of
 * naming a document is that a claim stays checkable, and the page's own run covers one row of
 * this table rather than all four.
 */
const ORACLE_PROVENANCE: readonly string[] = [
  'Published in the mathematical literature; not computed here.',
  '',
  'The prime-counting module in this repository was measured against all four of these ' +
    'values and matched every one — recorded in docs/perf/prime-and-pi-benchmarks.md, ' +
    'under guest throughput. That was a Node process on one machine. This page sends one of ' +
    'these four bounds and compares its own count against that row; the other three are ' +
    'quoted from the same table and were not run here.',
]

const CATALOGUE: ReadonlyMap<string, Region> = new Map(REGIONS.map((region) => [region.id, region]))

/**
 * The catalogue's sentence for a region in one of its three states.
 *
 * Read from `../../src/demo-regions.ts` and never written here — the same rule `surfaces/pi.ts`
 * follows. A missing arm throws rather than falling back; a fallback is how a region comes to
 * render a sentence nobody wrote.
 */
function absent(id: string, state: 'initial' | 'stopped' | 'unavailable'): string {
  const region = CATALOGUE.get(id)
  if (region?.absence === undefined) {
    throw new Error(`primes: "${id}" holds no absence arms in the catalogue`)
  }
  const sentence =
    state === 'initial'
      ? region.absence.initial
      : state === 'stopped'
        ? region.absence.stopped
        : region.absence.unavailable
  if (sentence === undefined) throw new Error(`primes: "${id}" has no ${state} arm in the catalogue`)
  return sentence
}

/**
 * Every primes reading, derived from the catalogue and never listed.
 *
 * Exported so the page can paint them all on a stop or a throw, and so a spec can assert against
 * the same derivation the formatter uses. Deriving rather than listing is what makes a
 * thirteenth region — should UI-SPEC ever grow one — an automatic member rather than something a
 * reader has to notice.
 */
export const PRIMES_READING_IDS: readonly string[] = REGIONS.filter(
  (region) => region.surface === 'primes' && region.kind === 'reading',
).map((region) => region.id)

/** The oracle table as text: a header row, then one row per published value. */
function oracleTable(): string[] {
  const rows = ORACLE.map(([exponent, count]) => `  ${powerOfTen(exponent).padEnd(6)} ${count}`)
  return ['  x      the count of primes below x', ...rows]
}

/**
 * N1 and N2 — the arguments the page *will* send, on screen before anything is dispatched.
 *
 * `control` regions rather than readings: nothing has been asked of the fabric yet, so there is
 * nothing to read. Until 2026-08-17 both carried `ARG_NOT_DISPATCHED` permanently, because
 * nothing would ever overwrite them.
 */
export function formatArgs(peers: number): Readonly<Record<string, string>> {
  return {
    'primes/n-arg': String(PRIMES_N),
    'primes/shards-arg': String(shardsFor(peers)),
  }
}

/**
 * N10 and N12 — the two regions that are on screen whatever has or has not been run.
 *
 * **Split out of {@link format} on 2026-08-17, and the spec is what found the need.** Under
 * Option B this file's `format()` took no argument and the page called it once at boot, so every
 * region including these two was painted before anything happened. Option A made `format()` take
 * a run — and the published oracle, which is the whole reason this surface exists, would then
 * have appeared only *after* a visitor pressed the button. A citation that shows up once you have
 * an answer to compare it against is not a check, it is a confirmation.
 *
 * Neither is a reading: N10 is `cited` and N12 is `constant`, and `paintSurfaceAbsence` skips
 * both kinds by design, so nothing else would have written them. This is the same treatment
 * `formatByoConstants` gets on the bring-your-own surface.
 */
export function formatConstants(): Readonly<Record<string, string>> {
  const table = oracleTable()
  return {
    'primes/oracle-table': [...table, '', ...ORACLE_PROVENANCE].join('\n').trim(),
    // Imported, never transcribed. UI-SPEC's N12 row names `@o2/demo.PRIME_MAX_N`, and the
    // symbol travels beside the value so a reader can check the claim without reading this file.
    'primes/max-n': `${PRIME_MAX_N} — @o2/demo.PRIME_MAX_N`,
  }
}

/** Everything the two views are written from. No DOM, no node, no `window.o2`. */
export interface PrimesState {
  /** `computePeers().length` at dispatch — what N2 is derived from. */
  readonly peers: number
  readonly run: TabPrimesRun
}

/**
 * The whole Primes surface, from one run — all twelve regions and the text view.
 *
 * Every one of the twelve is in the returned record in every arm, so no region can keep a value
 * from a previous run: a reading with nothing to show carries a named absence, and a stale
 * reading is a placeholder that used to be true.
 */
export function format(state: PrimesState): SurfaceRender {
  const { run } = state
  const regions: Record<string, string> = { ...formatArgs(state.peers), ...formatConstants() }

  // ---- N3, N4, N6: the map half, which even a lone tab really did do ----
  //
  // The count is `null` whenever no aggregate was produced, and the flags beside it say which
  // case it was — so the absence is named from the catalogue rather than shown as a zero.
  regions['primes/total'] =
    run.total === null ? absent('primes/total', 'unavailable') : String(run.total)
  regions['primes/complete'] = String(run.complete)
  regions['primes/elapsed'] = `${Math.round(run.elapsedMs)}ms`

  // ---- N5: the reduce, in the fabric's own words when it did not happen ----
  //
  // `reduceReason` verbatim, never paraphrased. A lone tab's `no executor to combine on` is the
  // ordinary first state of this page, and it is a statement about how many devices are here
  // rather than about anything failing.
  regions['primes/reduce-state'] = run.combined
    ? 'an aggregate was produced'
    : run.reduceAttempted
      ? 'a reduce ran and produced no aggregate'
      : `not attempted: ${run.reduceReason ?? 'no reason given'}`

  // ---- N7: the receipt, composed by the kernel and rendered verbatim ----
  regions['primes/attestation'] = attestationLines(run.attestation).join('\n')

  // ---- N8: what left this device for this job ----
  regions['primes/egress'] = egressLines(run.egress).join('\n')

  // ---- N9: still a permanent absence, and that is not an oversight ----
  //
  // `TabPrimesRun` carries the total and not the shard rows, which is as true after Option A as
  // before it. The catalogue's `permanentlyUnavailable` arm still holds, and the sentence comes
  // from there rather than from here.
  regions['primes/per-shard'] = absent('primes/per-shard', 'unavailable')

  // ---- N10 and N12 are already in `regions` — see `formatConstants` for why they are
  //      written at boot as well as here.
  const table = oracleTable()

  // ---- N11: the comparison this surface exists for ----
  //
  // An **equality**, printed with both operands, so a reader checks the claim rather than
  // trusting a verdict word. The two `null` arms are different facts and are worded apart: no
  // count to compare, versus a count at a bound the published table has no value at.
  const published = publishedCountFor(run.n)
  regions['primes/oracle-compare'] =
    run.total === null
      ? absent('primes/oracle-compare', 'unavailable')
      : published === null
        ? `this tab counted ${run.total} primes below ${run.n}; the published table quotes ` +
          'values at powers of ten only, and has none at this bound'
        : run.total === published
          ? `agrees: this tab counted ${run.total} primes below ${run.n}, and the published ` +
            `value is ${published}`
          : `DISAGREES: this tab counted ${run.total} primes below ${run.n}, and the published ` +
            `value is ${published}`

  // ---- the text view, from the same record ----
  const text: string[] = [
    DISPATCH_INTENT,
    '',
    'What this page sent:',
    `  N       ${regions['primes/n-arg'] ?? ''}`,
    `  shards  ${regions['primes/shards-arg'] ?? ''}`,
    '',
    'What this tab read:',
    ...PRIMES_READING_IDS.map((id) => `  ${id}: ${regions[id] ?? ''}`),
    '',
    'The published oracle this surface exists to be checked against:',
    ...table,
    '',
    ...ORACLE_PROVENANCE,
    '',
    `Largest bound the shipped module accepts: ${regions['primes/max-n'] ?? ''}`,
    '',
    STATED_WEAKNESS,
  ]

  return { regions, text }
}
