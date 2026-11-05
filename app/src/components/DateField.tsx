import { Platform, View } from 'react-native';
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { fromIsoDay, isoDay } from '../move/format';
import { PickerChip } from './PickerChip';

type Props = { value: string | undefined; onChange: (isoDate: string) => void };


export function DateField({ value, onChange }: Props) {
  const at = value ? fromIsoDay(value) : new Date();
  if (Platform.OS === 'android') {
    const text = at.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
    return <PickerChip text={text} onPress={() => DateTimePickerAndroid.open({ mode: 'date', value: at, minimumDate: new Date(), onChange: (e, d) => { if (e.type === 'set' && d) onChange(isoDay(d)); } })} />;
  }
  return (
    <View style={{ alignItems: 'flex-start' }}>
      <DateTimePicker
        mode="date"
        display="compact"
        themeVariant="dark"
        minimumDate={new Date()}
        value={at}
        onChange={(_, d) => d && onChange(isoDay(d))}
      />
    </View>
  );
}
