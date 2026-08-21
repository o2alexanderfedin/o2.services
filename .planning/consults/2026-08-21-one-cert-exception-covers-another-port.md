# One accepted certificate exception does cover `wss://` on another port — in Chrome

**Measured 2026-08-21.** Task #24 named one question as deciding its trade and said it was
*"checkable rather than arguable"*:

> after the visitor clicks through the interstitial for `https://macbook.local:PORT`, does
> that exception cover `wss://macbook.local:OTHER_PORT` presenting the SAME cert?

It has now been run. **In Google Chrome: yes.**

## The method, and why it needed real Chrome

Two self-signed certificates were generated for this host's own name
(`Alexanders-MacBook-Pro.local`), with distinct SHA-256 fingerprints. Three servers:

| port | serves | cert |
|---|---|---|
| A | the HTTPS page | **X** |
| B | a WebSocket server | **X** — same cert, different port |
| C | a WebSocket server | **Y** — a different self-signed cert |

A browser was launched with **no** `ignoreHTTPSErrors` — that flag would have destroyed the
measurement by making every arm succeed. A fresh context was navigated to `https://host:A`,
the interstitial was clicked through, and the page then opened `wss://host:B` and
`wss://host:C` from its own origin.

**Port C is the negative control and it is the reason this reading means anything.** Without
it, "the WSS connected" is equally consistent with the browser simply not enforcing
certificates on WebSockets.

## The result, three runs

    interstitial: clicked-through
    wss same cert, other port : open     x3
    wss different cert        : error    x3

**One interstitial covered both endpoints.** The exception is keyed per host, not per host
and port, and it carries from an `https://` navigation to a `wss://` connection. The control
failed every time, so the probe can distinguish the two cases.

## A method note worth keeping

**Playwright's bundled browsers cannot measure this at all.** All three — chromium, firefox
and webkit, headless *and* headed — fail the navigation outright rather than rendering a
click-through interstitial; Chromium lands on `chrome-error://chromewebdata/` with
`net::ERR_CERT_AUTHORITY_INVALID` and an empty body. Automation builds suppress the
interstitial because `ignoreHTTPSErrors` is the intended path.

The reading was therefore taken against **real Google Chrome**, driven through Playwright's
`channel: 'chrome'` in headed mode with a temporary profile. Anyone re-running this must do
the same or they will measure Playwright's launch flags rather than a browser's behaviour.

## What this does NOT establish, and it is the half that matters most

**iOS Safari is unmeasured, and the phone in task #24's scenario is most likely iOS Safari.**

This is not an oversight to be closed later from this machine: Playwright's `webkit` is not
Safari — it is a build of WebKit with different UI and no clickable interstitial — and
Playwright cannot drive real Safari at all, on the desktop or on a device. Nothing available
here can answer for iOS.

So the honest state of the trade:

- **Chrome (desktop, measured):** the self-signed arm costs **one** interstitial click, and
  the silent-WebSocket-failure hazard #24 identified does **not** materialise.
- **iOS Safari (unmeasured):** unknown. If its exception is scoped more tightly, the
  self-signed arm on a phone is not "one warning" but "install and trust a CA profile",
  which #24 correctly calls a different product decision.

**The remaining measurement needs a real iPhone on this LAN**, which is a physical device
this machine does not have — not a limit of effort. It is one manual test: serve the two
ports, open the page in mobile Safari, accept the warning, and see whether the socket
connects.

## What does not change

Nothing in the tree. This is a reading, not a build. The AutoTLS arm still requires opening a
router port (`@libp2p/upnp-nat`) plus NAT hairpinning for a same-LAN phone, and that remains
an outward-facing change for the owner to authorise rather than an agent to make.
