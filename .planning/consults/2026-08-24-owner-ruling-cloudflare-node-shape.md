# Owner ruling 2026-08-24 — what a Cloudflare node is, and what it is not

Three rulings, made while the measurements were being taken rather than after, so each one is
paired with the reading that prompted it. The readings live in
`2026-08-24-cloudflare-as-a-fabric-node-measured.md`; this file records what was **decided**,
because a measurement and a decision age differently and should not be stored as one thing.

---

## 1. A Cloudflare node does not advertise execution, and that costs nothing

**Prompted by:** runtime WASM compilation is refused on every entry point in a deployed Worker
and in a Durable Object — `CompileError: Wasm code generation disallowed by embedder` — and
`WebAssembly.instantiateStreaming` does not exist at all. It is a V8 embedder flag, the same one
that disables `eval`; no plan or quota turns it on.

**Ruled:** such a node simply does not advertise the execution capability.

**Why it costs nothing.** The published record is already
`NodeRecords = { certificate, capabilities }` (`packages/core/src/discovery.ts:414`), so a node
that omits execution is an ordinary, well-formed participant rather than a special case. **The
scheduler never learns that Cloudflare exists.** It keeps doing what it already does: honouring
what a node says it can do.

**What this closes.** The compute leg of the Cloudflare question is closed *by choice*, not
deferred. It does not reappear as a blocker, and the Containers tier — currently `403` to the
API credential in use — is no longer on the critical path for this shape. It would return only
if execution on rented, always-up hardware became wanted for its own sake, which is a different
question from "can Cloudflare run our artifacts".

**One consequence worth carrying forward separately:** the absent `instantiateStreaming` also
removes the V8 code-cache path from anything hosted in a Worker. Artifact caching on that tier
is not slower — it has no entry point. That is a fact about the *artifact* leg, and it stands
whether or not execution is ever wanted.

---

## 2. A Cloudflare node is one seed node with a table — one identity per object

**Asked by the owner:** if state can live in the table, can each Cloudflare node be treated as
just a connection into one p2p seed/bootstrap node?

**Answer: yes, and the platform's addressing already implements it.** `idFromName(name)`
resolves to a single global instance. The relay result is the proof and was not designed to be
one — the reservation store is **in-memory**, and two independent connections from two separate
processes saw the same one. Fan-in confirmed it directly: 20, 60, 150, 300 and 600 peers dialled
simultaneously all reported the same remote PeerId against an unchanged constructor timestamp,
599 of 600 landing in 6637 ms. The one failure was a client-side dial timeout; **the ceiling
found was the test machine, not Cloudflare.**

**Ruled: one identity per object.** Many objects are many peers, and that is the shape the
fabric already understands — a DHT wants peers spread across the keyspace, not one peer holding
it. Sharding is therefore *addressing* (`bootstrap-0…N`) rather than provisioning: names, not
servers.

**And the opposite is ruled out, on evidence rather than taste.** One identity spread across
several instances does not work, because the relay's reservation store is per-instance and in
memory: a dial that arrives at the wrong instance finds nothing. Any design that assumes a
shared identity must first move that store, and the same argument will apply to the DHT routing
table and the peer store.

**What binds first at scale** — reasoned from measurements, and labelled as reasoning:

1. **The cost of held sockets.** A non-hibernatable socket keeps the object resident, and
   billing, for as long as it is open. At millions of peers this is the limit, and it is a cost
   limit rather than a capability one. The remedy exists — a hibernatable socket survived
   fifteen minutes of silence — but libp2p's `webSocketToMaConn` cannot use that API as written,
   so it is work rather than configuration.
2. **Geography.** An object lives in one datacenter. Worldwide coverage means regional shards,
   which means more identities — cheap, given the ruling above.
3. **New connections per second, not messages.** Traffic on an open socket is free and is not a
   request. In a browser fabric it is tab churn that turns into request rate.
4. **Storage is not the constraint.** 10 GB per object against ~1 KB records is ten million
   records per object.

**The role that matters at scale is the relay, not the bootstrap.** Bootstrap is needed once, at
cold start, and a peer that has learned others stops needing it. A relay is needed **per
session**, for every browser-to-browser WebRTC handshake. That reorders which of the two results
is worth building on first.

---

## 3. Expiration is the one missing piece, and the mechanism is already measured

**Said by the owner, of the record table:** *"Надо только expiration."*

**This lines up with a ruling already on the books** — provider records must expire — and with
the finding that made it urgent: `@libp2p/kad-dht@16.4.0` never expires provider records at all,
which is harmless only while nothing persists the datastore. Durable Object storage persists by
definition, so on this tier the two meet.

**The mechanism exists and is exact.** A Durable Object alarm fired **1 ms** after its requested
time, ran in the instance that scheduled it, and its result was read back by a *different*
instance after eviction. That is the substitute for `setTimeout`, which cannot work here at all
because `Date.now()` does not advance without I/O — six readings across 30 million provably
executed iterations gave one distinct value and a span of 0 ms.

**Shape to build, not yet written:** an alarm that sweeps `storage.list({ prefix })`, deletes
what has expired, and reschedules itself. Two properties make it cheap here — the object is a
singleton, so there is exactly one sweeper and no coordination; and the clock is fresh at the
moment the alarm runs, because the alarm is itself I/O.

**What is deliberately NOT decided:** whether expiry is a sweep or a read-time check. A sweep
bounds storage, a read-time check bounds correctness, and they are not alternatives — a record
that is expired but unswept must not be served. Both, in that case, and the sweep is the cheap
half.

---

## Not ruled, and left open on purpose

- **Whether to deploy any of this.** Public hosting is public disclosure, and the EPO and China
  have no grace period. `packages/node/src/disclosure-gate.node.test.ts` enforces the *absence*
  of a deploy workflow or `deploy` script so that publishing cannot become a consequence of a
  push. Nothing above changes that: every reading was taken from probes that lived outside the
  repository, carried no project source, and were deleted by exact name.
- **Containers and R2.** Ruling 1 removes the execution tier from the critical path, but R2 is
  still wanted for artifact blocks, and the API credential returns `403` on both.
- **A hibernation-aware listener.** Ruling 2 names it as what decides whether the bootstrap role
  is cheap or expensive. Nothing has been written against it.
