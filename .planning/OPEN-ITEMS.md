# What is still open, in plain English

**Written 2026-08-21 for someone who has never seen this project.** Everything else in
`.planning/` is written for people who already know the vocabulary. This file is not. If you
are new here and want to know what is unfinished and why, read only this.

Three things are open. **None of them is unfinished code.** Each one is waiting on a decision
or an action that only the project's owner can take.

---

## 1. A switch that is deliberately not wired up yet

**What the feature is.** Nodes on this network advertise what they can do, so other nodes can
pick who to send work to. Part of that advertisement is a list of *optional extras* — "I also
support feature X". A node reading someone else's advertisement is supposed to be able to say
"here are the extras I understand", so it can skip anyone using an extra it does not.

**What is built and what is not.** The advertising half works. The reading half — the part
where a node declares which extras it understands — is intentionally left disconnected.

**Why leaving it disconnected is the right call.** Nothing in the codebase creates an "extra"
yet. The list is empty and there is no way to put anything in it. So if you connected the
reading half today, it would check an empty list against an empty list and always pass. That is
a test that can never fail, which is worse than no test at all: it looks like protection and
provides none. The owner decided on **2026-08-11** to wait until something actually produces an
extra.

**The real risk, which is about ordering.** If somebody adds a *mandatory* extra before the
reading half is connected, then every node advertising it becomes invisible to every other node
on the network — silently, with no error at the advertising end, and with no way to opt out,
because the opt-out is the very thing that is not connected.

**What protects against that.** A test that turns red the moment anyone defines an extra without
also connecting the reader. On 2026-08-21 the code was deliberately broken to check that the test
really does turn red — it did, and it named the exact file and the exact fix — and then the
break was reversed and the test confirmed green again. So this is a proven alarm, not an assumed
one.

**To close it:** somebody has to build the first "extra" first. That is a new feature, not a
loose end.

---

## 2. One switch inside Safari's settings

**What the feature is.** We want a visitor to be able to join the network straight from a web
page. Browsers require HTTPS for that, and HTTPS needs a certificate. There are two options:

- **A real certificate.** Trusted automatically, but getting one requires opening a port on the
  owner's home router so the outside world can reach this machine.
- **A self-made certificate.** No router changes, but the visitor sees a browser warning page and
  has to click through it.

**The question that decides which to use.** The page and the network connection run on two
different ports. After the visitor clicks through the warning **once**, for the page, does that
trust also cover the network connection on the *other* port? If yes, the self-made certificate
costs one click. If no, it is unusable, because a failed network connection shows no warning page
at all — it just silently fails.

**What has been measured.** In Google Chrome the answer is **yes**, tested three times. The test
also included a deliberate failure case — a third port with a *different* self-made certificate,
which correctly failed all three times. That control is what makes the result meaningful: without
it, "the connection worked" would be equally consistent with the browser simply not checking
certificates at all.

**What is unmeasured, and the correction that shrank it.** Safari was untested, and this was
previously recorded as needing an iPhone or a 10 GB Xcode installation. **That was wrong.** macOS
ships a tool that drives real Safari, it needs no installation, and it is already switched on
here. Safari has one further switch, and macOS deliberately prevents any program from flipping it:

> Safari → Settings → Advanced → "Show features for web developers"
> then Develop → "Allow Remote Automation"

**Then run:**

    node .planning/consults/2026-08-21-safari-cert-exception-probe.mjs

The script is committed and self-contained — it creates its own certificates and servers. It has
already been run up to that switch, so it is known to work right up to the point where it stops.
The whole thing takes about a minute.

**What is still the owner's call afterwards.** Which option to actually build. Opening a router
port affects the owner's home network, so nobody else can make that choice.

---

## 3. A slow test run that happened once and never came back

**What happened.** The browser test suite once took about 33 minutes. It normally takes about
1 minute 45 seconds. It has never done it again.

**Two explanations were tested and neither accounts for it.**

- *Leftover Docker containers eating the machine.* Tested by deliberately running four containers
  that each consumed a full CPU core — half the machine — during a full test run. Cost: **18%
  slower.** Not 33 minutes. This explanation is dead.
- *Two test suites running at the same time.* Tested by deliberately running both at once. Cost:
  **1.8× slower**, and interestingly the suite did about 8% *more work*, which losing CPU cores
  alone does not cause. So this is real and it is the right family of explanation — but 1.8× is
  nowhere near the roughly 19× that a 33-minute run would be.

**Where it stands.** Unexplained, and honestly recorded as such in
`.planning/debug/browser-project-33-minute-run.md` along with every measurement. Learning more
requires the slow run to happen *again, while someone is measuring it*, and that cannot be
scheduled.

**One thing worth knowing if you ever see a test run that looks frozen:** this project's browser
test suite prints nothing at all for the first several minutes of a perfectly healthy run. Silence
is not evidence of a hang here. Only total elapsed time is.

---

## Why these are not simply "finish them"

Each one is blocked on something no automated process can supply: a design decision the owner
already made and recorded, a security switch macOS reserves for a human, and an event that may
never recur. Marking them done would not finish them — it would only make the record wrong.
