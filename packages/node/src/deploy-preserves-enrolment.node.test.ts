import { execFileSync, spawnSync } from 'node:child_process'
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * A release cannot silently switch certificate issuance off — AUTH-01.
 *
 * ## The trap, stated as the sequence it would actually produce
 *
 * `wrangler deploy` replaces a Worker's vars with what **that invocation** declares. `--var`
 * merges with `wrangler.jsonc`'s `vars` — measured 2026-08-27 and recorded in the script — but it
 * does not merge with whatever a *previous* deploy happened to set. So an operator who turns
 * issuance on with a standalone `wrangler deploy --var O2_MAX_ISSUED_PER_WINDOW:600` has it until
 * the next release, and then does not.
 *
 * What that looks like from outside is the part worth guarding. Issuance stops. `deploy-pages.sh`
 * probes `/self`, reads `enrolment.issues: false`, and correctly publishes a `bootstrap.json` with
 * no `enrollmentProvider`. Every visitor after that holds no certificate, so the TURN rung refuses
 * all of them — and the whole chain presents as *TURN is broken*, with nothing anywhere saying
 * that a variable was dropped by a deploy two steps earlier. This repository has now found that
 * shape four times, and each time it was a capability that existed and was not reached.
 *
 * ## Why this is a text check over the script
 *
 * The script's own e2e arms run it against scratch repositories, and this property is about a
 * command line that is only assembled when a real deploy happens — which no spec may perform. So
 * it is read the way `hosted-tier-deploy.node.test.ts` reads the same file: cheap, total, and it
 * names the line. The refusal path is additionally **executed** below against a stub `curl`, so
 * one of the two claims here is a run rather than a reading.
 */

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const SCRIPT_PATH = join(ROOT, 'scripts/deploy-hosted.sh')
const SCRIPT = readFileSync(SCRIPT_PATH, 'utf8')

/**
 * The budget for the one case that EXECUTES a stub it just wrote, and the number is a
 * measurement of the operating system rather than of this repository.
 *
 * **What was measured, on 2026-09-15.** macOS assesses a newly written executable the first
 * time it is exec'd directly. On this host that assessment took **31.24 s / 34.18 s / 31.31 s**
 * across three fresh stubs, with `XprotectService` at 81.4 % of a core throughout, against
 * **0.01 s** for the second exec of the same file and **0.01 s** for `sh <path>`, which never
 * exec's the file itself. Instrumented inside the case, the split is unambiguous: the sanity
 * probe that runs the stub reached **37 308 ms** while `spawnSync` of the script under test
 * took **866 ms**. The default 5 000 ms budget could not survive that and the case failed 2/2
 * on a host its own `[host conditions]` banner called quiet (load/core 1.89).
 *
 * **Why a budget and not a cleverer fixture.** The script under test calls `curl` by name, so
 * SOMETHING must exec the fresh stub; whichever exec is first pays the assessment, and moving
 * the probe to `sh` only moves the cost into `spawnSync`. The alternative — a stub at a stable
 * path so the assessment is cached between runs — buys speed with shared mutable state in a
 * fixture whose whole point is that it is hermetic, and buys it for one machine: a healthy Mac
 * assesses in well under a second and Linux CI has no XProtect at all.
 *
 * **The banner cannot see this, and that is worth knowing before the next attribution.**
 * `tools/measure/host-conditions-reporter.ts` reads `loadavg()` and `cpus()` and nothing else,
 * so a host that is idle on CPU while a scanner holds every new executable for half a minute
 * reports as quiet. Three attributions made earlier the same day leaned on that banner.
 *
 * This is the only spec in the repository that writes an executable stub — measured, `0o755`
 * appears in no other test file under any package's `src` — so the exposure is this one case.
 * (Written without the glob on purpose: the literal would close this comment.)
 *
 * **The episode subsided, and saying so is the point of a measured comment.** Re-measured
 * forty minutes later on the same host, three fresh stubs at fresh paths cost **0.20 s /
 * 0.26 s / 0.35 s**, a fresh stub with never-before-seen content cost **0.27 s**, and
 * `XprotectService` was no longer on the CPU list at all. So this budget covers an EPISODIC
 * host condition — a scanner that was busy for some window and then was not — rather than a
 * steady cost, and the case's own work is about a second. A reader who finds this budget
 * looking absurdly loose is reading it correctly: it is loose on purpose, and it is loose
 * against a number that was observed rather than imagined.
 *
 * **It is not plantable and that is stated rather than papered over.** A plant would have to
 * summon the operating system's scanner on demand. What carries the claim is the recorded
 * reading — 37 308 ms inside the case, 2/2 red at the default budget, 31.24/34.18/31.31 s in a
 * standalone probe with the responsible process named — not a watched red.
 */
const STUB_EXEC_BUDGET_MS = 120_000

describe('AUTH-01 — a deploy carries the enrolment vars or refuses', () => {
  it('reads a script big enough for the checks below to mean anything', () => {
    // The floor. Every case here is a text search, and a text search over an empty string passes.
    expect(SCRIPT.length).toBeGreaterThan(10_000)
    expect(SCRIPT).toContain('wrangler')
  })

  it('passes the budget on BOTH the dry run and the live deploy, never one of them', () => {
    // One without the other is worse than neither: the dry run would validate a configuration the
    // live deploy does not send, which is a gate that reports on something else.
    const sites = SCRIPT.split('\n').filter((line) => line.includes('--var "O2_VERSION:$VERSION"'))
    expect(sites.length, 'the deploy invocations moved; this check no longer names them').toBe(2)
    for (const site of sites) {
      expect(site, `a deploy invocation carries no enrolment vars: ${site.trim()}`).toContain(
        '$ENROLMENT_VARS',
      )
    }
  })

  it('builds those vars from the ENVIRONMENT, so an operator sets them once', () => {
    expect(SCRIPT).toContain('O2_MAX_ISSUED_PER_WINDOW:$O2_MAX_ISSUED_PER_WINDOW')
    expect(SCRIPT).toContain('O2_RESERVED_USER_KEYS:$O2_RESERVED_USER_KEYS')
    // Assembled before the first use. A definition below the dry run would send an empty string
    // there and the real value only to the live deploy — the asymmetry the case above forbids.
    expect(SCRIPT.indexOf('ENROLMENT_VARS=""')).toBeLessThan(
      SCRIPT.indexOf('--var "O2_VERSION:$VERSION" --var "O2_REGION:$REGION" $ENROLMENT_VARS'),
    )
  })

  it('reads the node back and fails LOUD when a carried budget did not arrive', () => {
    // The same discipline `killSwitch.operable` gets, and for its stated reason: rolling back
    // would revert a good build without arming anything, because the previous version has the
    // same problem. Failing reddens CI so `publish-client` never runs.
    expect(SCRIPT).toContain('"issues":true')
    expect(SCRIPT).toMatch(/AFTER_ISSUES/)
  })

  it('REFUSES rather than deploying when the node issues today and no budget is carried', () => {
    // Executed, not read. A stub `curl` answers a node that IS issuing, and the script must stop
    // before it spends a deploy. `O2_MAX_ISSUED_PER_WINDOW` is deliberately absent.
    //
    // `--live`, because only a live deploy can drop a var and the pre-flight is gated on it — a
    // dry run replaces nothing, and running there would reach every scratch-repository case in
    // `hosted-tier-deploy.node.test.ts`. Nothing is deployed regardless: `npx` is stubbed to
    // refuse, so if the pre-flight ever stopped firing this case fails on `STUBBED-NPX` rather
    // than on silence.
    //
    // The stubs are written with `writeFileSync` rather than a shell `printf`. The first draft
    // built them inside an `sh -c` string and the escaping left LITERAL backslashes in the JSON,
    // so the script's `"issues":true` match never fired and the case failed for a reason that had
    // nothing to do with the script. A stub whose content is not exactly what it looks like is a
    // fixture that measures itself.
    const bin = mkdtempSync(join(tmpdir(), 'o2-deploy-stub-'))
    try {
      writeFileSync(join(bin, 'curl'), '#!/bin/sh\necho \'{"enrolment":{"issues":true}}\'\n')
      writeFileSync(join(bin, 'npx'), '#!/bin/sh\necho STUBBED-NPX >&2\nexit 9\n')
      chmodSync(join(bin, 'curl'), 0o755)
      chmodSync(join(bin, 'npx'), 0o755)

      // The stub answers what the script is about to ask, byte for byte. Without this the case
      // could pass on a refusal triggered by something else entirely.
      expect(execFileSync(join(bin, 'curl'), { encoding: 'utf8' }).trim()).toBe(
        '{"enrolment":{"issues":true}}',
      )

      // `bash`, not `sh`, and the difference is a measured CI failure rather than a style
      // point. `scripts/deploy-hosted.sh` declares `#!/usr/bin/env bash` and opens with
      // `set -euo pipefail`. On macOS `/bin/sh` tolerates `pipefail`; on Ubuntu `/bin/sh` is
      // `dash`, which does not have it, so this line produced
      // `scripts/deploy-hosted.sh: 77: set: Illegal option -o pipefail` and reddened `ci.yml`
      // on every push from 2026-09-15 onward while passing on every laptop. The sibling spec
      // `hosted-tier-deploy.node.test.ts:589` already spawned `bash`; this one did not, and two
      // copies of one invocation diverged exactly the way this repository's scripts say they do.
      const run = spawnSync('bash', [SCRIPT_PATH, '--live', '--skip-tests'], {
        cwd: ROOT,
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${bin}:${process.env['PATH'] ?? ''}`,
          O2_MAX_ISSUED_PER_WINDOW: '',
          CLOUDFLARE_API_TOKEN: '',
          WRANGLER_SEND_METRICS: 'false',
        },
      })
      const output = `${run.stdout}${run.stderr}`
      expect(output, output).toContain('O2_MAX_ISSUED_PER_WINDOW')
      expect(output, 'the script went on to run wrangler instead of refusing').not.toContain(
        'STUBBED-NPX',
      )
      expect(run.status).not.toBe(0)
    } finally {
      rmSync(bin, { recursive: true, force: true })
    }
  }, STUB_EXEC_BUDGET_MS)

  it('says so plainly when enrolment is not configured at all, rather than passing silently', () => {
    expect(SCRIPT).toContain('this node issues no certificates')
  })
})
