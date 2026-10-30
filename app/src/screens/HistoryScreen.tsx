import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { sendUntilDelivered } from '../api/delivery';
import type { HistoryRow } from '../api/types';
import { GoldDot } from '../components/GoldDot';
import { PageHeader } from '../components/PageHeader';
import { TextAction } from '../components/TextAction';
import { Wash } from '../components/Wash';
import { copy, failureLine } from '../copy';
import { colors, fonts, gold, ink } from '../theme';

type Props = {
  load: (q: string) => Promise<HistoryRow[]>;
  onOpen: (id: string) => void;
  onBack: () => void;
};

const TYPING_MS = 300;

// History: a plain list of past situations, newest first, thin lines between, no day headings. One quiet status word on each.
export function HistoryScreen({ load, onOpen, onBack }: Props) {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<HistoryRow[] | null>(null);
  const [failure, setFailure] = useState<{ text: string; canRetry: boolean } | null>(null);
  const live = useRef(true);
  const latest = useRef(load);
  latest.current = load;
  const [again, setAgain] = useState(0);
  useEffect(() => () => { live.current = false; }, []);

  // The search waits for a pause in typing, and an older answer never replaces a newer one.
  useEffect(() => {
    let current = true;
    const timer = setTimeout(async () => {
      try {
        const found = await sendUntilDelivered(() => latest.current(q.trim()), { cancelled: () => !live.current || !current });
        if (current && live.current) { setRows(found); setFailure(null); }
      } catch (e) {
        if (current && live.current) setFailure(failureLine(e, 'read'));
      }
    }, rows === null ? 0 : TYPING_MS);
    return () => { current = false; clearTimeout(timer); };
  }, [q, again]);

  return (
    <View style={styles.screen}>
      <Wash />
      <PageHeader title={copy.history.title} onBack={onBack} />
      <View style={styles.search}>
        <Svg width={18} height={18} viewBox="0 0 24 24">
          <Circle cx={11} cy={11} r={6.5} stroke={ink(0.55)} strokeWidth={1.6} fill="none" />
          <Path d="M16 16l4.5 4.5" stroke={ink(0.55)} strokeWidth={1.6} strokeLinecap="round" />
        </Svg>
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder={copy.history.search}
          placeholderTextColor={ink(0.35)}
          selectionColor={gold(1)}
          accessibilityLabel={copy.history.search}
          autoCorrect={false}
          style={styles.input}
        />
      </View>
      <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={styles.list}>
        {failure && (
          <View>
            <Text style={styles.none}>{failure.text}</Text>
            {failure.canRetry && <TextAction label={copy.tryAgain} size={15} onPress={() => setAgain((n) => n + 1)} />}
          </View>
        )}
        {rows?.map((r) => (
          <Pressable key={r.id} accessibilityRole="button" onPress={() => onOpen(r.id)} style={styles.row}>
            <Text style={styles.title}>{r.title ?? copy.home.untitled}</Text>
            <View style={styles.tag}>
              {r.status === 'open' && <GoldDot />}
              <Text style={[styles.tagText, r.status === 'open' && { color: ink(0.9) }]}>{r.status_label}</Text>
            </View>
            <Text style={styles.chev}>›</Text>
          </Pressable>
        ))}
        {rows && rows.length === 0 && q.trim() !== '' && <Text style={styles.none}>{copy.history.none}</Text>}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.base },
  search: { flexDirection: 'row', alignItems: 'center', gap: 10, marginHorizontal: 20, marginBottom: 12, paddingVertical: 8, paddingHorizontal: 2, borderBottomWidth: 1, borderBottomColor: ink(0.22) },
  input: { flex: 1, fontFamily: fonts.sans, fontSize: 15.5, color: colors.ink, minHeight: 28, outlineStyle: 'none' } as object,
  list: { paddingHorizontal: 24, paddingBottom: 60 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52, paddingVertical: 13, borderTopWidth: 1, borderTopColor: ink(0.1) },
  title: { flex: 1, fontFamily: fonts.sans, fontSize: 15.5, lineHeight: 21, color: ink(0.92) },
  tag: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  tagText: { fontFamily: fonts.sans, fontSize: 12, color: ink(0.5) },
  chev: { fontSize: 19, color: ink(0.35) },
  none: { fontFamily: fonts.sans, fontSize: 14.5, color: ink(0.5), paddingVertical: 30 },
});
