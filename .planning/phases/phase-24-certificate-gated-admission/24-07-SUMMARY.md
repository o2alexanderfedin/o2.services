---
phase: phase-24-certificate-gated-admission
plan: 07
subsystem: admission
tags: [AUTH-02, AUTH-04, fabric, bootstrap, measurement, gap-closure]
verdict: criterion 8 now reads over a FABRIC, not a relay — and the bound that remains is a deployment posture an operator can reverse
requires: [05, 06]
provides:
  - "criterion 8 read across a fabric whose every relay-capable peer was told to close, asserted over the whole set"
  - "BootstrapInfo.peerAddrs read as a gated surface over HTTP from a real bin/seed.ts, with a paired presence and absence"
  - "M67 — the seed's admission wiring as a registered, caught mutation"
  - "the R1 repair on admission-agents.node.test.ts, with 24-05's stated reason for it measured FALSE and the real defect named"
affects:
  - "24-08 inherits a measured whole-set premise at the Node tier"
  - "the verifier may re-score criterion 8; this plan does not"
tech-stack:
  added: []
  patterns:
    - "assert an absence over a SET as a list of {door, intruder} pairs, not as a loop of per-peer expects — a loop stops at the first offender and cannot discriminate which door"
    - "a `beforeAll` fixture is invisible to `--reporter=json`; its span must be a bracketed `/usr/bin/time -p` wall clock and must be labelled as one"
key-files:
  created:
    - packages/node/src/closed-fabric-agents.node.test.ts
  modified:
    - packages/node/src/admission-agents.node.test.ts
    - packages/node/src/mutation-ledger.ts
    - vitest.config.ts
decisions:
  - "M67's caughtBy names relay-admission.node.test.ts, not this plan's own file: mutation-guard.node.test.ts:149 requires every path named in the ledger to be git-tracked, and this plan is forbidden to commit. The new file WAS measured to catch it (plants Pb, Pb-prime) and the instruction to add it on commit is written into M67's own `why`."
  - "NODE_MEASUREMENT.files 166 → 167 and unitFiles 110 → 111. The span is recorded in the docblock, not in MEASURED_NODE_SPANS, on 24-05's precedent — the file is untracked and slow-specs requires listed paths to be committed."
  - "unitFiles was OBSERVED directly this time (npm run test:unit reported 111 files), closing a weakness that field had carried through three re-sites. Safe to run under a concurrent agent because both git-status-snapshot specs are above the cut and therefore excluded — verified against the derived exclusion list before the run."
  - "Plants Pa and Pd each needed a second variant, because the fixture's own posture guard reddens first. That is T-24-07-01's mitigation firing, and it is the same shape 24-05 recorded for its P1/P1b."
metrics:
  duration: ~55 min
  completed: 2026-08-06
  commits: 0
---

# Phase 24 Plan 07: Criterion 8 Over a Closed Fabric — Summary

## THE ANSWER, up front

**Criterion 8's evidence now holds of a FABRIC, not of a relay.** In a fabric of eight real
operating-system processes whose **every** relay-capable peer was told to close, two
uncertificated nodes obtained a reservation on **none** of the six — asserted over the whole
set, with each door named — while both obtained one on the single peer nobody closed, in the
same run, on the same host.

**What that sentence cannot be stretched to.** It is a reading over *a* fabric, and the fabric
was closed **by argv**. The default posture of both binaries is still open, so what this plan
converts is the *kind* of bound, not its existence: `24-VERIFICATION.md` scored criterion 8
PARTIAL because *"'Pass-with-a-stated-bound' would be the right disposition if the bound were a
deployment posture an operator can remove. It is not: for the seed there is no knob."* 24-06
built the knob; this plan turned it and measured what happens when it is turned. **The bound
that remains is exactly the one the verifier named as acceptable.** Whether that changes the
disposition is a verifier's call and RULING A reserves it: **this plan does not claim the
criterion MET, moves no checkbox, and edits criterion 8's wording nowhere.**

Criterion 8, quoted exactly and unedited:

> *"Enrolment's cost is bounded by admission, not by a counter: a node that cannot present a
> provider-issued certificate cannot join the fabric, advertise itself, or be dialled by another
> node — so an identity that was never issued buys nothing, and the N-th identity costs an
> attacker a provider's willingness to sign it"*

---

## The population the absence was asserted over, and how

**Six closed relay-capable peers.** `CLOSED_RELAY_CAPABLE` is a named constant, the set's length
is asserted rather than assumed, and every member is dialled and asked:

| # | peer | how it was closed | how it was asked |
|---|---|---|---|
| 1 | `provider` | `--admit-issuer <its own issuerKey>` (two-step spawn) | dialled by the reader, `reservations` RPC |
| 2 | `seed` (`bin/seed.ts`) | `--admit-issuer <issuerKey>` | dialled by the reader, `reservations` RPC |
| 3 | `relay` (`bin/agent.ts`) | `--admit-issuer <issuerKey>` | dialled by the reader, `reservations` RPC |
| 4 | `memberAtSeed` | `--admit-issuer <issuerKey>` | dialled by the reader, `reservations` RPC |
| 5 | `memberAtRelay` | `--admit-issuer <issuerKey>` | dialled by the reader, `reservations` RPC |
| 6 | `reader` (in-process) | `relayAdmission: new Set([issuerKey])` | its own `reservedPeerIds` — the same thunk the RPC answers from; it cannot dial itself, and that is stated rather than skipped |

**Two subjects, not one.** `stranger` (a real `bin/agent.ts` process holding no certificate) and
`reader` (the instrument, which also holds none). That is deliberate and it is the verifier's own
falsification turned into a fixture: 24-04 argued the criterion about `stranger`; the verifier
answered *"`reader` is also that node and `reader` got in"*. Here both are subjects of the same
whole-set claim.

**Every posture is read off the process's own handshake line or its own banner** — never off the
argv this file passed. Plants Pa and Pd prove that guard fires.

**The stranger genuinely met every member of the set.** Two it *asked* (`--relay-addr` to seed
and relay); three it *dialled* (`--peer-addr` to provider, memberAtSeed, memberAtRelay) — which
is the shape that got 24-04's `outsider` in, since `RelayDiscovery` fires off identify for any
HOP-speaking peer. That is asserted in the file against `stranger.peers`, which `bin/agent.ts`
reads off a `Connection` rather than out of the configured string, so it is what the process
**reached** and not what it was told to reach. The reader met all six by dialling the five and
being the sixth.

**The assertion is over the set, as a list of offenders.** `intruders(answers, subjects)` returns
every `{door, admitted, peerId}` pair, and the case asserts that list is empty. A loop of
per-peer `expect`s would stop at the first offending door and could not tell `seed` from `relay`
— which is exactly what plants Pa″ and Pd′ turn on.

### The published `[closed-fabric]` topology

Taken from the green run of 2026-08-06 20:00 (issuer `55cecd8b…93bd`, abbreviated below):

```
postures     provider      ["55cecd8b…93bd"]
             seed          admits  only peers certified by 1 pinned admission issuer (from --admit-issuer): 55cecd8b…93bd
             relay         ["55cecd8b…93bd"]
             memberAtSeed  ["55cecd8b…93bd"]     memberAtRelay ["55cecd8b…93bd"]
             stranger      ["55cecd8b…93bd"]     reader        ["55cecd8b…93bd"]
             openControl   "admits-any-peer"          ← NOT part of the fabric

subjects     stranger 12D3KooWSU4YJ7KU…      reader 12D3KooWN7eNmjMF…
enrolled     memberAtSeed 12D3KooWEHZ822JA…  memberAtRelay 12D3KooW9yxSVmmW…

closedSetHolds (both scans, bracketing a 5 s window — identical)
             provider      []
             seed          [ memberAtSeed ]
             relay         [ memberAtRelay ]
             memberAtSeed  []
             memberAtRelay []
             reader        []

openControlHolds  [ stranger, reader ]        ← BOTH uncertificated peers
strangerRelays    [ /ip4/127.0.0.1/tcp/63338/p2p/<openControl>/p2p-circuit/p2p/<stranger> ]
```

```
[closed-fabric bootstrap]  GET http://127.0.0.1:5173/bootstrap.json
  status 200   cache-control no-store
  relayAddrs  [ /ip4/127.0.0.1/tcp/63336/ws/p2p/<seed> ]
  seedPeerId  <seed>
  peerAddrs   [ /ip4/127.0.0.1/tcp/63336/ws/p2p/<seed>,
                /ip4/127.0.0.1/tcp/63336/ws/p2p/<seed>/p2p-circuit/webrtc/p2p/<memberAtSeed> ]
```

`openControlHolds` is the sharpest line in this reading. **The one peer nobody closed admitted
both uncertificated nodes**, in the same run, on the same host — so the absence at all six closed
doors is a refusal and not inaction, and 24-VERIFICATION's `reader` finding is reproduced under
control rather than argued away.

---

## R1 — the repair on `admission-agents.node.test.ts`, and 24-05's stated reason for it is FALSE

The orchestrator's brief said four `advertisedBy` call sites pass **async `observed` thunks** that
are not awaited, so they stringify a promise as `{}`. 24-05's R1 says the same. **Checked
mechanically before acting on it, and it is not true of this file.**

```
CALL @519 until(  … observed () => ({ stderr: stranger.stderr() })                       SYNC
CALL @538 stays(  … observed () => ({ exitCode: …, stderr: … })                          SYNC
CALL @571 until(  async predicate … observed () => ({ memberRelays: member.relays })     SYNC
CALL @613 until(  async predicate … observed () => ({ memberRelays: member.relays })     SYNC
CALL @668 until(  async predicate … observed () => ({ memberRelays: member.relays })     SYNC
CALL @674 stays(  async predicate … observed () => ({ outsiderRelays: outsider.relays }) SYNC
CALL @694 until(  … observed () => ({ stderr: outsider.stderr() })                       SYNC
CALL @760 until(  async predicate … observed () => ({ outsiderRelays: …, stderr: … })    SYNC
```

**All eight `observed` thunks are synchronous.** What is async is the *predicate*, and both
helpers already awaited it (`if (await predicate()) return`). The `{}` failure 24-05 measured in
its own file could not occur here as written. **No case was vacuous.**

### But there was a real defect at those five sites, and it is worse than vacuity

At the five sites whose predicate is a round trip through `advertisedBy`, the `observed` thunk
reported `{ memberRelays: member.relays }` — a **handshake snapshot taken at spawn and never
updated** — while the thing being waited on is the relay's *live* advertisement. For an admitted
arm that snapshot is a non-empty circuit list. So a timeout there printed **a value that looks
like success beside a reading that had failed.** `{}` says nothing; a stale success says the
wrong thing.

Repaired: `observed` widened to `() => unknown | Promise<unknown>` and awaited in both helpers,
and the five thunks now read the advertisement they are waiting on, keeping the snapshot beside
it so nothing is lost. **No assertion in that file was changed and none of its measurements
moved** (6 tests, exit 0, `real 38.10` before and after).

### Each repaired site planted and watched red

| plant | edit | site | exit | observed failure text, verbatim |
|---|---|---|---|---|
| **RA** | relay's `--admit-issuer issuer` → `'e'.repeat(64)` | **S1** clause 2 | **1** | `Error: timed out waiting for the enrolled arm to appear in the relay’s advertisement; observed {"relayHolds":[],"memberRelays":["/ip4/127.0.0.1/tcp/63610/p2p/12D3KooWEQJ54WBW…/p2p-circuit/p2p/12D3KooWQhqho5ma…"]}` |
| **RA** | same | **S2** clause 3 | **1** | `Error: timed out waiting for the enrolled arm to appear in the relay’s advertisement; observed {"relayHolds":[],"memberRelays":["/ip4/127.0.0.1/tcp/63681/p2p/12D3KooWQ2YBtZZ5…/p2p-circuit/p2p/12D3KooWG9W8puvp…"]}` |
| **RA** | same | **S3** wrong-issuer `until` | **1** | `Error: timed out waiting for the enrolled arm to obtain a reservation; observed {"relayHolds":[],"memberRelays":["/ip4/127.0.0.1/tcp/63721/p2p/12D3KooWMAKTfRHo…/p2p-circuit/p2p/12D3KooWL3J2bn1Z…"]}` |
| **RB** | relay's `--admit-issuer` dropped | **S4** wrong-issuer `stays` | **1** | `Error: the wrong-issuer arm staying out of the reservation store stopped holding after 7ms; observed {"relayHolds":["12D3KooWHhMNuBCB…","12D3KooWAZQS3Azf…","12D3KooWBJkvHAv1…","12D3KooWPoqHkSqg…"],"outsiderRelays":["…/p2p-circuit/p2p/12D3KooWBJkvHAv1…"]}` |
| **RC** | `joinFabric('outsider', 0xa3, otherProvider)` → `null` | **S5** per-relay | **1** | `Error: timed out waiting for the arm the gate refused to turn up in the open provider’s reservation store; observed {"openProviderHolds":["12D3KooWG7JUFWcW…"],"outsiderRelays":[],"stderr":"…agent.ts: relay reservation refused: PERMISSION_DENIED ×3 … no relay granted a reservation yet; still serving directly"}` |

**This is the finding, in one line.** Every one of those messages now carries `relayHolds` /
`openProviderHolds` — the list the reading was actually about. Before the repair, S1–S3 would
have printed `{"memberRelays":[<a live circuit multiaddr>]}`: a **non-empty circuit list beside a
failed reading**, which is a diagnostic that actively misleads. RB's message is the clearest —
`relayHolds` naming **four** peers is the open relay admitting everybody, which the old thunk
could not have shown at all.

Each plant was `cmp`'d against a `/tmp` baseline **before** its run and confirmed to differ; each
was restored with `cp` and a `cmp` reading 0. No `git checkout --`, no `git stash`, no `git add`.

---

## Plants on `closed-fabric-agents.node.test.ts` — counted before applied, watched red, restored

| plant | edit | exit | what reddened | what stayed green | observed failure text, verbatim |
|---|---|---|---|---|---|
| **Pa** | drop `--admit-issuer` from the **seed's** argv | **1** | the fixture's own posture guard, in `beforeAll` | — (both tests **skipped**) | `AssertionError: expected 'admits     every peer that completes …' to contain 'only peers certified by'` |
| **Pa′** | Pa + the banner expectation moved to the open arm | **1** | **R3** and **task 2's absence half** | — | `Error: timed out waiting for the uncertificated stranger to hold a reservation on the one peer nobody closed; observed {"openControlHolds":[],"strangerRelays":[6 circuits through the SEED],"strangerPeers":[4],…}` **and** `AssertionError: the uncertificated stranger is advertised to every arriving browser: expected [ Array(1) ] to strictly equal []` |
| **Pa″** | Pa′ + R3's `until` removed so R2 is reached | **1** | **R2's `seed` entry** and **task 2's absence half** | R2's `provider`, `relay`, `memberAtSeed`, `memberAtRelay`, `reader` entries — inside the same assertion | `AssertionError: a closed door admitted an uncertificated peer (first scan): expected [ { door: 'seed', …(2) }, …(1) ] to strictly equal []` — diff names `{admitted:"stranger",door:"seed"}` and `{admitted:"reader",door:"seed"}` and **no other door** |
| **Pb** | `seed-server.ts` `relayAdmission: options.relayAdmission` → `'admits-any-peer'`, **argv untouched** | **1** | **R3** and **task 2's absence half** | — | identical pair to Pa′, with `strangerRelays` naming 6 circuits through the seed |
| **Pb′** | Pb + R3's `until` removed | **1** | **R2's `seed` entry** and **task 2** | every other door | `AssertionError: a closed door admitted an uncertificated peer (first scan): expected [ { door: 'seed', …(2) }, …(1) ] to strictly equal []` — same two pairs, **no other door** |
| **Pc** | `seed-server.ts` `peerAddrs` widened: `...node.reservedPeerIds.map(` → `...[...node.reservedPeerIds, ...node.transport.peers].map(` | **1** | **task 2 only** | **test 1 (R1/R2/R3) passed** | `AssertionError: the enrolled arm left the advertisement: expected [ …(2) ] to have a length of 1 but got 2` |
| **Pc′** | Pc + the presence assertion relaxed to `> 0`, so Pc's effect on the **absence** half is watched | **1** | **task 2 only** | **test 1 passed** | `AssertionError: the uncertificated stranger is advertised to every arriving browser: expected [ Array(1) ] to strictly equal []` |
| **Pd** | drop `--admit-issuer` from the **agent relay's** argv | **1** | test 1's posture guard, naming the relay | **task 2 passed** | `AssertionError: relay states a posture it was not given: expected 'admits-any-peer' to strictly equal [ Array(1) ]` |
| **Pd′** | Pd + `relay` removed from the posture loop + R3's `until` removed | **1** | **R2's `relay` entry** | **task 2 passed**; R2's `seed` entry green | `AssertionError: a closed door admitted an uncertificated peer (first scan): expected [ { door: 'relay', …(2) }, …(1) ] to strictly equal []` — diff names `{admitted:"stranger",door:"relay"}` and `{admitted:"reader",door:"relay"}` and **no other door** |
| **Pe** | remove the stranger's `--peer-addr <openControlAddr>` | **1** | **R3** | **task 2 passed** | `Error: timed out waiting for the uncertificated stranger to hold a reservation on the one peer nobody closed; observed {"openControlHolds":["12D3KooWJefterZrZeUwYYzHJ18bccRdsV98U8E81KKk2MDXs8XQ"],"strangerRelays":[],"strangerPeers":["12D3KooWHD2f6GPd…","12D3KooWCx2SP9BX…","12D3KooWELHZUdDY…"],"strangerStderr":"\nagent.ts: relay reservation refused: PERMISSION_DENIED ×6\nagent.ts: no relay granted a reservation yet; still serving directly\n"}` |

Every plant was `cmp`'d against `/tmp/baseline-cf.ts` / `/tmp/baseline-seed-server.ts` **before**
its run and confirmed to differ — an unapplied plant and a green plant are identical in a log —
and restored with `cp` followed by a `cmp` reading 0.

### `Pe` is the control, and it can fail

**R3's control reddens when the stranger's dial to the open peer is removed.** Its payload is the
whole account in one line: `openControlHolds` holds exactly one peer (the reader, which the
fixture itself dialled there), `strangerRelays` is `[]`, `strangerPeers` names only the three
closed peers it was still told to dial, and its stderr carries **six** `PERMISSION_DENIED`
refusals followed by `no relay granted a reservation yet; still serving directly`. A stranger in
a fully closed fabric with the control taken away is refused six times, gets in nowhere, and
**stays alive and serving directly** — which is 24-04's clause-3 limit visible from the other
side.

### `Pa` / `Pd` each needed a second variant, and that is the guard working

Both reddened the **posture guard first** — T-24-07-01's stated mitigation (*"every posture is
read off the process's own handshake line or banner, never off the argv this file passed"*)
firing exactly as specified. It is a stronger result than the plan predicted, not a weaker one,
but it leaves the load-bearing reading unproven on its own, so Pa′/Pa″ and Pd′ were run. This is
the same shape 24-05 recorded for its P1/P1b, and it is recorded rather than substituted.

### `Pa′` and `Pb` reddened R3, not R2, and the reason is a **reading** rather than a defect

With the seed open, the stranger's relay search is satisfied **at the seed** — `strangerRelays`
under both plants names six circuit multiaddrs through the seed's own peer id — so it never
reaches `openControl` and R3 times out. That is 24-04's measured *"a grant at the first door ends
libp2p's relay search rather than adding to it"* firing again, and it is precisely the mechanism
this fixture's **two enrolled arms** exist to account for. Pa″ and Pb′ remove the R3 wait so R2
itself is reached.

### The separation, which is the evidence

- `Pa″` and `Pb′` name **`seed`** and nothing else. `Pd′` names **`relay`** and nothing else.
- `Pc` / `Pc′` redden **task 2 alone** with test 1 green — the two advertisement surfaces are
  genuinely separate instruments, which is the plant 24-04's plan named and could not use.
- `Pd` / `Pd′` / `Pe` leave **task 2 green**.
- **`Pa′` and `Pb` produce the identical pair of failures by two routes that share nothing**: one
  strips a command-line flag, the other reverts a production line while leaving the flag, the
  validator and the banner intact. `Pb` is the operator-invisible case — **the banner says the
  door is shut and the door is open** — and this file detects it.

---

## M67 — registered and caught

```
id   mark  status  seconds  detail
M67  PASS  caught    15.0s  exit 1 with the recorded signature
```

`packages/node/src/seed-server.ts`: `relayAdmission: options.relayAdmission,` →
`relayAdmission: 'admits-any-peer',`. `seed-server.ts` `cmp`'d **identical** to its baseline
after the run; `git status --porcelain` carried no plant residue.

**`M66` re-run and still caught** — `M66 PASS caught 8.7s` — so this plan did not disturb the
gate's own mutation.

**`npm run test:mutations` exits 1 for both, and it is not a survivor.** The runner ends with
`process.exit(survivors.length > 0 || dirt.length > 0 ? 1 : 0)`, and `dirt` is this plan's own
uncommitted files plus a concurrent agent's `gated-seed.e2e.test.ts`. **Any plan forbidden to
commit cannot make that script exit 0**, and the per-entry `PASS / caught` line is the reading.
Same class as 24-05's Finding 2 and reported rather than worked around.

**`caughtBy` names `relay-admission.node.test.ts`, not this plan's own file, and that is forced.**
`mutation-guard.node.test.ts:149` asserts every path named in the ledger is git-**tracked**, and
this plan may not commit. `closed-fabric-agents.node.test.ts` **was** measured to catch M67 —
plants Pb and Pb′ above are literally M67's edit — and the instruction to add it on commit is
written into M67's own `why` so whoever hits it finds it there rather than here.

---

## Measurements, with their conditions

Every exit code below was read with `EXIT=$?` on the line **immediately** after the command — no
pipes, no trailing `tail`, no `echo` in between. 8-core host; load is the 1-minute average.

| command | exit | result | process reading | load |
|---|---|---|---|---|
| `npx tsc --noEmit` | **0** | **zero output** (run 4× across the plan) | — | — |
| `npx vitest run --project node closed-fabric-agents.node.test.ts` | **0** | 2 tests | `real 17.59 user 9.44 sys 1.65` | 3.82 → 9.16 |
| — second solo run | **0** | 2 tests | `real 17.43 user 9.23 sys 1.63` | — |
| `npx vitest run --project node admission-agents.node.test.ts` | **0** | 6 tests, readings unchanged | `real 38.10 user 31.56 sys 5.35` | 6.92 → 9.03 |
| `npx vitest run --project node closed-fabric… admission-agents…` | **0** | 8 tests, 2 files | 44.35 s reported | 11.82 |
| `npx vitest run --project node relay-admission.node.test.ts` | **0** | 37 tests | 25.22 s reported | 11.4 |
| `npx vitest run --project node slow-specs.node.test.ts` | **0** | 9 tests, drift 0 against tolerance 5 | 416 ms | — |
| `npx vitest run --project node slow-specs… mutation-guard…` | **0** | 154 tests | 500 ms | — |
| `npx vitest run --project node bench-admission.node.test.ts` | **0** | 3 tests | 1.11 s | — |
| `npm run test:unit` | **0** | **111 files, 1715 passed \| 1 skipped** | `real 25.95 user 58.30 sys 10.44`, ratio **2.65** | 9.21 → 11.56 |
| `npm run test:mutations -- --only=M66` | 1 (dirt) | **M66 caught, 8.7 s** | — | — |
| `npm run test:mutations -- --only=M67` | 1 (dirt) | **M67 caught, 15.0 s** | — | — |
| final: `closed-fabric… admission-agents… slow-specs… mutation-guard…` | **0** | **4 files, 162 tests** | `real 49.03 user 49.11 sys 9.31` | 13.81 → 12.82 |

### 24-02's pre-gate baseline, re-read — a **fifth** byte-identical reading

```
[24-02 baseline] room-for-everyone   {"connected":4,"granted":3,"advertised":3}
[24-02 baseline] room-for-all-but-one {"connected":4,"granted":2,"advertised":2}
```

Unmoved. `bench-admission.node.test.ts`, exit 0, 1.11 s.

### The new spec's span — and the hook shadow is the finding

| reading | run A | run B |
|---|---|---|
| `--reporter=json` file span | **10 136 ms** | — |
| Σ case durations | 10 136 ms (agrees to within 1 ms) | — |
| `/usr/bin/time -p` solo `real` | **17.59** | 17.43 |
| `user` / `sys` | 9.44 / 1.65 | 9.23 / 1.63 |
| `real` less the boot floor | **16.69** | 16.53 |

**Boot floor 0.90 s**, the mean of two solo runs of `packages/core/src/blockstore/memory.test.ts`
(`real 0.93` and `0.87`) **bracketing** the pair in the same session.

**`--reporter=json` cannot see 6.5 s — 39 % — of this file's cost**, because the whole
eight-process fixture is one `beforeAll` and the reporter attributes no hook time. The reporter is
internally consistent (its span equals the sum of case durations to within 1 ms) and still blind,
which is the trap this repository has already been bitten by: *"a 154 s file once reported
235 ms"*. **So the recorded span is a wall clock, labelled as one: 16 690 ms.** It is disclosed in
the file's own header **before** the readings, not after.

`(user+sys)/real` is **0.63**: eight child processes, two enrolments and a 5 s absence window, so
most of that wall clock is waiting rather than computing. A comparability key, not a verdict.

### The file count, by two routes that share no code

| route | reading |
|---|---|
| the filesystem walk `slow-specs.node.test.ts` derives `NODE_PROJECT_FILES` from | **167** |
| `git ls-files packages tools` filtered by the same globs | **166 tracked** |
| `git status --porcelain` untracked, same globs | **1** — `closed-fabric-agents.node.test.ts` |

166 + 1 = 167. The two routes disagree by exactly the untracked file, which is the shape they are
supposed to have. **No foreign arrival this time**: the sibling agent's
`packages/node/src/gated-seed.e2e.test.ts` is excluded by suffix and moves nothing.

`NODE_MEASUREMENT.files` **166 → 167**. `FILE_COUNT_TOLERANCE` untouched at 5, drift 0.
`sumOfFileSpansMs` **unchanged**, because nothing was added to `MEASURED_NODE_SPANS`; the
pre-existing 7 943 ms discrepancy that table already carries is left **carried**, not absorbed.

### `unitFiles` was **observed**, for the first time in three re-sites

`files - EXCLUDED.length` derives **111**. `npm run test:unit` reported `Test Files 111 passed
(111)` on a green run — so the derivation and the runner agree, closing the weakness that field
had recorded through 24-04's and 24-05's re-sites (*"a derivation wearing a measurement's
clothes"*). `unitTests` 1650 → **1716** and `unitWallClockMs` 7 750 → **25 950**, both off that
same green run, with the caveat written into the field: ~16.7 s of the 25.95 s is this one
untracked file, and subtracting it leaves ~9.3 s, which *is* comparable with the recorded band.

**Running `test:unit` under a concurrent agent was safe for a checked reason, not by luck.** Both
specs that snapshot `git status --porcelain` around themselves —
`bench-attestation.node.test.ts` and `discover-arm.node.test.ts` — are above `SLOW_CUTOFF_MS` and
therefore **excluded** from `test:unit`; that was verified against the derived exclusion list
before the run.

---

## Deviations from the plan

### Auto-fixed / measured-and-corrected

**1. [Rule 1 — false premise, measured] 24-05's R1 diagnosis is wrong about
`admission-agents.node.test.ts`.** All eight `observed` thunks there are synchronous; **no case
was vacuous**. The real defect is narrower and worse, and it is repaired and planted. Full account
above, and written into that file's `until` docblock quoting the sentence it replaces.

**2. [Rule 2 — the stated truth was not reachable as written] the stranger dials the two enrolled
arms as well.** The plan's argv gives the stranger `--peer-addr <providerAddr>` only. But
must-have 1 says *"has met **every** relay-capable peer"*, and `memberAtSeed` / `memberAtRelay`
bind listening sockets and are therefore in the set. Without the extra dials their absence would
be for want of asking — the exact ambiguity this plan exists to remove. Two `--peer-addr` entries
added; the "met" relation is then **asserted** in the file against `stranger.peers`.

**3. [Rule 1 — wrong count in a header] the budget paragraph.** Written as *"Eight `bin/agent.ts`
children … seven live at once"*; counted against the spawn sites it is **seven spawns, six live**
(the minting provider is stopped), plus one seed child. Corrected before the final run, with the
correction naming why: `admission-agents.node.test.ts` carried *"Five"* for a fixture that ran
six, and the wrong figure propagated into two summaries and a requirement row.

### Deliberate departures, each with its reason

**4. The fixture stands up once in `beforeAll`, not per `it`.** Eight processes twice over is
eight too many. The cost is the hook shadow, which is measured, disclosed in the file's header
before its readings, and is why the recorded span is a wall clock.

**5. Plants Pa/Pd/Pc each ran in two variants.** The first variant of each reddens an earlier
guard than the plan predicted (the posture guard for Pa/Pd; the presence half for Pc), so a second
variant was needed to redden the load-bearing assertion in isolation. Both are recorded; neither
is substituted for the other.

**6. M67's `caughtBy` names a different file than the plan implies** — the tracked-path guard
forces it. See the M67 section.

**7. The new spec is not added to `MEASURED_NODE_SPANS`** — 24-05's precedent, same collision,
same resolution.

**8. `npx vitest run --project node` and `--project e2e` were NOT run.** The orchestrator
instructed targeted specs only: a sibling agent is executing 24-08 in this same working tree and
`bench-attestation.node.test.ts` / `discover-arm.node.test.ts` snapshot `git status --porcelain`
around themselves, so a file appearing mid-run reddens them for reasons unrelated to any code.
The e2e project is where that agent's `gated-seed.e2e.test.ts` is landing. **Both remain owed and
belong to the orchestrator's quiet-tree sweep**, and with them the full-run `(user+sys)/real`
comparison against 24-04's 1.79 and the verifier's 1.85. `npm run test:unit` was run instead and
its safety was checked rather than assumed (above).

**9. No commits, no staging.** The plan and the orchestrator both forbid it. Three files are
modified and one is untracked in a shared checkout; that is a real risk and it is recorded rather
than quietly resolved by disobeying the constraint.

---

## Findings

### Finding 1 — the reader is in **both** advertisement surfaces' blind spot, and that is the point

`openControlHolds` names `stranger` **and** `reader`. 24-VERIFICATION's sharpest sentence was that
`reader` — uncertificated, refused by the gate — nonetheless got in somewhere. This fixture makes
that a **control** rather than a hole: both uncertificated peers are in the open peer's store and
in none of the six closed ones. The property is now about the certificate, because it holds
identically for two nodes that differ in everything else (one a child process, one in-process).

### Finding 2 — `bin/seed.ts --port 0` does not pick a free HTTP port

The banner reported `http://…:5173/…`, i.e. Vite's default, not an ephemeral port. `bin/seed.ts`
passes `httpPort: Number(values.port)` = `0` and `seed-server.ts` writes
`port: options.httpPort ?? 0`, so `0` reaches Vite and Vite does not treat it as "pick one". This
fixture is unaffected — it parses the **actual** port off a join-URL line rather than assuming —
but a second seed spawned concurrently would collide, and Vite's non-strict port bump would be
invisible to anything that assumed the argv. Not this plan's file to fix; reported.

### Finding 3 — `vitest.config.ts:707`'s 923 ms row for `relay-admission.node.test.ts` is still stale

Measured **25.22 s** solo in this session, against a recorded 923 ms — a factor of 27, and 24-06
measured 22.95 s. It did not obstruct this plan and it was **not** silently fixed: 24-06 recorded
that re-siting it cascades into `unitFiles` and pulls this repository's admission census out of
`npm run test:unit`, which is a workflow decision. **One thing has changed since 24-06 wrote
that**: the `npm run test:unit` cross-check it named as the blocker was taken here and is green, so
the cascade can now be observed rather than derived. Still not this plan's edit.

### Finding 4 — `npm run test:mutations` cannot exit 0 for a plan forbidden to commit

`process.exit(survivors.length > 0 || dirt.length > 0 ? 1 : 0)`. Structural, not a survivor, and
compounded here by a concurrent agent's untracked file. The per-entry `caught` line is the reading.

---

## What this does NOT license

- **It does not show a fabric is closed by default.** Every closed posture was passed on a command
  line. `24-CONTEXT.md` open ruling 1 — whether the binaries should refuse to start absent an
  explicit posture — is untouched and undecided.
- **It does not close `records` / `providers` gating.** A directly-dialable peer still reaches
  both. 24-04's clause 3 stands: the refused node is **unfindable, not unreachable**. Not
  re-taken here and not weakened.
- **Nothing about the browser tier.** That is 24-08.
- **It says nothing about revocation latency.** T-24-07-05 is accepted and documented as a number.
- **No checkbox moved and criterion 8 is not claimed MET.**

---

## LEDGER EDITS — recommended only; this plan applies none

**L1 — `.planning/REQUIREMENTS.md`, AUTH-02 traceability row.** Disclosure (3) currently reads
*"the clause holds of a relay, not of the fabric"*. That is now measured over a fabric of eight
real processes whose every relay-capable peer was told to close, asserted over the whole set, with
a spawned `bin/seed.ts` in the set and `BootstrapInfo.peerAddrs` read with a paired presence and
absence over HTTP. **The checkbox does not move.** Whether the verdict cell moves is a verifier's
call.

**L2 — `.planning/ROADMAP.md` progress row 24 and the Phase 17 / Phase 19 carried-criterion rows.**
All three record criterion 8 as PARTIAL *with the seed structurally un-closable*. That premise
moved at 24-06 and has now been read. Not this plan's edit.

**L3 — `.planning/STATE.md`.** Untouched, and it should stay untouched.

**L4 — `vitest.config.ts`.** Finding 3's re-site of the `relay-admission.node.test.ts` row, with
the `npm run test:unit` observation it requires — which this plan has now taken, so the blocker
24-06 named is gone.

**L5 — `packages/node/src/mutation-ledger.ts`.** On commit, add
`packages/node/src/closed-fabric-agents.node.test.ts` to M67's `caughtBy`. Already written into
M67's own `why`.

**L6 — `MEASURED_NODE_SPANS`.** On commit, add
`['packages/node/src/closed-fabric-agents.node.test.ts', 16_690]` with a `// wall clock,
hook-shadowed` note, add 16 690 to `sumOfFileSpansMs`, drop `unitFiles` to 110 — or re-measure.
Written into `NODE_MEASUREMENT.files` beside the count.

---

## Threat Flags

None. The only production source this plan touched is `packages/node/src/mutation-ledger.ts`,
which is data read by two guards and introduces no network endpoint, auth path, file access
pattern or schema change. `seed-server.ts` was edited **only** as plants Pb, Pb′, Pc, Pc′ and M67,
and `cmp`'d identical to its baseline after every one.

Both `mitigate` dispositions with a source-text mitigation were **watched firing**:
T-24-07-01 (a fixture that believes it closed a door and did not) as plants **Pa** and **Pd**,
which reddened the posture guard before any reading could pass for the wrong reason;
T-24-07-02 (one relay-capable peer left open readmitting a refused node) as **Pa″** and **Pd′**,
each naming its own door and no other;
T-24-07-03 (`peerAddrs` advertising an uncertificated peer) as **Pc** and **Pc′**, which reddened
task 2 alone with the whole-set reading green.

---

## Self-Check: PASSED

- `packages/node/src/closed-fabric-agents.node.test.ts` — FOUND (untracked, by the plan's own
  constraint)
- `packages/node/src/admission-agents.node.test.ts` — FOUND, modified
- `packages/node/src/mutation-ledger.ts` — FOUND, modified (M67 present)
- `vitest.config.ts` — FOUND, modified
- `.planning/phases/phase-24-certificate-gated-admission/24-07-SUMMARY.md` — FOUND
- Commits: **none, by the plan's own constraint and the orchestrator's.** No commit hash is
  claimed anywhere above.
- `git status --porcelain` after the final restore: exactly
  `M packages/node/src/admission-agents.node.test.ts`, `M packages/node/src/mutation-ledger.ts`,
  `M vitest.config.ts`, `?? packages/node/src/closed-fabric-agents.node.test.ts` — plus
  `?? packages/node/src/gated-seed.e2e.test.ts`, which belongs to the concurrent 24-08 agent and
  was **not** touched, staged, stashed or reverted by this plan.
- **No plant residue.** `seed-server.ts` `cmp`'d identical to its pre-plant baseline (exit 0) and
  is absent from `git status` entirely; `admission-agents.node.test.ts` and
  `closed-fabric-agents.node.test.ts` each `cmp`'d identical to their post-repair baselines after
  the last restore. No `git add`, no `git commit`, no `git stash`, no `git checkout --`, no
  `git clean`. No process was signalled that this fixture did not spawn.
