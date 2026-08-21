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

Two pages **in one `browser.newContext()`**, each enrolled through the *visitor* path
(`acceptEnrolment`, no harness-supplied `userPrivateKey`), which makes them two nodes of one
owner with `sovereignFor: [thatKey]` falling out of enrolment rather than being configured.
One dispatches a sovereign shard pinned to that shared key; `chainsForOwner` roots the chain
at it because it is the tab's own; the other executes it.

**And this is why `TabApi.start` needing no `sovereignty` option was the right call all
along.** A tab enrolled with its own key *is* an owner node of that owner, automatically. The
option would have been configuring a fact that enrolment already establishes.

## What is built, and what this leaves

**Built, tested and wired today**: `delegateWith` (core), `chainsForOwner` (browser, 7 cases
across chromium/firefox/webkit), and `runJob` minting a chain per node for an owner-pinned
shard. Both plants watched red and restored at `CMP_EXIT=0`.

**Not built**: the two-tab fixture above. So no e2e yet reads `owner-domain` off a page for a
sovereign shard, and **`attestation-ui.e2e.test.ts`'s criterion case still passes** — because
it pins its peers to a Node-held key the tab cannot sign for, so `chainsForOwner` correctly
answers `null` and the dispatch is unchanged. **That case did not redden, and per its own
docblock it was supposed to.** The docblock predicted *"the day a chain is wired here, the
`failures` assertion below reddens"* — it does not, and the reason is this file: the chain is
wired and that fixture's owner is unreachable to it. The prediction was right about the
mechanism and wrong about which fixture would show it.

_Measured 2026-08-20 · the two-tab reading is the whole finding; the rest follows from it_
