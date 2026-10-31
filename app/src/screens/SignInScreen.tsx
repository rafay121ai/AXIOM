import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Glass } from '../components/Glass';
import { colors, ink, type } from '../theme';
import { IntroSequence, IntroShine } from './IntroSequence';

type Props = { onContinue: () => void; error?: string };

// Black with a warm gold rise. The film (IntroSequence) plays on a fresh open and ends on the emblem and tagline; the button rises in last.
export function SignInScreen({ onContinue, error }: Props) {
  const insets = useSafeAreaInsets();
  return (
    <View style={styles.screen}>
      <IntroSequence>
        <View style={[styles.bottom, { paddingBottom: Math.max(insets.bottom, 12) + 40 }]}>
          {error && <Text style={[type.legal, styles.error]}>{error}</Text>}
          <Glass onPress={onContinue} accessibilityLabel="Continue with Google" contentStyle={styles.button}>
            <IntroShine />
            <Text style={[type.button, { color: colors.ink }]}>Continue with Google</Text>
          </Glass>
          <Text style={[type.legal, styles.legal]}>
            By continuing you agree to the <Text style={styles.link}>Terms</Text> and the <Text style={styles.link}>Privacy Policy</Text>. What you tell Axiom stays private. You choose later whether anything is ever shared.
          </Text>
        </View>
      </IntroSequence>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  bottom: { paddingHorizontal: 34 },
  button: { paddingVertical: 17, alignItems: 'center', minHeight: 56, justifyContent: 'center' },
  error: { textAlign: 'center', marginBottom: 14, color: ink(0.62) },
  legal: { textAlign: 'center', marginTop: 18, marginHorizontal: 6 },
  link: { color: ink(0.62), textDecorationLine: 'underline', textDecorationColor: ink(0.3) },
});
