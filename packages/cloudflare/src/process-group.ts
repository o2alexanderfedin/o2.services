import { spawn } from 'node:child_process'
import type { ChildProcess, SpawnOptions } from 'node:child_process'

/**
 * Start a command as the leader of a process group of its own, so {@link killGroup} can later
 * stop everything it started — not just the one process `spawn` handed back.
 *
 * **Why the group, measured.** `npx wrangler dev` is a chain: `npm exec` starts
 * `node …/.bin/wrangler`, which starts the wrangler CLI, which starts `workerd` — and `workerd`
 * is what holds the port. On Linux a `SIGTERM` to the `npx` process ends `npm exec` alone; the
 * rest of the chain is re-parented to init and keeps serving. That is why every scheduled run of
 * `region-loss-drill.yml` failed with `port 8832 was still answering after 60000 ms` (runs
 * 35567943605 and 36385978584 on `main`, 36620165716 dispatched on `develop`), and a `node:22`
 * container reproduced it with `ps` showing the orphaned wrangler and both `workerd` processes
 * at parent 1. On macOS the same signal happened to reach the whole chain, which is why the
 * drill passed on a developer machine and never on the runner.
 *
 * `workerd` stays in the group: miniflare spawns it without `detached`.
 */
export function spawnGroup(command: string, args: readonly string[], options: SpawnOptions): ChildProcess {
  return spawn(command, args, { ...options, detached: true })
}

/**
 * Send `signal` to every process in the group {@link spawnGroup} started.
 *
 * **No fallback to `child.kill`.** Signalling only the leader is the exact behaviour that left
 * the port answering, so a child that has no group of its own is an error here rather than a
 * quieter version of the defect. Only the group this module created is signalled; nothing
 * outside it is reached.
 */
export function killGroup(child: ChildProcess, signal: NodeJS.Signals): void {
  const pid = child.pid
  if (pid === undefined) {
    throw new Error('killGroup: the child has no pid — it never started, so there is no group to stop')
  }
  process.kill(-pid, signal)
}
