import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { stripComments } from './strip-comments.ts'

/**
 * The sequencing guard for `CapabilityRecord`'s extension seam — owner decision 2026-08-11.
 *
 * ## The deferral this file makes checkable
 *
 * `DiscoveryOptions.understands` has no production caller. `UNDERSTOOD_EXTENSIONS` in
 * `packages/core/src/discovery.ts` is empty, and `discoverCandidates` — the only
 * production entry into `discoverExecutors` — has no field to forward it through. The
 * owner ruled **not to wire it now**: threading an option nothing can populate would carry
 * the empty set to a check that is constant-true, on a call path that cannot fail, which is
 * the shape the same day's audit finding `G5` ruled *"not done"*. Wiring it would look like
 * progress and measure nothing.
 *
 * ## The hazard the deferral creates, which is sequencing and not correctness
 *
 * The seam has two halves and only the *producing* half is usable today. If someone adds
 * the first extension producer **before** the reader is wired, every node publishing a
 * **critical** extension becomes undiscoverable across the whole fabric — `unhonouredCritical`
 * refuses it on every peer — and there is no opt-in path, because the one escape hatch is
 * the option nobody can reach. The failure is fleet-wide, it is silent at the producing
 * node, and the operator's only signal is an empty candidate list.
 *
 * Nothing in the tree fails on that ordering today. `reachability-dispositions.ts` is this
 * repository's precedent for the answer: **a deferral is made checkable rather than
 * remembered**, and the same file's rule applies here — an entry that stops describing the
 * tree must redden rather than sit unnoticed.
 *
 * ## What this asserts
 *
 * One implication, measured from source on every run:
 *
 * > if `UNDERSTOOD_EXTENSIONS` is non-empty **or** any production file constructs a
 * > `CapabilityExtension`, then `understands` must have a production caller.
 *
 * Both antecedents are false today, so the implication holds trivially and this file is
 * green — which is exactly the state the owner ruled for. It goes red on the first commit
 * that adds an extension producer without the reader, naming what to do.
 *
 * **A trivially-satisfied implication is a vacuous guard**, and this file does not rest on
 * one. Three checks below keep the instrument honest: the registry declaration must be
 * *found* (a rename would otherwise make the scan return an empty set forever), the
 * producer scan's corpus must be non-empty, and every detector is exercised against
 * synthetic source that does the thing it looks for. That last one is the answer to *"a
 * proof that cannot fail is not a proof"* for a guard whose live population is empty by
 * design.
 */

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))

/** See `requirements-ledger.node.test.ts`: `node_modules` is fatal to walk in a worktree. */
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
 * Production TypeScript: not a spec, not a barrel, not a declaration file.
 *
 * Copied in shape from `requirements-ledger.node.test.ts`'s `isProductionPath` and for its
 * stated reason — a barrel's every statement is `export … from`, so counting one as a
 * caller would make every exported symbol look wired and this file vacuous.
 */
function isProductionPath(relative: string): boolean {
  if (!relative.endsWith('.ts') || relative.endsWith('.d.ts')) return false
  if (relative.endsWith('.test.ts')) return false
  if (relative.endsWith(`${'/'}index.ts`)) return false
  return relative.startsWith('packages/') || relative.startsWith('tools/')
}

/** Every production file, comment-stripped, keyed by repo-relative path. */
const CODE: ReadonlyMap<string, string> = new Map(
  [...walk(join(ROOT, 'packages')), ...walk(join(ROOT, 'tools'))]
    .sort()
    .map((path) => path.slice(ROOT.length))
    .filter(isProductionPath)
    .map((relative) => [relative, stripComments(readFileSync(join(ROOT, relative), 'utf8'))]),
)

/**
 * The two files that *define* the seam, and are therefore never evidence that anything
 * *uses* it.
 *
 * `discovery.ts` declares `CapabilityExtension`, `UNDERSTOOD_EXTENSIONS` and `understands`;
 * `protocol.ts` parses the list off the wire and must name the type to do so. A detector
 * that counted either would fire on the seam's own existence and could never go from green
 * to red, which is the one property this file needs.
 */
const SEAM_FILES: readonly string[] = ['packages/core/src/discovery.ts', 'packages/net/src/protocol.ts']

/** The `UNDERSTOOD_EXTENSIONS` declaration source is stated separately — see {@link registryIds}. */
const REGISTRY_FILE = 'packages/core/src/discovery.ts'

/**
 * The ids `UNDERSTOOD_EXTENSIONS` is initialised with, or `null` if the declaration is gone.
 *
 * `null` rather than `[]` is the whole design of this function. A rename or a move would
 * make a `[]`-returning scan report *"the registry is empty"* forever — true by accident,
 * and the guard would be permanently and invisibly satisfied. The distinction is asserted
 * below rather than left to be trusted.
 */
function registryIds(source: string): readonly string[] | null {
  const start = source.indexOf('UNDERSTOOD_EXTENSIONS')
  if (start === -1) return null
  const set = source.indexOf('new Set', start)
  if (set === -1) return null
  // Matched by depth rather than to end-of-line: a registry that grows past one id will
  // be wrapped across lines by the formatter, and that is exactly the moment this scan
  // must not start reading half of it.
  const open = source.indexOf('(', set)
  if (open === -1) return null
  let depth = 1
  let cursor = open + 1
  while (cursor < source.length && depth > 0) {
    const char = source[cursor]
    if (char === '(') depth += 1
    else if (char === ')') depth -= 1
    cursor += 1
  }
  if (depth !== 0) return null
  const initialiser = source.slice(open + 1, cursor - 1)
  return [...initialiser.matchAll(/'([^']*)'|"([^"]*)"/g)].map((hit) => hit[1] ?? hit[2] ?? '')
}

/**
 * The contents of an `extensions: [ … ]` array literal, matching brackets rather than
 * regex-ing them.
 *
 * A regex bounded by `[^\]]` reads `extensions: [{ id: 'x', value: [1, 2] }]` as no match
 * at all — it would miss precisely the producer that carries a list-valued extension, which
 * is the most likely first one. Depth counting has no such blind spot.
 */
function extensionLiterals(source: string): readonly string[] {
  const found: string[] = []
  const key = /extensions:\s*\[/g
  for (const hit of source.matchAll(key)) {
    let depth = 1
    let cursor = hit.index + hit[0].length
    const open = cursor
    while (cursor < source.length && depth > 0) {
      const char = source[cursor]
      if (char === '[') depth += 1
      else if (char === ']') depth -= 1
      cursor += 1
    }
    if (depth === 0) found.push(source.slice(open, cursor - 1))
  }
  return found
}

/**
 * Whether a production file constructs a `CapabilityExtension`.
 *
 * Two signals, unioned, because there are two ways to write one and each misses the other:
 *
 * - a **non-empty `extensions: [ … ]` literal**, which is how both current production
 *   signers write theirs (`browser-node.ts`, `fabric-node.ts` — both `[]`), and which
 *   catches a producer that never names the type because TypeScript infers it structurally;
 * - **naming `CapabilityExtension`** outside {@link SEAM_FILES}, which catches a producer
 *   that builds its list in a helper, a variable, or a `.map`.
 *
 * Neither is complete on its own and the union is not complete either — a producer could
 * assemble a list through enough indirection to hide from both. That is the same
 * read-syntax-not-reachability limit `requirements-ledger.node.test.ts` states about
 * itself, and the error is in the same direction: this can miss a producer, so the guard
 * under-fires rather than crying wolf. It cannot invent one.
 */
function producesExtension(relative: string, source: string): boolean {
  if (extensionLiterals(source).some((inner) => inner.trim() !== '')) return true
  return !SEAM_FILES.includes(relative) && /\bCapabilityExtension\b/.test(source)
}

/** Whether a production file supplies or forwards `DiscoveryOptions.understands`. */
function readsUnderstands(relative: string, source: string): boolean {
  return relative !== REGISTRY_FILE && /\bunderstands\b/.test(source)
}

const REGISTRY = registryIds(CODE.get(REGISTRY_FILE) ?? '')
const PRODUCERS = [...CODE].filter(([path, source]) => producesExtension(path, source)).map(([path]) => path)
const READERS = [...CODE].filter(([path, source]) => readsUnderstands(path, source)).map(([path]) => path)

/** What a red run tells the next author to do, rather than leaving them to derive it. */
const REMEDY =
  'Wire the reader before the producer lands: give `CandidateOptions` an `understands` ' +
  'field, forward it from `discoverCandidates` into `discoverExecutors` (packages/net/' +
  'src/discover-candidates.ts), and give the fabric/browser factories a way to set it. ' +
  'Until that exists, every node publishing a CRITICAL extension is excluded by every ' +
  'peer as `critical-extension-not-understood`, fleet-wide, with no opt-in path. If the ' +
  'first extension is deliberately NON-critical and the reader is still not wanted, say ' +
  'so here in writing and narrow this guard to critical producers — do not delete it.'

describe('the extension seam cannot grow a producer before it grows a reader', () => {
  it('finds the registry declaration it reads, so a rename cannot silence it', () => {
    // `null` is "the constant moved or was renamed"; `[]` is "it is genuinely empty".
    // Conflating the two is how this guard would pass forever without reading anything.
    expect(REGISTRY).not.toBeNull()
    expect(registryIds('const OTHER = new Set<string>()')).toBeNull()
  })

  it('reads a corpus that actually contains the seam, so it is not scanning nothing', () => {
    expect(CODE.size).toBeGreaterThan(50)
    expect(CODE.has(REGISTRY_FILE)).toBe(true)
    // The two production signers, whose `extensions: []` is the empty case the producer
    // detector has to distinguish from a real producer.
    const signers = [...CODE].filter(([, source]) => source.includes('publishCapabilities('))
    expect(signers.map(([path]) => path)).toContain('packages/node/src/fabric-node.ts')
    expect(signers.map(([path]) => path)).toContain('packages/browser/src/browser-node.ts')
  })

  /**
   * The anti-vacuity check, and the reason this file is not theatre.
   *
   * Every antecedent below is false in the live tree by design, so the guard's own
   * assertion is satisfied without exercising a single detector. These synthetic inputs are
   * what make the detectors falsifiable: break any one of them and this reddens, on a tree
   * where the real population would never notice.
   */
  it('has detectors that fire on source doing the thing they look for', () => {
    expect(registryIds("const UNDERSTOOD_EXTENSIONS: ReadonlySet<string> = new Set(['urn:o2:h3'])")).toEqual([
      'urn:o2:h3',
    ])
    expect(registryIds('const UNDERSTOOD_EXTENSIONS: ReadonlySet<string> = new Set<string>()')).toEqual([])

    // A producer written as a literal, including the nested-array case a bracket-blind
    // regex would silently skip.
    expect(producesExtension('packages/x/src/y.ts', "extensions: [{ id: 'urn:o2:h3', critical: true, value: 1 }]")).toBe(
      true,
    )
    expect(producesExtension('packages/x/src/y.ts', "extensions: [{ id: 'a', value: [1, 2] }]")).toBe(true)
    // A producer written through the type rather than a literal.
    expect(producesExtension('packages/x/src/y.ts', 'const one: CapabilityExtension = build()')).toBe(true)
    // The empty case both current signers write, and the seam's own files.
    expect(producesExtension('packages/x/src/y.ts', 'extensions: [],')).toBe(false)
    expect(producesExtension(SEAM_FILES[0] ?? '', 'readonly extensions: readonly CapabilityExtension[]')).toBe(false)

    expect(readsUnderstands('packages/net/src/discover-candidates.ts', 'understands: options.understands')).toBe(true)
    expect(readsUnderstands(REGISTRY_FILE, 'const understands = options.understands ?? new Set()')).toBe(false)
  })

  /**
   * The guard itself.
   *
   * Green today because both antecedents are empty — that is the owner's 2026-08-11 ruling
   * holding, not an absence of checking. The verdict is built as a string so a red run
   * prints the remedy and the evidence together, rather than a bare `false`.
   */
  it('requires a production caller for `understands` once anything produces an extension', () => {
    const registry = REGISTRY ?? []
    const owed = registry.length > 0 || PRODUCERS.length > 0
    const verdict =
      !owed || READERS.length > 0
        ? 'the reader is wired, or nothing yet needs it'
        : `an extension producer exists and \`understands\` has no production caller.\n` +
          `  UNDERSTOOD_EXTENSIONS: ${registry.length === 0 ? '(empty)' : registry.join(', ')}\n` +
          `  producers: ${PRODUCERS.length === 0 ? '(none)' : PRODUCERS.join(', ')}\n` +
          `  ${REMEDY}`

    expect(verdict).toBe('the reader is wired, or nothing yet needs it')
  })
})
