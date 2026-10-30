import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { sendUntilDelivered } from '../api/delivery';
import type { HistoryPage, Target } from '../api/types';
import { Fade } from '../components/Fade';
import { LoadingHint } from '../components/LoadingHint';
import { PageHeader } from '../components/PageHeader';
import { TextAction } from '../components/TextAction';
import { Wash } from '../components/Wash';
import { copy, failureLine } from '../copy';
import { colors, fonts, gold, ink } from '../theme';

type Props = {
  load: () => Promise<HistoryPage>;
  /** Takes this check-in's share down; resolves with the server's line. */
  withdraw: (reportId: string) => Promise<string>;
  /** The one action: pick it up, bring it back, or talk about it again. A rejection means it could not be opened. */
  onAction: (target: Target) => Promise<void>;
  onBack: () => void;
};

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.label}>{label}</Text>
      {children}
    </View>
  );
}

// A past situation, read only, divided by thin lines. No delete here: stored situations are the memory.
export function PastScreen({ load, withdraw, onAction, onBack }: Props) {
  const [page, setPage] = useState<HistoryPage | null>(null);
  const [failure, setFailure] = useState<{ text: string; canRetry: boolean } | null>(null);
  const [notOpened, setNotOpened] = useState<string | null>(null);
  const [takenDown, setTakenDown] = useState<string | null>(null);
  const live = useRef(true);
  const latest = useRef(load);
  latest.current = load;
  useEffect(() => () => { live.current = false; }, []);

  const fetchPage = useCallback(async () => {
    setFailure(null);
    try {
      const p = await sendUntilDelivered(() => latest.current(), { cancelled: () => !live.current });
      if (live.current) setPage(p);
    } catch (e) {
      if (live.current) setFailure(failureLine(e, 'read'));
    }
  }, []);
  useEffect(() => { void fetchPage(); }, [fetchPage]);

  const read = page?.what_i_read;
  const how = page?.how_it_went;
  return (
    <View style={styles.screen}>
      <Wash />
      <PageHeader onBack={onBack} />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.body}>
        {!page && !failure && <View style={styles.pad}><LoadingHint /></View>}
        {failure && (
          <View style={styles.pad}>
            <Text style={styles.plain}>{failure.text}</Text>
            {failure.canRetry && <TextAction label={copy.tryAgain} size={15} onPress={() => void fetchPage()} />}
          </View>
        )}
        {page && (
          <Fade>
            <Text accessibilityRole="header" style={styles.heading}>{page.title ?? copy.home.untitled}</Text>
            {read && (
              <Section label={copy.history.read}>
                <Text style={styles.serif}>{read.headline}</Text>
                {read.body !== '' && <Text style={[styles.plain, styles.second]}>{read.body}</Text>}
              </Section>
            )}
            {page.what_you_learned && (
              <Section label={copy.history.learned}>
                {page.what_you_learned.sources.map((s) => <Text key={`${s.author}|${s.book}`} style={styles.plain}>{`${s.author} · ${s.book}`}</Text>)}
                {page.what_you_learned.text !== '' && <Text style={[styles.plain, styles.second]}>{page.what_you_learned.text}</Text>}
              </Section>
            )}
            {page.your_move && (
              <Section label={copy.history.move}>
                <Text style={styles.plain}>{page.your_move.mission}</Text>
              </Section>
            )}
            {how && (
              <Section label={copy.history.how}>
                <Text style={styles.plain}>{[copy.report.outcome[how.outcome] + '.', how.note].filter(Boolean).join(' ')}</Text>
                <Text style={styles.small}>{how.sharing === 'shared' && !takenDown ? copy.history.shared : copy.history.private}</Text>
                {how.sharing === 'shared' && !takenDown && (
                  <TextAction
                    label={copy.history.takeDown}
                    size={13.5}
                    onPress={() => withdraw(how.report_id)
                      .then((line) => live.current && setTakenDown(line))
                      .catch((e) => live.current && setTakenDown(failureLine(e, 'save').text))}
                  />
                )}
                {takenDown && <Text style={[styles.small, { marginTop: 10 }]}>{takenDown}</Text>}
              </Section>
            )}
            <View style={styles.action}>
              <Pressable
                accessibilityRole="button"
                onPress={() => { setNotOpened(null); onAction(page.action.target).catch((e) => live.current && setNotOpened(failureLine(e, 'open').text)); }}
                style={styles.actionLine}
              >
                <Text style={styles.actionText}>{page.action.label}</Text>
              </Pressable>
              {notOpened && <Text style={[styles.small, { marginTop: 14 }]}>{notOpened}</Text>}
            </View>
          </Fade>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.base },
  body: { paddingBottom: 60 },
  pad: { paddingHorizontal: 24, paddingTop: 20 },
  heading: { fontFamily: fonts.serifMedium, fontSize: 24, lineHeight: 31, color: '#f4f4f2', paddingHorizontal: 24, paddingTop: 4, paddingBottom: 16 },
  section: { borderTopWidth: 1, borderTopColor: ink(0.14), paddingHorizontal: 24, paddingTop: 15, paddingBottom: 14 },
  label: { fontFamily: fonts.sans, fontSize: 10, letterSpacing: 2, textTransform: 'uppercase', color: ink(0.45), marginBottom: 7 },
  plain: { fontFamily: fonts.sans, fontSize: 15.5, lineHeight: 23, color: ink(0.9) },
  serif: { fontFamily: fonts.serif, fontSize: 17, lineHeight: 25, color: ink(0.9) },
  second: { marginTop: 8, color: ink(0.7) },
  small: { fontFamily: fonts.sans, fontSize: 12.5, color: ink(0.5), marginTop: 4 },
  action: { borderTopWidth: 1, borderTopColor: ink(0.14), paddingHorizontal: 24, paddingTop: 18 },
  actionLine: { alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center', borderBottomWidth: 1, borderBottomColor: gold(0.8) },
  actionText: { fontFamily: fonts.sans, fontSize: 15.5, color: colors.ink },
});
