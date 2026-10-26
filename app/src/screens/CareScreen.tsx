import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { HelpLine } from '../api/types';
import { careParagraphs } from '../care/route';
import { Logo } from '../components/Logo';
import { colors, fonts, ink, type } from '../theme';

type Props = { message: string; help: HelpLine[]; onKeepTalking: () => void };

// Calm on purpose: no glow, no animation, nothing that pushes the founder anywhere.
// The words and numbers come from the server; the app holds none.
export function CareScreen({ message, help, onKeepTalking }: Props) {
  const insets = useSafeAreaInsets();
  const { heading, body } = careParagraphs(message);
  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[styles.body, { paddingTop: 64 + insets.top, paddingBottom: 40 + insets.bottom }]}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.logo}><Logo size={26} glow={false} /></View>
      <Text accessibilityRole="header" style={[type.careHead, styles.heading]}>{heading}</Text>
      {body.map((p) => <Text key={p} style={[type.care, styles.p]}>{p}</Text>)}
      <View style={styles.help}>
        {help.map((h) => (
          <View key={h.label} style={styles.row}>
            <Text style={styles.key}>{h.label}</Text>
            <Text selectable style={styles.value}>{h.value}</Text>
          </View>
        ))}
      </View>
      <Pressable accessibilityRole="button" onPress={onKeepTalking} style={styles.keep}>
        <Text style={styles.keepText}>Keep talking</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.base },
  body: { paddingHorizontal: 30 },
  logo: { marginBottom: 30, opacity: 0.8 },
  heading: { marginBottom: 18 },
  p: { marginBottom: 16 },
  help: { marginTop: 6, marginBottom: 24, borderTopWidth: 1, borderTopColor: ink(0.16) },
  row: { paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: ink(0.16) },
  key: { fontFamily: fonts.sans, fontSize: 12, letterSpacing: 0.7, color: ink(0.55), marginBottom: 6 },
  value: { fontFamily: fonts.sans, fontSize: 15.5, color: colors.body },
  keep: { alignSelf: 'flex-start', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: ink(0.4) },
  keepText: { fontFamily: fonts.sans, fontSize: 15, color: ink(0.8) },
});
