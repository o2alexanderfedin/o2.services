# The js-libp2p family bump makes an oversized message arrive TRUNCATED and unrefused

**Status: OPEN. The dependency bump is reverted on `develop`; the grouping and the
diagnosis that produced it are kept.**

## The symptom, stated as a security property rather than a red test

`packages/node/src/transport-bounds.node.test.ts` — *NET-08 — a peer cannot make this
node allocate an unbounded buffer* — case *"enforces the shipped default with no
override anywhere"*.

A peer sends `MAX_INBOUND_MESSAGE_BYTES + 1` = **8 388 609** bytes. The receiver is
required to refuse it. Instrumented on the bumped tree:

```
[probe] sent bytes    : 8388609
[probe] received n    : 1
[probe] received len  : [ 851968 ]
[probe] refusedInbound: 0
```

**A truncated fragment was delivered to the application as a complete message, and
nothing was counted as refused.** That is worse than the bound failing to fire: the
size guard is also what makes a delivered message whole, so a peer can make this node
act on 832 KiB of an 8 MiB message and believe it received all of it.

## Why this is the bump and not the host

Same source, same quiet host, same command; only `node_modules` differs.

| tree | `@libp2p/interface` / `@libp2p/utils` | result |
|---|---|---|
| `8294e1f` (pre-bump) | 3.2.5 / 7.3.0 | **15 passed**, exit 0 |
| `82edd1c` (bumped) | 3.3.0 / 7.4.1 | **1 failed**, exit 1 |

`[host conditions] host was quiet — load/core 2.23 before, 2.25 after` on the failing
run, and the case fails in **69 ms** rather than timing out. Load would push this
assertion toward passing, not failing: it asserts that a message does **not** arrive.
The banner's warning does not apply to a failure of this shape, and saying so is the
point — see `scatter-is-a-shared-cause` and CLAUDE.md § Measurement.

## What has been ruled out

- **Our send loop is not wrong against the contract.** `send(data): boolean` carries a
  byte-identical docblock in 3.2.5 and 3.3.0 — Node's semantics, where `false` means
  the buffer is now full and not that the chunk was rejected. So
  `libp2p-transport.ts:347`'s `if (!stream.send(chunk)) await stream.onDrain(…)` reads
  the contract correctly in both versions.
- **`abstract-message-stream.js` alone is additive between 7.3.0 and 7.4.1** —
  everything that moved in *that file* is the new `end` event and `readableEnded`: a
  `maybeDispatchEnd()` added at five call sites, plus one `log` → `log.error`. Nothing
  in it touches flushing. **Read this as narrowly as it is written**: the rest of
  `@libp2p/utils@7.4.1` was not diffed, and neither was `libp2p@3.3.10` or
  `@libp2p/tcp@11.0.28`. `close()` was looked for in both versions and found in
  neither by the search used, so no claim is made about it either way.

## The live suspicion, recorded as a suspicion

`maybeDispatchEnd()` fires `end` when **either** `remoteWriteStatus === 'closed'`
**or** `readStatus === 'closed'` — and `onTransportClosed` now calls it with the
comment *"this may be the end even if the readable end was not closed above"*. The
reader in `readMessage` (`packages/libp2p/src/libp2p-transport.ts:188`) is a
`for await (const chunk of stream)`, so if that iterator terminates on `end`, a
premature `end` ends the loop with a partial accumulation — which is exactly the
observed shape, since `total > max` is then never reached and no refusal is counted.

**Not measured.** The next step is to establish what terminates that async iterator
and whether an `end` can precede the remote's write close. `851968` = 13 × 64 KiB is
worth carrying into that: it is a whole number of yamux windows, not an arbitrary cut.
Then bisect the culprit — family-minus-`tcp`, family-minus-`libp2p` — at roughly three
minutes an arm.

## The deeper lead, which is a migration and not a patch

**This protocol's message boundary IS "the stream ended".** There is no length prefix:
`send` writes chunks and calls `stream.close()`, and `readMessage` accumulates until
the iterator stops. Under that framing *any* premature clean end is indistinguishable
from a complete message — so a change in when `end` fires cannot be caught by the
reader, only by a bound that the truncated message no longer trips. CLAUDE.md's own
stack table says to use `@libp2p/utils`' `lpStream()`/`pbStream()` *"instead of
hand-rolling framing"*, and this framing is hand-rolled.

Length-prefixing would make truncation impossible to mistake for completion. It is
also a **wire-format change on both ends**: the deployed hosted node speaks the
current protocol, so this is a migration with a compatibility window, not a patch to
slip in beside a dependency bump.

## What must hold before the family is bumped again

`transport-bounds.node.test.ts` green on a quiet host — the whole file, not the case —
and the probe above reading `received n: 0, refusedInbound: 1`. The bump is otherwise
ready and reproducible: `.github/dependabot.yml` now groups the family, and the
version set that typechecks with zero duplicated members is recorded in the reverted
commit.

**This spec is excluded from CI** by `O2_UNIT_ONLY=1` — it is one of the ~800 cases
`ci.yml` assigns to the developer machine — so CI being green on the bump is not
evidence against any of this, and was not.
