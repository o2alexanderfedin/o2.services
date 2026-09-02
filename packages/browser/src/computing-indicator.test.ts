import { describe, expect, it } from 'vitest'
import { COMPUTING_TITLE_PREFIX, ComputingIndicator, isComputingTitle } from './computing-indicator.ts'
import type { TitlePort } from './computing-indicator.ts'

/**
 * BROW-07's mechanism, with no DOM and no page — and then again with both.
 *
 * This file runs in the `node` project **and** the `browser` project, because
 * `vitest.config.ts` includes bare `*.test.ts` in each. That is deliberate rather than
 * incidental: the module's whole claim is that it is portable, and a spec that only ran where
 * `document` exists would not be able to tell a port from a global.
 *
 * What it does not cover, and what does: this file drives a fake title port, so it says
 * nothing about a real tab strip. `packages/node/src/computing-indicator.e2e.test.ts` reads
 * `page.title()` from **outside** three real browsers with a second page in front, which is
 * the reading criterion 2 asks for. The two halves are separate on purpose — the arithmetic
 * of "one glyph, never two" is exhaustible here in milliseconds and is not worth a browser.
 */

/** A title port over a plain string, plus a log of what was actually written. */
function fakeTitle(initial: string): { readonly port: TitlePort; readonly writes: string[] } {
  const writes: string[] = []
  let value = initial
  return {
    writes,
    port: {
      get: () => value,
      set: (next: string) => {
        value = next
        writes.push(next)
      },
    },
  }
}

const BASE = 'o2.services — node'

describe('ComputingIndicator — the tab strip says whether this machine is working', () => {
  it('leaves the title alone while nothing is in flight', () => {
    const title = fakeTitle(BASE)
    const indicator = new ComputingIndicator(title.port)

    indicator.report(0)

    expect(title.port.get()).toBe(BASE)
    // Not merely "the value is right": nothing was written at all. A poll that rewrote the
    // identical string every tick would pass a value assertion and would be making a
    // backgrounded tab do work for no reason.
    expect(title.writes).toEqual([])
  })

  it('decorates the title the moment one task is in flight', () => {
    const title = fakeTitle(BASE)
    const indicator = new ComputingIndicator(title.port)

    indicator.report(1)

    expect(title.port.get()).toBe(`${COMPUTING_TITLE_PREFIX}${BASE}`)
    expect(isComputingTitle(title.port.get())).toBe(true)
    // The base survives inside it. A decoration that replaced the title would leave a visitor
    // unable to tell which of their tabs is the one computing.
    expect(title.port.get()).toContain(BASE)
  })

  it('carries exactly one glyph however many tasks are running, and however often it is told', () => {
    const title = fakeTitle(BASE)
    const indicator = new ComputingIndicator(title.port)

    indicator.report(1)
    indicator.report(2)
    indicator.report(7)
    indicator.report(2)

    expect(title.port.get()).toBe(`${COMPUTING_TITLE_PREFIX}${BASE}`)
    // The arithmetic that catches the append-per-report defect this class of code always has.
    const glyphs = title.port.get().split(COMPUTING_TITLE_PREFIX).length - 1
    expect(glyphs).toBe(1)
    // And only the first report wrote anything — three of the four were no-ops.
    expect(title.writes).toEqual([`${COMPUTING_TITLE_PREFIX}${BASE}`])
  })

  it('restores the base exactly when the last task finishes', () => {
    const title = fakeTitle(BASE)
    const indicator = new ComputingIndicator(title.port)

    indicator.report(3)
    indicator.report(0)

    // `toBe`, not `toContain`: "restored exactly" is the claim, and a title left with a
    // stray separator or a trimmed space would pass a looser assertion.
    expect(title.port.get()).toBe(BASE)
    expect(title.writes).toEqual([`${COMPUTING_TITLE_PREFIX}${BASE}`, BASE])
  })

  it('does not double-decorate a title that already carries the glyph', () => {
    // The state a restored session, a second indicator, or a bug could leave behind. The base
    // is defined as *whatever is left after the prefix*, so there is no arrangement in which
    // two prefixes can accumulate.
    const title = fakeTitle(`${COMPUTING_TITLE_PREFIX}${BASE}`)
    const indicator = new ComputingIndicator(title.port)

    expect(indicator.base).toBe(BASE)

    indicator.report(1)
    expect(title.port.get()).toBe(`${COMPUTING_TITLE_PREFIX}${BASE}`)

    indicator.report(0)
    expect(title.port.get()).toBe(BASE)
  })

  it('follows a title the page changed under it, and restores the new one', () => {
    const title = fakeTitle(BASE)
    const indicator = new ComputingIndicator(title.port)

    indicator.report(1)
    expect(title.port.get()).toBe(`${COMPUTING_TITLE_PREFIX}${BASE}`)

    // The page renames itself while idle — the ordinary case, not a pathological one.
    indicator.report(0)
    title.port.set('o2.services — colouring 1..204')
    indicator.report(1)

    expect(title.port.get()).toBe(`${COMPUTING_TITLE_PREFIX}o2.services — colouring 1..204`)

    indicator.report(0)
    // The title the page chose, not the one this module first saw. A base captured once at
    // construction would put `o2.services — node` back here and lose the page's own change.
    expect(title.port.get()).toBe('o2.services — colouring 1..204')
  })

  it('treats a nonsensical count as no work rather than throwing out of a repaint', () => {
    const title = fakeTitle(BASE)
    const indicator = new ComputingIndicator(title.port)

    indicator.report(1)
    indicator.report(-4)

    expect(title.port.get()).toBe(BASE)
  })
})
