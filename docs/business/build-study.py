#!/usr/bin/env python3
"""
Render the o2-vs-AWS business study to a standalone page.

Same shape, and the same reasoning, as `docs/perf/build-report.py`: the markdown
work is done by `docs/story/build-page.py` and is reused rather than
reimplemented — it already handles everything this study uses (h1-h3, tables,
fenced blocks, blockquotes, lists, inline code and links, and ```mermaid fences,
which become native diagram blocks).

What `build-page.py` does not do is emit a complete HTML document. It produces a
fragment whose `<title>` comes from `page-shell.html`, because it was written for
a host that supplies the `<!doctype>`/`<head>`/`<body>` skeleton itself. A page
opened from disk has no such host, so this wraps the fragment into a real
document and replaces the shell's hard-coded title.

**Why a third near-identical wrapper instead of generalising the second.** The
story's shell is deliberately left untouched — changing it would silently retitle
the story page — and `build-report.py`'s meta description is the benchmark
report's own. Adding a description argument to it would change a command
`docs/story/README.md` documents, for the benefit of a doc tree that does not
share its subject. The project already accepted this trade once, at the
perf/story boundary, and this is the same boundary one tree over.

## The navigation problem this file exists to solve, and how it failed silently

`build-page.py` was written for an article whose navigation is a list of twelve
chapters. It therefore emits an `id` on the `<section class="chapter">` wrapper
of every `##` heading, **no `id` at all on `###` headings**, and it *discards* a
source `## Contents` section on the stated grounds that the page builds its own.

For an article that is correct. For a thirteen-section study with 49
subsections, a glossary that back-links into the body, and cross-references
between sections, it is not: the first build of this document produced 172
internal links and **zero** heading anchors below `##`. Every one of them was
dead in the HTML and in the PDF, while remaining perfectly correct in the
markdown — a failure with no error message, visible only by clicking.

So this file post-processes the fragment to:

1. give every `<h3>` an `id`, slugged by the same rules `build-page.py` uses for
   `##` (which is also what GitHub's slugger produces, and therefore what the
   markdown's own anchors were written against);
2. rebuild the generated table of contents as two levels rather than one, so an
   86-page PDF has navigation proportional to its length;
3. **verify that every internal link resolves, and fail the build if one does
   not.** That check is the whole point. The defect above was invisible because
   nothing asserted the invariant; a renderer that cannot fail is not a gate.

    python3 docs/business/build-study.py <in.md> <out.html> "<title>"

Build-time only. Nothing under `.github/` runs this — publishing this project is a
separately-triggered human act by its own constraint, and DEMO-04 requires that no
workflow file exist at all.
"""
import html
import re
import subprocess
import sys
from pathlib import Path

if len(sys.argv) != 4:
    sys.exit("usage: build-study.py <in.md> <out.html> <title>")

source, target, title = Path(sys.argv[1]), Path(sys.argv[2]), sys.argv[3]
builder = Path(__file__).resolve().parent.parent / "story" / "build-page.py"

fragment_path = target.with_suffix(".fragment.html")
subprocess.run([sys.executable, str(builder), str(source), str(fragment_path)], check=True)
fragment = fragment_path.read_text(encoding="utf-8")
fragment_path.unlink()


def text_of(markup: str) -> str:
    """Visible text of a heading: tags dropped, entities resolved."""
    return html.unescape(re.sub(r"<[^>]+>", "", markup)).strip()


def slug(s: str) -> str:
    """
    `build-page.py`'s rule, deliberately duplicated rather than imported.

    Importing would couple this file to a private helper in another doc tree and
    make a change there silently retarget every anchor here. The rule is three
    lines and its output is asserted against the document by `unresolved` below,
    so a divergence fails the build rather than shipping broken links.

    **One character of difference from `build-page.py`, and it broke three links.**
    That function collapses a whitespace *run* to one hyphen (`\\s+`); GitHub's
    slugger replaces each whitespace character individually. They agree on every
    ordinary heading and disagree on every heading containing an em dash, because
    removing the dash leaves two adjacent spaces: `Gate 1 — choose o2` is
    `gate-1-choose-o2` under one rule and `gate-1--choose-o2` under the other. The
    markdown's own anchors were written by GitHub's slugger, and the markdown is
    canonical, so this matches GitHub and the section ids below are rewritten to
    match too rather than the links being bent to fit the renderer.
    """
    s = re.sub(r"`", "", s).lower()
    s = re.sub(r"[^a-z0-9\s-]", "", s)
    return re.sub(r"\s", "-", s.strip())


# `build-page.py` slugs `##` headings with its own rule, so its section ids are
# rewritten here from the same heading text. Dedupe is shared across both passes
# and in document order, which is what GitHub does; this document has no colliding
# headings today, and `unresolved` below is what would catch it if that changed.
seen: dict[str, int] = {}


def unique(base: str) -> str:
    count = seen.get(base, 0)
    seen[base] = count + 1
    return base if count == 0 else f"{base}-{count}"


# ------------------------------------------------------------ 1. section anchors
def anchor_section(match: re.Match[str]) -> str:
    head, heading = match.group(2), match.group(3)
    return f'<section class="chapter" id="{unique(slug(text_of(heading)))}">{head}<h2>{heading}</h2>'


fragment, section_count = re.subn(
    r'<section class="chapter" id="([^"]+)">(.*?)<h2>(.*?)</h2>',
    anchor_section,
    fragment,
    flags=re.S,
)


# --------------------------------------------------------- 2. subsection anchors
def anchor_h3(match: re.Match[str]) -> str:
    return f'<h3 id="{unique(slug(text_of(match.group(1))))}">{match.group(1)}</h3>'


fragment, h3_count = re.subn(r"<h3>(.*?)</h3>", anchor_h3, fragment, flags=re.S)

# ------------------------------------------------------- 2. two-level contents
# Document order matters, so sections and subsections are collected in one pass
# rather than separately and zipped — zipping assumes every h3 follows the
# section it belongs to, which is true today and is exactly the kind of
# assumption that stops being true after an edit.
entries: list[tuple[int, str, str]] = []
for m in re.finditer(
    r'<section class="chapter" id="([^"]+)"|<h2>(.*?)</h2>|<h3 id="([^"]+)">(.*?)</h3>',
    fragment,
    flags=re.S,
):
    if m.group(1):
        entries.append((2, m.group(1), ""))
    elif m.group(2) is not None and entries and entries[-1][0] == 2 and not entries[-1][2]:
        entries[-1] = (2, entries[-1][1], text_of(m.group(2)))
    elif m.group(3):
        entries.append((3, m.group(3), text_of(m.group(4))))

items = []
depth = 2
for level, sid, label in entries:
    if not label:
        continue
    if level == 3 and depth == 2:
        items.append("<ol class=\"toc-sub\">")
        depth = 3
    elif level == 2 and depth == 3:
        items.append("</ol></li>")
        depth = 2
    elif items:
        items.append("</li>")
    items.append(
        f'<li><a href="#{sid}"><span class="toc-num">—</span>'
        f'<span class="toc-title">{html.escape(label)}</span></a>'
    )
items.append("</ol></li>" if depth == 3 else "</li>")
toc = "<ol>" + "".join(items) + "</ol>"

nav = re.search(r'(<nav class="contents".*?>)(.*?)(</nav>)', fragment, flags=re.S)
if nav is None:
    sys.exit("build-study.py: no <nav class=\"contents\"> in the fragment to replace")
sections = sum(1 for level, _, label in entries if level == 2 and label)
words = len(re.sub(r"<[^>]+>", " ", fragment).split())
fragment = (
    fragment[: nav.start()]
    + nav.group(1)
    + f"\n    <h2>Contents · {sections} sections · {words:,} words</h2>\n    "
    + toc
    + "\n  "
    + nav.group(3)
    + fragment[nav.end():]
)

# ------------------------------------------------------------- 3. verify links
ids = set(re.findall(r'<(?:section|h1|h2|h3)[^>]*\bid="([^"]+)"', fragment))
targets = set(re.findall(r'href="#([^"]+)"', fragment))
unresolved = sorted(t for t in targets if t not in ids)
if unresolved:
    sys.exit(
        "build-study.py: "
        f"{len(unresolved)} internal link(s) resolve to no heading:\n  "
        + "\n  ".join(unresolved)
    )

# The shell's title is a literal, not a placeholder, so it is replaced rather than
# filled. Anchored to the tag so a title appearing in prose is untouched.
fragment = re.sub(r"<title>.*?</title>\s*", "", fragment, count=1, flags=re.S)

target.write_text(
    "<!doctype html>\n"
    '<html lang="en">\n<head>\n'
    '<meta charset="utf-8">\n'
    '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
    f"<title>{html.escape(title)}</title>\n"
    '<meta name="description" content="A costed architecture and business comparison of '
    "building a cross-enterprise security telemetry consortium on a peer-to-peer cloud "
    'versus AWS multi-tenant SaaS and AWS BYOC.">\n'
    "</head>\n<body>\n" + fragment + "\n</body>\n</html>\n",
    encoding="utf-8",
)

print(
    f"wrote {target}: {words:,} words, {len(target.read_text(encoding='utf-8')):,} bytes, "
    f"{sections} sections, {h3_count} subsection anchors, "
    f"{len(targets)} internal links all resolving"
)
