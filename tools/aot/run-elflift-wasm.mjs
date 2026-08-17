// Run `elflift.wasm` — step 3 of the four AOTW-06 needs.
//
//   1. compile every translation unit for wasm32-wasi   DONE (elflift-wasi-port.sh, 27/27)
//   2. link them into one .wasm                          DONE (link-elflift-wasm.sh)
//   3. run it and get bitcode out                        THIS FILE
//   4. compare that bitcode against native elfconv's     the acceptance test
//
// ## Why @bjorn3/browser_wasi_shim and not node:wasi
//
// The repository's stack decision is explicit about this: `node:wasi` gives *different host
// semantics from the browser*, which is a determinism bug by construction, and the whole point
// of AOTW-06 is that translation becomes a job any fabric node can run — a browser tab
// included. A pure-JS shim runs the same on both, so a lift performed here and a lift
// performed in a tab see the same filesystem, the same clock and the same argv.
//
// ## The filesystem this hands the module
//
// Everything is in memory. The module gets one preopened directory holding the input ELF, and
// writes its bitcode back into the same directory, from which this reads it out. No host path
// is exposed — which is also what makes the run reproducible.
//
// Usage:
//
//   node tools/aot/run-elflift-wasm.mjs --help
//   node tools/aot/run-elflift-wasm.mjs --elf <path> --out <path> [--arch aarch64]
//                                       [--semantics <aarch64.bc>]
//
// ## The semantics bitcode
//
// remill lifts through a bitcode file describing the source ISA's instruction semantics, and
// `Util.cpp` finds it by searching paths baked in at compile time — which here are paths
// inside the container elfconv was built in: `/root/elfconv/build/.../AArch64/Runtime`,
// `/usr/local/share/remill/16.0/semantics`, and so on. None of them exist in this sandbox.
//
// `Lift.cpp` provides the way out through `--bitcode_path`, and its name is misleading in a
// way that cost a run: it is not a path to the bitcode file. `LoadArchSemantics` passes it
// through as a `sem_dirs` entry, and `_FindSemanticsBitcodeFile` then looks for
// `<dir>/<arch>.bc` inside it. So what goes in is the DIRECTORY, and the file has to be named
// for the architecture — `aarch64.bc`, not whatever the host called it. Both are arranged
// below, which is why the mounted name is derived from `--arch`.
//
// Exit codes: 60 module missing, 61 input ELF missing, 62 the module trapped,
// 63 the module exited non-zero, 64 it exited 0 but produced no bitcode,
// 65 semantics file missing.

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { argv, exit, hrtime } from 'node:process'
import {
  WASI,
  File,
  OpenFile,
  ConsoleStdout,
  PreopenDirectory,
  WASIProcExit
} from '@bjorn3/browser_wasi_shim'

const DEFAULT_MODULE = '/Volumes/ProjectsSSD/o2-wasi-llvm/elflift.wasm'

function parseArgs (raw) {
  const out = { module: DEFAULT_MODULE, arch: 'aarch64', targetArch: 'wasi32', passthrough: [] }
  for (let i = 0; i < raw.length; i++) {
    const a = raw[i]
    if (a === '--module') out.module = raw[++i]
    else if (a === '--elf') out.elf = raw[++i]
    else if (a === '--out') out.out = raw[++i]
    else if (a === '--arch') out.arch = raw[++i]
    else if (a === '--semantics') out.semantics = raw[++i]
    else if (a === '--target-arch') out.targetArch = raw[++i]
    else out.passthrough.push(a)
  }
  return out
}

const opts = parseArgs(argv.slice(2))

if (!existsSync(opts.module)) {
  console.error(`no module at ${opts.module} — run tools/aot/link-elflift-wasm.sh first`)
  exit(60)
}

// The in-memory working directory the module will see as its only filesystem.
const dir = new Map()

// elflift names its input and output through flags, so the names inside the sandbox are ours
// to choose. Short ones keep the argv unambiguous in a log.
const IN_NAME = 'in.elf'
const OUT_NAME = 'out.bc'


let wasmArgs
if (opts.elf === undefined) {
  // No input: pass whatever was given straight through. `--help` lands here, and so does any
  // hand-run diagnostic — this is the arm that answers "does the module execute at all".
  wasmArgs = ['elflift', ...opts.passthrough]
} else {
  if (!existsSync(opts.elf)) {
    console.error(`no input ELF at ${opts.elf}`)
    exit(61)
  }
  dir.set(IN_NAME, new File(readFileSync(opts.elf)))
  wasmArgs = [
    'elflift',
    `--arch=${opts.arch}`,
    `--target_elf=/work/${IN_NAME}`,
    `--bc_out=/work/${OUT_NAME}`,
    `--target_arch=${opts.targetArch}`
  ]
  if (opts.semantics !== undefined) {
    if (!existsSync(opts.semantics)) {
      console.error(`no semantics bitcode at ${opts.semantics}`)
      exit(65)
    }
    // The name is not cosmetic: remill searches the directory for `<arch>.bc`.
    dir.set(`${opts.arch}.bc`, new File(readFileSync(opts.semantics)))
    wasmArgs.push('--bitcode_path=/work')
  }
  // glog otherwise tries to open a log file under a directory that does not exist in the
  // sandbox and prints four lines of COULD NOT CREATE A LOGGINGFILE before continuing.
  // Sending its output to stderr is both quieter and the right destination here — there is
  // nowhere for a log file to usefully persist.
  wasmArgs.push('--logtostderr=1')
  wasmArgs.push(...opts.passthrough)
}

const stdoutLines = []
const stderrLines = []

const fds = [
  new OpenFile(new File([])), // stdin: empty, never read
  ConsoleStdout.lineBuffered(line => { stdoutLines.push(line); console.log(line) }),
  ConsoleStdout.lineBuffered(line => { stderrLines.push(line); console.error(line) }),
  new PreopenDirectory('/work', dir)
]

const wasi = new WASI(wasmArgs, [], fds)

console.error(`argv: ${wasmArgs.join(' ')}`)

const bytes = readFileSync(opts.module)
const module_ = await WebAssembly.compile(bytes)
const instance = await WebAssembly.instantiate(module_, {
  wasi_snapshot_preview1: wasi.wasiImport
})

const startedAt = hrtime.bigint()
let code = 0
try {
  wasi.start(instance)
} catch (err) {
  if (err instanceof WASIProcExit) {
    // The shim reports a normal exit() by throwing. This is not a failure path.
    code = err.code
  } else {
    console.error(`the module trapped: ${err?.message ?? err}`)
    exit(62)
  }
}
const elapsedMs = Number(hrtime.bigint() - startedAt) / 1e6

console.error(`exit=${code}  elapsed=${elapsedMs.toFixed(0)}ms`)

if (opts.elf === undefined) exit(code)

if (code !== 0) {
  console.error(`elflift exited ${code}`)
  exit(63)
}

const produced = dir.get(OUT_NAME)
if (produced === undefined || produced.data.length === 0) {
  // elfconv's own driver never trusts this program's exit code — it exits 0 on binaries it
  // could not fully translate. So the check is that a module came out, not that it said so.
  console.error('elflift exited 0 and wrote no bitcode')
  exit(64)
}

if (opts.out !== undefined) {
  writeFileSync(opts.out, produced.data)
  console.error(`wrote ${produced.data.length} bytes to ${opts.out}`)
} else {
  console.error(`produced ${produced.data.length} bytes of bitcode (pass --out to keep it)`)
}
