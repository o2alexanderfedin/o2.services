# Feature Research — v2.0 "Open the Doors"

**Domain:** Volunteer / browser-based distributed computing — the participant-facing and
operator-facing layer around an *already-built* compute fabric, for a first public cohort of a
few hundred people recruited from Telegram, unpaid, across many countries.
**Researched:** 2026-08-25
**Confidence:** MEDIUM-HIGH on consent/trust findings (multiple corroborating named incidents
and one still-operating precedent, AuthedMine); MEDIUM on browser-throttling mechanics (official
Chrome engineering blog + corroborating security research); LOW-MEDIUM on operator-tooling
specifics (BOINC/World Community Grid documentation is thin on internal ops practice, so those
rows lean on general distributed-systems practice rather than a named precedent).

**Scope note.** This project pays nobody and has no token/credit economy — `PROJECT.md`
excludes incentives, payments, staking, and reputation markets from scope entirely, and BOINC's
"points" and Folding@Home's "team leaderboard" are the closest precedents for a *reputation*
layer, not a payment one. Nothing below assumes payment. Where a precedent (Coinhive) *was*
about payment, it is cited only for what its consent/disclosure failure teaches, not as a
feature to imitate.

## Executive Summary

Every incident researched here has the same shape: a page used CPU without telling the visitor,
was discovered by a third party, and the discovery cost far more trust than the CPU-cycles ever
earned. The Pirate Bay, Showtime/CBS, and the BrowseAloud/ICO.gov.uk supply-chain attack are not
edge cases — they are *why* "runs in your browser tab" is now a phrase that makes security-aware
people reach for uBlock Origin before they read the pitch. Coinhive itself tried to fix this
with an opt-in variant (AuthedMine) and still could not outrun the reputation of the tool it had
built — antivirus vendors and ad-blockers filtered its domain by default regardless of which
variant a given site used. **The lesson for this milestone is not "add a consent dialog" — it is
that consent must be structurally impossible to route around, because the domain's own history
proves that any silent path will be found, publicized, and used to discredit every legitimate
user of the same technique in the same news cycle.**

The second finding is that browsers themselves have spent a decade hardening against exactly
this pattern (Chrome's background-tab timer throttling since Chrome 57, intensive throttling
since Chrome 88, Energy Saver mode since Chrome 110) — and cryptojacking scripts responded by
moving work into Web Workers specifically *because* Workers are not subject to the same
throttling as main-thread timers. This project already runs execution in Workers for legitimate
architectural reasons (WASM sandboxing, `comlink` RPC per `STACK.md`). That is the *same
technical shape* a detector or a suspicious user will see. The mitigation is not architectural —
it is that the always-on indicator and the stop control must be more visible and more reliable
than what a legitimate site would otherwise have any reason to build, precisely to distinguish
this project from the pattern it structurally resembles.

The third finding is that "what should we build" is a smaller question here than "what is a
condition of entry" — because a Telegram-recruited volunteer cohort of a few hundred people
across many countries is a resource that can be spent exactly once. A bad first impression
(battery drain with no visible cause, a kill switch that doesn't work, silence when something
breaks) does not just lose that volunteer — in a Telegram group it is one screenshot away from
losing the next fifty. That reframes the whole list: several items below are not "nice UX," they
are the difference between a cohort that can be re-invited for v2.1 and one that cannot.

## Feature Landscape

### Table Stakes — Conditions of Entry (must exist before the first volunteer is invited)

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **Explicit opt-in before any CPU cycle runs** | Every credible precedent requires this, and every named incident is a case of skipping it. BOINC requires an account + explicit "attach to project" step; even Coinhive's *own* later product (AuthedMine) added a user-facing opt-in dialog because the original silent version was correctly deemed hijacking by browsers and antivirus vendors. There is no version of "silent by default, opt-out later" that survives contact with a security-literate audience, and this audience — recruited from Telegram, i.e. people already inclined to read a script before running it — is exactly that. | LOW–MEDIUM | The gate must block *before* the WASM module is even fetched, not just before execution — fetching alone can look like preparation-to-mine to a reviewer reading network traffic. Depends on: nothing new architecturally, but must be wired ahead of task dispatch, not layered on after. |
| **A persistent, unmissable "this tab is computing" indicator** | Chrome, Firefox, and Safari have all built visible indicators for exactly this class of resource use (Chrome's Energy Saver leaf icon, per-tab CPU/memory hover card since Chrome 110-ish; Chrome Task Manager since 2011) — the browser vendors themselves have decided silent background CPU use is untrustworthy enough to need a chrome-level indicator. A page that runs a Worker at meaningful CPU and shows nothing in the page itself is indistinguishable, to a skeptical visitor or a security researcher, from the incidents in the Pitfalls section below. It must be visible even when the page is not scrolled to, e.g. in the tab title (`•` or a spinner glyph) or via the Page Visibility / favicon, not only in page body content that requires the tab to be focused to see. | LOW | No load-bearing dependency; this is a UI feature over existing task-execution state. |
| **A stop control that provably drops CPU to zero, reachable in one action, always visible while running** | BOINC's own docs make suspend/resume a first-class preference precisely because volunteers must be able to reverse the donation instantly and without qualification. The Pirate Bay's second and more damaging incident (`bleepingcomputer.com`, "no opt-out") was specifically that there was *no way to stop it* — the absence of a stop control, not the presence of mining, is what news coverage led with the second time. "Provably" matters: a stop button that merely stops *dispatching new tasks* while an in-flight task keeps running on the CPU is a partial truth that will be caught by exactly the audience most likely to check (open DevTools → Performance). | LOW–MEDIUM | Depends on the WASM sandbox already supporting `Worker.terminate()`-class hard interruption (per `PROJECT.md`'s existing sandbox) rather than only cooperative task-boundary stopping. |
| **A page-level statement of what is collected and why, written in plain language, before opt-in** | GDPR-class expectations aside (many of these few hundred volunteers will be in the EU/EEA given "many countries and continents"), the specific domain history (BrowseAloud, Showtime) means "we didn't tell you" is the single most damaging accusation available, independent of what was actually collected. It must say: what work runs, whose task it is, what data leaves the device (this project's own sovereignty guarantee — that raw data never leaves the owner's node — is a *selling point* here and should be stated, not buried), and what telemetry is sent back (see Telemetry section). | LOW | No new capability — this is copy plus a link from the consent gate. High leverage relative to cost. |
| **Kill switch operable without a redeploy** | Already named explicitly as a v2.0 target feature in `PROJECT.md` ("a kill switch that needs no redeploy"). Precedent for *why* this is non-negotiable rather than a nice-to-have: Coinhive-class incidents were resolved by the *site* removing a script, which took hours-to-days once discovered, during which trust bled continuously and visibly (news coverage timestamps this). For hundreds of volunteers spread across time zones, "we'll ship a fix" is not a fast enough control surface — an operator must be able to halt dispatch to the whole cohort, or to one region/version, within minutes, independent of the deploy pipeline. | MEDIUM | Depends on the DHT registration/discovery layer already built — a kill switch is most simply a flag the scheduler checks before admitting a node or dispatching to it, not a new distribution mechanism. |
| **A status page volunteers and the operator can both read** | Every volunteer computing project with any longevity (BOINC's project-level web front ends, World Community Grid's stats pages) has a public-facing "is it working, how much has been done" page — its absence reads as "abandoned" or "opaque" within days for a Telegram-recruited cohort who will ask each other "is this still running?" in the group chat if there's nowhere to check. | LOW–MEDIUM | Depends on the benchmark harness and DHT registration already existing — the status page is a read view over data the fabric already produces (active node count, recent task throughput), not a new telemetry pipeline. |
| **A visible answer to "what did my machine do, and for whom"** | This is the single feature every long-lived precedent gets right and every failed one skips. Folding@Home's dashboard shows the specific disease-research project a work unit contributed to; BOINC shows per-project credit and a notices feed. The absence of this is *why* silent cryptomining reads as theft even at identical CPU cost — credit and purpose are what convert "my CPU was used" from a grievance into a contribution. | LOW–MEDIUM | Depends on task metadata already carried by the scheduler (job identity, requester) — this is a display layer over an existing capability chain, not new state. |
| **A visible network cost, not just a CPU cost, disclosure** | This project's compute fabric moves task manifests and partial results over WebRTC/relay, and the constraints section of this repo's own `CLAUDE.md` documents real per-hop and per-connection data movement. Mobile users on metered data are a real subset of "many countries" — some fraction of a Telegram-recruited international cohort will be on mobile data plans where even modest KB-scale exchange has a real cost perception, distinct from CPU/battery. The consent screen must say approximately how much data moves, not only how much CPU is used. | LOW | Depends on nothing new; needs a rough measured number from the benchmark harness. |

### Differentiators (competitive / trust advantage, not required for entry but high-value)

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **Automatic pause on low battery / battery-saver mode, without relying on the Battery Status API** | Firefox removed the Battery Status API entirely in 2016 specifically because it was a fingerprinting vector (Mozilla, via `bugzilla.mozilla.org` #1313580; corroborated by `schneier.com` and `bleepingcomputer.com` coverage), and Safari never shipped it — so a cross-browser "detect battery level and back off" cannot be built on that API at all in 2026. The available substitute is `navigator.connection.saveData` / the platform's own low-power-mode signal reflected indirectly through throttled timers, or (more reliably) a user-set preference, mirroring what BOINC does explicitly via configured preferences ("only compute on AC power") rather than device detection. Building this as a *stated preference the volunteer sets*, not silent detection, sidesteps both the missing API and the fingerprinting concern that killed it. | MEDIUM | Depends on the WASM task scheduler being able to accept a live throttle/pause signal, which the stop-control mechanism above already requires — this differentiator is mostly the same mechanism exposed as a policy rather than a manual action. |
| **A "how much have I contributed" personal running total, distinct from a leaderboard** | Folding@Home and BOINC both do this (points, credit), and academic study of Folding@Home participation (`theoryandpractice.citizenscienceassociation.org`) found team affiliation and visible contribution positively correlated with sustained participation. This project explicitly excludes incentive/reputation *markets* (`PROJECT.md`), but a personal, non-competitive contribution counter is not a market — it's the same thing UNICEF's Hopepage and Folding@Home use to make the invisible visible, without creating scarcity, ranking, or payment. | LOW–MEDIUM | Depends on the same task-metadata trace as "what did my machine do" above; this is an aggregation view over it. |
| **Staged/regional rollout of the cohort rather than an all-at-once invite** | Not evidenced by a named browser-compute precedent (this is a gap — see Gaps below) but is standard practice for any system being exposed to real, uncontrolled network diversity for the first time, and directly serves this milestone's own stated goal of measuring "WebRTC failure rate by country and network class" (`PROJECT.md`). Inviting in waves by region also bounds the blast radius of any discovered bug to a fraction of the relationship capital, rather than all of it at once. | LOW | Purely an invitation/ops practice — no new software capability, just sequencing of who gets the link when. Composes naturally with the multi-region bootstrap tier already planned for this milestone. |
| **A visible "why this project, why WASM-in-your-browser, and why it's not what you're thinking of" explainer** | Given the domain's specific reputational baggage (Coinhive, BrowseAloud), pre-empting the "is this cryptomining" question directly and by name, rather than hoping it doesn't come up, is a differentiator relative to every precedent studied — none of the trustworthy precedents (BOINC, Folding@Home, AuthedMine) needed to address cryptojacking by name because they predate or are outside that specific reputational shadow. This project is explicitly *not* that (no payment, no token), and saying so plainly, by name, is cheap and directly defuses the most likely first objection in a technically literate Telegram audience. | LOW | Copy only. No dependency. |

### Anti-Features (attractive-looking, reliably backfire in this domain)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|------------------|-------------|
| **Any silent/default-on execution, even "for just a few seconds to test connectivity"** | Reduces friction, feels like "just a ping" | This is the exact shape of every incident cited above — the size or duration of the silent execution was never what made Pirate Bay/Showtime/BrowseAloud scandalous, the *silence* was. There is no duration short enough to be safe from this once discovered and screenshotted in a Telegram group. | Consent gate before any WASM fetch or execution, full stop, regardless of duration. |
| **Points / leaderboards / competitive team rankings** | Folding@Home's team system is credited with sustaining engagement over decades | `PROJECT.md` explicitly rules out incentives/reputation *markets*, and a competitive leaderboard is a soft version of exactly that — it creates status stakes that invite gaming (fake nodes, always-on scripts left running unattended purely to rank), which is a integrity and abuse-surface problem this milestone has no mechanism to police. A personal, non-comparative contribution counter (the differentiator above) captures the "make it visible" benefit without the competitive-gaming incentive. | Personal contribution counter only; no team/rank feature this milestone. |
| **A payment, token, or "earn crypto" framing of any kind** | Coinhive-era intuition: "if you're using my CPU, pay me something" | Explicitly out of scope (`PROJECT.md`) and this repository's own research already found "browser compute demonstrably cannot be paid" — Coinhive's largest operators earned single-digit dollars over months before ad-blockers and antivirus made the model economically dead by 2019. Introducing payment framing for a volunteer, unpaid, open-source project also reintroduces exactly the reputational shadow (cryptomining-for-money) this project needs to distance itself from. | Frame contribution as donation of otherwise-idle capacity to open-source research, never as earning anything. |
| **Detecting and auto-adjusting to "the user probably isn't looking, ramp up intensity"** | Maximizes throughput per volunteer-hour | This is *precisely* what cryptojacking scripts do — the "stay low, mine slow" and Web-Worker-to-evade-throttling pattern documented in security research on in-the-wild cryptojacking (arXiv 1808.09474) is the same optimization target. Any code that infers attentiveness/visibility and *increases* resource use when unwatched is indistinguishable in behavior from malware, however well-intentioned the authorship, and would be flagged by exactly the antivirus/ad-blocker heuristics that killed Coinhive. | Resource use should be flat or *decrease* with tab visibility (matching, not fighting, the browser's own Page Visibility signal), never increase when unwatched. |
| **A single global on/off switch with no regional or cohort-slice granularity** | Simpler to build | If problems concentrate by region or network class (which this milestone expects, given the multi-region and NAT-traversal focus), an all-or-nothing kill switch means one bad region takes the whole cohort offline, burning trust with volunteers whose region was never affected. | Kill switch scoped to region/version/cohort slice, not only global. |
| **Requiring a native app, browser extension, or elevated permission install to participate** | Would sidestep some browser throttling and sandboxing limits | Defeats the entire point of "every visitor to a web page is a potential compute node" (`PROJECT.md`'s own core value) and reintroduces the friction BOINC/Folding@Home already have (install-then-attach) that this project's architecture is specifically built to avoid. It would also, ironically, look *more* like malware to a security-conscious volunteer, not less — "install this extension to donate CPU" is a bigger ask of trust than "click allow in this tab." | Stay in-tab, no install, consistent with the existing WASM-in-browser architecture. |

## Feature Dependencies

```
[Consent gate before execution]
    └──requires──> [Task dispatch already gated on a boolean/capability check]
                       (exists: capability chains, node certificates — PROJECT.md)

[Always-on indicator] ──enhances──> [Consent gate]
[Stop control (hard)] ──requires──> [WASM sandbox supports Worker.terminate()-class interrupt]
                                        (exists: WASM execution sandbox — PROJECT.md)

[Kill switch, no redeploy] ──requires──> [DHT registration/discovery already reachable at dispatch time]
                                              (exists: DHT registration and discovery — PROJECT.md)
[Kill switch, no redeploy] ──enhances──> [Staged/regional rollout]  (kill switch is what makes staging safe)

[Status page] ──requires──> [Benchmark harness producing throughput/node-count numbers]
                                 (exists: benchmark harness — PROJECT.md)
["What did my machine do" view] ──requires──> [Task metadata: job identity, requester]
                                                   (exists: capability chains carry this)
["Personal contribution counter"] ──enhances──> ["What did my machine do" view]

[Automatic low-power pause] ──requires──> [Stop control (hard) mechanism, exposed as a policy signal
                                            rather than a one-shot user action]
```

### Dependency Notes

- **Consent gate requires an existing capability check, not a new one:** the fabric already
  gates task admission on certificates/capability chains; the consent gate is the same
  admission check extended to include "has this specific human clicked allow in this specific
  tab session," which is new state but not a new mechanism class.
- **Stop control requires hard interrupt, not cooperative stop:** a task that only stops
  accepting *new* work when told to stop, while letting an in-flight WASM call run to
  completion, is not what "provably drops CPU to zero" means. This must resolve to whatever the
  WASM sandbox's actual termination primitive is (Worker termination, per `STACK.md`'s
  recommendation to run in dedicated Workers with `comlink` RPC).
- **Kill switch enhances staged rollout, and staged rollout is what makes a kill switch's blast
  radius small in the first place:** these two are complementary, not sequential — build the
  kill switch first (table stakes), then use staged/regional invitation (differentiator) to
  reduce how often it needs to be pulled.
- **Status page and "what did my machine do" are both read-views over existing telemetry, not
  new instrumentation:** the highest-leverage items in this list are display work over
  capabilities the project has already built (DHT records, capability chains, benchmark
  harness), which is why several table-stakes rows are rated LOW–MEDIUM complexity despite being
  conditions of entry.

## MVP Definition — Reframed as Conditions of Entry vs. Can Follow

Per the downstream consumer's framing: a volunteer cohort can only be spent once, so this
section separates **must exist before the invite goes out** from **can ship in a later phase of
the same milestone, or even v2.1, without damaging the first impression.**

### Conditions of Entry (before a single Telegram invite is sent)

- [ ] Explicit opt-in gate, blocking before WASM fetch — the single most load-bearing item on
      this whole list; every named incident is a failure of exactly this
- [ ] Persistent always-on indicator visible without requiring the tab to be focused/scrolled
- [ ] Stop control with a *hard* interrupt, one action, always reachable while running
- [ ] Plain-language disclosure of what runs, whose task, what leaves the device, what
      telemetry is sent — shown before opt-in, not after
- [ ] Kill switch operable with no redeploy, scoped at minimum to "stop admitting new tasks
      cohort-wide" and ideally to region/version slices
- [ ] A minimal status page (even a static page reading from existing DHT/benchmark data) so
      volunteers have somewhere to check "is this working"
- [ ] Rough data-cost disclosure alongside the CPU disclosure, for the mobile-data subset of the
      cohort

### Can Follow Within the Same Milestone (after the invite, before or during the run)

- [ ] "What did my machine do, and for whom" view with real per-task detail (a coarser "your
      tab contributed to N tasks" can ship at entry; per-task granularity can follow)
- [ ] Personal (non-competitive) running contribution counter
- [ ] Automatic low-power-mode pause as a *policy* rather than a one-time manual stop
- [ ] Staged/regional rollout sequencing (this is an invitation-ops practice more than a
      software feature, and can be adjusted between waves)

### Explicitly Deferred / Out of Scope (do not build for this milestone, and say why if asked)

- [ ] Leaderboards, team rankings, or any competitive framing — anti-feature, see above
- [ ] Any payment/token/earning framing — out of scope per `PROJECT.md`, and reputationally
      counterproductive in this specific domain
- [ ] Attentiveness-adaptive intensity ramping — anti-feature, behaviorally identical to
      cryptojacking evasion techniques
- [ ] Browser extension or native install path — defeats the project's own core value

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|----------------------|----------|
| Consent gate before execution | HIGH | LOW–MEDIUM | P1 |
| Always-on indicator | HIGH | LOW | P1 |
| Hard stop control | HIGH | LOW–MEDIUM | P1 |
| Plain-language disclosure copy | HIGH | LOW | P1 |
| Kill switch, no redeploy | HIGH | MEDIUM | P1 |
| Status page | MEDIUM–HIGH | LOW–MEDIUM | P1 |
| Data-cost disclosure | MEDIUM | LOW | P1 |
| "What did my machine do" view | MEDIUM–HIGH | LOW–MEDIUM | P2 |
| Personal contribution counter | MEDIUM | LOW–MEDIUM | P2 |
| Automatic low-power pause policy | MEDIUM | MEDIUM | P2 |
| Staged/regional rollout sequencing | MEDIUM | LOW (ops, not code) | P2 |
| Leaderboards/teams | LOW (net negative, see anti-features) | MEDIUM | Rejected |
| Payment/token framing | Negative | — | Rejected |
| Attentiveness-adaptive intensity | Negative | — | Rejected |

**Priority key:** P1 = condition of entry, must exist before the invite. P2 = should exist
before or during the run but does not block sending the first invite. Rejected = anti-feature,
do not build.

## Precedent Comparison

| Dimension | BOINC / World Community Grid | Folding@Home | Coinhive / AuthedMine | This project's v2.0 plan |
|-----------|-------------------------------|---------------|------------------------|---------------------------|
| Install model | Native client install + account | Native client install | In-page script, no install | In-page, no install (differentiator vs. BOINC/F@h; shares the "no install" property with Coinhive, which is exactly why consent discipline matters more, not less) |
| Consent | Explicit attach-to-project step | Explicit install + config | **Originally silent (the scandal); AuthedMine added opt-in later** | Explicit opt-in gate, blocking, before fetch |
| Stop control | Preferences: suspend, % CPU, AC-only, idle-only | Pause/resume in client | Site removes script (site-level, not user-level, in the silent version) | User-level, in-tab, one action, hard interrupt |
| Visibility of contribution | Per-project credit, notices feed | Points, work-unit disease/project detail, teams | None (silent) / minimal (AuthedMine) | "What did my machine do, for whom," personal counter |
| Payment/incentive | Points only, no payment | Points + teams, no payment | **Was literally about payment (to the site operator, not the volunteer)** | None — explicitly out of scope |
| Status visibility | Public project stats pages | Public stats, team ladders | None | Status page (planned) |
| Kill switch / rollout control | Project-level, not documented publicly in granular form | Not documented publicly | None (part of the scandal) | Explicit target: kill switch + staged rollout |

## Sources

- [The Pirate Bay caught secretly running cryptocurrency miner — BleepingComputer](https://www.bleepingcomputer.com/news/security/psa-the-pirate-bay-is-running-an-in-browser-cryptocurrency-miner-with-no-opt-out/) — "no opt-out" framing, second/worse incident
- [CBS's Showtime caught mining crypto-coins in viewers' web browsers — The Register](https://www.theregister.com/security/2017/09/25/cbss-showtime-caught-mining-crypto-coins-in-viewers-web-browsers/1026665) — up to 60% CPU, silent
- [Showtime websites secretly using visitors' CPUs — TechSpot](https://www.techspot.com/news/71133-showtime-websites-secretly-using-visitors-cpus-mine-cryptocurrency.html)
- [BrowseAloud supply-chain attack — cside.com](https://cside.com/blog/the-browsealoud-supply-chain-attack-a-case-study-in-cryptojacking) — 4,000+ sites, UK ICO, US courts, NHS
- [US and UK government websites hijacked — WeLiveSecurity (ESET)](https://www.welivesecurity.com/2018/02/12/government-websites-mine-cryptocurrency/)
- [Cryptocurrency-mining malware hijacks UK/US government sites — TechCrunch](https://techcrunch.com/2018/02/12/browsealoud-coinhive-monero-mining-hack/) — Scott Helme discovery
- [UNICEF Australia "The Hopepage" — Forbes](https://www.forbes.com/sites/jessedamiani/2018/04/30/unicef-australias-the-hopepage-uses-crypto-mining-to-raise-money-for-children/) — AuthedMine opt-in dialog, 20–80% user-selected intensity
- [UNICEF cryptocurrency mining fundraising — WeLiveSecurity](https://www.welivesecurity.com/2018/05/29/unicef-cryptocurrency-mining-fundraising/) — ad-blocker interaction
- [Coinhive to shut down — TechTarget](https://www.techtarget.com/cybersecurity/news/252458685/Coinhive-shutdown-imminent-after-troubled-cryptomining-past) — Monero -85%, hash-rate -50% post-fork, AV/ad-blocker blocking by default
- [Coinhive shutters — Avast blog](https://blog.avast.com/coinhive-shutters-due-to-drop-in-crypto-value)
- [Background tabs in Chrome 57 — Chrome for Developers](https://developer.chrome.com/blog/background_tabs) — 1% CPU cap on background timers, official engineering source
- [Heavy throttling of chained JS timers, Chrome 88 — Chrome for Developers](https://developer.chrome.com/blog/timer-throttling-in-chrome-88) — intensive throttling, once/minute after 5 min idle
- [Google Chrome rolls out Memory and Energy Saver — 9to5Google](https://9to5google.com/2023/02/18/chrome-memory-energy-saver/) — Chrome 110 leaf icon, official browser-vendor visible-indicator precedent
- [Web-based Cryptojacking in the Wild — arXiv:1808.09474](https://arxiv.org/pdf/1808.09474) — Web Worker usage, throttling-evasion behavior in real cryptojacking campaigns
- [New Cryptojacking Tactic — Webroot](https://www.webroot.com/blog/2017/12/05/new-cryptojacking-tactic-may-stealing-cpu-power/) — pop-under window technique to survive tab close
- [Firefox Removing Battery Status API — Schneier on Security](https://www.schneier.com/blog/archives/2016/11/firefox_removin.html) and [Bugzilla #1313580](https://bugzilla.mozilla.org/show_bug.cgi?id=1313580) — fingerprinting rationale, cross-browser availability gap
- [BOINC: A Platform for Volunteer Computing — arXiv:1903.01699](https://arxiv.org/pdf/1903.01699) — David P. Anderson, canonical BOINC architecture/preferences paper
- [BOINC Preferences — GitHub Wiki](https://github.com/BOINC/boinc/wiki/preferences) — suspend/resume, % CPU, AC-only, idle-only preference model
- [World Community Grid — Wikipedia](https://en.wikipedia.org/wiki/World_Community_Grid) — active users/hosts scale reference, BOINC consolidation history
- [Folding@Home Points FAQ](https://foldingathome.org/faq/points/) and [foldingathome.org](https://foldingathome.org/) — credit model, disease-project transparency
- [Patterns of Participation and Motivation in Folding@home — Citizen Science: Theory and Practice](https://theoryandpractice.citizenscienceassociation.org/articles/10.5334/cstp.109) — team affiliation correlated with sustained contribution (academic, peer-reviewed)
- Project's own `.planning/PROJECT.md` and `CLAUDE.md` — existing v2.0 target features, sovereignty/egress-manifest guarantees, transport/WebRTC constraints already measured

## Gaps to Address

- **No named precedent found for "staged/regional rollout of a volunteer compute cohort"
  specifically** — the recommendation in this document is inferred from general distributed-
  systems/release-engineering practice, not from a BOINC/Folding@Home/browser-compute source.
  If a phase-specific researcher wants a stronger citation, look at general SRE canary-release
  literature rather than the volunteer-computing literature, which does not appear to document
  this practice publicly.
- **Could not confirm Safari's specific behavior for background-tab Worker throttling** — Chrome's
  behavior is well-documented by its own engineering blog; Firefox and Safari's exact background-
  Worker throttling policies were not independently verified in this pass and should be measured
  directly (this project already has a Playwright multi-browser harness per `STACK.md`, which is
  the right tool to measure this rather than trust another web search).
- **No BOINC/World Community Grid source documents *operator-side* kill-switch or incident-
  response tooling in public-facing form** — their outage handling is presumably internal
  ops practice, not a published feature. This document's kill-switch recommendation is grounded
  in the domain's incident history (how long silent-mining incidents took to resolve) rather
  than in a named operator tool from a volunteer-computing precedent.
- **GDPR/legal disclosure requirements were not researched as a legal question** — this document
  treats "plain-language disclosure" as a trust requirement grounded in the incidents; an actual
  compliance review (given "many countries," likely including EU/EEA participants) is a distinct
  legal-research task, not a features/ecosystem one, and is out of this file's scope.

---
*Feature research for: v2.0 "Open the Doors" — volunteer/operator-facing layer over an existing P2P compute fabric*
*Researched: 2026-08-25*
