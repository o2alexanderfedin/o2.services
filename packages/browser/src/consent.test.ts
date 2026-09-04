import { describe, expect, it } from 'vitest'
import { DISCLOSURE, DISCLOSURE_VERSION } from './disclosure.ts'
import {
  CONSENT_KEY,
  GrantedConsent,
  describeAnchors,
  grantConsent,
  localConsentStore,
  memoryConsentStore,
  pageConsentStore,
  readConsent,
  revokeConsent,
} from './consent.ts'

/**
 * The anchor set every case below consents under unless it is the case about changing it.
 *
 * Named once rather than written at each call, so a case that is *not* about anchors
 * cannot accidentally become one — and so the anchor-change cases have something
 * unambiguous to differ from.
 */
const ANCHORS: string = describeAnchors('runs-unsigned-artifacts')
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
    const granted = grantConsent(store, { anchoredTo: ANCHORS, now: () => 1_000 })
    expect(granted).toBeInstanceOf(GrantedConsent)
    expect(granted.grantedAt).toBe(1_000)

    const found = readConsent(store, ANCHORS)
    expect(found.ok).toBe(true)
    if (!found.ok) return
    expect(found.consent).toBeInstanceOf(GrantedConsent)
    expect(found.consent.grantedAt).toBe(1_000)
  })
})

describe('the gate stays shut until it is opened', () => {
  it('reports never-asked on a fresh store, not a permissive default', () => {
    const found = readConsent(memoryConsentStore(), ANCHORS)
    expect(found.ok).toBe(false)
    if (found.ok) return
    expect(found.gap.kind).toBe('never-asked')
  })

  it('shuts again when consent is revoked', () => {
    const store = memoryConsentStore()
    grantConsent(store, { anchoredTo: ANCHORS })
    revokeConsent(store)
    expect(readConsent(store, ANCHORS).ok).toBe(false)
  })

  it('treats a corrupt record as absent rather than repairing it', () => {
    // Guessing what a damaged consent meant is the one repair nobody is entitled
    // to make.
    for (const junk of ['', 'null', '{}', '{"disclosureVersion":1}', 'not json at all']) {
      const store = memoryConsentStore()
      store.write(CONSENT_KEY, junk)
      const found = readConsent(store, ANCHORS)
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
    const found = readConsent(hostile, ANCHORS)
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

    const found = readConsent(store, ANCHORS)
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
    expect(grantConsent(store, { anchoredTo: ANCHORS }).disclosureVersion).toBe(DISCLOSURE_VERSION)
    expect(DISCLOSURE.version).toBe(DISCLOSURE_VERSION)
  })
})

describe('the optional report is optional', () => {
  it('is off unless the visitor turns it on — never pre-ticked', () => {
    // A pre-ticked box is the dark pattern this phase exists to avoid. The
    // default has to be observable, not merely intended.
    expect(grantConsent(memoryConsentStore(), { anchoredTo: ANCHORS }).reportingAllowed).toBe(false)
  })

  it('survives a round trip through storage when it is turned on', () => {
    const store = memoryConsentStore()
    grantConsent(store, { anchoredTo: ANCHORS, reportingAllowed: true })
    const found = readConsent(store, ANCHORS)
    expect(found.ok).toBe(true)
    if (!found.ok) return
    expect(found.consent.reportingAllowed).toBe(true)
  })

  it('does not let consent to compute imply consent to report', () => {
    const store = memoryConsentStore()
    grantConsent(store, { anchoredTo: ANCHORS, reportingAllowed: false })
    const found = readConsent(store, ANCHORS)
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
    const granted = grantConsent(writeOnly, { anchoredTo: ANCHORS })
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
      grantConsent(naive, { anchoredTo: ANCHORS })
      expect(readConsent(naive, ANCHORS).ok, 'the unguarded store must NOT be able to read its own grant').toBe(
        false,
      )

      // And the fix, over the identical hostile global.
      const guarded = pageConsentStore()
      grantConsent(guarded, { anchoredTo: ANCHORS })
      const found = readConsent(guarded, ANCHORS)
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
    const granted = grantConsent(store, { anchoredTo: ANCHORS })
    expect(granted).toBeInstanceOf(GrantedConsent)
    expect(readConsent(store, ANCHORS).ok).toBe(true)

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
   * ## RE-KEYED 2026-09-04 (AUTH-06), and the re-keying is the case working
   *
   * This case read the antecedent off `browser-node.ts` — *"does the factory call `loadSeed`
   * and `saveSeed`?"* — and AUTH-06 deleted both, along with every other writer of a
   * plaintext secret. **It went red, and it went red for the right reason**, which is the
   * one its own docblock predicted: *"the day somebody removes persistence, the antecedent
   * goes false and this case stops demanding the disclosure."*
   *
   * But *"stops demanding"* is not enough on its own, because the disclosure it stopped
   * demanding was still on the page and was now **false**. A visitor was being told a key is
   * stored and loaded again next time, by a page that had stopped storing one. So the
   * antecedent moved rather than being deleted, and it gained its other half.
   *
   * **The antecedent is now `demo/main.ts`, not `browser-node.ts`, and that is where it
   * belongs.** The factory can persist an identity — it does whenever a caller supplies a
   * passphrase — but whether *this page's visitor* gets one is decided by the single
   * `identityProtection` value the demo passes, and the disclosure is shown to that
   * visitor and to nobody else. Reading the factory answered a question about a library;
   * this reads the question a person is actually being asked to consent to.
   *
   * **Two arms, and each one demands its own sentence**:
   *
   * - `writes-no-new-secret` — the page keeps no new key, so the disclosure must say the
   *   node key is made fresh and is not kept, and must NOT say it is stored and reloaded.
   * - `passphrase` — the page keeps one, so the disclosure must say it is stored and reused,
   *   which is what version 2 through version 6 said.
   *
   * That makes this case red **in both directions**: it is what caught the disclosure going
   * false when the demo stopped persisting, and it is what will catch it staying false when
   * the demo starts persisting again. A guard that only fires one way is a guard that gets
   * you once.
   *
   * The consequents stay deliberately weak on wording and strong on substance. They do not
   * pin phrasing — the copy is allowed to improve.
   *
   * **This does not check that the disclosure is true in general**, and no test can. It
   * checks the one property whose violation has already happened once.
   */
  it('discloses what the demo page actually does with a visitor’s node key, in whichever direction that is', async () => {
    // Read from source rather than by starting a node: this is a browser-project spec and
    // `BrowserNode.start` opens IndexedDB, dials, and needs a relay. The subject is what the
    // page *does*, and its source is the honest record of that.
    const page = await import('../demo/main.ts?raw').then((m) => m.default)
    const factory = await import('./browser-node.ts?raw').then((m) => m.default)

    // The antecedent, in two halves. The first is that the factory still has an identity
    // store to persist into at all — if that ever goes, both arms below are meaningless and
    // the whole case should be revisited rather than re-pointed a third time.
    expect(
      factory.includes('IdbIdentityStore') && factory.includes('identityProtection'),
      'browser-node.ts no longer takes an identity protection or opens an identity store — if '
        + 'that is deliberate, this case and the disclosure lines it guards should all be '
        + 'revisited, not deleted',
    ).toBe(true)

    // The second half, and the one that decides which sentence is true: what this page
    // passes. Exactly one of the two arms must be present, so a page that passed both — or
    // neither — is a finding rather than a silently-chosen branch.
    const keepsNoKey = page.includes("identityProtection: { kind: 'writes-no-new-secret' }")
    const keepsAKey = page.includes("identityProtection: { kind: 'passphrase'")
    expect(
      [keepsNoKey, keepsAKey].filter(Boolean).length,
      'demo/main.ts must pass exactly one identityProtection arm to BrowserNode.start — this '
        + 'case reads which sentence the disclosure owes a visitor off that one value',
    ).toBe(1)

    const prose = DISCLOSURE.lines
      .flatMap((line) => [line.question, line.answer])
      .join(' ')
      .toLowerCase()

    if (keepsAKey) {
      // It is kept somewhere.
      expect(prose, 'the disclosure must say the key is stored').toMatch(/stored|storage|kept/)
      // And it comes back — the half version 1's text actively denied by saying "in this tab".
      expect(prose, 'the disclosure must say the key is reused across visits').toMatch(
        /again|reused|returns?|next time|come back/,
      )
    } else {
      // The page keeps no new key, so the visitor must be told that and must NOT be told the
      // opposite. Both halves, because a text that added the true sentence and left the false
      // one beside it would satisfy a one-sided check and mislead a reader just as much.
      expect(prose, 'the disclosure must say a fresh node key is made each visit').toMatch(
        /fresh|new one|not kept|does not keep|is not stored/,
      )
      expect(
        prose,
        'the disclosure must not claim a stored node key comes back, because this page keeps none',
      ).not.toMatch(/loaded again the next time|two visits are the same node/)
    }

    // And the claim that made version 1 false must not reappear verbatim, in either arm.
    expect(prose).not.toContain('generated in this tab')
  })
})
describe('DATA-04 — a change of who may sign the code this node runs is a consent event', () => {
  const PUBLISHER_A = 'a'.repeat(64)
  const PUBLISHER_B = 'b'.repeat(64)

  it('refuses a consent given under a different anchor set, and names both', () => {
    // The silence this closes: `trustAnchors` names who may sign the code a visitor's
    // browser will execute. Agreeing to run code from one publisher is not agreeing to run
    // code from another, and until this the consent record could not even represent the
    // question — the swap happened with nothing shown to the visitor.
    const store = memoryConsentStore()
    grantConsent(store, { anchoredTo: describeAnchors([PUBLISHER_A]) })

    const found = readConsent(store, describeAnchors([PUBLISHER_B]))

    expect(found.ok).toBe(false)
    if (found.ok) return
    expect(found.gap.kind).toBe('anchor-changed')
    // Both sides named, because a UI that can only say "something changed" cannot write
    // the sentence this gap exists to let it write.
    expect(found.gap).toMatchObject({
      answered: describeAnchors([PUBLISHER_A]),
      current: describeAnchors([PUBLISHER_B]),
    })
  })

  it('accepts the same set supplied in a different order', () => {
    // A set is a set. Re-asking a visitor because a configuration file listed two keys the
    // other way round would train them to click through the dialogue, which costs more
    // than the question is worth.
    const store = memoryConsentStore()
    grantConsent(store, { anchoredTo: describeAnchors([PUBLISHER_A, PUBLISHER_B]) })

    expect(readConsent(store, describeAnchors([PUBLISHER_B, PUBLISHER_A])).ok).toBe(true)
  })

  it('distinguishes pinning nobody from pinning somebody', () => {
    // `runs-unsigned-artifacts` keeps its own name rather than collapsing to an empty
    // string, for the reason `trustAnchors` is a named literal at all: "unsigned artifacts
    // are allowed" and "nobody has been pinned yet" are different statements, and a fabric
    // that could not tell them apart would silently promote one into the other.
    expect(describeAnchors('runs-unsigned-artifacts')).not.toBe(describeAnchors([]))

    const store = memoryConsentStore()
    grantConsent(store, { anchoredTo: describeAnchors('runs-unsigned-artifacts') })

    expect(readConsent(store, describeAnchors([PUBLISHER_A])).ok).toBe(false)
  })

  it('fails closed on a consent stored before the field existed, and says so by name', () => {
    // Such a record is a genuine consent to a genuine disclosure — it simply does not say
    // which anchors were in force. Reporting it as `unreadable` would claim this origin's
    // storage is broken, which is false and unhelpful; asking again is the correct response
    // to not knowing what somebody agreed to.
    const store = memoryConsentStore()
    store.write(
      CONSENT_KEY,
      JSON.stringify({
        disclosureVersion: DISCLOSURE_VERSION,
        grantedAt: 1_000,
        reportingAllowed: false,
      }),
    )

    const found = readConsent(store, ANCHORS)

    expect(found.ok).toBe(false)
    if (found.ok) return
    expect(found.gap).toMatchObject({ kind: 'anchor-changed', answered: 'unrecorded' })
  })

  it('reports the terms first when both the terms and the anchors changed', () => {
    // A visitor facing both should be told about the document first: re-consenting to new
    // terms is the broader act and it carries the anchor question with it. Two dialogues
    // in a row for one situation is how a gate teaches people to dismiss it.
    const store = memoryConsentStore()
    store.write(
      CONSENT_KEY,
      JSON.stringify({
        disclosureVersion: 'an-older-disclosure',
        grantedAt: 1_000,
        reportingAllowed: false,
        anchoredTo: describeAnchors([PUBLISHER_A]),
      }),
    )

    const found = readConsent(store, describeAnchors([PUBLISHER_B]))

    expect(found.ok).toBe(false)
    if (found.ok) return
    expect(found.gap.kind).toBe('terms-changed')
  })
})
