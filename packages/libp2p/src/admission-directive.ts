/**
 * RUN-02 — what a halt is, and who it applies to.
 *
 * ## Why this lives in `@o2/libp2p` and not beside either of its two readers
 *
 * A halt is a **wire shape produced by the hosted tier and read by clients**, which is exactly
 * what `traffic-split.ts` is and why it sits here. `@o2/cloudflare` depends on `@o2/libp2p` and
 * `@o2/net` and does not depend on `@o2/core`; `@o2/browser` depends on all of them. So this is
 * the one package both readers already have, and putting the shape here costs the Worker no new
 * dependency and no new bundle weight.
 *
 * The matcher is written **once**, here, rather than once in the Worker and once in the client.
 * `browser-id.ts` records the reason in the tree's own words: *"Held here as well, it would be
 * one of two sources that had to be kept in agreement, and the one that drifted would be the one
 * nobody tested."* A halt that the object thinks is in force and the tab does not is precisely
 * that drift, and it is the failure this whole requirement exists to prevent.
 *
 * ## Why `region` is a `string` here and a narrower type at the Worker
 *
 * The closed set of object names — `bootstrap-us`, `bootstrap-eu`, `bootstrap-sam` — lives in
 * `@o2/cloudflare`'s `hosted-object.ts`. Importing it here would invert the dependency: the
 * shared wire shape would depend on the tier that produces it, and a browser bundle would pull
 * in the Worker's package to read a label. So the field is a `string` at this layer and
 * `@o2/cloudflare` narrows it against `HOSTED_OBJECT_NAMES` on the way in. The narrowing happens
 * where the closed set is defined; the shape stays where both readers can reach it.
 *
 * ## Why a nullable region rather than an absent field
 *
 * An object deployed without a region label still answers `/self`. `null` is what says *this
 * object is not region-addressable*, which the write path then refuses to address — an
 * unlabelled object refuses every region-addressed write rather than accepting the first one
 * that arrives. Absence has to be readable as absence, not as a match.
 *
 * ## The unknown-version rule, and why it is that way round
 *
 * `versions: 'all'` matches a client whose build stamp could not be read. A version slice —
 * `versions: ['1.2.3']` — does **not**.
 *
 * That asymmetry is the whole of what a slice means. An operator naming a version is naming a
 * population they can describe; a client that cannot say which slice it is in is not in it.
 * Halting it anyway would halt an unknown population under a control whose entire purpose is
 * halting exactly the slice that is misbehaving instead of the whole fabric. The other
 * direction — `'all'` — names every client by construction, including the ones that cannot
 * name themselves, so there is nothing for an unreadable stamp to exclude it from.
 *
 * Both directions have their own case and their own plant in `admission-directive.test.ts`,
 * because a rule stated in a docblock is not a rule anything checks.
 */

/**
 * A halt, its slice, and who set it.
 *
 * Every field is present on every directive, including the one an object with nothing stored
 * reports — see {@link ADMITTING}. A reader never has to decide what a missing field means.
 */
export interface AdmissionDirective {
  /**
   * Which region's object this directive belongs to, or `null` for an object with no label.
   *
   * A `string` rather than the closed set, for the reason in this file's header. The write path
   * in `@o2/cloudflare` narrows it and refuses anything outside the set.
   */
  readonly region: string | null
  /** Whether new tasks are being refused. */
  readonly halted: boolean
  /** Which client versions the halt applies to. `'all'` is every client, readable or not. */
  readonly versions: 'all' | readonly string[]
  /** When the directive was set, in epoch milliseconds, or `null` when nothing set it. */
  readonly since: number | null
  /** The operator's note, so a halted volunteer can be told why. Empty when there is none. */
  readonly note: string
}

/**
 * What an object with no directive stored reports.
 *
 * A **value**, not `null` and not an absent field. A reader that had to decide what absence
 * meant would be a second place the rule was written, and the two would drift. This one is
 * not halted, names no region, slices nothing and carries no note, which is the honest reading
 * of an object nobody has told to stop.
 *
 * `region` is `null` here because the constant cannot know which object read it. The read path
 * attaches this object's own label — see `@o2/cloudflare`'s `readDirective`.
 */
export const ADMITTING: AdmissionDirective = {
  region: null,
  halted: false,
  versions: 'all',
  since: null,
  note: '',
}

/**
 * Does this directive halt a client on `clientVersion`?
 *
 * Total and pure: no clock, no I/O, no throwing. It is called on the client's hot path —
 * `agent.ts:1092` consults `paused` on every request of four kinds — so it does no work beyond
 * a comparison, and it is called on the Worker too, where every millisecond is billed.
 *
 * `clientVersion` is `null` for a client whose build stamp could not be read. See the header
 * for why that answers `true` under `'all'` and `false` under a slice; the short form is that a
 * slice means the slice, and a client that cannot say which slice it is in is not in it.
 */
export function isHaltedFor(
  directive: AdmissionDirective,
  clientVersion: string | null,
): boolean {
  if (!directive.halted) return false
  if (directive.versions === 'all') return true
  if (clientVersion === null) return false
  return directive.versions.includes(clientVersion)
}

/**
 * The version half of a build stamp, as the client computes it.
 *
 * The producer is `packages/browser/vite.config.ts`'s `buildIdentity()`, which answers
 * `` `${released} ${commit}` `` — the root `package.json` version, a space, and a seven-character
 * commit. That string reaches the page as `<meta name="o2-build" content="…">` and reaches this
 * function from there.
 *
 * **The `-dirty` suffix belongs to the commit field and never to the version field.** A build
 * from an edited tree answers `1.2.3 abc1234-dirty`, and the version it should be compared on
 * is `1.2.3` like every other build — a developer tree is not a separate release, and an
 * operator halting `1.2.3` means the developer's tab too. Splitting on the space is what gets
 * that right; anything that read the whole string would put every dirty build in its own slice
 * of one.
 *
 * This exists so the split is written once. `demo/main.ts` and `demo/status.ts` both need it and
 * `buildIdentity()` is a producer this module does not own, so a second parser here would be a
 * second thing to keep in agreement with a format that lives in another package.
 *
 * Answers `null` for `null`, for `''`, and for a string with no readable first field — absence
 * stays readable as absence rather than becoming an empty version that could match a slice.
 */
export function clientVersionFrom(buildIdentity: string | null): string | null {
  if (buildIdentity === null) return null
  const first = buildIdentity.trim().split(/\s+/u)[0]
  if (first === undefined || first === '') return null
  return first
}
