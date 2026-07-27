import { describe, expect, it } from 'vitest'
import { describeFinding, scanStream } from './scan.ts'

/**
 * A finding has to grep back to the line it was made from.
 *
 * The scanner's parsing is covered in `lift.node.test.ts`, over the captured
 * fixtures. This file covers the other end — the rendering — because that is where a
 * number can survive parsing intact and still arrive in the build log meaning
 * something else.
 *
 * `Arch.cpp:4196` prints the system-register sub-fields with `%x`. They were parsed
 * with `parseInt(…, 16)`, held as numbers, and then interpolated with the default
 * conversion, which is decimal. The round trip is lossless only for values below ten,
 * and the first register in the captured fixture whose `crn` is `d` was reported as
 * `crn=13` — not findable by searching the raw output for what the toolchain said, and
 * indistinguishable from a genuine `crn` of 0x13.
 *
 * The line below is a verbatim copy of `fixtures/system-registers.stderr.txt`, kept
 * here as a literal rather than read from the file: the expectation is a conformance
 * vector, and a vector derived from the same source as the value under test only
 * proves the code agrees with itself.
 */

/** `tpidr_el1`, as captured on 2026-07-27 from `ghcr.io/yomaytk/elfconv:arm64`. */
const CAPTURED =
  'E20260727 06:40:33.655107 281472948068384 Arch.cpp:4196] ' +
  'Unrecognized system register c684 with op0=3, op1=0, crn=d, crm=0, op2=4, bits.name=0xc684'

describe('an unmodelled system register is rendered in the base the toolchain printed', () => {
  const [finding] = scanStream(CAPTURED, 'stderr').findings

  it('parsed the captured line at all, so the assertions below are about something', () => {
    expect(finding?.kind).toBe('unknown-system-register')
  })

  it('reproduces the toolchain sub-field tuple verbatim, so the line can be grepped back', () => {
    expect(finding).toBeDefined()
    if (finding === undefined) return
    expect(describeFinding(finding)).toContain('op0=3, op1=0, crn=d, crm=0, op2=4')
  })

  it('never spells a sub-field in decimal, which would name a different register', () => {
    expect(finding).toBeDefined()
    if (finding === undefined) return
    // 0xd rendered as `13` is both unfindable and a legal hex spelling of 19.
    expect(describeFinding(finding)).not.toContain('crn=13')
  })

  it('names the encoding the way the toolchain named it in bits.name', () => {
    expect(finding).toBeDefined()
    if (finding === undefined) return
    expect(describeFinding(finding)).toContain('0xc684')
  })

  it('still says what the finding means, not only what it is', () => {
    // The hex is a grep key; the sentence is why anyone would grep. Losing the
    // second while fixing the first would be a fair trade nobody asked for.
    expect(finding).toBeDefined()
    if (finding === undefined) return
    expect(describeFinding(finding)).toContain('not modelled')
  })
})
