import type { Ref } from 'react';
import { Pressable, StyleSheet, Text, View, type ViewInstance } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { copy } from '../copy';
import { fonts, ink } from '../theme';

// The top of History, a past situation and Settings: a back arrow and a serif title.
export function PageHeader({ title, onBack, backRef }: { title?: string; onBack: () => void; backRef?: Ref<ViewInstance> }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.head, { paddingTop: insets.top + 56 }]}>
      <Pressable ref={backRef} accessibilityRole="button" accessibilityLabel={copy.history.back} onPress={onBack} style={styles.back}>
        <Text style={styles.arrow}>‹</Text>
      </Pressable>
      <Text accessibilityRole="header" style={styles.title}>{title ?? ''}</Text>
      <View style={styles.back} />
    </View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, paddingBottom: 10 },
  back: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  arrow: { fontSize: 28, lineHeight: 30, color: ink(0.85), paddingBottom: 4 },
  title: { fontFamily: fonts.serif, fontSize: 20, color: '#f4f4f2' },
});
