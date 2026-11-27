import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { Toolkit } from '../api/types';
import { copy } from '../copy';
import { type ConnectorsApi, TOOLKITS, toolName } from '../connect/flow';
import type { useConnectors } from '../connect/useConnectors';
import { fonts, gold, ink } from '../theme';
import { Switch } from './Switch';
import { TextAction } from './TextAction';
import { ConnectAction, ToolIcon } from './ToolIcon';

type Props = { api: ConnectorsApi; cx: ReturnType<typeof useConnectors>; onHow: () => void };

// Settings, Connections: one plain line per tool. A connected one opens to Disconnect and Delete what Axiom learned.
export function ConnectionRows({ api, cx, onHow }: Props) {
  const [open, setOpen] = useState<Toolkit | null>(null);
  const { data, waiting, line, attempt, connect, setLearn, refresh } = cx;
  if (!data) return null;
  const say = (key: 'disconnected' | 'forgotten', toolkit: Toolkit) => copy.connect[key].replace('{tool}', toolName(toolkit));
  return (
    <>
      {TOOLKITS.map((toolkit, n) => {
        const status = data.connectors.find((c) => c.toolkit === toolkit)?.status ?? 'not_connected';
        const name = toolName(toolkit);
        const isOpen = open === toolkit;
        return (
          <View key={toolkit} style={n > 0 && styles.line}>
            {status === 'active' ? (
              <Pressable accessibilityRole="button" accessibilityLabel={`${name}, ${copy.connect.connected}`} accessibilityState={{ expanded: isOpen }} onPress={() => setOpen(isOpen ? null : toolkit)} style={styles.row}>
                <ToolIcon toolkit={toolkit} on />
                <Text style={[styles.name, styles.flex]}>{name}</Text>
                <View style={styles.dot} />
                <Text style={styles.status}>{copy.connect.connected}</Text>
                <Text style={[styles.chev, isOpen && styles.chevOpen]}>›</Text>
              </Pressable>
            ) : (
              <View style={styles.row}>
                <ToolIcon toolkit={toolkit} on={false} />
                <View style={styles.flex}>
                  <Text style={styles.name}>{name}</Text>
                  {status === 'needs_reconnect' && <Text style={styles.sub}>{copy.connect.needsYou.replace('{tool}', name)}</Text>}
                </View>
                <ConnectAction label={status === 'needs_reconnect' ? copy.connect.reconnect : copy.connect.connect} hint={name} waiting={waiting === toolkit} onPress={() => void connect(toolkit)} />
              </View>
            )}
            {isOpen && status === 'active' && (
              <View style={styles.actions}>
                {toolkit === 'notion' && <TextAction label={copy.connect.choosePages} size={14} onPress={() => void connect(toolkit)} />}
                <TextAction label={copy.connect.disconnect} size={14} onPress={() => { setOpen(null); void attempt(async () => { await api.disconnectConnector(toolkit); await refresh(); }, say('disconnected', toolkit)); }} />
                <TextAction label={copy.connect.forget.replace('{tool}', name)} size={14} onPress={() => void attempt(async () => { await api.forgetConnector(toolkit); }, say('forgotten', toolkit))} />
              </View>
            )}
          </View>
        );
      })}
      {line && <Text accessibilityLiveRegion="polite" style={styles.note}>{line}</Text>}
      <View style={[styles.row, styles.line, styles.learn]}>
        <View style={styles.flex}>
          <Text style={styles.learnText}>{copy.connect.learn}</Text>
          <TextAction label={copy.connect.howLink} size={12.5} onPress={onHow} />
        </View>
        <Switch on={data.learn_how_i_work} label={copy.connect.learn} onChange={(v) => void setLearn(v)} />
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  line: { borderTopWidth: 1, borderTopColor: ink(0.08) },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 56, paddingVertical: 8 },
  name: { fontFamily: fonts.sans, fontSize: 16, color: ink(0.92) },
  sub: { fontFamily: fonts.sans, fontSize: 12.5, color: ink(0.45), marginTop: 2 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: gold(1) },
  status: { fontFamily: fonts.sans, fontSize: 13, color: ink(0.5) },
  chev: { fontSize: 19, color: ink(0.35) },
  chevOpen: { color: gold(0.9), transform: [{ rotate: '90deg' }] },
  actions: { flexDirection: 'row', flexWrap: 'wrap', marginLeft: -8, paddingBottom: 8, borderTopWidth: 1, borderTopColor: gold(0.4) },
  note: { fontFamily: fonts.sans, fontSize: 12.5, lineHeight: 18.75, color: ink(0.5), paddingBottom: 12 },
  learn: { alignItems: 'flex-start', paddingTop: 16 },
  learnText: { fontFamily: fonts.sans, fontSize: 15, lineHeight: 21.75, color: ink(0.9) },
});
