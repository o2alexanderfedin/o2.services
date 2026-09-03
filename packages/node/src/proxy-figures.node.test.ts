import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { blocking, commitScope, trackedPaths } from './commit-scope.ts'
import { emptyFunnelJournal } from '../../cloudflare/src/funnel-journal.ts'
import { FUNNEL_STAGES } from '@o2/net'

/**
 * Criterion 5 — **no published figure derived from this instrumentation is merged with or
 * backfilled from a proxy**, enforced rather than remembered.
 *
 * `RUN-04`'s own sentence is the rule this file implements: *"The bounds available are proxies
 * and are labelled as proxies wherever quoted."* There is **no published figure for what
 * fraction of a general audience cannot participate** — that is the number Phase 37 exists to
 * start taking — so every figure this project can quote today comes from somewhere else, and a
 * reader who meets one without its label will read it as this project's own measurement.
 *
 * The failure is silent by construction: nothing breaks, a number simply becomes more confident
 * than its source. So it is a guard, the same shape as `vocabulary.node.test.ts` aimed at a
 * different pattern, and it participates in the commit scope for the same reason.
 *
 * ## The scan set, chosen deliberately and written down
 *
 * **Tracked `.md` under `.planning/` and `docs/`.** Those are where a figure gets *quoted as a
 * claim* — a roadmap row, a requirements row, a phase summary, a published study. Source code
 * is out because a proxy figure has no business being a literal in it, and if one ever is,
 * that is a different defect than an unlabelled quotation.
 *
 * **`.planning/research/` is excluded by path, and the precedent is this repository's own.**
 * `vocabulary.node.test.ts` exempts exactly that tree with exactly this reasoning: it is *"the
 * literature review that motivates this rule"* — the place the figures come FROM, carrying
 * their provenance, their confidence ratings and their own disclaimers about measuring a
 * different protocol on a different network. The risk criterion 5 names is a figure re-used
 * downstream as a measurement, not the citation list it was taken from.
 *
 * **This file excludes itself by path**, because it quotes all five figures in order to know
 * them. `CLAUDE.md` records prose explaining a literal tripping the guard over that literal
 * twice in one session; the exclusion is registered rather than discovered.
 *
 * ## The patterns are anchored to their CLAIM, not to their digits
 *
 * Measured, and it changed the design: a bare `7.1%` matched a cost table in
 * `docs/business/o2-vs-aws-study.md` that has nothing to do with hole-punching, and a bare
 * `70%` matched CSS custom properties and UI mockups. A guard whose false positives outnumber
 * its findings is a guard somebody deletes. Each pattern therefore carries enough of its own
 * sentence to identify the claim.
 *
 * ## The reading this took, recorded
 *
 * 2026-09-02, over **438** files: **26** occurrences, **0** unlabelled.
 */

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const SELF = 'packages/node/src/proxy-figures.node.test.ts'
const SCOPE = commitScope()

/**
 * How far from a quotation its label may sit.
 *
 * A paragraph, roughly. Not a line: these figures are quoted inside prose that wraps, and a
 * line-scoped rule would demand the word on the same line as the digits, which is a formatting
 * requirement rather than an honesty one. Not a whole file either: a document that says
 * "proxy" once in its header and quotes a figure nine hundred lines later has not labelled it.
 */
const LABEL_WINDOW = 400

interface ProxyFigure {
  readonly id: string
  /** Anchored to the claim rather than to the digits — see the header. */
  readonly pattern: RegExp
  readonly source: string
}

/**
 * The five bounds, with where each comes from.
 *
 * **All five are from a different protocol, a different network, or an industry blog post, and
 * none of them answers this project's question.** That sentence is the whole of criterion 5,
 * and the entries below are what a guard can check.
 */
export const PROXY_FIGURES: readonly ProxyFigure[] = [
  {
    id: 'relay-required',
    pattern: /10[–-]20\s?%/g,
    source: 'industry WebRTC guidance (bloggeek.me / VideoSDK) on the share of users who cannot establish a direct connection — a relay-REQUIRED rate, not a complete-failure rate, and not measured on this fabric',
  },
  {
    id: 'dcutr-success',
    pattern: /70\s?%\s*(?:±|\+\/-)\s*7\.1\s?%/g,
    source: 'Trautwein et al., 4.4M hole-punch attempts — DCUtR, which is libp2p relay upgrade and not raw browser WebRTC ICE',
  },
  {
    id: 'relay-fallback',
    pattern: /~\s?30\s?%\s*relay\s*fallback/g,
    source: 'the complement of the DCUtR figure above, and inherits every one of its qualifications',
  },
  {
    id: 'symmetric-nat',
    pattern: /11\s?%\s*symmetric\s*NAT/g,
    source: 'the same measurement — the share of peers behind the NAT class hole-punching cannot solve without TURN',
  },
  {
    id: 'arxiv',
    pattern: /arXiv:2510\.27500/g,
    source: 'the paper all three DCUtR figures come from; naming it IS the qualification, so it carries the label rule too',
  },
]

/** What counts as a label. One word and its plural, and deliberately nothing else. */
const PROXY_LABEL = /\bprox(?:y|ies)\b/i

/** Trees whose quotation of these figures is the source rather than a downstream claim. */
const EXCLUDED_TREES: readonly { readonly path: string; readonly reason: string }[] = [
  {
    path: '.planning/research/',
    reason:
      'the literature review the figures come from, carrying their provenance, confidence ' +
      'ratings and its own disclaimers about a different protocol on a different network — ' +
      "the same tree, for the same reason, that `vocabulary.node.test.ts` exempts by path",
  },
  {
    path: SELF,
    reason: 'this registry quotes all five in order to know them; a guard cannot state its own rule otherwise',
  },
]

function scanned(): string[] {
  return [...trackedPaths(ROOT)].filter(
    (path) =>
      path.endsWith('.md') &&
      (path.startsWith('.planning/') || path.startsWith('docs/')) &&
      !EXCLUDED_TREES.some((one) => path === one.path || path.startsWith(one.path)),
  )
}

interface Hit {
  readonly path: string
  readonly line: number
  readonly figure: string
  readonly text: string
  readonly labelled: boolean
}

function findAll(): Hit[] {
  const hits: Hit[] = []
  for (const path of scanned()) {
    let text: string
    try {
      text = readFileSync(join(ROOT, path), 'utf8')
    } catch {
      continue
    }
    for (const figure of PROXY_FIGURES) {
      const pattern = new RegExp(figure.pattern.source, 'g')
      let match = pattern.exec(text)
      while (match !== null) {
        const window = text.slice(
          Math.max(0, match.index - LABEL_WINDOW),
          match.index + match[0].length + LABEL_WINDOW,
        )
        hits.push({
          path,
          line: text.slice(0, match.index).split('\n').length,
          figure: figure.id,
          text: match[0],
          labelled: PROXY_LABEL.test(window),
        })
        match = pattern.exec(text)
      }
    }
  }
  return hits
}

describe('criterion 5 — every proxy bound is labelled as one wherever it is quoted', () => {
  it('reads a corpus big enough for the verdict to mean anything', () => {
    // THE FLOOR. Without it, a scan that stopped matching — a renamed tree, a broken glob, a
    // pattern that no longer compiles — reports a clean sheet, which is the failure that reads
    // exactly like success.
    expect(scanned().length, 'the scan set is empty, so the verdict below is about nothing').toBeGreaterThan(
      100,
    )
    const hits = findAll()
    expect(
      hits.length,
      'no proxy figure was found anywhere. Either the patterns stopped matching or the figures ' +
        'left the tree — check which before trusting the case below.',
    ).toBeGreaterThan(10)
    // Every figure in the registry is actually found somewhere, so an entry cannot rot into a
    // pattern that matches nothing while the guard still reports green.
    for (const figure of PROXY_FIGURES) {
      expect(
        hits.some((hit) => hit.figure === figure.id),
        `the registry entry "${figure.id}" matches nothing in the tree — a dead pattern is an ` +
          'exemption nobody registered',
      ).toBe(true)
    }
  })

  it('finds no quotation without its label', () => {
    const unlabelled = findAll()
      .filter((hit) => !hit.labelled)
      .map((hit) => ({
        paths: [hit.path],
        line:
          `${hit.path}:${String(hit.line)} quotes the proxy figure "${hit.text}" ` +
          `(${hit.figure}) with no proxy label within ${String(LABEL_WINDOW)} characters. ` +
          'RUN-04: no published figure exists for what fraction of a general audience cannot ' +
          'participate, so this number is somebody else’s measurement of something else. ' +
          'Say so beside it, or remove it.',
      }))
    expect(blocking('proxy-figures/unlabelled', unlabelled, SCOPE)).toEqual([])
  })
})

describe('criterion 5 — no funnel counter is ever initialised to anything but zero', () => {
  /**
   * The other half of criterion 5's sentence, and the reason it belongs beside the first.
   *
   * *"No published figure … is merged with or **backfilled** from a proxy."* A backfill has to
   * start somewhere, and the cheapest place is a counter that begins at an estimate — after
   * which every reading is part measurement and part guess, and nothing anywhere says which
   * part is which.
   */
  it('a fresh journal is six zeros, asserted as literals', () => {
    const fresh = emptyFunnelJournal('opted-in-only')
    expect(fresh.entered).toEqual({
      'page-load': 0,
      consent: 0,
      'wss-bootstrap': 0,
      'ice-gathering': 0,
      'connection-classified': 0,
      'first-task': 0,
    })
    expect(fresh.stalledAt).toEqual(fresh.entered)
    // And the cell maps start empty rather than pre-populated with plausible shapes.
    expect(fresh.byStageHour).toEqual({})
    expect(fresh.webrtcAttempts).toEqual({})
    expect(fresh.webrtcOutcomes).toEqual({})
  })

  it('the journal source contains no non-zero seed', () => {
    // Read from the source text as well as from the value, because a seed could be applied on a
    // path the constructor above does not take — a restore, a migration, a default parameter.
    const source = readFileSync(join(ROOT, 'packages/cloudflare/src/funnel-journal.ts'), 'utf8')
    for (const stage of FUNNEL_STAGES) {
      // **The `\\]?` is there because the plant found it missing.** Written first without it,
      // the pattern caught `'page-load': 12` and missed `seeded['wss-bootstrap'] = 7` — the
      // bracketed form, which is exactly how a seed would be written into a record built by a
      // helper. The value case above went red on that plant and this one stayed green, so the
      // source scan was claiming a reach it did not have.
      const seeded = new RegExp(`['"\`]?${stage}['"\`]?\\s*\\]?\\s*[:=]\\s*[1-9]`)
      expect(
        seeded.test(source),
        `funnel-journal.ts seeds the stage "${stage}" with a non-zero value. A counter that ` +
          'starts at an estimate is a backfill that happened before anybody published anything.',
      ).toBe(false)
    }
  })
})
