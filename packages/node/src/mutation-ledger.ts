/**
 * The mutation ledger — every deliberate defect this repository has proved a test
 * can see, written down as data instead of prose.
 *
 * ## Why this exists
 *
 * Phase 13.1's verification planted ten defects by hand and watched nine of them go
 * red. That exercise established something real and then threw it away: the record
 * lived in a report, so if somebody later deletes one of these lines, nothing
 * re-checks that a test still notices. A mutation proved once is not a guard; a
 * mutation re-proved on demand is.
 *
 * ## Two layers read this file, and they answer different questions
 *
 * - `mutation-guard.node.test.ts` runs in the ordinary suite and plants **nothing**.
 *   It asks whether each entry still *describes* the source: that its {@link
 *   Mutation.find} text appears in its file exactly once, and that every file named
 *   in {@link Mutation.caughtBy} is still on disk.
 * - `mutation-guard.mutate.ts` is a script — `npm run test:mutations` — that plants
 *   each mutation for real, runs its `caughtBy` files, and requires a non-zero exit
 *   carrying the recorded {@link Mutation.signature}.
 *
 * The split is not about speed. Planting a mutation rewrites a source file while
 * vitest is running other files in the same process pool, and a test that edits
 * `agent.ts` while a sibling file imports it is not a test, it is a race.
 *
 * ## The failure mode the cheap layer catches
 *
 * A `find` string that no longer matches is a guard that has silently stopped
 * guarding, and it reads exactly like a healthy one — the mutation simply never
 * applies. This repository has already shipped that bug once, in its own disclosure
 * gate: the pattern for `wrangler pages deploy` required the verb to follow the tool
 * name directly, so it matched nothing, and every absence assertion built on it
 * passed for as long as it existed. See the instrument check in
 * `disclosure-gate.node.test.ts`, which is the same idea one file over.
 *
 * ## What a `signature` is, and what it is not
 *
 * It is a substring **observed** in the failing run's output, not a prediction. Each
 * one below was read off a real planted run on 2026-07-29 and pasted back. It exists
 * so that "the suite went red" is not accepted on its own: a mutation that trips an
 * unrelated flake, a port collision or an OOM would also produce a non-zero exit,
 * and that is not evidence the guard saw anything.
 *
 * Pure module: data and one predicate. No I/O, so both layers can import it and the
 * script can import it without a test runner.
 */

/** One deliberate defect, and the evidence that something notices it. */
export interface Mutation {
  /** Stable id. Referred to by the report the script prints and by nothing else. */
  readonly id: string
  /**
   * What breaks in the world if this line goes, in prose. Not a restatement of the
   * diff — a diff is already below — but the reason the line is load-bearing.
   */
  readonly why: string
  /** Repo-relative POSIX path of the file the mutation edits. */
  readonly file: string
  /**
   * Exact source text to replace. Must occur **exactly once** in `file`: zero means
   * the ledger has drifted off the source and this entry guards nothing, and two or
   * more means the mutation is not well defined.
   */
  readonly find: string
  /** What `find` becomes. Empty string deletes the matched text. */
  readonly replace: string
  /**
   * Test files that were **measured** to fail with this mutation planted, as
   * repo-relative POSIX paths. Not the set that ought to catch it — the set that
   * did, on the run recorded in each entry.
   */
  readonly caughtBy: readonly string[]
  /**
   * A substring of the failing run's output, observed rather than predicted. The
   * script requires it, so a non-zero exit produced by something other than this
   * guard does not count as the guard working.
   */
  readonly signature: string
}

/**
 * Every mutation, with the run that established it.
 *
 * The ten `M*` entries are Phase 13.1's ledger, re-verified against current source
 * before being encoded here — `M3a` in particular had been surviving and was closed
 * by `82220c2` in the meantime, so its `caughtBy` is new. The two `B*` entries are
 * the benchmark driver's admission wiring, whose sentinel reversion is caught by the
 * structural count in `serve-agent-hooks.node.test.ts`.
 *
 * Every `caughtBy` and every `signature` below was measured on 2026-07-29 by
 * planting the mutation and running exactly the listed files under
 * `vitest run --project node`.
 */
export const MUTATIONS: readonly Mutation[] = [
  {
    id: 'M1',
    why:
      "SCHED-06. The exec branch must *take* a slot, and `offer()` is the taking form; " +
      '`would()` is the same question asked without consuming anything, which is what the ' +
      "`offer` request branch answers with. Swapping them leaves the bound readable and " +
      'inert — every concurrent exec is admitted, `peakInFlight` climbs past `slots`, and ' +
      'no requestor is ever told `over-committed:`.',
    file: 'packages/net/src/agent.ts',
    find: 'const admission = capacity.offer({ shardId: slotKey, nodeId: executor.nodeId })',
    replace: 'const admission = capacity.would({ shardId: slotKey, nodeId: executor.nodeId })',
    caughtBy: ['packages/net/src/admission.test.ts', 'packages/node/src/admission.node.test.ts'],
    signature: 'expected 32 to be less than or equal to 2',
  },
  {
    id: 'M2a',
    why:
      'SCHED-06. `FabricNode.start` hands `serveAgent` a real `LocalCapacity`. The sentinel ' +
      'is what shipped for two milestones, and under it the exec branch runs ' +
      '`executor.execute` with nothing counting what is in flight — measured at 64 ' +
      'simultaneous executions and zero refusals. Reverting the line restores exactly that ' +
      'state, so this is the regression a reader would least expect to be caught and most ' +
      'expect to pass review.',
    file: 'packages/node/src/fabric-node.ts',
    find: '      capacity: admission,',
    replace: "      capacity: 'accepts-every-offer',",
    caughtBy: [
      'packages/node/src/admission.node.test.ts',
      'packages/node/src/serve-agent-hooks.node.test.ts',
    ],
    signature: 'expected 64 to be less than or equal to 2',
  },
  {
    id: 'M2b',
    why:
      'The same reversion on the browser factory. `BrowserNode.start` needs a real ' +
      '`indexedDB` and a relay to dial, so it runs in neither vitest project and no ' +
      'behavioural test can reach it — the only instrument is the structural count in ' +
      '`serve-agent-hooks.node.test.ts`. That is a weaker guard than `M2a` has, and ' +
      'recording it as a separate entry is what keeps the difference visible instead of ' +
      'letting one strong result cover for two call sites.',
    file: 'packages/browser/src/browser-node.ts',
    find: '      capacity: admission,',
    replace: "      capacity: 'accepts-every-offer',",
    caughtBy: ['packages/node/src/serve-agent-hooks.node.test.ts'],
    signature: 'browser-node.ts: real onDispatch, real admission, four sentinels',
  },
  {
    id: 'M3a',
    why:
      'NET-08 asks `readMessage` to enforce the cap **and** reset the stream past it. This ' +
      'entry exists because the abort half was, for a while, proved by nothing: deleting ' +
      'the line left 22 tests across three files green. `82220c2` added the two readings ' +
      'that see it — the sender still holding a yamux window is told, and the receiver ' +
      'logs the reason — so the entry is here to keep that closed rather than to record ' +
      'that it once was.',
    file: 'packages/libp2p/src/libp2p-transport.ts',
    find: '      stream.abort(error)\n',
    replace: '',
    caughtBy: ['packages/node/src/transport-bounds.node.test.ts'],
    signature: "expected 'resolved' not to be 'resolved'",
  },
  {
    id: 'M3b',
    why:
      'NET-08, the cap itself. Multiplying the bound by 100 keeps every declared limit ' +
      'readable and stops it binding at any size a test ships, which is the shape a ' +
      '"temporarily raise this while I debug" edit leaves behind. It is deliberately not ' +
      'a deletion: a deleted `if` fails to compile-check as obviously wrong, while a ' +
      'loosened one looks like a tuning decision.',
    file: 'packages/libp2p/src/libp2p-transport.ts',
    find: 'if (total > max) {',
    replace: 'if (total > max * 100) {',
    caughtBy: [
      'packages/node/src/transport-bounds.node.test.ts',
      'packages/node/src/admission.node.test.ts',
    ],
    signature: 'a node started with a small maxMessageBytes refuses a frame a default node accepts',
  },
  {
    id: 'M4',
    why:
      "NET-09's per-peer send gate. With the condition always true, every send takes a " +
      'slot immediately: nothing queues, nothing is refused, and the receiving muxer hits ' +
      "`MaxEarlyStreamsError` instead — a tear-down that surfaces as reset streams and " +
      'reads like packet loss. The gate is the difference between a named refusal this ' +
      'node made and a connection the peer killed.',
    file: 'packages/libp2p/src/libp2p-transport.ts',
    find: 'if (gate.active < this.#maxStreamsPerPeer) {',
    replace: 'if (true) {',
    caughtBy: ['packages/node/src/transport-bounds.node.test.ts'],
    signature: 'to be an instance of SendRefused',
  },
  {
    id: 'M5',
    why:
      "NET-09's classification. A send this node's own bound refused is a `sender` " +
      'failure — the peer was never asked — and every other rejection is `node`. Disabling ' +
      'the branch records a dead peer where there was a live one this node declined to ' +
      'call, which is the reading `runResilient` retries on.',
    file: 'packages/net/src/churn.ts',
    find: "if (cause instanceof RpcFailure && cause.detail.kind === 'send-refused') {",
    replace: "if (false && cause instanceof RpcFailure && cause.detail.kind === 'send-refused') {",
    caughtBy: ['packages/net/src/churn.test.ts'],
    signature: "expected 'node' to be 'sender'",
  },
  {
    id: 'M6',
    why:
      "NET-10, on the exec branch. `EgressGuard.send` still refuses the frame, so the " +
      'bytes do not leave either way — what the pre-scan buys is that the requestor is ' +
      '*told*. Without it the responding leg of `rpc.ts` swallows the refusal by design ' +
      'and the requestor waits out its whole budget, unable to tell "your data may not ' +
      'leave that node" from "that node is gone". This is the mutation that proves a ' +
      'sovereignty refusal is legible and not merely effective.',
    file: 'packages/net/src/agent.ts',
    find: 'const violated = refusedReason(egress, from, candidateBody, executor.nodeId)',
    replace: 'const violated = null',
    caughtBy: [
      'packages/net/src/sovereign-egress.test.ts',
      'packages/net/src/sovereign-execution.test.ts',
      'packages/node/src/named-refusal.node.test.ts',
    ],
    signature: 'stops a map step that forgot to aggregate and tried to ship its input',
  },
  {
    id: 'M7',
    why:
      "DATA-10. `submitJobWithEgress` registers each sovereign shard's input on every " +
      'supplied guard before the job runs, and gives the holds back in a `finally`. ' +
      'Removing the registration leaves the release loop and the manifest slicing intact, ' +
      'so the code still looks like it is guarding something — and the raw row crosses the ' +
      'wire inside a block reply.',
    file: 'packages/net/src/submit-with-egress.ts',
    find: 'for (const guard of guards) guard.guard(label, encoded.bytes)',
    replace: 'void label',
    caughtBy: ['packages/node/src/sovereign-block-refusal.node.test.ts'],
    signature: '63 raw bytes inside a 106-byte frame',
  },
  {
    id: 'M8',
    why:
      'NET-10, on the block branch. Same mechanism as `M6` one branch over, and it needs ' +
      'its own entry because it fails differently: a block request for registered bytes ' +
      'that is not pre-scanned is not refused-and-named, it hangs until the requestor’s ' +
      'budget expires. A peer cannot tell that from a node that has gone away.',
    file: 'packages/net/src/agent.ts',
    find: 'const violated = refusedReason(options.egress, from, encodeResponse(found), executor.nodeId)',
    replace: 'const violated = null',
    caughtBy: [
      'packages/net/src/named-refusal.test.ts',
      'packages/node/src/named-refusal.node.test.ts',
      'packages/node/src/sovereign-block-refusal.node.test.ts',
    ],
    signature: 'does ask, on the same instrument, once something is registered',
  },
  {
    id: 'B1',
    why:
      "SCHED-06 on the benchmark driver's requestor endpoint. This matters beyond tidiness: " +
      'the memory-transport curve in `.planning/BENCHMARK-RESULTS.md` was measured with the ' +
      'sentinel at both of this driver’s `serveAgent` calls while the real-transport ' +
      'curve went through `FabricNode.start` and did admit, so the two published curves ' +
      'were taken under different node behaviour. Re-adding the sentinel at *either* call ' +
      'site puts that back.',
    file: 'packages/node/src/bin/bench.ts',
    find: "capacity: new LocalCapacity({ nodeId: 'requestor', maxConcurrent: DECLARED_ADMISSION_LIMIT }),",
    replace: "capacity: 'accepts-every-offer',",
    caughtBy: ['packages/node/src/serve-agent-hooks.node.test.ts'],
    signature: 'bin/bench.ts: two call sites, real admission at both, five sentinels twice',
  },
  {
    id: 'B2',
    why:
      'The same reversion on the driver’s worker loop. Two entries and not one, because ' +
      'the count that catches them is a count over the whole file: a single entry would be ' +
      'satisfied by a guard that only ever sees one of the two call sites, and this pair is ' +
      'what proves it sees either.',
    file: 'packages/node/src/bin/bench.ts',
    find: 'capacity: new LocalCapacity({ nodeId: id, maxConcurrent: DECLARED_ADMISSION_LIMIT }),',
    replace: "capacity: 'accepts-every-offer',",
    caughtBy: ['packages/node/src/serve-agent-hooks.node.test.ts'],
    signature: 'bin/bench.ts: two call sites, real admission at both, five sentinels twice',
  },
]

/** Literal occurrences of `needle` in `text`. `needle` must be non-empty. */
export function occurrences(text: string, needle: string): number {
  if (needle.length === 0) return 0
  return text.split(needle).length - 1
}

/**
 * Everything wrong with one entry, as human-readable lines. Empty means healthy.
 *
 * A pure function of the entry and the file's current text, so the ordinary test can
 * run it over the real tree *and* over synthetic content that proves it can fail —
 * which is the only way to know an empty result means "healthy" rather than "not
 * looking".
 *
 * `content` is `null` when the file is not on disk at all; that is a distinct
 * failure from a `find` that no longer matches, and it is reported as one.
 */
export function problemsWith(
  entry: Mutation,
  content: string | null,
  caughtByOnDisk: readonly boolean[],
): string[] {
  const problems: string[] = []
  if (entry.id.length === 0) problems.push('has no id')
  if (entry.why.length < 40) {
    problems.push(`${entry.id}: the reason is too short to be a reason — write why the line matters`)
  }
  if (entry.signature.length === 0) {
    problems.push(
      `${entry.id}: declares no failure signature, so a non-zero exit from an unrelated ` +
        'flake would be accepted as proof the guard fired',
    )
  }
  if (entry.caughtBy.length === 0) {
    problems.push(`${entry.id}: names no test that catches it, so the script would run nothing`)
  }
  if (entry.find === entry.replace) {
    problems.push(`${entry.id}: find and replace are identical, so nothing is mutated`)
  }
  if (content === null) {
    problems.push(`${entry.id}: ${entry.file} is not on disk`)
  } else {
    const count = occurrences(content, entry.find)
    if (count === 0) {
      problems.push(
        `${entry.id}: ${entry.file} no longer contains its find text — this mutation has ` +
          'stopped applying, and a mutation that cannot be planted guards nothing. ' +
          `Was: ${JSON.stringify(entry.find)}`,
      )
    } else if (count > 1) {
      problems.push(
        `${entry.id}: ${entry.file} contains its find text ${count} times, so the mutation ` +
          'is ambiguous — narrow it until it names one site',
      )
    }
  }
  for (const [index, present] of caughtByOnDisk.entries()) {
    if (!present) problems.push(`${entry.id}: caughtBy names ${entry.caughtBy[index]}, which is not on disk`)
  }
  return problems
}
