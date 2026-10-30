import { View } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';

type Props = { value: string; onChange: (hhmm: string) => void; label: string };

const pad = (n: number) => String(n).padStart(2, '0');

/** A time of day as 'HH:MM'. */
export function TimeField({ value, onChange }: Props) {
  const [h, m] = value.split(':').map(Number);
  const at = new Date();
  at.setHours(h, m, 0, 0);
  return (
    <View style={{ alignItems: 'flex-start' }}>
      <DateTimePicker mode="time" display="compact" themeVariant="dark" value={at} onChange={(_, d) => d && onChange(`${pad(d.getHours())}:${pad(d.getMinutes())}`)} />
    </View>
  );
}
