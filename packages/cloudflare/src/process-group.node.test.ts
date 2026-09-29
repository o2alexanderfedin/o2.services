import { once } from 'node:events'
import { Writable } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { killGroup, spawnGroup } from './process-group.ts'

/**
 * The shape that broke the region-loss drill, rebuilt with two `node` processes and no port.
 *
 * The parent starts a grandchild with inherited stdio and forwards no signal — what `npm exec`
 * does on Linux. The grandchild prints `ready <pid>` and then echoes whatever arrives on fd 3.
 * After the kill, the test writes a probe line to fd 3: a grandchild that survived echoes it, a
 * dead one cannot, and stdout ends only once every process holding it has exited. So the
 * verdict is read from events, not from a clock.
 *
 * **fd 3, not stdin.** Node destroys a child's stdin the moment the child exits, so a probe
 * written to stdin after the parent's exit never arrives and the grandchild exits on EOF — a
 * test built that way passed with the defect planted. fd 3 is left open.
 */
const GRANDCHILD =
  "process.stdout.write('ready ' + process.pid + '\\n');" +
  "new (require('node:net').Socket)({ fd: 3, readable: true, writable: false }).pipe(process.stdout)"
const PARENT =
  "require('node:child_process').spawn(process.execPath, ['-e', process.argv[1]], { stdio: [0, 1, 2, 3] });" +
  'setInterval(() => {}, 1 << 30)'

const PROBE = 'probe-after-kill'

describe('killGroup stops the whole tree a wrapper process started', () => {
  it('leaves no grandchild answering after a SIGTERM to the group', async () => {
    const child = spawnGroup(process.execPath, ['-e', PARENT, GRANDCHILD], {
      stdio: ['ignore', 'pipe', 'ignore', 'pipe'],
    })
    const stdout = child.stdout
    const probe = child.stdio[3]
    if (stdout === null || !(probe instanceof Writable)) throw new Error('spawnGroup did not return piped stdio')
    stdout.setEncoding('utf8')
    probe.on('error', () => {}) // EPIPE once the tree is gone is the expected outcome.

    let text = ''
    let grandchildPid: number | undefined
    const ready = new Promise<void>((resolve) => {
      stdout.on('data', (chunk: string) => {
        text += chunk
        const match = /ready (\d+)\n/.exec(text)
        if (match !== null && grandchildPid === undefined) {
          grandchildPid = Number(match[1])
          resolve()
        }
      })
    })
    let treeGone = false
    const ended = once(stdout, 'end').then(() => {
      treeGone = true
    })
    try {
      await ready
      const exited = once(child, 'exit')
      killGroup(child, 'SIGTERM')
      await exited

      const echoed = new Promise<'echoed'>((resolve) => {
        stdout.on('data', () => {
          if (text.includes(PROBE)) resolve('echoed')
        })
      })
      probe.write(`${PROBE}\n`)
      const verdict = await Promise.race([echoed, ended.then(() => 'ended' as const)])

      expect(verdict, 'the grandchild survived the kill and echoed the probe — only the wrapper was signalled').toBe(
        'ended',
      )
      expect(text, 'nothing may be echoed after the kill').not.toContain(PROBE)
    } finally {
      // Only the two processes this test started, and only if a mutant left them running.
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
      // Skipped once stdout has ended: every holder has exited, and its pid may be reused.
      if (grandchildPid !== undefined && !treeGone) {
        try {
          process.kill(grandchildPid, 'SIGKILL')
        } catch {
          // Already gone.
        }
      }
    }
  })

  it('refuses a child with no pid rather than signalling nothing', () => {
    const neverStarted = spawnGroup('/nonexistent/o2-process-group-probe', [], { stdio: 'ignore' })
    neverStarted.on('error', () => {})
    expect(() => killGroup(neverStarted, 'SIGTERM')).toThrow(/no pid/)
  })
})
