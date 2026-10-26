import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

// The app talks only to the Express API. Supabase is for sign-in only.
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? sources(p) : /\.(ts|tsx)$/.test(f) ? [p] : [];
  });
}

it('no client code reads or writes Supabase tables', () => {
  for (const file of [...sources(join(__dirname, '../src')), join(__dirname, '../App.tsx')]) {
    const text = readFileSync(file, 'utf8');
    expect(text).not.toMatch(/\.from\(\s*['"`]/);
    expect(text).not.toMatch(/\.rpc\(/);
  }
});
