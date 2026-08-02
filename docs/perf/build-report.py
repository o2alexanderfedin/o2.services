#!/usr/bin/env python3
"""
Render the benchmark report to a standalone page for `gh-pages`.

`docs/story/build-page.py` does the markdown work and is reused rather than
reimplemented — it already handles the subset this report uses (h1-h3, tables,
fenced blocks, lists, inline code and links). What it does not do is emit a
complete HTML document: it produces a fragment whose `<title>` comes from
`page-shell.html`, because it was written for a host that supplies the
`<!doctype>`/`<head>`/`<body>` skeleton itself.

A page served from `gh-pages` has no such host, so this wraps the fragment into a
real document and replaces the shell's hard-coded title. The story's shell is left
untouched on purpose: changing it here would silently retitle the story page too.

    python3 docs/perf/build-report.py <in.md> <out.html> "<title>"

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
    sys.exit("usage: build-report.py <in.md> <out.html> <title>")

source, target, title = Path(sys.argv[1]), Path(sys.argv[2]), sys.argv[3]
builder = Path(__file__).resolve().parent.parent / "story" / "build-page.py"

fragment_path = target.with_suffix(".fragment.html")
subprocess.run([sys.executable, str(builder), str(source), str(fragment_path)], check=True)
fragment = fragment_path.read_text(encoding="utf-8")
fragment_path.unlink()

# The shell's title is a literal, not a placeholder, so it is replaced rather than
# filled. Anchored to the tag so a title appearing in prose is untouched.
fragment = re.sub(r"<title>.*?</title>\s*", "", fragment, count=1, flags=re.S)

target.write_text(
    "<!doctype html>\n"
    '<html lang="en">\n<head>\n'
    '<meta charset="utf-8">\n'
    '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
    f"<title>{html.escape(title)}</title>\n"
    '<meta name="description" content="Prime counting and a pi series measured on a '
    'peer-to-peer compute fabric: throughput, decomposition cost, fabric overhead and '
    'real parallel speedup.">\n'
    "</head>\n<body>\n" + fragment + "\n</body>\n</html>\n",
    encoding="utf-8",
)

words = len(re.sub(r"<[^>]+>", " ", fragment).split())
print(f"wrote {target}: {words:,} words, {len(target.read_text(encoding='utf-8')):,} bytes")
