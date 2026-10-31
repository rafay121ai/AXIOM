import { StyleSheet, Text } from 'react-native';
import { copy } from '../copy';
import { ink, type } from '../theme';
import { Fade } from './Fade';

// A real founder's story, in a quiet outlined card. Used in the Report and in Learn. The lesson shows only when there is one.
export function FounderCard({ story, lesson }: { story: string; lesson?: string | null }) {
  return (
    <Fade style={styles.card}>
      <Text style={styles.label}>{copy.report.storyLabel}</Text>
      <Text style={type.readBody}>{story}</Text>
      {!!lesson && <Text style={[type.readBody, styles.lesson]}>{lesson}</Text>}
    </Fade>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderColor: ink(0.16), borderRadius: 20, padding: 18, marginBottom: 22 },
  label: { ...type.label, color: ink(0.5), marginBottom: 8 },
  lesson: { marginTop: 10 },
});
