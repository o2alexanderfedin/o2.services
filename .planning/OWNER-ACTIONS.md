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

---

## 8. The hosted node's identity secret — Phase 43, criterion 4

| | |
|---|---|
| **Act** | `wrangler secret put O2_IDENTITY_SECRET` on the Worker, **before its next deploy**, and keep the value in a password manager |
| **Cost** | None. A Worker secret is free and creates no resource |
| **Why not an agent** | It is a credential on the owner's account, and it is the only thing that will ever open this object's identity. An agent that generated it would be the one place it had existed in plaintext |
| **Unblocks** | Nothing waits on it, and **the priority is LOW** — see *what losing the secret actually costs*. What it prevents is the deployed bootstrap node going dark on the next deploy |

The seed at `/identity/seed` is no longer written in the clear. It is an Argon2id +
XChaCha20-Poly1305 envelope at `/identity/sealed-seed`, and this secret is what opens it. The
object at `o2-bootstrap.af-4a0.workers.dev` still holds the old plaintext row; the first boot
of the new build **migrates it in place — same 32 bytes, same PeerId** — and deletes the
plaintext only after re-reading the envelope and opening it.

**Say plainly what this buys, because it is smaller than it sounds.** A Durable Object cannot
keep a secret from its own operator. This does not hide the seed from the Cloudflare account
holder and nothing claims it does. What moves is *who has to be compromised*: before, anyone
who could read the object's storage; after, whoever holds the account. Two different
compromise domains, and moving between them is the whole gain.

### The commands, in the order they must be run

**Step 1 — capture the PeerId the deployed node answers with today.** Everything below is
checked against this string, so it has to be taken before anything changes.

```
curl -s https://o2-bootstrap.af-4a0.workers.dev/self | jq -r .peerId
```

**Step 2 — generate the secret and set it. Save the printed value in a password manager before
going any further.**

```
cd packages/cloudflare
openssl rand -hex 32 | tee /dev/tty | npx wrangler secret put O2_IDENTITY_SECRET
```

`openssl rand -hex 32` gives 64 characters, comfortably over the twenty-character floor the
code enforces. `tee /dev/tty` prints it once so it can be saved — and this is the only moment
it will ever be printed.

**Step 3 — confirm the binding exists before deploying.**

```
npx wrangler secret list
```

`O2_IDENTITY_SECRET` must appear, with type `secret_text`. If it does not, stop — see *"what
happens if it is not set"* below, which depends on **how** the deploy is run.

**Step 4 — deploy, then read the identity back.**

```
curl -s https://o2-bootstrap.af-4a0.workers.dev/self | jq -r .peerId
```

This must print **the same string as step 1**.

### What means stop

- **`/self` answers `500` with a body containing `HostedIdentitySecretMissingError`** — the
  secret is not bound to the deployed Worker. Nothing is lost and nothing was created: set it
  and the node comes back on its own identity. This is the designed failure.
- **`/self` answers `500` with `SealedHostedIdentityUnlockError`** — a secret is bound and it
  is not the one this envelope was sealed under. **Do not redeploy and do not rotate.** Put the
  original value back; the identity is intact behind it.
- **`/self` answers `200` with a `peerId` that is NOT the one captured in step 1** — stop and
  report it. That is the one outcome the whole design exists to prevent, and it means something
  is wrong that no further deploy will fix. `deploy-hosted.sh` already refuses this case and
  rolls back on it; a deploy run any other way does not.

### What happens if the secret is not set — and it depends on how you deploy

**Read from `scripts/deploy-hosted.sh` on 2026-09-06 rather than assumed**, because an earlier
draft of this row said "the node goes dark" for both paths and that is only true of one:

- **Through `scripts/deploy-hosted.sh` — the deploy rolls itself back.** Its read-back is
  `curl -sS --fail … /self`, and `--fail` makes a `500` produce no body, so the version it
  injected never appears in the answer. After six attempts over about thirty seconds it calls
  `roll_back "THE DEPLOYED NODE DOES NOT REPORT THE VERSION THAT WAS DEPLOYED"` and runs
  `wrangler rollback` to the version captured before the deploy. **The old build comes back,
  the plaintext seed is untouched, and the node keeps answering on its published PeerId.** The
  script then exits non-zero, so this is loud. It is a failed deploy, not a lost node.
- **Through a bare `wrangler deploy` — the node goes dark** until the secret is set. It answers
  `500` on `/self` and nothing else works. Its stored identity is still intact and setting the
  binding brings it back unchanged.

Either way nothing is lost. That is the point of refusing: the alternative is a node that
quietly comes up as somebody else. Setting the secret afterwards does not undo that — the new
identity is already the one the object holds — whereas going dark is undone by setting it. The
cost of the bad outcome is one `deploy-pages.sh`, not a dead fabric; refusing is still right,
because a silent identity change is the kind of thing nobody notices for a week.

### What losing the secret actually costs — CORRECTED 2026-09-06, and it is much less than this row first said

The earlier wording read *"losing this secret loses the identity permanently … there is no
recovery path, by construction"*. **Every word of that is true about the key and it gave a
false impression of the consequence**, which is what a row like this is for. The owner asked
the obvious question — *why do we care about this node's identity when we have its URL and can
redeploy it?* — and the answer, measured rather than defended, is: **we barely do.**

**The PeerId is nowhere in shipped code.** `scripts/deploy-pages.sh:159` asks the live relay
for it at build time and writes the finished multiaddr into `bootstrap.json` beside the
published page. The page reads that file on load. So a changed PeerId does not brick anything
— it makes the *already published* page point at an identity that no longer answers, and
**redeploying the CLIENT fixes it**:

```
scripts/deploy-pages.sh          # re-asks the relay, rewrites bootstrap.json
```

Note *client*, not relay. The relay is fine; the stale address is on GitHub Pages.

**Why it fails at all, since the host name has not changed.** libp2p dials a multiaddr, not a
URL: `/dns4/<host>/tcp/443/tls/ws/p2p/<PeerId>`. The tail is a checked claim about who is
there — in the Noise handshake the node presents its public key and the dialler compares the
hash. So the page reaches the right host, TLS and WebSocket come up, and the handshake is
refused because the peer proved a different identity. Not *knocked at the wrong door*: right
door, different person. That check is also why nobody can put themselves in the middle.

**So the honest priority for this row is LOW.** This is a public relay. Its key signs nothing
of value and the node is replaceable by one command. The two exposures that mattered —
a visitor's own key, which is a person's identity on the fabric, and the libp2p keychain's
Let's Encrypt private key encrypted under an empty password — are closed already. This tier
came along because the rule the owner stated says *nowhere*, not *wherever it is expensive*.

**Still store the secret in a password manager before deploying.** Losing it costs one
`deploy-pages.sh` and a stale window, which is cheap and avoidable rather than free.

### What to say back

That the secret is set, and the `peerId` from `/self` — which must match the one captured
before the deploy.

---

## 9. One request that tells you whether the kill switch works — Phase 39, before any invite

| | |
|---|---|
| **Act** | Read `region` off the deployed node's `/self` and, if it is `null`, deploy with `O2_REGION` set |
| **Cost** | The read: none, one request. The redeploy, if needed: none beyond what `36-RUNBOOK.md` act 2 already costs |
| **Why not an agent** | The read is safe but the fix is a deploy, and deployment is a separately-triggered gate by this project's own `DEMO-04` ruling |
| **Unblocks** | Phase 39 criterion 5, and the kill switch itself — which is the control the run is supposed to be able to fall back on |

**This is the most urgent row on this list, and it was found rather than expected.**

`refuseMisaddressed` refuses **every** write to an object whose own region is `null` — with any
key, correctly addressed or not. The deployed `/self` **as recorded on 2026-09-04** answers
`region: null`. If that still holds, the kill switch answers `409` to everything and the fabric
has no stop control at all, while every document says it has one.

**It was not asserted from that record.** Plan 39-06 stood a second local `workerd` with no
`O2_REGION` and watched a correctly-keyed halt refused twice, the body containing `serves no
region`, the object unmoved. What is unverified is only whether the **deployed** object still
reports `null` — a redeploy since then may have set it, and `36-RUNBOOK.md` act 2 is the act
that would have.

### What to run

```
curl -s https://o2-bootstrap.af-4a0.workers.dev/self | grep -o '"region":[^,}]*'
```

### What it means

| reading | verdict |
|---|---|
| `"region":null` | **STOP.** There is no kill switch. `36-RUNBOOK.md` act 2 lands before any invite |
| `"region":"<a name>"` | The precondition holds. Phase 39's criterion 5 exercise can proceed |

A criterion that exercises the switch **during** the run, which is what criterion 5 asks for,
is worthless if the switch cannot be thrown at all — and this is a control on the run's only
way to stop. Full working, with the six-step observation script and its five stop arms:
`.planning/phases/phase-39-the-public-run/39-KILL-SWITCH-DURING-RUN.md`.

### What to say back

The `region` value verbatim, and if it was `null`, that act 2 has landed.
