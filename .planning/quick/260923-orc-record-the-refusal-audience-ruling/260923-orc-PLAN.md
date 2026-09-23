---
id: 260923-orc
slug: record-the-refusal-audience-ruling
date: 2026-09-23
mode: quick
---

# Write down the ruling that decides who may read a refusal

## Why this task exists

On 2026-09-17, while the shape of Phase 46 was being settled, the owner asked whether a
refusal is allowed to say why it refused:

> для диагностики, возможно, нам стоит делать отдельную ошибку, но с точки зрения
> безопасности — имеем ли мы право раскрывать суть проблемы?

The answer that was settled on splits refusal detail by audience: **the requestor learns that
it was refused, the data owner learns why** — because a refusal that names its reason out of
what the node knows about itself is an oracle for what that node is holding.

**That ruling is in no file.** Verified by grep over `.planning/` and `docs/` on 2026-09-23:
Phase 46's success criteria 2 and 6 say nothing about audience, and no consult carries it.

This repository has already paid for exactly this once. The patent-disclosure rationale was
retired in `PROJECT.md` on 2026-08-24 and went on being repeated for nearly a month, because
`CLAUDE.md` — the file that is actually loaded — still carried it. **A ruling recorded only
where nobody re-reads it is not recorded.** Phase 47 is where this one binds, and Phase 47's
planner will not have this conversation.

## What this task must NOT do

**Do not change Phase 46's success criteria.** They are right as written, and the reason is
measured rather than assumed. Phase 46's refusal is a pure function of three fields that all
arrive on the `Task` from whoever dispatched it — `label`, `ownerId`, and the declaration
inside the signed `moduleRecord`. `guardSovereignty`
(`packages/core/src/executor/sovereignty-guard.ts:90`) reads `task.label` straight off the
wire and consults no node-side state before refusing. A refusal computed only from what the
requestor sent discloses nothing to the requestor.

So criterion 6 — *"a caller receives the named refusal"* — is safe exactly as it stands.
Narrowing it would cost diagnosis and buy no security. The ruling is recorded as **the
condition under which the full refusal stops being safe**, not as a criterion Phase 46 must
satisfy.

## The change

One paragraph added to `.planning/ROADMAP.md`, at the end of Phase 46's block, after the
paragraph beginning *"What this does not fix, recorded so the pair is not read as complete"*
and before `**Plans**`. It states three things: which fields this phase's refusal reads and
where they come from; that this is why the requestor may read all of it; and that consulting
node-side state is the line past which the split applies.

## Constraints

- One file. `.planning/ROADMAP.md` and nothing else.
- `.planning/STATE.md`'s frontmatter is hand-written and tooling has wiped it three times.
  The **Quick Tasks Completed** table in its body is a hand edit; the frontmatter is not
  touched.
- No strikethrough. A superseded line is removed, not struck — `~~text~~` costs a reader the
  same as the live text. Nothing here is superseded; this is purely an addition.
- Commit with an explicit path, never bare, because concurrent agents share one index.
