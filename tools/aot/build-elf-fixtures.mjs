/**
 * Build the real AArch64 ELF fixtures the `elf.real` and `wasi-real` specs read.
 *
 * ## Why this script exists
 *
 * Those two files hold **eighteen** cases that check the ELF reader and the WASI executor
 * against binaries a real toolchain produced, rather than against byte arrays this
 * repository wrote. That is the same kind of evidence `pi(x)` is for the prime kernel:
 * the only kind a misconception shared between a component and its test cannot satisfy.
 * It has already proved its worth once — a recorded project assumption, that elfconv needs
 * *unstripped* binaries, was **false**, and only a real stripped binary that kept its
 * `.eh_frame` proved it.
 *
 * They were built by hand into `/tmp/ecvout/elf` and `/tmp` does not survive a reboot. So
 * all eighteen went inert, every `it.skipIf(FIXTURE === undefined)` reporting green by
 * reporting nothing, and stayed that way long enough to be written up as deficiency D21.
 * A fixture recipe that lives only in somebody's shell history is a guard with a
 * half-life.
 *
 * ## What it produces, and why each one exists
 *
 *   hello_static           static, symbol table intact  — must be ACCEPTED
 *   hello_static_stripped  static, no .symtab, .eh_frame kept — must be ACCEPTED, and this
 *                          is the one that falsified the "needs unstripped" assumption
 *   hello_no_unwind        static, no .symtab AND no unwind tables — must be REFUSED, the
 *                          refusal being the *conjunction* rather than either half
 *   hello_dynamic          default-gcc PIE, dynamically linked — REFUSED on three counts
 *   hello_static_pie       static-PIE, no interpreter — REFUSED
 *
 * `ls_dynamic` is copied, not compiled; see the note at the bottom.
 *
 * ## Reproducibility
 *
 * `gcc:15` on an arm64 host compiles natively, so nothing is cross-compiled and the
 * binaries are what that toolchain really emits. The image tag is pinned; a different gcc
 * would produce different section layouts, and these fixtures are only interesting
 * because they are *real* output rather than a shape somebody arranged.
 *
 *   node tools/aot/build-elf-fixtures.mjs
 */

import { execFileSync } from 'node:child_process'
import { mkdirSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const OUT = fileURLToPath(new URL('./fixtures/elf/', import.meta.url))
const IMAGE = 'gcc:15'

mkdirSync(OUT, { recursive: true })

const SOURCE = String.raw`#include <stdio.h>
int main(void) { printf("hello\n"); return 0; }
`

/**
 * One shell program, run once, so the container starts a single time.
 *
 * `hello_no_unwind` needs both halves removed explicitly. `-fno-asynchronous-unwind-tables`
 * governs what the *compiler* emits for this translation unit, and the static C runtime is
 * linked in already carrying its own — so the section survives the flag and has to be
 * removed from the linked image with `objcopy`. Doing only the flag produces a binary that
 * still has `.eh_frame`, which is `hello_static_stripped` under another name and would make
 * the refusal case assert nothing.
 */
const SCRIPT = `
set -eu
cd /out
cat > hello.c <<'EOF'
${SOURCE}EOF

gcc -static -o hello_static hello.c

gcc -static -o hello_static_stripped hello.c
strip hello_static_stripped

gcc -static -fno-asynchronous-unwind-tables -fno-unwind-tables -o hello_no_unwind hello.c
strip hello_no_unwind
objcopy --remove-section=.eh_frame --remove-section=.eh_frame_hdr hello_no_unwind

# -pie explicitly: this image's gcc defaults to no-pie, and the case that reads this
# fixture is about a PIE -- ET_DYN, an interpreter and dynamic linking together. Built
# without it the binary is ET_EXEC and the three-reason refusal loses two of its reasons.
# (No backticks in this string: it is inside a JS template literal.)
gcc -pie -fPIE -o hello_dynamic hello.c

gcc -static-pie -o hello_static_pie hello.c

# A binary this repository did NOT build. Its whole subject is provenance: the image's own
# Debian coreutils, carrying whatever a packager's toolchain did to it -- PIE, dynamically
# linked against an interpreter, and stripped. Nothing built above has that combination, so
# a locally compiled substitute would keep the case's title and lose its subject.
cp /bin/ls ls_dynamic

rm -f hello.c
chmod 0644 hello_static hello_static_stripped hello_no_unwind hello_dynamic hello_static_pie ls_dynamic
`

execFileSync(
  'docker',
  ['run', '--rm', '--platform', 'linux/arm64', '-v', `${OUT}:/out`, '-w', '/out', IMAGE, 'bash', '-c', SCRIPT],
  { stdio: 'inherit' },
)

for (const name of readdirSync(OUT).sort()) {
  console.log(`${name.padEnd(24)} ${statSync(`${OUT}${name}`).size} bytes`)
}

/*
 * ## `ls_dynamic`, and why it is copied rather than compiled
 *
 * One case -- *"refuses a distribution binary this repo did not build"* -- reads a binary
 * taken from a Linux distribution. Its whole subject is **provenance**: a binary nobody
 * here compiled, with whatever a packager's toolchain happened to do to it. This image's
 * own `/bin/ls` is exactly that -- Debian coreutils, ET_DYN with an interpreter, stripped.
 * No binary compiled above carries that combination, so a locally built substitute would
 * keep the case's title and lose its subject, which reads as covered and is worse than a
 * skip.
 *
 * It is copied out of the image rather than committed, but so is every other fixture here:
 * `tools/aot/fixtures/elf/` is gitignored on the stated ground that an opaque artifact in
 * the repository is worse than one reproducible from its source. Nothing is vendored.
 *
 * This case skipped on every host from the day it was written until 2026-08-07, because
 * the fixture was never produced by anything. `elf-fixtures.node.test.ts` now requires it
 * like the rest, so its absence is a failure with a rebuild command rather than a silence.
 */
