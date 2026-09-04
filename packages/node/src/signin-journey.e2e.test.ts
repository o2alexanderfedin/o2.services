/**
 * The way in, read off a real tab — AUTH-06, plan `42-04`.
 *
 * The owner ruled on 2026-09-04 that a visitor to this page is in one of two states: not
 * logged in, in which case they are shown what this is and invited to register or log in;
 * or logged in, in which case their node is already running. He also ruled that *"log in"*
 * means a **local passphrase** — no email, no account database, no server and no
 * third-party identity provider — and that the node starts on unlock with a visible switch
 * rather than consent being folded into registration.
 *
 * This file is that ruling, read through the visitor's own surface rather than through the
 * store beneath it. `idb-identity-at-rest.browser.test.ts` (`42-03`) already reads the seal
 * against a real IndexedDB in three engines; what had no reading anywhere was whether a
 * **person** can get from an unvisited page to a running node and back to the same node
 * tomorrow.
 *
 * ## Which criterion each case carries
 *
 * | case | criterion |
 * |---|---|
 * | the invitation | the ruling's first half: nothing runs, nothing is written, and the invitation is on screen |
 * | registering | the ruling's second half: unlock starts the node with no further click |
 * | the return | criterion 3 — a returning visitor with the correct passphrase is the same node |
 * | the ordering | BROW-01/BROW-06 — the gate is answered before the passphrase field is shown |
 * | the refusal | criterion 4 — a wrong passphrase refuses by name, changes nothing, and the right one still opens the original |
 * | starting over | T-42-24 — the only way past a forgotten passphrase says what it costs |
 * | the adoption | T-42-20 — a pre-AUTH-06 plaintext seed is sealed in place and the visitor keeps the node they were |
 * | the certificate | criterion 1's deliberate exemption, read as a working property |
 *
 * ## What no case here can see, stated so nobody counts it as covered
 *
 * - **Whether a freshly minted seed is in the clear anywhere.** A fresh registration mints
 *   bytes this file never learns, so it can search the identity database for a plaintext
 *   record's *shape* and its *key name* and nothing more. The case that can see it is the
 *   adoption case, which plants a **known** seed and then asserts the dump does not contain
 *   it — with the positive control that the same search **does** find it before registration.
 *   `42-03`'s plant 2 is the recorded reason this distinction is drawn rather than assumed:
 *   an absence assertion sited where the failure cannot occur stays green through the defect
 *   it is named for.
 * - **A real enrolment.** This fixture stands up no provider, so the certificate case reads a
 *   record it planted itself. What it measures is that sealing the seed leaves the
 *   certificate record untouched and readable — which is the exemption criterion 1 grants.
 *   `browser-enrollment.e2e.test.ts` and `visitor-enrolment.e2e.test.ts` are where a provider
 *   actually signs one.
 * - **Any duration.** Argon2id has read 374/436/501 ms across two hosts, so nothing here
 *   asserts a time. Where the derivation is observed at all it is observed as *the controls
 *   were disabled and then were not*.
 *
 * ## Why `e2e`
 *
 * A real Chromium, a real relay reservation and the demo page itself. The `browser` project
 * can start no relay — it is a page in an engine — and the property under test is the page's
 * own entry surface, which the capability harness deliberately does not render.
 *
 * Isolation is by `BrowserContext`, not by `blockstoreName`: `register` and `unlock` resolve
 * the identity through **this origin's default** identity database, exactly as
 * `enrolledIssuer()` reads the default certificate at `demo/main.ts:666`, so two groups of
 * cases can only be independent if their origins' storage is.
 */

import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import type { Browser, BrowserContext, Page } from 'playwright'
import { createServer } from 'vite'
import type { ViteDevServer } from 'vite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { parseSealedSecret } from '@o2/core'
import { KERNEL_TRUST_ANCHOR } from '@o2/demo'
import {
  PASSPHRASE_MIN_LENGTH,
  SEED_BYTES,
  identityFromSeed,
  nodeKeyForPeerId,
} from '@o2/libp2p'
import { fixtureViteCacheDir, launchFixtureBrowser, plantLegacyIdentitySeed } from './e2e-browser-launch.ts'
import { FabricNode } from './fabric-node.ts'

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const PAGE = 'packages/browser/demo/index.html'

/**
 * The default blockstore name a visitor's tab uses, and therefore the identity database
 * `register` and `unlock` open.
 *
 * `browser-node.ts:847` holds the value and `:854` the suffix rule. Repeated here rather
 * than imported because neither is exported, and `plantLegacyIdentitySeed` already carries
 * the same derivation for the same reason.
 */
const DEFAULT_BLOCKSTORE = 'o2-blocks'
const IDENTITY_DB = `${DEFAULT_BLOCKSTORE}-identity`

/**
 * The passphrase this fixture registers with.
 *
 * A **fixture constant, not a secret**: it names nothing outside this file. Asserted against
 * `PASSPHRASE_MIN_LENGTH` below rather than counted by eye, so a change to the floor cannot
 * leave this file silently under it — which would make every case here fail as
 * `WeakPassphraseError` and look like a defect in the surface.
 *
 * Four ordinary words, deliberately: it is the shape `SIGNIN_PASSPHRASE_HINT` asks a visitor
 * for, so the fixture and the copy are not describing different things.
 */
const SPEC_PASSPHRASE = 'correct-horse-battery-staple'
/** The same shape, one word different. What a visitor who mistypes actually produces. */
const WRONG_PASSPHRASE = 'incorrect-horse-battery-staple'

/**
 * A pre-AUTH-06 plaintext seed, known to this file — which is the whole point of it.
 *
 * `42-03`'s finding: a search for bytes nobody knows cannot fail, and an absence assertion
 * that cannot fail is not an assertion. This is the one seed in this file whose bytes are
 * available to the needle search, so the adoption case is the one that carries criterion 1's
 * reading here.
 */
const KNOWN_SEED = new Uint8Array(SEED_BYTES).fill(0x5b)

/** How long a start is given. A relay reservation and a WebRTC listen address. */
const START_MS = 90_000

let relay: FabricNode
let relayAddr: string
let server: ViteDevServer
let baseUrl: string
let browser: Browser
let journey: BrowserContext
const opened: BrowserContext[] = []

beforeAll(async () => {
  expect(
    SPEC_PASSPHRASE.length,
    'this fixture registers with a passphrase under the floor the surface enforces, so every '
      + 'case below would fail as WeakPassphraseError and look like a defect in the page',
  ).toBeGreaterThanOrEqual(PASSPHRASE_MIN_LENGTH)
  expect(WRONG_PASSPHRASE.length).toBeGreaterThanOrEqual(PASSPHRASE_MIN_LENGTH)
  expect(
    WRONG_PASSPHRASE,
    'the wrong passphrase must be a different string, or the refusal case measures nothing',
  ).not.toBe(SPEC_PASSPHRASE)

  // DET-03: this node relays and executes nothing. The demo's own committed key, which is
  // what a visitor's tab pins with no flags.
  relay = await FabricNode.start({
    relayAdmission: 'admits-any-peer',
    startReporting: 'reports-its-own-start',
    maxReservations: 16,
    listen: ['/ip4/127.0.0.1/tcp/0/ws'],
    trustAnchors: [KERNEL_TRUST_ANCHOR],
  })
  const address = relay.browserDialableAddrs[0]
  if (address === undefined) throw new Error('relay produced no browser-dialable address')
  relayAddr = address

  server = await createServer({
    root: ROOT,
    logLevel: 'error',
    server: { port: 0 },
    cacheDir: fixtureViteCacheDir(ROOT),
  })
  await server.listen()
  const url = server.resolvedUrls?.local[0]
  if (url === undefined) throw new Error('vite dev server produced no URL')
  baseUrl = url.endsWith('/') ? url : `${url}/`

  browser = await launchFixtureBrowser(chromium)
  journey = await freshContext()
}, 300_000)

afterAll(async () => {
  for (const context of opened) await context.close().catch(() => {})
  await browser?.close().catch(() => {})
  await server?.close().catch(() => {})
  await relay?.stop().catch(() => {})
}, 180_000)

/** A context with its own origin storage — the only isolation available here. See the header. */
async function freshContext(): Promise<BrowserContext> {
  const context = await browser.newContext()
  opened.push(context)
  return context
}

/** Open the demo page with a relay in the query, and wait for `window.o2` to exist. */
async function visit(context: BrowserContext): Promise<Page> {
  const page = await context.newPage()
  await page.goto(`${baseUrl}${PAGE}?relay=${encodeURIComponent(relayAddr)}`)
  await page.waitForFunction(() => typeof window.o2 !== 'undefined', null, { timeout: 60_000 })
  return page
}

async function revisit(page: Page): Promise<void> {
  await page.reload()
  await page.waitForFunction(() => typeof window.o2 !== 'undefined', null, { timeout: 60_000 })
}

/**
 * One record of the identity database, as plain JSON.
 *
 * **Nothing is rendered through `String`.** `funnel-collector.e2e.test.ts:130-140` records an
 * instrument blinded exactly that way — `Buffer.from(String(value))` renders a `Uint8Array` as
 * `255,15,66,…`, and every scan below it then searched a decimal string and found nothing,
 * with the plant watched staying GREEN because of it. So a stored `Uint8Array` crosses as
 * base64 of its own bytes and an object crosses as JSON, and the two are distinguished by a
 * field rather than by guessing at the receiving end.
 */
interface IdentityRecord {
  readonly key: string
  readonly kind: 'bytes' | 'object' | 'other'
  /** base64 of the raw bytes — `kind: 'bytes'` only. */
  readonly base64: string
  /** JSON text — `kind: 'object'` only. */
  readonly json: string
}

/**
 * Every record in this origin's identity database.
 *
 * **Opened at version 1 with the same upgrade the store uses.** `42-03` deviation 6: an
 * `openDB(name)` with no version *creates* a store-less database at version 1, after which
 * every transaction the real store opens throws `NotFoundError` — an instrument that
 * manufactures the subject it claims to measure.
 */
async function identityDump(page: Page): Promise<IdentityRecord[]> {
  return page.evaluate(async (database: string): Promise<IdentityRecord[]> => {
    const b64 = (bytes: Uint8Array): string => {
      let binary = ''
      for (const byte of bytes) binary += String.fromCharCode(byte)
      return btoa(binary)
    }
    return new Promise<IdentityRecord[]>((resolve, reject) => {
      const request = indexedDB.open(database, 1)
      request.onupgradeneeded = (): void => {
        const db = request.result
        if (!db.objectStoreNames.contains('identity')) db.createObjectStore('identity')
      }
      request.onerror = (): void => reject(request.error ?? new Error('indexedDB.open failed'))
      request.onsuccess = (): void => {
        const db = request.result
        const tx = db.transaction('identity', 'readonly')
        const store = tx.objectStore('identity')
        const keys = store.getAllKeys()
        const values = store.getAll()
        tx.oncomplete = (): void => {
          const out: IdentityRecord[] = []
          for (let index = 0; index < keys.result.length; index += 1) {
            const key = String(keys.result[index])
            const value: unknown = values.result[index]
            if (value instanceof Uint8Array) out.push({ key, kind: 'bytes', base64: b64(value), json: '' })
            else if (typeof value === 'object' && value !== null) {
              out.push({ key, kind: 'object', base64: '', json: JSON.stringify(value) })
            } else out.push({ key, kind: 'other', base64: '', json: '' })
          }
          db.close()
          resolve(out)
        }
        tx.onerror = (): void => {
          db.close()
          reject(tx.error ?? new Error('the identity dump transaction failed'))
        }
      }
    })
  }, IDENTITY_DB)
}

/** Just the key names, for the "changed not one byte" reading. */
async function identityKeys(page: Page): Promise<string[]> {
  return (await identityDump(page)).map((record) => record.key).sort()
}

/**
 * Every byte string a record contributes to a needle search, each labelled by where it came
 * from — so a hit is reported as *found under this key* rather than *somewhere*.
 *
 * **Every base64url field of an envelope `parseSealedSecret` accepts is decoded back to
 * bytes.** A seed sitting un-encrypted inside a `ciphertext` field is precisely the failure
 * criterion 1 is named for, and a scan that looked only at `Uint8Array` records — or only at
 * the JSON text — would not see it. `42-03` records the same class twice.
 */
function searchable(dump: readonly IdentityRecord[]): { where: string; bytes: Uint8Array }[] {
  const out: { where: string; bytes: Uint8Array }[] = []
  for (const record of dump) {
    if (record.kind === 'bytes') {
      out.push({ where: record.key, bytes: new Uint8Array(Buffer.from(record.base64, 'base64')) })
      continue
    }
    if (record.kind !== 'object') continue
    let parsed: unknown
    try {
      parsed = JSON.parse(record.json)
    } catch {
      continue
    }
    // The JSON text itself, so a secret that reached the store as a plain string is visible.
    out.push({ where: `${record.key}:json`, bytes: new Uint8Array(Buffer.from(record.json, 'utf8')) })
    if (typeof parsed !== 'object' || parsed === null) continue
    for (const [field, value] of Object.entries(parsed)) {
      if (typeof value !== 'string') continue
      const decoded = Buffer.from(value, 'base64url')
      if (decoded.length === 0) continue
      out.push({ where: `${record.key}.${field}`, bytes: new Uint8Array(decoded) })
    }
  }
  return out
}

/** Where a needle was found, by the key it was found under, or `null`. */
function findNeedle(dump: readonly IdentityRecord[], needle: Uint8Array): string | null {
  const target = Buffer.from(needle)
  for (const entry of searchable(dump)) {
    if (Buffer.from(entry.bytes).includes(target)) return entry.where
  }
  return null
}

/** Total bytes the dump offers a search — the floor half of a positive control. */
function searchableBytes(dump: readonly IdentityRecord[]): number {
  return searchable(dump).reduce((total, entry) => total + entry.bytes.length, 0)
}

/**
 * Wait for a selector to be visible.
 *
 * `@playwright/test` is **not installed** in this repository — the e2e lane drives bare
 * `playwright@1.62.0` under vitest, so `expect(locator).toBeVisible()` does not exist here.
 * These two wrap `waitForSelector`, whose timeout message names the selector it was waiting
 * for, which is what makes a red in this file readable.
 */
async function waitVisible(page: Page, selector: string, timeout = 30_000): Promise<void> {
  await page.waitForSelector(selector, { state: 'visible', timeout })
}

/** Wait for a selector to be hidden or absent. */
async function waitHidden(page: Page, selector: string, timeout = 30_000): Promise<void> {
  await page.waitForSelector(selector, { state: 'hidden', timeout })
}

/** Whether a selector is visible **right now** — a reading, not a wait. */
async function visible(page: Page, selector: string): Promise<boolean> {
  return page.locator(selector).isVisible()
}

/** Fill the register form and press the register control. */
async function register(page: Page, passphrase: string): Promise<void> {
  await page.fill('#signin-passphrase', passphrase)
  await page.fill('#signin-passphrase-again', passphrase)
  await page.click('#signin-register')
}

/** Fill the single login field and press the login control. */
async function logIn(page: Page, passphrase: string): Promise<void> {
  await page.fill('#signin-passphrase', passphrase)
  await page.click('#signin-login')
}

/** The peer id this tab is running as, or `null` when nothing is running. */
async function runningPeerId(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const reading = document.querySelector('[data-region="session/peer-id"]')
    const text = (reading?.textContent ?? '').trim()
    return window.o2.activity() === null || text === '' ? null : text
  })
}

/** Wait until this tab reports a running node, and hand back its peer id. */
async function waitForRunning(page: Page): Promise<string> {
  await page.waitForFunction(() => window.o2.activity() !== null, null, { timeout: START_MS })
  await page.waitForFunction(
    () => (document.querySelector('[data-region="session/peer-id"]')?.textContent ?? '').trim() !== '',
    null,
    { timeout: START_MS },
  )
  const peerId = await runningPeerId(page)
  if (peerId === null) throw new Error('the tab reported a running node with no peer id')
  return peerId
}

describe('AUTH-06 — the way in: a visitor registers, returns, and is the same node', () => {
  let page: Page
  let firstPeerId: string

  it('shows the invitation to a visitor who has not logged in, and has written nothing', async () => {
    page = await visit(journey)

    // The gate is still the FIRST thing rendered, and that is a measured constraint rather
    // than a preference: `artifact-fetch-gate.e2e.test.ts`'s arm A waits for `#gate` to be
    // un-hidden immediately after load, so a sign-in screen placed in front of it times that
    // arm out and takes one of Phase 39's conditions of entry with it.
    await waitVisible(page, '#gate', 30_000)
    await waitHidden(page, '#signin')

    await page.click('#allow')

    // The PRESENCE half. An absence assertion on its own passes on a page that failed to
    // load at all, so the invitation being on screen is asserted in the same case.
    await waitVisible(page, '#signin', 30_000)
    await waitVisible(page, '#signin-register')
    await waitHidden(page, '#main')
    const why = (await page.locator('#signin-why').textContent()) ?? ''
    expect(why.length, '#signin-why rendered nothing, so no visitor was told what this is').toBeGreaterThan(40)

    // The ABSENCE half: nothing runs and nothing was written.
    expect(await page.evaluate(() => window.o2.activity())).toBeNull()
    const dump = await identityDump(page)
    expect(
      dump.map((record) => record.key),
      'a visitor who has not logged in must have no sealed identity written for them',
    ).not.toContain('node-seed-sealed')
    expect(
      dump.filter((record) => record.kind === 'bytes' && record.base64 !== '').map((record) => record.key),
      'a visitor who has not logged in must have no seed-shaped record written for them',
    ).not.toContain('node-seed')
  }, 180_000)

  it('registers with a passphrase, seals the identity, and the node comes up with no further click', async () => {
    await register(page, SPEC_PASSPHRASE)

    // Unlock reveals `#main` — NOT "a node is running". Four e2e fixtures serve this page
    // with no relay at all and a node can never come up there; gating the surface on a
    // running node would make those pages unreachable.
    await waitVisible(page, '#main', 120_000)
    await waitHidden(page, '#signin')

    firstPeerId = await waitForRunning(page)
    expect(firstPeerId).toMatch(/^12D3Koo/)

    // **No `#join` click happened**, and this is the reading rather than the claim: the only
    // manual start control on this page was never enabled while a node came up on it. It
    // cannot see a page that enabled and re-disabled `#join` inside one tick; what it can see
    // is a surface that requires a second press, which is what the ruling forbids.
    expect(
      await page.locator('#join').isDisabled(),
      'the node started, and the manual Start control was available — so this page still asks '
        + 'a signed-in visitor to press something, which is the half of the ruling that says '
        + 'the node should already be running',
    ).toBe(true)

    const dump = await identityDump(page)
    // The floor, before any absence is read off this dump: a dump smaller than the needles
    // it is searched for cannot have found them and cannot have lost them either.
    expect(dump.length, 'the identity database holds fewer records than a sealed identity needs').toBeGreaterThanOrEqual(2)
    expect(searchableBytes(dump)).toBeGreaterThanOrEqual(2 * SEED_BYTES)

    const sealed = dump.find((record) => record.key === 'node-seed-sealed')
    expect(sealed, 'registering wrote no sealed record').toBeDefined()
    const envelope = parseSealedSecret(JSON.parse(sealed?.json ?? 'null'))
    expect(envelope, 'the stored record is not an envelope parseSealedSecret accepts').not.toBeNull()
    if (envelope === null) return
    const ciphertext = Buffer.from(envelope.ciphertext, 'base64url')
    // 32 secret bytes plus a 16-byte Poly1305 tag. A record longer than that is carrying
    // something beside the seed; one shorter is not a sealed seed.
    expect(
      ciphertext.length,
      `the sealed ciphertext is ${String(ciphertext.length)} bytes, and a sealed 32-byte seed is 48`,
    ).toBe(SEED_BYTES + 16)

    // What this case CANNOT see, said in code as well as in the header: the minted seed's
    // bytes are unknown here, so the only plaintext this can refuse is one of the right
    // SHAPE under the pre-AUTH-06 key. The adoption case below plants a known seed and
    // carries the byte-level reading.
    expect(
      dump.filter((record) => record.kind === 'bytes' && record.key === 'node-seed'),
      'a plaintext seed record survived registration',
    ).toEqual([])
  }, 240_000)

  it('CRITERION 3 — a returning visitor with the correct passphrase is the same node, twice over', async () => {
    for (const round of [1, 2]) {
      await revisit(page)

      // Login mode: ONE passphrase field. Two would mean the page offered to make a second
      // identity to somebody who already has one.
      await waitVisible(page, '#signin', 30_000)
      await waitVisible(page, '#signin-login')
      await waitVisible(page, '#signin-passphrase')
      await waitHidden(page, '#signin-passphrase-again')
      await waitHidden(page, '#signin-register')

      await logIn(page, SPEC_PASSPHRASE)
      await waitVisible(page, '#main', 120_000)
      const again = await waitForRunning(page)
      expect(
        again,
        `round ${String(round)}: the returning visitor came back as a different node, which is `
          + 'the whole of what criterion 3 forbids',
      ).toBe(firstPeerId)
    }
  }, 300_000)

  it('the certificate is left unsealed and survives the lock', async () => {
    // Planted rather than enrolled for: this fixture stands up no provider. What is being
    // read is criterion 1's deliberate exemption — the certificate is public material, is
    // not sealed, and a start that seals the seed must leave it readable. `resolveCertificate`
    // returns `null` before touching the store when no enrolment is configured
    // (`browser-node.ts:769`), so this record is inert during the start below.
    const nodeKey = nodeKeyForPeerId(firstPeerId)
    expect(nodeKey, 'the running peer id yielded no node key, so nothing could be planted').not.toBeNull()
    if (nodeKey === null) return
    await page.evaluate(
      async (options: { readonly database: string; readonly nodeKey: string }) => {
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
            tx.objectStore('identity').put(
              {
                nodeKey: options.nodeKey,
                userKey: 'ab'.repeat(32),
                operatorId: 'a-fixture-operator',
                discoverability: 'relayed',
                relayIds: [],
                issuedAt: Date.now(),
                expiresAt: Date.now() + 86_400_000,
                issuer: 'cd'.repeat(32),
                signature: 'not-a-real-signature',
              },
              'certificate',
            )
            tx.oncomplete = (): void => {
              db.close()
              resolve()
            }
            tx.onerror = (): void => {
              db.close()
              reject(tx.error ?? new Error('the planted certificate put failed'))
            }
          }
        })
      },
      { database: IDENTITY_DB, nodeKey },
    )

    await revisit(page)
    await logIn(page, SPEC_PASSPHRASE)
    await waitVisible(page, '#main', 120_000)
    await waitForRunning(page)

    const dump = await identityDump(page)
    const certificate = dump.find((record) => record.key === 'certificate')
    expect(certificate, 'the stored certificate did not survive an unlock').toBeDefined()
    expect(
      certificate?.kind,
      'the certificate came back as bytes, which means something sealed it — criterion 1 '
        + 'exempts it deliberately, and an exemption that stopped applying would present as '
        + 'a tab that silently lost its enrolment',
    ).toBe('object')
    expect(JSON.parse(certificate?.json ?? '{}')).toMatchObject({ nodeKey })
  }, 300_000)

  it('BROW-01/BROW-06 — the gate is answered before the passphrase field is shown', async () => {
    // The ordering both those requirements rest on, read under the new entry path. It is the
    // one that would be easiest to lose here: `DISCLOSURE_VERSION` moves to '8' in this plan,
    // so every stored consent in existence goes stale on the first load after it lands.
    await page.evaluate(async () => {
      await window.o2.revokeConsent()
    })
    await revisit(page)

    await waitVisible(page, '#gate', 30_000)
    await waitHidden(page, '#signin')
    await waitHidden(page, '#main')
    expect(
      await page.evaluate(() => window.o2.activity()),
      'a tab with a sealed identity started something before its visitor answered the gate',
    ).toBeNull()

    await page.click('#allow')
    // And only now is the visitor asked for the passphrase — in login mode, because the
    // sealed record survived the consent being revoked. Consent is about what the page may
    // do; the identity is about who the visitor is, and revoking one must not destroy the other.
    await waitVisible(page, '#signin', 30_000)
    await waitVisible(page, '#signin-login')
  }, 180_000)
})
