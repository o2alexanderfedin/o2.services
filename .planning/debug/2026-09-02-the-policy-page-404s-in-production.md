# The disclosure's second page 404s on the live site

**Found while planning Phase 36; confirmed against the deployed site 2026-09-02.** Not a
prediction from reading the config — the live URLs were fetched.

## The reading

| request | result |
|---|---|
| `https://o2alexanderfedin.github.io/o2.services/` | **HTTP 200** — the positive control |
| `https://o2alexanderfedin.github.io/o2.services/policy.html` | **HTTP 404** |
| `policy.html` in the live bundle `assets/index-BmALDOtj.js` | **present, 1 occurrence** |

So the page a visitor is invited to open does not exist, while the invitation to open it is
shipped and live.

## Why it went unseen

`packages/browser/demo/index.html:3038` assigns the link **from JavaScript** —
`policy.href = './policy.html'` — rather than carrying a static `href`. A grep over the served
HTML therefore finds nothing, and the string lives in the bundle instead. It arrived in
`449b767` *"feat(demo): consent gate, a stoppable thread, and a blocking metric"*, so it has
been live for as long as the consent gate has.

The cause is one absence: **`packages/browser/vite.config.ts` declares no
`rollupOptions.input`**, so Vite builds `index.html` and nothing else. `packages/browser/dist/`
contains exactly `assets`, `index.html` and `perf` — `policy.html` is not among them and never
was.

## Why it matters more than a broken link

`BROW-09` requires a plain-language disclosure **before opt-in** stating four things. Phase 35
closed the content and ordering of that disclosure and closed them honestly — the four elements
and their order are proved in `disclosure-four-elements.node.test.ts` and
`disclosure-before-optin.e2e.test.ts`, both against the page that **does** exist. What neither
of them reads is whether the *second* reader of that disclosure is reachable, because reaching
it is a property of the **publish** step and not of the page.

That is the shape of this defect and it is worth naming: **a proof that reads the source tree
cannot see a build that omits a file.** The same class as the two publish-path defects found on
2026-08-28, both of which also failed silently.

## Not fixed here, and by whose plan

Phase 36's plan (`36-01-PLAN.md`, Task 7) already assigns the repair with a dated correction,
and it accounts for interactions this note does not: `browser-client-publish.node.test.ts`
asserts against `viteConfig.plugins`, and `scripts/deploy-pages.sh` depends on the current
output shape. Adding a second Rollup input changes both surfaces, and the deploy path has
already been broken once this session by a change that no local run could reach.

**The guard that must land with the fix** is one that reads the *built output*, not the source:
a case that fails when a page linked from the bundle is absent from `dist/`. Repairing the file
without it leaves the class open — the next page added the same way 404s the same way.

Recruitment has not begun, so no visitor has been sent here yet, and `RUN-01` gates the invite
behind `BROW-06`…`BROW-10`. This must be closed before Phase 39 and it is sequenced before it.
