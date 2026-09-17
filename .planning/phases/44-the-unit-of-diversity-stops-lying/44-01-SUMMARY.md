---
phase: 44
plan: 1
title: The provider derives the operator identity, and refuses a request that disagrees
requirements: [VER-11]
criteria: [1, 2, 3, 4, 7]
status: done
completed: 2026-09-16
---

# 44-01 — SUMMARY

## What changed

`operatorIdFor(userKey)` in `@o2/core` is the one derivation of a node's operator identity.
The provider applies it; `requestEnrollment` applies it; the browser's visitor path applies it.
A request naming anything else is refused `operator-id-not-derivable`, carrying both the
supplied value and the only value that provider would sign.

The check sits **after `bad-owner-proof` and before the per-user limiter**, and both orderings
have a reason. The derivation reads `userKey`, which is only this requester's once `ownerProof`
verifies. And a client sending a name this provider will not certify has a bug to fix, so
telling it `rate-limited` would send it away to wait and come back with the identical defect —
that ordering has its own case, which reads `rate-limited` under the plant.

`EnrollmentRequest.operatorId` stays on the wire; what went is the ability to choose it.
`requestEnrollment` omits it alongside the four proofs and the freshness sentinel, and it
belongs in that company for the reason they do: those fields are withheld not to save the
caller work but because the caller is not the party that decides them.

`AttestationReceipt` gains `issuers`, built as `operators` is. `issuer` appeared **zero** times
in `quorum.ts` before this — the quorum could not express which providers vouched for its
members. It refuses on nothing: requiring distinct issuers makes `'independent'` unreachable on
a one-provider fabric, which is an owner's decision and Phase 45's work.

## The criteria

| # | reading |
|---|---|
| 1 | `enrollment.test.ts` — "names both the value it was sent and the only value it would sign": the refusal carries `supplied` and `derived`, and the reason text names both |
| 2 | "gives one user key one operator identity, whatever name each request asks for" — **the case that would have caught the defect, and no case in the tree asserted it before** |
| 3 | "certifies a client that derives its own identity, which is every client in this tree" — and it is structural rather than coincidental: the browser calls `@o2/core`'s function, so the two tiers cannot drift |
| 4 | `quorum.test.ts` — "names the providers that vouched for the members, which is one on this fabric": two operators, one issuer, `strength` unchanged across a one-issuer and a two-issuer pair |
| 7 | below |

## Criterion 7, and the plant that stayed green

The criterion asks for a mutation reverting `enrollment.ts:1356` to `request.operatorId` to
redden criterion 2. **It does not.** The refusal stands above the mint, so control never
reaches the mint with a mismatched value; the assignment is unreachable-with-a-wrong-value by
construction, and the plant is **green**. That is a blind instrument, and it is reported rather
than buried.

The property lives in the *check*, so the check is what was planted. Three cases red:

```
AssertionError: expected true to be false            (the renamed request was issued)
AssertionError: expected 'rate-limited' to be 'operator-id-not-derivable'
```

The second is the ordering rather than the rule, and it is the more informative of the two.

Planting the exact pre-2026-09-16 provider — check removed **and** mint reverted — reddens with:

```
AssertionError: expected [ 'visitor:197f6b23e16c8532', …(1) ] to have a length of 1 but got 2
```

which is the defect stated as a failure message rather than as a boolean. Criterion 2's case
was reshaped to produce that message: it asserts on the **set** of operator identities the two
requests yielded, because an `expect(ok).toBe(false)` placed first throws before the
informative line and hides it.

Restored by surgical inverse both times; `cmp` against a snapshot taken immediately before
planting: identical.

**Why the case is hand-rolled.** `requestEnrollment` now derives the field, so a request built
through it can never carry a mismatched one — and a case built that way passes *with the check
removed*. The cases build the request object by hand, every proof genuine, only the
`operatorId` chosen, which is exactly what a client wanting a name of its own would send.

## What the sweep found

122 sites in 71 files, enumerated by the compiler once the parameter left `requestEnrollment`.
`--operator-id` is gone from `bin/agent.ts` with its `--provider-addr requires --operator-id`
refusal; the field is gone from `FabricNodeOptions`, `BrowserNodeOptions`, `tab-api`,
`capability-harness` and `demo/main.ts`.

**`browser/visitorOperatorId` was deleted, and `reachability-guard.node.test.ts` is what found
it** — in the same commit that removed its last caller. A symbol disposed `global-object-hop`
that no longer becomes reachable when the hop is traced names the wrong cause, which is what
the derived case said. Its argument was promoted into `operatorIdFor` rather than lost.

**`protocol.ts`'s refusal codec got both halves in one edit**, on the strength of its own
docblock: *"this function is the reader `tsc` cannot find"* — adding an arm breaks the encoder
and leaves the parser compiling perfectly while returning `null` for the new kind.

## What this does NOT buy

Nothing an attacker does. A fresh user key is one `ed25519.keygen()`, and this repository
measured that in Phase 17 — twenty requests under twenty distinct user keys all succeeded. What
it buys is a field that means what `enrollment.ts` says it means, and a serving origin that
cannot dictate a visitor's identity. **A summary of this as a Sybil fix is wrong.** The bound an
attacker meets is the number of providers they must reach, which is Phase 45.

## What the lanes found that reading did not

Five fixtures, not four. The fifth was only visible once the lane ran, and it is the sharpest
of them.

### `quorum-ui.e2e.test.ts` — the defect inside a fixture that depended on it

`twoTabsOnOneRelay` took an operator **name** for the relay and paired it with a hard-coded
`OWNER_RELAY` key. So the one-operator arm stood a relay up under the relay's own key while
telling it to call itself `OPERATOR_A` — **a node claiming a party it does not belong to**,
which is the exact move this phase stops, and which the provider signed because it checked
nothing. That arm had three parties wearing one name while its own comment said *"tab B and the
relay enrol under tab A's own owner"*.

Caught as `expected 'visitor:353c8a7feeca38b2' to be 'visitor:d4eec1869fb1b8a4'`. It takes the
relay's owner now, and there is no name left to borrow.

### The bench's two-worker rung stopped completing, not merely mislabelling

`Observation.complete` means *every shard agreed, undegraded*. The quorum refuses on one
operator and the default dial degrades the shard, so the rung reads `no run of this rung
completed; first job it returned`. Both replicas still ran and still agreed; what is missing is
the verification, which is what the rung has to say.

**The rig was not given a user key per worker to make the gate compose again.** That would have
it state a population it does not have, on the one surface whose job is to report what the rig
established. A test fixture may supply as many owners as the rule under test needs — the number
of operators is the thing it checks. A driver that publishes a reading of a real rig may not.

The cost was paid in the retry predicate: `everyRealRungCompleted` waited for both real rungs to
reach `first completed run`, which `real/2` can no longer do, so left alone it would spawn the
driver `MAX_ATTEMPTS` times on every green run and then fail — a stall guard that had become the
stall. Narrowed per rung rather than weakened to *returned anything*, so `real/1` must still
complete and the guard keeps its teeth on the rung that can. Measured: passes on attempt 1.

## What was host and not code

`enrollment-cost` and `enrollment.node.test.ts` failed the first full lane with `rpc timed out
after 30000ms` at load/core 29.60. Re-run alone on a quiet host (probe `user/real` 0.92): both
green, 19/19 across six files. The `[host conditions]` banner called it correctly.

## The lanes, read off their own captured exit lines

Re-run on a host whose CPU probe read `user/real` 0.92 before the first spawn.

| lane | files | result |
|---|---|---|
| `node` | 269 | **3869 passed, 2 skipped, `NODE EXIT=0`** |
| `e2e` (`quorum-ui`, `visitor-enrolment`) | 2 | **15 passed, `E2E2 EXIT=0`** |
| `browser` | 429 | **7215 passed, `BROWSER EXIT=0`**, on a host the banner called quiet |

The browser lane's first attempt reported `8 failed | 421 passed` **files** with `6964 passed
(6964)` tests — eight files that failed to *import* (`Failed to fetch dynamically imported
module`), including two nobody touched in this phase. Those eight ran on the re-run, which is
where the extra 251 tests come from.
