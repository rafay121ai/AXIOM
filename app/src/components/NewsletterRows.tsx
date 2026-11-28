import { Pressable, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Path } from 'react-native-svg';
import type { Newsletter } from '../api/types';
import { newsletterSub } from '../connect/flow';
import { colors, fonts, goldGradient, ink } from '../theme';
import { Fade } from './Fade';

type Props = { items: Newsletter[]; onToggle: (id: string) => void; delay?: number };

// One checkbox row per newsletter, a gold round tick when watched (mock-newsletters-v1.html).
export function NewsletterRows({ items, onToggle, delay = 0 }: Props) {
  return (
    <View style={styles.list}>
      {items.map((n, i) => (
        <Fade key={n.id} delay={delay + i * 80}>
          <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: n.watching }} accessibilityLabel={`${n.name}, ${newsletterSub(n)}`} onPress={() => onToggle(n.id)} style={styles.row}>
            <View style={styles.flex}>
              <Text style={styles.name}>{n.name}</Text>
              <Text style={styles.sub}>{newsletterSub(n)}</Text>
            </View>
            <View style={[styles.mark, n.watching && styles.markOn]}>
              {n.watching && (
                <>
                  <LinearGradient colors={goldGradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill} />
                  <Svg width={13} height={13} viewBox="0 0 16 16"><Path d="M3 8.5l3.2 3L13 4.5" fill="none" stroke={colors.onGold} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" /></Svg>
                </>
              )}
            </View>
          </Pressable>
        </Fade>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { borderBottomWidth: 1, borderBottomColor: ink(0.14) },
  flex: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 60, paddingVertical: 8, borderTopWidth: 1, borderTopColor: ink(0.14) },
  name: { fontFamily: fonts.sans, fontSize: 16, color: ink(0.92) },
  sub: { fontFamily: fonts.sans, fontSize: 12.5, color: ink(0.45), marginTop: 2 },
  mark: { width: 26, height: 26, borderRadius: 13, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: ink(0.35) },
  markOn: { borderColor: 'transparent' },
});
