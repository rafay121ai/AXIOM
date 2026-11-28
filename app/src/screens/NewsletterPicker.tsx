import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Newsletter } from '../api/types';
import { Fade } from '../components/Fade';
import { GoldButton } from '../components/GoldButton';
import { LoadingHint } from '../components/LoadingHint';
import { NewsletterRows } from '../components/NewsletterRows';
import { TextAction } from '../components/TextAction';
import { Wash } from '../components/Wash';
import { copy } from '../copy';
import { connectLine, type ConnectorsApi } from '../connect/flow';
import { fonts, ink, space } from '../theme';

type Props = { api: ConnectorsApi; list: Newsletter[] | null; onDone: () => void };

// Shown once, right after Gmail connects. `list` is null while Axiom is still counting. Nothing is ticked for the founder.
export function NewsletterPicker({ api, list, onDone }: Props) {
  const insets = useSafeAreaInsets();
  const [ticked, setTicked] = useState<string[]>([]);
  const [line, setLine] = useState<string | null>(null);
  if (!list) {
    return (
      <View style={styles.wait}>
        <Wash />
        <Text accessibilityRole="header" style={styles.looking}>{copy.newsletters.looking}</Text>
        <View style={styles.hint}><LoadingHint /></View>
      </View>
    );
  }
  const toggle = (id: string) => setTicked((t) => (t.includes(id) ? t.filter((x) => x !== id) : [...t, id]));
  const watch = async () => {
    try {
      await api.setNewsletters(ticked);
      onDone();
    } catch (e) {
      setLine(connectLine(e));
    }
  };
  return (
    <View style={styles.screen}>
      <Wash />
      <ScrollView contentContainerStyle={[styles.body, { paddingTop: insets.top + 92, paddingBottom: Math.max(insets.bottom, 12) + 34 }]}>
        <Fade delay={150}><Text accessibilityRole="header" style={styles.lead}>{copy.newsletters.lead}</Text></Fade>
        <Fade delay={400}><Text style={styles.lead2}>{copy.newsletters.lead2}</Text></Fade>
        <View style={styles.rows}><NewsletterRows items={list.map((n) => ({ ...n, watching: ticked.includes(n.id) }))} onToggle={toggle} delay={600} /></View>
        {line && <Text accessibilityLiveRegion="polite" style={styles.line}>{line}</Text>}
        <Fade delay={900} style={styles.foot}>
          <GoldButton label={copy.newsletters.watch} disabled={!ticked.length} onPress={() => void watch()} />
          <TextAction label={copy.newsletters.notNow} size={14} onPress={onDone} />
        </Fade>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  wait: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40, paddingBottom: 80 },
  looking: { fontFamily: fonts.serif, fontSize: 21, lineHeight: 30, color: ink(0.85), textAlign: 'center', marginBottom: 22 },
  hint: { width: 160 },
  body: { flexGrow: 1, paddingHorizontal: space.screenX },
  lead: { fontFamily: fonts.serif, fontSize: 27, lineHeight: 34.5, color: '#f4f4f2' },
  lead2: { fontFamily: fonts.serif, fontSize: 18.5, lineHeight: 27.75, color: ink(0.72), marginTop: 14 },
  rows: { marginTop: 28 },
  line: { fontFamily: fonts.sans, fontSize: 13, lineHeight: 19, color: ink(0.6), marginTop: 14 },
  foot: { alignItems: 'stretch', marginTop: 18, gap: 4 },
});
