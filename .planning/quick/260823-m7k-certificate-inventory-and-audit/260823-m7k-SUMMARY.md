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

## A correction made twice before it was right

It was said in the course of this work that a retracted provider record survives **48 hours**,
then, on a second reading, **24 hours**. Both came from documentation for options the
implementation ignores.

**Provider records in `@libp2p/kad-dht@16.4.0` never expire.** `src/providers.ts` declares an
init of exactly `logPrefix` and `datastorePrefix`; the class reads no validity and no cleanup;
`getProviders` returns everything under the key prefix with no date comparison; there is no
cleanup timer. The public options type *declares* `cleanupInterval` and `provideValidity`
(`src/index.ts:432,438`) and `kad-dht.ts:182` spreads them into a constructor that ignores
them. `PROVIDERS_VALIDITY` (48 h) is read only by `reprovider.ts:82` — the announcer's own
republish threshold — and by `rpc/handlers/get-value.ts:132`, which expires **value** records,
i.e. this fabric's registration records.

**The operative consequence:** this is harmless today only because nothing persists the
datastore, so a restart clears it. Persistence would make it unbounded. **Expiry must land
before, or with, persistence** — which is why the work register orders them that way rather
than by preference.

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
