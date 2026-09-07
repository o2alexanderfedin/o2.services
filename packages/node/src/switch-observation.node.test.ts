/**
 * `RUN-07` Phase 39 criterion 5 — the instrument that watches the kill switch flip **during**
 * a run, and the proof that it can see the transition rather than merely print one.
 *
 * ## What the criterion asks for and what an agent may build
 *
 * *"The kill switch and the stop control are exercised during the run and not only before it,
 * and the observed behaviour matches what Phase 36 measured on a quiet fabric — a control that
 * works at three tabs and not at three hundred is a control nobody has."*
 *
 * The flip itself is an operator-key write to the production object, so it is the owner's act
 * and it is scripted in `.planning/phases/phase-39-the-public-run/39-KILL-SWITCH-DURING-RUN.md`.
 * What is built here is the **instrument**: a read-only sampler over `GET /self` and the status
 * page, whose functions live in `tools/run/switch-observation.mjs` and are exercised below.
 *
 * ## The two measurement planes, because conflating them would make every number here a lie
 *
 * Phase 36's published `PROPAGATION_WINDOW_MS = 29_880` is a **tab-side** figure: the maximum
 * over six browser tabs of the delay between the write returning and that tab's own poll
 * noticing, at a 30 000 ms poll. It is recorded inside each page.
 *
 * This sampler reads `/self`, which is the **object's own state**, and that state changes at the
 * write. So the sampler's observed window is bounded by the sampler's own interval by
 * construction — two consecutive samples straddling the flip — and it can never reproduce
 * 29 880 ms. **The two are comparable only as ratios to the interval each was taken at**, which
 * is exactly what `propagation-window.ts` found when it took the same window at 2 000 ms and at
 * 30 000 ms and got 0.937 and 0.996: *"the window's dominant term is the poll interval and
 * nothing else contributes materially."*
 *
 * `withinBaseline` therefore reports `comparable` beside `within`: the millisecond band is a
 * statement about a series taken at the production poll interval, and applying it to a series
 * taken at any other interval compares two different quantities.
 *
 * ## The local `workerd` arm is the case that makes this an instrument
 *
 * Without it `tools/run/switch-observation.mjs` is a pretty printer over data nobody proved it
 * can obtain. The arm flips a **local** object false -> true -> false, samples throughout with
 * the exported functions and nothing hand-rolled, and asserts a finite window. The pre-flip
 * samples are the positive control: an "it saw the halt" that cannot also show the un-halted
 * state is an instrument that answers halted to everything.
 *
 * ## The second arm is a finding, not a formality
 *
 * `refuseMisaddressed` refuses **every** write to an object whose own region is `null`, and
 * `worker.ts` calls it unconditionally before writing. The deployed object's `/self` — read
 * live 2026-09-04 and quoted in this plan — reports `"region":null`. So the second arm boots a
 * local object with **no** `O2_REGION`, which is the deployed object's own reported shape, and
 * watches a correctly-keyed halt refused **409**. See the document for what the owner does
 * about it.
 *
 * ## The scope fence
 *
 * Nothing here contacts any deployed origin. Two local `wrangler dev` children, each with its
 * own port and its own `mkdtempSync` persist directory — `relay-service-journal.e2e.test.ts`
 * records two e2e files reddening each other over a shared `<cwd>/.wrangler/state`, so this is
 * mandatory rather than tidy. `CLOUDFLARE_API_TOKEN` is blanked so a path reaching for
 * Cloudflare fails here rather than quietly succeeding, and `ANNOUNCE_MULTIADDRS` is overridden
 * to loopback because `wrangler.jsonc` announces the deployed host and a local relay left at
 * that value hands its clients an address pointing at production.
 *
 * **Zero relay reservations and zero deployed requests.** This file opens no libp2p connection
 * at all; it speaks HTTP to two loopback ports.
 */

import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ADMISSION_KEY_HEADER } from '../../cloudflare/src/admission-flag.ts'
import {
  PROPAGATION_BAND,
  PROPAGATION_INTERVAL_MS,
  PROPAGATION_POPULATION,
  PROPAGATION_WINDOW_MS,
} from '../../browser/src/propagation-window.ts'
// @ts-expect-error TS7016 — `tools/run/switch-observation.mjs` is plain ESM, which this plan
// requires so the sampler imports without a platform, and this repository's `tsconfig.json`
// sets no `allowJs`. So `tsc` RESOLVES the module and then refuses to read it for types. The
// tree's own answer is a sibling declaration file — `packages/demo/scripts/compile-kernel.d.mts`
// beside `compile-kernel.mjs` — and `packages/node/src/stage-budget.node.test.ts` carries this
// same suppression for the same reason against the sibling tool in `tools/run/`. A declaration
// file is outside this plan's writable set, so the suppression stands here too and is reported.
// It is **self-retiring**: add `tools/run/switch-observation.d.mts` and this directive becomes
// an "Unused '@ts-expect-error'" error of its own. What it costs is stated rather than hidden:
// every binding below is `any` to `tsc`, so the module's shape is checked by this file at
// RUNTIME — each export is called or read in a case — and not by the compiler.
import * as switchObservation from '../../../tools/run/switch-observation.mjs'

const {
  DEGRADED_GAP_FACTOR,
  disagrees,
  DISAGREEMENT_RUN_FOR_STOP,
  longestDisagreementRun,
  observationReport,
  observedWindow,
  PROPAGATION_BAND: RESTATED_BAND,
  PROPAGATION_INTERVAL_MS: RESTATED_INTERVAL,
  PROPAGATION_POPULATION: RESTATED_POPULATION,
  PROPAGATION_WINDOW_MS: RESTATED_WINDOW,
  renderedVerdicts,
  sampleAdmission,
  VERDICT_ADMITTING,
  VERDICT_HALTED,
  withinBaseline,
} = switchObservation

const TOOL_PATH = fileURLToPath(new URL('../../../tools/run/switch-observation.mjs', import.meta.url))
const STATUS_PAGE_PATH = fileURLToPath(new URL('../../browser/demo/status.ts', import.meta.url))
const STATUS_SHELL_PATH = fileURLToPath(new URL('../../browser/demo/status.html', import.meta.url))

/**
 * A well-formed `/self` body, written out once so each malformed case varies exactly one thing.
 *
 * The `admission` half is the deployed shape read live 2026-09-04 and quoted in this plan's
 * `<interfaces>` block, with `halted` flipped in the cases that need it.
 */
const SELF_BODY = {
  peerId: '12D3KooWLocalFixtureNotARealPeerId',
  instance: 'fixture-instance',
  admission: { region: null, halted: false, versions: 'all', since: null, note: '' },
}

// ---------------------------------------------------------------------------
// The pure half. No process, no port, no network.
// ---------------------------------------------------------------------------

describe('RUN-07 criterion 5 — the sampler reads a directive or refuses to answer', () => {
  it('parses a `/self` body into the five fields the transition is read from', () => {
    const sample = sampleAdmission({
      ...SELF_BODY,
      admission: {
        region: 'bootstrap-eu',
        halted: true,
        versions: ['0.1.0'],
        since: 1_788_191_433_180,
        note: 'the mid-run exercise',
      },
    })
    expect(sample.halted).toBe(true)
    expect(sample.region).toBe('bootstrap-eu')
    expect(sample.versions).toEqual(['0.1.0'])
    expect(sample.since).toBe(1_788_191_433_180)
    expect(sample.note).toBe('the mid-run exercise')
  })

  it('accepts the deployed shape, whose region is null and whose versions are `all`', () => {
    const sample = sampleAdmission(SELF_BODY)
    expect(sample.halted).toBe(false)
    expect(sample.region).toBeNull()
    expect(sample.versions).toBe('all')
    expect(sample.since).toBeNull()
    expect(sample.note).toBe('')
  })

  /**
   * **PLANT 1's case.** T-39-29: a sampler that answers `halted: false` for a body it could not
   * read reports a working fabric during an outage — the reading is then about the sampler and
   * not about the object, and it fails in the direction that keeps a run going.
   *
   * Eight shapes, each a way `/self` can stop being `/self`: an outage page, a proxy's HTML, a
   * truncated body, a field that changed type. Each is asserted to THROW, so an implementation
   * that defaults cannot satisfy any of them.
   */
  it('throws on a body that is not shaped like `/self`, and never answers a default', () => {
    const malformed: readonly unknown[] = [
      null,
      'service temporarily unavailable',
      42,
      {},
      { admission: null },
      { admission: { region: null, versions: 'all', since: null, note: '' } },
      { admission: { region: null, halted: 'false', versions: 'all', since: null, note: '' } },
      { admission: { region: null, halted: false, versions: 7, since: null, note: '' } },
    ]
    for (const body of malformed) {
      expect(
        () => sampleAdmission(body),
        `T-39-29: \`sampleAdmission\` answered rather than threw for ${JSON.stringify(body)}. ` +
          'A sampler that reads an unreadable body as "not halted" reports a working fabric ' +
          'during an outage, and the mid-run exercise would record a clean run it never saw.',
      ).toThrow()
    }
  })
})

describe('RUN-07 criterion 5 — the window, and the transitions it must refuse to invent', () => {
  it('answers the elapsed ms between the last not-halted sample and the first halted one', () => {
    // Written as literals arrived at by hand, never as arithmetic over the same inputs the
    // function reads: 4_000 - 3_000 = 1_000, and this repository has watched a plant stay green
    // because both sides of an assertion moved together.
    const window = observedWindow([
      { at: 1_000, halted: false },
      { at: 2_000, halted: false },
      { at: 3_000, halted: false },
      { at: 4_000, halted: true },
      { at: 5_000, halted: true },
    ])
    expect(window).toBe(1_000)
  })

  it('answers null when the samples never turn halted', () => {
    expect(
      observedWindow([
        { at: 1_000, halted: false },
        { at: 2_000, halted: false },
      ]),
    ).toBeNull()
  })

  /**
   * **PLANT 2's case, and it is the one this class of instrument most often fails.**
   *
   * T-39-30: a sampler that answers `0` here cannot tell *the switch flipped instantly* from
   * *I arrived after it had already flipped*. The first is a measurement and the second is the
   * absence of one, and reporting the second as the first is a repudiation — the owner reads a
   * perfect propagation window off a run whose transition nobody observed.
   *
   * `toBeNull()` rather than a falsy check on purpose: `0` is falsy and would pass one.
   */
  it('answers null — never zero — for a sample list that begins already halted', () => {
    expect(
      observedWindow([
        { at: 1_000, halted: true },
        { at: 2_000, halted: true },
      ]),
      'T-39-30: a list that begins halted carries no observed transition. Answering 0 makes an ' +
        'unobserved flip indistinguishable from an instantaneous one.',
    ).toBeNull()
  })

  it('refuses a sample that is not a sample rather than skipping it', () => {
    expect(() => observedWindow([{ at: 1_000, halted: false }, { at: 'later', halted: true }])).toThrow()
    expect(() => observedWindow([])).toThrow()
    expect(() => observedWindow('not a list')).toThrow()
  })
})

describe('RUN-07 criterion 5 — the comparison against Phase 36 is a ratio, with a band beside it', () => {
  it('reports the ratio beside the band verdict for a window at the production interval', () => {
    // 29 900 is 20 ms from the published 29 880 against a band of 1 500, so it is inside the
    // band without being trivially equal to it; 29 900 / 30 000 is 0.996666…, worked by hand.
    const verdict = withinBaseline(29_900)
    expect(verdict.within).toBe(true)
    expect(verdict.comparable).toBe(true)
    expect(verdict.intervalMs).toBe(30_000)
    expect(verdict.ratio).toBeCloseTo(0.9967, 4)
    expect(verdict.baselineMs).toBe(29_880)
    expect(verdict.bandMs).toBe(1_500)

    // And the published window's own ratio, because 0.996 is the figure the document quotes
    // and a document quoting a number nothing computes is how this repository drifts. Both
    // sides are hand-written literals: 29 880 / 30 000 = 0.996 exactly.
    expect(withinBaseline(29_880).ratio).toBeCloseTo(0.996, 3)
  })

  it('answers outside the band for a window that has stopped tracking the poll', () => {
    // A window of a whole extra interval is what a stopped poll or a second mechanism looks
    // like — wrong by seconds, not by 5 %, which is what `PROPAGATION_BAND` says it catches.
    const verdict = withinBaseline(59_880)
    expect(verdict.within).toBe(false)
    expect(verdict.ratio).toBeCloseTo(1.996, 3)
  })

  /**
   * The plane distinction, asserted rather than left in a docblock.
   *
   * A series taken at 5 000 ms cannot be inside a millisecond band published for a 30 000 ms
   * series, and `comparable: false` is the sampler saying so instead of printing a verdict
   * about two different quantities. The ratio is what survives the change of interval — which
   * is `propagation-window.ts`'s own finding, taken at 2 000 and 30 000 ms in one run.
   */
  it('says a window taken at another interval is not comparable to the millisecond band', () => {
    const verdict = withinBaseline(4_800, 5_000)
    expect(verdict.comparable).toBe(false)
    expect(verdict.ratio).toBeCloseTo(0.96, 3)
    expect(verdict.within).toBe(false)
  })

  it('refuses a null window rather than treating it as zero milliseconds', () => {
    expect(() => withinBaseline(null)).toThrow()
    expect(() => withinBaseline(29_900, 0)).toThrow()
  })
})

describe('RUN-07 criterion 5 — a window read across a missed sample is an upper bound', () => {
  it('reports a series with an oversized gap as degraded rather than measured', () => {
    // Sampled on a 1 000 ms grid, then a 4 000 ms hole: the flip could have landed anywhere in
    // it, so 4 000 is an upper bound on the window and not a reading of it.
    const report = observationReport(
      [
        { at: 1_000, halted: false },
        { at: 2_000, halted: false },
        { at: 6_000, halted: true },
      ],
      1_000,
    )
    expect(report.kind).toBe('degraded')
    expect(report.windowMs).toBe(4_000)
    expect(report.largestGapMs).toBe(4_000)
  })

  it('reports a series sampled on its own grid as measured', () => {
    const report = observationReport(
      [
        { at: 1_000, halted: false },
        { at: 2_000, halted: false },
        { at: 3_000, halted: true },
      ],
      1_000,
    )
    expect(report.kind).toBe('measured')
    expect(report.windowMs).toBe(1_000)
  })

  it('reports a series with no transition as not-observed, with no window at all', () => {
    const report = observationReport(
      [
        { at: 1_000, halted: false },
        { at: 2_000, halted: false },
      ],
      1_000,
    )
    expect(report.kind).toBe('not-observed')
    expect(report.windowMs).toBeNull()
  })

  it('allows ordinary jitter, so the degraded arm separates a missed sample from a slow host', () => {
    // The gap threshold is `DEGRADED_GAP_FACTOR` × the interval, and the factor exists because
    // a serial `sleep(interval); fetch` loop produces gaps of interval + round trip on every
    // healthy run. A threshold of exactly one interval would call every live run degraded.
    expect(DEGRADED_GAP_FACTOR).toBeGreaterThan(1)
    const report = observationReport(
      [
        { at: 1_000, halted: false },
        { at: 2_120, halted: false },
        { at: 3_260, halted: true },
      ],
      1_000,
    )
    expect(report.kind).toBe('measured')
  })
})

describe('RUN-07 criterion 5 — two copies of every borrowed literal, and they cannot disagree', () => {
  /**
   * The restated constants against `propagation-window.ts`'s exports.
   *
   * A `.mjs` in `tools/` cannot import a `.ts` in `packages/browser/src/`, so the four figures
   * are restated in the sampler. Restating them is only safe if something compares the copies,
   * and this is that something. Both sides are named in the failure message, because a reader
   * of a red here has to know which copy moved.
   *
   * Imported by relative path rather than from `@o2/browser`: the barrel does not export
   * `propagation-window.ts`, and `kill-switch-propagation.e2e.test.ts:68` is the tree's
   * standing precedent for reaching it this way.
   */
  it('restates Phase 36’s four constants and compares them against the published module', () => {
    expect(
      RESTATED_WINDOW,
      `switch-observation.mjs restates PROPAGATION_WINDOW_MS as ${String(RESTATED_WINDOW)} and ` +
        `packages/browser/src/propagation-window.ts publishes ${String(PROPAGATION_WINDOW_MS)}. ` +
        'The sampler would compare a live reading against a figure the fabric no longer claims.',
    ).toBe(PROPAGATION_WINDOW_MS)
    expect(
      RESTATED_BAND,
      `switch-observation.mjs restates PROPAGATION_BAND as ${String(RESTATED_BAND)} and ` +
        `propagation-window.ts publishes ${String(PROPAGATION_BAND)}.`,
    ).toBe(PROPAGATION_BAND)
    expect(
      RESTATED_INTERVAL,
      `switch-observation.mjs restates PROPAGATION_INTERVAL_MS as ${String(RESTATED_INTERVAL)} ` +
        `and propagation-window.ts publishes ${String(PROPAGATION_INTERVAL_MS)}.`,
    ).toBe(PROPAGATION_INTERVAL_MS)
    expect(
      RESTATED_POPULATION,
      `switch-observation.mjs restates PROPAGATION_POPULATION as ` +
        `${String(RESTATED_POPULATION)} and propagation-window.ts publishes ` +
        `${String(PROPAGATION_POPULATION)}.`,
    ).toBe(PROPAGATION_POPULATION)
  })

  /**
   * The status page's two rendered verdicts, on the same two-copies rule.
   *
   * `packages/browser/demo/status.ts` is a browser demo module and is deliberately NOT imported
   * here — the node lane would have to evaluate DOM-facing source to read one string. Its text
   * is read instead, which is what a `grep` for drift would do and is a weaker check than an
   * import: it proves the literals are present in that file, not that they are the ones
   * rendered. The rendering itself is Phase 36's, covered by `status-page.e2e.test.ts`.
   */
  it('restates the status page’s two verdicts and finds both in the page’s own source', () => {
    const statusSource = readFileSync(STATUS_PAGE_PATH, 'utf8')
    expect(VERDICT_HALTED).toBe('NOT ADMITTING NEW TASKS')
    expect(VERDICT_ADMITTING).toBe('Admitting new tasks')
    expect(
      statusSource.includes(VERDICT_HALTED),
      `the sampler looks for ${JSON.stringify(VERDICT_HALTED)} and status.ts no longer contains ` +
        'it, so the sampler would read every page as admitting.',
    ).toBe(true)
    expect(statusSource.includes(VERDICT_ADMITTING)).toBe(true)
  })

  /**
   * **The limitation, measured rather than caveated.**
   *
   * `status.html` is a shell: `status.ts` builds every card inside `render()` and assigns
   * `root.innerHTML` in the browser, so a `GET` on the published page returns markup carrying
   * neither verdict. A sampler documented to read the status page over HTTP would be documented
   * to read something that is not there — the same class of error as comparing a tab-side window
   * against an object-side one, and the reason `--status` is inert against this project's own
   * page and the owner reads that surface in a browser instead.
   *
   * `{0, 0}` is a no-claim by construction, so `disagrees` answers false and nothing
   * false-stops. **This case is also what retires the caveat**: server-render the page and it
   * reddens, which is the signal to delete the note in `renderedVerdicts`.
   */
  it('answers no verdict at all for the published shell, which paints itself in the browser', () => {
    const shell = readFileSync(STATUS_SHELL_PATH, 'utf8')
    expect(
      renderedVerdicts(shell),
      'packages/browser/demo/status.html now carries a rendered verdict, so the page is no ' +
        'longer painted only in the browser. The `--status` caveat in switch-observation.mjs ' +
        'is stale and should be retired.',
    ).toEqual({ halted: 0, admitting: 0 })
  })

  it('counts each verdict on a page that renders more than one object', () => {
    const page =
      '<section class="card halted"><p class="verdict">NOT ADMITTING NEW TASKS</p></section>' +
      '<section class="card admitting"><p class="verdict">Admitting new tasks</p></section>' +
      '<section class="card admitting"><p class="verdict">Admitting new tasks</p></section>'
    expect(renderedVerdicts(page)).toEqual({ halted: 1, admitting: 2 })
    expect(renderedVerdicts('<p>Could not be read</p>')).toEqual({ halted: 0, admitting: 0 })
    expect(() => renderedVerdicts(null)).toThrow()
  })
})

describe('RUN-07 criterion 5 — one straddling sample is not the two routes disagreeing', () => {
  it('calls a sample a disagreement only when the page carries one unambiguous verdict', () => {
    expect(disagrees(true, { halted: 0, admitting: 1 })).toBe(true)
    expect(disagrees(false, { halted: 1, admitting: 0 })).toBe(true)
    expect(disagrees(true, { halted: 1, admitting: 0 })).toBe(false)
    expect(disagrees(false, { halted: 0, admitting: 1 })).toBe(false)
    // A page rendering one card of each carries no single claim to contradict — which is what
    // it renders whenever more than one origin is configured.
    expect(disagrees(true, { halted: 1, admitting: 1 })).toBe(false)
    expect(disagrees(false, { halted: 0, admitting: 0 })).toBe(false)
    expect(() => disagrees('yes', { halted: 0, admitting: 1 })).toThrow()
    expect(() => disagrees(true, null)).toThrow()
  })

  /**
   * **The case this repository paid for by running the CLI before trusting it.**
   *
   * The first exercise against a local origin that flipped mid-run printed, in one sample,
   * `halted=false … status=halted:1 admitting:0`, and the verdict came back `stop`. Nothing was
   * wrong: the sampler reads `/self` and then the status page about a millisecond later, and
   * the flip landed between the two reads. Every run that observes a transition at all produces
   * one such sample, so a stop rule keyed on a single disagreement fires on exactly the runs
   * that worked.
   */
  it('needs two consecutive disagreements, so a flip between two reads is not a stop', () => {
    expect(DISAGREEMENT_RUN_FOR_STOP).toBe(2)
    const straddled = [
      { halted: false, verdicts: { halted: 0, admitting: 1 } },
      { halted: false, verdicts: { halted: 1, admitting: 0 } },
      { halted: true, verdicts: { halted: 1, admitting: 0 } },
    ]
    expect(longestDisagreementRun(straddled)).toBe(1)
    expect(longestDisagreementRun(straddled)).toBeLessThan(DISAGREEMENT_RUN_FOR_STOP)

    // A page that stayed on the old verdict after the object moved — the stale-cache reading
    // this rule exists to catch.
    const stale = [
      { halted: true, verdicts: { halted: 0, admitting: 1 } },
      { halted: true, verdicts: { halted: 0, admitting: 1 } },
      { halted: true, verdicts: { halted: 0, admitting: 1 } },
    ]
    expect(longestDisagreementRun(stale)).toBe(3)
    expect(longestDisagreementRun(stale)).toBeGreaterThanOrEqual(DISAGREEMENT_RUN_FOR_STOP)

    // An unread page breaks a run rather than extending it: an absence is not a disagreement.
    expect(
      longestDisagreementRun([
        { halted: true, verdicts: { halted: 0, admitting: 1 } },
        { halted: true, verdicts: null },
        { halted: true, verdicts: { halted: 0, admitting: 1 } },
      ]),
    ).toBe(1)
    expect(longestDisagreementRun([])).toBe(0)
    expect(() => longestDisagreementRun('not a list')).toThrow()
  })
})

describe('RUN-07 criterion 5 — the sampler holds no credential and has no write path', () => {
  /**
   * T-39-32 and T-39-33, read off the tool's own text.
   *
   * **What this can and cannot see, said rather than implied.** It proves three strings are
   * absent from the file: the request option that would make a `fetch` anything but a `GET`,
   * the operator key's header name, and `Authorization`. It cannot prove the tool never writes
   * — a sufficiently indirect construction would evade it. What makes the claim hold is that
   * the file is 300-odd lines of arithmetic and one `GET` loop, and this case is the guard that
   * a later edit adding a write cannot pass silently.
   */
  it('contains no request-shaping option, no admission key header and no Authorization', () => {
    const source = readFileSync(TOOL_PATH, 'utf8')
    for (const forbidden of ['method', ADMISSION_KEY_HEADER, 'Authorization']) {
      expect(
        source.toLowerCase().includes(forbidden.toLowerCase()),
        `T-39-32/33: tools/run/switch-observation.mjs contains ${JSON.stringify(forbidden)}. ` +
          'The sampler is read-only and holds no credential; the halt write is the owner’s and ' +
          'is scripted in 39-KILL-SWITCH-DURING-RUN.md.',
      ).toBe(false)
    }
  })
})

// ---------------------------------------------------------------------------
// The behavioural half. Two local `wrangler dev` children, no deployed origin.
// ---------------------------------------------------------------------------

/**
 * The identity secret both local children boot with — AUTH-07 criterion 4.
 *
 * Since that criterion the object refuses to open its sealed identity without
 * `O2_IDENTITY_SECRET` and answers `GET /self` with 500, so every readiness poll below would
 * time out. Per-spec test data rather than a shared constant, in the style of this tree's
 * `TEST_KEY`: each child has its own `--persist-to`, so the value only has to be
 * self-consistent across its own boots. The length IS load bearing — under twenty characters
 * `assertUsablePassphrase` refuses and every boot fails with `WeakPassphraseError`.
 */
const IDENTITY_SECRET = 'local-dev-identity-secret-42'

/**
 * The operator key these two local objects are configured with.
 *
 * A test key injected by `--var`, never a secret and never presented to a deployed object. It
 * is a literal here so the wrong-key arm can be a **different** literal: an assertion whose two
 * sides are the same variable proves nothing about the comparison it is testing.
 */
const TEST_KEY = 'phase-39-switch-observation-local-operator-key'

const CLOUDFLARE_DIR = fileURLToPath(new URL('../../cloudflare', import.meta.url))
const HOST = '127.0.0.1'
/** Its own two. 8791–8798, 8801–8810, 8814–8824 are taken by the specs already in the tree. */
const LABELLED_PORT = 8825
const UNLABELLED_PORT = 8826
const REGION = 'bootstrap-eu'

/** How often the live arm samples. See the docblock on the arm for why it is not 250 ms. */
const SAMPLE_INTERVAL_MS = 1_000

interface Sample {
  readonly at: number
  readonly halted: boolean
  readonly region: string | null
  readonly since: number | null
}

const children: ChildProcess[] = []
const persistDirs: string[] = []

async function readSelfBody(port: number): Promise<unknown> {
  const response = await fetch(`http://${HOST}:${String(port)}/self`, {
    signal: AbortSignal.timeout(5_000),
  })
  if (!response.ok) throw new Error(`/self on ${String(port)} answered ${String(response.status)}`)
  return response.json()
}

/** One sample, taken through the exported parser and never through a sibling one. */
async function takeSample(port: number): Promise<Sample> {
  const body = await readSelfBody(port)
  const parsed = sampleAdmission(body)
  return { at: Date.now(), halted: parsed.halted, region: parsed.region, since: parsed.since }
}

async function writeAdmission(
  port: number,
  directive: Record<string, unknown>,
  key: string | null,
): Promise<{ status: number; body: string }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (key !== null) headers[ADMISSION_KEY_HEADER] = key
  const response = await fetch(`http://${HOST}:${String(port)}/admission`, {
    method: 'POST',
    headers,
    body: JSON.stringify(directive),
    signal: AbortSignal.timeout(5_000),
  })
  return { status: response.status, body: await response.text() }
}

async function waitForReady(port: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  let lastError: unknown
  while (Date.now() < deadline) {
    try {
      await readSelfBody(port)
      return
    } catch (cause) {
      lastError = cause
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error(
    `workerd on ${String(port)} did not become ready within ${String(timeoutMs)} ms: ${String(lastError)}`,
  )
}

/**
 * Boot one local object.
 *
 * `region` is `null` for the deployed-shaped child: `O2_REGION` is simply not passed, which is
 * what `narrowRegion(undefined)` reads as "this object serves no region".
 */
async function bootWorker(port: number, region: string | null): Promise<void> {
  const persistDir = mkdtempSync(join(tmpdir(), `o2-switch-observation-${String(port)}-`))
  persistDirs.push(persistDir)
  const args = [
    'wrangler',
    'dev',
    '--port',
    String(port),
    '--local-protocol',
    'http',
    '--persist-to',
    persistDir,
    '--var',
    `O2_IDENTITY_SECRET:${IDENTITY_SECRET}`,
    // `--var` MERGES with the file's `vars` rather than replacing them — measured 2026-08-27
    // and recorded at `worker.ts`'s `O2_VERSION` docblock — so this one key moves and the rest
    // stand. `wrangler.jsonc` announces the DEPLOYED host, and a local relay left at that value
    // hands its clients a circuit address pointing at production.
    '--var',
    `ANNOUNCE_MULTIADDRS:/ip4/${HOST}/tcp/${String(port)}/ws`,
    '--var',
    `O2_ADMISSION_KEY:${TEST_KEY}`,
  ]
  if (region !== null) args.push('--var', `O2_REGION:${region}`)
  const child = spawn('npx', args, {
    cwd: CLOUDFLARE_DIR,
    env: { ...process.env, CLOUDFLARE_API_TOKEN: '', WRANGLER_SEND_METRICS: 'false' },
    stdio: ['ignore', 'ignore', 'pipe'],
    detached: true,
  })
  children.push(child)
  child.stderr?.on('data', (chunk: Buffer) => {
    const text = chunk.toString()
    if (text.includes('ERROR')) process.stdout.write(`[workerd ${String(port)}] ${text}`)
  })
  await waitForReady(port, 180_000)
}

describe('RUN-07 criterion 5 — the sampler sees a transition on a running object', () => {
  beforeAll(async () => {
    // Sequentially, waiting for each `/self` before starting the next. Two workerd processes
    // racing to bind and compile is a source of flake with nothing to do with the property
    // under test — `admission-slices.e2e.test.ts` records the same.
    await bootWorker(LABELLED_PORT, REGION)
    await bootWorker(UNLABELLED_PORT, null)
  }, 400_000)

  afterAll(async () => {
    try {
      for (const child of children) {
        if (child.pid !== undefined) {
          try {
            process.kill(-child.pid, 'SIGTERM')
          } catch {
            child.kill('SIGTERM')
          }
        }
      }
    } finally {
      for (const dir of persistDirs) await rm(dir, { recursive: true, force: true }).catch(() => {})
    }
  }, 120_000)

  /**
   * The arm that makes the CLI an instrument rather than a pretty printer.
   *
   * **Sampled at 1 000 ms and not at 250 ms.** The `node` lane runs eight workers in parallel
   * and is CPU-bound — its own config records `(user+sys)/real` of 5.35 — so a grid finer than
   * the host's scheduling noise would make `observationReport` call a healthy run degraded for
   * a reason about this machine. The window this reads is ≈ one sampling interval **by
   * construction**, which is the point: it is an object-side reading, not the tab-side 29 880 ms
   * Phase 36 published, and the assertion below is comparative — bounded by three of this run's
   * own intervals — rather than an absolute sited against this host.
   *
   * **The sampling runs on an ABSOLUTE grid while the flip is written beside it**, which is the
   * CLI's own arrangement rather than a convenience. Written the obvious way — sample, sleep,
   * write, sleep, sample — the write's round trip lands *between* two waits and the series
   * carries a hole of two intervals where the flip happened. That was measured on the first run
   * of this arm: `kind=degraded window=2022 ms gap=2022 ms` at a 1 000 ms cadence. The reading
   * was correct and the harness was wrong: a window read across a hole is an upper bound, and
   * the instrument said so.
   *
   * **The un-halt is inside the arm**, so the control is exercised and released rather than
   * exercised and left on, and the release is read back through the same sampler.
   */
  it('watches false → true → false, and reports a finite window for the flip', async () => {
    // The floor. Admitting before anything is written, read back rather than assumed: an
    // object that started halted would make every assertion below pass while measuring nothing.
    const reset = await writeAdmission(
      LABELLED_PORT,
      { region: REGION, halted: false, versions: 'all', since: null, note: '' },
      TEST_KEY,
    )
    expect(reset.status, `the reset was refused: ${reset.body}`).toBe(200)

    const samples: Sample[] = []
    const startedAt = Date.now()
    let stopped = false
    // The sampler, on the grid, running for the whole arm. Twenty-four intervals is far more
    // than an object-side flip can need; reaching the end without a halted sample is the
    // sampler failing to see a transition, which is a red rather than a clean run.
    const sampling = (async () => {
      for (let index = 0; index < 24 && !stopped; index += 1) {
        const wait = startedAt + index * SAMPLE_INTERVAL_MS - Date.now()
        if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait))
        samples.push(await takeSample(LABELLED_PORT))
        if (samples[samples.length - 1]?.halted === true) return
      }
    })()

    // Three intervals in, so the series has a floor before the flip and the write lands inside
    // the grid rather than between two of its waits.
    await new Promise((resolve) => setTimeout(resolve, SAMPLE_INTERVAL_MS * 3 + SAMPLE_INTERVAL_MS / 2))
    const flipped = await writeAdmission(
      LABELLED_PORT,
      {
        region: REGION,
        halted: true,
        versions: 'all',
        since: Date.now(),
        note: 'phase 39 — the mid-run exercise, on a local object',
      },
      TEST_KEY,
    )
    if (flipped.status !== 200) stopped = true
    await sampling
    expect(flipped.status, `the flip was refused (${String(flipped.status)}): ${flipped.body}`).toBe(200)

    // **The positive control**, asserted before anything about the transition. An instrument
    // that cannot show the un-halted state is one that answers halted to everything, and "the
    // switch propagated" would then be a statement about the sampler rather than the fabric.
    const beforeFlip = samples.filter((sample) => !sample.halted)
    expect(
      beforeFlip.length,
      'no sample read not-halted, so this run cannot say the sampler saw a transition rather ' +
        'than a constant. The pre-flip readings are the control and there are none.',
    ).toBeGreaterThanOrEqual(2)
    expect(samples[0]?.halted).toBe(false)

    const report = observationReport(samples, SAMPLE_INTERVAL_MS)
    console.log(
      `[switch-observation arm] kind=${String(report.kind)} window=${String(report.windowMs)} ms ` +
        `interval=${String(SAMPLE_INTERVAL_MS)} ms ratio=${String(report.ratio)} ` +
        `gap=${String(report.largestGapMs)} ms samples=${String(samples.length)}`,
    )

    expect(
      report.kind,
      'the sampler never saw the object turn halted, so this run has no observed window. A ' +
        'sampler that cannot see the transition fails this case rather than reporting a clean run.',
    ).not.toBe('not-observed')
    expect(report.windowMs).toBeGreaterThan(0)
    expect(
      report.windowMs,
      `the observed window is ${String(report.windowMs)} ms against a sampling interval of ` +
        `${String(SAMPLE_INTERVAL_MS)} ms in this same run. An object-side window is bounded by ` +
        'the sampler’s own grid; more than three intervals means something other than the ' +
        'sampler’s cadence dominates it.',
    ).toBeLessThanOrEqual(SAMPLE_INTERVAL_MS * 3)

    // The plane statement, asserted: this reading is NOT the published tab-side band, and the
    // sampler says so itself rather than leaving a reader to compare two different quantities.
    const verdict = withinBaseline(report.windowMs, SAMPLE_INTERVAL_MS)
    expect(verdict.comparable).toBe(false)

    // ---- The un-halt, and the read-back that says the control was released. ----
    const released = await writeAdmission(
      LABELLED_PORT,
      { region: REGION, halted: false, versions: 'all', since: null, note: '' },
      TEST_KEY,
    )
    expect(released.status, `the un-halt was refused: ${released.body}`).toBe(200)
    const after = await takeSample(LABELLED_PORT)
    expect(
      after.halted,
      'the object is still halted after the un-halt. A control exercised and left on is an outage.',
    ).toBe(false)
    expect(after.since).toBeNull()
  }, 200_000)

  it('refuses a keyless halt with 401 and does not move', async () => {
    // T-39-28. The stop rule in the document reads "a keyless write succeeding" as a stop, and
    // this is that reading taken on an object configured the way production is.
    const before = await takeSample(LABELLED_PORT)
    const keyless = await writeAdmission(
      LABELLED_PORT,
      { region: REGION, halted: true, versions: 'all', since: Date.now(), note: 'unauthorised' },
      null,
    )
    expect(keyless.status, `a keyless halt answered ${String(keyless.status)}: ${keyless.body}`).toBe(401)
    const after = await takeSample(LABELLED_PORT)
    expect(after.halted).toBe(before.halted)
    expect(after.halted).toBe(false)
  }, 60_000)

  /**
   * **The finding this plan hands to the owner, measured rather than inferred.**
   *
   * `refuseMisaddressed` refuses every write to an object whose own region is `null` —
   * `admission-flag.ts` states it at the function, and `worker.ts` calls it unconditionally
   * before writing. The deployed object's `/self`, read live 2026-09-04 and quoted in this
   * plan's `<interfaces>` block, reports `"region":null`. This child is booted with **no**
   * `O2_REGION`, which is that same configuration, and a correctly-keyed halt is refused 409.
   *
   * So the mid-run exercise is blocked on `36-RUNBOOK.md` act 2 until the deployed script
   * carries a region label. The document says what the owner runs and what reading releases it.
   */
  it('refuses a correctly-keyed halt with 409 when the object carries no region label', async () => {
    const body = await readSelfBody(UNLABELLED_PORT)
    const sample = sampleAdmission(body)
    expect(
      sample.region,
      'this child was booted with no O2_REGION and reports a region anyway, so it is not the ' +
        'deployed object’s shape and the refusal below would be about something else.',
    ).toBeNull()

    for (const directive of [
      { region: null, halted: true, versions: 'all', since: Date.now(), note: 'global halt' },
      { region: REGION, halted: true, versions: 'all', since: Date.now(), note: 'regional halt' },
    ]) {
      const refused = await writeAdmission(UNLABELLED_PORT, directive, TEST_KEY)
      expect(
        refused.status,
        `an object reporting region: null accepted a halt addressed ` +
          `${JSON.stringify(directive.region)} with status ${String(refused.status)}. The ` +
          'deployed object reports region: null, so this is the write the owner’s mid-run ' +
          'script sends and 409 is what it gets.',
      ).toBe(409)
      expect(refused.body).toContain('serves no region')
    }

    const after = sampleAdmission(await readSelfBody(UNLABELLED_PORT))
    expect(after.halted).toBe(false)
  }, 60_000)
})
