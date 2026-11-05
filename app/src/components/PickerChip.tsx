import { Pressable, StyleSheet, Text } from 'react-native';
import { fonts, ink } from '../theme';

/** Android has no inline compact picker: the value as a chip that opens the system dialog, like the iOS one looks. */
export function PickerChip({ text, onPress }: { text: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={text} onPress={onPress} style={styles.chip}>
      <Text style={styles.text}>{text}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 14, borderRadius: 10, backgroundColor: ink(0.08), alignSelf: 'flex-start' },
  text: { fontFamily: fonts.sans, fontSize: 15, color: ink(0.9) },
});
