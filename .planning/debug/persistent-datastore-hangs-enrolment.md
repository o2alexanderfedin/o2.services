# A persistent libp2p datastore hangs enrolment — open, with the scope measured

**2026-08-23.** Attempted under the work register's W2 (`RFC-0003-RESPONSE-04`). **Backed out
of the tree**; the tree is byte-identical to before the attempt, checked by `git status`.

## The claim, stated so it can be falsified

**Give `createLibp2p` a datastore whose operations are asynchronous, and this fabric's
enrolment RPC never completes.** A datastore whose operations are synchronous is fine, and
so is everything else about persistence.

## What was tried, in order, and what each reading eliminated

| Step | Reading | What it rules out |
|---|---|---|
| Wire `datastore-level@13.0.1`, run `provider-expiry.node.test.ts` | 3/3 fail — *"provider unreachable … rpc timed out after 20000ms"* during enrolment | — |
| Ablate **only** the construction (`if (false &&`) | Same case green | Anything other than the datastore |
| Raise the enrolment RPC timeout 20 s → 90 s | Hits the framework's own 60 s ceiling instead, `(user+sys)/real ≈ 0.08` | **Slowness.** The process is idle; this is a hang |
| `UV_THREADPOOL_SIZE=32` | Still fails | The obvious native-binding-starves-libuv story |
| Substitute `MemoryDatastore` on the identical wiring, twice | 2/2 pass | **Supplying a datastore at all.** The wiring is right |
| Replace level with a hand-written `FsDatastore` on `datastore-core`'s `BaseDatastore` | Fails the same way | **`datastore-level` specifically.** It is not the library |
| Probe every `FsDatastore` call to stderr | 249 calls, all `/peers/...` get and put, no throw, still flowing | **The datastore being stuck.** It answers throughout |
| Run `node-identity` + `relaying` with `FsDatastore` wired | 24/24 pass — including the case that **restarts a node on the same directory** | **Persistence in general.** Restart-and-reload works |
| Run `enrol-through-a-closed-door` + `dht-registration` | 6 cases fail, all at enrolment | — |
| Back out; re-run all three files | 12/12 pass | — |

Under `DEBUG=libp2p:peer-store*,libp2p:identify*` the failing case **passes**. So it is a
race, and adding observation moves it — which is why the cause is not named below.

## What the shape of it suggests, marked as a hypothesis and not a finding

The failure is confined to **enrolment**, which is the one exchange where the far peer holds
no certificate yet, and it appears only once peer-store reads and writes stop resolving in a
microtask. Two mechanisms in this repository are sensitive to exactly that ordering and are
where the next attempt should look:

- `PeerVerifier` subscribes to libp2p's connect and identify events and issues a `records`
  request of its own. A peer without a certificate is the case it re-asks on, floored by
  `DEFAULT_VERDICT_RETRY_FLOOR_MS`.
- NET-09's per-peer send gate (`MAX_CONCURRENT_STREAMS_PER_PEER` 8,
  `MAX_INBOUND_MESSAGES_IN_FLIGHT_PER_PEER` 4, `MAX_QUEUED_SENDS_PER_PEER` 256) queues
  outbound work per peer. An enrolment request queued behind requests that cannot complete
  is a hang with idle CPU, which is what was measured.

**Neither is confirmed, and here is the reading that would settle it.** Instrument NET-09's
per-peer send gate to record its queue depth at the instant the enrolment request is
admitted, and run the failing case with an asynchronous datastore wired. If the queue is
full of `records` requests aimed at a peer that holds no certificate — which is what a
peer mid-enrolment is — hypothesis 2 is confirmed and the fix belongs in how `PeerVerifier`
paces its re-ask, not in the datastore. If the queue is shallow, hypothesis 2 is dead and
the next place to look is libp2p's own peer-store locking, where the same reasoning applies
one layer down.

Take that reading **before** trying another datastore implementation. Two have already been
tried and the second told us nothing the first had not.

## What the attempt was worth even so

Three things are now known that were not:

1. **Persistence is not the blocker.** A node restarted on its own directory reloads its
   identity and works — measured, 24/24, before this was backed out.
2. **The defect is a genuine one in this repository**, not a property of a dependency. Two
   independent datastore implementations reproduce it; a synchronous one does not.
3. **The audit's premise stands and its ordering was wrong.** `RFC-0003-RESPONSE-04` put W2
   after W1 on the grounds of the provider-record footprint. The real gate is this defect.

## Cost, so a later reader can judge whether to pay it again

`datastore-level` was installed and uninstalled; `interface-datastore` and `interface-store`
likewise; a `FsDatastore` on `BaseDatastore` was written, typechecked, and deleted rather
than left unwired — this repository already carries 27 modules with no production importer
and the same document that counts them should not add the 28th. Its design is worth
repeating if the defect is fixed: a flat directory, one file per key, atomic
`write`-then-`rename` as `FsBlockstore` does, and **base32 names** — because APFS is
case-insensitive by default and peer IDs are mixed-case base58, so percent-encoding or
base64url would silently collide two keys that differ only in case.
