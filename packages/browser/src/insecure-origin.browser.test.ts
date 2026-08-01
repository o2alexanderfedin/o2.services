/**
 * Identity, signing and certificate verification survive a missing `crypto.subtle` —
 * AUTH-01, the branch 17-01 recorded as unmeasured.
 *
 * ## The failure this is here to catch
 *
 * A LAN origin — `http://10.144.82.249:5173`, the address a second machine reaches the
 * demo on — is **not a secure context**, so `crypto.subtle` is `undefined` there while
 * `crypto.getRandomValues` still works. This has already broken this repository once, in
 * a way no import-scanning test could see: every CID silently changed. `identity.ts` says
 * so in its own words and then says the branch is *"**unmeasured** — both vitest projects
 * run on a secure origin, so it is never taken anywhere in this repository."*
 *
 * This file takes it, by removing `subtle` rather than by finding an origin without one.
 *
 * ## What that does and does not prove
 *
 * **Does:** none of `generateSeed`, `identityFromSeed`, `requestEnrollment`,
 * `EnrollmentAuthority.enrol` or `verifyCertificate` *calls* `crypto.subtle`. Every one
 * of them would throw `Cannot read properties of undefined` if it did, so a green run is
 * a reading of the actual call graph and not of the import list.
 *
 * **Does not:** reproduce an insecure context. A real one differs in more than this
 * property, and — the specific gap worth naming — `@libp2p/crypto`'s browser entry
 * evaluates `crypto.get().subtle.generateKey({name:'Ed25519'}, …)` **at module load**,
 * inside a `try/catch`, to memoise whether WebCrypto can sign Ed25519. That evaluation
 * has already happened by the time any test body runs, so on a genuinely insecure origin
 * it would memoise `false` where here it memoised `true`. The direction of that
 * difference is the safe one: `false` routes to noble, which is the path this file proves
 * works. A run that memoised `false` cannot do *less* than one that memoised `true` and
 * then found `subtle` missing.
 *
 * Closing that last gap needs a vitest browser instance served over plain HTTP from a
 * non-loopback address, which is a harness change rather than a test, and is recorded as
 * such rather than claimed here.
 */

import { describe, expect, it } from 'vitest'
import { EnrollmentAuthority, requestEnrollment, verifyCertificate } from '@o2/core'
import { generateSeed, identityFromSeed, peerIdForNodeKey } from '@o2/libp2p'
import { ed25519 } from '@noble/curves/ed25519.js'

/**
 * Run `body` with `crypto.subtle` absent, and put it back however `body` ends.
 *
 * Defined as an **own property** shadowing the prototype getter rather than deleted:
 * `subtle` lives on `Crypto.prototype` as an accessor, so `delete crypto.subtle` removes
 * nothing and would leave this file measuring a secure context while claiming otherwise.
 * The restore deletes the shadow, which uncovers the original getter.
 */
async function withoutSubtle<T>(body: () => Promise<T>): Promise<T> {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis.crypto, 'subtle')
  Object.defineProperty(globalThis.crypto, 'subtle', {
    value: undefined,
    configurable: true,
    writable: true,
  })
  try {
    return await body()
  } finally {
    if (descriptor === undefined) {
      // No own property existed; removing the shadow uncovers `Crypto.prototype.subtle`.
      Reflect.deleteProperty(globalThis.crypto, 'subtle')
    } else {
      Object.defineProperty(globalThis.crypto, 'subtle', descriptor)
    }
  }
}

const OPERATOR_ID = 'insecure-origin-operator'

describe('AUTH-01 — the identity path on an origin with no WebCrypto', () => {
  it('is measuring what it claims: `subtle` is genuinely gone inside the helper, and back after', async () => {
    // Without this, every assertion below would be satisfied by a helper that failed to
    // remove anything — which is exactly what `delete crypto.subtle` does.
    expect(globalThis.crypto.subtle).toBeDefined()
    await withoutSubtle(async () => {
      expect(globalThis.crypto.subtle).toBeUndefined()
    })
    expect(globalThis.crypto.subtle).toBeDefined()
  })

  it('generates a seed, derives a peer id from it, and the two namespaces agree', async () => {
    const { seed, identity } = await withoutSubtle(async () => {
      const seed = generateSeed()
      return { seed, identity: await identityFromSeed(seed) }
    })

    expect(seed).toHaveLength(32)
    // The bridge between the transport's namespace and the certificate's, computed with
    // no WebCrypto anywhere in the call.
    expect(peerIdForNodeKey(identity.nodeKey)).toBe(identity.peerId)
  })

  it('enrols end to end — the node signs, the user signs, the provider signs, and the certificate verifies', async () => {
    const nodeSeed = generateSeed()
    const userPrivateKey = generateSeed()
    const providerPrivateKey = generateSeed()
    const authority = new EnrollmentAuthority({ providerPrivateKey })

    const outcome = await withoutSubtle(async () => {
      // Signing twice — the node over its own possession challenge, the user over the
      // `ownerProof` that `enrol` refuses by name without.
      const request = requestEnrollment(nodeSeed, userPrivateKey, {
        operatorId: OPERATOR_ID,
        discoverability: 'via-relay',
        relayIds: ['12D3KooWinsecureOriginRelayPlaceholder'],
      })
      return authority.enrol(request, Date.now())
    })

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) throw new Error('unreachable — asserted above')

    // And verification, which is the third distinct signature operation and the one a
    // peer performs on every dial.
    const verdict = await withoutSubtle(async () =>
      verifyCertificate(outcome.certificate, new Set([authority.issuerKey]), Date.now()),
    )
    expect(verdict.ok).toBe(true)

    // The certificate names the node whose seed signed for it, derived offline.
    expect(outcome.certificate.nodeKey).toBe(
      (await identityFromSeed(nodeSeed)).nodeKey,
    )
    expect(outcome.certificate.userKey).toBe(toHexPublic(userPrivateKey))
  })
})

/** The user's public half, spelled the way `requestEnrollment` derives it. */
function toHexPublic(privateKey: Uint8Array): string {
  return [...ed25519.getPublicKey(privateKey)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}
