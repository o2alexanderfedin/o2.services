# 43-ALLOWLIST — one guard, every persistent store, declare it or be flagged

**Criterion 5, verbatim from `.planning/ROADMAP.md`:** *"One guard walks every persistent store
on every tier against an allow-list of what that store may hold, so a store or a value nobody
declared is a finding by default. It carries a positive control in the same run — a value it is
shown finding — and renders no byte through `String`, both of which this repository has paid
for."*

**Deliverable:** `packages/node/src/stored-value-guard.node.test.ts`, one file, 29 cases.
**Test-only.** No production source changed. The one non-spec edit is `vitest.config.ts`'s
derived file counts — see §7, which is a finding rather than a fix.

---

## 1. The design, and why this shape

### A source census, not a runtime walk

The criterion says *every persistent store on every tier*, and there is no run in which all
three tiers are present: the node tier writes to a filesystem, the browser tier to IndexedDB,
the hosted tier to Durable Object storage, and those are three runtimes that never share a
process. A runtime dump can only ever be one tier's — which is what Phase 42's criterion 1
already is, for one store on one tier.

So the unit is **the write site in source**. Every place production code puts a value into a
store is declared, with what it writes and **what class that value is**. An undeclared write
site is a finding; so is a declared one that has gone away. The precedents are
`demo-regions.e2e.test.ts` (declare it or be flagged) and
`reachability-dispositions.ts` + `reachability-guard.node.test.ts` (a register of entries each
carrying a named cause, plus a ceiling, plus a derived case that reddens when the register
stops describing the tree).

### The register lives in the spec, not in a new `src/` module

`reachability-dispositions.ts` is a `src/` module and its sibling register `OPEN_FINDINGS`
is not — it lives inside `reachability-guard.node.test.ts`. The second shape is the right one
here for four measured reasons: a new `packages/node/src/` module would enter this guard's own
corpus (recursion), `requirements-ledger`'s production corpus, `reachability-guard`'s
`ORPHAN_MODULE_CEILING`, and `purity`'s jurisdiction. A `.test.ts` is outside all four.

### Four detectors, each covering a hole in the other three

| # | detector | what fires it | sites today |
|---|---|---|---|
| 1 | `media` | the file reaches a persistence medium: `node:fs`, `idb`, `indexedDB`, `localStorage`/`sessionStorage`, `DurableObjectStorage`, `document.cookie`, `caches.open(` | 29 files |
| 2 | `persists` | the write shapes, corpus-wide: `writeFile`, `writeFileSync`, `appendFile`, `appendFileSync`, `createWriteStream`, `.put(`, `.setItem(` | 73 |
| 3 | `named` | a write to a fixed named location: `.put(`/`.add(`/`.setItem(` whose first argument is an UPPER_SNAKE identifier | 15 |
| 4 | `secretShaped` | a write whose **argument text** names key material | 7 |

Union: **50 files**, which is the register's size.

Each one is load-bearing:

- **1 is the hardest to evade** — a new store has to reach a medium by name. `cookie` and
  `cache-api` find nothing today and are in anyway: a value stashed in a cookie or in the
  Cache API is stored exactly as durably as one in IndexedDB.
- **2 is wide on purpose.** Detectors 1 and 3 both miss a *new caller* that hands a value to a
  store it does not own — `blockstore.put(x)` in a file that imports no medium and names
  nothing secret-shaped — and the criterion's wording is *"a store **or a value** nobody
  declared"*. This is the brief's stated minimum set, plus `appendFile`/`appendFileSync`,
  without which **two real stores would have been missed**: `fs-issuance.ts`'s ledger append
  and `sovereign-cids.ts`.
- **3 catches the hosted tier.** `hosted-identity.ts`, `admission-flag.ts`,
  `funnel-journal.ts` and `relay-service-journal.ts` own no medium — they write named keys
  into a `DoDatastore` they are handed. Detector 1 cannot see any of them.
- **4 is the narrowest and the loudest**, and it is deliberately **fourth**. It is a
  *vocabulary* detector, and this phase exists because a name-level claim (*"`exportKey`
  fails on it, so there is nothing at rest to encrypt"*) was believed over the bytes. It is a
  cross-check, never the instrument.

### The derived case

`walk()` renders one line per store — `file media=[…] persists=N named=N secret=N` — and must
`toEqual` the register's projection of the same shape. Extra lines on the left are a store or
a value nobody classified; extra lines on the right are a register that has stopped describing
the tree. **One assertion, four detectors, both directions.** Plus ceilings
(`STORE_CEILING = 50`, `PERSIST_SITE_CEILING = 73`) on `reachability-guard`'s precedent, for
the case set equality cannot see: somebody adding an entry *and* the site to match it in one
change.

### Two shapes deliberately kept out, measured rather than preferred

**`.add(`** is in detector 3 (UPPER_SNAKE first argument only) and out of detector 2. Measured
over this corpus: **41 `.add(` sites, of which 39 are `Set.add`**. In the wide net it would
bury 2 real store writes under 39 entries of ceremony, and a register nobody reads is a
register that gets rubber-stamped. The 2 real ones (`idb-issuance`, `idb-sovereign-cids`) are
held by detectors 1 and 3.

**`.set(`** is out of every detector and must stay out. `TypedArray.prototype.set` is how this
repository copies bytes, and **four of its uses are on actual seeds** — `identity-store.ts:202`
and `:258`, `hosted-identity.ts:400`, `bin/agent.ts:1097`. Adding it would flood detector 4
with in-memory copies that are not stores at all. The spec says so where somebody would make
the change.

### Jurisdiction, and the one exclusion is a checked claim

`packages/*/src/**` plus `packages/browser/demo/**`; `*.test.ts` out. `tools/` is out because
it is a build-time toolchain no tier loads at runtime — **and that is re-derived on every run**
rather than asserted once: a case requires detector 4 to find **zero** sites under `tools/`,
with a positive control beside it proving the same search finds the 11 files there that *do*
write (so the zero is a reading, not an empty walk).

---

## 2. The positive control, and it is in the same run

This repository has closed a criterion on an empty read and had to reopen it, and has watched
twelve instruments stay green in one run because none could see the property it named. So the
floors are asserted **before** the set equality, and named sites are asserted as well as counts
— a count can be met by the wrong 73 lines.

| control | reading |
|---|---|
| corpus size | **202 files**, >1 000 000 characters of source (asserted >150 / >1 000 000) |
| `identity-store.ts` — the brief's suggested candidate, **verified** | `media=[filesystem] persists=2 secret=1` — the envelope write at `:272` and the certificate at `:327` |
| `visitor-key.ts` | `secret=1` |
| `hosted-identity.ts` | `secret=2`, `named=2`, **`media=[]`** — the case that proves detector 3 sees what detector 1 cannot |
| `idb-identity-store.ts` | `secret=2` |
| totals, all four detectors in one run | media ≥ 25 (29), persists ≥ 60 (73), named ≥ 12 (15), secret ≥ 5 (7) |
| media coverage | all four media that exist in this tree are reached |

Plus seven separator cases: a write is found and the same text in a line comment and a block
comment is not; a `/*` inside a string literal does not blind the file (the `stripComments`
differential — the regex it replaced would have deleted the write); a named location is
distinguished from a content-addressed put; `Set.add` and `TypedArray.set` are not writes;
the secret vocabulary is read from the **arguments**, not the line; and a file that stores
nothing is not reported.

---

## 3. Every write site, classified — read at the site, not inferred from the identifier

Four classes. `sealed-secret` / `public-material` / `not-a-secret` were the brief's three;
`plaintext-secret-by-design` is a fourth, added because none of the three can state
`e2e-browser-launch.ts` truthfully (§6).

### Sealed secrets — 4 stores, and each names the module that seals it (machine-checked)

| store | value | sealed by |
|---|---|---|
| `packages/node/src/identity-store.ts` | the sealed identity envelope — node seed or provider signing key | `core/src/sealed-secret.ts` |
| `packages/browser/src/visitor-key.ts` | the visitor owner key's private half (criterion 2) | `core/src/sealed-secret.ts` |
| `packages/browser/src/idb-identity-store.ts` | the sealed node and provider seeds, plus the migration re-seal | `core/src/sealed-secret.ts` |
| `packages/cloudflare/src/hosted-identity.ts` | the hosted seed under a platform secret (criterion 4), two sites — mint and migrate | `core/src/sealed-secret.ts` |
| `packages/node/src/fs-datastore.ts` | libp2p's datastore values, **including the keychain's PKCS#8 under AutoTLS** | `libp2p/src/keychain-protection.ts` |
| `packages/cloudflare/src/do-datastore.ts` | the same, on the hosted tier where the keychain is unconditional | `libp2p/src/keychain-protection.ts` |

The last two are the criterion-3 half and they are **not obvious from the file**: neither
`fs-datastore.ts` nor `do-datastore.ts` knows what it holds. Verified by reading the wiring:
`fabric-node.ts:2133` constructs `FsDatastore` and `:2333` hands it to
`keychain(keychainProtection)`; `hosted-libp2p.ts:362` does the same with the DO datastore.
Before criterion 3 both were PKCS#8 under an empty-string DEK.

### Public material — 6 values, each read before it was classified

| store | value | why public |
|---|---|---|
| `identity-store.ts` | the node certificate | on the wire and in DHT records; sealing the local copy breaks offline verification and protects nothing |
| `idb-identity-store.ts` | the node certificate, and **the KDF salt** | a salt defeats precomputation by being unique, not unknown; it is stored beside the ciphertext by design |
| `visitor-key.ts` | the SPKI public half, in the clear beside the sealed private half | what peers verify signatures with |
| `idb-issuance.ts`, `fs-issuance.ts` | one record per enrolment: a timestamp and the **public** user key | the issuance ledger a provider needs to bound its own rate |
| `certificate-cache.ts` | a peer's certificate, re-parsed by the wire's own parser | already received on the wire |
| `local-acme.ts` | the local ACME CA **certificate** as PEM | a certificate, not a key; the CA private key never leaves memory |
| `dht-registration.ts` | this node's signed records, put into **other peers'** stores | publishing them is the point |

### Not a secret — 38 stores

Content-addressed blocks (`fs-blockstore`, `idb-blockstore`, and every `blockstore.put(bytes)`
caller in `core/`, `net/`, `bench/`, `demo/main.ts`, `bin/agent.ts`, `bin/bench.ts`); job
structure and results; the sovereign-CID list; the consent record and the view name in Web
Storage; the funnel and relay journals (counters only — the collector discards the request
geolocation before it reaches the journal); the admission directive; checkpoint handles;
benchmark reports; `mutation-guard.mutate.ts`'s source-text plants; and six files that reach a
medium and **write nothing** (`start-probe`, `commit-scope`, `orphan-leash`, `reachability`,
`do-storage.fixture`, and the four Cloudflare files that name the storage type only). Those six
are in the register precisely so a reader can see they do not write.

### Plaintext secret by design — 1

`packages/node/src/e2e-browser-launch.ts:466` plants a **raw 32-byte identity seed** into a
fixture tab's IndexedDB. This is deliberate: it produces the one visitor the
`writes-no-new-secret` arm still serves — a returning visitor whose browser held a key from
before AUTH-06 — and it is the only end-to-end exercise of that adopt path. The claim that
this is test-only is **machine-checked**: every tracked module importing it must be a
`.test.ts`, with a positive control requiring the same search to find the three specs that do.

---

## 4. The plants — three, each watched red, each restored by the surgical inverse

Every restore was the exact inverse of the plant (a truncate to the pre-append byte length; a
re-insertion of the deleted block; a single-identifier reversal), verified with `cmp` against a
snapshot taken **immediately before planting**. All three `CMP_EXIT=0`.

### Plant A — a new, undeclared write of something secret-shaped

Appended to `packages/libp2p/src/identity.ts`, a file with no persistence at all:

```ts
export function stashSeed(store: { put: (key: string, seed: string) => void }, seed: string): void {
  store.put('backup', seed)
}
```

Observed:

```
FAIL  |node| packages/node/src/stored-value-guard.node.test.ts > the register describes the
tree, or it reddens > names every store the walk finds, and nothing the walk does not
AssertionError: expected [ …(51) ] to deeply equal [ …(50) ]
+   "packages/libp2p/src/identity.ts media=[] persists=1 named=0 secret=1",
```

**Run twice** — once against the first green version and again against the final one after the
reads were hoisted (§7) — because the earlier red was taken on a file that no longer exists.
Same text both times.

### Plant B — a register entry deleted while its site still exists

The `packages/node/src/sovereign-cids.ts` entry removed from the register:

```
AssertionError: expected [ …(50) ] to deeply equal [ …(49) ]
+   "packages/node/src/sovereign-cids.ts media=[filesystem] persists=1 named=0 secret=0",
```

The set equality is symmetric in fact and not only in principle.

### Plant C — a false sealing claim

`identity-store.ts`'s `sealedBy` changed from `sealed-secret.ts` to `fs-blockstore.ts`, a file
that seals nothing:

```
FAIL … > a value declared sealed names the module that seals it > gives every sealed value a
sealing module that exists and seals
AssertionError: these claim to be sealed and name no module that does it: expected [ Array(1) ]
to deeply equal []
+   "packages/node/src/identity-store.ts: the sealed identity envelope — the node seed or the
+    provider signing key",
```

This is the plant that matters most for point 4 of the brief: *"an entry that says 'public
material' about a secret is worse than no guard at all"*. The sealing claim is the one
classification a machine can check, and it can go red.

**No plant stayed green.** Nothing is being reported here as covered that was not watched
failing.

---

## 5. No byte is rendered through `String`

The guard **holds no bytes at all**. Every read is `readFileSync(path, 'utf8')`, which returns
a string; nothing decodes, compares or prints a byte. Stated in the file's header and then
checked: a case reads this spec's own source (comment-stripped), requires every
`readFileSync` line to carry `'utf8'`, and requires the names `Buffer`, `TextDecoder`,
`TextEncoder` and `Uint8Array` to be absent. Those names are assembled from fragments in the
case itself — written whole, the file's own source would contain the strings it scans for and
the scan would report itself, the same device `trust-anchors.node.test.ts` uses for its opt-out
literal.

The read floor in that case is load-bearing rather than decorative: it was 4 before the reads
were hoisted, and it **caught the change** and went red until it was re-derived to 2.

---

## 6. What the brief said that turned out to be wrong or incomplete

1. **"excluding … fixtures" — not done, deliberately.** Fixtures are IN, and that is what
   surfaced `e2e-browser-launch.ts`'s plaintext seed, the one write in this repository that is
   a secret in the clear on purpose. Excluding fixtures would have made the guard silent about
   the single most interesting thing in the tree.
2. **Three classes are not enough.** `sealed-secret` / `public-material` / `not-a-secret`
   cannot state the case above truthfully; calling it `not-a-secret` would be a false entry,
   which the brief itself says is worse than no guard. A fourth class,
   `plaintext-secret-by-design`, was added, and it carries the test-only machine check.
3. **The suggested minimum call set misses two real stores.** `writeFile`/`writeFileSync`/
   `.put(`/`.setItem(`/`localStorage`/`sessionStorage` does not include `appendFile` or
   `appendFileSync`, and `fs-issuance.ts:196` and `sovereign-cids.ts:85` are both appends.
4. **The `String` requirement could not be met by touching bytes carefully — it is met by not
   having any.** The brief anticipated this (*"if so, say that in the file"*); it is said
   **and checked**, because a stated property nobody re-derives is the thing this repository
   keeps having to retract.
5. **Every lead in the brief was verified and every one held.** `identity-store.ts`'s envelope
   write (`:272`, `mode: 0o600`) and certificate (`:327`); `visitor-key.ts`'s `{ sealed, spki }`
   (`:270`); `idb-identity-store.ts`'s sealed seeds (`:491`, `:500`);
   `hosted-identity.ts`'s sealed seed under a platform secret (`:329`, `:356`); the three
   content stores; `local-acme.ts`'s CA **certificate** (`:828`, public); and the keychain's
   DEK on both tiers. Nothing in the leads was false.
6. **One detail of the detector was wrong when first written, and the correction is in the
   spec.** The secret vocabulary was written with `\b` word boundaries and found **5** sites
   where there are **7** — `sealedKey` and `SEALED_KEY` both fail a trailing boundary, because
   `_` and a following capital are word characters. The two it was missing were the visitor's
   owner key and the browser identity store's sealed write, i.e. two of the three artefacts
   this phase is about. Cases pin all three identifier forms.

---

## 7. Two findings outside criterion 5, reported rather than absorbed

### The node lane's file-count tolerance was already exhausted

Adding one spec turned `slow-specs.node.test.ts` red: the node project holds **248** test
files against a recorded **242**, and `FILE_COUNT_TOLERANCE` is 5. Six arrivals, five of them
nameable — this spec plus criteria 2-4's four — and a sixth that no surviving list can name.
`vitest.config.ts`'s `files` was re-derived to 248 by **two independent routes** (a filesystem
walk applying the node project's own globs and suffix filter, and `git ls-files` under the same
predicate) whose lists diff empty in both directions, and `unitFiles` moved 162 → 168 by the
identity `files - excludedInNode`. That is the established treatment; the note in the config
records it.

### Three of criteria 2-4's specs are above `SLOW_CUTOFF_MS`, and the span table was NOT moved

Measured in one invocation so host load cancels, host quiet at load/core 0.89:

| file | span | vs 1 000 ms |
|---|---|---|
| `stored-value-guard.node.test.ts` | 355 ms | under |
| `signin.test.ts` | 5 ms | under |
| `hosted-keychain-dek.node.test.ts` | 2 559 ms | **over** |
| `keychain-dek.node.test.ts` | 5 234 ms | **over** |
| `hosted-seed-sealed.node.test.ts` | 6 394 ms | **over** |

The three that are over are slow by construction — Argon2id is deliberately memory-hard.
Putting a span in `MEASURED_NODE_SPANS` for them puts them on `SLOW_NODE_SPECS`, which takes
them **out of the `O2_UNIT_ONLY` lane CI narrows to** — the precise hole
`scripts/cheap-guards.sh` was written to close, where three guards were correct and unreached
for a day. That is a coverage decision with a cost on both sides and it is not criterion 5's to
take. The measurements are recorded; the table is untouched.

---

## 8. The cheap guards — measured, recommended, NOT added

**Not added, and the reason is `scripts/cheap-guards.sh`'s own docblock:** *"Added on the
owner's ruling, not on an agent's judgement, because what runs on every commit is a decision
with a price on every commit."* The list is single-sourced, `slow-specs.node.test.ts` asserts
the hook and CI both call the script and that the hook spells out no path of its own, so
adding a name is a one-line change and a standing cost.

**The cost argument favours adding it, and here is the number.** File span **355 ms**;
`/usr/bin/time -p` on the file alone reads `real 1.32 / user 1.07 / sys 0.20` against a vitest
boot floor of roughly 1.2 s, so the marginal cost is about a third of a second. The nine guards
already in the list cost `real 2.46` together. It is cheaper than `vocabulary` (1 535 ms) and
roughly a tenth of `reachability-guard` (3 483 ms).

**It was written to be cheap on purpose.** The first green version cost **1 962 ms** — above
`SLOW_CUTOFF_MS`, which would have put it on `SLOW_NODE_SPECS` and out of CI's narrowed lane —
because three cases each shelled out to `git ls-files` and re-read the tree. One `git ls-files`
and one memoised read per file took it to 355 ms. That reduction is recorded in the spec beside
the code that achieves it, because a guard that is correct and unreached is indistinguishable
from one that is absent.

**Recommendation: add `packages/node/src/stored-value-guard.node.test.ts` to `GUARDS` in
`scripts/cheap-guards.sh`.** It is a source census with no network, no process and no socket;
it is the instrument that keeps AUTH-07 from decaying to prose; and it costs a third of a
second. The decision is the owner's.

---

## 9. Verification

| what | result |
|---|---|
| `npx tsc --noEmit` | `EXIT=0`, `real 1.39` |
| the guard alone | **29 passed (29)**, file span 355 ms |
| `bash scripts/cheap-guards.sh` | **400 passed (400)**, 9 files, `EXIT=0` |
| `npx vitest run --project node` | **248 files, 3 547 passed, 2 skipped, 0 failed**, `EXIT=0` |

`[host conditions]` on the full node lane: *"HOST WAS OVERSUBSCRIBED — load/core 0.51 before,
6.42 after (8 cores, ceiling 4.00). Nothing failed, so pass/fail stands. Every DURATION in this
run is void."* The lane's own contention is the oversubscription; **no duration from that run is
quoted anywhere in this document.** Every span above was taken on a run whose banner read *host
was quiet* — the guard alone at load/core 1.61, the five-file span measurement at 0.89, the
cheap guards at 0.51.
