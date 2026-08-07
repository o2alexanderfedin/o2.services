# o2.services vs the WASM cloud and its neighbours

## An apples-to-apples technical comparison, assuming o2 is complete

**Subject:** o2.services as specified when finished — all roadmap phases executed, Helia/IPFS integrated,
RFC-0003 certificates implemented, decentralized DB and blob storage shipped, deployed.
**Compared against:** the WASM application-platform category, commercial edge/isolate clouds,
decentralized compute markets, volunteer computing, and confidential computing.
**Research date:** 2026-08-06/07. Eight parallel research streams, primary sources, tier-tagged.
**Companion to:** `docs/business/o2-vs-aws-study.md`, which costs the *business* case. This one
compares the *technology* against its technical peers.

---

## 1. Verdict — how to weigh yourself

**You are not competing with wasmCloud, and a comparison page that fights them on ergonomics loses.**
The WASM-cloud category solved *deployable server-side Wasm*: polyglot toolchains, the Component Model
and WIT, sub-millisecond cold starts, kubectl/Helm/ArgoCD ergonomics, OCI distribution, Sigstore
signing, production references at Adobe, BMW, Orange, Akamai. That work is mature, and most of it is
*shared infrastructure you can adopt for free*.

What that category does not have — verified across every project examined, through their own docs —
is any answer to an executor that lies. wasmCloud's CNCF TAG-Security self-assessment places hosts,
capability providers and NATS **inside** the trust boundary; a byzantine host is not in the threat
model. The same is true of Spin, Wasmer Edge, Golem Cloud, Extism, and all eight commercial edge
platforms. Their sandbox protects **the host from the guest**. Yours protects **the requester from
the host**. Those are inverse problems.

So the weighing is: *you win where the customer cannot trust the operator, and where the data cannot
move. You lose everywhere else, and you should not pretend otherwise.*

**Three structural facts make the position more defensible than it looks:**

1. **The category retreated from your ground during 2025–26.** wasmCloud v2.0 (2026-03-23) removed
   capability providers, eliminated `wadm`, and demoted the NATS lattice from default to opt-in in
   favour of a Kubernetes operator. The lattice — *"a self-forming, self-healing mesh network… across
   any number of environments, clouds, browsers, or even hardware"* — was the only architecture in the
   category reasoning about crossing infrastructure boundaries. Meanwhile Vercel deprecated Edge
   Functions for containerized Node on Lambda, **Deno Deploy Classic shut down 2026-07-20** (replaced
   by microVMs in *two* regions), Akamai acquired Fermyon (2025-12-01), and Cloudflare added
   Containers. The "isolates everywhere at the edge" thesis collapsed; work went back to Lambda-class
   units in ~36 regions.

2. **The P2P database category vacated entirely.** Nothing to adopt — and nobody to compete with.

3. **Every peer that shipped redundant verification eventually turned it off.** That is either your
   differentiator or your warning, and §6 argues it is the former only if you adopt BOINC's fix.

---

## 2. The comparison matrix

Same axes for every column. "—" means the concept does not exist in that system.

| | **o2 (complete)** | **wasmCloud v2** | **Cloudflare Workers** | **Internet Computer** | **Bacalhau / Fluence** | **BOINC** | **Apple PCC** |
|---|---|---|---|---|---|---|---|
| **Unit of execution** | WASM (WASI p1) + AOT-lifted native | Component + WIT | V8 isolate / JS | WASM canister | Docker + WASM | native binary / VirtualBox VM | proprietary |
| **Runtime** | V8 (browser) / V8 (Node) | Wasmtime (native crate) | workerd | Wasmtime | host runtimes | native | Apple silicon |
| **Node agent in a browser tab** | **YES — full peer** | no (`wasmcloud-js` 44★, experimental, legacy wapc) | no | no | no | no | no |
| **Node agent embedded in a host app, no native binary** | **YES** | no | no | no | no | no | no |
| **Runs on a smart TV** | **YES** (Tizen ≥5.5, tvOS via V8 jitless Wasm interpreter) | **no third-party native SDK exists** | no | no | no | no | no |
| **Supply model** | any device with a JS engine; provider-gated enrolment | you own the hosts | vendor-owned PoPs | staked node providers | staked / permissionless | volunteer installer | Apple-owned |
| **Result integrity vs a lying executor** | **N-version redundancy + signed results + backbone anchoring** | **none** | **none** | replicated consensus | stake/slashing; verification shipped **off** | replication + quorum | attestation + transparency log |
| **Raw data can stay on owner's device** | **YES — `EgressGuard`, egress manifest** | no (placement policy over hosts you own) | no | no | no | no | no (moves to Apple) |
| **E2E transport encryption** | Noise, peer-to-peer; relay carries ciphertext | TLS/NATS | TLS | TLS | varies | TLS | OHTTP blinding |
| **Determinism** | **enforced at publish time** (only path available in V8) | not claimed | not claimed | Wasmtime `nan_canonicalization` + `threads(false)` | Marine | homogeneous redundancy | — |
| **Must be centrally hosted** | relays, enrolment provider, CID CDN | k8s control plane | entire vendor | the chain | chain + bootstrap | project servers | Apple |
| **Incentives** | **none, by decision** | none | fiat | cycles | crypto-asset | none | fiat |
| **License** | source-available, no contributions | Apache-2.0 | proprietary | Apache-2.0 | Apache-2.0 | LGPL | proprietary |

---

## 3. Where you are genuinely alone

These four claims survived the sweep with no competitor occupying them.

**3.1 A node agent with no native binary.** Every platform in the WASM-cloud category embeds Wasmtime
as a native Rust crate. Consequences they cannot escape: **Wasmtime's iOS and Android targets are
Tier 3, "not production ready"** by its own classification; Spin and wasmCloud document desktop/server
only; and **smart TVs admit no third-party native SDK at all**, so a Wasmtime agent cannot ship to a
Samsung or LG TV by any route. Samsung has supported WebAssembly on Tizen TVs since **5.5 (2020)**.
V8's own build config states: *"tvOS runs in single process mode and is not allowed to use JIT…
Since v8 has the Wasm interpreter mode with jitless, tvOS enables it to use WebAssembly."*
A bonus verified: **Google Play's downloaded-code ban explicitly exempts interpreters and VMs.**

**The two embedding paths into a native app are both proven — owner-measured.** WebAssembly has run on
iPhone continuously **since 2019** (owner testing, on device, sustained to date), and embedding into a
host application works by **either** running V8 in-process **or** hosting an embedded WebView. Both
were tested. So the agent reaches iOS, Android, desktop and TV through a path the Wasmtime-based
competitors cannot follow — they need a native build per target and, on Apple platforms, a JIT
entitlement third parties do not get.

*A correction worth recording, because it is the trap in this area:* `nodejs-mobile` documents "On iOS,
WASM is unsupported", and it is tempting to read that as a platform limit. It is not. It is that
project's **build configuration** — V8's `gni/v8.gni` makes lite mode imply jitless and disable Wasm by
default, and **tvOS re-enables the Wasm interpreter in exactly that jitless configuration**, which
proves the switch is a flag rather than a prohibition. Likewise **Hermes has no Wasm** by explicit
maintainer decision, which rules out React Native's *default* engine — not React Native, which reaches
Wasm through a WebView or an embedded V8 like any other host app.

**3.1a The asymmetry of the ask — why reach compounds with adoption, and only for this architecture.**
Every capability gap named above is *software-configurable*, and the two architectures face
categorically different asks to close one.

To reach a new platform, this agent needs a vendor to **flip a build flag** on a runtime the vendor
already ships. A Wasmtime-based competitor needs the vendor to **grant a third party a native SDK and
a JIT entitlement** — on platforms whose entire security model exists to refuse exactly that. Those
are not the same negotiation, and no amount of adoption converts the second into the first.

**There is direct precedent inside the same vendor and codebase.** Apple has already made this
enablement decision once: tvOS is JIT-prohibited, and V8's build config records that *"since v8 has
the Wasm interpreter mode with jitless, tvOS enables it to use WebAssembly."* watchOS's exclusion is a
compile-time predicate (`ENABLE(WEBASSEMBLY) && !PLATFORM(WATCHOS)`) — the same class of switch, not a
hardware or security barrier. Samsung likewise enabled Wasm across its TV line at Tizen 5.5.

**Stated honestly:** this is a *consequence* of adoption, not an input to today's weighting, and it
cannot be banked in a competitive comparison. Hardware design-win cycles are 2–4 years. But it belongs
in the strategic picture for one reason that survives the discount: **the flywheel is available to this
architecture and structurally unavailable to the native-runtime competitors.** A manufacturer that
wanted to embed a compute-node core into a TV, set-top box or handset can do so here by shipping
JavaScript against an engine already in the product; the same manufacturer cannot do it for wasmCloud
or Spin without adopting a Rust toolchain and a JIT they do not permit.

**3.2 Data that never moves, enforced by a refusing transport.** No competitor has a "move code to
data" primitive. The closest — wasmCloud's host labels + spreadscaler + Policy Service, and
Akamai/Wasmer region pinning — are *operator-declared placement over infrastructure the operator
already owns*, not a proof that data never left. `EgressGuard` refusing frames, plus the egress
manifest and coverage report, is complete by construction rather than by audit.

**3.3 Integrity without a chain, a crypto-asset, or a TEE.** ICP achieves replicated determinism
with a validator set and consensus; Fluence, Akash and iExec with crypto-assets and staking; Phala
and Secret with
TEEs. You achieve it with one small VM and no chain.

**3.4 A capability chain with monotonicity by construction.** `verifyChain` does not do pairwise
subset checks — it tests the *requested* ability against **every** link and folds expiry with
`Math.min`. A child link that widens its abilities is therefore **inert, not dangerous**. This is
Biscuit's monotonicity property and TUF's design (chain intersection, no subset requirement), reached
without going looking for it. Competitors whose capability systems make the pairwise check
load-bearing carry a privilege-escalation surface you do not.

---

## 4. Where you lose, and to whom

**Licensing is excluded from this ranking by owner decision (2026-08-06): the licence is planned to
change.** An earlier draft ranked the no-contributions source-available terms as the single most
damaging structural weakness, on the reasoning that the portability moat — "runs on any JS host" — is
exactly the claim that most needs third-party adapters, and that in a deal where sovereignty is the
reason to buy, the buyer is buying *away* from lock-in. That reasoning stands as an argument *for*
changing the licence; it is not a durable property of the finished system and so does not belong in a
structural ranking. Revisit once the new terms are settled.

| Weakness | Binds | Lose to | Why it hurts |
|---|---|---|---|
| **Free-text `operatorId`** — *now the top structural item* | all tiers | ICP, anything staked | Quorum diversity is exactly as strong as one provider's willingness to sign. *"Nothing in an enrolment request is scarce."* Two colluders under distinct operator IDs bill `independent` agreement at half the work. This is the load-bearing weakness in the integrity claim, and the one a technical buyer will find first. |
| **No commit–reveal** | all tiers | BOINC | Removed because the ceremony was measured vacuous, not because the threat vanished. One executor can copy another's `resultCid` and sign it. |
| **No TEE tier** | all tiers | Azure/AWS/GCP confidential | Sovereignty and cross-operator verification are mutually exclusive without one — unless the customer pre-replicates by hand, which the fabric will not do for them. |
| **AOT is AArch64-only**, 5.40 MiB artifact **floor**, 43 ms in-guest floor | all tiers | any container platform | An x86-64 binary is refused, and a container platform takes it. See the note below — one clause of this row was overstated and is corrected there. |
| **~2× redundancy tax** | all tiers | every centralized platform | Doubles any $/unit comparison — but see §6. |
| `MAX_PARTIAL_BYTES = 9216` | all tiers **by constant, not transport** | — | Lives in the portable kernel (`core/src/reduce.ts:76`), enforced unconditionally. A configuration ceiling, not a capability ceiling; raising it for a homogeneous deployment is one line. |
| Duty cycle, eviction, relay dependency, ~1.04 s WebRTC hop | **tabs only** | — | The fabric routes around these by placing demanding work on Node/embedded peers. |

**Correction to the AOT row, 2026-08-07 — one clause was the study's own framing, not a
measured gap.** It read *"cannot ingest the x86-64 legacy the AOT tier exists to serve."*
The second half is false: **`AOT-01` specifies "a statically-linked **AArch64** binary
translates to a `.wasm`", and the string `x86` appears nowhere in `REQUIREMENTS.md` or
`ROADMAP.md`.** The AOT tier was scoped to AArch64 from the day it was written. Losing
x86-64 work to a container platform is real and the row keeps it; *"the tier exists to
serve"* it was not a requirement anyone set and is withdrawn.

Three things the row omitted, each of which changes how a technical reader should weigh it:

- **The refusal is explicit, at the front door, by name.** `packages/aot/src/elf.ts`
  screens `e_machine` before anything else runs and returns `not-aarch64`. An x86-64 input
  does not fail obscurely deep in the toolchain — which matters, because elfconv **exits
  `0` on binaries it could not fully translate**, so a driver that did not screen would
  have shipped a broken artifact under a name asserting it was clean.
- **The constraint is upstream, it is not permanent, and it is weaker than the README
  says.** elfconv's README still reads *"Only AArch64 ELF binaries are currently
  supported"* — but **the README is stale.** `scripts/build.sh` takes `ELFCONV_X86=1`,
  passes `CMAKE_ELFCONV_X86_BUILD` to CMake, and enforces it as *mutually exclusive* with
  the AArch64 build; `.github/workflows/tests.yml` carries a build matrix with
  **`arch: AMD64` / `build-arg: ECV_X86=1`** alongside the AArch64 arm. Six x86 PRs merged
  in February 2026, including *"Activate all x86 semantics files"* and *"Fix x86
  instruction support and add the test env to CI"*. So an x86-64 **lifter build exists and
  is CI-exercised** — what is unproven is its **wasm** output, because the workflow's
  browser job runs the AArch64 arm only. It has then been quiet on x86 for five months
  (April–July 2026 is AArch64 instructions and dependency bumps), so treat the *finish* as
  unscheduled — but the starting point is far past zero. The lifter underneath (Remill)
  has supported amd64 for years; the gap was never the instruction semantics.
- **5.40 MiB is a floor, not a typical size.** It is 5.40 MiB *whether the program does
  nothing or 128 MiB of traffic* — it is the emitted runtime, not the payload. Quoting it
  as an artifact size makes a small guest look cheap and a large one look ruinous, and both
  readings are wrong.

**The path is shorter than this row implied, and it is now a measurement rather than a
research question — tracked as `AOT-06`.** The driver is *already* parameterised for more
than one target: `tools/aot/cli.ts` takes `--image <tag>`, and `cache-key.ts` carries
`target` with its own note that *"the wrong target emits a different ABI"* — so the
architecture is not the obstacle. Three things stand between here and an x86-64 artifact,
in order:

1. Build the elfconv image with `ECV_X86=1` and lift an x86-64 static hello-world **to
   wasm**. This is the decisive experiment and nobody has run it. If the wasm arm is broken
   upstream, everything below is moot and the row reverts to its pessimistic reading.
2. If it produces a module: widen `elf.ts`'s screen from a hard-coded `EM_AARCH64` to the
   machine the *selected target* accepts, and carry the machine in the cache key so an
   x86-64 artifact and an AArch64 one can never collide.
3. Re-measure the two published floors on the x86 path. **Do not assume they carry over** —
   5.40 MiB and 43 ms are both properties of elfconv's emitted runtime and machine-state
   init, and the x86-64 `State` struct is a different size.

**What stays ruled out regardless.** The emulator routes — Blink, Box64, qemu-user compiled
to WASM — are worse on every axis this project measures, and decisively on **determinism**:
they carry a full x86-64 FPU and SIMD model into the guest, a far larger nondeterminism
surface than a lifted static binary, against a constraint that must be enforced at publish
time because V8 exposes no NaN-canonicalization or relaxed-SIMD control.

**The economics, which cut for you:**

| | $/CPU-hour |
|---|---|
| Edge premium tier | $0.13–0.18 |
| Reference serverless | $0.07–0.11 |
| Managed serverless floor | ~$0.05 |
| Cheap VPS | ~$0.021 |
| **Donated consumer core (electricity)** | **$0.0018–0.0046** |

Donated capacity sits **4–10× below rented hardware and 15–40× below managed serverless**. Even after
a 2× redundancy tax the gap does not close.

**And cut against you:** confidential computing is *not* a premium. Azure `DC16as_v5` is **$0.688/hr,
identical to the non-confidential `D16as_v5`**; AWS charges nothing extra for Nitro Enclaves; only GCP
adds a surcharge (~$0.068/hr on 16 vCPU/64 GiB). Cost is not your argument against TEEs. **TEE.fail
is** — see §5.

---

## 5. The five numbers to quote, with their caveats

1. **WASM at 1.11× native** (source-compiled, your measurement). **Caveat that must travel with it:**
   Node/V8 measures **7.95× native** on libsodium — i64-heavy crypto, V8's worst case — against
   Wasmtime's 2.41× and WAMR-AOT's 1.57×. Both numbers are real and they are different workloads.
   Quote as *"1.11× on our workload; V8's penalty is workload-dependent and reaches ~8× on i64-heavy
   crypto."* elfconv adds 1.0–1.3× over source-compiled WASM. Independent corroboration: Gray
   Computing measured compiled WASM at **1.33× native** vs hand-written JS at **30×**.

2. **zkVMs remain ~10⁶× native.** Justin Thaler (a16z, 2025-03-11) states the factor has not moved
   since 2024 and calls 10⁵× merely "the first step." The best production datapoint — $0.0053 per
   Ethereum-block proof on 8×RTX 5090 — is by his own arithmetic a ~40,000× cost inflation. **ZK is
   not an alternative to redundancy at any price you would pay.**

3. **TEEs cost 2–10% and were broken by $50–$1000 physical interposers in 2025–26** — Battering RAM,
   WireTap (CCS'25), TEE.Fail (S&P'26) — extracting SGX/TDX attestation keys and forging quotes.
   **Both vendors declared physical attacks out of scope and will not mitigate.** WireTap
   demonstrated live attacks against Phala, Secret Network, Crust and IntegriTEE. The line to use:
   *for a fabric where the node owner is the adversary, a TEE is cheaper and unsound.*

4. **Cross-architecture NaN divergence in V8 is real and systematic** — originally measured by this
   research, closing an open question in your own `CLAUDE.md`. Identical wasm bytes, identical V8
   12.9.202.28, arm64 vs x86-64: **6 of 10 primitive float ops produce different bits**, stable across
   2M iterations and both JIT tiers. A mixed-architecture quorum yields a **permanent 2–2 split**, not
   a flaky minority. Binaryen `denan` v131 made all ten bit-identical at ~3.0–3.6× on float-saturated
   code, +44–85% size. **Caveat: the x86-64 side ran under Rosetta 2 (`hw.optional.fma: 0`); native
   confirmation is owed before this is published.**

5. **Redundancy's honest price is ~2.0×, and spot-checking cannot replace it.** Kondo et al.'s
   production BOINC measurement (~4,400 hosts): 35% of hosts returned at least one corrupt result,
   per-result error rate φ ≈ 0.002. Spot-checking needs **n > 5,300 workunits per worker (≥14.5
   CPU-years)** to reach 10⁻⁵, because its error bound scales with per-worker work volume — and
   Panther measured that **over half of browser sessions return zero work**. At φ ≈ 0.002, m=2 voting
   reaches 10⁻⁵ at redundancy ~2.0. Replication-with-quorum is not a preference; it is the only
   affordable option for your supply shape.

---

## 6. Design inputs this research produced

Four findings that are actionable rather than merely comparative.

**6.1 Cut the redundancy tax by an order of magnitude, with precedent.** BOINC's twenty-year
measurement: *"at least 50% of total CPU time is spent checking result validity."* Their fix was
**reputation-gated selective replication at 5–10%**, not uniform 2–3×. You have primitives BOINC
lacked — enrolment, certificates, per-node signed results — so the reputation substrate is already
there. This converts your #6 weakness into a near-non-issue and is the single highest-leverage change
in this document.

**6.2 Serve artifacts from a CDN keyed by CID.** Public IPFS retrieval is not a viable path:
Cloudflare's gateway ended 2024-08-14, Brave removed `ipfs://` 2024-08-22, the IPFS Foundation's own
docs say public gateways are *"not intended to be part of your critical path or production
infrastructure"*, and Filecoin's measured network-wide retrieval success rate was **12.8%** (Sept
2024). Because you never put sovereign data on IPFS, you inherit only an *availability* problem — and
**Bluesky/atproto solves exactly this in production**: CID in the record, bytes over HTTPS. A CDN
keyed by CID preserves content addressing *and* the V8 code-caching path.

**6.3 Decide the NaN-influenced-output question explicitly.** Determinism moved to the serialization
boundary — strict DAG-CBOR rejecting `NaN`/`Infinity`/`-0.0` on anything hashed — which fails closed
on a NaN-*valued* output. It does not obviously catch a NaN-*influenced* output: a NaN flowing through
a comparison, bitcast or branch to yield a finite-but-different number per architecture, which
DAG-CBOR would happily encode. Given §5.4, if quorums can ever span arm64 and x86-64 this wants a
ruling, not an assumption.

**6.4 There is nothing to adopt for the decentralized DB — and nobody competing.** Measured by commits
rather than `pushed_at` (which is actively misleading): OrbitDB **0 commits since 2026-05-15**, and
version-incompatible anyway (`multiformats@^13`, `uint8arrays@^5`, devDep `helia@^6` against your 14/6/7
— the exact `CID instanceof` boundary your `CLAUDE.md` warns about), with open issue **#1255 "Sync
never delivers the first entry to a reader connected only through a relay"** sitting on your topology.
GUN: 4 commits in 12 months. Ceramic: 0 since 2025-10-20. Earthstar/Willow: >15 months. DXOS: FSL, not
OSI-open. Calibration: `ipfs/helia` logged **56 commits in the trailing 90 days**. Build it; the
category vacated.

---

## 7. The demand question, stated honestly

**The supply thesis has a shape problem the research is blunt about.** Folding@home is **99.4% below
its 2020 peak**; BOINC's top 100 *individuals* out-compute all of it by 1.7×; Einstein@Home has 21,230
active hosts out of 8,244,431 ever registered (**0.26%**); Rosetta@home shows 23 hosts and zero tasks.
Volunteer compute concentrates into enthusiast farms — it is empirically *not* a browser long tail,
which is the shape "capacity scales with the user base" assumes. Meanwhile **paid** consumer capacity
overtook all of unpaid volunteer computing: Salad reports **60,000+ daily active GPUs** paying
$30–$200/month, against ~45,000 active machines across the four largest volunteer projects combined.

**Two more negatives worth carrying.** Coinhive's own economics (CCS'18): **$59K/day revenue against
278,000 kWh/day** — $0.21 of revenue per kWh burned, value-destroying at most retail power prices;
per-CPU-hour yield $0.0035–$0.025 across two independent studies, confirming your "single-digit
dollars over months." And **Malwarebytes blocked Coinhive by domain while explicitly stating it was
not malicious** — opt-in browser compute inherits that classification by construction.

**The resolution is your own scope correction.** An agent embedded in a host application is not
volunteer compute: it is the app operator's own consented user devices, executing the app's own work.
That has different economics, no AV-classification problem, and no App Store "unrelated background
compute" exposure. It also matches where the money demonstrably is — the EU awarded **€180M in April
2026 to four European providers** (no US hyperscaler), Schwarz Gruppe put **€11B into STACKIT**, Owkin
raised **$334.1M** on federated health analytics. But note that money went to *European datacentres*,
not device-resident compute: **demand for residency is proven one step short of your claim.**

**And the closest substitute has a posted price:** AWS Clean Rooms at **$4.00/CRPU-hour ≈ $21 a job**,
while **OHDSI already runs 974M patient records across 544 sources in 54 countries, free and open.**

---

## 8. Evidence quality

Eight streams, primary sources, tier-tagged. **One stream (WASM cloud) delegated sub-clusters whose
agents never reported, wrote up their topics anyway, then disclosed and retracted ~30 claims** —
those are quarantined as Tier B in `research-02-wasm-cloud.md` and none of them is load-bearing here.
The session's WebSearch budget was exhausted mid-sweep; remaining streams ran on Firecrawl and direct
fetches against primary sources, which is stronger evidence than search snippets.

**Do not build an argument on:** any TAM figure (Everest forecast $54B for 2026 against current
estimates of $15.1–18.1B — a 3–3.5× overshoot); Gensyn's RepOps overhead (two sources citing the same
paper disagree); Aethir's self-reported $166M ARR (TheBlock reported $36M). **Apocryphal, do not
repeat:** the "1,000,000× more expensive" line attributed to Vitalik. **Source does not exist:** Molly
White has no entries on decentralized compute.

**Excluded by owner decision:** licensing posture — the licence is planned to change, so it is not a
durable property and is not ranked (see §4).

**Owed measurements:** native x86-64 confirmation of the NaN divergence result; whether Chromium
suspends dedicated Workers in a backgrounded tab (undocumented, load-bearing, and measurable rather
than researchable); whether a libp2p data channel trips Chrome 133's freezing exemption.

**Corrected during the sweep:** the Apple Watch claim does not survive — WebKit's `canUseWasm()` is
`ENABLE(WEBASSEMBLY) && !PLATFORM(WATCHOS)`, so the `WebAssembly` global does not exist on watchOS,
ever. **Drop the watch; keep everything else.** The JIT-prohibition argument is also stale in the
opposite direction from how it is usually told: WebKit disabling Wasm without JIT was **2022**
behaviour (`if (!Options::useJIT()) { Options::useWebAssembly() = false; }`); current WebKit disables
only the BBQ/OMG JIT tiers and keeps Wasm alive on IPInt, shipped in Safari 26.

**Corrected after the sweep, by owner measurement:** an earlier draft of this document called native
mobile embedding "the weak leg", on the strength of `nodejs-mobile`'s "On iOS, WASM is unsupported"
and Hermes' lack of Wasm. **That was a build-configuration fact generalized into a platform limit, and
it is wrong.** WebAssembly has run on iPhone since 2019 and continues to, and both embedding paths —
in-process V8, and embedded WebView — are tested and working. The general lesson, which applies to
every row in this document: *a library's build-config limitation is not a platform limitation, and one
project's disabled flag is not a prohibition.* Browser, TV **and** native mobile embedding are all
live; only watchOS is genuinely closed.
