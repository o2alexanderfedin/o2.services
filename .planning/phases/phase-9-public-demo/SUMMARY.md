# Phase 9 — Public Demo, Consent UX & Disclosure Gate

**Completed:** 2026-07-26 · **4 of 5 criteria** · DEMO-02, DEMO-03, DEMO-04,
BROW-01, BROW-02, BROW-04 done; DEMO-01's multi-machine half unrun.

```
Test Files  92 passed        node 574 · browser 513 · e2e 27
     Tests  1114 passed
tsc --noEmit  clean
Requirements  64 / 72
```

## What is true now that was not before

A visitor opens the page and **nothing has happened**. No CPU, and — the stricter
reading the owner chose — no network either: no relay dial, no `/bootstrap.json`,
no address disclosed to anybody. They read what would run, in five plain questions,
and press a button or don't. If they press it, a node starts, a fixed bar appears
naming the peers whose work it is running, and one control ends the thread.

The job is a search for a 2-colouring of {1…N} with no monochromatic Pythagorean
triple. The fabric's answer is checked **in the visitor's own tab, from the
definition** — `verifyColouring` re-derives every triple from a² + b² = c² and
either accepts the claim or names the triple that refutes it. A test presses that
button with the node stopped and every peer gone, because a check that needed a
peer would be one more thing to trust rather than the escape from trusting things.

## Decisions worth carrying forward

**Consent is a value, not a check.** `GrantedConsent` is minted only by
`grantConsent`, and `start` takes one as a parameter — a caller without one does
not fail a check, it fails to compile. The runtime half is a module-private symbol
the constructor demands. Deliberately no test-only bypass: the e2e harnesses call
`grantConsent()` for the same reason a visitor clicks the button, because a path
that could start without consenting would be a path.

**The obvious implementation was `if (hasConsent()) start()`** — a rule somebody
has to remember at every call site, and this project has been bitten twice by rules
that were documented rather than enforced.

**Stopping had to become real before it could be claimed.** `WasmExecutor` ran on
the main thread, where a synchronous `run()` cannot be interrupted by anything, so
"one click drops CPU to zero" actually meant "zero once the current task finishes".
Every cooperative variant — a flag, a duty cycle lowered to nothing, a governor
asked politely — degrades the same way. Tasks now execute in a Worker and Stop
calls `terminate()`. The probe that proves it is a bare `loop br 0`: no flag, no
duty cycle and no governor can reach it.

**A blocking metric must publish its own blind spot.** A node that cannot reach a
peer cannot report that it cannot reach a peer, so the reported population is never
the visited population — and that gap *is* the blocklist cliff the requirement
exists to expose. `StartReport` carries what it could not see as a field and renders
it in the same string as the numbers, the discipline `@o2/bench` already uses for
excluded configurations.

**Failure is an enumerated cause, never a boolean**, and it is established by
probing the environment rather than by matching error text. A metric built from
string-matching three browsers' error prose drifts silently and is wrong precisely
when a browser changes its wording — the event the measurement exists to notice.

**The crypto probe is `getRandomValues`, never `subtle`.** A LAN origin is not a
secure context, so `subtle` is absent there while `getRandomValues` works. A probe
that checked for it would report every LAN visitor as blocked and manufacture a
cliff that does not exist.

**Chromium throttles timers hard in a tab that is not in front.** Measured, not
assumed: a 400 ms poll produced one tick per second. Anything the always-visible
surface depends on is therefore **pushed**, never polled — a node started or served
in a background tab would otherwise show a stale surface, or none, for exactly as
long as nobody was looking at it. This is the case BROW-04 exists for.

**Ordering is what makes cubes worth having.** The colouring search first hit a wall
at n = 205 that no amount of parallelism moved. The reason is the interesting part:
assigning values in increasing order means a cube fixes the *least* constrained
numbers — 1 and 2 appear in no triple at all — so cubing split the work without
splitting the difficulty. Ordering by constraint degree instead moves the wall with
cube count: 1 cube → 300, 8 → 500, 256 → 600. A second tab is now visibly worth
something rather than merely present.

**`exhausted` and `budget` are different answers and must stay different.** One is
a proof that a cube contains no colouring; the other is "I ran out of steps".
Reporting the second as the first would turn a shortage of compute into a false
mathematical claim. The page says so in those words when a rung stops.

## Guards, and the mutations that proved them

Every guard added in this phase was deleted or inverted and the suite required to
fail. Six mutations, six caught:

| Mutation | Caught by |
|---|---|
| constructor accepts any symbol | consent can be fabricated |
| version check removed | stale consent survives changed terms |
| reporting defaulted to on | a pre-ticked box |
| absent consent read as granted | the gate opens by itself |
| `terminate()` becomes a cooperative flag | the thread survives Stop |
| the page skips the gate on load | six e2e assertions at once |

The fifth is the one worth remembering. **Rejecting the pending promises made every
other test pass while the thread kept burning.** Resolving the caller and killing
the worker are two different acts, and only one of them is the requirement. It was
caught by exactly one test — the one that messages the thread directly, past the
executor, and requires silence.

## Errors found in this phase's own work

- **A ledger keyed on `` `${browser} ${result}` ``** split on the first space and
  filed `chromium 141 started` as the browser `chromium` with the result
  `141 started`. Fixed by storing the parts rather than parsing the key back — a
  decomposition that is never performed cannot be performed wrongly.
- **Merging eight peers' counts by summing** would have multiplied every sample
  size by eight while leaving the percentages unchanged: a correct-looking rate over
  a fictional `n`. `mergeDisjoint` and `mergeOverlapping` now carry the distinction
  in their names.
- **The always-visible bar was invisible in a background tab**, twice — once
  because it was started inside the Start click handler, once because serving a
  peer's work notified nobody. Both were caught by asserting on what the *page*
  said rather than on what the API returned.
- **The vocabulary guard caught two hits in code written this phase** — a test that
  spelled the banned words out in an array, and a user-agent parser that called a
  substring by a banned word. The first was redundant and is gone; the second is
  renamed rather than exempted, because an exemption is a thing to maintain and a
  rename is not.

## What is not true

**The multi-machine half of DEMO-01 was not run.** Two tabs on one machine
distribute the colouring job over a direct WebRTC connection with placement shown;
two *machines* running this job were not tested. Phase 3 proved an iPhone and a
laptop completing a 4-shard 2×-redundant job over the same transport, and nothing
about this job depends on the transport — but "was not run" is not "works", and
this project does not close that gap by reasoning. It needs a second device and a
human to open a page on it, the same blocker family as Phase 3 criterion 1 and
BENCH-06.

**The search is plain chronological backtracking with a better variable order.** No
unit propagation, no conflict analysis, no solver. n = 600 out of 7824 is not close,
and the demo says so on the page rather than choosing a number that flatters it.

**Nothing is deployed.** The repository still contains no deploy workflow file and
no deploy script — absent, not disabled — and a test asserts both. Publishing
remains a sequence a human performs deliberately.
