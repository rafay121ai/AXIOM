import { useFonts } from 'expo-font';
import { useCallback, useRef, useState } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { api } from './src/api';
import type { Answer, FirstReading, HelpLine, Question, Screened } from './src/api/types';
import { routeScreened } from './src/care/route';
import { AxiomMessage } from './src/components/AxiomMessage';
import { Glow } from './src/components/Glow';
import { loadReading } from './src/onboarding/reading';
import { LINE_EVERY, waitLines, waitMinMs } from './src/onboarding/waitLines';
import { CareScreen } from './src/screens/CareScreen';
import { QuestionsScreen } from './src/screens/QuestionsScreen';
import { ReadingScreen } from './src/screens/ReadingScreen';
import { SignInScreen } from './src/screens/SignInScreen';
import { WaitScreen } from './src/screens/WaitScreen';
import { colors, motion, serifFiles, space } from './src/theme';

type Stage =
  | { name: 'signin' }
  | { name: 'questions'; questions: Question[] }
  | { name: 'wait'; lines: string[] }
  | { name: 'reading'; reading: FirstReading }
  | { name: 'situation' }
  | { name: 'care'; message: string; help: HelpLine[]; back: Stage };

const run = (anim: Animated.CompositeAnimation) => new Promise<void>((resolve) => anim.start(() => resolve()));

export default function App() {
  const [fontsReady] = useFonts(serifFiles);
  const [stage, setStage] = useState<Stage>({ name: 'signin' });
  const [soft, setSoft] = useState<string | null>(null);
  const stageRef = useRef(stage);
  stageRef.current = stage;
  const fade = useRef(new Animated.Value(1)).current;
  const rise = useRef(new Animated.Value(0)).current;
  const switching = useRef(false);

  // The old screen fades and slides out, the new one slides in.
  const goTo = useCallback(async (next: Stage, instant = false) => {
    if (switching.current) return;
    switching.current = true;
    if (instant) {
      setStage(next);
      switching.current = false;
      return;
    }
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

  // Every text-sending call lands here: clear distress opens the care screen, unclear gets a soft reply.
  const route = useCallback((res: Screened) => {
    const r = routeScreened(res);
    setSoft(r.kind === 'unclear' ? r.reply : null);
    if (r.kind === 'care') goTo({ name: 'care', message: r.message, help: r.help, back: stageRef.current }, true);
  }, [goTo]);

  const signIn = useCallback(async () => {
    await api.signInWithGoogle();
    goTo({ name: 'questions', questions: await api.getQuestions() });
  }, [goTo]);

  const finish = useCallback((answers: Record<string, Answer>) => {
    const lines = waitLines((answers.building as string | undefined) ?? '');
    goTo({ name: 'wait', lines });
    loadReading(() => api.getFirstReading(), { minMs: waitMinMs(lines), retryMs: LINE_EVERY })
      .then((reading) => goTo({ name: 'reading', reading }));
  }, [goTo]);

  if (!fontsReady) return <View style={styles.page} />;

  return (
    <SafeAreaProvider>
      <View style={styles.page}>
        <View style={styles.phone}>
          {stage.name !== 'care' && <Glow />}
          <Animated.View style={[styles.flex, { opacity: fade, transform: [{ translateY: rise }] }]}>
            {stage.name === 'signin' && <SignInScreen onContinue={signIn} />}
            {stage.name === 'questions' && (
              <QuestionsScreen questions={stage.questions} onSave={async (k, a) => route(await api.saveAnswer(k, a))} onFinish={finish} />
            )}
            {stage.name === 'care' && (
              <CareScreen message={stage.message} help={stage.help} onKeepTalking={() => { setSoft(null); goTo(stage.back, true); }} />
            )}
            {soft && stage.name !== 'care' && <View style={styles.soft}><AxiomMessage text={soft} /></View>}
            {stage.name === 'wait' && <WaitScreen lines={stage.lines} />}
            {stage.name === 'reading' && <ReadingScreen reading={stage.reading} onContinue={() => goTo({ name: 'situation' })} />}
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
  soft: { position: 'absolute', left: space.screenX, right: space.screenX, bottom: 48 },
});
