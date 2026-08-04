import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { verifyCapabilityRecord } from '@o2/core'
import type { CanonicalValue } from '@o2/core'
import { SEED_BYTES, identityFromSeed } from '@o2/libp2p'
import { RpcRecordIndex, encodeRequest, parseResponse } from '@o2/net'
import { CID } from 'multiformats/cid'
import { sha256 } from 'multiformats/hashes/sha2'
import * as raw from 'multiformats/codecs/raw'
import { FabricNode } from './fabric-node.ts'
import type { FabricNodeOptions } from './fabric-node.ts'

/**
 * AUTH-01 — a node's identity is fetchable, not just held.
 *
 * The `records` request kind, its wire encoding and its handler branch have all existed
 * since Phase 6 and every production node answered `null` to it, because every production
 * call site passed `'serves-no-records'`. Plan 17-03 gave a node a certificate; this file
 * measures that a *peer* can read it. A certificate nobody can fetch is not an advertised
 * identity.
 *
 * **`RpcRecordIndex` is used here as a TEST client and that is all it is in this phase.**
 * It has no production caller, and Plan 17-04 deliberately does not give it one — its
 * `#ask` swallows the transport error (`net/src/discovery.ts:62-68`) so an unreachable
 * peer and a peer answering `records: null` both fall out as `undefined`. That is correct
 * for the multi-peer lookup Phase 18 will use it for and wrong for a per-peer verdict,
 * which is why `PeerVerifier` issues its own request. Here there is exactly one peer in
 * the thunk and the distinction does not arise.
 *
 * **Nothing below branches on a kind of node.** The provider is a `FabricNode` with one
 * boolean set. `rpcTimeoutMs: 10_000` is set for this file rather than inherited, for the
 * reason `node-enrollment.node.test.ts` records; nothing here measures wall-clock.
 */

/** Fixed patterns, not random — a failing run must be reproducible. */
const ALICE_SEED = new Uint8Array(SEED_BYTES).fill(0xc1)
const BOB_SEED = new Uint8Array(SEED_BYTES).fill(0xc2)

/**
 * Deliberately **not** a hex key.
 *
 * `sovereignFor` must carry the certificate's own `userKey`, which is the value
 * `discoverExecutors` compares against (`core/src/discovery.ts:286-290`), and never the
 * operator's `ownerId` label. Choosing a label that could never be mistaken for a key is
 * what makes the regression visible: publishing `sovereignty.ownerId` instead would put
 * `'alice'` into a signed statement no sovereign query could ever match.
 */
const ALICE_OWNER_ID = 'alice'

let workdir: string
const nodes: FabricNode[] = []

beforeEach(async () => {
  workdir = await mkdtemp(join(tmpdir(), 'o2-records-'))
})

/** Outer 20 s against Vitest's default 10 s `hookTimeout` — see `node-enrollment.node.test.ts`. */
afterEach(async () => {
  await Promise.all(nodes.splice(0).map((n) => n.stop().catch(() => {})))
  await rm(workdir, { recursive: true, force: true })
}, 20_000)

const start = async (options: Partial<FabricNodeOptions> = {}): Promise<FabricNode> => {
  const node = await FabricNode.start({
    listen: ['/ip4/127.0.0.1/tcp/0'],
    trustAnchors: 'runs-unsigned-artifacts',
    rpcTimeoutMs: 10_000,
    ...options,
  })
  nodes.push(node)
  return node
}

/** A provider: one boolean different from every other node in this file. */
const startProvider = async (): Promise<FabricNode> =>
  start({ blockstoreDir: join(workdir, 'provider'), issuesCertificates: 'issues-without-an-aggregate-budget' })

/** The TCP multiaddr a peer dials this node at, peer id included. */
const addrOf = (node: FabricNode): string => {
  const addr = node.multiaddrs.find((ma) => ma.includes('/tcp/') && !ma.includes('/p2p-circuit'))
  if (addr === undefined) throw new Error(`no dialable address on ${node.peerId}`)
  return addr
}

/** Ask `asker` for `target`'s records over the wire, through the one peer that has them. */
const recordsOf = async (
  asker: FabricNode,
  servedBy: FabricNode,
  nodeKey: string,
): Promise<Awaited<ReturnType<RpcRecordIndex['recordsFor']>>> =>
  new RpcRecordIndex(asker.rpc, () => [servedBy.peerId]).recordsFor(nodeKey)

/** A `providers` answer, read straight off the wire rather than through the adapter. */
const providersOf = async (asker: FabricNode, servedBy: FabricNode, cid: CID): Promise<readonly string[]> => {
  const body: CanonicalValue = await asker.rpc.request(
    servedBy.peerId,
    encodeRequest({ kind: 'providers', cid }),
  )
  const response = parseResponse(body)
  if (response === null || response.kind !== 'providers') {
    throw new Error(`expected a providers answer, got ${String(response?.kind)}`)
  }
  return response.nodeKeys
}

describe('AUTH-01 — a node with a certificate serves it to a peer that asks', () => {
  /**
   * Reddened by changing `index: records ?? 'serves-no-records'` back to the bare sentinel
   * in `fabric-node.ts`.
   */
  it('answers a records request with its own certificate and a capability record over the same key', async () => {
    const provider = await startProvider()

    const a = await start({
      blockstoreDir: join(workdir, 'a'),
      sovereignty: { ownerId: ALICE_OWNER_ID, canExecuteSovereign: true },
      enrollment: {
        userPrivateKey: ALICE_SEED,
        operatorId: 'harbour-ops',
        providerAddr: addrOf(provider),
      },
    })
    // A third node, holding no certificate of its own — so nothing it reads about A can
    // have come from its own state.
    const b = await start({ blockstoreDir: join(workdir, 'b') })
    await b.dial(addrOf(a))

    const records = await recordsOf(b, a, a.nodeKey)
    expect(records).toBeDefined()
    expect(records?.certificate).toStrictEqual(a.certificate)

    // The record is signed by the same key the certificate is about, which is the whole
    // reason a self-signed capability record is worth anything at all.
    expect(records?.capabilities.nodeKey).toBe(a.nodeKey)
    expect(verifyCapabilityRecord(records!.capabilities, Date.now())).toBe(true)

    // The validity window is the certificate's own, so a node stops advertising
    // capabilities at exactly the moment it stops being verifiable.
    expect(records?.capabilities.issuedAt).toBe(a.certificate?.issuedAt)
    expect(records?.capabilities.expiresAt).toBe(a.certificate?.expiresAt)

    // `features: []` is honest, not a stub. No feature-detection dependency exists in
    // this repository — `wasm-feature-detect` is recommended in CLAUDE.md and is not
    // installed, and `packages/browser/src/wasm-probes.ts` builds probe modules and
    // detects no engine features. `discoverExecutors` only excludes on features a caller
    // asked for, so an empty list excludes nobody. Populating it is Phase 18's.
    expect(records?.capabilities.features).toStrictEqual([])
  }, 40_000)

  /**
   * The one field this plan configures rather than derives, and the exact regression the
   * fixture's non-hex `ownerId` exists to catch.
   *
   * Reddened by changing `[certificate.userKey]` to `[sovereignty.ownerId]` in
   * `fabric-node.ts`.
   */
  it('publishes the certificate’s own userKey as sovereignFor, never the operator’s label', async () => {
    const provider = await startProvider()
    const alice = await identityFromSeed(ALICE_SEED)
    expect(alice.nodeKey).not.toBe(ALICE_OWNER_ID)

    const a = await start({
      blockstoreDir: join(workdir, 'a'),
      sovereignty: { ownerId: ALICE_OWNER_ID, canExecuteSovereign: true },
      enrollment: {
        userPrivateKey: ALICE_SEED,
        operatorId: 'harbour-ops',
        providerAddr: addrOf(provider),
      },
    })
    const b = await start({ blockstoreDir: join(workdir, 'b') })
    await b.dial(addrOf(a))

    // Asserted against the value that was passed as the enrollment user key, not against
    // anything an operator typed into `--owner-id`.
    expect(a.certificate?.userKey).toBe(alice.nodeKey)

    const records = await recordsOf(b, a, a.nodeKey)
    expect(records?.capabilities.sovereignFor).toStrictEqual([alice.nodeKey])
    expect(records?.capabilities.sovereignFor).not.toContain(ALICE_OWNER_ID)
  }, 40_000)

  /**
   * Both cleared-for-nobody readings, because the field's meaning is "cleared" and a
   * one-sided test could not tell an always-empty list from a correct one.
   *
   * Reddened by the same `[sovereignty.ownerId]` change (the first node below would then
   * publish `['alice']`) and by dropping the `canExecuteSovereign` condition.
   */
  it('publishes an empty sovereignFor for a node cleared for nobody, and for one given no sovereignty at all', async () => {
    const provider = await startProvider()
    const providerAddr = addrOf(provider)

    const notCleared = await start({
      blockstoreDir: join(workdir, 'not-cleared'),
      sovereignty: { ownerId: ALICE_OWNER_ID, canExecuteSovereign: false },
      enrollment: { userPrivateKey: ALICE_SEED, operatorId: 'harbour-ops', providerAddr },
    })
    const noOption = await start({
      blockstoreDir: join(workdir, 'no-option'),
      enrollment: { userPrivateKey: BOB_SEED, operatorId: 'harbour-ops', providerAddr },
    })

    const b = await start({ blockstoreDir: join(workdir, 'b') })
    await b.dial(addrOf(notCleared))
    await b.dial(addrOf(noOption))

    expect((await recordsOf(b, notCleared, notCleared.nodeKey))?.capabilities.sovereignFor).toStrictEqual([])
    expect((await recordsOf(b, noOption, noOption.nodeKey))?.capabilities.sovereignFor).toStrictEqual([])
  }, 40_000)

  /**
   * A node serves its own records and nobody else's. It is not a directory.
   *
   * **Why `[]` here, after Plan 18-03.** Until that plan the reason was *"`provide()` is
   * never called and the index holds exactly one publication"* — the index was empty of
   * providers because nothing ever filled it. Under owner ruling D1 a node answers
   * `providers` from its own store at ask time, so the reason is now narrower and is the
   * only one this assertion still carries: **A does not hold that block.** Nothing in this
   * file puts it anywhere. The provider answer for a block a node *does* hold is measured
   * in `provider-answering.node.test.ts`, which is where the positive reading belongs.
   *
   * No assertion in this file changed for Plan 18-03 — the whole file passed unedited, and
   * that was the regression bar the plan named. Only this reason was corrected, because a
   * comment describing the old mechanism beside the new code is worse than no comment.
   *
   * Reddened by publishing anything beyond this node's own records.
   */
  it('answers undefined for a node key that is not its own, and [] for providers', async () => {
    const provider = await startProvider()
    const a = await start({
      blockstoreDir: join(workdir, 'a'),
      sovereignty: { ownerId: ALICE_OWNER_ID, canExecuteSovereign: true },
      enrollment: {
        userPrivateKey: ALICE_SEED,
        operatorId: 'harbour-ops',
        providerAddr: addrOf(provider),
      },
    })
    const b = await start({ blockstoreDir: join(workdir, 'b') })
    await b.dial(addrOf(a))

    // The instrument is shown reading: A's own key is answered, so `undefined` for
    // another key is a filter rather than a dead channel.
    expect(await recordsOf(b, a, a.nodeKey)).toBeDefined()
    expect(await recordsOf(b, a, b.nodeKey)).toBeUndefined()

    const cid = CID.createV1(raw.code, await sha256.digest(new Uint8Array([1, 2, 3])))
    expect(await providersOf(b, a, cid)).toStrictEqual([])
  }, 40_000)
})

describe('AUTH-01 — a node that never enrolled is unchanged by this plan', () => {
  /**
   * Decision 9's first row.
   *
   * **The sentence that stood here is now false and is replaced rather than deleted.** It
   * read: *"Such a node still passes the sentinel, so `'serves-no-records'` appears exactly
   * once in `fabric-node.ts` and `serve-agent-hooks.node.test.ts` needs no change."* Plan
   * 18-03 removed the sentinel from both factories — a node with no certificate now serves
   * a `SelfRecordIndex` whose `records` is `'holds-no-records'` — so that count is 0 and
   * that file did change. What did **not** change is the reading below: `agent.ts`'s
   * `records` branch maps an `undefined` lookup to `records: null` with `?? null`, so the
   * frame on the wire is byte-identical to the sentinel's, which is why this test passed
   * unedited across the change.
   *
   * **No deletion in this plan turns this red, and the plan's claim that one does was
   * measured false rather than repeated.** 17-04's proof block says it is reddened by
   * changing `certificate === null ? null : new MemoryRecordIndex()` to always construct
   * one. That mutation was planted and run: all five tests in this file stayed green. An
   * always-constructed index that never had anything published into it answers
   * `recordsFor` with `undefined`, `agent.ts`'s `records` branch maps that to
   * `records: null` with `?? null`, and the frame on the wire is byte-identical to the
   * sentinel's. There is nothing for a certificate-less node to publish, so no edit
   * *inside* this plan can make it publish anything.
   *
   * It is therefore a regression bar and not a feature proof, in the same sense
   * `node-enrollment.node.test.ts`'s "a node not told to enrol" test is one. Its value is
   * that an edit *elsewhere* — making a node serve records it did not sign — fails here.
   */
  it('answers records with null and providers with []', async () => {
    const a = await start({ blockstoreDir: join(workdir, 'plain-a') })
    const b = await start({ blockstoreDir: join(workdir, 'plain-b') })
    await b.dial(addrOf(a))

    expect(a.certificate).toBeNull()
    expect(await recordsOf(b, a, a.nodeKey)).toBeUndefined()

    const cid = CID.createV1(raw.code, await sha256.digest(new Uint8Array([4, 5, 6])))
    expect(await providersOf(b, a, cid)).toStrictEqual([])
  }, 40_000)
})
