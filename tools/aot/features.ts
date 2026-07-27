/**
 * The feature set an artifact needs, read out of the artifact — AOT-03.
 *
 * `translationCid` in `@o2/aot` hashes a `features` list, and that list is part of
 * what names the translation. Hardcoding it would defeat the point twice over: the
 * key would stop changing when the toolchain started emitting a different feature
 * set, and a node deciding whether it can run the artifact would be consulting a
 * constant instead of the binary in front of it.
 *
 * So it is read from the `target_features` custom section that LLVM writes into
 * every module it produces. For `ghcr.io/yomaytk/elfconv:arm64` at
 * `TARGET=aarch64-wasi32` that is `+bulk-memory, +mutable-globals, +sign-ext` — but
 * this module does not know that, and must not: the moment it does, it stops being a
 * measurement.
 *
 * ## Prefixes
 *
 * The section is a list of `(prefix, name)` pairs. Per the WebAssembly tool
 * conventions the prefix byte is `+` (0x2B), `-` (0x2D) or `=` (0x3D):
 *
 * - `+` the object **uses** the feature — an engine without it cannot run this module
 * - `-` the object does **not** use the feature, and refuses to be linked with it
 * - `=` the object uses it **and** requires every other object to
 *
 * {@link FeatureSet.required} is `+` and `=` together, because both mean "this
 * module will not run on an engine lacking the feature", which is the only question
 * the fabric asks. `-` entries are kept in {@link FeatureSet.declared} rather than
 * dropped: they say something about the artifact, and an unexplained disappearance
 * of a `-simd128` would be worth noticing.
 *
 * ## Why a hand-written reader
 *
 * `wabt` is already a devDependency and would parse this. It also decodes the whole
 * module — 5.7 MB of it, for a 41-byte section — and pulls a 2 MB WASM build of the
 * C++ toolchain into a code path that runs on every lift. Walking the section table
 * is about eighty lines, needs no dependency, and cannot fail in a way that produces
 * a *plausible wrong answer*: every read is bounds-checked and returns a named
 * failure rather than a zero.
 *
 * This is not static analysis of the instruction stream. It reads one metadata
 * section that the producer wrote to be read; it makes no claim about what the code
 * does. The deleted admission gate is a different thing and stays deleted.
 *
 * Pure module: bytes in, features out.
 */

/** `\0asm` */
const MAGIC: readonly number[] = [0x00, 0x61, 0x73, 0x6d]

/** The only version any engine accepts today. */
const VERSION = 1

const CUSTOM_SECTION = 0

const SECTION_NAME = 'target_features'

export type FeatureUse =
  /** `+` — used; an engine without it cannot run the module. */
  | 'used'
  /** `-` — deliberately not used. */
  | 'disallowed'
  /** `=` — used, and required of every object linked with it. */
  | 'required'

export interface DeclaredFeature {
  readonly name: string
  readonly use: FeatureUse
}

export interface FeatureSet {
  /** Every pair in the section, in the order written. */
  readonly declared: readonly DeclaredFeature[]
  /**
   * Names an engine must support, sorted and de-duplicated.
   *
   * Sorted here rather than at the call site for the same reason `normaliseFeatures`
   * sorts: DAG-CBOR preserves array order, so an unsorted list would give two
   * machines different CIDs for one translation.
   */
  readonly required: readonly string[]
}

export type FeatureFailure =
  /** `found` holds the leading bytes that were there instead, up to four. */
  | { readonly kind: 'not-wasm'; readonly found: readonly number[] }
  | { readonly kind: 'unsupported-version'; readonly version: number }
  /** A section header or payload ran past the end of the buffer. */
  | { readonly kind: 'truncated'; readonly at: number; readonly needed: number }
  /** Well-formed WASM, but the producer wrote no `target_features`. */
  | { readonly kind: 'no-target-features-section' }
  | { readonly kind: 'unknown-prefix'; readonly byte: number; readonly index: number }
  | { readonly kind: 'malformed-section'; readonly detail: string }

export type FeatureScan =
  | { readonly ok: true; readonly features: FeatureSet }
  | { readonly ok: false; readonly reason: FeatureFailure }

/**
 * A cursor that reports running off the end instead of reading zeroes.
 *
 * Reading zero past the end is the dangerous variant: a truncated section would
 * decode as "zero features", and an artifact reported to need nothing is an artifact
 * every node will happily accept.
 */
class Cursor {
  #at = 0
  readonly #bytes: Uint8Array

  constructor(bytes: Uint8Array) {
    this.#bytes = bytes
  }

  get at(): number {
    return this.#at
  }

  get done(): boolean {
    return this.#at >= this.#bytes.length
  }

  seek(to: number): void {
    this.#at = to
  }

  byte(): number | undefined {
    const value = this.#bytes[this.#at]
    if (value === undefined) return undefined
    this.#at += 1
    return value
  }

  /** Unsigned LEB128, capped at five bytes — a u32 cannot need more. */
  u32(): number | undefined {
    let result = 0
    let shift = 0
    for (let read = 0; read < 5; read++) {
      const byte = this.byte()
      if (byte === undefined) return undefined
      result += (byte & 0x7f) * 2 ** shift
      if ((byte & 0x80) === 0) return result
      shift += 7
    }
    return undefined
  }

  bytes(length: number): Uint8Array | undefined {
    if (this.#at + length > this.#bytes.length) return undefined
    const slice = this.#bytes.subarray(this.#at, this.#at + length)
    this.#at += length
    return slice
  }
}

const DECODER = new TextDecoder('utf-8', { fatal: false })

function parseSection(payload: Uint8Array): FeatureScan {
  const cursor = new Cursor(payload)
  const count = cursor.u32()
  if (count === undefined) {
    return { ok: false, reason: { kind: 'malformed-section', detail: 'no feature count' } }
  }

  const declared: DeclaredFeature[] = []
  for (let index = 0; index < count; index++) {
    const prefix = cursor.byte()
    if (prefix === undefined) {
      return {
        ok: false,
        reason: {
          kind: 'malformed-section',
          detail: `section declares ${count} features and ended after ${index}`,
        },
      }
    }
    const use =
      prefix === 0x2b ? 'used' : prefix === 0x2d ? 'disallowed' : prefix === 0x3d ? 'required' : undefined
    if (use === undefined) return { ok: false, reason: { kind: 'unknown-prefix', byte: prefix, index } }

    const nameLength = cursor.u32()
    if (nameLength === undefined) {
      return { ok: false, reason: { kind: 'malformed-section', detail: `no name length at ${index}` } }
    }
    const nameBytes = cursor.bytes(nameLength)
    if (nameBytes === undefined) {
      return {
        ok: false,
        reason: { kind: 'malformed-section', detail: `name at ${index} runs past the section` },
      }
    }
    declared.push({ name: DECODER.decode(nameBytes), use })
  }

  const required = [
    ...new Set(declared.filter((f) => f.use !== 'disallowed').map((f) => f.name)),
  ].sort()

  return { ok: true, features: { declared, required } }
}

/**
 * Read `target_features` out of a WASM module.
 *
 * A module with no such section is a *failure*, not an empty feature set. LLVM always
 * writes one, so its absence means the bytes did not come from where they were
 * thought to — and "requires no features" is precisely the answer that would let the
 * wrong artifact through every check downstream.
 */
export function readTargetFeatures(wasm: Uint8Array): FeatureScan {
  for (const [index, expected] of MAGIC.entries()) {
    if (wasm[index] !== expected) {
      return { ok: false, reason: { kind: 'not-wasm', found: [...wasm.subarray(0, 4)] } }
    }
  }

  const cursor = new Cursor(wasm)
  cursor.seek(4)
  const versionBytes = cursor.bytes(4)
  if (versionBytes === undefined) {
    return { ok: false, reason: { kind: 'truncated', at: 4, needed: 4 } }
  }
  const version =
    (versionBytes[0] ?? 0) |
    ((versionBytes[1] ?? 0) << 8) |
    ((versionBytes[2] ?? 0) << 16) |
    ((versionBytes[3] ?? 0) << 24)
  if (version !== VERSION) return { ok: false, reason: { kind: 'unsupported-version', version } }

  while (!cursor.done) {
    const sectionStart = cursor.at
    const id = cursor.byte()
    if (id === undefined) return { ok: false, reason: { kind: 'truncated', at: sectionStart, needed: 1 } }
    const size = cursor.u32()
    if (size === undefined) {
      return { ok: false, reason: { kind: 'truncated', at: sectionStart, needed: 1 } }
    }
    const body = cursor.bytes(size)
    if (body === undefined) {
      return { ok: false, reason: { kind: 'truncated', at: sectionStart, needed: size } }
    }
    if (id !== CUSTOM_SECTION) continue

    const inner = new Cursor(body)
    const nameLength = inner.u32()
    if (nameLength === undefined) continue
    const nameBytes = inner.bytes(nameLength)
    if (nameBytes === undefined) continue
    if (DECODER.decode(nameBytes) !== SECTION_NAME) continue

    return parseSection(body.subarray(inner.at))
  }

  return { ok: false, reason: { kind: 'no-target-features-section' } }
}

export function describeFeatureFailure(reason: FeatureFailure): string {
  switch (reason.kind) {
    case 'not-wasm':
      return `not a WASM module — leading bytes were ${reason.found.map((b) => `0x${b.toString(16)}`).join(' ')}`
    case 'unsupported-version':
      return `WASM binary format version ${reason.version}, and only ${VERSION} exists`
    case 'truncated':
      return `the module ends at offset ${reason.at} with ${reason.needed} more bytes declared`
    case 'no-target-features-section':
      return 'no target_features section — every LLVM-produced module has one, so these bytes are not from where they were thought to be'
    case 'unknown-prefix':
      return `feature ${reason.index} carries prefix byte 0x${reason.byte.toString(16)}, which is not one of + - =`
    case 'malformed-section':
      return `target_features is malformed: ${reason.detail}`
  }
}
