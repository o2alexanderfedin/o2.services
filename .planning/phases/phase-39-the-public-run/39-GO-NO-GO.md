# The go/no-go checklist for the first invite — `RUN-01`

**Dated:** 2026-09-07

`RUN-01` is one sentence and it is a gate, not a nice-to-have: *no recruitment invite is sent
until `BROW-06`…`BROW-10`, `RUN-02` and `RUN-03` all hold, recorded as a dated go/no-go
checklist naming each condition's evidence.* This is that checklist. Every one of the seven
conditions below reads `GO` or `NO-GO`, and beside each is the evidence it reads that way on —
because **a row with no named evidence is a no-go, not a judgement call**. Nobody has to trust
the author's recollection; every row points at a file somebody else can open.

The reason the gate exists is recorded rather than assumed. **A Telegram-recruited cohort of a
few hundred is spendable exactly once**, and SETI@home's move to BOINC lost roughly half of its
~600,000 volunteers to added platform complexity alone — no bug, no bad actor, just a client
that asked more of people than the one before it. A cohort that leaves does not come back to be
asked again, so the cost of sending the invite one condition early is not a delay; it is the
population the fabric's headline claim was going to be measured on.

## The seven conditions

Each row transcribes the evidence from the requirement's own ledger entry rather than
re-deriving it — a second derivation is a second source, and two sources drift. The `Ledger`
column names both places the ledger says it: the checkbox row that carries the tick, and the
traceability row that carries the reading. Line numbers were read on 2026-09-07 and are what
`.planning/REQUIREMENTS.md` said on that day.

| Condition | Disposition | Named evidence | Ledger |
| --- | --- | --- | --- |
| **BROW-06** | GO | The opt-in blocks the artifact **fetch**, not only execution. `fetchModuleForDispatch` takes a granted consent, or the gap saying why there is none, and checks it ahead of every other refusal, so a caller without one fails to compile — `packages/browser/src/gateway-module.ts:206-214`. Read at the network rather than inferred: `packages/node/src/artifact-fetch-gate.e2e.test.ts` stands a second HTTP server on its own port and reads that server's own log — empty with consent absent, one request with consent granted, which is the floor that makes the zero a measurement. Removing the gate produced a real logged request. The page orders itself consent → fetch → node-state, `packages/browser/demo/main.ts:3205-3225` | `.planning/REQUIREMENTS.md:1378` box, `.planning/REQUIREMENTS.md:2179` reading |
| **BROW-07** | GO | A persistent indicator says the tab is computing while it is unfocused. It is `● Computing — ` prepended to the document title, set unconditionally whenever tasks are in flight and never conditioned on visibility state — `packages/browser/src/computing-indicator.ts`, wired at `packages/browser/demo/main.ts:797-821`. Read from **outside** the page with a second page brought to the front, in chromium, firefox and webkit: `packages/node/src/computing-indicator.e2e.test.ts`. The page-body-only plant was watched red in all three. What is **not** proved is that a window manager rendered it | `.planning/REQUIREMENTS.md:1383` box, `.planning/REQUIREMENTS.md:2180` reading |
| **BROW-08** | GO | Stop is a hard interrupt, in both halves. CPU: `packages/node/src/hard-stop.e2e.test.ts` presses Stop with 115 of 128 shards outstanding and finds 13 of 128 finished after a wait derived inside the run rather than from a constant. The cooperative arm was watched red with 128 of 128 finished — after the narrow plant stayed green, which is why the wide one carries the claim. Socket: `packages/cloudflare/src/stop-closes-the-billed-socket.e2e.test.ts` reads connection-seconds on a local workerd across four reads — 4.014 s accrued before Stop and 0.000 s after — with the socket-left-open plant red at 100.0 % of the pre-Stop rate | `.planning/REQUIREMENTS.md:1386` box, `.planning/REQUIREMENTS.md:2181` reading |
| **BROW-09** | GO | Plain-language disclosure before opt-in, stating all four elements. Each element is asserted with a plant each and the ordering has its own, all five watched red — `packages/node/src/disclosure-four-elements.node.test.ts` and `packages/node/src/disclosure-before-optin.e2e.test.ts`. Element 3 leads with the sovereignty guarantee, checked mechanically: it must appear in the answer's first sentence with no qualifier before it. The one pending sentence — the ground the telemetry rests on — was ruled on by the owner on 2026-09-04 and landed with four assertions and two red plants; `packages/browser/demo/policy.html` moved in the same commit. **Amended 2026-09-07:** the ledger records the version as `'6'` as of 2026-09-04 and the tree reads `packages/browser/src/disclosure.ts:194`, `DISCLOSURE_VERSION = '8'` today. The version has moved twice since the reading; the condition is the disclosure being shown and asserted, and it is | `.planning/REQUIREMENTS.md:1393` box, `.planning/REQUIREMENTS.md:2182` reading |
| **BROW-10** | GO | A data-cost line beside the CPU disclosure and before opt-in. `packages/browser/src/data-cost.ts` discloses 11 000 bytes for one run of the representative task — hand-written and round, read off three runs measuring 11 387, 10 971 and 11 387 bytes. The band is a factor of two, about twenty-six times the 3.8 % observed spread, because what varies is how many frames left, which follows peer count and dialling. Egress only, with the inbound leg named as excluded rather than estimated. Both plants — figure moved an order of magnitude, line deleted — were watched red | `.planning/REQUIREMENTS.md:1396` box, `.planning/REQUIREMENTS.md:2183` reading |
| **RUN-02** | GO | A kill switch that needs no redeploy and slices by region. `packages/node/src/kill-switch-regions.e2e.test.ts` halts one region and watches two others go on taking work in the same run; the plant reverting the admission port reddened, and closed a live inversion in which a paused tab refused its peers and went on computing its own work. The slice is enforced at the **write**: a post naming another object's region is refused 409, and that case went 200 ← 409 under the global-switch plant, which is what proves a region check rather than a body validation carries the refusal — `packages/cloudflare/src/admission-slices.e2e.test.ts`, with the volunteer-side control at `packages/browser/src/kill-switch.ts`. Propagation 29 880 ms over 6 tabs at a 30 000 ms poll, ratio 0.996, two intervals compared inside one run. Every measurement is local workerd; there is no deployed reading | `.planning/REQUIREMENTS.md:1404` box, `.planning/REQUIREMENTS.md:2186` reading |
| **RUN-03** | GO | A status page a volunteer can reach before the invite, with no account, key or cookie. `packages/node/src/kill-switch-volunteer.e2e.test.ts` reads it from a browser context given nothing, proves 13 requests free of credentials and the write path refused twice from it, and reports admitting before the flip and halted after it. Proved against the build's `dist/` output rather than the source tree, which is the whole point: the policy page had been linked from the live bundle and returning 404 in production because the build declared no extra inputs. Both `packages/browser/demo/status.html` and `packages/browser/demo/policy.html` are now proved present in the built output, and the address is pinned by `packages/node/src/status-page-address.node.test.ts` | `.planning/REQUIREMENTS.md:1409` box, `.planning/REQUIREMENTS.md:2187` reading |

**Seven `GO`, zero `NO-GO`.** On the gate `RUN-01` actually states, the invite is not blocked
today. The section below is why that sentence is not the same as "send it".

## Not one of the seven — preconditions of the run

**These are recorded as additions and are not part of RUN-01's gate.** Nobody should read this
document as having widened the requirement or narrowed it. `RUN-01` names seven conditions; the
table above is those seven and nothing else. What follows is the set of things that are true of
the run and are not conditions of it — each is a real blocker on *this phase*, and none of them
changes what `RUN-01` asks. A row here reading `NO-GO` is this document doing its job before the
run rather than being written after it.

| Precondition | Disposition | Blocker |
| --- | --- | --- |
| **The published page is behind the disclosure the tree carries** | NO-GO | Measured 2026-09-04 against the published bundle `assets/index-jXJKXCh1.js` (789 928 bytes): the positive control *"This page can use your processor"* was found once, so the instrument can see the bundle; version 5's line *"What does this page count about my visit"* was found once; version 6's ground sentence *"your permission, and nothing else"* was found **zero** times. The tree has moved two versions further since. Blocker: the release cut — a new row in `.planning/OWNER-ACTIONS.md`, added by plan 39-06 |
| **The front-door request budget** | NO-GO | `.planning/debug/2026-09-03-the-free-tier-request-cap-took-the-hosted-tier-down.md` — 1 100 232 Durable Object requests against 1 000 000 included, on day 3 of the period, and error 1027 refused every path at the edge while the Worker script never ran. A spending alert is a control on money and this was a control on requests; the two failure modes are disjoint, so `.planning/OWNER-ACTIONS.md` row 1 does not cover it. Blocker: the per-stage budget arithmetic and stop rule, plan 39-04 |
| **The funnel reaches its collector** | NO-GO | A staged invite is read between stages or it is not staged at all. **One of this row's two blockers is gone as of 2026-09-07 and the row does not move, which is the distinction it exists to keep.** Plan 39-02 landed: `probeFunnelTarget` (`packages/browser/src/funnel-reporter.ts`) asks the derived origin whether it is a collector before any report is sent there, validating the **body** rather than the status, so a page can no longer look configured while collecting nothing — proved by `packages/node/src/funnel-probe.e2e.test.ts`, whose defect arm was watched failing first at *"the page posted 2 report(s) to a collector that answered 400 on every path"*. That closes *can it drop silently*. It does **not** close this row, because the row asks whether the funnel IS reaching its collector, which is a reading and not a mechanism. Remaining blocker: the pre-invite reading of step 2 of `.planning/phases/phase-37-the-six-stage-funnel-and-a-frozen-telemetry-schema/37-RUNBOOK.md`, an owner act against the deployed collector. Criterion 2's own words are that the funnel must be observable in its own record **with a timestamp preceding the invite** — a mechanism cannot satisfy a clause about when something was seen |
| **RUN-06** | NO-GO | `.planning/phases/phase-38-reaching-the-cohort/38-DEVICE-OBSERVATIONS.md` establishes that the client runs in Telegram's in-app WebView on real hardware and that a slept device reconnects on waking. It does **not** establish backgrounding while the device stays awake, nor whether the engine was suspended or only the socket dropped, nor IndexedDB across the transition; headless chromium cannot background a page for itself, so that reading does not exist in this harness at all. The row is **Partial**, not Done. Blocker: `.planning/OWNER-ACTIONS.md` row 5, extended by plan 39-06 |
| **Phase 33 — three regions** | NO-GO | `HOST-06`, `HOST-07` and `NET-15` are all open, and there is no phase directory and no plan. Blocker: `.planning/OWNER-ACTIONS.md` row 2, about $15 a month for three objects. Stated plainly rather than left to be inferred: production has **one** region today, so a region-staged invite has one arm and a production halt is cohort-global |
| **Phase 34 — both fallback rungs verified before the cohort arrives** | NO-GO | `NET-12` is open. Blocker: `.planning/OWNER-ACTIONS.md` row 3, a Cloudflare TURN key. Phase 34's own criterion 1 says both verifications happen *before Phase 39 invites anyone*, so this is that phase's schedule and not a new condition of this one |
| **BENCH-06** | NO-GO | The distinct-machine reading path does not exist yet. Blocker: the privacy ruling in plan 39-03 task 1, and then the run itself — the reading is of the cohort, so it cannot precede the cohort |

## How this document goes stale, and what refuses to let it

A checklist written once, on the day everything happened to be true, decays silently while the
thing it gates stays irreversible. `packages/node/src/go-no-go-checklist.node.test.ts` is what
stops that. It reads this file on every run of the `node` project and refuses four things:

- a seven-condition table that is not exactly `BROW-06`, `BROW-07`, `BROW-08`, `BROW-09`,
  `BROW-10`, `RUN-02` and `RUN-03` — no eighth, none missing, none renamed;
- a disposition that is any word other than `GO` or `NO-GO`, because a third word is the
  judgement call the requirement refuses;
- a `GO` row whose evidence cell names no path, or names one that has stopped resolving on
  disk, or points past the end of the file it cites;
- a `GO` row naming a requirement whose box in `.planning/REQUIREMENTS.md` has come unticked —
  the ledger's own checkbox is re-read rather than the transcription above being trusted.

It deliberately does **not** refuse a `NO-GO` row, which is what lets this document be committed
before the run instead of after it, and it holds floors on its own parse so that a pattern which
stops matching fails loudly rather than certifying an empty table.

The citation contract it enforces, so that a future editor knows the shape: **a path citation is
repo-root-relative and inside a backtick span**, optionally suffixed `:N` or `:N-M`. A path
relative to a package directory — which is how the ledger's own `BROW-06` row writes one — will
not resolve and will redden this file. Prose outside a backtick span is prose, and is not read
as evidence.
