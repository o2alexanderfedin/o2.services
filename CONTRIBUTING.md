# Contributing

**This project does not accept contributions.**

Pull requests will be closed without review. Patches, diffs, and code suggestions
sent by any channel will not be merged.

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

Pull requests are **triaged, never merged.** A report may well identify a real
defect, and the defect gets fixed — but the fix is implemented **independently of
the reported diff**, from the description of the problem rather than from the
code. This is the discipline that keeps sole authorship intact without CLA
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
