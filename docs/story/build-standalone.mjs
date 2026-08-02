/**
 * Render the article to a self-contained HTML page and a PDF.
 *
 * The page `build-page.py` emits leaves each diagram as a `<pre class="mermaid">`,
 * which only becomes a picture where a mermaid runtime is present. That is right for
 * the hosted artifact and wrong for a file you open from disk or print — so this
 * script renders the six diagrams **to inline SVG once, at build time**, and writes a
 * page that needs no script, no network and no runtime at all.
 *
 * Mermaid is deliberately NOT a dependency of this repository. It is installed into a
 * scratch directory and passed in by path, because a documentation renderer has no
 * business in the dependency tree of a compute kernel.
 *
 *   node docs/story/build-standalone.mjs <in.html> <out.html> <out.pdf> <mermaid.min.js>
 *
 * The SVGs are rendered on a light ground and are single-theme by consequence. That is
 * stated rather than hidden: a printed page has one ground, and a diagram whose colours
 * came from a theme the reader is not using is worse than one that commits.
 */
import { readFile, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'

const [, , IN, OUT_HTML, OUT_PDF, MERMAID] = process.argv
if (!IN || !OUT_HTML || !OUT_PDF || !MERMAID) {
  console.error('usage: build-standalone.mjs <in.html> <out.html> <out.pdf> <mermaid.min.js>')
  process.exit(2)
}

const shell = await readFile(IN, 'utf8')
const mermaidSrc = await readFile(MERMAID, 'utf8')

/**
 * Print rules, added only to the standalone copy.
 *
 * The hosted page is scrolled; this one is paginated, and the two want different
 * things. Chapters start on a fresh page, nothing is orphaned from its heading, and
 * the reading-progress bar — meaningless on paper — is removed.
 */
const PRINT_CSS = `
<style>
  @page { size: A4; margin: 20mm 18mm 22mm; }
  @media print {
    .progress { display: none !important; }
    .wrap { max-width: none; padding: 0; }
    .chapter { break-before: page; page-break-before: always; }
    .chapter-head, h3 { break-after: avoid; page-break-after: avoid; }
    .diagram, blockquote, .listing, table { break-inside: avoid; page-break-inside: avoid; }
    .chapter-num { position: static !important; width: auto !important; text-align: left !important; }
    a { text-decoration: none; }
    body { font-size: 10.5pt; }
  }
  /* the rendered diagrams carry their own ground, so they read on either theme */
  .diagram .mermaid svg { background: #ffffff; border-radius: 2px; }
</style>`

const browser = await chromium.launch()
const page = await browser.newPage()

// Force the light theme for rendering: the SVGs are baked once and a diagram cannot
// carry two grounds.
await page.emulateMedia({ colorScheme: 'light' })
await page.setContent(shell, { waitUntil: 'load' })
await page.addScriptTag({ content: mermaidSrc })

const rendered = await page.evaluate(async () => {
  const nodes = [...document.querySelectorAll('pre.mermaid')]
  // eslint-disable-next-line no-undef
  mermaid.initialize({ startOnLoad: false, theme: 'neutral', securityLevel: 'strict' })
  let ok = 0
  for (const [i, el] of nodes.entries()) {
    const src = el.textContent ?? ''
    try {
      // eslint-disable-next-line no-undef
      const { svg } = await mermaid.render(`d${i}`, src)
      el.outerHTML = `<div class="mermaid">${svg}</div>`
      ok += 1
    } catch (cause) {
      throw new Error(`diagram ${i} did not render: ${String(cause)}`)
    }
  }
  return { found: nodes.length, ok }
})

if (rendered.found !== rendered.ok) {
  throw new Error(`only ${rendered.ok} of ${rendered.found} diagrams rendered`)
}

// The standalone copy: rendered DOM, print rules, and no script of any kind.
const html = await page.evaluate(() => document.documentElement.outerHTML)
const standalone = html
  .replace(/<script[\s\S]*?<\/script>/g, '')
  .replace('</head>', `${PRINT_CSS}\n</head>`)
await writeFile(OUT_HTML, standalone, 'utf8')

await page.setContent(standalone, { waitUntil: 'load' })
await page.emulateMedia({ media: 'print', colorScheme: 'light' })
await page.pdf({
  path: OUT_PDF,
  format: 'A4',
  printBackground: true,
  displayHeaderFooter: true,
  headerTemplate: '<div></div>',
  footerTemplate:
    '<div style="width:100%;font:9px -apple-system,sans-serif;color:#8d98a2;padding:0 18mm;' +
    'display:flex;justify-content:space-between"><span>The Author Forgets</span>' +
    '<span class="pageNumber"></span></div>',
  margin: { top: '20mm', bottom: '22mm', left: '18mm', right: '18mm' },
})

await browser.close()
console.log(`rendered ${rendered.ok}/${rendered.found} diagrams to inline SVG`)
console.log(`html ${OUT_HTML}`)
console.log(`pdf  ${OUT_PDF}`)
