/**
 * The five patterns, in one file, because two readers need the same five.
 *
 * `vocabulary.node.test.ts` scans every tracked file for these words and refuses the
 * commit that introduces one. It reaches exactly as far as `git ls-files` reaches,
 * and the case it cannot reach is the one Phase 38's criterion 5 names by hand: a
 * recruitment message typed straight into a chat window, read by a few hundred
 * strangers and by whoever maintains the blocklist their browser ships with, and
 * never by this repository. `bin/check-copy.ts` checks that message, and it reads
 * this array rather than a second array of five that would come to disagree with the
 * first the day one of them was edited.
 *
 * So the array moved here and nothing about it changed: same five rows, same
 * patterns, same reasons, same order. The evidence for the rule — Coinhive, Salon,
 * the Disconnect list, the Chrome Web Store ban — is stated where the guard is, and
 * is not restated here.
 *
 * ## This file is exempt from the guard that imports it
 *
 * Registered in `vocabulary.node.test.ts`'s `EXEMPT_PATHS`, carrying the reason that
 * file's own entry carries: the rule cannot be written down without naming what it
 * bans. `scanRepository` reads every tracked file, so a module landing here without
 * its exemption fires the guard on itself and blocks the next commit by whoever
 * happens to make it — which is somebody who did not write this line.
 *
 * ## The patterns are `/g`, so they carry a `lastIndex`
 *
 * Read them with `matchAll` or `String#match`, never with `RegExp#test`: a `test`
 * leaves the index where its match ended and the next caller starts from there.
 * That was survivable while one file owned them. With two importers it is a defect
 * waiting for whichever call happens to run second.
 */

export interface Banned {
  readonly term: string
  readonly pattern: RegExp
  readonly why: string
}

/**
 * The banned vocabulary.
 *
 * Inflections are included because a grep for "miner" finds "miners" and a reviewer
 * scanning for reward language finds "earned" as readily as "earn". What is
 * deliberately *not* here is the pronoun "mine" — "a claim of mine" is English, and
 * banning it would fire on two existing phase retrospectives while catching nothing
 * a reviewer would react to. `\b` anchors keep "determining", "examining",
 * "learning", and "accredited" out.
 */
export const BANNED: readonly Banned[] = [
  {
    term: 'mining',
    pattern: /\b(?:crypto[\s-]?)?min(?:ing|er|ers)\b/gi,
    why: 'the single word every cryptojacking blocklist is keyed on',
  },
  {
    term: 'hashrate',
    pattern: /\bhash[\s-]?rates?\b/gi,
    why: 'has no meaning outside proof-of-work and reads as proof-of-work on sight',
  },
  {
    term: 'earn',
    pattern: /\bearn(?:s|ed|ing|ings)?\b/gi,
    why: 'frames volunteered compute as paid work — the claim Coinhive made and could not keep',
  },
  {
    term: 'credits',
    pattern: /\bcredits?\b/gi,
    why: 'a currency word, and the fabric settles nothing; BOINC-style points also invite result-forging',
  },
  {
    term: 'tokens',
    pattern: /\b(?:data)?tokens?\b/gi,
    why: 'reads as cryptocurrency to a reviewer who does not stop to check the sense',
  },
]

/** One banned word, where it was found. */
export interface Violation {
  /** Repo-relative path, or whatever name the caller gave the text it scanned. */
  readonly file: string
  readonly line: number
  /** Zero-based offset of the match within the line. */
  readonly column: number
  readonly term: string
  readonly match: string
  readonly text: string
}

/**
 * Every banned word in `content`, before any exemption is applied.
 *
 * Separated from the exemption layer so the mutation tests can prove the matcher
 * itself fires, independently of where a file happens to live. It moved here from
 * `vocabulary.node.test.ts` on 2026-09-06 for a second reason on top of that one:
 * `bin/check-copy.ts` has to produce the *same* findings the guard produces, and a
 * second implementation of "walk the lines, apply the five patterns" is a place the
 * two answers can differ. Sharing the array and re-writing the loop would leave the
 * cheaper half of the duplication in place.
 *
 * **The exemption layer did NOT move with it**, and that is the design rather than an
 * omission. `scan()` in `vocabulary.node.test.ts` still owns `EXEMPT_PATHS` and
 * `EXEMPT_LINES`, because those answer "is this defensible in the file it is in" — a
 * question about a repository. Copy about to be sent to a few hundred strangers is
 * not in a file and has no such answer, so the command calls this function and stops.
 */
export function rawMatches(file: string, content: string): Violation[] {
  const found: Violation[] = []
  const lines = content.split('\n')
  for (const [index, text] of lines.entries()) {
    for (const { term, pattern } of BANNED) {
      for (const match of text.matchAll(pattern)) {
        if (match.index === undefined) continue
        found.push({
          file,
          line: index + 1,
          column: match.index,
          term,
          match: match[0],
          text: text.trim(),
        })
      }
    }
  }
  return found
}
