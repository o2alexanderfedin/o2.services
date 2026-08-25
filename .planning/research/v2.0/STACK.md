# Stack Research — v2.0 "Open the Doors"

**Domain:** always-on hosted tier (Cloudflare Workers/Durable Objects) + public-cohort
telemetry/control-plane additions to an existing, working P2P compute fabric.
**Researched:** 2026-08-25
**Confidence:** mixed, stated per finding. Every version below was checked live on
2026-08-25 via `npm view <pkg> version` / `time.modified`, or fetched from the vendor's
current docs — not recalled from training data. Where a claim rests only on WebSearch
snippets rather than an official doc or a direct package read, it is marked LOW and
should be re-verified before being load-bearing in a plan.

This file does **not** restate `CLAUDE.md`'s pinned v1 stack (`libp2p@3.3.6`,
`helia@7.1.1`, etc.) or anything already measured in the two 2026-08-24 consult
documents. It covers only what the five *new* v2.0 capabilities need, and it treats
every claim in those two consults as ground truth that documentation cannot overrule.

---

## 1. Running js-libp2p in Cloudflare Workers / Durable Objects — tooling only

The consult already proved this works end-to-end (dial, listen, relay, DHT). What
follows is the current bundler and platform-config surface for shipping and operating
it, not a re-litigation of feasibility.

### Bundler: use wrangler's own `alias` field, not a hand-rolled esbuild config

| Tool | Version | Verified | Purpose |
|------|---------|----------|---------|
| `wrangler` | `4.125.0` | `npm view wrangler version` → `4.125.0`; `dist-tags.latest` confirms it | Cloudflare's own bundler (esbuild under the hood) + deploy/config CLI |
| `workerd` | `1.20260825.1` | `npm view workerd version` | Local runtime for `wrangler dev` — same day's build as of this research, actively released |

The consult's finding — *"a global `--conditions=node` fails because `ws` is CJS with
a dynamic `require`; per-package browser overrides are needed"* — maps directly onto a
**documented, current** wrangler feature: the `alias` field in `wrangler.jsonc`.
Cloudflare's own docs (`developers.cloudflare.com/workers/wrangler/configuration/`,
fetched 2026-08-25) state: *"You can configure Wrangler to replace all calls to import
a particular package with a module of your choice, by configuring the `alias`
field,"* with the documented use case of pointing an unused/incompatible module (their
own example is `node-fetch`) at a no-op. This is exactly the shape needed: alias `ws`
(pulled in transitively by `@libp2p/websockets`) to an empty module, since a Worker's
libp2p node never needs the `ws` client — it only ever *accepts* real
`WebSocketPair` objects (§9 of the consult) or dials out over the platform's native
`WebSocket`/`fetch`. Do not try to polyfill `ws`; alias it away.

```jsonc
// wrangler.jsonc — the shape the consult's `ws` finding maps onto.
// Verified for the "alias a whole package to a no-op" case; NOT verified for
// redirecting one deep file inside a package (see the diffieHellman note below) —
// that's an implementation-time check, not something this pass confirmed either way.
{
  "alias": { "ws": "./shims/ws-noop.ts" }
}
```

The consult's three fixes actually split into **two different classes**, and this
matters because they need different tooling:

1. **Module resolution (bundler's job).** The `ws` failure is a dynamic
   `require('events')` inside a CJS file that workerd's ESM loader refuses at upload
   time — fixed by `alias`, as above. **`diffieHellman` is the same class, not the
   shim class it might look like at a glance**: the consult's own account is that
   `@chainsafe/libp2p-noise`'s package already ships a `browser` field mapping that
   one file (`dist/src/crypto/index.js`) to a pure-JS X25519 implementation, and the
   fix was getting the bundler to select *that* file instead of the Node one —
   *"only which crypto backend the bundler had selected."* That is a resolution
   override for one file inside a dependency, not a runtime shim written by hand.
   Whether `alias` (which the docs describe at package granularity) can target one
   deep file inside `@chainsafe/libp2p-noise`, versus needing `resolve.conditions`/a
   `browser`-field-respecting bundler mode instead, is **not verified in this pass**
   — check it against a real build before specifying it as "just add an alias line."
2. **Missing globals (hand-written shim's job).** `process.versions` and
   `BroadcastChannel` are genuinely absent APIs, not resolution problems — no bundler
   flag fixes an object that doesn't exist at runtime. These stay as the ~20-line
   inline shims the consult already wrote. Nothing published changes that (no workerd
   changelog entry for `BroadcastChannel` support was found in this pass — treat the
   shim as still required rather than re-testing whether a newer `compatibility_date`
   removed the need for it, since the consult's measurement outranks an unconfirmed
   absence).

Also restated here so a planner doesn't reach for it expecting it to help:
`nodejs_compat_v2` (documented current flag for broader Node API surface in Workers)
covers *API* gaps, not module-resolution bugs — it would not have fixed the `ws`
failure even though the symptom (a Node built-in) looks like what it's for.

**Do not add** a general Node-shim package (e.g. `unenv`, a manual `browserify`-style
polyfill bundle) to solve this. The failure surface is three specific gaps, already
fixed with ~20 lines total; a shim library pulls in far more surface than needed and
risks masking the next gap instead of surfacing it.

### wrangler config schema — current (fetched 2026-08-25)

- **Format:** `wrangler.jsonc` is the current documented format in Cloudflare's own
  examples (TOML is still accepted but JSONC is what current docs lead with).
- **Durable Object binding:**
  ```jsonc
  { "durable_objects": { "bindings": [{ "name": "BOOTSTRAP", "class_name": "Bootstrap" }] } }
  ```
- **Storage backend:** new projects declare SQLite-backed storage via an `exports`
  block (`"exports": { "Bootstrap": { "type": "durable-object", "storage": "sqlite" } }`)
  rather than the legacy `[[migrations]] new_sqlite_classes = [...]` array. The legacy
  migrations array still works for existing classes; the `exports` shape is what
  current docs present for new ones. **This project's `bootstrap-eu/-us/-apac`
  objects are new — use the `exports` shape, not legacy migrations.**
- **Alarms need no wrangler config entry at all.** There is no `[[alarms]]` block or
  binding to declare — the entire surface is `ctx.storage.setAlarm(timestamp)` plus an
  `alarm()` handler on the class, called automatically by the runtime. The consult's
  §5 already proved this on a deployed object (fired 1ms late, survived eviction) with
  no special configuration present — confirming there is nothing to add here, not
  omitting a step.
- **`locationHint`** — passed to `NAMESPACE.get(id, { locationHint: "weur" })`, and
  **only the first `get()` call for a given object ID respects it** (subsequent calls
  are no-ops for placement). Valid values, verified against current docs: `wnam`,
  `enam`, `sam`, `weur`, `eeur`, `apac`, `apac-ne`, `apac-se`, `oc`, `afr`, `me`. This
  is a best-effort hint, not a guarantee — matches the multi-region decision in
  `PROJECT.md` (`bootstrap-eu`/`-us`/`-apac`), but the actual siting should be
  confirmed once deployed rather than assumed from the hint string alone.
- **`jurisdiction`** — a different axis from `locationHint` (data-residency
  restriction, not placement preference): `env.NAMESPACE.jurisdiction("eu").newUniqueId()`,
  valid values `eu`, `us`, `fedramp`. Readable at runtime as `ctx.id.jurisdiction`
  inside the object, including inside alarm handlers for alarms scheduled after
  2026-03-15 (per Cloudflare's own changelog) — relevant because the record-expiry
  alarm sweep (owner ruling, ranked "the one missing piece") can branch on
  jurisdiction if EU testers' records need different retention handling than others.
  **Not currently required by anything ruled so far** — recorded because the
  telemetry requirement (§4 below) raises exactly the question jurisdiction answers.

### No published libp2p-for-workerd adapter is worth adopting

Searched npm (`libp2p workerd`, `libp2p cloudflare`) and the web. One candidate
exists: `cf-libp2p-ws-transport` (GitHub: `alanshaw/cf-libp2p-ws-transport`, npm as
`cf-libp2p-ws-transport@2.0.5`, published 2025-07-08 — over a year before this
project's pinned `libp2p@3.3.6`). Two disqualifying facts, not opinion:

1. **It targets a plain Worker, not a Durable Object.** The consult measured (§7)
   that a plain Worker has no stable identity — three consecutive requests returned
   three different PeerIds, because each landed in a fresh isolate. A transport
   package that assumes a plain Worker inherits that defect; it cannot be the
   bootstrap/relay role this milestone needs regardless of its transport code being
   correct.
2. **Version skew.** Published for whatever libp2p major was current mid-2025; this
   project is pinned to `libp2p@3.3.6`'s `Transport`/`Listener` interfaces, which
   changed shape across the v2→v3 migration (`doc/migrations/v2.0.0-v3.0.0.md`,
   already cited in `CLAUDE.md`). Adopting it risks a second, unverified
   compatibility surface on top of the one already measured working.

**Do not add it.** The project's own ~40-line listener (`webSocketToMaConn()` →
`upgrader.upgradeInbound()`, per §9 of the consult) is already measured working
against the exact pinned versions this project runs, at a fraction of the surface
area a general-purpose adapter package would add. This is a **build, not install**
item, and it is already built.

---

## 2. TURN — recommendation: Cloudflare Realtime TURN, not coturn, not a third vendor

### The `@libp2p/webrtc` API surface, read from source (not marketing)

Checked `@libp2p/webrtc@6.0.30` (current: `npm view @libp2p/webrtc version` →
`6.0.30`, three patches ahead of the `6.0.27` pinned in `CLAUDE.md` — re-verify before
bumping, not urgent). `WebRTCTransportInit` (in
`private-to-private/transport.d.ts`) exposes:

```ts
export interface WebRTCTransportInit {
  /** Add additional configuration to any RTCPeerConnections that are created.
   *  This could be extra STUN/TURN servers, certificate, etc. */
  rtcConfiguration?: RTCConfiguration | (() => RTCConfiguration | Promise<RTCConfiguration>)
  dataChannel?: DataChannelOptions
  maxEarlyStreams?: number
}
```

This is confirmed, not inferred: `rtcConfiguration` accepts a **standard W3C
`RTCConfiguration`** (so `iceServers: [{ urls, username, credential }]` is exactly the
shape it expects), and — critically — it also accepts a **function returning one,
synchronously or as a `Promise`**. That is the mechanism for short-lived credentials:
`webRTC({ rtcConfiguration: () => fetchFreshTurnCredentials() })` is called per
connection attempt rather than once at node construction, so a TTL-bounded credential
never goes stale mid-session-startup. This closes the "can it even be configured with
TURN credentials" question with a direct read of the package, not a blog post.

### Comparison

| Option | Price model | Verified | Credential minting |
|---|---|---|---|
| **Cloudflare Realtime TURN** (formerly "Cloudflare Calls") | **$0.05/GB relayed**, 1,000 GB/month free, STUN (`stun.cloudflare.com`) free and unlimited | Cloudflare's own current pricing/docs, fetched 2026-08-25 (`developers.cloudflare.com/realtime/turn/generate-credentials/`) | `POST https://rtc.live.cloudflare.com/v1/turn/keys/$KEY_ID/credentials/generate-ice-servers` with `{"ttl": <seconds>}` → **201** with a body whose `iceServers` array is assignable to `RTCConfiguration.iceServers` with one caveat carried from Cloudflare's own docs: filter out any `stun:`/`turn:` URL on port 53 before use, since browsers commonly block that port and a non-trickle-ICE client can stall waiting on it. Server-side call (needs the account's TURN Key ID + API token), so it runs from a Worker/DO, not the browser |
| **Self-hosted coturn** | Infra cost only (a VM + bandwidth), but a person must run it | `coturn/coturn` GitHub, current | Own REST-API scheme: username = `<unix-ts>:<label>`, password = `base64(hmac-sha1(username, static-auth-secret))`, enabled via `use-auth-secret` + `static-auth-secret` in `turnserver.conf`. This is the de-facto standard ("Justin Uberti's TURN REST API") that most managed providers implement variants of |
| **Twilio Network Traversal Service** | $0.40/GB (US/DE), up to $0.80/GB (AU/BR) — **8–16× Cloudflare's rate** | Twilio's own pricing page | Twilio API mints short-lived credentials server-side, same shape |
| **Xirsys** | Free ≤5 GB/mo; Pro $9.99/mo for 25 GB (~$0.40/GB effective); Enterprise custom | Vendor site, MEDIUM confidence (marketing page, not independently cross-checked) | Vendor API |
| **Metered** | Free ≤500 MB/mo; paid plans from $99/mo | Vendor site, MEDIUM confidence | Vendor API |

**Recommendation: Cloudflare Realtime TURN.** Three reasons, each against a specific
rejected alternative:

- **Against coturn:** this project is a sole-author effort that already made the
  deliberate choice to run its bootstrap/relay tier on Cloudflare Durable Objects
  specifically to avoid operating always-up infrastructure (per the 2026-08-24 owner
  ruling). Standing up and patching a coturn VM reintroduces exactly the ops burden
  that decision avoided, for a component (TURN) that is on the *same* fallback path
  as the relay. It also fights the multi-region decision: one coturn box sits in one
  datacenter, while Cloudflare's anycast network puts a TURN relay near whichever
  tester it serves — the same locality argument `PROJECT.md` already made for the
  bootstrap/relay shards.
- **Against Twilio/Xirsys/Metered:** each is a *second* vendor relationship and a
  *second* billing account for a fabric that is already, by owner ruling, built on
  Cloudflare's edge for signaling and relay. Twilio's per-GB rate is 8–16× higher.
  Xirsys/Metered are cheaper at low volume but cap out fast (5 GB / 500 MB free) and
  their paid tiers land at a similar or worse effective $/GB than Cloudflare once the
  cohort is at "hundreds of testers" scale. None offers a reason to add a second
  provider when the primary one already ships a TURN product on the same network the
  relay already lives on.
- **The credential-minting integration point is the same object already answering
  relay reservations.** Cloudflare's `generate-ice-servers` call can be made *from
  inside the same Durable Object or a sibling Worker route* that already brokers
  Circuit Relay v2 reservations, so a client asking "how do I reach a peer" gets both
  a relay multiaddr and TURN credentials from one round trip if desired — no new
  cross-origin call, no new CORS surface.

**What NOT to build:** a bespoke HMAC-credential-minting Worker route replicating
coturn's REST scheme against a self-run coturn box. Cloudflare's hosted
`generate-ice-servers` endpoint already *is* that server, with no VM to keep patched.

---

## 3. `interface-datastore` over Durable Object storage — build, not install

**No published package exists.** Searched npm directly (`durable-object
interface-datastore`, `durable-object datastore`) — nothing matches. This is
consistent with Durable Object storage being a Cloudflare-proprietary API with no
official IPFS/libp2p-ecosystem binding; nobody has published the adapter this project
needs.

### Current package versions (verified 2026-08-25)

| Package | Version | Note |
|---|---|---|
| `interface-datastore` | `10.0.1` | `npm view interface-datastore version`. Depends on `interface-store@^8.0.0` |
| `interface-store` | `8.0.0` | matches |
| `datastore-core` | `12.0.1` | provides `BaseDatastore` — the class `packages/node/src/fs-datastore.ts` already extends. Depends on `interface-datastore@^10.0.0` — consistent, no version skew to fix |

### The canonical reference: this project's own `fs-datastore.ts`, adapted

`packages/node/src/fs-datastore.ts` is the right template, and the adaptation is a
*simplification* in most places because Durable Object storage removes the two
problems that file had to solve by hand:

| Concern in `fs-datastore.ts` | Why it existed | Status on Durable Object storage |
|---|---|---|
| Write-then-rename for atomicity | `node:fs` has no atomic put | **Unneeded.** `storage.put()` is already transactional and durable per the consult (§4) |
| Base32-encoding keys to dodge APFS case-insensitivity | Filesystem-specific collision risk | **Unneeded.** DO storage keys are opaque strings in a key-value/SQL store, not filesystem paths — no case-folding concern. (Not independently stress-tested against DO's specific key charset/length limits — flag as LOW confidence, worth a quick check in the implementation phase, not a blocker) |
| Synchronous `node:fs` calls, async only where the interface demands it | Avoid needless async boundaries for a small peer store | **Inverted.** DO storage's own API (`storage.get`/`put`/`delete`/`list`) is Promise-based only — there is no synchronous path, so every `interface-datastore` method implemented against it is `async` by construction, matching the interface's `T | Promise<T>` typing without the choice `fs-datastore.ts` had to make |
| — | — | **New constraint the fs version never had:** the consult (§4) measured the real value ceiling as **4,193,280 bytes (≈4 MiB)**, not the documented 2 MiB — bisected against real `put` calls, so this is a directly-measured number, not a docs figure. A `put()` implementation must reject or chunk anything larger *before* calling `storage.put`, or the caller sees `SQLITE_TOOBIG` instead of a clean interface-level error |
| — | — | **New capability the fs version never needed:** batch. `storage.put()`/`storage.get()` accept **up to 128 key-value pairs per call** (Cloudflare's documented limit) — `interface-datastore`'s `.batch()` (`{ put, delete, commit }`) should chunk into ≤128-entry groups per `commit()` rather than issuing one `storage.put` per key |
| — | — | **Expiry is a sibling concern, already ruled.** The record-expiry alarm (owner ruling §3 in `2026-08-24-owner-ruling-cloudflare-node-shape.md`) sweeps `storage.list({ prefix })` on a schedule; a `DoDatastore` should expose whatever hook that sweep needs (e.g. a `queryKeys` pass-through) rather than duplicating listing logic |

**Do not** try `datastore-level` or a browser IndexedDB-oriented store (`datastore-idb`)
against Durable Object storage — both assume an underlying engine (LevelDB / IndexedDB)
that doesn't exist on this platform; DO storage is a different primitive entirely (KV
today, SQLite-backed under the hood per Cloudflare's newer `exports` schema in §1).
Writing directly against `state.storage` is the only correct approach, exactly as
`fs-datastore.ts`'s own docblock argues for `node:fs` over a published abstraction
that hid the wrong assumptions.

---

## 4. Telemetry — Cloudflare Workers Analytics Engine, consent piggybacked on the CPU gate

### The shape of the requirement rules out ordinary pageview analytics

The five things needed — node-start failure % by browser, WebRTC success/failure by
network class, connection lifetime, tab churn — are **custom dimensional events**,
not pageviews. This rules out treating this as an "add Plausible/Umami and done"
question, though both are worth naming for what they're good at.

| Tool | Model | Self-hostable/serverless | GDPR posture | Verdict |
|---|---|---|---|---|
| **Cloudflare Workers Analytics Engine** | Write-only custom events (`writeDataPoint({ blobs, doubles, indexes })`); query later via its SQL API | **Serverless** — no server to run, uses the platform already in place for the bootstrap/relay tier | No cookies, no client-side storage at all; what's collected is exactly what the write call puts in it. **No banner is forced by the tool** — the tool has no default behavior to audit, only whatever fields this project chooses to write | **Primary recommendation, with one required component the requirements author must count:** `writeDataPoint` is a **binding available only inside a Worker/DO** — there is no client-side write API, so a browser cannot call it directly. Every metric needs a Worker route the client `fetch()`s (or a write issued by the relay/bootstrap DO the session already touches, which avoids a dedicated route entirely). 10M writes/month free (`developers.cloudflare.com/analytics/analytics-engine/pricing/`, fetched 2026-08-25 — not yet billed as of this date per the same page, then $0.25/million), unlimited-cardinality blobs (`browser`, `networkClass`, `failureReason`, `region`) plus numeric doubles (`connectionLifetimeMs`). One write per session-end event is well inside the free tier for "hundreds of testers" |
| **Plausible / Umami (self-hosted)** | Pageview + optional custom-event analytics | Self-hostable (Elixir+ClickHouse / Node+Postgres respectively) | Both cookie-free by design; neither sets persistent identifiers; widely treated as **not requiring a cookie consent banner** under GDPR/PECR because the ePrivacy cookie-consent trigger (storing/reading something on the device) doesn't apply | Reasonable *secondary* choice if a ready-made dashboard (visits, browser/OS breakdown, countries) is wanted without writing SQL — but it means **running and patching a database server** for a sole-author project that just moved its always-on tier to serverless Durable Objects specifically to avoid that. Umami is the lighter of the two if this path is taken |
| **Cloudflare Web Analytics** (the pageview product, not Analytics Engine) | Beacon-based pageview counting, no cookies, hashes IP+UA+headers transiently and discards | Serverless (it's a Cloudflare product) | No cookies set; most treatments conclude no consent banner is legally forced, though some conservative guides still list it in a privacy policy | Not a fit on its own — it has no mechanism for the custom dimensions this requirement needs (browser-*of-failure*, network class, tab churn are not "pageviews"). Could sit *alongside* Analytics Engine for basic traffic counting, but is not a substitute |

**Do not add:** Google Analytics, Mixpanel, Amplitude, Segment, or Sentry's default
SaaS configuration. All five, out of the box, set persistent cross-session
identifiers and/or capture and retain raw IP by default, which is exactly the
combination that forces a cookie/consent banner under GDPR and ePrivacy — the opposite
of what "privacy-respecting" is asking for here. If crash-style stack traces are
wanted later (distinct from the aggregate metrics asked about here), the fallback is
**GlitchTip** (AGPL, Sentry-API-compatible, self-hostable) with IP scrubbing turned on
at ingestion — not Sentry SaaS.

### Consent: piggyback on the CPU-use gate rather than solving it twice

`PROJECT.md`'s v2.0 scope already requires "consent before a single CPU cycle" for
every volunteer node. **Recommendation for the requirements author:** make the single
consent action that unlocks CPU use *also* unlock the telemetry beacon, rather than
building a second consent flow. This isn't asserted as the complete legal analysis —
GDPR legitimate-interest-vs-consent is a genuinely contested question even among the
sources checked here (WebSearch results disagreed with each other on whether IP-based
analytics needs consent or can rely on legitimate interest) — but it is the simplest
correct engineering answer regardless of which side of that legal question holds: one
user action, one moment, covers both "may this device run untrusted code" and "may
this session be measured," and the measured fields (browser name, coarse network
class, connection duration, region) contain no persistent identifier and no raw IP if
the write call is written to exclude it. Flag this for legal review before shipping;
it is a design recommendation, not a compliance ruling.

---

## 5. Kill switch — build against Workers KV (or the existing DO), not a feature-flag vendor

This is a one-boolean (or one small integer "protocol version") problem, and the
constraint that matters is "no redeploy of the static page." Since the static page
(GitHub Pages) is exactly the thing that *cannot* change without a deploy, the flag
cannot live there — it must live on the Cloudflare tier, which this milestone already
stands up for other reasons.

| Option | Propagation | Fits "no redeploy"? | Ops cost |
|---|---|---|---|
| **Workers KV** (recommended) | Edge-cached; a write can take **up to ~60s** to be visible everywhere (Cloudflare's own docs, fetched 2026-08-25: "changes take up to 60 seconds to propagate globally as cached versions time out") | Yes — `wrangler kv key put --binding=KILL_SWITCH_NS --remote "killed" "true"` (binding name and key are placeholders for whatever the route is written to read) is a CLI action, not a deploy, and updates the value used by a route that's already deployed once | Near zero: 1 GB / 100K reads / 1K writes per day on the **free** tier; a kill switch writes rarely and is read by every client polling it, which is squarely a read-heavy workload KV is built for |
| **A field on the existing bootstrap Durable Object** | Instant for already-connected peers (push over the open WebSocket/relay control channel), same ~seconds-to-minutes for peers that only poll HTTP | Yes, same as above, via an authenticated Worker route instead of a CLI write | Slightly more code (one route + one broadcast), but reuses infrastructure this milestone builds anyway |
| **A third-party feature-flag platform** (LaunchDarkly, Split, self-hosted Unleash/Flagsmith) | Sub-second, SDK-mediated | Yes, but overkill | High for what's needed: either a new paid vendor (LaunchDarkly/Split) or a new self-hosted service (Unleash/Flagsmith — itself a server to run, the exact ops burden this milestone's Cloudflare move was chosen to avoid) for a single global boolean |

**Recommendation:** Workers KV as the source of truth, read by clients on an interval
(e.g. every 30–60s, and once before starting any CPU work) via a public unread-auth'd
Worker route that just echoes the KV value — cheap, no code to maintain beyond that
route, and updatable with one CLI command with no build/deploy step. **Layer the
Durable Object push on top only if the sub-minute KV propagation window turns out to
matter in practice** — i.e., build the cheap version first, and only add the
broadcast-over-existing-socket path if hundreds of testers running for tens of minutes
each makes a 60-second worst case unacceptable. Given the milestone's own volunteer
guarantee is "a stop control that provably drops CPU to zero," the *node-local* stop
path (each node checking its own kill flag before starting work) matters more than
sub-second global propagation — a minute of latency to a global flag is very different
from a minute where the *client itself* refuses to check.

**Do not add** a feature-flag SaaS or a self-hosted feature-flag server. Both solve a
problem (staged rollouts, per-user targeting, A/B testing, multi-language SDKs) this
milestone doesn't have. One boolean, read by one kind of client, written rarely, is
inside what Workers KV already does for effectively free.

---

## Sources

- `npm view wrangler version` / `dist-tags` — `wrangler@4.125.0` current, checked 2026-08-25
- `npm view workerd version` — `1.20260825.1`, checked 2026-08-25
- `npm view @libp2p/webrtc version` — `6.0.30`, checked 2026-08-25 (three patches ahead of `CLAUDE.md`'s pinned `6.0.27`)
- `unpkg.com/@libp2p/webrtc@6.0.30/dist/src/private-to-private/transport.d.ts` — read directly, `rtcConfiguration` shape confirmed from source, not marketing
- `npm view interface-datastore version` / `dependencies` — `10.0.1`, depends on `interface-store@^8.0.0`, checked 2026-08-25
- `npm view interface-store version` — `8.0.0`
- `npm view datastore-core dependencies` — `12.0.1`, depends on `interface-datastore@^10.0.0` — consistent
- `npm search "libp2p workerd"` / `"libp2p cloudflare"` / `"durable-object interface-datastore"` — no published adapter or datastore binding found
- `npm view cf-libp2p-ws-transport version time.modified` — `2.0.5`, `2025-07-08` — stale relative to this project's `libp2p@3.3.6`, targets plain Workers not Durable Objects
- [Cloudflare Workers docs — Wrangler configuration](https://developers.cloudflare.com/workers/wrangler/configuration/) — `alias` field, `compatibility_flags`, `compatibility_date` format, fetched 2026-08-25
- [Cloudflare Durable Objects — Data location](https://developers.cloudflare.com/durable-objects/reference/data-location/) — `locationHint` values and first-`get()`-only semantics, `jurisdiction()` API and values, fetched 2026-08-25
- [Cloudflare Durable Objects — Get started](https://developers.cloudflare.com/durable-objects/get-started/) — current binding/`exports` config shape, fetched 2026-08-25
- [Cloudflare Realtime — Generate credentials](https://developers.cloudflare.com/realtime/turn/generate-credentials/) — TURN credential API request/response shape, fetched 2026-08-25
- Cloudflare Realtime TURN pricing ($0.05/GB, 1,000 GB free, free unlimited STUN) — MEDIUM confidence, WebSearch snippet of Cloudflare's own pricing page, not independently re-fetched in full
- Twilio, Xirsys, Metered pricing — MEDIUM confidence, vendor pricing pages via WebSearch, not independently cross-checked against a second source
- `coturn/coturn` GitHub (`examples/etc/turnserver.conf`, wiki) — REST API HMAC credential scheme, MEDIUM confidence (community wiki + WebSearch synthesis, not a direct source read in this pass)
- [Cloudflare Workers KV — pricing/limits](https://developers.cloudflare.com/kv/) — free tier (1 GB / 100K reads / 1K writes per day), ~60s global write propagation — MEDIUM confidence, WebSearch synthesis of Cloudflare's own docs and community posts, not independently re-fetched
- [Cloudflare Workers Analytics Engine — pricing](https://developers.cloudflare.com/analytics/analytics-engine/pricing/) — 10M writes/month free, unbilled as of this research date — MEDIUM confidence, WebSearch synthesis
- Plausible/Umami cookie-free, no-consent-banner posture — MEDIUM confidence, multiple third-party comparison articles agreeing, not the vendors' own legal pages
- GDPR consent-vs-legitimate-interest for IP-based analytics — **explicitly contested even across the sources checked**; treated as LOW confidence / needs legal review, not asserted as settled
- `packages/node/src/fs-datastore.ts` — read directly, the reference implementation this project already has for the datastore adaptation in §3
- `.planning/consults/2026-08-24-cloudflare-as-a-fabric-node-measured.md` and `2026-08-24-owner-ruling-cloudflare-node-shape.md` — treated as ground truth per the task's quality gate; nothing in this file contradicts them, and where a doc source might imply otherwise (e.g. Containers' published egress-port docs, already flagged inverted in the consult) that conflict is the consult's finding, not reopened here

---
*Stack research for: o2.services v2.0 "Open the Doors"*
*Researched: 2026-08-25*
