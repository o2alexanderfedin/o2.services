/**
 * Consent, as a value you cannot fabricate — BROW-01.
 *
 * Criterion 3 of this phase forbids spending any CPU before a visitor has given
 * explicit informed consent. The owner's decision went further: **no network
 * either**. Dialling a relay costs no cycles but does tell a third party the
 * visitor is here, and "we spent no CPU" is not an answer to "you announced me".
 *
 * ## Why this is a type and not a check
 *
 * The obvious implementation is `if (hasConsent()) startNode()`. That is a rule
 * somebody has to remember at every call site, and this project has already been
 * bitten twice by rules that were documented but not enforced — a churn loop whose
 * header promised a bounded wait while the code never read the deadline, and a
 * disagreement test whose assertions sat inside a condition that could never be
 * true. So consent is a **value**: `GrantedConsent` is minted only by
 * {@link grantConsent} (which writes the record) or {@link readConsent} (which
 * finds one already written), and the start path takes one as a parameter. A
 * caller without one does not fail a check — it fails to compile.
 *
 * The runtime half is a module-private symbol the constructor demands, so the
 * class cannot be instantiated from outside this file even in JavaScript.
 *
 * ## Versioning
 *
 * A stored consent records the {@link DISCLOSURE_VERSION} it answered. Change the
 * terms, bump the version, and every stored consent stops satisfying the gate.
 * See `disclosure.ts`.
 *
 * Portable: storage arrives as a port, so this runs unchanged in Node tests and in
 * a browser. Nothing touches `localStorage` at import time — a module that reads
 * browser globals when it is loaded cannot be imported by a Node test at all.
 */

import type { PublicKeyHex } from '@o2/core'
import { DISCLOSURE_VERSION } from './disclosure.ts'

/** Where a consent record is kept. Injectable, so the rules are testable. */
export interface ConsentStore {
  read(key: string): string | null
  write(key: string, value: string): void
  clear(key: string): void
}

/** Storage key. Namespaced so a host page's own keys cannot collide with it. */
export const CONSENT_KEY = 'o2:consent'

export interface ConsentRecord {
  /** The disclosure version this consent answered. */
  readonly disclosureVersion: string
  /**
   * The trust anchors in force when this consent was given — DATA-04, owner ruling
   * 2026-08-23.
   *
   * A canonical description rather than the array itself, so comparison is one string
   * equality and storage holds something a person can read. {@link describeAnchors}
   * produces it and is the only thing that may.
   *
   * **What this is protecting.** `trustAnchors` names who may sign the code this node
   * will execute. A visitor who agreed to run code signed by one publisher has not agreed
   * to run code signed by another, and until this field the swap happened in silence —
   * the consent record could not even represent the question. Absent on records written
   * before the field existed, which is a distinguishable state and is reported as one.
   */
  readonly anchoredTo?: string
  /** Epoch milliseconds. Informational — the version is what gates. */
  readonly grantedAt: number
  /** The optional extra, off unless the visitor turned it on. */
  readonly reportingAllowed: boolean
}

/**
 * The reason a stored consent does not satisfy the gate.
 *
 * Named rather than collapsed into a boolean, because "you never asked me" and
 * "the terms changed since you asked me" are different things to tell a visitor,
 * and only the second deserves an explanation of what changed.
 */
export type ConsentGap =
  | { readonly kind: 'never-asked' }
  | { readonly kind: 'unreadable'; readonly detail: string }
  | { readonly kind: 'terms-changed'; readonly answered: string; readonly current: string }
  /**
   * The terms are unchanged, and **who may sign the code this node runs** is not.
   *
   * A fourth kind rather than folding into `terms-changed`, for the reason the three
   * above are separate at all: they are different things to tell a visitor. "The terms
   * changed" points at a document; this points at a party, and the sentence a UI should
   * show is not the same one.
   *
   * `answered` is `'unrecorded'` for a consent stored before this field existed. That is
   * an honest answer — such a record genuinely does not say which anchors were in force —
   * and it fails closed: the visitor is asked again, which is the correct response to not
   * knowing what they agreed to.
   */
  | { readonly kind: 'anchor-changed'; readonly answered: string; readonly current: string }

/**
 * The canonical description of a trust-anchor set, for storing beside a consent.
 *
 * **Sorted**, because the same set supplied in a different order is the same set and a
 * visitor must not be re-asked for a reordering. **Joined with a separator that cannot
 * occur inside a key**, because hex keys are fixed-alphabet and a comma is not in it — so
 * no two distinct sets can produce the same string. The opt-out keeps its own name rather
 * than becoming an empty string, for the reason `trustAnchors` is a named literal in the
 * first place: *"unsigned artifacts are allowed"* and *"nobody has been pinned yet"* are
 * different statements and emptiness cannot tell them apart.
 */
export function describeAnchors(
  anchors: readonly PublicKeyHex[] | 'runs-unsigned-artifacts',
): string {
  if (anchors === 'runs-unsigned-artifacts') return 'runs-unsigned-artifacts'
  return [...anchors].sort().join(',')
}

/** What a consent record written before {@link describeAnchors} existed reports as. */
export const ANCHORS_UNRECORDED = 'unrecorded'

/** Module-private. Not exported, so `new GrantedConsent(...)` is unreachable outside. */
const MINTED: unique symbol = Symbol('o2.consent.minted')

/**
 * Proof that a visitor consented to the current disclosure.
 *
 * Hold one of these and you may start a node. There is no other way to obtain one
 * than to have written, or to have found, a consent record.
 */
export class GrantedConsent {
  readonly disclosureVersion: string
  readonly grantedAt: number
  readonly reportingAllowed: boolean
  /** The anchor set this consent was given under — see {@link ConsentRecord.anchoredTo}. */
  readonly anchoredTo: string

  constructor(record: ConsentRecord, minted: symbol) {
    if (minted !== MINTED) {
      throw new TypeError('consent cannot be constructed: it is granted, or it is absent')
    }
    this.disclosureVersion = record.disclosureVersion
    this.grantedAt = record.grantedAt
    this.reportingAllowed = record.reportingAllowed
    this.anchoredTo = record.anchoredTo ?? ANCHORS_UNRECORDED
  }

  toRecord(): ConsentRecord {
    return {
      disclosureVersion: this.disclosureVersion,
      grantedAt: this.grantedAt,
      reportingAllowed: this.reportingAllowed,
      anchoredTo: this.anchoredTo,
    }
  }
}

/**
 * A stored record, or `null` for anything this cannot read as one.
 *
 * **Every failure collapses to `null`, and `null` shows the gate.** Malformed JSON, a
 * JSON value that is not an object, and an object missing a field all answer the same
 * way, and none is distinguished from "nothing was ever stored". That is the safe
 * direction and the only one worth having: the sole consequence of a `null` is that the
 * visitor is asked to consent again, which is what should happen when this origin's
 * storage cannot be shown to hold their answer. Reporting the difference would mean
 * surfacing a parse error on a page whose correct response is to show a consent
 * dialogue anyway.
 */
function parse(raw: string): ConsentRecord | null {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    // Corrupt or truncated storage — treated as no consent, which shows the gate.
    return null
  }
  if (typeof value !== 'object' || value === null) return null
  const candidate = value as Record<string, unknown>
  const version = candidate['disclosureVersion']
  const at = candidate['grantedAt']
  const reporting = candidate['reportingAllowed']
  if (typeof version !== 'string') return null
  if (typeof at !== 'number' || !Number.isFinite(at)) return null
  if (typeof reporting !== 'boolean') return null
  // **Optional on the way in, and only here.** A record written before this field existed
  // is a real consent to a real disclosure, so refusing to parse it would report
  // `unreadable` — "this origin's storage is broken" — for a record that is nothing of the
  // sort. It is read as a consent whose anchor set is unknown, and `readConsent` then
  // fails it closed with a gap that says exactly that.
  const anchored = candidate['anchoredTo']
  if (anchored !== undefined && typeof anchored !== 'string') return null
  return {
    disclosureVersion: version,
    grantedAt: at,
    reportingAllowed: reporting,
    ...(anchored === undefined ? {} : { anchoredTo: anchored }),
  }
}

/**
 * Read a stored consent, or say precisely why there is none to use.
 *
 * A malformed record is treated as absent rather than repaired. Guessing what a
 * corrupt consent meant is the one repair nobody is entitled to make.
 */
export function readConsent(
  store: ConsentStore,
  /**
   * The anchor set in force **now**, as {@link describeAnchors} renders it.
   *
   * Required, with no default. A default would be a fail-open: a caller that forgot to
   * pass it would silently accept a consent given under any anchors at all, which is
   * precisely the silence this parameter exists to end. Making it a compile error at every
   * call site is the cheaper failure — the same call `fabric-node.ts` makes about
   * `trustAnchors` itself having no default.
   */
  anchoredTo: string,
): { readonly ok: true; readonly consent: GrantedConsent } | { readonly ok: false; readonly gap: ConsentGap } {
  let raw: string | null
  try {
    raw = store.read(CONSENT_KEY)
  } catch (cause) {
    // Private browsing modes throw on access rather than returning null. An
    // unavailable store is not a consent, so the gate stays shut.
    return {
      ok: false,
      gap: { kind: 'unreadable', detail: cause instanceof Error ? cause.message : String(cause) },
    }
  }
  if (raw === null) return { ok: false, gap: { kind: 'never-asked' } }

  const record = parse(raw)
  if (record === null) {
    return { ok: false, gap: { kind: 'unreadable', detail: 'stored consent is not a consent record' } }
  }
  if (record.disclosureVersion !== DISCLOSURE_VERSION) {
    return {
      ok: false,
      gap: {
        kind: 'terms-changed',
        answered: record.disclosureVersion,
        current: DISCLOSURE_VERSION,
      },
    }
  }
  // Checked **after** the disclosure version, deliberately. A visitor facing both changes
  // at once should be told about the document first: re-consenting to new terms is the
  // broader act, and it is the one that will carry the anchor question with it.
  const answered = record.anchoredTo ?? ANCHORS_UNRECORDED
  if (answered !== anchoredTo) {
    return { ok: false, gap: { kind: 'anchor-changed', answered, current: anchoredTo } }
  }
  return { ok: true, consent: new GrantedConsent(record, MINTED) }
}

export interface GrantOptions {
  /**
   * The anchor set the visitor is consenting under, as {@link describeAnchors} renders it.
   *
   * Required for the reason `readConsent`'s parameter is: a consent stored without it is a
   * consent nobody can later check, and it would make every subsequent load report
   * `anchor-changed` against `'unrecorded'`.
   */
  readonly anchoredTo: string
  /** The optional start-outcome report. Defaults to off — never pre-ticked. */
  readonly reportingAllowed?: boolean
  /** Injectable clock, so a test does not have to sleep to observe an ordering. */
  readonly now?: () => number
}

/**
 * Record that a visitor consented, and mint the proof.
 *
 * Writing fails soft: a visitor in a storage-denied context still gets a working
 * consent for this page load, they are simply asked again next time. Refusing to
 * run because a preference could not be *remembered* would punish the most
 * privacy-conservative visitors for being privacy-conservative.
 */
export function grantConsent(store: ConsentStore, options: GrantOptions): GrantedConsent {
  const record: ConsentRecord = {
    disclosureVersion: DISCLOSURE_VERSION,
    grantedAt: (options.now ?? Date.now)(),
    reportingAllowed: options.reportingAllowed ?? false,
    anchoredTo: options.anchoredTo,
  }
  try {
    store.write(CONSENT_KEY, JSON.stringify(record))
  } catch {
    // Storage denied. The consent still stands for this page load.
  }
  return new GrantedConsent(record, MINTED)
}

/** Forget a consent. The gate reappears on the next load. */
export function revokeConsent(store: ConsentStore): void {
  try {
    store.clear(CONSENT_KEY)
  } catch {
    // Nothing to do — an unreadable store is already a shut gate.
  }
}

/**
 * A store backed by `localStorage`, resolved lazily.
 *
 * Lazy because module-scope environment detection is what breaks the `default`
 * export condition for a host application (Phase 2's rule). Every method tolerates
 * the global being absent or throwing, which is the private-browsing case.
 */
export function localConsentStore(): ConsentStore {
  const backing = (): Storage | null => {
    try {
      const candidate: unknown = globalThis.localStorage
      if (candidate === undefined || candidate === null) return null
      // **Present is not the same as usable, and a third host proved it.** This read
      // `globalThis.localStorage ?? null` until 2026-08-08, which trusts any value bound
      // to that name to be a `Storage`. Node 25 binds one that is not: it exposes
      // `localStorage` as a global and then, started without `--localstorage-file`,
      // leaves it without the methods, so `backing()?.getItem` threw
      // `getItem is not a function` — from the one function whose whole contract is that
      // absent storage reads as "no consent" rather than throwing. The project targets
      // Node 24 LTS, so this host is ahead of the declared runtime; the defect is still
      // this file's, because "the global exists" was never the property being relied on.
      //
      // Duck-typed on the three methods actually called rather than `instanceof Storage`:
      // that constructor is not a global in every host this package runs in, and a check
      // that throws on the way to deciding whether something might throw is not a check.
      const storage = candidate as Partial<Storage>
      if (
        typeof storage.getItem !== 'function' ||
        typeof storage.setItem !== 'function' ||
        typeof storage.removeItem !== 'function'
      ) {
        return null
      }
      return storage as Storage
    } catch {
      // Access itself throws, not just returns undefined: Safari private browsing and
      // a third-party frame with storage blocked both do this. Collapsed to `null`
      // deliberately, and it is the same `null` as "no such global" one line up —
      // every caller's next move is identical for both, namely to behave as though
      // nothing is stored, which shows the gate rather than silently starting a node.
      return null
    }
  }
  return {
    read: (key) => backing()?.getItem(key) ?? null,
    write: (key, value) => {
      backing()?.setItem(key, value)
    },
    clear: (key) => {
      backing()?.removeItem(key)
    },
  }
}

/**
 * An in-memory store. Used by tests, and by a page whose storage is denied.
 *
 * **The second half of that sentence became true on 2026-08-14 and was false before it.**
 * Nothing outside this module and its spec called this function; a page whose storage is
 * denied got {@link localConsentStore}, whose writes are silently dropped. See
 * {@link pageConsentStore}, which is what makes the claim good.
 */
export function memoryConsentStore(): ConsentStore {
  const map = new Map<string, string>()
  return {
    read: (key) => map.get(key) ?? null,
    write: (key, value) => {
      map.set(key, value)
    },
    clear: (key) => {
      map.delete(key)
    },
  }
}

/**
 * The store a **page** should use: {@link localConsentStore} where it works,
 * {@link memoryConsentStore} where it does not.
 *
 * ## The defect this closes, which was a real refusal and not an untidy comment
 *
 * `demo/main.ts` bound `localConsentStore()` unconditionally, and that store's writes are
 * a **silent no-op** when storage is unusable — by design, and the design is right for a
 * store whose job is persistence. What made it a defect is the layer above:
 * `requireConsent()` does not use the value `grantConsent` returned, it **re-reads the
 * store**. So on a page whose storage is denied a visitor pressed *Allow*, the write went
 * nowhere, and pressing *Start* threw `no consent` — the grant and the check disagreed
 * because they consulted different things.
 *
 * That outcome is one this module had already ruled out in writing. `consent.test.ts`'s
 * *"a denied store does not deny the visitor"* states it: *"Refusing to run because a
 * preference could not be **remembered** would punish the most privacy-conservative
 * visitors for being privacy-conservative."* The rule was honoured here and defeated one
 * call up, which is why no test caught it — each layer was correct alone.
 *
 * ## Why the probe is a round trip and not a capability check
 *
 * `localConsentStore` already refuses a global that is absent, throws, or lacks the three
 * methods. **None of those is the case that bites.** A store that accepts `setItem` and
 * forgets it passes every one of those checks — it is the shape Safari private browsing
 * and a storage-blocked third-party frame present, and it is exactly the shape that
 * produced the refusal above. Only writing something and reading it back separates a store
 * that persists from one that merely accepts.
 *
 * The probe key is distinct from {@link CONSENT_KEY} and is cleared immediately, so this
 * neither reads nor disturbs a stored consent.
 *
 * ## What falling back does and does not buy
 *
 * The visitor can grant and then run, which is the whole point. Their consent lasts as long
 * as the page does and **no longer** — a reload shows the gate again, because nothing was
 * persisted and this function will not pretend otherwise. That is the honest outcome for a
 * visitor who has asked their browser not to remember them, and it is strictly better than
 * being unable to start at all.
 */
export function pageConsentStore(): ConsentStore {
  const local = localConsentStore()
  const probe = `${CONSENT_KEY}:probe`
  try {
    local.write(probe, '1')
    const echoed = local.read(probe)
    local.clear(probe)
    if (echoed === '1') return local
  } catch {
    // A store that throws on any leg of the round trip is not one a consent can be kept
    // in. Collapsed to the same answer as a store that silently forgot, because the
    // visitor's experience of the two is identical and so is the correct response.
  }
  return memoryConsentStore()
}
