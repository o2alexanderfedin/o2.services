/**
 * What one run of the representative task costs a visitor's data allowance — BROW-10.
 *
 * ## Why this is a hand-written literal and not a computation
 *
 * The figure a visitor reads has to be **independently obtainable** from the figure a run
 * produces, or the guard comparing them proves nothing. This repository has twice had a plant
 * stay green because both sides of an assertion moved together, and the rule that came out of
 * it is written down in the project's own memory: *an assertion must not reuse the value it
 * tests*. So {@link DISCLOSED_DATA_COST_BYTES} is typed in by a person who read a measurement,
 * and `packages/node/src/colouring-demo.e2e.test.ts` compares it against a fresh run of the
 * same task. Neither is derived from the other, in source or in test.
 *
 * ## Where the number came from
 *
 * Three runs of `colouring-demo.e2e.test.ts`'s DEMO-01 case on 2026-09-02 — the two-tab
 * arrangement, `n = 204`, 8 cubes, redundancy 2, dispatched from one tab to one peer over a
 * loopback relay — reporting `run.egress.totalBytes`:
 *
 * | run | `egress.totalBytes` | `egress.entries` |
 * |-----|--------------------:|-----------------:|
 * | 1   | 11 387              | 22               |
 * | 2   | 10 971              | 18               |
 * | 3   | 11 387              | 22               |
 *
 * A spread of **416 bytes**, 3.8 % of the mean, and it is not noise in the measurement: the
 * entry count moved with it, so what varies is **how many frames left**, which follows how the
 * two tabs happened to dial each other. The literal is a round number inside that spread.
 *
 * ## What the figure covers, and what it deliberately does not
 *
 * `EgressManifest.totalBytes` is **egress only** — `packages/net/src/egress.ts:43-66` states
 * its contract exactly: *"What actually left, in bytes. A refused frame contributes zero,
 * because it did not leave — this figure means what it says, and a caller may treat it as the
 * node's real outbound volume."*
 *
 * A visitor on mobile data pays both directions, so the honest question is why the inbound leg
 * is not in the number. **Because nothing on this page measures it.** `TabActivity.fetched`
 * counts *blocks*, not bytes; the byte counters that exist are the hosted tier's
 * (`traffic-split.ts`), which measure what the object sees rather than what this tab receives.
 * Criterion 5 asks for a figure *"taken from a real run of that task rather than estimated"*,
 * so an inbound component nobody measured is a component that is excluded and **named as
 * excluded** — in {@link DATA_COST_COVERS} and in the disclosure sentence itself — rather than
 * guessed at and folded in.
 *
 * The WebAssembly module is **not** a separate inbound cost for this task and is deliberately
 * not listed as one. `demo/main.ts#runColouring` does `node.store.put(kernelBytes)` from a
 * constant compiled into the page bundle, so the artifact arrives with the page and not per
 * run. Counting its 1 200 bytes here would be double-counting a page load.
 *
 * ## Not in the barrel for its own sake
 *
 * `disclosure.ts` imports it and `disclosure.ts` is exported, so the figure reaches every
 * surface that renders the terms. The barrel entry exists for the guard in the `node` package,
 * which has to hold the disclosed literal beside a measured run — and these are constants
 * rather than callables, so they are not the shape `reachability-guard.node.test.ts` is looking
 * for.
 */

/**
 * The disclosed figure, in bytes, typed in by hand.
 *
 * Round, and inside the measured spread of 10 971–11 387. Round because it is a disclosure and
 * not a receipt: a visitor deciding whether to spend their allowance is served by *about
 * eleven kilobytes* and misled by a six-digit precision the next run would not reproduce.
 */
export const DISCLOSED_DATA_COST_BYTES = 11_000

/**
 * How far a measured run may drift from the disclosed figure before the guard reddens.
 *
 * A **factor**, applied both ways: a run must land between `DISCLOSED / 2` and `DISCLOSED × 2`.
 *
 * Justified against the spread rather than chosen: the three runs varied by 3.8 %, so this band
 * is about twenty-six times the observed variation. That margin is not generosity, it is what
 * the varying quantity requires — the frames that leave follow the peer count and the dialling,
 * and a band sited at the observed spread would go red the first time a third tab joined, which
 * is a fabric working rather than a figure going stale. A factor of two still catches the
 * failure this guard exists for: a workload whose outbound volume has doubled, which is what a
 * disclosed figure quietly becoming a lie looks like.
 */
export const DATA_COST_BAND = 2

/** Exactly which bytes are in the figure, and which are not. Written to be read aloud. */
export const DATA_COST_COVERS: string =
  'the bytes that leave the device during one run of the colouring search — every frame this ' +
  'node actually sent, refused frames excluded because they did not leave. It does NOT ' +
  'include what other participants send back, because nothing on this page measures that, and ' +
  'it does not include the page itself: the WebAssembly module arrives inside the page bundle ' +
  'rather than once per run.'

/** When the reading was taken and in what arrangement, so a later reader can repeat it. */
export const DATA_COST_MEASURED_ON: string =
  '2026-09-02, from three runs of colouring-demo.e2e.test.ts — two browser tabs on one machine, ' +
  'n = 204 over 8 cubes at redundancy 2, dispatched from one tab to one peer over a loopback ' +
  'relay. Readings: 11387, 10971 and 11387 bytes.'
