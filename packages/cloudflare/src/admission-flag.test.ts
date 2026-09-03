/**
 * RUN-02's flag, over the complete storage fake.
 *
 * The behavioural half — that a directive written to a running object at run time reaches a
 * tab and stops it — is `admission-slices.e2e.test.ts` and `kill-switch-regions.e2e.test.ts`,
 * which need a real workerd. What belongs here is the four things this file decides: what an
 * object with nothing stored reports, that the value moves **both** ways, who may write it,
 * and that a write addressed elsewhere does not land.
 *
 * `DoDatastore` over `FakeDurableObjectStorage` rather than a fake datastore, because that is
 * the pair the object itself uses — the `/journal/` prefix, the `Uint8Array` encoding and the
 * `has`-before-`get` miss are all properties of that pair, and a fake that skipped it would be
 * checking a shape nobody deploys.
 */

import { describe, expect, it } from 'vitest'
import { ADMITTING } from '@o2/libp2p'
import {
  ADMISSION_DIRECTIVE_KEY,
  ADMISSION_KEY_HEADER,
  authoriseWrite,
  narrowRegion,
  parseDirective,
  readDirective,
  refuseMisaddressed,
  writeDirective,
} from './admission-flag.ts'
import { DoDatastore } from './do-datastore.ts'
import { FakeDurableObjectStorage } from './do-storage.fixture.ts'
import type { AdmissionDirective } from '@o2/libp2p'

const OPERATOR_KEY = 'a-key-an-operator-generated-with-a-csprng'

const store = (): DoDatastore => new DoDatastore(new FakeDurableObjectStorage())

const halt = (over: Partial<AdmissionDirective> = {}): AdmissionDirective => ({
  region: 'bootstrap-eu',
  halted: true,
  versions: 'all',
  since: 1_700_000_000_000,
  note: 'a region behaving badly',
  ...over,
})

describe('RUN-02 — what an object reports about its own admission state', () => {
  it('reports ADMITTING with its own region when nothing has been stored', async () => {
    const read = await readDirective(store(), 'bootstrap-eu')
    expect(read).toEqual({ ...ADMITTING, region: 'bootstrap-eu' })
    expect(read.halted).toBe(false)
  })

  it('reports its own region even for an object nobody has labelled', async () => {
    expect(await readDirective(store(), null)).toEqual({ ...ADMITTING, region: null })
  })

  it('reads back what it wrote, field for field', async () => {
    const s = store()
    const written = halt()
    await writeDirective(s, written)
    expect(await readDirective(s, 'bootstrap-eu')).toEqual(written)
  })

  it('MOVES BOTH WAYS — a second write replaces the first, including back to admitting', async () => {
    // **The one respect in which this differs from `relay-service-journal.ts`.** That file
    // refuses a write that goes backwards, because it is a claim about the past. This is a
    // switch, and a switch that could only be flipped one way is not a switch: an operator who
    // halted a region by mistake could never unhalt it, and one bad write would take a region
    // of volunteers off permanently.
    const s = store()
    await writeDirective(s, halt())
    await writeDirective(s, halt({ halted: false, note: '', since: null }))
    const read = await readDirective(s, 'bootstrap-eu')
    expect(read.halted).toBe(false)
    expect(read.note).toBe('')
  })

  it('reads a stored value it cannot parse as ADMITTING rather than throwing', async () => {
    // Opposite of the journal's ruling and right for the opposite reason: a stored INSTRUCTION
    // nobody can read is an instruction nobody gave, and throwing would take `GET /self` down
    // for every reader — including the volunteer's status page — on one unreadable key.
    const s = store()
    await s.put(ADMISSION_DIRECTIVE_KEY, new TextEncoder().encode('{not json'))
    expect((await readDirective(s, 'bootstrap-us')).halted).toBe(false)
  })

  it('refuses a body that is not a directive rather than filling in defaults', () => {
    expect(parseDirective(null)).toBe(null)
    expect(parseDirective([halt()])).toBe(null)
    expect(parseDirective({ ...halt(), halted: 'yes' })).toBe(null)
    expect(parseDirective({ ...halt(), versions: [1, 2] })).toBe(null)
    expect(parseDirective({ ...halt(), since: 'now' })).toBe(null)
    // A directive that IS one still parses, so the cases above are refusing for their own
    // reason rather than because nothing parses.
    expect(parseDirective(halt())).toEqual(halt())
  })
})

describe('RUN-02 — who may write the directive', () => {
  it('refuses every write when the object has NO key configured', () => {
    // **The security case of this phase.** The temptation is the other way — an unconfigured
    // object is easier to develop against — and it is what turns a kill switch into a kill
    // switch anyone can pull: every object deployed before the secret was set would accept a
    // halt from the first stranger who found the route.
    const refusal = authoriseWrite({ configuredKey: undefined, presentedKey: OPERATOR_KEY })
    expect(refusal.allowed).toBe(false)
    expect(refusal.allowed === false && refusal.reason).toContain('has no operator')
  })

  it('refuses a write when the object was configured with an empty key', () => {
    // An empty `--var` is how "unset" actually arrives from a deployment script that
    // interpolated a variable that was not there. It has to fail closed too.
    expect(authoriseWrite({ configuredKey: '', presentedKey: '' }).allowed).toBe(false)
  })

  it('refuses a write that presents no key header at all', () => {
    const refusal = authoriseWrite({ configuredKey: OPERATOR_KEY, presentedKey: null })
    expect(refusal.allowed).toBe(false)
    expect(refusal.allowed === false && refusal.reason).toContain(ADMISSION_KEY_HEADER)
  })

  it('refuses a write presenting the wrong key', () => {
    const refusal = authoriseWrite({
      configuredKey: OPERATOR_KEY,
      presentedKey: 'a-key-an-operator-generated-with-a-csprnh',
    })
    expect(refusal.allowed).toBe(false)
    expect(refusal.allowed === false && refusal.reason).toContain('does not match')
  })

  it('refuses a presented key that is a prefix of the real one', () => {
    // The length check is what catches this, and it is the arm a `startsWith` comparison
    // would pass.
    expect(
      authoriseWrite({ configuredKey: OPERATOR_KEY, presentedKey: OPERATOR_KEY.slice(0, -1) })
        .allowed,
    ).toBe(false)
  })

  it('allows a write presenting the configured key', () => {
    expect(authoriseWrite({ configuredKey: OPERATOR_KEY, presentedKey: OPERATOR_KEY }).allowed).toBe(
      true,
    )
  })
})

describe('RUN-02 — a write addressed to a region this object does not serve', () => {
  it('refuses, naming BOTH the region asked for and the region served', () => {
    const refusal = refuseMisaddressed(halt({ region: 'bootstrap-eu' }), 'bootstrap-us')
    expect(refusal).not.toBe(null)
    // Both, written as independent literals rather than read off the directive, so the
    // assertion cannot pass by comparing the value against itself.
    expect(refusal?.reason).toContain('"bootstrap-eu"')
    expect(refusal?.reason).toContain('"bootstrap-us"')
  })

  it('refuses every region-addressed write to an object with no region label', () => {
    expect(refuseMisaddressed(halt({ region: 'bootstrap-eu' }), null)?.refused).toBe(true)
    // Including one addressed to `null`, which is the shape a fan-out tool sends when it has
    // no siting information either.
    expect(refuseMisaddressed(halt({ region: null }), null)?.refused).toBe(true)
  })

  it('accepts a write addressed to the region this object serves', () => {
    expect(refuseMisaddressed(halt({ region: 'bootstrap-us' }), 'bootstrap-us')).toBe(null)
  })

  it('treats a region label outside the closed set as absent', () => {
    expect(narrowRegion('bootstrap-eu')).toBe('bootstrap-eu')
    expect(narrowRegion('bootstrap-antarctica')).toBe(null)
    expect(narrowRegion(undefined)).toBe(null)
  })
})
