import { ScrollView, StyleSheet, Text, View } from 'react-native';
import type { Newsletter } from '../api/types';
import { NewsletterRows } from '../components/NewsletterRows';
import { PageHeader } from '../components/PageHeader';
import { Wash } from '../components/Wash';
import { copy } from '../copy';
import { colors, fonts, ink } from '../theme';

type Props = { list: Newsletter[]; line: string | null; onToggle: (id: string) => void; onBack: () => void };

// Settings, Connections, Gmail, Newsletters: the watched ones first, the rest below so one can be added.
export function NewslettersPage({ list, line, onToggle, onBack }: Props) {
  const watched = list.filter((n) => n.watching);
  const rest = list.filter((n) => !n.watching);
  return (
    <View style={styles.screen}>
      <Wash />
      <PageHeader title={copy.newsletters.action} onBack={onBack} />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.body}>
        <Text style={styles.note}>{copy.newsletters.note}</Text>
        {watched.length > 0 && <Text style={styles.label}>{copy.newsletters.watching}</Text>}
        <NewsletterRows items={watched} onToggle={onToggle} />
        {rest.length > 0 && <View style={watched.length > 0 && styles.gap}><NewsletterRows items={rest} onToggle={onToggle} /></View>}
        {line && <Text accessibilityLiveRegion="polite" style={styles.note}>{line}</Text>}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.base },
  body: { paddingHorizontal: 24, paddingBottom: 60 },
  note: { fontFamily: fonts.sans, fontSize: 13, lineHeight: 19.5, color: ink(0.5), marginTop: 6, marginBottom: 12 },
  label: { fontFamily: fonts.sans, fontSize: 10, letterSpacing: 2, textTransform: 'uppercase', color: ink(0.45), marginTop: 6, marginBottom: 6 },
  gap: { marginTop: 18 },
});
