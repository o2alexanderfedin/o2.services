# The browser is the bootstrap; embedded native hosts are the target

**Owner statement, 2026-09-03:** *"we are discussing the browser only because it was the
fastest way to make everything work. In reality, devices will mostly run mobile applications
with an embedded O2 p2p node."*

## READ THIS FIRST — the questions below are open in this FILE, not in the project

**The owner has answers to every question raised here and deliberately did not write them into
the session that produced this document.** His reason, in his words: doing so *"starts to
constantly pollute the context"* — which is correct, and is the same discipline this repository
applies to everything else it refuses to carry twice.

So this file records **the questions and one measurement**, and nothing else. A future reader
must not read an unanswered question here as an unconsidered one. Where an answer belongs, a
slot is left for it; filling those slots is an owner act and is not urgent.

## This is not a change of direction

*"Embedded in a host application"* is already the third target in `PROJECT.md`'s own
constraints: TypeScript + WASM that *"runs unmodified in a browser tab, in Node.js, or embedded
in a host application"*, **without a separate build per target**. That property is why the stack
was chosen at all — it is the reason `Wasmtime`/`WasmEdge` are on the *"What NOT to Use"* list,
and the reason `@bjorn3/browser_wasi_shim` is used in Node as well as in the browser.

So the statement above does not redirect the project. It names which of the three declared
targets carries the load, and it makes the browser tier a **proving ground** rather than the
destination.

## The measurement, and it is the reason this file exists

Taken 2026-09-03 against this tree:

```
vitest projects:   aot, browser, e2e, node, perf      — five, and none of them the embedded target
package exports:   "." -> "./src/index.ts"            — for core, net, libp2p, browser and node
```

**The target the owner names as the real deployment is the one target nothing exercises**, and
the export-condition split `CLAUDE.md` describes in detail — *"the `browser` condition swaps
`blockstore-idb`/`datastore-idb` for `blockstore-fs`/`datastore-level` and drops `@libp2p/tcp`,
`@libp2p/mdns`, `@ipshipyard/libp2p-auto-tls`, `circuitRelayServer`"* — **is not declared in any
manifest**. Every package exports a bare `./src/index.ts` with no conditions at all.

That costs nothing today, because everything is built from source in one tree and the condition
never has to resolve. It stops costing nothing the moment the node is consumed as a package by
a host application, which is the deployment this file is about. `CLAUDE.md` also warns what the
failure looks like: *"Get this wrong and Vite will try to bundle `node:net` into the browser
build."*

**This is a finding about the tree, not a question for the owner.** It is actionable now and
belongs to whoever plans the embedded target.

## The questions, and the slots for their answers

### 1. Background execution — what the platform grants, per platform

Android's foreground service runs without a time bound, at the cost of a persistent
notification and, from Android 14, a declared service type. iOS grants background work at the
system's discretion — typically while charging and on Wi-Fi, in minutes rather than hours.
Neither is unlimited, and the two are not symmetric.

> **Owner's answer:** _(not recorded here — see the note at the top)_

### 2. Store review

An application whose stated purpose is to spend the device's processor on someone else's
computation sits near a boundary the stores police directly. The awareness is already
institutional here — `vocabulary.node.test.ts` exists because a reviewer greps rather than
reads, and it bans five patterns for that reason — but a guard over this repository's own text
says nothing about how a policy is applied to a shipped binary.

> **Owner's answer:** _(not recorded here)_

### 3. Acquisition

An install converts worse than a link, and this milestone already carries the precedent in the
other direction: SETI@home's move to BOINC lost roughly half of ~600 000 volunteers **to added
platform complexity alone**, with no bug and no bad actor. The browser tier's weakness is its
duty cycle; its strength is that a tap is the whole onboarding.

> **Owner's answer:** _(not recorded here)_

## The trade, stated so it is not re-derived

**Native raises the technical ceiling and lowers the acquisition ceiling. The browser does the
opposite.** A phone in a browser contributes while its screen is on — measured on the owner's
own device, `38-DEVICE-OBSERVATIONS.md` — and a phone running a native host is bounded by what
the operating system grants instead.

That is an argument for keeping **both** tiers rather than choosing, and it is already the
architecture: one codebase, three targets, no separate build. The browser tier is what the
current milestone measured; the embedded tier is what nothing measures yet.
