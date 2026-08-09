# Phase 27: The Demo UI, Driven by the Real Fabric - Context

**Gathered:** 2026-08-09
**Status:** Ready for planning
**Mode:** Smart discuss (autonomous), 2 areas, all accepted as proposed

<domain>
## Phase Boundary

The demo page shows every workload the fabric can already run, in the imported mockup's
design, with **every figure on screen produced by a live `TabApi` reading**.

This phase writes no fabric code. Every API it consumes exists: `runColouring`, `runPi`,
`runJob`, `activity`, `heldPeers`, `capacity`, `governor`, `startReport`, `verifyAnswer`.
It is a wiring and rendering phase.

**In scope:** six surfaces — Colouring, Primes, π & reduce, Bring-your-own, Fabric state,
Benchmarks — plus the always-visible activity bar and the anti-placeholder guard.
**Out of scope:** any change to the fabric, the kernels, or the wire protocols.
</domain>

<decisions>
## Implementation Decisions

### How the mockup's design becomes the page

- **Take the mockup's layout and wording, not its runtime.** The mockup at
  `docs/design/mockups/o2-fabric-demo/` is a `<x-dc>` template rendered by a vendored
  `dc-runtime` that fetches React 18, ReactDOM and `@babel/standalone` from `unpkg.com`
  at load. The demo is a static-host page with no build-time CDN dependency and no React,
  and it stays that way.
- **Port the `_ds` custom properties into the demo's own CSS.** The design system is plain CSS
  with no JavaScript and no build step, so the custom properties and component classes
  transfer directly.
- **One page, in-page navigation across the six surfaces**, matching the mockup's nav —
  not separate pages. `index.html` stays the single entry point.
- **Keep a plain-text report view alongside the rendered one.** Every current e2e reading
  goes through `#run-report`'s text (`colouring-demo.e2e.test.ts` and others). Replacing
  it outright would rewrite the guards that hold DEMO-01 and DEMO-02 in the same change
  that rewrites the UI, which is exactly how a guard stops guarding.

### Scope, and the guard that makes "wired" mean something

- **All six surfaces ship.** π, primes and fabric-state are the load-bearing ones —
  they are the surfaces that do not exist at all today. Benchmarks renders the committed
  `docs/perf/prime-and-pi-benchmarks.md` figures and blocks nothing.
- **The anti-placeholder guard lands BEFORE the screens.** A spec that drives the page
  with the fabric stopped and asserts every figure region reads as a **named absence**
  rather than a number. Written after the screens, it would be written to fit them.
  **Without it, "the mockup is now wired" is satisfiable by CSS.**
- **Bring-your-own takes a module CID *and* a signed `NameRecord`, both required.**
  `runJob` requires the record by construction — a tab always pins a trust anchor, so a
  dispatch with no record is one every executor refuses. A CID-only form would produce
  nothing but refusals discovered as timeouts. This closes audit finding **G4**'s
  remaining half together with the primes surface.
- **The activity-bar overflow is fixed first, with a regression spec.** Measured
  2026-08-08 at a 393px iPhone viewport: `#bar` is 500px wide, `#bar-what` and
  `#bar-stats` are non-wrapping flex children, and `#stop` sits past x=482 — off screen.
  Stop is the control the consent gate promises in writing. `index.html` already carries a
  comment about an earlier `#bar` defect *"Reported from an iPhone; not caught here,
  because the tests asserted the `hidden` attribute rather than whether anything was on
  screen."* This is the same blind spot one property over: **nothing asserts the bar
  fits.** The spec is the deliverable; the CSS fix is small.

### Claude's Discretion

Element ids and CSS class names, how in-page navigation is implemented (no framework),
the exact text-view/rendered-view toggle, and test file placement.
</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `packages/browser/src/tab-api.ts` — the full contract; every reading this phase renders
  is already typed there, including `ShardAttestation`, `EgressManifest`, `TabPiRun`.
- `packages/browser/demo/main.ts` — `runColouring` (:892), `runPi` (:791), `runJob` (:1157)
  all exist and all dispatch public work.
- `docs/design/mockups/o2-fabric-demo/_ds/…/styles.css` — the custom properties and classes
  to port.
- `docs/perf/prime-and-pi-benchmarks.md` — the Benchmarks surface's content, already
  committed and measured.

### Established Patterns
- The page renders the kernel's own `description` for attestation and composes no sentence
  of its own — the only arrangement in which the CLI and the page cannot describe one
  result differently.
- The egress panel prints "0 withheld" only together with the sentence explaining the run
  registered no sovereign data, because the bare figure "would read as a sovereignty proof
  and would be a lie by omission".
- Guards are proved by a planted mutation watched red, restored, and `cmp`-verified.

### Integration Points
- `packages/browser/demo/index.html` — the single page.
- `packages/node/src/*.e2e.test.ts` — the e2e project that reads the page.
- Two guards already name paths inside the mockup directory (`vocabulary`,
  `strip-comments`); porting design out of it must not disturb them.
</code_context>

<specifics>
## Specific Ideas

- **The rule this phase can only fail by breaking:** every figure comes from a `TabApi`
  reading or is a named absence — never a default, never a surviving placeholder, never a
  value the page computed a second opinion about.
- **Suggested sequence** (from the roadmap entry, not binding): bar fix + its spec →
  anti-placeholder guard → π and primes → bring-your-own → benchmarks last.
- A lone tab cannot run the π reduce: `reduceJob` excludes the submitter, so the first
  visitor gets `reduceAttempted: false` with the fabric's own reason. The UI must present
  that as "this claim needs a second device", not as a failure.
</specifics>

<deferred>
## Deferred Ideas

- Any change to the fabric, kernels or wire protocols.
- Publishing the demo (a separately-triggered gate per the project's disclosure constraint).
</deferred>
