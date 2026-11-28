import { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
import type { Connectors, Newsletter } from '../api/types';
import { ConnectAction, ToolIcon } from '../components/ToolIcon';
import { Fade } from '../components/Fade';
import { GoldButton } from '../components/GoldButton';
import { Logo } from '../components/Logo';
import { Switch } from '../components/Switch';
import { TextAction } from '../components/TextAction';
import { Wash } from '../components/Wash';
import { copy } from '../copy';
import type { KeyValueStore } from '../api/outbox';
import { anyConnected, type ConnectorsApi, newsletterGate, TOOLKITS } from '../connect/flow';
import { useConnectors } from '../connect/useConnectors';
import { fonts, gold, ink, space } from '../theme';
import { NewsletterPicker } from './NewsletterPicker';

type Props = { api: ConnectorsApi; first: Connectors; store: KeyValueStore; onDone: () => void };

// Shown once, right after the first reading. One job: connect a tool, or not now. Continue replaces Not now once one is connected.
export function ConnectScreen({ api, first, store, onDone }: Props) {
  const insets = useSafeAreaInsets();
  const { data, waiting, line, connect, setLearn } = useConnectors(api, first);
  const rows = data ?? first;
  // null: the connect screen. 'looking': counting newsletters. A list: the picker.
  const [picking, setPicking] = useState<'looking' | Newsletter[] | null>(null);
  const gmailOn = rows.connectors.find((c) => c.toolkit === 'gmail')?.status === 'active';
  const wasOn = useRef(gmailOn);
  const live = useRef(true);
  useEffect(() => () => { live.current = false; }, []);
  // The first time Gmail turns active here, offer the newsletters; an empty or failed lookup goes quietly back.
  useEffect(() => {
    if (!gmailOn || wasOn.current) { wasOn.current = gmailOn; return; }
    wasOn.current = true;
    setPicking('looking');
    void newsletterGate(api, store).then((list) => live.current && setPicking(list));
  }, [gmailOn, api, store]);
  if (picking) return <NewsletterPicker api={api} list={picking === 'looking' ? null : picking} onDone={() => setPicking(null)} />;
  return (
    <View style={styles.screen}>
      <Wash />
      <ScrollView contentContainerStyle={[styles.body, { paddingTop: insets.top + 92, paddingBottom: Math.max(insets.bottom, 12) + 34 }]}>
        <Fade delay={100}><View style={styles.emblem}><Logo size={34} /></View></Fade>
        <Fade delay={250}><Text accessibilityRole="header" style={styles.lead}>{copy.connect.lead}</Text></Fade>
        <Fade delay={550}><Text style={styles.lead2}>{copy.connect.lead2}</Text></Fade>
        <View style={styles.tools}>
          {TOOLKITS.map((toolkit, n) => {
            const t = copy.connect.tools[toolkit];
            const on = rows.connectors.find((c) => c.toolkit === toolkit)?.status === 'active';
            return (
              <Fade key={toolkit} delay={800 + n * 120} style={[styles.tool]}>
                <ToolIcon toolkit={toolkit} on={on} />
                <View style={styles.flex}>
                  <Text style={styles.name}>{t.name}</Text>
                  <Text style={styles.hint}>{t.hint}</Text>
                </View>
                {on ? (
                  <View style={styles.ok} accessible accessibilityLabel={`${t.name} ${copy.connect.connected}`}>
                    <Svg width={15} height={15} viewBox="0 0 16 16"><Path d="M3 8.5l3.2 3L13 4.5" fill="none" stroke={gold(1)} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" /></Svg>
                    <Text style={styles.okText}>{copy.connect.connected}</Text>
                  </View>
                ) : <ConnectAction label={copy.connect.connect} hint={t.name} waiting={waiting === toolkit} onPress={() => void connect(toolkit)} />}
              </Fade>
            );
          })}
        </View>
        <Fade delay={1250} style={styles.learn}>
          <Text style={styles.learnText}>{copy.connect.learn}</Text>
          <Switch on={rows.learn_how_i_work} label={copy.connect.learn} onChange={(v) => void setLearn(v)} />
        </Fade>
        {line && <Text accessibilityLiveRegion="polite" style={styles.line}>{line}</Text>}
        <View style={styles.grow} />
        <Fade delay={1400} style={styles.foot}>
          {anyConnected(rows) ? <GoldButton label={copy.connect.continue} onPress={onDone} /> : <TextAction label={copy.connect.notNow} size={14} onPress={onDone} />}
        </Fade>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  flex: { flex: 1 },
  grow: { flex: 1, minHeight: 24 },
  body: { flexGrow: 1, paddingHorizontal: space.screenX },
  emblem: { marginBottom: 26 },
  lead: { fontFamily: fonts.serif, fontSize: 27, lineHeight: 34.5, color: '#f4f4f2' },
  lead2: { fontFamily: fonts.serif, fontSize: 18.5, lineHeight: 27.75, color: ink(0.72), marginTop: 14 },
  tools: { marginTop: 40, borderBottomWidth: 1, borderBottomColor: ink(0.14) },
  tool: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 60, borderTopWidth: 1, borderTopColor: ink(0.14) },
  name: { fontFamily: fonts.sans, fontSize: 16, color: ink(0.92) },
  hint: { fontFamily: fonts.sans, fontSize: 12.5, color: ink(0.45), marginTop: 2 },
  ok: { flexDirection: 'row', alignItems: 'center', gap: 7, minHeight: 44 },
  okText: { fontFamily: fonts.sans, fontSize: 14.5, color: ink(0.6) },
  learn: { flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 30 },
  learnText: { flex: 1, fontFamily: fonts.sans, fontSize: 14.5, lineHeight: 21, color: ink(0.82) },
  line: { fontFamily: fonts.sans, fontSize: 13, lineHeight: 19, color: ink(0.6), marginTop: 14 },
  foot: { alignItems: 'center', marginTop: 24 },
});
