# Phase 2 — Real Network, Node ↔ Node

**Status:** complete
**Requirements:** NET-01, NET-07
**Branch:** `feature/phase-2-real-network`

## Goal

The same job runs across two real operating-system processes over a real network
transport, proving the port boundary was drawn in the right place.

## Result

All three success criteria met, each verified rather than asserted.

| Criterion | Verification |
|---|---|
| 1. Two processes complete a 2×-redundant map job over a real transport, blocks on the wire, **kernel byte-for-byte unchanged** | `two-process.node.test.ts` — 4 shards at R=2, both replicas in separate child processes. `git diff develop -- packages/core` empty |
| 2. Results persist to a filesystem blockstore, retrievable by CID from the other process, survive a restart | `fabric-node.node.test.ts` + `two-process.node.test.ts` — worker process killed, its directory reopened from another process, module retrieved by the CID the submitter computed |
| 3. Constants-regression test on relay/transport limits; every libp2p dependency pinned exact | `constants.node.test.ts` — 6 tests, values read out of the installed packages |

```
tsc --noEmit  clean
206 tests     node 112 (core 74 + net 19 + node-only 19)
              chromium 94 (core 74 + net 19 + worker 1)
```

## The architectural answer

`submitJob` takes `Executor[]` and cannot tell where one runs. So "real network"
needed no kernel change at all — only a `RemoteExecutor` that implements the same
interface and happens to cross a wire. Redundancy, commit-reveal, and verification
are untouched. That is the entire content of criterion 1, and it held.

Packages were split on the portability line, not the feature line:

- **`@o2/net`** — portable. RPC correlation, the agent protocol, block fetching,
  `RemoteExecutor`. No platform imports. Its 19 tests run in Node *and* in real
  Chromium, so remote execution is already proven portable ahead of Phase 3.
- **`@o2/node`** — Node-only. libp2p over TCP, filesystem blockstore, the agent
  process. Everything a browser structurally cannot do.

## Decisions

- **One stream per message.** Each `send` opens a stream, writes, closes write.
  Completion is signalled by the readable end ending, so there is no length prefix
  and no framing state machine — the bug class is designed out rather than tested
  for. yamux makes streams cheap on an established connection.
- **Chunked at 16 KiB even on TCP**, and `runOnLimitedConnection: true`. Both cost
  nothing now and mean the same code path survives being relayed to a browser in
  Phase 3 instead of needing a second framing path.
- **Request/response lives in `@o2/net`, not in the `Transport` port.** `Transport`
  stays a one-way datagram shape because that is the smallest thing every candidate
  transport — in-process table, libp2p stream, relayed WebRTC channel — can
  implement.
- **A fetched block is verified against the CID that was requested.** Content
  addressing is only a security property if checked; without it any peer could
  answer a module request with arbitrary code.
- **Concurrent fetches for one CID collapse.** Every shard needs the same module and
  shards run concurrently, so the naive version pulls it once per shard per replica.
- **`FsBlockstore` mirrors `MemoryBlockstore`'s CID scheme exactly**, including its
  use of the dag-cbor codec for raw WASM bytes. Mirroring rather than correcting is
  deliberate — a persisted block must hash to the CID the kernel computed, and the
  kernel was not being modified. Proper codec distinction belongs with artifact
  signing (Phase 4).
- **A network failure is a failed executor, not a thrown job.** An unreachable
  volunteer node is the normal case; verification already reports achieved
  redundancy honestly (`replicas: 1`) rather than claiming agreement it did not get.

## Problems found and fixed

1. **Two duplicate dependency resolutions**, both of them the traps `STACK.md`
   warned about. `multiformats` resolved to *both* 14.0.5 and 13.4.2 — a v13/v14
   boundary makes `CID instanceof` fail silently across package boundaries — and an
   invalid `uint8arrays@5.1.1` sat hoisted above the 6.1.1 libp2p v3 requires.
   Fixed with npm `overrides`, which required a **clean re-resolution**: `npm
   install` alone kept the stale tree and reported nothing. A test now asserts one
   copy of each, resolved from four distinct points in the tree.

2. **The relay constant names in the project docs are wrong.** They are
   `DEFAULT_DURATION_LIMIT`, `DEFAULT_DATA_LIMIT`, and
   `DEFAULT_MAX_RESERVATION_STORE_SIZE` — all `DEFAULT_`-prefixed. The *values* in
   the docs are right (2 min, 128 KiB, 15, 2 h). Neither `@libp2p/circuit-relay-v2`
   nor `@libp2p/webrtc` re-exports its constants, so the regression test resolves
   the module relative to the package entry and imports it by file URL.

3. **A bad type assertion of mine.** `spawn` with `stdio: ['ignore','pipe','pipe']`
   returns `ChildProcessByStdio<null, Readable, Readable>`; I had cast it to
   `ChildProcessWithoutNullStreams`. Replaced with the correct type — assertions are
   forbidden by the project rules for exactly this reason.

## Anti-pattern check

The handoff warned that Phase 1 was lost to *prediction instead of detection* and to
*reimplementing the platform*. Two places this phase could have repeated it:

- Framing was nearly a length-prefixed parser. Letting stream close signal
  completion removed the need entirely.
- `purity.node.test.ts` could have been a lint rule reimplementing module
  resolution. It reads import specifiers and compares them to a list — and it was
  **verified to fail on a planted violation** before being trusted, which is the
  step Phase 1's opcode table skipped.

## Carried forward

- **Discovery is still an explicit dial** to an announced multiaddr. Phase 6 removes
  the static peer list; NET-01 does not require discovery.
- **`FetchingBlockstore.has()` is local-only** by design. A version that dialled
  peers would turn a cheap availability check into a round trip.
- **Node 23.11.0 is in use, which is not an LTS release** and is outside vitest's
  declared range (`^20 || ^22 || >=24`). Every install prints `EBADENGINE`. The
  suite passes and `bin/agent.ts` relies on Node's native type stripping, which is
  flagged experimental. `STACK.md` specifies Node 24 LTS. Not fixed here — changing
  the host toolchain is the user's call.
