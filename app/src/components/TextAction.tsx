import { Pressable, StyleSheet, Text, View } from 'react-native';
import { fonts, ink } from '../theme';

type Props = { label: string; onPress: () => void; size?: number };

/** A plain text action with a thin underline on hover and press ("Try again", "Skip this question"). No pill. */
export function TextAction({ label, onPress, size = 13 }: Props) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={styles.target}>
      {({ hovered, pressed }: { hovered?: boolean; pressed: boolean }) => (
        <View style={[styles.line, (hovered || pressed) && styles.active]}>
          <Text style={[styles.text, { fontSize: size }]}>{label}</Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  target: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 8 },
  line: { paddingVertical: 2, borderBottomWidth: 1, borderBottomColor: 'transparent' },
  active: { borderBottomColor: ink(0.4) },
  text: { fontFamily: fonts.sans, letterSpacing: 0.13, color: ink(0.5) },
});
