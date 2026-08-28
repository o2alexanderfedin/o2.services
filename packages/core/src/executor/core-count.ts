/**
 * How many tasks this host can genuinely run at once — one reading, both tiers.
 *
 * ## Why `navigator.hardwareConcurrency` and not `os.cpus().length`
 *
 * `@o2/core` is the portable kernel: it is imported by the browser tier, the Node tier
 * and the Cloudflare tier, so it may not import `node:os` at all. That is not a style
 * rule — a static `node:os` import makes this module unloadable in a browser bundle,
 * which is the same failure `workerd-shims.ts` records paying for once with
 * `node:process`.
 *
 * `navigator.hardwareConcurrency` is the one spelling every target shares.
 * **Measured rather than taken from documentation**, which is this project's standing
 * rule for platform claims:
 *
 * ```
 * node v23.11.0  typeof globalThis.navigator === 'object'
 *                navigator.hardwareConcurrency === 8
 *                os.cpus().length              === 8
 * ```
 *
 * The two agree on this host. They are not the same question in general — `os.cpus()`
 * counts logical CPUs the OS reports, `hardwareConcurrency` is what the runtime says a
 * worker pool should be — and where they disagree the runtime's answer is the one a
 * worker pool wants. A caller that specifically wants the OS figure still has it:
 * `packages/node` may read `os.cpus().length` and pass it in explicitly.
 *
 * ## Read lazily, never at module scope
 *
 * `STACK.md`'s embedded-target rule: *"Do all environment detection lazily inside the
 * factory, never at module scope, or the `default` export condition will crash on
 * import."* So this is a function and not a constant, and nothing here runs until
 * somebody asks.
 *
 * ## What the fallback is, and why it is 1 rather than a guess
 *
 * Three real cases produce no reading: a runtime with no `navigator` at all, one that
 * has `navigator` without the field, and one that reports a value that is not a
 * positive integer. In every one of them the honest answer is *"this host will not say"*,
 * and the safe response to that is to run one task at a time. A guessed 4 would be a
 * number nobody measured, quietly sizing a pool on a machine that might have one core —
 * and over-committing cores is precisely the failure the pool exists to prevent.
 *
 * A caller who knows better overrides it. A caller who does not gets a node that is
 * slow rather than a node that thrashes.
 */

/** The pool size used when the host will not say how many cores it has. */
export const UNKNOWN_CORE_COUNT_FALLBACK = 1

/** As much of `navigator` as this file reads — declared narrowly, like `ShimScope`. */
interface NavigatorLike {
  readonly hardwareConcurrency?: unknown
}

/**
 * The host's usable core count, or {@link UNKNOWN_CORE_COUNT_FALLBACK} if it will not say.
 *
 * Never returns zero or a fraction: a pool sized at zero accepts no work at all, which
 * is a node that has left the fabric rather than a node going slowly — the same floor,
 * and the same reason, as `LocalCapacity.slots`.
 */
export function hostCoreCount(scope: { readonly navigator?: NavigatorLike } = globalThis): number {
  const reported = scope.navigator?.hardwareConcurrency
  if (typeof reported !== 'number') return UNKNOWN_CORE_COUNT_FALLBACK
  if (!Number.isInteger(reported) || reported < 1) return UNKNOWN_CORE_COUNT_FALLBACK
  return reported
}
