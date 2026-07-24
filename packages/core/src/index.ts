/**
 * `@o2/core` — the portable kernel.
 *
 * Every export here is a pure function or a pure type. No platform imports, no
 * I/O, no libp2p. That constraint is what lets the identical kernel run in Node,
 * in a browser tab, and inside a Worker with no target-specific branches.
 */

export { Reader } from './wasm/reader.ts'
export type { ReadError, ReadResult } from './wasm/reader.ts'

export { HOST_ABI_ALLOWLIST, scanModule } from './admission/gate.ts'
export type { AdmissionResult, Rejection } from './admission/gate.ts'

export { canonicalCid, decodeCanonical, encodeCanonical } from './canonical/encode.ts'
export type {
  CanonicalValue,
  EncodeError,
  EncodeResult,
  HashResult,
} from './canonical/encode.ts'
