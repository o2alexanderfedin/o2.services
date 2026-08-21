/**
 * How the e2e fixtures launch a browser, and the one Chromium flag they all pass.
 *
 * **This module is test-only**, on `capability-fixture.ts`'s terms and for its reason: it
 * is imported by relative path from the e2e specs and is deliberately **not** re-exported
 * from `packages/node/src/index.ts`, so it hands Phase 22's reachability guard no export
 * to trace to an entry point.
 *
 * ## What it does
 *
 * Chromium replaces host ICE candidates with ephemeral `<uuid>.local` names
 * (`WebRtcHideLocalIpsWithMdns`) so that a page cannot read the machine's LAN address.
 * A peer that receives one must resolve it over mDNS to get a usable candidate pair.
 * When that resolution does not work, two tabs on one machine are left with only their
 * server-reflexive candidates — and srflx↔srflx between two tabs behind one public IP
 * needs NAT hairpinning. The dial then times out rather than failing fast, because
 * nothing has gone *wrong* at any single layer.
 *
 * **This host resolves those names in some windows and not others**, which is the part
 * that matters here. On 2026-08-19 a probe dialled successfully 6 times out of 6 with the
 * obfuscation left on (`2026-08-19-e2e-webrtc-dial-red.md`, second amendment); on
 * 2026-08-21 the same mechanism fails every time. So the flag is not repairing something
 * permanently broken — it is removing a dependency on a host condition that comes and
 * goes, and which that file spent a day failing to attribute.
 *
 * `--disable-features=WebRtcHideLocalIpsWithMdns` restores the real host candidate, and
 * the pair forms locally.
 *
 * ## The measurements, both taken 2026-08-21
 *
 * Measured **outside this repository first**, so the reading is of the browser and not of
 * any code here: a bare `RTCPeerConnection` and one data channel between two Chromium
 * contexts, no libp2p and no o2 source
 * (`.planning/consults/2026-08-21-chromium-mdns-ice-blocks-tab-to-tab.md`).
 *
 * | mDNS obfuscation | candidates offered | result |
 * |---|---|---|
 * | on (Chromium default) | `<uuid>.local` host + srflx | `failed` after 30 s |
 * | off (this flag) | host `10.144.82.249` + srflx | **connected in 225 ms** |
 *
 * Then on the real gate, by planting the flag into `demo-byo.e2e.test.ts` alone and
 * restoring it: **12 failed in 235.13 s → 17 passed in 6.48 s**. The passing run was read
 * rather than counted — 3 distinct peer ids, 6 shards across 2 replicas, 21 egress frames
 * over 7130 bytes, provenance refusals present — because a suite that goes green by
 * skipping is the failure this repo has already been caught by once.
 *
 * ## What this costs, stated plainly
 *
 * The flag trades incidental coverage of Chromium's mDNS candidate resolution for a
 * deterministic gate. **Same-LAN production dials still depend on that mechanism** — the
 * phone-and-laptop topology the LAN demo is *about* exchanges obfuscated candidates for
 * real — and after this change nothing here tests it. That is a real reduction in what the
 * suite covers, recorded here rather than absorbed silently, because "descoped is not
 * satisfied".
 *
 * It is worth taking because the alternative is worse in the way this repo's conventions
 * name directly: leaving it in makes every browser-tab spec's result depend on whether the
 * host's local network happens to permit mDNS multicast that day, which is an absolute
 * reading that "silently encodes the machine, the load and the I/O weather of the day it
 * was written".
 *
 * **The underlying fault is the host's, not this repository's.** It was bisected before it
 * was fixed: `demo-byo` fails identically at `a75750a` and at `50a9cb1`, three readings,
 * 12 failed each time. Two tabs of the actual demo in a real browser on this machine
 * cannot dial each other right now, and this flag shields only the gate.
 *
 * ## Why the dispatch is on `type.name()`
 *
 * The flag is Chromium's, and several fixtures launch from a `BrowserType` table that also
 * holds firefox and webkit. Passing a Chromium switch to Firefox's command line is not a
 * no-op, so it is applied by name. Firefox's lever is a pref rather than a switch.
 *
 * ## Firefox: refused at 02:35, applied at 04:45, on the SAME DAY — and that is the point
 *
 * This section read *"deliberately not set here — because it was measured and refused"*,
 * citing a cross-engine probe at 02:35 on 2026-08-21 in which `webkit <-> firefox` opened in
 * 1134 ms with obfuscation left on. **That measurement was correct and it is now false.**
 * Two hours later the same bare-`RTCPeerConnection` probe, firefox to firefox, no repo code:
 *
 * | `media.peerconnection.ice.obfuscate_host_addresses` | candidates offered | result |
 * |---|---|---|
 * | `true` (Firefox default) | `<uuid>.local` host + srflx `99.142.76.66` | `failed` after 30 s |
 * | `false` (set here) | host `10.144.82.249` + srflx | **connected in 87 ms** |
 *
 * Nothing in this repository changed between those two readings. The host did — which is
 * exactly what the top of this file already claims about Chromium (*"resolves those names in
 * some windows and not others"*) and what `2026-08-19-e2e-webrtc-dial-red.md` spent a day
 * failing to attribute. Firefox was never immune; it was measured during a good window.
 *
 * **So the earlier refusal is not being overturned as a mistake — it is being overturned by a
 * later measurement of a variable the first reading could not see.** It is left described
 * above rather than deleted, because a reader who finds only the current answer cannot tell
 * that this host's mDNS is intermittent, and that is the single most useful fact here.
 *
 * The cost stated for Chromium applies identically to Firefox: same-LAN production dials
 * still depend on mDNS candidate resolution, and after this change nothing in the gate
 * exercises it on either engine.
 *
 * **Webkit is left alone.** It was not measured failing, Playwright's webkit exposes no
 * equivalent pref through `launch`, and applying a fix to an engine with no demonstrated
 * fault is what this file just got caught doing in the other direction.
 */

import type { Browser, BrowserType, LaunchOptions } from 'playwright'

/** Chromium's switch for offering the real host ICE candidate instead of a `.local` name. */
export const SHOW_LOCAL_ICE_CANDIDATES = '--disable-features=WebRtcHideLocalIpsWithMdns'

/** Firefox's equivalent, as a pref rather than a command-line switch. */
export const FIREFOX_SHOW_LOCAL_ICE_CANDIDATES: Readonly<Record<string, boolean>> = {
  'media.peerconnection.ice.obfuscate_host_addresses': false,
}

/**
 * Launch a browser for an e2e fixture, with the flag applied to chromium and to nothing else.
 *
 * A caller's own `args` are preserved and appended, so a fixture that already had a reason
 * to pass a switch keeps it.
 */
export async function launchFixtureBrowser(
  type: BrowserType,
  options: LaunchOptions = {},
): Promise<Browser> {
  if (type.name() === 'chromium') {
    return type.launch({ ...options, args: [SHOW_LOCAL_ICE_CANDIDATES, ...(options.args ?? [])] })
  }
  if (type.name() === 'firefox') {
    // Merged under the caller's prefs rather than over them, so a fixture that deliberately
    // sets this pref for its own reasons still wins — the same courtesy `args` gets above.
    return type.launch({
      ...options,
      firefoxUserPrefs: { ...FIREFOX_SHOW_LOCAL_ICE_CANDIDATES, ...(options.firefoxUserPrefs ?? {}) },
    })
  }
  return type.launch(options)
}

/**
 * The same args for a caller that needs a persistent context rather than a browser.
 *
 * `launchPersistentContext` returns a `BrowserContext`, not a `Browser`, so it cannot go
 * through {@link launchFixtureBrowser}; it takes the args directly instead.
 */
export function chromiumFixtureArgs(extra: readonly string[] = []): string[] {
  return [SHOW_LOCAL_ICE_CANDIDATES, ...extra]
}
