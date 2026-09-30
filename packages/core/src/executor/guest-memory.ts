/**
 * How much linear memory a guest is allowed to ask for, read from the module before it
 * is instantiated — and the refusal when the answer is "no limit" or "more than this node
 * gives".
 *
 * A WebAssembly memory declared with no maximum can `memory.grow` until the engine says
 * no, which in a browser tab is the tab crashing and on a volunteer's machine is the
 * machine swapping. Nothing about the guest's cost or its answer is worth that. The
 * engine enforces a *declared* maximum exactly and identically on every host, so the
 * whole defence is to refuse any module whose declaration is missing or too large, before
 * the engine allocates anything. See
 * `.planning/consults/2026-09-29-what-a-browser-node-can-measure-about-a-guest.md` §3
 * item 1 for why this is checked here rather than written into the module at publish.
 *
 * ## Why the bytes are read by hand
 *
 * The JavaScript API does not say what a module's memory limits are.
 * `WebAssembly.Module.imports`/`exports` give a name and a kind and nothing else on every
 * engine that matters, and the type-reflection extension that adds `{minimum, maximum}`
 * is only on WebKit (`packages/demo/src/kernel.test.ts` records the disagreement). A
 * `Memory` object has no maximum getter either. So the import section (id 2) and the
 * memory section (id 5) are read here directly; both come before any code, so the read
 * stops early and costs next to nothing.
 *
 * Callers compile the module first. The bytes this reads have therefore already been
 * validated by the engine, so an entry it cannot understand is a feature it does not
 * know about, not a malformed module — and it is refused, never waved through.
 */

import { WASM_PAGE_BYTES } from './guest-meter.ts'

/**
 * The most linear memory a guest may declare, in 64 KiB pages: **4096 pages, 256 MiB.**
 *
 * The figure is the project's own, chosen before any code existed and not re-derived
 * here: `.planning/research/PITFALLS.md` ("Declare and enforce a memory budget per task
 * (start at 256 MB)", and its table row "Memory OOM on mobile … ~256 MB") and
 * `.planning/research/SUMMARY.md` §6 ("declare and enforce a 256 MB per-task memory
 * budget"). The evidence behind it is iOS Safari running out of memory well under the
 * 2 GiB wasm32 default, which is why Godot dropped its own ceiling to 256 MB.
 *
 * What it costs the guests that exist today: kernel and primes declare 4 pages, pi 1,
 * every hand-written WASI fixture 1 to 3. The directly compiled benchmark subject
 * (`tools/aot/fixtures/direct-subject.wasm`) declares 257. So the headroom is a factor of
 * a thousand over what ships and about 16 over the largest real guest in the tree.
 *
 * **Per node, like the output cap.** A node configured with a different cap reaches a
 * different verdict on the same content-addressed module; the refusal names both numbers
 * so that disagreement is diagnosable rather than mysterious.
 */
export const DEFAULT_MAX_MEMORY_PAGES = 4096

/** The largest page count a 32-bit memory can have — 4 GiB. A cap above it caps nothing. */
export const MAX_WASM32_PAGES = 65536

/** One memory the module either defines or imports, with the limits it declared. */
export interface DeclaredMemory {
  /** `defined` in the memory section, or `imported` — named by `module.name`. */
  readonly origin: 'defined' | 'imported'
  /** For an imported memory, `module.name` as the import section spells it. */
  readonly importName?: string
  readonly minimumPages: number
  /** `null` when the module declared no maximum at all. */
  readonly maximumPages: number | null
}

/**
 * Why a module was refused on its memory. Three kinds, each named the way an operator
 * would grep for it; `describeMemoryRefusal` is the prose.
 */
export type MemoryRefusal =
  | {
      readonly kind: 'memory-uncapped'
      readonly memory: DeclaredMemory
    }
  | {
      readonly kind: 'memory-over-cap'
      readonly memory: DeclaredMemory
      readonly capPages: number
    }
  | {
      /** A validated module whose memory declaration this reader does not understand. */
      readonly kind: 'memory-unreadable'
      readonly detail: string
    }

export type MemoryCapVerdict = { readonly ok: true } | { readonly ok: false; readonly refusal: MemoryRefusal }

/** Unsigned LEB128, up to 2^53 — past that no page count is meaningful anyway. */
class Reader {
  readonly bytes: Uint8Array
  /** The next byte to read. Public: a section's end is jumped to by assignment. */
  at: number
  constructor(bytes: Uint8Array, at: number) {
    this.bytes = bytes
    this.at = at
  }
  byte(): number {
    if (this.at >= this.bytes.length) throw new Error('module ends inside a section')
    return this.bytes[this.at++]!
  }
  u(): number {
    let result = 0
    let scale = 1
    for (;;) {
      const b = this.byte()
      result += (b & 0x7f) * scale
      if ((b & 0x80) === 0) return result
      scale *= 128
      if (scale > 2 ** 56) throw new Error('LEB128 value too long')
    }
  }
  /** A signed LEB128 whose value is not needed — a heap type index. */
  skipS(): void {
    while ((this.byte() & 0x80) !== 0) {
      /* continuation */
    }
  }
  name(): string {
    const length = this.u()
    const start = this.at
    this.at += length
    if (this.at > this.bytes.length) throw new Error('name runs past the end of the module')
    return new TextDecoder().decode(this.bytes.subarray(start, this.at))
  }
}

/**
 * Limits: a flags byte, then the minimum, then the maximum if flag bit 0 says there is
 * one. Bit 1 is `shared` (threads) and bit 2 is 64-bit addressing; both leave the
 * encoding of the numbers unchanged, so both are read the same way. Any other bit is a
 * proposal this reader does not know, and it refuses rather than guesses.
 */
function limits(r: Reader): { minimum: number; maximum: number | null } {
  const flags = r.byte()
  if ((flags & ~0x07) !== 0) throw new Error(`unknown limits flags 0x${flags.toString(16)}`)
  const minimum = r.u()
  const maximum = (flags & 0x01) !== 0 ? r.u() : null
  return { minimum, maximum }
}

/** A value or reference type; a typed reference (`0x63`/`0x64`) carries a heap type. */
function skipValType(r: Reader): void {
  const t = r.byte()
  if (t === 0x63 || t === 0x64) r.skipS()
}

/**
 * Every memory `bytes` declares, imported ones first — the order the engine numbers them.
 *
 * Throws on a declaration it cannot read; {@link checkMemoryCap} turns that into a
 * `memory-unreadable` refusal.
 */
export function readDeclaredMemories(bytes: Uint8Array): DeclaredMemory[] {
  if (bytes.length < 8) throw new Error('shorter than a WebAssembly header')
  const r = new Reader(bytes, 8)
  const found: DeclaredMemory[] = []
  while (r.at < bytes.length) {
    const id = r.byte()
    const size = r.u()
    const end = r.at + size
    if (end > bytes.length) throw new Error(`section ${id} runs past the end of the module`)
    if (id === 2) {
      const count = r.u()
      for (let i = 0; i < count; i++) {
        const module = r.name()
        const field = r.name()
        const kind = r.byte()
        if (kind === 0x00) {
          r.u() // function: a type index
        } else if (kind === 0x01) {
          skipValType(r) // table: a reference type, then limits
          limits(r)
        } else if (kind === 0x02) {
          const l = limits(r)
          found.push({
            origin: 'imported',
            importName: `${module}.${field}`,
            minimumPages: l.minimum,
            maximumPages: l.maximum,
          })
        } else if (kind === 0x03) {
          skipValType(r) // global: a value type, then mutability
          r.byte()
        } else if (kind === 0x04) {
          r.byte() // tag: an attribute, then a type index
          r.u()
        } else {
          throw new Error(`unknown import kind 0x${kind.toString(16)} for ${module}.${field}`)
        }
      }
    } else if (id === 5) {
      const count = r.u()
      for (let i = 0; i < count; i++) {
        const l = limits(r)
        found.push({ origin: 'defined', minimumPages: l.minimum, maximumPages: l.maximum })
      }
      // Nothing after the memory section can declare a memory.
      return found
    }
    r.at = end
  }
  return found
}

/**
 * Whether a node that allows at most `capPages` of memory may run `bytes`.
 *
 * Every memory the module defines **or imports** must declare a maximum, and that
 * maximum must be no larger than the cap. A module with no memory at all passes: it
 * cannot grow anything, and each executor already has its own, older answer for a guest
 * that exports no memory.
 *
 * An imported memory is held to the same rule because its declared maximum is the only
 * bound the guest states. Neither executor supplies a memory today — an importing module
 * fails to link — so this is what stands between a future host that does supply one and
 * a guest that asks for an unbounded one.
 */
export function checkMemoryCap(bytes: Uint8Array, capPages: number = DEFAULT_MAX_MEMORY_PAGES): MemoryCapVerdict {
  let memories: DeclaredMemory[]
  try {
    memories = readDeclaredMemories(bytes)
  } catch (cause) {
    return {
      ok: false,
      refusal: { kind: 'memory-unreadable', detail: cause instanceof Error ? cause.message : String(cause) },
    }
  }
  for (const memory of memories) {
    if (memory.maximumPages === null) return { ok: false, refusal: { kind: 'memory-uncapped', memory } }
    if (memory.maximumPages > capPages) {
      return { ok: false, refusal: { kind: 'memory-over-cap', memory, capPages } }
    }
  }
  return { ok: true }
}

function whichMemory(memory: DeclaredMemory): string {
  return memory.origin === 'imported' ? `the memory it imports as ${memory.importName ?? '?'}` : 'its memory'
}

function mib(pages: number): string {
  return `${(pages * WASM_PAGE_BYTES) / (1024 * 1024)} MiB`
}

/**
 * The refusal as one line. It starts with the kind, verbatim, so one grep finds the
 * refusal from either executor — the precedent `output-too-large` set.
 */
export function describeMemoryRefusal(refusal: MemoryRefusal): string {
  switch (refusal.kind) {
    case 'memory-uncapped':
      return (
        `memory-uncapped: the module declares ${whichMemory(refusal.memory)} with no maximum, so it could ` +
        `grow without bound; a guest must declare one (for example link with --max-memory)`
      )
    case 'memory-over-cap':
      return (
        `memory-over-cap: the module declares ${whichMemory(refusal.memory)} with a maximum of ` +
        `${refusal.memory.maximumPages} pages (${mib(refusal.memory.maximumPages ?? 0)}), above this node's ` +
        `cap of ${refusal.capPages} pages (${mib(refusal.capPages)})`
      )
    case 'memory-unreadable':
      return `memory-unreadable: the module's memory declaration could not be read: ${refusal.detail}`
  }
}

/**
 * A cap an executor can hold: a whole number of pages from 1 up to what a 32-bit memory
 * can address. Thrown at construction, as `WorkerExecutor` does for `maxThreads`, so a
 * bad value never reaches a task.
 */
export function assertMemoryCap(capPages: number): number {
  if (!Number.isInteger(capPages) || capPages < 1 || capPages > MAX_WASM32_PAGES) {
    throw new RangeError(`maxMemoryPages must be an integer from 1 to ${MAX_WASM32_PAGES}, got ${capPages}`)
  }
  return capPages
}
