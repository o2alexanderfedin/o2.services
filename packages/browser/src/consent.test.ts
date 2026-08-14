import { describe, expect, it } from 'vitest'
import { DISCLOSURE, DISCLOSURE_VERSION } from './disclosure.ts'
import {
  CONSENT_KEY,
  GrantedConsent,
  grantConsent,
  localConsentStore,
  memoryConsentStore,
  pageConsentStore,
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

  /**
   * **The rule above was honoured here and defeated one call up, and this pair is what
   * separates the two layers.**
   *
   * `grantConsent` returning a working consent is not enough on its own, because
   * `demo/main.ts`'s `requireConsent()` does not use that return value — it **re-reads the
   * store**. So a page whose storage silently forgets writes had a visitor press *Allow*,
   * the write go nowhere, and *Start* throw `no consent`. Each layer was correct alone,
   * which is exactly why nothing caught it.
   *
   * The store simulated here is the one that bites: every method is present and every call
   * succeeds, and nothing is kept. `localConsentStore`'s duck-type check passes it — that
   * check exists to refuse a global that is absent, throws, or lacks the methods, and this
   * is none of those. Only a round trip separates a store that persists from one that
   * merely accepts, which is why {@link pageConsentStore} does one.
   */
  it('a page whose storage accepts writes and forgets them can still read back its own consent', () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
    // Present, complete, and amnesiac. Not a mock of a failure — a mock of a SUCCESS that
    // keeps nothing, which is what Safari private browsing and a storage-blocked frame
    // actually present.
    const amnesiac: Storage = {
      getItem: () => null,
      setItem: () => undefined,
      removeItem: () => undefined,
      clear: () => undefined,
      key: () => null,
      length: 0,
    }
    Object.defineProperty(globalThis, 'localStorage', { value: amnesiac, configurable: true })
    try {
      // **The defect, stated as a measurement rather than as history.** This is what the
      // demo did, and the grant is unreadable a line later — which is the refusal a
      // visitor met.
      const naive = localConsentStore()
      grantConsent(naive)
      expect(readConsent(naive).ok, 'the unguarded store must NOT be able to read its own grant').toBe(
        false,
      )

      // And the fix, over the identical hostile global.
      const guarded = pageConsentStore()
      grantConsent(guarded)
      const found = readConsent(guarded)
      expect(found.ok, 'a visitor who granted must be able to start').toBe(true)
      if (!found.ok) return
      expect(found.consent.disclosureVersion).toBe(DISCLOSURE_VERSION)
    } finally {
      // Restored whatever was there, including nothing — the browser project runs three
      // engines and a leaked global would follow this file into every later spec.
      if (original === undefined) Reflect.deleteProperty(globalThis, 'localStorage')
      else Object.defineProperty(globalThis, 'localStorage', original)
    }
  })

  it('uses the real store, and disturbs no stored consent, when storage works', () => {
    // The other half: the fallback must not fire on a healthy page, or every visitor
    // silently stops being remembered — a regression that looks like nothing at all.
    const store = pageConsentStore()
    const granted = grantConsent(store)
    expect(granted).toBeInstanceOf(GrantedConsent)
    expect(readConsent(store).ok).toBe(true)

    // The probe cleans up after itself. Asserted because it writes to the visitor's real
    // storage, and a probe key left behind is litter this page put on someone's device.
    expect(store.read(`${CONSENT_KEY}:probe`)).toBeNull()
    store.clear(CONSENT_KEY)
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

  it('says nothing a blocklist reviewer greps for', () => {
    // The words themselves are not written here. `vocabulary.node.test.ts` owns
    // that rule across the whole repository and is mutation-proved against every
    // banned term — and an earlier version of this test failed it, by spelling
    // them out in an array. What is worth checking *here* is the property that
    // rule protects: this is the text a visitor and a reviewer actually read, so
    // it must be plain about compute and silent about reward.
    const prose = [
      DISCLOSURE.headline,
      DISCLOSURE.reporting.answer,
      ...DISCLOSURE.lines.flatMap((line) => [line.question, line.answer]),
    ]
      .join(' ')
      .toLowerCase()
    expect(prose).toContain('processor')
    expect(prose).toContain('stop')
    expect(prose).not.toContain('reward')
    expect(prose).not.toContain('paid')
    expect(prose).not.toContain('currency')
  })

  /**
   * **The guard that was missing, and whose absence let a false disclosure stand for
   * twelve days.**
   *
   * `BROW-01` is an **ordering** property — consent before compute — and it stayed
   * legitimately green the whole time. Nothing anywhere asked whether the disclosed terms
   * were still *true*. So when persistent identity landed on 2026-08-01, the sentence
   * *"no identifiers beyond a peer key generated in this tab"* became false in both of its
   * halves and no test noticed: the key is minted once per **origin** and reloaded by every
   * later tab, and `browser-node.ts` says in its own words that the peer id *"survives a
   * reload"*.
   *
   * **What this case couples, and why it is coupled this way.** The durable fact lives in
   * `browser-node.ts`: it opens an identity store, loads a stored seed, and mints only when
   * there is none. That is read here **from the source text of the module that does it**,
   * not restated — so the day somebody removes persistence, the antecedent goes false and
   * this case stops demanding the disclosure. It cannot rot into a rule that outlives its
   * reason.
   *
   * The consequent is deliberately weak on wording and strong on substance: the text must
   * say the key is *stored* and that it is *reused*, because those are the two facts a
   * visitor needs and the two the old text denied. It does not pin phrasing — the copy is
   * allowed to improve.
   *
   * **This does not check that the disclosure is true in general**, and no test can. It
   * checks the one property whose violation has already happened once.
   */
  it('discloses the stored identity for as long as the node factory persists one', async () => {
    // Read from source rather than by starting a node: this is a browser-project spec and
    // `BrowserNode.start` opens IndexedDB, dials, and needs a relay. The subject is what the
    // factory *does*, and its source is the honest record of that.
    const factory = await import('./browser-node.ts?raw').then((m) => m.default)

    // The antecedent: does the node factory persist an identity across sessions?
    const persistsIdentity =
      factory.includes('loadSeed()') && factory.includes('saveSeed(') && factory.includes('IdbIdentityStore')

    // Stated as a check rather than assumed, so a reader learns which branch ran. If this
    // is ever false the case below is vacuous, and a vacuous case that looks like a passing
    // one is exactly what this file exists to prevent elsewhere.
    expect(
      persistsIdentity,
      'browser-node.ts no longer looks like it persists an identity — if that is deliberate, ' +
        'this case and the disclosure line it guards should both be revisited, not deleted',
    ).toBe(true)

    const prose = DISCLOSURE.lines
      .flatMap((line) => [line.question, line.answer])
      .join(' ')
      .toLowerCase()

    // It is kept somewhere.
    expect(prose, 'the disclosure must say the key is stored').toMatch(/stored|storage|kept/)
    // And it comes back — the half the old text actively denied by saying "in this tab".
    expect(prose, 'the disclosure must say the key is reused across visits').toMatch(
      /again|reused|returns?|next time|come back/,
    )
    // And the claim that made version 1 false must not reappear verbatim.
    expect(prose).not.toContain('generated in this tab')
  })
})