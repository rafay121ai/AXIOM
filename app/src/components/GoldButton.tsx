import { Animated, Pressable, StyleSheet, Text } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { colors, goldGradient, ink, type } from '../theme';
import { useLift } from './useLift';

type Props = { label: string; onPress: () => void; disabled?: boolean };

// Continue: a gold gradient with a soft bevel. When it cannot be pressed yet it is an outline.
export function GoldButton({ label, onPress, disabled = false }: Props) {
  const lift = useLift(3, 0);
  return (
    <Animated.View style={[disabled ? styles.flat : styles.raised, lift.style]}>
      <Pressable
        onPress={onPress}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityState={{ disabled }}
        {...lift.handlers}
        style={[styles.button, disabled && styles.off]}
      >
        {!disabled && (
          <>
            <LinearGradient colors={goldGradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill} />
            <LinearGradient
              pointerEvents="none"
              colors={['rgba(255,255,255,0.38)', 'rgba(255,255,255,0)', 'rgba(60,40,10,0.28)']}
              locations={[0, 0.48, 1]}
              style={StyleSheet.absoluteFill}
            />
          </>
        )}
        <Text style={[type.button, styles.label, { color: disabled ? ink(0.3) : colors.onGold }]}>{label}</Text>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  raised: { borderRadius: 14, backgroundColor: colors.goldTo, shadowColor: 'rgb(205,178,126)', shadowOffset: { width: 0, height: 14 }, shadowOpacity: 0.4, shadowRadius: 18, elevation: 8 },
  flat: { borderRadius: 14 },
  button: { borderRadius: 14, overflow: 'hidden', paddingVertical: 16, alignItems: 'center', borderWidth: 1, borderColor: 'transparent' },
  off: { borderColor: ink(0.18) },
  label: { fontWeight: '500', letterSpacing: 0.15 },
});
