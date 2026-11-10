import { Platform, StyleSheet, Text, TextInput, View } from 'react-native';
import type { Answer, GoalAnswer, Question, SingleAnswer, TwoAnswer, WhereAnswer } from '../api/types';
import { countrySuggestions, tapSingle, tapTwo } from '../onboarding/flow';
import { ink, type } from '../theme';
import { Chip, Row } from './Choice';
import { DateField } from './DateField';
import { Field } from './Field';

// The input for one sign-up question, shared by the first questions and by editing an answer later in Settings.
type BodyProps = { q: Question; a: Answer | undefined; set: (next: Answer, forceAdvance?: boolean) => void };

export function QuestionBody({ q, a, set }: BodyProps) {
  switch (q.type) {
    case 'single': {
      const s = a as SingleAnswer | undefined;
      return (
        <View>
          {q.options.map((o) => (
            <Row key={o} label={o} selected={s?.value === o} onPress={() => set(tapSingle(o))} />
          ))}
        </View>
      );
    }
    case 'where': {
      const w = (a as WhereAnswer | undefined) ?? {};
      const suggestions = countrySuggestions(q.countries, w.country ?? '');
      return (
        <View>
          <Text style={[type.label, styles.label, { marginTop: 6 }]}>{q.countryLabel}</Text>
          <Field
            placeholder={q.countryPlaceholder}
            value={w.country ?? ''}
            onChangeText={(country) => set({ ...w, country })}
            autoCapitalize="words"
          />
          {suggestions.length > 0 && (
            <View style={[styles.chips, styles.gapTop]}>
              {suggestions.map((c) => <Chip key={c} label={c} selected={false} onPress={() => set({ ...w, country: c })} />)}
            </View>
          )}
          <Text style={[type.label, styles.label]}>{q.customerLabel}</Text>
          <View style={styles.chips}>
            {q.customers.map((c) => (
              <Chip key={c} label={c} selected={w.customers === c} onPress={() => set({ ...w, customers: c }, true)} />
            ))}
          </View>
        </View>
      );
    }
    case 'goal': {
      const g = (a as GoalAnswer | undefined) ?? {};
      return (
        <View>
          <View style={styles.chips}>
            {q.goals.map((o) => <Chip key={o} label={o} selected={g.goal === o} onPress={() => set({ ...g, goal: o })} />)}
          </View>
          <Text style={[type.label, styles.label]}>{q.whenLabel}</Text>
          <View style={styles.chips}>
            {q.whens.map((o) => <Chip key={o} label={o} selected={g.when === o} onPress={() => set({ ...g, when: o })} />)}
          </View>
          {g.when === q.dateOption && (
            <View style={{ marginTop: 16 }}>
              <DateField value={g.date} onChange={(date) => set({ ...g, date })} />
            </View>
          )}
        </View>
      );
    }
    case 'two': {
      const t = (a as TwoAnswer | undefined) ?? { a: [], b: [] };
      return (
        <View>
          {q.groups.map((group, n) => (
            <View key={group.label}>
              <Text style={[type.label, styles.label, n === 0 && { marginTop: 2 }]}>{group.label}</Text>
              <View style={styles.chips}>
                {group.options.map((o) => (
                  <Chip key={o} label={o} selected={(n === 0 ? t.a : t.b).includes(o)} onPress={() => set(tapTwo(a, n as 0 | 1, o))} />
                ))}
              </View>
            </View>
          ))}
        </View>
      );
    }
    case 'text': {
      const v = typeof a === 'string' ? a : '';
      return (
        <View>
          <TextInput
            multiline
            value={v}
            onChangeText={set}
            placeholder={q.placeholder}
            placeholderTextColor={ink(0.28)}
            style={[type.big, styles.big]}
            textAlignVertical="top"
          />
          <Text style={styles.shortHint}>{v.trim().length >= q.minLength ? '' : q.shortHint ?? ''}</Text>
        </View>
      );
    }
  }
}

const styles = StyleSheet.create({
  label: { marginTop: 28, marginBottom: 12 },
  gapTop: { marginTop: 22 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
  big: {
    minHeight: 210, paddingVertical: 18, paddingHorizontal: 2, borderTopWidth: 1, borderBottomWidth: 1, borderColor: ink(0.12),
    ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null),
  },
  shortHint: { fontFamily: type.sub.fontFamily, fontSize: 12, color: ink(0.4), marginTop: 10, minHeight: 16 },
});
