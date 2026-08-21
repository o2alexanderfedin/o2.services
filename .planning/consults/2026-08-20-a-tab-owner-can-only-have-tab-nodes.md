# A visitor-keyed owner can only ever have *tabs* in its domain — measured

**Found 2026-08-20** while wiring AUTH-03's browser half, by trying to write the e2e that
would demonstrate `owner-domain` for a sovereign shard and discovering the fixture cannot be
built the way every existing sovereign fixture is built. This is not a limitation that was
designed in; it falls out of the one property the visitor key exists to have.

## The chain of facts, each already in the tree

1. **A visitor's owner key is minted `extractable: false`** (`visitor-key.ts`), and
   `exportKey('pkcs8')` on the private half is refused in chromium, firefox and webkit —
   measured 2026-08-16. That refusal *is* the property: the origin serving the page cannot
   read the key.
2. **Enrolling as an owner requires signing with that owner's key.** `requestEnrollment`
   takes a `UserSigner` and signs `ownerProof` with it.
3. **A node's owner identity is its certificate's `userKey`**, never a label it declares:
   `attestation-ui.e2e.test.ts:193` says so in place — *"`sovereignFor: [certificate.userKey]`
   and never `sovereignty.ownerId`"*.

**Therefore: no Node process can ever enrol as a visitor-keyed owner.** The key it would have
to sign with cannot leave the browser. Not "is awkward to move" — cannot, by the property.

## What that costs, and it is the reason this file exists

`owner-domain` means **≥2 replicas under one operator**. So an owner needs two nodes. Every
sovereign fixture in this repository builds those two nodes as **Node processes sharing a
`OWNER_PRIVATE_KEY` held in the test** — `attestation-ui.e2e.test.ts`'s criterion case,
`sovereign-agent.e2e.test.ts`, `sovereign-aggregation.node.test.ts`. **That shape is
unavailable for a tab's owner**, and a reader who tries it will get a chain refused as
`wrong-root` and reasonably conclude the chain is broken. It is not; the owner is.

## The one route that remains, and it is measured rather than reasoned

**Two tabs of one browser profile share the key**, because `visitorKeyPair()` keeps it in
IndexedDB and IndexedDB is per origin. Measured today against a real page, chromium:

| | `visitorOperatorId` |
|---|---|
| context A, tab 1 | `visitor:6976e8941ec733ce` |
| context A, tab 2 | **`visitor:6976e8941ec733ce`** — the same key |
| context B, tab 1 | `visitor:27b260b7deb43c8a` — different |

**The control is the third row and it is what makes the first two mean anything.** Two tabs
agreeing proves sharing only if two *profiles* disagree; otherwise the reading is equally
explained by a constant. They disagree.

**A second, unlooked-for confirmation one layer up:** the second tab never rendered the
consent gate, because it already held the consent the first tab granted. Same origin, same
storage, and the harness had to be taught to click `#allow` only when it is there.

## So the fixture that would close the residue has a determined shape

Pages **in one `browser.newContext()`**, each enrolled through the *visitor* path
(`acceptEnrolment`, no harness-supplied `userPrivateKey`), which makes them nodes of one
owner with `sovereignFor: [thatKey]` falling out of enrolment rather than being configured.
One dispatches a sovereign shard pinned to that shared key; `chainsForOwner` roots the chain
at it because it is the tab's own; the others execute it.

**And this is why `TabApi.start` needing no `sovereignty` option was the right call all
along.** A tab enrolled with its own key *is* an owner node of that owner, automatically. The
option would have been configuring a fact that enrolment already establishes.

### AMENDED 2026-08-20 — the count was wrong: it is THREE tabs, not two

This section said "two pages" and the task said "two-tab". Both were arithmetic taken on
trust. `classifyAttestation` returns `owner-attested` at `<= 1` agreeing replica and
`owner-domain` only at two or more under one operator — and **the submitter cannot be one of
the two**. `attestedNodes` hands a discovered descriptor only to a *peer*, and
`discoveredPool` filters the submitting tab out by `nodeId !== n.peerId`, so its own
descriptor falls back to `ownerId: 'public'`; `eligibleNodes` places a non-public shard only
where the owner ids are equal and therefore passes it over however `includeSelf` is set. Two
tabs read `owner-attested` — correctly — and would not close the criterion. The fixture is
`owner-domain-tabs.e2e.test.ts` and it opens three.

### AMENDED 2026-08-20 — the owner relation falls out of enrolment, but only *from the next start*

The claim above is true and was **not sufficient on the demo path**, which the fixture found
by failing. Every demo tab published `sovereignFor: []` and `canExecuteSovereign: false`,
forever, so an owner-pinned shard was **unplaceable on the owner's own device** — the one
place it is supposed to be placeable. `enrolledUserKey` closes it, reading this origin's own
stored certificate rather than adding a `start` parameter, which keeps the rule above intact.
It carries `enrolledIssuer`'s one-start delay for `enrolledIssuer`'s reason: `PeerVerifier`
is composed *before* `resolveCertificate`, so the certificate this start is about to obtain
does not exist while the options are being built. The enrolling start is nobody's owner node;
every later one is its own.

### A sovereign shard runs where its data already is — and the fixture has to seed it

Not a new rule; the wire's own consequence, written here because it determines the fixture's
shape. A tab that submits sovereign data **refuses to serve it** — `submitJob` records the
CID at the blockstore-put on a set that outlives the job, which is what
`tab-refusals.e2e.test.ts` reads — so an owner-pinned input cannot travel, **not even to
another node of the same owner**. The executor must already hold it. `capability-harness.ts`
says the same thing in its own words: *"seed the owner's row into the node that owns it,
before anything is dispatched."* The fixture seeds through the page's front door, by running
the same values on both peers first as public work.

**Whether an owner's own devices should sync sovereign data between themselves is a real
design question and is deliberately not answered here.** It is an owner ruling, and the
criterion does not need it.

**One honest subtlety, measured rather than reasoned about.** A value dispatched public and
later declared sovereign is the **same block** — same dag-cbor bytes, same CID — and the
fabric cannot retract what already left. A first draft warmed with two shards; the sovereign
run then reached agreement on shards 0 and 1 and reported `input block missing` for 2 through
7, because `{a:0}` and `{a:1}` had already travelled as public work. The run said so plainly:
`violations: []`, `0 withheld`. The guard is a scan of what crossed *during this job*, and it
was telling the truth.

## What is built, and what this leaves

**Built, tested and wired today**: `delegateWith` (core), `chainsForOwner` (browser, 7 cases
across chromium/firefox/webkit), and `runJob` minting a chain per node for an owner-pinned
shard. Both plants watched red and restored at `CMP_EXIT=0`.

**Since built**: `packages/node/src/owner-domain-tabs.e2e.test.ts` — three tabs of one
profile, `owner-domain` read off the page for a sovereign shard, plant watched red and
restored at `CMP_EXIT=0`. The paragraph below is left as it stood on the day, because its
reasoning about `attestation-ui.e2e.test.ts` is unchanged by the new fixture and is why that
case keeps its assertions.

**Not built at the time of writing**: the fixture above. So no e2e then read `owner-domain`
off a page for a sovereign shard, and **`attestation-ui.e2e.test.ts`'s criterion case still passes** — because
it pins its peers to a Node-held key the tab cannot sign for, so `chainsForOwner` correctly
answers `null` and the dispatch is unchanged. **That case did not redden, and per its own
docblock it was supposed to.** The docblock predicted *"the day a chain is wired here, the
`failures` assertion below reddens"* — it does not, and the reason is this file: the chain is
wired and that fixture's owner is unreachable to it. The prediction was right about the
mechanism and wrong about which fixture would show it.

_Measured 2026-08-20 · the two-tab reading is the whole finding; the rest follows from it_
