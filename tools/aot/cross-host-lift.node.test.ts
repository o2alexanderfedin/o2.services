/**
 * `cross-host-lift.mjs` runs at all — Phase 41, and the reason this file exists is the
 * dispatch it protects.
 *
 * The driver is `.mjs`, so a whole-tree `tsc --noEmit` never sees it, and no other module
 * imports it. Its first execution would otherwise be **on the owner's dispatch of
 * `aot-cross-host.yml`**, which is the worst place to discover an unresolved import: a job
 * that dies at `node` startup produces no reading and costs a round trip through a person.
 *
 * So this runs it, on the one path that costs nothing: a fixture that is not there. That
 * exercises the imports, the argument handling and the failure path, and asserts the two
 * things a caller depends on — a **non-zero exit** and a message naming what could not be
 * read. It deliberately does NOT lift: a real lift is ~6 minutes of container and is the
 * subject of `lift.node.test.ts`, not of this file.
 */

import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url))
const DRIVER = 'tools/aot/cross-host-lift.mjs'

describe('AOT-03 — the cross-host driver executes before anyone dispatches it', () => {
  it('exits NON-ZERO and names the fixture it could not read', () => {
    const run = spawnSync('node', [DRIVER, 'tools/aot/fixtures/no-such-fixture'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      timeout: 60_000,
    })

    // Read off the result directly rather than through a pipe — the repository's own rule,
    // and it is the assertion that matters here: a driver that failed while exiting 0 would
    // make a CI job green on a lift that never happened.
    expect(run.status).toBe(1)
    expect(`${run.stdout}${run.stderr}`).toContain('no-such-fixture')
  }, 90_000)

  it('resolves every import it declares, which is what a startup failure would break', () => {
    // A module-resolution failure exits 1 as well, so the exit code above is not on its own
    // evidence that the SCRIPT ran. `ERR_MODULE_NOT_FOUND` in the output is what separates
    // "the driver reported a missing fixture" from "node could not load the driver".
    const run = spawnSync('node', [DRIVER, 'tools/aot/fixtures/no-such-fixture'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      timeout: 60_000,
    })

    expect(`${run.stdout}${run.stderr}`).not.toContain('ERR_MODULE_NOT_FOUND')
    expect(`${run.stdout}${run.stderr}`).not.toContain('Cannot find package')
  }, 90_000)
})
