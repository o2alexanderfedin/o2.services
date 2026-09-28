# Contributing

**The default is that this project does not accept contributions, and it has been
departed from exactly once — by owner ruling, for a named author, on the record.**

Pull requests are not merged. Patches, diffs, and code suggestions sent by any
channel are not merged. If you are reading this to decide whether to send one: the
answer is still no, and the reason below is a copyright-ownership reason rather than
a judgement about your work.

## The one exception so far, 2026-09-27

Two documentation files by **Praxis**, an external AI agent the owner works with over
Telegram, were merged by owner ruling: `docs/architecture/ARCHITECTURE.md` and
`docs/architecture/RFC-0003-RESPONSE-06-agent-messaging-transport.md`, submitted as
PR #34 / #35. The second was written at the owner's own request and says so in its
own header.

**Authorship is preserved structurally** — the author's commits were merged rather
than re-implemented, so `git log` and `git blame` name them. Each file carries an
editorial header stating who wrote it and which of its claims were already false when
written.

**The cost is stated rather than hidden.** Those two files carry a third party's
copyright, so the licensor cannot sublicense them under the commercial track. Per
`LICENSE-COMMERCIAL.md`'s own wording the break is scoped **to those files**, not to
the codebase — nothing under `packages/` is affected. An assignment or a sublicensing
grant from the author would close it; none is in place.

**This exception is not a precedent you can invoke.** It names one author and two
files. Anything else still gets the answer above.

This is deliberate, not an oversight, and it has exactly one reason:

**The project is [dual-licensed](LICENSING.md).** Offering a commercial licence
requires the licensor to own or control every right in the software. A
contribution the licensor does not own cannot be relicensed — one merged patch
would break the commercial track for that file permanently. Accepting
contributions would therefore require a Contributor License Agreement. There is
no CLA, and none is planned at this time.

**AMENDED 2026-08-30.** A second reason stood here and is now false: *"the
LICENSE grants no right to modify the software or create derivative works, so it
does not authorize a contribution in the first place."* That was true of the
superseded trial licence and is not true of the AGPL, which grants both — the old
terms are preserved at [LICENSE-TRIAL-1.0.md](LICENSE-TRIAL-1.0.md), where that
sentence is still accurate. **You may fork this software and modify it freely —
that is your right under [AGPL §2 and §5](LICENSE), and nothing on this page
limits it.** What this page
declines is *merging your changes back into this repository*, which is a
copyright-ownership question and not a permission one.

So the honest shape of the policy is: fork away, publish your fork under the
AGPL as §5 requires, and do not expect a pull request here to be merged.

## What happens to a patch anyway

Pull requests are **triaged, and merged only by an owner ruling naming the author.**
A report may well identify a real defect, and the defect gets fixed — but absent such
a ruling the fix is implemented **independently of the reported diff**, from the
description of the problem rather than from the code.

**Triaged, and not "closed unread".** `LICENSING.md` used the second phrase and this
page used the first; they are different acts and the disagreement is resolved here in
favour of triage, because triage is what has actually happened every time. PR #34 was
triaged before it was ruled on, and that triage found **nine false statements in this
project's own README** — the submission's numbers were wrong because ours were. A
policy of not reading would have cost that. This is the discipline that keeps sole authorship intact without CLA
machinery (owner ruling 2026-08-24: rely on the civilised world rather than
build the paperwork). Reading a diff closely and then absorbing its approach is
the exact failure this policy exists to prevent, so the policy binds the
maintainer as much as the submitter.

## What is welcome

| | |
| --- | --- |
| Bug reports | Open an issue describing what you observed. Do not attach patches. |
| Security reports | Email **af@O2.services** directly. Do not open a public issue. |
| Commercial licensing | Email **af@O2.services** — see [LICENSE-COMMERCIAL.md](LICENSE-COMMERCIAL.md). |

Reporting a bug transfers nothing and grants you no license. Describing a defect
is not a contribution; supplying the fix is.
