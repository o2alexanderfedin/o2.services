/**
 * A visitor's decision to enrol — AUTH-01, AUTH-02, AUTH-04.
 *
 * ## The objection this is built around, and how it is honoured rather than overridden
 *
 * `demo/main.ts` carries a standing objection that has been sustained three times:
 *
 * > *autoStart passes no `enrollment` and grows no parameter for one, for the same reason
 * > it grows none for `trustAnchors`: a page that was found rather than configured must not
 * > be configurable by whatever found it.*
 *
 * Every earlier attempt to let a tab enrol tried to close the gap by widening `autoStart`,
 * and each was declined for exactly that sentence. **The objection is about the ORIGIN, not
 * about the VISITOR**, and separating those two is what makes this module possible.
 *
 * - The origin may say **where** a joiner should knock. That is discovery, it is one
 *   address, and `/bootstrap.json`'s `enrollmentProvider` already carries it.
 * - The origin may **not** say *who this tab is*, nor decide *that* it enrols. Those are the
 *   visitor's, and no code path exists by which the page's own origin could supply them:
 *   the key comes from `visitor-key.ts` (non-extractable, minted in this browser), the
 *   operator id is derived from it, and the decision is the record below, which only a
 *   visitor's own action writes.
 *
 * So `autoStart` **still passes no `enrollment` and still grows no parameter for one.** What
 * changed is that `start` now reads a decision the *visitor* previously made, from this
 * origin's storage — which is byte-for-byte what it already does for consent, and for
 * `enrolledIssuer`'s pinning. A stored answer is not configuration by whoever served the
 * page; it is the visitor's own earlier answer, and it is revocable.
 *
 * ## Why this is a type and not a boolean, and why it is a near-copy of `consent.ts`
 *
 * Deliberately the same shape as `consent.ts`, down to the module-private minting symbol:
 * that file's reasoning — *"consent is a **value**… A caller without one does not fail a
 * check — it fails to compile"* — applies here unchanged, and the second explicit,
 * revocable, persisted visitor decision in this package should not be a different pattern
 * from the first. The duplication is real and is recorded rather than hidden; the two are
 * not merged because their gaps differ (see {@link EnrolmentGap}) and a generic store keyed
 * by a string would have made both weaker in order to make neither clearer.
 *
 * ## What is stored, and what deliberately is not
 *
 * The provider address the visitor accepted, and when. **Not** the key — that lives in
 * IndexedDB as a handle whose private half nothing can read, and copying anything derived
 * from it into `localStorage` would put a stable cross-session identifier somewhere every
 * script on this origin can read it. **Not** the certificate — `IdbIdentityStore` holds
 * that, and this record is a decision rather than a result.
 *
 * Storing the address matters: it is what the visitor said yes *to*. If the origin later
 * publishes a different provider, the stored decision does not extend to it — see
 * {@link EnrolmentGap}'s `provider-changed`, which is `consent.ts`'s `terms-changed` applied
 * to the one term this decision has.
 *
 * Portable: storage arrives as a {@link ConsentStore}, so this runs unchanged in Node tests
 * and in a browser, and nothing touches `localStorage` at import time.
 */

import type { ConsentStore } from './consent.ts'

/** Storage key. Namespaced beside `o2:consent` so a host page's keys cannot collide. */
export const ENROLMENT_KEY = 'o2:enrolment'

export interface EnrolmentRecord {
  /** The provider multiaddr the visitor accepted. The one term of this decision. */
  readonly providerAddr: string
  /** Epoch milliseconds. Informational — the address is what gates. */
  readonly acceptedAt: number
}

/**
 * The reason a stored decision does not stand.
 *
 * Named rather than collapsed to a boolean, for `ConsentGap`'s reason: *"you never asked
 * me"* and *"the offer changed since you answered it"* are different things to tell a
 * visitor, and only the second deserves saying what changed.
 */
export type EnrolmentGap =
  | { readonly kind: 'never-asked' }
  | { readonly kind: 'unreadable'; readonly detail: string }
  | {
      readonly kind: 'provider-changed'
      readonly accepted: string
      readonly offered: string
    }

/** Module-private. Not exported, so `new GrantedEnrolment(...)` is unreachable outside. */
const MINTED: unique symbol = Symbol('o2.enrolment.minted')

/**
 * Proof that a visitor chose to enrol, and with whom.
 *
 * Hold one and `start` will pass an `enrollment` option. There is no way to obtain one but
 * to have written, or to have found, a decision record.
 */
export class GrantedEnrolment {
  readonly providerAddr: string
  readonly acceptedAt: number

  constructor(record: EnrolmentRecord, minted: symbol) {
    if (minted !== MINTED) {
      throw new TypeError('enrolment cannot be constructed: it is chosen, or it is absent')
    }
    this.providerAddr = record.providerAddr
    this.acceptedAt = record.acceptedAt
  }

  toRecord(): EnrolmentRecord {
    return { providerAddr: this.providerAddr, acceptedAt: this.acceptedAt }
  }
}

/**
 * A stored record, or `null` for anything this cannot read as one.
 *
 * Every failure collapses to `null`, and `null` re-shows the offer — `consent.ts`'s `parse`
 * makes the argument and it is the same one: the sole consequence is that the visitor is
 * asked again, which is what should happen when this origin's storage cannot be shown to
 * hold their answer.
 */
function parse(raw: string): EnrolmentRecord | null {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof value !== 'object' || value === null) return null
  const candidate = value as Record<string, unknown>
  const providerAddr = candidate['providerAddr']
  const acceptedAt = candidate['acceptedAt']
  if (typeof providerAddr !== 'string' || providerAddr === '') return null
  if (typeof acceptedAt !== 'number' || !Number.isFinite(acceptedAt)) return null
  return { providerAddr, acceptedAt }
}

/**
 * Read a stored decision, or say precisely why there is none to use.
 *
 * `offered` is the provider **this origin publishes right now**, and passing it is what
 * makes the check a check rather than a lookup. Omit it and the stored decision is returned
 * on its own terms — which is what `start` wants, because `start` acts on what the visitor
 * accepted and not on what the origin currently says. The page passes it, because the page
 * is deciding whether to ask again.
 *
 * **The asymmetry is deliberate and is the security-relevant half.** An origin that swaps
 * its published provider cannot thereby redirect a tab that already enrolled: `start` uses
 * the stored address. It also cannot leave the visitor believing they are enrolled with the
 * new one: the page sees `provider-changed` and re-offers, naming both.
 */
export function readEnrolment(
  store: ConsentStore,
  offered?: string,
):
  | { readonly ok: true; readonly enrolment: GrantedEnrolment }
  | { readonly ok: false; readonly gap: EnrolmentGap } {
  let raw: string | null
  try {
    raw = store.read(ENROLMENT_KEY)
  } catch (cause) {
    return {
      ok: false,
      gap: { kind: 'unreadable', detail: cause instanceof Error ? cause.message : String(cause) },
    }
  }
  if (raw === null) return { ok: false, gap: { kind: 'never-asked' } }

  const record = parse(raw)
  if (record === null) {
    return {
      ok: false,
      gap: { kind: 'unreadable', detail: 'stored enrolment is not an enrolment record' },
    }
  }
  if (offered !== undefined && offered !== record.providerAddr) {
    return {
      ok: false,
      gap: { kind: 'provider-changed', accepted: record.providerAddr, offered },
    }
  }
  return { ok: true, enrolment: new GrantedEnrolment(record, MINTED) }
}

export interface AcceptOptions {
  /** The provider the visitor is accepting. Comes from the offer, never from a caller. */
  readonly providerAddr: string
  /** Injectable clock, so a test need not sleep to observe an ordering. */
  readonly now?: () => number
}

/**
 * Record that a visitor chose to enrol, and mint the proof.
 *
 * Writing fails soft, for `grantConsent`'s reason applied here: a visitor whose storage is
 * denied still gets a working decision for this page load and is simply asked again next
 * time. Refusing to enrol because the *choice* could not be remembered would punish the
 * most privacy-conservative visitors for being privacy-conservative — and it would refuse
 * them the one thing on this page that a gated relay requires.
 */
export function acceptEnrolment(store: ConsentStore, options: AcceptOptions): GrantedEnrolment {
  const record: EnrolmentRecord = {
    providerAddr: options.providerAddr,
    acceptedAt: (options.now ?? Date.now)(),
  }
  try {
    store.write(ENROLMENT_KEY, JSON.stringify(record))
  } catch {
    // Storage denied. The decision still stands for this page load.
  }
  return new GrantedEnrolment(record, MINTED)
}

/**
 * Forget a decision. The offer reappears on the next load.
 *
 * **This is not the whole of withdrawing**, and the caller must do the rest: a tab that
 * keeps running with the certificate it obtained under a withdrawn decision has withdrawn
 * nothing, and a key left in IndexedDB is the identifier the provider knows this person by.
 * `demo/main.ts`'s `declineEnrolment` stops the node and calls `forgetVisitorKey` alongside
 * this — the same shape `revokeConsent` takes, and for the same stated reason: *"A
 * permission withdrawn while work continues would be a permission in name only."*
 */
export function revokeEnrolment(store: ConsentStore): void {
  try {
    store.clear(ENROLMENT_KEY)
  } catch {
    // Nothing to do — an unreadable store already holds no decision this can act on.
  }
}
