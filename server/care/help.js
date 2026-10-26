// Verified-help table by country. PLACEHOLDERS ONLY: no real phone number is
// written here until a person verifies it (ARCHITECTURE.md, Care). An entry
// is shown to a founder only when `verified` is true. Reviewed yearly.
import { CARE_COPY } from './copy.js'

// `names` are lowercase spellings matched against the sign-up country answer
// (free text, question 5). `lines` get real contact details after checking.
export const HELP_TABLE = Object.freeze([
  { code: 'US', names: ['us', 'usa', 'united states', 'united states of america', 'america'], emergency: null, lines: [{ name: 'PLACEHOLDER national crisis line', contact: null }], verified: false, verified_by: null, verified_on: null },
  { code: 'GB', names: ['uk', 'gb', 'united kingdom', 'great britain', 'england', 'scotland', 'wales', 'northern ireland'], emergency: null, lines: [{ name: 'PLACEHOLDER national crisis line', contact: null }], verified: false, verified_by: null, verified_on: null },
  { code: 'CA', names: ['ca', 'canada'], emergency: null, lines: [{ name: 'PLACEHOLDER national crisis line', contact: null }], verified: false, verified_by: null, verified_on: null },
  { code: 'IN', names: ['in', 'india'], emergency: null, lines: [{ name: 'PLACEHOLDER national crisis line', contact: null }], verified: false, verified_by: null, verified_on: null },
  { code: 'NG', names: ['ng', 'nigeria'], emergency: null, lines: [{ name: 'PLACEHOLDER national crisis line', contact: null }], verified: false, verified_by: null, verified_on: null },
  { code: 'AU', names: ['au', 'australia'], emergency: null, lines: [{ name: 'PLACEHOLDER national crisis line', contact: null }], verified: false, verified_by: null, verified_on: null },
])

const norm = (s) => String(s || '').trim().toLowerCase().replace(/\./g, '').replace(/\s+/g, ' ')

export function findCountryEntry(country, table = HELP_TABLE) {
  const key = norm(country)
  if (!key) return null
  return table.find((e) => e.code.toLowerCase() === key || e.names.includes(key)) || null
}

// Always returns something a founder can read. Unverified entries are never
// exposed: until a person verifies the country, the worldwide directory line
// is returned with needs_verification true.
export function helpFor(country, table = HELP_TABLE) {
  const entry = findCountryEntry(country, table)
  if (entry?.verified) {
    return {
      country: entry.code,
      emergency: entry.emergency,
      lines: entry.lines.map(({ name, contact }) => ({ name, contact })),
      fallback: CARE_COPY.fallbackLine,
      needs_verification: false,
    }
  }
  return {
    country: entry?.code ?? null,
    emergency: null,
    lines: [],
    fallback: CARE_COPY.fallbackLine,
    needs_verification: true,
  }
}
