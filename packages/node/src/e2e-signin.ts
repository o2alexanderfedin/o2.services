/**
 * The one place an e2e spec signs in through the demo page's own controls — AUTH-06, plan `42-06`.
 *
 * `42-04` moved this page's front door. `#allow` no longer reveals `#main`; it reveals
 * `#signin`, and `window.o2.start` throws `SignedOutError` until somebody has opened their own
 * envelope. Thirty-seven e2e files drove the old door. This module is the new one, written
 * once so that thirty-seven files do not each carry their own idea of what signing in means.
 *
 * ## It drives the page, and it has no bypass
 *
 * `signInDemoTab` fills `#signin-passphrase` and presses `#signin-register` or `#signin-login`.
 * That is all it does. There is no test-only door here, on the standing rule
 * `built-bundle.e2e.test.ts` states for consent — *"There is no test-only bypass: the API
 * refuses for the same reason the button is not there yet"* — and for the same reason
 * `demo/main.ts:16` gives for `grantConsent`: a harness does what a visitor does.
 *
 * The twenty-three fixtures that never touch the DOM at all — the ones that call
 * `window.o2.grantConsent()` inside a `page.evaluate` and then start a node under a
 * `blockstoreName` of their own — use {@link signInHarnessTab} instead, which calls the API
 * halves of the same two controls. Its header carries the measured reason it is a second
 * function rather than the same one.
 *
 * ## Which mode, and why it is read off the page rather than passed in
 *
 * The section renders in one of two shapes, and which one it is in is a fact about the
 * browser profile the caller may not know: a fresh context registers, a context that has
 * already registered logs in, and a context holding a pre-AUTH-06 plaintext seed *adopts* it —
 * which renders as the register shape. So the mode is **read from the page**: if
 * `#signin-register` is on screen the caller is registering, and if `#signin-login` is on
 * screen the caller is logging in. A caller that passed the mode in would be asserting
 * something about storage it did not look at, and the failure would arrive as a timeout on a
 * hidden control rather than as anything about identity.
 *
 * ## What "signed in" means here, and what it does NOT mean
 *
 * This function returns when **`#main` is visible**, which is what unlock reveals. It is
 * deliberately *not* "a node is running": `revealMain` starts one only when relay discovery
 * found an address, and four of the fixtures that call this serve the page from a host that
 * has no relay to find. A caller that needs a running node waits for its own signal — a
 * `#state` tone of `live`, or `window.o2.activity()` — exactly as it did before this plan.
 */

import type { Page } from 'playwright'
import { PASSPHRASE_MIN_LENGTH } from '@o2/libp2p'

/**
 * The passphrase every e2e fixture signs in with.
 *
 * A **fixture constant, not a secret**: it names nothing outside the test lane, is never
 * shipped to the browser build, and the demo has no default passphrase of any kind — a
 * visitor is asked. T-42-32, accepted for those reasons.
 *
 * Four ordinary words, which is the shape `SIGNIN_PASSPHRASE_HINT` asks a visitor for, so the
 * fixtures and the page's own copy are not describing different things. It is the same string
 * `signin-journey.e2e.test.ts` chose for the same reason; that file keeps its own constant
 * because it also needs a *wrong* one to sit beside it.
 */
export const E2E_PASSPHRASE = 'correct-horse-battery-staple'

/**
 * The floor, checked at import rather than counted by eye.
 *
 * A change to `PASSPHRASE_MIN_LENGTH` that left this literal under it would make every
 * importing fixture fail as `WeakPassphraseError` — thirty-odd files reporting a defect in the
 * page when the defect is one number in this file. Thrown at module scope so the first
 * importer pays for it and every one of them inherits it.
 */
if (E2E_PASSPHRASE.length < PASSPHRASE_MIN_LENGTH) {
  throw new Error(
    `E2E_PASSPHRASE is ${String(E2E_PASSPHRASE.length)} characters and the surface requires at ` +
      `least ${String(PASSPHRASE_MIN_LENGTH)}: every fixture importing this module would fail as ` +
      'WeakPassphraseError and look like a defect in the page',
  )
}

/** How long a sign-in is given to reveal `#main`, matching `signin-journey.e2e.test.ts`. */
const SIGNIN_MS = 120_000

export interface SignInOptions {
  /** The passphrase to register or log in with. Defaults to {@link E2E_PASSPHRASE}. */
  readonly passphrase?: string
  /** How long to wait for `#signin` and then for `#main`. Defaults to 120 s. */
  readonly timeout?: number
}

/**
 * Register or log in on a tab sitting at `#signin`, and return when `#main` is revealed.
 *
 * Call it after the gate has been answered — `page.click('#allow')`, or a stored consent
 * record — and before anything that reads `#main` or the controls inside it.
 */
export async function signInDemoTab(page: Page, options: SignInOptions = {}): Promise<void> {
  const passphrase = options.passphrase ?? E2E_PASSPHRASE
  const timeout = options.timeout ?? SIGNIN_MS

  await page.waitForSelector('#signin', { state: 'visible', timeout })

  // Which shape the section is in, read off the page. Both controls live in the markup and
  // exactly one of them is un-hidden by `renderEntry`, so this is the page's own answer to
  // "has this browser registered before" rather than the caller's guess at it.
  const registering = await page.waitForFunction(
    () => {
      const register = document.getElementById('signin-register')
      const login = document.getElementById('signin-login')
      if (register === null || login === null) return null
      if (register.hasAttribute('hidden') === false) return { registering: true }
      if (login.hasAttribute('hidden') === false) return { registering: false }
      return null
    },
    null,
    { timeout },
  )
  const mode: unknown = await registering.jsonValue()
  const isRegistering =
    typeof mode === 'object' && mode !== null && (mode as Record<string, unknown>)['registering'] === true

  await page.fill('#signin-passphrase', passphrase)
  if (isRegistering) {
    // The confirmation field exists only while choosing a NEW passphrase, and the page
    // refuses — without calling anything — when the two do not match.
    await page.fill('#signin-passphrase-again', passphrase)
    await page.click('#signin-register')
  } else {
    await page.click('#signin-login')
  }

  // Argon2id runs here, and no duration is asserted anywhere: three readings of these
  // parameters have spanned 34% across two hosts. The wait is on the page's own transition.
  await page.waitForSelector('#main', { state: 'visible', timeout })
}

/**
 * Consent and sign in from a harness that drives `window.o2` rather than the page — `42-06`.
 *
 * Twenty-three e2e files never touch this page's DOM. They grant consent inside a
 * `page.evaluate` and then start a node under a `blockstoreName` of their own, because they
 * need several independent nodes in one browser profile and `blockstoreName` is what makes
 * two tabs two nodes. {@link signInDemoTab} is no use to them: pressing Register would sign
 * them in and then start a node under the DEFAULT store, which is not the node they are
 * about to read.
 *
 * ## Why this waits on `#signin` rather than doing both calls in one evaluate
 *
 * **Measured while sweeping `42-04`, and it is a race rather than a preference.** Since
 * `42-04` the page starts a node itself the moment it renders the `unlocked` state with a
 * relay in reach — that is the owner's ruling, *logged in means a node already running* —
 * and `demo/index.html`'s reconcile tick calls `renderEntry()` **once**, when
 * `consent.granted` changes. So a harness that grants consent and registers inside one
 * evaluate is racing that tick against Argon2id:
 *
 * - tick first, register second → `renderEntry` sees `unlocked: false`, renders `#signin`,
 *   and never runs again, because consent does not change a second time. Nothing starts.
 * - register first, tick second → `renderEntry` sees `unlocked: true`, reveals `#main` and
 *   starts a node under `o2-blocks`, **beside** the one the harness is starting under its
 *   own store. Two `BrowserNode`s in one tab, two reservations on one relay, and
 *   `window.o2.activity()` reporting whichever finished last.
 *
 * The tick period is 1 s and Argon2id is about half of that on this host, so the coin is
 * genuinely two-sided. Waiting for `#signin` to be visible is the sync point that removes
 * it: it is the page's own evidence that `renderEntry` has already run with `unlocked`
 * false, and after that nothing re-renders it, because `lastConsentGranted` now equals what
 * `consentState()` reports and only a *change* re-derives the surface.
 *
 * The tab is therefore left showing its entry surface while a harness-started node runs
 * behind it. That is a harness state and no visitor reaches it — it is the same artefact
 * these files have always produced, which before `42-04` was a `#main` nobody had revealed
 * by pressing anything.
 *
 * **This is not a bypass.** `grantConsent` and `register` are the API halves of the two
 * controls, on `demo/main.ts:16`'s stated precedent — *"A harness calls
 * `window.o2.grantConsent()` for the same reason a visitor clicks the button"* — and
 * `TabApi.register` does exactly what the field and the button do. The sixteen files that
 * drive the DOM use {@link signInDemoTab} and press the real controls.
 */
export interface HarnessSignInOptions extends SignInOptions {
  /** The visitor's second answer, passed through to `grantConsent`. Defaults to withheld. */
  readonly reporting?: boolean
}

export async function signInHarnessTab(page: Page, options: HarnessSignInOptions = {}): Promise<void> {
  await page.evaluate((reporting: boolean) => {
    window.o2.grantConsent(reporting ? { reporting: true } : {})
  }, options.reporting === true)
  await registerHarnessTab(page, options)
}

/**
 * The register half of {@link signInHarnessTab}, for a fixture that granted consent itself.
 *
 * Two funnel fixtures grant consent at a point of their own choosing and then read what the
 * funnel did about it **before** anything starts — `funnel-live.e2e.test.ts` asserts that
 * stage two arrives from the consent alone. Folding the two acts together there would put a
 * registration inside a reading that is about consent, so they keep their own
 * `grantConsent()` and call this.
 */
export async function registerHarnessTab(page: Page, options: SignInOptions = {}): Promise<void> {
  const passphrase = options.passphrase ?? E2E_PASSPHRASE
  const timeout = options.timeout ?? SIGNIN_MS

  // The sync point. See {@link signInHarnessTab}'s header for the race it removes.
  await page.waitForSelector('#signin', { state: 'visible', timeout })

  // Argon2id, in the page, against this origin's default identity database. A passphrase
  // does not cross `page.evaluate` as a closure — Playwright serialises arguments — so it
  // travels in the argument the same way `blockstoreName` already does in these fixtures.
  await page.evaluate(async (secret: string) => {
    await window.o2.register(secret)
  }, passphrase)
}
