# Deferred items — Phase 24

Out-of-scope discoveries, logged rather than fixed. The scope rule this file exists for:
only issues **directly caused by the current task's changes** are auto-fixed.

## `tools/aot/lift.node.test.ts` — 9 cases red on a loaded host (found 2026-08-06, Plan 24-03)

**Observed** during 24-03's full `npx vitest run --project node`: exit 1, `2 failed | 160
passed` files, of which 9 of the 10 failing cases are in `tools/aot/lift.node.test.ts`. The
tenth was 24-03's own and was fixed.

**The failure text is the file's own self-diagnosis**, not an assertion:

> `an answer that cost 20007 ms leaves no room for another attempt inside the 30000 ms this
> wrapper may spend inside a 60000 ms case, so this case never ran: docker was reached but did
> not answer within 20000 ms — the daemon is wedged or the host is swamped, so nothing here is
> known about the image or the lift; retry when the host is quieter`

**Why it is not 24-03's**, by measurement rather than by plausibility:

- `lift.node.test.ts` imports `node:*`, `vitest`, `@o2/core`, `@o2/aot` and `./stubs.ts`.
  **Nothing Plan 24-03 touched is reachable from it** — not `fabric-node.ts`, not
  `browser-node.ts`, not either binary. `grep` for all four in that file and in `lift.ts`
  returns nothing.
- It fails identically when run alone with `-t`, so it is not an interaction with a
  concurrently-running spec of 24-03's.
- `24-02-SUMMARY.md` records `--project node` at exit **0** earlier the same day, so this
  arrived between that run and this one without either plan touching the file.

**What is known about the host**, measured after the run: `docker info` exits 0, and
`docker image inspect --format '{{.Id}}' alpine:latest` answers in **0.09 / 0.11 / 0.18 s**
across three readings. So the daemon is *not* wedged now. The 20 s exhaustion was observed
during a 434 s full-project run with concurrent agents on the machine, which is the second
half of the file's own stated condition — *"or the host is swamped"*.

**Not fixed, and not re-run hoping it clears.** Owner: whoever next takes `tools/aot`. The
useful next step is a reading taken on a quiet host, since the file already names the
condition it wants and this run does not establish whether anything else is wrong.
