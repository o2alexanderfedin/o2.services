# Any one relay is enough — the browser tier's relay list stops being a chain

**Date:** 2026-09-06
**Branch:** `feature/any-one-relay-is-enough`
**Files changed:** `packages/browser/src/browser-node.ts`,
`packages/browser/src/capability-harness.ts` (test-only),
`packages/browser/src/start-unwind.browser.test.ts`,
`packages/node/src/any-one-relay-is-enough.e2e.test.ts` (new),
`packages/node/src/fabric-node.ts` (**comments only** — see §5)

---

## 1. What was measured, before anything was changed

The defect as briefed was verified by reading, and then measured by running.

`packages/browser/src/browser-node.ts` dialled `options.relayAddrs` in a serial `for`
loop with no `catch`:

```ts
const relayPeerIds: string[] = []
for (const address of options.relayAddrs) {
  const connection = await libp2p.dial(multiaddr(address))
  relayPeerIds.push(connection.remotePeer.toString())
}
```

Every listed relay was dialled, in order, and **any one rejection rejected `start`**. So a
list of N relays was N points of failure in series rather than N spares.

**The reading.** `packages/node/src/any-one-relay-is-enough.e2e.test.ts` was written first
and run against the serial loop restored verbatim into the tree (§6, plant 1). Fixture: a
dead address first (`/ip4/127.0.0.1/tcp/49999/ws/p2p/12D3KooW…HQM9Q`, a closed loopback
port) and a **live** one second (a real `FabricNode` on `/ip4/127.0.0.1/tcp/0/ws`). All
three cases failed. The first with:

```
AssertionError: expected '[object Event]' to be null
```

Two facts fall out of that one line, and only the first was in the brief:

1. The tab **would not start beside a relay that was answering**. The live relay was up and
   serving throughout — it issued the certificate in case 3 once the fix was in.
2. The tab **could not say which relay was the problem.** `[object Event]` is the whole of
   what propagated: a browser WebSocket dial to a closed port rejects `libp2p.dial` with a
   raw `Event`, not an `Error`. The useful sentence went to Chromium's console, where no
   caller can reach it —
   `WebSocket connection to 'ws://127.0.0.1:49999/' failed: Error in connection
   establishment: net::ERR_CONNECTION_REFUSED`.

**The absent `catch` was checked against its own comment before being touched, and the
comment's reasoning is right.** *"a tab binds no socket, so a tab with no reservation cannot
be reached by anyone, and starting it would hand the visitor a node that silently does
nothing."* That survives unchanged; see §2.

**`start-unwind.browser.test.ts`'s fixture supplies exactly one relay** — checked, not
assumed. Its case *"closes the blockstore and stops libp2p when a relay dial fails"* passes
`relayAddrs: [UNREACHABLE_RELAY]`, so it already describes the all-failed case and keeps
passing unchanged.

---

## 2. The rule as implemented

**At least one — not all, and not none.**

- **≥1 dial succeeded** → start. The failures are recorded on
  `BrowserNode.relayFailures` and are not fatal.
- **every dial failed** (and at least one was attempted) → throw. `#compose`'s unwind
  closes the blockstore and stops libp2p, exactly as before.
- **`relayAddrs: []`** → start, no dials, `relayFailures` empty. A tab asked to dial nothing
  has not failed to dial anything; several specs depend on this and none of them changed.

The condition is literally `options.relayAddrs.length > 0 && relayPeerIds.length === 0`.

**Dialled concurrently**, with `Promise.allSettled` over `options.relayAddrs.map(...)`, then
zipped back against the input array by index. Three reasons, and none of them is taste:

- three sequential dials to three continents are three round trips where one would do, and
  nothing in the loop depends on the order of *attempt*;
- `allSettled` settles every promise, so a rejection **structurally cannot** become an
  unhandled rejection — which a bare `Promise.all` plus a catch would not guarantee;
- `allSettled` preserves **input** order, so `relayPeerIds` is the configured list filtered
  to the relays that answered, not a race result that reorders between runs. That matters
  because `relayPeerIds` is signed (§3).

No measured reason to keep them serial was found.

**Reporting follows the node tier's shape exactly.** `RelayDialFailure { address, reason }`
— same two field names, same docblock wording, same `cause instanceof Error ? cause.message
: String(cause)` derivation — surfaced as `BrowserNode.relayFailures`, mirroring
`FabricNode.relayFailures`. It is **duplicated rather than imported** because
`purity.node.test.ts` lists `browser` under `DUAL_TARGET`, so `packages/browser` may not
import from `packages/node`; a third package holding two fields would be worse than the
copy. Both declarations now point at each other.

The all-failed throw composes its own `Error` naming **every** address and reason, with the
first raw rejection as `cause`. That is not redundancy with `relayFailures`: `start` rejects
before the node exists, so there is no `BrowserNode` to read the field off, and the message
is the only place the addresses can be.

---

## 3. Why the peer-id list matters, and how it is read

`relayPeerIds` leaves `#compose` in exactly one direction: `resolveCertificate`'s
`relayIds`, which is a tab's **signed** statement of what it is reachable through. A list
naming a relay the tab never reached is a lie a peer acts on — it would dial a circuit
through a relay holding no reservation for that tab.

The dead fixture address carries a peer id **in its own multiaddr**, so an implementation
that collected configured ids rather than connected ones would produce exactly that lie.
The e2e case therefore asserts an equality, not a `toContain`:
`expect(certificate.relayIds).toEqual([provider.peerId])`.

---

## 4. What is proved, and where

| # | Claim | Where | Engines |
|---|---|---|---|
| 1 | two relays, one dead → the tab **starts and is reachable** | `any-one-relay-is-enough.e2e.test.ts` case 1 | Chromium (see §7) |
| 2 | **every** relay dead → `start` rejects, store closed, libp2p stopped | `start-unwind.browser.test.ts`, two cases (1-of-1 dead, and the new 2-of-2 dead) | chromium + firefox + webkit |
| 3 | the failure is **reported**, not swallowed | e2e case 2 — `relayFailures` has exactly one entry, `address` is the dead one | Chromium |
| 4 | the peer-id list holds **only** relays that connected | e2e case 3 — the certificate's `relayIds` | Chromium |

Reading 1 is deliberately not "`start` resolved". A `start` that resolved onto a tab nobody
can reach is precisely what the absent `catch` prevented, and the fix must not buy case 1 by
giving that up. So the **provider goes and gets a block that exists nowhere but inside the
tab**, over the connection the tab opened when it dialled the surviving address —
`FetchingBlockstore` → `RpcBlockSource` → the tab's own `serveAgent`.

Lane results, all on this branch with the fix in:

- `--project browser` — **408 files, 6765 tests, 0 failures.** Host quiet (load/core 0.43
  before, 1.27 after, 8 cores), wall clock 123.78 s.
- `--project node` — **248 files, 3547 passed, 2 skipped, 0 failures.** The banner reported
  the host **oversubscribed** at the end (load/core 1.18 → 4.98), so no duration from that
  run is quoted; pass/fail stands, which is what the banner itself says.
- `--project e2e` — the **full** lane, all 66 files, not just the 40 that hand a tab
  `relayAddrs`: **66 files, 348 tests, 0 failures**, exit 0. Host quiet (load/core 0.61 at
  the end), wall clock 1195.32 s. Serial by config, so this is one browser and one Vite
  server at a time.
- `npm run build:demo` — exit 0, built in 1.52 s. The only warning is the pre-existing
  500 kB chunk-size notice.
- `tsc --noEmit` — exit 0 after every edit, including both plants.

**One risk that turned out to be small, checked rather than assumed.** The only behaviour
that changed is what happens when a dial fails and what order dials are issued in, so the
exposure is call sites passing **more than one** address. Grepped: across all 66 e2e files
and every fixture, `any-one-relay-is-enough.e2e.test.ts` is the **only** one that passes two.
Every other passes exactly one, where the new code path is a one-element `allSettled` that
succeeds — indistinguishable from the old loop.

**But production already passes more than one, which is the point of the fix.**
`demo/main.ts`'s `discoverRelays` takes `location.search.getAll('relay')` — repeatable — and
`bootstrap.json`'s `relayAddrs` **array**. So a multi-relay list was already reachable by a
visitor through a link or a seed's bootstrap document; what was missing was a tab that could
survive one of them being down.

---

## 5. How the two tiers now differ, and why

**They now agree about more than they used to, and the surviving difference is narrower.**

| | `fabric-node.ts` (Node) | `browser-node.ts` (tab) |
|---|---|---|
| a dial fails | caught, recorded as `RelayDialFailure` | **same, since today** |
| ≥1 relay answered | keeps running | **same, since today** |
| **0 relays answered** | **starts anyway** | **rejects, and unwinds** |
| dial order | serial | concurrent (`allSettled`) |

The remaining divergence is the platform, not an oversight. A Node process binds a real
listening port and stays useful to anyone who can reach it directly, so a relay it could not
enter costs it circuit reachability and nothing else. A tab binds nothing, so a tab holding
no reservation cannot be reached **at all**, and starting it would hand a visitor a node
that silently does nothing.

Said plainly: the divergence used to be *all-or-nothing versus best-effort*. It is now
*what best-effort does when it got nothing*.

**W-2 of `18-VERIFICATION.md` — a divergence recorded on neither side reads as drift — is
why `fabric-node.ts` was edited at all.** Its NET-05 comment said, in the present tense,
*"`browser-node.ts`'s dial loop has no `catch`: the failure propagates, `start` rejects, and
the tab unwinds… **Do not make them agree.**"* My change made that false. Leaving it would
reproduce W-2 exactly, on the same pair of files. So:

> **Scope-fence exception, disclosed.** `packages/node/src/fabric-node.ts` is modified. The
> change is **comments only** — the amended NET-05 paragraph at the dial loop, and a twin
> pointer on the `RelayDialFailure` interface. No executable line in `packages/node` moved,
> and the node tier's disposition is unchanged. The guard that forces it is W-2, not a
> compiler. `git show --stat` and a diff of that file will confirm the comment-only claim.

`packages/browser/src/capability-harness.ts` is also modified — a test-only page harness
that this repository already keeps out of the barrel on purpose. It gained `relayFailures()`
and a `relayIds` field on `certificate()`, which are the two readings §4 needs.

---

## 6. The plants, both watched red

Each plant was made against a snapshot taken **immediately before** planting, restored by the
surgical inverse of the edit, and verified with `cmp` (exit 0 each time).

### Plant 1 — revert to "all must succeed"

Two forms were run, because the cheap one does not reproduce the original text.

**1a, one line** — `if (options.relayAddrs.length > 0 && relayPeerIds.length === 0)` →
`if (relayFailures.length > 0)`. `--project e2e any-one-relay-is-enough` → **3 failed / 3**:

```
AssertionError: expected 'no relay could be reached, so this ta…' to be null
+ Received:
"no relay could be reached, so this tab would be addressable by nobody: /ip4/127.0.0.1/tcp/49999/ws/p2p/12D3KooWHPSVMPEezVCXvka2ahwT26JGL8EBr61LpGEU3ujHQM9Q — [object Event]"
```

**1b, the faithful revert** — the whole `allSettled` block replaced by the original serial
`for` loop verbatim. `tsc --noEmit` exit 0; `--project e2e` → **3 failed / 3**:

```
AssertionError: expected '[object Event]' to be null
+ Received:
"[object Event]"

[harness] console: WebSocket connection to 'ws://127.0.0.1:49999/' failed: Error in connection establishment: net::ERR_CONNECTION_REFUSED
```

1b is the measurement §1 quotes. It was run because 1a's message is *my own composed text*,
so it proves the condition and not the original failure mode.

### Plant 2 — make the all-fail case start anyway

`relayPeerIds.length === 0` → `relayPeerIds.length < 0` (never true). `--project browser
start-unwind` → **9 failed / 18, three in each of the three engines**:

```
FAIL |browser (chromium)| … > rejects when EVERY relay dial fails, naming each address, and still leaves nothing behind
AssertionError: expected BrowserNode{ …(19) } to not be an instance of BrowserNode
```

identically under `browser (firefox)` and `browser (webkit)`, and taking the two pre-existing
cases with it — *"closes the blockstore and stops libp2p when a relay dial fails"* and *"does
not accumulate a second node when start is driven again"* — which is the right blast radius:
all three assert that a tab which reached nothing must not exist.

**No plant stayed green.**

---

## 7. What in the brief turned out to be false, or not achievable

1. **"Browser-lane specs, in all three engines … 1. Two relays, one dead → the tab starts."**
   Case 1 **cannot** be a browser-lane spec. Its content is that a *real* relay answered, so
   one address must be genuinely dialable, and the `browser` project cannot produce one: it
   has no `globalSetup`, there is **no `@vitest/browser/context` commands infrastructure
   anywhere in this repository** (checked — the only match for `vitest/browser` outside
   `node_modules` is `vitest.config.ts` itself), and a page cannot host a listening socket.
   So the two halves of the rule are split by necessity: **case 2 is three-engine, cases 1,
   3 and 4 are Chromium-only**, via the `e2e` lane which drives Playwright from Node. Both
   files say so in their headers. Making case 1 three-engine is new harness work, not a
   stronger assertion.

2. **"Assert the reason text names the address."** Not achievable without synthesising, and
   the measurement is why: on this tier the reason is `[object Event]` (§1). libp2p's own
   words for a browser WS dial to a closed port carry no address. The node tier's rule —
   *"libp2p's own words. Never synthesised here."* — is kept, and **the address is carried as
   its own field**, which is exactly what `RelayDialFailure` is shaped for. The e2e case
   asserts `address` is the dead address and that `reason` is non-empty; the browser case
   asserts the composed throw message names **both** addresses. That satisfies what the
   requirement is for — a caller can ask what failed and why, and name the line that was
   wrong — by the only route the platform leaves open.

   **Two readings, two scopes, and they are kept apart in the source comment.** That the
   dial rejects with a **raw `Event`** rather than an `Error` is `start-unwind`'s prior
   three-engine measurement. That `String()` of it is **`[object Event]`** was measured
   today in **Chromium only**. Neither is claimed wider than it was taken.

3. **`start-unwind.browser.test.ts` needed no change to keep passing** (the brief's guess was
   right — recorded because it was flagged as "check, do not assume"). Its fixture supplies
   one relay, which is the all-failed case. It **was** changed anyway, for two reasons that
   are not "make it pass": a two-dead-relays case was added, because one-dead-out-of-one no
   longer distinguishes *emptiness* from *failure*; and its comment claiming a tab "cannot"
   assert `toBeInstanceOf(Error)` became false, since the tier now composes its own error
   rather than forwarding a platform event.

---

## 8. Deliberately left for the next step

Written down rather than done, per the scope fence:

- **Multiple simultaneous reservations.** Today a tab dials every relay it is given and
  keeps every connection that answered, but nothing makes it *hold a reservation* on more
  than one. `relayIds` will name every relay that answered the dial, which is honest about
  the connection and says nothing about reservations. That gap is real and is the natural
  next piece.
- **DHT-based relay discovery** — the list is still whatever the caller passed.
- **Latency- or health-based relay choice** — the dials are concurrent, so the timing data
  to rank relays now exists in `dialled` and is discarded. Cheap to add later, out of scope
  now.
- **Retry of a relay that failed at start.** `relayFailures` is a snapshot taken during
  `start` and is never revisited; a relay that comes back up is not re-dialled. Same on the
  Node tier, so this is a shared gap rather than a new one.
- **A three-engine reading of case 1**, which needs vitest browser `commands` infrastructure
  that does not exist here yet (§7.1).
