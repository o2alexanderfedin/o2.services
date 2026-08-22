# A certificate exception is keyed to host AND port — in two of the three engine families

**Measured 2026-08-21/22.** Task #24's deciding question:

> After the visitor clicks through the interstitial for `https://host:A`, does that acceptance
> cover `wss://host:B` presenting the SAME certificate on a different port?

**Chromium: yes. Gecko and WebKit: no.** The permissive behaviour is the *Chromium* one, and a
project that tested only there — as this one did at first — would have recorded the question
settled in the wrong direction.

## The reading — four browsers, three engine families

Same harness instance, same two certificates, same ports. Every reading confirmed by screenshot
and attributed by user-agent.

| engine | browser | **same port as page** | same cert, other port | different cert *(control)* |
|---|---|---|---|---|
| Chromium | Chrome 151 | `open` | `open` | `error` |
| Chromium | Edge 151 | `open` | `open` | `error` |
| Gecko | **Firefox 152** | `open` | **`error`** | `error` |
| WebKit | **Safari 26.5.2** | `open` | **`error`** | `error` |

**Same-port opened in all four. Cross-port opened only in Chromium.**

**Three things make this a comparison rather than four anecdotes.**

1. **The control failed in both.** A third port serves a *different* self-signed certificate. If
   it had succeeded, "the socket opened" would be equally consistent with the browser not
   checking certificates on WebSockets at all, and the reading would mean nothing.
2. **Chrome was re-run against the same live instance *after* the Safari reading**, and returned
   `open` again. That rules out the servers having died between readings — the one alternative
   explanation for `error` that has nothing to do with the browser. It was not a hypothetical:
   the harness *was* stopped once mid-sweep, and Edge and Firefox promptly reported
   `ERR_CONNECTION_REFUSED` and "Unable to connect". Those two screens are the tester's own
   server being gone, **not** browser findings, and reading them as engine behaviour would have
   invented a result.
3. **The user-agent is recorded and classified.** An early reading contradicting Chrome could not
   be attributed from the log at all and had to be retaken. The first classifier then labelled
   **Edge as Chrome**, because Edge's user-agent contains both `Edg/` and `Chrome/` — and
   Chrome's contains `Safari/`. Match most specific first, or the instrument quietly merges two
   engines.

`ignoreHTTPSErrors` / `acceptInsecureCerts` were never set. Setting either makes every arm
succeed and measures nothing.

## What it means

**Firefox and Safari key a certificate exception to host *and port*. Chromium keys it to host.**

This is precisely the hazard task #24 named before any of it was measured — *"a WebSocket TLS
failure has no interstitial in any browser, so it fails silently"* — and it does materialise, in
the majority of engines. It simply does not materialise in Chromium, which is why the first round
of measurement missed it and reported the question settled.

For the fabric: a self-signed seed page serving the page on one port and the libp2p WebSocket on
another **works in Chrome and Edge and silently fails in Firefox and Safari**, with no warning
the visitor can act on. The socket just never opens.

## The way out that the finding implies

If the exception is keyed to host *and port*, then a socket on the **page's own port** should be
covered by the click the visitor already made. Node serves both from one `https.Server` — this
is exactly how `ws` attaches — so it costs nothing structurally.

**It holds — in all four**, as the table above records. A socket on the page's own port is
covered by the one click the visitor already made, in every engine tested.

**So one listener is not the safer option. It is the only portable one.** Two of three engine
families refuse the second port outright, and the third's tolerance is a convenience this design
should not depend on.

### What this costs the current design, which is the part that matters

`packages/node/src/seed-server.ts` binds **two** ports today: the Vite page on `httpPort`, and
the libp2p WebSocket listener on `wsPort` (`listen: ['/ip4/0.0.0.0/tcp/${wsPort}/ws', …]`,
`:427`). That is exactly the layout Safari refuses. **Served over self-signed HTTPS as it stands,
a Safari visitor would accept the page and then have the WebSocket fail silently** — no
interstitial, no error the visitor can act on, just a socket that never opens.

So the measurement is not academic: it identifies a concrete defect in the seed server's shape
that would only have appeared on Safari, only over HTTPS, and only as silence.

## Method notes worth keeping

- **Safari's automation mode refuses to click through a certificate warning.** `safaridriver`
  drives real Safari and reaches the warning page fine — ordinary DOM, no native sheet, bypass
  link present and on screen, `warningPageCommand` handler callable — but posting
  `visitInsecureWebsite` returns without throwing and nothing happens. Ten attempts, 20 s of
  polling, plus a full re-navigation. A WebDriver click does nothing either: synthesised clicks
  do not run inline `onclick`. This reads as deliberate. **The click has to be a person's.**
- **One run did get through, and it did not reproduce.** The control that had passed failed on
  re-run. Recorded as an anomaly with nothing built on it — a single unreproduced success is not
  a measurement.
- **The first `button` on Safari's warning page is `#goBackButton`, labelled "Close Page".** A
  probe that clicks "the first button" closes its own tab and then reports the empty document as
  a failed bypass, which reads exactly like Safari refusing automation.
- **Log which browser reported.** The harness did not at first, and a reading came back
  contradicting Chrome that could not be attributed from the log alone. It had to be retaken. An
  unattributed reading from a manual check is barely a reading.
- **Playwright cannot measure any of this.** Its bundled browsers fail the navigation outright
  rather than rendering a click-through interstitial. Chrome readings were taken through
  `channel: 'chrome'` in headed mode; Safari readings by hand.

## Still open

**iOS is untested and is not settled by this.** iOS stores and scopes certificate exceptions
differently from macOS. This answers the *engine* question, not the *phone* question, and that
half still needs a device or a Simulator.
