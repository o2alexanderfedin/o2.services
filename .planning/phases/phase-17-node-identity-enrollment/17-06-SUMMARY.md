---
phase: 17
plan: "06"
subsystem: browser-node-identity
tags: [AUTH-01, AUTH-02, browser, enrollment, identity, partition]
requires:
  - "@o2/libp2p identity.ts — identityFromSeed, generateSeed, peerIdForNodeKey (17-01)"
  - "@o2/core enrollment.ts — requestEnrollment, EnrollmentAuthority, verifyCertificate (17-02)"
  - "@o2/net enrol-client.ts — enrolOverRpc, UNREACHABLE_PROVIDER (17-03)"
  - "packages/node/src/peer-verifier.ts — PeerVerifier (17-04)"
provides:
  - "BrowserNodeOptions.whenSeedIsGone — the eviction decision, required with no default"
  - "BrowserNodeOptions.enrollment — same shape as FabricNodeOptions.enrollment"
  - "BrowserNodeOptions.issuesCertificates — a tab can be a provider"
  - "BrowserNode.certificate — a tab holds a provider-signed certificate"
  - "IdbIdentityStore — seed, provider key and certificate across reloads"
  - "the browser tier's index:/enroll: hooks, derived rather than sentinelled"
affects:
  - "packages/browser/src/browser-node.ts"
  - "packages/browser/demo/main.ts"
  - "packages/browser/src/capability-harness.ts"
tech-stack:
  added: []
  patterns:
    - "named-absence sentinel (`T | '<named-absence>'`) for a required decision with no safe default"
    - "a derived property computed from the listen list, never from node kind"
    - "an instrument read at both its values in one file before either is believed"
key-files:
  created:
    - packages/browser/src/idb-identity-store.ts
    - packages/node/src/browser-enrollment.e2e.test.ts
    - packages/browser/src/insecure-origin.browser.test.ts
  modified:
    - packages/browser/src/browser-node.ts
    - packages/browser/src/capability-harness.ts
    - packages/browser/demo/main.ts
    - packages/browser/src/start-unwind.browser.test.ts
    - packages/browser/src/browser-node-contract.node.test.ts
    - packages/node/src/browser-capability.e2e.test.ts
decisions:
  - "the seed lives in its own IndexedDB database, not beside the blocks, so a cache wipe cannot take the node's name"
  - "whenSeedIsGone is required with no default — a tab's storage is evicted silently, so the branch must be a decision"
  - "canRelay is derived from the listen list and the predicate is widened by /webrtc, which the Node tier's copy would misread as a bindable socket"
  - "PeerVerifier verified as portable but deliberately NOT moved — see Findings"
metrics:
  duration: "~35 min"
  completed: 2026-08-01
---

# Phase 17 Plan 06: A Browser Node Enrols On Identical Terms — Summary

**A browser tab now persists its own seed, derives its libp2p peer id from it, enrols
against a real provider and holds the certificate — and a Node peer started with
`--trusted-issuer` takes it as a block source, which it would not do before.**

## The regression this closes

17-VERIFICATION found that any node started with `--trusted-issuer` excluded **every**
browser peer from its block sources. `PeerVerifier` takes only peers whose certificate
verifies, and no tab could hold one. The fabric partitioned by tier, against the rule this
project has restated three times: *all nodes have equal functionality; the only difference
is discovery.*

17-04 was right that nothing branches on node kind. The cause was four *absences* in
`packages/browser/src/browser-node.ts`, and an absence partitions as effectively as a
branch while being much harder to see. All four are now present:

| Absent before | Now |
|---|---|
| no persisted seed | `IdbIdentityStore`, a database of its own |
| no `privateKey` at `createLibp2p` | `privateKey: identity.privateKey` |
| no `enrollment` option | same shape as `FabricNodeOptions.enrollment`, with `userPrivateKey` |
| `index:`/`enroll:` sentinels passed unconditionally | `records ?? …` and `authority ?? …` |

## The eviction decision, made explicitly

`BrowserNodeOptions.whenSeedIsGone` is **required, with no `?` and no default**, taking
`'mints-a-new-identity'` or `'refuses-to-start-without-its-seed'`. The reason and its cost
are written at the field and again at every call site.

The honest framing, recorded at the field: IndexedDB eviction is a *durability* difference
from a Node process's `blockstoreDir`, and it is the only one — delete that directory and a
`FabricNode` loses the identical three values. What differs is that a disk does not do it
while nobody is looking, so the branch an operator reaches by `rm` is one a tab reaches on
an ordinary Tuesday.

`demo/main.ts` chooses `'mints-a-new-identity'`, with the cost stated inline: a different
peer id, stale addresses in every peer that held the old one, and a certificate that its own
identity check then refuses. Both branches are measured (see the ledger below) — the
refusing one against a database nothing has ever written to, because the passing case for
`'refuses-to-start-without-its-seed'` would be satisfied just as happily with the whole
branch deleted.

## The partition instrument, observed at both values

`packages/node/src/browser-enrollment.e2e.test.ts` starts three real nodes — a provider
that issues, a gate that pins that provider as `trustedIssuers`, and a live Chromium tab —
and asks **the same gate, with the same pinned issuer,** about a tab twice:

| Reading | Instrument | Value |
|---|---|---|
| tab holds no certificate | `gate.verdictFor(tab)` | refused, `failure.kind === 'no-records'` |
| tab holds no certificate | `gate.verifiedPeers` | **does not contain** the tab |
| tab enrolled | `gate.verdictFor(tab)` | `ok` |
| tab enrolled | `gate.verifiedPeers` | **contains** the tab |

Both cases meet the gate identically — `dial` after start, not through `relayAddrs` — so
the exclusion cannot be explained by the meeting. The certificate is checked to name the
tab itself through `peerIdForNodeKey(nodeKey) === tabPeerId`, to carry the provider's
`issuerKey`, and to carry a `userKey` derived from the private key the tab was configured
with rather than one passed as a field.

## Mutation ledger — every reddening claim planted and watched

| # | Planted | Expected red | Observed |
|---|---|---|---|
| 1 | `index: records ?? …` → `index: 'serves-no-records'` (the pre-fix line) | the enrolled reading | **red**; the excluded reading stayed **green** — so the instrument discriminates rather than merely existing |
| 2 | delete `privateKey: identity.privateKey` | the enrolled reading and the reload reading | **both red**; the excluded reading and the refusal reading stayed green |
| 3 | `'refuses-to-start-without-its-seed'` against a never-written database | a refusal naming the store | **red-if-absent by construction**: the reading asserts the message contains both `no seed in o2-enrol-never-written-identity` and the policy name |

Both plants were restored with `cp` and confirmed byte-identical with `cmp` before the
green run. Nothing was reverted with git.

Ledger note on reading 3: it is what makes the *reload* reading load-bearing. Restarting
with `'mints-a-new-identity'` and finding the same peer id would be weak evidence; demanding
a refusal when the seed is absent makes a successful start itself the proof that stored
bytes were read.

## The insecure-origin branch, measured

17-01 recorded that a LAN `http://` origin has no `crypto.subtle`, that this had silently
changed every CID once, and that the branch was *"unmeasured — both vitest projects run on
a secure origin."*

`packages/browser/src/insecure-origin.browser.test.ts` takes it, in **chromium, firefox and
webkit**: seed generation, peer id derivation, both enrollment signatures, the provider's
signature and `verifyCertificate` all complete with `subtle` removed.

Two things that would have made this evidence worth nothing, both handled:

- **`delete crypto.subtle` removes nothing.** It is an accessor on `Crypto.prototype`, so
  the property must be shadowed as an own property. A file that got this wrong would
  measure a secure context while claiming otherwise. The first reading asserts the removal
  took effect and that it is put back, so the other two cannot pass by never having lost
  anything.
- **What is still not reproduced,** stated rather than glossed: `@libp2p/crypto` memoises
  Ed25519-over-WebCrypto support at *module load*, inside a `try/catch`, so a genuinely
  insecure origin memoises `false` where this memoises `true`. That direction is the safe
  one — `false` routes to noble, which is the path proved here — but closing it properly
  needs a vitest browser instance served over plain HTTP from a non-loopback address, which
  is a harness change and not a test.

## Findings

### `PeerVerifier`'s portability claim: half true, and it should not move

17-04 reported it is blocked from the browser tier only by packaging — *"a packaging fact
with a one-file fix"*. Verified before acting on it:

- **The portability half is true.** Its imports are `@o2/core`, `@o2/libp2p`, `@o2/net` and
  `@libp2p/interface`. No `node:` import, nothing Node-only. It would satisfy
  `purity.node.test.ts`'s `DUAL_TARGET` rules unchanged.
- **The one-file half is false.** `@o2/libp2p`'s dependencies are `@libp2p/crypto`,
  `@libp2p/interface`, `@libp2p/peer-id`, `@noble/curves`, `@o2/core` and `libp2p` — **it
  does not depend on `@o2/net`**, which `PeerVerifier` imports four symbols from. Moving it
  needs a new package dependency edge, barrel changes in two packages, and import updates
  in `fabric-node.ts` plus three test files. Six files, not one. (The edge itself would be
  acyclic and legal: `@o2/net` is `PORTABLE` and cannot import `@o2/libp2p` back.)
- **It should not move anyway, and this is the stronger reason.** Nothing in the browser
  tier consumes it: `BrowserNodeOptions` has no `trustedIssuers` field, so a moved
  `PeerVerifier` would be an export with no traced call path from a browser entry point —
  which is precisely what Phase 22's reachability guard is specified to fail on, cited in
  `fabric-node.ts`'s own comment beside `peerIdForNodeKey`.

**Left in place.** The move becomes correct when a browser node is given `trustedIssuers`,
and that is the plan that should make it.

### A real ordering defect, found and not fixed — needs an architectural decision

`PeerVerifier` settles a peer's verdict **once**, on `peer:connect`, and caches it. There is
no re-verification. That means:

> **A node that enrols *after* a peer has already connected to it is permanently excluded by
> that peer.**

Observed directly, not reasoned about. The first version of the e2e test passed the gate
through `relayAddrs`, which `BrowserNode.start` dials *before* `serveAgent` is called. The
gate asked the tab for records, nothing answered, and the request sat until the 30 s RPC
budget — the poll reported `'not asked yet'` at 20 s and the enrolled tab was never
verified, despite genuinely holding a valid certificate from the pinned issuer.

The test was changed to a faithful topology (the gate is dialled *after* start, as an
ordinary peer meets a running node), which is the right test either way. The underlying
defect is untouched and is **not browser-specific** — `FabricNode` dials its provider inside
`resolveCertificate`, also before `serveAgent`.

Not fixed here under **Rule 4**: every candidate fix changes when verification re-runs
across the whole fabric — retry refused verdicts on a schedule, expire them, re-verify on
`identify` completion, or make `index:` a thunk so a node can serve before it has records.
Each is a different answer about how much a node re-asks its peers, and that is a decision
about the protocol rather than a bug fix.

## Deviations from Plan

### Auto-fixed / adjusted

**1. [Rule 3 — Blocking] The worktree had no `node_modules`, and the obvious fix verifies the wrong tree**

- **Found during:** setup, as the inherited note warned.
- **Fix:** every top-level entry symlinked from the main install *except* `@o2`, which was
  rebuilt to point at this worktree's own `packages/`. Proved with
  `createRequire(...).resolve` before any verification was believed:
  `@o2/core`, `@o2/libp2p`, `@o2/browser`, `@o2/node` and `@o2/net` all resolve under
  `…/agent-a3090e2de9778c038/packages/`.
- **Committed:** no — `node_modules` is ignored, and the probe script was deleted.

**2. [Rule 2 — Missing critical functionality] `issuesCertificates` added to the browser tier**

- **Found during:** Task 2. The plan asked for the sentinels to stop being unconditional,
  plural. `index:` follows from holding a certificate; `enroll:` does not — it needs a
  provider signing key, and `BrowserNodeOptions` had no field for one.
- **Fix:** `issuesCertificates?: boolean`, mirroring `FabricNodeOptions`, with the key
  persisted in `IdbIdentityStore` so a tab that issues stays the same issuer across a
  reload. Leaving it out would have left exactly one capability a `FabricNode` has and a
  `BrowserNode` cannot — the shape this plan exists to delete.
- **Not measured:** no test issues a certificate *from* a tab. Recorded rather than
  claimed.

**3. [Scope boundary] `vocabulary.node.test.ts` fails on two pre-existing lines**

- Both in `.planning/phases/phase-17-node-identity-enrollment/17-VERIFICATION.md` (lines
  313 and 347), introduced by commit `f6a172b`, an ancestor of this plan's base. No file
  this plan touched contains either term. Logged to `deferred-items.md`, not fixed.

## Incorrect `file:line` citations found

| Cited in | Claim | Reality |
|---|---|---|
| this plan's prompt | `browser-node.ts:387` — `createLibp2p` with no `privateKey` | correct at the base commit (`:387`) |
| this plan's prompt | `browser-node.ts:622`, `:626` — the two sentinels | correct at the base commit |
| `CLAUDE.md` (stack notes) | `browser-node.ts:197` listens on `['/p2p-circuit','/webrtc']` | the listen list is right, the line is **`:389`** at this base, not `:197` |

No other citation relied on was wrong. Every one was re-grepped rather than trusted.

## Assertions weakened

None. One assertion was **strengthened**: the positive partition reading polls
`gate.verdictFor(...)`'s own name rather than `verifiedPeers` directly, so a failure reports
*which* refusal arrived instead of `expected [] to include …`. That change is what turned
the first failure from a restatement into the diagnosis recorded under Findings.

## Verification

| Check | Result |
|---|---|
| `npx tsc --noEmit` (repo root, resolver proven to read this worktree) | clean |
| `vitest run --project browser` | **216 files, 3207 tests passed** |
| `vitest run --project e2e` | **9 files, 44 tests passed** |
| `vitest run --project node` | 105 files passed, 2 skipped; **1 file failed** — `vocabulary.node.test.ts`, pre-existing, see Deviations |
| `browser-enrollment.e2e.test.ts` | 4/4, all four readings executing (verbose run, real per-test durations) |
| `insecure-origin.browser.test.ts` | 9/9 — three readings × chromium, firefox, webkit |

Load average was checked before each run and stayed between 3.5 and 14.5; neither
load-sensitive test (`transport-bounds`, `tools/aot/lift`) is in the affected set and
neither failed.

## Commits

| Hash | Message |
|---|---|
| `3775323` | feat(browser): a tab keeps its own name, and can be vouched for like anyone else |
| `c885271` | test(browser): the gate that excluded every tab, watched changing its mind |
| `227a972` | test(browser): the identity path, on an origin that has no WebCrypto |

## Known Stubs

None. `enroll: authority ?? 'issues-no-certificates'` is a named absence reached only when a
caller passed no `issuesCertificates`, not a placeholder.

## Self-Check: PASSED

All 11 files this summary names exist on disk. All three commit hashes are present in
`git log`. The one line-number correction it publishes was re-checked: the browser listen
list was at `browser-node.ts:389` at this plan's base commit `3e1c03e` (not `:197`, as
`CLAUDE.md` states), and is at `:686` after this plan's edits.
