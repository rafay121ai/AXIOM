import type { ReactNode } from 'react';
import { Animated, Platform, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { glass, gold, ink } from '../theme';
import { useLift } from './useLift';

type Props = {
  children: ReactNode;
  onPress: () => void;
  radius?: number;
  selected?: boolean;
  /** Spoken label and role; the visible text is read otherwise. */
  accessibilityRole?: 'button' | 'checkbox' | 'radio';
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
};

/** The layers of frosted glass: blur, a faint tint, a soft sheen and a bright top edge. Fills its parent. */
export function GlassFill({ tint = ink(glass.tint) }: { tint?: string }) {
  return (
    <>
      <BlurView intensity={glass.blurIntensity} tint="dark" style={StyleSheet.absoluteFill} />
      <View style={[StyleSheet.absoluteFill, { backgroundColor: tint }]} />
      <LinearGradient
        pointerEvents="none"
        colors={['rgba(255,255,255,0.13)', 'rgba(255,255,255,0.03)', 'rgba(0,0,0,0.18)']}
        locations={[0, 0.42, 1]}
        style={StyleSheet.absoluteFill}
      />
      <View pointerEvents="none" style={styles.topEdge} />
    </>
  );
}

// Frosted glass with depth: a lit top edge, a darker underside, a soft shadow.
// It lifts when pressed (and on hover with a mouse).
export function Glass({
  children, onPress, radius = 16, selected = false, accessibilityRole = 'button', accessibilityLabel, style, contentStyle,
}: Props) {
  const lift = useLift(4, 0.012);
  const edge = selected ? gold(0.65) : ink(glass.edge);
  return (
    <Animated.View style={[styles.shadow, { borderRadius: radius }, lift.style, style]}>
      <Pressable
        onPress={onPress}
        accessibilityRole={accessibilityRole}
        accessibilityLabel={accessibilityLabel}
        accessibilityState={{ selected, checked: selected }}
        {...lift.handlers}
      >
        <View style={{ borderRadius: radius, borderWidth: 1, borderColor: edge, overflow: 'hidden' }}>
          <GlassFill tint={selected ? gold(0.12) : ink(glass.tint)} />
          <View style={contentStyle}>{children}</View>
        </View>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  shadow: Platform.select<ViewStyle>({
    android: { elevation: 8 },
    default: { shadowColor: '#000', shadowOffset: { width: 0, height: 12 }, shadowOpacity: 0.6, shadowRadius: 16 },
  }) as ViewStyle,
  topEdge: { position: 'absolute', top: 0, left: 8, right: 8, height: 1.5, backgroundColor: 'rgba(255,255,255,0.28)' },
});
