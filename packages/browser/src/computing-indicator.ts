/**
 * The indicator a visitor can see when they are not looking at this tab — BROW-07.
 *
 * ## Why the title, and why nothing on the page
 *
 * Criterion 2 of Phase 35 rules the page body out in its own sentence: *"Page-body content
 * alone is watched failing the criterion, because a backgrounded tab shows none of it."* A
 * visitor who has switched to another tab sees exactly two things belonging to this one — the
 * favicon and the title, both rendered by the browser's chrome in the tab strip. So the
 * indicator has to live in `document.title` or it is not an indicator for the case the
 * requirement is about.
 *
 * There is a second, independent reason, and it is about what can be *proved* rather than what
 * is nice: `background-tab.e2e.test.ts:16-42` records that **Chromium under automation never
 * reports a page as hidden** — *"`page.bringToFront()` changes nothing and fires no
 * `visibilitychange`, in headless and headed mode… There is no CDP visibility override
 * either."* Any indicator conditioned on `document.hidden`, `visibilityState` or
 * `TabActivity.hidden` would therefore be untestable in the very harness the criterion names.
 *
 * **So the decoration is unconditional, and that is the requirement rather than a shortcut.**
 * A tab computing while it is in front should say so too. Conditioning the indicator on being
 * hidden would mean the only state anybody can check by looking at the screen is the state in
 * which the indicator is switched off.
 *
 * ## What it costs the surface catalogue: nothing
 *
 * `document.title` is browser chrome. It carries no `data-region`, it is not a figure, and
 * `packages/browser/src/demo-regions.ts`'s `UI_SPEC_TALLY` does not move for it — which is
 * also why this design was chosen over a body element, whose addition would move five things
 * in one commit (`REGIONS`, three tally fields, and UI-SPEC §4.x plus §12).
 *
 * ## Portable, in `consent.ts`'s shape
 *
 * The title arrives as a **port**, so this module never names `document` and can be driven in
 * the `node` project with no DOM — the same arrangement `ConsentStore` uses for storage, and
 * for the same stated reason: *"a module that reads browser globals when it is loaded cannot
 * be imported by a Node test at all."* Nothing here touches a global at import time.
 *
 * ## Not in the barrel, deliberately
 *
 * `packages/browser/src/index.ts` does not export this, on `gateway-module.ts`'s precedent and
 * for its stated reason: the demo's `window.o2` hop is not traced by
 * `reachability-guard.node.test.ts`, so a barrel entry would add an exported-but-statically-
 * unreachable symbol in front of that guard for no benefit to any consumer. `demo/main.ts`
 * imports it by relative path, exactly as it imports `gateway-module.ts`.
 */

/**
 * Where the indicator is written.
 *
 * Both halves are needed. `set` alone would force this module to remember a base title it
 * could not check, and a page that changed its own title would then be silently overwritten
 * with a stale one.
 */
export interface TitlePort {
  get(): string
  set(value: string): void
}

/**
 * What is prepended while work is in flight.
 *
 * A glyph **and words**, because the criterion asks for an indicator that *"says the tab is
 * computing"* and a bare dot says nothing to somebody who has not read the documentation. The
 * glyph leads because a tab strip truncates from the right, so the first characters are the
 * ones that survive a narrow tab; the words follow for a visitor who hovers, and for the
 * accessibility tree, which reads the whole string.
 *
 * The trailing separator is part of the constant rather than added at the join, so that
 * {@link ComputingIndicator} can strip an already-decorated title by one `slice` and cannot
 * disagree with itself about where the base begins.
 */
export const COMPUTING_TITLE_PREFIX = '● Computing — '

/** The prefix with nothing after it, for a caller that needs to look for it. */
export function isComputingTitle(title: string): boolean {
  return title.startsWith(COMPUTING_TITLE_PREFIX)
}

/**
 * Decorate the tab title while tasks are running, and restore it exactly when they stop.
 *
 * ## Idempotence is the defect this class of code always has
 *
 * The naive version appends on every report and the title grows a glyph per task. So there is
 * no internal counter and no append: {@link report} is told the whole truth — how many tasks
 * are in flight — and computes the title the page should have from scratch. Reporting `1`
 * five times leaves the title where reporting it once did, and there is no state that can
 * drift from the count.
 *
 * ## Why the base is re-read rather than remembered once
 *
 * A page may change its own title for reasons that have nothing to do with computing. If the
 * base were captured at construction and never revisited, restoring at zero would put back a
 * title the page had deliberately moved on from. So each report reads the current title, and
 * treats it as the new base **unless it is this module's own decoration** — which is the one
 * value that must not be mistaken for something the page chose.
 */
export class ComputingIndicator {
  readonly #title: TitlePort
  #base: string

  constructor(title: TitlePort) {
    this.#title = title
    this.#base = undecorated(title.get())
  }

  /** The title that will be restored at zero. Exposed so a spec can assert it, not decoration. */
  get base(): string {
    return this.#base
  }

  /**
   * Say how many tasks are in flight, and let the title follow.
   *
   * A negative count is treated as zero rather than refused: this is a display, and a caller
   * that has miscounted should get an undecorated title, not an exception thrown from a
   * repaint.
   */
  report(inFlight: number): void {
    const current = this.#title.get()
    // Anything that is not our own decoration is the page's own title, whenever it arrived.
    if (!isComputingTitle(current)) this.#base = current
    const wanted = inFlight > 0 ? `${COMPUTING_TITLE_PREFIX}${this.#base}` : this.#base
    // Compared before writing: assigning `document.title` fires a mutation the browser acts
    // on, and rewriting the identical string on every poll is work a backgrounded tab should
    // not be doing.
    if (current !== wanted) this.#title.set(wanted)
  }
}

/**
 * The title with this module's decoration removed, if it is there.
 *
 * Exists for the constructor's sake: a page whose title already begins with the prefix — a
 * restored session, a bug, a second indicator — must not end up double-decorated, and the only
 * way to guarantee that is to define the base as *whatever is left after the prefix*.
 */
function undecorated(title: string): string {
  return isComputingTitle(title) ? title.slice(COMPUTING_TITLE_PREFIX.length) : title
}

/**
 * A {@link TitlePort} over the real document.
 *
 * Resolved **lazily**, inside the function, for `localConsentStore`'s reason: module-scope
 * environment detection is what breaks the `default` export condition for a host application,
 * and it is also what would stop this file being importable by a Node-lane spec.
 */
export function documentTitlePort(): TitlePort {
  return {
    get: () => globalThis.document.title,
    set: (value: string) => {
      globalThis.document.title = value
    },
  }
}
