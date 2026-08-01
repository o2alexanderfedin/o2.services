;; The prime-counting kernel — a workload whose answer was not produced by this project.
;;
;; Every other workload here is checked against a reference this repository also wrote,
;; so a shared misconception is invisible to it: the fabric and its oracle would be
;; wrong together and agree. This one counts the primes below N, and π(x) has been
;; tabulated in the mathematical literature since Legendre. The expected values are
;; therefore an *external* oracle — the fabric can be measured against a number nobody
;; here chose.
;;
;;   BUILD — this file is not compiled by any automatic step. Run:
;;
;;     npm run build:primes --workspace @o2/demo
;;
;;   which is `node scripts/build-primes.mjs`, and emits BOTH `primes.wasm` and
;;   `primes-bytes.ts` from these bytes through the same `compileKernel` the colouring
;;   kernel uses — same wabt feature set, same `write_debug_names: false`. Compiling by
;;   any other route (a bare `wat2wasm`, a different feature set) produces different
;;   bytes, and `primes-build.node.test.ts` will refuse them. That test is the reason
;;   the route is stated here rather than remembered.
;;
;; It imports exactly the four functions of the o2 host ABI and nothing else. That list
;; *is* the sandbox: no clock, no randomness, no filesystem, and no way to acquire one,
;; because `WebAssembly.instantiate` supplies nothing else and refuses a module that
;; asks for more.
;;
;; Everything here is integer arithmetic. Not one float appears, which is what makes
;; determinism free rather than something to be enforced: the WASM specification's
;; nondeterminism list is dominated by float behaviour (NaN bit patterns, NaN sign,
;; relaxed SIMD), and a module with no floats cannot reach any of it. That is also why
;; `$isqrt` counts upward instead of calling `f64.sqrt` — the square root here decides
;; *which primes get sieved*, so an answer that is off by one at the boundary is not a
;; rounding detail, it is a wrong prime count.
;;
;;
;; ALGORITHM — a segmented sieve, split by `partition()`.
;;
;; Base primes up to √N are computed in full, once per shard, because every shard needs
;; all of them and they are far cheaper to recompute than to ship. The shard then sieves
;; only its own half-open sub-range of [2, N] and counts what survives. Splitting the
;; *range* rather than the *work of one sieve* is what makes the decomposition sound:
;; the sub-ranges are disjoint and their union is the whole domain, so the counts sum
;; with no overlap to subtract and no boundary to double-count.
;;
;; The split is exact rather than approximate. With `total = N - 1` numbers in [2, N],
;; `chunk = total / count` and `rem = total % count`:
;;
;;   lo(i) = 2 + i*chunk + min(i, rem)
;;   hi(i) = lo(i + 1)
;;
;; The `min(i, rem)` term hands the first `rem` shards one extra number each, so the
;; sub-ranges tile [2, N] exactly for any `count`, not only for counts that divide it.
;; It is written this way rather than as `total * i / count` because the latter
;; overflows i32 for large N, and an overflow here would present as a wrong prime count
;; rather than as an error.
;;
;; **That term is load-bearing and it is nearly invisible to the obvious test.** Deleting
;; it leaves the top `total mod count` numbers of [2, N] covered by no shard at all.
;; Measured by planting exactly that mutation and running the four quoted π(10^n) bounds
;; at shard counts 1..8: it was caught at **n = 1000 only**, and there only at shard
;; counts 5, 7 and 8. At 10^4, 10^5 and 10^6 every shard count still produced the right
;; total, because a power of ten sits far above the prime below it — 999 983 for 10^6 —
;; so the uncovered tail contains no prime and the sum comes out right by luck. The
;; sweep in `primes-reduce.node.test.ts` exists because of that measurement; a headline
;; assertion at 10^6 alone would certify this defect as passing.
;;
;;
;; INPUT — the DAG-CBOR byte string handed to every shard, identical across shards.
;; Shards differ only by what `partition()` tells them, exactly as the colouring kernel
;; does it — one block, content-addressed once, fetched by every node from whoever is
;; nearest.
;;
;;   header  1, 2, 3 or 5 bytes of CBOR byte-string prefix, skipped below
;;   u32 version   must be 1
;;   u32 n         the bound: count the primes p with 2 <= p <= n
;;
;; Both little-endian and read with align=1: the payload starts at a CBOR header
;; boundary, so nothing in it is naturally aligned. The 8-byte payload encodes as
;; `0x48` plus 8 bytes, so the header is one byte in practice — but the wider forms are
;; handled anyway, because the guest must not depend on the encoder's choice of width.
;;
;;
;; OUTPUT — a fixed-width strict-DAG-CBOR frame, always exactly 16 bytes:
;;
;;   a2                 map(2)
;;   61 63              text(1) "c"        -- "c" sorts before "s"
;;   48                 bytes(8)
;;   <8 bytes>          the count, little-endian
;;   61 73              text(1) "s"
;;   41                 bytes(1)
;;   <1 byte>           0 counted, 1 refused
;;
;; Fixed width is the whole trick, and it is the colouring kernel's reasoning applied to
;; a number instead of a bitmap. Strict DAG-CBOR admits exactly one encoding of a value,
;; so a guest emitting a *variable*-width field has to branch on magnitude to stay
;; minimal — and a guest that gets that branch wrong produces bytes the codec rightly
;; rejects. A count is exactly the kind of field that tempts one: 168 needs one byte,
;; 78498 needs three, and the CBOR integer rules change shape at 24, 256 and 65536. So
;; the count is emitted as a **raw 8-byte byte string** rather than as a CBOR integer.
;; Eight bytes is not a guess about magnitude — π(x) < x always, and x here is bounded
;; by MAX_N below 2^31, so 64 bits cannot be reached. There is no branch to get wrong.
;;
;; The status is a one-byte byte string for the same reason: integers below 24 must be
;; packed into the type byte, so `18 00` for zero is non-minimal and would be refused.
;;
;; A refusal emits `status = 1` with a count of **zero**, and the host side must read
;; the status rather than the count. A shard that could not run contributes zero to a
;; sum, which is indistinguishable from a range that genuinely held no primes — so
;; `readPrimeCount` throws on a refusal instead of returning the zero. Silently summing
;; a refusal would turn a failed shard into a quietly wrong π(x).

(module
  ;; ---- the entire host contact surface ----
  (import "o2" "input_len"    (func $input_len (result i32)))
  (import "o2" "input_read"   (func $input_read (param i32 i32) (result i32)))
  (import "o2" "output_write" (func $output_write (param i32 i32)))
  (import "o2" "partition"    (func $partition (result i32)))

  ;; initial === maximum. `memory.grow` can therefore never succeed, so it can never
  ;; fail *differently* on two hosts — one less way for two honest nodes to disagree.
  ;; 4 pages = 256 KiB, matching the colouring kernel. The arithmetic that fits inside
  ;; it is laid out below and totals 81 920 bytes, leaving 180 224 spare.
  (memory (export "memory") 4 4)

  ;; ---- fixed layout of linear memory ----
  ;;
  ;;   0        16 B     the output frame
  ;;   256      3 840 B  raw input bytes (the real block is 9)
  ;;   4 096    8 192 B  base-prime bitmap, one bit per integer in [0, 65536)
  ;;   16 384   32 768 B base-prime list, up to 8 192 x u32
  ;;   49 152   32 768 B segment bitmap, one bit per integer in the current segment
  ;;                     -> 81 920 bytes used of 262 144
  ;;
  ;; The two sizes worth showing the arithmetic for:
  ;;
  ;; The base bitmap is 8 KiB because 8 192 bytes x 8 = 65 536 bits, and 65 536 = √(2^32).
  ;; So the bitmap covers √N for *any* N a 32-bit guest could be handed, which is why
  ;; MAX_N can be raised later without touching the layout. π(65 536) = 6 542, so the
  ;; 8 192-entry list cannot overflow either — that bound is checked at run time anyway,
  ;; because a bound that is only argued is a bound that stops holding when the argument
  ;; is forgotten.
  ;;
  ;; The segment bitmap is 32 KiB = 262 144 bits, so one segment covers 262 144 integers.
  ;; A shard whose range is longer sieves it in several passes; a shard whose range is
  ;; shorter clears and scans only the words it uses. Bigger segments would cost cache
  ;; misses without reducing the work.
  (global $OUT       i32 (i32.const 0))
  (global $INPUT     i32 (i32.const 256))
  (global $BASE_BITS i32 (i32.const 4096))
  (global $BASE_LIST i32 (i32.const 16384))
  (global $SEG_BITS  i32 (i32.const 49152))

  (global $INPUT_ROOM i32 (i32.const 3840))
  (global $MAX_BASE   i32 (i32.const 8192))
  (global $SEG_WORDS  i32 (i32.const 8192))
  (global $SEG_SPAN   i32 (i32.const 262144))

  ;; 2^31 - 1. Chosen so that every product this kernel forms stays inside *unsigned*
  ;; i32: the largest is (√MAX_N + 1)^2 = 46341^2 = 2 147 488 281, which is above the
  ;; signed range and comfortably below 2^32. Every comparison below is therefore
  ;; unsigned, deliberately and without exception.
  (global $MAX_N   i32 (i32.const 2147483647))
  (global $VERSION i32 (i32.const 1))

  ;; ---- bit access ----

  ;; A set bit means "composite". Zeroed memory therefore reads as "everything is
  ;; prime", which is the correct starting state for a sieve rather than a coincidence.
  (func $base_bit (param $v i32) (result i32)
    (i32.and
      (i32.shr_u
        (i32.load8_u (i32.add (global.get $BASE_BITS) (i32.shr_u (local.get $v) (i32.const 3))))
        (i32.and (local.get $v) (i32.const 7)))
      (i32.const 1)))

  (func $base_set (param $v i32)
    (local $a i32)
    (local.set $a (i32.add (global.get $BASE_BITS) (i32.shr_u (local.get $v) (i32.const 3))))
    (i32.store8 (local.get $a)
      (i32.or (i32.load8_u (local.get $a))
              (i32.shl (i32.const 1) (i32.and (local.get $v) (i32.const 7))))))

  (func $seg_bit (param $k i32) (result i32)
    (i32.and
      (i32.shr_u
        (i32.load8_u (i32.add (global.get $SEG_BITS) (i32.shr_u (local.get $k) (i32.const 3))))
        (i32.and (local.get $k) (i32.const 7)))
      (i32.const 1)))

  (func $seg_set (param $k i32)
    (local $a i32)
    (local.set $a (i32.add (global.get $SEG_BITS) (i32.shr_u (local.get $k) (i32.const 3))))
    (i32.store8 (local.get $a)
      (i32.or (i32.load8_u (local.get $a))
              (i32.shl (i32.const 1) (i32.and (local.get $k) (i32.const 7))))))

  (func $min_u (param $a i32) (param $b i32) (result i32)
    (select (local.get $a) (local.get $b) (i32.lt_u (local.get $a) (local.get $b))))

  ;; ---- integer square root ----
  ;;
  ;; Counts upward rather than calling `f64.sqrt`, for the reason in the header: this
  ;; value decides which primes are sieved, so it has to be exact at the boundary
  ;; rather than nearly right. The loop runs √n times — 46 340 at the very worst, once
  ;; per shard, against a sieve that is doing far more work than that.
  (func $isqrt (param $n i32) (result i32)
    (local $r i32)
    (local.set $r (i32.const 0))
    (block $done
      (loop $up
        (br_if $done
          (i32.gt_u
            (i32.mul (i32.add (local.get $r) (i32.const 1)) (i32.add (local.get $r) (i32.const 1)))
            (local.get $n)))
        (local.set $r (i32.add (local.get $r) (i32.const 1)))
        (br $up)))
    (local.get $r))

  ;; ---- base primes up to $root, into $BASE_LIST; returns how many ----
  (func $build_base (param $root i32) (result i32)
    (local $i i32) (local $j i32) (local $n i32)

    ;; Linear memory starts zeroed and `run` is called once per instance, so this is
    ;; belt and braces — but a host that ever reused an instance would otherwise
    ;; inherit the previous shard's bitmap, and that failure would present as
    ;; nondeterminism rather than as the state bug it is.
    (local.set $i (i32.const 0))
    (block $c_done
      (loop $c
        (br_if $c_done (i32.ge_u (local.get $i) (i32.const 2048)))
        (i32.store (i32.add (global.get $BASE_BITS) (i32.shl (local.get $i) (i32.const 2))) (i32.const 0))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $c)))

    ;; Plain sieve of Eratosthenes over [2, root]. Marking starts at i*i because every
    ;; smaller multiple of i carries a smaller prime factor and has already been marked.
    (local.set $i (i32.const 2))
    (block $s_done
      (loop $s
        (br_if $s_done (i32.gt_u (i32.mul (local.get $i) (local.get $i)) (local.get $root)))
        (if (i32.eqz (call $base_bit (local.get $i)))
          (then
            (local.set $j (i32.mul (local.get $i) (local.get $i)))
            (block $m_done
              (loop $m
                (br_if $m_done (i32.gt_u (local.get $j) (local.get $root)))
                (call $base_set (local.get $j))
                (local.set $j (i32.add (local.get $j) (local.get $i)))
                (br $m)))))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $s)))

    ;; Collect. The `$MAX_BASE` guard cannot fire for any N this kernel accepts —
    ;; π(65 536) = 6 542 against 8 192 slots — but it is checked rather than argued,
    ;; because the alternative to a checked bound is a write past the end of the list.
    (local.set $n (i32.const 0))
    (local.set $i (i32.const 2))
    (block $g_done
      (loop $g
        (br_if $g_done (i32.gt_u (local.get $i) (local.get $root)))
        (if (i32.eqz (call $base_bit (local.get $i)))
          (then
            (if (i32.lt_u (local.get $n) (global.get $MAX_BASE))
              (then
                (i32.store align=1
                  (i32.add (global.get $BASE_LIST) (i32.shl (local.get $n) (i32.const 2)))
                  (local.get $i))
                (local.set $n (i32.add (local.get $n) (i32.const 1)))))))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $g)))
    (local.get $n))

  ;; ---- count the primes in the half-open range [$lo, $hi) ----
  (func $count_range (param $lo i32) (param $hi i32) (param $nbase i32) (result i64)
    (local $total i64)
    (local $seg_lo i32) (local $seg_hi i32) (local $span i32) (local $words i32)
    (local $k i32) (local $p i32) (local $start i32) (local $j i32)

    (local.set $total (i64.const 0))
    (local.set $seg_lo (local.get $lo))

    (block $segs_done
      (loop $segs
        (br_if $segs_done (i32.ge_u (local.get $seg_lo) (local.get $hi)))

        (local.set $seg_hi (i32.add (local.get $seg_lo) (global.get $SEG_SPAN)))
        (if (i32.gt_u (local.get $seg_hi) (local.get $hi)) (then (local.set $seg_hi (local.get $hi))))
        (local.set $span (i32.sub (local.get $seg_hi) (local.get $seg_lo)))

        ;; Clear only the words this segment will read: ceil(span / 32).
        (local.set $words (i32.shr_u (i32.add (local.get $span) (i32.const 31)) (i32.const 5)))
        (local.set $k (i32.const 0))
        (block $z_done
          (loop $z
            (br_if $z_done (i32.ge_u (local.get $k) (local.get $words)))
            (i32.store (i32.add (global.get $SEG_BITS) (i32.shl (local.get $k) (i32.const 2))) (i32.const 0))
            (local.set $k (i32.add (local.get $k) (i32.const 1)))
            (br $z)))

        ;; Mark the composites this segment contains.
        (local.set $k (i32.const 0))
        (block $p_done
          (loop $p_next
            (br_if $p_done (i32.ge_u (local.get $k) (local.get $nbase)))
            (local.set $p
              (i32.load align=1
                (i32.add (global.get $BASE_LIST) (i32.shl (local.get $k) (i32.const 2)))))

            ;; Once p*p reaches the top of the segment, no later prime can mark anything
            ;; here either — the list ascends. Any multiple of p below p*p that lies in
            ;; this segment is k*p with k < p, so it carries a smaller prime factor and
            ;; was marked by that one. Stopping is therefore exact, not an optimisation
            ;; that trades accuracy for speed.
            (br_if $p_done (i32.ge_u (i32.mul (local.get $p) (local.get $p)) (local.get $seg_hi)))

            ;; Start at p*p, or at the first multiple of p at or above seg_lo — whichever
            ;; is higher. `(seg_lo + p - 1) / p * p` is the ceiling, and it cannot wrap:
            ;; seg_lo <= 2^31 and p <= 46 340, so the sum stays under 2^32.
            (local.set $start (i32.mul (local.get $p) (local.get $p)))
            (if (i32.lt_u (local.get $start) (local.get $seg_lo))
              (then
                (local.set $start
                  (i32.mul
                    (i32.div_u
                      (i32.sub (i32.add (local.get $seg_lo) (local.get $p)) (i32.const 1))
                      (local.get $p))
                    (local.get $p)))))

            (local.set $j (local.get $start))
            (block $mk_done
              (loop $mk
                (br_if $mk_done (i32.ge_u (local.get $j) (local.get $seg_hi)))
                (call $seg_set (i32.sub (local.get $j) (local.get $seg_lo)))
                (local.set $j (i32.add (local.get $j) (local.get $p)))
                (br $mk)))

            (local.set $k (i32.add (local.get $k) (i32.const 1)))
            (br $p_next)))

        ;; Whatever is still unmarked in [seg_lo, seg_hi) is prime. The range never
        ;; starts below 2, so 0 and 1 are excluded by construction rather than by a
        ;; special case that could be deleted.
        (local.set $j (i32.const 0))
        (block $ct_done
          (loop $ct
            (br_if $ct_done (i32.ge_u (local.get $j) (local.get $span)))
            (if (i32.eqz (call $seg_bit (local.get $j)))
              (then (local.set $total (i64.add (local.get $total) (i64.const 1)))))
            (local.set $j (i32.add (local.get $j) (i32.const 1)))
            (br $ct)))

        (local.set $seg_lo (local.get $seg_hi))
        (br $segs)))

    (local.get $total))

  (func (export "run")
    (local $len i32) (local $hdr i32) (local $base i32) (local $t i32)
    (local $n i32) (local $root i32) (local $nbase i32)
    (local $p i32) (local $index i32) (local $count i32)
    (local $span i32) (local $chunk i32) (local $rem i32)
    (local $lo i32) (local $hi i32)
    (local $status i32) (local $sum i64)

    ;; Default verdict: refused. Every early exit below is an honest "I did not count
    ;; this range", never a silent "this range held no primes" — those two claims sum
    ;; identically and mean opposite things, which is exactly why they must not share
    ;; an encoding.
    (local.set $status (i32.const 1))
    (local.set $sum (i64.const 0))

    (block $emit
      ;; ---- pull the whole input into linear memory ----
      (local.set $len (call $input_len))
      (br_if $emit (i32.gt_u (local.get $len) (global.get $INPUT_ROOM)))
      (drop (call $input_read (global.get $INPUT) (local.get $len)))

      ;; ---- skip the DAG-CBOR byte-string header ----
      ;; 0x40..0x57 carry the length in the type byte; 0x58/0x59/0x5a prefix 1/2/4
      ;; further length bytes.
      (local.set $hdr (i32.const 1))
      (local.set $t (i32.load8_u (global.get $INPUT)))
      (if (i32.eq (local.get $t) (i32.const 0x58)) (then (local.set $hdr (i32.const 2))))
      (if (i32.eq (local.get $t) (i32.const 0x59)) (then (local.set $hdr (i32.const 3))))
      (if (i32.eq (local.get $t) (i32.const 0x5a)) (then (local.set $hdr (i32.const 5))))

      ;; The payload's own bytes must be present before either field is read. A block
      ;; that claims more than it carries is a block, not a licence to read past it.
      (br_if $emit (i32.lt_u (local.get $len) (i32.add (local.get $hdr) (i32.const 8))))
      (local.set $base (i32.add (global.get $INPUT) (local.get $hdr)))

      (br_if $emit (i32.ne (i32.load align=1 (local.get $base)) (global.get $VERSION)))
      (local.set $n (i32.load offset=4 align=1 (local.get $base)))

      ;; Checked *before* `n` reaches any address or product, so a malformed block
      ;; cannot make an offset wrap around into somewhere plausible. Past MAX_N the
      ;; unsigned-i32 argument in the header stops holding; say so rather than compute
      ;; a number that looks like an answer.
      (br_if $emit (i32.gt_u (local.get $n) (global.get $MAX_N)))

      ;; ---- the sub-range this shard owns ----
      (local.set $p (call $partition))
      (local.set $index (i32.shr_u (local.get $p) (i32.const 16)))
      (local.set $count (i32.and (local.get $p) (i32.const 0xffff)))
      (if (i32.eqz (local.get $count)) (then (local.set $count (i32.const 1))))
      ;; An index outside its own count would produce a range past the end of the
      ;; domain, and summing it would overcount. Refuse instead.
      (br_if $emit (i32.ge_u (local.get $index) (local.get $count)))

      ;; total = |[2, n]|, which is 0 for n < 2 rather than a negative that would read
      ;; as four billion under the unsigned division below.
      (local.set $span (i32.const 0))
      (if (i32.ge_u (local.get $n) (i32.const 2))
        (then (local.set $span (i32.sub (local.get $n) (i32.const 1)))))
      (local.set $chunk (i32.div_u (local.get $span) (local.get $count)))
      (local.set $rem (i32.rem_u (local.get $span) (local.get $count)))

      (local.set $lo
        (i32.add (i32.const 2)
          (i32.add (i32.mul (local.get $index) (local.get $chunk))
                   (call $min_u (local.get $index) (local.get $rem)))))
      (local.set $t (i32.add (local.get $index) (i32.const 1)))
      (local.set $hi
        (i32.add (i32.const 2)
          (i32.add (i32.mul (local.get $t) (local.get $chunk))
                   (call $min_u (local.get $t) (local.get $rem)))))

      ;; ---- count ----
      (local.set $root (call $isqrt (local.get $n)))
      (local.set $nbase (call $build_base (local.get $root)))
      (local.set $sum (call $count_range (local.get $lo) (local.get $hi) (local.get $nbase)))
      (local.set $status (i32.const 0)))

    ;; ---- the fixed-width output frame ----
    (i32.store8 offset=0 (global.get $OUT) (i32.const 0xa2))
    (i32.store8 offset=1 (global.get $OUT) (i32.const 0x61))
    (i32.store8 offset=2 (global.get $OUT) (i32.const 0x63))
    (i32.store8 offset=3 (global.get $OUT) (i32.const 0x48))
    (i64.store offset=4 align=1 (global.get $OUT) (local.get $sum))
    (i32.store8 offset=12 (global.get $OUT) (i32.const 0x61))
    (i32.store8 offset=13 (global.get $OUT) (i32.const 0x73))
    (i32.store8 offset=14 (global.get $OUT) (i32.const 0x41))
    (i32.store8 offset=15 (global.get $OUT) (local.get $status))

    (call $output_write (global.get $OUT) (i32.const 16)))
)
