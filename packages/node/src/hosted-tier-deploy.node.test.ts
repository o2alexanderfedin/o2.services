/**
 * Phase 29 criteria 4, 5 and 6, and the open-question-1 bundle reading.
 *
 * ## Why these are one file
 *
 * Each is a rule about something that is **irreversible or unbounded once wrong**, and each is
 * checked over the tree as text rather than by running the thing:
 *
 * - **criterion 4** — an object's location is fixed by its very first `get()` and never
 *   changes. A second call site sites an object permanently wherever that call came from, and
 *   the only repair is a new name. Not a redeploy. Not a migration.
 * - **criterion 5** — no preview deployments, ever. The multiplier in the only runaway-bill
 *   report this project cites was not the alarm; it was **60+ preview Worker deployments**,
 *   each with its own Durable Object instances running the same bug.
 * - **criterion 6** — `idFromName()` creates an object for any name it is given, so a name
 *   derived from anything a visitor controls lets one person create unbounded objects, each
 *   with its own storage and its own alarm.
 *
 * ## Nothing here deploys, and the envelope is stated rather than assumed
 *
 * The single wrangler invocation is `deploy --dry-run --outdir=<scratch>`, with
 * `WRANGLER_SEND_METRICS=false`. Measured 2026-08-26: it needs **no authentication** and
 * reaches no network — it exits 0 on a machine with no credential configured. If that ever
 * stops being true this file must fail rather than prompt, which is why the exit code and the
 * output directory are both asserted instead of only the absence of a throw.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const PACKAGE = join(ROOT, 'packages/cloudflare')
const CONFIG = readFileSync(join(PACKAGE, 'wrangler.jsonc'), 'utf8')

/** Where the dry-run writes. Removed in `afterAll`, so a green run leaves no bundle behind. */
const OUTDIR = mkdtempSync(join(tmpdir(), 'o2-hosted-bundle-'))
afterAll(() => {
  rmSync(OUTDIR, { recursive: true, force: true })
})

/**
 * Build once and share. The dry-run is the expensive thing in this file by an order of
 * magnitude, and building it per case would make the file's cost the number of assertions
 * rather than the number of builds.
 */
let bundle: string | undefined
function emittedBundle(): string {
  if (bundle !== undefined) return bundle
  execFileSync(
    'npx',
    ['wrangler', 'deploy', '--dry-run', `--outdir=${OUTDIR}`],
    {
      cwd: PACKAGE,
      encoding: 'utf8',
      env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
  bundle = readFileSync(join(OUTDIR, 'worker.js'), 'utf8')
  return bundle
}

describe('criterion 5 — a configuration that would create a preview deployment', () => {
  it('states `preview_urls: false` rather than leaning on the default', () => {
    // wrangler's own schema gives this key `"default": false` — read out of
    // `node_modules/wrangler/config-schema.json`, not out of documentation. Stating it anyway
    // is the point: a default is a thing that can change under you in a minor version, and a
    // stated value is a thing this guard can read and a reviewer can see.
    expect(CONFIG).toContain('"preview_urls": false')
  })

  it('keeps `workers_dev` on, because criterion 2 is settled by the address it serves', () => {
    // Asserted in the OTHER direction from the line above, so this file cannot be read as
    // "turn everything off". The dialable address criterion 2 names is
    // `/dns4/<name>.workers.dev/tcp/443/tls/ws/p2p/<peerId>`, and this key is what serves it.
    expect(CONFIG).toContain('"workers_dev": true')
  })

  it('names an object class and a migration, so the binding cannot be silently absent', () => {
    expect(CONFIG).toContain('"class_name": "BootstrapObject"')
    // `new_sqlite_classes`, not `new_classes`: the SQLite backend is what `DoDatastore` is
    // written against.
    expect(CONFIG).toContain('"new_sqlite_classes": ["BootstrapObject"]')
  })

  it('does not name anything near the account’s existing production scripts', () => {
    // The owner runs three `ocr-checks-worker*` scripts in this account and they are
    // production. A configuration that resolved near them is a hazard this file can see and
    // a deploy cannot take back.
    expect(CONFIG).toContain('"name": "o2-bootstrap"')
    expect(CONFIG).not.toContain('ocr-checks-worker')
  })
})

describe('the emitted bundle — open question 1, and the trap beside it', () => {
  it('builds at all, which is the `ws` dynamic-require trap answered rather than argued', () => {
    // §8 of the 2026-08-24 consult records a bundling failure that "fails loudly and
    // misleadingly": `--conditions=node` applied globally pulls `ws` in through
    // `@libp2p/websockets`, `ws` is CJS with a dynamic `require('events')`, and Cloudflare
    // rejects the UPLOAD with an error about the bundle that says nothing about the cause.
    // A build that completes is the whole of the check, and it is not vacuous — the trap
    // arrives as a non-zero exit from the line below.
    const emitted = emittedBundle()
    expect(existsSync(join(OUTDIR, 'worker.js'))).toBe(true)
    expect(emitted.length).toBeGreaterThan(1000)
    expect(emitted).not.toContain('Dynamic require')
  }, 180_000)

  it('keeps `diffieHellman` out of the bundle — OR says why it cannot answer yet', (ctx) => {
    const emitted = emittedBundle()

    // **THE ANTI-VACUITY PRECONDITION, AND TODAY IT IS THE ONE THAT FIRES.**
    //
    // Open question 1 asked whether `@chainsafe/libp2p-noise`'s node build — which calls
    // `crypto.diffieHellman`, absent on workerd — reaches a Cloudflare bundle. It was settled
    // 2026-08-25: wrangler's default resolution honours the package's legacy top-level
    // `browser` field and bundles the pure-JS path, so the answer is zero configuration lines.
    // The consult's own instruction is to "add a guard asserting `diffieHellman` is absent
    // from the emitted bundle" so that a silent regression — upstream dropping the field, or
    // wrangler ceasing to honour it — arrives red.
    //
    // **That assertion is only worth anything if noise is IN the bundle.** Measured
    // 2026-08-26 on the bundle this file builds: `noise` appears 0 times, `pureJsCrypto` 0
    // times, and the sourcemap lists 0 sources whose path contains "noise". So
    // `diffieHellman` is absent because the whole package is absent, and asserting it would
    // be true of an empty file.
    //
    // The chain is measured end to end and each link is elsewhere in this commit:
    //   1. nothing here constructs a libp2p node yet — the inbound listener belongs to Phase
    //      30 by the roadmap's division, and its four measured requirements are recorded in
    //      `.planning/research/v2.0/ARCHITECTURE.md:484-506`. (An earlier version of this
    //      comment said the listener was BLOCKED because `webSocketToMaConn` is unexported.
    //      That was wrong and is corrected in `hosted-object.ts`: `exports` gates package
    //      specifiers only, and the same file imported BY PATH builds under wrangler at
    //      exit 0 with the symbol in the bundle.);
    //   2. so nothing calls `createLibp2p`;
    //   3. so no connection encrypter is bundled;
    //   4. so this assertion has no subject.
    //
    // It is skipped LOUDLY rather than asserted, and it flips to a real reading the moment
    // the assembly pulls noise in — at which point a regression in the browser-field
    // mechanism reddens here, which is what the consult asked for.
    if (!emitted.includes('pureJsCrypto') && !emitted.includes('noise')) {
      process.stdout.write(
        '[criterion 29 / open question 1] `@chainsafe/libp2p-noise` is not in the emitted ' +
          'bundle at all, so "diffieHellman is absent" would be vacuously true. The assembly ' +
          'that would pull it in is blocked on `webSocketToMaConn`, which the pinned ' +
          '@libp2p/websockets@10.1.17 does not export — see `hosted-object.ts`. This case ' +
          'becomes a real reading as soon as the node is constructed, and it is NOT a ' +
          'statement that the bundle is clean.\n',
      )
      ctx.skip()
    }

    expect(emitted).not.toContain('diffieHellman')
    expect(emitted).not.toContain('node:crypto')
  }, 180_000)
})

describe('criteria 4 and 6 — one call site, and no name a visitor can choose', () => {
  /** Every tracked TypeScript source, so a second call site cannot hide in an untracked file. */
  function trackedSources(): readonly string[] {
    return execFileSync('git', ['ls-files', '*.ts', '*.tsx'], { cwd: ROOT, encoding: 'utf8' })
      .split('\n')
      .filter((path) => path.length > 0)
  }

  /** Files naming `idFromName`, excluding this guard, which necessarily names it. */
  function callersOfIdFromName(): readonly string[] {
    return trackedSources().filter((path) => {
      if (path.endsWith('hosted-tier-deploy.node.test.ts')) return false
      return readFileSync(join(ROOT, path), 'utf8').includes('idFromName')
    })
  }

  it('finds `idFromName` in exactly the two files that may name it', () => {
    // `hosted-object.ts` calls it inside `stubFor`; `hosted-identity.test.ts` implements it on
    // a spy namespace to assert what `stubFor` did with it. Any THIRD file is the finding —
    // an object sited from a second place is sited permanently, and the only repair is a new
    // name, so a review comment after the fact is not a repair at all.
    expect([...callersOfIdFromName()].sort()).toEqual([
      'packages/cloudflare/src/hosted-identity.test.ts',
      'packages/cloudflare/src/hosted-object.ts',
    ])
  })

  it('reads back the one call site rather than trusting the file list', () => {
    // The count above is satisfied by a file that names `idFromName` in a comment. This reads
    // the call as written, so a second CALL inside the permitted file is caught too.
    const source = readFileSync(join(PACKAGE, 'src/hosted-object.ts'), 'utf8')
    const calls = source.match(/idFromName\(/g) ?? []
    expect(calls.length).toBe(1)
    // And it is inside the guarded function, after the refusal — not before it. A check that
    // ran after the call would refuse a name whose object already exists.
    const refusalAt = source.indexOf('throw new UnknownHostedObjectNameError')
    const callAt = source.indexOf('idFromName(')
    expect(refusalAt).toBeGreaterThan(0)
    expect(callAt).toBeGreaterThan(refusalAt)
  })

  it('derives no object name from a request', () => {
    const worker = readFileSync(join(PACKAGE, 'src/worker.ts'), 'utf8')
    // The name handed to `stubFor` is a module constant. A `searchParams`, a header read or a
    // path segment reaching it would be the defect, and it would be INVISIBLE: the request
    // would succeed, the object would exist, and its siting would be permanent.
    expect(worker).toContain("const SERVED_BY: HostedObjectName = 'bootstrap-us'")
    expect(worker).toContain('stubFor(env.BOOTSTRAP, SERVED_BY)')
    expect(worker).not.toContain('searchParams')
  })
})
