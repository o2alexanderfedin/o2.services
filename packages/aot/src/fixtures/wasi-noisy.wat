;; Says far more on stderr than the host will keep, then either exits non-zero or traps.
;;
;; `MAX_STDERR_BYTES` is 4096 and this guest writes 4800, which is the case the failure
;; path has to survive: a translated binary that is failing tends to fail in a loop, and
;; the first thing to go wrong when the cap is naive is the diagnostic itself. Two
;; distinct defects lived here and both are observable from inside this fixture:
;;
;;   **The cap must not reach the guest.** stderr used to share the stdout sink, which
;;   answers `ERRNO_NOSPC` once full. That is *this node's* storage policy arriving in
;;   the guest's control flow: a program that checks the return of a diagnostic write —
;;   and libc's `fprintf` does — would take a different branch on a node with a
;;   different cap. The loop below exits 71 if any stderr write reports an error, so a
;;   regression is a wrong *exit code*, not a subtly shorter string nobody reads.
;;
;;   **A short write is not an option either.** Reporting `nwritten < len` is how a
;;   host says "try again with the rest", and against a sink that is permanently full
;;   the retry never terminates. The loop exits 72 if the acknowledgement is short.
;;
;; 100 iterations of a 48-byte line is 4800 bytes against a 4096-byte cap, and 4096 is
;; not a multiple of 48 — deliberately. Iteration 86 straddles the boundary, so the
;; fixture also exercises the case where part of one write is kept and part is dropped,
;; which a round number would never reach.
;;
;; The ending is chosen by the first byte of stdin, so one fixture covers both failure
;; paths that carry a diagnostic:
;;
;;   input `1` (DAG-CBOR `0x01`)  →  `unreachable`, i.e. a trap
;;   anything else                →  `proc_exit(9)`
;;
;; Nothing is written to stdout in either case: the point is a failure whose *only*
;; evidence is what the guest said on the way down.

(module
  (import "wasi_snapshot_preview1" "fd_read"
    (func $fd_read (param i32 i32 i32 i32) (result i32)))
  (import "wasi_snapshot_preview1" "fd_write"
    (func $fd_write (param i32 i32 i32 i32) (result i32)))
  (import "wasi_snapshot_preview1" "proc_exit"
    (func $proc_exit (param i32)))

  (memory (export "memory") 1 1)

  (global $IOV  i32 (i32.const 0))
  (global $NOUT i32 (i32.const 8))
  (global $FLAG i32 (i32.const 16))
  (global $MSG  i32 (i32.const 64))
  (global $LEN  i32 (i32.const 48))
  (global $REPS i32 (i32.const 100))

  (data (i32.const 64) "o2-task guest diagnostic: something went wrong.\n")

  (func (export "_start")
    (local $i i32)

    (i32.store (global.get $IOV) (global.get $FLAG))
    (i32.store offset=4 (global.get $IOV) (i32.const 1))
    (if (call $fd_read (i32.const 0) (global.get $IOV) (i32.const 1) (global.get $NOUT))
      (then (call $proc_exit (i32.const 70)) (unreachable)))

    (local.set $i (i32.const 0))
    (block $said_enough
      (loop $say
        (br_if $said_enough (i32.ge_u (local.get $i) (global.get $REPS)))
        (i32.store (global.get $IOV) (global.get $MSG))
        (i32.store offset=4 (global.get $IOV) (global.get $LEN))
        (if (call $fd_write (i32.const 2) (global.get $IOV) (i32.const 1) (global.get $NOUT))
          (then (call $proc_exit (i32.const 71)) (unreachable)))
        (if (i32.ne (i32.load (global.get $NOUT)) (global.get $LEN))
          (then (call $proc_exit (i32.const 72)) (unreachable)))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $say)))

    (if (i32.eq (i32.load8_u (global.get $FLAG)) (i32.const 1))
      (then (unreachable)))

    (call $proc_exit (i32.const 9))
    (unreachable))
)
