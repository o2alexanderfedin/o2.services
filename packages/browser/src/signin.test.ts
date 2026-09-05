import { describe, expect, it } from 'vitest'
import { PASSPHRASE_MIN_LENGTH } from '@o2/libp2p'
import {
  SIGNIN_PASSPHRASE_HINT,
  type SigninInput,
  type SigninState,
  SignedOutError,
  signinState,
} from './signin.ts'

/**
 * The nine states, each reached from an input — AUTH-06, plans `42-04` and `42-07`.
 *
 * The value of this file is not that nine branches return nine values. It is the three
 * **orderings** at the bottom, which are the properties BROW-01, BROW-06 and criterion 4
 * rest on, and which a later edit reordering the branches would break without producing an
 * error anywhere.
 *
 * Every case builds its input from {@link base} by naming only the fields it is about, so a
 * new field added to `SigninInput` lands in one place and a case cannot silently depend on a
 * default it never stated.
 */

/**
 * A visitor who has consented, has nothing stored, and has done nothing else.
 *
 * `register` — the first thing a cold visitor sees after the gate.
 */
const base: SigninInput = {
  consent: 'granted',
  declined: false,
  stored: 'none',
  unlocked: false,
  refusal: null,
  lookingAround: false,
}

function stateFor(overrides: Partial<SigninInput>): SigninState {
  return signinState({ ...base, ...overrides })
}

describe('signinState — the nine states a visitor can be in', () => {
  it('shows the gate to somebody who has never been asked', () => {
    expect(stateFor({ consent: 'never-asked' })).toEqual({ kind: 'awaiting-consent' })
  })

  it('shows the gate when this origin’s storage cannot be read', () => {
    // A private-browsing store that throws is not a consent, so the gate stays shut. The
    // page must not treat "I could not read your answer" as "you answered".
    expect(stateFor({ consent: 'unreadable' })).toEqual({ kind: 'awaiting-consent' })
  })

  it('names WHICH thing went stale, because the gate says different sentences for the two', () => {
    expect(stateFor({ consent: 'terms-changed' })).toEqual({
      kind: 'stale-consent',
      why: 'terms-changed',
    })
    expect(stateFor({ consent: 'anchor-changed' })).toEqual({
      kind: 'stale-consent',
      why: 'anchor-changed',
    })
  })

  it('keeps a visitor who said No on the sign-in screen rather than re-opening the gate', () => {
    // Declining writes no consent record, so without this branch the very next read would
    // report `never-asked` and put the gate back in front of somebody who just dismissed it.
    expect(stateFor({ declined: true, consent: 'never-asked' })).toEqual({ kind: 'declined' })
  })

  it('invites a consented visitor with nothing stored to register', () => {
    expect(stateFor({})).toEqual({ kind: 'register' })
  })

  it('offers to adopt a plaintext identity an earlier build left here', () => {
    // T-42-20's residue reaching the visitor's own path: registering seals that same key in
    // place, so they keep the node they already were rather than becoming a stranger.
    expect(stateFor({ stored: 'legacy-plaintext' })).toEqual({ kind: 'adopt' })
  })

  it('asks a returning visitor with a sealed identity to log in', () => {
    expect(stateFor({ stored: 'sealed' })).toEqual({ kind: 'login' })
  })

  it('reports a refusal by whatever name the surface will render', () => {
    expect(stateFor({ stored: 'sealed', refusal: 'SealedIdentityUnlockError' })).toEqual({
      kind: 'refused',
      named: 'SealedIdentityUnlockError',
    })
  })

  it('reveals the workload surfaces to somebody who unlocked', () => {
    // `unlocked` is the envelope opening, NOT a node running. Four e2e fixtures serve this
    // page with no relay reachable and a node can never come up there; gating `#main` on a
    // running node would make those pages unreachable.
    expect(stateFor({ stored: 'sealed', unlocked: true })).toEqual({ kind: 'unlocked' })
  })

  it('lets a consented visitor look around before choosing a passphrase', () => {
    // `42-07`. The floor of twenty characters does not move; who has to pay it before they
    // may see anything does. A visitor who has just agreed to lend their processor and is
    // then asked to invent and write down a credential before a single figure appears is a
    // visitor who closes the tab, and the cohort is spendable exactly once.
    expect(stateFor({ lookingAround: true })).toEqual({ kind: 'looking-around' })
  })

  it('honours the choice even when this browser already holds a sealed identity', () => {
    // The case that catches a branch placed one line too low. With `looking-around` under
    // the storage-derived three, a returning visitor pressing *Look around first* would be
    // shown the login field instead, and nothing anywhere would say the choice was dropped.
    expect(stateFor({ lookingAround: true, stored: 'sealed' })).toEqual({
      kind: 'looking-around',
    })
  })
})

describe('the three orderings that must not be reachable', () => {
  /**
   * BROW-01 and BROW-06. The gate is answered before the passphrase field is shown, and
   * this is the reading of that as a property of the machine rather than of the markup.
   *
   * Every combination of the identity fields is tried, because the claim is *however the
   * identity fields are set* and a single combination would be an example rather than the
   * property. `DISCLOSURE_VERSION` moves to '8' in this plan, so every stored consent in
   * existence goes stale on the first load after it lands — which makes this the ordering
   * most likely to be lost here, and the one whose loss would present as a page that works.
   */
  it('never lets a stale consent produce a login field or an unlocked page', () => {
    const stored: SigninInput['stored'][] = ['none', 'sealed', 'legacy-plaintext']
    const gaps: SigninInput['consent'][] = ['terms-changed', 'anchor-changed']
    let checked = 0
    for (const gap of gaps) {
      for (const holding of stored) {
        for (const unlocked of [false, true]) {
          for (const refusal of [null, 'SealedIdentityUnlockError']) {
            const state = stateFor({ consent: gap, stored: holding, unlocked, refusal })
            expect(
              state.kind,
              `consent=${gap} stored=${holding} unlocked=${String(unlocked)} `
                + `refusal=${String(refusal)} produced '${state.kind}' — a visitor whose terms `
                + 'changed was shown something other than the gate',
            ).toBe('stale-consent')
            checked += 1
          }
        }
      }
    }
    // The floor. A loop that stopped enumerating would otherwise pass by asserting nothing,
    // which is the failure mode a loop-driven case has and a literal case does not.
    expect(checked, 'the enumeration stopped early, so this case asserted almost nothing').toBe(24)
  })

  /**
   * Criterion 4, as an ordering.
   *
   * A wrong passphrase must never arrive at a running node. `unlocked` is a page-held flag
   * and `refusal` is a page-held string; the machine refuses to let the first overtake the
   * second, so a page that set both — through a race, a reload, a forgotten reset — shows the
   * refusal rather than the surfaces.
   */
  it('never lets a refusal produce an unlocked page', () => {
    const stored: SigninInput['stored'][] = ['none', 'sealed', 'legacy-plaintext']
    let checked = 0
    for (const holding of stored) {
      for (const unlocked of [false, true]) {
        const state = stateFor({ stored: holding, unlocked, refusal: 'SealedIdentityUnlockError' })
        expect(
          state.kind,
          `stored=${holding} unlocked=${String(unlocked)} produced '${state.kind}' — a refused `
            + 'passphrase reached a state that reveals the workload surfaces',
        ).toBe('refused')
        checked += 1
      }
    }
    expect(checked).toBe(6)
  })

  /**
   * `42-07`, as an ordering.
   *
   * Looking around is a visitor's convenience and it must never buy them past anything.
   * Every state above it in the precedence is enumerated here against `lookingAround: true`,
   * because the claim is *whatever else is true* and one combination would be an example
   * rather than the property.
   *
   * The gate is the one that matters most and it is the reason the branch sits where it
   * does: revealing `#main` runs `discoverRelays()`, which is a network act. A look-around
   * that outranked the gate — or a declining visitor — would put a request on the wire for
   * somebody who has not agreed to talk to anybody, which is exactly what
   * `built-bundle.e2e.test.ts`'s P10 exists to catch.
   */
  it('never lets looking around overtake the gate, a decline, a refusal or an unlock', () => {
    const cases: { readonly overrides: Partial<SigninInput>; readonly expected: string }[] = [
      { overrides: { consent: 'never-asked' }, expected: 'awaiting-consent' },
      { overrides: { consent: 'unreadable' }, expected: 'awaiting-consent' },
      { overrides: { consent: 'terms-changed' }, expected: 'stale-consent' },
      { overrides: { consent: 'anchor-changed' }, expected: 'stale-consent' },
      { overrides: { declined: true }, expected: 'declined' },
      { overrides: { refusal: 'SealedIdentityUnlockError' }, expected: 'refused' },
      { overrides: { unlocked: true }, expected: 'unlocked' },
    ]
    let checked = 0
    for (const { overrides, expected } of cases) {
      const state = stateFor({ ...overrides, lookingAround: true })
      expect(
        state.kind,
        `${JSON.stringify(overrides)} with lookingAround produced '${state.kind}' — a `
          + 'convenience was allowed to outrank something that is not one',
      ).toBe(expected)
      checked += 1
    }
    // The floor, written as a literal. A table that lost a row would otherwise pass by
    // asserting less, which is the failure mode a table-driven case has.
    expect(checked, 'the table lost a row, so this case asserted less than it says').toBe(7)
  })
})

describe('what the surface owes a visitor', () => {
  it('SignedOutError names itself, so a page rendering the class name renders the right one', () => {
    // A subclass of `Error` inherits `'Error'` unless `name` is set, and a surface that
    // reported the class name would then say `Error` about a refusal that has a name.
    const error = new SignedOutError()
    expect(error.name).toBe('SignedOutError')
    expect(error).toBeInstanceOf(Error)
    expect(
      error.message,
      'the refusal must say what would have happened instead, not merely that it refused',
    ).toMatch(/different node|cannot open/)
  })

  it('asks for a passphrase rather than a password, and says why the floor is where it is', () => {
    // The barrier is real and the answer is copy. A hint that only stated a number would
    // leave a visitor typing a long password, which is the thing this floor is not about.
    expect(SIGNIN_PASSPHRASE_HINT).toMatch(/words/i)
    expect(SIGNIN_PASSPHRASE_HINT).toContain(String(PASSPHRASE_MIN_LENGTH))
    expect(
      SIGNIN_PASSPHRASE_HINT,
      'a visitor must be told before they choose that nobody can send it back to them — '
        + 'afterwards is a support request to a channel that does not exist',
    ).toMatch(/nobody can send it back|no account|no server/i)
  })
})
