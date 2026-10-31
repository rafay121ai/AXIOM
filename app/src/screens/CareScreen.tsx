import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { CareHelp } from '../api/types';
import { careParagraphs } from '../care/route';
import { Logo } from '../components/Logo';
import { colors, fonts, ink, type } from '../theme';

type Props = { message: string; help: CareHelp; onKeepTalking: () => void };

// Calm on purpose: no glow, no animation, nothing that pushes the founder anywhere.
// The words and the help link come from the server; the app holds none.
export function CareScreen({ message, help, onKeepTalking }: Props) {
  const insets = useSafeAreaInsets();
  const { heading, body } = careParagraphs(message);
  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[styles.body, { paddingTop: 64 + insets.top, paddingBottom: 40 + insets.bottom }]}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.logo}><Logo size={26} /></View>
      <Text accessibilityRole="header" style={[type.careHead, styles.heading]}>{heading}</Text>
      {/* As in the mock: the help block follows the third paragraph (the heading is the first). */}
      {body.slice(0, 2).map((p) => <Text key={p} style={[type.care, styles.p]}>{p}</Text>)}
      <View style={styles.help}>
        <Pressable accessibilityRole="link" onPress={() => void WebBrowser.openBrowserAsync(help.url)} style={styles.row}>
          <Text style={styles.value}>{help.line}</Text>
        </Pressable>
      </View>
      {body.slice(2).map((p) => <Text key={p} style={[type.care, styles.p]}>{p}</Text>)}
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
  value: { fontFamily: fonts.sans, fontSize: 15.5, color: colors.body },
  keep: { alignSelf: 'flex-start', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: ink(0.4) },
  keepText: { fontFamily: fonts.sans, fontSize: 15, color: ink(0.8) },
});
