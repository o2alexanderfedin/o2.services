#!/bin/bash
# Link `elflift.wasm` — step 2 of the four AOTW-06 needs, and the first one that produces an
# artifact rather than a measurement.
#
#   1. compile every translation unit for wasm32-wasi   DONE (elflift-wasi-port.sh, 27/27)
#   2. link them into one .wasm                          THIS SCRIPT
#   3. run it and get bitcode out                        run-elflift-wasm.sh
#   4. compare that bitcode against native elfconv's     the acceptance test
#
# ## What it links, measured rather than guessed
#
# `llvm-nm` over the 27 objects, undefined minus defined, leaves 467 external symbols:
# 279 `llvm::`, 99 `std::`, ~70 libc, 4 `__cxa`/`_Unwind`, and 16 `google::`. The first come
# from `build-wasi-llvm.sh`, the middle three are already in the sysroot, and the last from
# `build-wasi-deps.sh`. Nothing else is outstanding.
#
# ## Reactor, not command
#
# `-mexec-model=reactor` and `--export=elfconv_lift`, not a `_start` binary. The point of
# AOTW-06 is that translation becomes a job the fabric can schedule, and a job is a function
# call, not a process. A reactor is instantiated once and called; a command has to be
# re-instantiated per lift and pays argv, exit and process semantics for nothing.
#
# **This needs `elfconv_lift` to exist.** `Lift.cpp` today has `int main()`, and ~100 lines of
# it are pure in-memory LLVM work between four process-shaped lines: `lift_set_sigaction()`
# (already `#if defined(__linux__)`), `ParseCommandLineFlags`/`InitGoogleLogging` (the FLAGS_
# are plain globals and can be assigned), `AArch64TraceManager manager(FLAGS_target_elf)`
# (reads a path) and `StoreModuleToFile(module, FLAGS_bc_out)` (writes a path). With a memory
# filesystem underneath, the last two need no change at all — write `/in.elf` from the host,
# call, read `/out.bc` back.
#
# So `MODE=command` is the default and links exactly what exists today. `MODE=reactor` is
# available for once the shim lands, and is the shape this should end up in.
#
# Usage:
#
#   bash tools/aot/link-elflift-wasm.sh 2>&1 | tee /tmp/link.log
#   MODE=reactor bash tools/aot/link-elflift-wasm.sh
#
# Exit codes: 50 no objects, 51 no LLVM archives, 52 no glog/gflags, 53 link failed,
# 54 linked but produced nothing.

set -u

ROOT=${ROOT:-/Volumes/ProjectsSSD/o2-wasi-llvm}
WASI_SDK="$ROOT/wasi-sdk"
OBJ=${OBJ:-$ROOT/obj}
LIB="$ROOT/lib"
OUTPUT=${OUTPUT:-$ROOT/elflift.wasm}
MODE=${MODE:-command}

CLANGXX="$WASI_SDK/bin/clang++"
[ -x "$CLANGXX" ] || { echo "no $CLANGXX — run build-wasi-llvm.sh first" >&2; exit 28; }

OBJECTS=$(ls "$OBJ"/*.o 2>/dev/null | wc -l | tr -d ' ')
[ "$OBJECTS" -gt 0 ] || { echo "no objects in $OBJ" >&2; exit 50; }

LLVM_ARCHIVES=$(ls "$LIB"/libLLVM*.a 2>/dev/null | wc -l | tr -d ' ')
[ "$LLVM_ARCHIVES" -gt 0 ] || { echo "no LLVM archives in $LIB — run build-wasi-llvm.sh" >&2; exit 51; }

ls "$LIB"/libglog*.a > /dev/null 2>&1 || { echo "no glog in $LIB — run build-wasi-deps.sh" >&2; exit 52; }

echo "objects:       $OBJECTS"
echo "LLVM archives: $LLVM_ARCHIVES"
echo "mode:          $MODE"

# --whole-archive is deliberately NOT used: the point of linking against archives is that the
# linker pulls only the members it needs, and elfconv references a small corner of LLVM.
# `-Wl,--gc-sections` on top, because every unreferenced section is dead weight in a module
# that has to be fetched over a network before it can run.
# `-mllvm -wasm-enable-sjlj` is NOT repeated here. It is a code-generation flag, and the code
# was already generated: clang answers `argument unused during compilation` if you pass it to
# a link. What the link does have to supply is the emulation libraries the archives reference,
# which is what the -lwasi-emulated-* below are for.
LINK_FLAGS=(
  --target=wasm32-wasi
  -O2
  -Wl,--gc-sections
  -Wl,--strip-debug
)

case "$MODE" in
  reactor)
    LINK_FLAGS+=(
      -mexec-model=reactor
      -Wl,--export=elfconv_lift
      -Wl,--export=elfconv_free
      -Wl,--export=malloc
      -Wl,--export=free
    )
    ;;
  command)
    ;;
  *)
    echo "MODE must be command or reactor, got $MODE" >&2
    exit 1
    ;;
esac

# The two Itanium C++ ABI entry points wasi-sdk's libc++abi does not define. They cannot live
# in the force-included header with the rest of the compat layer, because the objects that
# reference them are already compiled -- they have to be real symbols in the link.
COMPAT=${COMPAT:-$(cd "$(dirname "$0")" && pwd)/wasi-compat}
EH_SRC="$COMPAT/wasi-eh-abort.c"
EH_OBJ="$ROOT/wasi-eh-abort.o"
[ -f "$EH_SRC" ] || { echo "no EH stub at $EH_SRC" >&2; exit 55; }

"$WASI_SDK/bin/clang" --target=wasm32-wasi -O2 -c "$EH_SRC" -o "$EH_OBJ" 2> "$ROOT/eh-stub.log"
EXIT=$?
[ "$EXIT" -eq 0 ] || { echo "EH stub failed to compile ($EXIT)" >&2; cat "$ROOT/eh-stub.log" >&2; exit 56; }
echo "EH stub:       $EH_OBJ"

echo "=== linking ==============================================================="
# No `--start-group`/`--end-group`: wasm-ld rejects them outright -- `unknown argument` --
# and does not need them. Those flags exist to re-scan archives for a linker that walks the
# list once, and LLVM's mutually-recursive libraries defeat any single ordering under such a
# linker. wasm-ld resolves the whole set in one pass instead, so archive order does not
# matter here to begin with.
#
# `libgflags.a` is named exactly rather than globbed. The build produces `libgflags.a` and
# `libgflags_nothreads.a`, and with NO_THREADS the two are byte-for-byte the same size --
# feeding both to the linker offers it two definitions of every gflags symbol.
"$CLANGXX" "${LINK_FLAGS[@]}" \
  "$OBJ"/*.o \
  "$EH_OBJ" \
  "$LIB"/libLLVM*.a \
  "$LIB"/libglog.a \
  "$LIB"/libgflags.a \
  -lwasi-emulated-signal \
  -lwasi-emulated-mman \
  -lwasi-emulated-getpid \
  -lwasi-emulated-process-clocks \
  -o "$OUTPUT" 2> "$ROOT/link.log"
EXIT=$?

if [ "$EXIT" -ne 0 ]; then
  echo "link failed ($EXIT). Unresolved symbols, deduplicated:" >&2
  grep -oE "undefined symbol: [^ ]+" "$ROOT/link.log" | sort -u | head -40 >&2
  echo "--- full log: $ROOT/link.log ---" >&2
  tail -20 "$ROOT/link.log" >&2
  exit 53
fi

[ -f "$OUTPUT" ] || { echo "linker exited 0 and produced no file — see $ROOT/link.log" >&2; exit 54; }

echo "=== RESULT ================================================================"
ls -la "$OUTPUT"
"$WASI_SDK/bin/llvm-objdump" --section-headers "$OUTPUT" 2>/dev/null | head -20
echo
echo "imports (what the host must supply):"
"$WASI_SDK/bin/llvm-objdump" --all-headers "$OUTPUT" 2>/dev/null \
  | grep -iE "^ *import|wasi_snapshot|thread_spawn" | head -20
echo
echo "=== $OUTPUT ==="
