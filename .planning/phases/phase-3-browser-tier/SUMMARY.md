# Phase 3 — Browser Tier & Backbone Relay

**Status:** IN PROGRESS — 4 of 6 criteria met (criterion 1 met locally), 1 blocked on a human decision
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
| 3 | 16+ simultaneous reservations; `runOnLimitedConnection` on handle *and* dial; relayed bytes stay small | **partial** — the flag is verified on both sides, a relayed circuit is obtained, and the relay is *proven* to stay out of the data path; 16-peer concurrency is not verified |
| 1 | Two browser tabs **on different machines** over WebRTC | **met on one machine** — the "different machines" half is blocked |
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

## Two tabs, one machine — done

Two genuinely separate browser tabs complete a 4-shard, 2×-redundant map job over a
**direct** browser-to-browser WebRTC connection, with a self-hosted Circuit Relay v2
peer carrying only the SDP exchange.

The relay dropping out of the data path is **asserted, not assumed**. libp2p marks a
relayed circuit as *limited* (2 min / 128 KiB) and a WebRTC connection as unlimited,
so the test reads the live connection and requires a `/webrtc` remote address with
`limits === undefined`. A job secretly running over the relay fails that assertion.

Two isolated `BrowserContext`s rather than two pages in one context, so the tabs share
no IndexedDB, no peer identity, and no libp2p state — separate nodes in every sense
except the machine.

Verified by falsification before being trusted: flipping `limited` to `true` and the
expected partitions to `[9,9,9,9]` makes the assertions fail with real values, so they
genuinely execute rather than passing vacuously.

## Correction to an earlier finding

An earlier version of this summary recorded an "open problem": that requiring the
responder to dial back could not survive the browser topology. **That was mis-scoped
and is withdrawn.**

The observed failure came from running an entire job over `/p2p-circuit` — a topology
the architecture explicitly does not support, because the relay is a *signalling
channel and not a data path*. Over an established WebRTC connection the dial-back is
fine: the connection is unlimited and either side can open streams on it, which is
exactly what the two-tab test now demonstrates.

So `Transport` stays a one-way datagram port and the Phase 2 decision stands. What
remains true and worth remembering is the narrower fact: **a relayed circuit cannot
carry a job**, and any test that tries is testing an unsupported configuration.

Still not diagnosed, and unrelated to the above:

```
EncryptionFailedError: Unexpected EOF - stream closed while reading 0/1 bytes
  at Upgrader._encryptOutbound
```

16 nodes dialling one relay simultaneously from a single Node process. Criterion 3
wants 16+ *browser* peers, so that test probably belongs in Playwright contexts
rather than one process — which is now a cheap thing to build, since the two-tab
harness already opens isolated contexts against a live relay.

## Blocked on a human decision

Not attempted, deliberately.

1. **Criterion 2, real AutoTLS.** Needs a publicly reachable host so
   `registration.libp2p.direct` can complete a Let's Encrypt challenge.
2. **Criterion 1, "on different machines".** The WebRTC path itself is now proven on
   one machine; extending it across two needs a second machine or a publicly
   reachable relay. Nothing in the code should have to change — only the relay
   address the tabs are given.

Both mean standing up public infrastructure, which is an outward-facing,
hard-to-reverse action that collides with a standing constraint: the repository stays
private until publication, publishing forfeits EPO and China patent rights
permanently, and `DEMO-04` requires that no deploy workflow file exist at all.
Deciding this is the user's call, not an autonomous one.

The local two-context equivalent of criterion 1 is built and passing.

## Decisions

- **`@o2/libp2p` is a third tier.** The libp2p `Transport` adapter is dual-target, so
  it was extracted from `@o2/node` rather than duplicated into `@o2/browser` or
  reached across for. The rule is now enforced by `purity.node.test.ts`: `core`/`net`
  may not reference a platform *or libp2p*; `libp2p`/`browser` may use libp2p but no
  `node:` builtins; `node` may use anything.
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
6. **`optimizeDeps: { noDiscovery: true }` broke the browser page** with
   `does not provide an export named 'Netmask'`. Several libp2p transitive
   dependencies are CommonJS (`netmask`, via `@libp2p/utils`) and need Vite's
   pre-bundling for ESM interop. The error reads like a missing module and is not;
   a comment at the call site says so.

## Carried forward

- **Criterion 6 is untouched** — BROW-03 (throttle when the tab is backgrounded) and
  BROW-05 (embedded in a third-party page with no COOP/COEP). The two-tab harness is
  the natural place to test both.
- `packages/node` is accumulating both the backbone-relay role and the worker role.
  If Phase 6 adds enrollment, splitting `@o2/backbone` out is worth considering.
- Node 23.11.0 remains non-LTS and outside vitest's declared range — see STATE.md.
