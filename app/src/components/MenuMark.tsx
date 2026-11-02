import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useRef } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { copy } from '../copy';
import { colors, ink, type } from '../theme';
import { Logo } from './Logo';
import { useReduceMotion } from './useReduceMotion';

export type Step = keyof typeof copy.steps;

// The menu button everywhere: the emblem as a thin line (Rafay, Nov 2). On home it opens the menu; on Situation,
// Read and Learn it goes home with the menu open, and the situation stays open.
export function MenuMark({ onPress }: { onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={copy.home.menu} onPress={onPress} hitSlop={10} style={styles.mark}>
      <Logo size={26} line />
    </Pressable>
  );
}

// Situation, Read and Learn: the button pinned top left with the step's name, over a fade so scrolling text
// dissolves under it. Screens start their text at insets.top + MENU_BAR so nothing sits under the fade at rest.
export const MENU_BAR = 140;
export function MenuBar({ onPress, step }: { onPress: () => void; step: Step }) {
  const insets = useSafeAreaInsets();
  return (
    <>
      <View pointerEvents="box-none" style={[styles.bar, { height: insets.top + 140 }]}>
        <LinearGradient pointerEvents="none" colors={[colors.base, colors.base, 'rgba(5,5,5,0)']} locations={[0, 0.72, 1]} style={StyleSheet.absoluteFill} />
        <View pointerEvents="box-none" style={[styles.place, { top: insets.top + 54 }]}>
          <MenuMark onPress={onPress} />
          <Text style={styles.step}>{copy.steps[step]}</Text>
        </View>
      </View>
      <StepTitle step={step} />
    </>
  );
}

// The moment a step begins: the screen holds on black while its name comes up and goes, then the step shows.
// About 1.3 seconds; none with reduce motion.
const IN = 350, HOLD = 500, OUT = 450;
function StepTitle({ step }: { step: Step }) {
  const reduce = useReduceMotion();
  const word = useRef(new Animated.Value(0)).current;
  const veil = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (reduce) return;
    const ease = Easing.bezier(0.2, 0.7, 0.2, 1);
    Animated.sequence([
      Animated.timing(word, { toValue: 1, duration: IN, easing: ease, useNativeDriver: true }),
      Animated.delay(HOLD),
      Animated.parallel([
        Animated.timing(word, { toValue: 2, duration: OUT, easing: ease, useNativeDriver: true }),
        Animated.timing(veil, { toValue: 0, duration: OUT, easing: ease, useNativeDriver: true }),
      ]),
    ]).start();
  }, [reduce, word, veil]);
  if (reduce) return null;
  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.veil, { opacity: veil }]}>
      <Animated.Text
        style={[styles.title, {
          opacity: word.interpolate({ inputRange: [0, 1, 2], outputRange: [0, 1, 0] }),
          transform: [{ scale: word.interpolate({ inputRange: [0, 1, 2], outputRange: [0.97, 1, 1.03] }) }],
        }]}
      >
        {copy.steps[step]}
      </Animated.Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  mark: { width: 44, height: 44, marginLeft: -9, alignItems: 'center', justifyContent: 'center' },
  bar: { position: 'absolute', top: 0, left: 0, right: 0 },
  place: { position: 'absolute', left: 18, flexDirection: 'row', alignItems: 'center' },
  step: { ...type.label, color: ink(0.5), marginLeft: 2 },
  veil: { backgroundColor: colors.base, alignItems: 'center', justifyContent: 'center' },
  title: { ...type.label, fontSize: 13, letterSpacing: 6, color: ink(0.85), marginRight: -6 },
});
