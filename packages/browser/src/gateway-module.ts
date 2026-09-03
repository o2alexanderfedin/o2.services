/**
 * The last mile of AOT-05 — bringing a lifted artifact's *bytes* into a running page.
 *
 * `tools/aot/cli.ts` produces two things from an ELF binary: a `.wasm` and a signed
 * `NameRecord` that vouches for its CID. Until this module existed the page could carry
 * the **record** — `#byo-form` has had seven inputs for it since Plan 27-07 — and had no
 * route at all for the **bytes**. A dispatch names a module by CID and carries no bytes,
 * so a CID naming anything this bundle does not ship came back `module block missing` from
 * every executor. That is a true refusal and it was also a dead end: nothing on the page
 * could put foreign bytes where the fabric could reach them.
 *
 * `streaming-load.ts` was built for exactly this and had no production caller. This module
 * is the caller. It is deliberately thin — it holds the *decisions*, and `loadArtifact`
 * holds the mechanism.
 *
 * ## What this adds to `loadArtifact`, and what it must not
 *
 * `loadArtifact` answers one question: *are these the bytes that CID names, and do they
 * compile?* It cannot answer the question a fabric actually needs answered, which is
 * *should these bytes run here?* — because it knows nothing about records or anchors.
 *
 * So this module adds exactly one check on top, and it is the same comparison
 * `guardModuleProvenance` makes at the executor boundary: **the record must vouch for the
 * CID that was fetched.** Its own words are the model — *"the record is for a different
 * artifact"* — and the wording below is deliberately close to them, because an operator
 * seeing this refusal on screen and that refusal in a `failures` entry is seeing one rule
 * enforced twice rather than two rules.
 *
 * ## And it deliberately does NOT check the signature
 *
 * That would be the tempting third step, and it would be a *weakening dressed as a
 * strengthening*. The signature check belongs to `guardModuleProvenance`, which runs on
 * **every executor the shard reaches, including this tab's own**, against the anchor set
 * pinned at node start. A check here would be:
 *
 * - **redundant on the honest path** — the same record is checked again, seconds later, by
 *   the thing that actually decides whether the module runs; and
 * - **actively misleading on the dishonest one** — a page that said *"provenance verified"*
 *   before dispatch would be making a claim about anchors it does not hold. This module has
 *   no anchor set. It runs before `start()` has necessarily been called.
 *
 * The honest division is: this module says *these bytes are the bytes the record names*.
 * The executor says *this record is signed by a key we pin*. Neither is sufficient, both
 * are enforced, and the page renders whichever refused. Fetching is therefore explicitly
 * **not** an admission decision, and {@link FetchedModule} carries no field that could be
 * read as one.
 *
 * ## It does, since 2026-09-02, decide one thing: whether to ask at all — BROW-06
 *
 * The paragraph above is about *admission*, and it stands. This is a different question,
 * and the sentence four paragraphs up is what makes it this module's: **"It runs before
 * `start()` has necessarily been called."** That was written as a limitation — no anchors,
 * so no provenance verdict — and it is also a licence. A fetch that does not depend on a
 * started node cannot be gated by one, so until now nothing gated it at all.
 *
 * BROW-06 is not *"do not execute without consent"*, which `consent.ts` already enforces by
 * making `GrantedConsent` a parameter of the start path. It is *"do not **request** task
 * bytes without consent"*, and the criterion states why in terms of who is watching: a
 * reviewer with a network log open reads a fetch on its own as preparation-to-run. Bytes
 * pulled and then not executed still told a gateway operator that this visitor is here and
 * which artifact they were about to run — which is the harm, whatever the page then does
 * with the response.
 *
 * So {@link FetchModuleOptions.consent} is **required**, in the shape `consent.ts`
 * established: a caller without a consent does not fail a check, it fails to compile. The
 * runtime half admits {@link ConsentGap} as well, because the page has to be able to say
 * *"there is none, and here is why"* — and the check is the **first** thing this function
 * does, ahead of even the blank-gateway refusal, because "you left the gateway field empty"
 * is the wrong sentence to show somebody who has not agreed to anything yet.
 *
 * ## Why the gateway base has no default
 *
 * A path gateway must answer `Content-Type: application/wasm` or `compileStreaming` will
 * not touch the response — see `streaming-load.ts`'s header, condition 2. Public IPFS path
 * gateways sniff a content type from the payload and a bare raw block generally comes back
 * `application/octet-stream`, so a default baked in here would be a value that names a real
 * host and fails on it. Rather than ship a plausible-looking default that cannot work, the
 * field is the visitor's and an empty one refuses by name.
 *
 * ## Not in the barrel, and that is on purpose
 *
 * `packages/browser/src/index.ts` does not export this. It is imported by relative path
 * from `demo/main.ts`, exactly as `worker-factory.ts` and `dial-plan.ts` are. Putting it in
 * the barrel would add an exported-but-statically-unreachable symbol in front of
 * `reachability-guard.node.test.ts` — the demo's `window.o2` hop is not traced — for no
 * benefit to any consumer.
 */

import { CID } from 'multiformats/cid'
import { GrantedConsent } from './consent.ts'
import type { ConsentGap } from './consent.ts'
import { describeLoadFailure, loadArtifact } from './streaming-load.ts'
import type { FetchLike } from './streaming-load.ts'

/**
 * Why a fetch did not produce bytes this page is willing to hand to a dispatch.
 *
 * One string, already written for a reader, rather than a discriminated union. The
 * distinction that would justify a union — *retry elsewhere* versus *this artifact is
 * wrong* — is already drawn inside {@link describeLoadFailure}'s sentences, and a second
 * vocabulary here would give one fact two spellings.
 */
export interface FetchRefusal {
  readonly ok: false
  /** Non-empty, always, and written to be shown verbatim. */
  readonly reason: string
}

/** What a fetch produced, minus the bytes — everything that can cross a `page.evaluate`. */
export interface FetchFacts {
  readonly ok: true
  /** The CID the bytes were verified against — the same string the record vouches for. */
  readonly cid: string
  readonly bytes: number
  /** The stable gateway URL, which is also V8's code-cache key for this module. */
  readonly url: string
  /** False below V8's threshold: this module can never be code-cached. Reported, not asserted. */
  readonly cacheEligible: boolean
  readonly compileMs: number
}

/**
 * The reportable half of an outcome.
 *
 * Split out from {@link FetchedModule} because `TabApi.fetchModule` returns this and not the
 * bytes: a `Uint8Array` does not survive Playwright's JSON serialisation of a
 * `page.evaluate` result, and a page contract carrying a field that silently arrives as
 * `{"0":…}` is the shape `TabNameRecord` already documents as a trap. One declaration, so
 * {@link describeFetch} words the page's sentence and a harness's alike.
 */
export type FetchReport = FetchFacts | FetchRefusal

/** Bytes that hash to the CID that was asked for, and that the supplied record names. */
export interface FetchedModule extends FetchFacts {
  /**
   * The verified bytes. Put these in a blockstore; do not re-derive them.
   *
   * `Uint8Array<ArrayBuffer>` for `LoadedArtifact.content`'s reason: a blockstore's `put` is
   * declared over a non-shared buffer, and the bare alias admits `SharedArrayBuffer`.
   */
  readonly content: Uint8Array<ArrayBuffer>
}

export type FetchOutcome = FetchedModule | FetchRefusal

export interface FetchModuleOptions {
  /**
   * The visitor's consent, or the reason there is none — BROW-06.
   *
   * **Required, with no default**, for `readConsent`'s stated reason one module over: a
   * default would be a fail-open, and a caller that forgot the field would silently request
   * task bytes on behalf of somebody who has not agreed to anything. Making it a compile
   * error at every call site is the cheaper failure.
   *
   * The gap arm is not a weakening. {@link GrantedConsent} is still unforgeable — nothing
   * outside `consent.ts` can mint one — so the only way to reach the fetch is to hold a
   * consent that was granted or found. A {@link ConsentGap} is the page's way of saying
   * *there is none*, and it carries **which** kind so the refusal can name it: "you have
   * not been asked yet" and "the terms changed since you agreed" are different things to
   * tell a visitor, which is the distinction that union exists to draw.
   */
  readonly consent: GrantedConsent | ConsentGap
  /** A path-gateway root with a trailing slash and no query — `gatewayUrl` refuses the rest. */
  readonly gatewayBase: string
  /** The CID the dispatch will name. */
  readonly moduleCid: string
  /** The CID the signed record vouches for. Compared, never assumed equal. */
  readonly recordCid: string
  /** The record's name, used only to word the mismatch refusal the way the executor words it. */
  readonly recordName: string
  /** Injected so a test can answer without a network. */
  readonly fetch?: FetchLike
}

const refuse = (reason: string): FetchRefusal => ({ ok: false, reason })

/**
 * The half-sentence naming why there is no consent to fetch under.
 *
 * One clause each, written to be dropped into the refusal above rather than shown alone.
 * The four kinds are `consent.ts`'s and are exhaustive there; the `default` arm exists so
 * that a fifth kind added later arrives here as a sentence a reader can act on instead of
 * as `undefined` in the middle of a refusal.
 */
function describeConsentGap(gap: ConsentGap): string {
  switch (gap.kind) {
    case 'never-asked':
      return 'absent because you have not been asked yet'
    case 'unreadable':
      return `absent because this browser’s stored answer could not be read (${gap.detail})`
    case 'terms-changed':
      return `out of date: you agreed to version ${gap.answered} and these are version ${gap.current}`
    case 'anchor-changed':
      return `given under different terms: you agreed while ${gap.answered} could sign the code, and now it is ${gap.current}`
    default:
      return `absent for a reason this page has no wording for (${JSON.stringify(gap)})`
  }
}

/**
 * Fetch a module from a content-addressed gateway, verify it, and refuse loudly otherwise.
 *
 * The order is not arbitrary and each step exists because skipping it produces a wrong
 * answer rather than merely a worse one:
 *
 * 0. **Consent — BROW-06, and it is first for a reason that is not fastidiousness.** Every
 *    other refusal below is a sentence about the *request*: your gateway field is blank,
 *    your CID is not a CID, your record names something else. All three presuppose that
 *    asking was allowed. A visitor who has not agreed is not owed a critique of their
 *    inputs, and — the part that is measurable — a refusal arriving from step 1 for a
 *    visitor who has not consented would be indistinguishable, in a network log, from a
 *    gate that works. It is checked here rather than at the call site so that the check
 *    cannot be routed around: `demo/main.ts` reads consent and passes what it found,
 *    including a gap, and this is the only thing standing between that gap and a socket.
 * 1. **Gateway present.** An empty base would otherwise reach `new URL(cid, '')` and be
 *    reported as `not-a-url`, which blames the CID for a field the visitor left blank.
 * 2. **Both CIDs parse.** A typo in the record's CID must not be discovered as a digest
 *    mismatch, which reads as a hostile gateway.
 * 3. **The record vouches for the module CID.** *Before* the fetch: bytes that could not be
 *    dispatched even if they arrived intact must not be pulled at all — the same rule
 *    `loadArtifact` applies to an unverifiable CID, one level up.
 * 4. **`loadArtifact`.** Fetch, verify against the CID, compile through the streaming API.
 */
export async function fetchModuleForDispatch(options: FetchModuleOptions): Promise<FetchOutcome> {
  // BROW-06. `instanceof` and not a `kind` sniff: the class is the unforgeable thing, and a
  // structural check would accept an object that merely looks like a consent.
  if (!(options.consent instanceof GrantedConsent)) {
    return refuse(
      `no artifact bytes are requested before you have agreed to this page using your machine — ` +
        `consent here is ${describeConsentGap(options.consent)}, so nothing was asked of any ` +
        'gateway and nothing left this device.',
    )
  }

  const gatewayBase = options.gatewayBase.trim()
  if (gatewayBase === '') {
    return refuse(
      'No gateway was given, so there is nowhere to fetch from. A gateway root must end in a ' +
        'slash and must answer Content-Type application/wasm — the streaming compiler will not ' +
        'accept anything else.',
    )
  }

  const moduleCidText = options.moduleCid.trim()
  const recordCidText = options.recordCid.trim()

  let moduleCid: CID
  try {
    moduleCid = CID.parse(moduleCidText)
  } catch {
    return refuse(`"${moduleCidText}" is not a CID, so there is no artifact to ask a gateway for.`)
  }

  try {
    CID.parse(recordCidText)
  } catch {
    return refuse(`the record's cid "${recordCidText}" is not a CID, so nothing can be vouched for.`)
  }

  // `guardModuleProvenance`'s `cid-mismatch`, one layer earlier and worded to match it. The
  // executor would refuse this dispatch anyway; refusing here means the visitor reads why
  // instead of watching every shard come back refused.
  if (recordCidText !== moduleCidText) {
    return refuse(
      `the signed name record for "${options.recordName}" vouches for ${recordCidText}, but the ` +
        `fetch would name ${moduleCidText} — the record is for a different artifact, so these ` +
        'bytes were not requested.',
    )
  }

  const result = await loadArtifact({
    gatewayBase,
    cid: moduleCid,
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
  })
  if (!result.ok) {
    // The loader's own sentence, verbatim. It already distinguishes a gateway to retry from
    // an artifact that is wrong, and rewording it here would give an operator two things to
    // grep for.
    return refuse(describeLoadFailure(result.failure))
  }

  return {
    ok: true,
    content: result.artifact.content,
    cid: result.artifact.cid,
    bytes: result.artifact.bytes,
    url: result.artifact.url,
    cacheEligible: result.artifact.cacheEligible,
    compileMs: result.artifact.compileMs,
  }
}

/**
 * One block of prose for a fetch outcome — the text the page writes into `byo/fetch`.
 *
 * Pure, and separate from the fetch for the reason every surface formatter on this page is
 * separate from its run: the sentence is asserted in the `node` project with no network and
 * no DOM, and a formatter that could not be called there would not be that function.
 *
 * The success arm deliberately says what has **not** been established. A visitor who has
 * just read *"verified against its CID"* is one short step from concluding the module is
 * cleared to run, and it is not: the signature is checked by every executor that receives
 * the shard, including this tab's own, and that check has not happened yet.
 */
export function describeFetch(outcome: FetchReport): string {
  if (!outcome.ok) return `Nothing was fetched: ${outcome.reason}`
  const cache = outcome.cacheEligible
    ? 'It is large enough for V8 to consider code-caching, keyed on that URL.'
    : 'It is below V8’s code-caching threshold, so this module can never be code-cached however often it is fetched.'
  return [
    `Fetched ${outcome.bytes} bytes from ${outcome.url} and verified them against ${outcome.cid}; ` +
      `they compiled in ${outcome.compileMs.toFixed(1)} ms and are now in this tab’s store.`,
    cache,
    'Verified is not cleared to run: the record’s signature is checked against this tab’s pinned ' +
      'anchors by every executor the shard reaches, including this tab’s own, and a module signed ' +
      'by an unpinned key is refused there with its reason shown beside the dispatch.',
  ].join('\n')
}
