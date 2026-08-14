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
 * one below was read off a real planted run — Phase 13.1's ten on 2026-07-29, and every
 * entry added since on the run its own comment names. It exists so that "the suite went
 * red" is not accepted on its own: a mutation that trips an unrelated flake, a port
 * collision or an OOM would also produce a non-zero exit, and that is not evidence the
 * guard saw anything.
 *
 * A signature is therefore *output*, and most output has no literal in any file. But a
 * large majority of these are the test's own title, which vitest echoes verbatim, and a
 * title **is** source text. **How large is {@link TITLE_SIGNATURE_COUNT}, which is derived
 * from the array below rather than written here.** That is deliberate, and it is the fix
 * for a defect this paragraph committed three times: it read *"26 of the 40"*, then
 * *"48 of the 72"* — already stale by eight when it was written — then *"60 of the 82"*,
 * which was stale by three the next day. Each time, the sentence warning that a count
 * written into prose expires exactly the way a `find` string does was itself the sentence
 * that had expired, and nothing read it. Its own diagnosis was that *"the right fix is a
 * derived count, not a third transcription"*; that fix is now taken, here and in
 * `mutation-guard.node.test.ts`, which reads the derived constants instead of integers
 * somebody typed. That is the half the cheap layer
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
      'call. **This entry read "which is the reading `runResilient` retries on" until ' +
      '2026-08-05, and that had stopped being true**: Plan 20-12 deleted `runResilient` ' +
      'under WIRE-04, and 20-12 reported the stale sentence rather than editing a file it ' +
      'did not own. The distinction survives its old consumer and is narrower than it was. ' +
      '`remoteDispatch` is the only thing that reads `DispatchOutcome.kind`, and it now has ' +
      'no production caller at all — `submitJob` gets `ExecutionOutcome` from the `Executor` ' +
      'port, which flattens every failure to `{nodeId, reason}` by deliberate design, so the ' +
      'one job path **cannot** see this classification. What the generation loop counts ' +
      'instead is distinct nodes that failed, bounded by `DEFAULT_MAX_GENERATIONS`; the cost ' +
      'is that a shard whose module traps burns up to three nodes rather than being given up ' +
      'on after one classified `task` failure, and that trade is recorded rather than hidden. ' +
      'The entry stays because the classification is still computed, still correct, and still ' +
      'the thing a kind on `ExecutionOutcome` would restore — see this phase’s deferred list.',
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
    find: '    const shared = sharedRelay(members, rules.peerIdOf)',
    replace: '    const shared = sharedRelay(distinct, rules.peerIdOf)',
    caughtBy: ['packages/core/src/quorum.test.ts'],
    signature: 'refuses a one-member quorum that hangs off a single relay',
    signatureSource: 'test-title',
  },
  {
    id: 'M39b',
    why:
      'VER-03 — the second arm of rule 2, added 2026-08-14, and the argument that it is not ' +
      'decoration. `relayIds` names relays by PEER ID while a quorum member is identified by ' +
      '`nodeKey`; two spellings of one node that never compare equal. So when the relay every ' +
      'other member depends on was ITSELF a member, no comparison in `quorum.ts` could see it — ' +
      'and because a relay binds a socket it enrols `seed`, whose dependency set is empty, so ' +
      '`sharedRelay` returned `null` and the quorum composed while reporting a redundancy one ' +
      'node’s failure would erase. That is the browser tier’s own topology, not a contrived ' +
      'one. Dropping the mapping at the call site restores exactly the old, silent behaviour ' +
      'while leaving every other line of the rule in place, which is what makes it the right ' +
      'plant: it cannot be caught by a test that merely reads rule 2, only by one that reads ' +
      'this case.',
    file: 'packages/core/src/job/submit.ts',
    find: '          peerIdOf: (certificate) => peerIdByNodeKey.get(certificate.nodeKey) ?? null,\n',
    replace: '',
    caughtBy: ['packages/core/src/job/submit.test.ts'],
    signature: 'refuses when the relay every other candidate depends on is itself a candidate',
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
    id: 'M66',
    why:
      'AUTH-02 / criterion 8 — **the gate itself, at the one branch that decides the ' +
      'criterion’s own subject.** A peer that answers the `records` ask and says it holds ' +
      'nothing is exactly *"a node that cannot present a provider-issued certificate"*, and ' +
      'this line is where that peer is turned away. Flipping the verdict leaves the whole ' +
      'mechanism in place and makes it decoration: the gater is still installed, still ' +
      'consulted, still asks, still records a decision with the identical operator-facing ' +
      'sentence — and admits everybody it was built to refuse. **That is the shape worth ' +
      'planting**, because every structural guard 24-01 and 24-03 built stays green through ' +
      'it: `relay-admission.node.test.ts`’s census counts postures and call sites, not ' +
      'verdicts, and `admissionDecisions` still fills up. The wrong-issuer branch below is ' +
      'untouched by this plant, so the named case fails on the no-certificate arm alone while ' +
      'the arm beside it still refuses — which is what makes the failure attributable.',
    file: 'packages/node/src/fabric-node.ts',
    find: '        return decide(false, `${peerId} holds no provider-issued certificate, so it is not admitted to this relay`)',
    replace: '        return decide(true, `${peerId} holds no provider-issued certificate, so it is not admitted to this relay`)',
    caughtBy: ['packages/node/src/enrolment-residual.node.test.ts'],
    signature: 'records why each peer was turned away, and the no-certificate reason is not the wrong-issuer one',
    signatureSource: 'test-title',
  },
  {
    id: 'M67',
    why:
      'AUTH-02 / criterion 8 — **the one line that decides whether the seed’s door can be ' +
      'closed at all.** `seed-server.ts` held `relayAdmission: \'admits-any-peer\'` as a literal ' +
      'until Plan 24-06, which is the structural fact `24-VERIFICATION.md` scored criterion 8 ' +
      'PARTIAL on in its own words: *"for the seed there is no knob"*. This plant puts the ' +
      'literal back while leaving **everything else in place** — `SeedServerOptions` still ' +
      'declares the required field, `bin/seed.ts` still parses `--admit-issuer`, still ' +
      'validates its hex, and still prints the closed arm of its banner naming the pinned ' +
      'keys. So the operator is told the door is shut and the door is open, which is the ' +
      'exact class of defect an operator has no way to detect from outside the process. ' +
      '**Measured rather than predicted, which guards move and which do not.** The two ' +
      'declaration guards stay green: the field is still declared once as a definition in ' +
      '`fabric-node.ts` and once as a forwarding indexed access in `seed-server.ts`, and this ' +
      'plant touches neither. The `bin/seed.ts` census row stays green: that file is unedited. ' +
      'What moves is the `seed-server.ts` `PRODUCTION_SITES` row, whose census counts raw ' +
      '`OPEN_POSTURE` occurrences in **text** and reads 1 where the repaired tree reads 0 — ' +
      'and, on the other side of the process boundary and sharing no code with it, the ' +
      'spawned-seed case named below, whose uncertificated joiner obtains real circuit ' +
      'multiaddrs through a seed that was told to close. A source census and a live libp2p ' +
      'node reddening on one defect is what makes the wiring claim real rather than textual. ' +
      '**`packages/node/src/closed-fabric-agents.node.test.ts` was ALSO measured to catch ' +
      'this** — Plan 24-07 planted exactly this edit and watched `/bootstrap.json` advertise ' +
      'an uncertificated peer and the whole-set reading name `door: "seed"` — but that file ' +
      'is untracked at the time this entry was written and `mutation-guard.node.test.ts` ' +
      'requires every path named here to be git-tracked. Whoever commits it should add it to ' +
      '`caughtBy`; the reading is recorded in `24-07-SUMMARY.md` as plants Pb and Pb′.',
    file: 'packages/node/src/seed-server.ts',
    find: '      relayAdmission: options.relayAdmission,',
    replace: "      relayAdmission: 'admits-any-peer',",
    caughtBy: ['packages/node/src/relay-admission.node.test.ts'],
    signature: 'and none when told an issuer nobody holds',
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
      'check above them is the obvious cheap mitigation and is the mutation planted here.\n\n' +
      '**Corrected 2026-08-05 by re-planting it, and one of the two figures it used to quote ' +
      'was never observable.** The sentence here read *"it collapses the measured verification ' +
      'tax from 56–146× to about 1, and the exchange rate against a fresh identity from 3.0 to ' +
      '0.02."* Three things are wrong with that. (1) `56–146×` was the spread of the ' +
      '**superseded summing estimator**, which `enrollment-dos.node.test.ts` replaced on ' +
      '2026-08-04 after measuring it inverting under load; the fastest-of-36 estimator in force ' +
      'reads 102.8×, 114.0× and 106.9× across three runs, a spread an order of magnitude ' +
      'narrower. (2) **The tax does not collapse to "about 1" under this plant, because it is ' +
      'never computed.** Re-executed 2026-08-05: the tax case reddens at its own positive ' +
      'control — the short-proof arm, which must be refused for `bad-proof-of-possession`, is ' +
      'refused by the hoisted budget instead — and the run returns before `pairedRatio` is ' +
      'called at all. So "collapses to about 1" was a prediction wearing a measurement’s ' +
      'clothes, and it is withdrawn rather than restated. (3) The exchange rate is the half that ' +
      '**is** observed, and its clean value is a band and not a point: nine readings across a ' +
      'thirty-fold range of host load sit inside 2.96–3.16. Under the plant it read ' +
      '**0.011853416149359378** on 2026-08-05 and **0.003615248196637649** on 2026-08-04 — two ' +
      'orders of magnitude below a floor of 1.5 on both runs, which is what the entry claims; ' +
      'the ratio between the two planted readings is host, not behaviour, and is why the floor ' +
      'is an order of magnitude clear rather than tight.\n\n' +
      '**The entry pins an accepted exposure, not a ' +
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
  // ═══════════════════════════════════════════════════════════════════════════════════
  // Phase 20 — the single job path, the peer ledger, and churn. Plan 20-13, 2026-08-05.
  // ═══════════════════════════════════════════════════════════════════════════════════
  //
  // Twelve plans planted defects and watched them go red. `W1`…`W5` above are plan 20-01's
  // and were written at the time; the twenty-seven below are the rest, encoded by the
  // phase's last plan because it is the plan that owns this file.
  //
  // **Every one of the twenty-seven was RE-EXECUTED on 2026-08-05, not transcribed.** Each
  // was applied, run against its own `caughtBy` files, and restored inside a single shell
  // invocation, with the restore compared byte-for-byte and the comparison read. All
  // twenty-seven went red and all twenty-seven produced the signature recorded here in the
  // run's own output. That is a stronger statement than the ledger normally makes — most
  // entries here were measured once, by the plan that wrote them — and it is made because
  // twelve plans of edits sat between the observation and the encoding, so a `find` string
  // captured mid-phase had every opportunity to have stopped matching.
  //
  // ## What is NOT here, and why — the treatment Phase 19 used for six of its own
  //
  // **Plans 20-04, 20-05 and 20-06 contributed no entries at all.** Each was required to
  // record the observed failure text of its plants and none did; all three say so in their
  // own summaries, against their own interest. An entry invented from a plan's *intent*
  // would satisfy `problemsWith` perfectly and prove nothing, which is the failure this
  // whole file exists to prevent. So the plants are named and left unencoded:
  //
  // - 20-04's return-first-generation plant and its re-pick plant. Named by this phase's
  //   own plan as load-bearing; no text survives.
  // - 20-05's three plants on the re-dispatch reading.
  // - 20-06's plants, including the one `M19`'s replacement note above points at by name —
  //   `peers: () => running.transport.peers` in `demo/main.ts`'s `startReport` replaced by
  //   `peers: () => []`, whose `caughtBy` would have been the three-engine
  //   `peer-ledger.e2e.test.ts`. That note asks 20-13 to encode it. It is not encoded,
  //   because the observed text it needs was never captured, and the note above is left
  //   standing rather than quietly satisfied.
  //
  // **20-07's budget plant is omitted for a structural reason rather than a missing one.**
  // Its recorded red — fifteen duplicates against an allowance of two — required *two*
  // sites mutated together: the `|| ledger.remaining <= 0` term dropped from the
  // permanent-stop check, **and** `ledger.request`'s refusal ignored twenty-seven lines
  // below. `Mutation` encodes one site. Neither half alone was measured, and 20-07 states
  // that `speculationSpent` stays at 2 under the plant because `SpeculationLedger.request`
  // refuses to increment past the allowance even when its answer is ignored — so the
  // single-site forms are, if anything, likely to stay green. Encoding one would be a guess
  // dressed as a reading.
  //
  // **20-11's plants 7 and 8 are omitted for the same reason as 20-04's**: both recorded a
  // red *count* (`Tests 2 failed | 92 passed` and `Tests 1 failed | 93 passed`) and named
  // the cases, but neither recorded a signature string, and `problemsWith` rejects an entry
  // without one for exactly the reason that a count is not a signature.
  //
  // **Plants on a spec's own fixture are named, not encoded.** 20-03's A/C/D/E/F, 20-09's
  // A/B/C, 20-10's 1/1b/2/5, 20-11's B/C1/C2 and 20-02's plant 3 (a `tsc` reading, which
  // `Mutation.project` admits no entry for) all mutate the measuring instrument rather than
  // the thing measured. `S1`…`S4` are this file's only entries on test files and each
  // rewrites one import; that is a deliberate narrow exception, not a precedent for
  // encoding fixtures.
  //
  // ## The greens — plants that left a file passing, which is the more informative result
  //
  // - **20-02's plant 7.** The magnitude case sent `count: MAX_REPORTED_COUNT + 1`, so
  //   raising the constant raised the probe with it and the case stayed green: it could see
  //   the check deleted and could never see the ceiling *moved*. That matters precisely
  //   here, because 20-02 lifted a deferral that was conditional on the bound existing. The
  //   case was re-anchored on an absolute (`BEYOND_ANY_CEILING = 4_000_000_000`) with a
  //   relational assertion placed **last**, and `L4` below is the entry that can now fail.
  // - **20-09's plant E, and it is still open.** `submit-with-egress.ts`'s `job: result.job`
  //   replaced by a rebuild that drops `speculationMultiplier` — the shape a wrapper
  //   naturally takes. `npx tsc --noEmit` exit **0**, no test in the tree failed, and the
  //   only thing that moved was the published artifact: `bin/bench.ts --quick` still exited
  //   0 while the `spec. tax` column went from `1.00×` to an em dash on every rung, because
  //   `report.ts` renders a non-finite ratio as "unmeasured". **The wrapper's pass-through
  //   is guarded by a printed table and by nothing executable.** No entry, because no test
  //   produced a signature; recorded because the absence is the finding.
  // - **20-10's plant 2.** The requestor's drop-poll deleted while the owner's process is
  //   still stopped: green, exit 0, the identical `covered: 2/3 owners`. What carries that
  //   reading is not the poll — a dead process closes its connection on exit and answers no
  //   provider query — so the poll is a precondition, not the instrument. `O1` and `O6`
  //   below are what actually hold the denominator.
  // - **20-11's plant C2.** A carried shard made to report its `inputCid` instead of its
  //   `resultCid`: **green** against `checkpoint-agents.node.test.ts` and red against
  //   `submit.test.ts`. The process fixture runs `MODULE_ECHOES_INPUT`, the identity
  //   function, so on that fabric a shard's result CID *equals* its input CID and the
  //   corruption is invisible. Two files, one mutation, opposite verdicts — and the reason
  //   is the fixture's module, not the file's rigour.
  {
    id: 'L1',
    why:
      'BROW-02, and the half that is easy to build and easy to leave out. `serveAgent` records ' +
      'only what a **peer** told it, so a node’s own start outcome never enters its own ' +
      'serve-side ledger. With two tabs A and B that is not a small gap: A publishes to B, B ' +
      'publishes to A, and when A then asks B it is handed back **its own row** — ' +
      '`mergeOverlapping` takes the maximum per `(browser, result)` key, so A’s merged report ' +
      'reads 1 forever, however many tabs are open. Recording the node’s own row at ' +
      'construction is the whole of the fix and it is one line. Deleting it leaves every symbol ' +
      'in place, the hook still supplied, a real `StartOutcomeLedger` still built — and the ' +
      'merged panel can never carry a family the reading tab is not, which is the only reading ' +
      'criterion 5 accepts.',
    file: 'packages/node/src/fabric-node.ts',
    find: "  if (outcome !== 'reports-no-start-outcome') held.record(outcome)\n",
    replace: '  void outcome\n',
    caughtBy: ['packages/node/src/serve-agent-hooks.node.test.ts'],
    // Re-executed 2026-08-05: 2 failed. The second was the cross-tier equality,
    // `expected [ …(14) ] to deeply equal [ …(14) ]`, which is width-dependent and is
    // therefore not the signature. 20-02 observed the same pair.
    signature: 'expected +0 to be 1 // Object.is equality',
    signatureSource: 'rendered-at-runtime',
  },
  {
    id: 'L2',
    why:
      'The hook itself, reverted to the named opt-out — the state every production node was in ' +
      'until Plan 20-02. It is a separate entry from `L1` because it fails one step earlier and ' +
      'for a different reason: `L1` is a ledger that is built and never written to, this is a ' +
      'ledger that is never handed over. Both leave the report branch answering with something ' +
      'no peer contributed to, and a reader who fixed one would have no reason to look for the ' +
      'other. `demo/index.html`’s `refreshReport` deferred the serve-side ledger behind the ' +
      'magnitude bound and the label whitelist, both of which landed; this line is what spends ' +
      'that deferral, so putting the sentinel back un-spends it silently.',
    file: 'packages/node/src/fabric-node.ts',
    find: '      ledger: startLedger,',
    replace: "      ledger: 'keeps-no-ledger',",
    caughtBy: ['packages/node/src/serve-agent-hooks.node.test.ts'],
    signature: 'expected 1 to be +0 // Object.is equality',
    signatureSource: 'rendered-at-runtime',
  },
  {
    id: 'L3',
    why:
      'BROW-02 at the wire. The two entries above are structural counts over a source file; this ' +
      'is the behaviour they exist to protect, and it is the only one of the three that a peer ' +
      'could observe. The report branch answering `counts: []` is what shipped for two ' +
      'milestones — every node opted out of the ledger, so the branch was correct about an empty ' +
      'one — and the edit that restores it looks like a simplification of a nullish chain rather ' +
      'than a removal of a feature. What it costs is that `publishStartOutcome` merges nothing, ' +
      'so every merged panel in the fabric holds only rows the reading node produced itself.',
    file: 'packages/net/src/agent.ts',
    find:
      "      response = { kind: 'report', counts: ledger?.counts() ?? [], declined: ledger?.declined ?? 0 }",
    replace: "      response = { kind: 'report', counts: [], declined: ledger?.declined ?? 0 }",
    caughtBy: ['packages/net/src/start-report.test.ts'],
    // Re-executed 2026-08-05: 7 failed. The signature is the load-bearing one — a family
    // the asking node has no expression to produce.
    signature: "expected [ 'chromium 141' ] to include 'firefox 130'",
    signatureSource: 'rendered-at-runtime',
  },
  {
    id: 'L4',
    why:
      'The magnitude bound the demo’s deferral was conditional on. `demo/index.html` deferred ' +
      'publishing per-peer start outcomes *"behind the magnitude bound and the label ' +
      'whitelist"*, because a per-peer count is the fingerprint `start-outcome.ts`’s disclosure ' +
      'promise exists to prevent. Both landed and the deferral was spent — so a **raise** of ' +
      'this constant re-opens the surface without deleting anything, and reads as a tuning ' +
      'decision. This is the entry the green recorded above was rewritten to make possible: the ' +
      'case that used to hold this bound probed at `MAX_REPORTED_COUNT + 1`, so raising the ' +
      'constant raised the probe and the case could not see it move.',
    file: 'packages/net/src/protocol.ts',
    find: 'export const MAX_REPORTED_COUNT = 65_536',
    replace: 'export const MAX_REPORTED_COUNT = 8_000_000_000',
    caughtBy: ['packages/net/src/start-report.test.ts'],
    // The right-hand side alone, on `E2`'s precedent: the observed line was
    // `expected [ 'safari 18', 'firefox 130', …(1) ] to not include 'safari 18'`, and the
    // left half is vitest's width-dependent truncation.
    signature: "to not include 'safari 18'",
    signatureSource: 'rendered-at-runtime',
  },
  {
    id: 'L5',
    why:
      'The other half of the same deferral — the label whitelist. `BROWSER_LABEL` is what keeps ' +
      'a reported label a coarse family and major version rather than a full user-agent string, ' +
      'and a full UA string published per peer across the fabric is precisely the fingerprint ' +
      'the disclosure promise forbids. Weakening the predicate to a bare `typeof value === ' +
      "'string'` is the shape a *“be liberal in what you accept”* edit leaves behind, and it is " +
      'invisible to any reading that only sends well-formed labels. Its own entry rather than ' +
      '`L4`’s, because the two bounds fail independently and a fix to one has never implied a ' +
      'fix to the other.',
    file: 'packages/core/src/start-outcome.ts',
    find: "  return typeof value === 'string' && BROWSER_LABEL.test(value)",
    replace: "  return typeof value === 'string'",
    caughtBy: ['packages/net/src/start-report.test.ts'],
    signature: "to not include 'Mozilla/5.0 (X11; Linux x86_64) Apple",
    signatureSource: 'rendered-at-runtime',
  },
  {
    id: 'R1',
    why:
      'MR-04/MR-07 — criterion 6’s entire mechanism, and it is one line that does nothing. ' +
      '`tree-reduce-agents.node.test.ts` recorded that *"`executeReduce` has no late-arrival ' +
      'channel"*, which is true of `executeReduce` and **false of the endpoint underneath it**: ' +
      'a reply whose pending entry the timeout already deleted is received, decoded, and dropped ' +
      'here. Phase 16 could not exercise it because it had no way to produce a genuine late ' +
      'arrival; 20-03 produced one by SIGSTOPping the process holding rank 0 of a combine’s ' +
      'ranking and resuming it after the requestor had walked on. Throwing instead of returning ' +
      'is the right plant because `#receive` is subscribed as `void this.#receive(...)`, so the ' +
      'throw has no caller left and becomes an unhandled rejection — **it therefore reddens only ' +
      'if the frame actually arrived**, which proves the channel and the discard in one reading. ' +
      'A plant that made the line drop the frame more loudly would have proved only the discard.',
    file: 'packages/net/src/rpc.ts',
    find: '      if (entry === undefined) return // late or duplicate reply',
    replace: "      if (entry === undefined) throw new Error('late reply')",
    caughtBy: ['packages/node/src/late-combine.node.test.ts'],
    signature: "expected [ 'Error: late reply' ] to deeply equal []",
    signatureSource: 'rendered-at-runtime',
  },
  {
    id: 'D1',
    why:
      'CHURN-02 — that duplication happens at all, which is the entry to check first if any of ' +
      'the two below are ever weakened, on `W1`’s logic: a duplicate that never starts satisfies ' +
      'every assertion about what a duplicate may do. Truncating the straggler set at the call ' +
      'site leaves `stragglers`, `speculativeCandidates`, the ledger and the whole watchdog in ' +
      'place and running. **The plant found a weak case before the recorded reading was taken.** ' +
      'On its first run *"takes the first answer, and it is the copy’s own bytes"* stayed GREEN, ' +
      'because with duplication suppressed the holder’s lease simply lapses and the generation ' +
      'loop re-dispatches onto the same node, which answers the same bytes — every assertion in ' +
      'that case was satisfied by the slower road. It now also asserts `speculated` and ' +
      '`generations`, which is what says a **race** decided it rather than a timeout.',
    file: 'packages/core/src/job/submit.ts',
    find: '          const slow = stragglers(',
    replace: '          const slow: never[] = []\n          void stragglers(',
    caughtBy: ['packages/core/src/job/submit.test.ts'],
    // Re-executed 2026-08-05: 8 failed, 89 passed. Rendered on that run:
    // `expected [ 'n00#0', 'n01#1', 'n02#2', …(7) ] to have a length of 11 but got 10`.
    signature:
      'duplicates a shard that has fallen behind its peers, onto a node the placement did not choose',
    signatureSource: 'test-title',
  },
  {
    id: 'D2',
    why:
      'CHURN-01/CHURN-02 — **the load-bearing plant of the whole speculation build**, and it is ' +
      'the defect the deleted `coordinator.ts` actually shipped: break out of the race on first ' +
      'arrival and drop the copies still in flight. A job that does that is not wrong about its ' +
      'answer and is wrong about everything else. A losing copy that agrees is never recorded as ' +
      'having agreed; a losing copy that **disagrees** vanishes, so redundant execution silently ' +
      'becomes majority-vote-by-race with a sample of one; and a copy that answers with a ' +
      'failure accrues no failure anywhere, so a peer that reliably fails just after losing a ' +
      'race is never accounted for. Emptying `outstanding` is the smallest expression of it and ' +
      'leaves every field, every type and every timer intact.',
    file: 'packages/core/src/job/submit.ts',
    find:
      '          outstanding: [...copies.values()].map((copy) => ({\n' +
      '            nodeIds: copy.nodeIds,\n' +
      '            pending: copy.pending,\n' +
      '          })),',
    replace: '          outstanding: [],',
    caughtBy: ['packages/core/src/job/submit.test.ts'],
    // Re-executed 2026-08-05: 5 failed, 92 passed. Rendered on the signature case:
    // `expected [] to strictly equal [ { nodeIds: [ 'n01' ], …(1) } ]` — the same text
    // 20-07 observed. The disagreement case reddens beside it, which is what says
    // `disagreed` is reachable through a lost copy at all.
    signature: 'reads a losing copy that agrees, and records it as compared rather than as absent',
    signatureSource: 'test-title',
  },
  {
    id: 'D3',
    why:
      'CHURN-06 — a sovereign shard’s duplicate may only land on its owner’s own nodes, planted ' +
      'at the level where it can actually fail. Handing `speculativeCandidates` a **wider pool** ' +
      'cannot fail, for the reason `W3` records: it calls `eligibleNodes` on whatever it is ' +
      'given, so widening a gate’s *input* cannot widen its output. Bypassing the call ' +
      'altogether is a different mutation and it is the one a re-dispatch written for liveness ' +
      'alone would naturally contain — take any untried node in the pool. Carol’s shard, whose ' +
      'owner has one node and no spare, then acquires a duplicate on a foreign owner’s node. The ' +
      'breach is named by the field rather than inferred from a reason string, which is what ' +
      'makes it a reading.',
    file: 'packages/core/src/job/submit.ts',
    find:
      '        const candidates = speculativeCandidates(\n' +
      '          speculation.request,\n' +
      '          speculation.pool,\n' +
      '          speculation.attempted,\n' +
      '        )',
    replace:
      '        const candidates = speculation.pool.filter(\n' +
      '          (node) => !speculation.attempted.includes(node.nodeId),\n' +
      '        )',
    caughtBy: ['packages/core/src/job/submit.test.ts'],
    // Re-executed 2026-08-05: exactly 1 failed, 96 passed. Rendered:
    // `expected true to be false // Object.is equality` at `expect(carols.speculated)`.
    signature: 'scopes a sovereign duplicate to its owner, and starts none where the owner has no spare',
    signatureSource: 'test-title',
  },
  {
    id: 'X1',
    why:
      'CHURN-02’s cost accounting, at the place it is published. `Observation.speculationMultiplier` ' +
      'was the literal `1` at this site for two milestones, with a comment saying why, and ' +
      '`harness.ts` averaged that literal into a `spec. tax` column that `report.ts` printed on ' +
      'every rung of every published sweep. A constant printed as a measurement is worse than a ' +
      'missing column, and the reversion replaces one expression with a literal, leaving the ' +
      'column present and plausible. **Measured against the rest of the tree first**: with both reads reverted, ' +
      '`bench-reduce`, `bench-egress`, `harness.test.ts` and `serve-agent-hooks` ran 66 tests ' +
      'green — nothing anywhere noticed — which is why the guard this entry names had to be ' +
      'written before the reads could be trusted.',
    file: 'packages/node/src/bin/bench.ts',
    find: '      speculationMultiplier: result.ok ? result.job.speculationMultiplier : 0,',
    replace: '      speculationMultiplier: 1,',
    caughtBy: ['packages/node/src/speculation-agents.node.test.ts'],
    // Re-executed 2026-08-05 as a SINGLE-site plant: 1 failed, 5 passed,
    // `expected [ Array(1) ] to deeply equal []`. 20-09 reverted both reads at once and
    // observed both requirement sentences in one diff; the pair is `B1`/`B2`'s shape.
    signature: 'the speculation multiplier is read from the job',
    signatureSource: 'test-title',
  },
  {
    id: 'X2',
    why:
      'CHURN-01’s figure at the same site, and a separate entry for `B1`/`B2`’s reason: the ' +
      'guard that catches both reads a list of requirements over the whole file, so a single ' +
      'entry would be satisfied by an instrument that only ever sees one of the two. This pair ' +
      'proves it sees either. `redispatches` is the more dangerous of the two to leave written ' +
      'down, because `churn/task` is the column a reader consults to decide whether churn cost ' +
      'anything — a hardcoded `0` answers "no" for every fabric ever measured.',
    file: 'packages/node/src/bin/bench.ts',
    find: '      redispatches: result.ok ? result.job.redispatches : 0,',
    replace: '      redispatches: 0,',
    caughtBy: ['packages/node/src/speculation-agents.node.test.ts'],
    signature: 'the re-dispatch count is read from the job',
    signatureSource: 'test-title',
  },
  {
    id: 'O1',
    why:
      'CHURN-05 — **the per-owner gate**, and the argument for it is the deleted `coordinator.ts`’s ' +
      'own, reproduced at the site because this is now the clearest statement of the rule in the ' +
      'tree. An owner counts as covered when its shards *all* landed, never on its first. The ' +
      'one-shard rule is the obvious reading of "did this owner contribute", it is right whenever ' +
      'every owner owes one shard, and it is wrong exactly when coverage matters: an owner who ' +
      'delivered one of four reads as fully covered and a reader is told the aggregate rests on ' +
      'evidence it does not have. Two `caughtBy` files rather than one, because 20-08 planted it ' +
      'against the kernel and 20-10 planted the identical mutation across spawned `bin/agent.ts` ' +
      'processes — and there the **partial-owner arm alone** carries it: the 3/3 control and the ' +
      'stopped-owner arm both stay green, because a stopped owner delivers nothing and lands in ' +
      '`missing` under the shipped rule *and* under the wrong one.',
    file: 'packages/core/src/job/submit.ts',
    find: '            .filter(([owner, owed]) => (doneByOwner.get(owner) ?? 0) >= owed)',
    replace: '            .filter(([owner]) => (doneByOwner.get(owner) ?? 0) >= 1)',
    caughtBy: [
      'packages/core/src/job/submit.test.ts',
      'packages/node/src/coverage-agents.node.test.ts',
    ],
    // Re-executed 2026-08-05 against BOTH files in one run: 3 failed. Rendered —
    // `expected [] to strictly equal [ 'alice' ]` in the kernel, and `expected 2 to be 1`
    // across processes, at `expect(thin.covered).toBe(1)`.
    signature: 'refuses to count an owner who delivered one shard of four — the per-owner gate',
    signatureSource: 'test-title',
  },
  {
    id: 'O2',
    why:
      'CHURN-05, and the trap 20-CONTEXT.md predicted would be got wrong. `coverageOf`’s own ' +
      'comment says *"An empty job is not a complete one — 0 of 0 owners answers nothing"*, so a ' +
      'bare `CoverageReport` for a job with no owners has `complete: false` and ' +
      '`describeCoverage` renders `covered: 0/0 owners — PARTIAL (no owners were expected)`. ' +
      '**Every public job in this repository defines no owners**, so shipping the bare report ' +
      'would have printed that sentence on every rung of every benchmark sweep. The named union ' +
      'is what lets a public job say what it is instead of failing a test it was never entered ' +
      'for, and this plant is what keeps the union load-bearing rather than decorative. The ' +
      'rendering half was measured separately and is quoted at `O7`, because the run above ' +
      'short-circuits at the union assertion and never reaches it.',
    file: 'packages/core/src/job/submit.ts',
    find: "      ? 'defines-no-owners'",
    replace: '      ? coverageOf([], [])',
    caughtBy: ['packages/core/src/job/submit.test.ts'],
    // Re-executed 2026-08-05: 1 failed, 96 passed. Rendered: `expected { covered: +0,
    // total: +0, …(3) } to be 'defines-no-owners'`.
    signature:
      'says by name that a public job defines no owners, and never renders it as a partial anything',
    signatureSource: 'test-title',
  },
  {
    id: 'O3',
    why:
      'Coverage and completeness are different questions, and the collapse is a one-line ' +
      '"simplification" that reads as tidying. `complete` asks whether every shard reached ' +
      'agreement at its redundancy with no copy disagreeing; coverage asks how many owners ' +
      'contributed. Deriving one from the other makes a job with a disagreeing public shard ' +
      'report complete, and a degraded-but-agreed shard likewise, because neither moves an ' +
      'owner out of the covered set. **What this entry also records is that the plan predicted ' +
      'the wrong case.** 20-08 named the disagreeing-shard case (public, no owners) as the one ' +
      'that must redden; a public job takes the sentinel arm, so its `complete` is unchanged and ' +
      'it stays green. What reddens is the cases with owners **and** a non-coverage reason to be ' +
      'incomplete — including a pre-existing Phase 19 case, which means the tree already held an ' +
      'independent guard against this collapse.',
    file: 'packages/core/src/job/submit.ts',
    find:
      '      complete: shards.every(\n' +
      "        (s) => s.verification.status === 'agreed' && !s.degraded && !s.disagreed,\n" +
      '      ),',
    replace: "      complete: coverage === 'defines-no-owners' ? true : coverage.complete,",
    caughtBy: ['packages/core/src/job/submit.test.ts'],
    // Re-executed 2026-08-05: 8 failed, 89 passed — the three 20-08 recorded plus five
    // more that have accrued since. Rendered: `expected true to be false`.
    signature: 'counts an owner whose shard agreed at REDUCED redundancy — the degraded decision, stated',
    signatureSource: 'test-title',
  },
  {
    id: 'O4',
    why:
      'The owner set comes from the job’s own **shards**, never from the owners of its nodes — ' +
      'the decision that let this phase avoid adding a required `JobSpec` field, and therefore ' +
      'the decision most worth pinning. A shard is defined for an owner whether or not that ' +
      'owner has a node up, so an owner with an unplaceable shard is still *expected* and ' +
      'correctly lands in `missing`. Deriving the set from the candidate pool inverts that in ' +
      'both directions at once: an owner whose nodes are all offline drops out of the ' +
      'denominator, so the job reports full coverage of a set it quietly shrank, and an owner ' +
      'with a node but no shard is added to it, sending somebody to find a node that was there ' +
      'all along.',
    file: 'packages/core/src/job/submit.ts',
    find: '          [...owedByOwner.keys()],',
    replace: '          [...new Set(candidateNodes.map((node) => node.ownerId))],',
    caughtBy: ['packages/core/src/job/submit.test.ts'],
    // Re-executed 2026-08-05: 4 failed, 93 passed. Rendered on the anti-vacuity reading:
    // `expected 2 to be 1` — a node-derived set reports two owners where the job defines
    // one. `expected [] to strictly equal [ 'carol' ]` on the disappearing owner.
    signature: 'derives the owner set from the job’s own shards, never from the owners of its nodes',
    signatureSource: 'test-title',
  },
  {
    id: 'O5',
    why:
      'The clause that makes coverage read the *late* comparison rather than the dispatch. A ' +
      'shard whose winner agreed and whose losing copy then hashed differently has not landed ' +
      'for its owner — a disagreement is a failed run, not a run with a footnote — and dropping ' +
      'the clause counts it. It is worth its own entry because the clause has no other reader: ' +
      'it was added with speculation, and until the case named below existed **nothing in the ' +
      'tree held it at all**. Reaching a late disagreement takes the only shape that can produce ' +
      'one — ten sovereign shards, nine finishing at once so the median clears `MIN_SAMPLES`, ' +
      'and the tenth held until its duplicate, which lies, has been dispatched.',
    file: 'packages/core/src/job/submit.ts',
    find: "  return shard.verification.status === 'agreed' && !shard.disagreed",
    replace: "  return shard.verification.status === 'agreed'",
    caughtBy: ['packages/core/src/job/submit.test.ts'],
    // Re-executed 2026-08-05: exactly 1 failed, 96 passed.
    // Rendered: `expected 1 to be +0 // Object.is equality`.
    signature: 'does not count a shard whose losing copy answered DIFFERENTLY, however well it agreed',
    signatureSource: 'test-title',
  },
  {
    id: 'O6',
    why:
      'The named sentinel must not leak onto a job that **does** define owners, which is the ' +
      'inverse of `O2` and fails in the direction nobody watches. `O2` catches a public job ' +
      'rendered as a partial; this catches a four-shard, three-owner sovereign job answering ' +
      '"this job defines no owners" — a coverage report replaced by a confident denial that ' +
      'there was anything to cover. Widening the emptiness test by one character is the whole ' +
      'mutation. Caught across real spawned `bin/agent.ts` processes rather than in the kernel, ' +
      'because the reading that matters is the one an operator sees.',
    file: 'packages/core/src/job/submit.ts',
    find: '    owedByOwner.size === 0',
    replace: '    owedByOwner.size >= 0',
    caughtBy: ['packages/node/src/coverage-agents.node.test.ts'],
    // Re-executed 2026-08-05: 1 failed, 1 passed. The signature is the thrown Error's own
    // text, which is a string literal in the catching file, so this is the checkable arm.
    signature: 'this job reported the no-owners sentinel; it defines four sovereign shards across ',
    signatureSource: 'test-title',
  },
  {
    id: 'O7',
    why:
      'The display site, and the half of `O2` that a type cannot hold. The union forces every ' +
      'renderer to decide what a job with no owners says; **`npx tsc --noEmit` exits 0 with this ' +
      'plant applied**, because rendering a report the caller built by hand is perfectly ' +
      'well-typed. So the guarantee is behavioural, not structural, and this is the entry that ' +
      'makes it a reading. The line’s own comment says *"deleting this line does not fail to ' +
      'compile; it changes what five rungs print"*, and what it prints is quoted in the ' +
      'signature: the sentence every published benchmark sweep in this repository would have ' +
      'started carrying. That is an observation off the driver’s own stdout, not a prediction.',
    file: 'packages/node/src/bin/bench.ts',
    find: "  if (coverage === 'defines-no-owners') return null",
    replace:
      "  if (coverage === 'defines-no-owners')\n" +
      '    return describeCoverage({ covered: 0, total: 0, complete: false, missing: [], unexpected: [] })',
    caughtBy: ['packages/node/src/coverage-agents.node.test.ts'],
    // Re-executed 2026-08-05: 1 failed, 1 passed. Rendered:
    // `expected 'o2 benchmark — quick run, 6 iteration…' not to match
    // /covered: \d+\/\d+ owners/`, with the sentence below on every rung of the stdout.
    signature: 'covered: 0/0 owners — PARTIAL (no owners were expected)',
    signatureSource: 'test-title',
  },
  {
    id: 'K1',
    why:
      'CHURN-03 — the whole of what a resume is for. A second requestor handed nothing but a ' +
      'CID must dispatch **only** the shards the checkpoint does not name; ignoring what it ' +
      'carried leaves a resume that is correct in its answer, complete in its report, and pays ' +
      'for the entire job twice. That is the failure a caller cannot see from the outside, which ' +
      'is why the reading is a dispatch count and not a result comparison. Two `caughtBy` files ' +
      'because the same mutation was planted against the kernel and against three spawned ' +
      '`bin/agent.ts` processes: in the kernel eight dispatches arrive where four are owed, and ' +
      'across processes the per-partition totals for the carried shards go from 2 to 4.',
    file: 'packages/core/src/job/submit.ts',
    find: '  const carried = resumed.carried',
    replace: '  const carried = new Map<number, CarriedShard>()',
    caughtBy: [
      'packages/core/src/job/submit.test.ts',
      'packages/node/src/checkpoint-agents.node.test.ts',
    ],
    // Re-executed 2026-08-05 against both: 6 failed. Rendered in the kernel,
    // `expected [ +0, 1, 2, 3, 4, 5, 6, 7 ] to deeply equal [ 4, 5, 6, 7 ]`.
    signature: 'resumes from a CID and dispatches ONLY the shards the checkpoint does not name',
    signatureSource: 'test-title',
  },
  {
    id: 'K2',
    why:
      'Recovery is the point of the handle **list**, not a fallback on it. A requestor departs ' +
      'having published several handles and the newest block is the one most likely to be ' +
      'missing, because it is the one that had least time to propagate. Reading only the newest ' +
      'turns a job that could have resumed at some cost in re-run work into a job that refuses ' +
      'outright — correctness preserved, liveness thrown away, and the refusal is by name so it ' +
      'reads like a designed behaviour. `recoverCheckpoint` also reports **how many** it had to ' +
      'skip, which is the number that says what the recovery cost; a single read cannot report ' +
      'it at all.',
    file: 'packages/core/src/job/submit.ts',
    find: '  const recovered = await recoverCheckpoint(handles, blockstore)',
    replace:
      '  const newestOnly = await readCheckpoint(handles[0] as CID, blockstore)\n' +
      '  const recovered = newestOnly.ok\n' +
      '    ? { checkpoint: newestOnly.checkpoint, cid: handles[0] as CID, skipped: 0 }\n' +
      '    : null',
    caughtBy: ['packages/core/src/job/submit.test.ts'],
    // Re-executed 2026-08-05: exactly 1 failed, 96 passed. Rendered:
    // `expected false to be true` — `resumed.ok` is false, the resume refuses rather than
    // falling back, exactly as 20-11 predicted.
    signature:
      'recovers to an OLDER handle when the newest checkpoint block is lost, at the cost of work and not of correctness',
    signatureSource: 'test-title',
  },
  {
    id: 'K3',
    why:
      'A checkpoint **names** results and never carries them, which is what makes it a handle ' +
      'rather than a copy of the job. Appending the answer to the recorded CID is the shape a ' +
      '"save a round trip" optimisation takes, and it is invisible to every correctness ' +
      'assertion — the resume still works, the shards still match, and the only thing that moves ' +
      'is a block size. **Measured, and the numbers are what the property is worth**: 1 176 ' +
      'bytes becomes 65 120. The reading is comparative by construction — two jobs over the same ' +
      'inputs, hence the same derived job id, whose answers differ by an order of magnitude, ' +
      'with `at` frozen so the blocks are byte-comparable — so no absolute threshold encodes the ' +
      'host it was taken on.',
    file: 'packages/core/src/job/submit.ts',
    find: '          resultCid: settled.resultCid.toString(),',
    replace: '          resultCid: settled.resultCid.toString() + JSON.stringify(settled.output),',
    caughtBy: ['packages/core/src/job/submit.test.ts'],
    // Re-executed 2026-08-05: 6 failed, 91 passed. 20-11 recorded
    // `expected 65120 to be 1176` on the size-independence case.
    signature: 'names results rather than carrying them — the block is the same size whatever the answers weigh',
    signatureSource: 'test-title',
  },
  {
    id: 'K4',
    why:
      'The one check that makes a checkpoint a statement about **this** job. `jobIdOf` derives ' +
      'the id from the module and the input CIDs, so two jobs can differ while their checkpoints ' +
      'agree on partition count and shape — and a checkpoint from another job then reads as a ' +
      'set of partitions this job may skip. The result is a job that returns answers it never ' +
      'computed, from inputs it never saw, reporting `complete`. Disabling the comparison is a ' +
      'two-character edit and every other validation in `readCheckpoint` still runs, which is what ' +
      'makes it look safe.',
    file: 'packages/core/src/job/submit.ts',
    find: '  if (recovered.checkpoint.jobId !== jobId) {',
    replace: '  if (false as boolean) {',
    caughtBy: ['packages/core/src/job/submit.test.ts'],
    // Re-executed 2026-08-05: exactly 1 failed, 96 passed.
    // Rendered: `expected true to be false // Object.is equality`.
    signature: 'refuses a valid checkpoint that belongs to ANOTHER job',
    signatureSource: 'test-title',
  },
  {
    id: 'K5',
    why:
      'A checkpoint names a result **and the block has to still be there**. The two are ' +
      'different facts and this line is the whole of what keeps them together: a handle that ' +
      'survives while the block it names is evicted is the ordinary case, not the exotic one, ' +
      'because a browser tier evicts IndexedDB silently under storage pressure. Carrying the ' +
      'shard anyway hands the caller an answer nobody holds — a CID that resolves to nothing, ' +
      'reported as a completed partition. Re-running it is the only correct response and it is ' +
      'one `continue`.',
    file: 'packages/core/src/job/submit.ts',
    find: '    if (bytes === undefined) continue',
    replace:
      '    if (bytes === undefined) {\n' +
      '      carried.set(shard.partitionIndex, { resultCid, output: null })\n' +
      '      continue\n' +
      '    }',
    caughtBy: ['packages/core/src/job/submit.test.ts'],
    // Re-executed 2026-08-05: exactly 1 failed, 96 passed.
    // Rendered: `expected [] to deeply equal [ +0 ]` — the partition that should have run.
    signature: 're-runs a shard whose named result block is gone',
    signatureSource: 'test-title',
  },
  {
    id: 'K6',
    why:
      'The write chain, and why the checkpoints form a chain at all. Each record names its ' +
      'predecessor, so `checkpointChain` can walk a departed requestor’s history back through ' +
      'the hand-off. Run the bodies immediately instead of through the promise chain and the ' +
      'chain **forks**: every shard reads `previous` before any of them has written, so eight ' +
      'checkpoints all claim `previous: null` and the history becomes eight unrelated leaves. ' +
      'Nothing throws, every block is well formed, and the corruption is only visible to a ' +
      'reader that walks the links. It is also the edit a reviewer would call an obvious ' +
      'de-serialisation win, because the writes really are independent — of each other, and not ' +
      'of the variable they share.',
    file: 'packages/core/src/job/submit.ts',
    find: '      chain = chain.then(async (): Promise<void> => {',
    replace: '      chain = (async (): Promise<void> => {',
    caughtBy: ['packages/core/src/job/submit.test.ts'],
    // Re-executed 2026-08-05: 8 failed, 89 passed. 20-11 recorded
    // `expected null to be 'bafyreiccjatizolyxoysdzey3tsnhyd2yamb…'` on the link.
    signature:
      'writes one checkpoint per shard that answers, and none at all for a caller that named no sink',
    signatureSource: 'test-title',
  },
  {
    id: 'K7',
    why:
      'A refusal has to name **which** failure, and this is the branch that can tell them apart. ' +
      '`recoverCheckpoint` reports how many handles it skipped and not why each failed, so the ' +
      'newest is read once more purely to produce a nameable reason — one extra lookup on a path ' +
      'that is already returning an error. Collapsing it to a constant `block-missing` is the ' +
      'obvious removal of that "redundant" read, and it turns a malformed block, a block naming ' +
      'a partition outside the job, and a block that is genuinely absent into one answer. A ' +
      'caller that would retry on absence and give up on corruption can no longer tell which it ' +
      'has. Caught across real spawned processes, which is where a caller actually faces the ' +
      'distinction.',
    file: 'packages/core/src/job/submit.ts',
    find:
      '        failure: newest.ok\n' +
      "          ? { kind: 'block-missing', cid: (handles[0] as CID).toString() }\n" +
      '          : newest.failure,',
    replace: "        failure: { kind: 'block-missing', cid: (handles[0] as CID).toString() },",
    caughtBy: ['packages/node/src/checkpoint-agents.node.test.ts'],
    // Re-executed 2026-08-05: 1 failed (the file's one case). The rendered arm rather than
    // a title, on `M40`'s logic: this file's single `it` carries dozens of assertions
    // across three spawned agents, so a title-keyed signature would accept a red produced
    // by any of them, including one produced by load.
    signature: "expected 'block-missing' to be 'malformed'",
    signatureSource: 'rendered-at-runtime',
  },
  {
    id: 'J1',
    why:
      'CHURN-02’s floor, pinned through the **composition** rather than through the unit. ' +
      '`stragglers` compares against a median, so with too few completions there is nothing to ' +
      'compare against and a duplicate would be started on no evidence at all — which is a ' +
      'timeout wearing a race’s clothes, the same error `W5` guards one function over. The unit ' +
      'case in `speculation.test.ts` has held the floor since Phase 7; what this adds is that ' +
      '`submitJob` **feeds it a real `completed` list and omits `minSamples`**, so the default ' +
      'is the one in force on the production path. Both files redden under one plant and they ' +
      'are named together here so nobody reads the pair as two independent readings: they share ' +
      'a mechanism, and only the composition is new.',
    file: 'packages/core/src/speculation.ts',
    find: '  if (options.completed.length < minSamples) return []',
    replace: '  if (false && options.completed.length < minSamples) return []',
    caughtBy: ['packages/core/src/job/submit.test.ts', 'packages/core/src/speculation.test.ts'],
    // Re-executed 2026-08-05: 2 files failed, 1 case each.
    // Rendered on the composition case: `expected 1 to be +0 // Object.is equality`.
    signature:
      'duplicates nothing until MIN_SAMPLES shards have finished — one fixture, two arms differing only in how many did',
    signatureSource: 'test-title',
  },
  {
    id: 'J2',
    why:
      'WIRE-04 itself — *"the fabric has exactly one job entry point"* — planted at the barrel ' +
      'and not against a helper, because a guard proved only against its own helper proves a ' +
      'helper. **This is the requirement nothing held for thirteen phases**: a complete second ' +
      'job implementation, `runResilient`, sat exported beside `submitJob` with the whole suite ' +
      'green, and the requirement’s own wording — *"without the caller choosing between two ' +
      'functions"* — makes a barrel export that lets a caller bypass `submitJob` the failure ' +
      'mode rather than a side effect of it. Re-adding an alias is the cheapest possible ' +
      'regression and the likeliest: it is what a deprecation shim looks like.',
    file: 'packages/core/src/index.ts',
    find: "export { submitJob } from './job/submit.ts'",
    replace:
      "export { submitJob } from './job/submit.ts'\n" +
      "export { submitJob as runResilient } from './job/submit.ts'",
    caughtBy: ['packages/core/src/job/submit.test.ts'],
    // Re-executed 2026-08-05: exactly 1 failed, 96 passed. Rendered:
    // `expected [ 'executeReduce', …(5) ] to strictly equal [ 'executeReduce', …(4) ]`,
    // with `+ "runResilient"` in the printed diff.
    signature: 'exports submitJob and no second job runner beside it',
    signatureSource: 'test-title',
  },
  {
    id: 'M68',
    why:
      'AUTH-04 / criterion 3 — **the certificate-to-peer binding at the relay door, which was ' +
      'guarded by nothing at all until 2026-08-06.** `relayAdmissionGate` derives `expected` ' +
      'from the asking peer id and refuses a certificate naming a different key. That is not ' +
      'redundant with the signature check and the difference is the whole of what admission ' +
      'means: `verifyCertificate` is handed a certificate and an issuer set and **cannot know ' +
      'which peer is holding it**. This exact plant was measured against the tree before the ' +
      'case below existed and stayed **green across eight admission specs and five runs**, ' +
      'while a control plant on `enrollment.ts`’s aggregate budget reddened at exit 1 — so the ' +
      'silence was a fact about the corpus, not about the day. **The near-miss form is ' +
      'deliberate**: `&& expected === \'\'` leaves every type, symbol and refusal string ' +
      'byte-intact, so the gate is still installed, still consulted, still asks, still records ' +
      'a decision — and admits any peer that can replay somebody else’s certificate. Every ' +
      'structural guard survives it: `relay-admission.node.test.ts`’s census counts postures ' +
      'and call sites rather than verdicts, and the three live arms above vary ' +
      'enrolled-versus-unenrolled, never **borrowed**. **Why it matters beyond one line:** ' +
      'bounded issuance prices identity creation only while one certificate admits exactly one ' +
      'peer. Planted, one legitimately-issued certificate admits an unbounded number of peers ' +
      'through every closed door in this fabric, and the issuance budget prices nothing. ' +
      '**Independence measured in both directions, not assumed.** The identical edit in ' +
      '`peer-verifier.ts:527` — the SELECTION-side copy, guarded since 17-05 — leaves the case ' +
      'below green while reddening `peer-verifier.node.test.ts`’s borrowed-certificate row; ' +
      'this plant reddens the case below and not that one. Two copies of one comparison, two ' +
      'separate guards, neither standing in for the other.',
    file: 'packages/node/src/fabric-node.ts',
    find: '      if (certificate.nodeKey !== expected) {',
    replace: "      if (certificate.nodeKey !== expected && expected === '') {",
    caughtBy: ['packages/node/src/relay-admission.node.test.ts'],
    // Observed 2026-08-06, exit 1, `1 failed | 37 skipped`, 54 ms of test time on a host at
    // 1-minute load 13.46. Rendered: `AssertionError: expected false to be true` at
    // `relay-admission.node.test.ts:1391` — arm 1, the borrower, admitted by a door that had
    // stopped reading who was holding the certificate.
    signature: 'refuses a peer presenting a certificate issued to a different peer, and admits the peer that certificate names',
    signatureSource: 'test-title',
  },
  {
    id: 'M69',
    why:
      'WIRE-02 / Phase 22 — **the order of `classify`\'s two branches, which is load-bearing and ' +
      'does not look it.** `SymbolFlags.Type` is a COMPOSITE mask and it includes ' +
      '`SymbolFlags.Class`: `Type & Class === 32`, measured rather than assumed. So an exported ' +
      'class matches BOTH tests, and swapping them moves every exported class out of the guard\'s ' +
      'jurisdiction and into `type-only`. **Measured when planted: callable fell 217 -> 171** — 46 ' +
      'classes — while the TOTAL export count did not move at all, which is why no total-based ' +
      'floor could see it. The jurisdiction empties and the guard keeps reading clean.',
    file: 'packages/node/src/reachability.ts',
    find: '  if ((flags & (SymbolFlags.Function | SymbolFlags.Class | SymbolFlags.Method)) !== 0) {',
    replace: '  if ((flags & (SymbolFlags.Interface | SymbolFlags.TypeAlias)) !== 0) {',
    caughtBy: ['packages/node/src/reachability.node.test.ts'],
    // Observed 2026-08-08, not predicted: three cases failed, and this is the one that names
    // the mechanism rather than the count.
    signature: 'classifies a class as callable even though it also matches the type mask',
    signatureSource: 'test-title',
  },
  {
    id: 'M70',
    why:
      'WIRE-02 / Phase 22 — **alias resolution, without which the guard\'s jurisdiction is empty ' +
      'and its totals are right.** A barrel entry\'s own flags are `SymbolFlags.Alias`, which ' +
      'matches neither the callable mask nor the type mask, so every export classifies as ' +
      '`other-value`. **Measured when planted: callable 0, type-only 0, and the 604-export total ' +
      'STILL SATISFIED** — the exact silent failure `22-CONTEXT.md` names, where the instrument ' +
      'stops looking and the numbers still look like numbers.',
    file: 'packages/node/src/reachability.ts',
    find: '  const resolveAliases = options.resolveAliases ?? true',
    replace: '  const resolveAliases = false',
    caughtBy: ['packages/node/src/reachability.node.test.ts'],
    // Observed 2026-08-08: three cases failed, including the two per-package floors.
    signature: 'alias resolution changes the reading, and by how much',
    signatureSource: 'test-title',
  },
  {
    id: 'M71',
    why:
      'WIRE-02 / Phase 22 — **criterion 2\'s first half, at a real production call site.** ' +
      'Commenting out a wired call must turn the guard red naming the symbol AND the barrel it ' +
      'came from, so a reader is not left grepping a corpus of 604 exports across eight barrels. ' +
      '`tools/aot/lift.ts` is the site: it is single-line, and `tools/` is the least contended ' +
      'tree here. **Measured when planted: two cases failed and the finding count moved 58 -> 60**, ' +
      'so the guard saw the wiring regression rather than merely failing.',
    file: 'tools/aot/lift.ts',
    find: '    const named = await translationCid(translationKeyOf(lifted))',
    replace: '    const named = await PLANTED_translationCid(translationKeyOf(lifted))',
    caughtBy: ['packages/node/src/reachability-guard.node.test.ts'],
    // Observed 2026-08-08 verbatim: "aot/translationCid is wired and must not be reported
    // unreachable". The title below is the case that carried it.
    signature: 'does not report a wired capability unreachable',
    signatureSource: 'test-title',
  },
  {
    id: 'G1',
    why:
      '**The population a guard acts on must be the population that pays for it — the eighth ' +
      'instance of that shape in this repository** (priors: #38, #39, #66, `bench-reduce`, ' +
      'WIRE-04 / `@o2/net`, `orphan-leash`, the five `advertisedBy` sites). ' +
      '`closed-fabric-agents.node.test.ts` reads criterion 8 over *"a fabric whose every ' +
      'relay-capable peer was told to close"*, and until 2026-08-06 it read it over a ' +
      'hand-written literal of five participants sitting beside the spawns. ' +
      '`CLOSED_RELAY_CAPABLE`’s docblock claimed that a participant added to `standUp` without ' +
      'being added to that literal would redden. **Measured false**: a verifier added a ' +
      'seventh, open, relay-capable agent to the fixture, never added it to `closedSet`, and ' +
      '**both population assertions stayed green** — the guard caught only the opposite case, a ' +
      'set naming a peer that was not there. So the file described a redness it did not have, ' +
      'which is worse than a gap it reported: the next person to add a peer would believe a ' +
      'guard was watching them. The repair was not a better literal but the removal of the ' +
      'literal — the set is now derived from the processes that actually stood up, with `door` ' +
      'the default disposition, so an added participant is dialled, asked and counted whether ' +
      'or not anybody meant it to be. **This entry is that plant, kept**: it is the exact case ' +
      'the docblock describes, and a fixture whose claim is again untested would repeat the ' +
      'original defect rather than fix it.',
    file: 'packages/node/src/closed-fabric-agents.node.test.ts',
    find: "  const openControl = await spawnAgent('open-control', ['--port', '0'])\n",
    replace:
      "  const openControl = await spawnAgent('open-control', ['--port', '0'])\n" +
      "  await spawnAgent('PLANT-open-seventh', ['--port', '0'])\n",
    caughtBy: ['packages/node/src/closed-fabric-agents.node.test.ts'],
    // Observed 2026-08-06, exit 1, `1 failed | 1 passed (2)`, `real 13.87 user 9.44 sys 1.76`
    // on a host at 1-minute load 8.58. Rendered: the assertion names the intruder and its peer
    // id — `+ [ "PLANT-open-seventh (12D3KooWSEAkQEaniQ4FpryKqiPRLi2wHxdQBuVGtGojnUm5MyeP)" ]`.
    // The same plant made **closed** (`--admit-issuer issuer`) reddens the counted budget
    // instead — `expected [ 'provider', 'relay', …(4) ] to have a length of 5 but got 6` — so
    // both directions are covered and neither is the other's restatement.
    signature: 'a relay-capable peer is standing in this fabric with an OPEN posture and is not the control',
    signatureSource: 'test-title',
  },
  {
    id: 'G2',
    why:
      '**An instrument that reddens without saying which of two unrelated defects it found, ' +
      'priced at 111 executions.** Arm 3 of the live admission reading asserted the reservation ' +
      'store *before* the decision record, so its only failure text was *"a peer that should be ' +
      'out is in"* — which cannot distinguish **(a) the gate ANSWERED ADMIT**, a defect in ' +
      'admission and the event criterion 8 says cannot happen, from **(b) an entry appeared ' +
      'WITHOUT a grant**, a defect in `@libp2p/circuit-relay-v2` or in the fixture and no ' +
      'statement about the gate at all. On 2026-08-06 that ambiguity turned a concurrent ' +
      'agent’s live plant into a reported security defect escalated to the owner; refuting it ' +
      'cost 111 executions across loads 5.45–37.76, a patch to `node_modules` to read the ' +
      'gater’s return value directly, and a reading of the library’s call ordering to establish ' +
      'that branch (b) is unreachable by construction — the gater is awaited strictly before ' +
      '`reservationStore.reserve(…)`, and `reserve()` has one caller. The gate had carried the ' +
      'evidence the whole time: `decide(…)` produces `{admitted, reason}` through an ' +
      '`onDecision` callback the file already used. Reading the verdict first costs nothing and ' +
      'answers on the first red. **This plant is the proof that it does.** It admits `theirs` ' +
      'honestly — by pinning provider B’s issuer alongside provider A’s — so the relay really ' +
      'does grant a reservation to a peer the arm expects refused, which is byte-for-byte the ' +
      'state a fail-open gate would produce at the assertion site.',
    file: 'packages/node/src/relay-admission.node.test.ts',
    find: '        relayAdmission: new Set([pinned as string]),',
    replace: '        relayAdmission: new Set([pinned as string, providerB.issuerKey as string]),',
    caughtBy: ['packages/node/src/relay-admission.node.test.ts'],
    // Observed 2026-08-06, exit 1, `1 failed | 37 passed (38)` — the census rows are untouched,
    // because this file excludes itself from its own counting. The rendered message names the
    // branch and quotes the gate's own words back: `(a) THE GATE ANSWERED ADMIT for theirs —
    // relayAdmissionGate returned "allow" for a peer this relay pins against. … Reason the gate
    // gave: "12D3KooW… holds a certificate from a pinned issuer"`.
    // **The comparative half, same plant, same host, same session:** with the old store-first
    // order restored the identical run rendered `AssertionError: expected [ …(2) ] to not
    // include '12D3KooWKQKmVeG78VhHz5P9tJPTronZ1YwdM…'` — both arrays elided, the peer id
    // truncated, and no statement about the gate. That is the difference this entry protects.
    signature: '(a) THE GATE ANSWERED ADMIT for',
    signatureSource: 'test-title',
  },
  {
    id: 'M72',
    why:
      'AUTH-01/04 — **the audit finding G1: a stated deployment requirement with no mechanism.** ' +
      "`SeedServerOptions.relayAdmission` obliges a closed seed to *\"serve enrolment itself, or " +
      'name a provider a joining peer can reach without a reservation"*, and no field, flag or ' +
      '`BootstrapInfo` member existed with which to name one — a requirement that reads as ' +
      'though a mechanism exists is worse than an absent one. This plant stops the seed ' +
      'publishing the provider it was given. **It must redden the browser tier, not merely the ' +
      'unit**: the claim is that a *tab* learns the address from its own origin, and before ' +
      '2026-08-08 `gated-seed.e2e.test.ts` supplied that value from Node through `page.evaluate`, ' +
      'so the whole path was green with nothing publishing anything.',
    file: 'packages/node/src/seed-server.ts',
    find: '      : { enrollmentProvider: input.enrollmentProvider }),',
    replace: '      : {}),',
    caughtBy: [
      'packages/node/src/seed-enrollment-provider.node.test.ts',
      'packages/node/src/gated-seed.e2e.test.ts',
    ],
    // Observed 2026-08-08. Unit: exit 1, `2 failed | 2 passed (4)`. E2E: exit 1, **all three
    // engines**, `page.evaluate: Error: the origin published no enrollmentProvider, so this tab
    // cannot enrol` — chromium, firefox and webkit each. Restored by the surgical inverse and
    // `cmp` against the pre-plant snapshot returned 0, sha256 back to 2826344a.
    signature: 'the origin published no enrollmentProvider',
    signatureSource: 'test-title',
  },
  {
    id: 'M73',
    why:
      'AUTH-01/04 — **the operator half of the same finding, which no test reached.** The seed ' +
      'banner is the only surface telling an operator which of the two states their closed seed ' +
      'is in: a named provider, or the case `relayAdmission`’s docblock calls **operator ' +
      'error**. A line nothing reads is a line that rots, and this repository has shipped ' +
      'exactly that before. Disabling the branch must redden both banner cases while leaving ' +
      "the file's other 27 untouched — a plant that reddens everything proves only that the " +
      'file runs.',
    file: 'packages/node/src/bin/seed.ts',
    find: 'if (admitIssuers.length > 0 || enrollmentProvider !== undefined) {',
    replace: 'if (false && (admitIssuers.length > 0 || enrollmentProvider !== undefined)) {',
    caughtBy: ['packages/node/src/trust-anchors.node.test.ts'],
    // Observed 2026-08-08: exit 1, `2 failed | 27 passed (29)`, both failures reading
    // `expected '<no enrol line>' to contain 'NOBODY'` and `… to contain '/ip4/127.0.0.1/…'`.
    // The 27 that stayed green are the point: the plant hit its own two cases and nothing else.
    // Restored by the surgical inverse; `cmp` returned 0, sha256 back to 6b5e4619.
    signature: 'a closed seed naming no provider says so in the banner',
    signatureSource: 'test-title',
  },
  {
    id: 'M74',
    why:
      'DATA-05/DATA-06 — **the sovereignty claim\'s only operator-facing surface.** Every run of ' +
      'the demo produced an egress manifest and the page displayed none of it: `index.html` held ' +
      'zero occurrences of `egress`, `withheld` or `sovereign`, so the property this project ' +
      'puts first was the one thing a visitor could not see. Audit finding G13. The plant feeds ' +
      'the renderer `undefined` instead of the run\'s own manifest — the failure mode that ' +
      'matters, because a panel wired to nothing looks identical to a panel wired correctly on a ' +
      'run that happened to send no frames.',
    // **Moved by Plan 27-04, not weakened.** The line was `lines.push(...egressLines(best.egress))`
    // in `index.html`'s `#run` handler until the colouring surface got a formatter of its own;
    // the call it plants is the same call, one file over, and it still feeds the renderer
    // `undefined` instead of the run's own manifest. The one thing the move changes is reach:
    // the binding now feeds BOTH the text view and the C17 region, so the plant takes out the
    // rendered card as well as the block `attestation-ui.e2e.test.ts` reads.
    file: 'packages/browser/demo/surfaces/colouring.ts',
    find: '  const egress = egressLines(best.egress)',
    replace: '  const egress = egressLines(undefined)',
    caughtBy: ['packages/node/src/attestation-ui.e2e.test.ts'],
    // Observed 2026-08-08 at the old site: exit 1, `1 failed | 3 passed (4)`, reading `expected
    // '0 peer(s) · 8 cubes per rung\n\nn =  …' to contain 'What left this device:'`. The 3 that
    // stayed green were the point — the plant hit the egress panel and left every attestation
    // reading alone. Restored by surgical inverse; cmp exit 0, sha256 back to 8d369d3e.
    //
    // Re-observed 2026-08-10 at the NEW site, because an observation about a different file is
    // not an observation about this one: exit 1, `Tests 1 failed | 3 passed (4)`, reading
    // `AssertionError: expected '0 peer(s) · 8 cubes per rung\n\nn =  …' to contain 'What left
    // this device:'`. Identical to the 2026-08-08 reading in every respect including the split
    // — the plant still hits the egress panel alone. Restored by the surgical inverse of that
    // one line and verified with `cmp` against a snapshot taken immediately before planting;
    // `cmp` exit 0.
    signature: 'What left this device:',
    signatureSource: 'test-title',
  },
  {
    id: 'M75',
    why:
      'VER-02, and the exact defect that got the previous ceremony deleted. `855cdf5` removed a ' +
      'commit-reveal whose check compared a value with itself — the requestor minted the nonce, ' +
      'computed the digest, recomputed it from the same two values and compared — so both ' +
      'failure branches were unreachable, measured over 1171 tests with no reach. This line is ' +
      'the correction: the requestor hashes the **revealed output it was handed** and compares ' +
      'that against the digest the node published in round 1, which is a comparison it did not ' +
      'author either side of. Replacing it with the stored digest restores the tautology exactly, ' +
      'and the plant is therefore a direct re-run of the question that phase answered.',
    file: 'packages/core/src/job/commit-reveal.ts',
    find: '    const expected = await commitmentDigest(outcome.nonce, task, hashed.cid)',
    replace: '    const expected = entry.digest',
    caughtBy: ['packages/core/src/job/commit-reveal.test.ts'],
    // Observed 2026-08-11: exit 1, `Tests 3 failed | 17 passed (20)`, the three being the
    // plagiarist (`expected 2 to be 1`), the cross-shard replay (`expected 'disagreed' to be
    // 'agreed'`) and the all-plagiarist case (`expected 'agreed' to be 'insufficient'`). The
    // 17 that stayed green are the point: the plant hit the refusal and nothing else.
    // Restored by the surgical inverse and `cmp`'d byte-identical against a snapshot taken
    // immediately before planting; `cmp` exit 0.
    signature: 'refuses a replica that reveals a peer answer it did not commit to',
    signatureSource: 'test-title',
  },
  {
    id: 'M76',
    why:
      'VER-02\u2019s **hiding** half, which is the half the deleted ceremony failed silently. Its ' +
      'nonce was `nodeId:moduleCid:partitionIndex` \u2014 three public values \u2014 so anybody ' +
      'holding a commitment could recompute the digest for a guessed answer and check it, and ' +
      'a shard\u2019s output space is often a boolean or a small sum. Draw the nonce from anything ' +
      'predictable and the commitment binds without hiding, which looks identical in every ' +
      'happy-path assertion.',
    file: 'packages/core/src/job/commit-reveal.ts',
    find: '  nonce.set(randomBytes(CEREMONY_NONCE_BYTES))',
    replace: '',
    caughtBy: ['packages/core/src/job/commit-reveal.test.ts'],
    // Observed 2026-08-11: exit 1, `Tests 2 failed | 18 passed (20)`, on the two hiding cases
    // and on nothing else \u2014 every refusal case stayed green, which is exactly the point:
    // a commitment that binds but does not hide passes every test about binding. Restored by
    // the surgical inverse; `cmp` exit 0.
    signature: 'gives two different digests for one answer, because the nonce is secret and fresh',
    signatureSource: 'test-title',
  },
  {
    id: 'M77',
    why:
      'VER-02\u2019s barrier, and the one property in that module with no branch to plant \u2014 ' +
      'which is precisely why it needs an entry here. Round 2 begins only after every round-1 ' +
      'answer has settled; a single `await executor.reveal(\u2026)` inside round 1 is the ' +
      'interleaving somebody writes who does not know why the two passes are separate, and it ' +
      'discloses one node\u2019s answer while another\u2019s is still unfixed. Nothing about the ' +
      'happy path changes, and every digest still checks out.',
    file: 'packages/core/src/job/commit-reveal.ts',
    find: '      if (!outcome.ok) return { failed: outcome.reason }',
    replace:
      '      if (!outcome.ok) return { failed: outcome.reason }\n' +
      '      await executor.reveal(outcome.handle)',
    caughtBy: ['packages/core/src/job/commit-reveal.test.ts'],
    // Observed 2026-08-11: exit 1, `Tests 2 failed | 18 passed (20)`, the barrier case reading
    // `AssertionError: expected 3 to be greater than 4` \u2014 the first reveal entering the log
    // at index 3 while the last commit did not leave until index 4. Restored by deleting the one
    // inserted line; `cmp` exit 0.
    signature: 'enters no reveal until every commit has returned',
    signatureSource: 'test-title',
  },
  {
    id: 'M78',
    why:
      'VER-02\u2019s serving half. A commitment only means something if the node holding the ' +
      'unrevealed answer will not hand it to anybody else \u2014 a co-replica that could ask for a ' +
      'peer\u2019s pending result would have the answer **before** revealing its own, which is the ' +
      'plagiarism the ceremony exists to make detectable, arriving by a different door. This is ' +
      'the only line that says no, and without it every requestor-side assertion still passes.',
    file: 'packages/net/src/commit-store.ts',
    find: '    if (pending.committedBy !== by) {',
    replace: '    if (pending.committedBy !== by && false) {',
    caughtBy: ['packages/net/src/commit-reveal-wire.test.ts'],
    // Observed 2026-08-11: exit 1, `Tests 1 failed | 19 passed (20)`, reading `AssertionError:
    // expected true to be false` \u2014 the second peer\u2019s reveal succeeding. The 19 that stayed
    // green are the point: nothing else in the ceremony notices. Restored by the surgical
    // inverse; `cmp` exit 0.
    signature: 'commits to a real answer and reveals it only to the peer that asked',
    signatureSource: 'test-title',
  },
  {
    id: 'M79',
    why:
      'VER-02\u2019s **wiring**, which is the difference between a mechanism and a requirement. ' +
      '`submitJob` picks the ceremony for a public shard at two or more replicas whose executors ' +
      'speak both rounds, and falls through to the post-hoc comparison otherwise. Force the ' +
      'selection false and every unit test of the ceremony still passes while no job ever runs ' +
      'one \u2014 the *"built, not wired"* state this milestone exists to empty, reproduced in ' +
      'the act of closing it.',
    file: 'packages/core/src/job/submit.ts',
    find: '          chosen.every((e) => isCommitting(e))\n        ) {',
    replace: '          chosen.every((e) => isCommitting(e)) &&\n          false\n        ) {',
    caughtBy: ['packages/net/src/commit-reveal-wire.test.ts'],
    // Observed 2026-08-11: exit 1, `Tests 2 failed | 18 passed (20)`. The first reads `expected
    // [ 'execute' ] to deeply equal [ 'commit', 'reveal' ]`; the second is the one worth
    // recording \u2014 `expected 2 to be 1`, i.e. the same fixture reporting a forged answer as
    // verified agreement between two independent replicas, silently. Restored by the surgical
    // inverse; `cmp` exit 0.
    signature: 'asks a public redundancy-2 shard for two rounds and never for a one-call execute',
    signatureSource: 'test-title',
  },
  {
    id: 'M80',
    why:
      'VER-02 across shards. The commitment preimage carries the shard\u2019s own identity, so one ' +
      'digest cannot stand in for another shard of the same job. Without it a lazy executor ' +
      'commits once, hands the same digest back for every remaining shard, reveals the same ' +
      'nonce and output each time, and **every check passes** \u2014 a ceremony that is running ' +
      'and establishing nothing, which is the failure mode this whole requirement was reopened ' +
      'for.',
    file: 'packages/core/src/job/commit-reveal.ts',
    find: '  for (const part of [nonce, module, input, index, result]) {',
    replace: '  for (const part of [nonce, module, input, result]) {',
    caughtBy: ['packages/core/src/job/commit-reveal.test.ts'],
    // Observed 2026-08-11: exit 1, `Tests 2 failed | 18 passed (20)` \u2014 the shard-binding
    // case and the cross-shard replay, and nothing else. Restored by the surgical inverse;
    // `cmp` exit 0.
    signature: 'refuses a replica replaying one commitment across two shards',
    signatureSource: 'test-title',
  },
  // ── MR-02, the sovereign arm of the aggregation ─────────────────────────────────
  //
  // Fifteen entries for one function, which is the point rather than the cost. The
  // predecessor this arm is modelled against — `VER-02`'s first commit-reveal — was
  // DELETED rather than relabelled, because its check was unconditionally true and both
  // of its failure branches were unreachable. An admission gate is exactly that shape of
  // thing, so every refusal it can make is planted here and each one was watched red
  // against the case that names it.
  {
    id: 'SA1',
    why:
      "MR-02. The floor is what makes the word *verified* true of the aggregation rather than a preference: one executor performing a merge and signing it produces a statement that a merge happened and no comparison at all, so `executeReduce` has nothing to disagree about. Lowering the bound leaves the option readable and inert, and a caller asking for redundancy 1 gets a sovereign aggregate whose only verified half is not verified.",
    file: 'packages/net/src/reduce-sovereign.ts',
    find: "  if (wanted < MIN_SOVEREIGN_COMBINE_REPLICAS) {",
    replace: "  if (wanted < -1) {",
    caughtBy: ['packages/net/src/reduce-sovereign.test.ts'],
    // Observed 2026-08-11 in the plant sweep that added this file: exit 1, with the named
    // case red and the unvaried control still green. Restored by the surgical inverse;
    // `cmp` exit 0.
    signature: "redundancy below the minimum \u2014 the caller asked for an unverified aggregation",
    signatureSource: 'test-title',
  },
  {
    id: 'SA2',
    why:
      "MR-02. This is the exact reading the v1.1 audit says Phase 16 took: the aggregation run over public shards and reported as though it carried a sovereignty claim. With the guard inert the arm accepts an all-public job, derives a coverage report over zero owners and attaches an egress reading to a run that pinned nothing \u2014 a sovereignty sentence about a job that made none.",
    file: 'packages/net/src/reduce-sovereign.ts',
    find: "  if (pinned.size === 0) {",
    replace: "  if (pinned.size === -1) {",
    caughtBy: ['packages/net/src/reduce-sovereign.test.ts'],
    // Observed 2026-08-11 in the plant sweep that added this file: exit 1, with the named
    // case red and the unvaried control still green. Restored by the surgical inverse;
    // `cmp` exit 0.
    signature: "a job that pins no shard to an owner \u2014 Phase 16\u2019s reading, refused by name",
    signatureSource: 'test-title',
  },
  {
    id: 'SA3',
    why:
      "MR-02. `PROJECT.md` says the sovereignty claim is carried by the egress manifest and the coverage report rather than by a quorum. A sentinel that no longer matches lets a caller reach a sovereign aggregate having stated that nothing watched the owner-pinned rows, which is the claim made with its own evidence declared absent.",
    file: 'packages/net/src/reduce-sovereign.ts',
    find: "  if (options.egress === 'holds-no-egress-manifest') {",
    replace: "  if (options.egress === 'holds-no-egress-manifest-XX') {",
    caughtBy: ['packages/net/src/reduce-sovereign.test.ts'],
    // Observed 2026-08-11 in the plant sweep that added this file: exit 1, with the named
    // case red and the unvaried control still green. Restored by the surgical inverse;
    // `cmp` exit 0.
    signature: "the named absence of an egress manifest",
    signatureSource: 'test-title',
  },
  {
    id: 'SA4',
    why:
      "MR-02. An empty list satisfies the type and watches nothing, so it is the cheapest way to spell the sentinel without writing it. Inert, the arm reduces `registeredSovereign` over no manifests to POSITIVE_INFINITY and every shortfall check below passes vacuously.",
    file: 'packages/net/src/reduce-sovereign.ts',
    find: "  if (manifests.length === 0) {",
    replace: "  if (manifests.length === -1) {",
    caughtBy: ['packages/net/src/reduce-sovereign.test.ts'],
    // Observed 2026-08-11 in the plant sweep that added this file: exit 1, with the named
    // case red and the unvaried control still green. Restored by the surgical inverse;
    // `cmp` exit 0.
    signature: "an empty manifest list, which is not a manifest",
    signatureSource: 'test-title',
  },
  {
    id: 'SA5',
    why:
      "MR-02, DATA-05. A violation means a frame carrying a registered sovereign payload was offered to the exit and refused. The bytes stayed home, but a map that tried to move data is not a map this arm may aggregate over and then describe as sovereign. Inert, the aggregate is computed and the attempted leak is nowhere in what it reports.",
    file: 'packages/net/src/reduce-sovereign.ts',
    find: "    if (manifest.violations.length > 0) {",
    replace: "    if (manifest.violations.length > 99) {",
    caughtBy: ['packages/net/src/reduce-sovereign.test.ts'],
    // Observed 2026-08-11 in the plant sweep that added this file: exit 1, with the named
    // case red and the unvaried control still green. Restored by the surgical inverse;
    // `cmp` exit 0.
    signature: "a manifest that recorded a refused frame carrying a registered row",
    signatureSource: 'test-title',
  },
  {
    id: 'SA6',
    why:
      "EGR-01's whole subject, one requirement over. `violations: []` answers two different questions with one sentence \u2014 *this run registered no sovereign data* and *this run registered sovereign data and none of it left* \u2014 and only the second is a statement about sovereignty. Inert, a guard that was handed nothing reports a clean manifest and the arm reads it as evidence.",
    file: 'packages/net/src/reduce-sovereign.ts',
    find: "  if (registeredSovereign < pinned.size) {",
    replace: "  if (registeredSovereign < -1) {",
    caughtBy: ['packages/net/src/reduce-sovereign.test.ts'],
    // Observed 2026-08-11 in the plant sweep that added this file: exit 1, with the named
    // case red and the unvaried control still green. Restored by the surgical inverse;
    // `cmp` exit 0.
    signature: "a guard that watched fewer rows than the job pinned",
    signatureSource: 'test-title',
  },
  {
    id: 'SA7',
    why:
      "MR-02. A public shard inside a job this arm aggregates would contribute a partial to the number while contributing nothing to the coverage report, so the aggregate and its denominator would describe different sets \u2014 the exact failure `coverage.ts` exists to prevent, arriving through the composition. Inert, the shard is skipped silently and the number is quietly over a different population than the one printed beside it.",
    file: 'packages/net/src/reduce-sovereign.ts',
    find: "    if (owner === undefined) {",
    replace: "    if (owner === undefined && false) {",
    caughtBy: ['packages/net/src/reduce-sovereign.test.ts'],
    // Observed 2026-08-11 in the plant sweep that added this file: exit 1, with the named
    // case red and the unvaried control still green. Restored by the surgical inverse;
    // `cmp` exit 0.
    signature: "a public shard smuggled into a job this arm was asked to aggregate",
    signatureSource: 'test-title',
  },
  {
    id: 'SA8',
    why:
      "MR-02. *Map is owner-attested* is one of the two halves of `PROJECT.md`'s split, and the named absence is `submitJob`'s way of saying this requestor cannot say who ran the shard. Inert, the arm reads `userKeys` off the absence \u2014 `undefined` \u2014 and admits a partial nobody attested as though the owner had produced it.",
    file: 'packages/net/src/reduce-sovereign.ts',
    find: "  if ('kind' in receipt) {",
    replace: "  if ('kind' in receipt && false) {",
    caughtBy: ['packages/net/src/reduce-sovereign.test.ts'],
    // Observed 2026-08-11 in the plant sweep that added this file: exit 1, with the named
    // case red and the unvaried control still green. Restored by the surgical inverse;
    // `cmp` exit 0.
    signature: "an agreed sovereign shard whose map nobody attested",
    signatureSource: 'test-title',
  },
  {
    id: 'SA9',
    why:
      "MR-02. This is the comparison between two independently derived facts \u2014 the owner the requestor pinned the shard to, and the certified user key of the node that actually ran it. It is the one check a requestor cannot satisfy by writing its own descriptors, because it cannot forge a certificate. Inert, a partial produced under a stranger's key is aggregated as the owner's own.",
    file: 'packages/net/src/reduce-sovereign.ts',
    find: "  if (!keys.includes(pinnedTo)) {",
    replace: "  if (!keys.includes(pinnedTo) && false) {",
    caughtBy: ['packages/net/src/reduce-sovereign.test.ts'],
    // Observed 2026-08-11 in the plant sweep that added this file: exit 1, with the named
    // case red and the unvaried control still green. Restored by the surgical inverse;
    // `cmp` exit 0.
    signature: "a partial attested under a user key that is not the owner it was pinned to",
    signatureSource: 'test-title',
  },
  {
    id: 'SA10',
    why:
      "MR-02. The owner-attested half means the owner produced the partial, not that the owner was among those who did. A receipt naming the owner *and* a second user key describes a shard that ran outside the owner's trust domain, which is the placement leak `sovereignty.ts` is structurally built to prevent, arriving after the fact. Inert, such a shard is admitted.",
    file: 'packages/net/src/reduce-sovereign.ts',
    find: "  if (keys.length > 1) {",
    replace: "  if (keys.length > 99) {",
    caughtBy: ['packages/net/src/reduce-sovereign.test.ts'],
    // Observed 2026-08-11 in the plant sweep that added this file: exit 1, with the named
    // case red and the unvaried control still green. Restored by the surgical inverse;
    // `cmp` exit 0.
    signature: "a partial attested by the owner AND by somebody else",
    signatureSource: 'test-title',
  },
  {
    id: 'SA11',
    why:
      "MR-02. A job whose every owner failed has no contribution to aggregate, and `deriveReduceTree` throws a `RangeError` on an empty set \u2014 this module reports failures as values, so an escaping exception is a different contract. Inert, the arm reaches `reduceJob` with nothing and the caller gets whichever refusal falls out rather than the one that names the cause.",
    file: 'packages/net/src/reduce-sovereign.ts',
    find: "  if (contributions.length === 0) {",
    replace: "  if (contributions.length === -1) {",
    caughtBy: ['packages/net/src/reduce-sovereign.test.ts'],
    // Observed 2026-08-11 in the plant sweep that added this file: exit 1, with the named
    // case red and the unvaried control still green. Restored by the surgical inverse;
    // `cmp` exit 0.
    signature: "no owner-pinned shard agreed",
    signatureSource: 'test-title',
  },
  {
    id: 'SA12',
    why:
      "MR-02. `deriveReduceTree` keys a leaf on `(contributor, cid)`, so one owner contributing two identical partials collapses to a single leaf and the aggregate counts that owner's data once instead of twice. That is a silent undercount \u2014 the number is well-formed and simply wrong \u2014 and it is the mirror of the defect `ReduceContribution` was introduced to close.",
    file: 'packages/net/src/reduce-sovereign.ts',
    find: "    if (seen.has(key)) {",
    replace: "    if (seen.has(key) && false) {",
    caughtBy: ['packages/net/src/reduce-sovereign.test.ts'],
    // Observed 2026-08-11 in the plant sweep that added this file: exit 1, with the named
    // case red and the unvaried control still green. Restored by the surgical inverse;
    // `cmp` exit 0.
    signature: "one owner\u2019s two partials that address alike, which would merge into one leaf",
    signatureSource: 'test-title',
  },
  {
    id: 'SA13',
    why:
      "MR-02. A lone contribution is *promoted* rather than combined, so no node performed an aggregation at all. Inert, the arm returns an aggregate whose verification claim is about a step that never ran \u2014 the conflation the aggregate receipt's own named absence exists to prevent one layer up.",
    file: 'packages/net/src/reduce-sovereign.ts',
    find: "  if (reduced.tree.nodes.length === 0) {",
    replace: "  if (reduced.tree.nodes.length === -1) {",
    caughtBy: ['packages/net/src/reduce-sovereign.test.ts'],
    // Observed 2026-08-11 in the plant sweep that added this file: exit 1, with the named
    // case red and the unvaried control still green. Restored by the surgical inverse;
    // `cmp` exit 0.
    signature: "a single contribution, which is promoted rather than combined",
    signatureSource: 'test-title',
  },
  {
    id: 'SA14',
    why:
      "MR-02. The floor above is what the caller ASKED for; this is what the fabric ACHIEVED, and the two differ whenever the executor set is too small to satisfy the request. A tree is no better verified than its weakest step, so a run whose weakest combine found one executor is an unverified aggregation reported at the redundancy that was requested.",
    file: 'packages/net/src/reduce-sovereign.ts',
    find: "  if (reduced.outcome.minReplicas < MIN_SOVEREIGN_COMBINE_REPLICAS) {",
    replace: "  if (reduced.outcome.minReplicas < -1) {",
    caughtBy: ['packages/net/src/reduce-sovereign.test.ts'],
    // Observed 2026-08-11 in the plant sweep that added this file: exit 1, with the named
    // case red and the unvaried control still green. Restored by the surgical inverse;
    // `cmp` exit 0.
    signature: "a tree whose weakest combine found only one executor",
    signatureSource: 'test-title',
  },
  {
    id: 'SA15',
    why:
      "MR-02. `reduceJob`'s own named refusals \u2014 no executor, a projection that threw, a partial over the size budget \u2014 reach the caller through this line. Replacing the carried reason with a constant keeps every refusal a refusal and deletes the diagnosis, which is the shape this repository names *silent filtering*: a requestor left unable to tell a dead network from a broken projection.",
    file: 'packages/net/src/reduce-sovereign.ts',
    find: "  if (!reduced.ok) return refuse(reduced.reason)",
    replace: "  if (!reduced.ok) return refuse('a reduce could not be attempted')",
    caughtBy: ['packages/net/src/reduce-sovereign.test.ts'],
    // Observed 2026-08-11 in the plant sweep that added this file: exit 1, with the named
    // case red and the unvaried control still green. Restored by the surgical inverse;
    // `cmp` exit 0.
    signature: "no executor at all \u2014 reduceJob\u2019s own refusal, carried through rather than reworded",
    signatureSource: 'test-title',
  },
  // ── MR-02 across real processes ─────────────────────────────────────────────────
  //
  // Four production lines, planted against the two-owner process fixture rather than
  // against a literal. SB2 is the one worth reading before the others: it is the entry
  // that records a plant whose OUTCOME-shaped readings stayed green, and what had to be
  // asserted instead.
  {
    id: 'SB1',
    why:
      "MR-02, DATA-10, EGR-01. This loop is the only expression in the system that knows a job's sovereign shard set, and it does two things at once: it registers each owner-pinned row on every supplied guard for the job's duration, and it counts what it registered. Inert, the submitter holds both owners' rows unguarded and every manifest reports zero \u2014 and the sovereign aggregation refuses, naming the shortfall, because a guard that was never given the rows cannot report that none of them left.",
    file: 'packages/net/src/submit-with-egress.ts',
    find: "    if (shard.label !== 'sovereign') continue",
    replace: "    if (shard.label !== 'sovereign' || true) continue",
    caughtBy: ['packages/node/src/sovereign-aggregation.node.test.ts'],
    // Observed 2026-08-11 across three spawned `bin/agent.ts` processes: exit 1, one case
    // red. Restored by the surgical inverse; `cmp` exit 0.
    signature: "aggregates two owners\u2019 locally-computed partials into the sum of their row sizes",
    signatureSource: 'test-title',
  },
  {
    id: 'SB2',
    why:
      "SCHED-05, DATA-03. The sovereign narrowing, made inert. **What this entry costs to state honestly is the reason it is here**: the outcome-shaped readings in the catching file \u2014 the set that ANSWERED, and `job.complete` \u2014 both stay GREEN under this plant, because the foreign node refuses a task it should never have been offered and the generation loop re-dispatches onto the owner's own node. Defence in depth, and a repair that hides the defect from any assertion about outcomes. What sees it is `ShardResult.attempted` and `generations`: the set ASKED names the foreign process whatever the outcome was repaired to.",
    file: 'packages/core/src/sovereignty.ts',
    find: "  if (request.label === 'public') return nodes",
    replace: "  if (request.label === 'public' || true) return nodes",
    caughtBy: ['packages/node/src/sovereign-aggregation.node.test.ts'],
    // Observed 2026-08-11 across three spawned `bin/agent.ts` processes: exit 1, one case
    // red. Restored by the surgical inverse; `cmp` exit 0.
    signature: "aggregates two owners\u2019 locally-computed partials into the sum of their row sizes",
    signatureSource: 'test-title',
  },
  {
    id: 'SB3',
    why:
      "MR-02's attribution half. The arm would go on reporting owners in its own return value while keying every leaf on the partition index, so the aggregation itself would carry no owner at all \u2014 an aggregate whose coverage report describes owners and whose tree describes shards. Caught by reading the leaf ids off the DERIVED TREE rather than off the contribution list, which is the only place the attribution reaches the reduce.",
    file: 'packages/net/src/reduce-sovereign.ts',
    find: "    contributors: attribution,",
    replace: "    contributors: 'attributes-each-shard-to-its-own-partition-index',",
    caughtBy: ['packages/node/src/sovereign-aggregation.node.test.ts'],
    // Observed 2026-08-11 across three spawned `bin/agent.ts` processes: exit 1, one case
    // red. Restored by the surgical inverse; `cmp` exit 0.
    signature: "aggregates two owners\u2019 locally-computed partials into the sum of their row sizes",
    signatureSource: 'test-title',
  },
  {
    id: 'SB4',
    why:
      "MR-02's map-side half, as arithmetic. `MODULE_COUNTS_INPUT_BYTES` reverted to emitting the PARTITION INDEX \u2014 the number every other fixture emits, and the number the host supplied. The job still completes, still places on the owners' own nodes and still aggregates; the aggregate simply stops depending on anyone's data. That is the defect this fixture exists to make impossible, and it is invisible to every assertion about placement or coverage.",
    file: 'packages/core/src/executor/fixtures.ts',
    find: "  ...i32(4),\n  0x10, 0x00,\n  0x36, 0x00, 0x00, // i32.store align=0 offset=0\n  ...WRITE(0, 8),",
    replace: "  ...i32(4),\n  0x10, 0x03,\n  ...i32(16), SHR_U,\n  0x36, 0x00, 0x00, // i32.store align=0 offset=0\n  ...WRITE(0, 8),",
    caughtBy: ['packages/node/src/sovereign-aggregation.node.test.ts'],
    // Observed 2026-08-11 across three spawned `bin/agent.ts` processes: exit 1, one case
    // red. Restored by the surgical inverse; `cmp` exit 0.
    signature: "aggregates two owners\u2019 locally-computed partials into the sum of their row sizes",
    signatureSource: 'test-title',
  },
  {
    id: 'XW1',
    why:
      "X509-01\u202607's wiring, and the only entry here that reverts a whole family from delivered to " +
      'decorative in one line. With this branch inert, `verifyCertificate` still calls the profile and ' +
      'still gets its refusal \u2014 and then returns `ok: true` anyway. That is the fail-open the owner ' +
      'ruling of 2026-08-11 refused by name: a malformed certificate treated more leniently than an ' +
      'absent one. Nothing else in the function notices, because every fixture that reaches it was ' +
      'signed by a pinned provider, so the envelope signature below verifies perfectly.',
    file: 'packages/core/src/enrollment.ts',
    find: '  if (x509Failure) {',
    replace: '  if (false && x509Failure) {',
    caughtBy: [
      'packages/core/src/x509.test.ts',
      'packages/core/src/enrollment.test.ts',
      'packages/net/src/enrol-protocol.test.ts',
    ],
    // Observed 2026-08-11: EXIT=1, `Tests  17 failed | 101 passed (118)` \u2014 every one of the
    // seven obligations' trust-path cases, plus the graft and the wire case. Restored by the
    // surgical inverse; `cmp` exit 0.
    signature: 'refuses a second userKey extension rather than letting the last one win',
    signatureSource: 'test-title',
  },
  {
    id: 'XW2',
    why:
      'The whole-`TBSCertificate` comparison, which is what covers every field the gate does not name ' +
      'one by one \u2014 `version` and `serialNumber` above all. Without it a certificate whose X.509 form ' +
      'carries a serial the envelope would never have produced passes every named check, and the ' +
      'binding between the two envelopes is only as wide as the list somebody remembered to write.',
    file: 'packages/core/src/enrollment.ts',
    find: '  if (toHex(expected) !== toHex(decoded.tbsBytes)) {',
    replace: '  if (false && toHex(expected) !== toHex(decoded.tbsBytes)) {',
    caughtBy: ['packages/core/src/x509.test.ts'],
    // Observed 2026-08-11: EXIT=1, one case red, `expected 'x509-bad-signature' to be
    // 'x509-mismatch'`. Restored by the surgical inverse; `cmp` exit 0.
    signature: "expected 'x509-bad-signature' to be 'x509-mismatch'",
    signatureSource: 'rendered-at-runtime',
  },
  {
    id: 'XW3',
    why:
      "The X.509 form's own signature. With it inert the form becomes an unsigned assertion stapled to " +
      'a signed one \u2014 which reads as harmless only while the envelope is present, and is exactly ' +
      'wrong for the relying party X.509 was adopted for: a third party handed the DER alone has ' +
      'nothing but this signature and this profile.',
    file: 'packages/core/src/enrollment.ts',
    find: "  if (!valid) return { kind: 'x509-bad-signature', nodeKey: certificate.nodeKey }",
    replace: "  if (false && !valid) return { kind: 'x509-bad-signature', nodeKey: certificate.nodeKey }",
    caughtBy: ['packages/core/src/x509.test.ts'],
    // Observed 2026-08-11: EXIT=1, one case red. Restored by the surgical inverse; `cmp` exit 0.
    signature: 'refuses an X.509 form the issuer did not sign, even when every field agrees',
    signatureSource: 'test-title',
  },
  {
    id: 'XW4',
    why:
      'The wire carry. Dropping the field looks like losing an optional extra and is worse than that: ' +
      'the issuer signed a payload containing it, so a certificate this encoder strips no longer ' +
      'verifies at all, and the reader is told `bad-signature` about a frame the parser damaged rather ' +
      'than about anything the peer did.',
    file: 'packages/net/src/protocol.ts',
    find: '    ...(certificate.x509 === undefined ? {} : { x509: certificate.x509 }),',
    replace: '    ...(certificate.x509 === undefined || true ? {} : { x509: certificate.x509 }),',
    caughtBy: ['packages/net/src/enrol-protocol.test.ts'],
    // Observed 2026-08-11: EXIT=1, `Tests  2 failed | 23 passed (25)`. Restored by the
    // surgical inverse; `cmp` exit 0.
    signature: 'carries the form across the wire intact, so the certificate still verifies',
    signatureSource: 'test-title',
  },
  {
    id: 'CL1',
    why:
      "The owner non-decision about `cert-lifecycle.ts`'s facades, held by a check rather than by a " +
      'comment. A barrel export is a decision — it makes a surface part of the package — and this ' +
      'one was priced at +7 findings and has no consumer to pay for them. Until this entry existed, ' +
      'a single re-export line could have taken that decision silently, because the module reaches no ' +
      'barrel and every reachability case in the tree passed with it present or absent alike.',
    file: 'packages/core/src/index.ts',
    find: "export type { Ed25519AsyncVerifier, Ed25519Backend, Ed25519SyncVerifier } from './ed25519-backend.ts'",
    replace:
      "export type { Ed25519AsyncVerifier, Ed25519Backend, Ed25519SyncVerifier } from './ed25519-backend.ts'\n" +
      "export { Subject } from './cert-lifecycle.ts'",
    caughtBy: ['packages/node/src/reachability-guard.node.test.ts'],
    // Observed 2026-08-11: EXIT=1, `Tests  4 failed | 20 passed (24)`. Both new claims went red
    // together — the module stopped reading orphan (`expected [ …(26) ] to include
    // 'packages/core/src/cert-lifecycle.ts'`) and the facade appeared on the barrel
    // (`expected [ 'core/Subject' ] to deeply equal []`) — and both ceilings went with them,
    // 73 against 72 and 37 against 36, which is the reading that says they now bind with no slack.
    // Restored by the surgical inverse; `cmp` exit 0.
    signature: "expected [ 'core/Subject' ] to deeply equal []",
    signatureSource: 'rendered-at-runtime',
  },
]

/**
 * How many entries declare a signature the cheap layer can check — **derived, never
 * transcribed.**
 *
 * This constant exists because the sentence it replaces expired three times in one file.
 * The header above read *"26 of the 40"*, then *"48 of the 72"* — already stale by eight
 * when it was written — then *"60 of the 82"*, which was stale by three the day after. Each
 * time the paragraph warning that a transcribed count expires was itself the paragraph that
 * had expired. The file's own diagnosis was that *"the right fix is a derived count, not a
 * third transcription"*, and this is that fix: prose now names these symbols, and
 * `mutation-guard.node.test.ts` reads them instead of a number somebody typed.
 */
export const TITLE_SIGNATURE_COUNT: number = MUTATIONS.filter(
  (entry) => entry.signatureSource === 'test-title',
).length

/**
 * The complement of {@link TITLE_SIGNATURE_COUNT} — entries whose signature is produced
 * while the test runs, about which {@link problemsWith} checks nothing at all.
 */
export const RENDERED_SIGNATURE_COUNT: number = MUTATIONS.length - TITLE_SIGNATURE_COUNT

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
 * - **The whole `rendered-at-runtime` arm** — {@link RENDERED_SIGNATURE_COUNT} entries
 *   carrying assertion or runner output, which exists in no file. Nothing here reads them;
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
 * The first bullet is the one worth restating: this check is silent on
 * {@link RENDERED_SIGNATURE_COUNT} of {@link MUTATIONS}`.length` entries by construction —
 * the `rendered-at-runtime` half. (It read *"24 of the 72"*, then *"22 of the 82"*, each
 * wrong within a day of being written; see the header for why both numbers are now derived
 * rather than transcribed a fourth time.) A guard that appears to cover a population it
 * cannot is the defect this function exists to close, so its scope is written down rather
 * than left to be inferred from the fact that it passes.
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
