import { describe, expect, it } from 'vitest'
import { describeExclusion } from './exclusion.ts'
import type { ObservedFailure } from './exclusion.ts'

/**
 * BENCH-07 criterion 3 — a published exclusion reports rather than asserts.
 *
 * Every case derives from one clean fixture by changing exactly one thing, which is
 * `integrity.test.ts`'s idiom in this package and is used here for the same reason: a
 * reading that fired on somebody else's change shows up as a difference nobody expected.
 *
 * **The most important case in this file asserts an absence**, and that is not a style
 * choice. The defect being removed was a function that always claimed a cause — one stored
 * paragraph naming a libp2p inbound cap, attached to whatever error came back. A positive
 * assertion cannot see that regression: a string containing the message and the
 * configuration still contains them with a paragraph appended. Only a negative assertion —
 * the output matches no cause language — can watch a claim appear.
 *
 * No `.node.` suffix: the function is pure and this package's tests run under the node and
 * the browser projects alike.
 */

/** One failure, as a rung that could not be measured would report itself. */
const OBSERVED: ObservedFailure = {
  errorName: 'AggregateError',
  message: 'connect ECONNRESET 127.0.0.1:54321',
  config: [
    ['driver', 'process-per-node'],
    ['dial', 'workers-to-submitter'],
    ['inboundConnectionThreshold', '15'],
    ['maxIncomingPendingConnections', '15'],
    ['nodes', '16'],
    ['stagger', 'none'],
    ['discover', 'off'],
  ],
}

/**
 * The configuration pairs a rendered reason carries, in render order.
 *
 * Parsed back out of the string deliberately, rather than asserted as one blob: the
 * property the factorial rests on is that two attempts' reasons differ **in the pair those
 * attempts differed in**, and a blob comparison cannot say which pair moved.
 */
function pairsOf(text: string): string[] {
  const start = text.indexOf('observed under: ')
  if (start === -1) return []
  const rest = text.slice(start + 'observed under: '.length)
  const end = rest.indexOf(' — Interpretation: ')
  return (end === -1 ? rest : rest.slice(0, end)).split('; ')
}

describe('describeExclusion reports the failure that happened', () => {
  it('renders two different failures as two different reasons, each carrying its own message', () => {
    const first = describeExclusion(OBSERVED)
    const second = describeExclusion({ ...OBSERVED, message: 'the module record names other bytes' })

    // The whole of the defect, in one assertion: the stored paragraph was byte-identical
    // for every failure mode there is.
    expect(first).not.toBe(second)
    expect(first).toContain('connect ECONNRESET 127.0.0.1:54321')
    expect(second).toContain('the module record names other bytes')
    // And neither leaks the other's message, which is what makes the two readings
    // independent rather than merely unequal.
    expect(first).not.toContain('the module record names other bytes')
    expect(second).not.toContain('connect ECONNRESET')
  })

  it('names the error class, so two failures with one message are still two readings', () => {
    const named = describeExclusion(OBSERVED)
    expect(named).toContain('AggregateError')
    expect(named).not.toBe(describeExclusion({ ...OBSERVED, errorName: 'RangeError' }))
  })

  it('carries every configuration pair it was given, in the order it was given them', () => {
    const text = describeExclusion(OBSERVED)
    expect(pairsOf(text)).toEqual([
      'driver=process-per-node',
      'dial=workers-to-submitter',
      'inboundConnectionThreshold=15',
      'maxIncomingPendingConnections=15',
      'nodes=16',
      'stagger=none',
      'discover=off',
    ])
  })

  it('differs from another attempt in exactly the pair the two attempts differ in', () => {
    // The reading the factorial is legible by. Two attempts, one lever moved.
    const derived = describeExclusion(OBSERVED)
    const pinned = describeExclusion({
      ...OBSERVED,
      config: OBSERVED.config.map((pair) =>
        pair[0] === 'inboundConnectionThreshold' ? (['inboundConnectionThreshold', '5'] as const) : pair,
      ),
    })

    const before = pairsOf(derived)
    const after = pairsOf(pinned)
    expect(before.length).toBe(after.length)
    const moved = before.filter((pair, index) => pair !== after[index])
    expect(moved).toEqual(['inboundConnectionThreshold=15'])
    expect(after.filter((pair, index) => pair !== before[index])).toEqual([
      'inboundConnectionThreshold=5',
    ])
  })
})

describe('describeExclusion claims no cause it was not given', () => {
  it('states no cause at all when it was passed no interpretation', () => {
    const text = describeExclusion(OBSERVED)

    // Asserted negatively, and this is the case the module exists for. The function it
    // replaces appended a paragraph reading "libp2p caps inbound connections at … per host,
    // and every node here shares one host, so beyond ~5 concurrent dials … the noise
    // handshake is killed" to every error it caught. A positive assertion on the message and
    // the configuration passes with that paragraph still attached; only this one can see it
    // appear.
    expect(text).not.toMatch(/because|caused by|due to/i)
    // Nor the softer forms of the same claim, which are how a cause comes back after a
    // negative assertion is added.
    expect(text).not.toMatch(/likely|probably|presumably|suggests/i)
    expect(text).not.toContain('Interpretation:')

    // Anti-vacuity: an empty string would satisfy every assertion above.
    expect(text.length).toBeGreaterThan(0)
    expect(text).toContain('connect ECONNRESET 127.0.0.1:54321')
  })

  it('marks an interpretation as one, exactly once, with the observation still ahead of it', () => {
    const text = describeExclusion({
      ...OBSERVED,
      interpretation: 'the receiving node was pinned at 5 and 16 peers dialled it at once',
    })

    expect(text.split('Interpretation: ').length - 1).toBe(1)
    // Order is the claim: a reader must reach what was seen before reaching what somebody
    // made of it. Dropping the prefix is the failure mode hardest to catch by eye, which is
    // why the index comparison is here rather than a bare `toContain`.
    expect(text.indexOf('connect ECONNRESET')).toBeLessThan(text.indexOf('Interpretation: '))
    expect(text.indexOf('observed under: ')).toBeLessThan(text.indexOf('Interpretation: '))
    expect(text).toContain('the receiving node was pinned at 5 and 16 peers dialled it at once')
  })
})

describe('describeExclusion renders an absence rather than a hole', () => {
  it('names the class and the configuration when the error carried no message', () => {
    const text = describeExclusion({ ...OBSERVED, message: '' })

    expect(text).toContain('AggregateError')
    // Not an empty code span, which renders as nothing and reads as a rendering fault.
    expect(text).not.toContain('``')
    expect(text).toContain('carried no message')
    expect(pairsOf(text)).toContain('nodes=16')
  })

  it('names an error that stated no class at all, rather than rendering an empty span', () => {
    // `typeof cause` for a thrown non-`Error` is never empty, so this is the defensive arm
    // rather than an observed one — and it is asserted because an unasserted branch that
    // renders a hole is exactly what the two cases above exist to refuse.
    expect(describeExclusion({ ...OBSERVED, errorName: '' })).toContain('no stated class')
    expect(describeExclusion({ ...OBSERVED, errorName: '', message: '' })).toContain(
      'named neither a class nor a message',
    )
  })

  it('states that no configuration was recorded rather than rendering a gap', () => {
    const text = describeExclusion({ ...OBSERVED, config: [] })
    expect(text).toContain('no configuration was recorded')
    expect(text).toContain('connect ECONNRESET 127.0.0.1:54321')
  })
})

describe('describeExclusion survives the table cell it is rendered into', () => {
  it('collapses newlines and escapes pipes, in the message and in the configuration alike', () => {
    const text = describeExclusion({
      ...OBSERVED,
      message: 'dial failed\n    at Libp2p.dial (node_modules/libp2p/dist/index.js:1)\n  | and again',
      config: [['argv', 'a|b'], ['note', 'one\ntwo']],
    })

    // A raw newline ends the table row; every remaining line is then read as prose.
    expect(text).not.toContain('\n')
    // Every surviving pipe is escaped. Removing the escaped ones must leave none behind.
    expect(text.replace(/\\\|/g, '')).not.toContain('|')
    // And it still says what happened, rather than being sanitised into silence.
    expect(text).toContain('dial failed')
    expect(pairsOf(text)).toEqual(['argv=a\\|b', 'note=one two'])
  })

  it('closes the code span a backtick in the message would have opened', () => {
    const text = describeExclusion({ ...OBSERVED, message: 'no `dialable` address on 12D3Koo' })
    // Three backticks would be one span and one stray opener. The rendered cell holds an
    // even number of them, which is what makes the remainder of the row a table cell.
    expect((text.match(/`/g) ?? []).length % 2).toBe(0)
    expect(text).toContain("no 'dialable' address on 12D3Koo")
  })
})
