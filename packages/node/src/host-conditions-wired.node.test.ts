/**
 * The conditions reporter is WIRED, not merely written.
 *
 * ## Why this file exists at all
 *
 * `workerd-shims.ts` is the precedent and it cost a live deploy: a module that was correct,
 * tested and imported by NOTHING, whose own specs passed throughout because they called it
 * directly, and whose absence surfaced as a `ReferenceError` out of `wrangler tail`. A
 * reporter has exactly that shape — {@link hostConditionsVerdict}'s spec exercises the
 * decision and would go on passing with the reporter unwired, at which point every run would
 * again be taken with nothing reading the load.
 *
 * So this reads `vitest.config.ts` as text. The claims below are about the CONFIGURATION, and
 * the only honest way to check a configuration is to read it.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const CONFIG = readFileSync(`${ROOT}/vitest.config.ts`, 'utf8')
const REPORTER = 'tools/measure/host-conditions-reporter.ts'

describe('every lane carries the conditions it was measured under', () => {
  it('names the reporter in the config, so no run is taken without reading the host', () => {
    expect(CONFIG).toContain(`'./${REPORTER}'`)
  })

  it('keeps `default` FIRST, because `reporters` replaces rather than adds', () => {
    // Verified by running it both ways rather than read off the documentation: with the
    // array set and `default` omitted, a run prints no pass/fail summary at all.
    expect(CONFIG).toContain(`reporters: ['default', './${REPORTER}']`)
  })

  it('wires it at the ROOT rather than inside one project, which is what reaches browser', () => {
    // Reporters are run-level in vitest 4.1.10. The browser lane is the one that produced the
    // wrong conclusion AND the one whose specs cannot read the load themselves — there is no
    // `node:os` in a browser — so a per-project wiring that missed it would miss the case.
    const reportersAt = CONFIG.indexOf('reporters: ')
    const projectsAt = CONFIG.indexOf('projects: [')
    expect(reportersAt).toBeGreaterThan(0)
    expect(projectsAt).toBeGreaterThan(0)
    expect(reportersAt, 'the reporters array must sit above `projects:`').toBeLessThan(projectsAt)
  })

  it('puts it back on the documented measurement recipe, which a CLI flag would strip', () => {
    // A CLI `--reporter=` OVERRIDES the config array. That cannot be closed from configuration,
    // so the repository's own `--reporter=json` procedure names this reporter too, and this
    // case is what keeps it named.
    expect(CONFIG).toContain(`--reporter=./${REPORTER}`)
  })

  it('carries a ceiling sited on readings that are written down beside it', () => {
    const reporter = readFileSync(`${ROOT}/${REPORTER}`, 'utf8')

    // The three passes and the one failure the constant sits between. Named here as well so
    // that deleting the table from the reporter's docblock cannot leave the number unexplained.
    expect(reporter).toContain('18.95')
    expect(reporter).toContain('6.68')
    expect(reporter).toContain('49.5')
    expect(reporter).toContain('export const LOAD_PER_CORE_CEILING = 4')
  })

  it('reports and never fails the run, because a green run on a loaded host is green', () => {
    const reporter = readFileSync(`${ROOT}/${REPORTER}`, 'utf8')

    // Contention voids durations, not assertions. A reporter that set an exit code would say
    // the opposite and would make the instrument refuse the runs it is cheapest to take.
    expect(reporter).not.toContain('process.exitCode')
    expect(reporter).not.toContain('process.exit(')
  })
})
