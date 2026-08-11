/**
 * The fabric-state surface — UI-SPEC section 4.6, F1 through F21.
 *
 * ## The surface with no workload of its own
 *
 * Every other surface formats one reading produced by one control. This one formats
 * **nine different calls** plus the receipt and manifest of whichever run happened last,
 * on whichever surface. It has no run control of its own — UI-SPEC section 11: *Fabric
 * state — none; the surface reads, it does not run* — so `demo-liveness.e2e.test.ts`
 * skips it by name, which is the correct outcome and is asserted in
 * `demo-fabric.e2e.test.ts` rather than left to be read off stderr.
 *
 * ## Why `format` takes a record of readings rather than making the calls
 *
 * Most of what this surface shows **throws `node not started`** when there is no node:
 * `peers`, `computePeers`, `heldPeers`, `connectDiscoveredPeers`, `capacity`, `governor`,
 * `storedBlocks` and `addresses` all end in `required()` in `../main.ts`. The page
 * therefore calls each of them only when `activity() !== null`, each inside its own
 * `try`/`catch`, and hands the outcome here as either a value or the `Error` that was
 * thrown. Two things follow, and both are the point:
 *
 * 1. **One throwing call is one region's named reason, not twenty blanks.** The catch is
 *    per reading at the call site, so a governor that throws leaves the peer counts,
 *    the addresses and the block count standing.
 * 2. **The thrown-message arm is reachable without a browser.** `format` is pure, so
 *    every arm — including the one a healthy fixture will not produce to order — is a
 *    function call rather than a Playwright round trip.
 *
 * ## Stopped wins, and F17 is the row where that had to be decided
 *
 * UI-SPEC's F17 cells read *"always readable — three booleans, no node needed"* and
 * *"unchanged"*. `../render.ts`'s header states the opposite rule and names this very
 * reading: *when `activity() === null`, **every** reading region paints its `stopped`
 * sentence — including the readings that are safe to call with no node (`discoverRelays`,
 * `verifyAnswer`, `isolation`, `startReport`)*. That rule is not decoration: P3 in
 * `demo-regions.e2e.test.ts` runs on a page with no node and asserts every reading region
 * equals the catalogue's stopped sentence, so a surface rendering isolation's booleans
 * there turns a committed guard red.
 *
 * **Stopped wins, therefore — and the page does not take a reading it will not show.**
 * `fabric/isolation`'s stopped sentence is *Not read: the page has not yet taken this
 * tab's isolation reading*, which Plan 27-03 composed and flagged as composed. It is
 * **true only if the page really has not read it**, so the caller does not call
 * `isolation()` while `activity()` is null. Calling it and then hiding the answer behind
 * that sentence would have been the cheaper arrangement and a false one. With a node
 * running, `isolation()` is read unconditionally — it is the one reading on this surface
 * that needs nothing from the fabric — and its three booleans are on screen.
 *
 * ## The cross-cutting values have ONE author, and it is not this file
 *
 * F6, F7 and F8 render the last run's attestation through `attestationLines`, and F9, F10
 * and F11 the last run's egress through `egressLines`, both imported from `../render.ts`.
 * This surface is *the cross-cutting view of a value another surface already rendered*; a
 * second formatter here would be a second opinion about one result, which is the failure
 * `TabColouringRun.attestation`'s own docblock names. The same argument the CLI and the
 * page make to each other, one file down.
 *
 * **A limit that was inherited rather than introduced — closed 2026-08-10 by EGR-01, and
 * the history is kept because it is a sovereignty claim and not a commit message.**
 * `egressLines`' sentence *"this run registered no sovereign data"* was measured by Plan
 * 27-07 to be unreliable on a sovereign dispatch: a run that submitted six owner-pinned
 * shards rendered it, because `EgressManifest` carried no field distinguishing *nothing
 * was registered* from *nothing reached the guard*. This surface renders whichever
 * manifest it is handed, so when the last run was a sovereign bring-your-own dispatch it
 * rendered that sentence too. It was **not** reworded here, and that decision stands as
 * the right one: UI-SPEC section 5.2 fixes the copy verbatim, P7 asserts those words
 * across five surfaces, and forking it would have made this file a second author of the
 * sentence carrying the project's core claim. The fix landed where the words live —
 * `EgressManifest.registeredSovereign` counted in `submitJobWithEgress`, a third arm in
 * `egressLines`, and amendments to UI-SPEC section 5.2 and to P7, in one change. This
 * file is unchanged by it except for this paragraph, which is the property the
 * one-region-one-function rule was for: F11 renders the corrected sentence because it
 * never held a copy of the old one.
 *
 * ## No DOM, no globals, no `innerHTML`
 *
 * Nothing here touches `document`, `window` or `window.o2`. Peer ids, multiaddrs, browser
 * family labels and thrown messages are all peer- or fabric-authored strings that reach
 * the DOM through `../render.ts`'s `textContent` writers — *verbatim into `textContent`
 * is a quotation; verbatim into `innerHTML` is an injection*.
 */

import type { ShardAttestation } from '@o2/core'
import type { EgressManifest } from '@o2/net'
import { REGIONS } from '../../src/demo-regions.ts'
import type { Region } from '../../src/demo-regions.ts'
import type {
  TabActivity,
  TabAddresses,
  TabDiscoveryRound,
  TabGovernorState,
  TabHeldPeer,
  TabIsolation,
  TabStartReport,
} from '../../src/tab-api.ts'
import { attestationLines, egressLines } from '../render.ts'
import type { SurfaceRender } from '../render.ts'

/**
 * One reading, or the `Error` the call threw.
 *
 * `undefined` is a third state and it is not the same as either: it means *the page did
 * not make this call*, which with no node is the ordinary case and is what the stopped
 * sentence describes. Collapsing it into `Error` would render a message nobody produced.
 */
export type Reading<T> = T | Error

/** What `capacity()` returns. Named here because `TabApi` declares it inline. */
export interface TabCapacity {
  readonly dutyCycle: number
  readonly slots: number
}

/**
 * Everything the two views are written from — assembled by the caller, one entry per call.
 *
 * The eight optional readings are `undefined` whenever `activity` is `null`, because the
 * page does not call them without a node. {@link isolation} is optional for a different
 * reason, recorded in this file's header: it needs no node, and the page still does not
 * take it while stopped, because the sentence it would be hidden behind says it has not
 * been taken.
 */
export interface FabricReadings {
  readonly activity: TabActivity | null
  /** F17. Safe with no node; see the header for why it is still not read while stopped. */
  readonly isolation?: Reading<TabIsolation>
  /** F18, F19. Safe with no node; the page reads it once a node is up and on `#refresh-report`. */
  readonly startReport?: Reading<TabStartReport>
  /** F1. */
  readonly peers?: Reading<readonly string[]>
  /** F2. */
  readonly computePeers?: Reading<readonly string[]>
  /** F3, F4. */
  readonly heldPeers?: Reading<readonly TabHeldPeer[]>
  /**
   * F5 — the **last** round the page ran, never a round this surface started.
   *
   * `connectDiscoveredPeers()` dials. A render pass that dialled would make the display
   * a cause of the thing it displays, so the page hands over the round `findPeers()`
   * already performed on its own four-second timer.
   */
  readonly discovery?: Reading<TabDiscoveryRound>
  /** F12, F13. */
  readonly capacity?: Reading<TabCapacity>
  /** F14, F15, F16. */
  readonly governor?: Reading<TabGovernorState>
  /** F20. */
  readonly storedBlocks?: Reading<number>
  /** F21. */
  readonly addresses?: Reading<TabAddresses>
  /** F6, F7, F8 — the last receipt any surface in this tab produced. */
  readonly attestation?: ShardAttestation | null
  /** F9, F10, F11 — the last manifest any surface in this tab produced. */
  readonly egress?: EgressManifest | null
}

const CATALOGUE: ReadonlyMap<string, Region> = new Map(REGIONS.map((region) => [region.id, region]))

/**
 * The catalogue's sentence for a region in one of its three states.
 *
 * Read from `../../src/demo-regions.ts` and never written here — a sentence held in two
 * places is two sentences that can drift. A missing arm throws rather than falling back.
 */
function absence(id: string, state: 'initial' | 'stopped' | 'unavailable'): string {
  const region = CATALOGUE.get(id)
  if (region?.absence === undefined) throw new Error(`fabric: "${id}" holds no absence copy`)
  const sentence =
    state === 'initial'
      ? region.absence.initial
      : state === 'stopped'
        ? region.absence.stopped
        : region.absence.unavailable
  if (sentence === undefined) throw new Error(`fabric: "${id}" has no ${state} arm in the catalogue`)
  return sentence
}

/** Every fabric-state reading, for the page's stop and throw paths. Derived, never listed. */
export const FABRIC_READING_IDS: readonly string[] = REGIONS.filter(
  (region) => region.surface === 'fabric' && region.kind === 'reading',
).map((region) => region.id)

/**
 * UI-SPEC section 11's whole-surface empty state, verbatim.
 *
 * The text view's whole content when there is no node. It is one sentence and it names
 * the control that changes the state, because a text view reading *nothing* is the blank
 * a named absence exists to replace.
 */
export const SURFACE_STOPPED: string =
  "This tab's node is stopped. Start it from the panel at the top of the page to take a reading."

/** The duty-cycle control's status while there is no governor to set a cap on. Digit-free. */
export const DUTY_STOPPED: string =
  'Start a node first: there is no governor for this cap to compose with.'

/**
 * The duty-cycle control's status after a cap was accepted. Digit-free, deliberately.
 *
 * It states the composition rather than the number: `setDutyCycle` is *the user's cap, not
 * the environment's*, and `capacity().dutyCycle` — F12 — reports the effective rate, which
 * is the lower of this cap and the visibility governor's. A status element repeating the
 * figure would be a second, undeclared copy of a declared region.
 */
export const DUTY_APPLIED: string =
  'Cap accepted. The effective rate is the lower of this cap and the visibility governor’s, and it is the reading above.'

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`

const yesNo = (value: boolean): string => (value ? 'yes' : 'no')

/**
 * One region, from one reading — the whole of this surface's error discipline in five lines.
 *
 * `undefined` takes the catalogue's sentence for the state the surface is in. An `Error`
 * renders **its own message**, verbatim, and nothing else: not a number, not a blank, and
 * never a value from a previous pass. A value is formatted by the caller's closure.
 */
function read<T>(
  entry: Reading<T> | undefined,
  id: string,
  state: 'initial' | 'stopped',
  render: (value: T) => string,
): string {
  if (entry === undefined) return absence(id, state)
  if (entry instanceof Error) return entry.message
  return render(entry)
}

/**
 * F18 — the start-outcome cliff, **named** rather than shown as a zero.
 *
 * `TabStartReport`'s own docblock: *`asked > 0 && reached === 0` is the cliff.* It is the
 * blocklist seen from the inside — every peer was asked and not one answered — and
 * rendering it as `0 of 4` puts the most actionable condition on this surface behind a
 * figure a reader has to interpret. `asked === 0` is the other zero and it is a different
 * finding: nobody was asked, which is the catalogue's own stopped sentence and is true.
 */
function startReached(report: TabStartReport): string {
  if (report.asked === 0) return absence('fabric/start-reached', 'stopped')
  if (report.reached === 0) return absence('fabric/start-reached', 'unavailable')
  return `${report.reached} of ${plural(report.asked, 'peer')} asked answered`
}

/** F19 — one row per browser family, or UI-SPEC's sentence for no rows at all. */
function startTallies(report: TabStartReport): string {
  if (report.byBrowser.length === 0) return absence('fabric/start-tallies', 'unavailable')
  return report.byBrowser
    .map(
      (tally) =>
        `${tally.browser}: ${plural(tally.attempts, 'attempt')}, ${tally.failed} failed` +
        (tally.reliable ? '' : ' — too few reports for a rate'),
    )
    .join('\n')
}

/**
 * F4 — one row per held peer, with the fact `peers()` cannot carry.
 *
 * `TabHeldPeer.carriesWork` is *a positive test rather than "no limited connection"*, so
 * the row says which of the two states the pair is in rather than implying it from a
 * count. A peer that is connected and cannot run a job is the condition NET-05's lesson
 * says nobody can act on unless it is reported.
 */
function peerRows(held: readonly TabHeldPeer[]): string {
  if (held.length === 0) return absence('fabric/peer-rows', 'unavailable')
  return held
    .map(
      (peer) =>
        `${peer.peer} — ${peer.carriesWork ? 'can carry a job' : 'relay circuit only, cannot carry a job'}`,
    )
    .join('\n')
}

/** F5 — relayed-only and stalled, or UI-SPEC's sentence for a fabric with neither. */
function relayedOnly(round: TabDiscoveryRound): string {
  if (round.relayedOnly.length === 0 && round.stalled.length === 0) {
    return absence('fabric/relayed-only', 'unavailable')
  }
  const lines = round.relayedOnly.map(
    (peer) =>
      `${peer} — reachable only through the relay, which may not carry a job` +
      (round.stalled.includes(peer) ? ' · no longer being retried' : ''),
  )
  // A stalled peer this tab no longer holds at all: reported rather than dropped, because
  // "I gave up on this pair" outliving the connection is still the honest end state.
  for (const peer of round.stalled) {
    if (!round.relayedOnly.includes(peer)) lines.push(`${peer} — no longer being retried`)
  }
  return lines.join('\n')
}

/** F21 — the peer id and every address, or UI-SPEC's sentence for a tab with none. */
function addressLines(addresses: TabAddresses): string {
  const dialable = [...addresses.webrtc, ...addresses.circuit]
  if (dialable.length === 0) return absence('fabric/addresses', 'unavailable')
  return [addresses.peerId, ...dialable].join('\n')
}

/**
 * The whole fabric-state surface, from one record — F1 through F21 and the text view.
 *
 * Every one of the twenty-one readings is in the returned record in **every** arm, so no
 * region can keep a value from a previous pass: a reading with nothing to show carries a
 * named absence or a thrown message, and a stale reading is a placeholder that used to be
 * true.
 */
export function format(readings: FabricReadings): SurfaceRender {
  const running = readings.activity !== null
  // The state an absent reading falls back to. With no node that is the stopped sentence,
  // which is what P3 asserts on a page that has one. With a node, an absent reading means
  // the page has not asked yet — F1 through F5's "no discovery round has run".
  const state: 'initial' | 'stopped' = running ? 'initial' : 'stopped'
  const regions: Record<string, string> = {}

  // ---- F1, F2, F3, F4, F5 — who this tab is connected to, and which of them can work ----
  regions['fabric/peers-all'] = read(readings.peers, 'fabric/peers-all', state, (peers) =>
    plural(peers.length, 'connection'),
  )
  regions['fabric/compute-peers'] = read(
    readings.computePeers,
    'fabric/compute-peers',
    state,
    (peers) => plural(peers.length, 'peer'),
  )
  regions['fabric/held-peers'] = read(readings.heldPeers, 'fabric/held-peers', state, (held) =>
    plural(held.filter((peer) => peer.carriesWork).length, 'peer'),
  )
  regions['fabric/peer-rows'] = read(readings.heldPeers, 'fabric/peer-rows', state, peerRows)
  regions['fabric/relayed-only'] = read(
    readings.discovery,
    'fabric/relayed-only',
    state,
    relayedOnly,
  )

  // ---- F6, F7, F8 — the last receipt, in the kernel's own words -------------------------
  //
  // `attestationLines` is imported rather than reimplemented, for the reason this file's
  // header gives: one result, one author of the sentence that describes it.
  const attestation = readings.attestation
  if (attestation === undefined || attestation === null) {
    regions['fabric/attestation-strength'] = absence('fabric/attestation-strength', state)
    regions['fabric/attestation-description'] = absence('fabric/attestation-description', state)
    regions['fabric/attestation-counts'] = absence('fabric/attestation-counts', state)
  } else if ('kind' in attestation) {
    // The named absence arm — a statement, never a blank and never a weaker label.
    regions['fabric/attestation-strength'] = attestation.kind
    // Verbatim. P8 compares this against a fresh reading taken in the same page.
    regions['fabric/attestation-description'] = attestation.reason
    regions['fabric/attestation-counts'] = attestationLines(attestation)[0] ?? ''
  } else {
    regions['fabric/attestation-strength'] = attestation.strength
    regions['fabric/attestation-description'] = attestation.description
    regions['fabric/attestation-counts'] =
      `${plural(attestation.replicas, 'replica')} from ${plural(attestation.operators.length, 'operator')}` +
      ` · shared relay: ${attestation.sharedRelay ?? 'none — the paths were independent'}`
  }

  // ---- F9, F10, F11 — what left this device on the last run -----------------------------
  const egress = readings.egress
  const egressText = egressLines(egress)
  if (egress === undefined || egress === null) {
    regions['fabric/egress-frames'] = absence('fabric/egress-frames', state)
    regions['fabric/egress-bytes'] = absence('fabric/egress-bytes', state)
    regions['fabric/egress-withheld'] = absence('fabric/egress-withheld', state)
  } else {
    regions['fabric/egress-frames'] = plural(egress.entries.length, 'frame')
    regions['fabric/egress-bytes'] = `${egress.totalBytes} byte(s)`
    // UI-SPEC section 5.2 — the figure and its sentence are ONE region and ONE function.
    // Splitting them is P7's plant, and the bare count reads as a sovereignty proof.
    regions['fabric/egress-withheld'] = egressText.join('\n').trim()
  }

  // ---- F12, F13 — this tab's own cap and the slots it advertises ------------------------
  regions['fabric/duty-user'] = read(readings.capacity, 'fabric/duty-user', state, (capacity) =>
    capacity.dutyCycle.toFixed(2),
  )
  regions['fabric/slots'] = read(readings.capacity, 'fabric/slots', state, (capacity) =>
    plural(capacity.slots, 'slot'),
  )

  // ---- F14, F15, F16 — the visibility governor ------------------------------------------
  regions['fabric/governor-hidden'] = read(
    readings.governor,
    'fabric/governor-hidden',
    state,
    (governor) => yesNo(governor.hidden),
  )
  regions['fabric/governor-duty'] = read(
    readings.governor,
    'fabric/governor-duty',
    state,
    (governor) => governor.dutyCycle.toFixed(2),
  )
  regions['fabric/governor-transitions'] = read(
    readings.governor,
    'fabric/governor-transitions',
    state,
    (governor) => `${plural(governor.transitions, 'transition')} · ${governor.sleptMs} ms slept`,
  )

  // ---- F17 — the page hosting this node. Three booleans, and no node needed for any ------
  regions['fabric/isolation'] = read(
    readings.isolation,
    'fabric/isolation',
    state,
    (isolation) =>
      `cross-origin isolated: ${yesNo(isolation.crossOriginIsolated)}` +
      ` · SharedArrayBuffer: ${yesNo(isolation.hasSharedArrayBuffer)}` +
      ` · in an iframe: ${yesNo(isolation.inIframe)}`,
  )

  // ---- F18, F19 — the start outcome, and the cliff named rather than shown ---------------
  regions['fabric/start-reached'] = read(
    readings.startReport,
    'fabric/start-reached',
    state,
    startReached,
  )
  regions['fabric/start-tallies'] = read(
    readings.startReport,
    'fabric/start-tallies',
    state,
    startTallies,
  )

  // ---- F20, F21 — blocks held, and where this tab can be dialled -------------------------
  const activity = readings.activity
  regions['fabric/blocks'] = read(readings.storedBlocks, 'fabric/blocks', state, (blocks) =>
    activity === null
      ? plural(blocks, 'block')
      : `${plural(blocks, 'block')} held · ${activity.fetched} pulled · ${activity.rejected} refused for a CID mismatch`,
  )
  regions['fabric/addresses'] = read(readings.addresses, 'fabric/addresses', state, addressLines)

  // ---- the text view --------------------------------------------------------------------
  //
  // `#fabric-report`, and it is NOT `#report`. The two sit on one surface, which is exactly
  // the arrangement in which somebody later merges them, so both carry a comment saying
  // what they are: `#report` is `describeStartReport`'s own output, reformatted by nobody,
  // and this one is written from the record below — the same record the regions come from,
  // which is what makes P6 assertable.
  const text: string[] = running
    ? [
        'Connections and peers:',
        `  every libp2p connection: ${regions['fabric/peers-all']}`,
        `  peers that answered an offer: ${regions['fabric/compute-peers']}`,
        `  peers held over a connection that can carry a job: ${regions['fabric/held-peers']}`,
        '',
        regions['fabric/peer-rows'] ?? '',
        '',
        regions['fabric/relayed-only'] ?? '',
        '',
        'Capacity and the governor:',
        `  effective rate: ${regions['fabric/duty-user']}`,
        `  slots advertised: ${regions['fabric/slots']}`,
        `  tab in the background: ${regions['fabric/governor-hidden']}`,
        `  the governor's own rate: ${regions['fabric/governor-duty']}`,
        `  ${regions['fabric/governor-transitions']}`,
        '',
        `This page: ${regions['fabric/isolation']}`,
        '',
        'Start outcomes:',
        `  ${regions['fabric/start-reached']}`,
        regions['fabric/start-tallies'] ?? '',
        '',
        'Blocks and addresses:',
        `  ${regions['fabric/blocks']}`,
        regions['fabric/addresses'] ?? '',
        '',
        'How strongly the last answer was attested:',
        `  ${regions['fabric/attestation-strength']}`,
        `  ${regions['fabric/attestation-description']}`,
        `  ${regions['fabric/attestation-counts']}`,
        '',
        `Frames sent on the last run: ${regions['fabric/egress-frames']}`,
        `Bytes sent on the last run: ${regions['fabric/egress-bytes']}`,
        ...(egress === undefined || egress === null
          ? [regions['fabric/egress-withheld'] ?? '']
          : egressText),
      ]
    : [SURFACE_STOPPED]

  return { regions, text }
}
