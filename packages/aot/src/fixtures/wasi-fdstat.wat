;; Asks the host what its own file descriptors are, and publishes the answer.
;;
;; Two claims in `../wasi-executor.ts` are only observable through this call, and both
;; were untested until a surviving mutation said so — setting `fs_rights_base = 0n`
;; broke nothing, because no fixture had ever looked.
;;
;;   **Rights.** The shim leaves `fs_rights_base` at zero, and a libc that checks
;;   rights before reading concludes stdin is unreadable. Stating `FD_READ` on stdin
;;   and `FD_WRITE` on stdout is what makes a real translated binary work; a
;;   hand-written fixture that calls `fd_read` directly never notices either way.
;;
;;   **Inode numbers.** The shim's own `File`/`OpenFile`/`ConsoleStdout` take `ino`
;;   from `Inode.issue_ino()` — a module-global counter — so a guest asking about
;;   stdin would get a number that depends on how many tasks this *process* ran
;;   first. Two nodes would then disagree over a value neither of them chose. The
;;   executor's descriptors carry hardcoded inodes and zero timestamps instead, and
;;   this fixture is what proves it.
;;
;; Output is one 112-byte DAG-CBOR byte string:
;;
;;   0..23    fdstat of fd 0 (stdin)
;;   24..47   fdstat of fd 1 (stdout)
;;   48..111  filestat of fd 0
;;
;; `fdstat` is `{u8 filetype, pad, u16 flags, pad[4], u64 rights_base,
;; u64 rights_inheriting}`; `filestat` starts `{u64 dev, u64 ino, u8 filetype, …}`.

(module
  (import "wasi_snapshot_preview1" "fd_fdstat_get"
    (func $fd_fdstat_get (param i32 i32) (result i32)))
  (import "wasi_snapshot_preview1" "fd_filestat_get"
    (func $fd_filestat_get (param i32 i32) (result i32)))
  (import "wasi_snapshot_preview1" "fd_write"
    (func $fd_write (param i32 i32 i32 i32) (result i32)))
  (import "wasi_snapshot_preview1" "proc_exit"
    (func $proc_exit (param i32)))

  (memory (export "memory") 1 1)

  (global $IOV  i32 (i32.const 0))
  (global $NOUT i32 (i32.const 8))
  (global $BUF  i32 (i32.const 1024))

  (func (export "_start")
    (local $n i32)

    (if (call $fd_fdstat_get (i32.const 0) (i32.add (global.get $BUF) (i32.const 0)))
      (then (call $proc_exit (i32.const 65)) (unreachable)))
    (if (call $fd_fdstat_get (i32.const 1) (i32.add (global.get $BUF) (i32.const 24)))
      (then (call $proc_exit (i32.const 66)) (unreachable)))
    (if (call $fd_filestat_get (i32.const 0) (i32.add (global.get $BUF) (i32.const 48)))
      (then (call $proc_exit (i32.const 67)) (unreachable)))

    (i32.store8 (i32.sub (global.get $BUF) (i32.const 2)) (i32.const 0x58))
    (i32.store8 (i32.sub (global.get $BUF) (i32.const 1)) (i32.const 0x70))

    (local.set $n (i32.const 0))
    (block $write_done
      (loop $write
        (br_if $write_done (i32.ge_u (local.get $n) (i32.const 114)))
        (i32.store (global.get $IOV)
          (i32.add (i32.sub (global.get $BUF) (i32.const 2)) (local.get $n)))
        (i32.store offset=4 (global.get $IOV) (i32.sub (i32.const 114) (local.get $n)))
        (if (call $fd_write (i32.const 1) (global.get $IOV) (i32.const 1) (global.get $NOUT))
          (then (call $proc_exit (i32.const 68)) (unreachable)))
        (if (i32.eqz (i32.load (global.get $NOUT)))
          (then (call $proc_exit (i32.const 69)) (unreachable)))
        (local.set $n (i32.add (local.get $n) (i32.load (global.get $NOUT))))
        (br $write)))

    (call $proc_exit (i32.const 0))
    (unreachable))
)
