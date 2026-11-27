import { Linking, ScrollView, StyleSheet, Text } from 'react-native';
import { PageHeader } from '../components/PageHeader';
import { TextAction } from '../components/TextAction';
import { Wash } from '../components/Wash';
import { copy } from '../copy';
import { fonts, ink } from '../theme';

// The "Learn how I work" part of the privacy page, word for word from the connect mock.
export function HowScreen({ privacyUrl, onBack }: { privacyUrl: string | null; onBack: () => void }) {
  const [lead, ...rest] = copy.connect.how;
  return (
    <>
      <Wash />
      <PageHeader title={copy.connect.howTitle} onBack={onBack} />
      <ScrollView contentContainerStyle={styles.body}>
        <Text style={styles.lead}>{lead}</Text>
        {rest.map((p) => <Text key={p} style={styles.p}>{p}</Text>)}
        {privacyUrl && <TextAction label={copy.connect.privacyPage} size={14} onPress={() => void Linking.openURL(privacyUrl).catch(() => {})} />}
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 24, paddingTop: 14, paddingBottom: 40, alignItems: 'flex-start' },
  lead: { fontFamily: fonts.serif, fontSize: 19, lineHeight: 27.5, color: '#f4f4f2', marginBottom: 14 },
  p: { fontFamily: fonts.sans, fontSize: 15, lineHeight: 23.25, color: ink(0.78), marginBottom: 14 },
});
