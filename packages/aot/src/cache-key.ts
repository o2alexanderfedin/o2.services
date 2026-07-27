/**
 * The identity of a translation — AOT-02, AOT-03.
 *
 * A translated artifact is not identified by its input. It is identified by
 * *everything that could have changed the output*: the input bytes, the exact
 * toolchain that ran, the target it emitted for, and the WASM feature set the
 * result requires. Phase 10's second criterion states this as a falsifiable
 * property — change any one of them and the CID must change — so the key is built
 * as a canonical record and hashed, and a test flips each field in turn.
 *
 * ## Why not just hash the output
 *
 * Because the output does not exist yet. This key is what a cache is consulted with
 * *before* spending minutes in a container, and it is what two machines compare to
 * decide whether they are talking about the same translation. Hashing the artifact
 * answers "are these the same bytes"; hashing the key answers "should these be the
 * same bytes", which is the question reproducibility is about — and the gap between
 * the two answers is precisely a reproducibility bug, detectable only because both
 * exist.
 *
 * ## Ordering is part of the identity
 *
 * DAG-CBOR sorts map keys but preserves array order, so an unsorted feature list
 * would give two machines different CIDs for the same translation. Features are
 * sorted and de-duplicated here rather than at each call site, because "the caller
 * remembers to sort" is the kind of rule this project has watched fail.
 *
 * Portable: no platform imports, no container, no filesystem. Running the toolchain
 * is a separate concern in `tools/aot/`; naming the result is this.
 */

import { canonicalCid } from '@o2/core'
import type { CID } from 'multiformats/cid'

/**
 * Every tool whose version could change the output, and the version it was.
 *
 * A record rather than a list so a missing tool is visible as a missing key rather
 * than as a shorter array nobody counted.
 */
export interface ToolchainVersions {
  readonly [tool: string]: string
}

export interface TranslationKey {
  /** Multihash (or any stable digest string) of the input binary. */
  readonly inputDigest: string
  /** e.g. `aarch64-wasi32`. Not a default: the wrong target emits a different ABI. */
  readonly target: string
  readonly toolchain: ToolchainVersions
  /** WASM features the artifact requires, e.g. `bulk-memory`. Sorted here. */
  readonly features: readonly string[]
}

export type KeyFailure =
  | { readonly kind: 'empty-field'; readonly field: string }
  | { readonly kind: 'empty-toolchain' }
  | { readonly kind: 'blank-version'; readonly tool: string }

export type KeyResult =
  | { readonly ok: true; readonly cid: CID; readonly key: TranslationKey }
  | { readonly ok: false; readonly failure: KeyFailure }

/** Sorted and de-duplicated, so two machines cannot disagree over ordering. */
export function normaliseFeatures(features: readonly string[]): readonly string[] {
  return [...new Set(features)].sort()
}

export function describeKeyFailure(failure: KeyFailure): string {
  switch (failure.kind) {
    case 'empty-field':
      return `${failure.field} is empty — a translation key with a blank field identifies nothing`
    case 'empty-toolchain':
      return 'no toolchain versions were supplied — the key would not change when the compiler did'
    case 'blank-version':
      return `${failure.tool} has a blank version — an unknown version is not a version`
  }
}

/**
 * The CID that names this translation.
 *
 * Refuses an incomplete key rather than hashing it. An empty toolchain record is the
 * dangerous case: the key would still produce a perfectly good-looking CID, and that
 * CID would go on matching after the compiler changed underneath it — a cache that
 * silently serves the previous compiler's output is worse than no cache.
 */
export async function translationCid(key: TranslationKey): Promise<KeyResult> {
  for (const [field, value] of [
    ['inputDigest', key.inputDigest],
    ['target', key.target],
  ] as const) {
    if (value.trim() === '') return { ok: false, failure: { kind: 'empty-field', field } }
  }
  const tools = Object.entries(key.toolchain)
  if (tools.length === 0) return { ok: false, failure: { kind: 'empty-toolchain' } }
  for (const [tool, version] of tools) {
    if (version.trim() === '') return { ok: false, failure: { kind: 'blank-version', tool } }
  }

  const normalised: TranslationKey = {
    inputDigest: key.inputDigest,
    target: key.target,
    toolchain: { ...key.toolchain },
    features: normaliseFeatures(key.features),
  }

  const hashed = await canonicalCid({
    inputDigest: normalised.inputDigest,
    target: normalised.target,
    toolchain: { ...normalised.toolchain },
    features: [...normalised.features],
  })
  // `canonicalCid` only fails on values DAG-CBOR cannot encode, and every field
  // here is a string. Surfaced rather than swallowed so a future field type that
  // breaks that assumption is loud.
  if (!hashed.ok) {
    return { ok: false, failure: { kind: 'empty-field', field: JSON.stringify(hashed.error) } }
  }
  return { ok: true, cid: hashed.cid, key: normalised }
}

/**
 * What a translation produced, bound to why it should have.
 *
 * The key and the artifact travel together for the same reason gross and useful fuel
 * do in `@o2/bench`: an artifact CID with its key detached is a binary nobody can
 * re-derive, and re-derivability is the entire claim of an AOT cache.
 */
export interface TranslationRecord {
  readonly keyCid: CID
  readonly key: TranslationKey
  readonly artifactCid: CID
}

/** Human-readable, for a build log and for a mismatch report. */
export function describeKey(key: TranslationKey): string {
  const tools = Object.entries(key.toolchain)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([tool, version]) => `${tool} ${version}`)
    .join(', ')
  return (
    `${key.target} · input ${key.inputDigest} · ${tools}` +
    (key.features.length === 0 ? ' · no required features' : ` · needs ${key.features.join(' ')}`)
  )
}
