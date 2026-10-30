import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import type { HomeItem } from '../api/types';
import { colors, fonts, ink } from '../theme';
import { GoldDot } from './GoldDot';
import { useReduceMotion } from './useReduceMotion';

const FADE_MS = 1200;
const TYPING_MS = 250;

type Props = {
  items: HomeItem[];
  /** Milliseconds before the items that do not stay fade away. */
  fadeAfterMs: number;
  /** The founder started typing: everything clears at once. */
  cleared: boolean;
  onOpen: (item: HomeItem) => void;
};

// The small items above the bar: a gold dot and plain words for what is still left to do. Those that do not stay fade
// after `fadeAfterMs`; touching or hovering keeps them, and they fade again once the finger or mouse leaves.
export function LeftOff({ items, fadeAfterMs, cleared, onOpen }: Props) {
  const reduce = useReduceMotion();
  const fading = items.filter((i) => !i.stays);
  const fade = useRef(new Animated.Value(1)).current;
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [faded, setFaded] = useState(false);

  const schedule = useCallback(() => {
    clearTimeout(timer.current);
    if (fading.length === 0) return;
    timer.current = setTimeout(() => {
      Animated.timing(fade, { toValue: 0, duration: reduce ? 0 : FADE_MS, useNativeDriver: true }).start(({ finished }) => finished && setFaded(true));
    }, fadeAfterMs);
  }, [fading.length, fadeAfterMs, fade, reduce]);

  useEffect(() => {
    schedule();
    return () => clearTimeout(timer.current);
  }, [schedule]);

  const hold = () => {
    clearTimeout(timer.current);
    if (faded) return;
    fade.stopAnimation();
    fade.setValue(1);
  };

  const clear = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    Animated.timing(clear, { toValue: cleared ? 0 : 1, duration: reduce ? 0 : TYPING_MS, useNativeDriver: true }).start();
  }, [cleared, clear, reduce]);

  const row = (item: HomeItem, n: number, opacity?: Animated.Value) => (
    <Animated.View key={`${item.kind}-${n}`} style={opacity ? { opacity } : undefined} pointerEvents={cleared || (opacity && faded) ? 'none' : 'auto'}>
      <Pressable
        accessibilityRole="button"
        onPress={() => onOpen(item)}
        onPressIn={opacity ? hold : undefined}
        onHoverIn={opacity ? hold : undefined}
        onPressOut={opacity ? schedule : undefined}
        onHoverOut={opacity ? schedule : undefined}
        style={styles.item}
      >
        {({ hovered }: { hovered?: boolean; pressed: boolean }) => (
          <>
            <GoldDot />
            <Text style={[styles.text, hovered && { color: colors.ink }]}>{item.label}</Text>
          </>
        )}
      </Pressable>
    </Animated.View>
  );

  return (
    <Animated.View style={[styles.wrap, { opacity: clear }]}>
      {items.map((item, n) => row(item, n, item.stays ? undefined : fade))}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 20, rowGap: 0, marginHorizontal: 8, marginBottom: 8 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 9, minHeight: 44 },
  text: { fontFamily: fonts.sans, fontSize: 13.5, color: ink(0.82) },
});
