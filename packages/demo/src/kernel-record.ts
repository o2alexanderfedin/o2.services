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
 * run. The records and the anchor must be committed together or every such process
 * refuses the kernels it ships. That the private half is discarded is what bounds this:
 * the default can accept exactly the three records committed here, and can never be made
 * to accept another.
 *
 * ## Three records, one anchor — and the third is why this file was last regenerated
 *
 * {@link PRIMES_RECORD} was added 2026-08-17, closing the open half of audit finding G4.
 * The prime-counting module had been in the repository and exercised by the Node suite
 * since Phase 26, and nothing vouched for it — so the demo page carried no run control
 * for the one workload whose answer is checkable against an authority this repository did
 * not produce. Adding it meant re-signing all three under a new key, because the private
 * half of the old one was discarded the day it signed.
 */

import type { NameRecord, PublicKeyHex } from '@o2/core'
import { CID } from 'multiformats/cid'

/** The name the demo's module is published under. */
export const KERNEL_NAME: string = 'o2-demo-colouring-kernel'

/** The public half of the key that signed {@link KERNEL_RECORD}. Pin this, nothing else. */
export const KERNEL_TRUST_ANCHOR: PublicKeyHex = '12edd3dd0906d254897517d670471cd6dfdc2bd7622983ba293cddcca51f68f5'

/** The signed mapping from {@link KERNEL_NAME} to the CID of the committed `kernel.wasm`. */
export const KERNEL_RECORD: NameRecord = {
  name: KERNEL_NAME,
  cid: CID.parse('bafyreihyux7jlsrv4sbeyqucghtarabmugo322frpsc5h2ed4ezb3omm5m'),
  version: 1,
  expiresAt: 1821555140787,
  signer: KERNEL_TRUST_ANCHOR,
  signature: '87e44ade72e7a7c9fef2e5d3235568e9c41f596cdf483ae3ffcc55a3ac5c394e6b5de26deb57a728beff93f4ebab11ef79502ffc006fc9f6edf93a2f057db704',
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
  expiresAt: 1821555140787,
  signer: KERNEL_TRUST_ANCHOR,
  signature: '05e7526ac3bc9b929c856bb52ba8ee6e438e512578c57d25dbe5b6a02ce214739c19e6fe44f50e9da6e3247b671050327d8138de65cc91a359f910a8cc8abb0c',
}

/** The name the demo's prime-counting module is published under. */
export const PRIMES_NAME: string = 'o2-demo-primes-kernel'

/**
 * The signed mapping from {@link PRIMES_NAME} to the CID of the committed `primes.wasm`.
 *
 * **Added 2026-08-17; this record is what closed audit finding G4's open half.** The module and
 * its host side shipped in Phase 26 and are exercised by `primes-reduce.node.test.ts`, which
 * agrees with the tabulated π(x) at 10⁴, 10⁵ and 10⁶ over eight shards. What was missing was
 * this: with no record, every executor in the demo fabric — including the submitting tab's own
 * — refused a prime-counting dispatch on provenance, so the surface shipped with no run control
 * and said so on screen.
 *
 * Signed by {@link KERNEL_TRUST_ANCHOR}, the same anchor as the other two, for the same forced
 * reason: both node binaries default to exactly one anchor. `sign-kernel.ts` checks all three
 * signers against the first before writing this file.
 */
export const PRIMES_RECORD: NameRecord = {
  name: PRIMES_NAME,
  cid: CID.parse('bafyreiemqeq2gzqlt7hcqz6euzammd5igyjwjlbjyd7hioxh3uvrgxpaba'),
  version: 1,
  expiresAt: 1821555140787,
  signer: KERNEL_TRUST_ANCHOR,
  signature: '39eec55cfc5e0420dcab5a73bce361ec0a8c010edb880435bc472ad6235c28abad5b0a835379bd5635271cb83ecbbad8bf6ece901c76eb87a7fdce5cf45bd609',
}
