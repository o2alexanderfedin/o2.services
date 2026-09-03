import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * The library-behaviour guard for NET-12, in the **node** lane and named for it.
 *
 * It lives apart from `ice-configuration.test.ts` for one mechanical reason: that spec runs in
 * the browser lane too (three engines), and this one calls `readFileSync`, which does not exist
 * there. A filesystem guard is a `*.node.test.ts` or it reddens in a lane it was never about.
 *
 * The claim is the NET-14 precedent applied to `@libp2p/webrtc`. That phase pinned
 * `@multiformats/multiaddr-matcher`'s own answer so a version that changed it reddened there
 * rather than silently mis-reporting every pair. Same shape: if the `?? DEFAULT_ICE_SERVERS`
 * line ever goes away, CORRECTION 2 stops being true and `ice-configuration.ts`'s non-optional
 * `iceServers` stops being load-bearing **for the reason it was written**. That is a thing to
 * re-read the correction about, not a thing to discover by a tab quietly dialling a name that
 * does not resolve.
 *
 * Reading the package as **text** rather than importing it is the `slow-specs.node.test.ts:39-44`
 * idiom, taken for its stated reason: `dist/src/util.js` is not an entry point the package
 * publishes, so importing it would couple this spec to a path that is free to move.
 */

/** The name that rotted, and that the package still ships. */
const DEAD_ENTRY = 'stun.services.mozilla.com'

function packageSource(file: string): string {
  return readFileSync(
    fileURLToPath(new URL(`../../../node_modules/@libp2p/webrtc/dist/src/${file}`, import.meta.url)),
    'utf8',
  )
}

describe('NET-12 — the library still fills iceServers from its own defaults', () => {
  it('still contains the `?? DEFAULT_ICE_SERVERS` fallback CORRECTION 2 is about', () => {
    expect(
      /config\.iceServers\s*=\s*config\.iceServers\s*\?\?\s*DEFAULT_ICE_SERVERS/.test(
        packageSource('util.js'),
      ),
      'the `config.iceServers ?? DEFAULT_ICE_SERVERS` line in @libp2p/webrtc util.js is GONE. ' +
        'CORRECTION 2 in the Phase 34 plan is what makes ice-configuration.ts\u2019s non-optional ' +
        '`iceServers` load-bearing; re-read it before relaxing that contract, and re-check ' +
        'whether the package still reinstates four servers this project never chose.',
    ).toBe(true)
  })

  it('still ships the dead entry among those defaults, which is why it must never be omitted', () => {
    expect(packageSource('constants.js')).toContain(DEAD_ENTRY)
  })
})
