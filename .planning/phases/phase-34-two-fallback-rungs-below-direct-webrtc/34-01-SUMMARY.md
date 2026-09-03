---
phase: 34-two-fallback-rungs-below-direct-webrtc
plan: 1
subsystem: connectivity
tags: [turn, ice, webrtc, coturn, workerd, enrolment, sharding, e2e, net-12]
requires:
  - .planning/consults/2026-09-02-turn-provider-measured.md
  - .planning/phases/phase-35-conditions-of-entry-in-the-browser/35-01-SUMMARY.md
provides:
  - "NET-12 Partial — criterion 1 closes ON MECHANISM; criterion 2's built half only; the row stays UNCHECKED in both places"
  - "this repository states its own iceServers; the dead default stun.services.mozilla.com is gone"
  - "the hosted tier has a certificate gate for the first time — it had none of any kind before"
  - "Chromium DOES allocate against a loopback coturn — a first for this repository, with the flag that makes it work"
  - "two plants that stayed GREEN, both reported with the case that actually carries the claim"
  - "a plan instruction refused on the strength of Phase 29 criterion 6, and recorded"
affects:
  - packages/browser/src/ice-configuration.ts
  - packages/browser/src/ice-configuration.test.ts
  - packages/browser/src/ice-configuration-library.node.test.ts
  - packages/browser/src/turn-credentials.ts
  - packages/browser/src/turn-credentials.test.ts
  - packages/browser/src/browser-node.ts
  - packages/browser/src/index.ts
  - packages/browser/demo/main.ts
  - packages/core/src/enrollment.ts
  - packages/core/src/index.ts
  - packages/cloudflare/src/turn-credential.ts
  - packages/cloudflare/src/turn-credential.test.ts
  - packages/cloudflare/src/turn-credential.e2e.test.ts
  - packages/cloudflare/src/turn-regions.ts
  - packages/cloudflare/src/turn-regions.test.ts
  - packages/cloudflare/src/turn-regions-source.node.test.ts
  - packages/cloudflare/src/turn-sharding.e2e.test.ts
  - packages/cloudflare/src/worker.ts
  - packages/cloudflare/src/worker.test.ts
  - packages/node/src/e2e-browser-launch.ts
  - packages/node/src/ice-servers-alive.e2e.test.ts
  - packages/node/src/turn-fallback.e2e.test.ts
  - packages/node/src/turn-end-to-end.e2e.test.ts
  - packages/node/src/turn-mint-payload.node.test.ts
  - packages/node/src/requirements-ledger.node.test.ts
  - tools/turn-provider-probe.mjs
  - .planning/REQUIREMENTS.md
  - .planning/consults/2026-09-02-turn-provider-measured.md
completed: 2026-09-02
---

# Phase 34 Plan 1: Two Fallback Rungs Below Direct WebRTC (the remaining half) — Summary

**One line:** A browser pair that cannot use a direct candidate now connects over a real RFC 5766
TURN server using a short-lived credential minted behind a certificate gate that did not
previously exist anywhere in the hosted tier — and the four ICE servers this fabric had been
silently depending on, one of which no longer resolves, are replaced by a list this repository
states and guards.

---

## What closed, what did not

**Criterion 1 closes ON MECHANISM.** Every clause of its sentence has an observation behind it:

| Clause, verbatim | The observation |
|---|---|
| *a pair that fails to connect directly connects over TURN* | Two isolated browser contexts under `iceTransportPolicy: 'relay'` connect through `coturn 4.17.2` on loopback. Read three ways from **outside** the page: the configuration handed to `RTCPeerConnection`, the **selected** candidate pair's local candidate being `typ relay` via `getStats()`, and coturn's own log showing an allocation **per tab's node key** |
| *credentials supplied through `rtcConfiguration`'s function form* | `browser-node.ts` constructs `webRTC({ rtcConfiguration: async () => … })` at the one construction site in the repository. The function form is re-invoked per connection in both directions, which is what makes "short-lived" possible at all |
| *a credential captured from one session is refused after its stated lifetime* | Observed twice. **Arm C** mints an already-expired credential — no allocation, coturn answers 401. **Arm D** mints an 8 s credential, connects with it, waits the lifetime out, and a fresh gathering does not connect |
| *a request from outside the fabric is refused* | `POST /turn-credential` refuses an unpinned issuer **by name**, with a valid-certificate positive control as its floor, in the node lane and against a real local `workerd` |
| *both verified before Phase 39 invites anyone* | All of the above ran locally today, before any cohort exists |

**What criterion 1 does NOT carry: the provider instantiation.** Nothing here has been observed
against Cloudflare's own TURN service. No key exists, so the Cloudflare credential adapter is
deliberately **unwritten** behind a named seam. The runbook is where that is owed.

**Criterion 2 does NOT close.** Its built half landed — three declared regions, three rungs,
three tags, an undeclared region refused, no location claimed anywhere. The missing evidence is
**two things, not one**, and neither is substitutable:

1. **Three sited objects** — Phase 33's subject, gated on the owner and on money, not run.
2. **Clients on two continents** — without them there is no cross-continent *pair* to observe
   even if the three objects existed. Phase 39's cohort, or the tester cohort the owner has.

Three region names answered by one local `workerd` is **one object serving three names**. It is
not three objects and it is certainly not three regions.

**`NET-12` stays unchecked** — the checklist box and the ledger row both. The ledger row states
exactly what landed and what did not, and a `REREAD_REGISTER` entry carries the promise to
re-read it when both missing pieces exist.

**Criterion 3 (`NET-13`) untouched, still `[x]`.** Nothing here restates the 64 KiB figure.
**Criterion 4 untouched.** Its residual is carried forward verbatim below.

### Criterion 4's residual, carried forward verbatim

> the refusal lands at whichever node would *send* the oversized frame, so a job whose bulk
> arrives as a **reply** is refused by name at the serving side while the requestor sees a
> timeout. Nothing in this plan repairs that and nothing in this plan may make it worse.

Nothing in this plan touched that path. One note so nobody reports a false finding: a pair
connected **over TURN** is a WebRTC connection at the libp2p level, not a circuit, so `pathTo`
reads it `'carries-work'` — which is correct, because no Circuit Relay v2 data limit applies to a
TURN'd data channel. It is also exactly why TURN is billed and a circuit is not.

---

## The measurement everything else stands on

**Chromium DOES allocate against a loopback TURN server.** This had never been established in
this repository and the whole of criterion 1 depends on it, so it was probed before anything was
built on it.

```
candidate:185922738 1 udp 50339839 127.0.0.1 64682 typ relay raddr 0.0.0.0 rport 0 generation 0 ufrag 6zCe network-cost 999
session 007000000000000001: new, realm=<o2.invalid>, username=<1788403690:smoke>, lifetime=600
session 007000000000000001: realm <o2.invalid> user <1788403690:smoke>: incoming packet ALLOCATE processed, success
```

`coturn 4.17.2` (Homebrew, already installed). The scheme accepted is a username of
`<unix-expiry>:<region>:<nodeKey>` with a credential of `base64(HMAC-SHA1(username, secret))`.

### `--allow-loopback-peers`, and why its absence is the nastiest failure this phase found

Without it, **coturn allocates happily and the pair silently never forms.** The client gets a
`typ relay` candidate, the log says `ALLOCATE processed, success`, every instrument reads green —
and no connection is made, because both peers' relay addresses are on `127.0.0.1` and loopback
peers are denied by default. Arm A failed this way for two runs with all its other readings
passing. On a real deployment peers are not on loopback and the flag is neither needed nor
wanted; it is here because the whole arrangement is on one machine.

### coturn's refusals are less distinguishable than they look

Measured, and recorded so nobody reads more out of an arm than it can carry:

| Attempt | Reading |
|---|---|
| Unauthenticated Allocate | `0x0113` error **401** — the same reading the provider probe took against Cloudflare |
| Already-expired credential | 0 candidates; `icecandidateerror {code: 401, text: "Unauthorized."}`; log: `check_stun_auth: Cannot find credentials of user <…>` |
| Wrong-secret credential | **Byte-identical shape to expired** |
| Far-future credential | **Also refused**, same shape — see plant 3 |

*Expired* is **not** distinguishable from *bad HMAC* by the error text. What makes arm C a
statement about expiry is that the same minter, with a future expiry, is observed allocating in
the same run — a comparison inside one run rather than an absolute.

---

## Every plant, with its observed text

Fourteen plants. Twelve reddened; **two stayed green and both are reported with the case that
actually carries the claim.**

### Task 1 — the ICE configuration

**Plant 1 — put the real dead entry back.** RED, on that entry, both controls green in the same
run. A true observation rather than a synthetic one:

```
AssertionError: promise rejected "Error: getaddrinfo ENOTFOUND stun.service… { …(4) }" instead of resolving
Caused by: Error: getaddrinfo ENOTFOUND stun.services.mozilla.com
Serialized Error: { errno: -3008, code: 'ENOTFOUND', syscall: 'getaddrinfo', hostname: 'stun.services.mozilla.com' }
```

The host-conditions banner reported oversubscription on that run. It does not touch this
finding: `ENOTFOUND` is a categorical DNS answer, not a timeout.

**Plant 2 — relax the return type and add a branch returning `{}`.** RED on **two** independent
levels, which is stronger than the plan predicted. The plan expected `tsc` to stay at 0; it did
not.

```
tsc BEFORE plant: exit 0
tsc AFTER  plant: exit 1
packages/browser/src/ice-configuration.test.ts(72,14): error TS18048: 'config.iceServers' is possibly 'undefined'.

and the enumerated unit case:
× TURN explicitly absent — the credential-fetch-failed path: iceServers present, non-empty, and free of the dead entry
AssertionError: expected undefined to be defined
```

So the type and the enumerated case are **not** redundant with each other — both fire, and the
enumerated case is what would catch a future relaxation of the type.

### Task 2 — the gate

**Plant 1 — remove `verifyCertificate`.** RED, and the failure text shows the actual harm: a
working credential handed to an outsider.

```
AssertionError: a certificate from an UNPINNED issuer was served a TURN credential — this is
criterion 1's harm exactly: a request from outside the fabric was not refused:
expected '{"ok":true,"grant":{"username":"18000…' not to contain 'username'

Received: "{"ok":true,"grant":{"username":"1800000600:bootstrap-us:ed4928c628d1c2c6eae90338905995612959273a5c63f93636c14614ac8737d1",
"credential":"/xvKftnkGbPpoU4vBcKMDFXFc1Q=","urls":[…],"expiresAt":1800000600000,"region":"bootstrap-us"}}"
```

**The case had to move to produce that text, and that is worth recording.** On the first run the
plant reddened at `expect(result.ok).toBe(false)` and printed only `expected true to be false` —
true, and it does not tell a reader that an outsider was handed a working TURN credential. The
harm assertion was moved **above** the early return so the failure names what leaked.

**Plant 2 — remove the node-key binding.** RED.

```
AssertionError: a borrowed certificate must not open the gate: expected true to be false
```

This plant only exists because the gate was **restructured to make it possible**. The first draft
built the signed payload directly from `certificate.nodeKey`, which makes the binding true by
construction — safe-looking, and impossible to ever prove. The request now carries the claimed
`nodeKey` explicitly and step 3 compares it, so a caller presenting somebody else's certificate
with their own valid signature is refused by name.

**Plant 3 — multiply the stated lifetime.** RED, and the literal held.

```
AssertionError: expected 1800600000000 to be 1800000600000
```

The assertion is a literal (`1_800_000_600_000`), not `NOW + CREDENTIAL_LIFETIME_MS` read back
from the module, so it could not move with the implementation.

### Task 3 — the pair

**Plant 1 (the most load-bearing in the phase) — CORRECTION 2 on the live path.** RED, naming the
resurrected default, read from **outside** the page:

```
AssertionError: the four @libp2p/webrtc defaults are back in the live configuration, dead entry
included — a path returned a config without an `iceServers` key and `getRtcConfiguration` read
that as "use the defaults". This is CORRECTION 2 happening.:
expected '[{"iceServers":[{"urls":["stun:stun.l…' not to contain 'stun.services.mozilla.com'

Received: "[{"iceServers":[{"urls":["stun:stun.l.google.com:19302"]},{"urls":["stun:global.stun.twilio.com:3478"]},
{"urls":["stun:stun.cloudflare.com:3478"]},{"urls":["stun:stun.services.mozilla.com:3478"]}]}]"
```

**The assertion order had to change first, and the reason is a finding.** With the connection
assertion ahead of the configuration one, this plant reddened in the *wrong place*: returning
`{}` also drops `iceTransportPolicy`, so the pair connected **directly** and the run never
reached the line that names the dead entry. **A red is not automatically the red you wanted.**

**Plant 2 — delete arm B (a reasoning check, no run).** What arm B protects is arm A's
`webrtc === true`. Without it, that reading cannot distinguish *TURN carried the pair* from *the
relay-only policy silently unbound and a direct candidate carried it* — which is not
hypothetical: it is exactly what plant 1 above produced, and what the `?turn=`-coupling defect
below actually did.

**Plant 3 — the minted expiry becomes a far-future constant. STAYED GREEN.** Reported in full,
because the finding is about the plan's own suggestion.

Arm C stayed green with the plant active (verified: the username became
`4102444800:bootstrap-us:nk`). Three things were checked before concluding anything:

1. **Arm C is not vacuous.** Re-run with a *valid* credential, arm C fails in 2168 ms — the
   arrangement connects when it should.
2. **The holder's own expiry check is not the blocker.** Overriding the response body's
   `expiresAt` to a future value changed nothing.
3. **The cause, isolated directly against coturn:**

```
CREDENTIAL username= 4102444800:smoke
=== RELAY CANDIDATE PRESENT === false
ERROR session 007000000000000001: check_stun_auth: Cannot find credentials of user <4102444800:smoke>
INFO  session 007000000000000001: … incoming packet message processed, error 401: Unauthorized
```

**coturn refuses a far-future credential too.** The plan's suggested plant swapped one refusal for
a different one, so arm C could not see the change. **The plant that works is a modest forward
shift** — `+3600` seconds, inside coturn's accepted window — and it reddens arm C:

```
× ARM C: a credential minted already-expired produces no allocation
AssertionError: expected true to be false
```

So arm C **does** carry the expiry claim. What was wrong was the plant, not the case.

**Plant 4 — the credential cache never refetches. STAYED GREEN on arm D, RED on the unit case.**

```
arm D:      ✓ ARM D: a short-lived credential works, then stops once its lifetime has passed
unit case:  × refetches once the clock is inside the refresh margin
            AssertionError: a credential inside its margin must be replaced, not reused: expected 1 to be 2
```

Arm D's second half opens **fresh contexts** whose holders start empty: they fetch once, and there
is no cached credential for a broken cache to wrongly re-use. So **arm D does not carry the
rotation claim** — it proves *the server refuses an expired credential on a fresh gathering*. The
case that carries rotation is `turn-credentials.test.ts`'s *"refetches once the clock is inside
the refresh margin"*. Neither case was weakened; the distinction is written into the spec's own
docblock so the next reader does not re-derive it.

### Task 4 — the joint

**Plant 1 — the tab ignores the minting endpoint.** RED: `the pair formed no unlimited /webrtc
connection`.

**Plant 2 — coturn and the worker hold different secrets.** RED, with coturn's own refusal
naming the gate-minted usernames — which is what proves the two halves are joined by one shared
value rather than by coincidence:

```
INFO session 007000000000000001: realm <o2.invalid> user <1788406769:bootstrap-us:9247be31d85ef60b74c6735734d2fb4ab3a4c74b55f4aa58976d89cee47ea391>: incoming packet message processed, error 401: Unauthorized
INFO session 007000000000000002: realm <o2.invalid> user <1788406769:bootstrap-us:0221a33b2c6c965835da1e6f49f640e2ca023323ac2af4174df6522200cb20bc>: incoming packet message processed, error 401: Unauthorized
```

### Task 5 — sharding

**Plant 1 — every region returns the `us` tag.** RED on three cases including
`yields exactly the three declared names`.

**Plant 2 — the worker ignores the region asked for.** RED on `bootstrap-eu` and `bootstrap-sam`
as the plan predicted, **and additionally** on the undeclared-region case — an undeclared region
was served a credential, a harm the plan did not anticipate the plant would expose.

**Plant 3 — a city name in a comment.** RED. The plan warned this might stay green if the guard
only read string literals; it reads the whole source as text precisely because Phase 33's own
criterion 2 is a grep, and a grep does not skip comments.

```
AssertionError: turn-regions.ts names Frankfurt. Phase 33's criterion 2 forbids any surface
claiming where a hosted object runs, and Phase 33 has not run — so no such claim can be true yet.
```

Re-watched reddening after the guard moved to `turn-regions-source.node.test.ts`.

---

## The three corrections the plan carried

**CORRECTION 1 — re-verified, with the command and its output.** `packages/cloudflare/` had **no
certificate check of any kind** before this phase:

```
$ grep -rn "verifyCertificate\|EnrollmentAuthority\|trustedIssuers\|NodeCertificate" packages/cloudflare/src/
packages/cloudflare/src/hosted-libp2p.node.test.ts:17:import type { NodeCertificate } from '@o2/core'
packages/cloudflare/src/hosted-libp2p.node.test.ts:297:  const certificate: NodeCertificate = {
packages/cloudflare/src/hosted-record-store.e2e.test.ts:54:import type { NodeCertificate } from '@o2/core'
packages/cloudflare/src/hosted-record-store.e2e.test.ts:130:  const unsigned: Omit<NodeCertificate, 'signature'> = {
packages/cloudflare/src/hosted-record-store.e2e.test.ts:140:  const certificate: NodeCertificate = {
```

Five hits, **every one in a `*.test.ts` fixture**, none in production source. The package's own
words agreed (`hosted-capabilities.ts:36` — *"The hosted node holds no certificate."*). So
criterion 1's *"a request from outside the fabric is refused"* is **built in this phase** and
inherited from nothing.

**CORRECTION 2 — what it cost.** `getRtcConfiguration` does
`config.iceServers = config.iceServers ?? DEFAULT_ICE_SERVERS`, so a returned configuration
without the key is an instruction to use four servers this project never chose. It cost a
non-optional `iceServers` in the return type, an enumerated unit case over every path, a
library-behaviour guard pinning the package's own line, and the phase's most load-bearing plant.
**The plant aimed at it reddened**, naming the dead entry in the live configuration.

**CORRECTION 4 — two schemes, one adapter.** Only the shared-secret adapter (`coturn`'s
`use-auth-secret`) is written, and it is the one every spec here runs against. **The Cloudflare
adapter is deliberately unwritten**: that provider mints through an authenticated API call
against a key this project does not have, so writing it now would be code standing on
documentation — the *"wired is not used"* shape this repository has been caught by three times.
The seam is `TurnMinter`; the runbook's step 3 produces the observation it should be written
against.

---

## Deviations from the plan

**1. The `BrowserNodeOptions` seam is an endpoint, not a caller-supplied credential function.**
The first implementation took `turnRung?: () => TurnRung | null`. A caller **cannot** build a
mint request: it must be signed by the node key the certificate names, and the private half lives
inside `BrowserNode` (`identityFromSeed`) while the certificate lives in the tab's
`IdbIdentityStore`. The option is now `turnEndpoint?: string` and the node fetches its own
credential. This matches the plan's Task 1 text (*"the minting endpoint URL and an explicit
on/off"*) more closely than the first attempt did.

**2. The mint payload builder is not a shared callable.** It was written into `@o2/core` and
withdrawn: a callable on that barrel whose only production caller is `browser-node.ts` is
reachable solely through the `window.o2` hop, and both the unreachable-export bound and the
disposition register that would have had to absorb it are **full and frozen for this phase**.
Only the purpose string `TURN_MINT_PURPOSE` is shared. The drift that leaves is closed by
`turn-mint-payload.node.test.ts`, which builds both sides, compares **bytes**, and additionally
reads the signer's real source to check it encodes exactly those four fields — not by a comment.

**3. `coturn-harness.ts` does not exist; the harness lives in `e2e-browser-launch.ts`.** The
reachability guard counts orphan **modules**, and a spec-only harness cannot have a production
importer. A separate file would have been a 33rd orphan against a frozen ceiling of 32.
`e2e-browser-launch.ts` is an accepted orphan of exactly that class and both specs already import
it. Giving the module fake wiring was rejected; inlining into the two specs was rejected because
it would put two copies of the spawn flags in the tree, with `--allow-loopback-peers` being
precisely the line two copies would let drift.

**4. THE MINT IS NOT ROUTED TO THE NAMED REGION'S DURABLE OBJECT — a plan instruction refused.**
The plan asked for it *"through `stubFor` and nothing else"*. `worker.ts`'s `SERVED_BY` docblock
records this repository's own ruling:

> *"A constant, never derived from the request. Criterion 6's subject is precisely that a visitor
> cannot cause an object to be created, and an object is created by its first `get()`. A
> `?region=` parameter here would be the defect, and it would be invisible: the request would
> succeed, the object would exist, and its siting would be permanent."*

Routing a visitor-supplied region name into `stubFor` **is** that parameter. It would let any
caller create and permanently site two Durable Objects the owner has not decided to create — money
spent and a siting fixed, by a stranger, invisibly. Phase 29 criterion 6 forbids it and Phase 33
owns the decision. The sharding that landed is the half that does not require it: **the region
rides in the credential**, so an allocation is attributable to the region that minted it whichever
object served the request. What is deferred with Phase 33 is *which object answers* — a siting
question, not an attribution one.

**5. Two filesystem guards were split into `*.node.test.ts` files.**
`ice-configuration-library.node.test.ts` (split before it ever ran) and
`turn-regions-source.node.test.ts` (split after it cost three red files in the browser lane —
`Module "node:fs" has been externalized for browser compatibility`, zero red *tests*). The plan
asked for the first to sit in the dual-lane spec; it cannot.

**6. `.planning/ROADMAP.md` and `.planning/STATE.md` were NOT touched.** The executor was
instructed not to, because a concurrent session held uncommitted edits to both. **The Phase 34
block in `ROADMAP.md` therefore does not yet name this SUMMARY** — that is outstanding and is the
one piece of Task 6 not done.

**7. Auto-fixed (Rule 1): the `?turn=` query helper coupled the ICE policy to the endpoint.**
`turnOptionsFromQuery` returned early when no `?turn=` was present, silently dropping
`iceTransportPolicy=relay`. **Arm B — the floor — then connected directly and reported the floor
as broken.** A floor arm needs the policy precisely when it has no rung.

**8. Auto-fixed (Rule 1): `peers()` is not a reading of the pair.** Two tabs on one relay hold
each other over the **circuit** regardless of whether any WebRTC path formed, so the first
version of every arm would have reported a circuit as a TURN success. Every arm now reads an
**unlimited `/webrtc`** connection via `connectionsTo`.

**9. Auto-fixed (Rule 3): the two new e2e relays named `'runs-unsigned-artifacts'` by reflex.**
`trust-anchors.node.test.ts` went red at 49 against a bound of 48. Neither spec runs an artifact —
no `runJob`, no `putModule` — so both now name a real (unused) anchor. **The bound was not
raised**; it exists to fail exactly when the opt-out starts spreading, and it did its job.

---

## Raw numbers

| Thing | Value |
|---|---|
| coturn | `4.17.2` (Homebrew, already installed) |
| coturn listen | `127.0.0.1`, a fresh random port per run, `--no-tls --no-dtls --no-cli` |
| coturn secret | `randomBytes(24).toString('hex')` per run, never written to a tracked file |
| Stated credential lifetime | `CREDENTIAL_LIFETIME_MS = 600_000` (10 minutes) |
| Acceptance window | `ACCEPTANCE_WINDOW_MS = 60_000` |
| Refresh margin | `REFRESH_MARGIN_MS = 60_000`, overridable per node |
| Arm D lifetime | 8 000 ms, plus a 2 000 ms cushion before the post-expiry gathering |
| STUN entries | 3 (`stun.l.google.com:19302`, `global.stun.twilio.com:3478`, `stun.cloudflare.com:3478`) |
| ICE entry ceiling | 4 entries. Measured in Chromium: 4-entries-5-URLs and 5-entries **both** accepted with an empty console, so the ceiling is the library's advice about gathering latency, not an engine limit. Honoured anyway, and without dropping a survivor — both TURN ports ride in one entry's `urls` |
| Local workerd ports | 8814 (Task 2), 8815 + 8816 (Task 4), 8817 (Task 5) |

**The comparison inside one run, which is what this repository prefers to an absolute:** on a
quiet host (`load/core 1.30`), arm A connected in **2 011 ms** while arm B — the identical
arrangement with no TURN — spent its full **7 476 ms** deadline without forming a pair, and arm
D's post-expiry gathering spent **7 493 ms** likewise. The ratio, not the absolute, is the
reading: connecting over TURN is roughly a quarter of the time the no-TURN arm spends failing.

---

## Gates

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | **exit 0** |
| `npx vitest run --project node` | **exit 0** — 238 files, 3 406 passed, 3 skipped |
| `npx vitest run --project browser` | **exit 0** — 396 files, 6 531 passed (chromium + firefox + webkit) |
| `npx vitest run --project e2e` | see below |
| Pre-commit cheap guards | **exit 0** — 9 files, 400 passed |

Every exit code was read with `EXIT=$?` on the line immediately after the command, never after a
pipe. The browser and node lanes were re-run on a quiet host after an oversubscribed first pass;
both banners read `host was quiet` for the runs quoted.

**The e2e lane** was verified per-spec for every spec this phase added or touched, each on a
quiet host: `ice-servers-alive` (8), `turn-credential.e2e` (6), `turn-fallback` (5),
`turn-end-to-end` (2), `turn-sharding` (5), and the regression check `two-tabs` (6). A full-lane
sweep exceeds a ten-minute command budget and was started in the background; **if it has not been
read to completion, the full-lane figure is not claimed here** — the per-spec results above are
what this SUMMARY stands on.

---

## What was NOT proved

- **Nothing was observed against a deployed object or a real provider.** No deploy, no TURN key,
  no remote resource. The credential scheme exercised is `coturn`'s; Cloudflare's is unwritten.
- **`iceTransportPolicy: 'relay'` removes the direct path BY POLICY.** A symmetric NAT is not
  constructible between two contexts on one loopback machine, so forbidding a direct candidate is
  the only honest substitution available. What is proved is *the rung carries a pair when no
  direct candidate is usable*. What is **not** proved is *how often real networks make direct
  candidates unusable* — that is cohort evidence.
- **The 10–20 % relay-required rate is a PROXY**, from a different protocol. `RUN-05` criterion 5
  forbids presenting it as measured. The real rate is one of the numbers the public run exists to
  take.
- **Three objects on one local workerd are three objects, not three regions** — and in this phase
  it is weaker still: one object answering three names.
- **Whether TURN on port 53 is reachable from the cohort's networks is unmeasured.** It is in the
  configuration because it survives firewalls that drop 3478 — the reason is stated, not the
  reachability.
- **Cost is unmeasured and unmeasurable from here.** See the runbook.

---

## The owner runbook — in order, and the order is the point

**1. Configure the spending alert. FIRST. Before anything else.**
Cloudflare has no hard spending cap; its budget alerts are informational and do not cap usage.
This milestone has already lost this ordering once — `HOST-10` is `Refuted` rather than `Partial`
precisely because **no later action repairs an ordering**. Do not proceed to step 2 until this
exists.

**2. Create the TURN key on the owner's Cloudflare account. Not before step 1.**

**3. Probe the credentials endpoint with the real key and RECORD THE OBSERVED RESPONSE SHAPE.**
This is the engineering step that unblocks the adapter. The adapter is deliberately unwritten
because writing it now would be code standing on documentation. Record what comes back, not what
the documentation says will come back.

**4. Write the Cloudflare adapter against the observation from step 3**, behind the `TurnMinter`
seam this phase left, and re-run the gate's specs against it.

**5. Deploy, then RE-VERIFY AGAINST THE DEPLOYED PAIR** the two things this phase proved locally:
a pair connecting over the provider's TURN, and an expired credential refused by the provider's
own server. Neither is inherited from the local proof.

**6. Drive a known volume and READ THE BILL.** The cost is a **billing fact, not a protocol fact,
and nothing in this repository can measure it.** Do not quote a price; measure one.

### The exposure, from the measurement rather than from a guess

`packages/browser/src/data-cost.ts` stands on three runs of the representative task reporting
`run.egress.totalBytes` of **11 387 / 10 971 / 11 387** bytes on 2026-09-02 — **egress only**,
with the inbound leg named as excluded rather than guessed. Doubling to bound the unmeasured
inbound leg gives roughly **22.2 KiB** per relayed run, hence about **47 000 relayed runs per
GB**, and about **310 000 total runs before 1 GB at a 15 % relay rate** — where **15 % is a
PROXY**, not a measurement.

**Why the exposure is small at all, as structure rather than hope.** `PROJECT.md`'s WebRTC
constraint keeps bulk data off the browser mesh entirely: artifacts fetch over an IPFS gateway
and partials stay small. **An artifact's weight never crosses a TURN relay.** The consequence, and
the thing to watch: **a task heavier than the colouring demo re-opens this arithmetic**, and the
figure must be re-taken before the cohort arrives rather than extrapolated from here.

### The free-tier question, answered so it is not re-asked

Cloudflare's TURN is free of charge when used natively alongside their Realtime **SFU**. An SFU
forwards **media tracks**; this fabric's peer path is a WebRTC **data channel** carrying control
messages and small partials. No media, no SFU — so this use is the standalone kind and is billed
on relayed traffic.

---

## Scope fence — held

- **No money, no remote resource, no public disclosure.**
- **No TURN key created.** No deploy; the only wrangler invocations were `dev` with
  `CLOUDFLARE_API_TOKEN` blanked, metrics off, and `--persist-to` a fresh `mkdtemp` directory
  removed in teardown.
- **coturn listened on loopback only**, fresh port per run, per-run secret never written to a
  tracked file.
- **The three `ocr-checks-worker*` scripts are untouched**, and their prefix appears nowhere.
- **No Docker.** Processes only.
- **`request.cf` was never read, logged, fixtured or committed** — a local `wrangler dev`
  populates it from the host's real public address.
- **No visible demo-page figure was added.** `REGIONS` and all three `UI_SPEC_TALLY` fields are
  untouched; nothing in criteria 1 or 2 asks for one.

---

## Threat flags

None. Every trust boundary this phase opened is in the plan's own register: the new
`POST /turn-credential` surface is `T-34-01`/`T-34-02` and is mitigated by the gate built here,
and the replay window is `T-34-03`, accepted and written into the module's docblock as a choice
rather than an omission — a captured request inside the window re-mints a credential **for the
identity it was already minted for**, which is strictly weaker than capturing the client's key.

## Self-Check: PASSED
