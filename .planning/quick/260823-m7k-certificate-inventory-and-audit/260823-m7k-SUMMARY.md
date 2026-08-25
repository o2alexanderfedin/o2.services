---
id: 260823-m7k
slug: certificate-inventory-and-audit
date: 2026-08-23
status: complete
---

# The certificate inventory, and the first audit against Response 01

## The headline

**Ten substantive recommendations, one implemented.** Response 01 carries nineteen numbered
items across §1.8 and §2.10; nine are RFC text, ten are code. Measured against the tree on
2026-08-23, exactly one is present: §2.10 item 11, re-asking a settled acceptance once its
certificate has expired (`packages/libp2p/src/peer-verifier.ts:591`).

That is not the least of them. The recommendation says of itself that without it *"every
other recommendation here reaches the admission path and not the selection path"* — so the
precondition for the rest is in place and the rest is not. Stated as one sentence rather
than nine rows: **there is today no way to withdraw trust from a node except to wait out its
certificate, and that wait is thirty days** (`enrollment.ts:929`).

## Seven artefacts, not two

The inventory people carry in their heads is `trustAnchors` and `trustedIssuers`. The actual
set is seven, plus an eighth of different nature (infrastructure TLS). Two additions matter
beyond bookkeeping:

- **The X.509 form is wired on the trust path, fail-closed**, and landed *after* Response 01
  — so that document's own inventory does not know about it.
- **`NodeCertificate` already carries signed `discoverability: 'seed' | 'via-relay'` and
  `relayIds`** (`enrollment.ts:176-180`, `:204`). The fabric therefore already holds an
  offline-verifiable statement of which nodes are relays, and already transports it —
  the published record is `{certificate, capabilities}` and the certificate is the whole
  certificate. Nothing reads it.

## The asymmetry that is a live fail-open

`trustAnchors` **cannot be empty** — the opt-out is a named literal, so nobody disables
artefact provenance by omission. `trustedIssuers` **can** be empty, and empty means the
verifier does nothing. The difference is between an opt-out somebody had to type and one
somebody could reach by forgetting a field.

## A correction made three times, and settled by a test rather than a fourth reading

It was said in the course of this work that a retracted provider record survives **48 hours**,
then **24 hours**, then that provider records **never expire**. All three came from reading
type declarations and presenting the result as a reading of behaviour.

**What is true:** `@libp2p/kad-dht@16.4.0`'s provider *store* really does expire nothing —
`src/providers.ts` takes an init of `logPrefix` and `datastorePrefix` only, `getProviders`
filters nothing by date, and `providers.provideValidity` / `providers.cleanupInterval` are
declared publicly (`src/index.ts:432,438`), spread into that constructor by `kad-dht.ts:182`,
and read by nothing. Those two options are dead.

**What was missed:** expiry lives in `src/reprovider.ts`, whose timer is armed by
`kad-dht.ts`'s `start(...)` alongside the routing table. Every `interval` it deletes foreign
entries older than `validity`, exempts its own on purpose — *"if user node is down for a
while, we still persist provide intent"* — and republishes its own within `threshold`. The
honoured knob is `reprovide.validity`, default 48 h. So the very first answer was right by
accident and its reasoning was not.

**What was then done, and it is a setting rather than a mechanism.** Both tiers now pass an
explicit policy for the same reason `clientMode` is stated: an unset value makes behaviour
follow a default sited against a long-running IPFS daemon. `providerRecordPolicy` derives
all three figures from one — validity 1 h, sweep a quarter, republish at half — so the
staleness bound stays `1.25 x validity` rather than becoming an accident between three
numbers. Reads are not date-filtered, which is why the bound includes the interval.

**Measured**: `packages/node/src/provider-expiry.node.test.ts`, two real nodes on loopback.
The holder announces, the keeper is handed the record over the wire, the holder is stopped
so no network answer is possible, and the keeper stops answering. Forcing the validity back
to 48 h turns it red on the sweep assertion — watched, restored by the inverse of the plant,
`cmp` exit 0. Two undocumented refusals surfaced while getting there: `ADD_PROVIDER` ignores
a provider that sends no addresses, and it decodes the wire key with `CID.decode`, which
works only because a sha-256 multihash is byte-identical to a CIDv0 — an identity multihash
is refused as `Invalid CID`, silently, with the case reporting only that the record never
arrived.

## The contradiction, recorded rather than tidied

`enrollment.ts` and `result-attestation.ts` say revocation is not a list and must not be one.
`cert-lifecycle.ts` declares revocation reasons, a revocation status, and a directory port
with `publishRevocation`/`revocationStatus`. These are two designs, not two halves.

Response 01 §2.10 item 12 settles it in favour of the code: revocation **is** non-renewal,
and the stapled status object is an addition to expiry rather than a list anybody queries.
Recorded resolution: adopt `DirectoryPort.publish`/`fetch`, leave the two revocation methods
unwired, and let §5 of the new document be the reason a future reader finds instead of an
apparent oversight.

## What was measured and what was not

Two audit rows had been left unmeasured in conversation and were measured before being
written down: the three named fail-postures (`refuses-without-fresh-status` /
`proceeds-on-unexpired-credential` / `refuses-always`) occur **nowhere** under
`packages/*/src/`; and `possessionChallenge` (`enrollment.ts:277`) encodes
`{purpose, nodeKey, userKey}` and, in the module's own words, *"nothing else — no nonce"*.

**Exactly one row is recorded as not-measured**, and it is named as such rather than guessed:
the second half of §1.8 recommendation 5 — whether two disagreeing anchors refuse or pick.
It is carried in the work register as W8, a measurement rather than an implementation.

## What changed

- `docs/architecture/RFC-0003-RESPONSE-04-certificate-inventory-and-audit.md` — new. Ten
  sections plus an appendix mapping every claim to the file and line it was read at.
- `docs/architecture/RFC-0003-RESPONSE-01-anchoring-and-freshness.md` — a dated SUPERSEDED
  note on §0's last clause, preserving the wrong reading. The other six items in that
  paragraph are still correct, and the reason this one aged is worth keeping: the commit
  that wrote it and the commit that installed the package are 69 seconds apart.

## Verification

`requirements-ledger` and `reachability-guard`, 59 tests, EXIT=0. No spec reads either
document — checked, so no guard could have caught a false claim in them; the appendix exists
because of that, as the only mechanism by which these claims can be re-checked.

## Not done, and deliberate

The work register (§10 of the new document) is the deliverable, not the work. Thirteen items
in three buckets: doable now, blocked on a measurement that is itself in scope, and needing
an owner decision between two designs rather than a yes. Nothing from it was started here —
this task was docs-only by construction, and the register exists so that "implement
everything" has something to be counted against.
