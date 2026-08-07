---
phase: phase-24-certificate-gated-admission
plan: 08
subsystem: admission
tags: [AUTH-02, AUTH-04, browser-tier, seed, gap-closure, measurement]
verdict: the browser tier is read at the door a tab actually meets, in three engines — and the advertisement surface the demo consumes is a gated one
requires: [05, 06]
provides:
  - "the browser tier read against a real SeedServer that pins an issuer, in chromium, firefox and webkit"
  - "BootstrapInfo.peerAddrs read as a gated surface AS SERVED TO THE TAB, with a paired presence and absence"
  - "demo/main.ts's consumption of peerAddrs read behaviourally through TabDiscoveryRound"
affects:
  - "24-VERIFICATION §2's two browser-tier findings have measurements"
tech-stack:
  added: []
  patterns:
    - "a source-posture guard must run BEFORE the behavioural readings, or the mutation it exists to catch reddens something else first and the guard is never reached"
    - "attempted = dialed ∪ failed.map(targetOf) — `dialed` alone cannot express 'the round tried this peer' when no advertised peer is reachable at its advertised address"
key-files:
  created:
    - packages/node/src/gated-seed.e2e.test.ts
  modified: []
decisions:
  - "A `memberNode` was added to the fixture, which the plan did not specify. Without an admitted peer, every absence reading is also satisfied by a seed that advertises nobody at all — the positive control is what makes the pair a measurement."
  - "The plan's must-have `dialed` naming the seed is MEASURABLY FALSE. DialPlanner skips a peer already held over a work-carrying connection, and reserving the circuit already opened that connection. The honest instrument is `attempted`, not `dialed`."
  - "The two source-posture guards were moved ahead of the behavioural readings after measuring — twice — that both mutations they exist to catch reddened a `stays` first and never reached them. A proof that cannot fail first is not a proof."
metrics:
  duration: ~55 min
  completed: 2026-08-06
  commits: 0
---

# Phase 24 Plan 08: The Browser Tier at the Seed's Own Door — Summary

## THE RESULT

**A browser tab that holds no certificate obtains no reservation on a seed that has been told
to close; the same tab id, enrolled at a *separated* provider and restarted on the same origin,
is admitted — in chromium, firefox and webkit, against a real `SeedServer` serving the demo page
and `/bootstrap.json` from its own origin.** And the surface `packages/browser/demo/main.ts`
actually consumes, `BootstrapInfo.peerAddrs`, carries the admitted peers and never the refused
one — read as the tab receives it, and read again through what the tab *did* with it.

Output: `packages/node/src/gated-seed.e2e.test.ts` — 4 cases, `real 71.16`, exit 0.

The topology is **separated** and that is the stronger reading: 24-04 built the co-located one,
`ROADMAP.md`'s correction of 2026-08-05 records that separation was believed to break enrolment,
and 24-05 measured that it does not. This file is the browser-tier half of that.

---

## Per-engine outcomes, stated engine by engine

Taken from the final green run (20:31:04, load **14.55 → 8.89**, `EXIT=0` read on the line
immediately after the command). The file publishes its own readings, so these are transcribed
from the run rather than described:

```
[gated-seed] chromium: tab=3DxGSDJp seed=MpqpvL3Q member=ppPwBhRs stranger=rVwB8W26
             peerAddrs=[MpqpvL3Q ppPwBhRs 3DxGSDJp] asked=true
             dialed=[] failed=[ppPwBhRs] attempted=[ppPwBhRs]
[gated-seed] firefox:  tab=ekbSeEZA  peerAddrs=[MpqpvL3Q ppPwBhRs 3DxGSDJp ekbSeEZA] asked=true
             dialed=[] failed=[ppPwBhRs 3DxGSDJp] attempted=[ppPwBhRs 3DxGSDJp]
[gated-seed] webkit:   tab=z7SweYV9  peerAddrs=[MpqpvL3Q ppPwBhRs 3DxGSDJp ekbSeEZA z7SweYV9] asked=true
             dialed=[] failed=[ppPwBhRs 3DxGSDJp ekbSeEZA] attempted=[ppPwBhRs 3DxGSDJp ekbSeEZA]
```

| engine | case | duration | absent unenrolled | present enrolled | `stranger` in `peerAddrs` | `stranger` attempted | direct dial reached it |
|---|---|---|---|---|---|---|---|
| **chromium** | passed | 19 936 ms | yes, held 6 s | yes | **never** | **never** | yes |
| **firefox** | passed | 21 623 ms | yes, held 6 s | yes | **never** | **never** | yes |
| **webkit** | passed | 20 484 ms | yes, held 6 s | yes | **never** | **never** | yes |
| fixture | passed | 6 870 ms | — | — | — | — | — |

**Three engines, three readings.** No engine was excluded and none was skipped; a launch failure
is re-thrown by name (`${name} could not take part`) rather than allowed to vanish.

`stranger=rVwB8W26` appears in **no** engine's `peerAddrs` and in **no** engine's attempts,
while `member=ppPwBhRs` appears in every one of both. The two nodes differ in exactly one option.

---

## What the browser tier now demonstrates, at the door a tab actually meets

1. **The tab learns its relay from the origin, not from the harness.** `startTabNode` calls
   `window.o2.discoverRelays()` inside the page and refuses to proceed unless it answers
   `'origin'`. No address in either arm was passed in by this file.
2. **Refused, over a window rather than at an instant.** The unenrolled tab is *connected to the
   seed* (asserted, so the absence is not what a tab that never started looks like) and holds no
   reservation across 6 s, with the seed's own decision naming it:
   `… holds no provider-issued certificate, so it is not admitted to this relay`.
3. **Admitted after enrolling at a different node.** `stop()` → `start({ enrollment })` on the
   same origin, same IndexedDB seed, therefore **the same peer id** (asserted). The seed's log
   then reads `holds a certificate from a pinned issuer`, and the certificate's issuer — read
   over the fabric's own `records` request, not off the tab's word — is the **provider's**.
4. **The tautology is demonstrated, not warned about.** `browser-node.ts` passes
   `reservations: 'relays-for-nobody'`, so the tab answers `[]` about itself in *both* arms. The
   file asserts that constant twice per engine, so a reading built on it is shown to be one.

---

## How `demo/main.ts`'s consumption of `peerAddrs` is covered, and what it would catch

`demo/main.ts` fetches `/bootstrap.json` and pushes **every** string in `info.peerAddrs` into
`candidates`; step 2 of the same round calls `findReservedPeers`, which asks connected peers the
same `reservations` question. Both sources are derived from reservation stores, so a refused peer
is absent **structurally** — there is no `if` to forget. This file reads that surface twice:

- **as content, as served to the tab** — fetched from the test process at the seed's own HTTP
  port with `Host: 127.0.0.1:<httpPort>`, the same bytes the tab's own
  `fetch('/bootstrap.json', { cache: 'no-store' })` receives. Presence first
  (`until` the enrolled tab appears), absence second (`stays` over a window arm B has already
  shown to be long enough on this host), with the **member present in both arms** as the control
  that stops the pair from being satisfied by a seed advertising nobody.
- **as behaviour** — `window.o2.connectDiscoveredPeers()` in the page, reading the real
  `TabDiscoveryRound`. `asked === true` (so an empty round is not read as a pass), the member is
  in `attempted`, and the stranger is in neither `dialed` nor any string of `failed`.

**What the assertion would catch:** any change that puts a peer into the seed's advertisement
without a reservation behind it. Measured directly — plant **Pb** widened the derivation from
`node.reservedPeerIds` to `node.transport.peers` and the content half went red in all three
engines in 2–5 ms; plant **Pc** carried the same widening through to the round and the tab
*attempted the stranger*, naming its full circuit address. It also caught the same widening
applied by **another agent** in this working tree, unprompted (see Finding 2).

**The limit is a standing assertion on every green, not a plant.** Handed
`strangerNode.browserDialableAddrs[0]`, `window.o2.dial(...)` resolves to `strangerNode.peerId`
and `window.o2.peers()` then contains it — in all three engines. **A refused node is
unfindable, not unreachable**, and the two are different claims.

---

## Plants — counted before applied, `cmp`'d to confirm the file differed, watched red, restored with `cp` + `cmp`

Every exit code below was read with `EXIT=$?` on the line **immediately** after the command — no
pipes, no trailing `tail`, no `echo` between. Every plant was `cmp`'d against a `/tmp` baseline
**before** its run and confirmed to differ. No `git add`, no `git commit`, no `git stash`, no
`git checkout --`.

| plant | edit | exit | what reddened | what stayed green | observed failure text, verbatim | span |
|---|---|---|---|---|---|---|
| **Pa** | the **seed's** posture in this file opened to the open literal | 1 | fixture in **9 ms** + all 3 engines | — | `AssertionError: expected 3 to be 4 // Object.is equality` (the pinned-site count); and per engine `chromium's unenrolled tab staying out of the seed's reservation store stopped holding after 0ms; observed {"reserved":[…3 ids…],"decisions":[]}` | 6.48 s |
| **Pa′** | the **minting provider's** posture opened — a site no behavioural reading touches | 1 | fixture in **8 ms**, alone | **3 engines green** | `AssertionError: expected +0 to be 1 // Object.is equality` at `occurrences(ownSource, \`${FIELD}: new Set<PublicKeyHex>(),\`)` | 63.63 s |
| **Pb** | `seed-server.ts`'s `peerAddrs` widened `reservedPeerIds` → `transport.peers` | 1 | task 2's **content** half, 3 engines, at 2–5 ms | **fixture green (6 885 ms)** | `chromium's unenrolled tab and the stranger staying out of the seed's peerAddrs stopped holding after 5ms; observed {"peerAddrs":[…4 entries…]}` | 31.70 s |
| **Pc** | Pb's widening **plus** the two `peerAddrs` absence predicates suppressed so the round is reached | 1 | task 2's **consumption** half, 3 engines | **fixture green** | `AssertionError: expected [ Array(1) ] to strictly equal []` / `+ "/ip4/127.0.0.1/tcp/63783/ws/p2p/12D3KooW…TeTEadSy/p2p-circuit/webrtc/p2p/12D3KooW…XLL72i97"` at `round.failed.filter(…)` | 70.78 s |
| **Pd** | arm B's `enrollment` removed, otherwise identical | 1 | task 1's **presence** half, 3 engines | **fixture green (6 905 ms)** | `timed out waiting for chromium's enrolled tab to obtain a reservation at the seed that refused it; observed {"reserved":["…C7i9"],"decisions":[{…"admitted":true,"reason":"…holds a certificate from a pinned issuer"…},{…"admitted":false,"reason":"…holds no provider-issued certificate, so it is not admitted to this relay"…}×2]}` | 230.26 s |
| **Pe** | `seed-server.ts`'s `relayAdmission: options.relayAdmission,` → the open literal | 1 | fixture in **240 ms**, alone (engines skipped by `-t`) | — | `AssertionError: expected '/**\n * The seed node — one command t…' to contain 'relayAdmission: options.relayAdmissio…'` | 1.37 s |

### Pd's duration is evidence of the timeout and of nothing else

229 s against three 60 s `until` budgets. **The load-bearing half is the `observed` payload**,
which names the seed's own decisions — the tab refused twice by name, the store holding only the
member — while the fixture is alive and the member is still in it. That is a reading of the
fabric; the 229 s is a reading of the clock. The budget was not shortened to make the plant
cheaper: it is sited against `RELAY_ADMISSION_DEADLINE_MS` (3 500 ms) and libp2p's own 5 000 ms
reservation completion timeout, with a page load on top.

### Pb and Pc could NOT be separated by one edit, and that is disclosed rather than implied

The plan anticipated this. **Pb's widening reddens the content half *before* the round is ever
reached**, so with Pb alone the consumption assertion is never evaluated and cannot be watched.
**Pc is therefore Pb plus a second edit** — the two `peerAddrs` absence predicates in this file
replaced by `async () => false` — which lets execution reach the round. That is 24-05's P1/P1b
pattern, and both runs are recorded; neither is substituted for the other. What Pc then shows is
the load-bearing thing: the tab **attempted the peer the seed advertised**, which is what makes
the coverage of `demo/main.ts` real rather than nominal.

### One assertion in this file has never been watched fail, and this is which one

`expect(round.dialed).not.toContain(strangerNode.peerId)` stayed **green under Pc** — because
`dialed` is empty on this fixture in every arm. The claim is carried entirely by its companion,
`expect(round.failed.filter((a) => a.includes(strangerNode.peerId))).toStrictEqual([])`, which is
the one that reddened. The `dialed` line is belt-and-braces and is reported as such rather than
counted as a proof. See UNMEASURED (1) for what would make it discriminating.

---

## Findings

### Finding 1 — the plan's `dialed` must-have is measurably false, and the honest instrument is `attempted`

The plan states: *"`dialed` naming the seed (and any other admitted peer)"*. **Measured: `dialed`
is empty in all three engines, on every green run.** Two independent reasons, both in the tree
already:

1. **The seed is never dialled.** `DialPlanner.plan` skips any peer already held over a
   connection that carries work, and reserving the circuit *is* that connection.
   `seed-discovery.e2e.test.ts` records the same sentence about itself — *"No dial is needed for
   the seed itself"*.
2. **Every other advertised entry is a `/p2p-circuit/webrtc/` address.** A Node `FabricNode`
   binds no `/webrtc` listener and a closed tab is gone, so each attempt fails fast and lands in
   `failed` (which holds *addresses*) rather than `dialed` (which holds *peer ids*).

So the file reads `attempted = dialed ∪ failed.map(targetOf)` and asserts on that. **This is not
a weakening**: the claim being made is about *discovery* — what the round tried — and "attempted
and failed" is a strictly more inclusive test for the stranger's absence than "dialled
successfully" would be. Pc confirms it discriminates.

### Finding 2 — this file caught two mutations planted by a concurrent plan, and both were attributed by measurement rather than by plausibility

24-07 was executing in this same working tree. Twice, a run of this spec went red with no plant
of mine applied:

- **20:13** — `seed-server.ts` held `relayAdmission: 'admits-any-peer',` in place of the
  forwarded option (24-06's own plant P1). Confirmed present by `grep -c` **before and after**
  the run, so the reading is bounded. All four cases went red, the fixture in 103 ms.
- **20:15** — `seed-server.ts` was clean of *that* mutation (grep 0 at both ends) yet
  `peerAddrs` came back with a **duplicated** entry. `git diff` was empty by the time I looked,
  so the cause could have been called a flake. It was not: the observed order was
  `member, member, stranger, tab`, and **a duplicate in first-and-second position with the
  refused peer third is produced by `[...reservedPeerIds, ...transport.peers]` and by nothing
  else** — pristine `reservedPeerIds.map(…)` cannot emit a duplicate at all. That is 24-07's
  Node-tier widening plant, in flight. A subsequent run on a verified-clean tree was green.

"Passes in isolation" was **not** accepted as the diagnosis in either case; the multiplicity and
ordering of the addresses were what settled the second, and a before/after `grep` settled the
first. Recorded because it is also an **unplanned independent confirmation of Pb/Pc**: a
different agent's widening, made for a different plan, reddened the same assertion of mine.

### Finding 3 — a source guard placed after a behavioural one is a proof that cannot fail

The plan puts the posture-off-source reading in task 1 without fixing its position, and I first
wrote it last in the fixture case. **Both mutations it exists to catch reddened a `stays` first**
— my own Pa at 103 ms, and 24-07's live `seed-server.ts` mutation at 103 ms — so those lines were
never reached in either case. That is the repository's own rule (*a proof that cannot fail is not
a proof*) breached by ordering rather than by content.

Moved ahead of the behavioural readings, and re-measured: **Pa now reddens in 9 ms naming the
posture count that moved, and Pe in 240 ms naming the file that stopped forwarding the option.**
Pa and Pa′ were **re-run against the reordered file** rather than left recorded against the code
as it no longer stands. The behavioural readings still redden behind them, unchanged.

### Finding 4 — an open posture supplies no gater method, so nobody is asked, and the observation says so

Every `observed` payload under Pa reads `"decisions":[]`. `'admits-any-peer'` produces **no
`denyInboundRelayReservation` hook at all** — so an open seed's decision log is empty *because
nothing was consulted*, not because everything was approved. The fixture case reads a **named
refusal** for the stranger and a **named admission** for the member, which makes the log a live
reading of the posture and not only of the outcome.

### Finding 5 — `window.o2` has no `certificate()`, and no API was invented for one

`gated-admission.e2e.test.ts` reads `window.o2capability.certificate()`; the **demo's** `TabApi`
has no such method, and the plan forbids modifying `tab-api.ts` or `demo/main.ts`. The certificate
is therefore read **over the fabric's own `records` request** from the seed's node, via
`RpcRecordIndex` with the node key computed offline from the peer id — the same path
`demo/main.ts`'s own `peerCertificate` takes. That is a stronger reading than the tab's word
about itself, and it cost no production change.

---

## Measurements, with their conditions

8-core host; load is the 1-minute average. Every exit code read with `EXIT=$?` on the line
**immediately** after the command.

| command | exit | result | process reading | load |
|---|---|---|---|---|
| `npx vitest run --project e2e gated-seed.e2e.test.ts` — **against the committed tree `241a9cc`** | **0** | 4 tests, 3 engines | `real 70.91 user 9.11 sys 2.65` | **8.98 → 7.41** |
| the same, on the pre-commit tree | **0** | 4 tests, 3 engines | `real 71.16 user 9.10 sys 2.50` | 14.55 → 8.89 |
| the same, first green | **0** | 4 tests | `real 70.82 user 9.08 sys 2.58` | 7.37 → 6.44 |
| the same, second green (with publication) | **0** | 4 tests | `real 71.02 user 8.99 sys 2.62` | 5.59 → 6.92 |
| the same, re-run on a verified-clean tree | **0** | 4 tests | `real 70.62 user 8.82 sys 2.55` | 8.40 → 6.10 |
| `npx vitest run --project e2e` | **0** | **17 files, 80 tests** | `real 300.55 user 118.63 sys 30.95`, ratio **0.50** | → 16.86 |
| `npx vitest run --project e2e gated-admission.e2e.test.ts seed-discovery.e2e.test.ts` | **0** | 2 files, 13 tests | `real 29.33 user 10.60 sys 3.81` | 14.33 → 10.27 |
| `npx vitest run --project node slow-specs.node.test.ts` | **0** | 9 tests, drift within tolerance | `real 1.05 user 0.72 sys 0.17` | 6.45 |
| `npx tsc --noEmit` | **0** | **zero bytes of output** | — | — |
| `npx vitest run --project browser` | **0** | **249 files, 4101 tests** | `real 48.39 user 94.22 sys 22.95` | 10.01 → 20.91 |

**`(user+sys)/real` is ≈0.16** on the solo green runs. Three browser launches, three page loads,
six 6 s absence windows and a great many reservation round trips — most of that wall clock is
waiting, not computing. **A comparability key, not a verdict**, and it is stable across five
green runs (0.164, 0.163, 0.161, 0.163, 0.166) taken at loads from 5.59 to 14.55, which is why
the five are comparable rather than merely all green.

### Counts, accounted for rather than asserted

- **e2e project: 16 → 17 files, 76 → 80 tests.** Exactly this plan's one file and four cases.
- **browser project: 249 files / 4101 tests — unmoved** from 24-06's reading. Expected: an
  `*.e2e.test.ts` is excluded from that project. A move would have been a finding.
- **`NODE_MEASUREMENT.files` does not move for this plan — verified, not assumed.**
  `npx vitest list --project node | grep -c gated-seed` reads **0**; the same list under the e2e
  project reads 4. The node-project walk reads **167** including 24-07's then-untracked
  `closed-fabric-agents.node.test.ts` and **166** excluding it, against `166` at the then-HEAD —
  so the 166 → 167 move in `vitest.config.ts` is **24-07's file and 24-07's edit**, not this
  plan's.

  **Independently confirmed by the other plan, which did not know this reading existed.** 24-07
  landed as `241a9cc` while this summary was being written, and its own `NODE_MEASUREMENT`
  docblock records: *"The one other file a concurrent agent added while this plan ran is
  `packages/node/src/gated-seed.e2e.test.ts`, which the `node` project excludes by suffix and
  which therefore moves nothing here."* Two agents, two routes, same answer.

---

## UNMEASURED — named, not substituted for

1. **`dialed` is empty on every green run of this fixture**, so the `dialed` half of the
   consumption assertion is carried by `failed`. What would close it: a **second live browser
   tab** holding a reservation at the same seed, which is reachable at the advertised
   `/p2p-circuit/webrtc/` address where a Node peer is not. `seed-discovery.e2e.test.ts` builds
   that topology for chromium only; doing it for three engines doubles the tab count.
2. **A live browser-tier re-reservation without a node restart.** `TabApi` exposes no `hangUp`;
   inventing one would be this plan editing the mechanism it grades. 24-04 made the same call.
3. **A wrong-issuer arm at the browser tier** — a tab holding a real certificate from an
   *unpinned* provider. That arm exists across real processes in `admission-agents.node.test.ts`
   and is not rebuilt here.
4. **A fabric in which every door is closed.** One seed is closed here. 24-05 and 24-06 record
   the same limit.
5. **`records` and `providers` are still ungated.** A refused node is unfindable, **not**
   unreachable — asserted positively on every green rather than left implied.
6. **The browser tier still pins nobody and reaches no verdict about any peer.**
   `BrowserNodeOptions` has no `trustedIssuers` field. That is `PeerVerifier` and **selection**,
   a different question from admission; **Phase 22 owns the move (`DEFICIENCIES.md` D09)** and
   nothing here closes it. Written into the file's own header, before the readings.
7. **Pe was measured only in the guard's new position.** In the old position I observed the same
   mutation live (24-07's, 20:13) and watched it *not* reach the guard — which is what motivated
   the move — but I did not re-plant it in the old position afterwards. Stated so the plant table
   is not read as covering both orderings.

---

## Deviations from Plan

### Measured-and-corrected

**1. [Rule 1 — the plan's must-have is false] `dialed` does not name the seed.** Finding 1. The
assertion reads `attempted`. Nothing was descoped: the absence claim is tested against a strictly
larger set than the plan's wording would have.

**2. [Rule 2 — missing control] `memberNode` added to the fixture.** The plan specifies
`provider`, `seed` and `strangerNode`. With only those, `peerAddrs` carries the seed and nothing
else, and **every absence reading is equally satisfied by a seed that advertises nobody at all**.
`memberNode` — enrolled at the provider, admitted at the seed, differing from `strangerNode` in
exactly one option — is the positive control for both the content half and the "attempted" half.
It is also what makes Pc's reading possible.

**3. [Rule 1 — ordering defect] The two source-posture guards were moved ahead of the behavioural
readings**, and Pa/Pa′ re-run against the reordered file. Finding 3.

### Deliberate departures, each with its reason

**4. The tab's certificate is read over `records` rather than off `window.o2`.** Finding 5 — the
demo `TabApi` has no `certificate()` and the plan forbids adding one.

**5. Six plant readings, not four.** Pa′ (a posture opened at a site no behavioural reading
touches, proving the source census discriminates *alone*), and Pe (the `seed-server.ts`
forwarding guard, proving it is reachable in its new position) were added. Pc is disclosed as
Pb-plus-a-second-edit because the two cannot be separated by one edit.

**6. `KERNEL_TRUST_ANCHOR` rather than a fresh `publisher` seed.** It is what `bin/seed.ts` pins
with no flags and what a visitor's tab pins by default, so the five nodes agree with the tab
without this file inventing an anchor. `seed-discovery.e2e.test.ts` records the same choice and
the same reason. One fresh seed is still used — `64`, for the user private key, re-grepped.

**7. No commits and no staging.** The plan, the orchestrator and this repository's shared-checkout
convention all forbid `git add` / `git commit` / `git stash` here. **The work is therefore
uncommitted in a shared tree** — `packages/node/src/gated-seed.e2e.test.ts` is untracked. That is
a real risk (a concurrent agent could revert it) and it is recorded rather than quietly resolved
by disobeying the constraint.

### Nothing else

**No production source file was modified by this plan.** `seed-server.ts` was planted twice
(Pb, Pe) and restored twice with `cp` + `cmp` reading 0, each confirmed against `git diff` as
matching HEAD afterwards. Pe was applied only after a pre-check confirmed no other agent held an
edit in that file — a first attempt **aborted** on exactly that check. `.planning/STATE.md`,
`.planning/ROADMAP.md` and `.planning/REQUIREMENTS.md` are untouched. **Criterion 8's wording is
untouched** and is quoted verbatim in the file's header.

---

## LEDGER EDITS — recommended only; this plan applies none

**L1 — `.planning/REQUIREMENTS.md`, AUTH-02 traceability.** The browser-tier sentence names
`gated-admission.e2e.test.ts` and the co-located topology. It should gain
`packages/node/src/gated-seed.e2e.test.ts`: the **separated** topology, against a real
`SeedServer` pinning an issuer, with `BootstrapInfo.peerAddrs` read as a gated surface *as served
to the tab* and its consumption read through `TabDiscoveryRound`. **The checkbox does not move**,
and disclosure (1) — *"the browser tier still pins nobody and reaches no verdict about a peer"* —
stays exactly as written.

**L2 — `.planning/DEFICIENCIES.md` D09.** Unchanged. Phase 22 still owns the `PeerVerifier` move.

**L3 — `.planning/ROADMAP.md`'s `<!-- CORRECTED 2026-08-05 -->` comment.** 24-05's L1 asked for
the Node half to cite `enrolment-needs-no-reservation.node.test.ts` and said *"the browser half
remains unmeasured"*. **The browser half is now measured** — a tab enrolling at a provider that is
not its relay, in three engines — and this file is its citation.

**L4 — `vitest.config.ts`.** Whoever commits this spec should note it adds **0** node-project
files and 1 e2e file; `NODE_MEASUREMENT.files` needs no change for it. `MEASURED_NODE_SPANS` does
not apply — that table is the node project's.

**L5 — a shared-checkout hazard worth recording somewhere durable.** Two plans planting in
`seed-server.ts` at once produced cross-reddening in both directions within twenty minutes
(Finding 2). The pre-check used here — `git diff --quiet` on the target file, **abort** if
non-empty, and restore from a snapshot taken inside the same shell block — is cheap and caught it.

---

## Threat Flags

None. This plan modifies no production source and introduces no network endpoint, auth path, file
access pattern or schema change. Of the register's `mitigate` dispositions, four were **watched
firing**: T-24-08-01 (a tab asserted admitted when the door was never closed) as **Pa**,
T-24-08-02 (`/bootstrap.json` advertising an uncertificated peer) as **Pb**, T-24-08-03 (a tab
dialling a peer the fabric never admitted) as **Pc**, and T-24-08-06's deployment requirement as
the standing enrolment path in arm B of all three engines. T-24-08-04 (the tab's own
`reservations` answer as instrument) is held by the constant asserted in both arms per engine.
T-24-08-05 is `accept, and name the owner` — named, in the file header and in UNMEASURED (6).

---

## Self-Check: PASSED

- `packages/node/src/gated-seed.e2e.test.ts` — **FOUND** (untracked, by the plan's constraint);
  4 cases, `EXIT=0` on the final run at 20:31:04.
- `.planning/phases/phase-24-certificate-gated-admission/24-08-SUMMARY.md` — **FOUND**.
- `packages/node/src/seed-server.ts` — **FOUND, and identical to HEAD**: `git diff --quiet`
  returned 0 after the last restore, and it is absent from `git status --porcelain` for this
  plan's account.
- Commits: **none, by the plan's own constraint and the orchestrator's.** No commit hash is
  claimed anywhere above.
- `git status --porcelain` at close reads **exactly two lines**, both this plan's:
  `?? packages/node/src/gated-seed.e2e.test.ts` and `?? …/24-08-SUMMARY.md`. **No plant
  residue anywhere.** The entries that stood beside them during execution —
  `admission-agents.node.test.ts`, `mutation-ledger.ts`, `vitest.config.ts`,
  `closed-fabric-agents.node.test.ts`, `24-07-SUMMARY.md` — belonged to 24-07, were **never
  touched, staged, stashed or reverted by this plan**, and have since been committed by that
  plan as `241a9cc`.
- `npx tsc --noEmit` at close: **exit 0, zero bytes**, against the tree including `241a9cc`.
