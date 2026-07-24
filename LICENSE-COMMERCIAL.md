# Commercial License — O2.services

**Draft — not reviewed by counsel. Do not execute without an attorney review.**

The software in this repository is **dual-licensed**:

| Track | Terms | Who it applies to |
| ----- | ----- | ----------------- |
| **Default** | [LICENSE](LICENSE) — source-available, 32-day commercial trial, no modification, no derivatives, no redistribution | Everyone, automatically |
| **Commercial** | This document, executed as a signed agreement | Only parties who sign |

The default track applies to you unless and until you sign a commercial
agreement. This is **not** a choice-of-license offer — you cannot elect the
commercial track unilaterally.

---

## Why the commercial track exists

The default license permits evaluation only, for fewer than 32 consecutive
calendar days. On expiry it terminates automatically. Any of the following
requires a commercial agreement:

- Use in production, or any use after the trial period ends
- Use beyond evaluating suitability for a particular application
- Modifying, adapting, porting, or refactoring the software
- Creating derivative works
- Redistributing, sublicensing, hosting, or embedding the software in a product
- Any patent rights (the default license grants none)

## What a commercial agreement can grant

Grants are negotiated per deal. The licensor may extend any subset of:

| Right | Notes |
| ----- | ----- |
| Production use | Scoped by seats, nodes, sites, or revenue band |
| Term | Perpetual for a version, or subscription |
| Modification | Optionally with a source-escrow or change-disclosure obligation |
| Derivative works | Scoped to defined products or fields of use |
| Redistribution / OEM / embedding | Typically royalty-bearing |
| Patent license | Express grant or covenant not to sue, scoped to the licensed use |
| Support, SLA, indemnification, warranties | None of which the default track provides |

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
