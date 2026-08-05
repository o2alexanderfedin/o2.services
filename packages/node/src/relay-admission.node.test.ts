import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { FabricNode } from './fabric-node.ts'
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
 * **`bin/bench.ts` is deliberately absent, and the absence is a scope statement rather
 * than an oversight.** Its three rigs are measurement fixtures whose posture Plan 24-02
 * decides and pins, alongside `perf-workload.ts` — folding that decision in here would
 * pre-empt it, and the file is concurrently being edited by Phase 20. Its sites still
 * state a posture; `tsc` is what guarantees that, not a row here.
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

describe('nothing reads the posture yet — this wave arms nothing', () => {
  // The title is assembled for {@link GATER}'s reason: a test *name* is code, not a
  // comment, so `stripComments` leaves it in and a matcher spelled out here would count
  // this file as a site. That is how this block first went red.
  it(`constructs no ${GATER} on any relay-capable node`, () => {
    // The mechanism that will read it is `ConnectionGater.denyInboundRelayReservation`, and
    // no gater exists in this repository to hold one. The single exception is stated rather
    // than excluded by a pattern, because it is the opposite of a gate: `browser-node.ts`
    // passes `denyDialMultiaddr: async () => false`, which *opens* dialling.
    const withGater = [...REPO.stripped]
      .filter(([, source]) => source.includes(GATER))
      .map(([file]) => file)
    expect(withGater).toEqual(['packages/browser/src/browser-node.ts'])
    expect(code('packages/browser/src/browser-node.ts')).toContain('denyDialMultiaddr')
    expect(code('packages/browser/src/browser-node.ts')).not.toContain(`deny${'Inbound'}RelayReservation`)
  })

  it('leaves circuitRelayServer taking capacity limits and nothing else', () => {
    // A plan whose claim is "nothing moved" must not have moved this. The four reservation
    // numbers are what that call took before this wave and are what it takes now.
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

  it('has no production caller for the predicate that reads the union', () => {
    // `admitsAnyPeer` exists so that 24-03 adds a *caller* rather than a *semantics* — one
    // place that decides what the union means instead of one per reader. Until then it has
    // none, and saying so is what makes its arrival visible.
    const callers = [...REPO.stripped]
      .filter(([file, source]) => !file.endsWith('.test.ts') && source.includes('admitsAnyPeer('))
      .map(([file]) => file)
    expect(callers).toEqual(['packages/libp2p/src/relay-admission.ts'])
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
