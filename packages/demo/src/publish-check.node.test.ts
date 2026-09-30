import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * `scripts/sign-kernel.ts` cannot be run by a test — every run makes new keys and new
 * signed records — so what it does with `assertPublishable` is read from its source.
 * The check itself is tested in `publish-check.test.ts`; this holds the script to calling
 * it, for every module it signs, before any key is generated.
 */
const SCRIPT = readFileSync(fileURLToPath(new URL('../scripts/sign-kernel.ts', import.meta.url)), 'utf8')

/** The source with comments removed, so a call that was commented out does not count. */
const CODE = SCRIPT.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

describe('the signing script refuses a module no node would run before it makes a key', () => {
  it.each([
    ['KERNEL_NAME', 'kernelBytes'],
    ['PI_NAME', 'piKernelBytes'],
    ['PRIMES_NAME', 'primesKernelBytes'],
  ])('checks %s before the first key is generated', (name, bytes) => {
    const call = CODE.indexOf(`assertPublishable(${name}, ${bytes})`)
    expect(call).toBeGreaterThan(-1)
    const firstKey = CODE.indexOf('randomSecretKey(')
    expect(firstKey).toBeGreaterThan(-1)
    expect(call).toBeLessThan(firstKey)
  })
})
