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

it('the app source holds no care sentences; the server sends them', () => {
  const t = read('src/screens/CareScreen.tsx');
  expect(t).not.toMatch(/tell someone|not a counsellor|have to be okay|keep talking if/i);
  expect(t).not.toMatch(/[.!?]['"`<]/);
});

it('the app source holds no founder-lessons notice; the server sends it', () => {
  for (const f of ['src/screens/LearnScreen.tsx', 'src/screens/ReportScreen.tsx', 'src/components/FounderCard.tsx', 'src/learn/chat.ts', 'src/copy.ts']) {
    expect(read(f)).not.toMatch(/founder lessons?|more open|share what happened/i);
  }
});

it('the app source holds no account sentences; the server sends them', () => {
  const t = read('src/screens/SettingsScreen.tsx');
  expect(t).not.toMatch(/everything Axiom holds|nothing was deleted|no deletion waiting|type DELETE to confirm|yours to keep|grace/i);
  expect(t).not.toMatch(/[.!?]['"`<]/);
});

it('keep talking opens the home check-in, never the journey step the care screen interrupted', () => {
  const t = read('App.tsx');
  expect(t).toMatch(/onKeepTalking=\{\(\) => \{ setSoft\(null\); goTo\(\{ name: 'home' \}, true\); \}\}/);
  expect(t).not.toMatch(/name: 'care'[^}]*back/);
});

it('the journey backdrop is the construction grid; the spider web stays on the sign-in intro', () => {
  expect(read('App.tsx')).not.toMatch(/components\/Web'/);
  expect(read('src/components/Construction.tsx')).not.toMatch(/WebLines/);
  expect(read('src/screens/IntroSequence.tsx')).toMatch(/WebLines/);
});
