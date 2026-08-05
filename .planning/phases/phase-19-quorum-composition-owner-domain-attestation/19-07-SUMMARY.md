---
phase: phase-19-quorum-composition-owner-domain-attestation
plan: 07
subsystem: enrollment, node-factories, browser-factory, agent-binary
tags: [AUTH-04, issuance-budget, durability, cross-process, criterion-5]
requires:
  - "packages/core/src/enrollment.ts — IssuanceLedger, IssuanceBudget, the aggregate refusal (19-05)"
  - "packages/node/src/fabric-node.ts — attestResults composed at the factory (19-15)"
  - "packages/node/src/bin/agent.ts — the owner-id derivation and the exit-2 path (19-09)"
provides:
  - "a provider's issuance budget survives its own process, on both tiers"
  - "bin/agent.ts cannot run a provider that never stated an aggregate budget"
  - "criterion 5 measured across real processes and a confirmed restart"
  - "the three-phase-old flag-fold instruction discharged as declined, with reasons"
affects:
  - "19-11 and 19-17 — the ledger is per --dir / per IndexedDB name; see 'Where the ledger persists' below"
  - "AUTH-04 stays Partial, for a stated reason rather than an unfinished one"
tech-stack:
  added: []
  patterns:
    - "an option that carries its own bound, so the unbounded state is unrepresentable"
    - "a synchronous host write inside a synchronous port, and the asymmetry stated where it is not"
    - "compaction bounded by the one window constant the authority itself defaults from"
key-files:
  created:
    - packages/node/src/fs-issuance.ts
    - packages/node/src/fs-issuance.node.test.ts
    - packages/browser/src/idb-issuance.ts
    - packages/browser/src/idb-issuance.browser.test.ts
    - packages/node/src/enrollment-cost.node.test.ts
  modified:
    - packages/node/src/fabric-node.ts
    - packages/browser/src/browser-node.ts
    - packages/node/src/bin/agent.ts
    - packages/core/src/enrollment.ts
    - packages/core/src/index.ts
    - packages/node/src/bin/bench.ts
    - packages/node/src/enrollment.node.test.ts
    - vitest.config.ts
    - .planning/REQUIREMENTS.md
decisions:
  - "the record lives under the provider's own --dir / its own IndexedDB name, never on the wire"
  - "issuesCertificates carries the budget rather than sitting beside an optional one"
  - "a refused enrolment stays fatal and exits 1, not 2 — decision 9 is not overturned inside a flag addition"
  - "the flag fold is discharged as DECLINED with three measurements, not carried forward a fourth time"
  - "AUTH-04 stays Partial: a bound made durable is not a graduated price"
metrics:
  duration: ~1h30m
  completed: 2026-08-03
---

# Phase 19 Plan 07: The budget, on the binary the criterion names — Summary

A provider run by `bin/agent.ts --issues-certificates --max-issued-per-window 1` certifies
its first enroller, refuses the second by the **aggregate** reason under a freshly generated
user key, is stopped and confirmed dead, **restarts on the same `--dir` as a different pid
with the same signing key, and still refuses**. A provider on a different directory is a
different provider with its own budget, whose certificates a peer that pinned the first
refuses `untrusted-issuer` by name. No wall-clock claim appears anywhere in the file that
measures it.

---

## WHERE THE LEDGER PERSISTS — read this before running 19-11 or 19-17

The brief asked for this prominently, because a durable issuance budget that outlives a
process is exactly the kind of change that can exhaust a later fixture's budget in a way
nobody would attribute correctly. So, precisely:

| tier | where the record lives | what isolates it |
|---|---|---|
| Node | `<blockstoreDir>/.issuance` — the directory passed as `--dir`, beside `.identity.key` and `.provider.key` | **the provider's own directory.** Two providers on two directories are two records. A node with no `blockstoreDir` writes nothing and passes `'remembers-only-within-this-process'` by name |
| browser | IndexedDB database `${blockstoreName}-issuance` | **the store-name suffix**, the same convention `IdbSovereignCids` and `IdbIdentityStore` already use, so one origin can hold several independent nodes |

**Nothing is shared between fixtures, and nothing is shared between concurrent processes,
unless a fixture deliberately points two providers at one directory.** Every spawn helper
in this repository derives a provider's `--dir` from a `mkdtemp` workdir created in
`beforeEach`, so each test run gets a fresh temporary directory and each provider inside it
gets its own subdirectory. There is no repository-global path, no `$HOME` file, no
`os.tmpdir()` singleton, and no lock.

**What a later plan could still trip over, stated so it is not discovered:** a fixture that
stops a provider and respawns it *on the same directory* now inherits that provider's spent
budget — which is the whole point of this plan, and is exactly what
`enrollment-cost.node.test.ts` measures. `enrollment.node.test.ts`'s criterion-1 step 7 does
restart an agent on the same directory, but that agent is an **enroller**, and it reuses its
persisted `.certificate.json` rather than spending a fresh issuance, so it was unaffected.

**And every provider now has a finite budget where before it had none.** Fourteen spawn
sites across seven files were given `--max-issued-per-window 64`, chosen above the largest
population any of them sends (twenty, in `enrollment.node.test.ts`). A new fixture that
enrols more than 64 nodes against one provider will meet the aggregate refusal — which is
correct, and is named, and is not silent.

---

## What was built

### Task 1 — an issuance record that outlives the process, on both tiers

**Commits:** `5659e63` (RED), `3b15117` (GREEN)

`packages/node/src/fs-issuance.ts`. One line per issuance, `<millis> <userKey>`, appended
with **`appendFileSync`**. `IssuanceLedger.record` is synchronous because
`EnrollmentAuthority.enrol` is, and `packages/net/src/agent.ts` records that this is *why*
its `enrol` branch takes no capacity slot — so the write syscall has returned before `enrol`
returns and therefore before a certificate could have been encoded. There is no window, not
a window that is usually lost.

The bound on "durable" is stated rather than inherited: nothing calls `fsync`, so the record
survives the **process** dying and a power loss may still take the last entries. That is
deliberately a smaller claim than `sovereign-cids.ts` makes for itself.

`packages/browser/src/idb-issuance.ts` is the same mechanism in the one durable store a tab
has, and carries the one honest asymmetry as a **measured bound**: IndexedDB has no
synchronous API, so the write lands a turn later; because a write is scheduled on *every*
`record` rather than batched, what is not yet durable is what was recorded since the last
turn — one, for a tab answering one enrolment frame at a time. `outstanding` is the field
the assertion reads. The tab's *running* budget does not lag at all; only what a reload
would recover does.

Both factories construct their tier's record, replacing the sentinel each carried:

```ts
// fabric-node.ts
issuance:
  options.blockstoreDir === undefined
    ? ('remembers-only-within-this-process' as const)
    : await FsIssuance.open(options.blockstoreDir, { retainMs: DEFAULT_ISSUANCE_WINDOW_MS }),
```

A node with nothing durable to offer **says which it has** rather than falling back quietly —
the identical shape `sovereignCids` uses eleven lines below.

**`issuesCertificates` now carries the budget** (`IssuanceBudget | undefined`) instead of
being a `boolean` beside an optional number. That is the whole point: a provider that never
stated a bound became *unrepresentable*, rather than being a state a caller could reach by
forgetting a second field while `tsc --noEmit` exits 0 — which `IssuanceBudget`'s own
docblock records this phase measuring twice. `tsc` enumerated all fifteen construction
sites; a grep for the symbol found the same set plus the two factory reads and the doc
mentions, so the two lists reconcile.

**Compaction on load, never on write**, bounded by `DEFAULT_ISSUANCE_WINDOW_MS` — a new
export from `packages/core/src/enrollment.ts`, read by the authority's own default *and* by
both hosts' retention, so there is one number rather than two kept in step. An issuance older
than the window decides nothing, because both budgets filter to the window before reading;
this is deliberately unlike a **spend** record, which can never be forgotten, and both module
headers say so because a reader arriving from the invitation draft will expect that rule.

### Task 2 — the flag, and what an exhausted provider tells a node

**Commit:** `0538d82`

`--max-issued-per-window`, **required alongside `--issues-certificates` in both directions**,
validated as an integer ≥ 1 at parse with the flag and the value named. There is **no switch
for the library's `'issues-without-an-aggregate-budget'` opt-out**, the same posture
`--trust-anchor` takes for DET-03's: the opt-out stays reachable for callers that must state
it, and the shipped binary carries none.

The flag's doc carries the four things asked for: what it is for and why the rate limit alone
did not buy it; that it is a **policy number and therefore on argv**, with the `--user-key`
file rule explicitly not applying (a budget is published on the wire by every refusal that
carries its limit); the operator trade, that a small budget starves honest enrolment as
readily as an attacker's and that the answer is another provider; and that it is a per-node
configuration and not a node kind.

No certificate-lifetime flag, per the owner's 2026-08-02 correction, said in one line where
a reader would otherwise wonder why the neighbouring option has none.

### Task 3 — the measurement

**Commits:** `013fdbd` (RED), `ad5e07c` (the helper), `dc90338` (header correction)

`packages/node/src/enrollment-cost.node.test.ts`. One provider at a budget of **one**, one
restart, four enrollers, two providers — nine spawns, against `tree-reduce-agents`'s nine.
The count is not what makes the reading and nothing depends on it.

The header states what the file does and does not establish, including the criterion-5
reading it cannot satisfy (below).

---

## Deviations from Plan

### 1. [Rule 4 — architectural, resolved by NOT taking it] A refused enrolment exits 1, not 0 with a handshake

**The plan asked for**: *"A node whose enrolment is refused because the provider's budget is
exhausted does not exit 2 … this is a report on stderr and a handshake line whose
`certificate` is `null`"*, and its proof said *"the refused enroller exits 0 with
`certificate: null`"*.

**What landed**: it still does not start. `FabricNode.start`'s rejection is caught in
`bin/agent.ts`, the provider's own words go to stderr, and the process leaves with **exit 1**
— never through `refuse`, which is exit 2 *and prints the usage line*.

**Why**, and this is the part worth reading. `FabricNodeOptions.enrollment` records
17-CONTEXT.md decision 9 in its own docblock: *"Present means enrollment is **fatal when it
fails** — `start()` rejects with the refusal reason and leaves no listening socket behind"*,
because *"a node told to enrol, unable to, and running anyway is a node whose identity claim
is silently absent — the shape `.planning/PROJECT.md` records as a hole."* Delivering the
plan's letter would overturn that contract for **every** caller of the option, in this binary
and out of it, from inside a plan whose Task 2 declares one file. That is an architectural
decision about the library's contract, not a flag addition.

**What the plan's sentence was *for* is delivered**: an exhausted provider is not a
misconfigured node, and the distinction is now readable from outside — exit 1 versus exit 2,
and no usage line. Both are asserted:

```ts
expect(second.code).not.toBe(2)
expect(second.stderr).not.toContain('usage: agent.ts')
```

Reddened by routing it through `refuse`, which is the plan's own stated plant.

**What is therefore still open**, named so a later phase can take it deliberately: nothing in
this repository lets a node start *without* the certificate it was told to obtain and say so
on its handshake line. If that is wanted, it is a change to decision 9 and should be planned
as one.

### 2. [Rule 3 — blocking] Two test files the plan's frontmatter does not list

Task 1 is `tdd="true"` and its `<files>` names only the two modules and the two factories —
there is nowhere for its five proofs to live. Added:

- `packages/node/src/fs-issuance.node.test.ts` (9 cases, **0.75 s**, below the cut so it stays
  in `test:unit`)
- `packages/browser/src/idb-issuance.browser.test.ts` (6 cases × 3 browsers)

Three of Task 1's properties are **invisible from outside a process** and could not have been
measured by Task 3's file at any cost: that the append completes before `enrol` returns, that
compaction drops only what the window cannot reach, and that the browser tier's gap is one.

### 3. [Rule 3 — blocking] `packages/core/src/enrollment.ts` gained one exported constant

`DEFAULT_ISSUANCE_WINDOW_MS = 3_600_000`, replacing the literal in the authority's `??`
default and read by both hosts' `retainMs`. Without it, a host compacting its own storage
would be guessing at the authority's window — and `IssuanceLedger`'s docblock states exactly
that failure: *"a host that got it wrong would silently widen or narrow both budgets with
nothing anywhere failing."* One number, three readers.

### 4. [Rule 2 — missing correctness] `spawnUntilExit` waited out the failures it exists to catch

Found while running plant M1. **Every** plant this file is armed against turns a refusal into
a *successful* enrolment, so the child announces and serves for ever — and the reading was
the 60 s announce budget expiring under a message naming no cause. The helper now rejects on
the handshake line instead. Measured: the same plant went from **61 146 ms and "neither
announced nor exited"** to **1 664 ms and "announced instead of leaving — it was certified
where a refusal was expected"**, with the whole certificate in the message. A check whose
failure mode is a timeout is a check somebody calls a flake.

### 5. [Rule 1 — stale comment] `enrollment.node.test.ts` said the opposite of what is now true

Its header claimed *"a provider process that restarts forgets every issuance it made"* and its
third AUTH-04 case explained itself by `issuance: 'remembers-only-within-this-process'`. Both
became false at Task 1's commit and were corrected in it. The case's *reading* is unchanged
and still passes — a second provider still has a fresh budget — but the reason is now that it
is a second **provider** (a second directory, a second signing key), not that the first one
forgot.

### 6. Fan-out the plan did not enumerate

Making the budget unrepresentable-when-absent forced fifteen `issuesCertificates: true` call
sites and fourteen `--issues-certificates` spawn sites to state one. All but `bin/bench.ts`
keep the behaviour they had, by name (`'issues-without-an-aggregate-budget'` in process, `64`
on the command line). `bin/bench.ts` states the sentinel with the reason at the line: its
provider certifies the `nodes` the same function is about to start, a bound would have to be
kept in step with `--nodes`, and nothing adversarial can dial it.

---

## The flag fold: examined and DECLINED, with the measurements

The instruction has been carried forward three times (Phase 15 → 18 → 19-09) and 19-09 named
this plan as the successor with nothing behind it. It is now **discharged as declined**, in
the source and here, with an instruction not to carry it again. Three measurements:

1. **`parseArgs`'s `options` *is* one flags object**, and has been since the first flag. The
   instruction's literal words are already satisfied by the shape of the call, and no phase
   ever wrote down what it actually wanted instead.
2. **The one concrete fold consistent with the wording is refused twice by this file, by
   name.** `--trust-anchor` and `--trusted-issuer` are repeatable rather than comma-separated
   *"because a comma-split string would be a parser nobody asked for."* A compound value flag
   would overturn a recorded decision to close an unrecorded one.
3. **The flags named are not one subject.** The file already states that `--trust-anchor` and
   `--trusted-issuer` must not be conflated — *"a module and a peer are different subjects"* —
   and the three that genuinely are one subject (`--owner-id`, `--owner-key`,
   `--can-execute-sovereign`) **are already folded**, into the single `sovereignty` object at
   the `FabricNode.start` call.

Sixteen flags, counted 2026-08-03, each documented at its own key. The mutation ledger cites
`packages/net/src/agent.ts` and not this file, so that cost did not apply and is not claimed.

---

## Deferred item 2 (`via-relay`) — NOT taken, and still open

`bin/agent.ts` still cannot produce a `via-relay` node: `port` defaults to `'0'` and the
listen list is passed unconditionally, so `canRelay` is always true and every spawned agent
enrols `seed` with `relayIds: []` whatever `--relay-addr` it was given. **This plan's work
never needed a relayed agent**, and the brief said not to take it speculatively.

It therefore remains open, and the fold it was filed under is now declined — so the item no
longer has a container. **It falls to whichever phase next needs `composeQuorum`'s rule 2
measured across processes**, and it is one flag: a `--port none`, a `--no-listen`, or a
listen list built conditionally when `--relay-addr` is present and `--port` was not passed
(which needs `--port`'s default removed so "not passed" is distinguishable from `0`).

---

## The plants, with find/replace pairs for Plan 19-12

Every plant restored by `cp` + `cmp` (exit 0 each time), never by `git checkout --`.
`git status --short` was empty over the touched paths after each restore pass.

| # | file | find | replace | observed |
|---|---|---|---|---|
| P1 | `node/src/fs-issuance.ts` | the `try { appendFileSync(…) } finally { this.#remember(…) }` body of `record` | `this.#remember(userKey, at)` alone | **RED ×4**: `expected +0 to be 3`, `expected [] to deeply equal [ 1799999999990, 1800000000000 ]`, `expected [] to have a length of 1 but got +0`. The pre-plan behaviour, reproduced |
| P2 | same | same body | `queueMicrotask(() => appendFileSync(…))` + `this.#remember(…)` | **RED ×1, and only 1**: `ENOENT … /.issuance`. The bytes still land, so the restart reading stays green while the *ordering* reading goes red — which is the separation the assertion exists for |
| P3 | same | `new FsIssuance(path, kept)` in `open` | per-user list fed from `all`, aggregate from `kept` | **RED ×1**: `expected [ 1799999760000, …(3) ] to deeply equal [ 1799999999000, 1799999999500 ]`. The two budgets disagreeing about one window |
| P4 | `browser/src/idb-issuance.ts` | the immediate-schedule body of `record` | a buffer flushed every third record | **RED ×9 (3 cases × 3 browsers)**: `expected 1 to be +0` on `outstanding`, `expected [] to deeply equal [ 1799999999000 ]`, and `expected true to be false` on the reload arm |
| M1 | `core/src/enrollment.ts` | `if (this.#maxIssuedPerWindow !== 'issues-without-an-aggregate-budget') {` | `if (false as boolean && …) {` | **RED at n2**, immediately: *"announced instead of leaving — it was certified where a refusal was expected"* with the whole certificate |
| M2 | `node/src/fs-issuance.ts` | `return new FsIssuance(path, kept)` | `return new FsIssuance(path, [])` | **RED at n3 and only n3** — the *post-restart* enroller. n2 still refuses, because that provider had never restarted. This is the plant that separates "the budget is durable" from "the provider happened not to restart" |

### The check that could not fail — run, and it passed

**M3, the variant the plan required be tried.** The restart was deleted and the first
provider process reused (`const resumed = provider`), leaving the pid and liveness assertions
out with it. **The file passed, all three cases, exit 0, 6.44 s.** It proves only the
in-memory budget — which is what Phase 17 already had — and it is indistinguishable from the
real reading unless somebody notices the restart is gone. Run, and noticed.

---

## What this does NOT establish

- **A bound made durable is not a per-identity price.** Criterion 5 asks for the N-th
  identity to be *"demonstrably more expensive than the first"*; what is demonstrated is that
  it is **refused** — an unpayable cost inside the window rather than a larger one. A verifier
  reading the criterion as requiring a graduated price should score it **PARTIAL**, and that
  is the honest outcome. The criterion was not rewritten and AUTH-04's row was not ticked.
- **Power-loss durability is not claimed.** No `fsync`; the record survives the process dying.
- **The browser tier's composition is source-level.** `IdbIssuance` is unit-measured in the
  browser project across all three engines, but no e2e spec drives a real enrolment refusal
  out of a live tab — the same standing limit legs 1 and 3 have on that tier.
- **The multi-provider recovery is half measured.** A node the exhausted provider turned away
  *is* certified by a second one, and the certificate it comes back with is refused
  `untrusted-issuer` by a peer that pinned only the first — so the recovery is real and its
  price is visible. The operational half — an operator noticing a starved provider, a fabric
  re-pinning at scale — is untested.
- **A signature is not correctness**, and a budget is not identity assurance. Neither claim is
  made anywhere in the files this plan added.

---

## A measured fact about `parseArgs` worth knowing

`--max-issued-per-window -1` does **not** reach this binary's validator.
`ERR_PARSE_ARGS_INVALID_OPTION_VALUE: Option '--max-issued-per-window' argument is
ambiguous` — Node's parser refuses the separated form for any value beginning with a dash,
and that is exit **1** from the parser before `agent.ts` has run a line. The `=` form works
and exits 2 with the expected message. This is true of every string flag on this binary and
is not specific to the new one; the test uses `--flag=value` and says why at the line.

---

## The known flake, observed and not chased

`packages/node/src/reservation-exhaustion.node.test.ts` (defect #33, root-caused and fixed in
`919f8e0`) **did not fire** in either full node run taken for this plan — it passed in the
`--reporter=json` measurement run at 4 073 ms and again in the final verification run.
Nothing was adjusted, no timeout raised. There is no stderr text for agent `b` to report,
because the armed instrument never printed.

---

## `vitest.config.ts` was re-measured in full

This file is **not** in the plan's frontmatter, and the plan said to say so if a span was
added. `enrollment-cost.node.test.ts` measures **11.0 s**, well above `SLOW_CUTOFF_MS`, so it
had to be listed — and `MEASURED_NODE_SPANS`'s docblock forbids pasting one entry from
another run, so the whole table was retaken.

**2026-08-03, run 5**: 138 files / 1903 tests, **green** (exit 0, 1901 passed, 2 skipped),
sum-of-spans **741.5 s** against **248.0 s** wall clock, load polled every 40 s —
9.60 → **18.47** → 18.31 → 12.71 → 10.40 → 8.52 → 8.07. `test:unit` observed **directly** at
103 files / 1596 passed / 1 skipped in **6.93 s** at load 5.34, exit 0.

**This run was taken on a quiet host and replaced a contended one** (the previous peaked at
59.60), which moves the table in the expensive direction: smaller spans, fewer files clearing
the cut. It is the sharpest row the history has produced — the tree grew by **two** files, one
of them 11.0 s and comfortably above the cut, and the excluded count still came out at **35**,
because three files crossed *down* to pay for it. `churn.test.ts` read **974 ms** after
reading exactly **1 000** last time, with nothing about it changed.

---

## Verification

| command | result |
|---|---|
| `npx tsc --noEmit` | **exit 0** |
| `npx vitest run --project node` | **exit 0** — 138 files, 1901 passed, 2 skipped, 222.0 s |
| `npx vitest run --project browser` | **exit 0** — 243 files, 3774 passed, 41.8 s |
| `npm run test:unit` | **exit 0** — 103 files, 1596 passed, 1 skipped, 6.93 s |
| `npx vitest run --project node --reporter=json` (measurement) | **exit 0** — 138 files, 1903 tests, 248.0 s |

Every exit code was read with `EXIT=$?` on the line **immediately** after the command it
reads, never through a pipe and never after a trailing `tail`.

---

## Commits

| hash | message |
|---|---|
| `5659e63` | test(19-07): a provider's issuance record, held to surviving the object that wrote it |
| `3b15117` | feat(19-07): a provider that comes back is not a provider with a fresh budget |
| `013fdbd` | test(19-07): the budget a restart does not hand back, on the binary criterion 5 names |
| `0538d82` | feat(19-07): a provider states how many certificates it will sign, or it does not start |
| `ad5e07c` | test(19-07): a refusal that never came is a named failure, not a sixty-second timeout |
| `b17baa3` | chore(19-07): re-measure the whole node span table, on a quiet host this time |
| `dc90338` | docs(19-07): AUTH-04's row says what landed, and stays Partial for a stated reason |

`.planning/STATE.md` and `.planning/ROADMAP.md` were **not** touched, per the executor brief.
No commit in this plan deletes a tracked file (`git diff --diff-filter=D` empty across the
whole range).

## Self-Check: PASSED

- `packages/node/src/fs-issuance.ts`, `fs-issuance.node.test.ts`,
  `packages/browser/src/idb-issuance.ts`, `idb-issuance.browser.test.ts`,
  `packages/node/src/enrollment-cost.node.test.ts` — FOUND
- `5659e63`, `3b15117`, `013fdbd`, `0538d82`, `ad5e07c`, `b17baa3`, `dc90338` — FOUND in
  `git log`
- `git diff --name-only 919f8e0..HEAD` names neither `STATE.md` nor `ROADMAP.md`
- working tree clean after every plant restore (`cp` + `cmp` exit 0, `git status --short`
  empty)
