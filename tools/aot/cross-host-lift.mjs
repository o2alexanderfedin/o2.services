/**
 * One host's half of AOT-03's cross-host comparison — Phase 41 criteria 1 and 2.
 *
 * Prints, and writes to `cross-host-lift.json`, everything the comparison needs and nothing
 * that would let a same-host run pass as two:
 *
 * - `machine`, `platform`, `release` — read from **this** process on **this** host, never
 *   passed in. That is criterion 2, and it is the same discipline `announcedMachine` already
 *   applies to spawned agents.
 * - `sha256` of the lifted bytes, and the artifact itself, so a divergence can be examined
 *   rather than only counted.
 * - `toolchain` and `blindSpots` as the lift reported them, because a digest that differs
 *   because the two hosts ran different toolchain versions is not a determinism finding.
 *
 * **It reports a divergence as a divergence.** This script never normalises, never retries
 * and never compares — it produces one host's reading. Comparing two readings is a separate
 * act, deliberately, so that the thing which decides "identical" cannot also be the thing
 * that produced the bytes.
 */
import { createHash } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { arch, platform, release, cpus, hostname } from 'node:os'
import { describeLiftFailure, liftElf } from './lift.ts'

const fixture = process.argv[2] ?? 'tools/aot/fixtures/elf/hello_static'

const started = Date.now()
const out = await liftElf(fixture)
const elapsedMs = Date.now() - started

if (!out.ok) {
  console.error(describeLiftFailure(out.failure))
  process.exit(1)
}

const sha256 = createHash('sha256').update(out.artifact.bytes).digest('hex')
const reading = {
  // Criterion 2's half: this host, as this host reports itself.
  host: { hostname: hostname(), machine: arch(), platform: platform(), release: release(), cpus: cpus().length },
  fixture,
  sha256,
  bytes: out.artifact.bytes.length,
  verdict: out.artifact.verdict,
  target: out.artifact.target,
  toolchain: out.artifact.toolchain,
  // Required beside the bytes, never optional — `lift.ts:354`, and its docblock gives
  // the reason: a caller that has to know to ask is a caller that will not.
  blindSpots: out.artifact.blindSpots.map((one) => one.kind),
  elapsedMs,
}

writeFileSync('cross-host-lift.wasm', out.artifact.bytes)
writeFileSync('cross-host-lift.json', `${JSON.stringify(reading, null, 2)}\n`)
console.log(JSON.stringify(reading, null, 2))
