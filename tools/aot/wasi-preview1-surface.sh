#!/bin/bash
# What WASI preview1 actually supplies, read out of the sysroot's own archives.
#
# Runs INSIDE the digest-pinned elfconv image with a writable output directory at /out and
# NOTHING ELSE MOUNTED. It reads only the image's own wasi-sdk, so it takes no /repo mount
# and must never be given one: a container harness that can write to the working tree can
# redden the two specs that snapshot `git status --porcelain` around themselves
# (`packages/node/src/discover-arm.node.test.ts`, `packages/node/src/bench-attestation.node.test.ts`).
# Because it is not in the image and there is no /repo, the caller pipes it on stdin:
#
#   docker run --rm -v "$OUTDIR":/out --entrypoint /bin/bash "$IMAGE" -c 'bash /dev/stdin' \
#     < tools/aot/wasi-preview1-surface.sh
#
# WHY THIS SHAPE. `elfconv-differential.sh`'s docblock states four rules that were paid for by
# a harness which reported a green over a build that had FAILED. All four apply here:
#
#   1. delete before building, so a stale artifact cannot be read as a fresh success
#   2. read the exit code with NO pipe on the same line as the command
#   3. abort outright on failure rather than reporting anything
#   4. publish a digest of what actually ran
#
# And one rule this harness adds, because an ABSENCE is what it exists to report: an
# instrument that read nothing and a library that contains nothing are indistinguishable in
# the output, so both are guarded. `nm` failing is exit 31, not an empty `provided.txt`; and
# the probe carries a control group of five symbols that MUST come back present, which the
# host-side spec asserts before it believes any absence.
#
# WHAT `provided.txt` MEANS, PRECISELY. It is the set of globally defined symbols present in
# ANY archive of the preview1 sysroot -- `libc.a`, `libc++.a`, and also the opt-in archives
# `libsetjmp.a`, `libdl.a`, `libpthread.a`, `libwasi-emulated-signal.a` and friends, which are
# NOT linked unless the link line asks for them. So "present" here means "linkable against
# this sysroot", not "linked by default", and it is emphatically not "works": several of these
# archives are stubs that fail at run time. A gate subtracting from this set is measuring the
# generous bound, which is the correct direction -- an undefined symbol it does not predict
# would be a false negative, and this set cannot produce one.
#
# The preview1 sysroot specifically (`lib/wasm32-wasi`), not the threads or p2 variants,
# because preview1 is the tier `packages/aot/src/wasi-executor.ts` executes.
#
# Exit codes: 0 report written; 30 no wasi-sdk; 31 nm failed or read too few symbols;
#             32 smoke compile failed or produced nothing.

set -u

OUT=${OUT:-/out}
MIN_PROVIDED=${MIN_PROVIDED:-1000}

# Same resolution as `elfconv-differential.sh:34`, so the two harnesses cannot disagree
# about which toolchain the image supplies.
WASI_SDK_PATH="${WASI_SDK_PATH:-$(ls -d /root/wasi-sdk* 2>/dev/null | head -1)}"

mkdir -p "$OUT"

# (30) An absent toolchain is a NAMED failure, never an empty report. This is the difference
# between "preview1 provides nothing" and "nothing was measured", and the whole value of the
# report depends on them not being confusable.
if [ -z "$WASI_SDK_PATH" ] || [ ! -d "$WASI_SDK_PATH" ] || [ ! -x "$WASI_SDK_PATH/bin/clang++" ]; then
  echo "no wasi-sdk under /root (resolved to '${WASI_SDK_PATH}')" >&2
  exit 30
fi

SYSROOT="$WASI_SDK_PATH/share/wasi-sysroot"
LIBDIR="$SYSROOT/lib/wasm32-wasi"

# ---- toolchain identity (T-26-05: a measurement nobody can reproduce is a repudiation) ----
# Written to files first so each exit code is read on the line immediately after its command
# with no pipe; the text extraction happens afterwards, separately.
"$WASI_SDK_PATH/bin/clang++" --version > "$OUT/clang-version.txt" 2>&1
CLANG_VERSION_EXIT=$?
[ "$CLANG_VERSION_EXIT" -eq 0 ] || { echo "clang++ --version failed ($CLANG_VERSION_EXIT)" >&2; exit 30; }

"$WASI_SDK_PATH/bin/clang++" -dumpmachine > "$OUT/target-triple.txt" 2>&1
TRIPLE_EXIT=$?
[ "$TRIPLE_EXIT" -eq 0 ] || { echo "clang++ -dumpmachine failed ($TRIPLE_EXIT)" >&2; exit 30; }

CLANG_VERSION=$(head -1 "$OUT/clang-version.txt")
TARGET_TRIPLE=$(head -1 "$OUT/target-triple.txt")

SYSROOTS=$(ls -1 "$SYSROOT/lib" 2>/dev/null | sort | tr '\n' ' ')

# ---- the provided set (AOTW-03) --------------------------------------------------------
# `--defined-only` still writes "no symbols" notes to stderr for empty archive members
# (libc++experimental.a's keep.cpp.o is one); those are notes, not failures, and nm still
# exits 0. Keeping stderr in its own file rather than merging it into the symbol stream is
# what lets the filter below stay a pure field extraction.
rm -f "$OUT/nm-raw.txt" "$OUT/nm-err.txt" "$OUT/provided.txt"
"$WASI_SDK_PATH/bin/llvm-nm" --defined-only --no-sort "$LIBDIR"/*.a > "$OUT/nm-raw.txt" 2>"$OUT/nm-err.txt"
NM_EXIT=$?

# Filtering is a SEPARATE step, after the exit code is captured. llvm-nm prints
# `<addr> <TYPE> <name>` for a defined symbol, blank lines and `member.o:` headers between
# archive members. Uppercase type letters are the global ones -- T text, W weak, D data,
# B bss, R rodata, V weak object. Lowercase are file-local and are not part of the surface
# anything can link against.
awk 'NF == 3 && $2 ~ /^[TWDBRV]$/ { print $3 }' "$OUT/nm-raw.txt" | sort -u > "$OUT/provided.txt"
PROVIDED_COUNT=$(wc -l < "$OUT/provided.txt")
PROVIDED_COUNT=$((PROVIDED_COUNT + 0))
ARCHIVE_COUNT=$(ls -1 "$LIBDIR"/*.a 2>/dev/null | wc -l)
ARCHIVE_COUNT=$((ARCHIVE_COUNT + 0))

# (31) Zero symbols over zero archives means nm failed, not that preview1 provides nothing.
# `elfconv-differential.node.test.ts:124-131` records the same distinction on the ldd side --
# "zero matches over zero lines would mean ldd failed" -- and this repository has already been
# bitten once by a guard that could not tell those two apart.
if [ "$NM_EXIT" -ne 0 ] || [ "$PROVIDED_COUNT" -lt "$MIN_PROVIDED" ]; then
  echo "llvm-nm exit $NM_EXIT over $ARCHIVE_COUNT archives yielded $PROVIDED_COUNT symbols (floor $MIN_PROVIDED)" >&2
  head -5 "$OUT/nm-err.txt" >&2
  exit 31
fi

# ---- the probe (AOTW-03) ----------------------------------------------------------------
# A fixed, ORDERED list rather than a glob, so a future reader can see exactly what was asked
# and a drifted answer is attributable to a named symbol. The harness MEASURES; it asserts
# nothing. The spec judges -- including judging the control group, which must come back
# present or every absence below it is meaningless.
PROBE_SYMBOLS="\
process:fork process:vfork process:execv process:execve process:execvp process:posix_spawn \
process:wait process:waitpid process:wait4 process:system process:popen process:pipe \
signals:signal signals:sigaction signals:raise signals:kill signals:sigprocmask \
jumps:setjmp jumps:_setjmp jumps:sigsetjmp jumps:longjmp jumps:siglongjmp \
unwinding:_Unwind_RaiseException unwinding:__cxa_allocate_exception unwinding:__cxa_throw \
dynamic:dlopen dynamic:dlsym dynamic:dlclose \
sockets:socket sockets:connect sockets:bind sockets:listen \
threads:pthread_create threads:pthread_mutex_lock \
control:printf control:malloc control:memcpy control:write control:exit"

PROBE_JSON=""
PROBE_FIRST=1
for entry in $PROBE_SYMBOLS; do
  family=${entry%%:*}
  symbol=${entry#*:}
  grep -qxF "$symbol" "$OUT/provided.txt"
  FOUND=$?
  if [ "$FOUND" -eq 0 ]; then present=true; else present=false; fi
  [ "$PROBE_FIRST" -eq 1 ] || PROBE_JSON="$PROBE_JSON,"
  PROBE_JSON="$PROBE_JSON
    {\"symbol\":\"$symbol\",\"present\":$present,\"family\":\"$family\"}"
  PROBE_FIRST=0
done

# ---- the smoke module (AOTW-02) ----------------------------------------------------------
# Compiled here, NOT run here. Running it is the host-side spec's job, under the shim this
# project actually ships -- that is the whole point of AOTW-02, and a module executed by the
# container's own runtime would prove nothing about the tier the fabric uses.
cat > "$OUT/smoke.cc" <<'CC'
// One translation unit, one `main`, no exceptions: wasi-sdk-24's libc++ has no EH
// (`wasm-ld: undefined symbol: __cxa_allocate_exception`), so a throw here would fail to
// link and the failure would read as a toolchain problem rather than as this file's.
#include <cstdio>

int main() {
  std::puts("O2 preview1 smoke ok");
  return 0;
}
CC

# (1) delete BEFORE the compile, so a stale artifact from a previous run of the same /out
# cannot be read as a fresh success. This is the specific failure `elfconv-differential.sh`
# records, reproduced here because the same /out is reused across local iterations.
rm -f "$OUT/smoke.wasm"
"$WASI_SDK_PATH/bin/clang++" --target=wasm32-wasi -O1 -o "$OUT/smoke.wasm" "$OUT/smoke.cc" > "$OUT/smoke.log" 2>&1
SMOKE_EXIT=$?

# (32) A compile that exits non-zero, and a compile that exits 0 having produced nothing, are
# both failures -- and the second is the one that matters, because this project's standing
# rule is that a tool's exit code is never the evidence.
if [ "$SMOKE_EXIT" -ne 0 ] || [ ! -f "$OUT/smoke.wasm" ]; then
  echo "smoke compile exit $SMOKE_EXIT, artifact present: $([ -f "$OUT/smoke.wasm" ] && echo yes || echo no)" >&2
  head -20 "$OUT/smoke.log" >&2
  exit 32
fi

SMOKE_BYTES=$(stat -c %s "$OUT/smoke.wasm")
SMOKE_BYTES=$((SMOKE_BYTES + 0))
# (4) publish a digest of the thing that actually ran, so the caller can tell WHICH artifact
# it executed.
SMOKE_SHA=$(sha256sum "$OUT/smoke.wasm" | cut -d' ' -f1)

# ---- the report --------------------------------------------------------------------------
# Emitted with a heredoc rather than a JSON tool, because the image is not guaranteed to have
# one and a report that depends on `jq` being installed is a report that silently stops
# existing. `sysroots` is built from a space-separated list into a JSON array by hand for the
# same reason.
#
# `image` is the digest the CALLER passed in as `IMAGE_DIGEST`, echoed back so the host-side
# spec can assert the report it is reading came out of the pinned image rather than out of
# whatever `docker run` happened to resolve. Matches `elflift-wasi-gate.sh`'s own `image`
# field, including its `unrecorded` fallback, so the two harnesses cannot disagree about the
# name of the thing they measured. Without it the surface spec could only assert its own
# constant against a regex, which is a statement about the constant and not about the run.
IMAGE_DIGEST_ECHO="${IMAGE_DIGEST:-unrecorded}"

SYSROOTS_JSON=""
FIRST=1
for s in $SYSROOTS; do
  [ "$FIRST" -eq 1 ] || SYSROOTS_JSON="$SYSROOTS_JSON,"
  SYSROOTS_JSON="$SYSROOTS_JSON\"$s\""
  FIRST=0
done

cat > "$OUT/surface.json" <<JSON
{
  "image": "$IMAGE_DIGEST_ECHO",
  "wasiSdkPath": "$WASI_SDK_PATH",
  "clangVersion": "$CLANG_VERSION",
  "targetTriple": "$TARGET_TRIPLE",
  "sysroots": [$SYSROOTS_JSON],
  "libDir": "$LIBDIR",
  "archiveCount": $ARCHIVE_COUNT,
  "nmExit": $NM_EXIT,
  "providedCount": $PROVIDED_COUNT,
  "probe": [$PROBE_JSON
  ],
  "smoke": { "exit": $SMOKE_EXIT, "bytes": $SMOKE_BYTES, "sha256": "$SMOKE_SHA" }
}
JSON

# The container runs as root; without this the host-side spec cannot read what root wrote.
# Matches `elfconv-differential.sh:152`.
chmod -R a+rwX "$OUT" 2>/dev/null
echo "surface written to $OUT/surface.json ($PROVIDED_COUNT symbols over $ARCHIVE_COUNT archives)"
