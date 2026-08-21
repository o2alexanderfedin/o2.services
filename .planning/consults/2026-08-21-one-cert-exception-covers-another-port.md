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

---

## CORRECTION 2026-08-21 — "nothing available here can answer for iOS" was too strong

The section above closes with *"Playwright cannot drive real Safari at all, on the desktop or
on a device. Nothing available here can answer for iOS."* The first sentence is true. **The
second does not follow from it, and it was written as though it did** — a limit of one tool
restated as a limit of the host. That is the same shape as the stale claims of absence
corrected in task #41, and it survived here for the same reason: nobody asked what a
*different* tool could do.

**`safaridriver` ships inside Safari and speaks W3C WebDriver over plain HTTP.** It needs no
Playwright, no npm dependency and no install — Node's `fetch` is a sufficient client. Measured
on this host:

    /System/Cryptexes/App/usr/bin/safaridriver -p 4499
    curl -s http://127.0.0.1:4499/status
    {"value":{"message":"","ready":true}}

**The driver is already enabled here — `ready: true`, no `sudo` needed.** So real Safari, which
is real WebKit with Safari's real certificate-exception UI, is one step from being drivable on
this machine, and the earlier claim that nothing here could speak to WebKit was wrong.

### The actual wall, which is one checkbox and not a device

A session request against real Safari returns:

    session not created: You must enable 'Allow remote automation' in the
    Developer section of Safari Settings to control Safari via WebDriver.

That toggle cannot be set from a shell. Safari's preference container is TCC-protected:

    ls ~/Library/Containers/com.apple.Safari/Data/Library/Preferences/
    ls: ... : Operation not permitted

So `defaults write` cannot reach it, and the setting is a security-relevant permission on the
owner's own browser — not something to flip unattended even if it were writable. The probe is
written and waiting at `certprobe/safari-probe.mjs`; it reuses the same two certificates and the
same three-port design, and deliberately sets `acceptInsecureCerts: false`, which is Safari's
equivalent of `ignoreHTTPSErrors` and would destroy the measurement exactly as that flag would.

**Owner action, roughly ten seconds:** Safari → Settings → Advanced → "Show features for web
developers", then Develop → "Allow Remote Automation". Then re-run the probe.

### What it would and would not settle — stated before the reading, not after

macOS Safari is **not** iOS Safari, and this correction does not claim otherwise. What it would
answer is the *engine* half of the deciding question — whether WebKit's click-through exception
is keyed per host or per host **and port**, and whether it carries from an `https://` navigation
to a `wss://` connection. Chrome answered yes to both. WebKit is the family the phone in this
task's scenario belongs to, and its answer is currently **unknown rather than unobtainable**.

What would still be untested afterwards: iOS's own trust UI, which differs from macOS's in how
exceptions are stored and scoped. That half still needs a phone or a Simulator. But it is a
smaller remainder than "nothing here can answer", and it is worth having the desktop reading
before spending an owner's ~10 GB Xcode install on the mobile one.
