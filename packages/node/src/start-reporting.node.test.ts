import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { encodeRequest, parseResponse } from '@o2/net'
import type { OutcomeCount, StartReportingConsent } from '@o2/core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { FabricNode } from './fabric-node.ts'
import type { FabricNodeOptions } from './fabric-node.ts'

/**
 * BROW-01 on the Node tier — a node that withheld its own row hands nobody that row.
 *
 * ## Why this file exists at all, which is the finding rather than the fix
 *
 * BROW-01 was found and closed as a *browser* defect: a visitor turned reporting off, the
 * page withheld the line from its own screen, and the node went on serving the identical
 * row to every peer that asked, because `BrowserNodeOptions` carried no consent for
 * `ownStartLedger` to consult. `packages/node/src/peer-ledger.e2e.test.ts` holds that
 * reading, over five real tabs in three engines.
 *
 * **This tier did not have that contradiction, because it had no consent concept at
 * all** — and that absence is the same failure seen from the other side. `PROJECT.md`'s
 * standing rule is that all nodes have equal functionality and only discovery differs. A
 * visitor who can decline to be counted, beside an operator who cannot, is that rule
 * broken in exactly the direction the sovereignty claim rests on. So `FabricNodeOptions`
 * grew the identical required field, `ownStartLedger` here is byte-identical to
 * `browser-node.ts`'s — `serve-agent-hooks.node.test.ts` holds that equality — and this
 * file is what stops the Node half of it being a field nothing ever exercises.
 *
 * ## What makes the reading non-vacuous, stated before the cases
 *
 * Every `FabricNode` composes the same label: `OWN_START_FAMILY` is `'other'`, because a
 * process that is not a browser is honestly that. So a bare *absence* of `other` in one
 * node's answer proves very little on its own — a dead node, a refused connection and a
 * ledger that stopped serving anything all produce it. Three things are therefore read
 * together, in one pass, over one set of connections:
 *
 * 1. **A consenting node, asked identically, answers with its own `other` row.** The
 *    comparative half. Without it the negative is satisfied by a broken fixture.
 * 2. **The asker tells nothing** — every request below carries `outcome: null` — so a row
 *    in an answer cannot have been put there by the asking.
 * 3. **The withholding node still serves what a peer consented to tell it.** A
 *    `firefox 148` row is pushed into it by a peer and comes back out; no `FabricNode`
 *    composes that label, so its presence has exactly one source. Declining to report is
 *    not declining to relay what others chose to send, and a node that had simply stopped
 *    answering would fail this.
 *
 * ## The boundary this file crosses
 *
 * **Real transport, not a real process.** Three `FabricNode`s over tcp + noise + yamux on
 * loopback, with the production `report` frame — `encodeRequest`/`parseResponse` — rather
 * than a hand-rolled one. The `counts` array asserted below is the literal payload the
 * answering node put on the wire. What is *not* established here is anything about a
 * browser tab; that is the e2e file's, and it reads five of them.
 *
 * Node-only: real TCP listeners and real temporary blockstore directories.
 */

/** A label no `FabricNode` composes, so a row carrying it has exactly one source. */
const FOREIGN_LABEL = 'firefox 148'

let workdir: string
const running: FabricNode[] = []

async function startNode(name: string, startReporting: StartReportingConsent): Promise<FabricNode> {
  const node = await FabricNode.start({
    relayAdmission: 'admits-any-peer',
    // The subject. Both values appear in this file and nowhere else in the repository
    // states the withholding one, which is deliberate: it is a person's answer, and a test
    // fixture is the only place that can hold both at once without either being a lie.
    startReporting,
    blockstoreDir: join(workdir, name),
    // Port 0: the OS picks a free port, so concurrent runs cannot collide.
    listen: ['/ip4/127.0.0.1/tcp/0'],
    rpcTimeoutMs: 20_000,
    // DET-03. Nothing here runs a guest module — the only verb exercised is `report`.
    trustAnchors: 'runs-unsigned-artifacts',
  })
  running.push(node)
  return node
}

let asker: FabricNode
let open: FabricNode
let withheld: FabricNode

/**
 * The counts one node hands the asker, as the literal wire payload.
 *
 * Asks with `outcome: null` — the asker tells the answering node nothing — so every row
 * that comes back was already held there. Throws on a non-`report` reply rather than
 * returning an empty list, because "answered with nothing" and "did not answer" are
 * different findings and only one of them is what this file measures.
 */
async function countsServedBy(node: FabricNode): Promise<readonly OutcomeCount[]> {
  const body = await asker.rpc.request(
    node.peerId,
    encodeRequest({ kind: 'report', outcome: null }),
  )
  const response = parseResponse(body)
  if (response === null || response.kind !== 'report')
    throw new Error(`${node.peerId} did not answer a report request`)
  return response.counts
}

const labelsOf = (counts: readonly OutcomeCount[]): readonly string[] =>
  [...counts].map((row) => row.browser).sort()

beforeAll(async () => {
  workdir = await mkdtemp(join(tmpdir(), 'o2-start-reporting-'))
  asker = await startNode('asker', 'reports-its-own-start')
  open = await startNode('open', 'reports-its-own-start')
  withheld = await startNode('withheld', 'withholds-its-own-start')
  // Outward dials from the one node that asks. Asserted rather than assumed: a dial that
  // silently resolved to the wrong peer would make every reading below meaningless.
  const dialed = await Promise.all(
    [open, withheld].map((node) => asker.dial(node.multiaddrs[0] as string)),
  )
  expect([...dialed].sort()).toEqual([open.peerId, withheld.peerId].sort())
}, 120_000)

afterAll(async () => {
  for (const node of running) await node.stop().catch(() => {})
  await rm(workdir, { recursive: true, force: true }).catch(() => {})
}, 120_000)

describe('a node states whether its own start row may leave the machine — BROW-01', () => {
  it('serves its own row when it consented, and none when it withheld', async () => {
    // **The comparative pair, taken in one pass over one set of connections.** Two nodes
    // that differ in exactly one option value, asked the identical question by the
    // identical peer within milliseconds of each other. An absolute reading of the second
    // alone would be satisfied by a fixture that never connected.
    const fromOpen = await countsServedBy(open)
    const fromWithheld = await countsServedBy(withheld)

    // The positive. `other` is what `OWN_START_FAMILY` composes, and the count is exactly
    // one: one node, one start, recorded once at construction. Asserted whole rather than
    // by membership, because a count of two would mean the row is being recorded twice and
    // the metric's `n` is a fiction — which is the one failure mode a report like this
    // must not have.
    expect(fromOpen).toEqual([{ browser: 'other', result: 'started', count: 1 }])

    // The subject. Not merely "does not contain `other`" — the whole payload is empty,
    // because at this point nobody has told this node anything either, so there is nothing
    // else it could truthfully hold.
    expect(fromWithheld).toEqual([])

    // The local reading agrees with the wire — the cross-check mutation-ledger entry `M37`
    // argues for, which is the defect class of reading the right value off the wrong
    // object. `startReport` reads the same ledger `serveAgent` answers out of.
    expect(open.startReport.reported).toBe(1)
    expect(withheld.startReport.reported).toBe(0)
  }, 120_000)

  it('still relays what a peer chose to tell it, so the silence is about itself alone', async () => {
    // **The anti-vacuity case, and it is the one that makes the case above mean
    // "withheld" rather than "broken".** A node that had stopped holding a ledger, or
    // stopped answering, produces the same empty list.
    //
    // The row is pushed in through the production request path: `serveAgent`'s report
    // branch records `request.outcome`, which is a peer stating its own outcome and is
    // therefore consented data, unlike the row this node declined to file about itself.
    const pushed = await asker.rpc.request(
      withheld.peerId,
      encodeRequest({
        kind: 'report',
        outcome: { browser: FOREIGN_LABEL, result: { kind: 'started' } },
      }),
    )
    expect(parseResponse(pushed)?.kind).toBe('report')

    const after = await countsServedBy(withheld)
    // It serves the peer's row…
    expect(after).toEqual([{ browser: FOREIGN_LABEL, result: 'started', count: 1 }])
    // …and still not its own, which is the whole claim: the refusal is about this node's
    // own datum and about nothing else that passes through it.
    expect(labelsOf(after)).not.toContain('other')
  }, 120_000)

  it('declares the choice required, so no construction site can omit one', () => {
    // The compile-time guarantee. A runtime test cannot observe a required property, so
    // this is `tsc --noEmit`'s reading rather than vitest's: widen the field back to
    // optional and the suppression below becomes an "Unused '@ts-expect-error' directive"
    // error under `npm run typecheck`. Same instrument, same reason, as
    // `browser-node-contract.node.test.ts` holds for `createWorker` one tier over — and
    // this is the guard that actually stops a silent default coming back, because every
    // text count in this repository would happily read zero for a field that had a
    // default and was therefore written nowhere.
    const full: FabricNodeOptions = {
      relayAdmission: 'admits-any-peer',
      trustAnchors: 'runs-unsigned-artifacts',
      startReporting: 'reports-its-own-start',
    }
    const { startReporting: _unused, ...rest } = full
    // @ts-expect-error BROW-01 — startReporting is required; omitting it must fail `tsc --noEmit`, naming 'startReporting'.
    const withoutAChoice: FabricNodeOptions = rest
    expect(withoutAChoice.trustAnchors).toBe('runs-unsigned-artifacts')
  })
})
