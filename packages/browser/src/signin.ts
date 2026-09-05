/**
 * The way in, as a function of what is true rather than as a flag somebody set — AUTH-06.
 *
 * The owner ruled on 2026-09-04 that a visitor to this page is in one of two states: **not
 * logged in**, in which case they see what this is and an invitation to register or log in;
 * or **logged in**, in which case their node is already running. He also ruled that the
 * credential is a **local passphrase** — no email, no account database, no server, no
 * third-party identity provider — and that the node starts on unlock with a visible switch.
 *
 * Two states for a visitor is nine states for a page, and a page that sets a boolean in
 * nine places will get one of them wrong. So this module is a **pure function** from a
 * record of facts to a state, with no DOM, no storage and no side effect at import, and the
 * page renders whatever it returns. `consent.ts` is the shape being copied: the rules live
 * in a module a Node test can import, and the storage arrives as a value.
 *
 * ## The precedence, and why it is not an implementation detail
 *
 * Consent is consulted **before anything about identity**. That is BROW-01 and BROW-06
 * expressed as an ordering: the gate is the first thing a visitor answers, no network
 * request and no CPU precedes it, and a passphrase field in front of it would be a page
 * asking who somebody is before telling them what it does. `artifact-fetch-gate.e2e.test.ts`
 * measures the consequence — its arm A waits for `#gate` to be un-hidden immediately after
 * load and then reads a gateway server's own log — so an entry screen in front of the gate
 * does not merely read wrong, it times that arm out.
 *
 * **A later edit that reorders these branches is the defect this ordering exists to
 * prevent.** It would not present as an error; it would present as a page that works.
 *
 * The order, and the reason for each position:
 *
 * 1. `declined` — the visitor answered, and the answer was No. It comes first because
 *    declining writes **no** consent record, so every branch below would otherwise read
 *    this visitor as *never asked* and put the gate back in front of somebody who just
 *    dismissed it. `demo/index.html` has stated that rule since BROW-01 landed: *"said no"
 *    and "not asked yet" are different states and only the second should re-open it.*
 * 2. `stale-consent` — the terms or the trust anchors moved under a stored consent.
 * 3. `awaiting-consent` — never asked, or an unreadable store.
 * 4. `refused` — a passphrase was tried and did not open the envelope. **Above `unlocked`,
 *    deliberately**, and this is criterion 4 written as an ordering: the failure this
 *    machine must never produce is a wrong passphrase arriving at a running node, so a
 *    refusal cannot be overtaken by a stale `unlocked` flag. The cost of that choice is
 *    named rather than hidden — a page that forgets to clear `refusal` after a successful
 *    unlock leaves its visitor on the refusal screen — and
 *    `signin-journey.e2e.test.ts`'s criterion-4 case enters the wrong passphrase and then
 *    the right one on the same page, which is exactly the reading that catches it.
 * 5. `unlocked` — the envelope opened. This reveals the workload surfaces; it does **not**
 *    mean a node is running. Four e2e fixtures serve this page from a static host with no
 *    relay, and a node can never come up there.
 * 6. `looking-around` — the visitor asked to see the page before choosing a passphrase
 *    (`42-07`). It sits **below everything above it and above the three below it**, and
 *    both halves are deliberate. Below, because looking around is a convenience and a
 *    convenience must never buy anybody past the gate, past their own decline, or past a
 *    refusal — revealing the surfaces runs `discoverRelays()`, which is a network act, and
 *    a declining visitor has answered exactly that question. Above, because it is the
 *    visitor's own choice and the three below it are read from storage: a returning visitor
 *    who presses *Look around first* and is shown the login field anyway has had their
 *    choice dropped with nothing anywhere saying so.
 * 7. the three storage-derived modes — `login`, `adopt`, `register`.
 *
 * ## Where this departs from `42-04-PLAN.md`'s table, and why
 *
 * The plan's table conditions `stale-consent` on *a sealed record being present*. It is
 * implemented on the **consent gap alone**. Two reasons, and both are about the property
 * above rather than about taste: consulting the identity store to decide a *consent* state
 * is precisely the ordering inversion the precedence exists to forbid; and the page has
 * distinguished those two gaps in its gate copy since before this module existed
 * (`index.html`'s `gate-version` line says *"What this page does has changed since you last
 * agreed"*) without knowing anything about an identity. Both states render `#gate`, so the
 * difference is what the gate is allowed to say, and what changed is a fact about the
 * disclosure rather than about the visitor's storage.
 *
 * Pure module — no DOM, no storage, no side effects at import.
 */

import { PASSPHRASE_MIN_LENGTH } from '@o2/libp2p'

/**
 * What the page is showing, and there is nothing else it may show.
 *
 * A discriminated union rather than a pair of booleans, so a rendering function has to
 * handle every state the machine can produce and a tenth cannot be arrived at by omission.
 */
export type SigninState =
  /** `#gate`. `#signin` and `#main` hidden. Nothing has been asked yet. */
  | { readonly kind: 'awaiting-consent' }
  /** `#gate`, and the gate may say what changed. */
  | { readonly kind: 'stale-consent'; readonly why: 'terms-changed' | 'anchor-changed' }
  /** `#signin`, both controls disabled, and a sentence saying reload to change your mind. */
  | { readonly kind: 'declined' }
  /** `#signin` in register mode: two passphrase fields. */
  | { readonly kind: 'register' }
  /** `#signin` in register mode, plus the notice that an identity is already here in the clear. */
  | { readonly kind: 'adopt' }
  /** `#signin` in login mode: one field. */
  | { readonly kind: 'login' }
  /**
   * `#signin` in login mode, the refusal named in `#signin-status`, and `#signin-startover`
   * revealed **here and only here**.
   *
   * `named` is what the surface renders. A page that offers *start over* to somebody who
   * mistyped once is a page that will lose identities, so the control's reachability is a
   * property of this state and not of a click count.
   */
  | { readonly kind: 'refused'; readonly named: string }
  /** `#main`. The auto-start is attempted after this, and its failure is a reported state. */
  | { readonly kind: 'unlocked' }
  /**
   * `#main`, with **no node started and none startable** — `42-07`.
   *
   * The page already paints every surface at its *stopped* sentence before anything runs,
   * so this state needs no second vocabulary: a visitor looking around reads the same
   * honest sentences a visitor who pressed Stop reads. What it adds is a notice saying why
   * nothing is running and a control back to the passphrase field.
   *
   * `#join` is **disabled** here rather than left to throw. Starting a node without an
   * unlocked identity raises {@link SignedOutError} by construction, and a refusal arriving
   * through the page's blocked path would look like a broken page to precisely the visitor
   * this state exists for.
   */
  | { readonly kind: 'looking-around' }

/**
 * The facts the page can observe, and nothing derived from them.
 *
 * `consent` carries `readConsent`'s own vocabulary — `granted` plus `ConsentGap`'s four
 * kinds — rather than a boolean, because *"you never asked me"* and *"the terms changed
 * since you asked me"* are different things to tell a visitor and only the second deserves
 * an explanation of what changed.
 */
export interface SigninInput {
  readonly consent: 'granted' | 'never-asked' | 'unreadable' | 'terms-changed' | 'anchor-changed'
  /** The visitor pressed the control that declines, in this visit. Not persisted anywhere. */
  readonly declined: boolean
  /** What this origin's identity database holds. `legacy-plaintext` is a pre-AUTH-06 record. */
  readonly stored: 'none' | 'sealed' | 'legacy-plaintext'
  /** A passphrase opened the envelope in this visit. Never persisted — see `demo/main.ts`. */
  readonly unlocked: boolean
  /** The last refusal, as the surface will render it, or `null`. */
  readonly refusal: string | null
  /**
   * The visitor pressed *Look around first*, in this visit. Not persisted anywhere.
   *
   * `declined`'s shape exactly, and for `declined`'s reason: it is an act taken on this
   * page in this visit, not a fact about the visitor that a later visit should inherit.
   * Persisting it would also make it a thing stored about somebody who has chosen not to
   * register, which is the opposite of what this page is.
   */
  readonly lookingAround: boolean
}

/**
 * Which of the nine states this page is in.
 *
 * Total over its input by construction: every branch returns, and the last one is the
 * default rather than a case, so a new `stored` value would land on `register` — the arm
 * that writes nothing until a visitor types something — rather than on a fall-through.
 */
export function signinState(input: SigninInput): SigninState {
  // 1. The visitor's own answer to the gate. See the precedence note above: declining
  //    writes no record, so this must precede every consent read or the gate comes back.
  if (input.declined) return { kind: 'declined' }

  // 2 and 3. Consent, before anything about identity is consulted.
  if (input.consent === 'terms-changed' || input.consent === 'anchor-changed') {
    return { kind: 'stale-consent', why: input.consent }
  }
  if (input.consent !== 'granted') return { kind: 'awaiting-consent' }

  // 4. Criterion 4, as an ordering. A refusal is never overtaken by an unlock.
  if (input.refusal !== null) return { kind: 'refused', named: input.refusal }

  // 5. The envelope opened. This is what reveals `#main`; a running node is not.
  if (input.unlocked) return { kind: 'unlocked' }

  // 6. The visitor asked to see the page first. Below everything above — a convenience
  //    never outranks the gate, a decline or a refusal — and above the three below, which
  //    are read from storage rather than chosen.
  if (input.lookingAround) return { kind: 'looking-around' }

  // 7. What is in the store decides which invitation the visitor is shown.
  if (input.stored === 'sealed') return { kind: 'login' }
  if (input.stored === 'legacy-plaintext') return { kind: 'adopt' }
  return { kind: 'register' }
}

/**
 * Thrown when something that needs an unlocked identity is reached without one.
 *
 * **There is no fallback arm and there must not be one.** The obvious alternative — fall
 * back to `writes-no-new-secret` when nobody has signed in — is the silent re-mint criterion
 * 4 forbids, arriving from the UI instead of from the store: a working tab, a peer id
 * nobody expected, an orphaned certificate, and nothing anywhere saying so.
 *
 * `name` is set explicitly. A subclass of `Error` inherits `'Error'` otherwise, and a caller
 * that reports the class name would report the wrong one.
 */
export class SignedOutError extends Error {
  constructor() {
    super(
      'nobody is signed in on this page: register with a passphrase or log in with the one you '
        + 'chose. Starting a node without one would mint an identity this browser cannot open '
        + 'again, which is a different node under the same name',
    )
    this.name = 'SignedOutError'
  }
}

/**
 * What the field asks a visitor for, in the words it asks them in.
 *
 * It lives here so the page and this module's spec read **one** definition, and so does
 * `signin-journey.e2e.test.ts`'s own fixture passphrase, which is four ordinary words for
 * exactly this reason.
 *
 * ## Why the answer to twenty characters is copy and not a lower floor
 *
 * `PASSPHRASE_MIN_LENGTH` is 20, borrowed from `@libp2p/keychain`'s NIST SP 800-132 floor,
 * and it is a real barrier for somebody who came here to look at a page. It stays, and the
 * reason is the threat rather than inertia: the attacker this seal is against is **offline,
 * holding a disk image**, and Argon2id at the parameters this repository ships prices a
 * guess at roughly two per second per core. A twelve-character human-chosen password falls
 * to that in days; twenty is where the KDF's cost starts to matter. Lowering it on this tier
 * would also make `identity-protection.ts` — which exists so the two tiers cannot disagree
 * about what protects the same class of secret — a lie about one of its two users.
 *
 * So the barrier is answered by asking for the right **kind** of thing. Four common words
 * is typically 24–28 characters and is easier to remember than eight random ones.
 */
export const SIGNIN_PASSPHRASE_HINT: string =
  `Four or five ordinary words, at least ${String(PASSPHRASE_MIN_LENGTH)} characters — a `
  + 'passphrase, not a password. Something like three unrelated nouns and a verb is easier to '
  + 'remember than eight random characters and far harder to guess. Nobody can send it back to '
  + 'you: there is no account here and no server holding anything of yours, so write it down '
  + 'somewhere you trust before you continue.'
