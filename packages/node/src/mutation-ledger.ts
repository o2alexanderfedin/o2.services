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
 *   Mutation.find} text appears in its file exactly once, that every file named in
 *   {@link Mutation.caughtBy} is still on disk, and — for the entries whose
 *   {@link Mutation.signatureSource} says the signature is source text — that the
 *   test it names is still in one of those files.
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
 * A signature is therefore *output*, and most output has no literal in any file. But
 * a large majority of these — **60 of the 82**, re-counted 2026-08-04 — are the test's own
 * title, which vitest echoes verbatim, and a title **is** source text. (This sentence read
 * *"26 of the 40"* earlier that day, then *"48 of the 72"*, and **the second figure was
 * already stale by eight when it was written**: the ledger held 78 entries and 56 titles at
 * the moment it was re-counted. So the sentence warning that a count written into prose
 * expires exactly the way a `find` string does has now expired twice, in the same file, in
 * the paragraph that says so. Nothing reads it, which is the whole point — and the right
 * fix is a derived count, not a third transcription.) That is the half the cheap layer
 * can check, and until 2026-08-01 it did not: `B1` and `B2` named a test that had
 * been renamed from `five sentinels` to `six` four commits earlier, and every
 * ordinary run stayed green because nothing compared the signature to anything.
 * {@link Mutation.signatureSource} is how each entry says which half it is in, and
 * {@link problemsWith} checks the half that can be checked and states plainly that
 * it checks nothing about the other.
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
  /**
   * Where the {@link Mutation.signature} text comes from — and therefore whether the
   * cheap layer can check it at all.
   *
   * This is declared per entry rather than guessed from the string, and that is the
   * whole point of the field. A classifier that sniffed the text would put `M7`'s
   * `63 raw bytes inside a 106-byte frame` in the greppable arm — it has none of the
   * `expected `/`AssertionError` markers an assertion string carries — and then fail
   * an entry that is perfectly healthy, because that sentence is assembled from a
   * template at run time and exists nowhere in source. Guessing is wrong in both
   * directions here, so nothing guesses.
   *
   * - `test-title` — the signature is verbatim source text in at least one
   *   {@link Mutation.caughtBy} file, normally the `it(...)`/`describe(...)` title
   *   vitest prints on the FAIL line. Drift is a string comparison, so
   *   {@link problemsWith} makes it one.
   * - `rendered-at-runtime` — the signature is produced while the test runs:
   *   assertion output (`expected 32 to be less than or equal to 2`), runner output
   *   (`Error: Test timed out in 5000ms.`), or refusal text built from a template
   *   (`63 raw bytes inside a 106-byte frame`). There is no literal in source to
   *   compare against, so the cheap layer checks **nothing** about these and says so
   *   rather than implying otherwise.
   */
  readonly signatureSource: 'test-title' | 'rendered-at-runtime'
  /**
   * The vitest project the `caughtBy` files belong to. Defaults to `node`.
   *
   * Present because one defect in this ledger lives in rendered text on a real page,
   * and nothing below the `e2e` project can observe a template string. Without this
   * the script would run `--project node` over an `*.e2e.test.ts`, match no files,
   * and report a failure that has nothing to do with the mutation.
   */
  readonly project?: 'node' | 'e2e'
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
 * The three `P*` entries are `packages/bench/src/perf-workload.ts`, added 2026-08-04 for
 * defect #19. They are worth a sentence because of what the count was before them:
 * **sixty-seven entries and not one mention of that file**, against a tracked non-test
 * source holding two production `serveAgent` call sites and one production
 * `RemoteExecutor` site. The sites were not wrong — `19-15` and `19-16` ruled that both
 * keep the `attest` sentinel permanently, because neither holds a certificate — they were
 * simply somewhere this ledger did not look, which is a different failure and the one
 * that lets a file drift from its four siblings silently. `P3` in particular records the
 * one hook where it already had.
 *
 * The two `E*` entries are AUTH-04's cost half, added the same day for defect #20. They
 * pin an exposure the owner **accepted** on 2026-08-02 rather than a guarantee, which
 * makes them the only entries here whose correct end is deletion: when a price at the
 * enrolment frame is ruled in, they and their readings go, and nothing about them may be
 * loosened in the meantime to keep a suite green.
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
    signatureSource: 'rendered-at-runtime',
  },
  {
    id: 'M2a',
    why:
      'SCHED-06. `FabricNode.start` hands `serveAgent` a real `LocalCapacity`. The sentinel ' +
      'is what shipped for two milestones, and `fabric-node.ts`’s own comment records what ' +
      'that cost when it was finally measured: 64 simultaneous `executor.execute()` calls, ' +
      'zero refusals, and half the requestors’ RPCs timed out waiting. Reverting this one ' +
      'line puts that back — which makes it the regression a reader would least expect to ' +
      'be caught and most expect to pass review.',
    file: 'packages/node/src/fabric-node.ts',
    find: '      capacity: admission,',
    replace: "      capacity: 'accepts-every-offer',",
    caughtBy: [
      'packages/node/src/admission.node.test.ts',
      'packages/node/src/serve-agent-hooks.node.test.ts',
    ],
    signature: 'expected 64 to be less than or equal to 2',
    signatureSource: 'rendered-at-runtime',
  },
  {
    id: 'M2b',
    why:
      'The same reversion on the browser factory, and the only instrument that sees it ' +
      'is still the structural count in `serve-agent-hooks.node.test.ts` — a weaker ' +
      'guard than `M2a` has, which is why this is a separate entry rather than one ' +
      'strong result covering two call sites. **The reason is not that the factory is ' +
      'unreachable.** That claim stood here until 2026-07-31 and was false: the `e2e` ' +
      'project drives a real tab from Node, and `M30` below plants a defect in this ' +
      'same file and watches a live tab catch it. **The sentence that used to close this ' +
      'entry said the admission bound had never been read through a tab, and Plan 19-04 ' +
      'made it false** — `M59` below is that reading, taken off a real reply frame with ' +
      'the number in its text. This entry is not retired with it: the two are caught by ' +
      'different layers, a source-text count here and a live tab there, and a fix to one ' +
      'has never implied a fix to the other. What remains true is why the reading had to ' +
      'go to `e2e`: the `browser` project genuinely cannot host it, because a Circuit ' +
      'Relay v2 server *"will not work in browsers"* in `@libp2p/circuit-relay-v2`’s own ' +
      'words.',
    file: 'packages/browser/src/browser-node.ts',
    find: '      capacity: admission,',
    replace: "      capacity: 'accepts-every-offer',",
    caughtBy: ['packages/node/src/serve-agent-hooks.node.test.ts'],
    signature: 'browser-node.ts: real onDispatch, real admission, four sentinels',
    signatureSource: 'test-title',
  },
  {
    id: 'M3a',
    why:
      'NET-08 asks `readMessage` to enforce the cap **and** reset the stream past it. This ' +
      'entry exists because the abort half was, for a while, proved by nothing — `82220c2` ' +
      'records that deleting the line left 22 tests across three files green — and that ' +
      'commit added the two readings that see it: the sender still holding a yamux window ' +
      'is told, and the receiver logs the reason. The entry is here to keep that closed, ' +
      'not to commemorate that it once was not. Re-indented on 2026-07-30 when the ' +
      "accumulation budget's `try`/`finally` wrapped the loop; same line, two spaces " +
      'deeper, and the find text was moved with it rather than dropped.',
    file: 'packages/libp2p/src/libp2p-transport.ts',
    find: '        stream.abort(error)\n',
    replace: '',
    caughtBy: ['packages/node/src/transport-bounds.node.test.ts'],
    signature: "expected 'resolved' not to be 'resolved'",
    signatureSource: 'rendered-at-runtime',
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
    signatureSource: 'test-title',
  },
  {
    id: 'M13',
    why:
      'NET-08, the per-peer half. The cap above it bounds one message; this line is the ' +
      'whole of what bounds one peer. Without it a peer opens streams it never finishes ' +
      'and every message stays legal, so `refusedInbound` reads 0 while the accumulations ' +
      'add up — measured on 2026-07-30 at 65 MB retained against an 8 MiB budget for 32 ' +
      'streams, and the reproduction that opened this bug measured 263 MB at the shipped ' +
      'cap. It is the one line, so deleting it is the honest mutation.',
    file: 'packages/libp2p/src/libp2p-transport.ts',
    find: '      budget.charge(flat.byteLength)\n',
    replace: '',
    caughtBy: ['packages/node/src/transport-bounds.node.test.ts'],
    signature: 'refuses accumulation past the budget while every single message stays in limit',
    signatureSource: 'test-title',
  },
  {
    id: 'M4',
    why:
      "NET-09's per-peer send gate. With the condition always true every send takes a slot " +
      'immediately: nothing queues and nothing is refused. What the planted run actually ' +
      'shows — quoted rather than predicted, because `libp2p-transport.ts` sites this bound ' +
      "against libp2p's `maxEarlyStreams` and it would be easy to assume that is the error " +
      'you get — is `StreamResetError: The stream has been reset`, raised from yamux’s ' +
      '`onRemoteReset`, arriving where the test expected a `SendRefused` this node had ' +
      'raised itself. That is the whole point of the gate: a tear-down the peer performed, ' +
      'standing in for a refusal this node should have made and could have named.',
    file: 'packages/libp2p/src/libp2p-transport.ts',
    find: 'if (gate.active < this.#maxStreamsPerPeer) {',
    replace: 'if (true) {',
    caughtBy: ['packages/node/src/transport-bounds.node.test.ts'],
    signature: 'to be an instance of SendRefused',
    signatureSource: 'rendered-at-runtime',
  },
  {
    id: 'M14',
    why:
      'The release for the one resource `FabricNode.start` acquires before anything that ' +
      'can fail. `createLibp2p` has bound a listening socket by that line, and every step ' +
      'after it used to reject with the socket still bound and no handle anywhere to close ' +
      'it. The second attempt then failed with EADDRINUSE, which names the wrong problem ' +
      'entirely. **This entry used to name the relay dials as the likeliest such failure, ' +
      'and Plan 18-11 made that false**: NET-05 rules that a node which could not reach one ' +
      'relay can still work, so that dial no longer rejects at all. The trigger moved to an ' +
      'unreachable enrollment provider, which fails in the same place — after the bind, and ' +
      'over the network — and the signature below moved with it.',
    file: 'packages/node/src/fabric-node.ts',
    find: '    undo.push(() => libp2p.stop())\n',
    replace: '',
    caughtBy: ['packages/node/src/start-unwind.node.test.ts'],
    signature: 'gives the port back when a provider dial fails',
    signatureSource: 'test-title',
  },
  {
    id: 'M15',
    why:
      'The same release one composition up, and its own entry because a seed strands more: ' +
      'the node it started holds two bound listeners, the WebSocket port a browser dials ' +
      'and the plain TCP one another node dials. The throw that reaches it is not exotic — ' +
      'a Vite server that cannot bind, or the node binding no WebSocket port at all — and ' +
      'both sit after `FabricNode.start` has returned.',
    file: 'packages/node/src/seed-server.ts',
    find: '    undo.push(() => node.stop())\n',
    replace: '',
    caughtBy: ['packages/node/src/start-unwind.node.test.ts'],
    signature: 'stops the node it already started when the HTTP server cannot bind',
    signatureSource: 'test-title',
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
    signatureSource: 'rendered-at-runtime',
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
    signatureSource: 'test-title',
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
    find: 'for (const guard of guards) held.push(guard.guard(label, encoded.bytes))',
    replace: 'void label',
    caughtBy: ['packages/node/src/sovereign-block-refusal.node.test.ts'],
    signature: '63 raw bytes inside a 106-byte frame',
    signatureSource: 'rendered-at-runtime',
  },
  {
    id: 'M8',
    why:
      'NET-10, on the block branch. Same mechanism as `M6` one branch over, and it needs ' +
      'its own entry because it fails differently: a block request for registered bytes ' +
      'that is not pre-scanned is not refused-and-named, it hangs until the requestor’s ' +
      'budget expires. A peer cannot tell that from a node that has gone away.',
    file: 'packages/net/src/agent.ts',
    // The line grew a second consultation on 2026-08-02 — DATA-10's durable CID set is
    // asked before the payload scan. `find` follows it rather than being loosened: an
    // entry that matched a prefix would keep passing while the half it names stopped
    // running. `replace` nulls BOTH consultations, because either one surviving would
    // still refuse and this entry's claim is that the branch asks at all.
    find:
      '      const violated =\n' +
      '        durable ?? refusedReason(options.egress, from, encodeResponse(found), executor.nodeId)',
    replace: '      const violated: string | null = null',
    caughtBy: [
      'packages/net/src/named-refusal.test.ts',
      'packages/node/src/named-refusal.node.test.ts',
      'packages/node/src/sovereign-block-refusal.node.test.ts',
    ],
    signature: 'does ask, on the same instrument, once something is registered',
    signatureSource: 'test-title',
  },
  {
    id: 'M12',
    why:
      'SCHED-06 / BROW-04. The one line that makes a wall-clock bound on untrusted guest code ' +
      'exist at all. A guest `run()` is synchronous and V8 has no fuel metering, so nothing ' +
      'on the executing thread can interrupt it and killing the thread is the only mechanism ' +
      'available. Left inert, a 52-byte looping module wedges an unauthenticated node ' +
      'outright — the admission slot’s `finally` sits around an await that never settles and ' +
      'the RPC timeout’s own `setTimeout` never runs either. It is a substitution rather than ' +
      'a deletion because deleting it leaves `timer` undefined, which fails as a ' +
      'ReferenceError rather than as the hang the defect actually is.',
    file: 'packages/core/src/executor/worker-executor.ts',
    find: '      const timer = setTimeout(() => this.#expire(id), this.#deadlineMs)',
    replace: '      const timer = setTimeout(() => {}, this.#deadlineMs)',
    caughtBy: ['packages/core/src/executor/worker-executor.test.ts'],
    signature: 'Error: Test timed out in 5000ms.',
    signatureSource: 'rendered-at-runtime',
  },
  {
    id: 'M16',
    why:
      'DET-06. A refusal in `output_write` is absorbing, and this line is the whole of ' +
      'that. Without it a module spends its refusal — an over-cap write the host will not ' +
      'take — and then launders it with a small acceptable one, and the host returns the ' +
      'small write as the module’s answer with `ok: true`. It is the case that separates ' +
      'this fix from the obvious one, which clears the slot on refusal and leaves the ' +
      'mirror wide open.',
    file: 'packages/core/src/executor/wasm.ts',
    find: "          if (sink.at.state === 'refused') return\n",
    replace: '',
    caughtBy: ['packages/core/src/executor/wasm.test.ts'],
    signature: 'cannot have a refusal laundered by a smaller write that follows it',
    signatureSource: 'test-title',
  },
  {
    id: 'M10',
    why:
      'DATA-05, the taking half. `serveAgent` is the only production caller that declares a ' +
      "sovereign task's input to this node's tap, and it is the caller precisely because it " +
      'is also the layer that gives the hold back once the reply frame has settled. With this ' +
      'line inert the tap holds nothing for a dispatched sovereign task, so the reply carrying ' +
      'the raw row is scanned against an empty set and forwarded — the leak the whole of ' +
      'DATA-05 exists to stop, with every surrounding mechanism still present and looking ' +
      'correct.',
    file: 'packages/net/src/agent.ts',
    find: "        egress === 'holds-no-registrations'\n          ? null",
    replace: "        egress === 'holds-no-registrations' || true\n          ? null",
    caughtBy: ['packages/net/src/sovereign-egress.test.ts'],
    signature: 'and the tap refuses the leaking reply',
    signatureSource: 'test-title',
  },
  {
    id: 'M11',
    why:
      'DATA-05, the giving-back half. A hold is a value so that nobody can give back a hold ' +
      'they did not take — the defect where one unauthenticated public exec stripped a ' +
      "sovereign payload's guard. This flag is what stops the *same* holder doing it twice: " +
      'without it, a caller that releases on two exits decrements the count twice and steals ' +
      "a concurrent dispatch's hold, which is the identical failure reached by a different " +
      'route. `serveAgent` releases inside a `finally`, so double release is a live path.',
    file: 'packages/net/src/egress.ts',
    find: '        if (given) return\n',
    replace: '',
    caughtBy: ['packages/net/src/egress.test.ts'],
    signature: "expected [] to deeply equal [ 'alice-row' ]",
    signatureSource: 'rendered-at-runtime',
  },
  {
    id: 'M17',
    why:
      'AUTH-04. The refusal that makes a certificate name a user who consented to it. ' +
      'Left inert, anybody obtains a provider-signed certificate naming any victim’s user ' +
      'key — reproduced before the fix, `verifyCertificate` accepted it — and the victim ' +
      'is then locked out of enrolling their own nodes, because the per-owner limiter ' +
      'keys on the very field the attacker chose. A guard made inert rather than deleted, ' +
      'because that is the shape a "just let it through while I debug" edit leaves.',
    file: 'packages/core/src/enrollment.ts',
    find: '    if (!holdsOwner) {',
    replace: '    if (false) {',
    caughtBy: ['packages/core/src/enrollment.test.ts'],
    signature: 'does not let a refused cross-user request consume the victim',
    signatureSource: 'test-title',
  },
  {
    id: 'M9',
    why:
      'A reply is matched against the peer its request went to, and this expression is the ' +
      'whole of that. Keying on the id alone restores the state where any peer that could ' +
      'reach this node could answer a request it was never sent — ids are a per-endpoint ' +
      'counter and every RemoteExecutor in a job shares one endpoint, so a sibling id is one ' +
      'increment away and the first frame wins. That is enough to forge N-version agreement ' +
      'out of a single machine, which is the one claim redundant execution exists to make.',
    file: 'packages/net/src/rpc.ts',
    find: 'return `${peer}\\u0000${id}`',
    replace: 'return String(id)',
    caughtBy: ['packages/net/src/rpc.test.ts'],
    signature: "expected 'FORGED-BY-C' to be 'ANSWERED-BY-B'",
    signatureSource: 'rendered-at-runtime',
  },
  {
    id: 'M20',
    why:
      'The same guarantee, pinned at the lookup instead of at the key, because the two ' +
      'catch different edits. M9 catches a key that stops naming the peer, which breaks ' +
      'both sides at once and is obviously wrong on sight. This catches the edit that ' +
      'looks reasonable: a receive path made tolerant so a peer whose address is spelled ' +
      'slightly differently still gets its reply matched. Correlation would then be by id ' +
      'alone again, on the one side an attacker controls, while `request` went on filing ' +
      'under the destination and every comment in the file went on being true. Pinned on ' +
      'the call rather than on the key’s body so the entry survives the separator being ' +
      'respelled — `27633c7` already respelled it once, from a raw byte to an escape.',
    file: 'packages/net/src/rpc.ts',
    find: 'const key = this.#pendingKey(from, id)',
    replace: "const key = [...this.#pending.keys()].find((k) => k.endsWith(`\\u0000${id}`)) ?? ''",
    caughtBy: ['packages/net/src/rpc.test.ts'],
    signature: "expected 'FORGED-BY-C' to be 'ANSWERED-BY-B'",
    signatureSource: 'rendered-at-runtime',
  },
  {
    id: 'M21',
    why:
      'DATA-05, the exit with nothing to show for itself. A reply abandoned because the ' +
      'endpoint closed sends no frame, so the only evidence the dispatch happened at all ' +
      'is what the tap holds afterwards — which is why the `#closed` check sits inside ' +
      'the try rather than as a bare return above it. Hoisting it is the tidy any reader ' +
      'would think safe: the send is skipped either way, and every test in the file still ' +
      'passes except the one that watches the tap. What it costs is a registration that ' +
      'is never given back, scanned against every frame the node sends for the rest of ' +
      'its life, produced by the ordinary act of shutting a node down mid-dispatch.',
    file: 'packages/net/src/rpc.ts',
    find: '    try {\n      if (this.#closed) return\n',
    replace: '    if (this.#closed) return\n    try {\n',
    caughtBy: ['packages/net/src/sovereign-egress.test.ts'],
    signature: 'releases when the endpoint closes between the outcome and the frame',
    signatureSource: 'test-title',
  },
  {
    id: 'M18',
    why:
      'CHURN-01. A shard’s history has to explain itself. A speculative copy that answered ' +
      '*with a failure* after the winner was taken fell between every bucket — not ' +
      '`uncompared`, because it did answer; not in the shard’s failures, because those ' +
      'were sealed when the winner returned — while still appearing in `attempted`. ' +
      '`attempted` and the copy record are the raw material any later exclusion or scoring ' +
      'mechanism reads, so a peer that reliably fails just after losing a race accrued no ' +
      'recorded failure at all.\n\n' +
      '**RE-TARGETED by Plan 20-12, not rewritten.** This pinned `coordinator.ts`’s ' +
      '`LateOutcome` recorder and was caught by `coordinator.test.ts`; 20-12 deleted both ' +
      'under WIRE-04. The behaviour did not go with them — 20-07 built the same bucket into ' +
      '`submitJob` as `SpeculativeCopy`’s `failed` arm, with a reason composed from the ' +
      'refusing node’s own words rather than `executeVerified`’s summary sentence. So the ' +
      'entry follows its subject to the module that now holds it. The plant is the same ' +
      'act — remove the arm — and the collapse it produces is the same: a copy that ' +
      'answered with a failure reads as one that never answered.',
    file: 'packages/core/src/job/submit.ts',
    find: "              outcome: 'failed',\n",
    replace: "              outcome: 'uncompared',\n",
    caughtBy: ['packages/core/src/job/submit.test.ts'],
    signature: 'gives a losing copy that answers with a FAILURE its own bucket, neither silent nor agreeing',
    signatureSource: 'test-title',
  },
  // `M19` stood here and is gone, deleted by Phase 20 plan 06 on 2026-08-04. It pinned
  // the **absence** of a peer count beside the start-outcome panel, and its `why` rested
  // on a premise that is now false in the tree: *"a report whose every production call
  // site opts out of the ledger that would fill it"*. Plan 20-02 gave both node factories
  // a real `StartOutcomeLedger` holding their own row, so a peer answers with something
  // it observed, the merged panel carries browser families the reading tab is not, and
  // `peers answering: N of M asked` beside those rows is a truthful tally of the peers
  // whose rows are in them rather than a tally of contributors that has none. The lie was
  // the juxtaposition and the juxtaposition has stopped being one — `demo/index.html`'s
  // `refreshReport` quotes the removed sentence at the line so the history is not lost.
  //
  // **Deleted rather than left drifting, and not deleted silently.** Its `find` —
  // `showReportOnly(report.text)` — no longer occurs, so the pre-commit guard refused the
  // commit that changed the render; an entry that cannot be planted guards nothing.
  //
  // **What replaces it, measured and handed to plan 20-13**, which owns this file: the
  // inverse defect is now `peers: () => running.transport.peers` in `demo/main.ts`'s
  // `startReport`, replaced by `peers: () => []`. That renders the local ledger instead
  // of the merged one — the page still shows a plausible report, `reached` and `asked`
  // both read 0, and every foreign family row disappears. It is invisible to any
  // single-tab reading, which is why its `caughtBy` is the three-engine
  // `peer-ledger.e2e.test.ts` and not this file's older two-tab sibling. The observed
  // failure text is recorded in `20-06-SUMMARY.md`.
  {
    id: 'B1',
    why:
      "SCHED-06 on the benchmark driver's requestor endpoint. Why it matters beyond " +
      'tidiness is recorded in `serve-agent-hooks.node.test.ts` itself: the memory-transport ' +
      'curve in `.planning/BENCHMARK-RESULTS.md` was measured with the sentinel at both of ' +
      'this driver’s `serveAgent` calls while the real-transport curve went through ' +
      '`FabricNode.start` and did admit, so the two published curves were taken under ' +
      'different node behaviour. Re-adding the sentinel at *either* call site puts that back.',
    file: 'packages/node/src/bin/bench.ts',
    find: "capacity: new LocalCapacity({ nodeId: 'requestor', maxConcurrent: DECLARED_ADMISSION_LIMIT }),",
    replace: "capacity: 'accepts-every-offer',",
    caughtBy: ['packages/node/src/serve-agent-hooks.node.test.ts'],
    signature: 'bin/bench.ts: two call sites, real admission at both, six sentinels twice',
    signatureSource: 'test-title',
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
    signature: 'bin/bench.ts: two call sites, real admission at both, six sentinels twice',
    signatureSource: 'test-title',
  },
  {
    id: 'M2c',
    why:
      'SCHED-06 in the browser tier. `BrowserNode` composed a bare `WasmExecutor` whenever ' +
      '`createWorker` was omitted, so a tab ran an arbitrary peer’s WASM on its own main ' +
      'thread — where a wall-clock deadline cannot fire, because a guest `run()` is a ' +
      'synchronous call holding the very loop the timer would fire on, and where there is ' +
      'no thread to terminate. A 52-byte `loop br 0` wedged the tab permanently, `stop()` ' +
      'included. The Node tier had already been fixed by `WorkerExecutor({deadlineMs})`; ' +
      'the browser tier kept a route around it, justified in its own comment by tests that ' +
      'were never written. Restoring the branch on the option’s absence restores the ' +
      'unbounded path. The guard is a structural count rather than a behavioural one, for ' +
      'the same reason `M2b` is: the stronger half of this proof is a compile error, and ' +
      '`Mutation.project` admits no entry that would run `tsc`.',
    file: 'packages/browser/src/browser-node.ts',
    find: '    const worker = browserWorkerExecutor({',
    replace: '    const worker = options.createWorker === undefined ? null : browserWorkerExecutor({',
    caughtBy: ['packages/browser/src/browser-node-contract.node.test.ts'],
    project: 'node',
    signature:
      'browser-node.ts composes a killable thread and nothing else > constructs no main-thread executor, one worker-backed one, and branches on neither',
    signatureSource: 'test-title',
  },
  {
    id: 'M22',
    why:
      'VER-01. Reporting a disagreement is the one thing this module exists to do, and a ' +
      'majority rule is the “obvious” improvement that silently removes it: two colluding ' +
      'replicas out-vote an honest one, the fabric publishes their answer as verified, and ' +
      'the honest result appears nowhere in the record. The line is load-bearing precisely ' +
      'because the edit that breaks it reads like a fix — `groups.size > 1` must mean ' +
      'disagreement however the sizes are distributed.',
    file: 'packages/core/src/job/verify.ts',
    find: 'if (groups.size > 1) {',
    replace: 'if (groups.size > 1 && [...groups.values()].every((n) => n.length < 2)) {',
    caughtBy: ['packages/core/src/job/verify.test.ts'],
    signature: "expected 'agreed' to be 'disagreed'",
    signatureSource: 'rendered-at-runtime',
  },
  {
    id: 'M23',
    why:
      'The dial budget. `runDiscoveryRound` dials sequentially and a failed dial costs a ' +
      'full timeout, so this line is the whole of what bounds a discovery round’s wall ' +
      'clock — without it one round sits out dozens of timeouts and the tab discovers ' +
      'nothing until it returns. It lived inline in `demo/main.ts`, which does `fetch`, ' +
      'real libp2p dials and DOM notification, so no vitest project could import it: ' +
      'verification deleted the line and the whole suite stayed green. Extracting the ' +
      'decision into `dial-plan.ts` is what made the line observable at all; this entry ' +
      'is what keeps it observed.',
    file: 'packages/browser/src/dial-plan.ts',
    find: '    if (plan.length >= MAX_DIALS_PER_ROUND) break\n',
    replace: '',
    caughtBy: ['packages/browser/src/dial-plan.test.ts'],
    signature: 'stops at the budget rather than sitting out a timeout per candidate',
    signatureSource: 'test-title',
  },
  {
    id: 'M24',
    why:
      'AUTH-04, the caller-side half. `enrol` refuses a hand-assembled request naming a ' +
      'user who did not sign, but `requestEnrollment` is the path every honest node takes, ' +
      'and it closes the same hole by *derivation* rather than by refusal: the user key ' +
      'comes from the private key it is handed, so naming a stranger is not something the ' +
      'function can be asked to do. Make it honour a supplied field and a rogue enrols ' +
      'under a victim’s identity through the front door — mislabelling the certificate ' +
      'and, because the per-owner limiter keys on that same field, spending the victim’s ' +
      'enrollment window too. Restored as a `??` fallback rather than a deletion, because ' +
      '“accept it if the caller bothered to pass one” is the shape a convenience edit ' +
      'leaves behind.',
    file: 'packages/core/src/enrollment.ts',
    find: '  const userKey = toHex(ed25519.getPublicKey(userPrivateKey))',
    replace:
      '  const userKey = (fields as { userKey?: PublicKeyHex }).userKey ?? toHex(ed25519.getPublicKey(userPrivateKey))',
    caughtBy: ['packages/core/src/enrollment.test.ts'],
    signature: 'cannot be handed a user key through its fields at all',
    signatureSource: 'test-title',
  },
  {
    id: 'M25',
    why:
      'B19 as reported did not reproduce — `settleRace` stopped inventing a `taskId`, and ' +
      '`RaceOutcome.losers` is a `RaceLoser[]`, so the hollow field has no spelling there. ' +
      'What did not exist was a guard on the half that survived: ' +
      '`SpeculationLedger.discard` is now the only path that mints a `Discarded`, and ' +
      'stamping its records with `\'\'` — the exact value the split removed from ' +
      '`settleRace`, relocated to the one place that can still hold it — left every case ' +
      'in `speculation.test.ts` and `coordinator.test.ts` green. Attribution is the whole ' +
      'reason the record is kept, and it was correct by inspection only. Stated honestly: ' +
      '`discarded` has no reader in this repository yet, so this guards a record that is ' +
      'written and not yet consumed.',
    file: 'packages/core/src/speculation.ts',
    find: 'this.#discarded.push({ taskId, nodeId, disagreed })',
    replace: "this.#discarded.push({ taskId: '', nodeId, disagreed })",
    caughtBy: ['packages/core/src/speculation.test.ts'],
    signature: 'names the task each discarded copy was a copy of, over a job of several',
    signatureSource: 'test-title',
  },
  {
    id: 'M26',
    why:
      'BROW-02. The negative count this parser already dropped and the enormous one it did ' +
      'not are the same attack from opposite ends — one erases another peer’s evidence, ' +
      'the other buries it — and the second is the more effective, because ' +
      '`StartOutcomeLedger.mergeOverlapping` keeps the *largest* count it is shown ' +
      '(`start-outcome.ts:364`). One entry claiming four billion therefore decided every ' +
      'rate in a merged report by itself. Measured with the ceiling removed: an aggregate ' +
      'that should read 100 read 4000000100.',
    file: 'packages/net/src/protocol.ts',
    find: ' || count > MAX_REPORTED_COUNT',
    replace: '',
    caughtBy: ['packages/net/src/start-report.test.ts'],
    signature: 'lets no single peer decide the aggregate by claiming a number nobody can hold',
    signatureSource: 'test-title',
  },
  {
    id: 'M27',
    why:
      'DET-03/DATA-08, the Node tier. Phase 14 made `trustAnchors` a required option, but a ' +
      'required option that is read and then not composed buys nothing — the whole milestone ' +
      'exists because a well-built mechanism was read and its wiring assumed. Unwrapping the ' +
      'guard here leaves every symbol in place and every anchor still declared, and the node ' +
      'silently runs modules nobody vouched for. Measured with it unwrapped: four of the five ' +
      'cross-process cases turn `insufficient` into `agreed`, and the accepted case stays ' +
      'green — a wiring proof made only of successes would not have moved at all. ' +
      'AOT-04 moved the find text from `provenance(compute)` to `provenance(abi)` on ' +
      '2026-08-04: the guard did not move and neither did the wrap order, but what it now ' +
      'wraps is the ABI router rather than the killable-thread executor directly, so the ' +
      'unwrapping this entry plants exempts a translated artifact as well as a ' +
      'source-compiled one. The measured counts above were taken before that change and ' +
      'are left as taken.',
    file: 'packages/node/src/fabric-node.ts',
    find: 'provenance(abi)',
    replace: 'abi',
    caughtBy: ['packages/node/src/signed-artifact.node.test.ts'],
    signature: "expected 'agreed' to be 'insufficient'",
    signatureSource: 'rendered-at-runtime',
  },
  {
    id: 'M28',
    why:
      'DET-03/DATA-08, the browser tier, and the reason it needs its own entry: ' +
      '`trust-anchors.node.test.ts` stays green under this mutation, because ' +
      '`guardModuleProvenance(` is still textually present in the file and merely applied to ' +
      'nothing. A census that counts call sites cannot tell a composed guard from a decorative ' +
      'one; only a job dispatched through a real tab can. All nodes have equal functionality, ' +
      'so the browser tier needs the same proof as the Node tier rather than an argument by ' +
      'analogy from it. **The count that used to stand here — 20/20 — was measured on the ' +
      'tree of 2026-07-31 and expired**: 19-15 added the `attestResults` composition cases ' +
      'and the file now carries 26. The mutation has not been re-planted against them, so ' +
      'what this entry claims is the insensitivity and not a number; the number is struck ' +
      'rather than renumbered, because renumbering it would report a reading nobody took. ' +
      'AOT-04 moved the find text from `provenance(worker)` to `provenance(abi)` on ' +
      '2026-08-04, for the reason M27 records at its own line: the guard now wraps the ABI ' +
      'router rather than the worker executor directly, and the two tiers still spell it ' +
      'identically.',
    file: 'packages/browser/src/browser-node.ts',
    find: 'provenance(abi)',
    replace: 'abi',
    caughtBy: ['packages/node/src/two-tabs.e2e.test.ts'],
    project: 'e2e',
    signature: 'refuses a job whose record no tab pinned',
    signatureSource: 'test-title',
  },
  {
    id: 'M29',
    why:
      'DET-03 at the demo tier, and the one entry here that records a *change* rather than a ' +
      'guard. Before Phase 14, planting exactly this — both demo anchor sets emptied — changed ' +
      'nothing across fifteen e2e tests, which is what "built, not wired" reads like from the ' +
      'outside: a pinned authority nothing ever consults. It now takes the colouring job down. ' +
      'The entry exists so that if the demo ever stops dispatching its record, the silence ' +
      'comes back as a red test instead of as a passing suite.',
    file: 'packages/browser/demo/main.ts',
    find: 'options.trustAnchors ?? [KERNEL_TRUST_ANCHOR]',
    replace: '[]',
    caughtBy: ['packages/node/src/colouring-demo.e2e.test.ts'],
    project: 'e2e',
    signature: 'runs every cube on two nodes and shows which two',
    signatureSource: 'test-title',
  },
  {
    id: 'M30',
    why:
      'AUTH-03 in the browser tier, and the entry that closes the largest measured hole ' +
      'this ledger has ever recorded. Plan 15-03 planted exactly this scrambling — the ' +
      'owner id and owner key transposed, the audience replaced by an eight-character ' +
      'literal, the clock frozen at zero — and nothing in the repository moved: `tsc` ' +
      'exited 0, the substring count in `serve-agent-hooks.node.test.ts` stayed at 1, and ' +
      '345 browser tests passed in three engines. Phase 15’s verifier re-planted it and ' +
      'reproduced all three readings. What makes it the defect a reviewer would least ' +
      'expect to be caught is that the mutated node still *refuses* — it simply refuses ' +
      'for the wrong reason, naming the owner key where the owner id belongs, so every ' +
      'assertion of the form "the job failed" passes. Only a test that reads the refusal ' +
      '**text** against a live tab sees it, which is why `caughtBy` is an e2e file and ' +
      'not the argument-equality check that also fires: that check is source text, and ' +
      'the same defect planted in both factories would satisfy it.',
    file: 'packages/browser/src/browser-node.ts',
    find:
      '        ownerId: sovereignty.ownerId,\n' +
      '        ...(sovereignty.ownerKey === undefined ? {} : { ownerKey: sovereignty.ownerKey }),\n' +
      '        audience,\n' +
      '        now: Date.now,',
    replace:
      "        ownerId: sovereignty.ownerKey ?? '',\n" +
      '        ...(sovereignty.ownerKey === undefined ? {} : { ownerKey: sovereignty.ownerId }),\n' +
      "        audience: 'deadbeef',\n" +
      '        now: () => 0,',
    caughtBy: ['packages/node/src/browser-capability.e2e.test.ts'],
    project: 'e2e',
    signature: "to contain 'no capability chain supplied'",
    signatureSource: 'rendered-at-runtime',
  },
  {
    id: 'M31',
    why:
      'SCHED-06 on the combine branch — the *taking* half. `offer()` reserves and `would()` ' +
      'asks the same question without consuming anything, so swapping them leaves the ' +
      'refusal text readable and the bound inert: no combine ever occupies a slot, ' +
      '`peakInFlight` never rises off zero, and a node answers an unlimited number of ' +
      'concurrent combines while still appearing to have admission control. It is M1 one ' +
      'branch over, and it is a separate entry because the two branches release ' +
      'separately and a fix to one has never implied a fix to the other. **What this ' +
      'mutation deliberately does not catch is worth writing down**: the two bound cases ' +
      'declare their saturation by reserving a slot directly on the node’s own ' +
      '`LocalCapacity`, so `would()` still sees a full table and still refuses — they stay ' +
      'green. Only the three release readings see it, which is why `caughtBy` names the ' +
      'in-process file and not the real-node one.',
    file: 'packages/net/src/agent.ts',
    find: 'const admission = capacity.offer({ shardId: slotKey, nodeId: options.executor.nodeId })',
    replace: 'const admission = capacity.would({ shardId: slotKey, nodeId: options.executor.nodeId })',
    caughtBy: ['packages/net/src/combine.test.ts'],
    signature: 'does not climb its high-water mark across twenty combines',
    signatureSource: 'test-title',
  },
  {
    id: 'M32',
    why:
      'SCHED-06 on the combine branch — the *refusing* half, and the line that closes ' +
      '16-05’s measured consequence. Until 16-06 nothing this repository could start was ' +
      'able to refuse a combine: `authorizeCapability` reaches its refusal rules through ' +
      '`task.label === "sovereign"` and no combine can carry that label, so every node ' +
      'admitted every combine and the fetch-amplification residue covered the whole ' +
      'fabric rather than only unauthenticated nodes. Deleting this return puts that back ' +
      'exactly, and it is the shape a "the reduce is stalling, let it through for now" ' +
      'edit leaves behind — the slot is still taken, the counters still read plausibly, ' +
      'and only the reply says anything is wrong. Caught on **both** layers, which is the ' +
      'point of listing two files: the in-process rig can count reads, and the real ' +
      '`FabricNode` proves the production factory is what wires it — a distinction this ' +
      'phase exists because 16-05’s defect survived two milestones by hiding from cheap ' +
      'fabrics.',
    file: 'packages/net/src/agent.ts',
    // Re-anchored 2026-08-03 by Plan 19-16, which gave the combine reply an
    // `attestation` field, so this return grew a key. The mutation is unchanged — delete
    // the refusal and the branch falls through to run the combine anyway — and only the
    // text it is keyed on moved. The cheap layer is what caught the drift.
    find:
      "      return { kind: 'combine', resultCid: null, reason: admission.reason, " +
      "attestation: 'signed-by-nobody' }\n",
    replace: '',
    caughtBy: ['packages/net/src/combine.test.ts', 'packages/node/src/admission.node.test.ts'],
    signature: 'AssertionError: expected CID(',
    signatureSource: 'rendered-at-runtime',
  },
  {
    id: 'M33',
    why:
      'AUTH-02 — the line that stops a verdict being permanent. `PeerVerifier` settled a ' +
      'peer’s verdict once and cached it for the life of the connection, so a node that ' +
      'enrolled *after* a peer had connected to it was excluded by that peer for ever, ' +
      'silently and with a correctly-named refusal the whole time. Deleting this call ' +
      'restores exactly that: every other reading stays green — the refusal is still named ' +
      '`no-records`, the peer is still connected, the gate still reports itself working — ' +
      'and only a peer whose answer *changes* is lost. It is the shape a "this getter ' +
      'should be pure" cleanup leaves behind, and the reason the side effect is documented ' +
      'on the getter rather than left to be discovered.',
    file: 'packages/node/src/peer-verifier.ts',
    find: '    for (const peer of peers) this.#refresh(peer)\n',
    replace: '',
    caughtBy: ['packages/node/src/peer-verifier.node.test.ts'],
    signature: 'takes it once it holds a certificate',
    signatureSource: 'test-title',
  },
  {
    id: 'M34',
    why:
      'AUTH-02 — the half of the retry that bounds it rather than enables it. Re-asking ' +
      'is only safe because a refusal that cannot change is never re-asked; drop one kind ' +
      'out of `FINAL` and this node spends an RPC per interval, for ever, on a peer that ' +
      'already presented somebody else’s certificate. `nodeKey-mismatch` is the right kind ' +
      'to plant on because it is the impersonation case — the one where repeatedly asking ' +
      'is not merely wasteful but is work an unverified peer gets to command. Nothing ' +
      'about the verdict changes, so every refusal-name assertion in the file stays green ' +
      'and only the request count moves: the same shape as NET-08, where a bound placed ' +
      'below a fetch loop left both refusal-text readings intact while reads went 0 to 2.',
    file: 'packages/node/src/peer-verifier.ts',
    find: "  'nodeKey-mismatch',\n",
    replace: '',
    caughtBy: ['packages/node/src/peer-verifier.node.test.ts'],
    signature: 'never re-asks a refusal that cannot change',
    signatureSource: 'test-title',
  },
  {
    id: 'M35',
    why:
      'AUTH-02 — the generation counter must be per verifier, and this plants the version ' +
      'that looks right. Re-asking made two asks for one peer able to be in flight at ' +
      'once, so a stale answer can now arrive after a fresh one and overwrite it. A ' +
      'counter kept beside each peer’s own entry is the obvious shape and is wrong: ' +
      '`#onDisconnect` deletes that entry, so the ask issued after a reconnect is handed ' +
      'the same number as the one still in flight from before the disconnect, the guard ' +
      'compares equal on two different asks, and a peer that is verified right now is ' +
      'excluded by an answer about a connection that has ended. **This was a real defect ' +
      'and not a hypothetical** — it was found by probing the guard rather than trusting ' +
      'it, which is why the entry exists at all: the first version of the guard was ' +
      'unmeasured and nothing in the suite moved when it was weakened.',
    file: 'packages/node/src/peer-verifier.ts',
    find: '    this.#generations += 1\n    const generation = this.#generations\n',
    replace: '    const generation = (this.#lastAsk.get(peerId)?.generation ?? 0) + 1\n',
    caughtBy: ['packages/node/src/peer-verifier.node.test.ts'],
    signature: 'discards an answer from an ask that a disconnect and reconnect superseded',
    signatureSource: 'test-title',
  },
  // `M36` stood here and is gone, deleted by Phase 20 plan 01 on 2026-08-04 exactly as
  // its own `why` instructed: *"When WIRE-04 really lands, this entry is the thing to
  // delete — not the assertion, which by then has a behaviour to describe."* It pinned an
  // **absence** — that `submitJob` called `executeVerified` once per shard and nothing
  // retried a selected executor that refused at exec — and the absence is closed: the
  // generation loop is `submit.ts`'s, and `W1` through `W5` below are the five defects
  // planted into it and watched go red. The assertion `M36` protected, in
  // `discovery-agents.node.test.ts`, is the armed tripwire this plan deliberately turned
  // red and does **not** repair; plan 20-04 rewrites it to require the re-pick. An entry
  // deleted with no note in its place reads as an entry that was never there, which is
  // the failure this whole file exists to prevent, so the note stays.
  {
    id: 'M37',
    why:
      'SCHED-04 on the browser tier — the defect this catches is a **divergence**, not a ' +
      'breakage, which is why nothing already in the repository saw it. `window.o2.' +
      'capacity()` reads `node.admission`; the wire answer is composed by whatever object ' +
      '`serveAgent` was handed. Hand it a second `LocalCapacity` built without the ' +
      'governor and the two stop agreeing: the page still reports `{dutyCycle: 0.25, ' +
      'slots: 2}` and every in-page assertion in `duty-cycle-tab.e2e.test.ts` stays green, ' +
      'while the tab advertises 8 slots to every peer that asks and takes on four times ' +
      'the work its user capped it to. It is the same class of defect that file already ' +
      'records against `GovernedExecutor` — the right value read from the wrong object — ' +
      'and it survived there once for exactly this reason. **Measured: 5 passed, 1 ' +
      'failed**, the one being the peer’s reading. That divergence is the whole argument ' +
      'for taking criterion 3’s browser half off the wire instead of inferring it from ' +
      'shared construction, and this entry is what keeps the reading honest.',
    file: 'packages/browser/src/browser-node.ts',
    find: '      capacity: admission,',
    replace:
      '      capacity: new LocalCapacity({\n' +
      '        nodeId,\n' +
      '        maxConcurrent: options.maxConcurrentTasks ?? DEFAULT_MAX_CONCURRENT_TASKS,\n' +
      '      }),',
    caughtBy: ['packages/node/src/duty-cycle-tab.e2e.test.ts'],
    signature: 'expected { slots: 8, inFlight: +0 } to deeply equal { slots: 2, inFlight: +0 }',
    signatureSource: 'rendered-at-runtime',
    project: 'e2e',
  },
  {
    id: 'M38',
    why:
      'VER-10. `composeQuorum`’s ok arm returned the literal `\'independent\'` from Phase 6 until ' +
      '2026-08-02 while `classifyAttestation` sat two functions below, written in the same file in ' +
      'the same phase to compute exactly this. The constant was right in every case the unit tests ' +
      'reached and wrong at size 1 — one node reporting that separate operators agreed with each ' +
      'other — which is a defect that is correct wherever it is looked at. **What this entry also ' +
      'records is where the property is NOT guarded**: Plan 19-08 planted this same substitution ' +
      'and `quorum-agents.node.test.ts` stayed GREEN at 3 passed, because a shard’s receipt comes ' +
      'from `attestationReceipt(verified)` in `receiptFor` and never from `QuorumResult.strength`. ' +
      'That separation is correct and is why the across-process file cannot carry this claim.',
    file: 'packages/core/src/quorum.ts',
    find: '    strength: classifyAttestation(members),',
    replace: "    strength: 'independent',",
    caughtBy: ['packages/core/src/quorum.test.ts'],
    signature: 'composes a quorum whose strength its own members support, not a constant',
    signatureSource: 'test-title',
  },
  {
    id: 'M39',
    why:
      'VER-03 — eclipse resistance, and the position of the rule rather than the rule itself. ' +
      'Asking `sharedRelay` of the candidate **pool** instead of the chosen **members** is the ' +
      'tempting simplification, and it was live in this file for a day: a pool on relay-1, relay-1 ' +
      'and relay-2 has no shared dependency, so the pool-level check passes, and the two members ' +
      'drawn at `size: 2` both hang off relay-1. That composition reports a redundancy of two ' +
      'against a single point of failure. Pool-refusal implies member-refusal and the converse ' +
      'fails, so the pool position is strictly the weaker one — measured rather than argued, on ' +
      'the run that moved it back.',
    file: 'packages/core/src/quorum.ts',
    find: '    const shared = sharedRelay(members)',
    replace: '    const shared = sharedRelay(distinct)',
    caughtBy: ['packages/core/src/quorum.test.ts'],
    signature: 'refuses a one-member quorum that hangs off a single relay',
    signatureSource: 'test-title',
  },
  {
    id: 'M40',
    why:
      'VER-03, the rule deleted outright rather than moved, and the entry that says which case ' +
      'carries the claim — **re-measured across real processes on 2026-08-04, which is the ' +
      'whole of what Plan 19-19 was for.** Planted against the whole file: 1 failed, 3 passed, ' +
      'and the one that failed is the one-relay fabric, whose three executors are now spawned ' +
      '`bin/agent.ts` processes given `--relay-addr` and no `--port`. Before 19-19 that same ' +
      'plant reddened only an IN-PROCESS fixture (19-08 recorded 1 failed, 2 passed), because ' +
      'the binary bound a port unconditionally and could make nothing but a `seed` with ' +
      '`relayIds: []`; `19-VERIFICATION.md` scored criterion 1 PARTIAL for exactly that, since ' +
      'the criterion names `bin/agent.ts` as the entry point. The other three cases still ' +
      'CANNOT redden here and that is by construction, not by luck: their agents are given no ' +
      'relay at all, so `sharedRelay` answers `null` on sight of a seed. A reader who takes the ' +
      'three-operator fabric as evidence for rule 2 has taken a green that could not have gone ' +
      'red.',
    file: 'packages/core/src/quorum.ts',
    find: '  if (requireIndependentPaths) {',
    replace: '  if (false as boolean) {',
    caughtBy: ['packages/node/src/quorum-agents.node.test.ts'],
    signature: "expected 'composed' to be 'not-composed'",
    signatureSource: 'rendered-at-runtime',
  },
  {
    id: 'M41',
    why:
      'The one entry here that guards a **retraction**. Between 2026-08-02 and 2026-08-03 this ' +
      'function required a member with `discoverability === \'seed\'`, and the owner retracted it ' +
      'in `0314208` for keying on node kind — which `STATE.md` forbids outright, and which Phase ' +
      '3 had already falsified by dialling an iPhone at its `/p2p-circuit/webrtc` address and ' +
      'watching it run half of a 2×-redundant job. Reinstating the predicate disqualifies ' +
      'relay-discovered peers from quorum slots again, and six cases see it. The refusal payload ' +
      'in `replace` is reconstructed; the **predicate** is the one that was planted, and it is the ' +
      'predicate the cases read — each asserts `result.ok`, which inverts whatever the refusal ' +
      'carries.',
    file: 'packages/core/src/quorum.ts',
    find: '  const members = ordered.slice(0, rules.size)',
    replace:
      '  const members = ordered.slice(0, rules.size)\n' +
      "  if (!members.some((c) => c.discoverability === 'seed')) {\n" +
      "    return refuse({ kind: 'no-candidates' }, 'no member of this quorum is a seed')\n" +
      '  }',
    caughtBy: ['packages/core/src/quorum.test.ts'],
    signature: 'does not disqualify relay-discovered peers from the slots of a quorum',
    signatureSource: 'test-title',
  },
  {
    id: 'M42',
    why:
      'VER-10 / criterion 1 — the conflation the whole requirement exists to forbid. One operator ' +
      'agreeing with itself is `owner-domain`; two operators agreeing is `independent`, and the ' +
      'stronger claim may never be reported for the weaker fact. Relaxing the threshold by one is ' +
      'the shape a "surely one is enough" edit leaves behind, and it is invisible to every ' +
      'assertion of the form "a strength was reported". Plan 19-09 planted a two-line variant of ' +
      'the same defect and watched `owner-domain-agents.node.test.ts` report ' +
      '`expected \'independent\' to be \'owner-domain\'` on one arm and ' +
      '`expected \'independent\' to be \'owner-attested\'` on the other **under one plant**, which ' +
      'is the evidence that one expression produces both labels.',
    file: 'packages/core/src/quorum.ts',
    find: "  if (operators.size >= 2) return 'independent'",
    replace: "  if (operators.size >= 1) return 'independent'",
    caughtBy: ['packages/node/src/quorum-agents.node.test.ts'],
    signature: "expected 'independent' to be 'owner-domain'",
    signatureSource: 'rendered-at-runtime',
  },
  {
    id: 'M43',
    why:
      'The 2026-08-03 quorum ruling, first half of a pair — and the pair must be read together, ' +
      'because each is the other’s opposite failure. Ignoring `onQuorumShortfall` and degrading ' +
      'every shortfall means a caller that said in as many words that a weaker answer is useless ' +
      'to it silently gets one: the job completes, the shard is marked degraded, and nothing the ' +
      'caller asked for was honoured. The dial is read at the one point a shortfall exists and ' +
      'nowhere else, so there is no second site where a fix could be applied and this one left. ' +
      'Plan 19-06 planted a narrower in-process variant of the same defect and took 1 failed / 60 ' +
      'passed in `submit.test.ts`; the entry is keyed on the across-process reading because that ' +
      'is the one measured against this exact `replace`.',
    file: 'packages/core/src/job/submit.ts',
    find:
      "      degraded: spec.onQuorumShortfall === 'runs-at-available-redundancy',\n" +
      "      refusal: spec.onQuorumShortfall === 'refuses-the-shard' ? composition.reason : null,",
    replace: '      degraded: true,\n      refusal: null,',
    caughtBy: ['packages/node/src/quorum-agents.node.test.ts'],
    signature: "expected 'agreed' to be 'insufficient'",
    signatureSource: 'rendered-at-runtime',
  },
  {
    id: 'M44',
    why:
      'The same ruling, second half of the pair, and the reason `M43` alone is not enough: refusing ' +
      'every shortfall restores the pre-ruling behaviour the owner ruled **against**. A fabric too ' +
      'concentrated to compose stops running at all rather than running at available redundancy ' +
      'with a weaker label, so the default outcome of the whole mechanism inverts while every ' +
      'refusal string stays correct and every degrade assertion is simply never reached. A single ' +
      'entry pinned to one direction would be satisfied by a guard that only ever sees that ' +
      'direction; this pair is what proves the file sees either.',
    file: 'packages/core/src/job/submit.ts',
    find:
      "      degraded: spec.onQuorumShortfall === 'runs-at-available-redundancy',\n" +
      "      refusal: spec.onQuorumShortfall === 'refuses-the-shard' ? composition.reason : null,",
    replace: '      degraded: false,\n      refusal: composition.reason,',
    caughtBy: ['packages/node/src/quorum-agents.node.test.ts'],
    signature: "expected 'insufficient' to be 'agreed'",
    signatureSource: 'rendered-at-runtime',
  },
  {
    id: 'M45',
    why:
      'The ruling’s third consequence, and the one this phase would most easily have shipped ' +
      'unpinned. `ShardResult.degraded` used to mean "fewer replicas than asked for" alone; 19-06 ' +
      'widened it to cover a verification shortfall too, so a shard that got its redundancy but ' +
      'not its independence reports degraded. Reverting the widening leaves a caller filtering on ' +
      'that flag accepting a shard whose quorum was refused, at full redundancy, with the ' +
      'composer’s reason sitting unread beside it. **The weakness of this entry is its signature ' +
      'and it is stated rather than hidden**: the only text recorded on the run that observed it ' +
      'is `expected false to be true`, which a flake could also produce, and the summary did not ' +
      'say which of the two degrading fabrics spoke. The cheap layer still holds the `find`; ' +
      'closing the rest is a matter of re-planting and pasting the FAIL line. ' +
      '**Both were done on 2026-08-04 by Phase 20 plan 01, and the entry moved for a reason ' +
      'that plan did not predict.** That plan’s interface block named `M36` as the one entry its ' +
      'edit would redden; this one reddened too, because the generation loop necessarily rewrites ' +
      'the `degraded` expression — it now reads the replicas that ANSWERED rather than the ones ' +
      'that were placed, so a shard topped up to full redundancy across two generations is ' +
      'correctly not degraded. The mutation is unchanged in substance: drop the `gate.degraded` ' +
      'term and a shard whose quorum was refused at full redundancy reports clean. Re-planted ' +
      'against the new expression and re-measured: **2 failed, 2 passed** in ' +
      '`quorum-agents.node.test.ts`, and the FAIL line is now pasted in below, which upgrades ' +
      'this entry out of the weak-signature class it spent a phase in.',
    file: 'packages/core/src/job/submit.ts',
    find:
      '        degraded:\n' +
      '          gate.degraded ||\n' +
      "          (settled.status === 'agreed' ? settled.replicas < spec.redundancy : placementDegraded),",
    replace:
      '        degraded:\n' +
      "          (settled.status === 'agreed' ? settled.replicas < spec.redundancy : placementDegraded),",
    caughtBy: ['packages/node/src/quorum-agents.node.test.ts'],
    signature:
      'degrades to owner-domain on the default dial, is refused in the composer’s words on the strict one, and leaves a redundancy-1 job untouched by either',
    signatureSource: 'test-title',
  },
  {
    id: 'M46',
    why:
      'VER-08. The agreeing set’s node ids and their attestations are two projections of one ' +
      'receipt, and this line is the whole of what keeps them in step. Built from two separately ' +
      'ordered arrays they line up wrongly — entry `a` carrying node `c`’s certificate — and every ' +
      'node-id assertion in the file still passes, because the ids were never the evidence. That ' +
      'is the argument for one field holding both rather than two fields that can disagree, and it ' +
      'is the defect a receipt built from a lookup reintroduces one layer up.',
    file: 'packages/core/src/job/verify.ts',
    find: '    agreeing: answered.map((r) => ({ nodeId: r.nodeId, attestation: r.attestation })),',
    replace:
      '    agreeing: (() => {\n' +
      '      const signatures = [...answered].sort((x, y) => y.nodeId.localeCompare(x.nodeId))\n' +
      '      return answered.map((r, i) => ({ nodeId: r.nodeId, attestation: signatures[i]!.attestation }))\n' +
      '    })(),',
    caughtBy: ['packages/core/src/job/verify.test.ts'],
    signature: 'gives every entry the attestation of the node that entry names',
    signatureSource: 'test-title',
  },
  {
    id: 'M47',
    why:
      'The third signing leg. `outputCid` is what makes a result attestation a statement about **an ' +
      'answer** rather than about a task, and without it one node’s signature over one shard ' +
      'verifies against a different answer to the same shard — which is exactly the forgery ' +
      'redundant execution exists to detect, performed with a real key and a real certificate. It ' +
      'is a field-drop rather than a rewrite because that is the shape a "the challenge is ' +
      'getting long" tidy leaves behind, and every surrounding check still passes.',
    file: 'packages/core/src/result-attestation.ts',
    find: '    partitionIndex: work.partitionIndex,\n    outputCid: work.outputCid,\n',
    replace: '    partitionIndex: work.partitionIndex,\n',
    caughtBy: ['packages/core/src/result-attestation.test.ts'],
    signature: 'does not verify against a different answer',
    signatureSource: 'test-title',
  },
  {
    id: 'M48',
    why:
      'The same challenge’s `nodeKey`, and the entry exists because the argument for the field ' +
      'that was written down first is **false**. Plan 19-13 predicted that dropping it would let ' +
      'B’s certificate plus A’s signature verify; it planted the drop and all 14 cases stayed ' +
      'green, because `verifyResultAttestation` verifies under `certificate.nodeKey` and Ed25519’s ' +
      'own key binding does that work whatever bytes were signed. What the field really buys is ' +
      'that two replicas of one shard sign **different bytes**, so an attestation is ' +
      'self-describing rather than meaningful only in company with the certificate it travels ' +
      'with — and this entry pins that property, which is the one that can fail.',
    file: 'packages/core/src/result-attestation.ts',
    find: '    outputCid: work.outputCid,\n    nodeKey,\n',
    replace: '    outputCid: work.outputCid,\n',
    caughtBy: ['packages/core/src/result-attestation.test.ts'],
    signature: 'gives two nodes different bytes to sign',
    signatureSource: 'test-title',
  },
  {
    id: 'M49',
    why:
      'The combine verb, and it guards the half `PROJECT.md` calls the verified one. A reduction ' +
      'over sovereign contributions is trusted for the map and **verified for the aggregation**, ' +
      'so a combine signature has to cover the order the inputs were merged in. Sorting the list ' +
      'inside the challenge makes a reordered combine verify against a result it did not produce, ' +
      'and sorting is the reflex — `payloadOf` sorts `relayIds` one module over, for a genuinely ' +
      'different reason. The line carries a comment saying never to sort it; this entry is what ' +
      'makes the comment a reading.',
    file: 'packages/core/src/result-attestation.ts',
    find: '    inputCids: [...inputCids],',
    replace: '    inputCids: [...inputCids].sort(),',
    caughtBy: ['packages/core/src/result-attestation.test.ts'],
    signature: 'signs a combine over its inputs in merge order, never sorted',
    signatureSource: 'test-title',
  },
  {
    id: 'M50',
    why:
      'VER-08/09/10 — the wrapper that turns a result into evidence, replaced by the truthful ' +
      'sentinel. A node that reports `signed-by-nobody` is not lying, and that is what makes this ' +
      'the dangerous edit: nothing throws, no refusal is named, and every receipt downstream falls ' +
      'to the named absence with `agreeing: 2, verified: 0`. A reader sees a weaker report rather ' +
      'than a broken one. Planted by both 19-09 and 19-15; the caught file is the one 19-15 named ' +
      'with a line number, and the signature is that case’s title.',
    file: 'packages/core/src/executor/attesting-executor.ts',
    find:
      '        attestation: signResult(attestor, {\n' +
      '          moduleCid: task.moduleCid,\n' +
      '          inputCid: task.inputCid,\n' +
      '          partitionIndex: task.partitionIndex,\n' +
      '          outputCid: hashed.cid,\n' +
      '        }),',
    replace: "        attestation: 'signed-by-nobody' as const,",
    caughtBy: ['packages/node/src/result-signature.node.test.ts'],
    signature:
      'VER-08/09/10 — a result signed in one process verifies in another > carries a real attestation from every replica, verifiable against the provider key alone',
    signatureSource: 'test-title',
  },
  {
    id: 'M51',
    why:
      'The Node factory’s composition of the signing wrapper — **the same shape `M27` already has ' +
      'for provenance, and the two should be read as a pair**: a reader who finds one should find ' +
      'the other, because a required option that is resolved and then not composed buys nothing ' +
      'and looks identical to one that is. Unwrapping it leaves `attestResults` imported, the ' +
      'attestor resolved and every symbol in place while the node signs nothing, and the guard is ' +
      'textual for the reason `M28` records: a census cannot tell a composed wrapper from a ' +
      'decorative one, so the check is that the call survives comment-stripping in this exact file.',
    file: 'packages/node/src/fabric-node.ts',
    find: 'const signing = attestResults(executor, attestor)',
    replace: 'const signing = executor',
    caughtBy: ['packages/node/src/trust-anchors.node.test.ts'],
    signature: 'packages/node/src/fabric-node.ts composes attestResults',
    signatureSource: 'rendered-at-runtime',
  },
  {
    id: 'M52',
    why:
      'The **other** signing hook on the same factory, and it is a separate entry because it fails ' +
      'separately: with the executor wrapper composed and this one at the sentinel, every map ' +
      'result is signed and the aggregation over them is not — so a reduced job’s verified half is ' +
      'attested by nobody while every exec reading in the file stays green. A reader checking only ' +
      'the exec leg sees nothing wrong. That divergence is the whole argument for turning both ' +
      'verbs on in one plan rather than one at a time.',
    file: 'packages/node/src/fabric-node.ts',
    find: '      attest: attestor,',
    replace: "      attest: 'signs-nothing',",
    caughtBy: ['packages/node/src/result-signature.node.test.ts'],
    signature:
      'VER-08/09/10 — a result signed in one process verifies in another > carries a real attestation from every replica, verifiable against the provider key alone',
    signatureSource: 'test-title',
  },
  {
    id: 'M53',
    why:
      'The aggregation’s own receipt, and the defect it exists to replace. Pushing the certificate ' +
      'the replica handed over — instead of the one `verifyCombineAttestation` returned — makes a ' +
      'reduction report a strength on the requestor’s own say-so: two peers presenting self-issued ' +
      'certificates under two operator ids read as `independent`, and a combine whose signature ' +
      'covers an input order it never merged is counted. Nothing empties, nothing throws, and the ' +
      'printed line is the strongest label the fabric has.',
    file: 'packages/net/src/reduce-job.ts',
    find:
      '      if (!checked.ok) {\n' +
      '        unaccounted.push(`${node.id}: ${checked.reason}`)\n' +
      '        continue\n' +
      '      }\n' +
      '      verified.push(checked.certificate)',
    replace: '      void checked\n      verified.push(replica.attestation.certificate)',
    caughtBy: ['packages/net/src/reduce-job.test.ts'],
    signature: 'does not count a combine whose signature covers an input order it did not merge',
    signatureSource: 'test-title',
  },
  {
    id: 'M54',
    why:
      'AUTH-04, and the only bound in this repository that a fresh key cannot rotate around. The ' +
      'per-user limiter keys on `userKey`, and a fresh user key is one `ed25519.keygen()` — Phase ' +
      '17 measured twenty free keygens enrolling unslowed against it. This block is the aggregate: ' +
      'how many certificates one provider signs per window, whoever asked. Deleted, that ' +
      'measurement comes straight back, with the per-user refusal still present and still correct ' +
      'about the wrong quantity.',
    file: 'packages/core/src/enrollment.ts',
    find:
      "    if (this.#maxIssuedPerWindow !== 'issues-without-an-aggregate-budget') {\n" +
      '      const issued = this.#recentForAnybody(now)\n' +
      '      if (issued.length >= this.#maxIssuedPerWindow) {\n' +
      '        const oldest = Math.min(...issued)\n' +
      '        return {\n' +
      '          ok: false,\n' +
      '          refusal: {\n' +
      "            kind: 'issuance-budget-exhausted',\n" +
      '            limit: this.#maxIssuedPerWindow,\n' +
      '            windowMs: this.#windowMs,\n' +
      '            retryAfterMs: oldest + this.#windowMs - now,\n' +
      '          },\n' +
      "          // Names no user key and no node key, deliberately. See the refusal's own\n" +
      '          // docblock: this requester is not what went wrong.\n' +
      '          reason: `this provider has issued ${issued.length} certificates in the last ${this.#windowMs}ms (limit ${this.#maxIssuedPerWindow})`,\n' +
      '        }\n' +
      '      }\n' +
      '    }\n',
    replace: '',
    caughtBy: ['packages/core/src/enrollment.test.ts'],
    signature: 'refuses past its stated number however many free keygens the requester mints',
    signatureSource: 'test-title',
  },
  {
    id: 'M55',
    why:
      'The trust decision behind the aggregate receipt, on the one CLI in this repository that runs ' +
      'jobs. `reduceJob` verifies a combine signature against the issuers it is handed, so emptying ' +
      'the set makes the rig check nothing while still printing a receipt — the "second place the ' +
      'decision is made" defect, where a requestor that pinned a provider for `exec` silently ' +
      'accepts anybody for `combine`. Caught by a call-site requirement rather than by a run, ' +
      'because the failure is an argument value on a binary no unit test constructs.',
    file: 'packages/node/src/bin/bench.ts',
    find: '        trustedIssuers: fabric.combineIssuers,',
    replace: '        trustedIssuers: new Set<string>(),',
    caughtBy: ['packages/node/src/bench-reduce.node.test.ts'],
    signature: 'the reduce is told what this rig checks combine signatures against',
    signatureSource: 'test-title',
  },
  {
    id: 'M56',
    why:
      'Two receipts about two different claims, each of which has to say which claim it is about. ' +
      'A reduced job carries a map attestation and an aggregate attestation, and they routinely ' +
      'disagree — on a default run the map half reads a strength and the aggregate half reads the ' +
      'named absence, because that rig pins no issuer. Dropping the word that labels one of them ' +
      'gives a reader two lines that look like one measurement taken twice, which is worse than ' +
      'printing neither.',
    file: 'packages/node/src/bin/bench.ts',
    find: 'map attestation (',
    replace: 'attestation (',
    caughtBy: ['packages/node/src/bench-reduce.node.test.ts'],
    signature: 'both receipts reach stdout, each naming the claim it is about',
    signatureSource: 'test-title',
  },
  {
    id: 'M57',
    why:
      'SCHED-02, and the entry that closes defect #31. This is the **only** production call of ' +
      '`rpcAdmission` in the repository — every other is a spec — so `REQUIREMENTS.md`’s SCHED-02 ' +
      'row rests entirely on this expression for its claim that `planWithOffers` has a caller from ' +
      'a runnable entry point. **The measurement that justifies the entry is what stayed green ' +
      'when it was deleted**: `tsc --noEmit` exit 0, because `Fabric.admit` is optional; all six ' +
      'cheap guards exit 0, including the requirements ledger itself; `discover-arm.node.test.ts` ' +
      'exit 0, though it reads this driver’s own stdout. One file noticed. The spread form is part ' +
      'of the `find` on purpose — `admit` must be **absent** on the default rig rather than ' +
      '`undefined`, or the published curve changes placer.',
    file: 'packages/node/src/bin/bench.ts',
    find: '    ...(DISCOVER ? { admit: rpcAdmission(requestor.rpc) } : {}),',
    replace: '',
    caughtBy: ['packages/node/src/bench-reduce.node.test.ts'],
    signature: 'the discover rig supplies admit, and the job spec passes it on',
    signatureSource: 'test-title',
  },
  {
    id: 'M58',
    why:
      'DATA-10 in a live tab. A node that refuses to serve a sovereign block and then **advertises ' +
      'itself as a provider of it** has told every peer where the data is while declining to hand ' +
      'it over, which is a worse answer than either alone. The two halves fail independently and ' +
      'this proves it: with the withholding predicate replaced by the sentinel the block refusal ' +
      'fifteen lines above stayed green and only the `providers` reading moved, naming the tab’s ' +
      'own node key for the CID it had just refused.',
    file: 'packages/browser/src/browser-node.ts',
    find: '      withholdingFrom(egressDisposition),',
    replace: "      'advertises-everything-it-holds',",
    caughtBy: ['packages/node/src/tab-refusals.e2e.test.ts'],
    project: 'e2e',
    signature:
      'serves a public block to the peer, refuses the sovereign one by name, and withholds it from its own providers answer',
    signatureSource: 'test-title',
  },
  {
    id: 'M59',
    why:
      'SCHED-06 / WIRE-03 in a live tab, and **the entry that closes the hole `M2b` names**. `M2b` ' +
      'records that the browser admission bound had never been read through a tab and that closing ' +
      'it was a matter of writing the case. Plan 19-04 wrote it: a tab started through `window.o2` ' +
      'with one slot, two concurrent `exec` dispatches from a Node peer, and the refusal read off ' +
      'the second reply frame with its number in the text. Under this plant the second dispatch ' +
      'succeeds and the count goes 1 → 2, while the sovereign-egress case in the same file stays ' +
      'green. Separate from `M2b` because the two are caught by different layers — a source-text ' +
      'count and a live tab — and a fix to one has never implied a fix to the other.',
    file: 'packages/browser/src/browser-node.ts',
    find: '      capacity: admission,',
    replace: "      capacity: 'accepts-every-offer',",
    caughtBy: ['packages/node/src/tab-refusals.e2e.test.ts'],
    project: 'e2e',
    signature:
      'admits one of two concurrent dispatches, refuses the other naming its one slot, and admits the refused one once the slot is free',
    signatureSource: 'test-title',
  },
  {
    id: 'M60',
    why:
      'NET-06 / WIRE-03 — the rendezvous a tab has no other way to perform. A browser peer holds no ' +
      'reservations of its own (`browser-node.ts` states the named absence), so the relay’s thunk ' +
      'is the whole of how three tabs on a static bundle learn that each other exist. Replacing it ' +
      'with the sentinel reproduces the pre-Phase-6 fabric exactly, and the shape of the failure is ' +
      'the point: every page still **asks**, no page errors, and the attempt count is zero. Asked, ' +
      'nothing attempted, nothing failed, nothing logged — a fabric that looks like it is ' +
      'discovering and is not.',
    file: 'packages/node/src/fabric-node.ts',
    find: '      reservations: () => node.reservedPeerIds,',
    replace: "      reservations: 'relays-for-nobody',",
    caughtBy: ['packages/node/src/static-rendezvous.e2e.test.ts'],
    project: 'e2e',
    signature: 'each peer asks the relay who is here and dials them, with no harness dial',
    signatureSource: 'test-title',
  },
  {
    id: 'M61',
    why:
      'VER-10 on the surface with the widest audience. `receiptFor` verifies a replica’s attestation ' +
      'against **the issuer named by the descriptor it was handed**, so a certificate taken off the ' +
      'wire and put on a descriptor unverified supplies its own trust root — two peers presenting ' +
      'self-issued certificates under two operator ids are then reported as `independent`. The pin ' +
      'has to be applied where an independently-held key exists, and this is that place. Measured: ' +
      'with it removed the page printed *independently verified — replicas from separate operators ' +
      'agreed* for a run whose second operator was a stranger the tab had never pinned, and only ' +
      'the stranger case moved.',
    file: 'packages/browser/demo/main.ts',
    find:
      '  const checked = verifyCertificate(answered.certificate, new Set([held.issuer]), Date.now())\n' +
      "  return checked.ok ? checked.certificate : 'carries-no-certificate'",
    replace: '  return answered.certificate',
    caughtBy: ['packages/node/src/attestation-ui.e2e.test.ts'],
    project: 'e2e',
    signature: 'states the same absence for a peer enrolled by a provider this tab does not pin',
    signatureSource: 'test-title',
  },
  {
    id: 'M62',
    why:
      'AUTH-05 / VER-08. `publicNodes` builds descriptors from anything carrying a `nodeId`, and the ' +
      'certificate literal it writes is the honest answer rather than a placeholder — this ' +
      'requestor holds no signed statement about that node. Dropping the write makes the field ' +
      '`undefined` at every such site, which is not a statement about anything and which every ' +
      'downstream `=== \'carries-no-certificate\'` comparison reads as "a certificate is present". ' +
      'The plant that was measured also made the field optional so `tsc` stayed at exit 0; this ' +
      'entry carries the **write** half, which is the half a run can see, and the type half is ' +
      'recorded here rather than encoded because a `Mutation` holds one `find` and the two hunks ' +
      'are not contiguous.',
    file: 'packages/core/src/sovereignty.ts',
    find: "    load: 0,\n    certificate: 'carries-no-certificate',\n  }))",
    replace: '    load: 0,\n  }))',
    caughtBy: ['packages/net/src/discover-candidates.test.ts'],
    signature: 'states the absence where there is no certificate to carry, rather than omitting it',
    signatureSource: 'test-title',
  },
  {
    id: 'M63',
    why:
      'AOT-01. The bound this replaced was absolute — `expect(elapsed).toBeLessThan(8_000)` — and ' +
      'an absolute encodes the machine, the load and the I/O weather of the day it was written. ' +
      'The claim is "the caller\'s timeout reached `resolveImage`", so the case now asks twice in ' +
      'one run, with a 400 ms budget and a 2 000 ms budget, and reads the difference: spawn cost ' +
      'cancels algebraically and only the driver\'s response to the request survives. This plant is ' +
      'the reason the timing half is kept at all — it spends a fixed budget while still *reporting* ' +
      'the caller\'s, so the classification assertion and both message assertions pass untouched and ' +
      'nothing but the difference sees it. Measured: `asking for 1600 ms more budget bought 0 ms ' +
      'more wall clock (403 ms → 403 ms): expected 0 to be greater than 800`, red in 813 ms.',
    file: 'tools/aot/lift.ts',
    find: '[\'image\', \'inspect\', image, \'--format\', \'{{join .RepoDigests "\\\\n"}}\'],\n    timeoutMs,',
    replace: '[\'image\', \'inspect\', image, \'--format\', \'{{join .RepoDigests "\\\\n"}}\'],\n    400,',
    caughtBy: ['tools/aot/lift.node.test.ts'],
    signature: 'gives up on a wedged inspect in the time it was given, not in a hardcoded minute',
    signatureSource: 'test-title',
  },
  {
    id: 'M64',
    why:
      'CHURN. The case this pins used to check that eight shard CIDs were **distinct**, which is a ' +
      'weaker claim than it reads as: distinct is not the same as correct, and an answer that ' +
      'depended on which node produced it would satisfy it every time. So the reading is now an ' +
      'equality between two arms of ONE fabric — the same job answered with 0% killed and then with ' +
      '30% killed, shard for shard — and the machine, the load and the I/O weather cancel between ' +
      'the arms rather than being budgeted for. This plant is what shows the old check could not ' +
      'see the failure that matters: the planted CID prefix is IDENTICAL and only the node suffix ' +
      'differs, so a distinctness check is blind to it by construction. Measured: shard `s3` ran on ' +
      '`n2` intact and on `n3` after `n2` left, red on a single differing suffix. The same plant ' +
      'against the pre-fix file exited 0 and passed.\n\n' +
      '**Its catcher was re-sited by Plan 20-12, and the reason is worth reading.** The case ' +
      'named here drove `runResilient` over a `MemoryNetwork` fabric; 20-12 deleted that ' +
      'function under WIRE-04, and the 30 %-kill claim moved to ' +
      '`churn-agents.node.test.ts` — which reads it over real spawned processes but through ' +
      '`submitJob` and `RemoteExecutor`, so it never enters `remoteDispatch` and could not ' +
      'catch this plant. That left the entry pinning a live line with **no** test able to ' +
      'redden it, which `problemsWith` reported. Rather than retire it, 20-12 restored the ' +
      'control at the only layer that still reaches the line: the same task answered by two ' +
      'nodes, compared to each other and to the CID computed from the output. The argument ' +
      'above is unchanged — a distinctness check is blind to a per-node suffix and an ' +
      'equality is not — and it is now made one layer lower.',
    file: 'packages/net/src/churn.ts',
    find: 'return { ok: true, resultCid: encoded.cid.toString() }',
    replace: 'return { ok: true, resultCid: `${encoded.cid.toString()}-ran-on-${nodeId}` }',
    caughtBy: ['packages/net/src/churn.test.ts'],
    signature: 'returns the CID of the output and stores the block, identically whichever node answered',
    signatureSource: 'test-title',
  },
  {
    id: 'M65',
    why:
      'NET-06 / defect 32 — `planDials` decided "already connected, skip" from ' +
      '`libp2p.getPeers()`, which counts a peer whose ONLY connection is a limited relay ' +
      'circuit. A relayed circuit is 2 min / 128 KiB of signalling channel that PROJECT.md ' +
      'says may not carry a job, so a pair that dialled in the same moment and lost ICE was ' +
      'skipped by every later round — measured `dialed: []`, `failed: []` on both sides, in ' +
      'two independent constructions, after a forced race that came out 4 of 4 rather than ' +
      'the 1 in 3 it was filed as. This plants the skip back. It is worth pinning because ' +
      'the repair is nearly invisible: libp2p already re-dials past a limited connection on ' +
      'every `dialProtocol`, so the pair sometimes recovers by accident and always recovers ' +
      'at the relay’s 120 s duration limit — which means a weaker `planDials` looks fine on ' +
      'any reading that waits. The guard does not wait: it constructs the state with a bare ' +
      '`/p2p-circuit` dial and reads the round immediately.',
    file: 'packages/browser/src/dial-plan.ts',
    find: '  const carries = new Set(round.held.filter((h) => h.carriesWork).map((h) => h.peer))',
    replace: '  const carries = new Set(round.held.map((h) => h.peer))',
    caughtBy: ['packages/browser/src/dial-plan.test.ts'],
    signature: 'dials it again, and says the dial is an upgrade rather than first contact',
    signatureSource: 'test-title',
  },
  {
    id: 'P1',
    why:
      'SCHED-06 on the **fourth** production `serveAgent` file, and the entry exists because ' +
      'until it was written this ledger had never once named `packages/bench/src/perf-workload.ts` ' +
      '— sixty-seven entries, zero mentions, against a file holding two production call sites. ' +
      'That is the condition defect #19 reports: not that the sites are wrong, but that they sit ' +
      'somewhere the ledger does not look, so they can drift from the other four with nothing ' +
      'saying so. `B1` records what the drift costs when it happens, on this rig’s sibling: the ' +
      'memory-transport curve in `.planning/BENCHMARK-RESULTS.md` was published having been ' +
      'measured with the sentinel at `bin/bench.ts`’s two call sites while the real-transport ' +
      'curve admitted, so two curves printed side by side were taken under different node ' +
      'behaviour. This rig is the one the **perf gate** runs, so the same reversion here moves a ' +
      'number that fails a build rather than one that is only printed.',
    file: 'packages/bench/src/perf-workload.ts',
    find: "capacity: new LocalCapacity({ nodeId: 'requestor', maxConcurrent: GATE_ADMISSION_LIMIT }),",
    replace: "capacity: 'accepts-every-offer',",
    caughtBy: ['packages/node/src/serve-agent-hooks.node.test.ts'],
    signature: 'bench/src/perf-workload.ts: the third production serveAgent file',
    signatureSource: 'test-title',
  },
  {
    id: 'P2',
    why:
      'The same reversion on this rig’s worker loop — `B1`/`B2`’s pairing one file over, and a ' +
      'pair for the identical reason: the guard that catches both is a count over the whole ' +
      'file, so a single entry would be satisfied by an instrument that only ever sees one of ' +
      'the two call sites, and this pair is what proves it sees either. The worker site is also ' +
      'the one where the sentinel would do real damage: `serveAgent` keys an exec slot on ' +
      '`inputCid:partitionIndex`, the gate runs at `redundancy: min(2, nodes)`, and a rig that ' +
      'admitted every offer would let all sixteen shards of every iteration land unbounded on ' +
      'one node — which the gate would report as a **ratio**, not as a failure.',
    file: 'packages/bench/src/perf-workload.ts',
    find: 'capacity: new LocalCapacity({ nodeId: id, maxConcurrent: GATE_ADMISSION_LIMIT }),',
    replace: "capacity: 'accepts-every-offer',",
    caughtBy: ['packages/node/src/serve-agent-hooks.node.test.ts'],
    signature: 'bench/src/perf-workload.ts: the third production serveAgent file',
    signatureSource: 'test-title',
  },
  {
    id: 'P3',
    why:
      'DET-03, and — like `M36` — this entry pins an **absence** rather than a line. The perf ' +
      'gate wraps neither side of its own ratio in `guardModuleProvenance`, while `bin/bench.ts` ' +
      'wraps all three of its rigs and says why against its own interest: *"if the fabrics pay ' +
      'for the check and the baseline does not, every reported speedup is inflated by exactly ' +
      'the difference."* The two rigs therefore do not measure the same quantity, and nothing ' +
      'said so until defect #19 went looking. **The absence is not the defect this pins — the ' +
      'silence is.** Wiring the guard changes what `measureGateLadder` measures, and ' +
      '`perf-baseline.ts` holds committed wall-clock numbers the gate asserts against, so the ' +
      'wiring and a re-baseline are one commit or the gate reports a change of workload as a ' +
      'regression. Planting the wrap is what turns that into a red test at the moment somebody ' +
      'tries it, instead of a surprise minutes later under `O2_PERF=1`. When the guard really ' +
      'lands with a retaken baseline, this entry is the thing to delete.',
    file: 'packages/bench/src/perf-workload.ts',
    find: "    executor: new WasmExecutor({ nodeId: 'requestor', blockstore: originStore }),",
    replace:
      '    executor: guardModuleProvenance(\n' +
      "      new WasmExecutor({ nodeId: 'requestor', blockstore: originStore }),\n" +
      '      { resolver: new SignedNameResolver([]), now: () => Date.now() },\n' +
      '    ),',
    caughtBy: ['packages/node/src/serve-agent-hooks.node.test.ts'],
    signature:
      'bench/src/perf-workload.ts composes no provenance guard where bin/bench.ts composes one at every rig',
    signatureSource: 'test-title',
  },
  {
    id: 'E1',
    why:
      'AUTH-04’s **cost** half, and the entry `19-VERIFICATION.md` asked for by name: *"`M54` ' +
      'pins the bound; nothing pins what it cost."* `serveAgent` serves `enrol` ' +
      'unauthenticated, and `enrol` checks possession and consent — two Ed25519 verifications — ' +
      '**before** either budget is read. That ordering is correct and `enrollment.ts` records ' +
      'why: the limiter keys on `userKey`, so a cross-user attempt that reached it would consume ' +
      'the victim’s window. It is also the whole of the CPU exposure, because a provider that ' +
      'has already decided to refuse pays those two verifications anyway. Hoisting a budget ' +
      'check above them is the obvious cheap mitigation and is the mutation planted here; it ' +
      'collapses the measured verification tax from 56–146× to about 1, and the exchange rate ' +
      'against a fresh identity from 3.0 to 0.02. **The entry pins an accepted exposure, not a ' +
      'guarantee** — owner decision 2026-08-02 accepted it deliberately — so when a mitigation ' +
      'is ruled in, delete this entry and its readings rather than loosening them.',
    file: 'packages/core/src/enrollment.ts',
    find: '    const challenge = possessionChallenge(request.nodeKey, request.userKey)\n',
    replace:
      '    const challenge = possessionChallenge(request.nodeKey, request.userKey)\n' +
      "    if (this.#maxIssuedPerWindow !== 'issues-without-an-aggregate-budget') {\n" +
      '      const spent = this.#recentForAnybody(now)\n' +
      '      if (spent.length >= this.#maxIssuedPerWindow) {\n' +
      '        return {\n' +
      '          ok: false,\n' +
      "          refusal: {\n            kind: 'issuance-budget-exhausted',\n" +
      '            limit: this.#maxIssuedPerWindow,\n' +
      '            windowMs: this.#windowMs,\n' +
      '            retryAfterMs: Math.min(...spent) + this.#windowMs - now,\n' +
      '          },\n' +
      '          reason: `this provider has issued ${spent.length} certificates`,\n' +
      '        }\n' +
      '      }\n' +
      '    }\n',
    caughtBy: ['packages/node/src/enrollment-dos.node.test.ts'],
    signature: "expected 'issuance-budget-exhausted' to be 'bad-proof-of-possession'",
    signatureSource: 'rendered-at-runtime',
  },
  {
    id: 'E2',
    why:
      'AUTH-04’s cost half at the wire, and the second thing nothing pinned: the `enrol` branch ' +
      'takes no capacity slot **and consults no authorizer**, so a node sitting at its declared ' +
      'admission bound refuses seven of eight dispatches by name and serves eight of eight ' +
      'enrolments in the same instant. Planting an authorization step on that branch is what ' +
      'proves the reading is a reading — the counted call list goes from `[exec]` to `[exec]` ' +
      'plus one per enrolment. Like `M36` and `P3` this pins an **absence**, and the absence is ' +
      'accepted rather than approved: `enrollment.ts`’ header calls the DoS *"accepted ' +
      'deliberately rather than mitigated"*, and criterion 5’s second clause is an open owner ' +
      'ruling that this entry deliberately does not settle. **A capacity slot is not the ' +
      'mitigation**, and that was measured rather than argued from the docblock: planted, eight ' +
      'concurrent enrolments at `maxConcurrent: 1` with nothing else running were all served, ' +
      'because `enrol` is synchronous and nothing can interleave around it — while in a rig ' +
      'where one `exec` held the shared slot, **zero** of eight enrolments got through. The ' +
      'slot binds only against the wrong verb.',
    file: 'packages/net/src/agent.ts',
    find: "      response =\n        options.enroll === 'issues-no-certificates'\n",
    replace:
      '      const enrolRefusal =\n' +
      "        options.authorize === 'serves-unauthenticated'\n" +
      '          ? null\n' +
      '          : options.authorize({\n' +
      "              kind: 'combine',\n" +
      "              combine: { combineId: 'enrol', inputCids: [], level: 0 },\n" +
      '              capability: [],\n' +
      '            })\n' +
      '      response =\n' +
      '        enrolRefusal !== null\n' +
      '          ? { kind: \'error\', reason: `unauthorized: ${enrolRefusal}` }\n' +
      "          : options.enroll === 'issues-no-certificates'\n",
    caughtBy: ['packages/node/src/enrollment-dos.node.test.ts'],
    // Deliberately the right-hand side alone. The observed FAIL line was `expected
    // [ 'exec', 'combine', 'combine', …(6) ] to deeply equal [ 'exec' ]`, and the left
    // half is vitest's width-dependent truncation — a signature keyed on `…(6)` would
    // be a guard that stops matching when somebody resizes a terminal.
    signature: "to deeply equal [ 'exec' ]",
    signatureSource: 'rendered-at-runtime',
  },
  // ── W1…W5 — the generation loop, Phase 20 plan 01, measured 2026-08-04 ────────────
  //
  // Five defects planted into `job/submit.ts`'s new generation loop and watched go red
  // against `packages/core/src/job/submit.test.ts`. They replace `M36`, which pinned the
  // **absence** of this loop and whose own `why` named its deletion as the correct end.
  //
  // **A sixth was planted and left the file GREEN**, and it is recorded in `W3` rather
  // than dropped, because a plant that cannot fail is the finding. Substituting
  // `spec.nodes` for the gate's own pool in the re-placement — the obvious "eligibility
  // was widened" mutation — changes nothing observable: both placers call `eligibleNodes`
  // as their first act on whatever pool they are handed, so the sovereignty gate re-runs
  // inside the placer and refuses the foreign nodes regardless. Measured across the whole
  // of `packages/core/src`: **30 files, 516 tests, zero failures.** The claim that
  // sovereignty survives re-dispatch is therefore carried by `sovereignty.ts`, not by
  // this loop, and `W3` plants the mutation that *can* fail instead.
  {
    id: 'W1',
    why:
      'WIRE-04 — the whole of it. `submitJob` called `executeVerified` exactly once per shard ' +
      'until Phase 20, so a node that answered the offer while free and then refused the ' +
      'dispatch ended that shard and nothing tried anyone else. This plants that behaviour back: ' +
      'the loop runs its first generation and returns it unchanged. It is the entry that says ' +
      'the loop is a loop rather than dead code wrapped around a single pass, and it is the one ' +
      'to check first if any of the four below are ever weakened — a re-dispatch that never ' +
      'happens satisfies every assertion about *what* a re-dispatch may do.',
    file: 'packages/core/src/job/submit.ts',
    find: '        // How much is still missing. A shard that agreed at 1 of 2 needs one more',
    replace:
      '        break\n' +
      '        // How much is still missing. A shard that agreed at 1 of 2 needs one more',
    caughtBy: ['packages/core/src/job/submit.test.ts'],
    // Measured: 5 failed, 62 passed. The first FAIL line's title, which vitest echoes
    // verbatim; its rendered assertion was `expected 'insufficient' to be 'agreed'`.
    signature:
      're-places a refused shard onto an untried node, and says so beside a control that never had to',
    signatureSource: 'test-title',
  },
  {
    id: 'W2',
    why:
      'The **second** re-dispatch trigger, which is the common one and not the loud one. ' +
      '`executeVerified` returns `insufficient` only when *every* executor failed; at ' +
      'redundancy 2 with one executor dead it returns `agreed` with `replicas: 1` — a shard that ' +
      'silently got half the verification it asked for. This plants the version that looks ' +
      'finished: trigger on `insufficient` alone. **What makes this entry worth its own line is ' +
      'which case it reddens.** Measured: 1 failed, 66 passed — the top-up case goes red and the ' +
      'refused-then-re-placed case stays GREEN, because at redundancy 1 the only shortfall ' +
      'expressible is `insufficient` and that case satisfies the first trigger incidentally. So ' +
      'the top-up case, and only it, carries this claim.',
    file: 'packages/core/src/job/submit.ts',
    find:
      "          if (verification.status === 'agreed' && verification.replicas >= spec.redundancy) {",
    replace: "          if (verification.status === 'agreed') {",
    caughtBy: ['packages/core/src/job/submit.test.ts'],
    // Rendered assertion on that run: `expected 1 to be 2` — the replicas the top-up
    // reached against the redundancy the job asked for.
    signature:
      'tops up a shard that agreed below its redundancy, and reaches full redundancy across two generations',
    signatureSource: 'test-title',
  },
  {
    id: 'W3',
    why:
      'DATA-03/DATA-04 across generations, planted at the level where it can actually fail. The ' +
      'tempting mutation — hand the re-placement `spec.nodes` instead of the gate’s pool — leaves ' +
      'the tree green, because `planPlacement` and `placeWithOffers` both call `eligibleNodes` ' +
      'first on whatever pool they are given; widening a placer’s *input* cannot widen its ' +
      'output. So the mutation that has to be planted is the one that skips the placer ' +
      'altogether and dispatches to any untried executor, which is the shape a re-dispatch ' +
      'written for liveness alone would naturally take. Measured: 2 failed, 65 passed — a ' +
      'sovereign shard whose owner has exactly one node, which fails, reaches `agreed` on a ' +
      'foreign owner’s node instead of stopping, and a public job’s receipt reads `independent` ' +
      'where the fixture placed one operator. **Note what this does not say**: it does not say ' +
      'the loop enforces sovereignty. `sovereignty.ts` does. What it says is that the loop still ' +
      'goes through a placer at all.',
    file: 'packages/core/src/job/submit.ts',
    find:
      '        const again = await placeAgain(\n' +
      '          requestFor(shard, shardId, wanted),\n' +
      '          gate.pool,\n' +
      '          new Set(attempted),\n' +
      '          spec.admit,\n' +
      '        )',
    replace:
      '        const untried = spec.executors.filter((e) => !new Set(attempted).has(e.nodeId))\n' +
      '        const again = untried.length === 0\n' +
      '          ? ({ placed: false, rejections: [] } as const)\n' +
      '          : ({ placed: true, nodeIds: untried.slice(0, wanted).map((e) => e.nodeId), rejections: [], degraded: false } as const)',
    caughtBy: ['packages/core/src/job/submit.test.ts'],
    // Rendered assertion: `expected 'agreed' to be 'insufficient'` — the sovereign shard
    // that should have stalled instead completed, somewhere it may never run.
    signature:
      'keeps a sovereign shard on its owner’s nodes across generations, and stops rather than leaving them',
    signatureSource: 'test-title',
  },
  {
    id: 'W4',
    why:
      'CHURN-04’s bound, and where it lives. The loop keeps no counter of its own: it stops ' +
      'because `LeaseTable.grant` returns null once `DEFAULT_MAX_GENERATIONS` is spent, which is ' +
      'also what records the `abandoned` event that explains the stop. This plants a fabricated ' +
      'lease over the null, which is exactly what a loop that "handled" the null defensively ' +
      'would look like. Measured on a five-node fixture where every node fails: the shard walks ' +
      'all **five** instead of stopping at three — `expected 5 to be 3` — so the reading is a ' +
      'count and not "it terminated". A hardcoded counter of 3 would pass that count and fail ' +
      'the `abandoned` assertion beside it, which is what says the bound lives in the table.',
    file: 'packages/core/src/job/submit.ts',
    find:
      '        const lease = leases.grant(shardId, holderId, clock.now())\n' +
      '        if (lease === null) {\n' +
      "          ending = 'generations-spent'\n" +
      '          break\n' +
      '        }',
    replace:
      '        const lease = leases.grant(shardId, holderId, clock.now()) ?? {\n' +
      '          taskId: shardId,\n' +
      '          nodeId: holderId,\n' +
      '          grantedAt: clock.now(),\n' +
      '          expiresAt: clock.now() + 30_000,\n' +
      '          generation: generations + 1,\n' +
      '        }',
    caughtBy: ['packages/core/src/job/submit.test.ts'],
    signature: 'stops at the generation cap, naming every node that failed it, with the lease abandoned',
    signatureSource: 'test-title',
  },
  {
    id: 'W5',
    why:
      'CHURN-04, and the difference between a lease and a longer timeout. A renewal granted on a ' +
      'timer alone makes the bound unbounded; renewal here is conditional on the holder answering ' +
      'a probe on **this task’s own capacity slot key** with `LocalCapacity`’s duplicate refusal. ' +
      'This plants the unconditional form by deleting the evidence check, which is the single ' +
      'most plausible simplification anyone will propose against this file. ' +
      '**Two things this entry records that the plan it came from did not predict.** First, the ' +
      'mutation does not merely fail — it makes the run *non-terminating*: every wait in the ' +
      'renewal fixture is a microtask, so a lease renewed forever never yields to the macrotask ' +
      'queue and no vitest timeout can fire. The fixture therefore gives its virtual clock a ' +
      'horizon and refuses to pass it, which turns a hang into a named failure. Second, planting ' +
      'this found a real defect in the honest code: the wake-up instant was computed forward from ' +
      '`grantedAt`, and since `LeaseTable.renew` holds `grantedAt` fixed while pushing `expiresAt` ' +
      'out, the renewal point overtook the current instant once elapsed time passed twice the ' +
      'lease — after which a working holder’s lease lapsed anyway. Measuring back from the ' +
      'deadline fixes it. The mutation reddened the *wrong arm* until it was fixed, which is how ' +
      'it was found.',
    file: 'packages/core/src/job/submit.ts',
    find:
      '    if (!(await probeHolder(probe, lease.nodeId))) {\n' +
      '      // No evidence. **Not** a renewal, and not an expiry either — the holder keeps the\n' +
      '      // rest of its lease, which is the window in which a node that had just finished\n' +
      '      // and released its slot still answers in time.\n' +
      '      renewable = false\n' +
      '      continue\n' +
      '    }\n\n',
    replace: '',
    caughtBy: ['packages/core/src/job/submit.test.ts'],
    // Rendered on the observed run: `Error: the lease clock passed 300000ms of virtual
    // time — this dispatch is not bounded by its lease`.
    signature: 'renews a lease only against evidence the holder is still working — one fixture, both arms',
    signatureSource: 'test-title',
  },
  // ---------------------------------------------------------------------------
  // S1–S4 — the comment stripper, added 2026-08-04 for defect #40
  // ---------------------------------------------------------------------------
  //
  // Six source-scanning guards each carried their own stripper, five of them the same
  // regex pair. It has no notion of where it is in a file, so a comment opener inside a
  // string literal opened a comment the source never opened and deleted everything to the
  // next closer anywhere in the file. `packages/node/src/strip-comments.ts` replaces them
  // with a tokenizer and keeps that regex beside it, exported as `BLINDABLE`, for exactly
  // these four entries: each rewrites one guard's import so the guard runs with its old
  // blindness restored.
  //
  // **Why these four and not all six.** `bench-egress` is the one guard whose stated
  // defence held — every requirement in it is a presence check, so over-stripping fails
  // loudly there. `identity-store`'s stripper was a different (line-prefix) implementation
  // and its scan is a `subtle` census with no absence claim resting on the strip. The four
  // below are the ones that failed OPEN: three assert *absence* and one has a `forbidden`
  // arm, so for all four a blinded scan reads as a clean result.
  //
  // **Each of these needed a new case in its own guard before it could be planted at all,
  // and that is the finding rather than a detail.** Measured 2026-08-04 across all 314
  // tracked source files, no guard's found/not-found verdict differs between the two
  // strippers — the mechanism is live, and nothing a guard currently searches for overlaps
  // one of the 70 stray openers. So a swap alone reddened nothing. Every planted-pair block
  // in these files plants an *ordinary* comment, which a stripper that strips too much
  // satisfies perfectly; none of them planted a comment opener the source never opened,
  // which is the case that blinds them. Those cases were added with this change, and they
  // are what the reds below are.
  {
    id: 'S1',
    why:
      'DET-03’s absence guard, and the clearest instance of the class. `trust-anchors` asserts the ' +
      'provenance opt-out appears nowhere outside a test — an assertion of the form "this list is ' +
      'empty", which a blinded scan satisfies perfectly. Its docblock named stripping as dangerous ' +
      'and pointed at its planted-pair block as the defence; that block plants an ordinary comment ' +
      'and never a desync, so the defence did not cover the case. With the regex restored, an ' +
      'opt-out sitting below a string literal containing a comment opener is deleted before `flags` ' +
      'sees it, the repository reads clean, and the empty result the main assertion produces is a ' +
      'silence rather than a reading.',
    file: 'packages/node/src/trust-anchors.node.test.ts',
    find: "import { stripComments } from './strip-comments.ts'",
    replace: "import { BLINDABLE as stripComments } from './strip-comments.ts'",
    caughtBy: ['packages/node/src/trust-anchors.node.test.ts'],
    // Measured: 1 failed, 26 passed. Rendered assertion on that run:
    // `AssertionError: expected 0 to be greater than 0`.
    signature: 'flags it below a line whose string literal merely contains a comment opener',
    signatureSource: 'test-title',
  },
  {
    id: 'S2',
    why:
      'The guard failing open on the exact defect it exists to prevent. `requirements-ledger` checks ' +
      'that a row reading "X has no production caller" is true, by searching the production corpus ' +
      'for a call. Blind that search and an obvious caller reads as absent, so a false row PASSES — ' +
      'and the file whose entire subject is five rows that were false in that direction produced the ' +
      'blindness with its own instrument. Its docblock claimed "both errors are in the safe ' +
      'direction"; that sentence is about reachability and never covered the strip. The regex also ' +
      'carried a `[^:]` special case for `https://`, which is the argument against the approach ' +
      'rather than a fix for it — it rescued the one input somebody noticed and did nothing for ' +
      '`a // b`, the same bug one character over.',
    file: 'packages/node/src/requirements-ledger.node.test.ts',
    find: "import { stripComments } from './strip-comments.ts'",
    replace: "import { BLINDABLE as stripComments } from './strip-comments.ts'",
    caughtBy: ['packages/node/src/requirements-ledger.node.test.ts'],
    // Measured: 1 failed, 15 passed. Rendered assertion on that run:
    // `expected 'const a = 1 \n \nconst b = \'https:' to contain '\'https://x\''` — the
    // string literal truncated at the `//` the `[^:]` hack no longer rescues, because
    // `BLINDABLE` is the pair without it.
    signature: 'strips comments, without which every claim would read as violated',
    signatureSource: 'test-title',
  },
  {
    id: 'S3',
    why:
      'DATA-10’s scope scan, and the half its docblock got wrong. It claimed over-stripping "can ' +
      'only hide a real call site, which drops a file out of the found set and fails this scan ' +
      'loudly" — true for the three pinned files, because `toEqual` on the whole set catches a ' +
      // Note the wording: this sentence may not spell the bare call shape, paren included,
      // because `sovereign-block-refusal.node.test.ts` scans every non-test file under
      // `packages/` for it and this file is in that population. Strings are preserved by
      // the stripper — deliberately, that is the defect being fixed — so prose in a string
      // literal reads exactly like code. Caught by that guard on the first full run.
      'disappearance. It is false for a NEW file whose bare call is blinded: that file never ' +
      'enters `found`, `found === expected` still holds, and the scan passes. Detecting a new bare ' +
      'submit path is the entire reason this scan reads the repository instead of three files, so ' +
      'the guard failed open on its own purpose.',
    file: 'packages/node/src/sovereign-block-refusal.node.test.ts',
    find: "import { stripComments } from './strip-comments.ts'",
    replace: "import { BLINDABLE as stripComments } from './strip-comments.ts'",
    caughtBy: ['packages/node/src/sovereign-block-refusal.node.test.ts'],
    // Measured: 1 failed, 3 passed. Rendered assertion on that run:
    // `AssertionError: expected false to be true`.
    signature: 'can report a new call site, and is not satisfied by prose describing one',
    signatureSource: 'test-title',
  },
  {
    id: 'S4',
    why:
      'The `forbidden` arm, which inverts the defence this file inherited verbatim from ' +
      '`bench-egress.node.test.ts`. A `forbidden` pattern is must-NOT-match, so a scan blinded ' +
      'before it reaches the line reports the requirement SATISFIED — over-stripping fails open ' +
      'here, not loudly. The inherited sentence was already false at the moment the field was ' +
      'introduced, and the field’s own docblock explains why the field is needed without noticing ' +
      'that it reverses the claim four lines above. Concretely: `const complete = … && reduce.ok` ' +
      'would couple every published p50/p95/p99 to the reduce having succeeded, and a blinded scan ' +
      'reports that coupling absent.',
    file: 'packages/node/src/bench-reduce.node.test.ts',
    find: "import { stripComments } from './strip-comments.ts'",
    replace: "import { BLINDABLE as stripComments } from './strip-comments.ts'",
    caughtBy: ['packages/node/src/bench-reduce.node.test.ts'],
    // Measured: 1 failed, 18 passed. Rendered assertion on that run:
    // `AssertionError: expected [] to deeply equal [ Array(1) ]` — the empty list being
    // the blinded scan reporting the coupling requirement as met.
    signature: 'reports it even when a string literal above the coupling holds a comment opener',
    signatureSource: 'test-title',
  },
  // -------------------------------------------------------------------------
  // C1–C3 — defect #39, 2026-08-04. Narrowing what a guard blocks on.
  //
  // Every one of these turns five guards off without turning anything red, which is
  // why they are here: the change they protect is one whose failure mode is a green
  // run in which nothing was checked. `O2_SKIP_GUARDS=1` is at least visible in the
  // log; none of these three would be visible anywhere.
  // -------------------------------------------------------------------------
  {
    id: 'C1',
    why:
      'The whole safety of defect #39’s fix, inverted. `commit-scope` narrows a guard’s blocking ' +
      'set to the paths in the current commit, and `NO_COMMIT_SCOPE` is what it returns when it ' +
      'cannot tell whose commit this is — missing variable, unreadable file, empty file, malformed ' +
      'file. Under that value every finding must be treated as own. Swap the two arms and the ' +
      'opposite happens: a guard run by `npm test`, by a verifier, or by a hook whose environment ' +
      'did not reach the worker blocks on NOTHING, and reports a clean tree it never examined. ' +
      'There is no output that distinguishes that from a repository with no violations in it, ' +
      'which is why this cannot be left to a docblock saying the default is strict.',
    file: 'packages/node/src/commit-scope.ts',
    find: 'return { own: [...findings], foreign: [] }',
    replace: 'return { own: [], foreign: [...findings] }',
    caughtBy: ['packages/node/src/commit-scope.node.test.ts'],
    // Measured 2026-08-04: 1 failed, 18 passed. Rendered assertion on that run:
    // `AssertionError: expected [] to deeply equal [ { paths: [ …(2) ], …(1) }, { …(2) } ]`.
    signature: 'blocks on every finding when there is no scope',
    signatureSource: 'test-title',
  },
  {
    id: 'C2',
    why:
      'The union rule, reduced to an intersection — the real fail-open of a naive narrowing, and ' +
      'the one the `translationCid` case in `7717ade` turns on. A finding names EVERY path that ' +
      'participates: a requirements row broken by a new caller names the ledger and the caller ' +
      'both, because either author can resolve the contradiction and either may be the one ' +
      'committing. `some` holds whichever of them is present; `every` holds only somebody who ' +
      'staged all of them at once, which in a repository worked by concurrent agents is nobody. ' +
      'The guard would then pass for the author of the caller and for the author of the row alike, ' +
      'with the finding printed as somebody else’s and no red anywhere.',
    file: 'packages/node/src/commit-scope.ts',
    find: '!finding.paths.some((path) => scope.has(path))',
    replace: '!finding.paths.every((path) => scope.has(path))',
    caughtBy: ['packages/node/src/commit-scope.node.test.ts'],
    // Measured 2026-08-04: 4 failed, 15 passed — both union arms, the single-path
    // regression case, and the end-to-end `blocking` case. Rendered assertion:
    // `AssertionError: expected [] to deeply equal [ { paths: [ …(2) ], …(1) } ]`.
    signature: 'blocks the author of the caller',
    signatureSource: 'test-title',
  },
  {
    id: 'C3',
    why:
      'Path-form drift, which is the residual fail-open of defect #39’s fix and the one recorded ' +
      'as most likely to actually happen. Every guard emits repo-relative POSIX because that is ' +
      'what `git ls-files` and `git diff-index --name-only` print; a leading slash on either side ' +
      'of the comparison makes every finding foreign and the guards stop blocking with NO symptom ' +
      '— no red, no output, nothing that distinguishes it from a clean run. `isLsFilesForm` is the ' +
      'check at both ends, so weakening one of its clauses is exactly how the drift would arrive ' +
      'unnoticed: an absolute path in the scope file would then be accepted as a scope, and the ' +
      'per-guard round-trip assertions would accept a corpus that can never be matched.',
    file: 'packages/node/src/commit-scope.ts',
    find: "if (path.startsWith('/')) return false",
    replace: "if (path.startsWith('/')) return true",
    caughtBy: ['packages/node/src/commit-scope.node.test.ts'],
    // Measured 2026-08-04: 3 failed, 16 passed. Rendered assertion on the first:
    // `AssertionError: expected Set{ '/Volumes/x/packages/core/src/a…' } to be
    // 'no-commit-scope'`.
    signature: 'refuses an absolute or dot-prefixed path',
    signatureSource: 'test-title',
  },
]

/** Literal occurrences of `needle` in `text`. `needle` must be non-empty. */
export function occurrences(text: string, needle: string): number {
  if (needle.length === 0) return 0
  return text.split(needle).length - 1
}

/**
 * Vitest joins a nested title with this when it prints a FAIL line, so a signature
 * copied off a `describe > it` run is two source strings, not one.
 */
const TITLE_SEPARATOR = ' > '

/**
 * Whether a `test-title` signature is still findable in the tests that catch it.
 *
 * ## What this catches
 *
 * A test renamed while the ledger's signature stayed behind — `B1`/`B2` sat at
 * `five sentinels twice` for four commits after the test became `six`, and the only
 * thing that noticed was a full `npm run test:mutations`. That is now a red in the
 * ordinary suite, on the same run that would have introduced it.
 *
 * ## What this does not catch, and must not be read as catching
 *
 * - **The whole `rendered-at-runtime` arm.** Twenty-four of these entries carry
 *   assertion or runner output, which exists in no file. Nothing here reads them;
 *   only a planted run can.
 * - **A title that is present but not running.** `it.skip`, a `describe` that no
 *   longer wraps it, a title sitting in a comment — all contain the substring. This
 *   is a text search, not a collection of the suite.
 * - **Whether the mutation actually makes *that* test fail.** A signature can name a
 *   live, passing test in the right file and still be the wrong test for this defect.
 *   That is exactly what layer 2 establishes, and this does not replace it.
 * - **A signature short enough to match by accident.** Length is checked against zero
 *   and nothing else, so a three-character signature would pass here and be worthless.
 *
 * The first bullet is the one worth restating: this check is silent on **22 of the 82**
 * entries by construction — the `rendered-at-runtime` half. (It read *"24 of the 72"* until
 * 2026-08-04, which was wrong in both figures at the moment it was written; see the header
 * for why this file now has two expired counts on record rather than one.) A guard that
 * appears to cover a population it cannot is the defect this function exists to close, so
 * its scope is written down rather than left to be inferred from the fact that it passes.
 */
function signatureProblems(entry: Mutation, caughtByContent: readonly (string | null)[]): string[] {
  // Both already produce their own, more specific problem above. Reporting a second
  // one here would name a cause that is not the cause.
  if (entry.signature.length === 0) return []
  const texts = caughtByContent.filter((text) => text !== null)
  if (texts.length === 0) return []

  const somewhere = (needle: string): boolean => texts.some((text) => text.includes(needle))
  const where = entry.caughtBy.join(', ')

  if (entry.signatureSource === 'rendered-at-runtime') {
    // The reverse reading, and it costs nothing. An entry that says "no literal
    // exists" while the literal is right there is a false statement in the ledger,
    // and it is also the shape a copied entry leaves behind — the stronger arm was
    // available and was not taken.
    if (somewhere(entry.signature)) {
      return [
        `${entry.id}: declares its signature rendered-at-runtime, but ${JSON.stringify(entry.signature)} ` +
          `appears verbatim in ${where} — say 'test-title' instead, which is the arm that is checked`,
      ]
    }
    return []
  }

  if (somewhere(entry.signature)) return []

  // A compound `describe > it` signature is never one literal, because the two
  // titles are two string literals in the source. Split, and require every half —
  // requiring only one would let the `it` half drift while the `describe` half held
  // the check up, which is the same hole one level down.
  const parts = entry.signature.split(TITLE_SEPARATOR).filter((part) => part.length > 0)
  const split = parts.filter((part) => !somewhere(part))
  if (parts.length > 1 && split.length === 0) return []
  // A signature that is nothing but separators splits to no parts at all, and an
  // empty `missing` list would report a drift while naming nothing drifted.
  const missing = split.length > 0 ? split : [entry.signature]

  return [
    `${entry.id}: declares a test-title signature that ${where} no longer contains. ` +
      `A signature that names no test cannot prove a guard fired, and the full planted ` +
      `run is the only thing that would have noticed. Missing: ${missing.map((part) => JSON.stringify(part)).join(', ')}`,
  ]
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
 *
 * `caughtByContent` carries the *text* of each `caughtBy` file, in the order they are
 * named, with `null` for one that is not on disk. It used to be a `boolean[]` of
 * presence, which was the whole of the D20 hole: presence answers "is the file still
 * there", and nothing answered "does the file still contain the test this entry says
 * catches it". See {@link signatureProblems} for what the answer covers and, more
 * importantly, what it does not.
 */
export function problemsWith(
  entry: Mutation,
  content: string | null,
  caughtByContent: readonly (string | null)[],
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
  for (const [index, text] of caughtByContent.entries()) {
    if (text === null) problems.push(`${entry.id}: caughtBy names ${entry.caughtBy[index]}, which is not on disk`)
  }
  problems.push(...signatureProblems(entry, caughtByContent))
  return problems
}
