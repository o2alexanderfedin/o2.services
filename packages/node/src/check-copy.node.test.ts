import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { BANNED } from './banned-vocabulary.ts'
import { stripComments } from './strip-comments.ts'

/**
 * `bin/check-copy.ts` — the half of Phase 38's criterion 5 a repository guard cannot reach.
 *
 * `vocabulary.node.test.ts` scans what `git ls-files` reports. A recruitment message typed
 * straight into a chat window is never tracked, so the criterion names the gap by hand:
 * *"an unchecked message is the one a reviewer greps."* The command closes it by reading the
 * same array the guard reads, and this file is what says the command actually does that.
 *
 * ## Why the positive control is the case that matters
 *
 * Every claim about copy is an ABSENCE claim, and an absence claim is worth exactly what its
 * positive control is worth. A checker that silently matched one row would report the
 * repository's own recruitment copy clean for a reason that has nothing to do with the copy.
 * So the first case below feeds it a message carrying every one of the five and requires
 * **five** findings — the literal, not `BANNED.length`, because an assertion that reuses the
 * value it tests moves with it.
 *
 * ## The five terms are read out of `BANNED`, never typed here
 *
 * Which is why this file needs no entry in `EXEMPT_PATHS` and deliberately does not have one.
 * The plan for this work expected one, on the reasoning that *"a checker for the banned list
 * cannot be tested without naming what it bans"* — measured, that turned out to be false. The
 * fixture is built by substituting `BANNED[n].term` into ordinary sentences, so this file
 * contains none of the five, and the vocabulary guard's own stated bias is *"toward exempting
 * as little as possible"*. A path exemption is also not covered by the dead-exemption check,
 * which holds only line exemptions, so an unnecessary one could never be found and deleted.
 *
 * The substitution buys a second thing worth having: the sentences around the terms are real
 * prose, so the word boundaries in each pattern are exercised in the position they will
 * actually be read in rather than against a bare word.
 *
 * ## The scratch file is under the OS temp directory, never inside the repository
 *
 * A tracked fixture full of the five terms would be a new violation. An untracked one inside
 * the tree makes `git status --porcelain` dirty, which reddens `discover-arm.node.test.ts`
 * and `bench-attestation.node.test.ts` for whoever is running them — this repository shares
 * one working tree between concurrent agents.
 */

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const BIN = fileURLToPath(new URL('./bin/check-copy.ts', import.meta.url))
const INVITE = join(ROOT, 'docs/recruitment/telegram-invite.md')

/** Exit codes the command documents. Named here so a case reads as the claim it makes. */
const NOTHING_FOUND = 0
const FOUND = 1
const CANNOT_RUN = 2

const WORKDIR = mkdtempSync(join(tmpdir(), 'o2-check-copy-'))
afterAll(() => {
  rmSync(WORKDIR, { recursive: true, force: true })
})

interface Run {
  readonly status: number | null
  readonly stdout: string
  readonly stderr: string
  /** One entry per finding. The command puts findings on stdout and nothing else. */
  readonly findings: readonly string[]
}

/**
 * Runs the command as a real child process.
 *
 * The exit code is read off the spawn result directly and never off a pipeline: a shell
 * pipeline reports the LAST command's status, and this repository has had a failing run
 * report success that way more than once. `status` is `null` when the child was killed by
 * a signal, which is a different thing from any exit code and is asserted as such.
 */
function checkCopy(args: readonly string[], input?: string): Run {
  const result = spawnSync(process.execPath, ['--experimental-strip-types', BIN, ...args], {
    encoding: 'utf8',
    input: input ?? '',
  })
  const stdout = result.stdout ?? ''
  return {
    status: result.status,
    stdout,
    stderr: result.stderr ?? '',
    findings: stdout.split('\n').filter((line) => line.length > 0),
  }
}

/** The term each output line names, which is the second whitespace-separated field. */
const termsIn = (run: Run): string[] => run.findings.map((line) => line.split(' ')[1] ?? '')

/**
 * A message carrying every one of the five, in sentences somebody could actually send.
 *
 * Built by substitution rather than written out — see the header. The sentences are one per
 * line so a finding's reported line number is checkable against the row that produced it.
 */
function messageCarryingAllFive(): string {
  const [first, second, third, fourth, fifth] = BANNED.map((row) => row.term)
  return [
    `Start ${first} in your browser today and see what happens.`,
    `Your ${second} appears in the bar at the bottom of the page.`,
    `Leave this tab open and ${third} while you read.`,
    `You have 42 ${fourth} waiting in your account.`,
    `Contributed compute is settled in ${fifth}, paid weekly.`,
  ].join('\n')
}

/**
 * Source with comments and string literals removed, so what is left is code.
 *
 * `stripComments` deliberately preserves strings — several guards depend on that — and this
 * check needs them gone, because the command's own import specifier is a slash-bearing
 * string and would satisfy a naive search on its own. Templates go first: they may contain
 * both quote characters, and the command's output format does.
 */
function codeOnly(source: string): string {
  return stripComments(source)
    .replace(/`[^`]*`/g, '``')
    .replace(/'[^'\n]*'/g, "''")
    .replace(/"[^"\n]*"/g, '""')
}

describe('the checker reports every one of the five, not the first one it meets', () => {
  it('reads a message carrying all five and reports five findings', () => {
    const fixture = join(WORKDIR, 'all-five.txt')
    writeFileSync(fixture, `${messageCarryingAllFive()}\n`)

    const run = checkCopy([fixture])

    // Killed by a signal is not an exit code, and it is not this claim's evidence.
    expect(run.status, `killed by a signal; stderr was ${run.stderr}`).not.toBeNull()
    expect(run.status).toBe(FOUND)
    // The literal, and the whole point of the case: a checker matching one row would
    // report this message as a finding too, and the verdict would read identically.
    expect(run.findings.length).toBe(5)
    // Five DISTINCT terms rather than one term five times — the same defect, one level in.
    expect(new Set(termsIn(run)).size).toBe(5)
    // One sentence per line, so the reported line numbers are the sentences in order.
    expect(run.findings.map((line) => line.split(':')[1])).toEqual(['1', '2', '3', '4', '5'])
    expect(run.stderr).toContain('5 findings')
  })

  it('reads the same message from stdin, which is the half a clipboard uses', () => {
    // `pbpaste | check-copy -` is the invocation the recruitment document names first,
    // because the message a chat window holds was never a file.
    const run = checkCopy(['-'], `${messageCarryingAllFive()}\n`)

    expect(run.status).not.toBeNull()
    expect(run.status).toBe(FOUND)
    expect(run.findings.length).toBe(5)
    expect(run.findings.every((line) => line.startsWith('stdin:'))).toBe(true)
  })
})

describe('the copy this repository actually intends to send passes it', () => {
  it('finds nothing in docs/recruitment/telegram-invite.md and exits zero', () => {
    const run = checkCopy([INVITE])

    expect(run.status).not.toBeNull()
    expect(run.status).toBe(NOTHING_FOUND)
    expect(run.findings).toEqual([])
    expect(run.stderr).toContain('no findings')
  })

  it('says "I could not read it" differently from "there was nothing in it"', () => {
    // Two clean-looking outcomes that must not be confused by anything standing in front
    // of a send: a missing file produces no findings, exactly as clean copy does.
    const run = checkCopy([join(WORKDIR, 'no-such-message.txt')])

    expect(run.status).toBe(CANNOT_RUN)
    expect(run.findings).toEqual([])
    expect(run.stderr).toContain('could not read')
  })
})

describe('there is one definition of the five, and the command cannot grow a second', () => {
  const SOURCE = readFileSync(BIN, 'utf8')

  it('declares no regular expression of its own', () => {
    const code = codeOnly(SOURCE)
    // Every slash in this file is inside a comment or a string — an import specifier or a
    // documented path. A regex literal, or a division, would leave one behind here.
    expect(code).not.toContain('/')
    expect(code).not.toContain('RegExp')
  })

  it('would see one if it were there — the check proved able to fail', () => {
    // Without this the case above passes on a stripper that deleted everything, which is
    // the failure mode a "contains nothing" assertion has by construction.
    const planted = `const p = ${String.raw`/\bfoo\b/g`}\nconst q = new RegExp('x')\n`
    expect(codeOnly(planted)).toContain('/')
    expect(codeOnly(planted)).toContain('RegExp')
    // …and the real source is not passing merely because the stripper emptied it.
    expect(codeOnly(SOURCE).length).toBeGreaterThan(200)
  })

  it('imports the array rather than restating it', () => {
    expect(SOURCE).toContain("from '../banned-vocabulary.ts'")
    expect(SOURCE).toContain('rawMatches')
  })
})
