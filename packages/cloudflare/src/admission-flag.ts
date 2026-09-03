/**
 * RUN-02 — the halt, banked where eviction cannot reach it, addressed by region, written
 * behind a key that refuses when it is not there.
 *
 * ## Everything that decides anything is here, and `worker.ts` is left with routing
 *
 * The division `acceptInboundSocket` established: *"Everything that decides anything is in
 * `acceptInboundSocket`… What is left here is constructing the pair and returning the 101."*
 * The storage key, the read, the write, the key check and the region check are all in this
 * file, so the route in `worker.ts` is four lines that choose which of them to call.
 *
 * ## Where the value lives, and the one way it differs from `relay-service-journal.ts`
 *
 * Same storage, same encoding, same `/journal/` prefix — `DoDatastore.put` refuses `/dht/` and
 * `/o2/`, the namespaces Phase 31's sweep exists to bound, and this key is deliberately outside
 * both. It is one key overwritten in place, so it is bounded by construction rather than by a
 * sweep.
 *
 * **And then it differs in the one respect that matters.** The relay journal refuses a write
 * that goes backwards, because it is a claim about the past and the past does not shrink. This
 * value is not a claim about the past: it is a **switch, and a switch that could only be
 * flipped one way is not a switch.** An operator who halted a region must be able to unhalt it,
 * and a fabric whose kill switch was monotonic would be a fabric one mistaken write takes off
 * permanently. So {@link writeDirective} overwrites, deliberately and with no rollback check,
 * and the difference is stated here rather than left to a reader to notice that one file has a
 * guard the other does not.
 *
 * ## Fail closed, and the temptation to do the opposite
 *
 * An object with no key configured refuses **every** write. See {@link authoriseWrite} — the
 * reasoning is written at the function, because that is where somebody would change it.
 *
 * ## No test-only bypass
 *
 * No `?force=`, no `X-Test-` header, no debug flag that skips the key. `built-bundle.e2e.test.ts`
 * records the rule this follows: *"There is no test-only bypass: the API refuses for the same
 * reason the button is not there yet."* The e2e specs configure a key through `--var` and
 * present it, which is the same path an operator takes.
 */

import { Key } from 'interface-datastore'
import { ADMITTING } from '@o2/libp2p'
import { HOSTED_OBJECT_NAMES } from './hosted-object.ts'
import type { Datastore } from 'interface-datastore'
import type { AdmissionDirective } from '@o2/libp2p'
import type { HostedObjectName } from './hosted-object.ts'

/**
 * Where the directive lives.
 *
 * Outside both namespaces `DoDatastore.put` refuses, on `RELAY_SERVICE_JOURNAL_KEY`'s stated
 * reasoning; `hosted-identity.ts` picked `/identity/` for the same reason.
 */
export const ADMISSION_DIRECTIVE_KEY: Key = new Key('/journal/admission')

/**
 * The header the operator's key arrives in.
 *
 * **Not `Authorization`, and that is a decision rather than a naming preference.** A browser
 * attaches `Authorization` automatically under some fetch modes and under some credential
 * settings, which would make a page able to present a key it never chose to send; and every
 * intermediary in the world knows to log or strip that header by name. A bespoke header is
 * inert to both — no user agent volunteers it, and nothing on the path treats it as special.
 *
 * Named once here and used on both sides, so the operator's tool and the object cannot disagree
 * about what to send.
 */
export const ADMISSION_KEY_HEADER = 'X-O2-Admission-Key'

/** What {@link authoriseWrite} answers. */
export type WriteAuthorisation =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: string }

/**
 * May this request write the directive?
 *
 * A discriminated result rather than a boolean, so the refusal reason is composed in **one**
 * place — `pausedRefusal`'s discipline. Two call sites each writing their own sentence is two
 * sentences that drift, and the one that drifted would be the one nobody read.
 *
 * ## An object with no key configured refuses everything
 *
 * `configuredKey === undefined` means *this object has no operator key, so it has no operator*,
 * and every write is refused.
 *
 * **The temptation is the other way and it is worth naming.** An unconfigured object is easier
 * to develop against and easier to test against, and "no key set, so no key required" reads
 * like a convenience. It is the failure mode that turns a kill switch into a kill switch anyone
 * can pull: every object that was deployed before the secret was set, or that lost its binding,
 * or that was stood up by a script that forgot — each one accepts a halt from the first stranger
 * who finds the route. Refusing means such an object cannot be halted **by anyone**, including
 * its owner, which is the correct direction for the failure to point: the fabric keeps working.
 *
 * ## The comparison
 *
 * Length-checked first, then a full-width XOR accumulation over every byte — the comparison does
 * not return early on the first difference, so its running time is a function of the two lengths
 * and not of how much of the key an attacker got right.
 *
 * **This is a reduction of a timing oracle, not its removal, and saying so is the point.**
 * workerd offers no timing-safe primitive to this code — there is no `crypto.timingSafeEqual` in
 * the Workers runtime's global scope — so what is written here is JavaScript, subject to a JIT
 * that may do whatever it likes, on a platform whose scheduling noise across the public internet
 * is orders of magnitude larger than the signal. The length check itself leaks the length. What
 * this buys is that the cheap, obvious oracle is gone; what it does not buy is a proof.
 */
export function authoriseWrite(request: {
  readonly configuredKey: string | undefined
  readonly presentedKey: string | null
}): WriteAuthorisation {
  const { configuredKey, presentedKey } = request
  if (configuredKey === undefined || configuredKey === '') {
    return {
      allowed: false,
      reason:
        'this object has no operator key configured, so it has no operator — every write to ' +
        'the admission directive is refused, including this one',
    }
  }
  if (presentedKey === null) {
    return {
      allowed: false,
      reason: `no ${ADMISSION_KEY_HEADER} header was presented`,
    }
  }
  if (!keysMatch(configuredKey, presentedKey)) {
    return {
      allowed: false,
      reason: `the ${ADMISSION_KEY_HEADER} header does not match this object's operator key`,
    }
  }
  return { allowed: true }
}

function keysMatch(configured: string, presented: string): boolean {
  if (configured.length !== presented.length) return false
  let difference = 0
  for (let index = 0; index < configured.length; index += 1) {
    difference |= configured.charCodeAt(index) ^ presented.charCodeAt(index)
  }
  return difference === 0
}

/**
 * The directive this object is under, with its own region label attached.
 *
 * `has` before `get` rather than `get`-and-catch, exactly as `readRelayServiceJournal` does it
 * and for the same reason: `Datastore.get` signals a miss by throwing, so a `catch` would
 * swallow a genuine storage fault as "nothing stored yet" — and the two failures are opposite,
 * with only one of them recoverable.
 *
 * **A malformed stored value reads as `ADMITTING`, which is the opposite of the journal's
 * ruling and is right for the opposite reason.** The journal refuses, because a silent reset
 * would erase a node's history while every reading still looked plausible. Here the stored
 * value is an *instruction*, and a stored instruction nobody can read is an instruction nobody
 * gave. Throwing would take `GET /self` down for every reader — including the status page a
 * volunteer reads — on the strength of one unreadable key, which is a fabric a single bad write
 * can silence. So it degrades to *not halted*, on the same rule `halted()` follows in the
 * client: an operator's silence is not a stop order.
 *
 * `region` is always this object's own label and never the stored one. A directive that was
 * written naming another region cannot be stored here — {@link refuseMisaddressed} sees to that
 * — and reporting the label from the deployment rather than from the value means a reader of
 * `/self` is told which object answered, not which object a write claimed to be for.
 */
export async function readDirective(
  store: Datastore,
  region: HostedObjectName | null,
): Promise<AdmissionDirective> {
  const stored = await readStored(store)
  return { ...(stored ?? ADMITTING), region }
}

async function readStored(store: Datastore): Promise<AdmissionDirective | null> {
  if (!(await store.has(ADMISSION_DIRECTIVE_KEY))) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(new TextDecoder().decode(await store.get(ADMISSION_DIRECTIVE_KEY)))
  } catch {
    return null
  }
  return parseDirective(parsed)
}

/**
 * Read an untrusted value as a directive, or answer `null`.
 *
 * The same function reads a stored value and a request body, because they are the same shape
 * arriving from two places and a second parser would be a second set of rules. Nothing here
 * throws: a body that is not a directive is a 400 and a stored value that is not one is
 * {@link ADMITTING}, and both callers want a value rather than an exception.
 */
export function parseDirective(value: unknown): AdmissionDirective | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const source: Record<string, unknown> = { ...value }

  const region = source['region']
  if (region !== null && typeof region !== 'string') return null
  const halted = source['halted']
  if (typeof halted !== 'boolean') return null
  const versions = source['versions']
  if (
    versions !== 'all' &&
    !(Array.isArray(versions) && versions.every((entry) => typeof entry === 'string'))
  ) {
    return null
  }
  const since = source['since']
  if (since !== null && (typeof since !== 'number' || !Number.isFinite(since))) return null
  const note = source['note']
  if (typeof note !== 'string') return null

  return {
    region,
    halted,
    versions: versions === 'all' ? 'all' : [...versions],
    since,
    note,
  }
}

/** What {@link refuseMisaddressed} answers when a write names the wrong object. */
export type RegionRefusal = { readonly refused: true; readonly reason: string } | null

/**
 * Refuse a directive addressed to a region this object does not serve.
 *
 * **This is what makes the slice structural rather than careful.** An operator tool that fans
 * one halt out to every endpoint — which is what a tool written for a global switch does — gets
 * three refusals and two untouched objects instead of a fabric-wide stop. The check is not a
 * convenience for the operator; it is the difference between a sliced control and a global one,
 * and criterion 1 is written against exactly that difference.
 *
 * **An object with no region label refuses every region-addressed write.** `null` says *this
 * object is not region-addressable*, and an unlabelled object that accepted the first write to
 * arrive would be a hole in the slice large enough to drive the whole fabric through.
 *
 * The refusal names **both** regions — the one asked for and the one served — because an
 * operator reading `refused` with neither has to guess which end is wrong.
 */
export function refuseMisaddressed(
  directive: AdmissionDirective,
  region: HostedObjectName | null,
): RegionRefusal {
  if (region === null) {
    return {
      refused: true,
      reason:
        `this object serves no region, so it is not region-addressable and refuses the write ` +
        `addressed to ${JSON.stringify(directive.region)}`,
    }
  }
  if (directive.region !== region) {
    return {
      refused: true,
      reason:
        `this write is addressed to region ${JSON.stringify(directive.region)} and this object ` +
        `serves region ${JSON.stringify(region)}`,
    }
  }
  return null
}

/**
 * Bank a directive.
 *
 * **No rollback check, unlike `writeRelayServiceJournal`.** See this file's header: a switch
 * that could only be flipped one way is not a switch. The value overwrites in place, both ways,
 * every time.
 *
 * Answers what is now stored, so a caller that wants the stored value after banking does not
 * need a second read — `writeRelayServiceJournal`'s shape, kept for the same reason.
 */
export async function writeDirective(
  store: Datastore,
  directive: AdmissionDirective,
): Promise<AdmissionDirective> {
  await store.put(ADMISSION_DIRECTIVE_KEY, new TextEncoder().encode(JSON.stringify(directive)))
  return directive
}

/**
 * This object's region label, narrowed against the closed set, exactly once.
 *
 * An unknown value is treated as **absent** rather than as a label — a deployment that
 * mistyped `bootstrap-eu` gets an object that refuses every write, which is loud, rather than
 * an object addressable under a name that exists nowhere else, which is silent. The caller logs
 * it; see `worker.ts`.
 */
export function narrowRegion(label: string | undefined): HostedObjectName | null {
  if (label === undefined) return null
  const known = HOSTED_OBJECT_NAMES.find((name) => name === label)
  return known ?? null
}
