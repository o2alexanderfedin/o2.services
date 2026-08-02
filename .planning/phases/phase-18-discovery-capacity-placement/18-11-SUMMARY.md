---
phase: phase-18-discovery-capacity-placement
plan: 11
subsystem: networking
tags: [relay, reservations, net-05, named-refusal, criterion-4]

requires:
  - phase: phase-18-discovery-capacity-placement/18-01
    provides: "the `--peer-addr` precedent this flag is deliberately NOT — two mechanisms, two flags"
provides:
  - "`--relay-addr` on `bin/agent.ts` — the first production process ever to construct a `ReservationWatcher`"
  - "`FabricNode.relayFailures` and the non-fatal relay dial — an unreachable relay is a named condition, not an unhandled rejection"
  - "A dialable relay multiaddr on `bin/seed.ts`'s banner, so the criterion's own configuration is reachable without reading the source"
  - "`packages/node/src/reservation-exhaustion.node.test.ts` — three joiners, three different words, across real processes"
affects: []

tech-stack:
  added: []
  patterns:
    - "Subscribe before you wait: a listener registered after a settle-wait is dead code, because the wait cannot end until the event it waits on has already been recorded"
    - "One reporting path, not two — a redundant second path makes the first untestable and the mutation silently passes"
    - "A named failure that is not fatal: report it and keep serving, when the thing that failed is one of several ways to be reachable"

key-files:
  created:
    - packages/node/src/reservation-exhaustion.node.test.ts
    - .planning/phases/phase-18-discovery-capacity-placement/18-11-SUMMARY.md
  modified:
    - packages/node/src/bin/agent.ts
    - packages/node/src/bin/seed.ts
    - packages/node/src/fabric-node.ts

key-decisions:
  - "The relay dial is now NON-FATAL, which is a production change outside this plan's declared files_modified and was taken as an explicit owner decision. It runs inside `start`, before the node exists, so no caller could catch it and keep the node — and in `bin/agent.ts` it surfaced as an unhandled rejection."
  - "The agent WAITS for the relay question to be answered before announcing. A reservation is not held when `start` resolves, so reading `circuitAddrs` immediately reports `[]` for a node about to be granted one — a false statement rather than an early one. The wait ends on any of the three answers, not on success."
  - "`relays` goes on the handshake line; the refusals go to stderr. stdout's first line is machine-read, and every parent in this repository parses only up to its first newline."
  - "The watcher is built only when a relay was asked for. A watcher with nothing to watch reports nothing forever and its presence would suggest a measurement that is not happening."

requirements-completed: [NET-05]
duration: one session
completed: 2026-08-02
---

# Phase 18 · Plan 11 — A full relay says so, to a real joiner

**Closes criterion 4.** Three joiners, three different words.

| joiner | relay state | reports |
|---|---|---|
| A | one slot free | a granted `/p2p-circuit` |
| **B** | **full** | **`at-capacity: RESERVATION_REFUSED`** |
| C | unreachable address | `unreachable`, **and still starts** |

B and C are the pair that matters. Both end with no circuit address, and from the outside
those look identical — while demanding opposite responses: wait and retry this relay,
versus fix the address. **The distinction is measured rather than argued**: B's dial to the
seed succeeds in the same run that its reservation is refused, because the seed granted A
through that very address moments earlier.

## What existed, and what nothing reached

`relaying.node.test.ts` already proved the protocol reading in one process. What it could
not show is that **any process a person can run reaches it**. Before this plan
`ReservationWatcher` was constructed in exactly two places, both tests. `bin/agent.ts`
never built one, so a real agent that failed to reserve went silent in precisely the way
NET-05 exists to forbid — and `bin/seed.ts` printed no address an agent could be pointed
at, so the criterion's own configuration could not be reached without reading
`seed-server.ts`.

## Five false premises in the plan, found before writing code

1. **The comment Task 1 says to rewrite does not exist.** It claimed `bin/seed.ts` boots a
   Vite dev server and that this is why no test spawns it. That text was deleted earlier
   in this same session and replaced with the measured **590 ms**; a test already spawns
   the seed. The plan predates its own repository.
2. **A doc line the plan dictates verbatim is false.** It says to document that
   `--relay-addr` without `--port` leaves the node binding nothing, so `canRelay` is false.
   `bin/agent.ts` **always** passes `listen`, and `--port` defaults to `'0'`, so `canRelay`
   is always **true** for this binary. Writing that bullet would have shipped a false claim
   about the binary's own behaviour. What is documented instead is what is true: an agent
   given a relay address is a relay client **and** a relay server at once.
3. **Joiner C did neither thing the plan predicted.** Not a named refusal, not a quiet
   start — an **unhandled rejection**. See below.
4. Essentially every `file:line` citation in the plan is stale.
5. The plan's `ReservationWatcher` interface quote omits `nextCapacityRefusal`, which is
   the affordance the existing test actually uses.

## The production change, and why it was necessary

`FabricNode.start` dialled its relays with a bare `await` and no `try`. That loop runs
**before the node exists**, so no caller could catch the throw and keep the node; in
`bin/agent.ts`, where `start` is a top-level `await`, an unreachable relay produced a stack
trace and a nonzero exit with none of the named-refusal reporting every other flag in that
binary does.

NET-05's own wording is that a node which could not get into one relay can still work and
that killing it would be a worse answer. So the dial is non-fatal, the failure is recorded
on `FabricNode.relayFailures`, and the node starts. **This is outside the plan's declared
`files_modified` and was taken as an explicit owner decision rather than assumed.**

## A mutation that passed, and what it exposed

Silencing the watcher's `onFailure` callback **changed nothing** — the test still passed.

The cause was two reporting paths for one event: the subscription, and a replay loop over
`watcher.failures` taken afterwards. Because the agent now waits for the relay question to
settle before announcing, **the wait cannot end until the failure has already been
recorded**, so the replay always fired first and the subscription was dead code.

Fixed by having one path: subscribe **before** the wait, delete the replay. The same
mutation now times out waiting for B to be refused by name.

That subscription also outlives startup — libp2p keeps retrying a reservation for the life
of the node, so a relay that fills up later refuses this node then, and the same line
reports it. **That later case is measured by nothing**, and this file says so rather than
implying the startup case covers it.

## Proof

| Mutation | Result |
|---|---|
| the only refusal-reporting path is silenced | ❌ `timed out waiting for b to be refused by name` |
| the relay dial is fatal again | ❌ `agent c exited early with 1` — the unhandled rejection, reproduced |

Both files restored and `cmp`-verified byte-identical.

## What this does not close

- **A refusal arriving after startup.** The reporting path handles it; no test drives it.
- **The browser tier.** `BrowserNode` is the tier that genuinely cannot listen and depends
  on relays, and it now inherits the non-fatal dial. Nothing here measures it there.
