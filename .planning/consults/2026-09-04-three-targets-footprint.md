# Codebase and shipped footprint across the three deployment targets — measured

**Date:** 2026-09-04
**Tree measured:** `409d46c20543a7fd0ccf631bcb6540ea0b0f2231` (`merge: 2.0.0-rc.12 — the funnel finds its collector, so a shared link is measured`, 2026-09-03 16:18:51 -0700)
**Where:** git worktree `/Volumes/ProjectsSSD/Projects/o2.services/.claude/worktrees/agent-a6159d60b8b009b7f`, branch `worktree-agent-a6159d60b8b009b7f`, working tree clean throughout.
**Host:** macOS 26.5.2, 8 logical CPUs, Node v23.11.0.

Every number below is a reading of **one tree at one moment**. Nothing here was deployed. The
only `wrangler` invocation is `deploy --dry-run`. The only network writes are none; three
read-only `GET`/`HEAD` requests were made against the already-published GitHub Pages site and
are reported as such.

---

## 0. Preconditions — the dependency set this was measured against

The brief permitted reusing the main checkout's `node_modules` **on condition that
`package-lock.json` is byte-identical between the worktree and the main checkout**. It is
**not**, so that condition is reported rather than silently passed.

```
$ shasum -a 256 package-lock.json && shasum -a 256 /Volumes/ProjectsSSD/Projects/o2.services/package-lock.json
6798c743f15e20e76a8ad7db13e3e3922103a311d072b793d8fa75ee2dc2d189  package-lock.json
e482ee648a27a9f199e214dfcf9b24b1552dc0048d0083f52f1f814d4570c1c0  /Volumes/ProjectsSSD/Projects/o2.services/package-lock.json
EXIT=0
```

The entire difference is three lines:

```
$ diff <worktree>/package-lock.json /Volumes/ProjectsSSD/Projects/o2.services/package-lock.json
3c3
<   "version": "2.0.0-rc.7",
---
>   "version": "2.0.0-rc.12",
9c9
<       "version": "2.0.0-rc.7",
---
>       "version": "2.0.0-rc.12",
6660a6661
>         "@noble/ciphers": "2.2.0",
DIFFEXIT=1
```

Read precisely:

1. The **committed** lockfile at `HEAD` says `2.0.0-rc.7` while the committed `package.json`
   says `2.0.0-rc.12`. That is a pre-existing staleness in the tree under measurement, not
   something the worktree introduced.
2. The main checkout's concurrent agent has promoted `@noble/ciphers` to a **direct** dependency
   of `packages/core`. `@noble/ciphers@2.2.0` was **already in this tree's lockfile** as a
   transitive dependency at the same version (`package-lock.json:2213`), so the promotion adds
   no package and changes no version.

The check that actually matters — is the *installed tree* the one this lockfile describes? — was
run against npm's own install record and is clean:

```
$ node -e '<compare packages{} of committed lock vs node_modules/.package-lock.json>'
packages in my lock: 488 in install record: 388
VERSION DRIFT: 0
IN LOCK NOT INSTALLED: 99      # all other-platform optionals: @esbuild/*, @img/sharp-*,
                               # @cloudflare/workerd-linux-*, @rollup/rollup-*, …
INSTALLED NOT IN LOCK: 0
EXIT=0
```

**Zero version drift on every package this tree references.** Measurement proceeded on that
basis; the delta is stated so the reader can apply their own strictness.

### The `node_modules` used, and how the worktree resolver trap was closed

`node_modules` in the worktree is a **selective symlink farm**, not a wholesale link: 246
per-entry symlinks into the main checkout's `node_modules`, plus a **real** `@o2/` directory
whose nine links point at *this worktree's* `packages/*`. A wholesale link would have made every
`@o2/*` import resolve into the main checkout — i.e. would have measured the other agent's tree.

```
$ readlink -f node_modules/@o2/core
/Volumes/ProjectsSSD/Projects/o2.services/.claude/worktrees/agent-a6159d60b8b009b7f/packages/core
$ readlink -f node_modules/vite
/Volumes/ProjectsSSD/Projects/o2.services/node_modules/vite
$ git status --porcelain
                                  # empty, before and after every build below
```

### Host conditions

Size measurements are load-independent and are the substance of this document. The two build
timings that appear are labelled with the load they were taken under. A third reading is given
because it changed dramatically and would invalidate any later timing:

| when | `uptime` load averages (1 / 5 / 15) |
|---|---|
| before the graph build and both bundle builds | `5.09 6.06 7.10` … `5.21 5.99 7.04` |
| after both bundle builds | `5.99 6.14 7.08` |
| at 15:40, while writing this | `56.30 33.08 18.29` |

**No timing figure taken after 15:33 appears in this document.** The project rule — never write a
measured span you did not measure, and record the conditions beside it — is why the third row is
here at all.

---

## 1. THE HEADLINE — how much code is shared across all three targets

### What was measured, and with what

Not directory names. The **import graph reachable from each target's real entry point**, computed
twice with two independent instruments that agree on 329 of 331 file/target pairs.

**Instrument A — the repository's own.** `packages/node/src/reachability.ts`'s `buildCallGraph()`,
traversing only its `imports` relation (file → file). It is the right instrument because it
already handles the two edge classes a naive resolver drops: Vite's `./x.ts?worker` suffix, and
`new URL('./x.ts', import.meta.url)` + `new Worker(ENTRY)`. Its corpus rule is `.ts` under
`packages/` and `tools/`, excluding `.d.ts`, `.test.ts`, and `node_modules`/`.git`/`dist`/
`coverage`/`.vite` — **209 production files**.

```
$ node --experimental-strip-types <scratch>/graph.ts
builtMs 1202 files 209
cloudflare 90
browser 136
node 105
node+bench 113
tools/aot 67
```

**Instrument B — a real bundler's value graph.** esbuild `0.28.1`, `bundle: true`,
`metafile: true`, every bare specifier that is not `@o2/*` marked external. Under this repo's
`verbatimModuleSyntax: true`, esbuild erases `import type` without resolving it, so its input
list is **what would actually ship**.

```
$ node <scratch>/esbuild-graph.mjs
cloudflare 90
browser 134
node 105
```

**The two instruments differ on exactly two files, both browser, both explained:**

```
$ node <scratch>/diff-graphs.mjs
== browser == repo=136 esbuild=134
 only in repo instrument: 2
    packages/browser/src/synthetic-artifact.ts
    packages/browser/src/tab-api.ts
 only in esbuild: 0
== cloudflare == repo=90 esbuild=90   (0 either way)
== node == repo=105 esbuild=105       (0 either way)
```

Both are reached **only through `import type`** — `streaming-load.ts:115` imports
`SyntheticShape` as a type; six `demo/surfaces/*.ts` files import `Tab*` types from
`src/tab-api.ts`. They are real source files with no runtime edge. The tables below use the
**esbuild value graph** as primary, because the question is about shipped code.

### Entry points used

| target | entries | why |
|---|---|---|
| **Cloudflare** | `packages/cloudflare/src/worker.ts` | `wrangler.jsonc`'s `"main"` |
| **Browser** | `demo/main.ts`, `demo/status.ts`, and the eight relative imports of the inline `<script type="module">` in `demo/index.html` (`nav.ts`, `render.ts`, `surfaces/{colouring,pi,primes,byo,fabric,bench}.ts`), plus `src/task-executor.worker.ts` for the `?worker` chunk | `vite.config.ts`'s `rollupOptions.input` names `index.html`, `policy.html`, `status.html`; `policy.html` contains **zero** `<script>` tags (`grep -c '<script' demo/policy.html` → `0`) |
| **Node** | `packages/node/src/bin/agent.ts`, `bin/seed.ts`, plus `src/task-executor.worker-thread.ts` for the `new URL` worker | as specified in the brief; `bin/bench.ts` footnoted below rather than folded in |

### The partition

```
$ node <scratch>/partition2.mjs esbuild
SOURCE: esbuild
bucket                      files    lines     bytes  lines%  files%
browser+cloudflare+node        75    31504   1542302    35.3    35.9
browser+cloudflare              0        0         0     0.0     0.0
browser+node                   16     3024    135950     3.4     7.7
cloudflare+node                 0        0         0     0.0     0.0
browser                        43    16920    834807    19.0    20.6
cloudflare                     15     4764    238693     5.3     7.2
node                           14     8425    450003     9.4     6.7
NONE                           46    24547   1257867    27.5    22.0
TOTAL                         209    89184   4459622

reachable from >=1 target: 163 files / 64637 lines
shared by all three as a share of THAT: 46.0% of files, 48.7% of lines

per-target reachable (files / lines / bytes):
  browser      134   51448  2513059 shared-share 61.2% of its lines
  cloudflare    90   36268  1780995 shared-share 86.9% of its lines
  node         105   42953  2128255 shared-share 73.3% of its lines
```

**Stated plainly.** Of the 163 production files that any deployment target actually reaches:

- **(a) reachable from all three — 75 files, 31 504 lines.** 46.0 % of reached files, **48.7 % of
  reached lines.** Just under half the code that ships anywhere ships everywhere.
- **(b) reachable from exactly two — 16 files, 3 024 lines, and the two are always
  *browser + Node*.** `browser+cloudflare` and `cloudflare+node` are **empty**. There is no
  pairwise sharing that excludes the browser or excludes Node; the only two-way overlap is the
  pair that runs guest WASM.
- **(c) reachable from exactly one — 72 files, 30 109 lines** (browser 43 / 16 920, node 14 /
  8 425, cloudflare 15 / 4 764).
- **(d) reachable from none — 46 files, 24 547 lines**, 27.5 % of the production corpus. This is
  the fourth bucket the directory-name assumption cannot see; §1.3 characterises it.

### 1.1 Which packages actually form the shared layer

The brief named `core`, `net`, `libp2p` and `bench` as candidates. Measured:

```
package -> bucket (files/lines):
  packages/aot           NONE:2f/177L    browser+node:5f/1859L
  packages/bench         NONE:9f/2534L
  packages/browser       NONE:5f/2179L   browser:43f/16920L
  packages/cloudflare    NONE:3f/321L    cloudflare:15f/4764L
  packages/core          NONE:2f/384L    browser+cloudflare+node:34f/17064L
  packages/demo          NONE:1f/455L    browser+node:11f/1165L
  packages/libp2p        browser+cloudflare+node:17f/5016L
  packages/net           browser+cloudflare+node:24f/9424L
  packages/node          NONE:14f/13816L node:14f/8425L
  tools/aot              NONE:9f/4465L
  tools/measure          NONE:1f/216L
```

- **`core` + `net` + `libp2p` = 34 + 24 + 17 = 75 files — exactly bucket (a).** The layering holds
  *precisely*: every file that all three reach lives in one of those three packages, and every
  file in `net` and `libp2p` is reached by all three. `core` has two exceptions
  (`executor/fixtures.ts`, `executor/task-worker.ts`) reached by no target.
- **`bench` is reached by none of the three targets.** All nine of its production files are in
  bucket (d). It is a candidate shared layer that no *deployment* entry point touches; it is
  entered by `bin/bench.ts`, which is a benchmark driver rather than a way the fabric is
  deployed. **Adding `bin/bench.ts` to the Node target moves 10 files** (`bench/src/{exclusion,
  harness,index,integrity,report,stats}.ts`, `core/src/executor/fixtures.ts`,
  `node/src/{bench-fabric,bench-inventory}.ts`, `node/src/bin/bench.ts`) from bucket (d) into
  node-only, taking Node's reach from 105 to 113 files. The all-three bucket does not move.
- **`aot` and `demo` are the browser+Node pair**, 16 files: `aot`'s WASI shim and ABI router,
  and the three demo workloads. The Cloudflare object runs no guest WASM, so it reaches neither.

### 1.2 A layering claim that survives, and one that does not

The `README.md` architecture table (`README.md:88-97`) is headed **"Eight workspace packages"**
and lists `core, net, libp2p, node, browser, aot, bench, demo`. There are **nine**, and the one
missing is **`@o2/cloudflare` — one of the three deployment targets this document measures.**
`ls packages/` returns `aot bench browser cloudflare core demo libp2p net node`.

### 1.3 What bucket (d) actually contains — 46 files, 24 547 lines

Not dead code. Enumerated:

| kind | files | examples |
|---|---|---|
| build-time toolchain | 10 | all of `tools/aot/*` (the elfconv lift CLI, docker gate, opcode scan) and `tools/measure/host-conditions-reporter.ts` |
| benchmark harness | 11 | all of `packages/bench/src/*`, `node/src/bench-{fabric,inventory}.ts` |
| test/fixture support reached only by specs | 9 | `core/src/executor/fixtures.ts`, `cloudflare/src/do-storage.fixture.ts`, `node/src/capability-fixture.ts`, `aot/src/fixtures/*`, `browser/src/capability-harness.ts` |
| the repository's own instruments | 5 | `node/src/reachability.ts`, `reachability-dispositions.ts`, `mutation-guard.mutate.ts`, `mutation-ledger.ts`, `strip-comments.ts` |
| **package barrels nothing deployed imports** | 2 | `packages/node/src/index.ts`, `packages/cloudflare/src/index.ts` — the `bin/` files and `worker.ts` import their siblings directly, so the published barrels are entered only by specs |
| build config | 1 | `packages/browser/vite.config.ts` (itself a build input, and imported by `demo-bench.e2e.test.ts`) |
| other | 8 | `browser/src/wasm-probes.ts`, `node/src/{commit-scope,demo-region-properties,e2e-browser-launch,local-acme,orphan-leash…}`, `demo/scripts/sign-kernel.ts` |

---

## 2. Source footprint — production and test, reported separately

Command: `node <scratch>/corpus.mjs` (walks `packages/` and `tools/`, same skip list as the
reachability instrument).

```
kind                  files     lines      bytes
d.ts                      4       145       6516
production              209     89184    4459622
test:browser             17      3679     171939
test:e2e                 62     29590    1429421
test:node               138     72928    3707810
test:perf                 1       122       6216
test:plain              116     49781    2172323
TEST TOTAL              334    156100    7487709
test:source ratio = 1.75:1 by lines, 1.60:1 by files

other:wat                14      1743      88181     # WebAssembly text sources
other:wasm               16       140      21882     # committed .wasm fixtures (binary; "lines" meaningless)
other:html                4      3346     190941
other:sh                  9      2904     137468
other:mjs                11       890      34088
other:css                 1       578      29401
```

**The test corpus is 1.75× the production corpus by line count and 334 files against 209.**
It is reported separately, never folded in, because folding it in would misdescribe the project.

Per package:

```
package                         prod f/L           test f/L   ratio
packages/aot                       7/2036            11/4160    2.04
packages/bench                     9/2534             6/1777    0.70
packages/browser                 48/19099            33/7592    0.40
packages/cloudflare               18/5085            26/7352    1.45
packages/core                    36/17448           37/19107    1.10
packages/demo                     12/1620             6/1308    0.81
packages/libp2p                   17/5016            14/3071    0.61
packages/net                      24/9424           30/16437    1.74
packages/node                    28/22241          158/87877    3.95
tools/aot                          9/4465            13/7419    1.66
tools/measure                       1/216                0/0    0.00
```

`packages/node` at **3.95:1** is where the suite actually lives — 158 of the 334 spec files are
there, because the `node` lane hosts the cross-package and cross-process guards.

Per-target production source **actually reached** (from §1): browser 134 files / 51 448 lines /
2 513 059 bytes; Cloudflare 90 / 36 268 / 1 780 995; Node 105 / 42 953 / 2 128 255.

---

## 3. Shipped bundle — browser

### The build

```
$ cd <worktree> && /usr/bin/time -p npx vite build --config packages/browser/vite.config.ts
15:32  up 11 days,  6:49, 23 users, load averages: 5.21 5.99 7.04
vite v8.1.5 building client environment for production...
✓ 730 modules transformed.
packages/browser/dist/status.html                                2.86 kB │ gzip:   1.38 kB
packages/browser/dist/policy.html                                9.86 kB │ gzip:   3.95 kB
packages/browser/dist/perf/index.html                           31.51 kB │ gzip:  10.22 kB
packages/browser/dist/assets/task-executor.worker-BGeg9x3I.js   46.41 kB
packages/browser/dist/index.html                               101.11 kB │ gzip:  24.52 kB
packages/browser/dist/assets/index-9IUIkw3l.css                 10.88 kB │ gzip:   2.93 kB
packages/browser/dist/assets/cid-BcLH9ugF.js                     0.05 kB │ gzip:   0.07 kB
packages/browser/dist/assets/src-i5XEW4Fk.js                     0.15 kB │ gzip:   0.14 kB
packages/browser/dist/assets/status-Bpmfp2A1.js                  4.83 kB │ gzip:   2.13 kB
packages/browser/dist/assets/cid-BXpsijIc.js                    12.84 kB │ gzip:   4.69 kB
packages/browser/dist/assets/src-BTE1dbav.js                   134.37 kB │ gzip:  41.55 kB
packages/browser/dist/assets/src-Du3LlYjV.js                   144.51 kB │ gzip:  49.56 kB
packages/browser/dist/assets/index-jXJKXCh1.js                 789.92 kB │ gzip: 237.92 kB
(!) Some chunks are larger than 500 kB after minification.
✓ built in 1.52s
real 2.19
user 1.22
sys 0.43
VITE_EXIT=0
15:32  up 11 days,  6:49, 23 users, load averages: 5.99 6.14 7.08
```

`(user+sys)/real` = **0.75** — the build is not CPU-saturated; it is a comparability key, not a
verdict.

### Per chunk: raw, gzip (zlib level 9), brotli (quality 11)

```
$ node <scratch>/sizes.mjs packages/browser/dist
file                                                  raw    gzip-9  brotli-11
assets/cid-BXpsijIc.js                              12844      4665       4266
assets/cid-BcLH9ugF.js                                 55        70         59
assets/index-9IUIkw3l.css                           10882      2922       2555
assets/index-jXJKXCh1.js                           789928    235289     178856
assets/src-BTE1dbav.js                             134372     41077      35693
assets/src-Du3LlYjV.js                             144510     49041      42485
assets/src-i5XEW4Fk.js                                156       141        107
assets/status-Bpmfp2A1.js                            4839      2138       1763
assets/task-executor.worker-BGeg9x3I.js             46411     15625      13835
index.html                                         101115     24277      20395
perf/index.html                                     31519     10132       8451
policy.html                                          9868      3925       3064
status.html                                          2867      1384       1092
TOTAL                                             1289366    390686     312621

by extension:
  .css          n=1      10882      2922       2555
  .html         n=4     145369     39718      33002
  .js           n=8    1133115    348046     277064
```

**Total emitted: 1 289 366 B raw / 390 686 B gzip-9 / 312 621 B brotli-11**, of which JS is
1 133 115 / 348 046 / 277 064 across 8 chunks.

### What a visitor actually pays

Total-emitted is not the answer, because no single page loads every chunk.

```
$ node <scratch>/page-cost.mjs
=== first load of index.html (5 referenced assets) ===
   index.html                                    101115    24277    20395
   assets/cid-BXpsijIc.js                         12844     4665     4266
   assets/index-9IUIkw3l.css                      10882     2922     2555
   assets/index-jXJKXCh1.js                      789928   235289   178856
   assets/src-BTE1dbav.js                        134372    41077    35693
   assets/src-Du3LlYjV.js                        144510    49041    42485
   TOTAL                                        1193651   357271   284250  = 348.9 KiB gzip / 277.6 KiB brotli
=== first load of status.html (4 referenced assets) ===
   TOTAL                                         299432    98305    85299  = 96.0 KiB gzip / 83.3 KiB brotli
=== first load of policy.html (0 referenced assets) ===
   TOTAL                                           9868     3925      3064 = 3.8 KiB gzip / 3.0 KiB brotli
deferred worker chunk: raw 46411, gzip 15625, brotli 13835
```

### The build measured here IS the published build — verified, not assumed

Three read-only `GET`/`HEAD` requests against `https://o2alexanderfedin.github.io/o2.services/`:

```
$ curl -sS -o live-index.html -w 'http=%{http_code} size_download=%{size_download}\n' https://o2alexanderfedin.github.io/o2.services/
http=200 size_download=101115
CURL_EXIT=0

$ grep -o '<meta name="o2-build" content="[^"]*"' live-index.html
<meta name="o2-build" content="2.0.0-rc.12 409d46c"
$ grep -o '<meta name="o2-build" content="[^"]*"' packages/browser/dist/index.html
<meta name="o2-build" content="2.0.0-rc.12 409d46c"

$ cmp live-index.html packages/browser/dist/index.html
CMP_EXIT=0
```

The live site's `index.html` is **byte-identical** to the build measured above, and the five
asset hashes it references are the five this build emitted. **The browser numbers in this
document are the shipped numbers, not a local approximation.** (This also retires
`README.md:20` — *"The deployed bundle predates Phase 9 … not on that URL"*. It is this commit.)

### On-the-wire cost, as GitHub Pages actually serves it

Brotli figures above are hypothetical for this deployment. Measured with
`Accept-Encoding: gzip, deflate, br, zstd`:

```
$ sh <scratch>/wire.sh
/                                              http=200 len=24988  enc=gzip
/assets/index-9IUIkw3l.css                     http=200 len=2941   enc=gzip
/assets/index-jXJKXCh1.js                      http=200 len=237237 enc=gzip
/assets/src-BTE1dbav.js                        http=200 len=41023  enc=gzip
/assets/src-Du3LlYjV.js                        http=200 len=49085  enc=gzip
/assets/cid-BXpsijIc.js                        http=200 len=4659   enc=gzip
/assets/task-executor.worker-BGeg9x3I.js       http=200 len=15579  enc=gzip
/status.html                                   http=200 len=1396   enc=gzip
/policy.html                                   http=200 len=3983   enc=gzip
/assets/status-Bpmfp2A1.js                     http=200 len=2146   enc=gzip
/perf/index.html                               http=200 len=10245  enc=gzip
EXIT=0
```

**GitHub Pages negotiates `gzip` and never `br`**, even when brotli is offered. So:

- **First load of the demo page over the wire: 24 988 + 2 941 + 237 237 + 41 023 + 49 085 +
  4 659 = 359 933 bytes = 351.5 KiB.** That is what a visitor on mobile data pays today.
- The 277.6 KiB brotli figure is **21 % smaller and is not currently obtainable on this host.**
  It is the number a brotli-serving host would give.
- The task-executor Worker chunk (15 579 B) is fetched only when a task runs.
- Whole site, all eleven assets: 393 282 B on the wire.

### Is the WASM in the bundle, or fetched from a gateway? — **both, and the demo path is inlined**

```
$ node <scratch>/wasm-in-bundle.mjs
kernel-bytes.ts    base64 chars   1600 -> wasm bytes   1200 magic 0061736d
primes-bytes.ts    base64 chars   1584 -> wasm bytes   1187 magic 0061736d
pi-bytes.ts        base64 chars    732 -> wasm bytes    549 magic 0061736d
kernel-bytes.ts    first 40 base64 chars found in dist chunks: index-jXJKXCh1.js
primes-bytes.ts    first 40 base64 chars found in dist chunks: index-jXJKXCh1.js
pi-bytes.ts        first 40 base64 chars found in dist chunks: index-jXJKXCh1.js

.wasm files emitted into dist: 0 []
```

- **Zero `.wasm` files are emitted.** All three demo kernels are base64 constants in
  `packages/demo/src/{kernel,primes,pi}-bytes.ts`, generated files, and they land inside the
  main chunk `index-jXJKXCh1.js`. Decoded total **2 936 bytes** of WebAssembly; as base64 in the
  bundle, 3 916 characters. `data-cost.ts:50-52` states the same thing from the other side —
  *"the artifact arrives with the page and not per run"*.
- The **general** artifact path does fetch over an IPFS path gateway
  (`packages/browser/src/streaming-load.ts#gatewayUrl`, reached from the browser entry), and
  `CLAUDE.md`'s claim is correct **for that path**. But the gateway base is a caller-supplied
  parameter, not a compiled-in constant: `grep -o 'https://[a-z0-9.-]*ipfs[a-z0-9./-]*\|dweb.link\|w3s.link' packages/browser/dist/assets/*.js`
  returns **nothing**. The published page therefore fetches no artifact from anywhere by default.

---

## 4. Shipped bundle — Cloudflare Worker

### The build (dry-run only; nothing deployed)

Invoked exactly as `packages/node/src/hosted-tier-deploy.node.test.ts:54-62` does, with
`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` and `CF_API_TOKEN` explicitly unset:

```
$ cd packages/cloudflare && WRANGLER_SEND_METRICS=false CI=1 \
    /usr/bin/time -p npx wrangler deploy --dry-run --outdir=<scratch>/cf-out
15:32  up 11 days,  6:49, 23 users, load averages: 5.00 5.98 7.04
 ⛅️ wrangler 4.125.0 (update available 4.129.0)
Total Upload: 1928.38 KiB / gzip: 426.06 KiB
Your Worker has access to the following bindings:
env.BOOTSTRAP (BootstrapObject)                    Durable Object
env.ANNOUNCE_MULTIADDRS ("/dns4/o2-bootstrap.af-4a0.workers.dev...")  Environment Variable
--dry-run: exiting now.
real 1.93  user 1.70  sys 0.53
WRANGLER_EXIT=0
15:32  up 11 days,  6:49, 23 users, load averages: 5.48 6.06 7.07

$ ls -l <scratch>/cf-out
-rw-r--r--  113      README.md
-rw-r--r--  1974664  worker.js
-rw-r--r--  5369528  worker.js.map
```

### Compressed, same instrument as the browser numbers

```
$ node <scratch>/sizes.mjs <scratch>/cf-out
file                    raw     gzip-9  brotli-11
worker.js           1974664     433971     303004
worker.js.map       5369528    1276189     898758

$ node -e '<gzip at levels 1/6/9>'
gzip level 1 528079
gzip level 6 436289
gzip level 9 433971
```

Wrangler's own `426.06 KiB` = 436 285 B, i.e. it reports **gzip at the default level 6**
(436 289 B here, a 4-byte difference from a different zlib build). Both are recorded so the two
figures cannot be mistaken for a discrepancy.

### The limit — and the brief's premise is out of date

The brief asked for the **compressed** limit for the paid plan. Cloudflare's live limits page
says there is no such limit any more. Fetched 2026-09-04 from
`https://developers.cloudflare.com/workers/platform/limits/index.md`:

> | Limit | Workers Free | Workers Paid |
> | Worker size (uncompressed) | 64 MiB | 64 MiB |
>
> "There is no compressed size limit. Only the uncompressed bundle size counts."
>
> "The `Total Upload` value is your uncompressed bundle size. The `gzip` value is shown for
> reference but is not a limit."
>
> | Startup time | 1 second |

A web search returned the **older** figures (3 MB free / 10 MB paid gzipped) from a stale index;
two independent fetches of the live page and its raw markdown agree with each other and are what
is recorded here.

**Headroom, against the limit that actually applies:**

| | bytes | |
|---|---:|---|
| this Worker, uncompressed | 1 974 664 | what wrangler calls `Total Upload` |
| limit (Free **and** Paid) | 67 108 864 | 64 MiB |
| **used** | | **2.94 %** |
| **headroom** | 65 134 200 | 62.11 MiB — a factor of **33.99×** |

The paid plan buys no extra size here; it is the same 64 MiB. **The binding constraint for this
Worker is the 1-second startup budget, not size** — a 1.97 MB bundle must parse and run its
global scope inside one second. That is **not measured in this document** (see §7).

Note also that the compressed figures are *informational*: gzip-9 433 971 B / brotli-11
303 004 B. The 5.37 MB source map is emitted beside the worker and is not part of the upload.

---

## 5. Node.js target — installed footprint (NOT comparable to §3 or §4)

**There is no bundle.** `README.md:63` runs the entry point as
`node packages/node/src/bin/seed.ts` — Node ≥ 22 strips the types itself; nothing is compiled,
nothing is minified, nothing is tree-shaken. So the figure below is **the whole dependency
closure as installed on disk**, which is a different quantity from a bundle in three ways: it is
uncompressed, it is untree-shaken, and it includes every file in each package (tests, source
maps, docs, per-platform prebuilds). **It is not comparable to the browser's 351.5 KiB or the
Worker's 1.97 MB and must not be quoted beside them as if it were.**

### `npm ls` is not a usable per-target instrument here — recorded rather than worked around

```
$ npm ls --omit=dev --all -w @o2/node
NPM_LS_EXIT=1
npm error code ELSPROBLEMS
npm error extraneous: @achingbrain/http-parser-js@0.5.9 …
```

Exit **1**, for all three workspaces. `--json` shows why: the tree it emits is rooted at
`o2-services`, not at the workspace, so it reports the whole hoisted root install and flags every
other workspace's dependency as extraneous.

```
node       unique dependency names in npm-ls tree: 809  | @o2/*: 7
browser    unique dependency names in npm-ls tree: 786  | @o2/*: 6
cloudflare unique dependency names in npm-ls tree: 790  | @o2/*: 4
   …of which 766 carry a `problems` entry
```

Three near-identical numbers for three different targets is the tell: it is not answering the
per-target question. The committed `package-lock.json` (lockfileVersion 3) was walked instead,
resolving each dependency by npm's own nesting rule (`node_modules/` upward from the requiring
package), following workspace links into their workspace entries.

### The closures

```
$ node <scratch>/closure.mjs

=== node (packages/node) ===
direct deps: 26  (of which @o2/*: 6)
transitive closure, external npm packages: 255
workspace packages in closure: aot, bench, core, demo, libp2p, net
on-disk bytes of the external closure: 73657581 (70.2 MiB) across 7577 files
heaviest:
   node-datachannel      9302013  8.87 MiB   @libp2p/kad-dht    4744593  4.52 MiB
   libp2p                2875148  2.74 MiB   @libp2p/webrtc     2221207  2.12 MiB
   @libp2p/http-utils    1919121  1.83 MiB   undici             1880876  1.79 MiB
   @noble/curves         1874513  1.79 MiB   axios              1867705  1.78 MiB
   @libp2p/circuit-relay-v2 1859871 1.77 MiB @libp2p/http       1714113  1.63 MiB
   node-forge            1647637  1.57 MiB   react-native-webrtc 1556248 1.48 MiB

=== browser (packages/browser) ===
direct deps: 17  (of which @o2/*: 5)
transitive closure, external npm packages: 191
workspace packages in closure: aot, core, demo, libp2p, net
on-disk bytes of the external closure: 55895964 (53.3 MiB) across 6045 files

=== cloudflare (packages/cloudflare) ===
direct deps: 16  (of which @o2/*: 2)
transitive closure, external npm packages: 125
workspace packages in closure: core, libp2p, net
on-disk bytes of the external closure: 40661975 (38.8 MiB) across 4423 files

external npm packages: union across three targets = 261, common to all three = 120
on-disk bytes common to all three: 37184254 (35.5 MiB)
```

**The Node target's installed footprint:** 105 production source files it actually reaches
(2 128 255 bytes of TypeScript, run as-is) **plus** a 255-package dependency closure occupying
**73 657 581 bytes / 70.2 MiB across 7 577 files**. The whole production source tree, for scale,
is 4 459 622 bytes — the dependencies are **16.5×** the entire first-party codebase.

**The Cloudflare closure (125 packages) is a strict subset of both others** — the "common to all
three" count is 120 and the difference is the five nested duplicates §6 describes. In dependency
terms the hosted tier asks for nothing the other two do not.

### Two entries worth naming in the *browser* closure

`node-datachannel` (8.87 MiB, the single heaviest package in the tree) and `react-native-webrtc`
(1.48 MiB) are in the **declared** closure of `@o2/browser`, pulled in by `@libp2p/webrtc`.
Neither is in the emitted browser bundle — Vite resolves the browser condition and drops both,
which is why 53.3 MiB of declared dependency compresses to 351.5 KiB on the wire. The declared
closure and the shipped bundle are answers to different questions, and the 165× ratio between
them is the honest illustration of that.

---

## 6. Dependency footprint — what is installed vs what the docs claim

### Direct dependencies, per target

| target | direct deps | of which `@o2/*` | transitive external | on-disk |
|---|---:|---:|---:|---:|
| `@o2/node` | 26 | 6 (`aot bench core demo libp2p net`) | 255 | 70.2 MiB |
| `@o2/browser` | 17 | 5 (`aot core demo libp2p net`) | 191 | 53.3 MiB |
| `@o2/cloudflare` | 16 | 2 (`libp2p net`) | 125 | 38.8 MiB |

`@o2/cloudflare` never names `@o2/core` directly; it reaches all 34 of core's shared files
transitively through `@o2/libp2p` and `@o2/net`.

### `.planning/research/STACK.md` vs the installed tree

Every table row in that file carrying a *package name* and a *version* was checked against the
installed `package.json`:

```
$ node <scratch>/stackcheck.mjs .planning/research/STACK.md
rows with a package+version pair: 55 — agree 25, disagree 1, absent 29
```

- **25 agree exactly** — `libp2p@3.3.6`, `@libp2p/{websockets@10.1.17, webrtc@6.0.27,
  circuit-relay-v2@4.2.9, identify@4.1.10, ping@3.1.9, kad-dht@16.4.0, tcp@11.0.24,
  crypto@5.1.21, utils@7.3.0, peer-id@6.0.12, logger@6.2.10, interface@3.2.5}`,
  `@chainsafe/{libp2p-noise@17.0.0, libp2p-yamux@8.0.1}`, `@multiformats/{multiaddr@13.0.3,
  multiaddr-matcher@3.0.2}`, `multiformats@14.0.5`, `uint8arrays@6.1.1`,
  `@noble/{hashes,curves}@2.2.0`, `@bjorn3/browser_wasi_shim@0.4.2`, `typescript@7.0.2`,
  `vite@8.1.5`, `vitest@4.1.10`.
- **1 disagrees:** `tinybench` — the doc says `6.1.2`; installed is **`2.9.0`**, and it is not a
  manifest dependency of anything here. It is a transitive of `vitest`. The recommendation was
  never adopted.
- **29 are recommended and not installed at all:** the entire Helia/content-addressing block
  (`helia`, `@helia/{unixfs,bitswap,libp2p,http,car,dag-cbor,delegated-routing-client,
  delegated-routing-v1-http-api-client,fallback-router}`, `blockstore-{idb,fs,core}`,
  `datastore-{idb,level}`), plus `@libp2p/{tls,dcutr,bootstrap,mdns,upnp-nat,gossipsub,perf,
  memory,echo}`, plus `binaryen`, `wasm-feature-detect`, `comlink`, `tsdown`,
  `rolldown-plugin-dts`. That is a research document listing a candidate stack, not a manifest —
  but a reader taking any of those rows as a statement about this tree would be wrong 29 times.

### A stale row in `CLAUDE.md`, and a duplication the tree is still carrying

`CLAUDE.md`'s libp2p module table gives `@libp2p/keychain 6.1.4`. That matches the **hoist
root** and contradicts the **manifests**, which pin `6.1.6` in both `packages/node/package.json`
and `packages/cloudflare/package.json`. The consequence is measurable:

```
$ node -e '<enumerate lock entries by package name>'
packages present at more than one path: 18
@libp2p/crypto    -> 5.1.21 @ node_modules/…  |  5.1.23 @ packages/cloudflare/node_modules/…  |  5.1.22 @ packages/node/node_modules/…   <-- DIFFERENT VERSIONS
@libp2p/interface -> 3.2.5  @ node_modules/…  |  3.3.0  @ packages/cloudflare/node_modules/@libp2p/crypto/node_modules/@libp2p/interface  <-- DIFFERENT VERSIONS
@libp2p/keychain  -> 6.1.4  @ node_modules/…  |  6.1.6  @ packages/cloudflare/node_modules/…  |  6.1.6 @ packages/node/node_modules/…     <-- DIFFERENT VERSIONS
protons-runtime   -> 5.6.0  @ node_modules/…  |  7.0.0 × 11 nested copies                                                                <-- DIFFERENT VERSIONS
uint8arraylist    -> 2.4.9  @ node_modules/…  |  3.0.2 × 24 nested copies                                                                <-- DIFFERENT VERSIONS
(+ 13 more: @jridgewell/trace-mapping, @peculiar/x509, buffer, debug, fsevents, ms, nanoid,
   readable-stream, supports-color, tslib, uint8-varint, undici, ws)
```

`CLAUDE.md` names **exactly three** packages as *"the three `develop` was already carrying
silently"* — `@libp2p/crypto`, `@libp2p/interface`, `@libp2p/keychain`. **All three are still
duplicated on this tree**, and `@libp2p/crypto` is at *three* versions rather than two. The
`@libp2p/interface@3.3.0` copy nested under `packages/cloudflare/node_modules/@libp2p/crypto/`
is the same duplicated-type-vocabulary shape that document describes as the reason the family
bump was attempted — the bump was reverted for a measured integrity failure, and the duplication
it was meant to remove is what remains. Nothing here says the revert was wrong; it says the
cost is still being paid and is measurable.

---

## 7. Runtime footprint — only where it could be measured honestly

**Egress, browser tier, one representative task: `DISCLOSED_DATA_COST_BYTES = 11_000` bytes**
(`packages/browser/src/data-cost.ts:67`).

What it is: a hand-typed literal inside the measured spread of three runs of
`colouring-demo.e2e.test.ts`'s DEMO-01 case on 2026-09-02 — 11 387 / 10 971 / 11 387 bytes over
22 / 18 / 22 egress entries, two browser tabs on one machine, `n = 204` over 8 cubes at
redundancy 2, dispatched from one tab to one peer over a loopback relay. It is deliberately not
computed from the run it is checked against.

What it counts: **what actually left the device.** `EgressManifest.totalBytes`
(`packages/net/src/egress.ts:43-66`) — every frame this node sent; a refused frame contributes
zero because it did not leave.

What it does **not** count, stated in the source rather than inferred:

- **The inbound leg.** A visitor on mobile data pays both directions; nothing on that page
  measures bytes in. `TabActivity.fetched` counts *blocks*, not bytes.
- **The page itself.** The WebAssembly module arrives inside the page bundle (§3), not once per
  run, so counting its 1 200 bytes here would double-count a page load.

**Not measured, and not estimated:**

- **Resident memory of any tier.** Would require running a load or deploying. No figure is given.
- **Cloudflare Worker startup time against the 1-second budget.** This is the limit that actually
  binds a 1.97 MB Worker, and measuring it requires a deploy, which the brief forbids and which
  is an owner act by the 2026-08-25 ruling.
- **Durable Object storage or wall-clock cost.** Same reason.
- **Whether the 351.5 KiB first load parses and initialises within any budget on a real phone.**
  Not attempted.

---

## 8. Everything that could not be measured, and why

| gap | why |
|---|---|
| Resident memory, any tier | needs a running load or a deploy; estimating it would be inventing a number |
| Worker startup time vs the 1 s limit | needs a deploy |
| Brotli on the live browser bundle | GitHub Pages negotiates gzip only; the brotli column is what a brotli-serving host *would* give, measured locally |
| Any post-15:33 timing | host load went from 5.09 to 56.30 while this was written; no span taken under those conditions is reported |
| `npm ls --omit=dev` as a per-target closure | exits 1 with `ELSPROBLEMS` and reports the hoisted root tree, not the workspace (§5). The lockfile walk was used instead and is what the numbers come from |
| Test-lane runtimes | the brief forbids running them, and the main checkout's agent was building |
| Whether `@o2/bench` is reachable from a *deployment* by some path not through `bin/bench.ts` | not searched exhaustively; measured only that none of the three deployment entry points reaches it |
| Deployed Cloudflare Worker's real size on Cloudflare's side | only the local dry-run bundle was measured; no API call was made |

---

## 9. Reproducing this

Scratch scripts live in this session's scratchpad, not in the tree. Each is small enough to
restate:

| step | command |
|---|---|
| lockfile check | `shasum -a 256 package-lock.json`; compare `packages{}` of the committed lock against `node_modules/.package-lock.json` |
| module graph A | `node --experimental-strip-types` a script calling `buildCallGraph({root})` from `packages/node/src/reachability.ts` and `reachableFrom(graph.imports, entries)` per target |
| module graph B | `esbuild.build({ bundle:true, metafile:true, entryPoints, plugins:[externalise-non-@o2] })`, take `Object.keys(metafile.inputs)` |
| partition | bucket all 209 corpus files by which of the three reachable sets contain them; sum `split('\n').length` and `Buffer.byteLength` |
| browser build | `npx vite build --config packages/browser/vite.config.ts` |
| Cloudflare build | `cd packages/cloudflare && WRANGLER_SEND_METRICS=false CI=1 npx wrangler deploy --dry-run --outdir=<tmp>` |
| compression | `zlib.gzipSync(buf,{level:9})`, `zlib.brotliCompressSync(buf,{ BROTLI_PARAM_QUALITY:11, BROTLI_PARAM_SIZE_HINT:buf.length })` |
| closures | walk `package-lock.json` `packages{}` by npm's nesting rule from each workspace entry; `stat` every file under each closure member excluding nested `node_modules` |
| live check | `curl -sS -I -H 'Accept-Encoding: gzip, deflate, br, zstd' <url>` — read-only |
