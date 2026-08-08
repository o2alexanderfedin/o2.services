---
phase: phase-22-reachability-guard
plan: 04
status: complete
date: 2026-08-08
commits: [d7beefe]
requirements: [WIRE-02]
---

# 22-04 — The gate

**Closes criterion 3.** The guard runs in `.githooks/pre-commit` beside the six that were there.

## The gate refuses, and that was demonstrated rather than asserted

A real commit was attempted that added an exported function nothing calls, staged the way a commit
stages:

```
git commit  ->  exit 1
"48 unreachable callable barrel exports carry no disposition, against a ceiling of 47.
 A HIGHER number means a new one arrived: … aot/gateProofUnwired …"
```

The finding names the new symbol **inside the list**, so a committer reads what they did rather
than that something failed. Restored by the surgical inverse, `cmp` exit 0 on both files, unstaged.

## Cost, as a comparative reading in one run window

```
six guards         real 2.96 and 3.13   user+sys 3.20 and 3.42   241 tests
plus reachability  real 3.40            user+sys 5.97            261 tests
```

**+12% wall clock, +80% CPU.** The two disagree on purpose: the TypeScript API runs in a separate
process, so its work lands in `user` while the wall clock overlaps it — and wall clock is what a
committer waits for. **The value that would break it is written in the hook**: if the seven-guard
arm ever reads more than twice the six-guard arm in the same window, take it out. It is at 1.12×.

**And I measured it wrong first.** Both arms were passed through an unquoted shell variable; zsh
does not word-split, so vitest received the whole list as one filter, found no files, and arm A
"passed" at 0.64 s having run nothing. Caught by reading `EXIT=$?` — it was 1 — not by looking at
the timing. A comparison between two runs that ran nothing is worse than no reading, because it
looks like evidence.

## The absence of CI is recorded where somebody would try to fix it

There is no CI and there must not be one: `disclosure-gate.node.test.ts` asserts
`.github/workflows` does not exist, because public hosting is public disclosure and the EPO and
China have no patent grace period. So *"run this on the merge"* is not available, and this hook is
the only gate this repository has. **Criterion 3 says "CI gate"; this repository's gate is the
hook, and that substitution is stated rather than assumed.**

## The span ledger, retaken

The open debug session (`retake-measured-node-spans`, 2026-08-05, drift 7 at 157/150) was read
first: the table was retaken 2026-08-07 and `slow-specs` runs green, so that symptom is stale.
Both new specs measured solo: `reachability` real 6.90 / ratio 2.29 → row at 5 980;
`reachability-guard` real 1.91 → row at 1 040. Both leave `test:unit`; the guard joins `purity` and
`disclosure-gate`, which are also just over the cut and also in this hook. `files` 169 → 171,
`sumOfFileSpansMs` → 1 824 386, `unitTests` → 1697, `unitWallClockMs` → 23 340. `unitFiles` stays
111 and still equals `files - EXCLUDED.length`.

## Three mutation-ledger entries, every signature observed

| id | Mutation | Measured |
|---|---|---|
| M69 | `classify`'s branch order | callable 217 → 171, **total unmoved** |
| M70 | alias resolution off | callable 0, type-only 0, **604 total still satisfied** |
| M71 | `translationCid`'s call site | 2 cases, findings 58 → 60 |

```
tsc --noEmit       exit 0
mutation-guard     exit 0   151 passed
npm run test:unit  exit 0   111 files   1697 passed   real 22.71
```
