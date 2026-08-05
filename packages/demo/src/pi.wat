;; Estimating pi across the fabric, by summing a contiguous range of the
;; Madhava-Leibniz series in fixed-point integers.
;;
;;   pi/4 = 1 - 1/3 + 1/5 - 1/7 + 1/9 - ...
;;
;; Each shard owns a contiguous range of term indices and returns the scaled sum of
;; just its own terms. The requestor adds the partials. Nothing here divides the work
;; by value, only by index, so the split is the same shape as the prime kernel's and
;; is deliberately written the same way -- see the note on `$min_u` below.
;;
;; ## Why this workload exists when `primes.wat` already shards
;;
;; It is the complement of the prime count, not a repeat of it, and the reason is a
;; measured weakness in that file's oracle rather than a preference.
;;
;; The prime kernel is checked against published values of pi(x), which is a genuinely
;; independent oracle -- but those values are quoted at powers of ten, and a power of
;; ten sits a long way from the prime below it (999983, 99991, 9973). A guest that
;; loses the top of its range therefore still returns the right total, because the
;; numbers it dropped contained no primes. That was measured, not supposed: the range
;; mutation planted in `primes.wat` was caught at n = 1000 alone.
;;
;; This series has no such blind spot, and the difference is in the *workload* rather
;; than in the checking. **Every term is non-zero.** For the prime count at 10^6 the
;; dropped numbers contain no primes, so the total is unchanged at every shard count and
;; no cross-shard comparison can see the defect either. Here term k contributes
;; SCALE/(2k+1), which at the far end of a million-term job is still around five hundred
;; million units, so any split that loses an index moves the total immediately.
;;
;; ## The same mutation, planted here and measured
;;
;; Both `$min_u` call sites below were replaced with `(i32.const 0)` -- the exact
;; deletion recorded against `primes.wat` -- and the suite re-run. What it showed is
;; worth more than the prediction it replaced:
;;
;;   caught by   the shard-count sweep, at **shard count 2**, the first one tried
;;               785397913397978 against 785398413396728, short by 499 998 750 units
;;   NOT caught  the comparison against published pi, which passed
;;
;; The oracle missing it is the part to keep in mind. At eight shards a term count of
;; 1 000 003 leaves a remainder of three, so three tail terms are lost; their signs
;; alternate and mostly cancel, leaving a net error of about one term -- 2e-6 in pi,
;; against a remainder bound of 2.0e-6. It slid underneath by a hair.
;;
;; So the published constant is necessary and is not sufficient, in this workload just
;; as in the prime one. **The falsifying power is in the requirement that the scaled
;; total be bit-identical at every shard count**, which is available here only because
;; every term is non-zero. That case is not decoration around the oracle; it is the
;; check that works.
;;
;; ## Fixed point, and why the scale is 10^15 rather than the widest that fits
;;
;; i64 would hold 10^18 comfortably -- pi/4 * 10^18 is 7.85e17 against a maximum of
;; 9.22e18. It is not used, because the partial does not stop at this boundary: the
;; requestor's combiner sums these values as JavaScript numbers, and 10^18 is two
;; orders of magnitude past `Number.MAX_SAFE_INTEGER`. The overflow would be silent
;; and would land in the *aggregate*, which is the one place nothing else would catch
;; it. 10^15 keeps every partial, and their total, inside the range where an integer
;; is still exactly an integer on both sides of the wire.
;;
;; The cost of that choice is nothing this workload can detect. One unit is 10^-15 of
;; pi/4; the series' own truncation error after a million terms is 2e-6, nine orders
;; of magnitude larger.
;;
;; ## No floats, on purpose
;;
;; Every value here is i32 or i64. This is the determinism argument the whole project
;; rests on: a module that contains no float instruction cannot reach the WASM
;; specification's float nondeterminism -- NaN bit patterns, NaN sign, relaxed SIMD --
;; none of which V8 offers any runtime control over. `pi-build.node.test.ts` reads the
;; text for `f32`/`f64` rather than trusting this paragraph.

(module
  (import "o2" "input_len"    (func $input_len (result i32)))
  (import "o2" "input_read"   (func $input_read (param i32 i32) (result i32)))
  (import "o2" "output_write" (func $output_write (param i32 i32)))
  (import "o2" "partition"    (func $partition (result i32)))

  ;; One page, fixed. `initial === maximum` so `memory.grow` cannot fail differently on
  ;; one host than another -- the same requirement the colouring and prime kernels
  ;; meet, at the size this one actually needs. There are no tables here: the series is
  ;; a running sum, so the guest needs room for the input block and the output frame
  ;; and nothing else.
  (memory (export "memory") 1 1)

  (global $OUT   i32 (i32.const 0))
  (global $INPUT i32 (i32.const 256))

  ;; The input block must fit below the end of the page with room to spare. A block
  ;; larger than this is refused rather than truncated -- a truncated header would be
  ;; read as a different job.
  (global $INPUT_ROOM i32 (i32.const 3840))

  (global $VERSION i32 (i32.const 1))

  ;; Largest term count accepted. 2^31 - 1 is an arithmetic bound, not a
  ;; recommendation: the index is carried in an unsigned i32 and every product formed
  ;; from it is widened to i64 before use. A job near this bound would run for days on
  ;; one node; see the callers for what they actually pass.
  (global $MAX_TERMS i32 (i32.const 2147483647))

  ;; 10^15. See the header.
  (global $SCALE i64 (i64.const 1000000000000000))

  ;; The smaller of two unsigned values.
  ;;
  ;; Used once, in the range split, and that single call site is load-bearing in a way
  ;; worth naming here rather than at the site: it is the term that hands the first
  ;; `rem` shards one extra index each, and deleting it leaves the top `terms mod
  ;; count` indices covered by no shard at all. That exact deletion is a recorded
  ;; mutation against the prime kernel, where the published oracle could not see it.
  ;; Here it moves the total immediately, at every shard count.
  (func $min_u (param $a i32) (param $b i32) (result i32)
    (if (result i32) (i32.lt_u (local.get $a) (local.get $b))
      (then (local.get $a))
      (else (local.get $b))))

  (func (export "run")
    (local $len i32) (local $hdr i32) (local $base i32) (local $t i32)
    (local $terms i32) (local $p i32) (local $index i32) (local $count i32)
    (local $chunk i32) (local $rem i32) (local $lo i32) (local $hi i32)
    (local $k i32) (local $status i32) (local $sum i64) (local $term i64)

    ;; Default verdict: refused. Every early exit below is an honest "I did not sum
    ;; this range", never a silent "this range summed to zero". Those two claims add
    ;; identically into an aggregate and mean opposite things -- and here the second is
    ;; a perfectly ordinary value, since an alternating series crosses zero constantly.
    ;; They must not share an encoding.
    (local.set $status (i32.const 1))
    (local.set $sum (i64.const 0))

    (block $emit
      ;; ---- pull the whole input into linear memory ----
      (local.set $len (call $input_len))
      (br_if $emit (i32.gt_u (local.get $len) (global.get $INPUT_ROOM)))
      (drop (call $input_read (global.get $INPUT) (local.get $len)))

      ;; ---- skip the DAG-CBOR byte-string header ----
      ;; 0x40..0x57 carry the length in the type byte; 0x58/0x59/0x5a prefix 1/2/4
      ;; further length bytes. The wider forms are handled even though this payload is
      ;; eight bytes and takes the shortest one, because a guest that depended on the
      ;; encoder's choice of width would break the day a longer payload was added.
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
      (local.set $terms (i32.load offset=4 align=1 (local.get $base)))
      (br_if $emit (i32.gt_u (local.get $terms) (global.get $MAX_TERMS)))

      ;; ---- the sub-range this shard owns ----
      (local.set $p (call $partition))
      (local.set $index (i32.shr_u (local.get $p) (i32.const 16)))
      (local.set $count (i32.and (local.get $p) (i32.const 0xffff)))
      (if (i32.eqz (local.get $count)) (then (local.set $count (i32.const 1))))
      ;; An index outside its own count would produce a range past the end of the
      ;; domain, and adding it would double-count terms. Refuse instead.
      (br_if $emit (i32.ge_u (local.get $index) (local.get $count)))

      ;; The domain is [0, terms), split into `count` contiguous pieces. The first
      ;; `rem` pieces take one extra index each, which is what `$min_u` is doing.
      (local.set $chunk (i32.div_u (local.get $terms) (local.get $count)))
      (local.set $rem (i32.rem_u (local.get $terms) (local.get $count)))

      (local.set $lo
        (i32.add (i32.mul (local.get $index) (local.get $chunk))
                 (call $min_u (local.get $index) (local.get $rem))))
      (local.set $t (i32.add (local.get $index) (i32.const 1)))
      (local.set $hi
        (i32.add (i32.mul (local.get $t) (local.get $chunk))
                 (call $min_u (local.get $t) (local.get $rem))))

      ;; ---- sum this shard's terms ----
      ;;
      ;; The sign is the parity of the *global* index k, never of the position within
      ;; this shard. That is what makes the total independent of how the work was
      ;; split: term k has the same value and the same sign whichever shard computes
      ;; it, so the partials add back to one number at any shard count. A sign taken
      ;; from a shard-local counter would give a different answer for every split, and
      ;; the four-versus-eight-shard check exists to catch exactly that.
      (local.set $k (local.get $lo))
      (block $done
        (loop $next
          (br_if $done (i32.ge_u (local.get $k) (local.get $hi)))
          ;; 2k+1 is formed in i64. In i32 it would wrap for k above 2^31 - 1, and the
          ;; divisor would come back small and positive -- a wrong term that looks
          ;; entirely reasonable.
          (local.set $term
            (i64.div_u (global.get $SCALE)
              (i64.add (i64.mul (i64.extend_i32_u (local.get $k)) (i64.const 2))
                       (i64.const 1))))
          (if (i32.eqz (i32.and (local.get $k) (i32.const 1)))
            (then (local.set $sum (i64.add (local.get $sum) (local.get $term))))
            (else (local.set $sum (i64.sub (local.get $sum) (local.get $term)))))
          (local.set $k (i32.add (local.get $k) (i32.const 1)))
          (br $next)))

      (local.set $status (i32.const 0)))

    ;; ---- the fixed-width output frame ----
    ;;
    ;; DAG-CBOR, hand-encoded, always sixteen bytes:
    ;;
    ;;   a2            map(2)
    ;;   61 70         text(1) "p"      -- this shard's scaled partial
    ;;   48 <8 bytes>  bytes(8)         -- little-endian, two's complement
    ;;   61 73         text(1) "s"      -- status
    ;;   41 <1 byte>   bytes(1)         -- 0 summed, 1 refused
    ;;
    ;; "p" before "s" is the deterministic key order the codec requires: both keys
    ;; encode to two bytes, so they sort on the second, and 0x70 < 0x73.
    ;;
    ;; **The partial is signed**, which is the one way this frame differs in meaning
    ;; from the prime kernel's identically shaped one. A range beginning at an odd
    ;; index sums to a negative number, and that is an ordinary result rather than an
    ;; error. The host reads these eight bytes as a signed integer for that reason.
    (i32.store8 offset=0 (global.get $OUT) (i32.const 0xa2))
    (i32.store8 offset=1 (global.get $OUT) (i32.const 0x61))
    (i32.store8 offset=2 (global.get $OUT) (i32.const 0x70))
    (i32.store8 offset=3 (global.get $OUT) (i32.const 0x48))
    (i64.store offset=4 align=1 (global.get $OUT) (local.get $sum))
    (i32.store8 offset=12 (global.get $OUT) (i32.const 0x61))
    (i32.store8 offset=13 (global.get $OUT) (i32.const 0x73))
    (i32.store8 offset=14 (global.get $OUT) (i32.const 0x41))
    (i32.store8 offset=15 (global.get $OUT) (local.get $status))

    (call $output_write (global.get $OUT) (i32.const 16)))
)
