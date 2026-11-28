import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Glass } from '../components/Glass';
import { Logo } from '../components/Logo';
import { copy } from '../copy';
import { type Film, loadFilm, readyFilm } from '../intro/film';
import { colors, ink, type } from '../theme';

type Props = { onContinue: () => void; error?: string };

// Black with a warm gold rise. The film (IntroSequence) plays on a fresh open and ends on the emblem and tagline; the button rises in last.
// On the web the film's engine downloads first; until it is here the screen shows that end state, never a blank.
export function SignInScreen({ onContinue, error }: Props) {
  const insets = useSafeAreaInsets();
  const [film, setFilm] = useState<Film | null>(readyFilm);
  useEffect(() => {
    if (!film) loadFilm().then(setFilm);
  }, [film]);

  const bottom = (
    <View style={[styles.bottom, { paddingBottom: Math.max(insets.bottom, 12) + 40 }]}>
      {error && <Text style={[type.legal, styles.error]}>{error}</Text>}
      <Glass onPress={onContinue} accessibilityLabel="Continue with Google" contentStyle={styles.button}>
        {film && <film.IntroShine />}
        <Text style={[type.button, { color: colors.ink }]}>Continue with Google</Text>
      </Glass>
      <Text style={[type.legal, styles.legal]}>
        By continuing you agree to the <Text style={styles.link}>Terms</Text> and the <Text style={styles.link}>Privacy Policy</Text>. What you tell Axiom stays private. You choose later whether anything is ever shared.
      </Text>
    </View>
  );

  return (
    <View style={styles.screen}>
      {film ? (
        <film.IntroSequence>{bottom}</film.IntroSequence>
      ) : (
        <>
          <View style={styles.end}>
            <Logo size={92} />
            <Text style={styles.tagline}>{copy.intro.words.map((w) => w.toUpperCase()).join(' ')}</Text>
          </View>
          <View style={styles.rest}>{bottom}</View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  end: { position: 'absolute', left: 0, right: 0, top: '41%', alignItems: 'center', transform: [{ translateY: -46 }] },
  tagline: { marginTop: 28, fontSize: 12.5, fontWeight: '500', letterSpacing: 4, color: ink(0.78) },
  rest: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  bottom: { paddingHorizontal: 34 },
  button: { paddingVertical: 17, alignItems: 'center', minHeight: 56, justifyContent: 'center' },
  error: { textAlign: 'center', marginBottom: 14, color: ink(0.62) },
  legal: { textAlign: 'center', marginTop: 18, marginHorizontal: 6 },
  link: { color: ink(0.62), textDecorationLine: 'underline', textDecorationColor: ink(0.3) },
});
