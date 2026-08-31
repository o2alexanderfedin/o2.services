/**
 * Phase 41 — the guard over the cross-host workflow, and over the sentence it retires.
 *
 * ## Why a spec rather than a paragraph
 *
 * `cross-machine.node.test.ts` already carries this project's answer to that question: a note
 * in a planning document is the same shape as the measurement this project lost. What is
 * being kept true here is three things a two-word diff could each undo — the trigger, the
 * runner architecture, and the refusal to lift on a host that is not `aarch64`.
 *
 * ## What this file does NOT claim
 *
 * That the workflow has run. It has not. Criterion 1 asks for two hosts and this is one half
 * of the arrangement for obtaining the second; the reading itself is a dispatch away and a
 * dispatch is an owner act, because it is a push to a public repository. Nothing here should
 * be read as `AOT-03` closing.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const WORKFLOW = readFileSync(
  fileURLToPath(new URL('../../.github/workflows/aot-cross-host.yml', import.meta.url)),
  'utf8',
)

describe('AOT-03 — the second host is arranged, and cannot become a first one quietly', () => {
  it('is dispatched BY HAND and by no other trigger', () => {
    // The rule `deploy.yml` states and `DEMO-04` guards: a job with a cost does not start by
    // itself. Widening this is a two-word diff — `on: push:` — which is why the trigger set is
    // read rather than trusted. Plant that reddens this: add `push:` under `on:`.
    const triggers = WORKFLOW.slice(WORKFLOW.indexOf('\non:'))
    expect(triggers).toContain('workflow_dispatch:')
    expect(triggers.slice(0, triggers.indexOf('permissions:'))).not.toMatch(/\n\s{2}push:/)
    expect(triggers.slice(0, triggers.indexOf('permissions:'))).not.toMatch(/\n\s{2}schedule:/)
    expect(triggers.slice(0, triggers.indexOf('permissions:'))).not.toMatch(/\n\s{2}pull_request:/)
  })

  it('asks for an arm64 Linux runner on EVERY job, not merely on one', () => {
    // A job left on `ubuntu-latest` would be an x86 host, and the elfconv build this project
    // uses is `:arm64` — handed an AArch64 fixture, the `:amd64` sibling reaches `LOG(FATAL)`
    // during arch dispatch (measured 2026-08-17, exit 134). So an x86 runner produces no
    // artifact and no finding, which is worse than a failure: it is a run that looks like
    // participation.
    const runners = [...WORKFLOW.matchAll(/runs-on:\s*(\S+)/g)].map((hit) => hit[1])
    expect(runners.length).toBeGreaterThan(0)
    for (const runner of runners) expect(runner).toContain('-arm')
  })

  it('REFUSES to lift on a host whose own uname is not aarch64', () => {
    // Criterion 2 in the workflow's own terms: the machine is read off the host rather than
    // assumed from the runner label, and a mismatch stops the job. A label is a request; the
    // uname is what was granted.
    expect(WORKFLOW).toContain('test "$MACHINE" = "aarch64"')
  })

  it('uploads the artifact beside the reading, so a divergence can be EXAMINED', () => {
    // Criterion 1 says a divergence is reported as a divergence and not normalised away. A
    // digest alone can only be counted; the bytes are what makes a difference explicable.
    expect(WORKFLOW).toContain('cross-host-lift.wasm')
    expect(WORKFLOW).toContain('if-no-files-found: error')
  })
})
