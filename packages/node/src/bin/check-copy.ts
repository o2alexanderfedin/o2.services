/**
 * `check-copy` — read a message against the five patterns before it is sent.
 *
 * Phase 38's criterion 5 names a gap by hand: the repository-wide vocabulary guard
 * scans tracked files, so *"recruitment copy that lives outside the tree is checked
 * by hand against the same five patterns before it is sent — an unchecked message is
 * the one a reviewer greps."* A message typed into a chat window — a short version
 * for one person, a translation, a follow-up — never reaches `git ls-files` and is
 * therefore outside every guard this repository has.
 *
 * This is that check, as a command rather than as a habit:
 *
 *   node --experimental-strip-types packages/node/src/bin/check-copy.ts <file>
 *   pbpaste | node --experimental-strip-types packages/node/src/bin/check-copy.ts -
 *
 * `--experimental-strip-types` is how this repository already runs a `.ts` entry
 * point — see `package.json`'s `aot:lift` and `test:mutations`.
 *
 * ## One definition, and no second list of five
 *
 * It imports `BANNED` and `rawMatches` from `../banned-vocabulary.ts`, which is the
 * same module `vocabulary.node.test.ts` imports. It declares no pattern of its own
 * and contains no regular-expression literal at all — `check-copy.node.test.ts`
 * asserts that over this file's own text, so a future edit cannot quietly reintroduce
 * a second list that drifts from the first. Two lists of five agree on the day they
 * are written and on no day after it.
 *
 * ## It has no exemptions, deliberately
 *
 * `vocabulary.node.test.ts` carries `EXEMPT_PATHS` and `EXEMPT_LINES` because a
 * tracked source file can have a defensible reason to name a banned word: an RFC
 * field name on the wire, a citation, the rule stating itself. Copy about to go to a
 * few hundred strangers has no such reason, so the exemption layer stays behind and
 * this command reports every match it finds.
 *
 * ## What goes where, because a caller counts lines
 *
 * **Findings on stdout, one per line, and nothing else on stdout.** The summary goes
 * to stderr. That way `check-copy … | wc -l` is the number of findings, and a caller
 * that wants the verdict alone reads the exit code. Mixing a total into stdout would
 * make the cheapest possible reading — count the lines — wrong by one.
 *
 * Exit codes: `0` nothing found, `1` something found, `2` the command could not run
 * (wrong arguments, unreadable input). `1` and `2` are separated because "your copy
 * is clean" and "I never read your copy" must not look the same to a script standing
 * in front of a send.
 */

import { readFileSync } from 'node:fs'
import { BANNED, rawMatches } from '../banned-vocabulary.ts'

const STDIN = '-'
const USAGE = [
  'usage: check-copy <file>',
  '       check-copy -        (reads the message from stdin)',
  '',
  `Reads a message and reports every occurrence the ${BANNED.length} patterns in`,
  'packages/node/src/banned-vocabulary.ts match. It has no exemptions.',
  'Exits 0 when it finds nothing, 1 when it finds something, 2 when it could not run.',
].join('\n')

const NOTHING_FOUND = 0
const FOUND = 1
const CANNOT_RUN = 2

function fail(message: string): never {
  process.stderr.write(`${message}\n`)
  process.exit(CANNOT_RUN)
}

const args = process.argv.slice(2)
if (args.length !== 1 || args[0] === '--help' || args[0] === '-h') {
  // A usage error and a help request take the same path but not the same stream:
  // help asked for is not an error, and a caller redirecting stderr wants to see one
  // of these and not the other.
  const asked = args[0] === '--help' || args[0] === '-h'
  process.stderr.write(`${USAGE}\n`)
  process.exit(asked ? NOTHING_FOUND : CANNOT_RUN)
}

const target = args[0] ?? STDIN
let content: string
try {
  // File descriptor 0 rather than `/dev/stdin`: the latter does not exist on every
  // platform this may be run from, and `readFileSync(0)` is the portable spelling.
  content = target === STDIN ? readFileSync(0, 'utf8') : readFileSync(target, 'utf8')
} catch (error) {
  fail(`check-copy: could not read ${target === STDIN ? 'stdin' : target}: ${String(error)}`)
}

const label = target === STDIN ? 'stdin' : target
const findings = rawMatches(label, content)

for (const finding of findings) {
  // Line and column, the term that fired, what actually matched, and the line it sat
  // in — the same four things `vocabulary.node.test.ts` renders, because somebody
  // reading one of these outputs should not have to learn a second format.
  process.stdout.write(
    `${finding.file}:${finding.line}:${finding.column + 1} ${finding.term} — "${finding.match}" — ${finding.text.slice(0, 120)}\n`,
  )
}

process.stderr.write(
  findings.length === 0
    ? `check-copy: no findings in ${label}\n`
    : `check-copy: ${findings.length} finding${findings.length === 1 ? '' : 's'} in ${label} — this copy is not ready to send\n`,
)

process.exit(findings.length === 0 ? NOTHING_FOUND : FOUND)
