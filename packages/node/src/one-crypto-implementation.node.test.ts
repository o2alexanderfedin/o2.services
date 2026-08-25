/**
 * Two source-level guards over the comment-stripped production tree.
 *
 * # The finding this file exists to hold: **Ed25519 signature bytes are not a stable
 * identifier in this fabric.**
 *
 * RFC 8032 defines one canonical deterministic nonce derivation but does not require
 * every conforming implementation to use exactly it; some harden against fault attacks
 * with a synthetic/hedged nonce instead. Measured in this repository, not read from a
 * specification — `packages/core/src/cert-lifecycle.ts:47-70` and
 * `packages/core/src/cert-lifecycle.browser.test.ts:79-88` record that Node, chromium
 * and firefox's `subtle` produced signatures byte-identical to `@noble/curves`' over the
 * same seed and message, and **WebKit's did not**: a different, equally valid signature,
 * verified successfully by both arms. X25519 agreement *is* byte-identical everywhere,
 * because it is plain scalar multiplication with no randomness in it — that contrast is
 * what stops the finding reading as "the two arms disagree in general".
 *
 * The consequence is a correctness fault with a nasty shape: **anything that dedupes,
 * caches, keys or compares attestations by signature bytes is green in Node and in CI
 * and broken in Safari.** Until Phase 28 the finding was prose in two docblocks and
 * nothing prevented a caller from doing exactly that.
 *
 * The behavioural half of the guard lives in
 * `packages/core/src/ed25519-backend.test.ts`'s
 * `cross-arm signing is mutually verifiable, never byte-identical (CRYPTO-06)` block,
 * which asserts mutual verifiability in all four directions across four seeds on
 * chromium, firefox and webkit and deliberately asserts byte-equality in neither
 * direction. **This file is the source-level half**: it reads the tree and refuses the
 * construct.
 *
 * # Why two blocks in one file
 *
 * Both read the same corpus, computed once at module scope, and both are claims about
 * *how many* of something the production tree contains. Block 1 (CRYPTO-01) says exactly
 * one production file performs WebCrypto Ed25519 operations. Block 2 (CRYPTO-06) says no
 * production file treats signature bytes as an identifier except one registered,
 * reasoned exception.
 *
 * # Neither block can pass by reading nothing
 *
 * This is the failure mode a source-scanning guard actually has, and this repository has
 * paid for it: `strip-comments.ts`'s docblock records a regex pair that deleted 20 432
 * characters of non-comment text across 33 files, under which `requirements-ledger`'s
 * rows claiming "nothing calls X" passed *because the caller had been deleted before the
 * scan saw it*. So each block here carries a **live positive** it must find:
 *
 * - Block 1 must find `packages/core/src/ed25519-backend.ts`, by path.
 * - Block 2 must find `tools/aot/cli.ts`'s one registered comparison.
 *
 * A blinded scan reports zero for both and both go red.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { stripComments } from './strip-comments.ts'

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))

// ---------------------------------------------------------------------------
// The production corpus — assembled the way `requirements-ledger.node.test.ts`
// assembles its own, and read once so both blocks below see the same bytes.
// ---------------------------------------------------------------------------

/**
 * Directories that hold no source. `node_modules` in particular is fatal to walk: in a
 * git worktree it is a tree of symlinks into another checkout, and following it would
 * make this file report on code that is not the code under test.
 */
const SKIP_DIRS: readonly string[] = ['node_modules', '.git', 'dist', 'coverage', '.vite']

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.includes(entry)) continue
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) walk(path, out)
    else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) out.push(path)
  }
  return out
}

/**
 * Whether a repo-relative path is production TypeScript.
 *
 * **One deliberate departure from `requirements-ledger.node.test.ts:224-229`: barrels are
 * NOT excluded here.** That file excludes `index.ts` because a barrel's every statement
 * is `export … from`, so a symbol appearing in one says the package publishes it and
 * never that anything *calls* it — an argument about call sites, which is that guard's
 * subject and not this one's. Neither claim here is about calls. A hand-written
 * signature comparison inside a barrel would be a real finding, and excluding barrels
 * would let it through for a reason that does not apply. Measured cost of including
 * them, 2026-08-10: eight extra files, zero extra findings in either block after
 * stripping.
 *
 * This file is itself under `packages/node/src/` and is excluded by the `.test.ts` rule,
 * which matters more than it looks: the inline fixtures below contain every construct
 * both blocks refuse, and a corpus that included them would be permanently red.
 */
function isProductionPath(relative: string): boolean {
  if (!relative.endsWith('.ts') || relative.endsWith('.d.ts')) return false
  if (relative.endsWith('.test.ts')) return false
  return relative.startsWith('packages/') || relative.startsWith('tools/')
}

const PRODUCTION: readonly string[] = [...walk(join(ROOT, 'packages')), ...walk(join(ROOT, 'tools'))]
  .filter((path) => isProductionPath(path.slice(ROOT.length)))
  .sort()

/**
 * `[repo-relative path, comment-stripped source]`, computed once.
 *
 * {@link stripComments} is the one comment stripper every source-scanning guard in this
 * repository uses, and here it is **load-bearing rather than tidy** — see Block 1's
 * planted-mutation proof, which disables it and watches this file go red naming three
 * files that contain no such call.
 */
const CORPUS: readonly (readonly [string, string])[] = PRODUCTION.map(
  (path) => [path.slice(ROOT.length), stripComments(readFileSync(path, 'utf8'))] as const,
)

/** Repo-relative paths, for containment assertions. */
const CORPUS_PATHS: readonly string[] = CORPUS.map(([path]) => path)

describe('the corpus is the real tree', () => {
  /**
   * The anti-vacuity floor for everything below. Both blocks are absence-shaped claims,
   * and an absence-shaped claim over an empty corpus is satisfied trivially. Read
   * 2026-08-10: 153 production files (145 with barrels excluded). The floor is set well
   * under that so an unrelated deletion does not redden it, and well over zero so a walk
   * that silently found nothing does.
   */
  it('walks a corpus of production files, not an empty list', () => {
    expect(CORPUS.length, `production corpus was ${CORPUS.length} files`).toBeGreaterThan(100)
  })

  /**
   * Anti-vacuity: an absence-shaped claim about a file the walk never reached is satisfied for
   * the wrong reason, so the files the blocks below name must be shown to be in the corpus.
   *
   * > **2026-08-24 — two files, not three.** `packages/core/src/cert-lifecycle.ts` was deleted
   * > by owner ruling (one certificate system, not two), so there is no file to require. The
   * > blocks below still *mention* it in their recorded readings, and those are left standing:
   * > they are measurements of a tree that existed on the day they were taken, and rewriting
   * > them would make a past reading claim something it never measured.
   */
  it('contains the files the two blocks below make claims about', () => {
    expect(CORPUS_PATHS).toContain('packages/core/src/ed25519-backend.ts')
    expect(CORPUS_PATHS).toContain('tools/aot/cli.ts')
    // And the deleted one really is gone, so a resurrection is reported here rather than
    // quietly widening the block below.
    expect(CORPUS_PATHS).not.toContain('packages/core/src/cert-lifecycle.ts')
  })

  it('excludes this file and every other spec, so the fixtures below are not scanned', () => {
    expect(CORPUS_PATHS.filter((path) => path.endsWith('.test.ts'))).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Block 1 — CRYPTO-01: one WebCrypto Ed25519 implementation
// ---------------------------------------------------------------------------

/**
 * The WebCrypto Ed25519 algorithm-name form, as it is actually written at a call site:
 * `subtle.importKey('jwk', jwk, { name: 'Ed25519' }, …)`,
 * `subtle.sign({ name: 'Ed25519' }, …)`, `subtle.generateKey({ name: 'Ed25519' }, …)`.
 *
 * ## Why not the bare string `'Ed25519'`
 *
 * Deliberately not, and this is the difference between a guard and a nuisance. The bare
 * string appears at `packages/libp2p/src/identity.ts:110` and `:180`,
 * `packages/libp2p/src/audience-key.ts:77` and `packages/node/src/fabric-node.ts:1933`
 * as a **libp2p key-type name** — a different thing entirely, nothing to do with
 * WebCrypto. A guard keyed on the bare string is red on day one for a reason unrelated
 * to this phase, and a guard that is red for the wrong reason gets deleted.
 */
const WEBCRYPTO_ED25519 = /\{\s*name:\s*['"]Ed25519['"]/

/**
 * The one production file allowed to perform WebCrypto Ed25519 operations.
 *
 * Asserted as a **set of paths, not a count**, so a future second implementation is
 * reported by name rather than as `expected 2 to be 1`.
 */
const ONE_WEBCRYPTO_IMPLEMENTATION: readonly string[] = ['packages/core/src/ed25519-backend.ts']

/**
 * libsodium's detached-verify entry point, named by API rather than by package.
 *
 * Phase 28 Plan 28-02 removed `libsodium-wrappers` from the manifest, the lockfile and
 * `node_modules`, and guards that removal at the supply-chain and bundle level in
 * `libsodium-absence.e2e.test.ts`. This is the source-level complement: a
 * re-introduction vendored under some other package name still has to call this
 * function, so the API name catches what a package name would miss.
 */
const LIBSODIUM_VERIFY = 'crypto_sign_verify_detached'

function filesMatching(pattern: RegExp): readonly string[] {
  return CORPUS.filter(([, source]) => pattern.test(source)).map(([path]) => path)
}

describe('CRYPTO-01 — exactly one production file performs WebCrypto Ed25519 operations', () => {
  /**
   * ## The reading, before and after the merge
   *
   * Pre-merge (2026-08-10, recorded in 28-03-PLAN.md's `<interfaces>` from the tree as
   * it stood before Plan 28-01), over comment-stripped production source:
   *
   * | File | Hits |
   * |---|---|
   * | `packages/core/src/cert-lifecycle.ts` | 5 — `:523`, `:524`, `:529`, `:530`, `:568` |
   * | `packages/core/src/ed25519-backend.ts` | 2 — `:153`, `:158` |
   * | `packages/libp2p/src/identity.ts` | 1 at `:70`, **inside a docblock** |
   *
   * Post-merge, re-taken by this guard 2026-08-10 rather than trusted: **one file,
   * `packages/core/src/ed25519-backend.ts`, five hits — `:222`, `:223`, `:228`, `:229`,
   * `:281`.** Two `importKey`/`sign` pairs on the subtle arm plus the surviving
   * `generateKey` capability probe. `cert-lifecycle.ts` reads zero after stripping: the
   * block moved, and what remains there is a comment about the move.
   *
   * ## The planted-mutation proof, watched red — `stripComments` is load-bearing
   *
   * `stripComments(readFileSync(path, 'utf8'))` was replaced by `readFileSync(path,
   * 'utf8')` — one line, in this file, touching no production source — and this case
   * watched fail. Verbatim, `--project node`, 2026-08-10, exit 1:
   *
   * ```
   *  FAIL  |node| packages/node/src/one-crypto-implementation.node.test.ts > CRYPTO-01 — exactly one production file performs WebCrypto Ed25519 operations > the matching set is exactly one file, named by path
   * AssertionError: expected [ …(4) ] to deeply equal [ Array(1) ]
   *
   * - Expected
   * + Received
   *
   *   [
   * +   "packages/core/src/cert-lifecycle.ts",
   *     "packages/core/src/ed25519-backend.ts",
   * +   "packages/core/src/index.ts",
   * +   "packages/libp2p/src/identity.ts",
   *   ]
   *
   *  ❯ packages/node/src/one-crypto-implementation.node.test.ts:218:46
   *
   *  Test Files  1 failed (1)
   *       Tests  1 failed | 23 passed (24)
   * ```
   *
   * **Three extra files, and not one of them contains such a call.**
   * `packages/libp2p/src/identity.ts:70` is the docblock the plan predicted;
   * `packages/core/src/cert-lifecycle.ts:453` and `packages/core/src/index.ts:390` are
   * two more comments, both written by Plan 28-01 to record *where the block moved to*.
   * An unstripped scan therefore reports **four** WebCrypto Ed25519 implementations in a
   * tree that has one, and the newest three of those false reports were created by the
   * very phase this guard closes. That is why `stripComments` is load-bearing here rather
   * than tidy.
   *
   * Restored by the surgical inverse of that one-line edit and `cmp`-verified
   * byte-identical against a snapshot taken immediately before planting.
   */
  it('the matching set is exactly one file, named by path', () => {
    expect(filesMatching(WEBCRYPTO_ED25519)).toEqual(ONE_WEBCRYPTO_IMPLEMENTATION)
  })

  /**
   * The live positive. `toEqual` against a one-element array would also be satisfied by
   * a scan that found that one file for a spurious reason, but not by one that found
   * nothing — this case makes the "it really is in there, several times" half explicit
   * rather than implied.
   */
  it('and that file really carries the form — the scan is not matching on emptiness', () => {
    const source = CORPUS.find(([path]) => path === 'packages/core/src/ed25519-backend.ts')?.[1]
    expect(source, 'the one WebCrypto implementation must be in the corpus').toBeDefined()
    const hits = (source ?? '').split('\n').filter((line) => WEBCRYPTO_ED25519.test(line)).length
    expect(hits, 'read 2026-08-10: five call sites in ed25519-backend.ts').toBeGreaterThanOrEqual(2)
  })

  it("no production file names libsodium's verify entry point", () => {
    expect(filesMatching(new RegExp(LIBSODIUM_VERIFY))).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Block 2 — CRYPTO-06: signature bytes are not an identifier
// ---------------------------------------------------------------------------

/** One construct that treats a signature value as an identity. */
interface Finding {
  readonly file: string
  readonly line: number
  readonly kind: 'equality' | 'keyed' | 'conversion-key'
  /** The matched expression, whitespace-collapsed. This is the register's anchor. */
  readonly text: string
}

/**
 * An operand of an equality: a quoted string literal, or a dotted/indexed identifier
 * path. Numeric literals are deliberately absent — `signatureCount === 3` is arithmetic,
 * not identity, and is not raised at all.
 */
const OPERAND = String.raw`(?:'[^']*'|"[^"]*"|[A-Za-z_$][\w$.?!\[\]]*)`

/**
 * Whether an operand names a signature.
 *
 * Two forms. `signature` in any casing of the capital is the obvious one. `sig` followed
 * by a capital or a digit — `sigA`, `sigB`, `sig1` — is the camel-case abbreviation, and
 * it is included so the abbreviated comparison `sigA === sigB` is caught rather than
 * being a hole anybody could walk through by renaming a variable. It is **not** widened
 * to a bare `sig` stem, which would fire on `sign`, `signer`, `signed` and `signal`.
 *
 * Measured 2026-08-10: the tree contains exactly three `sig[A-Z]` identifiers, all
 * `sigNode` in `packages/core/src/x509.ts:912`/`:924`/`:927`, and none of them is an
 * identifier-against-identifier comparison — so this form costs zero live findings today
 * and is a guard against a rename, not a description of anything present.
 */
const NAMES_A_SIGNATURE = /[sS]ignature|\bsig[A-Z0-9]/

const EQUALITY = new RegExp(String.raw`(${OPERAND})\s*(===|!==)\s*(${OPERAND})`, 'g')

/** A quoted string literal, which is what exclusion rule (b) tests each operand for. */
const QUOTED_LITERAL = /^['"]/

/** Calls that key a collection by their first argument. */
const KEYING_CALLS: readonly string[] = ['.set(', '.add(', '.has(', '.get(', '.delete(', 'new Map(', 'new Set(']

/**
 * A computed key whose expression converts a signature — `[toHex(signature)]`,
 * `` [`${signature}`] ``.
 *
 * Narrow on purpose. A bare "computed expression mentioning signature" arm raises five
 * live lines, measured 2026-08-10, none of which is an identity:
 * `value['signature']` (`naming.ts:131`) and `record['signature']`
 * (`protocol.ts:382`) are property reads by a quoted key, `[entry.signature]`
 * (`mutation-ledger.ts:3172`) is an array literal, and two `caughtBy:` entries are
 * arrays of filenames. Five register entries for zero hazards is how a register stops
 * being read.
 */
const CONVERSION_KEY = new RegExp(
  String.raw`\[\s*(?:\x60[^\x60]*\$\{[^}]*[sS]ignature[^}]*\}[^\x60]*\x60|(?:toHex|toString|toBase64Url|base64|btoa)\s*\([^)]*[sS]ignature[^)]*\))\s*\]`,
)

/**
 * The first argument of a call whose opening parenthesis is at `open`, extracted with a
 * depth counter so `toHex(signature)` is not truncated at its own parenthesis.
 */
function firstArgumentAt(line: string, open: number): string {
  let depth = 0
  for (let i = open; i < line.length; i++) {
    const character = line.charAt(i)
    if (character === '(' || character === '[' || character === '{') depth++
    else if (character === ')' || character === ']' || character === '}') {
      depth--
      if (depth === 0) return line.slice(open + 1, i)
    } else if (character === ',' && depth === 1) return line.slice(open + 1, i)
  }
  return line.slice(open + 1)
}

/**
 * Every construct in one file that treats a signature value as an identity.
 *
 * Three arms and two exclusions, each of the exclusions written for lines that are
 * really in this tree rather than for hypotheticals:
 *
 * - **(a) the line contains `typeof`** — `packages/net/src/protocol.ts:310`, `:383`,
 *   `:615`, `:815`, `:841` are all `typeof signature !== 'string'`, five type guards
 *   over a decoded wire field. A type guard asks what kind of value arrived; it does not
 *   compare bytes.
 * - **(b) either operand is a quoted string literal** —
 *   `packages/node/src/mutation-ledger.ts:3084`
 *   (`entry.signatureSource === 'test-title'`) and `:3147`
 *   (`entry.signatureSource === 'rendered-at-runtime'`) compare a **discriminant** to a
 *   literal, and `packages/net/src/reduce-job.ts:286`
 *   (`trustedIssuers === 'checks-no-combine-signatures'`) is raised only because the
 *   literal happens to contain the word. None is a byte comparison.
 *
 * Both exclusions have named negative fixtures below, so a later tightening of a pattern
 * cannot quietly start reporting them.
 *
 * Exported as a named function rather than inlined into the scan so the fixtures can
 * drive it directly — the matcher is proved able to report before any live reading of it
 * is believed, which is the discipline `libsodium-absence.e2e.test.ts` established after
 * a crippled matcher there passed 8 of 9 cases vacuously.
 */
export function findSignatureIdentityConstructs(file: string, stripped: string): readonly Finding[] {
  const findings: Finding[] = []
  const lines = stripped.split('\n')

  lines.forEach((line, index) => {
    const lineNumber = index + 1

    // --- arm 1: equality between two operands, one of which names a signature ---
    // Exclusion (a) is line-scoped on purpose: `typeof a !== 'string' || typeof
    // signature !== 'string'` is one guard written on one line, and scoping the rule to
    // the operand would report half of it.
    const isTypeGuard = /\btypeof\b/.test(line)
    for (const match of line.matchAll(EQUALITY)) {
      const left = match[1] ?? ''
      const operator = match[2] ?? ''
      const right = match[3] ?? ''
      if (!NAMES_A_SIGNATURE.test(left) && !NAMES_A_SIGNATURE.test(right)) continue
      if (isTypeGuard) continue
      // Exclusion (b): a comparison against a quoted literal is a discriminant check,
      // never a byte comparison — bytes are not string literals in this codebase.
      if (QUOTED_LITERAL.test(left) || QUOTED_LITERAL.test(right)) continue
      findings.push({ file, line: lineNumber, kind: 'equality', text: `${left} ${operator} ${right}` })
    }

    // --- arm 2: a collection keyed, or membership-tested, by a signature ---
    for (const call of KEYING_CALLS) {
      let at = line.indexOf(call)
      while (at !== -1) {
        const argument = firstArgumentAt(line, at + call.length - 1)
        if (NAMES_A_SIGNATURE.test(argument)) {
          findings.push({
            file,
            line: lineNumber,
            kind: 'keyed',
            text: `${call.trim()}${argument.trim()})`.replace(/\s+/g, ' '),
          })
        }
        at = line.indexOf(call, at + 1)
      }
    }

    // --- arm 3: a converted signature used as a computed key ---
    const conversion = CONVERSION_KEY.exec(line)
    if (conversion !== null) {
      findings.push({ file, line: lineNumber, kind: 'conversion-key', text: conversion[0].replace(/\s+/g, ' ') })
    }
  })

  return findings
}

// --- the matcher's own fixtures, before any live reading is believed ---

describe('findSignatureIdentityConstructs — proved against fixtures first', () => {
  const find = (source: string): readonly Finding[] => findSignatureIdentityConstructs('fixture.ts', source)

  describe('positives', () => {
    it('an inequality between two signature values — the real shape at tools/aot/cli.ts:314', () => {
      const findings = find('if (readBack.signature !== record.signature) {\n')
      expect(findings.map((one) => one.kind)).toEqual(['equality'])
      expect(findings[0]?.text).toBe('readBack.signature !== record.signature')
      expect(findings[0]?.line).toBe(1)
    })

    it('an equality between two abbreviated signature identifiers', () => {
      const findings = find('const same = sigA === sigB\n')
      expect(findings.map((one) => one.kind)).toEqual(['equality'])
      expect(findings[0]?.text).toBe('sigA === sigB')
    })

    it('a Map keyed by a converted signature', () => {
      const findings = find('const seen = new Map<string, Attestation>()\nseen.set(toHex(signature), attestation)\n')
      expect(findings.map((one) => one.kind)).toEqual(['keyed'])
      expect(findings[0]?.line).toBe(2)
    })

    it('a Set membership test on signature bytes', () => {
      const findings = find('if (seen.has(signatureHex)) return null\n')
      expect(findings.map((one) => one.kind)).toEqual(['keyed'])
    })

    it('a converted signature used as a computed object key', () => {
      const findings = find('const index = { [toHex(signature)]: record }\n')
      expect(findings.map((one) => one.kind)).toEqual(['conversion-key'])
    })
  })

  describe('negatives — each one a shape this tree really contains', () => {
    it("does NOT match protocol.ts's typeof type guard", () => {
      expect(find("if (typeof signature !== 'string') return null\n")).toEqual([])
    })

    it("does NOT match protocol.ts's two-clause typeof type guard", () => {
      expect(find("if (typeof nodeKey !== 'string' || typeof signature !== 'string') return null\n")).toEqual([])
    })

    it("does NOT match mutation-ledger.ts's discriminant-against-literal check", () => {
      expect(find("(entry) => entry.signatureSource === 'test-title',\n")).toEqual([])
      expect(find("if (entry.signatureSource === 'rendered-at-runtime') {\n")).toEqual([])
    })

    it('does NOT match reduce-job.ts, raised only because a literal contains the word', () => {
      expect(find("if (trustedIssuers === 'checks-no-combine-signatures') return false\n")).toEqual([])
    })

    it('does NOT match arithmetic on a count of signatures', () => {
      expect(find('if (signatureCount === 3) return true\n')).toEqual([])
    })

    it('does NOT match a property read by a quoted key', () => {
      expect(find("const signature = value['signature']\n")).toEqual([])
    })

    it('does NOT match sign/signer/signed, which are not abbreviations of signature', () => {
      expect(find('if (signer === issuer) return true\n')).toEqual([])
      expect(find('if (signed === expected) return true\n')).toEqual([])
    })
  })
})

// --- the register, and the live reading ---

/** One reasoned exception to "signature bytes are not an identifier". */
interface AcceptedComparison {
  /** Repo-relative path. */
  readonly file: string
  /**
   * The matched expression, whitespace-collapsed — **the anchor is the source text, not
   * a line number**, so an unrelated edit above it does not invalidate the register.
   */
  readonly text: string
  readonly reason: string
}

/**
 * The register. One entry today.
 *
 * Shape copied from `packages/node/src/reachability-dispositions.ts:200-252`
 * (`DISPOSITIONS` plus `DISPOSITION_CEILING`), including its anti-vacuity note.
 */
const ACCEPTED_SIGNATURE_COMPARISONS: readonly AcceptedComparison[] = [
  {
    file: 'tools/aot/cli.ts',
    text: 'readBack.signature !== record.signature',
    reason:
      'A serialisation-fidelity check, not an identity. `publishArtifact` signs a name record, ' +
      'encodes it with `encodeNameRecord`, decodes it straight back with `decodeNameRecord`, and ' +
      'asserts the round trip preserved both the CID and the signature — one engine, one signing ' +
      'operation, one value, inside one process. The WebKit hedged-nonce finding cannot reach it: ' +
      'there is no second engine and no second signing operation for it to differ from. Were this ' +
      'comparison instead made against a signature produced elsewhere, it would be exactly the ' +
      'hazard this guard refuses.',
  },
]

/**
 * How large the register may grow before something reddens.
 *
 * Set to **exactly one above** the register's current size, so a genuinely-forced second
 * exception lands and a third has to argue for itself in a commit that also raises this.
 *
 * The failure mode a ceiling has is on record here: **19-12 found the mutation ledger's
 * floor stale at 23 while the ledger held 42, and nothing said so.** A ceiling with slack
 * in it stops binding, which is why this is `size + 1` rather than a round number, and
 * why the both-directions equality below does the real work — a ceiling alone cannot
 * catch a register entry that has gone stale.
 */
const SIGNATURE_COMPARISON_CEILING = 2

/** `file::text`, the key both sides of the set equality are compared on. */
function keyOf(one: { readonly file: string; readonly text: string }): string {
  return `${one.file}::${one.text}`
}

/**
 * ## Both directions of the set equality, each watched red — 2026-08-10, `--project node`
 *
 * A one-directional check would let the register rot in whichever direction it did not
 * look, so both were planted. Both plants live inside this file; no production source
 * was touched. Each was restored by the surgical inverse of its own edit and
 * `cmp`-verified byte-identical against a snapshot taken immediately before it.
 *
 * ### Direction 1 — an unregistered finding fails
 *
 * Exclusion (b) was disabled (`if (false && (QUOTED_LITERAL.test(left) || …)) continue`),
 * which makes three real discriminant-against-literal lines read as findings. **4 failed
 * | 20 passed**, and the two exclusion fixtures reddened alongside the live scan:
 *
 * ```
 * AssertionError: these treat signature bytes as an identity and are not in the register: expected [ …(3) ] to deeply equal []
 * + [
 * +   "packages/net/src/reduce-job.ts::trustedIssuers === 'checks-no-combine-signatures'",
 * +   "packages/node/src/mutation-ledger.ts::entry.signatureSource === 'rendered-at-runtime'",
 * +   "packages/node/src/mutation-ledger.ts::entry.signatureSource === 'test-title'",
 * + ]
 * ```
 *
 * That plant doubles as the proof that **exclusion (b) is load-bearing on the real tree**
 * and not defensive decoration. Exclusion (a) is not independently load-bearing here and
 * this is said rather than implied: all five `typeof signature !== 'string'` lines in
 * `protocol.ts` are *also* caught by (b), because `'string'` is a quoted literal. (a) is
 * held by its two fixtures alone, and it keeps its place by naming the intent — a type
 * guard is not a byte comparison — so a future rewrite of (b) does not silently take
 * five type guards with it.
 *
 * ### Direction 2 — a stale register entry fails
 *
 * The register's anchor text was changed to `record.signatureBytes`, an expression the
 * tree does not contain. **3 failed | 21 passed**:
 *
 * ```
 * AssertionError: the register may not carry a permission the live scan no longer finds: expected [ Array(1) ] to deeply equal []
 * + [
 * +   "tools/aot/cli.ts::readBack.signature !== record.signatureBytes",
 * + ]
 * ```
 *
 * Both directions plus the `toEqual` reddened on that one, which is the intended
 * over-reporting: a stale entry is simultaneously a permission for nothing and a real
 * finding left unregistered.
 */

describe('CRYPTO-06 — signature bytes are not an identifier outside the register', () => {
  const live: readonly Finding[] = CORPUS.flatMap(([path, source]) => findSignatureIdentityConstructs(path, source))
  const liveKeys = [...new Set(live.map(keyOf))].sort()
  const registerKeys = [...new Set(ACCEPTED_SIGNATURE_COMPARISONS.map(keyOf))].sort()

  /**
   * The live positive, and it is the reason this block cannot pass by reading nothing.
   * `tools/aot/cli.ts:314` is a real match in the real tree; a blinded scan finds zero
   * and this case is the one that says so.
   */
  it('the scan found the one construct this tree really contains', () => {
    expect(live.length, `live findings: ${JSON.stringify(liveKeys)}`).toBeGreaterThanOrEqual(1)
    expect(liveKeys).toContain('tools/aot/cli.ts::readBack.signature !== record.signature')
  })

  it('no unregistered construct — a new one is a finding, not a fact', () => {
    const unregistered = liveKeys.filter((key) => !registerKeys.includes(key))
    expect(unregistered, 'these treat signature bytes as an identity and are not in the register').toEqual([])
  })

  it('no stale register entry — a permission for something already gone fails too', () => {
    const stale = registerKeys.filter((key) => !liveKeys.includes(key))
    expect(stale, 'the register may not carry a permission the live scan no longer finds').toEqual([])
  })

  it('the live set and the register are the same set', () => {
    expect(liveKeys).toEqual(registerKeys)
  })

  it('every register entry states its reason', () => {
    for (const entry of ACCEPTED_SIGNATURE_COMPARISONS) {
      expect(entry.reason.length, `${entry.file} needs a reason, not a note`).toBeGreaterThan(80)
    }
  })

  it('the register is exactly one below its ceiling', () => {
    expect(ACCEPTED_SIGNATURE_COMPARISONS.length).toBeLessThanOrEqual(SIGNATURE_COMPARISON_CEILING)
    expect(
      SIGNATURE_COMPARISON_CEILING,
      'the ceiling is sited at size + 1 — slack in it is how a ceiling stops binding',
    ).toBe(ACCEPTED_SIGNATURE_COMPARISONS.length + 1)
  })
})
