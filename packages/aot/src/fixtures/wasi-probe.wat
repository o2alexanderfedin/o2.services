;; Asks the host every nondeterministic question WASI offers, and publishes the
;; answers so a test can hold two nodes' answers side by side.
;;
;; This is the fixture the whole determinism claim rests on. `WasiExecutor` replaces
;; the shim's clock and its entropy source with pinned ones (see the module comment on
;; `../wasi-executor.ts` for the full list and the reasons); a claim like that is worth
;; nothing until a guest has actually asked and the answer has been written down.
;;
;; The output is one 48-byte DAG-CBOR byte string:
;;
;;   0..7    CLOCKID_REALTIME,  first read
;;   8..15   CLOCKID_REALTIME,  second read
;;   16..23  CLOCKID_MONOTONIC, first read
;;   24..31  CLOCKID_MONOTONIC, second read
;;   32..39  random_get, first 8 bytes
;;   40..47  random_get, next 8 bytes
;;
;; Two reads of each clock rather than one, because "the clock is fixed" and "the
;; clock is read once" are different claims and only the first one is worth having:
;; a host that advanced the clock between calls would satisfy any single-read test
;; while making two honest nodes disagree the moment a guest timed anything.
;;
;; Two draws of entropy rather than one, because a stream that returns the same bytes
;; forever is trivially deterministic and useless — the test needs to see the two
;; draws differ from each other while the pair stays identical across executions.
;;
;; 48 bytes needs the two-byte `0x58 0x30` CBOR header, which is fixed width, so
;; unlike `wasi-shard.wat` there is no branch to get wrong.

(module
  (import "wasi_snapshot_preview1" "clock_time_get"
    (func $clock_time_get (param i32 i64 i32) (result i32)))
  (import "wasi_snapshot_preview1" "random_get"
    (func $random_get (param i32 i32) (result i32)))
  (import "wasi_snapshot_preview1" "fd_write"
    (func $fd_write (param i32 i32 i32 i32) (result i32)))
  (import "wasi_snapshot_preview1" "proc_exit"
    (func $proc_exit (param i32)))

  (memory (export "memory") 1 1)

  (global $IOV  i32 (i32.const 0))
  (global $NOUT i32 (i32.const 8))
  (global $BUF  i32 (i32.const 1024))  ;; payload; the 2-byte header sits at $BUF-2

  (func $clock (param $id i32) (param $at i32)
    ;; A precision of 1 ns is the most demanding thing a guest can ask for. Asking
    ;; for it here means a host that quietly degraded resolution under load would
    ;; have to say so in the returned value rather than in a field nobody reads.
    (if (call $clock_time_get (local.get $id) (i64.const 1) (local.get $at))
      (then (call $proc_exit (i32.const 65)) (unreachable))))

  (func $entropy (param $at i32)
    (if (call $random_get (local.get $at) (i32.const 8))
      (then (call $proc_exit (i32.const 66)) (unreachable))))

  (func (export "_start")
    (local $n i32)

    (call $clock (i32.const 0) (i32.add (global.get $BUF) (i32.const 0)))
    (call $clock (i32.const 0) (i32.add (global.get $BUF) (i32.const 8)))
    (call $clock (i32.const 1) (i32.add (global.get $BUF) (i32.const 16)))
    (call $clock (i32.const 1) (i32.add (global.get $BUF) (i32.const 24)))
    (call $entropy (i32.add (global.get $BUF) (i32.const 32)))
    (call $entropy (i32.add (global.get $BUF) (i32.const 40)))

    (i32.store8 (i32.sub (global.get $BUF) (i32.const 2)) (i32.const 0x58))
    (i32.store8 (i32.sub (global.get $BUF) (i32.const 1)) (i32.const 0x30))

    (local.set $n (i32.const 0))
    (block $write_done
      (loop $write
        (br_if $write_done (i32.ge_u (local.get $n) (i32.const 50)))
        (i32.store (global.get $IOV)
          (i32.add (i32.sub (global.get $BUF) (i32.const 2)) (local.get $n)))
        (i32.store offset=4 (global.get $IOV) (i32.sub (i32.const 50) (local.get $n)))
        (if (call $fd_write (i32.const 1) (global.get $IOV) (i32.const 1) (global.get $NOUT))
          (then (call $proc_exit (i32.const 67)) (unreachable)))
        (if (i32.eqz (i32.load (global.get $NOUT)))
          (then (call $proc_exit (i32.const 68)) (unreachable)))
        (local.set $n (i32.add (local.get $n) (i32.load (global.get $NOUT))))
        (br $write)))

    (call $proc_exit (i32.const 0))
    (unreachable))
)
