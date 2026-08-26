---
phase: phase-29-hosted-tier-assembly-and-first-deploy
reported: 2026-08-26
status: partial
score: >-
  3 of 7 criteria MET (3, 4, 6 — and 5 within what a build can see). Criteria 1 and 2 are
  OWNER ACTS at the Cloudflare boundary and stay OPEN by the ruling of 2026-08-25; criterion 7
  is met as a REPORT, which is what it asks for. Nothing here is ticked on locally-done work.
---

# Phase 29 — Hosted Tier Assembly & First Deploy

**This is a report, not a SUMMARY**, because there is no PLAN. Phase 29's work landed outside
the plan-phase workflow — criterion 3 on 2026-08-25 and everything else on 2026-08-26 — and a
`*-SUMMARY.md` beside no plan would make the tooling read a plan as executed.

## The criteria, one line each, with the honest verdict

| # | Criterion | Verdict |
|---|---|---|
| 1 | Billing alert configured **before** the first object exists | **OPEN — owner act.** Not attempted. |
| 2 | An outside peer dials the object twice and gets the same PeerId | **OPEN — owner act**, and see the blocker below. |
| 3 | Durable Object storage reached through `interface-datastore`, carrying the identity and **no** DHT record | **MET** |
| 4 | Exactly one call site may obtain a stub; a second fails a guard | **MET**, plant watched red |
| 5 | A configuration that would create a preview deployment fails a guard | **MET**, plant watched red |
| 6 | The `idFromName()` name set is closed; no name from visitor input | **MET**, plant watched red |
| 7 | NET-03 reported as a **second route**, not a closure | **MET as a report** — `REQUIREMENTS.md`'s row re-stated 2026-08-26 and still not ticked |

## What was built

- `packages/cloudflare/src/hosted-identity.ts` — the seed persisted through `DoDatastore`, so
  a PeerId survives an eviction. The failure it answers is measured: a plain Worker returned
  three different PeerIds to three consecutive requests, each landing in a fresh isolate.
- `packages/cloudflare/src/hosted-object.ts` — `HostedNode` (the production construction of
  `DoDatastore`), the closed three-name enumeration, and `stubFor`, the one call site.
- `packages/cloudflare/src/worker.ts` — the deployed entry, and now the **sixth**
  `ENTRY_POINTS` module of the reachability walk.
- `packages/cloudflare/wrangler.jsonc` — the deploy configuration. Its two decisive keys were
  read out of wrangler's own `config-schema.json`, not out of documentation.
- `packages/cloudflare/src/hosted-identity.test.ts` (8 cases) and
  `packages/node/src/hosted-tier-deploy.node.test.ts` (9 cases).

## Three measured findings this phase's own research does not contain

**1. The inbound listener cannot be written against the pinned transport.** The 2026-08-24
consult §9 gives it as `server.accept()` → `webSocketToMaConn()` → `upgrader.upgradeInbound()`
and calls it "about forty lines [needing] no new transport". Measured 2026-08-26 against
`@libp2p/websockets@10.1.17`:

```
Object.keys(await import('@libp2p/websockets'))              ->  ['webSockets']
import('@libp2p/websockets/dist/src/websocket-to-conn.js')   ->  ERR_PACKAGE_PATH_NOT_EXPORTED
```

The package's `exports` map declares `.` and `./filters` and nothing else. Closing this needs
either a `MultiaddrConnection` adapter written in this repository or an upstream export. **It
is a decision, not an oversight, and it is the reason no listener was written**: forty lines
against an API that does not exist, on a platform this session cannot run, is the
structure-not-truth failure this milestone exists to remove.

**2. The open-question-1 guard would have been vacuous.** The consult instructs Phase 29 to
assert `diffieHellman` is absent from the emitted bundle. Written naively it passes today and
proves nothing — measured on the real bundle, `noise` appears **0** times, `pureJsCrypto` **0**
times, and the sourcemap lists **0** sources whose path contains "noise". The absence is the
whole package's, not the call's. The chain is finding 1: no listener → no `createLibp2p` → no
encrypter → no subject. The guard is written with that precondition and **skips loudly**,
flipping to a real reading the moment the assembly pulls noise in.

**3. The reachability register grew where it was predicted to shrink.** The 2026-08-25 note
said the three `do-datastore.ts` rows *"are expected to be REVERSED by wiring within the
milestone"* and that *"if Phase 29 closes with these three still here, that is a finding about
the phase."* The wiring they named landed and the rows did not move — because the second half
of that same row's sentence held: *"it closes when the node deploys and dials."* Nothing
deploys. The unreachable count went **74 → 80**, and the six new symbols joined the same
register rather than being dispositioned, which would have made the number look like wiring.

**That is a finding about the phase, recorded as one.**

## What a build can and cannot say about criterion 5

The guard reads the configuration and asserts `preview_urls: false` is stated rather than
inherited. What it cannot see is a deploy performed by hand with a flag. `DEMO-04`'s guard —
repurposed by the same 2026-08-25 ruling from *disclosure is irreversible* to *deploying a
paid tier does not happen by itself* — is what covers the CI half, by forbidding the workflow
to exist at all.

## Envelope

The only wrangler invocation in this repository is `deploy --dry-run --outdir=<scratch>` with
`WRANGLER_SEND_METRICS=false`. Measured: it needs **no authentication** and exits 0 on a
machine with no credential configured. The account carries **zero Durable Object namespaces**,
so nothing this phase built can wake or bill, and the owner's three production scripts are
untouched — the configuration is asserted not to contain their prefix.

## What the next session should do first

Not the listener. **Decide finding 1**: an adapter in this repository, or an upstream export.
Until that is decided, criterion 2 has no code path even after the owner deploys, and the
open-question-1 guard stays skipped.
