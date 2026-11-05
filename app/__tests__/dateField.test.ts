import { readFileSync } from 'fs';
import { join } from 'path';

import { fromIsoDay, isoDay } from '../src/move/format';

it('keeps the calendar day the founder picked, at any hour', () => {
  expect(isoDay(new Date(2026, 10, 30, 0, 30))).toBe('2026-11-30');
  expect(isoDay(new Date(2026, 10, 30, 23, 30))).toBe('2026-11-30');
  expect(isoDay(fromIsoDay('2026-03-01'))).toBe('2026-03-01');
});

it('the compact picker is never drawn on Android', () => {
  for (const f of ['DateField', 'TimeField']) {
    const t = readFileSync(join(__dirname, '..', 'src/components', `${f}.tsx`), 'utf8');
    expect(t.indexOf("Platform.OS === 'android'")).toBeGreaterThan(-1);
    expect(t.indexOf("Platform.OS === 'android'")).toBeLessThan(t.indexOf('display="compact"'));
  }
});
