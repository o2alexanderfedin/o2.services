;; The Pythagorean-triple colouring kernel — the guest side of the demo.
;;
;; It imports exactly the four functions of the o2 host ABI and nothing else. That
;; list *is* the sandbox: there is no clock, no randomness, no filesystem and no way
;; to acquire one, because `WebAssembly.instantiate` supplies nothing else and
;; refuses a module that asks. No static analysis is involved, and none is needed.
;;
;; Everything here is integer arithmetic. Not one float appears, which is what makes
;; determinism free rather than something to be enforced: the WASM specification's
;; nondeterminism list is dominated by float behaviour (NaN bit patterns, NaN sign,
;; relaxed SIMD), and a module with no floats cannot reach any of it.
;;
;;
;; SEARCH ORDER — why the host ships one.
;;
;; Values are assigned in the order the host supplies, which is by descending number
;; of triples the value appears in. The obvious alternative, increasing value order,
;; is close to the worst possible choice: it stalls at n = 205, because value 205's
;; triples reach back to values in the sixties and chronological backtracking must
;; re-enumerate a hundred and forty levels of irrelevant choices before it can revise
;; one of them. Deciding the most constrained values first puts each conflict within a
;; few levels of the choice that caused it — and it makes the cube decomposition
;; informative, because the values a cube fixes are then the ones the rest of the
;; search is most sensitive to.
;;
;; Because the order is arbitrary, a triple can no longer be checked "when its largest
;; element is assigned". So the guest tracks assignment explicitly and, after
;; assigning a value, checks only the triples containing it whose three members are
;; all assigned.
;;
;;
;; INPUT — the DAG-CBOR byte string handed to every shard, identical across shards.
;; Shards differ only by what `partition()` tells them.
;;
;;   header   1, 2, 3 or 5 bytes of CBOR byte-string prefix, skipped below
;;   u32 n            the colouring bound
;;   u32 budget       maximum backtracking steps
;;   u32 tripleCount  T
;;   T x { u16 a, u16 b, u16 c }, ascending by c
;;   u32 version      must be 2
;;   n x u16          order: assignment order, most-constrained value first
;;   (n+2) x u32      csrOffset: csrOffset[v] .. csrOffset[v+1] index csrIndex
;;   3T x u16         csrIndex: triple indices, grouped by value
;;
;; All little-endian, all read with align=1: the payload starts at a CBOR header
;; boundary, so nothing in it is naturally aligned.
;;
;;
;; OUTPUT — a fixed-width strict-DAG-CBOR frame, always exactly 1034 bytes:
;;
;;   a2                 map(2)
;;   61 63              text(1) "c"          -- "c" sorts before "s"
;;   59 04 00           bytes(1024)          -- constant, whatever n is
;;   <1024 bytes>       bit v-1 = colour of value v, little-endian within each byte
;;   61 73              text(1) "s"
;;   41                 bytes(1)
;;   <1 byte>           0 exhausted, 1 found, 2 budget reached
;;
;; Fixed width is the whole trick. Strict DAG-CBOR admits exactly one encoding of a
;; value, so a guest that emits a *variable*-width field has to branch on magnitude
;; to stay minimal — and a guest that gets that branch wrong produces bytes the
;; codec rightly rejects. The status is a one-byte *byte string* rather than a CBOR
;; integer for exactly this reason: integers below 24 must be packed into the type
;; byte, so `18 00` for zero is non-minimal and would be refused. Emitting one raw
;; byte has one encoding regardless of value, so there is no branch to get wrong.

(module
  ;; ---- the entire host contact surface ----
  (import "o2" "input_len"    (func $input_len (result i32)))
  (import "o2" "input_read"   (func $input_read (param i32 i32) (result i32)))
  (import "o2" "output_write" (func $output_write (param i32 i32)))
  (import "o2" "partition"    (func $partition (result i32)))

  ;; initial === maximum. `memory.grow` can therefore never succeed, so it can never
  ;; fail *differently* on two hosts — one less way for two honest nodes to disagree.
  ;; 4 pages = 256 KiB, sized for the largest supported input (n = 8192: 9971 triples
  ;; plus the order and the value index, ~165 KiB in total).
  (memory (export "memory") 4 4)

  ;; ---- fixed layout of linear memory ----
  (global $OUT      i32 (i32.const 0))      ;; 1034-byte output frame
  (global $COLOUR   i32 (i32.const 4096))   ;; colour[v], one byte, v in 0..8192
  (global $ASSIGNED i32 (i32.const 16384))  ;; assigned[v], one byte
  (global $INPUT    i32 (i32.const 32768))  ;; raw input bytes, 224 KiB available
  (global $MAX_N       i32 (i32.const 8192))
  (global $MAX_TRIPLES i32 (i32.const 20000))
  (global $INPUT_ROOM  i32 (i32.const 229376))
  (global $VERSION     i32 (i32.const 2))

  ;; Section addresses. They depend on the CBOR header width and on n, so they are
  ;; discovered at run time rather than assumed.
  (global $TRIPLES (mut i32) (i32.const 0))
  (global $ORDER   (mut i32) (i32.const 0))
  (global $CSROFF  (mut i32) (i32.const 0))
  (global $CSRIDX  (mut i32) (i32.const 0))

  ;; True when no *fully assigned* triple containing $v is monochromatic.
  ;;
  ;; A triple with an unassigned member is not yet a constraint — it cannot be
  ;; violated, and it will be checked when its last member is assigned. Skipping it
  ;; here rather than treating unassigned as a colour is what makes an arbitrary
  ;; assignment order sound.
  (func $ok_at (param $v i32) (result i32)
    (local $p i32) (local $end i32) (local $rec i32)
    (local $a i32) (local $b i32) (local $c i32) (local $ca i32)
    (local.set $p
      (i32.load align=1 (i32.add (global.get $CSROFF) (i32.shl (local.get $v) (i32.const 2)))))
    (local.set $end
      (i32.load offset=4 align=1
        (i32.add (global.get $CSROFF) (i32.shl (local.get $v) (i32.const 2)))))
    (block $done
      (loop $next
        (br_if $done (i32.ge_u (local.get $p) (local.get $end)))
        (local.set $rec
          (i32.add (global.get $TRIPLES)
            (i32.mul
              (i32.load16_u align=1
                (i32.add (global.get $CSRIDX) (i32.shl (local.get $p) (i32.const 1))))
              (i32.const 6))))
        (local.set $a (i32.load16_u align=1 (local.get $rec)))
        (local.set $b (i32.load16_u offset=2 align=1 (local.get $rec)))
        (local.set $c (i32.load16_u offset=4 align=1 (local.get $rec)))
        (if (i32.and
              (i32.load8_u (i32.add (global.get $ASSIGNED) (local.get $a)))
              (i32.and
                (i32.load8_u (i32.add (global.get $ASSIGNED) (local.get $b)))
                (i32.load8_u (i32.add (global.get $ASSIGNED) (local.get $c)))))
          (then
            (local.set $ca (i32.load8_u (i32.add (global.get $COLOUR) (local.get $a))))
            (if (i32.and
                  (i32.eq (local.get $ca)
                    (i32.load8_u (i32.add (global.get $COLOUR) (local.get $b))))
                  (i32.eq (local.get $ca)
                    (i32.load8_u (i32.add (global.get $COLOUR) (local.get $c)))))
              (then (return (i32.const 0))))))
        (local.set $p (i32.add (local.get $p) (i32.const 1)))
        (br $next)))
    (i32.const 1))

  ;; order[i] — the value assigned at depth i.
  (func $order_at (param $i i32) (result i32)
    (i32.load16_u align=1 (i32.add (global.get $ORDER) (i32.shl (local.get $i) (i32.const 1)))))

  (func (export "run")
    (local $len i32) (local $hdr i32) (local $base i32) (local $tail i32)
    (local $n i32) (local $budget i32) (local $tc i32)
    (local $p i32) (local $index i32) (local $count i32) (local $k i32)
    (local $i i32) (local $v i32) (local $w i32) (local $t i32)
    (local $steps i32) (local $status i32) (local $addr i32)

    ;; Default verdict: unknown. Every early exit below is an honest "I could not
    ;; tell", never a silent "no colouring exists" — those two claims carry very
    ;; different weight and must never be confused for one another.
    (local.set $status (i32.const 2))

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
      (br_if $emit (i32.lt_u (local.get $len) (i32.add (local.get $hdr) (i32.const 12))))
      (local.set $base (i32.add (global.get $INPUT) (local.get $hdr)))

      ;; ---- the fixed header ----
      (local.set $n      (i32.load align=1 (local.get $base)))
      (local.set $budget (i32.load offset=4 align=1 (local.get $base)))
      (local.set $tc     (i32.load offset=8 align=1 (local.get $base)))

      ;; Both bounds are checked *before* either value reaches address arithmetic, so
      ;; a malformed block cannot make an offset wrap around into somewhere plausible.
      ;; Past MAX_N the fixed layout has no room; say so rather than scribble.
      (br_if $emit (i32.gt_u (local.get $n) (global.get $MAX_N)))
      (br_if $emit (i32.gt_u (local.get $tc) (global.get $MAX_TRIPLES)))

      ;; ---- section addresses ----
      (global.set $TRIPLES (i32.add (local.get $base) (i32.const 12)))
      (local.set $tail
        (i32.add (global.get $TRIPLES) (i32.mul (local.get $tc) (i32.const 6))))
      (global.set $ORDER (i32.add (local.get $tail) (i32.const 4)))
      (global.set $CSROFF
        (i32.add (global.get $ORDER) (i32.shl (local.get $n) (i32.const 1))))
      (global.set $CSRIDX
        (i32.add (global.get $CSROFF)
                 (i32.shl (i32.add (local.get $n) (i32.const 2)) (i32.const 2))))

      ;; A block that claims more than it carries is a block, not a licence to read
      ;; past it. Every section must lie inside the bytes actually delivered.
      (br_if $emit
        (i32.gt_u
          (i32.add (global.get $CSRIDX) (i32.mul (local.get $tc) (i32.const 6)))
          (i32.add (global.get $INPUT) (local.get $len))))

      ;; The version is read only once its own bytes are known to be present.
      (br_if $emit
        (i32.ne (i32.load align=1 (local.get $tail)) (global.get $VERSION)))

      ;; ---- nothing is assigned yet ----
      ;; Linear memory starts zeroed and `run` is called once per instance, so this is
      ;; belt and braces — but a host that ever reused an instance would otherwise
      ;; inherit the previous shard's assignments, and that failure would present as
      ;; nondeterminism rather than as the state bug it is.
      (local.set $t (i32.const 0))
      (block $za_done
        (loop $za
          (br_if $za_done (i32.gt_u (local.get $t) (local.get $n)))
          (i32.store8 (i32.add (global.get $ASSIGNED) (local.get $t)) (i32.const 0))
          (local.set $t (i32.add (local.get $t) (i32.const 1)))
          (br $za)))

      ;; ---- the cube this shard owns ----
      ;; partition() packs (index << 16) | count, and count is a power of two, so
      ;; k = log2(count) = 31 - clz(count). The cube fixes the k *most constrained*
      ;; values — order[0..k-1] — which is what makes splitting the job further
      ;; actually buy something rather than repeat the same easy prefix k times.
      (local.set $p (call $partition))
      (local.set $index (i32.shr_u (local.get $p) (i32.const 16)))
      (local.set $count (i32.and (local.get $p) (i32.const 0xffff)))
      (if (i32.eqz (local.get $count)) (then (local.set $count (i32.const 1))))
      (local.set $k (i32.sub (i32.const 31) (i32.clz (local.get $count))))
      (if (i32.gt_s (local.get $k) (local.get $n)) (then (local.set $k (local.get $n))))

      (local.set $i (i32.const 0))
      (block $fix_done
        (loop $fix
          (br_if $fix_done (i32.ge_s (local.get $i) (local.get $k)))
          (local.set $v (call $order_at (local.get $i)))
          (i32.store8 (i32.add (global.get $COLOUR) (local.get $v))
            (i32.and (i32.shr_u (local.get $index) (local.get $i)) (i32.const 1)))
          (i32.store8 (i32.add (global.get $ASSIGNED) (local.get $v)) (i32.const 1))
          (local.set $i (i32.add (local.get $i) (i32.const 1)))
          (br $fix)))

      ;; The fixed prefix is a claim like any other and has to hold. A cube whose
      ;; fixed values already complete a monochromatic triple contains no colouring
      ;; at all — status 0, a real answer, not a failure to search.
      (local.set $i (i32.const 0))
      (block $pre_done
        (loop $pre
          (br_if $pre_done (i32.ge_s (local.get $i) (local.get $k)))
          (if (i32.eqz (call $ok_at (call $order_at (local.get $i))))
            (then (local.set $status (i32.const 0)) (br $emit)))
          (local.set $i (i32.add (local.get $i) (i32.const 1)))
          (br $pre)))

      ;; ---- depth-first search over the remaining depths ----
      (local.set $steps (i32.const 0))
      (local.set $i (local.get $k))
      (if (i32.lt_s (local.get $i) (local.get $n))
        (then
          (local.set $v (call $order_at (local.get $i)))
          (i32.store8 (i32.add (global.get $COLOUR) (local.get $v)) (i32.const 0))
          (i32.store8 (i32.add (global.get $ASSIGNED) (local.get $v)) (i32.const 1))))

      (block $search_done
        (loop $search
          ;; Every depth filled with nothing violated: each triple was checked at the
          ;; moment its last member was assigned, so all of them have been checked.
          (if (i32.ge_s (local.get $i) (local.get $n))
            (then (local.set $status (i32.const 1)) (br $search_done)))
          (local.set $v (call $order_at (local.get $i)))
          (if (call $ok_at (local.get $v))
            (then
              (local.set $i (i32.add (local.get $i) (i32.const 1)))
              (if (i32.lt_s (local.get $i) (local.get $n))
                (then
                  (local.set $w (call $order_at (local.get $i)))
                  (i32.store8 (i32.add (global.get $COLOUR) (local.get $w)) (i32.const 0))
                  (i32.store8 (i32.add (global.get $ASSIGNED) (local.get $w)) (i32.const 1))))
              (br $search)))
          ;; Conflict at this depth: take the other colour, or undo and retry below.
          (block $flipped
            (loop $back
              (if (i32.eqz (i32.load8_u (i32.add (global.get $COLOUR) (local.get $v))))
                (then
                  (i32.store8 (i32.add (global.get $COLOUR) (local.get $v)) (i32.const 1))
                  (br $flipped)))
              (i32.store8 (i32.add (global.get $ASSIGNED) (local.get $v)) (i32.const 0))
              (local.set $i (i32.sub (local.get $i) (i32.const 1)))
              (local.set $steps (i32.add (local.get $steps) (i32.const 1)))
              ;; Signed, deliberately: with k = 0 the depth reaches -1, and an
              ;; unsigned compare would read that as four billion and keep going.
              (if (i32.lt_s (local.get $i) (local.get $k))
                (then (local.set $status (i32.const 0)) (br $search_done)))
              ;; The budget is what makes a shard's cost bounded and its result
              ;; reproducible: two nodes running the same shard stop at the same
              ;; step, so "unknown" is itself a deterministic answer.
              (if (i32.ge_u (local.get $steps) (local.get $budget))
                (then (local.set $status (i32.const 2)) (br $search_done)))
              (local.set $v (call $order_at (local.get $i)))
              (br $back)))
          (br $search))))

    ;; ---- the fixed-width output frame ----
    (i32.store8 offset=0 (global.get $OUT) (i32.const 0xa2))
    (i32.store8 offset=1 (global.get $OUT) (i32.const 0x61))
    (i32.store8 offset=2 (global.get $OUT) (i32.const 0x63))
    (i32.store8 offset=3 (global.get $OUT) (i32.const 0x59))
    (i32.store8 offset=4 (global.get $OUT) (i32.const 0x04))
    (i32.store8 offset=5 (global.get $OUT) (i32.const 0x00))
    (i32.store8 offset=1030 (global.get $OUT) (i32.const 0x61))
    (i32.store8 offset=1031 (global.get $OUT) (i32.const 0x73))
    (i32.store8 offset=1032 (global.get $OUT) (i32.const 0x41))
    (i32.store8 offset=1033 (global.get $OUT) (local.get $status))

    ;; Clear the colouring field. When no colouring was found it stays all zero, so
    ;; the frame is the same width and shape in every case.
    (local.set $t (i32.const 0))
    (block $z_done
      (loop $z
        (br_if $z_done (i32.ge_u (local.get $t) (i32.const 256)))
        (i32.store offset=6 align=1
          (i32.add (global.get $OUT) (i32.shl (local.get $t) (i32.const 2)))
          (i32.const 0))
        (local.set $t (i32.add (local.get $t) (i32.const 1)))
        (br $z)))

    (if (i32.eq (local.get $status) (i32.const 1))
      (then
        (local.set $v (i32.const 1))
        (block $pk_done
          (loop $pk
            (br_if $pk_done (i32.gt_u (local.get $v) (local.get $n)))
            (if (i32.load8_u (i32.add (global.get $COLOUR) (local.get $v)))
              (then
                (local.set $addr
                  (i32.add (i32.add (global.get $OUT) (i32.const 6))
                           (i32.shr_u (i32.sub (local.get $v) (i32.const 1)) (i32.const 3))))
                (i32.store8 (local.get $addr)
                  (i32.or (i32.load8_u (local.get $addr))
                          (i32.shl (i32.const 1)
                                   (i32.and (i32.sub (local.get $v) (i32.const 1))
                                            (i32.const 7)))))))
            (local.set $v (i32.add (local.get $v) (i32.const 1)))
            (br $pk)))))

    (call $output_write (global.get $OUT) (i32.const 1034)))
)
