/**
 * A long-running binary stops when the process that spawned it goes away.
 *
 * ## What was leaking
 *
 * On POSIX a child does not die with its parent. Every spawn site of these binaries is a
 * test, every one of them tears its children down in an `afterEach`, and none of that runs
 * when the parent is killed rather than asked: an interrupted run, a killed Vitest worker,
 * a harness torn down mid-test. `SIGKILL` runs no handler by definition, so nothing on the
 * *parent* side can be made to cover it. **Measured, not reasoned:** a sweep on 2026-08-01
 * found three `bin/agent.ts` processes from two different sessions still listening,
 * reparented to pid 1, the oldest 20h45m old at 14.5 MB. That is process-table pressure
 * this repository already has a name for — `tools/aot/lift.ts`'s `host-cannot-spawn`.
 *
 * So the answer has to live in the child, and it is stdin. A parent that spawns one of
 * these binaries with a pipe on fd 0 holds the write end; when that parent dies — however
 * it dies — the kernel closes it and the child reads EOF. No handler on the parent side,
 * no bookkeeping, no timer, and it covers the one case no exit handler can.
 *
 * ## The gate is the whole design
 *
 * **The leash arms only when fd 0 is a socket or a FIFO.** Three readings of fd 0 have to
 * be told apart, and `fstat` tells them apart exactly:
 *
 * | How the process was started | fd 0 | Leash |
 * |---|---|---|
 * | `spawn(…, { stdio: ['pipe', …] })` | socket (libuv uses `socketpair`) | armed |
 * | `some-command \| bin.ts` | FIFO | armed |
 * | `spawn(…, { stdio: ['ignore', …] })` | character device (`/dev/null`) | not armed |
 * | an operator at a terminal | character device (tty) | not armed |
 * | `bin.ts < /dev/null`, `nohup bin.ts &` | character device | not armed |
 *
 * The two rows that must not arm are the same row to `fstat`, which is what makes the gate
 * safe rather than lucky: **`/dev/null` returns EOF on the very first read**, so an ungated
 * version of this would exit during startup at every caller that ignores stdin — and until
 * the commit that added this, that was *every* caller. An operator's terminal is a
 * character device too, so it is excluded by the same clause, and so is a node deliberately
 * backgrounded away from its shell. Nothing here reads stdin for content; the pipe carries
 * no data, only the fact that it is still open.
 *
 * That exclusion is not hypothetical. The sweep that produced this module also found a
 * `bin/seed.ts` five days and twenty-three hours old whose parent shell was still alive —
 * an operator's own long-running seed, which this gate must never take down.
 *
 * The consequence a caller has to know: **a spawn site that ignores stdin gets no leash.**
 * That is opt-in by construction — the parent asks for supervision by handing over a pipe —
 * and `orphan-leash.node.test.ts` both demonstrates the leash against a `SIGKILL`ed parent
 * and guards every spawn site in this package against quietly opting out again.
 *
 * ## Why this is one module rather than one copy per binary
 *
 * `bin/agent.ts` had this inline and `bin/seed.ts` had nothing, which is how a seed came to
 * be spawnable with no leash at all. Two copies of a gate whose correctness rests on a
 * three-row `fstat` distinction is two places for that distinction to drift, and the drift
 * would be silent in exactly the direction that leaks. One implementation, one table, and a
 * source guard that every binary calls it.
 */

import { fstatSync } from 'node:fs'

/**
 * How long a leash-triggered stop may take before the process leaves anyway.
 *
 * The spawning tests give a wedged node 10 s and then `SIGKILL` it. On this path there is
 * no parent left to do that — being parentless is the whole reason this path ran — so the
 * deadline has to be local, or a binary that wedges in `stop()` becomes exactly the orphan
 * this leash exists to prevent. 5 s rather than 10 because nothing is waiting on a clean
 * unwind here: no parent will read an exit code and no peer is owed a goodbye.
 *
 * **Unmeasured, and said rather than left to be assumed:** nothing in this repository
 * induces a wedged `stop()`, so this budget's *expiry* is reasoned and not observed. What
 * is observed is the ordinary path — `orphan-leash.node.test.ts` sees each process gone
 * 250–600 ms after its parent dies, an order of magnitude inside this.
 */
export const LEASH_STOP_BUDGET_MS = 5_000

/**
 * Is fd 0 a pipe somebody is holding open, rather than `/dev/null` or a terminal?
 *
 * See the module comment for the table this implements. A closed or unreadable fd 0 is
 * *not* a leash: `fstat` is the only thing consulted, and if it cannot answer, the process
 * is supervised by nobody and says so by declining to arm rather than by guessing.
 */
export function parentHoldsAPipe(): boolean {
  try {
    const fd0 = fstatSync(0)
    return fd0.isSocket() || fd0.isFIFO()
  } catch {
    return false
  }
}

/**
 * Arm the leash if a parent is holding fd 0 open, and report whether it armed.
 *
 * Call this **before** the thing being supervised is started, not after. The startup window
 * is not free: an enrolling agent dials a provider and waits on it, a seed stands up a
 * libp2p node and an HTTP server, and a parent killed during either would orphan the
 * process before there was anything to shut down. Leaving during startup is safe to do
 * abruptly — `identity-store` writes the identity key and the certificate through a rename,
 * which is atomic on POSIX, so a process that leaves mid-write leaves either the old file
 * or the new one.
 *
 * `stop` is therefore called at a moment when the caller's own state may not exist yet, and
 * every caller passes a function that tolerates that.
 *
 * The return value exists for the caller that wants to say which mode it is in; nothing is
 * required to read it.
 */
export function armOrphanLeash(stop: () => void): boolean {
  if (!parentHoldsAPipe()) return false

  const leashBroke = (): void => {
    // Unreffed so this timer is never the reason the process stays up; the server's own
    // listener keeps the loop alive long enough for it to fire, and if `stop()` finishes
    // first the process is already gone.
    setTimeout(() => process.exit(0), LEASH_STOP_BUDGET_MS).unref()
    stop()
  }

  // `end` is EOF: the last writer closed. `error` is the same fact arriving as ECONNRESET,
  // which a socketpair can report when the peer is killed rather than closed — and an
  // unhandled `error` on this stream would take the process down with a stack trace instead
  // of an unwind, which is a worse way to be right.
  process.stdin.on('end', leashBroke)
  process.stdin.on('error', leashBroke)
  process.stdin.resume()
  process.stdin.unref()
  return true
}
