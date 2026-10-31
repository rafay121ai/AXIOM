import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, KeyboardAvoidingView, Platform, ScrollView, type ScrollViewInstance, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { newTurnId, sendUntilDelivered } from '../api/delivery';
import type { ConsentResult, ConsentState, DueReport, CareHelp, Outcome, ReportResult, Screened, StoryReply } from '../api/types';
import { routeScreened } from '../care/route';
import { Composer } from '../components/Composer';
import { Fade } from '../components/Fade';
import { FounderCard } from '../components/FounderCard';
import { LoadingHint } from '../components/LoadingHint';
import { Logo } from '../components/Logo';
import { type MarkName, RoundMark } from '../components/RoundMark';
import { TextAction } from '../components/TextAction';
import { useReduceMotion } from '../components/useReduceMotion';
import { copy, failureLine } from '../copy';
import { consentQuestion, OUTCOME_MARK, outcomeLabel } from '../report/flow';
import { colors, fonts, ink, type } from '../theme';

type Props = {
  report: DueReport;
  send: (outcome: Outcome, note: string, turnId: string) => Promise<Screened<ReportResult>>;
  story: (reportId: string) => Promise<StoryReply>;
  consent: (reportId: string, share: boolean, wordingVersion: string) => Promise<ConsentResult>;
  /** The check-in is done and Axiom has said its last line. */
  onFinish: () => void;
  onCare: (message: string, help: CareHelp) => void;
};

type Choice = { key: string; label: string; mark: MarkName };
type Item =
  | { id: number; kind: 'ax'; text: string }
  | { id: number; kind: 'me'; text: string }
  | { id: number; kind: 'story'; text: string; lesson: string | null }
  | { id: number; kind: 'ask'; choices: Choice[]; picked: string | null };

type NewItem = Item extends infer T ? (T extends { id: number } ? Omit<T, 'id'> : never) : never;

const RISE_FROM = 190;
const PRESS_MS = 450;
const RISE_MS = 900;
const QUESTION_AT = 850;
const BEAT_MS = 900;
const FINISH_MS = 3200;
const QUIET_FINISH_MS = 2600;

type Sent = { id: number; outcome: Outcome; note: string; turnId: string };
type Reported = Extract<ReportResult, { status: 'reported' }>;
/** What the founder is deciding now: whether to see the story, or whether to share. */
type Decision = { kind: 'story'; result: Reported } | { kind: 'share'; version: string };

// The Report: Axiom names the move and what it predicted, and three round marks ask how it went. Tapping one posts
// nothing; the opening rises, one plain question follows, and the founder answers in their own words. Then Axiom's
// reply, a founder story if one is approved, and the sharing question, asked every time unless the founder shares automatically.
export function ReportScreen({ report, send, story, consent, onFinish, onCare }: Props) {
  const insets = useSafeAreaInsets();
  const reduce = useReduceMotion();
  const [picked, setPicked] = useState<Outcome | null>(null);
  const [asked, setAsked] = useState(false);
  const [items, setItems] = useState<Item[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [offline, setOffline] = useState(false);
  const [composing, setComposing] = useState(true);
  const [failure, setFailure] = useState<{ text: string; canRetry: boolean; retry: () => void } | null>(null);
  const live = useRef(true);
  const nextId = useRef(1);
  const scroller = useRef<ScrollViewInstance>(null);
  const top = useRef(new Animated.Value(RISE_FROM)).current;
  const decision = useRef<Decision | null>(null);
  const reportId = useRef<string | null>(null);
  const latest = useRef({ onFinish });
  latest.current = { onFinish };
  useEffect(() => () => { live.current = false; }, []);

  const pause = (ms: number) => new Promise<void>((resume) => setTimeout(resume, reduce ? 0 : ms));
  const add = (item: NewItem): number => {
    const id = nextId.current++;
    setItems((all) => [...all, { ...item, id } as Item]);
    return id;
  };
  const options = useCallback(() => ({
    onWaiting: (w: boolean) => { if (live.current) setOffline(w); },
    cancelled: () => !live.current,
  }), []);

  function choose(outcome: Outcome) {
    if (picked) return;
    setPicked(outcome);
    void (async () => {
      await pause(PRESS_MS);
      Animated.timing(top, { toValue: 0, duration: reduce ? 0 : RISE_MS, useNativeDriver: false }).start();
      await pause(QUESTION_AT);
      if (live.current) setAsked(true);
    })();
  }

  // After the founder's last decision: one beat to read it, then on.
  async function wrapUp(ms: number) {
    await pause(ms);
    if (live.current) latest.current.onFinish();
  }

  // The sharing question, or the end when the server did not ask.
  async function askConsent(state: ConsentState, sawStory: boolean) {
    const q = consentQuestion(state, sawStory);
    if (!q) return wrapUp(QUIET_FINISH_MS);
    await pause(BEAT_MS);
    if (!live.current) return;
    add({ kind: 'ax', text: q.text });
    add({
      kind: 'ask',
      picked: null,
      choices: [{ key: 'share', label: copy.report.share, mark: 'tick' }, { key: 'private', label: copy.report.keepPrivate, mark: 'lock' }],
    });
    decision.current = { kind: 'share', version: q.wording_version };
  }

  async function offerStory(result: Reported) {
    if (!result.story_offer) return askConsent(result.consent, false);
    await pause(BEAT_MS);
    if (!live.current) return;
    add({ kind: 'ax', text: result.story_offer.text });
    add({
      kind: 'ask',
      picked: null,
      choices: [{ key: 'yes', label: copy.report.seeStory, mark: 'tick' }, { key: 'no', label: copy.report.notNow, mark: 'pause' }],
    });
    decision.current = { kind: 'story', result };
  }

  async function showStory(result: Reported) {
    setFailure(null);
    try {
      const got = await sendUntilDelivered(() => story(result.report.id), options());
      if (!live.current) return;
      if (got.story) add({ kind: 'story', text: got.story.story, lesson: got.story.lesson });
      if (got.founder_lessons) add({ kind: 'ax', text: got.founder_lessons.notice.text });
      await askConsent(result.consent, got.story !== null);
    } catch (e) {
      if (live.current) setFailure({ ...failureLine(e), retry: () => void showStory(result) });
    }
  }

  async function saveConsent(share: boolean, version: string) {
    setFailure(null);
    try {
      const res = await sendUntilDelivered(() => consent(reportId.current!, share, version), options());
      if (!live.current) return;
      add({ kind: 'ax', text: res.reply });
      await wrapUp(FINISH_MS);
    } catch (e) {
      if (live.current) setFailure({ ...failureLine(e), retry: () => void saveConsent(share, version) });
    }
  }

  function pick(askId: number, key: string) {
    const target = items.find((i) => i.id === askId);
    if (!target || target.kind !== 'ask' || target.picked) return;
    setItems((all) => all.map((i) => (i.id === askId && i.kind === 'ask' ? { ...i, picked: key } : i)));
    void (async () => {
      await pause(PRESS_MS);
      if (!live.current) return;
      const now = decision.current;
      if (now?.kind === 'story') return key === 'yes' ? showStory(now.result) : askConsent(now.result.consent, false);
      if (now?.kind === 'share') return saveConsent(key === 'share', now.version);
    })();
  }

  async function deliver(sent: Sent) {
    setBusy(true);
    setFailure(null);
    try {
      const res = await sendUntilDelivered(() => send(sent.outcome, sent.note, sent.turnId), options());
      if (!live.current) return;
      const route = routeScreened(res);
      if (route.kind === 'care') {
        setItems((all) => all.filter((i) => i.id !== sent.id));
        onCare(route.message, route.help);
        return;
      }
      if (route.kind === 'unclear') {
        add({ kind: 'ax', text: route.reply });
        return;
      }
      if (res.care) return;
      if (res.status === 'need_more') {
        add({ kind: 'ax', text: res.reply });
        return;
      }
      reportId.current = res.report.id;
      setComposing(false);
      add({ kind: 'ax', text: res.reply });
      await offerStory(res);
    } catch (e) {
      if (live.current) setFailure({ ...failureLine(e), retry: () => void deliver(sent) });
    } finally {
      if (live.current) setBusy(false);
    }
  }

  function submit() {
    const note = text.trim();
    if (!note || busy || !picked) return;
    // The turn id is made once per message and reused on every retry, so the server counts the check-in once.
    const sent: Sent = { id: add({ kind: 'me', text: note }), outcome: picked, note, turnId: newTurnId() };
    setText('');
    void deliver(sent);
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
      <View style={[styles.head, { paddingTop: insets.top + 60 }]}>
        <Logo size={26} />
        <Text style={styles.title}>{copy.report.title}</Text>
      </View>
      <ScrollView
        ref={scroller}
        onContentSizeChange={() => scroller.current?.scrollToEnd({ animated: true })}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.chat}
      >
        <Animated.View style={{ paddingTop: top }}>
          <Fade delay={500} style={styles.opening}>
            <Text style={[type.reading, styles.openingText]}>{report.opening}</Text>
          </Fade>
          <Fade delay={1300} style={styles.marks}>
            {report.outcomes.map((o) => (
              <RoundMark
                key={o}
                label={outcomeLabel(o)}
                mark={OUTCOME_MARK[o]}
                state={picked === null ? 'idle' : picked === o ? 'on' : 'dim'}
                onPress={() => choose(o)}
              />
            ))}
          </Fade>
        </Animated.View>
        {asked && picked && (
          <Fade delay={200} style={styles.ax}>
            <Text style={type.reading}>{report.questions[picked]}</Text>
          </Fade>
        )}
        {items.map((i) => {
          if (i.kind === 'me') return <Text key={i.id} style={styles.me}>{i.text}</Text>;
          if (i.kind === 'ax') return <Fade key={i.id} style={styles.ax}><Text style={type.reading}>{i.text}</Text></Fade>;
          if (i.kind === 'story') {
            return <FounderCard key={i.id} story={i.text} lesson={i.lesson} />;
          }
          return (
            <Fade key={i.id} style={styles.choices}>
              {i.choices.map((c) => (
                <RoundMark
                  key={c.key}
                  label={c.label}
                  mark={c.mark}
                  state={i.picked === null ? 'idle' : i.picked === c.key ? 'on' : 'dim'}
                  onPress={() => pick(i.id, c.key)}
                />
              ))}
            </Fade>
          );
        })}
        {busy && !offline && <LoadingHint />}
        {offline && (
          <Fade style={styles.saved}>
            <Text style={[type.readSay, styles.centred]}>{copy.report.saved}</Text>
            <Text style={[type.readSay, styles.centred, styles.dim]}>{copy.report.willSend}</Text>
          </Fade>
        )}
        {failure && (
          <Fade style={styles.ax}>
            <Text accessibilityLiveRegion="polite" style={type.reading}>{failure.text}</Text>
            {failure.canRetry && <View style={styles.retry}><TextAction label={copy.tryAgain} size={15} onPress={failure.retry} /></View>}
          </Fade>
        )}
      </ScrollView>
      {asked && composing && (
        <Fade delay={300} style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 12) + 18 }]}>
          <LinearGradient pointerEvents="none" colors={['rgba(5,5,5,0)', colors.base]} locations={[0, 0.4]} style={StyleSheet.absoluteFill} />
          <Composer value={text} onChangeText={setText} onSend={submit} placeholder={copy.report.placeholder} offline={offline} busy={busy} />
        </Fade>
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  head: { paddingHorizontal: 26, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontFamily: fonts.sans, fontSize: 10.5, letterSpacing: 2.3, textTransform: 'uppercase', color: ink(0.45) },
  chat: { paddingHorizontal: 28, paddingTop: 26, paddingBottom: 230 },
  opening: { marginBottom: 26 },
  openingText: { fontSize: 21, lineHeight: 30, textAlign: 'center' },
  marks: { flexDirection: 'row', justifyContent: 'center', gap: 22, marginBottom: 24 },
  ax: { marginBottom: 18 },
  me: { ...type.founder, textAlign: 'right', marginTop: 8, marginBottom: 22, marginLeft: 52 },
  choices: { flexDirection: 'row', gap: 22, marginBottom: 22 },
  saved: { marginTop: 40 },
  centred: { textAlign: 'center' },
  dim: { color: ink(0.5) },
  retry: { alignSelf: 'flex-start', marginLeft: -8 },
  bar: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingTop: 22, paddingHorizontal: 16 },
});
