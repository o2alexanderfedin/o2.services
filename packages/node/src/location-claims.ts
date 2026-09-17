/**
 * `HOST-07` — the term list, the placement-verb set, and the matcher both tiers of the guard
 * share.
 *
 * ## The two rules the criterion names, restated as data
 *
 * - **Tier 1 — a term, anywhere on the published surface.** A place name in published copy
 *   or in a results document is a violation regardless of what sentence it sits in.
 * - **Tier 2 — an attribution, anywhere in the tree.** A line naming one of the closed set of
 *   region addresses together with a placement verb is a violation even when the place it
 *   names is not on {@link LOCATION_TERMS} — this is the half that catches an invented place,
 *   and it is what makes Tier 1's list a floor rather than a ceiling.
 *
 * `location-claims.node.test.ts` decides which corpus each tier scans and applies the
 * exemption layer; this module owns only the vocabulary and the raw matcher, on
 * `banned-vocabulary.ts`'s own separation: the matcher must be provable independently of
 * where a file happens to live.
 *
 * ## What this module deliberately does NOT fire on
 *
 * `funnel-collector.ts` carries a two-letter country code stamped by the edge about a
 * **visitor** — `funnelDimensionsFrom` reads `CF-IPCountry` or `request.cf.country` and never
 * derives one from an address. That is a claim about where a *visitor* is. `HOST-07` is about
 * where a hosted **object** runs, and the two must not be confused: {@link LOCATION_TERMS}
 * holds place *names*, never two-letter codes, so a stamped `US`/`DE`/`ZZ` never matches it,
 * and {@link PLACEMENT_VERBS} only matters at all once a region address is also on the line —
 * a funnel report never carries one.
 *
 * ## A region address is an address, never a location claim
 *
 * `worker.ts`'s `turnUrlsFor` already states the discipline this module exists to enforce:
 * *"Naming a region here claims nothing about where anything runs."* `bootstrap-us`,
 * `bootstrap-eu` and `bootstrap-sam` are addresses in that sense — writing one down, on its
 * own, is not a violation of either tier. Tier 2 fires on the ADDRESS PLUS A VERB, never on
 * the address alone.
 *
 * ## This module is outside Tier 1's corpus and carries no self-exemption
 *
 * `vocabulary.node.test.ts`'s equivalent module, `banned-vocabulary.ts`, needs a
 * `EXEMPT_PATHS` entry because the corpus it is read against is `git ls-files` in full — every
 * tracked file, including this one. Tier 1 here is narrower: only the published surface and
 * the results documents (`location-claims.node.test.ts` states the exact list). This module
 * lives in `packages/node/src/`, which Tier 1 never reads, so a `'term'` finding against it is
 * structurally impossible and no entry is needed for that half. Tier 2 reads every tracked
 * file including this one, but this module never writes a region address next to a placement
 * verb — the addresses arrive as a caller-supplied parameter and are never hard-coded here —
 * so no `'attribution'` finding is possible either. Both are asserted, not merely argued: see
 * `location-claims.node.test.ts`'s dead-exemption check, which would report an entry added
 * here that the scan never needed.
 *
 * ## The patterns are `/g` (or `/gi`), so they carry a `lastIndex`
 *
 * Same rule as `banned-vocabulary.ts`, restated because this module has a second importer the
 * day it is read by anything besides its own spec: read every pattern with `matchAll`, never
 * with `RegExp#test` — a `test` call leaves `lastIndex` where its match ended, and the next
 * caller silently starts partway through the string.
 */

/** One row of the published-place-name list Tier 1 refuses. */
export interface LocationTerm {
  readonly term: string
  readonly pattern: RegExp
  readonly why: string
}

/**
 * The closed list Tier 1 scans for, on the published surface and in the results.
 *
 * Two sources, both read from the tracked tree rather than invented:
 *
 * 1. **The platform's own published `locationHint` vocabulary**, spelled out the way a
 *    document actually writes it. `.planning/research/v2.0/STACK.md:110-115` records the
 *    values Cloudflare's own docs list for Durable Objects placement — `wnam`, `enam`, `sam`,
 *    `weur`, `eeur`, `apac`, `oc`, `afr`, `me` — and each row below is that code's place name,
 *    because a document never writes the four-letter code, it writes the place.
 * 2. **Place names already at risk in this project's own writing.** `São Paulo` is the exact
 *    example `.planning/REQUIREMENTS.md`, `.planning/ROADMAP.md:2425` and this phase's
 *    `33-CONTEXT.md` all use to state the rule — HOST-07's own worked example of what a
 *    report must never write. `London` and `Miami` are confirmed, by grepping the tracked
 *    tree rather than assumed, already written as worked examples in
 *    `docs/superpowers/specs/2026-08-11-h3-geographic-discovery-design.md` — a document whose
 *    entire subject is geography, and therefore the file most likely to carry a fifth if this
 *    list is ever widened without re-running the grep.
 *
 * At least 8 rows, each with a `why` a reviewer can read without cross-referencing anything
 * else — `location-claims.node.test.ts` asserts both the floor and the length of every `why`.
 */
export const LOCATION_TERMS: readonly LocationTerm[] = [
  {
    term: 'Western North America',
    pattern: /\bWestern North America\b/gi,
    why: "the platform's own name for the `wnam` locationHint expansion; naming it beside a result reads as where the object ran",
  },
  {
    term: 'Eastern North America',
    pattern: /\bEastern North America\b/gi,
    why: "the platform's own name for the `enam` locationHint expansion; naming it beside a result reads as where the object ran",
  },
  {
    term: 'South America',
    pattern: /\bSouth America\b/gi,
    why: "the platform's own name for the `sam` locationHint expansion this fabric actually configures — the closest a caption can get to naming this project's own hint as a place",
  },
  {
    term: 'Western Europe',
    pattern: /\bWestern Europe\b/gi,
    why: "the platform's own name for the `weur` locationHint expansion; naming it beside a result reads as where the object ran",
  },
  {
    term: 'Eastern Europe',
    pattern: /\bEastern Europe\b/gi,
    why: "the platform's own name for the `eeur` locationHint expansion, and already present in this project's own cost study as a hiring-market comparison — see the exemption for why that occurrence is not this violation",
  },
  {
    term: 'Asia-Pacific',
    pattern: /\bAsia[- ]Pacific\b/gi,
    why: "the platform's own name for the `apac` locationHint expansion, written with or without a hyphen; naming it beside a result reads as where the object ran",
  },
  {
    term: 'Oceania',
    pattern: /\bOceania\b/gi,
    why: "the platform's own name for the `oc` locationHint expansion; naming it beside a result reads as where the object ran",
  },
  {
    term: 'Africa',
    pattern: /\bAfrica\b/gi,
    why: "the platform's own name for the `afr` locationHint expansion; naming it beside a result reads as where the object ran",
  },
  {
    term: 'Middle East',
    pattern: /\bMiddle East\b/gi,
    why: "the platform's own name for the `me` locationHint expansion; naming it beside a result reads as where the object ran",
  },
  {
    term: 'São Paulo',
    pattern: /\bSão Paulo\b/gi,
    why: 'the exact city HOST-07\'s own ledger row and criterion 2 use to state what a report must never claim to have measured in',
  },
  {
    term: 'London',
    pattern: /\bLondon\b/gi,
    why: 'a specific city already written into this project\'s own geographic-discovery design as a worked example, confirmed present by grep rather than assumed',
  },
  {
    term: 'Miami',
    pattern: /\bMiami\b/gi,
    why: 'a specific city already written into this project\'s own geographic-discovery design as a worked example, confirmed present by grep rather than assumed',
  },
]

/**
 * The phrasings that turn a bare region address into a claim about where it runs.
 *
 * This is what makes Tier 2 independent of Tier 1's list: a line naming
 * `bootstrap-eu` and one of these is a violation even when the place attributed to it is not
 * on {@link LOCATION_TERMS} — an invented place, or no place at all, still reads as a
 * location claim once it is paired with one of these verbs.
 */
const PLACEMENT_VERB_PHRASES: readonly string[] = [
  'runs in',
  'running in',
  'located',
  'location of',
  'hosted in',
  'lives in',
  'sited in',
  'based in',
  'datacenter',
  'data centre',
  'physically',
  'measured in',
  'measured from',
  'deployed in',
]

/**
 * One alternation over {@link PLACEMENT_VERB_PHRASES}, `/gi` so it carries a `lastIndex` and
 * must be read with `matchAll` — same rule as every pattern in {@link LOCATION_TERMS}.
 */
export const PLACEMENT_VERBS: RegExp = new RegExp(
  PLACEMENT_VERB_PHRASES.map((phrase) => `\\b${phrase}\\b`).join('|'),
  'gi',
)

/** One finding, of either kind — {@link Violation} from `banned-vocabulary.ts` plus `rule`. */
export interface LocationClaim {
  /** Repo-relative path, or whatever name the caller gave the text it scanned. */
  readonly file: string
  readonly line: number
  /** Zero-based offset of the match within the line. */
  readonly column: number
  /** Which of the two failures this is. */
  readonly rule: 'term' | 'attribution'
  /** The matched {@link LocationTerm.term}, or the region address, for an `'attribution'` row. */
  readonly term: string
  readonly match: string
  readonly text: string
}

/**
 * Every location claim in `content`, before any exemption is applied.
 *
 * One walk over the lines, producing both kinds of finding:
 *
 * - a `'term'` finding for every {@link LOCATION_TERMS} match, however many occur on a line;
 * - at most one `'attribution'` finding per line, for any line naming one of `addresses`
 *   **and** matching {@link PLACEMENT_VERBS} — regardless of whether the line also carries a
 *   listed term. The reported `column`/`match` are the earliest {@link PLACEMENT_VERBS} match
 *   on that line, which is the span an exemption keys on.
 *
 * Exported separately from any exemption layer, for `banned-vocabulary.ts`'s stated reason:
 * the matcher must be provable independently of where a file happens to live.
 */
export function rawLocationClaims(
  file: string,
  content: string,
  addresses: readonly string[],
): LocationClaim[] {
  const found: LocationClaim[] = []
  const lines = content.split('\n')
  for (const [index, text] of lines.entries()) {
    for (const { term, pattern } of LOCATION_TERMS) {
      for (const match of text.matchAll(pattern)) {
        if (match.index === undefined) continue
        found.push({
          file,
          line: index + 1,
          column: match.index,
          rule: 'term',
          term,
          match: match[0],
          text: text.trim(),
        })
      }
    }

    const address = addresses.find((candidate) => text.includes(candidate))
    if (address !== undefined) {
      for (const match of text.matchAll(PLACEMENT_VERBS)) {
        if (match.index === undefined) continue
        found.push({
          file,
          line: index + 1,
          column: match.index,
          rule: 'attribution',
          term: address,
          match: match[0],
          text: text.trim(),
        })
        break
      }
    }
  }
  return found
}
