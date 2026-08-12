import { ed25519 } from '@noble/curves/ed25519.js'
import {
  EnrollmentAuthority,
  LocalCapacity,
  MemoryBlockstore,
  MemoryNetwork,
  WasmExecutor,
  canonicalCid,
  commitmentDigest,
  placeWithOffers,
  requestEnrollment,
  toHex,
} from '@o2/core'
import type { ExecutionOutcome, Executor, NodeDescriptor, Task } from '@o2/core'
import { describe, expect, it } from 'vitest'
// Test-only relative import — see the note in distributed.test.ts.
import { MODULE_WRITES_PARTITION } from '../../core/src/executor/fixtures.ts'
import { pauseMisreported, pausedRefusal, serveAgent } from './agent.ts'
import { rpcAdmission } from './discovery.ts'
import { enrolOverRpc } from './enrol-client.ts'
import { encodeRequest, parseResponse } from './protocol.ts'
import type { AgentResponse } from './protocol.ts'
import { RpcEndpoint } from './rpc.ts'

/**
 * SCHED-03 / SCHED-06 — PAUSED, a node that is alive, reachable, unchanged in what
 * it can do, and declining all work right now.
 *
 * ## What this file measures, and against what
 *
 * `LocalCapacity.slots` floors at 1 and says why at the getter: *"at zero slots
 * `#decide` would refuse everything, which is a node that has left rather than a
 * node that is going slowly."* So the capacity mechanism deliberately cannot express
 * a deliberate stop, and before this file an operator who wanted one had to kill the
 * process — losing discoverability and reservations — or throttle, which the floor
 * makes impossible. The three states are distinct facts and each wants a different
 * answer from a requestor:
 *
 * | state | what it is | what a requestor should do |
 * |---|---|---|
 * | busy | at capacity, load drains | retry soon |
 * | **paused** | declining all work, by choice | drop from this shard's candidates, keep the node known |
 * | off | unreachable | let the transport re-dial |
 *
 * Every assertion below is therefore paired: the same node, the same capacity, the
 * same eligibility, measured with the pause on and with it off. A refusal read only
 * in the paused arm would be indistinguishable from a node that refuses everything.
 *
 * ## Why the membership of `DeclinedWhilePaused` is measured term by term
 *
 * `declinedWhilePaused` is a **type predicate**, and TypeScript does not check a
 * predicate's body against the type it declares. So the set's membership is carried by
 * nothing at all unless a test carries it, and on 2026-08-11 that was measured rather
 * than reasoned: `|| kind === 'commit'` was deleted, the whole suite compiled and stayed
 * green, and a paused node would have run round 1 of a ceremony — a real
 * `WebAssembly.compile`, a real slot, a filed commitment — while answering the offer
 * beside it with "declining all work right now". Adding `|| kind === 'reveal'` likewise
 * compiled and stayed green, and strands a ceremony the node already agreed to join.
 *
 * Every term of that expression therefore has an `it` below that goes red when the term
 * is removed, and every deliberate **exclusion** has one that goes red when the term is
 * added. All twelve were planted and watched red on 2026-08-11 — `exec`, `commit`,
 * `combine`, `offer` removed; `reveal`, `enrol`, `enrol-challenge`, `block`,
 * `providers`, `records`, `reservations`, `report` added — each restored by the inverse
 * of its own edit and compared byte-identical with `cmp`. The docblock on
 * `DeclinedWhilePaused` argues each exclusion; these are what make the argument a
 * measurement.
 *
 * ## Why the refusal text is asserted rather than a type
 *
 * `paused: ` joins `over-committed: `, `egress refused: `, `unauthorized: ` and
 * `unreachable: ` as wire vocabulary — composed in exactly one place and asserted
 * here by text so it cannot drift. What that deliberately does **not** buy is
 * control flow: `agent.ts` already records that a requestor "cannot tell
 * `malformed request` from `over-committed: …` without reading the string", and a
 * reason string is consumed as an explanation and never as a decision. The
 * requestor-side half of the table above — *do not retry soon* — is consequently
 * **not** delivered by this mechanism and is not claimed anywhere below.
 *
 * ## Bare suffix on purpose
 *
 * `serveAgent` is portable and `vitest.config.ts` runs `packages/&#42;/src/&#42;&#42;/&#42;.test.ts` in
 * both the `node` and `browser` projects, so this spec runs in Chromium too.
 */

/** One shared network: every `it` uses distinct node ids, so nothing observes another's frames. */
const network = new MemoryNetwork()

/** dag-cbor `[]` — the one input block every task in this file reads. */
const INPUT_BYTES = new Uint8Array([0x80])

/**
 * Two combine inputs, dag-cbor `[1]` and `[2]`.
 *
 * Two rather than one because `parseRequest` refuses a combine naming fewer than two
 * inputs — `deriveReduceTree` promotes a lone child rather than wrapping it — and
 * distinct from {@link INPUT_BYTES} so the CIDs differ.
 */
const PARTIAL_BYTES = new Uint8Array([0x81, 0x01])
const SECOND_PARTIAL_BYTES = new Uint8Array([0x81, 0x02])

/** `enrol-agent.test.ts`' helper, copied rather than shared: a test fixture is not an API. */
function keypair(seed: number): { readonly priv: Uint8Array; readonly pub: string } {
  const priv = new Uint8Array(32).fill(seed)
  return { priv, pub: toHex(ed25519.getPublicKey(priv)) }
}

const provider = keypair(90)
const owner = keypair(92)

/**
 * A real signing authority, one per test that needs one.
 *
 * Not shared, because AUTH-04's limiter is per user key and a second issuance inside one
 * window would be refused for a reason that has nothing to do with pausing — which is the
 * kind of confound this file's paired arms exist to keep out.
 */
function newAuthority(): EnrollmentAuthority {
  return new EnrollmentAuthority({
    providerPrivateKey: provider.priv,
    maxIssuedPerWindow: 'issues-without-an-aggregate-budget',
    issuance: 'remembers-only-within-this-process',
  })
}

/**
 * A value an untyped host hands over where a `boolean` was declared.
 *
 * **Reproduced rather than asserted past, and that is the whole reason this exists.** A
 * type assertion here would be the test telling the type checker to look away, and it
 * would also misdescribe the defect: a *typed* call site genuinely cannot reach the
 * branch under test, because `() => boolean` refuses a `() => void` (`Type 'void' is not
 * assignable to type 'boolean'`, measured 2026-08-11). What can reach it is the
 * deployment `PROJECT.md` declares — this agent embedded in a host application, with
 * `browser-node.ts` taking `options.paused` from whatever that host hands it. `JSON.parse`
 * is that boundary in one line: it returns `any`, which is exactly how such a value
 * really arrives, and reading a key off the parsed object yields `undefined` for a key
 * that is absent — the forgotten-`return` value, which no literal in a checked file could
 * put here.
 *
 * `'{}'` gives `undefined`; `'{"paused": null}'` gives `null`; `'{"paused": "yes"}'`
 * gives a string. All three are falsy or truthy by accident, which is the hazard.
 */
function fromUntypedHost(json: string): boolean {
  return JSON.parse(json)['paused']
}

/**
 * A `WasmExecutor` that counts the calls that reached it.
 *
 * The instrument the `commit` case needs and could not get any other way. A paused node
 * that answered a `commit` correctly and a paused node that ran the whole task and threw
 * the answer away are indistinguishable from the reply frame alone — `pausedAnswer`'s
 * `commit` arm and a refusal composed after execution are the same `{kind:'error'}`
 * shape. The count is what separates them: `execute` is where the module is compiled and
 * instantiated, so `entered === 0` is the statement that no `WebAssembly.compile`
 * happened, made at the only place that can make it.
 *
 * A wrapper rather than a stand-in, so the node under test still runs the real executor
 * and the control arms below execute real WASM.
 */
class CountingExecutor implements Executor {
  readonly #inner: Executor
  #entered = 0

  constructor(inner: Executor) {
    this.#inner = inner
  }

  get nodeId(): string {
    return this.#inner.nodeId
  }

  /** How many times the executor was entered — never how many times it succeeded. */
  get entered(): number {
    return this.#entered
  }

  async execute(task: Task): Promise<ExecutionOutcome> {
    this.#entered += 1
    return this.#inner.execute(task)
  }
}

interface ServingNode {
  readonly nodeId: string
  readonly capacity: LocalCapacity
  /** Flipped by a test between requests — the whole point of the thunk. */
  pause(value: boolean): void
  /**
   * Set the pause control to answer with something that is not a boolean — SCHED-03's
   * third answer. Take the value from {@link fromUntypedHost}; a literal cannot be one.
   */
  misreport(value: boolean): void
  task(partitionIndex: number): Task
  /** Blocks this node holds and will serve, paused or not. Also the combine's inputs. */
  readonly heldCid: Awaited<ReturnType<MemoryBlockstore['put']>>
  readonly secondHeldCid: Awaited<ReturnType<MemoryBlockstore['put']>>
  /** Calls that reached the executor — see {@link CountingExecutor}. */
  readonly entered: number
  close(): void
}

/**
 * One serving node with a real `LocalCapacity` and a live pause thunk.
 *
 * `maxConcurrent` is deliberately generous everywhere in this file: the claim under
 * test is that a node with room to spare still refuses, so a node that could have
 * been full for an unrelated reason would prove nothing.
 */
async function servingNode(options: {
  nodeId: string
  maxConcurrent?: number
  pausedAtStart?: boolean
  /** A real authority, for the two enrolment kinds a paused node still answers. */
  enroll?: EnrollmentAuthority
}): Promise<ServingNode> {
  const store = new MemoryBlockstore()
  const moduleCid = await store.put(MODULE_WRITES_PARTITION)
  const inputCid = await store.put(INPUT_BYTES)
  const heldCid = await store.put(PARTIAL_BYTES)
  const secondHeldCid = await store.put(SECOND_PARTIAL_BYTES)

  let paused: boolean = options.pausedAtStart ?? false
  const capacity = new LocalCapacity({
    nodeId: options.nodeId,
    maxConcurrent: options.maxConcurrent ?? 8,
  })
  const executor = new CountingExecutor(
    new WasmExecutor({ nodeId: options.nodeId, blockstore: store }),
  )
  const rpc = new RpcEndpoint(network.connect(options.nodeId), { timeoutMs: 5_000 })
  serveAgent({
    rpc,
    executor,
    blockstore: store,
    capacity,
    // Read on every request, never captured: an operator toggles this at runtime.
    paused: () => paused,
    authorize: 'serves-unauthenticated',
    egress: 'holds-no-registrations',
    index: 'serves-no-records',
    enroll: options.enroll ?? 'issues-no-certificates',
    ledger: 'keeps-no-ledger',
    reservations: 'relays-for-nobody',
    onDispatch: 'reports-no-dispatch',
    attest: 'signs-nothing',
  })

  return {
    nodeId: options.nodeId,
    capacity,
    heldCid,
    secondHeldCid,
    get entered() {
      return executor.entered
    },
    pause(value) {
      paused = value
    },
    misreport(value) {
      paused = value
    },
    task: (partitionIndex) => ({
      moduleCid,
      inputCid,
      partitionIndex,
      partitionCount: 8,
      label: 'public' as const,
    }),
    close() {
      rpc.close()
    },
  }
}

function requestorFor(nodeId: string): RpcEndpoint {
  return new RpcEndpoint(network.connect(`requestor-${nodeId}`), { timeoutMs: 5_000 })
}

async function ask(rpc: RpcEndpoint, to: string, body: Parameters<typeof encodeRequest>[0]): Promise<AgentResponse | null> {
  return parseResponse(await rpc.request(to, encodeRequest(body)))
}

describe('a paused node declines work it has room for', () => {
  it('refuses an offer it accepts when not paused, with the same slots free', async () => {
    const node = await servingNode({ nodeId: 'pause-offer' })
    const rpc = requestorFor('pause-offer')
    try {
      // The control arm. Without it a refusal below could be a node that refuses
      // everything for some reason nothing here named.
      const running = await ask(rpc, node.nodeId, { kind: 'offer', shardId: 's0' })
      expect(running?.kind).toBe('offer')
      if (running?.kind !== 'offer') throw new Error('fixture')
      expect(running.accepted).toBe(true)

      node.pause(true)
      const stopped = await ask(rpc, node.nodeId, { kind: 'offer', shardId: 's0' })
      if (stopped?.kind !== 'offer') throw new Error('fixture')
      expect(stopped.accepted).toBe(false)

      // Nothing was consumed by either question, so the second refusal is about the
      // posture and not about a slot the first one took.
      expect(node.capacity.inFlight).toBe(0)
      expect(node.capacity.peakInFlight).toBe(0)
    } finally {
      node.close()
      rpc.close()
    }
  })

  it('names the refusal `paused:` and never `over-committed:`, on all four work branches', async () => {
    const node = await servingNode({ nodeId: 'pause-named', pausedAtStart: true })
    const rpc = requestorFor('pause-named')
    try {
      // **The one literal in this file, and it is what pins the vocabulary.** `paused: `
      // joins `over-committed: `, `egress refused: `, `unauthorized: ` and
      // `unreachable: `, and a rename that nothing spelled out would be invisible. Every
      // *other* assertion below compares against `pausedRefusal(...)` instead — see the
      // note on the next one, because the two are different claims and this file used to
      // make only one of them.
      expect(pausedRefusal('pause-named')).toBe('paused: pause-named is declining all work right now')

      const offered = await ask(rpc, node.nodeId, { kind: 'offer', shardId: 's0' })
      if (offered?.kind !== 'offer') throw new Error('fixture')
      expect(offered.reason).toBe(pausedRefusal(node.nodeId))

      // A **node** condition, the same shape and the same retry policy the capacity
      // refusal takes on this branch: the identical task on another node succeeds.
      const executed = await ask(rpc, node.nodeId, { kind: 'exec', task: node.task(0) })
      expect(executed?.kind).toBe('error')
      if (executed?.kind !== 'error') throw new Error('fixture')
      expect(executed.reason).toBe(pausedRefusal(node.nodeId))

      // The fourth branch, and the one no assertion reached until 2026-08-11 — see this
      // file's header. A `commit` takes the `exec` shape because it *is* an exec whose
      // answer is withheld.
      const committed = await ask(rpc, node.nodeId, { kind: 'commit', task: node.task(1) })
      expect(committed?.kind).toBe('error')
      if (committed?.kind !== 'error') throw new Error('fixture')
      expect(committed.reason).toBe(pausedRefusal(node.nodeId))

      // The *combine* shape and not an `error` frame — `executeReduce` reads
      // `resultCid: null` as "try the next executor in the ranking", which is the
      // right answer from a node that has stepped out.
      const combined = await ask(rpc, node.nodeId, {
        kind: 'combine',
        combineId: 'c0',
        inputCids: [node.heldCid, node.secondHeldCid],
        level: 1,
      })
      if (combined?.kind !== 'combine') throw new Error('fixture')
      expect(combined.resultCid).toBe(null)
      expect(combined.reason).toBe(pausedRefusal(node.nodeId))

      // The misattribution this state exists to prevent: a paused node is not full,
      // and must never say it is.
      for (const reason of [offered.reason, executed.reason, committed.reason, combined.reason]) {
        expect(reason).not.toContain('over-committed')
        expect(reason).not.toContain('slots in use')
      }
    } finally {
      node.close()
      rpc.close()
    }
  })

  it('states its capacity unchanged while paused — the refusal is posture, not room', async () => {
    const node = await servingNode({ nodeId: 'pause-capacity', maxConcurrent: 4 })
    const rpc = requestorFor('pause-capacity')
    try {
      const running = await ask(rpc, node.nodeId, { kind: 'offer', shardId: 's0' })
      if (running?.kind !== 'offer') throw new Error('fixture')
      expect(running.capacity).toEqual({ slots: 4, inFlight: 0 })

      node.pause(true)
      const stopped = await ask(rpc, node.nodeId, { kind: 'offer', shardId: 's0' })
      if (stopped?.kind !== 'offer') throw new Error('fixture')
      // Read next to the refusal, deliberately. The capacity figure alone is also what
      // an unpaused node says, so on its own this assertion is satisfied by a node that
      // never paused at all.
      expect(stopped.accepted).toBe(false)
      // Byte-for-byte what it said when it was taking work. "My capabilities are
      // unchanged" is a claim this frame has to carry, or a requestor cannot tell a
      // paused node from one that has shrunk to nothing.
      expect(stopped.capacity).toEqual({ slots: 4, inFlight: 0 })
    } finally {
      node.close()
      rpc.close()
    }
  })
})

describe('a commit costs what an exec costs, so a paused node declines it', () => {
  it('declines before the module is compiled and before a slot is taken', async () => {
    const node = await servingNode({ nodeId: 'pause-commit', maxConcurrent: 4 })
    const rpc = requestorFor('pause-commit')
    try {
      // The control arm, and it is what makes the paused arm mean anything: the same
      // frame on the same node **does** run a module and **does** take a slot.
      const ran = await ask(rpc, node.nodeId, { kind: 'commit', task: node.task(0) })
      if (ran?.kind !== 'commit') throw new Error('fixture')
      expect(ran.outcome.ok).toBe(true)
      expect(node.entered).toBe(1)
      expect(node.capacity.peakInFlight).toBe(1)

      node.pause(true)
      const declined = await ask(rpc, node.nodeId, { kind: 'commit', task: node.task(1) })
      expect(declined?.kind).toBe('error')
      if (declined?.kind !== 'error') throw new Error('fixture')
      expect(declined.reason).toBe(pausedRefusal(node.nodeId))

      // **The half a reply frame cannot show.** `pausedAnswer`'s commit arm and a
      // refusal composed *after* the task ran are the same `{kind:'error'}` shape, so
      // without these two counters a paused node that compiled the module, instantiated
      // it, executed round 1, filed a `PendingCommitments` entry and then said "declining
      // all work right now" would satisfy every assertion above. Unchanged from the
      // control arm is the statement that none of that happened.
      expect(node.entered).toBe(1)
      expect(node.capacity.peakInFlight).toBe(1)
      expect(node.capacity.inFlight).toBe(0)
    } finally {
      node.close()
      rpc.close()
    }
  })
})

describe('a paused node finishes a ceremony it already joined', () => {
  it('answers round 2 while paused, and the answer matches the digest it committed to', async () => {
    const node = await servingNode({ nodeId: 'pause-reveal' })
    const rpc = requestorFor('pause-reveal')
    try {
      const task = node.task(3)
      const committed = await ask(rpc, node.nodeId, { kind: 'commit', task })
      if (committed?.kind !== 'commit' || !committed.outcome.ok) throw new Error('fixture')

      // The pause lands **between** the two rounds — the case the exclusion exists for.
      // An operator who stopped taking work here has not withdrawn from a ceremony this
      // node already computed an answer for.
      node.pause(true)

      const revealed = await ask(rpc, node.nodeId, { kind: 'reveal', handle: committed.outcome.handle })
      expect(revealed?.kind).toBe('reveal')
      if (revealed?.kind !== 'reveal') throw new Error('fixture')
      expect(revealed.outcome.ok).toBe(true)
      if (!revealed.outcome.ok) throw new Error('fixture')

      // **The ceremony completes, rather than a frame merely coming back.** Recomputing
      // the digest from the revealed nonce and the revealed output is what a requestor
      // does, and it is the difference between "round 2 answered" and "round 2 answered
      // with the thing it promised in round 1". A node that had abandoned the ceremony
      // and re-run the task would produce a nonce that does not reproduce this digest.
      const hashed = await canonicalCid(revealed.outcome.output)
      if (!hashed.ok) throw new Error('fixture')
      expect(await commitmentDigest(revealed.outcome.nonce, task, hashed.cid)).toBe(
        committed.outcome.digest,
      )

      // And the pause is genuinely in force at the same instant — read after the reveal,
      // on the same node, so this is not a test that forgot to pause.
      const offered = await ask(rpc, node.nodeId, { kind: 'offer', shardId: 's0' })
      if (offered?.kind !== 'offer') throw new Error('fixture')
      expect(offered.accepted).toBe(false)
      expect(offered.reason).toBe(pausedRefusal(node.nodeId))
    } finally {
      node.close()
      rpc.close()
    }
  })
})

describe('a paused node still certifies — two settings, not one', () => {
  it('mints a freshness challenge while paused', async () => {
    const node = await servingNode({
      nodeId: 'pause-challenge',
      pausedAtStart: true,
      enroll: newAuthority(),
    })
    const rpc = requestorFor('pause-challenge')
    try {
      const minted = await ask(rpc, node.nodeId, { kind: 'enrol-challenge' })
      expect(minted?.kind).toBe('enrol-challenge')
      if (minted?.kind !== 'enrol-challenge') throw new Error('fixture')
      expect(minted.challenge.nonce.length).toBeGreaterThan(0)

      // Read beside it, so the mint above is not a node that simply never paused.
      const offered = await ask(rpc, node.nodeId, { kind: 'offer', shardId: 's0' })
      if (offered?.kind !== 'offer') throw new Error('fixture')
      expect(offered.accepted).toBe(false)
    } finally {
      node.close()
      rpc.close()
    }
  })

  it('issues a certificate while paused, over both legs of the exchange', async () => {
    const authority = newAuthority()
    const node = await servingNode({ nodeId: 'pause-enrol', pausedAtStart: true, enroll: authority })
    const rpc = requestorFor('pause-enrol')
    try {
      const joiner = keypair(91)
      // `enrolOverRpc` sends `enrol-challenge` and then `enrol` over the wire, so a
      // paused node that declined *either* kind cannot produce a certificate here.
      const outcome = await enrolOverRpc(
        rpc,
        node.nodeId,
        requestEnrollment(joiner.priv, owner.priv, {
          operatorId: 'op-paused',
          discoverability: 'via-relay',
          relayIds: ['12D3KooWRelayOne'],
        }),
      )

      expect(outcome.ok).toBe(true)
      if (!outcome.ok) throw new Error(`expected a certificate, got ${outcome.reason}`)
      expect(outcome.certificate.nodeKey).toBe(joiner.pub)
      expect(outcome.certificate.issuer).toBe(authority.issuerKey)

      // Issuing is not work in the sense `LocalCapacity` bounds, and both branches say so
      // by name: neither leg takes a slot, and neither entered the executor.
      expect(node.capacity.peakInFlight).toBe(0)
      expect(node.entered).toBe(0)

      const offered = await ask(rpc, node.nodeId, { kind: 'offer', shardId: 's0' })
      if (offered?.kind !== 'offer') throw new Error('fixture')
      expect(offered.accepted).toBe(false)
    } finally {
      node.close()
      rpc.close()
    }
  })
})

describe('a pause control that does not answer with a boolean is a named bug', () => {
  it('refuses the request and names the broken hook, rather than never pausing', async () => {
    const node = await servingNode({ nodeId: 'pause-broken', maxConcurrent: 4 })
    const rpc = requestorFor('pause-broken')
    try {
      // The control arm: a control that answers `false` is a node taking work.
      const running = await ask(rpc, node.nodeId, { kind: 'offer', shardId: 's0' })
      if (running?.kind !== 'offer') throw new Error('fixture')
      expect(running.accepted).toBe(true)

      // A forgotten `return`, as an untyped host delivers it — see `fromUntypedHost`.
      node.misreport(fromUntypedHost('{}'))

      // **Not accepted.** `undefined` is falsy, so before this branch existed the node
      // would have gone on taking work forever with nothing failing and nothing to read.
      const offered = await ask(rpc, node.nodeId, { kind: 'offer', shardId: 's0' })
      if (offered?.kind !== 'offer') throw new Error('fixture')
      expect(offered.accepted).toBe(false)
      expect(offered.reason).toBe(pauseMisreported(node.nodeId, undefined))
      // Named as its own fact. Not a pause — the node cannot say whether it is paused —
      // and not the at-capacity string either, on the same grounds every other refusal
      // in this file is named.
      expect(offered.reason).toContain('pause control broken')
      expect(offered.reason).not.toContain('over-committed')
      expect(offered.reason).toBe(
        'pause control broken: pause-broken\'s pause control answered undefined rather than true or false, so this node cannot say whether it is paused',
      )

      // And it does not silently pause either: an `exec` gets the same named refusal,
      // and the executor was never entered.
      const executed = await ask(rpc, node.nodeId, { kind: 'exec', task: node.task(0) })
      if (executed?.kind !== 'error') throw new Error('fixture')
      expect(executed.reason).toBe(pauseMisreported(node.nodeId, undefined))
      expect(node.entered).toBe(0)

      // `null` and a string are the other two shapes an untyped host delivers, and each
      // is named for what it answered rather than folded into one message.
      node.misreport(fromUntypedHost('{"paused": null}'))
      const withNull = await ask(rpc, node.nodeId, { kind: 'offer', shardId: 's0' })
      if (withNull?.kind !== 'offer') throw new Error('fixture')
      expect(withNull.reason).toContain('answered null')

      node.misreport(fromUntypedHost('{"paused": "yes"}'))
      const withString = await ask(rpc, node.nodeId, { kind: 'offer', shardId: 's0' })
      if (withString?.kind !== 'offer') throw new Error('fixture')
      expect(withString.reason).toContain('answered string')

      // The capacity claim is unchanged on this arm too: the node is not full, it is
      // misconfigured, and the frame still says what it could do.
      expect(withString.capacity).toEqual({ slots: 4, inFlight: 0 })

      // Recovered by fixing the control, with no restart — the same property the pause
      // toggle has.
      node.pause(false)
      const recovered = await ask(rpc, node.nodeId, { kind: 'offer', shardId: 's0' })
      if (recovered?.kind !== 'offer') throw new Error('fixture')
      expect(recovered.accepted).toBe(true)
    } finally {
      node.close()
      rpc.close()
    }
  })
})

describe('pausing declines work, and nothing else', () => {
  it('still answers blocks, records, providers, reservations and reports while paused', async () => {
    const node = await servingNode({ nodeId: 'pause-alive', pausedAtStart: true })
    const rpc = requestorFor('pause-alive')
    try {
      // The whole difference from an unreachable node: every one of these gets an
      // answer, and it is the same answer an unpaused node gives.
      const block = await ask(rpc, node.nodeId, { kind: 'block', cid: node.heldCid })
      expect(block?.kind).toBe('block')
      if (block?.kind !== 'block') throw new Error('fixture')
      expect(block.bytes).toEqual(PARTIAL_BYTES)

      const providers = await ask(rpc, node.nodeId, { kind: 'providers', cid: node.heldCid })
      expect(providers?.kind).toBe('providers')

      const records = await ask(rpc, node.nodeId, { kind: 'records', nodeKey: 'ff' })
      expect(records?.kind).toBe('records')

      const reservations = await ask(rpc, node.nodeId, { kind: 'reservations' })
      expect(reservations?.kind).toBe('reservations')

      const report = await ask(rpc, node.nodeId, { kind: 'report', outcome: null })
      expect(report?.kind).toBe('report')
    } finally {
      node.close()
      rpc.close()
    }
  })
})

describe("'never-pauses' is today's behaviour, stated", () => {
  it('accepts and executes exactly as before', async () => {
    const store = new MemoryBlockstore()
    const moduleCid = await store.put(MODULE_WRITES_PARTITION)
    const inputCid = await store.put(INPUT_BYTES)
    const rpc = new RpcEndpoint(network.connect('never-pauses'), { timeoutMs: 5_000 })
    serveAgent({
      rpc,
      executor: new WasmExecutor({ nodeId: 'never-pauses', blockstore: store }),
      blockstore: store,
      capacity: new LocalCapacity({ nodeId: 'never-pauses', maxConcurrent: 4 }),
      paused: 'never-pauses',
      authorize: 'serves-unauthenticated',
      egress: 'holds-no-registrations',
      index: 'serves-no-records',
      enroll: 'issues-no-certificates',
      ledger: 'keeps-no-ledger',
      reservations: 'relays-for-nobody',
      onDispatch: 'reports-no-dispatch',
      attest: 'signs-nothing',
    })
    const client = requestorFor('never-pauses')
    try {
      const offered = await ask(client, 'never-pauses', { kind: 'offer', shardId: 's0' })
      if (offered?.kind !== 'offer') throw new Error('fixture')
      expect(offered.accepted).toBe(true)
      expect(offered.reason).toBe('')

      const executed = await ask(client, 'never-pauses', {
        kind: 'exec',
        task: { moduleCid, inputCid, partitionIndex: 0, partitionCount: 8, label: 'public' as const },
      })
      if (executed?.kind !== 'exec') throw new Error('fixture')
      expect(executed.outcome.ok).toBe(true)
    } finally {
      rpc.close()
      client.close()
    }
  })
})

describe('un-pausing restores acceptance without a restart', () => {
  it('accepts again on the same served endpoint, with no reconstruction', async () => {
    const node = await servingNode({ nodeId: 'pause-toggle', pausedAtStart: true })
    const rpc = requestorFor('pause-toggle')
    try {
      const first = await ask(rpc, node.nodeId, { kind: 'offer', shardId: 's0' })
      if (first?.kind !== 'offer') throw new Error('fixture')
      expect(first.accepted).toBe(false)

      node.pause(false)

      // Same endpoint, same `serveAgent` registration, same `LocalCapacity`. If the
      // thunk had been read once at construction this would still refuse.
      const second = await ask(rpc, node.nodeId, { kind: 'offer', shardId: 's0' })
      if (second?.kind !== 'offer') throw new Error('fixture')
      expect(second.accepted).toBe(true)

      const executed = await ask(rpc, node.nodeId, { kind: 'exec', task: node.task(0) })
      if (executed?.kind !== 'exec') throw new Error('fixture')
      expect(executed.outcome.ok).toBe(true)

      // And back again, in the same run: the toggle is not one-way.
      node.pause(true)
      const third = await ask(rpc, node.nodeId, { kind: 'offer', shardId: 's0' })
      if (third?.kind !== 'offer') throw new Error('fixture')
      expect(third.accepted).toBe(false)
    } finally {
      node.close()
      rpc.close()
    }
  })
})

describe('placement re-picks past a paused node', () => {
  it('places the shard on the next candidate and records the refusal by name', async () => {
    const paused = await servingNode({ nodeId: 'repick-paused', pausedAtStart: true })
    const taking = await servingNode({ nodeId: 'repick-taking' })
    const rpc = requestorFor('repick')
    try {
      // The paused node is the *preferred* candidate — least loaded — so a placement
      // that lands elsewhere landed there by re-picking and not by ordering.
      const nodes: readonly NodeDescriptor[] = [
        {
          nodeId: paused.nodeId,
          ownerId: 'public',
          canExecuteSovereign: false,
          load: 0,
          certificate: 'carries-no-certificate',
        },
        {
          nodeId: taking.nodeId,
          ownerId: 'public',
          canExecuteSovereign: false,
          load: 0.5,
          certificate: 'carries-no-certificate',
        },
      ]

      const placement = await placeWithOffers(
        { shardId: 's0', label: 'public', redundancy: 1 },
        nodes,
        { d: 2, admit: rpcAdmission(rpc, { probeTimeoutMs: 2_000 }) },
      )

      // A paused node does not fail the shard — that is the whole difference from a
      // fabric with nowhere to put the work.
      expect(placement.status).toBe('placed')
      if (placement.status !== 'placed') throw new Error('fixture')
      expect(placement.nodeIds).toEqual([taking.nodeId])
      expect(placement.probed).toBe(2)

      // The refusal is carried through in the node's own words, so "why did this land
      // here" stays answerable after the fact.
      //
      // Compared against `pausedRefusal(...)` rather than against a literal copy of it.
      // A literal here would go red on drift *by duplication*, which is a weaker thing
      // than it looks: it says two strings in the repository agree, and says nothing
      // about whether either is what the one construction site composes. This says the
      // string that travelled the wire, through `rpcAdmission` and into a `Rejection`,
      // is that site's own output.
      expect(placement.rejections).toEqual([
        { nodeId: paused.nodeId, reason: pausedRefusal(paused.nodeId) },
      ])
    } finally {
      paused.close()
      taking.close()
      rpc.close()
    }
  })
})
