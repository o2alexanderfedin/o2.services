/**
 * The ICE observer, installed **at module evaluation** — and the reason is measured.
 *
 * ## The finding this module exists for
 *
 * `ice-observer.ts` wraps `globalThis.RTCPeerConnection`, and `demo/main.ts` first called it
 * inside `api.start()`, a few lines before `BrowserNode.start`. That is early enough for
 * anything that reads the global when it *constructs* a connection, and `@libp2p/webrtc` does
 * not. Read out of `node_modules/@libp2p/webrtc/dist/src/webrtc/index.browser.js`, which is the
 * file that package's `browser` field substitutes for the Node one:
 *
 * ```js
 * export const RTCPeerConnection = globalThis.RTCPeerConnection;
 * ```
 *
 * **A `const`, captured when the module evaluates.** `initiate-connection.js` and
 * `private-to-private/transport.js` then do `new RTCPeerConnection(...)` against that binding,
 * so they hold the constructor the page had at bundle-load time and never look at the global
 * again. A wrapper installed later is invisible to them, permanently.
 *
 * **It was measured rather than reasoned about.** With the install inside `start()`, two real
 * browser contexts completed a genuine browser-to-browser WebRTC dial — the dial succeeded and
 * each tab held the other as a peer — and `ice-gathering` stayed at **0**. That is the plant
 * that could not fail, arriving as a real red rather than as a false green, and it is why this
 * file exists instead of the call being moved a few lines up.
 *
 * ## Why an import for its side effect, and why it must be FIRST
 *
 * ES modules evaluate in import order and import statements are hoisted above every statement
 * in the importing module. So there is **no line of `demo/main.ts` that can run early enough** —
 * the only thing that evaluates before `@libp2p/webrtc` is a module imported before it. This is
 * the same problem, and the same repair, as `packages/cloudflare/src/workerd-shims.ts`, whose
 * own header records what it cost to learn: that module was correct, tested, and imported by
 * nothing, so the deployed node threw on its first inbound dial while every spec stayed green.
 *
 * ## The callback arrives later, and gathering that already happened is not lost
 *
 * The funnel reporter needs the page URL, which needs the page. So this module installs
 * immediately and holds the answer: {@link onFirstIceGathering} fires straight away if
 * gathering has already been seen by the time a listener is registered. Without that, moving
 * the install earlier would simply relocate the race.
 *
 * ## Safe to import in a Node lane
 *
 * `installIceObserver` reads `globalThis.RTCPeerConnection`, finds nothing to wrap, and answers
 * a no-op — which `ice-observer.test.ts` asserts directly. Reading an absent global and saying
 * so is not the thing `consent.ts`'s rule forbids; requiring one is.
 */

import { installIceObserver } from './ice-observer.ts'

let gatheringSeen = false
let listener: (() => void) | null = null

// THE SIDE EFFECT. Runs when this module evaluates, which is the whole point of the file.
installIceObserver(() => {
  gatheringSeen = true
  listener?.()
})

/**
 * Be told about the first ICE gathering this tab starts.
 *
 * Fires immediately if it has already happened. One listener; a second replaces the first,
 * because there is one funnel and a second registration would be a second reporter.
 */
export function onFirstIceGathering(notify: () => void): void {
  if (gatheringSeen) {
    notify()
    return
  }
  listener = notify
}
