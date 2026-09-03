import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * Every page the demo names is a page the build emits — **derived, never listed**.
 *
 * ## The gap, and the 404 that opened it
 *
 * `packages/browser/vite.config.ts` declared no `rollupOptions.input`, so `dist/` held
 * `index.html`, `assets/` and `perf/` and no `policy.html`. The link 404ed on the live
 * site — confirmed against the published URL, HTTP 404, with the site root answering 200
 * as the control. The fix names three inputs, and the guard written beside it
 * (`kill-switch-volunteer.e2e.test.ts`) asserts *"emits status.html AND policy.html into
 * the build output"* — **two named pages**.
 *
 * A seventh page linked tomorrow and left out of `rollupOptions.input` 404s in exactly
 * the same way, and a list of two catches nothing about it. `scripts/cheap-guards.sh`
 * states the principle it is an exception to: *a list maintained beside a rule drifts
 * from the rule*. This file is the rule.
 *
 * ## Two things this reads that a source-tree proof cannot
 *
 * 1. **It reads `dist/`.** A proof that reads `demo/` cannot see a build that omits a
 *    file — `policy.html` existed in the repository the entire time it was 404ing. That
 *    is the whole reason the existing guard runs a real build first, and the whole reason
 *    the cases here skip loudly rather than passing when there is no build to read.
 * 2. **It reads JavaScript, not only `href=` attributes.** `demo/index.html` assigns
 *    `policy.href = './policy.html'` from an inline module script, so the link never
 *    appeared in a grep over served HTML markup, and after a build it lives in
 *    `dist/assets/*.js` rather than in `dist/index.html` at all. A scan restricted to
 *    markup attributes reproduces the blindness that let the 404 ship, and there is a
 *    case below that plants exactly that restriction and shows it missing the page.
 *
 * ## The plants this file must survive
 *
 * - Delete one entry from `rollupOptions.input` in `packages/browser/vite.config.ts` and
 *   rebuild: *every page the demo names is emitted* goes red naming the missing file. On
 *   a stale `dist/` the config half still reddens — *a page the demo names is declared as
 *   a build input* — because the entry is gone from the config text.
 * - Add `<a href="./roadmap.html">` to `demo/index.html` without adding it to
 *   `rollupOptions.input`: *a page the demo names is declared as a build input* goes red
 *   naming `roadmap.html`. That is the future 404, caught before it is published.
 * - Break the derivation itself — make `pagesIn` return nothing — and the anti-vacuity
 *   cases go red rather than every "is emitted" case passing on an empty set. A scan that
 *   reads nothing passes exactly as loudly as a scan that finds nothing wrong, and this
 *   repository has already closed one criterion on an empty read.
 *
 * ## What is derived rather than exempted
 *
 * `perf/index.html` is named by the demo and is **not** a `rollupOptions.input` entry: it
 * is emitted by the `perfReport` plugin from a committed report outside `demo/`. Nothing
 * here exempts it. The input cross-check applies to a referenced page **only when
 * `demo/<page>` exists on disk**, and `demo/perf/index.html` does not — so the plugin's
 * page falls out of that check by derivation and stays inside the "is emitted" check,
 * which is the one that would have caught its link breaking.
 *
 * `status.html` is the opposite case and is also not an exemption: it is a build input
 * that nothing in `demo/` links to, because it is reached by URL with a `?self=`
 * parameter. So the cross-check runs referenced → declared and not the reverse; the
 * reverse would refuse a page that is deliberately deep-linked.
 *
 * Node-only: reads real files off disk.
 */

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const DEMO = join(ROOT, 'packages', 'browser', 'demo')
const DIST = join(ROOT, 'packages', 'browser', 'dist')
const CONFIG_PATH = join(ROOT, 'packages', 'browser', 'vite.config.ts')

/**
 * The build output, or the reason there is none.
 *
 * `packages/browser/dist/` is gitignored, so a fresh checkout has no build to read. The
 * cases that read it skip **loudly**, naming the command that produces one — a silent
 * skip on a missing artifact is a guard that reports itself healthy in exactly the
 * situation it cannot see anything.
 */
const DIST_PRESENT = existsSync(join(DIST, 'index.html'))

const NO_BUILD_NOTE =
  `[built-pages] no build at ${relative(ROOT, DIST)}/index.html, so the emitted-output ` +
  'cases cannot read anything and are SKIPPED, not passed. Produce one with ' +
  '`npx vite build --config packages/browser/vite.config.ts` (or run ' +
  '`kill-switch-volunteer.e2e.test.ts`, which builds in beforeAll) and re-run. The ' +
  'config-vs-demo cases below do not need a build and ran.\n'

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) walk(path, out)
    else out.push(path)
  }
  return out
}

/**
 * Every page a text names, as a bundle-relative path.
 *
 * Matches `./<something>.html` in any quoting — a markup attribute, a JavaScript string
 * literal, a template literal. **Deliberately not anchored to `href=`**: see the file
 * docblock, and the planted case that shows the attribute-only form missing the page the
 * 404 was about.
 *
 * The leading `./` is required rather than optional. Without it the pattern harvests
 * every prose mention of a filename in a comment, and the corpus here is full of
 * comments that discuss these pages by name.
 */
function pagesIn(text: string): string[] {
  return [...text.matchAll(/\.\/([A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*\.html)\b/g)]
    .map((match) => match[1])
    .filter((page): page is string => page !== undefined)
}

/** The attribute-only form, kept solely so a case can watch it miss `policy.html`. */
function hrefPagesIn(text: string): string[] {
  return [...text.matchAll(/href="\.\/([A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*\.html)"/g)]
    .map((match) => match[1])
    .filter((page): page is string => page !== undefined)
}

/** Files worth scanning: the demo's own sources, and the built bundle's text output. */
function textFiles(dir: string): string[] {
  return walk(dir).filter((path) => /\.(html|ts|js|css)$/.test(path))
}

const DEMO_SOURCES: readonly string[] = textFiles(DEMO)
const BUNDLE_FILES: readonly string[] = DIST_PRESENT ? textFiles(DIST) : []

function pagesAcross(files: readonly string[]): Set<string> {
  const found = new Set<string>()
  for (const file of files) for (const page of pagesIn(readFileSync(file, 'utf8'))) found.add(page)
  return found
}

/** Named by the demo's own sources. */
const REFERENCED_IN_SOURCE = pagesAcross(DEMO_SOURCES)
/** Named by the built bundle — the half that sees a link the bundler moved into an asset. */
const REFERENCED_IN_BUNDLE = pagesAcross(BUNDLE_FILES)
/** The union. A page named by either has to resolve. */
const REFERENCED: readonly string[] = [
  ...new Set([...REFERENCED_IN_SOURCE, ...REFERENCED_IN_BUNDLE]),
].sort()

/**
 * The build's declared HTML inputs, parsed out of the config's **source text**.
 *
 * Read rather than imported, on `slow-specs.node.test.ts`'s stated idiom: importing
 * `vite.config.ts` evaluates `defineConfig`, runs `buildIdentity()` — which shells out to
 * `git` — and pulls vite into the Node lane, none of which a guard about file names has
 * any business doing.
 */
const CONFIG = readFileSync(CONFIG_PATH, 'utf8')

const DECLARED_INPUTS: readonly string[] = (() => {
  const block = /rollupOptions:\s*\{[\s\S]*?input:\s*\{([\s\S]*?)\}/.exec(CONFIG)?.[1] ?? ''
  return [...block.matchAll(/\.\/demo\/([A-Za-z0-9_/-]+\.html)/g)]
    .map((match) => match[1])
    .filter((page): page is string => page !== undefined)
    .sort()
})()

/** Does this referenced page have a source file under `demo/`? */
function hasDemoSource(page: string): boolean {
  return existsSync(join(DEMO, page))
}

describe('the scan read what it claims to have read', () => {
  it('found the demo sources and the pages they name', () => {
    // Floors, because every interesting assertion below is of the shape "this set is
    // covered". A walk that returned nothing satisfies all of them perfectly.
    expect(DEMO_SOURCES.length).toBeGreaterThan(3)
    expect(REFERENCED.length).toBeGreaterThanOrEqual(2)
    // By name, so a derivation that collapsed to some other page cannot pass. These two
    // are the ones the incident was about: `policy.html` is the page that 404ed, and
    // `perf/index.html` is the one emitted by a plugin rather than by an input entry.
    expect(REFERENCED).toContain('policy.html')
    expect(REFERENCED).toContain('perf/index.html')
  })

  it('reads the config and finds three declared HTML inputs', () => {
    expect(DECLARED_INPUTS.length).toBeGreaterThanOrEqual(3)
    expect(DECLARED_INPUTS).toContain('index.html')
    expect(DECLARED_INPUTS).toContain('policy.html')
    expect(DECLARED_INPUTS).toContain('status.html')
  })

  it('finds policy.html only because it reads JavaScript, not only href attributes', () => {
    // **The blindness that let the 404 ship, planted and watched.** `demo/index.html`
    // creates the link in script: `policy.href = './policy.html'`. Every guard that could
    // have caught the missing build input read markup, and markup does not carry it.
    const index = readFileSync(join(DEMO, 'index.html'), 'utf8')
    expect(pagesIn(index)).toContain('policy.html')
    expect(hrefPagesIn(index)).not.toContain('policy.html')
    // …and the attribute form is not simply broken: it finds the links that ARE markup.
    expect(hrefPagesIn(index)).toContain('perf/index.html')
  })
})

describe('the build config and the pages the demo names cannot drift apart', () => {
  it('declares every referenced page that has a file under demo/ as a build input', () => {
    // The future 404, caught at its cause. A page linked from the demo, existing as a
    // source file, and absent from `rollupOptions.input` is emitted by nothing.
    const undeclared = REFERENCED.filter(
      (page) => hasDemoSource(page) && !DECLARED_INPUTS.includes(page),
    )
    expect(
      undeclared,
      'these pages are linked from the demo and exist under packages/browser/demo/, but ' +
        'no rollupOptions.input entry in packages/browser/vite.config.ts names them, so ' +
        'the build emits nothing for them and the link 404s on the static host — the ' +
        'exact failure policy.html shipped with.',
    ).toEqual([])
  })

  it('declares no input whose source file is missing', () => {
    // The other way a build breaks: an input naming a file that was renamed or deleted.
    // Rollup fails the build on it, but the config is where the fix goes and this says so
    // without a build.
    const missing = DECLARED_INPUTS.filter((page) => !hasDemoSource(page))
    expect(missing).toEqual([])
  })
})

describe('every page the demo names is in the build output', () => {
  it('emits each referenced page into dist/', (ctx) => {
    if (!DIST_PRESENT) {
      // `process.stdout.write`, not `console.log` and not `ctx.skip(note)` — the note
      // passed to `ctx.skip` is swallowed, as `late-combine.node.test.ts` records.
      process.stdout.write(NO_BUILD_NOTE)
      ctx.skip()
      return
    }
    const missing = REFERENCED.filter((page) => !existsSync(join(DIST, page)))
    expect(
      missing,
      `these pages are named by the demo or by its own built bundle and are absent from ` +
        `${relative(ROOT, DIST)}. Each one is a link that resolves nowhere on the static ` +
        'host. Add the page to rollupOptions.input in packages/browser/vite.config.ts, or ' +
        'emit it from a plugin as perfReport does, then rebuild.',
    ).toEqual([])
  })

  it('emits each declared build input into dist/', (ctx) => {
    if (!DIST_PRESENT) {
      process.stdout.write(NO_BUILD_NOTE)
      ctx.skip()
      return
    }
    // Not the same claim as the case above, and both are needed: `status.html` is
    // declared and referenced by nothing, so only this case covers it. A page a visitor
    // reaches by URL is still a page the build has to emit.
    const missing = DECLARED_INPUTS.filter((page) => !existsSync(join(DIST, page)))
    expect(missing).toEqual([])
  })

  it('read a bundle that really carries the script-assigned link', (ctx) => {
    if (!DIST_PRESENT) {
      process.stdout.write(NO_BUILD_NOTE)
      ctx.skip()
      return
    }
    // Anti-vacuity for the bundle half specifically. If the walk over `dist/` picked up
    // no JavaScript, `REFERENCED_IN_BUNDLE` would be empty and the union above would
    // silently degrade to the source-tree scan — which is precisely the instrument that
    // could not see this defect. So the bundle is required to name the page, from an
    // asset rather than from markup.
    expect(BUNDLE_FILES.length).toBeGreaterThan(2)
    expect([...REFERENCED_IN_BUNDLE]).toContain('policy.html')
    const assets = BUNDLE_FILES.filter((path) => path.endsWith('.js'))
    const inAnAsset = assets.some((path) => pagesIn(readFileSync(path, 'utf8')).includes('policy.html'))
    expect(
      inAnAsset,
      'no built asset names ./policy.html. The inline module script that assigns ' +
        'policy.href is where that string lives after a build; if it is gone, either the ' +
        'link was removed from demo/index.html or this scan stopped reading assets.',
    ).toBe(true)
  })
})
