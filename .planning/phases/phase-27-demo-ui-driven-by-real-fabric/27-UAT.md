---
status: complete
phase: 27-demo-ui-driven-by-real-fabric
source:
  - 27-01..27-10 SUMMARY.md (the phase's own plans)
method: live browser (Playwright MCP, headed Chromium) against a real `bin/seed.ts`
started: 2026-08-20T06:31:00Z
updated: 2026-08-20T06:40:00Z
---

## Current Test

[testing complete]

## How this was run, so the reading can be repeated

Not the vitest `e2e` project — that already covers this ground with 36 files and 232
tests, 9 of which drive `bin/seed.ts`. This was a **hand-driven session in a live
browser**, taken to see with eyes what those specs assert in text.

    node --experimental-strip-types packages/node/src/bin/seed.ts --port 5199

    seed peer id  12D3KooWJrZXwzNfEMfX6ZXKz6H5sUWUsDA2hc3i81QTQk75mM5L
    relay         /ip4/127.0.0.1/tcp/56736/ws/p2p/12D3KooWJrZ...
    capacity      64 reservations          <- the new O2_MAX_RESERVATIONS default, live
    page          http://localhost:5199/packages/browser/demo/index.html

    tab peer id   12D3KooWC2u8b9JdqWJTbxtJh6ejY2mqQuU3VS6gmATekk13wPuw

**The seed reported `capacity 64 reservations`** — the default changed from libp2p's 15
this same day, and this is its first reading outside a test.

## Tests

### 1. Cold start from the operator's own entry point
expected: `bin/seed.ts` boots, serves the demo, announces a browser-dialable relay
result: pass
note: three relay addresses offered (loopback, LAN, VM bridge) plus a QR code

### 2. Consent gate blocks everything until answered
expected: nothing runs and nothing is contacted before the visitor allows it
result: pass

### 3. The disclosure tells the truth about the persistent key
expected: the page states that a key is stored and reloaded, so two visits are one node
result: pass
note: verbatim — *"It is the name other participants know your node by, and it is loaded
  again the next time you visit rather than made afresh — so two visits are the same node,
  not two strangers."* This is the correction from the 2026-08-18 finding that the page
  had told visitors something false for twelve days. It reads correctly now.

### 4. Starting the node produces a real identity on a real relay
expected: a peer id, a dialable `/webrtc` address through the relay, a connected peer
result: pass
note: 7 WebRTC addresses, all of form `<relay>/p2p-circuit/webrtc/p2p/<self>`;
  `window.o2.peers()` contained the seed's peer id

### 5. Every region leaves named-absence when the node starts
expected: the "this tab's node is stopped" sentences are replaced by live readings
result: pass
note: counted **0** occurrences of `node is stopped` in the whole document after start,
  against ~14 before it. The named-absence pattern is doing exactly its job in both
  directions, which is the thing this phase exists to prove.

### 6. The colouring ladder runs and stops where it cannot settle
expected: rungs attempted in order, stopping at the first the fabric cannot settle
result: pass
note:
      FIRST  RUNG  FOUND     · 8 found · 0 proved empty ·  8 out of budget ·  995ms
      SECOND RUNG  FOUND     · 2 found · 0 proved empty · 14 out of budget · 1001ms
      THIRD  RUNG  FOUND     · 3 found · 0 proved empty · 13 out of budget · 1318ms
      FOURTH RUNG  no answer · 0 found · 0 proved empty · 16 out of budget · 1497ms
  Live status line read `settled n = 500`, and the tab reported `64 task(s) done`.

### 7. Placement is shown, per cube, by node id
expected: the reader can see where each cube ran
result: pass
note: `cube 0: 12D3KooWC2u8b9Jd... + 12D3KooWJrZ...` and the same for cubes 1 and 2 —
  two distinct nodes per cube, the tab and the seed. Redundancy visible, not asserted.

### 8. The quorum card reports a named absence rather than a strength
expected: with no signed statements available, it says so instead of implying weakness
result: pass
note: *"nothing established. 2 replicas agreed on the least-attested cube, and 0 of those
  produced a signed statement this tab could check."*

### 9. The composer card reports its own distinct fact
expected: what the composer decided beforehand, separate from who answered
result: pass
note: *"not attempted — this requestor holds no certificate for at least one candidate,
  so it has nothing to compose a quorum from — the receipt reports the named absence
  rather than a strength."* This is **Phase 24's stated bound observed from the outside**:
  the default posture is open and uncertificated, and the page says so in its own words.

### 10. EGR-01's first arm — a run that registered nothing sovereign
expected: the zero is qualified as the guard having nothing to hold back
result: pass
note: *"35 frames sent, 16492 byte(s) total. 0 withheld — and this run registered no
  sovereign data, so that is the guard reporting it had nothing to hold back, not a
  proof of sovereignty."*

### 11. EGR-01's second arm — a run that DID register sovereign shards
expected: the same zero, qualified differently, because the count differs
result: pass
note: *"0 frames sent, 0 byte(s) total. 0 withheld — and this run registered 4 sovereign
  shards, so the guard was watching for those bytes and saw none of them leave. That is
  a clean scan of what crossed, not a proof about what could not."*
  **Both arms were observed in one session and they differ by the count alone**, which is
  precisely what `demo-fabric.e2e.test.ts` asserts. Seen, not inferred.

### 12. A sovereign dispatch from the page is refused, and refused out loud
expected: it does not run somewhere it should not, and the refusal is legible
result: pass
note: ticked `byo-sovereign`, set `byo-owner-id` to `owner-alpha`, dispatched. The page:
  - status: *"the fabric refused at least one shard — its own words are below"*
  - *"refused by every executor it reaches, including this tab's own."*
  - *"sovereign dispatch from here is reported as unplaceable rather than run somewhere
    it should not be."*
  This is **designed behaviour, not a defect**, and it is the live confirmation of the
  open item recorded as "a sovereign dispatch from the demo page is still refused".
  Screenshot: `evidence/2026-08-20-byo-sovereign-refusal.png`

### 13. `owner-domain` on a display site
expected: Phase 19 criterion 5 requires the label shown for a sovereign shard
result: **not displayed**
note: `/owner-domain/i` matched **nothing** in the rendered document — not on the
  colouring workload, not on the fabric-state tab, and not on the BYO panel after a
  sovereign dispatch. See the Gaps section; this is not scored against Phase 27.

## Summary

total: 13
passed: 12
issues: 0
pending: 0
skipped: 0
observations: 1

## Gaps

Nothing found against **Phase 27's own goal**. Every surface read in this session was
derived from the live fabric, and each named absence named the right absence.

One observation, recorded against **Phase 19 criterion 5** rather than this phase:

```yaml
- truth: "owner-domain is shown on a display site for a sovereign shard"
  status: still_open
  phase: 19
  criterion: 5
  reason: >-
    Confirmed by direct observation in a live browser on 2026-08-20, not by reading code.
    `owner-domain` appears nowhere in the rendered document, including after a sovereign
    dispatch that registered 4 sovereign shards. 19-VERIFICATION.md's own words —
    "owner-domain is displayed by nothing, anywhere" and "no display site has shown the
    label for a sovereign shard" — are still true.
  bearing: >-
    The clause cannot close from the browser tier while a sovereign dispatch from the page
    is refused (test 12), because there is no completed sovereign run for a label to
    describe. The two are one item, not two.
  severity: not-a-regression
```

## What this session does NOT establish

- **It is not a substitute for the e2e project.** Those 36 files ran green earlier the
  same day (232 tests, exit 0) and cover far more than a hand-driven pass can.
- **No verdict is recorded here.** Ticking a ROADMAP checkbox is an owner edit under this
  repository's own rule, and a UAT pass is not a verifier's verdict. This file is
  evidence for that decision, not the decision.
- **One host, one browser (Chromium), one seed.** Nothing here says anything about
  Firefox, WebKit, or a second machine.
