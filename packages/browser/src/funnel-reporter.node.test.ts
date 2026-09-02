import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { stripComments } from '../../node/src/strip-comments.ts'

/**
 * The scope fence, made mechanical — RUN-04, and it is about money.
 *
 * **If the reporter or the demo's funnel wiring ever named a deployed collector, every
 * end-to-end run in this repository would post to the owner's live Durable Object.** Money
 * spent and a store polluted, by a test suite, with no failing test anywhere to say so — the
 * run would look greener for it. So the endpoint is configuration with no default, and this
 * file reads the source text and asserts there is no origin to fall back to.
 *
 * ## Why this is a `.node.test.ts` and the behavioural cases are not
 *
 * MEASURED, not stylistic: `vitest.config.ts:1224` gives `packages/*​/src/**​/*.test.ts` to the
 * `node` project **and** the same glob to the `browser` project, so a plain `.test.ts` runs in
 * both lanes and `readFileSync` does not exist in one of them. The `browser` project excludes
 * the `.node.test.ts` suffix. `gateway-module.node.test.ts` is the precedent for a Node-only
 * spec living beside a browser module.
 *
 * ## Comments are stripped first, and this repository has paid for that rule twice
 *
 * `CLAUDE.md` records `hosted-tier-deploy.node.test.ts` reddening because the prose explaining
 * a forbidden literal contained the literal. The docblock above this scan therefore says
 * `workers.dev` nowhere, and every scan below runs over `stripComments` output so an
 * explanation of the rule can never fail the rule.
 */

const REPORTER = fileURLToPath(new URL('./funnel-reporter.ts', import.meta.url))
const DEMO_MAIN = fileURLToPath(new URL('../demo/main.ts', import.meta.url))

/**
 * The host suffix a deployed Worker is served from, assembled rather than written.
 *
 * Split so this file does not itself contain the string it forbids, which is the repair
 * `wrangler.jsonc` needed for the same reason and records in the same words.
 */
const DEPLOYED_HOST_SUFFIX = ['workers', 'dev'].join('.')

/** Every line of the funnel wiring in `demo/main.ts`, code only. */
function funnelLinesOf(path: string): string[] {
  return stripComments(readFileSync(path, 'utf8'))
    .split('\n')
    .filter((line) => /funnel|Funnel/.test(line))
}

describe('the reporter carries no origin to fall back to', () => {
  it('names no deployed host anywhere in its source', () => {
    const code = stripComments(readFileSync(REPORTER, 'utf8'))
    expect(
      code.includes(DEPLOYED_HOST_SUFFIX),
      'RUN-04 scope fence: the reporter names a deployed host, so a page that configured ' +
        'nothing would post to it. The endpoint is configuration and has no default.',
    ).toBe(false)
  })

  it('names no absolute origin at all, so there is nothing to default TO', () => {
    const code = stripComments(readFileSync(REPORTER, 'utf8'))
    const origin = /https?:\/\/[^\s'"`]+/.exec(code)
    expect(
      origin?.[0] ?? null,
      'RUN-04 scope fence: the reporter carries an absolute origin literal. Even a localhost ' +
        'one is a default, and a default is what turns "configure the collector" into ' +
        '"remember to configure the collector".',
    ).toBeNull()
  })

  it('the demo page carries no origin on its funnel path either', () => {
    const lines = funnelLinesOf(DEMO_MAIN)
    // THE FLOOR. Without it this case passes over a file that stopped wiring the funnel at
    // all, which is a green that says the opposite of what it looks like.
    expect(
      lines.length,
      'no funnel wiring found in demo/main.ts, so the scan below reads nothing',
    ).toBeGreaterThan(0)

    for (const line of lines) {
      expect(line.includes(DEPLOYED_HOST_SUFFIX), `demo/main.ts names a deployed host: ${line}`).toBe(
        false,
      )
      expect(/https?:\/\//.test(line), `demo/main.ts names an origin on a funnel line: ${line}`).toBe(
        false,
      )
    }
  })

  it('the demo reads its endpoint from the URL and from nowhere else', () => {
    const code = stripComments(readFileSync(DEMO_MAIN, 'utf8'))
    // The positive half: not merely "no literal" but "the one route that exists is the
    // configured one". A file with no origin AND no reader would pass the three cases above.
    expect(
      code,
      'demo/main.ts no longer reads the funnel endpoint from the page URL, so either the ' +
        'wiring moved or the reporter is reached some other way — check which before ' +
        'relaxing this',
    ).toContain('funnelEndpointFrom')
  })
})
