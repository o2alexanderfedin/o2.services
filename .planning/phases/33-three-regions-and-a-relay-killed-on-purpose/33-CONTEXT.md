# Phase 33: Three Regions, and a Relay Killed on Purpose — Context

**Gathered:** 2026-09-13
**Status:** Ready for planning
**Source:** orchestrator brief at `/gsd-plan-phase 33 --skip-research`, every reading taken against
this tree on 2026-09-13

<domain>
## Phase Boundary

Three identities under the already-closed name set, configured but **not created**; the
difference between a binding jurisdiction and a non-binding hint made visible rather than
hidden; a guard that refuses any document claiming **where** an object physically runs; and a
region-loss drill that exists as code **and as a schedule**.

What this phase does **not** do: create a Cloudflare resource, deploy, cut a release, or take
any live reading that requires a deployed object. Those are owner acts, and the plan must say
so per task.

</domain>

<decisions>
## Implementation Decisions

### The substrate that already exists — do not rebuild it

- The closed name set is already in the tree and already names this phase as its owner:
  `packages/cloudflare/src/hosted-object.ts:61` — *"**Three names, one per region, and the set
  is closed.** Phase 33 owns `bootstrap-us`, …"* — with `HOSTED_OBJECT_NAMES` at `:68-70`
  being `{us: 'bootstrap-us', eu: 'bootstrap-eu', sam: 'bootstrap-sam'}`.
- Region labelling is already wired and already fails closed. `packages/cloudflare/src/worker.ts:644`
  `#regionOnce()` narrows a `--var` label against that closed set **exactly once**; a label
  outside the set makes the object report `region: null` and refuse every region-addressed
  write, loudly (`:651`), recoverable by fixing the var. `refuseMisaddressed` is at `:961`.
  `/self` reports `admission` including the region label (`:1115`), and `:1119` records that a
  bare `region: null` *"was there to be read and meant nothing to a reader"*.
- Three regions are **already exercised locally as three separate workerds on three ports**:
  `packages/cloudflare/src/admission-slices.e2e.test.ts:78-80` runs `bootstrap-us` 8801,
  `bootstrap-eu` 8802, `bootstrap-sam` 8803, and proves at `:301-304` that a halt addressed to
  one region does not halt the other two. **This is the arrangement a drill can be built on
  without deploying anything — reuse it, do not invent a second one.**
- Per-region TURN URLs already exist (`worker.ts:359-364`, `turnUrlsFor`), and the comment
  there already states the discipline criterion 2 needs: *"**Naming a region here claims
  nothing** about where it runs"*. The vocabulary is already chosen; read it before writing
  criterion 2's guard.
- `packages/cloudflare/wrangler.jsonc` today declares ONE binding `BOOTSTRAP` → class
  `BootstrapObject`, one migration tag `v1` with `new_sqlite_classes`, `preview_urls: false`
  (stated rather than defaulted, with the 60-preview-deployment bill recorded as the reason),
  `workers_dev: true`, `send_metrics: false`, and `vars.ANNOUNCE_MULTIADDRS` naming the one
  deployed host. Its header states: *"**NOTHING HERE DEPLOYS ANYTHING** — the only wrangler
  invocation in this repository is `--dry-run`, asserted by `hosted-tier-deploy.node.test.ts`."*
  **Extend that guard rather than duplicating it.**

### Placement — read, and not to be re-read

- `jurisdiction` is **binding** and accepts `eu`, `us`, `fedramp` and nothing else.
- `locationHint` is **best-effort** and binds nothing.
- An object's location is **fixed by its very first `get()`** and never moves. A wrong
  placement is not repairable, only replaceable. This is why creation is an owner act.
- The three are therefore **not symmetric**. `HOST-06`'s ledger row
  (`.planning/REQUIREMENTS.md:2193`) states it in those terms: they *"must not be created by
  one uniform code path that hides the difference"*. A single `createRegion(name, placement)`
  helper taking a union and branching internally **is** the failure that row names — the
  difference must be visible at the call site, in the configuration, and to a reader.
- `bootstrap-eu` goes in the `eu` **jurisdiction**. `bootstrap-sam` carries a **`locationHint`
  only**, because no South-American jurisdiction value exists. `.planning/OWNER-ACTIONS.md`
  row 2: *"a plan passing `sam` as a jurisdiction is watched failing at creation, which is
  itself a criterion"* — criterion 1's negative proof, and an **agent** task, runnable locally
  without creating anything in the account.

### Agent-now versus owner-gated — `.planning/OWNER-ACTIONS.md` row 2 is the authority

Row 2 verbatim: *"Agent-side work that does **not** wait on this: all three objects' code and
configuration, `wrangler deploy --dry-run --outdir=<scratch>` verification, the drill schedule,
and the guard that refuses any document claiming **where** an object physically runs."*

**Every task in the plan must say, in its own text, either `agent-now` or `waits on owner act N`.**
No task may silently need a deploy.

- **agent-now** — the three configurations with structurally different paths for
  eu-jurisdiction vs sam-locationHint (HOST-06); criterion 1's negative proof (`sam` as a
  jurisdiction watched failing at creation, locally); criterion 2's guard (HOST-07); the drill
  **as code plus its schedule** (NET-15's row at `:2207`: *"Scheduled and repeated is the
  requirement; a single exercise satisfies the letter and not the property"* — the schedule is
  the deliverable, the live run is not); `--dry-run --outdir=<scratch>` verification of all
  three configurations.
- **waits on owner** — creating the objects (the first `get()` is the irreversible act,
  ≈$5/month each, ≈$15 for three; **two regions also work** at two thirds and that choice stays
  the owner's, so build all three configurations and let the owner pick N); criterion 3's live
  degradation reading; criterion 4's cross-region dialability observed during a real drill.

**Extend `.planning/OWNER-ACTIONS.md` row 2 rather than adding a duplicate row**, and carry
`HOST-10`'s ordering into the owner script: the billing-alert-precedes-first-resource ordering
*can only be lost once per resource*, it has already been permanently lost once (the ledger's
first `Refuted` row), and three new resources are about to exist. The script must read the
alert's state **before** the first real `get()`, and say what number means stop.

### Criterion 2 binds this phase's own output first

Criterion 2 verbatim: *"**No surface, document, published record or benchmark line claims where
a hosted object runs.** A grep over this milestone's published copy and results finds no
location claim, and a review rejects any figure captioned with a city or a country attributed
to a hint. The object is placed in a datacenter chosen to minimise latency *from* the hint, so
the region name is an address and never a location claim — a report saying 'measured in São
Paulo' on the strength of a hint has written a measured fact it did not measure."*

This binds the PLAN, the SUMMARY, every fixture name, every test title and every commit message
this phase produces. **Region names are addresses; cities and countries are location claims.**
`HOST-07`'s row (`:2194`) says the row exists *"so the claim is refused before there is an
opportunity to make it, which is the only point at which refusing it is cheap"* — which is now,
and is the strongest argument for taking this phase's agent half **before** the release rather
than after.

The guard is a node-lane spec over published copy and results. `wrangler.jsonc`'s header records
the matching hazard twice over: **a comment quoting a forbidden literal fails the guard over that
literal.** Plan the guard's own prose to survive its own rule, or carve it out explicitly with a
stated reason.

### The dependency, checked rather than assumed

ROADMAP's `Depends on` is *"Phase 32 (one relay working before three)"*. Phase 32's **checkbox
is unticked and the dependency is nevertheless satisfied** — verified 2026-09-13 by reading
`.planning/ROADMAP.md:2363-2415`. Criteria 1, 2 and 4 are met: two real Chromium tabs on the
deployed relay, with a busy window that moved the relay **less** than the idle one while the pair
moved 20 710 bytes of its own; and criterion 2 met in a stronger form against a local `workerd`
with `ANNOUNCE_MULTIADDRS` emptied — `Uncaught NoAnnouncedAddressError`, the relay refusing to
build rather than handing out empty reservations. What holds the checkbox off is (a) criterion
3's ordering, measured to be permanently unanswerable, and (b) **repeatability** — *"neither run
exists in the tree as a spec"*. The relay works, which is what Phase 33 depends on. **Do not plan
to re-establish it, and do not plan to close Phase 32's repeatability gap here.**

### Scope fence — identical to Phase 39's, non-negotiable

- No agent creates a Cloudflare resource, deploys, or cuts a release. Deployment is a
  separately-triggered gate by this project's own `DEMO-04` ruling.
- No agent touches the three `ocr-checks-worker*` scripts — the owner's production, standing
  instruction to leave it alone, and `wrangler.jsonc` already asserts its own name does not
  resolve near that prefix with a guard reading it.
- Local `wrangler dev --persist-to <own dir>` only, never the deployed object, for anything
  measured. Ports **8794, 8801-8803, 8814, 8816, 8818, 8819 are taken** — pick fresh ones and
  say so in a comment.
- A spec must not dial a real external endpoint. `hermetic-fixtures.node.test.ts` holds that
  rule, and a node-lane spec broke it once this week by dialling a live provider on every run —
  it was outcome-stable, so it could never redden. Use loopback stubs.
- `.planning/STATE.md` frontmatter is hand-written and the GSD tooling has wiped it twice. No
  task rewrites that block.

### Repo conventions, all measured costs

Read `EXIT=$?` on the line **immediately** after the command, never after a pipe or a trailing
`tail`/`echo` — broken twice last session, both on a `tail`, and one of them hid a commit that
had not happened. zsh has no `PIPESTATUS`; it is `pipestatus[1]`. Commit with explicit paths
(`git commit -m "…" -- <path>`), never bare, because concurrent agents share one index. Branch
names need a git-flow prefix from `feature|release|hotfix|bugfix|support|fix|chore|docs|test`.
Run vitest **by project** (`npx vitest run --project node|aot|browser|e2e|perf`); `aot` is its
own lane, run alone. Read the `[host conditions]` banner before quoting a duration or diagnosing
a failure — it samples before and after only, so load arriving mid-run reads as "quiet";
attribute by re-running the file alone. **A proof that cannot fail is not a proof**: every plant
is watched red, restored by the surgical inverse of the edit, verified with `cmp` against a
snapshot taken immediately before planting, and the observed failure text recorded. When a plant
stays green that is a **blind instrument to report**, not a redundancy to accept — two did last
session because a guard existed in two places and either sufficed.

`vitest.config.ts` carries hand-derived counts (`files`, `tests`, `unitFiles`, `unitTests`) with
a dated derivation note; any task adding a spec updates them and names the arriving file there.

### Claude's Discretion

- How many plan files to split this into, and their wave assignment.
- The exact shape of the three configurations (separate `wrangler.jsonc` environments, separate
  files, or one file with three explicitly-distinct binding blocks) — subject to HOST-06's rule
  that the difference must be visible rather than hidden behind a shared helper.
- The drill's harness shape, subject to reusing `admission-slices.e2e.test.ts`'s three-workerd
  arrangement rather than inventing a second one.
- Where the schedule lives (a committed schedule file, a CI workflow, or a runbook entry with a
  guard reading it), subject to NET-15's rule that the schedule is the requirement.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### The phase's own words
- `.planning/ROADMAP.md:2416-2429` — goal and the four success criteria, verbatim
- `.planning/REQUIREMENTS.md:2193` (HOST-06), `:2194` (HOST-07), `:2207` (NET-15) — the ledger rows
- `.planning/OWNER-ACTIONS.md` row 2 — the agent/owner split, quoted above

### The substrate
- `packages/cloudflare/src/hosted-object.ts:61-70` — the closed name set
- `packages/cloudflare/src/worker.ts:359-364, 633-656, 961, 1106-1119` — region narrowing,
  misaddressed refusal, `/self`'s region field, per-region TURN URLs
- `packages/cloudflare/src/admission-slices.e2e.test.ts:78-80, 267-304, 338-356` — three
  workerds on three ports, and a halt that does not fan out
- `packages/cloudflare/wrangler.jsonc` — the one existing deploy configuration and its stated
  reasons
- `packages/node/src/hosted-tier-deploy.node.test.ts` — the guard asserting only `--dry-run`
  ever runs, and that the owner's production prefix does not appear

### The precedents this phase must not break
- `packages/node/src/hermetic-fixtures.node.test.ts` — no spec dials a real external endpoint
- `.planning/ROADMAP.md:2363-2415` — Phase 32's closing record, the dependency this phase rests on
- `CLAUDE.md` § Conventions, § Measurement, § Proofs

</canonical_refs>

<specifics>
## Specific Ideas

- Criterion 1's negative proof is the cheapest strong result in the phase: pass `sam` as a
  `jurisdiction` and watch creation fail, locally, with the refusal read **by name** from the
  runtime's own output rather than inferred from a failed call. Phase 32's `ANNOUNCE_MULTIADDRS`
  arm is the shape to copy — it recorded `Uncaught NoAnnouncedAddressError` read from the
  worker's own log, and explicitly noted that reading only a client-side `[object ErrorEvent]`
  would have been attribution by plausibility.
- Criterion 2's guard needs a positive control. An empty grep proves nothing on its own — a
  memory of this project's own (`absence-needs-a-positive-control`) records a phase criterion
  that nearly closed on an empty read where a record written seconds earlier was equally empty.
  Plant a location claim into a scratch copy of the corpus, watch the guard redden, restore.
- The drill's measurement must be **comparative inside one run** — the same arrangement with the
  region up and with it down — rather than against an absolute threshold. `CLAUDE.md`
  § Measurement states why, and Phase 32's idle-versus-busy window is the worked example.

</specifics>

<deferred>
## Deferred Ideas

- Creating the objects, and everything downstream of a first `get()` — owner act, `OWNER-ACTIONS.md` row 2.
- Criterion 3's live degradation figures and criterion 4's cross-region dialability — both need
  deployed objects.
- Phase 32's repeatability gap (its two one-off runs committed as specs) — explicitly **not**
  this phase's work.
- Phase 34's TURN sharding across the three regions — downstream of this phase, not part of it.

</deferred>

---

*Phase: 33-three-regions-and-a-relay-killed-on-purpose*
*Context gathered: 2026-09-13*
