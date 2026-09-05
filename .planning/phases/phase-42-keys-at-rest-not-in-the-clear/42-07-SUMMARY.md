# 42-07 — SUMMARY: a way to look around before choosing a passphrase

**Owner ruling, 2026-09-05: yes.** A visitor may now see the whole page before inventing a
passphrase, and the passphrase floor did not move.

## What landed

A ninth state on the entry machine, `looking-around`, and the surface for it.

- `packages/browser/src/signin.ts` — `SigninState` gains `{ kind: 'looking-around' }`,
  `SigninInput` gains `lookingAround: boolean`. The branch sits **below** `unlocked` and
  **above** the three storage-derived modes. Below, so a convenience never outranks the
  gate, a decline or a refusal; above, so a returning visitor's own choice is not silently
  replaced by what their storage happens to hold.
- `packages/browser/demo/index.html` — *Look around first* beside Register and Log in;
  `#lookaround-notice` and *Register or log in* inside `#main`, revealed in that state and
  nowhere else; `revealMain` split; `paintReadiness` extracted.
- `packages/browser/demo/main.ts` — unchanged. The flag is page-local, like `declined`.

**The feature cost almost no new copy, and that is the design rather than luck.** The page
already paints every surface at its *stopped* sentence at boot — six `paintSurfaceAbsence`
calls before anything runs — so a visitor looking around reads the same honest sentences a
visitor who pressed Stop reads. The state adds a notice saying why nothing is running and a
control back to the passphrase field, and nothing else.

## The defect this found, which was already in the tree

`revealMain`'s once-only guard stood **above** its three visibility assignments, so a second
reveal returned before un-hiding `#main`.

Nothing reached that path while unlock was the only way in. Look around → Register → unlock
does, and the visitor would have landed on a **blank page** — no error, no console entry,
nothing in any log. The guard now covers the side effects it was written for (discovery, the
`#join` binding, `paintEnrolmentOffer`) and visibility is set on every call.

Reproduced deliberately: plant 2b below, `240 × locator resolved to hidden`.

## The plants

Each applied, watched, restored by the surgical inverse of the edit and verified `cmp`
identical against a snapshot taken immediately before planting.

| # | Mutation | Observed |
|---|----------|----------|
| 1 | `looking-around` moved above `refused` in `signin.ts` | RED — *"{"refusal":"SealedIdentityUnlockError"} with lookingAround produced 'looking-around' — a convenience was allowed to outrank something that is not one"*, 3 browsers |
| 2a | `return` before `paintReadiness` on the second reveal | RED — `waitForRunning` timed out at 90 000 ms: the hoisted `startNode` is load-bearing |
| 2b | the once-only guard moved back above the visibility assignments | RED — `waiting for locator('#main') to be visible`, `240 × locator resolved to hidden` |
| 3a | `joinEl.disabled = true` **deleted** from the signed-out arm | **GREEN — see below** |
| 3b | `joinEl.disabled = false` in the signed-out arm | RED — *"the Start control was pressable with nobody signed in…"* |
| 4 | a digit added to `#lookaround-notice` | RED — P2, *"a number on screen with no data-region ancestor"* |

**Plant 3a stayed green and the reason is recorded rather than smoothed over.** Deleting the
disable does not make the control pressable, because `#join` carries `disabled` in the markup
and the look-around path never enables it — the line removed was belt to the markup's braces.
The instrument is **not** blind: 3b mutates the mechanism the assertion actually names and it
reddens in 539 ms. What 3a measured is that the assertion has two independent guards behind
it, which is a fact about the page and not a gap in the reading.

## What was deliberately not done

- **`PASSPHRASE_MIN_LENGTH` does not move.** The attacker is offline holding a disk image and
  Argon2id at this repository's parameters prices a guess at roughly two per second per core;
  twenty characters is where that cost starts to matter. Lowering it on the browser tier would
  also make `identity-protection.ts` a lie about one of its two users. The barrier is answered
  by asking for the right *kind* of thing — four ordinary words — and now by not charging it
  before a visitor has seen anything.
- **`UI_SPEC_TALLY` did not move**, and the new elements carry no `data-region`. Declaring one
  would be enumerated document-wide by `demo-regions.e2e.test.ts`'s region walker and would
  need a catalogue row for a sentence that states no figure. `#gate` is the precedent.
- **The gate keeps its position, ids, controls and semantics.** Look-around sits after
  consent, never in front of it: revealing the surfaces runs `discoverRelays()`, which is a
  network act, and a visitor who declined has answered exactly that question. That is why
  *Look around first* is hidden in `declined` and nowhere else.
- **`status.html`'s *"Nothing here needs an account, a key or a cookie"*** — a separate
  question, put to the owner and not yet ruled on. Left alone.

## Measured

| lane | result | host |
|------|--------|------|
| `node` | 244 files, 3499 passed, 2 skipped, EXIT=0 | oversubscribed at the end — pass/fail stands, durations void |
| `browser` | 408 files, 6750 passed, EXIT=0 | oversubscribed at the start — same reading |
| `e2e` | see below | |

`npx tsc --noEmit` EXIT=0. `npm run build:demo` EXIT=0.

## Still open in Phase 42

`42-05`, the owner's checkpoint. `AUTH-06` stays unticked until it runs.
