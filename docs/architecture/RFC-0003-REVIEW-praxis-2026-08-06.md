# External review of RFC-0003 — Praxis, 2026-08-06 16:50

Received via Telegram, in response to
`https://github.com/o2alexanderfedin/o2.services/blob/main/docs/architecture/RFC-0003-Decentralized-Cloud-Security-Architecture-v0.2.md`

Reproduced verbatim below (Russian original), followed by an English rendering. **The original
is the record**; the translation is a convenience and any disagreement resolves to the Russian.

---

## Verbatim (ru)

> Теперь да — прочитала RFC из репозитория, и он уже достаточно конкретен для предметного review.
>
> **Короткий verdict:** каркас сильный. Особенно правильны: разделение identity/authority,
> функциональные CM, запрет на усиление делегации, `critical` extensions, локальная проверка,
> явное различение подписи кода и sandboxing, parent-hash и честный список открытых вопросов.
> Это не «сертификаты сделают распределённость безопасной», а уже довольно внятная модель того,
> *какие именно утверждения подпись способна нести*.
>
> Но прежде чем это станет протоколом, я бы зафиксировала несколько мест жёстче:
>
> **1. CR — не "trust anchor" вообще, а anchor конкретной policy.**
> Самоподписанный CR доказывает непрерывность ключа/приложения, но не доверенность приложения
> для нового устройства. Нужна явная локальная policy: откуда клиент впервые берёт CR pin, может
> ли TOFU, что UI говорит пользователю при смене CR, как конфликтуют несколько roots. Иначе фраза
> «CR is the application trust anchor» легко превращается в неявное «валидная цепочка = можно
> доверять».
>
> **2. Revocation/freshness — сейчас главный незакрытый security-узел.**
> RFC честно перечисляет CRL/OCSP, epoch-объекты, DHT, relay cache и gossip, но пока не говорит,
> что происходит при offline-режиме или недоступной свежей информации. Нужны режимы вроде:
> - hard-fail для регистрации relay и опасных capability;
> - bounded soft-fail только для низкорисковых/offline операций;
> - максимальный возраст status object;
> - кто подписывает epoch/status и как предотвращается rollback самого status object.
>
> Иначе «локальная проверка» конфликтует с инвариантом «stale authority cannot be revived».
>
> **3. AuthorityRule надо сделать формальной алгеброй, а не "списком прав".**
> "subset of parent resources/actions" звучит правильно, но реализация сломается на
> неоднозначностях: URL-prefix, wildcard namespace, method mask, quota, время, regex, network
> range, сочетание allow/deny. Я бы в RFC ввела:
> - канонический нормализованный формат capabilities;
> - алгоритм `attenuates(parent, child) -> bool`;
> - правило пересечения всей цепи;
> - тестовые пограничные векторы.
>
> Иначе ошибка в проверке subset станет privilege escalation, а не просто багом.
>
> **4. Подпись workload должна bind'ить весь execution envelope.**
> Сейчас есть content hash и упомянутый Workload Binding, но подпись должна покрывать не только
> байты кода: runtime/ABI, dependency lockfile или image digest, entrypoint, запрошенные
> capabilities, resource limits, input commitments, egress policy, expiry и job nonce. Иначе
> легитимный bundle можно запустить в более привилегированной среде или с подменёнными
> зависимостями — хэш модуля останется корректным.

---

## English rendering

**Short verdict:** the frame is strong. Particularly right: the identity/authority split,
functional CMs, the prohibition on delegation amplification, `critical` extensions, local
verification, the explicit distinction between code signing and sandboxing, parent-hash, and an
honest list of open questions. This is not "certificates will make decentralisation secure" — it
is already a fairly clear model of *which claims a signature is capable of carrying*.

But before this becomes a protocol, four places want pinning down harder.

### 1. CR is not a "trust anchor" in general — it is the anchor of a specific policy

A self-signed CR proves continuity of the key/application, but **not** the application's
trustworthiness *for a new device*. An explicit local policy is needed:

- where does a client first obtain the CR pin?
- is TOFU permitted?
- what does the UI tell the user when the CR changes?
- how do multiple roots conflict?

Otherwise the sentence "CR is the application trust anchor" quietly becomes "a valid chain means
you may trust it."

### 2. Revocation/freshness is currently the main unclosed security node

The RFC honestly lists CRL/OCSP, epoch objects, DHT, relay cache and gossip, but does not yet say
what happens **offline**, or when fresh information is unavailable. Modes are needed:

- **hard-fail** for relay registration and dangerous capabilities;
- **bounded soft-fail** only for low-risk / offline operations;
- a **maximum age** for the status object;
- **who signs** epoch/status, and how **rollback of the status object itself** is prevented.

Otherwise "local verification" conflicts with the invariant *"stale authority cannot be revived."*

### 3. AuthorityRule should be a formal algebra, not a "list of rights"

"Subset of parent resources/actions" sounds right, but the implementation will break on
ambiguities: URL-prefix, wildcard namespace, method mask, quota, time, regex, network range, and
allow/deny combinations. The RFC should introduce:

- a **canonical normalised capability format**;
- an `attenuates(parent, child) -> bool` **algorithm**;
- an **intersection rule over the whole chain**;
- **boundary test vectors**.

Otherwise a bug in the subset check is a **privilege escalation**, not merely a bug.

### 4. The workload signature must bind the entire execution envelope

There is currently a content hash and a mentioned Workload Binding, but the signature must cover
more than the code bytes:

- runtime / ABI
- dependency lockfile or image digest
- entrypoint
- requested capabilities
- resource limits
- input commitments
- egress policy
- expiry
- job nonce

Otherwise a legitimate bundle can be run in a **more privileged environment**, or with
**substituted dependencies** — and the module hash will still be correct.

---

## Status

Recorded 2026-08-06. Solutions to the four points are under investigation; findings will be
written up separately rather than folded silently into the RFC, so the review and the response
stay distinguishable.

---

# Second message — same reviewer, 2026-08-06 16:51

## Verbatim (ru)

> **5. CM-Recovery — самый опасный сертификат в дереве.**
> Он сейчас описан как emergency rotation/recovery/revocation, то есть потенциально способен
> переписать доверие целиком. Я бы отделила:
> - routine rotation;
> - emergency revoke;
> - root rollover;
> - account recovery.
>
> Для CR/CM-Recovery очень хочется threshold/M-of-N, задержку на root rollover, независимый
> recovery key и прозрачный append-only log. Иначе компрометация одной recovery-ветки — это
> аккуратно оформленный master key.
>
> **6. Relay registration защищает доказательство владения ключом, но не объявленные endpoints.**
> Nonce + timestamp защищают от прямого replay, однако нужен policy на endpoint takeover: TTL
> регистрации, sequence number/monotonic generation, запрет старой записи перетирать новую,
> привязка endpoint-claim к конкретной сессии/transport key и лимиты на churn. И не давать relay
> превращаться в oracle: ответы о существовании node/application тоже могут быть чувствительными
> метаданными.
>
> **7. Нужна отдельная спецификация криптографических профилей.**
> Вопрос "choice of algorithms" пока в open questions, но до реализации нужно назвать минимум:
> допустимые algorithms, запреты на SHA-1/слабые curves, правила DER canonicalization,
> certificate parsing limits, максимальную глубину цепи, лимиты размеров extensions и strict
> handling duplicate extensions. Парсер X.509 — огромная поверхность атак; "reject on ambiguity"
> должен стать набором точных отказов.
>
> Что бы я сделала следующим коммитом: не код, а маленький **RFC-0003 testable profile** с тремя
> вещами:
> - точной схемой `AuthorityRule` и алгоритмом attenuation;
> - таблицей freshness/revocation policy для каждого типа операций;
> - набором adversarial fixtures: widened wildcard, expired parent + live child, stale epoch
>   replay, duplicate extension, same issuer key/different parent cert, valid code hash +
>   altered runtime envelope.
>
> Тогда архитектуру можно будет не только обсуждать, но и гонять через независимый validator.

---

## English rendering

### 5. CM-Recovery is the most dangerous certificate in the tree

It is currently described as emergency rotation / recovery / revocation — i.e. potentially able
to **rewrite trust entirely**. These should be separated:

- routine rotation
- emergency revoke
- root rollover
- account recovery

For CR and CM-Recovery one badly wants **threshold / M-of-N**, a **delay on root rollover**, an
**independent recovery key**, and a **transparent append-only log**. Otherwise compromise of a
single recovery branch is *a neatly packaged master key*.

### 6. Relay registration protects proof of key possession, but not the announced endpoints

Nonce + timestamp defend against direct replay, but a policy on **endpoint takeover** is needed:

- registration TTL
- sequence number / monotonic generation
- a prohibition on an old record overwriting a newer one
- binding the endpoint-claim to a **specific session / transport key**
- churn limits

And: **do not let the relay become an oracle.** Answers about the existence of a node or an
application are themselves potentially sensitive metadata.

### 7. A separate cryptographic-profile specification is needed

"Choice of algorithms" currently sits in open questions, but before implementation the minimum
must be named:

- permitted algorithms
- bans on SHA-1 and weak curves
- DER canonicalisation rules
- certificate parsing limits
- **maximum chain depth**
- extension size limits
- strict handling of **duplicate extensions**

An X.509 parser is an enormous attack surface; *"reject on ambiguity"* has to become a **set of
precise refusals**.

### What the reviewer would do in the next commit

**Not code — a small RFC-0003 *testable profile*** with three things:

1. an exact `AuthorityRule` schema and attenuation algorithm;
2. a **freshness / revocation policy table per operation type**;
3. a set of **adversarial fixtures**: widened wildcard · expired parent + live child · stale
   epoch replay · duplicate extension · same issuer key but different parent cert · valid code
   hash + altered runtime envelope.

> Then the architecture can be not only discussed, but run through an independent validator.

---

# Third message — same reviewer, 2026-08-06 18:17

**This message changes the reviewer's verdict and supersedes the "next commit" proposal at the
end of the second message.** It arrived in reply to a push-back from the owner, quoted by
Telegram as *"ты несколько упускаешь из виду то, что сертификаты и безопасно…"* (truncated in
the client). The reviewer **accepts the correction** and restates what they are and are not
approving.

## Verbatim (ru)

> Да, принимаю поправку. Я слишком смешала **audit текущего кода** и **review проектируемого
> security-протокола** — будто RFC обязан уже совпадать с имплементацией. Для дизайна это
> неверный стандарт: расхождение здесь не дефект, а очередь работы.
>
> Тогда мой verdict проще:
>
> **Я одобряю направление RFC v0.2 как основу для имплементации**, с одним условием: перед кодом
> превратить спорные места не в «общее согласие», а в короткий implementable security contract.
>
> Минимум, который я бы зафиксировала в RFC/отдельном `SECURITY-PROPERTIES.md`:
>
> 1. **Trust bootstrap:** откуда клиент получает/пинит CR, что именно означает смена root и кто
>    подтверждает её локально.
> 2. **Effective authority:** полномочие запроса = пересечение ограничений по цепочке; ни один
>    CM/CU не может расширить родителя.
> 3. **Execution binding:** подпись/разрешение относится к хэшу артефакта **и** envelope: runtime,
>    capabilities, input/output commitments, egress, limits, expiry.
> 4. **Freshness:** конкретные правила для nonce, epoch/sequence, expiry, replay и rollback — с
>    точкой хранения состояния.
> 5. **Recovery:** отдельно описать routine rotation, revoke, root rollover и account recovery;
>    для наиболее сильных операций — явный кворум, задержка и журнал.
> 6. **Acceptance boundary:** валидная цепочка доказывает криптографический факт, но локальная
>    policy всё ещё решает, исполнять ли код.
>
> Если вы это фиксируете, я бы не ждала «идеальной завершённости» и запускала вертикальный slice:
> выпуск CR→CM→CU, локальная валидация цепочки, capability attenuation, registration/discovery с
> freshness и набор отрицательных тестов.
>
> A formal verification пусть начинается не после «объятий взаимопонимания», а параллельно с этим
> slice: сначала маленькая модель цепочки и инварианты `no escalation`, `expired/revoked reject`,
> `replay cannot replace newer registration`. Тогда дизайн быстро встретится с тем, что реально
> можно доказать.
>
> То есть: **аппрув на направление — да. Аппрув на "безопасность доказана" — пока, конечно, нет.**

## English rendering

> Yes, I accept the correction. I over-mixed **an audit of the current code** with **a review of
> a security protocol still being designed** — as though the RFC were obliged to match the
> implementation already. For a design that is the wrong standard: a divergence here is **not a
> defect, it is a work queue.**

Then the verdict is simpler:

> **I approve the direction of RFC v0.2 as a basis for implementation**, on one condition: before
> code, turn the contested places into a short **implementable security contract** rather than
> into "general agreement".

The minimum they would pin down, in the RFC or in a separate `SECURITY-PROPERTIES.md`:

1. **Trust bootstrap** — where a client obtains/pins CR, what exactly a root change *means*, and
   who confirms it locally.
2. **Effective authority** — a request's authority = the **intersection of the restrictions along
   the chain**; no CM/CU may widen its parent.
3. **Execution binding** — the signature/permission applies to the artifact hash **and** the
   envelope: runtime, capabilities, input/output commitments, egress, limits, expiry.
4. **Freshness** — concrete rules for nonce, epoch/sequence, expiry, replay and rollback,
   **together with where the state is stored**.
5. **Recovery** — describe routine rotation, revoke, root rollover and account recovery
   *separately*; for the strongest operations, an explicit quorum, a delay, and a log.
6. **Acceptance boundary** — a valid chain proves a **cryptographic fact**; local policy still
   decides whether to execute the code.

> If you pin that down, I would not wait for "ideal completeness" — I would run a **vertical
> slice**: issue CR→CM→CU, local chain validation, capability attenuation, registration/discovery
> with freshness, and a set of negative tests.
>
> And let **formal verification** begin not after "hugs of mutual understanding" but **in parallel
> with that slice**: first a small model of the chain and the invariants `no escalation`,
> `expired/revoked reject`, `replay cannot replace newer registration`. Then the design meets what
> can actually be proven, quickly.
>
> That is: **approval of the direction — yes. Approval of "security is proven" — not yet, of
> course not.**

---

## What this changes on our side

**The deliverable named at the end of the second message is superseded.** That message asked for
an *RFC-0003 testable profile* (AuthorityRule schema + freshness table + six adversarial
fixtures). This one asks for something broader and better-shaped: a **`SECURITY-PROPERTIES.md`
implementable security contract** in six named sections, and it explicitly says **not** to wait
for completeness before cutting a vertical slice. The six fixtures survive **inside** item 6's
negative-test set rather than as the headline artefact.

**Three of the six are already partly answered by measurement, and the answers are not the
obvious ones.** These are recorded in full in `RFC-0003-RESPONSE-01` and `-02`; in brief:

- **Item 2 (effective authority) is already satisfied here — by a different mechanism than the
  one the reviewer assumes.** There is no `attenuates(parent, child)` in this codebase, and its
  absence is a **feature**, not the gap it looks like. `verifyChain` never compares a link to its
  parent; it tests the **requested** ability against **every** link and folds expiry with
  `Math.min`. That *is* "the intersection of the restrictions along the chain", computed
  directly. A child that widens its abilities is therefore **inert**, and a soundness bug in a
  subset check would be issuance-time hygiene rather than privilege escalation. The repository
  reached the monotonicity property without going looking for it. **Do not add `attenuates` as
  the enforcement point** — the fold is the boundary.
- **Item 4 (freshness) has one real defect and one larger hole than the one asked about.**
  `possessionChallenge` is `encodeCanonical({ purpose: 'o2-enrol', nodeKey, userKey })` — static,
  no nonce, no timestamp, no server input, so an observed enrolment request is a fixed replayable
  byte string. Separately, `peer-verifier.ts` records that *"a settled acceptance is never
  re-asked"*: for block-fetch selection the revocation window is the **connection lifetime**, not
  the certificate lifetime. `expired` sits outside `FINAL` so a refusal can be promoted, but
  nothing demotes an acceptance.
- **Item 6 (acceptance boundary) is already the shape of this system and should be stated as
  such rather than designed.** `verifyCertificate` takes its anchors as an argument and dials no
  authority; every verifier is this project's own code against pinned anchors. The cryptographic
  fact and the local policy decision are already separate objects here.

**One structural finding the contract must absorb:** §9's registration protocol cannot be
implemented as written. `denyInboundRelayReservation` receives a `PeerId` **and nothing else**;
the HOP `RESERVE` message carries no certificate field and there is no reply channel for a
challenge. What exists instead is stronger — a peer id derived from an Ed25519 key *is* the node
key, already proved over Noise, available with zero I/O, and channel-bound in a way a
nonce-signature is not.

## Owner ruling of 2026-08-06 — X.509 is adopted

Recorded here because it governs how the contract below gets encoded, and because it was taken
**against the standing recommendation**, which is worth leaving legible rather than tidying away.

The recommendation was to keep `@noble/curves` + `@ipld/dag-cbor` — both already present — and
to document the divergence from X.509, on the ground that adopting X.509 ships `pkijs` + `asn1js`
into the **browser** trust path: a few hundred KB of exactly the code that generates CVE classes,
at the one boundary that must fail closed. The supporting argument was that `critical` extensions
buy little here, because there is **no generic validator** anywhere in this system, while the one
place a standard validator would sit — §2's optional external CA — is guaranteed to reject a
chain carrying critical unknown extensions. §2 and §4 pull against each other.

**The owner ruled to adopt X.509 anyway.** That decision stands and the work proceeds under it.
What it obliges, and what item 7 of the second message already demanded, is that the
cryptographic-profile spec becomes **load-bearing rather than advisory**: permitted algorithms,
bans on SHA-1 and weak curves, DER canonicalisation rules, certificate parsing limits, a
**maximum chain depth** — `verifyChain` currently has no depth bound at all and takes its length
from the wire — extension size limits, and strict handling of duplicate extensions. Under this
ruling *"reject on ambiguity"* is not a principle to state; it is the set of precise refusals
that keeps an ASN.1 parser in a browser from being the weakest thing in the design.

### Correction, 2026-08-07 — one item on that list was already built

Appended rather than edited into the paragraph above, because that paragraph is a dated review
record and its claims are worth being able to read as they were made.

**The chain-depth clause is false against the tree and was false when it was written.**
`packages/core/src/capability.ts:127` defines `MAX_CHAIN_DEPTH = 8`, and `:190` enforces it
**before any signature work**, with the comment stating the reason in the same terms the review
does: *"the length is attacker-supplied, and this is the cheapest possible refusal."* The
companion hazard is closed too — `:255` folds `expiresAt` with `reduce` rather than
`Math.min(...chain.map(…))`, specifically because the spread raised `RangeError: Maximum call
stack size exceeded` past ~200 000 elements, *on the success path*. The two controls are
deliberately independent: the bound makes the overflow unreachable, the fold makes it
impossible.

So of the seven obligations the ruling names, **one is delivered and guarded, and six are not.**

**The six that remain do not attach to anything yet, and that is the honest status.** No ASN.1
or X.509 parser is installed — no `pkijs`, `asn1js`, `node-forge` or `@peculiar/*` in the root
manifest or any workspace package. Certificates today are Ed25519 over `@noble/curves`
(`packages/core/src/enrollment.ts:113`), not DER. DER canonicalisation, parsing limits,
extension size limits and duplicate-extension handling are therefore **rules for a parser that
does not exist**, which is an argument for specifying them before it arrives rather than after —
and an argument that this is phase-sized work rather than a patch.
