import { describe, expect, it } from 'vitest'
import { DISCLOSURE, DISCLOSURE_VERSION } from './disclosure.ts'
import {
  CONSENT_KEY,
  GrantedConsent,
  grantConsent,
  localConsentStore,
  memoryConsentStore,
  readConsent,
  revokeConsent,
} from './consent.ts'
import type { ConsentStore } from './consent.ts'

/** BROW-01 — a visitor gives explicit informed consent before any compute begins. */

describe('consent is a value that cannot be fabricated', () => {
  it('refuses to be constructed from outside the module that mints it', () => {
    // The whole design rests on this. If `new GrantedConsent(...)` worked, the
    // parameter would be decoration and "you cannot start without consent" would
    // be back to a rule somebody has to remember at every call site.
    expect(
      () =>
        new GrantedConsent(
          { disclosureVersion: DISCLOSURE_VERSION, grantedAt: 0, reportingAllowed: true },
          Symbol('forged'),
        ),
    ).toThrow(TypeError)
  })

  it('is produced by granting, and by finding an existing grant', () => {
    const store = memoryConsentStore()
    const granted = grantConsent(store, { now: () => 1_000 })
    expect(granted).toBeInstanceOf(GrantedConsent)
    expect(granted.grantedAt).toBe(1_000)

    const found = readConsent(store)
    expect(found.ok).toBe(true)
    if (!found.ok) return
    expect(found.consent).toBeInstanceOf(GrantedConsent)
    expect(found.consent.grantedAt).toBe(1_000)
  })
})

describe('the gate stays shut until it is opened', () => {
  it('reports never-asked on a fresh store, not a permissive default', () => {
    const found = readConsent(memoryConsentStore())
    expect(found.ok).toBe(false)
    if (found.ok) return
    expect(found.gap.kind).toBe('never-asked')
  })

  it('shuts again when consent is revoked', () => {
    const store = memoryConsentStore()
    grantConsent(store)
    revokeConsent(store)
    expect(readConsent(store).ok).toBe(false)
  })

  it('treats a corrupt record as absent rather than repairing it', () => {
    // Guessing what a damaged consent meant is the one repair nobody is entitled
    // to make.
    for (const junk of ['', 'null', '{}', '{"disclosureVersion":1}', 'not json at all']) {
      const store = memoryConsentStore()
      store.write(CONSENT_KEY, junk)
      const found = readConsent(store)
      expect(found.ok, `stored ${JSON.stringify(junk)} was accepted as consent`).toBe(false)
    }
  })

  it('shuts when the store itself refuses to be read', () => {
    // Private browsing throws on access rather than returning null. An
    // unavailable store is not a consent.
    const hostile: ConsentStore = {
      read: () => {
        throw new DOMException('denied', 'SecurityError')
      },
      write: () => undefined,
      clear: () => undefined,
    }
    const found = readConsent(hostile)
    expect(found.ok).toBe(false)
    if (found.ok) return
    expect(found.gap.kind).toBe('unreadable')
  })
})

describe('a consent answers a specific disclosure', () => {
  it('stops satisfying the gate when the terms change', () => {
    // The mechanism: a stored record carries the version it answered. This test
    // plants a record from an older disclosure rather than mutating the constant,
    // so it keeps testing the rule after the next real version bump.
    const store = memoryConsentStore()
    store.write(
      CONSENT_KEY,
      JSON.stringify({ disclosureVersion: '0-older', grantedAt: 1, reportingAllowed: false }),
    )

    const found = readConsent(store)
    expect(found.ok).toBe(false)
    if (found.ok) return
    expect(found.gap.kind).toBe('terms-changed')
    if (found.gap.kind !== 'terms-changed') return
    // Both versions travel with the gap, so the page can say what changed rather
    // than only that something did.
    expect(found.gap.answered).toBe('0-older')
    expect(found.gap.current).toBe(DISCLOSURE_VERSION)
  })

  it('records the current version when granted', () => {
    const store = memoryConsentStore()
    expect(grantConsent(store).disclosureVersion).toBe(DISCLOSURE_VERSION)
    expect(DISCLOSURE.version).toBe(DISCLOSURE_VERSION)
  })
})

describe('the optional report is optional', () => {
  it('is off unless the visitor turns it on — never pre-ticked', () => {
    // A pre-ticked box is the dark pattern this phase exists to avoid. The
    // default has to be observable, not merely intended.
    expect(grantConsent(memoryConsentStore()).reportingAllowed).toBe(false)
  })

  it('survives a round trip through storage when it is turned on', () => {
    const store = memoryConsentStore()
    grantConsent(store, { reportingAllowed: true })
    const found = readConsent(store)
    expect(found.ok).toBe(true)
    if (!found.ok) return
    expect(found.consent.reportingAllowed).toBe(true)
  })

  it('does not let consent to compute imply consent to report', () => {
    const store = memoryConsentStore()
    grantConsent(store, { reportingAllowed: false })
    const found = readConsent(store)
    expect(found.ok && found.consent.reportingAllowed).toBe(false)
  })
})

describe('a denied store does not deny the visitor', () => {
  it('still grants for this page load when writing fails', () => {
    // Refusing to run because a preference could not be *remembered* would punish
    // the most privacy-conservative visitors for being privacy-conservative.
    const writeOnly: ConsentStore = {
      read: () => null,
      write: () => {
        throw new DOMException('quota', 'QuotaExceededError')
      },
      clear: () => undefined,
    }
    const granted = grantConsent(writeOnly)
    expect(granted).toBeInstanceOf(GrantedConsent)
    expect(granted.disclosureVersion).toBe(DISCLOSURE_VERSION)
  })
})

describe('the default store is resolved lazily', () => {
  it('constructs without touching a browser global', () => {
    // Module-scope environment detection is what breaks the `default` export
    // condition for a host application. Building the store must be safe in Node.
    const store = localConsentStore()
    expect(typeof store.read).toBe('function')
    // Reading is also safe: absent `localStorage` reads as "no consent".
    expect(() => store.read(CONSENT_KEY)).not.toThrow()
  })
})

describe('the disclosure says what a visitor needs to decide', () => {
  it('answers what runs, what it costs, what leaves, and how to stop', () => {
    const questions = DISCLOSURE.lines.map((line) => line.question.toLowerCase()).join(' | ')
    expect(questions).toContain('what would run')
    expect(questions).toContain('processor')
    expect(questions).toContain('leaves my device')
    expect(questions).toContain('how do i stop it')
  })

  it('offers a way to decline that is a control, not an absence', () => {
    // A gate whose only control is "accept" is not a gate.
    expect(DISCLOSURE.decline.length).toBeGreaterThan(0)
    expect(DISCLOSURE.affirm.toLowerCase()).not.toBe('ok')
    expect(DISCLOSURE.affirm.toLowerCase()).not.toBe('got it')
  })

  it('uses none of the vocabulary that earns a blocklist entry', () => {
    // Enforced repository-wide elsewhere; asserted here too because this is the
    // text a visitor and a blocklist reviewer actually read.
    const prose = [
      DISCLOSURE.headline,
      DISCLOSURE.affirm,
      DISCLOSURE.decline,
      DISCLOSURE.reporting.question,
      DISCLOSURE.reporting.answer,
      ...DISCLOSURE.lines.flatMap((line) => [line.question, line.answer]),
    ]
      .join(' ')
      .toLowerCase()
    for (const banned of ['mining', 'miner', 'hashrate', 'credits', 'tokens']) {
      expect(prose, `disclosure contains "${banned}"`).not.toContain(banned)
    }
  })
})
