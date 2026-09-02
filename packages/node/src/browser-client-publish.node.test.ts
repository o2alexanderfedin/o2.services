/**
 * The published browser client can actually find the fabric.
 *
 * ## The defect these cases exist for, which fails SILENTLY
 *
 * GitHub Pages serves this repository at a **subpath** —
 * `https://o2alexanderfedin.github.io/o2.services/` — and `demo/main.ts` fetched
 * `'/bootstrap.json'`, root-absolute. That resolves to the APEX, not to the site, so the
 * request 404s and `discoverRelays` answers `source: 'none'`.
 *
 * **Nothing errors.** `tab-api.ts:894` documents `'none'` as *"the normal state on a static
 * host with no relay configured"*, which is exactly right and exactly why this is dangerous:
 * a published page that can never join is indistinguishable from a published page that has
 * simply not been given a relay. The 2026-08-06 publish is live and 1814 commits behind, and
 * no reading anywhere says whether it ever joined anything.
 *
 * A relative fetch resolves against the document, which is the same discipline
 * `vite.config.ts` already applies to assets with `base: './'` — *"keeps every asset reference
 * relative, which is what a project page"* needs. The bootstrap document is an asset of the
 * same page and had been left out of that rule.
 *
 * ## AMENDED 2026-08-31 — the fix above broke the mirror image, and these cases did not see it
 *
 * `cb09195` made both call sites relative and every LAN seed stopped working the same day.
 * `SeedServer` mounts the document at the origin ROOT (`seed-server.ts:499`) while serving the
 * page from `/packages/browser/demo/index.html`, so the relative form resolves to
 * `/packages/browser/demo/bootstrap.json` — measured 404 against a live seed, while
 * `/bootstrap.json` answered 200. `discoverRelays` reported `source: 'none'`, the documented
 * NORMAL state, and again **nothing errored**. Fifteen e2e cases across six files went red and
 * stayed red through two releases.
 *
 * The cases in this file all passed throughout, because *"never root-absolute"* is not the
 * property. The property is **beside the page FIRST, root second** — the page asks both,
 * because a bundle cannot know which of the two servers loaded it, and the order is what keeps
 * the apex request from ever being the one that answers on Pages. The ordering case below is
 * new and is what this file was missing.
 */

import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import viteConfig, { buildIdentity, stampBuildIdentity } from '../../browser/vite.config.ts'

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))

function demoSources(): readonly string[] {
  // **A directory pathspec, and the first version of this line was the bug it hunts.**
  // `packages/*/demo/**/*.ts` matched only `demo/surfaces/*.ts` — six files, none of them
  // `main.ts`, which is the one file that carried the defect. The corpus check below passed
  // on those six and proved nothing. A non-empty scan can be as wrong as an empty one, so the
  // check names the file rather than counting.
  return execFileSync('git', ['ls-files', 'packages/*/demo/*'], { cwd: ROOT, encoding: 'utf8' })
    .split('\n')
    .filter((line) => line.endsWith('.ts'))
}

describe('a page served from a subpath still finds its bootstrap document', () => {
  it('reaches the page entry point itself, not merely the files beside it', () => {
    // Named, not counted. The scan that missed this file still returned six others and would
    // have reported a clean tree over the exact defect these cases exist for.
    expect(demoSources()).toContain('packages/browser/demo/main.ts')
  })

  it('never fetches a ROOT-ABSOLUTE bootstrap path, which the apex would answer', () => {
    const offenders = demoSources().filter((path) =>
      /fetch\(\s*['"`]\/bootstrap\.json/.test(readFileSync(`${ROOT}/${path}`, 'utf8')),
    )

    expect(
      offenders,
      'a leading slash sends this to the domain apex, where the site is not — and the 404 ' +
        'presents as `source: none`, which is a documented NORMAL state, so nothing complains',
    ).toEqual([])
  })

  it('resolves the fetch against the document, so the subpath is carried', () => {
    const withFetch = demoSources().filter((path) =>
      readFileSync(`${ROOT}/${path}`, 'utf8').includes('bootstrap.json'),
    )
    expect(withFetch.length).toBeGreaterThan(0)

    for (const path of withFetch) {
      const source = readFileSync(`${ROOT}/${path}`, 'utf8')
      if (!/fetch\(/.test(source)) continue
      expect(
        source,
        `${path} must resolve bootstrap.json against the page, the way vite's base: './' ` +
          'already resolves every other asset',
      ).toContain("new URL('bootstrap.json', document.baseURI)")
    }
  })

  it('asks BESIDE THE PAGE FIRST and the origin root second, in that order', () => {
    // **The order is the whole safety property, not a preference.** On Pages the root request
    // reaches `o2alexanderfedin.github.io/bootstrap.json` — the domain apex, an origin this
    // page does not control and whose answer it must never dial. Relative first means that
    // request is only ever made when the page's own directory has no bootstrap document.
    //
    // Read as source ORDER rather than as presence, because presence is what the case above
    // already checks and presence is what passed while the seed was broken.
    const source = readFileSync(`${ROOT}/packages/browser/demo/main.ts`, 'utf8')
    const relative = source.indexOf("new URL('bootstrap.json', document.baseURI)")
    const root = source.indexOf("new URL('/bootstrap.json', location.origin)")

    expect(relative, 'the document-relative candidate is gone').toBeGreaterThan(-1)
    expect(
      root,
      'the origin-root candidate is gone — every LAN seed mounts the document there, and a ' +
        'page that stops asking for it joins nothing while reporting the documented NORMAL ' +
        'state of a static host',
    ).toBeGreaterThan(-1)
    expect(
      relative,
      'the root candidate must come SECOND: on Pages it reaches the domain apex, which this ' +
        'page does not control',
    ).toBeLessThan(root)
  })

  it('keeps vite emitting relative asset references, which the subpath also depends on', () => {
    const config = readFileSync(`${ROOT}/packages/browser/vite.config.ts`, 'utf8')
    expect(config).toContain("base: './'")
  })
})

describe('the publish is a script, runnable from a terminal and from a workflow', () => {
  const SCRIPT = readFileSync(`${ROOT}/scripts/deploy-pages.sh`, 'utf8')
  const WORKFLOW = readFileSync(`${ROOT}/.github/workflows/deploy.yml`, 'utf8')

  it('is the SAME script the workflow runs, so the two cannot drift apart', () => {
    // The defect this shape exists to prevent was real and was found on the node tier: the
    // steps lived only in a workflow, `ci.yml` was corrected after three failures and the
    // deploy workflow was not, and the same three specs failed in the one place failing costs
    // most. Two copies of a procedure diverge; one cannot.
    expect(WORKFLOW).toContain('scripts/deploy-pages.sh --live')
    expect(SCRIPT).toContain('--dry-run')
  })

  it('publishes only AFTER the node deploy, or it would name the build being replaced', () => {
    expect(WORKFLOW).toContain('needs: deploy')
  })

  it('refuses a plaintext WebSocket, which every HTTPS visitor would reject as mixed content', () => {
    // Measured, not reasoned: `bootstrapInfoFor` emits `/tcp/<port>/ws` — correct for the
    // `laptop.local` seed it was written for, unusable from a page GitHub Pages serves over
    // HTTPS. The browser refuses it before libp2p sees it, so this is caught at publish time.
    expect(SCRIPT).toContain('*/tls/ws*)')
    expect(SCRIPT).toContain('mixed content')
  })

  it('reads the PeerId from the live node instead of carrying one in the tree', () => {
    // `tab-api.ts` warns against "an address that can go stale in a build". Deriving it from
    // `/self` at publish time is the answer to that, and the PeerId survives a redeploy by
    // construction — persisted in Durable Object storage, with `deploy-hosted.sh` rolling back
    // if it ever changes.
    expect(SCRIPT).toContain('/self')
    expect(SCRIPT).toContain('ANNOUNCE_MULTIADDRS')
    expect(SCRIPT).not.toMatch(/12D3KooW[A-Za-z0-9]{10}/)
  })

  it('stamps the page with the build it came from, so the site can name itself', () => {
    // **Drives the real plugin**, imported from the config the production build uses — the
    // same discipline `demo-bench.e2e.test.ts` applies to `perfReport`. A fixture written to
    // agree with the config would prove only that two files agree.
    //
    // The gap this closes was found by falling into it on 2026-09-01: nothing in the published
    // site said what it was, so the only record was the `gh-pages` commit message — which
    // names the DEPLOYED NODE's version, read from `/self`. It was read as the client's, and a
    // site byte-identical to a fresh build was reported a release behind.
    const version: unknown = JSON.parse(readFileSync(`${ROOT}/package.json`, 'utf8')).version
    expect(typeof version, 'the root package.json has no version to stamp').toBe('string')

    const identity = buildIdentity()
    expect(identity, 'the stamp does not name the released version').toContain(String(version))
    // A commit, or a named absence. Never a blank: this exists to answer a question, and an
    // empty answer is indistinguishable from a page that predates the stamp entirely.
    expect(identity, 'the stamp names no commit and does not say so either').toMatch(
      /^\S+ (?:[0-9a-f]{7}(?:-dirty)?|no-commit)$/,
    )

    // **Wired, not merely written — and this assertion exists because the case without it
    // had the hole it is named for.** Every check below drives the plugin directly, so
    // deleting `stampBuildIdentity()` from the config's `plugins` array would have left the
    // whole case green while the real build emitted no stamp at all. The production build is
    // the subject; a plugin nothing runs is not one.
    const named = (entry: unknown): entry is { readonly name: string } =>
      typeof entry === 'object' && entry !== null && 'name' in entry
    // A FIXED depth, not `Infinity`: vite's `PluginOption` is recursive, and `flat(Infinity)`
    // makes tsc give up with TS2589 rather than type the result.
    const wired = (Array.isArray(viteConfig.plugins) ? viteConfig.plugins : [])
      .flat(4)
      .filter(named)
      .map((entry) => entry.name)
    expect(wired, 'the production build no longer runs the stamp').toContain('o2-build-identity')

    const plugin = stampBuildIdentity()
    const transform = plugin.transformIndexHtml
    expect(typeof transform, 'the plugin no longer transforms the page').toBe('function')
    if (typeof transform !== 'function') return

    const page = '<!doctype html>\n<html>\n  <head>\n    <meta name="viewport" content="x" />\n  </head>\n</html>'
    const stamped = transform.call({} as never, page, {} as never)
    expect(typeof stamped, 'the transform returned something other than html').toBe('string')
    if (typeof stamped !== 'string') return

    expect(stamped).toContain(`<meta name="o2-build" content="${identity}" />`)
    // In the HEAD, and before the tag it anchors on — a stamp appended after `</html>` is a
    // stamp `curl | sed` still finds and a parser does not.
    expect(stamped.indexOf('o2-build'), 'the stamp is not inside <head>').toBeLessThan(
      stamped.indexOf('</head>'),
    )
    // The page it was given is otherwise untouched: this must not become a transform that
    // rewrites the document and happens to include the tag.
    expect(stamped.replace(/\s*<meta name="o2-build"[^>]*\/>/, '')).toBe(page)
  })

  it('will not publish, and will not call a publish good, unless the page carries the stamp', () => {
    // The stamp is checked in THREE places and each one covers a different failure:
    //   * the dry run, so a missing stamp is found before anything is pushed;
    //   * the refusal before `git push`, so a build that lost it cannot be published at all;
    //   * the read-back, so a push that served an older page is not called a success.
    // A field nobody reads is a claim nobody checks, and that is the shape this repository
    // keeps having to retire.
    const commands = SCRIPT.split('\n').filter((line) => !line.trim().startsWith('#'))
    const mentions = commands.filter((line) => line.includes('o2-build'))
    expect(
      mentions.length,
      'the publish script no longer reads the build stamp in all three places — dry-run ' +
        'check, refusal before push, and read-back of the live site',
    ).toBeGreaterThanOrEqual(3)
    expect(SCRIPT).toContain('Refusing to publish a')
    expect(SCRIPT).toContain('does not name the build this run published')
  })

  it('leaves the tree as it found it, because the generated bootstrap breaks four e2e specs', () => {
    // **A source read, and the behavioural guard is elsewhere on purpose** — it is the four
    // e2e files themselves. `attestation-ui`, `built-bundle`, `peer-ledger` and
    // `static-rendezvous` all serve `packages/browser/dist`, and all four model a STATIC HOST
    // where `/bootstrap.json` 404s. This script generates that file into
    // `packages/browser/demo/public/`, which is untracked and which vite copies verbatim into
    // the bundle, so leaving it behind serves those specs the address of the LIVE PRODUCTION
    // RELAY instead. Measured 2026-09-01 on a quiet host: 7 cases red, and 29 of 29 green with
    // the file removed. Nothing here can restate that better than they do; what this case
    // holds is the two ways the restoration silently stops happening.
    const commands = SCRIPT.split('\n').filter((line) => !line.trim().startsWith('#'))

    // One. A `trap ... EXIT` REPLACES any previous one rather than adding to it, so a second
    // handler for a second resource silently drops the first — which is exactly how the
    // worktree cleanup and this one would have collided.
    const traps = commands.filter((line) => /^\s*trap\s/.test(line))
    expect(
      traps.length,
      'more than one EXIT trap: a second `trap ... EXIT` discards the first, so one of the ' +
        'two cleanups no longer runs',
    ).toBe(1)

    // Two. The removal must be conditional on this run having created the file. An
    // unconditional `rm` deletes a file the operator put there, and a missing flag means the
    // dry run goes back to leaving one behind.
    expect(commands.some((line) => /CREATED_BOOTSTRAP=1/.test(line))).toBe(true)
    expect(commands.some((line) => /CREATED_PUBLIC=1/.test(line))).toBe(true)
    expect(SCRIPT).toContain('rm -f "$PUBLIC/bootstrap.json"')
  })

  it('carries nothing into the publish that the build did not emit', () => {
    // **Behavioural, and it drives the SCRIPT'S OWN LINE rather than a copy of one.** The
    // staging command is lifted out of `deploy-pages.sh` by pattern and executed here, so a
    // future edit that drops it cannot leave this case green: the lookup fails first.
    //
    // The defect, measured 2026-09-01 rather than imagined. Vite's `emptyOutDir` clears the
    // output directory between builds but PRESERVES DOTFILES — upstream's guard against
    // nuking a git-based deploy setup — and this repository's own `packages/browser/dist/`
    // held a full clone checked out on `gh-pages` at `v2.0.0-rc.4`, left behind when the
    // script moved from `git checkout gh-pages` to a temp worktree. `cp -R "$DIST/."` carried
    // it into the publish tree, where it landed on that worktree's own `.git` and made
    // `git add -A` read a foreign index: the staging came out with five `src-*` assets from an
    // August build and **without `bootstrap.json`**, without the stylesheet and without the
    // task-executor worker. A `--live` run from that laptop publishes a site whose discovery
    // endpoint is absent, and `discoverRelays` then reports `source: 'none'` — the documented
    // NORMAL state this whole file exists because of.
    //
    // CI never saw it, because a fresh checkout has no stray. That is precisely the shape that
    // breaks `deploy.yml`'s claim that this one script "runs identically on a laptop".
    const staging = SCRIPT.split('\n').find(
      (line) => /^find "\$WORK" .*-name '\.\*'.*rm -rf/.test(line.trim()),
    )
    expect(
      staging,
      'deploy-pages.sh no longer strips dot-entries from the staging copy — a stray dotfile ' +
        'under dist/ reaches gh-pages again',
    ).toBeDefined()
    if (staging === undefined) return

    const work = mkdtempSync(join(tmpdir(), 'o2-publish-staging-'))
    try {
      // A stand-in `dist`: what a build emits, plus the two shapes a dotfile takes.
      writeFileSync(join(work, 'index.html'), '<!doctype html>')
      writeFileSync(join(work, 'bootstrap.json'), '{}')
      mkdirSync(join(work, 'assets'))
      writeFileSync(join(work, 'assets', 'index-abc.js'), '// asset')
      mkdirSync(join(work, '.git'))
      writeFileSync(join(work, '.git', 'HEAD'), 'ref: refs/heads/gh-pages\n')
      writeFileSync(join(work, '.DS_Store'), 'junk')

      execFileSync('bash', ['-c', staging], { env: { ...process.env, WORK: work } })

      const left = readdirSync(work).sort()
      // The emitted files survive untouched — this must not become a check that deletes
      // everything and passes.
      expect(left).toEqual(['assets', 'bootstrap.json', 'index.html'])
      expect(readdirSync(join(work, 'assets'))).toEqual(['index-abc.js'])
    } finally {
      rmSync(work, { recursive: true, force: true })
    }
  })

  it('uses a worktree rather than switching the shared checkout to gh-pages', () => {
    // Concurrent agents share one working tree here. `git checkout gh-pages` in a shared tree
    // is how another agent's in-progress work disappears.
    expect(SCRIPT).toContain('git worktree add')
    // **A COMMAND, not the phrase.** The first version of this line matched the docblock above
    // that explains why the command is forbidden — the third time in this repository that
    // prose about a literal has tripped a check over the literal. A shell command is a line
    // that starts with it; a comment starts with `#`.
    const commands = SCRIPT.split('\n').filter((line) => !line.trim().startsWith('#'))
    expect(commands.filter((line) => /^\s*git checkout\s+gh-pages/.test(line))).toEqual([])
  })
})
