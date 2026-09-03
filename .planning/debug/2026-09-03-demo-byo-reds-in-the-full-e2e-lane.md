---
status: fixing
trigger: "On develop at 5909969 a full `npx vitest run --project e2e` gives 13 failed / 303 passed (316); 12 of 13 are in packages/node/src/demo-byo.e2e.test.ts. The same file passes 17/17 alone. Before the merge the lane was 62 files / 315 tests all passing."
created: 2026-09-03
updated: 2026-09-03
---

## Current Focus

reasoning_checkpoint:
  hypothesis: "34 e2e specs build Vite dev servers with no `cacheDir`, so they all share `node_modules/.vite`. Two Vite servers optimising that cache concurrently make the loser's live pages request dep modules under a stale `browserHash`; Vite answers 504 Outdated Optimize Dep, the page's module graph dies, `window.o2` never appears, and demo-byo reds 12-13 of 17 on a quiet host."
  confirming_evidence:
    - "NATURAL reproduction, no forcing: `rm -rf node_modules/.vite/deps` then two ordinary `vitest run --project e2e <file>` processes started together -> demo-byo 13 failed / 4 passed EXIT=1, demo-pi 10/10 passed, host quiet 1.00/0.86 (ceiling 4.00)."
    - "The first console line of the failing run is Vite's own error for exactly this race: `504 (Outdated Optimize Dep)`, followed by `page.waitForFunction: Timeout 60000ms` on `typeof window.o2 !== undefined`."
    - "Three of the reported assertion texts reproduce verbatim, including `byo/partitions is not on the bring-your-own surface at all: expected undefined to be defined`."
    - "The same lane is 62/62 files and 316/316 tests GREEN at the reported-red commit 5909969, with demo-byo green in 4012 ms — so the merge is not the cause."
    - "MEASURED: a funnel beacon against a libp2p /ws port is answered `400 Only WebSocket connections are supported` in 18.7 ms, so the hypothesis handed to me has no black hole to starve with."
  falsification_test: "Give each vitest invocation its own Vite cacheDir and re-run the IDENTICAL natural-race command. If demo-byo still reds, or a `504 (Outdated Optimize Dep)` line still appears, the mechanism is not what is claimed."
  fix_rationale: "The defect is that a per-invocation resource is stored at a shared, fixed path. The fix keys the path to the invocation (`process.ppid`, measured identical across files within one run and distinct across concurrent runs), so each Vite server owns its optimiser cache and cannot invalidate another's live pages. It removes the collision rather than bounding its effect, and it is correct against ANY concurrent Vite server rather than against the specific pair that was measured."
  blind_spots: "I did not replay the user's own red run; I demonstrated the mechanism and found its residue (two `deps_temp_*` written 81 s after the merge commit) in that run's window. Attribution is therefore mechanism-plus-residue, not a replay. I have not measured whether a THIRD concurrent Vite server outside the e2e project (vitest browser mode, an ad-hoc `vite dev`) can still collide — it cannot collide with e2e after this change, because e2e no longer uses `node_modules/.vite` at all, but two non-e2e servers still can."

hypothesis: see reasoning_checkpoint above — confirmed.
test: per-invocation Vite cacheDir for every e2e fixture server, then the identical natural-race command.
expecting: both files green, zero `504 (Outdated Optimize Dep)` lines, two distinct `.vite-e2e-<pid>` directories written.
next_action: add `fixtureViteCacheDir` to packages/node/src/e2e-browser-launch.ts and pass it at all 34 call sites.

## Symptoms

expected: 62 files / 315-316 tests all passing on `npx vitest run --project e2e`
actual: 13 failed / 303 passed (316); 12 in `packages/node/src/demo-byo.e2e.test.ts`, 1 in `lease-expiry.e2e.test.ts` (known load-sensitive)
errors: |
  Error: page.evaluate: TimeoutError: signal timed out
  TimeoutError: page.fill: Timeout 30000ms exceeded.
  AssertionError: byo/partitions is not on the bring-your-own surface at all: expected undefined to be defined
reproduction: `npx vitest run --project e2e` on develop@5909969. Passes 17/17 when the file is run alone.
started: with merge 5909969, which brought 2576408 "the funnel targets the relay the tab started with"

## Eliminated

## Evidence

- timestamp: 2026-09-03 orientation
  checked: vitest.config.ts, e2e project block (line 1417)
  found: e2e runs `fileParallelism: false` — one file at a time, single worker.
  implication: Cross-file CPU/socket contention from PARALLELISM is ruled out by construction. Whatever differs between "alone" and "full lane" must be ACCUMULATED state across sequentially-run files, or host load from leaked processes.

- timestamp: 2026-09-03 orientation
  checked: packages/node/src/demo-byo.e2e.test.ts openPage() (lines 134-151) and beforeAll (259-282)
  found: every tab is opened with `?relay=<loopback /ip4/127.0.0.1/tcp/<port>/ws multiaddr>` and consents by clicking `#allow`. The relay is a FabricNode listening on `/ip4/127.0.0.1/tcp/0/ws`.
  implication: after 2576408 every tab in this file derives funnel target `http://127.0.0.1:<relayport>/funnel` and beacons to a port that serves libp2p websockets only.

- timestamp: 2026-09-03 orientation
  checked: packages/browser/src/funnel-reporter.ts beaconSendPort (432-457)
  found: sendBeacon first; on false, `fetch(endpoint, {method:'POST', keepalive:true})` with the rejection swallowed. No timeout, no AbortSignal.
  implication: a request that is accepted at TCP level and never answered is never abandoned by the client.

- timestamp: 2026-09-03 read-only
  checked: git diff --stat ab6b268 5909969
  found: the ONLY production files changed in the whole merge range are packages/browser/demo/main.ts (+36) and packages/browser/src/funnel-reporter.ts (+220). Everything else is spec.
  implication: whatever the merge broke, it broke through the demo page the e2e tabs load. Blast radius is two files.

- timestamp: 2026-09-03 read-only
  checked: packages/node/src/e2e-browser-launch.ts docblock
  found: this exact signature is on record — "planting the flag into demo-byo.e2e.test.ts alone and restoring it: 12 failed in 235.13 s -> 17 passed in 6.48 s". The recorded cause was tab-to-tab WebRTC dial failure via Chromium mDNS host-candidate obfuscation, and the docblock states this host "resolves those names in some windows and not others".
  implication: "12 failed in demo-byo" is a KNOWN signature of tab-to-tab dial failure, and it has previously been host-dependent rather than code-dependent. The merge is not the only candidate explanation and must be established, not assumed.

- timestamp: 2026-09-03 read-only
  checked: packages/libp2p/src/libp2p-transport.ts:418 and packages/browser/src/kill-switch.ts:194
  found: "TimeoutError: signal timed out" is the DOMException from AbortSignal.timeout. kill-switch's poll swallows it (catch). libp2p-transport's #sendTimeoutMs signal does not.
  implication: "page.evaluate: TimeoutError: signal timed out" is a FABRIC SEND timing out inside the page, i.e. tab-to-tab traffic failing — the same class as the mDNS history above, not a page-startup failure.

- timestamp: 2026-09-03 read-only, PRIMARY SOURCE
  checked: node_modules/@libp2p/websockets/dist/src/listener.js:300-304 and :86-122
  found: the WS listener sniffs the first byte, hands non-upgrade sockets to an http.Server whose request handler is `res.writeHead(400); res.write('Only WebSocket connections are supported'); res.end()`.
  implication: **THE BLACK-HOLE HYPOTHESIS IS REFUTED AT THE SERVER.** A funnel POST to a libp2p /ws port is answered 400 immediately; it is not accepted-and-never-answered. So it cannot occupy a connection slot indefinitely and cannot starve anything. Still to confirm empirically with a real POST at a real FabricNode.

- timestamp: 2026-09-03 14:33-14:49, THE REPRODUCTION
  checked: `npx vitest run --project e2e` on a clean tree at 59099691f4dabc56a7eb363c3259c958bc19f6f2 (= 5909969, the commit reported red), under /usr/bin/time -p
  found: |
    Test Files  62 passed (62)
    Tests       316 passed (316)
    Duration    977.57s     real 978.32  user 695.07  sys 175.19   -> (user+sys)/real = 0.89
    [host conditions] host was quiet — load/core 0.49 before, 0.91 after (8 cores, ceiling 4.00)
    EXIT=0
    packages/node/src/demo-byo.e2e.test.ts (17 tests) 4012ms  — PASSED, in four seconds
  implication: **THE REGRESSION DOES NOT REPRODUCE.** Not "passes slowly", not "passes alone" — the whole
    lane is green at the reported-red commit, and the file at the centre of the report is green in 4.0 s
    inside that lane. One red run and one green run of the same commit is an INTERMITTENT failure, not a
    regression, unless a second variable is found.

- timestamp: 2026-09-03, from the green lane's own stderr
  checked: grep for `net::ERR_FAILED` in the green run's log
  found: the funnel beacons fail loudly in at least fourteen specs (many-tabs, two-tabs, owner-domain-tabs,
    peer-ledger, demo-* ...) — `[tab-0] console: Failed to load resource: net::ERR_FAILED` — and every one
    of those specs PASSED.
  implication: the beacons are demonstrably compatible with a fully green lane. Combined with the 400 the
    WS listener answers, the "beacons starve the page" hypothesis is refuted twice over: the requests do
    not hang, and the lane is green while they fire.

- timestamp: 2026-09-03
  checked: node_modules/.vite
  found: three orphan `deps_temp_*` directories, two of them written within the same minute (Sep 3 13:58,
    i.e. between the merge at 13:55 and this investigation's run at 14:33). Every e2e spec builds its own
    `createServer({ root: ROOT })`, and all 62 of them share one `cacheDir` = node_modules/.vite.
  implication: an orphan `deps_temp_*` is the residue of a dep re-optimisation that was interrupted or
    raced. Two Vite servers on one cacheDir re-optimise and force `[vite] optimized dependencies changed.
    reloading` in the page — which resets `window.o2`, drops the consent click, and presents as exactly
    the three reported errors (page.fill timeout, a surface region missing, a fabric send timing out).
    This is a candidate for what the red run had that the green run did not.

- timestamp: 2026-09-03
  checked: packages/node/src/funnel-attribution.e2e.test.ts:135-170, and `ps aux | grep -iE workerd|wrangler`
  found: `newArm()` spawns `npx wrangler dev ...` and stops it with `worker.kill('SIGTERM')`, which signals
    the `npm exec wrangler` process only. A full orphan chain was live on this host before any of my runs:
    `npm exec wrangler` -> `node .bin/wrangler dev` -> `wrangler cli.js` -> 2x `workerd serve`, holding
    127.0.0.1:8795 LISTEN.
  implication: a real process leak, unrelated to the reported reds but belonging in the report. The merge
    added a sixth `newArm()` call (ARM 6), so it makes the leak one chain worse per lane run.

- timestamp: 2026-09-03, MEASURED (not read)
  checked: `npx tsx probe-ws-post.mjs` — a real FabricNode on /ip4/127.0.0.1/tcp/0/ws, then fetch()
  found: |
    relay addr /ip4/127.0.0.1/tcp/51669/ws/p2p/12D3KooWK3ZN...
    POST -> status 400 in 18.7ms body="Only WebSocket connections are supported"
    GET  -> status 400 in  2.5ms body="Only WebSocket connections are supported"
    relay stopped cleanly
  implication: the funnel beacon against a libp2p WS port is answered and closed in ~19 ms. There is no
    accepted-and-never-answered request, so there is nothing to occupy a connection slot and nothing to
    starve. The hypothesis under investigation is refuted by behaviour, not by a code reading.

- timestamp: 2026-09-03, THE CAUSE — INDUCED, then REPRODUCED WITHOUT FORCING
  checked: |
    (1) control: demo-byo alone -> 17/17 pass, wall clock 21.23 s, EXIT=0
    (2) induced: demo-byo alone while a second Vite server on the same root force-re-optimised deps
        29 times -> 13 failed / 4 passed, wall clock 66.76 s, host quiet 1.35/1.46
    (3) NATURAL, no forcing at all: `rm -rf node_modules/.vite/deps`, then TWO ordinary
        `npx vitest run --project e2e <one file>` processes started together (demo-byo + demo-pi)
  found: |
    (3) demo-byo -> **13 failed | 4 passed (17)**, EXIT=1, wall clock 64.69 s,
        [host conditions] host was quiet — load/core 1.00 before, 0.86 after (8 cores, ceiling 4.00)
        demo-pi (the other process) -> 10/10 passed.
    The first console line of the failing run is Vite's own:
        [a] console: Failed to load resource: the server responded with a status of 504 (Outdated Optimize Dep)
    followed by `page.waitForFunction: Timeout 60000ms exceeded` on `typeof window.o2 !== "undefined"`,
    then every downstream case failing in 0-4 ms, including the reported
        AssertionError: byo/partitions is not on the bring-your-own surface at all: expected undefined to be defined
        AssertionError: byo/egress   is not on the bring-your-own surface at all
        AssertionError: byo/failures is not on the bring-your-own surface at all
  implication: |
    ROOT CAUSE. All 34 e2e specs that build a page call `createServer({ root: ROOT, ... })` with no
    `cacheDir`, so all of them share ONE dependency-optimiser cache, `node_modules/.vite`. When two Vite
    servers optimise it at the same time — which happens whenever the cache is cold or invalidated and two
    vitest processes overlap — the winner replaces `deps/` and the `browserHash` with it. Pages served by
    the loser then request their dep modules under a hash that no longer exists and Vite answers
    **504 Outdated Optimize Dep**. The page's module graph dies, `window.o2` never appears, and the file
    with the most page-driven assertions collapses to 12-13 reds while the host stays quiet. It is a race
    on a shared build cache, not load, not the network, and not the funnel.

- timestamp: 2026-09-03, ATTRIBUTION
  checked: stat of node_modules/.vite/deps_temp_* against `git log` commit times
  found: |
    2026-09-03 13:58:25  deps_temp_b81080df
    2026-09-03 13:58:26  deps_temp_3b89eb13
    2026-09-02 19:25:30  deps_temp_b1f01abb
    2026-09-02 19:25:31  deps_temp_e7dbd6b6
    merge 5909969 was committed 2026-09-03 13:57:04.
  implication: an orphan `deps_temp_*` is the residue of a re-optimisation that lost the rename race. They
    come in PAIRS ONE SECOND APART — two servers optimising at once — and one such pair was written
    **81 and 82 seconds after the merge commit**, i.e. inside the window of the reported red run. An
    identical pair exists from the day BEFORE the merge. So the mechanism is recurrent, it predates
    5909969, and its residue is present at the scene of the red run.

- timestamp: 2026-09-03, THE FIX, AND THE PLANT
  checked: |
    `fixtureViteCacheDir(root)` added to packages/node/src/e2e-browser-launch.ts and passed as `cacheDir`
    at all 34 e2e call sites. Key is `process.ppid` — MEASURED first: two files of one invocation both
    reported `ppid=8115`; the next invocation reported `ppid=8162` for both. One cache per lane, a
    different one per concurrent lane.
  found: |
    | build                                    | driver                        | result |
    |---|---|---|
    | control: demo-byo alone                  | none                          | 17 passed, 21.23 s |
    | develop (shared cache), NATURAL race     | a second `vitest run` process | **13 failed / 4 passed**, first console line `504 (Outdated Optimize Dep)` |
    | branch (fixed), same NATURAL race        | a second `vitest run` process | **17 passed**, zero 504, two dirs `.vite-e2e-12271` and `.vite-e2e-12276` |
    | branch, fix PLANTED back to `.vite`      | none (plain second process)   | 17 passed — **the plant stayed green**, the natural race did not fire that attempt |
    | branch, fix PLANTED, forced racer        | 29 forced re-optimisations    | **13 failed / 4 passed**, EXIT=1, host quiet 0.77/0.60, observed text below |
    | branch, RESTORED, same forced racer      | 30 forced re-optimisations    | **17 passed**, EXIT=0, zero 504, host quiet 0.62/0.67 |
    observed plant text:
      Failed to load resource: the server responded with a status of 504 (Outdated Optimize Dep)
      Tests  13 failed | 4 passed (17)
    restore: surgical inverse of the one planted line, `cmp` against a snapshot taken immediately before
    planting -> CMP_EXIT=0, byte-identical.
  implication: |
    The claim is carried by the FORCED-racer pair, not by the natural one. The natural race is
    timing-dependent — it fired on develop and did not fire on the very next attempt with the fix planted
    — so a plant that relies on it can leave the file green without the defect being absent. Said here
    rather than hidden, because a green that was not watched fail proves nothing.

- timestamp: 2026-09-03, A SECOND HAZARD, NOT THIS ONE AND NOT INTRODUCED BY THE FIX
  checked: on the fixed branch, demo-pi run concurrently with demo-byo
  found: demo-pi failed 5 of 10 with `page.evaluate: TimeoutError: signal timed out` at
    `window.o2.dial(addr)` — a tab-to-tab WebRTC dial — and **zero** 504 lines. demo-pi ALONE on the same
    branch: 10/10, 5.52 s, host quiet.
  implication: two e2e files run concurrently put two Chromiums doing tab-to-tab WebRTC on one host, which
    is the failure class `e2e-browser-launch.ts` already documents as host-window-dependent. The cacheDir
    fix does not address it and does not claim to. It is masked on the unfixed tree because whichever file
    loses the optimiser race dies before it ever dials. **Do not read this fix as making concurrent e2e
    lanes safe** — it makes them safe from ONE specific collision.

## Resolution

root_cause: |
  A race on the SHARED Vite dependency-optimiser cache, `node_modules/.vite`. Every e2e spec that serves
  the demo page calls `createServer({ root: ROOT, logLevel: 'error', server: { port: 0 } })` with no
  `cacheDir`, so 34 specs share one cache. Two Vite servers optimising it concurrently (cold or
  invalidated cache + two overlapping vitest processes in this shared working tree) leave the losing
  server's live pages requesting dep modules under a stale `browserHash`; Vite answers `504 Outdated
  Optimize Dep`, the page's module graph fails, `window.o2` never appears, and demo-byo — the spec with
  the most page-driven assertions — reds 12-13 of 17 while the host stays quiet.
  **The merge 5909969 is NOT the cause and is exonerated by measurement**: the full lane is 62/62 files
  and 316/316 tests green at that exact commit, with demo-byo green in 4012 ms.
fix: per-invocation Vite `cacheDir` for every e2e fixture server — see files_changed.
verification: |
  - full `--project e2e` at 5909969: 62/62, 316/316, EXIT=0, 977.57 s, host quiet 0.49/0.91
  - control demo-byo alone: 17/17, EXIT=0
  - natural race (no forcing): demo-byo 13 failed / 4 passed, EXIT=1, host quiet 1.00/0.86, first console
    line `504 (Outdated Optimize Dep)`
files_changed:
  - packages/node/src/e2e-browser-launch.ts (fixtureViteCacheDir + pruner)
  - 33 packages/node/src/*.e2e.test.ts (cacheDir argument + import)
  - packages/cloudflare/src/stop-closes-the-billed-socket.e2e.test.ts (cacheDir inlined, no cross-package import)
