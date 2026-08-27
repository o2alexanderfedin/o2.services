import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FabricNode } from './fabric-node.ts'
import type { FabricNodeOptions } from './fabric-node.ts'

/**
 * AUTH-04 — **what a one-hour certificate would cost the issuer**, measured because
 * RFC-0003 Response 01 §2.10 refuses to let its own recommendation be adopted without it.
 *
 * Recommendation 1 there is to cut `certificateLifetimeMs` from 30 days to 1 hour, on the
 * ground that expiry is the only revocation mechanism whose reach does not depend on how a
 * peer was discovered. Its cost section says of the resulting renewal traffic:
 * *"Unmeasured, and it must be measured before adoption … The relevant question is not the
 * mean but whether the issuer's admission path stays inside its bounds at the resulting
 * arrival rate."* This file is that measurement, and it names its own limits.
 *
 * ## What is measured
 *
 * `FLEET` joiners start **simultaneously** against one issuer, and every one of them must
 * come away holding a certificate. That is the question §2.10 asks — whether the admission
 * path stays inside its bounds at the arrival rate — because a path that collapsed under
 * concurrent arrivals refuses or times out, and both reach the joiner as no certificate.
 *
 * Timings are recorded to the run's output and **not asserted**. An absolute threshold on
 * them would encode this machine; a ratio was tried first and is described at the
 * assertion, where it is also recorded that it could not fail and was therefore removed.
 *
 * ## What this does NOT establish
 *
 * **Not the trade §2.10 prices separately.** At 30 days a node survives an issuer outage
 * for a month; at 1 hour, for an hour. That is a real loss of partition tolerance and no
 * benchmark can pay for it — it is an owner's call, not a measurement's.
 *
 * **Not the budget interaction, which is arithmetic and belongs beside this rather than
 * inside it.** A provider run with `--max-issued-per-window n` refuses once it has signed
 * `n` certificates in a window (`enrollment-cost.node.test.ts`). At a 30-day lifetime a
 * fleet of `F` nodes needs `F` issuances a month; at 1 hour it needs `F` every hour — a
 * ~720x rise against a budget that was sized for the old rate. **Whoever adopts
 * recommendation 1 must resize that budget in the same change**, or the fleet exhausts its
 * own provider and the refusal will read as an attack.
 *
 * **Not a scaling curve.** `FLEET` is small on purpose: this asks whether the path holds
 * shape under concurrency, not where it breaks.
 *
 * Node-only: it starts real libp2p nodes on loopback TCP.
 */

const TIMEOUT_MS = 120_000

/**
 * Small, and the size is the point. The question is whether concurrent arrivals collapse
 * the admission path, which a handful answers; where it breaks is a different question and
 * would need a different fixture.
 */
const FLEET = 6

let workdir: string
const nodes: FabricNode[] = []

beforeEach(async () => {
  workdir = await mkdtemp(join(tmpdir(), 'o2-issuance-rate-'))
})

afterEach(async () => {
  const started = nodes.length
  /**
   * Kept rather than discarded — see the `rm` below for what reads it.
   *
   * The `catch` was already here and its stated reason is still right, but it is wider than
   * that reason: a node that failed to START has nothing to stop, and a node that failed to
   * STOP is a different fact entirely — it is still running, and still writing. Swallowing
   * both identically is what made the failure below unattributable.
   */
  const stopFailures: string[] = []
  for (const node of nodes.reverse()) {
    try {
      await node.stop()
    } catch (error) {
      // A node that failed to start has nothing to stop, and reporting it here would
      // report the wrong failure. It is recorded instead, and only ever read if the
      // removal below then fails.
      stopFailures.push(error instanceof Error ? error.message : String(error))
    }
  }
  nodes.length = 0
  /*
   * **`maxRetries` is not decoration, and the error it answers was observed.** A full
   * `--project node` sweep on 2026-08-26 reddened here with
   * `ENOTEMPTY: directory not empty, rmdir '<workdir>/joiner-0/.datastore'`, and the same
   * file passed alone immediately after. Nothing in the spec's own claims failed — this is
   * teardown.
   *
   * `maxRetries` is Node's own remedy for exactly this error class: it retries on EBUSY,
   * EMFILE, ENFILE, ENOTEMPTY and EPERM with a linear backoff, and only when `recursive` is
   * set. It is the right shape here because what is being waited out is the tail of a
   * shutdown rather than an open handle — `FsDatastore` writes with `writeFileSync` and
   * `renameSync` and has no `close`, so it has no background flush to wait for; a file
   * appearing between `rm`'s readdir and its rmdir means somebody called `put` late.
   *
   * **This repairs the fixture and does NOT settle the question under it.** That a write can
   * land after `FabricNode.stop()` has resolved is INFERRED — from the error's own path and
   * from the store being synchronous — and is not measured. `stop()` closes the rpc, the
   * compute pool, the verifier, the transport and libp2p, and closes neither store. Whether
   * shutdown owes a caller more than that is a question about `fabric-node.ts`, not about
   * this file, and it is named here rather than answered.
   */
  try {
    await rm(workdir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
  } catch (error) {
    // The one explanation this teardown can offer without guessing: a node whose `stop()`
    // threw never stopped, so it is still writing into the tree being removed.
    throw new Error(
      `could not remove ${workdir} after ${String(started)} node(s); ` +
        `stop() failures: ${stopFailures.length === 0 ? 'none' : stopFailures.join(' | ')}`,
      { cause: error },
    )
  }
}, 60_000)

async function start(name: string, options: Partial<FabricNodeOptions> = {}): Promise<FabricNode> {
  const node = await FabricNode.start({
    relayAdmission: 'admits-any-peer',
    startReporting: 'reports-its-own-start',
    blockstoreDir: join(workdir, name),
    listen: ['/ip4/127.0.0.1/tcp/0'],
    trustAnchors: 'runs-unsigned-artifacts',
    rpcTimeoutMs: 30_000,
    ...options,
  })
  nodes.push(node)
  return node
}

/** A distinct user key per joiner, so the per-user limiter is never what is measured. */
function userKey(n: number): Uint8Array {
  return new Uint8Array(32).fill(0x30 + n)
}

describe('AUTH-04 — the issuer’s admission path under the arrival rate a 1 h certificate implies', () => {
  it(
    'issues to every joiner in a simultaneous burst, none refused and none timed out',
    async () => {
      // A budget with headroom rather than none, because it is what makes this case
      // falsifiable: lowering it is the plant, and a refusal is what the collapse this
      // file is looking for would also look like from the joiner's side.
      const provider = await start('provider', { issuesCertificates: FLEET + 4 })
      const providerAddr = provider.multiaddrs[0] as string
      expect(providerAddr, 'the provider bound no address').toBeDefined()

      // The calibration leg: one joiner, alone, against an idle issuer. Taken first and in
      // the same run as the burst, so the comparison below cancels this machine, its load
      // and its I/O weather rather than encoding them.
      const aloneAt = performance.now()
      const first = await start('joiner-0', {
        enrollment: { userPrivateKey: userKey(0), operatorId: 'ops-0', providerAddr },
      })
      const alone = performance.now() - aloneAt
      expect(first.certificate, 'the calibration joiner enrolled without a certificate').not.toBeNull()

      // The burst: every remaining joiner starts at once, so their enrolments overlap
      // inside the issuer rather than queueing outside it.
      const burstAt = performance.now()
      const joined = await Promise.all(
        Array.from({ length: FLEET }, (_unused, i) =>
          start(`joiner-${i + 1}`, {
            enrollment: {
              userPrivateKey: userKey(i + 1),
              operatorId: `ops-${i + 1}`,
              providerAddr,
            },
          }),
        ),
      )
      const burst = performance.now() - burstAt

      for (const [i, node] of joined.entries()) {
        expect(node.certificate, `joiner ${i + 1} enrolled without a certificate`).not.toBeNull()
      }

      // ## The claim, and a weaker one this file used to make
      //
      // The assertion above — every joiner in a simultaneous burst holds a certificate — is
      // the whole claim, and §2.10 asks for exactly it: does the admission path *stay
      // inside its bounds* at the arrival rate. A path that collapsed would refuse, or
      // time out, and either shows up as a null certificate.
      //
      // **A ratio was tried first and thrown away, because it could not fail.** It compared
      // the burst against `FLEET x` one joiner measured alone, and a planted serial arm —
      // the same joiners started one after another — left it **green**: the calibration leg
      // carries a whole node's start cost, so six warm sequential starts still came in under
      // six times the first cold one. It measured process startup and reported it as
      // concurrency. It is recorded here rather than deleted because the mistake is easy to
      // make again.
      //
      // Timings are recorded and not asserted. An absolute threshold on them would encode
      // this machine, and the honest comparative form was the one that did not work.
      const perJoiner = burst / FLEET
      const renewalsPerHourServed = 3_600_000 / perJoiner
      // eslint-disable-next-line no-console
      console.log(
        `[issuance-rate] alone=${Math.round(alone)}ms burst=${Math.round(burst)}ms ` +
          `per-joiner=${Math.round(perJoiner)}ms => an issuer of this shape serves ~${Math.round(
            renewalsPerHourServed,
          )} renewals/hour, i.e. a 1 h lifetime is affordable for a fleet well under that. ` +
          `The binding constraint is --max-issued-per-window, not throughput.`,
      )
      expect(renewalsPerHourServed).toBeGreaterThan(0)
    },
    TIMEOUT_MS,
  )
})
