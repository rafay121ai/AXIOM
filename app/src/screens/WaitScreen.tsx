import { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { Logo } from '../components/Logo';
import { LINE_EVERY } from '../onboarding/waitLines';
import { type } from '../theme';

type Props = { lines: string[] };

const FADE = 450;

// The wait: the logo drawing itself and four lines written for founders.
// No spinner, no dots, no countdown. The last line stays until the reading is ready.
export function WaitScreen({ lines }: Props) {
  const [n, setN] = useState(0);
  const opacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (n >= lines.length - 1) return;
    const id = setTimeout(() => {
      Animated.timing(opacity, { toValue: 0, duration: FADE, useNativeDriver: true }).start(() => {
        setN(n + 1);
        Animated.timing(opacity, { toValue: 1, duration: FADE, useNativeDriver: true }).start();
      });
    }, LINE_EVERY);
    return () => clearTimeout(id);
  }, [n, lines.length, opacity]);

  return (
    <View style={styles.screen}>
      <Logo size={56} draw />
      <Animated.Text accessibilityLiveRegion="polite" style={[type.waitLine, styles.line, { opacity }]}>
        {lines[n]}
      </Animated.Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40, gap: 36 },
  line: { minHeight: 96 },
});
