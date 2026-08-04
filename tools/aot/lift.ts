/**
 * Running elfconv, and refusing to believe it — AOT-01.
 *
 * This is the build-time driver: an AArch64 ELF goes in, a `.wasm` the fabric can
 * name comes out, together with everything `translationCid` in `@o2/aot` needs to
 * name it. It lives outside every package's `src` deliberately — it shells out to Docker and
 * has no business anywhere the portability test can see.
 *
 * ## The exit code is not evidence
 *
 * `TARGET=aarch64-wasi32 ./exe.sh <elf>` exits 0 on translations it already knows are
 * broken, and this was measured, not assumed. Lifting a static
 * `int main(void){ return 42; }` — 659 KB from clang-16 `-O0 -static` — printed six
 * cheerful `INFO` lines, exited 0, produced a 5.66 MB artifact, and left **174
 * distinct addresses untranslated**. Sampling them found real SVE instructions
 * (`ld1b`, `st1b`, `whilelo`, `ptrue`) inside glibc's `__memcpy_a64fx`. Each one is a
 * `__ecv_warning` call in the emitted IR, which at runtime is
 * `elfconv_runtime_error(...)` — an abort. Nothing on stdout or stderr said so.
 *
 * So this driver establishes three things separately, and reports all three:
 *
 * 1. **What the toolchain said.** `scan.ts` parses `[Bug] …`, `[WARNING] …` and
 *    `Unrecognized system register …` into structured findings, and surfaces
 *    anything diagnostic-looking it could not parse.
 * 2. **What the toolchain did not say.** Two of the four message forms are compiled
 *    out of this image (`WARNING_OUTPUT` is off), so decode failures are *silent*.
 *    They are recovered by disassembling the intermediate bitcode and collecting the
 *    addresses passed to `__ecv_warning` — the lifter's own record of what it gave
 *    up on, read from where it actually wrote it.
 * 3. **What it cannot know.** Whether an untranslated address is ever reached is a
 *    reachability question this driver does not answer, and says so rather than
 *    implying either answer. See {@link REACHABILITY_BLIND_SPOT}.
 *
 * Reading `__ecv_warning` call sites out of the toolchain's own IR is not the static
 * analysis this project deleted. That gate parsed a *guest's* instruction stream to
 * predict whether it would diverge. This reads a *build log* that happens to be
 * stored in bitcode instead of on stdout, and predicts nothing.
 *
 * ## Success with reservations, not failure
 *
 * A lift with findings is reported as a success carrying named reservations, not as
 * a failure, and the reason is the measurement above: the smallest possible input
 * already has 174 of them. A driver that refused those would refuse everything and
 * be deleted within a week — and it would be wrong to refuse them, because the
 * untranslated code may be an ifunc variant this deployment never selects.
 *
 * It is equally not a clean success. So {@link LiftOutcome} splits its `ok: true`
 * arm on {@link LiftVerdict}, and {@link LiftedArtifact} carries `findings`,
 * `undecoded` and `blindSpots` as required fields beside the bytes. There is no
 * accessor that yields the bytes alone and no unwrap helper — the same shape
 * `CoveredAggregate` uses for coverage, and for the same reason: a number that has
 * lost its denominator looks like an answer. Being honest about the limit: this
 * makes ignoring the reservations a deliberate act rather than an impossible one.
 * TypeScript cannot do better without making the ordinary path unusable.
 *
 * ## Why the input is renamed
 *
 * `elfconv.sh` compiles the input's *file name* into the artifact
 * (`-DELFNAME="${ELFNAME}"`), and it lands in the binary — `strings` finds it. Two
 * byte-identical inputs under two names therefore lift to two different artifacts,
 * which would make the cache key a lie. Every input is staged as `subject.elf`, so
 * the artifact depends on the bytes and not on where they came from.
 *
 * ## What was measured on this host, and what was not
 *
 * Two lifts of identical bytes, ten minutes apart, produced byte-identical artifacts
 * (`sha256 490eeed5…`). That is **same-host** reproducibility. Cross-machine identity
 * is unmeasured and is not claimed anywhere: elfconv's virtual-register promotion
 * pass iterates a pointer-keyed `std::unordered_map` and a `std::set<BBBag*>`, whose
 * order shapes the emitted IR. See {@link CROSS_MACHINE_BLIND_SPOT}.
 *
 * Node-only. Uses `node:*` freely.
 */

import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { sha256 } from '@o2/core'
import { describeKeyFailure, screenElf, translationCid } from '@o2/aot'
import type {
  ElfFacts,
  ElfRefusal,
  KeyFailure,
  ToolchainVersions,
  TranslationKey,
  TranslationRecord,
} from '@o2/aot'
// Reaching into `@o2/net` for a hash looks wrong on sight, so: `blockCid` is not a
// convenience. It is *the function the fetching path verifies a fetched block with*
// (`block.ts`, `FetchingBlockstore.#fetchAndVerify`), and `MemoryBlockstore.put` and
// `FsBlockstore.put` compute the identical two lines. `TranslationRecord.artifactCid`
// has to be the CID a node looks the artifact up by, so defining a fifth copy of those
// two lines here is exactly the drift `blockCid`'s own doc warns about — and the copy
// that drifts produces a well-formed CID that no `blockstore.get` ever answers.
//
// Neither import closes a cycle and neither adds a forbidden edge: this file is a
// build-time driver outside every package's `src`, so `purity.node.test.ts` does not
// see it, and both packages are portable ones a tool may depend on.
import { blockCid } from '@o2/net'
import { readTargetFeatures } from './features.ts'
import type { DeclaredFeature, FeatureFailure } from './features.ts'
import { describeFinding, scanToolchainOutput } from './scan.ts'
import type { LiftFinding, UnparsedDiagnostic } from './scan.ts'

export type { DeclaredFeature, FeatureFailure } from './features.ts'
export type { LiftFinding, ToolchainScan, UnparsedDiagnostic } from './scan.ts'
export { describeFinding, scanToolchainOutput, scanStream } from './scan.ts'
export { describeFeatureFailure, readTargetFeatures } from './features.ts'

/**
 * The only target this driver emits.
 *
 * `aarch64-wasm` is the Emscripten path: it needs JS glue and is built `-pthread`
 * with shared memory, which the browser tier cannot use (COOP/COEP is unavailable on
 * the declared hosting target) and which is a determinism source besides.
 * `aarch64-native` is not WASM at all.
 */
export const LIFT_TARGET = 'aarch64-wasi32'

/** Mutable. Resolved to a digest before anything is run — see {@link resolveImage}. */
export const ELFCONV_IMAGE_TAG = 'ghcr.io/yomaytk/elfconv:arm64'

/** Twenty minutes. A 659 KB input took 95 s wall on the host this was written on. */
export const DEFAULT_TIMEOUT_MS: number = 20 * 60 * 1000

/**
 * The ceiling on `docker image inspect`, not its budget.
 *
 * The inspect is a local metadata read that answers in milliseconds, so handing it
 * the lift's whole twenty minutes would turn a wedged daemon into a twenty-minute
 * silence before anything visible happened. {@link LiftOptions.timeoutMs} still
 * applies — the *smaller* of the two wins. It previously did not apply at all: the
 * call site passed a hardcoded 60 s, so a caller asking to give up after 300 ms was
 * held for a minute, and a test written to prove the option worked would have sat
 * there proving the opposite.
 */
export const IMAGE_RESOLVE_CAP_MS: number = 60_000

/**
 * How long the best-effort container removal on {@link liftElf}'s timeout is given.
 *
 * Short on purpose. The lift has already failed by the time this runs; the only
 * question left is whether the container is still holding the work directory open,
 * and an answer that takes minutes is not worth waiting for.
 */
export const CONTAINER_REMOVE_TIMEOUT_MS: number = 30_000

export type LiftVerdict = 'clean' | 'reservations'

/**
 * Something the driver cannot see, carried with the result rather than beside it.
 *
 * Two of these are structural: no configuration of this driver removes them. They
 * travel inside {@link LiftedArtifact} for the reason `StartReport` carries its blind
 * spots as a field — a caveat kept next to a number gets separated from it the first
 * time somebody quotes the number.
 */
export type LiftBlindSpot =
  | { readonly kind: 'cross-machine-reproducibility'; readonly note: string }
  | { readonly kind: 'reachability'; readonly note: string }
  | { readonly kind: 'undecoded-unmeasured'; readonly note: string }

export const CROSS_MACHINE_BLIND_SPOT: LiftBlindSpot = {
  kind: 'cross-machine-reproducibility',
  note:
    'two lifts on one host produced byte-identical artifacts; two lifts on two hosts have ' +
    'never been compared, and elfconv promotes virtual registers by iterating a ' +
    'pointer-keyed std::unordered_map and a std::set<BBBag*> — nothing here is evidence ' +
    'about a second machine',
}

export const REACHABILITY_BLIND_SPOT: LiftBlindSpot = {
  kind: 'reachability',
  note:
    'an address elfconv did not translate aborts the artifact only if execution reaches it; ' +
    'much of what goes untranslated in a static glibc binary is an ifunc variant for a CPU ' +
    'this deployment may never present — this driver does not decide which, and neither ' +
    'reading nor ignoring these findings is safe by default',
}

export const UNDECODED_UNMEASURED_BLIND_SPOT: LiftBlindSpot = {
  kind: 'undecoded-unmeasured',
  note:
    'the intermediate bitcode could not be disassembled, so the silent decode failures were ' +
    'not counted; in this image they are the only class that leaves no trace in the output, ' +
    'and a lift without this probe cannot be called clean',
}

/**
 * The probe half-ran: it counted the call sites and got no addresses out of them.
 *
 * Same `undecoded-unmeasured` class as above, because the consequence is the same —
 * which addresses go untranslated is unknown for this lift — but a different note,
 * because the cause is not a disassembler that refused. Both greps read the same
 * file, so they can only disagree this way if the emitted call *shape* changed, and
 * saying "could not be disassembled" would send whoever reads it to the wrong place.
 */
export const UNDECODED_ADDRESSES_UNRECOVERED_BLIND_SPOT: LiftBlindSpot = {
  kind: 'undecoded-unmeasured',
  note:
    'the probe counted __ecv_warning call sites and recovered no addresses from them; both ' +
    'greps read the same disassembly, so the emitted call shape has changed and this lift ' +
    'has an unknown number of untranslated addresses rather than none',
}

/**
 * The disassembly was produced and this host could not read it back.
 *
 * Same `undecoded-unmeasured` class again, and a third note rather than a third reuse
 * of the first one. {@link UNDECODED_UNMEASURED_BLIND_SPOT} says the bitcode "could not
 * be disassembled", which is a sentence about the container; this case is reached only
 * after the container reported the disassembly it wrote, so repeating that sentence
 * here would carry D07's wrong accusation into the artifact — where it outlives the
 * failure that produced it, because a blind spot is what gets quoted later.
 */
export const UNDECODED_UNREADABLE_BLIND_SPOT: LiftBlindSpot = {
  kind: 'undecoded-unmeasured',
  note:
    'the container disassembled the bitcode and reported its call-site count, and this host ' +
    'then could not read the addresses it wrote to the bind mount — the untranslated addresses ' +
    'are unknown for this lift, and the toolchain is not what failed',
}

/**
 * Addresses the lifter gave up on without saying so.
 *
 * Recovered from `call void @__ecv_warning(…, i64 <address>, …)` in the disassembled
 * bitcode. `callSites` counts the calls and `addresses` de-duplicates them; the two
 * differ because one address can be emitted into several lifted blocks.
 *
 * ## Why a count with no addresses is its own state
 *
 * The probe is two greps over one disassembly: `grep -c 'call void @__ecv_warning('`
 * and a second pass pulling the `i64 <address>` operand out of the same calls. They
 * can disagree, and only in one direction — an inserted argument, a widened operand,
 * an `addrspace` cast, anything that changes the *shape* of the call leaves the count
 * matching and the extraction returning nothing.
 *
 * Folded into `addresses: []` that reads as "the lifter gave up on nothing", which is
 * the silent clean lift this whole driver exists to prevent, arriving this time
 * through the driver's own probe rather than through elfconv's exit code. So the
 * count-without-addresses case is {@link UndecodedProbe} `counted-only`: it carries
 * the count, it is never `clean`, and {@link describeLift} says what it is.
 *
 * Discriminated on `kind` rather than a boolean `ran`, because a boolean has room for
 * exactly the two answers that turned out not to be enough.
 */
export type UndecodedProbe =
  | {
      readonly kind: 'measured'
      readonly callSites: number
      /** Sorted ascending, de-duplicated. */
      readonly addresses: readonly bigint[]
    }
  /** Call sites counted, no address recovered from any of them. See above. */
  | { readonly kind: 'counted-only'; readonly callSites: number }
  /**
   * The probe produced no measurement, and `why` says which of three things happened.
   *
   * - `no-bitcode` — the container never wrote `undecoded-callsites`, so `llvm-dis-16`
   *   was never reached or refused the `.bc`.
   * - `disassembler-failed` — the container wrote `undecoded-probe=failed`, which is
   *   the *container* saying the disassembler did not run.
   * - `undecoded-unreadable` — the container said it ran and the host could not read
   *   what it produced. Added 2026-08-01: this case was reported as
   *   `disassembler-failed`, and that reading is refuted by the code that reaches it.
   *   Getting there requires `undecoded-callsites` to be present, and the container
   *   script writes that key and `/o2/undecoded.txt` in the same `if` branch — so by
   *   construction the disassembler had already run and succeeded. A failed read of a
   *   bind-mounted file on the *host* was being stamped with a reason that names a
   *   tool inside the container, sending whoever read it in to debug something that
   *   worked. Same family as `host-cannot-spawn`: the operation correctly failed and
   *   the refusal named the wrong component, which this project counts as a defect on
   *   its own.
   */
  | {
      readonly kind: 'not-run'
      readonly why: 'no-bitcode' | 'disassembler-failed' | 'undecoded-unreadable'
      /** Present only for `undecoded-unreadable`: the host's own read error. */
      readonly detail?: string
    }

/**
 * A translated artifact and every reservation attached to it.
 *
 * `findings`, `undecoded` and `blindSpots` are required fields, not options: there is
 * no value of this type that carries the bytes without them.
 */
export interface LiftedArtifact {
  readonly bytes: Uint8Array
  /** Derived from the fields below, never supplied. See the module comment. */
  readonly verdict: LiftVerdict
  readonly target: typeof LIFT_TARGET
  /** Everything whose change could change these bytes, for `translationCid`. */
  readonly toolchain: ToolchainVersions
  /**
   * Which keys of {@link toolchain} this lift could not establish, sorted.
   *
   * The stated-degraded half of the provenance split — the refusing half is
   * `provenance-unreadable`. `meta.txt` read, and a tool in it did not name its version:
   * `clang-16 --version` returning nothing, `WASI_VERSION_FULL` unset, `git rev-parse`
   * failing in an image built without a `.git`. That is a real and survivable state, and
   * it was previously spelled `'unknown'` inside the record and nowhere else — a string
   * among strings, in the one field that is supposed to identify things.
   *
   * Required rather than optional, and empty on a fully identified lift, for the reason
   * `blindSpots` is: a caller that has to know to ask is a caller that will not.
   *
   * **The values in {@link toolchain} are deliberately left exactly as they were.** An
   * absent key stays `'unknown'` and a present-but-empty one stays `''`, because
   * `translationCid` refuses `''` as `blank-version` and normalising the two together
   * would either lose that refusal or invent one. This field states the fact; it does
   * not edit the record the fact is about.
   */
  readonly unidentifiedTools: readonly string[]
  /** Multihash of the input, hex — the `inputDigest` half of the translation key. */
  readonly inputDigest: string
  /** Read from the artifact's own `target_features` section, never hardcoded. */
  readonly requiredFeatures: readonly string[]
  readonly declaredFeatures: readonly DeclaredFeature[]
  readonly findings: readonly LiftFinding[]
  /** Diagnostic-looking output the scanner did not recognise. See `scan.ts`. */
  readonly unparsed: readonly UnparsedDiagnostic[]
  readonly undecoded: UndecodedProbe
  /** Never empty. */
  readonly blindSpots: readonly LiftBlindSpot[]
  /**
   * What this artifact is called, and why it should be called that.
   *
   * Required for the reason the three fields above it are, and it is the same class of
   * thing: an artifact that cannot be named cannot be cached, dispatched by name, or
   * compared against another host's. There is no value of this type that carries the
   * bytes without a name for them.
   *
   * Built by {@link liftElf} from `translationCid`, at the one point where all four of
   * the key's inputs are already in hand. Before this field existed the driver assembled
   * those four inputs within twenty lines of each other and named none of them, while
   * mentioning `translationCid` twice in prose.
   */
  readonly translation: TranslationRecord
  readonly elf: ElfFacts
  readonly durationMs: number
  /** Kept whole: a finding is only actionable next to the phase that emitted it. */
  readonly stdout: string
  readonly stderr: string
}

export type LiftFailure =
  | { readonly kind: 'input-unreadable'; readonly path: string; readonly detail: string }
  /** The pre-screen refused it before the container was started. */
  | { readonly kind: 'refused-by-screen'; readonly reason: ElfRefusal }
  /**
   * `docker` itself could not be run — not there, or not executable.
   *
   * Narrowed: this used to carry every `spawn` failure, including the ones that were
   * the host refusing to fork. See {@link LiftFailure}'s `host-cannot-spawn` arm.
   */
  | { readonly kind: 'docker-unavailable'; readonly detail: string }
  /**
   * `docker` was reached and did not answer in time — a wedged or merely swamped
   * daemon, not a missing one.
   *
   * **Split out of `docker-unavailable` on 2026-08-02, for the second time this
   * distinction has had to be made.** The first was `host-cannot-spawn`: a host that
   * could not fork, described as a host without Docker, sending a reader to check an
   * installation that was fine. This is the same sentence one step later — the process
   * started, the daemon was there, and the machine was too busy for the answer to arrive
   * inside the budget.
   *
   * It matters because it is **transient and worth retrying**, which neither of the other
   * two are. `lift.node.test.ts` retries on it for exactly that reason: its
   * `despiteAFullProcessTable` wrapper already retried `host-cannot-spawn` and returned
   * immediately on this, so a whole-suite run on a loaded host turned two cases red with a
   * verdict that read as a broken installation.
   */
  | { readonly kind: 'docker-not-answering'; readonly detail: string; readonly afterMs: number }
  /**
   * The host could not create a process. This says nothing about Docker.
   *
   * Split out of `docker-unavailable` on 2026-08-01, against a reproduced failure
   * rather than a suspicion. `lift.node.test.ts` fails intermittently on a loaded
   * machine — 3 to 6 cases at a time, reported by three separate agents, always in
   * that one file — and every report read `docker-unavailable` on a host where
   * Docker was installed and working. Two code paths produced that kind, so the
   * failure output could not say which fired, and both readings sent the reader
   * somewhere useless: to `docker --version`, or to a budget that was already 44×
   * larger than it needed to be.
   *
   * Two measured populations settle it, and they do not overlap:
   *
   * | population | how long the driver takes to answer |
   * |---|---|
   * | spawn refused by the host (`EAGAIN`, `RLIMIT_NPROC` below the live process count, 6/6) | **0–3 ms** |
   * | spawn that succeeds, load average 42.7 → 54.5, 60/60, `p50` 116 ms `p90` 328 ms | **max 456 ms** |
   * | the timeout that the *other* path needs before it fires | **5 000 / 20 000 ms** |
   *
   * The second row is the refutation. At the load the failures were reported at —
   * 45–50 on 8 cores — a spawn that works costs 456 ms at worst, which is 11× under
   * the smallest budget any caller in that file hands to `resolveImage` and 44×
   * under the largest. For the timeout to have fired, spawning would have had to be
   * two orders of magnitude worse than it measurably is at that exact load. The
   * first row is what does fire, and it fires in about a millisecond — so the
   * driver was reporting "docker could not be run" a millisecond after being asked,
   * on a machine whose only problem was that it had no room for one more process.
   *
   * A refusal that names the wrong thing is a defect even when the operation
   * correctly fails. Both spawn sites route here now; `ENOENT` and `EACCES` stay in
   * `docker-unavailable`, because those two really are about `docker`.
   */
  | {
      readonly kind: 'host-cannot-spawn'
      /** What the host was asked to start, so the message is not about "a process". */
      readonly command: string
      /** `EAGAIN`, `EMFILE`, `ENFILE` or `ENOMEM` — see {@link HOST_EXHAUSTION_CODES}. */
      readonly code: string
      readonly detail: string
    }
  /**
   * The image is not present locally.
   *
   * Not pulled automatically: 6.08 GB arriving unannounced in the middle of a build
   * is not a thing a tool should decide on someone's behalf.
   */
  | { readonly kind: 'image-absent'; readonly image: string; readonly detail: string }
  /**
   * Present, but with no `RepoDigests` entry — a locally built or re-tagged image.
   *
   * Refused rather than keyed on the tag. `:arm64` is mutable, and a cache key that
   * moves when the tag does is a cache that serves the previous compiler's output.
   */
  | { readonly kind: 'image-has-no-digest'; readonly image: string }
  /**
   * Digested, but not one of the digests names the repository that was asked for.
   *
   * A named failure rather than a near-miss to be tidied up by taking the first entry
   * in the list. An image carries the `RepoDigests` of whatever it was pulled or
   * re-tagged *from*, so `ghcr.io/yomaytk/elfconv:arm64` can inspect cleanly and
   * offer only `docker.io/…@sha256:…` — a different registry's content. That digest
   * would then be the reference this driver runs, and the string it writes into
   * `toolchain['elfconv-image']` for the translation key: a build from an unknown
   * toolchain wearing a trusted name, cached under that name forever. There is
   * nothing safe to fall back to, so there is no fallback.
   */
  | {
      readonly kind: 'image-digest-foreign'
      readonly image: string
      /** What `image` asked for, with any tag or digest stripped. */
      readonly repository: string
      /** Every entry that *was* found, so the mismatch can be read rather than guessed. */
      readonly digests: readonly string[]
    }
  | {
      readonly kind: 'toolchain-failed'
      readonly exitCode: number | null
      readonly signal: string | null
      readonly findings: readonly LiftFinding[]
      readonly unparsed: readonly UnparsedDiagnostic[]
      readonly stdout: string
      readonly stderr: string
    }
  | { readonly kind: 'timed-out'; readonly afterMs: number }
  /** Exit 0 and no `.wasm`. Has happened; it is not a theoretical branch. */
  | {
      readonly kind: 'no-artifact'
      readonly detail: string
      readonly stdout: string
      readonly stderr: string
    }
  | { readonly kind: 'features-unreadable'; readonly reason: FeatureFailure }
  /**
   * `meta.txt` could not be read, so this lift has no toolchain provenance at all.
   *
   * A refusal rather than a degraded success, and the choice is the finding. The read
   * was wrapped in `catch { meta = new Map() }` with no comment, which turned one
   * unread file into all five provenance fields reading `'unknown'` on an artifact
   * still returned `ok: true` — indistinguishable from a lift whose toolchain genuinely
   * could not be identified, and emitted as the thing the adjacent comment calls the
   * cache key.
   *
   * Three facts make refusal the right arm rather than a strict one:
   *
   * 1. **`'unknown'` defeats the only guard downstream.** `translationCid` refuses a
   *    `blank-version`, so an *empty* field is caught — but `'unknown'` is not blank.
   *    Five of them produce a perfectly well-formed CID that names no particular
   *    toolchain, and it goes on matching after the compiler underneath it changes.
   *    That is the precise failure `cache-key.ts` says is "worse than no cache".
   * 2. **It is an anomaly, not a degradation.** `CONTAINER_SCRIPT` writes `/o2/meta.txt`
   *    unconditionally and *before* it copies `artifact.wasm`, and this point is only
   *    reached once `artifact.wasm` has been read from that same bind mount. A host
   *    that read one and not the other has a problem worth stopping for.
   * 3. **Nothing is lost by stopping.** The bytes are reproducible by re-running; a
   *    cache entry poisoned under a trusted key is not.
   *
   * It also removes a second wrong label the empty map produced: `readUndecoded` read
   * the missing `undecoded-callsites` as `why: 'no-bitcode'`, reporting a disassembler
   * result for a file that was never read.
   *
   * The *partial* case is deliberately not this. A `meta.txt` that reads but does not
   * name every tool is a stated-degraded result, carried on the artifact as
   * {@link LiftedArtifact.unidentifiedTools}.
   */
  | { readonly kind: 'provenance-unreadable'; readonly path: string; readonly detail: string }
  /**
   * The lift produced bytes and `translationCid` refused to name them.
   *
   * **The reachable case is concrete, not hypothetical.** {@link parseMeta} trims, so a
   * `meta.txt` line reading `clang=` yields `''` rather than `undefined`; the
   * `?? 'unknown'` fallbacks in {@link liftElf} only ever fired for a key that was
   * missing entirely, so the empty string reaches `translationCid` and comes back
   * `{kind:'blank-version', tool:'clang'}`.
   *
   * **Why the refusal is right.** A version defaulted to the string `'unknown'` produces
   * a perfectly good-looking CID that goes on matching after the compiler changed
   * underneath it — the failure `cache-key.ts` exists to prevent, and the one it calls
   * worse than no cache. Reporting a *success* here would put exactly that artifact into
   * a cache under a name claiming it is fine, which is worse than the missing artifact,
   * because the bytes are reproducible by re-running and a poisoned cache entry is not.
   *
   * Note the limit this does **not** reach: `translationCid` sees blank and only blank,
   * so a `meta.txt` that says `wasi-sdk=unknown` in so many words is still named. The
   * container writes that string itself when `WASI_VERSION_FULL` is unset, and
   * {@link unidentifiedIn} does not report it either. See {@link LiftedArtifact.unidentifiedTools}.
   */
  | { readonly kind: 'unnameable'; readonly reason: KeyFailure }

export type LiftOutcome =
  | { readonly ok: true; readonly verdict: 'clean'; readonly artifact: LiftedArtifact }
  | { readonly ok: true; readonly verdict: 'reservations'; readonly artifact: LiftedArtifact }
  | { readonly ok: false; readonly failure: LiftFailure }

export interface LiftOptions {
  /** Overridable so a test can point at a tag that does not exist. */
  readonly image?: string
  /** Overridable so a test can point at a binary that is not Docker. */
  readonly docker?: string
  readonly timeoutMs?: number
  /** Kept for inspection when a lift goes wrong. Default: removed. */
  readonly keepWorkDir?: boolean
  readonly onProgress?: (note: string) => void
}

/**
 * The script that runs inside the container.
 *
 * Fixed text with no interpolation. The only thing that varies between lifts is the
 * file staged at `/o2/in/subject.elf`, so there is nothing here for a hostile path
 * name to reach — and the same script text every time is one less input to
 * reproducibility.
 *
 * `$PWD` must be `path/to/elfconv/bin`: `elfconv.sh` checks `basename(dirname(PWD))`
 * and refuses anywhere else. The wasi32 branch writes `${ELFNAME}.wasm` relative to
 * `$PWD`, not to `ECV_OUT_DIR`, which is why the artifact is copied out explicitly.
 *
 * The 31 MB disassembly is written to the container's own `/tmp`. Writing it into the
 * bind mount instead costs seconds on a macOS Docker host and is never read from the
 * outside.
 */
const CONTAINER_SCRIPT = `
cd /root/elfconv/bin || exit 91
TARGET=aarch64-wasi32 ./exe.sh /o2/in/subject.elf
rc=$?
{
  printf 'exit=%s\\n' "$rc"
  printf 'clang=%s\\n' "$(clang-16 --version 2>/dev/null | head -1)"
  printf 'wasi-sdk=%s\\n' "\${WASI_VERSION_FULL:-unknown}"
  printf 'wasmedge=%s\\n' "$(wasmedge --version 2>/dev/null | head -1)"
  printf 'elfconv-commit=%s\\n' "$(git -C /root/elfconv rev-parse HEAD 2>/dev/null || echo unknown)"
  printf 'elflift-sha256=%s\\n' "$(sha256sum /root/elfconv/bin/elflift | cut -d' ' -f1)"
} > /o2/meta.txt
if [ -f subject.elf.wasm ]; then cp subject.elf.wasm /o2/artifact.wasm; fi
if [ -f subject.elf.bc ] && llvm-dis-16 subject.elf.bc -o /tmp/lifted.ll 2>/dev/null; then
  printf 'undecoded-callsites=%s\\n' \\
    "$(grep -cE 'call void @__ecv_warning\\(' /tmp/lifted.ll)" >> /o2/meta.txt
  grep -oE 'call void @__ecv_warning\\(ptr [^,]+, ptr [^,]+, i64 [0-9]+' /tmp/lifted.ll \\
    | grep -oE '[0-9]+$' | sort -n -u > /o2/undecoded.txt
else
  printf 'undecoded-probe=failed\\n' >> /o2/meta.txt
fi
chmod -R a+rwX /o2 2>/dev/null
exit $rc
`

interface Ran {
  readonly code: number | null
  readonly signal: string | null
  readonly stdout: string
  readonly stderr: string
  readonly timedOut: boolean
  readonly spawnError: string | null
  /**
   * `error.code` off the failed spawn — `EAGAIN`, `ENOENT`, `EACCES`, …
   *
   * Carried beside the message rather than recovered from it. The message is
   * `spawn <path> EAGAIN`, and `<path>` is a caller-supplied path that may contain
   * anything, so classifying on the message means substring-matching a string the
   * caller partly controls — a `docker` under a directory named `EAGAIN` would
   * classify itself. libuv already puts the errno in its own field; this reads that.
   */
  readonly spawnErrorCode: string | null
}

function run(command: string, args: readonly string[], timeoutMs: number): Promise<Ran> {
  return new Promise((resolve) => {
    const child = spawn(command, [...args], { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    let timedOut = false
    let spawnError: string | null = null
    let spawnErrorCode: string | null = null

    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, timeoutMs)

    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk
    })
    child.on('error', (error: Error) => {
      spawnError = error.message
      // Structurally, not through `NodeJS.ErrnoException`: this file is the only
      // place that reads it and a missing `code` is a real possibility rather than
      // a type-system edge case.
      const { code } = error as { readonly code?: unknown }
      spawnErrorCode = typeof code === 'string' ? code : null
    })
    child.on('close', (code, signal) => {
      clearTimeout(timer)
      resolve({ code, signal, stdout, stderr, timedOut, spawnError, spawnErrorCode })
    })
  })
}

/**
 * The `spawn` errnos that are the *host* running out of room.
 *
 * Every one of these says the machine could not make a new process; none of them
 * says anything at all about the command it was asked to make. `ENOENT` and
 * `EACCES` are deliberately absent — those two *are* statements about the command
 * (not there, not executable) and belong in `docker-unavailable`.
 *
 * Measured on this host on 2026-08-01. Under `RLIMIT_NPROC` reduced below the live
 * process count, 6 of 6 spawns of the test's own `#!/bin/sh` stub failed with
 * `error.code === 'EAGAIN'` and `error.message === 'spawn <path> EAGAIN'`, and each
 * came back in **0–3 ms**. See {@link LiftFailure}'s `host-cannot-spawn` arm for
 * why that number is the whole argument.
 */
const HOST_EXHAUSTION_CODES: ReadonlySet<string> = new Set(['EAGAIN', 'EMFILE', 'ENFILE', 'ENOMEM'])

/**
 * Which failure a spawn that never happened is.
 *
 * One function, consulted by both spawn sites, because the two used to return the
 * same `docker-unavailable` from two hand-written literals — and a classification
 * written twice is a classification that drifts.
 *
 * Exported for the reason {@link verdictOf} is: the `EAGAIN` arm fires only on a host
 * that has run out of process slots, which is not a state a unit test can put the
 * machine into, so an arm nothing can call directly is an arm no test can show still
 * fires. The wiring that feeds it — `run()` actually reading `error.code` — is held
 * separately by a test that reduces `RLIMIT_NPROC` in a child process.
 */
export function classifySpawnFailure(
  command: string,
  code: string | null,
  detail: string | null,
): LiftFailure {
  const message = detail ?? 'spawn failed with no message'
  return code !== null && HOST_EXHAUSTION_CODES.has(code)
    ? { kind: 'host-cannot-spawn', command, code, detail: message }
    : { kind: 'docker-unavailable', detail: message }
}

/**
 * The repository half of an image reference, with any tag or digest removed.
 *
 * Not `reference.split(':')[0]`. A registry may carry a port — `localhost:5000/o2/x`
 * — and splitting on the first colon yields `localhost`, which matches no digest at
 * all. That was survivable only while a non-matching digest set quietly fell back to
 * the first entry. Now that a mismatch is a refusal, a wrong repository here would
 * refuse a perfectly good image, so the tag is stripped only when the last colon
 * comes after the last slash — the rule the reference grammar actually uses.
 */
function repositoryOf(reference: string): string {
  const at = reference.indexOf('@')
  const named = at === -1 ? reference : reference.slice(0, at)
  const colon = named.lastIndexOf(':')
  return colon > named.lastIndexOf('/') ? named.slice(0, colon) : named
}

/**
 * The image's content address.
 *
 * `docker image inspect` rather than `docker pull`: a build must not silently acquire
 * six gigabytes, and a tag that resolved differently on two machines is exactly the
 * reproducibility hole the digest exists to close.
 */
export async function resolveImage(
  image: string,
  docker: string,
  timeoutMs: number,
): Promise<{ readonly ok: true; readonly reference: string } | { readonly ok: false; readonly failure: LiftFailure }> {
  const inspected = await run(
    docker,
    ['image', 'inspect', image, '--format', '{{join .RepoDigests "\\n"}}'],
    timeoutMs,
  )
  if (inspected.spawnError !== null) {
    return {
      ok: false,
      failure: classifySpawnFailure(docker, inspected.spawnErrorCode, inspected.spawnError),
    }
  }
  // A daemon that never answered is not a missing image. Reporting `image-absent`
  // here — which is what a bare non-zero exit check does, because a SIGKILLed client
  // exits with a null code — would send someone to pull six gigabytes they already
  // have, and they would wait for the same wedged daemon to do it.
  if (inspected.timedOut) {
    return {
      ok: false,
      failure: {
        kind: 'docker-not-answering',
        detail: `docker image inspect did not answer within ${timeoutMs} ms`,
        afterMs: timeoutMs,
      },
    }
  }
  if (inspected.code !== 0) {
    return {
      ok: false,
      failure: { kind: 'image-absent', image, detail: inspected.stderr.trim() || `exit ${inspected.code}` },
    }
  }
  const digests = inspected.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.includes('@sha256:'))
  // The repository has to match, and a mismatch is a refusal — never the first entry
  // in the list. An image carries the digests of whatever it was re-tagged from, so
  // the first entry is routinely some other registry's content, and running it would
  // put an unknown toolchain into the translation key under a trusted name.
  const repository = repositoryOf(image)
  const match = digests.find((digest) => digest.startsWith(`${repository}@`))
  if (match === undefined) {
    // Two distinct conditions with two distinct fixes: nothing to key on at all
    // (a locally built image — rebuild or push it), versus digests for somewhere
    // else (a re-tag — re-pull by the name you mean).
    return digests.length === 0
      ? { ok: false, failure: { kind: 'image-has-no-digest', image } }
      : { ok: false, failure: { kind: 'image-digest-foreign', image, repository, digests } }
  }
  return { ok: true, reference: match }
}

function parseMeta(text: string): ReadonlyMap<string, string> {
  const entries = new Map<string, string>()
  for (const line of text.split('\n')) {
    const at = line.indexOf('=')
    if (at <= 0) continue
    entries.set(line.slice(0, at), line.slice(at + 1).trim())
  }
  return entries
}

/**
 * Which of `tools` `meta` does not actually name a version for, sorted.
 *
 * Absent *and* blank both count. `parseMeta` keeps a `clang=` line with nothing after
 * the `=` as an empty string, so `meta.get('clang') ?? 'unknown'` yields `''` — the
 * `??` only ever fired for a key that was missing entirely. The two spellings reach
 * `translationCid` as different outcomes (`''` refused as `blank-version`, `'unknown'`
 * accepted), which is exactly why neither is a sound thing to report by itself.
 *
 * Exported so this list can be checked against a `meta.txt` without running a
 * container, which is the only way the partial case is reachable in a test.
 */
export function unidentifiedIn(
  meta: ReadonlyMap<string, string>,
  tools: readonly string[],
): readonly string[] {
  return tools.filter((tool) => (meta.get(tool) ?? '').trim() === '').sort()
}

function toHex(bytes: Uint8Array): string {
  let out = ''
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0')
  return out
}

/**
 * The four things that could have changed these bytes, and nothing else.
 *
 * Pure — no container, no filesystem, no `await`. A separate exported function rather
 * than four lines inlined at the call site, and the reason is what the roadmap criterion
 * asks for: it is about *the emitted* CID, i.e. the key **the pipeline builds**, and a
 * pipeline that silently dropped `requiredFeatures` from the key would pass every
 * assertion `cache-key.test.ts` makes about `translationCid` in isolation. Extracted,
 * the coverage claim is measurable by flipping one field of a fixture artifact with no
 * container anywhere in it; inlined, the only probe is a full lift per field, which
 * nobody will run.
 *
 * `features` is handed over unsorted on purpose. `translationCid` sorts and
 * de-duplicates it, so two callers cannot disagree by ordering, and doing it twice would
 * put a second place for that rule to be got wrong.
 *
 * No timing figure belongs in this comment. If one ever does, it must be measured on the
 * host that wrote it and carry the date it was measured.
 */
export function translationKeyOf(artifact: Omit<LiftedArtifact, 'translation'>): TranslationKey {
  return {
    inputDigest: artifact.inputDigest,
    target: artifact.target,
    toolchain: artifact.toolchain,
    features: artifact.requiredFeatures,
  }
}

/**
 * How many call sites the probe counted while recovering no address, or `undefined`
 * if the two agree.
 *
 * One function, consulted by both {@link verdictOf} and {@link describeLift}, because
 * a verdict and a rendering that disagree about the same probe is how "RESERVATIONS"
 * ends up printed next to "every address was translated".
 *
 * It also checks `measured`, not only `counted-only`. Construction in
 * {@link readUndecoded} cannot produce a `measured` probe with a positive count and
 * no addresses, but `verdictOf` is exported and unit-tested with hand-built values,
 * and the answer that shape would otherwise get is `clean` — the exact answer this
 * change exists to stop.
 */
function countedWithoutAddresses(undecoded: UndecodedProbe): number | undefined {
  if (undecoded.kind === 'counted-only') return undecoded.callSites
  if (undecoded.kind === 'measured' && undecoded.addresses.length === 0 && undecoded.callSites > 0) {
    return undecoded.callSites
  }
  return undefined
}

/**
 * `clean` means nothing unexplained *and* nothing unmeasured.
 *
 * An unparsed diagnostic counts against it: the scanner not recognising a line is
 * indistinguishable, from here, from the line saying something bad. So is a probe
 * that did not run, and so is a probe that counted call sites and recovered no
 * addresses — see {@link UndecodedProbe}. On this image and a glibc-static input the
 * verdict is therefore always `reservations`, and that is a fact about elfconv rather
 * than a defect here — the smallest measurable input leaves 174 addresses
 * untranslated.
 *
 * The return type stays two-valued on purpose. `cli.ts` maps `clean` to exit 0 and
 * everything else to exit 2, and every outcome added here belongs on the 2 side; a
 * third verdict would need that mapping widened to keep meaning what it says.
 */
export function verdictOf(
  findings: readonly LiftFinding[],
  unparsed: readonly UnparsedDiagnostic[],
  undecoded: UndecodedProbe,
): LiftVerdict {
  if (findings.length > 0 || unparsed.length > 0) return 'reservations'
  if (undecoded.kind === 'not-run') return 'reservations'
  if (countedWithoutAddresses(undecoded) !== undefined) return 'reservations'
  return undecoded.kind === 'measured' && undecoded.addresses.length === 0
    ? 'clean'
    : 'reservations'
}

/**
 * Which blind spots this lift has to carry, given what the probe managed.
 *
 * Exported for the same reason {@link verdictOf} is: an arm nothing can call
 * directly is an arm no test can show still fires, and a blind spot that silently
 * stopped being attached is indistinguishable from one that was never needed.
 */
export function blindSpotsFor(
  undecoded: UndecodedProbe,
  verdict: LiftVerdict,
): readonly LiftBlindSpot[] {
  const spots: LiftBlindSpot[] = [CROSS_MACHINE_BLIND_SPOT]
  if (undecoded.kind === 'not-run') {
    spots.push(
      undecoded.why === 'undecoded-unreadable'
        ? UNDECODED_UNREADABLE_BLIND_SPOT
        : UNDECODED_UNMEASURED_BLIND_SPOT,
    )
  }
  if (countedWithoutAddresses(undecoded) !== undefined) {
    spots.push(UNDECODED_ADDRESSES_UNRECOVERED_BLIND_SPOT)
  }
  if (verdict === 'reservations') spots.push(REACHABILITY_BLIND_SPOT)
  return spots
}

/**
 * The probe's three inputs — two `meta.txt` keys and one file — read into one answer.
 *
 * Exported for the reason {@link verdictOf} and {@link classifySpawnFailure} are, and
 * with a better excuse than either: every arm here is reachable from a plain directory
 * and none of them is reachable from a stubbed `docker`, because the stub would have to
 * reproduce the container script's own branch structure to get here at all. A directory
 * holding a `meta.txt` that counts call sites and no `undecoded.txt` beside it *is* the
 * `undecoded-unreadable` condition, exactly.
 */
export async function readUndecoded(
  workDir: string,
  meta: ReadonlyMap<string, string>,
): Promise<UndecodedProbe> {
  if (meta.get('undecoded-probe') === 'failed') return { kind: 'not-run', why: 'disassembler-failed' }
  const callSitesRaw = meta.get('undecoded-callsites')
  if (callSitesRaw === undefined) return { kind: 'not-run', why: 'no-bitcode' }

  let text: string
  try {
    text = await readFile(join(workDir, 'undecoded.txt'), 'utf8')
  } catch (cause) {
    // Not `disassembler-failed`. `undecoded-callsites` is present — that is the line
    // above — and the container writes that key and `/o2/undecoded.txt` in one branch,
    // so the disassembler demonstrably ran. What failed is this host reading the bind
    // mount, and the detail is the host's error rather than a guess about the tool.
    return {
      kind: 'not-run',
      why: 'undecoded-unreadable',
      detail: cause instanceof Error ? cause.message : String(cause),
    }
  }
  const addresses = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^\d+$/.test(line))
    .map((line) => BigInt(line))
  addresses.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  const callSites = Number.parseInt(callSitesRaw, 10) || 0
  // The two greps read the same file. If the count found calls the address pass could
  // not read an operand out of, the shape changed — say so instead of reporting the
  // empty list, which is indistinguishable from a lift that left nothing behind.
  if (addresses.length === 0 && callSites > 0) return { kind: 'counted-only', callSites }
  return { kind: 'measured', callSites, addresses }
}

/**
 * Stop the container this lift named, best effort.
 *
 * `child.kill()` kills the `docker` *client*. The client is a client: the daemon goes
 * on running the container it was asked to start, and `--rm` only fires when that
 * container eventually exits. So on a timeout the previous version returned
 * `timed-out` and then deleted the bind-mounted work directory out from under a
 * process still writing into it — the artifact and the disassembly land in a
 * directory that no longer exists, and on a macOS Docker host the daemon keeps a
 * 6 GB image busy indefinitely. `--name` is what makes the container reachable once
 * the client is gone; without it there is no handle at all.
 *
 * Nothing is thrown and nothing is returned. A container that will not remove is a
 * second problem, and letting it surface here would replace the timeout — the thing
 * the caller actually needs to know — with an error about cleanup.
 */
async function removeContainer(docker: string, name: string): Promise<void> {
  try {
    await run(docker, ['rm', '--force', name], CONTAINER_REMOVE_TIMEOUT_MS)
  } catch {
    // `run` resolves rather than rejects, so this only fires if `spawn` throws
    // synchronously — a bad `docker` path, which the caller has already been told
    // about by the failure it is on its way to returning.
  }
}

/**
 * Lift one AArch64 ELF to `aarch64-wasi32` WASM.
 *
 * The pre-screen runs first and on the host: it costs microseconds and rejects the
 * inputs the container would spend 95 seconds discovering are wrong — a dynamic or
 * PIE binary aborts the lifter with exit 134, and a stripped one with no `.eh_frame`
 * is an explicit hard error.
 */
export async function liftElf(elfPath: string, options: LiftOptions = {}): Promise<LiftOutcome> {
  const docker = options.docker ?? 'docker'
  const image = options.image ?? ELFCONV_IMAGE_TAG
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const progress = options.onProgress ?? ((): void => {})

  let input: Buffer
  try {
    input = await readFile(elfPath)
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause)
    return { ok: false, failure: { kind: 'input-unreadable', path: elfPath, detail } }
  }

  const bytes = new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
  const screening = screenElf(bytes)
  if (!screening.ok) return { ok: false, failure: { kind: 'refused-by-screen', reason: screening.reason } }
  progress('input accepted by the pre-screen')

  const resolved = await resolveImage(image, docker, Math.min(timeoutMs, IMAGE_RESOLVE_CAP_MS))
  if (!resolved.ok) return { ok: false, failure: resolved.failure }
  progress(`image ${resolved.reference}`)

  const workDir = await mkdtemp(join(tmpdir(), 'o2-lift-'))
  try {
    await mkdir(join(workDir, 'in'), { recursive: true })
    // Renamed, not linked: the name is compiled into the artifact. See the module
    // comment.
    await writeFile(join(workDir, 'in', 'subject.elf'), bytes)

    const started = performance.now()
    progress('lifting — expect a minute or two')
    // Named so the container survives being lost. See {@link removeContainer}. A
    // UUID and not the work directory's name: the two live in different namespaces,
    // and a container left behind by an earlier run whose temp directory has since
    // been reaped would collide and refuse to start.
    const containerName = `o2-lift-${randomUUID()}`
    const ran = await run(
      docker,
      [
        'run',
        '--rm',
        '--name',
        containerName,
        // Nothing in the pipeline fetches anything. Removing the network removes a
        // way for two runs of the same input to differ.
        '--network',
        'none',
        '-e',
        'EMSDK_QUIET=1',
        '--entrypoint',
        '/bin/bash',
        '-v',
        `${workDir}:/o2`,
        resolved.reference,
        '--login',
        '-c',
        CONTAINER_SCRIPT,
      ],
      timeoutMs,
    )
    const durationMs = performance.now() - started

    if (ran.spawnError !== null) {
      return {
        ok: false,
        failure: classifySpawnFailure(docker, ran.spawnErrorCode, ran.spawnError),
      }
    }
    if (ran.timedOut) {
      // Before the `finally` below removes the directory the container is mounted on.
      await removeContainer(docker, containerName)
      return { ok: false, failure: { kind: 'timed-out', afterMs: timeoutMs } }
    }

    const scan = scanToolchainOutput(ran.stdout, ran.stderr)
    if (ran.code !== 0) {
      return {
        ok: false,
        failure: {
          kind: 'toolchain-failed',
          exitCode: ran.code,
          signal: ran.signal,
          findings: scan.findings,
          unparsed: scan.unparsed,
          stdout: ran.stdout,
          stderr: ran.stderr,
        },
      }
    }

    let artifact: Buffer
    try {
      artifact = await readFile(join(workDir, 'artifact.wasm'))
    } catch (cause) {
      // Exit 0 with no artifact. Reported rather than turned into an empty success,
      // because an empty success is what a cache would store.
      const detail = cause instanceof Error ? cause.message : String(cause)
      return {
        ok: false,
        failure: { kind: 'no-artifact', detail, stdout: ran.stdout, stderr: ran.stderr },
      }
    }
    const artifactBytes = new Uint8Array(artifact.buffer, artifact.byteOffset, artifact.byteLength)

    const features = readTargetFeatures(artifactBytes)
    if (!features.ok) return { ok: false, failure: { kind: 'features-unreadable', reason: features.reason } }

    const metaPath = join(workDir, 'meta.txt')
    let meta: ReadonlyMap<string, string>
    try {
      meta = parseMeta(await readFile(metaPath, 'utf8'))
    } catch (cause) {
      // Refused, not defaulted to an empty map. See `provenance-unreadable`: an empty
      // map here spread `'unknown'` across all five provenance fields of an `ok: true`
      // artifact, and `'unknown'` is the one wrong value `translationCid` cannot catch.
      return {
        ok: false,
        failure: {
          kind: 'provenance-unreadable',
          path: metaPath,
          detail: cause instanceof Error ? cause.message : String(cause),
        },
      }
    }
    const undecoded = await readUndecoded(workDir, meta)
    const verdict = verdictOf(scan.findings, scan.unparsed, undecoded)

    const digest = await sha256.digest(bytes)
    const toolchain: ToolchainVersions = {
      // The digest, never the tag. `:arm64` is mutable and a mutable cache key is not
      // a cache key.
      'elfconv-image': resolved.reference,
      'elfconv-commit': meta.get('elfconv-commit') ?? 'unknown',
      'elflift-sha256': meta.get('elflift-sha256') ?? 'unknown',
      clang: meta.get('clang') ?? 'unknown',
      'wasi-sdk': meta.get('wasi-sdk') ?? 'unknown',
      wasmedge: meta.get('wasmedge') ?? 'unknown',
    }
    // `elfconv-image` is excluded because it does not come from `meta.txt` at all —
    // `resolveImage` already refused every way it could have been unidentified, and a
    // lift cannot reach here without a digest for it.
    const unidentifiedTools = unidentifiedIn(meta, [
      'elfconv-commit',
      'elflift-sha256',
      'clang',
      'wasi-sdk',
      'wasmedge',
    ])

    // Assembled without its name first, because the name is a function of it — and as
    // one literal rather than two, so the sixteen fields have one place to be wrong in.
    // Every input `translationCid` wants has been in hand at this point since long
    // before this call existed; that was the defect. The four of them were built within
    // twenty lines of each other and none of them was ever named.
    // `lifted` and not `artifact`: `artifact` is the `Buffer` read off the bind mount a
    // few lines up, and this is the value built out of it.
    const lifted: Omit<LiftedArtifact, 'translation'> = {
      bytes: artifactBytes,
      verdict,
      target: LIFT_TARGET,
      toolchain,
      unidentifiedTools,
      inputDigest: toHex(digest.bytes),
      requiredFeatures: features.features.required,
      declaredFeatures: features.features.declared,
      findings: scan.findings,
      unparsed: scan.unparsed,
      undecoded,
      blindSpots: blindSpotsFor(undecoded, verdict),
      elf: screening.facts,
      durationMs,
      stdout: ran.stdout,
      stderr: ran.stderr,
    }

    const named = await translationCid(translationKeyOf(lifted))
    if (!named.ok) return { ok: false, failure: { kind: 'unnameable', reason: named.failure } }
    // `artifactBytes` is a view over a `Buffer`'s pooled `ArrayBufferLike` and `blockCid`
    // requires a `Uint8Array<ArrayBuffer>`, so the copy is structural rather than
    // defensive — and it is what a blockstore would be handed anyway, since both of them
    // copy on `put`. If its cost is ever worth recording, measure it and write the
    // measured figure with its date; do not write a derived comparison.
    const artifactCid = await blockCid(new Uint8Array(artifactBytes))

    return {
      ok: true,
      verdict,
      artifact: { ...lifted, translation: { keyCid: named.cid, key: named.key, artifactCid } },
    }
  } finally {
    if (options.keepWorkDir !== true) await rm(workDir, { recursive: true, force: true })
  }
}

export function describeLiftFailure(failure: LiftFailure): string {
  switch (failure.kind) {
    case 'input-unreadable':
      return `${failure.path} could not be read: ${failure.detail}`
    case 'refused-by-screen':
      return `the pre-screen refused this input (${failure.reason.kind}) — no container was started`
    case 'docker-unavailable':
      return `docker could not be run: ${failure.detail}`
    case 'docker-not-answering':
      // Says nothing about the installation, for `host-cannot-spawn`'s reason: docker was
      // found and started. What is unknown is whether the image is there, so the sentence
      // must not imply it is missing — a reader sent to pull six gigabytes they already
      // have would wait on the same swamped daemon to do it.
      return (
        `docker was reached but did not answer within ${failure.afterMs} ms — the daemon is ` +
        `wedged or the host is swamped, so nothing here is known about the image or the ` +
        `lift; retry when the host is quieter: ${failure.detail}`
      )
    case 'host-cannot-spawn':
      // Deliberately says nothing about Docker, and deliberately does not reuse the
      // words "could not be run" — the whole defect was a reader being sent to check
      // an installation that was fine. The fix is on the machine, so the machine is
      // what the sentence is about.
      return (
        `this machine could not start a process (${failure.code}) — it is out of process ` +
        `slots, file descriptors or memory, so ${failure.command} was never reached and ` +
        `nothing here is known about it; retry when the host is quieter: ${failure.detail}`
      )
    case 'image-absent':
      return `${failure.image} is not present locally, and this driver does not pull 6 GB on its own: ${failure.detail}`
    case 'image-has-no-digest':
      return `${failure.image} has no RepoDigests — a locally built image cannot pin a cache key`
    case 'image-digest-foreign':
      return (
        `${failure.image} is present, but every RepoDigests entry names another repository ` +
        `(wanted ${failure.repository}, found ${failure.digests.join(', ')}) — this is a ` +
        're-tagged image, and lifting with one of those digests would run an unknown ' +
        'toolchain under a trusted name and record it in the cache key as this one; re-pull ' +
        'by the name you mean instead of re-tagging'
      )
    case 'toolchain-failed': {
      // The findings first, then the lines nothing parsed. This failure is the only
      // one carrying structured evidence and it used to render without it, which left
      // `exited 134` as the entire message — a number, for the case where the
      // toolchain had already named the instruction it choked on.
      const said = [
        ...failure.findings.map(describeFinding),
        ...failure.unparsed.map((line) => line.text),
      ]
      return (
        `elfconv exited ${failure.exitCode ?? `on signal ${failure.signal ?? 'unknown'}`}` +
        (said.length === 0 ? '' : `: ${said.join(' / ')}`)
      )
    }
    case 'timed-out':
      return `elfconv did not finish within ${Math.round(failure.afterMs / 1000)}s`
    case 'no-artifact':
      return `elfconv exited 0 and produced no .wasm: ${failure.detail}`
    case 'features-unreadable':
      return `the artifact's feature set could not be read: ${failure.reason.kind}`
    case 'provenance-unreadable':
      // Says what was lost rather than only what failed. "meta.txt could not be read"
      // reads like a missing log file; the artifact being unnameable is the point.
      return (
        `the lift produced a .wasm and its toolchain provenance could not be read from ` +
        `${failure.path} (${failure.detail}) — every version in the translation key would ` +
        `be "unknown", which is not blank enough for translationCid to refuse and not a ` +
        `toolchain, so this artifact is unnameable and was not returned`
      )
    case 'unnameable':
      // Delegated to `describeKeyFailure` rather than restated, so the codec's own
      // wording survives and the two cannot drift into two accounts of one refusal.
      return (
        `this lift produced an artifact that cannot be named: ${describeKeyFailure(failure.reason)}` +
        ` — the bytes are reproducible by re-running, and a cache entry under a name that ` +
        `identifies no particular toolchain is not`
      )
  }
}

const hex = (value: bigint): string => `0x${value.toString(16)}`

/**
 * The artifact and its reservations in one string.
 *
 * One string rather than a struct a caller renders piecemeal, so the reservations
 * survive being copied — the rule `describeStartReport` follows, learned from the
 * fact that a caveat kept beside a number gets separated from it the first time
 * somebody quotes the number.
 */
export function describeLift(artifact: LiftedArtifact): string {
  const lines: string[] = []
  lines.push(
    `${artifact.target} · ${artifact.bytes.length} bytes · ${(artifact.durationMs / 1000).toFixed(1)}s · ` +
      `${artifact.verdict.toUpperCase()}`,
  )
  lines.push(`  needs ${artifact.requiredFeatures.join(' ') || 'no features'}`)
  // Two CIDs, labelled, and inside this string rather than printed beside it by `main`.
  //
  // They answer two different questions, and the distinction is `cache-key.ts`'s own:
  // hashing the artifact answers "are these the same bytes", hashing the key answers
  // "should these be the same bytes". So the key CID names *what should have been
  // produced* and the artifact CID names *what was*, and the gap between the two answers
  // is precisely a reproducibility defect — detectable only because both are printed.
  // One of them alone is not half the measurement; it is none of it.
  //
  // Not a second rendering of the key. `describeKey` exists for that and would repeat
  // the target, the toolchain and the feature set, all three of which are already on the
  // lines around this one.
  lines.push(`  translation key cid: ${artifact.translation.keyCid.toString()}`)
  lines.push(`  artifact cid: ${artifact.translation.artifactCid.toString()}`)
  for (const [tool, version] of Object.entries(artifact.toolchain).sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(`  ${tool}: ${version}`)
  }
  // Beside the versions rather than after the findings, because this line is about the
  // lines immediately above it. `unknown` printed among five real versions is a word a
  // reader skims; naming the fields that are not identified is a sentence.
  if (artifact.unidentifiedTools.length > 0) {
    lines.push(
      `  provenance incomplete: ${artifact.unidentifiedTools.join(', ')} did not report a` +
        ' version, so the translation key does not distinguish this toolchain from another',
    )
  }
  for (const finding of artifact.findings) lines.push(`  finding: ${describeFinding(finding)}`)
  for (const line of artifact.unparsed) {
    lines.push(`  unrecognised ${line.stream}: ${line.text} — the scanner does not know this message`)
  }
  // Asked through the same helper the verdict uses, so the line and the verdict
  // cannot disagree. "every address was translated" printed under RESERVATIONS is the
  // specific sentence this ordering exists to make unreachable.
  const countedOnly = countedWithoutAddresses(artifact.undecoded)
  if (countedOnly !== undefined) {
    lines.push(
      `  the probe counted ${countedOnly} __ecv_warning call sites but recovered no addresses` +
        ' — the emitted call shape has changed, so the number of untranslated addresses is' +
        ' unknown rather than zero',
    )
  } else if (artifact.undecoded.kind === 'measured') {
    const { addresses, callSites } = artifact.undecoded
    lines.push(
      addresses.length === 0
        ? '  every address was translated'
        : `  not translated, silently: ${addresses.length} addresses over ${callSites} call sites` +
          ` — ${addresses.slice(0, 6).map(hex).join(' ')}${addresses.length > 6 ? ' …' : ''}`,
    )
  }
  for (const spot of artifact.blindSpots) lines.push(`  not known: ${spot.note}`)
  return lines.join('\n')
}
