# o2.services

A peer-to-peer compute fabric that runs both managed (WASM) and native code,
moves code to data (or data to code), keeps data on the owner's node for
sovereignty, and scales processing with the user base via massive task graphs.

> Design stage — no application code yet.

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
> **No outside contributions may be merged until a CLA is in place** — a
> contribution the licensor does not own cannot be relicensed commercially, which
> would break the dual-license model. See
> [LICENSE-COMMERCIAL.md](LICENSE-COMMERCIAL.md#contributions-and-the-right-to-dual-license).
