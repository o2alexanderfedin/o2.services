---
slug: o2-vs-peers-study
date: 2026-08-06
mode: quick
status: complete
---

# Summary

`docs/business/o2-vs-peers-study.md` landed alongside the AWS study, with an index entry in
`docs/business/README.md` and an off-roadmap record in `.planning/STATE.md`.

## What the guard caught, twice, and the second time is the interesting one

`vocabulary.node.test.ts` refused the commit **twice**.

**First**, on four occurrences in the new study of the guard's cryptocurrency term — a matrix row
naming the incentive column, and two lines in §3.3 describing how ICP, Fluence, Akash and iExec
reach integrity. The guard's own header explains why that matters, and the reasoning applies to
this document exactly: the demo ships a policy page for a human reviewer who decides whether the
origin goes on a cryptojacking blocklist, and that reviewer *greps* — they do not read intent and
do not open a design document to check which sense was meant. A study **about** decentralized
compute is precisely the file where that word arrives innocently and reads as cryptocurrency to a
grep. A blocklist entry is origin-level, effectively permanent, and fails invisibly: nobody
reports that the page was blocked, it simply contributes nothing.

So the fix was to reword rather than exempt — "crypto-asset" carries the same meaning and is not
what the blocklists key on. An exemption would have been defensible on intent and worthless
against the actual threat model.

**Second**, on this very file. The first draft of this summary recorded the catch by *listing all
five* of the guard's banned terms, to note that the study had introduced only one of them. The
guard failed it on all five, and was right to a second time — a reviewer greps the repository, not
the repository's intentions, and a post-mortem naming the words is indistinguishable from a
document using them. This paragraph is the rewrite. **The lesson generalises past this file: a
document explaining a lexical rule cannot quote the lexicon it enforces.**

Recorded without naming them: the study introduced exactly one of the guard's five terms. The
other four were absent on a repo-wide scan, including throughout §7, which discusses the Coinhive
economics at length and was the section most likely to trip them.

## Verification

- Pre-commit hook (`vocabulary`, `purity`, `mutation-ledger`, `disclosure`, `ledgers`):
  **6 files, 239 tests, green** on the accepted commit.
- Standalone re-run of `state-frontmatter`, `vocabulary`, `disclosure-gate`: **3 files, 46 tests,
  exit 0**, read directly off `EXIT=$?` on the line after the command.
- Commit made with explicit paths; `git show --stat` confirmed only the intended files.
- DEMO-04 untouched: no deploy workflow added, `gh-pages` not involved.

## Not done, deliberately

No `.html` / `.standalone.html` / `.pdf` renderings. The AWS study needs them because it has
mermaid diagrams, a 65-term glossary that back-links into the body, and 172 internal
cross-references; this study has none of those, so the renderer's reason for existing does not
apply. `README.md` records that the markdown is the only form.

## Open, and owner's to rule

Four findings are recorded in STATE.md rather than acted on: BOINC-style reputation-gated
selective replication at 5-10% against the current flat redundancy; a CDN keyed by CID for
artifact distribution; whether a NaN-*influenced* output can diverge past the DAG-CBOR boundary on
a mixed-architecture quorum; and the `operatorId` scarcity question that makes "independent
agreement" an assertion rather than a measurement.
