import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Easing, KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, type ScrollViewInstance, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { sendUntilDelivered } from '../api/delivery';
import type { Commitment, HelpLine, LoadingQuote, MoveView, Screened, SwapResult } from '../api/types';
import { routeScreened } from '../care/route';
import { Fade } from '../components/Fade';
import { GoldButton } from '../components/GoldButton';
import { LoadingHint } from '../components/LoadingHint';
import { RoundMark } from '../components/RoundMark';
import { TextAction } from '../components/TextAction';
import { useReduceMotion } from '../components/useReduceMotion';
import { copy, failureLine } from '../copy';
import { deviceTimeZone, spokenTime } from '../move/format';
import type { Push } from '../push/push';
import { colors, fonts, gold, ink, type } from '../theme';

type Props = {
  open: () => Promise<MoveView>;
  commit: (moveId: string, timezone: string) => Promise<Commitment>;
  swap: (moveId: string, reason: string) => Promise<Screened<SwapResult>>;
  loadHint: (seed: string) => Promise<LoadingQuote | null>;
  /** The phone's reminder: asked about only when the founder says yes. */
  push: Push;
  /** The founder closed the sheet before committing: back to the chat. */
  onClose: () => void;
  /** The move is committed and the reminder question is settled: on to the home screen. */
  onDone: () => void;
  onCare: (message: string, help: HelpLine[]) => void;
};

const SLIDE_MS = 600;
const LEAVE_MS = 1400;

/** The reminder question after Commit. `refused`: the phone's own box was refused, so the check-in waits on the home screen. */
type Reminder = 'none' | 'ask' | 'yes' | 'no' | 'refused';

// The Move: a solid sheet that slides up over the chat. Mission, what success looks like, the words to use,
// a checklist, Axiom's prediction, Commit, and a quiet "Change this move" that works once.
export function MoveScreen({ open, commit, swap, loadHint, push, onClose, onDone, onCare }: Props) {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const reduce = useReduceMotion();
  const slide = useRef(new Animated.Value(height)).current;
  const [move, setMove] = useState<MoveView | null>(null);
  const [hint, setHint] = useState<LoadingQuote | null>(null);
  const [ticked, setTicked] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [changing, setChanging] = useState(false);
  const [reason, setReason] = useState('');
  // Axiom's line under the reason box: the "need a real reason" reply, or a soft reply to an unclear text.
  const [say, setSay] = useState<string | null>(null);
  const [reminder, setReminder] = useState<Reminder>('none');
  const [pressed, setPressed] = useState<'yes' | 'no' | null>(null);
  const [failure, setFailure] = useState<{ text: string; canRetry: boolean; retry: () => void } | null>(null);
  const live = useRef(true);
  // The sheet asks for the move once, however often its parent redraws.
  const latest = useRef({ open, loadHint, onDone });
  latest.current = { open, loadHint, onDone };
  const leave = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const scroller = useRef<ScrollViewInstance>(null);
  useEffect(() => () => { live.current = false; clearTimeout(leave.current); }, []);

  useEffect(() => {
    const up = Animated.timing(slide, { toValue: 0, duration: reduce ? 0 : SLIDE_MS, easing: Easing.bezier(0.2, 0.8, 0.2, 1), useNativeDriver: true });
    up.start();
    return () => up.stop();
  }, [slide, reduce]);

  // One request: the loading hint shows while it waits; without a connection the same request repeats.
  const run = useCallback(async <T,>(call: () => Promise<T>, seed: string): Promise<T> => {
    setBusy(true);
    setFailure(null);
    setHint(null);
    void latest.current.loadHint(seed).then((h) => { if (live.current) setHint(h); }).catch(() => {});
    try {
      return await sendUntilDelivered(call, { cancelled: () => !live.current });
    } finally {
      if (live.current) setBusy(false);
    }
  }, []);

  const load = useCallback(async () => {
    try {
      const m = await run(() => latest.current.open(), 'move');
      if (live.current) setMove(m);
    } catch (e) {
      if (live.current) setFailure({ ...failureLine(e, 'read'), retry: () => void load() });
    }
  }, [run]);
  useEffect(() => { void load(); }, [load]);

  const goHomeSoon = useCallback(() => {
    clearTimeout(leave.current);
    leave.current = setTimeout(() => { if (live.current) latest.current.onDone(); }, LEAVE_MS);
  }, []);

  // Committing twice is one commitment on the server, so a lost answer is simply asked for again.
  // Then the reminder: asked once if the phone has not been asked; if reminders are allowed already, it is simply set.
  async function doCommit(m: MoveView) {
    if (busy) return;
    try {
      const res = await run(() => commit(m.id, deviceTimeZone()), 'commit');
      if (!live.current) return;
      setMove(res.move);
      const state = await push.state().catch(() => 'off' as const);
      if (!live.current) return;
      if (state === 'ask') return setReminder('ask');
      if (state === 'on') {
        await push.refresh().catch(() => {});
        if (live.current) setReminder('yes');
      }
      goHomeSoon();
    } catch (e) {
      if (live.current) setFailure({ ...failureLine(e), retry: () => void doCommit(m) });
    }
  }

  async function answerReminder(yes: boolean) {
    if (pressed) return;
    setPressed(yes ? 'yes' : 'no');
    if (!yes) {
      setReminder('no');
      return goHomeSoon();
    }
    try {
      const result = await push.enable();
      if (!live.current) return;
      setReminder(result === 'on' ? 'yes' : 'refused');
      if (result === 'on') goHomeSoon();
    } catch (e) {
      if (!live.current) return;
      setPressed(null);
      setFailure({ ...failureLine(e), retry: () => void answerReminder(true) });
    }
  }

  async function doSwap(m: MoveView) {
    const said = reason.trim();
    if (!said || busy) return;
    try {
      const res = await run(() => swap(m.id, said), 'swap');
      if (!live.current) return;
      const route = routeScreened(res);
      if (route.kind === 'care') return onCare(route.message, route.help);
      if (route.kind === 'unclear') return setSay(route.reply);
      if (res.care) return;
      if (res.status === 'need_reason') return setSay(res.reply);
      setMove(res.move);
      setTicked([]);
      setChanging(false);
      setReason('');
      setSay(null);
    } catch (e) {
      if (live.current) setFailure({ ...failureLine(e), retry: () => void doSwap(m) });
    }
  }

  // The reminder question and its answer sit at the bottom of a long sheet: bring them into view.
  useEffect(() => {
    if (reminder === 'none') return;
    const t = setTimeout(() => scroller.current?.scrollToEnd({ animated: true }), 450);
    return () => clearTimeout(t);
  }, [reminder]);

  const tick = (n: number) => setTicked((t) => (t.includes(n) ? t.filter((i) => i !== n) : [...t, n]));
  const committed = move?.report_time_local ? move : null;

  return (
    <View style={styles.dim}>
      <Animated.View style={[styles.sheet, { top: Math.max(insets.top, 24) + 16, transform: [{ translateY: slide }] }]}>
        <Pressable accessibilityRole="button" accessibilityLabel={copy.move.back} onPress={committed ? onDone : onClose} style={styles.close}>
          <Text style={styles.closeMark}>×</Text>
        </Pressable>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
          <ScrollView ref={scroller} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={[styles.inner, { paddingBottom: insets.bottom + 40 }]}>
            {!move && busy && <LoadingHint hint={hint} />}
            {move && (
              <Fade duration={500}>
                <Text style={styles.kicker}>{copy.move.kicker}</Text>
                <Text style={styles.title}>{move.title}</Text>
                <Section label={copy.move.mission}><Text style={styles.body}>{move.mission}</Text></Section>
                <Section label={copy.move.success}><Text style={styles.body}>{move.success}</Text></Section>
                {move.words && (
                  <Section label={copy.move.words}>
                    <View style={styles.words}>
                      <Text style={styles.wordsText}>{move.words}</Text>
                      <Text style={styles.wordsNote}>{copy.move.wordsNote}</Text>
                    </View>
                  </Section>
                )}
                <Section label={copy.move.checklist}>
                  {move.checklist.map((item, n) => (
                    <Pressable key={n} accessibilityRole="checkbox" accessibilityState={{ checked: ticked.includes(n) }} onPress={() => tick(n)} style={styles.item}>
                      <View style={[styles.box, ticked.includes(n) && styles.boxOn]}>{ticked.includes(n) && <View style={styles.tick} />}</View>
                      <Text style={[styles.itemText, ticked.includes(n) && styles.itemDone]}>{item}</Text>
                    </Pressable>
                  ))}
                </Section>
                <Text style={styles.prediction}>{move.prediction}</Text>
                {committed?.report_time_local ? (
                  <Fade duration={350}>
                    <Text style={styles.committed}>{copy.move.committed}</Text>
                    {reminder === 'ask' && (
                      <Fade duration={400} style={styles.ask}>
                        <Text style={styles.committedAsk}>{copy.move.remindAsk}</Text>
                        <View style={styles.marks}>
                          <RoundMark label={copy.move.remindYes} mark="tick" state={pressed === null ? 'idle' : pressed === 'yes' ? 'on' : 'dim'} onPress={() => void answerReminder(true)} />
                          <RoundMark label={copy.move.remindNo} mark="pause" state={pressed === null ? 'idle' : pressed === 'no' ? 'on' : 'dim'} onPress={() => void answerReminder(false)} />
                        </View>
                      </Fade>
                    )}
                    {reminder === 'yes' && <Text style={styles.committed}>{copy.move.remind(spokenTime(committed.report_time_local))}</Text>}
                    {reminder === 'no' && <Text style={styles.committed}>{copy.move.remindNone}</Text>}
                    {reminder === 'refused' && (
                      <Fade duration={400} style={styles.ask}>
                        <Text style={styles.committedAsk}>{copy.move.remindersOff}</Text>
                        <TextAction label={copy.move.phoneSettings} size={15} onPress={() => void Linking.openSettings().catch(() => {})} />
                      </Fade>
                    )}
                  </Fade>
                ) : (
                  <GoldButton label={copy.move.commit} onPress={() => void doCommit(move)} disabled={busy} />
                )}
                {move.can_swap && (
                  <View style={styles.change}>
                    <TextAction label={copy.move.change} size={13} onPress={() => setChanging((c) => !c)} />
                    {changing && (
                      <View style={styles.swap}>
                        <Text style={styles.swapAsk}>{copy.move.swapAsk}</Text>
                        <TextInput
                          multiline
                          value={reason}
                          onChangeText={setReason}
                          placeholder={copy.move.swapPlaceholder}
                          placeholderTextColor={ink(0.4)}
                          selectionColor={gold(1)}
                          accessibilityLabel={copy.move.swapPlaceholder}
                          style={styles.reason}
                        />
                        {say ? <Text accessibilityLiveRegion="polite" style={styles.say}>{say}</Text> : <Text style={styles.swapNote}>{copy.move.swapNote}</Text>}
                        <GoldButton label={copy.move.swapGo} onPress={() => void doSwap(move)} disabled={busy || !reason.trim()} />
                      </View>
                    )}
                  </View>
                )}
              </Fade>
            )}
            {busy && move && <LoadingHint hint={hint} />}
            {failure && (
              <Fade style={styles.failure}>
                <Text accessibilityLiveRegion="polite" style={type.reading}>{failure.text}</Text>
                {failure.canRetry && <TextAction label={copy.tryAgain} size={15} onPress={failure.retry} />}
              </Fade>
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      </Animated.View>
    </View>
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

const styles = StyleSheet.create({
  flex: { flex: 1 },
  dim: { flex: 1, backgroundColor: colors.base },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: '#090909', borderTopLeftRadius: 30, borderTopRightRadius: 30, borderTopWidth: 1, borderTopColor: ink(0.2), overflow: 'hidden' },
  close: { position: 'absolute', top: 14, right: 18, zIndex: 2, width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  closeMark: { fontSize: 20, lineHeight: 22, color: ink(0.6), width: 30, height: 30, textAlign: 'center', paddingTop: 3, borderRadius: 15, borderWidth: 1, borderColor: ink(0.2), overflow: 'hidden' },
  inner: { paddingTop: 36, paddingHorizontal: 26 },
  kicker: { ...type.label, color: ink(0.45), letterSpacing: 2.2, marginBottom: 12 },
  title: { fontFamily: fonts.serifMedium, fontSize: 24, lineHeight: 31, color: '#f4f4f2', marginBottom: 22 },
  section: { marginBottom: 20 },
  label: { ...type.label, color: ink(0.45), letterSpacing: 2, marginBottom: 8 },
  body: { fontFamily: fonts.sans, fontSize: 16, lineHeight: 24, color: ink(0.9) },
  words: { paddingVertical: 14, paddingHorizontal: 16, borderLeftWidth: 2, borderLeftColor: colors.goldFrom, backgroundColor: ink(0.05) },
  wordsText: { fontFamily: fonts.serif, fontSize: 17, lineHeight: 25.5, color: '#f1f1ef' },
  wordsNote: { fontFamily: fonts.sans, fontSize: 11, letterSpacing: 0.9, color: ink(0.45), marginTop: 8 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 44, paddingVertical: 8, borderTopWidth: 1, borderTopColor: ink(0.1) },
  box: { width: 16, height: 16, borderRadius: 5, borderWidth: 1, borderColor: ink(0.35) },
  boxOn: { backgroundColor: colors.goldFrom, borderColor: 'transparent' },
  tick: { position: 'absolute', left: 5, top: 1.5, width: 4, height: 8, borderColor: colors.onGold, borderRightWidth: 1.5, borderBottomWidth: 1.5, transform: [{ rotate: '45deg' }] },
  itemText: { flex: 1, fontFamily: fonts.sans, fontSize: 15, lineHeight: 21, color: ink(0.85) },
  itemDone: { opacity: 0.5, textDecorationLine: 'line-through' },
  prediction: { fontFamily: fonts.serif, fontStyle: 'italic', fontSize: 16, lineHeight: 24, color: ink(0.8), marginVertical: 24 },
  committed: { fontFamily: fonts.serif, fontSize: 16, lineHeight: 25, color: ink(0.8), textAlign: 'center', paddingTop: 10 },
  ask: { alignItems: 'center', marginTop: 22, paddingTop: 18, borderTopWidth: 1, borderTopColor: ink(0.12) },
  committedAsk: { fontFamily: fonts.serif, fontSize: 17, lineHeight: 25, color: colors.ink, textAlign: 'center', marginBottom: 14 },
  marks: { flexDirection: 'row', justifyContent: 'center', gap: 22 },
  change: { marginTop: 16, alignItems: 'center' },
  swap: { alignSelf: 'stretch', marginTop: 8 },
  swapAsk: { fontFamily: fonts.sans, fontSize: 13, lineHeight: 19.5, color: ink(0.6), marginBottom: 10 },
  reason: { minHeight: 80, backgroundColor: ink(0.06), borderWidth: 1, borderColor: ink(0.2), borderRadius: 12, padding: 12, marginBottom: 8, textAlignVertical: 'top', ...type.field, fontSize: 15.5, ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : {}) },
  swapNote: { fontFamily: fonts.sans, fontSize: 13, lineHeight: 19.5, color: ink(0.6), marginBottom: 22 },
  say: { fontFamily: fonts.serif, fontSize: 16, lineHeight: 24, color: ink(0.9), marginBottom: 22 },
  failure: { marginTop: 18 },
});
