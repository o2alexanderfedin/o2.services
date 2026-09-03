# The first real traffic took the hosted tier down, and a spending alert would not have caught it

**2026-09-03, ~18:19 UTC.** The owner ran the demo on three devices, found it working, and
posted the link to a Telegram group. Within hours the deployed node answered **HTTP 429 on
every path**, including `/`.

## What was read

```
HTTP/2 429
server: cloudflare
content-length: 17
body: error code: 1027
```

`error code: 1027` is Cloudflare's **daily request limit exceeded** for Workers on the free
plan — 100 000 requests per day. The refusal is at the edge: the Worker script never runs, so
no code of this project's is involved and no log of ours records it. `GET /self`, `GET /funnel`
and `GET /` all return it identically.

The GitHub Pages half was unaffected — `status.html` and `policy.html` both answered **200**
throughout, because Pages is a different product with a different quota.

## The finding that outlives the incident, and it is not the limit

**A spending alert would not have caught this, and the alert is the control this milestone put
first.** `HOST-10` asks that a billing alert precede the first Durable Object, and
`.planning/OWNER-ACTIONS.md` puts it at the top for exactly that reason. But an alert is a
control on **money**, and this was a control on **requests** — a free-tier cap that costs
nothing, warns nothing, and simply stops answering. The two failure modes are disjoint, and
guarding one says nothing about the other.

**So the go/no-go checklist has a hole the milestone did not know about.** Phase 39 criterion 1
names seven conditions, none of which is *the tier can serve the cohort you are about to
invite*. Capacity was never a criterion because the fabric's whole claim is that capacity comes
from volunteers — and the hosted tier is not where the compute happens. That reasoning is
correct about compute and wrong about **admission**: every volunteer arrives through the hosted
node, so its request budget is the fabric's front door.

## The measurement nobody designed and the run produced anyway

**When the hosted node stopped answering, new peers could not join.** That is Phase 32's
criterion 3 answered from the other side. Its two counters exist because *"the hosted tier
becoming load-bearing while every document still says peer-to-peer is the median outcome"* —
and here the hosted tier's unavailability was, in fact, the fabric's unavailability for anyone
arriving. Pairs already connected over WebRTC are unaffected; nobody new gets in.

That is not a defect. It is the honest shape of the design: the relay is a **signalling**
channel and not a data path, and signalling is still a dependency. It belongs in the record
because the milestone's own framing invites the softer reading.

## Remedies, in the order they matter

1. **Workers Paid, $5/month, 10 million requests included.** Restores service immediately and
   is a third of the budget already accepted for three regions. This is the fix.
2. Without it the counter resets at UTC midnight and the node returns on its own.
3. **Check whether the same cap took anything else down.** The free-tier limit is an *account*
   limit, so other Workers on the same account share the bucket. Not probed here: those are the
   owner's production and out of scope by his instruction, and adding requests to an exhausted
   quota helps nobody.

## What survived

Durable Object storage is untouched by a request-level refusal, so the funnel journal and the
relay-service journal are both intact and hold whatever the run banked before the cap. The
first real six-stage reading — the number this milestone was built to take — is sitting in that
store waiting for the node to answer again.
