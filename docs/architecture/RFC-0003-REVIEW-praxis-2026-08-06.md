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
