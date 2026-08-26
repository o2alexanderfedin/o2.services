import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * `.planning/STATE.md`'s frontmatter must stay parseable as YAML.
 *
 * ## What this is for, and what it cost to find out
 *
 * Three separate writers have corrupted this frontmatter — `gsd-sdk state.begin-phase`
 * rewrote the progress block from a bad count, the `pause-work` workflow reset
 * `completed_phases` and mangled `milestone_name`, and `state.record-metric`, asked for a
 * single metrics row, *also* rewrote `status`, `stopped_at` and every progress count.
 * **None of them errored.** All three were caught by `git diff`, never by the tool.
 *
 * On 2026-08-06 the block was measured and found **not to be valid YAML at all**:
 * `yaml.safe_load` raised `ScannerError: mapping values are not allowed here`, on
 * `stopped_at`, at the first `": "` inside its value. A `": "` cannot appear inside a plain
 * (unquoted) YAML scalar — it is what starts a nested mapping. There were **five** such
 * sites. That a writer which cannot parse the block goes on to rewrite it anyway is a
 * plausible mechanism for all three corruptions.
 *
 * **Plausible is not measured, and this guard does not claim the link.** It closes the
 * property regardless of whether it was the cause: the frontmatter parses, and it keeps
 * parsing.
 *
 * The fix, taken by owner ruling on 2026-08-06, was to make `stopped_at` a **folded block
 * scalar** (`stopped_at: >-` with the value indented). Inside a block scalar every byte is
 * literal text, so `": "` and `" #"` are safe there — which is why the idiom every
 * `*-VERIFICATION.md` already uses for `score:` is the right one here too.
 *
 * ## This guard is a PROXY for "it parses", and the shortfall is deliberate
 *
 * The honest check is `yaml.parse(frontmatter)`. **This repository has no YAML parser** —
 * not `yaml`, not `js-yaml`, not at the top level and not transitively. Adding one is a
 * dependency decision, and the moment this guard was written two agents were running vitest
 * in this shared checkout, where an `npm install` churns `node_modules` underneath somebody
 * else's run and reddens it for reasons that have nothing to do with their code. So the
 * dependency was **not** added mid-flight, and this file checks the structural rules that
 * make the block parseable instead of parsing it.
 *
 * **The real parse was performed out of band** with Python's PyYAML at the moment of the
 * fold, and recorded: it raised `ScannerError` before and returned an 8-key mapping after,
 * with `stopped_at` round-tripping word for word (`before.split() === after.split()`).
 *
 * **Upgrade path, so this is a stated shortfall and not a forgotten one:** add `yaml` as a
 * dev dependency and replace the checks below with a parse. Until then, a reader should
 * know that a *new* way of breaking YAML — one not on the list below — would pass this
 * guard. The two constructs that actually broke it will not.
 *
 * ## Why the rules are shaped the way they are
 *
 * The failure was not "someone typed bad YAML". It was **a prose field growing** until it
 * contained ordinary English punctuation that YAML reads as syntax. So the load-bearing
 * rule is not "no colons" — it is that a long prose value must be a **block scalar**, which
 * makes the whole class of punctuation problems unrepresentable rather than forbidden.
 */

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const STATE = join(ROOT, '.planning/STATE.md')

/** Longer than this and a plain scalar is prose, not a value — see the docblock. */
const PROSE_THRESHOLD = 200

/** Block scalar introducers. Everything after one of these is literal text. */
const BLOCK_SCALAR = /^(\||>)[-+]?$/

interface Field {
  readonly key: string
  readonly raw: string
  readonly isBlockScalar: boolean
  readonly line: number
}

function frontmatterOf(source: string): string {
  const match = /^---\n(.*?)\n---\n/s.exec(source)
  const body = match?.[1]
  if (body === undefined) throw new Error('STATE.md has no frontmatter block')
  return body
}

/**
 * Top-level fields only. Indented lines are a block scalar's body or a nested mapping's
 * entries, and neither is a plain scalar the rules below apply to.
 */
function topLevelFields(frontmatter: string): Field[] {
  const fields: Field[] = []
  frontmatter.split('\n').forEach((text, index) => {
    if (text.startsWith(' ') || text.trim() === '') return
    const match = /^([A-Za-z_][A-Za-z0-9_]*): ?(.*)$/.exec(text)
    const key = match?.[1]
    const raw = match?.[2]
    if (key === undefined || raw === undefined) return
    fields.push({
      key,
      raw,
      isBlockScalar: BLOCK_SCALAR.test(raw.trim()),
      line: index + 1,
    })
  })
  return fields
}

const SOURCE = readFileSync(STATE, 'utf8')
const FRONTMATTER = frontmatterOf(SOURCE)
const FIELDS = topLevelFields(FRONTMATTER)

/**
 * The frontmatter keys, as one source rather than as literals repeated per assertion.
 *
 * **These are not this project's vocabulary and must never be renamed here.** They are the
 * wire names an external writer stamps on `.planning/STATE.md` — the `get-shit-done` workflow
 * toolkit that supplies the `/gsd-*` commands, which writes `gsd_state_version` at
 * `~/.claude/get-shit-done/bin/lib/state.cjs:931` as its own schema-version stamp. This guard
 * READS that contract to check the file still parses; renaming a value here would not rename
 * anything on disk, it would only stop the guard describing the file it guards.
 *
 * So the split is deliberate: **our names on the left, their wire strings on the right.** A
 * TypeScript `enum` would fuse the two and put a foreign tool's branding into this
 * repository's type system as a first-class identifier. A `const` object also matches the
 * incumbent pattern — this tree holds 108 string-literal union types and, before this line,
 * zero enums.
 *
 * `Object.values` is why this is an object rather than eight separate constants: the
 * completeness case below asserts the WHOLE set, and a list written out a second time is a
 * list that can drift from the first.
 */
const GSD_FRONTMATTER_KEY = {
  schemaVersion: 'gsd_state_version',
  milestone: 'milestone',
  milestoneName: 'milestone_name',
  status: 'status',
  stoppedAt: 'stopped_at',
  lastUpdated: 'last_updated',
  lastActivity: 'last_activity',
  progress: 'progress',
} as const

type GsdFrontmatterKey = (typeof GSD_FRONTMATTER_KEY)[keyof typeof GSD_FRONTMATTER_KEY]

/** Every key above, in declaration order. The completeness case reads this, not a copy of it. */
const REQUIRED_KEYS: readonly GsdFrontmatterKey[] = Object.values(GSD_FRONTMATTER_KEY)

describe('.planning/STATE.md frontmatter stays parseable', () => {
  it('is a block this guard can actually see — otherwise everything below is vacuous', () => {
    // Without this, a frontmatter that failed to match would silently produce zero
    // fields and every rule below would pass over an empty list. That is the shape of
    // guard this repository keeps finding, so it is checked first.
    expect(FRONTMATTER.length).toBeGreaterThan(100)
    expect(FIELDS.length).toBeGreaterThanOrEqual(6)
    expect(FIELDS.map((field) => field.key)).toContain(GSD_FRONTMATTER_KEY.stoppedAt)
    expect(FIELDS.map((field) => field.key)).toContain(GSD_FRONTMATTER_KEY.progress)
  })

  it('has no plain scalar carrying a `": "`, which is what broke it', () => {
    // A `": "` inside a plain scalar starts a nested mapping. This is the exact
    // construct `yaml.safe_load` raised ScannerError on, five times over, on 2026-08-06.
    const offenders = FIELDS.filter(
      (field) => !field.isBlockScalar && field.raw.includes(': '),
    ).map((field) => `${field.key} (line ${field.line})`)
    expect(
      offenders,
      'a plain YAML scalar cannot contain ": " — make the field a block scalar (`key: >-`) ' +
        'and indent the text, the way stopped_at was fixed on 2026-08-06',
    ).toEqual([])
  })

  it('has no plain scalar carrying a ` #`, which would truncate it silently', () => {
    // The quieter sibling: ` #` opens a comment, so the value is not malformed — it is
    // just shorter than whoever wrote it believes. That failure has no error message at
    // all, which makes it worse than the one above rather than milder.
    const offenders = FIELDS.filter(
      (field) => !field.isBlockScalar && / #/.test(field.raw),
    ).map((field) => `${field.key} (line ${field.line})`)
    expect(offenders, 'a plain YAML scalar cannot contain " #" — it starts a comment').toEqual([])
  })

  it('keeps long prose in a block scalar rather than forbidding punctuation in it', () => {
    // The rule that actually holds the property. `stopped_at` is prose and it grows every
    // session; no amount of care about colons survives that. Making it a block scalar
    // makes the whole class unrepresentable.
    const prose = FIELDS.filter(
      (field) => !field.isBlockScalar && field.raw.length > PROSE_THRESHOLD,
    ).map((field) => `${field.key} is ${field.raw.length} chars of plain scalar`)
    expect(
      prose,
      `a plain scalar over ${PROSE_THRESHOLD} chars is prose and will eventually contain ` +
        'YAML syntax by accident — use a block scalar (`key: >-`)',
    ).toEqual([])
  })

  it('indents every block scalar body uniformly', () => {
    // In a folded scalar a line indented MORE than the first is kept literal with its
    // newline, so ragged indentation silently changes the value rather than failing.
    const lines = FRONTMATTER.split('\n')
    const ragged: string[] = []
    FIELDS.filter((field) => field.isBlockScalar).forEach((field) => {
      const body: string[] = []
      for (let index = field.line; index < lines.length; index += 1) {
        const text = lines[index]
        if (text === undefined) break
        if (text.trim() === '') continue
        if (!text.startsWith(' ')) break
        body.push(text)
      }
      const indents = new Set(body.map((text) => text.length - text.trimStart().length))
      if (indents.size > 1) ragged.push(`${field.key}: indents ${[...indents].sort().join(',')}`)
    })
    expect(
      ragged,
      'a folded block scalar keeps a more-indented line literal, so ragged indentation ' +
        'changes the value without any error',
    ).toEqual([])
  })

  it('still carries the fields the rest of the ledger reads', () => {
    // Cheap, and it is the half a structural check would otherwise miss: the block can be
    // perfectly well-formed YAML and have had a field dropped by one of the three writers.
    const keys = FIELDS.map((field) => field.key)
    // Anti-vacuity before the assertion that matters: `arrayContaining([])` is satisfied by
    // anything, so an empty or truncated constant would make this case pass over nothing.
    expect(REQUIRED_KEYS.length).toBe(8)
    expect(keys).toEqual(expect.arrayContaining([...REQUIRED_KEYS]))
  })

  /**
   * **PRESENT IS NOT TRUE — added 2026-08-25, and the gap was live when it was added.**
   *
   * Every case above this one checks that the block PARSES and that the eight keys are
   * THERE. On 2026-08-25 a writer rewrote this frontmatter and put four false values in
   * it — `status: completed` with all thirteen phases of the milestone unstarted,
   * `total_phases: 42` against a milestone of thirteen, a `milestone_name` that had grown
   * a leading em-dash, and a `stopped_at` quoting a claim about remaining context that
   * was wrong by a third of the window. **This file passed 6/6 over all four**, because
   * a key that is present and well-formed satisfies every check above.
   *
   * These two are the cheapest true-value checks available and they are deliberately
   * narrow: a closed vocabulary, and a count against the roadmap the number describes.
   * Neither can verify the prose, and nothing here pretends to — what they catch is a
   * writer inventing a value outside the set, which is exactly what happened.
   */
  it('states a status this project actually uses, not one a writer invented', () => {
    // The set is this file's own history, taken from `git log -p` over its `status:` line:
    // planning -> ready-to-execute -> executing -> verifying -> milestone_complete. The
    // value written on 2026-08-25 was `completed`, which is in none of them and reads as
    // a milestone finishing.
    const KNOWN_STATUS = ['planning', 'ready-to-execute', 'executing', 'verifying', 'milestone_complete']
    const status = FIELDS.find((field) => field.key === GSD_FRONTMATTER_KEY.status)?.raw ?? ''
    // Anti-vacuity: an empty or truncated vocabulary would let anything through.
    expect(KNOWN_STATUS.length).toBe(5)
    expect(KNOWN_STATUS).toContain(status.trim().split(/\s+#/)[0]?.trim())
  })

  it('counts the phases the roadmap holds, not a number from somewhere else', () => {
    // `total_phases` describes the CURRENT milestone, which is the last `## Milestone`
    // heading in ROADMAP.md and the phases under it. Counted from the file rather than
    // trusted, for the reason this repository has already paid for once: a count written
    // by subtraction from a stale total is wrong by everything that arrived since.
    const roadmap = readFileSync(join(ROOT, '.planning/ROADMAP.md'), 'utf8')
    const lastMilestone = roadmap.lastIndexOf('\n## Milestone')
    expect(lastMilestone).toBeGreaterThan(-1)
    // `\d` is load-bearing: the milestone also opens with a `### Phase Checklist` heading,
    // and counting it read 14 against a true 13 — caught by this case on its first run,
    // against a `total_phases` I had just written by hand and believed.
    const phases = roadmap.slice(lastMilestone).match(/^### Phase \d/gm)?.length ?? 0
    expect(phases).toBeGreaterThan(0)
    const declared = Number(/total_phases:\s*(\d+)/.exec(FRONTMATTER)?.[1] ?? NaN)
    expect(declared).toBe(phases)
  })
})
