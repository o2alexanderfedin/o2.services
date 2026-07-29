# Phase 21: AOT Translation Signing & Runtime - Context

**Gathered:** 2026-07-28
**Status:** Ready for planning
**Mode:** Autonomous — every grey area below is resolved and the reasoning recorded.
Two things are flagged rather than resolved: the guest program criterion 3 needs does
not exist yet, and criterion 3 cannot run on a host without the 6 GB elfconv image.
See "Risks".

<domain>
## Phase Boundary

Two mechanisms built and unit-verified in Phase 10 have no production caller:

- **`translationCid`** (`packages/aot/src/cache-key.ts:126`). Every hit in the tree is
  (a) its own definition, (b) the barrel re-export at `packages/aot/src/index.ts:41`,
  or (c) `packages/aot/src/cache-key.test.ts` (`:15`, `:142`, `:154`, `:162`, `:171`,
  `:192`, `:205`, `:214`). **Zero production call sites.** `tools/aot/lift.ts` names it
  only in prose — `:5` and the field comment at `:236` — while building, at `:747-756`
  and `:767-769`, exactly the four inputs the key wants and then never naming them.
  `TranslationRecord` (`cache-key.ts:171`) is constructed nowhere at all, in production
  or in a test.
- **`WasiExecutor`** (`packages/aot/src/wasi-executor.ts:739`). Constructed at
  `admission.test.ts:191`, `wasi-executor.test.ts:89/225/476/493/506/513/641/673/681/
  1217-1219/1255`, and `wasi-real.node.test.ts:155/182-183` — **all tests**. Neither
  node factory constructs one: `fabric-node.ts:376-379` and `browser-node.ts:256-261`
  both compose `WasmExecutor` and nothing else. `@o2/node` and `@o2/browser` do not even
  declare `@o2/aot` as a dependency (`packages/node/package.json`,
  `packages/browser/package.json`), so today no production code path can reach the class.

**In scope:** AOT-02, AOT-04 — make `liftElf` name what it produced, make the CLI print
that name, and make both node factories able to run a translated artifact on the same
admission and verification path as a source-compiled one.

**Out of scope:** cryptographic signing of anything (see decision 1); a translation
cache that consults the key before spending time in a container (the key is *emitted*
here, not *consulted*); `signName`/`SignedNameResolver` (Phase 14 — that phase's context
already records that `translationCid` and `signName` "are not the same concept and do
not merge", `.planning/phases/phase-14-signed-artifact-resolution/14-CONTEXT.md:204-218`);
capability chains on dispatch (Phase 15); AOT-03's cross-machine half (descoped
2026-07-28, unmeasured, and `CROSS_MACHINE_BLIND_SPOT` stays attached — `lift.ts:147`);
AOT-05's code-cache negative (Phase 10, measured, stays a negative).
</domain>

<decisions>
## Implementation Decisions

### 1. "Signing" in the phase title means naming, not a signature

The roadmap's three criteria (`.planning/ROADMAP.md:494-497`) never mention a key, a
signature or a trust anchor. AOT-02's own text (`REQUIREMENTS.md:317-320`) asks for a
*cache key*, an image keyed by digest, and a refusal — all content addressing.
`14-CONTEXT.md:251-254` states the division explicitly: "`translationCid` stays
unsigned; only its *output* CID ever enters this phase's mapping". So this phase adds
**no crypto**. It produces an `artifactCid` that Phase 14's `signName` path can later
name, and it must not invent a second, competing notion of a trusted artifact.

### 2. `liftElf` calls `translationCid`; a lift that cannot be named is a failure, not a partial success

The roadmap wants the pipeline itself to call it — "`translationCid` is called by the
lift pipeline itself and the CLI emits the CID it produces" (`ROADMAP.md:488`). The call
belongs at `lift.ts:757`, immediately after `toolchain` is assembled and before the
`ok: true` return, because every input is already in hand there: `digest` (`:747`),
`toolchain` (`:748-756`), `LIFT_TARGET` (`:102`) and `features.features.required`
(`:735`). `tools/aot/lift.ts` already imports from `@o2/aot` (`:82-83`), so this adds no
new dependency edge — and `@o2/aot` remains free of `tools/`, which is the direction
`packages/aot/src/index.ts:29-36` requires.

`LiftedArtifact` gains `readonly translation: TranslationRecord`, a required field
beside `findings`/`undecoded`/`blindSpots` for the reason `lift.ts:226-229` gives for
those: "there is no value of this type that carries the bytes without them." An artifact
that cannot be named cannot be cached, dispatched by name, or compared against another
host's — the same class of thing.

**`translationCid` can genuinely fail here, and the branch is not hypothetical.**
`parseMeta` (`lift.ts:766`, defined at `:487`) trims values, so a `meta.txt` line reading
`clang=` yields `''`, which is *not* `undefined`, so the `?? 'unknown'` fallbacks at
`:751-755` do not fire and `translationCid` returns `{kind:'blank-version', tool:'clang'}`
(`cache-key.ts:135-137`). So `LiftFailure` gains one arm — `{ kind: 'unnameable';
reason: KeyFailure }` — and `describeLiftFailure` (`:785`) gains its sentence. The switch
has no `default` arm, so forgetting the sentence is a compile error; that is the existing
house rule at `cache-key.ts:99-102` and it should be preserved.

### 3. `artifactCid` is the CID the blockstore would assign — dag-cbor codec, not raw

`TranslationRecord.artifactCid` (`cache-key.ts:174`) has to be the CID a node can
actually look the artifact up by, or the record names something nothing can resolve.
Both blockstores compute it identically and non-obviously:
`CID.create(1, dagCbor.code, await sha256.digest(bytes))` —
`packages/core/src/blockstore/memory.ts:24-25` and
`packages/node/src/fs-blockstore.ts:56-58`. The codec is **dag-cbor even though the bytes
are WASM**. A planner reaching for `raw` (0x55) because the payload is opaque bytes would
produce a well-formed CID that no `blockstore.get` in this repository ever answers. Add a
test that puts the artifact bytes into a `MemoryBlockstore` and asserts the returned CID
equals `record.artifactCid`, so the coupling is checked rather than remembered.

### 4. The key construction is extracted as a pure function, so criterion 2's second half is measurable without Docker

Criterion 2 ends "changing any one covered input changes the emitted CID". `cache-key.
test.ts:70-115` already proves that of `translationCid` in isolation — but the criterion
is about *the emitted* CID, i.e. about the key **the pipeline builds**, and a pipeline
that silently dropped `requiredFeatures` from the key would pass every existing
assertion. So factor the construction out:

```ts
export function translationKeyOf(artifact: Omit<LiftedArtifact, 'translation'>): TranslationKey
```

Pure, no container, no filesystem — so `lift.node.test.ts` can flip one field of the
already-existing `RENDERED_ARTIFACT` fixture (`lift.node.test.ts:507` uses it this way
today) and require the CID to move, four times, with no Docker at all. Without this the
only probe is a full 95-second lift per field, which nobody will run.

### 5. The CLI gains `--image` and `--docker`, forwarded to `liftElf`

`LiftOptions.image` and `LiftOptions.docker` already exist and already carry the comment
"Overridable so a test can point at a tag that does not exist" / "…that is not Docker"
(`lift.ts:806-810` region, the `LiftOptions` block at `:316-327`). `main()` at
`cli.ts:139-141` passes neither, so **the CLI cannot be pointed at anything** — and
criterion 2 says "*pointing the CLI at it* is refused". Two words of argv close that,
`parseAotArgs` (`cli.ts:109`) is already a pure function from an argv array to a result
with its own spec (`cli.node.test.ts:30-107`), and adding two optional string flags
extends that spec rather than inventing a seam.

The payoff is that criterion 2's refusal becomes measurable **on a host with no elfconv
image at all**: `cli.node.test.ts` spawns the real CLI with `--docker <stub>` pointed at
the `stubDocker` script that `lift.node.test.ts:637-658` already builds, emitting the
`FOREIGN_DIGESTS` list at `:704-708`, and asserts the process exits 1 and its stderr
names the borrowed name. Do not duplicate `stubDocker` — export it, or lift it into a
small shared helper under `tools/aot/`.

### 6. "A re-tagged local translated image" is the elfconv toolchain image

Criterion 2's phrase is ambiguous — there is no such thing as a "translated image" in
this codebase. The only re-tag hazard anywhere in the pipeline is the toolchain image,
and `lift.ts:268-291` documents exactly the attack the criterion describes: a re-tagged
image "would run an unknown toolchain under a trusted name and record it in the cache
key as this one; a build from an unknown toolchain wearing a trusted name, cached under
that name forever." The mechanism is `resolveImage` (`lift.ts:434-484`) and its two
distinct refusals, `image-has-no-digest` and `image-digest-foreign` (`:475-482`). This
phase does not build a new refusal; it routes the CLI to the existing one and measures
it end to end.

### 7. A node runs both ABIs; the choice is per artifact, never per node

`admission.test.ts:28-36` already settles the shape of this and is worth quoting to the
planner: "A job names one `moduleCid`, and the module decides the ABI … Handing either
to the other executor fails at `WebAssembly.instantiate` — correctly, since the runtime
is the sandbox. Executor kinds are interchangeable *per artifact*, not within one."

So there is **no `--wasi` flag on `bin/agent.ts` and no second node factory**. Every node
composes both executors and picks per task. Anything else makes a node's capability a
property of how it was started, which is the one thing this project does not permit.

The predicate is the module's declared import namespace: compile the module bytes once,
and if any entry of `WebAssembly.Module.imports(module)` has `module === WASI_NAMESPACE`
(`wasi-executor.ts:150`), route to `WasiExecutor`; otherwise route to the native path.
This is the exact discrimination `wasi-real.node.test.ts:103-106` and
`wasi-executor.test.ts:158` already perform on real artifacts, and `demo/kernel.test.ts:
116` performs on the native one.

**This is not the deleted static analysis and it is not an import allow-list.** It
predicts nothing about the guest's behaviour, and it does not decide which imports are
permitted — `WebAssembly.instantiate` still refuses anything the chosen host object does
not supply and still names it (`wasm.ts:107-114`, `wasi-executor.ts:812-819`). Routing
wrongly costs one honest `instantiation failed` naming the missing import; it cannot
produce a wrong result. Say this in the router's own module comment, or someone will
delete it on sight.

**Rejected alternative:** run `WasiExecutor.run` first and fall back to the native
executor on `{kind:'instantiation-failed'}`. It avoids the extra compile, but when both
paths fail the reported reason is the second one's — so a corrupt WASI artifact would be
reported as a broken native module. One honest reason beats one saved compile.
**Also rejected:** scanning the raw bytes for the ASCII `wasi_snapshot_preview1`. Free,
and a heuristic a data segment defeats; this project removes heuristics.

**Cost, stated:** one extra `WebAssembly.compile` per dispatch, on a module that may be
5.66 MB. Memoising `moduleCid → route` is deliberately **not** done in this phase — an
unbounded per-node map is precisely the resource bound the roadmap flagged for
`EgressGuard.#entries` (`ROADMAP.md:389`), and adding a second one while that is open is
not a trade this phase should make silently.

### 8. The router lives in `@o2/aot` and is composed innermost in both node factories

It has to see `WasmExecutor` (`@o2/core`) and `WasiExecutor` (`@o2/aot`). `@o2/core` may
not depend on any `@o2/*` (`purity.node.test.ts:167-174`), and `@o2/net` does not depend
on `@o2/aot`. `@o2/aot` already depends on `@o2/core` and is in the PORTABLE list
(`purity.node.test.ts:28`), so it is the only place both are visible. New file, e.g.
`packages/aot/src/abi-router.ts`, exported from the barrel — and note that
`packages/aot/src/*.test.ts` already runs in the **Chromium** project as well as Node
(`vitest.config.ts:33` and `:42`), so a router spec there is dual-target for free.

Signature that composes with what already exists:

```ts
new AbiExecutor({ blockstore, native, wasi })   // nodeId taken from `native.nodeId`
```

Taking two `Executor`s rather than constructing them keeps it composable with
`guardSovereignty` / `registerSovereignInputs` / `GovernedExecutor`, and taking `nodeId`
from `native` rather than as a fourth argument removes a value that could drift — the
same reasoning `fabric-node.ts:346-348` records for the hoisted sovereignty default.

Composition is **innermost**, replacing `new WasmExecutor(...)` in place:

- `fabric-node.ts:376-379` — `registerSovereignInputs(guardSovereignty(<router>, sovereignty), …)`
- `browser-node.ts:256-261` — `new GovernedExecutor(registerSovereignInputs(guardSovereignty(<router>, sovereignty), …), governor)`

so the sovereignty gate, the egress registration, and the duty-cycle governor all apply
to a translated artifact exactly as they do to a source-compiled one — which is half of
what criterion 3's "same admission … path" means.

`@o2/node` and `@o2/browser` each gain `"@o2/aot": "*"`. Both are permitted: the
forbidden direction is portable→adapter (`purity.node.test.ts:46-52`), and this is
adapter→portable. `@o2/aot`'s only runtime dependency beyond `@o2/core` is
`@bjorn3/browser_wasi_shim@0.4.2`, pure JS and zero-dependency, so the demo bundle grows
by a shim and nothing platform-specific enters `@o2/browser`.

**On the browser tier:** it is composed for the same reason — a `BrowserNode` that could
not run a translated artifact while a `FabricNode` could would be a difference in
capability between node kinds. Phase 21's criteria measure only the Node tier, so the
browser composition will be **structurally present and unmeasured at runtime** in this
phase. That is the same gap `WIRE-03` carries; do not report it as met.

### 9. Criterion 3's guest is a stdio-free echo, built inside the elfconv image

No artifact that this fabric can *complete a job with* exists today. The only real lift
ever pointed at the executor is a `printf("hello\n")`, and it necessarily ends
`not-dag-cbor` (`wasi-real.node.test.ts:147-171`) because the fabric's output codec is
DAG-CBOR and the guest writes ASCII. `wasi-real.node.test.ts:39-41` names this exact gap:
"Producing a *result* from a real artifact needs a guest that speaks the codec … That is
a larger piece of work and it is not what AOT-04 asks for." **Criterion 3 asks for it.**

Take the shortest correct route: an **echo**. `WasiExecutor` writes the input block —
which is `canonicalCid(value).bytes`, i.e. already valid DAG-CBOR
(`packages/core/src/job/submit.ts:167`) — onto the guest's stdin (`TaskStdin`,
`wasi-executor.ts:436`), and decodes stdout as DAG-CBOR. A guest that copies stdin to
stdout therefore produces the shard's own value, which makes the translated run
comparable field-for-field with a source-compiled run over `MODULE_ECHOES_INPUT`, the
comparison `admission.test.ts:38-53` is built on. It is also exactly what the hand-written
`wasi-echo` fixture does (`fixtures/wasi-fixtures.ts:42-43`), so the property being
demonstrated is unchanged — only its provenance is.

Build it the way `lift.node.test.ts:1046-1076` already builds its subject: `docker run`
the image with `clang-16 -O0 -static` over four lines of C written into `/tmp`, so the
input is reproducible from source rather than checked in as an opaque 659 KB blob. Use
`read(2)`/`write(2)` and **not** stdio: `wasi-real.node.test.ts:123-126` records that
`printf` alone drags in `clock_time_get` and `poll_oneoff` through glibc's stdio, and the
174 untranslated addresses Phase 10 measured were inside glibc's `__memcpy_a64fx`
(`lift.ts:14-18`). Fewer glibc paths, fewer chances of reaching one of them.

### 10. The artifact is staged into each agent's blockstore directory; wire transfer of it is measured, not depended on

A lifted artifact is ~5.66 MB (`lift.node.test.ts:1091` requires `> 1_000_000`). Phase
12's harness deliberately makes the module travel over the wire
(`sovereignty-placement.node.test.ts:148-149`), and that is a fine default for a 200-byte
fixture. Here it puts a 5.66 MB block through `RpcBlockSource.fetch`
(`packages/net/agent.ts:44-56`) and `readMessage` (`libp2p-transport.ts:57-66`) — and
Phase 13.1 criterion 3 is about to give `readMessage` "a declared maximum message size"
(`ROADMAP.md:363`), against a measured baseline where a 64 MiB frame is accepted today.

So: **pre-stage.** `bin/agent.ts` takes `--dir` (`agent.ts:24`, `:45`), and
`FsBlockstore.open(dir).put(bytes)` (`fs-blockstore.ts:36`, `:55`) writes a block the
child reads locally, before the child is spawned. The dispatch then carries only CIDs,
which is what a real deployment does anyway — nobody ships 5.66 MB down a dispatch path.

Whether that block *can* cross the wire is a separate question and should be answered as
a **number, not an assumption**: one test that puts the artifact only in the submitter's
store and reports whether `FetchingBlockstore` pulls it, with the byte count and the
elapsed time. If it fails, that is a finding for Phase 13.1's bound — record the size the
bound must admit — not a Phase 21 failure.

### 11. Criterion 3 runs at redundancy 2 across two spawned agents

"Completing the same admission and verification path" is only exercised if verification
actually runs. Redundancy 1 returns `agreed` from a single executor
(`sovereignty-placement.node.test.ts:183-189`), which proves placement and nothing about
comparison. Two agents at `redundancy: 2`, both pre-staged with the artifact, and an
assertion that `verification.agreeing` names both peer ids — that is the N-version claim,
and it is also the strongest available check that the translated artifact is
byte-deterministic across two OS processes on this host. Label it as one host.
</decisions>

<code_context>
## Existing Code Insights

### `translationCid` and its inputs
- `packages/aot/src/cache-key.ts:126-162` — refuses `empty-field` (`inputDigest`,
  `target`), `empty-toolchain`, `blank-version`, `unencodable`; sorts and de-duplicates
  `features` at `:143` so callers cannot disagree by ordering.
- `packages/aot/src/cache-key.ts:171-175` — `TranslationRecord {keyCid, key, artifactCid}`.
  Constructed nowhere in the repository.
- `packages/aot/src/cache-key.test.ts:53` — `CONFORMANCE_CID`, a pinned literal whose
  doc (`:34-52`) says changing it "is not a test edit". A pipeline that builds the key
  with different field *names* would not move this literal — hence decision 4.
- `tools/aot/lift.ts:747` `sha256.digest(bytes)` → `:767` `inputDigest: toHex(digest.bytes)`;
  `:748-756` the six-entry `toolchain` record, every value defaulted to `'unknown'`
  rather than left absent; `:735` `readTargetFeatures(artifactBytes)` → `requiredFeatures`
  read from the artifact's own `target_features` section, "never hardcoded" (`:240`).
  All four of `translationCid`'s inputs sit within twenty lines of each other.

### The image-digest refusal criterion 2 needs
- `tools/aot/lift.ts:434-484` `resolveImage` — `docker image inspect … {{join .RepoDigests}}`,
  repository match required, **no fallback to `digests[0]`** (`:472-482`).
- `tools/aot/lift.ts:796-806` — `describeLiftFailure` arms for both refusals; the
  `image-digest-foreign` sentence already contains "re-tagged image", "unknown toolchain"
  and "re-pull by the name you mean".
- `tools/aot/lift.node.test.ts:637-658` `stubDocker` — a shell script on disk plus an
  invocation log; `:704-708` `FOREIGN_DIGESTS`; `:747-762` proves no container is started
  after the refusal, using the log rather than the return value. This is the harness
  criterion 2 should be driven through, one level up.
- `tools/aot/lift.node.test.ts:1000-1012` `HAVE_IMAGE` — `docker image inspect` on
  `ELFCONV_IMAGE_TAG`, and every real-toolchain test is `it.skipIf(!HAVE_IMAGE)`.

### The CLI
- `tools/aot/cli.ts:109-130` `parseAotArgs` — pure, spec'd at `cli.node.test.ts:30-107`.
- `tools/aot/cli.ts:132-156` `main` — calls `liftElf(args.input, {onProgress})` at `:139`,
  writes the artifact at `:151`, prints `describeLift(...)` at `:152` and the output path
  at `:153`, and returns `0` clean / `2` reservations / `1` failed (`:55-57`, `:155`).
  A glibc-static input "always lands on `2`" (`:38`) — so criterion 1's happy path exits
  **2**, and a test asserting `status === 0` would fail on a correct run.
- `tools/aot/cli.ts:166-176` — the `invokedAsCommand()` guard, so importing the module is
  inert. `cli.node.test.ts:109-123` already spawns the file as a program; that is the
  pattern for asserting printed output.
- `tools/aot/lift.ts:838-872` `describeLift` — one string, deliberately, "so the
  reservations survive being copied". The emitted CID belongs **inside** this string, not
  printed beside it in `main`, for the reason the function's own comment gives.

### `WasiExecutor` and the ABI boundary
- `packages/aot/src/wasi-executor.ts:732-737` `WasiExecutorOptions {nodeId, blockstore,
  maxOutputBytes?}` — identical in shape to `WasmExecutorOptions`
  (`packages/core/src/executor/wasm.ts:39-44`), which is what makes a router trivial.
- `:150` `WASI_NAMESPACE = 'wasi_snapshot_preview1'`; `:153` `_start`; `:226`
  `PINNED_WASI_FUNCTIONS`; `:172`/`:182` the pinned clocks.
- `:812-819` — compile, instantiate, and on failure `{kind:'instantiation-failed', detail}`
  with the comment "any import the host does not supply. The runtime names it; no
  allow-list is involved."
- `:753-760` — fuel is `inputBytes + stdoutBytes`, the same definition `WasmExecutor` uses
  (`wasm.ts:153`), which is why an echo on both sides makes every downstream number agree.
- `packages/aot/src/wasi-real.node.test.ts:51` — `process.env['O2_LIFTED_WASM'] ??
  '/tmp/ecvout/r1/hello.wasm'`, `describe.skipIf(LIFTED === undefined)`. The existing
  convention for "a real artifact if you have one".

### The two composition sites
- `packages/node/src/fabric-node.ts:79` imports `WasmExecutor`; `:376-379` composes
  `registerSovereignInputs(guardSovereignty(new WasmExecutor({nodeId: libp2p.peerId
  .toString(), blockstore}), sovereignty), {blockstore: store, guard: egress})`; `:241`
  declares `readonly executor: Executor`; `:412` hands the same object to `serveAgent`.
- `packages/browser/src/browser-node.ts:34` imports `WasmExecutor`; `:256-261` composes
  `new GovernedExecutor(registerSovereignInputs(guardSovereignty(worker ?? new
  WasmExecutor({nodeId, blockstore}), sovereignty), {...}), governor)`. Note `worker ??`
  — the router's `native` argument is `worker ?? new WasmExecutor(...)`, so BROW-04's
  killable-thread path is preserved for native modules and WASI runs inline. That is an
  asymmetry **within** one node, not between kinds; state it in the plan.
- `packages/net/src/agent.ts:224` — `await executor.execute(request.task)`, the single
  serving-side call. Nothing downstream of it knows or can ask which executor it has.

### The spawn harness criterion 3 should copy
- `packages/node/src/sovereignty-placement.node.test.ts:40` `AGENT`; `:57-89` `spawnAgent`
  (one-line JSON handshake on stdout, 30 s timeout, rejects on early exit); `:100-116`
  `stopAgent` (SIGTERM then SIGKILL); `:141-145` dial; `:149` module `put`; `:169-189`
  `submitJob` + `RemoteExecutor` + assertion on `verification.agreeing`.
- `packages/node/src/bin/agent.ts:22-35` — `parseArgs` with `dir`, `port`, `owner-id`,
  `can-execute-sovereign`. **No new flag is needed for this phase** (decision 7).

### Structural constraints that bound the design
- `packages/node/src/purity.node.test.ts:28` — `PORTABLE = ['core','net','bench','demo','aot']`;
  `:46-52` `FORBIDDEN` (no `node:`, no libp2p, no `@o2/node`); `:167-174` `@o2/core` may
  declare no `@o2/*` dependency at all.
- `vitest.config.ts:33` — the node project includes `tools/**/*.node.test.ts`; `:42` — the
  browser project includes `packages/*/src/**/*.test.ts`, so anything added under
  `packages/aot/src/` without a `.node.` suffix must run in Chromium too.
- `packages/node/src/vocabulary.node.test.ts` scans every git-tracked file including this
  one; `.wasm` is a declared binary (`:206-220`) so a committed artifact is skipped, but a
  `.ts` file carrying a NUL is reported as `invisible` (`:434-443`).
</code_context>

<specifics>
## Specific Ideas

**How each criterion gets measured.**

*Criterion 1 — "produces a `TranslationRecord` whose CID covers input digest, toolchain
versions, target, and WASM feature set, and the CLI prints that CID to the operator."*
Measured in two independent halves, because neither alone is a measurement:
1. **Coverage** — `translationKeyOf` (decision 4) applied to a fixture artifact, one
   field flipped at a time (`inputDigest`, `target`, each of the six `toolchain` entries,
   `requiredFeatures`), each flip required to move the CID. No Docker. This is the half
   that catches a pipeline building a key with the right shape and the wrong contents.
2. **Emission** — spawn `tools/aot/cli.ts` as a program (the `cli.node.test.ts:109-123`
   pattern) against a real AArch64 static ELF, and require the CID string to appear on
   stdout and to equal `record.keyCid.toString()` recomputed from the artifact. Gated on
   `HAVE_IMAGE`; **on a host without the image this half is unmeasured, and unmeasured is
   not met.**

*Criterion 2 — "Re-tagging a local translated image under a different name and pointing
the CLI at it is refused rather than hashed under the borrowed name, and changing any one
covered input changes the emitted CID."*
1. **Refusal, no image required** — CLI subprocess with `--docker <stubDocker emitting
   FOREIGN_DIGESTS>`: assert exit 1, assert stderr names the wanted repository and the
   found digests, and assert the stub's invocation log holds exactly one `image inspect`
   and no `run` — the `lift.node.test.ts:747-762` assertion, which is the only one that
   can show the refusal was not followed by a lift anyway.
2. **Refusal, real re-tag** — `docker tag ghcr.io/yomaytk/elfconv:arm64
   o2-local/elfconv:borrowed`, then the CLI with `--image o2-local/elfconv:borrowed`.
   The re-tagged image's `RepoDigests` still name `ghcr.io/yomaytk/elfconv`, so the
   repository match at `lift.ts:476` fails and `image-digest-foreign` fires against a
   genuinely re-tagged image rather than against a script imitating one. Gated on
   `HAVE_IMAGE`; clean up the tag in `afterAll`.
3. **Emitted-CID sensitivity** — the field sweep from criterion 1's half 1, plus one
   end-to-end pair on a host with the image: lift subject A and subject B differing by
   one byte of C source, and require the two emitted CIDs to differ while a repeat lift
   of A emits the same CID both times (the same-host repeatability
   `lift.node.test.ts:1158-1182` already establishes for the bytes).

*Criterion 3 — "A translated artifact produced by `tools/aot/cli.ts`, dispatched to a
live node started via `bin/agent.ts`, executes successfully — the node constructs a real
`WasiExecutor` in production, completing the same admission and verification path as a
source-compiled module."*
A new `packages/node/src/aot-dispatch.node.test.ts`:
1. Build the echo guest and lift it through `tools/aot/cli.ts` (or read the path from
   `O2_AOT_ARTIFACT`, mirroring `wasi-real.node.test.ts:51`).
2. Pre-stage the artifact into two agent `--dir` blockstores (decision 10), spawn two
   agents, dial both, `submitJob` at `redundancy: 2` with four shards.
3. Assert `complete === true`, every shard `agreed`, `verification.output` equal to the
   shard value, and `agreeing` naming both peer ids.
4. **Assert the ledger, not just the outcome.** The failing shape here is a router that
   silently ran the *native* executor and reported a clean instantiate failure as
   something else, or a run that never reached WASI at all. Run the identical shards
   through `MODULE_ECHOES_INPUT` in the same file and require the two `JobResult`s to
   match on `grossFuel`, `usefulFuel`, `verificationMultiplier` and every shard's
   `inputCid` — the `admission.test.ts:152-164/255` comparison, now across real
   processes instead of in one heap. Equality across two ABIs is the only observation
   that distinguishes "the WASI path ran" from "something ran".
5. **Falsify it.** Point the same job at the *hello-world* artifact and require
   `not-dag-cbor` to surface as a named refusal — proving the success in step 3 came from
   the guest and not from a path that accepts anything.

**"The node constructs a real `WasiExecutor` in production" is the one clause that can
only be reported, not measured, if it is checked by reading the source.** A composition
test that asserts `node.executor` is-a something proves nothing after
`registerSovereignInputs`/`guardSovereignty`/`GovernedExecutor` have wrapped it three
deep. What *does* measure it: step 4's cross-ABI equality (a translated artifact cannot
produce a fabric result through `WasmExecutor` at all — it would fail at instantiate
naming `wasi_snapshot_preview1`), plus a mutation: delete the WASI arm of the router and
require criterion 3's test to fail with `instantiation failed` naming that namespace.
Plant it and record that it was caught, per this project's standing practice.

**Mutations worth planting for the verifier** (Phase 13's verifier planted eight):
drop `requiredFeatures` from `translationKeyOf`; make `translationCid`'s failure a
silent `'unknown'` instead of a `LiftFailure`; restore `resolveImage`'s `digests[0]`
fallback; invert the router predicate; use `raw` instead of `dagCbor.code` for
`artifactCid`; have the CLI print the *artifact* CID where the *key* CID belongs.
</specifics>

<deferred>
## Deferred Ideas

- **A translation cache that consults the key before lifting.** The key is emitted here;
  nothing looks anything up by it. `cache-key.ts:14-19` says this is what the key is
  *for*, but no criterion asks for it and a cache with no eviction story is a second
  unbounded structure (see decision 7's note).
- **Signing the artifact CID.** Phase 14, per `14-CONTEXT.md:251-254`.
- **Memoising the router's per-module decision.** Decision 7 — deferred on the resource
  bound, not on difficulty.
- **A browser-tier runtime proof of the translated path.** The composition lands here
  (decision 8); running it in a real tab needs the multi-browser standard recorded under
  WIRE-03 (`ROADMAP.md:465`) and belongs with that work.
- **Committing a lifted artifact as a fixture.** 5.66 MB of opaque binary; the repository
  already refuses this trade for the 659 KB lift subject (`lift.node.test.ts:1051-1056`).
  Reproduce from four lines of C instead.
- **Emitting the artifact CID into a machine-readable file** (`artifact.json` beside the
  `.wasm`). Useful for a build pipeline, asked for by no criterion.
</deferred>

## Risks — flagged, not resolved

**1. The guest criterion 3 needs does not exist, and this phase has to write it.** The
roadmap says "Research: None … the gap is that the lift pipeline never calls
`translationCid` and no production node builds a `WasiExecutor`". That is accurate about
those two gaps and silent about a third: *no lifted artifact in existence can complete a
job on this fabric.* The only one ever produced ends `not-dag-cbor` by construction
(`wasi-real.node.test.ts:29-37`), and that file states in its own words that closing this
"is a larger piece of work". Decision 9 proposes the cheapest closure — a stdio-free echo
in four lines of C — but it is new work with an unbounded failure mode: if the lifted
glibc startup path reaches one of the 174 untranslated addresses
(`lift.ts:14-18`), `elfconv_runtime_error` aborts and criterion 3 fails for a reason no
amount of fabric work fixes. The evidence that it will not is real but indirect: the
hello-world lift instantiated, ran `_start` to completion and wrote bytes
(`wasi-real.node.test.ts:147-171`), so the untranslated ifunc variants were not selected
under the emulated auxv. **Plan for the possibility that they are.** If the echo aborts,
the fallbacks in order are: drop to raw syscalls with no libc startup; try a smaller
input program; and if none works, report criterion 3 as *measured and not met*, with the
aborting address, rather than substituting a hand-written `.wat` fixture and calling it a
translated artifact.

**2. Criterion 1's emission half and all of criterion 3 need the 6.08 GB elfconv image.**
Every real-toolchain test in the repository is `it.skipIf(!HAVE_IMAGE)`
(`lift.node.test.ts:1012`), and `lift.ts:265-268` records that the driver deliberately
does not pull it. On a host without the image these criteria are **unmeasured, and
unmeasured is not met** — a skipped test that reports green is exactly the shape
`liftedArtifact` (`lift.node.test.ts:1031-1039`) exists to prevent, and the same care
applies here: a skip must be visible in the phase's verification record, and the
verification must state on which host the real run happened, with the artifact's sha256
and emitted CID written down so the run is auditable afterwards.

**3. Phase 13.1 is about to bound `readMessage`, and this phase introduces the largest
block the fabric has ever moved.** Decision 10 routes around it by pre-staging, which is
correct for the criterion but leaves an unanswered question — whether a 5.66 MB module
can be fetched from a peer at all — that the fabric will meet the first time anyone
dispatches a translated artifact they did not stage by hand. Measure it and hand the
number to Phase 13.1; do not let "the criterion passed" stand in for "the path works".

**4. Adding a router changes the executor every existing node composes.** Every module in
the repository today imports `o2.*` (`wasm.ts:4-9`, `demo/kernel.test.ts:116`), so the
predicate routes them all to the unchanged native path and behaviour should be identical
— but "should be" is how regressions arrive. The failure-string tests at
`wasm.test.ts:85/98/118/127` and `worker-executor.browser.test.ts:90` construct their
executors directly and are unaffected; the exposure is the node-level and end-to-end
suites, which reach `executor.execute` through `serveAgent` (`agent.ts:224`). Run the
full suite before and after, and pay attention to any test that asserts on a refusal
*reason*: the router reads `task.moduleCid` from the blockstore before either executor
does, so a missing module block will be reported by whichever component reads it first,
and that string must not change.

**5. `bin/bench.ts` constructs `WasmExecutor` directly at three sites**
(`packages/node/src/bin/bench.ts:146`, `:172`, `:352`) and does not go through
`FabricNode`. It therefore keeps the native-only path after this phase. That is correct —
the benchmark measures the native ABI deliberately — but it means one of the five
runnable entry points does not exercise the router, which Phase 22's reachability guard
will notice. Decide in the plan whether the router is reachable from `bin/agent.ts` alone
(it is) and record that answer, so Phase 22 does not rediscover it as a finding.
</content>
</invoke>
