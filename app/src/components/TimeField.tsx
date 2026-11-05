import { Platform, View } from 'react-native';
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { clockTime } from '../move/format';
import { PickerChip } from './PickerChip';

type Props = { value: string; onChange: (hhmm: string) => void; label: string };

const pad = (n: number) => String(n).padStart(2, '0');

/** A time of day as 'HH:MM'. */
export function TimeField({ value, onChange }: Props) {
  const [h, m] = value.split(':').map(Number);
  const at = new Date();
  at.setHours(h, m, 0, 0);
  const save = (d: Date) => onChange(`${pad(d.getHours())}:${pad(d.getMinutes())}`);
  if (Platform.OS === 'android') {
    return <PickerChip text={clockTime(value)} onPress={() => DateTimePickerAndroid.open({ mode: 'time', value: at, onChange: (e, d) => { if (e.type === 'set' && d) save(d); } })} />;
  }
  return (
    <View style={{ alignItems: 'flex-start' }}>
      <DateTimePicker mode="time" display="compact" themeVariant="dark" value={at} onChange={(_, d) => d && save(d)} />
    </View>
  );
}
