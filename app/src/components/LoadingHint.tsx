import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import type { LoadingQuote } from '../api/types';
import { fonts, ink } from '../theme';
import { Logo } from './Logo';
import { useReduceMotion } from './useReduceMotion';

// Where Axiom's answer will appear: a small logo drawing itself and two very thin faint lines
// shimmering in time. No spinner, no dots. The quote and book name (book only, never an author)
// join in when the library can supply a verified one; without one the logo and the lines are the whole hint.
export function LoadingHint({ hint = null }: { hint?: LoadingQuote | null }) {
  const reduce = useReduceMotion();
  const shimmer = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduce) return;
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(shimmer, { toValue: 1, duration: 1400, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      Animated.timing(shimmer, { toValue: 0, duration: 1400, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [reduce, shimmer]);
  const line = (width: `${number}%`) => (
    <Animated.View style={[styles.line, { width, opacity: reduce ? 0.3 : shimmer.interpolate({ inputRange: [0, 1], outputRange: [0.12, 0.34] }) }]} />
  );
  return (
    <View accessibilityLabel="Axiom is answering" accessibilityLiveRegion="polite" style={styles.wrap}>
      <View style={styles.row}>
        <Logo size={24} draw />
        {hint && (
          <View style={styles.quote}>
            <Animated.Text style={[styles.quoteText, { opacity: reduce ? 0.6 : shimmer.interpolate({ inputRange: [0, 1], outputRange: [0.42, 0.9] }) }]}>{hint.quote}</Animated.Text>
            <Text style={styles.book}>{hint.book}</Text>
          </View>
        )}
      </View>
      <View style={styles.lines}>{line('92%')}{line('64%')}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 4, marginBottom: 18 },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 11 },
  quote: { flex: 1 },
  quoteText: { fontFamily: fonts.serif, fontSize: 12.5, lineHeight: 18, color: ink(1) },
  book: { fontFamily: fonts.sans, fontSize: 10.5, letterSpacing: 0.6, color: ink(0.45), marginTop: 4 },
  lines: { marginTop: 18, gap: 11 },
  line: { height: 1, backgroundColor: ink(1) },
});
