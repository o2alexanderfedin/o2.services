/**
 * No e2e fixture launches a browser that can reach the internet by accident.
 *
 * ## What this cost, measured 2026-09-08
 *
 * The Nostr bootstrap fallback went live the night before. On the next full e2e run **seventeen
 * cases in six files went red on a quiet host** — `'3 node(s) computing'` where two were
 * expected, `'5'`, `'7'`, and a page that would not report itself stopped. The fixtures were not
 * wrong: a page with no `bootstrap.json` and no `?relay=` is exactly what a local fixture looks
 * like, so every one of those tabs found the fabric's signed document, dialled the **live
 * production relay**, and joined the real network. The suite was running against production and
 * counting real volunteers as its own peers.
 *
 * `launchFixtureBrowser` was made hermetic by default and sixteen of the seventeen went green.
 * **The seventeenth kept failing, two runs in three, and the reason is the shape this repository
 * keeps finding**: the insulation existed and was not on every path. Six files called
 * `chromium.launch()` directly, so the default never reached them. Attribution was settled by
 * measurement — a control run with the publisher pinned to nothing passed that spec 70 files out
 * of 70 — and routing the six through the shared launcher took the pair from two failures in
 * three runs to three passes in three.
 *
 * This file is what stops a seventh appearing. It is a **text check over the corpus**, in the
 * manner of `reachability-guard.node.test.ts`: cheap, total, and it names the file.
 */

import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { HERMETIC_PROXY, launchFixtureBrowser } from './e2e-browser-launch.ts'

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))

/** Every e2e spec in the tree, from git rather than a glob — an untracked file is not a spec. */
function e2eSpecs(): string[] {
  // `git ls-files packages` and then a suffix filter, rather than a pathspec glob. The glob
  // `packages/*/src/**/*.e2e.test.ts` was written first and matched **nothing** — git's pathspec
  // is not a shell glob — and the case below passed cleanly over the empty list. The floor above
  // is what caught it, which is the whole reason a floor is written before the check it guards.
  const listed = execFileSync('git', ['ls-files', 'packages'], { cwd: ROOT, encoding: 'utf8' })
  return listed.split('\n').filter((path) => path.endsWith('.e2e.test.ts'))
}

describe('every e2e fixture gets its browser from the shared launcher', () => {
  it('reads a corpus big enough to be worth a verdict', () => {
    // The floor. A guard over an empty list passes for the wrong reason, and this one's whole
    // job is to notice an absence.
    expect(e2eSpecs().length).toBeGreaterThan(50)
  })

  it('has no fixture calling a browser type’s own `launch` directly', () => {
    const offenders: string[] = []
    for (const spec of e2eSpecs()) {
      const source = readFileSync(join(ROOT, spec), 'utf8')
      for (const engine of ['chromium', 'firefox', 'webkit']) {
        // `launchPersistentContext` is deliberately NOT matched: it returns a context rather than
        // a browser, cannot go through `launchFixtureBrowser`, and `chromiumFixtureArgs` exists
        // for it. A fixture using it takes its own proxy decision and says so.
        if (source.includes(`${engine}.launch(`)) offenders.push(`${spec} — ${engine}.launch(`)
      }
    }
    expect(
      offenders,
      'a fixture that launches its own browser does not get the hermetic proxy, so its page can ' +
        'reach the internet — and since the nostr bootstrap fallback went live that means ' +
        'dialling the LIVE production relay and joining the real fabric. Seventeen cases went ' +
        'red that way. Use `launchFixtureBrowser(engine)`, and pass `{ online: true }` with a ' +
        'reason if the fixture genuinely needs the network.',
    ).toEqual([])
  })

  it('bypasses loopback AND the private ranges, so a fixture can serve from its own LAN address', () => {
    // `seed-discovery.e2e.test.ts` serves the page from this machine's LAN address on purpose —
    // the thing it models is a second device joining knowing only a URL. A bypass list that knew
    // only loopback failed it with `net::ERR_PROXY_CONNECTION_FAILED`, which is this guard's
    // sibling failure: insulation that also blocks the fixture's own server.
    for (const needle of ['127.0.0.1', 'localhost', '10.0.0.0/8', '192.168.0.0/16']) {
      expect(HERMETIC_PROXY.bypass).toContain(needle)
    }
    // And the proxy itself goes nowhere. Port 9 is `discard`.
    expect(HERMETIC_PROXY.server).toContain(':9')
  })

  it('is a function, not a constant — the launcher is what applies the proxy', () => {
    // The anti-vacuity leg: the two cases above read text and a constant, and would both pass on
    // a tree where `launchFixtureBrowser` had been deleted.
    expect(typeof launchFixtureBrowser).toBe('function')
  })
})
