import { useRef } from 'react';
import { Animated } from 'react-native';

/**
 * The lift shared by glass and the gold button: pressing (or hovering with a
 * mouse) raises the piece a few pixels, letting go settles it back.
 */
export function useLift(rise: number, grow: number) {
  const v = useRef(new Animated.Value(0)).current;
  const hovered = useRef(false);
  const to = (value: number) =>
    Animated.spring(v, { toValue: value, useNativeDriver: true, speed: 30, bounciness: 6 }).start();
  return {
    style: {
      transform: [
        { translateY: v.interpolate({ inputRange: [0, 1], outputRange: [0, -rise] }) },
        { scale: v.interpolate({ inputRange: [0, 1], outputRange: [1, 1 + grow] }) },
      ],
    },
    handlers: {
      onHoverIn: () => { hovered.current = true; to(1); },
      onHoverOut: () => { hovered.current = false; to(0); },
      onPressIn: () => to(1),
      onPressOut: () => to(hovered.current ? 1 : 0),
    },
  };
}
