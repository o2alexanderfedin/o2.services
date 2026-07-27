# Phase 9: Public Demo, Consent UX & Disclosure Gate - Context

**Gathered:** 2026-07-26
**Status:** Ready for planning

<domain>
## Phase Boundary

A visitor opens a static page, is told exactly what will run before anything runs,
chooses to allow it, and contributes to a computation whose answer they can check
themselves — while publication of that page stays a deliberate human action.

**In scope:** the consent gate, the always-visible running surface, the stop control,
a real compute kernel with a checkable certificate, start-failure reporting segmented
by browser, a policy page written for a human blocklist reviewer, and vocabulary
enforcement across the whole repository.

**Out of scope:** hosting a public relay (a human decision, and Phase 3's remaining
criterion), any deployment automation whatsoever, and any change to the scheduler,
churn, or verification kernels — this phase composes what Phases 1–8 built and adds
a guest module and a UI.

</domain>

<decisions>
## Implementation Decisions

### The demo job and how a visitor checks it

- **The job is a Pythagorean-triple 2-colouring search.** Find a red/blue colouring
  of {1…N} such that no triple with a² + b² = c² is monochromatic. N = 7824 is the
  largest colourable value; the 2016 proof that 7825 is impossible was reported as
  the largest mathematical proof ever produced.
- **The check requires trusting nobody.** The visitor's own tab enumerates every
  Pythagorean triple with c ≤ N and asserts none is monochromatic — a loop over the
  *definition*, not a comparison against a published number and not a re-run of our
  code. This is the distinction criterion 2 turns on: the three rejected alternatives
  (Collatz ranges, corpus search, reproducing a paper) all check by appeal to an
  authority, which is the quiet downgrade the handoff warned about.
- **The certificate is small and the work is large.** A colouring of {1…7824} is
  under 1 KB, so a partial fits far inside the 16 KiB WebRTC message limit, while the
  search that produced it does not fit in one tab.
- **Parallelism is cube-and-conquer** — the published technique for this problem. A
  shard is a fixed prefix of assignments; the guest derives its own prefix from the
  bits of `partition()`, so no per-shard input is needed to distinguish shards.
- **Integer-only, so determinism is free.** No floats anywhere in the guest, which
  side-steps the NaN and relaxed-SIMD nondeterminism V8 cannot be told to suppress.
- **N climbs as nodes join.** The demo's arc is that capacity visibly buys a better
  answer — which is the project's own thesis, demonstrated rather than asserted.
- **A shard that finds nothing reports "exhausted, none in this cube"**, which is a
  real result, not a failure. Only exhaustion of every cube proves impossibility.

### How guest code is produced

- **`.wat` source compiled by `wabt` at build time.** `STACK.md` already nominates
  `wabt` as a build-time tool; it is a JS/WASM build needing no native toolchain, and
  `.wat` stays readable and reviewable as text.
- **The `.wasm` is committed alongside its CID, and a test recompiles the `.wat` and
  requires byte-identity.** Otherwise the committed artifact is an unverifiable claim
  about the source beside it. This is the same discipline as artifact signing at
  content-addressing time (Phase 4).
- Hand-assembled byte fixtures stay where they are. They exist to have no build step
  in the kernel's tests; a real compute kernel is not a fixture.

### The consent gate

- **Nothing happens before consent — no CPU and no network.** No relay dial, no peer
  discovery, no address published, no IP revealed to a third party. This is stricter
  than criterion 3, which only names CPU, and it is deliberate: the network contact is
  the part a human blocklist reviewer will object to, and "we spent no cycles" is not
  an answer to "you told a relay I was here".
- The cost is accepted: the landing page cannot show a live peer count or prove the
  fabric is alive before the visitor opts in. It says what it will do instead.
- **What is disclosed, in plain language, before the button:** what will run, whose
  job it is, how much CPU it may use, for how long, what leaves the device (results
  and a start-outcome report — never input data), and how to stop.
- **Consent is remembered per-origin, revocable, and versioned.** A stored consent
  records which disclosure version it answered; changing the disclosed terms
  invalidates it and the gate reappears. A consent that silently survives a change in
  what it permitted is not consent.
- **No pre-ticked box, no auto-start, no consent implied by scrolling, dwelling, or
  navigating.** One affirmative action, and it is the only thing that starts a node.

### The running surface and the stop control

- **A fixed bar that cannot be scrolled away or dismissed while the node runs.** Not
  a collapsible panel: the criterion says persistent and always-visible.
- **It shows:** what is running now, whose job it is, the live duty cycle (including
  the background throttle when the tab is hidden), tasks completed, and what has been
  sent off the device.
- **Stop terminates the Workers and closes the connections.** `Worker.terminate()`
  and `node.stop()` — CPU reaches zero because the thread is gone, not because a loop
  agreed to exit. `VisibilityGovernor` refuses a duty cycle of 0 by construction, so
  throttling to nothing was never available anyway.
- **A task in flight is abandoned, not surrendered politely.** A lease is a deadline
  (Phase 7), so a departing node needs no cleanup protocol and the work re-dispatches
  on its own.
- **"Provably zero" is proven by mutation.** Replace `terminate()` with a flag and
  require the suite to fail. This is the standing rule from Phase 7 — a guard is worth
  nothing until a mutation shows it can fail — and it applies to every guard added in
  this phase, not only this one.

### Start-failure reporting

- **Published to the fabric when a peer is reachable, always displayed in-page, and
  copyable when it cannot be sent.** There is no server-side process, and DEMO-03
  forbids adding one.
- **The blind spot is published beside the number.** A node that cannot reach a peer
  cannot report that it cannot reach a peer, so the reported population is not the
  visited population — and the gap is exactly the blocklist cliff the requirement
  exists to make visible. Reuse `@o2/bench`'s discipline for excluded configurations:
  name what could not be measured, in the same table as what could.
- **"Failed to start" is an enumerated cause, never a boolean** — WASM unavailable,
  WebRTC unavailable, storage denied, no relay reachable, crypto unavailable, and an
  explicit "other" carrying the error. A bare failure count cannot distinguish a
  blocklist from a broken relay.
- **Browser segmentation is coarse by construction** — family plus major version,
  from a fixed enumerated set with "other" as the fallback. Not a UA string, not a
  fingerprint. The metric needs to see a cliff, not a person.
- **Telemetry is gated on the same consent** and disclosed in the same text.

### Static hosting and the disclosure gate

- **No deploy workflow file may exist in the repository at all** — absent, not
  disabled, not commented out, not `workflow_dispatch`-only. A test asserts the
  absence, so the constraint fails loudly rather than eroding.
- **No deploy script either.** A `build:demo` script is added; publishing stays a
  sequence a human performs deliberately, documented in prose. Publishing is public
  disclosure, and EPO and China rights are already permanently forfeit — the US
  provisional window is the only one left.
- **Vocabulary discipline is enforced by a test over the whole repository**, not by
  care. The banned senses are "mining"/"miner", "hashrate", "earn" as reward,
  "credits" as currency, and "tokens" as currency. The test must tolerate ordinary
  English ("earning its place") and the security sense ("capability token",
  "enrollment token") — a rule that cannot express its own exceptions gets disabled
  the first time it fires wrongly.
- **One existing violation is fixed:** `docs/p2p-native-cloud-design.md` §3.8 offers
  to "settle in credits/tokens". It is in a future-directions list of things not
  built, but a reviewer greps the repository, not the intent.

### Claude's Discretion

- Layout, spacing, and colour of the consent gate and running bar, within the existing
  plain-DOM, single-`<style>`-block, `ui-mono` idiom the demo already uses. No
  framework, no CSS file, no component system — the page has none and does not need
  one.
- The exact shard count, N ladder, and search cutoffs, subject to a shard completing
  fast enough that the surface visibly changes.
- Whether the triple list is computed in-guest from N or supplied as an input block.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets

- `packages/browser/src/browser-node.ts` — `BrowserNode.start()` composes libp2p,
  `IdbBlockstore`, `FetchingBlockstore`, `WasmExecutor` inside `GovernedExecutor`,
  `VisibilityGovernor`, `RpcEndpoint`, `serveAgent`. `BrowserNode.stop()` exists and
  already calls `governor.stop()`. `BrowserNodeOptions` has no foreground duty-cycle
  lever — the only route to zero CPU today is `stop()`.
- `packages/core/src/governor.ts` — `DutyCycleGovernor`, and the `Governor` port.
- `packages/browser/src/visibility-governor.ts` — `VisibilityGovernor` with
  `dutyCycle`, `hidden`, `transitions`, `sleptMs`, `onVisibilityChange(fn): () => void`
  and `stop()`. Both duty cycles validate to `(0, 1]`, so **zero is not expressible**.
- `packages/net/src/governed-executor.ts` — `GovernedExecutor` serializes while
  throttled and exposes `executed` and `dutyCycle`.
- `packages/core/src/executor/wasm.ts` — the guest ABI: `o2.input_len()`,
  `o2.input_read(ptr,len)`, `o2.output_write(ptr,len)`, `o2.partition()` returning
  `(index << 16) | count`. Exports required: `run` and `memory`. Output must decode as
  DAG-CBOR.
- `packages/core/src/executor/fixtures.ts` — the byte-assembly helpers and, in its
  comments, the DAG-CBOR minimality trap (emit fixed-width byte strings, not CBOR
  integers, so the guest needs no branch).
- `packages/bench/src/stats.ts` and `report.ts` — `summarise`, `percentile`,
  `MIN_RELIABLE_SAMPLES`, `machineLabel`, and the "excluded, and why" table. The
  start-failure report is the same reporting problem and should reuse the discipline.
- `packages/browser/src/tab-api.ts` — the `window.o2` contract the e2e tests drive.

### Established Patterns

- **Plain DOM, no framework.** `packages/browser/demo/index.html` holds static markup,
  one inline `<style>` block, and an inline `<script type="module">` controller that
  busy-waits for `window.o2`. Helpers are `setState(tone, text)` writing
  `dataset.tone`, and `setFacts(pairs)` doing `replaceChildren`.
- **Test suffixes are load-bearing.** `*.test.ts` runs in both node and browser
  projects and must be portable; `*.browser.test.ts` browser only;
  `*.node.test.ts` Node only; `*.e2e.test.ts` drives Playwright with
  `fileParallelism: false`. One root `vitest.config.ts`, three projects.
- **`purity.node.test.ts` gates the tiers.** `PORTABLE = ['core','net','bench']`,
  `DUAL_TARGET = ['libp2p','browser']`. It scans `packages/<pkg>/src/**` only —
  `packages/browser/demo/` is not scanned, which is worth knowing but not worth
  relying on.
- **Every new checker gets a planted violation before it is trusted**, and every new
  guard gets a mutation test.

### Integration Points

- `packages/browser/demo/index.html` — the consent gate goes in front of the existing
  `#join` button; the running bar is new persistent markup.
- `packages/browser/demo/main.ts` — `discoverRelays()` reads `?relay=` then
  `/bootstrap.json`; `api.start()` hardcodes `backgroundDutyCycle: 0.05` and
  `allowPrivateAddrs: true`, both test-oriented values currently shipped to the page.
- `packages/node/src/built-bundle.e2e.test.ts` — **asserts on `#state`, `#join`,
  `#explain`, the `data-tone` values, and button enablement.** Any change to the gate
  breaks it, and it must be updated rather than routed around; it is the only test
  that exercises the real static bundle on a dumb 404-ing file server.
- `packages/browser/vite.config.ts` — `root: demo/`, `base: './'`, `outDir: dist/`.
  Invoked only from inside a test today; no npm script exists.
- `.github/` does not exist. That is the DEMO-04 state and must survive this phase.

</code_context>

<specifics>
## Specific Ideas

- The running bar should make the background throttle *visible* rather than merely
  applied — `VisibilityGovernor.onVisibilityChange` already provides the hook, and a
  visitor who can watch the duty cycle drop when they switch tabs has been shown the
  guarantee instead of told it.
- The policy page is written for one specific reader: a human reviewing a blocklist
  submission. It states what runs, what does not, how to stop it, what is measured,
  and where to appeal — in plain language, with no marketing.
- The check-it-yourself control is the demo's centrepiece, not a footnote. It should
  read as "verify this yourself" and run in the visitor's tab with the fabric
  disconnected if need be.

</specifics>

<deferred>
## Deferred Ideas

- Hosting a public relay with AutoTLS — Phase 3's remaining criterion, a human
  hosting decision, and what a GitHub Pages deployment needs to function at all.
- Running benchmark nodes as separate OS processes to make parallel speedup
  measurable — belongs with BENCH-06, not here.
- Any incentive, metering, or settlement mechanism. Explicitly not built, and the
  vocabulary that describes it is banned from the repository.

</deferred>
</content>
