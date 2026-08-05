/**
 * A guest a translated artifact can finish a job with — reproducible from C held here,
 * lifted by the command a person types.
 *
 * ## Why this module exists at all
 *
 * The only real elfconv artifact ever pointed at `WasiExecutor` is a `printf("hello\n")`,
 * and it necessarily ends `not-dag-cbor`: the fabric's output codec is DAG-CBOR and the
 * guest writes ASCII. `packages/aot/src/wasi-real.node.test.ts` says so in its own words
 * — *"Producing a result from a real artifact needs a guest that speaks the codec … That
 * is a larger piece of work"*. So until now, **no lifted artifact in existence could
 * complete a job on this fabric**, and every runtime claim about the WASI path rested on
 * a fixture written by the same hand as the executor.
 *
 * The shortest correct route is an **echo**. `WasiExecutor` writes the input block onto
 * the guest's stdin, and that block is `canonicalCid(value).bytes` — already valid
 * DAG-CBOR, because that is what `packages/core/src/job/submit.ts` puts in the
 * blockstore. A guest that copies stdin to stdout therefore emits the shard's own value
 * and needs no codec knowledge of its own. It is exactly what the hand-written
 * `wasiEcho` fixture does, so the property being demonstrated is unchanged; only its
 * provenance is, and provenance is the whole point.
 *
 * ## Why the C is here rather than the binary
 *
 * The same trade `tools/aot/lift.node.test.ts` already makes for its lift subject: the
 * host is macOS with no AArch64 Linux cross-compiler, and committing a binary large
 * enough to be a real lift input would put an opaque artifact in the repository. The
 * image is an arm64 Linux userland with clang-16, so it can build its own input — and
 * the input is then auditable from a dozen lines of C rather than trusted because it is
 * checked in.
 *
 * Node-only, and outside every package's `src` for the reason `lift.ts` is: it shells
 * out to Docker and spawns processes, neither of which belongs in a portable package.
 * Nothing here runs at import time.
 */

import { execFileSync, spawnSync } from 'node:child_process'
import type { SpawnSyncReturns } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ELFCONV_IMAGE_TAG } from './lift.ts'

export { ELFCONV_IMAGE_TAG } from './lift.ts'

// ---- the guests --------------------------------------------------------------

/**
 * stdin to stdout, byte for byte, with no `<stdio.h>` anywhere in it.
 *
 * **Why `read(2)`/`write(2)` and not `printf`/`fread`.** `wasi-real.node.test.ts`
 * measured what a `printf("hello\n")` costs: glibc's stdio drags in `clock_time_get` and
 * `poll_oneoff` whether the program asks for them or not. Every glibc path the lifted
 * startup can walk is another chance of reaching one of the addresses elfconv left
 * untranslated — and each of those is a `__ecv_warning` call that at runtime is
 * `elfconv_runtime_error(...)`, i.e. an abort. Fewer glibc paths, fewer chances. **How
 * many addresses this guest leaves untranslated is unmeasured until this guest is
 * lifted**, and no count is written here: the only count in this repository was measured
 * against a different subject binary, and carrying it over would be a derivation wearing
 * a measurement's clothes.
 *
 * **Why both loops are here.** A `read` that returns short and a `write` that returns
 * short are both legal, and a guest that ignored either would emit fewer bytes than it
 * was given. That truncation surfaces as `not-dag-cbor` — the same symptom as a dozen
 * unrelated defects — and would send whoever hit it to the codec, the executor, or the
 * lift, all of which would be innocent. The loops cost four lines and remove that whole
 * class of misdirection.
 *
 * **And neither loop is exercised by anything in this repository, which is stated rather
 * than left to be assumed.** `echo-guest.node.test.ts` runs one shard whose input block
 * is **13 bytes** — measured 2026-08-04 by reading `.length` off
 * `encodeCanonical({n: 1, tag: 'echo'}).bytes` — so `read` returns the whole block on its
 * first call and `write` takes all of it in one. Changing `while (put < got)` to
 * `while (put < got - 1)` was planted against that spec and **left it green**, because a
 * single full write satisfies both bounds. The loops are correctness for an input nobody
 * has yet sent; they are not a claim this spec supports. What the spec *does* prove is
 * that the bytes leaving this guest are the bytes that arrived: flipping one bit of the
 * last byte was planted and observed red on the value itself.
 *
 * The buffer is `static` rather than automatic so it lands in `.bss` instead of on the
 * stack: the lifted code's stack discipline is elfconv's, not clang's, and a 64 KiB
 * frame is a thing to not find out about at runtime.
 *
 * Exit 0 on clean EOF, non-zero on a read or a write error — and the two are different
 * codes, so `nonzero-exit` names which end failed rather than only that one did.
 *
 * The contract is `wasiEcho`'s, stated in `packages/aot/src/fixtures/wasi-fixtures.ts` in
 * one line: *"Reads stdin to EOF, writes it back to stdout, exits 0."* It has to match
 * exactly, or a comparison between a translated run and a source-compiled one is a
 * comparison between two different programs.
 */
export const ECHO_GUEST_C: string = `#include <unistd.h>

static char buf[65536];

int main(void) {
  for (;;) {
    ssize_t got = read(0, buf, sizeof buf);
    if (got < 0) return 1;
    if (got == 0) return 0;
    ssize_t put = 0;
    while (put < got) {
      ssize_t wrote = write(1, buf + put, (size_t)(got - put));
      if (wrote <= 0) return 2;
      put += wrote;
    }
  }
}
`

/**
 * The `printf` counterpart — the negative control.
 *
 * Kept here rather than reached for in `/tmp`, because this is the falsification: it
 * shows the echo's success came from the guest speaking the codec and not from a path
 * that accepts anything. A falsification that depends on a scratch directory surviving a
 * reboot is not a falsification — that is exactly how `wasi-real.node.test.ts`'s five
 * cases went inert once, and the fixture had to be moved into the repository to fix it.
 *
 * Its lift is also the second half of *changing a covered input changes the emitted CID*:
 * two guests, one command, one host, minutes apart, so target, toolchain and required
 * feature set are equal between them and the input digest is the one covered input that
 * moved.
 */
export const HELLO_GUEST_C: string = `#include <stdio.h>

int main(void) {
  printf("hello\\n");
  return 0;
}
`

// ---- temporary directories ---------------------------------------------------

const guestDirs: string[] = []

/**
 * A temporary directory {@link cleanupGuests} will remove.
 *
 * The registration idiom `tools/aot/stubs.ts` uses, for the reason it gives: one cleanup
 * path rather than one per call site, and **removing a directory twice is a no-op**
 * (`rmSync(..., { force: true })` does not complain about a path that is not there), so
 * two specs importing this module in one process is safe.
 */
export function guestDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  guestDirs.push(dir)
  return dir
}

/** Remove every directory this module made. Call it from an importing spec's `afterAll`. */
export function cleanupGuests(): void {
  for (const dir of guestDirs) rmSync(dir, { recursive: true, force: true })
  guestDirs.length = 0
}

// ---- building a guest inside the image ---------------------------------------

/**
 * The heredoc terminator the C is written in behind.
 *
 * **Quoted at the point of use** — `<<'O2_GUEST_C_EOF'` — so the shell performs no
 * expansion on the body at all. A brace, a quote, a backslash or a `$` in the C
 * therefore cannot become shell. Interpolating the source into the `-c` string instead
 * would put this module's own constants through a shell parser for no benefit, and the
 * next person to add a guest would not know they had to think about it.
 */
const HEREDOC_TERMINATOR = 'O2_GUEST_C_EOF'

/** A container build of one small C file, on an image already on the host. */
const BUILD_TIMEOUT_MS = 5 * 60 * 1000

/**
 * Compile `source` into a static AArch64 Linux ELF, inside the toolchain image.
 *
 * Returns the host path of the ELF — `outDir` is bind-mounted at `/out`, so the binary
 * the container writes is on the host when this returns.
 *
 * `-O0 -static` and `clang-16`, the same three choices `lift.node.test.ts` makes for its
 * own subject: static because elfconv refuses a dynamic binary, `-O0` so the emitted code
 * is the C rather than the optimiser's opinion of it, and clang-16 because that is the
 * compiler in the image whose version goes into the translation key.
 *
 * `chmod a+rw` because the container runs as root and the host user has to read the
 * result back.
 *
 * Throws on a non-zero exit — `set -e` inside the script plus `execFileSync`'s own
 * behaviour — and the thrown error carries the container's stderr, which is where clang
 * puts a diagnostic. A build that failed silently would surface later as a lift of a file
 * that is not there.
 */
export function buildGuest(source: string, outDir: string, name: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(name)) {
    throw new Error(
      `guest name ${JSON.stringify(name)} is not a bare identifier — it becomes two paths inside the container`,
    )
  }
  if (source.split('\n').some((line) => line.trimEnd() === HEREDOC_TERMINATOR)) {
    throw new Error(
      `the guest source contains a line equal to ${HEREDOC_TERMINATOR}, which would end the heredoc early`,
    )
  }

  const script =
    'set -e\n' +
    `cat > /tmp/${name}.c <<'${HEREDOC_TERMINATOR}'\n${source}\n${HEREDOC_TERMINATOR}\n` +
    `clang-16 -O0 -static -o /out/${name} /tmp/${name}.c\n` +
    `chmod a+rw /out/${name}\n`

  execFileSync(
    'docker',
    [
      'run',
      '--rm',
      '--network',
      'none',
      '-e',
      'EMSDK_QUIET=1',
      '--entrypoint',
      '/bin/bash',
      '-v',
      `${outDir}:/out`,
      ELFCONV_IMAGE_TAG,
      '--login',
      '-c',
      script,
    ],
    { stdio: ['ignore', 'ignore', 'pipe'], timeout: BUILD_TIMEOUT_MS },
  )

  return join(outDir, name)
}

// ---- lifting through the command a person types ------------------------------

const CLI = fileURLToPath(new URL('./cli.ts', import.meta.url))

/**
 * A lift on this image is minutes, not seconds, and this is a wall for a hung container
 * rather than a budget anything measured. No figure derived from it belongs in a claim.
 */
const LIFT_TIMEOUT_MS = 10 * 60 * 1000

/** elfconv is loud on stderr; the default 1 MiB pipe buffer is not a bound worth hitting. */
const LIFT_MAX_BUFFER = 64 * 1024 * 1024

/** The labels `describeLift` puts the two CIDs behind. */
const KEY_CID_LABEL = 'translation key cid: '
const ARTIFACT_CID_LABEL = 'artifact cid: '

/**
 * The CID on the line carrying `label`, or `undefined` when there is no such line.
 *
 * **Off its label, never off the whole of stdout.** Both CIDs the CLI prints are
 * CIDv1 / dag-cbor / sha-256 — `packages/net/src/block.ts` and
 * `packages/aot/src/cache-key.ts` both go through dag-cbor — so both render `bafyrei…`
 * and a `/bafy[a-z0-9]+/` match cannot tell one from the other. Such a match passes just
 * as well with the two swapped, which is the mutation this phase plants; it would not be
 * a measurement. This sentence is here because a shape match is what a reader will
 * otherwise write.
 *
 * `undefined` rather than `''` when the label is absent, so a spec can assert the
 * label's *presence* instead of silently comparing two empty strings.
 */
function cidOnLine(stdout: string, label: string): string | undefined {
  const line = stdout.split('\n').find((text) => text.trim().startsWith(label))
  return line === undefined ? undefined : line.trim().slice(label.length).trim()
}

/** What running the command produced, with nothing about it judged yet. */
export interface CliLiftRun {
  /** `null` when the process was killed — a timeout, not an exit code. */
  readonly status: number | null
  readonly stdout: string
  readonly stderr: string
  /** The bytes at the `--out` path, or `undefined` when the CLI produced no file. */
  readonly artifact: Uint8Array<ArrayBuffer> | undefined
  /** Off the labelled line; `undefined` when the label is absent. */
  readonly printedKeyCid: string | undefined
  readonly printedArtifactCid: string | undefined
}

/**
 * Lift `elfPath` to `outPath` by **spawning `tools/aot/cli.ts` as a program**.
 *
 * **Why a subprocess and not a `liftElf` call.** The criterion says *a translated
 * artifact produced by `tools/aot/cli.ts`*. A helper that called the library would
 * satisfy every assertion downstream while leaving that sentence untested — and
 * `cli.ts`'s entry guard means importing the module is deliberately inert, so spawning it
 * is the only way `main` runs at all.
 *
 * **Nothing here asserts on `status`.** That belongs in the spec, and a helper that threw
 * on a non-zero exit would swallow the diagnosis: on this image a glibc-static input
 * always lands on `reservations`, so the successful code is `2`, and a failed lift's
 * stderr is the single most valuable thing this path can produce.
 */
export function liftThroughCli(elfPath: string, outPath: string): CliLiftRun {
  const run: SpawnSyncReturns<string> = spawnSync(
    process.execPath,
    ['--experimental-strip-types', CLI, elfPath, '--out', outPath],
    { encoding: 'utf8', timeout: LIFT_TIMEOUT_MS, maxBuffer: LIFT_MAX_BUFFER },
  )

  const stdout = run.stdout ?? ''
  let artifact: Uint8Array<ArrayBuffer> | undefined
  try {
    // `new Uint8Array(buffer)` over a `Buffer` copies rather than aliasing, which is what
    // `blockCid` needs: a `Buffer`'s backing store is pooled and shared with unrelated
    // reads.
    artifact = new Uint8Array(readFileSync(outPath))
  } catch {
    artifact = undefined
  }

  return {
    status: run.status,
    stdout,
    stderr: run.stderr ?? '',
    artifact,
    printedKeyCid: cidOnLine(stdout, KEY_CID_LABEL),
    printedArtifactCid: cidOnLine(stdout, ARTIFACT_CID_LABEL),
  }
}

/**
 * The six `  <tool>: <version>` lines `describeLift` prints, as a record.
 *
 * Read off the CLI's own stdout rather than recomputed, because the toolchain is the one
 * of `translationCid`'s four covered inputs that a test cannot derive independently —
 * every value in it comes from inside the container. The input digest and the feature set
 * *can* be derived independently, and in the spec they are; stating which two is which is
 * what keeps "recomputed the key" from reading as more than it is.
 *
 * Keys are matched exactly against `names`, so a seventh line the renderer grows does not
 * silently enter the key and a missing one is an absent property rather than a blank
 * string.
 */
export function toolchainFromStdout(
  stdout: string,
  names: readonly string[],
): Record<string, string> {
  const wanted = new Set(names)
  const found: Record<string, string> = {}
  for (const raw of stdout.split('\n')) {
    const line = raw.trim()
    const at = line.indexOf(': ')
    if (at <= 0) continue
    const name = line.slice(0, at)
    if (!wanted.has(name)) continue
    found[name] = line.slice(at + 2).trim()
  }
  return found
}

// ---- the host gate -----------------------------------------------------------

/**
 * The errnos {@link imageIsPresent} will ask again after.
 *
 * `lift.node.test.ts`'s set, restated rather than imported: that file keeps it private
 * and it is a gate answering a boolean, not a lift answering a `LiftFailure`.
 */
const HOST_SPAWN_RETRY_CODES: ReadonlySet<string> = new Set(['EAGAIN', 'EMFILE', 'ENFILE', 'ENOMEM'])

const HOST_SPAWN_ATTEMPTS = 3

/**
 * Is the elfconv toolchain image on this host?
 *
 * Exported so a spec gating on it does not reproduce the probe — and so the answer can be
 * *logged*, which matters more than it looks: a skipped `it.skipIf` reports green inside
 * an aggregate pass and nothing in vitest's output distinguishes it from a measurement.
 *
 * A non-zero exit from a docker that ran is the honest "not present". A spawn the *host*
 * refused is not an answer about the image, and answering `false` to it is how the only
 * real coverage of the toolchain disappears on a loaded machine with nobody told. That
 * distinction is `lift.node.test.ts`'s, and it was paid for there.
 */
export function imageIsPresent(): boolean {
  for (let attempt = 1; attempt <= HOST_SPAWN_ATTEMPTS; attempt++) {
    try {
      execFileSync('docker', ['image', 'inspect', ELFCONV_IMAGE_TAG, '--format', '{{.Id}}'], {
        stdio: ['ignore', 'ignore', 'ignore'],
        timeout: 60_000,
      })
      return true
    } catch (cause) {
      const { code } = cause as { readonly code?: unknown }
      if (typeof code !== 'string' || !HOST_SPAWN_RETRY_CODES.has(code)) return false
    }
  }
  return false
}

// ---- pointing at a lift somebody already paid for ----------------------------

/**
 * A `.wasm` this host already lifted from {@link ECHO_GUEST_C}, if there is one.
 *
 * The convention `wasi-real.node.test.ts` established with `O2_LIFTED_WASM`: a host that
 * has already spent the minutes can point at the result and skip the build. Read at
 * module scope so the value is the one the process started with, not one an earlier test
 * could have moved.
 */
export const LIFTED_ECHO: string | undefined = process.env['O2_AOT_ARTIFACT']

/** The same for {@link HELLO_GUEST_C}. */
export const LIFTED_HELLO: string | undefined = process.env['O2_AOT_HELLO']
