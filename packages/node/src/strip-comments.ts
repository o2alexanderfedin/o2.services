/**
 * One comment stripper, for every guard that scans source text.
 *
 * ## Why this is a module and not five copies of a regex
 *
 * Six source-scanning guards each carried their own stripper, five of them the same regex
 * pair copied verbatim. {@link BLINDABLE} below *is* that pair — it is kept as live code
 * rather than quoted here, and not only to avoid transcription drift: the second half of
 * it cannot be written inside a block comment at all, because it ends in a star followed
 * by a slash and would close this docblock. A file about comment lexing failing to quote
 * the thing it is about is the smallest possible statement of the problem.
 *
 * That pair has no notion of *where* it is in the file, so a comment opener occurring
 * outside a block comment — in a line comment, or in a string literal — opens a comment
 * the source never opened, and everything from there to the next closer **anywhere in the
 * file** is deleted before the guard ever looks at it. Measured 2026-08-04 across the 314
 * tracked `.ts`/`.mts`/`.js`/`.mjs` files **as they stood before this change**: 70 such
 * openers in 18 files, every one of them inside a string literal, and none in a line
 * comment — the line-comment form named in the original diagnosis had already been removed
 * from the tree, and was one of two forms rather than the whole defect.
 *
 * The comparative reading, both strippers against `@babel/parser`'s comment ranges over the
 * same 316 tracked files in one run, 2026-08-04: **that regex pair deletes 20 432
 * characters of non-comment text across 33 files; this function deletes 214 across 4**, and
 * all 214 are the regex-literal limit stated below. In the other direction the regex misses
 * nothing and this function misses nothing.
 *
 * ## The claim three of those docblocks made, which was false
 *
 * They said the failure direction was the safe one — that over-stripping "can only report
 * a satisfied requirement as unmet, which fails loudly, never the reverse". That holds
 * only for a guard whose assertion is *presence*. It is backwards for every guard whose
 * assertion is *absence*, and three of the five were:
 *
 * - `requirements-ledger` asserts that a row claiming "nothing calls `X`" is true. Blind
 *   the scan and an obvious caller reads as absent, so a **false** row **passes** — the
 *   exact defect that file exists to prevent, produced by the file's own stripper.
 * - `trust-anchors` asserts the provenance opt-out appears nowhere outside a test. Blind
 *   the scan and the tree reads clean for the wrong reason.
 * - `sovereign-block-refusal` asserts a fixed set of files calls `submitJob`. A
 *   *disappearance* is caught by its `toEqual`, but a **new** file whose call site is
 *   blinded never enters the found set, and the scan passes.
 *
 * `strip-comments.node.test.ts` holds that reading as a differential: every case there
 * must be MISSED by {@link BLINDABLE} and CAUGHT by this function, in one run, on one
 * input.
 *
 * ## What this function tracks, and what it does not
 *
 * Tracked: line comments, block comments, `'…'` and `"…"` strings, and `` `…` ``
 * templates **including their `${…}` interpolation depth**, so a nested template inside an
 * interpolation does not end the outer one early.
 *
 * The interpolation arm is not speculative hardening. Without it the lexer desynchronises
 * on `tools/aot/stubs.ts`'s nested-template quoting helper and, measured against
 * `@babel/parser`, then misses **11 137 characters of real comments** across that file
 * and `tools/aot/lift.node.test.ts` — both of which sit inside `requirements-ledger`'s
 * production corpus and `trust-anchors`' jurisdiction.
 *
 * **Not tracked: regex literals.** A slash that begins a regex is indistinguishable from
 * division without a parser, so a regex whose body contains an escaped comment opener is
 * read as one and the rest of that line is dropped. This is the whole of the 214
 * characters above, and it is stated rather than left to be discovered — a claim of
 * totality here would be the same kind of defect this module removes.
 *
 * Measured 2026-08-04, exactly four tracked files trip it, and it is worth naming which
 * because two of them are consequences of this module existing:
 *
 * - `purity.node.test.ts` (121 chars) and `slow-specs.node.test.ts` (8) — neither calls
 *   this function, so neither is affected.
 * - `strip-comments.ts` (36) and `strip-comments.node.test.ts` (49) — this file and its
 *   spec, because {@link BLINDABLE} and the ledger's third arm hold that regex as live
 *   code. This file *is* inside `requirements-ledger`'s production corpus, so it strips
 *   itself: the 36 characters lost are the tail of `BLINDABLE`'s own body, which contains
 *   no call site and no symbol declaration. Stated because "the tool is in its own corpus"
 *   is the kind of thing that should not be discovered later.
 *
 * The blast radius is one line, because an unterminated `'` or `"` string resynchronises
 * at the next newline — which is sound, since neither may contain a raw newline in valid
 * source.
 *
 * ## Two properties the callers depend on
 *
 * - **String literals survive.** `requirements-ledger` carried a `[^:]` special case so
 *   that a `https://` inside a string would not truncate the rest of its line. That hack
 *   is deleted along with the regex, because strings are now genuinely preserved rather
 *   than patched around the one input somebody happened to notice.
 * - **Line numbers survive.** Newlines inside a block comment are re-emitted, so a guard
 *   that reports `file:line` reports the real line. The regex collapsed each block comment
 *   to a single space: measured 2026-08-04, `trust-anchors` reports
 *   `packages/node/src/fabric-node.ts:103` for a literal that is on line 342.
 */
export function stripComments(source: string): string {
  let out = ''
  let i = 0
  const n = source.length

  /**
   * One entry per template literal we are lexically inside, innermost last. The value is
   * the brace-nesting depth within that template's current `${…}`, or `null` when we are
   * in the template's own text rather than in an interpolation.
   */
  const templates: (number | null)[] = []

  while (i < n) {
    const character = source[i]
    const following = source[i + 1]
    const top = templates.length - 1

    // ---- template text: no comment can start here, and `${` re-enters code ----
    if (top >= 0 && templates[top] === null) {
      if (character === '\\') {
        out += source.slice(i, i + 2)
        i += 2
        continue
      }
      if (character === '`') {
        out += character
        i += 1
        templates.pop()
        continue
      }
      if (character === '$' && following === '{') {
        out += '${'
        i += 2
        templates[top] = 0
        continue
      }
      out += character
      i += 1
      continue
    }

    // ---- code: at top level, or inside a `${…}` ----

    if (character === '/' && following === '/') {
      // Dropped entirely; the terminating newline is left for the main loop to emit.
      i += 2
      while (i < n && source[i] !== '\n') i += 1
      continue
    }

    if (character === '/' && following === '*') {
      i += 2
      while (i < n && !(source[i] === '*' && source[i + 1] === '/')) {
        // Line numbers must survive: a guard reporting `file:line` reports the real one.
        if (source[i] === '\n') out += '\n'
        i += 1
      }
      // An unterminated block comment runs to end of input, which is what it means.
      i = Math.min(i + 2, n)
      out += ' '
      continue
    }

    if (character === '"' || character === "'") {
      const quote = character
      out += character
      i += 1
      while (i < n) {
        const inner = source[i]
        if (inner === '\\') {
          out += source.slice(i, i + 2)
          i += 2
          continue
        }
        out += inner
        i += 1
        // A raw newline cannot occur inside either quote form in valid source, so one
        // bounds the damage of a mis-entered string to a single line.
        if (inner === quote || inner === '\n') break
      }
      continue
    }

    if (character === '`') {
      out += character
      i += 1
      templates.push(null)
      continue
    }

    if (top >= 0) {
      const depth = templates[top] ?? 0
      if (character === '{') {
        templates[top] = depth + 1
      } else if (character === '}') {
        if (depth === 0) {
          out += character
          i += 1
          templates[top] = null
          continue
        }
        templates[top] = depth - 1
      }
    }

    out += character
    i += 1
  }

  return out
}

/**
 * The regex pair every guard used before {@link stripComments}, kept **deliberately**.
 *
 * ## This is load-bearing. Do not delete it as dead code.
 *
 * It has no production caller and never will. It exists so that
 * `strip-comments.node.test.ts` can hold both arms of a comparative reading in a single
 * run: every case there must be **missed** by this function and **caught** by
 * {@link stripComments}, on the same input. A spec that drove only the fixed stripper
 * would be asserting that a working thing works, and would stay green if the fix were
 * reverted to exactly this regex.
 *
 * It is also what the `S*` mutation-ledger entries plant: each rewrites one guard's
 * `import { stripComments }` into `import { BLINDABLE as stripComments }`, so that guard
 * runs with its old blindness restored and has to go red. Delete this export and those
 * entries become unplantable and the proof evaporates.
 *
 * `strip-comments.node.test.ts` also asserts this function is **not** equivalent to
 * {@link stripComments}, so making the two identical — the other way to quietly destroy
 * the proof — fails rather than passes.
 */
export function BLINDABLE(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, '')
}
