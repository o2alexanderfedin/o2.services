import type { EgressManifest } from '@o2/net'
import { describe, expect, it } from 'vitest'
import { format } from '../demo/surfaces/byo.ts'
import type { ByoState } from '../demo/surfaces/byo.ts'
import { REGIONS } from './demo-regions.ts'
import type { TabJobReport } from './tab-api.ts'

/**
 * The bring-your-own formatter, exercised with **no DOM and no node** — and specifically at
 * the arm that carried a false sentence for as long as it existed.
 *
 * ## What this file is for
 *
 * `demo-byo.e2e.test.ts` drives this surface through a real fabric and reads Y10 in two
 * states: a run where every shard agreed, and a run where every shard was **refused** for
 * provenance. Neither is the state that broke.
 *
 * The state that broke is the third one: **`failures` empty AND shards unplaced.** It is a
 * real state of the fabric — `owner-domain-tabs.e2e.test.ts` produced it on an unplanted tree
 * on its first run, printing `No refusals: every shard reached agreement.` beside ten
 * `no agreement` shards, and reproduced it at eight under a deliberate plant. It is also a
 * state a healthy fixture does not produce to order, which is `pi-surface.node.test.ts`'s
 * stated reason for existing one file over: *"a real state of the fabric that a healthy
 * two-tab fixture does not produce to order."*
 *
 * So the reading is taken where it can be taken deterministically — over the pure function,
 * in the `node` project where `document` and `window` do not exist. If `format` ever grows a
 * DOM reference this file stops loading.
 *
 * ## Why an empty `failures` list is CORRECT here, and the sentence still was not
 *
 * `TabJobReport.failures` is filled from `VerificationResult`'s `disagreed` and `insufficient`
 * arms. A shard that was never placed reaches neither — there is no executor to have refused
 * it — so the list is legitimately empty. The old copy read empty-as-universal-success and
 * asserted a fact Y10 does not read. UI-SPEC section 4's amendment states the rule the fix
 * follows: a region's absence copy may describe only what that region reads.
 *
 * ## Watched red before it was trusted
 *
 * The retracted sentence was planted back into `demo-regions.ts` and the first case below
 * failed with, verbatim: *"expected 'No refusals: every shard reached agre…' not to contain
 * 'every shard reached agreement'"*. Restored by the inverse of that edit and verified
 * `cmp`-identical against a snapshot taken immediately before the plant.
 *
 * Note which assertion carried it. `toBe(NO_REFUSALS)` reads the copy out of `REGIONS`, so it
 * would have passed against the planted sentence too — a guard that follows whatever the
 * registry says cannot catch the registry being wrong. The `not.toContain` line is the one
 * that names the defect, and it is written against the false claim rather than against the
 * current string for exactly that reason.
 */

/** A manifest shaped like the sovereign runs this surface is the one path for. */
function manifest(): EgressManifest {
  return {
    entries: [],
    totalBytes: 0,
    violations: [],
    registeredSovereign: 8,
  } as unknown as EgressManifest
}

/**
 * A report in which nothing was placed: no shard agreed, and **no node refused anything**.
 *
 * Every field is what the fabric actually returns in that state rather than a convenient
 * blank. `partitions` is `-1` per shard because `main.ts` maps a shard that did not agree to
 * the sentinel; `replicas` is `0` for the same reason and is *no agreement*, not a count;
 * `verificationMultiplier` is `0` because `useful` was zero.
 */
function unplaced(shards: number): TabJobReport {
  return {
    complete: false,
    partitions: Array.from({ length: shards }, () => -1),
    agreeing: Array.from({ length: shards }, () => []),
    replicas: Array.from({ length: shards }, () => 0),
    verificationMultiplier: 0,
    fetched: 0,
    rejected: 0,
    egress: manifest(),
    failures: [],
    attestation: {
      description:
        'this shard is unplaceable rather than agreed, so there is no agreement to attest',
    },
  } as unknown as TabJobReport
}

/** The same shape, fully agreed — the arm whose sentence is unchanged by the amendment. */
function agreed(shards: number): TabJobReport {
  return {
    ...unplaced(shards),
    complete: true,
    partitions: Array.from({ length: shards }, (_, i) => i),
    agreeing: Array.from({ length: shards }, () => ['peer-a', 'peer-b']),
    replicas: Array.from({ length: shards }, () => 2),
    verificationMultiplier: 2,
  } as unknown as TabJobReport
}

function copyFor(id: string, state: 'unavailable'): string {
  const found = REGIONS.find((region) => region.id === id)?.absence?.[state]
  if (found === undefined) throw new Error(`${id} holds no "${state}" copy`)
  return found
}

const NO_REFUSALS = copyFor('byo/failures', 'unavailable')
const NO_PLACEMENT = copyFor('byo/agreeing', 'unavailable')

describe('Y10 — the refusals reading never claims another region’s fact', () => {
  it('says there were no refusals, and does NOT say every shard agreed, when nothing was placed', () => {
    const { regions } = format({ report: unplaced(8), sovereign: { ownerId: 'owner-hex' } })

    // The claim, stated as the thing that was false rather than as the string that is now
    // true: whatever this sentence says, it must not assert agreement on a run that had none.
    expect(regions['byo/failures']).not.toContain('every shard reached agreement')
    expect(regions['byo/failures']).toBe(NO_REFUSALS)

    // And the render is internally consistent, which is the property that was violated: two
    // regions of one render said opposite things about the same eight shards.
    expect(regions['byo/agreeing']).toBe(NO_PLACEMENT)
    expect(regions['byo/complete']).toBe('false')
    for (let i = 0; i < 8; i += 1) expect(regions['byo/replicas']).toContain(`shard ${String(i)}: no agreement`)
  })

  it('says the same thing when every shard DID agree — the sentence is about refusals either way', () => {
    // The amendment must not have bought honesty in one arm by making the other arm wrong.
    // Y10's answer is identical in both, because Y10's question is identical in both.
    const { regions } = format({ report: agreed(8), sovereign: null })
    expect(regions['byo/failures']).toBe(NO_REFUSALS)
    expect(regions['byo/agreeing']).not.toBe(NO_PLACEMENT)
    expect(regions['byo/complete']).toBe('true')
  })

  it('renders refusals verbatim rather than the absence copy when there are any', () => {
    // The absence arm must not be able to swallow a real refusal — the failure mode opposite
    // to the one this file is about.
    const report = {
      ...unplaced(2),
      failures: [{ nodeId: 'peer-a', reason: 'not a pinned trust anchor' }],
    } as unknown as TabJobReport
    const { regions } = format({ report, sovereign: null })
    expect(regions['byo/failures']).toBe('peer-a: not a pinned trust anchor')
  })
})
