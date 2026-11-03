import {
  Blur, BlurMask, Canvas, Circle, FractalNoise, Group, LinearGradient, Paint, Path, RadialGradient, Rect, Skia, Text as SkText, useFont, vec,
  type SkPath,
} from '@shopify/react-native-skia';
import { LinearGradient as Fade } from 'expo-linear-gradient';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, useWindowDimensions } from 'react-native';
import Animated, { cancelAnimation, Easing, useAnimatedStyle, useDerivedValue, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { LEFT, RIGHT } from '../components/Logo';
import { WebLines } from '../components/Web';
import { useReduceMotion } from '../components/useReduceMotion';
import { copy } from '../copy';
import { bell, clamp, inOut, INTRO as I, out3, seg, session, startAt } from '../intro/timeline';

// The sign-up film (approved prototype: tasks/design/intro-v3.html). One clock `t` (ms) on the UI thread; Skia draws the
// light, the web, the emblem and the tagline from it. `children` (the button and legal line) rise in last. A tap skips to the end.

const gold = (a: number) => `rgba(222,192,138,${a})`;
const STOPS = ['#F0E8DA', '#F8F0E3', '#B98143', '#E9D8BF', '#642B35', '#EDE4D6'];
const STOP_AT = [0, 0.25, 0.42, 0.6, 0.8, 1];
const FROM = { y: 0.45, size: 136 }; // the emblem draws here (y as a share of the screen height) ...
const TO = { y: 0.41, size: 92 }; // ... and settles here
const SAMPLES = 240;

type Stroke = { path: SkPath; tip: number; pts: number[] };

// Each stroke runs foot, up to the tip, back down. `tip` is where the tip sits (0 to 1), so drawing grows out from it;
// `pts` are sampled points (x, y pairs) for the two bright ends.
function measure(d: string): Stroke {
  const path = Skia.Path.MakeFromSVGString(d)!;
  const contour = Skia.ContourMeasureIter(path, false, 1).next()!;
  const len = contour.length();
  const pts: number[] = [];
  let tip = 0;
  for (let k = 0; k < SAMPLES; k++) {
    const [pos] = contour.getPosTan((len * k) / (SAMPLES - 1));
    pts.push(pos.x, pos.y);
    if (pos.y < pts[tip * 2 + 1]) tip = k;
  }
  return { path, tip: tip / (SAMPLES - 1), pts };
}

const Clock = createContext<SharedValue<number> | null>(null);

export function IntroSequence({ children }: { children: ReactNode }) {
  const reduce = useReduceMotion();
  const { width: W, height: H } = useWindowDimensions();
  const [from] = useState(() => startAt(session.played));
  const t = useSharedValue(from);
  const [done, setDone] = useState(from === I.end);
  const playing = from === 0;

  const finish = () => {
    cancelAnimation(t);
    t.value = I.end;
    setDone(true);
  };

  useEffect(() => {
    if (!playing) return;
    session.played = true;
    t.value = withTiming(I.end, { duration: I.end, easing: Easing.linear }, (finished) => {
      if (finished) scheduleOnRN(setDone, true);
    });
    return () => cancelAnimation(t);
  }, [playing, t]);

  // Reduce motion is read asynchronously: the film has only just begun (black), so jumping to the end is clean.
  useEffect(() => {
    if (reduce) finish();
  }, [reduce]);

  const strokes = useMemo(() => [measure(LEFT), measure(RIGHT)], []);
  const font = useFont(require('@expo-google-fonts/manrope/500Medium/Manrope_500Medium.ttf'), 12.5);

  const cx = W / 2, fromY = H * FROM.y, toY = H * TO.y;
  const ax = cx, ay = fromY - FROM.size / 2 + 0.11 * FROM.size; // the emblem's tip while it draws

  const floor = useDerivedValue(() => out3(seg(t.value, I.floor)));
  const webOn = useDerivedValue(() => out3(seg(t.value, I.web)));
  const webClip = useDerivedValue(() => {
    return Skia.Path.Circle(0, 0, 20 + 560 * webOn.value);
  });
  const webTurn = useDerivedValue(() => [{ translateX: cx }, { translateY: toY }, { rotate: (t.value / 1000) * 0.004 }]);
  const point = useDerivedValue(() => out3(seg(t.value, I.point)) * (1 - seg(t.value, I.pointOut)));
  const streak = useDerivedValue(() => out3(seg(t.value, I.streakIn)) * (1 - inOut(seg(t.value, I.streakOut))));
  const half = useDerivedValue(() => 200 * streak.value);
  const streakX = useDerivedValue(() => ax - half.value);
  const streakW = useDerivedValue(() => half.value * 2);
  const streakA = useDerivedValue(() => vec(ax - half.value, 0));
  const streakB = useDerivedValue(() => vec(ax + half.value, 0));
  const settle = useDerivedValue(() => inOut(seg(t.value, I.settle)));
  const logoT = useDerivedValue(() => {
    const s = settle.value, y = fromY + (toY - fromY) * s, size = FROM.size + (TO.size - FROM.size) * s;
    return [{ translateX: cx - size / 2 }, { translateY: y - size / 2 }, { scale: size / 100 }];
  });
  const drawn = useDerivedValue(() => (t.value < I.draw[0] ? 0 : inOut(seg(t.value, I.draw))));
  const glow = useDerivedValue(() => 0.2 + 0.7 * bell(seg(t.value, I.bloom)) - 0.05 * settle.value);
  const sweep = useDerivedValue(() => (t.value < I.sweep2[0] ? -0.2 + 1.4 * seg(t.value, I.sweep) : -0.2 + 1.4 * seg(t.value, I.sweep2)));
  const grainSeed = useDerivedValue(() => Math.floor(t.value / 42) % 97);

  const rise = useAnimatedStyle(() => {
    const e = out3(seg(t.value, I.button));
    return { opacity: e, transform: [{ translateY: 14 * (1 - e) }] };
  });

  return (
    <Clock.Provider value={t}>
      <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
        <Rect x={0} y={0} width={W} height={H} opacity={floor}>
          <LinearGradient start={vec(0, H * 0.35)} end={vec(0, H)} colors={[gold(0), gold(0.06), gold(0.2)]} positions={[0, 0.6, 1]} />
        </Rect>

        <Group transform={webTurn} clip={webClip}>
          <WebLines />
        </Group>

        <Circle cx={ax} cy={ay} r={42} opacity={point}>
          <RadialGradient c={vec(ax, ay)} r={42} colors={['rgba(255,250,238,1)', gold(0.7), gold(0)]} positions={[0, 0.12, 1]} />
        </Circle>
        <Group opacity={streak}>
          <Rect x={streakX} y={ay - 2} width={streakW} height={4} color={gold(0.7)}>
            <BlurMask blur={6} style="normal" />
          </Rect>
          <Rect x={streakX} y={ay - 0.75} width={streakW} height={1.5}>
            <LinearGradient start={streakA} end={streakB} colors={[gold(0), gold(0.6), 'rgba(255,250,240,1)', gold(0.6), gold(0)]} positions={[0, 0.42, 0.5, 0.58, 1]} />
          </Rect>
        </Group>

        <Group transform={logoT}>
          {strokes.map((s, i) => (
            <EmblemStroke key={i} stroke={s} order={i} drawn={drawn} glow={glow} sweep={sweep} />
          ))}
        </Group>

        {font && <Tagline font={font} t={t} cx={cx} y={toY + TO.size / 2 + 34} />}

        <Rect x={0} y={0} width={W} height={H} opacity={0.045} blendMode="screen">
          <FractalNoise freqX={0.9} freqY={0.9} octaves={2} seed={grainSeed} />
        </Rect>
      </Canvas>
      {!done && <Pressable style={StyleSheet.absoluteFill} onPress={finish} accessibilityLabel="Skip" />}
      <Animated.View style={[styles.bottom, rise]} pointerEvents={done ? 'auto' : 'none'}>
        {children}
      </Animated.View>
    </Clock.Provider>
  );
}

// One stroke of the emblem: it grows out from the tip with a bright point at each end, glows, and takes the sweep of light.
function EmblemStroke({ stroke, order, drawn, glow, sweep }: {
  stroke: Stroke; order: number; drawn: SharedValue<number>; glow: SharedValue<number>; sweep: SharedValue<number>;
}) {
  const { path, tip, pts } = stroke;
  const q = useDerivedValue(() => clamp((drawn.value - order * 0.04) / 0.96));
  const start = useDerivedValue(() => tip * (1 - q.value));
  const end = useDerivedValue(() => tip + (1 - tip) * q.value);
  const at = (f: number) => {
    'worklet';
    const k = Math.round(f * (SAMPLES - 1)) * 2;
    return vec(pts[k], pts[k + 1]);
  };
  const headA = useDerivedValue(() => at(start.value));
  const headB = useDerivedValue(() => at(end.value));
  const heads = useDerivedValue(() => (q.value > 0 && q.value < 1 ? 1 : 0));
  const glowA = useDerivedValue(() => (q.value > 0 ? 0.45 * glow.value : 0));
  const sweepOn = useDerivedValue(() => (sweep.value > -0.2 && sweep.value < 1.2 ? 1 : 0));
  const band = useDerivedValue(() => [clamp(sweep.value - 0.1), clamp(sweep.value), clamp(sweep.value + 0.1)]);
  const line = { path, style: 'stroke' as const, strokeWidth: 3.5, strokeJoin: 'miter' as const };

  return (
    <Group>
      <Path {...line} start={start} end={end} color={gold(1)} opacity={glowA}>
        <BlurMask blur={5} style="normal" />
      </Path>
      <Path {...line} start={start} end={end}>
        <LinearGradient start={vec(0, 0)} end={vec(100, 100)} colors={STOPS} positions={STOP_AT} />
      </Path>
      <Group opacity={heads}>
        <Circle c={headA} r={8}>
          <RadialGradient c={headA} r={8} colors={['rgba(255,250,238,1)', gold(0.75), gold(0)]} positions={[0, 0.25, 1]} />
        </Circle>
        <Circle c={headB} r={8}>
          <RadialGradient c={headB} r={8} colors={['rgba(255,250,238,1)', gold(0.75), gold(0)]} positions={[0, 0.25, 1]} />
        </Circle>
      </Group>
      <Path {...line} opacity={sweepOn}>
        <LinearGradient start={vec(-10, 0)} end={vec(110, 60)} colors={['rgba(255,248,232,0)', 'rgba(255,250,240,0.9)', 'rgba(255,248,232,0)']} positions={band} />
      </Path>
    </Group>
  );
}

type Font = NonNullable<ReturnType<typeof useFont>>;

// "SEE. LEARN. BECOME." under the settled emblem; each word clears from a slight blur and rises a few points into place.
function Tagline({ font, t, cx, y }: { font: Font; t: SharedValue<number>; cx: number; y: number }) {
  const words = copy.intro.words.map((w) => w.toUpperCase());
  const spacing = 4, gap = 14;
  const widths = words.map((w) => [...w].reduce((a, c) => a + font.measureText(c).width + spacing, -spacing));
  let x = cx - (widths.reduce((a, b) => a + b, 0) + gap * (words.length - 1)) / 2;
  const baseline = y + 4.5;
  return (
    <>
      {words.map((w, i) => {
        const chars: { c: string; x: number }[] = [];
        let cx2 = x;
        for (const c of w) { chars.push({ c, x: cx2 }); cx2 += font.measureText(c).width + spacing; }
        x += widths[i] + gap;
        return <TagWord key={w} chars={chars} font={font} t={t} at={I.tag + i * I.tagGap} baseline={baseline} />;
      })}
    </>
  );
}

function TagWord({ chars, font, t, at, baseline }: { chars: { c: string; x: number }[]; font: Font; t: SharedValue<number>; at: number; baseline: number }) {
  const e = useDerivedValue(() => out3(seg(t.value, [at, at + I.tagIn])));
  const move = useDerivedValue(() => [{ translateY: 6 * (1 - e.value) }]);
  const blur = useDerivedValue(() => 5 * (1 - e.value));
  return (
    <Group opacity={e} transform={move} layer={<Paint><Blur blur={blur} /></Paint>}>
      {chars.map((ch, k) => <SkText key={k} x={ch.x} y={baseline} text={ch.c} font={font} color="rgba(234,236,238,0.78)" />)}
    </Group>
  );
}

/** One soft shine across the Google button, on the film's clock. Goes inside the button. */
export function IntroShine() {
  const t = useContext(Clock);
  const w = useSharedValue(0);
  const style = useAnimatedStyle(() => {
    const s = t ? seg(t.value, I.shine) : 1;
    return { opacity: s > 0 && s < 1 ? 1 : 0, transform: [{ translateX: -120 + (w.value + 240) * inOut(s) }] };
  });
  return (
    <Animated.View pointerEvents="none" style={StyleSheet.absoluteFill} onLayout={(ev) => { w.value = ev.nativeEvent.layout.width; }}>
      <Animated.View style={[styles.shine, style]}>
        <Fade colors={['rgba(255,246,226,0)', 'rgba(255,246,226,0.16)', 'rgba(255,246,226,0)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill} />
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  shine: { position: 'absolute', top: 0, bottom: 0, width: 120 },
});
