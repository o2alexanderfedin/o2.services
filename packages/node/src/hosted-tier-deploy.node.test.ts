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
    // **THE SKIP ABOVE IS HISTORY AS OF 2026-08-26 — THIS CASE NOW READS A REAL BUNDLE.**
    // ARCHITECTURE steps 6+7 landed `packages/cloudflare/src/hosted-libp2p.ts`, which calls
    // `createLibp2p`, and `worker.ts`'s `alarm()` imports `hostedExpirySweep` from it. That
    // one import is enough: esbuild pulls the module's graph in, so links 2-4 of the chain
    // above are broken and the assertion has a subject.
    //
    // **It was written the other way first, and the build refuted it.** The claim was that a
    // module nothing CALLS is a module nothing BUNDLES; the emitted worker was 583.94 KiB with
    // `noise` appearing 43 times and `pureJsCrypto` twice. Tree-shaking is per-symbol, not
    // per-module — `kadDHT` and `circuitRelayServer` appeared 0 times in that same bundle,
    // which is what the reasoning had predicted for noise.
    //
    // **UPDATED SAME DAY BY PHASE 30, and the subject grew by a factor of three.** The listener
    // now upgrades a socket, so `createHostedFabric` has a production caller and the whole
    // stack is reachable: 1 867.80 KiB, 405.69 KiB gzipped, `kadDHT` x11, `circuitRelayServer`
    // x3. The two assertions below are unchanged and still pass, which is a stronger reading
    // than the one they passed against — the browser-field mechanism is now being checked over
    // a bundle carrying the whole of libp2p rather than a corner of it.
    //
    // So open question 1 is ANSWERED, by measurement: wrangler honours the package's legacy
    // top-level `browser` field and bundles the pure-JS path. `diffieHellman` 0,
    // `node:crypto` 0. The skip branch is kept rather than deleted because it is what makes
    // this reading non-vacuous — if a future change strands noise out of the bundle again,
    // this case says so out loud instead of passing over an empty file.
    //
    // It is skipped LOUDLY rather than asserted, and it flips to a real reading the moment
    // the assembly pulls noise in — at which point a regression in the browser-field
    // mechanism reddens here, which is what the consult asked for.
    if (!emitted.includes('pureJsCrypto') && !emitted.includes('noise')) {
      process.stdout.write(
        '[criterion 29 / open question 1] `@chainsafe/libp2p-noise` is not in the emitted ' +
          'bundle at all, so "diffieHellman is absent" would be vacuously true. The assembly ' +
          'exists as of 2026-08-26 (`hosted-libp2p.ts`) but `worker.ts` deliberately does ' +
          'not reach it: without Phase 30\u2019s listener a running node cannot be dialled, ' +
          'and an uncalled method on the deployed class is the "wired is not used" shape. ' +
          'This case becomes a real reading when that listener gives worker.ts a reason to ' +
          'construct a node, and it is NOT a statement that the bundle is clean.\n',
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

/**
 * The two defects the FIRST REAL DEPLOY found, and neither was findable without it.
 *
 * Phase 29 deployed on 2026-08-27. The node came up, `GET /self` answered, and the identity
 * survived a redeploy — and then the first inbound dial returned HTTP 500 twice in a row, for
 * two different reasons, both read out of `wrangler tail` rather than guessed:
 *
 * | # | Exception | Cause |
 * |---|---|---|
 * | 1 | `NoAnnouncedAddressError` | `wrangler.jsonc`'s `ANNOUNCE_MULTIADDRS` was still `""` |
 * | 2 | `ReferenceError: BroadcastChannel is not defined` | `workerd-shims.ts` reached the bundle ZERO times |
 *
 * **Defect 1 was the design working.** A relay with nothing announced hands every client an
 * empty reservation *silently* (consult §13), so the assembly refuses instead. It failed loudly
 * on the first dial, which is exactly what that refusal is for.
 *
 * **Defect 2 is the one worth a guard.** `workerd-shims.ts` is a complete, tested module that
 * installs a same-isolate `BroadcastChannel` and verifies its own postcondition — and nothing
 * imported it, so its side effect never ran on the platform whose gap it exists to close.
 * Measured on the emitted bundle before the fix: `MinimalBroadcastChannel` appeared **0** times.
 * Every one of its own specs passed throughout, because they call `installWorkerdShims`
 * directly. **A module that is correct and unreached is indistinguishable from one that is
 * absent** — from the platform's side, identical.
 *
 * These cases read the BUNDLE rather than the import line, because the import line is not the
 * claim. A tree-shaken import, a conditional one, or a re-export that drops the side effect all
 * leave the source looking right and the bundle empty.
 */
describe('the workerd shims reach the deployed bundle — the second defect the first deploy found', () => {
  it('carries the BroadcastChannel shim, which was absent on the deploy that threw', () => {
    const emitted = emittedBundle()

    // The plant that proves this is not vacuous: removing the import from `worker.ts` takes
    // this to 0, which is the reading taken on 2026-08-27 before the fix.
    expect(
      emitted.includes('MinimalBroadcastChannel'),
      'the shim class must be IN the bundle — an import that tree-shakes away leaves the ' +
        'source looking correct and the platform throwing ReferenceError on the first dial',
    ).toBe(true)
  }, 180_000)

  it('carries the shim INSTALLER, not merely the class it would install', () => {
    const emitted = emittedBundle()

    // Bundling the class without the call that installs it would satisfy the case above and
    // still leave `globalThis.BroadcastChannel` undefined. The installer's own postcondition
    // check is what makes a failed shim throw rather than pass silently.
    expect(emitted).toContain('installWorkerdShims')
  }, 180_000)

  it('imports the shims module for its SIDE EFFECT, before anything can construct libp2p', () => {
    const worker = readFileSync(join(PACKAGE, 'src/worker.ts'), 'utf8')

    // A side-effect import, not a named one: nothing in `worker.ts` calls into the module, so
    // a named import would be dropped and the gap would reopen with the source unchanged.
    expect(worker).toContain("import './workerd-shims.ts'")
  })
})

describe('the announced address is configured — the first defect the first deploy found', () => {
  it('is not the empty placeholder that threw NoAnnouncedAddressError on the first dial', () => {
    const config = readFileSync(join(PACKAGE, 'wrangler.jsonc'), 'utf8')

    // The value is the deployment's, never the request's — a `Host` header is
    // visitor-controlled. This asserts only that it is non-empty and a `/dns4/` multiaddr;
    // WHICH host is an owner choice and is deliberately not pinned here.
    expect(config).not.toContain('"ANNOUNCE_MULTIADDRS": ""')
    expect(config).toMatch(/"ANNOUNCE_MULTIADDRS":\s*"\/dns4\/[^"]+\/tcp\/443\/tls\/ws"/)
  })
})

describe('one version, and the deployed node can be asked for it', () => {
  /**
   * The question that produced these cases was the owner's: *"where do we get the release
   * version from?"* — and the measured answer on 2026-08-27 was **nowhere**. The root manifest
   * had no `version` field at all, all nine workspace packages sat at the `0.0.0` placeholder,
   * and a repository-wide search for `GITHUB_REF_NAME`, `github.event.release` and
   * `npm_package_version` returned zero hits. The tag a human typed into the GitHub release form
   * triggered the deploy and reached nothing; a running node could not say what it was built
   * from.
   */
  const ROOT_MANIFEST: unknown = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
  const DEPLOY_SCRIPT = readFileSync(join(ROOT, 'scripts/deploy-hosted.sh'), 'utf8')

  function rootVersion(): string {
    if (typeof ROOT_MANIFEST !== 'object' || ROOT_MANIFEST === null || !('version' in ROOT_MANIFEST)) {
      throw new Error('the root package.json declares no "version" — nothing names the build')
    }
    const { version } = ROOT_MANIFEST
    if (typeof version !== 'string') throw new Error('the root "version" is not a string')
    return version
  }

  it('carries a release version on the ROOT manifest, in semver and without a leading v', () => {
    // A leading `v` is the tag's spelling, not npm's; the script derives the tag as `v$VERSION`,
    // so a `v` stored here would look for `vv2.0.0-rc.1` and refuse every release.
    expect(rootVersion()).toMatch(/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/)
  })

  it('leaves every workspace package on the placeholder, so the repository has ONE version', () => {
    // Nine packages, all private, all linked with `*` — none is published, so a version on each
    // would be nine copies of one fact and nine chances for them to disagree. The placeholder is
    // what says "this number is not the one that means anything".
    const manifests = execFileSync('git', ['ls-files', 'packages/*/package.json'], {
      cwd: ROOT,
      encoding: 'utf8',
    })
      .split('\n')
      .filter((line) => line.length > 0)

    expect(manifests.length).toBeGreaterThan(1)
    for (const path of manifests) {
      const parsed: unknown = JSON.parse(readFileSync(join(ROOT, path), 'utf8'))
      const version =
        typeof parsed === 'object' && parsed !== null && 'version' in parsed ? parsed.version : undefined
      expect(version, `${path} carries a version of its own — the root manifest is the one source`).toBe(
        '0.0.0',
      )
    }
  })

  it('keeps the version OUT of wrangler.jsonc, which would be the second source', () => {
    expect(CONFIG).not.toContain('O2_VERSION')
    expect(CONFIG, 'the version literal must not be pasted into the deploy config').not.toContain(
      rootVersion(),
    )
  })

  it('injects the root manifest’s version at deploy time rather than hardcoding one', () => {
    expect(DEPLOY_SCRIPT).toContain("require('./package.json').version")
    expect(DEPLOY_SCRIPT).toContain('--var "O2_VERSION:$VERSION"')
  })

  it('refuses a release whose tag disagrees with the manifest', () => {
    // The drift this closes is one layer down from the one the owner found: a release tagged
    // v2.0.1 over an unbumped manifest would deploy announcing the older number, and the node's
    // answer to "what are you running" would be a lie shaped like a version.
    expect(DEPLOY_SCRIPT).toContain('GITHUB_REF_NAME')
    expect(DEPLOY_SCRIPT).toContain('"$GITHUB_REF_NAME" != "v$VERSION"')
  })

  it('rolls the deploy back when the node answers with a version other than the one sent', () => {
    expect(DEPLOY_SCRIPT).toContain('extract_field version')
    expect(DEPLOY_SCRIPT).toContain(
      'THE DEPLOYED NODE DOES NOT REPORT THE VERSION THAT WAS DEPLOYED',
    )
  })

  it('answers `GET /self` with the deployment’s version, and names the gap when there is none', () => {
    const worker = readFileSync(join(PACKAGE, 'src/worker.ts'), 'utf8')

    expect(worker).toContain('version: this.#env.O2_VERSION ?? UNVERSIONED')
    // A sentinel rather than an omitted field: a missing key reads as an older node to anything
    // parsing the answer, while this string cannot be mistaken for a release number.
    expect(worker).toContain("const UNVERSIONED = 'unversioned'")
  })
})
