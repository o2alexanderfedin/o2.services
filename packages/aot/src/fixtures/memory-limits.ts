/**
 * A copy of a module with its one defined memory re-declared — test support only.
 *
 * Every hand-written WASI fixture declares `1 1`, and a real elfconv lift declares a
 * minimum and no maximum. The tests of the node's memory cap need the same program under
 * other declarations, and re-declaring the limits of a module that already runs isolates
 * the cap as the only thing that changed: the code, the imports and the exports are the
 * bytes that ran before.
 *
 * Rewrites the memory section (id 5) and nothing else. Refuses a module that has no
 * memory section or more than one memory, rather than guessing which one was meant.
 */

function uleb(n: number): number[] {
  const out: number[] = []
  let v = n
  do {
    let byte = v & 0x7f
    v = Math.floor(v / 128)
    if (v !== 0) byte |= 0x80
    out.push(byte)
  } while (v !== 0)
  return out
}

function readUleb(bytes: Uint8Array, at: number): { value: number; next: number } {
  let value = 0
  let scale = 1
  let p = at
  for (;;) {
    const b = bytes[p++]
    if (b === undefined) throw new Error('module ends inside a LEB128')
    value += (b & 0x7f) * scale
    if ((b & 0x80) === 0) return { value, next: p }
    scale *= 128
  }
}

/** `bytes` with its defined memory declared as `minimum` pages and `maximum` (or none). */
export function withMemoryLimits(
  bytes: Uint8Array,
  minimum: number,
  maximum: number | null,
): Uint8Array<ArrayBuffer> {
  let p = 8
  while (p < bytes.length) {
    const id = bytes[p]
    const size = readUleb(bytes, p + 1)
    const end = size.next + size.value
    if (id === 5) {
      const count = readUleb(bytes, size.next)
      if (count.value !== 1) throw new Error(`expected one defined memory, found ${count.value}`)
      const limits = maximum === null ? [0x00, ...uleb(minimum)] : [0x01, ...uleb(minimum), ...uleb(maximum)]
      const payload = [0x01, ...limits]
      const out = new Uint8Array(p + 1 + uleb(payload.length).length + payload.length + (bytes.length - end))
      out.set(bytes.subarray(0, p), 0)
      out.set([0x05, ...uleb(payload.length), ...payload], p)
      out.set(bytes.subarray(end), p + 1 + uleb(payload.length).length + payload.length)
      return out
    }
    p = end
  }
  throw new Error('module has no memory section')
}
