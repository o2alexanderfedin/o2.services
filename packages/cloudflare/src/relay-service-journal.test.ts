/**
 * The relay-service journal against the real `DoDatastore`, over the storage fixture.
 *
 * Not a mock store: the two things that could go wrong here are both properties of
 * `DoDatastore` rather than of this module — that `/journal/` is not one of the namespaces
 * `put` refuses, and that a `Uint8Array` round-trips through it unchanged. A fake datastore
 * would assert neither, and the first of them is a failure that would arrive at the first
 * relayed connection on a deployed object rather than in a test.
 *
 * The claim this file cannot make is the platform's own — that a Durable Object really is
 * evicted and rebuilt over the same storage. What it holds instead is the shape that survives
 * it: two stores constructed over ONE `FakeDurableObjectStorage`, sharing no memo, with the
 * second reading what the first wrote. `hosted-identity.test.ts` holds criterion 2 the same
 * way and says so in the same words.
 */

import { describe, expect, it } from 'vitest'
import { NO_RELAY_SERVICE, RelayServiceLog } from '@o2/libp2p'
import type { RelayServiceTotals } from '@o2/libp2p'
import { DoDatastore } from './do-datastore.ts'
import { FakeDurableObjectStorage } from './do-storage.fixture.ts'
import {
  MalformedRelayJournalError,
  RELAY_SERVICE_JOURNAL_KEY,
  RelayJournalRollbackError,
  readRelayServiceJournal,
  writeRelayServiceJournal,
} from './relay-service-journal.ts'

const CARRIED: RelayServiceTotals = {
  inboundHopStreams: 4,
  outboundHopStreams: 1,
  outboundStopStreams: 3,
  inboundStopStreams: 0,
  bytes: 8_192,
  firstInboundHopStreamAt: 1_756_000_000_000,
}

describe('the journal round-trips through the store the deployed object actually uses', () => {
  it('answers NO_RELAY_SERVICE for a node that has never written one', async () => {
    const store = new DoDatastore(new FakeDurableObjectStorage())
    // Not a throw and not `undefined`: a node that has never relayed has an answer, and it is
    // zeros. The same reading `traffic` gives before the first connection.
    expect(await readRelayServiceJournal(store)).toEqual(NO_RELAY_SERVICE)
  })

  it('is admitted by `DoDatastore.put`, which refuses `/dht/` and `/o2/`', async () => {
    const store = new DoDatastore(new FakeDurableObjectStorage())
    // The property, not the sentence in the docblock. A key under either refused namespace
    // would make every bank throw on a deployed object and nowhere else.
    await expect(writeRelayServiceJournal(store, CARRIED)).resolves.toEqual(CARRIED)
    expect(RELAY_SERVICE_JOURNAL_KEY.toString()).toBe('/journal/relay-service')
  })

  it('survives the store being reconstructed — which is what eviction looks like', async () => {
    const storage = new FakeDurableObjectStorage()
    await writeRelayServiceJournal(new DoDatastore(storage), CARRIED)

    // A SECOND store over the same storage, sharing no state with the first. A test that
    // read back through the same instance would be asserting nothing about durability.
    expect(await readRelayServiceJournal(new DoDatastore(storage))).toEqual(CARRIED)
  })

  it('carries a fresh instance’s totals forward on top of the stored ones', async () => {
    const storage = new FakeDurableObjectStorage()
    await writeRelayServiceJournal(new DoDatastore(storage), CARRIED)

    // The revived instance: a new log, restored from storage, that then sees one more hop.
    const revived = new RelayServiceLog(() => 1_756_999_999_999)
    revived.restore(await readRelayServiceJournal(new DoDatastore(storage)))
    revived.restore({ ...NO_RELAY_SERVICE, inboundHopStreams: 1 })
    const banked = await writeRelayServiceJournal(new DoDatastore(storage), revived.report())

    // 5 as a literal — 4 stored plus the 1 this instance saw. Deriving it from `CARRIED`
    // would let both sides move together and stay green.
    expect(banked.inboundHopStreams).toBe(5)
    expect(await readRelayServiceJournal(new DoDatastore(storage))).toEqual(banked)
    // The marker crossed the boundary unchanged, which is the whole of what it is for.
    expect(banked.firstInboundHopStreamAt).toBe(1_756_000_000_000)
  })
})

describe('a write that would lose history is refused, not applied', () => {
  it('refuses a lower count — the fresh-instance-writes-zeros bug, made impossible', async () => {
    const storage = new FakeDurableObjectStorage()
    await writeRelayServiceJournal(new DoDatastore(storage), CARRIED)

    // Exactly what `BootstrapObject.alarm()` would produce if it banked without restoring:
    // Cloudflare constructs a FRESH instance to handle an alarm, and a fresh log is zeros.
    await expect(
      writeRelayServiceJournal(new DoDatastore(storage), new RelayServiceLog().report()),
    ).rejects.toThrow(RelayJournalRollbackError)

    // And the stored value is untouched — a refusal that had already written would be worse
    // than no refusal at all.
    expect(await readRelayServiceJournal(new DoDatastore(storage))).toEqual(CARRIED)

    // **MEASURED 2026-08-30: the assertion above does not, on its own, check the counter
    // guard.** Disabling the counter comparison in `writeRelayServiceJournal` left this case
    // GREEN, because a fresh log also carries no marker and the marker check refuses it
    // first. That is the shape `CLAUDE.md` names — *a proof that cannot fail is not a proof* —
    // so the isolating write is here rather than the finding being left unrecorded: same
    // marker, one lower count, nothing else different. With the counter guard planted away
    // this line is what goes red.
    await expect(
      writeRelayServiceJournal(new DoDatastore(storage), { ...CARRIED, inboundHopStreams: 0 }),
    ).rejects.toThrow(RelayJournalRollbackError)
  })

  it('refuses a lower byte count even when every stream count is higher', async () => {
    const storage = new FakeDurableObjectStorage()
    await writeRelayServiceJournal(new DoDatastore(storage), CARRIED)

    await expect(
      writeRelayServiceJournal(new DoDatastore(storage), {
        ...CARRIED,
        inboundHopStreams: 99,
        bytes: 1,
      }),
    ).rejects.toThrow(RelayJournalRollbackError)
  })

  it('refuses to UNSET a marker that is already set', async () => {
    const storage = new FakeDurableObjectStorage()
    await writeRelayServiceJournal(new DoDatastore(storage), CARRIED)

    await expect(
      writeRelayServiceJournal(new DoDatastore(storage), {
        ...CARRIED,
        firstInboundHopStreamAt: undefined,
      }),
    ).rejects.toThrow(RelayJournalRollbackError)
  })

  it('refuses to move a marker LATER — the loss that wears a plausible number', async () => {
    const storage = new FakeDurableObjectStorage()
    await writeRelayServiceJournal(new DoDatastore(storage), CARRIED)

    await expect(
      writeRelayServiceJournal(new DoDatastore(storage), {
        ...CARRIED,
        firstInboundHopStreamAt: 1_756_000_000_001,
      }),
    ).rejects.toThrow(RelayJournalRollbackError)
  })

  it('ALLOWS a marker to move earlier, which is a correction toward the truth', async () => {
    const storage = new FakeDurableObjectStorage()
    await writeRelayServiceJournal(new DoDatastore(storage), CARRIED)

    const corrected = { ...CARRIED, firstInboundHopStreamAt: 1_755_000_000_000 }
    await expect(writeRelayServiceJournal(new DoDatastore(storage), corrected)).resolves.toEqual(
      corrected,
    )
  })

  it('allows an unchanged write, so banking twice with nothing between is not an error', async () => {
    const storage = new FakeDurableObjectStorage()
    await writeRelayServiceJournal(new DoDatastore(storage), CARRIED)
    // Every socket close banks. On a quiet relay two of them in a row carry identical totals,
    // and a strictly-increasing rule would turn that ordinary case into a thrown error on a
    // path nothing catches.
    await expect(writeRelayServiceJournal(new DoDatastore(storage), CARRIED)).resolves.toEqual(
      CARRIED,
    )
  })
})

describe('a value this code did not write is refused rather than read as an empty history', () => {
  it('refuses bytes that are not JSON', async () => {
    const storage = new FakeDurableObjectStorage()
    const store = new DoDatastore(storage)
    await store.put(RELAY_SERVICE_JOURNAL_KEY, new TextEncoder().encode('not json at all'))

    await expect(readRelayServiceJournal(store)).rejects.toThrow(MalformedRelayJournalError)
  })

  it('refuses JSON that is missing a counter', async () => {
    const storage = new FakeDurableObjectStorage()
    const store = new DoDatastore(storage)
    await store.put(
      RELAY_SERVICE_JOURNAL_KEY,
      new TextEncoder().encode(JSON.stringify({ ...CARRIED, bytes: undefined })),
    )

    // Reading a missing counter as zero would silently halve the node's history and every
    // later reading would look plausible. Refusing is `MalformedStoredSeedError`'s reasoning.
    await expect(readRelayServiceJournal(store)).rejects.toThrow(MalformedRelayJournalError)
  })

  it('refuses a negative counter', async () => {
    const storage = new FakeDurableObjectStorage()
    const store = new DoDatastore(storage)
    await store.put(
      RELAY_SERVICE_JOURNAL_KEY,
      new TextEncoder().encode(JSON.stringify({ ...CARRIED, inboundHopStreams: -1 })),
    )

    await expect(readRelayServiceJournal(store)).rejects.toThrow(MalformedRelayJournalError)
  })

  it('refuses a JSON array, which parses fine and is not a record', async () => {
    const storage = new FakeDurableObjectStorage()
    const store = new DoDatastore(storage)
    await store.put(RELAY_SERVICE_JOURNAL_KEY, new TextEncoder().encode('[1,2,3]'))

    await expect(readRelayServiceJournal(store)).rejects.toThrow(MalformedRelayJournalError)
  })
})
