import { describe, expect, it } from 'vitest'
import { CONSENT_VERSION_NOTE, DISCLOSED_DATA_COST_BYTES, DISCLOSURE, DISCLOSURE_VERSION } from '@o2/browser'
import type { DisclosureLine } from '@o2/browser'

/**
 * BROW-09 — the disclosure states **four** things, and each one is asserted on its own.
 *
 * ## What was missing, and why nothing caught it
 *
 * `disclosure.ts` has had six carefully written lines since 2026-08-14 and **no test at all
 * asserted their completeness**. Every guard around them checked something else: `consent.ts`
 * checks that a stored consent names the current version, `built-bundle.e2e.test.ts` checks
 * that the gate is on screen before anything runs, `peer-ledger.e2e.test.ts` checks that the
 * opt-out is honoured over the wire. All true, all silent about whether the visitor was told
 * the four things criterion 4 names — and one of them, *what telemetry is sent*, was simply
 * absent. A disclosure is not a document that can be checked by reading it once; it is a
 * document that changes, and the thing worth guarding is the property that survives an edit.
 *
 * ## Located by substance, never by index
 *
 * Every case below finds its element by a property of the **answer**, not by position in
 * `DISCLOSURE.lines`. An index-based assertion follows a reordering silently and proves
 * nothing afterwards; worse, it stays green when a line is replaced wholesale by a different
 * line that happens to land in the same slot. Each case also asserts the element is found
 * **exactly once**, so a second line drifting into the same subject is a finding rather than a
 * redundancy nobody notices.
 *
 * ## Where the facts in element 4 come from
 *
 * The telemetry answer is a statement about two code paths and was written off them rather
 * than composed:
 *
 * - the **request** path — `demo/main.ts`'s `startReport` passes `outcome: allowed ? outcome :
 *   null` to `publishStartOutcome`, so a visitor who left the box unticked contributes no row
 *   when peers are asked; and
 * - the **serve** path — `demo/main.ts` passes `startReporting: granted.reportingAllowed ?
 *   'reports-its-own-start' : 'withholds-its-own-start'`, and `browser-node.ts`'s
 *   `ownStartLedger` returns an empty ledger for the second, so the node does not hold the row
 *   for a peer to ask for.
 *
 * Both halves are needed and the second was once missing, which is the defect
 * `BrowserNodeOptions.startReporting`'s docblock records at length: *"the page withheld the
 * line and the node served it"*. The sentence in the disclosure says both, because saying only
 * the first would be the same defect written down.
 *
 * ## What this file does NOT assert
 *
 * The **legal basis** of the telemetry. `.planning/REQUIREMENTS.md` § Open questions item 3
 * records that the sources consulted disagreed with one another and that it is *"settled by
 * legal review, not engineering judgement"*. A case asserting either basis would be an agent
 * recording a compliance ruling, so there is none, and BROW-09 stands as **Partial** until the
 * owner rules. The ordering half — that all four are on screen before the opt-in control can
 * be clicked — is `disclosure-before-optin.e2e.test.ts`, because it is a claim about a page
 * and this file has none.
 */

/**
 * The guarantee that must lead element 3, written out here rather than imported.
 *
 * The independent side of the comparison. If somebody softens the sentence, this file goes red
 * and names the phrase it expected — which is the whole point of a literal in a guard.
 */
const SOVEREIGNTY_GUARANTEE = 'never leaves this device'

/**
 * Words that turn a statement into a concession.
 *
 * Element 3's requirement — *"with the sovereignty guarantee stated as a selling point rather
 * than a caveat"* — is a matter of taste unless it is made mechanical, so it is made
 * mechanical: the guarantee must appear in the answer's **first sentence**, and no word from
 * this list may appear **before** it. A guarantee that arrives after a "but" has been demoted
 * to a concession however warmly it is worded.
 */
const QUALIFIERS: readonly string[] = ['but ', 'however', 'except', 'unless', 'although', 'apart from']

/** The one line whose answer satisfies `holds`, or a failure naming how many did. */
function theLineWhere(holds: (line: DisclosureLine) => boolean, subject: string): DisclosureLine {
  const found = DISCLOSURE.lines.filter((line) => holds(line))
  expect(
    found.length,
    `BROW-09: ${String(found.length)} of the disclosure's ${String(DISCLOSURE.lines.length)} lines ` +
      `state ${subject}. Exactly one must: zero means a visitor is not told, and two means the ` +
      'page can tell them two different things.',
  ).toBe(1)
  return found[0] as DisclosureLine
}

describe('BROW-09 — the four things a visitor is told before they decide', () => {
  it('element 1: what code runs, named as code and not as an activity', () => {
    const line = theLineWhere(
      (l) => l.answer.includes('WebAssembly'),
      'what code would run',
    )

    // Not merely that the word appears: the answer has to say what the code *does* and where
    // its source is, because "a WebAssembly module runs" tells a visitor nothing they could
    // act on.
    expect(line.question.toLowerCase()).toContain('run')
    expect(line.answer).toContain('Pythagorean')
    expect(
      line.answer,
      'BROW-09 element 1: the answer names a module but does not say a visitor can read it, ' +
        'so "what code runs" is answered with a category rather than with an artifact',
    ).toContain('source')
  })

  it('element 2: whose task it is, and where the visitor can see whose', () => {
    const line = theLineWhere(
      (l) => l.answer.includes('shared job'),
      'whose work would run',
    )

    expect(line.question.toLowerCase()).toContain('whose')
    // The requester is *named on screen*, which is what makes the answer checkable by the
    // visitor rather than a claim they have to accept.
    expect(
      line.answer,
      'BROW-09 element 2: the answer says the work belongs to somebody but does not say where ' +
        'a visitor can see who, which leaves "whose task is it" unanswered in practice',
    ).toContain('bar')
  })

  it('element 3: what leaves the device, with the guarantee leading rather than conceded', () => {
    const line = theLineWhere(
      (l) => l.answer.includes(SOVEREIGNTY_GUARANTEE),
      'what leaves the device',
    )

    const at = line.answer.indexOf(SOVEREIGNTY_GUARANTEE)
    const firstSentenceEnds = line.answer.indexOf('.')
    expect(
      at,
      `BROW-09 element 3: the guarantee "${SOVEREIGNTY_GUARANTEE}" is at character ` +
        `${String(at)} and the first sentence ends at ${String(firstSentenceEnds)}. Criterion 4 ` +
        'asks for the sovereignty guarantee as a selling point rather than a caveat, and a ' +
        'guarantee a visitor reaches in the third sentence is a reassurance offered after the ' +
        'worry rather than the reason to say yes.',
    ).toBeLessThan(firstSentenceEnds)

    for (const qualifier of QUALIFIERS) {
      const qualifierAt = line.answer.toLowerCase().indexOf(qualifier)
      if (qualifierAt === -1) continue
      expect(
        qualifierAt,
        `BROW-09 element 3: "${qualifier.trim()}" appears at character ${String(qualifierAt)}, ` +
          `before the guarantee at ${String(at)}. A guarantee that arrives after a concession ` +
          'has been demoted to one.',
      ).toBeGreaterThan(at)
    }

    // The exclusions are still there. Leading with the guarantee is a change of standing, not
    // a licence to drop the specifics a blocklist reviewer actually reads.
    expect(line.answer).toContain('No files')
    expect(line.answer).toContain('browsing history')
  })

  it('element 4: what is sent about the visit, including when the optional report is off', () => {
    const line = theLineWhere(
      (l) => l.answer.includes('analytics'),
      'what is reported about the visit',
    )

    // The half that was missing: what happens with the box UNTICKED. `DISCLOSURE.reporting`
    // below describes the opt-in report and says nothing about the default state.
    expect(
      line.answer,
      'BROW-09 element 4: the answer does not say what is sent when the optional report is ' +
        'left off, which is the state every visitor is in when they read it',
    ).toContain('Nothing, unless you turn on')
    expect(line.answer).toContain('no cookie')
    // Both code paths, because the defect `BrowserNodeOptions.startReporting` records is
    // exactly a page that withheld the line while the node served it.
    expect(
      line.answer,
      'BROW-09 element 4: the answer covers only what this page sends and not what this ' +
        "visitor's node holds for a peer to ask for — the two diverged once already",
    ).toContain('does not hold it for a peer to ask for')
  })

  it('BROW-10: a byte figure sits BESIDE the processor cost, and nothing else states one', () => {
    // Criterion 5's word is *beside*, so position is part of the requirement rather than a
    // layout preference: a visitor weighing "one background thread" wants the other cost in
    // the same breath, not four questions later.
    const cost = theLineWhere(
      (l) => l.answer.includes('kilobytes leave this device'),
      'what one run costs a data allowance',
    )
    const cpu = theLineWhere(
      (l) => l.answer.includes('One background thread'),
      'how much processor a run uses',
    )
    const costAt = DISCLOSURE.lines.indexOf(cost)
    const cpuAt = DISCLOSURE.lines.indexOf(cpu)
    expect(
      costAt,
      `BROW-10: the data cost is line ${String(costAt + 1)} and the processor cost is line ` +
        `${String(cpuAt + 1)}. Criterion 5 asks for the data cost BESIDE the CPU disclosure.`,
    ).toBe(cpuAt + 1)

    // The number the sentence shows is the disclosed literal and not a second one. A figure
    // written twice is a figure that can disagree with itself.
    expect(cost.answer).toContain(`${String(Math.round(DISCLOSED_DATA_COST_BYTES / 1000))} kilobytes`)
    // And it says what it is: measured, outbound only, with the inbound leg named as absent.
    expect(cost.answer).toContain('measured figure rather than an estimate')
    expect(
      cost.answer,
      'BROW-10: the sentence gives a number without saying which direction it counts, so a ' +
        'visitor on mobile data reads an outbound figure as a total',
    ).toContain('what other participants send back to you is not in it')
  })

  it('states no legal basis for the telemetry, because that is not an engineering judgement', () => {
    // Guarding an ABSENCE, deliberately. Open question 3 is contested across sources and is
    // settled by legal review; an agent adding either sentence would be recording a compliance
    // ruling as a code change, and this case is what makes that visible rather than quiet.
    const everyString = [
      DISCLOSURE.headline,
      ...DISCLOSURE.lines.flatMap((line) => [line.question, line.answer]),
      DISCLOSURE.reporting.question,
      DISCLOSURE.reporting.answer,
    ].join(' | ')

    for (const phrase of ['legitimate interest', 'legal basis', 'GDPR']) {
      expect(
        everyString.toLowerCase(),
        `BROW-09: the disclosure now states "${phrase}". Which basis the telemetry rests on is ` +
          '.planning/REQUIREMENTS.md § Open questions item 3 — contested across sources and ' +
          'settled by legal review, not by whoever edited this file. Take the ruling first.',
      ).not.toContain(phrase)
    }
  })

  it('the floor: the disclosure is a real document and its version is the one consent records', () => {
    // Without this, every case above could be satisfied by an empty list — nothing to find is
    // not the same as nothing wrong, and `theLineWhere` would simply report zero.
    expect(DISCLOSURE.lines.length).toBeGreaterThan(0)
    expect(DISCLOSURE.version).toBe(DISCLOSURE_VERSION)
    expect(DISCLOSURE.headline.length).toBeGreaterThan(0)
    expect(DISCLOSURE.affirm.length).toBeGreaterThan(0)
    expect(DISCLOSURE.decline.length).toBeGreaterThan(0)
    // Every answer is written, not stubbed. A line whose answer is blank would satisfy a
    // "the question is present" check and disclose nothing.
    for (const line of DISCLOSURE.lines) {
      expect(line.question.trim().length, `a line has no question`).toBeGreaterThan(0)
      expect(line.answer.trim().length, `"${line.question}" has no answer`).toBeGreaterThan(0)
    }
    // The note is what tells a returning visitor why they are being asked again, so a bump
    // with a stale note is a version that re-asks and does not say why.
    expect(CONSENT_VERSION_NOTE.trim().length).toBeGreaterThan(0)
  })
})
