import { describe, expect, it } from 'vitest'
import { MemoryBlockstore } from './memory.ts'

describe('MemoryBlockstore — DATA-01', () => {
  it('round-trips bytes by CID', async () => {
    const store = new MemoryBlockstore()
    const bytes = new Uint8Array([1, 2, 3, 4])
    const cid = await store.put(bytes)
    expect(await store.has(cid)).toBe(true)
    expect(await store.get(cid)).toEqual(bytes)
  })

  it('gives the same CID for identical bytes, and stores them once', async () => {
    const store = new MemoryBlockstore()
    const a = await store.put(new Uint8Array([9, 9]))
    const b = await store.put(new Uint8Array([9, 9]))
    expect(a.toString()).toBe(b.toString())
    // Dedup is a free consequence of content addressing, not a feature to build.
    expect(store.size).toBe(1)
  })

  it('gives different CIDs for different bytes', async () => {
    const store = new MemoryBlockstore()
    const a = await store.put(new Uint8Array([1]))
    const b = await store.put(new Uint8Array([2]))
    expect(a.toString()).not.toBe(b.toString())
    expect(store.size).toBe(2)
  })

  it('returns undefined for an absent CID rather than throwing', async () => {
    const store = new MemoryBlockstore()
    const absent = await new MemoryBlockstore().put(new Uint8Array([7]))
    expect(await store.get(absent)).toBeUndefined()
    expect(await store.has(absent)).toBe(false)
  })

  it('handles empty blocks', async () => {
    const store = new MemoryBlockstore()
    const cid = await store.put(new Uint8Array())
    expect(await store.get(cid)).toEqual(new Uint8Array())
  })
})
