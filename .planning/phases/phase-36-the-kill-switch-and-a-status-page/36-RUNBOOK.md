# Phase 36 — the two acts only the owner can perform

Everything else in this phase was built and measured against a local `workerd`. These two
touch the owner's Cloudflare account, so an agent may not do them: the phase's scope fence
forbids creating or altering any remote resource, and Phase 29 set the precedent that such
acts are runbook items with captured evidence rather than agent tasks.

**Neither has been performed.** Until they are, the control described below is inert in
production — and inert in the correct direction, which is the first thing to understand.

---

## Before you start: what "not done yet" currently means

An object with **no** `O2_ADMISSION_KEY` refuses **every** write to `POST /admission`,
including yours. That is deliberate — `authoriseWrite` in
`packages/cloudflare/src/admission-flag.ts` states the reasoning at the function — and it is
why skipping act 1 is safe rather than dangerous: a deployed object without the secret cannot
be halted by you, and cannot be halted by anyone else either. The fabric keeps working.

An object with **no** `O2_REGION` reports `region: null` on `GET /self` and refuses every
region-addressed write, for the same class of reason: an unlabelled object that accepted the
first write to arrive would be a hole in the slice wide enough to drive the whole fabric
through.

So the failure mode of doing nothing is *the switch does not work*. The failure mode of doing
act 1 badly — putting the key somewhere readable — is *anyone can halt your volunteers*.

---

## Act 1 — set the operator key on each deployed script

### Generate it

Use a CSPRNG. Not a password, not a phrase, not something you will recognise later:

```
openssl rand -base64 32
```

Store it wherever you keep secrets. **Never put it in `wrangler.jsonc`** — that file is
tracked, and a key committed once is a key in the history forever. It is the only binding in
this tier that is a `secret` rather than a `var`, and that is why.

### Set it

From `packages/cloudflare/`, once per deployed script:

```
npx wrangler secret put O2_ADMISSION_KEY
```

`wrangler` prompts for the value on stdin and does not echo it. Repeat with `--name <script>`
for each script that exists.

### Evidence to capture

1. `npx wrangler secret list` — the output should name `O2_ADMISSION_KEY`. It shows the
   **name**, never the value; paste it as-is.
2. A refused write, from a shell:
   ```
   curl -i -X POST https://<your-object>/admission \
     -H 'Content-Type: application/json' \
     -d '{"region":"bootstrap-us","halted":false,"versions":"all","since":null,"note":""}'
   ```
   Expect **401** and a body naming the missing header. Capture it. This is the reading that
   says the key is doing something; a 200 here is the defect the whole phase exists against.
3. The same request **with** `-H 'X-O2-Admission-Key: <the key>'`, expecting **200**. Capture
   the status only — **not the command line**, because it carries the key.

### What breaks if you skip it

The switch cannot be flipped in production at all. Everything else — the status page, the
`admission` field on `/self`, the client poll — works and reports "admitting" forever.

---

## Act 2 — label each deployed script with its region

`SERVED_BY` in `worker.ts` is a literal and stays one; the region arrives as a deployment
variable and is narrowed against the closed set on the way in.

### Set it

The closed set is exactly `bootstrap-us`, `bootstrap-eu`, `bootstrap-sam`
(`packages/cloudflare/src/hosted-object.ts`). Anything else is treated as **absent**, with a
line in the Worker's log — a mistyped label gives you an object that refuses every write, which
is loud, rather than one addressable under a name that exists nowhere else, which is silent.

Add it to the deploy invocation alongside the version the script already injects:

```
npx wrangler deploy --var O2_REGION:bootstrap-us --var O2_VERSION:<v>
```

**`--var` merges with the file's `vars` rather than replacing them** — measured 2026-08-27 and
recorded at `worker.ts`'s `O2_VERSION` docblock — so `ANNOUNCE_MULTIADDRS` survives the
injection. That matters: replacement would leave the relay announcing nothing, which hands
every client an empty reservation, silently.

### Evidence to capture

1. `curl -s https://<your-object>/self | jq .admission` — expect
   `{"region":"bootstrap-us","halted":false,"versions":"all","since":null,"note":""}` with
   **your** region label. A `null` region means the variable did not arrive.
2. A **mis-addressed** write, refused:
   ```
   curl -i -X POST https://<your-object>/admission \
     -H 'X-O2-Admission-Key: <the key>' -H 'Content-Type: application/json' \
     -d '{"region":"bootstrap-eu","halted":true,"versions":"all","since":0,"note":"probe"}'
   ```
   Expect **409** and a body naming both regions. Then re-read `/self` and confirm the
   directive did **not** move. This is the reading that says the slice is real in production
   and not only on a local workerd.

### What breaks if you skip it

Every region-addressed write is refused, so the switch stays unflippable — the same outcome as
skipping act 1, reached a different way. Note that **siting three objects in three places is
Phase 33's subject**, not this act's: this only labels whichever objects already exist.

---

## Act 3 — a ruling, not a command

Open question 2 in `.planning/REQUIREMENTS.md` asks whether Workers KV's ~60 s global
propagation is acceptable for this control, or whether the push-over-an-open-socket path must
ship in the same phase.

**This phase produced the number the question needs and did not answer it.** The number is
`29 880 ms` over 6 tabs at a 30 000 ms poll, single host, measured 2026-09-02 — and the
mechanism measured is a **Durable-Object-storage poll, not Workers KV**, so the ~60 s figure
the question is framed around remains unmeasured.

The two readings, and what each costs, are set out in `36-01-SUMMARY.md`. The ruling is yours;
an agent choosing one would settle the question by fait accompli, which is what the roadmap's
own sequencing — *"a Durable Object broadcast layered on **only if** the sub-minute window
proves unacceptable in practice"* — exists to prevent.
