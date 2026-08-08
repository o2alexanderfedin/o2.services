set -u
# Source coverage for the lifter this repository actually owns and changed.
#
# ONLY the `elflift` target is instrumented, deliberately. Instrumenting remill as well would
# rebuild ~1500 objects to report coverage of a vendored backend nobody here edits, and would
# bury the numbers that matter under it. What is measured is lifter/: Loader.cpp (the port),
# TraceManager.cpp, Lift.cpp, MainLifter.cpp.
REPO=${REPO:-/repo}
OUT=${OUT:-/out}
SRC="$REPO/third_party/elfconv"
LIFTER=/root/elfconv
FIXTURES="$REPO/tools/aot/fixtures/elf"
mkdir -p "$OUT/cov"

export WASI_SDK_PATH="${WASI_SDK_PATH:-$(ls -d /root/wasi-sdk* 2>/dev/null | head -1)}"
export PATH="$PATH:/root/.wasmedge/bin"

# clang cannot link -fprofile-instr-generate without its profile runtime, which this image
# does not ship: `cannot find libclang_rt.profile-aarch64.a`. Installed here rather than
# assumed present, and the build aborts below if it is still missing.
if ! ls /usr/lib/llvm-16/lib/clang/16/lib/linux/libclang_rt.profile-*.a >/dev/null 2>&1; then
  apt-get update -qq > "$OUT/cov/apt.log" 2>&1
  apt-get install -y -qq libclang-rt-16-dev >> "$OUT/cov/apt.log" 2>&1
  APT_EXIT=$?
  echo "APT_EXIT=$APT_EXIT"
fi
ls /usr/lib/llvm-16/lib/clang/16/lib/linux/libclang_rt.profile-*.a >/dev/null 2>&1 \
  || { echo "profile runtime STILL missing — coverage cannot be built"; tail -5 "$OUT/cov/apt.log"; exit 24; }
echo "profile runtime: $(ls /usr/lib/llvm-16/lib/clang/16/lib/linux/libclang_rt.profile-*.a)"

cp -a "$SRC/lifter/." "$LIFTER/lifter/"
cp -a "$SRC/backend/remill/lib/." "$LIFTER/backend/remill/lib/"
cp -a "$SRC/backend/remill/include/." "$LIFTER/backend/remill/include/"
cp -f "$SRC/backend/remill/CMakeLists.txt" "$LIFTER/backend/remill/CMakeLists.txt"

# Instrument the elflift target only, in the container's copy -- never in the repository.
sed -i 's#COMPILE_FLAGS "-O3 -fPIC"#COMPILE_FLAGS "-O3 -fPIC -fprofile-instr-generate -fcoverage-mapping"#' \
  "$LIFTER/lifter/CMakeLists.txt"
grep -q 'fcoverage-mapping' "$LIFTER/lifter/CMakeLists.txt" || { echo "instrumentation sed MISSED"; exit 30; }
printf '\ntarget_link_options(elflift PUBLIC -fprofile-instr-generate)\n' >> "$LIFTER/lifter/CMakeLists.txt"

rm -f "$LIFTER/build/lifter/elflift" "$LIFTER/bin/elflift"
cmake -S "$LIFTER" -B "$LIFTER/build" > "$OUT/cov/cmake.log" 2>&1
CMAKE_EXIT=$?
echo "CMAKE_EXIT=$CMAKE_EXIT"
[ "$CMAKE_EXIT" -eq 0 ] || { grep -i "CMake Error" "$OUT/cov/cmake.log" | head; exit 20; }

ninja -C "$LIFTER/build" elflift > "$OUT/cov/build.log" 2>&1
NINJA_EXIT=$?
echo "NINJA_EXIT=$NINJA_EXIT"
[ "$NINJA_EXIT" -eq 0 ] || { grep -E 'error:|FAILED:' "$OUT/cov/build.log" | head -20; exit 21; }
[ -f "$LIFTER/build/lifter/elflift" ] || { echo "NO BINARY"; exit 22; }
cp -p "$LIFTER/build/lifter/elflift" "$LIFTER/bin/elflift"
echo "INSTRUMENTED_SHA=$(sha256sum "$LIFTER/bin/elflift" | cut -c1-16)"

# ---- workload: every fixture, i.e. every loader path -------------------------------------
rm -f "$OUT/cov"/*.profraw
cd "$LIFTER/bin"
export LLVM_PROFILE_FILE="$OUT/cov/elflift-%p.profraw"
RUN=0
for f in hello_static hello_static_stripped hello_static_pie hello_dynamic hello_no_unwind ls_dynamic; do
  [ -f "$FIXTURES/$f" ] || { echo "MISSING FIXTURE $f"; continue; }
  cp -f "$FIXTURES/$f" "./$f"
  # `|| true`: hello_no_unwind and hello_dynamic are REFUSAL cases -- they abort by design,
  # and their abort path is itself code worth covering.
  ./elflift --arch aarch64 --bc_out "./$f.bc" --target_elf "./$f" > "$OUT/cov/lift-$f.log" 2>&1 || true
  RUN=$((RUN+1))
done
echo "WORKLOAD_RUNS=$RUN"
echo "PROFRAW_FILES=$(ls "$OUT/cov"/*.profraw 2>/dev/null | wc -l)"

PROFDATA=$(command -v llvm-profdata-16 || command -v llvm-profdata)
COV=$(command -v llvm-cov-16 || command -v llvm-cov)
echo "profdata=$PROFDATA cov=$COV"
"$PROFDATA" merge -sparse "$OUT/cov"/*.profraw -o "$OUT/cov/elflift.profdata"
MERGE_EXIT=$?
echo "MERGE_EXIT=$MERGE_EXIT"
[ "$MERGE_EXIT" -eq 0 ] || exit 23

echo "=== COVERAGE: lifter sources ==="
"$COV" report "$LIFTER/bin/elflift" -instr-profile="$OUT/cov/elflift.profdata" \
  "$LIFTER/lifter/Binary/Loader.cpp" "$LIFTER/lifter/TraceManager.cpp" \
  "$LIFTER/lifter/Lift.cpp" "$LIFTER/lifter/MainLifter.cpp" 2>&1 | tee "$OUT/cov/report.txt"

echo "=== per-function, Loader.cpp only ==="
"$COV" report "$LIFTER/bin/elflift" -instr-profile="$OUT/cov/elflift.profdata" \
  "$LIFTER/lifter/Binary/Loader.cpp" -show-functions 2>&1 | tail -40 | tee "$OUT/cov/loader-functions.txt"

chmod -R a+rwX "$OUT" 2>/dev/null
