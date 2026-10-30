import { Pressable, StyleSheet, Text, View } from 'react-native';
import { fonts, goldGradient, ink } from '../theme';

type Props<T extends string> = { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void };

/** Words with a thin gold line under the chosen one (mentor style, lock screen). */
export function WordChoice<T extends string>({ options, value, onChange }: Props<T>) {
  return (
    <View style={styles.row}>
      {options.map((o) => (
        <Pressable key={o.value} accessibilityRole="radio" accessibilityState={{ selected: o.value === value }} onPress={() => onChange(o.value)} style={styles.word}>
          <Text style={[styles.text, o.value === value && { color: '#f4f4f2' }]}>{o.label}</Text>
          <View style={[styles.line, o.value === value && { backgroundColor: goldGradient[0] }]} />
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 22, paddingBottom: 6 },
  word: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 1 },
  text: { fontFamily: fonts.sans, fontSize: 15, color: ink(0.5), paddingTop: 4 },
  line: { height: 1.5, marginTop: 6, backgroundColor: 'transparent' },
});
