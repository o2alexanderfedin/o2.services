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

  constructor(record: ConsentRecord, minted: symbol) {
    if (minted !== MINTED) {
      throw new TypeError('consent cannot be constructed: it is granted, or it is absent')
    }
    this.disclosureVersion = record.disclosureVersion
    this.grantedAt = record.grantedAt
    this.reportingAllowed = record.reportingAllowed
  }

  toRecord(): ConsentRecord {
    return {
      disclosureVersion: this.disclosureVersion,
      grantedAt: this.grantedAt,
      reportingAllowed: this.reportingAllowed,
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
  return { disclosureVersion: version, grantedAt: at, reportingAllowed: reporting }
}

/**
 * Read a stored consent, or say precisely why there is none to use.
 *
 * A malformed record is treated as absent rather than repaired. Guessing what a
 * corrupt consent meant is the one repair nobody is entitled to make.
 */
export function readConsent(
  store: ConsentStore,
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
  return { ok: true, consent: new GrantedConsent(record, MINTED) }
}

export interface GrantOptions {
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
export function grantConsent(store: ConsentStore, options: GrantOptions = {}): GrantedConsent {
  const record: ConsentRecord = {
    disclosureVersion: DISCLOSURE_VERSION,
    grantedAt: (options.now ?? Date.now)(),
    reportingAllowed: options.reportingAllowed ?? false,
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

/** An in-memory store. Used by tests, and by a page whose storage is denied. */
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
