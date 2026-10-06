/**
 * The audit gate's decision, as a file rather than a heredoc — so every refusal can be planted.
 *
 * Takes two paths: a report written by `npm audit --omit=dev --json`, and the allowlist. Prints
 * what it decided and exits 0 or 1. It performs no network access and runs no audit of its own,
 * which is what lets a spec and a hand run it against a synthetic report.
 *
 * `scripts/audit-gate.sh` is what produces the report and what CI calls. The rules, and why
 * there are four rather than one, are in that file's own header.
 *
 * **Dates are compared in UTC**, because `toISOString()` is UTC and the allowlist's `until` is a
 * bare `YYYY-MM-DD`. An exemption therefore lapses at UTC midnight, which is up to a day earlier
 * than a reader west of Greenwich would expect. This repository has already been caught by the
 * same edge once — `daysOutstanding` floors both of its dates to UTC midnight, and a 14-day
 * promise came due thirty minutes after a green run.
 */
import { readFileSync } from 'node:fs'

const BLOCKING = new Set(['high', 'critical'])
const [reportPath, allowlistPath] = process.argv.slice(2)

const read = (path, what) => {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    console.error(`audit gate: could not read ${what} at ${path} — ${String(error)}`)
    process.exit(1)
  }
}

const report = read(reportPath, 'the audit report')
const allowlist = read(allowlistPath, 'the allowlist')

// The positive control. A registry that could not be reached, or a schema that moved, yields no
// advisories — and "no advisories" is the shape of success. Refuse that before counting.
if (typeof report.auditReportVersion !== 'number' || typeof report.metadata !== 'object' || report.metadata === null) {
  console.error('audit gate: the report carries no auditReportVersion or metadata, so it is not an audit result')
  console.error('audit gate: an empty advisory set from a failed audit is indistinguishable from a clean tree')
  process.exit(1)
}

const found = new Map()
for (const [name, entry] of Object.entries(report.vulnerabilities ?? {})) {
  for (const via of entry.via ?? []) {
    if (typeof via === 'string') continue
    if (!BLOCKING.has(via.severity)) continue
    const id = String(via.url ?? '').split('/').pop()
    if (!/^GHSA-/.test(id)) {
      console.error(`audit gate: ${name} reports a ${via.severity} advisory with no GHSA id in its url (${String(via.url)})`)
      process.exit(1)
    }
    found.set(id, { package: via.name ?? name, severity: via.severity, title: via.title ?? '' })
  }
}

const today = new Date().toISOString().slice(0, 10)
const entries = Array.isArray(allowlist.entries) ? allowlist.entries : []
const allowed = new Map(entries.map((entry) => [entry.id, entry]))
const refusals = []

for (const [id, advisory] of found) {
  const entry = allowed.get(id)
  if (entry === undefined) {
    refusals.push(`${id} (${advisory.severity}, ${advisory.package}) is not in the allowlist — ${advisory.title}`)
    continue
  }
  if (String(entry.until) < today) {
    refusals.push(`${id}'s exemption expired on ${String(entry.until)} and today is ${today} — re-read it or fix the dependency`)
  }
  if (entry.package !== advisory.package) {
    refusals.push(`${id} now reports against ${advisory.package}, and its entry names ${String(entry.package)} — the reason was measured against a different package`)
  }
}

for (const entry of entries) {
  if (!found.has(entry.id)) {
    refusals.push(`${String(entry.id)} is allowlisted and matches nothing any more — remove the entry`)
  }
}

if (refusals.length > 0) {
  console.error('')
  console.error('❌ audit gate refused:')
  for (const line of refusals) console.error(`   - ${line}`)
  console.error('')
  process.exit(1)
}

const names = [...found.keys()]
console.log(
  found.size === 0
    ? 'audit gate: no high or critical advisory, and the report is a real one'
    : `audit gate: ${String(found.size)} advisory held by a dated exemption — ${names.join(', ')}`,
)
for (const [id, advisory] of found) {
  const entry = allowed.get(id)
  console.log(`   ${id} (${advisory.package}) until ${String(entry.until)}`)
}
process.exit(0)
