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

// Hashing — pure JS, so it works outside a secure context. See hash.ts.
export { SHA256_CODE, sha256 } from './hash.ts'

// Canonical encoding — DET-05.
export { canonicalCid, decodeCanonical, encodeCanonical } from './canonical/encode.ts'
export type {
  CanonicalValue,
  EncodeError,
  EncodeResult,
  HashResult,
} from './canonical/encode.ts'

// Execution — DET-06.
export { MAX_PARTITIONS, TASK_ENTRYPOINT, WasmExecutor } from './executor/wasm.ts'
export type { WasmExecutorOptions } from './executor/wasm.ts'

// Redundant execution and verification — VER-01, VER-02, VER-05, VER-06.
export { commitmentDigest, executeVerified } from './job/verify.ts'
export type { Commitment, Receipt, Reveal, VerificationResult } from './job/verify.ts'

// Job submission — MR-01, DATA-01.
export { submitJob } from './job/submit.ts'
export type { JobResult, JobSpec, ShardResult, SubmitError, SubmitResult } from './job/submit.ts'

// Adapters.
export { MemoryBlockstore } from './blockstore/memory.ts'
export { MemoryNetwork, TransportError } from './transport/memory.ts'
export type { SendError } from './transport/memory.ts'
export { DutyCycleGovernor } from './governor.ts'
export type { DutyCycleOptions, Sleep } from './governor.ts'

// Sovereignty and placement — DATA-03, DATA-06, DATA-09.
export { planPlacement } from './sovereignty.ts'
export type {
  NodeDescriptor,
  OwnerId,
  Placement,
  PlacementPlan,
  PlacementRequest,
  Sovereignty,
} from './sovereignty.ts'

// Capability chains — AUTH-03, DET-03.
export { delegate, describeFailure, fromHex, toHex, verifyChain } from './capability.ts'
export type { Ability, ChainFailure, ChainResult, Delegation, PublicKeyHex, VerifyOptions } from './capability.ts'

// Signed artifact names — DATA-07, DATA-08.
export { describeResolveFailure, SignedNameResolver, signName } from './naming.ts'
export type { NameRecord, ResolveFailure, ResolveResult } from './naming.ts'
