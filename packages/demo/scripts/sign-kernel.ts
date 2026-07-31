/**
 * Sign `src/kernel.wasm` and write `src/kernel-record.ts`.
 *
 * A third generated artifact beside `build-kernel.mjs`'s two, and for a third
 * consumer:
 *
 *   kernel.wasm        the binary, checked against `kernel.wat` by `kernel-build.node.test.ts`
 *   kernel-bytes.ts    the same bytes as base64, for the browser and the portable suite
 *   kernel-record.ts   the signed `name -> CID` mapping that says who meant those bytes to run,
 *                      plus the public half of the key that signed it
 *
 * Content addressing proves integrity and says nothing about provenance: a CID
 * guarantees the bytes you fetched are the bytes that were hashed, not that they are
 * the module anyone intended. `guardModuleProvenance` (`@o2/core`) refuses to execute a
 * task whose module arrived without a record a pinned anchor vouches for. This script
 * produces the demo tier's record.
 *
 * Build-time only, run by hand, never imported from `src/`:
 *
 *   npm run sign:kernel --workspace @o2/demo
 *
 * ## Key handling — read this before running it
 *
 * Every run generates a **new** ed25519 key and discards the private half the moment
 * it has signed. There is no way to re-sign later. Regenerating therefore means a new
 * key, a new anchor and a new record, and all three are committed together in one
 * change.
 *
 * That is deliberate, and it is also the exact point at which this phase's guarantee
 * is weaker than it sounds — so it gets stated rather than left implicit.
 *
 * What it buys, precisely: the anchor and the artifact it vouches for ship in the same
 * bundle, so a tab that holds the anchor got it from the same place it got the module.
 * A peer in the demo fabric cannot make that tab run a module this repository did not
 * ship, because it cannot forge a record the pinned anchor accepts.
 *
 * What it does not buy, equally precisely: it proves nothing to anyone who does not
 * already trust this repository, because the anchor and the artifact have exactly one
 * origin. It is not a third-party attestation and must never be described as one.
 *
 * The production build authority is a separate key held outside the repository and
 * configured per node via `--trust-anchor` (Plan 14-03). The demo tier's key is not
 * that key and never becomes it.
 */

import { ed25519 } from '@noble/curves/ed25519.js'
import { MemoryBlockstore, signName } from '@o2/core'
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { kernelBytes } from '../src/kernel.ts'

const SRC = fileURLToPath(new URL('../src/', import.meta.url))

/** The name the demo resolves. One artifact, one name. */
const KERNEL_NAME = 'o2-demo-colouring-kernel'

/**
 * How long the record stays good.
 *
 * A configuration choice, not a measurement. Long enough that the demo does not go
 * dark between releases; short enough that a record outliving the repository it came
 * from is not the default. `kernel-build.node.test.ts` fails once fewer than 60 days
 * remain, which is the window in which somebody can act.
 */
const LIFETIME_DAYS = 400

const DAY_MS = 24 * 60 * 60 * 1000

// Through `MemoryBlockstore.put`, not a hand-rolled `sha256` + `CID.create`. The CID
// the runtime compares against comes from `store.put(kernelBytes)` in `demo/main.ts`,
// and computing it through the identical code path is the only form that cannot drift
// from it. `FsBlockstore` and `IdbBlockstore` each carry a comment saying they compute
// the same thing; this relies on that rather than restating the scheme.
const cid = await new MemoryBlockstore().put(kernelBytes)

const expiresAt = Date.now() + LIFETIME_DAYS * DAY_MS

/**
 * Single-quoted, to match the rest of the repository.
 *
 * Everything emitted here is hex, a CID or an ASCII name, so nothing needs escaping —
 * but "needs no escaping" is checked rather than assumed, because a generator that
 * emits source is one typo in a name away from writing a file that does not parse.
 * `JSON.stringify` would be safe in general and emits double quotes that read as
 * foreign in every diff, so the narrower alphabet is the trade taken.
 */
function quoted(text: string): string {
  if (!/^[A-Za-z0-9._-]+$/.test(text)) {
    throw new Error(`refusing to emit ${JSON.stringify(text)} unquoted-safe: unexpected character`)
  }
  return `'${text}'`
}

// The private half exists only inside this expression. Nothing below it can reach the
// binding, and nothing writes it anywhere.
const record = signName(ed25519.utils.randomSecretKey(), {
  name: KERNEL_NAME,
  cid,
  version: 1,
  expiresAt,
})

writeFileSync(
  `${SRC}kernel-record.ts`,
  `/**
 * GENERATED — do not edit. Run \`npm run sign:kernel --workspace @o2/demo\` to regenerate.
 *
 * The demo tier's signed \`name -> CID\` mapping for \`kernel.wasm\`, and the public half
 * of the key that signed it. \`guardModuleProvenance\` (\`@o2/core\`) refuses to execute a
 * module that arrived without a record some pinned anchor vouches for; this is that
 * record, and {@link KERNEL_TRUST_ANCHOR} is that anchor.
 *
 * The CID is written as a literal and reconstructed with \`CID.parse\` so this file holds
 * no binary and stays readable in a diff. \`kernel-build.node.test.ts\` recomputes it from
 * the committed \`kernel.wasm\` on disk and requires the two to agree, so the literal is
 * checked rather than trusted.
 *
 * ## Key handling
 *
 * \`sign-kernel.ts\` generates a new ed25519 key on every run and discards the private
 * half immediately, so this record can never be re-signed. Regenerating means a new
 * key, a new anchor and a new record — committed together, in one change, or the demo
 * refuses its own kernel.
 *
 * The anchor and the artifact it vouches for ship in the same bundle. That is what the
 * guarantee rests on and also its exact limit: a peer cannot make this tab run a module
 * the repository did not ship, and equally, none of this proves anything to somebody
 * who does not already trust the repository. The production build authority is a
 * separate key held outside version control and supplied per node via
 * \`--trust-anchor\`; this is not that key.
 *
 * ## Reach — check before regenerating
 *
 * **Both node binaries default to {@link KERNEL_TRUST_ANCHOR}.** \`bin/agent.ts\` and
 * \`bin/seed.ts\` each read \`values['trust-anchor'] ?? [KERNEL_TRUST_ANCHOR]\`, so
 * regenerating this file changes what a stock \`o2 agent\` and a stock \`o2 seed\` will
 * run. The record and the anchor must be committed together or every such process
 * refuses the kernel it ships. That the private half is discarded is what bounds this:
 * the default can accept exactly the one record committed here, and can never be made
 * to accept another.
 */

import type { NameRecord, PublicKeyHex } from '@o2/core'
import { CID } from 'multiformats/cid'

/** The name the demo's module is published under. */
export const KERNEL_NAME: string = ${quoted(KERNEL_NAME)}

/** The public half of the key that signed {@link KERNEL_RECORD}. Pin this, nothing else. */
export const KERNEL_TRUST_ANCHOR: PublicKeyHex = ${quoted(record.signer)}

/** The signed mapping from {@link KERNEL_NAME} to the CID of the committed \`kernel.wasm\`. */
export const KERNEL_RECORD: NameRecord = {
  name: KERNEL_NAME,
  cid: CID.parse(${quoted(record.cid.toString())}),
  version: ${record.version},
  expiresAt: ${record.expiresAt},
  signer: KERNEL_TRUST_ANCHOR,
  signature: ${quoted(record.signature)},
}
`,
)

console.log(`src/kernel-record.ts  ${kernelBytes.length} bytes signed`)
console.log(`  name                ${KERNEL_NAME}`)
console.log(`  cid                 ${record.cid.toString()}`)
console.log(`  anchor              ${record.signer}`)
console.log(`  expires             ${new Date(expiresAt).toISOString()} (${LIFETIME_DAYS} days)`)
console.log(`  private key         discarded — regenerating produces a new anchor`)
