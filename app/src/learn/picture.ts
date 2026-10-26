// The numbers behind the fixed picture library. The server has already checked every value; these
// only turn them into bar lengths and labels.

const percent = (n: number) => Math.round(Math.max(0, Math.min(100, n)) * 10) / 10;

/** Bar lengths for a split bar: each part's share of the whole, in percent. */
export function shares(values: number[]): number[] {
  const total = values.reduce((a, b) => a + b, 0);
  return values.map((v) => (total > 0 ? percent((v / total) * 100) : 0));
}

/** Bar lengths for before and after bars: every bar against the largest value on the picture. */
export function scaled(values: number[]): number[] {
  const top = Math.max(0, ...values);
  return values.map((v) => (top > 0 ? percent((v / top) * 100) : 0));
}

/** A value with its unit: "12%", "$40", "3 hours". */
export function withUnit(value: number, unit?: string): string {
  if (!unit) return String(value);
  if (unit === '%') return `${value}%`;
  if (/^[$€£]$/.test(unit)) return `${unit}${value}`;
  return `${value} ${unit}`;
}
