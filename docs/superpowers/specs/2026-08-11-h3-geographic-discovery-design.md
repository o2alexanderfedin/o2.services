# Geographic peer discovery — a place is content

**Status:** design spec. No implementation, no code committed.
**Written against:** `c94bc7a` (`feature/v1.1-close-out`) — *"docs(audit): G5 closed as a measured negative"*.
**Every `file:line` below was read out of git objects at `c94bc7a`**, not out of a working tree, because
two other agent worktrees are live on this repository and a working-tree read can catch a mid-edit file.

> **AMENDED 2026-08-11, later the same day. Read this before the body.**
>
> The owner settled a capability model in conversation. **It ratifies this design's central choice
> — location is not a record field — and corrects two things this document asserts.** §14 is the
> ruling; §3.4, §3.5, §6.2, §8.3, §8.4 and §11 carry the corrections in place. Nothing is deleted:
> superseded sentences are struck and dated where they stand.
>
> **Citation base.** Every `file:line` in §1–§13 was read at `c94bc7a` and is **left** there.
> Commit `32cba89` (*"CapabilityRecord gets the extension seam the sibling record already had"*)
> inserted ~260 lines into `packages/core/src/discovery.ts` and ~90 into
> `packages/net/src/protocol.ts`, at **two** insertion sites in the former, so **every
> `core/src/discovery.ts` line number in this document is stale at `HEAD`** — e.g.
> `SelfRecordIndex.providers`, cited throughout as `:511-519`, is `:767-776` at `32cba89`, and
> `providers(query.inputCid)`, cited as `:247`, is `:492`. No mechanical correction is possible, so
> none is attempted; **text added on 2026-08-11 cites `32cba89` and says so.** Citations into
> `quorum.ts`, `ports.ts`, `blockstore/memory.ts`, `canonical/encode.ts`, `net/src/discovery.ts`,
> `net/src/agent.ts`, `net/src/rendezvous.ts` and `REQUIREMENTS.md` are unaffected and still
> resolve.
>
> **The two node factories moved a little and it is worth the three lines to say how**, because
> §8.1's composition rule cites both. `browser-node.ts` gained 3 lines inside `ownRecords`, all
> *after* the fields this document cites, so **`:474` is unchanged** and everything at or below
> ~620 is unchanged, while citations above that shift by 3 (`:1102`→`:1105`, `:1229`→`:1232`).
> `fabric-node.ts` gained 7 lines after old
> `:1157` and 3 more after old `:1188`, so **`:136` is unchanged** and any citation above 1157
> shifts (`:1181`→`:1188`, `:1182`→`:1189`, `:1183-1184`→`:1190-1191`, `:1703`→`:1713`). All
> verified by reading at `32cba89`.

---

## 1. Problem

The fabric can find a node that **holds a block**. It cannot find a node that is **near a place**.

`discoverExecutors` starts from a data CID and narrows: `providers(query.inputCid)`
(`packages/core/src/discovery.ts:247`), then filters that provider set by certificate, capability
record, engine features and sovereign clearance (`discovery.ts:255-297`). Every candidate executor is,
by construction, already a provider of the input block.

Nothing in the record set carries a location. `CapabilityRecord` is `nodeKey`, `features`,
`sovereignFor`, `issuedAt`, `expiresAt`, `signature` (`discovery.ts:64-85`). `NodeCertificate` carries
`operatorId`, `relayIds`, `userKey` and `discoverability` — identity and reachability, not geography.

So a request of the form *"give me nodes near here"* has no expression at all today, and three of the
four externally-facing use cases below start from a place rather than from a block.

---

## 2. Use cases

| # | Scenario | What is being asked | Requestor near target? |
|---|----------|--------------------|------------------------|
| 1 | **Starbucks.** App connects to the store's node for menu + order | Nodes *in this cell* | Yes — one hop |
| 2 | **AirBnB.** In SF, searching listings near the London Museum | Nodes *speaking for* a distant cell | **No** |
| 3 | **Uber.** In Miami, finding drivers nearby | Nodes in a cell, membership churning | Yes, but both parties move |
| 4 | **Social.** Random people to video chat in a chosen area | Any K nodes in a cell | No |
| 5 | **Redundancy.** K distinct cells worldwide, one node from each | Diversity *by construction* | No |

Use case 2 forces a generalization that the rest of the design must carry: **the node holding a London
listing need not be in London.** So the advertised relation is *association with a cell*, not *presence
in it*. Presence is the common case, not the definition. §3.1 states this as an invariant.

Use case 5 is the one with a property none of the others have. Because the requestor **selects by
location**, it never has to **read a location back**. Nothing self-asserted is trusted, because nothing
self-asserted is consulted — see §7.

---

## 3. Design

### 3.1 The decision: a place is content

An H3 cell is turned into a CID. A node associated with a cell **puts a tiny block** for that cell and
for each of its ancestors up to a floor resolution. A vicinity query is:

```
providers(cellCid(cell))
```

That is the whole mechanism. It reuses the existing content-routing path:

- **no new wire verb** — `agent.ts:790-796` already serves `{kind:'providers', cid}` by delegating to
  `options.index.providers(request.cid)` (`packages/net/src/agent.ts:795`);
- **no new `RecordIndex` method** — the port is `providers(cid)` / `recordsFor(nodeKey)` and nothing
  else (`packages/core/src/discovery.ts:141-146`);
- **no protocol change** — a place CID is a CID.

**Invariant (advertisement semantics).** A place block asserts *"I will answer for this cell"*, not
*"I am physically inside this cell"*. Presence is the default construction; use case 2 is the case that
requires the weaker reading, and no code may assume the stronger one.

**The elegant consequence.** Because `ExecutorQuery.inputCid` is just *the CID whose providers are
considered*, a geographic query is an ordinary `discoverExecutors` / `discoverCandidates` call with the
place CID in that field. The entire downstream pipeline — certificate verification against pinned
issuers, capability-record checking, `sovereignFor` narrowing, peer-id mapping, `RemoteExecutor`
construction, replica-set grouping (`packages/net/src/discover-candidates.ts:190-269`) — applies
unchanged, and returns a **dispatchable** `CandidateSet`.

**One documentation debt this creates, named rather than left to be discovered.**
`ExecutorQuery.inputCid` is currently documented as *"The block the task must read. Only its providers
are considered."* (`discovery.ts:150-151`). Under this design the field also carries a block the task
will *never* read. The comment becomes false and must be widened in the same change that lands the
feature. This repo's own rule is that *a comment is not a specification* and that when the two disagree
the comment gets fixed — so this is a required edit, not a nicety.

### 3.2 Cell → CID derivation

**The block bytes are canonical DAG-CBOR of a domain-separated record:**

```ts
// h3-js hands back '8a2a1072b59ffff' (15 chars); the record stores it zero-padded to 16.
{ o2Place: 1, cell: '08a2a1072b59ffff' }
```

- `o2Place` is a reserved key and a **format version**, not a boolean.
- `cell` is the H3 index as **16-character zero-padded lowercase hex** — *not* the string h3-js
  hands back.

**Why the library's own string must not be hashed directly.** `h3-js` builds its index string as
`hexFrom32Bit(upper) + zeroPad(8, hexFrom32Bit(lower))` (`lib/h3core.js:296-298` in the published
4.5.0 tarball). **The upper word is not zero-padded** — only the lower one is — so the width depends
on the index mode: cells render as **15** chars (top nibble is `0` and is dropped), while directed
edges and vertexes render as 16. Cells being uniformly 15 chars is a *consequence* of the mode bits,
not a guarantee the API states.

Hashing a variable-width representation makes the CID depend on a padding accident. So the derivation
**normalizes**: take `h3IndexToSplitLong` → the u64 → render as fixed 16-char zero-padded lowercase
hex. Mode-independent, immune to the quirk, and trivially reversible.

**`isValidCell` is a precondition, not a nicety.** `cellCid` must reject anything that is not a cell
(`isValidCell`, `types.d.ts:21`) before deriving. `isValidIndex` is the wrong check — it also accepts
directed edges and vertexes, which are exactly the 16-char cases above.

**The CID is `CID.create(1, dagCbor.code, sha256(bytes))`** — CIDv1, DAG-CBOR codec, SHA-2-256.

**Obtained through the blockstore's own `put`, never hand-rolled.** This is the repository's stated
idiom and the reason is stated where it was learned: `packages/demo/scripts/sign-kernel.ts:80-85` —
*"Through `MemoryBlockstore.put`, not a hand-rolled `sha256` + `CID.create`… computing it through the
identical code path is the only form that cannot drift from it."* `MemoryBlockstore.put` is
`packages/core/src/blockstore/memory.ts:23-39`, with the CID built at `:25`.

For the *derivation without storing* (what a **querying** node needs — it must compute the CID but must
not become a provider of it), use `canonicalCid` (`packages/core/src/canonical/encode.ts:138-143`),
which produces the identical `CID.create(1, dagCbor.code, digest)` at `:142` over
`encodeCanonical`'s bytes (`:111`). **These two paths must be asserted equal by a test** — that is the
only thing preventing the drift `sign-kernel.ts` warns about. See §10, test T1.

**Determinism across nodes.** Required, and it comes from canonical DAG-CBOR: `encodeCanonical` is the
project's canonical encoder and `CLAUDE.md` names deterministic dag-cbor encoding as a hard requirement
for CID stability. Two nodes computing a cell CID must agree byte-for-byte or the whole scheme silently
partitions into two disjoint indexes.

**Why it cannot be confused with a real data block.** Domain separation is by **preimage structure**,
not by codec — the codec is `dagCbor.code` for every block this repo stores (`memory.ts:25`,
`packages/net/src/block.ts:38`, `packages/browser/src/idb-blockstore.ts:79`), so the codec field
carries no signal. A collision would require a real data block whose canonical DAG-CBOR encoding is
*exactly* `{o2Place: 1, cell: <string>}` — at which point it **is** a place record and the two are not
in fact distinguishable objects. The reserved key makes accidental collision require deliberate
construction of the record itself.

> **Uncertainty, stated.** This gives domain separation against *accident*, not against an adversary who
> deliberately puts place blocks for cells it is nowhere near. Nothing here prevents that, and nothing
> is claimed to. §7 is where that is dealt with, and the answer is that it is not a security property
> at all.

### 3.3 Advertisement is put-once plus `withhold` — and the port forces this

**`Blockstore` has no `delete`.** The port is exactly `put`, `get`, `has`, `size`
(`packages/core/src/ports.ts:24-49`). A node therefore **cannot un-advertise a place by removing the
block.**

This is not an obstacle; it selects the correct design, and the correct design is the one already in
the file:

- `SelfRecordIndex.providers` answers `[nodeKey]` iff `store.has(cid)` **and** the `withhold` predicate
  says no (`packages/core/src/discovery.ts:511-519`).
- `withhold` means *"holds it but must not advertise it"* (`discovery.ts:415-425`).
- The predicate is consulted **per lookup**, and `discovery.ts:472-476` says exactly why: *"A
  registration's lifetime is a hold, not a process. A snapshot resolved in the constructor would
  advertise a block that became sovereign a second later, and would go on withholding one whose hold
  was given back."*

So **cell membership is a live set consulted at ask time**, which is the same shape as a sovereign hold
and needs no new machinery. Advertising a cell = `put` the block (idempotent — re-putting identical
bytes is a no-op, `memory.ts:26-27`). Un-advertising = the live set stops containing it. The block stays
in the store forever, at ~40 bytes.

**This also inherits the D1 ruling** recorded at `discovery.ts:431-441`: a node is authoritative about
what it holds, answers are computed at ask time, and there is no announcement to go stale and nothing to
retract. Geography gets that property for free.

### 3.4 Resolution hierarchy

A node associated with a fine cell advertises that cell **and every ancestor up to a floor**, one block
each. A query then does an **exact match on the ancestor at the resolution whose cell size matches the
intended radius**.

The numbers are in §9.6 (measured by registry/doc lookup, not from memory). The recommendation, stated
against those numbers:

- **Floor (coarsest advertised): res 5** — cells of roughly metropolitan-region scale. Coarser than this
  and a "vicinity" answer spans a country, which no use case wants.
- **Ceiling (finest advertised): res 9** for a fixed node, **res 7** for a moving one (§9.6).
- That is **5 blocks** for a fixed node (res 5,6,7,8,9), ~200 bytes total. The cost is irrelevant; this
  is not a number worth optimizing.

> **Added 2026-08-11 (owner ruling, §14 decision 7) — a second, independent argument for a floor,
> and it is not about storage at all.** The paragraph above prices the floor in *bytes in a local
> blockstore*, correctly concludes the cost is irrelevant, and therefore leaves the floor resting
> on one argument only: *"coarser than this and a vicinity answer spans a country."*
>
> **There is a harder bound, and it binds anything cell-shaped that ever rides a connection.** A
> record presented to a peer travels over the measured transport budget `CLAUDE.md` records:
> **WebRTC's maximum message is 16 KiB** (hardcoded in js-libp2p), and **a relayed connection's
> total is 128 KiB** before it is cut. A certificate plus a small record fits comfortably. **A node
> enumerating hundreds of cells does not.**
>
> This design keeps cells *out* of the record (§4, ratified by §14 decision 1), so the bound does
> not bite today — which is exactly why it must be written down now rather than discovered later.
> It bites the moment anybody proposes putting a cell list back in, including §14 decision 10's
> deferred coarse-cell pre-filter, whose whole viability rests on it being **one** cell rather than
> a set. **The floor resolution is therefore load-bearing for two independent reasons**, and a
> future argument that retires the vicinity-semantics one does not retire this one.

**How a query expresses a radius.** It does not, exactly — and this is the honest limit of the design:

> **Exact match on a coarse ancestor gives *vicinity*, not a range query.** There is no
> "within 5 km" semantics. A query at resolution *r* returns nodes **in the same cell** at that
> resolution, and cell size at *r* is the only radius knob.

Two consequences the spec will not paper over:

1. **Edge effect.** Two nodes 50 m apart but across a cell boundary do not match each other at any
   resolution finer than their common ancestor. The mitigation is a **k-ring** query: compute
   `gridDisk(cell, 1)` (7 cells), issue 7 `providers()` calls, union the results. That trades one
   lookup for seven. Whether to do this by default is **open** (§11, Q2).
2. **Quantization, and it is coarser than "nearest resolution" suggests.** A requested radius maps to
   the nearest resolution, so the effective radius is that resolution's cell size, not what was asked
   for. **On top of that, the published cell sizes are averages and real cells vary by nearly 2×** —
   the min/max hexagon area ratio converges to 1.9928 from res ~7 onward (§9.6). So the radius a caller
   actually gets is the tabulated average **±~40%**, depending on where on the globe the cell sits.
   The API must therefore return the resolution it used and the effective radius that implies, and a
   caller must not present either as a measured distance. This is why `resolvePlaceQuery` in §5.3
   returns both `resolution` and `effectiveRadiusMetres`.

3. **Twelve pentagons exist at every resolution.** They are ~0.5046 of a hexagon's area and have **6
   children, not 7**. Any code that assumes uniform 7-way fan-out is wrong at 12 places on Earth.
   Nothing in this design walks children — `advertisedCells` only ever goes *up* via `cellToParent` —
   so the design is unaffected, but the assumption must not creep in later.

### 3.5 The query path

```
cellCid(cell)  ──►  discoverCandidates({ inputCid: cellCid(cell), … })  ──►  CandidateSet
```

No new function is required in `@o2/net` at all. `discoverCandidates` (`discover-candidates.ts:190`)
takes an `ExecutorQuery`; the place CID goes in `inputCid`; the returned `CandidateSet`
(`discover-candidates.ts:145-181`) already carries `executors`, `nodes`, `excluded`, `providers`,
`undialable` and `replicaSets`.

The geographic layer is therefore **purely a CID-derivation library plus a thin query helper**. It adds
no adapter, no wire type, and no index method.

> **Corrected 2026-08-11 (§14 decision 2) — the pipeline is `providers(anchor)` then a LOCAL
> filter, and the claim above is true of the API while being wrong about the round trips.**
>
> §3.1 calls it "the elegant consequence" that a geographic query is *"an ordinary
> `discoverExecutors` / `discoverCandidates` call"* and that *"the entire downstream pipeline …
> applies unchanged."* **That is right about the shape and wrong about the cost, and the wrongness
> is readable in the loop it points at.** `discoverExecutors` builds its provider set once
> (`packages/core/src/discovery.ts:492` at `32cba89`) and then calls
> `index.recordsFor(nodeKey)` **once per provider, inside the loop** (`:501`). Over a vicinity
> query that returns a hundred nodes in a cell, "unchanged" means a hundred record fetches.
>
> **The ruling removes the round trips, not the pipeline: records arrive WITH the peer.** A peer
> presents the record it signed on the connection already open to it; discovery filters locally on
> what it was handed. The justification is that the signature was always the thing that mattered
> and the channel never was — `packages/node/src/peer-verifier.ts:6-9` states it about the sibling
> document: verification is *"offline by construction … The only network call this class makes is
> the `records` request that **fetches** the certificate; deciding whether to believe it touches
> nothing."*
>
> **What this costs THIS design: nothing in the API, one substitution underneath it.** §3.5's claim
> that no new function is required in `@o2/net` survives, because the change is a `RecordIndex`
> whose `recordsFor` reads records peers have already presented — the exact substitution the port
> was built for (`discovery.ts:344-350`: *"what lets a single implementation be swapped for a DHT,
> a delegated HTTP router, or an in-memory fixture without the discovery logic noticing"*).
> **§8.4's index-agnosticism claim is what makes this free, and this is its first real test.**
> Whoever implements it must not conclude `discoverExecutors` needs editing; it does not.

---

## 4. Data model

```ts
/**
 * An H3 cell index, **normalized to 16-character zero-padded lowercase hex**.
 *
 * NOT the string `h3-js` returns — that one is 15 chars for a cell because its upper
 * 32-bit word is not zero-padded (§3.2). Normalization happens once, at the library
 * boundary, so nothing downstream has to know about the quirk.
 *
 * Opaque here, as `OwnerId` is (`sovereignty.ts:37-38`): validity is established by
 * `isValidCell`, never by string inspection. The alias is `string` to match this
 * repository's idiom (`capability.ts:76`, `sovereignty.ts:38`) rather than a branded
 * type, which nothing here uses.
 */
export type H3Cell = string

/** H3 resolution, 0 (coarsest) to 15 (finest). */
export type H3Resolution = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15

/**
 * The block bytes a place advertisement content-addresses.
 *
 * `o2Place` is a reserved key AND the format version — a future field is a version bump,
 * never an in-place widening, because the CID is the identity and any change to the
 * encoded shape produces a different cell CID and therefore a different index.
 */
export interface PlaceRecord {
  readonly o2Place: 1
  readonly cell: H3Cell
}

/** A latitude/longitude in degrees. */
export interface LatLng {
  readonly lat: number
  readonly lng: number
}

/** The advertisement policy a node applies to itself. */
export interface PlacePolicy {
  /** Coarsest resolution advertised. Recommended 5. */
  readonly floor: H3Resolution
  /** Finest resolution advertised. Recommended 9 fixed, 7 moving (§9.6). */
  readonly ceiling: H3Resolution
}
```

**Nothing is added to `CapabilityRecord` or `NodeCertificate`.** That is deliberate and is half of why
the rejected alternatives in §6 were rejected: a place is not a property of a node's identity document,
it is a block the node holds.

---

## 5. API surface

All signatures strongly typed, no `any`. Proposed home: a new `packages/core/src/geo/` module, exported
through the `@o2/core` barrel (`packages/core/src/index.ts`) in the same style as `discovery.ts` and
`quorum.ts` (`index.ts:266,279,396,403`).

### 5.1 Derivation — `packages/core/src/geo/cell.ts`

```ts
import type { CID } from 'multiformats/cid'

/**
 * Normalize an index string from `h3-js` to the 16-char zero-padded form (§3.2).
 *
 * Throws `InvalidCellError` if `isValidCell` rejects it. Every other function in this
 * module takes an already-normalized `H3Cell`, so this is the single boundary where an
 * unnormalized string can enter.
 */
export function normalizeCell(h3IndexString: string): H3Cell

/** The canonical block bytes for a cell. Pure, synchronous, no I/O. */
export function placeBytes(cell: H3Cell): Uint8Array<ArrayBuffer>

/**
 * The CID a cell advertisement is addressed by.
 *
 * Computed through `canonicalCid` (`canonical/encode.ts:138`), which is the same
 * `CID.create(1, dagCbor.code, sha256(bytes))` a blockstore `put` produces
 * (`blockstore/memory.ts:25`). Test T1 asserts the two paths agree; without that
 * assertion this is the drift `sign-kernel.ts:80-85` warns about.
 */
export function cellCid(cell: H3Cell): Promise<CID>

/** The cell containing a point at a resolution. Wraps `latLngToCell`, then normalizes. */
export function cellAt(point: LatLng, resolution: H3Resolution): H3Cell

/**
 * A cell and its ancestors, coarsest-first, clamped to the policy band.
 *
 * Returns `[]` when `cell`'s own resolution is coarser than `policy.floor` — a node
 * cannot advertise precision it does not have, and returning the cell anyway would
 * publish a claim at a resolution nobody computed.
 *
 * Guards with `isValidCell` up front rather than relying on a uniform failure mode:
 * `cellToParent` THROWS `H3Error` on bad input while `getResolution` returns `-1`
 * (§9.5), so the two H3 calls this walks over fail in different shapes.
 */
export function advertisedCells(cell: H3Cell, policy: PlacePolicy): readonly H3Cell[]

/**
 * The resolution whose average cell size best matches a radius in metres.
 *
 * Reads `getHexagonEdgeLengthAvg(res, UNITS.m)` from the binding rather than a table
 * transcribed into this repository, so the numbers cannot drift from the library's own.
 *
 * Returns the resolution AND the radius it actually represents, because the two differ
 * (§3.4) and a caller reporting the requested radius is reporting a number nothing
 * measured. `effectiveRadiusMetres` is itself an AVERAGE: real cells vary by ~2× and
 * the figures for res ≥ 7 are extrapolated upstream, not measured (§9.6). It must not
 * be presented to a user as a distance guarantee.
 */
export function resolutionForRadius(metres: number): {
  readonly resolution: H3Resolution
  readonly effectiveRadiusMetres: number
}
```

### 5.2 Advertisement — `packages/core/src/geo/advertise.ts`

```ts
import type { Blockstore } from '../ports.ts'

/**
 * Put the place blocks for a cell band into a node's own store.
 *
 * Idempotent: content-addressed, so re-putting identical bytes is a no-op
 * (`blockstore/memory.ts:26-27`). Returns the CIDs put, coarsest-first.
 *
 * This makes the node a provider of those CIDs. It does NOT decide whether they are
 * advertised — that is `PlaceMembership` below, because `Blockstore` has no `delete`
 * (`ports.ts:24-49`) and withdrawal therefore cannot be a store operation.
 */
export function advertisePlace(
  store: Blockstore,
  cell: H3Cell,
  policy: PlacePolicy,
): Promise<readonly CID[]>

/**
 * The live set of cells this node currently answers for.
 *
 * A mutable hold, not a snapshot — see `discovery.ts:472-476` for why the distinction
 * is load-bearing. `enter`/`leave` are the mobility path (§8.2) and cost no I/O and no
 * network: they mutate a set that `withholdsPlacesOutside` reads per lookup.
 */
export interface PlaceMembership {
  enter(cell: H3Cell, policy: PlacePolicy): Promise<void>
  leave(cell: H3Cell, policy: PlacePolicy): Promise<void>
  /** Cell CIDs currently answered for. */
  current(): ReadonlySet<string>
}

export function createPlaceMembership(): PlaceMembership

/**
 * A `withhold` predicate: refuse to advertise any place block not currently held.
 *
 * COMPOSED WITH, NEVER SUBSTITUTED FOR, the sovereign predicate — see §8.1 and
 * `discovery.ts:463-470`, which requires the sovereign arm to come from `@o2/net`'s
 * `withholdingFrom` (`net/src/sovereign-egress.ts:191`) and from nothing else.
 */
export function withholdsPlacesOutside(
  membership: PlaceMembership,
  known: ReadonlySet<string>,
): (cid: CID) => boolean
```

### 5.3 Query — `packages/core/src/geo/query.ts`

```ts
/** What a vicinity lookup asks for. */
export interface PlaceQuery {
  readonly centre: LatLng
  /** Requested radius. Quantized to a resolution — see the returned `resolution`. */
  readonly radiusMetres: number
  /** Include the 6 neighbouring cells (7 lookups instead of 1). Default false — §11 Q2. */
  readonly includeNeighbours?: boolean
}

/** The cells a query resolves to, and the resolution it actually used. */
export interface ResolvedPlaceQuery {
  readonly cells: readonly H3Cell[]
  readonly resolution: H3Resolution
  readonly effectiveRadiusMetres: number
}

export function resolvePlaceQuery(query: PlaceQuery): ResolvedPlaceQuery

/**
 * Node keys associated with any of a query's cells.
 *
 * Index-agnostic BY CONSTRUCTION: it takes a `RecordIndex` and calls nothing but
 * `providers(cid)` (`discovery.ts:143`). It gains global reach the day a DHT is
 * installed as a `FallbackRecordIndex` source, with no change here — §8.4.
 */
export function nodesNear(
  query: ResolvedPlaceQuery,
  index: RecordIndex,
): Promise<readonly PublicKeyHex[]>

/**
 * Use case 5. K distinct cells, one node from each — diversity by construction.
 *
 * `cells` are chosen by the CALLER, so no node's self-asserted location is ever read
 * back. That is the whole property, and §8.2 states what it does and does not buy.
 * Fewer than `cells.length` entries is a normal result: a cell may have no live node.
 */
export function oneNodePerCell(
  cells: readonly H3Cell[],
  index: RecordIndex,
): Promise<ReadonlyMap<H3Cell, PublicKeyHex>>
```

### 5.4 What is *not* added

No change to `RecordIndex`, `ExecutorQuery` (beyond the doc-comment widening in §3.1),
`CapabilityRecord`, `NodeCertificate`, `AgentRequest`/`AgentResponse`, or any wire type.

---

## 6. Rejected alternatives

### 6.1 Overload `CapabilityRecord.features` with `h3:` strings — REJECTED

Put `'h3:8a2a1072b59ffff'` into `CapabilityRecord.features` (`discovery.ts:73`) and query with
`ExecutorQuery.requiredFeatures` (`discovery.ts:153`).

**Fatal, and the reason is structural.** `discoverExecutors` computes its candidate set as
`providers(query.inputCid)` **first** (`discovery.ts:247`) and only then filters by features
(`discovery.ts:282-288`). So `features` can only ever **filter among nodes that already hold a data
block**. Three of the four target use cases (2, 4, 5) have **no data CID in hand at all** — they start
from a place. There is nothing to filter.

**Second, independent reason.** It would make an existing message print a falsehood. The exclusion
detail is *"`${nodeKey}` lacks required engine features: ${missing.join(', ')}"* (`discovery.ts:228`).
A node in the wrong city would be reported as lacking an **engine feature**. That is the
`missing-features` message stating something untrue about the engine, and this repo has a standing rule
against exactly that shape.

**Third.** `discover-candidates.ts:74-78` records that `CapabilityRecord.features` is `[]` on every node
this repository builds and that no feature-detection dependency exists — so the field has no live
producer to extend, and a query naming a feature currently excludes everybody.

### 6.2 A new `places` field plus a `nodesIn(cell)` index verb — REJECTED as premature

Add `places: readonly H3Cell[]` to `CapabilityRecord` and a `nodesIn(cell)` method to `RecordIndex`.

**Rejected because nothing in the use cases needs the node→places direction.** Every one of the five is
place→nodes. A `places` field answers *"where is node X"*, which nothing asks; and it would require a
new `RecordIndex` method, a new wire verb in `protocol.ts`, a new branch in `agent.ts`'s request
dispatch (`agent.ts:790-812`), and a new implementation in **every** `RecordIndex` — `MemoryRecordIndex`,
`SelfRecordIndex`, `RpcRecordIndex`, `FallbackRecordIndex`. The chosen design requires none of these.

It also **re-introduces staleness**: a `places` field inside a signed, expiring `CapabilityRecord` must
be re-signed and re-published every time a node moves, which is precisely the announce-on-write model
that owner ruling D1 rejected, for the three reasons recorded at `discovery.ts:434-441`.

Worth keeping on the shelf for one thing only: a future *"show me this node's coverage"* diagnostic. That
is not a use case here.

> **Ratified and narrowly reopened, 2026-08-11 (§14 decisions 1 and 10).**
>
> **Ratified:** the owner's ruling puts H3 location outside the signed record for this section's
> own reason, stated in the ruling's own words — *a signed record has a validity window; a vehicle
> invalidates it in minutes.* The three-dimensional model (§14.1) lists `appIds` and the capability
> class **in** the record and location **out** of it, splitting on churn. So §6.2's rejection is
> now an owner decision rather than this spec's recommendation.
>
> **Reopened, narrowly, and explicitly parked:** a **single coarse cell** (res ~5, ~250 km) in the
> signed record as a cheap pre-filter. It escapes the staleness objection this section raises,
> because a driver does not leave a metropolitan-region cell in a shift, and it would save a lookup
> on *"roughly near me"*. **It is deferred under YAGNI until something measures the need** — and it
> is recorded here so a later reader meets it as *parked*, not as new. Two conditions it must
> satisfy if it is ever built: it is **one cell, not a set** (§3.4's transport-budget note), and it
> rides inside `extensions` rather than as a new top-level key, which is now enforced by the parser
> rather than merely advised (`packages/net/src/protocol.ts:749-757` at `32cba89`, applied at
> `:771`). It would be the **first** use of the extension seam landed in `32cba89`, which makes it
> the natural test of whether that seam works as designed.

### 6.3 A dedicated geographic DHT keyspace — DEFERRED, not rejected

Out of scope by instruction; a separate spec covers the DHT. Recorded here only so the boundary is
explicit: this design **assumes** it will one day sit behind a global index and is built so that day
requires no change to it (§8.4).

---

## 7. Trust model and explicit non-claims

### 7.1 Location claims are self-asserted and unverifiable

A node puts a place block for any cell it likes. Nothing verifies it. There is no proof-of-location
mechanism in this design and none is proposed.

### 7.2 Why that is acceptable — and exactly how far the argument reaches

**VER-04 already prevents the attack that would matter.** Quoted exactly from
`.planning/REQUIREMENTS.md:181-182`:

> **VER-04**: Quorum members are selected with anti-affinity, so one operator cannot supply a whole
> quorum

That is enforced by `composeQuorum` (`packages/core/src/quorum.ts:163`), which takes one certificate per
`operatorId` **by construction** rather than as a check applied afterwards (`quorum.ts:176-179`) and
refuses with `insufficient-operators` when distinct operators are fewer than the quorum size
(`quorum.ts:182-187`). The operator identity is read off the **provider-signed certificate**, which a
node cannot forge.

**Therefore a false location cannot compromise a quorum.** It can only produce a quorum that is
operator-diverse but geographically co-located. That is a **degraded fault domain — a QUALITY failure,
not a security one.**

### 7.3 The explicit non-claims

> **Geographic spread is best-effort. It may never, on its own, satisfy VER-03 or VER-04.**

Both rows are open (`[ ]`) at `c94bc7a` and both are about something this design does not measure:

- **VER-03** (`REQUIREMENTS.md:165-166`), quoted exactly:
  > No verification quorum rests on a single shared reachability dependency, so eclipsing a quorum
  > requires compromising more than one of them.

  This is about the **discovery graph**, not about geography. It is satisfied by `sharedRelay` over the
  chosen members (`quorum.ts:249`). Two nodes on opposite sides of the planet can share one relay and
  fail VER-03; two nodes in one building on different relays can satisfy it. **Geographic distance is
  neither necessary nor sufficient for VER-03, and must never be offered as evidence for it.** The row's
  own history is the warning: it previously encoded a *mechanism* (a node class) for a property about the
  discovery graph, and that phrasing produced a real defect retracted in `0314208`
  (`REQUIREMENTS.md:167-180`). Substituting *geographic* diversity for *dependency* diversity would be
  the identical error one substitution over.

- **VER-04** is about **operator diversity**, established from signed certificates (§7.2). A place block
  is unsigned and self-asserted and contributes nothing to it.

**Stated as a rule for implementers:** no attestation, receipt, or strength reading may cite geographic
spread. `describeAttestation` and the strength vocabulary (`owner-attested` / `owner-domain` /
`independent`) are unchanged by this design, and must stay unchanged.

### 7.4 The sovereignty tension — and a leak the egress manifest does not cover

`PROJECT.md`'s core value is that no raw data leaves its owner's device, and the sovereignty claim is
carried by an egress manifest and coverage report.

**A place block is data the node publishes about itself, and the egress manifest does not cover it.**
The manifest covers *payload* egress; a place advertisement is an index entry, published deliberately,
about the owner's physical location. Advertising a res-12 cell is a ~300 m² disclosure of an owner's
whereabouts that no coverage report will ever mention.

This is the sharpest honest tension in the design and it is **not resolved here**. It is mitigated by
§8.1 (withhold coarse) and by the res-9 ceiling default, and it is recorded as open question Q1 (§11).

---

## 8. The four questions the mechanism answers

### 8.1 Privacy — `withhold` expresses "advertise my city, not my street"

The hook already exists and already means the right thing: `withhold` is *"Says a CID must not be
advertised even though this node holds it"* (`discovery.ts:415-425`), and `SelfRecordIndex.providers`
consults it before answering (`discovery.ts:516-518`).

So a node **puts** blocks for res 5–12 and **withholds** res 10, 11 and 12. It provides its city and
withholds its street. Precision becomes a per-node policy dial with no new mechanism and no protocol
change.

**The composition rule, and it is a constraint rather than a detail.** `discovery.ts:463-470` requires
that the sovereign arm of the predicate be `@o2/net`'s `withholdingFrom`
(`packages/net/src/sovereign-egress.ts:191`) and *"a predicate written any other way… is a second copy of
the condition, and two copies diverge."* Place privacy must therefore be **OR-composed** with that
predicate, never substituted for it:

```ts
const withhold = (cid: CID): boolean | Promise<boolean> =>
  placeWithheld(cid) || withholdingFrom(egressDisposition)(cid)
```

The sovereign arm still comes from the one production construction (`browser-node.ts:1229`,
`fabric-node.ts:136`). The invariant *"this index never advertises a block the `block` branch would
refuse to serve"* (`discovery.ts:460-461`) is unaffected, because OR only ever withholds **more**. Test
T5 (§10) pins that direction.

### 8.2 Mobility — free at relay scope, because there is nothing to retract

A driver's cell membership changes constantly. The re-advertise cost:

| Operation | Cost |
|-----------|------|
| Blocks put on first entry to a cell | 1 per resolution level crossed, ~40 bytes each, **local only** |
| Blocks put on re-entry to a known cell | **zero** — content-addressed, re-put is a no-op (`memory.ts:26-27`) |
| Blocks removed on leaving | **impossible and unnecessary** — no `delete` on the port (`ports.ts:24-49`); membership set drops the entry |
| Index writes | **zero** — `SelfRecordIndex` computes the answer at ask time (`discovery.ts:511-519`) |
| Network messages | **zero** — D1: answers are computed, not announced (`discovery.ts:431-441`) |

**Moving is a local set mutation.** Crossing a res-9 boundary within a city changes res 9 and possibly
res 8; res 5–7 are unchanged, so typically 1–2 levels move per crossing.

> **This is the design's strongest property and it should be stated in those terms:** the announce-based
> alternative (§6.2) would require re-signing and re-publishing a record on every cell crossing. Here,
> mobility costs nothing on the wire because there was never an announcement.

**Floor resolution below which mobility is not tracked.** Yes — recommended **res 7 ceiling for a moving
node**, versus res 9 for a fixed one. Rationale: below that, boundary-crossing frequency exceeds query
frequency, so finer cells cost membership churn while adding precision no query consumes. This threshold
is a **guess, not a measurement** — see Q3 (§11).

**The cost that does NOT stay local**, stated so nobody discovers it later: under a DHT (§8.4) every one
of these free operations becomes a provider-record publish with a TTL and a republish interval. Mobility
is free *at relay scope* and is emphatically **not** free under a DHT. That is a fact about the DHT and
belongs in its spec, but it must not come as a surprise.

### 8.3 Reach — what works today and what needs the DHT

`RpcRecordIndex.providers` asks **only the peers this node is already connected to**. Its own doc says
so at `packages/net/src/discovery.ts:73-79`: *"No transitive routing and no DHT: the answer covers the
peers this endpoint is currently connected to, and nothing beyond them."* `discoverCandidates` inherits
it verbatim (`discover-candidates.ts:38-44`). `CLAUDE.md` confirms `@libp2p/kad-dht` is **not installed**
and that discovery today runs over the relay's reservation store
(`packages/net/src/rendezvous.ts:76`, `findReservedPeers`).

| # | Use case | Works at relay scope today? |
|---|----------|------------------------------|
| 1 | **Starbucks** | **Yes.** The store's node is a directly-connected peer, one hop. This is the use case the current fabric already serves. |
| 3 | **Uber (Miami)** | **Partly.** Works for drivers already co-present on the same relay; a driver on another relay is invisible. |
| 4 | **Social (chosen area)** | **Partly**, same limit as 3. |
| 2 | **AirBnB (London from SF)** | **No.** The requestor is connected to no peer that holds the London cell block. Needs a global index. |
| 5 | **K random cells worldwide** | **No**, for the same reason — by definition it reaches cells with no local peer. |

> **Added 2026-08-11 (§14 decision 9) — what "needs a global index" now means, and it is less than
> this table implies.** The owner ruled that **the DHT is EXISTENCE DISCOVERY only**: it tells you a
> peer *exists*; the *facts* come from the peer. Applied here, the two "No" rows do not need the DHT
> to hold a geographic *answer* — they need it to hold *"this peer exists and provides this cell
> CID"*, after which the peer itself is the authority on whether it still answers for that cell,
> live, at ask time.
>
> **That is §3.3's `withhold`-at-ask-time property surviving the transition to a global index, and
> it is the strongest thing this design gets from the ruling.** §8.2's warning that mobility is
> *"emphatically not free under a DHT"* is unchanged and still correct — a provider record still
> costs a publish and cannot be retracted for up to 48 h. What changes is the **consequence** of
> that staleness: a stale provider record now costs one wasted dial, because the peer's live answer
> overrides it. See the DHT spec §5.5.

### 8.4 Index-agnosticism — the load-bearing property

**This design is expressed entirely in `providers(cid)`.** It calls exactly one method of one port
(`discovery.ts:143`) and knows nothing about how the answer arrives.

Therefore **it gains global reach when a DHT is installed as a `FallbackRecordIndex` source, with no
change to the H3 code.** `FallbackRecordIndex` (`discovery.ts:340-376`) tries each source in order and
returns the first non-empty `providers` answer (`:353-363`); a DHT source is simply another
`IndexSource` (`discovery.ts:310-314`). `nodesNear` and `oneNodePerCell` (§5.3) take a `RecordIndex` and
would not observe the difference.

Two things worth noting for whoever writes the DHT spec:

1. `FallbackRecordIndex` has **no production caller today**, and that is a recorded decision rather than
   an oversight: *"a fallback chain needs a genuine second source, and this repository does not have one
   yet"* (`discovery.ts:323-338`). **A DHT is exactly that genuine second source**, so installing it
   closes that gap and NET-06 in the same move.
2. `FallbackRecordIndex.providers` returns the **first non-empty** answer, not a union — so a local
   source that answers with one nearby node would **shadow** a DHT holding fifty. For geographic queries
   that is probably the wrong policy, and it is the DHT spec's problem, not this one's. Flagged as Q4.

   > **Answered 2026-08-11 — the DHT spec took it, agreed, and made it that spec's one architectural
   > correction.** `2026-08-11-dht-record-index-design.md` §6.2 rules that
   > `FallbackRecordIndex.providers` must **UNION** rather than return first-non-empty, on the
   > ground that *"the DHT source and the RPC source are two views of the same provider set"* — and
   > it reaches that conclusion by the argument `RpcRecordIndex` already won for itself at
   > `packages/net/src/discovery.ts:38-53`. **So Q4 closes, and it closes in the direction this note
   > guessed.** `recordsFor` stays first-non-empty, and that asymmetry is deliberate. Whoever
   > implements the geographic query path should read that section before assuming the shadowing
   > is fixed, because **a truncated union is a distinct failure from a shadowed one** and §14
   > decision 3 is about the second — see the DHT spec §5.4, which cross-references §6.2 for
   > exactly this reason.

**Out of scope:** the DHT itself. Not designed here.

---

## 9. Which library

Measured against the npm registry and the published 4.5.0 tarball. Nothing was installed, built or run.

### 9.1 `h3-js@4.5.0` — and there is no alternative

| Field | Value |
|-------|-------|
| Version / published | **4.5.0**, 2026-07-01 |
| License | Apache-2.0 (`uber/h3-js`) |
| Runtime dependencies | **zero** |
| Deprecated | no |
| Bundled H3 core | 4.5.0 |

**There is no competing H3 implementation for JavaScript.** `h3-node@4.1.1` is a native N-API addon —
Node-only, cannot run in a browser, ~2.7 years stale. No pure-TS H3 port exists. So the properties
below are not avoidable by choosing a different package; they are the cost of H3 on this platform.

Release cadence is slow but alive: 4.2.1 (2025-04) → 4.3.0 (2025-08) → 4.4.0 (2025-12) → 4.5.0 (2026-07).

### 9.2 It is **asm.js, not WebAssembly** — and that is good news here

This was the question worth asking, and the answer inverts the expectation in the brief.

**Measured:** the tarball contains **no `.wasm` file** (33 files, zero `.wasm`/`.wat`). All six dist
bundles contain **zero** occurrences of `WebAssembly`, `.wasm`, `wasmMemory`, or `instantiateStreaming`.
Positive identification of asm.js in `dist/libh3-browser.js`: `"almost asm"`, `Module["asm"]`,
`asmGlobalArg`, `asmLibraryArg`, `TOTAL_MEMORY`, `HEAP32`/`HEAPF64`. Build provenance from
`package.json` scripts: Emscripten **1.38.43 (2019)**, `-s ENVIRONMENT=web` for the browser variant.
Static memory is inlined as a **data URI**, so there is no separate `.mem` asset either.

**What this means for the browser build — nothing to do.** No `.wasm` fetch, no
`Content-Type: application/wasm`, no `instantiateStreaming`, no COOP/COEP, no separate asset to host.
It is one plain JS blob, which sidesteps every constraint `CLAUDE.md` records about WASM delivery on
GitHub Pages.

**What it costs.** asm.js performance, not WASM performance — and **none** of the V8 code-cache benefit
the project's stack doc relies on for its *own* artifacts. Worse, modern V8 dropped the asm.js→WASM
optimizing path in most cases, so the README's own benchmarks (measured on "Node 12") likely overstate
present-day throughput. **Any performance claim about H3 in this fabric needs its own measurement**;
none is made here.

### 9.3 Browser + Node from one codebase — works, with three named risks

| Entry | Format | Node builtins |
|-------|--------|---------------|
| `dist/h3-js.js` (`main`) | CJS | `require("fs")`, `require("path")` |
| `dist/h3-js.es.js` (`module`) | **ESM** | `require("fs")`, `require("path")` |
| `dist/browser/h3-js.es.js` | **ESM** | **none** |
| `dist/browser/h3-js.js` | CJS | **none** |

Browser entries are selected through the **legacy `browser` field**, and the package has
**no `exports` map and no `"type": "module"`**. Three consequences for an ESM-only,
`moduleResolution: "bundler"` project targeting browser + Node + embedded:

1. **A resolver that honours only `exports` will hand the browser the Node build**, complete with
   `require("fs")` / `require("path")`. Vite, webpack and Rollup all honour `browser`, so this normally
   works — but it must be **verified in the built browser bundle, not assumed**. This is a concrete
   G1 acceptance check, not a theoretical risk.
2. **In Node ESM, `import {latLngToCell} from 'h3-js'` resolves to `main` → CJS.** Named imports work
   (the file uses literal `exports.foo = foo`, which `cjs-module-lexer` detects), but it is CJS interop
   rather than a real ESM path.
3. **Not tree-shakeable** — `hasSideEffects: true`, `isModuleType: false`. The emscripten blob is one
   indivisible module: importing one function pulls the whole thing.

The `fs`/`path` requires sit inside `if (ENVIRONMENT_IS_NODE)` and are lazily invoked from a `read_`
path made unreachable by the data-URI memory init — dead code in a browser, but **statically present
specifiers a bundler will try to resolve**.

### 9.4 Bundle size — ~212 kB min / ~64 kB gzip, all or nothing

Bundlephobia API for `h3-js@4.5.0`: **217,184 B minified**, **65,681 B min+gzip**, `dependencyCount: 0`.
Corroborated locally within 0.4% by `wc -c` / `gzip -9` on the extracted pre-minified UMD bundle
(216,070 B raw, 65,426 B gzipped).

Because it does not tree-shake, **this is the cost of using H3 at all in a browser tab** — you budget
for the whole library or none of it. For a fabric whose node agent runs in a visitor's browser tab, 64 kB
gzip is a real line item and should be a deliberate decision, ideally behind a lazy dynamic `import()`
so only tabs that actually run geographic queries pay it. Proposed as part of G1.

*(`npm view h3-js dist.unpackedSize` reports 7.7 MB, but 63% of that is sourcemaps no bundler ships.)*

### 9.5 The v4 API — all seven functions confirmed present

| Need | v4 signature | `types.d.ts` |
|------|--------------|--------------|
| lat/lng → cell | `latLngToCell(lat: number, lng: number, res: number): H3Index` | :100 |
| parent | `cellToParent(h3Index: H3IndexInput, res: number): H3Index` | :128 |
| centre | `cellToLatLng(h3Index: H3IndexInput): CoordPair` | :108 |
| boundary | `cellToBoundary(h3Index: H3IndexInput, formatAsGeoJson?: boolean): CoordPair[]` | :119 |
| k-ring | `gridDisk(h3Index: H3IndexInput, ringSize: number): H3Index[]` | :185 |
| resolution | `getResolution(h3Index: H3IndexInput): number` — **or `-1` if invalid** | :77 |
| validity | `isValidCell(h3Index: H3IndexInput): boolean` | :21 |

Four behaviours the implementation must handle rather than discover:

- **`cellToParent` throws `H3Error`** on invalid input; `getResolution` returns `-1` instead of
  throwing. `advertisedCells` must therefore guard with `isValidCell` up front rather than relying on a
  uniform failure mode.
- **`gridDisk` order is explicitly undefined** ("The order of the hexagons is undefined"). The k-ring
  query (§3.4) must **sort** before use so a query plan is reproducible.
- **`getHexagonEdgeLengthAvg(res, unit)` and `getHexagonAreaAvg(res, unit)`** exist with
  `h3.UNITS = {m, m2, km, km2, …}`. `resolutionForRadius` should call these **rather than hard-coding
  the §9.6 table**, so the numbers cannot drift from the library's own.
- **There is no `BigInt` form.** `H3Index = string`; the only numeric form is
  `SplitLong = [lower32, upper32]` (little-endian pair). Confirmed by zero `BigInt`/`bigint` occurrences
  anywhere in the package.

### 9.6 Resolution table — and the caveats that change the recommendation

Cross-verified against two agreeing sources: `h3geo.org/docs/core-library/restable` and
`website/docs/library/restable.md` in `uber/h3@master`.

| Res | Avg area | Avg edge | Use |
|----:|---------:|---------:|-----|
| 0 | 4,357,449 km² | 1281 km | — |
| 3 | 12,393 km² | 69.0 km | — |
| **5** | **252.9 km²** | **9.85 km** | **floor — metro region** |
| 6 | 36.1 km² | 3.72 km | town |
| **7** | **5.16 km²** | **1.41 km** | **ceiling for a moving node** |
| 8 | 0.737 km² | 531 m | district |
| **9** | **0.105 km²** | **201 m** | **ceiling for a fixed node — city block** |
| 10 | 15,048 m² | 75.9 m | building cluster |
| 11 | 2,150 m² | 28.7 m | building |
| 12 | **307 m²** | 10.8 m | room-scale — the §7.4 privacy figure |
| 15 | 0.895 m² | 0.58 m | — |

**Three upstream caveats, all stated verbatim in the H3 docs, and each one bears on this design:**

1. **Spherical earth model** (WGS84/EPSG:4326 authalic radius), not the ellipsoid.
2. **Edge lengths were calculated exactly only for resolutions 0–6 and *extrapolated* for 7–15.** So
   every edge figure at the recommended ceilings (7 and 9) is an extrapolation, not a measurement.
   `resolutionForRadius`'s `effectiveRadiusMetres` inherits that and **must not be presented as
   measured**.
3. **These are averages and real cells vary about 2×.** The min/max hexagon area ratio converges to
   **1.9928** from res ~7 onward — the largest hexagon at a resolution has nearly double the area of the
   smallest. **A radius→resolution mapping keyed on the average is off by up to ~1.4× in either
   direction for any individual cell.** This is the strongest argument for treating `radiusMetres` as a
   hint and returning the resolution actually used (§3.4), and it should be stated to callers.

Also: **12 pentagons exist at every resolution** (~0.5046 of hexagon area, at icosahedron vertices), so
`cellToChildren` fan-out is **not uniformly 7** — 6 for a pentagon. Any code assuming 7 children is
wrong at 12 places on Earth. Cell count is `c(r) = 2 + 120·7^r`.

### 9.7 Explicitly UNVERIFIED

- **Node 24 runtime compatibility** — no code was run. `engines` says `>=4`, the README says `>=6`,
  `volta` pins 12.19.0; all three are stale metadata. The code is ES5 with zero deps so risk is low, but
  **this is unmeasured** and G1 must actually import it under Node 24 before the phase is called done.
- **Present-day asm.js throughput on V8** — the README's figures are from Node 12 and V8 has since
  dropped the asm.js→WASM optimizing path.
- **Directed-edge / vertex string width (16 chars)** — derived from the confirmed mode-bit layout, not
  observed in an example. It is not load-bearing here because §3.2 normalizes to 16 chars regardless and
  guards with `isValidCell`.
- **Packagephobia figures** — blocked by a security checkpoint.

---

## 10. Testing strategy

Per repo convention: `MemoryRecordIndex` for index-level tests, `@libp2p/memory` / `MemoryNetwork` for
multi-node tests, run by project (`npx vitest run --project node`), never a bare path.

### 10.1 The core claim, and its red-first proof

> **Core claim.** A vicinity query at resolution *r* returns exactly the nodes associated with that
> cell at *r* — including nodes whose own association is finer than *r* and reached via the ancestor
> chain — and no others.

**The red-first proof is the ancestor chain, because that is the only part that can silently
half-work.** A test where every node advertises at exactly the query resolution passes without the
hierarchy existing at all, and would be a green that could not fail.

- **T2 (red-first).** Three nodes at distinct res-9 cells inside one res-6 cell, one node in a different
  res-6 cell. Query at res 6. Expect exactly the three.
  **Plant:** make `advertisedCells` return `[cell]` — the leaf only, no ancestors.
  **Expected red:** the res-6 query returns `[]`, `expected [] to have length 3`.
  **Restore:** surgical inverse of that one edit, verified with `cmp` against a snapshot taken
  immediately before planting — per `CLAUDE.md`, never `cp`, and never trusting hunk count as the check.

- **T3 (the negative half, planted separately).** Query at res 9 for one node's own cell must return
  **one** node, not three. Plant: advertise every node into every sibling cell. Expected red:
  `expected 3 to be 1`. Without T3, T2 passes for a scheme that advertises everything everywhere.

### 10.2 The rest

- **T1 (derivation agreement).** `cellCid(cell)` equals `await new MemoryBlockstore().put(placeBytes(cell))`.
  This is the assertion preventing the drift `sign-kernel.ts:80-85` warns about. Also assert
  determinism: two independently constructed records for one cell give byte-identical bytes and an
  equal CID.
- **T4 (`SelfRecordIndex` integration).** A node that has `put` its place blocks answers `providers`
  with its own key (`discovery.ts:511-519`); one that has not, answers `[]`.
- **T5 (privacy, and the direction that matters).** With a place-withholding predicate OR-composed with
  a stub sovereign predicate: the coarse cell is advertised, the fine cell is not, **and** every CID the
  sovereign arm withholds is still withheld. Plant: swap `||` for the place arm alone. Expected red: the
  sovereign block becomes advertised — which is the invariant at `discovery.ts:460-461` breaking.
- **T6 (mobility).** `enter` then `leave` then `enter` the same cell: `providers` answers, stops
  answering, answers again, **with `put` called only on the first entry** (assert via a counting
  blockstore wrapper). This is the "no announcement to retract" property as a test.
- **T7 (use case 5, diversity by construction).** K=5 caller-chosen cells, 5 nodes over `MemoryNetwork`.
  Assert 5 distinct node keys **and** — the actual claim — that no place record was ever *read* to get
  there: `oneNodePerCell` never calls `recordsFor`, asserted with a counting `RecordIndex` decorator.
  That is what "diversity by construction" means and it is checkable.
- **T8 (end-to-end over the memory transport).** `discoverCandidates({inputCid: cellCid(cell), …})`
  returns dispatchable `RemoteExecutor`s — proving the claim in §3.1 that the existing pipeline works
  unchanged. Nodes without valid certificates must appear in `excluded`, not silently vanish.
- **T9 (index-agnosticism).** Run the identical `nodesNear` assertions against `MemoryRecordIndex` and
  against a `FallbackRecordIndex` wrapping an empty source plus that same index. Identical results
  proves §8.4's claim structurally rather than by assertion.

### 10.3 What these tests must NOT be allowed to claim

No test may assert that geographic spread satisfies VER-03 or VER-04 (§7.3). If a quorum test ever
consumes `nodesNear` output, it must assert the **operator** and **shared-relay** properties from the
certificates (`quorum.ts:176-179`, `:249`), never from the cells.

---

## 11. Open questions

- **Q1 — the sovereignty leak (§7.4).** A place block is self-disclosure not covered by the egress
  manifest. Should the coverage report name it? Owner ruling needed; this design does not settle it.
- **Q2 — k-ring by default?** Boundary effects (§3.4) argue yes; 7× lookup cost argues no. **No
  measurement exists.** Default `false` proposed so the cost is opt-in.
- **Q3 — the res-7 moving-node ceiling (§8.2) is a guess.** It should be set by measuring crossing rate
  against query rate, and is currently asserted by nobody.
- ~~**Q4 — `FallbackRecordIndex` first-non-empty shadows a DHT** for geographic queries (§8.4 note 2).
  Belongs to the DHT spec; recorded here because this design surfaced it.~~
  **CLOSED 2026-08-11.** The DHT spec §6.2 rules `providers` must union. Detail and the caveat at
  §8.4 note 2 above.
- **Q5 — cell CID enumerability.** Cell CIDs are computable by anyone, so anyone can enumerate a region
  and ask who is in it. That is inherent to "a place is content" and probably acceptable, but it has not
  been thought through against an adversary mapping a city.

  > **Still open, and sharpened 2026-08-11 by a decision that does NOT apply here (§14 decision 6).**
  > The owner ruled that an **app-id** anchor is hashed for free — `cidOf(appId)` makes the lookup key
  > opaque to anyone who does not already know the app id, which softens the traffic-analysis
  > exposure the DHT spec §9.1 records. **That argument does not transfer to cells, and the
  > difference must not be averaged away.** An app id is drawn from an unbounded space an observer
  > may not know; **a cell is drawn from a small, fully enumerable one** — `c(r) = 2 + 120·7^r`
  > (§9.6), and a city is a few thousand cells at res 9. Pre-computing every cell CID on Earth at the
  > advertised resolutions is a fixed, one-time, entirely feasible cost. **So hashing buys the H3
  > anchor nothing, and Q5 is exactly as open as it was** — with the added knowledge that the
  > protection available to the other anchor kind is unavailable to this one.
- **Q6 — no production caller.** `discoverExecutors` had no caller outside tests from Phase 6 until
  `discoverCandidates` (`discover-candidates.ts:6-12`), and `FallbackRecordIndex`/`MemoryRecordIndex`
  still have none (`discovery.ts:325`). This design must name its **entry point** before it can be
  called done — the G5 ruling at `c94bc7a` closed a finding on exactly the grounds that a capability
  reachable only behind an off-by-default flag is not a wired one. **A geographic feature reachable only
  from a test is the same shape**, and this spec should not be implemented without deciding which
  runnable surface calls it.
- **Q7 — is 64 kB gzip acceptable in a browser tab, and should it be lazily imported?** `h3-js` does
  not tree-shake (§9.4), so a tab pays the whole library or none of it. A dynamic `import()` behind the
  first geographic query would keep non-geographic tabs at zero. Proposed, not decided — it would make
  `cellCid` async at call sites that could otherwise be synchronous.
- **Q8 — asm.js throughput is unmeasured on current V8** (§9.2, §9.7). V8 dropped the asm.js→WASM
  optimizing path, and the library's published benchmarks are from Node 12. Nothing in this design sits
  on a hot path today, so it is not urgent — but **no performance claim may be made about H3 here until
  somebody measures it**, and this row exists so nobody quotes the README's numbers.

---

## 12. Phased implementation outline

| Phase | Deliverable | Verification |
|-------|-------------|--------------|
| **G1** | `@o2/core` `geo/cell.ts`: `normalizeCell`, `placeBytes`, `cellCid`, `cellAt`, `advertisedCells`, `resolutionForRadius`. `h3-js@4.5.0` added. Pure, no I/O. | T1 + T2/T3 red-first, **plus three binding checks the research says cannot be assumed** (see below). |
| **G2** | `geo/advertise.ts`: `advertisePlace`, `PlaceMembership`, `withholdsPlacesOutside`. | T4, T6. |
| **G3** | `geo/query.ts`: `resolvePlaceQuery`, `nodesNear`, `oneNodePerCell`. Widen the `ExecutorQuery.inputCid` doc comment (§3.1). | T7, T9. |
| **G4** | Wire into a node factory: OR-compose the place predicate with `withholdingFrom` at `browser-node.ts:1229` / `fabric-node.ts:136`. | T5 — including the plant proving the sovereign arm still withholds. |
| **G5** | An **entry point** (Q6). Use case 1 (Starbucks) is the only one fully served at relay scope, so it is the honest first demo. | T8 over `MemoryNetwork`, plus a runnable surface actually invoking it. |
| **G6** | *(Blocked on the DHT spec.)* Use cases 2 and 5. | **No H3 code changes expected** — if this phase requires any, §8.4's central claim was wrong and should be corrected rather than worked around. |

**G1's three binding checks**, each because §9 measured a reason it could fail rather than assuming it
works:

1. **The browser bundle must resolve to `dist/browser/h3-js.es.js`, not `dist/h3-js.es.js`.** The
   package has no `exports` map and selects browser entries through the legacy `browser` field (§9.3);
   the Node entry statically contains `require("fs")` / `require("path")`. Inspect the built bundle,
   do not infer from the fact that it compiled.
2. **Import it under Node 24 and call one function.** `engines` says `>=4`, the README says `>=6`,
   `volta` pins 12.19.0 — all stale, and Node 24 compatibility is **UNVERIFIED** (§9.7).
3. **Run the same spec file in both vitest projects** (`--project node` and `--project browser`), which
   is the one-codebase constraint stated as a test rather than as an intention.

**Not in scope:** the DHT, proof-of-location, geographic contribution to any VER row.

---

## 13. Summary of citations

All at `c94bc7a`.

| Claim | Citation |
|-------|----------|
| `RecordIndex` is `providers`/`recordsFor` only | `packages/core/src/discovery.ts:141-146` |
| `discoverExecutors` starts from `providers(inputCid)` | `packages/core/src/discovery.ts:247` |
| Features filter runs *after* the provider set | `packages/core/src/discovery.ts:282-288` |
| `missing-features` message wording | `packages/core/src/discovery.ts:228` |
| `features` is `[]` on every node built here | `packages/net/src/discover-candidates.ts:74-78` |
| `SelfRecordIndex.providers` = `has` + `withhold` | `packages/core/src/discovery.ts:511-519` |
| `withhold` meaning and per-lookup rule | `packages/core/src/discovery.ts:415-425`, `:472-476` |
| The one legitimate sovereign predicate | `packages/core/src/discovery.ts:463-470`; `packages/net/src/sovereign-egress.ts:191` |
| D1: computed at ask time, not announced | `packages/core/src/discovery.ts:431-441` |
| `Blockstore` has no `delete` | `packages/core/src/ports.ts:24-49` |
| Re-put is a no-op | `packages/core/src/blockstore/memory.ts:26-27` |
| CID idiom `CID.create(1, dagCbor.code, sha256)` | `packages/core/src/blockstore/memory.ts:25`; `packages/core/src/canonical/encode.ts:142` |
| Go through `put`, never hand-rolled | `packages/demo/scripts/sign-kernel.ts:80-85` |
| `providers` served over the wire | `packages/net/src/agent.ts:790-796` |
| Reach is directly-connected peers only | `packages/net/src/discovery.ts:73-79`; `packages/net/src/discover-candidates.ts:38-44` |
| `FallbackRecordIndex` first-non-empty; no production caller | `packages/core/src/discovery.ts:353-363`, `:323-338` |
| Relay-scope discovery today | `packages/net/src/rendezvous.ts:76` |
| Operator anti-affinity by construction | `packages/core/src/quorum.ts:163`, `:176-179`, `:182-187` |
| Shared-relay rule (VER-03's mechanism) | `packages/core/src/quorum.ts:249` |
| VER-03 exact wording, open | `.planning/REQUIREMENTS.md:165-166` |
| VER-04 exact wording, open | `.planning/REQUIREMENTS.md:181-182` |

### External sources (npm registry / published tarball / upstream docs)

| Claim | Source |
|-------|--------|
| `h3-js@4.5.0`, 2026-07-01, Apache-2.0, zero deps, not deprecated | `npm view h3-js version time license dependencies deprecated` |
| No `.wasm` anywhere; asm.js via Emscripten 1.38.43 | tarball file listing; `"almost asm"`, `Module["asm"]`, `asmGlobalArg` in `dist/libh3-browser.js`; `package.json` `docker-boot` script |
| Index string is not fixed-width; upper word unpadded | `lib/h3core.js:296-298` (`splitLongToH3Index`) |
| Cells are 15 lowercase hex chars starting `8` | four README examples + cell bit layout, `h3geo.org/docs/library/index/cell` |
| No `exports` map, no `"type"`, legacy `browser` field | `package/package.json` |
| 217,184 B min / 65,681 B min+gzip; `hasSideEffects: true` | `bundlephobia.com/api/size?package=h3-js@4.5.0`, corroborated by local `gzip -9` within 0.4% |
| v4 signatures and `types.d.ts` line numbers | `package/dist/types.d.ts`, `package/README.md` |
| Resolution table; spherical model; res 7–15 edges extrapolated; ~2× cell variance | `h3geo.org/docs/core-library/restable` and `uber/h3@master:website/docs/library/restable.md` (two agreeing sources) |
| `h3-node` Node-only/stale; no pure-TS H3 port exists | `npm view h3-node`; `npm search "h3 hexagon geospatial"` |

---

## 14. Settled 2026-08-11 — the owner's capability ruling, as it lands on this design

*Recorded, not re-argued. The full ruling is in
`docs/superpowers/specs/2026-08-11-capability-registration-design.md` §9; the DHT-side consequences
are in `docs/superpowers/specs/2026-08-11-dht-record-index-design.md` §5.4–§5.5. Only what bears on
geography is restated here. Citations added in this section were read at `32cba89`.*

### 14.1 Decision 1 — three dimensions, and location is deliberately not one of the record's

| Dimension | Where it lives | Why | Usable as an anchor? |
|---|---|---|---|
| `appIds` | signed `CapabilityRecord` | stable | **YES** — `cidOf(appId)` |
| Capability class (`parallel-compute`, a closed union, one member today) | signed `CapabilityRecord` | stable | **NO** — §14.3 |
| **H3 location** | **place blocks + the `withhold` hook, answered at ask time** | **MOBILE** | **YES** — `cellCid(cell)` |

**This ratifies §3.3 and §4 rather than changing them**, and the ruling's own words are this
document's §6.2 argument arriving from the other direction: *a signed record has a validity window;
a vehicle invalidates it in minutes.* The positive form the owner stated — **record = hint; the live
answer is the peer's `has(cid)` plus `withhold` at ask time** — is owner ruling D1 verbatim
(`packages/core/src/discovery.ts:689-697` at `32cba89`, computed at `:767-776`), which §3.3 already
inherits and names.

**One naming note so the table is not misread as a citation.** `cellCid` is specified in §5.1 of
this document and does not yet exist; `cidOf` likewise does not exist in `packages/` at `32cba89`
as a production function. Both are proposed derivations over `canonicalCid`
(`packages/core/src/canonical/encode.ts:138`).

### 14.2 Decision 2 — records arrive with the peer

Recorded at §3.5, where the claim it corrects lives. The short form: **`providers(anchor)` then a
local filter, with no per-candidate `recordsFor` round trip.**

### 14.3 Decision 3 — a class is a filter, never an anchor; a composite anchor is fine

`'parallel-compute'` must never start a lookup: intersecting two truncated Kademlia samples returns
approximately nothing, and does so **silently**. The arithmetic is in the DHT spec §5.4.

**What this section cares about: a class may appear inside a COMPOSITE anchor — `app:X + cell` —
and a composite is selective again.** That is a direct extension of §3.2's derivation and it comes
with a warning this design must own. §3.2 rules that a place CID is the canonical DAG-CBOR of
`{ o2Place: 1, cell }` and that **`o2Place` is a format version, so any change to the encoded shape
produces a different cell CID and therefore a different index** (§4, `PlaceRecord`). A composite
anchor is therefore **not** a place record with an extra key — that would silently repartition the
geographic index. It is a **distinct record kind with its own reserved key and its own version**,
and it must be specified as one when somebody builds it. Nothing in §5.1 covers it today.

**And a composite anchor is a second block per cell per app**, which multiplies §3.4's block count
by the number of apps a node serves. §3.4 correctly calls 5 blocks *"not a number worth
optimizing"*; `5 × |appIds|` may be. Unmeasured, and flagged rather than assumed away.

### 14.4 Decision 4 — the caller names the anchor, and truncation is named

**No query planner.** `resolvePlaceQuery` / `nodesNear` (§5.3) already have this shape — the caller
supplies the cells — so nothing changes here except that it is now a ruling rather than a
convenience.

**What DOES change: `nodesNear` and `oneNodePerCell` must carry
`onTruncated: 'refuse' | 'report-partial'`.** If an anchor lookup returns *at* the cap, the answer
is a **SAMPLE, not a SET**. This matters more for a vicinity query than for anything else in the
system, because a dense cell is the normal case, not the pathological one: §3.4's own quantization
note already accepts that a query returns *"nodes in the same cell at that resolution"* with no
radius semantics, and a silently-capped answer would make that a lie about coverage rather than
merely a coarse one. §5.3's `ResolvedPlaceQuery` returns `resolution` and `effectiveRadiusMetres`
for exactly this reason — *"a caller must not present either as a measured distance"* — and
truncation is the same category of honesty.

**Consequence for `oneNodePerCell` specifically (§5.3, use case 5).** Its docblock says *"fewer
than `cells.length` entries is a normal result: a cell may have no live node."* Under this decision
that sentence is **no longer sufficient**, because "no live node" and "the lookup was capped before
it reached one" are now different answers and the API must distinguish them. **Test T7 must assert
the distinction**, or the diversity-by-construction claim degrades quietly into
diversity-by-whatever-the-cap-returned.

### 14.5 Decision 7 — the transport budget bounds anything cell-shaped on a connection

Recorded at §3.4.

### 14.6 Decision 9 — the DHT is existence discovery only

Recorded at §8.3, where the reach table it qualifies lives.

### 14.7 Decision 10 — a coarse cell in the record, deferred

Recorded at §6.2, where the rejected `places` field it narrowly reopens lives.

### 14.8 What the ruling did NOT touch, said so nobody infers it did

- **§7's trust model and non-claims are untouched.** Geographic spread still may never, on its own,
  satisfy VER-03 or VER-04, and no attestation, receipt or strength reading may cite it. §14.3's
  composite anchor does not change this: a class is *also* not admissible to a quorum rule, for the
  same reason and by the capability spec's own §4.4.
- **§7.4's sovereignty leak is untouched and remains Q1.** A place block is self-disclosure the
  egress manifest does not cover. The ruling made location *more* central and did nothing to close
  that question.
- **§9's library findings are untouched.** `h3-js@4.5.0`, asm.js, 64 kB gzip, the resolution table
  and its three caveats all stand.
- **§12's phasing is untouched except that G3 grows the `onTruncated` field (§14.4) and G5's entry
  point (Q6) is still the gating question it was.** The ruling names a model; it does not supply a
  runnable surface that calls it.
