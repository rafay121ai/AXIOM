import { createElement } from 'react';
import { ink, type } from '../theme';

type Props = { value: string; onChange: (hhmm: string) => void; label: string };

export function TimeField({ value, onChange, label }: Props) {
  return createElement('input', {
    type: 'time',
    value,
    'aria-label': label,
    onChange: (e: { target: { value: string } }) => e.target.value && onChange(e.target.value),
    style: {
      background: 'transparent', border: 0, borderBottom: `1px solid ${ink(0.22)}`, color: type.field.color,
      fontFamily: 'inherit', fontSize: type.field.fontSize, padding: '8px 0', outline: 'none', colorScheme: 'dark',
    },
  });
}
