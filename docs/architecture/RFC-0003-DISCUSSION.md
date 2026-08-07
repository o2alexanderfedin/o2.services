# RFC-0003 — review discussion

A readable transcript of the review of
[RFC-0003](./RFC-0003-Decentralized-Cloud-Security-Architecture-v0.2.md), reviewer's points
paired with the project's answers.

**Reviewer:** Praxis, via Telegram, 2026-08-06 16:50 and 16:51.
**Answers:** grounded in measurements already recorded in this repository. Where an answer
contradicts something the reviewer assumed — or something *we* assumed — it says so.

Long-form working is in
[RESPONSE-01](./RFC-0003-RESPONSE-01-anchoring-and-freshness.md) (points 1–2),
[RESPONSE-02](./RFC-0003-RESPONSE-02-capability-algebra-and-envelope.md) (points 3–4), and the
independent [codebase review](./RFC-0003-REVIEW-codebase-2026-08-06.md). The reviewer's own
words are preserved in Russian in
[REVIEW-praxis](./RFC-0003-REVIEW-praxis-2026-08-06.md) — that file is the record; this one is
the conversation.

---

## Verdict, first

> **Praxis** — The frame is strong. Particularly right: the identity/authority split, functional
> CMs, the prohibition on delegation amplification, `critical` extensions, local verification, the
> explicit distinction between code signing and sandboxing, parent-hash, and an honest list of
> open questions. This is not "certificates will make decentralisation secure" — it is already a
> fairly clear model of *which claims a signature is capable of carrying*.
>
> But before this becomes a protocol, several places want pinning down harder.

> **o2.services** — Accepted, and we'd add that an independent pass over the RFC *against the
> running code* found eight places where it contradicts something already measured. Those are set
> out under each point below. The most important one is not on your list, because it isn't
> visible from the document: **§9's registration protocol cannot be implemented as written.**

---

## 1. CR is not a "trust anchor" in general — it's the anchor of a specific policy

> **Praxis** — A self-signed CR proves continuity of the key/application, but not the
> application's trustworthiness *for a new device*. Where does a client first obtain the CR pin?
> Is TOFU permitted? What does the UI say when the CR changes? How do multiple roots conflict?
> Otherwise "CR is the application trust anchor" quietly becomes "a valid chain means you may
> trust it."

> **o2.services** — Agreed, and the structural conclusion is sharper than the question implies:
> **the anchor is definitionally exogenous.** We enumerated every channel that can deliver a CR
> pin in this system — a browser tab loading a page, a Node agent started from a CLI, an embedded
> host app — and none of them is *inside* the fabric. Whatever delivers the anchor is by
> construction outside the thing the anchor secures.
>
> **TOFU: refused.** Not on principle, but because every real channel that can deliver an anchor
> already carries a stronger one. A tab that loaded the page over TLS has already trusted the
> origin; TOFU there would be strictly weaker than what it already relied on. If a future
> deployment insists, the bound we'd impose is **"the bootstrap attenuates"** — §5's own rule
> applied to the bootstrap edge, so a TOFU'd anchor can never grant more than the channel that
> delivered it.
>
> **UI on change:** a fourth `ConsentGap` kind (`anchor-changed`) inside the consent surface this
> project already ships, following the existing `question`/`answer` idiom and **defaulting to
> refusal**. The copy has to admit the awkward part out loud: the page cannot adjudicate its own
> key change.
>
> **Multiple roots:** precedence *across* channels (replace, matching the existing ruling in
> `demo/main.ts`), **refusal within a set**. Precedence within a set would let an attacker
> compromise the weakest anchor and win an ordering race.
>
> **Unresolved, and we're saying so rather than designing around it:** there is no rotation
> surface at all today. `SignedNameResolver`'s anchors are supplied at construction and *cannot be
> added to afterwards*. Everything above is proposed against a surface that does not yet exist.

---

## 2. Revocation/freshness is the main unclosed security node

> **Praxis** — The RFC honestly lists CRL/OCSP, epoch objects, DHT, relay cache and gossip, but
> doesn't say what happens offline or when fresh information is unavailable. You need hard-fail
> for relay registration and dangerous capabilities; bounded soft-fail only for low-risk/offline;
> a maximum age for the status object; and a statement of who signs epoch/status and how rollback
> of the status object itself is prevented. Otherwise "local verification" conflicts with the
> invariant *"stale authority cannot be revived."*

> **o2.services** — This is the right diagnosis, and the answer is more constrained than the
> RFC's menu suggests. **Four of §8's six mechanisms have no transport in this system:**
>
> | §8 mechanism | Measured state |
> |---|---|
> | DHT distribution | `@libp2p/kad-dht` is **not installed**. No DHT exists. |
> | gossip propagation | No `gossipsub`, no `floodsub`. |
> | relay caching | A relay is a **signalling channel, not a data path** — 2 min / 128 KiB defaults. |
> | CRL / OCSP | `grep -rniE "asn1\|x509\|pkijs\|ocsp\|crl"` over `packages/` → **zero hits**. |
>
> So the menu reduces to short lifetimes plus signed status objects, and the first has a measured
> floor: `@libp2p/circuit-relay-v2` refreshes at `min(max(expiry − REFRESH_TIMEOUT,
> REFRESH_TIMEOUT_MIN), …)` with `REFRESH_TIMEOUT_MIN` = **30 s**, read off the installed package.
> Below roughly 30 s a reservation expires before its holder tries to renew — **that is churn, not
> revocation.**
>
> **We had to correct ourselves here.** Our first answer was that the reservation TTL *is* the
> natural expiry surface, since Phase 24 measured the revocation window as exactly that
> (`ttlMs 40000 renewalAskedAfterMs 30031 droppedAfterMs 40049`). That's wrong on this project's
> cardinal rule. `NodeCertificate.discoverability` exists and `relayIds` is empty when `direct`, so
> **a direct peer holds no reservation and the gate never runs for it.** A relay-enforced
> revocation mechanism is one keyed on *how a peer is discovered*. Short lifetimes survive as the
> recommendation, but on the opposite ground — they are the only lever whose reach is **not** a
> function of topology.
>
> **The binding number turned out not to be the 30 s floor.** `certificateLifetimeMs` defaults to
> **30 days** — three orders of magnitude coarser than the mechanism enforcing it. Recommendation:
> **1 h**, sited against the existing `DEFAULT_ISSUANCE_WINDOW_MS = 3_600_000`, and
> `MAX_STATUS_AGE` **5 min**, sited against the installed `REFRESH_TIMEOUT` so freshness rides an
> exchange the transport already performs rather than adding a round trip.
>
> **Fail-posture keyed on operation, never on node kind** — the cardinal rule again. `CM-Status`
> is the only online key, and that is defensible precisely because **its compromise is a liveness
> attack, never an authority attack**. Rollback defence reuses machinery already implemented:
> `NameResolver.accept`'s `version` + `expiresAt` + pinned-signer rules, plus a **storage-free
> floor** — a status object older than the certificate it evaluates is refused — which covers
> restarted or evicted verifiers with no persistence at all.
>
> **And we found a second, larger hole than the one you asked about.** `peer-verifier.ts` records:
> *"A settled acceptance is never re-asked."* For block-fetch selection the revocation window is
> therefore the **connection lifetime**, not the certificate lifetime. It is asymmetric by design —
> `expired` sits outside `FINAL` so a refusal can be promoted to acceptance, but nothing demotes an
> acceptance. Minimum fix: re-ask a settled acceptance once its `expiresAt` passes. This is
> fabric-wide and needs an owner ruling.

---

## 3. AuthorityRule should be a formal algebra, not a "list of rights"

> **Praxis** — *"Subset of parent resources/actions"* sounds right, but implementation breaks on
> ambiguities: URL-prefix, wildcard namespace, method mask, quota, time, regex, network range,
> allow/deny combinations. Introduce a canonical normalised capability format, an
> `attenuates(parent, child) -> bool` algorithm, an intersection rule over the whole chain, and
> boundary test vectors. Otherwise a bug in the subset check is **privilege escalation**, not
> merely a bug.

> **o2.services** — Agreed, and there is a live defect here rather than only a specification gap.
>
> §5 says a child's actions must be a subset of its parent's. **The verifier does not check
> that.** `verifyChain` checks, per link: signature, `expiresAt > now`,
> `link.abilities.includes(options.ability)`, `link.ownerId === options.ownerId`, and that the
> previous link granted `delegate`. It does **not** check that a child's ability set ⊆ its
> parent's. A link can widen abilities it was never granted; the widening is merely masked for the
> single ability actually requested through that chain.
>
> So the RFC must say **verification-time**, in the imperative. Issuance-time is unenforceable —
> the issuer is the attacker.
>
> The good news is that the intersection rule §5 states is **literally what the code already
> computes**: `verifyChain` requires the ability in every link and returns
> `expiresAt = Math.min(...chain.map(link => link.expiresAt))`. For capabilities specifically,
> adopting the RFC is a re-encoding rather than a redesign.
>
> Two things we'd add to your list:
>
> - **Regex must be forbidden in the canonical form.** Containment between two regexes is
>   undecidable in practice, and unbounded regex is a ReDoS surface at a boundary that must fail
>   closed. If containment can't be decided, `attenuates` can't be sound.
> - **Intersection must be closed.** If two rules intersect to something not expressible in the
>   canonical form, that is a bug in the *format*, not in the checker.
>
> And a bound the RFC hasn't got: **`verifyChain` has no maximum depth.** It is
> `for (let i = 0; i < chain.length; i++)` with chain length arriving from the wire, one Ed25519
> verify per link. §4's `delegationDepth INTEGER OPTIONAL` is the right field, but `OPTIONAL`
> means a validator handed no value has no bound — which is today's defect with three more levels
> to walk. On a relayed browser connection the chain must also fit inside 128 KiB and complete
> inside a 5 s reservation ceiling.

---

## 4. The workload signature must bind the whole execution envelope

> **Praxis** — There's a content hash and a mentioned Workload Binding, but the signature must
> cover runtime/ABI, dependency lockfile or image digest, entrypoint, requested capabilities,
> resource limits, input commitments, egress policy, expiry and job nonce. Otherwise a legitimate
> bundle runs in a more privileged environment or with substituted dependencies — and the module
> hash stays correct.

> **o2.services** — Agreed, and **this project is already half-way there for an unrelated
> reason.** V8 exposes no NaN-canonicalisation control and no relaxed-SIMD switch — verified
> against `node --v8-options`, both absent. So determinism here is not a runtime setting; it is
> enforced as **a property of the published artifact at publish time**, and the required WASM
> feature set is already part of the artifact's identity and its cache key. Your "runtime/ABI must
> be bound" therefore has an existing hook to hang on rather than needing new machinery.
>
> Egress policy likewise already exists as a first-class concept — the egress manifest and
> `EgressGuard` are shipped, because the sovereignty claim is carried by a manifest and a coverage
> report rather than by a quorum.
>
> What genuinely doesn't exist yet is the **binding** — one signature over the whole envelope
> rather than several independent facts that happen to be true at once. That is the work.
>
> One caveat on §11 more broadly: its flow has no arm for the **sovereign** case, which is this
> project's headline claim. There, the data never moves, the owner's own node executes, and the
> result is **owner-attested** rather than quorum-verified. §14 also has no threat covering
> exfiltration through a job's output, which is exactly the risk that case creates.

---

## 5. CM-Recovery is the most dangerous certificate in the tree

> **Praxis** — It's described as emergency rotation / recovery / revocation — potentially able to
> rewrite trust entirely. Separate routine rotation, emergency revoke, root rollover and account
> recovery. For CR and CM-Recovery one badly wants threshold / M-of-N, a delay on root rollover,
> an independent recovery key, and a transparent append-only log. Otherwise compromise of a single
> recovery branch is *a neatly packaged master key*.

> **o2.services** — *Preliminary — this point arrived after our investigation ran, and has not
> had the same depth of work as 1–4.*
>
> Accepted in full, and the codebase makes the case sharper: **`CM-Recovery` answers a question
> this system currently cannot answer at all.** There is no key-compromise recovery anywhere.
> Anchors are pinned at construction and cannot be added to afterwards, so a compromised trust
> anchor today means hand-reconfiguring every node. The old-CR-cross-signs-new-CR transition is
> precisely the missing mechanism.
>
> Which makes your warning the operative one: the first recovery mechanism this system gets will
> also be the most powerful key in it, and it will arrive into a codebase that has *no* precedent
> for constraining such a thing. The four-way split, the M-of-N, and the delay are cheaper to
> specify now than to retrofit.
>
> One local note: the append-only log is the piece with the least existing support here. There is
> no DHT and no gossip, so a transparency log has no distribution path today — the same gap that
> hollows out §8. It may need to be an explicitly external dependency.

---

## 6. Relay registration protects key possession, but not the announced endpoints

> **Praxis** — Nonce + timestamp defend against direct replay, but you need a policy on endpoint
> takeover: registration TTL, sequence number / monotonic generation, a prohibition on an old
> record overwriting a newer one, endpoint-claim bound to a specific session / transport key, and
> churn limits. And don't let the relay become an oracle — answers about whether a node or
> application exists are themselves sensitive metadata.

> **o2.services** — *Preliminary, as above.*
>
> **The nonce point is correct and names a real, currently-open defect** — but it is aimed at the
> wrong hook, and that matters for how it gets fixed.
>
> The defect: `possessionChallenge` is `encodeCanonical({ purpose: 'o2-enrol', nodeKey, userKey })`
> — **static. No nonce, no timestamp, no server input.** An observed enrolment request is a fixed
> byte string, replayable by anyone who captured it; the only control is `IssuanceBudget`. Your
> "prevents replay of static registration proofs" is exactly right about exactly this.
>
> The placement: §9 puts the challenge at relay registration, and **that hook cannot host it.**
> `ConnectionGater.denyInboundRelayReservation(source: PeerId)` receives a peer id and nothing
> else. The HOP `RESERVE` message carries no certificate field and there is no reply channel for a
> challenge. Every element of §9's signed payload — advertised endpoints, application identifier,
> protocol version, registration attributes — has no carrier there. The nonce belongs at the
> **enrolment RPC**, which is a genuine request/response protocol with room for a round trip.
>
> On **endpoint takeover**: the monotonic-generation machinery you describe already exists in this
> codebase for a different payload — `SignedNameResolver.accept` refuses `record.version <
> existing.version` and keeps the highest it has seen. Reusing that shape for endpoint claims is
> the cheap path.
>
> On **the relay as oracle**: accepted, and worth stating in the RFC. We'd note the existing
> design pushes the other way — a peer id derived from an Ed25519 key *is* the node key, already
> proved over Noise and available with **no I/O of any kind**. That is channel-bound in a way a
> nonce-signature is not, and it means the relay can decide without ever answering an existence
> question. Preserving that property is probably the best defence against the oracle risk.

---

## 7. A separate cryptographic-profile specification is needed

> **Praxis** — Before implementation, name the minimum: permitted algorithms, bans on SHA-1 and
> weak curves, DER canonicalisation rules, certificate parsing limits, maximum chain depth,
> extension size limits, strict handling of duplicate extensions. An X.509 parser is an enormous
> attack surface; *"reject on ambiguity"* has to become a set of precise refusals.

> **o2.services** — *Preliminary, as above.* Accepted, and two of your items were reached
> independently by our own review of the RFC against the code:
>
> - **Maximum chain depth** — as in point 3, `verifyChain` has no bound at all and takes its
>   length from the wire.
> - **The parser surface** — and here we'd raise a prior question. Adopting X.509 means shipping
>   an ASN.1 parser into the **browser** trust path. The current signing surface is
>   `@noble/curves` + `@ipld/dag-cbor`, both already present; `pkijs` + `asn1js` is a few hundred
>   KB of exactly the code that generates CVE classes of its own, at the one boundary that must
>   fail closed. **Is X.509 buying enough to be worth that?** The RFC doesn't state the cost.
>
> Relatedly, `critical` extensions may buy less here than the RFC assumes. Their stated benefit is
> that a generic validator cannot silently ignore the restrictions — but **there is no generic
> validator in this system.** Every verifier is this project's own code against pinned anchors.
> Meanwhile the one place a standard validator *would* sit is §2's optional external CA, and a
> critical unknown extension guarantees that path rejects the chain. §2 and §4 pull against each
> other.
>
> On **DER canonicalisation** specifically: this fabric has a canonical-encoding requirement DER
> cannot express. The signing surface is strict DAG-CBOR with **deliberately inconsistent
> per-payload sort decisions** — `relayIds.sort()`, `abilities.sort()`, but `inputCids` *"in merge
> order, never sorted"*, because combine ordering is semantically meaningful. Any profile has to
> decide whether it replaces that whole surface or only the identity certificates.

---

## What next

> **Praxis** — What I'd do in the next commit: not code, but a small **RFC-0003 testable profile**
> with three things — an exact `AuthorityRule` schema and attenuation algorithm; a
> freshness/revocation policy table per operation type; and a set of adversarial fixtures: widened
> wildcard, expired parent + live child, stale epoch replay, duplicate extension, same issuer key
> but different parent cert, valid code hash + altered runtime envelope. Then the architecture can
> be not only discussed, but run through an independent validator.

> **o2.services** — This is the right next step and we're taking it. It also suits how this
> project already works: a claim that cannot fail isn't a claim, so every guard here is planted,
> watched going red, and restored before it's believed. Your adversarial fixtures are that
> discipline applied to the specification instead of the code.
>
> Two of your six fixtures already have a home:
>
> - **widened wildcard** → the missing subset check in `verifyChain` (point 3). This one should
>   fail today.
> - **valid code hash + altered runtime envelope** → the artifact-identity work, where the WASM
>   feature set is already part of the published artifact's identity (point 4).
>
> And we'd add a seventh, from our own review: **a chain deeper than any stated bound**, since
> there is no bound today and the length arrives from the wire.

---

## Open questions back to the reviewer

1. Is `CM-Node` a statement about a node's **authority**, or about **what kind of thing** it is?
   The latter collides with this project's cardinal rule — all nodes have equal functionality,
   only discovery differs — which the relay path already litigated in source.
2. Where does an uncertificated node obtain its **first** certificate, and what protects that
   endpoint? It cannot sit behind the §9 gate. Measured consequence: admission is **per-relay**,
   and the enrolment provider is *necessarily* an open door — so "cannot join the fabric" is not a
   property any certificate can carry.
3. Is `parentCertificateHash` required or optional, and what becomes of existing children when
   their CM rotates under §7? §13 pins exact parent bytes; §7 says roles rotate independently.
   Both cannot hold.
4. Is `rotationEpoch` **globally agreed** — needing consensus this design has no source for — or
   **per-verifier highest-seen**, needing none but guaranteeing nothing against a verifier that
   never saw the bump?
5. What CS lifetime is intended relative to a libp2p connection lifetime? A WebRTC handshake to a
   *new* browser peer is ~1.04 s measured as a loopback floor, and connection reuse is what makes
   browser-to-browser viable at all.
6. Does the RFC intend to replace the **whole** DAG-CBOR signing surface — result attestations,
   combine attestations, name records, delegations — or only the identity/authority certificates?
   Order-sensitive `inputCids` is the case that decides it.
7. §6 says keys stay in secure stores "whenever the platform allows it." For a browser tab — this
   project's core distribution bet — **no platform allows it**. `crypto.subtle` needs a secure
   context, which this project deliberately does not require so LAN `http://` origins work; and
   even an unextractable handle leaves any script on the origin holding a signing oracle. Is the
   browser tier therefore expected to hold **lesser authority** — and if so, how is that not a
   node kind?

---

_Compiled 2026-08-06. Reviewer's words are quoted from the Russian original in
[REVIEW-praxis](./RFC-0003-REVIEW-praxis-2026-08-06.md); any disagreement resolves to that file.
Answers to points 5–7 are marked preliminary because they arrived after the investigation of 1–4
had run._
