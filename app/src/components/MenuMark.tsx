import { LinearGradient } from 'expo-linear-gradient';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { copy } from '../copy';
import { colors } from '../theme';
import { Logo } from './Logo';

// The menu button everywhere: the emblem as a thin line (Rafay, Nov 2). On home it opens the menu; on Situation,
// Read and Learn it goes home with the menu open, and the situation stays open.
export function MenuMark({ onPress }: { onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={copy.home.menu} onPress={onPress} hitSlop={10} style={styles.mark}>
      <Logo size={26} line />
    </Pressable>
  );
}

// Situation, Read and Learn: the button pinned top left, over a fade so scrolling text dissolves under it.
// Screens start their text at insets.top + MENU_BAR so nothing sits under the fade at rest.
export const MENU_BAR = 140;
export function MenuBar({ onPress }: { onPress: () => void }) {
  const insets = useSafeAreaInsets();
  return (
    <View pointerEvents="box-none" style={[styles.bar, { height: insets.top + 140 }]}>
      <LinearGradient pointerEvents="none" colors={[colors.base, colors.base, 'rgba(5,5,5,0)']} locations={[0, 0.72, 1]} style={StyleSheet.absoluteFill} />
      <View style={[styles.place, { top: insets.top + 54 }]}><MenuMark onPress={onPress} /></View>
    </View>
  );
}

const styles = StyleSheet.create({
  mark: { width: 44, height: 44, marginLeft: -9, alignItems: 'center', justifyContent: 'center' },
  bar: { position: 'absolute', top: 0, left: 0, right: 0 },
  place: { position: 'absolute', left: 18 },
});
