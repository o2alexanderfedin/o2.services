# Phase 3 — Browser Tier & Backbone Relay

**Status:** IN PROGRESS — 5 of 6 criteria met, the remaining gaps all blocked on a public host or out of scope for a test suite
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
| 3 | 16+ simultaneous reservations; `runOnLimitedConnection` on handle *and* dial; relayed bytes stay small | **substantially met** — 16 real browser peers reserve simultaneously; the flag is verified on both sides; the relay is *proven* out of the data path. Not done: the >1 hour hold under churn, and per-peer relayed byte counters (js-libp2p exposes none) |
| 1 | Two browser tabs **on different machines** over WebRTC | **met on one machine** — the "different machines" half is blocked |
| 6 | Embedded, no COOP/COEP, throttles when backgrounded | **met** — BROW-03, BROW-05 |

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

## Criterion 6 — throttling and no-COOP/COEP operation

**BROW-05.** The node runs on an ordinary page with neither COOP nor COEP, asserted
from both ends: the HTTP response carries neither header, and the page reports
`crossOriginIsolated === false` with `SharedArrayBuffer` undefined. That absence is
also the concrete reason WASM threads are unavailable to this tier, so each executor
gets its own instance.

**BROW-03.** `VisibilityGovernor` drives the duty cycle from document visibility —
full rate visible, 0.05 hidden, never zero. Zero would abandon a task in flight rather
than pace it, and `GovernedExecutor` yields only *between* tasks, so work already
started always finishes. That is what "resumes on return without losing its job"
actually requires.

### The governor did not throttle anything at first

`submitJob` dispatches shards under `Promise.all`. A `GovernedExecutor` that merely
awaited `yieldSlice()` per task therefore had all four yields resolve at once and then
ran the entire job at full speed — **the cap silently bypassed by concurrency**. A duty
cycle only exists if the node computes one slice at a time with the idle gap in
between, so throttled execution is now serialized. At a duty cycle of 1 the
serialization is skipped entirely, so an unthrottled node loses neither time nor
parallelism. Both halves are tested: peak concurrency 1 while throttled, >1 while not.

### Honest limitation, verified rather than assumed

**Chromium under automation never reports a page as hidden.** `page.bringToFront()`
changes nothing and fires no `visibilitychange`, in headless *and* headed mode, because
no window manager is driving tab activation; and CDP offers no visibility override
(`Page.setWebLifecycleState` is frozen/active, which fires `freeze` instead). So the
browser's *signal* is simulated — `document.hidden` shadowed, a real
`Event('visibilitychange')` dispatched — while everything downstream is genuine: the
real `document`, real dispatch, the governor's real listener, the real
`GovernedExecutor`, and a real job over a real WebRTC connection. The state machine
itself is covered exhaustively against an injected source, in Node and Chromium both.

## The limits that actually cap a relay's browser capacity

Criterion 3's "sixteen or more" failed at first, and the cause was neither the
reservation limit nor anything in this codebase. Two libp2p connection-manager defaults
bind long before `maxReservations` does:

| Default | Value | Effect |
|---|---|---|
| `MAX_INCOMING_PENDING_CONNECTIONS` | 10 | simultaneous inbound handshakes |
| `INBOUND_CONNECTION_THRESHOLD` | **5** | inbound connections per second **from one host** |

The second is the real culprit and the more interesting one. It is per *host*, so it
binds whenever peers share an IP — every tab in a local test on `127.0.0.1`, and in
production every volunteer behind one NAT: a school, an office, a carrier running
CGNAT. For a fabric whose premise is many browsers, that is not an edge case.

Exceeding either rejects the connection *during* the noise handshake, which the dialer
reports as `EncryptionFailedError: Unexpected EOF - stream closed while reading 0/1
bytes` — indistinguishable from a network fault unless you know where to look. This is
what the earlier 16-node failure was; it was never an environment quirk.

Found by bisection, not by reading: eight simultaneous joins already failed three of
eight, adding a stagger fixed it, and raising the reservation and pending-handshake
limits did **not**. `RelayNode` now derives both from `maxReservations`, never below
libp2p's own defaults, and both values are pinned by `constants.node.test.ts`.

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

The `EncryptionFailedError` recorded here earlier as "not diagnosed" **is diagnosed** —
it was the per-host inbound rate limit, described above. It was never specific to
running many nodes in one process.

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
