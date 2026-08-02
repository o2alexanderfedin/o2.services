---
phase: phase-18-discovery-capacity-placement
plan: 09
subsystem: scheduling
tags: [governor, duty-cycle, browser-tier, visibility, composition, BROW-03]

requires:
  - phase: phase-18-discovery-capacity-placement/18-07
    provides: "`DutyCycleGovernor` with `environment` composition — the object this plan wraps the tab's `VisibilityGovernor` in"
  - phase: phase-18-discovery-capacity-placement/18-08
    provides: "The Node-tier composition and its layer order, which this tier had to match rather than mirror loosely"
provides:
  - "`browser-node.ts` composes `new DutyCycleGovernor({dutyCycle, sleep, environment: visibilityGovernor})` — the effective rate is the lower of the user's cap and the environment's"
  - "`window.o2.setDutyCycle()` and `window.o2.capacity()` — SCHED-04's user-adjustable half on the tier where the user is a visitor"
  - "`DutyCycleGovernor.ownDutyCycle` — the cap before composition, so a capacity can follow the user without following the window manager"
  - "`DutyCycleGovernor.yieldSlice` delegates to the environment when the environment is what binds, so the environment's own accounting keeps being written"
  - "`duty-cycle-tab.e2e.test.ts` — a live Chromium tab, a real relay, both sides of the composition, and a stated gap"
affects: []

tech-stack:
  added: []
  patterns:
    - "Plant against the READING, not the number: an advertised figure fed straight from a governor stays correct even when the executor was handed a different governor"
    - "Wrapping an object bypasses its accounting unless the wrapper delegates — an instrument that stops being written is indistinguishable from the behaviour it measures having stopped"
    - "When integration evidence overrules a unit assumption, quote the original expectation in its replacement and add the opposite branch so the new assertion cannot be satisfied vacuously"
    - "Record a supporting measurement that came back NEGATIVE next to the thing it failed to support"

key-files:
  created:
    - packages/node/src/duty-cycle-tab.e2e.test.ts
    - .planning/phases/phase-18-discovery-capacity-placement/18-09-SUMMARY.md
  modified:
    - packages/browser/src/browser-node.ts
    - packages/browser/src/tab-api.ts
    - packages/browser/demo/main.ts
    - packages/core/src/governor.ts
    - packages/core/src/governor.test.ts

key-decisions:
  - "The composition takes the LOWER of the two rates and both are read live, so a tab backgrounded after a cap was set is honoured without anything being rebuilt."
  - "This REVERSES a decision recorded beside that very construction, and the old comment is quoted where it stood rather than deleted. Its reasoning was sound and its premise was not: `GovernedExecutor` is the mechanism and the slot count is the statement about it, and since they now share one object neither can fail to know about the other — which was the specific fear."
  - "`LocalCapacity` reads `ownDutyCycle` — the user's cap ALONE — while the executor reads the composed value. A backgrounded tab should finish what it took on and merely run it slower (BROW-03); it should not start refusing work it had already advertised capacity for."
  - "`ownDutyCycle`'s doc records that the obvious supporting measurement came back NEGATIVE, and that no test in the repository currently fails when the distinction is collapsed. Kept on its merits, with that stated."
  - "`yieldSlice` delegates to the environment when `environment.dutyCycle <= ownDutyCycle`, using `<=` so a tie goes to the object whose accounting somebody is reading."
  - "The `hidden` signal is SIMULATED, for a measured reason: Chromium under automation never reports a page as hidden in headless or headed mode, because no window manager drives tab activation. `document.hidden` is shadowed and a real `visibilitychange` is dispatched; the document, listener, governor and executor are all genuine."
  - "BROW-01 gets no test-only bypass — the harness calls `grantConsent()` for the same reason a visitor clicks the button."

patterns-established:
  - "A test can pass 5/5 against the wrong composition. `capacity()` and `governor()` are fed by the cap governor directly, so every advertised number stays right while the executor paces at the environment's rate. Only `activity().dutyCycle`, which reads the executor's OWN governor, can tell the two apart."

requirements-completed: []

duration: ~3h
completed: 2026-08-01
---

# Phase 18 Plan 09: A duty cycle a tab can change — Summary

**The browser half of SCHED-04. A visitor can cap what the tab spends on the fabric, and
that cap composes *over* the visibility governor rather than replacing it — so adding a
user control did not quietly unbind the background throttle it sits on top of.**

## What changed

```
browser-node.ts:
  capGovernor = new DutyCycleGovernor({ dutyCycle, sleep, environment: visibilityGovernor })
  executor    = new GovernedExecutor(counter, capGovernor)        ← composed value
  admission   = LocalCapacity({ dutyCycle: capGovernor.ownDutyCycle })  ← the USER's cap alone
```

`window.o2.setDutyCycle()` and `window.o2.capacity()` expose it. The effective rate is the
lower of the two ceilings, read live from both.

The split between what the **executor** reads and what the **capacity** reads is
deliberate and is the one genuinely new idea here. A slot count is a statement about what a
node will *accept*; an environment throttle is a statement about how fast it runs what it
*already accepted*. BROW-03 says a backgrounded tab finishes what it took on and merely
runs it slower — it must not start refusing work it had already advertised capacity for.
So the capacity follows the user and not the window manager.

**That distinction is kept on its merits, and its supporting measurement came back
negative** — recorded in `ownDutyCycle`'s own doc rather than left implied. Feeding the
composed value to `LocalCapacity` *does* arithmetically collapse a backgrounded tab toward
one slot, but removing that coupling did not fix the failure that prompted the change, so
it was not the cause. No test in this repository currently fails when the distinction is
collapsed. Worth knowing before relying on it.

## Reversing a recorded decision

A comment beside this very construction argued against exactly this change: *two
independent throttles on one path produce a number nobody can predict.* It is quoted where
it stood rather than deleted.

Its reasoning was sound; its premise was not. They are not two throttles. `GovernedExecutor`
is the mechanism, and the slot count is a statement *about* that mechanism — advisory,
reserving nothing. Since they now share one object, neither can fail to know about the
other, which was the specific fear the old comment named.

## Two things this cost, both found by measurement rather than review

**1. The first e2e passed 5/5 against the wrong composition.**

`capacity()` and `governor()` are fed by the cap governor *directly*. So with the
visibility governor wired to the executor instead of the composed one — the obvious wrong
turn — every advertised number stayed correct while the tab paced itself at the
environment's rate and ignored the user's cap entirely. The plant changed nothing. Five
green assertions, none of them touching the defect.

`activity().dutyCycle` reads `node.executor.dutyCycle`, i.e. whatever governor the executor
was *actually* built with. It is the only reading in the file that can distinguish the two
compositions. With it, the plant reddens: `expected 1 to be 0.25`.

**Plant against the reading, not the number.**

**2. Wrapping `VisibilityGovernor` broke BROW-03, and not where predicted.**

The first hypothesis — that coupling admission to the composed value made a backgrounded
tab refuse work — was arithmetically sound (`floor(8 × 0.05)` → 1 slot) and **wrong**.
Removing the coupling did not fix it.

The cause was `yieldSlice`. `GovernedExecutor` called the *wrapper's*, so
`VisibilityGovernor`'s own never ran and its `sleptMs` counter stayed at 0 — while the
pacing was perfectly correct. `background-tab.e2e.test.ts` went red on
`expected 0 to be greater than 0`.

**An instrument that stops being written is indistinguishable from a throttle that stopped
happening, and only one of those is survivable.**

So `DutyCycleGovernor.yieldSlice` now delegates to the environment when the environment is
what binds. That changed a case 18-07 had written three days earlier, which asserted the
wrapper computes and sleeps the composed amount itself. The integration evidence overruled
the unit assumption; the original expectation is quoted in its replacement, the property it
existed for is still held, and **the opposite branch was added** so "delegates" cannot be
satisfied by a governor that always delegates.

## What is not measured, stated in the test header rather than left for a verifier

**No peer reads the tab's slot count off the wire.** That needs a Node-tier `FabricNode`
dialling a browser and sending an `offer` frame, and nothing in this repository does that
yet — every existing browser↔peer path in `e2e` is tab-to-tab. That is transport ground
this plan had no business breaking on the way past.

The wire half **is** measured, on the Node tier, in `duty-cycle.node.test.ts`, over
tcp + noise + yamux. The object that produces the number — `LocalCapacity` reading a
governor — is the identical class constructed the same way on both tiers. So the gap is the
**reading**, not the behaviour, and criterion 3's browser half should be scored against
that distinction rather than against this file's silence.
