---
phase: phase-29-hosted-tier-assembly-and-first-deploy
reported: 2026-08-26
status: partial
score: >-
  3 of 7 criteria MET (3, 4, 6 — and 5 within what a build can see). Criteria 1 and 2 are
  OWNER ACTS at the Cloudflare boundary and stay OPEN by the ruling of 2026-08-25; criterion 7
  is met as a REPORT, which is what it asks for. Nothing here is ticked on locally-done work.
  **One finding in this report was RETRACTED the day it was written — see finding 1.**
---

# Phase 29 — Hosted Tier Assembly & First Deploy

**This is a report, not a SUMMARY**, because there is no PLAN. Phase 29's work landed outside
the plan-phase workflow — criterion 3 on 2026-08-25 and everything else on 2026-08-26 — and a
`*-SUMMARY.md` beside no plan would make the tooling read a plan as executed.

## The criteria, one line each, with the honest verdict

| # | Criterion | Verdict |
|---|---|---|
| 1 | Billing alert configured **before** the first object exists | **OPEN — owner act.** Not attempted. |
| 2 | An outside peer dials the object twice and gets the same PeerId | **OPEN — owner act.** The identity half is built and tested; no listener is written, and see the retraction below for why that is work rather than a blocker. |
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

## Three measured findings — one of which the research DID contain, and I did not read

**The heading of this section read *"three measured findings this phase's own research does not
contain"* until the owner corrected finding 1.** Two of the three are new. The first was not:
it is covered in `STACK.md`, `ARCHITECTURE.md` and `PITFALLS.md`, and reading them would have
prevented both the wrong conclusion and the two hours it stood.

**1. The inbound listener cannot be written against the pinned transport.** The 2026-08-24
consult §9 gives it as `server.accept()` → `webSocketToMaConn()` → `upgrader.upgradeInbound()`
and calls it "about forty lines [needing] no new transport". Measured 2026-08-26 against
`@libp2p/websockets@10.1.17`:

```
Object.keys(await import('@libp2p/websockets'))              ->  ['webSockets']
import('@libp2p/websockets/dist/src/websocket-to-conn.js')   ->  ERR_PACKAGE_PATH_NOT_EXPORTED
```

The package's `exports` map declares `.` and `./filters` and nothing else.

> **RETRACTED THE SAME DAY, AND THE RETRACTION IS THE FINDING.** The conclusion drawn from the
> two lines above — that the listener "cannot be written as it stands" — was **wrong**, and it
> reached five documents before it was caught. `ERR_PACKAGE_PATH_NOT_EXPORTED` is **Node's**
> ESM resolver refusing a PACKAGE SPECIFIER. `exports` is consulted only for package
> specifiers; a **file path** does not go through it at all. Three wrangler builds settled it:
>
> | import form | result |
> |---|---|
> | `@libp2p/websockets/dist/src/websocket-to-conn.js` | esbuild: *"Could not resolve"*, exit 1 |
> | the same file **by path** | **exit 0, 153.30 KiB, `webSocketToMaConn` ×3 in the bundle** |
>
> So the function is reachable and the listener is writable today. The error was to measure
> Node's resolver and conclude about wrangler's — and, worse, to do it without reading the
> research that already covers this ground. `.planning/research/v2.0/STACK.md:146` says the
> listener *"is already measured working against the exact pinned versions this project runs …
> it is already built"*, and `ARCHITECTURE.md:484-506` names its four requirements. The owner's
> one-line correction — *"look in the code, we ran a series of experiments before deciding"* —
> is what surfaced it.
>
> **What is genuinely open is what that research already said was open**, and the roadmap
> already owns it: `direction: 'inbound'` (§14), `remoteAddr` from `CF-Connecting-IP` (§19),
> an explicit `bufferedAmount` (§16), and a **hibernation-aware** socket (§17) — called there
> *"the largest genuinely-new engineering item on this tier"*. Three of the four are **Phase
> 30 — Inbound Listener Correctness & Hibernation**. Phase 29's share is a minimal listener,
> and it is not written; it is not blocked either.

**2. The open-question-1 guard would have been vacuous.** The consult instructs Phase 29 to
assert `diffieHellman` is absent from the emitted bundle. Written naively it passes today and
proves nothing — measured on the real bundle, `noise` appears **0** times, `pureJsCrypto` **0**
times, and the sourcemap lists **0** sources whose path contains "noise". The absence is the
whole package's, not the call's. The chain is that no listener is written yet → no `createLibp2p` → no
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

**Write the minimal listener**, which finding 1's retraction unblocks. It is not a decision any
more; it is work, and its recipe is measured in three documents. The one choice inside it that
IS a decision, and should be put to the owner rather than taken quietly: `webSocketToMaConn` is
reachable only by FILE PATH into `node_modules`, which is fragile — `.planning/consults/
2026-08-25-noise-diffiehellman-on-workerd-measured.md` §4 records a related trap where a
relative specifier collided across the whole dependency graph, silently, at build exit 0. A
small `MultiaddrConnection` adapter written here is the alternative, and it is what
`ARCHITECTURE.md:506` already scopes for the hibernation-aware case anyway.

Do NOT drop any of the four requirements. Each has a measured silent-failure mode: no
`direction: 'inbound'` and every stream is refused while the dial still looks fine; no
`CF-Connecting-IP` and the node rate-limits the entire internet to five connections a second.
