/**
 * Duty-cycle CPU governor — SCHED-04.
 *
 * A duty cycle, not a scheduler priority. BOINC's `% CPU` works this way — 75%
 * means compute 3 units then idle 1 — because it is the only form of throttling
 * that is portable and that actually reduces heat and battery draw. Neither a
 * browser tab nor a Node process can change its own scheduler priority, so this
 * is the control that exists everywhere.
 *
 * Building it into the kernel now is deliberate: retrofitting a CPU cap into a
 * scheduler that assumes it may use a whole core is a rewrite, not a patch.
 *
 * The port takes a `sleep` function rather than calling `setTimeout` directly,
 * so the kernel stays free of platform globals and tests need no real waiting.
 *
 * ## Why the cap is settable at all
 *
 * SCHED-04 asks for a governor that is **user-adjustable**, and until this plan
 * `dutyCycle` was a `readonly` field assigned once in the constructor. That is
 * why the requirement stood **Partial** from Phase 6: a value that can only be
 * chosen at construction is a configuration, not a control. `setDutyCycle` is
 * the mechanism the requirement always named, and the reading it moves is a
 * getter, so nothing has to be rebuilt for a change to take effect.
 *
 * ## Why the composition is a minimum and not a product
 *
 * Both numbers are ceilings on the **same** thing — the fraction of wall time
 * this node may compute — so the binding one is the smaller. A product would
 * make two independent ceilings multiply into a third nobody chose: a user cap
 * of 0.5 on a tab already throttled to 0.1 would give 0.05, a rate neither the
 * user nor the tab asked for. Worse, it would break the argument
 * `visibility-governor.ts` is written around — its background floor is small but
 * deliberately **positive**, because a hidden tab must throttle rather than stop
 * or a task in flight never gets another slice. A product drives that floor
 * toward zero the moment any cap is applied on top of it; a minimum cannot,
 * because the result is always exactly one of the two values a governor chose.
 *
 * ## Why `environment` is required, with a named absence
 *
 * `.planning/PROJECT.md`'s key decision — an optional hook with a silent default
 * is a hole — and here the hole has a shape. A Node-tier node has no visibility
 * signal and nothing else that would drive a second ceiling, so its answer is
 * genuinely "nothing but the user's cap binds this node". A browser tab's answer
 * is its `VisibilityGovernor`. Left optional, a missing field would read the
 * same in both cases, and "this node has no environment signal" would be
 * indistinguishable from "somebody forgot to pass the tab's governor" — a
 * throttle silently not applied, which is the failure a background tab exists to
 * prevent. The call site writes which it means.
 *
 * ## A cap bounds starting, never running
 *
 * `GovernedExecutor` yields **between** tasks and never inside one
 * (`net/src/governed-executor.ts`), because a WASM call cannot be suspended
 * part-way. So lowering the cap slows what is started next and cannot abandon
 * what is already running. That is the same property the browser tier's positive
 * floor exists to protect, and it is why a cap of any legal value is safe to
 * apply at any moment — there is no state to unwind and no in-flight grant to
 * retract. `LocalCapacity` states the other half of it for slots.
 */

import type { Governor } from './ports.ts'

export type Sleep = (ms: number) => Promise<void>

export interface DutyCycleOptions {
  /**
   * The user's cap, in (0, 1]. The starting value of
   * {@link DutyCycleGovernor.setDutyCycle}, and subject to the identical range
   * check — the constructor and the setter route through one validator so the
   * two cannot disagree about what a legal cap is.
   */
  readonly dutyCycle: number
  /** Length of one compute slice in ms. */
  readonly sliceMs?: number
  readonly sleep: Sleep
  /**
   * A second governor whose duty cycle also binds, or `'no-environment-governor'`
   * when nothing but the cap does.
   *
   * The reading is the **lower** of the two and is taken live from both, so an
   * environment source that changes under this object — a tab being backgrounded
   * — is honoured without anything being rebuilt or re-registered.
   *
   * Required rather than optional, and the sentinel is the reason: see the
   * class note above.
   */
  readonly environment: Governor | 'no-environment-governor'
}

/**
 * The legal range, in one place.
 *
 * Written as a positive predicate so every kind of nonsense falls out of the
 * same expression rather than needing its own arm: `NaN > 0` is false, so is
 * `-Infinity > 0`, and `Infinity <= 1` is false. Nothing is clamped — 18-01
 * recorded what a clamp costs, which is that an operator's mistake becomes a
 * differently-configured node that reports success and nobody chose.
 */
function checkDutyCycle(value: number, field: string): number {
  if (!(value > 0 && value <= 1)) {
    throw new RangeError(`${field} must be in (0, 1], got ${value}`)
  }
  return value
}

export class DutyCycleGovernor implements Governor {
  #dutyCycle: number
  readonly #sliceMs: number
  readonly #sleep: Sleep
  readonly #environment: Governor | 'no-environment-governor'

  constructor(options: DutyCycleOptions) {
    const { dutyCycle, sliceMs = 50, sleep, environment } = options
    this.#dutyCycle = checkDutyCycle(dutyCycle, 'dutyCycle')
    this.#sliceMs = sliceMs
    this.#sleep = sleep
    this.#environment = environment
  }

  /**
   * The duty cycle in force right now: the lower of the user's cap and the
   * environment's, read from both on every access.
   *
   * A getter rather than a field because both halves move. The cap moves through
   * `setDutyCycle`, and the environment's own reading moves under this object
   * without telling it — `VisibilityGovernor.dutyCycle` is itself a getter
   * driven by a `visibilitychange` event. Anything that cached this would be
   * reporting a rate that was true when it was captured.
   *
   * The upper half of the port's stated (0, 1] range holds structurally: the
   * result is a minimum with a validated cap on one side, so it can never exceed
   * the cap. The lower half is the environment's own contract — the `Governor`
   * port states the range, both implementations check it at construction, and
   * restating the rule here would be a second place for it to live and drift.
   */
  get dutyCycle(): number {
    if (this.#environment === 'no-environment-governor') return this.#dutyCycle
    return Math.min(this.#dutyCycle, this.#environment.dutyCycle)
  }

  /**
   * The cap this governor was **set to**, before any environment is composed in.
   *
   * `dutyCycle` above is what the node *runs at*; this is what its operator or its
   * visitor *asked for*. On a node with no environment governor the two are the same
   * number, and the distinction only becomes visible on a tier that has one.
   *
   * **It exists because the two answer different questions and one caller needs the
   * second.** A slot count is a statement about what a node will *accept*; an
   * environment throttle is a statement about how fast it runs what it *already
   * accepted*. A backgrounded tab should finish what it took on and merely run it
   * slower, which is BROW-03; it should not start refusing work it had already
   * advertised capacity for.
   *
   * **Stated as reasoning, not as a measurement**, because the obvious measurement was
   * attempted and came back negative. Feeding the composed value to `LocalCapacity` does
   * arithmetically collapse a backgrounded tab to one slot — `floor(8 × 0.05)` is 0 and
   * the count floors at 1 — but removing that coupling did *not* fix the BROW-03 failure
   * that prompted this, so it was not the cause. The cause was `yieldSlice` bypassing the
   * environment's own accounting; see the note there. The distinction below is kept on
   * its merits, and no test in this repository currently fails when it is collapsed —
   * which is worth knowing before relying on it.
   *
   * So a capacity reads this, and the executor reads {@link dutyCycle}. A user lowering
   * their own cap does narrow what the node accepts, which is what SCHED-04 asks for;
   * the window manager backgrounding a tab does not.
   */
  get ownDutyCycle(): number {
    return this.#dutyCycle
  }

  /**
   * Set the user's cap on a running governor — SCHED-04's *user-adjustable* half.
   *
   * Takes effect on the next `yieldSlice`, which is the next task boundary,
   * because that is the only place a duty cycle can be applied at all. There is
   * no window in which the old value is still in force: `yieldSlice` reads the
   * getter rather than a captured number.
   *
   * Refuses anything outside (0, 1] through the same validator the constructor
   * uses, and refuses it **without** having changed anything, so a rejected call
   * leaves the node running at the cap it already had.
   */
  setDutyCycle(value: number): void {
    this.#dutyCycle = checkDutyCycle(value, 'dutyCycle')
  }

  /**
   * Idle for the off-portion of one duty cycle.
   *
   * At d = 1 this resolves without sleeping at all, so an unthrottled node pays
   * nothing for the governor's existence. The reading is taken once here and
   * used for both the test and the arithmetic, so a change arriving mid-call
   * cannot produce an off-period computed from two different rates.
   */
  async yieldSlice(): Promise<void> {
    const duty = this.dutyCycle
    if (duty >= 1) return
    // **When the environment is the binding constraint, the environment does the
    // yielding.** Not an optimisation — composing by taking the lower of two rates and
    // then sleeping *here* silently bypasses whatever the environment's own yield does
    // besides sleep, and at least one implementation does more than sleep.
    //
    // Measured: `VisibilityGovernor` accrues `sleptMs`, which is the reading BROW-03
    // uses to prove a backgrounded tab paid its throttle rather than merely being
    // configured for one. Wrapping it without this branch left that counter at 0 while
    // the tab really was being paced — `background-tab.e2e.test.ts` went red on
    // `expected 0 to be greater than 0` with the pacing itself perfectly correct. An
    // instrument that stops being written is indistinguishable from a throttle that
    // stopped happening, and only one of those is survivable.
    //
    // `<=` rather than `<` so that when the two are equal the environment still owns the
    // yield: at that point it is a binding constraint too, and the tie should go to the
    // object whose accounting somebody is reading.
    if (this.#environment !== 'no-environment-governor' && this.#environment.dutyCycle <= this.#dutyCycle) {
      await this.#environment.yieldSlice()
      return
    }
    const offMs = this.#sliceMs * (1 / duty - 1)
    await this.#sleep(offMs)
  }

  /** Advertised capacity scales with the duty cycle, so placement sees the truth. */
  get advertisedCapacity(): number {
    return this.dutyCycle
  }
}
