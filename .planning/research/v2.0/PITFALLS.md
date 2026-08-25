# Pitfalls Research — v2.0 "Open the Doors"

**Domain:** Adding an always-on hosted tier (Cloudflare Durable Objects) to a working P2P
browser compute fabric, then opening it to a real, globally distributed public cohort recruited
from Telegram.
**Researched:** 2026-08-25
**Confidence:** MIXED — HIGH where a real incident or the project's own measured consult backs
the claim, MEDIUM where multiple independent sources agree, LOW where flagged explicitly
(mostly area 3's headline number, which does not exist in public form for this domain).

**Scope note.** This file only covers what changes by *adding* a hosted tier and *opening* to
the public. It does not re-litigate anything already true of the working browser mesh (WebRTC
16 KiB frames, DAG-CBOR determinism, etc. — those live in the v1 `PITFALLS.md`, which this file
does not touch).

Every pitfall below carries a **Bites:** line — *before the run* (build-time / pre-launch) or
*during the run* (only shows up under real load or real geography) — because the two need
different tests and different owners.

---

## Critical Pitfalls

### Pitfall 1: The hosted tier becomes load-bearing by default, silently

**What goes wrong:**
A relay/bootstrap tier that is *supposed* to be a signaling convenience quietly becomes the
thing every session actually depends on, because nobody is watching the ratio of "sessions that
upgraded off it" to "sessions that stayed on it." The project stops being P2P in practice while
every doc still calls it P2P.

**Why it happens:**
This is not a hypothetical — it is the median outcome for hosted-relay P2P systems, for a
structural reason: the hosted tier is *always available* and the peer-to-peer path is
*probabilistic*, so any code path that races them (try direct, fall back to relay) will show a
relay-served session as a success indistinguishable from a truly-P2P one unless someone counts
separately. Two real precedents:
- **IPFS itself.** A 2023 measurement study found "heavy IPFS reliance on cloud infrastructure
  ... visible in the network topology, generated traffic, content provider records and its entry
  points," concluding this "threatens the core design goals of IPFS such as censorship
  resistance, robustness and openness" (arXiv:2309.16203, "The Cloud Strikes Back"). Bootstrap
  nodes, gateways, and Hydra nodes accreted centralizing weight without any single decision
  causing it.
- **Matrix.** The `matrix.org` homeserver, run by the Matrix.org Foundation, "hosts a very
  significant proportion of the network's users," so its outages take down a large fraction of a
  protocol whose entire design goal is federation.

**Prevention (buildable, not a principle):**
- Instrument and publish **two counters per session**, not one: (a) whether the WebRTC handshake
  completed and application data moved peer-to-peer, and (b) whether the DO relay carried any
  application-level bytes beyond signaling. A session that only ever moved bytes through (b) is
  not a P2P session no matter how the logs describe it.
- Track the ratio **"fraction of connection-seconds carried by the hosted tier vs. carried
  peer-to-peer"** as a first-class dashboard metric from the first day of the public run, not
  added after a Cloudflare bill or an outage prompts the question.
- Schedule a **relay-kill drill**: take one region's `bootstrap-*` Durable Object offline
  mid-run and confirm already-connected peer pairs are unaffected (correct — the relay drops out
  after the WebRTC handshake per this project's own transport matrix) and that *new* pairs in
  that region degrade to a measured, bounded failure rate rather than a silent full outage.
- Multi-region sharding (already an active decision in PROJECT.md) is necessary but not
  sufficient — it prevents one relay from being a full SPOF, it does not prevent the tier as a
  *class* from becoming load-bearing.

**Bites:** during the run — the drift is invisible in single-machine testing because loopback
and Playwright contexts never had a reason to distinguish "relayed" from "direct" in the first
place; nothing forces the distinction until real geography produces real ICE failures.

**Phase to address:** the multi-region relay phase (build the two-counter split into the relay
and connection-manager instrumentation before public bootstrap addresses are handed out) and the
public-run phase (the drill and the published ratio are run deliverables, not afterthoughts).

---

### Pitfall 2: Durable Object alarm loop — a self-rescheduling sweep with no guard

**What goes wrong:**
An alarm handler reschedules itself unconditionally on every wake, and every wake also creates
new demand for another wake. Cost accrues per-object, per-wake, with no natural ceiling, and
Cloudflare gives no proactive warning before the bill posts.

**Why it happens — one self-reported incident, read at the source 2026-08-25.**

The primary source is a Hacker News post by `thewillmoss`, 2026-04-16, **31 points and 4
comments** (`news.ycombinator.com/item?id=47787042`). It is **one person's self-report**, not
journalism, not an audit, and not confirmed by Cloudflare — the poster's own last line is that
there was *"no billing response yet"*. Treat the figure as reported.

Its timeline, from the post: the loop began **3 April** with zero prior Durable Object usage;
peaked **4–5 April at ~930 billion row reads per day**; was found and fixed **11 April**; the
invoice of **$34,895** fell due **15 April**.

**Two details in it change what the pitfall actually is**, and both were lost in the first
retelling here:

- **The bill was for row reads, not for alarm invocations.** The alarm loop was the trigger;
  the cost came from storage reads at 930 billion per day.
- **It was not one object.** The cause was `onStart()` calling `setAlarm()` on every wake-up
  **combined with 60+ preview Worker deployments**, each with its own Durable Object
  instances. That makes it as much a CI/preview-environment hazard as an alarm hazard.

**Why this is not a hypothetical for this milestone specifically:** the milestone's own plan
requires exactly the mechanism that failed — an alarm sweep plus a read-time check — because
Durable Object storage persists by definition.

*(Amended 2026-08-25: this paragraph inherited a claim from PROJECT.md that
`@libp2p/kad-dht` "never expires provider records". It does not hold, and it was the fourth
repetition of a reading `RFC-0003-RESPONSE-04` §8 had already corrected — the honoured knob is
`reprovide.validity`, and `providerRecordPolicy` in `packages/libp2p/src/constants.ts:316`
already sets it. The pitfall below is unaffected: the sweep still has to be ported from
`setInterval` to an alarm to run on workerd, so the runaway-alarm hazard is exactly as real.)* The consult's own §5 already
demonstrates the alarm mechanism works (fired 1ms late, survived eviction) — but a mechanism
that *works* is not the same claim as a mechanism that is *bounded*.

**What the platform offers now, checked 2026-08-25.** Cloudflare shipped **budget alerts** on
2026-04-13 — after the incident above — and turned them **on by default** for pay-as-you-go
accounts on 2026-07-20 at a **$10** account threshold. Their own wording is the important part:
*"The alert is informational only. It does not cap your usage."* **There is still no hard
ceiling.** The alert is worth lowering from $10 and is not worth mistaking for a limit.

**Two constraints for this project specifically, both from the incident's actual shape:**

1. **No preview deployments of the hosted tier, ever.** The decisive multiplier was not the
   alarm — it was **60+ preview Worker deployments**, each with its own Durable Object
   instances running the same bug. One deployed instance is one bug; sixty is a bill.
2. **The set of object names must be closed and short.** `idFromName()` creates an object for
   any name it is given, so a name derived from anything a visitor controls lets a public
   cohort — or one person in it — create unbounded objects, each with its own storage and its
   own alarm. `bootstrap-eu` / `-us` / `-apac` is the whole namespace. This is a design
   constraint, not an operational habit, and it belongs in the requirement rather than in a
   runbook.

**Prevention.** *(Corrected 2026-08-25 against Cloudflare's own alarms documentation, which
was read rather than assumed.)*

**An object cannot stack alarms.** The docs state that each Durable Object has one alarm at a
time and *"if you call `setAlarm` when there is already one scheduled, it will override the
existing alarm."* So the `getAlarm()` check below does **not** prevent accumulation — there is
nothing to accumulate. What it prevents is an unconditional reschedule pushing the next firing
around on every wake. The thing that actually bounds spend is the interval floor and the
alert, not the check.

**And a failing sweep multiplies itself by six:** *"The `alarm()` handler has guaranteed
at-least-once execution and will be retried upon failure using exponential backoff, starting
at 2 second delays for up to 6 retries"* — on an uncaught exception. A sweep that throws is a
sweep that runs seven times.

- Every alarm handler calls `storage.getAlarm()` and checks for `null` before calling
  `setAlarm()` again — never reschedule unconditionally.
- Enforce a **minimum reschedule interval** (e.g., sweep no more than once per N minutes per
  object) so a bug that fires more often than intended is capped rather than unbounded.
- Configure a **Cloudflare billing alert threshold before the first Durable Object is deployed**,
  not after — this is the single change that would have turned the $34k incident into a same-day
  page instead of an 8-day surprise.
- Load-test the sweep against a synthetic multi-thousand-record keyspace in a throwaway account
  before it ever touches the account the public run uses, to see the real cost-per-sweep number
  rather than assume it.

**Bites:** before the run, if tested — but the incident above shows it can also bite *during*
the run at full unattended cost if nobody is watching a dashboard, because Cloudflare does not
proactively warn.

**Phase to address:** the record-expiry / persistence phase, as a required guard co-located with
the sweep implementation, plus a pre-launch checklist item ("billing alert configured") in the
public-run entry-conditions phase.

---

### Pitfall 3: Cost from held sockets, not from messages — the wrong meter is watched

**What goes wrong:**
A team budgets Durable Object cost by estimating message volume and is surprised by the actual
bill, because the dominant cost driver for a *relay/bootstrap* workload is **duration billing
while a WebSocket is held open**, not per-message charges.

**Why it happens:**
Cloudflare's own billing model: **calling `accept()` on a WebSocket in a Durable Object incurs
duration charges for the entire time that socket is connected** — and separately, **incoming
WebSocket messages are billed at a 20:1 ratio** (20 messages = 1 billed request; outgoing
messages and protocol pings are free). A bootstrap/relay role by design wants to hold sockets
open for as long as possible (§17 of the project's own consult found a non-hibernatable socket
carrying libp2p died after 6 minutes idle, while a hibernatable one survived 15+ minutes with no
close) — so the natural fix for connection survival (keep the socket open) is exactly the thing
that maximizes duration billing, unless the socket is moved onto the **hibernation API**, whose
idle time bills differently (no duration charge while hibernated and no handler is running).

**Prevention:**
- Treat the **hibernation-aware listener** the consult already flags as unwritten (§17,
  "Still unmeasured") as a **cost requirement**, not only a connection-survival requirement. A
  non-hibernatable listener × hundreds of concurrent volunteer sessions × 24 hours is the shape
  of a real bill, independent of whether the connections carry any traffic at all.
  `webSocketToMaConn()` needs a live in-memory object and event handlers as written today, so it
  structurally cannot hibernate — this is exactly the gap that must close before hundreds of
  volunteers hold sessions open simultaneously.
  measure the actual cost delta between "keep-alive traffic holding a plain socket open
  indefinitely" (still unmeasured per the consult) and "hibernation-based" before choosing —
  don't assume.
- Model cost against **connection-seconds held**, not **messages sent**, when sizing the public
  run's expected bill; the 20:1 message ratio makes chatty control traffic nearly free by
  comparison.

**Bites:** during the run — a handful of test connections in dev never accumulate enough
duration to show up on an invoice; hundreds of volunteers holding sessions for hours does.

**Phase to address:** the inbound-listener-correctness phase (make hibernation-awareness a
stated acceptance criterion, not a follow-up) and the entry-conditions phase (a stop control that
"provably drops CPU to zero," already planned, should also be verified to drop *duration
billing* to zero — the two are not automatically the same thing under the hibernation API).

---

### Pitfall 4: Storage grows without expiry, and expiry ships *after* the cohort arrives

**What goes wrong:**
Durable Object storage is durable by construction — nothing evicts it automatically the way an
in-memory structure would. A DHT keyspace whose records were designed on the assumption that
"nothing persists" (true of the browser-mesh-only system) now persists by default the moment any
record touches a Durable Object.

**Why it happens:**
Already diagnosed precisely in this project's own materials: `@libp2p/kad-dht@16.4.0` **never
expires provider records** — "harmless only while nothing persists; object storage persists by
definition" (PROJECT.md). The consult confirms the storage side works (4 MiB per value, correct
prefix listing) and that the expiry mechanism (alarms) works — but as of the consult, the actual
sweep "is not yet written." The failure mode is sequencing: if the public cohort's first session
records land in a keyspace with no expiry sweep running yet, storage grows unbounded from day
one of the run, and retrofitting expiry later means writing a one-time backfill/cleanup pass
under live load instead of shipping with the record store.

**Prevention:**
- Do not treat "storage works" and "storage is bounded" as the same milestone checkbox. The
  record-expiry phase's exit criterion should be **an alarm sweep observed running against
  records the public cohort actually wrote**, not merely a passing unit test against synthetic
  records.
- Read-time check (already planned) plus alarm sweep (already planned) is correct — but add a
  **storage-growth alert** (bytes-per-object trend) as a third leg, because it is the only one
  that would catch a sweep that silently stopped running (e.g., after an alarm-loop guard from
  Pitfall 2 makes the sweep interval too conservative).

**Bites:** before the run, if sequenced correctly — but the risk of shipping the record store
before the sweep is a during-the-run failure that is expensive to unwind (records written by
real, geographically-diverse volunteers are a real production dataset by the time anyone
notices).

**Phase to address:** the record-expiry/persistence phase — explicitly gate "persistence
ships" on "sweep ships," not the reverse order.

---

### Pitfall 5: The inbound listener quietly refuses to scale — two specific, previously-found bugs

**What goes wrong:**
A listener that appears to work correctly with one or two peers silently throttles or breaks
once real concurrent volunteers arrive, and the symptom shows up nowhere near the cause (identify
returns nothing, relay discovery finds no relays, reservations come back empty — none of which
says "check the remote address").

**Why it happens — both already measured against this exact codebase, not hypothetical:**
1. **Missing `direction: 'inbound'`.** `webSocketToMaConn()` defaults to outbound when the field
   is omitted; both ends then negotiate yamux as clients and every stream is refused with
   `Both endpoints are clients`. The dial succeeds and Noise completes, so this looks like a
   deep protocol bug rather than one missing field (consult §14).
2. **Missing real remote address.** Without deriving the multiaddr from `CF-Connecting-IP`, every
   inbound connection reports as `127.0.0.1`, so libp2p's own `INBOUND_CONNECTION_THRESHOLD`
   (5 connections/sec, *per host*) rate-limits the **entire internet** as one host — the node
   silently caps at 5 connections/sec no matter how many real distinct volunteers try to connect
   (consult §19, "the most consequential defect found in the listener").

**Prevention:**
- Treat both fixes as **required fields**, not implementation details, in the inbound-listener
  spec: `direction: 'inbound'` and a `CF-Connecting-IP`-derived remote address are load-bearing,
  not optional correctness.
- Add an integration test that specifically drives **more than 5 concurrent distinct simulated
  client addresses** against the listener — a test with 1–2 peers, however thorough, cannot
  surface this class of bug by construction, which is exactly how it was missed the first time.
- Keep libp2p's per-host rate limit **on** in production (it is a real, wanted defense) — the
  fix is correct addressing, not disabling the defense.

**Bites:** before the run, if the specific integration test above is written; otherwise during
the run, at the exact moment concurrent volunteer count exceeds single digits — which for "a few
hundred volunteers" is inevitable and immediate.

**Phase to address:** the inbound-listener-correctness phase, explicitly named as a target
feature already ("A correct inbound listener... a remote address derived from
`CF-Connecting-IP`").

---

### Pitfall 6: The relayed fallback is assumed symmetric at 128 KiB; it is 64 KiB each way

**What goes wrong:**
A protocol designed against "128 KiB per relayed connection" budgets a symmetric
request/response exchange as if each side gets the full limit, and the exchange dies mid-flight
under real traffic because the limit is shared.

**Why it happens:**
Measured directly against this project's own relay (consult §15): the `DATA_LIMIT` of 131072
bytes (128 KiB) is enforced as **bytes-out plus bytes-back, combined** — a symmetric
request/response protocol therefore gets **64 KiB each way, not 128**. `CLAUDE.md`'s own stated
constraint (128 KiB) is correct as a connection-wide ceiling but easy to misread as "128 KiB in
each direction," and the milestone's own target features list already records the correction
("the relay's measured 64 KiB-each-way ceiling stated where a design would otherwise assume
128") — meaning this is a documented risk of being re-forgotten by whoever writes the fallback
code, not an unknown.

**Prevention:**
- Any protocol that can run over a relayed fallback connection must size its largest
  request/response pair against a **64 KiB per direction** budget, explicitly, in the spec —
  not against the connection-wide 128 KiB figure.
- Add a test that exercises the relayed fallback path specifically (not just the direct WebRTC
  path) with a request/response pair sized near the boundary, so a regression here fails loudly
  in CI rather than as a field report from a volunteer behind symmetric NAT.

**Bites:** during the run, and specifically concentrated among volunteers whose pairs fall all
the way through to the relayed fallback — which the project already expects to correlate with
cross-continent, corporate, and CGNAT connections (see Pitfall 9).

**Phase to address:** the TURN/relay-fallback phase.

---

### Pitfall 7: Cold fan-out through the Cloudflare gateway path exceeds the subrequest cap

**What goes wrong:**
Code that dials out to many peers or many delegated-routing targets from a single Worker
invocation assumes "the limit is small (six-ish simultaneous)" and is surprised when it is hit at
a much higher count, or assumes there is no limit and is surprised it exists at all.

**Why it happens:**
Measured directly (consult §10): the real ceiling is **50 subrequests per invocation,
cumulative** — not "six simultaneous." Ten sockets opened and closed per round, twelve rounds,
totalled exactly 50 before refusal; **closing a connection does not return budget**. Critically,
**traffic on an already-open connection is free** (200 round-trips on one open socket cost
nothing against the cap) — so the failure mode is specifically *cold fan-out wider than 50 new
dials in one invocation*, and the fix is a **warm connection pool**, not a smaller fan-out.

**Prevention:**
- Any gateway/routing code hosted on this tier must be written against a persistent connection
  pool from the start, reusing sockets across invocations rather than dialing fresh per request —
  because the cap is per-invocation and does not accumulate favorably with request volume.
- Do not scope the Cloudflare-as-IPFS-gateway idea (raised and partially explored in the consult)
  beyond "routing for the fabric's own keyspace plus artifact fetch over an immutable URL" for
  this milestone — the consult itself flags the temptation to build a full bridge as scope creep
  that a stateless design cannot support under this cap.

**Bites:** before the run, if load-tested against realistic fan-out counts; otherwise during the
run, exactly when concurrent onboarding causes many simultaneous cold dials from one object.

**Phase to address:** whichever phase implements delegated-routing or gateway behavior on the
Cloudflare tier — recommend explicitly scoping this out of v2.0 unless a connection-pool design
is already budgeted, per the consult's own "what to resist" guidance.

---

### Pitfall 8: The general public cannot connect, and nobody measured how many or why

**What goes wrong:**
The run produces a headline number ("N% success") with no breakdown, so a large silent failure
population (never got past page load, never got past consent, never got past ICE gathering) is
invisible, and "WebRTC failure rate by country and network class" — one of the run's stated
deliverables — cannot actually be produced after the fact from aggregate success/fail alone.

**What is actually known, and what is not (confidence stated per number):**
- **No single published number exists for "what fraction of a general audience cannot
  participate in browser P2P compute at all."** This is a genuine gap, not an oversight in this
  research — stating it plainly is more useful than inventing a figure.
- Proxy bounds from adjacent domains (all **LOW–MEDIUM confidence**, none of them measuring this
  project's exact stack):
  - Industry WebRTC guidance: **10–20% of users, depending on geography and carrier, cannot
    establish a direct P2P connection** and must relay through TURN (bloggeek.me / VideoSDK
    sourcing). This is a *relay-required* rate, not a *complete-failure* rate.
  - A large-scale libp2p measurement (arXiv:2510.27500, Trautwein et al., 4.4M hole-punch
    attempts across 85,000+ networks in 167 countries) found a **70% ± 7.1% hole-punch success
    rate** for DCUtR (libp2p's decentralized relay-upgrade protocol) — meaning roughly **30%
    fall back to a relayed connection**, and **11% of peers were behind symmetric NAT**, the
    category hole-punching essentially cannot solve without TURN. This measures a *different*
    protocol (DCUtR, not raw WebRTC ICE) on a *different* network (public IPFS/libp2p, not
    browser tabs) — directionally relevant, not a substitute for this project's own number.
  - Beyond NAT: an unknown-but-nonzero fraction fail earlier and are invisible to any NAT
    statistic — ancient/unsupported browsers, WebRTC disabled by policy or extension, both UDP
    and WSS blocked simultaneously (rare but reported in enterprise networks), and — specific to
    this cohort — **Telegram's in-app browser** (see Pitfall 10). Four more, named because the
    question asks for them by name and each has a distinct signature in the funnel:
    - **Ad blockers and privacy extensions block the telemetry itself, not just ads.** Filter
      lists (EasyPrivacy and similar) block request paths and domains shaped like tracking —
      `/analytics`, `/telemetry`, `/beacon`, third-party collection endpoints — as a matter of
      course. This is the one that undermines the funnel's own credibility if not handled: a
      volunteer who connects fine but whose telemetry beacon is silently dropped either
      disappears from the data entirely or is misread as a stage-1 dropout, biasing every
      downstream number toward "worse than reality" in a way that looks like a NAT problem but
      isn't. MEDIUM confidence, standard ad-blocking behavior.
    - **Captive portals** (hotel/airport/café wifi) commonly allow TCP/443 post-authentication
      while continuing to block UDP outright — this cohort lands on the TURN-over-TCP or
      circuit-relayed rung, or fails, and shows up in the funnel specifically as "WSS to
      bootstrap succeeded, ICE gathering failed" rather than failing at connection time. LOW–
      MEDIUM confidence, general captive-portal behavior, not measured against this stack.
    - **IPv6-only / NAT64-464XLAT mobile carriers** (e.g., large US carriers default to this).
      WebRTC itself generally tolerates this if ICE negotiates end-to-end, but any **IPv4
      literal** in STUN/TURN server configuration breaks resolution through the NAT64 gateway —
      the failure is silent and looks like a generic TURN-unreachable error. Prevention: always
      configure STUN/TURN servers by **hostname**, never by IP literal. MEDIUM confidence.
    - **Mobile backgrounding, beyond the Telegram-specific case in Pitfall 10.** Even a real
      mobile browser (not an in-app WebView) throttles or suspends background tabs under normal
      OS power management — a volunteer who switches apps mid-session on an ordinary phone
      browser, not just inside Telegram, will see the same connection-drops-when-backgrounded
      symptom. Worth a distinct funnel label from the Telegram-WebView case, since the fix
      (visible reconnect-on-foreground handling) is needed regardless of which browser it is.
- **The standard way to measure this, and the only credible answer to the question "what
  proportion cannot participate," is a per-stage connectivity funnel, instrumented before the
  public run starts, not guessed at afterward:**
  1. page load
  2. consent given
  3. WSS connection to a `bootstrap-*` Durable Object established
  4. ICE gathering completed
  5. connection classified: direct WebRTC / TURN-relayed / circuit-relayed / failed entirely
  6. first task actually executed
  Reporting **per-stage drop-off, broken down by country and network class (residential /
  mobile / corporate / hosting-provider ASN)**, is what turns "some volunteers couldn't connect"
  into the measurement the run exists to produce. This is buildable telemetry, not aspiration —
  each stage above is already a discrete event the client code passes through.

**Prevention:**
- Build the six-stage funnel as **the** telemetry schema for the public run, before recruiting
  begins, not as a post-hoc addition once drop-off is anecdotally noticed.
- Report the funnel **live during the run** (even a simple internal dashboard) so a stage with
  unexpectedly high drop-off (e.g., stage 3 failing broadly would indicate a bootstrap-tier
  problem, not a NAT problem) is diagnosed within hours, not after the run ends.
- Do not conflate "TURN-relayed" success with "direct P2P" success in the headline metric — see
  Pitfall 1's counters.

**Bites:** before the run in one sense (the instrumentation must exist before launch) but the
actual failure — an unmeasured, unexplained chunk of the cohort silently churning out — only
becomes visible during the run if the funnel wasn't built in advance.

**Phase to address:** the entry-conditions phase (telemetry that "turns volunteers into
measurements rather than anecdotes" is already a named target feature — this funnel is the
concrete shape of that feature) and the public-run phase (the funnel is a run deliverable).

---

### Pitfall 9: Cross-continent pairs concentrate exactly where TURN is absent

**What goes wrong:**
The failure rate is not uniform across the cohort — it concentrates in specific network classes
(corporate, CGNAT, some mobile carriers) and specific geography (cross-continent pairs pay two
penalties at once: higher baseline latency and a higher chance at least one side is behind a
NAT type hole-punching cannot solve), and a design that has no TURN fallback converts that
concentration into **complete, silent failure** for those pairs rather than degraded service.

**Why it happens:**
This project's own constraint doc states plainly: "There is no TURN in the stack, and a pair
behind symmetric NAT simply fails — which across continents is where failures concentrate"
(PROJECT.md, Key Decisions). This is not a hypothesis; the milestone has already decided to add
TURN plus a relayed fallback specifically because of this. Corroborating context: corporate
firewalls disproportionately block outbound UDP above the well-known port range, which is
exactly the traffic STUN/TURN/WebRTC hole-punching depends on, and this is reported as common in
enterprise networks specifically (as opposed to residential/consumer networks, where it is rare)
— meaning the volunteer's *network class*, not their goodwill or device, decides whether they
can participate at all.

**Common TURN-adoption mistakes to avoid, once TURN is added (all with real precedent):**
- **Misconfigured open relay.** "Misconfigured Coturn servers regularly end up as open relays
  used by attackers, which gets the IP blocklisted" — a self-hosted TURN server needs credential
  management (time-limited, per-session credentials, not static shared secrets) from day one.
- **Single-region TURN defeats the point of multi-region bootstrap.** If the relay/bootstrap
  tier is sharded by region (already planned) but TURN is not, every cross-continent pair that
  falls through to TURN pays a return trip to one city anyway — the exact smearing effect the
  multi-region decision was meant to avoid.
- **Cost surprise from treating TURN like signaling.** TURN relays full media/data traffic, not
  just a handshake — video-call-scale guidance puts real TURN bandwidth at low-single-digit
  Mbps × 2 (both directions) per relayed session; for this project's small-message scheduler
  traffic the absolute bytes are far smaller, but the *pattern* (TURN cost scales with bytes
  actually carried, unlike the relay's fixed-window signaling cost) needs a separate budget line
  from Durable Object compute, not a shared one.
- **Given the existing Cloudflare relationship, evaluate Cloudflare's own TURN offering first**
  (reported pricing ~$0.05/GB with a free monthly tier, versus self-hosted coturn's
  operational burden of "TLS renewal, DDoS protection, kernel tuning, multi-region failover,
  credential rotation, and abuse monitoring") before standing up self-hosted coturn — the
  project is already inside Cloudflare's account and billing relationship, so this is the lower-
  friction default, not merely the cheaper one, at the volume a few hundred volunteers implies.
- **Accidentally forcing `iceTransportPolicy: 'relay'`** in a debug configuration and shipping
  it — this makes every connection pay TURN cost even when a free direct path exists, and is a
  common accidental regression precisely because it "still works" in testing.

**Bites:** during the run, concentrated by geography and network class exactly as predicted —
this is knowable in advance (hence "before the run" prevention: add TURN and instrument by
network class) but the concentration pattern itself only becomes visible with real, distributed
volunteers.

**Phase to address:** the TURN/relay-fallback phase — explicitly test the credential-rotation
and open-relay-hardening steps before the public run, and add "network class" (not just country)
as a dimension in Pitfall 8's funnel so cross-continent-vs-corporate can be told apart.

---

### Pitfall 10: Telegram's in-app browser is not the volunteer's real browser

**What goes wrong:**
A recruitment link opened from a Telegram group opens inside **Telegram's own in-app browser
(WebView)**, not the device's actual Chrome/Safari/Firefox — and a WebView differs from a full
browser in ways that specifically break a long-lived P2P client: it can lack full IndexedDB
durability guarantees, and most importantly it typically **suspends or kills the page's
JavaScript execution when the user backgrounds the Telegram app or switches tabs within it** —
which for a compute node whose entire value proposition is "stay connected and contribute
cycles" silently zeroes out participation the moment the volunteer does anything else with their
phone.

**Why it happens:**
This is the single most cohort-specific failure mode in this milestone, because the recruitment
channel (Telegram groups) is also the delivery mechanism for the failure — a general "browser
compatibility" test suite run by the project team, using real browsers, will never exercise this
path at all. WebView-based in-app browsers across platforms are well known for divergent
capability from the full browser they're built on (e.g., iOS in-app WebViews historically lack
some codec and storage guarantees Safari proper has) — this is a MEDIUM-confidence general
pattern; the exact current behavior of Telegram's specific WebView for WebRTC/IndexedDB was not
found in a single authoritative, current source during this research and should be verified
directly (open the intended landing page from an actual Telegram group link, on both iOS and
Android, before recruiting) rather than assumed from general WebView behavior.

**Prevention:**
- **Detect in-app browsers client-side** (a well-established pattern — user-agent/feature
  sniffing libraries exist specifically for this, e.g. detecting Telegram/Facebook/Instagram/
  Twitter in-app WebViews) and show an explicit **"Open in Chrome/Safari"** interstitial before
  any consent or connection flow begins, rather than letting the volunteer proceed into a session
  that will silently die on backgrounding.
  **Verify directly before the run**: open the actual recruitment link from a real Telegram
  message on both an iOS and an Android device, and confirm WebRTC connects and IndexedDB
  persists across a simulated background/foreground cycle — do not extrapolate from general
  WebView knowledge alone, this is cheap to check and expensive to get wrong at cohort scale.
- Add "opened from in-app browser" as a labeled category in the funnel from Pitfall 8, so this
  failure mode is distinguishable from a NAT failure rather than folded into a generic "failed"
  bucket.

**Bites:** before the run for the fix (interstitial + detection), but the failure itself is a
day-one, first-contact failure by definition — it is the very first thing a Telegram-recruited
volunteer does.

**Phase to address:** the entry-conditions phase — the "consent before a single CPU cycle" step
already planned is the natural place to insert in-app-browser detection, since both gate the
same moment (first page load, before anything real happens).

---

### Pitfall 11: Telemetry that produces anecdotes, and the opposite mistake

**What goes wrong (under-collection):**
The run ends with only qualitative volunteer reports ("it worked for me," "it didn't connect")
and no way to reconstruct the actual scaling curve, WebRTC failure rate by country, or diurnal
churn curve — the three numbers the milestone explicitly exists to produce. This is the failure
this project is most exposed to, since without the funnel from Pitfall 8, "hundreds of
volunteers ran it" produces a demo, not a dataset.

**What goes wrong (over-collection, the opposite mistake):**
Collecting IP addresses, device fingerprints, or precise geolocation "just in case it's useful
later," without a stated legal basis, is personal data under GDPR **and this cohort spans EU
jurisdictions by the milestone's own description** ("spread across many countries and
continents"). A concrete precedent for how this goes wrong even in a well-intentioned open-source
project: a real GitHub issue reports a project that "shipped telemetry enabled by default with an
opt-out consent model, with disclosure buried in preferences and no mention in the README" — for
EU/UK users, **default-on collection without prior explicit consent is not a valid GDPR lawful
basis**, and the fix had to be retrofitted as a breaking change after users noticed and objected.

**Why both happen from the same root cause:**
Nobody decided, in advance, exactly which fields are needed to answer the run's three headline
questions and which are not. Under-collection comes from not instrumenting enough; over-
collection comes from instrumenting broadly "to be safe" instead of deliberately.

**Prevention:**
- **Design the telemetry schema backward from the three headline numbers** (scaling curve,
  WebRTC failure rate by country/network class, diurnal churn), and collect exactly what each
  needs — no more, no less. Country and network class (ASN-derived category: residential /
  mobile / corporate / hosting) are needed; raw IP address is not, once that classification is
  done at collection time.
- **Aggregate, never store raw.** Classify IP → country + network class at the point of
  collection and discard the raw IP rather than storing it and aggregating later — this both
  satisfies data minimization and removes an entire class of later breach/compliance risk.
- **Explicit opt-in consent, before any telemetry point fires**, with the consent screen stating
  in plain language what is collected and why — not opt-out, not buried in a preferences panel.
  This is already aligned with the milestone's own planned "consent before a single CPU cycle"
  gate; extend that same gate to cover telemetry consent explicitly, not just compute consent.
- Publish the telemetry schema itself (what fields, what's aggregated, what's discarded) as part
  of the run's public materials — this is cheap reputational insurance and directly prevents the
  under-collection failure too, because writing the schema down forces the "what do we actually
  need" conversation before launch.

**Bites:** before the run (both the schema-design gap and the consent-model choice are launch-
time decisions) — but under-collection only becomes visible as a failure *after* the run ends and
someone tries to write up the results and finds the data isn't there.

**Phase to address:** the entry-conditions phase (consent gate covers telemetry, not just
compute) and should be a named acceptance criterion for the public-run phase ("telemetry schema
reviewed and frozen before recruitment begins").

---

### Pitfall 12: Spending a volunteer community on a run that was not ready

**What goes wrong:**
A few hundred Telegram-recruited volunteers are a **one-time, hard-to-replace asset** — trust and
goodwill, once spent on a broken or confusing first experience, do not fully regenerate with a
second announcement to the same group. Recruiting again from the same channels after a bad first
run reaches a visibly smaller, more skeptical audience.

**Signals a project was not ready (concrete, checkable, not vibes):**
- Any of Pitfalls 1–7 or 9 has not been load-tested against a realistic concurrent volunteer
  count before recruitment messages go out.
- The funnel from Pitfall 8 does not exist yet — meaning the team cannot answer "how many
  people connected" on day one of the run, only "here are some messages people sent us."
- There is no kill switch that needs no redeploy (already a planned target feature) — meaning if
  something goes wrong at 2 AM in the operator's timezone while volunteers in another timezone
  are active, the only remedy is an emergency deploy under pressure.
- The stop control that "provably drops CPU to zero" (already planned) has not actually been
  proven — a volunteer who cannot trust that closing the tab, or clicking stop, truly stops
  resource use is a volunteer who will not return, and will say so publicly in the recruiting
  channel.

**A real precedent for community cost from a rushed transition, not a broken launch but
structurally similar (added complexity without the community being ready for it):**
SETI@home's move to the BOINC platform saw its active volunteer base drop from roughly 600,000 to
roughly 300,000 — a 50% loss — driven by volunteers disliking the added complexity of the new
platform, not by any security or trust breach. The lesson generalizes: **the bar volunteers hold
a project to is "does this feel like it respects my time and my machine," and complexity or
friction alone, with no bad actor and no bug, is enough to halve a community.**

**Prevention:**
- Treat "load-tested at realistic concurrency" as a **go/no-go gate** for sending the recruitment
  message, not a nice-to-have — the Telegram groups are recruited once; the message that invites
  them is effectively irreversible in reputational terms.
- Consider a **staged rollout within the existing recruitment**: invite a small fraction first
  (e.g., one region, or a subset of groups), verify the funnel and the stop/kill controls under
  real (if smaller) load, then open to the full cohort — this converts an all-or-nothing launch
  into a checkpointed one without needing a second recruitment round.
- Make the **stop control's zero-CPU guarantee independently verifiable by the volunteer** (e.g.,
  visible in their own browser's task manager / activity monitor after clicking stop), not just
  true in the project's own telemetry — trust in a volunteer computing project is fundamentally
  about the volunteer's own ability to verify the project isn't lying to them about resource use,
  which BOINC's own documentation identifies as one of the core trust relationships volunteer
  computing depends on.

**Bites:** before the run in terms of the decision to launch, but the cost is realized entirely
during and after the run, in the form of a community that does not return for run two.

**Phase to address:** the entry-conditions phase (kill switch, stop control, staged-rollout
decision) as explicit go/no-go criteria before the public-run phase begins.

---

### Pitfall 13: Open source now, monetization later — the relicensing-backlash pattern

**What goes wrong:**
A project builds public goodwill and a contributor/user base under an open license, then adds
commercial-use monetization later — and the announcement of that change, however well-intentioned
or well-communicated, reads to the existing community as a bait-and-switch, triggering a fork of
the project by the community itself, taken with a meaningful share of users and momentum.

**Why it happens — three dated, well-documented precedents, all with the same shape:**
- **HashiCorp Terraform → BUSL, August 2023.** Terraform moved from the open MPL v2 to the
  Business Source License, a source-available (not OSI open-source) license. The community
  response was **OpenTofu**, a community-governed fork now under the Linux Foundation, reported
  at 10 million+ downloads.
- **Redis → dual RSAL/SSPL, March 2024.** Neither license qualifies as open source under the OSI
  definition. The Linux Foundation-backed fork, **Valkey**, launched within weeks with AWS,
  Google Cloud, and Oracle support, and reportedly reached ~83% enterprise adoption and nearly
  double Redis's pull-request rate before Redis itself reversed course back to AGPLv3 in May 2025
  — by which point Valkey had already become the de facto continuation for much of the ecosystem.
- **Elastic → SSPL, 2021**, prompting the **OpenSearch** fork (AWS-backed).

**Why this project is specifically exposed to the pattern:** PROJECT.md records the owner's
2026-08-24 ruling as "open source, with monetization for commercial use added later" — this is
structurally the same sequence (open first, monetize/restrict later) that produced all three
forks above, not merely a similar-sounding phrase.

**Prevention:**
- **State the monetization intent publicly and early**, in the repository itself (e.g.,
  CONTRIBUTING.md, README, or a dedicated licensing note), rather than letting the current
  license read as a permanent commitment that a future change would then appear to violate. All
  three precedent projects were read by their communities as having reneged on an *implicit*
  promise; a project that states up front "the license may change for commercial use, here is
  the reasoning" sets a different expectation from day one.
- **Decide now, not later, what "commercial use" will mean precisely**, and consider whether the
  eventual change is a restriction (like BUSL/SSPL, which triggered forks) or an additive
  commercial tier/product built *around* the still-open core (which does not trigger the same
  reaction, because the open core's terms never change retroactively). The forks above were all
  triggered by *changing the terms under existing code*, not by *adding a paid product next to*
  unchanged open code.
- If the future path is closer to "same open license forever, commercial product built adjacent,"
  say so explicitly now — this single clarification is the cheapest prevention available and
  costs nothing to state in the current milestone.

**Bites:** not this milestone directly — but the volunteer cohort recruited in this milestone
*is* the community whose trust is at stake when the monetization decision is eventually
announced, so the seeds of this pitfall are planted by how the open-source/monetization framing
is communicated to volunteers **during** this run, even though the fork risk itself materializes
later.

**Phase to address:** the entry-conditions / recruitment-messaging phase — whatever public-facing
copy invites volunteers should not overstate a permanent "always open" promise that a later
monetization decision would then contradict. This is a communications decision, not a code
change, and costs nothing to get right now.

---

### Pitfall 14: No-CLA + no outside contributions — the drive-by-PR taint risk

**What goes wrong:**
A project with "no outside contributions" as a stated policy still receives unsolicited pull
requests (this is normal on any public GitHub repo, policy or not). If a maintainer reads a
drive-by PR's diff closely, absorbs its approach or specific code even while formally rejecting
the PR, the resulting code has murky provenance — the contributor could later claim their
copyrighted contribution was used without attribution or license, which is exactly the kind of
claim that undermines the sole-authorship structure the "no CLA, no contributions" policy exists
to protect.

**Why it happens:**
PROJECT.md already records this as a live, deliberately-accepted risk: the owner "ruled to rely
on the civilized world rather than build CLA machinery" (2026-08-24) specifically because
relicensing for commercial use requires owning every line, and a CLA is the conventional
mechanism against exactly this risk. Relying on norms instead of a CLA is a legitimate choice,
but it shifts the burden onto **maintainer discipline** rather than **process** — and that
discipline is precisely what's easy to erode "one merged pull request at a time," in the
project's own words.

**Prevention (the mechanical safeguard for a no-CLA policy):**
- **Close unsolicited PRs unmerged**, always, without reading the diff line-by-line if it can be
  avoided — read the *issue description* or the *bug report* if one exists, and implement the fix
  independently from that description, never by adapting the PR's own code or patch.
- If a PR is genuinely useful as a *bug report*, extract the problem statement into an issue, close
  the PR, and implement from the issue — this preserves the "sole authorship of every line" claim
  in a way that closing-with-a-thank-you but merging-the-diff does not.
  This is not currently a written policy anywhere the research found in this repository, and
  making it explicit (even as a one-line CONTRIBUTING.md note: "PRs are read for triage only and
  never merged; fixes are implemented independently from the reported issue") costs nothing and
  directly operationalizes the owner's already-stated ruling.

**Bites:** not specific to this milestone's phases, but the public run in this milestone is the
point at which the project's visibility and inbound-PR volume from a genuinely public audience
first rises materially — a few hundred engaged volunteers are also a few hundred people newly
capable of opening a PR.

**Phase to address:** no code phase — a documentation/process fix (CONTRIBUTING.md) that should
land before or during this milestone's public run, since that's when inbound PR volume is likely
to first become nontrivial.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|-----------------|------------------|
| Ship the record store before the expiry sweep | Persistence feature lands sooner | Unbounded storage growth against real public-cohort data, expensive to retrofit under live load | Never for this milestone — sequence sweep first (Pitfall 4) |
| Report a single "connection success" metric instead of the six-stage funnel | Simpler dashboard, faster to build | Cannot answer the run's own headline questions after the fact; anecdote instead of measurement (Pitfall 8/11) | Never — the funnel is cheap to build relative to what it buys |
| Leave `iceTransportPolicy` at its debug/testing value when shipping | One less thing to configure | Forces every connection through TURN even when free direct paths exist, silently inflating TURN cost | Never in the shipped client |
| Treat "the alarm fired correctly once" (consult §5) as proof the sweep is production-ready | Faster to declare the expiry feature done | Ignores the alarm-loop cost failure mode entirely (Pitfall 2), which is about repeated/unbounded firing, not single-fire correctness | Never — always add the reschedule-guard test separately |
| Defer the in-app-browser check because "most people use real browsers" | Saves a small UI branch | Telegram-recruited cohort specifically routes through in-app browsers; day-one silent failure for an unknown fraction of the exact audience being recruited | Never for this cohort — acceptable only for a non-Telegram-recruited audience |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|-------------------|
| Cloudflare Durable Object alarms | Reschedule unconditionally on every wake, no existing-alarm check | `getAlarm()` before `setAlarm()`; enforce a minimum interval; billing alert configured pre-launch |
| Cloudflare WebSocket + libp2p | Accept a plain (non-hibernatable) socket and hold it open for cost-free "keep-alive" | Write the listener against the hibernation API from the start; measure keep-alive-vs-hibernation cost before choosing |
| Cloudflare subrequest budget | Assume a small fixed simultaneous limit (~6) or no limit at all | It's 50 cumulative per invocation, closing doesn't refund it, reuse is free — design a connection pool, not a smaller fan-out |
| `@libp2p/kad-dht` on a persistent backend | Assume the library's own defaults (no expiry) are safe because they were safe on ephemeral/browser storage | Expiry must be built at the application layer for any persistent backend; the library will not do it |
| `webSocketToMaConn` on a Cloudflare socket | Omit `direction`, or fake `bufferedAmount`/`binaryType` through a Proxy | Pass `direction: 'inbound'` explicitly; supply real values Cloudflare actually provides, accept the backpressure gap (`bufferedAmount` absent) as a known limitation rather than papering over it with a lie |
| Relay-derived remote address | Pass a placeholder/loopback address for every inbound connection | Derive from `CF-Connecting-IP` — required for libp2p's own per-host rate limiting to apply correctly instead of globally |
| Telegram recruitment link | Assume the click opens the volunteer's real browser | Detect in-app WebView, verify actual behavior on iOS/Android before launch, present an "open in browser" interstitial |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|-----------------|
| Cold-dialing many peers per Worker invocation | `Too many subrequests` errors under load that never appeared in dev | Warm connection pool reused across invocations | Exactly at 50 new connections in one invocation |
| Non-hibernatable sockets at volunteer scale | Durable Object cost rises with concurrent open sessions regardless of traffic volume | Hibernation-aware listener | Scales linearly with concurrent volunteer count × session duration — visible only at real cohort scale, not in single-digit dev testing |
| Relayed-fallback protocols sized against 128 KiB | Mid-exchange failures specifically for pairs that fell through to the relay | Size request/response pairs against 64 KiB per direction | Only for pairs on the relayed fallback path — invisible if testing only exercises direct WebRTC |
| Single-region relay/TURN despite multi-region bootstrap | WebRTC failure-rate data smeared toward one city's latency and NAT-traversal characteristics | Shard TURN alongside bootstrap, same regions | Only visible once volunteers are genuinely cross-continent — undetectable in any single-region test |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Self-hosted TURN with static/long-lived shared-secret credentials | Server becomes an open relay, IP gets blocklisted, abused for unrelated traffic | Time-limited, per-session TURN credentials; monitor relay traffic for non-project usage patterns |
| No billing alert before Durable Objects go live | A code bug (Pitfall 2) becomes a five-figure invoice discovered days later, with no platform warning | Configure a billing alert threshold as a pre-launch checklist item, verified before the first real deployment |
| Storing raw IP addresses "for later analysis" | GDPR exposure across an EU-inclusive cohort; unnecessary breach-risk surface | Classify to country + network class at collection time, discard the raw IP |
| Reading and adapting unsolicited PR diffs under a no-CLA policy | Copyright-provenance taint that undermines the sole-authorship relicensing plan | Close PRs unmerged; implement independently from the reported issue, never the diff |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-------------------|
| No feedback when a connection silently falls back to relay/TURN | Volunteer believes they're contributing full peer-to-peer capacity when they're actually bottlenecked through a relay | Show connection quality/type honestly in the client UI, matching the internal telemetry split from Pitfall 1 |
| Stop control that isn't independently verifiable | Volunteer distrust — "I clicked stop but my fan is still spinning" — is a documented category of volunteer-computing trust failure | Make CPU drop to zero visibly confirmable in the OS's own tools, not just asserted by the app |
| Recruitment link opens broken in Telegram's in-app browser with no explanation | First impression is "this is broken," not "open this in your browser" | Explicit interstitial with a one-tap "open in [browser]" action |
| Silent, unexplained connection failure for symmetric-NAT/corporate-network volunteers | Volunteer assumes the project is buggy rather than understanding their network is the constraint | Give an honest, specific in-app message ("your network blocks direct peer connections; using a fallback relay") rather than a generic failure |

## "Looks Done But Isn't" Checklist

- [ ] **Record expiry**: Often missing the reschedule guard — verify `getAlarm()` is checked
  before every `setAlarm()`, not just that the alarm fires once correctly.
- [ ] **Inbound listener**: Often missing real client addressing — verify with more than 5
  concurrent distinct simulated addresses, not 1–2 peers, since the rate-limit bug is invisible
  below that threshold.
- [ ] **Multi-region bootstrap**: Often missing a matching multi-region TURN/relay fallback —
  verify cross-continent pairs aren't all routing signaling through one region regardless of
  where bootstrap addresses were sharded.
- [ ] **Consent gate**: Often covers compute consent but not telemetry consent separately —
  verify the telemetry schema is reviewed and the consent screen names it explicitly.
- [ ] **"Stop" control**: Often verified only via internal telemetry — verify a volunteer can
  independently confirm zero CPU/network use via their own OS tools after clicking stop.
- [ ] **Public-run dashboards**: Often report aggregate success/fail — verify the six-stage
  funnel (Pitfall 8) and the P2P-vs-relayed split (Pitfall 1) are both present before recruitment
  messages go out, not added mid-run.

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|----------------|-----------------|
| Alarm-loop cost blowup (Pitfall 2) | LOW–MEDIUM | Disable the alarm handler immediately (kill switch), add the guard, redeploy; financial recovery via Cloudflare support request citing the documented incident pattern is sometimes possible but not guaranteed |
| Hosted tier became load-bearing (Pitfall 1) | HIGH | Cannot be fixed mid-run without re-architecting; the relay-kill drill is the cheap version of this recovery, run deliberately before the cost is real |
| Storage growth without expiry (Pitfall 4) | MEDIUM | Ship the sweep, run a one-time backfill pass against accumulated records, accept a temporary storage-cost spike during backfill |
| Community trust spent on an unready run (Pitfall 12) | HIGH | No clean technical fix; a public, specific postmortem plus a visibly fixed staged re-launch is the only path that has worked elsewhere (e.g., projects that recovered from bad launches did so with transparent fixes, not silent redeployment) |
| Relicensing-backlash risk materializing later (Pitfall 13) | HIGH (if mishandled) / LOW (if pre-communicated) | If communicated clearly from this milestone onward, the eventual monetization announcement is not a surprise and a fork is far less likely; if not, the OpenTofu/Valkey pattern (community fork, most users following it) is the realistic outcome |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|-------------------|----------------|
| 1. Hosted tier becomes load-bearing | Multi-region relay phase + public-run phase | Two-counter P2P/relayed split reported; relay-kill drill executed with bounded, measured degradation |
| 2. Alarm loop cost blowup | Record-expiry phase | `getAlarm()`-guarded reschedule test; billing alert configured before first real deploy |
| 3. Cost from held sockets | Inbound-listener phase + entry-conditions phase | Hibernation-aware listener shipped; stop control verified to drop duration billing, not just CPU |
| 4. Storage growth before expiry | Record-expiry phase | Sweep observed running against real (not synthetic) records before persistence ships |
| 5. Listener silently throttles | Inbound-listener phase | Integration test with >5 concurrent distinct addresses passes |
| 6. Relayed fallback assumed symmetric at 128 KiB | TURN/relay-fallback phase | Protocol spec states 64 KiB/direction; boundary test in CI |
| 7. Cold fan-out exceeds subrequest cap | Gateway/routing phase (if built) or explicit scope-out | Connection-pool design reviewed; fan-out load-tested against 50-per-invocation cap |
| 8. Unmeasured public failure rate | Entry-conditions phase + public-run phase | Six-stage funnel instrumented and reporting live before recruitment |
| 9. Cross-continent TURN gaps | TURN/relay-fallback phase | TURN sharded to match bootstrap regions; credential rotation and open-relay hardening verified |
| 10. Telegram in-app browser | Entry-conditions phase | In-app-browser detection verified against real Telegram links on iOS and Android before recruiting |
| 11. Telemetry under/over-collection | Entry-conditions phase | Schema frozen and reviewed against the three headline questions; explicit opt-in consent shipped |
| 12. Community trust spent early | Entry-conditions phase (go/no-go gate) | Staged rollout plan exists; kill switch and stop control independently verified before full recruitment |
| 13. Relicensing-backlash pattern | Recruitment-messaging (this milestone) | Public communication doesn't overstate a permanent-open promise the later ruling would contradict |
| 14. No-CLA drive-by-PR taint | Documentation (any point in this milestone) | CONTRIBUTING.md states the close-unmerged-and-reimplement policy explicitly |

## Sources

- [The Cloud Strikes Back: Investigating the Decentralization of IPFS (arXiv:2309.16203)](https://arxiv.org/pdf/2309.16203) — MEDIUM confidence, peer-reviewed measurement study
- [Matrix.org — Why the Matrix.org Homeserver Exists](https://matrix.org/blog/2024/03/why-matrix-org/) — HIGH confidence, primary source
- [Durable Object alarm loop: $34k in 8 days, zero users, no platform warning — Hacker News](https://news.ycombinator.com/item?id=47787042) — HIGH confidence, dated, specific incident; single-source (community report), treat exact dollar figure as reported rather than independently audited
- [Cloudflare Durable Objects Alarms — "a wake-up call for your applications"](https://blog.cloudflare.com/durable-objects-alarms/) — HIGH confidence, official
- [Cloudflare Workers/Durable Objects pricing docs](https://developers.cloudflare.com/durable-objects/platform/pricing) — HIGH confidence, official (duration billing on `accept()`, 20:1 WebSocket message ratio)
- [Challenging Tribal Knowledge — Large Scale Measurement Campaign on Decentralized NAT Traversal (arXiv:2510.27500)](https://arxiv.org/pdf/2510.27500) — HIGH confidence, peer-reviewed, 4.4M data points; note the protocol measured is DCUtR/libp2p, analogous but not identical to raw browser WebRTC ICE
- [webrtcHacks — Am I behind a Symmetric NAT?](https://webrtchacks.com/symmetric-nat/) and industry WebRTC/TURN guidance (VideoSDK, bloggeek.me) — MEDIUM confidence, industry sourcing, not peer-reviewed
- BOINC / SETI@home community history (David P. Anderson, "A brief history of BOINC"; BOINC wiki "VolunteerComputing") — MEDIUM confidence, primary/near-primary source for the 600k→300k figure and the volunteer-trust framing
- [blender-mcp GitHub issue #232 — telemetry opt-out/GDPR](https://github.com/ahujasid/blender-mcp/issues/232) — MEDIUM confidence, single concrete real-world example
- Coturn/TURN cost and operational-burden sourcing (coturn GitHub issues, DEV Community TURN cost guide, Callsphere coturn-vs-Cloudflare comparison) — MEDIUM confidence, industry sourcing
- HashiCorp/Terraform BUSL, Redis/Valkey, Elastic/OpenSearch relicensing history (InfoWorld, The Stack, SoftwareSeni, FlowVerify) — HIGH confidence for the historical facts (dates, license names, fork outcomes are well-documented and cross-confirmed across sources); MEDIUM confidence for adoption-percentage figures (self-reported/industry-blog sourced, not independently audited)
- `.planning/consults/2026-08-24-cloudflare-as-a-fabric-node-measured.md` — this project's own primary measurement, HIGH confidence throughout (directly cited by section number above)
- `.planning/PROJECT.md` — this project's own decisions and constraints record, HIGH confidence (primary source for scope and prior rulings)
- General WebView/in-app-browser divergence pattern — LOW confidence for Telegram specifically; flagged explicitly as unverified and requiring direct pre-launch testing

---
*Pitfalls research for: v2.0 "Open the Doors" — hosted tier + public cohort*
*Researched: 2026-08-25*
