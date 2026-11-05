/** The phone's time zone, which the server uses for the report time when the founder has not saved one. */
export function deviceTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/** The server's 'HH:MM' as the mock says it: '20:00' is '8 pm', '18:30' is '6:30 pm'. */
export function spokenTime(local: string): string {
  const [h, m] = local.split(':').map(Number);
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}${m ? `:${String(m).padStart(2, '0')}` : ''} ${h < 12 ? 'am' : 'pm'}`;
}

/** The server's 'HH:MM' as a clock reading with minutes, as Settings shows it: '20:00' is '8:00 pm'. */
export function clockTime(local: string): string {
  const [h, m] = local.split(':').map(Number);
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
}

// The founder's own calendar day. Never through UTC: east of it, an early-morning pick saved as the day before.
export const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const fromIsoDay = (s: string) => new Date(`${s}T12:00:00`);
