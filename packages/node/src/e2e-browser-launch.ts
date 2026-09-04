import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
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

import type { Browser, BrowserType, LaunchOptions, Page } from 'playwright'

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


// ─────────────────────────────────────────────────────────────────────────────────────────────
// NET-12 — the loopback TURN server the Phase 34 e2e fixtures spawn.
//
// **Why it lives in this file rather than its own.** It is a spec-only harness of exactly the
// class this module already is, and the reachability guard counts orphan *modules* — a module
// with no production importer — rather than exports. A separate `coturn-harness.ts` would have
// been a 33rd orphan against a ceiling of 32, and this phase is not permitted to raise that
// ceiling. Giving it a production importer would have been fake wiring, and inlining it into the
// two specs that use it would have put two copies of the spawn flags in the tree — with
// `--allow-loopback-peers`, below, being precisely the line two copies would let drift.
// ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * A real RFC 5766 TURN server, on loopback, for the duration of one spec — NET-12.
 *
 * ## Why a real server and not a fake
 *
 * Criterion 1 says *a credential captured from one session is refused after its stated
 * lifetime*. A fake would refuse it because this repository told it to, which measures nothing:
 * the lifetime a minter states is a **claim**, and the clock that decides whether a credential
 * still works belongs to the TURN server. `coturn` is what turns the claim into an observation.
 *
 * Its **log is the outside instrument**, and it plays the role the gateway server's request log
 * played in Phase 35: a reading taken at the server rather than asserted by the thing under
 * test. {@link CoturnHarness.allocations} and {@link CoturnHarness.refusals} parse it for the
 * two facts the arms need.
 *
 * ## This harness does NOT mint
 *
 * It holds coturn's lifecycle and reads coturn's log, and that is all. Credentials are minted by
 * `@o2/cloudflare`'s `sharedSecretMinter` — the module the hosted tier actually uses — reached
 * from a spec by the test-only relative import this repository sanctions
 * (`packages/net/src/distributed.test.ts`'s note; `packages/node` does not declare
 * `@o2/cloudflare` as a workspace dependency and this phase does not add one for a test).
 *
 * That is deliberate and it was very nearly the other way. A harness with its own mint would be
 * a second implementation of the same agreement, and the two drifted immediately: the first
 * draft here built a two-part username while the production minter builds three parts. A spec
 * standing on the harness's copy would then have proved coturn accepts *the harness*, which is
 * not a claim anybody needs.
 *
 * ## What was measured before anything was built on it, 2026-09-02
 *
 * `coturn 4.17.2`. Chromium **does** allocate against a loopback TURN server — this was not
 * assumed, it was probed first, because the whole of criterion 1 stands on it:
 *
 * ```
 * candidate:185922738 1 udp 50339839 127.0.0.1 64682 typ relay raddr 0.0.0.0 rport 0 …
 * session 007000000000000001: new, realm=<o2.invalid>, username=<1788403690:smoke>, lifetime=600
 * session 007000000000000001: … incoming packet ALLOCATE processed, success
 * ```
 *
 * And the refusals, also measured rather than assumed: an **unauthenticated** Allocate answers
 * `0x0113` error `401` — the same reading the provider probe took against Cloudflare — while an
 * expired credential and a wrong-secret credential are **observationally identical**, both
 * producing `check_stun_auth: Cannot find credentials of user <…>` and `error 401:
 * Unauthorized`. That identity matters and is recorded here so nobody reads more out of an
 * arm than it can carry: *expired* is not distinguishable from *bad HMAC* by the error text.
 * What separates them is that the **same minter** with a future expiry works in the same run.
 *
 * ## The fence
 *
 * `--listening-ip=127.0.0.1 --relay-ip=127.0.0.1`, a fresh port per run, `--no-tls --no-dtls
 * --no-cli`, and a secret generated per run with `randomBytes` that is never written to a
 * tracked file. **A coturn bound to a LAN address is an open relay on somebody's network.**
 */

export interface CoturnHarness {
  readonly port: number
  /** The `use-auth-secret` shared secret. The worker under test is given the same value. */
  readonly secret: string
  readonly realm: string
  /** Every `turn:` URL a client should be handed for this server. */
  readonly urls: readonly string[]
  /** Usernames this server logged a successful allocation for. */
  allocations(): readonly string[]
  /**
   * Usernames this server answered `401` to.
   *
   * An **unauthenticated** Allocate carries no username and appears here as an **empty string**,
   * because coturn logs it as `user <>`. Said exactly rather than approximately: an earlier
   * draft of this line promised `null` entries, which this function never produces, and a
   * comment is not a specification.
   */
  refusals(): readonly string[]
  /** Everything the server has said, for a failure message that needs the raw text. */
  log(): string
  stop(): void
}

/** The line coturn prints once its UDP listener is up. Matched rather than slept on. */
const READY_PATTERN = /listener opened on/i

/**
 * Start a loopback `coturn` and answer a handle to it.
 *
 * **Fails loudly when `turnserver` is absent**, with the install command in the text. A skip
 * would be a vacuous green, and this repository does not take them.
 */
export async function startCoturn(options: { readonly port?: number } = {}): Promise<CoturnHarness> {
  const port = options.port ?? 30_000 + Math.floor(Math.random() * 20_000)
  const secret = randomBytes(24).toString('hex')
  const realm = 'o2.invalid'

  const child: ChildProcess = spawn(
    'turnserver',
    [
      // Loopback only, both legs. This is the fence, not a preference.
      '--listening-ip=127.0.0.1',
      '--relay-ip=127.0.0.1',
      `--listening-port=${String(port)}`,
      '--no-tls',
      '--no-dtls',
      '--no-cli',
      // The scheme under test: a username carrying its own expiry, HMAC'd with a shared secret.
      '--use-auth-secret',
      `--static-auth-secret=${secret}`,
      `--realm=${realm}`,
      '--no-multicast-peers',
      // MEASURED, not copied from a guide. Without this coturn ALLOCATES happily — the client
      // gets a `typ relay` candidate and the log says `ALLOCATE processed, success` — and then
      // silently refuses to relay to the peer, because both peers' relay addresses are on
      // 127.0.0.1 and loopback peers are denied by default. The symptom is the worst kind: the
      // allocation reading is green, so every instrument says TURN is working, and the pair
      // simply never forms. On a real deployment peers are not on loopback and this flag is
      // neither needed nor wanted; it is here because the whole arrangement is on one machine.
      '--allow-loopback-peers',
      // Verbose enough to log allocations and their usernames — the outside instrument.
      '--verbose',
      '--simple-log',
      '--log-file=stdout',
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  )

  let log = ''
  child.stdout?.on('data', (chunk: Buffer) => (log += chunk.toString()))
  child.stderr?.on('data', (chunk: Buffer) => (log += chunk.toString()))

  let spawnError: Error | null = null
  child.on('error', (cause: Error) => (spawnError = cause))

  await new Promise<void>((resolve, reject) => {
    const deadline = Date.now() + 15_000
    const poll = setInterval(() => {
      if (spawnError !== null) {
        clearInterval(poll)
        reject(
          new Error(
            `could not start 'turnserver': ${String(spawnError)}\n` +
              `coturn is REQUIRED by this spec and a skip would be a vacuous green. Install it:\n` +
              `  brew install coturn\n` +
              `(verified 2026-09-02 as coturn 4.17.2, bottled.)`,
          ),
        )
        return
      }
      if (READY_PATTERN.test(log)) {
        clearInterval(poll)
        resolve()
        return
      }
      if (Date.now() > deadline) {
        clearInterval(poll)
        reject(new Error(`coturn did not report a listener within 15 s. Its output was:\n${log}`))
      }
    }, 100)
  })

  return {
    port,
    secret,
    realm,
    // Both ports the provider was measured answering on cannot be offered by one local server,
    // so the shape under test is one entry carrying the URLs this server actually serves. The
    // arrangement is what is being proved, not the port numbers.
    urls: [`turn:127.0.0.1:${String(port)}?transport=udp`],
    allocations: () =>
      [...log.matchAll(/user <([^>]*)>: incoming packet ALLOCATE processed, success/g)].map(
        (match) => match[1] ?? '',
      ),
    refusals: () =>
      [...log.matchAll(/user <([^>]*)>: incoming packet .*error 401/g)].map((match) => match[1] ?? ''),
    log: () => log,
    stop: () => {
      child.kill('SIGTERM')
    },
  }
}


// ─────────────────────────────────────────────────────────────────────────────────────────────
// The Vite dependency-optimiser cache the e2e fixtures serve their pages from.
//
// **Why it lives in this file rather than its own.** Same reason the coturn harness above does:
// it is a spec-only harness, and the reachability guard counts orphan *modules* rather than
// exports. A separate `e2e-vite-cache.ts` would have been one more orphan against a ceiling this
// phase is not permitted to raise.
// ─────────────────────────────────────────────────────────────────────────────────────────────

/** The prefix every per-invocation cache directory carries. Matched by the pruner below. */
const FIXTURE_VITE_CACHE_PREFIX = '.vite-e2e-'

/** Prune runs once per process; a second call in the same spec file would be pure I/O. */
let pruned = false

/**
 * Where ONE `vitest run` invocation keeps its optimised dependencies — MEASURED 2026-09-03.
 *
 * ## The defect this closes, and it is a false-finding defect rather than a slow one
 *
 * Thirty-four e2e specs build a page with `createServer({ root: ROOT, ... })` and none of them
 * named a `cacheDir`, so every one of them shared Vite's default `node_modules/.vite`. That is a
 * **per-invocation resource stored at a fixed path**, and two Vite servers optimising it at once
 * is not hypothetical on a machine where more than one lane runs: the winner replaces `deps/` and
 * the `browserHash` with it, and the loser's already-loaded pages then ask for dep modules under a
 * hash that no longer exists. Vite answers **`504 Outdated Optimize Dep`**, the page's module
 * graph dies, `window.o2` never appears, and the spec reds somewhere far away from the cause.
 *
 * **Reproduced without forcing anything**: `rm -rf node_modules/.vite/deps`, then two ordinary
 * `npx vitest run --project e2e <one file>` processes started together.
 *
 * | run | result | first console line |
 * |---|---|---|
 * | `demo-byo` alone, control | **17 passed**, 21.23 s | — |
 * | `demo-byo` racing `demo-pi` on the shared cache | **13 failed / 4 passed**, 64.69 s | `504 (Outdated Optimize Dep)` |
 * | `demo-pi`, the other process | 10 passed | — |
 *
 * The host was quiet for all three — `load/core 1.00 before, 0.86 after` against a ceiling of 4.00
 * on the failing one — so this is a race on a build cache and not contention. It presented as
 * twelve reds inside `demo-byo.e2e.test.ts` and was read as a regression in a merge that had
 * nothing to do with it; that merge's full lane is 62/62 files and 316/316 tests green.
 *
 * ## Why `process.ppid` and not a random id
 *
 * The key has to be **one value for every file of one lane** — otherwise each of 34 specs pays a
 * cold optimise instead of one per run — **and a different value for a lane running beside it**.
 * `process.ppid` is exactly that, and it was measured rather than assumed: two files in one
 * invocation reported `ppid=8115` and `ppid=8115`, and the next invocation reported `ppid=8162`
 * for both. A random id would fail the first half; a constant would fail the second.
 *
 * **This is not a rule saying "do not run two lanes".** Such a rule would be the special case: it
 * would leave the collision in place and ask people to avoid it. Naming the resource after the
 * invocation that owns it removes the collision, and it does so against *any* concurrent Vite
 * server rather than against the particular pair that was measured.
 *
 * The cost, stated rather than discovered: each invocation now starts from a cold optimiser cache
 * once — about 15 s by the control readings above — instead of inheriting the previous run's.
 */
/**
 * Write a pre-AUTH-06 plaintext identity seed into a tab's identity database — AUTH-06.
 *
 * ## Why a fixture plants one, and what the tab it produces actually is
 *
 * Since AUTH-06 the demo page passes `identityProtection: { kind: 'writes-no-new-secret' }`,
 * because a visitor is asked for no passphrase and the only alternatives were to write a key
 * in the clear or to demand a passphrase from somebody who came to look at a page. A cold
 * visitor's tab is therefore a **different node on every visit**.
 *
 * Two fixtures read a property that needs one node across two starts through `window.o2`, and
 * neither can be handed a passphrase: `TabApi` carries no parameter for one, and
 * `demo/main.ts` states the rule that forbids adding it — *a page that was found rather than
 * configured must not be configurable by whatever found it*. `42-04` is where a visitor is
 * asked and where that changes.
 *
 * So the tab those fixtures open is **the one visitor who does still hold a durable identity
 * under `writes-no-new-secret`: a returning visitor whose browser already held a key from
 * before AUTH-06.** `IdbIdentityStore.legacyPlaintextSeed` finds it, `BrowserNode` adopts it,
 * reports `identityIsUnprotected` and says so once on the console, and **does not delete it** —
 * threat T-42-20, accepted as residue because deleting somebody's identity for want of a
 * passphrase they were never asked for is worse than the exposure it closes.
 *
 * That makes this the **only end-to-end reading of that adopt path in the repository**, which
 * is coverage arriving rather than a fixture convenience. The expected `console.warn` from the
 * adopt path is not forwarded by the fixtures' handlers, which pass only `console.error`.
 *
 * ## The three ways this goes wrong, each one already met once
 *
 * - **Version 1 AND the upgrade.** `indexedDB.open(name, 1)` on a database that does not exist
 *   creates it — and without `onupgradeneeded` creating the `identity` object store, the store
 *   that opens it next finds version 1, runs no upgrade, and every transaction throws
 *   `NotFoundError: 'identity' is not a known object store name`.
 * - **The seed crosses as JSON.** Playwright serialises `page.evaluate` arguments, so a
 *   `Uint8Array` arrives as `{"0":…}`. It travels as a number array and is rebuilt in the page,
 *   the same conversion `capability-harness.ts` records at the same seam.
 * - **Exactly 32 bytes.** A wrong-length record is returned as stored — deliberately, so a
 *   corrupted one throws by name rather than becoming a different working identity — and the
 *   start would then die in `identityFromSeed`, which looks like a defect in the code under
 *   test rather than in the fixture.
 *
 * Call it after the page is open and **before the first start**.
 */
export async function plantLegacyIdentitySeed(
  page: Page,
  blockstoreName: string,
  seed: Uint8Array,
): Promise<void> {
  if (seed.length !== 32) {
    throw new Error(`a planted identity seed must be exactly 32 bytes, got ${seed.length}`)
  }
  await page.evaluate(
    async (options: { readonly database: string; readonly bytes: readonly number[] }) => {
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.open(options.database, 1)
        request.onupgradeneeded = (): void => {
          const db = request.result
          if (!db.objectStoreNames.contains('identity')) db.createObjectStore('identity')
        }
        request.onerror = (): void => reject(request.error ?? new Error('indexedDB.open failed'))
        request.onsuccess = (): void => {
          const db = request.result
          const tx = db.transaction('identity', 'readwrite')
          tx.objectStore('identity').put(new Uint8Array(options.bytes), 'node-seed')
          tx.oncomplete = (): void => {
            db.close()
            resolve()
          }
          tx.onerror = (): void => {
            db.close()
            reject(tx.error ?? new Error('the planted put failed'))
          }
        }
      })
    },
    { database: `${blockstoreName}-identity`, bytes: [...seed] },
  )
}

export function fixtureViteCacheDir(root: string): string {
  pruneStaleFixtureViteCaches(root)
  return join(root, 'node_modules', `${FIXTURE_VITE_CACHE_PREFIX}${String(process.ppid)}`)
}

/**
 * Remove the cache directories of invocations that have exited, and **only** those.
 *
 * A directory whose pid is still alive belongs to a lane running beside this one — which is the
 * very thing {@link fixtureViteCacheDir} exists to protect — so it is left alone. `process.kill`
 * with signal `0` sends nothing; it asks whether the pid exists. `EPERM` means it exists and is
 * not ours, which is also a reason to keep it. Only `ESRCH` — no such process — removes anything.
 */
function pruneStaleFixtureViteCaches(root: string): void {
  if (pruned) return
  pruned = true
  const modules = join(root, 'node_modules')
  let entries: string[]
  try {
    entries = readdirSync(modules)
  } catch {
    return
  }
  for (const entry of entries) {
    if (!entry.startsWith(FIXTURE_VITE_CACHE_PREFIX)) continue
    const pid = Number(entry.slice(FIXTURE_VITE_CACHE_PREFIX.length))
    if (!Number.isInteger(pid) || pid <= 0 || pid === process.ppid) continue
    try {
      process.kill(pid, 0)
      continue
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== 'ESRCH') continue
    }
    rmSync(join(modules, entry), { recursive: true, force: true })
  }
}
