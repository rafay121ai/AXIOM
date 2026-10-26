import { useCallback, useRef, useState } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { api } from './src/api';
import type { Answer, Question } from './src/api/types';
import { Glow } from './src/components/Glow';
import { waitLines } from './src/onboarding/waitLines';
import { QuestionsScreen } from './src/screens/QuestionsScreen';
import { SignInScreen } from './src/screens/SignInScreen';
import { WaitScreen } from './src/screens/WaitScreen';
import { colors, motion } from './src/theme';

type Stage = { name: 'signin' } | { name: 'questions'; questions: Question[] } | { name: 'wait'; lines: string[] };

const run = (anim: Animated.CompositeAnimation) => new Promise<void>((resolve) => anim.start(() => resolve()));

export default function App() {
  const [stage, setStage] = useState<Stage>({ name: 'signin' });
  const fade = useRef(new Animated.Value(1)).current;
  const rise = useRef(new Animated.Value(0)).current;
  const switching = useRef(false);

  // The old screen fades and slides out, the new one slides in.
  const goTo = useCallback(async (next: Stage) => {
    if (switching.current) return;
    switching.current = true;
    await run(Animated.parallel([
      Animated.timing(fade, { toValue: 0, duration: motion.screenOut, useNativeDriver: true }),
      Animated.timing(rise, { toValue: -8, duration: motion.screenOut, useNativeDriver: true }),
    ]));
    setStage(next);
    rise.setValue(8);
    await run(Animated.parallel([
      Animated.timing(fade, { toValue: 1, duration: motion.screenIn, useNativeDriver: true }),
      Animated.timing(rise, { toValue: 0, duration: motion.screenIn, useNativeDriver: true }),
    ]));
    switching.current = false;
  }, [fade, rise]);

  const signIn = useCallback(async () => {
    await api.signInWithGoogle();
    goTo({ name: 'questions', questions: await api.getQuestions() });
  }, [goTo]);

  const finish = useCallback((answers: Record<string, Answer>) => {
    goTo({ name: 'wait', lines: waitLines((answers.building as string | undefined) ?? '') });
  }, [goTo]);

  return (
    <SafeAreaProvider>
      <View style={styles.page}>
        <View style={styles.phone}>
          <Glow />
          <Animated.View style={[styles.flex, { opacity: fade, transform: [{ translateY: rise }] }]}>
            {stage.name === 'signin' && <SignInScreen onContinue={signIn} />}
            {stage.name === 'questions' && (
              <QuestionsScreen questions={stage.questions} onSave={(k, a) => api.saveAnswer(k, a)} onFinish={finish} />
            )}
            {stage.name === 'wait' && <WaitScreen lines={stage.lines} />}
          </Animated.View>
        </View>
      </View>
      <StatusBar style="light" />
    </SafeAreaProvider>
  );
}

// On a computer: a centred phone-width column, the same on every device.
const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.base, alignItems: 'center' },
  phone: { flex: 1, width: '100%', maxWidth: 430, backgroundColor: colors.base, overflow: 'hidden' },
  flex: { flex: 1 },
});
