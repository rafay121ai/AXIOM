import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Glass } from '../components/Glass';
import { Logo } from '../components/Logo';
import { colors, ink, type } from '../theme';

type Props = { onContinue: () => void; error?: string };

// Logo only, no wordmark. The brighter short line is not written yet, so there is none.
export function SignInScreen({ onContinue, error }: Props) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.screen, { paddingTop: insets.top + 100, paddingBottom: Math.max(insets.bottom, 12) + 40 }]}>
      <Logo size={84} />
      <View style={styles.bottom}>
        {error && <Text style={[type.legal, styles.error]}>{error}</Text>}
        <Glass onPress={onContinue} accessibilityLabel="Continue with Google" contentStyle={styles.button}>
          <Text style={[type.button, { color: colors.ink }]}>Continue with Google</Text>
        </Glass>
        <Text style={[type.legal, styles.legal]}>
          By continuing you agree to the <Text style={styles.link}>Terms</Text> and the <Text style={styles.link}>Privacy Policy</Text>. What you tell Axiom stays private. You choose later whether anything is ever shared.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 34 },
  bottom: { width: '100%' },
  button: { paddingVertical: 17, alignItems: 'center', minHeight: 56, justifyContent: 'center' },
  error: { textAlign: 'center', marginBottom: 14, color: ink(0.62) },
  legal: { textAlign: 'center', marginTop: 18, marginHorizontal: 6 },
  link: { color: ink(0.62), textDecorationLine: 'underline', textDecorationColor: ink(0.3) },
});
