import { writeFileSync } from 'node:fs'

/**
 * Per-module spans taken from vitest's own module lifecycle rather than from case
 * start/end stamps.
 *
 * `--reporter=json` brackets a file from its FIRST CASE, so every millisecond a
 * top-level `beforeAll` spends is charged to nothing. `ModuleDiagnostic.duration` is
 * documented as "Accumulated duration of all tests and hooks in the module", and the
 * four lifecycle hooks bracket the file from enqueue to finish. This records both, so
 * the two instruments can be compared inside one run.
 */
export default class ModuleSpanReporter {
  #queued = new Map()
  #collected = new Map()
  #started = new Map()
  #rows = []
  #out
  #origin

  constructor(options = {}) {
    this.#out = options.outputFile ?? process.env.O2_MODULE_SPAN_OUT ?? 'module-spans.json'
    this.#origin = performance.now()
  }

  onTestModuleQueued(m) {
    this.#queued.set(m.moduleId, performance.now())
  }

  onTestModuleCollected(m) {
    this.#collected.set(m.moduleId, performance.now())
  }

  onTestModuleStart(m) {
    this.#started.set(m.moduleId, performance.now())
  }

  onTestModuleEnd(m) {
    const endedAt = performance.now()
    let diagnostic = null
    try {
      const d = m.diagnostic()
      diagnostic = {
        environmentSetupDuration: d.environmentSetupDuration,
        prepareDuration: d.prepareDuration,
        collectDuration: d.collectDuration,
        setupDuration: d.setupDuration,
        duration: d.duration,
      }
    } catch (error) {
      diagnostic = { error: String(error) }
    }

    const queuedAt = this.#queued.get(m.moduleId)
    const collectedAt = this.#collected.get(m.moduleId)
    const startedAt = this.#started.get(m.moduleId)

    this.#rows.push({
      moduleId: m.moduleId,
      // Wall-clock brackets, main-process stamps. Each is null when the hook did not fire.
      queuedToEndMs: queuedAt === undefined ? null : endedAt - queuedAt,
      collectedToEndMs: collectedAt === undefined ? null : endedAt - collectedAt,
      startedToEndMs: startedAt === undefined ? null : endedAt - startedAt,
      // What vitest itself accumulated.
      diagnostic,
    })
  }

  onTestRunEnd() {
    writeFileSync(
      this.#out,
      JSON.stringify(
        { runWallClockMs: performance.now() - this.#origin, modules: this.#rows },
        null,
        2,
      ),
    )
  }
}
