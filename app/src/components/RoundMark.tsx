import { Pressable, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Path, Rect } from 'react-native-svg';
import { colors, fonts, goldGradient, ink } from '../theme';

export type MarkName = 'tick' | 'pause' | 'dash' | 'lock';

type Props = { label: string; mark: MarkName; state: 'idle' | 'on' | 'dim'; onPress: () => void };

const STROKE = 1.6;

function Icon({ mark, color }: { mark: MarkName; color: string }) {
  const props = { stroke: color, strokeWidth: STROKE, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, fill: 'none' };
  return (
    <Svg width={16} height={16} viewBox="0 0 24 24">
      {mark === 'tick' && <Path d="M5.5 12.5l4 4 9-9.5" {...props} />}
      {mark === 'pause' && <Path d="M9.5 7.5v9M14.5 7.5v9" {...props} />}
      {mark === 'dash' && <Path d="M7.5 12h9" {...props} />}
      {mark === 'lock' && (
        <>
          <Rect x={7} y={11} width={10} height={7.5} rx={2} {...props} />
          <Path d="M9.5 11V9a2.5 2.5 0 0 1 5 0v2" {...props} />
        </>
      )}
    </Svg>
  );
}

// A small round mark with its label under it, flat and quiet (mock-report-buttons.html, look 4).
// Pressing one only shows it pressed: nothing is posted as a message from the founder.
export function RoundMark({ label, mark, state, onPress }: Props) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: state === 'on' }}
      disabled={state !== 'idle'}
      onPress={onPress}
      style={[styles.mark, state === 'dim' && styles.dim]}
    >
      {({ hovered }: { hovered?: boolean; pressed: boolean }) => (
        <>
          <View style={[styles.circle, hovered && state === 'idle' && styles.circleHover, state === 'on' && styles.circleOn]}>
            {state === 'on' && <LinearGradient colors={goldGradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill} />}
            <Icon mark={mark} color={state === 'on' ? colors.onGold : ink(0.8)} />
          </View>
          <Text style={[styles.label, { color: state === 'on' || hovered ? colors.ink : ink(0.6) }]}>{label}</Text>
        </>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  mark: { alignItems: 'center', gap: 8, minWidth: 56, paddingVertical: 4 },
  dim: { opacity: 0.3 },
  circle: { width: 38, height: 38, borderRadius: 19, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: ink(0.28) },
  circleOn: { borderColor: 'transparent' },
  circleHover: { borderColor: ink(0.6) },
  label: { fontFamily: fonts.sans, fontSize: 12.5, letterSpacing: 0.25 },
});
