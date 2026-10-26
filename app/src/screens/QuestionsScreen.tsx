import { useEffect, useRef, useState } from 'react';
import {
  Animated, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Answer, GoalAnswer, MultiAnswer, Question, SingleAnswer, TextAnswer, TwoAnswer, WhereAnswer } from '../api/types';
import { Chip, Row } from '../components/Choice';
import { DateField } from '../components/DateField';
import { Field } from '../components/Field';
import { GoldButton } from '../components/GoldButton';
import {
  autoAdvances, countrySuggestions, isDone, isOther, needsContinue, progress, tapMulti, tapSingle, tapTwo,
} from '../onboarding/flow';
import { colors, goldGradient, ink, motion, space, type } from '../theme';

type Props = {
  questions: Question[];
  onSave: (key: string, answer: Answer) => void;
  onFinish: (answers: Record<string, Answer>) => void;
};

const run = (anim: Animated.CompositeAnimation) => new Promise<void>((resolve) => anim.start(() => resolve()));

export function QuestionsScreen({ questions, onSave, onFinish }: Props) {
  const insets = useSafeAreaInsets();
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const q = questions[index];
  const a = answers[q.key];

  const fade = useRef(new Animated.Value(1)).current;
  const slide = useRef(new Animated.Value(0)).current;
  const bar = useRef(new Animated.Value(0)).current;
  const fill = useRef(new Animated.Value(progress(0, questions.length))).current;
  const moving = useRef(false);
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

  async function move(to: number, latest: Record<string, Answer>) {
    if (moving.current) return;
    moving.current = true;
    clearTimeout(timer.current);
    if (to > index) onSave(q.key, latest[q.key]);
    if (to >= questions.length) {
      onFinish(latest);
      return;
    }
    await run(Animated.parallel([
      Animated.timing(fade, { toValue: 0, duration: motion.swapOut, useNativeDriver: true }),
      Animated.timing(slide, { toValue: to > index ? -16 : 16, duration: motion.swapOut, useNativeDriver: true }),
    ]));
    setIndex(to);
    fade.setValue(0);
    slide.setValue(to > index ? 18 : -18);
    await run(Animated.parallel([
      Animated.timing(fade, { toValue: 1, duration: motion.swapOut, useNativeDriver: true }),
      Animated.timing(slide, { toValue: 0, duration: motion.swapOut, useNativeDriver: true }),
    ]));
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
          <Body q={q} a={a} set={set} />
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

type BodyProps = { q: Question; a: Answer | undefined; set: (next: Answer, forceAdvance?: boolean) => void };

function Body({ q, a, set }: BodyProps) {
  switch (q.type) {
    case 'single': {
      const s = a as SingleAnswer | undefined;
      return (
        <View>
          {q.options.map((o) => (
            <Row key={o} label={o} selected={s?.value === o} onPress={() => set(tapSingle(a, o))} />
          ))}
          {isOther(q, a) && (
            <View style={styles.gapTop}>
              <Field placeholder="In a few words" value={s?.other ?? ''} onChangeText={(other) => set({ value: s!.value, other })} />
            </View>
          )}
        </View>
      );
    }
    case 'where': {
      const w = (a as WhereAnswer | undefined) ?? {};
      const suggestions = countrySuggestions(q.countries, w.country ?? '');
      return (
        <View>
          <Text style={[type.label, styles.label, { marginTop: 6 }]}>{q.countryLabel}</Text>
          <Field
            placeholder={q.countryPlaceholder}
            value={w.country ?? ''}
            onChangeText={(country) => set({ ...w, country })}
            autoCapitalize="words"
          />
          {suggestions.length > 0 && (
            <View style={[styles.chips, styles.gapTop]}>
              {suggestions.map((c) => <Chip key={c} label={c} selected={false} onPress={() => set({ ...w, country: c })} />)}
            </View>
          )}
          <Text style={[type.label, styles.label]}>{q.customerLabel}</Text>
          <View style={styles.chips}>
            {q.customers.map((c) => (
              <Chip key={c} label={c} selected={w.customers === c} onPress={() => set({ ...w, customers: c }, true)} />
            ))}
          </View>
        </View>
      );
    }
    case 'goal': {
      const g = (a as GoalAnswer | undefined) ?? {};
      return (
        <View>
          <View style={styles.chips}>
            {q.goals.map((o) => <Chip key={o} label={o} selected={g.goal === o} onPress={() => set({ ...g, goal: o })} />)}
          </View>
          <Text style={[type.label, styles.label]}>{q.whenLabel}</Text>
          <View style={styles.chips}>
            {q.whens.map((o) => <Chip key={o} label={o} selected={g.when === o} onPress={() => set({ ...g, when: o })} />)}
          </View>
          {g.when === q.dateOption && (
            <View style={{ marginTop: 16 }}>
              <DateField value={g.date} onChange={(date) => set({ ...g, date })} />
            </View>
          )}
        </View>
      );
    }
    case 'two': {
      const t = (a as TwoAnswer | undefined) ?? { a: [], b: [] };
      return (
        <View>
          {q.groups.map((group, n) => (
            <View key={group.label}>
              <Text style={[type.label, styles.label, n === 0 && { marginTop: 2 }]}>{group.label}</Text>
              <View style={styles.chips}>
                {group.options.map((o) => (
                  <Chip key={o} label={o} selected={(n === 0 ? t.a : t.b).includes(o)} onPress={() => set(tapTwo(a, n as 0 | 1, o))} />
                ))}
              </View>
            </View>
          ))}
        </View>
      );
    }
    case 'multi': {
      const list = (a as MultiAnswer | undefined) ?? [];
      return (
        <View>
          {q.options.map((o) => (
            <Row key={o} multi label={o} selected={list.includes(o)} onPress={() => set(tapMulti(q, a, o))} />
          ))}
        </View>
      );
    }
    case 'text': {
      const v = (a as TextAnswer | undefined) ?? '';
      return (
        <View>
          <TextInput
            multiline
            value={v}
            onChangeText={set}
            placeholder={q.placeholder}
            placeholderTextColor={ink(0.28)}
            style={[type.big, styles.big]}
            textAlignVertical="top"
          />
          <Text style={styles.shortHint}>{v.trim().length >= q.minLength ? '' : q.shortHint}</Text>
        </View>
      );
    }
  }
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
  label: { marginTop: 28, marginBottom: 12 },
  gapTop: { marginTop: 22 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
  bar: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingTop: 14, paddingHorizontal: space.screenX },
  big: {
    minHeight: 210, paddingVertical: 18, paddingHorizontal: 2, borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.line,
    ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null),
  },
  shortHint: { fontFamily: type.sub.fontFamily, fontSize: 12, color: ink(0.4), marginTop: 10, minHeight: 16 },
});
