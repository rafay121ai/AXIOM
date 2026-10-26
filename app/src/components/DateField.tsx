import { View } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';

type Props = { value: string | undefined; onChange: (isoDate: string) => void };

const iso = (d: Date) => d.toISOString().slice(0, 10);

export function DateField({ value, onChange }: Props) {
  return (
    <View style={{ alignItems: 'flex-start' }}>
      <DateTimePicker
        mode="date"
        display="compact"
        themeVariant="dark"
        minimumDate={new Date()}
        value={value ? new Date(value) : new Date()}
        onChange={(_, d) => d && onChange(iso(d))}
      />
    </View>
  );
}
