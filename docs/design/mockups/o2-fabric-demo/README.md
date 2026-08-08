# o2 Fabric Demo — UI mockup

A non-functional design mockup of the demo page, covering all four workloads rather than
the one the shipped page runs. Imported verbatim from the Claude Design project that
produced it:

<https://claude.ai/design/p/56149008-0d87-4824-939f-690d17769acd?file=o2+Fabric+Demo.dc.html>

Its input was [`../../templates/ui-mockup-requirements.md`](../../templates/ui-mockup-requirements.md),
which is the brief this mockup was designed against. Read that first — it is the document
with the source citations; this is one visual answer to it.

## What is here

| file | what it is |
|---|---|
| `o2 Fabric Demo.dc.html` | the mockup — a `<x-dc>` template with the screens and their placeholder data |
| `support.js` | the Claude Design `dc-runtime`, generated and vendored; parses the template and renders it |
| `_ds/industry-…/styles.css` | the design system: custom properties on `:root`, plus the component classes the mockup uses |
| `_ds/industry-…/_ds_bundle.js` | the design system's component bundle — empty; this system is pure CSS |

## Opening it

**Serve it over HTTP; do not open the file directly.** The runtime re-fetches the document
to parse it, and `fetch` refuses the `file://` scheme, so a double-click renders a degraded
page and logs an error. From this directory:

```sh
python3 -m http.server 8731
# then open http://127.0.0.1:8731/o2%20Fabric%20Demo.dc.html
```

Verified 2026-08-08: served this way it renders with **zero** console errors, page errors,
or failed requests, in headless Chromium at 1280×1000.

**It needs network access.** `support.js` loads React 18, ReactDOM 18 and
`@babel/standalone` from `unpkg.com` at runtime. Nothing else is fetched, and no part of
this mockup talks to a fabric — every figure on screen is placeholder data.

## What it shows

Consent gate → a nav across `A · Colouring`, `B · Primes`, `C · π & reduce`,
`D · Bring your own`, `Fabric state` and `Benchmarks`. The colouring screen carries the
inputs (cubes, redundancy, budget, `MAX_N`), the measured-reach staircase, the N ladder
with its per-rung status, and the "check this answer yourself" panel. The always-visible
activity bar runs along the bottom with duty cycle, peer count, `servedFor`, and Stop.

## Editing it

Edit it in the Claude Design project and re-import, rather than by hand here — the design
system files especially are generated. Two guards in this repository name paths inside
this directory, and a re-import that renames or reworks them will turn those guards red
with an explanation of what to update:

- `packages/node/src/vocabulary.node.test.ts` — two line exemptions in `styles.css`, where
  a word that guard bans appears in its CSS-custom-property sense.
- `packages/node/src/strip-comments.node.test.ts` — `support.js` is excused from the
  shared-stripper migration, being vendored third-party code rather than a guard.

Both exemptions are checked for staleness, so neither can quietly outlive its reason.
