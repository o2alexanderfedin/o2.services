#!/bin/bash
# Differential harness for third_party/elfconv's ELF loader.
#
# Runs INSIDE ghcr.io/yomaytk/elfconv:arm64 with the repository mounted at /repo and a
# writable output directory at /out. Lifts each fixture TWICE -- once with the stock lifter
# shipped in the image, once with this repository's fork built from source -- and reports both
# results as JSON so a test can assert on them.
#
# WHY THIS SHAPE, AND WHY IT MUST NOT BE SIMPLIFIED BACK:
#
# An earlier version reported REGRESSION=NONE_BITCODE_IDENTICAL over a build that had FAILED.
# It piped ninja through grep, so `$?` was grep's; the copy of the previously-built, STALE
# binary then succeeded and was read as build success, and the "patched" lift ran the
# unpatched binary -- which makes an identical digest true by construction. It nearly buried a
# real defect. Hence, and none of these is optional:
#
#   1. delete the binary BEFORE building, so a stale one cannot be mistaken for a fresh one
#   2. read the builder's exit code with NO pipe on the same line
#   3. abort outright on a non-zero build rather than reporting anything
#   4. publish the fresh binary's digest, so the caller can see WHICH binary produced the run
#
# Exit codes: 0 report written; 20 cmake; 21 ninja; 22 no binary; 23 fixture missing.

set -u

REPO=${REPO:-/repo}
OUT=${OUT:-/out}
SRC="$REPO/third_party/elfconv"
FIXTURES="$REPO/tools/aot/fixtures/elf"
LIFTER=/root/elfconv

# `elfconv.sh` stage 2 needs this or it dies with "/bin/clang++: No such file or directory"
# and only the ELF -> bitcode half is ever exercised.
export WASI_SDK_PATH="${WASI_SDK_PATH:-$(ls -d /root/wasi-sdk* 2>/dev/null | head -1)}"

# The subjects. Each names a distinct path through the loader:
#   hello_static           .symtab            -> LoadStaticSymbols
#   hello_static_stripped  .eh_frame          -> GetSblFromEhFrame (the whole libdwarf half)
#   hello_dynamic          .symtab, no ifuncs
#
# `gcc_hello` is generated here rather than committed, and it is NOT redundant with
# hello_static. The committed fixtures carry only 2 symbols whose bfd-era name-joined size
# differed from their own, and neither is material -- the two arms come out byte-identical on
# them, so they cannot witness the sizing change at all. A freshly linked static glibc binary
# carries ~15, including `free_mem` eight times over, and the arms DO differ on it. Without
# this subject the harness would report "identical everywhere" and be read as proof that the
# sizing change is a no-op, which it is not.
SUBJECTS=${SUBJECTS:-"hello_static hello_static_stripped hello_dynamic gcc_hello"}

mkdir -p "$OUT/gen"

# Generated subject. Absolute digests are not stable across image rebuilds; that costs nothing
# here because every assertion on it is a COMPARISON BETWEEN THE TWO ARMS of the same run.
if printf '%s' "$SUBJECTS" | grep -q gcc_hello; then
  cat > "$OUT/gen/gcc_hello.c" <<'C'
#include <stdio.h>
int main(void) { printf("hello aarch64\n"); return 0; }
C
  gcc -static -O2 -o "$OUT/gen/gcc_hello" "$OUT/gen/gcc_hello.c" || exit 23
fi

subject_path () {  # fixtures first, then generated
  if [ -f "$FIXTURES/$1" ]; then printf '%s' "$FIXTURES/$1"; else printf '%s' "$OUT/gen/$1"; fi
}

lift_one () {  # $1 = fixture name, $2 = arm label ; emits one JSON object
  local name=$1 arm=$2
  local subject
  subject=$(subject_path "$name")
  [ -f "$subject" ] || return 23
  cd "$LIFTER/bin" || return 23
  rm -f ./*.bc ./*.wasm ./*.ll 2>/dev/null
  cp -f "$subject" "./$name"
  env TARGET=aarch64-wasi32 ./exe.sh "./$name" > "$OUT/lift-$arm-$name.log" 2>&1
  local rc=$?
  local funcs bc wasm wbytes
  funcs=$(grep -oE 'detected funcs num: [0-9]+' "$OUT/lift-$arm-$name.log" | grep -oE '[0-9]+$' | head -1)
  bc=$(sha256sum "$name.bc" 2>/dev/null | cut -d' ' -f1)
  wasm=$(sha256sum "$name.wasm" 2>/dev/null | cut -d' ' -f1)
  wbytes=$(stat -c %s "$name.wasm" 2>/dev/null)
  # Keep BOTH arms' artifacts so an e2e test can EXECUTE them rather than trust a digest.
  # Both, not just the ported one: where the two differ on purpose (gcc_hello, function
  # sizing) the question is not "does the new artifact run" but "do both still run the same
  # way", and only the pair can answer that.
  if [ -f "$name.wasm" ]; then
    cp -f "$name.wasm" "$OUT/$name.$arm.wasm"
  fi
  printf '{"fixture":"%s","exit":%d,"funcs":%s,"bitcode":"%s","wasm":"%s","wasmBytes":%s}' \
    "$name" "$rc" "${funcs:-null}" "${bc:-}" "${wasm:-}" "${wbytes:-null}"
}

emit_arm () {  # $1 = arm label
  local arm=$1 first=1 out=""
  for name in $SUBJECTS; do
    local one
    one=$(lift_one "$name" "$arm") || return $?
    [ $first -eq 1 ] || out="$out,"
    out="$out$one"
    first=0
  done
  printf '[%s]' "$out"
}

BASELINE=$(emit_arm baseline) || exit $?
STOCK_SHA=$(sha256sum "$LIFTER/bin/elflift" 2>/dev/null | cut -c1-16)

# ---- build this repository's fork over the image's tree -------------------------------
# Every file the fork changes lives under lifter/ or backend/remill/{lib,include,CMakeLists.txt}.
cp -a "$SRC/lifter/." "$LIFTER/lifter/"
cp -a "$SRC/backend/remill/lib/." "$LIFTER/backend/remill/lib/"
cp -a "$SRC/backend/remill/include/." "$LIFTER/backend/remill/include/"
cp -f "$SRC/backend/remill/CMakeLists.txt" "$LIFTER/backend/remill/CMakeLists.txt"

# (1) delete first
rm -f "$LIFTER/build/lifter/elflift" "$LIFTER/bin/elflift"

# CMakeLists changed -- bfd/dwarf/elf dropped -- so this must reconfigure, not just rebuild.
cmake -S "$LIFTER" -B "$LIFTER/build" > "$OUT/cmake.log" 2>&1
CMAKE_EXIT=$?
[ "$CMAKE_EXIT" -eq 0 ] || { echo "cmake failed ($CMAKE_EXIT)" >&2; tail -20 "$OUT/cmake.log" >&2; exit 20; }

# (2) exit code read with no pipe, (3) abort on failure
ninja -C "$LIFTER/build" elflift > "$OUT/build.log" 2>&1
NINJA_EXIT=$?
[ "$NINJA_EXIT" -eq 0 ] || { echo "ninja failed ($NINJA_EXIT)" >&2; grep -E 'error:|FAILED:' "$OUT/build.log" | head -20 >&2; exit 21; }
[ -f "$LIFTER/build/lifter/elflift" ] || { echo "no binary produced" >&2; exit 22; }
cp -p "$LIFTER/build/lifter/elflift" "$LIFTER/bin/elflift"

# (4) publish the fresh binary's digest
PORTED_SHA=$(sha256sum "$LIFTER/bin/elflift" | cut -c1-16)

# The three libraries this port exists to delete, plus libiberty which came in with bfd.
ldd "$LIFTER/bin/elflift" > "$OUT/ldd.txt" 2>&1
LDD_EXIT=$?
LDD_LINES=$(wc -l < "$OUT/ldd.txt")
LDD_MATCHES=$(grep -icE 'bfd|dwarf|libelf|iberty' "$OUT/ldd.txt")

PORTED=$(emit_arm ported) || exit $?

cat > "$OUT/report.json" <<JSON
{
  "stockLifter": "$STOCK_SHA",
  "portedLifter": "$PORTED_SHA",
  "cmakeExit": $CMAKE_EXIT,
  "ninjaExit": $NINJA_EXIT,
  "linkage": { "lddExit": $LDD_EXIT, "lddLines": $LDD_LINES, "forbiddenMatches": $LDD_MATCHES },
  "baseline": $BASELINE,
  "ported": $PORTED
}
JSON

chmod -R a+rwX "$OUT" 2>/dev/null
echo "report written to $OUT/report.json"
