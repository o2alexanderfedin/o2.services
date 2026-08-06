import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { peerIdFromString } from '@libp2p/peer-id'
import type { RpcEndpoint } from '@o2/net'
import { FabricNode, relayAdmissionGate } from './fabric-node.ts'
import type { AdmissionDecision } from './fabric-node.ts'
import { SeedServer } from './seed-server.ts'
import { stripComments } from './strip-comments.ts'

/**
 * AUTH-02 — which sites hold the relay door open, and the fact that nothing has shut it.
 *
 * ## What this file is for
 *
 * `RelayAdmission` (`@o2/libp2p`) is a **required** union on `FabricNodeOptions`, so every
 * construction site in this repository has had to write down who it admits. Today every
 * one of them writes `'admits-any-peer'`, because that is what the tree already did — the
 * plan that introduced the option changed no behaviour, and *that inertness is this file's
 * subject rather than a disclaimer it repeats*.
 *
 * Two readings, and they fail in opposite directions on purpose:
 *
 * - **The open postures are a floor, not a burn-down.** A number that only ever went down
 *   would be satisfied by deleting nodes. The floor says the option is still threaded
 *   everywhere it was.
 * - **The pinned postures are exactly zero, and this is the load-bearing row.** The moment
 *   any site pins an issuer set, the door starts refusing somebody and this file has to be
 *   revisited by whoever did it. Plans 24-02 and 24-03 will take that number off zero
 *   deliberately; nothing else should.
 *
 * ## What this file cannot do, stated so nobody over-reads it
 *
 * These are substring counts over source text, like `serve-agent-hooks.node.test.ts`'s and
 * `trust-anchors.node.test.ts`'s. They say **which choice each call site wrote down**.
 * They say nothing whatever about admission *semantics*, because nothing enforces any yet:
 * this file cannot detect a relay refusing anybody, cannot detect a browser tab still able
 * to enrol, and cannot tell a correct gate from an absent one. Those are 24-03's
 * measurements and claiming any of them here would be exactly the tautology this phase's
 * plans exist to avoid.
 *
 * What establishes that *every* site states a posture is not this file at all — it is
 * `tsc --noEmit`, because a required property cannot be omitted anywhere. That lesson is
 * `serve-agent-hooks.node.test.ts`'s, recorded there after a hand-maintained inventory of
 * call sites drifted from the repository twice.
 *
 * ## Why the source is stripped of comments first
 *
 * Because the option's own documentation quotes the value it configures — `fabric-node.ts`
 * writes the open posture's name inside `relayAdmission`'s docblock, and
 * `relay-admission.ts` writes it several times — so a raw-text count would read those
 * sentences as call sites. `trust-anchors.node.test.ts` states the same rule and the same
 * hazard: a guard that fires on its own documentation is a guard somebody deletes.
 *
 * Node-only: reads real source files off disk and shells out to `git`.
 */

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))

/**
 * This file, excluded from the **counting** but not from the **population**.
 *
 * It holds a real construction site of its own — the two-arm seed reading at the bottom
 * starts a `FabricNode`, so it states a posture like every other site and must, because
 * the field is required. Counting itself would inflate every repository-wide reading by
 * exactly the number of nodes its own fixtures build, which is a number that moves whenever
 * this file's tests change and has nothing to do with the repository it reports on.
 *
 * It stays in `stripped`, so the self-report guard below can still read it and require that
 * the *matchers* never appear here spelled out. Excluded from counting, spelled-out
 * matchers can no longer produce phantom sites — but they would still make this file lie
 * about what it scanned for, which is why that guard is kept rather than deleted.
 */
const SELF = 'packages/node/src/relay-admission.node.test.ts'

/** How many times `needle` occurs in `text`, as a literal substring. */
function occurrences(text: string, needle: string): number {
  return text.split(needle).length - 1
}

/**
 * The two needles, and the prefix hazard that decides their shape.
 *
 * `serve-agent-hooks.node.test.ts` records the measured precedent: its `index: records`
 * needle matched *inside* `index: records ?? 'serves-no-records'` and read 1 both before
 * and after the change it was supposed to discriminate. So the needles here are not
 * reasoned about — the block at the bottom of this file plants both forms and measures
 * what each matches.
 *
 * {@link ANY_POSTURE} is the field name with its colon, which matches a site whatever it
 * states. {@link OPEN_POSTURE} carries the trailing comma for the same reason the
 * precedent does.
 */
/**
 * The field name, assembled from two fragments. **Do not helpfully join it back up.**
 *
 * This file is inside its own jurisdiction — it is a tracked `.ts` under `packages/` like
 * every file it counts — so a needle written whole would appear in this file's own source
 * and the census would report itself. That is not hypothetical: it happened on the first
 * run after these files were staged, and all three repository-wide readings went red at
 * once, reading 3 extra postures and 3 declarations that were this file's own plant
 * constants and matcher.
 *
 * Comments are stripped before counting, so prose is safe; **code is not**. This is the
 * identical rule `trust-anchors.node.test.ts` writes for `OPT_OUT` and its two census
 * regexes, and it is enforced below rather than left to discipline.
 */
const FIELD = 'relay' + 'Admission'
const ANY_POSTURE = `${FIELD}:`
const OPEN_POSTURE = `${FIELD}: 'admits-any-peer',`
/** Assembled for {@link FIELD}'s reason — this file scans for it and must not contain it. */
const GATER = 'connection' + 'Gater'

/**
 * The option's own declaration, which {@link ANY_POSTURE} matches and which is not a site.
 *
 * Subtracted rather than pattern-excluded, and it is a **reading in its own right**: the
 * count below requires exactly one declaration in the repository, so a second
 * `FabricNodeOptions`-shaped type growing its own copy of this field — the shape that
 * would let two node factories drift apart — fails here by name rather than by making the
 * posture arithmetic quietly wrong.
 *
 * Found by measurement, not foresight: the first version of this file counted the
 * declaration as a site that states something other than the open posture, and read
 * `total - open === 1` against a repository whose door was open everywhere.
 */
const DECLARATION = `readonly ${FIELD}:`

/** Sites that state a posture in **production** source — a deployment, not a fixture. */
interface PostureSite {
  readonly file: string
  readonly open: number
  readonly total: number
  readonly reason: string
}

/**
 * The production construction sites, counted exactly.
 *
 * Exact rather than bounded here, unlike the repository-wide floor below, because these
 * are the ones an operator's fabric is actually made of and there are few enough that a
 * number moving is a decision somebody took rather than an unrelated new test.
 *
 * **The benchmark rigs are absent from this list on purpose**, and they are not
 * unguarded: {@link RIG_SITES} below holds them, counted the same way and for a different
 * reason. A production site is a deployment; a rig site is a fixture that publishes a
 * number, and the two are answerable to different questions.
 *
 * > **Corrected 2026-08-06 by Plan 24-02, which owns the rig posture.** This paragraph
 * > read *"Its three rigs are measurement fixtures whose posture Plan 24-02 decides and
 * > pins, alongside `perf-workload.ts`"*. The pairing with `perf-workload.ts` is wrong and
 * > is corrected rather than deleted, because the same wrong pairing appears twice in
 * > `24-01-SUMMARY.md` and a reader who meets it there should be able to find the
 * > measurement here. `packages/bench/src/perf-workload.ts` holds **zero** postures,
 * > constructs **no** `FabricNode`, and passes `reservations: 'relays-for-nobody'` at both
 * > of its `serveAgent` calls. A rig with no relay has no reservation to gate and so no
 * > admission posture to state. That is measured by {@link RIG_SITES}'s last case rather
 * > than asserted here.
 */
const PRODUCTION_SITES: readonly PostureSite[] = [
  {
    file: 'packages/node/src/seed-server.ts',
    open: 1,
    total: 1,
    reason:
      'the seed binds a real listening socket, so it relays, so this is the value that will decide who joins through it — the front door of the LAN demo and the one a browser tab reaches first',
  },
  {
    file: 'packages/node/src/bin/agent.ts',
    open: 1,
    total: 1,
    reason:
      'the production Node entry point; whether it should instead refuse to start when an operator states neither an issuer nor an open posture is an open owner ruling, costed and deliberately not decided',
  },
]

/**
 * The benchmark rigs, counted exactly — Plan 24-02's subject.
 *
 * ## What these counts mean, and why they are a different list from {@link PRODUCTION_SITES}
 *
 * A production site states what an operator's fabric admits. A **rig** site states the
 * conditions a *published number* was taken under, and that is a claim about evidence
 * rather than about a deployment. Both are pinned exactly, for one shared reason and one
 * separate one: shared, that there are few enough of them that a moved number is a
 * decision somebody took; separate, that a rig whose posture changes silently invalidates
 * every figure in `.planning/BENCHMARK-RESULTS.md` without touching a single one of them.
 *
 * **The count was wrong twice before it was right, and both corrections are recorded**
 * because the arithmetic is the whole content of this list:
 *
 * 1. Plan 24-02 as first written said *four rig sites*, pairing `bin/bench.ts` with
 *    `packages/bench/src/perf-workload.ts`.
 * 2. It was amended on 2026-08-05 to *three, all in `bin/bench.ts`* — true of that file,
 *    and true of `perf-workload.ts`, which really does hold none.
 * 3. Measured on execution, 2026-08-06: **four**, and the fourth is neither of the files
 *    either audit looked at. `packages/node/src/bench-fabric.ts` was created by Plan 23-02
 *    at 12:08 on 2026-08-05 — *after* 24-01 made the field required, so it had to state a
 *    posture, and plausibly after the audit that produced correction 2. So the original
 *    number was right and the file was wrong, and the amendment corrected the file by
 *    lowering the number. This list is what stops a fifth rig arriving unnoticed.
 *
 * ## What the counts do NOT say
 *
 * They do not say a reservation was ever requested of any of these nodes. It was not, and
 * `no rig asks any relay for a reservation` below is the reading that establishes it:
 * neither rig passes `relayAddrs` to anything, so every relay service they start has an
 * empty store for the whole of a run. **That is the strongest available statement that
 * arming admission cannot move the published curves**, and it is a measurement of source
 * text, not of a run.
 *
 * `bin/agent.ts` is a rig's other half — the process rig's children are that binary — and
 * it is in {@link PRODUCTION_SITES}, not here, because it is a production entry point that
 * a rig happens to spawn. Plan 24-03 owns giving it a way to state a closed posture.
 */
const RIG_SITES: readonly PostureSite[] = [
  {
    file: 'packages/node/src/bin/bench.ts',
    open: 3,
    total: 3,
    reason:
      'the in-process rig behind both published curves: the --discover arm’s provider, the N workers the curve is a curve of, and the requestor — three sites, three decisions, each stating at its own line what its numbers do not claim about admission',
  },
  {
    file: 'packages/node/src/bench-fabric.ts',
    open: 1,
    total: 1,
    reason:
      'BENCH-07’s process-per-node rig, in-process half. Its other half is the spawned bin/agent.ts, whose posture is stated at that binary and owned by Plan 24-03; this row is the reason the rig is not half-guarded',
  },
]

/** Every tracked TypeScript source file, as `git` sees it. */
function trackedSources(): readonly string[] {
  return execFileSync('git', ['ls-files', '-z', 'packages', 'tools'], { cwd: ROOT, encoding: 'utf8' })
    .split('\0')
    .filter((path) => path.endsWith('.ts'))
}

interface Census {
  readonly open: number
  readonly total: number
  readonly declarations: number
  readonly files: readonly string[]
  readonly stripped: ReadonlyMap<string, string>
}

function census(): Census {
  let open = 0
  let total = 0
  let declarations = 0
  const files: string[] = []
  const stripped = new Map<string, string>()
  for (const file of trackedSources()) {
    let source: string
    try {
      source = readFileSync(join(ROOT, file), 'utf8')
    } catch {
      // A file git lists and disk does not have. This repository is worked on by
      // concurrent agents sharing one checkout, so a file removed mid-scan lands exactly
      // here; skipping it can only lower a floor, which fails safe for every reading below.
      continue
    }
    const code = stripComments(source)
    stripped.set(file, code)
    // Recorded, never counted. See {@link SELF}.
    if (file === SELF) continue
    const declared = occurrences(code, DECLARATION)
    // A declaration is not a site. See {@link DECLARATION} for why it is subtracted here
    // rather than excluded by a cleverer pattern, and for the reading that subtraction buys.
    const here = occurrences(code, ANY_POSTURE) - declared
    declarations += declared
    if (here === 0) continue
    files.push(file)
    total += here
    open += occurrences(code, OPEN_POSTURE)
  }
  return { open, total, declarations, files, stripped }
}

const REPO = census()

function code(file: string): string {
  const source = REPO.stripped.get(file)
  if (source === undefined) throw new Error(`${file} is not in the scanned population`)
  return source
}

describe('the scan looked at the repository it claims to have looked at', () => {
  it('read the tracked sources and found real postures', () => {
    // Every reading below is a count, and a scan that read nothing produces the same
    // shape as a repository with nothing in it. The positive is asserted first.
    expect(REPO.stripped.size).toBeGreaterThan(120)
    expect(REPO.files.length).toBeGreaterThan(20)
    expect(REPO.total).toBeGreaterThan(0)
  })

  it('reaches the two production entry points by name', () => {
    for (const site of PRODUCTION_SITES) expect(REPO.files).toContain(site.file)
  })

  it('reaches both benchmark rigs by name', () => {
    for (const site of RIG_SITES) expect(REPO.files).toContain(site.file)
  })

  it('names none of its own matchers in its own source, so it cannot report itself', () => {
    // The regression that produced this assertion, turned into a standing one rather than
    // a comment. This file is tracked, is under `packages/`, and is therefore counted like
    // any other — so a future edit that spells any matched text out whole would add
    // phantom sites and a phantom declaration, a failure that looks like a real finding
    // and is not. `trust-anchors.node.test.ts` carries the identical guard for the
    // identical reason; this is that rule applied to a second file rather than re-derived.
    const self = code(SELF)
    // `ANY_POSTURE` is deliberately **not** asserted absent: this file constructs a node of
    // its own, so it states a posture like every other site and has to. {@link SELF} is
    // what keeps that honest — the site is real, and it is excluded from counting rather
    // than hidden. The other two matchers have no legitimate reason to appear here.
    expect(self).not.toContain(DECLARATION)
    expect(self).not.toContain(GATER)
    // The exclusion is asserted rather than assumed: a `SELF` that stopped matching any
    // real path would silently put this file back in the count.
    expect(REPO.stripped.has(SELF)).toBe(true)
    expect(REPO.files).not.toContain(SELF)
  })
})

describe('every relay-capable site states a posture, and every one of them is open', () => {
  for (const site of PRODUCTION_SITES) {
    it(`${site.file} states its posture, and it is open`, () => {
      expect(occurrences(code(site.file), ANY_POSTURE)).toBe(site.total)
      expect(occurrences(code(site.file), OPEN_POSTURE)).toBe(site.open)
      expect(site.reason.length).toBeGreaterThan(20)
    })
  }

  for (const site of RIG_SITES) {
    it(`${site.file} states a rig posture, and it is open`, () => {
      expect(occurrences(code(site.file), ANY_POSTURE)).toBe(site.total)
      expect(occurrences(code(site.file), OPEN_POSTURE)).toBe(site.open)
      expect(site.reason.length).toBeGreaterThan(20)
    })
  }

  it('has no rig that asks any relay for a reservation, so no published curve can move', () => {
    // **The reading that makes the three sentences at `bin/bench.ts`'s call sites true.**
    // Each of them says its numbers claim nothing about admission, and the ground given is
    // that no node either rig builds is ever handed a relay address to dial. A reservation
    // is requested by the *joining* peer, so a rig that hands out no relay address never
    // reaches the reservation protocol at all — whatever posture its relay-capable nodes
    // state. That is why arming the gate in 24-03 cannot move a committed figure.
    //
    // Asserted on stripped source, so a sentence in a comment that merely mentions the
    // option cannot satisfy it, and against `code()`, which throws on a file that has left
    // the population rather than passing vacuously.
    for (const site of RIG_SITES) expect(code(site.file)).not.toContain('relayAddrs')
  })

  it('finds no posture and no node factory in the non-relaying rig', () => {
    // `packages/bench/src/perf-workload.ts` — the file two audits disagreed about. It
    // composes `serveAgent` directly and relays for nobody, so it has no reservation to
    // gate and states no posture. Pinned as a **negative with a positive beside it**: the
    // `serveAgent` count is what stops this passing because the file was renamed or gutted.
    const workload = code('packages/bench/src/perf-workload.ts')
    expect(occurrences(workload, ANY_POSTURE)).toBe(0)
    expect(workload).not.toContain('FabricNode')
    expect(occurrences(workload, 'serveAgent(')).toBe(2)
    expect(occurrences(workload, "reservations: 'relays-for-nobody'")).toBe(2)
  })

  it('holds the door open at every site in the repository, and shuts it at none', () => {
    // **The load-bearing pair.** The first is a floor: it says the option is still threaded
    // through every node this repository builds, and it fails when sites stop stating a
    // posture — which, because the field is required, means when nodes are deleted. A
    // number this large cannot be exact without failing on every unrelated new test that
    // starts a node, which is the trade `trust-anchors.node.test.ts` writes down for its
    // own bound.
    //
    // The second is exact, and it is the one that matters. `total - open` is the number of
    // sites stating something other than `'admits-any-peer'` — a pinned issuer set, or an
    // empty one. **Zero is the claim that this wave changed no behaviour**, and it is not a
    // burn-down heading anywhere on its own: Plans 24-02 and 24-03 take it off zero on
    // purpose, and when they do, this row is what makes them say so.
    expect(REPO.open).toBeGreaterThanOrEqual(60)
    expect(REPO.total - REPO.open).toBe(0)
  })

  it('declares the field in exactly one type, so two factories cannot drift', () => {
    // See {@link DECLARATION}. One declaration is what makes the arithmetic above a
    // statement about call sites; a second would be a second answer to "who does this node
    // admit", which is the shape `fabric-node.ts`'s "why relaying is derived and not
    // configured" section exists to keep out of this option.
    expect(REPO.declarations).toBe(1)
    expect(occurrences(code('packages/node/src/fabric-node.ts'), DECLARATION)).toBe(1)
  })

  it('declares the option required, so no site can omit one', () => {
    // The compile-time guarantee, asserted as text because a runtime test cannot see a
    // type. `tsc --noEmit` is the instrument; this row is what fails fast and by name when
    // somebody adds a `?` to the declaration, which would silently restore the state where
    // a caller means "admit everyone" without having said so.
    //
    // Both halves are needed: the second alone would pass for a field that had been
    // deleted outright.
    // Assembled through {@link FIELD}, like every other matcher here — written whole this
    // line would be the third phantom site the self-report guard above exists to prevent.
    expect(code('packages/node/src/fabric-node.ts')).toContain(`${DECLARATION} RelayAdmission`)
    expect(code('packages/node/src/fabric-node.ts')).not.toContain(`${FIELD}?:`)
  })
})

/**
 * **Inverted 2026-08-06 (Plan 24-03), and the inversion is the point of this block.**
 *
 * This block used to be titled *"nothing reads the posture yet — this wave arms nothing"*, and
 * every case in it fired when the door **closed**. Defect #51 is that nothing anywhere fired
 * while it stayed **open**: all four cases were green on a fabric that refused nobody and would
 * have stayed green forever if Phase 24 had never run. A phase whose entire evidence is *"the
 * suite went red when we changed something"* has no reading at all if the change is never made.
 *
 * So two of the four are now inverted — they assert the gate is **present** and go red if it is
 * removed — one is inverted at the census above, and the fourth keeps its assertions for a
 * reason stated at its own case.
 */
describe('the posture is read, and these rows go red if it stops being', () => {
  // The title is assembled for {@link GATER}'s reason: a test *name* is code, not a
  // comment, so `stripComments` leaves it in and a matcher spelled out here would count
  // this file as a site. That is how this block first went red.
  it(`constructs a ${GATER} on the relay-capable node factory, and still none on a tab`, () => {
    // **Inverted.** This asserted `['packages/browser/src/browser-node.ts']` — i.e. that no
    // node factory gated anything. `fabric-node.ts` must now appear, because that is where
    // the reservation is refused.
    // **Production files only**, on the same idiom the `admitsAnyPeer` case below already
    // uses, and the narrowing was forced by measurement rather than chosen: it was added when
    // `enrol-through-a-closed-door.node.test.ts` — which installs a gater *into a fixture* to
    // measure the hook — started counting as a third site. A test that plants a gater is not a
    // place this repository decides admission, and the claim below is about places it does.
    const withGater = [...REPO.stripped]
      .filter(([file, source]) => !file.endsWith('.test.ts') && source.includes(GATER))
      .map(([file]) => file)
    expect(withGater).toContain('packages/node/src/fabric-node.ts')
    expect(withGater).toContain('packages/browser/src/browser-node.ts')
    // And nothing else. A third gater appearing is a second place deciding who gets in, which
    // is the defect the objective's "one change" sentence exists to catch.
    expect([...withGater].sort()).toEqual([
      'packages/browser/src/browser-node.ts',
      'packages/node/src/fabric-node.ts',
    ])

    // **The surviving negative, and it is now a PROTECTED PROPERTY rather than a
    // "nothing moved" claim.** `browser-node.ts`'s only gater opens dialling, and it must
    // never gate a reservation — measured 2026-08-06, a `BrowserNode` imports only
    // `circuitRelayTransport` from `@libp2p/circuit-relay-v2`, never `circuitRelayServer`, and
    // its `#compose` passes `services: { identify, identifyPush }` and nothing else. It runs no
    // relay server, grants no reservation, and therefore **has no reservation to gate**. This
    // assertion is the machine-checked half of the sentence at
    // `BrowserNodeOptions.startReporting`'s docblock; neither can be reverted without the
    // other reddening.
    expect(code('packages/browser/src/browser-node.ts')).toContain('denyDialMultiaddr')
    expect(code('packages/browser/src/browser-node.ts')).not.toContain(`deny${'Inbound'}RelayReservation`)
  })

  /**
   * **NOT inverted, and this is the one case whose meaning changed without its assertions
   * changing.**
   *
   * It used to mean *"this wave moved nothing"*. It now means *"the gate is not in the capacity
   * call, and must never be"* — which is a stronger claim and a permanent one. The gate went on
   * `createLibp2p`'s top-level `connectionGater`, so both halves below stayed true through
   * arming, and that is exactly why they are worth keeping: capacity is *how many*, admission is
   * *who*, and a relay refusing for one reason while an operator reads the other is the
   * ambiguity NET-05 exists to remove.
   *
   * Its mutation is `relayAdmission` passed into `circuitRelayServer(`.
   */
  it('leaves circuitRelayServer taking capacity limits and nothing else, which is now a protected property', () => {
    const factory = code('packages/node/src/fabric-node.ts')
    expect(factory).toContain('circuitRelayServer(')
    expect(factory).toContain('maxReservations:')
    expect(factory).toContain('reservationTtl:')
    expect(factory).toContain('defaultDurationLimit:')
    expect(factory).toContain('defaultDataLimit:')
    // The negative half: the option is threaded past this call, never into it.
    const call = factory.slice(factory.indexOf('circuitRelayServer('))
    expect(call.slice(0, call.indexOf('}),')).includes('relayAdmission')).toBe(false)
  })

  it('has exactly one production caller for the predicate that reads the union', () => {
    // **Inverted.** This asserted `['packages/libp2p/src/relay-admission.ts']` — the predicate
    // with no caller at all. `fabric-node.ts` must now be one, and it must be the **only** new
    // one: `admitsAnyPeer` exists so that the decision about what the union *means* is made
    // once rather than once per reader, and a second production caller is that guarantee gone.
    const callers = [...REPO.stripped]
      .filter(([file, source]) => !file.endsWith('.test.ts') && source.includes('admitsAnyPeer('))
      .map(([file]) => file)
    expect([...callers].sort()).toEqual([
      'packages/libp2p/src/relay-admission.ts',
      'packages/node/src/fabric-node.ts',
    ])
  })
})

/**
 * AUTH-02 — the seed's issuer pinning, read in both arms of one run.
 *
 * ## Why a behavioural reading sits in a file that is otherwise a census
 *
 * Every other block here counts source text, and a count cannot tell a threaded option
 * from a decorative one. `SeedServerOptions.trustedIssuers` is new surface whose entire
 * claim is that it *reaches the node*, and the only way to establish that is to give a
 * seed the option and watch what the node does differently.
 *
 * ## This is NOT zero-change, and must not be described as such
 *
 * The plan that added these two fields changes no behaviour **for a seed that is not given
 * the new flag**. A seed that *is* given it now has a non-empty anchor set, so
 * `PeerVerifier.start` subscribes instead of returning early and `verifiedPeers` begins
 * filtering block sources. That is a real behaviour change, it is the whole point of the
 * option, and it is measured here rather than claimed absent.
 *
 * ## Comparative, in one run, on the repository's standing rule
 *
 * An absolute reading here would encode this machine's timing. Both arms use the same
 * peer, the same seed construction and the same deadline; the only difference between them
 * is the option under test, so the divergence cannot be attributed to load.
 *
 * ## What this cannot show, stated so a green is not over-read
 *
 * **It cannot show that an unenrolled peer fails to *join*.** `verifiedPeers` gates block
 * fetching and nothing else — the peer below is connected, holds a reservation-free direct
 * connection, and is refused only as a *source*. Who gets *in* is `RelayAdmission`, which
 * nothing reads. A green here is a selection reading and never an admission one.
 */
describe('AUTH-02 — a seed can be told its issuers, separately from its build authorities', () => {
  /** Any well-formed issuer key. The peer below holds no certificate at all, so no real
   *  provider is needed: what is measured is that pinning *somebody* switches the gate on. */
  const SOME_ISSUER = 'a'.repeat(64)

  async function until(predicate: () => boolean, timeoutMs: number, what: string): Promise<void> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      if (predicate()) return
      await new Promise((r) => setTimeout(r, 20))
    }
    throw new Error(`timed out waiting for ${what}`)
  }

  const dialableAddr = (node: FabricNode): string => {
    const addr = node.multiaddrs.find((ma) => ma.includes('/tcp/') && !ma.includes('/p2p-circuit') && !ma.includes('/ws'))
    if (addr === undefined) throw new Error(`no dialable address on ${node.peerId}`)
    return addr
  }

  it('asks an uncertificated peer for blocks when told no issuers, and refuses it when told one', async () => {
    const dirs: string[] = []
    const madeDir = async (name: string): Promise<string> => {
      const dir = await mkdtemp(join(tmpdir(), `o2-seed-issuers-${name}-`))
      dirs.push(dir)
      return dir
    }
    const seeds: SeedServer[] = []
    const peers: FabricNode[] = []
    try {
      // The peer. It holds **no certificate** — nothing enrolled it — which is precisely
      // the case both arms disagree about.
      const peer = await FabricNode.start({
        relayAdmission: 'admits-any-peer',
        startReporting: 'reports-its-own-start',
        blockstoreDir: await madeDir('peer'),
        listen: ['/ip4/127.0.0.1/tcp/0'],
        trustAnchors: 'runs-unsigned-artifacts',
        rpcTimeoutMs: 10_000,
      })
      peers.push(peer)

      // ARM A — told no issuers. This is what every seed in this repository did before the
      // option existed, and it is the arm that must not have moved.
      const open = await SeedServer.start({
        blockstoreDir: await madeDir('open'),
        httpPort: 0,
        wsPort: 0,
        trustAnchors: 'runs-unsigned-artifacts',
      })
      seeds.push(open)

      // ARM B — told one issuer, through the field this plan added. Identical in every
      // other respect.
      const pinned = await SeedServer.start({
        blockstoreDir: await madeDir('pinned'),
        httpPort: 0,
        wsPort: 0,
        trustAnchors: 'runs-unsigned-artifacts',
        trustedIssuers: [SOME_ISSUER],
      })
      seeds.push(pinned)

      await open.node.dial(dialableAddr(peer))
      await pinned.node.dial(dialableAddr(peer))

      const peerId = peer.peerId
      await until(() => open.node.verifiedPeers.includes(peerId), 20_000, 'the open seed to see the peer')

      // Arm A: pinned nobody ⇒ the connected set is returned unchanged, and the peer is a
      // usable block source. This is `PeerVerifier`'s fail-open early return, and the
      // asymmetry sentence at that line says why the relay must never acquire it.
      expect(open.node.verifiedPeers).toContain(peerId)
      expect(open.node.verdictFor(peerId)).toBeUndefined()

      // Arm B: the verifier subscribed, asked, and the peer answered that it holds no
      // records. The verdict is **named**, which is the difference between a refusal and a
      // silence — and it is asserted before the exclusion, so "not in the list" cannot be
      // satisfied by a round trip that never happened.
      await until(
        () => pinned.node.verdictFor(peerId) !== undefined,
        20_000,
        'the pinned seed to settle a verdict on the peer',
      )
      const verdict = pinned.node.verdictFor(peerId)
      expect(verdict?.ok).toBe(false)
      expect(verdict?.ok === false ? verdict.failure.kind : null).toBe('no-records')
      expect(pinned.node.verifiedPeers).not.toContain(peerId)

      // The comparative statement, in one line: the same peer, at the same moment, is a
      // block source for one seed and not for the other, and the only difference between
      // the two seeds is the option this plan added.
      expect(open.node.verifiedPeers.includes(peerId)).not.toBe(
        pinned.node.verifiedPeers.includes(peerId),
      )
    } finally {
      await Promise.all(seeds.map((s) => s.stop().catch(() => {})))
      await Promise.all(peers.map((p) => p.stop().catch(() => {})))
      await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })))
    }
  }, 180_000)
})

/**
 * AUTH-02 — the two surfaces a person meets, and the sentences they now carry.
 *
 * ## Why this guard had to be written rather than extended
 *
 * Plan 24-02 instructed the executor to *extend whatever guard already reads
 * `'carries-no-certificate'` in `demo/main.ts`*. **Measured 2026-08-06: no such guard
 * exists.** Ten test files read `packages/browser/demo/main.ts` as source text —
 * `serve-agent-hooks`, `trust-anchors`, `purity`, `opt-in-only-sources`,
 * `checkpoint-optout-scope`, `sovereign-block-refusal`, `kernel-build`, and the three e2e
 * specs — and **not one of them mentions the literal**. The state is first-class in the
 * demo's own types and pinned by nothing that reads its source.
 *
 * It is not unguarded, and the distinction matters. `attestation-ui.e2e.test.ts` pins the
 * **rendered consequence**: an unenrolled peer makes the panel print *"this requestor holds
 * no certificate for it"*, and an enrolled one must not. That is a stronger reading than a
 * substring count and it is also an expensive one — it runs `vite build` and drives
 * Playwright over the built bundle, in an `e2e` project that sets `fileParallelism: false`.
 * So the two are complements: that file measures what a visitor sees, this one pins that
 * the source still says it, and only this one is cheap enough to run on every commit.
 *
 * ## What the counts and phrases mean
 *
 * The literal is counted over **stripped** source, so a comment naming the state is not a
 * state. The two new sentences are matched over **flowed prose** — comment markers removed
 * and whitespace collapsed — because they are documentation, which stripping deletes, and
 * because a sentence pinned as a raw line would be broken by rewrapping it rather than by
 * removing it. A guard that fires on reflowing is a guard somebody deletes.
 *
 * ## The forbidden vocabulary, and the word deliberately not on the list
 *
 * 24-CONTEXT's cardinal rule: certificate-holding is a per-node **fact**, never a node
 * kind. So neither surface may grow a `gated node` / `open node` label. **`lesser node` is
 * not forbidden** — it occurs once in `tab-api.ts`, in the sentence *"it is not a lesser
 * node"*, and that is the rule being **kept**. Forbidding the denial along with the
 * assertion would delete the clearest statement of the rule in either file, which is how a
 * guard ends up enforcing the opposite of its own subject.
 */
describe('AUTH-02 — the demo and the tab API say what carrying no certificate will mean', () => {
  const DEMO = 'packages/browser/demo/main.ts'
  const TAB_API = 'packages/browser/src/tab-api.ts'

  /** Documentation as a reader receives it: comment markers gone, wrapping collapsed. */
  const prose = (file: string): string =>
    readFileSync(join(ROOT, file), 'utf8')
      .replace(/^[ \t]*(\/\/+|\*+\/?|\/\*+)[ \t]?/gm, '')
      .replace(/\s+/g, ' ')

  it('reads real prose out of both files, so the phrases below are absences in text that exists', () => {
    // Anti-vacuity first. A `prose` that returned nothing would satisfy every negative and
    // fail every positive for a reason having nothing to do with either file.
    expect(prose(DEMO).length).toBeGreaterThan(20_000)
    expect(prose(TAB_API).length).toBeGreaterThan(10_000)
    // And it really did strip: a sentence both files carry inside a comment is reachable.
    expect(prose(TAB_API)).toContain('it is not a lesser node')
  })

  it('keeps the demo’s first-class absence as a value, not only as prose', () => {
    // Seven, over stripped source. The literal appears an eighth time in `attestedNodes`'s
    // own commentary, which is exactly why this counts the stripped form: a sentence about
    // the state is not the state.
    expect(occurrences(code(DEMO), "'carries-no-certificate'")).toBe(7)
  })

  it('says at the demo what the absence will mean once admission is gated', () => {
    // Phrased as a fact about *this tab* and as a promise about 24-03, which is the whole
    // of what Plan 24-02 was allowed to write: nothing refuses anybody yet.
    expect(prose(DEMO)).toContain('this tab can enrol, and until it does it will not be admitted')
    expect(prose(DEMO)).toContain('Nothing in this repository refuses anybody on this ground')
  })

  it('says at the tab API that a supplied relay address is the door admission is decided at', () => {
    expect(prose(TAB_API)).toContain(
      'A host page supplying this is supplying a front door, and the front door is where admission will be decided.',
    )
    // The exemption that makes the ruling implementable, stated where a page choosing an
    // address will meet it rather than only in a planning document.
    expect(prose(TAB_API)).toContain('The gate fires on the reservation and on nothing else.')
  })

  it('grows no node kind on either surface', () => {
    // See this block's docblock for why `lesser node` is absent from this list.
    const kinds = ['gated node', 'open node', 'admitted node', 'unadmitted node']
    for (const file of [DEMO, TAB_API]) {
      const lowered = prose(file).toLowerCase()
      for (const kind of kinds) expect([file, kind, lowered.includes(kind)]).toEqual([file, kind, false])
    }
  })
})

describe('the needles can fail, and are not prefix matches — measured, not reasoned', () => {
  // `serve-agent-hooks.node.test.ts`'s own comment records a needle that matched inside a
  // longer line and discriminated nothing for as long as it existed. That precedent is why
  // this block plants both forms through the same `occurrences` the census uses, rather
  // than arguing from the shape of the strings.

  // Assembled through {@link FIELD} for the reason stated there: written whole, these
  // three constants would be counted as call sites of the very repository they plant against.
  const OPEN = `  ${OPEN_POSTURE}\n`
  const PINNED = `  ${FIELD}: new Set([ISSUER]),\n`
  const EMPTY = `  ${FIELD}: new Set(),\n`

  it('counts an open posture as open and as a posture', () => {
    expect(occurrences(OPEN, OPEN_POSTURE)).toBe(1)
    expect(occurrences(OPEN, ANY_POSTURE)).toBe(1)
  })

  it('does not read a pinned set as an open posture', () => {
    // The prefix hazard, driven directly. If `OPEN_POSTURE` ever matched a line that pins a
    // set, `total - open` above would read 0 for a repository that had shut its door — the
    // exact failure this whole file exists to make impossible.
    expect(occurrences(PINNED, OPEN_POSTURE)).toBe(0)
    expect(occurrences(PINNED, ANY_POSTURE)).toBe(1)
    expect(occurrences(EMPTY, OPEN_POSTURE)).toBe(0)
    expect(occurrences(EMPTY, ANY_POSTURE)).toBe(1)
  })

  it('separates a mixed file exactly as the census would', () => {
    // The arithmetic the repository-wide row performs, on a source whose answer is known.
    const mixed = OPEN + PINNED + OPEN + EMPTY
    expect(occurrences(mixed, ANY_POSTURE)).toBe(4)
    expect(occurrences(mixed, OPEN_POSTURE)).toBe(2)
    expect(occurrences(mixed, ANY_POSTURE) - occurrences(mixed, OPEN_POSTURE)).toBe(2)
  })

  it('is not satisfied by a comment that merely names the posture', () => {
    // The reason the census strips first, shown working rather than assumed — the pair
    // `trust-anchors.node.test.ts` keeps for its own matcher. Without the second line an
    // over-eager stripper and a threaded repository are the same reading.
    expect(occurrences(stripComments(`// ${OPEN}`), OPEN_POSTURE)).toBe(0)
    expect(occurrences(stripComments(`/**\n * ${OPEN} */\n`), OPEN_POSTURE)).toBe(0)
    expect(occurrences(stripComments(OPEN), OPEN_POSTURE)).toBe(1)
  })
})

/**
 * AUTH-02 / AUTH-04 — **the gate decides, and this is the block that shows it deciding.**
 *
 * ## Why this is behavioural and cannot be a census
 *
 * Everything above counts source text, and a count cannot tell a gate that refuses the right
 * peer from one that refuses everybody. The three arms below are the whole of the ruling: a
 * peer with no certificate is refused, the same peer enrolled with the pinned issuer is
 * admitted, and a peer holding a certificate from a **different** issuer is refused *for a
 * different stated reason*. Without the third arm the gate might be checking "has any
 * certificate", which is not what the owner ruled.
 *
 * ## Comparative, in one run
 *
 * All three arms use the same relay construction, the same deadline and peers built by the
 * same helper. The only thing that differs between them is which issuer — if any — signed the
 * peer's certificate, so a divergence cannot be attributed to this machine or its load.
 *
 * ## What this block cannot show
 *
 * It cannot show that advertisement and dialling follow from the reservation — that is a
 * structural claim about `reservedPeerIds` and 24-04 measures it. It cannot show a browser tab
 * behaves this way; a `BrowserNode` runs no relay server at all. And it cannot show the
 * published benchmark curves did not move, which is 24-02's baseline re-run.
 */
describe('AUTH-02 — the relay consults RelayAdmission at the reservation, and only there', () => {
  const nodes: FabricNode[] = []
  const dirs: string[] = []

  const madeDir = async (name: string): Promise<string> => {
    const dir = await mkdtemp(join(tmpdir(), `o2-admission-${name}-`))
    dirs.push(dir)
    return dir
  }

  const stopAll = async (): Promise<void> => {
    await Promise.all(nodes.splice(0).map((n) => n.stop().catch(() => {})))
    await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })))
  }

  async function until(
    predicate: () => boolean,
    timeoutMs: number,
    what: string,
    observed?: () => unknown,
  ): Promise<void> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      if (predicate()) return
      await new Promise((r) => setTimeout(r, 50))
    }
    const tail = observed === undefined ? '' : `; observed ${JSON.stringify(observed())}`
    throw new Error(`timed out waiting for ${what}${tail}`)
  }

  const wsAddr = (node: FabricNode): string => {
    const addr = node.browserDialableAddrs[0]
    if (addr === undefined) throw new Error(`no browser-dialable address on ${node.peerId}`)
    return addr
  }

  /**
   * The three arms, in one run, against one relay.
   *
   * The relay pins **provider A**. Peer `mine` enrols with A, peer `theirs` enrols with an
   * entirely separate provider B, and peer `bare` never enrols at all. All three then ask the
   * same relay for a reservation.
   *
   * The relay is deliberately **not** the provider here — unlike
   * `enrol-through-a-closed-door.node.test.ts`, whose subject is the co-located topology a
   * browser tab is forced into. Separating them is what lets one relay pin an issuer it does
   * not itself own, which is the deployment sub-decision 1 says must remain possible.
   */
  it('refuses a peer with no certificate, admits one from the pinned issuer, and refuses one from another — each by name', async () => {
    try {
      const providerA = await FabricNode.start({
        relayAdmission: 'admits-any-peer',
        startReporting: 'reports-its-own-start',
        listen: ['/ip4/127.0.0.1/tcp/0/ws'],
        trustAnchors: 'runs-unsigned-artifacts',
        blockstoreDir: await madeDir('provider-a'),
        issuesCertificates: 'issues-without-an-aggregate-budget',
      })
      nodes.push(providerA)
      const providerB = await FabricNode.start({
        relayAdmission: 'admits-any-peer',
        startReporting: 'reports-its-own-start',
        listen: ['/ip4/127.0.0.1/tcp/0/ws'],
        trustAnchors: 'runs-unsigned-artifacts',
        blockstoreDir: await madeDir('provider-b'),
        issuesCertificates: 'issues-without-an-aggregate-budget',
      })
      nodes.push(providerB)

      const pinned = providerA.issuerKey
      expect(pinned, 'provider A must issue certificates or there is nothing to pin').not.toBeNull()
      expect(providerB.issuerKey).not.toBe(pinned)

      // The relay under test. This is the first construction site in this repository ever to
      // state something other than the open posture.
      const relay = await FabricNode.start({
        relayAdmission: new Set([pinned as string]),
        startReporting: 'reports-its-own-start',
        listen: ['/ip4/127.0.0.1/tcp/0/ws'],
        trustAnchors: 'runs-unsigned-artifacts',
        blockstoreDir: await madeDir('relay'),
      })
      nodes.push(relay)
      const door = wsAddr(relay)

      const joiner = async (name: string, provider: FabricNode | null): Promise<FabricNode> => {
        const node = await FabricNode.start({
          relayAdmission: 'admits-any-peer',
          startReporting: 'reports-its-own-start',
          listen: [],
          relayAddrs: [door],
          rpcTimeoutMs: 20_000,
          trustAnchors: 'runs-unsigned-artifacts',
          blockstoreDir: await madeDir(name),
          ...(provider === null
            ? {}
            : {
                enrollment: {
                  userPrivateKey: new Uint8Array(32).fill(name.charCodeAt(0)),
                  operatorId: `${name}-ops`,
                  providerAddr: wsAddr(provider),
                },
              }),
        })
        nodes.push(node)
        return node
      }

      const mine = await joiner('mine', providerA)
      const theirs = await joiner('theirs', providerB)
      const bare = await joiner('bare', null)

      // ---- arm 2 first, because it is the one that can be waited *for*. ----------------
      // The other two are absences, and an absence is only meaningful once the fixture has
      // been shown capable of producing a presence.
      await until(
        () => relay.reservedPeerIds.includes(mine.peerId),
        60_000,
        'the peer from the pinned issuer to be admitted',
        () => ({ reserved: relay.reservedPeerIds, decisions: relay.admissionDecisions }),
      )
      expect(relay.reservedPeerIds).toContain(mine.peerId)

      // Every peer has been decided about by now — `mine` is in, so the gate has run — but
      // the two refusals settle independently, so wait for each decision rather than assuming
      // one ordering.
      await until(
        () =>
          relay.admissionDecisions.some((d) => d.peerId === theirs.peerId) &&
          relay.admissionDecisions.some((d) => d.peerId === bare.peerId),
        60_000,
        'a decision about all three peers',
        () => ({ decisions: relay.admissionDecisions }),
      )

      const about = (peer: FabricNode) => relay.admissionDecisions.find((d) => d.peerId === peer.peerId)

      // ---- arm 1: no certificate at all. ----------------------------------------------
      expect(relay.reservedPeerIds).not.toContain(bare.peerId)
      expect(about(bare)?.admitted).toBe(false)
      expect(about(bare)?.reason).toContain('holds no provider-issued certificate')

      // ---- arm 3: a certificate, from the wrong issuer. --------------------------------
      // **The load-bearing arm.** Without it the gate might be checking that a certificate
      // exists, which is a signature test and not admission. The reason must also
      // *distinguish* this from arm 1 — an operator who cannot tell "brought nothing" from
      // "brought the wrong thing" cannot act on either.
      expect(theirs.certificate).not.toBeNull()
      expect(relay.reservedPeerIds).not.toContain(theirs.peerId)
      expect(about(theirs)?.admitted).toBe(false)
      expect(about(theirs)?.reason).toContain('not a pinned provider')
      expect(about(theirs)?.reason).not.toContain('holds no provider-issued certificate')

      // ---- and the admission itself is named too, not merely implied by presence. ------
      expect(about(mine)?.admitted).toBe(true)
      expect(about(mine)?.reason).toContain('from a pinned issuer')
      // It was admitted **by a lookup**, not by a default. Without this the arm would still
      // pass if the gate answered "allow" without ever asking anybody, which is precisely the
      // shape a fail-open gate takes.
      expect(about(mine)?.attempts).toBeGreaterThan(0)
      expect(about(theirs)?.attempts).toBeGreaterThan(0)
      expect(about(bare)?.attempts).toBeGreaterThan(0)

      // The refusals are per-peer rather than a switch: one relay, three peers, one admitted.
      expect(relay.reservedPeerIds).toEqual([mine.peerId])

      // And nothing else was gated. All three peers are connected to the relay — the plain
      // connection stands for every one of them, which is the property that keeps enrolment
      // reachable through a closed door.
      for (const peer of [mine, theirs, bare]) {
        expect(peer.transport.peers, `${peer.peerId} lost its connection`).toContain(relay.peerId)
      }
    } finally {
      await stopAll()
    }
  }, 180_000)

  /**
   * `'admits-any-peer'` supplies **no gater method at all**, and this is the plant that
   * catches an implementation supplying `() => false` instead.
   *
   * The distinction is not pedantry. `@libp2p/circuit-relay-v2` optional-calls the hook, so an
   * absent method is byte-for-byte today's behaviour, while a present-and-permissive one is a
   * decision that was taken — and 24-02's pre-gate benchmark baseline is only comparable while
   * the open posture means *nobody was asked*. A relay that "allows" is not a relay that was
   * never consulted.
   */
  it('builds no gate at all for the open posture, and a real one for a pinned set', () => {
    expect(relayAdmissionGate({ admission: 'admits-any-peer', rpc: () => null })).toBeUndefined()
    expect(relayAdmissionGate({ admission: new Set(['a'.repeat(64)]), rpc: () => null })).toBeTypeOf('function')
    // The empty set is a gate, not an absence — sub-decision 2's whole point.
    expect(relayAdmissionGate({ admission: new Set(), rpc: () => null })).toBeTypeOf('function')
  })

  /**
   * The predicate's edges, exercised **without standing up a relay**.
   *
   * `24-CONTEXT.md` makes that non-discretionary: a predicate reachable only through a live
   * libp2p node is a predicate nobody tests the edges of. These are the three dispositions a
   * live fixture is worst at producing on demand.
   */
  it('refuses on an empty set, on an unaskable relay, and on a peer that never answers — never admitting while it does not know', async () => {
    const peer = peerIdFromString('12D3KooWQYV9dGMFoRzNStwpXztXaBUjtPqi6aU76ZgUriHhKust')

    // 1. Pinned nobody. Refused with no I/O — no certificate can chain to an empty set, so
    //    spending a round trip to find that out would be waste with a security label on it.
    const closed: AdmissionDecision[] = []
    const shut = relayAdmissionGate({ admission: new Set(), rpc: () => null, onDecision: (d) => closed.push(d) })
    expect(await shut?.(peer)).toBe(true)
    expect(closed[0]?.attempts).toBe(0)
    expect(closed[0]?.reason).toContain('admits no peer')

    // 2. The relay is not serving yet, so it cannot ask. **Refused, not awaited.** A relay
    //    that cannot ask a peer anything has not decided anything, and the one disposition a
    //    gate may never take is to admit while it does not know.
    const unasked: AdmissionDecision[] = []
    const early = relayAdmissionGate({
      admission: new Set(['b'.repeat(64)]),
      rpc: () => null,
      deadlineMs: 150,
      retryGapMs: 20,
      onDecision: (d) => unasked.push(d),
    })
    expect(await early?.(peer)).toBe(true)
    expect(unasked[0]?.admitted).toBe(false)
    expect(unasked[0]?.reason).toContain('not yet serving')

    // 3. **The admit-while-pending plant.** The endpoint exists and simply never answers, so
    //    every ask is outstanding when the budget runs out. If the gate resolved `false`
    //    (admit) on the way out, it would be decoration under load — the exact defect
    //    `peer-verifier.ts` records finding by measurement on 2026-08-01. It must refuse.
    const pending: AdmissionDecision[] = []
    const neverAnswers = { request: async () => new Promise<never>(() => {}) } as unknown as RpcEndpoint
    const stalled = relayAdmissionGate({
      admission: new Set(['c'.repeat(64)]),
      rpc: () => neverAnswers,
      deadlineMs: 400,
      attemptMs: 80,
      retryGapMs: 20,
      onDecision: (d) => pending.push(d),
    })
    expect(await stalled?.(peer)).toBe(true)
    expect(pending[0]?.admitted).toBe(false)
    // It really did keep asking rather than blocking on one outstanding request — which is
    // the retry the measured drop-into-an-empty-handler-set requires.
    expect(pending[0]?.attempts).toBeGreaterThan(1)
    expect(pending[0]?.reason).toContain('did not answer a records request')
    // And it stayed inside its budget, which is what keeps it inside libp2p's own 5 s
    // reservation ceiling. Sited against the deadline it was given, not against the clock.
    expect(pending[0]?.ms).toBeLessThan(400 * 4)
  })
})
