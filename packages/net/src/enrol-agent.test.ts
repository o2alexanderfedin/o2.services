import { ed25519 } from '@noble/curves/ed25519.js'
import {
  EnrollmentAuthority,
  MemoryBlockstore,
  MemoryNetwork,
  WasmExecutor,
  possessionChallenge,
  requestEnrollment,
  toHex,
  verifyCertificate,
} from '@o2/core'
import type { PendingEnrollment } from '@o2/core'
import type { CanonicalValue } from '@o2/core'
import { describe, expect, it } from 'vitest'
import { serveAgent } from './agent.ts'
import { enrolOverRpc } from './enrol-client.ts'
import type { EnrolOutcome } from './enrol-client.ts'
import { encodeRequest, parseResponse } from './protocol.ts'
import { RpcEndpoint } from './rpc.ts'

/**
 * AUTH-01, AUTH-04 — enrollment end to end over a real fabric.
 *
 * Every certificate a test here sees came back over an `RpcEndpoint`. Nothing in this
 * file calls `authority.enrol(` directly, which is what makes these measurements of the
 * wired path rather than of the Phase 6 unit that has always worked.
 *
 * Portable: no `node:` import and no process spawning, so it runs in both the `node` and
 * `browser` vitest projects — a browser node enrols on identical terms.
 */

function keypair(seed: number): { readonly priv: Uint8Array; readonly pub: string } {
  const priv = new Uint8Array(32).fill(seed)
  return { priv, pub: toHex(ed25519.getPublicKey(priv)) }
}

const provider = keypair(80)
const user = keypair(81)
const impostor = keypair(82)

const PROVIDER = 'provider'
const SILENT = 'silent-provider'
const ENROLLEE = 'enrollee'

/**
 * An endpoint that keeps every frame it sent, so a test can replay one verbatim.
 *
 * Subclassed rather than hand-rolled: `enrolOverRpc` takes an `RpcEndpoint`, and a
 * duck-typed stand-in would let the capture drift from what the real endpoint puts on
 * the wire. What is recorded here is the argument to `request` — the same
 * `CanonicalValue` an eavesdropper would decode off the transport, and nothing more.
 */
class RecordingEndpoint extends RpcEndpoint {
  readonly sent: CanonicalValue[] = []

  override async request(to: string, body: CanonicalValue): Promise<CanonicalValue> {
    this.sent.push(body)
    return super.request(to, body)
  }
}

/** One shared network per fabric; each fabric gets its own so nothing leaks between tests. */
function buildFabric(options: { readonly issues: boolean }): {
  readonly rpc: RpcEndpoint
  readonly authority: EnrollmentAuthority
  readonly providerId: string
  /** Exposed so a test can attach a second peer — an eavesdropper — to the same fabric. */
  readonly network: MemoryNetwork
} {
  const network = new MemoryNetwork()
  const authority = new EnrollmentAuthority({
    providerPrivateKey: provider.priv,
    maxIssuedPerWindow: 'issues-without-an-aggregate-budget',
    issuance: 'remembers-only-within-this-process',
  })
  const providerId = options.issues ? PROVIDER : SILENT

  const store = new MemoryBlockstore()
  const providerRpc = new RpcEndpoint(network.connect(providerId), { timeoutMs: 2_000 })
  serveAgent({
    paused: 'never-pauses',
    rpc: providerRpc,
    executor: new WasmExecutor({ nodeId: providerId, blockstore: store }),
    blockstore: store,
    egress: 'holds-no-registrations',
    authorize: 'serves-unauthenticated',
    index: 'serves-no-records',
    enroll: options.issues ? authority : 'issues-no-certificates',
    capacity: 'accepts-every-offer',
    ledger: 'keeps-no-ledger',
    reservations: 'relays-for-nobody',
    onDispatch: 'reports-no-dispatch',
    attest: 'signs-nothing',
  })

  // A short budget, so the unreachable behaviour below does not wait out
  // `DEFAULT_RPC_TIMEOUT_MS`.
  const rpc = new RpcEndpoint(network.connect(ENROLLEE), { timeoutMs: 1_000 })
  return { rpc, authority, providerId, network }
}

function buildRequest(nodeSeed: Uint8Array, userSeed: Uint8Array = user.priv): PendingEnrollment {
  return requestEnrollment(nodeSeed, userSeed, {
    operatorId: 'op-a',
    discoverability: 'via-relay',
    relayIds: ['12D3KooWRelayOne'],
  })
}

describe('a node obtains a certificate by asking, over the fabric protocol', () => {
  it('returns a certificate whose subject is the asking key and whose issuer is the provider', async () => {
    const { rpc, authority, providerId } = buildFabric({ issues: true })
    const node = keypair(83)

    const outcome = await enrolOverRpc(rpc, providerId, buildRequest(node.priv))

    expect(outcome).toMatchObject({ ok: true, certificate: { issuer: authority.issuerKey } })
    if (!outcome.ok) throw new Error('expected a certificate')
    expect(outcome.certificate.nodeKey).toBe(node.pub)
    expect(outcome.certificate.userKey).toBe(user.pub)
    // Offline, against the pinned issuer — no live authority is consulted here.
    expect(verifyCertificate(outcome.certificate, new Set([authority.issuerKey]), Date.now()).ok).toBe(true)
  })

  it('refuses a request whose proof of possession was signed by a different key', async () => {
    const { rpc, providerId } = buildFabric({ issues: true })
    const node = keypair(84)
    const genuine = buildRequest(node.priv)
    // The correct challenge bytes, signed by somebody who does not hold `nodeKey`.
    // A well-formed signature over the right message by the wrong key is the case
    // worth measuring: a malformed hex string would be refused by arithmetic rather
    // than by the possession check.
    // A spread, and it keeps `answering` — which is the whole reason `PendingEnrollment`
    // hands back an *answer* rather than a rebuilt request. A closure that rebuilt the
    // request would undo this tampering on the way to the wire and the case would go green
    // while measuring nothing.
    const forged: PendingEnrollment = {
      ...genuine,
      proofOfPossession: toHex(
        ed25519.sign(possessionChallenge(genuine.nodeKey, genuine.userKey), impostor.priv),
      ),
    }

    const outcome = await enrolOverRpc(rpc, providerId, forged)

    expect(outcome).toMatchObject({
      ok: false,
      kind: 'refused',
      refusal: { kind: 'bad-proof-of-possession', nodeKey: node.pub },
    })
    // The **text**, not merely the kind. A refusal that names the wrong thing is a
    // defect in this repository even when the request correctly fails, and the kind
    // alone cannot tell the two apart.
    if (outcome.ok || outcome.kind !== 'refused') throw new Error('expected a refusal')
    expect(outcome.reason).toBe(`node ${node.pub} did not prove possession of its key`)
  })

  /**
   * The third refusal arm, end to end.
   *
   * `bad-owner-proof` is a **different event** from `bad-proof-of-possession`: the node
   * holds its own key, but the user it names never signed for it. Issuance checks
   * possession first and consent second, both *before* the limiter is touched — so a
   * cross-user attempt cannot consume the victim's window and lock them out of enrolling
   * their own nodes.
   *
   * This arm is absent from 17-CONTEXT.md decision 4, which describes the refusal type as
   * having two kinds. It has three. A build encoding only two would round-trip this
   * refusal as `null`, turning a stated refusal into no answer at all.
   */
  it('refuses a request the named user never consented to, naming the user', async () => {
    const { rpc, providerId } = buildFabric({ issues: true })
    const node = keypair(87)
    const genuine = buildRequest(node.priv)
    // Possession stays genuine; only the owner's consent is forged.
    const withoutConsent: PendingEnrollment = {
      ...genuine,
      ownerProof: toHex(
        ed25519.sign(possessionChallenge(genuine.nodeKey, genuine.userKey), impostor.priv),
      ),
    }

    const outcome = await enrolOverRpc(rpc, providerId, withoutConsent)

    expect(outcome).toMatchObject({
      ok: false,
      kind: 'refused',
      refusal: { kind: 'bad-owner-proof', userKey: user.pub },
    })
    if (outcome.ok || outcome.kind !== 'refused') throw new Error('expected a refusal')
    expect(outcome.reason).toBe(
      `user ${user.pub} did not consent to node ${node.pub} claiming their key`,
    )
  })
})

describe('AUTH-04 — the limit holds, and states itself', () => {
  it('refuses a burst past the threshold the refusal itself carries', async () => {
    const { rpc, providerId } = buildFabric({ issues: true })

    const accepted: Extract<EnrolOutcome, { ok: true }>[] = []
    const refused: Extract<EnrolOutcome, { kind: 'refused' }>[] = []

    // Twenty distinct node keys, all naming ONE user key — the axis the limiter keys on.
    for (let i = 1; i <= 20; i++) {
      const outcome = await enrolOverRpc(rpc, providerId, buildRequest(new Uint8Array(32).fill(i)))
      if (outcome.ok) accepted.push(outcome)
      else if (outcome.kind === 'refused') refused.push(outcome)
      else throw new Error(`unexpected outcome: ${outcome.kind} — ${outcome.reason}`)
    }

    expect(accepted.length + refused.length).toBe(20)
    expect(refused.length).toBeGreaterThan(0)

    const first = refused[0]
    if (first === undefined || first.refusal.kind !== 'rate-limited') {
      throw new Error('expected a rate-limited refusal')
    }
    // **The split is read out of the refusal, not written down here.** That is what
    // makes the threshold discoverable by the peer that hit it rather than only by
    // somebody reading the provider's source.
    expect(accepted).toHaveLength(first.refusal.limit)

    // These two literals are `@o2/core`'s shipped defaults, asserted because the
    // refusal is required to carry them onto the wire — a limit a peer cannot read is
    // not a stated one.
    expect(first.refusal).toMatchObject({ kind: 'rate-limited', limit: 5, windowMs: 3_600_000 })
    expect(first.refusal.retryAfterMs).toBeGreaterThan(0)
    expect(first.refusal.userKey).toBe(user.pub)

    // The **text** as well as the fields. The reason states the same threshold the
    // structured arm carries, so an operator reading a log line and a caller branching
    // on the field cannot be told two different numbers.
    expect(first.reason).toBe(
      `user ${user.pub} has enrolled ${first.refusal.limit} nodes in the last ${first.refusal.windowMs}ms (limit ${first.refusal.limit})`,
    )

    // Every refusal states the same threshold; one that named a different limit would
    // mean the number a peer reads depends on which refusal it happened to get.
    for (const outcome of refused) {
      expect(outcome.refusal).toMatchObject({ kind: 'rate-limited', limit: first.refusal.limit })
    }
  })

  /**
   * The honest counter-measurement, asserted rather than described.
   *
   * **Rate-limiting is measured; the per-user limiter buys no cost.** It keys on
   * `userKey`, so twenty requests under twenty *distinct* user keys meet no limit at all.
   * Generating a fresh user key is one `ed25519` keygen — microseconds — so an attacker
   * holding many user keys is not slowed in the slightest.
   *
   * **What is now available and what this fixture states it does not take.** Phase 19
   * added `maxIssuedPerWindow`, an aggregate budget on a quantity no request field can
   * rotate around, and **this fixture writes the `'issues-without-an-aggregate-budget'`
   * sentinel** — see `buildFabric`. So the reading below is unchanged and remains true of
   * this configuration; it is no longer true of every configuration, and a reader must
   * not carry it to one that states a number.
   *
   * **No deletion turns this test red, and that is still the finding here.** It measures
   * the absence of a guarantee this fixture asked to be without.
   */
  it('lets twenty distinct user keys each enrol a node, unslowed', async () => {
    const { rpc, providerId } = buildFabric({ issues: true })

    const accepted: Extract<EnrolOutcome, { ok: true }>[] = []
    for (let i = 1; i <= 20; i++) {
      const outcome = await enrolOverRpc(
        rpc,
        providerId,
        buildRequest(new Uint8Array(32).fill(100 + i), new Uint8Array(32).fill(140 + i)),
      )
      if (outcome.ok) accepted.push(outcome)
    }

    expect(accepted).toHaveLength(20)
  })

  /**
   * The limit's scope, stated because a reader would otherwise infer durability.
   *
   * This fixture takes `issuance: 'remembers-only-within-this-process'`, so the threshold
   * is per provider *uptime*, not per wall-clock window. A fresh authority has a fresh
   * budget for the same user key — which a restarted provider would also have.
   *
   * **That is now a named request rather than the only behaviour available.** The history
   * is a port the host supplies; a host that hands the same ledger to a second authority
   * gets the opposite reading, which `enrollment.test.ts` asserts in one process. What
   * neither file measures is a real restart — that is Plan 19-07's.
   */
  it('gives a second authority its own budget for the same user key', async () => {
    const first = buildFabric({ issues: true })
    for (let i = 1; i <= 6; i++) {
      await enrolOverRpc(first.rpc, first.providerId, buildRequest(new Uint8Array(32).fill(i)))
    }

    const second = buildFabric({ issues: true })
    const outcome = await enrolOverRpc(second.rpc, second.providerId, buildRequest(keypair(90).priv))
    expect(outcome.ok).toBe(true)
  })
})

describe('a failure says which of three things went wrong', () => {
  it('names that the answering node issues no certificates', async () => {
    const { rpc, providerId } = buildFabric({ issues: false })

    const outcome = await enrolOverRpc(rpc, providerId, buildRequest(keypair(85).priv))

    expect(outcome).toMatchObject({ ok: false, kind: 'unanswerable' })
    if (outcome.ok || outcome.kind !== 'unanswerable') throw new Error('expected unanswerable')
    // The answering node's own stated reason, carried through rather than replaced.
    expect(outcome.reason).toContain('issues no certificates')
  })

  it('names a peer that cannot be reached, rather than throwing', async () => {
    const { rpc } = buildFabric({ issues: true })

    const outcome = await enrolOverRpc(rpc, 'nobody-is-listening-here', buildRequest(keypair(86).priv))

    expect(outcome).toMatchObject({ ok: false, kind: 'unreachable' })
    if (outcome.ok || outcome.kind !== 'unreachable') throw new Error('expected unreachable')
    expect(outcome.reason.length).toBeGreaterThan(0)
  })
})

/**
 * AUTH-01 freshness — an observed enrolment request is not a replayable byte string.
 *
 * The defect these cases were written against: `possessionChallenge` encoded
 * `{purpose, nodeKey, userKey}` and nothing else, so the bytes a node signed to prove
 * possession were **fixed for that pair forever**. Anybody who watched one enrolment held
 * a frame they could resend verbatim, for as long as the provider ran, and the only thing
 * bounding the damage was the issuance budget those replays spent.
 *
 * **The capture is a capture, not a reconstruction.** `RecordingEndpoint` keeps the exact
 * `CanonicalValue` `enrolOverRpc` handed the transport, and the replay resends *that
 * object* from a second peer that holds no key of any kind. A test that rebuilt an
 * equivalent request with `requestEnrollment` would be measuring whether a fresh request
 * is accepted, which is a different question and one the first case above already answers.
 *
 * **Why the eavesdropper is a separate endpoint.** Replaying down the joiner's own
 * endpoint would leave open the reading that the provider recognised a repeat *caller*.
 * It does not; it recognises a spent challenge, and the second peer is what makes that
 * distinguishable.
 */
describe('an observed enrolment request is not a replayable byte string', () => {
  it('refuses the exact frame it already answered, and names the challenge as spent', async () => {
    const { network, providerId } = buildFabric({ issues: true })
    const joiner = new RecordingEndpoint(network.connect('recording-joiner'), { timeoutMs: 1_000 })
    const node = keypair(91)

    const honest = await enrolOverRpc(joiner, providerId, buildRequest(node.priv))
    expect(honest.ok).toBe(true)

    // The last frame the joiner sent is the enrolment itself. Asserted rather than
    // assumed: if the exchange ever stops ending on the `enrol` frame, this capture would
    // silently start replaying something else and the case would pass for the wrong reason.
    const observed = joiner.sent.at(-1)
    if (observed === undefined) throw new Error('the joiner sent nothing')
    expect(observed).toMatchObject({ kind: 'enrol' })

    const eavesdropper = new RpcEndpoint(network.connect('eavesdropper'), { timeoutMs: 1_000 })
    const replayed = parseResponse(await eavesdropper.request(providerId, observed))

    expect(replayed).toMatchObject({
      kind: 'enrol',
      result: { ok: false, refusal: { kind: 'stale-challenge' } },
    })
  })

  /**
   * The sentinel arm, at the wire, and it is here because a plant proved it was missing.
   *
   * Neutralising `redeemChallenge`'s `'answers-no-challenge'` guard reddened
   * `enrollment.test.ts` and left every case in *this* file green — because `enrolOverRpc`
   * always answers a challenge, so nothing here ever produced the sentinel on a frame. A
   * mechanism whose only catcher is the unit that implements it is the shape this
   * repository keeps finding: built, and its wiring assumed.
   *
   * The frame below is what a build predating this exchange sends, and what any peer that
   * skips leg one sends. `requestEnrollment` produces it directly — no hand-assembly —
   * which is what makes this a reading about the *branch* rather than about a fixture.
   */
  it('refuses a well-formed frame that answers no challenge at all', async () => {
    const { rpc, providerId } = buildFabric({ issues: true })
    const unfreshened = buildRequest(keypair(92).priv)
    expect(unfreshened.freshness).toBe('answers-no-challenge')

    const answered = parseResponse(
      await rpc.request(providerId, encodeRequest({ kind: 'enrol', request: unfreshened })),
    )

    expect(answered).toMatchObject({
      kind: 'enrol',
      result: { ok: false, refusal: { kind: 'stale-challenge' } },
    })
    // A refusal, not an `error` frame: this is an answer about the request, and it names
    // the one next action that works. `error` stays reserved for facts about the
    // answering node — "this node issues no certificates" and nothing else.
    if (answered?.kind !== 'enrol' || answered.result.ok) throw new Error('expected a refusal')
    expect(answered.result.reason).toContain('ask this provider for another')
  })
})
