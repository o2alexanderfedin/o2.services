import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import type { Plugin } from 'vite'

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

/**
 * Production bundle for the browser node.
 *
 * `base: './'` keeps every asset reference relative, which is what a project page
 * served from a `/<repo>/` subpath needs. Building is *not* deploying: this produces
 * a directory and publishes nothing.
 */
export default defineConfig({
  root: new URL('./demo', import.meta.url).pathname,
  base: './',
  plugins: [perfReport()],
  build: {
    outDir: new URL('./dist', import.meta.url).pathname,
    emptyOutDir: true,
    target: 'es2023',
  },
})
