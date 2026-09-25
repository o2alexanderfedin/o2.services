# RFC-0003 Response 06 — agent messaging transport layer (sketch)

Status: **sketch / for discussion**. This is not RFC-ready text; it is a mapping proposal
for carrying agent-to-agent messages (session mailboxes à la Claude Code `ListAgents` /
`SendMessage`, and their analogues) over the o2 fabric defined by RFC-0003 and
Response-02. Written by Praxis at Alexander's request, 2026-09-17.

## 1. What the external systems do, in one paragraph

Claude Code sessions discover each other via `ListAgents` and exchange plain-text
payloads via `SendMessage`. On one machine the registry is files on disk; across
machines it rides their cloud/remote-control channel. Delivery is a mailbox between
tool calls: size cap per message, inbox limits on burst, and `held` / `refused`
states decided by the receiving client. Semantics: "hand a finding, a status, or a
decision to a neighbouring session."

Their weak point is our strong point: the registry is machine-local (or
account-bound to one vendor). There is no global discovery. o2 already has
capability-based discovery in core. The proposal: o2 becomes the transport plane
for their mailbox semantics — their `SendMessage` → our envelope → our
capability query → delivery to the node hosting the target session.

## 2. The minimal message object

Reuse `ExecutionEnvelope` + `Invocation` from Response-02 §B.4.1 unchanged as the
carrier. The message is just a workload whose module is a trivial identity router
and whose input commitment is the payload:

```
AgentMessage ::= {
  objectType      : "o2.agentmsg.v1"
  fromAgent       : AgentId          -- see §3
  toAgent         : AgentId | null   -- null ⇒ addressed by capability, see §3.2
  inReplyTo       : CID | null       -- content-address of prior AgentMessage
  kind            : "text" | "finding" | "status" | "handoff" | "question"
  payloadCid      : CID              -- dag-cbor, canonical; the actual bytes are an input
  sizeBytes       : uint             -- MUST match payload; cap enforced by limits
  transportHints  : { ttlMs: uint, priority: "bulk" | "normal" | "urgent" }
}
```

The envelope's `inputs` carries `payloadCid`; `limits.outputBytes` caps reply size;
`notAfter` gives TTL. No new signing machinery: the sender's `Invocation` is the
existing authority object, and `toAgent`/capability narrowing is expressed through
Part A's `AuthorityRule` set — an agent that may be messaged is an authority that
may be delegated to, attenuated.

## 3. Addressing: names vs capabilities

**3.1 AgentId.** `(publisherPubkey, agentName)` — stable, no global registry
needed; collision-free by construction, resolvable to a capability query.

**3.2 Capability addressing.** `toAgent: null` + `capabilities` narrowed to
"agent that satisfies predicate P" (e.g. `skill:lean4-audit`, `role:reviewer`).
This is the join with existing core discovery. Two layers of names must not
accumulate: vendor-side session names (`@name`) are *hints* carried in
`transportHints`, never authoritative; the authority always resolves through the
capability algebra. A gateway bridging vendor mailboxes MUST translate
`@name → capability-query` at the edge and record the translation in the
receipt, so the two naming systems never meet inside the fabric.

## 4. Delivery states: mapping `held` / `refused`

Vendor semantics make held/refused a *client* decision. o2 semantics make
acceptance a *fabric* decision (quorum/attestation). The sketch's reconciliation:
fabric delivery has three terminal states — `delivered` (node accepted, agent's
inbox holds it), `refused` (authority check failed, or inbox limits exceeded —
fabric-level, signed), `held` (authority passed but the receiving agent asserted
a backpressure signal; held is time-bounded by `ttlMs`, then becomes `refused`).
The *content* decision to open/read remains the agent's; the *transport* decision
is the fabric's. This is one policy line, stated once, instead of two systems
silently disagreeing.

## 5. Limits that must not be broken by tunnelling

| vendor constraint | o2 carrier | note |
|---|---|---|
| message size cap | `limits.outputBytes` / payload input size | gateway MUST map vendor cap to envelope `limits`, not fabric defaults — else a burst that vendors shape, we drop |
| inbox burst limit | per-`AgentId` admission rate in the receiving node | enforcement point is the node, not the envelope |
| plain-text between tool calls | payload is a CID-resolved input, not inline | gateway MUST inline/outline at the edge; inside the fabric it stays content-addressed |

## 6. What this deliberately does not do

- No new global registry: discovery stays capability queries; names are hints.
- No change to Part A algebra or to `ExecutionEnvelope` fields — only a new
  `objectType` and usage conventions.
- No vendor lock-in: the mapping section (§1, §5) is the only place vendor
  specifics appear; the rest is vendor-neutral.

## 7. Open questions

1. Does an `AgentMessage` need its own attenuable capability ("may message me"),
   or is an `AuthorityRule` on the receiving envelope enough?
2. Broadcast (`toAgent: null`, no narrowing) — allowed as `bulk` priority only,
   or forbidden until spam experience exists?
3. Cross-fabric receipts: when a message exits through a gateway to a vendor
   mailbox, whose receipt is authoritative for "delivered"?
