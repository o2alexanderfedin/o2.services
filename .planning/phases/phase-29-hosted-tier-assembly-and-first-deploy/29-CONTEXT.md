# Phase 29: Hosted Tier Assembly & First Deploy — Context

**Gathered:** 2026-08-27
**Status:** Ready for planning
**Source:** Owner session 2026-08-27, captured inline (no `/gsd-discuss-phase` run — the phase
was already partly executed and its record is `29-REPORT.md`)

<domain>
## Phase Boundary

**This context covers the REMAINDER of Phase 29 only.**

`29-REPORT.md` (2026-08-26, `status: partial`) is the record for criteria 3, 4, 5, 6 — MET,
with the plant watched red for 4, 5 and 6 — and for criterion 7, which is met *as a report*
because that is what it asks for. **A plan must not re-plan any of them.**

What remains:

| # | Criterion | Who |
|---|---|---|
| 1 | Billing alert exists, its configuration timestamp **precedes** the deploy that creates the first Durable Object | **Owner act** |
| 2 | A peer outside Cloudflare dials, completes identify, and gets the **same** PeerId after eviction and after a redeploy | **Owner act**, on work this plan delivers |
| — | The **minimal inbound listener**, without which criterion 2 cannot be attempted at all | This plan |

### The Phase 29 / Phase 30 line, stated so the listener task cannot drift across it

Phase 29's listener is **minimal: dialable at all, identity stable.** Listener *correctness* is
Phase 30's entire goal and must not be pulled forward. But the four requirements below stay on
the record here, because each has a measured silent-failure mode and a plan that forgets them
reproduces one:

- **`direction: 'inbound'`** on the `webSocketToMaConn()` call (ARCHITECTURE §14) — omitted,
  both ends negotiate yamux as clients and every stream is refused *while the dial still looks
  like it succeeded*. **This one is Phase 29's**, because without it criterion 2's identify
  never completes.
- **`remoteAddr` from `CF-Connecting-IP`** (§19) — omitted, libp2p sees the whole internet as
  one host and rate-limits the node to five inbound connections a second, invisible at small
  scale. **Phase 30.** One or two peers cannot surface it by construction, so Phase 29's
  two-dial test would pass either way.
- **An explicit answer for `bufferedAmount`** (§16) — the property is *absent from the
  WebSocket prototype* in workerd, not merely unset. Supplying `0` disables libp2p
  backpressure entirely; acceptable for signalling traffic, but the choice is made
  deliberately and recorded. **Phase 30 owns the answer; Phase 29 records which value it
  ran with.**
- **A hibernation-aware socket** (§17) — **Phase 30.** ARCHITECTURE calls it "the largest
  genuinely-new engineering item on this tier". Measured: a plain `server.accept()` socket
  carrying libp2p died after 6 minutes idle while the object stayed up (§12); a hibernatable
  socket survived 15 minutes untouched (§17).

</domain>

<decisions>
## Implementation Decisions

### Owner decision taken 2026-08-27 — COPY THE UPSTREAM FILE AND REFACTOR THE COPY

`webSocketToMaConn` is not exported by `@libp2p/websockets` (its `exports` map declares `.`
and `./filters` and nothing else). Three routes were measured and put to the owner:

| Route | Measurement |
|---|---|
| Deep import **by package specifier** | esbuild *"Could not resolve"*, **exit 1** — does not build |
| Deep import **by file path** into `node_modules` | **exit 0**, 153.30 KiB, `webSocketToMaConn` ×3 in the bundle — but the path sits outside the package's `exports` contract, i.e. outside semver, where a patch bump moves the file with no signal |
| **Copy `websocket-to-conn.ts` into this repository and refactor the copy** | **CHOSEN — owner, 2026-08-27** |

**Not a rewrite and not an import: a copy that is then changed.** The owner's instruction was
*"скопировать и отрефакторить копию"* — do not re-derive from scratch what already exists and
works, and do not depend on a file the package does not promise.

**Three facts make this cheaper than either alternative, and each is read off the file:**

1. **It is 109 lines** (`node_modules/@libp2p/websockets/src/websocket-to-conn.ts`; the shipped
   `dist` JS is 83). The TypeScript source is in the published package, so the copy starts from
   source, not from build output.
2. **Every one of its imports is a public entry point** — `@libp2p/utils`
   (`AbstractMultiaddrConnection`, `repeatingTask`), `uint8arraylist`, `uint8arrays/from-string`,
   `uint8arrays/with-array-buffer`, `@libp2p/interface`. All four are already in this tree.
   **So the copy removes the fragility completely and adds no new dependency** — it does not
   merely trade a deep path for our own code, it ends the deep path.
3. **Licence is `Apache-2.0 OR MIT`.** The copied file keeps its provenance header naming the
   upstream package, version and licence. That is a requirement of the copy, not a courtesy.

**The refactor is not cosmetic — the upstream file is measured wrong on workerd.** It reads
`this.websocket.bufferedAmount` twice, and ARCHITECTURE §16 measured that `bufferedAmount` is
**absent from the WebSocket prototype in workerd**, not merely unset. Traced through the copy:

```
sendData()      undefined < maxBufferedAmount  ->  false
                => canSendMore false, checkBufferedAmountTask.start()
checkBufferedAmount()   undefined === 0        ->  false
                => the task never stops, 'drain' never fires
```

A poller that never stops keeps the object resident, and resident is billed. **This is the
concrete thing the copy must fix**, and it is why copy-and-refactor is the right shape: the
upstream code is a correct starting point and an incorrect ending point.

**Phase boundary on that fix.** Phase 29 makes the smallest change that keeps the socket alive
and records which value it ran with. **The deliberate `bufferedAmount` policy — supplying `0`
disables libp2p backpressure entirely, acceptable for signalling traffic but chosen and
recorded rather than defaulted — is Phase 30's** (§16, and the deferred list below).

**What this decision does NOT license.** `STACK.md:146` says *"do not add"* a third-party
general-purpose WebSocket-to-libp2p adapter package, for two named reasons — an unverified
second compatibility surface, and version skew against `libp2p@3.3.6`'s v3 `Transport`/
`Listener` shapes. That refusal stands and is about taking on an npm dependency, not about
vendoring 109 lines under a licence that permits it. **No new runtime dependency is added.**

**The hazard this copy inherits, stated so it is watched rather than discovered.** A vendored
file does not receive upstream fixes. The copy is pinned against
`@libp2p/websockets@10.1.17`'s source in its header, and the plan states how a future version
bump is noticed — a guard comparing the vendored file against the installed package's source is
the cheap form, and it is a real option rather than a suggestion.

### The listener is work, not a blocker — and the retraction is the reason

`29-REPORT.md` finding 1 concluded the listener "cannot be written as it stands" and
**retracted it the same day, after it had reached five documents.** The error:
`ERR_PACKAGE_PATH_NOT_EXPORTED` is **Node's** ESM resolver refusing a *package specifier*, and
a conclusion about wrangler's bundler was drawn from it. Three wrangler builds settled it.

**A plan must not cite the 2026-08-24 consult §9 recipe verbatim as if it stood.** What
survives from §9 is that the listener is small and needs no new transport. What does not
survive is the import form.

### One deploy, not two

An earlier reading in this project said a first deploy was needed to learn the host name and a
second to bake it in. Corrected and measured: the workers.dev subdomain is an **account**
property (`/accounts/{account_id}/workers/subdomain`), and libp2p appends `/p2p/<peerId>`
itself (`address-manager/index.js:252`, strips at `:89`). **One deploy suffices.** The dated
correction is in `packages/cloudflare/wrangler.jsonc`.

### The owner boundary (ruling 2026-08-25) — not negotiable

Autonomous execution **stops at the Cloudflare boundary.** Criteria 1 and 2 are owner acts.

- Their plan tasks are **runbook items**: what the owner does, in what order, and what
  evidence is captured. Never agent tasks.
- Agent-side work is `wrangler deploy --dry-run --outdir=<scratch>` with
  `WRANGLER_SEND_METRICS=false`. **Never `--remote`. Never a real deploy. Never create a
  remote resource.** Measured: the dry run needs no authentication and exits 0 on a machine
  with no credential configured.
- The account carries **zero Durable Object namespaces** today, so nothing built here can wake
  or bill. The owner's three production `ocr-checks-worker*` scripts are untouched, and the
  configuration is asserted not to contain their prefix.
- **A phase report that ticks criterion 1 or 2 on locally-done work has widened what counts as
  passing.** Both stay OPEN in every report until the owner performs them.

### Ordering is the whole control for criterion 1

The billing alert's configuration timestamp must **precede** the deploy log that creates the
first object — refutable by a deploy log that predates the alert. There is no hard ceiling
behind it: Cloudflare's own wording is that its budget alerts are *"informational only. It does
not cap your usage."*

**The runaway-cost figure usually quoted here carries its qualifiers or is not cited at all:**
one Hacker News self-report (`thewillmoss`, 2026-04-16, 31 points, 4 comments, no billing
response), for ~930 billion row reads per day rather than for alarm invocations, multiplied by
60+ preview deployments.

Owner's stated budget is **$15/month**. Measured estimate for one always-on object: 128 MB
allocation ⇒ 0.128 GB·s per active second ⇒ 331,776 GB-s/month against 400,000 included, so
**≈$5/month**, and the over-rate is $12.50/M GB-s.

### Two open items the plan carries rather than closes

**(a) The open-question-1 guard is deliberately vacuous today and must be watched flipping.**
It asserts `diffieHellman` is absent from the emitted bundle. Measured on the real bundle:
`noise` **0** times, `pureJsCrypto` **0** times, **0** sourcemap sources matching "noise" — the
absence is the whole package's, not the call's, because no listener means no `createLibp2p`
means no encrypter. It **skips loudly** by design. **This plan's listener is exactly what pulls
noise in**, so the plan must include watching the guard flip from skip to a real reading.
Corroborating measurement: workerd's `node:crypto` under `nodejs_compat` is missing **only**
`diffieHellman`, and the pure-JS X25519 output is byte-equal to `node:crypto.diffieHellman` on
the same keys with interop verified both directions — a workerd peer can complete a Noise
handshake with a Node peer.

**(b) The reachability register went 74 → 80, where it was predicted to shrink.** The three
`do-datastore.ts` rows did not reverse, because the second half of that row's own sentence
held: *"it closes when the node deploys and dials."* Nothing deploys. **The plan states which
rows the listener and the deploy are each expected to move**, so the next reading is a
prediction tested rather than a number re-explained.

### Claude's Discretion

The adapter's internal shape; how the two-dial evidence is recorded; test file placement and
naming within existing conventions; whether the adapter lives in `packages/cloudflare/src/` or
`packages/libp2p/src/` (state the reason either way).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### The phase's own record — read first, in full
- `.planning/phases/phase-29-hosted-tier-assembly-and-first-deploy/29-REPORT.md` — what is
  already MET and must not be re-planned; finding 1 carries the retraction above; findings 2
  and 3 are the two open items

### Milestone research — the previous session's own lesson was that not reading these cost two hours
- `.planning/research/v2.0/ARCHITECTURE.md` (`:478-508`) — the four listener requirements and
  each one's measured silent-failure mode; `:506` scopes the hibernation-aware adapter
- `.planning/research/v2.0/STACK.md` (`:140-152`) — why no third-party adapter package
- `.planning/research/v2.0/PITFALLS.md`

### Consults — measured, and each has a section that does not survive quotation
- `.planning/consults/2026-08-24-cloudflare-as-a-fabric-node-measured.md` — §7 (a plain Worker
  returned three PeerIds to three consecutive requests, which is why this is a Durable Object),
  §9 (**the listener recipe, partly refuted — see the decision above**), §13, §15
- `.planning/consults/2026-08-25-noise-diffiehellman-on-workerd-measured.md` — §4 (a relative
  alias key matches across the whole dependency graph and silently replaced an unrelated module
  at build exit 0), §5 (**what this does NOT establish** — read before quoting it)

### The file being copied
- `node_modules/@libp2p/websockets/src/websocket-to-conn.ts` — 109 lines, `Apache-2.0 OR MIT`,
  all imports public. **This is the starting point of the copy, read it before planning the
  refactor.** `node_modules/@libp2p/websockets/src/listener.ts` shows how upstream calls it.

### The code that already exists
- `packages/cloudflare/src/` — `hosted-identity.ts`, `hosted-object.ts`, `do-datastore.ts`,
  `worker.ts`, `wrangler.jsonc`, and the guards' specs
- `packages/node/src/hosted-tier-deploy.node.test.ts` (9 cases)
- `packages/node/src/fs-datastore.ts` — the precedent `DoDatastore` follows

### Repository rules
- `CLAUDE.md` — § Conventions, § Measurement, § Proofs

</canonical_refs>

<specifics>
## Specific Ideas

- Criterion 2's evidence is **two dials separated by an eviction and by a redeploy**, both
  returning the same PeerId. A run that mints a new identity on the second dial fails it.
- The dial address form is `/dns4/<name>/tcp/443/tls/ws/p2p/<peerId>`.
- The identity half is already built and tested (`hosted-identity.ts`, 8 cases): the seed is
  persisted through `DoDatastore`, so a PeerId survives eviction.
- Criterion 5's guard reads the configuration and asserts `preview_urls: false` is **stated
  rather than inherited**. What a build cannot see is a deploy performed by hand with a flag;
  `DEMO-04`'s guard covers that half by forbidding a CI workflow to exist at all.
- `DEMO-04` was **repurposed, not retired** (ruling 2026-08-25): the guard stands and its
  rationale is rewritten from *disclosure is irreversible* to *deploying a paid tier does not
  happen by itself*.

</specifics>

<deferred>
## Deferred Ideas

**To Phase 30 — Inbound Listener Correctness & Hibernation:** `remoteAddr` from
`CF-Connecting-IP`; admitting more than five distinct clients a second; the explicit
`bufferedAmount` backpressure answer; the hibernation-aware socket.

**To Phase 31:** every DHT record. Phase 29's datastore carries the node's identity key and
**no** DHT record — a `put` of a record-shaped key from this assembly fails a guard, so the
unbounded-accumulation window never opens before the expiry sweep lands beside the record
store.

**Not closed by this phase:** `NET-03` is reported as a **second route**, not a closure. On the
Cloudflare path TLS is terminated at the edge by a commercial certificate the host already
holds, so the certificate requirement **does not arise rather than being satisfied**. The
AutoTLS route is untouched and still wants a public authority and a publicly reachable
interface, and `NET-03`'s row keeps that half open.

</deferred>

---

*Phase: 29-hosted-tier-assembly-and-first-deploy*
*Context gathered: 2026-08-27 — owner session, one decision taken (the adapter)*
