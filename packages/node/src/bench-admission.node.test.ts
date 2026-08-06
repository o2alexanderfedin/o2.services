import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import { findReservedPeers } from '@o2/net'
import { FabricNode } from './fabric-node.ts'
import { stripComments } from './strip-comments.ts'

/**
 * AUTH-02 — the pre-gate baseline: how many peers get in, counted before anything refuses.
 *
 * ## What this file is, and which plan is entitled to compare against it
 *
 * **This reading was taken before any admission gate exists.** Plan 24-01 threaded
 * `RelayAdmission` to every construction site and wired it to nothing; Plan 24-02 (this
 * one) made every rig and demo surface state its posture; **Plan 24-03 is the plan that
 * arms `ConnectionGater.denyInboundRelayReservation`, and Plan 24-04 is the plan entitled
 * to compare its numbers against the ones recorded here.** Nothing in this file can detect
 * a gate, because on the day it was written there was none to detect.
 *
 * A stronger statement is available and is measured rather than assumed: on this tree the
 * posture field is **inert**. Plan 24-01 planted `relayAdmission: new Set<never>()` — the
 * fail-closed extreme — at `relaying.node.test.ts`'s relaying node and ran the whole node
 * project: 2073 passed against 2074 clean, the single delta being that plan's own census
 * row. `relaying.node.test.ts`, which asserts reservations happen, stayed green. So the
 * baseline below is a baseline taken on a fabric where **stating a posture changes
 * nothing**, and that is the property that makes it a usable "before".
 *
 * ## Counts, not timings — and the reason is a standing rule
 *
 * `CLAUDE.md` § Measurement forbids an absolute threshold, because one encodes the machine,
 * the load and the I/O weather of the day it was written. **No assertion in this file is a
 * duration.** What is asserted is how many peers connected, how many were granted a
 * reservation, and how many a stranger asking over the wire is told about — three integers
 * that do not move with the host.
 *
 * The comparison is available **inside one run**, which is the shape the rule asks for.
 * Two arms are built from one function differing in exactly one argument:
 *
 * | Arm | `maxReservations` | connected | granted | advertised |
 * |---|---|---|---|---|
 * | `room-for-everyone` | 4 | {@link EXPECTED_CONNECTED} | 3 | 3 |
 * | `room-for-all-but-one` | 2 | {@link EXPECTED_CONNECTED} | 2 | 2 |
 *
 * **The load-bearing reading is the first column against the other two.** `connected` is
 * identical in both arms while `granted` and `advertised` move together — so a refusal at
 * the reservation leaves the plain connection standing, and the two counts are genuinely
 * independent rather than three names for one number. That independence is the whole
 * premise 24-CONTEXT's sub-decision 1 rests on: enrolment rides a plain connection, and
 * `denyInboundRelayReservation` fires on the reservation and on nothing else, so a gated
 * relay can still hand out a joining peer's first certificate.
 *
 * **Capacity is not admission, and this file must not be read as showing that it is.** The
 * capped arm refuses on `maxReservations`, which is the only refusal this tree has. It
 * demonstrates that the *counts can separate*. It demonstrates nothing whatever about a
 * certificate.
 *
 * ## What is deliberately not measured here
 *
 * The published benchmark curves. They are not a reservation reading at all: **neither
 * bench rig passes `relayAddrs` to any node**, so nothing in either of them ever requests
 * a reservation and every relay service they start has an empty store for the whole of a
 * run. `relay-admission.node.test.ts` pins that as source text
 * (*"has no rig that asks any relay for a reservation"*). It is the reason arming the gate
 * cannot move a committed figure, and it is why the baseline that matters is this one —
 * a fabric where reservations really are requested — rather than a rung of `bin/bench.ts`.
 *
 * ## Conditions, recorded because a count without them is a number
 *
 * Taken 2026-08-06 on the plan's own host: Darwin 25.5.0, 8 logical cores. Transport is
 * WebSockets over IPv4 loopback for the host, and the three joiners bind nothing at all —
 * `listen: []` with a relay address, which is the browser's position and the only topology
 * in which a reservation is the thing that decides whether a peer is reachable. Every node
 * in both arms states `relayAdmission: 'admits-any-peer'`; no node holds a certificate,
 * because nothing enrolled any of them.
 *
 * **Not in `MEASURED_NODE_SPANS`, and that is a statement rather than an omission.** Adding
 * a span means editing `vitest.config.ts`, whose `NODE_MEASUREMENT` table is a whole-suite
 * reading taken at a stated load — and `slow-specs.node.test.ts` parses that source, so a
 * span written from this session's load would be a guard telling a lie about a run nobody
 * took. The measured wall clock for this file is recorded in `24-02-SUMMARY.md` instead, so
 * the next re-measure has the number without this plan committing it into a shared table.
 *
 * Node-only: starts real libp2p nodes over TCP/WS.
 */

/** Joiners, in both arms. Three is the smallest count at which `advertised` can lose one and still be positive. */
const JOINERS = 3

/**
 * Peers holding a live connection to the host, in **both** arms.
 *
 * Three joiners plus the observer. The observer is the reason this number is interesting:
 * it dials the host directly and is **never given a relay address**, so it is connected and
 * unreserved at the same moment — which is, today and before any gate, the exact position a
 * peer enrolling against a relay that refused its reservation would be in.
 */
const EXPECTED_CONNECTED = JOINERS + 1

/** One reading of one arm. Three integers, no durations. */
interface Reading {
  /** Peers the host holds a live connection with, read off its own transport. */
  readonly connected: number
  /** Reservations the host granted, read off the live relay service. */
  readonly granted: number
  /**
   * Peers a stranger asking over the wire is told hold a reservation here.
   *
   * Asked by the observer through `findReservedPeers`, i.e. through the production
   * rendezvous path a browser tab uses, not by reading the host's own getter a second
   * time. The two are derived from the same `reservedPeerIds` by construction — that is
   * 24-CONTEXT's *"both advertisement surfaces are derived from `reservedPeerIds`"* — and
   * asking over the wire is what makes this a reading of the claim rather than a restatement
   * of it.
   */
  readonly advertised: number
}

const started: FabricNode[] = []

afterEach(async () => {
  // Tolerant of a node that has already left, on `relaying.node.test.ts`'s ground: one
  // failed stop must not strand the rest.
  await Promise.all(started.splice(0).map((node) => node.stop().catch(() => {})))
})

/**
 * Wait for a state, and **name the counts if it never arrives**.
 *
 * The `observed` thunk is not decoration and it was added because a plant proved it was
 * needed. Dropping one joiner's relay address — the plan's own plant for this file — starves
 * this wait, so the count assertions below never execute and the only thing the run reported
 * was `timed out waiting for 3 reservations` at 30 198 ms against a 30 000 ms deadline. A
 * duration equal to a timeout is evidence of the timeout and of nothing else: it says the
 * fabric did not reach the state, and it does not say **which count moved**, which is the one
 * thing this file exists to report. `reservation-exhaustion.node.test.ts` reached the same
 * conclusion about its own waits — *"both now name what arrived"* — and this is that idiom.
 */
async function until(
  predicate: () => boolean,
  timeoutMs: number,
  what: string,
  observed: () => string,
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error(`timed out waiting for ${what}; the counts were ${observed()}`)
}

/**
 * One arm: a relaying host, an observer that never asks for a reservation, and
 * {@link JOINERS} peers that do.
 *
 * `maxReservations` is the **only** difference between the two arms. Everything else —
 * the transport, the node count, the posture every node states, the order things start in
 * — is shared, so a divergence in the counts cannot be attributed to anything else.
 */
async function arm(maxReservations: number): Promise<Reading> {
  const host = await FabricNode.start({
    // AUTH-02 — open, which is what every node in this repository states today and what
    // makes this a *pre-gate* reading. Pinning here would measure a gate that does not
    // exist; the whole value of this file is that it was taken before one did.
    relayAdmission: 'admits-any-peer',
    startReporting: 'reports-its-own-start',
    listen: ['/ip4/127.0.0.1/tcp/0/ws'],
    maxReservations,
    // DET-03 — nothing here dispatches a task, so provenance is not what is being read.
    trustAnchors: 'runs-unsigned-artifacts',
    rpcTimeoutMs: 30_000,
  })
  started.push(host)
  const relayAddr = host.browserDialableAddrs[0]
  if (relayAddr === undefined) throw new Error('the host bound no browser-dialable address')

  // The stranger. Binds an address of its own and is handed **no** relay address, so it
  // holds a connection and no reservation — see {@link EXPECTED_CONNECTED}.
  const observer = await FabricNode.start({
    relayAdmission: 'admits-any-peer',
    startReporting: 'reports-its-own-start',
    listen: ['/ip4/127.0.0.1/tcp/0'],
    trustAnchors: 'runs-unsigned-artifacts',
    rpcTimeoutMs: 30_000,
  })
  started.push(observer)
  await observer.dial(relayAddr)

  // Sequential, not `Promise.all`: the capped arm's outcome depends on the order slots are
  // taken, and a concurrent race would make which joiner is refused a fact about the
  // scheduler. The counts below are about *how many* got in, and this keeps that answer
  // the same on every run.
  for (let i = 0; i < JOINERS; i++) {
    const joiner = await FabricNode.start({
      relayAdmission: 'admits-any-peer',
      startReporting: 'reports-its-own-start',
      // The browser's position: binds nothing, reachable only through the host. This is
      // the only topology in which a reservation decides whether a peer exists to others.
      listen: [],
      relayAddrs: [relayAddr],
      trustAnchors: 'runs-unsigned-artifacts',
      rpcTimeoutMs: 30_000,
    })
    started.push(joiner)
  }

  // The grants settle after the dials return — libp2p declares a `relay:reservation` event
  // and never dispatches it, which is why `capacity` is read from the live store on demand
  // and why this waits on the store rather than on an event.
  const expected = Math.min(JOINERS, maxReservations)
  const live = (): string =>
    JSON.stringify({ connected: host.transport.peers.length, granted: host.capacity.granted })
  await until(() => host.capacity.granted >= expected, 30_000, `${expected} reservations`, live)

  const rendezvous = await findReservedPeers({
    rpc: observer.rpc,
    peers: () => [host.peerId],
    self: observer.peerId,
  })
  // Anti-vacuity: an observer that reached nobody would report zero addresses and read
  // exactly like a host holding no reservations.
  expect(rendezvous.answered).toBe(1)

  return {
    connected: host.transport.peers.length,
    granted: host.capacity.granted,
    advertised: rendezvous.addrs.length,
  }
}

describe('AUTH-02 — the pre-gate baseline, as counts that a later gate can move', () => {
  it('records how many peers get in, and shows a refusal moving the count and not the connection', async () => {
    // Both arms in one process, one after the other, so the comparison below is a
    // comparison and not two readings taken on two days.
    const open = await arm(JOINERS + 1)
    await Promise.all(started.splice(0).map((node) => node.stop().catch(() => {})))
    const capped = await arm(JOINERS - 1)

    // Printed as well as asserted. The assertions are the guard; this line is the evidence,
    // and it is what a later reader compares against without re-deriving the topology.
    process.stderr.write(
      `[24-02 baseline] room-for-everyone ${JSON.stringify(open)}\n` +
        `[24-02 baseline] room-for-all-but-one ${JSON.stringify(capped)}\n`,
    )

    // ---- the open arm: everybody who asked, got in. ----------------------------------
    expect(open.connected).toBe(EXPECTED_CONNECTED)
    expect(open.granted).toBe(JOINERS)
    expect(open.advertised).toBe(JOINERS)

    // ---- the capped arm: one fewer got in, and nobody lost a connection. -------------
    expect(capped.connected).toBe(EXPECTED_CONNECTED)
    expect(capped.granted).toBe(JOINERS - 1)
    expect(capped.advertised).toBe(JOINERS - 1)

    // ---- the comparative statement, in three lines. ----------------------------------
    // **This is the reading 24-04 inherits.** The same fabric, the same peers, the same
    // posture at every node; one argument different. Connections are unmoved, grants are
    // down by one, and the advertisement follows the grants rather than the connections.
    expect(capped.connected).toBe(open.connected)
    expect(open.granted - capped.granted).toBe(1)
    expect(capped.advertised).toBe(capped.granted)
    expect(open.advertised).toBe(open.granted)
  }, 180_000)

  it('asserts no duration anywhere, so no reading here encodes this host', () => {
    // The standing rule, enforced against this file's own source rather than promised in
    // its docblock. Every assertion above is over an integer count; a millisecond threshold
    // sneaking in later is the failure this catches.
    //
    // The two deadlines are excluded by construction rather than by a pattern: `until`'s
    // budget and the case's own budget are *deadlines*, and a deadline is not an assertion —
    // a run that hits one throws instead of reporting a number. That is why this reads
    // `expect(` lines specifically and not the whole file.
    //
    // ## Two hazards were met here in sequence, and both are this repository's own
    //
    // **First, the guard could not fail.** It matched a number followed by a unit. Planted
    // with an upper-bound assertion carrying its unit in a trailing block comment — the form
    // a duration threshold actually takes — it stayed **green**, because the separator
    // between the number and the unit was not whitespace. A proof that cannot fail is not a
    // proof. The repair is to stop pattern-matching the *unit* and match the two things a
    // timing assertion cannot avoid: **a clock**, because a duration has to be read from
    // one, and **an upper bound**, because a duration is never asserted equal.
    //
    // `toBeGreaterThan` is deliberately not on that list — the anti-vacuity floor below is
    // one, and floors over counts are the idiom this whole file is written in. An upper
    // bound has no such use here: no count in this fabric has a ceiling worth asserting, so
    // its arrival is the signal.
    //
    // **Then the repaired guard fired on its own documentation.** This paragraph originally
    // quoted the plant verbatim, the quotation contains an assertion, and a raw-text scan
    // cannot tell a construction from a mention — so the clean tree went red naming a
    // comment. That is the identical hazard `relay-admission.node.test.ts` records for its
    // own matchers and `trust-anchors.node.test.ts` for `OPT_OUT`, and it has the same
    // established answer: **strip comments before scanning**, and describe the plant in prose
    // rather than writing it out. Both are done. `is not satisfied by a comment` below is
    // what keeps the stripping honest.
    const source = stripComments(readFileSync(new URL(import.meta.url), 'utf8'))
    const assertions = source.split('\n').filter((line) => line.includes('expect('))
    // A floor first: a filter that stopped matching would satisfy the negative perfectly.
    expect(assertions.length).toBeGreaterThan(8)
    const clockOrBound = /Date\.now|performance\.now|hrtime|toBeLessThan|\bms\b|milliseconds/i
    const timed = assertions.filter((line) => clockOrBound.test(line))
    expect(timed).toEqual([])
  })

  it('is not satisfied by a comment, so stripping is doing work rather than being claimed', () => {
    // The pair the guard above needs to mean anything, and the one
    // `relay-admission.node.test.ts` keeps for the identical reason: without the second line
    // an over-eager stripper and a file with no timing assertion are the same reading.
    //
    // The needle is assembled rather than written, on that file's rule — spelled out whole
    // it would sit in this file's own stripped source and the guard above would report it.
    const bound = 'toBe' + 'LessThan'
    expect(stripComments(`// expect(x).${bound}(500)\n`).includes(bound)).toBe(false)
    expect(stripComments(`/**\n * expect(x).${bound}(500)\n */\n`).includes(bound)).toBe(false)
    expect(stripComments(`expect(x).${bound}(500)\n`).includes(bound)).toBe(true)
  })
})
