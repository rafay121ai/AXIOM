import { createElement } from 'react';
import { ink, type } from '../theme';

type Props = { value: string | undefined; onChange: (isoDate: string) => void };

export function DateField({ value, onChange }: Props) {
  return createElement('input', {
    type: 'date',
    value: value ?? '',
    onChange: (e: { target: { value: string } }) => onChange(e.target.value),
    style: {
      width: '100%', background: 'transparent', border: 0, borderBottom: `1px solid ${ink(0.22)}`,
      color: type.field.color, fontFamily: 'inherit', fontSize: type.field.fontSize, padding: '10px 0', outline: 'none', colorScheme: 'dark',
    },
  });
}
