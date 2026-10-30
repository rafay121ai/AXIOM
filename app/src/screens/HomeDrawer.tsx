import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GoldDot } from '../components/GoldDot';
import { Logo } from '../components/Logo';
import { Wash } from '../components/Wash';
import { copy } from '../copy';
import type { MenuRow, MenuRows } from '../home/flow';
import { colors, fonts, ink } from '../theme';

type Props = {
  rows: MenuRows;
  onStartNew: () => void;
  onRow: (row: MenuRow) => void;
};

function Row({ row, onPress }: { row: MenuRow; onPress: (row: MenuRow) => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={() => onPress(row)} style={styles.row}>
      {({ hovered }: { hovered?: boolean; pressed: boolean }) => (
        <>
          {row.dot && <GoldDot />}
          <Text style={[styles.rowText, hovered && { color: '#fff' }]}>{row.label}</Text>
        </>
      )}
    </Pressable>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.label}>{label}</Text>
      {children}
    </View>
  );
}

// The menu: it slides in from the left and pushes the home aside. Sections divided by thin lines, no day headings.
export function HomeDrawer({ rows, onStartNew, onRow }: Props) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.drawer, { paddingTop: insets.top + 54 }]}>
      <Wash corner />
      <View style={styles.top}><View style={styles.emblem}><Logo size={28} glow={false} /></View></View>
      <Pressable accessibilityRole="button" onPress={onStartNew} style={styles.startNew}>
        <View style={styles.plus}><Text style={styles.plusMark}>+</Text></View>
        <Text style={styles.startText}>{copy.home.startNew}</Text>
      </Pressable>
      <ScrollView showsVerticalScrollIndicator={false} style={styles.scroll}>
        <Section label={copy.home.open}>
          {rows.open.length === 0
            ? <Text style={styles.none}>{copy.home.nothingToDo}</Text>
            : rows.open.map((r) => <Row key={r.key} row={r} onPress={onRow} />)}
        </Section>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  drawer: { ...StyleSheet.absoluteFill, right: undefined, width: '84%', backgroundColor: '#070707' },
  top: { paddingHorizontal: 22, paddingTop: 4, paddingBottom: 14 },
  emblem: { opacity: 0.9 },
  startNew: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52, marginHorizontal: 14, marginBottom: 14, paddingHorizontal: 12, borderRadius: 12 },
  plus: { width: 28, height: 28, borderRadius: 14, borderWidth: 1, borderColor: ink(0.35), alignItems: 'center', justifyContent: 'center' },
  plusMark: { fontFamily: fonts.sans, fontSize: 18, lineHeight: 20, color: ink(0.85) },
  startText: { fontFamily: fonts.sans, fontSize: 15.5, color: colors.ink },
  scroll: { flex: 1, borderTopWidth: 1, borderTopColor: ink(0.14) },
  section: { paddingTop: 16, paddingHorizontal: 22, paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: ink(0.14) },
  label: { fontFamily: fonts.sans, fontSize: 10, letterSpacing: 2, textTransform: 'uppercase', color: ink(0.45), marginBottom: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 11, minHeight: 44, paddingVertical: 9 },
  rowText: { flex: 1, fontFamily: fonts.sans, fontSize: 15, lineHeight: 20, color: ink(0.85) },
  none: { fontFamily: fonts.sans, fontSize: 14, color: ink(0.5), paddingVertical: 9 },
});
