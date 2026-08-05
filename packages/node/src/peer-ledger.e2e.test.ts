import { execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import type { Server } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, firefox, webkit } from 'playwright'
import type { Browser, BrowserContext, BrowserType, Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
// The **production** request path, for the same reason `browserLabel` is imported below
// rather than reimplemented: {@link servedBy} reads what a node hands a peer that asks,
// and a second hand-rolled `report` frame written here would be a source that could drift
// from the one every node actually answers.
import { publishStartOutcome } from '@o2/net'
// Test-only relative import, the convention `two-tabs.e2e.test.ts` uses one line over for
// `core/src/executor/fixtures.ts`. This is the **production** classifier — the same
// function every tab runs against its own `navigator.userAgent` — rather than a second
// copy of the rules written here, which would be a source that could drift from the one
// under test. `browser-id.ts` imports one type and nothing else, so it drags in no browser
// globals and no libp2p.
import { browserLabel, identifyBrowser } from '../../browser/src/browser-id.ts'
import { FabricNode } from './fabric-node.ts'

/**
 * Criterion 5 — *"the browser demo's peer activity ledger, viewed across two or more
 * connected tabs, shows merged counts contributed by every connected peer — not zero —
 * because every node now supplies `serveAgent`'s `ledger` hook and reported outcomes are
 * recorded rather than discarded."*
 *
 * ## The reading is a foreign browser family, and a count is not
 *
 * A chromium tab whose merged report carries a `firefox 148` row **cannot have produced
 * that row**: `currentBrowserLabel()` reads this tab's own `navigator.userAgent` and there
 * is no other expression in the page that composes a label. A count above 1, by contrast,
 * is satisfiable by an accident, a double-record, or a fixture that opened the same page
 * twice — this file asserts `reported` **beside** the family assertion and never instead
 * of it, and says so at the case.
 *
 * **Three engines is what makes the criterion measurable at all.** Three tabs of one
 * engine share a family label, and `mergeOverlapping` takes the maximum per
 * `(browser, result)` key, so a single-engine fixture cannot distinguish a merged report
 * from a purely local one however many tabs it opens. `two-tabs.e2e.test.ts` is exactly
 * that shape and its docblock now says the same thing about itself.
 *
 * ## The reading is taken off the screen
 *
 * The criterion says *viewed*. A returned object is not a view, and the divergence between
 * the two — the right value read off the wrong object — is a defect class this repository
 * has already measured and recorded, as mutation-ledger entry `M37`, on this very tier.
 * So every load-bearing assertion below reads `#report`'s `textContent` out of the live
 * page. `TabStartReport.byBrowser` is read *in addition*, as a cross-check that the screen
 * and the object agree, which is a reading in its own right.
 *
 * ## Five tabs, three engines, and what each one is for
 *
 * | tab | engine | user agent | consent | what it establishes |
 * |---|---|---|---|---|
 * | `chromium` | chromium | its own | reporting **on** | contributor, and a reading surface |
 * | `firefox` | firefox | its own | reporting **on** | contributor, and the second reading surface |
 * | `webkit` | webkit | its own | reporting **on** | contributor |
 * | `coarsened` | chromium | major forced to five digits | reporting **on** | a visitor past the publishable range, counted under its family alone |
 * | `declining` | chromium | `Edg/` appended | reporting **off** | the opt-out, read on both of its halves — what it still sees, and what it does not send |
 *
 * The last two are `browser.newContext()` on the already-launched chromium rather than two
 * more `browserType.launch()` calls: a context is its own origin storage, its own
 * IndexedDB and its own peer identity, which is everything these two need, and two further
 * engine launches would cost a minute of wall clock to establish nothing extra. The three
 * *reading* tabs are separate launches, because for those the point is three independent
 * WebRTC implementations.
 *
 * **One host. Three engines. Not three machines.** The same disclosure
 * `static-rendezvous.e2e.test.ts` makes about itself, and for the same reason: separate
 * launches give separate storage and separate implementations, and they do not give
 * separate hardware. No result from this file may be described as cross-machine.
 *
 * ## What this file cannot redden on, stated so nobody reads more into a green
 *
 * - **The wire bounds.** `MAX_REPORTED_COUNT` and `isStartBrowserLabel` are measured by
 *   `packages/net/src/start-report.test.ts`, in `lifting the deferral does not lift the
 *   bounds it was conditional on`, which pairs a refused row against a truthful one from
 *   the same peer. Nothing here sends a malformed row, so nothing here would notice either
 *   bound being deleted — except {@link COARSENED_TAB}, which depends on `browserLabel`
 *   dropping a major past `MAX_BROWSER_MAJOR` and is a *use* of that ceiling rather than a
 *   measurement of it. The measurement is `packages/browser/src/browser-id.test.ts`, in
 *   `a label this build composes is a label this build can file`.
 * - **Discovery.** That is `static-rendezvous.e2e.test.ts`'s, which reads an exact
 *   anti-vacuity count per round. This file dials nothing from the harness either, and
 *   asserts the mesh only as a precondition — a fixture check, not a claim.
 *
 * ## An engine that cannot take part is published, never dropped
 *
 * {@link excluded} carries it with its reason and the first case goes red naming it. A
 * rung that vanishes between plan and result is indistinguishable from one removed
 * because it was inconvenient.
 */

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const DIST = join(ROOT, 'packages', 'browser', 'dist')

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
}

/** The engines the browser-tier standard names, in the order they are launched. */
const ENGINES: readonly { readonly name: string; readonly type: BrowserType }[] = [
  { name: 'chromium', type: chromium },
  { name: 'firefox', type: firefox },
  { name: 'webkit', type: webkit },
]

/**
 * The tab whose version is past the range a label may carry, and what it reports anyway.
 *
 * **This tab used to be the control for a node that reports nothing, and the reason it no
 * longer is, is the finding.** `browserLabel` composed `${family} ${major}` with no bound
 * while `isStartBrowserLabel` admitted four digits, so a five-digit visitor produced a
 * label no peer could file — and since `ownStartOutcome` runs a node's *own* label through
 * that same predicate, such a visitor started and then reported nothing whatever. A metric
 * built to make a blocklist's silence visible was manufacturing silence of its own, on the
 * only tier where the label is read from an environment rather than declared.
 *
 * `browserLabel` is now bounded by `MAX_BROWSER_MAJOR`, the ceiling the predicate is
 * derived from, and drops a version past it rather than clamping to it. So this tab
 * composes `chromium` — its family, with no version — which is a label the wire admits and
 * which is what a version that cannot be *read* has always produced. It is counted.
 *
 * The label is also unique in this fixture, and that is what makes the case below say
 * something: every reading tab carries a version (asserted directly, one case up), the
 * relay carries `other`, and the declining tab carries `edge 120`. A bare `chromium` on
 * another tab's screen has exactly one source.
 *
 * Forcing it here is a `userAgent` override and nothing else. No option is passed, no
 * factory is patched, and no code path exists that is not the one a visitor on a
 * five-digit Chrome would take.
 */
const COARSENED_TAB = 'coarsened'

/** The tab whose visitor allowed compute and refused to be counted — BROW-01. */
const DECLINING_TAB = 'declining'

interface Tab {
  /** The row in this file's table: an engine name, or one of the two special tabs. */
  readonly name: string
  readonly engine: string
  readonly context: BrowserContext
  readonly page: Page
  readonly peerId: string
  /**
   * The label this tab composes for itself, computed **here** by the production
   * classifier over the **page's own** `navigator.userAgent`.
   *
   * Not supplied to the page and not read back off any report: the harness derives it from
   * the string the browser reports about itself, and the tab derives it from the same
   * string with the same function. The label is therefore not the evidence — its
   * *presence on another engine's screen* is, because the only route between the two
   * processes is the wire.
   */
  readonly label: string
  /** Whether this tab's own row can end up in anybody's report at all. */
  readonly contributes: boolean
}

/** An engine or context that did not reach the starting line, and why. Never dropped. */
interface Excluded {
  readonly name: string
  readonly reason: string
}

let server: Server
let baseUrl: string
let relay: FabricNode
let relayAddr: string
const browsers = new Map<string, Browser>()
const tabs: Tab[] = []
const excluded: Excluded[] = []
/** What each tab's `#report` element said once every tab had published once. */
const panels = new Map<string, string>()
/** Wall time of the whole fixture, reported so this file's cost is a finding. */
let setupMs = 0

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

const tabNamed = (name: string): Tab => {
  const found = tabs.find((tab) => tab.name === name)
  if (found === undefined) throw new Error(`no tab named ${name} — see the exclusions case`)
  return found
}

const panelOf = (name: string): string => {
  const found = panels.get(name)
  if (found === undefined) throw new Error(`no panel captured for ${name}`)
  return found
}

/**
 * Every browser-family row `describeStartReport` rendered, off the screen text.
 *
 * Anchored on that function's own two-space row indent and its `: ` separator, so a blind
 * spot note or a summary line that happened to contain a family word cannot be read as a
 * tally. This is the one place this file parses prose, and it parses it into the same
 * shape `TabStartReport.byBrowser` carries so the two can be compared directly.
 */
function familiesOnScreen(panel: string): readonly string[] {
  return panel
    .split('\n')
    .flatMap((line) => /^ {2}([a-z]+(?: \d+)?): \d/.exec(line)?.[1] ?? [])
    .sort()
}

/**
 * The browser families one node hands a peer that asks it for its counts.
 *
 * **Read at the egress boundary, not off a screen**, and that is the whole reason this
 * helper exists beside {@link familiesOnScreen}. BROW-01's promise is about what leaves a
 * visitor's device; a screen is downstream of that and can be made to look right by
 * filtering on the way out, which would leave the promise broken and every reading here
 * green. This asks the node directly, over the relay, through the same
 * `publishStartOutcome` every node uses.
 *
 * Asks with `outcome: null`, so nothing this reading does can put a row where it is
 * looking for one — the relay tells the tab nothing and merely listens.
 *
 * Throws rather than returning empty when the peer did not answer: an unreachable node
 * and a node that withheld a row are the same empty list, and only one of them is
 * evidence.
 */
async function servedBy(peerId: string): Promise<readonly string[]> {
  const answer = await publishStartOutcome({
    rpc: relay.rpc,
    peers: () => [peerId],
    outcome: null,
  })
  if (answer.reached !== 1)
    throw new Error(`the relay asked ${peerId} for its counts and got no answer`)
  return answer.report.byBrowser.map((tally) => tally.browser).sort()
}

/**
 * Open one tab on the built static bundle and start a node in it.
 *
 * Every step that can fail per-tab is inside the `try`, so a webkit that cannot open a
 * data channel is reported as *webkit could not do X* rather than as a timeout in
 * whichever assertion happened to run first.
 */
async function openTab(options: {
  readonly name: string
  readonly engine: string
  readonly userAgent?: string
  readonly reporting: boolean
}): Promise<Tab | Excluded> {
  const browser = browsers.get(options.engine)
  if (browser === undefined) return { name: options.name, reason: `${options.engine} never launched` }
  try {
    const context = await browser.newContext(
      options.userAgent === undefined ? {} : { userAgent: options.userAgent },
    )
    const page = await context.newPage()
    page.on('pageerror', (error) => {
      process.stderr.write(`[${options.name}] page error: ${error.message}\n`)
    })
    page.on('console', (message) => {
      if (message.type() === 'error')
        process.stderr.write(`[${options.name}] console: ${message.text()}\n`)
    })

    // The one address the harness supplies, through the page's own query string — the
    // thing a visitor pastes, and the one thing a static host cannot serve.
    await page.goto(`${baseUrl}/?relay=${encodeURIComponent(relayAddr)}`)
    await page.waitForFunction(() => typeof window.o2 !== 'undefined', null, { timeout: 60_000 })

    // BROW-01 has no test-only bypass: a harness consents for the same reason a visitor
    // clicks the button. The reporting flag is the visitor's second choice and is the only
    // difference between the declining tab and the rest.
    const joined = await page.evaluate(
      async ([store, reporting]) => {
        window.o2.grantConsent(reporting === true ? { reporting: true } : {})
        return window.o2.autoStart({ blockstoreName: store as string })
      },
      [`peer-ledger-${options.name}`, options.reporting] as const,
    )

    const addrs = await page.evaluate(async () => window.o2.waitForWebrtcAddr(90_000))
    if (addrs.length === 0)
      return { name: options.name, reason: 'reserved on the relay but produced no /webrtc address' }

    // Read from the page rather than from the option: a `userAgent` override Playwright
    // silently ignored would otherwise be invisible here and would make the coarsened tab's
    // case pass for the wrong reason.
    const agent = await page.evaluate(() => navigator.userAgent)
    const label = browserLabel(identifyBrowser(agent))

    return {
      name: options.name,
      engine: options.engine,
      context,
      page,
      peerId: joined.peerId,
      label,
      // Whether this tab's row is *distinguishable* in somebody else's report — which is
      // narrower than fileable, and deliberately: `other` is fileable and is also what the
      // relay contributes, so a tab wearing it could not be told from the Node tier.
      // Fileability itself is no longer a thing a tab can fail, because `browserLabel` is
      // bounded by the ceiling `isStartBrowserLabel` is derived from; the pattern is kept
      // here as the reading that would notice if that stopped being true.
      contributes: label !== 'other' && /^[a-z]+(?: \d{1,4})?$/.test(label),
    }
  } catch (error) {
    return { name: options.name, reason: messageOf(error) }
  }
}

/** Click the page's own Refresh, wait for the render, and keep what it said. */
async function publish(tab: Tab): Promise<void> {
  // `page.evaluate`, not a locator click: `#refresh-report` lives inside `#main`, which
  // stays hidden until `reveal()` runs, and this harness drives `window.o2` directly
  // rather than clicking Join. A locator click would fail actionability and the file would
  // go red for a reason that has nothing to do with the subject.
  await tab.page.evaluate(() => {
    document.getElementById('refresh-report')?.click()
  })
  // A condition, not a sleep. The element's initial text is the page's own literal, so
  // this waits for the render that the click caused and for nothing else.
  await tab.page.waitForFunction(
    () => (document.getElementById('report')?.textContent ?? 'not asked yet') !== 'not asked yet',
    null,
    { timeout: 60_000 },
  )
  panels.set(
    tab.name,
    await tab.page.evaluate(() => document.getElementById('report')?.textContent ?? ''),
  )
}

beforeAll(async () => {
  const started = performance.now()

  // Built here rather than assuming a previous build is current: this must fail when the
  // *sources* break the bundle, not when somebody forgot to rebuild.
  execFileSync('npx', ['vite', 'build', '--config', 'packages/browser/vite.config.ts'], {
    cwd: ROOT,
    stdio: 'pipe',
  })

  // A deliberately dumb server: no module resolution, no transforms, no fallbacks, and no
  // `/bootstrap.json`. There is no `SeedServer` and no Vite dev server here.
  server = createServer((request, response) => {
    const path = (request.url ?? '/').split('?')[0] ?? '/'
    const file = join(DIST, normalize(path === '/' ? '/index.html' : path))
    if (!file.startsWith(DIST)) {
      response.writeHead(403).end()
      return
    }
    readFile(file).then(
      (bytes) => {
        response.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' })
        response.end(bytes)
      },
      () => {
        response.writeHead(404).end('not found')
      },
    )
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('no server port')
  baseUrl = `http://127.0.0.1:${address.port}`

  // Comfortably above five, so a refusal cannot be mistaken for a configured limit. This
  // node relays and executes nothing — the subject is what five tabs tell each other.
  //
  // **It is also a peer, and it is a `FabricNode`, so it contributes an `other` row.**
  // That is the Node tier holding a ledger on identical terms, not a special case, and
  // the cases below read it as one more family the browser tabs did not produce.
  relay = await FabricNode.start({
    relayAdmission: 'admits-any-peer',
    startReporting: 'reports-its-own-start',
    maxReservations: 12,
    listen: ['/ip4/127.0.0.1/tcp/0/ws'],
    trustAnchors: 'runs-unsigned-artifacts',
  })
  const dialable = relay.browserDialableAddrs[0]
  if (dialable === undefined) throw new Error('relay produced no browser-dialable address')
  relayAddr = dialable

  // Sequential rather than concurrent: three engines launching at once contend for the
  // CPU, and the symptom is a timeout in whichever one lost.
  for (const { name, type } of ENGINES) {
    try {
      browsers.set(name, await type.launch())
    } catch (error) {
      excluded.push({ name, reason: `launch failed: ${messageOf(error)}` })
    }
  }

  for (const { name } of ENGINES) {
    const outcome = await openTab({ name, engine: name, reporting: true })
    if ('reason' in outcome) {
      process.stderr.write(`[${name}] excluded: ${outcome.reason}\n`)
      excluded.push(outcome)
    } else {
      tabs.push(outcome)
    }
  }

  // The two special tabs' user agents are **derived from the real one**, so nothing here
  // is a hardcoded string that goes stale the next time Playwright updates. The coarsened
  // tab forces a five-digit major; the declining tab prepends the marker `identifyBrowser`
  // checks before Chrome's, so it lands on a family no other tab in this fixture is.
  const chromiumTab = tabs.find((tab) => tab.name === 'chromium')
  if (chromiumTab !== undefined) {
    const agent = await chromiumTab.page.evaluate(() => navigator.userAgent)
    const special: readonly { name: string; userAgent: string; reporting: boolean }[] = [
      {
        name: COARSENED_TAB,
        userAgent: agent.replace(/Chrome\/\d+/, 'Chrome/12345'),
        reporting: true,
      },
      { name: DECLINING_TAB, userAgent: `${agent} Edg/120.0.0.0`, reporting: false },
    ]
    for (const one of special) {
      const outcome = await openTab({ ...one, engine: 'chromium' })
      if ('reason' in outcome) {
        process.stderr.write(`[${one.name}] excluded: ${outcome.reason}\n`)
        excluded.push(outcome)
      } else {
        tabs.push(outcome)
      }
    }
  }

  // Discovery, sequential, and **nothing dialled by the harness**. Sequential for the
  // reason `static-rendezvous.e2e.test.ts` records at length: a simultaneous mutual dial
  // between firefox and webkit lost ICE 4 times out of 4 when it was forced, and an exact
  // reading beats a raced one. One pass introduces every pair exactly once.
  for (const tab of tabs) {
    await tab.page.evaluate(async () => window.o2.connectDiscoveredPeers())
  }

  // Each tab publishes once, through the page's own control. Order does not matter and
  // that is worth stating rather than relying on: a peer answers out of a ledger that has
  // held its own row since it started, so the first tab to publish already learns every
  // other tab's family. Nothing here waits for a second round.
  for (const tab of tabs) await publish(tab)

  setupMs = performance.now() - started
  process.stderr.write(
    `[fixture] build + relay + ${tabs.length} tabs in ${Math.round(setupMs)}ms\n` +
      tabs.map((tab) => `[fixture]   ${tab.name}: ${tab.label}\n`).join(''),
  )
}, 900_000)

afterAll(async () => {
  for (const tab of tabs) {
    await tab.page.evaluate(async () => window.o2.stop()).catch(() => {})
    await tab.context.close().catch(() => {})
  }
  for (const browser of browsers.values()) await browser.close().catch(() => {})
  await relay?.stop().catch(() => {})
  await new Promise<void>((resolve) => server?.close(() => resolve()))
}, 240_000)

describe('BROW-02 — a tab shows counts it could not have produced', () => {
  /**
   * The standard's own rung, read first and separately, so a missing engine names itself
   * here rather than surfacing as a thin report three cases later.
   */
  it('runs all three engines the standard names, or publishes the one it could not', () => {
    expect(excluded.map((entry) => `${entry.name} could not take part — ${entry.reason}`)).toEqual([])
    expect(tabs.map((tab) => tab.name)).toEqual([
      'chromium',
      'firefox',
      'webkit',
      COARSENED_TAB,
      DECLINING_TAB,
    ])
    // Five distinct nodes, not one node seen five times. Contexts, not tabs of one
    // context: a node's identity lives in origin storage, so a second tab of the same
    // context would load the *same* peer id and could not dial itself.
    expect(new Set(tabs.map((tab) => tab.peerId)).size).toBe(tabs.length)
    // And every reservation is held at once, on the relay's own count.
    expect(relay.capacity.granted).toBeGreaterThanOrEqual(tabs.length)

    // The three reading engines composed three *different* families. Without this the
    // foreign-family assertions below would be satisfiable by a tab's own row, which is
    // exactly the vacuity a single-engine fixture cannot escape.
    const reading = ['chromium', 'firefox', 'webkit'].map((name) => tabNamed(name).label)
    expect(new Set(reading).size).toBe(3)
    // Every one of them carries a version, and that is a precondition rather than a
    // restatement of the line above. A real engine reaching `MAX_BROWSER_MAJOR` would be
    // coarsened to its bare family by `browserLabel` — at which point it would collide with
    // {@link COARSENED_TAB}'s label and that tab's case would be reading its own row while
    // appearing to read a foreign one. This is what would say so.
    for (const label of reading) expect(label).toMatch(/^(?:chromium|edge|firefox|safari|other) \d{1,4}$/)
  })

  /**
   * The fixture's precondition, asserted as one rather than claimed.
   *
   * Discovery itself is `static-rendezvous.e2e.test.ts`'s subject and this file adds
   * nothing to it. What matters here is only that every tab really is holding every other
   * tab when the reports are taken — a merged report over a tab that never connected would
   * be an absence with two explanations, and the whole value of the controls below is that
   * theirs has one.
   */
  it('every tab holds every other tab, with no harness dial anywhere', async () => {
    for (const tab of tabs) {
      const connected = await tab.page.evaluate(() => window.o2.peers())
      for (const other of tabs) {
        if (other.peerId === tab.peerId) continue
        expect({ from: tab.name, to: other.name, holds: connected.includes(other.peerId) }).toEqual({
          from: tab.name,
          to: other.name,
          holds: true,
        })
      }
      expect(connected).not.toContain(tab.peerId)
      // The relay is a connection too — holding a reservation *is* one — and it is a peer
      // that answers the report request like any other node.
      expect(connected).toContain(relay.peerId)
    }
  }, 300_000)

  /**
   * **The reading this file exists for.**
   *
   * On the chromium tab's *screen*, a tally line for firefox's family and one for
   * webkit's. Neither can have been produced there: the page composes exactly one label,
   * from its own `navigator.userAgent`, and these are two other browsers' — obtained by
   * this harness from those browsers' own processes and never handed to this one.
   *
   * Taken from the firefox tab as well, so the property is not an artefact of one engine's
   * ordering or of chromium happening to publish first.
   */
  it('shows, on screen, tally rows for two browser families the reading tab is not', () => {
    for (const reader of ['chromium', 'firefox']) {
      const panel = panelOf(reader)
      const families = familiesOnScreen(panel)
      for (const other of ['chromium', 'firefox', 'webkit']) {
        if (other === reader) continue
        expect({ reader, foreign: tabNamed(other).label, shown: families }).toEqual({
          reader,
          foreign: tabNamed(other).label,
          shown: expect.arrayContaining([tabNamed(other).label]),
        })
      }
      // The Node tier's own row, from the relay. `fabric-node.ts`'s `OWN_START_FAMILY` is
      // `'other'`, and a browser tab reaches that label only for a user agent none of
      // these has. Read here because it is the same property one tier over, and because
      // it is the demonstration that this is a *fabric* reading rather than a browser one.
      expect(families).toContain('other')
    }
  })

  /**
   * The count, asserted **beside** the family and never instead of it.
   *
   * `reported > 1` is satisfiable with no merge at all — one tab that published twice
   * produces it, and so does one tab whose own row was double-recorded. It is written down
   * because the criterion names it and because a merged report that read 1 would mean the
   * wiring never took; it is not what carries the claim.
   *
   * The `unreliable` marker is **asserted present, not worked around**. Five tabs is far
   * below `MIN_REPORTS_FOR_RATE` (10), and that constant's docblock refuses exactly the
   * move of hiding a small-`n` warning: *"a rate over four samples is still the only
   * evidence there is, and hiding it loses the early signal a cliff arrives as."*
   */
  it('reports more than any one tab holds, with the small-sample warning left visible', async () => {
    const panel = panelOf('chromium')
    const summary = /^(\d+) of (\d+) reported starts failed/.exec(panel)
    expect(summary).not.toBeNull()
    // Four contributors at minimum: three engines and the relay. The coarsened tab is a
    // fifth, and the declining tab is deliberately **not** one — its row reaches nobody,
    // which is the case two below. Kept at four rather than raised to five: a floor is
    // what survives a row that has not finished propagating when this panel is read, and
    // the coarsened tab's contribution is asserted where it is the subject rather than
    // here.
    //
    // **A floor, and therefore not the instrument that would notice the leak coming
    // back** — five contributors satisfies it and so does six. That reading is the BROW-01
    // case's, which names the label and reads it off every screen and off the wire.
    expect(Number(summary?.[2])).toBeGreaterThanOrEqual(4)

    // Every rendered rate carries `unreliable` at this sample size, and the summary
    // denominator is the merged one rather than a per-browser count.
    for (const line of panel.split('\n')) {
      if (/^ {2}[a-z]+(?: \d+)?: /.test(line)) expect(line).toContain(', unreliable')
    }

    // The object and the screen agree — the cross-check `M37` argues for. Read after the
    // panel, and it publishes again, so counts may have moved; families cannot, because a
    // node's family enters a report through its own construction-time row and every node
    // in this fixture had already published one.
    const object = await tabNamed('chromium').page.evaluate(async () => window.o2.startReport())
    expect([...object.byBrowser.map((tally) => tally.browser)].sort()).toEqual(
      familiesOnScreen(panel),
    )
    expect(object.reached).toBeGreaterThan(0)
    expect(object.reached).toBe(object.asked)
  }, 120_000)

  /**
   * **A visitor past the publishable range is counted, under its family alone.**
   *
   * This is the end of the composer defect, read in a real browser rather than in a unit
   * test's table. The tab runs a five-digit Chrome. `browserLabel` drops a major past
   * `MAX_BROWSER_MAJOR` instead of interpolating it, so the tab composes `chromium`,
   * `isStartBrowserLabel` accepts it, `ownStartOutcome` files it, and it travels.
   *
   * Before the bound it composed `chromium 12345`, which that predicate refuses — and
   * because a node's *own* label goes through the same predicate, this tab started and then
   * reported nothing at all, on both paths at once: an empty serve-side ledger, and an
   * `outcome: null` substituted by every peer's `parseRequest`. This case used to assert
   * that silence as a control. It asserts the row instead, which is the change.
   *
   * **What makes the presence mean something.** A bare `chromium` belongs to no other node
   * in this fixture — every reading tab carries a version (asserted one case up, and that
   * assertion exists for this), the relay carries `other`, the declining tab `edge 120`. So
   * its appearance on another engine's screen has exactly one source: this tab's node
   * answered with it, over WebRTC, to a browser that is not the one that composed it.
   *
   * **What was lost, said rather than left to be noticed.** There is no longer a production
   * path to `ownStartOutcome`'s `'reports-no-start-outcome'` arm, so nothing here exercises
   * it and nothing can. It is a guard over a `string` parameter now, kept because the
   * predicate is where the range is enforced and a composer is not the only caller a
   * refactor could give it — not because a fixture can reach it.
   */
  it('a visitor past the publishable range is counted under its family, on every other screen', async () => {
    const coarsened = tabNamed(COARSENED_TAB)
    // The version was dropped, not clamped: `chromium 9999` would file a real visitor under
    // a number no browser ever had, and the merge takes the maximum per key.
    expect(coarsened.label).toBe('chromium')
    expect(coarsened.contributes).toBe(true)
    // Unique in this fixture. Without this the presence assertions below would be equally
    // satisfied by each reader's own row.
    expect(tabs.filter((tab) => tab.label === coarsened.label).map((tab) => tab.name)).toEqual([
      COARSENED_TAB,
    ])

    for (const reader of tabs) {
      if (reader.name === COARSENED_TAB) continue
      expect({ reader: reader.name, shows: familiesOnScreen(panelOf(reader.name)) }).toEqual({
        reader: reader.name,
        shows: expect.arrayContaining([coarsened.label]),
      })
    }

    // And it answered. Read off its own object, because `reached` is not a thing the panel
    // can be asked for about somebody else.
    const object = await coarsened.page.evaluate(async () => window.o2.startReport())
    expect(object.reached).toBeGreaterThan(0)
    // It sees the fabric as well as contributing to it.
    expect(object.byBrowser.map((tally) => tally.browser)).toEqual(
      expect.arrayContaining([tabNamed('firefox').label, tabNamed('webkit').label]),
    )
  }, 120_000)

  /**
   * **Declining to report is not declining to see** — the half of the opt-out that holds.
   *
   * The declining tab granted compute and refused reporting, so `startReport` sends
   * `outcome: null` on every request it makes. It still asks every peer, still merges every
   * answer, and its screen carries all three reading families and the Node tier's. Its own
   * decline is counted where the page can count it — locally, at the moment of the choice —
   * and appears as the second blind spot, which is the price of having made reporting
   * genuinely optional rather than nominally so.
   */
  it('a declining visitor still sees the merged view, and counts their own decline locally', () => {
    const panel = panelOf(DECLINING_TAB)
    const families = familiesOnScreen(panel)
    for (const other of ['chromium', 'firefox', 'webkit']) {
      expect({ shown: families, expected: tabNamed(other).label }).toEqual({
        shown: expect.arrayContaining([tabNamed(other).label]),
        expected: tabNamed(other).label,
      })
    }
    expect(families).toContain('other')
    // The blind spot the opt-out creates, named on the same screen as the numbers it is
    // missing from — `describeStartReport` puts it inside the string deliberately, so it
    // survives being copied.
    expect(panel).toContain('not counted: 1')
    // And the restored contributor reading, parsed rather than matched: `0 of 0 asked`
    // renders just as happily as a real fan-out.
    const answering = /peers answering: (\d+) of (\d+) asked/.exec(panel)
    expect(answering).not.toBeNull()
    expect(Number(answering?.[1])).toBeGreaterThan(0)
    expect(Number(answering?.[1])).toBe(Number(answering?.[2]))
  })

  /**
   * **The other half of the opt-out — a declining visitor's row does not leave their
   * device, and this is the reading that says so.**
   *
   * `DISCLOSURE.reporting` promises, in the words a visitor reads before deciding:
   * *"Sends one line — which browser family, and whether the node started or was blocked…
   * **Off unless you turn it on.**"* This tab turned it off. Its family is on nobody's
   * screen, and the node itself hands it to no peer that asks.
   *
   * ## What this case used to record, kept because the shape recurs
   *
   * Until 2026-08-04 this was titled `RECORDS A DEFECT` and asserted the exact opposite,
   * because the opposite was true. Two things sent that line and only one of them was
   * gated: `demo/main.ts`'s `startReport` sent `outcome: allowed ? outcome : null`, which
   * honoured the choice, while `browser-node.ts` recorded the tab's own row into its
   * **serve-side** ledger at construction — before any peer was contacted, with no
   * reference to consent, because `BrowserNodeOptions` carried none — and `serveAgent`'s
   * report branch handed that ledger to every peer that asked. The page withheld the line
   * and the node served it. **A consent control that changes only what the local page
   * renders is the sovereignty claim failing in miniature**, which is why it outranked
   * every feature open at the time.
   *
   * The measurement that closed it is the one below, run against the unfixed tree:
   *
   * ```
   * [BROW-01] consenting (chromium 151) served: chromium | chromium 151 | firefox 153 | safari 26
   * [BROW-01] declining  (edge 120) served: chromium | chromium 151 | edge 120 | firefox 153 | safari 26
   * ```
   *
   * The fix is `startReporting`, a **required** option on both node factories, consulted
   * by `ownStartLedger` at the moment the row would be recorded — not when a report goes
   * out. `browser-node.ts`'s field docblock carries the argument for that siting; the
   * short form is that a row which was never recorded cannot be forgotten about at the
   * next site that reads a ledger.
   *
   * ## Two readings, and why both
   *
   * - **Off every screen**, including the declining tab's own. That is the criterion's
   *   own instrument and it is what a person would check.
   * - **At the egress boundary**, through {@link servedBy}: the relay asks the declining
   *   node directly, over the production request path, for the counts it serves. A screen
   *   is downstream of the promise and could be made to look right by filtering on the way
   *   out — which is precisely the fix this defect was *not* given. This reading cannot be
   *   satisfied that way.
   *
   * The second is taken **comparatively**, against a consenting tab asked by the same
   * relay in the same pass, so the two answers differ by the visitor's choice and by
   * nothing else. Without that pair, an empty answer from the declining node would be
   * equally explained by a broken relay, a dead tab, or a ledger that stopped holding
   * anything at all.
   *
   * ## Anti-vacuity
   *
   * `edge 120` is a label `isStartBrowserLabel` **admits** — asserted here, not assumed —
   * and it belongs to no other node in this fixture. So its absence is a refusal rather
   * than a row that could not have travelled anyway, and the consented families asserted
   * present in the same lists are what says the fixture still works.
   *
   * ## Two gates, both required, and this file now sees both
   *
   * **A draft of this docblock said the opposite and was falsified by planting it**, which
   * is recorded here rather than corrected away. It claimed this case says nothing about
   * the request path and would stay green if `startReport`'s `allowed ? outcome : null`
   * were deleted. That was the *old* file's true statement — the ledger published the row
   * regardless, so the request gate was unobservable from any screen. It is no longer.
   *
   * The row has exactly two ways out of a node and each needs its own gate:
   *
   * | route | what carries it | what shuts it |
   * |---|---|---|
   * | this node **answers** a peer | `serveAgent`'s report branch, out of the serve-side ledger | `startReporting`, at the moment the row would be recorded |
   * | this node **asks** a peer | `publishStartOutcome`'s `outcome` field, which `serveAgent` records into the *peer's* ledger | `demo/main.ts`'s `allowed ? outcome : null` |
   *
   * Removing either one puts `edge 120` back on a chromium tab's screen, measured:
   * deleting the ledger gate reddens this case alone, deleting the request gate reddens
   * this case **and** the merged-count case above, because the row then propagates through
   * every peer that the declining tab asked. So neither gate is redundant with the other,
   * and the one this case is named for is the one that was missing.
   *
   * `packages/net/src/start-report.test.ts` measures the request half in the mechanism;
   * this is the only place both are read together against real browsers.
   */
  it('a declining visitor’s row reaches no peer and no screen (BROW-01)', async () => {
    const declining = tabNamed(DECLINING_TAB)
    // The label is one the wire admits and it belongs to no other node here, so its
    // absence below is a refusal rather than a row that could not have travelled.
    expect(declining.label).toBe('edge 120')
    expect(declining.contributes).toBe(true)
    expect(tabs.filter((tab) => tab.label === declining.label).map((tab) => tab.name)).toEqual([
      DECLINING_TAB,
    ])

    // Every screen in the fixture, the declining tab's own included — it declined to be
    // counted, not to see, and its own decline is rendered as the blind spot the case
    // above reads rather than as a tally row.
    for (const reader of tabs) {
      const shows = familiesOnScreen(panelOf(reader.name))
      expect({ reader: reader.name, shows }).toEqual({
        reader: reader.name,
        shows: expect.not.arrayContaining([declining.label]),
      })
      // The other half, because an empty panel satisfies the line above just as well: the
      // consented families are still on it.
      expect(shows).toEqual(expect.arrayContaining([tabNamed('firefox').label]))
    }

    // The same fact read where it happens rather than hops downstream, and read
    // **comparatively**: the identical request goes to a consenting tab and to the
    // declining one over the same relay in the same pass.
    const consenting = tabNamed('chromium')
    const fromConsenting = await servedBy(consenting.peerId)
    const fromDeclining = await servedBy(declining.peerId)
    process.stderr.write(
      `[BROW-01] consenting (${consenting.label}) served: ${fromConsenting.join(' | ')}\n` +
        `[BROW-01] declining  (${declining.label}) served: ${fromDeclining.join(' | ')}\n`,
    )
    // The positive: a consenting node still hands a peer its own row. Without this the
    // negative below is satisfied by a ledger that stopped serving anything.
    expect(fromConsenting).toContain(consenting.label)
    expect(fromDeclining).not.toContain(declining.label)
    // And declining to report is not declining to relay what others consented to: the
    // declining node still answers with the families its peers chose to tell it.
    expect(fromDeclining).toEqual(expect.arrayContaining([tabNamed('firefox').label]))
  }, 120_000)
})
