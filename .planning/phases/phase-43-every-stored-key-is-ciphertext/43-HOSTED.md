# Phase 43, criterion 4 — the hosted tier's seed is sealed under a platform secret

**Date:** 2026-09-06 · **Requirement:** AUTH-07 · **Branch:** `feature/43-every-stored-key-is-ciphertext`
**Commits:** `18f6020` (the change), `cdae273` (a budget the change made necessary)

The criterion, verbatim:

> The hosted tier's seed is sealed under a secret held in the platform's secret store, and the
> object's own storage no longer contains the raw seed. **The claim is a move between
> compromise domains and not secrecy from the account holder** — a Durable Object cannot keep
> a secret from its own operator, and any surface that says otherwise fails this criterion.

---

## 1. What I verified myself, and where the brief I was handed was right

I was told to re-read rather than assume. Everything load-bearing in the brief held:

- `hosted-identity.ts` did write a raw 32-byte seed to `HOSTED_IDENTITY_KEY = new Key('/identity/seed')`, and its docblock's two claims — that `/identity/` avoids both `REFUSED_NAMESPACE` values, and that `has` precedes `get` so a storage fault cannot be read as "not there yet" — are both true and both still true.
- `packages/core/src/sealed-secret.ts` is shipped, complete, and needed no change.
- `packages/libp2p/src/identity-protection.ts` carries `PASSPHRASE_MIN_LENGTH = 20` and `assertUsablePassphrase`, and this tier now speaks it.
- `identity-store.ts:209-224`'s migration ordering is what the brief said it is, and its own comment states why.
- `43-KEYCHAIN.md` §6 said its third case would redden when criterion 4 landed. It did. It is inverted below rather than deleted, as that file asked.

**One correction, and it is about scale rather than fact.** The brief scoped my files as
`packages/cloudflare/**` plus a new spec. That was right about where the *change* lives and
understated the blast radius by sixteen files: since a hosted object now refuses to open its
identity without the binding, `GET /self` answers `500`, and **every e2e spec in this
repository that spawns `wrangler dev` polls `/self` for readiness.** Six of those are in
`packages/node/`. §7 names them as a scope extension.

---

## 2. What was built

| file | change |
|---|---|
| `packages/cloudflare/src/hosted-identity.ts` | the seal, the migration, the fail-closed refusal, the shared vocabulary |
| `packages/cloudflare/src/hosted-object.ts` | `HostedNode(storage, identitySecret)`; the memo is now the **promise** |
| `packages/cloudflare/src/hosted-libp2p.ts` | `identitySecret` threaded; one derivation per assembly instead of two |
| `packages/cloudflare/src/worker.ts` | `HostedEnv.O2_IDENTITY_SECRET`; `GET /self` answers `500` naming the refusal |
| `packages/cloudflare/package.json` | `@o2/core` declared — it was reachable transitively and undeclared |
| `packages/cloudflare/src/hosted-seed-sealed.node.test.ts` | **new** — 13 cases, and where the three plants were watched red |
| `packages/cloudflare/src/hosted-seed-at-rest.e2e.test.ts` | **new** — 9 cases against a real `workerd` and the SQLite it writes |
| `hosted-identity.test.ts`, `hosted-keychain-dek.node.test.ts` | rewritten to the sealed world (§6) |
| 16 e2e specs + `worker.test.ts` + `hosted-libp2p.node.test.ts` | the binding (§7) |

Storage layout: the plaintext key stays exported and is now only ever **read once and
deleted**; the envelope lives at a new key, `SEALED_HOSTED_IDENTITY_KEY = '/identity/sealed-seed'`.
A distinct name is what makes *"is the plaintext gone?"* the question `store.has(…)` answers,
rather than an inference about a value's shape — `SEALED_IDENTITY_FILE` made the same move on
the node tier for the same reason.

---

## 3. The migration ordering, and why it is that order

**Seal → put → re-read from the store → open → compare bytes → and only then delete.**

Copied deliberately from `packages/node/src/identity-store.ts:209-224`, whose comment states
the reason and whose reason survives the move to a Durable Object unchanged:

> Unlinking before the envelope is proven readable turns a full disk — or any defect in the
> sealing path — into a destroyed identity. The verification read is not belt-and-braces; it
> is the thing that makes the unlink safe.

Three details are mine rather than copied:

1. **The `.tmp-`-then-`rename` half does NOT carry over.** That file needs it because a POSIX
   write is not atomic. A single-key Durable Object `put` is atomic by the platform's own
   guarantee, and `hosted-identity.ts` already made that argument for itself before this phase.
   Imitating the dance would be ceremony that looks like durability.
2. **The re-read asks the store, and `has` precedes `get`.** `DoDatastore.get` signals a miss
   by throwing, so without the `has` a dropped write would escape this path as a raw
   `NotFoundError` rather than a named refusal.
3. **The sealed key is checked before the plaintext one.** A stale plaintext left by a
   migration interrupted between the `put` and the `delete` must not shadow the envelope that
   replaced it; checking the envelope first makes that interruption a no-op on the next boot.

**The order is asserted, not described.** `keeps the plaintext when the envelope it just wrote
cannot be read back` runs the migration through a store whose sealing `put` silently does
nothing, and requires that the refusal leave the plaintext where it was. Plant 3 (§5) is that
case's proof.

### The race, named rather than engineered around

Argon2id is not a storage operation, so awaiting it opens the Durable Object's input gate and a
second request can be delivered mid-derivation. Three things about that:

- On the **migration** path it is benign: both racers read the same plaintext, so both
  envelopes open to the same seed and the PeerId is identical whichever write lands last.
- On the **mint** path it would not be, so the mint arm seals first and then does
  `has`-then-`put` with no non-storage await between them.
- `HostedNode.identity()` now memoises the **promise**, not the resolved value. The previous
  shape assigned after awaiting, so two concurrent callers both ran the load. That was harmless
  while the load was storage reads, which the input gate serialises. It is not harmless with a
  650 ms derivation in the middle.

---

## 4. Fail closed — the property, and why it is the whole design

An absent secret **refuses by name and mints nothing**. This object's PeerId is published in
bootstrap lists and multiaddrs, so a first boot after a deploy with no secret, a typo in the
binding, or a rename must not produce a fresh seed. Phase 42's criterion 4 states the same
property one tier over.

Three decisions inside that:

1. **A missing secret is NOT mapped to `IdentityProtection`'s `writes-no-new-secret` arm.**
   That value means *an operator promised this node would write no new secret*; laundering a
   misconfiguration through it would make the refusal contradict the value it came from, and
   this tier has no operator present to make that promise. It gets its own name,
   `HostedIdentitySecretMissingError`. The arm is additionally unreachable *at the type level*:
   `hostedIdentityProtection` returns `Extract<IdentityProtection, {kind:'passphrase'}>`.
2. **The vocabulary is still `identity-protection.ts`'s** — the same union member, the same
   twenty-character floor, the same `WeakPassphraseError`. A third tier inventing a fourth
   vocabulary is what that file exists to prevent.
3. **`GET /self` answers `500` with the refusal's name.** The precedent is `turn-not-configured`
   two methods away: *a deployment that is not configured should say so, not look broken.* Only
   the four declared refusals are caught; anything else rethrows, because an operator told to
   check a binding they already set will check it twice before looking anywhere else.

An empty string counts as absent — `wrangler`'s own `--var NAME:` produces one, and an operator
who typed the binding with no value configured nothing.

---

## 5. The plants — three, all watched red, all restored `cmp`-clean

Every plant was inside `packages/cloudflare/src/hosted-identity.ts`, which is my file. A
snapshot was taken **immediately before** each plant and `cmp` verified byte-identity after the
surgical inverse; all three returned `0`. They were run one at a time, never in parallel.

| # | plant | observed failure, verbatim |
|---|---|---|
| 1 | the mint arm writes the raw seed again: `put(SEALED_…, envelope)` → `put(HOSTED_IDENTITY_KEY, minted)` | `AssertionError: expected [ '/identity/seed' ] to deeply equal []` on *holds no row carrying the raw seed after a boot…*. Four cases red. |
| 2 | the refusal becomes a fallback: `if (…) throw new HostedIdentitySecretMissingError()` → a compiled-in default secret | `AssertionError: promise resolved "Uint8Array[ 66, 81, 163, 104, …]" instead of rejecting` on *refuses an empty store by name and leaves it empty*; and `expected 200 to be 500` on the `/self` case — i.e. it minted and answered as a new node. Six cases red. |
| 3 | the delete moves above the verification | `NotFoundError: Not Found: /identity/seed` on *keeps the plaintext when the envelope it just wrote cannot be read back — the write order, measured*. Reddened **alone**, which is what makes it a proof about the ordering and not about anything else. |

**No plant stayed green.** Plants 1 and 2 are the two the brief made mandatory; plant 3 is the
one the migration ordering needed, and it is the only one that isolates a single case.

The instrument is ordered **refusing arm first, positive control last** wherever both are in
one case — `43-KEYCHAIN.md` §5.1 measured two days ago that the other order makes a plant
redden on the control and short-circuit, leaving the arm that names the defect unevaluated.

---

## 6. What was measured, and on what

### 6.1 In process — `hosted-seed-sealed.node.test.ts`, 13 cases

The absence carries its positive control **in the same case**: after asserting that no row in a
booted object's store carries the seed, the same scanner is run over a second store written the
way the pre-change code wrote it (`put(HOSTED_IDENTITY_KEY, seed)`, one line, no envelope) and
reports `['/identity/seed']`. Without it the emptiness is satisfied by a scanner that can see
nothing and by a store nobody wrote to.

The scanner compares **byte against byte** and never builds a string from a value.
`Buffer.from(String(u8))` renders a `Uint8Array` as `255,15,66,…` and blinded an instrument in
this repository once already.

### 6.2 Against a real `workerd` — `hosted-seed-at-rest.e2e.test.ts`, 9 cases

`wrangler dev --persist-to <mkdtemp>`, `CLOUDFLARE_API_TOKEN` blanked, ports 8822/8823. Nothing
deploys, nothing contacts the live account, no Cloudflare resource is created. The store is the
SQLite file miniflare actually writes, read through `node:sqlite`.

The arc, in one `beforeAll`: boot with the secret → read the store → restart → **plant a known
raw seed into the real SQLite** → read it back (the positive control) → boot again (the
migration) → read it again; then a separate boot on a separate directory with **no** secret.

Measured, printed by the spec itself so the figures reproduce:

```
[criterion 4] cold GET /self 657.6 ms, warm 8.0 ms, ratio 81.8x — the difference is the
Argon2id derivation on workerd. Planted seed found in ["<db>"] before the migration and
["<db>","<db>-wal"] after it (raw file bytes; rows: []).
```

- **Argon2id runs on workerd.** Nothing about Node proves anything about the Cloudflare
  runtime, and a 19 MiB pure-JS allocation is the kind of thing a different runtime refuses.
  Cold-versus-warm is a ratio taken within one run — the same request to the same live object
  over the same socket, differing only in whether it derives — rather than an absolute that
  would encode this host.
- **The planted seed is found before the migration and absent from every row after it.**
- **The raw file still carries it after the delete, and that is reported and not asserted.**
  SQLite does not zero a deleted row: its bytes stay in a free page and in the write-ahead log
  until a checkpoint and a vacuum reuse the space. That is a property of miniflare's local
  emulation, not of the deployed platform, so an assertion there would be measuring SQLite. It
  is recorded here rather than vacuumed away silently.
- **The unconfigured boot leaves the object's database with no `_cf_KV` table at all.** That
  was not designed; the first run failed with `Error: no such table: _cf_KV` and it is the
  strongest available form of *nothing was created on the way to refusing*. The reader now
  treats it as a reading rather than an error.

**One thing in my own first draft was wrong and is worth recording**: the V8 framing template
was read off one real row — a 32-byte seed, a one-byte length — and applied to a ~380-byte
envelope, whose length is a multi-byte varint. The run failed inside `JSON.parse` on a stray
leading byte. A shape read off one example holds for that example; the reader now parses the
varint. A wrong template could never have produced a false green — workerd either fails to
deserialise or reads different bytes, and either way the PeerId does not match.

### 6.3 The strongest reading, and it was not planned

`packages/cloudflare/.wrangler/state` — the store two e2e specs share, which has been carrying
a **plaintext** seed written by a real workerd for days — was migrated by the e2e lane itself.
Before the run and after it:

```
before:  /identity/seed (41 bytes)          implied peerId 12D3KooWCGgex53cQzhRJZc5xmuS6s64qxaKu8eprFXEzJ1VvbM8
after:   /identity/sealed-seed (266 bytes)  envelope opens to a 32-byte seed implying the SAME peerId
         rows carrying the raw seed: []     out of 673 rows scanned
```

That is the deployed object's situation rehearsed on a real store nobody set up for the
purpose: a long-lived plaintext seed, migrated in place, same name afterwards, and the bytes
gone from all 673 rows.

### 6.4 Suites

- `npx vitest run --project node` — **247 files, 3518 passed, 2 skipped, 0 failed**, exit `0`.
  The banner reports the host oversubscribed by the run itself; nothing failed, so pass/fail
  stands and **no duration from it is quoted**.
- `npx vitest run --project e2e packages/cloudflare/src/` — **11 files, 51 passed**, exit `0`.
- `npx vitest run --project e2e packages/node/src/funnel-attribution.e2e.test.ts packages/node/src/kill-switch-propagation.e2e.test.ts`
  — **2 files, 7 passed**, exit `0`, host quiet (load/core 2.35 → 1.80). This discharges the
  binding threading in `packages/node/`; the other four node e2e specs took the identical
  two-element edit.
- `npx tsc --noEmit -p tsconfig.json` — clean.

---

## 7. Scope extensions, named rather than left for discovery

**Sixteen e2e specs now pass `--var O2_IDENTITY_SECRET:…`.** Ten in `packages/cloudflare/src/`,
six in `packages/node/src/`. None of them is about identity; every one of them polls `/self` to
know the worker is up, and `/self` now refuses without the binding.

**The value is a per-spec constant and not a shared module**, and that was a second decision
after a first one failed a guard. A shared
`packages/cloudflare/src/hosted-dev-secret.fixture.ts` was written first; it is a module with
no production importer, and `reachability-guard.node.test.ts`'s orphan-module ceiling refused
it at *expected 34 to be less than or equal to 33*. Raising that ceiling by one, named, with a
mechanism and a closing condition, is the precedented move and is what the four entries above
it did — **but that file was carrying another agent's staged, uncommitted change on the same
branch, and committing the path would have swept their work into my commit.** So the module was
dropped instead. The value is per-spec test data in the style of this tree's `TEST_KEY` and
`TURN_SECRET`: each spec passes its own `--persist-to`, so its store is its own and the value
only has to be self-consistent across its own restarts.

**The one exception is documented in both directions.** `hosted-record-store.e2e.test.ts` and
`inbound-listener.e2e.test.ts` spawn `wrangler dev` with **no** `--persist-to` and therefore
share `packages/cloudflare/.wrangler/state`. Two different secrets there means the second to
run meets an envelope the first sealed and refuses it. Each file's constant names the other and
says why.

**A local `.wrangler/state` sealed under some other value is repaired by deleting the
directory.** There is nothing in it worth keeping.

**`@o2/core` is now a declared dependency of `@o2/cloudflare`.** It resolved transitively
before (through `@o2/libp2p`) and was undeclared; the envelope is the first direct use.
`package-lock.json` carries the workspace entry too — `npm install --package-lock-only`
produced a **one-line** diff and nothing else moved. Nothing local could have caught its
absence: `tsc` and `vitest` both resolve through the root symlink that already existed, so only
a clean `npm ci` would have failed.

**Two files outside the identity change were rewritten rather than worked around**, both mine:

1. `hosted-identity.test.ts` — *"reads the seed back from the store"* asserted
   `get(HOSTED_IDENTITY_KEY)` equalled the minted seed, which is now precisely the thing that
   must not be true. The claim it carried is unchanged — the identity is recoverable from the
   store — and it now opens the envelope to say so. Its wrong-length case additionally asserts
   that the refusal did **not** walk on into the mint arm behind it, which the rejection alone
   cannot see.
2. `hosted-keychain-dek.node.test.ts` — criterion 3's spec asserted a **weakness** on purpose:
   that `/identity/seed` still equalled the live seed, so that the hosted keychain's protection
   being an inheritance from the seed's was a measured fact rather than a comment that could
   rot. It said that when criterion 4 landed the case *"must be updated rather than deleted"*.
   It is inverted: the plaintext row is absent, and the envelope opening to the running seed is
   the positive control that makes the absence mean something. Its docblock's "the gain is nil"
   paragraph is replaced rather than left standing.

---

## 8. A defect this change introduced, found by measurement

Every hosted node construction now costs one Argon2id derivation — ~650 ms uncontended on this
host, and a case that builds two nodes pays it twice. That is comfortably inside vitest's
five-second default on a quiet machine and **not inside it on a busy one**: a full
`--project node` sweep runs eight workers, several deriving at once, and two of these files
lost three cases to `Error: Test timed out in 5000ms.` on a run whose banner reported the host
oversubscribed at load 11.89 across 8 cores.

**Diagnosed rather than assumed.** *"Passes in isolation"* is a claim to verify, not a
diagnosis, so the failure mode was reproduced deliberately: `--testTimeout=800` against
`hosted-seed-sealed.node.test.ts` reddens six cases with `Error: Test timed out in 800ms.` and
**no assertion failures at all**.

Fixed by `vi.setConfig({ testTimeout: 60_000 })` in the five affected files, with the reasoning
in each. **The budget is raised rather than the cost lowered**, because the cost is the feature:
a memory-hard KDF is what prices a guess against an attacker holding this store. It is a budget
and never an assertion — nothing reads it and no case passes or fails on how long it took.
Commit `cdae273`.

---

## 9. The honest limit

**A Durable Object cannot keep a secret from its own operator.** The account holder can read
this seed. Nothing in the code, the errors, the case names or this document claims otherwise,
and a surface that did would fail the criterion rather than satisfy it.

What this buys, in the proposal's own words
(`.planning/consults/2026-09-06-every-stored-key-is-ciphertext.md` §3.C), quoted verbatim in
`hosted-identity.ts`'s header:

> a Durable Object cannot keep a secret from its own operator. What this buys is not secrecy
> from the account holder — it is that the secret no longer sits *in the object's storage*,
> where a storage-level compromise, a mis-scoped binding or a stray dump would expose it. The
> adversary moves from "whoever can read this object's storage" to "whoever holds the
> Cloudflare account". Those are different compromise domains and moving between them is the
> whole gain.

Two further limits, stated so nobody widens them:

- **At-use is untouched.** Design §3.9's own wording applies verbatim — *"Derivation moves the
  risk from at-rest to at-use — the enclave closes that gap."* The seed is in the object's
  memory while it runs, and nothing here changes that.
- **The local reading is miniflare's, not Cloudflare's.** Every measurement in §6.2 is against
  `workerd` under `wrangler dev`. It is the same runtime; the storage layer beneath it is a
  local SQLite emulation, which is exactly why the free-page residue is reported rather than
  asserted, and why the deployed half is `.planning/OWNER-ACTIONS.md` row 8 rather than a test.

---

## 10. What is owed to the owner

`.planning/OWNER-ACTIONS.md` row **8**, extending the seven that were there. It gives the four
commands in the order they must be run, what to read back at each, and three named stop
conditions — `HostedIdentitySecretMissingError` (nothing lost, set the secret),
`SealedHostedIdentityUnlockError` (**do not redeploy, do not rotate**, put the original value
back), and a `peerId` that differs from the one captured before the deploy (stop and report).

It states plainly that the secret must be set **before** the next deploy of this Worker, and
what happens if it is not — **and that answer has two arms, which a first draft of the row got
wrong by giving only one.** I wrote "the node goes dark" for both paths and then read
`scripts/deploy-hosted.sh`:

- **Through the script, the deploy rolls itself back.** Its read-back is
  `curl -sS --fail … /self`; `--fail` turns a `500` into no body, the injected version never
  appears in the answer, and after six attempts over ~30 s it calls
  `roll_back "THE DEPLOYED NODE DOES NOT REPORT THE VERSION THAT WAS DEPLOYED"` and runs
  `wrangler rollback`. The old build returns, the plaintext seed is untouched, and the node
  keeps answering on its published PeerId. A failed deploy, loudly, rather than a lost node.
- **Through a bare `wrangler deploy`, the node goes dark** until the binding is set. Its stored
  identity is intact and setting the secret brings it back unchanged.

Worth recording beside that: **the script already guards the outcome this whole phase exists to
prevent.** It captures the PeerId before the deploy and compares it after
(`BEFORE_ID` / `AFTER_ID`), rolling back on a mismatch — so on the scripted path, stop
condition 3 is automated. That guard predates this phase and was written for the same reason.

And the row states the permanent consequence, which is the one an owner must read before
deploying rather than after: **once a deploy has migrated the object, losing the secret loses
the identity.** There is no recovery path by construction — that is what "the seed is not in
the object's storage" means.
