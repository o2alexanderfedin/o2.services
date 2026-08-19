# Owner ruling: a flag that selects a ROLE is not a flag that gates a CAPABILITY

**Ruled 2026-08-18 by the owner.** This refines
[`2026-08-15-owner-ruling-off-by-default-flag.md`](./2026-08-15-owner-ruling-off-by-default-flag.md)
— it does **not** weaken it. Read that file first; every word of it still stands.

## The question

Phase 20's criterion 7 was closed on 2026-08-18 by building a coordinator leg on `bin/agent.ts`,
reached with `--coordinate <shards>`. That flag is off by default, which is the exact shape the
2026-08-15 ruling refused. Asked in plain terms — *"Does 'it must work with no flag' invalidate
that closure too?"* — the answer was:

> **No — a role selector isn't a feature gate.**

## The distinction, stated so it can be applied rather than felt

The 2026-08-15 ruling was taken against `bin/bench.ts --discover`, where the flag decides **whether
discovery happens at all**. With the flag off, the capability is present in the binary and no
execution reaches it. That is a capability nobody ships.

`--coordinate` is a different object. It does not decide whether coordination is *available*; it
decides **which role this process plays in a job**. There is no default value it could take that
would be correct: an agent not told to coordinate has nothing to coordinate, and a default that
coordinated would mean every agent in the fabric trying to coordinate every job. The criterion's own
text asks for *"a coordinator … through `bin/agent.ts`"*, and asking for one is how a coordinator
comes into existence.

**The test to apply, and it is about the default, not about the word "flag":**

| ask | if yes | example |
|---|---|---|
| Would the capability be correct if the flag defaulted **on**? | it is a **feature gate** — the ruling of 2026-08-15 applies, and the row is not shipped | `--discover`: discovery defaulting on is exactly what the row claims |
| Is there **no** default that would be correct, because the flag names which of several roles this process takes? | it is a **role selector** — the ruling does not apply | `--coordinate`: no agent can sensibly coordinate by default |

Put another way: a feature gate hides work the system should be doing anyway; a role selector answers
a question the system cannot answer for you.

## What this does NOT license

- **It does not restore the five rows.** `SCHED-01`, `SCHED-02`, `SCHED-03` (partially), `MR-02` and
  `VER-09` rest on `bin/bench.ts --discover`, which is a feature gate under the test above and fails
  it. Those rows are unticked under the 2026-08-15 ruling, and this refinement leaves them unticked.
  The owner directed on 2026-08-18: **untick now, then build** — so the ledger is honest at every
  moment rather than honest only at the end.
- **It is not a general escape for new flags.** The burden is on the flag to show there is no correct
  default, and the answer goes in the flag's own docblock where a reader meets it. A flag that could
  have defaulted on and did not is a feature gate whatever it is called.
- **It says nothing about whether the mechanism works.** As the 2026-08-15 file already records, what
  that ruling denies is the claim that *a runnable entry point reaches it*, never the claim that the
  mechanism is sound. The same holds here in the other direction: `--coordinate` passing this test is
  a statement about reachability, not a second opinion on criterion 7's evidence, which stands on its
  own five-process measurement.

## Consequence

Phase 20 stays **7/7** and milestone v1.1 keeps that phase closed. Recorded rather than left implicit,
because the 2026-08-15 ruling had gone three days without being cited in `REQUIREMENTS.md` at all
while the guard was already applying it — and an uncited ruling is how a ledger drifts in whichever
direction is comfortable.
