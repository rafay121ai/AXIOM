import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';
import { useReduceMotion } from './useReduceMotion';

// Slow drifting soft gold light, so the glass has something to blur.
// Sizes, places and colours are from the mock; it holds still with "reduce motion".
const BLOBS = [
  { size: 260, left: -50, top: 330, color: '205,178,126', alpha: 0.8, dx: 60, dy: 70, ms: 16000 },
  { size: 300, right: -90, top: 520, color: '168,142,94', alpha: 0.7, dx: -70, dy: -90, ms: 20000 },
  { size: 220, left: 40, bottom: -60, color: '234,236,238', alpha: 0.22, dx: 60, dy: 70, ms: 24000 },
] as const;

function Blob({ b, still }: { b: (typeof BLOBS)[number]; still: boolean }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (still) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(v, { toValue: 1, duration: b.ms, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(v, { toValue: 0, duration: b.ms, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [b.ms, still, v]);
  const { size, color, alpha, dx, dy, ...place } = b;
  const id = `g${color.replace(/,/g, '')}${size}`;
  return (
    <Animated.View
      style={[
        { position: 'absolute', width: size, height: size },
        place,
        { transform: [{ translateX: v.interpolate({ inputRange: [0, 1], outputRange: [0, dx] }) }, { translateY: v.interpolate({ inputRange: [0, 1], outputRange: [0, dy] }) }] },
      ]}
    >
      <Svg width={size} height={size}>
        <Defs>
          <RadialGradient id={id} cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor={`rgb(${color})`} stopOpacity={alpha} />
            <Stop offset="0.7" stopColor={`rgb(${color})`} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Circle cx={size / 2} cy={size / 2} r={size / 2} fill={`url(#${id})`} />
      </Svg>
    </Animated.View>
  );
}

export function Glow() {
  const reduce = useReduceMotion();
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { overflow: 'hidden' }]}>
      {BLOBS.map((b) => <Blob key={b.size} b={b} still={reduce} />)}
    </View>
  );
}
