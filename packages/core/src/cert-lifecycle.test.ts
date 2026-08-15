/**
 * Certificate lifecycle — the 19 flows from `cert-lifecycle.facade.test.ts`, ported
 * onto real crypto.
 *
 * Every `it` here has the same name and proves the same claim as its counterpart in
 * the deleted design probe. What changed is what backs it: `PublicIdentity`,
 * `Signature` and `Nonce` are real bytes now, certificates carry a real Ed25519
 * signature the {@link Verifier} actually checks, and a handful of assertions had to
 * be *strengthened* rather than merely re-typed — see the two comments marked
 * "stronger than the probe" below, both cases where the probe's fake made an
 * assertion that cannot fail once ported literally onto real crypto (a proof that
 * cannot fail is not a proof).
 *
 * Runs on `--project node`. Also matches `--project browser` by filename convention
 * (no `.node.` infix) — see `cert-lifecycle.browser.test.ts` for the browser-tier
 * spec this file's bare name additionally exercises across chromium/firefox/webkit.
 */

import { sha256 } from '@noble/hashes/sha2.js'
import { describe, expect, it } from 'vitest'
import { toHex } from './capability.ts'
import {
  type Authority,
  type Certificate,
  type Clock,
  type Csr,
  Directory,
  type IssueResult,
  Issuer,
  Subject,
  Verifier,
  createIssuer,
  createSubject,
  createVerifier,
  deriveKeySeeds,
  signCertificate,
} from './cert-lifecycle.ts'
// The crypto-backend port moved to `./ed25519-backend.ts` in Phase 28, Plan 28-01,
// which merged this package's two Ed25519 selection paths into one. Import-path edit
// only — not one assertion in this file changed.
import { nobleCryptoBackend, subtleCryptoBackend } from './ed25519-backend.ts'

const T0 = 1_000_000
const HOUR = 3_600_000

class TestClock implements Clock {
  constructor(private t: number) {}
  now(): number {
    return this.t
  }
  advance(ms: number): void {
    this.t += ms
  }
}

interface Fabric {
  readonly dir: Directory
  readonly clock: TestClock
  readonly providerSubject: Subject
  readonly providerRoot: Certificate
  readonly issuer: Issuer
  readonly verifier: Verifier
}

async function fabric(lifetimeMs = 2 * HOUR): Promise<Fabric> {
  const dir = new Directory()
  const clock = new TestClock(T0)
  const providerSubject = await createSubject(false)
  const providerKeys = await providerSubject.generate('provider-root-seed')
  const providerRoot = await signCertificate(
    (message) => providerSubject.sign(message),
    {
      subject: providerKeys,
      parent: undefined,
      grant: {
        actions: ['execute', 'read', 'delegate', 'relay', 'issue'],
        resources: ['job/*', 'block/*', 'relay/*'],
      },
      window: { notBefore: T0, notAfter: T0 + 100 * HOUR },
    },
  )
  await dir.publish(providerRoot)
  const issuer = await createIssuer({ dir, clock, own: providerRoot, policy: { lifetimeMs }, signer: providerSubject })
  const verifier = await createVerifier({ dir, clock, anchors: new Set([providerRoot.ref]) })
  return { dir, clock, providerSubject, providerRoot, issuer, verifier }
}

/** A subject asks; the issuer decides. There is no window or grant to hand over. */
const enroll = async (tab: Subject, issuer: Issuer, requested: Authority): Promise<IssueResult> =>
  issuer.issue(await tab.requestCertificate(await issuer.challenge(), requested))

// ─── The flows ───────────────────────────────────────────────────────────────

describe('a browser tab joins the fabric', () => {
  it('generates keys, proves possession, is issued a certificate, and is admitted', async () => {
    const { issuer, verifier } = await fabric()
    const tab = await createSubject(false)
    const keys = await tab.generate('tab-a')

    const issued = await enroll(tab, issuer, { actions: ['execute'], resources: ['job/*'] })
    expect(issued.ok).toBe(true)
    if (!issued.ok) return

    const chain = await verifier.resolve(issued.certificate.ref)
    expect(chain).toBeDefined()
    const verdict = await verifier.validate(chain ?? [], keys)

    expect(verdict.ok).toBe(true)
    expect(await verifier.authorizes(verdict, 'execute', 'job/*')).toBe(true)
  })

  it("refuses a peer presenting somebody else's certificate", async () => {
    // Phase 17 criterion 3 in miniature: the certificate-to-presenter binding, which sat
    // unguarded in this repository for a day because no test observed it.
    const { issuer, verifier } = await fabric()
    const owner = await createSubject(false)
    const thief = await createSubject(false)
    await owner.generate('owner')
    const thiefKeys = await thief.generate('thief')

    const issued = await enroll(owner, issuer, { actions: ['execute'], resources: ['job/*'] })
    if (!issued.ok) throw new Error('setup')

    const verdict = await verifier.validate((await verifier.resolve(issued.certificate.ref)) ?? [], thiefKeys)
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) expect(verdict.reason.kind).toBe('subject-mismatch')
  })

  it('refuses issuance to a public key the requester cannot prove it holds', async () => {
    const { issuer } = await fabric()
    const victim = await createSubject(false)
    const victimKeys = await victim.generate('victim')

    // A legitimate, unconsumed challenge — so this test isolates the PoP-signature
    // check from the nonce-freshness check, which is a different failure mode.
    const challenge = await issuer.challenge()
    const forged: Csr = {
      keys: victimKeys,
      requested: { actions: ['execute'], resources: ['job/*'] },
      challenge,
      proofOfPossession: new Uint8Array(64), // not victim's signature — the attacker doesn't hold the key
    }
    const result = await issuer.issue(forged)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('proof-of-possession-failed')
  })

  it('refuses a chain that does not terminate at a trust anchor', async () => {
    // A self-issued root validates structurally. Only the anchor set stops it.
    const { dir, verifier } = await fabric()
    const rogue = await createSubject(false)
    const keys = await rogue.generate('rogue')
    const rogueRoot = await signCertificate((message) => rogue.sign(message), {
      subject: keys,
      parent: undefined,
      grant: { actions: ['execute', 'relay'], resources: ['job/*', 'relay/*'] },
      window: { notBefore: T0, notAfter: T0 + 99 * HOUR },
    })
    await dir.publish(rogueRoot)

    const verdict = await verifier.validate((await verifier.resolve(rogueRoot.ref)) ?? [], keys)
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) expect(verdict.reason.kind).toBe('untrusted-anchor')
  })
})

describe('authority can only narrow', () => {
  it('grants the intersection of what was asked and what the issuer holds', async () => {
    // The tab asks for relay+issue it was never entitled to; there is no `grant` parameter
    // for the caller to force it through, so the issuer simply intersects.
    const { issuer, verifier } = await fabric()
    const tab = await createSubject(false)
    const keys = await tab.generate('tab-b')

    const issued = await enroll(tab, issuer, {
      actions: ['execute', 'delegate'],
      resources: ['job/*', 'relay/*'],
    })
    if (!issued.ok) throw new Error('setup')

    const verdict = await verifier.validate((await verifier.resolve(issued.certificate.ref)) ?? [], keys)
    expect(await verifier.authorizes(verdict, 'execute', 'job/*')).toBe(true)
    expect(await verifier.authorizes(verdict, 'delegate', 'relay/*')).toBe(true)
    expect(await verifier.authorizes(verdict, 'issue', 'job/*')).toBe(false)
  })

  it('refuses a child that amplifies its parent', async () => {
    const { dir, providerRoot, providerSubject, verifier } = await fabric()

    const midSubject = await createSubject(false)
    const midKeys = await midSubject.generate('mid')
    const mid = await signCertificate((message) => providerSubject.sign(message), {
      subject: midKeys,
      parent: providerRoot.ref,
      grant: { actions: ['execute'], resources: ['job/*'] },
      window: { notBefore: T0, notAfter: T0 + 2 * HOUR },
    })
    await dir.publish(mid)

    const worker = await createSubject(false)
    const workerKeys = await worker.generate('worker')
    // Signed by `mid`'s own key, exactly the way a real sub-issuer would sign a
    // delegation — the amplification is in the GRANT, not in who signed it.
    const workerCert = await signCertificate((message) => midSubject.sign(message), {
      subject: workerKeys,
      parent: mid.ref,
      grant: { actions: ['execute', 'relay'], resources: ['job/*', 'relay/*'] },
      window: { notBefore: T0, notAfter: T0 + 2 * HOUR },
    })
    await dir.publish(workerCert)

    const verdict = await verifier.validate((await verifier.resolve(workerCert.ref)) ?? [], workerKeys)
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) expect(verdict.reason.kind).toBe('not-attenuating')
  })

  it('clips issuer policy to the parent — a cert cannot outlive its issuer', async () => {
    const { issuer, providerRoot } = await fabric(500 * HOUR) // policy far longer than the provider root holds
    const tab = await createSubject(false)
    await tab.generate('tab-c')

    const issued = await enroll(tab, issuer, { actions: ['execute'], resources: ['job/*'] })
    if (!issued.ok) throw new Error('setup')
    expect(issued.certificate.window.notAfter).toBe(providerRoot.window.notAfter)
  })
})

describe('revocation, and the case where it cannot be checked', () => {
  it('refuses a revoked node', async () => {
    const { clock, issuer, verifier } = await fabric()
    const node = await createSubject(true)
    const keys = await node.generate('node-a')
    const issued = await enroll(node, issuer, { actions: ['execute'], resources: ['job/*'] })
    if (!issued.ok) throw new Error('setup')

    clock.advance(HOUR)
    await issuer.revoke(issued.certificate.ref, 'key-compromise')

    const verdict = await verifier.validate((await verifier.resolve(issued.certificate.ref)) ?? [], keys)
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) expect(verdict.reason.kind).toBe('revoked')
  })

  it('reports UNCHECKED rather than silently passing when the directory is unreachable', async () => {
    // The LAN-demo case. The caller, not the verifier, decides fail-open vs fail-closed —
    // and the union makes that decision impossible to skip.
    const { dir, issuer, verifier } = await fabric()
    const node = await createSubject(true)
    const keys = await node.generate('node-b')
    const issued = await enroll(node, issuer, { actions: ['execute'], resources: ['job/*'] })
    if (!issued.ok) throw new Error('setup')

    dir.reachable = false
    const verdict = await verifier.validate((await verifier.resolve(issued.certificate.ref)) ?? [], keys)

    expect(verdict.ok).toBe(true)
    if (!verdict.ok) return
    expect(verdict.revocation.checked).toBe(false)
    const strictGateAdmits = verdict.revocation.checked
    expect(strictGateAdmits).toBe(false)
  })

  it('expires without anyone publishing anything', async () => {
    const { clock, issuer, verifier } = await fabric()
    const node = await createSubject(false)
    const keys = await node.generate('tab-d')
    const issued = await enroll(node, issuer, { actions: ['execute'], resources: ['job/*'] })
    if (!issued.ok) throw new Error('setup')

    clock.advance(3 * HOUR)
    const verdict = await verifier.validate((await verifier.resolve(issued.certificate.ref)) ?? [], keys)
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) expect(verdict.reason.kind).toBe('expired')
  })
})

describe('renewal', () => {
  it('extends the window and carries the grant over unchanged', async () => {
    const { clock, issuer, verifier } = await fabric()
    const node = await createSubject(true)
    const keys = await node.generate('node-r')
    const first = await enroll(node, issuer, { actions: ['execute'], resources: ['job/*'] })
    if (!first.ok) throw new Error('setup')

    clock.advance(HOUR)
    const renewed = await issuer.renew(
      first.certificate.ref,
      await node.requestCertificate(await issuer.challenge(), first.certificate.grant),
    )
    expect(renewed.ok).toBe(true)
    if (!renewed.ok) return
    expect(renewed.certificate.grant).toStrictEqual(first.certificate.grant)
    expect(renewed.certificate.window.notAfter).toBeGreaterThan(first.certificate.window.notAfter)

    clock.advance(2 * HOUR) // past the ORIGINAL expiry — the renewal is what carries it
    const verdict = await verifier.validate((await verifier.resolve(renewed.certificate.ref)) ?? [], keys)
    expect(verdict.ok).toBe(true)
  })

  it('cannot widen authority — the prior grant ships regardless of what is asked', async () => {
    const { issuer } = await fabric()
    const node = await createSubject(true)
    await node.generate('node-s')
    const first = await enroll(node, issuer, { actions: ['execute'], resources: ['job/*'] })
    if (!first.ok) throw new Error('setup')

    const greedy = await node.requestCertificate(await issuer.challenge(), {
      actions: ['execute', 'relay', 'issue'],
      resources: ['job/*', 'relay/*'],
    })
    const renewed = await issuer.renew(first.certificate.ref, greedy)
    expect(renewed.ok).toBe(true)
    if (!renewed.ok) return
    expect(renewed.certificate.grant.actions).toStrictEqual(['execute'])
    expect(renewed.certificate.grant.resources).toStrictEqual(['job/*'])
  })

  it('refuses to renew a revoked certificate', async () => {
    const { issuer } = await fabric()
    const node = await createSubject(true)
    await node.generate('node-t')
    const first = await enroll(node, issuer, { actions: ['execute'], resources: ['job/*'] })
    if (!first.ok) throw new Error('setup')
    await issuer.revoke(first.certificate.ref, 'key-compromise')

    const renewed = await issuer.renew(
      first.certificate.ref,
      await node.requestCertificate(await issuer.challenge(), first.certificate.grant),
    )
    expect(renewed.ok).toBe(false)
    if (!renewed.ok) expect(renewed.reason).toBe('revoked')
  })
})

describe('recovery and multi-device — the flows RFC-0003 §17 defers', () => {
  it('reproduces the same identity after IndexedDB eviction', async () => {
    const tab = await createSubject(false)
    const before = await tab.deriveFromPassphrase('correct horse battery', 'salt:alice')
    tab.evict()
    expect(await tab.load()).toBeUndefined()
    expect(await tab.deriveFromPassphrase('correct horse battery', 'salt:alice')).toStrictEqual(before)
    // 60 s, and the number is sited rather than guessed. These are the only two cases in
    // this file that derive from a passphrase TWICE, i.e. two Argon2id runs each, and
    // Argon2id is memory-hard by design — it contends for exactly the resource a browser
    // suite running three engines over ~290 files is already short of. Measured alone on
    // 2026-08-15: 1 502 ms in the slowest engine, against vitest's 15 000 ms default. That
    // is 10x headroom solo and it was still exceeded inside the full browser run, which is
    // the ordinary way this suite is invoked.
    //
    // This widens a LIVENESS bound and no correctness claim: the assertion is that two
    // derivations of the same passphrase agree, and a slower machine does not make them
    // agree differently. Sibling blocks in this repository already carry explicit 60 000 ms
    // for the same reason — see the `reachability` case recorded in `vitest.config.ts`,
    // where one member of a block left on the default while its siblings carried 60 000 was
    // diagnosed as a missing argument rather than weather.
  }, 60_000)

  it('enrolls a second device with no cross-device ceremony', async () => {
    const laptop = await createSubject(false)
    const phone = await createSubject(false)
    const a = await laptop.deriveFromPassphrase('correct horse battery', 'salt:alice')
    expect(await phone.deriveFromPassphrase('correct horse battery', 'salt:alice')).toStrictEqual(a)
    // See the sibling above: two Argon2id derivations, measured at 1 502 ms alone.
  }, 60_000)

  it('admits it cannot guarantee erasure in a browser', async () => {
    const vault = await createSubject(true)
    const browser = await createSubject(false)
    await vault.generate('v')
    await browser.generate('b')
    expect((await vault.destroy()).erased).toBe('guaranteed')
    expect((await browser.destroy()).erased).toBe('best-effort')
  })
})

describe('the facade never hands out key material', () => {
  it('exposes no secret through any return value', async () => {
    // Sweep every value the facade can return and assert the private scalar seeds
    // never appear — reconstructed independently via `deriveKeySeeds`, the same
    // pure, public function `generate` uses internally, rather than through any
    // backdoor into `Subject`.
    const alice = await createSubject(false)
    const bob = await createSubject(false)
    const a = await alice.generate('alice')
    const b = await bob.generate('bob')
    const { issuer } = await fabric()

    const aliceSeeds = deriveKeySeeds(sha256(new TextEncoder().encode('alice')))
    const secretHexes = [toHex(aliceSeeds.signingSeed), toHex(aliceSeeds.agreementSeed)]

    const handle = await alice.agree(b)
    const sealed = await alice.seal(handle, 'sovereign row')
    const replacer = (_key: string, value: unknown): unknown => (value instanceof Uint8Array ? toHex(value) : value)
    const surface: readonly unknown[] = [
      a,
      b,
      await alice.load(),
      await alice.sign(new TextEncoder().encode('msg')),
      await alice.requestCertificate(await issuer.challenge(), { actions: ['execute'], resources: ['job/*'] }),
      handle,
      await alice.destroy(),
    ]
    for (const value of surface) {
      const json = JSON.stringify(value, replacer) ?? ''
      for (const secretHex of secretHexes) expect(json).not.toContain(secretHex)
    }
    // The handle carries nothing but an opaque counter-derived id.
    expect(JSON.stringify(handle)).toBe('{"id":"handle-1"}')
    // Stronger than the probe: the fake's "sealed" blob readably embedded the
    // plaintext (`sealed(key)[plaintext]`) to prove it was opaque OUTPUT rather than
    // a key. Ported literally that assertion (`.toContain`) would demand exactly the
    // property real encryption exists to prevent. XChaCha20-Poly1305 ciphertext must
    // NOT contain the plaintext — asserting that instead is the honest real-crypto
    // form of "opaque output, not a key".
    expect(sealed).not.toContain('sovereign row')
  })

  it('lets two peers exchange a sealed value without either secret being a value', async () => {
    const owner = await createSubject(false)
    const worker = await createSubject(false)
    const ownerPub = await owner.generate('owner')
    const workerPub = await worker.generate('worker')

    const ownerSide = await owner.agree(workerPub)
    const workerSide = await worker.agree(ownerPub)

    const sealed = await owner.seal(ownerSide, 'the private row')
    expect(await worker.open(workerSide, sealed)).toBe('the private row')
  })

  it('the agreement key is not the signing key', async () => {
    // Ed25519 signs; X25519 agrees. One key cannot safely do both, so a certificate must
    // bind two — which RFC-0003's hierarchy has no concept of.
    //
    // Stronger than the probe: with real `Uint8Array` values, `.not.toBe` (identity)
    // is trivially true for any two distinct array instances regardless of their
    // bytes — a proof that cannot fail is not a proof. `.not.toEqual` compares the
    // actual byte content, which is the claim this test is actually making.
    const s = await createSubject(false)
    const keys = await s.generate('dual')
    expect(keys.agreement).not.toEqual(keys.signing)
  })
})

// ─── Differential: the subtle arm and the noble arm agree ────────────────────
//
// Weighted toward rejection vectors per the phase's definition of done: agreement on
// malformed input is what matters (a divergence there is a cross-engine security
// bug — one arm admitting what the other refuses); happy-path agreement proves only
// that both implement the same signature scheme correctly, which one case suffices
// to establish given Ed25519/X25519 are both deterministic (RFC 8032 / RFC 7748).

describe('differential: the subtle arm and the noble arm agree', () => {
  const noble = nobleCryptoBackend()
  const subtle = subtleCryptoBackend()

  /**
   * NOT asserting byte-identical signatures across arms — measured false on webkit
   * (`cert-lifecycle.browser.test.ts` caught this first; see the module docblock's
   * "Correction made against the browser-tier measurement" note). X25519 has no
   * randomness anywhere in it, so its output IS asserted byte-identical, separately,
   * below. Ed25519 signing only promises mutual verifiability across arms here.
   */
  it('happy path: a signature made on either arm verifies on both arms', async () => {
    const seed = sha256(new TextEncoder().encode('differential-seed'))
    const publicKey = (await import('@noble/curves/ed25519.js')).ed25519.getPublicKey(seed)
    const message = new TextEncoder().encode('agree or diverge')

    const sigFromSubtle = await subtle.signEd25519(seed, message)
    const sigFromNoble = await noble.signEd25519(seed, message)

    expect(await noble.verifyEd25519(publicKey, sigFromNoble, message)).toBe(true)
    expect(await subtle.verifyEd25519(publicKey, sigFromNoble, message)).toBe(true)
    expect(await noble.verifyEd25519(publicKey, sigFromSubtle, message)).toBe(true)
    expect(await subtle.verifyEd25519(publicKey, sigFromSubtle, message)).toBe(true)
  })

  it('a signature verifies identically on both arms', async () => {
    const seed = sha256(new TextEncoder().encode('cross-verify-seed'))
    const publicKey = (await import('@noble/curves/ed25519.js')).ed25519.getPublicKey(seed)
    const message = new TextEncoder().encode('cross-arm verify')
    const signature = await noble.signEd25519(seed, message)

    expect(await noble.verifyEd25519(publicKey, signature, message)).toBe(true)
    expect(await subtle.verifyEd25519(publicKey, signature, message)).toBe(true)
  })

  it('rejects a wrong-length public key identically on both arms', async () => {
    const message = new TextEncoder().encode('m')
    const signature = new Uint8Array(64)
    const tooShortKey = new Uint8Array(31)
    expect(await noble.verifyEd25519(tooShortKey, signature, message)).toBe(false)
    expect(await subtle.verifyEd25519(tooShortKey, signature, message)).toBe(false)
  })

  it('rejects a wrong-length signature identically on both arms', async () => {
    const seed = sha256(new TextEncoder().encode('wrong-length-sig'))
    const publicKey = (await import('@noble/curves/ed25519.js')).ed25519.getPublicKey(seed)
    const message = new TextEncoder().encode('m')
    const tooShortSignature = new Uint8Array(63)
    expect(await noble.verifyEd25519(publicKey, tooShortSignature, message)).toBe(false)
    expect(await subtle.verifyEd25519(publicKey, tooShortSignature, message)).toBe(false)
  })

  it('rejects a bit-flipped signature identically on both arms', async () => {
    const seed = sha256(new TextEncoder().encode('bit-flip-seed'))
    const publicKey = (await import('@noble/curves/ed25519.js')).ed25519.getPublicKey(seed)
    const message = new TextEncoder().encode('do not tamper')
    const signature = await noble.signEd25519(seed, message)
    const tampered = signature.slice()
    tampered[0] = (tampered[0] ?? 0) ^ 0xff

    expect(await noble.verifyEd25519(publicKey, tampered, message)).toBe(false)
    expect(await subtle.verifyEd25519(publicKey, tampered, message)).toBe(false)
  })

  it('rejects a signature checked against the wrong message identically on both arms', async () => {
    const seed = sha256(new TextEncoder().encode('wrong-message-seed'))
    const publicKey = (await import('@noble/curves/ed25519.js')).ed25519.getPublicKey(seed)
    const signed = new TextEncoder().encode('the real message')
    const other = new TextEncoder().encode('a different message')
    const signature = await noble.signEd25519(seed, signed)

    expect(await noble.verifyEd25519(publicKey, signature, other)).toBe(false)
    expect(await subtle.verifyEd25519(publicKey, signature, other)).toBe(false)
  })

  it('rejects a signature checked against the wrong public key identically on both arms', async () => {
    const { ed25519 } = await import('@noble/curves/ed25519.js')
    const seedA = sha256(new TextEncoder().encode('wrong-key-a'))
    const seedB = sha256(new TextEncoder().encode('wrong-key-b'))
    const publicKeyB = ed25519.getPublicKey(seedB)
    const message = new TextEncoder().encode('m')
    const signature = await noble.signEd25519(seedA, message)

    expect(await noble.verifyEd25519(publicKeyB, signature, message)).toBe(false)
    expect(await subtle.verifyEd25519(publicKeyB, signature, message)).toBe(false)
  })

  it('X25519 agreement produces the identical shared secret on both arms', async () => {
    const seedA = sha256(new TextEncoder().encode('x25519-a'))
    const seedB = sha256(new TextEncoder().encode('x25519-b'))
    const { x25519 } = await import('@noble/curves/ed25519.js')
    const publicB = x25519.getPublicKey(seedB)

    const sharedFromNoble = await noble.agreeX25519(seedA, publicB)
    const sharedFromSubtle = await subtle.agreeX25519(seedA, publicB)
    expect(toHex(sharedFromNoble)).toBe(toHex(sharedFromSubtle))
  })

  it('X25519 agreement refuses a known low-order peer key identically on both arms', async () => {
    // The all-zero point is a well-known X25519 low-order point. Both arms must
    // refuse it rather than one silently returning a degenerate shared secret.
    const seed = sha256(new TextEncoder().encode('x25519-low-order'))
    const lowOrderPeer = new Uint8Array(32)

    let nobleThrew = false
    try {
      await noble.agreeX25519(seed, lowOrderPeer)
    } catch {
      nobleThrew = true
    }
    let subtleThrew = false
    try {
      await subtle.agreeX25519(seed, lowOrderPeer)
    } catch {
      subtleThrew = true
    }
    expect(nobleThrew).toBe(true)
    expect(subtleThrew).toBe(true)
  })
})
