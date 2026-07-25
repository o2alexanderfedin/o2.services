# Phase 3 — Browser Tier & Backbone Relay

**Status:** IN PROGRESS — 3 of 6 criteria met, 1 open problem, 2 blocked on a human decision
**Requirements:** NET-02, NET-03, NET-04, NET-05, DATA-02, BROW-03, BROW-05
**Branch:** `feature/phase-3-browser-tier`

## Where it stands

```
tsc --noEmit  clean
230 tests     all green
```

| # | Criterion | Status |
|---|---|---|
| 5 | IndexedDB + filesystem behind one interface, same CIDs | **met** — DATA-02 |
| 4 | Relay at capacity reports exhaustion by name | **met** — NET-05 |
| 2 | No `/certhash/` literal; addresses resolve at runtime | **half met** — the source/runtime half is verified; real AutoTLS is blocked |
| 3 | 16+ simultaneous reservations; `runOnLimitedConnection` on handle *and* dial; relayed bytes stay small | **partial** — the flag is verified on both sides and a relayed circuit is obtained; 16-peer concurrency is not verified |
| 1 | Two browser tabs **on different machines** over WebRTC | **not met** — see open problem, then the blocker |
| 6 | Embedded, no COOP/COEP, throttles when backgrounded | **not started** — BROW-03, BROW-05 |

## Delivered

**`@o2/browser`** — new package, symmetric with `@o2/node`.
`IdbBlockstore` implements the kernel's four-method port directly on `idb@8.0.3`
(zero dependencies) rather than wrapping `blockstore-idb`, which implements the much
wider `interface-blockstore` and would mean an adapter over an adapter plus six
transitive dependencies to arrive at a contract we already have.

**Blockstore conformance suite** (`@o2/net/conformance.ts`) — this is what makes
DATA-02 a demonstrated property instead of a design intention. CID vectors are
**hardcoded literals**, and all three adapters run the same checks:
`MemoryBlockstore` (Node + Chromium), `FsBlockstore` (Node), `IdbBlockstore`
(Chromium). Literals matter: a computed expectation only proves an implementation
agrees with itself, whereas a literal pins the wire format so a codec change fails
instead of quietly re-deriving new "correct" answers on both sides. Vectors include
an empty block — several backends treat zero-length values as absent — and a 64 KiB
one, past the size where a browser backend stops behaving like a `Map`.

**`RelayNode`** — `circuitRelayServer` on WebSockets, one of only three things a
browser can dial. Tunable reservations; `capacity` reports
granted/limit/remaining/atCapacity read from the live reservation store.

**`ReservationWatcher`** — NET-05. When a relay is full it answers
`RESERVATION_REFUSED`, and libp2p reports that as an untyped `Error` with the status
only in its message, thrown inside an internal retry loop where no caller can catch
it. From outside, the joining node sees only that no `/p2p-circuit` address
appeared — indistinguishable from the relay being unreachable, and the two need
opposite responses. The watcher observes libp2p's own reported status through the
`logger` injection point and classifies it. Verified end to end against a real relay
at capacity, not by construction.

## Open problem — must be settled before criterion 1

**Requiring the responder to dial back does not survive the relayed topology, and
cannot survive the browser one.**

Phase 2 made `Transport` a one-way datagram port and put request/response
correlation above it in `@o2/net`. A reply is therefore a *new* `send`, which opens a
new stream by dialling the requester. On TCP that is free. Over circuit relay it
means each reply opens a second relayed circuit in the opposite direction, and
between two browser tabs it is simply impossible — neither can dial the other.

Observed directly. Three relay-only peers, 2 shards at R=2: one shard agreed at
`replicas: 1`, the other failed on both executors with

```
rpc send to 12D3Koo… failed: Remote closed connection during opening
```

So relayed streams do work; the *topology* does not hold up under a job's worth of
them. The tests that exposed this were removed rather than committed red, and are
reproduced below.

**The fix is a design change, not a patch: carry the reply on the request's own
stream.** That removes the dial-back entirely, halves circuits per exchange, and
fits inside the relay's 128 KiB budget. It means `Transport` gains a reply channel —
revisiting a Phase 2 decision — which is why it is written down here rather than
rushed. It is the right change: the browser tier is the reason the port exists, and
the current shape cannot serve it.

Do this **before** attempting criterion 1. Browser↔browser WebRTC built on the
current shape would fail for this reason and the failure would be misread as a
WebRTC or ICE problem.

Reproduction to restore once the reply path is fixed:

1. `RelayNode.start({ maxReservations: 8 })`
2. three `FabricNode.start({ listen: [], relayAddrs: [<relay ws addr>] })`
3. wait for `circuitAddrs.length > 0` on all three
4. submitter dials both workers at their `/p2p-circuit` addresses
5. `submitJob` with 2 shards, R=2, both executors remote — expect `complete: true`

A second, separate failure appeared in the 16-concurrent-reservation test:

```
EncryptionFailedError: Unexpected EOF - stream closed while reading 0/1 bytes
  at Upgrader._encryptOutbound
```

16 nodes dialling one relay simultaneously from a single process. Not diagnosed —
it may be relay connection-manager limits, or simply 16 libp2p nodes starting at
once in one process. Criterion 3 wants 16+ *browser* peers, so the eventual test
probably belongs in Playwright contexts rather than one Node process.

## Blocked on a human decision

Not attempted, deliberately.

1. **Criterion 2, real AutoTLS.** Needs a publicly reachable host so
   `registration.libp2p.direct` can complete a Let's Encrypt challenge.
2. **Criterion 1, "on different machines".** Needs a second machine or a publicly
   reachable relay.

Both mean standing up public infrastructure, which is an outward-facing,
hard-to-reverse action that collides with a standing constraint: the repository stays
private until publication, publishing forfeits EPO and China patent rights
permanently, and `DEMO-04` requires that no deploy workflow file exist at all.
Deciding this is the user's call, not an autonomous one.

A local two-context Playwright equivalent of criterion 1 is buildable without any of
that — after the reply-path fix.

## Decisions

- **`idb` over `blockstore-idb`** — our port is four methods; the alternative brings
  a wider interface and six dependencies to reach it.
- **Conformance vectors are literals, not computed.** See above.
- **`RelayCapacity` has no lifetime counter.**
  `@libp2p/circuit-relay-v2@4.2.9` declares `relay:reservation` in
  `RelayServerEvents` but **never dispatches it** — the name appears only in `.d.ts`
  files and `CircuitRelayServer` emits nothing at all. Confirmed with a throwaway
  probe, then pinned by a test. A counter on that event would read zero forever,
  which is precisely the failure mode NET-05 exists to remove.
- **The refusal classifier depends on a libp2p message string**, so all three real
  locations are pinned by tests: the template in `transport/reservation-store.js`,
  the status name in the protobuf `Status` enum, and the server's refusal in
  `server/reservation-store.js`. An upgrade that rewords any of them fails loudly.

## Problems found and fixed

1. **`MemoryBlockstore` aliased its input and its storage.** The conformance suite
   caught it immediately: `put` stored the caller's array by reference and `get`
   handed that reference back, so mutating a retrieved block corrupted the store,
   and so did mutating the caller's array after `put`. Both persistent adapters
   copy — the filesystem one snapshots on write and copies out of Node's Buffer
   pool, IndexedDB structured-clones — so code correct against a real backend could
   silently corrupt state under the in-memory adapter every kernel test uses. Fixed
   to copy both ways, matching the reasoning already documented in
   `MemoryNetwork.route`.
2. **My aliasing check could not detect aliasing.** With store, output, and input all
   aliased it compared an object with itself and passed; it also mutated a shared
   module-level vector and broke an unrelated test. Now uses bytes it owns and an
   independent snapshot taken before the mutation.
3. **I hand-wrote a `ComponentLogger` and it crashed every dial** with
   `maConn.log.newScope is not a function` — the interface has members beyond the
   obvious ones. Now delegates to `@libp2p/logger`'s `defaultLogger()` through a
   `Proxy`, so every member forwards including ones added by future releases, and
   `newScope` returns a wrapped logger so nested scopes stay observed. The
   "reimplementing the platform" anti-pattern, caught by a real dial.
4. **The message pin looked in the wrong file.** The template is built in the
   transport module but the status *name* comes from the protobuf enum. Corrected to
   pin all three real locations.
5. **Committed Vitest failure screenshots.** Removed and added to `.gitignore`.

## Carried forward

- `packages/node` is accumulating both the backbone-relay role and the worker role.
  If Phase 6 adds enrollment, splitting `@o2/backbone` out is worth considering.
- Node 23.11.0 remains non-LTS and outside vitest's declared range — see STATE.md.
