# Security audit — scope and trust boundaries, 2026-09-15

Owner's framing: *"мы не имеем права на ошибку в системе безопасности"*. So this audit asks
whether the system holds, not whether the last diff broke it. Two independent lines run against
the same tree and are reconciled at the end:

| line | what it is | why both |
|---|---|---|
| A | `claude-security` plugin, whole-repository scan | Fresh eyes, no knowledge of this tree's claims. Every finding independently verified by agents told to disprove it |
| B | This audit, by trust boundary | The plugin looks for vulnerability *patterns*. It cannot check an invariant this project holds by **not doing** something — sovereignty, the egress manifest, a gate that must fail closed |

A finding that only one line sees is the interesting one. Agreement is confirmation; disagreement
is a discriminating question to be answered by measurement.

## The surface, measured rather than assumed

~78 000 lines of production TypeScript: core 18 081, node 23 680, browser 15 176, net 9 408,
cloudflare 6 982, libp2p 5 278.

## The trust boundaries, in the order an attacker meets them

1. **Four HTTP routes, open to the internet** — `POST/GET /funnel`, `POST /turn-credential`,
   `POST /admission`, `GET /self` (`packages/cloudflare/src/worker.ts:1019-1054`). One of them
   writes: `/admission`, the kill switch.
2. **The admission gate** — who may hold a relay reservation. Certificate-pinned.
3. **P2P protocol surface** — what a connected peer may ask this node to do.
4. **Untrusted code execution** — a WASM artifact from somebody else, run on your device.
5. **Sovereignty** — owner-pinned data must not leave the owner's node. The egress manifest is
   the claim's carrier, not a quorum.
6. **Secrets and keys at rest** — seeds, provider keys, operator keys.
7. **Supply chain** — what the published client pulls, and what a node trusts a publisher for.

## Findings so far — line B, and they are recorded as the audit runs rather than at the end

### B-1 — the admission key comparison leaks its length. OPEN, severity LOW.

`keysMatch` (`packages/cloudflare/src/admission-flag.ts:136-143`) is constant-time **over the
content** — XOR-accumulate, no early exit inside the loop — but returns immediately when the
lengths differ (`:137`). So a caller learns the configured key's length by timing, one comparison
per guess.

Stated honestly: this is the weakest kind of oracle. The key is operator-chosen and high-entropy;
knowing its length does not shorten a search meaningfully, and the route is not rate-limited by us
but sits behind Cloudflare. It is recorded because it is a real asymmetry and because the fix is
two lines, not because it is a way in.

### B-2 — `relayAdmissionGate`'s unknown-posture branch: CORRECT, and the check cost a reading.

`fabric-node.ts:1057-1066` returns `true` from a branch whose own comment says "admits nobody",
while every other arm goes through `decide()`, which **inverts**. Read as a bug at first glance.

It is not. The predicate is libp2p's `denyInboundRelayReservation`, where `true` means *deny* —
confirmed from the library's own call site, not from its type:
`node_modules/@libp2p/circuit-relay-v2/dist/src/server/index.js:123` reads
`if ((await …denyInboundRelayReservation?.(…)) === true)`. The branch is fail-closed as its
comment claims.

**Recorded as a finding about readability, not correctness**: two arms of one function use
opposite conventions for the same boolean, and the reader has to leave the file to tell which is
which. `decide()` exists precisely so neither arm is a fall-through; this branch bypasses it.

### B-3 — secrets hygiene. CLEAN.

`.secrets/` is gitignored (`.gitignore:123`) and **nothing under it has ever been committed** —
`git log --all -- .secrets` is empty, which is the check that matters, since ignoring a path
after a commit protects nothing. No hard-coded credential pattern in production source.

### B-4 — boundary 1, the four public HTTP routes. SOUND, with one asymmetry noted.

Checked by following each route to what it can change, not by reading its docblock.

| route | who may call it | what bounds it |
|---|---|---|
| `GET /self` | anyone, `Origin: *` | read-only; body is public by design |
| `POST /turn-credential` | anyone, `Origin: *` | **authenticated**: certificate from a pinned issuer, freshness window, nodeKey binding, and an Ed25519 possession signature over the exact request (`turn-credential.ts:525-563`). `Origin: *` is harmless here because the credential is a signature, not a cookie — a hostile page cannot forge one |
| `POST /admission` | operator key only | constant-time-ish compare (see B-1), **no CORS header at all**, deliberately |
| `POST /funnel` | **anyone, unauthenticated** | see below |

`POST /funnel` is the only unauthenticated write into the object's storage, so it was followed to
the end. It does **not** grow without bound, and the reason is structural rather than a limit
somebody remembered to set:

- Body capped at `MAX_FUNNEL_BODY_BYTES` before the parse.
- The record's **cell space is closed**. `FUNNEL_CELL_BOUNDS` (`funnel-schema.ts:370-414`) sums
  every map: stages, hour buckets, and `COUNTRY_CODES * FUNNEL_NETWORK_CLASSES.length` — 13 676
  cells, ceiling **476 224 B** against a measured 4 194 304 B storage wall. A flood of reports
  moves counters; it cannot add cells.
- `networkClass` is a closed five-member list (`:124`). `country` is **not** a list but a
  pattern, `/^[A-Z]{2}$/` (`:158`) — and the ceiling accounts for that correctly, taking all
  `26 × 26 = 676` codes rather than a list of real ones. That is the right conservative choice,
  and it is why a visitor choosing an arbitrary `CF-IPCountry` header cannot enlarge the record.
- A visitor CAN choose which of the 676 buckets their visit is filed under, by sending the
  header themselves. That is a **data-quality** exposure, not a storage one, and it is worth
  stating because `BENCH-08` publishes a failure rate segmented by country. Noted for the
  report's methodology rather than as a vulnerability.

The ordering inside `#bankFunnel` (accrue-and-bank as one chained link) was written to fix a
real poisoning defect its own comment records; the fix is in the code, not only in the comment.

### B-5 — where a browser tab's trust comes from. SOUND, with the model's own limit stated.

The question worth asking of any client that fetches its configuration: can whoever serves the
page decide who the page trusts?

- **`operatorId` — no, by construction.** Derived from the visitor's own key
  (`visitor-key.ts:298`), not read from `/bootstrap.json`. Its docblock states the reason and the
  code matches it: *"taking `operatorId` from `/bootstrap.json` would let whatever served the
  page decide how a visitor's node counts toward diversity"*. There is no parameter to abuse.
- **`trustedIssuers` — no.** `demo/main.ts:1586` passes `new Set([held.issuer])`: the issuer of
  the certificate **this tab already holds**, which is the only key in play that was not handed
  over by the peer being checked.
- **`trustAnchors` — a compiled-in constant.** `DEMO_ANCHORS` is `[KERNEL_TRUST_ANCHOR]`
  (`demo/main.ts:404`), not fetched.

What `/bootstrap.json` does supply is `relayAddrs` and `enrollmentProvider` — **where to knock**,
not **whom to believe**. That is the right split.

**The limit, stated rather than glossed:** the visitor's certificate comes from the enrolment
provider that the origin named, so a hostile origin could point a first-time visitor at a
provider it controls. That is trust-on-first-use, and it is inherent to a page a visitor found
rather than configured. It is not a defect in this code; it is the reason the release is a
disclosure gate and the reason the enrolment offer is a consent question rather than automatic.

### B-6 — the issuance throttle fails CLOSED. SOUND.

`hosted-enrolment.ts:172`: an authority that read its issuance history and found none loaded
**refuses to sign** — *"the throttle would have counted nothing, so it refuses instead"*. The
failure mode that matters (history unreadable ⇒ unlimited issuance) is the one that is closed.
`O2_MAX_ISSUED_PER_WINDOW` absent ⇒ signs nothing at all, so a forgotten variable cannot produce
*issuing-and-unbounded*.

---

# Line B — agent findings, independently re-verified by the orchestrator

Each finding below was re-checked against the code before it was written down. Where my check
CHANGED the agent's reading, that is stated — an agent's claim is a hypothesis until it carries
its own evidence.

## CONFIRMED — the egress manifest claims a signature it does not have

`packages/net/src/egress.ts:42` — the docblock of `EgressManifest` reads, verbatim:

> *"What left one node during a job. **Signed by the owner to make it attributable.**"*

**There is no signature.** Re-verified two ways rather than taken on report:
- The interface has five fields — `nodeId`, `ownerId`, `entries`, `totalBytes`, `violations`.
  No signature field exists to hold one.
- `grep` for any manifest-signing symbol across production source returns nothing; the only
  hits are three `mutation-ledger.ts` entries using "signature" in its other sense (a mutation's
  fingerprint).
- **No wire kind carries a manifest.** `protocol.ts` has no `egress`/`manifest` member, so a
  manifest never crosses a connection at all.

**Why this matters more than a stale comment.** This project's core claim splits integrity two
ways, and for sovereign data the sovereignty half is carried *by the manifest*, not by a quorum
— `CLAUDE.md` says so in the table that opens it. A manifest that is unsigned, and that reaches
nobody but the party who produced it, cannot attribute anything to anyone. It is a self-report.

That may still be the right design — a local detector is worth having — but the **comment states
a property the code does not have**, and this repository's own rule is that when a comment and a
requirement disagree, the requirement wins and the comment gets fixed. Severity: **HIGH as a
correctness-of-claim defect**, because a reader (including a future phase, including an
investor-facing document) can read that line and believe the guarantee is cryptographic.

**Two ways to close it, and they are different products:**
1. Fix the comment — say plainly it is a local, unsigned self-report. Cheap, honest, loses
   nothing that exists today.
2. Build what the comment claims — sign the manifest under the node key, add a response kind
   that returns it, and have the aggregator verify it. That is the version in which "the
   aggregation over contributions is verified" means something to a third party.

**This is an owner decision, not an agent one**, because option 2 changes what the project
promises and option 1 changes what it says it promises.

## CONFIRMED, AND THE CODE ALREADY SAYS IT — combine's transfer surface

`runCombine`'s own header (`packages/net/src/agent.ts:736-780`) states the finding an agent
reported as new, in more precise terms than the agent used:

> *"Admission bounds concurrency, not arrival rate: a peer that sends combines one at a time,
> waiting for each, meets no refusal at all… `MAX_PARTIAL_BYTES` bounds what this node will
> **merge**, never what a peer can make it transfer or keep."*

So the transfer half is a **known, documented, accepted** disposition, not a discovery.

**What is NOT in that paragraph, and is the part worth acting on: the bytes are written to
DISK and stay there.** Verified:
- `packages/net/src/block.ts:119` — `await this.#local.put(bytes)`, unconditional once the hash
  matches.
- `packages/node/src/fabric-node.ts:2009-2013` — `#local` is an `FsBlockstore` whenever
  `blockstoreDir` is set, i.e. on every durable node.
- No quota, no eviction, no size ceiling on that store — `grep` for quota/evict/prune/maxBytes
  over the blockstore sources returns nothing.

The header says "transfer **or keep**" in one clause and then discusses only transfer. Residency
is the half with no bound at all. Severity: **HIGH**, and unlike the manifest finding this one is
an availability defect a stranger can drive.

## CRITICAL — the `exec` branch never consults the sovereign set, so a stranger can compute over pinned data

**This is the finding that matters, and it contradicts the project's headline claim directly.**
`CLAUDE.md`'s opening sentence: data must *"demonstrably never move the underlying data off the
owner's node"*.

### The chain, verified link by link by the orchestrator rather than taken on report

1. **`sovereignCids` is consulted in exactly one place.** `grep -n "sovereignCids"
   packages/net/src/agent.ts` returns **two lines, both inside the `block` branch**
   (`:1173-1175`). Nothing else in that file reads the set.
2. **Every gate the `exec` path passes branches on a label the DISPATCHER supplies:**
   - `capability-authorizer.ts:109` — `if (task.label !== 'sovereign') return null`. No chain is
     ever demanded of a public task.
   - `sovereign-egress.ts:76` — `if (task.label !== 'sovereign') return null`. No egress tap is
     registered, so nothing watches what leaves.
   - `sovereignty-guard.ts:93` — `if (task.label === 'sovereign')` is false, so the guard is a
     pass-through.
3. **The executor then reads the CID unconditionally.** `core/src/executor/wasm.ts:88` —
   `const inputBytes = await this.#blockstore.get(task.inputCid)`, with no consultation of
   anything sovereign.
4. **The set holds exactly the CIDs at risk.** `submit.ts:2745` adds a shard's CID to
   `sovereignCids` precisely when `label === 'sovereign'` — the same CIDs step 3 reads unchecked.

### The attack

Dispatch `exec` with `label: 'public'`, `inputCid` = the victim's sovereign CID, `moduleCid` =
any module signed by a pinned anchor. The node refuses to **hand over** that block — the `block`
branch checks — and will happily **compute over it and return the answer**. The attacker also
chooses `partitionIndex`/`partitionCount`, so the output can be steered to reveal the input a
slice at a time. The CID is a hash, not a secret; it is learned out of band.

### The tree already performs this attack in a test, and asserts that it SUCCEEDS

`packages/net/src/sovereign-execution.test.ts:672` — *"is not released by an unrelated public
exec naming the same input"*. The case puts the real sovereign bytes in the serving node's
blockstore (`:616`), registers the CID in `sovereignInputs` (`:620`), dispatches
`label: 'public'` over the same `inputCid` (`:679-686`) and asserts
**`expect(publicReply?.kind).toBe('exec')`** — that it went through. It then checks only that the
*hold* was not released.

So the case is about hold bookkeeping and reads, at a glance, like coverage of this surface. It
is the opposite: it is a committed demonstration that the public dispatch is admitted. That is
why the gap survived — the instrument was pointed one degree away from the defect.

### Severity: CRITICAL

Not because it is easy — it needs a signed module and a CID learned out of band — but because
the property it breaks is the one the whole project is for, and because **no `.planning` note,
docblock or ledger row records it as a known residual**, unlike this repository's consistent
habit of naming its own gaps.

### The fix is one line, mirroring the branch that already does it right

The `exec` branch should consult `sovereignCids` exactly as the `block` branch does, and refuse
by name. **The label must not be the gate**: a label chosen by the sender is a request, not a
fact, and every gate above trusts it as if it were a fact.

---

# Filed, 2026-09-15

Every finding is a public GitHub issue. **Public on purpose** — owner's ruling: a visible security
track is itself the assurance, and these get fixed anyway.

Index: **#29**. Findings: #15 (CRITICAL), #16 #17 #18 #19 #20 #25 (HIGH), #21 #22 #23 #24 #27
(MEDIUM), #26 (LOW), #28 (accepted residuals).

Every issue was re-verified against the code by the orchestrator before filing; an agent's claim
was a hypothesis until it carried its own `file:line`. Where the re-check changed an agent's
reading, the issue says so — #24 carries a correction to this repository's own `CLAUDE.md` claim
about provider-record expiry, which was checked and found no longer true of this tree.

---

# The design decisions that followed the audit — 2026-09-15

The audit produced defects. The discussion after it produced two decisions, filed as #30 and #31.
Both came from the owner, and **two of my own readings were wrong on the way there** — recorded,
because the corrections are the useful part.

## What I got wrong, twice

**First:** I read "sign the requests" as *the executing node signs the frame*, and argued a signature
only says who is asking. The owner meant something else and stronger: **a request signed under the
data owner's or the application's certificate IS the grant**. It does not need checking against an
external list, because the scope is inside the signature and cannot be forged. My objection —
"an attacker signs with their own key" — does not touch it: their key is not the owner's, so the
chain does not root.

**Second:** I treated the authority model as something to be built. It is already built.
`verifyChain` roots at the owner's key, checks the requested ability **at every link**, and permits
re-delegation only where the previous link granted `delegate`. The owner's "child scope with
different rights" is literally a second link with fewer abilities.

So #15's real shape is narrower and worse than "a missing check": **the mechanism is correct and
the path does not enter it.** `capability-authorizer.ts:109` returns before asking.

## What is genuinely absent

`signer` of a module's `NameRecord` and `ownerId` of the data are **never compared anywhere** —
measured, no hits in production source. Authorization asks *may this node execute*, never *may
this code touch it*. That is #31, and it is the owner's security-circle idea with no counterpart
in the tree.

## Two locks, and the reason the second one is even possible

| lock | question | issue |
|---|---|---|
| input | may this code, asked for by this party, touch this data | #31 + #30 |
| output | what may it emit once admitted | #20 |

The output lock is enforceable rather than heuristic **because the guest's import surface is
narrow**: the only channel out is `output_write`, and it passes through the host, which sees every
byte. That is also why a declared-permissions model works better as *what will be emitted* than as
*what will be called* — the second is already minimal and has nothing left to remove.

---

## The fix for #15 carried a second defect, and it was mine

Recorded here because the audit's own rule is that a proof which cannot fail is not a proof,
and the same rule applies to a fix.

The gate that closes #15 returns early. On that branch an early return is not free: the
admission table is claimed **above** it (`capacity.offer`) and released in a `finally`
**below** it, around the executor. Sited between the two — which is where it was first
written, and where it passed ten green cases — every refusal consumed a slot and never gave
it back. `agent.ts` states the consequence itself, on the very block that hands the slot out:
a node *"indistinguishable from a working node for exactly `slots` tasks and then refuses
everything forever"*.

So the fix for a disclosure defect installed a denial-of-service one, reachable by the same
stranger, with the same frame, needing nothing but the CID.

**Why no existing case could see it.** Every case in `sovereign-execution.test.ts` served with
`capacity: 'accepts-every-offer'` — a table that accepts everything has nothing to leak. The
instrument was one argument away from the defect, which is the identical shape to how #15
itself survived: `sovereign-execution.test.ts` performed the attacking dispatch and asserted
it went through.

**What found it.** Not a test — a review of the fix before it merged, asking where the early
return sat relative to the resources the branch claims. The case that proves it was written
afterwards and watched red (`expected 1 to be +0`).

The gate now sits above admission and above `pending.reserve`, so it claims nothing and can
leak nothing.

## Two remainders, filed rather than folded in

- **#32 — the `combine` branch reads any CID the sender names.** Same class, one door along.
  `combineAdmitted` does `options.blockstore.get(cid)` for every CID on the frame and never
  consults `sovereignCids`, and that blockstore IS the sovereign tier (`fabric-node.ts:2691`
  passes `store` as `sovereignInputs`, `:2756` wraps the same `store` as the agent's
  blockstore). Weaker than #15 — the bytes do not come back, only the reduced value, and
  `MAX_PARTIAL_BYTES` / `decodeCanonical` / `asFabricPartial` all stand in the way. How much
  survives the reduction is **not measured**, and nobody should close it on the reduction
  until it is.
- **#33 — a node with no durable sovereign set is still exposed.** The gate can only refuse on
  a positive reading. `fabric-node.ts:2687-2690` leaves `sovereignCids` at
  `'forgets-sovereignty-between-jobs'` whenever no blockstore directory was given, so an
  in-memory Node tier answers exactly as it did before. The browser tier always opens
  `IdbSovereignCids`, so it is not affected. Closing this means ruling on what the fabric does
  under partial knowledge, which belongs beside #30/#31.
