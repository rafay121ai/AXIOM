import { readFileSync } from 'fs';
import { join } from 'path';

const read = (f: string) => readFileSync(join(__dirname, '..', f), 'utf8');

it('the care screen holds no phone numbers, no glow and no animation', () => {
  const t = read('src/screens/CareScreen.tsx');
  expect(t).not.toMatch(/\d{3}[\s-]?\d{3,4}/);
  expect(t).not.toMatch(/Glow|Animated/);
});

it('the serif is loaded, not left to the platform', () => {
  expect(read('src/theme.ts')).not.toMatch(/Georgia|ui-serif/);
});
