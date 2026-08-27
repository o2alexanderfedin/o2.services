# Open question 1, settled by measurement — `diffieHellman`, wrangler `alias`, and a question that was the wrong question

**Date:** 2026-08-25
**Settles:** `.planning/REQUIREMENTS.md` v2.0 open question 1; `.planning/ROADMAP.md` Phase 29 "Research" note
**Method:** two investigators working the same question in parallel without coordinating — one
answering it, one briefed to find how the first would be wrong. They converged, and the
adversary's route closed a gap the first one had stated as open.

**Nothing was deployed.** Every build ran `--dry-run`; the one runtime check ran
`wrangler dev --local`, never `--remote`. No Durable Object, KV namespace or other remote
resource was created. The project tree was not modified by either investigator.

---

## 1. The question as the roadmap asked it

> Can wrangler's `alias` redirect one deep file inside `@chainsafe/libp2p-noise@17.0.0`, or
> whole packages only?

It was scoped as the fix for the `diffieHellman` gap: workerd does not implement
`node:crypto`'s `diffieHellman`, and the noise package calls it.

## 2. The answer, in three parts, in the order a planner needs them

### 2.1 The question is moot — the fix is zero configuration lines

Wrangler's default resolution already honours the noise package's legacy top-level `browser`
field and bundles `index.browser.ts`. `diffieHellman` never enters the bundle. This holds
**with and without `nodejs_compat`**, and on both wrangler versions tested.

Read from the installed package rather than from documentation:

- the call site is `node_modules/@chainsafe/libp2p-noise/dist/src/crypto/index.js:170`
  (`crypto.diffieHellman({`), source `src/crypto/index.ts:203`
- it is reached from `dist/src/noise.js:7` — `import { defaultCrypto } from './crypto/index.js'`,
  a **relative** specifier, which turns out to be the crux of part 2.2
- `package.json` carries `"browser": { "./dist/src/crypto/index.js": "./dist/src/crypto/index.browser.js" }`
- `index.browser.js` is two lines: `import { pureJsCrypto } from './js.js'; export const defaultCrypto = pureJsCrypto`
- **`"exports"` has no `browser` condition** — only `types`/`import`. So the mapping is the
  legacy top-level field, and no conditions value could select it even if one existed.

**Causation, not correlation.** Both investigators established this the same way and
independently: take a *private scratch copy* of the package, delete the `browser` field, rebuild.
The build flips to the Node path — `diffieHellman` and `node:crypto` appear in the bundle and it
grows from ~399 KiB to ~530 KiB. That distinguishes "the `browser` field is doing the work" from
"the code happened to be tree-shaken out", which is the failure mode a green build otherwise
hides.

Corroborated a second way, by reading the emitted sourcemap's `sources` array rather than
grepping text: the baseline lists `crypto/index.browser.ts`, and the Node `crypto/index.ts` is
absent entirely.

### 2.2 The literal question: deep aliasing works, but only by the specifier string as written

`alias` is esbuild's `alias` — wrangler's own config schema says so — and it matches **the
specifier string exactly as it appears in the importing module**, not a resolved file path.

| alias key | result |
|---|---|
| `./crypto/index.js` | **works** — stub marker in the bundle, both real crypto files gone from the sourcemap |
| `@chainsafe/libp2p-noise` (whole package) | works |
| `@chainsafe/libp2p-noise/dist/src/crypto/index.js` | **silent no-op** |
| `@chainsafe/libp2p-noise/dist/src/crypto/index` | **silent no-op** |
| `@chainsafe/libp2p-noise/crypto` (subpath export) | **silent no-op** |

Every no-op **built green** and produced a bundle `cmp`-identical to the baseline. That is the
shape of failure this project has to defend against: a configuration line that does nothing,
behind a passing build.

**The proof that the no-ops never loaded, which is better than a marker grep.** The adversary's
stub contained an import that cannot resolve (`crypto/js.js` is not in the package's `exports`
map). The `./crypto/index.js` build **failed on it, exit 1** — so the stub was genuinely loaded.
The three package-qualified builds went **green with that same broken stub**, which is only
possible if it was never loaded at all. A marker's absence is weak evidence; a broken file that
fails to break the build is strong evidence.

### 2.3 The apparent contradiction with the earlier consult dissolves

`.planning/research/v2.0/STACK.md` reports needing a fix here. The reconciliation, stated as
**measurement on one side and hypothesis on the other**:

- **Measured:** `conditions` appears **0 times** in `node_modules/wrangler/config-schema.json`
  and there is no `--conditions` CLI flag. `alias` is both a config key and `--alias`. So a
  wrangler build has no conditions knob at all.
- **Hypothesis, unreproduced:** the consult's build was a hand-rolled esbuild pipeline with
  `platform: 'node'` or `--conditions=node`, either of which disables the legacy `browser` field.
  Neither investigator reproduced that build, and this is recorded as a hypothesis rather than a
  finding.

Without this paragraph a later reader concludes one of the two documents is simply wrong.

## 3. What the adversary added that the first investigator had left open

Investigator A stated its own gap plainly: `--dry-run` proves **bundle-time module selection
only**, and says nothing about whether the substituted pure-JS X25519 actually runs.

The adversary closed most of that gap without deploying, using `wrangler dev --local`:

- baseline → **HTTP 200**, `{"sharedLen":32,"agree":true}`
- with the Node backend deliberately planted → **HTTP 500**,
  `TypeError: crypto2.diffieHellman is not a function` at `crypto/index.ts:203`

and separately, in plain Node, the pure-JS X25519 output is **byte-equal** to
`node:crypto.diffieHellman` on the same keys, with interop verified in both directions. So a
workerd peer can complete a Noise handshake with a Node peer.

**A probe worth keeping**: under `nodejs_compat`, workerd's `node:crypto` is missing **only**
`diffieHellman` — `generateKeyPairSync`, `createPublicKey`, `createPrivateKey`, `createCipheriv`
and `createHash` all exist. That is why the Node backend gets all the way to
`generateX25519SharedKey` before dying, which is exactly the "last failure before the dial
succeeded" the earlier consult recorded.

## 4. The hazard, if anyone reaches for the relative alias anyway

Because the key is a relative specifier, it matches **across the entire dependency graph**. Both
investigators demonstrated the collision, one by accident and one deliberately: an unrelated
module of the worker's own at `src/crypto/index.js` was silently replaced by the noise stub —
build exit 0, victim's marker absent, stub's marker present, victim absent from the sourcemap. It
fails loudly only when the export *names* differ.

Counted in this repository's real `node_modules`: exactly **two** files import
`from './crypto/index.js'`, and both are the noise package's own. **Safe today, and a trap the
day any other dependency adds that import.**

## 5. What this does NOT establish — read before quoting it

- **"Moot" is a claim about this one file's resolution, not about the hosted tier bundling.**
  Neither investigator built the full Phase 29 graph. The earlier consult's `ws`
  CJS-dynamic-require failure is a separate and still-untested question.
- **Production-edge behaviour was not established here** — deploying was forbidden, correctly.
  The earlier consult's §9 independently measured a *deployed* object completing a Noise
  handshake, so the edge is covered elsewhere, not by this work.
- `wrangler dev` builds its own bundle, so the runtime check did not execute the
  `deploy --dry-run` artifact. The two pipelines agreed on both arms, which corroborates without
  being identity.
- workerd `1.20260825.1`, the figure `STACK.md` cites, was not tested; what was measured is
  `1.20260820.1`, the build wrangler `4.125.0` ships.
- Alias-versus-`browser`-field **precedence** — the alias won — was measured for one specifier in
  one package and should not be generalised.

## 6. A version finding neither investigator was asked for

```
STACK.md pin:                 wrangler 4.125.0
ambient on this machine:      4.14.1  (global, ~/.nvm/versions/node/v23.11.0/bin/wrangler)
declared in any package.json: nowhere
```

`npx wrangler` resolves to the ambient global, **111 minor versions behind the pin**. The
headline cases were run on both versions and the verdicts are identical, so no conclusion here
depends on it — but every developer and CI run currently gets whatever is installed. The
installed `@chainsafe/libp2p-noise@17.0.0` dist was confirmed byte-identical to the project's
(`diff -r`, exit 0), so the measurements are against the pinned package.

## 7. What Phase 29 should do

1. **Write no alias line for noise.** It is neither "a config line" nor "a patched dependency" —
   it is nothing.
2. **Add a guard asserting `diffieHellman` is absent from the emitted bundle.** Cheap, and it goes
   red exactly when this silently regresses — whether because upstream drops the `browser` field
   or because a future wrangler stops honouring it. The behaviour is stable across the
   4.14.1 → 4.125.0 span, roughly 111 minor versions, but nothing in the package's `exports`
   pins it.
3. **Pin wrangler in a manifest**, so the version a guard runs against is the version anyone else
   gets.
4. If the relative alias is ever needed as a fallback, **record the specifier-global blast
   radius beside it**, because a collision is silent whenever export names happen to agree.
