# RFC-0003 reviewed against measured behaviour in this tree — 2026-08-06

Companion to `RFC-0003-REVIEW-praxis-2026-08-06.md`. Where Praxis reviewed the RFC on its own
terms, this one checks it against what the repository has **measured**. Everything below cites
the tree as it stands.

**One correction to the premise this review was given.** The gate does **not** go through
`PeerVerifier`. `relayAdmissionGate` in `fabric-node.ts` issues its own `records` RPC and
deliberately does not reuse it — *"**Their failure dispositions are opposite.**
`PeerVerifier.verifiedPeers` is fail-*open* on an empty anchor set… This is fail-closed."* The
load-bearing half stands and is worse than stated: the hook receives only a `PeerId` and must
perform network I/O to learn anything else.

---

## CONTRADICTIONS

### C1. §9's protocol runs in the wrong direction

§9 has the node present a chain, the relay issue a nonce, the node sign it. The only hook that
exists is `ConnectionGater.denyInboundRelayReservation(source: PeerId)` — **a peer id and nothing
else**. The HOP `RESERVE` message carries no certificate field and there is no reply channel for
a challenge. The actual sequence is inverted: the *relay* asks the *joiner* for its records.

Every element of §9's signed payload — advertised endpoints, application identifier, protocol
version, registration attributes — has no carrier at this hook.

What the codebase found instead is **stronger** than the RFC's proposal: *"a peer id derived from
an Ed25519 key **is** the node key, already proved over Noise… available with no I/O of any
kind."* That is a channel-bound live proof of possession. A nonce-signature is not channel-bound
and is the weaker primitive.

### C2. §9's ordering claim is inverted, and it adds a hop to a budget already measured tight

By the time the hook fires, Noise, muxer negotiation and identify have all happened. Validation
is the expensive part, not the state.

`LIBP2P_RESERVATION_COMPLETION_TIMEOUT_MS = 5_000` — the **joining** side wraps its whole reserve
in it, so a gate that blocks longer fails the reservation on the client's clock **whatever
verdict it reaches**. Against that ceiling the repo allots `RELAY_ADMISSION_DEADLINE_MS = 3_500`
for *one* async question, in `RELAY_ADMISSION_ATTEMPT_MS = 700` slices, because the first ask does
not arrive: ask 1 → `timed out after 700ms` at **701 ms**; the peer became answerable **5 ms**
after the hook fired and ask 2 answered in **4 ms**. §9 puts a further synchronous revocation hop
inside that same window. There is not room.

### C3. §7 (local-first) and §9 (synchronous revocation lookup) contradict each other

Principle 7 permits contacting an authority only where freshness requires it; §9 then puts that
exception on the hot path of **every** reservation. The codebase ruled the opposite, twice, in
writing:

- `enrollment.ts`: *"Revocation is **non-renewal on the certificate's own clock**, not a list and
  not a shorter clock"* (owner correction, 2026-08-02)
- `result-attestation.ts`: *"There is no revocation list here and there must not be one."*

And the window is a number: `ttlMs 40000 renewalAskedAfterMs 30027 droppedAfterMs 40028`,
re-read independently as `30031 / 40049`. **The revocation window is the reservation TTL.**

### C4. Four of §8's six revocation mechanisms have no transport in this system

| §8 mechanism | Measured |
|---|---|
| DHT distribution | **No DHT.** `@libp2p/kad-dht` is not installed. |
| gossip propagation | No `gossipsub`, no `floodsub`. |
| relay caching | A relay is a **signalling channel, not a data path** — 2 min / 128 KiB. |
| CRL or OCSP | `grep -rniE "asn1\|x509\|pkijs\|node-forge\|ocsp\|crl"` over `packages/` → **zero hits**. |
| short lifetimes | Available — see C5. |
| signed revocation records | Constructible; no distribution path once the three above are gone. |

### C5. "Short certificate lifetimes" has a measured ~30 s floor

`@libp2p/circuit-relay-v2` refreshes at `min(max(expiry − REFRESH_TIMEOUT, REFRESH_TIMEOUT_MIN),
2**31 − 1)` with `REFRESH_TIMEOUT` 5 min and `REFRESH_TIMEOUT_MIN` **30 s**, read off the
installed package. For any TTL under five minutes the clamp wins; below ~30 s a reservation
expires before its holder tries to renew. **That is churn, not revocation.**

### C6. §6's non-exportability is unachievable in the browser and not achieved in Node

**Every private key in this repository is a raw 32-byte Ed25519 seed in ordinary memory and
storage.** Node: `writeFile(tmp, seed, { mode: 0o600 })`. Browser: raw seed in IndexedDB under
`SEED_KEY = 'node-seed'` and — worse for §3.2 — a provider signing key under
`PROVIDER_KEY = 'provider-seed'`. `grep -r extractable` over `packages/` → zero hits.

Concretely, on what a browser *could* achieve:

1. `extractable: false` `CryptoKey` handles **can** be `structuredClone`d into IndexedDB and are
   genuinely non-exportable from JS. That part of §6 is real in principle.
2. But `Ed25519` in `crypto.subtle` requires a **secure context**, which this project
   deliberately does not require — that is *why* `@noble/curves` was chosen. Adopting §6 means
   dropping LAN `http://` origins.
3. Even with `extractable: false`, **any script on the origin can ask the key to sign anything.**
   Against XSS or a malicious bundle dependency, non-exportability buys *deniability of key
   theft*, not authority containment. The attacker holds a signing oracle while the tab is open.
4. There is **no TPM / Secure Enclave path from a browser tab.** WebAuthn signs a fixed assertion
   structure and cannot be substituted as a general-purpose signer over this project's payloads.

So "whenever the underlying platform allows it" reads *never* for the tier that is the project's
core bet.

### C7. §2/§3.2's `CM-Node` keys authority on node *kind* — the cardinal rule forbids it

`enrollment.ts`: *"**All nodes have equal functionality.** The only thing that varies is how a
node can be *discovered*… There is no tier and no lesser node anywhere in this codebase."*

`relay-admission.ts` chose its hook partly for this reason: *"It is **per-peer**, so holding a
certificate stays a fact about a node and never a node kind"*, and under "## It is not a node
kind": *"nothing anywhere may branch on which factory built a peer."* `NodeCertificate`'s
`discoverability` field is annotated *"**Not a capability statement**"*.

Relatedly the hierarchy has no slot for `operatorId` — this fabric's unit of quorum diversity.

### C8. §2 adds three chain levels to a verifier with no depth bound

`verifyChain` is `for (let i = 0; i < chain.length; i++)` with **no maximum**, one Ed25519 verify
per link, chain length arriving from the wire. `delegationDepth INTEGER OPTIONAL` is the right
field, but `OPTIONAL` means a validator handed no value has no bound. On a relayed browser
connection the chain must also fit in 128 KiB and complete inside the 5 s ceiling.

---

## GAPS

- **G1 — the enrolment door.** §9 gates registration and never says how an uncertificated node
  gets a first certificate. `relay-admission.ts` already states the constraint: *"A relay that
  pins issuers must either serve enrolment itself, or name a provider a joining peer can reach
  without a reservation."* The enrolment provider is **necessarily** an open door; today nothing
  protects it but `IssuanceBudget`.
- **G2 — admission is per-relay, so "cannot join the fabric" is not a property a certificate can
  carry.** From the verifier's own run: `gatedRelayHolds: [member]`, `openProviderHolds:
  [outsider, reader]` — `reader` holds no certificate, was refused by the gated relay, and is in
  the open provider's holdings. *"The difference between them is not the certificate; it is which
  peers each happened to dial."* And there is no knob: `bin/seed.ts` has no `--admit-issuer`,
  `SeedServerOptions` has no field, and the seed is the relay every browser tab reserves on.
- **G3 — nothing specifies the path from "Denied" back to admitted.** libp2p arms its refresh
  timer only on the success path, so a refused peer leaves no timer; a **reconnection**, not time,
  gets a newly-admitted peer in. §9's `Denied` arrow is terminal.
- **G4 — §10 has no arm for "the freshness source was unreachable."** Its `failure` edge reads as
  *revoked*, not *unreachable*. The repo names this hole: *"an async gate that answers 'allow'
  while a lookup is outstanding is a **fail-open hole wearing a gate's clothes**."*
- **G5 — §5's attenuation is stated without saying who enforces it, and the verifier does not.**
  `verifyChain` checks signature, expiry, ability membership, owner, and the parent's `delegate`
  grant — but **not** that a child's ability set ⊆ its parent's. Issuance-time enforcement is
  unenforceable (the issuer is the attacker); it must be verification-time, in the imperative.

  > **CORRECTED 2026-08-13 — the check is missing and the property holds.** Every clause above
  > is true about the code and the conclusion drawn from it is not, which is this repository's
  > own most-cited defect shape running in reverse: a claim about *intent* (no subset test is
  > written) read as a claim about *effect* (attenuation is unenforced). It is not.
  >
  > `verifyChain` tests `link.abilities.includes(options.ability)` on **every** link, not on the
  > leaf — so the ability being exercised must be present in all of them, which is exactly
  > `ability ∈ ⋂ abilities`, the intersection §5 asks for, computed per request at verification
  > time. That is also precisely where this entry says enforcement belongs.
  >
  > So a child holding a *broader* set than its parent is **inert**: the extra ability is
  > recorded in the link and can never be exercised, because the moment anybody asks for it the
  > parent link fails `missing-ability` at its own index. The bound already holds and there is
  > nothing here to fix. Adding a set-subset test would refuse such a chain earlier and with a
  > better-named failure — a legibility improvement, not a security one, and it should be
  > argued for on that basis rather than on this entry.
  >
  > Two limits on this correction, stated rather than left to be discovered. It holds for a
  > **single-ability** decision, which is the only kind this codebase makes: `verifyChain`
  > returns `{ok, audience, expiresAt}` and no ability set, so no caller can ask a broader
  > question. And there is exactly **one** production caller — `authorizeCapability` — which
  > hardcodes `ability: 'execute'`, so `'read'` and `'delegate'` are never requested in
  > production and the intersection is exercised for one ability only.
  >
  > **`S5` was right and this entry disagreed with it.** S5 already records that §5's
  > `effective authority = intersection(...)` is *"literally what `verifyChain` computes,
  > including `expiresAt = Math.min(...)`"*. Two entries of one document reached opposite
  > readings of one function; S5's is the correct one.
- **G6 — no canonical-encoding rule, and this fabric has one DER cannot express.** The signing
  surface is strict DAG-CBOR with deliberately inconsistent per-payload sort decisions:
  `relayIds.sort()`, `abilities.sort()`, but `inputCids` *"in merge order, never sorted"* because
  combine ordering is semantically meaningful.
- **G7 — no X.509 analogue for signing-domain separation.** The codebase uses a purpose tag:
  `encodeCanonical({ purpose: 'o2-enrol', … })`, because *"one protocol could be replayed as an
  answer in another."* `certificateRole` is a role on a certificate, not a domain tag on a signed
  payload.
- **G8 — sovereignty has no representation in the hierarchy.** `sovereignFor` carries
  `certificate.userKey`; none of CR/CM/CU/CD/CS carries an owner-domain binding.

---

## RISKS

- **R1** — X.509 means shipping an ASN.1 parser into the browser trust path. Current surface is
  `@noble/curves` + `@ipld/dag-cbor`, both already present; `pkijs` + `asn1js` is a few hundred KB
  and a classic parser-differential surface, at the one boundary that must fail closed.
- **R2** — §4's `critical` marking buys nothing here (every verifier is this project's own code
  against pinned anchors) and actively breaks §2's optional external CA, which would reject a
  chain carrying critical unknown extensions.
- **R3** — §7's `rotationEpoch` reintroduces global mutable state. Contrast the codebase's
  monotone design, which works *because* it is strictly local: `SignedNameResolver.accept`
  refuses `record.version < existing.version`; a resolver keeps the highest **it has seen**.
- **R4** — §13 (parent binding by exact parent bytes) and §7 (independent rotation) cannot both
  hold. One CM rotation invalidates every descendant's parent hash. §4's `OPTIONAL` hints the
  author saw this; §13 never says when omission is legitimate.
- **R5** — session certificates multiply a cost already measured: a WebRTC handshake to a *new*
  browser peer is ~1.04 s as a loopback floor, and connection reuse is what makes browser-to-
  browser viable. §3.5 should state CS lifetime relative to connection lifetime.
- **R6** — §11 has no arm for the sovereign case, the project's headline claim. In it the data
  never moves, the owner's own node executes, and the result is **owner-attested** rather than
  quorum-verified. §14 has no threat covering exfiltration through a job's output.

---

## STRENGTHS

- **S1** — §9's challenge nonce names a **real, currently-open defect**: `possessionChallenge` is
  `encodeCanonical({ purpose: 'o2-enrol', nodeKey, userKey })` — static, no nonce, no timestamp,
  no server input. An observed enrolment request is a fixed replayable byte string; the only
  control is `IssuanceBudget`. The correction is only *placement* — it belongs at the enrolment
  RPC, which is a real request/response protocol, not at the gater.
- **S2** — §3.2's role separation attacks what the existing threat model calls its own dead end
  (*"A malicious provider is out of scope"*). Today one `providerPrivateKey` does everything, and
  in the browser it is raw bytes under `'provider-seed'`.
- **S3** — `CM-Recovery` and cross-signed rollover answer a question the codebase **cannot answer
  at all**: anchors are pinned at construction and cannot be added to afterwards.
- **S4** — §11's authorization-vs-isolation split matches the code and states it more crisply
  than the code does.
- **S5** — §5's `effective authority = intersection(...)` is literally what `verifyChain`
  computes, including `expiresAt = Math.min(...)`. For capabilities this is a re-encoding, not a
  redesign.
- **S6** — §14 names three things the existing threat model does not: stolen management keys,
  policy downgrade, and stale revocation information.

---

## What §14 drops that `.planning/THREAT-MODEL.md` covers

Mass identity creation to win quorum slots (called *"the weakest link in the model"* — and the
measured residual is refuse-cost ÷ mint-cost ≈ **3.0**); answer-copying and commit-reveal; quorum
stacking by one operator; exfiltration of sovereign bytes through a job's output; routing-view
eclipse; understated load and accepted-then-stalled work; false task-failure reports; stale
checkpoint rollback; and relay capacity exhaustion (named, but without the mechanism the codebase
has in `ReservationWatcher`).

---

## §17 — open questions

**Already answered by measurement, inherit rather than leave open:** revocation freshness (the
window **is** the reservation TTL, ~30 s floor, re-checked per grant, never mid-reservation); and
certificate discovery — the first ask is **destroyed, not delayed**, so any discovery mechanism
must **retry**, not wait (`RELAY_ADMISSION_ATTEMPT_MS` is *"a retry interval, not a patience
setting"*).

**Missing from §17 entirely, all load-bearing:** how an uncertificated node obtains its first
certificate; whether admission is a fabric or per-relay property; what a validator does when the
freshness source is unreachable; browser key storage.

**Correctly open, with an unstated constraint:** post-quantum migration — any candidate inherits
the requirement to run without `crypto.subtle` in an insecure context.

---

## Questions for the author

1. Is `CM-Node` a statement about **authority** or about **what kind of thing** a node is?
2. Where does an uncertificated node get its first certificate, and what protects that endpoint?
3. Is `parentCertificateHash` required or optional, and what becomes of children when a CM rotates?
4. Is `rotationEpoch` globally agreed (needs consensus this design has no source for) or
   per-verifier highest-seen (needs none, guarantees nothing)?
5. Is §5's attenuation an issuance-time or verification-time obligation?
6. What CS lifetime is intended relative to a libp2p connection lifetime?
7. Is the external CA expected to **validate the profile** or only **attest the CR's key**?
8. Does the RFC replace the whole DAG-CBOR signing surface, or only identity/authority
   certificates? Order-sensitive `inputCids` decides it.
9. §6 says "whenever the platform allows it." For a browser tab, none does. Is the browser tier
   therefore expected to hold **lesser authority** — and how is that not a node kind?
