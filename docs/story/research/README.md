# Research notes

Five documents produced by parallel agents surveying this repository for
[The Author Forgets](../the-author-forgets.md). They were written to be raw material, and
they are deliberately over-collected — the article uses perhaps a fifth of what is here.

They are kept because they turned out to be worth more than their purpose: together they are
the most complete index of this project's own history that exists anywhere, including in the
planning corpus they were mined from.

| File | What it holds |
|---|---|
| [01-git-history.md](01-git-history.md) | The commit arc, the best commit subjects verbatim with shas, every significant deletion and reversal, and the commits that admit an earlier claim was wrong |
| [02-planning-corpus.md](02-planning-corpus.md) | The mission in the project's own words, the phase-by-phase arc, the v1.0 audit, the owner rulings with their rejected alternatives, and the counting rules that decide when a phase is done |
| [03-design-and-constraints.md](03-design-and-constraints.md) | The core bet, the claim-splitting insight, the physical constraints that dictated the architecture, the determinism table, the disclosure gate, and the places the documents correct themselves |
| [04-code-archaeology.md](04-code-archaeology.md) | The package layout and purity tiers, the guest kernel's host ABI, the best source comments with `file:line`, and how the guard tests work — vocabulary, purity, and the mutation ledger |
| [05-results-and-negatives.md](05-results-and-negatives.md) | What has been demonstrated with numbers, what is explicitly *not* demonstrated and why, the benchmark's own honesty problem, and the measurements that contradicted an assumption |

## Reading them as reference rather than as prose

Each is organised by the question its agent was asked, not as narrative. Quotations are
verbatim and sourced. If you want to know why a decision was made, `02` and `03` are usually
faster than grepping the ROADMAP's HTML comments — though the ROADMAP remains the authority,
and these notes are a snapshot.

**Snapshot, not a live view.** These were taken on **2026-08-01**, during milestone v1.1 with
Phase 18 in flight. Line numbers drift: `packages/core/src/placement.ts` moved by roughly 140
lines during the very session these were written. Treat every citation the way this project
treats every citation in an unexecuted plan — **assume it is stale until re-read**. That rule
exists here because one phase's plans carried 41 wrong ones.
