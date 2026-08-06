# Deferred items — Phase 24

Out-of-scope discoveries, logged rather than fixed. The scope rule this file exists for:
only issues **directly caused by the current task's changes** are auto-fixed.

## `tools/aot/lift.node.test.ts` — 9 cases red on a loaded host (found 2026-08-06, Plan 24-03)

**Observed** during 24-03's full `npx vitest run --project node`: exit 1, `2 failed | 160
passed` files, of which 9 of the 10 failing cases are in `tools/aot/lift.node.test.ts`. The
tenth was 24-03's own and was fixed.

**The failure text is the file's own self-diagnosis**, not an assertion:

> `an answer that cost 20007 ms leaves no room for another attempt inside the 30000 ms this
> wrapper may spend inside a 60000 ms case, so this case never ran: docker was reached but did
> not answer within 20000 ms — the daemon is wedged or the host is swamped, so nothing here is
> known about the image or the lift; retry when the host is quieter`

**Why it is not 24-03's**, by measurement rather than by plausibility:

- `lift.node.test.ts` imports `node:*`, `vitest`, `@o2/core`, `@o2/aot` and `./stubs.ts`.
  **Nothing Plan 24-03 touched is reachable from it** — not `fabric-node.ts`, not
  `browser-node.ts`, not either binary. `grep` for all four in that file and in `lift.ts`
  returns nothing.
- It fails identically when run alone with `-t`, so it is not an interaction with a
  concurrently-running spec of 24-03's.
- `24-02-SUMMARY.md` records `--project node` at exit **0** earlier the same day, so this
  arrived between that run and this one without either plan touching the file.

**What is known about the host**, measured after the run: `docker info` exits 0, and
`docker image inspect --format '{{.Id}}' alpine:latest` answers in **0.09 / 0.11 / 0.18 s**
across three readings. So the daemon is *not* wedged now. The 20 s exhaustion was observed
during a 434 s full-project run with concurrent agents on the machine, which is the second
half of the file's own stated condition — *"or the host is swamped"*.

**Not fixed, and not re-run hoping it clears.** Owner: whoever next takes `tools/aot`. The
useful next step is a reading taken on a quiet host, since the file already names the
condition it wants and this run does not establish whether anything else is wrong.

**RESOLVED BY THE HOST, and recorded because the resolution is the evidence.** The second
full `--project node` run of the same session — same code, 409.53 s — has
`lift.node.test.ts` **green**, all nine cases. So the file's own self-diagnosis was right
and this entry is closed as "the host was swamped", not as "unexplained". It is kept rather
than deleted because a nine-case red that vanishes on a re-run is exactly the shape somebody
later attributes to the wrong commit.

## `late-combine.node.test.ts` — one case red on a loaded host (found 2026-08-06, Plan 24-03)

**Observed** in the second full `--project node` run: exit 1, `1 failed | 161 passed` files,
the single case being *"delivers a reply the requestor had already timed out, and the pause is
what caused it"* (MR-04, criterion 6).

**The assertion** is a self-calibrating timing budget, not a behavioural one:

> `expect(RPC_TIMEOUT_MS).toBeGreaterThan(healthyCombineMs * TIMEOUT_MARGIN)` —
> `expected 1500 to be greater than 2005.7041700000082`

`TIMEOUT_MARGIN` is 10 and `healthyCombineMs` is the **floor** of six cold combine samples,
which came in at `[201, 201, 299, 348, 479, 580]` ms. The budget needs that floor under
150 ms; under whole-suite load it was 200.6 ms. The line's own comment records this history:
*"Reading the first is what made this line fail three times under whole-suite load."*

**Why it is not 24-03's**, and this attribution is structural rather than circumstantial:

- `grep -c "relayAddrs\|relay-addr"` over that file returns **0**. **No node in it ever
  requests a circuit reservation**, so `denyInboundRelayReservation` — the only thing this
  plan added to a running node — is never reached. This is the identical argument 24-02
  established for the bench rigs: a fixture that hands out no relay address never enters the
  reservation protocol at all, whatever any relay's posture is.
- For an `'admits-any-peer'` node the gate factory returns `undefined` and **no gater key is
  spread into `createLibp2p`**, so the constructed options are byte-identical to before.
  Pinned by `relay-admission.node.test.ts`'s *"builds no gate at all for the open posture"*.
- It **passed in the first full run of the same session**, on the same production code.
- Verified in isolation rather than assumed — *"passes in isolation" is a claim to verify*:
  **2 passed, `real 12.42 user 12.68 sys 2.74`, ratio 1.24.**
- The quantity that moved is a *combine* latency floor, which has no path to a relay
  reservation.

**Not fixed.** Owner: whoever next takes MR-04's timing budgets. The file already carries a
five-regime measurement of where its margin runs out; what it lacks is a floor that survives
this host under whole-suite load.
