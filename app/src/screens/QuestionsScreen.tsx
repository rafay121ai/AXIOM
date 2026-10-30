import { useEffect, useRef, useState } from 'react';
import {
  Animated, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Answer, Question } from '../api/types';
import { QuestionBody } from '../components/QuestionBody';
import { GoldButton } from '../components/GoldButton';
import { failureLine } from '../copy';
import {
  autoAdvances, isDone, needsContinue, progress, startIndex,
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
  onFinish: (answers: Record<string, Answer>) => void;
};

const run = (anim: Animated.CompositeAnimation) => new Promise<void>((resolve) => anim.start(() => resolve()));

export function QuestionsScreen({ questions, answers: saved = {}, startAt, onSave, onFinish }: Props) {
  const insets = useSafeAreaInsets();
  const [index, setIndex] = useState(() => startIndex(questions, startAt));
  const [answers, setAnswers] = useState<Record<string, Answer>>(saved);
  const [refused, setRefused] = useState<string | null>(null);
  const indexRef = useRef(index);
  indexRef.current = index;
  const q = questions[index];
  const a = answers[q.key];

  const fade = useRef(new Animated.Value(1)).current;
  const slide = useRef(new Animated.Value(0)).current;
  const bar = useRef(new Animated.Value(0)).current;
  const fill = useRef(new Animated.Value(progress(index, questions.length))).current;
  const moving = useRef(false);
  // The question change under way, so a refusal that comes back meanwhile waits for it to finish.
  const travel = useRef<Promise<void>>(Promise.resolve());
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const showBar = needsContinue(q, a);
  useEffect(() => {
    Animated.timing(bar, { toValue: showBar ? 1 : 0, duration: 250, useNativeDriver: true }).start();
  }, [showBar, bar]);
  useEffect(() => {
    Animated.timing(fill, { toValue: progress(index, questions.length), duration: motion.progress, useNativeDriver: false }).start();
  }, [index, questions.length, fill]);
  useEffect(() => () => clearTimeout(timer.current), []);

  const set = (next: Answer, forceAdvance = false) => {
    setAnswers((prev) => ({ ...prev, [q.key]: next }));
    clearTimeout(timer.current);
    if (isDone(q, next) && (forceAdvance || autoAdvances(q, next))) {
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

  async function move(to: number, latest: Record<string, Answer>) {
    if (moving.current) return;
    moving.current = true;
    clearTimeout(timer.current);
    setRefused(null);
    const saving = to > index ? onSave(q.key, latest[q.key]) : undefined;
    if (to >= questions.length) {
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

  const last = index === questions.length - 1;
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
          <Text accessibilityRole="header" style={[type.question, styles.title]}>{q.title}</Text>
          {q.sub ? <Text style={[type.sub, styles.sub]}>{q.sub}</Text> : <View style={{ height: 18 }} />}
          {refused && <Text accessibilityLiveRegion="polite" style={[type.sub, styles.refused]}>{refused}</Text>}
          <QuestionBody q={q} a={a} set={set} />
        </ScrollView>
      </Animated.View>

      <Animated.View
        pointerEvents={showBar ? 'auto' : 'none'}
        style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 12) + 20, opacity: bar, transform: [{ translateY: bar.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }] }]}
      >
        <LinearGradient pointerEvents="none" colors={['rgba(5,5,5,0)', 'rgba(5,5,5,0.9)']} locations={[0, 0.45]} style={StyleSheet.absoluteFill} />
        <GoldButton label={last ? 'Done' : 'Continue'} disabled={!isDone(q, a)} onPress={() => move(index + 1, answers)} />
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
  refused: { marginBottom: 20, color: ink(0.7) },
  bar: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingTop: 14, paddingHorizontal: space.screenX },
});
