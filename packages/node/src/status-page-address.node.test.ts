/**
 * RUN-03 — the status page's default object is the object the fabric announces.
 *
 * ## Why a guard rather than a shared constant
 *
 * `packages/cloudflare/wrangler.jsonc` is the one place the deployed bootstrap's address
 * lives, and it is **JSONC**: it carries comments by design — *"Comments are the point of the
 * C"* — Vite's JSON handling will not parse it, and a build-time plugin to reach a file two
 * packages away is a mechanism a static page does not need. So the page holds a named constant
 * and this file reads **both files off disk** and compares them.
 *
 * That is `data-cost.ts`'s anti-drift shape: two independently obtainable values, **neither
 * computed from the other**. The page's constant is a literal; the address is parsed out of
 * the deployment manifest and run through `switchEndpointFor`, the same function the client
 * uses to derive a poll endpoint. If the deployment moves and the page does not, this reddens
 * and names both sides.
 *
 * ## Why a `*.node.test.ts` and not a bare `*.test.ts`
 *
 * `vitest.config.ts` hands the bare-`.test.ts` glob under every package's `src` to the `node`
 * project **and** the `browser` project. This file calls `readFileSync`, which does not exist
 * in the browser lane, so the `.node.` suffix is what keeps it in the one lane where it can
 * run at all.
 *
 * (The glob is described rather than written out: it contains the two characters that end a
 * block comment, and writing it here made this whole docblock terminate mid-sentence — the
 * file then failed to import with `ReferenceError: src is not defined` and reported
 * `Tests no tests`, which is a green-looking way to run nothing.)
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { switchEndpointFor } from '../../browser/src/kill-switch.ts'
import { DEFAULT_STATUS_ORIGIN } from '../../browser/demo/status.ts'

const WRANGLER = fileURLToPath(new URL('../../cloudflare/wrangler.jsonc', import.meta.url))

/**
 * The announced address, read out of the manifest.
 *
 * A line-oriented read rather than a JSONC parser: the value is one quoted string on one line,
 * and pulling in a parser to reach it would be a dependency this guard does not need. The
 * anti-vacuity case below is what stops a regex that stopped matching from reading as
 * agreement.
 */
function announcedMultiaddr(): string | null {
  const source = readFileSync(WRANGLER, 'utf8')
  const match = /"ANNOUNCE_MULTIADDRS"\s*:\s*"([^"]+)"/u.exec(source)
  return match?.[1] ?? null
}

describe('RUN-03 — the status page names the object the fabric announces', () => {
  it('read a manifest that actually holds an announced address', () => {
    // Anti-vacuity: a regex that stopped matching would make every comparison below trivially
    // pass, and the page could then drift as far as it liked. This is the floor case
    // `built-bundle.e2e.test.ts` records for exactly this shape of assertion.
    const announced = announcedMultiaddr()
    expect(announced).not.toBe(null)
    expect(announced).toContain('/tls/ws')
  })

  it('holds the same origin the announced multiaddr resolves to', () => {
    const announced = announcedMultiaddr()
    const derived = switchEndpointFor(announced ?? '')
    expect(
      DEFAULT_STATUS_ORIGIN,
      `RUN-03: the status page's default object is ${DEFAULT_STATUS_ORIGIN} and the deployment ` +
        `announces ${String(announced)}, which resolves to ${String(derived)}. A volunteer ` +
        'opening the status page would be reading an object the fabric does not run. Fix the ' +
        'page constant, or the manifest — whichever moved.',
    ).toBe(derived)
  })

  it('derives that origin rather than restating the literal', () => {
    // Neither side is computed from the other, and this case is what says so: the derived
    // value is checked against an independently written expectation of its SHAPE, so a
    // `switchEndpointFor` that had degenerated to the identity function would be caught here
    // rather than agreeing with itself.
    const derived = switchEndpointFor(announcedMultiaddr() ?? '')
    expect(derived).not.toBe(announcedMultiaddr())
    expect(derived?.startsWith('https://')).toBe(true)
  })
})
