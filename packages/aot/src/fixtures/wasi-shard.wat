;; Does this program know which shard it is?
;;
;; The fabric's own guest ABI answers that with `o2.partition()`, a single i32 packing
;; index and count. A translated AArch64 binary has never heard of it and cannot be
;; made to: it was compiled from C against a POSIX `main(argc, argv)` years before it
;; met this project. The one channel every such program already reads is argv, so that
;; is where the shard goes — see `shardArgv` in `../wasi-executor.ts`.
;;
;; This fixture emits the raw argv byte buffer, NUL separators and all, wrapped as a
;; DAG-CBOR byte string. Emitting the *bytes* rather than a parsed index is deliberate:
;; a fixture that parsed the arguments and re-emitted an integer would agree with the
;; host about the format by construction, and the test would then be checking that two
;; pieces of the same idea match. The raw buffer lets the test assert the exact
;; sequence `o2-task\0<index>\0<count>\0` against a hardcoded literal.

(module
  (import "wasi_snapshot_preview1" "args_sizes_get"
    (func $args_sizes_get (param i32 i32) (result i32)))
  (import "wasi_snapshot_preview1" "args_get"
    (func $args_get (param i32 i32) (result i32)))
  (import "wasi_snapshot_preview1" "fd_write"
    (func $fd_write (param i32 i32 i32 i32) (result i32)))
  (import "wasi_snapshot_preview1" "proc_exit"
    (func $proc_exit (param i32)))

  (memory (export "memory") 1 1)

  (global $IOV  i32 (i32.const 0))
  (global $NOUT i32 (i32.const 8))
  (global $ARGC i32 (i32.const 16))
  (global $ABSZ i32 (i32.const 20))
  (global $PTRS i32 (i32.const 256))   ;; the argv pointer array
  (global $BUF  i32 (i32.const 1024))  ;; the argv bytes; the CBOR header sits below

  (func (export "_start")
    (local $size i32) (local $hdr i32) (local $at i32) (local $len i32) (local $n i32)

    (if (call $args_sizes_get (global.get $ARGC) (global.get $ABSZ))
      (then (call $proc_exit (i32.const 65)) (unreachable)))
    (local.set $size (i32.load (global.get $ABSZ)))
    ;; The two-byte CBOR header below only covers lengths up to 255. Past that this
    ;; fixture would emit a non-minimal encoding, which strict DAG-CBOR rightly
    ;; rejects — refuse loudly rather than produce bytes the codec will blame.
    (if (i32.gt_u (local.get $size) (i32.const 255))
      (then (call $proc_exit (i32.const 66)) (unreachable)))
    (if (call $args_get (global.get $PTRS) (global.get $BUF))
      (then (call $proc_exit (i32.const 67)) (unreachable)))

    ;; ---- minimal DAG-CBOR byte-string header, written backwards from $BUF ----
    ;; Strict DAG-CBOR admits exactly one encoding per length, so the width has to
    ;; branch on magnitude: below 24 the length lives in the type byte, 24..255 needs
    ;; the 0x58 prefix. Getting this wrong produces bytes that decode nowhere.
    (if (i32.lt_u (local.get $size) (i32.const 24))
      (then
        (local.set $hdr (i32.const 1))
        (i32.store8 (i32.sub (global.get $BUF) (i32.const 1))
          (i32.or (i32.const 0x40) (local.get $size))))
      (else
        (local.set $hdr (i32.const 2))
        (i32.store8 (i32.sub (global.get $BUF) (i32.const 2)) (i32.const 0x58))
        (i32.store8 (i32.sub (global.get $BUF) (i32.const 1)) (local.get $size))))

    (local.set $at (i32.sub (global.get $BUF) (local.get $hdr)))
    (local.set $len (i32.add (local.get $size) (local.get $hdr)))

    (local.set $n (i32.const 0))
    (block $write_done
      (loop $write
        (br_if $write_done (i32.ge_u (local.get $n) (local.get $len)))
        (i32.store (global.get $IOV) (i32.add (local.get $at) (local.get $n)))
        (i32.store offset=4 (global.get $IOV) (i32.sub (local.get $len) (local.get $n)))
        (if (call $fd_write (i32.const 1) (global.get $IOV) (i32.const 1) (global.get $NOUT))
          (then (call $proc_exit (i32.const 68)) (unreachable)))
        (if (i32.eqz (i32.load (global.get $NOUT)))
          (then (call $proc_exit (i32.const 69)) (unreachable)))
        (local.set $n (i32.add (local.get $n) (i32.load (global.get $NOUT))))
        (br $write)))

    (call $proc_exit (i32.const 0))
    (unreachable))
)
