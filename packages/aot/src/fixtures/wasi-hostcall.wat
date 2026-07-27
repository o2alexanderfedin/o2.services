;; Calls the host functions whose *behaviour* nothing else observes, and publishes both
;; the errno and the memory each one left behind.
;;
;; `PINNED_WASI_FUNCTIONS` in `../wasi-executor.ts` was checked by identity only — "the
;; pinned function is not the shim's function" — and a replacement that returned the
;; wrong errno, or wrote nothing where the ABI says it writes, satisfies that perfectly.
;; The interesting half of a host call is not what it returns; it is what it leaves in
;; the guest's memory, because that is what the guest goes on to branch on.
;;
;; Every out-parameter here is prefilled with `0xa5a5a5a5` before the call, so
;; "the host wrote zero" and "the host wrote nothing" are two different observations
;; rather than one. That distinction is the whole point of the `poll_oneoff` row: the
;; shim's `poll_oneoff` is declared with three parameters where the ABI passes four, so
;; it never receives `nevents_ptr` and the sentinel survives the call untouched — which
;; is a guest reading uninitialised memory and calling it an event count.
;;
;; Output is one 64-byte DAG-CBOR byte string:
;;
;;    0..3    poll_oneoff errno
;;    4..7    nevents after the call (sentinel if the host never wrote it)
;;    8..11   fd_read(3, …) errno — a descriptor that does not exist
;;   12..15   nread after the call
;;   16..19   fd_write(3, …) errno
;;   20..23   nwritten after the call
;;   24..27   clock_res_get(CLOCKID_REALTIME) errno
;;   28..35   the resolution it wrote (u64 LE)
;;   36..39   clock_res_get(CLOCKID_MONOTONIC) errno
;;   40..47   the resolution it wrote (u64 LE)
;;   48..51   clock_res_get(99) errno — a clock id nothing defines
;;   52..59   the resolution it wrote (u64 LE)
;;   60..63   sched_yield errno
;;
;; The three clocks are asked in one fixture because the claim under test is a
;; *consistency* one and cannot be made about a single call: the pinned host answers
;; every clock id, including ones the shim refuses with `ERRNO_NOSYS`, so that a guest
;; cannot discover which host it is on by asking about an obscure clock.
;;
;; fd 3 is the smallest descriptor that has never existed here — `fds` is exactly
;; `[stdin, stdout, stderr]` and there are no preopens — so it is what a translated
;; binary hits the moment it assumes a filesystem.

(module
  (import "wasi_snapshot_preview1" "poll_oneoff"
    (func $poll_oneoff (param i32 i32 i32 i32) (result i32)))
  (import "wasi_snapshot_preview1" "fd_read"
    (func $fd_read (param i32 i32 i32 i32) (result i32)))
  (import "wasi_snapshot_preview1" "fd_write"
    (func $fd_write (param i32 i32 i32 i32) (result i32)))
  (import "wasi_snapshot_preview1" "clock_res_get"
    (func $clock_res_get (param i32 i32) (result i32)))
  (import "wasi_snapshot_preview1" "sched_yield"
    (func $sched_yield (result i32)))
  (import "wasi_snapshot_preview1" "proc_exit"
    (func $proc_exit (param i32)))

  (memory (export "memory") 1 1)

  (global $IOV      i32 (i32.const 0))
  (global $NOUT     i32 (i32.const 8))
  (global $SUB      i32 (i32.const 64))    ;; a 48-byte Subscription, left zeroed
  (global $EVT      i32 (i32.const 128))   ;; where an Event would be written
  (global $SCRATCH  i32 (i32.const 256))   ;; the iovec's buffer, never touched
  (global $OUT      i32 (i32.const 1024))  ;; payload; the 2-byte header sits at $OUT-2
  (global $SENTINEL i32 (i32.const 0xa5a5a5a5))

  (func (export "_start")
    (local $n i32)

    ;; A zeroed Subscription is a relative `CLOCKID_REALTIME` clock event with a zero
    ;; timeout — deliberately the *cheapest* thing to ask for, so that if the pinning
    ;; is ever removed this fixture returns promptly instead of hanging the suite.
    (i32.store offset=4 (global.get $OUT) (global.get $SENTINEL))
    (i32.store (global.get $OUT)
      (call $poll_oneoff (global.get $SUB) (global.get $EVT) (i32.const 1)
        (i32.add (global.get $OUT) (i32.const 4))))

    (i32.store (global.get $IOV) (global.get $SCRATCH))
    (i32.store offset=4 (global.get $IOV) (i32.const 8))

    (i32.store offset=12 (global.get $OUT) (global.get $SENTINEL))
    (i32.store offset=8 (global.get $OUT)
      (call $fd_read (i32.const 3) (global.get $IOV) (i32.const 1)
        (i32.add (global.get $OUT) (i32.const 12))))

    (i32.store offset=20 (global.get $OUT) (global.get $SENTINEL))
    (i32.store offset=16 (global.get $OUT)
      (call $fd_write (i32.const 3) (global.get $IOV) (i32.const 1)
        (i32.add (global.get $OUT) (i32.const 20))))

    (i32.store offset=24 (global.get $OUT)
      (call $clock_res_get (i32.const 0) (i32.add (global.get $OUT) (i32.const 28))))
    (i32.store offset=36 (global.get $OUT)
      (call $clock_res_get (i32.const 1) (i32.add (global.get $OUT) (i32.const 40))))
    (i32.store offset=48 (global.get $OUT)
      (call $clock_res_get (i32.const 99) (i32.add (global.get $OUT) (i32.const 52))))

    (i32.store offset=60 (global.get $OUT) (call $sched_yield))

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
          (then (call $proc_exit (i32.const 65)) (unreachable)))
        (if (i32.eqz (i32.load (global.get $NOUT)))
          (then (call $proc_exit (i32.const 66)) (unreachable)))
        (local.set $n (i32.add (local.get $n) (i32.load (global.get $NOUT))))
        (br $write)))

    (call $proc_exit (i32.const 0))
    (unreachable))
)
