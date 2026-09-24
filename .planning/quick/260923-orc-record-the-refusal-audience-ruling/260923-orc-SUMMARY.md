---
id: 260923-orc
slug: record-the-refusal-audience-ruling
date: 2026-09-23
status: complete
---

# Who may read a refusal, and why Phase 46 can tell everybody

## The headline

**A refusal may name its reason for as long as the reason is something the asker already
told you.** That sentence is now in `.planning/ROADMAP.md`, at the end of Phase 46's block,
and until today it existed only in a conversation.

## What was written

Thirteen lines, one paragraph, one file. It records the owner's ruling of 2026-09-17 —
refusal detail splits by audience, the requestor learning that it was refused and the data
owner learning why — together with the condition that decides when the split applies.

The condition is the part that makes the ruling usable rather than a slogan. Phase 46's
refusal reads exactly three fields: `Task.label`, `Task.ownerId`, and the declaration inside
the signed `Task.moduleRecord`. All three arrive from whoever dispatched the task.
`guardSovereignty` (`packages/core/src/executor/sovereignty-guard.ts:90`) reads `task.label`
straight off the wire and consults nothing the node knows about itself before refusing. So
this phase's refusal can be handed to the requestor whole: it repeats their own input back at
them. **The line is node-side state.** A refusal that consults what the node holds, or what
it is cleared for, is the one that splits — otherwise a stranger learns what a machine is
storing by dispatching tasks at it and reading the reasons.

## What was NOT changed, deliberately

**Phase 46's six success criteria are untouched.** Criterion 6 says a caller receives the
named refusal, and the first reading of the ruling said that criterion was the defect.
Re-derived against the code instead: it is not. Narrowing criterion 6 would have cost every
operator the ability to tell a declaration refusal from a provenance refusal, and bought no
secrecy, because the requestor supplied both inputs. The ruling is recorded as the boundary
Phase 47 inherits, not as a correction to Phase 46.

Nothing outside `.planning/ROADMAP.md` was modified. `.planning/STATE.md`'s frontmatter — the
block three separate tooling runs have wiped — was not touched; only the **Quick Tasks
Completed** table in its body gained a row, by hand.

## How this is known to be right

`git diff --stat` reports one file and 13 insertions; `git show --stat` on the commit reports
the same single path. The inserted paragraph was read back in place, between the *"What this
does not fix"* paragraph and `**Plans**`.

There is no test here and there should not be: this is a record of a decision, and a guard
asserting that a paragraph exists would assert its presence rather than its truth. What
carries the claim is that the three fields it names are readable at
`packages/core/src/ports.ts:52-93` and the wire-read is at
`packages/core/src/executor/sovereignty-guard.ts:90`, both cited in the paragraph itself so a
later reader can check it rather than believe it.
