import dgram from 'node:dgram'
import { lookup } from 'node:dns/promises'
import { randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { STUN_SERVERS } from '../../browser/src/ice-configuration.ts'

/**
 * The rot guard — NET-12.
 *
 * `packages/browser/src/ice-configuration.ts` states this fabric's STUN list because the
 * library's default list **rotted with nothing saying so**: `stun.services.mozilla.com` stopped
 * resolving and every tab kept performing a failing DNS lookup on every ICE gathering. Stating
 * the list fixes the entry that was dead. It does not fix the *class* of defect, which is that
 * a list of third parties can rot again and this repository would not notice. This file is what
 * notices.
 *
 * It is in the **e2e** lane because it reaches the public internet, which the node lane does
 * not. It imports the list from the module rather than copying it — a copy is a second list
 * that can disagree with the first, which is the thing being guarded against.
 *
 * ## The ordering is the design, and it is the reason this guard can be believed
 *
 * A guard that resolves three names and fails when one does not is indistinguishable, on a
 * laptop with no network, from a guard reporting that all three are dead. So nothing is judged
 * until two controls have answered **in the same run**:
 *
 * 1. **The positive control.** `stun.cloudflare.com` must resolve and answer a Binding. If it
 *    does not, this machine's network is the finding and no entry is blamed — the failure text
 *    says so in those words.
 * 2. **The negative control.** A name in the reserved `.invalid` TLD (RFC 2606, which never
 *    resolves) must fail to resolve. That proves the instrument can report a failure at all.
 *    A green with this absent is a green that could not have gone red.
 *
 * Only then are the configured entries judged. The two controls are exactly the shape the
 * consult used to separate *this name is gone* from *DNS is not working here* — it resolved
 * `stun.cloudflare.com` on `8.8.8.8`, `1.1.1.1` and `9.9.9.9` in the same breath the dead name
 * answered `NXDOMAIN` on all three.
 *
 * The STUN encoding is `tools/turn-provider-probe.mjs`'s, reused rather than written a second
 * time: two encoders drift, and a probe that disagrees with the tool the consult was taken with
 * would make this guard's readings incomparable to the readings that motivated the list.
 */

const COOKIE = 0x2112a442
/** RFC 2606 reserves `.invalid` precisely so it can never resolve. The negative control. */
const NEVER_RESOLVES = 'o2-negative-control.invalid'
/** Generous: a public STUN server on a loaded laptop is not a latency measurement. */
const REPLY_TIMEOUT_MS = 4000

/** A STUN Binding request, byte-for-byte the shape `turn-provider-probe.mjs` sends. */
function bindingRequest(): Buffer {
  const header = Buffer.alloc(20)
  header.writeUInt16BE(0x0001, 0) // Binding request
  header.writeUInt16BE(0, 2) // no attributes
  header.writeUInt32BE(COOKIE, 4)
  randomBytes(12).copy(header, 8) // transaction id
  return header
}

interface Reading {
  readonly answered: boolean
  readonly detail: string
}

/** Send one Binding and say what came back. Never throws — the answer is the reading. */
async function stunBinding(host: string, port: number): Promise<Reading> {
  return new Promise<Reading>((resolve) => {
    const socket = dgram.createSocket('udp4')
    const settle = (reading: Reading): void => {
      clearTimeout(timer)
      try {
        socket.close()
      } catch {
        // Already closed by the error path. Closing twice is not a finding.
      }
      resolve(reading)
    }
    const timer = setTimeout(
      () => settle({ answered: false, detail: `no reply within ${String(REPLY_TIMEOUT_MS)} ms` }),
      REPLY_TIMEOUT_MS,
    )
    socket.on('message', (message) => {
      const type = message.readUInt16BE(0)
      settle({
        answered: type === 0x0101,
        detail: `reply type 0x${type.toString(16).padStart(4, '0')}`,
      })
    })
    // `ENOTFOUND` arrives here rather than as a timeout, which is itself the distinction
    // between *no such name* and *no answer* — the consult's own words.
    socket.on('error', (cause: Error) => settle({ answered: false, detail: cause.message }))
    socket.send(bindingRequest(), port, host)
  })
}

/** Split `stun:host:port` into its parts. The list stores URLs; the socket needs the pieces. */
function hostAndPort(url: string): { host: string; port: number } {
  const [host, port] = url.replace(/^stuns?:/, '').split(':')
  return { host: host ?? '', port: Number(port ?? '3478') }
}

describe('NET-12 — the stated ICE list has not rotted, and the instrument proves it could say so', () => {
  it('CONTROL 1 (positive): the network is up — stun.cloudflare.com resolves and answers', async () => {
    let address: string
    try {
      address = (await lookup('stun.cloudflare.com')).address
    } catch (cause) {
      throw new Error(
        `THIS MACHINE HAS NO NETWORK (or no DNS): stun.cloudflare.com did not resolve — ` +
          `${String(cause)}. No entry in ice-configuration.ts is implicated by this run; ` +
          `re-run with a network before reading anything below as a dead entry.`,
      )
    }
    const reading = await stunBinding('stun.cloudflare.com', 3478)
    expect(
      reading.answered,
      `THIS MACHINE CANNOT REACH PUBLIC STUN: the control resolved to ${address} but did not ` +
        `answer a Binding (${reading.detail}). UDP may be blocked here. This is a statement ` +
        `about the network, NOT about any entry in ice-configuration.ts.`,
    ).toBe(true)
  })

  it('CONTROL 2 (negative): the instrument can report a failure — a .invalid name does not resolve', async () => {
    await expect(lookup(NEVER_RESOLVES)).rejects.toThrow()
  })

  for (const entry of STUN_SERVERS) {
    const { host, port } = hostAndPort(entry.urls)

    it(`${host}:${String(port)} still resolves — the check the dead entry failed`, async () => {
      await expect(
        lookup(host),
        `${host} DID NOT RESOLVE. Both controls in this file passed, so the network is up and ` +
          `this instrument can report failure — which makes this a DEAD ENTRY, not an offline ` +
          `host. Probe it, and if it is gone remove it from STUN_SERVERS in ` +
          `packages/browser/src/ice-configuration.ts rather than leaving every tab to perform ` +
          `a failing DNS lookup on every ICE gathering. Its stated reason was: ${entry.why}`,
      ).resolves.toBeDefined()
    })

    it(`${host}:${String(port)} still answers a STUN Binding (last probed ${entry.probedOn})`, async () => {
      const reading = await stunBinding(host, port)
      expect(
        reading.answered,
        `${host}:${String(port)} resolved but did not answer a STUN Binding (${reading.detail}). ` +
          `The positive control answered in this same run, so this is the entry and not the ` +
          `network. Its stated reason was: ${entry.why}`,
      ).toBe(true)
    })
  }
})
