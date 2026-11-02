import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, type ScrollViewInstance, StyleSheet, Text, type TextInputInstance, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { newTurnId, sendUntilDelivered } from '../api/delivery';
import type { CareHelp } from '../api/types';
import { routeScreened } from '../care/route';
import { Composer } from '../components/Composer';
import { Fade } from '../components/Fade';
import { Glass } from '../components/Glass';
import { LoadingHint } from '../components/LoadingHint';
import { MENU_BAR, MenuBar } from '../components/MenuMark';
import { TextAction } from '../components/TextAction';
import { copy, failureLine } from '../copy';
import { applyReply, type Chat, type ChatItem, HAND_OFF_MS, type SendTurn } from '../situation/chat';
import { colors, ink, type } from '../theme';

type Props = {
  chat: Chat;
  /** Axiom's first line. */
  opening: string;
  /** What the founder wrote earlier, offered above the empty bar. It never fills the bar by itself. */
  suggestion?: string;
  send: SendTurn;
  /** Axiom has what it needs: on to the Read. */
  onReady: (situationId: string) => void;
  onCare: (message: string, help: CareHelp) => void;
  /** The menu button: home, with the menu open. The situation stays open. */
  onMenu: () => void;
};

const BAR_DELAY = 1400;

// The situation: Axiom asks one plain question, the founder answers in their own words.
// At most 2 follow-ups (the server counts), then the Read follows by itself.
export function SituationScreen({ chat, opening, suggestion, send, onReady, onCare, onMenu }: Props) {
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<ChatItem[]>(() => {
    if (chat.items.length === 0 && !chat.pending) chat.items = [{ id: chat.nextId++, who: 'ax', text: opening }];
    return chat.items;
  });
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [offline, setOffline] = useState(false);
  const [failure, setFailure] = useState<{ text: string; canRetry: boolean } | null>(null);
  const live = useRef(true);
  const scroller = useRef<ScrollViewInstance>(null);
  const box = useRef<TextInputInstance>(null);
  useEffect(() => () => { live.current = false; }, []);

  const change = (next: ChatItem[]) => {
    chat.items = next;
    setItems(next);
  };
  const mark = (id: number, state: 'sent' | 'waiting' | 'failed') =>
    change(chat.items.map((i) => (i.id === id && i.who === 'me' ? { ...i, state } : i)));

  // One send. The turn id is made once per message and reused on every retry and every "Try again".
  async function deliver(sent: Extract<ChatItem, { who: 'me' }>) {
    setBusy(true);
    setFailure(null);
    mark(sent.id, 'sent');
    try {
      const res = await sendUntilDelivered(() => send(chat.situationId, sent.text, sent.turnId), {
        onWaiting: (w) => { if (live.current) { setOffline(w); if (w) mark(sent.id, 'waiting'); } },
        cancelled: () => !live.current,
      });
      if (!live.current) return;
      const route = routeScreened(res);
      if (route.kind === 'care') {
        change(chat.items.filter((i) => i.id !== sent.id));
        onCare(route.message, route.help);
        return;
      }
      const sentOk: ChatItem = { ...sent, state: 'sent' };
      if (route.kind === 'unclear') {
        change([...chat.items.map((i) => (i.id === sent.id ? sentOk : i)), { id: chat.nextId++, who: 'ax', text: route.reply }]);
        return;
      }
      if (res.care) return;
      change(applyReply(chat, res, sentOk));
      if (res.status === 'ready' && res.situation_id) {
        const id = res.situation_id;
        await new Promise((resume) => setTimeout(resume, HAND_OFF_MS));
        if (live.current) onReady(id);
      }
    } catch (e) {
      if (!live.current) return;
      mark(sent.id, 'failed');
      setFailure(failureLine(e));
    } finally {
      if (live.current) setBusy(false);
    }
  }

  function post(said: string) {
    const sent: Extract<ChatItem, { who: 'me' }> = { id: chat.nextId++, who: 'me', text: said, turnId: newTurnId(), state: 'sent' };
    change([...chat.items, sent]);
    void deliver(sent);
  }

  function submit() {
    const said = text.trim();
    if (!said || busy) return;
    setText('');
    post(said);
  }

  // What the founder typed on the home screen goes out as the first message, once.
  useEffect(() => {
    const first = chat.pending;
    chat.pending = null;
    if (first) post(first);
  }, []);

  const lastSent = [...items].reverse().find((i) => i.who === 'me');
  const started = items.some((i) => i.who === 'me');
  const showSuggestion = !!suggestion && !started && text.trim() !== suggestion.trim();

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
      <ScrollView
        ref={scroller}
        onContentSizeChange={() => scroller.current?.scrollToEnd({ animated: true })}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.chat, { paddingTop: insets.top + MENU_BAR }]}
      >
        {items.map((i, n) =>
          i.who === 'ax' ? (
            <Fade key={i.id} delay={n === 0 ? 500 : 0} style={styles.ax}>
              <Text style={type.reading}>{i.text}</Text>
            </Fade>
          ) : (
            <View key={i.id} style={styles.me}>
              <Text style={styles.meText}>{i.text}</Text>
              {i.state === 'waiting' && <Text style={styles.waiting}>{copy.waitingToSend}</Text>}
            </View>
          ),
        )}
        {busy && !offline && <LoadingHint />}
        {failure && (
          <Fade style={styles.ax}>
            <Text accessibilityLiveRegion="polite" style={type.reading}>{failure.text}</Text>
            {failure.canRetry && lastSent?.who === 'me' && (
              <View style={styles.retry}><TextAction label={copy.tryAgain} size={15} onPress={() => { if (lastSent?.who === 'me') void deliver(lastSent); }} /></View>
            )}
          </Fade>
        )}
      </ScrollView>
      <Fade delay={chat.items.length > 1 ? 0 : BAR_DELAY} style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 12) + 18 }]}>
        <LinearGradient pointerEvents="none" colors={['rgba(5,5,5,0)', colors.base]} locations={[0, 0.4]} style={StyleSheet.absoluteFill} />
        {showSuggestion && (
          <Glass onPress={() => { setText(suggestion); box.current?.focus(); }} radius={18} style={styles.suggestion} contentStyle={styles.suggestionBody}>
            <Text style={styles.suggestionLabel}>{copy.situation.suggestion}</Text>
            <Text numberOfLines={2} style={styles.suggestionText}>{`“${suggestion}”`}</Text>
          </Glass>
        )}
        <Composer inputRef={box} value={text} onChangeText={setText} onSend={submit} placeholder={copy.situation.placeholder} offline={offline} busy={busy} />
      </Fade>
      <MenuBar onPress={onMenu} step="situation" />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  chat: { paddingHorizontal: 28, paddingBottom: 230 },
  ax: { marginBottom: 18 },
  me: { marginTop: 24, marginBottom: 24, marginLeft: 52, alignItems: 'flex-end' },
  meText: { ...type.founder, textAlign: 'right' },
  waiting: { ...type.label, marginTop: 4, color: ink(0.4) },
  retry: { alignSelf: 'flex-start', marginLeft: -8 },
  bar: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingTop: 22, paddingHorizontal: 16 },
  suggestion: { marginBottom: 10 },
  suggestionBody: { paddingVertical: 11, paddingHorizontal: 16 },
  suggestionLabel: { ...type.label, color: ink(0.45), letterSpacing: 1.8, marginBottom: 4 },
  suggestionText: { fontFamily: type.chip.fontFamily, fontSize: 14.5, lineHeight: 20, color: colors.ink },
});
