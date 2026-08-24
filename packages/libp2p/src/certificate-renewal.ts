import { msUntilRenewalDue, shouldRenewCertificate } from '@o2/core'
import type { CertificateHolder, NodeCertificate } from '@o2/core'

/**
 * Keeping a certificate alive, on both tiers, with one implementation.
 *
 * ## The defect this closes
 *
 * Until this module a certificate was obtained **once, at start**, and nothing ever asked
 * for another. `obtainCertificate` runs on the start path; `loadCertificate` checks
 * `expiresAt > Date.now()` and falls through to a fresh exchange when it has lapsed. Both
 * are start-time events. A process that stays up past its certificate's expiry therefore
 * holds an expired one and has no route to a new one short of a restart — while
 * `PeerVerifier` demotes it (`peer-verifier.ts`: a settled acceptance is re-asked once the
 * certificate behind it has expired) and `relayAdmissionGate` stops admitting it.
 *
 * That is a live defect at the **current** thirty-day lifetime, independently of any
 * argument about shortening it: the fabric is meant to run nodes for longer than a month.
 * It is also the precondition for shortening it at all, which is why this landed first.
 *
 * ## Why one timer and not a poll
 *
 * The moment renewal becomes due is computable — `msUntilRenewalDue` — so a poll would be
 * asking a question whose answer is already known, on every tick, forever. One timer is
 * armed for that moment and re-armed from the *new* certificate when one arrives.
 *
 * ## Why a failed renewal is not an error
 *
 * A provider that is down, refusing, or over its budget is the ordinary case, and this
 * runs on a node that is otherwise working. Throwing would take down a node whose current
 * certificate is still valid for another third of its life. So a failure re-arms at
 * `floorMs` and says nothing, exactly as `topUpRelays` treats a relay that will not take
 * a reservation. The same call, for the same reason.
 *
 * ## What holding this loop costs
 *
 * **The node must keep the user's signing key for as long as it runs.** Enrolment needs
 * an `ownerProof` over the user key, so a node that renews cannot forget that key after
 * start the way a node that enrolled once could. That is a new property and it is stated
 * here rather than discovered later: a shorter certificate lifetime buys revocation reach
 * and pays for it partly in how long the owner's key sits in a running process.
 */

/**
 * How hard a node will press an authority that is refusing or unreachable.
 *
 * Five minutes: long enough that a provider down for an hour sees twelve attempts rather
 * than thousands, short enough that a node still inside its renewal margin gets many
 * chances before the margin runs out. At the thirty-day default the margin is ten days,
 * so this is not the binding number; at a one-hour lifetime the margin is twenty minutes
 * and this gives four attempts inside it.
 */
export const RENEWAL_RETRY_FLOOR_MS = 300_000

export interface CertificateRenewalOptions {
  /** The one cell everything reads the current certificate through. */
  readonly holder: CertificateHolder
  /**
   * Run the enrolment exchange again and return what came back, or `null` on any
   * refusal or unreachability.
   *
   * **A rejection is treated exactly as `null`** and is caught here rather than left to
   * the caller, because the production caller — `resolveCertificate` — signals an ordinary
   * refusal by throwing, and a loop that let that escape would take down a node whose
   * current certificate is still good for another third of its life.
   */
  readonly renew: () => Promise<NodeCertificate | null>
  /**
   * Called after a renewal is accepted into the holder, so the caller can persist it and
   * republish it. **Republishing is not optional**: a registration record outlives the
   * certificate inside it, so a reader verifying that record discards the node from the
   * moment the old certificate expires until something writes a new record.
   */
  readonly renewed: (certificate: NodeCertificate) => void | Promise<void>
  /** Injected so a test can drive this without waiting. Defaults to the real clock. */
  readonly now?: () => number
  /** Defaults to {@link RENEWAL_RETRY_FLOOR_MS}. A test sets it low. */
  readonly retryFloorMs?: number
}

/**
 * Start keeping `holder`'s certificate renewed. Returns the function that stops it.
 *
 * A node holding no certificate is not scheduled: it was never told to enrol, which is a
 * stated configuration rather than a state to recover from.
 */
export function startCertificateRenewal(options: CertificateRenewalOptions): () => void {
  const now = options.now ?? (() => Date.now())
  const floorMs = options.retryFloorMs ?? RENEWAL_RETRY_FLOOR_MS

  let timer: ReturnType<typeof setTimeout> | null = null
  let stopped = false

  const arm = (delayMs: number): void => {
    if (stopped) return
    timer = setTimeout(() => {
      void attempt()
    }, delayMs)
    // Node only, and guarded rather than assumed: a pending timer must not be what keeps
    // a process alive after everything else has finished.
    timer.unref?.()
  }

  const attempt = async (): Promise<void> => {
    if (stopped) return
    const held = options.holder.current
    if (held === null) return

    if (!shouldRenewCertificate(held, now())) {
      arm(msUntilRenewalDue(held, now(), floorMs))
      return
    }

    let obtained: NodeCertificate | null = null
    try {
      obtained = await options.renew()
    } catch {
      // Documented in the header: an exchange that failed is ordinary, and this node is
      // still holding a certificate that has not expired yet.
      obtained = null
    }
    if (stopped) return

    if (obtained !== null && options.holder.replace(obtained)) {
      try {
        await options.renewed(obtained)
      } catch {
        // A failed republish must not stop the loop — the next renewal republishes too,
        // and a node that stopped renewing because a write failed would be worse off.
      }
      const current = options.holder.current
      arm(current === null ? floorMs : msUntilRenewalDue(current, now(), floorMs))
      return
    }

    arm(floorMs)
  }

  const initial = options.holder.current
  if (initial !== null) arm(msUntilRenewalDue(initial, now(), floorMs))

  return () => {
    stopped = true
    if (timer !== null) clearTimeout(timer)
    timer = null
  }
}
