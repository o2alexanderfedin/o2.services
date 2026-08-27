import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { basename, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * DEMO-04 — publishing is a human act, and the repository is built so it cannot
 * become an automatic one.
 *
 * ## The rationale was REPURPOSED on 2026-08-25 by owner ruling — the mechanism did not move
 *
 * This guard was written to prevent an irreversible legal event. That event became the plan:
 * v2.0 recruits a public cohort, so disclosure is now intended rather than forbidden, and a
 * guard whose stated reason has expired is a guard nobody can defend. The open question asked
 * retire / repurpose / keep; **the ruling is repurpose**, and it is recorded at
 * `.planning/REQUIREMENTS.md` § Open questions item 6.
 *
 * **The new reason, and it is not weaker than the old one: deploying a paid tier does not
 * happen by itself.** Phase 29 puts a Durable Object behind this repository, and Cloudflare
 * has no hard spending ceiling — its own wording for its budget alerts is that they are
 * *"informational only. It does not cap your usage."* The only runaway-bill report this
 * project cites was multiplied by **60+ preview deployments**, each with its own object
 * instances running the same bug. So a workflow that deploys on push is no longer a legal
 * hazard and is now a financial one, and the same absence answers both.
 *
 * `ARCHITECTURE.md` §7's distinction survives intact and is what makes the repurpose exact:
 * **building** `packages/cloudflare/`'s source stays distinct from **deploying** it. The
 * dry-run build in `hosted-tier-deploy.node.test.ts` is a build, runs with no credential, and
 * is deliberately outside what this guard forbids.
 *
 * ## The reason it was written, kept because a rationale that vanishes cannot be audited
 *
 * Public hosting is public disclosure. EPO and China have no patent grace period,
 * so anything published there is permanently forfeit; the US provisional window is
 * the only one still open. That makes "deploy on push" not a convenience but an
 * irreversible legal event triggered by a `git push`. That was true when written and is
 * superseded rather than deleted.
 *
 * The constraint is therefore *absence*, not configuration. A workflow that is
 * disabled, commented out, or `workflow_dispatch`-only is one edit — or one
 * well-meaning "let's just re-enable CI" — away from firing. So the file may not
 * exist, and this test is what keeps it from quietly coming back.
 *
 * The same reasoning covers `package.json`: a `deploy` script is a deploy workflow
 * with extra steps. Building is fine and is deliberately *not* restricted — the
 * artifact has to be buildable and testable. Only the step that makes it public is
 * forbidden, and only a human may take it.
 *
 * ## This guard is deliberately NOT narrowed to the commit — the omission is a decision
 *
 * On 2026-08-04 the other five cheap guards were given `commit-scope.ts`, so that a
 * repo-wide finding blocks the commit that caused it rather than whichever agent commits
 * next. This one was excluded, and the reason is written here because an unexplained
 * omission reads as an oversight and would be "corrected" by the next person to notice it.
 *
 * Two reasons, either sufficient.
 *
 * 1. **It would not narrow this guard, it would switch it off.** The finding at
 *    `TREE.dirs.filter(isUnderDotGithub)` is a *directory* path, and git never stages a
 *    directory. A `.github/` appearing in somebody else's working tree would therefore be
 *    permanently outside every commit scope — permanently foreign, permanently
 *    unblocking. The narrowing has no safe reading here.
 * 2. **The consequence is permanent and legal, not technical.** Public hosting is public
 *    disclosure; the EPO and China have no grace period, and what is published there is
 *    forfeit for good. This is the one guard where "somebody else's problem" is not an
 *    acceptable verdict, because there is no later commit at which it becomes recoverable.
 *
 * The cost of excluding it is close to zero, which is the third reason it is the right
 * one to exclude: its findings are structurally rare — a workflow file appearing, a
 * `deploy` script being added — and not the shape of an in-flight edit that another agent
 * happens to be halfway through. It has never been the guard that produced an
 * `O2_SKIP_GUARDS` commit.
 */

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))

/**
 * Pruned during the walk. `node_modules` alone is ~170 top-level packages of
 * third-party CI config that says nothing about this repository's intent, and
 * `dist` is generated. Neither can cause a disclosure.
 */
const SKIP_DIRS: ReadonlySet<string> = new Set(['node_modules', '.git', 'dist'])

/**
 * Submodule roots, **derived from git's own index rather than named here**.
 *
 * A gitlink is a `160000` entry in `git ls-files --stage`. That is the authoritative
 * record of what this repository treats as a submodule — not `.gitmodules`, which can
 * describe a submodule that was never initialised, and emphatically not a `third_party/`
 * string literal.
 *
 * ## Why derived and not written down
 *
 * This repository has hit the same defect four times: **the population a guard acts on is
 * not the population that pays for it.** A hand-maintained exemption list is that defect
 * waiting to happen — it goes stale the first time a submodule is added, moved or removed,
 * and it goes stale silently, because a list that is too small only ever makes the guard
 * *stricter* until the day it makes it wrong. Deriving it from the index means the
 * exemption cannot describe a submodule that does not exist, and cannot miss one that does.
 *
 * ## Why an exemption is legitimate here, stated so it can be argued with
 *
 * The `.github` assertions below are deliberately absolute, and their own comment names the
 * erosion this could be mistaken for: *"'we moved it' is exactly the shape this constraint
 * erodes into."* The distinction is that a submodule is not this repository moving its own
 * workflow somewhere quieter. Three facts separate them, and the first two are measured:
 *
 * 1. **Git tracks none of it.** `git ls-files` reports the gitlink `third_party/elfconv`
 *    and **zero** files beneath it. Only the on-disk walk sees them, and the walk is
 *    deliberately wider than git precisely because *this repository's own* gitignored
 *    workflow would still deploy.
 * 2. **This repository did not author them.** They are `yomaytk/elfconv`'s CI, pinned at a
 *    commit, Apache 2.0 — the same standing as the `node_modules` CI config that
 *    {@link SKIP_DIRS} already prunes for the reason given above it: third-party CI
 *    *"says nothing about this repository's intent"*.
 * 3. **GitHub Actions reads workflows from the pushing repository's own root**, and does not
 *    check out submodules at all unless a workflow asks it to. **This third one is a claim
 *    about a platform and it is NOT measured here** — proving it would require pushing, and
 *    pushing is the exact act DEMO-04 exists to prevent. It is recorded as the assumption it
 *    is. If it is wrong, facts 1 and 2 do not save the constraint and this exemption is
 *    wrong with it.
 *
 * Owner ruling 2026-08-07, taken against the alternative of dropping the submodule.
 */
function submodulePaths(): ReadonlySet<string> {
  const staged = execFileSync('git', ['ls-files', '--stage', '-z'], {
    cwd: ROOT,
    encoding: 'utf8',
  })
  return new Set(
    staged
      .split('\0')
      .filter((entry) => entry.startsWith('160000 '))
      .map((entry) => entry.slice(entry.indexOf('\t') + 1)),
  )
}

const SUBMODULES: ReadonlySet<string> = submodulePaths()

interface Tree {
  /** Repo-relative POSIX paths of every directory reached. */
  readonly dirs: readonly string[]
  /** Repo-relative POSIX paths of every file reached. */
  readonly files: readonly string[]
}

function toPosix(absolute: string): string {
  return relative(ROOT, absolute).split(sep).join('/')
}

/** Whole working tree, pruned — not just what git tracks, because an untracked or
 * gitignored workflow file still deploys. */
function walk(): Tree {
  const dirs: string[] = []
  const files: string[] = []
  const queue: string[] = [ROOT]
  while (queue.length > 0) {
    const current = queue.pop()
    if (current === undefined) break
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name)
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue
        // Pruned at the root of the submodule, so nothing beneath it is reached — the same
        // treatment `SKIP_DIRS` gives `node_modules`, and for the reason stated on
        // {@link submodulePaths}. Pruning rather than filtering afterwards means every
        // assertion in this file sees one consistent tree.
        const posix = toPosix(path)
        if (SUBMODULES.has(posix)) continue
        dirs.push(posix)
        queue.push(path)
      } else if (entry.isFile()) {
        files.push(toPosix(path))
      }
    }
  }
  return { dirs, files }
}

const TREE: Tree = walk()

/** Every path git knows about, as a second independent view of the same question. */
function trackedFiles(): string[] {
  return execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' })
    .split('\0')
    .filter((path) => path.length > 0)
}

function isUnderDotGithub(path: string): boolean {
  return path.split('/').includes('.github')
}

function isYaml(path: string): boolean {
  return path.endsWith('.yml') || path.endsWith('.yaml')
}

/**
 * Command fragments that make something public. Each carries the reason, because a
 * bare list of tool names invites someone to add a ninth entry without asking
 * whether the list is the point.
 */
const PUBLISHING: readonly {
  readonly pattern: RegExp
  readonly why: string
  /** Commands this pattern must match. Asserted below — see the instrument check. */
  readonly catches: readonly string[]
  /** Commands it must leave alone, so the gate does not block ordinary local work. */
  readonly ignores: readonly string[]
}[] = [
  {
    pattern: /\bgh-pages\b/,
    why: 'gh-pages pushes a build to a branch GitHub serves publicly',
    catches: ['gh-pages -d dist', 'npx gh-pages -d packages/browser/dist'],
    ignores: ['vite build'],
  },
  {
    pattern: /\bnpm\s+publish\b/,
    why: 'npm publish puts the source on a public registry',
    catches: ['npm publish', 'npm publish --access public'],
    ignores: ['npm install', 'npm run build'],
  },
  {
    pattern: /\bnetlify\s+deploy\b/,
    why: 'netlify deploy publishes to a public URL',
    catches: ['netlify deploy --prod'],
    ignores: ['netlify dev'],
  },
  {
    pattern: /\bvercel\b/,
    why: 'the vercel CLI deploys by default, with no subcommand',
    catches: ['vercel', 'vercel --prod'],
    ignores: [],
  },
  {
    // The verb does not follow the tool name directly. `wrangler pages deploy` is
    // the command a person types to publish a static bundle to Cloudflare Pages,
    // and requiring publish|deploy immediately after `wrangler` missed it.
    pattern: /\bwrangler\s+(?:[a-z-]+\s+)*(?:publish|deploy|upload)\b/,
    why: 'wrangler publishes to Cloudflare, with or without a subcommand',
    catches: [
      'wrangler deploy',
      'wrangler publish',
      'wrangler pages deploy dist',
      'wrangler pages publish dist',
      'wrangler versions upload',
    ],
    ignores: ['wrangler dev', 'wrangler tail'],
  },
  {
    pattern: /\bfirebase\s+deploy\b/,
    why: 'firebase deploy publishes to a public URL',
    catches: ['firebase deploy --only hosting'],
    ignores: ['firebase emulators:start'],
  },
  {
    pattern: /\baws\s+s3\s+sync\b/,
    why: 'an s3 sync is how a static site reaches a public bucket',
    catches: ['aws s3 sync dist s3://bucket'],
    ignores: ['aws s3 ls'],
  },
  {
    pattern: /\bsurge\b/,
    why: 'surge publishes a static directory to a public URL',
    catches: ['surge dist'],
    ignores: [],
  },
]

/**
 * Script *names* that are forbidden regardless of what they run. `deploy` is the
 * name a person types when they want the thing this constraint exists to prevent,
 * and naming it that way is how it acquires a body later.
 */
const FORBIDDEN_SCRIPT_NAME = /^deploy(?::|$)/

interface Manifest {
  readonly path: string
  readonly scripts: Readonly<Record<string, string>>
}

function manifests(): Manifest[] {
  const found: Manifest[] = []
  for (const path of TREE.files) {
    if (basename(path) !== 'package.json') continue
    const parsed: unknown = JSON.parse(readFileSync(join(ROOT, path), 'utf8'))
    const scripts =
      typeof parsed === 'object' && parsed !== null && 'scripts' in parsed
        ? (parsed as { scripts?: Record<string, string> }).scripts
        : undefined
    found.push({ path, scripts: scripts ?? {} })
  }
  return found
}

describe('the repository root this suite is checking is the real one', () => {
  /**
   * Every assertion below is of the form "nothing matched". A wrong `ROOT` — an
   * empty temp directory, a path with one `..` too many — satisfies all of them
   * perfectly. So the path is proved before it is trusted.
   */
  it('contains the marker files that only this repository has', () => {
    expect(existsSync(join(ROOT, 'package.json'))).toBe(true)
    expect(existsSync(join(ROOT, '.planning'))).toBe(true)
    expect(existsSync(join(ROOT, 'packages', 'node', 'src'))).toBe(true)
  })

  it('was actually walked, so an empty scan cannot pass for a clean scan', () => {
    // If pruning or a permissions error silently emptied the walk, every check
    // below would pass while checking nothing.
    expect(TREE.files.length).toBeGreaterThan(100)
    expect(TREE.dirs).toContain('packages/node/src')
    expect(TREE.files).toContain('package.json')
  })

  it('is a git repository with tracked files, so the git-side view is real too', () => {
    expect(trackedFiles().length).toBeGreaterThan(100)
  })

  /**
   * The exemption is an instrument and is checked like one.
   *
   * An exemption that silently grew to cover the repository root would make every
   * assertion below vacuous while leaving them all green — the failure mode that costs
   * the most and announces itself the least. So its *contents* are pinned to what git
   * says, not merely its shape.
   */
  it('exempts exactly the paths git records as submodules, and nothing else', () => {
    // Derived a second way, from a different git command, so the check is not the
    // implementation restated. `.gitmodules` is the declaration; the index is the fact;
    // they must agree.
    const declared = execFileSync(
      'git',
      ['config', '--file', '.gitmodules', '--get-regexp', String.raw`^submodule\..*\.path$`],
      { cwd: ROOT, encoding: 'utf8' },
    )
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => line.slice(line.indexOf(' ') + 1))

    expect([...SUBMODULES].sort()).toEqual([...declared].sort())

    // Non-vacuous in both directions: it covers something, and it does not cover the root.
    expect(SUBMODULES.size).toBeGreaterThan(0)
    expect(SUBMODULES.has('')).toBe(false)
    expect(SUBMODULES.has('.')).toBe(false)
    for (const path of SUBMODULES) {
      expect(path, 'an exemption must name a subdirectory, never the tree').not.toBe('')
      expect(existsSync(join(ROOT, path))).toBe(true)
    }
  })

  /**
   * The half that matters: pruning submodules must not have blinded the walk to this
   * repository's *own* `.github`.
   *
   * **This block first said the structural form was preferable to planting a real workflow
   * file, "because creating one — even for a moment — is the act the constraint forbids".
   * That was an excuse and the plant was run instead.** Creating a local file and deleting
   * it cannot disclose anything; disclosure needs a push. And the structural assertions
   * below prove the *predicate*, while the pruning happens in {@link walk} — so on their own
   * they would have gone green against a walk that could no longer see the root at all.
   *
   * **Watched red, 2026-08-07.** A real `.github/workflows/probe.yml` carrying
   * `npx gh-pages -d dist` was written at the repository root: `PLANTED_EXIT=1`, **four**
   * assertions failing — the directory check, the any-depth check, the tracked-or-untracked
   * check and the by-content check — each naming `.github/workflows/probe.yml`. Removed
   * with `rm` + `rmdir`, `git status --porcelain` showing no trace, and the file re-run
   * green at 17 passed. The structural assertions below are kept because they are cheap and
   * they localise a failure; they are not what carries the claim.
   */
  it('still reaches a root-level .github path, so the exemption did not blind the walk', () => {
    const wouldPrune = (path: string): boolean => SUBMODULES.has(path)
    expect(wouldPrune('.github')).toBe(false)
    expect(wouldPrune('.github/workflows')).toBe(false)
    expect(wouldPrune('packages/browser/.github')).toBe(false)
    // And the predicate the assertions use still classifies those as workflow paths.
    expect(isUnderDotGithub('.github/workflows/deploy.yml')).toBe(true)
    expect(isUnderDotGithub('packages/browser/.github/workflows/deploy.yml')).toBe(true)
  })
})

/**
 * Every GitHub Actions workflow in the tree, by CONTENT rather than by location.
 *
 * The location checks this file used to carry were defeated by renaming a directory. This
 * predicate asks what a file *is*: a top-level `jobs:` map together with a runner or an
 * action reference — specific enough that an ordinary YAML config does not match.
 */
function workflowFiles(): string[] {
  return TREE.files.filter((path) => {
    if (!isYaml(path)) return false
    const source = readFileSync(join(ROOT, path), 'utf8')
    const declaresJobs = /^jobs:\s*$/m.test(source)
    const declaresRunner = /^\s*(?:runs-on:|uses:\s*actions\/)/m.test(source)
    return declaresJobs && declaresRunner
  })
}

/**
 * The `on:` block of a workflow — its indented lines, up to the next top-level key.
 *
 * **Written by line rather than by regex, and the first version was a real defect.** It read
 * `rest.slice(1).search(/^[A-Za-z_]/m)`, and `/m`'s `^` matches at the START OF THE STRING as
 * well as after a newline — so it matched at offset 0 every time and returned the single
 * character `'o'`. Every assertion over the block was then true of one letter: the
 * push/PR/schedule refusal PASSED VACUOUSLY, and only the trigger-must-be-human case failed,
 * which is what surfaced it. A guard whose subject is empty is worse than no guard, because
 * it reports green.
 */
function triggerBlock(source: string): string {
  const lines = source.split('\n')
  const start = lines.findIndex((line) => /^on:\s*$/.test(line))
  if (start === -1) return ''
  const block: string[] = []
  for (const line of lines.slice(start + 1)) {
    // A top-level key ends the block. Blank lines and comments belong to it.
    if (/^[A-Za-z_]/.test(line)) break
    block.push(line)
  }
  return block.join('\n')
}

/** Does this workflow run `wrangler deploy`, or anything else that spends money? */
function deploys(source: string): boolean {
  return /wrangler\s+deploy(?!\s+--dry-run)|gh-pages|peaceiris\/actions-gh-pages/.test(source)
}

/**
 * DEMO-04's mechanism, REPLACED 2026-08-27 by owner ruling — the claim is unchanged.
 *
 * ## What moved, and why the replacement is stricter rather than weaker
 *
 * Until today this section asserted that `.github/` **did not exist**, at any depth, tracked
 * or untracked, by name and by content. Four assertions, watched red on 2026-08-07 against a
 * real planted workflow.
 *
 * Absence was a proxy. The claim DEMO-04 actually makes is *"public deployment is an
 * explicitly triggered action, never an automatic consequence"* — and absence enforced that
 * by making every workflow impossible, including the twenty that have nothing to do with
 * deploying. The owner asked for CI on 2026-08-27, which makes the proxy the thing standing
 * in the way of ordinary work rather than the thing protecting anything.
 *
 * **So the proxy is replaced by the claim itself, checked directly.** A workflow may exist. A
 * workflow that spends money may exist. What may not exist is a workflow that spends money
 * **without a human act naming a version** — which is what a release tag is, and what a push
 * or a pull request is not.
 *
 * This is stricter than absence was in one direction that matters: absence said nothing about
 * `package.json` scripts, about a workflow added to a *fork*, or about what a permitted
 * workflow may do. The checks below say what a deploying workflow's triggers must be, so the
 * rule survives the workflows existing instead of being defined by their absence.
 *
 * ## What has NOT changed
 *
 * The financial reason, in full. Cloudflare has no hard spending ceiling — its own wording
 * for budget alerts is that they are *"informational only. It does not cap your usage."* The
 * one runaway-bill report this project cites was multiplied by **60+ preview deployments**.
 * A deploy on every push to `develop` is exactly that shape, and it stays forbidden.
 *
 * `ARCHITECTURE.md` §7's distinction, which is what makes the exemption in `deploys()` exact:
 * `wrangler deploy --dry-run` is a **build**, runs with no credential, and is not a deploy.
 * The negative lookahead is what encodes that, and it is the reason CI may run the same
 * bundle check the local guards run.
 */
describe('every workflow file is one GitHub will actually accept', () => {
  /**
   * **The check that was missing, and its absence cost a CI run that failed before any job
   * started.**
   *
   * On 2026-08-27 the `aot` lane was removed from `ci.yml` and its `runs-on:` was left
   * behind, landing inside the `node` job which already had one. The file still parsed —
   * `yaml.safe_load` takes the LAST of a duplicate pair silently — so a check that merely
   * loaded the file and read back the job names reported everything correct. **I ran exactly
   * that check and it passed.** GitHub does not accept duplicate keys: the run came back
   * named `.github/workflows/ci.yml` instead of `CI`, with `total_count: 0` jobs and
   * *"this run likely failed because of a workflow file issue"*.
   *
   * So a permissive parse is not evidence that a workflow is valid, and this case exists
   * because the failure mode is invisible to the obvious test.
   */
  it('has no duplicate key in any mapping, which a permissive YAML parser hides', () => {
    for (const path of workflowFiles()) {
      const source = readFileSync(join(ROOT, path), 'utf8')

      // A hand-written scan rather than a parser, because every YAML library in reach
      // resolves duplicates instead of reporting them — which is the whole defect. Keys are
      // grouped by their indentation and by the block they sit in; a key repeating at the
      // same indentation before the block closes is the shape GitHub rejects.
      const seen = new Map<string, number>()
      const lines = source.split('\n')
      for (const [index, line] of lines.entries()) {
        const match = /^(\s*)(-\s+)?([A-Za-z_][A-Za-z0-9_-]*):/.exec(line)
        if (match === null) continue
        const [, indentText = '', dash, key = ''] = match
        // **A list item's depth is where its DASH sits, not where its first key sits.**
        // `      - uses:` and `        with:` both put a key at column 8, so measuring the
        // key's column made them siblings and `with` looked like a duplicate of the previous
        // step's. Measured against this repository's own `ci.yml`, which is what caught it.
        const indent = indentText.length
        // A shallower key closes every deeper block, so their keys are forgotten.
        for (const [recorded] of seen) {
          if (Number(recorded.split('\u0000')[0]) > indent) seen.delete(recorded)
        }
        // **A list item starts a NEW mapping, so every key deeper than it is forgotten.**
        // Caught by this guard's own first run: two `- uses:` steps each carrying a `with:`
        // were reported as a duplicate `with`, which they are not — they are one key in each
        // of two mappings. `continue` alone was not enough; the deeper scopes have to be
        // cleared, or the second step inherits the first's keys.
        if (dash !== undefined) {
          // Everything at or below the dash's own column belonged to the previous item.
          for (const [recorded] of seen) {
            if (Number(recorded.split('\u0000')[0]) >= indent) seen.delete(recorded)
          }
          continue
        }
        const scope = `${String(indent)}\u0000${key}`
        const previous = seen.get(scope)
        expect(
          previous,
          `${path}: duplicate key '${key}' at line ${String(index + 1)}, first seen at line ` +
            `${String((previous ?? 0) + 1)}. A YAML parser resolves this silently and GitHub ` +
            `refuses the file — the run comes back named after the path with zero jobs.`,
        ).toBeUndefined()
        seen.set(scope, index)
      }
    }
  })

  it('pins every action by commit SHA, never by a tag somebody else can move', () => {
    /**
     * A tag is a pointer the action's owner controls. `actions/checkout@v4` today and
     * `actions/checkout@v4` after a compromise are the same string and different code, and
     * the deploy workflow holds a Cloudflare credential with delete rights on this account's
     * production Workers. A SHA is the artifact itself.
     *
     * This is a fresh decision rather than a deferred one: `.planning/THREAT-MODEL.md` is
     * scoped entirely to the P2P protocol's attacker model and says nothing about CI supply
     * chain, so there was no owner ruling to inherit.
     *
     * Dependabot updates these — `.github/dependabot.yml` watches `github-actions` — so the
     * pin does not become a reason to run stale actions forever.
     */
    for (const path of workflowFiles()) {
      const source = readFileSync(join(ROOT, path), 'utf8')
      const unpinned = [...source.matchAll(/^\s*-?\s*uses:\s*([^\s#]+)/gm)]
        .map((m) => m[1])
        .filter((ref): ref is string => ref !== undefined)
        // A local action (`./.github/actions/...`) has no SHA to pin and is this repository's
        // own code, already covered by everything else here.
        .filter((ref) => !ref.startsWith('./'))
        .filter((ref) => !/@[0-9a-f]{40}$/.test(ref))

      expect(
        unpinned,
        `${path} uses an action by tag rather than by SHA: ${unpinned.join(', ')}. ` +
          `A tag is a pointer its owner can move; the deploy workflow holds a credential ` +
          `with delete rights on this account's production Workers.`,
      ).toEqual([])
    }
  })

  it('gives every job a runner and at least one step, so no job is a comment husk', () => {
    // The other half of the same removal hazard: deleting a lane can leave a job key with a
    // body that is entirely comments, which parses to `null` and fails only at dispatch.
    for (const path of workflowFiles()) {
      const source = readFileSync(join(ROOT, path), 'utf8')
      const jobsAt = source.search(/^jobs:\s*$/m)
      expect(jobsAt, `${path} declares no jobs:`).toBeGreaterThan(-1)
      const jobNames = [...source.slice(jobsAt).matchAll(/^ {2}([A-Za-z_][A-Za-z0-9_-]*):\s*$/gm)]
        .map((m) => m[1])
        .filter((n): n is string => n !== undefined)
      expect(jobNames.length, `${path} declares jobs: with nothing under it`).toBeGreaterThan(0)

      // One `runs-on` and one `steps` per job, counted rather than assumed.
      const runsOn = [...source.matchAll(/^ {4}runs-on:/gm)].length
      const steps = [...source.matchAll(/^ {4}steps:/gm)].length
      expect(runsOn, `${path}: ${String(runsOn)} runs-on for ${String(jobNames.length)} jobs`).toBe(
        jobNames.length,
      )
      expect(steps, `${path}: ${String(steps)} steps for ${String(jobNames.length)} jobs`).toBe(
        jobNames.length,
      )
    }
  })
})

describe('a deploying workflow runs only on a release tag — never on a push or a pull request', () => {
  it('finds workflows by content, so a renamed directory does not hide one', () => {
    // The anti-vacuity check for everything below: if this list is empty, every assertion in
    // this block is true of nothing. It was empty until 2026-08-27 and that was the point;
    // now that CI exists, an empty list means the predicate broke, not that the tree is clean.
    expect(
      workflowFiles().length,
      'no workflow was found by content — either CI was deleted or the predicate stopped matching',
    ).toBeGreaterThan(0)
  })

  it('parses a real `on:` block rather than one character — the defect that hid a vacuous pass', () => {
    // The regression test for the bug above, written against a literal rather than against
    // the tree, so it keeps holding when the workflows change.
    const parsed = triggerBlock(['name: x', 'on:', '  release:', '    types: [published]', '', 'jobs:'].join('\n'))
    expect(parsed).toContain('release:')
    expect(parsed).not.toContain('jobs:')
    expect(parsed.length).toBeGreaterThan(2)

    // And the tree's own deploying workflows must parse to something, or every assertion
    // below is true of an empty string.
    for (const path of workflowFiles()) {
      const on = triggerBlock(readFileSync(join(ROOT, path), 'utf8'))
      expect(on.trim(), `${path} has no parseable on: block`).not.toBe('')
    }
  })

  it('never lets a deploying workflow fire on push, pull_request, or a schedule', () => {
    const offenders = workflowFiles()
      .filter((path) => deploys(readFileSync(join(ROOT, path), 'utf8')))
      .filter((path) => {
        const on = triggerBlock(readFileSync(join(ROOT, path), 'utf8'))
        return /^\s*(?:push|pull_request|pull_request_target|schedule):/m.test(on)
      })

    // `push:` is the subtle one: `on: push: tags:` is a push trigger AND a release tag. It is
    // refused anyway, because `tags:` is one edit from `branches:` and the diff is two words.
    // A deploying workflow uses `on: release:` or `workflow_dispatch:`, where the human act is
    // structural rather than a filter that can be widened.
    expect(
      offenders,
      'a workflow that spends money must not fire on push/PR/schedule — see DEMO-04',
    ).toEqual([])
  })

  it('gives every deploying workflow a trigger that REQUIRES a human act', () => {
    const deploying = workflowFiles().filter((path) =>
      deploys(readFileSync(join(ROOT, path), 'utf8')),
    )

    for (const path of deploying) {
      const on = triggerBlock(readFileSync(join(ROOT, path), 'utf8'))
      expect(
        /^\s*(?:release|workflow_dispatch):/m.test(on),
        `${path} spends money and must be triggered by a release or by hand`,
      ).toBe(true)
    }
  })

  it('keeps the dry-run build OUT of the deploy definition, so CI may still build', () => {
    // ARCHITECTURE §7: building is not deploying. If this ever goes false, CI cannot verify
    // the bundle without spending, and the guard would have eaten the thing it protects.
    expect(deploys('run: npx wrangler deploy --dry-run --outdir=dist')).toBe(false)
    expect(deploys('run: npx wrangler deploy')).toBe(true)
  })
})

describe('no package script publishes anything', () => {
  const found = manifests()

  it('finds the root manifest and every workspace manifest', () => {
    // Anti-vacuity again: zero manifests would make the next two checks silent.
    expect(found.map((m) => m.path)).toContain('package.json')
    expect(found.length).toBeGreaterThanOrEqual(7)
  })

  it('runs no publishing command from any manifest, root or workspace', () => {
    const violations: string[] = []
    for (const { path, scripts } of found) {
      for (const [name, body] of Object.entries(scripts)) {
        for (const { pattern, why } of PUBLISHING) {
          if (pattern.test(body)) violations.push(`${path} → "${name}": ${body} — ${why}`)
        }
      }
    }
    expect(violations).toEqual([])
  })

  it('declares no script named "deploy", whatever it might contain', () => {
    const violations: string[] = []
    for (const { path, scripts } of found) {
      for (const name of Object.keys(scripts)) {
        if (FORBIDDEN_SCRIPT_NAME.test(name)) {
          violations.push(`${path} → "${name}" — publishing is a human act, not a script`)
        }
      }
    }
    expect(violations).toEqual([])
  })
})

describe('the publishing patterns are live instruments, not decoration', () => {
  /**
   * Every other check in this file asserts an ABSENCE — no manifest matches, no
   * workflow file exists. A pattern that matches nothing at all satisfies all of
   * them and reads exactly like a clean repository.
   *
   * That is not hypothetical. `wrangler pages deploy` — the command a person
   * actually types to put a static bundle on Cloudflare Pages — was invisible to
   * this list, because the pattern required the verb to follow the tool name
   * directly. Every test here passed the whole time. An empty result was standing
   * in for a clean one.
   *
   * So each entry now carries the commands it must catch and the commands it must
   * not, and both are asserted. This is the instrument check the absence
   * assertions cannot perform on themselves.
   */
  it('every pattern declares at least one command it catches', () => {
    // Anti-vacuity: an empty `catches` list would satisfy the next check silently.
    for (const { pattern, catches } of PUBLISHING) {
      expect(catches.length, `${String(pattern)} declares no example`).toBeGreaterThan(0)
    }
  })

  it('each pattern matches every command it claims to catch', () => {
    const blind: string[] = []
    for (const { pattern, catches, why } of PUBLISHING) {
      for (const command of catches) {
        if (!pattern.test(command)) blind.push(`${String(pattern)} misses "${command}" — ${why}`)
      }
    }
    expect(blind).toEqual([])
  })

  it('each pattern leaves alone the commands that publish nothing', () => {
    const overreach: string[] = []
    for (const { pattern, ignores } of PUBLISHING) {
      for (const command of ignores) {
        if (pattern.test(command)) overreach.push(`${String(pattern)} wrongly catches "${command}"`)
      }
    }
    expect(overreach).toEqual([])
  })
})

describe('the demo is buildable, because building is not publishing', () => {
  /**
   * The constraint is deliberately asymmetric. Anyone must be able to produce the
   * artifact and test it against a static host; only a human, step by step, may put
   * it somewhere the public can reach. So `build:demo` is required to exist — its
   * absence would push someone toward improvising a one-off command that grows a
   * publish step.
   */
  const root = manifests().find((m) => m.path === 'package.json')

  it('offers a build:demo script', () => {
    expect(root?.scripts['build:demo']).toBeDefined()
  })

  it('builds and stops there, with nothing that reaches the network', () => {
    const body = root?.scripts['build:demo'] ?? ''
    expect(body).toContain('vite build')
    for (const { pattern } of PUBLISHING) expect(pattern.test(body)).toBe(false)
  })
})
