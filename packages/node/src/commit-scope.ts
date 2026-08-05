import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

/**
 * The commit's own paths, so that a guard blocks its author rather than a bystander.
 *
 * ## The defect this closes
 *
 * Every cheap guard scans a repo-wide corpus — `git ls-files`, a filesystem walk, a
 * hand-maintained ledger — while the commit that triggers it is a narrow set of paths.
 * So **one agent's in-flight edit becomes a commit outage for every other agent**: the
 * concurrent writer is refused, the author of the violation is not, and the only exit is
 * `O2_SKIP_GUARDS=1`. Measured 2026-08-04, `git log --all --grep=O2_SKIP_GUARDS` returns
 * **18**. `7717ade` records the canonical instance in its own message — a requirements row
 * said nothing calls `translationCid`, and a concurrently running plan had just given it a
 * caller. The row's author was blocked; so was everybody else.
 *
 * `.githooks/pre-commit` already computed the staged set. It used it only as an "is
 * anything staged" gate — nothing downstream ever saw it.
 *
 * ## What narrows, and what deliberately does not
 *
 * **Visibility stays repo-wide. Only blocking narrows.** A finding outside the commit is
 * still printed, by {@link reportForeign}, on stderr. Hiding it would recreate defect #38,
 * where a guard's trigger was narrower than its corpus and a violation therefore ran no
 * guard at all — a banned term went in through a root-level `.md` and then refused every
 * subsequent commit by somebody else.
 *
 * ## Four properties carry the whole change
 *
 * 1. **Absence means STRICT.** Missing, unreadable, empty or malformed scope is
 *    {@link NO_COMMIT_SCOPE}, and {@link partition} then treats *every* finding as own. A
 *    guard run by `npm test`, by a verifier, or by a hook whose environment did not reach
 *    the worker must block on **everything**, never on nothing. A finding carrying no paths
 *    at all is own for the same reason: a guard that forgot to attribute must not thereby
 *    stop blocking.
 * 2. **The path list arrives in a FILE, never an environment variable.** See the comment
 *    at the assignment site in `.githooks/pre-commit`. Measured on `/bin/bash` 3.2.57:
 *    `V=$(cat nul-separated)` yields `a.tsb.ts` — length 8 for two four-character paths —
 *    **silently**, warning on stderr only. Every finding would then match nothing, read as
 *    foreign, and the guards would block on nothing at all. This is the single most
 *    dangerous available "simplification".
 * 3. **The union rule.** A finding is attributed to {@link Finding.paths} — *every* path
 *    that participates, not just the one it is reported against. A ledger row broken by a
 *    new caller names **both** the ledger and the caller, so the author of either is
 *    blocked. That is the `translationCid` case, and a single `path:` field would reopen it
 *    silently. The field is plural in its name for that reason; keep it plural.
 * 4. **`--diff-filter=ACMRD --no-renames -z`.** Measured on git 2.33.0 against a staged
 *    delete plus a staged rename: `ACMR` prints `renamed.ts` alone — it **omits the
 *    deletion**, and a deletion is a violation *cause* (delete a file a ledger entry names
 *    and that entry breaks). With rename detection on, git prints only the destination, so
 *    a finding keyed on the old path reads as foreign; `--no-renames` prints both halves.
 *    Without `-z` an odd path is C-quoted and matches nothing.
 *
 * ## Which guards are partitioned, and which are not
 *
 * Partitioned: `vocabulary`, `purity`, `mutation-guard`, `requirements-ledger`,
 * `slow-specs`.
 *
 * **`disclosure-gate` is deliberately excluded, and the reason is written here and in that
 * file rather than left to look like an oversight.** Two reasons. (i) Its findings are
 * *directory* paths — `TREE.dirs.filter(isUnderDotGithub)` — and git never stages a
 * directory, so a foreign `.github/` would be permanently foreign and therefore permanently
 * unblocking: partitioning it would not narrow the guard, it would switch the guard off.
 * (ii) What it guards is a permanent, irreversible legal event. Public hosting is public
 * disclosure, and the EPO and China have no grace period. It is the one guard where
 * "somebody else's problem" is not an acceptable verdict. Its findings are structurally
 * rare — a workflow file appearing, a `deploy` script — not the shape of an in-flight edit,
 * so excluding it costs approximately nothing and removes the highest-consequence
 * fail-open in the change.
 *
 * Within a partitioned guard, checks whose subject is a **single document** are left
 * unpartitioned on purpose and say so in line: `requirements-ledger`'s header arithmetic is
 * about `.planning/REQUIREMENTS.md` and nothing else, and `slow-specs`'s "derived, not
 * listed" check is about `vitest.config.ts` and nothing else. Those are already scoped to
 * their own author; wrapping them would add a layer that can only fail open.
 *
 * **An exemption of that shape must be read off what the check consumes, never off a
 * belief about who could trigger it — defect #66, 2026-08-05.** Three of
 * `requirements-ledger`'s cases were exempted here on the stated ground that they "cannot
 * fire for anybody who did not edit" the ledger or that spec. They can: all three cross the
 * ledger with a corpus built by walking `packages/`, so any agent who moves a production
 * symbol fires them. Plan 20-10 did, was refused, and spent three `O2_SKIP_GUARDS=1`
 * commits — this defect, reproduced by a carve-out taken from its own design test. Before
 * exempting a check, name the expressions it reaches and check that none of them reads a
 * corpus. **The population a guard acts on is not the population that pays for it.**
 *
 * That fix also settles the shape of the union when the *cause* is a deletion. A symbol a
 * commit removes is absent from the working tree, so the finding it breaks has no
 * production path left to name; `requirements-ledger` resolves those against **HEAD**,
 * which is the base the scope itself is computed against, and turns an unreadable HEAD into
 * an empty `paths` — unattributed, therefore own, therefore blocking.
 *
 * ## The residual fail-open, stated
 *
 * **Path-form drift has no symptom.** Every guard today emits repo-relative POSIX with no
 * leading slash, which is exactly what `git ls-files` and `git diff-index --name-only`
 * print. A future `./` prefix, a leading `/`, or a Windows separator makes every finding
 * foreign and the guards silently stop blocking — nothing goes red, nothing gets printed.
 * That is the failure mode most likely to actually happen, so it is checked from both
 * ends: {@link isLsFilesForm} rejects the malformed *scope* file outright, and every
 * partitioned guard asserts {@link pathFormProblems} is empty over the paths it produces
 * and that a floor of them round-trip through {@link trackedPaths}.
 *
 * **Deliberate abuse is bounded but real.** `O2_COMMIT_PATHS_FILE=/dev/null` is safe —
 * empty means strict — but a file holding one unrelated path makes everything foreign, a
 * bypass equivalent to `O2_SKIP_GUARDS=1`. {@link reportForeign} therefore prints the scope
 * size, so a run that blocked on nothing says so out loud.
 *
 * `process.stderr.write` rather than `console.warn`: the hook runs vitest with
 * `--silent=true`, which swallows the latter and passes the former through.
 */

/** The environment variable naming the file that holds the commit's paths. */
export const COMMIT_PATHS_VARIABLE = 'O2_COMMIT_PATHS_FILE'

/**
 * No scope is in force, so every finding blocks.
 *
 * This is the value for *missing*, *unreadable*, *empty* and *malformed* alike. They are
 * deliberately not distinguished: every one of them means "this process cannot tell whose
 * commit this is", and there is exactly one safe answer to that.
 */
export const NO_COMMIT_SCOPE = 'no-commit-scope' as const

export type CommitScope = ReadonlySet<string> | typeof NO_COMMIT_SCOPE

/** Anything that can be attributed to paths. See the union rule. */
export interface Scoped {
  /**
   * EVERY path that participates in this finding — the ledger *and* the caller, the
   * config *and* the file whose arrival moved the count. Not "the path it is reported
   * against". An empty array means "could not attribute", which is treated as own.
   */
  readonly paths: readonly string[]
}

/** A finding, with the line the guard would have printed. */
export interface Finding extends Scoped {
  readonly line: string
}

export interface Partitioned<T> {
  /** Findings this commit is answerable for. These block. */
  readonly own: readonly T[]
  /** Findings some other working-tree state produced. These are printed, not blocked on. */
  readonly foreign: readonly T[]
}

/**
 * Exactly the shape `git ls-files -z` and `git diff-index --name-only -z` print:
 * repo-relative, POSIX separators, no leading `/`, no `./`, no `..` segment.
 *
 * Used in both directions — to reject a malformed scope file, and to assert that a guard
 * still emits paths a scope could ever match. Both are the same defect seen from the two
 * ends, and it is a defect with no symptom of its own.
 */
export function isLsFilesForm(path: string): boolean {
  if (path.length === 0) return false
  if (path.startsWith('/')) return false
  if (path === '.' || path.startsWith('./')) return false
  if (path.includes('\\')) return false
  if (path.includes('//')) return false
  if (path.includes('\n') || path.includes('\0')) return false
  return !path.split('/').includes('..')
}

/** The paths in `paths` that are not in `git ls-files` form, each rendered with why. */
export function pathFormProblems(paths: readonly string[]): string[] {
  return paths
    .filter((path) => !isLsFilesForm(path))
    .map(
      (path) =>
        `${JSON.stringify(path)} is not in \`git ls-files\` form — a commit scope can ` +
        'never match it, so every finding it carries would read as foreign and this ' +
        'guard would silently stop blocking',
    )
}

/**
 * Parses the contents of the scope file.
 *
 * A single malformed entry discards the **whole** scope rather than just that entry. That
 * is over-strict by design: a newline-separated file, a C-quoted path, or a leading `/`
 * are all signs that the producer and this reader disagree, and the safe reading of a
 * disagreement is "block on everything". Discarding one entry would leave a scope that
 * looks healthy and silently under-blocks.
 */
export function parseCommitScope(contents: string | null): CommitScope {
  if (contents === null) return NO_COMMIT_SCOPE
  const entries = contents.split('\0').filter((entry) => entry.length > 0)
  if (entries.length === 0) return NO_COMMIT_SCOPE
  if (entries.some((entry) => !isLsFilesForm(entry))) return NO_COMMIT_SCOPE
  return new Set(entries)
}

/**
 * The scope this process is running under, read from {@link COMMIT_PATHS_VARIABLE}.
 *
 * Every failure path returns {@link NO_COMMIT_SCOPE}, which blocks on everything. There is
 * no path through this function that widens what a guard tolerates.
 */
export function commitScope(
  env: Readonly<Record<string, string | undefined>> = process.env,
): CommitScope {
  const file = env[COMMIT_PATHS_VARIABLE]
  if (file === undefined || file.length === 0) return NO_COMMIT_SCOPE
  let contents: string
  try {
    contents = readFileSync(file, 'utf8')
  } catch {
    return NO_COMMIT_SCOPE
  }
  return parseCommitScope(contents)
}

/**
 * Splits findings into the ones this commit is answerable for and the ones it is not.
 *
 * A finding is **own** when *any* of its paths is in the scope — the union rule — or when
 * it names no path at all, or when there is no scope. All three defaults point the same
 * way: toward blocking.
 */
export function partition<T extends Scoped>(
  findings: readonly T[],
  scope: CommitScope,
): Partitioned<T> {
  if (scope === NO_COMMIT_SCOPE) return { own: [...findings], foreign: [] }
  const own: T[] = []
  const foreign: T[] = []
  for (const finding of findings) {
    // Named for what it means. `paths.length > 0` is the "could not attribute" guard and
    // `some` is the union rule; a finding is somebody else's only when it was attributed
    // AND none of the paths it was attributed to is in this commit.
    const somebodyElses =
      finding.paths.length > 0 && !finding.paths.some((path) => scope.has(path))
    if (somebodyElses) foreign.push(finding)
    else own.push(finding)
  }
  return { own, foreign }
}

/**
 * Prints the findings this commit is not answerable for, and the size of the scope.
 *
 * The scope size is not decoration. A scope file holding one unrelated path makes every
 * finding foreign, which is a bypass equivalent to `O2_SKIP_GUARDS=1` with none of its
 * visibility. Printing the size means a run that blocked on nothing has to say so.
 */
export function reportForeign(guard: string, foreign: readonly string[], scope: CommitScope): void {
  if (foreign.length === 0) return
  const size =
    scope === NO_COMMIT_SCOPE ? 'no commit scope in force' : `commit scope: ${scope.size} path(s)`
  process.stderr.write(
    `\n⚠️  ${guard}: ${foreign.length} finding(s) outside this commit — reported, not blocking.\n` +
      `   ${size}. These are real findings against the working tree; somebody else's\n` +
      `   commit is answerable for them, and this one is not held for it.\n` +
      foreign.map((line) => `   · ${line}\n`).join(''),
  )
}

/**
 * The whole per-guard idiom: partition, report the foreign half, return the blocking half.
 *
 * Guards assert `expect(blocking(...)).toEqual([])`, so the failure message is unchanged
 * from before this module existed — the list is just narrowed to the commit.
 */
export function blocking(
  guard: string,
  findings: readonly Finding[],
  scope: CommitScope,
): string[] {
  const split = partition(findings, scope)
  reportForeign(
    guard,
    split.foreign.map((finding) => finding.line),
    scope,
  )
  return split.own.map((finding) => finding.line)
}

/**
 * Every path git tracks, as the round-trip target for {@link pathFormProblems}.
 *
 * Form alone is not enough: `src/foo.ts` for a file at `packages/node/src/foo.ts` is
 * well-formed and matches nothing. Membership here is what makes the assertion a round
 * trip rather than a spell-check.
 */
export function trackedPaths(root: string): ReadonlySet<string> {
  const output = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' })
  return new Set(output.split('\0').filter((path) => path.length > 0))
}
