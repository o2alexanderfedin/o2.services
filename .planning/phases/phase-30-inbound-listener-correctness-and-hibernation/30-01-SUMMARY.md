---
phase: 30-inbound-listener-correctness-and-hibernation
plan: 1
subsystem: hosted-tier
tags: [cloudflare, durable-objects, libp2p, inbound-listener, hibernation, workerd, e2e]
requires:
  - .planning/phases/phase-29-hosted-tier-assembly-and-first-deploy/29-REPORT.md
provides:
  - "NET-11 Done — eight real libp2p peers admitted where the default configuration admitted four"
  - "HOST-15 Done — canSendMore answers a stated value, with an anti-vacuity case beside it"
  - "a locally-run workerd established as a real test target, retiring two 'not testable locally' docblocks"
  - "hostedConnectionManagerInit() — two finite bounds where libp2p's per-host default stood"
affects:
  - packages/cloudflare/src/hosted-libp2p.ts
  - packages/cloudflare/src/inbound-listener.e2e.test.ts
  - packages/cloudflare/src/websocket-connection.test.ts
  - packages/cloudflare/src/worker.ts
  - packages/cloudflare/src/hibernatable-socket.ts
  - packages/cloudflare/.gitignore
  - vitest.config.ts
  - .planning/REQUIREMENTS.md
tech-stack:
  added: []
  patterns:
    - "an e2e assertion over the transport's own admission, never over the HTTP status that precedes it"
    - "a bound is raised to a finite number and stated, never removed"
    - "an anti-vacuity case supplies the field whose absence every other case relies on"
key-files:
  created:
    - packages/cloudflare/src/inbound-listener.e2e.test.ts
    - packages/cloudflare/.gitignore
  modified:
    - packages/cloudflare/src/hosted-libp2p.ts
    - packages/cloudflare/src/websocket-connection.test.ts
    - packages/cloudflare/src/worker.ts
    - packages/cloudflare/src/hibernatable-socket.ts
    - vitest.config.ts
decisions:
  - "The phase was executed rather than owner-gated, because `wrangler dev` runs real workerd with no account and no deploy — measured, not assumed"
  - "`inboundConnectionThreshold` is 256 and `maxIncomingPendingConnections` 128; both finite, because the defect is an unstated bound and not a low one"
  - "The first e2e spec was discarded and rewritten: it asserted on HTTP 101, and both plants stayed green against it"
metrics:
  duration: ~3 h
  completed: 2026-08-30
  verification: "node lane 214/214 (3108 tests) exit 0; e2e 4/4; tsc --noEmit -p packages/cloudflare exit 0"
---

# Phase 30 — Inbound Listener Correctness & Hibernation

## What this phase turned out to be

It was scoped as *shipping two fields libp2p needs*. It was **finding a live defect on the
hosted tier**, and the defect was not either of the two fields.

`createHostedLibp2p` passed **no `connectionManager` at all**. libp2p's default
`inboundConnectionThreshold` is **5 per second per remote host**, and the limiter keys on
`config.host` taken from `remoteAddr`. On an ordinary node that is a sensible defence. On a
Durable Object fronting a fabric it is **the whole fabric's admission rate**, and it fails
silently in both directions: nothing is logged at the node, and the dialler is told its
**encryption** failed.

Eight libp2p peers dialling the locally-run object together:

```
peer 4: EncryptionFailedError: The operation was aborted due to timeout
peer 5: EncryptionFailedError: The operation was aborted due to timeout
peer 6: EncryptionFailedError: The operation was aborted due to timeout
peer 7: EncryptionFailedError: The operation was aborted due to timeout
```

Four admitted, four refused, and the refusal names the wrong subsystem. `NET-11`'s own row
warned that *"a two-peer test on this cannot go red and so proves nothing"* — this is what the
row was protecting against, and eight peers is what surfaced it.

## The premise that made this phase owner-gated was false

Two docblocks — in `worker.ts` and `hibernatable-socket.ts` — said the platform half of the
listener could not be exercised without a deploy. Measured instead of quoted:

```
wrangler dev, the Cloudflare credential variable empty, no account
→ a real Durable Object with its own PeerId
→ WebSocketPair created, 101 with a correct RFC 6455 accept
→ a full Noise + yamux handshake from a plain createLibp2p
```

`wrangler dev` runs **real workerd**. Both docblocks now carry dated corrections pointing at
`inbound-listener.e2e.test.ts`. This is what reclassified the phase from an owner act to
executable work, and it is reusable: Phase 31's alarm work inherits it.

## The first e2e spec was wrong and is recorded rather than quietly replaced

It asserted on **HTTP 101 responses**. Plants A and B were **GREEN** against it, because a 101
is a statement about the platform's WebSocket upgrade and says nothing about whether libp2p
admitted the connection. It was rewritten to dial with eight separate real `createLibp2p`
nodes and to read the object's own connection list back. The lesson is the phase's, not the
file's: *the assertion must sit on the property under test, not on the nearest observable that
correlates with it.*

A second error inside that rewrite is worth keeping. `keyFor` produced the **same** key for
every peer, because the prefix `'o2-phase-30-key-'` is exactly 16 characters and `.slice(0,16)`
cut the index off. It surfaced as `expected 1 to be 8` — eight dials, one peer id. The index
now leads the string.

## Criterion 3 was rewritten around a measurement, not around an expectation

The criterion-3 case first expected a **refusal** when `CF-Connecting-IP` was absent. It failed
`expected 101 not to be 101`. A bare probe worker settled why: **workerd stamps the header
itself** (`cf-connecting-ip: 127.0.0.1`) and passes a supplied one through unchanged. So the
header is never absent on this platform, and a criterion demanding a refusal for its absence
was demanding something unobservable. The criterion now reads what was measured — the address
that is derived, per peer, distinct.

## Criterion 4 gained the case that could have gone red

Every existing backpressure case ran against a fake socket with **no** `bufferedAmount`. A
straight pass-through implementation would answer `undefined === 0` and stay green against all
of them. The added case supplies a socket that **has** the field:

```ts
it('does not derive the answer from a socket that HAS bufferedAmount', () => {
  const socket = new FakeCloudflareWebSocket()
  Object.assign(socket, { bufferedAmount: 1_000_000 })
  const { connection } = connect(socket)
  expect(connection.send(new Uint8Array([7]))).toBe(true)
})
```

## Plants — four, each watched red, each restored `cmp`-clean

| Plant | What was planted | Where it went red |
|---|---|---|
| A | `direction: 'inbound'` → `'outbound'` | unit lane, 2 cases |
| B | `remoteAddr` fixed for every peer | unit lane, 5 cases |
| C | `inboundConnectionThreshold` 256 → 5 | e2e, **named peers 4, 5, 6, 7** |
| D | `canSendMore` read from the raw socket field | unit lane, 2 cases |

Plant C is the one that matters: it reproduces the original defect on demand, which is what
makes the fix a fix rather than a configuration change that happened to coincide with a green.

## Two of my own errors, recorded because they cost time

1. The vocabulary guard refused the name of Cloudflare's credential environment variable in
   three new docblocks — the word reads as cryptocurrency to a reviewer who greps rather than
   reads. The guard was right; the docblocks name the credential without spelling it.
2. I wrote in `vitest.config.ts` that `unitFiles` *"does not move for an e2e file."*
   `slow-specs.node.test.ts` refused it at `expected 136 to be 137`: the identity is
   `unitFiles === files − excludedInNode`, and the subtrahend is the **named slow specs only**,
   not the lane a file belongs to. Recorded in the file rather than patched around.

## What this phase did NOT establish

- That the fix holds on the **deployed** object. Everything here was measured on a locally-run
  workerd. The numbers are the platform's; the deployment is not.
- Any claim about behaviour above 256 admissions a second. 256 is a bound, chosen finite on
  purpose, and nothing here probes it.

## Verification

```
npx vitest run --project node   → 214 files, 3108 tests, exit 0
npx vitest run --project e2e    → 4/4  (inbound-listener.e2e.test.ts)
npx tsc --noEmit -p packages/cloudflare → exit 0
```

Landed as `351fa4e`, merged to `develop` at `64cc720` and to `main` at `3cc0255`; the
`.wrangler/` ignore followed at `5700cd2` / `32aa596` / `fa30477`, because `wrangler dev` leaves
a state directory and two specs snapshot `git status --porcelain` around themselves.
