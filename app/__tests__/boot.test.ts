import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? files(join(dir, f)) : [join(dir, f)]));

describe('web start', () => {
  it('the app starts at once: nothing before it loads Skia', () => {
    expect(read('index.ts')).not.toMatch(/Skia|boot/);
  });

  it('only the sign-up film loader downloads Skia, and the sign-in screen asks for it', () => {
    const users = files(join(__dirname, '..', 'src')).filter((f) => /LoadSkiaWeb/.test(readFileSync(f, 'utf8')));
    expect(users.map((f) => f.split('/src/')[1])).toEqual(['intro/film.web.ts']);
    expect(read('src/screens/SignInScreen.tsx')).toMatch(/loadFilm\(\)/);
  });

  it('the web film is imported only after the engine has loaded', () => {
    expect(read('src/intro/film.web.ts')).toMatch(/await LoadSkiaWeb[\s\S]*import\('..\/screens\/IntroSequence'\)/);
  });
});
