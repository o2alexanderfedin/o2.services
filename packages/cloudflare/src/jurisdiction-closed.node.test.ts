/**
 * Criterion 1's negative proof, taken as an agent — `HOST-06` (`.planning/REQUIREMENTS.md:2193`),
 * `.planning/ROADMAP.md:2424`: *"a plan that passes `sam` as a jurisdiction is watched failing
 * at creation."*
 *
 * ## The instrument the criterion names cannot see the property, and this is measured
 *
 * Measured 2026-09-13 against a throwaway worker on a local `wrangler dev`:
 * `namespace.jurisdiction(v)` throws the same message for every `v` — the permitted values and
 * the hint value alike, byte-identical (see `placement-runtime.e2e.test.ts`, this plan's other
 * half, for that reading as an assertion). A local runtime arm that "watched `sam` fail" would
 * report a property of the runtime, not of the value — a blind instrument.
 *
 * So this file takes the proof at the earliest point creation code can exist and where the
 * refusal IS discriminating: the platform's own closed type. `hosted-object.ts` declares
 * `DurableObjectJurisdiction` at the platform's own width, read out of the installed workerd
 * binary's bundled type text. A scratch module that types the hint value against that alias
 * does not compile; one that types a permitted value does — in the same run, against the same
 * compiler.
 *
 * ## Two `tsc` facts that shape every probe below, measured 2026-09-13 against the installed
 * `typescript@7.0.2` with this repository's own flags
 *
 * 1. **TypeScript prints the alias NAME and never expands it.** An alias-typed variable gives
 *    `Type '"sam"' is not assignable to type 'DurableObjectJurisdiction'.` — the refused value
 *    quoted, the union's members never named. `--noErrorTruncation` does not change this. So
 *    this file asserts the refused value is quoted and asserts NOTHING about the union's
 *    members appearing in that text. The property a diagnostic-text search over the members
 *    was reaching for — *a member added or removed upstream reddens this file* — is bought
 *    instead by one control compile per declared member (removal) plus a type-level
 *    exhaustiveness declaration (addition, see below). That is strictly stronger: it fires on
 *    an ADDITION, which no diagnostic-text search could ever catch.
 * 2. **`isolatedDeclarations` is on**, so an exported binding without an explicit type
 *    annotation fails with `TS9010` — a diagnostic that has nothing to do with the property
 *    under test and would satisfy a naive non-zero-exit assertion for the wrong reason. No
 *    probe below exports anything, and the anti-vacuity floor asserts neither a `TS5xxx`
 *    (scratch-config error) nor a `TS9xxx` diagnostic appears in any control's output.
 *
 * ## Scratch files, never inside the repository
 *
 * Every `tsconfig.json` and `probe.ts` this file writes lives under a fresh `mkdtemp` inside
 * the OS temp directory, removed in `afterAll`. An untracked file inside the tree would make
 * `git status --porcelain` dirty, reddening `discover-arm.node.test.ts` and
 * `bench-attestation.node.test.ts` for whoever else is running them on this shared working
 * tree — the same rule `check-copy.node.test.ts` states and follows.
 *
 * ## The exhaustiveness declaration's form is decided, not left to taste
 *
 * The obvious form — an underscore-prefixed `const` typed as an array of the leftover members,
 * initialized to an empty array literal — was measured 2026-09-13, both arms in one sitting: it
 * exits `0` against the clean four-member union, and it **also exits `0`** with a fifth member
 * added, because an empty array literal is assignable to `T[]` for every `T`, including a `T`
 * that is not `never`. That form cannot see the property it would be named for and is forbidden
 * here — not merely avoided, refused, and a grep in this plan's own acceptance criteria holds
 * the refusal. The form actually used below (`Assert<[Unlisted] extends [never] ? true :
 * false>`) was measured in the same sitting: exit `0` clean, exit `1` — `error TS2344: Type
 * 'false' does not satisfy the constraint 'true'.` — with a fifth member added. A type alias
 * rather than a `const`: it erases completely under `erasableSyntaxOnly` and leaves no unused
 * runtime binding, and `noUnusedLocals` is not set in this repository's `tsconfig.json`, so the
 * otherwise-unused alias is not a diagnostic either way.
 *
 * **This check does not fire under `vitest`.** Vitest strips types and never runs a real
 * compiler over this file, so a fifth member added to `DurableObjectJurisdiction` upstream
 * leaves every case in this file green — every control still exits `0`, `MEMBERS.length` is
 * still `4`, the refusal arm is unaffected. The declaration only fires when this file is
 * itself typechecked for real, which `npx tsc --noEmit -p .` (the whole workspace, per this
 * phase's inherited refusal on the per-package check) does, because this package's sources are
 * in that config's own `include`. A fully green `vitest` run of this file is therefore not
 * evidence the exhaustiveness half is doing anything; the corresponding `tsc` run is.
 *
 * Purpose: `HOST-06`. The live at-creation refusal from Cloudflare's own API is `waits on owner
 * act 2` and is not claimed here — see `placement-runtime.e2e.test.ts` for what a LOCAL runtime
 * can and cannot say about the same question.
 */

import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { HOSTED_JURISDICTION, HOSTED_LOCATION_HINT } from './hosted-object.ts'
import type { DurableObjectJurisdiction } from './hosted-object.ts'

/** The repository's own root config — a scratch config `extends` this by absolute path. */
const ROOT_TSCONFIG = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))

/** `hosted-object.ts`'s own absolute path — every probe imports it by path, `.ts` and all. */
const HOSTED_OBJECT_MODULE = fileURLToPath(new URL('./hosted-object.ts', import.meta.url))

/**
 * **Measured, not in the plan as written, and load-bearing.** A scratch `tsconfig.json` placed
 * under the real OS temp directory (`os.tmpdir()`, e.g. `/var/folders/…/T` on this machine —
 * NOT `/tmp`, which on some hosts happens to sit under a directory that already carries a
 * stray `node_modules`) has no `node_modules/@types` anywhere in its ancestry. The root config
 * this scratch config `extends` sets `"types": ["node"]`, and TypeScript's default `typeRoots`
 * search walks up from the SCRATCH config's own directory — never from the extended config's —
 * so every probe failed `TS2688: Cannot find type definition file for 'node'` before it ever
 * reached the union it was written to check, on every value including the permitted ones. This
 * override points `typeRoots` at the repository's own `node_modules/@types` by absolute path,
 * independent of where the scratch directory happens to land.
 */
const TYPE_ROOTS = [join(fileURLToPath(new URL('../../..', import.meta.url)), 'node_modules/@types')]

/**
 * Every member of the platform's own union, typed directly here because there is no exported
 * array covering all four to read instead — {@link HOSTED_JURISDICTION} carries only the one
 * this fabric places under. `as const satisfies readonly DurableObjectJurisdiction[]` rather
 * than a bare annotation: `satisfies` keeps the array's element types as the four literals
 * rather than widening them to the alias, which is what {@link Unlisted} below needs to be
 * anything other than `never` by construction, and it still fails THIS file's own typecheck if
 * a member here is mistyped or one is dropped without the union changing.
 */
const MEMBERS = ['eu', 'fedramp', 'fedramp-high', 'us'] as const satisfies readonly DurableObjectJurisdiction[]

/**
 * The type-level half of exhaustiveness. `Unlisted` is every member of
 * {@link DurableObjectJurisdiction} not present in {@link MEMBERS} — `never` on the tree as it
 * stands. See this file's header docblock for the form this is written in and the one it is
 * deliberately not.
 */
type Unlisted = Exclude<DurableObjectJurisdiction, (typeof MEMBERS)[number]>
type Assert<T extends true> = T
type _Exhaustive = Assert<[Unlisted] extends [never] ? true : false>

interface ProbeResult {
  /** `null` when the child was killed by a signal — a different thing from any exit code. */
  readonly status: number | null
  readonly output: string
  readonly probePath: string
}

const workdirs: string[] = []
afterAll(() => {
  for (const dir of workdirs) rmSync(dir, { recursive: true, force: true })
})

/**
 * Writes a scratch `tsconfig.json` + `probe.ts` under a fresh `mkdtemp` and compiles it with a
 * real `tsc`, reading `status` off the spawn result directly.
 *
 * Never a shell pipeline for this: a pipeline reports the LAST command's status, and this
 * repository has had a failing run report success that way more than once.
 *
 * The probe declares `value` typed as {@link DurableObjectJurisdiction} and passes it into a
 * local function typed to take one — the two forms measured 2026-09-13 to both quote the
 * refused value (`TS2322` on the declaration, `TS2345` on the argument, whichever the compiler
 * reaches first). `euJurisdictionOf` is imported alongside the type, grounding the probe at the
 * real module this criterion is about rather than a type alias reconstructed by hand.
 */
function compileValueAs(value: string): ProbeResult {
  const dir = mkdtempSync(join(tmpdir(), 'o2-jurisdiction-closed-'))
  workdirs.push(dir)
  const tsconfigPath = join(dir, 'tsconfig.json')
  const probePath = join(dir, 'probe.ts')
  writeFileSync(
    tsconfigPath,
    JSON.stringify(
      {
        extends: ROOT_TSCONFIG,
        compilerOptions: { typeRoots: TYPE_ROOTS },
        include: ['./probe.ts'],
      },
      null,
      2,
    ),
  )
  writeFileSync(
    probePath,
    [
      `import { euJurisdictionOf, type DurableObjectJurisdiction } from ${JSON.stringify(HOSTED_OBJECT_MODULE)}`,
      '',
      `const value: DurableObjectJurisdiction = ${JSON.stringify(value)}`,
      '',
      'function narrow(jurisdiction: DurableObjectJurisdiction): DurableObjectJurisdiction {',
      '  return jurisdiction',
      '}',
      '',
      'narrow(value)',
      'void euJurisdictionOf',
      '',
    ].join('\n'),
  )
  const result = spawnSync('npx', ['tsc', '--noEmit', '--project', tsconfigPath], { encoding: 'utf8' })
  return {
    status: result.status,
    output: `${result.stdout ?? ''}${result.stderr ?? ''}`,
    probePath,
  }
}

interface MemberProbe {
  readonly member: DurableObjectJurisdiction
  readonly result: ProbeResult
}

let refusalResult: ProbeResult | null = null
let memberProbes: readonly MemberProbe[] = []

beforeAll(() => {
  // All five `tsc` invocations happen once, here, rather than once per `it` — five real
  // compiler spawns cost real wall clock, and every case below reads from these results
  // instead of re-spawning its own.
  refusalResult = compileValueAs(HOSTED_LOCATION_HINT.sam)
  memberProbes = MEMBERS.map((member) => ({ member, result: compileValueAs(member) }))
}, 60_000)

/** Narrows `refusalResult` without a non-null assertion. */
function refusal(): ProbeResult {
  if (refusalResult === null) throw new Error('beforeAll did not populate refusalResult')
  return refusalResult
}

/** Narrows a lookup into `memberProbes` without a non-null assertion or a cast. */
function controlFor(member: DurableObjectJurisdiction): ProbeResult {
  const found = memberProbes.find((probe) => probe.member === member)
  if (found === undefined) throw new Error(`no control probe was compiled for "${member}"`)
  return found.result
}

describe("criterion 1's negative proof — the hint value refused where a jurisdiction is required, taken by the compiler", () => {
  it("refuses the hint value with the refused value quoted in the compiler's own diagnostic", () => {
    const { status, output } = refusal()
    expect(status).not.toBe(0)
    // Built by substitution from the imported module's own value — never typed as a literal
    // here. Asserts the refused value is quoted; asserts nothing about the union's members
    // appearing, which is measured NOT to happen — see this file's header docblock.
    expect(output).toContain(`'"${HOSTED_LOCATION_HINT.sam}"'`)
  })

  it.each(MEMBERS)('compiles the permitted jurisdiction %s at tsc exit 0, in the same run as the refusal', (member) => {
    const { status } = controlFor(member)
    expect(status).toBe(0)
  })

  it("holds exactly the platform's four declared jurisdictions", () => {
    expect(MEMBERS.length).toBe(4)
  })

  it('discriminates: the refused value and the eu control produce different tsc exit statuses', () => {
    // The whole reading of this file, asserted rather than implied: the compiler
    // distinguishes the two values. `placement-runtime.e2e.test.ts` asserts the opposite of
    // a local WORKERD runtime — it refuses both identically, which is why this file exists.
    const refusedStatus = refusal().status
    const controlStatus = controlFor(HOSTED_JURISDICTION.eu).status
    expect(refusedStatus).not.toBe(controlStatus)
  })

  it('reached the compiler, and reached it for the right reason, on every control run', () => {
    // A `tsc` failing on a bad scratch config would satisfy a naive non-zero-exit assertion
    // for the wrong reason; a probe failing on `TS9010` (isolatedDeclarations) would satisfy
    // the refusal arm for a reason unrelated to the union. Neither appears anywhere below.
    for (const { result } of memberProbes) {
      expect(result.output).not.toMatch(/error TS5\d{3}/)
      expect(result.output).not.toMatch(/error TS9\d{3}/)
      expect(statSync(result.probePath).size).toBeGreaterThan(0)
    }
  })
})
