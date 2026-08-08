# o2.services — Pre-Cooked Workloads: Design Brief for a Demo UI Mockup

This describes the compute tasks that already exist and run on the o2 peer-to-peer
fabric, the exact inputs each takes, the exact outputs each returns, and the
cross-cutting fabric state a UI has to display alongside them. Everything here is read
out of the shipped source, not proposed.

---

## 0. The mental model the UI has to convey

A web page becomes a **compute node**. Visitors' tabs, laptops and servers are all the
same kind of node — there is deliberately no "client" tier. A job is:

1. **One input block**, content-addressed once. Every shard receives *the same bytes*.
2. **N shards**, distinguished only by an integer the guest reads through a host call
   named `partition()`. Splitting work therefore costs **zero bytes on the wire**.
3. **Redundancy R** — each shard is run by R independent nodes and their outputs must
   be byte-identical to count as agreed.
4. A **merge**: either first-found-wins (colouring) or a **verified tree-reduce**
   (prime counting, pi).

Every guest is WebAssembly with exactly four host imports — `input_len`, `input_read`,
`output_write`, `partition`. That import list *is* the sandbox: no clock, no random, no
filesystem, no network. All three shipped kernels are integer-only (no float
instruction appears in any of them), which is what makes two different machines
produce bit-identical results.

---

## 1. Workload A — Pythagorean-Triple 2-Colouring ("the search")

**This is the one the public demo page currently runs.** It is the flagship because
its answer is *checkable in milliseconds by anyone*, from the definition alone, while
finding it is expensive.

### The problem
Colour every whole number from 1 to N either red or blue so that no three numbers with
a² + b² = c² are all the same colour. N = 7824 admits a colouring; N = 7825 does not —
settled in 2016 by a SAT search whose proof ran to 200 terabytes.

### How it shards
The search is split into **cubes**. Each cube fixes the colours of the *most
constrained* numbers (those appearing in the most triples) and depth-first-searches the
rest. Ordering by constraint is load-bearing: under naive increasing order the same
search stalls at n = 205 and adding cubes buys nothing, because 1 and 2 appear in no
triple at all.

### Inputs (UI knobs)
| knob | type | notes |
|---|---|---|
| `n` | integer, 1 … **8192** (`MAX_N`) | above 8192 the guest returns an honest "unknown" rather than growing memory |
| `cubes` | integer | demo uses `8 × (1 + peerCount)` — more peers ⇒ more cubes ⇒ further reach |
| `redundancy` | integer | demo uses `min(2, 1 + peerCount)` |
| `budget` | 5,000,000 backtracks (fixed, travels *in* the input) | ~75 ms per shard; identical on every machine, so "unknown" is deterministic rather than a race against a clock |

Input block is ~165 KiB at MAX_N (triple table + assignment order + CSR index, all
precomputed host-side).

### Outputs (what the UI renders)
Per cube, one of **three statuses that must never be collapsed**:

| status | meaning | tone |
|---|---|---|
| `found` | a valid colouring, returned as a 1024-byte packed bitfield | success |
| `exhausted` | **proof** this cube contains no valid colouring | neutral/informative |
| `budget` | ran out of steps — *"I do not know"* | warning, NOT failure |

Conflating `budget` with `exhausted` would turn a shortage of compute into a false
mathematical claim. The UI must visibly distinguish them.

Run report fields: `n`, `cubes`, `complete` (every cube's replicas agreed), `found`,
`statuses[]`, `agreeing[][]` (which node ids agreed on each cube — placement made
visible), `verificationMultiplier` (gross fuel ÷ useful fuel), `elapsedMs`,
`attestation`, `egress`.

### The ladder (the demo's dramatic arc)
The page climbs `N = [300, 400, 500, 600]`, stopping at the first rung the fabric
cannot settle. Measured reach at the shipped budget:

```
  1 cube    → n = 300
  8 cubes   → n = 500
 64 cubes   → n = 500
256 cubes   → n = 600
1024 cubes  → n = 600
```

Reach grows **in steps, not smoothly**. That staircase is the demo's core claim —
capacity grows with participants — and a good mockup should make it visual rather than
leaving it as text in a `<pre>`.

### The independent check (a separate, deliberate act)
A second button: **"Check this answer myself."** It re-derives every Pythagorean
triple from a² + b² = c² *in the visitor's own tab*, needs no node, no peer and no
network, and works with the fabric disconnected. Returns `{ok, triplesChecked, n,
violation}` — where `violation` names the triple that refutes a bad claim. Checking
n = 7824 costs ~80 ms in a browser tab.

**Merge type:** first-found-wins linear scan. There is nothing to aggregate, so this
workload does *not* exercise the reduce tree.

---

## 2. Workload B — Prime Counting π(x)

A segmented sieve counting the primes ≤ N.

**Why it exists:** the colouring verifier shares an author with the fabric, so a
misconception held in both is invisible to the pair. π(x) was tabulated in the
mathematical literature long before this repository existed — it is an oracle nothing
here produced, and a wrong answer cannot talk it into agreeing.

### Inputs
| knob | type | notes |
|---|---|---|
| `n` | integer, 0 … 2,147,483,647 | the whole input block is **8 bytes**: a version u32 and n |
| `shards` | integer | domain split into contiguous sub-ranges |
| `redundancy` | integer | |

### Outputs
Per shard: a status byte plus an 8-byte unsigned count. Summed across shards under the
single key `"primes"`. A refusal is thrown, never returned as zero — a refusal summed
into an aggregate is indistinguishable from a sub-range that genuinely held no primes.

### Known-good values to display against
`π(10^4) = 1229`, `π(10^5) = 9592`, `π(10^6) = 78498`, `π(10^7) = 664579`,
`π(3×10^8) = 16252325`.

### Measured throughput
~260 million numbers sieved per second, flat across three orders of magnitude.

**Stated weakness worth surfacing in the UI:** the oracle is *blind in one direction*.
Published π values are quoted at powers of ten, and a power of ten sits far from the
prime below it (999983, 99991, 9973) — so a guest that loses the top of its range
returns the right total anyway. That hole is what Workload C closes.

---

## 3. Workload C — π by the Madhava-Leibniz Series

Sums the alternating series for π/4 in fixed-point integers. **This is the only
workload that exercises the fabric's verified tree-reduce**, and the only one with a
real aggregation to show off.

### Inputs
| knob | type | notes |
|---|---|---|
| `terms` | integer, 0 … 2,147,483,647 | again an **8-byte** input block |
| `shards` | integer | contiguous term ranges |
| `redundancy` | integer | |

### Outputs
Per shard: a **signed** 64-bit fixed-point partial at scale 10⁻¹⁵ of π/4. Signed
because a shard whose range starts on an odd index sums negative — the sign is a fact
about where the range began, not an error. Summed under the single key `"pi"`;
`estimate = 4 × total / 10^15`.

### Why it complements primes
Every term is non-zero. A lost index moves the total by ~5×10⁸ units immediately,
where a lost prime-range often changes nothing. Both defenses were *measured*, not
argued: the same planted deletion was caught here at the first shard count tried.

### The reduce, and what the UI must show
`runPi` reports **four separate booleans/values that must not be collapsed**:

| field | question it answers |
|---|---|
| `complete` | did every shard's replicas agree? (the MAP half) |
| `reduceAttempted` | could a reduce be started at all? |
| `reduceReason` | if not, the fabric's own words — e.g. `"no executor to combine on"` |
| `combined` | did combines actually produce an aggregate? |
| `treeDepth`, `combines` | the shape and cost of the reduce tree |
| `estimate` | π, **fetched back out of the store**, never recomputed locally |
| `errorBound` | `4/(2N+1)` — the rigorous alternating-series remainder bound |

**A lone tab cannot run the reduce.** The submitter is excluded from the combine
executor set by contract, so the first visitor on the page gets
`reduceAttempted: false` with that reason. This is the *ordinary* state, not a failure
— the UI must say "this claim needs a second device", not show a broken panel. That is
a genuinely good design moment: it gives the visitor a reason to open a second tab or
hand a link to someone.

### Measured throughput
~1.5 billion terms/second — 5.8× faster per unit than the sieve. Scaled total at
1.5×10⁹ terms is `785398163231095`, **bit-identical at 1, 2, 4 and 8 processes**.

---

## 4. Workload D — "Bring your own" (exists, currently unwired in the page)

Two escape hatches worth a slot in the mockup even if greyed out:

- **`runJob`** — dispatch *any* WASM module by CID, provided you also hand over a
  signed `NameRecord` for it (signer, signature, version, expiry). The record is
  **required**, not optional: a tab always pins a trust anchor, so a dispatch with no
  record is one that will be refused by every executor it reaches. Supports a
  `sovereign: {ownerId}` flag that marks the shard as owner-pinned data.
- **AOT lift pipeline** (`tools/aot`) — take a statically-linked AArch64 ELF binary,
  lift it to WebAssembly, scan it for non-determinism (relaxed SIMD, shared memory,
  float NaN sources), and publish + sign the artifact. Exit codes are three-valued:
  `0` clean, `2` translated **with reservations** (e.g. "174 addresses will abort if
  reached"), `1` failed.

There is also a `trivial` benchmark fixture that just writes its own partition index —
internal, not worth a UI.

---

## 5. Cross-cutting state every screen has to carry

These are not decoration; each one is a shipped requirement with a source of truth.

### 5.1 The consent gate (first thing rendered)
Nothing runs and **nothing is contacted** — not even reading the relay bootstrap file —
until the visitor allows it. Renders: a headline, a definition list of disclosed terms,
a separate opt-in checkbox for start-outcome reporting, Allow / Decline, and the
disclosure version string. Declining to report is *not* declining to see: an opted-out
visitor still asks every peer and still merges every answer.

### 5.2 The always-visible activity bar
Rendered whenever a node exists, **never dismissible while it does**. Carries:
`running`, `tasksExecuted`, `dutyCycle`, `hidden`, `peers`, `fetched`, `rejected`, and
`servedFor[]` — *whose* work this node has run, as `{peerId, tasks}` most-first. A peer
count alone answers only half the question. Plus a Stop button.

### 5.3 Peers — three different counts, and they disagree on purpose
| reading | what it is |
|---|---|
| `peers()` | every libp2p connection — **always includes the relay**, which signals and does not compute |
| `computePeers()` | peers that answered an offer and will actually execute a task |
| `heldPeers()` | each peer plus `carriesWork` — false when the only connection is a relayed circuit |

A relayed circuit is capped at **2 minutes / 128 KiB** and may not carry a job. Two
tabs can end up mutually connected and unusable; discovery rounds report
`relayedOnly[]` and `stalled[]` for exactly that. The honest sentence a UI must be able
to render: *"this pair is connected, cannot run your job, and I have stopped trying."*

### 5.4 Attestation strength — a label, never a footnote
Three values of one union, plus a named absence:

| value | meaning |
|---|---|
| `independent` | replicas from ≥2 distinct operators agreed — the strong claim |
| `owner-domain` | ≥2 of *one owner's* nodes agreed — independent of hardware, not of the owner |
| `owner-attested` | one node ran it; the owner's word, unverified |
| *(absence)* | carries `agreeing` vs `verified` counts and a reason — `0 of 2` and `1 of 2` are different situations |

**The UI must render the kernel's own `description` string verbatim and compose no
sentence of its own.** The CLI prints the same field, so the two surfaces cannot come
to describe one result differently.

### 5.5 The egress manifest — the sovereignty claim's only visible surface
Per run: number of frames sent, total bytes, and any **withheld** frames. When a run
registered no sovereign data the panel says so *in those words* — "0 withheld, and this
run registered no sovereign data, so that is the guard reporting it had nothing to hold
back, not a proof of sovereignty." Printing a bare "0 refused" would read as a
sovereignty proof and would be a lie by omission.

### 5.6 Other live readings
- **Duty cycle** — a `(0, 1]` user CPU cap, settable while running; composes with the
  visibility governor by taking the lower of the two. Governor state exposes `hidden`,
  `dutyCycle`, `transitions`, `sleptMs`.
- **Verification multiplier** — gross fuel ÷ useful fuel, correct at any redundancy.
- **Isolation** — `crossOriginIsolated`, `hasSharedArrayBuffer`, `inIframe`. All false
  on the supported static-host deployment.
- **Start-outcome ledger** — "how often does this fail to start?" A browser that blocks
  the page doesn't announce it; it just looks like fewer volunteers. Shows
  `reached / asked` and per-browser-family tallies merged across peers.
- **Blocks** — stored, fetched over the wire, and **rejected for a CID mismatch**.

---

## 6. Measured numbers available for a "results" surface

Real, from a recorded run (8 physical cores, one machine):

**Fabric overhead** — total ÷ same-moment local execution:
`1.06×–1.16×` at redundancy 1; `~2.0×` at redundancy 2 (doubling the work doubles the
cost — the sanity check that the measurement is real).

**Decomposition cost** — splitting a domain N ways and summing each shard's guest time,
ratio to a single shard: `0.97–1.03`. **Splitting is free.**

**Real parallel speedup** (separate OS processes, one per shard):
| processes | speedup | efficiency |
|---|---|---|
| 1 | 1.00× | 100% |
| 2 | 1.94× | 97% |
| 4 | 3.38–3.74× | 85–93% |
| 8 | 3.64–3.88× | 46–49% |

Near-linear to four, then a wall at ~3.6–3.9× — oversubscription on an 8-core host,
visible as total CPU time rising ~70%. Results bit-identical at every process count.

**Cold instantiate:** 0.05–0.06 ms p50. Module sizes: 549 bytes (pi), 1187 bytes
(primes).

---

## 7. Tone notes for the mockup

The whole project's voice is *"state what can be proved and refuse the stronger
reading."* Three recurring shapes the design should support rather than fight:

1. **Three-valued answers, not booleans.** found / exhausted / budget. attempted /
   combined. independent / owner-domain / owner-attested. Nowhere is there a green tick
   and a red cross.
2. **Named absences.** "This needs a second device", "this run registered no sovereign
   data", "I stopped trying to upgrade this pair". Empty states carry sentences, not
   blanks.
3. **Nothing has to be believed.** The verify button, the published-oracle comparison,
   the placement list, the egress manifest — the design's job is to make "check it
   yourself" the most prominent action on the page, not a footnote under the result.
