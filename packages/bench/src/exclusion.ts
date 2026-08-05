/**
 * A published exclusion, built from the failure that was observed — BENCH-07 criterion 3.
 *
 * ## The defect this exists to remove
 *
 * `bin/bench.ts`'s real-transport sweep caught every error a rung could raise and attached
 * one stored paragraph to it. That paragraph named a specific libp2p limit — an inbound
 * connection cap of five per host — as the cause, and the only thing it read off the error
 * it was attached to was the message it interpolated. So a rung that died on a disk error,
 * a signing error, a refused shard or a cap it never reached all published the same cause,
 * and none of them measured it. Worse, the limit the paragraph named had changed underneath
 * it: the node factory derives its effective inbound threshold from its reservation limit,
 * and that coupling landed after the run whose exclusion the paragraph describes.
 *
 * **A published exclusion is a figure like any other and is held to the same rule.** It
 * reports what was observed — the error's class, its message, and the configuration that
 * was in force — and anything beyond that is labelled as interpretation and appears only
 * when a caller passes one. A caller that wants to name a cause has to say so in a field
 * called `interpretation`, which is precisely what makes it visible as one to a reader of
 * the report.
 *
 * ## Why this is a string and not a record
 *
 * `Report.excluded` is `{ config, reason }[]` and `renderMarkdown` puts `reason` in a
 * Markdown table cell. Widening that type would move every reader of the published report
 * and of `raw.json`; what was wrong was never the shape, only where the string came from.
 * So this returns one table cell, and every character that could break a table out of it is
 * neutralised here rather than at the call site.
 *
 * Pure module: no `node:*` import, no platform global, nothing from `@o2/core`.
 * `purity.node.test.ts` scans this package, and this file's tests run under the browser
 * project too, without a suffix.
 */

/**
 * One failure, as the thing that caught it can actually describe it.
 *
 * Nothing here is derived and nothing here is a default. Every field is a reading the
 * caller took: two off the error, and one off the rig it was running.
 */
export interface ObservedFailure {
  /** The error's class — `cause.name` for an `Error`, `typeof cause` otherwise. */
  readonly errorName: string
  /** The error's own message, verbatim. May be empty; an empty one is stated, not hidden. */
  readonly message: string
  /**
   * The levers that were in force, in the order the author wants them read.
   *
   * An ordered array of pairs rather than a record, deliberately: rendering order is then
   * the author's and cannot drift with key insertion order, which is what makes two
   * attempts' rendered reasons comparable pair by pair. A reader comparing an attempt that
   * failed with one that did not needs the two strings to differ only where the two
   * attempts differed.
   */
  readonly config: readonly (readonly [string, string])[]
  /**
   * A reading of *why*, when one was measured.
   *
   * **Optional, and omitting it is the normal case.** A caller that has not measured a
   * cause must not pass one; a caller that has, passes it here and it is rendered behind an
   * explicit prefix so a reader can tell the two apart at a glance. There is no default and
   * there must never be one — a default here is the stored paragraph again.
   */
  readonly interpretation?: string
}

/** Between the observation, the configuration and the interpretation. */
const SECTION = ' — '

/** Between two configuration pairs, and what a reader splits on to compare two attempts. */
const PAIR = '; '

/** Introduces the configuration segment, so a reader can find where it starts. */
const CONFIG_PREFIX = 'observed under: '

/** Introduces a reading that is not an observation. Load-bearing; see {@link ObservedFailure.interpretation}. */
const INTERPRETATION_PREFIX = 'Interpretation: '

/**
 * Make `text` safe to sit inside a Markdown table cell.
 *
 * Three substitutions, each for a character that ends the cell or the row it is in:
 *
 * - every run of whitespace, **including newlines**, becomes one space — a stack trace
 *   pasted into a cell would otherwise end the row at its first line break and leave the
 *   rest of the table reading as prose;
 * - `|` becomes `\|`, which is the only escape Markdown tables have;
 * - a backtick becomes an apostrophe, since a backtick inside the code span this renders
 *   into closes it early and the remainder of the message would be typeset as prose.
 *
 * The third is lossy and is stated as such: it changes one character of an observed
 * message. It is preferred to the alternative of not rendering the message in a code span
 * at all, which would leave the underscores and asterisks that appear in real error text
 * being read as emphasis.
 */
function cellSafe(text: string): string {
  return text.replace(/\s+/g, ' ').replace(/\|/g, '\\|').replace(/`/g, "'").trim()
}

/**
 * The published reason for one excluded rung: what was seen, and what was in force.
 *
 * The output is one Markdown table cell, in three segments separated by ` — `:
 *
 * 1. the error's class, and its message in a code span — or a stated absence where the
 *    error carried no message, rather than an empty code span a reader would read as a
 *    rendering fault;
 * 2. every configuration pair, as `key=value`, in the order they were given;
 * 3. the interpretation, behind {@link INTERPRETATION_PREFIX} — **only** when one was
 *    supplied.
 *
 * **Nothing else.** No hedging word, no cause, no default sentence about what the error is
 * likely to have been. A caller wanting to name a cause passes it as an interpretation,
 * which is what makes it visible as one; see the module comment for the defect that makes
 * this the rule rather than a preference.
 */
export function describeExclusion(observed: ObservedFailure): string {
  const name = cellSafe(observed.errorName)
  const message = cellSafe(observed.message)
  // A named absence rather than an empty code span. `\`\`` renders as nothing at all, and a
  // reader cannot tell a message that was empty from a renderer that dropped one.
  const observation =
    name === ''
      ? message === ''
        ? 'an error that named neither a class nor a message'
        : `an error of no stated class: \`${message}\``
      : message === ''
        ? `\`${name}\`, which carried no message`
        : `\`${name}\`: \`${message}\``

  const pairs = observed.config
    .map(([key, value]) => `${cellSafe(key)}=${cellSafe(value)}`)
    .join(PAIR)
  // Same rule as the message: an absence is stated, never rendered as a gap.
  const configuration = pairs === '' ? `${CONFIG_PREFIX}no configuration was recorded` : `${CONFIG_PREFIX}${pairs}`

  const interpretation =
    observed.interpretation === undefined ? [] : [`${INTERPRETATION_PREFIX}${cellSafe(observed.interpretation)}`]

  return [observation, configuration, ...interpretation].join(SECTION)
}
