import { useFonts } from 'expo-font';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { api } from './src/api';
import type { Answer, DueReport, FirstReading, CareHelp, Home, Question, Screened } from './src/api/types';
import { SignInCancelled } from './src/auth/oauth';
import { routeScreened } from './src/care/route';
import { copy } from './src/copy';
import { type Destination, destinationOf, type MoveSource } from './src/home/flow';
import { newLearnChat, type LearnChat } from './src/learn/chat';
import { deviceTimeZone } from './src/move/format';
import { push } from './src/push';
import { chatFromTurns, newChat, type Chat } from './src/situation/chat';
import { AxiomMessage } from './src/components/AxiomMessage';
import { Glow } from './src/components/Glow';
import { loadReading } from './src/onboarding/reading';
import { LINE_EVERY, waitLines, waitMinMs } from './src/onboarding/waitLines';
import { CareScreen } from './src/screens/CareScreen';
import { HistoryScreen } from './src/screens/HistoryScreen';
import { HomeScreen } from './src/screens/HomeScreen';
import { PastScreen } from './src/screens/PastScreen';
import { AnswersScreen } from './src/screens/AnswersScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { LearnScreen } from './src/screens/LearnScreen';
import { MoveScreen } from './src/screens/MoveScreen';
import { ReportScreen } from './src/screens/ReportScreen';
import { QuestionsScreen } from './src/screens/QuestionsScreen';
import { ReadingScreen } from './src/screens/ReadingScreen';
import { ReadScreen } from './src/screens/ReadScreen';
import { SignInScreen } from './src/screens/SignInScreen';
import { SituationScreen } from './src/screens/SituationScreen';
import { WaitScreen } from './src/screens/WaitScreen';
import { colors, motion, fontFiles, space } from './src/theme';

type Stage =
  | { name: 'signin' }
  | { name: 'questions'; questions: Question[]; answers: Record<string, Answer>; startAt: string | null }
  | { name: 'wait'; lines: string[] }
  | { name: 'reading'; reading: FirstReading }
  | { name: 'situation'; chat: Chat; opening: string; suggestion?: string }
  | { name: 'read'; situationId: string }
  | { name: 'learn'; situationId: string; chat: LearnChat }
  | { name: 'move'; source: MoveSource; back: Stage }
  | { name: 'home'; menu?: boolean }
  | { name: 'history' }
  | { name: 'past'; id: string }
  | { name: 'settings' }
  | { name: 'answers'; startAt?: string }
  | { name: 'report'; report: DueReport; next: DueReport[] }
  | { name: 'care'; message: string; help: CareHelp; back: Stage };

// Screens with the faint gold wash instead of the drifting light.
const QUIET: Stage['name'][] = ['home', 'history', 'past', 'settings', 'answers'];

const run = (anim: Animated.CompositeAnimation) => new Promise<void>((resolve) => anim.start(() => resolve()));

export default function App() {
  const [fontsReady] = useFonts(fontFiles);
  const [stage, setStage] = useState<Stage>({ name: 'signin' });
  const [soft, setSoft] = useState<string | null>(null);
  const stuck = useRef<string | undefined>(undefined);
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

  // Resolves once no screen change is under way. A change asked for while one is running is dropped, so a caller that
  // moves on by itself (the home screen sending a due check-in to the Report) waits for this first.
  const idle = useCallback(async () => {
    while (switching.current) await new Promise((resume) => setTimeout(resume, 50));
  }, []);

  // Care is never dropped: a reply that lands mid-transition waits for the screen to settle first.
  const showCare = useCallback(async (message: string, help: CareHelp) => {
    await idle();
    goTo({ name: 'care', message, help, back: stageRef.current }, true);
  }, [goTo, idle]);

  // Every text-sending call lands here: clear distress opens the care screen, unclear gets a soft reply.
  const route = useCallback((res: Screened) => {
    const r = routeScreened(res);
    setSoft(r.kind === 'unclear' ? r.reply : null);
    if (r.kind === 'care') void showCare(r.message, r.help);
  }, [showCare]);

  // The first situation offers what the founder said they were stuck on; a later one starts from a blank question.
  const beginSituation = useCallback((fresh: boolean) => {
    const suggestion = fresh ? undefined : stuck.current;
    goTo({ name: 'situation', chat: newChat(), opening: suggestion ? copy.situation.opening : copy.situation.openingFresh, suggestion });
  }, [goTo]);

  // The check-ins waiting, the one due first; when none is left the founder lands on the home screen.
  const openReports = useCallback((due: DueReport[]) => {
    const [report, ...next] = due;
    if (report) goTo({ name: 'report', report, next });
    else goTo({ name: 'home' });
  }, [goTo]);

  // Signing in lands a returning founder on the home screen; a due check-in (the evening reminder's target) opens the Report.
  // A new founder, or one who stopped part way, goes to the questions.
  const landing = useRef(false);
  const openSignup = useCallback(async () => {
    await api.resumeUnsent();
    const signup = await api.getSignup();
    landing.current = signup.complete;
    goTo(signup.complete ? { name: 'home' } : { name: 'questions', questions: signup.questions, answers: signup.answers, startAt: signup.next });
  }, [goTo]);

  // A closed browser leaves the founder on the sign-in screen with nothing said; any other failure says so once.
  const [signInError, setSignInError] = useState<string>();
  const signIn = useCallback(async () => {
    setSignInError(undefined);
    try {
      await api.signInWithGoogle();
    } catch (e) {
      if (!(e instanceof SignInCancelled)) setSignInError(copy.signInFailed);
      return;
    }
    await openSignup();
  }, [openSignup]);

  // A founder already signed in on this device skips the sign-in screen, so the film only ever plays before sign-up.
  // Nothing shows until this is known; if the check or the landing fails, the sign-in screen is the safe place to be.
  const [checked, setChecked] = useState(false);
  useEffect(() => {
    api.isSignedIn()
      .then((yes) => (yes ? openSignup() : undefined))
      .catch(() => {})
      .finally(() => setChecked(true));
  }, [openSignup]);

  const homeLoaded = useCallback(async (home: Home) => {
    void push.refresh().catch(() => {});
    const arriving = landing.current;
    landing.current = false;
    if (!arriving || home.due_reports.length === 0) return;
    const due = (await api.getDueReports()).filter((r) => r.due);
    await idle();
    openReports(due);
  }, [openReports, idle]);

  // This phone stops getting this founder's reminders, then the sign-in comes back.
  const signOut = useCallback(async () => {
    await push.release().catch(() => {});
    await api.signOut();
    goTo({ name: 'signin' });
  }, [goTo]);

  // Where a tap on a home item, a menu row or a history action leads.
  const openDestination = useCallback((d: Destination) => {
    switch (d.kind) {
      case 'situation': return goTo({ name: 'situation', chat: chatFromTurns(d.situationId, d.turns), opening: copy.situation.openingFresh });
      case 'read': return goTo({ name: 'read', situationId: d.situationId });
      case 'learn': return goTo({ name: 'learn', situationId: d.situationId, chat: newLearnChat() });
      case 'move': return goTo({ name: 'move', source: d.source, back: stageRef.current });
      case 'report': return goTo({ name: 'report', report: d.report, next: d.next });
      case 'home': return goTo({ name: 'home' });
    }
  }, [goTo]);

  const finish = useCallback((answers: Record<string, Answer>) => {
    stuck.current = typeof answers.stuck === 'string' ? answers.stuck.trim() || undefined : undefined;
    const lines = waitLines((answers.building as string | undefined) ?? '');
    goTo({ name: 'wait', lines });
    loadReading(() => api.getFirstReading(), { minMs: waitMinMs(lines), retryMs: LINE_EVERY })
      .then((reading) => goTo({ name: 'reading', reading }), openSignup);
  }, [goTo, openSignup]);

  if (!fontsReady || !checked) return <View style={styles.page} />;

  return (
    <SafeAreaProvider>
      <View style={styles.page}>
        <View style={styles.phone}>
          {stage.name !== 'care' && stage.name !== 'signin' && !QUIET.includes(stage.name) && <Glow />}
          <Animated.View style={[styles.flex, { opacity: fade, transform: [{ translateY: rise }] }]}>
            {stage.name === 'signin' && <SignInScreen onContinue={signIn} error={signInError} />}
            {stage.name === 'questions' && (
              <QuestionsScreen
                questions={stage.questions}
                answers={stage.answers}
                startAt={stage.startAt}
                onSave={async (k, a) => route(await api.saveAnswer(k, a))}
                onFinish={finish}
              />
            )}
            {stage.name === 'care' && (
              <CareScreen message={stage.message} help={stage.help} onKeepTalking={() => { setSoft(null); goTo(stage.back, true); }} />
            )}
            {soft && stage.name !== 'care' && <View style={styles.soft}><AxiomMessage text={soft} /></View>}
            {stage.name === 'wait' && <WaitScreen lines={stage.lines} />}
            {stage.name === 'situation' && (
              <SituationScreen
                chat={stage.chat}
                opening={stage.opening}
                suggestion={stage.suggestion}
                send={(id, text, turnId) => (id ? api.sendTurn(id, text, turnId) : api.startSituation(text, turnId))}
                onReady={(situationId) => goTo({ name: 'read', situationId })}
                onCare={showCare}
                onMenu={() => goTo({ name: 'home', menu: true })}
              />
            )}
            {stage.name === 'read' && (
              <ReadScreen
                loadRead={() => api.getRead(stage.situationId)}
                answer={(a) => api.answerRead(stage.situationId, a)}
                onAnswered={() => goTo({ name: 'learn', situationId: stage.situationId, chat: newLearnChat() })}
                onSomethingElse={() => beginSituation(true)}
                onCare={showCare}
                onMenu={() => goTo({ name: 'home', menu: true })}
              />
            )}
            {stage.name === 'learn' && (
              <LearnScreen
                chat={stage.chat}
                start={() => api.startLearn(stage.situationId)}
                send={(id, text, turnId) => api.sendLearnTurn(id, text, turnId)}
                tap={(id, turnId, index) => api.tapFollowUp(id, turnId, index)}
                loadHint={(seed) => api.getLoadingHint(seed)}
                onOpenMove={(learnId) => goTo({ name: 'move', source: { learnId }, back: stageRef.current })}
                onCare={showCare}
                onMenu={() => goTo({ name: 'home', menu: true })}
              />
            )}
            {stage.name === 'move' && (
              <MoveScreen
                open={() => ('learnId' in stage.source ? api.openMove(stage.source.learnId) : api.getMove(stage.source.moveId))}
                commit={(id, timezone) => api.commitMove(id, timezone)}
                swap={(id, reason) => api.swapMove(id, reason)}
                loadHint={(seed) => api.getLoadingHint(seed)}
                push={push}
                onClose={() => goTo(stage.back)}
                onDone={() => goTo({ name: 'home' })}
                onCare={showCare}
              />
            )}
            {stage.name === 'report' && (
              <ReportScreen
                key={stage.report.move_id}
                report={stage.report}
                send={(outcome, note, turnId) => api.sendReport(stage.report.move_id, outcome, note, turnId)}
                story={(id) => api.getStory(id)}
                consent={(id, share, version) => api.setConsent(id, share, version)}
                onFinish={() => openReports(stage.next)}
                onCare={showCare}
              />
            )}
            {stage.name === 'home' && (
              <HomeScreen
                load={() => api.getHome(deviceTimeZone())}
                checkIn={(text) => api.sendCheckIn(text)}
                onLoaded={homeLoaded}
                onStart={(text) => goTo({ name: 'situation', chat: newChat({ pending: text }), opening: copy.situation.openingFresh })}
                onOpen={async (target) => openDestination(await destinationOf(api, target))}
                onPast={(id) => goTo({ name: 'past', id })}
                onHistory={() => goTo({ name: 'history' })}
                onSettings={() => goTo({ name: 'settings' })}
                onCare={showCare}
                menuOpen={stage.menu}
              />
            )}
            {stage.name === 'history' && (
              <HistoryScreen load={(q) => api.getHistory(q)} onOpen={(id) => goTo({ name: 'past', id })} onBack={() => goTo({ name: 'home' })} />
            )}
            {stage.name === 'past' && (
              <PastScreen
                key={stage.id}
                load={() => api.getHistoryPage(stage.id)}
                withdraw={async (reportId) => (await api.withdrawShare(reportId)).reply ?? copy.history.private}
                onAction={async (target) => openDestination(await destinationOf(api, target))}
                onBack={() => goTo({ name: 'history' })}
              />
            )}
            {stage.name === 'settings' && (
              <SettingsScreen
                load={() => api.getSettings()}
                save={(patch) => api.updateSettings(patch)}
                requestExport={() => api.requestExport()}
                requestDelete={() => api.requestDelete()}
                cancelDelete={() => api.cancelDelete()}
                onEditAnswers={(startAt) => goTo({ name: 'answers', startAt })}
                onSignOut={signOut}
                onBack={() => goTo({ name: 'home' })}
              />
            )}
            {stage.name === 'answers' && (
              <AnswersScreen
                key={stage.startAt ?? 'all'}
                load={() => api.getSignup()}
                save={(key, answer) => api.saveAnswer(key, answer)}
                startAt={stage.startAt}
                onBack={() => goTo({ name: 'settings' })}
                onCare={showCare}
              />
            )}
            {stage.name === 'reading' && <ReadingScreen reading={stage.reading} onContinue={() => beginSituation(false)} />}
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
