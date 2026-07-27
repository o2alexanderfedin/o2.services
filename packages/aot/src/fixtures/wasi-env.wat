;; Asks the host for its environment and publishes what it was given.
;;
;; `WASI_ENV` in `../wasi-executor.ts` claims to be "the guest's entire environment",
;; and until this fixture existed the only test of that claim asserted the contents of
;; the constant — which proves that the constant says what it says, and nothing about
;; what a guest observes. A libc reaches the environment through `environ_sizes_get`
;; and `environ_get`, so that is the only route worth testing: `LC_ALL` pins collation
;; and number formatting, `TZ` pins how `FIXED_REALTIME_NANOS` renders as a local date,
;; and a node that leaked its own `TZ` would make two honest results differ by hours.
;;
;; The pointer array is published as well as the string buffer, because `getenv` walks
;; the array and reads *through* it. A buffer with the right bytes and an array that
;; pointed elsewhere would satisfy any test that only looked at the strings, and would
;; hand a real translated binary three empty variables.
;;
;; Output is one 64-byte DAG-CBOR byte string:
;;
;;    0..3    environ count, as `environ_sizes_get` reported it (u32 LE)
;;    4..7    environ buffer size, likewise (u32 LE)
;;    8..11   environ[0] − buffer base
;;   12..15   environ[1] − buffer base
;;   16..19   environ[2] − buffer base
;;   20..63   the first 44 bytes of the environ buffer, zero-padded
;;
;; The pointers are published as offsets from the buffer base rather than as raw
;; addresses so the expected values are a property of the environment rather than of
;; where this fixture happened to put its scratch space.
;;
;; 44 bytes of buffer is comfortably more than the 23 the three variables occupy, and
;; linear memory starts zeroed, so the padding is a check too: a fourth variable
;; arriving from the host would show up as non-zero bytes rather than as nothing.

(module
  (import "wasi_snapshot_preview1" "environ_sizes_get"
    (func $environ_sizes_get (param i32 i32) (result i32)))
  (import "wasi_snapshot_preview1" "environ_get"
    (func $environ_get (param i32 i32) (result i32)))
  (import "wasi_snapshot_preview1" "fd_write"
    (func $fd_write (param i32 i32 i32 i32) (result i32)))
  (import "wasi_snapshot_preview1" "proc_exit"
    (func $proc_exit (param i32)))

  (memory (export "memory") 1 1)

  (global $IOV    i32 (i32.const 0))
  (global $NOUT   i32 (i32.const 8))
  (global $CNT    i32 (i32.const 16))
  (global $SIZE   i32 (i32.const 20))
  (global $ENVP   i32 (i32.const 32))    ;; three u32 pointers
  (global $ENVBUF i32 (i32.const 64))    ;; the NUL-separated strings
  (global $OUT    i32 (i32.const 1024))  ;; payload; the 2-byte header sits at $OUT-2

  (func (export "_start")
    (local $n i32)

    (if (call $environ_sizes_get (global.get $CNT) (global.get $SIZE))
      (then (call $proc_exit (i32.const 65)) (unreachable)))
    (if (call $environ_get (global.get $ENVP) (global.get $ENVBUF))
      (then (call $proc_exit (i32.const 66)) (unreachable)))

    (i32.store (global.get $OUT) (i32.load (global.get $CNT)))
    (i32.store offset=4 (global.get $OUT) (i32.load (global.get $SIZE)))
    (i32.store offset=8 (global.get $OUT)
      (i32.sub (i32.load (global.get $ENVP)) (global.get $ENVBUF)))
    (i32.store offset=12 (global.get $OUT)
      (i32.sub (i32.load offset=4 (global.get $ENVP)) (global.get $ENVBUF)))
    (i32.store offset=16 (global.get $OUT)
      (i32.sub (i32.load offset=8 (global.get $ENVP)) (global.get $ENVBUF)))

    ;; Byte at a time: `memory.copy` is bulk-memory, and the fixtures are compiled with
    ;; every post-MVP feature switched off so the committed bytes stay a function of
    ;; the source rather than of the wabt version.
    (local.set $n (i32.const 0))
    (block $copy_done
      (loop $copy
        (br_if $copy_done (i32.ge_u (local.get $n) (i32.const 44)))
        (i32.store8
          (i32.add (i32.add (global.get $OUT) (i32.const 20)) (local.get $n))
          (i32.load8_u (i32.add (global.get $ENVBUF) (local.get $n))))
        (local.set $n (i32.add (local.get $n) (i32.const 1)))
        (br $copy)))

    (i32.store8 (i32.sub (global.get $OUT) (i32.const 2)) (i32.const 0x58))
    (i32.store8 (i32.sub (global.get $OUT) (i32.const 1)) (i32.const 0x40))

    (local.set $n (i32.const 0))
    (block $write_done
      (loop $write
        (br_if $write_done (i32.ge_u (local.get $n) (i32.const 66)))
        (i32.store (global.get $IOV)
          (i32.add (i32.sub (global.get $OUT) (i32.const 2)) (local.get $n)))
        (i32.store offset=4 (global.get $IOV) (i32.sub (i32.const 66) (local.get $n)))
        (if (call $fd_write (i32.const 1) (global.get $IOV) (i32.const 1) (global.get $NOUT))
          (then (call $proc_exit (i32.const 67)) (unreachable)))
        (if (i32.eqz (i32.load (global.get $NOUT)))
          (then (call $proc_exit (i32.const 68)) (unreachable)))
        (local.set $n (i32.add (local.get $n) (i32.load (global.get $NOUT))))
        (br $write)))

    (call $proc_exit (i32.const 0))
    (unreachable))
)
