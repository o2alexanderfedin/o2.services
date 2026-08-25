# Research Summary — v2.0 "Open the Doors"

**Project:** o2.services — P2P Native Cloud
**Milestone:** v2.0 "Open the Doors" (phase numbering continues from **29**; the 28 existing
phase directories belong to v1.1 and are untouched)
**Researched:** 2026-08-25
**Confidence:** MIXED, stated per finding below — HIGH wherever a claim traces to this
project's own measured consults or a `file:line`, MEDIUM/LOW where research relied on
WebSearch synthesis or a single self-report.

This document synthesizes `.planning/research/v2.0/{STACK,FEATURES,ARCHITECTURE,PITFALLS}.md`
against `.planning/PROJECT.md`'s v2.0 milestone block and the two 2026-08-24 consults
(`2026-08-24-cloudflare-as-a-fabric-node-measured.md`,
`2026-08-24-owner-ruling-cloudflare-node-shape.md`). It does not re-derive anything already
settled by owner ruling; it records those rulings as fact and builds forward from them.

---

## 1. What v2.0 is

v2.0 opens the fabric — until now measured only on one machine, over loopback, the memory
transport, and Playwright contexts — to a real, worldwide public cohort: a few hundred
volunteer testers recruited from Telegram, spread across countries and continents
(`.planning/PROJECT.md:49-64`). The missing ingredient was never hardware; it was somewhere to
send them, and a way to be reachable once they arrived. That "somewhere" is a new, third,
always-on hosted tier — Cloudflare Workers/Durable Objects — measured on 2026-08-24 doing three
jobs a browser mesh structurally cannot do for itself: serving as an always-reachable, dialable
libp2p peer over WSS with a persisted identity; running as a working Circuit Relay v2 server for
the browser↔browser WebRTC SDP handshake; and holding a DHT record store with real (if not yet
built) expiry (`.planning/consults/2026-08-24-cloudflare-as-a-fabric-node-measured.md` §7, §9,
§13; `.planning/PROJECT.md:54-56`). It explicitly does **not** execute tasks — runtime WASM
compilation is refused by the platform (`CompileError: Wasm code generation disallowed by
embedder`, measured on every entry point), and the owner ruled a Cloudflare-hosted node simply
omits the execution capability from its published record rather than working around the
refusal (`2026-08-24-cloudflare-as-a-fabric-node-measured.md` §1;
`2026-08-24-owner-ruling-cloudflare-node-shape.md` §1).

Around that hosted tier, v2.0 adds everything a real public run needs and the browser-only
system never had to have: two fallback rungs below WebRTC (TURN, then a relayed connection),
entry conditions for a public cohort (consent, an always-on indicator, a provable stop control,
a redeploy-free kill switch, and telemetry), and the public run itself — the event that produces
the fabric's first genuine scaling curve, its first real WebRTC failure rate by country and
network class, and its first diurnal churn curve (`.planning/PROJECT.md:73-76`). Four items ride
along from v1.1 (`BENCH-06`, `NET-03`, `AOT-03`, `AOTW-06`) rather than opening new work
(`.planning/PROJECT.md:78-81`).

**Settled, not re-litigated:** open source with monetization for commercial use added later, no
CLA (`.planning/PROJECT.md:246-269`, ruling 2026-08-24); disclosure closed twice over (public
repo since 2026-07-26, plus the open-source ruling); multi-region from the start —
`bootstrap-us`, `bootstrap-eu`, `bootstrap-sam`, explicitly temporary; TURN plus a relayed
connection as the two fallback rungs; one identity per Durable Object (`idFromName()` resolves
to a single global instance — proved twice, accidentally via the relay's in-memory reservation
store and directly via a 599-of-600 fan-in with an unmoved constructor timestamp,
`2026-08-24-cloudflare-as-a-fabric-node-measured.md` §18).

---

## 2. Recommended stack decisions

**New workspace package, not an extension of `packages/node`.** `ARCHITECTURE.md` §1 makes this
the load-bearing structural decision: `packages/browser` and `packages/node` are already two
separate top-level assembly files sharing `packages/core`/`packages/net`/`packages/libp2p`
primitives, not one class parameterised by environment — so the Cloudflare tier is a **third**
assembly file in a **third** package, `packages/cloudflare/`, not a branch inside
`fabric-node.ts` (`ARCHITECTURE.md:47-79`).

**Dependency pins that matter (all checked live 2026-08-25):**

| Package | Version | Role |
|---|---|---|
| `wrangler` | `4.125.0` | Bundler + deploy/config CLI. Use the `alias` field in `wrangler.jsonc` to redirect `ws` to a no-op module — **do not** set `--conditions` globally, it drags a CJS `ws` in through `@libp2p/websockets` and Cloudflare rejects the *upload* at deploy time with an error that names neither the package nor the cause (`STACK.md:32-53`, confirmed by `2026-08-24-...-measured.md` §8's "one bundling trap"). |
| `workerd` | `1.20260825.1` | Local dev runtime — but every load-bearing claim in this research was checked against a real deploy, never `wrangler dev` (`STACK.md:29-31`; both consults' opening lines). |
| `libp2p` | `3.3.6` (v1's pin, reused) | Same version runs unmodified in the Worker after three shims (below). |
| `@chainsafe/libp2p-noise` | `17.0.0` (v1's pin, reused) | Already ships a `browser` field mapping the Node `diffieHellman` call to pure-JS X25519 — the fix is a bundler resolution override for **this one package**, not a hand-written shim (`STACK.md:60-70`; `ARCHITECTURE.md:130-140`). |
| `@libp2p/circuit-relay-v2` | `4.2.9` (v1's pin, reused) | `circuitRelayServer()` measured working on a Durable Object — its own README's "will not work in browsers" is about browsers, and a Worker is not a browser (`ARCHITECTURE.md:84-91`). |
| `interface-datastore` / `datastore-core` | `10.0.1` / `12.0.1` | Template only — **no published package binds `interface-datastore` to Durable Object storage.** Build a small hand-written class following this project's own `packages/node/src/fs-datastore.ts`, the same way that file itself chose `node:fs` over a generic async datastore after a generic one (`datastore-level`) once hung the enrollment RPC for a week (`STACK.md:225-262`). |
| `@libp2p/webrtc` | `6.0.30` current (v1 pins `6.0.27`; re-verify before bumping) | `WebRTCTransportInit.rtcConfiguration` accepts a plain `RTCConfiguration` **or a function returning one** — read directly from the package's `.d.ts`, not a blog post — which is the mechanism for short-lived TURN credentials (`STACK.md:156-181`). |

**What NOT to use / build:**
- **No general Node-shim package** (`unenv`, browserify-style polyfills) for the workerd gaps.
  The failure surface is exactly three specific gaps (`process.versions`, `BroadcastChannel`,
  `node:crypto.diffieHellman`), already fixed with ~20 lines total in the consult
  (`STACK.md:85-88`).
- **No published libp2p-for-workerd adapter** (`cf-libp2p-ws-transport@2.0.5`) — it targets a
  plain Worker, not a Durable Object, and a plain Worker has no stable identity (three
  consecutive requests returned three different PeerIds, `2026-08-24-...-measured.md` §7); it
  is also a year stale against this project's pinned libp2p v3 interfaces (`STACK.md:127-150`).
- **No self-hosted coturn, no Twilio/Xirsys/Metered** for TURN — see the open question in §6
  below; STACK.md recommends Cloudflare Realtime TURN specifically to avoid a second vendor
  relationship and a second always-up server this project's whole hosted-tier decision was
  meant to avoid (`STACK.md:192-221`) — **but note the contradiction with ARCHITECTURE.md flagged
  in the closing report below.**
- **No feature-flag SaaS or self-hosted feature-flag server** (LaunchDarkly, Split, Unleash,
  Flagsmith) for the kill switch — it is one boolean, read rarely, and Workers KV's free tier
  already covers it (`STACK.md:308-338`).
- **No Google Analytics, Mixpanel, Amplitude, Segment, or Sentry SaaS** for telemetry — all five
  set persistent cross-session identifiers and/or retain raw IP by default, the opposite of what
  a privacy-respecting volunteer telemetry beacon needs (`STACK.md:281-288`).

---

## 3. Architecture: the hosted tier's three roles, the one it cannot serve, and where the tiers meet

**Three roles, measured working on one Durable Object:**
1. **Dialable libp2p peer over WSS**, identity persisted in DO storage and stable across
   eviction — a plain Worker cannot do this (no stable identity across requests), a Durable
   Object can (`2026-08-24-...-measured.md` §7, §9).
2. **Circuit Relay v2 server** — peer A reserved a slot, peer B reached A **only through it**,
   verified A's PeerId, pinged in 54 ms (`§13`). This is the role the browser tier structurally
   cannot supply itself: a publicly reachable relay for the WebRTC SDP handshake.
3. **DHT record store with (planned) exact expiry** — DO storage is durable by construction
   (unlike the browser's evictable IndexedDB or the Node tier's ephemeral-in-practice
   filesystem), so it needs a sweep the other two tiers never needed (§4).

**The one role it cannot serve: execution.** Runtime WASM compilation is refused on every entry
point (`CompileError: Wasm code generation disallowed by embedder`), and
`WebAssembly.instantiateStreaming` does not exist there at all — a V8 embedder flag, the same
one that disables `eval`, with no plan or quota that turns it on. The owner ruled the
Cloudflare-hosted node simply omits the execution capability from `NodeRecords.capabilities`
(`packages/core/src/discovery.ts:414`), so the scheduler never learns Cloudflare exists as
anything but an ordinary, capability-limited participant — this closes the compute leg by
choice, not by deferral, and also removes the V8 code-cache path for anything hosted in a
Worker (`ARCHITECTURE.md:39-44,93-96`; `2026-08-24-...-measured.md` §1;
`2026-08-24-owner-ruling...md` §1).

**Where the tiers meet:**
- **Browser tier** (`packages/browser/src/browser-node.ts`) listens on `['/p2p-circuit',
  '/webrtc']` and dials the hosted tier's WSS address to reserve a relay slot and reach the DHT.
- **Node tier** (`packages/node/src/fabric-node.ts`) is unmodified and not reused as a template
  for the Cloudflare tier beyond the *pattern* its file-per-environment structure already
  established — its `FsDatastore`/`FsBlockstore`/AOT execution machinery is Node-only and
  irrelevant to a Worker (`ARCHITECTURE.md:63-96`).
- **What's shared unmodified across all three tiers**, because it never touched a platform
  primitive: `packages/core` (`NodeRecords`, `CapabilityRecord`, `NodeCertificate`,
  `verifyCapabilityRecord`), `packages/net` (`rpc.ts`, `protocol.ts`, `rendezvous.ts` — each
  documented in its own file as "pure module — no platform imports"), and most of
  `packages/libp2p` (`dht-record-index.ts`, `dht-registration.ts`, `constants.ts`,
  `relay-admission.ts`, `relay-service.ts`) (`ARCHITECTURE.md:99-111`).
- **What breaks and how it's patched — three gaps, three different remedies, on purpose:** a
  global-scope shim for `process.versions`/`BroadcastChannel` (platform gaps, not resolution
  problems); a per-package bundler-condition override for `@chainsafe/libp2p-noise`'s
  `diffieHellman` call (a resolution problem, not a platform gap — unverified whether
  wrangler's `alias` can target one deep file inside a package, see open question 1 below); and
  a Durable Object alarm replacing every `setTimeout`-driven loop (`startCertificateRenewal`,
  provider-record reprovision), because `Date.now()` does not advance without I/O between
  requests (`ARCHITECTURE.md:112-156`; `2026-08-24-...-measured.md` §2, §8).
- **Multi-region identity is addressing, not provisioning.** `bootstrap-us`/`-eu`/`-sam` are
  three distinct Ed25519 identities in three distinct Durable Objects, each persisted in that
  object's own DO storage exactly as `FabricNode`'s node key is today
  (`packages/node/src/fabric-node.ts:1947`). A Cloudflare **Worker** (not a Durable Object —
  Workers run at the edge PoP nearest the visitor, DOs are pinned to one datacenter) fronts all
  three and picks the nearest region from `request.cf.continent`/`.colo`, following the same
  "derive from the request, don't hardcode" shape `packages/node/src/seed-server.ts`'s
  `/bootstrap.json` already uses (`ARCHITECTURE.md:282-312`).

---

## 4. Feature set

### Conditions of entry — the literal gate on the first Telegram invite (must all exist before it is sent)

Every named precedent in this domain (Coinhive, The Pirate Bay, Showtime/CBS,
BrowseAloud/ICO.gov.uk) has the same shape: CPU was used without telling the visitor, a third
party discovered it, and the discovery cost far more trust than the CPU-cycles ever earned
(`FEATURES.md:22-32`). The gate, in priority order (`FEATURES.md:140-153`):

1. **Explicit opt-in before a single CPU cycle** — must block *before the WASM fetch*, not just
   before execution; fetching alone can look like preparation-to-mine to a reviewer reading
   network traffic.
2. **A persistent, unmissable "this tab is computing" indicator**, visible even when the tab is
   unfocused (tab-title glyph, not just page-body content).
3. **A stop control that provably drops CPU to zero** — hard interrupt (`Worker.terminate()`
   class), not cooperative "stop accepting new tasks while an in-flight one keeps running."
4. **Plain-language disclosure** of what runs, whose task, what leaves the device (this
   project's sovereignty guarantee is a selling point here, not a caveat), and what telemetry is
   sent — shown *before* opt-in.
5. **A kill switch operable with no redeploy**, scoped at minimum to "stop admitting new tasks
   cohort-wide," ideally to region/version slices.
6. **A minimal status page**, even a static read-view over existing DHT/benchmark data.
7. **A rough data-cost disclosure** alongside the CPU disclosure, for the mobile-data subset of
   an international cohort.

### Everything else (differentiators — can follow within the same milestone)

A personal, non-competitive contribution counter; a "what did my machine do, and for whom" view
with real per-task detail; automatic low-power-mode pause as a stated *preference* (not silent
Battery-Status-API detection — Firefox removed that API in 2016 specifically as a fingerprinting
vector, and Safari never shipped it); staged/regional rollout of the cohort rather than an
all-at-once invite; and a plain, named "why this isn't cryptomining" explainer
(`FEATURES.md:68-86`).

### Rejected anti-features, with reasons — so nobody re-proposes them

| Anti-feature | Why rejected |
|---|---|
| **Leaderboards / team rankings** | `PROJECT.md` excludes reputation *markets* outright; a competitive leaderboard is a soft version of the same thing and invites gaming (fake nodes, unattended always-on scripts left running purely to rank). |
| **Any payment/token/"earn crypto" framing** | Out of scope per `PROJECT.md`; browser compute demonstrably cannot be paid (Coinhive's largest operators earned single-digit dollars over months); reintroduces the exact reputational shadow this project needs distance from. |
| **Attentiveness-adaptive intensity ramping** ("ramp up when the user probably isn't looking") | This is *precisely* the cryptojacking evasion pattern documented in the wild (arXiv:1808.09474) — behaviorally indistinguishable from malware regardless of intent, and would be flagged by the same antivirus/ad-blocker heuristics that killed Coinhive. |
| **A single global on/off switch with no regional/cohort-slice granularity** | One bad region would take the whole cohort offline for volunteers whose region was never affected. |
| **A native app / browser extension / elevated-permission install** | Defeats the project's own core value ("every visitor to a web page is a potential compute node") and, ironically, reads as *more* suspicious to a security-conscious volunteer than an in-tab consent click. |

Rejected also, per `PROJECT.md`'s Out of Scope list and unaffected by this milestone:
incentives/payments/staking (§3.8), TEE backbone, native microVM execution, key-partitioned
all-to-all shuffle.

**Two structural framings to carry forward, not soften into ordinary UX advice:**
- The hosted tier becoming load-bearing (the fabric stops being P2P in practice while every doc
  still calls it P2P) is the **median outcome** for hosted-relay P2P systems, evidenced by IPFS's
  own measured cloud reliance (arXiv:2309.16203) and Matrix's homeserver-dominance pattern. This
  is a structural risk requiring two dashboarded counters (P2P-carried vs. relay-carried
  connection-seconds) and a scheduled relay-kill drill, not a one-time design review
  (`PITFALLS.md:24-71`).
- A Telegram-recruited cohort of a few hundred is **spendable exactly once** — SETI@home's move
  to BOINC lost roughly half its ~600,000 volunteers to added platform complexity alone, with no
  bug and no bad actor. The conditions-of-entry gate above is a go/no-go checklist for sending
  the recruitment message, not a nice-to-have (`PITFALLS.md:595-643`).

---

## 5. Pitfalls mapped to the phase that must handle each

| # | Pitfall | Phase to address | Verification |
|---|---|---|---|
| 1 | Hosted tier becomes load-bearing by default, silently | Multi-region relay phase + public-run phase | Two-counter P2P/relayed split reported from day one; a scheduled relay-kill drill shows bounded, measured degradation, not silent outage |
| 2 | Durable Object alarm loop with no reschedule guard — one self-reported incident (**Hacker News, `thewillmoss`, 2026-04-16, 31 points, 4 comments — self-report, "no billing response yet"**; the bill was for ~930B row reads/day, not alarm count, multiplied by 60+ preview deployments) | Record-expiry phase | `getAlarm()` checked before every `setAlarm()`; minimum reschedule interval enforced; **billing alert configured before the first Durable Object is deployed** (Cloudflare's own alerts are "informational only... does not cap your usage" — no hard ceiling exists) |
| 3 | Cost from held sockets (duration billing), not from messages | Inbound-listener phase + entry-conditions phase | Hibernation-aware listener shipped; the stop control verified to drop *duration billing* to zero, not only CPU |
| 4 | Storage grows without expiry if the sweep ships after persistence | Record-expiry phase | Sweep observed running against real (not synthetic) records **before** persistence ships to the public cohort |
| 5 | Inbound listener silently caps at 5 connections/sec once real concurrency arrives | Inbound-listener-correctness phase | Integration test with **more than 5** concurrent distinct simulated client addresses (1–2 peers cannot surface this bug by construction) |
| 6 | Relayed fallback assumed symmetric at 128 KiB; it is 64 KiB each way | TURN/relay-fallback phase | Protocol spec states the 64 KiB/direction budget explicitly; a boundary test in CI exercises the relayed path, not just direct WebRTC |
| 7 | Cold fan-out through the Cloudflare gateway path exceeds the 50-subrequests-per-invocation cap (cumulative, non-refundable on close; reuse on an open socket is free) | Gateway/routing phase, if built — recommend scoping out of v2.0 unless a connection-pool design is already budgeted | Fan-out load-tested against the 50-per-invocation cap; warm connection pool design reviewed |
| 8 | Unmeasured public failure rate — no published number exists for "what fraction of a general audience cannot participate"; proxy bounds only (10–20% relay-required industry guidance; 70%±7.1% DCUtR hole-punch success / ~30% relay fallback / 11% symmetric-NAT from a *different* protocol, arXiv:2510.27500) | Entry-conditions phase + public-run phase | The six-stage connectivity funnel (page load → consent → WSS to bootstrap → ICE gathering → connection classified → first task executed) instrumented and reporting live **before** recruitment |
| 9 | Cross-continent pairs concentrate exactly where TURN is absent | TURN/relay-fallback phase | TURN sharded to match the bootstrap regions; credential rotation and open-relay hardening verified before the public run |
| 10 | Telegram's in-app browser (WebView) is not the volunteer's real browser — may suspend JS on backgrounding, may diverge on IndexedDB (MEDIUM confidence, general WebView pattern; Telegram's specific current behavior was **not found in a single authoritative current source** and must be verified directly) | Entry-conditions phase | In-app-browser detection + "open in real browser" interstitial verified against **real Telegram links on both iOS and Android** before recruiting |
| 11 | Telemetry produces only anecdotes (under-collection) or collects raw IP/device fingerprints without a stated legal basis (over-collection, real GDPR precedent cited) | Entry-conditions phase | Telemetry schema designed backward from the three headline questions (scaling curve, WebRTC failure rate by country/network class, diurnal churn) and frozen before recruitment; explicit opt-in, aggregate-only, raw IP discarded at collection |
| 12 | Spending the volunteer community on a run that was not ready | Entry-conditions phase (go/no-go gate) | Staged rollout plan exists; kill switch and stop control independently verifiable by the volunteer (not just internal telemetry) before full recruitment |
| 13 | Open-source-now/monetize-later relicensing backlash (Terraform→OpenTofu, Redis→Valkey, Elastic→OpenSearch — three dated precedents, same shape) | Recruitment-messaging (this milestone) — communications, not code | Public copy does not overstate a permanent "always open" promise the later monetization ruling would contradict |
| 14 | No-CLA + unsolicited drive-by PRs risk copyright-provenance taint on the sole-authorship relicensing plan | Documentation, any point in this milestone | CONTRIBUTING.md states explicitly: PRs are triaged, never merged; fixes are implemented independently from the reported issue, never the diff |

---

## 6. Open questions — carry forward as open, each changes a requirement

1. **Can wrangler's `alias` redirect one deep file inside `@chainsafe/libp2p-noise`, or whole
   packages only?** This is the fix for the `diffieHellman` gap. `STACK.md` documents `alias`
   working at whole-package granularity (its own example: pointing `node-fetch` at a no-op) but
   states plainly this specific case — redirecting *one file inside* a dependency — "is not
   verified in this pass." **Settled by:** a real build test against the pinned
   `@chainsafe/libp2p-noise@17.0.0`, before specifying it in a plan as "just add an alias line"
   (`STACK.md:58-70`).
2. **Is Workers KV's ~60s global propagation acceptable for the kill switch, or must the
   push-over-open-socket path ship in the same phase?** `STACK.md` recommends building the cheap
   KV-polling version first and layering a Durable Object broadcast only if the sub-minute window
   proves unacceptable in practice. **Settled by:** whether "a stop control that provably drops
   CPU to zero" is read as node-local (the client checks its own flag — matters more, per
   `STACK.md`) or as a global propagation-latency requirement (`STACK.md:308-333`).
3. **Telemetry consent: consent vs. legitimate interest under GDPR — contested across sources,
   not merely unresolved.** WebSearch results disagreed with each other on whether IP-based
   analytics needs consent or can rely on legitimate interest. **Settled by:** legal review, not
   engineering judgment — the engineering recommendation (piggyback telemetry consent on the
   same CPU-use consent gate rather than a second banner) is explicitly a design recommendation,
   not a compliance ruling, and is flagged for legal review before shipping (`STACK.md:290-304`).
4. **Where does TURN run?** Unmeasured in both 2026-08-24 consults. **Settled by:** a dedicated
   research spike, per `ARCHITECTURE.md` — this is the item where the four research files
   disagree with each other; see the contradiction called out below.
5. **Does Telegram's in-app WebView kill sessions on backgrounding, and does it diverge on
   IndexedDB/WebRTC?** MEDIUM-confidence general WebView pattern; Telegram's own current
   behavior was not found in an authoritative current source. **Settled by:** opening the actual
   recruitment link from a real Telegram message on both iOS and Android, before recruiting
   begins — cheap to check, expensive to get wrong at cohort scale (`PITFALLS.md:495-540`).
6. **`DEMO-04`'s guard still passes but its stated rationale (disclosure) is now spent** — the
   project is open source, so the irreversible-legal-event reason the guard existed for no
   longer applies. Retire it, repurpose it as an ordinary "no accidental deploys" rule, or keep
   it as written is an **open decision**, not a rule (`PROJECT.md:225-232`). `ARCHITECTURE.md`
   §7 already treats "building `packages/cloudflare/`'s source" as distinct from "deploying it"
   under the guard's own logic, and recommends keeping deployment a manual, disclosure-guarded
   act regardless of how this decision resolves.

---

## 7. Carried items and how they fold in

Four items ride along from v1.1 without opening new work streams:

- **`BENCH-06`** — becomes the v2.0 public run's headline experiment: the real scaling curve
  taken on independently-owned devices is the number this whole milestone exists to produce.
- **`NET-03`** — closed by a route it was not designed for. `NET-03` was blocked on AutoTLS
  needing a publicly reachable host and a public CA; on the Cloudflare path **that requirement
  does not arise rather than being satisfied** — Cloudflare terminates TLS with its own
  commercial certificate at the edge, and the libp2p node behind it never sees a certificate
  problem at all (`2026-08-24-...-measured.md`, "What this does to NET-03"). This does not fully
  close `NET-03` — it adds a second way to satisfy it and remains gated on the (now-resolved)
  disclosure decision.
- **`AOT-03` / `AOTW-06`** — a parallel track with a different skill surface; neither is helped
  by the new tier, because both need execution and execution is exactly what a Worker refuses
  by ruling (`PROJECT.md:78-81`).

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | MEDIUM-HIGH | Package versions and Cloudflare docs directly checked/fetched 2026-08-25 (HIGH); TURN/KV/Analytics-Engine *pricing* figures are WebSearch synthesis of vendor pages, not independently re-fetched in full (MEDIUM); the `alias`-at-one-file-depth question is explicitly unverified. |
| Features | MEDIUM-HIGH | Consent/trust findings (Coinhive, BrowseAloud, Pirate Bay) rest on multiple corroborating named incidents plus a still-operating precedent (AuthedMine) — HIGH. Browser-throttling mechanics rest on official Chrome engineering blogs — HIGH for Chrome, explicitly unverified for Firefox/Safari. Operator-tooling specifics (kill-switch/staged-rollout precedent) lean on general SRE practice, not a named volunteer-computing source — LOW-MEDIUM, stated as a gap. |
| Architecture | HIGH | Every claim traces to a `file:line` in this repo or a numbered section of the 2026-08-24 measured consult; proposals are explicitly marked PROPOSED rather than presented as fact. |
| Pitfalls | MIXED | HIGH where backed by this project's own measured consult or a well-documented incident (Matrix, IPFS cloud-reliance study, Cloudflare's own billing docs); explicitly LOW for the $34,895 alarm-loop figure (one person's self-report, no billing confirmation) and for the general-population WebRTC failure-rate numbers (no published figure exists for this exact question; proxy bounds only, stated as proxies). |

**Overall confidence:** MEDIUM-HIGH. The core technical claims (what a Durable Object can do,
what breaks and why) are unusually well-grounded for research of this kind, because they trace
to this project's own measured, deployed probes rather than to documentation or blog posts.
The softer claims (TURN pricing, general-population connectivity rates, GDPR consent-vs-legitimate-interest,
Telegram WebView behavior) are consistently and explicitly flagged as such across all four
files, rather than smoothed into false confidence.

### Gaps to address during planning

- **TURN hosting** — see open question 4; also the clearest cross-file disagreement (below).
- **Telegram in-app WebView behavior** — verify directly before recruiting (open question 5).
- **GDPR legal basis for telemetry** — flagged for legal review, not resolved by this research
  (open question 3).
- **No named precedent for "staged/regional rollout of a volunteer compute cohort"** — the
  recommendation is inferred from general release-engineering practice, not a BOINC/Folding@Home
  source (`FEATURES.md:235-240`).
- **Firefox/Safari background-tab Worker throttling** — Chrome's is well-documented by its own
  engineering blog; Firefox/Safari were not independently verified and should be measured with
  this project's own existing Playwright multi-browser harness rather than trusted from search
  (`FEATURES.md:241-245`).
- **Whether keep-alive traffic can hold a non-hibernatable socket open indefinitely** — the
  remaining, still-unmeasured half of the hibernation question; decides whether the bootstrap
  role is cheap or expensive at scale (`2026-08-24-...-measured.md`, "Still unmeasured").
- **Why the relay's duration limit was not observed while the data limit was enforced exactly**
  — both readings reproduced twice, neither explained (`ARCHITECTURE.md:384-390`;
  `2026-08-24-...-measured.md` §15).

---

## Sources

Aggregated from the four v2.0 research files; each file's own Sources section carries the full
list with confidence markers. Highlights load-bearing for this synthesis:

- `.planning/consults/2026-08-24-cloudflare-as-a-fabric-node-measured.md` — primary measured
  source for everything the hosted tier can and cannot do; every section cited above by number.
- `.planning/consults/2026-08-24-owner-ruling-cloudflare-node-shape.md` — the three rulings this
  synthesis treats as settled fact (no execution advertised; one identity per object; expiry is
  sweep + read-time check, not alternatives).
- `.planning/PROJECT.md` — v2.0 milestone scope (`:49-96`), Constraints (`:202-245`), Key
  Decisions (`:246-275`).
- `npm view <pkg> version / time.modified / deprecated / dependencies`, checked live 2026-08-25
  for every package version cited in §2.
- [Cloudflare Durable Objects — Data location](https://developers.cloudflare.com/durable-objects/reference/data-location/),
  [Cloudflare Realtime — Generate credentials](https://developers.cloudflare.com/realtime/turn/generate-credentials/),
  [Cloudflare Workers — Wrangler configuration](https://developers.cloudflare.com/workers/wrangler/configuration/),
  [Cloudflare Durable Objects Alarms blog](https://blog.cloudflare.com/durable-objects-alarms/),
  [Cloudflare Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing) — fetched/read directly 2026-08-25.
- [Hacker News — Durable Object alarm loop, $34,895/8 days](https://news.ycombinator.com/item?id=47787042) — single self-report, 31 points/4 comments, "no billing response yet"; treated throughout as reported, not audited.
- [The Cloud Strikes Back (arXiv:2309.16203)](https://arxiv.org/pdf/2309.16203) — IPFS cloud-reliance precedent.
- [Challenging Tribal Knowledge (arXiv:2510.27500)](https://arxiv.org/pdf/2510.27500) — DCUtR hole-punch/symmetric-NAT measurement, a different protocol used as a directional proxy only.
- [Matrix.org — Why the Matrix.org Homeserver Exists](https://matrix.org/blog/2024/03/why-matrix-org/).
- Named cryptojacking/consent incidents (BleepingComputer, The Register, TechCrunch, WeLiveSecurity) and BOINC/Folding@Home primary sources — full list in `FEATURES.md`'s and `PITFALLS.md`'s own Sources sections.
- HashiCorp/Terraform, Redis/Valkey, Elastic/OpenSearch relicensing-backlash reporting — full list in `PITFALLS.md`'s Sources section.

---
*Research completed: 2026-08-25*
*Ready for requirements definition: yes, with the six open questions in §6 carried forward explicitly*
