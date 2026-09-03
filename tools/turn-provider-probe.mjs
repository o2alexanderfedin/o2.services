import dgram from 'node:dgram'

const COOKIE = 0x2112a442

function msg(type, attrs = Buffer.alloc(0)) {
  const h = Buffer.alloc(20)
  h.writeUInt16BE(type, 0)
  h.writeUInt16BE(attrs.length, 2)
  h.writeUInt32BE(COOKIE, 4)
  for (let i = 8; i < 20; i++) h[i] = Math.floor(Math.random() * 256)
  return Buffer.concat([h, attrs])
}

// REQUESTED-TRANSPORT (0x0019) = UDP (17)
const reqTransport = Buffer.from([0x00, 0x19, 0x00, 0x04, 17, 0, 0, 0])

function probe(host, port, type, attrs, label) {
  return new Promise((resolve) => {
    const s = dgram.createSocket('udp4')
    const t = setTimeout(() => { s.close(); resolve({ label, answer: 'NO REPLY (2 s)' }) }, 2000)
    s.on('message', (b) => {
      clearTimeout(t)
      const respType = b.readUInt16BE(0)
      let err = ''
      // walk attributes looking for ERROR-CODE (0x0009)
      let o = 20
      while (o + 4 <= b.length) {
        const at = b.readUInt16BE(o), al = b.readUInt16BE(o + 2)
        if (at === 0x0009 && o + 4 + al <= b.length) {
          const cls = b[o + 4 + 2] & 0x07, num = b[o + 4 + 3]
          err = ` error ${cls}${String(num).padStart(2, '0')}: ${b.subarray(o + 8, o + 4 + al).toString()}`
        }
        o += 4 + al + ((4 - (al % 4)) % 4)
      }
      s.close()
      resolve({ label, answer: `type 0x${respType.toString(16).padStart(4, '0')}${err}` })
    })
    s.on('error', (e) => { clearTimeout(t); s.close(); resolve({ label, answer: `socket error ${e.message}` }) })
    s.send(msg(type, attrs), port, host)
  })
}

/**
 * The hosts to probe, read from **this repository's own list** rather than a copy.
 *
 * It used to be a hand-edited literal here, and the consult that ruled the provider had to say
 * *"reproduce after editing its `HOSTS` list"*. That is a second list, and a second list is a
 * thing that can disagree with the first — which is the exact defect Phase 34 exists to remove
 * from the ICE configuration. So the STUN legs come from `STUN_SERVERS`, and a name dropped
 * there stops being probed here in the same change.
 *
 * The TURN legs stay written out: they are the *provider question*, not the fabric's STUN list,
 * and both ports belong in the probe because Cloudflare was measured answering on each.
 */
const { STUN_SERVERS } = await import('../packages/browser/src/ice-configuration.ts')

const TURN_HOSTS = [
  ['turn.cloudflare.com', 3478],
  ['turn.cloudflare.com', 53],
]

const HOSTS = [
  ...TURN_HOSTS,
  ...STUN_SERVERS.map((entry) => {
    const [host, port] = entry.urls.replace(/^stuns?:/, '').split(':')
    return [host, Number(port ?? '3478')]
  }),
]
for (const [h, p] of HOSTS) {
  const bind = await probe(h, p, 0x0001, Buffer.alloc(0), `${h}:${p} STUN Binding  `)
  const allo = await probe(h, p, 0x0003, reqTransport, `${h}:${p} TURN Allocate `)
  console.log(`${bind.label} -> ${bind.answer}`)
  console.log(`${allo.label} -> ${allo.answer}`)
}
