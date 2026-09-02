/**
 * Stage four's observable, which did not exist anywhere in this repository — RUN-04.
 *
 * ## What was already here, and why it is not this
 *
 * `start-probe.ts:38-49` reads `globalThis.RTCPeerConnection` to answer `webrtc: boolean`. That
 * is a **capability** question — *does this browser have WebRTC* — asked once before the node
 * starts. Nothing observed ICE **gathering**, which is a different fact about a different
 * moment: whether this visitor's browser, on this network, actually got as far as looking for
 * candidates. A funnel that skipped it would report the gap between "has WebRTC" and "got a
 * connection" as one drop with no attribution, which is precisely what criterion 2 forbids.
 *
 * ## Why a wrapper, and what it must not change
 *
 * libp2p constructs its own `RTCPeerConnection` instances inside `BrowserNode.start`; nothing
 * hands them out. So the only place to observe them is the constructor, and the wrapper's whole
 * obligation is to be invisible: it extends the original, calls it, adds one listener, and
 * changes nothing else. **Install order is load-bearing** — a wrapper installed after libp2p has
 * built its connections observes nothing at all, and would report a clean zero for a stage that
 * fired.
 *
 * ## Idempotent and removable, and both are requirements rather than manners
 *
 * Idempotent because two installs would wrap the wrapper and report twice for one connection.
 * Removable because a spec cannot run two cases in one file over a global it cannot put back —
 * and because a page that stops the node should leave the tab as it found it.
 *
 * Nothing here touches a global at import time; the globals arrive as an argument, in
 * `consent.ts`'s shape and for its stated reason.
 */

/** The one global this module wraps, declared so a spec can supply a fake. */
export interface IceGlobals {
  RTCPeerConnection?: unknown
}

/** What an observed connection has to be, as narrowly as this module uses one. */
interface Observable {
  readonly iceGatheringState?: string
  addEventListener?: (type: string, listener: () => void) => void
}

/**
 * Marks a constructor this module already wrapped.
 *
 * A symbol rather than a property name, so nothing a page or a library sets can be mistaken for
 * it and the wrapper cannot be un-marked by a shallow copy.
 */
const INSTALLED = Symbol.for('o2.iceObserverInstalled')

/**
 * Watch for the first ICE gathering this tab starts. Answers how to stop watching.
 *
 * `onGathering` is called **once**, on the first transition into `gathering` across every
 * connection this tab makes. Later transitions and later connections report nothing, because
 * the funnel counts visits and not connections: a tab that dials six peers reached stage four
 * once.
 *
 * Answers a no-op remover when there is no `RTCPeerConnection` to wrap — which is Safari in
 * some configurations, a Node lane, and any embedding host without WebRTC. A browser with no
 * WebRTC never reaches stage four, and reporting that as a stall at stage three is the truthful
 * reading rather than a gap.
 */
export function installIceObserver(
  onGathering: () => void,
  globals: IceGlobals = globalThis as IceGlobals,
): () => void {
  const original = globals.RTCPeerConnection
  if (typeof original !== 'function') return () => {}
  // Already wrapped. Returning a no-op rather than wrapping again: a second wrapper would add a
  // second listener to every connection and report the same visit twice.
  if ((original as unknown as Record<symbol, unknown>)[INSTALLED] === true) return () => {}

  let reported = false
  const Wrapped = class extends (original as new (...args: never[]) => Observable) {
    constructor(...args: never[]) {
      super(...args)
      const self = this as Observable
      // Some hosts expose a peer connection without `addEventListener`. Reporting nothing is
      // the honest outcome; throwing here would break the node for the sake of the instrument.
      self.addEventListener?.('icegatheringstatechange', () => {
        if (reported) return
        if (self.iceGatheringState !== 'gathering') return
        reported = true
        onGathering()
      })
    }
  }
  Object.defineProperty(Wrapped, INSTALLED, { value: true })
  // The wrapped constructor keeps the original's name, so anything that reads it — a log line,
  // a feature probe, a library's own branching — cannot tell the difference.
  Object.defineProperty(Wrapped, 'name', { value: (original as { name: string }).name })
  globals.RTCPeerConnection = Wrapped

  return () => {
    // Only if it is still ours. Another install between here and there would otherwise be
    // reverted by this remover, which is the shape `CLAUDE.md` records for reverting a file you
    // did not write.
    if (globals.RTCPeerConnection === Wrapped) globals.RTCPeerConnection = original
  }
}
