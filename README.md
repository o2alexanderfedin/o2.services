# o2.services

A peer-to-peer compute fabric that runs both managed (WASM) and native code,
moves code to data (or data to code), keeps data on the owner's node for
sovereignty, and scales processing with the user base via massive task graphs.

**Live:** <https://o2alexanderfedin.github.io/o2.services/>

That page is a real node — but it cannot join anything on its own, and it says
so. A browser cannot accept incoming connections, so two tabs need a publicly
reachable [Circuit Relay v2](https://github.com/libp2p/specs/blob/master/relay/circuit-v2.md)
peer to exchange WebRTC signalling, and GitHub Pages runs no server process.
Supply one with `?relay=<multiaddr>`.

To see it actually work, run a seed on your own machine and open the URL it
prints — including from a phone on the same network:

```bash
node packages/node/src/bin/seed.ts
```

It prints a `.local` URL and a QR code. The page then asks its own origin which
relay to dial, so nothing needs configuring.

## Status

Phases 1 and 2 complete, Phase 3 (browser tier) mostly complete. 274 tests
across Node, Chromium, and end-to-end browser runs. What is demonstrated:

- a redundant, verified map job running in one process on Node, in a browser,
  and in a Worker;
- the same job across two OS processes over TCP, with the kernel byte-for-byte
  unchanged because only adapters were swapped;
- two browser tabs completing a 2×-redundant job over a **direct** WebRTC
  connection, with the relay proven to be out of the data path;
- IndexedDB and filesystem blockstores producing identical CIDs;
- 16 browser peers holding relay reservations simultaneously.

Not yet done: peers on genuinely different machines over the public internet,
which needs a hosted relay with automatic TLS.

## Documentation

| Document | Contents |
| -------- | -------- |
| [P2P Native Cloud — Master Architecture Design](docs/p2p-native-cloud-design.md) | Part I: the execution substrate (native→WASM AOT, artifact caching). Part II: the P2P fabric (trust topology, scheduling, map/reduce, sovereignty). |

## Setup

```bash
git clone https://github.com/o2alexanderfedin/o2.services.git
cd o2.services
```

## Development

This project uses [git-flow](https://github.com/nvie/gitflow) (v0.4.1).

| Branch      | Purpose                 | `git flow` subcommand |
| ----------- | ----------------------- | --------------------- |
| `main`      | Production releases     | —                     |
| `develop`   | Development integration | —                     |
| `feature/*` | New features            | `feature`             |
| `release/*` | Release preparation     | `release`             |
| `hotfix/*`  | Production fixes        | `hotfix`              |
| `support/*` | Long-lived support      | `support`             |

`bugfix/*` is also accepted by the hook, but has no `git flow` subcommand in
v0.4.1 — create it manually, or upgrade to
[gitflow-avh](https://github.com/petervanderdoes/gitflow-avh)
(`brew install git-flow-avh`) which adds `git flow bugfix`.

`main` and `develop` are protected by a `pre-commit` hook — direct commits are
rejected. All work goes through a branch:

```bash
git flow feature start <feature-name>
# make changes, commit
git flow feature finish <feature-name>
```

Releases and hotfixes follow the same pattern:

```bash
git flow release start <version>
git flow hotfix start <version>
```

### Hook installation

Git hooks live in `.git/hooks/` and are **not** cloned. After cloning, install
the branch-protection hook:

```bash
./scripts/install-hooks.sh
```

## License

**Dual-licensed**, source-available, **not** open source. The default track
applies automatically; the commercial track requires a signed agreement. You
cannot elect between them.

| | [Default](LICENSE) | [Commercial](LICENSE-COMMERCIAL.md) |
| --- | --- | --- |
| Applies to | everyone, automatically | signed parties only |
| View source | ✅ | ✅ |
| Commercial trial evaluation | ✅ up to 32 days | ✅ |
| Use beyond trial / production | ❌ | ✅ negotiated |
| Modification | ❌ | ✅ negotiated |
| Derivative works | ❌ | ✅ negotiated |
| Redistribution / embedding | ❌ | ✅ negotiated |
| Patent rights | ❌ reserved | ✅ negotiated |
| Support, SLA, indemnity | ❌ | ✅ negotiated |

Commercial licensing: **af@O2.services**

> **Draft — not reviewed by counsel.** Do not rely on either license, execute a
> commercial agreement, or make this repository public before an attorney
> reviews them.
>
## Contributions

**Not accepted.** Pull requests will be closed without review — see
[CONTRIBUTING.md](CONTRIBUTING.md). This keeps the dual-license model intact by
construction: the licensor owns every right in the software, so the commercial
track stays available for all of it.

Bug reports are welcome as issues. Security reports go to **af@O2.services**.
