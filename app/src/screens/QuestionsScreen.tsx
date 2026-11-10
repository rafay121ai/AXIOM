import { useEffect, useRef, useState } from 'react';
import {
  Animated, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Answer, Question, Screened } from '../api/types';
import { Chip } from '../components/Choice';
import { Field } from '../components/Field';
import { QuestionBody } from '../components/QuestionBody';
import { TextAction } from '../components/TextAction';
import { GoldButton } from '../components/GoldButton';
import { copy, failureLine } from '../copy';
import {
  autoAdvances, birthdayDone, daysIn, isDone, LEAD_STEPS, MONTHS, needsContinue, pickMonth, progressAt, SKIP, startIndex,
  type Birthday,
} from '../onboarding/flow';
import { colors, goldGradient, ink, motion, space, type } from '../theme';

type Props = {
  questions: Question[];
  /** What the founder answered before, when they come back part way. */
  answers?: Record<string, Answer>;
  /** The key of the first question not answered yet: the screen starts there. */
  startAt?: string | null;
  /** Resolves when the server has the answer (it waits out a bad connection); rejects when the server refuses it. */
  onSave: (key: string, answer: Answer) => Promise<void>;
  /** The name screen and the birthday screen come first when the founder has answered nothing yet. */
  signInName?: string;
  onSaveName: (name: string) => Promise<void>;
  onSaveBirthday: (month: number, day: number) => Promise<void>;
  onFinish: (answers: Record<string, Answer>) => void;
};

const run = (anim: Animated.CompositeAnimation) => new Promise<void>((resolve) => anim.start(() => resolve()));

export function QuestionsScreen({ questions, answers: saved = {}, startAt, signInName, onSave, onSaveName, onSaveBirthday, onFinish }: Props) {
  const insets = useSafeAreaInsets();
  // Name and birthday come before question 1, and only for a founder starting from nothing.
  const [lead] = useState(() => (Object.keys(saved).length === 0 && startIndex(questions, startAt) === 0 ? LEAD_STEPS : 0));
  const [index, setIndex] = useState(() => lead + startIndex(questions, startAt));
  const [name, setName] = useState(signInName ?? '');
  const [birthday, setBirthday] = useState<Birthday>({});
  const [answers, setAnswers] = useState<Record<string, Answer>>(saved);
  const [refused, setRefused] = useState<string | null>(null);
  const indexRef = useRef(index);
  indexRef.current = index;
  const q: Question | undefined = questions[index - lead];
  const a = q ? answers[q.key] : undefined;
  const onName = index === 0 && lead > 0;

  const fade = useRef(new Animated.Value(1)).current;
  const slide = useRef(new Animated.Value(0)).current;
  const bar = useRef(new Animated.Value(0)).current;
  const fill = useRef(new Animated.Value(progressAt(index, lead, questions.length))).current;
  const moving = useRef(false);
  // The question change under way, so a refusal that comes back meanwhile waits for it to finish.
  const travel = useRef<Promise<void>>(Promise.resolve());
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const showBar = q ? needsContinue(q, a) : true;
  useEffect(() => {
    Animated.timing(bar, { toValue: showBar ? 1 : 0, duration: 250, useNativeDriver: true }).start();
  }, [showBar, bar]);
  useEffect(() => {
    Animated.timing(fill, { toValue: progressAt(index, lead, questions.length), duration: motion.progress, useNativeDriver: false }).start();
  }, [index, lead, questions.length, fill]);
  useEffect(() => () => clearTimeout(timer.current), []);

  const set = (next: Answer, forceAdvance = false) => {
    if (!q) return;
    setAnswers((prev) => ({ ...prev, [q.key]: next }));
    clearTimeout(timer.current);
    if (q && isDone(q, next) && (forceAdvance || autoAdvances(q, next))) {
      timer.current = setTimeout(() => move(index + 1, { ...answers, [q.key]: next }), motion.autoAdvance);
    }
  };

  // The old question slides out and the new one in.
  async function show(to: number, from: number) {
    await run(Animated.parallel([
      Animated.timing(fade, { toValue: 0, duration: motion.swapOut, useNativeDriver: true }),
      Animated.timing(slide, { toValue: to > from ? -16 : 16, duration: motion.swapOut, useNativeDriver: true }),
    ]));
    setIndex(to);
    fade.setValue(0);
    slide.setValue(to > from ? 18 : -18);
    await run(Animated.parallel([
      Animated.timing(fade, { toValue: 1, duration: motion.swapOut, useNativeDriver: true }),
      Animated.timing(slide, { toValue: 0, duration: motion.swapOut, useNativeDriver: true }),
    ]));
  }

  // The server refused an answer for good: say so in plain words and put the founder back on that question.
  async function refuse(from: number, e: unknown) {
    await travel.current;
    setRefused(failureLine(e, 'save').text);
    if (indexRef.current !== from) await show(from, indexRef.current);
    moving.current = false;
  }

  // What the current screen sends when the founder goes on.
  function saveStep(latest: Record<string, Answer>): Promise<void> | undefined {
    if (q) return onSave(q.key, latest[q.key]);
    if (onName) return onSaveName(name.trim());
    return birthdayDone(birthday) ? onSaveBirthday(birthday.month!, birthday.day!) : undefined;
  }

  async function move(to: number, latest: Record<string, Answer>, skipSave = false) {
    if (moving.current) return;
    moving.current = true;
    clearTimeout(timer.current);
    setRefused(null);
    const saving = to > index && !skipSave ? saveStep(latest) : undefined;
    if (to - lead >= questions.length) {
      // The reading needs every answer, so the last one is confirmed before the wait begins.
      try {
        await saving;
      } catch (e) {
        return refuse(index, e);
      }
      onFinish(latest);
      return;
    }
    saving?.catch((e) => refuse(index, e));
    travel.current = show(to, index);
    await travel.current;
    moving.current = false;
  }

  const sub = q ? q.sub : onName ? undefined : copy.onboarding.birthdaySub;
  const skippable = q ? q.type === 'text' && q.optional : !onName;

  // An optional written question is stored as skipped; the birthday is simply not sent.
  const skip = () => (q ? set(SKIP, true) : move(index + 1, answers, true));

  const last = index - lead === questions.length - 1;
  const canGo = q ? isDone(q, a) : onName ? name.trim().length > 0 : birthdayDone(birthday);
  const width = fill.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] });

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
      <View style={[styles.head, { paddingTop: insets.top + 12 }]}>
        <Pressable
          onPress={() => move(index - 1, answers)}
          accessibilityRole="button"
          accessibilityLabel="Back"
          style={[styles.back, index === 0 && styles.hidden]}
          disabled={index === 0}
          hitSlop={8}
        >
          <Text style={styles.backGlyph}>‹</Text>
        </Pressable>
      </View>
      <View style={styles.prog}>
        <Animated.View style={{ width, height: 2, marginTop: -0.5 }}>
          <LinearGradient colors={goldGradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill} />
        </Animated.View>
      </View>

      <Animated.View style={[styles.flex, { opacity: fade, transform: [{ translateX: slide }] }]}>
        <ScrollView
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.body}
        >
          <Text accessibilityRole="header" style={[type.question, styles.title]}>{q ? q.title : onName ? copy.onboarding.nameTitle : copy.onboarding.birthdayTitle}</Text>
          {sub ? <Text style={[type.sub, styles.sub]}>{sub}</Text> : <View style={{ height: 18 }} />}
          {refused && <Text accessibilityLiveRegion="polite" style={[type.sub, styles.refused]}>{refused}</Text>}
          {q && <QuestionBody q={q} a={a} set={set} />}
          {!q && onName && <Field autoFocus value={name} onChangeText={setName} autoCapitalize="words" autoComplete="given-name" textContentType="givenName" />}
          {!q && !onName && (
            <View>
              <View style={styles.chips}>
                {MONTHS.map((m, n) => <Chip key={m} label={m} selected={birthday.month === n + 1} onPress={() => setBirthday((b) => pickMonth(b, n + 1))} />)}
              </View>
              {birthday.month !== undefined && (
                <View style={[styles.chips, styles.days]}>
                  {Array.from({ length: daysIn(birthday.month) }, (_, n) => n + 1).map((d) => (
                    <Chip key={d} label={String(d)} selected={birthday.day === d} onPress={() => setBirthday((b) => ({ ...b, day: d }))} />
                  ))}
                </View>
              )}
            </View>
          )}
          {skippable && <TextAction label={copy.onboarding.skip} size={15} onPress={skip} />}
        </ScrollView>
      </Animated.View>

      <Animated.View
        pointerEvents={showBar ? 'auto' : 'none'}
        style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 12) + 20, opacity: bar, transform: [{ translateY: bar.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }] }]}
      >
        <LinearGradient pointerEvents="none" colors={['rgba(5,5,5,0)', 'rgba(5,5,5,0.9)']} locations={[0, 0.45]} style={StyleSheet.absoluteFill} />
        <GoldButton label={last ? 'Done' : 'Continue'} disabled={!canGo} onPress={() => move(index + 1, answers)} />
      </Animated.View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  head: { paddingHorizontal: space.screenX, flexDirection: 'row', alignItems: 'center' },
  back: { width: 44, height: 44, marginLeft: -7, alignItems: 'center', justifyContent: 'center' },
  backGlyph: { color: ink(0.7), fontSize: 26, lineHeight: 30 },
  hidden: { opacity: 0 },
  prog: { height: 1, backgroundColor: colors.line, marginHorizontal: space.screenX, marginTop: 6 },
  body: { paddingHorizontal: space.screenX, paddingTop: space.qTop, paddingBottom: 150 },
  title: { marginBottom: 10 },
  sub: { marginBottom: 28 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
  days: { marginTop: 22 },
  refused: { marginBottom: 20, color: ink(0.7) },
  bar: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingTop: 14, paddingHorizontal: space.screenX },
});
