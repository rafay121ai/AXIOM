import { Pressable, StyleSheet, View } from 'react-native';
import { colors, ink } from '../theme';

/** A small quiet switch, gold when on. */
export function Switch({ on, onChange, label }: { on: boolean; onChange: (next: boolean) => void; label: string }) {
  return (
    <Pressable accessibilityRole="switch" accessibilityLabel={label} accessibilityState={{ checked: on }} onPress={() => onChange(!on)} hitSlop={12}>
      <View style={[styles.track, on && styles.on]}>
        <View style={[styles.knob, on && styles.knobOn]} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  track: { width: 38, height: 22, borderRadius: 11, borderWidth: 1, borderColor: ink(0.35), justifyContent: 'center' },
  on: { backgroundColor: colors.goldFrom, borderColor: 'transparent' },
  knob: { width: 14, height: 14, borderRadius: 7, marginLeft: 3, backgroundColor: ink(0.7) },
  knobOn: { marginLeft: 20, backgroundColor: colors.onGold },
});
