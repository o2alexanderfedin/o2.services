# Phase 11: Explicit serveAgent Hook Contract - Context

**Gathered:** 2026-07-27
**Status:** Ready for planning
**Mode:** Autonomous — one load-bearing design decision resolved from an established
project pattern rather than asked; see "The absence must be a value" below.

<domain>
## Phase Boundary

`serveAgent` stops accepting an omitted hook. All six — `authorize`, `index`,
`capacity`, `ledger`, `reservations`, `onDispatch` — become things every call site must
say something about, and "nothing" becomes something you *write*, not something you
leave out.

**In scope:** the `AgentOptions` type in `packages/net/src/agent.ts`, the four
production call sites (`fabric-node.ts:354`, `browser-node.ts:209`, `bench.ts:123`,
`bench.ts:139`), and the eight test files that call `serveAgent`.

**Out of scope:** actually supplying real implementations for any hook. That is Phases
12–21. This phase makes the omissions *visible and counted*; it does not fill them.
A node that serves unauthenticated today still serves unauthenticated when this phase
ends — the difference is that `bin/agent.ts` now says so in one grep-able line.

**Why this is first.** It is the structural cause the other 35 unwired requirements
share. Once the hooks are non-optional, every later phase opens with `tsc` naming its
own gap at the call site, instead of someone having to know the gap exists.
</domain>

<decisions>
## Implementation Decisions

### The absence must be a value, not an omission

The requirement is *"an omission becomes a decision someone records."* Three mechanisms
would satisfy a literal reading and only one satisfies the intent:

| Mechanism | Verdict |
|---|---|
| `authorize?: Authorizer` (today) | The defect. |
| `authorize: Authorizer \| undefined` — required, nullable | **Rejected.** `authorize: undefined` at a call site reads exactly like the omission it replaced and records nothing. It moves the hole, it does not close it. |
| `authorize: Authorizer \| 'serves-unauthenticated'` — required, named absence | **Chosen.** |

**This is the project's own established pattern, not a new one.** Phase 9 recorded
*"Consent is a value, not a check"* as a Key Decision: `GrantedConsent` is minted only
by `grantConsent`, so a caller without one does not fail a check — it fails to compile.
The same shape applies here. `authorize: 'serves-unauthenticated'` is a sentence
someone wrote and can be held to; `authorize: undefined` is the absence of a sentence.

**And it makes the milestone measurable.** `grep -rn "serves-unauthenticated"` counts
exactly how many nodes serve without authorization. That number is the v1.1 burn-down,
and it should reach zero for `authorize` by Phase 15 without anyone maintaining a
separate list.

`exactOptionalPropertyTypes: true` is already set repo-wide (`tsconfig.json:9`), so the
required-and-nullable variant would not even have been the cheap option — it would
still touch every call site, for none of the legibility.

### Naming the absences

Each sentinel names what the node *does*, in the node's own voice — never what it
lacks, and never a node kind. Proposed, at the planner's discretion to refine:

- `authorize` → `'serves-unauthenticated'`
- `index` → `'serves-no-records'`
- `capacity` → `'accepts-every-offer'`
- `ledger` → `'keeps-no-ledger'`
- `reservations` → `'relays-for-nobody'`
- `onDispatch` → `'reports-no-dispatch'`

**Constraint that overrides any naming preference:** none of these may imply a class of
node. "All nodes have equal functionality; the only difference is discovery" has been
stated by the owner four times and a class was deleted over it. `'serves-no-records'`
describes a node's current state and is fine; `'edge-node'` or `'lightweight'` would be
the fourth mistake.

### Tests state it too

All eight test files that call `serveAgent` update to pass six hooks. **No test helper
that fills in defaults** — that would reintroduce the exact hole in a place that
outnumbers production 2:1, and the audit already found that `ledger` is supplied
nowhere, *including* in tests. A test that passes `'keeps-no-ledger'` is stating what it
does not cover, which is worth reading.

### Behaviour must not change

This is a signature change. Every sentinel maps to precisely the behaviour its silent
default produced today — `'accepts-every-offer'` accepts every offer, exactly as
`options.capacity?.offer(...) === undefined` did. The already-fixed `reservations` wire
on `fabric-node.ts:354` keeps answering real peer IDs.

If any behaviour changes, this phase has failed at its one job: it exists so the *next*
eleven phases can change behaviour safely.

### Claude's Discretion

Sentinel spelling (string literals vs. a frozen symbol/const object), whether the six
absences share one union helper, and how the refusal reads in `tsc` output. Prefer
whatever produces the clearest compiler message naming the missing hook — criterion 1
requires the error to name it.
</decisions>

<code_context>
## Existing Code Insights

### The type under change
`packages/net/src/agent.ts:65-126` — `AgentOptions`. Six optional hooks, each with a
documented rationale for its silent default. Those doc comments are accurate about
*intent* and were the reason nobody looked; several will need rewriting rather than
keeping, because "Omitting it means…" is no longer a reachable state.

The dispatch site at `agent.ts:132-175` reads them as `options.index?.providers(...) ?? []`,
`options.capacity?.offer(...)`, `options.reservations?.() ?? []`, `ledger?.record(...)`,
`options.onDispatch?.(from)`, `options.authorize?.({...})`. Each `?.`/`??` pair becomes a
branch on the sentinel.

### Production call sites — all four, and what they pass today
| Site | Passes | Omits |
|---|---|---|
| `packages/node/src/fabric-node.ts:354` | `rpc, executor, blockstore, reservations` | authorize, index, capacity, ledger, onDispatch |
| `packages/browser/src/browser-node.ts:209` | `rpc, executor, blockstore, onDispatch` | authorize, index, capacity, ledger, reservations |
| `packages/node/src/bin/bench.ts:123` (requestor) | `rpc, executor, blockstore` | all six |
| `packages/node/src/bin/bench.ts:139` (per worker) | `rpc, executor, blockstore` | all six |

`ledger` is passed by **none of them, and by no test** — the audit's sharpest finding.

### Test call sites (8)
`packages/net/src/`: `start-report.test.ts`, `distributed.test.ts`, `rendezvous.test.ts`,
`discovery.test.ts`, `churn.test.ts`, `sovereign-execution.test.ts`.
`packages/node/src/`: `relaying.node.test.ts`, `rendezvous-wire.node.test.ts`.

`sovereign-execution.test.ts` is the one that hand-builds a whole fabric — authority,
index, `EgressGuard`, `serveAgent` — and the audit noted it proves the pieces compose
when someone composes them, which is not the claim. It will now be visibly the only
caller supplying most hooks.

### Established patterns to follow
- **A named value beats a check** — `GrantedConsent` / `grantConsent`
  (`packages/browser/src/consent.ts`), Phase 9's recorded Key Decision.
- **Constants are spelled as literals in tests, never imported from the implementation**
  — the project's recorded anti-pattern is a test that agrees with itself.
- **Mutation-test every new guard.** A phase whose entire deliverable is "this now fails
  to compile" must prove it: delete a hook argument, confirm `tsc --noEmit` fails and
  names it. Criterion 1 is exactly this and it is the phase's real test.

### Integration points
`packages/net/src/index.ts:21` re-exports `serveAgent`. `purity.node.test.ts` gates the
tiers — `@o2/net` is PORTABLE, so no `node:`/libp2p import may enter it. Sentinels are
plain values and cost nothing here, but the constraint stands.
</code_context>

<specifics>
## Specific Ideas

**Criterion 1 is a compile-failure test and needs a real mechanism.** Asserting "removing
an argument fails `tsc`" cannot be done from inside the suite that must itself compile.
Options for the planner: a fixture file compiled in isolation via the TypeScript API or a
child `tsc` run, `@ts-expect-error` on a deliberately-incomplete call, or a scripted
mutation that runs `tsc --noEmit` and asserts a non-zero exit naming the hook.
`@ts-expect-error` is the cheapest and it fails loudly if the error stops occurring —
which is the direction that matters.

**A grep-based criterion needs to survive formatting.** Criterion 2 says "no call with
fewer than six named hook arguments". A regex over source is brittle against a
reformat; prefer a check that parses, or lean on criterion 1's compile guarantee and
make criterion 2 a count of sentinels rather than a shape assertion.
</specifics>

<deferred>
## Deferred Ideas

- **Supplying real hook implementations** — Phases 12–21, one per capability. This
  phase deliberately leaves every current behaviour intact.
- **A burn-down count of remaining sentinels** — attractive as a milestone progress
  metric, but a test that asserts "at most N nodes serve unauthenticated" would have to
  be edited every phase, and a guard that is routinely edited stops guarding. Revisit at
  Phase 22 with the reachability guard, where it belongs.
- **`RemoteExecutor`'s missing capability field** — the other half of AUTH-03. Phase 15.
</deferred>
