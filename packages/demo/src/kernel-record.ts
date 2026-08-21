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

import type { NameDelegation, NameRecord, PublicKeyHex } from '@o2/core'
import { CID } from 'multiformats/cid'

/** The name the demo's module is published under. */
export const KERNEL_NAME: string = 'o2-demo-colouring-kernel'

/**
 * The public half of the ROOT key. Pin this, nothing else.
 *
 * **This is no longer the key that signed the records** — task #4, half 2. It is the key that
 * signed {@link KERNEL_DELEGATION}, which in turn authorises the key that signed them. Pinning
 * the root rather than the signer is what lets a signing key rotate without re-pinning every
 * consumer, and what lets a real root's private half stay on a machine that never publishes.
 */
export const KERNEL_TRUST_ANCHOR: PublicKeyHex = '62ff44ea6cf64560f6754f189a3bea34190cf6ae7ab7847fb7a81f45ae71b76d'

/**
 * The one-link chain from {@link KERNEL_TRUST_ANCHOR} to the key that signed all three records.
 *
 * `SignedNameResolver.accept` verifies this before it verifies any record: the delegate must
 * be the record's signer, the root must be a pinned anchor, this signature must hold, the
 * delegation must be unexpired, and no record may outlive it. All five are checked on every
 * accept, and this file is written only after the real verifier accepted all three records
 * under exactly this anchor.
 */
export const KERNEL_DELEGATION: NameDelegation = {
  root: KERNEL_TRUST_ANCHOR,
  delegate: 'fd8263d4be5e0ebc8b287362211d6609a96e44ab2a784dca60689d7d15b05d14',
  expiresAt: 1821869658638,
  signature: '2ed65c6d43322969858c8c3e269fb85a9def9a2dc2834e5d993c481a695e840b4122377a1d748bf5750150bec0fdd43b4df9c4dcb8a68ff47efc41117139220c',
}

/** The signed mapping from {@link KERNEL_NAME} to the CID of the committed `kernel.wasm`. */
export const KERNEL_RECORD: NameRecord = {
  name: KERNEL_NAME,
  cid: CID.parse('bafyreihyux7jlsrv4sbeyqucghtarabmugo322frpsc5h2ed4ezb3omm5m'),
  version: 1,
  expiresAt: 1821869658638,
  signer: KERNEL_DELEGATION.delegate,
  delegation: KERNEL_DELEGATION,
  signature: 'e713f816b3a1ef9a48f744113d4cc0524c8fa1610b20d2e02addcd3198e5a52c80b67eba296a5d732e88e452e2c8b6935ff64d4a66d556450889dfc1eca3fa04',
}

/** The name the demo's pi-estimating module is published under. */
export const PI_NAME: string = 'o2-demo-pi-kernel'

/**
 * The signed mapping from {@link PI_NAME} to the CID of the committed `pi.wasm`.
 *
 * **Signed under {@link KERNEL_DELEGATION}, the same delegation as {@link KERNEL_RECORD}**,
 * because both node binaries default to exactly one anchor and a record whose chain led
 * anywhere else would be refused by every stock node. `sign-kernel.ts` asserts that all three
 * records share one signer AND one delegation before writing this file.
 */
export const PI_RECORD: NameRecord = {
  name: PI_NAME,
  cid: CID.parse('bafyreig6lnlp4lpsj62grhjmljdzjrgyuawaa6pb2gkivuhwldqrrmisga'),
  version: 1,
  expiresAt: 1821869658638,
  signer: KERNEL_DELEGATION.delegate,
  delegation: KERNEL_DELEGATION,
  signature: 'cb26aa53a9b7ab195d5804fab35f8e2b9c7b00f4d566894a30e920929a19b83f9f2cd0c31e06605f8b8b8c78c11257db2e878f277ff4d3979855e89036a6a905',
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
 * Signed under {@link KERNEL_DELEGATION}, the same delegation as the other two, for the same
 * forced reason: both node binaries default to exactly one anchor. `sign-kernel.ts` checks all
 * three signers and all three delegations against the first before writing this file.
 */
export const PRIMES_RECORD: NameRecord = {
  name: PRIMES_NAME,
  cid: CID.parse('bafyreiemqeq2gzqlt7hcqz6euzammd5igyjwjlbjyd7hioxh3uvrgxpaba'),
  version: 1,
  expiresAt: 1821869658638,
  signer: KERNEL_DELEGATION.delegate,
  delegation: KERNEL_DELEGATION,
  signature: 'b67f9e41ac0aba71faa6ed271f29685d64f3bd7d67c39174f8a176ee002a8cfaa38f755bf58f2663888b0bcea1e13ef32c5800b0c504b91ac8a9479afbd51d08',
}
