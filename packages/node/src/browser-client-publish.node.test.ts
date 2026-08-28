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
 */

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

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
