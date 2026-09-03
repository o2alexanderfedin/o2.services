# Deferred — found during Phase 36, belongs to another phase or to nobody yet

## `wrangler dev` leaves a `.ts` in `.wrangler/tmp` that the reachability guard counts

**Found 2026-09-02, during Task 7.** A `wrangler dev` child killed with `SIGTERM` can leave
`packages/cloudflare/.wrangler/tmp/bundle-<id>/middleware-loader.entry.ts` behind. The path is
gitignored (`packages/cloudflare/.gitignore:1`), so it can never be committed — but
`reachability-guard.node.test.ts` walks the **filesystem**, so it counts as a 33rd orphan
module and refuses the commit:

```
AssertionError: 33 production modules have no production importer, against a ceiling of 32.
A HIGHER number means a new uncounted module arrived: … packages/cloudflare/.wrangler/tmp/
bundle-52woOs/middleware-loader.entry.ts …
```

**Not fixed here, and the reason is scope.** Every workerd e2e spec in this tree spawns
`wrangler dev` and kills it with `SIGTERM`, so the debris is not this phase's to create or to
clean; and the repair — teaching the guard's walk to skip gitignored paths — is an edit to an
instrument six phases depend on, made from a symptom rather than from a reading of what else
that walk would then stop seeing.

The workaround is `rm -rf packages/cloudflare/.wrangler/tmp`, which is what was done here.
Whoever picks this up should decide between (a) the guard consulting `git check-ignore`, and
(b) the specs cleaning up after themselves — (a) is one place, (b) is eight.
