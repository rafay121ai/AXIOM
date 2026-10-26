import { type RefObject, useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, TextInput, type TextInputInstance, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { colors, glass, goldGradient, gold, ink, type } from '../theme';
import { copy } from '../copy';
import { GlassFill } from './Glass';

type Props = {
  value: string;
  onChangeText: (text: string) => void;
  onSend: () => void;
  placeholder: string;
  /** No connection: the hint becomes the "saved" line, with a small gold dot. */
  offline?: boolean;
  /** A reply is on its way: typing still works, sending waits. */
  busy?: boolean;
  /** Lets the screen focus the box, for instance after a suggestion is tapped. */
  inputRef?: RefObject<TextInputInstance | null>;
};

const MAX_HEIGHT = 164;

// The chat bar: floating frosted glass, a growing text box, a gold send button. Enter sends, Shift+Enter adds a line.
export function Composer({ value, onChangeText, onSend, placeholder, offline = false, busy = false, inputRef }: Props) {
  const [height, setHeight] = useState(0);
  const own = useRef<TextInputInstance>(null);
  const input = inputRef ?? own;
  // On the web the box is a textarea: shrink it, then grow it to fit what is typed.
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const el = input.current as unknown as HTMLTextAreaElement | null;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT)}px`;
  }, [value, input]);
  const canSend = value.trim().length > 0 && !busy;
  return (
    <View style={styles.bar}>
      <GlassFill />
      {offline && <View style={styles.dot} />}
      <TextInput
        ref={input}
        multiline
        numberOfLines={1}
        value={value}
        onChangeText={onChangeText}
        placeholder={offline ? copy.noConnection : placeholder}
        placeholderTextColor={ink(0.55)}
        selectionColor={gold(1)}
        accessibilityLabel={placeholder}
        onContentSizeChange={(e) => Platform.OS !== 'web' && setHeight(e.nativeEvent.contentSize.height)}
        onKeyPress={(e) => {
          const key = e.nativeEvent as unknown as { key: string; shiftKey?: boolean };
          if (Platform.OS === 'web' && key.key === 'Enter' && !key.shiftKey) {
            e.preventDefault();
            if (canSend) onSend();
          }
        }}
        underlineColorAndroid="transparent"
        style={[styles.input, Platform.OS !== 'web' && { height: Math.min(Math.max(height, 24) + 14, MAX_HEIGHT) }]}
      />
      <Pressable accessibilityRole="button" accessibilityLabel={copy.send} disabled={!canSend} onPress={onSend} style={[styles.send, !canSend && styles.sendOff]}>
        {canSend && <LinearGradient colors={goldGradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />}
        <Text style={styles.arrow}>↑</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row', alignItems: 'flex-end', gap: 10, overflow: 'hidden', borderRadius: 22, borderWidth: 1, borderColor: ink(glass.edge),
    paddingVertical: 10, paddingLeft: 18, paddingRight: 10,
  },
  input: {
    position: 'relative', flex: 1, ...type.field, fontSize: 15.5, lineHeight: 22, paddingVertical: 7, backgroundColor: 'transparent',
    ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : {}),
  },
  dot: { width: 5, height: 5, borderRadius: 3, marginRight: -4, marginBottom: 20, backgroundColor: gold(1) },
  send: { width: 36, height: 36, borderRadius: 18, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  sendOff: { backgroundColor: ink(0.2), opacity: 0.3 },
  arrow: { fontSize: 17, color: colors.onGold },
});
