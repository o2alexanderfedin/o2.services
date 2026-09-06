import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { stripComments } from './strip-comments.ts'

/**
 * AUTH-07 criterion 5 — one guard walks every persistent store on every tier against an
 * allow-list of what that store may hold.
 *
 * The owner's rule, 2026-09-06: *"Ключ в открытом виде не должен быть записан нигде. Или
 * иначе: сохраненный где бы то ни было ключ должен быть зашифрован всегда."* Criteria 1-4
 * fixed the three places that broke it. This file is the part that keeps it fixed, because
 * **a rule that lives only in prose decays the first time somebody adds a store.**
 *
 * ## Why this is a SOURCE census and not a runtime walk
 *
 * The criterion says *every persistent store on every tier*. There is no run in which all
 * three tiers are present: the node tier writes to a filesystem, the browser tier to
 * IndexedDB, the hosted tier to Durable Object storage, and those are three runtimes that
 * never share a process. A runtime dump can only ever be one tier's, which is what Phase
 * 42's criterion 1 already is for one store on one tier.
 *
 * So the unit here is the **write site in source**: every place production code puts a value
 * into a store must be declared, with what it writes and **what class that value is** —
 * because `AUTH-07` is about which stored values are secrets and whether they are ciphertext.
 * An undeclared write site is a finding, and so is a declared one that has gone away.
 *
 * ## Four detectors, and each one exists because the other three have a hole
 *
 * Every detector runs over {@link stripComments} output, so a docblock that mentions a write
 * is not a write. The guard's own comment about `store.put(` two lines up is the test of
 * that, and {@link censusOf} is driven directly with synthetic sources below so the stripping
 * is exercised rather than assumed.
 *
 * 1. **`media`** — the file reaches a persistence medium at all: `node:fs`, `idb`,
 *    `indexedDB`, `localStorage`/`sessionStorage`, `DurableObjectStorage`, `document.cookie`,
 *    `caches.open(`. This is the *"every persistent store"* half, and it is the hardest one
 *    to evade: a new store has to reach a medium by name. The last two find nothing today
 *    and are here anyway, because a value stashed in a cookie or in the Cache API is stored
 *    exactly as durably as one in IndexedDB.
 * 2. **`persists`** — the write shapes themselves, corpus-wide: `writeFile`, `writeFileSync`,
 *    `appendFile`, `appendFileSync`, `createWriteStream`, `.put(`, `.setItem(`. Wide on
 *    purpose. Detectors 1 and 3 both miss a NEW caller that hands a secret to a store it
 *    does not own — `blockstore.put(x)` in a file that imports no medium and names nothing
 *    secret-shaped — and the criterion's wording is *"a store **or a value** nobody declared"*.
 *    73 sites today, most of them one line of content-addressed bytes.
 * 3. **`named`** — a write to a fixed named location: `.put(`/`.add(`/`.setItem(` whose first
 *    argument is an UPPER_SNAKE identifier. This is what catches the hosted tier's
 *    `hosted-identity`, `admission-flag`, `funnel-journal` and `relay-service-journal`, none
 *    of which owns a medium — they write named keys into a `DoDatastore` handed to them.
 * 4. **`secretShaped`** — a write whose argument text names key material (`seed`, `sealed`,
 *    `passphrase`, `pkcs8`, `scalar`, `dek`, `envelope`, …). The narrowest and the loudest:
 *    7 sites, and they are exactly the phase-43 inventory plus one fixture. It is a
 *    *vocabulary* detector and therefore the weakest of the four on its own — this phase
 *    exists because a name-level claim was believed over the bytes — which is why it is
 *    fourth and not first.
 *
 * ## Two shapes deliberately kept OUT, both measured rather than preferred
 *
 * **`.add(`** is in detector 3 (UPPER_SNAKE first argument only) and out of detector 2.
 * Measured over this corpus: 41 `.add(` sites, of which **39 are `Set.add`** — `seen.add(…)`,
 * `listeners.add(…)`, `nonces.add(…)`. Putting it in the wide net would bury 2 real store
 * writes under 39 entries of ceremony, and a register nobody reads is a register that gets
 * rubber-stamped. The two real ones — `idb-issuance`'s `#db.add(STORE, …)` and
 * `idb-sovereign-cids` — are held by detectors 1 and 3.
 *
 * **`.set(`** is out of every detector, and it must stay out. `TypedArray.prototype.set` is
 * how this repository copies bytes into a buffer, and four of its uses are on **actual
 * seeds**: `identity-store.ts:202` and `:258`, `hosted-identity.ts:400`, `bin/agent.ts:1097`.
 * Adding `.set(` would flood detector 4 with in-memory copies that are not stores at all, and
 * the register would then say the opposite of what it means. Do not "complete the set".
 *
 * ## Jurisdiction: `packages/[*]/src/[**]` plus `packages/browser/demo/[**]`
 *
 * Tests are out — a `.test.ts` writes to a temporary directory by definition. **Fixtures are
 * IN**, which is a departure from this criterion's brief and it paid for itself: keeping them
 * is what surfaced `e2e-browser-launch.ts`'s deliberate plaintext seed, the one write in this
 * repository that is a secret in the clear on purpose. It is declared as such.
 *
 * `tools/` is out, and the exclusion is a **checked claim rather than a silence**: it is a
 * build-time toolchain that no tier loads at runtime, and the case below re-derives on every
 * run that detector 4 finds nothing there. If a tool ever writes key material, that assertion
 * fails and the jurisdiction has to be widened rather than argued about.
 *
 * ## No byte is rendered through `String`
 *
 * `Buffer.from(String(u8))` renders a `Uint8Array` as `255,15,66,…` and blinded an instrument
 * in this repository once already. **This guard touches no bytes at all**: every read is
 * `readFileSync(path, 'utf8')`, which returns a string, and nothing here decodes, compares or
 * prints a byte. That is stated here and then checked — see the last describe block, which
 * reads this file's own source and fails if a read loses its encoding or if `String(`,
 * `Buffer.from(` or `TextDecoder` appears.
 *
 * ## What this guard does NOT claim, stated so nobody widens it
 *
 * It cannot see what is *inside* a value. `fs-blockstore.ts` and `idb-blockstore.ts` hold
 * whatever bytes a caller hands them, and a caller who put a private key in a block would
 * have written a secret in the clear with every entry below still true. What the register
 * pins is the **shape of the tree** — which stores exist, how many write sites each has, and
 * what each is declared to hold. The truth of a `kind` is a human reading recorded in
 * `.planning/phases/phase-43-every-stored-key-is-ciphertext/43-ALLOWLIST.md`, except for the
 * two claims that are machine-checked below: a `sealed-secret` must name the module that
 * seals it, and a `plaintext-secret-by-design` must be reachable only from tests.
 */

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))

/** A persistence medium a value can be durable in. Order is the render order. */
type Medium =
  | 'filesystem'
  | 'indexeddb'
  | 'web-storage'
  | 'durable-object-storage'
  | 'cookie'
  | 'cache-api'

/**
 * How a file reaches each medium.
 *
 * Import specifiers where one exists, because an import cannot be spelled two ways; bare
 * globals where the medium has no module (`indexedDB`, `localStorage`, `caches`).
 */
const MEDIA: readonly (readonly [Medium, RegExp])[] = [
  ['filesystem', /from\s+'node:fs(?:\/promises)?'/],
  ['indexeddb', /from\s+'idb'|\bindexedDB\b/],
  ['web-storage', /\blocalStorage\b|\bsessionStorage\b/],
  ['durable-object-storage', /\bDurableObjectStorage\b/],
  ['cookie', /\bdocument\.cookie\b/],
  ['cache-api', /\bcaches\.open\s*\(/],
]

/**
 * Detector 2 — the write shapes. See the header for why `.add(` and `.set(` are absent.
 *
 * Not a shared `RegExp` object with the `g` flag reused across calls: `lastIndex` survives,
 * and a stateful matcher that reports a different answer on its second call over the same
 * input is the kind of instrument this repository has already had to retract once.
 */
const persistsPattern = (): RegExp =>
  /\b(?:writeFile|writeFileSync|appendFile|appendFileSync|createWriteStream)\s*\(|\.(?:put|setItem)\s*\(/g

/** Detector 3 — a write to a fixed named location. */
const namedPattern = (): RegExp => /\.(?:put|add|setItem)\s*\(\s*[A-Z][A-Z0-9_]{2,}\b/g

/** Detector 4 — the call, with its argument text captured so the vocabulary is read from it. */
const SECRET_CALL =
  /(?:\b(?:writeFile|writeFileSync|appendFile|appendFileSync|createWriteStream)|\.(?:put|add|setItem))\s*\(([^\n]*)/

/**
 * The vocabulary of key material.
 *
 * **Substring, not `\b`-delimited, and that is a correction rather than laziness.** Written
 * with word boundaries it missed `sealedKey`, `SEALED_KEY` and `sealedSeed` — every real
 * identifier in this tree — because `_` and a following capital are both word characters. It
 * found 5 sites; the same list without the boundaries finds 7, and the 2 it had been missing
 * are the visitor's owner key and the browser identity store's sealed write, which are two of
 * the three artefacts this whole phase is about. `\bdek` keeps one boundary because `dek`
 * unanchored is a common substring of nothing here but would not stay that way.
 */
const SECRET_WORDS =
  /seed|secret|private|passphrase|password|pkcs8|scalar|\bdek|sealed|envelope|keypair|signingkey|identitykey|credential/i

interface Census {
  readonly media: readonly Medium[]
  readonly persists: number
  readonly named: number
  readonly secretShaped: number
}

/**
 * Run all four detectors over one file's RAW source.
 *
 * Raw, not pre-stripped: the stripping is part of what the mutation cases below have to be
 * able to exercise, and a helper that trusted its caller to have stripped would be a helper
 * whose blindness lives somewhere else.
 */
function censusOf(source: string): Census {
  const code = stripComments(source)
  return {
    media: MEDIA.filter(([, pattern]) => pattern.test(code)).map(([medium]) => medium),
    persists: (code.match(persistsPattern()) ?? []).length,
    named: (code.match(namedPattern()) ?? []).length,
    secretShaped: code.split('\n').filter((line) => {
      const call = SECRET_CALL.exec(line)
      return call !== null && SECRET_WORDS.test(call[1] ?? '')
    }).length,
  }
}

/** Anything at all. A file with a flat zero across four detectors is not a store. */
function isStore(census: Census): boolean {
  return (
    census.media.length > 0 ||
    census.persists > 0 ||
    census.named > 0 ||
    census.secretShaped > 0
  )
}

/** One line per store, which is what a failing `toEqual` renders as a readable diff. */
function render(file: string, census: Census): string {
  return (
    `${file} media=[${census.media.join(',')}] persists=${String(census.persists)} ` +
    `named=${String(census.named)} secret=${String(census.secretShaped)}`
  )
}

/**
 * Every tracked path under `packages/` and `tools/`, read ONCE.
 *
 * One `git ls-files` for the whole file, not one per assertion. Written the obvious way this
 * spec cost 1 962 ms — above `SLOW_CUTOFF_MS`, which would have put it on `SLOW_NODE_SPECS`
 * and out of the `O2_UNIT_ONLY` lane CI narrows to. A guard that is correct and unreached is
 * indistinguishable from one that is absent, and `scripts/cheap-guards.sh` carries the day
 * that sentence cost this repository.
 */
const TRACKED: readonly string[] = execFileSync(
  'git',
  ['ls-files', '-z', 'packages/', 'tools/'],
  { cwd: ROOT, encoding: 'utf8' },
)
  .split('\0')
  .filter((path) => path.length > 0)

/** Read once per file, however many cases ask for it. */
const readCache = new Map<string, string>()
function sourceOf(path: string): string {
  const cached = readCache.get(path)
  if (cached !== undefined) return cached
  const text = readFileSync(join(ROOT, path), 'utf8')
  readCache.set(path, text)
  return text
}

function trackedSources(prefix: string): readonly string[] {
  return TRACKED.filter((path) => path === prefix || path.startsWith(prefix))
    .filter((path) => /\.(?:ts|mts|js|mjs)$/.test(path))
    .filter((path) => !/\.test\.ts$|\.spec\.ts$|\.d\.ts$/.test(path))
}

/**
 * Production source on the three tiers.
 *
 * `packages/[*]/src/[**]` is where every tier's code lives; `packages/browser/demo/[**]` is
 * the demo page, which is production for the browser tier — it is the thing a visitor loads
 * — and it holds a real `sessionStorage` write.
 */
const CORPUS: readonly string[] = trackedSources('packages/').filter(
  (path) => /^packages\/[^/]+\/src\//.test(path) || path.startsWith('packages/browser/demo/'),
)

/** Read once. Every case below reads this map rather than the disk. */
const SOURCES: ReadonlyMap<string, string> = new Map(
  CORPUS.map((path) => [path, sourceOf(path)]),
)

/** The walk: every corpus file any detector fires on, as rendered lines, sorted. */
function walk(): readonly string[] {
  return CORPUS.map((file) => [file, censusOf(SOURCES.get(file) ?? '')] as const)
    .filter(([, census]) => isStore(census))
    .map(([file, census]) => render(file, census))
    .sort()
}

/**
 * What a stored value is, for the purposes of the owner's rule.
 *
 * Four, not three. The fourth was added because `e2e-browser-launch.ts` writes a 32-byte
 * identity seed in the clear **on purpose** — it is the fixture that produces the one visitor
 * the `writes-no-new-secret` arm still serves, a returning visitor whose browser held a key
 * from before AUTH-06 — and none of the other three can say that truthfully. Calling it
 * `not-a-secret` would be a false entry, and a false entry is worse than no guard.
 */
type SecretClass =
  | 'sealed-secret'
  | 'public-material'
  | 'not-a-secret'
  | 'plaintext-secret-by-design'

interface StoredThing {
  /** What is written. */
  readonly value: string
  /** Which of the four it is. */
  readonly kind: SecretClass
  /** Why that class and not another. One line. */
  readonly why: string
  /**
   * For a `sealed-secret` only: the repository file that performs the sealing.
   *
   * Machine-checked below — it must be a tracked file whose source calls one of this
   * repository's sealing primitives. It exists because *"it is sealed"* is exactly the kind
   * of claim this phase was opened by disbelieving.
   */
  readonly sealedBy?: string
}

interface StoreEntry {
  readonly file: string
  readonly media: readonly Medium[]
  readonly persists: number
  readonly named: number
  readonly secretShaped: number
  readonly holds: readonly StoredThing[]
}

/** The sealing primitives this repository has. A `sealedBy` file must call one. */
const SEALING_CALLS = /\b(?:sealSecret|sealWithKey|sealHostedSeed|keychainProtectionFor)\b/

const SEALED_SECRET_MODULE = 'packages/core/src/sealed-secret.ts'
const KEYCHAIN_PROTECTION_MODULE = 'packages/libp2p/src/keychain-protection.ts'

/**
 * THE REGISTER. One entry per store, declaring what it may hold.
 *
 * Every `holds` line was read at its write site before it was written here — the classes are
 * not inferred from identifiers. The full reading, site by site, is in `43-ALLOWLIST.md`.
 */
const REGISTER: readonly StoreEntry[] = [
  {
    file: 'packages/bench/src/perf-workload.ts',
    media: [],
    persists: 3,
    named: 2,
    secretShaped: 0,
    holds: [
      {
        value: 'the benchmark kernel module bytes and one canonical-encoded task input',
        kind: 'not-a-secret',
        why: 'a fixed WASM fixture and its input, content-addressed into a caller-supplied blockstore',
      },
    ],
  },
  {
    file: 'packages/browser/demo/main.ts',
    media: [],
    persists: 5,
    named: 0,
    secretShaped: 0,
    holds: [
      {
        value: "the demo kernels' bytes, a visitor-supplied artifact, and a job outcome's content",
        kind: 'not-a-secret',
        why: 'all five are content-addressed puts into the tab node’s own blockstore; the file’s header forbids putting an identifier anywhere durable',
      },
    ],
  },
  {
    file: 'packages/browser/demo/nav.ts',
    media: ['web-storage'],
    persists: 1,
    named: 1,
    secretShaped: 0,
    holds: [
      {
        value: 'the chosen view name, in sessionStorage',
        kind: 'not-a-secret',
        why: 'one of two literal strings deciding which half of the page is shown; per-tab and gone with it',
      },
    ],
  },
  {
    file: 'packages/browser/src/capability-harness.ts',
    media: [],
    persists: 1,
    named: 0,
    secretShaped: 0,
    holds: [
      {
        value: "an artifact's bytes",
        kind: 'not-a-secret',
        why: 'content-addressed into the running node’s blockstore',
      },
    ],
  },
  {
    file: 'packages/browser/src/consent.ts',
    media: ['web-storage'],
    persists: 1,
    named: 0,
    secretShaped: 0,
    holds: [
      {
        value: 'the consent record, as JSON in localStorage',
        kind: 'not-a-secret',
        why: 'a decision and its timestamp; this file’s own header states the rule that no stable identifier may join it there',
      },
    ],
  },
  {
    file: 'packages/browser/src/idb-blockstore.ts',
    media: ['indexeddb'],
    persists: 1,
    named: 0,
    secretShaped: 0,
    holds: [
      {
        value: 'block bytes, keyed by CID',
        kind: 'not-a-secret',
        why: 'content-addressed storage; the store is a bag of blocks and classifies nothing about them',
      },
    ],
  },
  {
    file: 'packages/browser/src/idb-checkpoints.ts',
    media: ['indexeddb'],
    persists: 1,
    named: 1,
    secretShaped: 0,
    holds: [
      {
        value: "a confirmed checkpoint handle, keyed by job id",
        kind: 'not-a-secret',
        why: 'a pointer string that resolves through the blockstore; carries no key material and no identity',
      },
    ],
  },
  {
    file: 'packages/browser/src/idb-identity-store.ts',
    media: ['indexeddb'],
    persists: 4,
    named: 1,
    secretShaped: 2,
    holds: [
      {
        value: 'the sealed node seed and the sealed provider seed',
        kind: 'sealed-secret',
        why: 'written through sealWithKey; the migration write at the same seam re-seals an older envelope rather than opening one',
        sealedBy: SEALED_SECRET_MODULE,
      },
      {
        value: "the store's KDF salt",
        kind: 'public-material',
        why: 'a salt defeats precomputation by being unique, not by being unknown; it is stored beside the ciphertext by design',
      },
      {
        value: 'the node certificate',
        kind: 'public-material',
        why: 'transmitted on the wire and published into DHT records; sealing the local copy would break offline verification and protect nothing',
      },
    ],
  },
  {
    file: 'packages/browser/src/idb-issuance.ts',
    media: ['indexeddb'],
    persists: 0,
    named: 1,
    secretShaped: 0,
    holds: [
      {
        value: 'one issuance record per enrolment: a timestamp and the enrolled public key',
        kind: 'public-material',
        why: 'the public half of a user key plus when it was signed; the rate ledger a provider needs to bound its own issuance',
      },
    ],
  },
  {
    file: 'packages/browser/src/idb-sovereign-cids.ts',
    media: ['indexeddb'],
    persists: 1,
    named: 1,
    secretShaped: 0,
    holds: [
      {
        value: 'a flag marking one CID sovereign, keyed by that CID',
        kind: 'not-a-secret',
        why: 'a boolean; the CID it is keyed by is already in the blockstore',
      },
    ],
  },
  {
    file: 'packages/browser/src/start-probe.ts',
    media: ['indexeddb'],
    persists: 0,
    named: 0,
    secretShaped: 0,
    holds: [
      {
        value: 'nothing — it reads whether `indexedDB` is present and never opens it',
        kind: 'not-a-secret',
        why: 'a capability probe; it is in the register because it reaches the medium by name and a reader must be able to see that it does not write',
      },
    ],
  },
  {
    file: 'packages/browser/src/visitor-key.ts',
    media: ['indexeddb'],
    persists: 1,
    named: 0,
    secretShaped: 1,
    holds: [
      {
        value: "the visitor owner key's sealed private half",
        kind: 'sealed-secret',
        why: 'criterion 2 of this phase; the whole PKCS#8 used to be on disk here, found at a measured offset on two engines',
        sealedBy: SEALED_SECRET_MODULE,
      },
      {
        value: 'the same key’s SPKI public half, in the clear beside it',
        kind: 'public-material',
        why: 'the public half is what peers verify signatures with; it is handed out on the wire already',
      },
    ],
  },
  {
    file: 'packages/cloudflare/src/admission-flag.ts',
    media: [],
    persists: 1,
    named: 1,
    secretShaped: 0,
    holds: [
      {
        value: 'the admission directive, as JSON under one named key',
        kind: 'not-a-secret',
        why: 'an operator switch saying which record namespaces the hosted datastore admits',
      },
    ],
  },
  {
    file: 'packages/cloudflare/src/do-datastore.ts',
    media: ['durable-object-storage'],
    persists: 1,
    named: 0,
    secretShaped: 0,
    holds: [
      {
        value: "libp2p's own datastore values — peer records, addresses, and the keychain's stored private keys",
        kind: 'sealed-secret',
        why: 'the keychain writes PKCS#8 here, and since criterion 3 it derives a real DEK from the identity seed rather than the empty string',
        sealedBy: KEYCHAIN_PROTECTION_MODULE,
      },
      {
        value: 'the peer records and addresses in the same keyspace',
        kind: 'public-material',
        why: 'addresses and peer ids are what a node advertises; nothing about them is secret',
      },
    ],
  },
  {
    file: 'packages/cloudflare/src/do-storage.fixture.ts',
    media: ['durable-object-storage'],
    persists: 0,
    named: 0,
    secretShaped: 0,
    holds: [
      {
        value: 'nothing durable — an in-process double of the Durable Object storage API, backed by a Map',
        kind: 'not-a-secret',
        why: 'it implements the medium’s interface, which is why it reaches the name, and it stores into memory that dies with the process',
      },
    ],
  },
  {
    file: 'packages/cloudflare/src/funnel-journal.ts',
    media: [],
    persists: 1,
    named: 1,
    secretShaped: 0,
    holds: [
      {
        value: 'the funnel stage counters, as JSON under one named key',
        kind: 'not-a-secret',
        why: 'counts per stage and per cell, size-capped and monotonic; the collector discards the request geolocation before it reaches here',
      },
    ],
  },
  {
    file: 'packages/cloudflare/src/hosted-identity.ts',
    media: [],
    persists: 2,
    named: 2,
    secretShaped: 2,
    holds: [
      {
        value: "the hosted node's identity seed, sealed under a platform secret",
        kind: 'sealed-secret',
        why: 'criterion 4 of this phase; two write sites, one minting a new envelope and one migrating the raw seed this object used to hold',
        sealedBy: SEALED_SECRET_MODULE,
      },
    ],
  },
  {
    file: 'packages/cloudflare/src/hosted-libp2p.ts',
    media: ['durable-object-storage'],
    persists: 0,
    named: 0,
    secretShaped: 0,
    holds: [
      {
        value: 'nothing directly — it constructs the datastore and hands it to libp2p and to the keychain',
        kind: 'not-a-secret',
        why: 'the assembly point; every value it causes to be written is declared against `do-datastore.ts`',
      },
    ],
  },
  {
    file: 'packages/cloudflare/src/hosted-object.ts',
    media: ['durable-object-storage'],
    persists: 0,
    named: 0,
    secretShaped: 0,
    holds: [
      {
        value: 'nothing directly — it holds the object and passes its storage down',
        kind: 'not-a-secret',
        why: 'reaches the medium by type only',
      },
    ],
  },
  {
    file: 'packages/cloudflare/src/index.ts',
    media: ['durable-object-storage'],
    persists: 0,
    named: 0,
    secretShaped: 0,
    holds: [
      {
        value: 'nothing — the package barrel, which re-exports the storage type',
        kind: 'not-a-secret',
        why: 'a re-export reaches the medium by name and writes nothing',
      },
    ],
  },
  {
    file: 'packages/cloudflare/src/relay-service-journal.ts',
    media: [],
    persists: 1,
    named: 1,
    secretShaped: 0,
    holds: [
      {
        value: 'relay service totals, as JSON under one named key',
        kind: 'not-a-secret',
        why: 'reservation and byte counters for the relay this object runs',
      },
    ],
  },
  {
    file: 'packages/cloudflare/src/worker.ts',
    media: ['durable-object-storage'],
    persists: 0,
    named: 0,
    secretShaped: 0,
    holds: [
      {
        value: 'nothing — the Worker entry point, which names the storage type in its bindings',
        kind: 'not-a-secret',
        why: 'routes requests to the object; writes nothing itself',
      },
    ],
  },
  {
    file: 'packages/core/src/checkpoint.ts',
    media: [],
    persists: 1,
    named: 0,
    secretShaped: 0,
    holds: [
      {
        value: 'a canonical-encoded checkpoint',
        kind: 'not-a-secret',
        why: 'partial results and their positions, content-addressed into a caller-supplied blockstore',
      },
    ],
  },
  {
    file: 'packages/core/src/executor/task-run.ts',
    media: [],
    persists: 2,
    named: 0,
    secretShaped: 0,
    holds: [
      {
        value: "a task's module bytes and its input bytes",
        kind: 'not-a-secret',
        why: 'content-addressed so the executor can name what it ran; both came off the wire already',
      },
    ],
  },
  {
    file: 'packages/core/src/executor/task-worker.ts',
    media: [],
    persists: 1,
    named: 0,
    secretShaped: 0,
    holds: [
      {
        value: "a task's module bytes",
        kind: 'not-a-secret',
        why: 'the same content-addressed put on the worker path',
      },
    ],
  },
  {
    file: 'packages/core/src/job/submit.ts',
    media: [],
    persists: 2,
    named: 0,
    secretShaped: 0,
    holds: [
      {
        value: 'canonical-encoded shard descriptors and partial results',
        kind: 'not-a-secret',
        why: 'job structure and outputs; the sovereign path additionally records their CIDs so egress can refuse them',
      },
    ],
  },
  {
    file: 'packages/core/src/reduce.ts',
    media: [],
    persists: 1,
    named: 0,
    secretShaped: 0,
    holds: [
      {
        value: 'a canonical-encoded reduction result',
        kind: 'not-a-secret',
        why: 'the output of a reduce, content-addressed',
      },
    ],
  },
  {
    file: 'packages/libp2p/src/dht-provider-announcer.ts',
    media: [],
    persists: 1,
    named: 0,
    secretShaped: 0,
    holds: [
      {
        value: 'whatever the wrapped blockstore was given, before it announces the CID',
        kind: 'not-a-secret',
        why: 'a pass-through wrapper; the value is the caller’s and is classified at the store that ends up holding it',
      },
    ],
  },
  {
    file: 'packages/libp2p/src/dht-registration.ts',
    media: [],
    persists: 1,
    named: 0,
    secretShaped: 0,
    holds: [
      {
        value: "this node's signed records, put into OTHER peers' stores over the DHT",
        kind: 'public-material',
        why: 'a certificate and addresses, signed; publishing them is the point, and execution is omitted from every record the hosted node publishes',
      },
    ],
  },
  {
    file: 'packages/net/src/agent.ts',
    media: [],
    persists: 1,
    named: 0,
    secretShaped: 0,
    holds: [
      {
        value: 'a canonical-encoded partial result',
        kind: 'not-a-secret',
        why: 'content-addressed into the node’s blockstore on the way to a reply',
      },
    ],
  },
  {
    file: 'packages/net/src/block.ts',
    media: [],
    persists: 2,
    named: 0,
    secretShaped: 0,
    holds: [
      {
        value: "blocks, local and fetched, into the wrapped local store",
        kind: 'not-a-secret',
        why: 'a fetched block is only stored after its CID is re-derived and matched, so the store never holds a block under a name that is not its hash',
      },
    ],
  },
  {
    file: 'packages/net/src/churn.ts',
    media: [],
    persists: 1,
    named: 0,
    secretShaped: 0,
    holds: [
      {
        value: 'a canonical-encoded reassignment record',
        kind: 'not-a-secret',
        why: 'scheduling state, content-addressed',
      },
    ],
  },
  {
    file: 'packages/net/src/combine.ts',
    media: [],
    persists: 1,
    named: 0,
    secretShaped: 0,
    holds: [
      {
        value: "a peer's reply bytes",
        kind: 'not-a-secret',
        why: 'the reply to a combine request, content-addressed',
      },
    ],
  },
  {
    file: 'packages/net/src/conformance.ts',
    media: [],
    persists: 3,
    named: 0,
    secretShaped: 0,
    holds: [
      {
        value: 'conformance probe vectors',
        kind: 'not-a-secret',
        why: 'synthetic byte ramps written to check that a blockstore is content-addressed and does not alias its input',
      },
    ],
  },
  {
    file: 'packages/net/src/reduce-job.ts',
    media: [],
    persists: 1,
    named: 0,
    secretShaped: 0,
    holds: [
      {
        value: 'a canonical-encoded reduce output',
        kind: 'not-a-secret',
        why: 'content-addressed on the distributed reduce path',
      },
    ],
  },
  {
    file: 'packages/node/src/bench-fabric.ts',
    media: ['filesystem'],
    persists: 1,
    named: 0,
    secretShaped: 0,
    holds: [
      {
        value: 'the benchmark module bytes; the filesystem reach is `mkdir`/`rm` of scratch directories',
        kind: 'not-a-secret',
        why: 'a benchmark driver that creates and removes its own temporary roots and writes no value into them itself',
      },
    ],
  },
  {
    file: 'packages/node/src/bin/agent.ts',
    media: ['filesystem'],
    persists: 3,
    named: 0,
    secretShaped: 0,
    holds: [
      {
        value: "the demo kernels' bytes and one canonical-encoded input",
        kind: 'not-a-secret',
        why: 'content-addressed into the node’s blockstore; the filesystem reach is the passphrase FILE it READS, which is a credential an operator places and not a value this binary writes',
      },
    ],
  },
  {
    file: 'packages/node/src/bin/bench.ts',
    media: ['filesystem'],
    persists: 11,
    named: 3,
    secretShaped: 0,
    holds: [
      {
        value: 'benchmark module and input bytes, nine sites',
        kind: 'not-a-secret',
        why: 'fixtures and their canonical encodings, content-addressed into memory or fabric blockstores',
      },
      {
        value: 'the raw benchmark report and the rendered markdown, two files',
        kind: 'not-a-secret',
        why: 'timings and counts written to an output directory and to `.planning/BENCHMARK-RESULTS.md`',
      },
    ],
  },
  {
    file: 'packages/node/src/certificate-cache.ts',
    media: [],
    persists: 1,
    named: 0,
    secretShaped: 0,
    holds: [
      {
        value: "a peer's certificate, as JSON in the libp2p datastore",
        kind: 'public-material',
        why: 'the same certificate that arrived on the wire, re-parsed by the wire’s own parser on the way back out',
      },
    ],
  },
  {
    file: 'packages/node/src/commit-scope.ts',
    media: ['filesystem'],
    persists: 0,
    named: 0,
    secretShaped: 0,
    holds: [
      {
        value: 'nothing — it reads the commit scope file the pre-commit hook writes',
        kind: 'not-a-secret',
        why: 'a reader; it is in the register because it reaches the medium and a reader must be able to see that it does not write',
      },
    ],
  },
  {
    file: 'packages/node/src/e2e-browser-launch.ts',
    media: ['filesystem', 'indexeddb'],
    persists: 1,
    named: 0,
    secretShaped: 1,
    holds: [
      {
        value: 'a pre-AUTH-06 plaintext 32-byte identity seed, planted into a fixture tab’s IndexedDB',
        kind: 'plaintext-secret-by-design',
        why: 'the only exercise of the adopt path for a returning visitor whose browser held a key from before AUTH-06; every importer is a `.test.ts` and the case below re-derives that',
      },
    ],
  },
  {
    file: 'packages/node/src/fs-blockstore.ts',
    media: ['filesystem'],
    persists: 1,
    named: 0,
    secretShaped: 0,
    holds: [
      {
        value: 'block bytes, in a file named by their CID',
        kind: 'not-a-secret',
        why: 'content-addressed storage; write-then-rename so a reader never sees half a block',
      },
    ],
  },
  {
    file: 'packages/node/src/fs-datastore.ts',
    media: ['filesystem'],
    persists: 1,
    named: 0,
    secretShaped: 0,
    holds: [
      {
        value: "libp2p's own datastore values — including the keychain's stored private keys under AutoTLS",
        kind: 'sealed-secret',
        why: 'the keychain writes PKCS#8 here, and since criterion 3 its DEK is derived from the identity seed rather than being the empty string',
        sealedBy: KEYCHAIN_PROTECTION_MODULE,
      },
      {
        value: 'peer records, addresses, and the cached certificates of other peers',
        kind: 'public-material',
        why: 'everything a node advertises or has already received on the wire',
      },
    ],
  },
  {
    file: 'packages/node/src/fs-issuance.ts',
    media: ['filesystem'],
    persists: 2,
    named: 0,
    secretShaped: 0,
    holds: [
      {
        value: 'the issuance ledger: one line per enrolment, a public user key and a timestamp',
        kind: 'public-material',
        why: 'the public half of a user key and when it was signed; one write appends and the other rewrites the pruned file',
      },
    ],
  },
  {
    file: 'packages/node/src/identity-store.ts',
    media: ['filesystem'],
    persists: 2,
    named: 0,
    secretShaped: 1,
    holds: [
      {
        value: 'the sealed identity envelope — the node seed or the provider signing key',
        kind: 'sealed-secret',
        why: 'Argon2id + XChaCha20-Poly1305 with the KDF parameters recorded beside the ciphertext; `loadOrCreateSeed`, which wrote 32 raw bytes here, was deleted rather than deprecated',
        sealedBy: SEALED_SECRET_MODULE,
      },
      {
        value: 'the node certificate',
        kind: 'public-material',
        why: 'public by construction; encrypting the local copy would break offline verification while protecting nothing',
      },
    ],
  },
  {
    file: 'packages/node/src/local-acme.ts',
    media: ['filesystem'],
    persists: 1,
    named: 0,
    secretShaped: 0,
    holds: [
      {
        value: "the local ACME server's CA certificate, as PEM",
        kind: 'public-material',
        why: 'a certificate, not a key; it is written so a client can trust the test CA, and the CA private key stays in memory',
      },
    ],
  },
  {
    file: 'packages/node/src/mutation-guard.mutate.ts',
    media: ['filesystem'],
    persists: 5,
    named: 0,
    secretShaped: 0,
    holds: [
      {
        value: "repository source text — a planted mutation, its original, and the run's log",
        kind: 'not-a-secret',
        why: 'it rewrites tracked files to plant a mutation and writes them back byte-for-byte; the content is this repository’s own source',
      },
    ],
  },
  {
    file: 'packages/node/src/orphan-leash.ts',
    media: ['filesystem'],
    persists: 0,
    named: 0,
    secretShaped: 0,
    holds: [
      {
        value: 'nothing — it `fstat`s a descriptor to decide whether its parent is gone',
        kind: 'not-a-secret',
        why: 'a reader; in the register because it reaches the medium',
      },
    ],
  },
  {
    file: 'packages/node/src/reachability.ts',
    media: ['filesystem'],
    persists: 0,
    named: 0,
    secretShaped: 0,
    holds: [
      {
        value: 'nothing — it reads source files to build the call graph',
        kind: 'not-a-secret',
        why: 'a reader; in the register because it reaches the medium',
      },
    ],
  },
  {
    file: 'packages/node/src/sovereign-cids.ts',
    media: ['filesystem'],
    persists: 1,
    named: 0,
    secretShaped: 0,
    holds: [
      {
        value: 'one CID per line, appended',
        kind: 'not-a-secret',
        why: 'the list of blocks this node must refuse to send; a CID is a hash of something the owner already holds',
      },
    ],
  },
]

/**
 * A ceiling as well as a set, on `reachability-guard`'s precedent.
 *
 * The set equality below already catches an added store. The ceiling exists for the case the
 * set cannot see: somebody adding an entry to the register **and** the site to match it in one
 * change, which is exactly how a store gets added without anybody deciding it should be. A
 * raise is a decision that has to be written down.
 */
const STORE_CEILING = 50
const PERSIST_SITE_CEILING = 73

/** The register, rendered the same way the walk is, so one `toEqual` compares both. */
function declared(): readonly string[] {
  return REGISTER.map((entry) =>
    render(entry.file, {
      media: entry.media,
      persists: entry.persists,
      named: entry.named,
      secretShaped: entry.secretShaped,
    }),
  ).sort()
}

// ---------------------------------------------------------------------------
// The positive control — the walker is shown FINDING things before its
// absences are allowed to mean anything
// ---------------------------------------------------------------------------
//
// This repository has closed a criterion on an empty read and had to reopen it, and has
// watched twelve instruments stay green in one run because none of them could see the
// property it named. So the floors below are asserted BEFORE the set equality, and the
// named sites are asserted as well as the counts: a count can be met by the wrong 73 lines.

describe('the walker finds real write sites, so its silences are readings', () => {
  it('reads a corpus large enough that an empty answer would be a defect', () => {
    expect(CORPUS.length, 'the corpus is production source on three tiers').toBeGreaterThan(150)
    expect(
      [...SOURCES.values()].reduce((total, source) => total + source.length, 0),
      'the corpus is characters of real source, not a list of paths',
    ).toBeGreaterThan(1_000_000)
  })

  it('finds the sealed envelope write in identity-store.ts, by name', () => {
    const census = censusOf(SOURCES.get('packages/node/src/identity-store.ts') ?? '')
    expect(census.media).toEqual(['filesystem'])
    // Two writes: the envelope and the certificate. One of them is secret-shaped.
    expect(census.persists).toBe(2)
    expect(census.secretShaped).toBe(1)
  })

  it('finds the three artefacts this phase sealed, each at its own store', () => {
    expect(censusOf(SOURCES.get('packages/browser/src/visitor-key.ts') ?? '').secretShaped).toBe(1)
    expect(
      censusOf(SOURCES.get('packages/cloudflare/src/hosted-identity.ts') ?? '').secretShaped,
    ).toBe(2)
    expect(
      censusOf(SOURCES.get('packages/browser/src/idb-identity-store.ts') ?? '').secretShaped,
    ).toBe(2)
  })

  it('finds a named location on a file that owns no medium at all', () => {
    // `hosted-identity.ts` imports no storage API — it writes named keys into a datastore it
    // is handed. Detector 1 cannot see it and detector 3 must.
    const census = censusOf(SOURCES.get('packages/cloudflare/src/hosted-identity.ts') ?? '')
    expect(census.media).toEqual([])
    expect(census.named).toBe(2)
  })

  it('meets a floor on every detector in the same run', () => {
    const all = CORPUS.map((file) => censusOf(SOURCES.get(file) ?? ''))
    const total = (pick: (census: Census) => number): number =>
      all.reduce((sum, census) => sum + pick(census), 0)
    expect(all.filter((census) => census.media.length > 0).length).toBeGreaterThanOrEqual(25)
    expect(total((census) => census.persists)).toBeGreaterThanOrEqual(60)
    expect(total((census) => census.named)).toBeGreaterThanOrEqual(12)
    expect(total((census) => census.secretShaped)).toBeGreaterThanOrEqual(5)
  })

  it('reaches all four media that exist in this tree', () => {
    const found = new Set(CORPUS.flatMap((file) => censusOf(SOURCES.get(file) ?? '').media))
    expect([...found].sort()).toEqual([
      'durable-object-storage',
      'filesystem',
      'indexeddb',
      'web-storage',
    ])
  })
})

// ---------------------------------------------------------------------------
// The detectors separate. A matcher that matches everything is not a detector
// ---------------------------------------------------------------------------

describe('the detectors can tell a write from a sentence about one', () => {
  it('finds a write, and does not find the same text in either comment form', () => {
    expect(censusOf("await store.put(SEALED_KEY, envelope)\n").persists).toBe(1)
    expect(censusOf("// await store.put(SEALED_KEY, envelope)\n").persists).toBe(0)
    expect(censusOf("/* await store.put(SEALED_KEY, envelope) */\n").persists).toBe(0)
  })

  it('is not blinded by a comment opener inside a string literal', () => {
    // The failure `stripComments` exists to remove: the regex pair it replaced read the `/*`
    // in a string as opening a comment and deleted everything to the next closer anywhere in
    // the file — so the write below would have vanished and the file would have read clean.
    const source = "const glob = '/*.ts'\nawait store.put(SEALED_KEY, envelope)\n/** why */\n"
    expect(censusOf(source).persists).toBe(1)
    expect(censusOf(source).secretShaped).toBe(1)
  })

  it('separates a named location from a content-addressed put', () => {
    expect(censusOf('await store.put(FUNNEL_JOURNAL_KEY, encoded)\n').named).toBe(1)
    expect(censusOf('await store.put(encoded.bytes)\n').named).toBe(0)
  })

  it('separates a store write from Set.add and from TypedArray.set', () => {
    // Both are in this corpus in the dozens, and both are on actual secrets in places —
    // `seed.set(raw)` copies a real seed. Neither is a store. See the header.
    expect(censusOf('seen.add(candidate)\n').persists).toBe(0)
    expect(censusOf('seed.set(raw)\n').persists).toBe(0)
    expect(censusOf('seed.set(raw)\n').secretShaped).toBe(0)
  })

  it('reads the secret vocabulary from the ARGUMENTS, not from the line', () => {
    expect(censusOf('await store.put(SEALED_KEY, envelope)\n').secretShaped).toBe(1)
    // A seed in the receiver's name is not a value being written.
    expect(censusOf('await seedStore.get(key)\n').secretShaped).toBe(0)
  })

  it('sees the identifier forms this tree actually uses, not only bare words', () => {
    // Written with word boundaries this missed every one of these, because `_` and a
    // following capital are both word characters. It found 5 sites where there are 7.
    expect(censusOf('await tx.store.put(record, SEALED_KEY)\n').secretShaped).toBe(1)
    expect(censusOf('await tx.store.put(migrated, sealedKey)\n').secretShaped).toBe(1)
    expect(censusOf('await store.put(SEALED_HOSTED_IDENTITY_KEY, envelope)\n').secretShaped).toBe(1)
  })

  it('does not report a file that stores nothing', () => {
    const census = censusOf('export function add(a: number, b: number): number {\n  return a + b\n}\n')
    expect(isStore(census)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// The derived case — declare it or be flagged
// ---------------------------------------------------------------------------

describe('the register describes the tree, or it reddens', () => {
  it('names every store the walk finds, and nothing the walk does not', () => {
    // Extra lines on the left are a store or a value nobody classified. Extra lines on the
    // right are a register that has stopped describing the tree. Both are findings, and the
    // diff names the file and which detector moved.
    expect(walk()).toEqual(declared())
  })

  it('cannot grow silently past its stated size', () => {
    expect(
      REGISTER.length,
      `the register holds ${String(REGISTER.length)} stores against a ceiling of ${String(STORE_CEILING)}. ` +
        'A HIGHER number means a new persistent store arrived. Raising this is a decision, not a fix.',
    ).toBeLessThanOrEqual(STORE_CEILING)
    expect(
      REGISTER.reduce((total, entry) => total + entry.persists, 0),
      `the tree holds write sites against a ceiling of ${String(PERSIST_SITE_CEILING)}`,
    ).toBeLessThanOrEqual(PERSIST_SITE_CEILING)
  })

  it('gives every store at least one declared value, with a stated reason', () => {
    const thin = REGISTER.filter(
      (entry) =>
        entry.holds.length === 0 ||
        entry.holds.some((thing) => thing.value.length < 8 || thing.why.length < 20),
    ).map((entry) => entry.file)
    expect(thin, 'these entries declare a store without saying what it holds or why').toEqual([])
  })

  it('classifies every value as one of the four, and no other word', () => {
    const classes: readonly SecretClass[] = [
      'sealed-secret',
      'public-material',
      'not-a-secret',
      'plaintext-secret-by-design',
    ]
    const wrong = REGISTER.flatMap((entry) =>
      entry.holds
        .filter((thing) => !classes.includes(thing.kind))
        .map((thing) => `${entry.file}: ${thing.kind}`),
    )
    expect(wrong).toEqual([])
  })

  it('names one file per entry, each of them tracked and in the corpus', () => {
    const files = REGISTER.map((entry) => entry.file)
    expect(new Set(files).size, 'a file declared twice would split its own counts').toBe(
      files.length,
    )
    expect(files.filter((file) => !SOURCES.has(file))).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// The two claims that are NOT left to prose
// ---------------------------------------------------------------------------
//
// Everything above pins the SHAPE of the tree. A `kind` is a human reading, and a wrong one
// is worse than no guard — this phase exists because one such claim, *"`exportKey` fails on
// it, so there is nothing at rest to encrypt"*, was believed for weeks. Two of the four
// classes carry a claim a machine can check, and those two are checked here.

describe('a value declared sealed names the module that seals it', () => {
  const sealed = REGISTER.flatMap((entry) =>
    entry.holds.filter((thing) => thing.kind === 'sealed-secret').map((thing) => ({ entry, thing })),
  )

  it('has sealed values to check at all', () => {
    expect(sealed.length, 'four artefacts on three tiers are sealed').toBeGreaterThanOrEqual(4)
  })

  it('gives every sealed value a sealing module that exists and seals', () => {
    const unbacked = sealed
      .filter(({ thing }) => {
        const by = thing.sealedBy
        if (by === undefined) return true
        if (!TRACKED.includes(by)) return true
        return !SEALING_CALLS.test(stripComments(sourceOf(by)))
      })
      .map(({ entry, thing }) => `${entry.file}: ${thing.value}`)
    expect(unbacked, 'these claim to be sealed and name no module that does it').toEqual([])
  })

  it('is a predicate that separates — a store with no sealing does not satisfy it', () => {
    // Without this the case above would pass on any file at all, which is how an instrument
    // stays green while seeing nothing.
    expect(
      SEALING_CALLS.test(stripComments(sourceOf('packages/node/src/fs-blockstore.ts'))),
      'fs-blockstore seals nothing and must not read as though it does',
    ).toBe(false)
    expect(SEALING_CALLS.test(stripComments(sourceOf(SEALED_SECRET_MODULE)))).toBe(true)
  })

  it('leaves sealedBy off every value that is not sealed', () => {
    const stray = REGISTER.flatMap((entry) =>
      entry.holds
        .filter((thing) => thing.kind !== 'sealed-secret' && thing.sealedBy !== undefined)
        .map((thing) => `${entry.file}: ${thing.value}`),
    )
    expect(stray).toEqual([])
  })
})

describe('a plaintext secret written on purpose is reachable only from tests', () => {
  const deliberate = REGISTER.filter((entry) =>
    entry.holds.some((thing) => thing.kind === 'plaintext-secret-by-design'),
  )

  it('has exactly the one this repository knows about', () => {
    expect(deliberate.map((entry) => entry.file)).toEqual([
      'packages/node/src/e2e-browser-launch.ts',
    ])
  })

  /** Every tracked module that imports the module at `file`, by its relative specifier. */
  function importersOf(file: string): readonly string[] {
    const specifier = `from './${file.split('/').pop() ?? ''}'`
    return TRACKED.filter((path) => /\.(?:ts|mts|js|mjs)$/.test(path))
      .filter((path) => path !== file)
      .filter((path) => stripComments(sourceOf(path)).includes(specifier))
  }

  it('is imported by nothing that is not a test', () => {
    const wrong = deliberate.flatMap((entry) =>
      importersOf(entry.file)
        .filter((path) => !path.endsWith('.test.ts'))
        .map((path) => `${path} imports ${entry.file}`),
    )
    expect(wrong, 'a deliberate plaintext secret has reached a non-test path').toEqual([])
  })

  it('finds the importers it is meant to find', () => {
    // The absence above is only a reading if the same search finds the specs that DO import
    // it. Three do — and without this, a specifier typo would make the guard read clean.
    for (const entry of deliberate) {
      expect(importersOf(entry.file).length, `nothing imports ${entry.file}`).toBeGreaterThanOrEqual(
        3,
      )
    }
  })
})

// ---------------------------------------------------------------------------
// The jurisdiction's own edge, checked rather than argued
// ---------------------------------------------------------------------------

describe('the excluded trees are excluded on a claim that is re-derived', () => {
  it('finds no key material written anywhere under tools/', () => {
    // `tools/` is a build-time toolchain: eleven of its sixteen files touch the filesystem,
    // and none of them writes a secret. That is the reason it is out of jurisdiction, so it
    // is measured on every run rather than asserted once in a docblock. If this fails, widen
    // CORPUS — do not widen the excuse.
    const offenders = trackedSources('tools/')
      .map((path) => [path, censusOf(sourceOf(path))] as const)
      .filter(([, census]) => census.secretShaped > 0)
      .map(([path]) => path)
    expect(offenders).toEqual([])
  })

  it('proves that search could have found one, on the same corpus', () => {
    // The absence above needs a positive control, or it passes just as well on an empty read.
    const writers = trackedSources('tools/').filter(
      (path) => censusOf(sourceOf(path)).persists > 0,
    )
    expect(writers.length, 'tools/ does write files — it just never writes a key').toBeGreaterThan(
      0,
    )
  })
})

// ---------------------------------------------------------------------------
// No byte is rendered through `String`, because no byte is held
// ---------------------------------------------------------------------------

describe('this guard never holds a byte', () => {
  // Assembled from fragments, deliberately: written whole, this file's own source would
  // contain the names it scans for and the scan would report itself. `trust-anchors.node.test.ts`
  // does the same thing with its opt-out literal and for the same reason.
  const READ_CALL = 'readFile' + 'Sync('
  const BYTE_APIS: readonly string[] = [
    'Buf' + 'fer',
    'TextDec' + 'oder',
    'TextEnc' + 'oder',
    'Uint8' + 'Array',
  ]
  const OWN = stripComments(readFileSync(fileURLToPath(import.meta.url), 'utf8'))

  it('decodes every source it reads as text at the read, never afterwards', () => {
    const reads = OWN.split('\n').filter((line) => line.includes(READ_CALL))
    // Two: the memoised reader every case goes through, and this block's read of its own
    // source. It was four before the reads were hoisted, and this floor caught the change —
    // which is what a floor is for.
    expect(reads.length, 'the guard does read files').toBeGreaterThanOrEqual(2)
    expect(
      reads.filter((line) => !line.includes("'utf8'")),
      'a read without an encoding returns bytes, and then something has to render them',
    ).toEqual([])
  })

  it('names no API that would produce a byte to render', () => {
    // `String(n)` on a NUMBER appears in the renderers above and is fine — the requirement is
    // that no BYTE is rendered through it, and the way this guard meets that is by never
    // having one. If any of these ever appears here, that stops being true.
    const present = BYTE_APIS.filter((api) => OWN.includes(api))
    expect(present, 'this guard would then be holding bytes it has to render').toEqual([])
  })
})
