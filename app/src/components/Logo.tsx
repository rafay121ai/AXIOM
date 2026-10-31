import { useEffect, useId, useRef } from 'react';
import { Animated, Easing, View } from 'react-native';
import Svg, { Defs, G, LinearGradient, Path, Stop } from 'react-native-svg';
import { motion } from '../theme';
import { useReduceMotion } from './useReduceMotion';

const AnimatedPath = Animated.createAnimatedComponent(Path);

// The emblem, from the approved mock. Two strokes that meet at the top.
const LEFT = 'M 8,84 H 28 C 28,55 35,36 50,26 C 55,23 54,18 50,11 C 45,22 40,27 31,33 C 18,43 13,60 13,84';
const RIGHT = 'M 92,84 H 72 C 72,55 65,36 50,26 C 45,23 46,18 50,11 C 55,22 60,27 69,33 C 82,43 87,60 87,84';
const PATH_LENGTH = 190; // measured: 188 viewBox units

type Props = { size: number; draw?: boolean };

export function Logo({ size, draw = false }: Props) {
  const gradId = useId().replace(/:/g, '');
  const reduce = useReduceMotion();
  const t = useRef(new Animated.Value(0)).current;
  const drawing = draw && !reduce;

  useEffect(() => {
    if (!drawing) return;
    const loop = Animated.loop(
      Animated.timing(t, { toValue: 1, duration: motion.drawCycle, easing: Easing.bezier(0.4, 0.1, 0.2, 1), useNativeDriver: false }),
    );
    loop.start();
    return () => loop.stop();
  }, [drawing, t]);

  // The strokes draw in by half the cycle, hold, then fade; the second starts a beat later.
  const offset = (delay: number) =>
    t.interpolate({ inputRange: [0, delay, 0.5 + delay, 1], outputRange: [PATH_LENGTH, PATH_LENGTH, 0, 0] });
  const opacity = t.interpolate({ inputRange: [0, 0.82, 1], outputRange: [1, 1, 0] });

  const stroke = `url(#${gradId})`;
  const common = { fill: 'none', stroke, strokeWidth: 3.5, strokeLinejoin: 'miter' as const };

  return (
    <View accessibilityLabel="Axiom" accessibilityRole="image" style={{ width: size, height: size }}>
      <Svg width={size} height={size} viewBox="0 0 100 100" style={{ overflow: 'visible' }}>
        <Defs>
          <LinearGradient id={gradId} x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor="#F0E8DA" />
            <Stop offset="0.25" stopColor="#F8F0E3" />
            <Stop offset="0.42" stopColor="#B98143" />
            <Stop offset="0.6" stopColor="#E9D8BF" />
            <Stop offset="0.8" stopColor="#642B35" />
            <Stop offset="1" stopColor="#EDE4D6" />
          </LinearGradient>
        </Defs>
        {drawing ? (
          <G>
            <AnimatedPath d={LEFT} {...common} strokeDasharray={[PATH_LENGTH, PATH_LENGTH]} strokeDashoffset={offset(0)} opacity={opacity} />
            <AnimatedPath d={RIGHT} {...common} strokeDasharray={[PATH_LENGTH, PATH_LENGTH]} strokeDashoffset={offset(0.061)} opacity={opacity} />
          </G>
        ) : (
          <G>
            <Path d={LEFT} {...common} />
            <Path d={RIGHT} {...common} />
          </G>
        )}
      </Svg>
    </View>
  );
}
