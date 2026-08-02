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
 * a large majority of these — 26 of the 40 — are the test's own title, which vitest
 * echoes verbatim, and a title **is** source text. That is the half the cheap layer
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
      'same file and watches a live tab catch it. What is missing for *this* entry is ' +
      'narrower and is the whole of it — nothing drives an over-committed refusal ' +
      'through a browser tab, so the admission bound has never been read there. The ' +
      '`browser` project genuinely cannot host such a test, because a Circuit Relay v2 ' +
      'server *"will not work in browsers"* in `@libp2p/circuit-relay-v2`’s own words; ' +
      'the `e2e` project can, and closing this is a matter of writing the case.',
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
      'CHURN-01. `failures`’ contract is that a shard’s history explains itself. A ' +
      'speculative copy that answered *with a failure* after the winner was taken fell ' +
      'between every bucket — not `uncompared`, because it did answer; not in ' +
      '`failures`, because those were sealed when the winner returned — while still ' +
      'appearing in `attempted`. `attempted` and `failures` are the raw material any ' +
      'later exclusion or scoring mechanism reads, so a peer that reliably fails just ' +
      'after losing a race accrued no recorded failure at all.',
    file: 'packages/core/src/coordinator.ts',
    find:
      "        record({\n          kind: 'failed',\n          nodeId: copy.nodeId,\n" +
      "          failureKind: failure?.kind ?? 'node',\n" +
      "          reason: failure?.reason ?? 'copy failed with no reason given',\n        })\n",
    replace: '',
    caughtBy: ['packages/core/src/coordinator.test.ts'],
    signature: 'records a copy that fails after the winner is picked as a failure of that shard',
    signatureSource: 'test-title',
  },
  {
    id: 'M19',
    why:
      'BROW-05. The demo panel may not present an aggregate that cannot exist. Restoring ' +
      'this line puts a peer count back beside a report whose every production call site ' +
      "opts out of the ledger that would fill it — the rendered panel read `no start " +
      "outcomes reported` on one line and `peers answering: 2 of 2 asked` on the next, " +
      'which is a tally of contributors that has none. It is a restoration rather than a ' +
      'deletion because the defect was text that was there, not text that was missing.',
    file: 'packages/browser/demo/index.html',
    find: '        showReportOnly(report.text)\n',
    replace:
      '        showReportOnly(\n' +
      '          `${report.text}\\n  peers answering: ${report.reached} of ${report.asked} asked`,\n' +
      '        )\n',
    caughtBy: ['packages/node/src/two-tabs.e2e.test.ts'],
    project: 'e2e',
    signature: 'renders no peer aggregate beside a report that can only hold this tab',
    signatureSource: 'test-title',
  },
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
      'green — a wiring proof made only of successes would not have moved at all.',
    file: 'packages/node/src/fabric-node.ts',
    find: 'provenance(compute)',
    replace: 'compute',
    caughtBy: ['packages/node/src/signed-artifact.node.test.ts'],
    signature: "expected 'agreed' to be 'insufficient'",
    signatureSource: 'rendered-at-runtime',
  },
  {
    id: 'M28',
    why:
      'DET-03/DATA-08, the browser tier, and the reason it needs its own entry: ' +
      '`trust-anchors.node.test.ts` stays green at 20/20 under this mutation, because ' +
      '`guardModuleProvenance(` is still textually present in the file and merely applied to ' +
      'nothing. A census that counts call sites cannot tell a composed guard from a decorative ' +
      'one; only a job dispatched through a real tab can. All nodes have equal functionality, ' +
      'so the browser tier needs the same proof as the Node tier rather than an argument by ' +
      'analogy from it.',
    file: 'packages/browser/src/browser-node.ts',
    find: 'provenance(worker)',
    replace: 'worker',
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
    find: "      return { kind: 'combine', resultCid: null, reason: admission.reason }\n",
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
 * - **The whole `rendered-at-runtime` arm.** Fourteen of these entries carry
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
 * The first bullet is the one worth restating: this check is silent on 14 of the 40
 * entries by construction. A guard that appears to cover a population it cannot is
 * the defect this function exists to close, so its scope is written down rather than
 * left to be inferred from the fact that it passes.
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
