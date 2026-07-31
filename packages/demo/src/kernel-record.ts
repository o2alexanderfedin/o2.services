/**
 * GENERATED — do not edit. Run `npm run sign:kernel --workspace @o2/demo` to regenerate.
 *
 * The demo tier's signed `name -> CID` mapping for `kernel.wasm`, and the public half
 * of the key that signed it. `guardModuleProvenance` (`@o2/core`) refuses to execute a
 * module that arrived without a record some pinned anchor vouches for; this is that
 * record, and {@link KERNEL_TRUST_ANCHOR} is that anchor.
 *
 * The CID is written as a literal and reconstructed with `CID.parse` so this file holds
 * no binary and stays readable in a diff. `kernel-build.node.test.ts` recomputes it from
 * the committed `kernel.wasm` on disk and requires the two to agree, so the literal is
 * checked rather than trusted.
 *
 * ## Key handling
 *
 * `sign-kernel.ts` generates a new ed25519 key on every run and discards the private
 * half immediately, so this record can never be re-signed. Regenerating means a new
 * key, a new anchor and a new record — committed together, in one change, or the demo
 * refuses its own kernel.
 *
 * The anchor and the artifact it vouches for ship in the same bundle. That is what the
 * guarantee rests on and also its exact limit: a peer cannot make this tab run a module
 * the repository did not ship, and equally, none of this proves anything to somebody
 * who does not already trust the repository. The production build authority is a
 * separate key held outside version control and supplied per node via
 * `--trust-anchor`; this is not that key.
 *
 * ## Reach — check before regenerating
 *
 * **Both node binaries default to {@link KERNEL_TRUST_ANCHOR}.** `bin/agent.ts` and
 * `bin/seed.ts` each read `values['trust-anchor'] ?? [KERNEL_TRUST_ANCHOR]`, so
 * regenerating this file changes what a stock `o2 agent` and a stock `o2 seed` will
 * run. The record and the anchor must be committed together or every such process
 * refuses the kernel it ships. That the private half is discarded is what bounds this:
 * the default can accept exactly the one record committed here, and can never be made
 * to accept another.
 */

import type { NameRecord, PublicKeyHex } from '@o2/core'
import { CID } from 'multiformats/cid'

/** The name the demo's module is published under. */
export const KERNEL_NAME: string = 'o2-demo-colouring-kernel'

/** The public half of the key that signed {@link KERNEL_RECORD}. Pin this, nothing else. */
export const KERNEL_TRUST_ANCHOR: PublicKeyHex = '769c7b0d9c10ceaf172ddb99d24ee37d65e7dbdac129641eabbf4c1aead3c729'

/** The signed mapping from {@link KERNEL_NAME} to the CID of the committed `kernel.wasm`. */
export const KERNEL_RECORD: NameRecord = {
  name: KERNEL_NAME,
  cid: CID.parse('bafyreihyux7jlsrv4sbeyqucghtarabmugo322frpsc5h2ed4ezb3omm5m'),
  version: 1,
  expiresAt: 1820090841471,
  signer: KERNEL_TRUST_ANCHOR,
  signature: '1cfeccd29988f1bb74b5d85e4adb6d5cdc0b2035495da665e1989bad9abefe9a270623521e23766fe4445a4e6de1417172987798c3fa01b08be5e773b3dd3b02',
}
