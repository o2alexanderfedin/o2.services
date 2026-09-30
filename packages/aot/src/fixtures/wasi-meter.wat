;; A WASI command module whose cost is known in advance: five host calls, three pages.
;;
;; `WasiExecutor` reports how many times a guest called into the host and how large its
;; linear memory was when it finished. A figure like that is only tested by a guest
;; whose answer is fixed by its source, so this one is written to be counted by hand:
;;
;;   clock_time_get  x3   one of the functions the executor pins, not the shim's own
;;   fd_write        x1   the shim's own, reached through the spread in `pinnedWasiImports`
;;   proc_exit       x1   which throws through the host to end the run, so a counter
;;                        that counted after the call returned would miss it
;;   ------------------
;;   5 host calls
;;
;; Memory starts at one page and grows by two, to three.
;;
;; **This is the one fixture whose `initial` is below its `maximum`**, and on purpose:
;; every other fixture pins `initial === maximum` for `wasi-echo.wat`'s reason, which
;; would make "memory after the run" and "memory before the run" the same number and
;; leave that half of the figure untested. The maximum is still declared, and the
;; growth is two pages, so it succeeds on any host that can run a guest at all.
;;
;; Output: the single byte 0x00, the DAG-CBOR encoding of the integer 0.

(module
  (import "wasi_snapshot_preview1" "clock_time_get"
    (func $clock_time_get (param i32 i64 i32) (result i32)))
  (import "wasi_snapshot_preview1" "fd_write"
    (func $fd_write (param i32 i32 i32 i32) (result i32)))
  (import "wasi_snapshot_preview1" "proc_exit"
    (func $proc_exit (param i32)))

  (memory (export "memory") 1 3)

  (func (export "_start")
    ;; Three clock reads into scratch at 16. Their values do not matter here.
    (drop (call $clock_time_get (i32.const 1) (i64.const 1) (i32.const 16)))
    (drop (call $clock_time_get (i32.const 1) (i64.const 1) (i32.const 16)))
    (drop (call $clock_time_get (i32.const 1) (i64.const 1) (i32.const 16)))

    ;; 1 page -> 3 pages. `memory.grow` returns the old size, or -1 on failure; a
    ;; failure exits 70 so it can never pass for a successful run.
    (if (i32.eq (memory.grow (i32.const 2)) (i32.const -1))
      (then (call $proc_exit (i32.const 70)) (unreachable)))

    ;; One iovec at 0 pointing at the byte at 32, which is still zero: CBOR `0`.
    (i32.store (i32.const 0) (i32.const 32))
    (i32.store (i32.const 4) (i32.const 1))
    (if (call $fd_write (i32.const 1) (i32.const 0) (i32.const 1) (i32.const 8))
      (then (call $proc_exit (i32.const 66)) (unreachable)))

    (call $proc_exit (i32.const 0))
    (unreachable))
)
