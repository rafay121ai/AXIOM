import { Path, RadialGradient, Skia, vec, type SkPath } from '@shopify/react-native-skia';
import { useMemo } from 'react';

const R = 560;
const gold = (a: number) => `rgba(222,192,138,${a})`;

// A spider web around (0, 0): uneven spokes, rings that sag between them. Fixed seed, so it is the same every time.
function makeWeb(): SkPath {
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const spokes = Array.from({ length: 16 }, (_, i) => (i / 16) * Math.PI * 2 + (rnd() - 0.5) * 0.22);
  const p = Skia.PathBuilder.Make();
  spokes.forEach((a) => { p.moveTo(0, 0); p.lineTo(Math.cos(a) * R, Math.sin(a) * R); });
  for (let k = 0; k < 11; k++) {
    const r = 46 * Math.pow(1.3, k);
    const jit = spokes.map(() => 0.9 + rnd() * 0.2);
    spokes.forEach((a, i) => {
      const j = (i + 1) % spokes.length, b = spokes[j] + (j === 0 ? Math.PI * 2 : 0);
      const r1 = r * jit[i], r2 = r * jit[j], mid = (a + b) / 2, sag = ((r1 + r2) / 2) * 0.9;
      p.moveTo(Math.cos(a) * r1, Math.sin(a) * r1);
      p.quadTo(Math.cos(mid) * sag, Math.sin(mid) * sag, Math.cos(b) * r2, Math.sin(b) * r2);
    });
  }
  return p.detach();
}

/** The faint gold web, centred on (0, 0). Goes inside a Skia Canvas, in a Group that places it. */
export function WebLines() {
  const web = useMemo(makeWeb, []);
  return (
    <Path path={web} style="stroke" strokeWidth={0.5}>
      <RadialGradient c={vec(0, 0)} r={R} colors={[gold(0), gold(0), gold(0.13), gold(0.08), gold(0)]} positions={[0, 0.1, 0.24, 0.55, 1]} />
    </Path>
  );
}
