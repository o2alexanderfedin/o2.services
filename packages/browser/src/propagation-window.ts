/**
 * How long a halt takes to reach the last tab — RUN-02 criterion 3.
 *
 * ## Why this is a hand-written literal and not a computation
 *
 * `data-cost.ts`'s rule, followed exactly. The figure a volunteer reads has to be
 * **independently obtainable** from the figure a run produces, or the guard comparing them
 * proves nothing. This repository has twice had a plant stay green because both sides of an
 * assertion moved together, and the rule that came out of it is in the project's own memory:
 * *an assertion must not reuse the value it tests*. So {@link PROPAGATION_WINDOW_MS} is typed
 * in by a person who read a measurement, and
 * `packages/node/src/kill-switch-propagation.e2e.test.ts` compares it against a fresh reading.
 * Neither is derived from the other, in source or in test.
 *
 * ## Where the number came from
 *
 * Three runs of `kill-switch-propagation.e2e.test.ts` on 2026-09-02, on a host the suite's own
 * banner reported quiet (load/core 0.61, 0.63 and 0.66 at the start of each), each run at
 * `real 41.76 / 42.55 / 41.65` seconds against `user 16.40 / 16.57 / 16.74` and
 * `sys 4.71 / 4.84 / 4.70` — a `(user+sys)/real` of about **0.50**, which is what a spec that
 * spends most of its time waiting on a timer should look like.
 *
 * Six tabs, one local `workerd`, one flip per arm, every observation taken inside its own page:
 *
 * | run | window at 2 000 ms | ratio | window at 30 000 ms | ratio |
 * |-----|-------------------:|------:|--------------------:|------:|
 * | 1   | 1 874              | 0.937 | 29 869              | 0.996 |
 * | 2   | 1 859              | 0.929 | 29 884              | 0.996 |
 * | 3   | 1 874              | 0.937 | 29 891              | 0.996 |
 *
 * A **fourth** run, the first taken with the literal below already in place, read **29 828 ms**
 * — 52 ms from the published figure, against a band of 1 500. It is recorded here rather than
 * folded into the table because it is the guard's own reading rather than one of the three the
 * figure was sited against, and the difference matters: the three chose the number, the fourth
 * checked it.
 *
 * Per-tab elapsed times on run 1, which is what the maximum is a maximum *of*:
 * at 2 000 ms — `1604, 83, 528, 973, 1470, 1874`;
 * at 30 000 ms — `27640, 28071, 28540, 28974, 29415, 29869`.
 *
 * ## What the two arms say, which is the reason there are two
 *
 * The raw window moved by very nearly the interval's own factor — 1 874 → 29 869, a factor of
 * **15.9** against the interval's 15 — while the ratio stayed at or under 1 in both. **So the
 * window's dominant term is the poll interval and nothing else contributes materially.** One
 * arm could not have said that: a single number is a number with no way to tell what it is a
 * number about.
 *
 * The per-tab spread is the tabs' poll *phases*, not jitter. Six tabs start in sequence about
 * 450 ms apart, so their polls are spread across the interval and the maximum belongs to
 * whichever tab polled most recently before the flip.
 *
 * ## What the figure covers, and what it deliberately does not
 *
 * See {@link PROPAGATION_COVERS}. In short: **this is a Durable-Object-storage poll on one
 * machine, and it is not a measurement of Workers KV** — the mechanism open question 2 is
 * framed in terms of. That question remains open and this number does not settle it.
 */

/**
 * The published window, in milliseconds, typed in by hand.
 *
 * Inside the measured spread of 29 869–29 891 at the production poll interval. Not rounded to
 * a coarser figure the way `DISCLOSED_DATA_COST_BYTES` is, because this number's whole
 * interest is how close it sits to the interval beside it: *29 880 against a 30 000 ms poll*
 * says the thing a reader needs, and *about thirty seconds* says almost nothing.
 */
export const PROPAGATION_WINDOW_MS = 29_880

/**
 * How far a measured run may drift from the published figure before the guard reddens.
 *
 * Milliseconds, applied both ways, and **justified against the observed spread rather than
 * chosen**: three runs varied by **22 ms**, so this band is about seventy times the observed
 * variation. That margin is not generosity — it is what the varying quantity requires, and the
 * quantity is not what the small spread makes it look like.
 *
 * The spread is small for a *structural* reason. The harness waits until every tab has
 * completed at least one poll and then writes immediately, so the flip always lands just after
 * the last tab's poll and that tab always waits very nearly a whole interval. What can
 * actually move is the delay between that readiness check and the write — scheduling on the
 * host, not anything about the fabric — and on a loaded machine that is worth hundreds of
 * milliseconds. A band sited at 22 ms would redden on a busy afternoon, which is a host
 * working rather than a figure going stale.
 *
 * ±1 500 ms is 5 % of the interval, and it still catches what this guard exists for: a window
 * that has stopped tracking the poll — because the interval moved, because a second mechanism
 * arrived, or because the poll stopped happening — is wrong by seconds or by the whole
 * interval, not by 5 %.
 */
export const PROPAGATION_BAND = 1_500

/** How many tabs the maximum was taken over. A window over one tab is not a population. */
export const PROPAGATION_POPULATION = 6

/** The poll interval the published window was measured at. */
export const PROPAGATION_INTERVAL_MS = 30_000

/** When the reading was taken and in what arrangement, so a later reader can repeat it. */
export const PROPAGATION_MEASURED_ON: string =
  '2026-09-02, from three runs of kill-switch-propagation.e2e.test.ts — six browser tabs and ' +
  'one local workerd on one machine, each tab recording in its own page the moment it first ' +
  'saw the halt. Windows at the 30 000 ms poll: 29869, 29884 and 29891 ms; at a 2 000 ms poll ' +
  'for comparison: 1874, 1859 and 1874 ms.'

/**
 * Exactly what this number is a measurement of, and what it is not. Written to be read aloud.
 *
 * The KV sentence is here rather than in a planning document because this string is what a
 * volunteer reads on the status page, and a propagation figure quoted without its mechanism is
 * how a number about one thing becomes an answer about another.
 */
export const PROPAGATION_COVERS: string =
  'the time from an operator’s write returning to the LAST of six tabs noticing it, on one ' +
  'machine, with every tab polling a Durable Object every thirty seconds. It is a measurement ' +
  'of what a poll costs. It is NOT a measurement of Workers KV, whose roughly sixty-second ' +
  'global propagation is the mechanism the open question about this control is actually ' +
  'framed in terms of, and which this project has not measured. It carries no network term, ' +
  'because there is no network between these tabs and this object. And six tabs on one ' +
  'machine is not a cohort: what a control does at six is not what it does at three hundred, ' +
  'and nobody here has measured the second thing.'
