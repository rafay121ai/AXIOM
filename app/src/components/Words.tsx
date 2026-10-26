import { useEffect, useRef, useState } from 'react';
import { Text, type TextStyle } from 'react-native';
import { useReduceMotion } from './useReduceMotion';

/** Words filled in one at a time; the rest is already in place but invisible, so nothing jumps. */
export const WORD_MS = 45;

/** The first `count` words of a text, split so spaces stay with the word before them. */
export function splitAt(text: string, count: number): [string, string] {
  const words = text.match(/\S+\s*/g) ?? [];
  return [words.slice(0, count).join(''), words.slice(count).join('')];
}

type Props = { text: string; style: TextStyle | TextStyle[]; animate: boolean; onDone?: () => void };

// Axiom's answer arriving in the place the loading hint held: word by word. Reduced motion, or an
// answer already seen, shows the whole text at once.
export function Words({ text, style, animate, onDone }: Props) {
  const reduce = useReduceMotion();
  const total = (text.match(/\S+\s*/g) ?? []).length;
  const instant = reduce || !animate;
  const [count, setCount] = useState(instant ? total : 0);
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    if (instant) return;
    const timer = setInterval(() => setCount((c) => Math.min(c + 1, total)), WORD_MS);
    return () => clearInterval(timer);
  }, [instant, total]);
  const filled = instant || count >= total;
  useEffect(() => {
    if (filled) done.current?.();
  }, [filled]);
  const [shown, rest] = splitAt(text, instant ? total : count);
  return (
    <Text style={style}>
      {shown}
      <Text style={{ color: 'transparent' }}>{rest}</Text>
    </Text>
  );
}
