# 39-03 — SUMMARY: the relay's relayed column is zero because a relay has no relayed traffic of its own

**The anomaly is explained and it is not a defect** — and it is explained by a reading, not by
plausibility. A local `workerd` that demonstrably carried a relayed connection between two peers
reported `traffic.relayed.connectionSeconds = 0` and `traffic.relayed.bytes = 0` at every one of four
moments, with `relayService` moving from 0 to 22 129 bytes across the same window. That is the
deployed 2026-09-04 shape — 6 715 hop streams against 0/0 — reproduced with two clients instead of
thousands.

`REQUIREMENTS.md`, `ROADMAP.md` and `STATE.md` were **not** touched. `BENCH-06` is still `[ ]`, and
this plan does not close it; §4 of the reading document says at length why it cannot.

## What landed

- `packages/cloudflare/src/relay-counters.e2e.test.ts` — one `it`, one run, four `GET /self`
  readings, its own port (8824) and its own `mkdtempSync(join(tmpdir(), 'o2-relay-counters-'))`
  persist directory. 498 lines.
- `.planning/phases/phase-39-the-public-run/39-COUNTER-READING.md` — the dated reading, the deployed
  numbers beside it, the verdict, and what it forecloses for criterion 4. 180 lines.

Both in commit `b7a2fef`. `git show --stat` lists exactly those two files and nothing else.

## The arrangement, and the two settings that are not tidiness

One `wrangler dev` on 8824 with `CLOUDFLARE_API_TOKEN` blanked, one reserving peer carrying
`circuitRelayTransport` and listening on `/p2p-circuit`, one seeking peer that dialled the reserver
**through** the circuit —
`/ip4/127.0.0.1/tcp/8824/ws/p2p/<relay>/p2p-circuit/p2p/<reserver>` — and a 4 096-byte payload each
way over a protocol registered `runOnLimitedConnection: true`.

Two decisions were forced by what was read before the file was written.

**The address omits `/webrtc`, deliberately.** The circuit address this tree already builds for
rendezvous ends `/p2p-circuit/webrtc/p2p/<peer>`, and `traffic-split.ts`'s own header is explicit
that such an address is a *signalling* path whose data leaves the relay — `WebRTC.matches` answers
true and the classifier answers `direct`. Measuring `traffic.relayed` over that address would have
measured the wrong connection class and produced a zero for a second, unrelated reason.

**`ANNOUNCE_MULTIADDRS` is overridden to loopback for the spawned worker.** `wrangler.jsonc` announces
the deployed host, and a local relay left at that value hands its reserving client a circuit address
pointing at **production**. `--var` merges rather than replaces (the measurement is recorded on
`HostedEnv.O2_VERSION`), so one key moves and the rest stand. Without this the run could have sent a
measurement's traffic to the object the owner pays for, which is the fence this plan exists inside.

The probe protocol is registered and dialled **inside the spec** rather than through
`Libp2pTransport`. The plant is the removal of that registration's `runOnLimitedConnection: true`,
and in the shared transport that flag lives in shared source — which the tree's concurrency
conventions forbid planting into while other agents hold the same working tree. It also keeps
NET-13's send budget out of a measurement about counters.

## The reading

Transcribed from the run output, not re-derived:

| point | `direct.cs` | `direct.bytes` | `relayed.cs` | `relayed.bytes` | inHop | outHop | outStop | inStop | `relayService.bytes` |
|---|---|---|---|---|---|---|---|---|---|
| R0 cold | 0 | 0 | **0** | **0** | 0 | 0 | 0 | 0 | 0 |
| R1 reserved | 0.279 | 2 893 | **0** | **0** | 1 | 0 | 0 | 0 | 280 |
| R2 relayed | 0.557 | 33 080 | **0** | **0** | 2 | 0 | 1 | 0 | 22 129 |
| R3 stopped | 4.577 | 33 348 | **0** | **0** | 2 | 0 | 1 | 0 | 22 129 |

`outboundStopStreams` reaching 1 at R2 is what says a relayed connection was actually *delivered*,
not merely reserved — the relay opened a stop stream to the reserver and spliced. The
`relayService.bytes` delta over that step is **21 849** against 8 192 bytes of payload, so the
spliced traffic itself is counted and not only the CONNECT protobuf that set it up; the remainder is
the Noise handshake, the muxer framing and the negotiation that also ride the circuit. Over the same
step `traffic.direct.bytes` moved **30 187** — the same forwarded payload counted a second time at
the connection layer, which is the overlap `relay-service-log.ts` declares and which this reading
confirms against a running object rather than against a docblock. The two must be reported side by
side and never reconciled by subtraction; the 8 338-byte difference is framing, not relayed traffic.

R3 is above R2 on both `direct` columns, so the split accrues live *and* banks at close, and no
instance eviction happened between the two readings. That matters because the split is per-instance
and an eviction would have produced a small number for a reason that has nothing to do with the
question.

**The reading reproduced.** The spec ran twice against identical source — once before the plant and
once after the restore. Every byte and stream count above is identical across both. The only figures
that moved are the two live clock readings, `direct.connectionSeconds` at R2 (0.549 → 0.557) and R3
(4.569 → 4.577), which is exactly what a counter adding `now - openedAt` should do.

## The positive control

`direct.connectionSeconds` 0 → 0.557 and `direct.bytes` 0 → 33 080, in the same run, on the same
instrument, at the same four moments. It is asserted, not merely printed, and its failure message
names both observed values. Without it a run in which nothing ever connected produces the identical
`relayed` zeros and passes — which is the failure mode this repository has hit twice, and both times
a control arm inside the same run is what caught it.

## The plant, watched red, verbatim

`runOnLimitedConnection: true` was removed from the reserver's `handle()` registration. One line.
Snapshot taken immediately before, restored afterwards by the inverse of that same edit, `cmp` silent
against the snapshot, `cmp` exit `0`. `diff` afterwards showed the file differing from the snapshot
only by the header block that records the plant.

Green run `1 passed`, planted run `1 failed`, exit `1`:

```
StreamResetError: The stream has been reset
 ❯ YamuxStream.onRemoteReset node_modules/@libp2p/utils/src/abstract-message-stream.ts:358:16
 ❯ YamuxStream.processFlags node_modules/@chainsafe/libp2p-yamux/src/stream.ts:242:11
```

Only `R0` and `R1` printed; `R2` and `R3` were never taken. The red therefore arrives **before** any
assertion, as the reserver aborting the inbound stream — `libp2p/dist/src/connection.js:180` reads
the registrar's options and throws `LimitedConnectionError` when the connection reports limits — and
reaching the dialler as a remote reset.

**The red is what proves the path is relayed**, which is more than the plan asked the plant to do.
The flag is only consulted on a connection libp2p considers limited, so a plant that reddens means
the connection *was* limited, which means it was carried by the relay rather than upgraded off it.
The spec records the same fact from the dialling side in a `[BENCH-06 arrangement]` line:
`limits={}` — an empty object, which is not `null`, which is precisely what `this.limits != null`
tests. That reading was added because CLAUDE.md records a deployed relayed connection whose `limits`
"reported no limits", and if this run had shown `limits` undefined the plant could only ever have
been green for a reason about the library rather than about the arrangement.

## Every command, with the exit code read on the next line

| command | exit |
|---|---|
| `npx tsc --noEmit` (before the run; zero lines of output) | `0` |
| `/usr/bin/time -p npx vitest run --project e2e relay-counters` (green) | `0` |
| `/usr/bin/time -p npx vitest run --project e2e relay-counters` (planted) | `1` |
| `cmp <file> <snapshot>` after the surgical restore | `0`, silent |
| `npx tsc --noEmit` (after the header edit) | `0` |
| `/usr/bin/time -p npx vitest run --project e2e relay-counters` (final green) | `0` |
| `bash scripts/cheap-guards.sh` | `0` — 401 passed (401) |
| `git commit -- <two paths>` | `0` |

`EXIT=$?` was on the line immediately after each, with output redirected to a file rather than piped.

## Host conditions and cost

```
[host conditions] host was quiet — load/core 0.55 before, 0.51 after (8 cores, ceiling 4.00)
[host conditions] wall clock 5.89 s
real 6.64
user 1.07
sys 0.33
```

`(user+sys)/real` is **0.21**, which is the expected shape and not a starved process: the spec spawns
`wrangler dev`, waits on a reservation and sleeps two seconds for the close to bank, so `real`
legitimately exceeds CPU time. The banner reports the host quiet, so the durations are quotable.

## Cost, and what was not spent

**Three reservations, every one against a local `workerd`.** One per run of the spec — the green run,
the planted run, and the final green — each granting exactly one reservation to the reserving peer,
and each followed by one relayed CONNECT. **Zero requests of any kind were sent to the deployed
object.** The 2026-09-04 `GET /self` numbers in §2 of the reading document are the ones already
quoted in the plan; no second deployed read was taken, and none is needed, because the anomaly is a
shape and the shape is what reproduced. Nothing was deployed, published or released, and the three
`ocr-checks-worker*` scripts were not read or touched.

## What this does NOT explain, stated rather than left to be found

**Whether the deployed object's zero has the same cause as this one's.** The local run is two clients
on one host against a relay whose announced address was overridden to loopback. The deployed object
has held 6 715 hop streams from peers this run cannot characterise, and its split is per-instance —
`relay-service-journal.e2e.test.ts` already proves an evicted instance answers as though nothing had
happened. So nothing observable from here rules out that it once held a connection the classifier
would have called relayed and that the instance holding it was evicted before anyone looked. What the
reading does establish is that the pair needs **no** such explanation: the shape arises with no
eviction, no defect and no lost connection.

**Whether the deployed `6 715` and `53` describe 6 715 and 53 of anything.** They do not. Both are
stream counts, and the counter cannot distinguish a RESERVE from a CONNECT — `relay-service-log.ts`
says so by name, which is why the marker is `firstInboundHopStreamAt`. One device opening several
circuits is several hop streams.

**A scale claim.** Two clients is not hundreds, and this run says nothing about what either counter
does under a cohort.

## What it forecloses for criterion 4

Neither counter counts machines. `inboundHopStreams` counts hop streams; `traffic.*` counts this
node's own connections and carries no peer identity at all. So the distinct-machine half of
`BENCH-06` cannot be read off `/self`, and a figure derived from either and captioned as a machine
count would be the same-host figure criterion 4 forbids by name. The funnel cannot supply it either:
its store is aggregate, it cannot be joined to a job, and its schema is frozen at digest
`3911527f1a04abee` — a new field reddens `packages/net/src/funnel-schema.test.ts` in both lanes. The
participant count is built in plan `39-04`, whose machine half waits on the owner's ruling about what
a peer may announce about its own machine (`39-08` Task 2: `announce-coarse`, `peers-only`, `defer`).

## Deviations from plan

**None of the four deviation rules fired.** Two judgements inside the plan's own latitude are worth
naming rather than burying.

1. **No poll before R2.** The plan's shape invited waiting for `relayService.bytes` to move before
   taking R2. That would have made assertion 4 assert its own loop-exit condition — the failure this
   repository has already recorded twice as *an assertion must not reuse the value it tests*. It is
   not needed either: the relay forwards synchronously inside its own isolate, so the reply arriving
   at the seeker is proof both byte wrappers have already run. The one wait that IS present is gated
   on an **independent** client-side signal, the reserver publishing a `/p2p-circuit` address, which
   is a reservation being granted rather than a counter moving.

2. **Assertion 4 is honest about what it can prove.** `relayService.bytes` at R2 exceeding R1 is
   satisfied by the CONNECT protobuf alone, so the assertion by itself does not prove the *forwarded
   payload* was counted. The failure message therefore carries the delta and the payload size beside
   each other, and the 21 849-against-8 192 reading — which does prove it — is recorded in the
   document rather than smuggled into an assertion that cannot see it.

## Threat flags

None. No new network endpoint, auth path, file access pattern or schema change. `request.cf` and
`CF-Connecting-IP` are never read, logged, snapshotted or committed by this spec (T-39-14); the only
values it prints are counters and a `limits` object.

## Known stubs

None.

## Self-Check: PASSED

- `packages/cloudflare/src/relay-counters.e2e.test.ts` — FOUND
- `.planning/phases/phase-39-the-public-run/39-COUNTER-READING.md` — FOUND
- commit `b7a2fef` — FOUND, and `git show --stat` lists exactly those two files
- the four `[BENCH-06 counters]` lines in §1 of the reading document are byte-equal to the recorded
  run output, checked with `grep -qxF` against the saved log — 4 of 4 MATCH
- the host-conditions banner and the three `/usr/bin/time -p` lines are byte-equal to the same log
- `grep -v '^#' 39-COUNTER-READING.md | grep -c '3911527f1a04abee'` → `1`; the same for `39-04` → `2`
- `grep -inE 'san |frankfurt|london|são|sao paulo|virginia|us-east|eu-west'` on the document returns
  nothing, exit `1`
- port `8824` and persist prefix `o2-relay-counters-` are used by no other spec in the tree
