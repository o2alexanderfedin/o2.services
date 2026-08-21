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
 * Every run generates **two** new ed25519 keys — a root and a signing key — and discards both
 * private halves the moment they have signed. There is no way to re-sign later. Regenerating
 * therefore means a new root, a new delegation, a new anchor and three new records, all
 * committed together in one change.
 *
 * **Two keys rather than one, since task #4 half 2.** The root signs a
 * `NameDelegation` naming the signing key; the signing key signs the three records; the anchor
 * names the ROOT. The reason is that a publishing key and a pinned key want opposite things —
 * one wants to be online and rotatable, the other wants to be neither — and while they were the
 * same key, "rotate the signer" meant "re-pin every consumer". It no longer does.
 *
 * In this script both halves are still ephemeral, so the demo tier's guarantee is exactly what
 * it was; what the split buys **here** is that the delegated path is exercised on every build
 * instead of lying dormant. The ceremony that puts a genuinely offline root behind it is written
 * out step by step at {@link rootKey}, and it supplies a value, not a capability — nothing in
 * `naming.ts` changes when a real root replaces this one.
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
import { MemoryBlockstore, signName, signNameDelegation, SignedNameResolver, toHex } from '@o2/core'
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { kernelBytes } from '../src/kernel.ts'
import { piKernelBytes } from '../src/pi.ts'
import { primesKernelBytes } from '../src/primes.ts'

const SRC = fileURLToPath(new URL('../src/', import.meta.url))

/** The name the demo resolves. One artifact, one name. */
const KERNEL_NAME = 'o2-demo-colouring-kernel'

/**
 * The second artifact's name — added 2026-08-08 by owner ruling, audit findings G3/G4.
 *
 * **Both records are signed by ONE key, and that is forced rather than chosen.**
 * `bin/agent.ts` and `bin/seed.ts` each default to a single `KERNEL_TRUST_ANCHOR`, so a pi
 * record signed by a second key would be refused by every stock node. One key, one anchor,
 * two records, committed together.
 */
const PI_NAME = 'o2-demo-pi-kernel'

/**
 * The third artifact's name — added 2026-08-17 by owner ruling, closing audit finding G4.
 *
 * **This is the record whose absence was G4's open half.** `primes.wasm` and its host side have
 * been in the repository and exercised by `primes-reduce.node.test.ts` since Phase 26 — the
 * workload agrees with the tabulated π(x) at 10⁴, 10⁵ and 10⁶ over eight shards — but nothing
 * vouched for the module, so every executor in the demo fabric refused a prime-counting
 * dispatch on provenance and the surface carried no run control. Signing it here is what gives
 * the workload a path from a browser tab.
 *
 * **Why it matters more than a third button.** The colouring result is checked by a verifier
 * this repository also wrote, so a misconception held in both is invisible to the pair. π(x)
 * was tabulated in the mathematical literature long before this project. It is the one oracle
 * on the page whose authority does not come from here, and until now it had nothing to check.
 *
 * Same key as the other two, forced by the same constraint: one default anchor per node.
 */
const PRIMES_NAME = 'o2-demo-primes-kernel'

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
// The same code path for the second artifact, for the same reason: the CID a runtime
// compares against is the one `store.put()` produces, and a second scheme here would drift.
const piCid = await new MemoryBlockstore().put(piKernelBytes)
// And the third, through the same path for the third time. `runPrimes` in `demo/main.ts`
// compares its own `store.put(primesKernelBytes)` against the record this produces and
// refuses with a named error if they differ, so a rebuild that skipped this script is
// reported rather than discovered as a provenance refusal at dispatch.
const primesCid = await new MemoryBlockstore().put(primesKernelBytes)

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

/**
 * One key, two records — and the property this weakens is stated rather than left to be noticed.
 *
 * **This binding used to not exist.** The key was generated inside the `signName(...)` call so
 * that no name in this file could reach the private half. Signing a second artifact under the
 * same anchor makes that impossible: the key must outlive one call to reach the next.
 *
 * What is unchanged, and it is the part that matters: **the private half is never written
 * anywhere.** It lives in this module scope for two statements and dies with the process. There
 * is still no way to re-sign later, so regenerating still means a new key, a new anchor and both
 * records replaced together.
 *
 * What is genuinely lost: a reader could previously see at a glance that no binding held the
 * secret. Now they have to read two lines to confirm it. That is the cost of the second artifact
 * and it is smaller than the alternative, which was a second anchor no stock node would pin.
 */
const signingKey = ed25519.utils.randomSecretKey()

/**
 * The root — task #4, half 2. **This is the key the anchor now names, and it is NOT the key
 * that signs the records.**
 *
 * ## What changed and why it was worth changing
 *
 * Until now the signing key WAS the anchor: `KERNEL_TRUST_ANCHOR` was the public half of the
 * key three lines up, so the key that had to be present at every publish was also the key
 * every consumer pinned. Those two roles have opposite requirements — a publishing key wants
 * to be online and rotatable, a pinned key wants to be neither — and collapsing them is what
 * made "regenerate" mean "re-pin every consumer".
 *
 * Now the root signs one short statement naming the signing key, and the signing key signs the
 * artifacts. The anchor names the root. Rotating the signing key needs a new delegation and no
 * change to any pinned anchor.
 *
 * ## In THIS script the root is still ephemeral, and that is a real limit, stated
 *
 * Both halves are generated per run and both are discarded, exactly as before, so the demo
 * tier's guarantee is unchanged: the anchor and the artifacts ship in one bundle from one
 * origin, and it proves nothing to anyone who does not already trust this repository. What the
 * delegation buys HERE is that the mechanism is exercised on every build rather than sitting
 * dormant waiting for a ceremony — `SignedNameResolver.accept` walks the delegated path for
 * all three demo records, so a defect in it fails the demo rather than hiding until the day
 * the real root exists.
 *
 * ## The ceremony that makes it mean something, for whoever performs it
 *
 * The code side is finished and takes a VALUE, not a capability. To put a genuinely offline
 * root behind this, on a machine that is not this one:
 *
 *   1. `node -e "const{ed25519}=require('@noble/curves/ed25519.js');const k=ed25519.utils.randomSecretKey();
 *      console.log('secret',Buffer.from(k).toString('hex'));
 *      console.log('public',Buffer.from(ed25519.getPublicKey(k)).toString('hex'))"`
 *   2. Keep `secret` off every networked machine. It is never needed again except to issue
 *      the next delegation.
 *   3. Per publish, on the offline machine, sign a delegation to that run's signing public
 *      half with {@link signNameDelegation} and carry back the four fields it returns.
 *   4. Replace {@link rootKey} here with "read the delegation from disk", and pin the root's
 *      public half as `KERNEL_TRUST_ANCHOR`.
 *
 * Nothing in `naming.ts` changes for that. The verifier already cannot tell an offline root
 * from this one, which is the point: it checks a signature, not a provenance story.
 */
const rootKey = ed25519.utils.randomSecretKey()

/**
 * The delegation the three records travel under.
 *
 * **Expires exactly when the records do, not later.** `SignedNameResolver.accept` refuses a
 * record that would outlive its delegation, so the two clocks must agree or nothing verifies —
 * and picking the tightest legal value rather than a longer one means a compromised signing
 * key cannot mint anything that survives the artifacts it was issued for.
 */
const delegation = signNameDelegation(rootKey, {
  delegate: toHex(ed25519.getPublicKey(signingKey)),
  expiresAt,
})

const record = signName(signingKey, {
  name: KERNEL_NAME,
  cid,
  version: 1,
  expiresAt,
  delegation,
})
const piRecord = signName(signingKey, {
  name: PI_NAME,
  cid: piCid,
  version: 1,
  expiresAt,
  delegation,
})
const primesRecord = signName(signingKey, {
  name: PRIMES_NAME,
  cid: primesCid,
  version: 1,
  expiresAt,
  delegation,
})

// Every record, against the first — not pairwise-adjacent, which would let a third key slip
// past a chain of equal neighbours. One anchor is what both node binaries default to, so
// "they all share it" is the property, and it is checked as such.
for (const [label, candidate] of [
  ['pi', piRecord],
  ['primes', primesRecord],
] as const) {
  if (candidate.signer !== record.signer) {
    throw new Error(`the ${label} record disagrees on its signer — all three must share one anchor`)
  }
  // Reference equality, NOT a signature comparison — CRYPTO-06 caught the first version of
  // this line and was right to. Signature bytes are not an identifier: comparing them to decide
  // "is this the same delegation" teaches the pattern that a signature names a thing, when what
  // it does is attest to one. All three records are built from the one `delegation` binding
  // above, so identity is the property actually being asserted, and it is stricter besides —
  // a structurally-equal copy would be a second delegation and should fail this.
  if (candidate.delegation !== delegation) {
    throw new Error(`the ${label} record carries a different delegation — all three must share one`)
  }
}

// The chain, checked here rather than trusted, because everything below this line is string
// interpolation and a mismatch would be discovered as a provenance refusal in a browser tab
// instead of as an error in the script that caused it. Three facts, each one a way the emitted
// file could be internally consistent and still wrong.
const rootPublic = toHex(ed25519.getPublicKey(rootKey))
if (delegation.root !== rootPublic) {
  throw new Error('the delegation names a root that is not this run’s root key')
}
if (delegation.delegate !== record.signer) {
  throw new Error('the delegation authorises a key that did not sign the records')
}
if (record.expiresAt > delegation.expiresAt) {
  throw new Error('the records outlive their delegation — SignedNameResolver would refuse them')
}

// And the whole thing verified end to end, through the REAL verifier, before a byte is written.
// A generator that emits records its own consumer refuses is the failure this script exists to
// prevent, and the only check that cannot drift from `accept` is calling `accept`.
{
  const resolver = new SignedNameResolver([rootPublic])
  for (const [label, candidate] of [
    ['colouring', record],
    ['pi', piRecord],
    ['primes', primesRecord],
  ] as const) {
    const accepted = resolver.accept(candidate, Date.now())
    if (!accepted.ok) {
      throw new Error(`the ${label} record does not verify under the emitted anchor: ${accepted.reason}`)
    }
  }
}

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
export const KERNEL_NAME: string = ${quoted(KERNEL_NAME)}

/**
 * The public half of the ROOT key. Pin this, nothing else.
 *
 * **This is no longer the key that signed the records** — task #4, half 2. It is the key that
 * signed {@link KERNEL_DELEGATION}, which in turn authorises the key that signed them. Pinning
 * the root rather than the signer is what lets a signing key rotate without re-pinning every
 * consumer, and what lets a real root's private half stay on a machine that never publishes.
 */
export const KERNEL_TRUST_ANCHOR: PublicKeyHex = ${quoted(rootPublic)}

/**
 * The one-link chain from {@link KERNEL_TRUST_ANCHOR} to the key that signed all three records.
 *
 * \`SignedNameResolver.accept\` verifies this before it verifies any record: the delegate must
 * be the record's signer, the root must be a pinned anchor, this signature must hold, the
 * delegation must be unexpired, and no record may outlive it. All five are checked on every
 * accept, and this file is written only after the real verifier accepted all three records
 * under exactly this anchor.
 */
export const KERNEL_DELEGATION: NameDelegation = {
  root: KERNEL_TRUST_ANCHOR,
  delegate: ${quoted(delegation.delegate)},
  expiresAt: ${delegation.expiresAt},
  signature: ${quoted(delegation.signature)},
}

/** The signed mapping from {@link KERNEL_NAME} to the CID of the committed \`kernel.wasm\`. */
export const KERNEL_RECORD: NameRecord = {
  name: KERNEL_NAME,
  cid: CID.parse(${quoted(record.cid.toString())}),
  version: ${record.version},
  expiresAt: ${record.expiresAt},
  signer: KERNEL_DELEGATION.delegate,
  delegation: KERNEL_DELEGATION,
  signature: ${quoted(record.signature)},
}

/** The name the demo's pi-estimating module is published under. */
export const PI_NAME: string = ${quoted(PI_NAME)}

/**
 * The signed mapping from {@link PI_NAME} to the CID of the committed \`pi.wasm\`.
 *
 * **Signed under {@link KERNEL_DELEGATION}, the same delegation as {@link KERNEL_RECORD}**,
 * because both node binaries default to exactly one anchor and a record whose chain led
 * anywhere else would be refused by every stock node. \`sign-kernel.ts\` asserts that all three
 * records share one signer AND one delegation before writing this file.
 */
export const PI_RECORD: NameRecord = {
  name: PI_NAME,
  cid: CID.parse(${quoted(piRecord.cid.toString())}),
  version: ${piRecord.version},
  expiresAt: ${piRecord.expiresAt},
  signer: KERNEL_DELEGATION.delegate,
  delegation: KERNEL_DELEGATION,
  signature: ${quoted(piRecord.signature)},
}

/** The name the demo's prime-counting module is published under. */
export const PRIMES_NAME: string = ${quoted(PRIMES_NAME)}

/**
 * The signed mapping from {@link PRIMES_NAME} to the CID of the committed \`primes.wasm\`.
 *
 * **Added 2026-08-17; this record is what closed audit finding G4's open half.** The module and
 * its host side shipped in Phase 26 and are exercised by \`primes-reduce.node.test.ts\`, which
 * agrees with the tabulated π(x) at 10⁴, 10⁵ and 10⁶ over eight shards. What was missing was
 * this: with no record, every executor in the demo fabric — including the submitting tab's own
 * — refused a prime-counting dispatch on provenance, so the surface shipped with no run control
 * and said so on screen.
 *
 * Signed under {@link KERNEL_DELEGATION}, the same delegation as the other two, for the same
 * forced reason: both node binaries default to exactly one anchor. \`sign-kernel.ts\` checks all
 * three signers and all three delegations against the first before writing this file.
 */
export const PRIMES_RECORD: NameRecord = {
  name: PRIMES_NAME,
  cid: CID.parse(${quoted(primesRecord.cid.toString())}),
  version: ${primesRecord.version},
  expiresAt: ${primesRecord.expiresAt},
  signer: KERNEL_DELEGATION.delegate,
  delegation: KERNEL_DELEGATION,
  signature: ${quoted(primesRecord.signature)},
}
`,
)

console.log(`src/kernel-record.ts  ${kernelBytes.length} bytes signed`)
console.log(`  name                ${KERNEL_NAME}`)
console.log(`  cid                 ${record.cid.toString()}`)
console.log(`  anchor (root)       ${rootPublic}`)
console.log(`  signer (delegate)   ${record.signer}`)
console.log(`  delegation expires  ${new Date(delegation.expiresAt).toISOString()}`)
console.log(`  expires             ${new Date(expiresAt).toISOString()} (${LIFETIME_DAYS} days)`)
console.log(`src/kernel-record.ts  ${piKernelBytes.length} bytes signed (pi)`)
console.log(`  name                ${PI_NAME}`)
console.log(`  cid                 ${piRecord.cid.toString()}`)
console.log(`  signer (delegate)   ${piRecord.signer}  (shared — asserted equal above)`)
console.log(`src/kernel-record.ts  ${primesKernelBytes.length} bytes signed (primes)`)
console.log(`  name                ${PRIMES_NAME}`)
console.log(`  cid                 ${primesRecord.cid.toString()}`)
console.log(`  signer (delegate)   ${primesRecord.signer}  (shared — asserted equal above)`)
console.log(`  private keys        root AND delegate discarded — regenerating replaces ALL THREE`)
