import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, BackHandler, Easing, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, type TextInputInstance, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
import { sendUntilDelivered } from '../api/delivery';
import type { HelpLine, Home, HomeItem, Screened, Target } from '../api/types';
import { routeScreened } from '../care/route';
import { Composer } from '../components/Composer';
import { Fade } from '../components/Fade';
import { LeftOff } from '../components/LeftOff';
import { LoadingHint } from '../components/LoadingHint';
import { TextAction } from '../components/TextAction';
import { useReduceMotion } from '../components/useReduceMotion';
import { Wash } from '../components/Wash';
import { copy, failureLine } from '../copy';
import { type MenuRow, menuRows } from '../home/flow';
import { colors, ink, type } from '../theme';
import { HomeDrawer } from './HomeDrawer';

type Props = {
  load: () => Promise<Home>;
  checkIn: (text: string) => Promise<Screened<{ ok: true }>>;
  /** The home has loaded (the first time or after a check-in). A rejection means the next screen could not be opened. */
  onLoaded: (home: Home) => Promise<void> | void;
  /** The founder typed something new: the Situation starts with it. */
  onStart: (text: string) => void;
  /** An item or a menu row was tapped. A rejection means it could not be opened. */
  onOpen: (target: Target) => Promise<void>;
  onCare: (message: string, help: HelpLine[]) => void;
};

const DRAWER_SHARE = 0.84;
const SLIDE_MS = 500;

// The returning founder's home: Axiom's greeting in serif, a chat bar, up to 2 small items for what was left off,
// and a menu that slides in from the left. Typing in the bar starts something new. While a care check-in is open,
// only the gentle line and the bar are here.
export function HomeScreen({ load, checkIn, onLoaded, onStart, onOpen, onCare }: Props) {
  const insets = useSafeAreaInsets();
  const reduce = useReduceMotion();
  const [home, setHome] = useState<Home | null>(null);
  const [failure, setFailure] = useState<{ text: string; canRetry: boolean } | null>(null);
  const [soft, setSoft] = useState<string | null>(null);
  const [notOpened, setNotOpened] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [offline, setOffline] = useState(false);
  const [width, setWidth] = useState(0);
  const [drawer, setDrawer] = useState(false);
  const slide = useRef(new Animated.Value(0)).current;
  const live = useRef(true);
  const box = useRef<TextInputInstance>(null);
  const latest = useRef({ load, onLoaded });
  latest.current = { load, onLoaded };
  useEffect(() => () => { live.current = false; }, []);

  const fetchHome = useCallback(async () => {
    setFailure(null);
    try {
      const h = await sendUntilDelivered(() => latest.current.load(), { cancelled: () => !live.current });
      if (!live.current) return;
      setHome(h);
      setNotOpened(false);
      await (async () => latest.current.onLoaded(h))().catch(() => { if (live.current) setNotOpened(true); });
    } catch (e) {
      if (live.current) setFailure(failureLine(e, 'read'));
    }
  }, []);
  useEffect(() => { void fetchHome(); }, [fetchHome]);

  const setDrawerOpen = useCallback((open: boolean) => {
    setDrawer(open);
    Animated.timing(slide, { toValue: open ? 1 : 0, duration: reduce ? 0 : SLIDE_MS, easing: Easing.bezier(0.2, 0.8, 0.2, 1), useNativeDriver: true }).start();
  }, [slide, reduce]);

  useEffect(() => {
    if (!drawer) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { setDrawerOpen(false); return true; });
    return () => sub.remove();
  }, [drawer, setDrawerOpen]);

  // "Start something new": the menu closes and the bar is ready.
  function startNew() {
    setDrawerOpen(false);
    setTimeout(() => box.current?.focus(), SLIDE_MS - 100);
  }

  async function open(target: Target) {
    setNotOpened(false);
    setDrawerOpen(false);
    try {
      await onOpen(target);
    } catch {
      if (live.current) setNotOpened(true);
    }
  }

  async function submit() {
    const said = text.trim();
    if (!said || busy || !home) return;
    if (!home.care_check_in) {
      onStart(said);
      return;
    }
    setBusy(true);
    try {
      const res = await sendUntilDelivered(() => checkIn(said), { onWaiting: (w) => live.current && setOffline(w), cancelled: () => !live.current });
      if (!live.current) return;
      const route = routeScreened(res);
      setText('');
      if (route.kind === 'care') return onCare(route.message, route.help);
      if (route.kind === 'unclear') return setSoft(route.reply);
      setSoft(null);
      await fetchHome();
    } catch (e) {
      if (live.current) setFailure(failureLine(e));
    } finally {
      if (live.current) setBusy(false);
    }
  }

  const checking = home?.care_check_in === true;
  const rows = home ? menuRows(home.drawer) : null;
  const pushed = width * DRAWER_SHARE;
  const rowTarget = (row: MenuRow) => { if (row.target) void open(row.target); };

  return (
    <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)} style={styles.root}>
      <Wash />
      {rows && !checking && (
        <Animated.View
          pointerEvents={drawer ? 'auto' : 'none'}
          accessibilityElementsHidden={!drawer}
          importantForAccessibility={drawer ? 'auto' : 'no-hide-descendants'}
          aria-hidden={!drawer}
          style={[StyleSheet.absoluteFill, { opacity: slide, transform: [{ translateX: slide.interpolate({ inputRange: [0, 1], outputRange: [-pushed * 0.14, 0] }) }] }]}
        >
          <HomeDrawer rows={rows} onStartNew={startNew} onRow={rowTarget} />
        </Animated.View>
      )}
      <Animated.View style={[styles.main, drawer && styles.mainPushed, { transform: [{ translateX: slide.interpolate({ inputRange: [0, 1], outputRange: [0, pushed] }) }] }]}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
          <View style={[styles.top, { paddingTop: insets.top + 54 }]}>
            {!checking && (
              <Pressable accessibilityRole="button" accessibilityLabel={copy.home.menu} onPress={() => setDrawerOpen(true)} style={styles.menu}>
                <Svg width={22} height={22} viewBox="0 0 24 24">
                  <Path d="M5 8h14M5 16h9" stroke={ink(0.8)} strokeWidth={1.6} strokeLinecap="round" fill="none" />
                </Svg>
              </Pressable>
            )}
          </View>
          <View style={styles.body}>
            {!home && !failure && <LoadingHint />}
            {failure && (
              <Fade>
                <Text accessibilityLiveRegion="polite" style={[type.reading, styles.centered]}>{failure.text}</Text>
                {failure.canRetry && <View style={styles.retry}><TextAction label={copy.tryAgain} size={15} onPress={() => void fetchHome()} /></View>}
              </Fade>
            )}
            {home && (
              <Fade key={soft ?? home.greeting.text} duration={1100}>
                <Text accessibilityLiveRegion="polite" style={[styles.greeting, soft !== null && styles.soft]}>{soft ?? home.greeting.text}</Text>
                {notOpened && <Text style={styles.notOpened}>{copy.home.couldNotOpen}</Text>}
              </Fade>
            )}
          </View>
          <View style={[styles.bottom, { paddingBottom: Math.max(insets.bottom, 12) + 18 }]}>
            {home && !checking && home.items.length > 0 && (
              <LeftOff items={home.items} fadeAfterMs={home.fade_after_ms} cleared={text.length > 0} onOpen={(item: HomeItem) => void open(item.target)} />
            )}
            <Composer inputRef={box} value={text} onChangeText={setText} onSend={() => void submit()} placeholder={copy.home.placeholder} offline={offline} busy={busy || !home} />
          </View>
          {drawer && <Pressable accessibilityLabel={copy.home.menu} onPress={() => setDrawerOpen(false)} style={styles.scrim} />}
        </KeyboardAvoidingView>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.base, overflow: 'hidden' },
  flex: { flex: 1 },
  main: { ...StyleSheet.absoluteFill, overflow: 'hidden' },
  mainPushed: { borderRadius: 28, shadowColor: '#000', shadowOffset: { width: -20, height: 0 }, shadowOpacity: 0.6, shadowRadius: 50 },
  top: { paddingHorizontal: 18, minHeight: 92 },
  menu: { width: 44, height: 44, marginLeft: -3, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 34, paddingBottom: 150 },
  greeting: { fontFamily: type.big.fontFamily, fontSize: 28, lineHeight: 36, color: '#f4f4f2', textAlign: 'center', letterSpacing: -0.14 },
  soft: { fontSize: 22, lineHeight: 31 },
  centered: { textAlign: 'center' },
  retry: { alignSelf: 'center' },
  notOpened: { fontFamily: type.sub.fontFamily, fontSize: 14, color: ink(0.6), textAlign: 'center', marginTop: 18 },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingTop: 12, paddingHorizontal: 16 },
  scrim: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.35)' },
});
