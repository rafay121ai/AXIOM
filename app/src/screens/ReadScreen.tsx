import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { sendUntilDelivered } from '../api/delivery';
import type { CareHelp, Read, ReadAnswer, ReadAnswerResult, Screened } from '../api/types';
import { routeScreened } from '../care/route';
import { Composer } from '../components/Composer';
import { Fade } from '../components/Fade';
import { LoadingHint } from '../components/LoadingHint';
import { MENU_BAR, MenuBar } from '../components/MenuMark';
import { useFollowScroll } from '../components/useFollowScroll';
import { TextAction } from '../components/TextAction';
import { copy, failureLine } from '../copy';
import { paragraphs } from '../situation/read';
import { colors, ink, type } from '../theme';

type Props = {
  loadRead: () => Promise<Read>;
  answer: (answer: ReadAnswer) => Promise<Screened<ReadAnswerResult>>;
  /** The question was answered or skipped: on to Learn. */
  onAnswered: () => void;
  /** "Something else on my mind": a new situation. */
  onSomethingElse: () => void;
  onCare: (message: string, help: CareHelp) => void;
  /** The menu button: home, with the menu open. The situation stays open. */
  onMenu: () => void;
};

const FIRST = 500;
const STEP = 1500;
const HAND_ON_MS = 1100;

type Line = { id: number; who: 'me' | 'ax'; text: string };

// The Read: the finding as a headline, two short paragraphs, then one question set apart by a hairline.
// No Continue: answering the question, or skipping it, is what moves on. After an answer Axiom may ask
// up to 2 more questions here (the server decides), then Learn.
export function ReadScreen({ loadRead, answer, onAnswered, onSomethingElse, onCare, onMenu }: Props) {
  const insets = useSafeAreaInsets();
  const [read, setRead] = useState<Read | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [offline, setOffline] = useState(false);
  const [failure, setFailure] = useState<{ text: string; canRetry: boolean; retry: () => void } | null>(null);
  const [handingOn, setHandingOn] = useState(false);
  const live = useRef(true);
  // The screen asks for the Read once, however often its parent redraws.
  const latest = useRef({ loadRead, onAnswered });
  latest.current = { loadRead, onAnswered };
  const nextId = useRef(1);
  const follow = useFollowScroll(insets.top + MENU_BAR);
  useEffect(() => () => { live.current = false; }, []);

  const options = useCallback(() => ({
    onWaiting: (w: boolean) => { if (live.current) setOffline(w); },
    cancelled: () => !live.current,
  }), []);

  const load = useCallback(async () => {
    setFailure(null);
    try {
      const got = await sendUntilDelivered(() => latest.current.loadRead(), options());
      if (!live.current) return;
      if (got.answered) latest.current.onAnswered();
      else {
        setRead(got);
        setLines((got.talk ?? []).map((t) => ({ id: nextId.current++, who: t.role === 'founder' ? 'me' : 'ax', text: t.text })));
      }
    } catch (e) {
      if (live.current) setFailure({ ...failureLine(e, 'read'), retry: () => void load() });
    }
  }, [options]);
  useEffect(() => { void load(); }, [load]);

  async function reply(what: ReadAnswer, shown?: Line) {
    setBusy(true);
    setFailure(null);
    try {
      const res = await sendUntilDelivered(() => answer(what), options());
      if (!live.current) return;
      const route = routeScreened(res);
      if (route.kind === 'care') {
        setLines((all) => all.filter((l) => l !== shown));
        onCare(route.message, route.help);
        return;
      }
      if (route.kind === 'unclear') {
        setLines((all) => [...all, { id: nextId.current++, who: 'ax', text: route.reply }]);
        return;
      }
      if (res.care) return;
      if (res.status === 'say_more' || res.status === 'talk') {
        setLines((all) => [...all, { id: nextId.current++, who: 'ax', text: res.reply }]);
        return;
      }
      setHandingOn(true);
      await new Promise((resume) => setTimeout(resume, HAND_ON_MS));
      if (live.current) onAnswered();
    } catch (e) {
      if (live.current) setFailure({ ...failureLine(e), retry: () => void reply(what, shown) });
    } finally {
      if (live.current) setBusy(false);
    }
  }

  function submit() {
    const said = text.trim();
    if (!said || busy || handingOn) return;
    const shown: Line = { id: nextId.current++, who: 'me', text: said };
    setLines((all) => [...all, shown]);
    setText('');
    void reply({ text: said }, shown);
  }

  const paras = useMemo(() => (read ? paragraphs(read.body) : []), [read]);
  const parts = paras.length + 2; // headline, paragraphs, question
  const at = (n: number) => FIRST + n * STEP;

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
      <ScrollView
        ref={follow.ref}
        onLayout={follow.onLayout}
        onContentSizeChange={follow.onContentSizeChange}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.content, { paddingTop: insets.top + MENU_BAR }]}
      >
        {!read && !failure && <LoadingHint />}
        {read && (
          <View onLayout={lines.length === 0 ? follow.newest(true) : undefined}>
            <Fade delay={at(0)} style={styles.head}>
              <Text accessibilityRole="header" style={type.readingHead}>{read.headline}</Text>
            </Fade>
            {paras.map((p, n) => (
              <Fade key={n} delay={at(n + 1)} style={styles.para}>
                <Text style={type.readBody}>{p}</Text>
              </Fade>
            ))}
            <Fade delay={at(parts - 1)} style={styles.next}>
              <Text style={type.readNext}>{read.closing_question}</Text>
            </Fade>
          </View>
        )}
        {lines.map((l, n) => (
          <View key={l.id} onLayout={n === lines.length - 1 ? follow.newest(l.who === 'ax') : undefined}>
            {l.who === 'me' ? (
              <Text style={styles.me}>{l.text}</Text>
            ) : (
              <Fade style={styles.sayWrap}><Text style={type.readSay}>{l.text}</Text></Fade>
            )}
          </View>
        ))}
        {busy && !offline && <LoadingHint />}
        {failure && (
          <Fade style={styles.sayWrap}>
            <Text accessibilityLiveRegion="polite" style={type.readSay}>{failure.text}</Text>
            {failure.canRetry && <View style={styles.retry}><TextAction label={copy.tryAgain} size={15} onPress={failure.retry} /></View>}
          </Fade>
        )}
      </ScrollView>
      {read && !handingOn && (
        <Fade delay={at(parts) + 300} duration={600} style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 12) + 12 }]}>
          <LinearGradient pointerEvents="none" colors={['rgba(5,5,5,0)', colors.base]} locations={[0, 0.34]} style={StyleSheet.absoluteFill} />
          <Composer value={text} onChangeText={setText} onSend={submit} placeholder={copy.read.placeholder} offline={offline} busy={busy} />
          <View style={styles.links}>
            <TextAction label={copy.read.skip} onPress={() => { if (!busy) void reply({ skip: true }); }} />
            <Text style={styles.dot}>·</Text>
            <TextAction label={copy.read.somethingElse} onPress={onSomethingElse} />
          </View>
        </Fade>
      )}
      <MenuBar onPress={onMenu} step="read" />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { paddingHorizontal: 28, paddingBottom: 260 },
  head: { marginBottom: 20 },
  para: { marginBottom: 13 },
  next: { borderTopWidth: 1, borderTopColor: ink(0.16), paddingTop: 16, marginTop: 22 },
  me: { ...type.founder, textAlign: 'right', marginTop: 22, marginBottom: 14, marginLeft: 40 },
  sayWrap: { marginTop: 8 },
  retry: { alignSelf: 'flex-start', marginLeft: -8 },
  bar: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingTop: 26, paddingHorizontal: 22 },
  links: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6, marginTop: 4 },
  dot: { color: ink(0.3) },
});
