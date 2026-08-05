import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { WASI } from '@bjorn3/browser_wasi_shim'
import { MemoryBlockstore, WasmExecutor, encodeCanonical, sha256 } from '@o2/core'
import { WASI_NAMESPACE, WasiExecutor, describeWasiFailure, pinnedWasiImports, translationCid } from '@o2/aot'
import type { TranslationKey } from '@o2/aot'
import { blockCid } from '@o2/net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
// Test-only relative import into another package's `src`, the convention
// `packages/net/src/sovereign-egress.test.ts` records: a fixture is not part of a
// package's published surface, and the barrel is what production depends on.
import { MODULE_ECHOES_INPUT } from '../../packages/core/src/executor/fixtures.ts'
import { readTargetFeatures } from './features.ts'
import { LIFT_TARGET } from './lift.ts'
import {
  ECHO_GUEST_C,
  HELLO_GUEST_C,
  LIFTED_ECHO,
  LIFTED_HELLO,
  buildGuest,
  cleanupGuests,
  guestDir,
  imageIsPresent,
  liftThroughCli,
  toolchainFromStdout,
} from './echo-guest.ts'
import type { CliLiftRun } from './echo-guest.ts'

/**
 * Does an artifact elfconv actually produced complete a task on this fabric — AOT-04.
 *
 * The successor to `packages/aot/src/wasi-real.node.test.ts`, and the difference is the
 * whole point of the file. That one runs a `printf("hello\n")` and can only end
 * `not-dag-cbor`, because the fabric's output codec is DAG-CBOR and the guest writes
 * ASCII; it says so in its own words and calls closing the gap *"a larger piece of
 * work"*. So before this file, the strongest statement available anywhere in the
 * repository about a real translated artifact was
 * `expect(outcome.failure.kind).toBe('not-dag-cbor')`.
 *
 * Everything else that has ever returned a fabric result through the WASI path is a
 * hand-written fixture, and those fixtures were written from the same understanding as
 * the executor — the shape of every defect this project has recorded.
 *
 * ## What a skip means here, and why it is stated rather than left to the runner
 *
 * A skipped `it.skipIf` reports green inside an aggregate pass and **nothing in vitest's
 * output distinguishes it from a measurement.** So the gate is not evidence of anything
 * by itself. Two things make this file auditable after the fact and both are here: it
 * logs, once, what `imageIsPresent()` answered and where each guest came from; and the
 * summary records the host, each artifact's sha-256, each emitted key CID and each
 * measured byte length. On a host with neither the image nor a pre-lifted pair, this
 * criterion is **unmeasured, and unmeasured is not met** — which is a different state
 * from *measured and not met* and must not be reported as the same one.
 *
 * ## The one thing this file must not do
 *
 * Substitute a hand-written `.wat` for a translated artifact. `wasiEcho` already exists
 * and already proves everything a hand-written fixture can prove. The entire value here
 * is provenance: C held in this repository, compiled in the pinned image, lifted by the
 * command a person types.
 */

// ---------------------------------------------------------------------------
// gates
// ---------------------------------------------------------------------------

const HAVE_IMAGE = imageIsPresent()

/**
 * Both artifacts are obtainable: either the image is here, or a previous run's pair was
 * handed over on the environment.
 */
const MEASURABLE = HAVE_IMAGE || (LIFTED_ECHO !== undefined && LIFTED_HELLO !== undefined)

/**
 * This process will run `tools/aot/cli.ts` itself, so the printed CIDs and the exit code
 * are observable.
 *
 * A host pointing at pre-lifted artifacts has the bytes and not the stdout, so criterion
 * 1's emission half is unmeasurable there and the cases that need it skip **separately**
 * from the ones that only need the artifact. Folding the two gates into one would let a
 * host that set the variables report the CID assertions as green without having run the
 * command.
 */
const RAN_CLI = HAVE_IMAGE && LIFTED_ECHO === undefined && LIFTED_HELLO === undefined

console.log(
  `[echo-guest] imageIsPresent()=${HAVE_IMAGE}` +
    ` O2_AOT_ARTIFACT=${LIFTED_ECHO ?? '(unset)'}` +
    ` O2_AOT_HELLO=${LIFTED_HELLO ?? '(unset)'}` +
    ` → measurable=${MEASURABLE} cliRun=${RAN_CLI}`,
)

/** Two container builds plus two lifts, on a host where one lift is minutes. */
const PREPARE_TIMEOUT_MS = 15 * 60 * 1000

/**
 * `2`, and 2 is the success.
 *
 * `cli.ts`'s own docblock: `0` clean, `2` translated with reservations, `1` failed — and
 * *"on this image a glibc-static input always lands on `2`"*. A driver that mapped
 * reservations to `0` would let a build script treat an artifact carrying untranslated,
 * potentially-aborting addresses as a clean success, which is the exact mistake the whole
 * driver exists to stop elfconv making. **How many such addresses these guests carry is
 * unmeasured until they are lifted**, so no count appears in this comment.
 */
const EXIT_RESERVATIONS = 2

/** The six keys `liftElf` builds its `toolchain` record from, in `describeLift`'s spelling. */
const TOOLCHAIN_NAMES: readonly string[] = [
  'elfconv-image',
  'elfconv-commit',
  'elflift-sha256',
  'clang',
  'wasi-sdk',
  'wasmedge',
]

// ---------------------------------------------------------------------------
// the guests
// ---------------------------------------------------------------------------

interface Guest {
  readonly label: string
  /** The ELF this file built, or `undefined` when the artifact came from the environment. */
  readonly elfPath: string | undefined
  /** The CLI invocation, or `undefined` when the artifact came from the environment. */
  readonly run: CliLiftRun | undefined
  readonly artifact: Uint8Array<ArrayBuffer> | undefined
  readonly wallMs: number
}

let echo: Guest | undefined
let hello: Guest | undefined

function prepare(label: string, source: string, override: string | undefined, dir: string): Guest {
  const started = performance.now()
  if (override !== undefined) {
    let artifact: Uint8Array<ArrayBuffer> | undefined
    try {
      artifact = new Uint8Array(readFileSync(override))
    } catch {
      artifact = undefined
    }
    return { label, elfPath: undefined, run: undefined, artifact, wallMs: performance.now() - started }
  }
  const elfPath = buildGuest(source, dir, label)
  const run = liftThroughCli(elfPath, join(dir, `${label}.wasm`))
  return { label, elfPath, run, artifact: run.artifact, wallMs: performance.now() - started }
}

/**
 * The artifact of a guest that was prepared, or a failure carrying the diagnosis.
 *
 * `lift.node.test.ts`'s `liftedArtifact` discipline, restated for this file's shape: a
 * **skip** is a host without the image, a **failure** is a lift that ran and came back
 * wrong. Four blocks in that file once opened with `if (!first.ok) return` — the shape a
 * skip takes, applied to a failure — and six tests reported green having executed no
 * expectation. Every block below routes through this, and it throws rather than
 * returning, so no block can be turned into a no-op by an early exit.
 *
 * The message is the CLI's own stderr tail, because that is where
 * `elfconv_runtime_error(...)` and clang put their diagnoses.
 */
function artifactOf(guest: Guest | undefined, label: string): Uint8Array<ArrayBuffer> {
  expect(guest, `beforeAll never prepared the ${label} guest`).toBeDefined()
  if (guest === undefined) throw new Error(`beforeAll never prepared the ${label} guest`)
  const detail =
    guest.run === undefined
      ? `no artifact was read for the ${label} guest — check the path on the environment`
      : `the CLI exited ${guest.run.status} and left no artifact — stderr tail:\n${tail(guest.run.stderr)}`
  expect(guest.artifact, detail).toBeDefined()
  if (guest.artifact === undefined) throw new Error(detail)
  return guest.artifact
}

/** The CLI invocation, or a failure saying this host did not make one. */
function runOf(guest: Guest | undefined, label: string): CliLiftRun {
  expect(guest, `beforeAll never prepared the ${label} guest`).toBeDefined()
  if (guest === undefined) throw new Error(`beforeAll never prepared the ${label} guest`)
  const detail = `the ${label} guest was read from the environment, so no CLI run exists to read`
  expect(guest.run, detail).toBeDefined()
  if (guest.run === undefined) throw new Error(detail)
  return guest.run
}

function tail(text: string, lines = 20): string {
  return text.split('\n').slice(-lines).join('\n')
}

/**
 * Hex of a multihash's bytes — the spelling `liftElf` writes into `inputDigest`.
 *
 * Two lines rather than an import: `lift.ts`'s own `toHex` is module-private, and the
 * recomputation below has to hash *the same thing the same way* rather than borrow the
 * pipeline's helper. Note it is the **multihash** bytes and not the bare digest, which is
 * the one detail a reimplementation gets wrong.
 */
function toHex(bytes: Uint8Array): string {
  let out = ''
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0')
  return out
}

/**
 * The key a correct pipeline would have built for this guest, assembled here.
 *
 * Two of the four covered inputs are derived **independently of the CLI**: `inputDigest`
 * is the sha-256 of the ELF this file built, hashed by this file, and `features` is read
 * out of the artifact's own `target_features` section by this file rather than taken from
 * the `needs …` line the CLI printed. `target` is the constant. Only `toolchain` comes
 * off the CLI's stdout, because every value in it originates inside the container and no
 * test can derive it — and saying which two are which is what keeps "recomputed the key"
 * from reading as more than it is.
 */
async function recomputeKey(guest: Guest): Promise<TranslationKey> {
  const run = runOf(guest, guest.label)
  const artifact = artifactOf(guest, guest.label)
  expect(guest.elfPath, `the ${guest.label} guest has no ELF to hash`).toBeDefined()
  if (guest.elfPath === undefined) throw new Error(`the ${guest.label} guest has no ELF to hash`)

  const scan = readTargetFeatures(artifact)
  expect(scan.ok, `the ${guest.label} artifact has no readable target_features section`).toBe(true)
  if (!scan.ok) throw new Error(`the ${guest.label} artifact has no readable target_features section`)

  const toolchain = toolchainFromStdout(run.stdout, TOOLCHAIN_NAMES)
  // Exactly the six, so a renderer that dropped one would not quietly produce a key that
  // still matched — it would produce a *different* key, and this line names which.
  expect(Object.keys(toolchain).toSorted(), `toolchain lines in:\n${run.stdout}`).toEqual(
    [...TOOLCHAIN_NAMES].toSorted(),
  )

  const digest = await sha256.digest(new Uint8Array(readFileSync(guest.elfPath)))
  return {
    inputDigest: toHex(digest.bytes),
    target: LIFT_TARGET,
    toolchain,
    features: scan.features.required,
  }
}

// ---------------------------------------------------------------------------

const SHARD_VALUE = { n: 1, tag: 'echo' } as const

/** The input block a submitted shard would carry: `canonicalCid(value).bytes`. */
function shardBlock(): Uint8Array<ArrayBuffer> {
  const encoded = encodeCanonical(SHARD_VALUE)
  if (!encoded.ok) throw new Error('the shard value does not encode as DAG-CBOR')
  return encoded.bytes
}

async function stage(
  module: Uint8Array<ArrayBuffer>,
): Promise<{ blockstore: MemoryBlockstore; task: import('@o2/core').Task; inputBytes: number }> {
  const blockstore = new MemoryBlockstore()
  const moduleCid = await blockstore.put(module)
  const block = shardBlock()
  const inputCid = await blockstore.put(block)
  return {
    blockstore,
    task: { moduleCid, inputCid, partitionIndex: 0, partitionCount: 1 },
    inputBytes: block.length,
  }
}

// ---------------------------------------------------------------------------

describe.skipIf(!MEASURABLE)('a guest a translated artifact can finish a job with', () => {
  beforeAll(() => {
    if (!MEASURABLE) return
    const dir = guestDir('o2-echo-guest-')
    echo = prepare('echo', ECHO_GUEST_C, LIFTED_ECHO, dir)
    hello = prepare('hello', HELLO_GUEST_C, LIFTED_HELLO, dir)
    for (const guest of [echo, hello]) {
      console.log(
        `[echo-guest] ${guest.label}: source=${guest.run === undefined ? 'environment' : 'cli'}` +
          ` status=${guest.run?.status ?? 'n/a'} artifact=${guest.artifact?.length ?? 'none'} bytes` +
          ` wall=${guest.wallMs.toFixed(0)}ms keyCid=${guest.run?.printedKeyCid ?? 'n/a'}`,
      )
    }
  }, PREPARE_TIMEOUT_MS)

  afterAll(() => {
    cleanupGuests()
  })

  // -------------------------------------------------------------------------
  // the artifact, as a thing the command produced
  // -------------------------------------------------------------------------

  it.skipIf(!RAN_CLI)(
    'comes out of the command a person types, carrying reservations rather than a clean bill',
    () => {
      const run = runOf(echo, 'echo')
      // Exit 2, not 0. See EXIT_RESERVATIONS: a glibc-static input always lands on
      // reservations, so a case asserting 0 fails on a correct run.
      expect(run.status, `stderr tail:\n${tail(run.stderr)}`).toBe(EXIT_RESERVATIONS)
      const artifact = artifactOf(echo, 'echo')
      // \0asm — a WASM module, not the wasmedge AOT output that sits beside it in the
      // container under a very similar name.
      expect([...artifact.subarray(0, 4)]).toEqual([0x00, 0x61, 0x73, 0x6d])
      // The repository's own floor for "a real lift", chosen by `lift.node.test.ts` as a
      // threshold rather than measured as a size.
      expect(artifact.length).toBeGreaterThan(1_000_000)
    },
    PREPARE_TIMEOUT_MS,
  )

  it.skipIf(!RAN_CLI)(
    'shows the operator the key CID of this artifact, told apart from the artifact CID',
    async () => {
      /**
       * Criterion 1's **emission** half, against a real artifact.
       *
       * No `/bafy[a-z0-9]+/` match appears anywhere in this file. Both CIDs the CLI
       * prints are CIDv1 / dag-cbor / sha-256 — `packages/net/src/block.ts` and
       * `packages/aot/src/cache-key.ts` both go through dag-cbor — so both render
       * `bafyrei…` and a pattern that matches either matches nothing in particular. It
       * passes with the two swapped, which is exactly the mutation this phase plants.
       */
      const guest = echo
      expect(guest, 'beforeAll never prepared the echo guest').toBeDefined()
      if (guest === undefined) throw new Error('beforeAll never prepared the echo guest')

      const run = runOf(guest, 'echo')
      const artifact = artifactOf(guest, 'echo')
      const named = await translationCid(await recomputeKey(guest))
      expect(named.ok, 'the recomputed key was refused').toBe(true)
      if (!named.ok) throw new Error('the recomputed key was refused')

      expect(run.printedKeyCid, `no key-CID line in:\n${run.stdout}`).toBeDefined()
      expect(run.printedArtifactCid, `no artifact-CID line in:\n${run.stdout}`).toBeDefined()
      // The key line is the name of *what should have been produced*, recomputed here
      // from an input digest this test hashed and a feature set this test read.
      expect(run.printedKeyCid).toBe(named.cid.toString())
      // The artifact line is the name of *what was* — the content hash of the bytes the
      // CLI wrote, by the function `FetchingBlockstore` verifies a fetched block with.
      expect(run.printedArtifactCid).toBe((await blockCid(artifact)).toString())
      // …and they are not each other.
      expect(run.printedKeyCid).not.toBe(run.printedArtifactCid)
    },
    PREPARE_TIMEOUT_MS,
  )

  it.skipIf(!RAN_CLI)(
    'emits a different key CID for a different guest, and names the input that moved',
    async () => {
      /**
       * The **end-to-end** half of roadmap criterion 2's second clause. The repeat
       * direction — the same input lifting to the same CID twice — is in
       * `lift.node.test.ts`, against two real lifts of one subject.
       *
       * Both guests were lifted on this host, minutes apart, by the same command against
       * the same digest-pinned image, so target and toolchain are equal between them and
       * `inputDigest` is the one covered input that moved. Asserting that beside the CIDs
       * is what makes the claim *this field differed and the CID moved* rather than *two
       * different things hashed differently*.
       */
      const echoGuest = echo
      const helloGuest = hello
      expect(echoGuest, 'beforeAll never prepared the echo guest').toBeDefined()
      expect(helloGuest, 'beforeAll never prepared the hello guest').toBeDefined()
      if (echoGuest === undefined || helloGuest === undefined) throw new Error('guests missing')

      const echoKey = await recomputeKey(echoGuest)
      const helloKey = await recomputeKey(helloGuest)

      expect(echoKey.inputDigest).not.toBe(helloKey.inputDigest)
      // `target` **cannot** differ: both sides read the same imported constant in the
      // same process, so this line carries no evidence and is not offered as any. It is
      // here to make the set of covered inputs visible beside the one that moved, and it
      // is labelled rather than deleted because a reader who found three equalities and
      // one inequality would otherwise read all four as evidence.
      expect(echoKey.target).toBe(helloKey.target)
      // `toolchain` is different: the two records are parsed out of two separate CLI
      // stdouts, so this one can fail and does mean something.
      expect(echoKey.toolchain).toEqual(helloKey.toolchain)
      // Equal here, measured rather than assumed — if a future guest moved the feature
      // set too, `inputDigest` would no longer be the *one* input that moved and this
      // case's whole claim would need restating.
      expect(echoKey.features).toEqual(helloKey.features)

      expect(runOf(echoGuest, 'echo').printedKeyCid).not.toBe(
        runOf(helloGuest, 'hello').printedKeyCid,
      )
    },
    PREPARE_TIMEOUT_MS,
  )

  // -------------------------------------------------------------------------
  // the ABI, re-measured against a second, differently-shaped lift
  // -------------------------------------------------------------------------

  it(
    'declares one import namespace and exactly two exports — a second lift, same answer',
    async () => {
      const module = await WebAssembly.compile(artifactOf(echo, 'echo'))
      // `wasi-real.node.test.ts` makes both of these against a `printf` hello-world. The
      // same two against a stdio-free `read`/`write` guest is what puts the ABI claim on
      // more than one lift.
      expect([
        ...new Set(WebAssembly.Module.imports(module).map((entry) => entry.module)),
      ]).toEqual([WASI_NAMESPACE])
      expect(
        WebAssembly.Module.exports(module)
          .map((entry) => entry.name)
          .toSorted(),
      ).toEqual(['_start', 'memory'])
    },
    PREPARE_TIMEOUT_MS,
  )

  it(
    'declares no import the pinned surface leaves unanswered',
    async () => {
      const pinned = pinnedWasiImports(
        new WASI([], [], [], { debug: false }).wasiImport,
        { memory: null },
        () => undefined,
      )
      const missing = WebAssembly.Module.imports(await WebAssembly.compile(artifactOf(echo, 'echo')))
        .map((entry) => entry.name)
        .filter((name) => typeof pinned[name] !== 'function')
      // Named rather than counted: an unsatisfied import is a one-line fix once you know
      // which one, and an unreadable failure until you do.
      expect(missing).toEqual([])
    },
    PREPARE_TIMEOUT_MS,
  )

  // -------------------------------------------------------------------------
  // the claim
  // -------------------------------------------------------------------------

  it(
    'runs under WasiExecutor and returns the shard’s own value',
    async () => {
      /**
       * **The first time in this repository that an artifact elfconv produced has
       * returned a fabric result.**
       *
       * The value comes back because `WasiExecutor` writes the input block — which is
       * `canonicalCid(value).bytes`, already valid DAG-CBOR — onto the guest's stdin, and
       * the guest copies stdin to stdout. No codec knowledge lives in the guest.
       */
      const { blockstore, task, inputBytes } = await stage(artifactOf(echo, 'echo'))
      const outcome = await new WasiExecutor({ nodeId: 'aot-echo', blockstore }).run(task)

      // The message is the diagnosis, not a prompt to reproduce by hand: for a `trap`
      // that is the trap detail plus the guest's stderr tail, which is where
      // `elfconv_runtime_error(...)` prints the address it gave up on. An assertion that
      // merely said `expected true, got false` would throw that away.
      expect(outcome.ok, outcome.ok ? '' : describeWasiFailure(outcome.failure)).toBe(true)
      if (!outcome.ok) throw new Error(describeWasiFailure(outcome.failure))

      expect(outcome.value).toEqual(SHARD_VALUE)
      expect(outcome.inputBytes).toBe(inputBytes)
      // An echo, so the two are equal by construction — and if they are not, the guest
      // dropped a short write and this says so instead of the codec saying `not-dag-cbor`.
      expect(outcome.stdoutBytes).toBe(inputBytes)
      expect(outcome.stdinConsumed).toBe(inputBytes)
    },
    PREPARE_TIMEOUT_MS,
  )

  it(
    'reports the fuel a source-compiled echo reports over the same value',
    async () => {
      /**
       * Asserted here rather than only in Plan 21-05, because if the two disagree the
       * cause is the guest and this is where the guest is.
       *
       * Fuel is `inputBytes + stdoutBytes` in `WasiExecutor` and `inputBytes.length +
       * output.length` in `WasmExecutor` — the same definition, which is why an echo on
       * both sides makes every downstream number agree.
       */
      const wasi = await stage(artifactOf(echo, 'echo'))
      const wasiOutcome = await new WasiExecutor({
        nodeId: 'aot-echo',
        blockstore: wasi.blockstore,
      }).execute(wasi.task)

      const native = await stage(MODULE_ECHOES_INPUT)
      const nativeOutcome = await new WasmExecutor({
        nodeId: 'native-echo',
        blockstore: native.blockstore,
      }).execute(native.task)

      expect(wasiOutcome.ok, wasiOutcome.ok ? '' : wasiOutcome.reason).toBe(true)
      expect(nativeOutcome.ok, nativeOutcome.ok ? '' : nativeOutcome.reason).toBe(true)
      if (!wasiOutcome.ok || !nativeOutcome.ok) throw new Error('one of the two echoes failed')

      expect(wasiOutcome.output).toEqual(nativeOutcome.output)
      expect(wasiOutcome.fuelUsed).toBe(nativeOutcome.fuelUsed)
    },
    PREPARE_TIMEOUT_MS,
  )

  it(
    'answers the same way twice, on the same host',
    async () => {
      const { blockstore, task } = await stage(artifactOf(echo, 'echo'))
      const first = await new WasiExecutor({ nodeId: 'a', blockstore }).run(task)
      const second = await new WasiExecutor({ nodeId: 'b', blockstore }).run(task)
      // Weak evidence deliberately stated as weak: two runs, one process, one host. It is
      // not cross-machine reproducibility, which the lift driver reports as a standing
      // blind spot for this artifact and every other.
      expect(first).toEqual(second)
    },
    PREPARE_TIMEOUT_MS,
  )

  // -------------------------------------------------------------------------
  // the negative control
  // -------------------------------------------------------------------------

  it(
    'refuses the hello guest at the codec, not at instantiation — the success discriminates',
    async () => {
      /**
       * Without this, "the echo succeeded" is equally well explained by a path that
       * accepts anything. `not-dag-cbor` means the module compiled, every import was
       * satisfied, it instantiated, `_start` ran to completion and it wrote bytes — only
       * the codec refused them.
       *
       * Each of the alternatives is a distinct kind this executor can produce, so the
       * equality is a real discrimination. Note that `wasi-real.node.test.ts` writes this
       * list as *"`instantiation-failed`, `no-start`, `no-memory` or `trapped`"*:
       * `no-start` and `no-memory` are **fixture** names, not `WasiFailure` kinds — both
       * produce `missing-export` — so that phrasing is not copied into an assertion here.
       */
      const { blockstore, task } = await stage(artifactOf(hello, 'hello'))
      const outcome = await new WasiExecutor({ nodeId: 'aot-hello', blockstore }).run(task)

      expect(outcome.ok, outcome.ok ? 'the hello guest produced a fabric result' : '').toBe(false)
      if (outcome.ok) throw new Error('the hello guest produced a fabric result')
      expect(outcome.failure.kind).toBe('not-dag-cbor')
    },
    PREPARE_TIMEOUT_MS,
  )
})
