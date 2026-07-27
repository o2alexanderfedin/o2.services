---
status: human_needed
phase: 9
verified: 2026-07-26
criteria_met: 4
criteria_total: 5
---

# Phase 9 — Verification

Goal-backward: does the codebase deliver what the phase promised, criterion by
criterion, checked against a test rather than against an intention.

## 1. A static client distributes a real job across multiple browser tabs on multiple machines, showing live placement and results arriving

**PARTIAL — tabs yes, machines unrun.**

`packages/node/src/colouring-demo.e2e.test.ts` opens two isolated
`BrowserContext`s, dials one from the other over a direct WebRTC connection, and
runs eight cubes at redundancy 2. Every cube reaches agreement, the
verification multiplier is exactly 2, and each cube names the two nodes that
agreed on it — placement shown, not merely happening. The second tab's
`tasksExecuted` is asserted non-zero, so a job that quietly ran twice in one tab
would fail. `built-bundle.e2e.test.ts` proves the same client works as static
files on a server that 404s everything it does not have.

**What is missing:** two *machines* running this job. Phase 3 established the
transport across machines (an iPhone and a laptop completing a 4-shard
2×-redundant job over direct WebRTC), and nothing about this job depends on the
transport — but it was not run, and this project does not close that gap by
reasoning. Needs a second device and a human to open a page on it.

## 2. The demo runs a task a person cares about the answer to, and a visitor can check that the answer is right

**MET.**

The job is a 2-colouring of {1…N} with no monochromatic Pythagorean triple —
the problem whose n = 7825 impossibility was established in 2016 by a 200 TB
proof. `verifyColouring(n, bits)` takes the claim and nothing else: it calls
`enumerateTriples(n)` itself and knows nothing about the ordering, degrees, or
index the guest was handed. `colouring.test.ts` plants a violation by flipping
one bit and requires refutation, naming the triple.

The e2e presses the check **with the node stopped and every peer gone**, and it
still passes — the property that distinguishes a check from a second opinion.
The verdict is asserted to appear in the page's own DOM, because a check nobody
can see is not a check as far as the criterion is concerned.

## 3. No CPU before explicit informed consent; a persistent, always-visible surface shows what is running and for whom; one click provably drops CPU to zero

**MET, on all three clauses.**

*No CPU, and no network.* `built-bundle.e2e.test.ts` watches every request the
tab makes and requires no `/bootstrap.json` and no WebSocket before consent. The
API refuses too: `discoverRelays()` rejects with `no consent`, and `activity()`
is null. Mutation-proved at both layers — removing the API gate fails one test,
removing the page gate fails six.

*Persistent and always visible.* A fixed bar with no control that hides it,
rendered whenever a node exists rather than when a particular button was pressed.
It names the peers whose work is running (`servedFor`), the live duty cycle, the
task count, and whether execution is off the main thread.

*One click to zero.* `Worker.terminate()` plus `node.stop()`.
`worker-executor.browser.test.ts` runs a bare `loop br 0` — a guest no flag,
duty cycle or governor can reach — and requires termination to end it. A separate
test messages the thread directly, past the executor, and requires silence;
replacing `terminate()` with a cooperative flag fails that test and only that one.

## 4. The client reports the percentage of visitors where the node failed to start, segmented by browser

**MET.**

`startReport` produces a per-browser failure rate with an enumerated cause, and
`StartReport.blindSpots` is a field rather than a caveat: a node that could not
reach a peer could not report that it could not reach a peer, and
`describeStartReport` renders that sentence in the same string as the numbers.
`start-report.test.ts` asserts the unreachable case is distinguishable from a
peer that answered with nothing, and that asking eight peers does not multiply
the sample size by eight.

Browser labels are a family plus a major version from a fixed set, checked
against hardcoded real user-agent strings — including the two that would silently
mis-file whole populations (Edge contains `Chrome/`, Chrome contains `Safari/`).

## 5. Builds and runs against static hosting with no server-side process, and the repository contains no deploy workflow file at all

**MET.**

`built-bundle.e2e.test.ts` serves the built `dist/` from a deliberately dumb
`node:http` file server that 404s everything missing, and the page loads with zero
page errors, reports the absent relay honestly, and joins when given one via
`?relay=`.

`disclosure-gate.node.test.ts` asserts `.github/workflows` does not exist, that no
workflow file exists at any path (by content, so relocation does not evade it), and
that no `package.json` script publishes anything. `build:demo` builds; nothing
deploys. Mutation-proved by planting a workflow file in two locations and two
publishing scripts.

`vocabulary.node.test.ts` enforces the vocabulary rule repository-wide with
expressible, reasoned exemptions, and is mutation-proved with one planted case per
banned term plus a case proving an exempt phrase does not shelter the rest of its
line.

## Human verification needed

1. **Open the demo on a second device** (a phone on the same LAN via
   `node packages/node/src/bin/seed.ts`, which prints a `.local` URL and a QR
   code) and run the search from one of them. This closes criterion 1 and needs
   no code change — Phase 3 proved the transport across machines already.
2. **Read the policy page** (`packages/browser/demo/policy.html`) as the owner,
   since it speaks for the project to a blocklist reviewer and names an appeal
   path that must actually be monitored.
3. **Read the disclosure text** (`packages/browser/src/disclosure.ts`) — it is
   what a visitor is asked to agree to, and its wording is the project's word.
