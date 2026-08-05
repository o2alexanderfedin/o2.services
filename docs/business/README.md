# Business case studies

Costed comparisons of building a real product on this project's peer-to-peer cloud against
building the same product the conventional way. Written for a founder and a technical
co-founder to read end to end and act on.

## Read this

**[Building on a P2P Cloud vs. Building on AWS](o2-vs-aws-study.md)** — ~20,800 words,
thirteen sections, three architecture diagrams, a 65-term glossary, and every price cited to
a primary source with the date it was observed.

One product is carried all the way through as the test case: a **Detection-Efficacy &
Sighting Consortium**, where each member enterprise runs nodes against the SIEM/EDR data lake
it already operates, maps 1–10 TB/day of raw security telemetry locally, and ships ~3 MB per
member per day of k-anonymised partials to a verified cross-owner reduce. Three paths are
architected and costed: the P2P cloud with on-premises members, AWS multi-tenant SaaS, and
AWS BYOC.

## Three renderings, all built from the markdown

| File | For |
|---|---|
| [`o2-vs-aws-study.html`](o2-vs-aws-study.html) | the hosted page — diagrams stay as `mermaid` blocks and are drawn by the host |
| [`o2-vs-aws-study.standalone.html`](o2-vs-aws-study.standalone.html) | opening from disk — diagrams baked to inline SVG, **no script, no network** |
| [`o2-vs-aws-study.pdf`](o2-vs-aws-study.pdf) | print — 89 pages, A4, with the contents and every cross-reference live as internal links |

```sh
# 1. the hosted page
python3 docs/business/build-study.py \
        docs/business/o2-vs-aws-study.md \
        docs/business/o2-vs-aws-study.html \
        "Building on a P2P Cloud vs. Building on AWS"

# 2. the standalone page and the PDF, from (1)
#    mermaid is installed to a scratch directory on purpose — a documentation
#    renderer has no business in this repository's dependency tree
npm --prefix /tmp/mermaid-build i mermaid@11
node docs/story/build-standalone.mjs \
     docs/business/o2-vs-aws-study.html \
     docs/business/o2-vs-aws-study.standalone.html \
     docs/business/o2-vs-aws-study.pdf \
     /tmp/mermaid-build/node_modules/mermaid/dist/mermaid.min.js
```

`build-study.py` is the same wrapper shape as `docs/perf/build-report.py`, for the same
reason: `docs/story/build-page.py` does the markdown work and emits a fragment, and each doc
tree supplies its own title and description rather than editing a shell shared with another
tree. Its header says why a third near-identical wrapper was preferred to generalising the
second.

It also does three things `build-page.py` does not, because that converter was written for an
article whose navigation is a list of twelve chapters rather than for a thirteen-section study
with 49 subsections, a glossary that back-links into the body, and cross-references throughout.
It gives every `###` an anchor — `build-page.py` emits none below `##` — it rebuilds the
generated contents as two levels rather than one, and **it fails the build if any internal
link resolves to no heading.**

That last check is not decoration. The first build of this document produced 172 internal
links and **zero** heading anchors below `##`: every cross-reference and every glossary
back-link was dead in the HTML and the PDF while remaining perfectly correct in the markdown,
with no error and nothing to notice but a click that does nothing. The check then caught a
second, subtler defect immediately — `build-page.py` collapses a run of whitespace to one
hyphen where GitHub's slugger replaces each space individually, so the two disagree on every
heading containing an em dash. The markdown is canonical, so the renderer was changed to match
GitHub rather than the links bent to fit the renderer.

**The HTML and PDF are committed alongside the markdown**, following the convention set by
`packages/demo/src/kernel.wat` and its `kernel.wasm` and repeated in `docs/story/`. As there,
**nothing checks that the renderings agree with the markdown** — so regenerate after editing
rather than trusting the checked-in copies. The markdown is canonical; if the two ever
disagree, the markdown wins.

## What else is here

- **[model/](model/)** — the Python that produces every figure in §8. `finbase.py` holds the
  inputs, `fin.py` and `fin2.py` the consolidated model, `model.py` and `levers.py` the
  scale and sensitivity sweeps, and `audit.py`/`audit2.py`/`audit3.py` the arithmetic audit.
  They are included because §8 asks the reader to check its arithmetic, and an invitation to
  check that ships no way of checking is not one. The audit reproduced the write-up exactly
  and then found three structural defects in it — the largest being that the published
  totals omitted sales and marketing entirely, which understated the gap **in the P2P
  cloud's disfavour**. §8.4 carries the correction as a separate column rather than quietly
  restating the original.

## How it was produced, and what that means for trusting it

Nineteen agents in six stages: three product strategists proposing candidates from
independent angles, one judge selecting a product and fixing a workload specification that
every later stage used verbatim, three architects, seven cost researchers, one financial
modeller, two commercial reviewers, and one arithmetic auditor.

**Prices are cited to primary sources** — the AWS Price List Bulk API, vendor pricing pages,
public filings, and statute — each with the date it was observed. Anything that could not be
verified is labelled ESTIMATE with its derivation shown, and §13.1 lists what remains
unverified and what it would cost to close.

**Where researchers disagreed, both figures are shown and the choice is defended** rather
than averaged away. The clearest case is support cost, where a percentage-of-revenue
heuristic and a bottom-up derivation differ by around $4.8k per member per year; the model
takes the bottom-up figure because it is the one with a derivation, which makes the reported
margins two to four points *worse* than the alternative would have.

**The study argues against the platform in several places, and those passages are the point.**
It finds that the P2P path loses on gross margin, loses on marginal cost to serve the next
customer, and loses the infrastructure line to AWS BYOC once the platform fee is included. It
also finds that the fee anchor this project has been using is unstable by a factor of 34. A
study that could only conclude one thing would not have been worth commissioning.

### Not published

`gh-pages` is untouched, and nothing here adds anything under `.github/`. Publishing is a
**separately-triggered human act** by this project's own constraint — public hosting is
public disclosure, and DEMO-04 requires that no deploy workflow file exist at all, which
`disclosure-gate.node.test.ts` asserts. These files are built and ready; whether they go
anywhere is not a build step's decision.

Also published as a private reading page:
**<https://claude.ai/code/artifact/486130d4-0447-4201-a612-95afea5ff657>**. That page is a
rendering of an earlier revision of the markdown here, taken before the contents, glossary and
cross-references were added.
