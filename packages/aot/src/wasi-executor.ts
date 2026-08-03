/**
 * Running a translated WASI command module on the fabric — AOT-04.
 *
 * A `aarch64-wasi32` artifact out of elfconv exports exactly `memory` and `_start`
 * and imports 23 functions from `wasi_snapshot_preview1`. The fabric's own guest ABI
 * (`../../core/src/executor/wasm.ts`) is four `o2.*` imports and a `run` export.
 * Those are not close enough to bridge with a shim inside the guest: the translated
 * binary was compiled from C against POSIX years before this project existed and
 * cannot be asked to change. So the *host* moves instead. This executor speaks WASI
 * and maps it onto the fabric's contract:
 *
 *   input block bytes  →  the guest's stdin
 *   the guest's stdout →  the declared output, decoded as DAG-CBOR
 *   shard index/count  →  argv
 *   exit status ≠ 0    →  a named task failure
 *
 * Everything else — content addressing, redundant execution, commit-reveal, the
 * comparison of two nodes' bytes — is unchanged, which is the point of AOT-04: a
 * translated artifact travels the same admission and verification path as a
 * source-compiled one. `WasiExecutor` and `WasmExecutor` both satisfy `Executor`, so
 * `submitJob` cannot tell them apart.
 *
 * ## Why stdio, and why argv
 *
 * stdin/stdout is the one interface every C program compiled for WASI already has.
 * A bespoke `o2_*` import would require relinking the guest, which for a *translated*
 * binary means having the source — the exact thing binary translation exists to not
 * need. Same for the shard: `o2.partition()` cannot reach a program whose entry point
 * is `main(argc, argv)`, but argv can, and does, with no cooperation from the guest
 * beyond reading its own arguments.
 *
 * ## The WASI environment is pinned, and here is everything that had to be pinned
 *
 * `@bjorn3/browser_wasi_shim` is used in Node as well as the browser, deliberately,
 * and **not** `node:wasi`. Two node agents running the same artifact must see the
 * same host semantics; a Node-only WASI implementation beside a browser one is a
 * divergence bug by construction, and it would surface as two honest nodes being
 * reported as disagreeing — the most expensive kind of false positive this fabric
 * can produce.
 *
 * But the shim, sensibly for its own purposes, is a *faithful* WASI. Faithful means
 * nondeterministic. Every one of these had to be replaced ({@link PINNED_WASI_FUNCTIONS}):
 *
 * | Function | What the shim does | What it does here, and why |
 * |---|---|---|
 * | `clock_time_get` | `new Date().getTime()`, `performance.now()` | Returns {@link FIXED_REALTIME_NANOS} for `CLOCKID_REALTIME` and {@link FIXED_MONOTONIC_NANOS} for everything else, on every call. Wall time is the single most likely reason two honest nodes would produce different bytes. |
 * | `clock_res_get` | 1 ms / 5 µs, `ERRNO_NOSYS` for the CPU-time clocks | 1 ns for every clock id the pinned `clock_time_get` answers. Not a fidelity claim — a consistency one: refusing to state a resolution for a clock that *does* return a value invites a guest to branch on which pair it got. |
 * | `random_get` | `crypto.getRandomValues`, else `Math.random()` | A stream derived from the task by {@link taskSeed}. Host entropy reaching a guest whose output is compared across nodes guarantees disagreement. |
 * | `poll_oneoff` | busy-waits on `performance.now()` / `new Date()`, read directly in its own JS rather than through the imported clock | `ERRNO_NOTSUP`, after writing `0` to `nevents`. See below — the reason recorded here was wrong for two years' worth of readers and is worth stating carefully. |
 * | `sched_yield` | returns `undefined` where the ABI wants an errno | `ERRNO_SUCCESS`. Right by accident before — JS `undefined` coerces to i32 `0` at the boundary — and now right on purpose. |
 * | `proc_raise` | `throw "raised signal " + sig` (a bare string) | `ERRNO_NOTSUP`. A thrown non-`Error` would surface as a trap whose message depends on how the host stringifies it. |
 * | `sock_accept`, `sock_recv`, `sock_send`, `sock_shutdown` | `throw "sockets not supported"` | `ERRNO_NOTSUP`. Same reason, plus: no sockets is a standing requirement, and a refusal the guest can read beats an exception it cannot. |
 *
 * ### `poll_oneoff`, and the reason that used to be written here
 *
 * This file used to say the shim's busy-wait *never terminates under a frozen clock*,
 * and called that a hang rather than a determinism problem. That is false, and it is
 * false for an instructive reason: **the shim never consults the imported clock.** Its
 * loop is `while (endTime > getNow()) {}` where `getNow` is
 * `() => BigInt(Math.round(performance.now() * 1e6))` or
 * `() => BigInt(new Date().getTime()) * 1000000n` — host JS, closed over inside
 * `wasiImport`, never routed through `clock_time_get`. Pinning the clock the *guest*
 * can read cannot freeze a clock the *host* reads. Measured: a relative 20 ms
 * monotonic subscription returns `ERRNO_SUCCESS` after 20.26 ms of real time. It
 * terminates every time.
 *
 * The true reasons it cannot stay:
 *
 *   - **It is the one host-observable clock left.** Every other way a guest can learn
 *     the time is pinned; this one hands back real elapsed wall time, and a guest that
 *     polls with a relative timeout and then reads `clock_time_get` is looking at an
 *     internally inconsistent world — it waited, and no time passed.
 *   - **Its answer depends on process history.** With
 *     `SUBCLOCKFLAGS_SUBSCRIPTION_CLOCK_ABSTIME` and `CLOCKID_MONOTONIC` the deadline
 *     is compared against `performance.now()`, whose origin is *this process's start*.
 *     A guest that computed an absolute deadline from the pinned monotonic clock (0)
 *     gets a different answer depending on how many tasks ran before it. Measured, in
 *     one process, the identical call: 22.36 ms the first time, 0.02 ms the second.
 *     Two honest nodes cannot be expected to agree on that, and neither can one node
 *     with itself.
 *   - **It spends the volunteer's CPU, not the guest's.** The wait is a tight JS loop
 *     with no yield, so a guest asking to sleep ten seconds pins a core for ten
 *     seconds. The only thing that stops it is the node's Worker deadline, which
 *     re-dispatches the shard — paying for the same work twice.
 *
 * There is no other event source here (no sockets, no files, stdin already resident),
 * so a named refusal is the only outcome that both terminates and is the same
 * everywhere.
 *
 * Separately, and regardless of the above: the shim's `poll_oneoff` is declared with
 * **three** parameters where the ABI passes four. It never receives `nevents_ptr`, so
 * it cannot write it, and the guest goes on to read whatever was in that word — a
 * sentinel written there before the call survives it intact, which is how this was
 * confirmed. The replacement writes `0` before returning `ERRNO_NOTSUP`. WASI leaves
 * out-parameters unspecified on error and a guest reading one is misbehaving, but
 * "misbehaving deterministically" is the property this executor exists to provide, and
 * uninitialised memory is the opposite of it.
 *
 * Three more sources are pinned structurally rather than by replacing a function:
 *
 *   - **Inode numbers.** The shim's `File`/`OpenFile`/`ConsoleStdout` take their `ino`
 *     from `Inode.issue_ino()`, a module-global counter. A guest calling
 *     `fd_filestat_get` on stdin would therefore see a number that depends on how many
 *     other tasks this *process* had run first. The three fds here are local classes
 *     with hardcoded inodes and all-zero timestamps.
 *   - **The filesystem.** `fds` is exactly `[stdin, stdout, stderr]` and there are no
 *     preopens, so `fd_prestat_get(3)` is `ERRNO_BADF` and `path_open` on a stdio fd is
 *     `ERRNO_NOTDIR`. There is nothing to open, so there is nothing whose contents
 *     could differ between two nodes.
 *   - **The environment.** {@link WASI_ENV} and nothing else. Not one variable of the
 *     host process reaches the guest. The three that are supplied pin locale and time
 *     zone, which is where a libc that formats a number or a date would otherwise
 *     diverge between a machine in Reykjavík and one in Kolkata.
 *
 * There is deliberately **no import allow-list**. The host offers what it offers;
 * `WebAssembly.instantiate` refuses any import that is not among them and names the
 * missing one in the `TypeError`. That is the same sandbox `WasmExecutor` relies on,
 * enforced by the runtime rather than by a scanner someone has to maintain.
 *
 * And there is no static determinism analysis: nothing here inspects the guest's
 * instruction stream. Divergence is detected downstream by running the task twice
 * and comparing bytes.
 *
 * ## What is still not deterministic, stated plainly
 *
 * A frozen clock means a guest that spins waiting for time to advance never finishes.
 * That is a **liveness** failure, not a correctness one, and it is already covered:
 * a task runs in a Worker that the node terminates on a wall-clock deadline, and an
 * abandoned shard re-dispatches. The trade is deliberate — a clock that advanced
 * would rescue such a guest and break every honest one.
 *
 * Two further things this layer cannot fix, recorded so they are not mistaken for
 * solved. Cross-machine reproducibility of elfconv's *translation* is unestablished
 * (a pointer-keyed `unordered_map` in its register-promotion pass shapes emitted IR);
 * that is `cache-key.ts`'s problem, not this file's. And elfconv prints
 * `[Bug] Unsupported instruction…` on **stdout**, which here means straight into the
 * declared output — such an artifact fails `not-dag-cbor` rather than passing with a
 * corrupt result, which is the right outcome but is a symptom, not a diagnosis.
 *
 * Portable: no platform imports. Runs in Node, a browser, and a Worker unchanged —
 * which is the whole reason the pure-JS shim was chosen over `node:wasi`.
 */

import { Fd, WASI, wasi as wasiDefs } from '@bjorn3/browser_wasi_shim'
import { sha256 } from '@noble/hashes/sha2.js'
import { decodeCanonical } from '@o2/core'
import type { Blockstore, CanonicalValue, ExecutionOutcome, Executor, Task } from '@o2/core'

/** The one import namespace a WASI preview1 command module may use. */
export const WASI_NAMESPACE = 'wasi_snapshot_preview1'

/** The export a WASI *command* module must provide. Reactors export `_initialize`. */
export const WASI_ENTRYPOINT = '_start'

/**
 * `argv[0]`, which POSIX says is the program name.
 *
 * A fixed string rather than the module CID: argv is part of what the guest may hash
 * into its own output, so anything varying that is not the shard would make two
 * *shards of the same job* differ for a reason unrelated to the work.
 */
export const WASI_ARGV0 = 'o2-task'

/**
 * The clock every node reports: 2020-01-01T00:00:00Z, in nanoseconds.
 *
 * Non-zero on purpose. The obvious choice is the epoch itself, and it is a trap: a
 * great deal of C treats a zero `time_t` as "unset" and takes a different branch,
 * so a zero clock would exercise paths in a translated binary that no real run ever
 * takes. A plausible, round, past instant does not.
 */
export const FIXED_REALTIME_NANOS = 1577836800000000000n

/**
 * The monotonic clock, which does not move.
 *
 * Starting at zero rather than at the realtime value keeps the two distinguishable
 * in a dump, and matches what a monotonic clock means: elapsed time since an
 * unspecified origin. Elapsed time here is always zero, so every interval a guest
 * measures is zero on every node.
 */
export const FIXED_MONOTONIC_NANOS = 0n

/**
 * The guest's entire environment.
 *
 * `LANG`/`LC_ALL` pin locale-dependent formatting and collation; `TZ` pins anything
 * that renders {@link FIXED_REALTIME_NANOS} as a local date. Nothing from the host
 * process is forwarded, and there is no option to forward it — an executor with a
 * "pass through my environment" switch is an executor whose determinism depends on
 * how it was configured.
 */
export const WASI_ENV: readonly string[] = ['LANG=C', 'LC_ALL=C', 'TZ=UTC']

/**
 * How much stderr is kept for a diagnostic, and it is the **first** this many bytes.
 *
 * Bounded because a translated binary that is failing tends to fail in a loop. Head
 * rather than tail on purpose: the first message is the diagnosis and everything after
 * it is the cascade, so a ring buffer would reliably keep the least useful end. What a
 * head must not do is pretend nothing was lost — see {@link WasiFailure}'s
 * `stderrDropped`, which every failure description states.
 *
 * The first version of this reused the stdout sink, which refuses a write that would
 * exceed its cap and keeps *nothing* of it. On stdout that is correct and deliberate
 * (see {@link CappedSink}). On stderr it produced two bugs at once: a guest that wrote
 * its whole message in one `fprintf` larger than 4 KiB had the entire diagnostic
 * discarded and the trap was reported with no explanation at all, and — worse — the
 * `ERRNO_NOSPC` it got back is *this node's* storage policy reaching the guest's
 * control flow. A guest that checks the return of a diagnostic write and exits
 * differently would then behave differently on a node with a different cap. Diagnostic
 * writes therefore always succeed and always report the full length; retaining the
 * bytes is the host's business and none of the guest's.
 */
export const MAX_STDERR_BYTES = 4096

/**
 * Every member of the shim's WASI surface this executor replaces.
 *
 * Exported so a test can assert two things that would otherwise rot silently: that
 * each name still exists in the shim (a rename in an upgrade would leave the
 * original wired up and nothing would say so), and that each is genuinely a
 * different function object from the shim's. See the table in the module comment for
 * why each one is here.
 */
export const PINNED_WASI_FUNCTIONS: readonly string[] = [
  'clock_res_get',
  'clock_time_get',
  'poll_oneoff',
  'proc_raise',
  'random_get',
  'sched_yield',
  'sock_accept',
  'sock_recv',
  'sock_send',
  'sock_shutdown',
]

/** Arguments handed to the guest: program name, shard index, shard count. */
export function shardArgv(partitionIndex: number, partitionCount: number): string[] {
  // Decimal ASCII, deliberately. The shim sizes the argv buffer with `String.length`
  // (UTF-16 units) but fills it with UTF-8 bytes, so a non-ASCII argument would make
  // it under-report the buffer size and write past what the guest allocated. Digits
  // and a hyphen cannot reach that bug.
  return [WASI_ARGV0, String(partitionIndex), String(partitionCount)]
}

/**
 * The seed the guest's entropy is derived from.
 *
 * Every input to the result is in it and nothing else is: change the module, the
 * input, or the shard and the stream changes; run the same shard on another
 * continent and it does not. The `o2/wasi/v1` prefix is domain separation — the same
 * digest must not be reachable from any other use of `sha256` in this codebase.
 *
 * **This is not a source of secrets.** Every byte of it is derivable by anyone
 * holding the task, which is every node offered the task. It exists so that a guest
 * which asks for entropy gets an answer instead of an error, and so that two nodes
 * get the *same* answer. A guest using it to generate a key would be generating a
 * public one.
 */
export function taskSeed(task: Task): Uint8Array {
  const label =
    `o2/wasi/v1|${task.moduleCid.toString()}|${task.inputCid.toString()}` +
    `|${task.partitionIndex}|${task.partitionCount}`
  return sha256(new TextEncoder().encode(label))
}

/** Fills a buffer with the next bytes of a deterministic stream. */
export type RandomStream = (out: Uint8Array) => void

/**
 * sha256 in counter mode over the seed.
 *
 * Not a CSPRNG and not claimed to be one — see {@link taskSeed}. What it must be is
 * *identical on every runtime*, which rules out anything the platform provides and
 * is why `@noble/hashes` is used here as it is everywhere else in this codebase
 * (pure JS, no `crypto.subtle`, so a LAN origin that is not a secure context still
 * works).
 */
export function seededStream(seed: Uint8Array): RandomStream {
  let counter = 0
  let block = new Uint8Array(0)
  let offset = 0
  return (out: Uint8Array): void => {
    for (let i = 0; i < out.length; i++) {
      if (offset >= block.length) {
        const input = new Uint8Array(seed.length + 4)
        input.set(seed, 0)
        new DataView(input.buffer).setUint32(seed.length, counter, true)
        counter += 1
        block = sha256(input)
        offset = 0
      }
      out[i] = block[offset] ?? 0
      offset += 1
    }
  }
}

/** A host function in the WASI import namespace. */
export type WasiHostFunction = (...args: never[]) => unknown

/** The `wasi_snapshot_preview1` namespace as handed to `WebAssembly.instantiate`. */
export type WasiHostFunctions = Record<string, WasiHostFunction>

/**
 * Where the guest's linear memory lives, once it exists.
 *
 * Instantiation and memory discovery are one step apart and the host functions close
 * over the result of the second, so the reference is a box rather than a value — the
 * same shape `WasmExecutor` uses, and for the same reason: a `let` assigned inside a
 * host callback narrows to `never` after a null check.
 */
interface MemoryRef {
  memory: WebAssembly.Memory | null
}

/**
 * The shim's surface with every nondeterministic member replaced.
 *
 * Returns a new object; the shim's `wasiImport` is left alone, so a reader can
 * diff the two and a test can prove the replacement happened. Exported for exactly
 * that test.
 */
export function pinnedWasiImports(
  base: WasiHostFunctions,
  memoryRef: MemoryRef,
  random: RandomStream,
): WasiHostFunctions {
  const bytesOf = (): Uint8Array | null => {
    const memory = memoryRef.memory
    return memory === null ? null : new Uint8Array(memory.buffer)
  }

  const refuse = (): number => wasiDefs.ERRNO_NOTSUP

  return {
    ...base,

    clock_time_get: (id: number, _precision: bigint, timePtr: number): number => {
      const memory = memoryRef.memory
      if (memory === null) return wasiDefs.ERRNO_INVAL
      const view = new DataView(memory.buffer)
      // Bounds-checked rather than left to throw: a `RangeError` out of a host
      // function unwinds the guest as an opaque trap, and "your pointer was out of
      // range" is a thing the guest can be told in its own vocabulary.
      if (timePtr < 0 || timePtr + 8 > view.byteLength) return wasiDefs.ERRNO_FAULT
      view.setBigUint64(
        timePtr,
        id === wasiDefs.CLOCKID_REALTIME ? FIXED_REALTIME_NANOS : FIXED_MONOTONIC_NANOS,
        true,
      )
      return wasiDefs.ERRNO_SUCCESS
    },

    clock_res_get: (_id: number, resPtr: number): number => {
      const memory = memoryRef.memory
      if (memory === null) return wasiDefs.ERRNO_INVAL
      const view = new DataView(memory.buffer)
      if (resPtr < 0 || resPtr + 8 > view.byteLength) return wasiDefs.ERRNO_FAULT
      view.setBigUint64(resPtr, 1n, true)
      return wasiDefs.ERRNO_SUCCESS
    },

    random_get: (buf: number, len: number): number => {
      const bytes = bytesOf()
      if (bytes === null) return wasiDefs.ERRNO_INVAL
      if (buf < 0 || len < 0 || buf + len > bytes.length) return wasiDefs.ERRNO_FAULT
      random(bytes.subarray(buf, buf + len))
      return wasiDefs.ERRNO_SUCCESS
    },

    /**
     * Refused, but not before the guest is left a defined `nevents`.
     *
     * The shim takes three parameters here and the ABI passes four, so it never sees
     * this pointer and never writes it; a guest that reads `nevents` after the call
     * reads whatever happened to be in that word. Writing zero first costs one store
     * and removes a source of divergence that no test downstream could ever attribute
     * to its cause. The errno is still `ERRNO_NOTSUP` — see the module comment for why
     * this function cannot be allowed to do its job.
     */
    poll_oneoff: (_in: number, _out: number, _nsubscriptions: number, events: number): number => {
      const memory = memoryRef.memory
      if (memory === null) return wasiDefs.ERRNO_INVAL
      const view = new DataView(memory.buffer)
      if (events < 0 || events + 4 > view.byteLength) return wasiDefs.ERRNO_FAULT
      view.setUint32(events, 0, true)
      return wasiDefs.ERRNO_NOTSUP
    },

    proc_raise: refuse,
    sock_accept: refuse,
    sock_recv: refuse,
    sock_send: refuse,
    sock_shutdown: refuse,

    sched_yield: (): number => wasiDefs.ERRNO_SUCCESS,
  }
}

// ---- the three file descriptors, and nothing else ----------------------------

/** stdin, stdout, stderr. Fixed so `fd_filestat_get` cannot leak process history. */
const STDIN_INO = 1n
const STDOUT_INO = 2n
const STDERR_INO = 3n

/**
 * The shim publishes its `RIGHTS_*` constants as JS numbers, but `Fdstat` writes
 * them with `setBigUint64`. Passing the constant straight through throws
 * `Cannot convert 2 to a BigInt` — from inside a host function, i.e. as an opaque
 * trap during `_start`. Converted once, here, rather than at four call sites.
 */
type Fdstat = InstanceType<typeof wasiDefs.Fdstat>
type Filestat = InstanceType<typeof wasiDefs.Filestat>

function characterDevice(rights: number): Fdstat {
  const fdstat = new wasiDefs.Fdstat(wasiDefs.FILETYPE_CHARACTER_DEVICE, 0)
  // A pipe, not a file: no seeking, no size, no append. Rights are stated rather
  // than left at the shim's default of zero, because a libc that checks them before
  // reading would otherwise conclude stdin is unreadable.
  fdstat.fs_rights_base = BigInt(rights)
  fdstat.fs_rights_inherited = 0n
  return fdstat
}

/**
 * The input block, presented as stdin.
 *
 * Short reads are honest: `fd_read` returns what is left and then zero, which is EOF.
 * A guest that assumes one read drains stdin gets a truncated input here exactly as
 * it would against a real pipe, and finds out in a test rather than in production.
 */
class TaskStdin extends Fd {
  readonly #bytes: Uint8Array
  #cursor = 0

  constructor(bytes: Uint8Array) {
    super()
    this.#bytes = bytes
  }

  /** How much of the input the guest actually read. Diagnostic only. */
  get consumed(): number {
    return this.#cursor
  }

  override fd_fdstat_get(): { ret: number; fdstat: Fdstat | null } {
    return { ret: wasiDefs.ERRNO_SUCCESS, fdstat: characterDevice(wasiDefs.RIGHTS_FD_READ) }
  }

  override fd_filestat_get(): { ret: number; filestat: Filestat | null } {
    return {
      ret: wasiDefs.ERRNO_SUCCESS,
      filestat: new wasiDefs.Filestat(
        STDIN_INO,
        wasiDefs.FILETYPE_CHARACTER_DEVICE,
        BigInt(this.#bytes.length),
      ),
    }
  }

  override fd_read(size: number): { ret: number; data: Uint8Array } {
    const n = Math.max(0, Math.min(size, this.#bytes.length - this.#cursor))
    const data = this.#bytes.subarray(this.#cursor, this.#cursor + n)
    this.#cursor += n
    return { ret: wasiDefs.ERRNO_SUCCESS, data }
  }
}

/**
 * stdout: a write-only fd that keeps what it is given, up to a cap.
 *
 * Past the cap it returns `ERRNO_NOSPC` and keeps nothing, rather than truncating
 * silently. Truncating would hand the fabric a *shorter* output that still decoded —
 * a plausible wrong answer, which is the worst thing this codebase can produce.
 *
 * That is the right policy for a *result* and the wrong one for a *diagnostic*, which
 * is why stderr does not use this class. See {@link DiagnosticSink}.
 */
class CappedSink extends Fd {
  readonly #limit: number
  readonly #ino: bigint
  readonly #chunks: Uint8Array[] = []
  #length = 0
  #overflowed = false

  constructor(limit: number, ino: bigint) {
    super()
    this.#limit = limit
    this.#ino = ino
  }

  get length(): number {
    return this.#length
  }

  /** True once a write was refused for exceeding the cap. Never returns to false. */
  get overflowed(): boolean {
    return this.#overflowed
  }

  override fd_fdstat_get(): { ret: number; fdstat: Fdstat | null } {
    return { ret: wasiDefs.ERRNO_SUCCESS, fdstat: characterDevice(wasiDefs.RIGHTS_FD_WRITE) }
  }

  override fd_filestat_get(): { ret: number; filestat: Filestat | null } {
    return {
      ret: wasiDefs.ERRNO_SUCCESS,
      filestat: new wasiDefs.Filestat(this.#ino, wasiDefs.FILETYPE_CHARACTER_DEVICE, 0n),
    }
  }

  override fd_write(data: Uint8Array): { ret: number; nwritten: number } {
    if (this.#length + data.length > this.#limit) {
      this.#overflowed = true
      return { ret: wasiDefs.ERRNO_NOSPC, nwritten: 0 }
    }
    // No copy: the shim's `fd_write` already hands over a `slice` of guest memory,
    // so this array never aliases a buffer the guest can still mutate.
    this.#chunks.push(data)
    this.#length += data.length
    return { ret: wasiDefs.ERRNO_SUCCESS, nwritten: data.length }
  }

  bytes(): Uint8Array<ArrayBuffer> {
    const out = new Uint8Array(this.#length)
    let at = 0
    for (const chunk of this.#chunks) {
      out.set(chunk, at)
      at += chunk.length
    }
    return out
  }

  /** Lossy on purpose: a diagnostic must never throw on a stray byte. */
  text(): string {
    return new TextDecoder('utf-8', { fatal: false }).decode(this.bytes())
  }
}

/**
 * stderr: every write succeeds; the first {@link MAX_STDERR_BYTES} are kept and the
 * rest are counted.
 *
 * The two halves of that sentence are both load-bearing, and both were wrong when
 * stderr shared {@link CappedSink}:
 *
 *   - **Every write succeeds.** A cap is host policy. If it can come back to the guest
 *     as an errno, two nodes with different caps can make the same program take
 *     different branches, and a `nwritten` short of the data would send a libc into a
 *     retry loop that a full sink never lets finish. So the acknowledgement is always
 *     the whole length, whatever was retained.
 *   - **What is dropped is counted.** A diagnostic that silently loses the interesting
 *     part is worse than no diagnostic, because the reader stops looking. The count
 *     travels with the failure and is rendered in its description.
 */
class DiagnosticSink extends Fd {
  readonly #limit: number
  readonly #ino: bigint
  readonly #chunks: Uint8Array[] = []
  #kept = 0
  #dropped = 0

  constructor(limit: number, ino: bigint) {
    super()
    this.#limit = limit
    this.#ino = ino
  }

  /** Bytes retained, never more than the cap. */
  get length(): number {
    return this.#kept
  }

  /** Bytes the guest wrote that the cap refused to retain. Zero if none. */
  get dropped(): number {
    return this.#dropped
  }

  override fd_fdstat_get(): { ret: number; fdstat: Fdstat | null } {
    return { ret: wasiDefs.ERRNO_SUCCESS, fdstat: characterDevice(wasiDefs.RIGHTS_FD_WRITE) }
  }

  override fd_filestat_get(): { ret: number; filestat: Filestat | null } {
    return {
      ret: wasiDefs.ERRNO_SUCCESS,
      filestat: new wasiDefs.Filestat(this.#ino, wasiDefs.FILETYPE_CHARACTER_DEVICE, 0n),
    }
  }

  override fd_write(data: Uint8Array): { ret: number; nwritten: number } {
    // A write straddling the cap is split rather than dropped whole: the sentence that
    // says why the guest failed is usually the one that crosses it.
    const room = Math.max(0, this.#limit - this.#kept)
    const keep = Math.min(room, data.length)
    if (keep > 0) {
      this.#chunks.push(data.subarray(0, keep))
      this.#kept += keep
    }
    this.#dropped += data.length - keep
    return { ret: wasiDefs.ERRNO_SUCCESS, nwritten: data.length }
  }

  /** Lossy on purpose: a diagnostic must never throw on a stray byte. */
  text(): string {
    const out = new Uint8Array(this.#kept)
    let at = 0
    for (const chunk of this.#chunks) {
      out.set(chunk, at)
      at += chunk.length
    }
    return new TextDecoder('utf-8', { fatal: false }).decode(out)
  }
}

// ---- outcomes ----------------------------------------------------------------

/**
 * Every way a WASI task can fail, named.
 *
 * `Executor` can only return a string, so this union exists beside it: a test that
 * asserts on `kind` keeps working when the prose is reworded, and a caller that wants
 * to branch on *which* failure can, which a string does not allow. The same split
 * `cache-key.ts` makes between `KeyFailure` and `describeKeyFailure`.
 */
export type WasiFailure =
  | { readonly kind: 'module-missing'; readonly cid: string }
  | { readonly kind: 'input-missing'; readonly cid: string }
  | { readonly kind: 'invalid-shard'; readonly index: number; readonly count: number }
  | { readonly kind: 'instantiation-failed'; readonly detail: string }
  | { readonly kind: 'missing-export'; readonly name: string }
  | {
      readonly kind: 'trap'
      readonly detail: string
      /** The retained head of stderr — see {@link MAX_STDERR_BYTES}. */
      readonly stderr: string
      /** Bytes of stderr the cap discarded. Stated even when it is zero. */
      readonly stderrDropped: number
    }
  | {
      readonly kind: 'nonzero-exit'
      readonly code: number
      readonly stdoutBytes: number
      readonly stderr: string
      readonly stderrDropped: number
    }
  | { readonly kind: 'output-too-large'; readonly limit: number }
  | { readonly kind: 'no-output' }
  | { readonly kind: 'not-dag-cbor'; readonly detail: string }

export type WasiRunOutcome =
  | {
      readonly ok: true
      readonly value: CanonicalValue
      /** Size of the input block, i.e. what stdin was able to offer. */
      readonly inputBytes: number
      readonly stdoutBytes: number
      /** How much of stdin the guest actually read. Not part of `fuelUsed`; see below. */
      readonly stdinConsumed: number
    }
  | { readonly ok: false; readonly failure: WasiFailure }

export function describeWasiFailure(failure: WasiFailure): string {
  switch (failure.kind) {
    case 'module-missing':
      return `module block missing: ${failure.cid}`
    case 'input-missing':
      return `input block missing: ${failure.cid}`
    case 'invalid-shard':
      return `shard ${failure.index} of ${failure.count} is not a shard — argv would state a lie`
    case 'instantiation-failed':
      return `instantiation failed: ${failure.detail}`
    case 'missing-export':
      return `module exports no "${failure.name}" — not a WASI command module`
    case 'trap':
      return (
        `trap during execution: ${failure.detail}` +
        stderrTail(failure.stderr, failure.stderrDropped)
      )
    case 'nonzero-exit':
      return (
        `guest exited with status ${failure.code}` +
        ` (${failure.stdoutBytes} bytes of output discarded)` +
        stderrTail(failure.stderr, failure.stderrDropped)
      )
    case 'output-too-large':
      return `output exceeded ${failure.limit} bytes`
    case 'no-output':
      return 'guest wrote nothing to stdout'
    case 'not-dag-cbor':
      return `output is not valid DAG-CBOR: ${failure.detail}`
  }
}

/**
 * The stderr fragment appended to a failure description.
 *
 * Silence is reported as silence, but *truncated* silence is not: a description that
 * said nothing about a guest which wrote thousands of bytes would be a claim about the
 * guest, and the claim would be false. Whatever else changes here, the fact of
 * truncation has to reach the reader, because nothing else in the system will tell
 * them.
 */
function stderrTail(stderr: string, dropped: number): string {
  const trimmed = stderr.trim()
  const lost = dropped === 0 ? '' : ` [+${dropped} bytes dropped at the ${MAX_STDERR_BYTES}-byte cap]`
  if (trimmed === '') return dropped === 0 ? '' : ` — stderr:${lost}`
  return ` — stderr: ${trimmed}${lost}`
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

/**
 * A `() => unknown` narrowed by a guard rather than asserted.
 *
 * `WebAssembly.ExportValue` narrows to `Function` under `typeof`, and `Function` is
 * not callable with a known signature. A guard states the extra claim — that this
 * export takes no arguments — in one place a reader can find, instead of an `as`
 * scattered at the call site.
 */
function isNiladicExport(value: WebAssembly.ExportValue | undefined): value is () => unknown {
  return typeof value === 'function'
}

// ---- the executor ------------------------------------------------------------

export interface WasiExecutorOptions {
  readonly nodeId: string
  readonly blockstore: Blockstore
  /** Cap on stdout, to bound a misbehaving guest. Default 1 MiB, as `WasmExecutor`. */
  readonly maxOutputBytes?: number
}

export class WasiExecutor implements Executor {
  readonly nodeId: string
  readonly #blockstore: Blockstore
  readonly #maxOutputBytes: number

  constructor(options: WasiExecutorOptions) {
    this.nodeId = options.nodeId
    this.#blockstore = options.blockstore
    this.#maxOutputBytes = options.maxOutputBytes ?? 1024 * 1024
  }

  async execute(task: Task): Promise<ExecutionOutcome> {
    const outcome = await this.run(task)
    if (!outcome.ok) return { ok: false, reason: describeWasiFailure(outcome.failure) }
    // Same definition as `WasmExecutor`: the *whole* input block plus the produced
    // output. Deliberately not `stdinConsumed`, so a WASI shard and a native shard
    // over the same block report comparable fuel — otherwise a guest that skipped
    // its input would look cheap when the cost of delivering the block was paid
    // either way. Fuel sits outside the compared digest (VER-05) precisely so a cost
    // metric can never make honest nodes disagree.
    return {
      ok: true,
      output: outcome.value,
      fuelUsed: outcome.inputBytes + outcome.stdoutBytes,
      // Unsigned by construction, for `WasmExecutor`'s reason and with no exception for
      // the lifted-binary path: this class holds a blockstore and a node id, never a key
      // or a certificate. Signing is `attestResults`, composed at a node's construction.
      attestation: 'signed-by-nobody',
    }
  }

  /**
   * {@link execute} with the failure kept structured.
   *
   * The port can only carry a string, and a string is the wrong thing for a caller
   * that wants to distinguish "this artifact is not a command module" from "this
   * artifact ran and said no".
   */
  async run(task: Task): Promise<WasiRunOutcome> {
    // A shard is a claim the guest will read out of argv and may hash into its
    // result. Refuse an incoherent one here rather than let the guest be told
    // `7 of 3`, which no program has a correct response to.
    if (
      !Number.isSafeInteger(task.partitionCount) ||
      !Number.isSafeInteger(task.partitionIndex) ||
      task.partitionCount < 1 ||
      task.partitionIndex < 0 ||
      task.partitionIndex >= task.partitionCount
    ) {
      return {
        ok: false,
        failure: {
          kind: 'invalid-shard',
          index: task.partitionIndex,
          count: task.partitionCount,
        },
      }
    }

    const moduleBytes = await this.#blockstore.get(task.moduleCid)
    if (moduleBytes === undefined) {
      return { ok: false, failure: { kind: 'module-missing', cid: task.moduleCid.toString() } }
    }
    const inputBytes = await this.#blockstore.get(task.inputCid)
    if (inputBytes === undefined) {
      return { ok: false, failure: { kind: 'input-missing', cid: task.inputCid.toString() } }
    }

    const stdin = new TaskStdin(inputBytes)
    const stdout = new CappedSink(this.#maxOutputBytes, STDOUT_INO)
    const stderr = new DiagnosticSink(MAX_STDERR_BYTES, STDERR_INO)

    // `debug: false` is not optional. The shim's `enable(enabled)` reads
    // `enabled === undefined ? true : enabled`, so **omitting the options object
    // turns logging on**, and the logger is a module-level singleton — one WASI
    // constructed without options anywhere in the process starts printing
    // `wasi: 3 12` to the console for every `args_sizes_get` in every other task.
    // Found by running a fixture and watching argv counts appear on stdout.
    const wasi = new WASI(
      shardArgv(task.partitionIndex, task.partitionCount),
      [...WASI_ENV],
      [stdin, stdout, stderr],
      { debug: false },
    )
    const memoryRef: MemoryRef = { memory: null }
    const imports = {
      [WASI_NAMESPACE]: pinnedWasiImports(wasi.wasiImport, memoryRef, seededStream(taskSeed(task))),
    }

    let instance: WebAssembly.Instance
    try {
      const module = await WebAssembly.compile(moduleBytes)
      instance = await WebAssembly.instantiate(module, imports)
    } catch (cause) {
      // Malformed bytes, failed validation, and — importantly — any import the host
      // does not supply. The runtime names it; no allow-list is involved.
      return { ok: false, failure: { kind: 'instantiation-failed', detail: messageOf(cause) } }
    }

    const memory = instance.exports['memory']
    if (!(memory instanceof WebAssembly.Memory)) {
      return { ok: false, failure: { kind: 'missing-export', name: 'memory' } }
    }
    // Before `_start`, because the pinned clock and entropy write through it.
    memoryRef.memory = memory

    const start = instance.exports[WASI_ENTRYPOINT]
    if (!isNiladicExport(start)) {
      return { ok: false, failure: { kind: 'missing-export', name: WASI_ENTRYPOINT } }
    }

    let code: number
    try {
      code = wasi.start({ exports: { memory, _start: start } })
    } catch (cause) {
      return {
        ok: false,
        failure: {
          kind: 'trap',
          detail: messageOf(cause),
          stderr: stderr.text(),
          stderrDropped: stderr.dropped,
        },
      }
    }

    // Overflow is checked before the exit status because *this host* caused the
    // status: a guest whose write came back `ENOSPC` usually exits non-zero, and
    // reporting that code would blame the guest for a limit the node imposed.
    if (stdout.overflowed) {
      return { ok: false, failure: { kind: 'output-too-large', limit: this.#maxOutputBytes } }
    }

    // The exit status is read before stdout, and this ordering is the whole point of
    // `wasi-fail.wat`. A guest can leave perfectly decodable bytes on stdout and
    // still have failed; accepting them would content-address a result the program
    // disowned, and redundant execution cannot catch it because two nodes running
    // the same failing program fail identically and therefore agree.
    if (code !== 0) {
      return {
        ok: false,
        failure: {
          kind: 'nonzero-exit',
          code,
          stdoutBytes: stdout.length,
          stderr: stderr.text(),
          stderrDropped: stderr.dropped,
        },
      }
    }

    const output = stdout.bytes()
    if (output.length === 0) return { ok: false, failure: { kind: 'no-output' } }

    let value: CanonicalValue
    try {
      value = decodeCanonical(output)
    } catch (cause) {
      return { ok: false, failure: { kind: 'not-dag-cbor', detail: messageOf(cause) } }
    }

    return {
      ok: true,
      value,
      inputBytes: inputBytes.length,
      stdoutBytes: output.length,
      stdinConsumed: stdin.consumed,
    }
  }
}
