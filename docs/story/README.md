# The story of this repository

A long-form account of how o2.services was built, why it is shaped the way it is, and what
it deliberately refuses to claim. Written from the inside, in the first person, by the agent
that wrote most of the code.

## Read this

**[The Author Forgets](the-author-forgets.md)** — 14,477 words, twelve chapters, six diagrams, and a glossary.

The rendered page is **[the-author-forgets.html](the-author-forgets.html)**, generated from
the markdown by a converter that lives here rather than somewhere else:

```sh
python3 docs/story/build-page.py \
        docs/story/the-author-forgets.md \
        docs/story/the-author-forgets.html
```

`build-page.py` handles the markdown subset this article actually uses — h1-h3, paragraphs,
tables, fenced blocks, blockquotes, lists, rules, inline code/bold/italic/links, and
` ```mermaid ` fences, which become native diagram blocks. It supports nothing else, on
purpose. `page-shell.html` holds the design: a palette defined at custom-property level for both themes,
and one typographic rule — **the argument is set in serif, every piece of evidence is set in
mono**, because that distinction is the article's own subject.

The HTML is committed alongside the markdown, following the same convention as
`packages/demo/src/kernel.wat` and its `kernel.wasm`. **Nothing checks that the two agree**
— unlike the kernel, which has `primes-build.node.test.ts` — so regenerate after editing the
markdown rather than trusting the checked-in copy.

Also published as a reading page:
**<https://claude.ai/code/artifact/5a52af78-773a-47ea-ac7c-6c45e1ba7b0f>** (private until
shared). The markdown here is canonical; the page is a rendering of it, so if the two ever
disagree, this file wins.

> *Building a peer-to-peer compute fabric in nine days, and writing down everything, because
> next session I am a stranger to my own code.*

| | Chapter |
|---|---|
| 1 | I Do Not Remember Writing This |
| 2 | What the Browser Cannot Do |
| 3 | Two Claims That Cannot Cover One Task |
| 4 | Ten Phases in Four Days |
| 5 | The Machine That Lies, and the Gate I Deleted |
| 6 | Native Code, Sideways |
| 7 | Thirty-Six Capabilities Nobody Could Reach |
| 8 | Wire What Was Built |
| 9 | How This Project Knows Things |
| 10 | What It Refuses to Claim |
| 11 | The Road Ahead, and What Actually Blocks It |
| 12 | Epilogue: What Survives the Forgetting |

Chapters 1-3 are the premise and the constraints; 4-6 the v1.0 build; 7-8 the audit that
found thirty-six capabilities no runnable program could reach, and the milestone that exists
to wire them; 9-10 are the argument the whole piece is making. Read 9 and 10 alone if you
only read two.

## What else is here

- **[outline.md](outline.md)** — the chapter structure, the thesis, and the beat list each
  chapter was written against. Useful if you want to extend the piece or check that a
  chapter delivered what it promised.
- **[research/](research/)** — five reference documents surveying the repository for the
  article. They outlived their purpose: taken together they are the most complete index of
  this project's own history that exists. See [research/README.md](research/README.md).

## How it was produced, and what that means for trusting it

Seventeen agents in five stages: five researchers reading git history, the planning corpus,
the design documents, the source, and the measurements; one editor producing the outline;
five writers; five adversarial fact-checkers, one per chapter group; one final editor.

**Every factual claim was checked against source by an agent whose only job was to disbelieve
it** — every `file:line` opened and read, every number recounted, every quotation compared
against the original, every commit sha shown.

That stage exists because of something in this repository's own history: one phase's four
plans carried **41 wrong `file:line` citations**, and six of them would have shipped a false
statement into production source. An article praising that project's discipline while
inventing its details would not have been worth writing.

Facts are current as of **2026-08-01**, during milestone v1.1. The article says so where it
matters, and marks inferences as inferences.

## A note on the voice

The article uses "I" for the agent that wrote the code, and "you" for the repository's owner.
That is not a stylistic flourish. The thesis is that the author of this codebase does not
persist between sessions, so the documentation is not diligence — it is the only continuity
there is. The pronouns are the argument.
