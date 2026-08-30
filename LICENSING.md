# Licensing

**o2.services is dual-licensed: AGPL-3.0-or-later by default, or a commercial
licence by agreement.**

| | [AGPL-3.0-or-later](LICENSE) | [Commercial](LICENSE-COMMERCIAL.md) |
| --- | --- | --- |
| Applies to | everyone, automatically | signed parties only |
| Cost | free | negotiated |
| Use, including in production | ✅ | ✅ |
| Modify | ✅ | ✅ |
| Redistribute and embed | ✅ | ✅ |
| Patent licence | ✅ granted, [AGPL §11](LICENSE) | ✅ negotiated |
| **Must publish your source changes** | ✅ **required** | ❌ not required |
| **Must publish source to users over a network** | ✅ **required**, [AGPL §13](LICENSE) | ❌ not required |
| Warranty, SLA, indemnity | ❌ none | ✅ negotiated |

Commercial licensing: **af@O2.services**

> **Draft — not reviewed by counsel.** The AGPL text itself is the Free Software
> Foundation's, unmodified, and needs no review. This page and
> `LICENSE-COMMERCIAL.md` do.

## Which one applies to you

**The AGPL applies automatically.** You do not sign anything, ask anyone, or
pay anyone. If you can live with §13 — described below — you are done reading.

**The commercial licence exists for one reason: to release you from §13 and from
§5's copyleft.** It is not a better version of the software, and it is not
support. The software is identical on both tracks. What differs is what you owe
in return.

## What §13 actually asks

This is the clause that distinguishes the AGPL from the GPL, and it is the whole
reason it was chosen here.

> If you run a modified version of this software and let users interact with it
> **over a network**, you must offer those users the source of your modified
> version.

Three things follow, and the third is the one people get wrong:

1. **Using it privately costs you nothing.** Run it, modify it, keep it inside
   your company. §13 is triggered by *users interacting over a network*, not by
   use.
2. **Running it unmodified costs you nothing beyond attribution.** §13 asks for
   the source of *your modified version*. If you have not modified it, the
   source is already here.
3. **Being a node in the public fabric is not "offering a network service".** A
   volunteer running the browser client is a *user* of the fabric, not a
   provider of it. Nothing about joining the network puts an obligation on a
   volunteer. If you are reading this because you clicked "join" on a web page,
   you owe nothing at all.

Where §13 does bite: if you take this code, modify it, and offer the result to
*your* users as a service, they are entitled to your modifications. That is the
bargain, and it is deliberate — it is what stops the fabric being turned into
somebody's closed product built on work given away.

## Why the AGPL rather than a permissive licence

The stated goal of this project is that **usable capacity grows super-linearly
with the user base, without any raw data leaving its owner's device.** Both
halves of that claim are properties a user has to be able to *check*, not
promises they have to take. Sovereignty that cannot be inspected is a marketing
line.

Under a permissive licence, a modified fabric that quietly moved data off the
owner's device would be indistinguishable from this one, and its users would
have no right to the source that would show them the difference. §13 makes the
inspection right survive the modification. It is the licence that matches the
claim.

## Why the AGPL rather than the previous terms

Until 2026-08-30 the default track was the *O2.services Source-Available Trial
License 1.0*: source-available, not open source, 32-day evaluation, no
modification and no redistribution. It is preserved verbatim at
[LICENSE-TRIAL-1.0.md](LICENSE-TRIAL-1.0.md).

**It contradicted the owner's own recorded decision.** `.planning/PROJECT.md`
records the ruling of 2026-08-24 as *"open source, with monetization for
commercial use added later"*. The trial licence was neither open source nor
approved by the OSI, and said so in its own notice. This change resolves the
contradiction in favour of the ruling.

**Nobody loses a grant.** Anyone who accepted the trial terms keeps them; the
file stays in the repository for exactly that reason. Everyone else now has
strictly more: the AGPL permits use, modification and redistribution that the
trial licence refused.

## Patents

**The AGPL grants a patent licence, and this project accepts that.**

[§11](LICENSE) gives every recipient a licence to any patent claim the licensor
holds that the software would infringe. This is not a side effect being
tolerated — it is a deliberate reversal of the previous position, in which
patent rights were reserved.

The reservation had already lapsed in practice. The repository has been public
since 2026-07-26, and the EPO and China have no patent grace period, so those
rights were forfeited by publication over a month before this change. What
remained was a reservation that no longer protected anything and that a reader
could reasonably have taken as a threat. Granting it plainly is more honest than
reserving something already gone.

## What will not change

The three precedents that make people distrust a licence change — Terraform to
BUSL, Redis to SSPL, Elastic to SSPL — all had one shape: **terms tightened
under code people had already adopted.** All three were forked.

This change goes the other way. It loosens. And because the risk is real for
whatever comes next, the commitment is stated here rather than left implicit:

- **The AGPL grant on any code already published is irrevocable.** That is not
  a promise, it is how the licence works — §2 grants for the life of the
  copyright, and a later version of this file cannot reach back.
- **Commercial monetisation is additive.** It is a second track beside the AGPL
  for people who cannot accept §13, not a restriction on the AGPL track. Nothing
  planned removes anything from the AGPL track.
- **No CLA, and no outside contributions.** Sole authorship is what keeps the
  commercial track available for the entire codebase — see
  [CONTRIBUTING.md](CONTRIBUTING.md). Bug reports are welcome; pull requests are
  closed unread, and that policy is about copyright ownership, not about the
  quality of the patch.

## Dependencies

Every runtime dependency is permissively licensed — Apache-2.0, MIT, ISC, or a
dual grant of those — so nothing in the tree conflicts with the AGPL. Checked
2026-08-30 across the seven workspace packages' direct dependencies: 25
`Apache-2.0 OR MIT`, 3 `MIT`, 1 `ISC`, 1 `Apache-2.0`, 1 `MIT OR Apache-2.0`.
