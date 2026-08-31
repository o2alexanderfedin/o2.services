/**
 * The hosted node's relay-service record, kept somewhere eviction cannot reach.
 *
 * ## The gap this closes, in one sentence
 *
 * `RelayServiceLog` observes; a Durable Object is destroyed and rebuilt whenever the platform
 * feels like it. Without this file the log answers only for the life of one instance, which
 * is exactly the failure that made *"did a browser reserve on this relay, and when?"*
 * unanswerable on 2026-08-30.
 *
 * ## Why the write refuses to go backwards, rather than the caller being careful
 *
 * `BootstrapObject.alarm()` runs on a **fresh instance** — Cloudflare evicts the object that
 * armed the alarm and constructs a new one to handle it, which `worker.ts` already records as
 * the reason nothing is memoised across that call. A fresh instance holds an empty log. So the
 * obvious implementation — read the log, write it — erases the node's whole history the first
 * time an alarm fires, and does it silently.
 *
 * {@link writeRelayServiceJournal} therefore **refuses a total lower than the stored one**,
 * and refuses to unset or move a marker that is already set. That makes the bug impossible
 * rather than merely documented: a caller who forgot to restore gets a
 * {@link RelayJournalRollbackError} instead of a quietly-truncated history. It is the same
 * shape `naming.ts` uses for `NameRecord` — a monotonic version that refuses a rollback — and
 * it is used here for the same reason: the value is a claim about the past, and the past does
 * not shrink.
 *
 * A single Durable Object has one live instance at a time, so read-then-write here is not
 * racing anything. The refusal is not a concurrency control; it is a check on the *caller's
 * state*, and it holds whether or not that stays true.
 *
 * ## Why JSON bytes and not a value the platform would accept directly
 *
 * `DoDatastore` wraps the same `state.storage` and its own docblock records what a non-byte
 * value does there: `has` says true, `get` throws `StoredValueNotBytesError`, `queryKeys`
 * answers `[]` — three different answers about one key. So everything this tier stores goes in
 * as `Uint8Array`, and this file encodes rather than making an exception it would have to
 * remember.
 *
 * ## Why `/journal/`
 *
 * `DoDatastore.put` refuses `/dht/` and `/o2/` — the record namespaces whose unbounded growth
 * Phase 31's sweep exists to bound. This key is deliberately outside both, and it is bounded by
 * construction rather than by a sweep: it is **one key holding six numbers**, overwritten in
 * place. An append-only event log under a record prefix is precisely the accumulation window
 * that refusal was written to keep shut, and it is not what this is.
 */

import { Key } from 'interface-datastore'
import type { Datastore } from 'interface-datastore'
import { NO_RELAY_SERVICE } from '@o2/libp2p'
import type { RelayServiceTotals } from '@o2/libp2p'

/**
 * Where the record lives. Outside both namespaces `DoDatastore.put` refuses — see the header;
 * `hosted-identity.ts` picked `/identity/` for the same reason and the completeness spec
 * beside it asserts the property rather than trusting the sentence.
 */
export const RELAY_SERVICE_JOURNAL_KEY: Key = new Key('/journal/relay-service')

/** The four stream counters, in one place so a reader and a writer cannot disagree. */
const COUNTERS = [
  'inboundHopStreams',
  'outboundHopStreams',
  'outboundStopStreams',
  'inboundStopStreams',
  'bytes',
] as const

/**
 * Thrown when the stored bytes are not a record this code wrote.
 *
 * Refusing rather than falling back to zero, on `MalformedStoredSeedError`'s reasoning: a
 * silent reset would make the node's history vanish while every reading still looked
 * plausible, which is the failure this whole file exists to prevent.
 */
export class MalformedRelayJournalError extends Error {
  constructor(detail: string) {
    super(
      `${RELAY_SERVICE_JOURNAL_KEY.toString()} does not hold a relay-service record (${detail})` +
        ' — refusing to read it as an empty history',
    )
    this.name = 'MalformedRelayJournalError'
  }
}

/** Thrown when a write would lose history. See the header for why this is a refusal. */
export class RelayJournalRollbackError extends Error {
  constructor(field: string, stored: number | undefined, offered: number | undefined) {
    super(
      `refusing to write ${field}=${String(offered)} over the stored ${String(stored)} in ` +
        `${RELAY_SERVICE_JOURNAL_KEY.toString()} — a lifetime total does not go backwards, so ` +
        'the log being written was almost certainly never restored from this store',
    )
    this.name = 'RelayJournalRollbackError'
  }
}

function readNumber(source: Record<string, unknown>, field: string): number {
  const value = source[field]
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new MalformedRelayJournalError(`${field} is ${JSON.stringify(value)}`)
  }
  return value
}

/**
 * The stored lifetime total, or {@link NO_RELAY_SERVICE} if this node has never written one.
 *
 * `has` before `get` rather than `get`-and-catch, exactly as `loadOrCreateHostedSeed` does it
 * and for the same reason: `Datastore.get` signals a miss by throwing, so a `catch` would
 * swallow a genuine storage fault as "no history yet" — and the two failures are opposite,
 * with only one of them recoverable.
 */
export async function readRelayServiceJournal(store: Datastore): Promise<RelayServiceTotals> {
  if (!(await store.has(RELAY_SERVICE_JOURNAL_KEY))) return NO_RELAY_SERVICE

  const raw = await store.get(RELAY_SERVICE_JOURNAL_KEY)
  let parsed: unknown
  try {
    parsed = JSON.parse(new TextDecoder().decode(raw))
  } catch (error) {
    throw new MalformedRelayJournalError(error instanceof Error ? error.message : String(error))
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new MalformedRelayJournalError(`the value decodes to ${typeof parsed}, not an object`)
  }
  const source: Record<string, unknown> = { ...parsed }

  const marker = source['firstInboundHopStreamAt']
  if (marker !== undefined && (typeof marker !== 'number' || !Number.isFinite(marker))) {
    throw new MalformedRelayJournalError(`firstInboundHopStreamAt is ${JSON.stringify(marker)}`)
  }

  return {
    inboundHopStreams: readNumber(source, 'inboundHopStreams'),
    outboundHopStreams: readNumber(source, 'outboundHopStreams'),
    outboundStopStreams: readNumber(source, 'outboundStopStreams'),
    inboundStopStreams: readNumber(source, 'inboundStopStreams'),
    bytes: readNumber(source, 'bytes'),
    firstInboundHopStreamAt: marker,
  }
}

/**
 * Bank a lifetime total, refusing any write that would lose history.
 *
 * Answers what is now stored, which is what the offered totals were — a caller that wants the
 * stored value after banking does not need a second read.
 *
 * **The marker is checked in both directions.** Unsetting one that is set loses the answer
 * outright; moving one later rewrites *when this started* into *when this instance noticed*,
 * which is the same loss wearing a plausible number. Moving it **earlier** is allowed and is
 * not a rollback: it is a correction toward the truth, and `RelayServiceLog.restore` already
 * keeps the earlier of two.
 */
export async function writeRelayServiceJournal(
  store: Datastore,
  totals: RelayServiceTotals,
): Promise<RelayServiceTotals> {
  const stored = await readRelayServiceJournal(store)
  for (const field of COUNTERS) {
    if (totals[field] < stored[field]) {
      throw new RelayJournalRollbackError(field, stored[field], totals[field])
    }
  }
  const before = stored.firstInboundHopStreamAt
  const after = totals.firstInboundHopStreamAt
  if (before !== undefined && (after === undefined || after > before)) {
    throw new RelayJournalRollbackError('firstInboundHopStreamAt', before, after)
  }

  await store.put(RELAY_SERVICE_JOURNAL_KEY, new TextEncoder().encode(JSON.stringify(totals)))
  return totals
}
