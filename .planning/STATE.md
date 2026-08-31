---
gsd_state_version: 1.0
milestone: v2.0
milestone_name: Open the Doors
status: executing
stopped_at: >-
  WRITTEN BY HAND 2026-08-28, and by hand for a recorded reason. On 2026-08-25
  the tooling rewrote this frontmatter after the session's commits and wrote four
  false values — `status: completed` against 13 unstarted phases, a phase total
  reading 42 against a milestone of 13, an em-dash grown onto `milestone_name`,
  and a `stopped_at` the owner had already refuted. (That total is written in
  words here on purpose: the guard reads the FIRST `total_phases:` followed by
  digits anywhere in this frontmatter, so quoting the wrong value in prose feeds
  it the wrong value — measured 2026-08-28, when doing exactly that turned the
  case red at `expected 42 to be 13`.) THE GUARD DID NOT CATCH THE 2026-08-25 SET:
  `state-frontmatter.node.test.ts` checks that the eight keys are PRESENT, not
  that their values are true, and it passed 6/6 over the lot. Edit this block by
  hand or it will be wrong again.
  WHERE THE WORK STANDS. The hosted tier is DEPLOYED and live: four tagged
  releases 2026-08-27..28 (v2.0.0-rc.1..rc.4), the node answering at
  o2-bootstrap.af-4a0.workers.dev with a PeerId persisted in Durable Object
  storage, `GET /self` naming its own build, and both deployments — the node and
  the browser client — running from one script each on a `release: published`
  trigger, identically from a laptop and from CI. The browser client is published
  to GitHub Pages and, since rc.4, can actually join: it had fetched
  `bootstrap.json` from the domain apex on a subpath host since 2026-08-06 and
  had therefore never reached the fabric at all.
  PHASE 29 CLOSES UNCOUNTED, which is the phases 20/21/22 precedent. Criteria 3-7
  are met, three of them with plants watched red. Criterion 1 — the billing alert
  preceding the first Durable Object — is REFUTED and permanently unsatisfiable
  by owner decision taken with the consequence in front of him, and IT IS THE ONLY
  THING HOLDING THE PHASE'S CHECKBOX OFF. Criterion 2 is MET IN FULL as of
  2026-08-28: an outside peer dials, identify completes, and one PeerId spans BOTH
  construction boundaries — a redeploy, and an eviction observed after an ≈8 h 50 m
  idle interval with no deploy in it, the owner having confirmed no manual deploy
  ran in that window. The eviction was OBSERVED, NOT FORCED; the forcing lever is
  still unverified with its one candidate refuted, so nothing here makes that
  reading repeatable on demand. HOST-01 is `Done`, HOST-10 is the ledger's first
  `Refuted` row. STILL OPEN AND OWNER-OWNED: giving the tester cohort a
  READ `completed_phases: 0` WITH THIS, 2026-08-30. The zero is CORRECT and it is not a
  measure of progress: it counts ticked checkboxes, and phase 29's is deliberately
  untickable on a permanently-refuted criterion. What the zero does not say is that the
  hosted tier is LIVE — re-verified 2026-08-30, `GET /self` answering
  `12D3KooWKm587fnGat5xncq9kaWUk4bN5gUJQiF4q8EwJnrb7rsz` at version `2.0.0-rc.4`, THE SAME
  PeerId `29-EVIDENCE.md` recorded on 2026-08-28, so identity has now survived two further
  days of eviction rather than the single interval that was measured. The browser client
  answers 200 on GitHub Pages and its `bootstrap.json` hands out that same PeerId, so the
  two halves point at each other. PHASES 30-41 HAVE NO DIRECTORY AND NO PLAN — twelve of
  thirteen are unplanned rather than merely undone, and that is the real shape of this
  milestone. FOUR LEDGER ROWS FIXED 2026-08-30: HOST-05, HOST-08, HOST-11 and HOST-12 read
  `Not started` while being phase 29's criteria 3-6, three of the four carrying plants
  watched red. They now read `Done` with their evidence and a dated correction each, and
  their checkboxes were ticked to match, because the guard's rule is `[x]` iff the verdict
  begins `Done`. NET-03 KEPT ITS VERDICT and gained a dated amendment instead: it still
  does not close, and what aged out were two supporting sentences — *nothing is deployed*
  and *the INBOUND half is not built* — neither of which moved the verdict.
  PHASES 30 AND 31 ARE EXECUTED AND MERGED, 2026-08-30, and both closed a defect rather
  than only shipping a feature. Phase 30 found that `createHostedLibp2p` passed no
  `connectionManager` at all, so libp2p's default `inboundConnectionThreshold` of
  5/second/host stood as the whole fabric's admission rate: eight peers dialling together
  were admitted four and refused four, and the refusal names the wrong subsystem
  (`EncryptionFailedError`). Phase 31 found that BOTH plants criterion 1 names stay GREEN
  against a write-then-read through the object — `peerInfoMapper` because directly-connected
  peers consult no routing table, and `selectors` because `bestRecord` is called only from
  the QUERYING node's own `getValue` — and both criteria are amended against the
  measurement rather than descoped. NET-11, HOST-15, HOST-03, HOST-04, HOST-09 and HOST-14
  are `Done`; HOST-13 was `Partial` and in the re-read register, and is `Done` as of
  2026-08-31 on the deployed reading recorded further down. NEITHER PHASE'S CHECKBOX IS
  TICKED and the reason is one word in each: Phase 30 criterion 1 says the *deployed* node
  and Phase 31 criterion 2 says *observed on the deployed object*, while every reading in
  both was taken on a locally-run `workerd`.
  **SUPERSEDED 2026-08-31 — BOTH HALVES OF THAT SENTENCE ARE NOW FALSE, and the sentence is
  kept rather than rewritten because it is the reading of the day it was written.** Phase 30
  criterion 1 got its deployed reading the same morning — 24 peers dialling the deployed
  object together, 24 admitted in 987 ms, where libp2p's default of 5/second/host cannot
  produce that result. (The first attempt at it, 8 peers over 1705 ms, was DISCARDED as
  vacuous: the default would have passed 8 over that span.) Phase 31 criterion 2 got its
  deployed reading at `17:17:07Z` and is recorded further down with the control arm that made
  it a reading rather than a bare absence. **Phase 31 closes, and so does Phase 30** — the
  latter later the same day. Criterion 3's deployed half asked for an address the tier serves
  no route to answer, and the answer was that it did not need one: `identify` already puts
  `connection.remoteAddr` on the wire as `observedAddr`, so the node hands every peer the entry
  from its own connection list. The deployed node reported `/ip4/208.99.52.121/…`, matching a
  public address obtained independently from the same edge's `/cdn-cgi/trace`. The local case
  that stood for this could not fail — its justification named a 5/second limiter this tier
  sets to 256 — and the plant that had left it green now reddens it alone. That local runtime is itself the session's
  most reusable finding — `wrangler dev` runs real workerd with no account, which
  reclassified Phase 30 from an owner act to executable work and retired two docblocks
  claiming the platform half was untestable.
  PHASE 32 IS HALF-DONE ON PURPOSE, 2026-08-30. `NET-14` is `Done`: connection-seconds and
  bytes, peer-to-peer against relayed, fed from `trackMultiaddrConnection` and reported as a
  FIELD on `/self`, held by the Durable Object rather than by the lazily-built fabric so the
  split reads BEFORE the relay carries anything — which is criterion 3's ordering and not a
  dashboard. Measured on a real workerd: two zeroed columns before any peer dialled, a moved
  `direct` column with `relayed` still exactly zero after eight did. Criteria 1 and 2 —
  `HOST-02`, two browsers meeting through the DEPLOYED relay and the `addresses.announce`
  plant — were NOT attempted, and `HOST-02` stays `Not started` rather than being
  half-closed. ONE PLANT STAYED GREEN and is recorded: swapping the classifier's WebRTC-first
  order changed nothing, because `@multiformats/multiaddr-matcher@3.0.2` already answers
  `Circuit.matches` false for the browser WebRTC form; the property is re-pinned on the
  library's own answer instead.
  `v2.0.0-rc.5` IS DEPLOYED, 2026-08-31, through CI on the `release: published` trigger.
  `https://o2-bootstrap.af-4a0.workers.dev/self` answers `version: 2.0.0-rc.5` with the new
  `traffic` field reading two zeroed columns, on PeerId
  `12D3KooWKm587fnGat5xncq9kaWUk4bN5gUJQiF4q8EwJnrb7rsz` — the same identity since 2026-08-27,
  so the deploy is also a further crossing of a redeploy boundary for `HOST-01`. The Pages
  client's `bootstrap.json` hands out that same PeerId.
  AND THAT DEPLOY REFUTED A BASIS I HAD RECORDED HOURS EARLIER. Phase 32 criterion 3's
  ordering — counters reporting BEFORE the relay accepts its first browser reservation — was
  written as resting on *"nothing publishes the relay's address to any browser"*. False:
  `bootstrap.json` publishes `relayAddrs` naming this node, and `browser-node.ts:597` listens
  on `['/p2p-circuit', '/webrtc']`, which is a reservation request. The published client has
  been joinable since `v2.0.0-rc.4` on 2026-08-28, three days before the counters existed.
  Whether a browser reserved in that window is unreadable from here — the counters are
  per-instance and hold no history — so the ORDERING IS UNVERIFIED AND MAY BE PERMANENTLY
  FALSE, the same shape as `HOST-10`. The reporting itself stands; the ordering does not.
  AND THE NODE NOW WRITES LOGS, WHICH IS WHAT THE OWNER ASKED FOR AFTER READING THAT.
  *"Думаю, что надо писать логи, и верифицировать это в тестах."* `RelayServiceLog`
  (`packages/libp2p/src/relay-service-log.ts`) gives the previously-inert
  `trackProtocolStream` a body: it recognises the circuit hop and stop codecs and keeps four
  counters kept apart by `stream.direction`, because a relay someone used and a relay this
  node used are the same protocol string. `relay-service-journal.ts` banks the record into
  Durable Object storage — one key holding six numbers, not an append-only log — and refuses
  any write that would shorten it, so a fresh instance banking zeros is an error rather than
  a discipline. `/self` reports it as `relayService`, a THIRD reading beside the split's two
  columns and never folded into them.
  VERIFIED THE WAY THE FAILURE HAPPENED: `relay-service-journal.e2e.test.ts` reserves against
  a real workerd, KILLS AND RESTARTS wrangler, and reads the record back from a different
  process while `traffic` reads zero in the same answer. Seven plants; five red. The two that
  stayed green are recorded beside the cases that carry their claims — the journal's headline
  refusal case stayed green under a planted-away counter guard because the marker check
  refused first, and an isolating assertion is now beside it.
  THIS DOES NOT MOVE CRITERION 3. Nothing reconstructs history it did not observe, so the
  `rc.4`→`rc.5` window stays dark and the ordering stays unverified. What changed is that the
  NEXT such question has an answer. Limits 2 and 3 of `NET-14`'s stated granularity are
  retired with dated amendments in the ledger, the ROADMAP and `32-01-SUMMARY.md`; limit 1 is
  not.
  `v2.0.0-rc.6` IS DEPLOYED, 2026-08-31, through CI on the `release: published` trigger, run
  `33368032080`, success. `https://o2-bootstrap.af-4a0.workers.dev/self` answers
  `version: 2.0.0-rc.6` on PeerId `12D3KooWKm587fnGat5xncq9kaWUk4bN5gUJQiF4q8EwJnrb7rsz` —
  unchanged since 2026-08-27, a fifth crossing of a redeploy boundary for `HOST-01` — with
  `relayService` reporting four zeroed counters, zero bytes, and NO `firstInboundHopStreamAt`
  KEY AT ALL. That absence is the correct first reading and not a dud: `JSON.stringify` drops
  an `undefined` field, `rc.5` never wrote a journal, and a store that has never seen a hop
  stream has no beginning to name.
  AND THE FULL e2e LANE IS RED IN AN AREA THIS WORK DID NOT TOUCH — 2026-08-31, ATTRIBUTED BY
  MEASUREMENT AND NOT BY PLAUSIBILITY. The first full `e2e` lane run of this session reported
  24 failures across 12 files. One was mine and is fixed: `inbound-listener.e2e.test.ts` read
  `relay-service-journal.e2e.test.ts`'s history, because both spawn `wrangler dev` with
  `cwd: PACKAGE_DIR` and the default persist location is shared — `--persist-to` a mkdtemp
  directory fixed it, proven by running the journal file twice back to back and
  inbound-listener after it, 7/7. The other 22 were re-run on a QUIET host and 22 still
  failed, so they are not the load artefact the banner warns about. They were then run at
  `6cb5767`, the `develop` head BEFORE any of this work, and produced an IDENTICAL failure
  set — same five case names on `seed-discovery` and `peer-ledger`. So they are PRE-EXISTING
  and were present when `rc.5` was cut and deployed, unnoticed because only a subset of the
  lane was run then. The dominant symptom is one string —
  *"no relay available: this page was not served by a seed node, and no `?relay=` was given"*
  — plus its inverse in `built-bundle.e2e.test.ts`, which expected `'none'` and read
  `'origin'`. Ten files: `attestation-ui`, `built-bundle`, `cold-start-seed-race`,
  `gated-admission`, `gated-seed`, `owner-domain-tabs`, `peer-ledger`, `seed-binary-join`,
  `seed-discovery`, `static-rendezvous`, `visitor-enrolment`. NOT DIAGNOSED, NOT SCOPED, AND
  OWED TO THE OWNER AS A DECISION rather than absorbed quietly into the next phase.
  DIAGNOSED AND FIXED, 2026-08-31, ON THE OWNER'S INSTRUCTION. TWO defects, both in
  `cb09195` (2026-08-28, the commit that published the browser client), and the lane went
  **43 files / 250 tests, 0 failures** on a quiet host — from 24 failures.
  DEFECT 1 — THE BOOTSTRAP DOCUMENT HAS TWO MOUNT POINTS AND THE PAGE ASKED ONE. `cb09195`
  changed `demo/main.ts`'s two fetches from root-absolute to document-relative, which fixed
  the published client — it had never been able to join, because Pages serves this site at
  the subpath `/o2.services/` and a leading slash reaches the domain apex. The same change
  broke every LAN seed, because `SeedServer` mounts the document at the ORIGIN ROOT
  (`seed-server.ts:499`) while serving the page from `/packages/browser/demo/index.html`.
  Measured against a live seed rather than reasoned about: `/bootstrap.json` → **200** with
  the seed's own relay address, `/packages/browser/demo/bootstrap.json` → **404**.
  `discoverRelays` then answered `source: 'none'`, which `tab-api.ts` documents as the
  NORMAL state of a static host — so a LAN join that could no longer work looked exactly
  like one that had simply been given no relay, and nothing errored. Fifteen cases, six
  files. NEITHER MOUNT POINT IS WRONG: a seed derives its address from the request's `Host`
  header and cannot put that in a file beside the page, and Pages has no server and can only
  put it beside the page. So the page asks both, through one helper, **beside the page first
  and the origin root second** — and the ORDER is the safety property, because on Pages the
  root request reaches the domain apex, an origin this page does not control.
  DEFECT 2 — A DEPLOY ARTIFACT WAS COMMITTED. `cb09195` also committed
  `packages/browser/demo/public/bootstrap.json`, which `scripts/deploy-pages.sh:141-153`
  writes unconditionally on every run from live sources. No deploy has ever updated it,
  because deploys commit only into a throwaway `gh-pages` worktree, so the tree carried a
  frozen snapshot of one afternoon. Vite's `publicDir` is `demo/public`, so it was copied
  into EVERY local build — and four e2e files serve `packages/browser/dist` as a static
  host, two of them existing to assert that a static host has **no** `/bootstrap.json`.
  Deleted from the working tree, not merely untracked (vite copies from the filesystem), and
  gitignored because a local deploy run rewrites it and six specs snapshot
  `git status --porcelain`. Seven cases, three files.
  ONE FAILURE WAS LOAD AFTER ALL — `gated-admission`, which passed on the quiet re-run
  before either fix. That is the only one the banner's warning covered, and 22 of 23 were
  real. THE GUARD THAT SHOULD HAVE CAUGHT DEFECT 1 PASSED THROUGHOUT:
  `browser-client-publish.node.test.ts` checks *"never root-absolute"*, which is not the
  property — the property is the ORDER of the two candidates, and it now checks that, with
  the swap watched red.
  `v2.0.0-rc.7` IS DEPLOYED, 2026-08-31, run `33378386131`, success — and it is the first
  release in this milestone that fixes something a USER meets rather than something a test
  reads. Both live surfaces were read back, because this one ships to two:
  (1) `https://o2-bootstrap.af-4a0.workers.dev/self` answers `version: 2.0.0-rc.7` on PeerId
  `12D3KooWKm587fnGat5xncq9kaWUk4bN5gUJQiF4q8EwJnrb7rsz`, unchanged since 2026-08-27, with
  `relayService` still four zeroed counters and no marker — the Durable Object's storage
  survived the redeploy and nothing has reserved on the relay yet, which is the same reading
  `rc.6` took and the correct one.
  (2) `https://o2alexanderfedin.github.io/o2.services/bootstrap.json` answers **200** with
  that same PeerId over `/tls/ws`. That reading is doing more work than it looks: it is the
  empirical proof that `scripts/deploy-pages.sh`'s `mkdir -p` and unconditional write still
  produce the document with `demo/public/` now ABSENT from the tree — the one link in the
  deletion that no local run could settle, since a local `vite build` was already proven by
  `built-bundle.e2e.test.ts` rebuilding in `beforeAll` and passing.
  LANES AT THE RELEASE: `node` 218 files / 3164 tests, `e2e` 43 / 250, `aot` 13 / 247,
  `browser` 168 / 2859 over `packages/browser` and `packages/core`, `tsc --noEmit` exit 0.
  The `browser` lane's `packages/aot/src/elflift-cross-engine.browser.test.ts` was NOT re-run
  after the fix and that is stated rather than glossed: it lifts AArch64 binaries, imports
  nothing this change touched, and passed on firefox in the run that was interrupted.
  PHASE 41 CLOSED NO CRITERION AND FOUND ITS BLOCKER FALSE, 2026-08-30.
  `tools/aot/cross-machine.node.test.ts` said `AOT-03` needs a second `aarch64` Linux machine,
  *"which is a thing this repository does not have and cannot synthesise"*. `gh repo view
  --json visibility` answers `PUBLIC`, and GitHub offers hosted Linux arm64 runners — so the
  second host is obtainable and the sentence described effort rather than a physical wall,
  which is the pattern this project has a standing record of. The arrangement is built and
  guarded (`.github/workflows/aot-cross-host.yml`, dispatch-only, every job on an `-arm`
  runner, a refusal to lift where `uname -m` is not `aarch64`). NOTHING IS MEASURED YET: no
  second reading exists, nothing has been compared, `CROSS_MACHINE_BLIND_SPOT` stays on every
  artifact, and whether `ubuntu-24.04-arm` is schedulable here is read off documentation
  rather than run. THE DISPATCH IS OWNER-OWNED, because it is a push to a public repository
  and publication is a separately-triggered gate here.
  build (Phase 39 criterion 4). STILL OPEN AND MINE: the load-sensitive
  multi-process specs — late-combine's two recorded defects are fixed AND IT STILL
  FAILED ONCE on 2026-08-28, one of six cold combines hitting the 1500 ms budget
  on the first full sweep and not reproducing on the second; load did not
  discriminate, the red run reading 3.69 per core and the green run 3.99, so
  do not write load down as the cause. Also unfixed: admission-agents, coverage-agents,
  dht-registration, discovery-agents and speculation-agents are not; four
  REQUIREMENTS.md rows stale in the pessimistic direction (HOST-05, HOST-08,
  HOST-11, HOST-12) plus two false clauses in NET-03's; and no concurrency limit
  by core count anywhere in the tree, which is the next thing the owner named.
last_updated: "2026-08-31T05:20:00.000Z"
last_activity: 2026-08-28 — the hosted tier deployed and released four times, the browser client published and fixed, criterion 2 met in full, Phase 29 closed uncounted on criterion 1 alone
progress:
  total_phases: 13
  completed_phases: 0
  total_plans: 1
  completed_plans: 1
  percent: 0
---

<!--
**`completed_phases: 0` with `completed_plans: 1` is not an inconsistency, 2026-08-28.**
Phase 29's one plan executed and its summary is written. The phase still does not count,
because criterion 1 is refuted and criterion 2 holds on three legs of four — the phases
20/21/22 precedent, where a phase is verified but uncounted and its open criterion is
carried to a named destination rather than rewritten. A plan is complete when it is
executed; a phase is complete when a verifier says so. These two counters measure the two
different things, and collapsing them is how a phase closes by arithmetic.
-->


<!--
**v2.0 header, added 2026-08-25**

Counters were reset for v2.0 "Open the Doors" on 2026-08-25, so the progress narrative below
describes **v1.1** and no longer describes the frontmatter. It is kept in full rather than
replaced, because it is not only accounting: it carries findings that took work to establish
and **one owner decision that is still open** — the `stopped_at` YAML corruption at the very
end, marked *"Not taken autonomously."* An earlier edit in this session replaced this whole
block with a short note and would have destroyed both. Restored verbatim.

**Phase numbering continues from 29.** The 28 directories under `.planning/phases/` are
v1.1's and are deliberately NOT cleared. `/gsd-new-milestone` offers to clear them, and the
offer exists only to stop new `01-*` directories colliding with old ones when numbering
restarts — which it is not doing here. Clearing would have deleted every plan, summary and
verification of v1.1 with no archive, since v1.1 was never closed through
`/gsd-complete-milestone` (`latest_completed_milestone` is null). Two rows of
`REQUIREMENTS.md` cite those paths directly, and the milestone audit reads them.

**What follows is the v1.1 record, unchanged**
-->

<!--
progress counts the v1.1 milestone only: phases 11, 12, 13, 13.1, 14-24. **Fifteen** of
them. This line read "14-23. Fourteen of them" until 2026-08-06: Phase 24
(Certificate-Gated Admission) was inserted by owner ruling 2026-08-05, ahead of 22, which
still runs last. 11, 12 and 13 are verified done. Phase 13 was counted incomplete for most of
2026-07-28 — its first independent pass scored the original criteria 0/3, the criteria
were amended on three owner rulings, four more plans closed the gaps, and a second
independent pass then scored 3/3 against the amended text. It counts now because a
verifier said so, which is the rule: a phase is done when a verifier says so, not when
its plans are.

**`completed_phases` is 12 as of 2026-08-07.** The twelve are 11, 12, 13, **13.1**, 14, 15,
**16**, **17**, **18**, **19**, **23** and **24**. 18 joined on 2026-08-04 when WIRE-04
landed and its second amendment moved it 8/9 → 9/9; 23 joined on 2026-08-06 at 5/5; **16, 19
and 24 joined the same day**, 16 at 4/4, 19 at 5/5 and **24 at 1/1**; **17 joined on
2026-08-07 at 3/3, having been declined the day before** — the only phase in this milestone
to be refused by a verifier and then close, and it closed because a test was written rather
than because a verdict was re-read. The verified-but-uncounted phases are now **three**:
20 (6/7), 21 (2/3) and **22 (2/3, executed and verified 2026-08-08)** — one PARTIAL or declined
criterion each, all **carried** to a named destination rather than rewritten. **This sentence read
*"now two … Phase 22 is neither: it has four plans and no execution"* until 2026-08-08**, which was
true when written and stopped being true at `fee26c2`. Phase 22 is 4/4 on summaries and its
criterion 1 is **DECLINED** — the guard does not pass clean, and disposing the remaining findings
to make it pass would have made the guard decoration.

**Phase 24 closed at 1/1 on the same day it was scored 0/1, and the difference is not a
rewrite.** The 0-of-1 pass refused it on one thing: criterion 8 says *"the fabric"* while
the evidence read *"a relay that has been told to close"*, and `bin/seed.ts` could not be
told to close **at all** — no flag, no field, `relayAdmission` hardcoded. That made the
bound **structural** rather than a deployment posture, and the pass wrote exactly what
would change its mind: *"'Pass-with-a-stated-bound' would be the right disposition if the
bound were a deployment posture an operator can remove. It is not: for the seed there is
no knob."* Four gap-closure plans built the knob, and the dated amendment at `580e461`
re-scored it **MET, 1 of 1**.

**The bound is part of the verdict, not a footnote.** The default posture of
`bin/agent.ts`, `bin/seed.ts` and `bin/bench.ts` stays **open and must** — 19 + 3 argv
sites, with `reservation-exhaustion.node.test.ts` arm A a live behavioural guard on it. So
"the fabric" was read as *a fabric this repository can be deployed and operated as, with a
posture stated on every relay-capable door* — **not** the default argv of its binaries. The
verifier gave four grounds and the load-bearing one is that **both option types make
`relayAdmission` required with no default, so the API cannot express silence**; only argv
has a default. Criterion 8's wording is unedited and was normalised against both quoted
copies before scoring.

**17 and 19 can now close too, and neither has moved.** Both carried their open criterion
*into* criterion 8, so RULING A's precondition is satisfied — but each needs its **own
dated amendment**, on the 16/18 precedent, and **each must carry the bound verbatim**: a
carried criterion cannot inherit more than its destination delivered. That would read
**12 of 15**. Ticking them from this file instead would be the exact move RULING A exists
to prevent.

**And the recurring shape turned up an eighth time, found by a plant rather than a read.**
`CLOSED_RELAY_CAPABLE`'s docblock claims a participant added to `standUp` but not to
`closedSet` reddens. **It does not** — it catches the opposite case. The verifier added a
seventh, *open*, relay-capable agent to the fabric, left it out of `closedSet`, and **both
population assertions stayed green**; what reddened was the control, incidentally. So the
"every relay-capable peer" population is a **hand-maintained literal**, not one derived
from the fabric that exists. Recorded as a warning rather than a blocker, because the run
it qualifies is green on a set that was correct when written — but this is the eighth time
*the population a guard acts on is not the population that pays for it*.

**Phase 16 closed 2026-08-06 by a dated amendment, and it is the second time RULING A has
paid out rather than cost anything.** Its criterion 3 was carried to Phase 20 criterion 6
on 2026-07-31; Phase 20 scored that criterion MET; the amendment re-measured it rather than
transcribing the earlier verdict. **`criterion_text_unchanged: true`** — both texts were
extracted to files and `cmp`'d at exit 0, and `git log -L` returns exactly one commit for
each line, so neither was ever edited. The destination's reading is **stronger** than the
clause carried into it: a spawned `bin/agent.ts` child SIGSTOPped and *awaited to `ps` state
`T`*, resumed only after `executeReduce` had already **returned**, with unsolicitedness
asserted by construction rather than by timing. Two mutations were planted, watched red, and
restored by `cp` + `cmp`.

**One clause does not match literally, the amendment says so, and the verdict turns on it.**
Criterion 3 reads *"discarded harmlessly **because it carries the same CID**"*, and on the
late path that causal claim is **inert**: `rpc.ts` drops the frame because the correlation
entry is gone, *before* the payload matters, so a late reply carrying a **different** CID
would be dropped identically — and no assertion anywhere reads the late frame's CID at all.
The verifier closed on the reading *"the duplicate is harmless because content-addressing
makes it redundant"*, and stated plainly that the stricter reading would demand a mechanism
that should not exist. **An owner who reads it the other way should say so**; that would move
16 back to 3/4 and the count back to 8.

**Phase 24 joined that list on 2026-08-06 and it did NOT join the count.** It has exactly
one criterion, numbered 8, and `24-VERIFICATION.md` scores it **0 of 1 — PARTIAL**: the
admission gate is built, armed and measured, and the criterion's own word is *"the
fabric"* while the evidence reads *"a relay that has been told to close"*. Its destination
is the thing that has not landed — admission as a property of the fabric — and `bin/seed.ts`
cannot be told to close at all, so the bound is structural rather than a deployment
posture. **Criterion 8 is also where Phase 19's criterion 5 and Phase 17's criterion 3 were
carried**, so under RULING A neither of those closes either, and neither phase's score
moves. A destination that lands PARTIAL settles nothing.

**SUPERSEDED 2026-08-08 — `bin/seed.ts` CAN be told to close, and has been able to since
`afe8b0b`.** The three passages in this file that say otherwise (here, under Phase 24's block, and
in Session Continuity) were true when written and are now false. Measured directly rather than
inferred: `bin/seed.ts` takes a repeatable, hex-validated `--admit-issuer`;
`SeedServerOptions.relayAdmission` is a **required** field, so there is no key to omit; and
`seed-server.ts` passes it straight through as `relayAdmission: options.relayAdmission`. Criterion
8 was re-scored **MET** at `580e461`. Found by the v1.1 milestone audit's cross-phase integration
pass, which was briefed with the stale account and corrected it. **The file disagreeing with
itself is the defect this milestone keeps finding, and it found it here three times over.** What
is genuinely asymmetric now is `bin/bench.ts`, which hard-codes `'admits-any-peer'` at three sites
and has no flag mechanism — and leaving it open is a deliberate trade with a stated cost, because
`relayAdmissionGate`'s own header records that 24-02's pre-gate baseline *"stays comparable only
while that remains true."*

**Phase 13.1 joined on 2026-08-02**: it was verified 2026-07-31 at `gaps_found` 6/7 with DATA-10
open, and criterion 7's at-rest half has now landed — a durable per-node sovereign-CID set
(`sovereign-cids.ts`, `idb-sovereign-cids.ts`) registered at `submit.ts`'s blockstore-put and
consulted by the `block` branch. The verification carries a dated amendment rather than being
rewritten, so what it found on 2026-07-31 is still readable.

**The fix deliberately did NOT hold the EgressGuard registration forever.** That would have
closed the criterion and reintroduced the unbounded per-frame scan `egress.ts` forbids by
name. The durable set is keyed on CID and answers by lookup; the guard stays keyed on payload
and stays job-scoped. Two mechanisms, each cheap at its own question — do not merge them.

**The count is over criteria, never over requirements, and Phases 24 and 15 are the
pair that shows why.** 24 is uncounted because its own single **criterion** is PARTIAL.
Phase 15 is counted because all three of its criteria are MET — even though its
requirement, AUTH-03, is *also* Partial. A requirement can outlive the phase that opened
it; a criterion cannot. **The left-hand example of this pair has now been three different
phases, and each one leaving it is the rule being satisfied rather than repealed** — 13.1
held the slot until 2026-08-02 and closed at 7/7, **16 held it until 2026-08-06 and closed
at 4/4**, and 24 holds it now. The slot is not supposed to stay empty and it is not supposed
to keep the same occupant. AUTH-03's requestor half was scheduled, by owner ruling, to Phase
23 criterion 5, and Phase 23 **delivered it** on 2026-08-06 — `bin/bench.ts` calls
`delegate` twice, hands a `(nodeId) => CapabilitySupplier` to `discoverCandidates`, and
ships `shards: [{ value: row, label: 'sovereign', ownerId: BENCH_OWNER_KEY }]`. **The row
is still `Partial` and that is deliberate**: the leg is reached only behind two
off-by-default flags (`--discover --sovereign`), and whether that counts as *entry-point
reachable* is Phase 22 criterion 1's guard to rule, not this row's. REQUIREMENTS.md's row
says exactly that. **`completed_phases` is not a count of
closed requirements and must never be reconciled against one.**

- **Phase 14** — `passed`, 3/3, both mutation probes re-run independently and both red;
  DET-03 and DATA-08 ticked and moved off *Built, not wired*.

- **Phase 15** — 3/3 on criteria. The verifier returned `human_needed` on three
  escalations, **all three since closed**: a production comment naming a function this
  repository does not have, a SUMMARY frontmatter claiming AUTH-03 complete, and an
  unproven browser-tier authorizer. The last was closed behaviourally in 15-05 and is
  pinned by mutation-ledger entry **M30**.

`total_plans` counts plans that exist, and it is not a milestone denominator.

**The clause that used to sit here — *"phases 19, 20 and 22 still have no directory, so it
will grow"* — is FALSE, and it stayed in this file for days after it stopped being true.**
All three exist: `phase-19-quorum-composition-owner-domain-attestation`,
`phase-20-single-job-path-ledger-churn-resilience`, `phase-22-reachability-guard`. So does
`phase-24-certificate-gated-admission`, which did not exist when the sentence was written.
It did grow — **56 → 99** — and nobody moved the number with it. A sentence predicting
growth is not a substitute for recounting.

**Recounted on disk 2026-08-02**, because both figures had gone stale by the width of a
whole wave: 11:1, 12:4, 13:7, 13.1:5, 14:5, 15:4, 16:4, 17:5, **18:11**, 21:5, 23:5 =
**56**, of which **50** have a summary. Phase 18 reads 11 plans / 11 summaries, which is
exactly the "all eleven merged" in `stopped_at` — the two are derived from the same
directory and should be checked against each other.

**Recounted on disk again 2026-08-06**, four days stale and off by 23 plans. Counting
`*-NN-PLAN.md` and `*-NN-SUMMARY.md` per directory: 11 1/1, 12 4/4, 13 7/7, 13.1 5/5,
14 5/5, 15 4/**5**, 16 4/**6**, 17 5/**6**, 18 **13**/13, 19 **19**/19, 20 **13**/13,
21 5/5, **22 4/4** *(was `4/0` until 2026-08-08)*, 23 **6**/6, **24 4/1** = **99 plans, 96
summaries** *(the historical reading; the 2026-08-08 count is 103/107)*. **Re-counted again
after Phase 24 finished executing, 2026-08-06: 24 is now 4/4, so the summaries figure is
99 and `completed_plans` moved 96 → 99.** The plans figure did not move — Phase 24 minted
no new plan — and `percent` is phases and not plans, so it stayed 53 at that point. **Recounted on disk again 2026-08-06 after Phase 24's four gap-closure plans landed: 24 is 8/8, so both figures move 99 → 103**, and they are equal because every plan in the milestone except Phase 22's four now carries a numbered summary. `percent` is 10/15 = 67. The count excludes Phase 19's four `defect-NN-SUMMARY.md` files, which have no plan of their own; a glob that catches them reads 107 and disagrees with `ROADMAP.md`'s own comment, so the two ledgers count different populations on purpose. Phase 18 went
11 → 13 when 18-12 and 18-13 landed as gap-closure plans, so the "all eleven merged"
reading above is now historical and must not be re-derived from it. **Phase 22 was the only
directory with plans and no summaries until 2026-08-08; it is now 4/4.** Re-counted on disk that
day, phase by phase rather than derived from the delta: **103 plans, 107 summaries** — the two
figures are no longer equal, because 22's four summaries landed on top of an already-equal pair.
`percent` is phases, not plans: 8/15 = 53%.

**`completed_plans` counts summaries, and in three phases that is MORE than the plans.**
15, 16 and 17 each carry a gap-closure summary with no plan of its own, so the figure is
not a subset of `total_plans` and must not be read as a percentage of it. A `find` across
`.planning/phases/` returns more still — the extra are v1.0 phases, outside this count.

**18-08 and 18-09 had merged code and no summary for a day**, which is what made the
recount necessary: their work was in `git log` while the artifact a verifier reads did not
exist. A plan is not finished when its commit lands.

Do not take these from `gsd-sdk query progress.bar` — it counts plan files across the
nine unarchived v1.0 phase directories and reports "17/9 plans (100%)".

**CORRECTED 2026-08-22 — the directive stands, the quoted reading is stale, and the mechanism
was wrong.** Measured today the bar reports `141/125 plans (100%)`; it read `17/9 plans (100%)`
when this note was written on 2026-07-27, before phases 25-28 existed. Two defects, both read in
the shipped source at `get-shit-done-cc/sdk/src/query/progress.ts`:

- **`progressJson` applies no milestone filter at all.** `progress.ts:88-108` walks every
  directory under `.planning/phases/` — all 28 — where its sibling `statsJson` in the same file
  does filter (`progress.ts:193` and `:224`, `.filter(isDirInMilestone)`). So the denominator
  125 = 103 (this milestone's own phases 11, 12, 13, 13.1, 14-24, which is what `total_plans:
  103` above is scoped to) + 21 (phases 25-28, planned after v1.1 was scoped) + 1 (phase-9's
  lone v1.0 plan). **Only +1 of the +22 plan inflation comes from the v1.0 directories** —
  attributing the divergence to them is backwards today.

- **The numerator is the raw `*-SUMMARY.md` count with no pairing to a plan** —
  `completed: totalSummaries` at `progress.ts:145`. Summaries exceed plans by 16: +8 from the
  eight v1.0 directories holding a bare `SUMMARY.md` and no plan (phases 2-8 and 10), and +8
  from inside v1.1 itself — the gap-closure summaries 15-05, 16-05, 16-06, 17-06 and phase-19's
  four `defect-*-SUMMARY.md`. That ratio is 112.8%, and `Math.min(100, …)` at `progress.ts:111`
  clamps it to a flat 100%, which is why the bar always looks finished.

So archiving the v1.0 directories — the remedy the word "unarchived" invites, and what
`gsd-cleanup` exists to do — would **not** fix the reading. It leaves 132/124, still over 100%
before the clamp.

**And `gsd-sdk query stats` is worse, not the fallback: it reports 0 plans, 0 summaries and 0
phases completed.** Its filter is `getMilestonePhaseFilter` (`state.ts:37-72`), and both of its
branches anchor on the raw directory name. The numeric branch, `/^0*(\d+[A-Za-z]?(?:\.\d+)*)/`
at `state.ts:62`, requires a leading digit; every phase directory in this repository is named
`phase-<N>-<slug>` and always has been, so it never fires. The custom-ID branch at `state.ts:65`
then captures the whole name — `phase-14-signed-artifact-resolution` — which matches no roadmap
phase number. The filter therefore rejects all 28 directories, which makes the docblock at
`state.ts:33` describing it as the check for whether a directory "belongs to the current
milestone" false in this repository. Recount on disk phase by phase, or read
`gsd-sdk query roadmap.analyze` for the post-v1.0 slice: 19 phases, 124 plans, 132 summaries.

**Seven separate writers have now corrupted this frontmatter, so treat the whole family
as unsafe and maintain it by hand.** *This line read "Three" until 2026-08-13 while the list
below it already had six entries* — the count was never updated as the list grew, which is the
same stale-claim defect the list exists to record, committed in the list's own header.

- `gsd-sdk query state.begin-phase` — overwrites this block from that same bad count
  (2026-07-28: rewrote 25% to 62%) and mangles the Current focus paragraph.

- The `pause-work` workflow's own state update (2026-08-01) — rewrote `total_phases`
  14 to 24, reset `completed_phases`, regressed `last_activity` by a day, and mangled
  `milestone_name` to "— Wire What Was Built".

- `gsd-sdk query state.record-metric` (2026-08-01, found by plan 18-03) — asked for a
  single metrics row, it *also* rewrote `status` and `stopped_at`, regressed
  `last_activity`, and rewrote every progress count: **percent 36 to 74**.

- `gsd-sdk query state.planned-phase` (2026-08-09) — **the worst of the four so far.** Asked
  to record that Phase 25 is planned, it reported `{"updated": ["Status", "Last Activity"]}`
  and wrote a diff of **51 insertions against 103 deletions**, deleting the whole `stopped_at`
  block: four owner rulings, the AOT-06 located negative, the Phase 17 close, all of it. It
  did not error. Caught by the `git diff` this very list prescribes, reverted whole-file, and
  the two fields it was asked for were then written by hand.

- `gsd-sdk query state.record-session` (2026-08-09, Plan 25-04's executor, run right after
  `state.record-metric` above) — **the fifth writer, same family.** Asked only for
  `--stopped-at`/`--resume-file`, it reported success and wrote a diff of **57 insertions
  against 105 deletions**: deleted the entire `stopped_at` frontmatter block a second time
  (same content named above, still present at HEAD until this call), flipped `status:
  executing` to `status: verifying` unasked, regressed `last_activity` from 2026-08-09 to
  2026-08-06, and rewrote every `progress:` count to fabricated values (`total_phases` 15→27,
  `completed_plans` 103→112, `percent` 80→100 — none of which this session provided or
  computed). Caught the same way as every entry above: `git diff .planning/STATE.md` before
  committing, not by either tool call reporting failure. Reverted whole-file
  (`git checkout -- .planning/STATE.md`, safe because `git status` was clean before either
  call), and the metrics row, the decision, and this session's continuity fields were then
  all written by hand rather than risking a sixth corruption trying `record-session` again.

- `gsd-sdk query roadmap.update-plan-progress 27` (2026-08-10, Plan 27-01's executor) —
  **writer number six, and it was on the SAFE list when it did this.** It reported
  `updated: true` and rewrote this file: a `stopped_at` block truncated mid-sentence and
  **97 lines dropped**. It did not error. Caught by the same `git diff` every entry above was
  caught by. Reverted whole-file and verified byte-identical to HEAD — safe here only because
  `git status` was clean immediately before the call, which is the sole condition under which
  `git checkout --` on a shared file is permissible.

- The `pause-work` workflow's own state update, **again** (2026-08-13) — **writer number
  seven, and it is a repeat of writer number two.** Left uncommitted by the pause because the
  handoff commit used explicit paths, so it sat in the working tree until `/gsd-resume-work`
  read `git status` the next morning. Diff: **57 insertions against 106 deletions** — deleted
  the whole `stopped_at` block a third time, mangled `milestone_name` back to
  "— Wire What Was Built" (**the identical mangle recorded against this same writer on
  2026-08-01**), regressed `last_activity` 2026-08-09 → 2026-08-06, flipped `status` to
  `verifying`, and zeroed every count: `total_phases` 15→29, `completed_phases` 12→**0**,
  `total_plans` 103→**0**, `percent` 80→**0**. The zeroed frontmatter sat two lines above body
  text stating twelve phases complete, so the file contradicted itself in adjacent sentences.
  Reverted whole-file after confirming no agent was running and the rest of the tree was clean.
  **The lesson this entry adds to the six above it: a corrupting writer that runs during
  `pause-work` is the most dangerous of the family, because pause is exactly when nobody is
  left to read the diff.** Check `git status` on resume before trusting anything in this block.

~~`roadmap.update-plan-progress` and `state.add-decision` are the two measured exceptions and
are safe — both ran this same session with a clean, correctly-scoped diff each time.~~

**THAT SENTENCE WAS FALSIFIED 2026-08-10 and is struck rather than deleted, because how it
came to be written is the reusable part.** `roadmap.update-plan-progress` was granted "safe"
on the strength of observed clean diffs on an earlier session's STATE.md. That is evidence
about the runs that were watched, not a property of the verb — and this file's shape has
changed since. **A verb
that has behaved is not a verb that is safe**, and a safe-list entry is exactly the kind of
claim that stops anyone running the `git diff` that would catch it. The list is now
**seven verbs**, and the only remaining unfalsified entry is `state.add-decision`, which
should be read as *not yet observed to corrupt this file* rather than as safe.

**If you must add a metrics row, write it by hand.** And after any tool touches
`.planning/`, `git diff .planning/STATE.md` before committing — every one of these was
caught that way and not by the tool reporting a failure. None of them errored.

**MEASURED 2026-08-06, and it may be why none of them errored: THIS FRONTMATTER HAS NOT
BEEN VALID YAML FOR SOME TIME.** `yaml.safe_load` over the block raises
`ScannerError: mapping values are not allowed here` — at HEAD before this update, on
`stopped_at` at column 149, which is the `": "` inside *"…and 18 (8/9): a phase at less
than full marks…"*. A `": "` cannot appear inside a plain (unquoted) YAML scalar. There
are **five** such sites in `stopped_at`, all pre-existing; this update added none and
removed none, and wrote `WAS -` rather than `WAS:` so as not to add a sixth.

**This is a finding, not a diagnosis, and it is deliberately not fixed here.** That a
writer which cannot parse the block goes on to rewrite it is *plausible* as the mechanism
behind all three corruptions above — and plausible is not measured, which is this
project's own rule. The fix is one owner ruling wide: make `stopped_at` a folded block
scalar (`stopped_at: >-` with the text indented), which is the idiom every
`*-VERIFICATION.md` already uses for `score:` and which makes `": "` and `" #"` safe. The
risk to weigh against it is any consumer that line-greps `^stopped_at:` for its value
rather than parsing. **Not taken autonomously.**
-->

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-07-27)

**Core value:** Usable capacity grows super-linearly with the user base, without any raw data leaving its owner's device.
**Current focus:** **The count is 12 of 15.** *(SUPERSEDED 2026-08-22 — the count is 15 of 15,
and v1.1 "Wire What Was Built" is CLOSED at 15/15 phases and 50/50 requirements: merged
`2c720b9`, milestone merge `af8828f`, corroborated at `.planning/COVERAGE-BASELINE.md:38`. The
three carried phases all closed 2026-08-18, each by a dated amendment to its own verification
file rather than by a rewrite — 20 at 7/7 (`20-VERIFICATION.md:8`, criterion 7 closed at
`ce97bc8`), 21 at 3/3 (`21-VERIFICATION.md:6`), 22 at 3/3 (`22-VERIFICATION.md:5`, changed from
2/3). **Why this line was wrong is the instructive part**: the 2026-08-20 reconciliation at
`e84537c` wrote the close into this file's own frontmatter — `status` milestone_complete,
`completed_phases` 15, `percent` 100 — and never touched this sentence, so for two days the file
disagreed with itself in the line a reader looks at first. That is the exact defect this
milestone keeps finding, committed in its own bookkeeping. The paragraph below is kept because
it records how the milestone ran.)* Phase 24 closed at 1/1 and Phase 19 at 5/5 on
2026-08-06; **Phase 17 closed at 3/3 on 2026-08-07**, having been *declined* the day before.
**AOT-06 was answered on 2026-08-07 and the answer is negative with a located cause**:
elfconv cannot lift x86-64 today, because `lifter/TraceManager.cpp`'s entry-point discovery
is hardcoded AArch64 byte patterns with no amd64 branch — **not** instruction semantics,
which Remill has had for years, and **not** the build, which CI publishes as `:amd64`.
elfconv is now a submodule pinned at the commit both images report, so that is readable
in-tree. *(SUPERSEDED 2026-08-22 — there IS an amd64 branch, and the pin has moved.
`third_party/elfconv/lifter/TraceManager.cpp:300` opens `#elif defined(ELFCONV_X86_BUILD)` —
the `#elif` arm of the very `#if defined(ELFCONV_AARCH64_BUILD)` block this sentence describes
— and that arm recovers `main` from `_start` by decoding the three `%rdi` materialisations
`48 c7 c7 <imm32>`, `48 8d 3d <rel32>` and `bf <imm32>`. It is compiled, not dead source:
`lifter/CMakeLists.txt:35-36` defines `ELFCONV_X86_BUILD=1` under `CMAKE_ELFCONV_X86_BUILD`,
set by `scripts/build.sh:192`. This project wrote it on 2026-08-07 at submodule commit
`975289c`, "amd64: make the ELF front end work on x86-64 binaries", on the fork branch
`amd64-elf-frontend`. So the second clause is stale too: the gitlink is `9655e33`
(`git ls-files -s third_party/elfconv`), four commits past the `5319dd8` the cached images
report at line 116 of this file — the pin is no longer the commit both images report.
**What is falsified is the located cause, not the verdict.** No lift has been run against the
amd64 arm, so whether an x86-64 ELF now lifts end to end is UNMEASURED, and by this repository's own rule unmeasured is
not met: AOT-06 is open, not re-closed as a positive.)*

**Phase 22 (Reachability Guard) ran last and landed 2026-08-08 at 2/3, and the v1.1
milestone audit has since run** (`.planning/v1.1-MILESTONE-AUDIT.md`, `gaps_found`, 17 findings).
The open work is that gap list, **not** a phase. That order
is an owner ruling of 2026-08-05, which inserted 24 ahead of 22; 22 was already last, because
it is the guard that rules on everything the other phases wire. **The premise that ruling
rested on was re-confirmed 2026-08-07**: the narrow reading of *"the fabric"* stands, so 22
will certify a fabric with an admission posture stated on every relay-capable door.

**Three phases are verified and stay uncounted, and that is the rule working rather than
the rule failing**: 20 at 6/7, 21 at 2/3, and 22 unexecuted. *(SUPERSEDED 2026-08-22 — all three
are now counted: 20 at 7/7 (`20-VERIFICATION.md:8`), 21 at 3/3 (`21-VERIFICATION.md:6`), 22 at
3/3 (`22-VERIFICATION.md:5`), each closed 2026-08-18 by a dated amendment to its own
verification file, none by a rewrite. "22 unexecuted" was already false when written — 22 ran
2026-08-08 with 4 plans and 4 summaries on disk (`22-01`..`22-04`, PLAN and SUMMARY both), which
the paragraph above already records as "landed 2026-08-08 at 2/3".)*
Each of the first two has
exactly one PARTIAL criterion **carried to a named destination rather than rewritten** —
20's to a checkpoint sink no shipped entry point supplies, and 21's recorded as a measured
negative on AOT-05's precedent.

**This block has now read "six … 16 at 3/4", "five … 24 at 0/1" and "four … 17 at 2/3", and
every move had the same cause**: a carried criterion closed once its destination actually
landed MET. **17 was the exception that proves RULING A rather than the one that breaks
it.** Its destination landed MET and it was *still declined*, because the criterion needed a
third link neither sentence named — one certificate admitting exactly one identity — and no
test observed it. It closed a day later, and it closed **because a test was written and the
plant that had stayed green was watched to redden**, not because the bookkeeping caught up.
A criterion closes when a verifier says so and not when a file like this one does; and each
carried criterion must take criterion 8's **stated bound** verbatim, since a carried
criterion inherits no more than its destination delivered. Phase 15 is counted at 3/3 despite a Partial
*requirement*. **The count is over criteria, never over requirements** — a requirement can
outlive the phase that opened it; a criterion cannot. **RULING A**: a criterion is not
rewritten to let a phase close, and a carried criterion stays PARTIAL until its destination
phase lands. Phase 18 is the proof that this costs nothing in the end — it sat at 8/9 for
two days and closed at 9/9 on 2026-08-04, the day WIRE-04 landed, exactly as the tripwire
was written to. **Phase 24 was the first case of the other outcome, and it was the harder
one**: 17 and 19 both carried their open criterion *to* criterion 8, criterion 8 landed
PARTIAL at first reading, and so all three stayed PARTIAL together. A destination that
arrives and does not settle the clause settles nothing, and RULING A does not let the
arrival be read as a close. **All three are now closed, and none of them by a rewrite** —
24 by four gap-closure plans building the knob its own 0-of-1 pass had named, 19 by carrying
the bound verbatim, and 17 by a test that made the unobserved binding observable.

DATA-10 closed on 2026-08-02 and 13.1 is counted. The at-rest half landed as a durable
per-node sovereign-CID set registered at `submit.ts`'s blockstore-put; the bare-`submitJob`
half is covered by the same boundary rather than deferred to Phase 20 as the 2026-07-31
ruling anticipated.

## Current Position

Phase: 29 of 41 — Hosted Tier Assembly & First Deploy (not started)
Plan: —
Status: Planned, not executed — `/gsd-new-milestone` completed all 11 steps
Last activity: 2026-08-25 — v2.0 requirements and roadmap written

**v2.0 is 13 phases, numbered 29-41.** `gsd-sdk query roadmap.analyze` reports one
milestone slice and phases 29 through 41 with `missing_phase_details: None`. All 40
requirement ids — the 36 minted for v2.0 plus the four carried — land in exactly one phase
each, verified mechanically rather than by reading the writer's own report.

**`total_phases: 13` counts v2.0 only.** The 28 phase directories on disk are v1.1's and
stay; the roadmap parser now places them in the preamble, exactly as v1.0's fell into the
preamble when v1.1's heading was added on 2026-08-18. This is what step 10 is supposed to
cause, and it has one consequence worth stating outright: **`/gsd-autonomous` now discovers
13 phases, all of them v2.0.** Before the roadmap landed it discovered 16 — every one of
them v1.0/v1.1 work, fifteen already complete on disk with an unticked box, and it would
have re-planned and re-executed them.

**The unticked v1.1 boxes are still unticked and that is deliberate.** Fifteen v1.1 phases
read `[ ]` in the checklist while their directories hold plans, summaries and verification
files, and Phase 3 reads `[ ]` with no directory at all. Each has a `*-VERIFICATION.md`
carrying a score, and the status belongs to that file. Ticking them to tidy the count would
be closing a gap by widening what counts as passing. It is open bookkeeping, owed a pass of
its own against the verification files — not a side effect of opening a milestone.

### v1.0 carried forward, unarchived

```
Checkboxes  v1 section    45 of 72 ticked · 27 open
            v1.1 section   9 of 10 ticked ·  1 open (WIRE-02)
            whole file    54 of 82
Markers     76 traceability rows: 48 Done · 22 Partial · 1 Built, not wired
            (MR-02) · 5 neither — AOT-03, BENCH-06, NET-03, VER-02, WIRE-02
v1.1        9 of 50 requirements closed  (numerator NOT recomputed — see below)
Historical  v1.0 closed at 112 test files / 1673 tests; 122 / 1775 on 2026-07-28
```

**Recounted on disk 2026-08-06, and every field of the previous block was stale.** It
read *"35 / 72 wired · 27 built-not-wired · 6 partial · 4 open"* and *"Whole file 40 of 82
ticked (35 in the v1 section + 5 in v1.1's)"*. Measured: **45** ticked in the v1 section,
**9** in v1.1's, **54** whole-file; and on the traceability rows, built-not-wired is down
to **1** while Partial is up to **22**. `REQUIREMENTS.md`'s own header already said
*"45 of 72 are `[x]`"* — so **the ledger was current and this summary of it was not**,
which is the same shape as the progress table that said "Not started" for seven finished
phases. A file that summarises another file needs an owner too.

**The old line merged two populations and that is why it drifted unnoticed.** *"35 / 72"*
counts **checkboxes in the v1 section**; *"27 built-not-wired · 6 partial"* counts
**markers on traceability rows**, a different set with a different denominator (76 rows
against 82 requirements — six requirements carry no row). They are split above so the next
reader cannot re-merge them.

**`v1.1 9 of 50` was deliberately NOT recomputed.** Its numerator's definition is contested
*inside this same file*: the paragraph above says the four IDs 13.1 closed are among the ten
new ones and so "do not move this numerator", while WIRE-01 — also a new ID — is counted in
it. Recomputing under a guessed definition would replace a stale number with a wrong one.
This needs the definition settled first, and that is an owner's call, not a recount.

**The 27 and the 6 moved together and the ticked counts did not.** Phase 15 took AUTH-03
off *Built, not wired* and onto **Partial** without closing it: its serving half is wired
and verified, its requestor half has zero production callers. A requirement can leave
"built, not wired" without arriving at "done", and the ledger has to be able to say so —
otherwise the only way to record progress is to overstate it.

The 27 reconciles with the audit's 36: eight have been wired since — DATA-03, DATA-04,
DATA-05, DATA-06, DATA-07 and DATA-09 in Phase 12, then DET-03 and DATA-08 in Phase 14 —
and one, AUTH-03, moved to Partial in Phase 15.
Count them from the **traceability table** rows (`^| ID |` … `**Built, not wired**`),
which is the only place that marker lives; a whole-file grep also catches the legend and
one line of prose and overcounts by two.

**Ticking a requirement is three edits, not one.** Phase 14's verification found this:
the checkbox, the traceability row's *Built, not wired* marker, and the section header's
own count all have to move together, and ticking alone leaves the ledger disagreeing with
itself. There is a fourth: `packages/node/src/acceptance-traceability.node.test.ts` pins
specific ids in specific states, and 13.1's verification broke it by closing SCHED-06
while that spot-check still asserted it open — **`develop` was red from that commit until
it was caught by an unrelated executor.** Run that file after any ledger edit.

**Two denominators, and confusing them is the trap.** REQUIREMENTS.md's own header reads
*"35 of 72 are `[x]`"* — that is the **v1 section alone** (35 ticked + 37 not = 72) and it
is correct as written, not stale. v1.1 then minted 10 further IDs in its own sections
(WIRE-01…04, SCHED-06, NET-08, NET-09, NET-10, DATA-10, BENCH-07), of which five are now
ticked: WIRE-01, plus SCHED-06, NET-08, NET-09 and NET-10 from 13.1's verification.
DATA-10 is the one 13.1 left open. So the whole-file count is **40 of 82** and neither
number contradicts the other. Recount with the section ranges, never with a whole-file grep.

**v1.1's scope is 50, not 44.** Forty existing IDs to be wired, plus those 10 new ones.
The line said 44 because it was written when only WIRE-01…04 existed; SCHED-06, NET-08,
NET-09, NET-10 and DATA-10 were minted on 2026-07-28 with Phase 13.1 and BENCH-07 with
Phase 23. **The numerator is 9:** DATA-03, DATA-04, DATA-05, DATA-06, DATA-07 and DATA-09
from the existing forty (Phase 12), DET-03 and DATA-08 (Phase 14), plus WIRE-01. The four
that 13.1's verification closed are among the 10 new IDs, not the forty, so they raise the
whole-file count without moving this numerator.

**Read `.planning/v1.0-MILESTONE-AUDIT.md` before planning.** It carries `file:line` for
every claim. v1.0 was deliberately **not archived** — its audit returned `gaps_found`,
and filing 36 unwired requirements under a completed milestone would have made the
ledger say something untrue. The phase directories for 2–10 are intact for the same
reason.

The 36 are not undone work. Sovereignty labelling, tree-reduce, discovery, enrollment,
quorum composition, capability chains and the whole churn coordinator are implemented,
exported and covered by their own specs — and nothing a person can run calls any of
them. Verified symbol by symbol: `runResilient`, `EgressGuard`, `translationCid`,
`composeQuorum`, `discoverExecutors`, `executeReduce`, `requestEnrollment`, `signName`
and `verifyChain` each appear only as their own definition, a barrel re-export, or a
prose comment.

**The structural cause is one shape, and it is v1.1's first target.** `serveAgent`
declares six optional hooks with silent defaults — `authorize`→allow, `index` and
`reservations`→empty, `capacity`→accept. `ledger` is supplied nowhere at all, in
production or in one test. A hook whose default is indistinguishable from the feature
working is why no test failed.

**One of the 36 was a live bug and is already fixed.** Static-host rendezvous answered
`[]` forever — `FabricNode.reservedPeerIds` held the right data and `serveAgent` was
never given it — with the signature `{asked: true, dialed: [], failed: []}`: nothing
attempted, nothing failed, no error. `rendezvous-wire.node.test.ts` starts three real
nodes and requires two to find each other with nothing supplied by the harness.

### Where Phase 10 landed

**The finding is the exit code.** A pipeline trusting elfconv's `0` would cache an
artifact that aborts at runtime under a name asserting it is clean. Two greps —
abort call sites and recovered addresses — must agree before the count is called
evidence, because a single grep that stopped matching would report zero and look
like good news.

**A real artifact was pointed at the executor for the first time**, and every
execution-side test before it used hand-written fixtures written from the same
understanding as the executor. The ABI held exactly: 23 WASI imports, `_start` and
`memory`, every import answered. And it turned up something fixtures could not — a
`printf("hello\n")` imports **`clock_time_get` and `poll_oneoff`**, because glibc's
stdio pulls them in whether the program asks or not. Pinning the clock is
load-bearing on the very first task anyone runs.

**The V8 code cache does not happen.** At 4.8 MB, `application/wasm`, query-free CID
URL, `compileStreaming`, hot enough to tier up: no WASM code-cache entry across three
visits, while the same profile grows a 2 MB *JavaScript* cache and a
`--v8-cache-options=none` calibration reads the identical 72B. Reported unmet rather
than reworded — a criterion that can only be reported as met is not a measurement.

**A recorded project assumption was wrong.** `CLAUDE.md` said elfconv needs
unstripped binaries. It does not: `.eh_frame` is enough, via libdwarf. Corrected in
`CLAUDE.md` and the roadmap.

**Two reviewer findings outlived the phase and were real.** A file carrying raw NUL
bytes had silently left the vocabulary guard's jurisdiction — an exemption with no
entry, which the guard's own planted violations could not detect because they scan
synthetic content rather than the tree. And `PINNED_WASI_FUNCTIONS` was checked only
for *identity*, which a replacement returning the wrong value satisfies exactly.
Both fixed; 8 mutations planted, 8 caught.

### Where Phase 9 landed

**Consent is a value, not a check.** `GrantedConsent` is minted only by
`grantConsent`, and `start` takes one as a parameter — a caller without one does not
fail a check, it fails to compile. No test-only bypass: the e2e harnesses consent
for the same reason a visitor clicks the button.

**Nothing touches the network before consent either.** Criterion 3 names CPU; the
owner's decision went further, because "we spent no cycles" is not an answer to "you
told a third party I was here". Proved by watching every request the tab makes.

**Stopping had to become real before it could be claimed.** `WasmExecutor` ran on
the main thread, where a synchronous `run()` cannot be interrupted — so "one click
drops CPU to zero" meant "zero once the current task finishes". Tasks now run in a
Worker; Stop calls `terminate()`. The probe that proves it is a bare `loop br 0`.

**A guard caught the exact trap it was written for.** Replacing `terminate()` with
a cooperative flag left every test green *except one* — the one that messages the
thread directly, past the executor, and requires silence. Rejecting the pending
promises makes a stop look instant while the thread keeps burning; resolving the
caller and killing the worker are two different acts.

**Ordering is what makes cubes worth having.** The colouring search first walled at
n = 205 and no parallelism moved it: assigning values in increasing order means a
cube fixes the *least* constrained numbers — 1 and 2 appear in no triple at all — so
cubing split the work without splitting the difficulty. Ordering by constraint
degree moves the wall with cube count: 1 cube → 300, 8 → 500, 256 → 600.

**Chromium throttles timers hard in a tab that is not in front** — measured, a
400 ms poll produced one tick per second. Anything the always-visible surface
depends on is pushed, never polled. This bit twice in one phase.

Numbers: 6 mutations planted, 6 caught. `verifyColouring` re-derives 484 triples at
n = 600 and accepts in under a millisecond, trusting no node.

### Where Phase 8 landed

**The ordering was the requirement.** `BENCHMARK-METHODOLOGY.md` went in before any
harness existed — checkable in `git log`. Three pre-registered predictions all held: the
node axis would be sub-linear (it was flat), the COST crossover would be embarrassing
(none, ~570×), and the fixture bias would dominate (it did).

**The headline caveat is what the numbers cannot show.** Every node in both curves runs
in one OS process on one event loop, so no parallel speedup is measurable at all. The
flat makespan is the consequence of that, not a finding about scaling. The scaling claim
is therefore **unmeasured** — which is neither disproved nor supported.

**The incomplete-run rule paid for itself immediately.** The first full run reported
19/19 incomplete at every memory rung rather than a suspiciously fast success: the memory
workers could not fetch shard inputs. A harness that averaged failures in would have
published a beautiful fictional curve.

**A misnamed field, caught before publication.** `JobResult.grossNodeSeconds` named a
quantity that was *bytes across the guest ABI*, not seconds — deterministic, which is
right for a cost metric, and off by a factor nobody could guess if published as time.
Renamed to `grossFuel`/`usefulFuel`; the driver measures real node-seconds itself.

**Two ladder rungs published as excluded, not dropped.** Real transport at 8 and 16 nodes
dies on `INBOUND_CONNECTION_THRESHOLD = 5` per host — the limit Phase 3 already found.
A rung that vanishes between plan and results is indistinguishable from one removed for
being inconvenient.

Numbers: connectivity tax **8–10×**; no COST crossover; decomposition native 0.002ms →
WASM in-process 0.61ms → distributed 1.3ms, so most of the gap is the ABI on a trivial
fixture rather than the fabric.

### Where Phase 7 landed

A job survives its machines — and its submitter — vanishing mid-flight. A lease is a
deadline, not a lock, so "never orphaned leases" needs no cleanup code and resume is the
same path as start. Then an adversarial review found five defects and refuted none, the
worst being that speculation could change the answer: breaking on the first arrival meant
a losing copy was never compared, so timing alone could pick between two different CIDs.
The test guarding it was vacuous. All fixed and mutation-tested.

### Where Phase 3 stands

Two browser tabs, and separately an iPhone running Safari and a laptop running Chromium,
complete a 4-shard 2×-redundant job over a **direct WebRTC** connection with the relay
carrying only SDP. Remaining: real AutoTLS, which needs a publicly reachable host.

## Performance Metrics

**This section is a partial record and must not be read as a velocity figure.** The
per-plan rows below are appended by the executor, and only 8 of the 17 executed plans
ever got one: Phase 13's plans 04-07 and all five of Phase 13.1's are missing. The
template header that used to sit here read *"Total plans completed: 0"* directly above
eight rows of real data, with the By-Phase table left as placeholder dashes — replaced
2026-07-31 with what the rows actually say.

**Logged: 8 plans, 247 min, 4.1 hours, mean 31 min/plan.** The mean is not meaningful —
the spread is 7 min to 100 min, and this project's own benchmark methodology records
that straggler-dominated distributions have meaningless means.

| Phase | Plans logged | Total | Median | Range |
|-------|--------------|-------|--------|-------|
| 11 | 1 of 1 | 13min | 13min | — |
| 12 | 4 of 4 | 190min | 35min | 20-100min |
| 13 | 3 of 7 | 44min | 12min | 7-25min |
| 13.1 | 0 of 5 | — | — | — |

*Rows appended after each plan completion:*

| Phase 11 P01 | 13min | 3 tasks | 13 files |
| Phase 12 P01 | 25min | 2 tasks | 17 files |
| Phase 12 P02 | 20min | 2 tasks | 4 files |
| Phase 12 P04 | 100min | 2 tasks | 8 files |
| Phase 12 P03 | 45min | 1 tasks | 2 files |
| Phase 13 P01 | 12min | 2 tasks | 5 files |
| Phase 13 P02 | 7min | 2 tasks | 2 files |
| Phase 13 P03 | 25min | 2 tasks | 1 files |
| Phase 18 P03 | 25min | 2 tasks | 5 files |
| Phase 25 P04 | 8min | 3 tasks | 8 files |

## Accumulated Context

### Roadmap Evolution

- **Phase 27 added 2026-08-08** — *The Demo UI, Driven by the Real Fabric.* Filed by owner
  instruction after a UI mockup covering all four workloads was imported to
  `docs/design/mockups/o2-fabric-demo/`. **Corrected by hand 2026-08-10; the original clause is
  kept because it is what a reader greps.** It said the phase *"Closes the demo half of
  MR-03…MR-07, whose ledger rows already name the gap, and audit finding G4."* **Both halves of
  that are now false, and it was written as an intention before the phase ran.** What the phase
  actually did: **MR-03…MR-07 all five stay `[ ]` Partial** — the demo's aggregation workload is
  π and it does merge through `reduceJob` behind a run control, but colouring's `answerOf` scan
  stays a scan on purpose (first-found-wins has nothing to aggregate), so the clause was amended
  per row rather than closed, and whether `MR-03` alone may tick is an open owner decision in
  `27-OPEN-ITEMS.md`. **G4 closed one of its two halves** — the `runJob` half is closed
  (`#byo-form`'s submit handler calls `window.o2.runJob`, driven on four arms by
  `packages/node/src/demo-byo.e2e.test.ts`), the primes half is restated with a measured reason
  and stays open, which is why the audit now carries G4 as a split row. The per-row truth is in
  `ROADMAP.md`'s Phase 27 Requirements line; this entry is the roadmap-evolution note and was
  simply never revisited after the phase reported. **This file is otherwise stale about Phase 27
  and is corrected by hand for a measured reason**: seven `gsd-sdk query state.*` verbs were
  measured to corrupt `STATE.md` while reporting success (`27-OPEN-ITEMS.md` section 9), so no
  state verb is run against it. Not scheduled into v1.1, whose span is phases
  11-22 — the same treatment phases 23-26 have.
  **Numbering was corrected by hand and the reason is worth keeping**: `gsd-sdk query phase.add`
  returned **25**, because it takes the next number from the phase *directories* (highest
  `phase-24`) rather than from ROADMAP.md (highest `Phase 26`). Phases 25 and 26 are filed as
  roadmap entries with no directory, so the SDK produced a duplicate `### Phase 25` and placed
  it inside the requirement-coverage section. Any future `phase.add` on this repository will do
  the same until every roadmap phase has a directory — check the heading it writes.

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- Verification compares the SAME module run on two nodes, byte for byte. Not multiple implementations of the same computation — cross-implementation verification is explicitly out of scope.
- There is no static determinism analysis. Divergence is detected by the comparison, not predicted ahead of it. The admission gate was built and then deleted; do not reintroduce it. The import object is the sandbox — WebAssembly.instantiate refuses any import the host does not supply.
- The verification claim is split (C3, decided): redundant execution on public/shared data and on the aggregation tree; sovereign maps run redundantly within the owner's own node set when two or more are live, and are owner-attested otherwise.
- Relay decision inverted by evidence: own backbone relay primary (AutoTLS + webRTCDirect), public infra opportunistic only. Browsers structurally cannot dial the majority of public libp2p nodes.
- Ordering is load-bearing: sovereignty before placement, tree-reduce before placement, artifact signing at content-addressing time (not at elfconv time), coordinator checkpointing in the churn phase, governor + benchmark instrumentation in the kernel phase.
- **A remote executor is just an `Executor` (Phase 2).** `submitJob` takes `Executor[]` and cannot tell where one runs, so the network arrived without a kernel change. Any future "distributed" feature should first be checked against this: if it can be an adapter behind an existing port, it must be.
- **Packages split on the portability line, not the feature line (Phase 2).** `@o2/net` is portable and its tests run in Node *and* Chromium; `@o2/node` holds everything a browser cannot do. `purity.node.test.ts` enforces it — no `node:`/`libp2p`/`@chainsafe` import may appear in a portable package.
- **`Transport` stays a one-way datagram port (Phase 2).** Request/response correlation lives in `@o2/net` instead, because a datagram shape is the smallest thing an in-process table, a libp2p stream, and a relayed WebRTC channel can all implement.
- **All nodes have equal functionality (owner decision, 2026-07-26, restated twice).**
  There is no tier, no class, no lesser node. Every node executes tasks, holds blocks,
  serves records, hosts reduce combines, and takes quorum slots on identical terms.
  **The only difference is discovery**: a browser cannot bind a listening socket, so it
  cannot act as a seed a newcomer dials cold — it must be found through a relay that
  can. That is narrower than "reachability", which was the previous wording and was
  still wrong: once connected, the peers are indistinguishable. Proven in Phase 3, where
  an iPhone was dialled at its `/p2p-circuit/webrtc` address and ran half of a
  2×-redundant job. "Client-mode-only DHT" and "browsers are leaves" were inherited
  assumptions, both reversed. Background-tab throttling is a lease-duration problem, not
  a capability one. **If a decision keys on node kind, it is wrong** — the only
  legitimate use is shared-dependency analysis over the discovery graph.

- **Liveness changes who computes and when, never what the answer is (Phase 7).** The
  invariant every churn mechanism rests on. True because a result is a pure function of
  (module, input, partition) and content-addressed, so a re-dispatch recomputes
  byte-identical output and every recovery action is at worst wasted work. Re-check this
  first if any of the churn code changes.

- **A lease is a deadline, not a lock (Phase 7).** Nobody releases it and no keeper
  notices the coordinator left, so "never orphaned leases" needs no cleanup code. A lock
  would have required the holder-liveness protocol the deadline replaces.

- **A node failure and a task failure warrant opposite policies (Phase 7).** Collapsing
  both into `null` makes the 30%-node-loss criterion unachievable — three unlucky dead
  picks retire a good shard. Node failures retry until the pool is exhausted; task
  failures stop after three independent nodes fail the same work.

- **Re-dispatch must exclude tried nodes before placement (Phase 7).** Placement is
  deterministic by design, so a retry otherwise re-derives the identical dead choice.
  Narrowing the input is safe — the sovereignty gate still runs inside `placeWithOffers`.

- **Pre-registration is an ordering, not a document (Phase 8).** The methodology commit
  contains no harness and no number, so `git log` proves the analysis was not chosen
  after seeing the data. Predicting the disappointing results in advance is what stops
  a flat curve being spun as a surprise.

- **A fast failure is not a fast run (Phase 8).** Excluding incomplete runs from
  makespan statistics is what turned a silent 19/19 failure into a visible bug instead
  of a beautiful fictional curve.

- **A unit in a field name is a claim (Phase 8).** `grossNodeSeconds` held bytes. The
  ratio was fine, the absolute number would have been published wrong by a factor
  nobody could guess. Rename rather than document — a comment does not travel with the
  number into a report.

- **Publish excluded configurations with the reason (Phase 8).** A rung that vanishes
  between the plan and the results is indistinguishable, to a reader, from one removed
  because its number was inconvenient.

- **A fake that is faster than the real thing cannot see a timing bug (Phase 7).** The
  worst two churn defects — a hang, and a losing copy never compared — were both
  invisible to a suite whose dispatch resolved on a microtask. The integration test with
  real RPC found the OOM spin; the rest needed code read specifically for what the tests
  could not reach.

- **Speculation must not become a vote (Phase 7).** Returning the first arrival and
  discarding the other copy unexamined lets timing choose between two different answers.
  The winner may return immediately, but the loser has to be *compared* — after every
  shard settles, which costs nothing — and a copy that never answers is `uncompared`,
  never "agreed".

- **A documented bound is not an enforced one (Phase 7).** The coordinator's header
  promised silence gets a bounded wait while the code never read `expiresAt`. Grep for
  the mechanism whenever a comment states a guarantee.

- **Never race a timer that provably cannot act (Phase 7).** The straggler watchdog
  re-wrapped every pending promise per iteration and kept polling after speculation
  became impossible; against real I/O that is unbounded allocation, not a slow loop.
  Fake-dispatch tests cannot show this class of bug.

- **Discovery is an intersection, and each part is worthless alone (Phase 6).** Who
  holds the block, who the node is, and what it can run come from three independent
  sources — content routing, a provider-signed certificate, a node-signed capability
  record. The self-signed record looks like theatre until you see what it is bolted to;
  a test mints a valid one for an uncertified key and shows it buys nothing. Splitting
  it lets a node re-sign locally when its engine changes.

- **Every exclusion is named (Phase 6).** Silent filtering leaves a requestor unable to
  tell a dead network from a wrong clock from a module nobody can run.

- **The power-of-d sample is derived, not drawn (Phase 6).** Rendezvous ranking on the
  shard id instead of `random()`: same load result, but two requestors racing on one
  shard converge, re-placement re-derives the same candidates, the tail is already the
  re-pick list, and a decision can be replayed from its inputs.

- **Load is a hint; the offer is the authority (Phase 6).** `LocalCapacity` takes no
  ports and makes no calls, so "local information only" is a property of the type. A
  refusal is not an error path — it is how a stale guess becomes a correct decision.

- **A probe needs its own deadline (Phase 6).** An unreachable node cost a full RPC
  timeout before the re-pick, destroying the saving power-of-d exists to buy. Offers
  carry a 2s deadline and silence is a *stated* refusal. Only the wired-up test could
  find this — a unit test's admission callback returns immediately.

- **Attestation strength is derived, never declared (Phase 6).** owner-attested /
  owner-domain / independent, computed from certificates. Owner-domain and independent
  both show two replicas, so the count cannot distinguish them and the label must travel
  with the result.

- **Derive topology, never agree on it (Phase 5).** The reduce tree is a pure function
  of sorted partial CIDs, so every participant computes the same one with zero
  messages — no leader election, no consensus, nothing to lose. Assignment is HRW, and
  the ranking *is* the fallback list. Repair is recompute from CIDs, not state
  transfer; a late duplicate dedupes into nothing.

- **Associativity is the reduce contract; commutativity is not (Phase 5).** An earlier
  comment claimed both were required and justified it wrongly — a probe showed an
  order-dependent reducer breaks nothing, because grouping is canonical. The
  bit-identical single-node reference test is what enforces associativity.

- **Sovereignty is structural, never a preference (Phase 4).** `planPlacement` narrows
  to the owner's nodes *before* load is consulted; there is no branch that widens it.
  A sovereign shard with nowhere to run stalls. Verified by adding the forbidden
  relax-under-pressure branch and watching four tests fail.

- **Authorisation runs before execution, and the test proves the ordering (Phase 4).**
  A node that executes and *then* refuses has already read the data, so the test
  asserts the executor was never called, not merely that the reply said "unauthorized".

- **Integrity is not provenance (Phase 4).** A CID proves bytes match a hash; it says
  nothing about who published them. Nothing executes a bare CID — names resolve through
  signed records from anchors pinned at construction, and the resolver has no method to
  learn a new one.

- **A blockstore adapter must not alias its input or its storage (Phase 3).** Found
  by the conformance suite in `MemoryBlockstore`; the persistent adapters copy, so an
  aliasing in-memory adapter made kernel tests pass on semantics no real backend has.

- **Conformance vectors are hardcoded literals, never computed (Phase 3).** A
  computed expectation only proves an implementation agrees with itself.

- **The kernel must never need `crypto.subtle` (Phase 3).** A LAN origin
  (`http://10.144.82.249:5173`, `http://laptop.local:5173`) is *not* a secure context,
  so WebCrypto is absent. `multiformats/hashes/sha2` uses it, which silently broke every
  CID on any non-localhost page — while the node still *started*, so it failed at the
  first block rather than at join. Hashing is now `@noble/hashes`, pure JS. The
  import-scanning purity tests cannot catch this class of bug; a dedicated browser test
  removes `crypto.subtle` and requires the hashing path to survive.

- **A browser cannot do mDNS (Phase 3).** No API, any browser. LAN discovery is
  therefore: one URL (preferably the machine's existing `.local` Bonjour name, which
  iOS resolves natively and which survives DHCP churn), after which the page fetches
  `/bootstrap.json` from *its own origin* and is told to dial the same host it already
  reached. Nothing hardcoded, nothing guessed from network interfaces.

- **A relay's browser capacity is capped by inbound limits, not reservations (Phase 3).**
  `INBOUND_CONNECTION_THRESHOLD` is 5 **per host** and
  `MAX_INCOMING_PENDING_CONNECTIONS` is 10 — both below the 15 reservation default.
  Per-host matters in production too: every volunteer behind one NAT shares the budget.
  Exceeding either kills the noise handshake and looks like a network fault.

- **A duty cycle must serialize to mean anything (Phase 3).** Shards dispatch
  concurrently, so per-task yielding lets every yield resolve at once and the cap is
  bypassed. `GovernedExecutor` serializes while throttled, and only while throttled.

- **A relayed circuit cannot carry a job (Phase 3).** The relay is a signalling
  channel; the data path is WebRTC. A test that runs a job over `/p2p-circuit` is
  testing an unsupported configuration.

- **Packages form three tiers (Phase 3).** `core`/`net` portable — no platform *and no
  libp2p*; `libp2p`/`browser` dual-target — libp2p but no `node:`; `node` anything.
  Enforced by `purity.node.test.ts`.

- **Wire framing is uniform across transports (Phase 2).** One stream per message, completion signalled by the sender closing its write end — so no length prefix and no framing state machine. Chunked at 16 KiB with `runOnLimitedConnection: true` even on TCP, so the same path survives relaying in Phase 3.
- Part I (elfconv AOT) sequenced last and run as a parallel track; it must not block the capacity-scaling thesis.

- **Consent is a value, not a check (Phase 9).** `GrantedConsent` is minted only by
  `grantConsent` and `start` takes one, so "check consent before starting" is not a
  rule anyone has to remember. The obvious `if (hasConsent())` is exactly the shape
  that has failed twice here — a documented bound nothing enforced.

- **A stop that resolves the caller is not a stop (Phase 9).** Rejecting pending
  promises makes termination look instant while the thread keeps burning. Only a
  test that messages the thread directly, past the executor, can tell them apart.

- **Cooperative stopping cannot exist for WASM (Phase 9).** A synchronous `run()`
  admits no flag, no duty cycle and no governor. Off-main-thread execution is not an
  optimisation here, it is the requirement.

- **A metric must publish its own blind spot (Phase 9).** A node that cannot reach a
  peer cannot report that it cannot reach a peer, so the reported population is never
  the visited one — and that gap *is* the cliff being measured.

- **Overlapping views are merged by maximum, never by sum (Phase 9).** Asking eight
  peers for the same population and adding would multiply every sample size by eight
  while leaving the percentages unchanged: a correct-looking rate over a fictional n.

- **Chromium throttles timers in a background tab (Phase 9).** Measured: 400 ms poll,
  one tick per second. Anything a visible surface depends on must be pushed.

- **A cube must fix the *constrained* variables (Phase 9).** Splitting on the first k
  values split the work without splitting the difficulty, because the lowest values
  are the least constrained. Ordering by constraint degree is what makes more nodes
  reach further rather than merely reach faster.

- **`exhausted` and `budget` must stay different answers (Phase 9).** One is a proof,
  the other is a shortage of compute. Conflating them turns a limit into a false
  mathematical claim.

- **"Was not run" is not "works" (Phase 9).** DEMO-01's multi-machine half was about
  to be closed by reasoning from Phase 3's transport proof. Running it found two
  real defects instead — one of which every multi-tab test had structurally been
  unable to catch, because they all dial from the harness.

- **Assert what is on screen, not what the attribute says (Phase 9).** An id rule
  setting `display` outranks the browser's own `[hidden]`, so `getAttribute` was
  right while the element was visible. `isVisible`, always.

- [Phase 11]: A hook's absence is a value the call site writes (named sentinel literal), never an omission the type system tolerates — same shape as Phase 9's GrantedConsent. — AgentOptions's six hooks moved from optional to required unions with sentinel literals, closing the hole where an omitted hook silently defaulted to allow/empty/accept and made no fact recordable.
- [Phase 12]: not-enough-executors retired; a shard below requested redundancy is placed at what is available and marked degraded on ShardResult/JobResult instead of failing the whole job
- [Phase 12]: submitJob's placement now runs entirely through sovereignty.ts's planPlacement/eligibleNodes, correlating Executor to NodeDescriptor by nodeId; no other code path in submit.ts selects a node
- [Phase 12]: guardSovereignty is a pure Executor adapter (no Executor/AgentOptions port change), mirroring GovernedExecutor's shape
- [Phase 12]: Added a DATA-09 replica-holder test beyond the plan's four (Rule 2): a canExecuteSovereign:false node whose data genuinely exists in the shared blockstore is still excluded from execution, proving the refusal is about clearance, not missing data
- [Phase 12]: parseRequest refuses an exec request with no label; Task.label stays optional in-process, only the wire boundary enforces it — Correction 2: an absent label reaching guardSovereignty is a no-op, trusting whoever dispatched the task not to omit the field the refusal depends on
- [Phase 12]: guardSovereignty wired into both fabric-node.ts and browser-node.ts production constructors, defaulting to cleared-for-nobody — Correction 1: guardSovereignty had zero production callers before this plan, the exact built-not-wired shape the v1.0 audit exists to catch
- [Phase 12]: Plan 12-03 (skipped by the orchestrator in Wave 2/3) closes the exact gap the Phase 12 verification pass found: submitJob's sovereignty-pinned placement is now proven across three real bin/agent.ts operating-system processes, not only in-process. bin/agent.ts gained --owner-id/--can-execute-sovereign CLI flags (a pass-through of the existing FabricNodeOptions.sovereignty option) so a spawned process can be cleared for its own owner; the required widen-under-pressure mutation failed as expected (insufficient, not agreed) and revealed a second, independent defense already holding: the mutated process's own guardSovereignty wrap refused the wrongly-widened dispatch.
- [Phase 13]: registerSovereignInputs composed outside guardSovereignty, not inside — registering a task guardSovereignty is about to refuse is harmless, keeps composition order identical at both Plan 13-02 call sites
- [Phase 13]: submitJobWithEgress delta-slices EgressGuard.manifest.entries before/after submitJob rather than calling reset(), so job-scoped manifests compose with concurrent reads instead of discarding shared history
- [Phase 13]: egress is a new field on FabricNode/BrowserNode, not a type change to transport — EgressGuard lacks .stop()/.peers that existing callers (including packages/browser/demo/main.ts) depend on
- [Phase 13]: Both node factories now compose registerSovereignInputs(guardSovereignty(inner, sovereignty), {blockstore: store, guard: egress}) identically — the sovereignty default is resolved exactly once per start() call, feeding both the guard's ownerId and the clearance check
- [Phase 13]: Sovereign test fixtures must be pre-seeded onto the executing node's local-only store before dispatch, not just onto the requestor's store -- registerSovereignInputs reads only the local tier and silently skips registration otherwise, which would make a falsification test pass vacuously
- [Phase 13]: Mutation 2 (removing the EgressGuard transport wrap) breaks all four production-wiring tests, not only the one the plan named -- reported as observed rather than narrowed to fit the plan's prediction

- **[Phase 13.1] A reservation with no release is a leak, so the reservation moved to the
  branch that has one.** `LocalCapacity.offer` reserved a slot that nothing on the wire ever
  redeemed — a liveness probe would have leaked one slot per peer per call — so the `offer`
  branch became `LocalCapacity.would`, which reserves nothing, and the slot is now taken in
  the `exec` branch before the `try` and released in a `finally` that covers success, a
  failed outcome, a throw, and the `authorize` refusal that never calls the executor at all.

- **[Phase 13.1] That deliberately removed cross-shard over-commit protection, and it is
  Phase 18's to rebuild.** `placeWithOffers` rebuilds `pool` per request, so the reserving
  offer branch was the only thing bounding placement *across* shards. `planWithOffers` +
  `rpcAdmission` will now put all N shards of a job on one node with `maxConcurrent: 1`.
  `packages/net/src/discovery.test.ts` pins this as a recorded consequence — four shards on
  one 1-slot node, zero refusals — and **that test is expected to turn red when Phase 18
  closes criterion 2c.** Do not "fix" it before then. The two candidate mechanisms, both
  protocol changes, are in `agent.ts`'s own comment.

- **[Phase 13.1] A cap applied after the loop has already paid for the allocation it
  exists to prevent.** `readMessage` accumulated every peer-sent chunk and then allocated
  their sum, both peer-driven and neither bounded; the check now sits *inside* the
  `for await`, immediately after the byte count grows, and calls `stream.abort()`. That
  placement is the whole content of NET-08 — a 64 MiB frame was accepted over the real
  transport before it.

- **[Phase 13.1] `'sender'` is a third `DispatchOutcome.kind`, because a connection the
  sender tore down is not a failure of the receiver.** Produced only from a
  `SendRefused`; `coordinator.ts`'s single policy read is unchanged and its fall-through
  carries a comment saying it is a decision rather than an omission.

- **[Phase 13.1] A pre-scan is the same check, earlier — not a weaker one.** `EgressGuard`
  gained `violationIn(frame)` (pure query, records nothing) and `refuse(to, frame)`
  (records on a hit only). Scanning a reply *body* suffices because `contains` is a
  contiguous-run search and dag-cbor encodes a byte string as a header plus raw bytes, so
  the payload is the same contiguous run once nested. `refuse` records only on a hit
  because it may be asked about a frame never offered to the exit; recording clean answers
  would count every reply twice.

- **[Phase 13.1] The pre-change capture was planted, watched, and restored by `cp` with
  `cmp` exit 0 — no `git` write command.** The proof the restore was byte-exact is that
  `git status --porcelain` afterwards listed only the new untracked test file. Worth
  copying: on a shared working tree a `git checkout --` to "restore" is how another
  session's work gets destroyed.

- **[Phase 13.1 — CORRECTED 2026-08-01] The hook is `AgentOptions.capacity`; `admission`
  is the instrument.** This line used to read *"the hook is named `admission`, not
  `capacity`"* and that is wrong — `agent.ts:171` declares
  `readonly capacity: LocalCapacity | 'accepts-every-offer'`, and `admission` is the
  local holding what `capacity.offer()` returns, plus `FabricNode.admission` as the
  high-water instrument. `fabric-node.ts:365` explains why the two names differ.
  **A second error rode along with it:** `LocalCapacity.offer` *does* reserve
  (`placement.ts:372-378`). What reserves nothing is `serveAgent`'s **`offer` request
  branch**, via `would`. Both errors were propagated into a Phase 16 executor's brief
  verbatim; following them literally would have renamed the wrong symbol. A note that
  compresses two names into one sentence is how that happens.

- **[Phase 14] A guard wrapped at every construction site, not at one resolution point.**
  The plan opened by correcting its own earlier draft: **three** `Executor` implementations
  independently turn `task.moduleCid` into bytes — `core/src/executor/wasm.ts`,
  `browser/src/worker-executor.ts` and `aot/src/wasi-executor.ts` — so "one resolution
  point" was false and the guarantee `guardModuleProvenance` carries is composition at
  every site instead.

- **[Phase 14] A census that counts call sites cannot tell a composed guard from a
  decorative one.** Deleting `provenance(...)` from `browser-node.ts` turns two tab
  refusals red while `trust-anchors.node.test.ts` stays **20/20**, because
  `guardModuleProvenance(` is still textually present, just applied to nothing. Recorded
  as M28. This is the same shape as the disclosure gate's pattern that matched nothing and
  read green — a text census answers "is it mentioned", never "is it wired".

- **[Phase 14] `trustAnchors` is required and typed `readonly PublicKeyHex[] |
  'runs-unsigned-artifacts'`**, on both `FabricNodeOptions` and `BrowserNodeOptions` —
  Phase 11's sentinel convention. `TabApi` deliberately exposes **no opt-out at all**:
  there is no value a page or a Playwright harness can pass through `window.o2` that
  yields a tab resolving bare CIDs. All 22 uses of the opt-out are inside `*.test.ts`;
  `bin/agent.ts` has no off-switch.

- **[Phase 14] "Built, not wired" has a measurable signature, and it was measured in both
  directions.** Before the phase, emptying both demo trust-anchor sets changed nothing
  across fifteen e2e tests. After it, the same plant takes the colouring job down.
  Recorded as M29 — the one ledger entry that pins a *change* rather than a guard.

- **[Phase 14] A `not.toContain` never observed as a `toContain` is a silence, not a
  reading.** Criterion 2's "before `WebAssembly.instantiate`" rests on two instruments —
  an in-process call counter and a cross-process blockstore-directory census — and the
  verification required each to have been seen taking **both** values. The cross-process
  one is upstream of instantiation: the block never reached the agent's disk.

- **[Phase 14] Corrections do not propagate between sibling plans.** 14-03 corrected six
  wrong `file:line` facts in its own plan; 14-05's plan, written earlier, then restated
  one of those same corrections verbatim. A correction living in a SUMMARY reaches nobody.
  Feed each wave the prior wave's corrections explicitly, and verify every citation before
  relying on it.

- **[Phase 15] Plan citations drift far worse than anyone assumed: 41 wrong `file:line`
  references across four plans** (6, 9, 14, 12). These plans were written weeks before
  they ran. Two were wrong rather than merely stale, and both would have shipped a false
  statement into source: `purity.node.test.ts:167-174` does **not** keep the `Executor`
  port narrow (it is the "no dependency edge from `@o2/core` to any adapter" test, and the
  string `Executor` appears nowhere in it), and **no test in this repository asserts the
  `Executor` port carries no chain**. Assume every citation in an unexecuted plan is stale.

- **[Phase 15] A wave field can lie where `depends_on` cannot.** Phase 15's four plans all
  declared `wave: 1`, which would have launched four agents into a chain where 15-03 needs
  01 and 02 and 15-04 needs all three. Derive waves from `depends_on` and from
  `files_modified` overlap, never from the `wave` field alone — 15-01 and 15-02 also both
  write `packages/net/src/index.ts`.

- **[Phase 15] "It cannot be tested" survived four plans and was false.** Every plan
  repeated that `BrowserNode.start` "needs a real `indexedDB` and a relay to dial, so it
  runs in neither vitest project", and the browser tier's authorizer went unproven because
  of it — a scrambling mutation left 345 browser tests green. The true statement is
  narrower: the **`browser`** project cannot host it, because a Circuit Relay v2 server
  cannot run inside a browser; the **`e2e`** project can, and `two-tabs.e2e.test.ts`
  already did. 15-05 closed it there, and needed no relay at all — a relay exists to let
  two browsers exchange SDP, and there is one browser in that test. **Six shipped comments
  carried the false claim, one of them sitting directly on the authorize hook.**

- **[Phase 15] A refusal that names the wrong thing is a defect even when the job
  correctly fails.** M30's mutated tab still refuses — at a different precedence step,
  naming the owner *key* where the owner *id* belongs. Any assertion of the form "the job
  failed" passes against it. Assert the refusal **text**. The same trap caught 15-03: a
  node with no `sovereignty` option resolves to `ownerId: ''` and falls through to a
  different `unauthorized` refusal naming the same peer.

- **[Phase 16] A fabric cheaper than the real thing cannot observe a gate keyed on the
  real thing's configuration.** `agent.ts` refused every combine on any node holding a
  real `Authorizer`, and both node classes install one — so combine never worked in
  production, from the moment the branch was written. Plan 16-02 could not see it because
  every in-process fabric it tested builds `serveAgent({...SENTINELS})`, and the sentinel
  is exactly what the branch keyed on. **Two plans hit it independently** (16-03 from
  spawned processes, 16-04 from the benchmark) and **neither took the cheap way through**:
  16-03 refused to change an auth path outside its scope, 16-04 refused to pass the
  sentinel to `FabricNode` to make a benchmark row appear. Sibling of the Phase 15 lesson
  and a stronger form of it.

- **[Phase 16] The gate's premise was true when written and one phase later was not.**
  Its comment read *"Every production call site passes the sentinel today, so this is a
  no-op now."* Phase 15 installed real authorizers and falsified it silently. **A comment
  asserting a fact about every call site is a claim with an expiry date**; if it matters,
  a test must hold it, because nothing else will notice when it stops being true.

- **[Phase 16] Routing combine through the `Authorizer` made a security property worse,
  and that was measured rather than argued.** The old refusal had incidentally bounded
  combine fetches to zero on any real node. Removing it widened the residue to every
  node — and `authorizeCapability` admits every combine, because the frame carries no
  sovereignty label and no node exposes an `authorize` option. Owner ruling: bound it at
  the `capacity` hook, because combine partials are outputs of public map tasks and
  therefore public by construction — **there is nothing to authorize; the exposure is CPU
  and transfer, which is a capacity question.** Closed in 16-06.

- **[Phase 16] The read count, not the reason string, is what proves a bound's placement.**
  16-06 planted its cap *below* the fetch loop: both refusal-text assertions stayed green
  while reads went 0 → 2. The reply is byte-identical in both placements. Same shape as
  NET-08 — *a cap applied after a loop has already paid for the allocation it prevents.*

- **[Phase 16] A mutation entry can be caught in substance and still be wrong.** The full
  run found `M2b` catching its defect while its recorded signature says *"four sentinels"*
  where the test says *"three"* — drifted in Phase 15 and unnoticed since. The cheap guard
  checks that `find` still matches; it does not check that `signature` still does.

- **[Phase 15] Naming a defect is not fixing it (owner ruling, 2026-07-31).** Plan 15-04
  amended Phase 15's goal down to the truth — correct — and then proposed accepting
  AUTH-03's requestor half as entry-point-unreachable. Declined. Recording a built-not-wired
  adapter in three places is not the same as wiring it; it went to Phase 23 criterion 5,
  where `bin/bench.ts` is already being rewritten and the most contended file in the
  repository is fought once rather than twice.

- **[Phase 25-04]: Ed25519 dual-port adapter (noble/libsodium sync, subtle/libsodium
  async) shipped complete and tested but unwired — verifyChain/verifyCertificate
  wiring deferred to a future phase pending a bootstrap-ordering decision across three
  runtime entry points.**

### Pending Todos

**⚠ OPEN DEFECT NEEDING A DECISION — `PeerVerifier` settles a verdict once and never
revisits it (found by 17-06, 2026-08-01, deliberately not fixed).** *(CLOSED — SUPERSEDED
2026-08-22. The ruling was taken and executed on 2026-08-14 at `e1088ce`, and the shape it took
is none of the three candidates listed below exactly: re-ask on read, bounded by `FINAL` plus a
retry floor. `verifiedPeers`
(`packages/libp2p/src/peer-verifier.ts:469-473`) calls `#refresh` for every connected peer on
every read; `#refresh` (`:517-541`) re-issues `verify` for a peer with no settled verdict and
for any standing refusal whose kind falls outside `FINAL` (`:260-269` — `unreachable`,
`no-records` and `expired` are all outside it), bounded only by `DEFAULT_VERDICT_RETRY_FLOOR_MS`
at 5,000 ms (`:286`, `:400`). `#demoteIfExpired` covers the other direction, dropping an
acceptance the instant its certificate's `expiresAt` passes. The getter is read per fetch on
both tiers — `fabric-node.ts:2366,2381` and `browser-node.ts:1543,1598` — so a node that enrols
after a peer connected to it is taken back within one floor interval rather than excluded
permanently. Measured at `packages/node/src/peer-verifier.node.test.ts:670-815`, "a peer that
enrols after connecting stops being excluded". The paragraphs below are kept because they record
the observation and the three candidate fixes the decision chose between.)*

`PeerVerifier` decides a peer's verdict on `peer:connect` and never asks again. **So a node
that enrols *after* a peer has already connected to it is permanently excluded by that
peer.** Observed directly, not inferred: an enrolled tab holding a valid certificate sat at
`'not asked yet'` for 20 s. It is **not browser-specific** — `FabricNode` also dials its
provider before `serveAgent` is up, so the same window exists on the Node tier.

Held under Rule 4 because every candidate fix changes how often a node re-asks its peers
across the whole fabric — re-ask on a timer, re-ask on a records-changed push, or re-ask on
first refusal. That is a fabric-wide behaviour decision, not a bug fix, and it interacts
with Phase 18's discovery work. **Decide before Phase 18 plans, because 18 owns the dial
path this defect lives on.**

**Also from 17-06, and it corrects 17-04:** `PeerVerifier` should **not** move to
`@o2/libp2p`. 17-04's portability half was right (no Node-only imports) and its
"one-file fix" half was wrong — `@o2/libp2p` does not depend on `@o2/net`, which
`PeerVerifier` imports four symbols from, so it is six files. Left in place for the stronger
reason: no browser consumer exists, and **an export with no traced call path is exactly what
Phase 22's guard fails on.**

*(SUPERSEDED 2026-08-22 — `PeerVerifier` did move, on 2026-08-14 at `e1088ce`, as AUTH-02's
browser-pinning leg. It lives at `packages/libp2p/src/peer-verifier.ts` and is exported from the
`@o2/libp2p` barrel at `packages/libp2p/src/index.ts:69`, deliberately not re-exported from
`@o2/node`; the move is recorded at `packages/node/src/index.ts:32`. **Both grounds above were
false by the time it landed.** `@o2/libp2p` does depend on `@o2/net` —
`packages/libp2p/package.json:16` declares `"@o2/net": "*"`, an edge the file's own docblock names at
`peer-verifier.ts:154-157` as the first of "the two prices... both were paid, not avoided". And a browser consumer does exist: `packages/browser/src/browser-node.ts`
imports `PeerVerifier` at `:76` and calls `PeerVerifier.start({...})` at `:1525`, which is the
traced call path Phase 22's guard wanted and the wiring the move existed for. Of this
paragraph's factual clauses only one survives — the module does import four symbols from
`@o2/net` (`RpcFailure`, `encodeRequest`, `parseResponse`, and the type `RpcEndpoint`, at
`peer-verifier.ts:192-193`). `@o2/net` itself remains an impossible destination:
`packages/node/src/purity.node.test.ts:94` forbids `/^@libp2p\//` across the `PORTABLE` set
(`:45`, which includes `net`).)*

**Scheduled work carried out of 13.1's and 14's verifications (2026-07-31):**

- **DATA-10's at-rest half — owner-scheduled, not deferred.** A node still serves a raw
  sovereign block once the job that registered it has ended: `submit-with-egress.ts:155`
  takes the registration and a `finally` releases it. Close it at a boundary the node owns
  — a per-node set of sovereign CIDs that outlives the job — rather than at one entry
  point. The second half, that bare `submitJob` registers nothing at all, folds into
  **Phase 20**, where `submitJob` becomes the single job path and the fix lands at one
  boundary instead of two. `sovereignty-placement.node.test.ts` currently drives a real
  spawned-agent sovereign scenario through bare `submitJob` and **passes because the gap
  is real**. *(CLOSED 2026-08-02 — SUPERSEDED 2026-08-22. Both halves landed at the one
  boundary this ruling asked for, and neither went to Phase 20. The durable per-node set is
  `FsSovereignCids.open(options.blockstoreDir)` (`packages/node/src/fabric-node.ts:2311`, class
  at `packages/node/src/sovereign-cids.ts:41`; `IdbSovereignCids.open` at
  `packages/browser/src/browser-node.ts:1575`), handed to `egressDisposition` and read by CID
  before any payload scan at `packages/net/src/agent.ts:1171-1177` and
  `packages/net/src/sovereign-egress.ts:205` — so the refusal outlives both the job and the
  process, measured at `packages/node/src/sovereign-at-rest.node.test.ts:176`, "still refuses
  after the process that recorded it is gone". Bare `submitJob` registers at its own
  blockstore-put (`packages/core/src/job/submit.ts:2668-2672`), which covers every caller that
  supplies the set rather than only the guarded wrapper; production callers do supply it
  (`packages/node/src/bin/agent.ts:2397-2402`, `packages/browser/demo/main.ts:2392`). What
  survives is narrower than the bullet above: a node built with no `blockstoreDir` takes the
  named opt-out `'forgets-sovereignty-between-jobs'` and does still serve after the job, by
  design rather than by omission, and `sovereignty-placement.node.test.ts` does still call bare
  `submitJob` without the set — but it asserts placement and never asserted egress, so it was
  never the standing evidence the last sentence made it. Ledgered `[x]` at
  `.planning/REQUIREMENTS.md:1116` and **Done** in the traceability row at `:1393`; see this
  file's own DATA-10 paragraph under Current focus.)*

- **Two load-sensitive bounds, same family.** `churn.test.ts`'s 30%-killed case failed once
  at load 17.5-59.4 and passed 3/3 in isolation; `transport-bounds.node.test.ts`'s
  retained-bytes bound failed twice at load ~12.4 and passed at 8.72 and 7.70. Both are
  wall-clock bounds inside otherwise deterministic tests — a bound that reads host
  contention as a defect. Recorded in `phase-14-.../deferred-items.md`.

- **Closed on 2026-07-31, listed so it is not re-found:** the `stopAgent` hookTimeout
  inversion in `two-process`, `sovereignty-placement` and `egress-refusal` — a 10 s
  SIGKILL fallback inside Vitest's 10 s default `hookTimeout`, so the fallback could never
  fire and a wedged agent reported an anonymous timeout naming no step.

**Two open owner decisions**, both deferred with the measurement they were waiting for now
in hand.

1. **The `lift.node.test.ts` integration timeout.** `INTEGRATION_TIMEOUT_MS` is 15 min and
   wraps 45 min of internal budget (a 5 min compile plus 2 × 20 min `DEFAULT_TIMEOUT_MS`) —
   the outer clock is the smaller one, so the inner budgets can never fire. A real lift is
   now measured at **152.7-304.3 s**, a 2× swing with load, so any fixed budget must be
   sized against the top of that range and not the middle. An earlier attempt to set it to
   300 s turned six tests red and was reverted.

2. **The benchmark's row-order confound.** Load drifted 29→49 during a run, so no
   inter-row difference under ~20% is claimed. Fixing it needs interleaved rows rather
   than blocks, or a quiet host.

Four smaller follow-ups recorded during the 22-bug round, none load-bearing:
`SpeculationLedger.discarded` has zero readers; `submit.test.ts:79-206` duplicates
`verify.test.ts`; the `agreed` outcome carries no `failures` field *(CLOSED 2026-08-05 at
`0e045f5` — SUPERSEDED 2026-08-22. It does carry one: `failures: readonly { nodeId: string;
reason: string }[]` is declared on the `'agreed'` arm at `packages/core/src/job/verify.ts:187`
and returned by `executeVerified` at `:269`, the same array the `disagreed` and `insufficient`
arms return, computed once at `:226`. The field's own docblock at `:157-186` records the fix —
"on the agreed arm too, and that is the whole of the fix" — and every other `agreed`
construction site carries it: `commit-reveal.ts:469`, `submit.ts:1577` (`failures: []`, with a
comment explaining the measured zero) and `submit.ts:1721`.
Listed so it is not re-found.)*; and
`classifyStartFailure` can only ever return `other` for an unreachable relay.

### Blockers/Concerns

**Three items are owner-blocked and unaffected by the 2026-07-28 testing-standard ruling:**
the US provisional patent deadline (below), a hosted relay with real AutoTLS (NET-03,
Phase 3 criterion 2), and GitHub Pages serving the pre-Phase-9 bundle (below). *"A second
machine"* used to be a fourth. It is not a blocker any more — it has been struck, and its
residual is recorded immediately below rather than dropped.

- **What the lifted-vs-native benchmark costs Phase 21 (measured 2026-07-31).** Timing
  `wasi.start()` alone, on a 32 MiB memory-and-ALU workload that all three routes agree on
  (checksum `9584708361817009923`): native 58.78 ms, direct-compiled WASM 65.19 ms (1.11×),
  elfconv-lifted WASM 122.81 ms (**2.09×** native, 1.88× direct). That is the emulation
  tax, and it is the honest number to plan AOT-04 against.

- **The ~43 ms startup floor cannot be cached away, and this was tested rather than
  assumed.** On a trivial subject the lifted `_start` alone is 42.83 ms and
  instantiate+start is 42.65 ms — indistinguishable, so the entire floor executes *inside*
  the guest, in elfconv's emulated machine-state init, and is re-paid per task. Compile
  (~4 ms, and V8 compiles lazily) and instantiate (~1.8 ms) are not where it lives. Direct
  WASM's `_start` for the same program is 0.03 ms, ~1400× less. Content addressing fully
  solves distributing the 5.40 MiB artifact — which is 5.40 MiB whether the program does
  nothing or 128 MiB of traffic — but the floor stays, and under N-version execution it is
  paid per replica, which puts a floor on useful shard size. AOT-05 independently recorded
  V8's WASM code cache as NOT OBSERVED, so that route is closed twice over.

- **Residual of the same-machine testing standard (owner ruling, 2026-07-28) — recorded,
  not blocking.** Same machine, different browsers and/or different browser contexts and
  different OS processes, is the project's testing standard everywhere. So no criterion of
  this project's own is waiting on a second machine. The residual is that
  **cross-machine reproducibility (AOT-03) and distinct-machine benchmarking (BENCH-06)
  are unverified by choice**, and closing either would need hardware the project does not
  have. Both requirements were rewritten to what one host genuinely establishes; **neither
  descoped half may be reported as demonstrated.** `CROSS_MACHINE_BLIND_SPOT` stays on
  every lifted artifact — Phase 10 showed it is structural, not configurational — and the
  same-machine benchmark label stays required and derived from the recorded inventory.

- **Relay hosting investigated 2026-07-28 — Cloudflare cannot carry the relay, and the reason
  is structural.** Confirmed verbatim from Cloudflare's docs: *"it is not possible to make an
  inbound TCP connection to your Worker"*, and no Cloudflare compute product exposes UDP (which
  independently rules out WebRTC-Direct). The codebase already refuses the deployment on its own
  terms — `canRelay` (`fabric-node.ts:289`) is false without a non-circuit listen address, so
  `circuitRelayServer()` is never added and the reservation limit is 0.

  - **Correction to the first pass, which was wrong:** Cloudflare **Containers** are *not* ruled
    out by transport. A container is a real Linux process on a real port and
    `@libp2p/websockets`' Node listener runs unmodified; the `browser`-condition stub that kills
    workerd does not apply. Containers fail on **lifecycle** instead — no minimum uptime
    guarantee and irregular restarts against a 2-hour reservation TTL (`constants.ts:68`), and a
    relay can never re-dial a browser to recover. Cost was also wrong in both directions: wall-
    minutes are not vCPU-minutes (a `lite` instance is 1/16 vCPU), and the Durable Object figure
    double-counted — 331,776 GB-s is *inside* the 400,000 included, so ~$0 marginal duration.

  - **Recommendation:** a small always-on host with a public IP and arbitrary port binding.
    **But the sizing must carry a full node, not a relay daemon** — `fabric-node.ts:394-396`
    records that no construction path yields a node which will not compute, and `bin/seed.ts:45`
    says the seed executes tasks, serves blocks *and* relays. A relay-only budget reintroduces
    the class that was deleted, which the module comment notes already *"survived three rounds
    of renaming."*

  - **Two defects found incidentally, both fixed 2026-07-28.** The disclosure gate's wrangler
    pattern missed `wrangler pages deploy` — the command someone would actually type — and
    nothing noticed because every test asserted *absence*, so a pattern matching nothing read
    green. Each pattern now carries the commands it must catch and must ignore, asserted
    directly. Separately: `stun:stun.cloudflare.com:3478` is **already** in `@libp2p/webrtc`'s
    `DEFAULT_ICE_SERVERS` and in use, so "add Cloudflare STUN" is a no-op — and pinning to it
    alone would cut four independent STUN operators to one.

  - **Unverified, worth chasing upstream:** `@libp2p/circuit-relay-v2` appears to write
    `defaultDurationLimit` in milliseconds into a protobuf field the spec defines in seconds, so
    a dialer computes 33.3 hours where the server enforces 120 s.

- **Disclosure gate: CROSSED on 2026-07-26.** The repository was made public by explicit
  owner decision, after being told that EPO and China have no patent grace period and
  that the loss is permanent. **EPO and China patent rights for everything disclosed as
  of that date are forfeit.** Do not plan around recovering them. A US provisional
  remains possible for 12 months from first disclosure under §102(b)(1), and that
  window is now running — it is the only patent option left, and it is time-limited.

- **GitHub Pages is serving the pre-Phase-9 bundle.** It was deployed by hand on
  2026-07-26 and has *not* been redeployed since; the consent gate, the running bar,
  the colouring job and the policy page are in the repository but not on that URL.
  Redeploying is a human action by design (DEMO-04) — run `npm run build:demo` and
  publish `packages/browser/dist/` deliberately.

- **GitHub Pages is live** at <https://o2alexanderfedin.github.io/o2.services/>, served
  from the `gh-pages` branch, deployed **by hand** on 2026-07-26. Verified against the
  real URL: loads with zero page errors, correctly reports that no relay is reachable
  with Start disabled, `crossOriginIsolated` false (BROW-05 holding in production), and
  the kernel computes a CID byte-identical to local. It cannot join a peer until a
  public `wss://` relay exists — an HTTPS page cannot dial `ws://`, and Pages runs no
  server process.

- **DEMO-04 still holds, and is now enforced.** No deploy workflow file may exist in
  the repository at all — absent, not disabled — and no `package.json` script may
  publish. `disclosure-gate.node.test.ts` asserts both, checks for workflow files by
  *content* so relocation does not evade it, and is mutation-proved by planting one
  in two places. `build:demo` builds and publishes nothing.

- **Version traps (C5): resolved in Phase 2.** js-libp2p 3.x installed with exact pins; none of the four trap packages are present. Two duplicate resolutions were found and fixed with npm `overrides` — `multiformats` had both 14.0.5 and 13.4.2 (a v13/v14 `CID instanceof` boundary), and an invalid `uint8arrays@5.1.1` was hoisted above the 6.1.1 libp2p v3 needs. **`npm install` alone kept the stale tree; a clean re-resolution was required.** `constants.node.test.ts` now asserts one copy of each plus every relay/transport limit.
- **Doc correction:** the relay constants are named `DEFAULT_DURATION_LIMIT`, `DEFAULT_DATA_LIMIT`, `DEFAULT_MAX_RESERVATION_STORE_SIZE` — `DEFAULT_`-prefixed, unlike what PROJECT.md and STACK.md record. Values are as documented (2 min / 128 KiB / 15 / 2 h).
- **Node 23.11.0 is the host runtime and is not LTS.** Outside vitest's declared range (`^20 || ^22 || >=24`), so every install prints `EBADENGINE`, and `packages/node/src/bin/agent.ts` depends on Node's experimental native type stripping. Everything passes today. `STACK.md` specifies Node 24 LTS — switching the toolchain is a human action, deliberately not taken autonomously.
- **Open decisions carried into planning:** aegir vs. vitest for the three-target test discipline (Phase 2); WASM fuel metering has no maintained JS-side tool (Phase 1/2); Safari + WebRTC-Direct is unverified with a WSS-only fallback branch (Phase 4).

### v1.1 `stopped_at`, preserved at the v2.0 switch (2026-08-25)

The milestone switch also clears the frontmatter's `stopped_at`, which is right — it records
where the *previous* milestone stopped. It was 290 lines, and rather than check line by line
which of it `.planning/HANDOFF.json` and `.continue-here.md` already carry, it is kept whole.
Sampling found four passages from it that appear nowhere else.

<details>
<summary>v1.1 stopped_at, verbatim</summary>

  CURRENT AS OF 2026-08-24, AFTER THE MERGES. v1.1 is closed at 15/15 and the figures below
  still hold; what follows is the work done since, which was on
  `feature/dht-registration-and-discovery` and **is now merged through to `main`** by owner
  instruction — feature into `develop` (`f874f95`), `develop` into `main` (`e75d39f`), both
  `--no-ff` so the history says which branch carried what.

  **All three branches point at one tree, `50599689`, and it is the tree the suites below were
  run on.** That is asserted rather than assumed: the hashes were compared after each merge.
  Merging `develop` into the feature branch first changed **no file at all** — those twelve
  commits were merge commits of material already present at the branch point — so the
  confirmation taken before the merges is a confirmation of exactly what landed.

  **94 commits are unpushed on both `main` and `develop`.** Pushing was not done: it is an
  action outward and was not asked for.

  **This file's frontmatter was found wrong and is restored.** An orphaned working-tree write —
  from a process the 2026-08-24 reboot ended, and machine-shaped rather than hand-written — had
  replaced the reconciliation block below with the one line "context exhaustion at 100%
  (2026-08-23)", set `status` back to `verifying`, moved `total_phases` to 29, and zeroed
  `completed_phases`, `total_plans`, `completed_plans` and `percent` for a milestone this same
  file records as 15/15 with 103 plans. It left the 2 200-line body alone: 235 lines out, 60 in.
  **Said precisely because the first description of it here was wrong** — "cut from 2 397 lines
  to 17" — which was read off the frontmatter preview and inferred rather than measured; the
  working copy was 2 222 lines. It is preserved outside the repo rather than merged in, and the
  figures below are the measured ones.

  **AUTH-04 — a certificate now outlives its first issue.** Nothing renewed one: it was
  obtained once at start and the only route to another was a restart, so a process outliving
  its certificate kept running while every peer demoted it. Three snapshots had to stop being
  snapshots — `SelfRecordIndex`, `RecordPublisher` and each tier's `certificate` field — and
  all three now read one `CertificateHolder`. Renewal begins at two-thirds, deliberately not
  aliased to `lease.ts`, and deliberately stays true after expiry, where `shouldRenew` goes
  false. The renewal timer is clamped to 2^31-1 ms, because `setTimeout` overflows to one
  millisecond rather than saturating.

  **Owner rulings taken 2026-08-24, all three implemented.** Certificate lifetime 30 days to
  **1 hour**, reversing the 2026-08-02 correction recorded in `enrollment.ts`'s own header —
  which drags `DEFAULT_MAX_PER_WINDOW` 32 to 64, because that number was sized on "a returning
  visitor spends nothing in 719 hours of 720" and an hourly certificate inverts it. A change of
  trust anchors is now a **consent event**, with a fourth `ConsentGap` kind. And a certificate
  can announce the key its node will rotate to (`nextKeyCommitment`), as a hash inside the
  issuer's signature — the format lands now because the alternative is changing a signed format
  with certificates in circulation.

  **One certificate system, not two.** `cert-lifecycle.ts` — 775 lines, tested, imported by
  nothing — was deleted by owner ruling, closing what CRYPTO-03 had explicitly left open. Its
  delegation half duplicated `capability.ts`, its identity half `enrollment.ts`, its
  crypto-backend selection was already merged into `ed25519-backend.ts` by Phase 28, and its
  revocation half is refused by standing ruling.

  **DATA-08 — a node with a durable directory now keeps its libp2p state**, and the diagnosis
  that had blocked it for a week was falsified rather than confirmed: ten sound eliminations had
  been assembled into one false claim ("any asynchronous datastore hangs enrolment"), and an
  async in-memory store enrols fine in four different shapes. Peers verified before a restart are
  no longer re-asked, and the cache cannot widen what is accepted because a cached certificate
  takes the same `#accept` a fresh one does.

  **Suite at HEAD:** node 208/208 files and 3 032 tests at `(user+sys)/real` 1.36; browser
  315/315 and 5 286 tests; e2e 38/38 files and 235 tests, all three read at this tree. The `tools/aot` Docker gates fail
  as a group below a CPU ratio of about 1.0 and pass individually — a property of this host under
  contention, measured across five full runs, not a defect in them.

  RECONCILED 2026-08-20, AND THE HEADLINE BELOW IS THE ONE THING THAT WAS WRONG. **THE COUNT IS 15
  OF 15, NOT 12.** All three carried phases closed on 2026-08-18, each by a dated amendment to its
  own verification file rather than by a rewrite: 20 at 7/7 (criterion 7 closed at `ce97bc8`), 21
  at 3/3 (criterion 2's re-tag clause measured), 22 at 3/3 (criterion 1's residue measured to zero
  rather than subtracted). v1.1 "Wire What Was Built" is CLOSED at 15/15 phases and 50/50
  requirements — merged `2c720b9`, milestone merge `af8828f`, corroborated independently at
  `.planning/COVERAGE-BASELINE.md:38` on 2026-08-19. **`.planning/milestones/v1.1-SHIPPED.md` IS
  STALE ON THE SAME POINT and is amended today**: it was archived 2026-08-18 while those three
  closures were still landing, so it records "12 of 15", "40 of 50" and the sentence "15 of 15 was
  never reachable" — which the tree falsified within hours of it being written. **`total_plans: 103`
  BELOW IS CORRECT AND WAS WRONGLY CALLED STALE**: it is scoped to the milestone's own phases (11,
  12, 13, 13.1, 14-24) and those hold exactly 103 plans, counted 2026-08-20. A prior handoff
  compared it against 141, which is the repository-wide count of SUMMARY files — a different
  population, and the reason to say which population a count is over. *(CORRECTED 2026-08-22 —
  141 is the count of SUMMARY files under `.planning/phases/`, not the repository-wide count.
  Repository-wide is 143: `git ls-files | grep -cE 'SUMMARY\.md$'` returns 143 and
  `find .planning/phases -name '*SUMMARY.md' | wc -l` returns 141, the two outliers being
  `.planning/research/SUMMARY.md` and `.planning/quick/20260806-o2-vs-peers-study/SUMMARY.md`.
  Both figures were the same at `e84537c`, the commit that wrote this sentence, so 141 was never
  the repository-wide count on the day it was asserted. The substantive point stands — 103 and
  141 are different populations — and only the label on the 141 population was wrong, in the very
  clause arguing that a count must name its population.)* NOTHING IS IN FLIGHT. Work
  since the milestone close is verification and hygiene, all merged. The open items are owner
  decisions, listed under Pending Todos, and none of them blocks anything. FIELD CHANGES MADE BY
  THIS RECONCILIATION, RECORDED HERE RATHER THAN AS TRAILING COMMENTS ON THE FIELDS THEMSELVES —
  a plain YAML scalar cannot carry " #" without the rest of the line becoming a comment, and
  `state-frontmatter.node.test.ts` caught exactly that on `status` after the first draft did it:
  `status` executing -> milestone_complete; `completed_phases` 12 -> 15; `percent` 80 -> 100;
  `total_plans` UNCHANGED at 103 and correct.
  ----- EVERYTHING BELOW THIS LINE IS THE ACCUMULATED HISTORY OF THE MILESTONE AS IT RAN. It is
  kept verbatim rather than rewritten, because it records how each phase actually closed. Read its
  first sentence as superseded by the paragraph above and the rest as still accurate. -----
  THE COUNT IS 12 OF 15. PHASE 17 CLOSED 2026-08-07 AT 3/3 by a fourth dated amendment, and it
  closed the way RULING A intends: not by a rewrite, and not by transcribing another phase's
  verdict, but by re-running the exact plant that had declined it and watching it redden. The
  2026-08-06 pass had declined criterion 3 for one measured reason - neutralising the
  certificate-to-peer binding in fabric-node.ts's relayAdmissionGate stayed GREEN across 8 files
  and 5 runs, so nothing in the repository would have noticed if the binding stopped. Commit
  8719029 built the missing door test, ledgered M68. THE RE-RUN IS THE PART THAT MATTERS:
  fabric-node.ts's sha256 before planting was d6688f73, IDENTICAL to the digest the declining
  verifier recorded, so the different result cannot be a different file. PLANTED_P1_EXIT=1, the
  door returning false where true denies - it ADMITTED a peer holding somebody else's
  certificate. AND THE BOTH-WAYS PROOF HELD, which is what stops the green being vacuous:
  planting peer-verifier.ts instead left relay-admission green IN FULL while reddening
  peer-verifier's own borrowed-certificate row, so the new case observes the DOOR and not the
  SELECTOR, which is the distinction the decline turned on. TWO LIMITS SIT AT THE VERDICT RATHER
  THAN IN A FOOTNOTE - the borrowed case is measured at the PREDICATE over MemoryNetwork rather
  than at a live reservation, so the close rests on a conjunction with the file's live-relay
  arms; and this is a BOUND PLUS DEVALUATION, not a graduated price, so a reader taking costly
  to require a rising per-identity price gets the 2026-08-01 answer and that reading is
  ESCALATED rather than settled. THE THREE STILL UNCOUNTED ARE 20 (6/7), 21 (2/3) AND 22 - and
  AS OF 2026-08-08 ALL THREE ARE VERIFIED RATHER THAN PENDING: 22 EXECUTED AND SCORED 2/3 at
  fee26c2, 4 plans and 4 summaries, ITS CRITERION 1 DECLINED BECAUSE THE GUARD DOES NOT PASS
  CLEAN. This field read "22 (planned, 4 plans, 0 summaries, runs last)" until then. THE V1.1
  MILESTONE AUDIT HAS RUN and the open work is its gap list, NOT A PHASE: 17 findings, 9 CLOSED,
  G1 (a closed seed is unjoinable by the demo page) the blocker. FOUR OWNER RULINGS WERE TAKEN 2026-08-07 AND THREE
  ARE ALREADY EXECUTED. RULING 1, THE READING OF THE FABRIC in criterion 8: NARROW - a fabric
  this repository can be deployed and operated as, with an admission posture stated on every
  relay-capable door, NOT the default argv. The wider reading was available and would have
  returned criterion 8 to PARTIAL and Phase 19 with it, at a cost of 19 + 3 argv sites made
  refuse-to-start; the owner declined it. So 24 stays 1/1, 19 stays 5/5, and the MET keeps its
  stated bound: the default posture of bin/agent.ts, bin/seed.ts and bin/bench.ts is OPEN AND
  MUST BE, with reservation-exhaustion arm A a live behavioural guard on it, and the
  load-bearing ground is that both option types make relayAdmission required with no default so
  the API cannot express silence - only argv has a default. RULING 5, bin/bench.ts's
  orphan-leash exemption: DELETED, and the exemption's own why had read NO VALID GROUND.
  bin/bench.ts now calls armOrphanLeash and EXEMPT is empty. The stop is a bare exit and that is
  complete rather than lazy - this driver holds no module-scoped node to stop, and its agent
  children do not leak because bench-fabric.ts spawns every one with stdio[0] as pipe precisely
  so fd 0 is the child's own leash, so when the driver leaves those pipes close and each child's
  leash fires. Watched red first: the call deleted, PLANTED_EXIT=1 naming bench.ts by name,
  restored by surgical inverse with shasum back to 4fe2d782. STATED LIMIT: the mkdtemp
  directories are not removed on that path. RULING 4, vitest.config.ts's 923 ms row for a spec
  that measures 20.8-21.2 s: RE-SITED to 21 197, which is option A of the two the 2026-08-06
  pass laid out and declined to choose between. The row crossed SLOW_CUTOFF_MS, so the
  correction is also an EXCLUSION - relay-admission.node.test.ts leaves the pre-commit fast
  loop, and with it the only admission coverage that loop still had. Three derived figures moved
  and each was OBSERVED rather than derived: sumOfFileSpansMs 1 465 924 to 1 486 198 (exactly 21
  197 minus 923, a correction and not an addition), unitFiles 111 to 110, unitTests 1716 to
  1685, unitWallClockMs 25 950 to 24 590, on a green npm run test:unit at exit 0. THE
  DECOMPOSITION WAS MEASURED AFTER A FIRST DRAFT ASSERTED IT FROM THE SUBTRACTION - the net is
  minus 31 but the file alone is 38 passed, so the file leaving is minus 38 and the remaining
  plus 7 arrived in files that stayed; the plus 7 is carried as a stated residual rather than
  absorbed. RULING 3, X.509: ADOPT STANDS, filed as PHASE 25 in ROADMAP.md rather than left in a
  review document, because a ruling that lives only in a doc is a ruling nobody executes. It is
  NOT scheduled into v1.1 - v1.1 is Wire What Was Built and this builds something new. ONE OF
  ITS SEVEN OBLIGATIONS WAS ALREADY DELIVERED and the review's claim about it is FALSE: the
  praxis review says verifyChain currently has no depth bound at all and takes its length from
  the wire, but capability.ts:127 defines MAX_CHAIN_DEPTH = 8 and :190 enforces it BEFORE any
  signature work, with its companion hazard closed at :255 by a reduce rather than a Math.min
  spread. A dated correction is appended to the praxis review rather than edited into it. THE
  OTHER SIX ATTACH TO A PARSER THAT DOES NOT EXIST - no pkijs, asn1js, node-forge or @peculiar
  anywhere in the manifests, and certificates today are Ed25519 over @noble/curves, not DER -
  which is the argument for specifying them before it arrives and is why this is a phase rather
  than a patch. AOT-06 IS ANSWERED AND THE ANSWER IS A LOCATED NEGATIVE. elfconv cannot lift
  x86-64 today, and the gap is NOT instruction semantics - Remill has had amd64 for years, CI
  publishes an :amd64 image, the --arch flag accepts it and the ELF loader classifies it. The
  gap is that lifter/TraceManager.cpp finds main by matching LITERAL AARCH64 ENCODINGS on a
  fixed 4-byte stride with no amd64 branch, then calls elfconv_runtime_error. Measured twice,
  gcc and clang-16, two entry points, both LIFT_EXIT=134 SIGABRT with no bitcode and no wasm -
  but THE VERDICT IS CARRIED BY THE SOURCE RATHER THAN BY THE RUNS, which matters because the
  amd64 image runs emulated on this arm64 host and a byte pattern that cannot match cannot match
  on any host. The previous session's exit 0 with no artifact is explained too: elfconv.sh's
  target case has NO DEFAULT BRANCH, so an unhandled TARGET returns 0 having produced nothing.
  Two hypotheses were REFUTED rather than argued - a missing LLVM dynamic library (ldd resolves
  libLLVM-16.so.1 with zero not-found, and the abort is elfconv's own thrown runtime_error,
  which a loader failure could not produce) and the compiler (the clang control aborts
  identically). Fixing it means WRITING amd64 entry-point discovery, upstream or as a patch
  carried in the submodule: tractable, not small, and upstream has not done it - main is one
  commit ahead of the pinned 5319dd8 and that commit is a dependabot action bump. ELFCONV IS NOW
  A SUBMODULE at third_party/elfconv, pinned to the commit both cached images report, so every
  file:line above is readable with no Docker at all. That required teaching the disclosure gate
  what a submodule is: the submodule ships .github/workflows, DEMO-04 forbids a workflow file
  existing at all, and the exemption is DERIVED FROM GIT'S INDEX (160000 gitlink entries) rather
  than written down, because a hand-maintained list is the population defect this repo has hit
  four times. Two plants watched red. The unmeasured part is named: that GitHub never executes a
  submodule's workflows is a claim about a platform, and proving it needs a push. NEXT IS PHASE
  22, then the v1.1 milestone audit. TWO ITEMS STAY WITH THE OWNER out of the Phase 17 close and
  neither is a criterion-3 gap: the AUTH-02 browser-pinning leg, carried unresolved since
  2026-08-05, and the graduated-cost reading of costly. THIS BLOCK PREVIOUSLY SAID 10 OF 15
  while the handoff said 11 and Session Continuity said 8 - three counts in one file, none of
  them right, which is the defect this milestone keeps finding in its own bookkeeping and found
  here again. AS OF 2026-08-13 THE PHASE COUNTS ABOVE ARE UNCHANGED AND THE WORK HAS MOVED
  OFF PHASES ENTIRELY - the v1.1 audit's gap list and the requirements ledger are what is
  open, and the ledger stands at 79 OF 102 with 23 rows unchecked, verified by counting the
  boxes in REQUIREMENTS.md rather than read off any tool. The 2026-08-12 session closed ZERO
  rows across 62 commits and that is the accurate headline: it was instrument, correction and
  design. Its own findings are in .planning/.continue-here.md and the one that governs what
  happens next is that THREE SCENARIOS AND SIX LEDGER ROWS ARE BLOCKED ON ONE MISSING THING -
  nothing a person can run issues a browser tab a certificate, so certificate stays null,
  trustedIssuers stays empty, and discoverExecutors excludes every provider. Two independent
  analyses reached that from opposite directions, one over rows and one over scenarios. THE
  2026-08-13 SESSION CLOSED NO ROW AND THE LEDGER STAYS AT 79 OF 102, correctly - it was defect
  repair and instrument repair. SIX DEFECTS FIXED, of which two matter beyond their size. FIRST,
  A PROVIDER COULD RETURN A CERTIFICATE ABOUT SOMEBODY ELSE and both tiers persisted it unread,
  while both ALREADY re-check what they load on reload - one sentence describes both ends and
  only one was guarded. Fixed at enrolOverRpc, which is the one place holding both the request
  and the answer and is shared by both tiers; it reads NO CLOCK deliberately, because
  verifyCertificate refuses not-yet-valid on a strict issuedAt > now and a machine one second
  slow would have had an honest certificate refused, fatally on the browser tier. SECOND, THE
  UNWIRED COUNT WAS OVER-STATING THE GAP BY SIX AND NOTHING WAS WIRED TO CORRECT IT: 72/36 became
  71/29 by teaching the call graph three kinds of edge it could not see. core/executeVerified -
  the fabric's N-VERSION COMPARISON, running on EVERY shard dispatch from submit.ts:2971 - read
  as dead code because its caller is a const-arrow and classify only accepted Function|Class|
  Method. Four more are reached through the Executor port so the edge lands on ports.ts#execute,
  one through a proxy trap, and core/describeStartReport is called TWICE INSIDE AN ENTRY POINT
  through await-import destructuring with zero in-edges. THE BEST DECISION WAS A REFUSAL: the
  port-member repair was available as a graph edge and was measured rather than argued - the
  candidate rule reaches demo/estimatePi, the over-connection anchor that must stay red, because
  demo/main.ts builds its api object at module scope. A rule shaped to preserve a canary is not a
  principle, so dispositions with per-symbol machine-checked mechanisms were taken instead.
  OVER-CONNECTION IS THE DANGEROUS DIRECTION HERE AND IT FAILS SILENTLY - every count just gets
  smaller and reads as progress. THE VISITOR-ENROLMENT FEATURE IS NOT BUILT: three design rounds,
  each returned FIX-FIRST by three independent adversarial reviews at 7, 6 and 10 blocking
  defects, every spot-checked citation holding. The diagnosis is scope growth rather than bad
  review, and ratification was the first piece of the decomposition. STATE.MD WAS CORRUPTED AGAIN
  BY THE PAUSE-WORK WRITER overnight - writer seven, a repeat of writer two, progress zeroed and
  the stopped_at block deleted, sitting UNSTAGED where nobody would see it; caught by git status
  on resume and reverted. This block was written BY HAND for that reason.

  SESSION OF 2026-08-14: 81 OF 102, UP FROM 79 - MR-02 AND VER-10 BOTH CLOSED, and the
  Built-not-wired marker bucket is now EMPTY, which is the marker this milestone existed to
  empty. Unwired capabilities 72/36 -> 66/24. Eight feature commits, all merged and pushed.
  THE MOST REUSABLE FINDING IS A TEST FOR EVIDENCE: a reading that would be identical if the
  mechanism never ran is not evidence of the mechanism. It appeared THREE TIMES this session -
  VER-04's `independent (replicas 2, operators 2)`, which classifyAttestation computes from who
  answered and signed and which prints identically on a fabric where the quorum gate never ran;
  the comparison case in attestation-ui.e2e.test.ts, whose three screens made "claimed a
  strength" and "was the solo run" COEXTENSIVE so its loop could not tell the two rules apart;
  and VER-03's shared-relay line, which is derived from certificates rather than from the
  composer and is STILL LIVE - do not close VER-03 on it. THE SECOND PATTERN IS PROSE BLOCKERS
  NOBODY CHECKED AGAINST THE GUARD: three were retracted, each having stood for weeks. The
  sovereign arm never needed two owners, it needed two CONTRIBUTIONS which one owner supplies;
  a second owner could not move any published number because eligibleNodes returns every node
  for a public request; and memoryConsentStore's claim that a storage-denied page used it was
  false while that page was REFUSING VISITORS. Two of the three were the difference between
  "owner decision" and "wiring". TWO USER-FACING DEFECTS FIXED: the demo page told visitors
  their key was "generated in this tab" for twelve days after identity became persistent, and a
  private-browsing visitor could press Allow and then be refused on Start. THE FLAG RULING NOW
  GATES FOUR ROWS and its cost is measured rather than argued: VER-04's entire proposed change
  landed in 705a716 and the box did not move, while VER-10 - same night, same kind of work, on
  a surface with no flag - closed. AOT: glog was never the wall; a 2-line __wasi__ branch plus
  ~7 lines fixing elfconv's own bugs gets 27/27 translation units compiling, and the real cost
  is the LLVM cross-build, still unmeasured.

  EVENING OF 2026-08-14: 88 OF 102, UP FROM 81 - VER-03, VER-04, AOT-05, MR-03, MR-05, MR-07 and
  WIRE-02 all close, and THREE OF THEM CLOSED WITH NO NEW PRODUCTION CODE, which is the reusable
  finding: the mechanism already existed and the evidence was pointed at the wrong thing. MR-07's
  row says a duplicate is discarded BECAUSE IT CARRIES THE SAME CID while its cross-process reading
  exercised rpc.ts's pending-entry check, which discards because a TIMEOUT deleted the entry,
  independent of the CID entirely; re-sited and planted red, removing the CID-keyed collapse turns
  two AGREEING live replicas into a disagreement across eight processes WHILE EVERY RPC RESOLVES.
  MR-05 was already true of its own sentence and machinery was nearly built for a requirement that
  did not ask for it. AN OWNER RULING REMOVED THAT WORK and is recorded at
  .planning/consults/2026-08-14-owner-ruling-sovereign-threat-model.md: sovereign data is processed
  AT REST, the requestor IS the data owner so there is no interest in faking a result about one's
  own data, and a bad storage node has a blast radius of one owner's own data - so MR-05's
  rendezvous check was defending against the data owner attacking their own job. THE BOUNDARY IS
  RECORDED TOO: PROJECT.md:31 keeps cross-owner aggregation verified and the public path keeps
  N-version redundancy plus commit-reveal. VER-03 CLOSED BY REPAIRING THE RULE RATHER THAN THE
  FIXTURE - relayIds names relays by libp2p PEER ID while a quorum member is keyed by nodeKey, two
  spellings of one node that never compare equal, so when the relay every other member depended on
  was ITSELF a member no comparison in quorum.ts could see it; QuorumRules.peerIdOf closes it and
  provably collapses to the old function when absent. THE PLANNED REMEDY FOR VER-03 WAS REFUTED
  BEFORE IT WAS BUILT: qualifying the demo pool by block advertisement would have gone permanently
  solo, because the input block is created inside submitJob AFTER the pool is chosen. AOT-05's
  PUBLISHED NEGATIVE IS REFUTED - the fixture's functions had no call instruction so nothing tiered
  up, and its trace-name list never fired on this path, so two claimed independent observations
  were one observation and a constant. Its residual is settled to --wasm-caching-timeout-ms,
  ISOLATED rather than inferred, and A RIVAL THAT FIT EVERY ROW OF THE TABLE WAS FALSIFIED: the
  committed shape sits 0.9% over --wasm-caching-hard-threshold, and raising that threshold left the
  figure byte-identical. WIRE-02 replaces a population ceiling with a 24-row per-symbol register
  held in both directions. AUTH-02 GAINED ITS CAPABILITY AND DID NOT TICK - no production call site
  can supply an issuer because the demo has no visitor enrolment, which is a product decision
  declined on main.ts's own standing objection. TWO GUARDS CAUGHT ORCHESTRATOR ERRORS: WIRE-02 is a
  new ID and not in the 72, and three now-Done rows were still in WITHOUT_A_CHECKABLE_CLAIM.
  demo-pi.e2e.test.ts IS A KNOWN FLAKE - green, red, green on identical code, cause not found.
  AOTW-06's 27/27 NOTE IS UNREPRODUCED: two prose sentences from one commit, no patch, no log, and
  third_party/elfconv pristine at its pinned commit.
last_updated: "2026-08-24T20:30:00.000Z"
last_activity: 2026-08-24
progress:
  total_phases: 15
  completed_phases: 15
  total_plans: 103
  completed_plans: 103
  percent: 100

</details>

### v1.1 Current Position, preserved at the v2.0 switch (2026-08-25)

`gsd-sdk query state.milestone-switch` rewrites `## Current Position` to the new-milestone
template, which is correct — that section describes where work stands, and it no longer did.
But the v1.1 text was 675 lines and **five sampled passages from it existed nowhere else in
`.planning/` or `docs/`**, one of them naming three pending owner rulings. It is moved here
rather than dropped, because Accumulated Context is the part the switch is documented to
preserve.

Read it as a record of v1.1, not as current state. Anything in it that is still live —
the pending rulings in particular — belongs in the v2.0 requirements as an explicit row.

<details>
<summary>v1.1 Current Position, verbatim</summary>

**THE COUNT IS 12 OF 15**, as of 2026-08-07 *(SUPERSEDED 2026-08-22 — read this as WAS, like
the paragraph further down this section that already does. The count is 15 of 15 and v1.1 is
CLOSED at 15/15 phases and 50/50 requirements; 20, 21 and 22 all closed 2026-08-18 at 7/7, 3/3 and 3/3.)* — **and a
2026-08-08 attempt to make it 11 was RETRACTED the same day, on discovering the reopen rested on
half the evidence.**

Audit finding L3 reported that `13-VERIFICATION.md` reads `criteria_met: 0` while this file counted
Phase 13 closed. That is true of that file and **irrelevant**, because the phase has **two**
verification files and the second is the live one: `13-VERIFICATION-2.md`, pass 2, same day,
**`score: 3/3 amended criteria verified`**, 8 verifier-planted mutations, and an explicit
`re_verification` block reading *"previous_score: 0/3 against the ORIGINAL criteria"* and *"this
pass verifies the criteria as amended in ROADMAP.md, not the wording 13-VERIFICATION.md quotes"*.
Plans 13-04, 13-05 and 13-07 landed between the two passes and closed exactly the gaps the first
one named.

**So there was never a contradiction, and the count never should have moved.** The error was
mine: I read `13-VERIFICATION.md`, did not glob the directory, and put a decision to the owner on
that basis. The owner ruled to reopen — on evidence that was wrong — and the ruling is void
because its premise was. Recorded here rather than quietly reverted, because a count that moves
without an audit trail is the defect this milestone keeps finding, and that applies to moving it
*back*.

**THE COUNT WAS 12 OF 15**, as of 2026-08-07. Closed and counted: 11, 12, 13, 13.1, 14, 15,
16, **17**, 18, 19, 23, 24. Uncounted: 20 (6/7), 21 (2/3), 22 (planned, 4 plans, 0 summaries,
runs last). The block below describes Phase 24 and remains accurate about it.

Phase: 24 (Certificate-Gated Admission) — **1/1 on criteria, CLOSED and COUNTED**
Status: **8 plans, 8 summaries**, `24-VERIFICATION.md` dated 2026-08-06, scored **0/1** at
`753d298` and re-scored **1/1 MET** by the dated amendment at `580e461`. **The phase has
exactly one criterion, numbered 8**, carried into it from Phase 19 criterion 5 and Phase
17 criterion 3 by owner ruling 2026-08-04, so a score reads **out of 1 and never out of
8**. **This block read "0/1 on criteria, NOT closed and NOT counted" until 2026-08-06,
while four other places in this same file already said 1/1** — recorded rather than
quietly overwritten, because a file disagreeing with itself is the defect this milestone
keeps finding, and it found it here in its own bookkeeping.

**MET carries a stated bound and the bound is part of the verdict.** The default posture
of `bin/agent.ts`, `bin/seed.ts` and `bin/bench.ts` is **open and must be** — 19 + 3 argv
sites, with `reservation-exhaustion.node.test.ts` arm A a live behavioural guard on it.
*"The fabric"* was read as **a fabric this repository can be deployed and operated as,
with an admission posture stated on every relay-capable door** — not the default argv of
its binaries.

**Of the two criteria carried into it, one closed and one declined — the same day, by two
independent verifiers.** Phase 19 criterion 5 closed at **5/5** (`ac7b214`), carrying the
bound verbatim. **Phase 17 criterion 3 DECLINED** (`a3d2215`) — the first time RULING A has
held against a destination that actually landed MET, and it declined for a reason worth more
than the verdict: criterion 3 is about **mass** creation, and bounded issuance plus *"an
unissued identity buys nothing"* only yields a per-identity price **if one certificate
admits exactly one identity**. That binding existed in `fabric-node.ts` and **no test
observed it** — neutralising it stayed green across 8 files and 5 runs, while the control
plant reddened, so the silence was a fact about the corpus rather than about the day.

**The decline lasted one day and was answered by code, not by a ruling.** `8719029` put the
borrowed-certificate case at the door (ledgered `M68`), and the fourth amendment to
`17-VERIFICATION.md` **re-ran the same plant on the same file** — `fabric-node.ts` sha256
`d6688f73…`, byte-identical to the digest the declining pass recorded, so the different
result cannot be a different file. It reddens: the door returns `false` where `true` denies,
admitting a peer holding somebody else's certificate. **The both-ways proof held** — planting
`peer-verifier.ts` instead leaves relay-admission green in full while reddening
peer-verifier's own row, so the new case observes the **door** and not the **selector**.
**Phase 17 is 3/3 and counted as of 2026-08-07.**

**Both carried criteria did rest on that same unguarded binding, and the adjudication this
block called for was settled by guarding it** rather than by choosing between two verdicts.
Two items stay with the owner and neither is a criterion-3 gap: the AUTH-02 browser-pinning
leg, carried unresolved since 2026-08-05, and the **graduated-cost reading** — this close is
a bound plus devaluation, not a rising per-identity price, and a reader taking *costly* to
require the latter gets the 2026-08-01 answer.

**The mechanism is real, armed and measured.** `RelayAdmission` is a required named union
at 70 construction sites; `relayAdmissionGate` reads it and returns *no gater method at
all* for the open posture, so an unarmed node is byte-identical to before; the gate asks a
joining peer for its records over the fabric's own RPC, retries because the first request
is *destroyed* rather than delayed, verifies the certificate offline against a pinned
issuer set, and refuses inside libp2p's own 5 000 ms ceiling. It refuses and admits by
certificate across **six** real `bin/agent.ts` processes and in chromium, firefox and
webkit, and **mutation M66 was planted and caught by the verifier itself**. Nothing here
is decoration.

**What does not hold is the criterion's own word — "the fabric".** The evidence reads
*"cannot join a relay that has been told to close"*. `denyInboundRelayReservation` is
per-relay by construction, and the enrolment provider a joiner **must** dial in order to be
certified is itself an open door, so a refused joiner reserves there. That was demonstrated
twice in one run, once by accident. **24-04's defence of the clause was falsified by
24-04's own run**: it argued that criterion 8's subject is *"a node that cannot present a
provider-issued certificate"*, that `stranger` is that node, and that `stranger` is
nowhere — but the in-process `reader` is **also** that node, handed no `enrollment` option
and holding no certificate, and its id is the second entry in `openProviderHolds`. Two
nodes, the same clause, opposite answers, and the difference between them is not the
certificate but which peers each happened to dial.

**And `bin/seed.ts` cannot be told to close.** *(SUPERSEDED 2026-08-08 — see the correction
under Current Position. It can, since `afe8b0b`. The paragraph is kept because the reasoning it
records is why the flag was added.)* No `--admit-issuer` flag, no
`SeedServerOptions` field, and `seed-server.ts` writes `relayAdmission: 'admits-any-peer'`
at its `FabricNode.start` call. So the bound is **structural**, not a deployment posture an
operator can remove — which is why this verifies PARTIAL rather than passing with a stated
bound. The seed is the relay **every browser tab in this fabric reserves on**, and the
source of `BootstrapInfo.peerAddrs` — the one advertisement surface no test in the tree
reads as a gated one, and the one `packages/browser/demo/main.ts` consumes for peer
discovery.

**The residual is unchanged on two independent readings, which is the point of taking it.**
refuse-over-mint read **3.070** (24-04, load 3.44) and **3.0895** (verifier, load 5.92),
both inside Phase 19's 2.96–3.16 band across nine prior readings — so Phase 19's refusal
economics survive on a tree where the gate exists and is armed. refuse-over-replay reads
**9 351** / **9 576.8** against a recorded 3 758–7 501 band, and that is the instrument
rather than the code: the replay denominator sits at 0.5–0.75 µs, a couple of
`performance.now()` ticks, so every reading of the quotient is floored by the clock and
understates. Neither number is evidence of a regression **or** of an improvement. **The
counted half is the load-bearing one and it holds**: three full issuances for three askers
against **zero** reservations. Counts need no calibration.

**The revocation window is a measured number with a measured floor.** A refused renewal
never resets the relay's timer, so an entry runs out on its original clock — measured
`ttlMs 40000 renewalAskedAfterMs 30031 droppedAfterMs 40049`. The window **is** the
reservation TTL, and it cannot be shortened below about 30 s, because
`@libp2p/circuit-relay-v2`'s `REFRESH_TIMEOUT_MIN` clamps the renewal ask at 30 000 ms;
under that, a reservation expires before its holder ever tries to renew, which is churn and
not revocation. A refused peer also never retries by itself — libp2p arms its refresh timer
only inside the success path — so a **reconnection** is what gets an admitted peer in.

**Two things this phase's own reports got wrong, both now corrected rather than carried.**
The process count is **six**, not five: `spawnAgent` runs for `provider`, `other-provider`,
`relay`, and three times inside `joinFabric`. It was wrong in the test's own Budget section
and twice in `24-04-SUMMARY.md`, and it had propagated into the AUTH-02 row drafted for the
permanent ledger. And two docblocks on the phase's own central field said the opposite of
the code beside them — `FabricNodeOptions.relayAdmission`'s *"Nothing reads this yet"* and
`relay-admission.ts`'s *"Consulted by nothing"* / *"MEASUREMENTS not yet taken"*. Both
repaired 2026-08-06.

**Three owner rulings are pending, all named in `24-VERIFICATION.md`:** whether a seed may
be told which issuers it admits (`SeedServerOptions.relayAdmission` +
`bin/seed.ts --admit-issuer`) — under which criterion 8 can reach MET; whether Phase 22
still runs next, given it will now certify a fabric gated at agent relays and open at every
seed; and the `**Mode:** mvp` label on Phase 24's ROADMAP block, which cannot be verified
under MVP mode's User Flow Coverage contract because the goal is a security property rather
than a User Story. **Criterion 8's wording was not edited** — restating it as a property of
*a relay* is exactly the rewrite RULING A forbids, and it is an owner's edit if it is
anyone's.

Previous phase: 23 (Multi-Process Benchmark Driver) — **5/5 on criteria, COMPLETE**
Status: 6 plans, 6 summaries, `23-VERIFICATION.md` dated 2026-08-06. Its `status:
human_needed` carries **no gap**: it names the ledger edits a verifier is forbidden to
apply, and this file is one of them. All six plans deferred those edits to verification on
the stated ground that *"a phase is done when a verifier says so, not when its plans are"*,
and the verifier confirmed on disk that the phase touched none of `REQUIREMENTS.md`,
`ROADMAP.md` or `STATE.md`. **BENCH-07 closed 2026-08-06.**

**The harness now spawns real operating-system processes** — `nodes + 1` per rung, the
submitter in-process, every pid published — so a parallel speedup is measurable at all
rather than asserted. **The measured speedup is 2.70×**: makespan **1591.1 ms at N=1 to
590.0 ms at N=8**, against an **ideal bound of 9.78×** (`sum ÷ max` over 16 calibrations).
Both figures were **re-derived from `.planning/bench/raw.json` by the verifier**, not
transcribed from a summary.

**Three previously published bounds are void, and that is the phase's best finding.** The
old bound was computed over sixteen calibration calls **that never ran**: `Task.label` is
optional in-process and **REQUIRED at the wire**, and `execute` returns `{ok: false}`
rather than throwing — so sixteen silent failures were averaged in as though they had
succeeded. A bound computed over calls that did not happen is not a conservative bound, it
is a wrong one. The three were **withdrawn, not reconciled**.

**Two of the phase's own headline hypotheses came back FALSE and were published as false.**
First, the recorded cause for the excluded 16-node rung was **refuted by the phase's own
eight-cell factorial**: outcomes partition on **dial direction**, and a live node announces
`inboundConnectionThreshold=15` — not the 5 the note blamed. Criterion 3 passes on its
**first** disjunct, so the refutation costs the phase nothing; the criterion takes a dated
correction note rather than a rewrite, because changing a criterion's text after the fact
is an owner ruling and not a verifier's edit. Second, **whether the two drivers differ at
all is UNSETTLED, and is published as unsettled**: three runs, the curves crossed twice,
and the spread *between runs* exceeds the difference *between drivers*. The experiment
cannot separate them, and the artifact says so instead of picking a winner.

**AUTH-03 stays `Partial`, and not because nothing happened.** Its requestor half now has
production callers — `bin/bench.ts` calls `delegate` twice, hands a
`(nodeId) => CapabilitySupplier` to `discoverCandidates`, and ships
`shards: [{ value: row, label: 'sovereign', ownerId: BENCH_OWNER_KEY }]`. A spawned run
printed `--sovereign: 1 of 1 sovereign shards agreed, chain rooted at ea4a6c63…`, and a
chain minted under a different key was refused with `unauthorized: link 0 is issued by
1398f62c…`. The leg is still reached only behind two off-by-default flags
(`--discover --sovereign`), and **whether that is entry-point reachable is Phase 22
criterion 1's guard to rule.** Ticking ahead of the guard is the shape this milestone
exists to remove.

**Two stale claims live in production source and will mislead Phase 22 if left**:
`packages/net/src/remote-executor.ts`'s class comment beginning *"AUTH-03: the *minting*
side of this is still entry-point-unreachable"*, and `packages/bench/src/index.ts`'s
*"Exported here with no production caller yet. Plan 23-03 supplies it"*. Both are now
measurably false; both are source edits the verifier could not make.

Previous phase: 21 (AOT Translation, Signing & Runtime) — **2/3 on criteria, NOT closed**
Status: 5 plans, 5 summaries, `21-VERIFICATION.md` 2026-08-05, `status: ruled`. Criteria 1
and 3 MET and **both re-executed from source by the verifier**, including both router
mutations in `packages/aot/src/abi-router.ts` and a real CLI lift of both guests.
**Criterion 2 is PARTIAL on one clause only** — the re-tag refusal — while its second
clause, that changing a covered input moves the emitted CID, is MET.

**The owner ruling of 2026-08-05 recorded the re-tag refusal as a MEASURED NEGATIVE, on
AOT-05's precedent, and the score did not move.** What the ruling settles is the *reason*,
which had been pending since the pass was written; the number was never in question. Both
alternatives were declined on the pass's own measurement: a name allow-list decides the
clause but makes `--image` pointless, which is that flag's entire purpose; and amending the
clause had already been rejected once as unmeasurable, because the classic-store daemon
exits 1. A third option — scoring it MET off the unit-level `resolveImage` refusal — was
**never available**, because unmeasured is not met. The clause is **carried, not cleared.**
`REQUIREMENTS.md` already carried the measured-negative wording in three places; the ruling
makes the verification agree with the ledger rather than the other way round.

Conditions, because they are load-bearing here: MacBookPro18,3, 8 cores, Docker with the
**containerd** image store, elfconv image present at `sha256:22a404f3…`, **three other
agents working this same checkout**, load average between **24 and 277** across the pass.

Previous phase: 20 (Single Job Path, Ledger & Churn Resilience) — **6/7 on criteria, NOT closed**
Status: 13 plans, 13 summaries, `20-VERIFICATION.md` 2026-08-05. Scored against seven
criteria, including criterion 7 as **ADDED 2026-08-04** by owner ruling; **criterion 8 was
moved OUT to Phase 24 by the same ruling** and is not scored here. Every MET verdict rests
on an assertion this pass **planted against and watched go red** — ten plants, each
restored by `cp` + `cmp`, `git status` confirmed clean after.

**Criterion 7's write half has no production submitter, and that is the whole gap.** The
recovery half is delivered and falsifiable across six real processes. The write half runs
on a `checkpoints` sink **no shipped entry point supplies**, and no call-site guard pins
which files may pass `SubmitOptions.checkpoints` — so the omission is **unguarded in both
directions**. The precedent exists and was not followed:
`sovereign-block-refusal.node.test.ts` pins the file set allowed to pass
`SubmitOptions.sovereignCids`, and `checkpoints` has no equivalent. The natural candidate
for the sink is `bin/bench.ts`, which already holds the only production `admit` and already
opens an `FsBlockstore`. **CHURN-03 stays Partial, and it is Partial on the wiring alone.**
An owner ruling that the criterion's first clause is satisfied by the production
`writeCheckpoint`/`checkpointOf` path running under a *test-supplied* sink would move it to
7/7 — **RULING A forbids taking that route silently**, and it has not been taken.

**WIRE-04 landed in this phase, and landing it is what closed Phase 18.** A tripwire written
in one phase firing two phases later is the argument for RULING A stated as an event rather
than as a principle.

Previous phase: 19 (Quorum Composition & Owner-Domain Attestation) — **4/5 on criteria, NOT closed**
Status: 19 plans, 19 summaries, `19-VERIFICATION.md` verified **three times** — 3/5 MET on
2026-08-04T03:46, then 4/5 once plan 19-19 closed criterion 1, and **UNCHANGED at 4/5** on
the third pass, which re-measured all four MET criteria against a tree where `submit.ts`
(+719), `fabric-node.ts` (+210) and `browser-node.ts` (+197) had been rewritten underneath
it. `criterion_text_unchanged: true` — both criteria were re-read word-for-word before
re-scoring, which is the only thing that makes a re-verification comparable to the first.

**Criterion 5 does not move to MET and the score does not read 5/5.** The owner carried it
to **Phase 24 criterion 8**, which has not landed, and under RULING A — re-confirmed the
same day, when Phase 18 closed at 9/9 only once WIRE-04 *actually landed* — a carried
criterion stays PARTIAL until its destination phase does. The gap is exact: enrolling is
**a bound made durable, not a rising price.** The N-th identity is refused inside the
window rather than priced; the limit is keyed on `userKey`, which is one
`ed25519.keygen()`; and the budget is per provider **process**, so a second provider
defeats it without a second key.

**Criterion 1's relay clause got the across-process reading it lacked.** Deleting rule 2
from `composeQuorum` reddens a fabric of four spawned `bin/agent.ts` processes at
`quorum-agents.node.test.ts:1064` with `expected 'composed' to be 'not-composed'`, and the
regression control was proved non-vacuous by planting the plausible **wrong**
implementation as well as the deletion. Separately, an **unledgered** plant by the verifier
— keying `bin/agent.ts`'s `listen` on `--relay-addr` being present rather than `--port`
being absent — reddened `quorum-agents` alone, proving that case is **the only guard in the
tree** for that production change.

**Four findings outlived the pass and are recorded rather than fixed:** a `submit.ts`
citation that the fix's own +14-line edit moved out from under; `static-rendezvous.e2e.test.ts`
citing a duty-cycle comment for `reservations: 'relays-for-nobody'` — wrong when written,
and not among the three that same commit claimed to have re-checked;
`reservation-exhaustion.node.test.ts`'s stated claim that a relay-refused node is *"still
serving directly"* asserted **nowhere**, measured by a plant that makes its agents bind
nothing and leaves the file GREEN; and `bench-attestation.node.test.ts:478` going red once
in three full node runs under contention, because its retry gate deliberately does not
cover a rung that completed at reduced redundancy.

Previous phase: 18 (Discovery, Capacity & Placement) — **9/9 on criteria, CLOSED 2026-08-04**
Status: 11 planned plans + 2 gap-closure plans (18-12, 18-13), 13 summaries, 1 verification
amended **twice**. **No automated gap remains.** Criteria 1, 2, 2c, 2d, 3, 4, 5 and 6 were
MET at the first amendment; **criterion 2b was PARTIAL and the phase was not permitted to
close on it** — RULING A, written at planning time in `ROADMAP.md` precisely so this would
not need re-deciding. It closed on **2026-08-04, the day WIRE-04 landed in Phase 20**, and
the tripwire turned red on cue. The phase spent two days looking unfinished and got a real
criterion out of it; nothing was rewritten to make it close.

**The first pass found a tautology, and that is the phase's real finding.** Criterion 2b's
absence-instrument — the thing RULING A required in exchange for accepting PARTIAL, so the
clause would *"turn red the day WIRE-04 lands"* — could not fail at all.
`expect(shard.verification.agreeing).toHaveLength(1)` reads a subset of `placement.nodeIds`,
whose length **is** `redundancy` = 1, and the `status === 'agreed'` narrowing three lines
above excludes 0. Confirmed at the type level on re-verification. Its companion,
`expect(direct.ok).toBe(false)`, was broken a second and independent way: taken on a bare
`RemoteExecutor.execute()` **outside** `submitJob`, where a retry inside `submitJob` can
never reach it. **A guard that cannot fail is worse than no guard, because the next reader
stops looking** — and this one was load-bearing for a ruling.

Both gaps closed with **zero production change** (`git diff` over `packages/core`,
`packages/browser`, `packages/net`, `packages/libp2p` is empty across 18-12). The
replacements were each planted, watched RED, and restored by `cmp`: **M36** re-picks inside
`submitJob` and reads `expected 'agreed' to be 'insufficient'`; **M37** builds a second
`LocalCapacity` without the governor and turns the peer's wire reading red while **every
in-page assertion stays green** — 1 failed, 5 passed, which is the whole content of
criterion 3's browser half.

**Three findings outlived the phase and are tracked rather than fixed:**

- **`admit:` at `bin/bench.ts:723` is guarded by nothing.** Deleting it moves `submitJob`
  from `planWithOffers` to `planPlacement`, and on a rig where nothing refuses the two place
  identically. It is the **sole production caller** behind SCHED-02's runnable-entry-point
  claim. Closing it needs a rig where a node actually refuses.

- **`tools/aot/lift.node.test.ts` failed WORSE alone on a quiet host** (12 failures, ten
  60 s timeouts, 850 s against the config's recorded 217 s) than under suite load, so
  `deferred-items.md` item 2's *"passes in isolation"* diagnosis is false. **CLOSED 2026-08-04.**
  Measured in both conditions before anything was changed, and the file was green 99/99 in each:
  alone at load 5.9 it ran 216.83 s, and under twelve CPU burners at load 102 it ran 284.29 s —
  but **92.6% of that wall clock is one integration `beforeAll` the per-case reporter attributes
  to nothing**, and the cases themselves moved only 9.7%. The real cause is an unbounded retry:
  bounded in count, unbounded in time. `despiteAFullProcessTable` retries four times, an attempt's
  duration is a budget the caller chose, and 4 × 20 000 ms plus backoffs is 81 500 ms of driver
  budget inside a 60 000 ms case — so the framework always fired first, always at exactly
  60 000 ms, always with nothing to say. **The recorded diagnosis had read 60 000 ms as evidence
  that docker hangs for a minute; 60 000 is that file's own `vi.setConfig({ testTimeout })`.** A
  duration equal to a timeout is evidence of the timeout. The absolute bound is now comparative —
  two arms of one case, 400 ms against 2 000 ms of budget, reading the difference so spawn cost
  cancels algebraically — and it reds below 800 ms or above 3 200 ms against a worst measured
  drift of ~300 ms.

- **23 of ~45 ledger citations had outrun the tree**, nine of them introduced by the very
  plan written to correct drift. A blanket offset would have been wrong twice over — one
  citation was out by 117, and five were already exact. A cheap guard was **measured and
  declined**: the tractable check catches 16 of 22 and needs four exemptions, which reads
  green and retires the question.

**18-13 found the defect under the stale rows.** Both claim-checking cases in
`requirements-ledger.node.test.ts` iterated `BUILT_NOT_WIRED`, so a row marked *Partial* left
the guard's population entirely — **the act of fixing a row was the act of exempting it**.
SCHED-03 was corrected on 2026-08-01 and went stale by the next day, unwatched. Widening to
every row immediately surfaced a fourth stale row nobody had reported (NET-06).
`WITHOUT_A_CHECKABLE_CLAIM` went 2 → 17 without anything becoming less checked: the
consuming assertion demands **exact set equality**, so a row with a bindable claim cannot be
parked there.

Previous phase: 17 (Node Identity & Enrollment) — **2/3 on criteria, NOT closed**
(**amended up from 1/3 on 2026-08-05**; this entry read 1/3 until 2026-08-06)
Status: 5 planned plans + 1 gap closure (17-06), 6 summaries, 1 verification pass amended
once. **Criterion 1 MET** cross-process, and not as a self-report: `.identity.key` absent
before the spawn and present after, `peerIdForNodeKey(nodeKey) === peerId`, and the
certificate re-fetched over the production `records` RPC by a **third** process and verified
there. **Criterion 2 moved to MET** on the 2026-08-05 amendment. **Criterion 3 stays
PARTIAL** on its COST clause, which is **carried to Phase 24 criterion 8** — the same
destination as Phase 19 criterion 5, and the same reason: a bound made durable is not a
rising price. **AUTH-01, AUTH-02 and AUTH-04 all stay open**; nothing ticked.

**Two halves were scheduled rather than lowered** (owner rulings 2026-08-01):

- **Phase 18 criterion 2d** — a flag that makes a spawned agent dial a named peer, plus a
  cross-process proof of *acceptance*. `bin/agent.ts` parses eleven flags and none dials a
  peer, so a spawned verifier can reach only `no-records`. Until such a flag exists **no
  phase can prove any peer-to-peer acceptance cross-process**, not just this one.

- **Phase 19 criterion 5** — enrolling must cost something an attacker cannot mint free.
  AUTH-04's rate limit is fully proven; what it does not buy is the cost clause. The limit
  is keyed on `userKey`, which is one `ed25519.keygen()`, and the budget is per provider
  **process**, so a second provider defeats it without a second key.

**The regression it introduced is closed.** The fail-closed gate had excluded *every*
browser peer as a block source — a fabric partitioned by tier, against the cardinal rule.
17-06 gave browser tabs their own persisted identity and enrollment, and the partition
instrument was observed at **both** values against the same gate node with the same pinned
issuer. The insecure-origin path 17-01 left unmeasured is now measured in three engines.

**⚠ ONE DEFECT IS OPEN AND NEEDS AN OWNER DECISION — see Pending Todos.** *(CLOSED —
SUPERSEDED 2026-08-22. The defect was the `PeerVerifier` verdict-once behaviour; it was decided
and executed on 2026-08-14 at `e1088ce`. See the amended entry under Pending Todos.)*

Previous phase: 16 (Decomposable Tree-Reduce Wiring) — **4/4 on criteria, CLOSED 2026-08-06**
Status: 4 planned plans + 2 gap-closure plans (16-05, 16-06), 6 summaries, 1 verification
pass **amended once**. Criteria 1, 2 and 4 were MET on the original pass; **criterion 3 was
PARTIAL** — its dedupe half proven across nine real `bin/agent.ts` processes, its
*"arriving late"* half not, because `executeReduce` stops at `wanted` replicas and had no
channel on which a late result could arrive at all. Scheduled to **Phase 20 criterion 6** by
owner ruling rather than rewritten, and **closed there**.

**The amendment re-measured; it did not transcribe.** `criterion_text_unchanged: true`, both
texts `cmp`'d at exit 0, and `git log -L` returns one commit per line — neither was ever
edited. Phase 20's reading is *stronger* than the clause carried into it: a spawned agent
SIGSTOPped and awaited to `ps` state `T`, resumed only after `executeReduce` had **returned**,
unsolicitedness asserted by construction. Two plants watched red, restored by `cp` + `cmp`.
The numbers differ from `20-VERIFICATION.md`'s — 3 asks and 3 late replies against its 2 and
2 — and that is correct rather than alarming, because the assertion is a **relation inside
the run** (`late.length === victimAsks.length`), so a different rendezvous draw moves both
sides together.

**The one clause that does not match literally is recorded, not smoothed over.** *"because it
carries the same CID"* is causally **inert** on the late path — `rpc.ts` drops the frame on a
missing correlation entry before the payload matters, and nothing reads the late frame's CID.
Closed on the reading that the duplicate is harmless because content-addressing makes it
redundant. **The verdict turns on that choice and an owner may overturn it**, which would
return the phase to 3/4.

**MR-04 and MR-07 stay `Partial` and nothing was ticked** — deliberately. Both rows already
record the arriving-late closure; what keeps them open is the **demo** half, which is WIRE-02
and Phase 22's. Ticking either would contradict its own row and redden
`acceptance-traceability.node.test.ts`.

**Two attribution facts worth keeping.** The owner ruling and `ROADMAP.md` both say *"Phase 16
keeps **MR-04** open on this account"* while `16-VERIFICATION.md` attributes criterion 3 to
**MR-07**; `REQUIREMENTS.md` extended both rows identically, and the destination spec names
both cases. And `late-combine.node.test.ts`'s own header claim — that this was *"the first
time in this file's history that `expect(arrived)` had ever actually failed"* — is **false**:
`20-03-SUMMARY.md` records that same assertion failing under the SIGCONT-withheld plant, the
file contradicts itself thirty lines earlier, and the amendment's second plant reproduced it.
Documentary only; tracked, not fixed.

**One finding was closed after the verifier wrote its report:** 16-06 bounded the combine
branch at the `capacity` hook, closing the widened fetch surface that routing combine
through the `Authorizer` had opened. The report predates it and still records it as open.

Previous phase: 15 (Capability-Chained Dispatch) — **3/3 on criteria, closed; AUTH-03 open**
Status: 4 planned plans + 1 gap-closure plan (15-05), 5 summaries, 1 verification pass.
The serving half of AUTH-03 is wired and verified between two spawned `bin/agent.ts`
processes; the requestor half — `delegate`, `CapabilitySupplier`, `RemoteExecutor`'s
supplier branch — was routed to Phase 23 criterion 5 by owner ruling, and **Phase 23
carried it out on 2026-08-06**: the "zero production callers" clause this entry used to
carry is now measurably false and is corrected rather than left to be grepped. The row is
**still `Partial`**, because reachability behind two off-by-default flags is Phase 22
criterion 1's ruling. Mutation-ledger entry **M30** pins the browser tier's authorizer
behaviourally.
Next: **22, then the v1.1 milestone audit.** 23 and 24 are both executed and verified; the
line read "24, then 22, then the v1.1 milestone audit" until 2026-08-06, before that "23,
then 24, then 22", and before that "…20, 21, 23, 22" — which was already right about 22
being last, and the owner ruling of 2026-08-05 inserted 24 ahead of it. **Whether 22 still
runs next is one of the three pending rulings**: it was placed after 24 so the reachability
guard would certify a *gated* fabric, and criterion 8 landing PARTIAL means it will certify
one gated at agent relays and open at every seed. That ruling's own escape hatch — that
`22-VERIFICATION.md` states plainly what it covered — applies in a partial form the ruling
did not anticipate. **These
run strictly sequentially, not concurrently** — measured 2026-07-31 from their own
`files_modified`: `fabric-node.ts` is touched by 14/15/17/21 and now by 24-01 and 24-03,
`bin/bench.ts` by 14/15/16/17/23 and now by 24-02, `browser-node.ts` by 14/15/17/21.
"Wire What Was Built" means every phase converges on the same construction sites, so the
earlier note that six phases "can run concurrently" was wrong.
Last activity: 2026-08-06

```
Test Files  ~320 · Tests 4772 · exit 0 · tsc --noEmit clean   (2026-08-01, load 7.1)
node 106 files/1521 · browser 3207 (chromium+firefox+webkit) · e2e 9/44
```

**A later full reading exists and is transcribed, not taken here** — `20-VERIFICATION.md`
2026-08-05, exit codes read with `EXIT=$?` on the next line, no pipes. This state update
ran no tests and claims none of its own.

```
tsc --noEmit  exit 0, no output
node    150 files · 2158 passed | 2 skipped · 249.94 s
browser 243 files · 3930 passed · 33.14 s
e2e      15 files ·   72 passed · 179.81 s
perf      1 file  ·    2 passed ·   1.90 s   (O2_PERF=1)
```

The 272 counts vitest *file-runs*, not files, because the browser project runs its share
three times over. **Run vitest by project, never by bare path** — `npx vitest run <path>`
fans out across all four projects (`node`, `browser`, `e2e`, `perf`) and exceeded ten
minutes twice on 2026-07-31 before this was understood. **Do not take a fresh reading
without checking `uptime` first**: at 12:42 that day the host was at load 213 and no
timing-sensitive result taken then would have meant anything; the reading above was taken
at load 6.6-10.5 once the competing build finished.

### v1.0 carried forward, unarchived

```
Checkboxes  v1 section    45 of 72 ticked · 27 open
            v1.1 section   9 of 10 ticked ·  1 open (WIRE-02)
            whole file    54 of 82
Markers     76 traceability rows: 48 Done · 22 Partial · 1 Built, not wired
            (MR-02) · 5 neither — AOT-03, BENCH-06, NET-03, VER-02, WIRE-02
v1.1        9 of 50 requirements closed  (numerator NOT recomputed — see below)
Historical  v1.0 closed at 112 test files / 1673 tests; 122 / 1775 on 2026-07-28
```

**Recounted on disk 2026-08-06, and every field of the previous block was stale.** It
read *"35 / 72 wired · 27 built-not-wired · 6 partial · 4 open"* and *"Whole file 40 of 82
ticked (35 in the v1 section + 5 in v1.1's)"*. Measured: **45** ticked in the v1 section,
**9** in v1.1's, **54** whole-file; and on the traceability rows, built-not-wired is down
to **1** while Partial is up to **22**. `REQUIREMENTS.md`'s own header already said
*"45 of 72 are `[x]`"* — so **the ledger was current and this summary of it was not**,
which is the same shape as the progress table that said "Not started" for seven finished
phases. A file that summarises another file needs an owner too.

**The old line merged two populations and that is why it drifted unnoticed.** *"35 / 72"*
counts **checkboxes in the v1 section**; *"27 built-not-wired · 6 partial"* counts
**markers on traceability rows**, a different set with a different denominator (76 rows
against 82 requirements — six requirements carry no row). They are split above so the next
reader cannot re-merge them.

**`v1.1 9 of 50` was deliberately NOT recomputed.** Its numerator's definition is contested
*inside this same file*: the paragraph above says the four IDs 13.1 closed are among the ten
new ones and so "do not move this numerator", while WIRE-01 — also a new ID — is counted in
it. Recomputing under a guessed definition would replace a stale number with a wrong one.
This needs the definition settled first, and that is an owner's call, not a recount.

**The 27 and the 6 moved together and the ticked counts did not.** Phase 15 took AUTH-03
off *Built, not wired* and onto **Partial** without closing it: its serving half is wired
and verified, its requestor half has zero production callers. A requirement can leave
"built, not wired" without arriving at "done", and the ledger has to be able to say so —
otherwise the only way to record progress is to overstate it.

The 27 reconciles with the audit's 36: eight have been wired since — DATA-03, DATA-04,
DATA-05, DATA-06, DATA-07 and DATA-09 in Phase 12, then DET-03 and DATA-08 in Phase 14 —
and one, AUTH-03, moved to Partial in Phase 15.
Count them from the **traceability table** rows (`^| ID |` … `**Built, not wired**`),
which is the only place that marker lives; a whole-file grep also catches the legend and
one line of prose and overcounts by two.

**Ticking a requirement is three edits, not one.** Phase 14's verification found this:
the checkbox, the traceability row's *Built, not wired* marker, and the section header's
own count all have to move together, and ticking alone leaves the ledger disagreeing with
itself. There is a fourth: `packages/node/src/acceptance-traceability.node.test.ts` pins
specific ids in specific states, and 13.1's verification broke it by closing SCHED-06
while that spot-check still asserted it open — **`develop` was red from that commit until
it was caught by an unrelated executor.** Run that file after any ledger edit.

**Two denominators, and confusing them is the trap.** REQUIREMENTS.md's own header reads
*"35 of 72 are `[x]`"* — that is the **v1 section alone** (35 ticked + 37 not = 72) and it
is correct as written, not stale. v1.1 then minted 10 further IDs in its own sections
(WIRE-01…04, SCHED-06, NET-08, NET-09, NET-10, DATA-10, BENCH-07), of which five are now
ticked: WIRE-01, plus SCHED-06, NET-08, NET-09 and NET-10 from 13.1's verification.
DATA-10 is the one 13.1 left open. So the whole-file count is **40 of 82** and neither
number contradicts the other. Recount with the section ranges, never with a whole-file grep.

**v1.1's scope is 50, not 44.** Forty existing IDs to be wired, plus those 10 new ones.
The line said 44 because it was written when only WIRE-01…04 existed; SCHED-06, NET-08,
NET-09, NET-10 and DATA-10 were minted on 2026-07-28 with Phase 13.1 and BENCH-07 with
Phase 23. **The numerator is 9:** DATA-03, DATA-04, DATA-05, DATA-06, DATA-07 and DATA-09
from the existing forty (Phase 12), DET-03 and DATA-08 (Phase 14), plus WIRE-01. The four
that 13.1's verification closed are among the 10 new IDs, not the forty, so they raise the
whole-file count without moving this numerator.

**Read `.planning/v1.0-MILESTONE-AUDIT.md` before planning.** It carries `file:line` for
every claim. v1.0 was deliberately **not archived** — its audit returned `gaps_found`,
and filing 36 unwired requirements under a completed milestone would have made the
ledger say something untrue. The phase directories for 2–10 are intact for the same
reason.

The 36 are not undone work. Sovereignty labelling, tree-reduce, discovery, enrollment,
quorum composition, capability chains and the whole churn coordinator are implemented,
exported and covered by their own specs — and nothing a person can run calls any of
them. Verified symbol by symbol: `runResilient`, `EgressGuard`, `translationCid`,
`composeQuorum`, `discoverExecutors`, `executeReduce`, `requestEnrollment`, `signName`
and `verifyChain` each appear only as their own definition, a barrel re-export, or a
prose comment.

**The structural cause is one shape, and it is v1.1's first target.** `serveAgent`
declares six optional hooks with silent defaults — `authorize`→allow, `index` and
`reservations`→empty, `capacity`→accept. `ledger` is supplied nowhere at all, in
production or in one test. A hook whose default is indistinguishable from the feature
working is why no test failed.

**One of the 36 was a live bug and is already fixed.** Static-host rendezvous answered
`[]` forever — `FabricNode.reservedPeerIds` held the right data and `serveAgent` was
never given it — with the signature `{asked: true, dialed: [], failed: []}`: nothing
attempted, nothing failed, no error. `rendezvous-wire.node.test.ts` starts three real
nodes and requires two to find each other with nothing supplied by the harness.

### Where Phase 10 landed

**The finding is the exit code.** A pipeline trusting elfconv's `0` would cache an
artifact that aborts at runtime under a name asserting it is clean. Two greps —
abort call sites and recovered addresses — must agree before the count is called
evidence, because a single grep that stopped matching would report zero and look
like good news.

**A real artifact was pointed at the executor for the first time**, and every
execution-side test before it used hand-written fixtures written from the same
understanding as the executor. The ABI held exactly: 23 WASI imports, `_start` and
`memory`, every import answered. And it turned up something fixtures could not — a
`printf("hello\n")` imports **`clock_time_get` and `poll_oneoff`**, because glibc's
stdio pulls them in whether the program asks or not. Pinning the clock is
load-bearing on the very first task anyone runs.

**The V8 code cache does not happen.** At 4.8 MB, `application/wasm`, query-free CID
URL, `compileStreaming`, hot enough to tier up: no WASM code-cache entry across three
visits, while the same profile grows a 2 MB *JavaScript* cache and a
`--v8-cache-options=none` calibration reads the identical 72B. Reported unmet rather
than reworded — a criterion that can only be reported as met is not a measurement.

**A recorded project assumption was wrong.** `CLAUDE.md` said elfconv needs
unstripped binaries. It does not: `.eh_frame` is enough, via libdwarf. Corrected in
`CLAUDE.md` and the roadmap.

**Two reviewer findings outlived the phase and were real.** A file carrying raw NUL
bytes had silently left the vocabulary guard's jurisdiction — an exemption with no
entry, which the guard's own planted violations could not detect because they scan
synthetic content rather than the tree. And `PINNED_WASI_FUNCTIONS` was checked only
for *identity*, which a replacement returning the wrong value satisfies exactly.
Both fixed; 8 mutations planted, 8 caught.

### Where Phase 9 landed

**Consent is a value, not a check.** `GrantedConsent` is minted only by
`grantConsent`, and `start` takes one as a parameter — a caller without one does not
fail a check, it fails to compile. No test-only bypass: the e2e harnesses consent
for the same reason a visitor clicks the button.

**Nothing touches the network before consent either.** Criterion 3 names CPU; the
owner's decision went further, because "we spent no cycles" is not an answer to "you
told a third party I was here". Proved by watching every request the tab makes.

**Stopping had to become real before it could be claimed.** `WasmExecutor` ran on
the main thread, where a synchronous `run()` cannot be interrupted — so "one click
drops CPU to zero" meant "zero once the current task finishes". Tasks now run in a
Worker; Stop calls `terminate()`. The probe that proves it is a bare `loop br 0`.

**A guard caught the exact trap it was written for.** Replacing `terminate()` with
a cooperative flag left every test green *except one* — the one that messages the
thread directly, past the executor, and requires silence. Rejecting the pending
promises makes a stop look instant while the thread keeps burning; resolving the
caller and killing the worker are two different acts.

**Ordering is what makes cubes worth having.** The colouring search first walled at
n = 205 and no parallelism moved it: assigning values in increasing order means a
cube fixes the *least* constrained numbers — 1 and 2 appear in no triple at all — so
cubing split the work without splitting the difficulty. Ordering by constraint
degree moves the wall with cube count: 1 cube → 300, 8 → 500, 256 → 600.

**Chromium throttles timers hard in a tab that is not in front** — measured, a
400 ms poll produced one tick per second. Anything the always-visible surface
depends on is pushed, never polled. This bit twice in one phase.

Numbers: 6 mutations planted, 6 caught. `verifyColouring` re-derives 484 triples at
n = 600 and accepts in under a millisecond, trusting no node.

### Where Phase 8 landed

**The ordering was the requirement.** `BENCHMARK-METHODOLOGY.md` went in before any
harness existed — checkable in `git log`. Three pre-registered predictions all held: the
node axis would be sub-linear (it was flat), the COST crossover would be embarrassing
(none, ~570×), and the fixture bias would dominate (it did).

**The headline caveat is what the numbers cannot show.** Every node in both curves runs
in one OS process on one event loop, so no parallel speedup is measurable at all. The
flat makespan is the consequence of that, not a finding about scaling. The scaling claim
is therefore **unmeasured** — which is neither disproved nor supported.

**The incomplete-run rule paid for itself immediately.** The first full run reported
19/19 incomplete at every memory rung rather than a suspiciously fast success: the memory
workers could not fetch shard inputs. A harness that averaged failures in would have
published a beautiful fictional curve.

**A misnamed field, caught before publication.** `JobResult.grossNodeSeconds` named a
quantity that was *bytes across the guest ABI*, not seconds — deterministic, which is
right for a cost metric, and off by a factor nobody could guess if published as time.
Renamed to `grossFuel`/`usefulFuel`; the driver measures real node-seconds itself.

**Two ladder rungs published as excluded, not dropped.** Real transport at 8 and 16 nodes
dies on `INBOUND_CONNECTION_THRESHOLD = 5` per host — the limit Phase 3 already found.
A rung that vanishes between plan and results is indistinguishable from one removed for
being inconvenient.

Numbers: connectivity tax **8–10×**; no COST crossover; decomposition native 0.002ms →
WASM in-process 0.61ms → distributed 1.3ms, so most of the gap is the ABI on a trivial
fixture rather than the fabric.

### Where Phase 7 landed

A job survives its machines — and its submitter — vanishing mid-flight. A lease is a
deadline, not a lock, so "never orphaned leases" needs no cleanup code and resume is the
same path as start. Then an adversarial review found five defects and refuted none, the
worst being that speculation could change the answer: breaking on the first arrival meant
a losing copy was never compared, so timing alone could pick between two different CIDs.
The test guarding it was vacuous. All fixed and mutation-tested.

### Where Phase 3 stands

Two browser tabs, and separately an iPhone running Safari and a laptop running Chromium,
complete a 4-shard 2×-redundant job over a **direct WebRTC** connection with the relay
carrying only SDP. Remaining: real AutoTLS, which needs a publicly reachable host.

</details>

## Quick Tasks Completed

| Task | Date | Outcome |
|------|------|---------|
| `260823-fkf-wire-dht-registration-and-discovery` | 2026-08-23 | **The DHT is used for registration and discovery, and the reason it was not is two `kad-dht` settings rather than missing code.** `peerInfoMapper` was left at `removePrivateAddressesMapper`, so on loopback, LAN and relay no peer ever entered a routing table — measured on two `server`-mode nodes where `put` yielded no events and `getClosestPeers` never returned; and `selectors` had no `o2` entry, so `bestRecord` threw `MissingSelectorError` on every read and `DhtRecordIndex`'s catch presented it as an empty keyspace. Both fixed on both tiers. Registration moved from a one-shot start put to `RecordPublisher`, which republishes on every `peer:identify`; `dht.provide` is now called for the first time, through `DhtProviderAnnouncer`, under the owner ruling of 2026-08-23 and behind the same `withholdingFrom` predicate the serving index uses. `discoverCandidates` gained a required `index` option so the composed `DhtRecordIndex` finally has a reader on both tiers. `submit.ts` now marks a shard sovereign **before** it puts the bytes, which closes at its source the window an announcer would otherwise have had to dodge. Proof: `packages/node/src/dht-registration.node.test.ts`, DHT-only via `recordsFallback: 'answers-from-the-dht-alone'`, three plants watched red. **Open decision left to the owner**: a provider record already replicated survives `cancelReprovide` until `PROVIDERS_VALIDITY` (48 h), so a block that was public when swept and becomes sovereign afterwards stays discoverable-as-provided until then. |

## Deferred Items

Items acknowledged and carried forward from previous milestone close:

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| *(none)* | | | |

## Session Continuity

Last session: 2026-08-26T01:35:53.218Z
no interrupted agent, no `.continue-here` under any phase directory.**

Verified on resume rather than quoted — and this matters, because the handoff was wrong about
it: `develop` `d895308` = `origin/develop`, `main` `159d3c9` = `origin/main`, tree clean, one
worktree, 0 pending todos. **`HANDOFF.json` recorded `head: 71a638e` and its resume block said
`feature/milestone-v2.0-open-the-doors` was "not merged yet"; both were stale.** The merge
happened during the pause itself, *after* those lines were written —
`git merge-base --is-ancestor feature/milestone-v2.0-open-the-doors main` succeeds. Corrected in
place in both `HANDOFF.json` and `.continue-here.md`, with the wrong reading struck through
rather than deleted. **This is the same failure the 2026-08-20 entry below generalises**: an
artifact written at the moment work is declared finished gets written while the last of it is
still landing. A pause handoff is now the fourth kind of file to fail that way.

**`HANDOFF.json` was held back mid-resume and deleted at the end**, which is the workflow's
rule reached by a different route than the 2026-08-20 precedent. It was kept while steps 9, 10
and 11 were still outstanding, because its `blocking_constraints` governed them and a corrected
handoff is not a stale one; it was removed once step 11 committed. Its content did not die with
it — every constraint it carried also lives in `.continue-here.md`, which was checked before
the delete rather than assumed.

Stopped at (2026-08-25): **`/gsd-new-milestone` finished — all 11 steps.** `SUMMARY.md`
under the load-bearing `v2.0/` path (the five files directly under `.planning/research/` are
v1's and `CLAUDE.md` cites `STACK.md:113` by line, so they were left untouched — verified by a
zero diff, not assumed). Then 36 REQ-IDs, then 13 phases numbered 29-41, then the commits.

**Three guards fired and each was closed by work rather than by relaxation**, which is the part
worth carrying forward. `acceptance-traceability.node.test.ts:901` counts orphans over *every*
checkbox, not only ticked ones — so 36 unstarted requirements were 36 orphans, closed with 36
honest `Not started` rows and never by appending ids to the checker's own exemption list, which
its docblock forbids. `vocabulary.node.test.ts` scans every tracked file for five banned words
and neither `REQUIREMENTS.md` nor `ROADMAP.md` is exempt, so the anti-feature phrasing was
reworded — `SUMMARY.md` may write it only because `.planning/research/` is exempt as a tree.
And `roadmap.analyze` first saw **three** milestone slices, because a backticked heading inside
a citation and a `### Not in v2.0` subheading both matched its pattern; left alone it would have
scoped the new phases out. Fixed in the prose, not in the parser.

**One consequence to state outright: `/gsd-autonomous` was unsafe before the roadmap landed and
is safe now.** It discovered 16 phases, all v1.0/v1.1, fifteen of them already complete on disk
behind an unticked box; it now discovers exactly the 13 v2.0 phases.

Last session: 2026-08-20T09:20:00.000Z — **resumed via `/gsd-resume-work`, nothing was in flight.**
Resume file: None
this resume; it is a one-shot artifact and leaving it on disk makes the *next* resume read a stale
handoff as if it were live.

Verified on resume rather than quoted: `main` `93b9c23` = `origin/main`, `develop` `5e641e5` =
`origin/develop`, working tree clean including untracked, 0 stashes, one worktree. The handoff's
`uncommitted_files: []` matched, so there was no divergence to chase.

Stopped at (2026-08-20): three pieces of bookkeeping this file's own staleness had hidden, all
found by the sweep rather than looked for — **`27-VERIFICATION.md` was the repository's only
remaining `gaps_found` and both gaps it named had been closed for days** (re-measured before the
score moved, `--project e2e` exit 0 / 32 tests and `--project node` exit 0 / 10 tests);
**`v1.1-SHIPPED.md` still recorded 12 of 15 and the sentence "15 of 15 was never reachable"**,
falsified within hours of being archived; and this file's own headline count. Each was amended
rather than back-edited. **One lesson generalises past the three: an artifact written at the moment
work is declared finished is written while the last of it is still landing, and nothing re-reads
it.** A verification file, a milestone archive and a state file all failed the same way here.

**The 2026-08-17 note below is kept because its warning is still live**, not as history: the design
track at `docs/superpowers/specs/2026-08-17-wasm-guest-capabilities-design.md` remains unread by the
owner and unratified. Do not build from it without asking.

Last session: 2026-08-17T18:00:00.000Z (resumed 2026-08-18)
Resume file: `.planning/.continue-here.md` — **that file is the live continuity, not the block
below.** Written 2026-08-17 18:00 PDT and verified on resume: `main` at `b948375` = origin,
`develop` at `01881bd` = origin, tree clean including untracked, one worktree, no stashes, and
every local branch contained in `main`. **No phase is in flight**, `.planning/debug/` holds zero
open sessions, and the v1.1 audit's open-finding residue is empty.

Stopped at (2026-08-17): a **new design track** whose spec is on `main` and **which the owner has
not read** — `docs/superpowers/specs/2026-08-17-wasm-guest-capabilities-design.md`. It was written
under the brainstorming flow, which ends at a review gate, and merged on an explicit
"merge everything" instruction *before* that gate. Design only; nothing executes. The named next
action is an implementation plan for **layers 0–1 only** (handler ABI + capability bus), and it is
**gated on that review**. Do not build from the spec without asking.

**The block below is dated 2026-08-10 and is kept as history rather than rewritten**, on this
file's own amendment convention. It describes Phase 25 and is accurate about it. Note that
`progress:` in the frontmatter counts the **v1.1 slice only** (phases 11–24, fifteen of them) and
predates Phases 25–28.

**CORRECTED 2026-08-18 — the second half of this note was wrong on the day it was written.** It
read: *"so it reads `12 of 15` where the resume file reads `20 of 29` across the whole roadmap; the
two count different populations and neither was moved here."* The first clause stands and the
frontmatter is untouched; **`20 of 29` is not a count of anything.** It comes from
`gsd-sdk query init.progress`, and that list is defective twice over, both verified on disk:
phases 2–8 and 10 carry a bare `SUMMARY.md` with no `*-PLAN.md`, so the tool reads `plan_count: 0`
and reports them `pending` — they are finished **v1.0** work, and it offers
`phase-10-elfconv-aot` as `next_phase`; and **Phase 28 is emitted twice**, once complete at 4/4 and
once as a ghost with `directory: null` and `not_started`. So `29` double-counts one phase and mixes
in nine from a prior milestone. This is the same family as the `progress.bar` defect the
frontmatter comment already warns about — *"it counts plan files across the nine unarchived v1.0
phase directories and reports `17/9 plans (100%)`"* — and it was quoted here as if it were an
independent reading. *(SUPERSEDED 2026-08-22 — that quotation is stale and its mechanism was
wrong. `progress.bar` reports `141/125 plans (100%)` today, and it applies no milestone filter at
all rather than merely failing to exclude v1.0: of the +22 plan inflation only +1 is v1.0, the
other +21 being phases 25-28. The corrected account is in the frontmatter comment above; the
family resemblance to the `init.progress` defect stands.)*

**Recounted on disk: 28 phase directories, 9 v1.0 and 19 post-v1.0, and every
one of the 19 has plan/summary parity or better, so no phase is in flight.** `12 of 15` on criteria
remains the governing figure and nothing in `progress:` was moved.

Stopped at (2026-08-10): **PHASE 25 IS EXECUTED — 4 of 4 plans across 3 waves, on branch
`feature/phase-25-x509-certificate-profile`. NOT YET VERIFIED.** Both post-wave gates are
green and were measured rather than assumed: full `--project node` at **174 files / 2502
passed / 1 skipped, EXIT=0**, `real 381.47 user 385.11 sys 52.82` (CPU ratio 1.15 at load 6.6,
comparable to the 394.54 s / 1.10 baseline, so no regression hides behind contention); full
`--project e2e` at **19 files / 85 passed, EXIT=0**, `real 416.74`, CPU ratio 0.33 — legitimate
for specs that spawn browsers and relays and spend their wall clock waiting.

**What landed.** `packages/core/src/x509.ts`, a bounded hand-written DER decoder for exactly
this profile, with all seven obligations as refusals: Ed25519-only allow-list;
SHA-1/P-192/P-224/RSA refused **by name**, each with its own test; pre-parse byte ceilings;
extension count and size rules; duplicate-`extnID` refusal; canonicalisation as the final gate,
proved by byte-identical re-encode. Plus `packages/core/src/ed25519-backend.ts`, the adapter
the second owner ruling required. No `pkijs`, `asn1js`, `node-forge` or `@peculiar/*` was
added — the locked decision held.

**Six of the seven X509 rows are `[ ] Built, not wired`, and that is the honest state rather
than a shortfall.** `decodeX509Certificate` has no production caller this phase, and this
repository marks `[x]` **iff** reachable from a runnable entry point. Only X509-05 is `[x]`,
recorded delivered-with-evidence against `capability.ts:127/190/255` rather than re-built.

**THE LEDGER PARSER COULD NOT SEE ITS OWN NEW ROWS, caught before the mint landed.**
`acceptance-traceability.node.test.ts` matched requirement ids with `[A-Z]+-\d+` — letters
only — so `X509-01` died at the `5` and all seven rows would have been **invisible** to the
guard, which would then have exited 0 by omission. That file's docblock exists because of a
prior incident of this exact shape. Both regexes widened to `[A-Z][A-Z0-9-]*-\d+` (the pattern
`requirements-ledger.node.test.ts` already used) **in the same commit as the mint**, gated on
an observed matched-row count of **82 → 89**, verified independently. A green run cannot
distinguish *checked and passing* from *invisible*.

**A failure was reported as "pre-existing" and it was ours.** Plan 25-04's summary filed
`reachability.node.test.ts`'s 13-vs-12 collision failure as pre-existing, confirmed by
`git stash` — but that plan's work was already committed, so the stash was a **no-op** and it
compared the tree to itself. Measured with a real control (detached to the pre-phase commit
`10b32ad`): **37/37 green, exit 0**, and still green at the end of 25-01. Cause:
`ed25519-backend.ts#verify` — the adapter ruling puts three implementations of one port in one
module, so three declarations legitimately share a file and a name. Bound raised 12 → 13
carrying its history, the new entry **pinned by name**, and the false claim retracted in place
rather than deleted.

**Four bounds moved this phase and every one was proved TIGHT by planting.** Unreachable
barrel exports 67 → 73 → 75; `OPEN_FINDING_CEILING` 40 → 47 → 49; collisions 12 → 13. Each was
planted one lower, watched red at `PLANTED_EXIT=1`, restored by surgical inverse and
`cmp`-verified. None had slack — slack is the next unwired export slipping in unnoticed.

**The bundle number the ruling demanded: 19 064 bytes gzip**, taken as a delta between two
Vite library builds **within one run** rather than against a hardcoded total, guarded at
`DECODER_BUDGET_BYTES = 25600` (~1.34× headroom, sited). It is deliberately the **conservative
of two honest numbers**: it counts the decoder's transitive `dag-cbor` + `multiformats` graph,
which a page already loading dag-cbor would not pay twice. A real-bundle diff today would
tree-shake to a **false near-zero** — recorded rather than exploited.

**Three further STATE.md corruptions occurred during this phase**, all caught by `git diff`,
none of which errored: `state.planned-phase`, `state.record-session`, `state.advance-plan`.
The unsafe-writer list above now stands at **six verbs**.

**The paragraph below is kept as the pre-execution planning record it was written as.**
**PHASE 25 IS PLANNED — 4 plans, 3 waves, `X509-01…07` minted, status Ready to
execute.** Wave 1 is `25-01` (DER engine) and `25-04` (Ed25519 adapter), which have disjoint
`files_modified`; wave 2 is `25-02` (profile semantics + the ledger mint); wave 3 is `25-03`
(bundle-cost guard). Obligation 5 is recorded **delivered-with-evidence** against
`capability.ts:127/190/255` rather than re-implemented. Six of the seven obligations will ship
`[ ] Built, not wired` — the decoder gets no production caller this phase, and under this
repo's convention (`[x]` iff reachable from a runnable entry point) `[x]` would be false.

**TWO OWNER RULINGS WERE TAKEN 2026-08-09, both recorded in `PROJECT.md` and `25-CONTEXT.md`.**
The Ed25519 backend work stays inside Phase 25 rather than splitting to its own phase. And
**the backend is reached through an adapter** — a synchronous `verify` behind an asynchronous
one-time `init`. That second ruling **dissolves** the async migration rather than deferring it:
measured by execution on Node v25.9.0, `noble.verify` and libsodium's
`crypto_sign_verify_detached` both return a `boolean`, and libsodium's only asynchronous part
is WASM instantiation, which happens **once** at `ready`. So the sync port has two conforming
implementations, `verifyChain` stays synchronous, and `PeerVerifier.verifiedPeers` stays a
synchronous getter. **The consequence is carried rather than buried: `crypto.subtle` cannot
implement the sync port** — a Promise cannot be awaited synchronously — so subtle serves only
the already-async call sites. That **scopes** the first ruling; it does not reverse it.

**THE PLAN CHECKER RAN TWICE AND EACH PASS FOUND A REAL BLOCKER, both fixed.** Pass 1:
`acceptance-traceability.node.test.ts:78/110` parse requirement ids with `[A-Z]+-\d+`, which
**cannot match `X509-01`** — the pattern dies at the `5`. The guard would have exited 0 on all
seven minted rows by **never seeing them**, which is the same shape as the incident that file's
own docblock exists to record. `25-02` now widens both regexes to `[A-Z][A-Z0-9-]*-\d+` — the
pattern `requirements-ledger.node.test.ts` already uses — in the **same commit** as the mint,
gated on an observed matched-row count of **82 → 89** rather than a green suite, because a
green run cannot distinguish *checked and passing* from *invisible*.

Pass 2: `25-04`'s priced call-site count was **wrong in both directions**. It said 9 across 5
files; it double-counted two `agent.ts` lines that are not direct calls, and missed two that
are — `reduce-job.ts:321` and `peer-verifier.ts:557`. **Three different counts existed at once
(9, and two different 10s), which is the finding.** Re-derived by execution: **10 real call
sites across 9 files in 4 packages**, from 11 raw grep hits minus one that is
`mutation-ledger.ts:1473`, **a quoted source line inside a ledger entry rather than a call** —
the quoted-history-reads-as-present-tense hazard turning up unprompted inside the very count
meant to settle the question. The plan now embeds the enumeration **command** so the figure is
re-derivable instead of transcribed.

**`gsd-sdk query state.planned-phase` CORRUPTED THIS FILE AND REPORTED SUCCESS — writer number
four.** It returned `{"updated": ["Status", "Last Activity"]}` and produced a diff of 51
insertions against **103 deletions**, deleting the entire `stopped_at` block: every owner
ruling, the AOT-06 finding, the whole milestone history. Caught by `git diff` immediately after
the call, exactly as the warning block above prescribes — *"every one of these was caught that
way and not by the tool reporting a failure. None of them errored."* Reverted whole-file, which
was safe only because `git status` was verifiably clean beforehand, so the sole uncommitted
delta was the tool's own. **The Status and Last Activity updates were then applied by hand.**
Add `state.planned-phase` to the unsafe list.
Resume file: `.planning/phases/phase-25-x509-certificate-profile/.continue-here.md` — it carries
**two blocking constraints** that each produced a wrong answer before being caught (quoted
history reading as present tense; a blanket `node_modules` symlink in a worktree making guards
verify the main checkout).

**The "10 open phases" premise was false and is corrected here.** Phases 1–10 are complete v1.0
work whose directories are empty, so every directory heuristic reports them as open. The
genuinely open set is **25, 26, 27**, confirmed against `### Phase N:` headings in ROADMAP.md
rather than against directories — `gsd-sdk query roadmap.analyze` returns `phase_count: 0` on
this roadmap, and `phase.add` numbers from directories (it returned 25 for what had to be 27).

### Prior session (2026-08-08T13:23:00.000Z)

Stopped at: context exhaustion at 84% (2026-08-26)
work** — all 15 v1.1 phases have verifications, Phase 22 included (2/3, `fee26c2`). Open work is
`.planning/v1.1-MILESTONE-AUDIT.md`: **9 of 17 findings closed**, 5 auto-fixable remaining
(G1 blocker, G3, G6, G7, G13) and 4 needing an owner call (G4, G5, L3, the 42-symbol residue).
Proceeding to **G1** — a closed seed is unjoinable by the demo page.
Resume file: `.planning/HANDOFF.json` + `.planning/.continue-here.md`.

**Five claims in this file said Phase 22 had four plans and no execution; all five were corrected
2026-08-08 and each correction is marked in place.** The plan/summary count was re-measured on
disk phase by phase — **103 plans, 107 summaries** — rather than derived from the delta.

### Prior session (2026-08-07T08:35:00.000Z)

Stopped at: **Phase 17 re-verified and CLOSED at 3/3** (`17-VERIFICATION.md`, fourth
amendment, 2026-08-07, `human_needed`), and its ledger edits applied — this file is one of
them. **The count is 12 of 15.** Four owner rulings were taken the same session and three
are already executed in the tree: the **narrow** reading of *"the fabric"* (so 24 stays 1/1
and 19 stays 5/5), the orphan-leash exemption **deleted** with `bin/bench.ts` now arming it,
`vitest.config.ts`'s 923 ms row **re-sited** to its measured 21 197, and **X.509 filed as
Phase 25** rather than left in a review document.

**This section read "The count stays 8 of 15" until 2026-08-07, while the frontmatter said
10 and the handoff said 11 — three counts in one file, none of them right.** Recorded rather
than quietly overwritten: a file disagreeing with itself is the defect this milestone keeps
finding, and it kept finding it here.

**AOT-06 is closed as a NEGATIVE with a located cause, 2026-08-07.** elfconv's x86-64 build,
CI arm, published `:amd64` image and Remill amd64 semantics all exist — and lifting an x86-64
ELF still aborts, because `lifter/TraceManager.cpp` finds `main` by matching **literal
AArch64 encodings** (`nop` = `1f 20 03 d5`, `bti c` = `5f 24 03 d5`, `b` = byte `& 0xfc ==
0x14`) on a fixed 4-byte stride, with no amd64 branch. Measured twice — `gcc` and `clang-16`,
two entry points, both `LIFT_EXIT=134` (SIGABRT) with no `.bc` and no `.wasm` — but **the
verdict is carried by the source, not the runs**, which matters because the amd64 image runs
emulated here and a byte pattern that cannot match cannot match on any host. The previous
session's `exit 0` + no artifact is also explained: `elfconv.sh`'s target `case` has **no
`*)` branch**, so an unhandled `TARGET` returns 0 having produced nothing. Two hypotheses
were refuted rather than argued: a missing LLVM dylib (`ldd` shows 0 not-found, and the abort
is elfconv's own thrown `runtime_error`) and the compiler (clang control). Fixing it means
**writing amd64 entry-point discovery**, upstream or as a patch in the submodule — tractable,
not small, and upstream has not done it.

Next unit *(as of 2026-08-07)*: **Phase 22 (Reachability Guard)** — 4 plans, no summaries, and
it runs last. **SUPERSEDED 2026-08-08 — Phase 22 is DONE at 2/3 (`fee26c2`), 4 plans and 4
summaries. Do not resume into it.** The paragraph below is kept because its instruction to
`22-VERIFICATION.md` was carried out, not because the phase is still open.
**The ordering ruling was re-confirmed 2026-08-07 and no longer blocks it.**
22 was placed after 24 so the guard would certify a *gated* fabric; under the narrow reading
of criterion 8 it will certify a fabric with an admission posture stated on every
relay-capable door, which is what the 2026-08-05 ruling assumed. `22-VERIFICATION.md` should
still state plainly that the **default argv posture of every binary is open and must be** —
that is criterion 8's stated bound and a guard inherits it.

**The pre-execution blocker that stood here has been overtaken by events, and what replaced
it is narrower and worse.** The blocker read that 24-03 would arm the gate on
`fabric-node.ts` with no spawnable entry point in its `files_modified`, leaving
`bin/agent.ts` open by a value no plan touched. **That half is closed**: `bin/agent.ts`
now takes a hex-validated, repeatable `--admit-issuer`, writes
`relayAdmission: new Set(values['admit-issuer'])`, and publishes its posture as a sorted
array on the handshake line — verified by the phase's own census. **The other half is not,
and it cannot be closed by a flag that does not exist** *(SUPERSEDED 2026-08-08: the flag now
exists — `afe8b0b` — and criterion 8 was re-scored MET at `580e461`. Kept because it records
what was owed and why)*: `bin/seed.ts` has no
`--admit-issuer`, `SeedServerOptions` has no `relayAdmission` field, and `seed-server.ts`
writes `relayAdmission: 'admits-any-peer'` at its `FabricNode.start` call. `--trusted-issuer`
threads to `trustedIssuers` — *selection* — and never to `relayAdmission`, which is the
conflation that field exists to prevent. 24-01 left this open deliberately, saying so above
the value: *"Pinning it is a later decision and is deliberately not taken here."* **It is
now the reason criterion 8 does not close, so the deferral has a price and the price is
recorded.**

**The owner ruling this waits on, stated as a choice rather than a description.** Either
(a) `SeedServerOptions.relayAdmission` and `bin/seed.ts --admit-issuer` are added and
criterion 8 is re-read over a fabric in which every relay-capable peer an unadmitted node
can reach has been told to close — under which criterion 8 can reach **MET**, and 19's and
17's carried clauses close with it; or (b) the owner rules that the seed stays open and
criterion 8 is restated as a property of *a relay*. **A verifier may not take route (b)**,
and neither may an executor: RULING A forbids rewriting a criterion to let a phase close.
If (b) is chosen, the instrument is an `overrides:` entry on the verification or a dated
owner note beside the criterion — **not** a change to the criterion's words.

**Two further deferrals are recorded rather than fixed, and both are named in the source.**
The relay-side refusal reasons have **no wire surface**: in-process the gate distinguishes
*"holds no provider-issued certificate"* from *"certificate issued by …, which is not a
pinned provider"*, and both reach a joiner in another process as one undifferentiated
`PERMISSION_DENIED`, so an operator debugging a refused agent from its own stderr cannot
tell the two apart. And gating the `records` / `providers` answers on the certificate is
filed in `24-CONTEXT.md` as a deferred idea — a directly-dialable peer still reaches both.
Neither is descoped; both are unbuilt.

**Phases run sequentially from here, and that is a measured constraint rather than a
preference.** Their declared `files_modified` overlap heavily — `fabric-node.ts` in
14/15/17/21, `bin/bench.ts` in 14/15/16/17/23, `browser-node.ts` in 14/15/17/21 — because
"Wire What Was Built" means every phase converges on the same construction sites. Only
verification of one phase overlaps safely with execution of another, and only when their
planning directories differ.

**How Phase 14 was actually run, for whoever picks this up:** five plans, four waves, each
executor in its own `isolation="worktree"` agent, merged back one wave at a time with a
`tsc` + targeted-vitest gate between waves. Two things made it work that are not obvious.
First, **a worktree has no `node_modules`, and symlinking the main checkout's wholesale is
silently wrong** — `node_modules/@o2/*` are relative symlinks back to the *main* checkout,
so `tsc` and `vitest` verify the wrong tree and report clean without reading the agent's
changes. Every executor built a resolver farm and proved it with
`createRequire().resolve()` before editing. Second, **each wave's prompt carried the prior
wave's corrections**, because a correction recorded in a SUMMARY reaches no sibling plan.

### Off-roadmap work, 2026-08-06 — the technical peer comparison

Not attributable to any phase. `docs/business/o2-vs-peers-study.md` joins the AWS study as the
second business document: an apples-to-apples technical comparison of o2 **as specified when
complete** against wasmCloud, Cloudflare Workers, the Internet Computer, Bacalhau/Fluence, BOINC
and Apple Private Cloud Compute. Eight parallel research streams, primary sources, tier-tagged.

Four findings bear on decisions outside the document and are recorded here so they are not lost
with it:

- **BOINC's fix for the redundancy tax.** Twenty years of measurement: *"at least 50% of total
  CPU time is spent checking result validity."* Their answer was **reputation-gated selective
  replication at 5-10%**, not uniform 2-3×. This project has the primitives BOINC lacked —
  enrolment, certificates, per-node signed results. Highest-leverage change identified.

- **Cross-architecture NaN divergence in V8 was measured**, closing the open question recorded in
  `CLAUDE.md` ("no measurement found"). Identical wasm bytes, identical V8 12.9.202.28, arm64 vs
  x86-64: **6 of 10 primitive float ops produce different bits**, stable across 2M iterations and
  both JIT tiers — a mixed-architecture quorum yields a **permanent 2-2 split**, not a flaky
  minority. Binaryen `denan` v131 made all ten bit-identical at ~3.0-3.6× on float-saturated
  code. **Caveat: the x86-64 side ran under Rosetta 2 (`hw.optional.fma: 0`); native confirmation
  is owed before this is quoted as settled.** Open design question this raises: DAG-CBOR at the
  serialization boundary fails closed on a NaN-*valued* output, but a NaN-*influenced* output —
  one flowing through a comparison, bitcast or branch to a finite-but-different number per
  architecture — would encode happily. If quorums can ever span arm64 and x86-64 this wants a
  ruling.

- **Public IPFS retrieval is not a viable artifact path.** Cloudflare's gateway ended 2024-08-14,
  Brave removed `ipfs://` 2024-08-22, the IPFS Foundation's own docs say public gateways are
  *"not intended to be part of your critical path or production infrastructure"*, and Filecoin's
  measured network-wide retrieval success rate was **12.8%** (Sept 2024). Bluesky/atproto solves
  this in production with a **CDN keyed by CID** — content addressing preserved, and the V8
  code-caching path with it.

- **There is nothing to adopt for the decentralized DB.** Measured by commits, not `pushed_at`
  (which misleads): OrbitDB **0 commits since 2026-05-15** and version-incompatible anyway
  (`multiformats@^13`/`uint8arrays@^5`/`helia@^6` against this project's 14/6/7 — the exact
  `CID instanceof` boundary `CLAUDE.md` warns about), with open issue **#1255 "Sync never
  delivers the first entry to a reader connected only through a relay"** sitting on this
  project's own topology. GUN: 4 commits in 12 months. Ceramic: 0 since 2025-10-20. Calibration:
  `ipfs/helia` logged 56 commits in the trailing 90 days. Build it; the category vacated.

Two corrections the owner made during the work, both recorded because they are the recurring
failure mode: the supply model is **any device with a JS engine** — browser, Node, and embedded
in a host app — not "browser tabs"; and native mobile embedding is **not** a weak leg, because
`nodejs-mobile`'s *"On iOS, WASM is unsupported"* is that library's build configuration, not a
platform limit. WASM has run on iPhone since 2019, and both embedding paths (in-process V8,
embedded WebView) are owner-tested. **A library's disabled build flag is not a platform
prohibition.** Only watchOS is genuinely closed (`ENABLE(WEBASSEMBLY) && !PLATFORM(WATCHOS)`).

Licensing is excluded from the study's structural ranking by owner decision — the licence is
planned to change. With it out, the top structural weakness is **`operatorId` being a
requester-chosen free-text string the provider signs without verifying**, which is the same
defect as the absent commit-reveal seen from another angle: nothing makes an identity scarce, so
"independent agreement" is an assertion rather than a measurement. Open for an owner ruling.

### Off-roadmap work, 2026-07-29 → 2026-07-31

Not attributable to any phase, and recorded here so it is not mistaken for phase progress.
65 commits, all merged to `develop` and pushed; `develop` and `main` both match origin and
the tree is clean.

- **A 22-bug round.** Seven verification gaps and four timing defects closed. The timing
  class is the one worth remembering: **a test arms two clocks — its own internal budget
  and the framework's `testTimeout` — and the framework's must be the larger.** Inverted,
  the internal timer can never fire and the test cannot express the thing it was written
  to express. Related, and learned the hard way three times in a row: **size a bound
  against the worst case the file can construct, not the typical one**, and **never set a
  timing bound from a number you did not measure yourself.** One such guess set
  `timeoutMs` to 300 s against a lift that really takes 304.3 s and turned six tests red;
  it was reverted.

- **A security residual closed in `browser-node.ts`.** `createWorker` became required and
  the `worker ?? new WasmExecutor(...)` fallback was deleted, so a browser node can no
  longer silently execute on the main thread. The `offMainThread` getter went with it —
  once it could only return one value, the four e2e assertions reading it were tautologies.

- **31/31 mutations caught**, and the full suite passed at load 89-160.
- **The elfconv lifted-vs-native benchmark** (`tools/aot/bench-lifted.ts`, `fixtures/workload.c`).
  Findings in `.planning/BENCHMARK-RESULTS.md` and in commit `ce05cf2`; the two that bear
  on Phase 21 are below under Blockers/Concerns.

Two items were deferred to the owner and are still open: the benchmark's row-order confound
(load drifted 29→49 mid-run, so no inter-row difference under ~20% is claimed — fixing it
needs interleaved rows or a quiet host), and the `lift.node.test.ts` integration timeout,
where `INTEGRATION_TIMEOUT_MS` of 15 min wraps 45 min of internal budget. The measurement
that decision was waiting on now exists: a real lift takes **152.7-304.3 s** depending on
load, a 2× swing, so any fixed budget has to be sized against that whole range.

The three paragraphs below this line are older sessions' notes that were appended here
rather than replaced; they describe Phases 9 and 3 and are kept because they are still
accurate about those phases. They are not a description of the current position.
DEMO-04 still holds and is now enforced by `disclosure-gate.node.test.ts`: no deploy
workflow file may exist in the repository at all, absent rather than disabled, and no
`package.json` script may publish. `build:demo` builds; nothing deploys.

**The two-device run happened, and was worth it.** The owner ran the demo on an
iPhone and a laptop against one LAN seed on 2026-07-26: both joined, one peer
connected, the search distributed, the answer verified in the page. It found two
defects the whole e2e suite had passed over — an always-visible bar that was
literally always visible (an id `display` rule outranks `[hidden]`, and the tests
asserted the attribute rather than the screen), and a peer filter that matched the
relay's own id inside every circuit address, so two devices on one relay skipped
every candidate and never heard of each other. Both fixed and now tested.
Resume file: `.planning/.continue-here.md` (rewritten 2026-07-31, `status: merged_clean` —
nothing in flight, and it leads with the two open owner decisions listed under Pending
Todos above)
(no static determinism analysis, no cross-implementation verification, no host-import
allow-list). Still current; they apply to every later phase.

**Phase 3 still needs a human decision for the "public host" half.** Real AutoTLS
(criterion 2) requires publicly reachable infrastructure — outward-facing and hard to
reverse, and it collides with the disclosure gate above (now crossed — but a public relay
is still a hosting decision, not a disclosure one). Deliberately not done autonomously.
**Criterion 1 is no longer part of this.** It was restated on 2026-07-28 to two browsers
or two isolated browser contexts on one machine, per the testing-standard ruling, and it
had already been closed in a stronger form than the restatement asks — an iPhone running
Safari and a laptop running Chromium, on genuinely different machines, over direct WebRTC
with the relay carrying SDP only. That stronger result stands in the record.

DEPLOYED READINGS, 2026-08-31 — the owner chose to close 30/31/32 against the live node
rather than plan phase 33, and four of the five open criteria moved.
PHASE 30 CRITERION 1 — **MET**. 24 peers dialled `v2.0.0-rc.7` together, 24 of 24 admitted in
987 ms. The anti-vacuity is arithmetic and not a plant: an 8-peer run took 1 705 ms and was
DISCARDED, because the library default of five per second per host would have passed eight
over that span too. Criterion 3's deployed half stays OPEN — it wants the remote address read
off the node's own connection list and this tier serves no route that answers it. Adding one
to close a criterion would invert the rule that every route is a surface.
PHASE 32 CRITERION 1 — **MET**. Two real Chromium tabs reserved on the deployed relay and met
over WebRTC, `{limited: false, webrtc: true}`, with the signalling circuit still open beside
it. The criterion's own observable — *the relay's byte counter flat* — was CORRECTED by
measurement and the correction is stronger: the circuit stays open and yamux keeps it alive,
so an absolute flat would fail on a fabric doing the right thing. Idle 12 s window `+3 376`
relay bytes; busy 12 s window with 38 compute rounds `+2 728`, less, while the pair moved
`+20 710` of its own.
PHASE 32 CRITERION 2 — **MET, and without touching production.** Run on a real local workerd
with `ANNOUNCE_MULTIADDRS` emptied. The predicted empty reservation did not occur and what
occurred is better: `Uncaught NoAnnouncedAddressError`, read from the runtime's own log, so
the assembly refuses to build and there is no relay left to hand anything out. The silent
failure is unconstructible rather than merely detectable.
PHASE 31 CRITERION 2 — **HALF TAKEN, HALF PENDING ON A CLOCK.** A provider record is published
on the deployed object at `2026-08-31T16:01:02.294Z`, CID
`bafkreidss5xiinknhpb5p3kwdr2ft6jmka3pzon4f5x7ai3k2q5a2547oi`, and PRESENT AT T read back by
a different freshly-minted peer. Both numbers come from `providerRecordPolicy()`: gone by
`17:01:02Z`, swept by `17:16:02Z`. **THE SECOND READ LANDED AT `17:17:07Z` AND CLOSES BOTH —
BUT NOT ON ITS OWN.** The fresh peer got `[]`, and the bare absence was not accepted: a control
in the same run had a record published SECONDS EARLIER also read empty, which put the fault in
the probe rather than in the fabric — `dht.provide()` is an async generator and `await`ing it
runs nothing, so the control had published nothing. (Production iterates it correctly at
`dht-provider-announcer.ts:254`; nothing to fix there.) With the publish actually performed, a
DIFFERENT freshly-minted reader — not the publisher, because `findProviders` consults the local
provider store first — found the seconds-old record through the deployed relay and did not find
the one from T. So the absence is a property of the record's age. That it was DELETED rather
than filtered out rests on a measurement already in the record: kad-dht applies no date filter
on the provider read path, so a stored record would have come back. Deletion here is the
alarm-driven sweep, which is `HOST-13`'s platform half — Cloudflare fired the alarm on an
instance that did not arm it. Criterion 2 MET, `HOST-13` `Done`.
**The methodology is the transferable part, not the verdict.** The first form of this reading
would have passed and been wrong, for the second time in two days, and both times the thing
that caught it was a control arm inside the same run rather than a re-reading of the code.
AND I RECORDED A DEFECT THAT WAS NOT THERE, then withdrew it within the hour. The first
attempt at the record above used DIAL-ONLY probe peers; `@libp2p/kad-dht`'s
`add-provider.js` ignores a provider whose message carries no addresses and answers the RPC
anyway, so the write was acknowledged and dropped. I read that as *the deployed object accepts
ADD_PROVIDER and does not serve it back* and committed it. Three hypotheses were killed by
measurement before the cause was found — the `DoDatastore` namespace refusal, the prefix
query, and a cache in `providers.js` — and what settled it was reading the LOCAL workerd's
Durable Object storage through `--persist-to` and finding no `/dht/provider/` key at all,
which moved the question from the read path to the write path. **The readings were accurate
and the conclusion was attribution by plausibility.**
ONE MORE FINDING, BELONGING TO A LATER PHASE: the deployed relay answers no fabric
rendezvous. `findReservedPeers` speaks the fabric's own RPC and `hosted-libp2p.ts` registers
no handler, so two tabs on the deployed relay CANNOT DISCOVER EACH OTHER without being told.
**FIXED, DEPLOYED AND READ BACK THE SAME DAY.** The cause was structural rather than an
oversight: the answer existed once, as a branch of `serveAgent`, and `AgentOptions` requires an
`executor` and a `blockstore` with no named opt-out — so a relay could not answer without also
shipping a WASM executor. `serveReservations` is that branch alone, refusing every other kind
BY NAME rather than by silence. Reproduced before it was fixed, on a real workerd:
*"the relay did not answer /o2/rpc/1.0.0 at all: expected +0 to be 1"*. On the deployed node
after `v2.0.0-rc.7`: a seeker told only the relay's address got `answered: 1` and the
reserver's circuit address, and an `offer` came back refused by name. The redeploy also read
the relay-service journal back — `inboundHopStreams: 12`, marker `1788191433180` — so that
record survives a REDEPLOY and not only an eviction, which no reading had taken.
Criterion 1's run supplied the address from the harness, exactly as `two-tabs.e2e.test.ts`
does for `NET-02`, and criterion 1 says nothing about discovery — but a public run would.
