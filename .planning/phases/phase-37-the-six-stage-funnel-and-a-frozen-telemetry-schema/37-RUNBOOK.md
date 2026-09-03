# Phase 37 — the acts only the owner can perform

**Nothing in this file is an agent task.** Every step spends money, creates a remote resource,
or is a public act, and this project treats all three as separately-triggered gates rather than
as consequences of a phase completing. The 2026-08-25 ruling made deploying an owner act; this
page is what that ruling leaves for the owner to do, in order, with the evidence each step
produces.

Phase 37 built and measured the funnel entirely on a local `workerd`. What it could not do is
the last mile of criterion 1's own words — *"reporting live **before recruitment begins in
Phase 39**"* — because a reading taken before the first invitation has to be taken on the
**deployed** object, and no local run can stand in for that.

---

## Step 1 — deploy the Worker carrying `/funnel`

One command, the one that already exists:

```
scripts/deploy-hosted.sh
```

The version injection is already in place; nothing about the deploy changed in this phase
beyond the two routes the object now answers.

**Evidence:** `GET /self` on the deployed object answers the expected `version`. Record the
value and the date beside it.

**What this costs:** one Worker and one Durable Object in the owner's account. Phase 29's
criterion 5 — no preview deployments, ever — is unchanged and is enforced by
`wrangler.jsonc`.

---

## Step 2 — take the pre-invite reading, and record it where Phase 39 can cite it

```
curl https://<the deployed origin>/funnel
```

**Evidence:** six zeros, the population, and the schema digest.

**This is the timestamped reading Phase 39 criterion 2 requires to precede the first invite.**
It is what makes "the funnel was reporting live before recruitment began" a fact somebody can
check rather than a claim in a summary. Record it in Phase 39's own planning directory, with
the date and the digest, and treat the digest as the thing that must not move afterwards.

Expected today: `schemaDigest` is `3911527f1a04abee` and `population` is `opted-in-only`.

---

## Step 3 — point the published page at the collector

The demo reads its collector from `?funnel=<origin>` on the page URL. **It has no default and
must not be given one** — `packages/browser/src/funnel-reporter.node.test.ts` refuses any origin
literal in the reporter or in the demo's funnel wiring, because a default would make every
end-to-end run in this repository post to the deployed object.

So this step is a **build-time or link-time value**, not a code change: the published link
carries `?funnel=`, or the build injects the origin at publish time. Whichever is chosen, the
guard above still has to pass, so the value must not become a literal in the reporter.

**Evidence:** one real visit moves `entered['page-load']` and `entered['consent']` from 0 to 1
on the deployed object's `GET /funnel`.

---

## Step 4 — **UNDER READING B ONLY:** the documented balancing test

Skip this step entirely if the ruling on open question 3 is **consent** (reading A), which is
what the code implements today.

If the ruling is **legitimate interest** (reading B), a **documented balancing test** is owed
before recruitment begins. It is a document, not code, and no agent writes it. What it has to
weigh is on record already: the record's contents are enumerated exactly in
`DISCLOSURE`'s *"What does this page count about my visit?"* line and in `demo/policy.html`, and
`packages/cloudflare/src/funnel-collector.e2e.test.ts` demonstrates against the store that the
record holds no address and no cross-session identifier.

**Evidence:** the document exists and is dated before the first invitation.

**Only after that ruling** does anything in the code move — and it is two values and one
assertion, listed in `37-01-SUMMARY.md` § *Open question 3*.

---

## Step 5 — confirm the freeze held

Compare the `schemaDigest` in the step 2 reading against the `schemaDigest` in a reading taken
at the moment of the first invitation.

**Evidence:** the two are the same string. If they differ, the schema moved between the
pre-invite reading and recruitment, and the correct response is to find out what changed and
revert it — not to record the new digest. `packages/net/src/funnel-schema.test.ts` says the
same thing in its failure message, and the digest travels on every `GET /funnel` response
precisely so this comparison needs nothing but two `curl`s.

---

## What is deliberately NOT here

- **No recruitment.** Phase 39 owns the first invitation and its own gates.
- **No third-party analytics service.** The collector is this repository's own Worker; nothing
  in the funnel path contacts anybody else, and `demo/policy.html` says so to a visitor.
- **No change to the three `ocr-checks-worker*` scripts.** They are unrelated production
  scripts under an unrelated prefix and Phase 37 did not touch them.
