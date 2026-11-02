import { useCallback, useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { newTurnId, sendUntilDelivered } from '../api/delivery';
import type { CareHelp, LearnReply, LearnTurn, LoadingQuote, Screened } from '../api/types';
import { routeScreened } from '../care/route';
import { Chip } from '../components/Choice';
import { Composer } from '../components/Composer';
import { Fade } from '../components/Fade';
import { FounderCard } from '../components/FounderCard';
import { Glass } from '../components/Glass';
import { LoadingHint } from '../components/LoadingHint';
import { MENU_BAR, MenuBar } from '../components/MenuMark';
import { useFollowScroll } from '../components/useFollowScroll';
import { Picture } from '../components/Picture';
import { Words } from '../components/Words';
import { TextAction } from '../components/TextAction';
import { copy, failureLine } from '../copy';
import { applyLearnReply, type LearnChat, type LearnItem, lessonParagraphs, sourceLines, suggestionTurn, tappedIndexes, verifiedQuotes } from '../learn/chat';
import { colors, gold, ink, type } from '../theme';

type Props = {
  chat: LearnChat;
  start: () => Promise<LearnReply>;
  send: (learnId: string, text: string, turnId: string) => Promise<Screened<LearnReply>>;
  tap: (learnId: string, turnId: string, index: number) => Promise<LearnReply>;
  loadHint: (seed: string) => Promise<LoadingQuote | null>;
  /** The move card was tapped: on to the Move step. */
  onOpenMove: (learnId: string) => void;
  onCare: (message: string, help: CareHelp) => void;
  /** The menu button: home, with the menu open. The situation stays open. */
  onMenu: () => void;
};

type Chips = { done: number[]; pressed: string | null; onTap: (index: number) => void };

// One Axiom turn: the words fill in paragraph by paragraph, then the source line, the picture and the suggestions.
function TurnView({ turn, fresh, chips }: { turn: LearnTurn; fresh: boolean; chips: Chips | null }) {
  const paras = lessonParagraphs(turn.text);
  const [upTo, setUpTo] = useState(fresh ? 1 : paras.length);
  const complete = upTo > paras.length;
  return (
    <>
      {paras.slice(0, Math.min(upTo, paras.length)).map((p, n) => (
        <Words key={n} text={p} animate={fresh} style={[type.reading, styles.para]} onDone={() => setUpTo((u) => Math.max(u, n + 2))} />
      ))}
      {complete && (
        <Fade duration={500}>
          {verifiedQuotes(turn.sources).map((q) => (
            <View key={q.quote} style={styles.quote}>
              <Text style={styles.quoteText}>{`\u201C${q.quote}\u201D`}</Text>
              <Text style={styles.quoteBy}>{q.author}</Text>
            </View>
          ))}
          {sourceLines(turn.sources).map((line) => <Text key={line} style={styles.src}>{line}</Text>)}
          {turn.picture && <Picture picture={turn.picture} />}
          {chips && (
            <View style={styles.chips}>
              {turn.follow_ups.map((label, n) => (
                <Chip key={n} role="button" label={label} selected={chips.done.includes(n) || chips.pressed === `${turn.id}:${n}`} onPress={() => { if (!chips.done.includes(n)) chips.onTap(n); }} />
              ))}
            </View>
          )}
        </Fade>
      )}
    </>
  );
}

// Learn: Axiom's lesson with author and book named, a picture when it helps, tappable follow-ups,
// and a move card once the server says the move is ready. Taps never post a founder message.
export function LearnScreen({ chat, start, send, tap, loadHint, onOpenMove, onCare, onMenu }: Props) {
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<LearnItem[]>(chat.items);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [offline, setOffline] = useState(false);
  const [hint, setHint] = useState<LoadingQuote | null>(null);
  const [pressed, setPressed] = useState<string | null>(null);
  const [failure, setFailure] = useState<{ text: string; canRetry: boolean; retry: () => void } | null>(null);
  const live = useRef(true);
  // Axiom's words fill in only for turns that arrive while the screen is open.
  const seen = useRef(new Set(chat.items.map((i) => i.key)));
  const follow = useFollowScroll(insets.top + MENU_BAR);
  // The screen asks for the lesson once, however often its parent redraws.
  const latest = useRef({ start, loadHint });
  latest.current = { start, loadHint };
  useEffect(() => () => { live.current = false; }, []);

  const change = useCallback((next: LearnItem[]) => {
    chat.items = next;
    setItems(next);
  }, [chat]);
  const mark = (key: number, state: 'sent' | 'waiting' | 'failed') =>
    change(chat.items.map((i) => (i.key === key && i.who === 'me' ? { ...i, state } : i)));

  // One run of a request: the hint shows the book name while it waits; without a connection the same request repeats.
  const run = useCallback(async <T,>(call: () => Promise<T>, seed: string, onWaiting?: (w: boolean) => void): Promise<T> => {
    setBusy(true);
    setFailure(null);
    setHint(null);
    void latest.current.loadHint(seed).then((h) => { if (live.current) setHint(h); }).catch(() => {});
    try {
      return await sendUntilDelivered(call, {
        onWaiting: (w) => { if (live.current) { setOffline(w); onWaiting?.(w); } },
        cancelled: () => !live.current,
      });
    } finally {
      if (live.current) setBusy(false);
    }
  }, []);

  const begin = useCallback(async () => {
    try {
      const res = await run(() => latest.current.start(), 'lesson');
      if (live.current) change(applyLearnReply(chat, res));
    } catch (e) {
      if (live.current) setFailure({ ...failureLine(e, 'read'), retry: () => void begin() });
    }
  }, [run, change, chat]);
  useEffect(() => { if (chat.items.length === 0) void begin(); }, [begin, chat]);

  async function deliver(sent: Extract<LearnItem, { who: 'me' }>) {
    mark(sent.key, 'sent');
    try {
      const res = await run(() => send(chat.learnId ?? '', sent.text, sent.turnId), sent.turnId, (w) => { if (w) mark(sent.key, 'waiting'); });
      if (!live.current) return;
      const route = routeScreened(res);
      if (route.kind === 'care') {
        change(chat.items.filter((i) => i.key !== sent.key));
        onCare(route.message, route.help);
        return;
      }
      const sentOk: LearnItem = { ...sent, state: 'sent' };
      if (route.kind === 'unclear') {
        change([...chat.items.map((i) => (i.key === sent.key ? sentOk : i)), { key: chat.nextKey++, who: 'say', text: route.reply }]);
        return;
      }
      if (res.care) return;
      change(applyLearnReply(chat, res).map((i) => (i.key === sent.key ? sentOk : i)));
    } catch (e) {
      if (!live.current) return;
      mark(sent.key, 'failed');
      setFailure({ ...failureLine(e), retry: () => void deliver(sent) });
    }
  }

  function submit() {
    const said = text.trim();
    if (!said || busy || !chat.learnId) return;
    const sent: Extract<LearnItem, { who: 'me' }> = { key: chat.nextKey++, who: 'me', text: said, turnId: newTurnId(), state: 'sent' };
    change([...chat.items, sent]);
    setText('');
    void deliver(sent);
  }

  // A tapped suggestion shows pressed and Axiom answers; nothing is posted as the founder.
  async function tapSuggestion(turnId: string, index: number) {
    if (busy || !chat.learnId) return;
    const id = chat.learnId;
    setPressed(`${turnId}:${index}`);
    try {
      const res = await run(() => tap(id, turnId, index), `${turnId}:${index}`);
      if (live.current) change(applyLearnReply(chat, res));
    } catch (e) {
      if (live.current) setFailure({ ...failureLine(e), retry: () => void tapSuggestion(turnId, index) });
    } finally {
      if (live.current) setPressed(null);
    }
  }

  // The newest item reports where it starts, so a long reply is read from its first line.
  const newest = (n: number, i: LearnItem, node: React.ReactNode) =>
    n === items.length - 1 ? <View key={i.key} onLayout={follow.newest(i.who !== 'me')}>{node}</View> : node;

  const chips = suggestionTurn(items);
  const done = chips ? tappedIndexes(items, chips.id) : [];

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
      <ScrollView
        ref={follow.ref}
        onLayout={follow.onLayout}
        onContentSizeChange={follow.onContentSizeChange}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.chat, { paddingTop: insets.top + MENU_BAR }]}
      >
        {items.map((i, n) => newest(n, i, (() => {
          if (i.who === 'me') {
            return (
              <View key={i.key} style={styles.me}>
                <Text style={styles.meText}>{i.text}</Text>
                {i.state === 'waiting' && <Text style={styles.waiting}>{copy.waitingToSend}</Text>}
              </View>
            );
          }
          if (i.who === 'say') return <Fade key={i.key} style={styles.ax}><Text style={type.reading}>{i.text}</Text></Fade>;
          if (i.who === 'case') return <FounderCard key={i.key} story={i.case.story} lesson={i.case.lesson} />;
          if (i.who === 'card') {
            return (
              <Fade key={i.key} style={styles.ax}>
                <Glass onPress={() => { if (chat.learnId) onOpenMove(chat.learnId); }} radius={18} accessibilityLabel={`${i.notice.kicker}. ${i.notice.text}`} contentStyle={styles.card}>
                  <Text style={styles.kicker}>{i.notice.kicker}</Text>
                  <Text style={type.readSay}>{i.notice.text}</Text>
                </Glass>
              </Fade>
            );
          }
          return (
            <Fade key={i.key} style={styles.ax}>
              <TurnView
                turn={i.turn}
                fresh={!seen.current.has(i.key)}
                chips={chips?.id === i.turn.id ? { done, pressed, onTap: (n) => void tapSuggestion(i.turn.id, n) } : null}
              />
            </Fade>
          );
        })()))}
        {busy && !offline && <LoadingHint hint={hint} />}
        {failure && (
          <Fade style={styles.ax}>
            <Text accessibilityLiveRegion="polite" style={type.reading}>{failure.text}</Text>
            {failure.canRetry && <View style={styles.retry}><TextAction label={copy.tryAgain} size={15} onPress={failure.retry} /></View>}
          </Fade>
        )}
      </ScrollView>
      <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 12) + 18 }]}>
        <LinearGradient pointerEvents="none" colors={['rgba(5,5,5,0)', colors.base]} locations={[0, 0.4]} style={StyleSheet.absoluteFill} />
        <Composer value={text} onChangeText={setText} onSend={submit} placeholder={copy.learn.placeholder} offline={offline} busy={busy} />
      </View>
      <MenuBar onPress={onMenu} step="learn" />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  chat: { paddingHorizontal: 28, paddingBottom: 200 },
  ax: { marginBottom: 18 },
  para: { marginBottom: 14 },
  src: { ...type.label, textTransform: 'none', letterSpacing: 0.5, fontSize: 11.5, color: ink(0.45), marginBottom: 20 },
  // A verified quote, set apart by a thin gold rule.
  quote: { borderLeftWidth: 1, borderLeftColor: gold(0.55), paddingLeft: 14, marginTop: 2, marginBottom: 22 },
  quoteText: { ...type.readSay, fontStyle: 'italic', color: ink(0.92) },
  quoteBy: { ...type.label, textTransform: 'none', letterSpacing: 0.5, fontSize: 11.5, color: ink(0.5), marginTop: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  me: { marginTop: 24, marginBottom: 24, marginLeft: 52, alignItems: 'flex-end' },
  meText: { ...type.founder, textAlign: 'right' },
  waiting: { ...type.label, marginTop: 4, color: ink(0.4) },
  card: { paddingVertical: 14, paddingHorizontal: 18 },
  kicker: { ...type.label, marginBottom: 6 },
  retry: { alignSelf: 'flex-start', marginLeft: -8 },
  bar: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingTop: 22, paddingHorizontal: 16 },
});
