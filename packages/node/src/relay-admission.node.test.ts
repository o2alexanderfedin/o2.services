import { execFileSync, spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { peerIdFromString } from '@libp2p/peer-id'
import { EnrollmentAuthority, MemoryNetwork, publishCapabilities, requestEnrollment } from '@o2/core'
import type { NodeRecords, PublicKeyHex } from '@o2/core'
import { SEED_BYTES, identityFromSeed } from '@o2/libp2p'
import { RpcEndpoint, encodeResponse, parseRequest } from '@o2/net'
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
  /**
   * Raw {@link ANY_POSTURE} occurrences in this file — **not** the census's posture count.
   *
   * The distinction was latent until 2026-08-06 and cost a run to find: {@link census}
   * subtracts {@link DECLARATION} to get posture *sites*, while the row below compares this
   * number against the **unsubtracted** count. For every file that declares nothing the two
   * are the same number, which is why no row had ever had to say which it was.
   * `seed-server.ts` now declares the forwarded field, so they differ there by one, and this
   * field is documented rather than quietly re-fitted.
   */
  readonly total: number
  /**
   * How many of {@link PostureSite.total} are the field's own **declaration** rather than a
   * site stating a posture — so `total - declares` is what the file actually constructs.
   *
   * **Added 2026-08-06 by Plan 24-06, and required on every row rather than defaulted.**
   * Without it a row reading `total: 2` cannot distinguish one declaration beside one
   * construction site from two construction sites, and those are different claims about a
   * deployment. Every row states it, including the three that state `0`: a default here would
   * be the silent-default shape this option's own docblock forbids, applied to the guard that
   * watches it.
   */
  readonly declares: number
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
    // **Moved 2026-08-06 by Plan 24-06, on the owner ruling of that date.** `open` is now
    // **0** and `total` is unchanged at 1. This file no longer writes the bare open literal:
    // it forwards `SeedServerOptions.relayAdmission` to `FabricNode.start`, so the front door
    // of the LAN demo is a deployment choice rather than a constant. The two occurrences the
    // census sees here are the forwarded field's own declaration — subtracted, see
    // {@link DECLARATION} — and the one construction site that reads it.
    open: 0,
    total: 2,
    declares: 1,
    reason:
      'the seed binds a real listening socket, so it relays, so this is the value that decides who joins through it — the front door of the LAN demo and the one a browser tab reaches first. Its posture now comes from its operator, through SeedServerOptions.relayAdmission, so this file states no posture of its own and the door is a deployment choice rather than a literal',
  },
  {
    // **Added 2026-08-06 by Plan 24-06.** After that plan this binary contains one
    // `ANY_POSTURE` occurrence and zero `OPEN_POSTURE` ones — **counted on the edited tree,
    // not predicted** — and it is a production entry point, so leaving it out would create the
    // first unguarded production posture site in the repository.
    file: 'packages/node/src/bin/seed.ts',
    open: 0,
    total: 1,
    declares: 0,
    reason:
      'the LAN demo’s entry point, and the second production binary that can be told to close a door — --admit-issuer reaches the required key through a ternary whose absent arm is the open literal, so nineteen bin/agent.ts and three bin/seed.ts argv sites keep working unchanged and a seed told nothing is byte-identical to the seed before the flag existed; whether it should instead refuse to start when an operator states neither an issuer nor an open posture is the same open owner ruling stated at bin/agent.ts, and it is not this row’s to decide',
  },
  {
    file: 'packages/node/src/bin/agent.ts',
    // **Moved 2026-08-06 by Plan 24-03, and the shape of the move is the finding.** `open` is
    // now **0** and `total` is **2**, and neither number means what a first reading suggests.
    //
    // This binary no longer writes the bare literal anywhere. `--admit-issuer` reaches the
    // required `relayAdmission` key through a ternary whose absent arm *is* `'admits-any-peer'`
    // — so the default behaviour is byte-for-byte what it always was, while the source no
    // longer contains `relayAdmission: 'admits-any-peer',` for {@link OPEN_POSTURE} to match.
    // The second occurrence is the handshake line, which publishes the posture so that a
    // fixture spawning a closed-arm agent can assert the arm is really closed.
    //
    // **This is the site that takes the repository-wide row off zero**, which is exactly what
    // that row's own docblock said would happen and what defect #51 needed to happen: it is
    // the first production site in this repository that can be told to refuse somebody.
    open: 0,
    total: 2,
    declares: 0,
    reason:
      'the production Node entry point, and the first that can be told to close a door — --admit-issuer reaches the required key through a ternary whose absent arm is the open literal, and the posture is published on the handshake line so a spawned closed arm can be asserted closed; whether it should instead refuse to start when an operator states neither an issuer nor an open posture is an open owner ruling, costed and deliberately not decided',
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
    declares: 0,
    reason:
      'the in-process rig behind both published curves: the --discover arm’s provider, the N workers the curve is a curve of, and the requestor — three sites, three decisions, each stating at its own line what its numbers do not claim about admission',
  },
  {
    file: 'packages/node/src/bench-fabric.ts',
    open: 1,
    total: 1,
    declares: 0,
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

// **Retitled 2026-08-06.** It read *"every relay-capable site states a posture, and every one
// of them is open"*, and the second half stopped being true when `bin/agent.ts` learned to
// close a door. Renaming it is not cosmetic and it is not free: a test **name is code** —
// `stripComments` leaves it in — so a title containing a spelled-out matcher makes this file
// count itself as a site, which is how this block first went red. The new title is written to
// name no matcher at all, which is the cheaper of the two available answers (the other being
// to assemble it from fragments the way the case titles below do).
describe('every relay-capable site states a posture, and not all of them are open', () => {
  for (const site of PRODUCTION_SITES) {
    // **Retitled 2026-08-06 by Plan 24-06.** It read `states its posture, and it is open`,
    // which stopped being true of `bin/agent.ts` when 24-03 gave that binary a ternary and
    // stopped being true of both seed rows here. A title that names a value the row does not
    // assert is a title a reader trusts instead of reading the row, so it now names what the
    // row actually does: the counts are whatever the row records, and `open` is one of them.
    it(`${site.file} states the posture this list records for it`, () => {
      expect(occurrences(code(site.file), ANY_POSTURE)).toBe(site.total)
      expect(occurrences(code(site.file), OPEN_POSTURE)).toBe(site.open)
      // See {@link PostureSite.declares}. Pinned per file, so `total - declares` is the number
      // of places this file actually decides who gets in, and a declaration migrating into or
      // out of a production file cannot be absorbed by the raw count above.
      expect(occurrences(code(site.file), DECLARATION)).toBe(site.declares)
      expect(site.reason.length).toBeGreaterThan(20)
    })
  }

  for (const site of RIG_SITES) {
    it(`${site.file} states a rig posture, and it is open`, () => {
      expect(occurrences(code(site.file), ANY_POSTURE)).toBe(site.total)
      expect(occurrences(code(site.file), OPEN_POSTURE)).toBe(site.open)
      expect(occurrences(code(site.file), DECLARATION)).toBe(site.declares)
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

  /**
   * **INVERTED 2026-08-06 (Plan 24-03) — this is defect #51's row, and it is the only one in
   * the repository that fails while the door stays open.**
   *
   * It read `expect(REPO.total - REPO.open).toBe(0)` and its own docblock predicted this
   * change: *"Plans 24-02 and 24-03 take it off zero on purpose, and when they do, this row is
   * what makes them say so."* This is it saying so.
   *
   * The defect being answered: every guard 24-01 built fires when the door **closes**, and
   * nothing anywhere fired while it stayed **open**. All four cases were green on a fabric that
   * refused nobody and would have stayed green forever if this phase had never run. A phase
   * whose entire evidence is "the suite went red when we changed something" has no reading at
   * all if the change is never made — *a proof that cannot fail is not a proof*.
   *
   * **Observed red before the gate and green after**, which is the one thing about this row
   * that cannot be established by inspection. Red on the tree immediately before `bin/agent.ts`
   * learned `--admit-issuer`: `expected 2 to be +0`.
   */
  it('shuts the door at at least one production site, and names which', () => {
    // The floor is unchanged and still a floor: it says the option is still threaded through
    // every node this repository builds, and it fails when sites stop stating a posture —
    // which, because the field is required, means when nodes are deleted.
    expect(REPO.open).toBeGreaterThanOrEqual(60)

    // **The inversion.** `total - open` counts sites stating something other than the open
    // literal. It must now be at least one, because the whole of Phase 24 is that a relay can
    // be told to refuse — and a repository where this is zero again is a repository where the
    // gate can no longer be reached from any deployment.
    expect(REPO.total - REPO.open).toBeGreaterThanOrEqual(1)

    // And it names **which** production site, so the row cannot be satisfied by an unrelated
    // fixture drifting. `bin/agent.ts` is the site: `--admit-issuer` reaches the required key
    // through a ternary whose absent arm is the open literal, so the file states a posture
    // that is no longer the bare literal even when nobody passes the flag.
    //
    // ## This half was VACUOUS on its first writing, and the repair is the interesting part
    //
    // It read `expect(occurrences(agent, ANY_POSTURE)).toBeGreaterThan(occurrences(agent,
    // OPEN_POSTURE))`. Planted with this row's own prescribed mutation — the bare open literal
    // restored at the construction site — it **stayed green**: the handshake line contributes
    // a second `${FIELD}:` occurrence, so the inequality held (2 > 1) while the site that
    // actually *decides* had gone back to admitting everybody. A row satisfiable by a line
    // that merely **reports** a posture is not a row about a door.
    //
    // The repair keys on the thing the mutation restores. Zero, exactly: this binary must not
    // write the bare open literal anywhere, because both of its two occurrences of the field
    // are now ternaries. Planted again after the repair, it reddens.
    const agent = code('packages/node/src/bin/agent.ts')
    expect(occurrences(agent, OPEN_POSTURE)).toBe(0)
    expect(occurrences(agent, ANY_POSTURE)).toBeGreaterThan(0)
    expect(agent).toContain("values['admit-issuer']")
  })

  /**
   * **SPLIT, not raised, 2026-08-06 by Plan 24-06 — and a reader who meets a `1` becoming a
   * `2` will read it as a bar being lowered unless this paragraph is here.**
   *
   * This row read `expect(REPO.declarations).toBe(1)`, and its stated purpose was that *"two
   * factories cannot drift"*. Plan 24-06 gave `SeedServerOptions` a forwarded
   * `FabricNodeOptions['relayAdmission']`, which takes the repository-wide count to 2. That
   * forward is **not** a second factory — it is definitionally the same type, and it exists
   * precisely so that `seed-server.ts` states no second answer to *"who does this node
   * admit"*. But the census reads text and cannot tell the two apart, **so the repair goes on
   * this side rather than in the bar**: bumping the number to 2 would have closed a gap by
   * widening what passes, which is the move this repository forbids by name.
   *
   * So the count is **split by shape** instead of raised:
   *
   *   - a **defining** declaration is the field followed by the union type name;
   *   - a **forwarding** declaration is the field followed by an indexed access into
   *     `FabricNodeOptions`.
   *
   * **This is strictly stronger than the row it replaces, and here is the state that proves
   * it.** Under `toBe(1)`, a hand-written `readonly relayAdmission: 'yes' | 'no'` sitting
   * alone in `fabric-node.ts` counted as one declaration and **passed**. Under the split it
   * does not: the one declaration must be the union *by name*. And a **third** shape — a
   * hand-written union anywhere in the repository, which is exactly the second answer this row
   * has always been about — fails the closing sum by name, where under a `toBe(2)` it would
   * have passed silently.
   *
   * Both needles are assembled from {@link FIELD} for that constant's stated reason: this file
   * is inside its own jurisdiction, and a needle written whole makes the census report itself.
   */
  it('declares the field once by name and forwards it by indexed access, so no third shape can appear', () => {
    // Assembled, never written whole. See {@link FIELD}.
    const DEFINING = `${DECLARATION} RelayAdmission`
    const FORWARDING = `${DECLARATION} FabricNodeOptions['${FIELD}']`

    /** Which files carry a declaration of this shape, and how many — SELF excluded exactly as
     *  {@link census} excludes it, so the closing sum below is comparable to `REPO.declarations`. */
    const declaring = (needle: string): { readonly files: readonly string[]; readonly count: number } => {
      let count = 0
      const files: string[] = []
      for (const [file, source] of REPO.stripped) {
        if (file === SELF) continue
        const here = occurrences(source, needle)
        if (here === 0) continue
        count += here
        files.push(file)
      }
      return { files: [...files].sort(), count }
    }

    const defining = declaring(DEFINING)
    const forwarding = declaring(FORWARDING)

    // Exactly one type *defines* the field, and it is the node factory's own options.
    expect(defining.count).toBe(1)
    expect(defining.files).toEqual(['packages/node/src/fabric-node.ts'])

    // Every other declaration forwards, and the file set is pinned exactly rather than
    // bounded — the same idiom `has exactly one production caller for the predicate` uses
    // below, and for the same reason: a new forwarder is a decision somebody took, and it
    // should have to be recorded here rather than absorbed.
    expect(forwarding.files).toEqual(['packages/node/src/seed-server.ts'])

    // **The closing sum, and it is the half that makes this a repair.** Defining plus
    // forwarding must account for *every* declaration the census found. A hand-written union
    // anywhere — the second answer this row has always existed to forbid — is neither shape,
    // so it lands outside the sum and fails here by name.
    expect(defining.count + forwarding.count).toBe(REPO.declarations)

    // And the factory still declares it once, which is the half of the old row that was
    // always right.
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
        // AUTH-02 — required since Plan 24-06, and **open in BOTH arms deliberately**. This
        // block's subject is `trustedIssuers`, which is selection; varying admission at the
        // same time would make the divergence below attributable to either field. The two
        // arms differ in exactly one option, which is what makes the comparison a reading.
        relayAdmission: 'admits-any-peer',
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
        // Open — see arm A. The peer below holds no certificate, so a pinned set here would
        // refuse it a reservation and the verdict this arm reads would never be reached.
        relayAdmission: 'admits-any-peer',
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

      /**
       * **A refusal, read VERDICT-FIRST and STORE-SECOND — and the order is the whole of
       * what a red here is worth.**
       *
       * ## The ambiguity this removes, priced by the run that paid for it
       *
       * Both refusing arms used to open with `expect(relay.reservedPeerIds).not.toContain(…)`
       * and reach the decision record three lines later. So the first — and, because vitest
       * stops at the first failed assertion, the *only* — thing a red said was *"a peer that
       * should be out is in"*. That sentence cannot distinguish:
       *
       *   **(a) the gate ANSWERED ADMIT** — `relayAdmissionGate` returned "allow" for a peer
       *   this relay pins against. A defect in admission itself, and the event Phase 24
       *   criterion 8 says cannot happen.
       *   **(b) an entry appeared WITHOUT a grant** — the gate refused and a reservation
       *   exists anyway. A defect in `@libp2p/circuit-relay-v2` or in this fixture, and *not*
       *   a statement about the gate at all.
       *
       * On 2026-08-06 that ambiguity turned a probable orchestration artefact — a concurrent
       * agent's live plant in `fabric-node.ts`, observed by another agent as a red here — into
       * a reported security defect that was escalated to the owner. Resolving it cost **111
       * executions**, a patch to `node_modules/@libp2p/circuit-relay-v2` to read the gater's
       * return value directly, and a reading of the library's call ordering to establish that
       * branch (b) is unreachable by construction: the gater is awaited strictly before
       * `reservationStore.reserve(…)`, and `reserve()` has exactly one caller. Every one of
       * those steps was answering a question this assertion order answers on the first red.
       *
       * The gate already carried the evidence the whole time. `relayAdmissionGate` produces
       * `{admitted, reason}` through `decide(…)` and hands it to an `onDecision` callback this
       * file already uses — so nothing new is measured here. It is read in the order that makes
       * it explain rather than merely accompany.
       *
       * ## Why it is a helper rather than two hand-written orderings
       *
       * Both refusing arms have the identical shape, and the defect was that one of them had
       * the order backwards. Two hand-written copies is exactly how they diverged once already;
       * a shared reading cannot.
       */
      const refusedAtTheDoor = (peer: FabricNode, name: string): AdmissionDecision => {
        const verdict = about(peer)
        // Nothing above narrows this, so the missing-verdict case gets its own sentence: a
        // gate that never ran is neither (a) nor (b), and reporting it as either would name a
        // cause that is not the cause. The `until` above waits for exactly this record, so a
        // red here means the wait was satisfied by a decision about somebody else.
        expect(
          verdict,
          `THE GATE REACHED NO VERDICT ABOUT ${name} — neither branch below can be attributed, ` +
            'because the relay has no decision record for this peer at all',
        ).toBeDefined()
        if (verdict === undefined) throw new Error(`no admission decision about ${name}`)

        // **(a) first.** If the gate said yes, that is the finding, and any store entry below
        // is its consequence rather than an independent fact.
        expect(
          verdict.admitted,
          `(a) THE GATE ANSWERED ADMIT for ${name} — relayAdmissionGate returned "allow" for a ` +
            `peer this relay pins against. This is an admission defect in the gate; a ` +
            `reservation ${name} holds follows FROM it and does not need separate explaining. ` +
            `Reason the gate gave: ${JSON.stringify(verdict.reason)}`,
        ).toBe(false)

        // **(b) second, and only now meaningful.** The verdict is established as refuse one
        // line up, so an entry here cannot have come from this gate saying yes.
        expect(
          relay.reservedPeerIds,
          `(b) A RESERVATION EXISTS THAT NO GRANT EXPLAINS — the gate REFUSED ${name} ` +
            `(asserted immediately above: admitted === false, reason ` +
            `${JSON.stringify(verdict.reason)}), and a reservation exists anyway. This is NOT ` +
            'an admission defect: look at @libp2p/circuit-relay-v2 and at this fixture. Note ' +
            'that this branch was established unreachable by construction on 2026-08-06 — the ' +
            'gater is awaited strictly before reservationStore.reserve(), which has one caller ' +
            '— so a red here is first of all a reason to check whether another agent is ' +
            'holding a plant in the tree',
        ).not.toContain(peer.peerId)

        return verdict
      }

      // ---- arm 1: no certificate at all. ----------------------------------------------
      expect(refusedAtTheDoor(bare, 'bare').reason).toContain('holds no provider-issued certificate')

      // ---- arm 3: a certificate, from the wrong issuer. --------------------------------
      // **The load-bearing arm.** Without it the gate might be checking that a certificate
      // exists, which is a signature test and not admission. The reason must also
      // *distinguish* this from arm 1 — an operator who cannot tell "brought nothing" from
      // "brought the wrong thing" cannot act on either.
      expect(theirs.certificate).not.toBeNull()
      const theirsRefusal = refusedAtTheDoor(theirs, 'theirs')
      expect(theirsRefusal.reason).toContain('not a pinned provider')
      expect(theirsRefusal.reason).not.toContain('holds no provider-issued certificate')

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

  /**
   * AUTH-04 — **the borrowed certificate, at the door**, and the reason this case had to be
   * written rather than inherited.
   *
   * ## The gap, measured rather than argued
   *
   * `relayAdmissionGate` derives `expected` from the asking peer id and refuses a certificate
   * whose `nodeKey` names a different key. Its docblock says why that is not redundant with
   * the signature check, and it is right: `verifyCertificate` is handed a certificate and an
   * issuer set, and **cannot know which peer is holding it**.
   *
   * Until this case existed, nothing read that line. Neutralising the comparison to
   * `certificate.nodeKey !== expected && expected === ''` — every type, symbol and refusal
   * string left byte-intact — stayed **green across eight admission specs and five runs**,
   * while a control plant on `enrollment.ts`'s aggregate budget reddened at exit 1 against a
   * matched clean baseline. So the instrument read, and the silence was a fact about the
   * corpus rather than about the day.
   *
   * The borrowed case exists exactly once in this repository, at
   * `peer-verifier.node.test.ts`'s `nodeKey-mismatch` row. **That guards SELECTION** — who a
   * node will *use* as a block source. Every door reading — the three arms above,
   * `closed-fabric-agents.node.test.ts`, `gated-admission.e2e.test.ts`, `gated-seed.e2e.test.ts`
   * — has an **enrolled-versus-unenrolled** axis and never a **borrowed** one, so not one of
   * them can tell *"one certificate admits one identity"* from *"one certificate admits
   * anybody who can copy it off the wire"*.
   *
   * ## Why that distinction is the whole of a per-identity price
   *
   * Bounded issuance prices identity creation only while one certificate admits exactly one
   * peer. Remove this binding and a single legitimately-issued certificate admits an unbounded
   * number of peers through every closed door in this fabric — and the issuance budget, which
   * is the thing doing the pricing, prices nothing at all.
   *
   * ## Why a hand-built answer rather than a fourth live joiner
   *
   * This case needs a peer that **lies** — one that answers a `records` ask about its own key
   * with somebody else's certificate. `peer-verifier.node.test.ts` records the standing ruling
   * for exactly that need: a lying mode on `FabricNode` would be a test-only branch in
   * production code, and 17-CONTEXT.md forbids a `--forge` flag on any binary. So the answer is
   * built directly and served over `MemoryNetwork` through the same `parseRequest` /
   * `encodeResponse` pair production uses, and the subject is `relayAdmissionGate` itself — the
   * door's own predicate, the instrument the three-disposition case above already uses, for the
   * reason stated there.
   *
   * ## What makes the refusal attributable to THIS check and to no sibling of it
   *
   * Two readings in one run, over **one certificate**: the borrower is refused and the refusal
   * names both keys; and the peer that certificate actually names, asked by the same gate
   * against the same pinned issuer set moments later, is **admitted**. The second is what makes
   * the first a reading — a certificate that is admitted cannot be unsigned, cannot be expired
   * and cannot be from an unpinned issuer, so the borrower's refusal has nowhere else to come
   * from. The negative on `refused:` closes it from the other side: every failure
   * `verifyCertificate` produces reaches an operator through that prefix, and this one does not
   * carry it.
   *
   * ## What this cannot show
   *
   * It cannot show libp2p really consults the gate at a reservation — that is the three-arm
   * live case above, and this one deliberately shares no fixture with it.
   */
  it('refuses a peer presenting a certificate issued to a different peer, and admits the peer that certificate names', async () => {
    // Fixed patterns, not random — a failing run must be reproducible. These four are local
    // to this case: no other fixture in this file mints an identity, so there is no shared
    // seed table to drift from.
    const RIGHTFUL_SEED = new Uint8Array(SEED_BYTES).fill(0xb1)
    const BORROWER_SEED = new Uint8Array(SEED_BYTES).fill(0xb2)
    const PROVIDER_SEED = new Uint8Array(SEED_BYTES).fill(0xb3)
    const USER_SEED = new Uint8Array(SEED_BYTES).fill(0xb4)

    const rightful = await identityFromSeed(RIGHTFUL_SEED)
    const borrower = await identityFromSeed(BORROWER_SEED)
    // The premise, asserted rather than assumed: two identities, and the peer ids really do
    // imply different node keys. Two seeds that collided would make every reading below pass
    // for a reason having nothing to do with the door.
    expect(borrower.nodeKey).not.toBe(rightful.nodeKey)
    expect(borrower.peerId).not.toBe(rightful.peerId)

    // One real provider, one real enrolment. **Nothing here is forged** — that is the point:
    // only the *presenter* is wrong.
    const authority = new EnrollmentAuthority({
      providerPrivateKey: PROVIDER_SEED,
      certificateLifetimeMs: 30 * 24 * 3_600_000,
      maxIssuedPerWindow: 'issues-without-an-aggregate-budget',
      issuance: 'remembers-only-within-this-process',
    })
    const issued = authority.enrol(
      await requestEnrollment(RIGHTFUL_SEED, USER_SEED, {
        operatorId: 'harbour-ops',
        discoverability: 'seed',
        relayIds: [],
      }),
      Date.now(),
    )
    if (!issued.ok) throw new Error(`fixture enrolment refused: ${issued.reason}`)
    const { certificate } = issued
    expect(certificate.nodeKey).toBe(rightful.nodeKey)
    expect(certificate.expiresAt).toBeGreaterThan(Date.now())

    const records: NodeRecords = {
      certificate,
      capabilities: publishCapabilities(RIGHTFUL_SEED, {
        features: [],
        sovereignFor: [],
        issuedAt: certificate.issuedAt,
        expiresAt: certificate.expiresAt,
        extensions: [],
      }),
    }

    /**
     * One network, two serving peers, **one certificate between them**.
     *
     * Each answers every `records` ask with the same bytes, so the borrower is doing the one
     * thing a copied certificate lets a peer do: replying to a question about its own key with
     * a document about somebody else's. The key it was asked about is recorded, because the
     * whole claim is that the gate derived `expected` from the peer id it was gating.
     */
    const network = new MemoryNetwork()
    const endpoints: RpcEndpoint[] = []
    const asked = new Map<string, PublicKeyHex[]>()
    const serveAt = (address: string): void => {
      const keys: PublicKeyHex[] = []
      asked.set(address, keys)
      const server = new RpcEndpoint(network.connect(address))
      server.serve(async (_from, body) => {
        const request = parseRequest(body)
        if (request === null || request.kind !== 'records') {
          return encodeResponse({ kind: 'error', reason: `unexpected request ${String(request?.kind)}` })
        }
        keys.push(request.nodeKey)
        return encodeResponse({ kind: 'records', records })
      })
      endpoints.push(server)
    }
    serveAt(borrower.peerId)
    serveAt(rightful.peerId)

    const relayRpc = new RpcEndpoint(network.connect('the-relay'))
    endpoints.push(relayRpc)

    try {
      const decisions: AdmissionDecision[] = []
      const gate = relayAdmissionGate({
        admission: new Set([authority.issuerKey]),
        rpc: () => relayRpc,
        deadlineMs: 5_000,
        attemptMs: 2_000,
        retryGapMs: 20,
        onDecision: (d) => decisions.push(d),
      })
      expect(gate, 'a pinned issuer set must build a gate').toBeTypeOf('function')

      // ---- arm 1: the borrower. `true` denies. -----------------------------------------
      expect(await gate?.(peerIdFromString(borrower.peerId))).toBe(true)

      // ---- arm 2: the peer the certificate names, same gate, same pinned set. -----------
      // Ordered second on purpose. An absence is only a reading once the fixture has been
      // shown capable of producing a presence, and this arm is that presence.
      expect(await gate?.(peerIdFromString(rightful.peerId))).toBe(false)

      const about = (peerId: string): AdmissionDecision | undefined =>
        decisions.find((d) => d.peerId === peerId)

      // ---- arm 2 read first, because it is what licenses arm 1's attribution. -----------
      expect(about(rightful.peerId)?.admitted).toBe(true)
      expect(about(rightful.peerId)?.reason).toContain('from a pinned issuer')
      // Admitted **by a lookup** rather than by a default — the shape a fail-open gate takes.
      expect(about(rightful.peerId)?.attempts).toBeGreaterThan(0)

      // ---- arm 1, and the refusal names both keys. --------------------------------------
      const refusal = about(borrower.peerId)
      expect(refusal?.admitted).toBe(false)
      expect(refusal?.attempts).toBeGreaterThan(0)
      expect(refusal?.reason).toContain(`presented a certificate for ${rightful.nodeKey}`)
      expect(refusal?.reason).toContain(`its peer id implies ${borrower.nodeKey}`)

      // **The attribution, from the other side.** Every refusal `verifyCertificate` produces
      // reaches an operator through the `refused:` prefix, and every one of the two remaining
      // door refusals has its own sentence. A case that passed by way of any of them would be
      // passing for the wrong reason and would leave this binding unguarded exactly as before.
      expect(refusal?.reason).not.toContain('refused:')
      expect(refusal?.reason).not.toContain('not a pinned provider')
      expect(refusal?.reason).not.toContain('holds no provider-issued certificate')

      // And the two verdicts really are about the same document. Without this the arms could
      // diverge because the fixture minted twice.
      expect(asked.get(borrower.peerId)).toEqual([borrower.nodeKey])
      expect(asked.get(rightful.peerId)).toEqual([rightful.nodeKey])
      // The gate asked the borrower about the borrower's own key — so `expected` came from the
      // peer id being gated, which is the fact the whole refusal rests on.
      expect(asked.get(borrower.peerId)).not.toContain(rightful.nodeKey)

      // One certificate, one identity. Stated as the arithmetic the criterion is about rather
      // than left implied by two booleans.
      expect(decisions.filter((d) => d.admitted).map((d) => d.peerId)).toEqual([rightful.peerId])
    } finally {
      for (const endpoint of endpoints) endpoint.close()
    }
  })
})

/**
 * AUTH-02 — **the binary every cross-process proof spawns can now state a closed posture.**
 *
 * ## The gap this closes, stated so it is not re-argued
 *
 * `bin/agent.ts` wrote `relayAdmission: 'admits-any-peer'` as a *literal*, and an agent given
 * `--port` is relay-capable — `canRelay` is derived from the listen list. So the production
 * binary behind every spawned fixture in this repository could hold a door and could not be
 * told to close one, and a cross-process claim about admission had no fixture on the agent
 * side at all.
 *
 * ## Two readings, because one of them is the binary quoting itself back
 *
 * The handshake field alone proves only that argv reached stdout. The behavioural half — a
 * peer holding no certificate does not appear in that agent's reservations — is what proves it
 * reached the *gate*. Both, or neither means anything.
 *
 * Node-only by necessity: the subject is an operating-system process.
 */
describe('AUTH-02 — a spawned agent is a fixture rather than a constant', () => {
  const AGENT = fileURLToPath(new URL('./bin/agent.ts', import.meta.url))
  const children: ChildProcess[] = []
  const dirs: string[] = []
  const nodes: FabricNode[] = []

  const madeDir = async (name: string): Promise<string> => {
    const dir = await mkdtemp(join(tmpdir(), `o2-admit-flag-${name}-`))
    dirs.push(dir)
    return dir
  }

  const cleanUp = async (): Promise<void> => {
    for (const child of children.splice(0)) {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    }
    await Promise.all(nodes.splice(0).map((n) => n.stop().catch(() => {})))
    await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })))
  }

  /**
   * Every key this block reads off the line. The line carries more; a reader takes what it
   * names, which is the module comment's own rule for that line and the reason adding a field
   * to it is additive.
   *
   * **The posture is read through an index rather than declared as a property**, and that is
   * this file's standing rule rather than a quirk: a declaration would spell
   * `readonly ${FIELD}:` in this file's own source, and this file is inside its own
   * jurisdiction — the census would then count itself as declaring the option. Measured, not
   * anticipated: writing it out reddened `names none of its own matchers in its own source`
   * with `expected '…' not to contain 'readonly relayAdmission:'`.
   */
  interface Handshake extends Record<string, unknown> {
    readonly peerId: string
    readonly multiaddrs: readonly string[]
    readonly pid: number
    /** Read to establish the addition is additive rather than a replacement. */
    readonly trustAnchors: readonly string[]
  }

  /** The posture off a handshake line, reached without naming the field in a declaration. */
  const postureOf = (handshake: Handshake | null): unknown => handshake?.[FIELD]

  /** Spawn one agent and resolve its announcement line, or its refusal. */
  async function spawnAgent(
    args: readonly string[],
  ): Promise<{ handshake: Handshake | null; stderr: string; code: number | null }> {
    const child = spawn(process.execPath, [AGENT, ...args], { stdio: ['pipe', 'pipe', 'pipe'] })
    children.push(child)
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`the agent neither announced nor exited: ${stderr}`)), 60_000)
      let stdout = ''
      let stderr = ''
      child.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString()
      })
      child.stdout?.on('data', (chunk: Buffer) => {
        stdout += chunk.toString()
        const newline = stdout.indexOf('\n')
        if (newline === -1) return
        clearTimeout(timer)
        try {
          resolve({ handshake: JSON.parse(stdout.slice(0, newline)) as Handshake, stderr, code: null })
        } catch (cause) {
          reject(cause instanceof Error ? cause : new Error(String(cause)))
        }
      })
      // A refusal is a legitimate outcome here, not a failure — one case below is about
      // exactly that — so an exit before any line resolves rather than rejecting.
      child.on('exit', (exitCode: number | null) => {
        clearTimeout(timer)
        resolve({ handshake: null, stderr, code: exitCode })
      })
    })
  }

  it('publishes the posture on the handshake line, and a peer with no certificate does not get in', async () => {
    try {
      // Any well-formed key nobody holds. The joiner below carries no certificate at all, so
      // what is being read is that *pinning somebody* closes the door — the peer could not
      // satisfy this key even if it wanted to.
      const pinned = 'd'.repeat(64)
      const closed = await spawnAgent(['--dir', await madeDir('closed'), '--port', '0', '--admit-issuer', pinned])
      expect(closed.handshake, `the closed agent did not announce: ${closed.stderr}`).not.toBeNull()
      // Reading 1 — the binary states its posture. Necessary, and on its own worth little.
      expect(postureOf(closed.handshake)).toEqual([pinned])
      // Additive: an existing reader of this line still finds what it names.
      expect(closed.handshake?.peerId).toBeTypeOf('string')
      expect(Array.isArray(closed.handshake?.trustAnchors)).toBe(true)

      // Reading 2 — the posture reached the gate. A real peer, holding no certificate, asks
      // that agent for a reservation and does not get one.
      const door = closed.handshake?.multiaddrs.find((ma) => ma.includes('/tcp/') && !ma.includes('/p2p-circuit'))
      expect(door, 'the spawned agent published no dialable address').toBeDefined()
      const joiner = await FabricNode.start({
        relayAdmission: 'admits-any-peer',
        startReporting: 'reports-its-own-start',
        listen: [],
        relayAddrs: [door as string],
        rpcTimeoutMs: 20_000,
        trustAnchors: 'runs-unsigned-artifacts',
        blockstoreDir: await madeDir('joiner'),
      })
      nodes.push(joiner)
      // It connected — the plain connection stands, which is what keeps enrolment reachable.
      expect(joiner.transport.peers).toContain(closed.handshake?.peerId)
      // And it never obtained a circuit. Held over a window rather than sampled once.
      const deadline = Date.now() + 8_000
      while (Date.now() < deadline) {
        expect(joiner.circuitAddrs).toEqual([])
        await new Promise((r) => setTimeout(r, 100))
      }
    } finally {
      await cleanUp()
    }
  }, 180_000)

  it('behaves exactly as before when the flag is absent, and refuses a value that is not hex', async () => {
    try {
      // Absence is a stated absence. The posture is the literal, spelled the way every one of
      // the existing argv sites has always got it.
      const open = await spawnAgent(['--dir', await madeDir('open'), '--port', '0'])
      expect(open.handshake, `the open agent did not announce: ${open.stderr}`).not.toBeNull()
      expect(postureOf(open.handshake)).toBe('admits-any-peer')

      // The validator can fail, and it names which flag and which value. `fromHex` zero-fills
      // rather than throwing, so without this an operator's typo becomes a node that refuses
      // every peer a reservation with nothing reporting that the input was never hex.
      const bad = await spawnAgent(['--dir', await madeDir('bad'), '--port', '0', '--admit-issuer', 'nothex'])
      expect(bad.handshake).toBeNull()
      expect(bad.code).toBe(2)
      expect(bad.stderr).toContain('--admit-issuer')
      expect(bad.stderr).toContain('nothex')
      // And it names the *right* flag — an operator who passed both must not be sent to the
      // wrong one, which is why the two validator loops are separate rather than merged.
      //
      // **Asserted on the refusal line, not on all of stderr**, and the narrowing was forced
      // by measurement: `refuse` writes the reason *and then the whole `USAGE` string*, which
      // legitimately names every flag this binary takes. A whole-stderr negative here read as
      // a real finding and was a false one.
      const refusal = bad.stderr.split('\n').find((l) => l.startsWith('agent.ts:')) ?? ''
      expect(refusal).toContain('--admit-issuer')
      expect(refusal).not.toContain('--trusted-issuer')
    } finally {
      await cleanUp()
    }
  }, 120_000)

  /**
   * The three flags are still three, read as source text.
   *
   * `trust-anchors.node.test.ts` already compares the two older flags' default expressions
   * textually and reddened when 24-01 planted a cross-wiring between them. This is the same
   * reading extended to the third: `--admit-issuer` must reach `relayAdmission` and must reach
   * nothing else.
   */
  it('wires the new flag to admission alone, and neither of the other two to it', () => {
    const agent = code('packages/node/src/bin/agent.ts')
    // It reaches the required key, through a ternary rather than a conditional spread.
    expect(agent).toMatch(/relayAdmission:\s*\n?\s*values\['admit-issuer'\] === undefined \? 'admits-any-peer' : new Set\(values\['admit-issuer'\]\)/)
    // And nothing else consumes it except the handshake line, which reports it.
    const consumers = agent.split("values['admit-issuer']").length - 1
    expect(consumers).toBeGreaterThanOrEqual(3)
    // The two older flags still reach their own options and not this one.
    expect(agent).toContain("trustedIssuers: values['trusted-issuer']")
    expect(agent).not.toContain("trustedIssuers: values['admit-issuer']")
    expect(agent).not.toContain("trustAnchors: values['admit-issuer']")
    expect(agent).not.toContain("relayAdmission: values['trusted-issuer']")
  })

  /**
   * No operator-facing line in either binary claims the gate is unarmed.
   *
   * Task 2 armed it, so `bin/seed.ts`'s parenthetical stopped being true the moment that
   * landed. A claim about whether a security mechanism *exists* is the one an operator has
   * least chance of checking, and until this assertion existed it was one edit from being
   * false again with nothing to notice.
   */
  it('has no banner in either binary saying certificate-gated admission is not armed, and the seed’s says which arm it is in', () => {
    for (const file of ['packages/node/src/bin/seed.ts', 'packages/node/src/bin/agent.ts']) {
      // Stripped, so the correction note *recording* the old wording is not read as the
      // wording. This is the same hazard, and the same answer, that this file's own matchers
      // and `trust-anchors.node.test.ts`'s `OPT_OUT` already carry.
      const stripped = stripComments(readFileSync(join(ROOT, file), 'utf8'))
      expect(stripped, `${file} still tells an operator the gate is unarmed`).not.toContain('is not armed')
    }
    // **TWO-ARMED since Plan 24-06, and the second arm is not decoration.** This was a single
    // positive reading the open text, which a line deleted would have failed and a banner
    // grown a second posture would have *passed* — while lying to every operator in the other
    // arm. `bin/seed.ts` can now be told to close, so both arms must exist in its source.
    const seed = code('packages/node/src/bin/seed.ts')
    // The open arm, byte-identical to the text this row has always read, so a guard reading it
    // still finds it and the default's own wording is pinned as unmoved.
    expect(seed).toContain('admits     every peer that completes a handshake')
    // The closed arm, which must name the flag it came from and the keys it pinned — a fixture
    // spawning a closed seed reads this line to assert the arm is really closed.
    expect(seed).toContain('admits     only peers certified by')
    expect(seed).toContain('(from --admit-issuer)')
    // And the deployment requirement rides on the closed arm, where an operator who has just
    // shut a door meets it. T-24-06-05 is accepted-and-documented, and this is the documenting.
    expect(seed).toContain('must serve enrolment itself or name a provider a joining peer can reach without a reservation')
  })

  /**
   * The three flags are still three on the **second** binary, read as source text.
   *
   * This is `wires the new flag to admission alone` above, extended to `bin/seed.ts` by Plan
   * 24-06. `trust-anchors.node.test.ts` already compares that binary's two older flags'
   * default expressions textually and reddened when 24-01 planted a cross-wiring between them;
   * this reads the third. `--admit-issuer` must reach `relayAdmission` and must reach nothing
   * else, and neither of the other two may reach it.
   *
   * The cross-wiring negatives are **regexes rather than substrings**, and that was forced by
   * measurement rather than taste: the ternary is wrapped across two lines by the formatter, so
   * a contiguous `'relayAdmission: values[…]'` needle cannot match it and a cross-wire written
   * the same way would slip past a substring negative in silence.
   */
  it('wires the seed’s new flag to admission alone, and neither of the other two to it', () => {
    const seed = code('packages/node/src/bin/seed.ts')
    // It reaches the required key, through a ternary rather than a conditional spread — the
    // same shape, asserted the same way, as `bin/agent.ts`'s above.
    expect(seed).toMatch(
      /relayAdmission:\s*\n?\s*values\['admit-issuer'\] === undefined \? 'admits-any-peer' : new Set\(values\['admit-issuer'\]\)/,
    )
    // The hex validator, the ternary's two halves and the banner. A count rather than a
    // presence, so deleting the validator loop is visible here as well as at the spawn arm.
    const consumers = seed.split("values['admit-issuer']").length - 1
    expect(consumers).toBeGreaterThanOrEqual(4)
    // The two older flags still reach their own options.
    expect(seed).toContain("trustedIssuers: values['trusted-issuer']")
    expect(seed).toMatch(/trustAnchors\s*=\s*values\['trust-anchor'\]/)
    // And nothing crosses, in either direction, between any two of the three.
    expect(seed).not.toMatch(/trustedIssuers:\s*\n?\s*values\['admit-issuer'\]/)
    expect(seed).not.toMatch(/trustAnchors\s*[:=]\s*\n?\s*values\['admit-issuer'\]/)
    expect(seed).not.toMatch(/relayAdmission:\s*\n?\s*values\['trusted-issuer'\]/)
    expect(seed).not.toMatch(/relayAdmission:\s*\n?\s*values\['trust-anchor'\]/)
  })
})

/**
 * AUTH-02 — **the seed can now be told to close, and this is the block that watches it close.**
 *
 * ## The gap this closes, stated so it is not re-argued
 *
 * `seed-server.ts` wrote `relayAdmission: 'admits-any-peer'` as a *literal* and
 * `SeedServerOptions` carried no field that could change it, so the relay every browser tab in
 * this fabric reserves on — and the source of `BootstrapInfo.peerAddrs` — was *"not merely
 * left open, it cannot be told to close"*. That is the structural fact `24-VERIFICATION.md`
 * scored criterion 8 PARTIAL on, in the verifier's own words: *"'Pass-with-a-stated-bound'
 * would be the right disposition if the bound were a deployment posture an operator can
 * remove. It is not: for the seed there is no knob."* Plan 24-06 built the knob; this block is
 * the reading that it turns.
 *
 * ## Two arms, open first, and the ordering is the reading rather than a convenience
 *
 * The closed arm's claim is an **absence** — no circuit — and an absence read on its own is
 * also what a fixture that never got there looks like. So the open arm runs first and
 * establishes that *this* uncertificated node can obtain a circuit from a `bin/seed.ts` on
 * *this* host in *this* run. Only against that is the closed arm's absence attributable to the
 * flag.
 *
 * ## The posture is read off the seed's own banner, never off the argv this file passed
 *
 * A typo in a spawn argument otherwise produces an open seed and the reading passes for the
 * wrong reason — the single most likely way a cross-process admission proof lies, and this
 * repository has already carried two criteria at PARTIAL for exactly that shape. Plan 24-05
 * watched that mitigation fire as a plant: its posture guard reddened *before* the assertion
 * the plan had predicted would.
 *
 * ## What this block does NOT show
 *
 * It closes **one** seed. It says nothing about a fabric in which every door is closed, which
 * is 24-07's and 24-08's reading, and nothing about the browser tier. And it is not a claim
 * that a closed seed is a good deployment: 24-05 measured that enrolment survives a closed
 * *provider*, but a closed seed with no reachable provider at all strands every new tab, which
 * is why that sentence is printed in the closed arm's own banner.
 *
 * Node-only by necessity: the subject is an operating-system process.
 */
describe('AUTH-02 — a spawned seed is a fixture rather than a constant', () => {
  const SEED = fileURLToPath(new URL('./bin/seed.ts', import.meta.url))
  /** Any well-formed key nobody holds — the joiners below carry no certificate at all. */
  const PINNED = 'f'.repeat(64)
  /** The seed prints this last, so waiting on it gets the whole banner rather than a prefix. */
  const SENTINEL = 'Ctrl-C to stop.'

  const children: ChildProcess[] = []
  const dirs: string[] = []
  const nodes: FabricNode[] = []

  const madeDir = async (name: string): Promise<string> => {
    const dir = await mkdtemp(join(tmpdir(), `o2-seed-admit-${name}-`))
    dirs.push(dir)
    return dir
  }

  /**
   * SIGTERM with a SIGKILL fallback, rather than `reservation-exhaustion.node.test.ts`'s
   * straight kill: a seed holds a Vite dev server and two bound listeners, and SIGKILL runs no
   * handler. The fallback is what stops a wedged child turning into a hung hook.
   */
  const cleanUp = async (): Promise<void> => {
    await Promise.all(
      children.splice(0).map(
        (child) =>
          new Promise<void>((resolve) => {
            if (child.exitCode !== null || child.signalCode !== null) return resolve()
            const timer = setTimeout(() => {
              child.kill('SIGKILL')
              resolve()
            }, 10_000)
            child.on('exit', () => {
              clearTimeout(timer)
              resolve()
            })
            child.kill('SIGTERM')
          }),
      ),
    )
    await Promise.all(nodes.splice(0).map((n) => n.stop().catch(() => {})))
    await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })))
  }

  /**
   * Spawn one seed and resolve its complete banner, or its refusal.
   *
   * `stdio: ['pipe', 'pipe', 'pipe']` throughout, and fd 0 is load-bearing rather than
   * cosmetic: both binaries arm an orphan leash by watching fd 0, and `'ignore'` hands them a
   * character device, which opts the leash out. `orphan-leash.node.test.ts` fails any spawn
   * site that does.
   */
  async function spawnSeed(
    args: readonly string[],
  ): Promise<{ banner: string; stderr: string; code: number | null }> {
    const child = spawn(process.execPath, [SEED, ...args], { stdio: ['pipe', 'pipe', 'pipe'] })
    children.push(child)
    return new Promise((resolve, reject) => {
      let stdout = ''
      let stderr = ''
      const timer = setTimeout(
        () => reject(new Error(`the seed neither announced nor exited: ${stderr}`)),
        90_000,
      )
      child.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString()
      })
      child.stdout?.on('data', (chunk: Buffer) => {
        stdout += chunk.toString()
        if (!stdout.includes(SENTINEL)) return
        clearTimeout(timer)
        resolve({ banner: stdout, stderr, code: null })
      })
      // A refusal is a legitimate outcome here — one case below is about exactly that — so an
      // exit before the sentinel resolves rather than rejecting.
      child.on('exit', (exitCode: number | null) => {
        clearTimeout(timer)
        resolve({ banner: stdout, stderr, code: exitCode })
      })
    })
  }

  /**
   * Poll until `predicate` holds, naming what was observed at the throw.
   *
   * Its own copy rather than the one in the block above, which is scoped to that `describe`.
   * **`observed` is awaited**, on 24-05's recorded finding: a promise stringifies to `{}`, so
   * an un-awaited thunk turns the one message a timeout has into a vacuous one — the exact
   * failure the thunk exists to prevent, and it was found by a plant rather than by reading.
   */
  async function until(
    predicate: () => boolean,
    timeoutMs: number,
    what: string,
    observed?: () => unknown | Promise<unknown>,
  ): Promise<void> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      if (predicate()) return
      await new Promise((r) => setTimeout(r, 50))
    }
    const tail = observed === undefined ? '' : `; observed ${JSON.stringify(await observed())}`
    throw new Error(`timed out waiting for ${what}${tail}`)
  }

  /** The banner line whose label is the seed's admission posture, trimmed. */
  const admitsLine = (banner: string): string =>
    (banner.split('\n').find((l) => l.trim().startsWith('admits ')) ?? '<no admits line>').trim()

  /** The peer id the seed reports for itself. */
  const peerIdOf = (banner: string): string =>
    (banner.split('\n').find((l) => l.trim().startsWith('peer id ')) ?? '')
      .trim()
      .slice('peer id '.length)
      .trim()

  /**
   * The **loopback** relay address, off the banner rather than rebuilt here.
   *
   * The seed binds `0.0.0.0` and libp2p expands that per interface, so the listing also
   * carries LAN addresses a CI host may not be able to dial back to itself. This is the same
   * narrowing `reservation-exhaustion.node.test.ts` takes, for the same measured reason.
   */
  const loopbackRelay = (banner: string): string | undefined =>
    banner
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.startsWith('relay '))
      .map((l) => l.slice('relay '.length).trim())
      .find((addr) => addr.includes('/ip4/127.0.0.1/'))

  /** An uncertificated node pointed at one relay address, holding no certificate at all. */
  async function joinerAt(name: string, door: string): Promise<FabricNode> {
    const node = await FabricNode.start({
      relayAdmission: 'admits-any-peer',
      startReporting: 'reports-its-own-start',
      listen: [],
      relayAddrs: [door],
      rpcTimeoutMs: 20_000,
      trustAnchors: 'runs-unsigned-artifacts',
      blockstoreDir: await madeDir(name),
    })
    nodes.push(node)
    return node
  }

  it('grants a circuit when told nothing, and none when told an issuer nobody holds — both arms read off the seed’s own banner', async () => {
    try {
      // ---- the OPEN arm, first. ------------------------------------------------------
      // This is the arm that must not have moved: no `--admit-issuer`, so the binary's
      // ternary takes its absent arm and the seed is byte-identical to the seed before the
      // flag existed. It also establishes that this fixture's uncertificated node can obtain
      // a circuit from a `bin/seed.ts` on this host at all, without which the closed arm's
      // absence below would be unattributable.
      const open = await spawnSeed(['--dir', await madeDir('open'), '--port', '0', '--ws-port', '0'])
      expect(open.code, `the open seed exited: ${open.stderr}`).toBeNull()
      // **The posture, off the seed's own line and never off the argv above.**
      expect(admitsLine(open.banner)).toContain('every peer that completes a handshake')
      expect(admitsLine(open.banner)).not.toContain('only peers certified by')

      const openDoor = loopbackRelay(open.banner)
      expect(openDoor, `no loopback relay address in the open seed's banner:\n${open.banner}`).toBeDefined()
      const openJoiner = await joinerAt('open-joiner', openDoor as string)
      await until(
        () => openJoiner.circuitAddrs.length > 0,
        60_000,
        'the open seed to grant a circuit to an uncertificated peer',
        () => ({ circuits: openJoiner.circuitAddrs, peers: openJoiner.transport.peers }),
      )
      expect(openJoiner.circuitAddrs[0]).toContain('/p2p-circuit')

      // ---- the CLOSED arm. ------------------------------------------------------------
      const closed = await spawnSeed([
        '--dir',
        await madeDir('closed'),
        '--port',
        '0',
        '--ws-port',
        '0',
        '--admit-issuer',
        PINNED,
      ])
      expect(closed.code, `the closed seed exited: ${closed.stderr}`).toBeNull()
      // The posture again off the banner — and this arm asserts it pinned **what it was
      // told**, not merely that it pinned something, which is what a typo in the argv above
      // would otherwise buy.
      expect(admitsLine(closed.banner)).toContain('only peers certified by')
      expect(admitsLine(closed.banner)).toContain(PINNED)
      expect(admitsLine(closed.banner)).toContain('1 pinned admission issuer')
      expect(admitsLine(closed.banner)).not.toContain('every peer that completes a handshake')

      const closedDoor = loopbackRelay(closed.banner)
      expect(closedDoor, `no loopback relay address in the closed seed's banner:\n${closed.banner}`).toBeDefined()
      const closedJoiner = await joinerAt('closed-joiner', closedDoor as string)

      // The plain connection stands. That is what keeps enrolment reachable through a closed
      // door, and it is asserted before the absence so that "no circuit" cannot be satisfied
      // by a peer that never reached the seed at all.
      const closedSeedPeerId = peerIdOf(closed.banner)
      expect(closedSeedPeerId).not.toBe('')
      await until(
        () => closedJoiner.transport.peers.includes(closedSeedPeerId),
        60_000,
        'the uncertificated peer to connect to the closed seed',
        () => ({ peers: closedJoiner.transport.peers, want: closedSeedPeerId }),
      )

      // And it never obtains a circuit. **Held over a window rather than sampled once**: an
      // absence read once is also what a fabric that has not got there yet looks like, and the
      // open arm above has already shown how long "got there" takes on this host.
      const deadline = Date.now() + 8_000
      while (Date.now() < deadline) {
        expect(closedJoiner.circuitAddrs).toEqual([])
        await new Promise((r) => setTimeout(r, 100))
      }
      // The comparative statement in one line: the same fixture, the same host, the same run —
      // one seed granted a circuit and the other did not, and the only difference between them
      // is the flag.
      expect(openJoiner.circuitAddrs.length > 0).not.toBe(closedJoiner.circuitAddrs.length > 0)
    } finally {
      await cleanUp()
    }
  }, 240_000)

  it('refuses a value that is not hex, naming the flag it came from and not its sibling', async () => {
    try {
      const bad = await spawnSeed([
        '--dir',
        await madeDir('bad'),
        '--port',
        '0',
        '--ws-port',
        '0',
        '--admit-issuer',
        'nothex',
      ])
      expect(bad.code).toBe(2)
      expect(bad.banner).not.toContain(SENTINEL)
      expect(bad.stderr).toContain('--admit-issuer')
      expect(bad.stderr).toContain('nothex')
      // It names the **right** flag. `bin/seed.ts`'s two validator loops are separate rather
      // than merged for exactly this: an operator who passed both must not be sent to the
      // wrong one. Asserted on the refusal line, mirroring the narrowing the agent arm above
      // records having been forced into by `refuse` also printing a usage string.
      const refusal = bad.stderr.split('\n').find((l) => l.startsWith('seed.ts:')) ?? ''
      expect(refusal).toContain('--admit-issuer')
      expect(refusal).toContain('nothex')
      expect(refusal).not.toContain('--trusted-issuer')
    } finally {
      await cleanUp()
    }
  }, 120_000)
})
