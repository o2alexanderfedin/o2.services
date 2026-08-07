# RFC-0003 Response 02 — capability algebra, and binding the execution envelope

**Responds to:** `RFC-0003-REVIEW-praxis-2026-08-06.md`, points **3** and **4**.
**Target:** `RFC-0003-Decentralized-Cloud-Security-Architecture-v0.2.md`.
**Status:** proposal. Nothing here is implemented. Points 1 and 2 of the review are answered
separately and are deliberately not touched here.

---

## 0. Method, and what this document is not

What was read: the RFC, the review, and the implementation named below by file and symbol. What
was **not** done: no test was run, no benchmark was taken, and no code was changed. Every
performance or behaviour claim about existing code in this document is a claim about *what the
source says*, cited by symbol or quoted comment, not a measurement.

Two words are used strictly:

- **verified** — read in this repository, quoted.
- **proposed** — does not exist and is being argued for.

Where the answer is "we do not know", §A.6 and §B.7 say so under their own headings rather than
inside the recommendation. Descoped is not satisfied; unmeasured is not met.

---

# Part A — Point 3: `AuthorityRule` as a formal algebra

## A.1 The problem, restated precisely

The review says a bug in the subset check is privilege escalation rather than merely a bug. That
is correct, but it is worth naming the defect in the RFC exactly, because the RFC contains **two
different rules eight lines apart and does not say which one is normative**.

§5 states a *pairwise, issuance-time* rule:

> child resources MUST be a subset of parent resources;
> child actions MUST be a subset of parent actions;

and then, under "Conceptually:", a *whole-chain, verification-time* rule:

> `effective authority = intersection(authority of every certificate in the chain)`

These are not the same statement and they do not have the same threat model.

- The **pairwise** rule is enforced by *the issuer*. A verifier that relies on it is trusting
  every intermediate certificate holder to have run a correct subset check. An intermediate that
  simply did not run one — or ran a buggy one — produces a chain that a downstream verifier
  accepts.
- The **fold** rule is enforced by *the verifier*, against the concrete request, with zero trust
  in any intermediate.

The RFC's §15 invariant "A child certificate cannot increase authority" is stated as a property
of the *certificate*, which is the pairwise framing. It should be restated as a property of the
*effective authority of the chain*, which is the fold framing, because only the second is
something a verifier can enforce on its own.

**This ambiguity, not the choice of match operators, is the actual escalation surface.** The
operator table matters second.

## A.2 What this codebase already has — assessment

The review asks the RFC to introduce an `attenuates(parent, child)` algorithm. The relevant
finding is that **no such function exists in this repository, and its absence is a deliberate
property rather than a gap.**

### A.2.1 The data model

`packages/core/src/capability.ts` defines:

```ts
export type Ability = 'execute' | 'read' | 'delegate'

export interface Delegation {
  readonly issuer: PublicKeyHex
  readonly audience: PublicKeyHex
  readonly ownerId: string
  readonly abilities: readonly Ability[]
  readonly expiresAt: number
  readonly signature: string
}
```

`Ability` carries the comment *"What a delegation permits. Coarse on purpose — finer scopes can
be added later."* That comment is the entry point for this whole response: the review is asking
what happens when "later" arrives.

### A.2.2 The verification rule is already a fold, not a pairwise check

`verifyChain` in the same file never compares link `i` against link `i-1` on abilities. It
checks the **requested** ability against **every** link:

```ts
if (!link.abilities.includes(options.ability)) {
  return fail({ kind: 'missing-ability', index: i, ability: options.ability })
}
```

and it folds the time dimension explicitly, under a comment that states the rule in words:

```ts
// The chain is only valid until its earliest expiry.
const expiresAt = Math.min(...chain.map((link) => link.expiresAt))
```

The owner scope is likewise checked per link (`owner-mismatch`), and the tail is bound to the
verifier by `wrong-audience`, whose text is *"chain ends at … but this node is …"*.

**Consequence, and it is the load-bearing observation of Part A:** on this build, a child link
that lists *more* abilities than its parent is **inert, not dangerous**. If the extra ability is
the one requested, verification fails at the *parent's* link, because the parent is also tested
against `options.ability`. Amplification is impossible **without** a correct subset predicate,
because there is no subset predicate in the trust path at all.

The repository has independently arrived at the same property Biscuit gets from append-only
Datalog blocks: restrictions accumulate monotonically and no link can widen what an earlier link
narrowed. It got there by re-checking the requirement at every link instead of by comparing
links to each other.

### A.2.3 Why it is sound today, and exactly when it stops being

Today's check is sound for a reason that will not survive the reviewer's list: `Ability` is a
**three-element closed set matched by equality** (`Array.prototype.includes`). Set membership
over a finite domain of atoms has no ambiguity to get wrong. There is no prefix, no wildcard, no
range, no CIDR, no quota, and no regex anywhere in `capability.ts` — a grep for those terms
returns nothing.

The escalation risk the review names arrives at the moment a dimension is added whose matching
is **not equality**. That is the moment this document exists to specify in advance.

### A.2.4 A canonical form already exists and is already load-bearing

`payloadOf` sorts before signing, with the reason in the comment:

```ts
// Sorted so two callers listing the same abilities in a different order produce
// the same bytes, and therefore the same signature.
abilities: [...delegation.abilities].sort(),
```

and everything hashed goes through `encodeCanonical` in `packages/core/src/canonical/encode.ts`,
which is strict DAG-CBOR and refuses non-finite floats (`{ kind: 'non-finite-float' }`). The same
file records why protobuf is refused for anything hashed — *"serialization 'is not canonical' and
is unstable across languages, builds, and schema versions"*.

So the "canonical normalised capability format" the review asks for is **half-built already**:
the codec, the sorting discipline and the refusal-to-encode path exist. What is missing is the
*schema* the codec is applied to.

### A.2.5 Where the chain rides in production

`packages/net/src/capability-authorizer.ts` is the only production caller. It calls:

```ts
const result = verifyChain(request.capability, {
  ownerKey,
  ownerId: task.ownerId,
  audience: options.audience,
  ability: 'execute',
  now: options.now(),
})
```

Two things follow. First, the requested authority today is a **single scalar** — `'execute'` —
with no resource term at all; the resource is implicitly "this owner's data", carried by
`ownerId` and enforced by equality at every link. Second, the chain reaches the verifier on the
*request*, and the audience is *this node's own key*, so a chain captured off the wire cannot be
replayed at a different node. That property must survive any change made here.

`packages/net/src/remote-executor.ts` types the supplier as
`export type CapabilitySupplier = (task: Task) => readonly Delegation[]`, and states the reason
the chain rides on the per-remote adapter rather than on `Task`:

> The chain rides on this **per-remote adapter rather than on `Task`** because the audience a
> chain must end at is *this* remote node's key: a chain minted for node A is refused at node B
> with `wrong-audience`. A task is one description of work that may be dispatched to several
> nodes, so a chain carried on it could only ever name one of them.

**Any algebra proposed here must keep the audience out of the shared object**, or the same chain
becomes replayable across nodes. Note also that the third constructor parameter is *required, not
optional*, with the sentinel `'dispatches-unauthenticated'` — an explicit opt-out rather than a
silent default. The same discipline should apply to any envelope check added in Part B.

### A.2.6 The gap that joins Part A to Part B

`verifyChain` answers "may this principal execute *for this owner* at *this node*, *now*". It
does not answer "may this principal execute **this task**". Nothing in `Delegation` names a
`moduleCid`, an `inputCid`, a shard range, or anything else about the work — the signed payload
is exactly `issuer`, `audience`, `ownerId`, `abilities`, `expiresAt`, and `payloadOf` builds no
other field, so anything not in that list is unsigned by construction.

**Consequence: a chain valid for one sovereign task of an owner is valid for every sovereign task
of that owner at that node, until its earliest expiry.** There is no nonce, no `notBefore`, no
single-use marker and no seen-set anywhere in `capability.ts`, so the chain is a bearer credential for
that whole window.

This is not a separate defect from point 4 — it is the same defect seen from the authority side.
The `capabilities` field of the `ExecutionEnvelope` in §B.4.1 and the `Invocation` binding in
§B.4.3 are what close it, which is why the two review points are answered in one document.

### A.2.7 The repository has already considered, and declined, the obvious prior art

`capability.ts`'s own header records the decision:

> Rolled by hand rather than pulling in UCAN or an SPKI library … Adopting UCAN would mean
> adopting DID resolution, a JWT envelope, and a specification still in flux, to gain semantics
> this project does not yet use. Revisit if interop with other UCAN systems is ever wanted.

That reasoning still holds for the *envelope* (DID resolution and JWT remain unwanted). It does
**not** hold for the *algebra*: "semantics this project does not yet use" is precisely what the
review is asking the RFC to specify before they are needed. §B.6 therefore takes structure from
SPKI and UCAN without taking either wire format.

### A.2.8 Summary of the assessment

| The review asks for | State in this repo |
|---|---|
| canonical normalised capability format | **partial** — DAG-CBOR codec + sort discipline exist; no capability schema |
| `attenuates(parent, child)` | **absent, deliberately** — the trust path never compares two links |
| intersection rule over the whole chain | **present** — per-link ability test; `Math.min` over expiry |
| boundary test vectors | **not applicable yet** — equality over three atoms has no boundaries |
| (not asked, but found) chain bound to the work | **absent** — §A.2.6 |
| (not asked, but found) replay protection on a chain | **absent** — no nonce, no `notBefore` |

All nine `ChainFailure` kinds are covered by tests in
`packages/core/src/capability.test.ts`, including one titled *"gives a distinct reason for every
failure kind"*. There is **no** test asserting attenuation between links, which is consistent:
no such check exists to test.

The honest reading is that the repository is *ahead* of the RFC on the chain rule and *behind* it
on the format. This response therefore recommends specifying the format so that it preserves the
chain rule already implemented, rather than replacing it.

## A.3 Options, with costs

**Option 1 — free-form resource/action strings plus a subset predicate.**
This is UCAN 0.x's `att: [{with, can}]` shape, where the subset relation over arbitrary resource
URIs and ability strings is left to the resource server. Cost: the predicate is under-specified
by construction, every server invents its own, and the escalation the review predicts is exactly
what happens. UCAN's own later direction is evidence against this option.

**Option 2 — Datalog with append-only attenuation (Biscuit).**
Attenuation is sound *by construction*: a credential is a list of blocks, a block may only **add**
checks, and the check language is monotonic, so there is no subset predicate to get wrong. Cost:
a Datalog evaluator in the browser bundle; verification cost is data-dependent rather than
bounded by the credential's size; and the authority a credential carries is not directly enumerable, only
testable — which makes UI and introspection hard.

**Option 3 — a typed lattice over a closed set of dimension kinds** (SPKI/SDSI tag intersection,
modernised). Each dimension has a decidable `contains` and a `meet` that is **closed** in the
format. Cost: expressiveness is bounded by the kind list; anything not expressible must be
enumerated; adding a kind is a versioned protocol change.

**Option 4 — a predicate language evaluated against the invocation** (UCAN 1.0's `pol` direction).
Cost: a small interpreter, and the containment question ("does policy A imply policy B") is
generally *not* decided — the system sidesteps it by never asking, evaluating every policy in the
chain against the concrete invocation instead.

### A.3.1 RECOMMENDATION

**Option 3 as the normative format, evaluated by the fold rule of Option 4.**

Reasons, in order of weight:

1. It preserves what is already implemented. `Ability`, `ownerId` and `expiresAt` become three
   dimensions of the lattice, and `verifyChain`'s existing loop becomes the general evaluator.
   This is a generalisation, not a rewrite.
2. `meet` being closed is a *checkable* property of a finite kind table, so the review's
   requirement that intersection be closed becomes a test rather than an aspiration.
3. No interpreter and no Datalog engine enters the browser bundle. Verification cost is linear in
   chain length × dimension count, with no data-dependent blow-up — which matters because
   `authorizeCapability` runs on the `exec` path.
4. Enumerability. `effectiveAuthority(chain)` returns a value that can be displayed and
   re-delegated. Option 2 cannot do this.

The cost accepted: **bounded expressiveness**, discussed honestly in §A.4.5 and §A.6.

## A.4 RFC-ready text

> The remainder of §A.4 is drafted to be lifted into RFC-0003 §5 with minimal editing.

### A.4.1 Canonical form

An `AuthorityRule` is a **conjunction of typed constraints over named dimensions**. It is
positive-only: there is no `deny`.

```
AuthorityRule ::= { scope: { <dimensionName>: Constraint } }

Constraint ::=
    { k: "any" }                                  -- ⊤ for this dimension
  | { k: "none" }                                 -- ⊥; a rule with any ⊥ permits nothing
  | { k: "set",    v: [Atom] }                    -- finite set of atoms, sorted, deduped
  | { k: "prefix", v: [Segment] }                 -- SEGMENT-wise prefix, never string-wise
  | { k: "range",  lo: int, hi: int }             -- closed integer interval
  | { k: "window", nb: int, na: int }             -- [nb, na) in Unix ms; `na` EXCLUSIVE
  | { k: "cidr",   fam: 4|6, net: bytes, len: int }
  | { k: "quota",  n: uint }                      -- a numeric ceiling; see §A.4.5
```

A dimension **absent** from a rule is *inherited* from the enclosing chain context, not treated as
`any`. See §A.4.3 for why, and note that this makes short delegations short.

#### What is FORBIDDEN in the canonical form, and why

**Regular expressions — forbidden, normatively.** Three independent reasons, any one sufficient:

1. *Containment is not tractable where it must run.* Deciding whether the language of one regex
   contains another's is PSPACE-complete for NFAs; the practical algorithms are exponential in
   the worst case. This predicate would sit on the `exec` path in a browser tab.
2. *It hands an attacker a denial-of-service primitive.* JavaScript's `RegExp` is a backtracking
   engine, so a regex embedded in a delegation is a ReDoS payload that fires inside **every**
   verifier that reads the delegation — including verifiers that are going to refuse it. The
   damage is done during parsing, before any authorization decision.
3. *Semantics are not pinned across engines.* `RegExp` behaviour varies with the `u`/`v` flags,
   with Unicode property-escape data, and with engine version. Two verifiers that disagree about
   whether a request matches are a **fork in the authorization decision**, which is strictly worse
   than either answer.

Reason 3 is the same argument this project already makes about relaxed-SIMD in `CLAUDE.md`: a
construct whose semantics cannot be pinned across engines is refused at publish time rather than
configured at runtime. Regex in a capability is that construct.

Also forbidden:

- **Substring / `contains` matching.** It has no lattice structure — the meet of two substring
  patterns is not in general a substring pattern, so the format would not be closed.
- **Glob with `*` inside a segment.** Same failure: `a*c ∧ ab*` has no glob representative in
  general. Whole-segment wildcards are expressible as `prefix`, which is closed; partial-segment
  ones are not, and are refused.
- **Floating-point in any constraint.** `encodeCanonical` refuses non-finite floats, and admitting
  finite ones would put a value in the signed payload whose comparison semantics differ from its
  encoding. Quotas, ranges and windows are integers.
- **`deny` / negative rules.** Argued in §A.4.5.
- **Unknown constraint kinds.** A verifier that meets a `k` it does not implement MUST fail
  closed, matching RFC-0003 §10 (*"The validator must reject on ambiguity"*) and the `critical`
  extension discipline of §4.

#### Normalisation

`normalise(rule)` MUST be applied before hashing, signing or comparing. It mirrors
`normaliseFeatures` in `packages/aot/src/cache-key.ts`, which exists for the same reason.

1. Dimensions sorted by name. Sets sorted and de-duplicated.
2. **One representation per permitted set.** A single-atom `set` is the only spelling of an exact
   match; there is no separate `eq` kind. `range(lo,hi)` with `lo > hi` normalises to `none`.
   `prefix([])` normalises to `any`. `cidr` host bits are zeroed. `/0` normalises to `any`.
3. Path segments are percent-decoded **exactly once**, then re-encoded canonically. A `%` that
   survives one decode is a literal `%`. Double decoding is forbidden.
4. Segments equal to `.` or `..`, **and empty interior segments**, are **refused at parse**, not
   resolved or collapsed. Resolving is where differential-parsing bugs live; refusing is decidable
   and has no ambiguity. Empty segments are named explicitly because collapsing them is the
   intuitive fix and it is wrong — see vector `PP-01b`.
5. No case folding, ever. Unicode case folding is version- and locale-dependent, so folding would
   reintroduce reason 3 above by a different route. Matching is byte-exact after step 3.

**Normative invariant, and the one to test by exhaustion:**

> Two `AuthorityRule`s that permit the same set of requests MUST encode to identical DAG-CBOR
> bytes.

This is what makes a CID over a rule meaningful, and it is checkable by generating a corpus and
comparing `canonicalCid` outputs against a reference `permits` oracle.

### A.4.2 `attenuates(parent, child)` — the algorithm

```
attenuates(parent, child) -> bool:
    P := normalise(parent)
    C := normalise(child)

    # Fail closed on anything not understood. Not a special case: it is the rule.
    if C contains a constraint kind not implemented by this verifier: return false
    if P contains a constraint kind not implemented by this verifier: return false

    for d in dimensions(P):
        pc := P.scope[d]
        cc := C.scope[d]  if present  else  pc     # absent = inherited (§A.4.3)
        if not contains(pc, cc): return false

    # Dimensions present only on the child constrain something the parent left open.
    # That is strictly narrowing, and therefore always permitted.
    return true
```

`contains(pc, cc)` — read as "parent constraint `pc` permits everything child constraint `cc`
permits". Kinds must match, or the parent must be `any`.

| `pc` | `cc` | `contains` iff |
|---|---|---|
| `any` | *anything* | **true** |
| *anything* | `none` | **true** |
| `none` | anything but `none` | **false** |
| `set(P)` | `set(C)` | `C ⊆ P` |
| `set(P)` | `prefix(_)` | **false** — a finite set of atoms does not contain a subtree |
| `prefix(p)` | `prefix(c)` | `p.length ≤ c.length` and `p[i] === c[i]` for all `i < p.length` |
| `prefix(p)` | `set(S)` | every `s ∈ S` is segment-wise under `p` — *the one admitted cross-kind rule* |
| `range(pl,ph)` | `range(cl,ch)` | `pl ≤ cl` and `ch ≤ ph` |
| `window(pn,px)` | `window(cn,cx)` | `pn ≤ cn` and `cx ≤ px` |
| `cidr(f,pn,pl)` | `cidr(f,cn,cl)` | same `f`, `pl ≤ cl`, and `cn`'s first `pl` bits equal `pn`'s |
| `cidr(4,…)` | `cidr(6,…)` | **false** — see vector `CI-05` |
| `quota(p)` | `quota(c)` | `c ≤ p` |
| any other kind pair | | **false** |

#### Two implementation traps, both with recent CVEs, both live in the loop above

**Trap 1 — the existential/universal confusion.** The loop is `for d in dimensions(P)` with an
early `return false`, i.e. a **universal** quantifier. Writing it as "does *some* dimension
contain?" inverts the check. This is not a hypothetical slip: CVE-2026-43886 (Outline, CVSS 8.2,
2026) is exactly this — `Array.some()` where `Array.every()` was required in an OAuth scope subset
check, so `scope=read *` short-circuits on `read` and returns the array **still containing** `*`.
Normative for implementers: the subset check is `every`, and a test must exist whose only
difference from a passing case is a second dimension that fails.

**Trap 2 — vacuous truth over an empty or absent constraint.** `∀x ∈ ∅` is true, so a check
written over "the constraints the child mentions" passes trivially when the child mentions none.
AWS documents this as shipped behaviour for `ForAllValues`: *"It also returns `true` if there are
no context keys in the request"* — an **absent** attribute satisfies an **arbitrarily restrictive**
constraint, and AWS's answer is a manual `Null`-check workaround rather than a fix.

This is precisely why §A.4.2 iterates `dimensions(P)` — the **parent's** dimensions — and not the
child's, and why an absent child dimension resolves to `pc` (inherit) rather than to `TOP(d)`.
Iterating the child's dimensions would make an empty child rule attenuate anything. The related
widening trap is AWS's incomplete-ARN rule (*"specifying `arn:aws:sqs` is equivalent to
`arn:aws:sqs:*:*:*`"*): **under-specification silently widens to maximal.** A capability format
must do the opposite, which is what §A.4.1's fail-closed unknown-kind rule and this loop's
direction together achieve.

#### The monotonicity property `attenuates` must preserve

Let `permits(R)` be the set of concrete requests a rule admits. The property is:

> **Soundness (security-critical):** `attenuates(A, B) ⟹ permits(B) ⊆ permits(A)`
> **Completeness (usability):** `permits(B) ⊆ permits(A) ⟹ attenuates(A, B)`

State the asymmetry plainly, because it is what the review's sentence is really about:

- A **soundness** bug is a privilege escalation.
- A **completeness** bug is a false rejection — an availability defect, never an escalation.

The recommendation in §A.4.3 deliberately admits some incompleteness (the cross-kind rules that
return `false`) in exchange for a soundness argument small enough to audit by reading the table
above.

And the design's real answer to the review: **under the chain rule of §A.4.3, a soundness bug in
`attenuates` is still not an escalation**, because `attenuates` is not on the enforcement path.
See below.

### A.4.3 The chain rule — fold-intersection, not pairwise

**Normative:** the authorization decision is a **fold over every link, evaluated against the
concrete request, at the verifier.**

```
authorizes(chain, request) -> bool:
    for link in chain:
        if not permits(link.authority, request): return false
    return true

effectiveAuthority(chain) -> AuthorityRule:
    return fold(meet, TOP, [link.authority for link in chain])
```

Two evaluation modes exist and MUST NOT be conflated:

| | used for | needs `meet` closed? |
|---|---|---|
| `authorizes(chain, request)` | **the security decision** | no |
| `effectiveAuthority(chain)` | display, introspection, re-delegation | yes |

Why fold rather than pairwise, in order:

1. **Pairwise trusts issuers; fold does not.** Under pairwise, a verifier accepting a chain is
   asserting that every intermediate ran a correct subset check. Under fold, the verifier checks
   the thing it actually cares about — this request against this chain — and needs to trust no
   intermediate at all.
2. **It is already what the code does.** `verifyChain` tests `options.ability` against every link,
   and folds expiry with `Math.min` under the comment *"The chain is only valid until its earliest
   expiry."* Adopting fold as the RFC's normative rule makes the specification agree with the
   implementation rather than the other way round.
3. **An amplifying link becomes inert.** A child that grants more than its parent is harmless,
   because the parent link is also evaluated. This is the same guarantee Biscuit obtains from
   append-only blocks, and it means `attenuates` can be demoted to an **issuance-time hygiene
   check** whose failure costs a confusing credential, not a breach.
4. **A deployed spec already does exactly this, and its wording should be borrowed.** TUF contains
   **no subset requirement on delegations at all**; attenuation is enforced entirely client-side:
   *"Clients MUST check that a target is in one of the trusted paths of **all roles in a delegation
   chain**, not just in a trusted path of the role that describes the target file."* A TUF
   delegatee may declare `paths: ["**"]` and nothing rejects it — a conforming client refuses
   anything outside the delegator's paths regardless. That is "an amplifying link is inert",
   shipped. It also carries the honest caveat this RFC must repeat: the guarantee **rests entirely
   on client conformance**, which is acceptable here only because the verifier is the party being
   protected.
5. **Fold is associative and commutative, so it is order-independent**, and cannot be confused by
   a reordered chain. (Reordering is separately prevented by the `broken-link` check, so this is
   belt and braces — which is the correct amount for an authorization decision.)

**`attenuates` is therefore RECOMMENDED at issuance and OPTIONAL at verification.** The RFC
should say this explicitly, because "child MUST be a subset of parent" currently reads as though
the verifier's job.

#### Closure of `meet` — required, and satisfied

The review requires that intersection be closed: if two rules intersect to something not
expressible in the canonical form, the format is wrong. The kind table satisfies this:

| `a ∧ b` | result | closed? |
|---|---|---|
| `set ∧ set` | set intersection | yes |
| `prefix ∧ prefix` | the longer, if one is a prefix of the other; else `none` | yes |
| `range ∧ range` | `range(max(lo), min(hi))`, `none` if empty | yes |
| `window ∧ window` | as `range` | yes |
| `cidr ∧ cidr` | the longer, if nested; else `none` | yes |
| `quota ∧ quota` | `quota(min(a,b))` | yes |
| `set ∧ prefix` | the subset of the set lying under the prefix → `set` | yes |
| `any ∧ x` | `x` | yes |
| any other kind pair | `none` | yes |

`prefix ∧ prefix` and `cidr ∧ cidr` are closed for the same structural reason, and it is worth
stating because it is *why* these two kinds are admitted and glob is not: **segment prefixes form
a tree, so any two are either nested or disjoint.** There is no third case needing a
representation the format lacks. Glob has a third case, which is precisely why it is forbidden.

**This closure table is a test obligation, not a claim.** It should be checked by exhaustive
generation over each kind pair, asserting `permits(a ∧ b) == permits(a) ∩ permits(b)` against an
independent oracle.

### A.4.4 Mapping the existing model onto the algebra

Nothing in `capability.ts` is discarded:

| today | becomes |
|---|---|
| `abilities: readonly Ability[]` | dimension `ability`, `{k:"set", v:[…]}` — already sorted by `payloadOf` |
| `ownerId: string` | dimension `owner`, `{k:"set", v:[ownerId]}` |
| `expiresAt: number` | dimension `time`, `{k:"window", nb:0, na:expiresAt}` |
| `link.abilities.includes(options.ability)` | `permits(link.authority, request)` |
| `Math.min(...chain.map(l => l.expiresAt))` | `meet` on dimension `time` |
| `wrong-audience` tail check | unchanged; stays outside the algebra |
| `not-delegable` | unchanged; `delegate` stays an atom of `ability` |

The audience check MUST stay outside the algebra. It is not an attenuation question — it is the
binding that stops a chain captured at node A from being presented at node B — and
`capability-authorizer.ts` takes the audience from the node's own identity for that reason.

### A.4.5 Two expressiveness costs, stated rather than hidden

**`deny` is forbidden, and that loses something real.** A positive-only conjunction has no way to
say "everything under `/a` except `/a/secret`" other than by enumerating the permitted subtrees.
For a wide tree that enumeration is large or impossible. The reason to accept this cost:
allow/deny combination requires an *ordering* rule (first-match, most-specific-wins,
explicit-deny-overrides), every such rule is a different algebra, and the differences between
them are exactly where AWS-IAM-class and Kubernetes-RBAC-class evaluation bugs live. A
semilattice has no ordering to get wrong. **Cost accepted; see §A.6.**

**`quota` is not a lattice element and must not be presented as one.** `min` is the correct meet
for the *static bound*, and `contains` is correct for attenuation. But a quota is **consumed**,
not merely tested. Two verifiers each admitting a request under `quota(100)`, offline and without
a shared counter, admit 200 in total — and this fabric has no shared counter by construction.

Normative consequence: **`quota` is per-verifier, per-epoch, and MUST be labelled as such in the
RFC.** A global quota is not enforceable by offline chain verification. Two partial mitigations:
scope the quota to a job nonce so it is one-shot (§B.4), or treat it as a rate ceiling per node.
Neither gives a global bound. **Marked UNRESOLVED in §A.6 rather than described as solved.**

There is a working precedent for the per-verifier reading inside this repository, and it should
be followed rather than re-invented: `packages/core/src/enrollment.ts` is the **only** module that
already implements a quota, and it implements exactly the local kind. Its refusals are
`{ kind: 'rate-limited', userKey, limit, windowMs, retryAfterMs }` and
`{ kind: 'issuance-budget-exhausted', limit, windowMs, retryAfterMs }`, over an `IssuanceLedger`
whose non-persistent arm is the sentinel `'remembers-only-within-this-process'`, with
`DEFAULT_ISSUANCE_WINDOW_MS = 3_600_000`.

That sentinel is the honest statement this design needs: **the ledger is local and admits it.** A
`quota` constraint in an `AuthorityRule` should refuse in the same shape, carrying `limit`,
`windowMs` and `retryAfterMs`, so that a caller can tell a *quota* refusal from an *authority*
refusal — they are different claims about different things.

### A.4.6 Boundary test vectors

Expectations below are the *specification*. Per this project's convention, each must be watched
to fail against a planted mutation before it is trusted; a vector that has never been seen red
carries no claim.

#### Path prefix — the escalation family

| id | parent | child | expect | why |
|---|---|---|---|---|
| `PP-01` | `prefix(["a"])` | `prefix(["ab"])` | **FAIL** | The canonical bug. String-prefix says pass (`"/a"` is a prefix of `"/ab"`); segment-prefix compares `"a" !== "ab"`. Any implementation that passes this is escalating. See the evidence below — this is not hypothetical. |
| `PP-01b` | `prefix(["admin"])` | request path `//admin` | **FAIL to match the parent, and REJECT AT PARSE** | Empty segments. A naive split on `/` yields `["", "admin"]`, which is *not* under `["admin"]` — so a **deny** rule silently stops applying. Normalisation MUST refuse empty interior segments rather than collapse them; collapsing re-creates the same divergence one layer down. |
| `PP-02` | `prefix(["a"])` | `prefix(["a","b"])` | PASS | `/a/b` is under `/a`. |
| `PP-03` | `prefix(["a"])` | `prefix(["a"])` from input `"/a/"` | PASS | Trailing separator normalises away; the two encode identically (tests §A.4.1 invariant). |
| `PP-04` | `prefix(["a"])` | input `"/a/../b"` | **REJECT AT PARSE** | `..` refused, not resolved. Returns a parse failure, not `false`, so the two outcomes stay distinguishable. |
| `PP-05` | `prefix(["a"])` | input `"/a/%2e%2e/b"` | **REJECT AT PARSE** | One decode yields `..`; rule `PP-04` then applies. Catches a decoder that checks before decoding. |
| `PP-06` | `prefix(["a"])` | input `"/a%2Fb"` → `prefix(["a/b"])` | **FAIL** | After a single decode the segment *contains* `/` and is not split on it. Catches a decoder that splits after decoding — which would wrongly yield `["a","b"]` and PASS. |
| `PP-07` | `prefix(["a"])` | `prefix(["A"])` | **FAIL** | No case folding. |
| `PP-08` | `prefix(["a","b"])` | `prefix(["a"])` | **FAIL** | Child broader. |
| `PP-09` | `prefix([])` ≡ `any` | anything | PASS | Top. |
| `PP-10` | `prefix(["a"])` | `set(["a/b"])` after decode → atom containing `/` | **FAIL** | Same trap as `PP-06`, via the one admitted cross-kind rule. |

**`PP-01` is the single most-evidenced failure in the corpus, and the RFC should say so.** Four
independent confirmations, each of a different kind:

1. **A capability spec forbids it normatively.** UCAN 1.0's `cmd` rule: *"Shorter Commands prove
   longer paths… `/crypto` MAY be used to prove `/crypto/sign` but MUST NOT prove `/stack/pop` or
   `/cryptocurrency`."* `/crypto` vs `/cryptocurrency` **is** `/a` vs `/ab`, called out and
   forbidden inside a delegation format.
2. **The nearest prior art has the bug.** SPKI's `(* prefix <byte-string>)` is defined over byte
   strings — a raw string prefix. §A.4's design takes SPKI's structure and **must not** take its
   prefix semantics.
3. **Kubernetes' own privilege-escalation guard has the bug.** `nonResourceURLCovers` in
   `policy_comparator.go` is `strings.HasSuffix(ownerPath, "*") && strings.HasPrefix(subPath, …)`
   — raw `strings.HasPrefix`, so `/metrics*` covers `/metricsXYZ`. There is no CVE (the surface is
   admin-controlled and the behaviour is intended), and that is exactly why it belongs here: this
   shape of check survives review *inside an escalation guard* because it looks correct.
4. **`PP-01b`'s variant shipped as a CVE.** Istio CVE-2021-31920: a `DENY` policy on `/admin`
   fails to block `//admin`.

And the reason `PP-04`/`PP-05` **reject** rather than normalise is itself borrowed: SPIRE
CVE-2021-27099 was fixed by rejecting non-canonical identifiers at the API boundary rather than
normalising them during the check. Normalising during the check means two code paths must agree
about canonical form; rejecting at the boundary means only one has to.

The general lesson the RFC should state in one line, evidenced by Apache Shiro's **six** CVEs in
two years (CVE-2020-1957, -11989, -13933, -17510, CVE-2021-41303, CVE-2022-32532): the bug was
never in either path matcher. It was in **assuming two independently-written matchers agree about
set membership.** This is the same failure mode as the TUF divergence in §B.6.2, where python-tuf
(`fnmatch`, case-insensitive on Windows) and tuf-js (segment-count + `minimatch`) make **different
authorization decisions on identical metadata**. It is why §A.4.1 forbids regex on cross-engine
grounds and why the matcher must be pinned normatively, not left to "a path match".

#### Wildcard vs literal

| id | parent | child | expect |
|---|---|---|---|
| `WL-01` | `set(["read","write"])` | `set(["read"])` | PASS |
| `WL-02` | `set(["read"])` | `set(["read","write"])` | **FAIL** |
| `WL-03` | `any` | `set(["read"])` | PASS |
| `WL-04` | `set(["read"])` | `any` (written explicitly) | **FAIL** — pins that an *explicit* `any` on the child is widening even though an *absent* dimension is not |
| `WL-05` | `prefix(["job"])` | `set(["job/1","job/2"])` | PASS — the admitted cross-kind rule |
| `WL-06` | `set(["job"])` | `prefix(["job"])` | **FAIL** — one atom does not contain a subtree |
| `WL-07` | any | `{k:"regex", …}` | **REJECT AT PARSE** — forbidden kind, fail closed |

#### Quota arithmetic

| id | parent | child | expect |
|---|---|---|---|
| `QU-01` | `quota(100)` | `quota(100)` | PASS |
| `QU-02` | `quota(100)` | `quota(101)` | **FAIL** |
| `QU-03` | `quota(0)` | `quota(0)` | PASS, and permits nothing |
| `QU-04` | — | `quota(-1)` | **REJECT AT PARSE** |
| `QU-05` | `quota(100) ∧ quota(50)` | | `quota(50)` |
| `QU-06` | two verifiers, `quota(50)` each | | **each admits 50; 100 total.** Not a bug in the algebra — a documented limit of offline verification (§A.4.5) |

#### Time-window containment

| id | parent | child | expect |
|---|---|---|---|
| `TW-01` | `window(100,200)` | `window(120,180)` | PASS |
| `TW-02` | `window(100,200)` | `window(100,201)` | **FAIL** |
| `TW-03` | `window(100,200)` | `window(99,200)` | **FAIL** |
| `TW-04` | request at `now == 200` under `window(100,200)` | | **DENY** — `na` is exclusive, matching the existing `if (link.expiresAt <= options.now)` in `verifyChain` |
| `TW-05` | — | `window(200,100)` | normalises to `none` |
| `TW-06` | chain `[na=1000, na=500, na=1000]`, `now=700` | | **DENY**, and `effectiveAuthority` reports `na=500` |

#### CIDR containment

| id | parent | child | expect |
|---|---|---|---|
| `CI-01` | `10.0.0.0/8` | `10.1.0.0/16` | PASS |
| `CI-02` | `10.0.0.0/8` | `10.0.0.0/7` | **FAIL** |
| `CI-03` | `10.1.2.3/8` | `10.0.0.0/8` | PASS **and both encode identically** — host bits zeroed by normalisation (tests §A.4.1 invariant) |
| `CI-04` | `0.0.0.0/0` | anything v4 | PASS ≡ `any` |
| `CI-05` | `10.0.0.0/8` | `::ffff:10.0.0.0/104` | **REJECT AT PARSE** — IPv4-mapped IPv6 refused; treating the families as comparable is a known escalation surface |
| `CI-06` | `10.0.0.0/8` | `10.0.0.0/33` | **REJECT AT PARSE** — prefix length out of range for family |

#### Allow/deny ordering

| id | case | expect |
|---|---|---|
| `AD-01` | any rule containing a `deny` | **REJECT AT PARSE** |
| `AD-02` | "under `/a` except `/a/secret`" | not expressible; must be enumerated as permitted subtrees. Documented cost, §A.4.5 |

#### Chain-level (the fold)

| id | chain | request | expect |
|---|---|---|---|
| `CH-01` | `[any, set(["read"]), any]` | `read` | PASS |
| `CH-02` | `[any, set(["read"]), any]` | `write` | **FAIL at link 1** — a widening tail link is inert |
| `CH-03` | `[set(["read"]), set(["read","write"])]` | `write` | **FAIL at link 0** — the amplification vector. Proves the fold: with a pairwise-only check and no verifier-side fold, a buggy issuer makes this pass |
| `CH-04` | `[]` | anything | **FAIL** — `empty-chain`, unchanged |
| `CH-05` | chain valid for owner X | request naming owner Y | **FAIL** — `owner-mismatch`, unchanged |
| `CH-06` | chain ending at node A | presented to node B | **FAIL** — `wrong-audience`, unchanged |

`CH-03` is the vector that carries the whole of Part A. It is also the one an implementation of
the RFC's *current* §5 wording (pairwise, at issuance) would not catch at the verifier.

## A.5 What changes in the RFC text

1. §5 — mark the fold normative and demote the pairwise bullets to "SHOULD, at issuance". Replace
   "Conceptually:" with a normative statement.
2. §15 — restate "A child certificate cannot increase authority" as "**The effective authority of
   a chain is the meet of its links; a link cannot widen what an earlier link narrowed.**" The
   first is unenforceable by a verifier; the second is what the code does.
3. §4 — `authority SEQUENCE OF AuthorityRule` needs the `Constraint` schema of §A.4.1, and
   `policyVersion` must gate the constraint-kind set.
4. §12 — "Authority / Capability Set" and "Delegation Constraints" collapse into one registry
   entry, because under this algebra a constraint *is* a capability term.

## A.6 UNRESOLVED (point 3)

- **Global quota.** Not enforceable offline; §A.4.5. Per-node/per-epoch is what the format can
  honestly carry. No solution is proposed.
- **Expressiveness lost with `deny`.** §A.4.5, vector `AD-02`. Accepted, not solved.
- **`policyVersion` downgrade.** Dimensions live inside the signed payload, so *stripping* one
  breaks the signature. But a version downgrade in which the *same bytes parse differently under
  two versions* is not prevented by the signature. Mitigation requires the version inside the
  signed payload **and** a verifier that refuses versions it does not implement — which turns
  every kind addition into a flag day. No good answer here.
- **Completeness of `contains` across kinds.** Only one cross-kind rule is admitted; the rest
  return `false`. Sound, deliberately incomplete, and the incompleteness will produce confusing
  false rejections that nobody has yet catalogued.
- **Replay within the validity window is not addressed by the algebra and must not be claimed to
  be.** A `Delegation` has no nonce and no `notBefore`, so it is a bearer credential at its audience
  until `Math.min(expiresAt)`. Narrowing the *authority* does not narrow the *number of times* it
  may be used. The `Invocation` of §B.4.1 is the proposed fix, and it lives outside the algebra
  deliberately — a delegation is meant to be reusable, an invocation is not.
- **Revocation and freshness are orthogonal and untouched.** An attenuation algebra says nothing
  about whether a link is still valid. That is review point 2. Note in particular that a
  `quota` with a `windowMs` is *not* a freshness mechanism, and the two must not be conflated in
  the RFC text.
- **Nothing here is measured.** No implementation, no test, no benchmark. The closure table and
  the monotonicity property are stated as test obligations precisely because they are unverified.

---

# Part B — Point 4: binding the whole execution envelope

## B.1 The problem, restated precisely

A content hash is a claim about **bytes**. Every item on the reviewer's list is a claim about
**context**. A signature over the bytes alone therefore signs an under-specified proposition, and
the review's closing sentence — *"the module hash will still be correct"* — is exactly right.

Three distinct attacks, which want distinguishing because they have different fixes:

1. **Environment upgrade.** Same bundle, more privilege: more capabilities granted, higher
   limits, egress opened, a different WASM feature set enabled. Nothing about the module changes.
2. **Dependency substitution.** Same entrypoint module, different imports resolved by the host,
   or different linked modules. For WASM this is the *sharpest* variant, because imports are
   resolved by the host at instantiation and the module's own hash says nothing about what they
   resolved to.
3. **Replay.** A signed job re-submitted later, or to a different node. Fixed only by a nonce and
   an expiry *inside* the signed bytes.

## B.2 What this codebase already has — assessment

### B.2.1 The repository already treats identity as a tuple, not a hash

`packages/aot/src/cache-key.ts`:

```ts
export interface TranslationKey {
  readonly inputDigest: string
  readonly target: string
  readonly toolchain: ToolchainVersions   // { [tool: string]: string }
  readonly features: readonly string[]
}
export async function translationCid(key: TranslationKey): Promise<KeyResult>
export interface TranslationRecord {
  readonly keyCid: CID
  readonly key: TranslationKey
  readonly artifactCid: CID
}
```

and `translationKeyOf` in `tools/aot/lift.ts` carries the doc comment:

> **The four things that could have changed these bytes, and nothing else.**

**This is the execution-envelope pattern, already implemented, at publish time.** The RFC's answer
to point 4 should be the same shape, generalised from "what produced these bytes" to "what these
bytes will run inside".

Three properties of that implementation are worth adopting wholesale:

- **It fails closed on an under-specified key.** `KeyFailure` includes
  `{ kind: 'empty-field', field }`, `{ kind: 'empty-toolchain' }`,
  `{ kind: 'blank-version', tool }` and `{ kind: 'unencodable', error }`. An envelope that does
  not say what it needs to say is refused, not defaulted.
- **It normalises before hashing.** `normaliseFeatures` sorts and de-duplicates, and
  `FeatureSet.required` carries the reason in its comment: *"DAG-CBOR preserves array order, so an
  unsorted list would give two machines different CIDs for one translation."*
- **It reads the requirement from the artifact rather than from the operator.**
  `LiftedArtifact.requiredFeatures` is documented *"Read from the artifact's own `target_features`
  section, never hardcoded"*, and `readTargetFeatures` in `tools/aot/features.ts` parses that
  custom section, with a `Cursor` that *"reports running off the end instead of reading zeroes"*
  because *"an artifact reported to need nothing is an artifact every node will happily accept."*

That last comment is a security argument about exactly the failure mode point 4 names, already
written down in this repository about a different object.

### B.2.2 The concrete gap: what a result attestation binds

`packages/core/src/result-attestation.ts`:

```ts
export interface ResultWork {
  readonly moduleCid: CID
  readonly inputCid: CID
  readonly partitionIndex: number
  readonly partitionCount: number
  readonly outputCid: CID
}
```

The signed work names the **module, the input, the shard position and the output — and nothing
about the environment.** Two nodes that ran the same module under different feature sets,
different memory limits, different host imports, or different granted capabilities produce
attestations that are indistinguishable in shape and that a quorum will compare as if they were
like for like.

`ResultAttestation` is `{ certificate: NodeCertificate, signature }`, and the `AttestedResult`
union's other arm is the sentinel `'signed-by-nobody'`. The signed challenge is built by
`resultChallenge(work, nodeKey)` — so the node's key is inside the signature, but the environment
is not. Note also that `ports.ts` records deliberately that *"`nodeId` identifies which node ran
it, and is deliberately NOT part of the compared digest"* — the comparison is over the work, which
is exactly why the work must name the envelope.

This is the single sharpest instance of the review's point inside the existing code.

### B.2.3 Egress exists as evidence, not as policy

`packages/net/src/egress.ts`:

```ts
export interface EgressEntry {
  readonly to: string; readonly bytes: number; readonly violation?: string
}
export interface EgressManifest {
  readonly nodeId: string; readonly ownerId: string
  readonly entries: readonly EgressEntry[]
  readonly totalBytes: number
  readonly violations: readonly string[]
}
export class EgressGuard implements Transport {
  guard(label: string, payload: Uint8Array): EgressHold
  get manifest(): EgressManifest
}
```

The manifest is documented as *"What left one node during a job. Signed by the owner to make it
attributable."* — a **record of what happened**, not a **declaration of what is permitted**.

**And the mechanism is content matching, not destination policy.** `EgressGuard` registers a
payload under an opaque `label` via `guard(label, payload)` and refuses any outbound frame whose
bytes match a registered value, throwing `EgressRefusal` with the text
`egress to ${to} refused: ${bytes}-byte frame carries ${violation}` — *"the inner transport is
never called"*. There is no allow-list, no host list, no port or network term, and no predicate
language anywhere in the module. `EgressEntry.to` is *recorded*, never *checked*.

So the review's "egress policy" has **two** gaps here, not one: there is no declaration bound in
advance, and there is no destination language for a declaration to be written in. §B.5 proposes
both, and reuses Part A's algebra for the second so the system does not acquire a second
constraint language.

### B.2.4 There is already a provenance gate on the module

`packages/core/src/executor/module-provenance.ts` exports `guardModuleProvenance(inner, provenance)`
over `ModuleProvenance { resolver: SignedNameResolver; now: () => number }`, refusing with

```ts
export type ModuleRefusal =
  | { readonly kind: 'no-record';    readonly moduleCid: string }
  | { readonly kind: 'unresolvable'; readonly failure: ResolveFailure; readonly reason: string }
  | { readonly kind: 'cid-mismatch'; readonly name: string; readonly signed: string; readonly dispatched: string }
```

and the refusal happens *"before any byte of the module is fetched"*. Its opt-out is the explicit
sentinel `'runs-unsigned-artifacts'` on `trustAnchors`, not a default.

The publisher identity it consults is `NameRecord` in `packages/core/src/naming.ts`
— `{ name, cid, version, expiresAt, signer, signature }` — verified by `SignedNameResolver`
against a `trustAnchors` set, with a `{ kind: 'rollback', name, have, offered }` failure guarding
monotonic `version`.

**So the *hook* where an envelope check belongs already exists**, wrapping an `Executor`, with a
signed publisher statement already flowing through it. The proposal below extends what that gate
checks rather than inventing a new interception point.

### B.2.5 The two publish-time mechanisms are not joined

This is the second concrete gap, and it is the one that makes point 4 tractable.

- `NameRecord` (naming.ts) is **signed** and says *who* published a CID, with rollback protection.
- `TranslationRecord` (cache-key.ts) is **unsigned** — `{ keyCid, key, artifactCid }`, content-
  addressed only — and says *how* an artifact was produced, including its `target` (*"Not a
  default: the wrong target emits a different ABI"*) and its required `features`.

Nothing joins them. A node running `guardModuleProvenance` learns who published the bytes and
learns nothing about the environment they need; a node holding a `TranslationRecord` learns the
environment and has no signed statement about who vouched for it.

**The `ExecutionEnvelope` of §B.4.1 is exactly the missing join**, and this is why it should be
content-addressed and referenced by CID rather than signed inline: `NameRecord` already carries a
`cid` field and a signature over it, so an envelope CID published under a name inherits the
existing publisher identity, rollback protection and trust-anchor machinery with no new signing
path.

### B.2.6 Determinism is already a publish-time property — which decides the ABI question

`CLAUDE.md` records, against `node --v8-options`, that V8 exposes **no** NaN-canonicalisation
control and **no** relaxed-SIMD switch, and concludes that determinism must be *"enforced as a
property of the published artifact at publish time, not as runtime configuration."*

This inverts the usual framing of "bind the runtime/ABI", and the inversion is the right one:

> A node cannot *promise* a runtime. It can only be handed an artifact that *declares* what it
> requires and *refuse* if it cannot meet it.

So `requiredFeatures` belongs in the envelope as a **refusal criterion**, and the
`wasm-feature-detect` gating already described in `CLAUDE.md` is the enforcement. The envelope
does not make the node trustworthy; it makes a mismatch *detectable and refusable*.

## B.3 Options, with costs

**Option 1 — one flat signed blob containing everything.** Cost: any field change re-signs
everything; no reuse of a stable description across jobs; and it conflates two assertions made by
two different principals (see §B.4.3).

**Option 2 — in-toto `Statement` + DSSE envelope.** The shape is right: `subject[].digest`
identifies the artifact, `predicateType` names what is being asserted, `predicate` carries it,
and DSSE's PAE prevents a signature over one field being reinterpreted as another. Cost: DSSE
implies a second serialization alongside DAG-CBOR. `encode.ts` already argues why a
non-canonical codec must never be hashed here; introducing a second byte-string for one statement
is the exact bug PAE exists to prevent, so importing PAE *and* keeping DAG-CBOR would be
self-defeating.

**Option 3 — a content-addressed `ExecutionEnvelope` plus a short signed `Invocation` that
references it by CID.** Cost: two objects instead of one.

### B.3.1 RECOMMENDATION

**Option 3**, with the *type-discipline* of Option 2 imported and its *serialization* rejected.

It matches `TranslationKey` / `TranslationRecord` exactly — a key, the key's CID, and the
artifact's CID — so it reuses a pattern this repository has already built and reasoned about, and
it separates the long-lived description of *how this artifact may run* from the per-job
assertion *run it now, for this job*.

## B.4 RFC-ready text

### B.4.1 `ExecutionEnvelope`

Canonical encoding is DAG-CBOR via `encodeCanonical`; its identity is `canonicalCid(envelope)`.

```
ExecutionEnvelope ::= {
  envelopeVersion : uint                     -- inside the signed bytes; see B.4.4
  workload : {
     moduleCid    : CID
     entrypoint   : { export: string, params: [ValType], results: [ValType] }
  }
  runtime : {
     abi              : "wasi-preview1" | "none" | …
     abiImplCid       : CID | null           -- see B.7
     requiredFeatures : [string]             -- sorted, deduped; from the artifact
     forbiddenFeatures: [string]             -- sorted, deduped
     memory           : { initialPages: uint, maximumPages: uint }   -- MUST be equal
     sharedMemory     : false                -- MUST be false
  }
  dependencies : {
     imports : [ { module: string, name: string, kind: string } ]   -- the COMPLETE set
     linked  : [ CID ]
     lockCid : CID | null
  }
  capabilities : [ AuthorityRule ]           -- Part A's algebra, requested set
  limits : { wallClockMs: uint, memoryBytes: uint, outputBytes: uint }
  inputs : [ { role: string, cid: CID } ]    -- input commitments
  egress : EgressPolicy                      -- §B.5
  determinism : { canonicalOutput: "dag-cbor", floatPolicy: "reject-non-finite" }
  notAfter : uint                            -- envelope expiry, Unix ms
}

Invocation ::= {
  objectType  : "o2.invocation.v1"           -- inside the signed bytes; see B.4.4
  envelopeCid : CID
  taskCid     : CID                          -- canonicalCid over the Task; closes §A.2.6
  jobNonce    : bytes(32)
  notBefore   : uint
  notAfter    : uint
  audience    : PublicKeyHex                 -- the node this is addressed to
  requestor   : PublicKeyHex
  capability  : [ Delegation ]               -- the chain, per Part A
  signature   : string
}
```

`taskCid` is what closes the gap of §A.2.6: today a chain authorises *any* sovereign task of an
owner at a node, because nothing in the signed delegation payload names the work. An `Invocation`
signed over `taskCid` makes the authority specific to one shard of one job, and the `jobNonce`
plus `notBefore`/`notAfter` make it non-replayable. Note this puts the work-binding on the
*invocation*, not on the *delegation* — deliberately, because a delegation is meant to be reusable
and an invocation is not.

Field-by-field, what it binds and what breaks without it:

| field | binds | without it |
|---|---|---|
| `workload.moduleCid` | the bytes | — this is what exists today |
| `workload.entrypoint` | the export **and its type** | a module exporting a *different function under the same name* is substituted and the module CID is a different module, but a *host* choosing a different export of the same module is not detected |
| `runtime.requiredFeatures` | the engine capability set | a node without `simd128` runs a different code path or traps mid-job |
| `runtime.forbiddenFeatures` | what MUST NOT be used | `relaxed-simd` produces host-dependent results, and there is no V8 switch (`CLAUDE.md`) |
| `runtime.memory` | `initial === maximum` | `memory.grow` fails differently per host — a nondeterminism source |
| `runtime.sharedMemory` | `false` | threads are nondeterministic, and `SharedArrayBuffer` needs COOP/COEP which the declared hosting target cannot set |
| `dependencies.imports` | **every** host function the module may call | the sharpest substitution vector: same module, different host semantics |
| `capabilities` | the requested authority | "environment upgrade" — same bundle, more privilege |
| `limits` | the resource envelope | a job that OOMs on one node and completes on another disagrees for reasons unrelated to the code |
| `inputs` | what it ran on | result attestations become uncomparable |
| `egress` | where bytes may go | §B.5 |
| `notAfter` / `jobNonce` | freshness | replay |

Normative constraints:

- `requiredFeatures` **MUST** be derived from the artifact's own `target_features` section, never
  hand-written. `readTargetFeatures` already does this and already refuses a truncated section
  rather than reporting "needs nothing".
- **`featureVocabulary` MUST be named explicitly, and this is not pedantry — five vocabularies
  disagree on the same features.** In the `target_features` dialect SIMD is `simd128` and threads
  is **`atomics`**; in `wasm-feature-detect` the same two are `simd` and `threads`. `gc` has no
  `target_features` spelling at all. An RFC that writes "forbid `threads`" while the artifact
  declares `atomics` has written a rule that **never fires**. Normative: the envelope carries
  `featureVocabulary: "target_features"`, all names in `requiredFeatures`/`forbiddenFeatures` are
  in that vocabulary, and the runtime probe result is translated into it through an explicit
  mapping table — never compared string-to-string.
- `requiredFeatures ∩ forbiddenFeatures` **MUST** be empty; a violation is a refusal, not a
  precedence question.
- `forbiddenFeatures` **MUST** contain `relaxed-simd` and `atomics` for any artifact whose output
  is compared across nodes under N-version redundancy. (`atomics` is the `target_features`
  spelling of threads; see above.)
- **`target_features` is publish-time metadata that no engine enforces.** It is a custom section,
  so V8 never reads it. It states the requirement; `wasm-feature-detect` plus the refusal in
  §B.4.2 is what enforces it. The RFC must not imply the section constrains anything by itself.
- One discrepancy to check before this is implemented, flagged rather than asserted: the WebAssembly
  tool-conventions `Linking.md` layout documents **two** prefix bytes, `0x2b` (`+`) and `0x2d`
  (`-`), while `tools/aot/features.ts` in this repository implements three —
  `FeatureUse = 'used' | 'disallowed' | 'required'` with `=` for the third. Either the repository
  parses a historical LLVM prefix the current document dropped, or it accepts a byte the format
  does not define. **Unverified in either direction**; `readTargetFeatures`'s
  `{ kind: 'unknown-prefix' }` failure means the fail-closed behaviour is already there whichever
  answer is right.
- `dependencies.imports` **MUST** equal `WebAssembly.Module.imports(module)` computed locally by
  the executing node. This is the one dependency claim in the whole envelope that **any node can
  verify for itself, offline**, and it should therefore be the normative one — see §B.7 for why
  the others are weaker.

### B.4.2 Refusal discipline

Mirroring `translationCid`, envelope validation returns a **named** failure, never a default:

```
EnvelopeFailure ::=
  | { kind: "empty-field",        field: string }
  | { kind: "unknown-abi",        abi: string }
  | { kind: "feature-conflict",   feature: string }
  | { kind: "unsupported-feature",feature: string }        -- this engine lacks a required one
  | { kind: "forbidden-feature-present", feature: string } -- artifact uses a forbidden one
  | { kind: "memory-growable" }                            -- initial !== maximum
  | { kind: "shared-memory" }
  | { kind: "import-mismatch",    missing: [string], extra: [string] }
  | { kind: "entrypoint-absent",  export: string }
  | { kind: "entrypoint-type-mismatch", export: string }
  | { kind: "capability-not-granted", index: uint }        -- envelope asks more than the chain gives
  | { kind: "envelope-expired",   notAfter: uint, now: uint }
  | { kind: "unknown-version",    envelopeVersion: uint }
  | { kind: "unencodable",        error: EncodeError }
```

`capability-not-granted` is where Part A and Part B meet: the envelope's `capabilities` list is
checked against the chain by `authorizes(chain, request)`, so there is **one** authority language,
not two.

### B.4.3 Who signs what — three different assertions

| principal | asserts | object |
|---|---|---|
| publisher | "this envelope is a valid way to run this artifact" | signature over `envelopeCid`, or simply the envelope's CID referenced from a capability |
| requestor | "run this envelope, now, for this job, at this node" | `Invocation` — carries `jobNonce`, `notBefore/notAfter`, `audience` |
| executing node | "I ran **this** envelope and got this output" | `ResultWork` + `envelopeCid` — §B.4.5 |

Collapsing these into one signature is Option 1's cost. Keeping them separate means a compromised
requestor cannot change what the artifact is allowed to do, and a compromised node cannot claim it
ran an envelope it did not.

The `Invocation.audience` field exists for the same reason `verifyChain` has `wrong-audience`: an
invocation captured at node A must not be replayable at node B.

### B.4.4 Why not DSSE PAE

DSSE's Pre-Authentication Encoding exists so that a signature over `(type, body)` cannot be
reinterpreted with a different `type`. That property is necessary. But this project already has
exactly one canonical codec for anything hashed, and `encode.ts` states the reason a
non-canonical one must never be used. Adding PAE over a *second* serialization would create two
byte-strings for one statement — the very ambiguity PAE was invented to close.

**Take the discipline, not the bytes:** `envelopeVersion` and an explicit object-type tag live
**inside** the DAG-CBOR that is hashed and signed, so a signature over an `ExecutionEnvelope`
cannot be replayed as a signature over an `Invocation` or over a future object type. This is the
same guarantee by the same argument, using the codec already in the tree.

### B.4.5 The smallest high-value change

Add `envelopeCid` to `ResultWork`:

```ts
export interface ResultWork {
  readonly moduleCid: CID
  readonly envelopeCid: CID      // proposed
  readonly inputCid: CID
  readonly partitionIndex: number
  readonly partitionCount: number
  readonly outputCid: CID
}
```

It must go into `resultChallenge` (and `combineChallenge`), not merely onto the struct — a field
outside the signed challenge is unsigned by construction, which is the same trap `payloadOf` in
`capability.ts` avoids by listing its five fields explicitly.

Effect: N-version comparison compares like with like. A node that ran a different envelope is
**detectable** rather than merely disagreeing, and a divergence caused by a limits or feature-set
difference is distinguishable from a divergence caused by dishonesty. This is one field, and it
converts an entire class of silent disagreement into a named one.

## B.5 Egress policy — closing the gap named in §B.2.3

Define the policy in **Part A's algebra**, so there is one constraint language:

```
EgressPolicy ::= {
  destinations    : [ AuthorityRule ]        -- dimensions: `host` (prefix), `net` (cidr), `port` (range)
  maxBytes        : { k: "quota", n: uint }
  sovereignInputs : "never-egress" | "aggregate-only"
}
```

Then the three existing pieces line up:

- the **policy** is declared in the envelope and signed;
- `EgressGuard` **enforces** it, refusing a frame that does not satisfy `destinations`;
- `EgressManifest` is the **evidence** that enforcement ran, and can be checked against the policy
  after the fact — a manifest containing an entry whose `to` fails `destinations` is a
  contradiction, and therefore an attributable one, because the manifest is signed.

**What this does not prove, stated plainly.** The manifest is produced by the node being
constrained. It is *owner-attested*, exactly as this project's own sovereignty split already says:
*"the owner's contribution is trusted; the aggregation over contributions is verified."* Binding
the policy into the signed envelope makes a violation **attributable**; it does not make it
**impossible**. The RFC must not claim otherwise.

## B.6 Prior art — what transfers to a browser + Node fabric with no always-online authority

> Field names and quotations below were checked against the specifications. Items that could
> **not** be verified are listed in §B.6.3 and MUST NOT be quoted as fact.

### B.6.1 Capability algebra (point 3)

| system | model | verdict |
|---|---|---|
| **UCAN v0.10** — `{ $RESOURCE: { $ABILITY: [ $CAVEATS ] } }` | *"a validator SHOULD NOT reject UCANs with resources that it does not know how to interpret"* — a **fail-open instruction at the validator layer**. And caveats were **disjunctive**: *"the caveat array MUST be treated as a logically disjunct (an 'OR', NOT an 'and')"* | **DOES NOT TRANSFER.** It is §A.3 Option 1, and it is worse than the review implies — the unknown-resource rule fails *open*, and OR-composition means adding a caveat can *widen*. §A.4.1's AND-composition and fail-closed unknown-kind rule are the direct inversions of both |
| **UCAN 1.0** — payload `iss`, `aud`, `sub`, `cmd`, `pol`, `nonce`, `meta`, `nbf`, `exp`; `pol` has 12 operators: `==`, `!=`, `<`, `<=`, `>`, `>=`, `like`, `and`, `or`, `not`, `all`, `any` | *"Policies are syntactically driven, and MUST constrain the `args` field of an eventual Invocation"* — evaluate every policy against the concrete invocation; never decide policy-implies-policy | **TRANSFERS — it is the chain rule of §A.4.3, independently arrived at.** Its `cmd` rule is also the normative statement of vector `PP-01`; quoted in §A.4.6 |
| **Biscuit** — append-only blocks; monotone by **two** mechanisms | (1) cryptographic: signed payload includes `\0PREVSIG\0 sig_n`, so blocks cannot be stripped or truncated; (2) **logical origin scoping** — *"a rule, check or policy only trusts facts defined: in the authority block; in the authorizer; in the same block."* Datalog **omits negation** (*"This simplifies its implementation and makes the check more precise"*), so stratification is moot | **PARTIALLY TRANSFERS** — the *property* is adopted (§A.4.3 point 3); the *mechanism* is rejected. Note the signature chain **alone would not** stop a holder appending `right("everything")`; origin scoping is load-bearing, not an optimisation. Also: CVE-2022-31053 forged v1's aggregated signatures, and **no published formal audit exists** — do not call Biscuit audited |
| **Macaroons** — `sig′ = MAC(sig, vId ‖ cId)`, first-party being the degenerate `vId = 0` | AND-composition makes attenuation trivially sound. Verification is fail-closed **by the shape of the check** (build the validated-predicate set, then test membership), **not by a normative MUST** — an implementer who restructures it as "iterate caveats, skip unparseable ones" fails open | **DOES NOT TRANSFER** — corrected from an earlier draft of this document. Verification requires the shared root key, so **every verifier is also a minter**; mutually-untrusting peers cannot verify without gaining forgery power. The paper says so itself: macaroons *"have the clear disadvantage of being verifiable only by the target service."* Third-party caveats additionally need an online discharger |
| **SPKI/SDSI (RFC 2693)** — 5-tuple `⟨Issuer, Subject, Delegation, Authorization, Validity⟩`; reduction `⟨I1,S1,D1,A1,V1⟩ + ⟨I2,S2,D2,A2,V2⟩ → ⟨I1,S2,D2,AIntersect(A1,A2),VIntersect(V1,V2)⟩` provided `S1 = I2` and `D1 = TRUE`. Star-forms: `(*)`, `(* set …)`, `(* prefix <byte-string>)`, `(* range <ordering> <lower>? <upper>?)`, orderings `alpha numeric time binary date` | closed, typed intersection over a small kind set, no authority server | **TRANSFERS — the closest prior art to §A.4**, and §A.4's kinds are SPKI's plus `cidr`, `window`, `quota`. **But note the flaw this design must not inherit:** `(* prefix …)` is defined over **byte strings**, i.e. a raw string prefix, not segment-aware. **SPKI has precisely the `PP-01` hazard** that UCAN 1.0's `cmd` rule later fixed. The nearest prior art is also the cautionary tale |
| **Kubernetes RBAC escalation prevention** — *"You can only create/update a role if… You already have all the permissions contained in the role"*, with `escalate` and `bind` as the only named, grantable, auditable exemptions | the one design in the corpus with no CVE against its covers-check | **TRANSFERS as a pattern.** But its own `nonResourceURLCovers` uses raw `strings.HasPrefix` — see `PP-01` in §A.4.6 |
| **TUF delegation** — see §B.6.2; its attenuation rule is a chain intersection | | **TRANSFERS** — quoted in §A.4.3 as the second independent precedent for the fold |

### B.6.2 Execution envelope (point 4)

| system | model | verdict |
|---|---|---|
| **in-toto Statement v1 + DSSE** — `_type`, `subject[]`, `predicateType`, `predicate`; `ResourceDescriptor { name, uri, digest, content, downloadLocation, mediaType, annotations }`; envelope `payload`, `payloadType`, `signatures[].sig`, `signatures[].keyid` | `PAE(type, body) = "DSSEv1" ‖ SP ‖ LEN(type) ‖ SP ‖ type ‖ SP ‖ LEN(body) ‖ SP ‖ body` | **PARTIALLY TRANSFERS** — the *shape* is adopted in §B.4.1; the *serialization* is argued against in §B.4.4, where DSSE's own counter-argument is engaged rather than ignored. Two corrections worth carrying: the digest form is a **bare algorithm key with a bare lowercase-hex value** — the `"sha256:…"` prefixed form **does not exist** — and the wire key is `signatures` (plural) despite singular prose. Hard MUST to copy: *"Implementations MUST NOT re-parse the envelope after verification to pull out the payload."* |
| **SLSA provenance** — current is **v1.2**; v1.0 and v1.1 are **Retired**. `buildDefinition.{buildType, externalParameters, internalParameters, resolvedDependencies}`, `runDetails.builder.{id, builderDependencies, version}`, `runDetails.{metadata, byproducts}` | *"the parameters SHOULD only contain the actual values passed in through the interface… Metadata about those parameter values, particularly digests of artifacts referenced by those parameters, SHOULD instead go in `resolvedDependencies`"* | **PARTIALLY TRANSFERS.** Three findings that change §B.4.1's framing: (1) **there is NO runtime/ABI field** — `environment` existed in v0.2 and was *renamed to `internalParameters`*; SLSA intends the runtime to be implicit in the `buildType` URI, which is exactly the under-specification point 4 objects to. (2) **there is no `entryPoint` field in v1** — the spec says *"Use `externalParameters[<name>]` instead"*. (3) `builder.id` is *"the sole determiner of the SLSA Build level"* and has **no analogue here** — there is no privileged builder in a fabric of mutually-untrusted volunteers, and inventing one would undo the architecture. SLSA answers *how it was built*, not *how it may run* |
| **Sigstore bundle** — `Bundle { media_type, verification_material, content: message_signature \| dsse_envelope }`; current media type `application/vnd.dev.sigstore.bundle.v0.3+json` | a ≥v0.2 bundle embeds a Merkle `inclusion_proof` and signed `checkpoint` | **PARTIALLY TRANSFERS** — corrected from an earlier draft. **Bundle + a pre-provisioned `trusted_root.json` verifies genuinely offline**; bundle alone does not, because the keys come from a TUF trust root whose `timestamp.json` is on a ~7-day cycle. Two things that do not transfer: offline verification **cannot detect a split view** (an inclusion proof proves membership in a tree whose head you must independently trust), and `@sigstore/verify` binds to Node's *synchronous* `crypto`, so a browser port is a rewrite, not a polyfill. `@sigstore/bundle` alone has zero Node builtins, so the data model is browser-safe |
| **TUF targets metadata** — `targets: TARGETPATH → {length, hashes, custom}`; `custom` is *"opaque to the framework"* yet covered by the threshold signature | **the spec contains NO subset requirement on delegations.** Attenuation is enforced client-side: *"Clients MUST check that a target is in one of the trusted paths of **all roles in a delegation chain**, not just in a trusted path of the role that describes the target file"* | **PARTIALLY TRANSFERS.** The delegation rule is **the fold of §A.4.3 in a deployed spec** — a delegatee *may declare* `paths: ["**"]` and nothing rejects it, yet a conforming client refuses anything outside the delegator's paths anyway. That is exactly "an amplifying link is inert". `custom` is also the precedent for putting opaque app semantics under a threshold signature. The **freshness half does not transfer** — that is review point 2 |
| **OCI 1.1 `subject` / referrers** — `subject` is *"a **weak association** to a separate Merkle DAG structure"*, naming the target **by digest only**; `GET /v2/<name>/referrers/<digest>`, header `OCI-Filters-Applied` | pointing the attestation at the artifact breaks the circularity of embedding a signature in the thing signed | **PARTIALLY TRANSFERS** — the `subject` pointer needs no server and is exactly `TranslationRecord`'s shape. **The part that does not survive is completeness**: a registry can say "here are *all* attestations for this digest" because it saw every write; a fabric can only say "here are the ones I found." **If any part of this design ever treats the *absence* of an attestation as meaningful — revocation especially — that requirement does not transfer.** Also: naming a digest in `subject` is not evidence about it; anyone can mint such an object |
| **WASI P2 / component model** — `interfacename ::= <namespace> <words> <projection> <interfaceversion>?`, e.g. `wasi:http/types@0.2.6`; validation rule *"the `externname`s of all imports… must be strongly-unique"* | | **PARTIALLY TRANSFERS. There is NO standard world hash — it does not exist.** `Binary.md` states nothing about canonical or deterministic encoding: no type ordering, no dedup rule. WIT's "canonical" means *fully resolved*, a semantic claim, not a byte-level one, and the Canonical ABI is **itself unversioned**. Two further hazards: the spec is **actively moving where the version lives** (under `canonical interface names`, `@0.2.6` becomes `@0.2` plus a non-identity-bearing suffix, so a hash pinned to the patch version breaks), and for core modules WIT rides in a `^component-type` custom section that is **strippable with no semantic effect**. Interim recommendation for `runtime.abiImplCid`: hash the **sorted set of validated `externname` strings in canonicalised form**, keep full semver as a separate non-identity field, and label the scheme fabric-local |
| **WASM `target_features` custom section** — vector of `{prefix, feature}`; 16 feature strings including `simd128`, `relaxed-simd`, `atomics`, `tail-call` | the producer's own declaration | **TRANSFERS — and is already implemented** (`readTargetFeatures`, `FeatureSet.required`). Two constraints now folded into §B.4.1: **no engine reads it** (custom sections have no semantic effect, so V8 ignores it — it is publish-time metadata, never enforcement), and **the vocabularies disagree** (`simd128`/`atomics` here vs `simd`/`threads` in `wasm-feature-detect`, with `gc` unnameable in `target_features` at all). Separately relevant to the determinism constraint: `wasmparser` ships a `floats` validator flag documented *"Floats in WebAssembly can have different NaN patterns across hosts which can lead to host-dependent execution"* — an existing, maintained publish-time enforcement of the "forbid floats" option `CLAUDE.md` lists |
| **RATS (RFC 9334) + EAT (RFC 9711)** — roles Attester/Verifier/Relying Party/Endorser/Reference Value Provider/…; freshness by §10.1 synchronised clocks, §10.2 nonces, §10.3 epoch IDs | §12.2: *"must support end-to-end integrity protection and replay attack prevention"*; §10.2: the nonce is *"signed and included along with the Claims"*, so *"the appraising entity knows that the Claims were signed after the nonce was generated"* | **TRANSFERS** — see §B.4.3 for the sourcing correction and §B.7 for the trap it exposes |

### B.6.3 Claims that could NOT be verified — do not publish these as fact

Listed because an unverified citation in an authorization RFC is worse than a missing one.

- **UCAN's rationale for abandoning general `att` subsetting.** The structural change from v0.10 to
  v1.0 is real and was confirmed by diffing the spec texts. The *reason* — undecidability or
  unimplementability — appears in **neither** spec. **Argue it in this project's own voice; do not
  attribute it to the UCAN working group.** §A.4.1's regex argument is made independently and does
  not rest on this.
- **SPKI `gt`/`lt` orderings.** `ge`/`le` were recovered from RFC 2693's own example
  (`(tag (* range numeric ge #30# le #39# ))`), not from a normative keyword table. Whether
  `gt`/`lt` exist is unconfirmed.
- **RFC 6749 §6's re-issuance rule** (*"The requested scope MUST NOT include any scope not
  originally granted"*) was confirmed only via a third-party reproduction. Re-check against
  rfc-editor before quoting. §3.3's *"The strings are defined by the authorization server… each
  string adds an additional access range"* is directly confirmed, and the pair is the point: a
  normative subset requirement over a relation the spec never defines.
- **A quotable sentence in the Macaroons paper declining to specify a caveat language.** This is an
  inference from the construction, not a quotation.
- **Any advisory in which `read:x` matched `read:xy` by prefix or substring.** None found. Do not
  assert that OAuth scope prefix-confusion has a CVE.
- **The `target_features` `=` prefix discrepancy** of §B.4.1 — unresolved in either direction.

Two famous CVEs are deliberately **excluded** from the evidence in §A.4.6 despite their fame:
CVE-2018-1002105 (Kubernetes) is a connection-lifecycle bug, and Keycloak CVE-2026-1035 is a race
condition. Both are real; neither is a containment bug, and citing them here would weaken the
argument rather than strengthen it.

## B.7 UNRESOLVED (point 4)

- **`limits` are declarable but not verifiable.** A node can sign an envelope claiming a 64 MiB
  cap and have run with 4 GiB. Redundant execution detects a *result* divergence, and a limits
  difference frequently produces none. **There is no fix here without hardware attestation**, and
  the RFC should say so rather than implying the signature constrains the node. What the envelope
  buys is that the *claim* is now explicit and attributable.
- **ABI identity has no canonical form.** `runtime.abiImplCid` is currently un-fillable: WASI
  preview1 has no canonical interface hash, and `@bjorn3/browser_wasi_shim`'s package version is a
  proxy for the ABI, not an identity for it. Interim proposal: `abi: "wasi-preview1"` plus the
  shim's package version and an integrity hash of its bundled code. **This is a proxy and must be
  labelled as one.**
- **`dependencies.lockCid` is weak for WASM.** There is no lockfile at run time; imports are
  resolved by the host. The `lockCid` is a *publish-time* artefact and a node cannot check it
  against anything local. The strong, locally-checkable claim is `dependencies.imports` compared
  against `WebAssembly.Module.imports(module)` — which is why §B.4.1 makes that one normative and
  leaves `lockCid` nullable.
- **Nothing constrains what a host import *does*.** Enumerating the import set proves the module
  cannot call anything unlisted; it says nothing about the behaviour of what is listed. That is
  the sandboxing half, which RFC-0003 §11 already correctly declines to claim a signature covers.
- **Egress remains owner-attested.** §B.5. A signed policy makes a violation attributable, not
  impossible.
- **Envelope reuse vs. per-job cost.** The two-object split is proposed for reuse, but nothing has
  been measured about how often two jobs share an envelope, and if they never do, the split is
  pure overhead. Unmeasured.
- **`envelopeVersion` negotiation** has the same downgrade problem as `policyVersion` in §A.6, and
  the same lack of a good answer.
- **Nothing here is implemented, tested, or benchmarked.**

---

## C. Summary of proposed changes

| # | Change | Where | Size |
|---|---|---|---|
| 1 | Make the fold normative; demote pairwise to issuance-time SHOULD | RFC §5, §15 | text only |
| 2 | Add the `Constraint` schema and the forbidden list | RFC §4, §12 | text only |
| 3 | Adopt the boundary vectors of §A.4.6 as a conformance suite | new | test suite |
| 4 | Generalise `Ability` to a dimension of `AuthorityRule` | `packages/core/src/capability.ts` | moderate; back-compatible per §A.4.4 |
| 5 | Add `ExecutionEnvelope` + `Invocation`, DAG-CBOR, `canonicalCid` | `packages/core` | new module |
| 6 | Add `envelopeCid` to `ResultWork` **and to `resultChallenge`** | `packages/core/src/result-attestation.ts` | **one field** |
| 7 | Check envelope at `guardModuleProvenance` | `packages/core/src/executor/module-provenance.ts` | moderate |
| 8 | Declare `EgressPolicy` in the envelope; add a destination language; keep `EgressManifest` as evidence | `packages/net/src/egress.ts` | moderate |
| 9 | Bind the chain to the work via `Invocation.taskCid` + `jobNonce` (§A.2.6) | `packages/net` | moderate |
| 10 | Publish the envelope CID under a `NameRecord` so it inherits publisher identity (§B.2.5) | `packages/core/src/naming.ts` — no change, composition only | none |

Item 6 is the highest value-per-line change in the list and is independent of everything else.
Item 9 closes a gap the review did not name but which follows directly from point 4: without it,
binding the envelope constrains *what may run* while leaving *which job it was authorised for*
unbound.

---

**Recorded 2026-08-06.** This document proposes; it does not report. No code was changed and no
test was run in producing it.
