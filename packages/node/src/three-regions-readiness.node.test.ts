/**
 * `scripts/three-regions-readiness.sh` — the read an owner takes before an irreversible act.
 *
 * ## What is actually at stake, and why a spec rather than trust
 *
 * A Durable Object's location is fixed by its very first `get()` and never moves; a wrong
 * placement is not repairable, only replaceable, and each object is ≈$5/month forever. The
 * script exists so the owner can check readiness cheaply and repeatedly before that act. Two
 * failure modes would make it worse than useless, and both are what this file watches:
 *
 * 1. **It reports ready when it is not.** A missing entry module or an emptied announce list
 *    would reach the deploy as a runtime refusal, after the object exists.
 * 2. **It spends money, or creates something, while claiming to be a read.** A readiness check
 *    that deploys is the exact hazard it was written to remove.
 *
 * ## The second is checked by absence, which is weak, and it is said so rather than dressed up
 *
 * There is no way to prove from source that a shell script never creates a resource. What is
 * checked is that the two verbs that could — `wrangler deploy` and `wrangler dev` — do not
 * appear in it, and that the one `wrangler` call it does make is `deployments list`. That is a
 * grep, not a proof, and a spec that implied otherwise would be the weaker claim in the
 * stronger claim's language. The real guarantee is that the script is short enough to read.
 *
 * ## Why this does not just test `deploy-hosted.sh` again
 *
 * `hosted-tier-deploy.node.test.ts` owns that script, including the `--dry-run` default and the
 * `--alert-configured` gate. The overlap here is deliberately one thing — the closed list of
 * three configurations — and it is checked as an AGREEMENT between two files rather than
 * duplicated: if the readiness script ever names a configuration the deploy script would refuse,
 * the owner would be told a placement is ready that could not be deployed.
 */

import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const SCRIPT = join(ROOT, 'scripts/three-regions-readiness.sh')
const SOURCE = readFileSync(SCRIPT, 'utf8')
const DEPLOY = readFileSync(join(ROOT, 'scripts/deploy-hosted.sh'), 'utf8')

/** The three configurations, as the owner's own queue names them. */
const CONFIGS = [
  'packages/cloudflare/wrangler.jsonc',
  'packages/cloudflare/wrangler.eu.jsonc',
  'packages/cloudflare/wrangler.sam.jsonc',
] as const

function run(args: readonly string[]): { status: number | null; stdout: string } {
  const result = spawnSync('bash', [SCRIPT, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 60_000,
    // No credential, deliberately: the default invocation must answer every local question
    // without one, which is the property that makes it cheap enough to re-run.
    env: { ...process.env, CLOUDFLARE_API_TOKEN: '' },
  })
  return { status: result.status, stdout: `${result.stdout}${result.stderr}` }
}

describe('the readiness read is a read, and it answers the three placement questions', () => {
  it('runs green against this tree with no credential and no network', () => {
    const { status, stdout } = run([])
    expect(
      status,
      `the readiness script exited ${String(status)} against a tree whose three configurations ` +
        `are all present. Its output:\n${stdout}`,
    ).toBe(0)
    expect(stdout).toContain('The local half is ready')
  })

  it('names all three configurations and each one’s placement mechanism', () => {
    const { stdout } = run([])
    for (const config of CONFIGS) expect(stdout).toContain(config)
    // The three are NOT symmetric, and HOST-06's whole point is that the difference must be
    // visible rather than hidden inside one helper. A reader of this output sees it.
    expect(stdout).toContain('jurisdiction eu — BINDING')
    expect(stdout).toContain('locationHint only — best effort')
  })

  it('states the cost, that two regions also work, and that the first get() is final', () => {
    const { stdout } = run([])
    // The figures the owner's queue carries, so the read and the queue cannot drift apart.
    expect(stdout).toContain('$5/month')
    expect(stdout).toContain('$15/month')
    expect(stdout).toContain('TWO REGIONS ALSO WORK')
    expect(stdout).toContain('fixed by its VERY FIRST get()')
  })

  it('says the billing alert is the reading it cannot take, rather than implying it took one', () => {
    const { stdout } = run([])
    // `HOST-10` is `Refuted` — the ordering was lost for bootstrap-us permanently. A script
    // that printed "alert: ok" from the operator's own `--alert-configured` declaration would
    // be inventing a reading of the account. Nothing in this repository reads alert policies.
    expect(stdout).toContain('Nothing in this repository reads alert policies')
    expect(stdout).toContain('informational only')
    expect(
      stdout,
      'the readiness read must not present the alert as verified — the operator confirms it',
    ).toContain('Confirm the alert')
  })

  it('reports an unreadable account as unreadable, never as “not deployed”', () => {
    const { stdout } = run(['--account'])
    // With no credential the account half cannot be read at all. Saying "no deployment listed"
    // there would tell the owner a placement is still free when it may already be fixed —
    // the one wrong answer that costs $5/month forever.
    expect(stdout).toContain('CLOUDFLARE_API_TOKEN is not set')
    expect(stdout).not.toContain('has a live deployment')
  })

  it('creates nothing: no EXECUTABLE line spells `wrangler deploy` or `wrangler dev`', () => {
    // Checked by absence, which is weak — see the header. The one wrangler verb it may use is
    // a listing.
    //
    // **Comment lines are excluded, and finding that out cost this spec a red.** The first
    // version scanned the whole file and failed on the script's own header, which says in
    // prose that `wrangler dev` and `wrangler deploy` appear nowhere in it — a sentence made
    // false by a guard that cannot tell a claim from a call. `wrangler.jsonc`'s header records
    // the same collision happening twice before. So the scan is over executable lines, and the
    // carve-out is the comment prefix rather than a named exemption, because a named exemption
    // would have to be maintained every time the prose moves.
    const executable = SOURCE.split('\n').filter((line) => !/^\s*#/u.test(line))
    const offending = executable.filter((line) => /wrangler\s+(deploy|dev)\b/u.test(line))
    expect(
      offending,
      `a readiness read must not be able to create anything, and these executable line(s) ` +
        `spell a creating verb: ${JSON.stringify(offending)}`,
    ).toEqual([])
    // `deployments list` is a listing and is the one call the script is allowed to make. It
    // must still be present, or this case would pass against a script that had lost the
    // account half entirely.
    expect(executable.join('\n')).toContain('wrangler deployments list')
  })

  it('names only configurations `deploy-hosted.sh` would accept', () => {
    // An agreement between two files rather than a duplicated list. A readiness read that
    // blessed a configuration the deploy script refuses would tell the owner something is
    // ready that cannot be deployed.
    for (const config of CONFIGS) {
      expect(
        SOURCE.includes(config) && DEPLOY.includes(config),
        `${config} must be named by BOTH scripts — readiness names it: ` +
          `${String(SOURCE.includes(config))}, deploy accepts it: ${String(DEPLOY.includes(config))}`,
      ).toBe(true)
    }
  })
})
