;; Writes a perfectly good answer and then exits 7.
;;
;; The failure this guards against is the tempting one. stdout holds valid, minimal
;; DAG-CBOR; decoding it succeeds; a host that looked at stdout and never at the exit
;; status would return `{ok: true, output: 12}` and the fabric would content-address
;; that, replicate it, agree on it across nodes, and record a verified result for a
;; program that told the host it had failed.
;;
;; That is worse than a wrong answer, because every downstream check would pass:
;; redundant execution compares outputs, and two nodes running a program that fails
;; the *same* way produce the *same* bytes, so agreement is reached on nonsense.
;; Exit status is the one signal redundancy cannot recover, which is why
;; `WasiExecutor` reads it before it reads stdout.
;;
;; 7 rather than 1 so a test asserting on the code cannot pass against a hardcoded
;; "nonzero means one".

(module
  (import "wasi_snapshot_preview1" "fd_write"
    (func $fd_write (param i32 i32 i32 i32) (result i32)))
  (import "wasi_snapshot_preview1" "proc_exit"
    (func $proc_exit (param i32)))

  (memory (export "memory") 1 1)

  (func (export "_start")
    ;; 0x0c — CBOR unsigned(12), one byte, and the only minimal encoding of 12.
    (i32.store8 (i32.const 64) (i32.const 0x0c))
    (i32.store (i32.const 0) (i32.const 64))
    (i32.store offset=4 (i32.const 0) (i32.const 1))
    (drop (call $fd_write (i32.const 1) (i32.const 0) (i32.const 1) (i32.const 8)))
    (call $proc_exit (i32.const 7))
    (unreachable))
)
