import { useEffect, useRef, type ReactNode } from 'react';
import { Animated, type StyleProp, type ViewStyle } from 'react-native';
import { useReduceMotion } from './useReduceMotion';

type Props = { children: ReactNode; delay?: number; duration?: number; style?: StyleProp<ViewStyle> };

/** Fades its content in once when it first appears. With reduced motion it is simply there. */
export function Fade({ children, delay = 0, duration = 1000, style }: Props) {
  const reduce = useReduceMotion();
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const run = Animated.timing(v, { toValue: 1, delay: reduce ? 0 : delay, duration: reduce ? 0 : duration, useNativeDriver: true });
    run.start();
    return () => run.stop();
  }, [v, delay, duration, reduce]);
  return <Animated.View style={[style, { opacity: v }]}>{children}</Animated.View>;
}
