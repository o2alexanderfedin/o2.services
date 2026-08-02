#!/usr/bin/env python3
"""Render docs/story/the-author-forgets.md into the designed reading page.

Deliberately a subset converter: the source uses h1-h3, paragraphs, tables,
one fenced block, blockquotes, ordered and unordered lists, rules, and inline
code/bold/italic/links. Nothing else, so nothing else is supported.
"""
import html
import re
import sys
from pathlib import Path

SRC = sys.argv[1]
DST = sys.argv[2]

# --------------------------------------------------------------------------
# inline


def inline(t: str) -> str:
    """Inline formatting. Code first, so nothing inside a span is re-scanned."""
    out, i, n = [], 0, len(t)
    while i < n:
        if t[i] == '`':
            j = t.find('`', i + 1)
            if j == -1:
                out.append(html.escape(t[i]))
                i += 1
                continue
            out.append('<code>' + html.escape(t[i + 1:j]) + '</code>')
            i = j + 1
        else:
            j = t.find('`', i)
            chunk = t[i:] if j == -1 else t[i:j]
            out.append(_emphasis(html.escape(chunk)))
            i = n if j == -1 else j
    return ''.join(out)


def _emphasis(s: str) -> str:
    s = re.sub(r'\[([^\]]+)\]\(([^)]+)\)', r'<a href="\2">\1</a>', s)
    s = re.sub(r'\*\*([^*]+)\*\*', r'<strong>\1</strong>', s)
    s = re.sub(r'(?<!\*)\*([^*]+)\*(?!\*)', r'<em>\1</em>', s)
    return s


# --------------------------------------------------------------------------
# block

def slug(s: str) -> str:
    s = re.sub(r'`', '', s).lower()
    s = re.sub(r'[^a-z0-9\s-]', '', s)
    return re.sub(r'\s+', '-', s.strip())


def convert(md: str) -> tuple[str, list[tuple[str, str, str]]]:
    lines = md.split('\n')
    out: list[str] = []
    toc: list[tuple[str, str, str]] = []
    i, n = 0, len(lines)
    open_chapter = False

    while i < n:
        ln = lines[i]

        # fenced code — mermaid becomes a native diagram block, the rest a listing
        if ln.startswith('```'):
            lang = ln[3:].strip().lower()
            j = i + 1
            body = []
            while j < n and not lines[j].startswith('```'):
                body.append(lines[j])
                j += 1
            src = '\n'.join(body)
            if lang == 'mermaid':
                # A caption is the italic line immediately following the fence.
                cap = ''
                k = j + 1
                while k < n and lines[k].strip() == '':
                    k += 1
                if k < n and lines[k].startswith('*') and lines[k].rstrip().endswith('*') \
                        and not lines[k].startswith('**'):
                    cap = lines[k].strip().strip('*').strip()
                    j = k
                out.append('<figure class="diagram"><pre class="mermaid">'
                           + html.escape(src) + '</pre>'
                           + (f'<figcaption>{inline(cap)}</figcaption>' if cap else '')
                           + '</figure>')
            else:
                out.append('<figure class="listing"><pre><code>'
                           + html.escape(src) + '</code></pre></figure>')
            i = j + 1
            continue

        # h1 — consumed by the masthead, never emitted here
        if ln.startswith('# '):
            i += 1
            continue

        # h2 — a chapter
        if ln.startswith('## '):
            title = ln[3:].strip()
            if open_chapter:
                out.append('</section>')
            m = re.match(r'^Chapter (\d+):\s*(.+)$', title)
            if m:
                num, rest = m.group(1), m.group(2)
            elif title.lower().startswith('contents'):
                i += 1
                # skip the source TOC; the page builds its own
                while i < n and not lines[i].startswith('## '):
                    i += 1
                open_chapter = False
                continue
            else:
                num, rest = '', title
            sid = slug(title)
            toc.append((num, rest, sid))
            out.append(f'<section class="chapter" id="{sid}">')
            out.append('<header class="chapter-head">')
            if num:
                out.append(f'<span class="chapter-num" aria-hidden="true">{num}</span>')
            out.append(f'<h2>{inline(rest)}</h2>')
            out.append('</header>')
            open_chapter = True
            i += 1
            continue

        if ln.startswith('### '):
            out.append(f'<h3>{inline(ln[4:].strip())}</h3>')
            i += 1
            continue

        # table
        if ln.startswith('|') and i + 1 < n and re.match(r'^\|[\s:\-|]+\|$', lines[i + 1]):
            head = [c.strip() for c in ln.strip('|').split('|')]
            j = i + 2
            rows = []
            while j < n and lines[j].startswith('|'):
                rows.append([c.strip() for c in lines[j].strip('|').split('|')])
                j += 1
            t = ['<div class="table-scroll"><table><thead><tr>']
            t += [f'<th>{inline(c)}</th>' for c in head]
            t.append('</tr></thead><tbody>')
            for r in rows:
                t.append('<tr>' + ''.join(f'<td>{inline(c)}</td>' for c in r) + '</tr>')
            t.append('</tbody></table></div>')
            out.append(''.join(t))
            i = j
            continue

        # blockquote
        if ln.startswith('>'):
            j, body = i, []
            while j < n and (lines[j].startswith('>') or (body and lines[j].strip() == '' and j + 1 < n and lines[j + 1].startswith('>'))):
                body.append(re.sub(r'^>\s?', '', lines[j]))
                j += 1
            inner = '\n'.join(body).strip()
            paras = [p for p in re.split(r'\n\s*\n', inner) if p.strip()]
            out.append('<blockquote>' + ''.join(
                f'<p>{inline(p.replace(chr(10), " "))}</p>' for p in paras) + '</blockquote>')
            i = j
            continue

        # rule
        if re.match(r'^-{3,}$', ln.strip()):
            i += 1
            continue

        # ordered list
        if re.match(r'^\d+\.\s', ln):
            j, items = i, []
            while j < n and re.match(r'^\d+\.\s', lines[j]):
                items.append(re.sub(r'^\d+\.\s', '', lines[j]))
                j += 1
            out.append('<ol>' + ''.join(f'<li>{inline(x)}</li>' for x in items) + '</ol>')
            i = j
            continue

        # unordered list
        if re.match(r'^[-*]\s', ln):
            j, items = i, []
            while j < n and re.match(r'^[-*]\s', lines[j]):
                items.append(re.sub(r'^[-*]\s', '', lines[j]))
                j += 1
            out.append('<ul>' + ''.join(f'<li>{inline(x)}</li>' for x in items) + '</ul>')
            i = j
            continue

        if ln.strip() == '':
            i += 1
            continue

        # paragraph
        j, body = i, []
        while j < n and lines[j].strip() and not re.match(r'^(#{1,3} |\||>|```|\d+\.\s|[-*]\s|-{3,}$)', lines[j]):
            body.append(lines[j])
            j += 1
        if body:
            out.append(f'<p>{inline(" ".join(body))}</p>')
            i = j
        else:
            i += 1

    if open_chapter:
        out.append('</section>')
    return '\n'.join(out), toc


md = open(SRC, encoding='utf-8').read()
# the standfirst is the first paragraph after the subtitle line
mlines = md.split('\n')
subtitle = next((l.strip('* ') for l in mlines if l.startswith('*') and l.endswith('*') and len(l) > 40), '')
standfirst = ''
for k, l in enumerate(mlines):
    if l.startswith('*') and l.endswith('*') and len(l) > 40:
        for m in mlines[k + 1:]:
            if m.strip() and not m.startswith('-'):
                standfirst = m.strip()
                break
        break

body, toc = convert(md)
words = len(re.findall(r'\S+', re.sub(r'`[^`]*`', '', md)))

toc_rows = '\n'.join(
    f'<li><a href="#{sid}"><span class="toc-num">{num or "—"}</span>'
    f'<span class="toc-title">{inline(title)}</span></a></li>'
    for num, title, sid in toc)

page = open(Path(__file__).with_name('page-shell.html'), encoding='utf-8').read()
page = (page
        .replace('{{SUBTITLE}}', html.escape(subtitle))
        .replace('{{STANDFIRST}}', inline(standfirst))
        .replace('{{TOC}}', toc_rows)
        .replace('{{BODY}}', body)
        .replace('{{WORDS}}', f'{words:,}')
        .replace('{{CHAPTERS}}', str(len([t for t in toc if t[0]]))))

open(DST, 'w', encoding='utf-8').write(page)
print(f'wrote {DST}: {words:,} words, {len(toc)} sections')
