import { StyleSheet, View } from 'react-native';
import { colors, gold } from '../theme';

/** The small gold dot with its soft ring: something still to do, or an open situation. */
export function GoldDot() {
  return (
    <View style={styles.halo}>
      <View style={styles.dot} />
    </View>
  );
}

const styles = StyleSheet.create({
  halo: { width: 14, height: 14, borderRadius: 7, backgroundColor: gold(0.16), alignItems: 'center', justifyContent: 'center' },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.goldFrom },
});
