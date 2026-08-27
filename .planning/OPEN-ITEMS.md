# What is still open, in plain English

**Written 2026-08-21 for someone who has never seen this project.** Everything else in
`.planning/` is written for people who already know the vocabulary. This file is not. If you
are new here and want to know what is unfinished and why, read only this.

Three things are open **in this file's original sense** — the sense of a mechanism that is
built and waiting on a person. **None of those three is unfinished code.** Each is waiting on
a decision or an action that only the project's owner can take.

> **AMENDED 2026-08-24 — this file was incomplete, and the sentence above was the incomplete
> part.** Four *requirements* also stand unmet, and unlike the three below, one of them
> genuinely is unfinished work. They were listed nowhere except as four rows among ninety-five
> in `.planning/REQUIREMENTS.md`, visible only to a reader who checked which ones did not say
> "Done". Section 4 adds them. The full working is in
> `.planning/milestones/v2.0-CARRIED.md`.

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

**What is unmeasured, and two corrections in a row.** Safari was untested. This was first
recorded as needing an iPhone or a 10 GB Xcode installation — **wrong**: macOS ships a tool that
drives real Safari, needs no installation, and was already switched on here. It was then recorded
as needing one settings switch — also **wrong**, or at least not sufficient.

**Safari will not let an automated browser click through a certificate warning.** The switch was
turned on and the automation works perfectly right up to the warning page: the page loads, its
buttons are ordinary web page content, there is no hidden system dialog, and the "visit this
website" link's internal command is present and callable. Call it and nothing happens — no error,
no movement. Ten attempts, twenty seconds of waiting, and a full page reload: still on the
warning. This looks deliberate, and it is a reasonable thing for a browser to do.

**ANSWERED 2026-08-22 by a person clicking, across four browsers.**

| browser | socket on the **page's own port** | socket on another port, same certificate | different certificate *(control)* |
|---|---|---|---|
| Chrome | works | works | correctly refused |
| Edge | works | works | correctly refused |
| **Firefox** | works | **refused** | correctly refused |
| **Safari** | works | **refused** | correctly refused |

So the acceptance is remembered for a host **and a port**, not for a host. **Two of the four
refuse the second port** — and they are two different engines (Firefox and Safari share nothing
here; Chrome and Edge are the same engine underneath, so they count once). Being forgiving about
the second port is the unusual behaviour, not the normal one.

**A connection on the same port as the page worked in all four.**

**This matters because the seed server uses two ports today** — the web page on one, the network
connection on another (`packages/node/src/seed-server.ts:427`). Served with a self-made
certificate as it stands, a Safari visitor would accept the page and then the network connection
would fail *silently*: no warning, nothing to click, just a connection that never opens. Chrome
would have shown no sign of the problem at all.

**RULED BY THE OWNER, 2026-08-22 — and this closes the visitor half.** A web app here is two
pieces: a *shell* hosted on a trusted host (Cloudflare, a company's own site) with an ordinary
commercial certificate, and the *app*, which arrives into that shell over the P2P network. So the
browser only ever checks a normal certificate, and the project's own certificates live inside the
app, underneath what the browser inspects. **No visitor sees a warning, because no visitor is
ever sent to a self-made certificate.** The measurement above still stands, but it now applies
only to the laptop-serves-a-phone development path — not to the product.

**The ruling moves the requirement rather than removing it, and this is the successor question.**
A page served over `https://` is not allowed to open an insecure `ws://` connection. The browser
currently reaches the relay over plain `ws`. So the certificate requirement moves off the visitor
and onto the relay — which is infrastructure this project runs, not a stranger's browser.
Browser-to-browser is unaffected either way: it uses WebRTC, which has never involved a
certificate authority.

**Two ways to satisfy that, neither of which asks anything of a visitor:**

- **A real certificate on the relay (AutoTLS).** Automatic and free, but the relay must be
  reachable from the internet on its port.
- **A transport that needs no certificate authority at all (`webRTCDirect`).** No certificate, no
  DNS name, no relay — the fingerprint travels in the address itself. It is not currently one of
  the browser's transports, so this is real work rather than a setting.

**A third way, added 2026-08-24, and it is measured rather than proposed: host the relay where
TLS is already terminated.** A Cloudflare Durable Object runs `circuitRelayServer()` — peer A
reserved a slot on it and peer B reached A only through it, verifying A's PeerId and pinging in
54 ms, over `wss://<name>.workers.dev`. The certificate is Cloudflare's ordinary commercial one,
so **the requirement does not arise on this path rather than being satisfied** — the same shape
as the shell/app ruling above, one level down. No ACME, no reachable port, no router change.

What it costs instead, so the choice is made with both halves visible: the relay lives in one
datacenter, its identity must be persisted in the object's storage or it changes on every wake,
and the listener needs two fields that are easy to omit and silent when omitted —
`direction: 'inbound'` and a remote address derived from `CF-Connecting-IP`, without which the
node rate-limits the entire internet as one host to five connections per second. And it remains
gated on **disclosure**, which is the same gate as before and is not a technical one. Working:
`.planning/consults/2026-08-24-cloudflare-as-a-fabric-node-measured.md`

*(Superseded, kept for the record — the choice as it stood before the ruling:)*

- **Put both on one port.** No router change, no certificate anywhere, works in all four
  browsers — but every visitor still sees the scary warning page once, and the seed server has
  to serve the page and the network connection from a single server rather than two. Note this
  is no longer the *cautious* option; with two of four browsers refusing, it is the only one
  that works everywhere.
- **Use a real certificate (AutoTLS).** No warning page at all, which is a much better first
  impression for a public demo — but it needs a port opened on the home router, which is the
  owner's to authorise.

The measurement removed the guesswork; the remaining question is whether one scary click per
visitor is acceptable.

**To re-run the check.** Run:

    node .planning/consults/2026-08-21-safari-cert-manual-check.mjs

It prints one address. Open it in Safari, click through the warning once ("Show Details", then
"visit this website"), and the page tests both connections itself and shows the answer in large
type — and sends it back to the terminal, so nothing has to be copied by hand. About thirty
seconds. Nothing is installed and no certificate is added to any system trust store.

The page will **refuse to report a success if both connections work**, because that would mean
the browser is not checking certificates at all and the test measured nothing. The harness was
checked end to end against Chrome before being written down, so it is known to work.

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

## 4. Four things the project promised itself and has not delivered

The three above are *mechanisms waiting on a person*. These four are **requirements** — things
the project wrote down as goals and has not met. Ninety-one of ninety-five are met; these are
the rest.

**Three of them are waiting for somewhere to run.** The code exists and, in two cases, has
already been measured — just not in the place that would count.

- **A relay the public can reach.** Getting an automatic HTTPS certificate works: it was
  watched ordering, receiving, installing and re-using one, with a real handshake validating
  it. But that was against a certificate authority running on this machine. A real one needs a
  machine the internet can reach, and this project has decided that going public is a decision
  taken on purpose rather than by drifting into it — because publishing forfeits patent rights
  in Europe and China permanently.
- **A benchmark across two computers.** Right now every measurement runs on one. The harness
  already asks each participant which machine it is on and believes the answer rather than
  assuming — that part was fixed. What is missing is somebody running it on two.
- **A translation that is identical on two computers.** Same shape: identical on one machine,
  repeatedly, in separate processes. Never compared across two.

**These three have carried the word "descoped" since July, and that word is misleading.** It
reads as "impossible here". It is not: this project has *already* produced a two-machine result
— an iPhone and a laptop, genuinely separate, talking directly. The second machine exists and
has been used. Two of these three are waiting on someone doing the run, not on hardware nobody
has.

**The fourth is unfinished work, and it is large.** Compiling the binary translator to run
inside the sandbox was tried and **measured to fail**: 21 of its 27 parts do not compile for
the target. The cause is a logging library that has branches for Windows, Linux, Android,
macOS, the BSDs and Emscripten — and none for this target. Before any of it is reachable, a
compiler has to be built from source that does not exist on this machine. That is a multi-day
job whose first result is a compiler, not a feature.

**It is reported as a failure rather than reworded**, which is this project's habit and worth
keeping: a measured "no" is more useful than a softened "in progress".

---

## 5. The same message can carry two valid signatures, on Linux

**Found 2026-08-27 by the browser CI lane on its first run, which is the reason that lane was
added.** Nothing here is broken code in this repository. It is a fact about the platform, and
this project's code is what has to decide what to do about it.

**What was measured.** A signature can be rewritten into a second form that still checks out —
mathematically, adding the group order to one half of it. A strict verifier refuses the rewrite;
a permissive one accepts it. This project uses two verifiers side by side and compares them,
precisely so a disagreement cannot go unnoticed:

| where | the library (`@noble/curves`) | the platform's own | verdict |
|---|---|---|---|
| GitHub's Linux runners, all three browsers | rejects | **accepts** | **they disagree** |
| the developer's Mac, all three browsers | rejects | rejects | they agree |

Same browser build in both places. The split is by operating system, not by browser.

**Why it matters here.** If the same message has two different valid signatures, then anything
that treats a signature as a name for something — counting them, removing duplicates, refusing a
repeat — can be fooled by handing it the other form. This fabric's signed statements travel
between machines, so a statement written where the platform is strict can be re-presented where
it is not.

**Nothing has been weakened.** The test still computes both answers every time. On the one
platform where the disagreement is known and written up here, it reports instead of failing —
and it decides that only AFTER seeing the answers, so the day the platform stops disagreeing,
the test goes green by itself and nobody has to remember to change it back. Everywhere else it
is as strict as it ever was.

## What the audit found, and it is good news

**Both halves were measured on 2026-08-27, and both are already right.**

**Half one: is this project's own code exposed?** Every place that could have been fooled was
checked — every comparison, every cache, every "have I seen this before". **Zero violations.**
The project already keys on stable things: a node's public key, a content address, a
provider-issued one-time number. The single place that refuses a repeat — enrolment — keys on
that one-time number, so a forged second signature cannot re-spend it or waste a fresh one.

**Half two: does the checking code use the strict verifier?** Twelve places verify a signature
on the trust path. **All twelve use the strict library directly**, none goes through the layer
that could pick the permissive one. The permissive verifier is used for *signing* only, in one
file, and a guard test enforces that.

Measured end to end: a certificate whose signature is rewritten into the second form is
**refused** by this project's verifier.

**Two things the audit corrected in this repository's own notes.** A docblock in
`ed25519-backend.ts` says six places verify directly; the real number is twelve — the extra six
postdate the note. Its load-bearing claim holds for all twelve. And the auditor flagged its own
method honestly: it could not reproduce the permissive behaviour, because it ran on a Mac where
both verifiers reject.

## So what is actually left

**Not a fix. A decision about depth.** The project is safe today because two independent things
happen to hold: the strict verifier is used everywhere on the trust path, and nothing anywhere
treats signature bytes as a name. Either one alone would be enough.

The open question is whether to make that **structural** rather than incidental — a guard that
fails the build if a future change routes a verification through the permissive path, the way
this repository already guards "exactly one file may use WebCrypto". That is cheap and it is
what turns "we checked once" into "it cannot regress".

**External corroboration, for whoever reads this later.** CVE-2026-33895 (High, CVSS 7.5) is
this exact defect in another library, and its published impact is "applications relying on
signature uniqueness — dedup by signature bytes, replay tracking". The academic treatment shows
strict rejection is *required*, not merely advisable. So there is no version of this where the
permissive behaviour is a defensible alternative; it is the defect.

---

## Why these are not simply "finish them"

Each of the first three is blocked on something no automated process can supply: a design
decision the owner already made and recorded, a security switch macOS reserves for a human, and
an event that may never recur. Marking them done would not finish them — it would only make the
record wrong.

**Section 4 is different, and the difference is the point of adding it.** Those four are not
blocked on anything unobtainable. Three need a place to run and one needs a build. They are
work, and they are what a next milestone would be made of.

**Section 5 is different again: it is not blocked at all, and it is not this repository's bug.**
It is a decision about which of two safe options to take, and it can be taken today. It is here
because a finding that lives only in a test comment is a finding that gets rediscovered.
