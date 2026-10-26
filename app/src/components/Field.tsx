import { useState } from 'react';
import { StyleSheet, TextInput, type TextInputProps } from 'react-native';
import { gold, ink, type } from '../theme';

/** A single line with a thin underline that turns gold in focus. */
export function Field(props: TextInputProps) {
  const [focus, setFocus] = useState(false);
  return (
    <TextInput
      placeholderTextColor={ink(0.3)}
      selectionColor={gold(1)}
      {...props}
      onFocus={(e) => { setFocus(true); props.onFocus?.(e); }}
      onBlur={(e) => { setFocus(false); props.onBlur?.(e); }}
      style={[type.field, styles.field, { borderBottomColor: focus ? gold(0.8) : ink(0.22) }, props.style]}
    />
  );
}

const styles = StyleSheet.create({
  field: { paddingVertical: 10, borderBottomWidth: 1 },
});
