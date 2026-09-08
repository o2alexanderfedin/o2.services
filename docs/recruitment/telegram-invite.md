# The Telegram invite

This is the message that goes to the tester group, the reason its licensing
sentence is worded the way it is, and the command that checks a variant of it
before it is sent.

**Nothing here sends anything.** Committing this file into a repository that is
already public is not the act of posting to a group. The send is an owner action
and it happens under Phase 39's dated go/no-go checklist, not by this document
existing.

---

## 1. The message

```
I've built something and I'd like you to try it. It takes one tap and you can
stop it whenever you want.

Open this: https://o2alexanderfedin.github.io/o2.services/

What it is. A web page that can turn your browser tab into one node of a shared
computer. The job it runs right now is a maths problem: colour the whole numbers
from 1 upwards so that no three of them with a² + b² = c² all come out the same
colour. Your device searches one slice of that; every other device searches its
own. The whole point of the exercise is to find out whether a few hundred
ordinary phones and laptops can do together what people normally rent a data
centre for.

What it does to your machine. Nothing, until you say so. The page opens with a
plain list of what will happen and two buttons, and if you press the one that
declines, nothing runs and nothing on the network is contacted — not even to
say you were here. If you allow it, it uses one background thread, and that
drops to a tenth of one when the tab isn't the one you're looking at. A Stop
control sits on screen the whole time; pressing it ends the work straight away
rather than asking it to finish first.

What leaves your device. Your own data doesn't. That's the entire idea of the
project rather than a reassurance: the code is handed a public question and
computes an answer, so it has nothing of yours to send in the first place. What
goes out is the answer — small whole numbers and bit arrays. No files, no
browsing history. The page tells you roughly how many kilobytes that is before
you agree, and that figure comes off a real run rather than a guess.

There is no payment involved, in any direction and in any form. There is nothing
to buy, nothing to install, no account, and no currency of any kind anywhere in
this. I'm asking for the use of a browser tab, and I would honestly rather you
read the page and press No than press Yes without reading it.

The code is public. It is open source under the AGPL, and there is a separate
commercial licence for companies that can't live with what the AGPL asks of
them: https://github.com/o2alexanderfedin/o2.services

If it doesn't work on your device, that is the single most useful thing you can
send me — which phone or browser, and what you saw. A failure I can read about
is worth more to me than a success I can't.
```

---

## 2. Why the licensing sentence reads the way it does

The message says the software is open source under the AGPL and that a
commercial licence exists beside it. It does not say the licence will never
change, and it will not be edited to say so.

That restraint is not modesty. It is the specific failure three well-documented
projects shipped, each in the same shape — terms tightened underneath code
people had already adopted, announced as a clarification, and read by the
community as a reversal:

- **HashiCorp Terraform, August 2023.** Moved from the open MPL v2 to the
  Business Source License, which is source-available and does not meet the Open
  Source Initiative's definition. The community's answer was **OpenTofu**, a
  fork now governed under the Linux Foundation and reported at ten million
  downloads and more.
- **Redis, March 2024.** Moved to a dual RSAL/SSPL arrangement, neither half of
  which the Open Source Initiative recognises. **Valkey** launched within weeks
  with AWS, Google Cloud and Oracle behind it, reportedly reached roughly
  four-fifths enterprise adoption and close to double Redis's pull-request rate,
  and by the time Redis reversed course to AGPLv3 in May 2025 **Valkey** had
  already become the continuation much of the ecosystem was using.
- **Elastic, 2021.** Moved to the SSPL, and AWS answered with **OpenSearch**,
  which is still the fork a large part of that ecosystem runs.

None of the three lost a fork because they wanted revenue. They lost one because
the licence people adopted under and the licence that arrived later disagreed,
and nothing written down in advance had told anybody to expect the second.

**The position this project actually holds**, stated in `LICENSING.md` and
repeated here so the recruitment copy and the licence page cannot drift apart:

- **The AGPL grant on code that is already published cannot be withdrawn.** That
  is not a pledge anybody has to trust — it is how the licence works. AGPL §2
  grants for the life of the copyright, and no later revision of a document in
  this repository can reach back and take it off a copy somebody already has.
- **Commercial monetisation is additive.** It is a second track beside the AGPL
  for people who cannot accept §13, and not a restriction on the AGPL track.
  Nothing planned removes anything from the AGPL track. The commercial licence
  is not a future announcement either: it is in the repository today, named in
  the message above, so a reader meets it at recruitment rather than a year
  later.

The difference between that and the three cases above is the whole of it. Those
were withdrawals presented after the fact. This is an addition, stated before
anybody has been asked to join.

---

## 3. Checking a message that never reaches this repository

This file is tracked, so both repository-wide guards already read it: the
vocabulary guard in `packages/node/src/vocabulary.node.test.ts` scans every file
`git ls-files` reports, and the prose rules in
`packages/node/src/licensing-consistency.node.test.ts` list this path beside
`README.md`, `LICENSING.md` and the rest. Neither of them has to be remembered.

What neither of them can reach is a variant typed straight into a chat window —
a shortened version for one person, a translation, a follow-up. That message is
read by a few hundred strangers and by whoever maintains the blocklist their
browser ships with, and it is the one a reviewer greps. So it gets the same five
patterns from the same file, as a command:

```
node --experimental-strip-types packages/node/src/bin/check-copy.ts <file>
# or, straight from the clipboard:
pbpaste | node --experimental-strip-types packages/node/src/bin/check-copy.ts -
```

It exits `0` when it finds nothing and non-zero when it finds something, so it
can sit in front of a send rather than producing output somebody has to read. It
imports the patterns from `packages/node/src/banned-vocabulary.ts` — the same
array the repository-wide guard imports, which is why the two cannot come to
disagree. It has no exemptions, by design: copy about to go to a few hundred
strangers has no defensible exception, whatever a tracked source file may
legitimately need.

**One thing the command cannot check, so it is written here instead.** The link
in the message has to point at a deployment that can actually reach a relay.
`README.md` records that the page is a real node which cannot join anything on
its own, because a browser accepts no incoming connections and GitHub Pages runs
no server process. Confirming that the deployed build is the current one and
that it can find a relay belongs to Phase 39's checklist, before the first
invite — not to this file, and not to the person pasting the text.
