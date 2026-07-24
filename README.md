# o2.services

[Add project description here]

> Newly initialized repository — no application code yet.

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

[Add license information]
