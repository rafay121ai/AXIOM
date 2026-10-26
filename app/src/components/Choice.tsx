import { StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { colors, goldGradient, ink, type } from '../theme';
import { Glass } from './Glass';

type Props = { label: string; selected: boolean; onPress: () => void };

function Mark({ selected, square }: { selected: boolean; square: boolean }) {
  return (
    <View style={[styles.ring, square && styles.square, !selected && styles.ringOff]}>
      {selected && <LinearGradient colors={goldGradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill} />}
      {selected && <View style={styles.tick} />}
    </View>
  );
}

/** A full-width glass row. Round mark for one answer, square mark when several can be ticked. */
export function Row({ label, selected, onPress, multi = false }: Props & { multi?: boolean }) {
  return (
    <Glass
      onPress={onPress}
      selected={selected}
      accessibilityRole={multi ? 'checkbox' : 'radio'}
      accessibilityLabel={label}
      style={styles.rowGap}
      contentStyle={styles.row}
    >
      <Text style={[type.option, styles.rowText, { color: selected ? colors.inkBright : ink(0.78) }]}>{label}</Text>
      <Mark selected={selected} square={multi} />
    </Glass>
  );
}

/** A small rounded glass chip. */
export function Chip({ label, selected, onPress }: Props) {
  return (
    <Glass
      onPress={onPress}
      selected={selected}
      radius={99}
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      contentStyle={styles.chip}
    >
      <Text style={[type.chip, { color: selected ? colors.inkBright : ink(0.78) }]}>{label}</Text>
    </Glass>
  );
}

const styles = StyleSheet.create({
  rowGap: { marginBottom: 10 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 14, paddingVertical: 16, paddingHorizontal: 18, minHeight: 56 },
  rowText: { flex: 1 },
  chip: { paddingVertical: 12, paddingHorizontal: 16, minHeight: 44, justifyContent: 'center' },
  ring: { width: 19, height: 19, borderRadius: 10, overflow: 'hidden', borderWidth: 1, borderColor: 'transparent' },
  ringOff: { borderColor: ink(0.35) },
  square: { borderRadius: 6 },
  tick: { position: 'absolute', left: 6.5, top: 3, width: 4, height: 8, borderColor: colors.onGold, borderRightWidth: 1.5, borderBottomWidth: 1.5, transform: [{ rotate: '45deg' }] },
});
