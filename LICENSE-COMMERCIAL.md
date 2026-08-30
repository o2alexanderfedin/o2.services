# Commercial License — O2.services

**Draft — not reviewed by counsel. Do not execute without an attorney review.**

The software in this repository is **dual-licensed**:

| Track | Terms | Who it applies to |
| ----- | ----- | ----------------- |
| **Default** | [LICENSE](LICENSE) — **AGPL-3.0-or-later**. Free. Use, modify and redistribute, provided §5 and §13 are honoured | Everyone, automatically |
| **Commercial** | This document, executed as a signed agreement | Only parties who sign |

The default track applies to you unless and until you sign a commercial
agreement. This is **not** a choice-of-license offer — you cannot elect the
commercial track unilaterally.

**CHANGED 2026-08-30.** Until that date the default track was the *O2.services
Source-Available Trial License 1.0* — view only, 32-day evaluation, no
modification and no redistribution — preserved at
[LICENSE-TRIAL-1.0.md](LICENSE-TRIAL-1.0.md). Anyone who accepted those terms
keeps them. Everything below was rewritten for the AGPL, because under the trial
licence almost every ordinary use needed an agreement and under the AGPL almost
none does. See [LICENSING.md](LICENSING.md).

---

## Why the commercial track exists

**Not to grant permission to use the software.** The AGPL already does that, at
no cost, including in production and including modification and redistribution.
Anyone who reaches for this document because they think they need permission to
*use* o2.services does not need it.

The commercial track exists to **release a licensee from the AGPL's two
obligations**, and for the things the AGPL expressly declines to provide:

- **AGPL §13, remote network interaction.** If you modify the software and let
  users interact with your modified version over a network, §13 entitles those
  users to your modified source. A commercial licence removes that obligation.
  This is the single most common reason to sign one.
- **AGPL §5, copyleft on distribution.** If you distribute a modified version,
  §5 requires it to be licensed under the AGPL as a whole. A commercial licence
  lets you distribute or embed it under your own terms.
- **Warranty, SLA, indemnification.** AGPL §§15–17 disclaim all of these
  absolutely. Only a signed agreement can supply them.
- **A patent position narrower or wider than §11's.** §11 already grants every
  AGPL recipient a licence to the licensor's patent claims covering the
  software; a commercial agreement can define scope, field of use and defensive
  terms explicitly rather than by statute.

Being a node in the public fabric triggers none of this. A volunteer running the
browser client is a *user* of the fabric and never a provider of it, so §13 does
not reach them and they need no agreement.

## What a commercial agreement can grant

Grants are negotiated per deal. The licensor may extend any subset of:

| Right | Notes |
| ----- | ----- |
| Production use | Scoped by seats, nodes, sites, or revenue band |
| Term | Perpetual for a version, or subscription |
| Release from §13 and §5 | The principal grant: modify, run as a service, distribute or embed without the copyleft and network-source obligations |
| Derivative works | Scoped to defined products or fields of use |
| Redistribution / OEM / embedding | Typically royalty-bearing |
| Patent license | Express grant or covenant not to sue, scoped to the licensed use |
| Support, SLA, indemnification, warranties | AGPL §§15–17 disclaim all of these; only a signed agreement supplies them |

## Commercially negotiated terms

The following are settled per agreement and have no default value. A commercial
agreement is not formed until all are agreed in writing and signed by both
parties:

- Fee, payment schedule, and currency
- Licensed scope (entities, affiliates, seats/nodes/sites, permitted fields of use)
- Term, renewal, and termination rights
- Which rights from the table above are granted, and any royalty
- Support level, response times, and maintenance obligations
- Indemnification, liability caps, and warranty terms
- Governing law and dispute resolution venue
- Audit and reporting obligations

## How to obtain one

Contact **af@O2.services** with:

1. Legal entity name and jurisdiction of incorporation
2. Intended use — product, deployment model, whether the software is embedded
   in or distributed as part of something you ship
3. Scale — seats, nodes, sites, or the metric that fits your deployment
4. Which rights from the table above you need
5. Required term

## What stays reserved on every track

Neither track transfers ownership. The licensor retains all copyright, patent,
trademark, and trade-secret rights not expressly granted in a signed agreement.
Trademark use always requires separate written permission.

## Contributions and the right to dual-license

Dual-licensing only works if the licensor owns or controls **all** rights in the
software. A contribution accepted under the default license alone cannot be
relicensed commercially, because the contributor retains their copyright — one
such contribution is enough to break the commercial track for that file
permanently.

**This project therefore accepts no contributions** — see
[CONTRIBUTING.md](CONTRIBUTING.md). Sole authorship is what keeps the commercial
track available for the entire codebase. Should that policy ever change, a
Contributor License Agreement granting the licensor the right to sublicense
under commercial terms must be in place *before* the first patch is merged.
