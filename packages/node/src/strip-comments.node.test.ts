import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { BLINDABLE, stripComments } from './strip-comments.ts'

/**
 * The proof that {@link stripComments} fixed something, held as a **differential**.
 *
 * ## Why this file is shaped the way it is
 *
 * A spec that only drove the fixed stripper would assert that a working thing works. It
 * would stay green if somebody reverted `strip-comments.ts` to the regex pair it replaced,
 * because every case below reads correctly under the fixed stripper *and that is all such
 * a spec would ask*. So both arms run here, in one run, on one input: {@link BLINDABLE} is
 * the regex pair the five guards used until 2026-08-04, and every case declares what each
 * arm must read.
 *
 * Six of the seven cases are of the form **missed by `BLINDABLE`, caught by
 * `stripComments`**. The seventh is deliberately not, and is the more interesting one:
 * see {@link CASES}' `blast radius with no closer` entry.
 *
 * ## What "caught" and "missed" mean here
 *
 * Each case carries a `pattern` and the verdict each stripper produces for it. For a
 * *presence* guard — `sovereign-block-refusal` asking whether a file calls `submitJob` —
 * a match means the call site was seen. For an *absence* guard — `bench-reduce`'s
 * `forbidden` arm, `requirements-ledger`'s "nothing calls X" rows — a match means the
 * violation was seen. Either way `caught: true` is the reading the guard needs and
 * `caught: false` is the guard going blind, so one table covers both.
 *
 * ## The defect this is the proof for
 *
 * Any comment opener occurring outside a block comment — in a line comment, or inside a
 * string literal — makes the old regex open a comment the source never opened, and
 * everything to the next closer anywhere in the file is deleted before the guard reads
 * it. Measured 2026-08-04 over the tree **as it stood before this change**: 70 such
 * openers across 18 of the 314 tracked source files, every one of them in a string
 * literal and none in a line comment.
 *
 * **And measured at guard-verdict level on the same day, no guard's found/not-found
 * verdict differs between the two strippers.** The mechanism is live and today's damage is
 * zero — none of those 70 openers happens to sit where a guard is looking. That is why
 * every case below is synthetic, and why the `S1`–`S4` mutation-ledger entries each needed
 * a new case added to their guard before the swap could redden anything at all. A proof
 * built on the tree happening to contain a trigger would evaporate the day somebody
 * reworded a string.
 */

/**
 * `requirements-ledger`'s stripper, which carried one extra special case: `[^:]` before
 * the line-comment pattern, added so that a `https://` inside a string literal would not
 * truncate the rest of its line.
 *
 * Kept as a third arm for one case only, because it is the empirical argument against
 * "just write a stricter regex": it is a parser written badly, one input at a time. It
 * rescues `https://` — the input somebody noticed — and does nothing for `'a // b'`,
 * which is the same bug one character over.
 */
function BLINDABLE_WITH_THE_COLON_HACK(source: string): string {
  return source.replaceAll(/\/\*[\s\S]*?\*\//g, ' ').replaceAll(/(^|[^:])\/\/[^\n]*/g, '$1')
}

/**
 * The degenerate that passes cases 1–6 and destroys every guard.
 *
 * Every case below asks a stripper to *preserve* something. A stripper that preserves
 * everything satisfies all of them and is catastrophic: `requirements-ledger` names
 * `runResilient` in four docblocks and calls it from none, so with nothing stripped every
 * "no caller" row reads as violated and the file is permanently red — which is how a
 * guard gets deleted. `over-stripping control` below is the case that fails for this
 * function and passes for {@link stripComments}.
 */
function STRIPS_NOTHING(source: string): string {
  return source
}

interface Case {
  /** What shape of blindness this case pins. */
  readonly name: string
  /** Why a guard's verdict turns on it — not a restatement of the input. */
  readonly why: string
  readonly source: string
  /** The scan a guard actually runs. */
  readonly pattern: RegExp
  /** What that scan reads once {@link stripComments} has run. */
  readonly caughtByStripComments: boolean
  /** What it reads once {@link BLINDABLE} has run. */
  readonly caughtByBlindable: boolean
}

const CASES: readonly Case[] = [
  {
    name: 'the line-comment form',
    why:
      'A comment opener inside a `//` comment. This is the form originally recorded for ' +
      'this defect, and the only one already removed from the tree — kept because ' +
      'nothing prevents it coming back, and because the recorded diagnosis named it as ' +
      'the whole defect when it was one of two.',
    source:
      '// the note this replaced said /* keep the direct call\n' +
      'await submitJob(spec, store)\n' +
      '/** why the wrapper exists */\n',
    pattern: /\bsubmitJob\s*\(/,
    caughtByStripComments: true,
    caughtByBlindable: false,
  },
  {
    name: 'the string-literal form',
    why:
      'The form that is live in the tree: 70 openers across 18 tracked files on ' +
      '2026-08-04, every one inside a string literal. `sovereign-block-refusal` reads ' +
      'this shape as a file that does not call `submitJob`, so a NEW call site never ' +
      'enters its found set and its `toEqual` passes.',
    source:
      "const opener = '/*'\n" +
      'await submitJob(spec, store)\n' +
      '/** why the wrapper exists */\n',
    pattern: /\bsubmitJob\s*\(/,
    caughtByStripComments: true,
    caughtByBlindable: false,
  },
  {
    name: 'the call-site form — the shape that makes a false REQUIREMENTS row pass',
    why:
      'This is `requirements-ledger` failing OPEN on the exact defect it exists to ' +
      'prevent. A row reading "`runResilient` itself has no caller" is checked by ' +
      'searching the production corpus for a call. Blind that search and an obvious ' +
      'caller reads as absent, so the false row PASSES — and the file whose whole ' +
      'subject is rows that were false in this direction produced the blindness itself.',
    source:
      "const pattern = '/*.ts'\n" +
      'export async function run(spec: Spec) {\n' +
      '  return runResilient(spec)\n' +
      '}\n' +
      '/** why this module exists */\n',
    pattern: /(?<![.\w$])(?:new\s+)?runResilient\s*\(/,
    caughtByStripComments: true,
    caughtByBlindable: false,
  },
  {
    name: "the forbidden-pattern form — bench-reduce's absence arm",
    why:
      '`forbidden` is a must-NOT-match pattern, so the guard is satisfied when the scan ' +
      'reads nothing. Over-stripping therefore makes the requirement pass wrongly, ' +
      'which is the opposite of the direction that arm\'s docblock claimed was safe. The ' +
      'pattern is the real one: `/const complete =[^\\n]*reduce/`.',
    source:
      "const label = 'partition/*'\n" +
      'const complete = await reduceJob(partials, tree)\n' +
      '/** the reduce is measured, not merely wired */\n',
    pattern: /const complete =[^\n]*reduce/,
    caughtByStripComments: true,
    caughtByBlindable: false,
  },
  {
    name: 'blast radius with a closer — to the next closer anywhere in the file',
    why:
      'The damage is not one line and not to end of file. A stray opener consumes ' +
      'everything up to the next closer, which is normally the end of the NEXT real ' +
      'docblock — so it eats that docblock\'s opener and closer too and the file ' +
      'self-corrects after one block comment. Twelve intervening lines here, all of ' +
      'them lost, including the call site on the last of them.',
    source:
      "const opener = '/*'\n" +
      'const a = 1\n'.repeat(10) +
      'await submitJob(spec, store)\n' +
      '/** the closer that ends the damage */\n' +
      'const afterwards = 2\n',
    pattern: /\bsubmitJob\s*\(/,
    caughtByStripComments: true,
    caughtByBlindable: false,
  },
  {
    name: 'blast radius with no closer — the control, where nothing was ever damaged',
    why:
      'The one case both arms must read the SAME, and it is here so the fix is not ' +
      'credited with repairing damage that never occurred. With no following closer the ' +
      'lazy quantifier matches nothing, so the old regex strips nothing and the call ' +
      'site survives it. A stray opener at the tail of a file is harmless, and a proof ' +
      'that claimed otherwise would be overstating its own subject.',
    source: "const opener = '/*'\nawait submitJob(spec, store)\nconst afterwards = 2\n",
    pattern: /\bsubmitJob\s*\(/,
    caughtByStripComments: true,
    caughtByBlindable: true,
  },
  {
    name: 'the mirror bug — a string literal that is not a comment at all',
    why:
      'The same defect pointing the other way: `//` inside a string is not a comment, ' +
      'and truncating there deletes real code. 113 such occurrences across the tracked ' +
      'files on 2026-08-04. `identity-store`\'s line-prefix filter had this form of the ' +
      'bug instead of the block form.',
    source: "const endpoint = 'https://relay.example/ws'\nconst divider = 'a // b'\nconst kept = 1\n",
    pattern: /'https:\/\/relay\.example\/ws'[\s\S]*'a \/\/ b'[\s\S]*const kept/,
    caughtByStripComments: true,
    caughtByBlindable: false,
  },
]

describe('the stripper is measured against the one it replaced, on the same inputs', () => {
  it.each(CASES)('$name', ({ source, pattern, caughtByStripComments, caughtByBlindable }) => {
    // Both arms, one run, one input. Reading them in a single test is the point: a
    // separate "old is broken" test could be deleted on its own and leave a green suite.
    expect(new RegExp(pattern).test(stripComments(source))).toBe(caughtByStripComments)
    expect(new RegExp(pattern).test(BLINDABLE(source))).toBe(caughtByBlindable)
  })

  it('reads a real differential, not a table of agreements', () => {
    // Anti-vacuity. Every assertion above is satisfied by two identical strippers if the
    // expectations happen to agree, so the count of DISAGREEING cases is asserted
    // directly. Six of seven; the seventh is the no-closer control, which must agree.
    const differing = CASES.filter((entry) => entry.caughtByStripComments !== entry.caughtByBlindable)
    expect(differing).toHaveLength(6)
    expect(CASES.filter((entry) => entry.caughtByStripComments === entry.caughtByBlindable).map((entry) => entry.name)).toEqual([
      'blast radius with no closer — the control, where nothing was ever damaged',
    ])
    // And every case must be CAUGHT by the fixed stripper — a case the fix also misses
    // would be a gap being recorded as a proof.
    expect(CASES.filter((entry) => !entry.caughtByStripComments)).toEqual([])
  })

  it('over-stripping control — a stripper that strips nothing passes every case above', () => {
    // The degenerate the six cases cannot see. Each of them asks for something to be
    // PRESERVED, and preserving everything satisfies all six while destroying every
    // guard: `runResilient` is named in four docblocks and called by none, so with
    // nothing stripped every "no caller" row reads as violated and the file is
    // permanently red.
    for (const { source, pattern, caughtByStripComments } of CASES) {
      expect(new RegExp(pattern).test(STRIPS_NOTHING(source)), `strip-nothing on: ${source.slice(0, 30)}`).toBe(
        caughtByStripComments,
      )
    }

    // So this is the case that separates them, and the one no case above can supply:
    // real comments must actually be gone.
    const source = 'const kept = 1\n// runResilient(x)\n/* runResilient(y) */\nconst alsoKept = 2\n'
    expect(stripComments(source)).not.toContain('runResilient')
    expect(STRIPS_NOTHING(source)).toContain('runResilient')
    expect(stripComments(source)).toContain('const kept = 1')
    expect(stripComments(source)).toContain('const alsoKept = 2')
  })

  it('BLINDABLE is not equivalent to stripComments, and this fails if it is made so', () => {
    // The other way to destroy this proof, and the reason `BLINDABLE` carries a docblock
    // saying it is load-bearing: not deletion but quiet convergence. Someone "tidying"
    // `BLINDABLE` into a re-export of `stripComments` would turn all six differential
    // cases into agreements, and every one of them would still pass.
    const witnesses = CASES.filter((entry) => stripComments(entry.source) !== BLINDABLE(entry.source))
    expect(witnesses.length).toBeGreaterThanOrEqual(6)
    expect(BLINDABLE.toString()).not.toBe(stripComments.toString())
  })
})

describe('the two properties the guards depend on', () => {
  it('preserves string literals, which is what deletes requirements-ledger’s [^:] hack', () => {
    // The case that lived in `requirements-ledger` as `strips comments, without which
    // every claim would read as violated`. It passed there only because of a special
    // case bolted on for this one input; it passes here because strings are preserved.
    const source = "const a = 1 // runResilient(x)\n/* runResilient(y) */\nconst b = 'https://x'"
    expect(stripComments(source)).not.toContain('runResilient')
    expect(stripComments(source)).toContain("'https://x'")

    // The three arms, so the hack's actual reach is on the record rather than assumed.
    // It rescues the input it was written for and nothing else.
    expect(BLINDABLE(source)).not.toContain("'https://x'")
    expect(BLINDABLE_WITH_THE_COLON_HACK(source)).toContain("'https://x'")
    expect(BLINDABLE_WITH_THE_COLON_HACK("const divider = 'a // b'")).not.toContain("'a // b'")
    expect(stripComments("const divider = 'a // b'")).toContain("'a // b'")
  })

  it('preserves line numbers, so a guard that reports file:line reports the real line', () => {
    // Measured consequence of the old regex collapsing each block comment to one space:
    // `trust-anchors` rendered `packages/node/src/fabric-node.ts:103` for a literal that
    // is on line 342. Every guard that reports a line number depends on this.
    const source = ['const first = 1', '/**', ' * four', ' * lines', ' */', 'const sixth = 6'].join('\n')
    const lineOf = (text: string, needle: string): number => text.slice(0, text.indexOf(needle)).split('\n').length

    expect(lineOf(source, 'const sixth')).toBe(6)
    expect(lineOf(stripComments(source), 'const sixth')).toBe(6)
    // 3, measured — not the 2 this line first predicted. The regex replaces the whole
    // block with a single space, so the newline before `/**` and the one after `*/`
    // both survive and the four commented lines collapse into one. The claim is that
    // line numbers are destroyed, and 3 ≠ 6 carries it; the exact figure is a reading.
    expect(lineOf(BLINDABLE(source), 'const sixth')).toBe(3)
  })

  it('tracks ${} interpolation, without which the lexer desynchronises on real files', () => {
    // Not hypothetical. `tools/aot/stubs.ts` writes a nested template inside an
    // interpolation, and a stripper that ends the outer template at the inner backtick
    // mis-lexes everything after it: measured against @babel/parser, 11 137 characters
    // of real comments went unstripped across that file and tools/aot/lift.node.test.ts,
    // both of which are inside requirements-ledger's corpus and trust-anchors'
    // jurisdiction. This is the shape, reduced.
    const source = 'const quoted = `\'${text.replaceAll("\'", `\'\\\'\'`)}\'`\n/* a real comment */\nconst after = 1\n'
    const stripped = stripComments(source)
    expect(stripped).not.toContain('a real comment')
    expect(stripped).toContain('const after = 1')
    expect(stripped).toContain('const quoted')
  })
})

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))

/** Every tracked source file, the way `trust-anchors` picks its jurisdiction. */
function trackedSources(): readonly string[] {
  return execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' })
    .split('\0')
    .filter((path) => /\.(ts|mts|js|mjs)$/.test(path))
}

describe('the migration is complete, and BLINDABLE stayed where it was put', () => {
  it('leaves no guard on a locally-defined stripper', () => {
    // The recorded way this fix fails open: a PARTIAL migration. Five call sites, and
    // migrating the fail-CLOSED ones first would leave the three silent misses —
    // trust-anchors, requirements-ledger, sovereign-block-refusal — on the old regex,
    // which is worse than not starting. A locally declared stripper anywhere but the
    // module that defines it is that state.
    //
    // The scan strips before matching, and found that out the hard way: the sentence
    // above named the declaration forms it looks for, so this file reported *itself* on
    // the first run. That is the same defect one level up — a guard satisfied by, and
    // here defeated by, a description of the thing it guards — and it is the argument
    // every migrated guard makes for stripping in the first place.
    const offenders: string[] = []
    for (const file of trackedSources()) {
      if (file === 'packages/node/src/strip-comments.ts') continue
      const source = stripComments(readFileSync(join(ROOT, file), 'utf8'))
      if (/(?:function|const|let)\s+stripComments\b/.test(source)) offenders.push(file)
    }
    expect(offenders).toEqual([])
  })

  it('is imported by the guards it was written for', () => {
    // The other half of the same reading: "no local definition" is also satisfied by a
    // guard that stopped stripping altogether, which would make every claim in
    // `requirements-ledger` read as violated. So the importers are named.
    const importers = trackedSources().filter((file) =>
      readFileSync(join(ROOT, file), 'utf8').includes("from './strip-comments.ts'"),
    )
    for (const guard of [
      'packages/node/src/bench-egress.node.test.ts',
      'packages/node/src/bench-reduce.node.test.ts',
      'packages/node/src/identity-store.node.test.ts',
      'packages/node/src/requirements-ledger.node.test.ts',
      'packages/node/src/sovereign-block-refusal.node.test.ts',
      'packages/node/src/trust-anchors.node.test.ts',
    ]) {
      expect(importers, `${guard} no longer imports the shared stripper`).toContain(guard)
    }
  })

  it('is the only file that names BLINDABLE, outside the ledger entries that plant it', () => {
    // `BLINDABLE` is deliberately exported from a module every guard imports, which makes
    // it reachable by accident. A guard that quietly ended up on it would read exactly
    // like a healthy one. The permitted set is: the module that defines it, this proof,
    // and the mutation ledger, whose `S*` entries hold the planted text as data.
    const named = trackedSources().filter((file) =>
      readFileSync(join(ROOT, file), 'utf8').includes('BLINDABLE'),
    )
    expect([...named].sort()).toEqual([
      'packages/node/src/mutation-ledger.ts',
      'packages/node/src/strip-comments.node.test.ts',
      'packages/node/src/strip-comments.ts',
    ])
  })
})
