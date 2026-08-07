# RFC-0003 Response 03 — formal verification: what to use, and what does not exist

**Date:** 2026-08-06
**Answers:** Praxis's third message — *"let formal verification begin in parallel with the
slice: first a small model of the chain and the invariants `no escalation`,
`expired/revoked reject`, `replay cannot replace newer registration`."*
**Also answers:** two tool suggestions supplied by the owner the same evening.

---

## Summary

**Both suggested tools are non-options, and the reason matters more than the fact.**
One targets a different language; the other has no frontend for ours. Neither is a
close call, and both were checked against primary sources rather than recalled.

**The larger finding is that two of the three invariants describe mechanisms this
codebase does not have.** Revocation does not exist. Registration freshness does not
exist. Only `no escalation` has a counterpart in the code — and it is *structurally
unrepresentable as a bug*, which is a different thing from being correct-and-provable.

**Recommendation: `fast-check`, into the vitest `node` project that already runs.**
Then `Quint` — not TLA+ — if and when revocation gets built.

**And the X.509 ruling of 2026-08-06 reorders the priorities.** Once an ASN.1 parser
enters the browser trust path, parser-level verification dominates protocol-level proof.
That is not a close call either.

---

## 1. Fact-check

### Claim A — *"Liquid TypeScript (Flux / refinement types)"* — **FALSE**

| Fact | Evidence |
|---|---|
| Flux targets **Rust** | [`flux-rs/flux`](https://github.com/flux-rs/flux) — GitHub API: `"description": "Refinement Types for Rust"`, `"language": "Rust"`, 901 stars, last push **2026-08-05** |
| Same group as LiquidHaskell (Jhala, UCSD) | [*Flux: Liquid Types for Rust*, arXiv:2207.04034](https://arxiv.org/abs/2207.04034) |
| The TypeScript work is *Refined TypeScript* (`rsc`) | [Vekris, Cosman, Jhala, PLDI 2016](https://goto.ucsd.edu/~pvekris/docs/pldi16.pdf) |
| …and it is dead | [`UCSD-PL/refscript`](https://github.com/UCSD-PL/refscript) — `"pushed_at": "2019-01-13"`. **7.5 years.** 70 stars, 16 open issues, written in *Haskell* |

**There is no maintained refinement-type checker for TypeScript with an SMT backend.**
Adopting one is not an option that exists.

**The likely source of the error is a word collision worth naming**, because it will
recur. Searching npm for "refinement types typescript" returns `zod`-style **runtime value
validators**. Those check a value while the program runs. A refinement type system
discharges verification conditions *to an SMT solver at compile time*. Unrelated
technologies, one shared word. TypeScript's own "type refinement" — [inferred type
predicates, TS 5.5](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-5.html)
— is control-flow narrowing, and is also not this.

Flux and refscript are both Jhala-group projects with near-identical marketing language,
which is probably how one got read as the other.

### Claim B — *"Meta Infer handles JavaScript via Node.js wrappers"* — **FALSE**

The separation-logic and bi-abduction description **is accurate about Infer**. The
JavaScript support is not.

Source tree (`infer/src`) frontends: `clang · erlang · java · llvm · python · rust ·
textual`. There is no `javascript`, `js`, `node`, or `typescript` directory.

- [fbinfer.com/docs/about-Infer](https://fbinfer.com/docs/about-Infer/) — *"a static
  program analyzer for Java, C, C++, Objective-C, and Erlang."*
- [facebook/infer issue #1215, *"JavaScript support for Infer"*](https://github.com/facebook/infer/issues/1215)
  — opened **2020-01-19**, **still open**. A six-and-a-half-year-old open feature request
  is the cleanest available proof that a feature does not exist.
- Latest release **v1.3.0, 2026-05-12**; repo pushed 2026-08-05, 15.7k stars.

Infer is thoroughly alive. It simply cannot read this codebase.

*(Aside worth keeping: the docs sentence now **lags** the source tree — Python, Rust and
LLVM frontends exist in `infer/src` but are absent from that blurb. JavaScript is missing
from **both**, so the conclusion does not depend on which one you trust.)*

---

## 2. The finding that reshapes the question

`verifyChain` (`packages/core/src/capability.ts`) was read directly, and the three
invariants were grepped for.

**`no escalation` — confirmed structurally unrepresentable.** The check runs inside the
loop over *every* link and tests the **requested** ability:

```ts
if (!link.abilities.includes(options.ability)) {
  return fail({ kind: 'missing-ability', index: i, ability: options.ability })
}
```

There is no `link[i].abilities ⊆ link[i-1].abilities` comparison anywhere. A child that
widens its own abilities gains nothing — requesting the widened ability still fails at the
ancestor that lacks it. Expiry folds the same way over all links, and `ownerId` likewise.
All three dimensions are **universally quantified over the chain**, which is intersection
semantics by construction.

**This is why `attenuates(parent, child)` is absent, and why its absence is a feature.**
Praxis's item 2 asks that *no CM/CU may widen its parent*. This design satisfies it by
never granting the widened thing, rather than by refusing to issue it.

**`revoked reject` — revocation does not exist.** `grep -rn "revok"` across
`packages/core/src` and `packages/net/src`, excluding tests, returns **nothing**.
`ChainFailure` has no `revoked` variant. (`expired` *is* implemented and tested.)

**`replay cannot replace newer registration` — the registration has no version.**
`rendezvous.ts` is 102 lines with one export, `findReservedPeers` — read-only discovery
over the relay's reservation store. No store, no sequence numbers, no nonces.
`enrol-protocol.ts` and `enrol-client.ts` carry no `seq` / `nonce` / `issuedAt` field.

> **So the reviewer is not asking us to verify code.** They are asking us to *design two
> mechanisms that do not exist*, and to re-prove one the design already forecloses. That is
> a legitimate and valuable request — but it changes which tool is worth its cost, because a
> model checker pays off on **unbuilt designs** and wastes effort on properties the shape of
> the code already guarantees.
>
> **Tell the reviewer this before choosing a tool.** Otherwise a week goes into modelling a
> system whose model has no counterpart in the code, and the exercise proves a specification
> rather than a program.

---

## 3. A real defect found while reading — since fixed

`capability.ts` folded expiry with `Math.min(...chain.map((link) => link.expiresAt))`.

Spreading a **wire-length** array into a call blows the argument stack. Measured on this
host (Node/V8): 50 000 fine, 100 000 fine, **200 000 → `RangeError: Maximum call stack size
exceeded`**, 300 000 likewise. That is a **throw on the success path of a security check**,
where whatever the caller's `catch` does becomes part of the trust decision.

**Severity, stated accurately rather than alarmingly:** the loop fails fast at the first
link whose issuer does not match, before any signature work, so an anonymous attacker
cannot walk past the valid prefix they actually hold. Reaching the fold needed a *fully
valid* 200 000-link chain — a legitimate delegate self-delegating 200 000 times. Privilege
abuse, not a remote crash. Narrow, not absent.

**Which tool would have caught it? None of the candidates.** A model checker explores
chains of length 3–5 by construction, so the bug lives exactly where the tool does not
look. A type system cannot express `length < N` without dependent types, which TypeScript
does not have. It is a constant and a `ChainFailure` variant — and the guard is *stronger*
than a proof would have been, because it holds for all N.

**Fixed 2026-08-06**: `MAX_CHAIN_DEPTH = 8`, checked before any signature work, plus the
fold rewritten as a `reduce` so the two controls do not depend on each other. The bound is
**sited**: the deepest chain anywhere in the repository is two links, production builds
one, so eight is 4× the deepest ever constructed. This is also the **seventh** adversarial
fixture — *a chain deeper than any stated bound* — added to the reviewer's six.

---

## 4. Comparison

| Tool | What it actually proves | Maintenance | Effort to first result | Fits vitest/CI? | Verdict |
|---|---|---|---|---|---|
| **fast-check** | Falsification, not proof. Universally-quantified properties over generated input; `scheduledModelRun` covers stateful and interleaved sequences | **Healthy** — v4.9.0, 2026-07-08; 5.1k stars | **Hours** | **Native** — a plain assertion inside an existing `it()` | **Start here** |
| **Quint** | Real proof (bounded/inductive) of safety + temporal properties via Apalache→SMT | **Active** — v0.32.0, 2026-03-31; 1.6k stars | **~1 week** | Separate CI step | **Best model checker for this team** — written in TS, installs from npm |
| **TLA+** (TLC, Apalache) | Same class of proof; larger literature | **Healthy** — tools v1.8.0 2026-07-31; Apalache v0.61.0 2026-08-06 | **2–4 weeks** | Separate step, Java dependency | Right logic, wrong ergonomics. Quint gives the identical Apalache backend |
| **Alloy 6** | Structural/relational properties — shape, depth, cycles — plus LTL over traces | **Slow but alive** — v6.2.0, 2025-01-09 | **3–7 days** | GUI-centric, resists CI | Its sweet spot is chain *shape*, the one thing this design already forecloses |
| **Z3 direct** (`z3-solver`) | Decides the attenuation algebra | **Very healthy** — v5.0.0, 2026-07-17 | 1–2 days | Yes — WASM build with TS bindings, runs in Node *and* browser | Decidable, and **overkill**: `Ability` is a 3-value enum, so exhaustive enumeration is 8 cases |
| **Infer** | Memory safety via bi-abduction | Healthy | — | — | **Cannot read TypeScript** |
| **Refined TypeScript** | Refinement types for TS | **Dead, 2019-01-13** | — | — | **Non-option** |

### Invariant expressibility

**Y** provable · **T** testable, not proven · **n/a** mechanism absent

| | `no escalation` | `expired reject` | `revoked reject` | `replay ≺ newer registration` |
|---|---|---|---|---|
| **Codebase today** | implemented, **unrepresentable as a bug** | implemented + tested | **does not exist** | **does not exist** |
| **fast-check** | T | T | n/a | T |
| **Quint** | Y | Y | **Y — worth its cost here** | **Y — native** |
| **TLA+** | Y | Y | Y | Y |
| **Alloy 6** | Y | Y (bounded integers bite) | Y | Y (traces are its weaker axis) |
| **Z3 direct** | Y (unnecessary) | Y | partial | **N** — no temporal dimension |

---

## 5. Recommendation

**Adopt `fast-check` into the existing vitest `node` project. That is the whole first
step.**

1. **Near-zero adoption cost, unambiguously alive.** A dev dependency and an assertion
   inside tests that already run. No runner change, no JVM, no separate CI job. Nothing
   else on the list is in that category.
2. **It is the only candidate covering both halves of the problem.** The same dependency
   that generates capability chains generates malformed DER for the X.509 parser. Given
   the X.509 ruling, one tool serving both beats a better tool serving one.
3. **It finds the bug class actually present here.** A generated 300 000-link chain reaches
   the fold; a model checker structurally will not.
4. **It buys the right thing for `no escalation`.** That property is unrepresentable as a
   bug *today*. Proving it would purchase a proof of something the code cannot violate.
   Pinning it as a regression property is the appropriate spend — because the real risk is
   not that today's code escalates, it is that someone later adds a parent/child comparison
   and inverts the semantics.

**Then, only if revocation and registration freshness get built: model them in Quint
first, before writing the code.** Revocation propagation in a P2P fabric with no central
CRL and no OCSP responder is a genuinely hard distributed-systems design problem, and it is
the one place on this list where a model checker is clearly worth weeks.

**Do not buy:** refinement types (do not exist for TS), Infer (cannot read TS), Alloy (its
strength is the property already foreclosed), standalone Z3 (enumerate the 8 subsets).

---

## 6. The X.509 ruling reorders this

Owner ruling 2026-08-06 adopts X.509, against the standing recommendation. Taking that as
settled, **parser-level verification now dominates protocol-level proof.**

The historical record is one-sided. Chain-validation *logic* bugs are rare and largely
theoretical. ASN.1 *parsing* bugs are the recurring CVE engine — OpenSSL's own regression
corpus carries 2 242 certificates encoding known ASN.1 vulnerabilities.

The protocol logic here is ~70 lines that one person can read in a sitting. An ASN.1 DER
parser is thousands of lines of third-party code processing fully attacker-controlled
bytes, in a browser, on the trust path.

**Proving `no escalation` in TLA+ while an unfuzzed DER parser sits underneath it is
verifying the lock while the door frame is untested.**

Directly reusable, and cheaper than any proof effort:

- **frankencerts / Mucert** — differential-testing corpora, ~2M synthetic chains built to
  break validators.
- **[Verdict, USENIX Security 2025](https://dl.acm.org/doi/10.5555/3766078.3766337)** and
  **[ARMOR, IEEE S&P 2024](https://www.computer.org/csdl/proceedings-article/sp/2024/313000a200/1WPcYqbt6qk)**
  — formally verified X.509 validators. Not adoptable (Rust/Agda), but their *bug
  taxonomies and test corpora* are.
- **[Fuzzing TLS certificates from their ASN.1 grammar](https://blog.doyensec.com/2020/05/14/asn1fuzz.html)**
  (Doyensec, 2020-05-14) — grammar-driven certificate generation.

---

## Sources

All retrieved 2026-08-06.

- [`flux-rs/flux`](https://github.com/flux-rs/flux) · [arXiv:2207.04034](https://arxiv.org/abs/2207.04034)
- [`UCSD-PL/refscript`](https://github.com/UCSD-PL/refscript) — last push 2019-01-13 · [PLDI 2016 paper](https://goto.ucsd.edu/~pvekris/docs/pldi16.pdf)
- [fbinfer.com/docs/about-Infer](https://fbinfer.com/docs/about-Infer/) · [issue #1215](https://github.com/facebook/infer/issues/1215) — open since 2020-01-19
- [fast-check](https://github.com/dubzzz/fast-check) v4.9.0 · [model-based testing](https://fast-check.dev/docs/advanced/model-based-testing/) · [race conditions](https://fast-check.dev/docs/advanced/race-conditions/) · [Vitest integration, 2025-03-28](https://fast-check.dev/blog/2025/03/28/beyond-flaky-tests-bringing-controlled-randomness-to-vitest/)
- [`quint-co/quint`](https://github.com/informalsystems/quint) v0.32.0 · [quint.sh/about](https://quint.sh/about)
- [`tlaplus/tlaplus`](https://github.com/tlaplus/tlaplus) v1.8.0 · [Apalache](https://apalache-mc.org/) v0.61.0
- [Alloy 6](https://alloytools.org/alloy6.html) v6.2.0
- [`Z3Prover/z3`](https://github.com/Z3Prover/z3) · npm `z3-solver` 5.0.0
