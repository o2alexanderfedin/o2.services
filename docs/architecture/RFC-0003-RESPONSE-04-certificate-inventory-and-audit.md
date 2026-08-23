# RFC-0003 Response 04 — The certificate inventory, and the tree audited against Response 01

**Date: 2026-08-23.** Every reading below was taken against this tree on that date, by
reading the file named beside it. Where a number in an earlier document disagrees, the
disagreement is recorded rather than smoothed over.

## How to read this

Response 01 asked two questions — where a trust anchor comes from, and how revocation
stays fresh — and answered them with nineteen numbered recommendations. It also opened with
a §0 inventory of *"what this repository already has"*. This document does three things
that §0 does not:

1. **Enumerates every certificate-shaped artefact the system has.** §0 lists surfaces; it
   does not present the set as a set, and the set has grown since.
2. **Audits the tree against Response 01's own recommendations**, one row per
   recommendation, measured rather than recalled.
3. **Records what was learned about the DHT this week**, because two of Response 01's
   assumptions about it are now false, and because one library's public options are
   declared, threaded into a constructor, and read by nothing — which cost this project
   three wrong answers before a test settled it (§8).

A fourth section carries the **work register**, so that "implement everything" has an
enumerable referent rather than being a mood.

---

## §1. The complete inventory — seven artefacts, plus an eighth of different nature

Response 01 draws one distinction the RFC did not: **two independent pinning mechanisms,
pinning different sets for different decisions.** That distinction is real and load-bearing,
and it is the top of this list rather than a footnote in it. What follows is the whole set.

| # | Artefact | Where | What it decides | State today |
|---|---|---|---|---|
| 1 | **Root policy anchor** (CR) | compiled into the bundle | which publisher this deployment believes | Present. Supplied at construction and **immutable** — no rotation, no re-pin, no runtime revocation |
| 2 | **`trustAnchors`** | `packages/core/src/naming.ts` | who may sign **name records** — artefact provenance | Present, **required, no default**. Type `readonly PublicKeyHex[] \| 'runs-unsigned-artifacts'`. Enforced by `SignedNameResolver` + `guardModuleProvenance` |
| 3 | **`trustedIssuers`** | `packages/core/src/enrollment.ts` | who may sign **node certificates** — admission and peer selection | Present but **optional**. Enforced by `verifyCertificate` + `PeerVerifier` + `relayAdmissionGate` |
| 4 | **`NodeCertificate`**, native envelope | `packages/core/src/enrollment.ts:190` | that a node is who it says, and how it is reachable | Present. Lifetime **30 days** |
| 5 | **The same statement as DER X.509 v3** | `enrollment.ts:233`, `x509.ts` | interoperability with X.509 tooling | Present and **wired on the trust path, fail-closed** |
| 6 | **Capability delegation chains** | `packages/core/src/capability.ts` | what a holder may do, and what it may pass on | Present |
| 7 | **Signed `NameRecord`** | `packages/core/src/naming.ts` | which bytes a name resolves to | Present, with monotonic-version rollback refusal |
| 8 | **Infrastructure TLS** — Let's Encrypt cert, WebRTC-Direct certhash key | libp2p keychain | whether a browser can dial this node at all | Present in code; **not persisted** — see §2 |

### The asymmetry between 2 and 3, which is the single most important line in this table

In RFC terms 2 and 3 are the descendants of two different management certificates —
`CM-Code` and `CM-Node` — under one CR, and `fabric-node.ts` states it plainly: *"They pin
different sets."* The codebase implemented §3.2's separation of management roles before the
RFC described it.

But the two are not symmetric, and the asymmetry is a live fail-open:

- **`trustAnchors` cannot be empty.** The opt-out is a **named literal**,
  `'runs-unsigned-artifacts'`, and `module-provenance.ts` states the rule: *"There is no
  exempt case […] a module is vouched for or it does not run."* Emptiness is not
  expressible, so nobody can disable artefact provenance by forgetting a field.
- **`trustedIssuers` can be empty, and empty means the verifier does nothing.** A node
  constructed without it admits every peer. The difference between the two is not stylistic;
  it is the difference between an opt-out somebody had to type and an opt-out somebody could
  reach by omission.

### The two fields in the node certificate that this document exists partly to surface

`NodeCertificate` is `{nodeKey, userKey, operatorId, discoverability, relayIds, issuedAt,
expiresAt, issuer, signature}`. Two of those are usually skipped in summaries and are the
foundation of §9:

- **`discoverability`** (`enrollment.ts:176-180`) is `'seed' | 'via-relay'`. `'seed'` means
  *"dialable directly; usable as a bootstrap entry point."*
- **`relayIds`** (`:204`) names the relays through which a `'via-relay'` node is reachable.

**Both are signed by the issuer.** The fabric therefore already possesses an
offline-verifiable statement of which nodes are relays — see §9 for why nothing reads it.

---

## §2. Caching is safe by construction — and the one artefact where it is not

The reason all of 1–7 may be cached without ceremony is a decision already recorded in the
code, not a new argument:

> `enrollment.ts`: *"Revocation is **non-renewal on the certificate's own clock**, not a
> list."*
> `result-attestation.ts`: *"There is no revocation list here and there must not be one."*

Verification is therefore **entirely offline**. A cached certificate is checked by the same
code, against the same pinned issuers, as one fetched a second ago; and it stops being
accepted by itself, at its own `expiresAt`, with nobody needing to be reachable for that to
happen. Caching cannot make a stale credential look fresh, because freshness is a property
the credential carries.

That is a strong property and it is worth stating positively: **this system can verify its
peers with the network down.**

### The exception, and it is type 8

Type 8 is not a claim about a peer; it is the material from which **this node's own address**
is derived. The WebRTC-Direct certhash key determines the multiaddr other nodes have written
down. Rotating it on a timer therefore does not refresh anything — it silently invalidates
every published record that names this node, on a schedule.

So for type 8 the correct policy is **persistence without rotation**, plus removal of
orphaned entries. Let's Encrypt certificates within the same store are the opposite case:
they expire and are renewed by their own machinery, and want no policy at all.

**Nothing persists any of this today.** `FabricNodeOptions.datastore` exists, is typed as
libp2p's `Datastore`, and **zero production callers pass it** — checked across
`packages/node/src/bin`, `packages/browser/src` and `packages/browser/demo`, where the
identifier does not appear. libp2p's keychain reads and writes `components.datastore`
(`node_modules/@libp2p/keychain/src/keychain.ts:174,241`), so with no datastore supplied the
address key is regenerated at every start.

---

## §3. Audit — Response 01 §2.10, revocation and freshness

Twelve recommendations. Ten are code; two are RFC text. Measured 2026-08-23.

| # | Recommendation | In the tree | Reading |
|---|---|:---:|---|
| 1 | Certificate lifetime 30 d → **1 h** | **No** | `enrollment.ts:929` — `options.certificateLifetimeMs ?? 30 * 24 * 3_600_000` |
| 2 | State the enforcement-grain rule | n/a | RFC text |
| 3 | **Stapling** — the checked party carries its status | **No** | No status object exists. The three occurrences of "stapl" are prose: `enrollment.ts:1265`, `net/src/enrol-client.ts:107`, `node/src/mutation-ledger.ts:3564` |
| 4 | Fail-posture split **by operation**, three named values | **No** | None of `refuses-without-fresh-status`, `proceeds-on-unexpired-credential`, `refuses-always` occurs anywhere under `packages/*/src/` |
| 5 | `MAX_STATUS_AGE` = 5 min | **No** | Zero occurrences |
| 6 | `CM-Status` as a distinct, and the only online, key | **No** | Zero occurrences |
| 7 | Status object shaped like `NameRecord` | **No** | Follows from 3 |
| 8 | Storage-free rollback floor — a status older than the certificate it evaluates is refused | **No** | Follows from 3 |
| 9 | A **`revoked`** member of `CertificateFailure` | **No** | `enrollment.ts:1194` — `untrusted-issuer \| bad-signature \| expired \| not-yet-valid \| x509-not-hex` (plus the X.509 profile refusal). `revoked` occurs nowhere outside `cert-lifecycle.ts` |
| 10 | Record the clock assumption; carry the relay's time in the §9 challenge | **No** | `possessionChallenge` (`enrollment.ts:277`) encodes `{purpose, nodeKey, userKey}` and, in the module's own words, *"nothing else — no nonce"*; `:29` calls the challenge *"deliberately still static"*, freshness carried by a separate minted-challenge lifetime |
| 11 | **Re-ask a settled acceptance once its certificate has expired** | **YES** | `packages/libp2p/src/peer-verifier.ts:591` — `if (settled.certificate.expiresAt > now) return settled`, otherwise the verdict is demoted and re-asked |
| 12 | Record that revocation is non-renewal | n/a | RFC text |

**Score: one of ten.**

The one that landed is not the least of them. §2.10 item 11 says of itself that without it
*"every other recommendation here reaches the admission path and not the selection path, and
the headline number is the connection lifetime rather than the certificate lifetime."* So the
precondition for the rest of the list is in place; the rest of the list is not.

**What the nine missing items are, stated as one thing rather than nine:** there is today no
way to withdraw trust from a node except to wait for its certificate to expire, and that wait
is thirty days.

### Done since Response 01 was written, and therefore absent from its inventory

The **X.509 form is wired on the trust path, fail-closed**: `checkX509Form` in
`enrollment.ts` calls `decodeX509Certificate` and `describeX509Failure`, and the refusal
kinds it introduced are visible in `CertificateFailure` above. `cert-lifecycle.ts:110-112`
records that an earlier claim of *"shipped decode-only and deliberately unwired"* is now
false about the tree. Response 01 predates this and does not know about it.

---

## §4. Audit — Response 01 §1.8, trust anchoring

Seven recommendations. Four are RFC text edits (rename the concept, add the provenance
table, forbid TOFU, move certificate transparency between sections). Three are code.

| # | Recommendation | In the tree | Reading |
|---|---|:---:|---|
| 4 | **Anchor change is a consent event** — an `anchoredTo` field plus a fourth `ConsentGap` kind | **No** | `anchoredTo` has zero occurrences. `ConsentGap` (`packages/browser/src/consent.ts:63`) still has exactly three kinds: `never-asked \| unreadable \| terms-changed` |
| 5 | Precedence across channels: a supplied anchor **replaces** rather than joins | **YES**, Node tier | `bin/agent.ts`, `bin/seed.ts` — `values['trust-anchor'] ?? [KERNEL_TRUST_ANCHOR]`. `packages/browser/demo/main.ts` follows the same rule |
| 6 | Pre-rotation — a `nextKeyCommitment` field | **No** | Zero occurrences |

The second half of recommendation 5 — *refusal within the set, never pick* — was not found
and is **not claimed either way here**; `naming.ts` refuses on several grounds but no
multi-anchor disagreement branch was located. It is carried in the work register as a thing
to determine rather than as a gap asserted.

---

## §5. The contradiction — two revocation designs live in one package

This must be stated rather than reconciled quietly, because a reader of either half alone
will come away with the wrong model.

- `enrollment.ts` and `result-attestation.ts` say revocation **is not a list** and that
  there must not be one.
- `cert-lifecycle.ts` declares `RevocationReason` (`'key-compromise' | 'superseded' |
  'ceased-operation'`), `RevocationStatus`, `Revocation`, and a `DirectoryPort` with
  `publishRevocation` and `revocationStatus`.

These are not two halves of one design. They are two designs.

**Response 01 §2.10 item 12 settles it**, and the settlement favours the code: revocation
**is** non-renewal, and the stapled status object of item 3 is an *addition* to expiry — the
checked party carrying a short-lived signed statement about itself — not a list anybody
queries. §2.4's whole point is that the relay holds fresh status, not the joining node, which
is what breaks the circularity of *"you need a relay to get status and status to get a
relay."*

**Therefore, recorded as the resolution:** of `DirectoryPort`'s four methods, `publish` and
`fetch` are adopted; `publishRevocation` and `revocationStatus` stay unwired, **and the
reason is this section** rather than an oversight to be tidied up by a later reader.

---

## §6. `cert-lifecycle.ts` — complete, tested, and connected to nothing

`packages/core/src/index.ts:513` records it: *"`cert-lifecycle.ts` is imported by nothing in
the production corpus — measured, and it is one of 27 such modules."* The state is held
deliberately, as an owner non-decision guarded by a check
(`packages/node/src/mutation-ledger.ts:3595`), not by accident.

Two of its declarations matter to everything else in this document:

- **`DirectoryPort`** (`cert-lifecycle.ts:333`) is `publish(cert)` / `fetch(ref)` /
  `publishRevocation(r)` / `revocationStatus(ref)`. The first two are **a description of a
  DHT**. The module was written against an abstract "there is a directory somewhere"; there
  now is one.
- **`Action`** (`:172`) is `'execute' | 'read' | 'delegate' | 'relay' | 'issue'`. The
  capability vocabulary already contains **`relay`** — the fourth sense of "provider" in §9,
  expressed as an authority rather than as an announcement.

---

## §7. What the DHT can and cannot do — measured, because two prior assumptions were wrong

### It does not forward messages

Kademlia as implemented here is **iterative**. The querying node dials each peer itself
(`node_modules/@libp2p/kad-dht/src/network.ts:180` —
`connectionManager.openStream(to, this.protocol, options)`), and when a peer answers with
closer peers, the querying node queries **those** directly
(`query/query-path.ts:205`). No intermediate node relays a request onward.

Consequence: a browser cannot carry another browser's queries. The DHT is not a
message-forwarding fabric.

### A browser cannot be a relay, and relays do not chain

- `node_modules/@libp2p/circuit-relay-v2/README.md:46`: the relay server *"will not work in
  browsers."*
- Chaining is refused by the protocol implementation, twice, with `PERMISSION_DENIED`:
  `handleReserve` refuses a reservation whose connection arrived over a circuit
  (`server/index.ts:164-167`, `Circuit.exactMatch`), and `handleConnect` refuses to relay
  onward for a connection that arrived over a circuit (`:259-262`, `Circuit.matches`).

So a chain of pages A→В→Г→Д→Б is impossible for two independent reasons, and the second
would hold even if the first were fixed.

### Only the dialed side needs a reservation

`handleConnect` checks the reservation of the **destination**
(`server/index.ts:284-287`, `this.reservationStore.get(dstPeer)`). A node that only
initiates — a pure requestor — occupies no slot on any relay.

This changes the capacity arithmetic. With `O2_MAX_RESERVATIONS` = 64 per relay
(`packages/libp2p/src/constants.ts:64`; the library default is 15), the 64 slots bound the
number of simultaneous **executors** reachable through that relay, not the number of
participants. Reservation TTL is 2 h (`:104`); a relayed connection is capped at 2 minutes
(`:22`) and 128 KiB (`:25`), which is the arithmetic reason a relay is an introduction
channel and cannot be a data path.

### What a DHT record *can* do that a relay does: be a rendezvous

A record is a mailbox. A writes under a key derived from Б; Б reads. **Neither dials the
other.** Applied to introduction, this removes the reservation requirement from the two
endpoints — after the exchange, WebRTC is symmetric and nobody listens.

**It does not remove dialability; it concentrates it.** Both parties must reach whoever
holds that part of the keyspace. If the closest nodes to that key are browser tabs, reaching
them is again a relay problem. Which nodes hold which part of the keyspace is therefore the
open parameter, and it is a parameter rather than a physical constraint.

One implementation cost, stated so the idea is not oversold: `@libp2p/webrtc` wires its
offer/answer exchange to circuit-relay. Introduction over records is **a transport of our
own**, not a configuration.

---

## §8. Provider-record lifetime — three wrong answers, then a measurement

This section originally asserted that provider records never expire. **That was the third
wrong answer in a row about the same number, and it is corrected here by measurement rather
than by a fourth reading.**

### What is true, and is what produced the wrong conclusion

`@libp2p/kad-dht@16.4.0` splits provider-record lifetime across two modules. The one that
looks authoritative is inert:

- `src/providers.ts` — the store — takes an init of exactly `logPrefix` and
  `datastorePrefix`. The class body reads no validity and runs no cleanup.
- `getProviders` (`:57`) returns every entry under the key prefix **with no date
  comparison**. Reads are not filtered.
- The public options type *declares* `providers.provideValidity` and
  `providers.cleanupInterval` (`src/index.ts:432,438`), and `kad-dht.ts:182` spreads them
  into that constructor — where nothing reads them. **Those two options are dead.**

Every sentence above is still correct. The conclusion drawn from them was not.

### What was missed

Expiry lives in `src/reprovider.ts`, and it runs. `kad-dht.ts`'s `start()` passes the
reprovider to `@libp2p/interface`'s `start(...)` helper alongside the routing table and the
network, so its timer is armed with everything else. Every `interval` it walks the same key
prefix and:

- **deletes** any entry older than `validity` whose provider is not this node;
- **exempts its own**, deliberately — the code's own comment is *"if user node is down for
  a while, we still persist provide intent"*;
- **republishes** its own records that are within `threshold` of expiring.

So the honoured knob is **`reprovide.validity`**, and its default is 48 hours.

### The three corrections, kept rather than deleted

| Said | Basis | Verdict |
|---|---|---|
| 48 hours | `PROVIDERS_VALIDITY` | **Right by accident** — it is the default of the honoured knob, but the reasoning pointed at the wrong module |
| 24 hours | the `provideValidity` doc comment | Wrong — that option is dead |
| Never expires | `providers.ts` having no cleanup | Wrong — the cleanup is in `reprovider.ts` |

The pattern is one thing three times: **a reading of a type declaration presented as a
reading of behaviour.** The correction is not a fourth reading.

### What the fabric now does, and how it is known

Both tiers pass an explicit `reprovide` policy, for the same reason `clientMode` is stated
rather than inherited: an unset value makes behaviour follow a default sited against
something else. `providerRecordPolicy` (`packages/libp2p/src/constants.ts`) derives all
three figures from one — validity **1 hour**, sweep a quarter of it, republish at half — so
the staleness bound stays `1.25 × validity` instead of becoming an accident between three
independently chosen numbers. The library's own defaults, 48 h / 1 h / 24 h, are each
reasonable and jointly republish a record at about the instant it would otherwise expire.

**Measured, not argued:** `packages/node/src/provider-expiry.node.test.ts` runs two real
nodes on loopback. The holder announces a CID; the keeper is handed the record over the
wire by `ADD_PROVIDER`; the holder is then **stopped**, so the only possible answer is what
the keeper still stores; and the case waits for the keeper to stop answering. Forcing the
validity back to the library's 48 h turns it red on the sweep assertion — watched, then
restored by the inverse of the plant with `cmp` exit 0.

Two refusals were found by that case failing, and both are recorded because neither is
visible from the type:

- **`ADD_PROVIDER` ignores a provider that sends no addresses**
  (`rpc/handlers/add-provider.ts` — *"no valid addresses for provider … Ignore"*).
- **The key on the wire is `multihash.bytes`, decoded by `CID.decode`**, which works only
  because a sha-256 multihash is byte-identical to a CIDv0. An identity multihash begins
  `0x00`, is read as a version, and the whole message is refused as `Invalid CID`. The
  first draft of the case announced into a keeper that stored nothing and reported only
  *"the keeper was never handed the record"*.

### Why the ordering against persistence still holds, on a weaker argument

The original claim — persistence would turn an unbounded leak durable — is withdrawn with
the finding behind it. What remains is smaller and still worth the ordering: with the
library defaults a restarting node would carry 48 hours of other nodes' provider records
forward, and with an explicit 1 hour it carries one. Setting the policy first costs
nothing and makes the persisted footprint a number somebody chose.

## §9. "Provider" means four different things, and only one of them is built

The word is doing too much work. Separated:

| Sense | The claim | Mechanism today |
|---|---|---|
| **Holds bytes and will serve them** | "I have this block, come and get it" | **Built** — `dht.provide` via `DhtProviderAnnouncer` |
| **Holds bytes and will not serve them, but will compute over them** | sovereign, owner-pinned data | **None, and none is needed.** The scheduler never relocates a sovereign shard off its owner's node — it refuses instead. The owner *is* the requestor, so there is nobody to look it up |
| **Holds nothing but can execute** | free capacity, supported features | **Partial** — capabilities travel inside the signed record; instantaneous free capacity does not, and should not: it ages faster than a record propagates |
| **Provides the relay service** | "peers can be introduced through me" | **None** — the relay set is a static configuration field |

### The fourth row is buildable today out of two halves that already exist

**A DHT cannot be queried by attribute.** Kademlia looks up a key; it does not scan values.
So "give me every node whose `discoverability` is `seed`" is not a question this structure
answers, and no amount of wiring makes it one.

The mechanism that *does* fit is the one just built for blocks: **a provider announcement
under a well-known key** meaning "I provide the relay service". And the half that makes it
trustworthy is already signed — §1's `discoverability: 'seed'` and `relayIds`, inside a
certificate the issuer signed and any node verifies offline. A node found under the
well-known key therefore **proves** its claim rather than asserting it.

**And the transport for that proof is already running.** The published record is
`NodeRecords = { certificate, capabilities }` (`packages/core/src/discovery.ts:414`), and the
certificate is the whole certificate. So the fabric's keyspace already carries relay
information today; what is missing is an announcement under a well-known key and a reader
that asks.

That reader is also the missing input to bounded auto-reservation: a node cannot re-home onto
a relay it has no way to learn about, which is why the two are one piece of work and not two.

---

## §10. The work register

Written so that "implement everything" has a countable referent. Three buckets. Dependency
order is stated where it is forced, and forced order is not a preference.

### (a) Doable now

| ID | Work | Depends on | Why here |
|---|---|---|---|
| W1 | **Provider-record lifetime stated rather than inherited** — `providerRecordPolicy`, 1 h, on both tiers (§8) | — | Owner-ruled. **DONE**, measured by `provider-expiry.node.test.ts`. It turned out to be a setting, not a mechanism to build — the third answer about that number and the first one measured |
| W2 | **Persistent datastore** — `datastore-level` on the server tier; keychain persistence so the address key survives restart (§2) | W1 | Owner-ruled. Turns the address from per-restart into stable. W1 first so the persisted footprint is a number somebody chose rather than the library's 48 h |
| W3 | **`revoked` member of `CertificateFailure`** (§3 item 9) | — | It is the vocabulary every status mechanism needs; cheap, and blocking if deferred |
| W4 | **Certificate and verdict caching** on the persisted store (§2) | W2 | Safe by construction — offline verification |
| W5 | **Relay-as-provider**: announce under a well-known key, plus the reader (§9) | — | Both halves exist; this is the join |
| W6 | **Bounded auto-reservation**, k = 2..3, on relays learned via W5 (§7) | W5 | k is bounded by 64 slots per relay, not by taste |
| W7 | **`DirectoryPort` publish/fetch over the DHT**; `publishRevocation`/`revocationStatus` left unwired with §5 as the recorded reason | W3 | Unblocks `cert-lifecycle.ts` without importing the revocation-list design |
| W8 | **Determine** whether two disagreeing anchors refuse or pick (§4, recommendation 5 second half) | — | A measurement, not an implementation; it decides whether there is work at all |

### (b) Blocked on a measurement that is itself in scope

| ID | Work | Blocked by |
|---|---|---|
| W9 | **Certificate lifetime 30 d → 1 h** (§3 item 1) | The issuance-cost measurement §2.10 demands of itself: *"Unmeasured, and it must be measured before adoption"* — via `enrollment-cost.node.test.ts` and `enrollment-dos.node.test.ts`. The question is not the mean but whether the issuer's admission path stays inside its bounds at the resulting arrival rate |
| W10 | **The measurement itself** | — |

The trade W9 buys must be stated when it lands and not after: at 30 days a node survives an
issuer outage for a month; at 1 hour, for an hour. That is a real loss of partition
tolerance and is the price of the revocation guarantee.

### (c) Needs an owner decision on *which*, not on *whether*

| ID | Decision |
|---|---|
| W11 | **The freshness mechanism** — §3 items 3, 5, 6, 7, 8 are one design, and it introduces `CM-Status`: a new key, and the only **online** one, i.e. the key most likely to be compromised. §2.10 prices it by blast radius. The alternative is to let W9's shortened lifetime carry freshness alone and build no status object. These are alternatives, not stages |
| W12 | **Anchor change as a consent event** (§4 item 4) — the cost is a one-time re-consent for every existing visitor and a support burden on every legitimate publisher rotation. §1.8 argues that visibility is the point and that invisibility is why HPKP died. The counter-argument is the same fact |
| W13 | **Pre-rotation** (`nextKeyCommitment`, §4 item 6) — cheap in code, but it commits the anchor format |

---

## Appendix — where each reading came from

Repository files were read at the line cited. Library behaviour was read from the installed
package under `node_modules/`, not from published documentation — which, per §8, disagrees
with the implementation on the one point where it mattered most.

| Claim | Source |
|---|---|
| Certificate lifetime is 30 days | `packages/core/src/enrollment.ts:929` |
| `CertificateFailure` has no `revoked` | `packages/core/src/enrollment.ts:1194` |
| `ConsentGap` has three kinds | `packages/browser/src/consent.ts:63` |
| Verdicts are re-asked after certificate expiry | `packages/libp2p/src/peer-verifier.ts:591` |
| `discoverability`, `relayIds` are signed fields | `packages/core/src/enrollment.ts:176-180`, `:204` |
| Published record carries the whole certificate | `packages/core/src/discovery.ts:414` |
| `cert-lifecycle.ts` has no production importer | `packages/core/src/index.ts:513` |
| `DirectoryPort` shape; `Action` includes `relay` | `packages/core/src/cert-lifecycle.ts:333`, `:172` |
| Keychain persists through `components.datastore` | `node_modules/@libp2p/keychain/src/keychain.ts:174,241` |
| Kademlia dials each peer itself | `node_modules/@libp2p/kad-dht/src/network.ts:180`, `query/query-path.ts:205` |
| The provider **store** never expires anything, and its two options are dead | `node_modules/@libp2p/kad-dht/src/providers.ts` (whole file), `src/index.ts:432,438`, `kad-dht.ts:182` |
| Expiry is the **reprovider's**, it is started, and it exempts self | `node_modules/@libp2p/kad-dht/src/reprovider.ts` `processRecords`, started via `kad-dht.ts`'s `start(...)` |
| `PROVIDERS_VALIDITY` is the reprovider default and also expires **value** records | `reprovider.ts:82`, `rpc/handlers/get-value.ts:132` |
| A foreign provider record is actually swept once the fabric's validity passes | `packages/node/src/provider-expiry.node.test.ts` — two nodes on loopback, plant watched red |
| `ADD_PROVIDER` ignores a provider with no addresses, and decodes the key as a CID | `node_modules/@libp2p/kad-dht/src/rpc/handlers/add-provider.ts` |
| A browser cannot run the relay server | `node_modules/@libp2p/circuit-relay-v2/README.md:46` |
| Relays do not chain | `node_modules/@libp2p/circuit-relay-v2/src/server/index.ts:164-167`, `:259-262` |
| Only the destination needs a reservation | same file, `:284-287` |
| Reservation and relay limits | `packages/libp2p/src/constants.ts:22,25,64,104` |
