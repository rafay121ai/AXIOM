import Svg, { Path, Rect } from 'react-native-svg';
import { Pressable, StyleSheet, Text } from 'react-native';
import type { Toolkit } from '../api/types';
import { fonts, gold, ink } from '../theme';

/** Thin line drawings in writing colour, gold when connected (no brand logos). From the connect mock. */
export function ToolIcon({ toolkit, on }: { toolkit: Toolkit; on: boolean }) {
  const p = { fill: 'none', stroke: on ? gold(0.95) : ink(0.7), strokeWidth: 1.3, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;
  return (
    <Svg width={20} height={20} viewBox="0 0 24 24" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {toolkit === 'gmail' && <><Rect x={3} y={5.5} width={18} height={13} rx={2} {...p} /><Path d="M3.5 7l8.5 6 8.5-6" {...p} /></>}
      {toolkit === 'googlecalendar' && <><Rect x={3.5} y={5} width={17} height={15} rx={2} {...p} /><Path d="M3.5 9.5h17M8 3v4M16 3v4" {...p} /></>}
      {toolkit === 'notion' && <><Path d="M6 3.5h8.5L19 8v12.5H6z" {...p} /><Path d="M14.5 3.5V8H19M9 12h7M9 15.5h5" {...p} /></>}
    </Svg>
  );
}

/** Connect / Reconnect: a text action with a gold hairline. While the browser is open it goes quiet. */
export function ConnectAction({ label, waiting, onPress, hint }: { label: string; waiting: boolean; onPress: () => void; hint: string }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${label} ${hint}`} accessibilityState={{ busy: waiting }} disabled={waiting} onPress={onPress} style={styles.target}>
      <Text style={[styles.text, waiting && styles.waiting]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  target: { minHeight: 44, justifyContent: 'center', paddingLeft: 10 },
  text: { fontFamily: fonts.sans, fontSize: 14.5, color: ink(0.82), paddingVertical: 2, borderBottomWidth: 1, borderBottomColor: gold(0.55) },
  waiting: { color: ink(0.45), borderBottomColor: 'transparent' },
});
