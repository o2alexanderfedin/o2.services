import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import type { Plugin, UserConfig } from 'vite'

/**
 * The one committed copy of the performance report, as an absolute path.
 *
 * Written by `docs/perf/build-report.py`, committed, and read here. It is **not** copied
 * into `packages/browser/demo/`: a second copy in the tree is a second thing to keep in
 * step, the generator writes only one of them, and the two would drift the first time the
 * numbers were re-measured. UI-SPEC section 4.7 requires the Benchmarks surface's figures
 * to come from one document; the page a visitor clicks through to should come from the
 * same place.
 */
const REPORT = fileURLToPath(new URL('../../docs/perf/prime-and-pi-benchmarks.html', import.meta.url))

/** Where the report is served and emitted, relative to whatever root is in force. */
const AT = 'perf/index.html'

/**
 * Read the committed report, or fail naming the generator that writes it.
 *
 * A missing source **fails the build**. Emitting nothing would reproduce, inside a build
 * step, exactly the state this plugin exists to leave behind: a footer link pointing at a
 * `perf/` directory that does not exist. A build that silently ships a broken link is worse
 * than a build that stops, because only one of the two says so.
 */
function readReport(): string {
  try {
    return readFileSync(REPORT, 'utf8')
  } catch (cause) {
    throw new Error(
      `the demo bundle links ./perf/index.html and ${REPORT} is not readable. ` +
        'It is a committed artifact produced by docs/perf/build-report.py — run that ' +
        'script, or restore the file, before building the demo.',
      { cause },
    )
  }
}

/**
 * Serve and emit `docs/perf/prime-and-pi-benchmarks.html` at `perf/index.html`, from the
 * one committed source.
 *
 * ## Why both halves
 *
 * `index.html`'s footer and the Benchmarks surface both link `./perf/index.html`. Until this
 * plugin the built bundle contained no `perf/` directory at all — UI-SPEC section 10 records
 * the gap and leaves the packaging decision to the plan — so the link resolved nowhere. Half
 * a fix would be worse than none: a link that works on the dev server and 404s on the static
 * host is a link that is right in the environment nobody visits.
 *
 * - `generateBundle` emits the file into the bundle, so a static host has it.
 * - `configureServer` serves the same bytes in dev, so the two behave alike.
 *
 * ## Why the middleware matches on a path SUFFIX
 *
 * The dev server runs at two different roots in this repository. `npm run dev` uses this
 * config, whose `root` is `./demo`, so the page is at `/index.html` and the relative link
 * resolves to `/perf/index.html`. Every e2e spec instead starts Vite with `root` at the
 * repository root and loads `/packages/browser/demo/index.html`, where the *same relative
 * link* resolves to `/packages/browser/demo/perf/index.html`. Matching the suffix is what
 * makes the link the page actually renders resolve in both, rather than making the page
 * render a link that only one of the two environments can follow.
 */
export function perfReport(): Plugin {
  return {
    name: 'o2-perf-report',
    // Read at build/serve time rather than at module load, so importing this config — which
    // `demo-bench.e2e.test.ts` does, to get the same plugin the real build uses — cannot
    // throw before anything has asked for the file.
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const path = (request.url ?? '').split('?')[0] ?? ''
        if (!path.endsWith('/perf/') && !path.endsWith(`/${AT}`) && path !== `/${AT}`) {
          next()
          return
        }
        response.setHeader('content-type', 'text/html; charset=utf-8')
        response.end(readReport())
      })
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: AT, source: readReport() })
    },
  }
}

/** The repository root, for the two files this build reads its identity out of. */
const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url))

/**
 * What this build IS, as one string: the released version and the commit it came from.
 *
 * **The gap this closes was found by falling into it.** Nothing in the published site said
 * what it was — not `index.html`, not `bootstrap.json`, not one asset — so the only record of
 * what is live was the `gh-pages` commit message. That message names the version read from
 * the deployed NODE's `/self`, and on 2026-09-01 it was read as the client's: `gh-pages` sat
 * at `rc.7` while the node answered `rc.8`, the client was reported a release behind, and it
 * was not — a fresh build was byte-identical to what was published. A site that can name
 * itself makes that misreading impossible rather than merely unlikely.
 *
 * `--dirty` is not decoration. A build from an edited tree describes no commit, and a string
 * that silently claims one is worse than no string: it is a wrong answer to the only question
 * this exists to answer.
 *
 * A tree with no git available still builds. The identity degrades to the version alone and
 * says so — `no-commit` rather than a blank, because absence has to be readable as absence.
 */
export function buildIdentity(): string {
  const version: unknown = JSON.parse(readFileSync(`${REPO_ROOT}/package.json`, 'utf8')).version
  const released = typeof version === 'string' ? version : 'no-version'
  let commit = 'no-commit'
  try {
    const git = (...args: readonly string[]): string =>
      execFileSync('git', [...args], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim()
    // **`rev-parse`, deliberately, and `describe` was tried first.** `git describe --always`
    // answered `v1.1-466-gd051f28` here: it reaches for the nearest reachable tag, and the
    // nearest one is an old release whose name contradicts the version beside it. The commit
    // is the only thing wanted, so it is the only thing asked for.
    const head = git('rev-parse', `--short=7`, 'HEAD')
    // Dirtiness is asked SEPARATELY rather than taken from `--dirty`, because the flag is a
    // property of `describe` and this no longer uses it.
    commit = git('status', '--porcelain') === '' ? head : `${head}-dirty`
  } catch {
    // Left as `no-commit`. A build outside a checkout is a real case — an npm tarball, a
    // container with the history stripped — and it must not fail here.
  }
  return `${released} ${commit === '' ? 'no-commit' : commit}`
}

/**
 * Stamp {@link buildIdentity} into the page's head, so the published site can name itself.
 *
 * ## Why a `<meta>` in the head and not something a visitor sees
 *
 * Not squeamishness — this page is under an exhaustive UI guard. `demo-regions.e2e.test.ts`
 * counts every figure against `UI_SPEC_TALLY.total` and checks the per-surface and per-kind
 * splits, so a visible element is a catalogue change and a spec change before it is an
 * identity. The head carries no region, renders nothing, and is reachable by `curl` and by
 * view-source, which is who actually asks this question.
 *
 * It also makes no request, so `built-bundle.e2e.test.ts`'s P10 — every request the page makes
 * before consent is same-origin — is untouched by construction rather than by permission.
 *
 * ## Why this is not decoration
 *
 * `scripts/deploy-pages.sh` reads this tag back off the live site after publishing and refuses
 * to call the publish good unless the site names the build it just pushed. A field nobody
 * reads is a claim nobody checks, and this repository has retired several of those.
 */
export function stampBuildIdentity(): Plugin {
  return {
    name: 'o2-build-identity',
    // `enforce: 'post'` so the tag is appended after any plugin that rewrites the head; the
    // read-back in deploy-pages.sh greps for it, and a transform that dropped it would turn
    // a green publish into a false one.
    enforce: 'post',
    transformIndexHtml(html: string): string {
      const identity = buildIdentity()
      return html.replace(
        '<meta name="viewport"',
        `<meta name="o2-build" content="${identity}" />\n    <meta name="viewport"`,
      )
    },
  }
}

/**
 * Production bundle for the browser node.
 *
 * `base: './'` keeps every asset reference relative, which is what a project page
 * served from a `/<repo>/` subpath needs. Building is *not* deploying: this produces
 * a directory and publishes nothing.
 *
 * Bound to a named, explicitly-typed constant rather than exported inline. `tsconfig.json`
 * sets `isolatedDeclarations`, under which an inferred default export is an error — and this
 * file became subject to it the moment `demo-bench.e2e.test.ts` imported {@link perfReport}
 * from it, which is the point of importing it there: the spec checks the configuration the
 * real build uses rather than a fixture written to agree with it.
 */
const config: UserConfig = defineConfig({
  root: new URL('./demo', import.meta.url).pathname,
  base: './',
  plugins: [perfReport(), stampBuildIdentity()],
  build: {
    outDir: new URL('./dist', import.meta.url).pathname,
    emptyOutDir: true,
    target: 'es2023',
    /**
     * Every page this site serves, named — because Vite builds **only** `index.html` when
     * nothing is named, and a page that is only in `demo/` is a page no volunteer can reach.
     *
     * ## CORRECTED 2026-09-02, and the defect was live on the published site
     *
     * `demo/index.html` creates an `<a href="./policy.html">` inside `#gate-version` — the
     * disclosure's third reader, written for somebody assessing this page for a blocklist.
     * This block had no `rollupOptions.input`, so `dist/` held `index.html`, `assets/` and
     * `perf/` and no `policy.html`, and the link 404ed on the live site. Confirmed against
     * `https://o2alexanderfedin.github.io/o2.services/policy.html` — **HTTP 404**, with the
     * site root answering **200** as the control, and the string `policy.html` present in the
     * live bundle. Working:
     * `.planning/debug/2026-09-02-the-policy-page-404s-in-production.md`.
     *
     * **It failed silently and it failed for a checkable reason.** The link is assigned from
     * JavaScript, so it never appeared in a grep over served HTML; and every guard that could
     * have caught it reads the **source tree**, where the file has always existed. A proof that
     * reads `demo/` cannot see a build that omits a file. That is why
     * `kill-switch-volunteer.e2e.test.ts` runs the real production build and reads `dist/`.
     *
     * Naming the inputs also gets `stampBuildIdentity` onto all three, because
     * `transformIndexHtml` runs per HTML input — so `status.html` carries the `o2-build` meta
     * it reads back, and so does `policy.html`.
     *
     * `scripts/deploy-pages.sh` copies `$DIST/.` wholesale and checks `index.html` and
     * `bootstrap.json` by name, so two more emitted pages cost the deploy path nothing. Read
     * before this landed rather than assumed: that script has already been broken once by a
     * change no local run could reach.
     */
    rollupOptions: {
      input: {
        index: new URL('./demo/index.html', import.meta.url).pathname,
        policy: new URL('./demo/policy.html', import.meta.url).pathname,
        status: new URL('./demo/status.html', import.meta.url).pathname,
      },
    },
  },
})

export default config
