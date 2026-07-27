;; A WASI command module, written by hand because the real ones cost 93 seconds.
;;
;; `WasiExecutor` exists for artifacts that come out of elfconv: they export `_start`
;; and `memory`, import ~23 functions from `wasi_snapshot_preview1`, and are several
;; megabytes. Nothing about that is testable at the speed a test suite needs, and a
;; 5.66 MB binary in version control that nobody can regenerate is not a fixture, it
;; is a rumour. So the shape is reproduced at 1/10000th the size: same module kind,
;; same import namespace, same two exports, same stdin-in/stdout-out contract.
;;
;; What it does: read stdin to EOF, write it back to stdout, exit 0. That makes it
;; the identity task — the executor's input block is a DAG-CBOR value, so echoing it
;; means the decoded output must equal the input value exactly, and any corruption
;; anywhere in the stdin plumbing, the stdout plumbing, or the codec shows up as an
;; inequality rather than as a plausible-looking wrong answer.
;;
;; It is also, unmodified, the "output is not valid DAG-CBOR" fixture: hand it an
;; input block that is not canonical CBOR and it faithfully echoes garbage. A
;; separate fixture for that case would be a fixture whose failure proves only that
;; the fixture failed.
;;
;; `initial === maximum` on the memory, here and in every fixture beside it, for the
;; reason `packages/demo/src/kernel.wat` gives: `memory.grow` that can never succeed
;; can never fail differently on two hosts.

(module
  ;; Exactly the three functions the echo contract needs. There is no allow-list
  ;; anywhere in the executor — `WebAssembly.instantiate` supplies what the host
  ;; offers and refuses a module that asks for more — so this list is a description
  ;; of the program, not a permission granted to it.
  (import "wasi_snapshot_preview1" "fd_read"
    (func $fd_read (param i32 i32 i32 i32) (result i32)))
  (import "wasi_snapshot_preview1" "fd_write"
    (func $fd_write (param i32 i32 i32 i32) (result i32)))
  (import "wasi_snapshot_preview1" "proc_exit"
    (func $proc_exit (param i32)))

  (memory (export "memory") 1 1)

  (global $IOV  i32 (i32.const 0))      ;; one iovec: {buf: i32, len: i32}
  (global $NOUT i32 (i32.const 8))      ;; where fd_read/fd_write report progress
  (global $BUF  i32 (i32.const 64))
  (global $CAP  i32 (i32.const 65472))  ;; 65536 - 64: the rest of the one page

  (func (export "_start")
    (local $total i32) (local $done i32) (local $n i32)

    ;; ---- drain stdin ----
    ;; A single fd_read is not "read everything": the ABI is free to return a short
    ;; count, and a guest that assumed otherwise would silently truncate its own
    ;; input on any host whose stdin is chunked. Loop until EOF (zero bytes) or the
    ;; page is full.
    (local.set $total (i32.const 0))
    (block $read_done
      (loop $read
        (br_if $read_done (i32.ge_u (local.get $total) (global.get $CAP)))
        (i32.store (global.get $IOV) (i32.add (global.get $BUF) (local.get $total)))
        (i32.store offset=4 (global.get $IOV)
          (i32.sub (global.get $CAP) (local.get $total)))
        (if (call $fd_read (i32.const 0) (global.get $IOV) (i32.const 1) (global.get $NOUT))
          (then (call $proc_exit (i32.const 65)) (unreachable)))
        (local.set $n (i32.load (global.get $NOUT)))
        (br_if $read_done (i32.eqz (local.get $n)))
        (local.set $total (i32.add (local.get $total) (local.get $n)))
        (br $read)))

    ;; ---- write it all back ----
    (local.set $done (i32.const 0))
    (block $write_done
      (loop $write
        (br_if $write_done (i32.ge_u (local.get $done) (local.get $total)))
        (i32.store (global.get $IOV) (i32.add (global.get $BUF) (local.get $done)))
        (i32.store offset=4 (global.get $IOV)
          (i32.sub (local.get $total) (local.get $done)))
        (if (call $fd_write (i32.const 1) (global.get $IOV) (i32.const 1) (global.get $NOUT))
          (then (call $proc_exit (i32.const 66)) (unreachable)))
        (local.set $n (i32.load (global.get $NOUT)))
        ;; Zero written and no error is no progress. Looping on that hangs the
        ;; thread; exiting names it. The host's stdout sink never does this except
        ;; when the output cap is hit, and the executor reports that case itself.
        (if (i32.eqz (local.get $n))
          (then (call $proc_exit (i32.const 67)) (unreachable)))
        (local.set $done (i32.add (local.get $done) (local.get $n)))
        (br $write)))

    (call $proc_exit (i32.const 0))
    (unreachable))
)
