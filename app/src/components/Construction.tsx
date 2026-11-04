import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, useWindowDimensions } from 'react-native';
import Svg, { Circle, Defs, Line, LinearGradient, Stop } from 'react-native-svg';
import { useReduceMotion } from './useReduceMotion';

const CELL = 32;
const DOT_EVERY = 4; // a point at every 4th crossing along each diagonal; r - c is unchanged by the one-cell drift, so the snap back is invisible
const DRIFT_MS = 60000; // one cell, then it loops without a seam

/** The "Construction" backdrop: a faint gold grid with sparse points, fading out at top and bottom, drifting one cell a minute. Still with "reduce motion". */
export function Construction() {
  const reduce = useReduceMotion();
  const { width: W, height: H } = useWindowDimensions();
  const drift = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduce) return;
    const loop = Animated.loop(Animated.timing(drift, { toValue: CELL, duration: DRIFT_MS, easing: Easing.linear, useNativeDriver: true }));
    loop.start();
    return () => { loop.stop(); drift.setValue(0); };
  }, [reduce, drift]);

  const cols = Math.ceil(W / CELL) + 2, rows = Math.ceil(H / CELL) + 2; // one spare cell on the top and left, so the drift never shows an edge
  const w = cols * CELL, h = rows * CELL;
  return (
    <Animated.View pointerEvents="none" style={[styles.layer, { width: w, height: h, transform: [{ translateX: drift }, { translateY: drift }] }]}>
      <Svg width={w} height={h}>
        <Defs>
          <LinearGradient id="fade" gradientUnits="userSpaceOnUse" x1="0" y1={CELL} x2="0" y2={h - CELL}>
            <Stop offset="0" stopColor="#cdb27e" stopOpacity="0" />
            <Stop offset="0.4" stopColor="#cdb27e" stopOpacity="1" />
            <Stop offset="0.8" stopColor="#cdb27e" stopOpacity="1" />
            <Stop offset="1" stopColor="#cdb27e" stopOpacity="0" />
          </LinearGradient>
        </Defs>
        {Array.from({ length: cols + 1 }, (_, c) => <Line key={`v${c}`} x1={c * CELL} y1={0} x2={c * CELL} y2={h} stroke="url(#fade)" strokeOpacity={0.035} strokeWidth={1} />)}
        {Array.from({ length: rows + 1 }, (_, r) => <Line key={`h${r}`} x1={0} y1={r * CELL} x2={w} y2={r * CELL} stroke="url(#fade)" strokeOpacity={0.035} strokeWidth={1} />)}
        {Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => (((r - c) % DOT_EVERY) + DOT_EVERY) % DOT_EVERY === 0 && (
          <Circle key={`d${r}-${c}`} cx={c * CELL} cy={r * CELL} r={1.2} fill="url(#fade)" fillOpacity={0.09} />
        )))}
      </Svg>
    </Animated.View>
  );
}

const styles = StyleSheet.create({ layer: { position: 'absolute', left: -CELL, top: -CELL } });
