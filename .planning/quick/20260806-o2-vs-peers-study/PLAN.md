---
slug: o2-vs-peers-study
date: 2026-08-06
mode: quick
---

# Land the technical peer comparison in `docs/business/`

## Task

Move the completed o2-vs-peers technical comparison study from the session scratchpad into
`docs/business/`, following the naming and index conventions already set by
`o2-vs-aws-study.md`.

## Why it is off-roadmap

The study answers a question no phase owns: *when the platform is complete, how does it weigh
against its technical peers?* The existing `o2-vs-aws-study.md` costs the business case against
the conventional way of building the same product; this one compares the technology against
wasmCloud, Cloudflare Workers, the Internet Computer, Bacalhau/Fluence, BOINC and Apple Private
Cloud Compute. Neither subsumes the other.

## Scope

1. `docs/business/o2-vs-peers-study.md` — the study, ~3,700 words, eight sections, one matrix.
2. `docs/business/README.md` — index entry, stating what the study is for and how it differs
   from the AWS study, in that file's existing voice.
3. `.planning/STATE.md` — an off-roadmap entry under Session Continuity, carrying the four
   findings that bear on decisions **outside** the document so they are not lost with it.

## Explicitly not in scope

- **Renderings.** The AWS study ships `.html`, `.standalone.html` and `.pdf` built by
  `build-study.py` + `build-standalone.mjs`. This study has no mermaid diagrams and no glossary
  back-links, so the renderer's reason for existing does not apply. The markdown is canonical
  either way, and `README.md` records that no renderings are checked in for it.
- **Acting on the findings.** BOINC-style selective replication, the CDN-keyed-by-CID artifact
  path, the NaN-influenced-output ruling and the `operatorId` scarcity question are all recorded
  in STATE.md and are owner decisions, not part of landing the document.
- **Publishing.** DEMO-04 holds. Nothing here touches `gh-pages` or adds anything under
  `.github/`.

## Verification

- The study exists at the stated path and matches the scratchpad source.
- `README.md` names it and distinguishes it from the AWS study.
- STATE.md still parses — `state-frontmatter` guard green, whole-file `tsc --noEmit` clean.
- Commit uses explicit paths, and `git show --stat` lists only the four files above.
