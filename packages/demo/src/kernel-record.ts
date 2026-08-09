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
export const KERNEL_TRUST_ANCHOR: PublicKeyHex = '3ac7f97fa636fbacbfa8e00aa466f191e4335cd1ef5f19477e2c26587d64a6e5'

/** The signed mapping from {@link KERNEL_NAME} to the CID of the committed `kernel.wasm`. */
export const KERNEL_RECORD: NameRecord = {
  name: KERNEL_NAME,
  cid: CID.parse('bafyreihyux7jlsrv4sbeyqucghtarabmugo322frpsc5h2ed4ezb3omm5m'),
  version: 1,
  expiresAt: 1820787234025,
  signer: KERNEL_TRUST_ANCHOR,
  signature: 'afd956f2ccf5e57bf1ce0273064f8633feb1178d0abb29b8e5d7a5c670692b91b03ee92ba060acbe001a64b90426f3175fc8cb3422c7ddc2020232e357e1040c',
}

/** The name the demo's pi-estimating module is published under. */
export const PI_NAME: string = 'o2-demo-pi-kernel'

/**
 * The signed mapping from {@link PI_NAME} to the CID of the committed `pi.wasm`.
 *
 * **Signed by {@link KERNEL_TRUST_ANCHOR}, the same anchor as {@link KERNEL_RECORD}**, because
 * both node binaries default to exactly one anchor and a second key would be refused by every
 * stock node. `sign-kernel.ts` asserts the two signers match before writing this file.
 */
export const PI_RECORD: NameRecord = {
  name: PI_NAME,
  cid: CID.parse('bafyreig6lnlp4lpsj62grhjmljdzjrgyuawaa6pb2gkivuhwldqrrmisga'),
  version: 1,
  expiresAt: 1820787234025,
  signer: KERNEL_TRUST_ANCHOR,
  signature: '27443297576ec78757ecb651fc7133e9c09942fc2c6bc747ce86efbc19ccef508b507c251cccb477ca769c6aed93db61cd8ef518fad290c2df4c30c87cb3c408',
}
