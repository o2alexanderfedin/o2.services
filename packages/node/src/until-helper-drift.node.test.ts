/**
 * The `until` helper's ten copies, held to the same two rules.
 *
 * ## Why this is its own file, which is the whole reason it exists here
 *
 * It lived in `closed-fabric-agents.node.test.ts` and was a **reproducible failure there**,
 * not an intermittent one: that file's `beforeAll` is file-level and stands up the entire
 * fabric — every agent and every seed, as real processes — before any test in the file runs,
 * including the four in a describe that needs none of it. This check is pure filesystem: it
 * reads 178 sibling sources and greps them. Measured standing alone it takes **0.10-0.14 s**;
 * inside that file it exceeded the 5 000 ms budget, because every one of its 178 sequential
 * `await`s yielded into an event loop saturated by the spawned children's output. Its
 * siblings in the same describe stayed green, and that is the discriminator: they touch no
 * I/O, so nothing could starve them.
 *
 * Read alone on a quiet host the old arrangement still failed — `load/core 2.36 before, 3.62
 * after` against a ceiling of 4.00 — so this was never a statement about the machine. It was
 * also not a statement about the code under test: the same file, at the same line, was red on
 * 2026-09-14 20:54, before the branch that found it existed.
 *
 * **The fix is the move, not a larger timeout.** A budget raised to cover starvation measures
 * the fixture next door rather than the property, and the next guard added to that file would
 * inherit the same defect with nothing saying why.
 */
import { readFile, readdir } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

describe('the `until` helper is copied, and the copies must not drift', () => {
  it('holds every sibling `until` that polls across a boundary to the same two rules', async () => {
    // **Ten copies of this helper exist and they must not drift**, which is not a style
    // preference: `peer-dial.node.test.ts` already carried the throw guard before today, and
    // the nine that did not are how two whole-lane runs came back red for reasons that were
    // not about the code. A structural check is the only thing that can hold copies together
    // when the reason for keeping them separate — *"importing a helper from another
    // `.test.ts` re-registers that file's whole suite"* — is itself sound.
    //
    // Scoped to helpers whose predicate may be async, because those are the ones that poll
    // across a process or a network boundary. A synchronous predicate over local state cannot
    // throw transiently and cannot gain its answer during a sleep.
    const dir = fileURLToPath(new URL('.', import.meta.url))
    // **This guard's own source is excluded, and finding out why is part of what the move
    // bought.** The check greps for `async function until(` and then for two markers inside
    // the following 1 400 characters. This file carries all three as STRING LITERALS, in the
    // code that searches for them — so it matches itself, and reports itself as drifted. It
    // did not do so while it lived in `closed-fabric-agents.node.test.ts`, and not because
    // anything was handled: that file declares a real `until` helper ABOVE the check, so
    // `indexOf` found the genuine one first and the self-match was never reached. The guard
    // was resting on the accident of its neighbour's layout.
    //
    // Same collision class `wrangler.jsonc`'s header records twice — a guard's own text
    // reading as the thing it forbids. Derived from `import.meta.url` rather than written as
    // a literal, so renaming the file cannot silently switch the exemption off and leave a
    // guard that only ever reports itself.
    const self = basename(fileURLToPath(import.meta.url))
    const files = (await readdir(dir)).filter((name) => name.endsWith('.test.ts') && name !== self)
    const drifted: string[] = []
    for (const name of files) {
      const source = await readFile(join(dir, name), 'utf8')
      const at = source.indexOf('async function until(')
      if (at < 0) continue
      const head = source.slice(at, at + 1_400)
      if (!head.includes('Promise<boolean>')) continue
      // The FUNCTION-BODY indent, not the loop's. **This mattered**: the first form of this
      // check looked for the bare call, which also matches the `if (await attempt()) return`
      // INSIDE the while loop — present in every copy — so it was green against a plant that
      // deleted the re-check. A proof that cannot fail is not a proof; this one was watched
      // red before it was kept.
      if (!head.includes('\n  if (await attempt()) return')) drifted.push(name)
    }
    expect(
      drifted.sort(),
      'these files poll an async predicate and do not re-check it after the deadline, so a ' +
        'condition arriving during the last sleep is reported as a timeout',
    ).toStrictEqual([])
  })
})
