import { DEFAULT_MAX_MEMORY_PAGES } from '@o2/core'
import { describe, expect, it } from 'vitest'
import { moduleEchoImportingMemory, moduleEchoWithMemory } from '../../core/src/executor/fixtures.ts'
import { kernelBytes } from './kernel.ts'
import { piKernelBytes } from './pi.ts'
import { primesKernelBytes } from './primes.ts'
import { assertPublishable } from './publish-check.ts'

describe('the signer refuses a module no node would run', () => {
  it('passes the three modules this repository signs', () => {
    expect(() => assertPublishable('kernel', kernelBytes)).not.toThrow()
    expect(() => assertPublishable('pi', piKernelBytes)).not.toThrow()
    expect(() => assertPublishable('primes', primesKernelBytes)).not.toThrow()
  })

  it('refuses a module whose memory declares no maximum, naming it', () => {
    expect(() => assertPublishable('uncapped', moduleEchoWithMemory(1, null))).toThrow(
      /^refusing to sign uncapped: memory-uncapped: /,
    )
  })

  it('refuses a maximum one page above the cap, and passes one exactly at it', () => {
    expect(() => assertPublishable('over', moduleEchoWithMemory(1, DEFAULT_MAX_MEMORY_PAGES + 1))).toThrow(
      /^refusing to sign over: memory-over-cap: /,
    )
    expect(() => assertPublishable('at', moduleEchoWithMemory(1, DEFAULT_MAX_MEMORY_PAGES))).not.toThrow()
  })

  it('refuses an imported memory with no maximum', () => {
    expect(() => assertPublishable('imports', moduleEchoImportingMemory(1, null))).toThrow(/memory-uncapped/)
  })
})
