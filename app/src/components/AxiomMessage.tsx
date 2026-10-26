import { StyleSheet, Text } from 'react-native';
import { type } from '../theme';

// A plain Axiom message: serif, no highlight, no buttons. Used for the soft "unclear" reply.
export function AxiomMessage({ text }: { text: string }) {
  return <Text accessibilityLiveRegion="polite" style={[type.big, styles.text]}>{text}</Text>;
}

const styles = StyleSheet.create({
  text: { fontSize: 22, lineHeight: 31, textAlign: 'center' },
});
