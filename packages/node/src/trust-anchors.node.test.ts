import { execFileSync, spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { KERNEL_TRUST_ANCHOR } from '@o2/demo'
import { describe, expect, it } from 'vitest'

/**
 * The one string that turns DET-03 off, kept where it can only turn it off on purpose.
 *
 * The point is not tidiness. `FabricNodeOptions.trustAnchors`'s opt-out literal is the
 * single value in this repository that makes a node resolve bare CIDs again, and the
 * failure mode of it drifting into a production path is **invisible**: nothing breaks,
 * no test fails, no log line appears, and the fabric quietly executes whatever it is
 * handed while every plan and summary under `.planning/` says it does not. That is
 * precisely the class of defect the v1.0 audit found over and over — built, not wired —
 * so the wiring gets a test rather than a note.
 *
 * Structured as `vocabulary.node.test.ts` is structured, and it should read as that
 * file's sibling rather than as a reinvention: `git ls-files -z` for the population, a
 * pure classifier separated from the walk so mutation cases can drive it directly with
 * synthetic content, exemptions as data each carrying its reason, a block proving the
 * scan read the repository, and a block proving the scan can fail.
 *
 * ## Three more claims, in the same shape, and why they are here
 *
 * Beyond the literal this file also holds the production call site, the agreement of
 * the two binaries' defaults, and the census of files that turn a CID into module
 * bytes. Each converts something this phase could otherwise only *report* into
 * something a later run re-derives. 14-01's premise was originally "one resolution
 * point"; that was false, and a phase whose structural guarantee rests on an
 * enumeration should have a test that fails when the enumeration goes stale rather than
 * a sentence claiming it will not.
 *
 * ## What this is not
 *
 * A narrow, hand-written instance of what ROADMAP Phase 22 generalises — a guard that
 * fails when an exported capability has no path from a runnable entry point. It does
 * not pre-empt that phase and must not grow toward it: this file watches one literal,
 * one option, one call site and one census, which is the part Phase 14 can prove and is
 * responsible for.
 */

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))

/**
 * The opt-out literal, assembled from two fragments.
 *
 * Deliberate, and it must stay this way: written whole, this file's own source would
 * contain the string it scans for, and the scan would report itself. Do not helpfully
 * join it back up. The census matchers below are regex literals for the identical
 * reason — see {@link RESOLVES_MODULE_CID}.
 */
const OPT_OUT = 'runs-unsigned' + '-artifacts'

/**
 * Strips `//` line comments and block comments. Copied verbatim from
 * `bench-egress.node.test.ts`, along with its caveat: this is regex-based, so a comment
 * opener inside a string literal would be treated as opening a comment.
 *
 * **Stripping is required.** `bin/agent.ts` has to be able to state in prose that it
 * carries no switch for the opt-out, and `fabric-node.ts`'s option doc has to explain
 * what the value does. A raw-text scan would make those sentences indistinguishable
 * from uses, and a rule that fires on its own documentation is a rule that gets deleted
 * the first time it fires wrongly. This is also why `.planning/` is out of jurisdiction
 * below: every plan and summary in this phase names the literal repeatedly, and none of
 * them was ever passed to a constructor.
 *
 * **Stripping is also dangerous.** A stripper that ate too much would report a clean
 * repository for entirely the wrong reason, and the empty result this file's main
 * assertion produces would be a silence rather than a reading. That is why the mutation
 * block below plants the same text twice — once commented, once not — and requires the
 * second to be flagged. Without that pair, an over-eager stripper and a clean tree are
 * the same observation.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, '')
}

/**
 * Extensions a value can actually be passed from.
 *
 * The narrowing, and the difference from `vocabulary.node.test.ts`, which correctly
 * scans every tracked file and strips nothing: that rule is about **what a human
 * reviewer reads**, and this one is about **what a program executes**. Only a module
 * that is loaded can pass a value to a constructor. Without the narrowing there is no
 * state of this repository in which an empty result would mean the tree is clean rather
 * than that the scan looked at the wrong population.
 */
const SOURCE_EXTENSIONS: readonly string[] = ['.ts', '.mts', '.js', '.mjs']

/** Trees a value could be passed from. `.planning/` describes; it does not execute. */
const SOURCE_ROOTS: readonly string[] = ['packages/', 'tools/']

function inJurisdiction(file: string): boolean {
  return (
    SOURCE_ROOTS.some((root) => file.startsWith(root)) &&
    SOURCE_EXTENSIONS.some((ext) => file.endsWith(ext))
  )
}

interface PathExemption {
  readonly path: string
  readonly reason: string
}

/**
 * Files that may name the opt-out outside a `*.test.ts`.
 *
 * **Exactly one**, and that membership follows from the stale-entry assertion below
 * rather than from taste: every entry must match at least one occurrence, so an entry
 * for a file that does not name the literal fails this file's own suite.
 *
 * *One, where the plan predicted two, and the assertion below is what found it.* 14-03
 * expected `packages/node/src/seed-server.ts` here too, on the stated grounds that an
 * option type "cannot be written without naming" the literal. That turns out to be
 * false, and finding it out is exactly what this array is for: `SeedServerOptions`
 * declares its field as `FabricNodeOptions['trustAnchors']`, an indexed access that
 * names the *option* rather than restating the union — so its stripped source contains
 * zero occurrences, and an entry for it was stale on the first run. The indexed access
 * is also the better code, because it cannot drift from `FabricNodeOptions`. Left as it
 * is; the exemption is what went, not the type.
 *
 * *Not this test file*, even though `vocabulary.node.test.ts` exempts itself. That file
 * names what it bans in plain text and has to. This one deliberately does not —
 * {@link OPT_OUT} is assembled from two fragments — so its own source contains **zero**
 * occurrences, and a self-exemption would be stale the moment it was written. Being a
 * `*.test.ts` already permits it under the first rule anyway. This is the one place the
 * two files differ structurally, and the reason is a property of this file's source
 * rather than a preference.
 *
 * *And `packages/browser/src/browser-node.ts`, added by Plan 14-04 Task 1.* It did not
 * name the literal until then, which is why 14-03 deliberately left it out — an entry a
 * wave early would have matched nothing and failed the stale-entry assertion. 14-03
 * anticipated that no entry might be needed at all, if `BrowserNodeOptions` referenced
 * `FabricNodeOptions['trustAnchors']` the way `seed-server.ts` does. It does not, and
 * the reason is stated rather than assumed: `BrowserNodeOptions` is declared in
 * `packages/browser`, which does not depend on `packages/node` and must not — an indexed
 * access there would make the browser tier's option type require the Node tier's, in a
 * package the purity rules keep free of `node:` and of the backbone. So the union is
 * written out longhand in both places, and both places are exempt.
 */
const EXEMPT_PATHS: readonly PathExemption[] = [
  {
    path: 'packages/node/src/fabric-node.ts',
    reason:
      'declares FabricNodeOptions.trustAnchors, the union this literal belongs to — this is the one file that cannot express the option without writing the value out, and it is also the file that decides, from that value, whether to compose the guard',
  },
  {
    path: 'packages/browser/src/browser-node.ts',
    reason:
      'declares BrowserNodeOptions.trustAnchors, the same union again — and it must restate it rather than index into FabricNodeOptions, because packages/browser does not depend on packages/node and an indexed access would create that dependency; like fabric-node.ts it is also the file that decides, from that value, whether to compose the guard',
  },
]

interface Flag {
  readonly file: string
  readonly line: number
  readonly text: string
}

/**
 * Occurrences of the opt-out in `content` that the rules do not permit.
 *
 * A plain function over a string, so the planted cases below can drive it with
 * synthetic content and never write into the working tree.
 */
function flags(file: string, content: string): readonly Flag[] {
  if (file.endsWith('.test.ts')) return []
  if (EXEMPT_PATHS.some((entry) => entry.path === file)) return []
  const found: Flag[] = []
  for (const [index, text] of stripComments(content).split('\n').entries()) {
    if (text.includes(OPT_OUT)) found.push({ file, line: index + 1, text: text.trim() })
  }
  return found
}

/** Every occurrence, permitted or not — what the "found something at all" reading uses. */
function occurrences(content: string): number {
  return stripComments(content).split(OPT_OUT).length - 1
}

/**
 * How a read failure reads in a report — the errno when there is one, the message
 * otherwise. `unknown` because a `catch` binding is `unknown` and pretending it is an
 * `Error` is how a report ends up saying `undefined`.
 */
function readFailure(cause: unknown): string {
  if (cause instanceof Error) {
    const code = (cause as NodeJS.ErrnoException).code
    return code ?? cause.message
  }
  return String(cause)
}

interface Scan {
  readonly flagged: readonly Flag[]
  readonly scanned: readonly string[]
  /** Files inside the jurisdiction whose stripped source names the literal at all. */
  readonly naming: readonly string[]
  readonly sources: ReadonlyMap<string, string>
  /**
   * Files git tracks, inside the jurisdiction, that could not be read.
   *
   * This used to be a bare `continue` with a comment guessing at the cause. The guess
   * was reasonable and the behaviour was not: a file that is not scanned cannot be
   * flagged, so an unreadable production path is indistinguishable from a clean one,
   * and the jurisdiction silently shrinks by exactly the file nobody could look at.
   * That is not hypothetical here — this repository is worked on by concurrent agents
   * sharing a checkout, and a file removed mid-scan lands precisely on this line.
   *
   * The floor assertions below catch a wholesale failure. They cannot catch one file
   * going missing, which is the case that matters, because one file is all it takes.
   */
  readonly unreadable: readonly string[]
}

function scanRepository(): Scan {
  const flagged: Flag[] = []
  const scanned: string[] = []
  const naming: string[] = []
  const sources = new Map<string, string>()
  const unreadable: string[] = []

  const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' })
    .split('\0')
    .filter((path) => path.length > 0)

  for (const file of tracked) {
    if (!inJurisdiction(file)) continue
    let content: string
    try {
      content = readFileSync(join(ROOT, file), 'utf8')
    } catch (cause) {
      // Recorded and reported by name, never skipped. See `Scan.unreadable`.
      unreadable.push(`${file} — ${readFailure(cause)}`)
      continue
    }
    scanned.push(file)
    sources.set(file, content)
    if (occurrences(content) > 0) naming.push(file)
    flagged.push(...flags(file, content))
  }

  return { flagged, scanned, naming, sources, unreadable }
}

const REPO: Scan = scanRepository()

function stripped(file: string): string {
  const source = REPO.sources.get(file)
  if (source === undefined) throw new Error(`${file} is not in the scanned population`)
  return stripComments(source)
}

function render(flag: Flag): string {
  return (
    `${flag.file}:${flag.line} names the provenance opt-out outside a test — "${flag.text.slice(0, 100)}". ` +
    'A production path that wants to run unsigned artifacts is a decision for the owner of the ' +
    'deployment, not a value to pass: supply real anchors, or take the decision at the binary that ' +
    'starts this node.'
  )
}

describe('the scan is looking at the population it claims to look at', () => {
  it('read the tracked source files under packages/ and tools/', () => {
    // Every assertion below is "nothing is out of place", which a wrong root or a failed
    // `git ls-files` would satisfy perfectly while checking nothing.
    expect(REPO.scanned.length).toBeGreaterThan(120)
    expect(REPO.scanned).toContain('packages/node/src/fabric-node.ts')
    expect(REPO.scanned).toContain('packages/browser/src/browser-node.ts')
    // This one matters most: it is the visitor-facing production path, and a
    // jurisdiction that quietly excluded it would be the one way this whole file could
    // pass while meaning nothing.
    expect(REPO.scanned).toContain('packages/browser/demo/main.ts')
  })

  it('found real occurrences, so an empty flag list is a reading rather than a silence', () => {
    // "Nothing is out of place" passes trivially if the scanner finds nothing at all.
    // The positive reading is asserted alongside the negative one.
    expect(REPO.naming.length).toBeGreaterThan(0)
    expect(REPO.naming.some((file) => file.endsWith('.test.ts'))).toBe(true)
  })

  it('dropped no file it could not read', () => {
    // The population this file reports on must be the population git says exists. A
    // file that fails to read is named here rather than quietly leaving the scan,
    // because "no violations among the files I managed to open" is a different claim
    // from "no violations", and only the second one is worth making.
    //
    // Normally empty, so it is an absence assertion like the rest and cannot audit
    // itself. Proved able to fail on 2026-08-01 by `git add`-ing a file under
    // `packages/node/src` and deleting it from disk before the run: `git ls-files`
    // still lists it, `readFileSync` throws `ENOENT`, and this case named the file
    // and the errno. Before the change the same plant was green.
    expect(REPO.unreadable).toEqual([])
  })
})

describe('the provenance opt-out is written down only where it is a decision', () => {
  it('appears in no file outside a test and the declared exemptions', () => {
    expect(REPO.flagged.map(render)).toEqual([])
  })

  it('gives every exemption a stated reason, so none can be added silently', () => {
    for (const entry of EXEMPT_PATHS) expect(entry.reason.length).toBeGreaterThan(20)
  })

  it('carries no exemption that no longer matches anything', () => {
    // A dead exemption is worse than none: it silently permits a file that no longer
    // says what the reason claims. This assertion is also what fixes the array's
    // membership at two — see EXEMPT_PATHS.
    const dead = EXEMPT_PATHS.filter((entry) => {
      const source = REPO.sources.get(entry.path)
      return source === undefined || occurrences(source) === 0
    }).map((entry) => `${entry.path} — no longer names the opt-out; delete this entry (was: ${entry.reason})`)
    expect(dead).toEqual([])
  })

  it('is spreading no further through the test suite than a bound nobody has to maintain', () => {
    // A **bound**, not an exact count, and the reasoning belongs beside the number: an
    // exact count is a test that fails on every unrelated new test file, whereas a
    // generous bound is a test that fails when the opt-out starts spreading. The figure
    // is a configuration choice, not a measurement — it says "well above where we are,
    // well below every test file in the package".
    const optingOut = REPO.naming.filter((file) => file.endsWith('.test.ts'))
    expect(optingOut.length).toBeLessThan(40)
  })
})

describe('the checker can fail — proved by planting, not assumed', () => {
  const PRODUCTION = 'packages/node/src/fabric-node-something.ts'
  const PLANTED = `const options = { trustAnchors: '${OPT_OUT}' }`

  it('flags the literal in a production path', () => {
    expect(flags(PRODUCTION, PLANTED).length).toBeGreaterThan(0)
  })

  it('does not flag it in a test path', () => {
    expect(flags('packages/node/src/anything.test.ts', PLANTED)).toEqual([])
  })

  it('does not flag it inside a line comment or a block comment', () => {
    expect(flags(PRODUCTION, `// ${PLANTED}`)).toEqual([])
    expect(flags(PRODUCTION, `/*\n * ${PLANTED}\n */`)).toEqual([])
  })

  it('flags that identical text once the comment markers come off', () => {
    // The other half of the pair above, and the reason the empty result in the previous
    // describe block means something. A stripper that ate the whole file would make
    // every commented case pass and would look exactly like a clean repository; this is
    // what tells the two apart.
    expect(flags(PRODUCTION, `/*\n * ${PLANTED}\n */`)).toEqual([])
    expect(flags(PRODUCTION, `\n${PLANTED}\n`).length).toBeGreaterThan(0)
  })

  it('leaves a similar-but-different string alone', () => {
    expect(flags(PRODUCTION, "const mode = 'runs-signed-artifacts'")).toEqual([])
    expect(flags(PRODUCTION, "const mode = 'runs-unsigned'")).toEqual([])
  })
})

/**
 * Files whose construction sites compose `guardModuleProvenance`.
 *
 * Two entries. `packages/browser/src/browser-node.ts` was added by Plan 14-04 Task 1,
 * which is why this was written as an array rather than a hard-coded single — a pair
 * would have failed until that plan landed, one wave later.
 *
 * The browser entry is the cheap half of that tier's proof. It fires in seconds and says
 * only that the call site is present; the expensive half — that the guard is on the live
 * path between two real browser contexts — is `two-tabs.e2e.test.ts`'s refusal case,
 * which needs a relay, a Vite server and a browser. A present call site is not a working
 * one, and neither assertion substitutes for the other.
 */
const GUARDED_CONSTRUCTION_SITES: readonly string[] = [
  'packages/node/src/fabric-node.ts',
  'packages/browser/src/browser-node.ts',
]

describe('the production call site is still there', () => {
  for (const file of GUARDED_CONSTRUCTION_SITES) {
    it(`${file} composes guardModuleProvenance`, () => {
      // Plan 14-05 Task 2 plants the deletion of this call and captures the failures,
      // but that capture lives in a summary and no command re-runs it. This line is what
      // stands afterwards.
      //
      // What it does **not** do: a present call site is not a working one. A call left
      // in place but wired to a resolver that accepts everything would pass this and
      // fail `signed-artifact.node.test.ts`, which is why that file exists. This catches
      // the deletion; those catch the deletion that left the call behind.
      expect(stripped(file)).toContain('guardModuleProvenance(')
    })
  }
})

describe('the two binaries have not drifted apart', () => {
  /**
   * The `--trust-anchor` default expression, extracted from a binary's stripped source.
   *
   * Matched rather than compared whole-file, because the surrounding lines legitimately
   * differ — one binary builds a `FabricNode` and the other a `SeedServer`.
   */
  function defaultExpression(file: string): string | null {
    const match = /const\s+trustAnchors\s*=\s*([^\n]+)/.exec(stripped(file))
    return match?.[1]?.trim() ?? null
  }

  it('write the identical default, so two processes started with no flags answer alike', () => {
    // The **measured half** of "any divergence lives in an argv default and there is
    // currently none". The other half — what each binary actually pins at runtime — is
    // read for `bin/agent.ts` in Plan 14-05 out of its handshake line, and for
    // `bin/seed.ts` by the suite below.
    const agent = defaultExpression('packages/node/src/bin/agent.ts')
    const seed = defaultExpression('packages/node/src/bin/seed.ts')

    // Anti-vacuity: two nulls would compare equal and prove nothing.
    expect(agent).not.toBeNull()
    expect(seed).not.toBeNull()
    expect(agent).toContain('KERNEL_TRUST_ANCHOR')

    expect(seed).toBe(agent)
  })
})

/**
 * What `bin/seed.ts` actually pins, read out of a running process rather than its source.
 *
 * ## Why this exists now and did not before
 *
 * Three files carried the same admission — this one, `signed-artifact.node.test.ts`, and
 * `bin/seed.ts` itself — that the seed's no-flag runtime behaviour was unmeasured, each
 * giving the same reason: the binary boots a Vite dev server, and that was said to be *a
 * minute of test time for one line of output*.
 *
 * **That number was wrong by about two orders of magnitude.** Measured while adding the
 * seed's orphan leash: `bin/seed.ts --dir <tmp> --port 0 --ws-port 0` prints its complete
 * banner **590 ms** after spawn. A blocker that costs 600 ms is not a blocker, and three
 * files had been citing it to each other.
 *
 * The textual comparison above is still worth having — it catches the two defaults drifting
 * *before* anyone runs anything — but it can only ever prove the two binaries write the
 * same expression. It cannot prove the expression reaches the node, and DET-03 is a claim
 * about what the process pins, not about what its source says.
 *
 * ## Reading stdout rather than instrumenting
 *
 * The line is the seed's own report of the value it passed to `SeedServer.start`, which is
 * the same thing Plan 14-05 does with the agent's handshake. It is also the only seam
 * available: the anchors go into a constructor argument inside another process.
 */
describe('the seed pins what it says it pins, in a real process', () => {
  const SEED = fileURLToPath(new URL('./bin/seed.ts', import.meta.url))

  /**
   * Spawn the seed, return its banner, and make sure nothing is left behind.
   *
   * `stdio[0]` is a pipe deliberately and `orphan-leash.node.test.ts` enforces it across
   * every spawn site: it arms the seed's leash, so a Vitest worker killed mid-run takes
   * this process with it instead of leaving a 40 MB server holding a port. That is not
   * hypothetical — the sweep that added the leash found a `bin/seed.ts` on this machine
   * five days and twenty-three hours old.
   */
  async function bannerOf(args: readonly string[]): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'o2-seed-anchors-'))
    const child = spawn(process.execPath, [SEED, '--dir', dir, '--port', '0', '--ws-port', '0', ...args], {
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    try {
      return await new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`seed printed no banner in time: ${err}`)), 60_000)
        let out = ''
        let err = ''
        child.stderr.on('data', (chunk: Buffer) => {
          err += chunk.toString()
        })
        child.stdout.on('data', (chunk: Buffer) => {
          out += chunk.toString()
          // The last line it writes, so the whole banner is present rather than a prefix.
          if (!out.includes('Ctrl-C to stop.')) return
          clearTimeout(timer)
          resolve(out)
        })
        child.on('exit', (code) => {
          clearTimeout(timer)
          reject(new Error(`seed exited with ${String(code)} before printing a banner: ${err}`))
        })
      })
    } finally {
      // SIGKILL, not SIGTERM: this file has no stake in a clean unwind and a wedged
      // shutdown here would be an orphan holding a port for the rest of the run.
      child.kill('SIGKILL')
      await rm(dir, { recursive: true, force: true })
    }
  }

  /** The `trusts` line alone, so a failure prints the claim rather than the whole banner. */
  function trustsLine(banner: string): string {
    return (banner.split('\n').find((line) => line.includes('trusts')) ?? '<no trusts line>').trim()
  }

  it('pins exactly the demo anchor when started with no flags', async () => {
    const line = trustsLine(await bannerOf([]))

    expect(line).toContain('1 pinned anchor')
    // Not merely "one anchor": that it is the *demo default* and that the process says so.
    // A seed that had silently fallen back to the opt-out would still print a count.
    expect(line).toContain('the demo default')
    expect(line).not.toContain('from --trust-anchor')
  }, 120_000)

  it('reports the flag when one is given, so the two branches are distinguishable', async () => {
    // The same value the default resolves to. The subject here is *which branch ran*, and
    // passing a different key would additionally test parsing, which belongs elsewhere.
    const line = trustsLine(await bannerOf(['--trust-anchor', KERNEL_TRUST_ANCHOR]))

    expect(line).toContain('1 pinned anchor')
    expect(line).toContain('from --trust-anchor')
    // Anti-vacuity for the case above: the two branches must not print the same sentence,
    // or `toContain('the demo default')` would pass no matter which one ran.
    expect(line).not.toContain('the demo default')
  }, 120_000)
})

interface CensusEntry {
  readonly file: string
  /** The construction site that composes the guard around it, or why there is none. */
  readonly guardedAt: string
  readonly reason: string
}

/**
 * Every file that turns `task.moduleCid` into module bytes.
 *
 * **Written as a regex literal, not a plain string passed to `includes`**, for
 * {@link OPT_OUT}'s reason exactly: a plain string would put the matched text into this
 * file's own source, so this file would satisfy its own census query and report a fourth
 * resolver that does not exist. Escaped regex source does not. The two are one rule, not
 * two coincidences.
 */
const RESOLVES_MODULE_CID = /\.get\(task\.moduleCid\)/

/** Likewise — a plain string here would make this file a construction site. */
const CONSTRUCTS_WASI_EXECUTOR = /new\s+WasiExecutor\(/

/**
 * The census, measured on 2026-07-31 by grepping the jurisdiction and **not** copied
 * from any plan. Two of the three entries differ from what 14-03's plan predicted, which
 * is the entire argument for having this array re-derived on every run:
 *
 * - the resolver is `packages/core/src/executor/worker-executor.ts`, not
 *   `packages/browser/src/worker-executor.ts` — the browser class delegates to the core
 *   one and resolves nothing itself;
 * - `packages/core/src/executor/module-provenance.ts` matches the raw grep and is not a
 *   fourth resolver: the occurrence is inside its module comment, which is why the
 *   census reads stripped source.
 *
 * `packages/browser/src/task-executor.worker.ts` is deliberately absent for a different
 * reason: it `put`s bytes it was handed into a fresh `MemoryBlockstore` and executes the
 * CID that produces, so it resolves nothing from anywhere.
 */
const CENSUS: readonly CensusEntry[] = [
  {
    file: 'packages/core/src/executor/wasm.ts',
    guardedAt: 'packages/node/src/fabric-node.ts, packages/browser/src/browser-node.ts (14-04)',
    reason: 'the original executor; still what the memory-transport benchmark rig and the browser fallback arm construct directly',
  },
  {
    file: 'packages/core/src/executor/worker-executor.ts',
    guardedAt: 'packages/node/src/fabric-node.ts',
    reason: 'resolves on the calling thread before posting raw bytes to the thread it will run them on — this is the executor a FabricNode actually composes',
  },
  {
    file: 'packages/aot/src/wasi-executor.ts',
    guardedAt: 'none — no production caller exists; Phase 21 is scheduled to give it one',
    reason: 'a second Executor implementation with its own resolution, reachable today only from tests and from two build-time tools under tools/aot/',
  },
]

/**
 * Where a `WasiExecutor` may be constructed without a guard.
 *
 * **A correction to the plan, measured rather than reasoned.** 14-03's plan states that
 * `new WasiExecutor(` occurs "only in `packages/aot/src/*.test.ts`". It does not: it also
 * occurs in `tools/aot/bench-lifted.ts` and `tools/aot/measure-wasi.ts`. Both are
 * build-time measurement drivers run by hand against a local file — neither serves a
 * peer, binds a socket, or executes anything a stranger sent — so they are declared here
 * with their reason rather than being allowed to fail an assertion that would then be
 * weakened to accommodate them.
 */
const WASI_TOOL_SITES: readonly PathExemption[] = [
  {
    path: 'tools/aot/bench-lifted.ts',
    reason:
      'a build-time driver that times a locally-lifted artifact the operator passed on the command line; it serves no peer and receives no dispatch, so there is no publisher for a record to name',
  },
  {
    path: 'tools/aot/measure-wasi.ts',
    reason:
      'the same shape — a hand-run measurement over a local file, with no network surface and no dispatcher to attach a record',
  },
]

describe('the files that resolve a module CID are the census, and nothing else', () => {
  it('names exactly three resolvers, each recording what guards it', () => {
    const resolvers = REPO.scanned.filter((file) => RESOLVES_MODULE_CID.test(stripped(file))).sort()

    expect(resolvers).toEqual(CENSUS.map((entry) => entry.file).sort())
  })

  it('gives every census entry a stated reason and a named construction site', () => {
    for (const entry of CENSUS) {
      expect(entry.reason.length).toBeGreaterThan(20)
      expect(entry.guardedAt.length).toBeGreaterThan(3)
      expect(REPO.scanned).toContain(entry.file)
    }
  })

  it('can tell a fourth resolver from the three it knows about', () => {
    // The census is an enumeration, and an enumeration nobody can watch failing is a
    // sentence. Planted through the same matcher the walk uses.
    //
    // **Assembled from fragments, and this one was learned the hard way.** Written
    // whole, the resolution call is a plain string in this file's own source, so this
    // file matches its own census query and reports itself as a fourth resolver. It did
    // exactly that — but only after being committed, because the walk reads
    // `git ls-files` and an untracked file is not in the population. A green run before
    // the commit and a red one after is the whole hazard, and it is the same rule
    // {@link OPT_OUT} and {@link RESOLVES_MODULE_CID} are already written for. Do not
    // helpfully join it back up.
    const fourth = `const bytes = await this.#blockstore.get(task.module${'Cid'})`
    expect(RESOLVES_MODULE_CID.test(stripComments(fourth))).toBe(true)
    expect(RESOLVES_MODULE_CID.test(stripComments(`// ${fourth}`))).toBe(false)
    expect(CENSUS.map((entry) => entry.file)).not.toContain('packages/somewhere/new-executor.ts')
  })

  it('does not name either census matcher in its own source, so it cannot report itself', () => {
    // The regression the case above documents, turned into a standing assertion rather
    // than a comment: this file is inside its own jurisdiction, and a future edit that
    // spells either matched text out whole would make the census read four resolvers or
    // an extra WasiExecutor construction — a failure that looks like a real finding and
    // is not.
    const self = stripped('packages/node/src/trust-anchors.node.test.ts')
    expect(RESOLVES_MODULE_CID.test(self)).toBe(false)
    expect(CONSTRUCTS_WASI_EXECUTOR.test(self)).toBe(false)
    expect(self.includes(OPT_OUT)).toBe(false)
  })

  it('constructs no WasiExecutor outside a test or a declared build-time tool', () => {
    // When Phase 21 gives `WasiExecutor` a production caller, this fails — and that is
    // the point. The fix is to compose `guardModuleProvenance` at that construction site
    // and update the census entry above, not to add a path here: this array is for
    // hand-run tools with no dispatcher, and a serving node is neither.
    const declared = new Set(WASI_TOOL_SITES.map((entry) => entry.path))
    const constructions = REPO.scanned.filter(
      (file) =>
        !file.endsWith('.test.ts') &&
        !declared.has(file) &&
        CONSTRUCTS_WASI_EXECUTOR.test(stripped(file)),
    )

    expect(constructions).toEqual([])
  })

  it('declares each build-time WasiExecutor tool with a reason, and none that has gone stale', () => {
    for (const entry of WASI_TOOL_SITES) {
      expect(entry.reason.length).toBeGreaterThan(20)
      expect(REPO.scanned).toContain(entry.path)
      expect(CONSTRUCTS_WASI_EXECUTOR.test(stripped(entry.path))).toBe(true)
    }
  })
})
