set -u
# Run elfconv's own test suite against THIS repository's fork, the way CI runs it:
#   docker run -w /root/elfconv/build elfconv-image "ninja test_dependencies && ctest --output-on-failure"
REPO=${REPO:-/repo}
OUT=${OUT:-/out}
SRC="$REPO/third_party/elfconv"
LIFTER=/root/elfconv
ARM=${ARM:-fork}          # `fork` overlays our tree; `stock` leaves the image untouched
mkdir -p "$OUT"

# The image ships both tools the integration test needs, but neither is on PATH under a bare
# `--entrypoint /bin/bash`; CI gets them from the image's default entrypoint. Without these the
# test fails with `/bin/clang++: not found` and `wasmedge: not found` and compares stdout
# against "" -- an environment failure that reads exactly like a lifter defect.
export WASI_SDK_PATH="${WASI_SDK_PATH:-$(ls -d /root/wasi-sdk* 2>/dev/null | head -1)}"
export PATH="$PATH:/root/.wasmedge/bin"
echo "WASI_SDK_PATH=$WASI_SDK_PATH"
echo "wasmedge: $(command -v wasmedge || echo MISSING)"

if [ "$ARM" = "fork" ]; then
  cp -a "$SRC/lifter/." "$LIFTER/lifter/"
  cp -a "$SRC/backend/remill/lib/." "$LIFTER/backend/remill/lib/"
  cp -a "$SRC/backend/remill/include/." "$LIFTER/backend/remill/include/"
  cp -f "$SRC/backend/remill/CMakeLists.txt" "$LIFTER/backend/remill/CMakeLists.txt"
fi
echo "ARM=$ARM"

cmake -S "$LIFTER" -B "$LIFTER/build" > "$OUT/ctest-cmake.log" 2>&1
CMAKE_EXIT=$?
echo "CMAKE_EXIT=$CMAKE_EXIT"
[ "$CMAKE_EXIT" -eq 0 ] || { grep -iE "CMake Error" "$OUT/ctest-cmake.log" | head -10; exit 20; }

echo "=== registered tests ==="
ctest --test-dir "$LIFTER/build" -N 2>&1 | tail -20

# Exit code read directly, no pipe -- a failed build must not be read as a passing suite.
ninja -C "$LIFTER/build" test_dependencies > "$OUT/ctest-build.log" 2>&1
NINJA_EXIT=$?
echo "NINJA_EXIT=$NINJA_EXIT"
if [ "$NINJA_EXIT" -ne 0 ]; then
  echo "BUILD FAILED — the suite is NOT reported, because nothing was built to run"
  grep -E "error:|FAILED:" "$OUT/ctest-build.log" | head -30
  exit 21
fi

ctest --test-dir "$LIFTER/build" --output-on-failure > "$OUT/ctest-$ARM.log" 2>&1
CTEST_EXIT=$?
echo "CTEST_EXIT=$CTEST_EXIT"
tail -30 "$OUT/ctest-$ARM.log"
chmod -R a+rwX "$OUT" 2>/dev/null
