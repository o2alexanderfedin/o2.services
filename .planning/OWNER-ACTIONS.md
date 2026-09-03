# What only the owner can do — v2.0 "Open the Doors"

**Written 2026-09-02.** Every row here is blocked on the owner, not on engineering. Each says
what the act is, why an agent must not do it, what it costs, and what it unblocks. Nothing on
this list is waiting on more work first unless the row says so.

The rule this list exists to keep: **autonomous execution stops at the Cloudflare boundary,
and publication is a separately-triggered gate rather than an automatic consequence of a phase
completing.** Both were rulings, not preferences.

---

## 1. The spending alert — the one that must come FIRST

| | |
|---|---|
| **Act** | Configure a billing alert on the Cloudflare account, and record the date it was configured |
| **Cost** | None |
| **Why not an agent** | It is an account-level setting on the owner's billing profile |
| **Unblocks** | Everything in rows 2 and 3. Nothing that spends may precede it |

Cloudflare has **no hard spending ceiling** — its own wording for budget alerts is that they
are *"informational only. It does not cap your usage."* So the alert is a smoke detector, not
a fuse.

**This is the ordering `HOST-10` names, and this milestone has already lost it once.** Phase
29's criterion 1 asked that the alert's configuration timestamp precede the deploy log that
created the first Durable Object; it did not, the requirement is the ledger's first
**`Refuted`** row, and no later alert makes it true. The same ordering now applies to three
more objects and to TURN. It can only be lost once per resource.

**What to say back:** the threshold, and that it is set.

---

## 2. Three Durable Objects — Phase 33

| | |
|---|---|
| **Act** | Approve the budget, then run the deploy (or authorise an agent to run it) |
| **Cost** | ≈ **$5/month per always-on object**, so ≈ **$15/month for three** — measured, not guessed: 128 MB ⇒ 331 776 GB-s/month against 400 000 included |
| **Why not an agent** | An object's location is **fixed by its very first `get()`** and never moves. A wrong placement is not repairable, only replaceable |
| **Unblocks** | Phase 34 criterion 2 (TURN sharded to three regions), Phase 33 criteria 3 and 4 (the relay-kill drill) |

$15/month is the whole of the stated budget. **Two regions also work** and cost two thirds;
the drill needs only that one region can be taken out while others answer.

Agent-side work that does **not** wait on this: all three objects' code and configuration,
`wrangler deploy --dry-run --outdir=<scratch>` verification, the drill schedule, and the guard
that refuses any document claiming **where** an object physically runs. `bootstrap-eu` goes in
the binding **`eu` jurisdiction**; `bootstrap-sam` carries a **`locationHint` only**, because
no South-American jurisdiction value exists — and a plan passing `sam` as a jurisdiction is
watched failing at creation, which is itself a criterion.

**What to say back:** the budget is approved for N regions, and who runs the deploy.

---

## 3. A Cloudflare TURN key — Phase 34

| | |
|---|---|
| **Act** | Create a TURN key in the Cloudflare dashboard (Realtime → TURN); hand over the **Key ID**, and set its **secret** with `wrangler secret` |
| **Cost** | Creating the key: none. Traffic through TURN: billed per GB — **and the free tier does not reach us**, see below |
| **Why not an agent** | It is a credential on the owner's account, and switching it on starts a meter |
| **Unblocks** | Phase 34 criterion 1 |

**The free tier was raised and checked.** Cloudflare's TURN is free *when used natively
alongside their Realtime SFU*. An SFU forwards **media tracks**; this fabric's peer path is a
WebRTC **data channel**. No media, no SFU, so our use is the billed standalone kind.

**The exposure is small and the bound is measured.** One run of the representative task moves
**11 387 bytes** of egress (`packages/browser/src/data-cost.ts`, three runs). Doubling to bound
the unmeasured inbound leg gives ≈ 22.2 KiB per relayed run — roughly **47 000 relayed runs
per GB**. And the design already caps it structurally: bulk data never crosses the browser
mesh at all, because artifacts fetch over an IPFS gateway.

That secret never enters the repository. Everything else — minting short-lived
credentials on the hosted node behind the certificate check that already exists, rotation,
refusing a request from outside the fabric, and both ports **3478 and 53** — is built and
proved against a local `workerd` with a stand-in key before the real one is needed.

**What to say back:** the Key ID, and confirmation the secret is set.

---

## 4. The telemetry's legal basis — Phases 35 and 37

| | |
|---|---|
| **Act** | Choose which sentence the disclosure states |
| **Cost** | None |
| **Why not an agent** | The sources are **contested across each other**, not merely unresolved; the requirement says this is settled by legal review, not engineering judgement |
| **Unblocks** | `BROW-09` (currently **Partial** — the only thing holding it), and Phase 37's whole funnel design |

**Reading A — consent.** *This page sends a report only if you turn it on above; with it off,
nothing about you or your visit is sent anywhere.*

**Reading B — legitimate interest.** *This page records that a visit happened and whether the
node started, with no identifier that names you; you can turn off the fuller report above, and
this minimal record is kept either way because it is the only way blocking becomes visible
instead of looking like a quiet absence of volunteers.*

**The engineering consequence, which is not a legal argument but is a fact the choice
carries:** under Reading A the **page-load denominator cannot be counted at all**, because a
page load happens before consent can be given. `BENCH-08` names that stage as its denominator,
so the milestone's headline number — what fraction of a general audience cannot participate —
becomes unmeasurable by construction. Under Reading B the funnel measures the whole
population, the minimal record's contents must be stated exactly, and a documented balancing
test is owed before recruitment.

**One design constraint either way:** if the minimal record writes anything to the visitor's
device, the storage rule applies whatever the GDPR basis. A server-side aggregate count that
touches no device storage does not engage it.

**What to say back:** `reading-a`, `reading-b`, or a sentence to use verbatim.

---

## 5. Telegram on two real devices — Phase 38

| | |
|---|---|
| **Act** | Open the real link from a real Telegram message on **one iOS and one Android device**, and record four answers per device |
| **Cost** | None. **This is not a disclosure event** — the link is already public |
| **Why not an agent** | Criterion 1 rejects a green obtained from a spoofed user-agent by name: the check is the **engine**, not the string. There is no emulator answer |
| **Waits on** | The interstitial, which does not exist yet. Build first, then this takes about ten minutes |
| **Unblocks** | `RUN-06`, and through it `RUN-01`'s gate on Phase 39 |

Send the link to your own Saved Messages and tap it so it opens in Telegram's in-app browser.
Per device, record: (1) did the "open in your own browser" screen appear; (2) does the node
start at all; (3) **background Telegram for a minute and come back** — is the node still
alive, or was JS suspended; (4) did WebRTC connect, and did IndexedDB survive the
backgrounding. Yes/no per line is enough.

---

## 6. The public run — Phase 39

| | |
|---|---|
| **Act** | Send the first invite |
| **Cost** | **Irreversible.** Public hosting is public disclosure; EPO and China have no patent grace period, so this forfeits those rights permanently |
| **Why not an agent** | The disclosure gate is the owner's by ruling, and a Telegram-recruited cohort of a few hundred is spendable exactly once |
| **Waits on** | Its own criterion 1 — a dated checklist with named evidence for all seven of `BROW-06`…`BROW-10`, `RUN-02`, `RUN-03`. A row with no named evidence is a no-go, not a judgement call |

Phase 40's two published figures are physically downstream of this and of nothing else.

---

## 7. The cross-host lift — Phase 41

| | |
|---|---|
| **Act** | Dispatch `.github/workflows/aot-cross-host.yml` |
| **Cost** | None — GitHub-hosted arm64 runners are free for public repositories |
| **Why not an agent** | Recorded as an owner act by a prior ruling, because it runs against a public repository |
| **Unblocks** | `AOT-03` criterion 1, and removes `CROSS_MACHINE_BLIND_SPOT` from every artifact |

The arrangement is built and guarded: dispatch-only, every job on an `-arm` runner, a refusal
to lift where `uname -m` is not `aarch64`, and each host reporting its **own** platform rather
than the driver's. Whether `ubuntu-24.04-arm` is schedulable for this repository was read off
documentation and **not run** — the workflow's cheap `report-host` job is that experiment, and
it is the cheapest row on this page.

`AOTW-06` stays gated regardless: `26-GATE.md`'s **NO-GO** stands until a `wasm32-wasi` LLVM is
built from source and glog carries a `__wasi__` branch. That is a compiler, not a feature.
