# Does a browser tab auto-promote to kad-dht server mode?

**Measured 2026-08-14.** Settled by reading `@libp2p/kad-dht@16.4.0`'s own predicate and
running it against the matcher versions this repository actually has installed.

## Why this was asked

Three independently-produced designs for DHT-backed registration and discovery each
justified their browser-tier policy on the claim that *a browser can never auto-promote to
DHT server mode*, and each stated it as measured. It was not measured. `CLAUDE.md`'s own
DHT section records the opposite status, in as many words:

> **Unverified, and it matters:** js-libp2p promotes kad-dht to server mode when it detects
> a public dialable address. Whether a relayed `/p2p-circuit` address satisfies that check
> is **unmeasured** — the package is not installed, so it could not be read.

So the designs converted an open question into a foundation. This file closes the question.

## The predicate, quoted

`@libp2p/kad-dht@16.4.0`, `src/kad-dht.ts:340-356`. Note the guard on the whole block:
**auto-promotion is installed only when `clientMode` is left unset.**

```ts
    // if client mode has not been explicitly specified, auto-switch to server
    // mode when the node's peer data is updated with publicly dialable
    // addresses
    if (init.clientMode == null) {
      components.events.addEventListener('self:peer:update', (evt) => {
        void Promise.resolve().then(async () => {
          const hasPublicAddress = evt.detail.peer.addresses
            .some(({ multiaddr }) => {
              return !isPrivate(multiaddr) && !Circuit.exactMatch(multiaddr)
            })

          const mode = this.getMode()

          if (hasPublicAddress && mode === 'client') {
            await this.setMode('server')
          } else if (mode === 'server' && !hasPublicAddress) {
            await this.setMode('client')
          }
        })
      })
    }
```

with `import { isPrivate } from '@libp2p/utils'` and
`import { Circuit } from '@multiformats/multiaddr-matcher'` (`:2-3`), and the default
`this.clientMode = init.clientMode ?? true` (`:176`).

## The reading

The predicate was run against `@multiformats/multiaddr-matcher` and `@libp2p/utils` **as
installed in this repository**, not against a description of them.

| listen address | `isPrivate` | `Circuit.exactMatch` | `hasPublicAddress` |
|---|---|---|---|
| tab `/p2p-circuit`, public relay | false | **true** | **false** |
| tab `/webrtc`, public relay | false | false | **TRUE** |
| tab `/webrtc`, LAN relay | **true** | false | false |
| node default `/ip4/127.0.0.1/tcp/0` | **true** | false | false |
| node public `/tls/ws` | false | false | **TRUE** |

A browser's `/webrtc` listen address has the concrete form
`<relay>/p2p-circuit/webrtc/p2p/<self>`, which is a WebRTC multiaddr and **not** an exact
Circuit match — `WebRTC.matches` is true and `Circuit.exactMatch` is false for it.

## Three findings, and each one moves a design decision

**1. A browser tab behind a public relay DOES auto-promote.** The shared premise is false.
The designs were correct about `/p2p-circuit` — that address is excluded by name — and wrong
to generalise from it to "the browser", because `browser-node.ts:197` listens on
`['/p2p-circuit', '/webrtc']` and the second address is the one that decides.

**2. Promotion is a property of the RELAY's address, not of the tab.** The identical tab
promotes when reserved on a public relay and stays a client when reserved on a LAN relay,
because `isPrivate` is evaluated against the relay portion of the circuit address. A node's
DHT role would therefore be decided by network topology rather than by configuration, and
would change between a LAN demo and a hosted one with nothing in the code saying so.

**This is the argument for setting `clientMode` explicitly**, and it is stronger than the
stylistic one `CLAUDE.md` already gives. Left unset, the fabric has a role assignment nobody
declared and no test can pin, because the deciding input is which relay answered first.

**3. `canRelay` is not this predicate and must not be used as a proxy for it.** A node
listening on the default `/ip4/127.0.0.1/tcp/0` satisfies `canRelay` and does **not**
promote, because loopback is private. Any design keying DHT server mode on `canRelay`
creates DHT servers that a tab cannot dial — which was raised independently as a fatal flaw
against the tiered-hybrid design and is confirmed here by measurement rather than by
argument.

## What this does not establish

- That a promoted tab can usefully **answer** queries. Promotion sets a flag and registers a
  protocol handler; whether peers can reach that handler over a limited (relayed) connection
  is a separate question, and `runOnLimitedConnection` does not appear anywhere in
  `kad-dht@16.4.0`'s source. Unmeasured, and not claimed here.
- Anything about query latency or routing-table convergence in a browser mesh.

## Consequence for the design

`clientMode` is passed explicitly on both tiers. The value is a stated policy, not an
inference from the address set, and the reason is finding 2 above.
