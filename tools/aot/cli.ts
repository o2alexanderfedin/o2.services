/**
 * The command a person types to lift one binary.
 *
 * Thin by intent: the work lives in `lift.ts`, `scan.ts` and `features.ts`, and this
 * reads argv, prints, and picks an exit code.
 *
 * Run with:  npm run aot:lift -- path/to/binary [--out artifact.wasm]
 *
 * ## Why the argument parser is a function that returns a value
 *
 * "Thin" was previously read as "too small to be wrong", and the invocation on the
 * line above did not work. Stripping `--out` from the positional arguments was
 * written as
 *
 *     argv.filter((arg, index) => index !== outAt && index !== outAt + 1)
 *
 * which is only correct while `--out` is present. Without it `outAt` is `-1`, so the
 * second clause reads `index !== 0` and eats the *first positional argument*.
 * `npm run aot:lift -- ./hello` therefore printed usage and exited 1, and the
 * `` out ?? `${input}.wasm` `` default underneath was unreachable code that had never
 * once run.
 *
 * What kept it alive was structural rather than careless. The parsing was welded to
 * `process.argv` at one end and to a `process.exit` at the other, so the only way to
 * exercise it was to spawn a process — and nothing did, because the file was the part
 * of the tool declared not to need a test. So {@link parseAotArgs} is now a pure
 * function from an argv array to an {@link AotArgs} result, and turning a failure into
 * usage text and an exit code is `main`'s job. The one thing here with logic is the
 * one thing here with a test, and the defaulted output path is inside the tested
 * function rather than downstream of it.
 *
 * ## …and why the sentinel is gone rather than guarded a fourth time
 *
 * The paragraph above describes a `-1` used as an index. The correction it prompted was
 * a guard — `outAt === -1 || …` — which is right and which does not scale: `--image` and
 * `--docker` would each have needed their own `indexOf`, their own sentinel, and their
 * own clause in one filter, and the defect only ever showed up when a flag was *absent*,
 * which is the case a reader checks last. So the parsing is now one left-to-right pass
 * over {@link VALUE_FLAGS}, collecting consumed indices into a `Set<number>`. There is no
 * state in it that means "not found", and therefore no value that can be mistaken for a
 * position.
 *
 * ## The exit code says what the verdict says
 *
 * `0` clean, `2` translated with reservations, `1` failed. `2` rather than `0`
 * because a build script that only checks for zero would otherwise treat "translated,
 * but 174 addresses will abort if reached" as success — which is the exact mistake
 * this whole driver exists to stop elfconv making. The reservations are printed
 * either way, and on this image a glibc-static input always lands on `2`.
 *
 * ## Why the entry point is guarded
 *
 * `main()` ran at module scope, which is right for a script and wrong for a script
 * that also exports something: importing this file to test the parser would have run
 * a real container lift against the test runner's own argv. The guard below compares
 * `argv[1]` to this module, so importing is inert and invoking is not.
 *
 * That comparison can also *fail*, which is a third answer and used to be spelled as
 * the second one — see {@link EntryVerdict}. A guard that answers "no" when it means
 * "I could not tell" is how this file produced the exit code its own paragraph above
 * calls the worst available.
 *
 * Node-only.
 */

import { realpathSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { MemoryBlockstore, decodeNameRecord, encodeNameRecord, signName } from '@o2/core'
import type { NameRecord } from '@o2/core'
import type { CID } from 'multiformats/cid'
import { describeLift, describeLiftFailure, liftElf, vouchedTranslation } from './lift.ts'

const EXIT_CLEAN = 0
const EXIT_FAILED = 1
const EXIT_RESERVATIONS = 2

const USAGE =
  'usage: npm run aot:lift -- <path-to-aarch64-static-elf> [--out <artifact.wasm>]' +
  ' [--image <tag>] [--docker <path>]\n' +
  // Both flags exist so the driver can be pointed at something other than the default,
  // and both are on argv rather than only on `LiftOptions` because the refusal that
  // matters is only reachable by *pointing the command at an image*. `--image` is how a
  // re-tagged local image gets in front of the digest and name checks at all; `--docker`
  // names a program that is not Docker, which is what makes those refusals measurable on
  // a host with no elfconv image present. The name check is the one that survives the
  // containerd image store, where `docker tag` gives a borrowed repository a RepoDigests
  // entry of its own — see `lift.ts`'s `image-name-not-pulled`.
  '  --image  the toolchain image to lift with; a name this host did not pull the\n' +
  '           image under is refused rather than run under the borrowed name\n' +
  '  --docker the program to run instead of `docker`\n' +
  // The publish step. Without it a lifted artifact cannot be dispatched to any node that pins
  // a build authority, because `guardModuleProvenance` refuses a bare CID.
  '  --publish-as   name to sign the artifact under; needs --signing-key\n' +
  '  --signing-key  the build authority seed, 64 lowercase hex\n' +
  '  --record-out   where the signed record goes (default <out>.record.json)\n' +
  // AOT-02's mismatch report. The publish step signs the translation key into the record;
  // this is the reader that holds it beside a fresh lift's key — see `lift.ts`'s
  // `translation-key-mismatch`.
  '  --against-record  a signed record whose translation key this lift must agree with'

/**
 * Why the arguments could not be used.
 *
 * Named, not merely counted, for the same reason `LiftFailure` is: all three end in
 * the same usage text and the same exit code, so a caller that only saw "usage error"
 * could not tell a forgotten path from a `--out` with nothing after it. The name is
 * what lets a test pin the *reason* rather than the exit code, and the exit code is
 * the part that could not distinguish anything.
 */
export type ArgFailure =
  | { readonly kind: 'no-input' }
  /**
   * A value-taking flag with nothing after it. `flag` says which one.
   *
   * One kind carrying the flag rather than one kind per flag. Three failures that all
   * mean "you gave me a flag and no value" is how a reader stops being able to tell
   * the named failures apart, which is the property the doc above says the naming
   * exists to provide — and the sentence has to name the flag anyway, so a second kind
   * would carry no information the field does not.
   */
  | { readonly kind: 'missing-flag-value'; readonly flag: string }
  | { readonly kind: 'flag-in-input-position'; readonly argument: string }
  /**
   * `--publish-as` without `--signing-key`, or the reverse.
   *
   * Refused rather than defaulted, and the reason is the whole point of the publish step: a
   * record signed by a key nobody pinned vouches for nothing, and a name with no signature is
   * the bare CID `guardModuleProvenance` already refuses. Half a publish is not a publish.
   */
  | { readonly kind: 'half-a-publish'; readonly given: string; readonly missing: string }
  /** `--signing-key` that is not 64 lowercase hex characters. */
  | { readonly kind: 'bad-signing-key' }

/**
 * A usable invocation, or the reason there isn't one.
 *
 * `out` is a resolved path and never `undefined` — see the module comment. A caller
 * that had to apply the default itself is a caller that could skip it.
 *
 * `image` and `docker` are the opposite: **absent when the flag was not given**, never
 * present and `undefined`. `main` spreads them into `LiftOptions`, whose own defaults
 * (`ELFCONV_IMAGE_TAG`, `'docker'`) are the ones that should apply, and under
 * `exactOptionalPropertyTypes` an explicit `undefined` is a different value from an
 * omitted key. Defaulting them here would put a second copy of `lift.ts`'s defaults in
 * a file whose whole point is that it holds no logic.
 */
export type AotArgs =
  | {
      readonly ok: true
      readonly input: string
      readonly out: string
      readonly image?: string
      readonly docker?: string
      /** The name to publish the artifact under. Requires `--signing-key`. */
      readonly publishAs?: string
      /** The build authority's 64-hex ed25519 seed. */
      readonly signingKey?: string
      /** Where the signed record goes. Defaults to `<out>.record.json`. */
      readonly recordOut?: string
      /**
       * AOT-02 — a signed record whose translation key this lift must agree with.
       *
       * Independent of the publish flags on purpose: checking somebody else's record is the
       * ordinary case, and requiring `--signing-key` to do it would mean an operator needed
       * a build authority's private key to verify a build authority's claim.
       */
      readonly againstRecord?: string
    }
  | { readonly ok: false; readonly failure: ArgFailure }

export function describeArgFailure(failure: ArgFailure): string {
  switch (failure.kind) {
    case 'no-input':
      return 'no input binary given — there is nothing to lift'
    case 'missing-flag-value':
      return `${failure.flag} was given with no value after it`
    case 'flag-in-input-position':
      return `${failure.argument} is not a path — the input binary comes first, or after --out <path>`
    case 'half-a-publish':
      return (
        `${failure.given} was given without ${failure.missing} — publishing needs both. ` +
        'A record signed by a key nobody pinned vouches for nothing, and a name with no ' +
        'signature is the bare CID a node already refuses.'
      )
    case 'bad-signing-key':
      return '--signing-key is not 64 lowercase hex characters'
  }
}

/**
 * Every flag that takes the argument after it.
 *
 * A table rather than three `indexOf` calls, so adding a fourth flag is an entry here
 * and nothing else. The order is the order they are documented in {@link USAGE}.
 */
const VALUE_FLAGS = [
  '--out',
  '--image',
  '--docker',
  '--publish-as',
  '--signing-key',
  '--record-out',
  '--against-record',
] as const

/**
 * `process.argv.slice(2)` into an input path, an output path, and the two overrides.
 *
 * A value-flag may appear on either side of the positional argument, which is the whole
 * reason this is a pass with a consumed-index set rather than a simple `argv[0]`. Extra
 * positionals are ignored rather than rejected: that was the previous behaviour, one
 * binary per run is the only shape the container driver supports, and turning a
 * tolerated argument into a hard failure is not a bug fix.
 *
 * A repeated flag takes its last value. Unspecified before and unspecified now — it is
 * recorded here only so the next reader does not have to run it to find out.
 *
 * Refuses rather than exits. A parser that calls `process.exit` cannot be asked what
 * it would have decided, and that is precisely how the `-1` bug above stayed invisible
 * through the tool's whole existence.
 */
export function parseAotArgs(argv: readonly string[]): AotArgs {
  const values = new Map<string, string>()
  // The indices this pass has already accounted for — a flag and the value after it.
  // Membership, not arithmetic: there is no "absent" index to be confused with `0`.
  const consumed = new Set<number>()

  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index]
    if (argument === undefined || !VALUE_FLAGS.includes(argument as (typeof VALUE_FLAGS)[number])) {
      continue
    }
    const value = argv[index + 1]
    if (value === undefined) {
      return { ok: false, failure: { kind: 'missing-flag-value', flag: argument } }
    }
    values.set(argument, value)
    consumed.add(index)
    consumed.add(index + 1)
    // Step over the value, so `--out --image x` treats `--image` as `--out`'s value
    // exactly as the old `argv[outAt + 1]` did, rather than consuming it twice.
    index++
  }

  const positional = argv.filter((_, index) => !consumed.has(index))
  const input = positional[0]
  if (input === undefined) return { ok: false, failure: { kind: 'no-input' } }
  if (input.startsWith('-')) {
    return { ok: false, failure: { kind: 'flag-in-input-position', argument: input } }
  }

  const image = values.get('--image')
  const docker = values.get('--docker')
  const publishAs = values.get('--publish-as')
  const signingKey = values.get('--signing-key')

  if (publishAs !== undefined && signingKey === undefined) {
    return { ok: false, failure: { kind: 'half-a-publish', given: '--publish-as', missing: '--signing-key' } }
  }
  if (signingKey !== undefined && publishAs === undefined) {
    return { ok: false, failure: { kind: 'half-a-publish', given: '--signing-key', missing: '--publish-as' } }
  }
  if (signingKey !== undefined && !/^[0-9a-f]{64}$/.test(signingKey)) {
    return { ok: false, failure: { kind: 'bad-signing-key' } }
  }

  const out = values.get('--out') ?? `${input}.wasm`
  const recordOut = values.get('--record-out')
  const againstRecord = values.get('--against-record')
  return {
    ok: true,
    input,
    out,
    ...(againstRecord === undefined ? {} : { againstRecord }),
    // Omitted rather than `undefined` — see {@link AotArgs}.
    ...(image === undefined ? {} : { image }),
    ...(docker === undefined ? {} : { docker }),
    ...(publishAs === undefined ? {} : { publishAs }),
    ...(signingKey === undefined ? {} : { signingKey }),
    ...(recordOut === undefined ? {} : { recordOut: recordOut ?? `${out}.record.json` }),
    ...(publishAs !== undefined && recordOut === undefined ? { recordOut: `${out}.record.json` } : {}),
  }
}

/** What {@link publishArtifact} returns — the record, its wire text, or why neither exists. */
export type PublishResult =
  | { readonly ok: true; readonly record: NameRecord; readonly text: string }
  | { readonly ok: false; readonly reason: string }

/**
 * Turn lifted bytes into a **signed name record**, which is the step this tool did not have.
 *
 * `guardModuleProvenance` refuses a task whose module arrives as a bare CID — *"a bare CID names
 * bytes, not a publisher"* — so before this existed, nothing `aot:lift` produced could be
 * dispatched to any node that pins a build authority, which is every node not explicitly
 * `runs-unsigned-artifacts`. The lift → sign → dispatch path had no second step outside a test:
 * `aot-dispatch.node.test.ts` supplied its own private `recordFor`, and that private helper WAS
 * the missing production capability. This is it, promoted.
 *
 * The CID is derived from the bytes through the same `MemoryBlockstore().put` that `bin/bench.ts`
 * uses for its fixtures, so a record vouches for the artifact rather than for a name.
 *
 * **The text is round-tripped before it is returned.** `encodeNameRecord` and
 * `decodeNameRecord` are two halves of a format with one producer, and a format that cannot be
 * read back is a file that looks like a publish and is not one. Encoding, decoding and comparing
 * costs nothing here and is the only thing that makes the codec's two halves check each other.
 */
export async function publishArtifact(
  bytes: Uint8Array,
  options: {
    readonly name: string
    readonly signingKey: string
    readonly validForMs?: number
    readonly now?: number
    /**
     * AOT-02 — the translation key CID this artifact came out of, signed into the record.
     *
     * Optional here and required in practice at the one call site below, which is the same
     * split `LiftOptions` keeps: the function stays usable for bytes that were not lifted
     * (a hand-built fixture, a record re-signed after a key rotation), and the driver that
     * *did* lift always has one to supply.
     */
    readonly translationKeyCid?: CID
  },
): Promise<PublishResult> {
  // Copied into a fresh buffer rather than passed through. `LiftedArtifact.bytes` is a plain
  // `Uint8Array` over an `ArrayBufferLike`, and the blockstore's contract is the narrower
  // `ArrayBuffer` — the same copy discipline `loadOrCreateSeed` and `FsBlockstore.get` keep,
  // for the same reason: a caller must not be able to mutate what was hashed after hashing.
  const owned = new Uint8Array(bytes.length)
  owned.set(bytes)
  const cid = await new MemoryBlockstore().put(owned)
  const now = options.now ?? Date.now()
  const record = signName(fromHexKey(options.signingKey), {
    name: options.name,
    cid,
    version: 1,
    expiresAt: now + (options.validForMs ?? 3_600_000),
    // Omitted rather than `undefined`, so a record for bytes with no translation behind it
    // hashes exactly as it did before this field existed. `naming.ts` states the rule and
    // `naming.test.ts` holds it as a byte comparison.
    ...(options.translationKeyCid === undefined ? {} : { translationKeyCid: options.translationKeyCid }),
  })
  const text = encodeNameRecord(record)
  const readBack = decodeNameRecord(text)
  if (readBack === null) {
    return { ok: false, reason: 'the signed record could not be read back after encoding' }
  }
  if (!readBack.cid.equals(record.cid) || readBack.signature !== record.signature) {
    return { ok: false, reason: 'the signed record did not survive its own encoding' }
  }
  return { ok: true, record, text }
}

/** 64 hex characters to 32 bytes. The parser has already refused anything else. */
function fromHexKey(hex: string): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(32)
  for (let i = 0; i < 32; i++) bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return bytes
}

async function main(argv: readonly string[]): Promise<number> {
  const args = parseAotArgs(argv)
  if (!args.ok) {
    process.stderr.write(`${describeArgFailure(args.failure)}\n${USAGE}\n`)
    return EXIT_FAILED
  }

  const outcome = await liftElf(args.input, {
    onProgress: (note) => process.stderr.write(`  ${note}\n`),
    // Conditional spread, the idiom `bin/agent.ts` uses for an optional option: under
    // `exactOptionalPropertyTypes` passing `image: undefined` is not the same as passing
    // nothing, and only the second lets `liftElf`'s own default apply.
    ...(args.image === undefined ? {} : { image: args.image }),
    ...(args.docker === undefined ? {} : { docker: args.docker }),
  })

  if (!outcome.ok) {
    process.stderr.write(`${describeLiftFailure(outcome.failure)}\n`)
    if (outcome.failure.kind === 'toolchain-failed') {
      process.stderr.write(outcome.failure.stderr)
    }
    return EXIT_FAILED
  }

  await writeFile(args.out, outcome.artifact.bytes)
  process.stdout.write(`${describeLift(outcome.artifact)}\n`)
  process.stdout.write(`  written to ${args.out}\n`)

  // AOT-02 — the mismatch report. Placed AFTER the artifact is written and its summary
  // printed, deliberately: the bytes exist and are worth keeping whatever the record says,
  // and an operator comparing against somebody else's record needs to see what this lift
  // produced in order to act on the refusal. It is a refusal about a *claim*, not about the
  // lift, so it must not suppress the lift's own output.
  if (args.againstRecord !== undefined) {
    let text: string
    try {
      text = await readFile(args.againstRecord, 'utf8')
    } catch (error) {
      process.stderr.write(
        `${args.againstRecord} could not be read: ${error instanceof Error ? error.message : String(error)}\n`,
      )
      return EXIT_FAILED
    }
    const record = decodeNameRecord(text)
    if (record === null) {
      // Not routed through `describeLiftFailure`: nothing about the lift is in question,
      // and `decodeNameRecord` returns `null` for every rejection by design, so there is no
      // reason to relay.
      process.stderr.write(`${args.againstRecord} is not a signed name record\n`)
      return EXIT_FAILED
    }
    const disagreement = vouchedTranslation(outcome.artifact, record)
    if (disagreement !== null) {
      process.stderr.write(`${describeLiftFailure(disagreement)}\n`)
      return EXIT_FAILED
    }
    process.stdout.write(
      `  translation key agrees with the record for "${record.name}": ${outcome.artifact.translation.keyCid.toString()}\n`,
    )
  }

  if (args.publishAs !== undefined && args.signingKey !== undefined && args.recordOut !== undefined) {
    const published = await publishArtifact(outcome.artifact.bytes, {
      name: args.publishAs,
      signingKey: args.signingKey,
      // AOT-02. The record vouches for the bytes AND for the translation they came out of,
      // so a consumer holding a lift of its own can compare the two — `--against-record`
      // below is this driver's own reader for it.
      translationKeyCid: outcome.artifact.translation.keyCid,
    })
    if (!published.ok) {
      process.stderr.write(`${published.reason}\n`)
      return EXIT_FAILED
    }
    await writeFile(args.recordOut, published.text)
    process.stdout.write(`  published as "${args.publishAs}" — ${published.record.cid.toString()}\n`)
    process.stdout.write(`  record written to ${args.recordOut}\n`)
    // The operator's next step, printed because it is the one thing they cannot derive from
    // the file: a serving node runs this artifact only if it pins THIS key.
    process.stdout.write(`  pin this build authority on serving nodes: --trust-anchor ${published.record.signer}\n`)
    process.stdout.write(`  translation key signed into the record: ${published.record.translationKeyCid?.toString() ?? 'none'}\n`)
  }

  return outcome.verdict === 'clean' ? EXIT_CLEAN : EXIT_RESERVATIONS
}

/**
 * Which file this process was actually asked to run.
 *
 * Four answers rather than a boolean, and the fourth is the whole point. The guard
 * was written as `try { … } catch { return false }`, and `false` is the answer that
 * means "do nothing" — so every way `realpathSync` can fail (a dangling symlink in
 * `node_modules/.bin`, `ELOOP`, `EACCES` or `ENOTDIR` on a path component, a cwd
 * unlinked under a relative `argv[1]`) produced exactly the outcome the docblock
 * below already named as the worst available: the command runs, prints nothing, and
 * exits 0. The tool whose entire reason for existing is that *elfconv's* exit code
 * cannot be trusted was emitting an untrustworthy one of its own.
 *
 * `undecidable` is not `another-module`. "I compared them and they differ" and "I
 * could not compare them" are different statements, and only the first justifies
 * silence.
 */
export type EntryVerdict =
  /** `argv[1]` names this file, so `main()` is the program. */
  | { readonly kind: 'this-module' }
  /** `argv[1]` names something else — this file was imported, and must stay inert. */
  | { readonly kind: 'another-module'; readonly entry: string }
  /** No `argv[1]` at all: `node -e`, the REPL, an embedder. Genuinely not a command. */
  | { readonly kind: 'no-entry' }
  /** The comparison could not be made. See {@link EntryVerdict}. */
  | { readonly kind: 'undecidable'; readonly entry: string; readonly detail: string }

export function describeEntryVerdict(verdict: EntryVerdict): string {
  switch (verdict.kind) {
    case 'this-module':
      return 'this file is the program'
    case 'another-module':
      return `this file was imported by ${verdict.entry}, so it did nothing`
    case 'no-entry':
      return 'there is no entry script, so this file was imported rather than run'
    case 'undecidable':
      return (
        `could not establish whether ${verdict.entry} is this file (${verdict.detail}), so ` +
        'nothing was lifted and this is not a success — re-run with a path that resolves'
      )
  }
}

/** `null` rather than a throw, so an unrepresentable path is a comparison that failed. */
function hrefOf(path: string): string | null {
  try {
    return pathToFileURL(path).href
  } catch {
    return null
  }
}

/**
 * `argv[1]` against this module's URL, without letting a failed syscall mean "no".
 *
 * The unresolved comparison runs *first* and is decisive on a match: `import.meta.url`
 * is already fully resolved, so `argv[1]` spelling it exactly settles the question with
 * no syscall at all. `realpathSync` is only needed for the case it was introduced for —
 * a launcher reached through a symlinked `node_modules/.bin` entry, whose `argv[1]`
 * spells the same file differently — and when it throws, the answer is that there is no
 * answer.
 *
 * `realpath` is a parameter because the arm that matters cannot be provoked from a
 * real filesystem here: node had to resolve `argv[1]` to load anything at all, so a
 * path that fails this call is one that succeeded moments earlier. An arm nothing can
 * call directly is an arm no test can show still fires — the reason `lift.ts` exports
 * `classifySpawnFailure`.
 */
export function classifyEntry(
  entry: string | undefined,
  moduleUrl: string,
  realpath: (path: string) => string = realpathSync,
): EntryVerdict {
  if (entry === undefined) return { kind: 'no-entry' }
  if (hrefOf(entry) === moduleUrl) return { kind: 'this-module' }

  let resolved: string
  try {
    resolved = realpath(entry)
  } catch (cause) {
    return {
      kind: 'undecidable',
      entry,
      detail: cause instanceof Error ? cause.message : String(cause),
    }
  }

  const resolvedHref = hrefOf(resolved)
  if (resolvedHref === null) {
    return { kind: 'undecidable', entry, detail: `${resolved} is not expressible as a file URL` }
  }
  return resolvedHref === moduleUrl ? { kind: 'this-module' } : { kind: 'another-module', entry }
}

const invocation = classifyEntry(process.argv[1], import.meta.url)
if (invocation.kind === 'this-module') {
  process.exitCode = await main(process.argv.slice(2))
} else if (invocation.kind === 'undecidable') {
  // Reported and failed, never run. Running `main()` on a maybe would lift a container
  // as a side effect of an `import`, which is worse than the defect being fixed; exiting
  // 0 having established nothing is the defect being fixed. Refusing is the only arm
  // left, and it is the one that makes the exit code follow the measurement.
  process.stderr.write(`${describeEntryVerdict(invocation)}\n`)
  process.exitCode = EXIT_FAILED
}
