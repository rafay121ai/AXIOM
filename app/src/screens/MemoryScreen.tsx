import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { AccessibilityInfo, Animated, Easing, findNodeHandle, Platform, Pressable, ScrollView, StyleSheet, Text, View, type ScrollViewInstance, type ViewInstance } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { sendUntilDelivered } from '../api/delivery';
import type { MemoryItem, MemoryReason } from '../api/types';
import { Construction } from '../components/Construction';
import { Fade } from '../components/Fade';
import { GlassFill } from '../components/Glass';
import { PageHeader } from '../components/PageHeader';
import { TextAction } from '../components/TextAction';
import { useReduceMotion } from '../components/useReduceMotion';
import { Wash } from '../components/Wash';
import { copy, failureLine } from '../copy';
import { focusAfter, receiptDate, removeLine, sectionsOf, shownOrder, summaryParts, summaryText } from '../memory/flow';
import { colors, fonts, glass, gold, ink } from '../theme';

type Props = {
  load: () => Promise<MemoryItem[]>;
  remove: (item: MemoryItem, reason: MemoryReason) => Promise<void>;
  onBack: () => void;
};

const EASE = Easing.bezier(0.2, 0.8, 0.2, 1); // the drawer's
const FIRST_LINE_MS = 900, STAGGER_MS = 95;

// The small section marks from the mock (24px grid, 1.4 gold stroke).
const MARKS: Record<MemoryItem['group'], ReactNode> = {
  decide: <Path d="M12 20v-8M12 12 6 5M12 12l6-7" />,
  work: <Path d="M4 18h5v-5h5V8h6" />,
  business: <Path d="M5 19V8h14v11M9 8V5h6v3" />,
  people: <><Circle cx={9} cy={9} r={3} /><Circle cx={17} cy={10} r={2.2} /><Path d="M3.5 19c.6-3 2.7-4.5 5.5-4.5s4.9 1.5 5.5 4.5" /></>,
  open: <Path d="M18 8a7 7 0 1 0 1 6" />,
};

// The number in the summary counts up from 0 the first time and ticks down by one on a removal.
function Summary({ n }: { n: number }) {
  const reduce = useReduceMotion();
  const first = useRef(true);
  const value = useRef(new Animated.Value(0)).current;
  const [shown, setShown] = useState(0);
  useEffect(() => {
    const id = value.addListener(({ value: v }) => setShown(Math.round(v)));
    return () => value.removeListener(id);
  }, [value]);
  useEffect(() => {
    if (reduce) { value.setValue(n); return; }
    const run = Animated.timing(value, { toValue: n, delay: first.current ? 300 : 0, duration: first.current ? 900 : 400, easing: Easing.out(Easing.cubic), useNativeDriver: false });
    first.current = false;
    run.start();
    return () => run.stop();
  }, [n, reduce, value]);
  const [before, after] = summaryParts(n);
  return (
    <Fade delay={300}>
      <Text accessibilityLabel={summaryText(n)} style={styles.sum}>
        {before}<Text style={styles.num}>{shown}</Text>{after}
      </Text>
    </Fade>
  );
}

// Closes its content's height and opacity so what is below slides up, then says it is done.
function Collapse({ closed, onDone, style, children }: { closed: boolean; onDone: () => void; style?: object; children: ReactNode }) {
  const reduce = useReduceMotion();
  const height = useRef<number | null>(null);
  const v = useRef(new Animated.Value(1)).current;
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    if (!closed) return;
    if (reduce || height.current === null) { done.current(); return; }
    const run = Animated.timing(v, { toValue: 0, duration: 550, easing: EASE, useNativeDriver: false });
    run.start(({ finished }) => finished && done.current());
    return () => run.stop();
  }, [closed, reduce, v]);
  return (
    <Animated.View
      onLayout={(e) => { if (!closed) height.current = e.nativeEvent.layout.height; }}
      style={[style, { overflow: 'hidden', opacity: v }, closed && height.current !== null && { height: v.interpolate({ inputRange: [0, 1], outputRange: [0, height.current] }) }]}
    >
      {children}
    </Animated.View>
  );
}

// The sentence goes one rendered line at a time (the lines are measured, so large text still works), then calls onDone.
function Dissolve({ lines, onDone }: { lines: string[]; onDone: () => void }) {
  const reduce = useReduceMotion();
  const values = useRef(lines.map(() => new Animated.Value(1))).current;
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    if (reduce) { done.current(); return; }
    const run = Animated.parallel(values.map((v, i) => Animated.timing(v, { toValue: 0, delay: i * 170, duration: 600, useNativeDriver: true })));
    run.start(({ finished }) => finished && done.current());
    return () => run.stop();
  }, [values, reduce]);
  return (
    <View style={styles.textBox}>
      {lines.map((t, i) => (
        <Animated.Text key={i} style={[styles.text, { opacity: values[i], transform: [{ translateY: values[i].interpolate({ inputRange: [0, 1], outputRange: [-3, 0] }) }] }]}>{t.trimEnd()}</Animated.Text>
      ))}
    </View>
  );
}

type RowProps = {
  item: MemoryItem;
  delay: number;
  open: boolean;
  first: boolean;
  dissolving: boolean;
  onToggle: () => void;
  onAct: (reason: MemoryReason) => void;
  onDissolved: () => void;
  register: (el: ViewInstance | null) => void;
  onOpened: (el: ViewInstance | null) => void;
};

function Line({ item, delay, open, first, dissolving, onToggle, onAct, onDissolved, register, onOpened }: RowProps) {
  const reduce = useReduceMotion();
  const wrap = useRef<ViewInstance>(null);
  const measured = useRef<string[]>([]);
  const [natural, setNatural] = useState(0);
  const ready = natural > 0;
  const grow = useRef(new Animated.Value(0)).current;
  const hair = useRef(new Animated.Value(0)).current;
  const body = useRef(new Animated.Value(0)).current;
  const turn = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!ready) return;
    const t = (v: Animated.Value, toValue: number, duration: number, d: number, native: boolean, easing = EASE) =>
      Animated.timing(v, { toValue, delay: open ? d : 0, duration: reduce ? 0 : open ? duration : Math.min(duration, 250), easing, useNativeDriver: native });
    const run = Animated.parallel([t(grow, open ? 1 : 0, 450, 0, false), t(hair, open ? 1 : 0, 600, 100, false), t(body, open ? 1 : 0, 350, 250, true, Easing.linear), t(turn, open ? 1 : 0, 350, 0, true)]);
    run.start();
    if (!open) return () => run.stop();
    const timer = setTimeout(() => onOpened(wrap.current), 300);
    return () => { run.stop(); clearTimeout(timer); };
  }, [open, ready, reduce, grow, hair, body, turn, onOpened]);

  // While the line dissolves its receipt fades out first.
  useEffect(() => {
    if (dissolving) Animated.timing(body, { toValue: 0, duration: reduce ? 0 : 300, useNativeDriver: true }).start();
  }, [dissolving, reduce, body]);

  const why = (label: string) => `${label}${item.text}`;
  return (
    <Fade delay={delay} style={!first && styles.divider}>
      <View ref={wrap}>
        <Pressable
          ref={register}
          accessibilityRole="button"
          accessibilityLabel={item.text}
          accessibilityState={{ expanded: open }}
          onPress={onToggle}
          style={styles.row}
        >
          {dissolving
            ? <Dissolve lines={measured.current.length > 0 ? measured.current : [item.text]} onDone={onDissolved} />
            : <Text onTextLayout={(e) => { measured.current = e.nativeEvent.lines.map((l) => l.text); }} style={[styles.text, styles.textBox]}>{item.text}</Text>}
          <Animated.Text style={[styles.chev, { transform: [{ rotate: turn.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '90deg'] }) }] }]}>›</Animated.Text>
        </Pressable>
        <Animated.View
          pointerEvents={open ? 'auto' : 'none'}
          accessibilityElementsHidden={!open}
          importantForAccessibility={open ? 'auto' : 'no-hide-descendants'}
          style={{ overflow: 'hidden', height: grow.interpolate({ inputRange: [0, 1], outputRange: [0, natural] }) }}
        >
          <View
            style={styles.receipt}
            onLayout={(e) => { setNatural(e.nativeEvent.layout.height); }}
          >
            <Animated.View style={[styles.hairline, { width: hair.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) }]} />
            <Animated.View style={{ opacity: body }}>
              <Text style={styles.rcLabel}>{copy.memory.from}</Text>
              {item.receipt ? (
                <>
                  <Text style={styles.rcText}>{item.receipt.text}</Text>
                  <Text style={styles.rcDate}>{receiptDate(item.receipt.at)}</Text>
                </>
              ) : <Text style={styles.rcText}>{copy.memory.noSource}</Text>}
              <View style={styles.actions}>
                <TextAction label={copy.memory.wrong} accessibilityLabel={why(copy.memory.markWrong)} size={14} onPress={() => onAct('wrong')} />
                <TextAction label={copy.memory.outdated} accessibilityLabel={why(copy.memory.markOutdated)} size={14} onPress={() => onAct('outdated')} />
              </View>
            </Animated.View>
          </View>
        </Animated.View>
      </View>
    </Fade>
  );
}

// The floating confirmation (or a failure line): glass, fades in for 300 ms, stays 2.6 s, fades out. It stays mounted and only its
// text changes (Android and web announce changes, not new mounts), so it is spoken politely; iOS gets an explicit announcement.
function Toast({ toast, onGone }: { toast: { text: string; key: number } | null; onGone: () => void }) {
  const reduce = useReduceMotion();
  const v = useRef(new Animated.Value(0)).current;
  const gone = useRef(onGone);
  gone.current = onGone;
  useEffect(() => {
    if (!toast) return;
    if (Platform.OS === 'ios') AccessibilityInfo.announceForAccessibility(toast.text);
    const ms = reduce ? 0 : 300;
    const run = Animated.sequence([
      Animated.timing(v, { toValue: 1, duration: ms, useNativeDriver: true }),
      Animated.delay(2600),
      Animated.timing(v, { toValue: 0, duration: ms, useNativeDriver: true }),
    ]);
    run.start(({ finished }) => finished && gone.current());
    return () => run.stop();
  }, [toast, reduce, v]);
  return (
    <Animated.View pointerEvents="none" style={[styles.toast, { opacity: v, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }] }]}>
      <View style={styles.toastGlass}>
        <GlassFill />
        <Text accessibilityLiveRegion="polite" style={styles.toastText}>{toast?.text ?? ''}</Text>
      </View>
    </Animated.View>
  );
}

type Going = { id: string; lastInSection: boolean; stage: 'dissolve' | 'collapse'; next: MemoryItem[]; focus: string | null };

// What Axiom thinks: what it has learned about the founder, why, and a way to remove any line for good. Read only:
// every change goes through the API, and nothing here shows a score, a confidence or an id.
export function MemoryScreen({ load, remove, onBack }: Props) {
  const [items, setItems] = useState<MemoryItem[] | null>(null);
  const [failure, setFailure] = useState<{ text: string; canRetry: boolean } | null>(null);
  const [again, setAgain] = useState(0);
  const [open, setOpen] = useState<string | null>(null);
  const [going, setGoing] = useState<Going | null>(null);
  const [toast, setToast] = useState<{ text: string; key: number } | null>(null);
  const live = useRef(true);
  const latest = useRef(load);
  latest.current = load;
  const sending = useRef(false);
  const rows = useRef<Record<string, ViewInstance | null>>({});
  const scroll = useRef<ScrollViewInstance>(null);
  const back = useRef<ViewInstance>(null);
  const offset = useRef(0);
  useEffect(() => () => { live.current = false; }, []);

  useEffect(() => {
    let current = true;
    setFailure(null);
    sendUntilDelivered(() => latest.current(), { cancelled: () => !live.current || !current })
      .then((found) => { if (current && live.current) setItems(found); })
      .catch((e) => { if (current && live.current) setFailure(failureLine(e, 'read')); });
    return () => { current = false; };
  }, [again]);

  const say = (text: string) => setToast((t) => ({ text, key: (t?.key ?? 0) + 1 }));

  async function act(item: MemoryItem, reason: MemoryReason) {
    if (!items || going || sending.current) return;
    sending.current = true;
    const result = await removeLine(items, item.id, reason, (line, why) => sendUntilDelivered(() => remove(line, why), { cancelled: () => !live.current }));
    sending.current = false;
    if (!live.current) return;
    if (result.failure) return say(failureLine(result.failure, 'save').text);
    const section = sectionsOf(items).find((s) => s.items.some((i) => i.id === item.id));
    setGoing({ id: item.id, lastInSection: section?.items.length === 1, stage: 'dissolve', next: result.items, focus: focusAfter(items, item.id) });
  }

  // The line is gone from the list for good: the confirmation, and focus moves on so nobody loses their place.
  function finish(g: Going) {
    setItems(g.next);
    setOpen(null);
    setGoing(null);
    say(copy.memory.removed);
    const el = g.focus ? rows.current[g.focus] : back.current; // the last line: the back control
    if (Platform.OS === 'web') (el as unknown as HTMLElement).focus?.();
    else { const tag = findNodeHandle(el); if (tag) AccessibilityInfo.setAccessibilityFocus(tag); }
  }

  // After a receipt opens, bring it into view if the bottom is hidden.
  const reveal = useCallback((el: ViewInstance | null) => {
    const box = scroll.current;
    if (!el || !box) return;
    el.measureInWindow((_x, y, _w, h) => box.measureInWindow((_bx, by, _bw, bh) => {
      const over = y + h - (by + bh) + 24;
      if (over > 0) box.scrollTo({ y: offset.current + over, animated: true });
    }));
  }, []);

  const sections = items ? sectionsOf(items) : [];
  const order = items ? shownOrder(items) : [];
  const total = (items?.length ?? 0) - (going?.stage === 'collapse' ? 1 : 0);

  return (
    <View style={styles.screen}>
      <Wash />
      <Construction draw />
      <PageHeader title={copy.memory.title} onBack={onBack} backRef={back} />
      {failure && (
        <View style={styles.pad}>
          <Text style={styles.none}>{failure.text}</Text>
          {failure.canRetry && <TextAction label={copy.tryAgain} size={15} onPress={() => setAgain((n) => n + 1)} />}
        </View>
      )}
      {items && items.length === 0 && (
        <View style={styles.empty}>
          <Fade delay={400}><Text style={styles.emptyText}>{copy.memory.empty}</Text></Fade>
        </View>
      )}
      {items && items.length > 0 && (
        <ScrollView
          ref={scroll}
          showsVerticalScrollIndicator={false}
          scrollEventThrottle={32}
          onScroll={(e) => { offset.current = e.nativeEvent.contentOffset.y; }}
          contentContainerStyle={styles.list}
        >
          <Summary n={total} />
          <Fade delay={500}><Text style={styles.hint}>{copy.memory.hint}</Text></Fade>
          {sections.map((s) => {
            const firstDelay = FIRST_LINE_MS + order.findIndex((i) => i.id === s.items[0].id) * STAGGER_MS;
            const leaving = going?.lastInSection && s.items.some((i) => i.id === going.id);
            return (
              <Collapse key={s.group} closed={!!leaving && going?.stage === 'collapse'} onDone={() => going && finish(going)}>
                <View role="group" aria-label={s.label} style={styles.section}>
                  <SectionHairline delay={Math.max(0, firstDelay - 260)} />
                  <View style={styles.inner}>
                  <Fade delay={Math.max(0, firstDelay - 260)}>
                    <View style={styles.head}>
                      <Svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke={gold(0.85)} strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round">{MARKS[s.group]}</Svg>
                      <Text accessibilityRole="header" aria-level={2} style={styles.headText}>{s.label}</Text>
                    </View>
                  </Fade>
                  {s.items.map((item, i) => {
                    const mine = going?.id === item.id;
                    return (
                      <Collapse key={item.id} closed={!!going && mine && !going.lastInSection && going.stage === 'collapse'} onDone={() => going && finish(going)}>
                        <Line
                          item={item}
                          first={i === 0}
                          delay={FIRST_LINE_MS + order.indexOf(item) * STAGGER_MS}
                          open={open === item.id}
                          dissolving={mine}
                          onToggle={() => !going && setOpen(open === item.id ? null : item.id)}
                          onAct={(reason) => void act(item, reason)}
                          onDissolved={() => setGoing((g) => g && { ...g, stage: 'collapse' })}
                          register={(el) => { rows.current[item.id] = el; }}
                          onOpened={reveal}
                        />
                      </Collapse>
                    );
                  })}
                  </View>
                </View>
              </Collapse>
            );
          })}
        </ScrollView>
      )}
      <Toast toast={toast} onGone={() => setToast((t) => (t?.key === toast?.key ? null : t))} />
    </View>
  );
}

// The thin line above a section draws in from the left.
function SectionHairline({ delay }: { delay: number }) {
  const reduce = useReduceMotion();
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const run = Animated.timing(v, { toValue: 1, delay: reduce ? 0 : delay, duration: reduce ? 0 : 900, easing: EASE, useNativeDriver: false });
    run.start();
    return () => run.stop();
  }, [v, delay, reduce]);
  return <Animated.View style={[styles.rule, { width: v.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) }]} />;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.base },
  pad: { paddingHorizontal: 24 },
  list: { paddingBottom: 56 },
  sum: { fontFamily: fonts.serif, fontSize: 22, lineHeight: 29.7, color: '#f4f4f2', marginHorizontal: 26, marginTop: 6 },
  num: { fontVariant: ['tabular-nums'] },
  hint: { fontFamily: fonts.sans, fontSize: 13, lineHeight: 19.5, color: ink(0.5), marginHorizontal: 26, marginTop: 10, marginBottom: 22 },
  section: { paddingTop: 16, paddingBottom: 4 },
  inner: { paddingHorizontal: 24 },
  rule: { position: 'absolute', top: 0, left: 0, height: 1, backgroundColor: ink(0.14) },
  head: { flexDirection: 'row', alignItems: 'center', gap: 9, marginBottom: 4 },
  headText: { fontFamily: fonts.sans, fontSize: 10, letterSpacing: 2, textTransform: 'uppercase', color: ink(0.45) },
  divider: { borderTopWidth: 1, borderTopColor: ink(0.08) },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52, paddingVertical: 13 },
  textBox: { flex: 1 },
  text: { fontFamily: fonts.serif, fontSize: 17, lineHeight: 25, color: ink(0.92) },
  chev: { fontSize: 19, color: ink(0.35) },
  receipt: { position: 'absolute', left: 0, right: 0, top: 0 },
  hairline: { height: 1, backgroundColor: gold(0.7) },
  rcLabel: { fontFamily: fonts.sans, fontSize: 10, letterSpacing: 2, textTransform: 'uppercase', color: ink(0.45), marginTop: 14, marginBottom: 7 },
  rcText: { fontFamily: fonts.sans, fontSize: 14.5, lineHeight: 21.75, color: ink(0.7) },
  rcDate: { fontFamily: fonts.sans, fontSize: 12, color: ink(0.5), marginTop: 4 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 4, marginLeft: -8, marginBottom: 6 },
  none: { fontFamily: fonts.sans, fontSize: 14.5, color: ink(0.5), paddingVertical: 30 },
  empty: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 44, paddingBottom: 80 },
  emptyText: { fontFamily: fonts.serif, fontSize: 21, lineHeight: 31.5, color: ink(0.85), textAlign: 'center' },
  toast: { position: 'absolute', alignSelf: 'center', bottom: 34 },
  toastGlass: { borderRadius: 16, borderWidth: 1, borderColor: ink(glass.edge), overflow: 'hidden', paddingVertical: 12, paddingHorizontal: 18 },
  toastText: { fontFamily: fonts.sans, fontSize: 14, color: ink(0.92) },
});
