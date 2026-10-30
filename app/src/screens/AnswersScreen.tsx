import { useCallback, useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { sendUntilDelivered } from '../api/delivery';
import type { Answer, HelpLine, Question, Screened, Signup } from '../api/types';
import { routeScreened } from '../care/route';
import { Fade } from '../components/Fade';
import { GoldButton } from '../components/GoldButton';
import { LoadingHint } from '../components/LoadingHint';
import { PageHeader } from '../components/PageHeader';
import { QuestionBody } from '../components/QuestionBody';
import { TextAction } from '../components/TextAction';
import { Wash } from '../components/Wash';
import { copy, failureLine } from '../copy';
import { answerSummary, autoAdvances, isDone, needsContinue } from '../onboarding/flow';
import { colors, fonts, ink, motion, space, type } from '../theme';

type Props = {
  load: () => Promise<Signup>;
  save: (key: string, answer: Answer) => Promise<Screened>;
  /** Open straight on this question (the Country row). */
  startAt?: string;
  onBack: () => void;
  onCare: (message: string, help: HelpLine[]) => void;
};

// "What Axiom knows about you": the sign-up questions again, one at a time, with the same input as the first time.
export function AnswersScreen({ load, save, startAt, onBack, onCare }: Props) {
  const insets = useSafeAreaInsets();
  const [signup, setSignup] = useState<Signup | null>(null);
  const [editing, setEditing] = useState<string | null>(startAt ?? null);
  const [draft, setDraft] = useState<Answer | undefined>(undefined);
  const [say, setSay] = useState<string | null>(null);
  const [failure, setFailure] = useState<{ text: string; canRetry: boolean } | null>(null);
  const live = useRef(true);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const latest = useRef(load);
  latest.current = load;
  useEffect(() => () => { live.current = false; clearTimeout(timer.current); }, []);

  const fetchSignup = useCallback(async () => {
    setFailure(null);
    try {
      const s = await sendUntilDelivered(() => latest.current(), { cancelled: () => !live.current });
      if (!live.current) return;
      setSignup(s);
      if (startAt) setDraft(s.answers[startAt]);
    } catch (e) {
      if (live.current) setFailure(failureLine(e, 'read'));
    }
  }, [startAt]);
  useEffect(() => { void fetchSignup(); }, [fetchSignup]);

  const question: Question | undefined = signup?.questions.find((q) => q.key === editing);

  function edit(q: Question) {
    setDraft(signup?.answers[q.key]);
    setSay(null);
    setFailure(null);
    setEditing(q.key);
  }

  async function finish(q: Question, answer: Answer) {
    try {
      const res = await sendUntilDelivered(() => save(q.key, answer), { cancelled: () => !live.current });
      if (!live.current) return;
      const route = routeScreened(res);
      if (route.kind === 'care') return onCare(route.message, route.help);
      if (route.kind === 'unclear') return setSay(route.reply);
      setSignup((s) => s && { ...s, answers: { ...s.answers, [q.key]: answer } });
      setEditing(null);
    } catch (e) {
      if (live.current) setFailure(failureLine(e));
    }
  }

  function set(q: Question, next: Answer, forceAdvance = false) {
    setDraft(next);
    clearTimeout(timer.current);
    if (isDone(q, next) && (forceAdvance || autoAdvances(q, next))) timer.current = setTimeout(() => void finish(q, next), motion.autoAdvance);
  }

  if (question) {
    return (
      <View style={styles.screen}>
        <Wash />
        <PageHeader onBack={() => { clearTimeout(timer.current); setEditing(null); }} />
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={styles.editor}>
            <Text accessibilityRole="header" style={[type.question, styles.qTitle]}>{question.title}</Text>
            {question.sub ? <Text style={[type.sub, styles.qSub]}>{question.sub}</Text> : <View style={{ height: 18 }} />}
            <QuestionBody q={question} a={draft} set={(next, force) => set(question, next, force)} />
            {say && <Text accessibilityLiveRegion="polite" style={[type.reading, styles.say]}>{say}</Text>}
            {failure && (
              <View style={styles.say}>
                <Text style={type.reading}>{failure.text}</Text>
                {failure.canRetry && draft !== undefined && <TextAction label={copy.tryAgain} size={15} onPress={() => void finish(question, draft)} />}
              </View>
            )}
          </ScrollView>
          {needsContinue(question, draft) && (
            <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 12) + 20 }]}>
              <GoldButton label={copy.settings.answersDone} disabled={!isDone(question, draft)} onPress={() => draft !== undefined && void finish(question, draft)} />
            </View>
          )}
        </KeyboardAvoidingView>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <Wash />
      <PageHeader title={copy.settings.knows} onBack={onBack} />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.list}>
        {!signup && !failure && <LoadingHint />}
        {failure && (
          <View>
            <Text style={type.reading}>{failure.text}</Text>
            {failure.canRetry && <TextAction label={copy.tryAgain} size={15} onPress={() => void fetchSignup()} />}
          </View>
        )}
        {signup && (
          <Fade>
            {signup.questions.map((q) => (
              <Pressable key={q.key} accessibilityRole="button" onPress={() => edit(q)} style={styles.row}>
                <View style={styles.flex}>
                  <Text style={styles.title}>{q.title}</Text>
                  <Text numberOfLines={2} style={styles.summary}>{answerSummary(signup.answers[q.key])}</Text>
                </View>
                <Text style={styles.chev}>›</Text>
              </Pressable>
            ))}
          </Fade>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.base },
  flex: { flex: 1 },
  list: { paddingHorizontal: 24, paddingBottom: 60 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, paddingVertical: 13, borderTopWidth: 1, borderTopColor: ink(0.1) },
  title: { fontFamily: fonts.sans, fontSize: 15, lineHeight: 21, color: ink(0.92) },
  summary: { fontFamily: fonts.sans, fontSize: 12.5, lineHeight: 18, color: ink(0.5), marginTop: 3 },
  chev: { fontSize: 19, color: ink(0.35) },
  editor: { paddingHorizontal: space.screenX, paddingTop: 8, paddingBottom: 150 },
  qTitle: { marginBottom: 10 },
  qSub: { marginBottom: 28 },
  say: { marginTop: 22 },
  bar: { paddingTop: 14, paddingHorizontal: space.screenX },
});
