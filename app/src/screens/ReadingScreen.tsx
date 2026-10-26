import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { FirstReading } from '../api/types';
import { GoldButton } from '../components/GoldButton';
import { Logo } from '../components/Logo';
import { useReduceMotion } from '../components/useReduceMotion';
import { readingSentences } from '../onboarding/reading';
import { gold, space, type } from '../theme';

type Props = { reading: FirstReading; onContinue: () => void };

const FIRST = 500;
const STEP = 1500;
const FADE = 1000;

// The first reading: the finding, then the sentences one by one like someone speaking.
// No rating and no reply box. Continue is the only way on, and it appears once everything is read.
export function ReadingScreen({ reading, onContinue }: Props) {
  const insets = useSafeAreaInsets();
  const reduce = useReduceMotion();
  const sentences = useMemo(() => readingSentences(reading), [reading]);
  const count = sentences.length + 1; // the headline comes first
  const fades = useMemo(() => Array.from({ length: count }, () => new Animated.Value(0)), [count]);
  const bar = useRef(new Animated.Value(0)).current;
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const show = (v: Animated.Value, delay: number, duration: number) =>
      Animated.timing(v, { toValue: 1, delay: reduce ? 0 : delay, duration: reduce ? 0 : duration, useNativeDriver: true });
    const run = Animated.parallel([
      ...fades.map((v, n) => show(v, FIRST + n * STEP, FADE)),
      show(bar, FIRST + count * STEP + 300, 600),
    ]);
    run.start(({ finished }) => finished && setReady(true));
    return () => run.stop();
  }, [fades, bar, count, reduce]);

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={[styles.content, { paddingTop: insets.top + 66, paddingBottom: insets.bottom + 140 }]}>
        <View style={styles.emblem}><Logo size={30} /></View>
        <Animated.Text style={[type.readingHead, styles.head, { opacity: fades[0] }]}>{reading.headline}</Animated.Text>
        {sentences.map((segments, n) => (
          <Animated.Text key={n} style={[type.reading, styles.para, { opacity: fades[n + 1] }]}>
            {segments.map((g, i) => (g.underline ? <Text key={i} style={styles.underline}>{g.text}</Text> : g.text))}
          </Animated.Text>
        ))}
      </ScrollView>
      <Animated.View
        pointerEvents={ready ? 'auto' : 'none'}
        style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 12) + 20, opacity: bar, transform: [{ translateY: bar.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }] }]}
      >
        <GoldButton label="Continue" onPress={onContinue} />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingHorizontal: 28 },
  emblem: { marginBottom: 22, opacity: 0.9 },
  head: { marginBottom: 18 },
  para: { marginBottom: 13 },
  underline: { textDecorationLine: 'underline', textDecorationColor: gold(1) },
  bar: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingTop: 14, paddingHorizontal: space.screenX },
});
