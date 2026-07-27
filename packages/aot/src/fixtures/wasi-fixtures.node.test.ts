import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { compileWat, FIXTURES } from '../../scripts/compile-wasi-fixture.mjs'
import { WASI_FIXTURES } from './wasi-fixtures.ts'

/**
 * The committed WASI binaries are checked against the sources they claim to come from.
 *
 * These `.wasm` files are the only evidence in the repository that `WasiExecutor` has
 * ever run a WASI command module. Nothing about looking at one tells a reader whether
 * it is the compilation of the `.wat` beside it or of something else entirely — and
 * "something else entirely" is precisely the interesting failure, because a fixture
 * that quietly stopped matching its source would let the executor's whole test suite
 * pass while testing a program nobody has read.
 *
 * So the claim gets checked three ways: recompile every `.wat`, compare to the
 * committed `.wasm`, and compare both to the base64 the portable suite actually
 * loads.
 *
 * Node-only, and named so. Reading a directory off disk is what a browser cannot do,
 * and the `.node.test.ts` suffix is the vitest project gate that keeps this file out
 * of the browser run — the same convention `@o2/demo`'s `kernel-build.node.test.ts`
 * uses, from which this file is copied. The *bytes* stay portable:
 * `wasi-fixture-bytes.ts` carries them as base64.
 */

const DIR = fileURLToPath(new URL('.', import.meta.url))

const committed = (name: string): Uint8Array => new Uint8Array(readFileSync(`${DIR}${name}.wasm`))
const source = (name: string): string => readFileSync(`${DIR}${name}.wat`, 'utf8')

describe('every committed .wasm is the compilation of the .wat beside it', () => {
  for (const name of FIXTURES) {
    it(`${name}.wasm recompiles to byte-identical output`, async () => {
      const rebuilt = await compileWat(name, source(name))
      const onDisk = committed(name)
      expect(rebuilt.length).toBe(onDisk.length)
      // Compared as arrays so a mismatch reports the offending index rather than
      // just "not equal" — for a few hundred bytes that is the difference between a
      // lead and a shrug.
      expect([...rebuilt]).toEqual([...onDisk])
    })

    it(`${name}'s base64 mirror is in step with the binary`, () => {
      // If the two ever diverged, the browser project would run one module and the
      // node project another, and the suite would be silently testing two different
      // programs under one name.
      expect([...(WASI_FIXTURES[name] ?? new Uint8Array())]).toEqual([...committed(name)])
    })
  }
})

describe('the fixture lists cannot drift apart', () => {
  /**
   * Three lists name these fixtures: the build script's `FIXTURES`, the `.wat` files
   * on disk, and `WASI_FIXTURES` in the portable accessor. A `.wat` added to the
   * directory but not registered would simply never be compiled, and nothing would
   * say so — the test above iterates `FIXTURES`, so it would not even notice.
   */
  it('registers every .wat present in the directory', () => {
    const onDisk = readdirSync(DIR)
      .filter((entry) => entry.endsWith('.wat'))
      .map((entry) => entry.slice(0, -'.wat'.length))
      .sort()
    expect(onDisk).toEqual([...FIXTURES].sort())
  })

  it('exposes every registered fixture to the portable suite', () => {
    expect(Object.keys(WASI_FIXTURES).sort()).toEqual([...FIXTURES].sort())
  })
})

describe('the sources are genuinely WASI, not merely named so', () => {
  /**
   * A trivial guard against the tests above passing because a `.wat` was replaced by
   * a stub while its binary stayed behind. The four working fixtures must actually
   * declare the import namespace and the export pair that make a module a WASI
   * command module — that shape is the entire premise of `WasiExecutor`.
   */
  for (const name of [
    'wasi-echo',
    'wasi-shard',
    'wasi-probe',
    'wasi-fail',
    'wasi-fdstat',
    'wasi-env',
    'wasi-hostcall',
    'wasi-noisy',
  ]) {
    it(`${name}.wat imports from wasi_snapshot_preview1 and exports memory + _start`, () => {
      const wat = source(name)
      expect(wat).toContain('(import "wasi_snapshot_preview1"')
      expect(wat).toContain('(memory (export "memory") 1 1)')
      expect(wat).toContain('(func (export "_start")')
    })
  }

  it('wasi-echo.wat names the three functions the echo contract needs', () => {
    const wat = source('wasi-echo')
    for (const fn of ['fd_read', 'fd_write', 'proc_exit']) {
      expect(wat).toContain(`(import "wasi_snapshot_preview1" "${fn}"`)
    }
  })
})
