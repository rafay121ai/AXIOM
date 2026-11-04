import { useCallback, useEffect, useRef, useState } from 'react';
import { Linking, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import { sendUntilDelivered } from '../api/delivery';
import type { AccountExport, AccountRequest, LockScreen, MentorStyle, Settings, SettingsPatch } from '../api/types';
import { Fade } from '../components/Fade';
import { LoadingHint } from '../components/LoadingHint';
import { PageHeader } from '../components/PageHeader';
import { Switch } from '../components/Switch';
import { TextAction } from '../components/TextAction';
import { TimeField } from '../components/TimeField';
import { Wash } from '../components/Wash';
import { WordChoice } from '../components/WordChoice';
import { copy, failureLine } from '../copy';
import { clockTime } from '../move/format';
import { colors, fonts, ink } from '../theme';

type Props = {
  load: () => Promise<Settings>;
  save: (patch: SettingsPatch) => Promise<Settings>;
  requestExport: () => Promise<AccountExport>;
  requestDelete: () => Promise<AccountRequest>;
  cancelDelete: () => Promise<AccountRequest>;
  /** The Country row opens the `where` question; the other row opens the whole list. */
  onEditAnswers: (startAt?: string) => void;
  onSignOut: () => Promise<void>;
  onBack: () => void;
};

const DANGER = 'rgba(222,160,150,0.95)';

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.label}>{label}</Text>
      {children}
    </View>
  );
}

type RowProps = { title: string; sub?: string; value?: string; chevron?: boolean; danger?: boolean; onPress?: () => void; right?: React.ReactNode; first?: boolean };
function Row({ title, sub, value, chevron, danger, onPress, right, first }: RowProps) {
  const body = (
    <>
      <View style={styles.flex}>
        <Text style={[styles.rowTitle, danger && { color: DANGER }]}>{title}</Text>
        {sub ? <Text style={styles.sub}>{sub}</Text> : null}
      </View>
      {value ? <Text style={styles.value}>{value}</Text> : null}
      {right}
      {chevron ? <Text style={styles.chev}>›</Text> : null}
    </>
  );
  const style = [styles.row, !first && styles.rowLine];
  return onPress
    ? <Pressable accessibilityRole="button" onPress={onPress} style={style}>{body}</Pressable>
    : <View style={style}>{body}</View>;
}

// Settings: groups divided by thin lines with plain labels. Every change is saved at once; if it does not save, it goes back.
export function SettingsScreen({ load, save, requestExport, requestDelete, cancelDelete, onEditAnswers, onSignOut, onBack }: Props) {
  const [s, setS] = useState<Settings | null>(null);
  const [failure, setFailure] = useState<{ text: string; canRetry: boolean } | null>(null);
  const [timeOpen, setTimeOpen] = useState(false);
  const [quietOpen, setQuietOpen] = useState(false);
  const [exported, setExported] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState('');
  const [deleted, setDeleted] = useState<AccountRequest | null>(null);
  const live = useRef(true);
  const latest = useRef(load);
  latest.current = load;
  useEffect(() => () => { live.current = false; }, []);

  const fetchSettings = useCallback(async () => {
    setFailure(null);
    try {
      const v = await sendUntilDelivered(() => latest.current(), { cancelled: () => !live.current });
      if (!live.current) return;
      setS(v);
      if (v.pending_deletion) setDeleted({ status: 'pending_deletion', ...v.pending_deletion });
    } catch (e) {
      if (live.current) setFailure(failureLine(e, 'read'));
    }
  }, []);
  useEffect(() => { void fetchSettings(); }, [fetchSettings]);

  // Shows the change at once, saves it, and takes the server's page as the truth. A refusal puts the old page back.
  async function change(patch: SettingsPatch) {
    if (!s) return;
    const before = s;
    const { share_automatically, ...rest } = patch;
    setS({
      ...s,
      ...(rest.mentor_style ? { mentor_style: rest.mentor_style } : {}),
      ...(rest.keep_items !== undefined ? { keep_items: rest.keep_items } : {}),
      ...(share_automatically !== undefined ? { privacy: { ...s.privacy, share_automatically } } : {}),
      reminders: { ...s.reminders, ...(rest.checkin_time ? { checkin_time: rest.checkin_time } : {}), ...(rest.morning_on !== undefined ? { morning_on: rest.morning_on } : {}), ...(rest.evening_on !== undefined ? { evening_on: rest.evening_on } : {}), ...(rest.lock_screen ? { lock_screen: rest.lock_screen } : {}), ...(rest.quiet_hours ? { quiet_hours: rest.quiet_hours } : {}) },
    });
    setFailure(null);
    try {
      const saved = await sendUntilDelivered(() => save(patch), { cancelled: () => !live.current });
      if (live.current) setS(saved);
    } catch (e) {
      if (!live.current) return;
      setS(before);
      setFailure(failureLine(e, 'save'));
    }
  }

  async function askExport() {
    try {
      const r = await sendUntilDelivered(() => requestExport(), { cancelled: () => !live.current });
      if (!live.current) return;
      setExported(r.message);
      // The file goes straight to the share sheet and is not kept.
      await Share.share({ message: JSON.stringify(r, null, 2) });
    } catch (e) {
      if (live.current) setFailure(failureLine(e));
    }
  }

  async function askDelete() {
    try {
      const r = await sendUntilDelivered(() => requestDelete(), { cancelled: () => !live.current });
      if (live.current) setDeleted(r);
    } catch (e) {
      if (live.current) setFailure(failureLine(e));
    }
  }

  async function askCancel() {
    try {
      const r = await sendUntilDelivered(() => cancelDelete(), { cancelled: () => !live.current });
      if (live.current) setDeleted(r);
    } catch (e) {
      if (live.current) setFailure(failureLine(e));
    }
  }

  const link = (url: string | null) => (url ? () => void Linking.openURL(url).catch(() => {}) : undefined);
  const r = s?.reminders;
  const lockWords: { value: LockScreen; label: string }[] = [
    { value: 'full', label: copy.settings.lockFull }, { value: 'short', label: copy.settings.lockShort }, { value: 'hidden', label: copy.settings.lockHidden },
  ];
  const styleWords: { value: MentorStyle; label: string }[] = [
    { value: 'calm', label: copy.settings.calm }, { value: 'direct', label: copy.settings.direct }, { value: 'hard', label: copy.settings.hard },
  ];

  return (
    <View style={styles.screen}>
      <Wash />
      <PageHeader title={copy.settings.title} onBack={onBack} />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.body}>
        {!s && !failure && <View style={styles.pad}><LoadingHint /></View>}
        {failure && (
          <View style={styles.pad}>
            <Text accessibilityLiveRegion="polite" style={styles.note}>{failure.text}</Text>
            {failure.canRetry && <TextAction label={copy.tryAgain} size={15} onPress={() => void fetchSettings()} />}
          </View>
        )}
        {s && r && (
          <Fade>
            <Section label={copy.settings.you}>
              <Row first title={copy.settings.name} value={s.you.name ?? ''} />
              <Row title={copy.settings.email} value={s.you.email ?? ''} />
              <Row title={copy.settings.country} value={s.you.country ?? ''} chevron onPress={() => onEditAnswers('where')} />
              <Row title={copy.settings.knows} sub={copy.settings.knowsSub} chevron onPress={() => onEditAnswers()} />
            </Section>

            <Section label={copy.settings.reminders}>
              <Row first title={copy.settings.checkin} sub={copy.settings.checkinSub} value={clockTime(r.checkin_time)} chevron onPress={() => setTimeOpen((o) => !o)} />
              {timeOpen && <View style={styles.time}><TimeField label={copy.settings.checkin} value={r.checkin_time} onChange={(t) => void change({ checkin_time: t })} /></View>}
              {r.push_registered ? (
                <>
                  <Row title={copy.settings.morning} sub={copy.settings.morningSub} right={<Switch on={r.morning_on} label={copy.settings.morning} onChange={(v) => void change({ morning_on: v })} />} />
                  <Row title={copy.settings.evening} sub={copy.settings.eveningSub} right={<Switch on={r.evening_on} label={copy.settings.evening} onChange={(v) => void change({ evening_on: v })} />} />
                </>
              ) : (
                <>
                  <View style={[styles.row, styles.rowLine]}>
                    <View style={styles.flex}>
                      <Text style={styles.rowTitle}>{copy.settings.off}</Text>
                      <Text style={styles.sub}>{copy.settings.offSub}</Text>
                      <TextAction label={copy.settings.openPhone} size={14} onPress={() => void Linking.openSettings().catch(() => {})} />
                    </View>
                  </View>
                  <Row title={copy.settings.morning} sub={copy.settings.morningOff} />
                </>
              )}
              <Row title={copy.settings.lock} />
              <WordChoice options={lockWords} value={r.lock_screen} onChange={(v) => void change({ lock_screen: v })} />
              <Text style={styles.note}>{copy.settings.lockNote}</Text>
              <Row title={copy.settings.quiet} value={`${clockTime(r.quiet_hours.start)} to ${clockTime(r.quiet_hours.end)}`} chevron onPress={() => setQuietOpen((o) => !o)} />
              {quietOpen && (
                <View style={styles.time}>
                  <Text style={styles.sub}>{copy.settings.quietFrom}</Text>
                  <TimeField label={copy.settings.quietFrom} value={r.quiet_hours.start} onChange={(t) => void change({ quiet_hours: { ...r.quiet_hours, start: t } })} />
                  <Text style={[styles.sub, { marginTop: 10 }]}>{copy.settings.quietUntil}</Text>
                  <TimeField label={copy.settings.quietUntil} value={r.quiet_hours.end} onChange={(t) => void change({ quiet_hours: { ...r.quiet_hours, end: t } })} />
                </View>
              )}
            </Section>

            <Section label={copy.settings.talks}>
              <WordChoice options={styleWords} value={s.mentor_style} onChange={(v) => void change({ mentor_style: v })} />
              <Text style={styles.note}>{copy.settings.talksNote}</Text>
            </Section>

            <Section label={copy.settings.onScreen}>
              <Row first title={copy.settings.keep} sub={copy.settings.keepSub} right={<Switch on={s.keep_items} label={copy.settings.keep} onChange={(v) => void change({ keep_items: v })} />} />
            </Section>

            <Section label={copy.settings.privacy}>
              <Row first title={copy.settings.share} sub={s.privacy.text} right={<Switch on={s.privacy.share_automatically} label={copy.settings.share} onChange={(v) => void change({ share_automatically: v })} />} />
              {s.links.privacy && <Row title={copy.settings.privacyLink} chevron onPress={link(s.links.privacy)} />}
              {s.links.terms && <Row title={copy.settings.terms} chevron onPress={link(s.links.terms)} />}
            </Section>

            <Section label={copy.settings.account}>
              <Row first title={copy.settings.export} onPress={() => void askExport()} />
              {exported && <Text style={styles.note}>{exported}</Text>}
              <Row title={copy.settings.signOut} onPress={() => void onSignOut()} />
              <Row title={copy.settings.delete} danger onPress={() => { setDeleted(null); setTyped(''); setConfirming(true); }} />
              {deleted && !confirming && <Text accessibilityLiveRegion="polite" style={styles.note}>{deleted.message}</Text>}
              {deleted?.status === 'pending_deletion' && !confirming && <TextAction label={copy.settings.cancelDeletion} size={14} onPress={() => void askCancel()} />}
            </Section>
          </Fade>
        )}
      </ScrollView>
      {confirming && (
        <View style={styles.modal}>
          <View style={styles.box}>
            <Text style={styles.boxTitle}>{copy.settings.confirmTitle}</Text>
            {deleted ? (
              <>
                <Text style={styles.boxBody}>{deleted.message}</Text>
                <Pressable accessibilityRole="button" onPress={() => setConfirming(false)} style={styles.boxButton}><Text style={styles.boxButtonText}>{copy.settings.keepData}</Text></Pressable>
              </>
            ) : (
              <>
                {s?.deletion.would_remove.map((line) => <Text key={line} style={styles.boxLine}>{`·  ${line}`}</Text>)}
                <Text style={[styles.boxBody, { marginTop: 10 }]}>{s?.deletion.shared_outcomes}</Text>
                <Pressable accessibilityRole="button" onPress={() => setConfirming(false)} style={styles.boxButton}><Text style={styles.boxButtonText}>{copy.settings.keepData}</Text></Pressable>
                <TextInput accessibilityLabel="DELETE" placeholder="DELETE" placeholderTextColor={ink(0.3)} value={typed} onChangeText={setTyped} autoCapitalize="characters" autoCorrect={false} style={styles.confirmInput} />
                <Pressable accessibilityRole="button" disabled={typed !== 'DELETE'} onPress={() => void askDelete()} style={[styles.boxButton, { borderColor: 'rgba(222,160,150,0.4)' }, typed !== 'DELETE' && { opacity: 0.4 }]}><Text style={[styles.boxButtonText, { color: DANGER }]}>{copy.settings.deleteAll}</Text></Pressable>
              </>
            )}
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.base },
  flex: { flex: 1 },
  body: { paddingBottom: 60 },
  pad: { paddingHorizontal: 24, paddingTop: 20 },
  section: { borderTopWidth: 1, borderTopColor: ink(0.14), paddingHorizontal: 24, paddingTop: 16, paddingBottom: 6 },
  label: { fontFamily: fonts.sans, fontSize: 10, letterSpacing: 2, textTransform: 'uppercase', color: ink(0.45), marginBottom: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 52, paddingVertical: 13 },
  rowLine: { borderTopWidth: 1, borderTopColor: ink(0.08) },
  rowTitle: { fontFamily: fonts.sans, fontSize: 15.5, color: ink(0.9) },
  sub: { fontFamily: fonts.sans, fontSize: 12, lineHeight: 17, color: ink(0.5), marginTop: 3 },
  value: { fontFamily: fonts.sans, fontSize: 14.5, color: ink(0.6), textAlign: 'right', flexShrink: 1 },
  chev: { fontSize: 20, color: ink(0.4) },
  note: { fontFamily: fonts.sans, fontSize: 12.5, lineHeight: 18.75, color: ink(0.5), paddingBottom: 12 },
  time: { paddingBottom: 10 },
  modal: { ...StyleSheet.absoluteFill, justifyContent: 'center', padding: 26, backgroundColor: 'rgba(0,0,0,0.72)' },
  box: { backgroundColor: '#0b0b0b', borderWidth: 1, borderColor: ink(0.2), borderRadius: 22, padding: 20 },
  boxTitle: { fontFamily: fonts.serifMedium, fontSize: 19, lineHeight: 25, color: '#f4f4f2', marginBottom: 10 },
  boxLine: { fontFamily: fonts.sans, fontSize: 14, lineHeight: 21, color: ink(0.7) },
  boxBody: { fontFamily: fonts.sans, fontSize: 14, lineHeight: 21, color: ink(0.7), marginBottom: 18 },
  confirmInput: { fontFamily: fonts.sans, fontSize: 15, color: colors.ink, borderWidth: 1, borderColor: ink(0.2), borderRadius: 14, minHeight: 48, paddingHorizontal: 14, marginBottom: 2 },
  boxButton: { minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 14, borderWidth: 1, borderColor: ink(0.3), marginTop: 10 },
  boxButtonText: { fontFamily: fonts.sans, fontSize: 15, color: colors.ink },
});
