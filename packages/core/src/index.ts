/**
 * `@o2/core` — the portable kernel.
 *
 * Every export is a pure function, a class over injected ports, or a type. No
 * platform imports, no I/O, no libp2p. That constraint is what lets the identical
 * kernel run in Node, in a browser tab, and inside a Worker with no
 * target-specific branches — and it is what makes the later transport swap a
 * one-adapter change rather than a rewrite.
 */

// Ports — the kernel's entire contact surface with the outside world.
export type {
  Blockstore,
  ExecutionOutcome,
  Executor,
  Governor,
  Task,
  Transport,
} from './ports.ts'

// WASM binary reading.
export { Reader } from './wasm/reader.ts'
export type { ReadError, ReadResult } from './wasm/reader.ts'

// Admission gate — DET-01, DET-02.
export { HOST_ABI_ALLOWLIST, scanModule } from './admission/gate.ts'
export type { AdmissionResult, Rejection } from './admission/gate.ts'

// Canonical encoding — DET-05.
export { canonicalCid, decodeCanonical, encodeCanonical } from './canonical/encode.ts'
export type {
  CanonicalValue,
  EncodeError,
  EncodeResult,
  HashResult,
} from './canonical/encode.ts'

// Execution — DET-06.
export { MAX_PARTITIONS, TASK_ENTRYPOINT, WasmExecutor, publishModule } from './executor/wasm.ts'
export type { WasmExecutorOptions } from './executor/wasm.ts'

// Redundant execution and verification — VER-01, VER-02, VER-05, VER-06.
export { commitmentDigest, executeVerified } from './job/verify.ts'
export type { Commitment, Receipt, Reveal, VerificationResult } from './job/verify.ts'

// Job submission — MR-01, DATA-01.
export { submitJob } from './job/submit.ts'
export type { JobResult, JobSpec, ShardResult, SubmitError, SubmitResult } from './job/submit.ts'

// Adapters.
export { MemoryBlockstore } from './blockstore/memory.ts'
export { DutyCycleGovernor } from './governor.ts'
export type { DutyCycleOptions, Sleep } from './governor.ts'
