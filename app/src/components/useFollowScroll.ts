import { useCallback, useRef } from 'react';
import type { LayoutChangeEvent, ScrollViewInstance } from 'react-native';

// Keeps Axiom's newest words readable from their first line: when they arrive, the view scrolls so their top sits
// just under the menu bar (instead of jumping to the end and pushing that line under the top fade). After the
// founder writes, or when the newest words fit, it scrolls to the end as before.
export function useFollowScroll(topInset: number) {
  const ref = useRef<ScrollViewInstance>(null);
  const view = useRef(0);
  const content = useRef(0);
  const anchor = useRef<number | null>(null);

  const follow = useCallback(() => {
    const end = Math.max(0, content.current - view.current);
    const y = anchor.current === null ? end : Math.min(end, Math.max(0, anchor.current - topInset));
    ref.current?.scrollTo({ y, animated: true });
  }, [topInset]);

  return {
    ref,
    onLayout: (e: LayoutChangeEvent) => { view.current = e.nativeEvent.layout.height; },
    onContentSizeChange: (_w: number, h: number) => { content.current = h; follow(); },
    /** onLayout for the newest item: `axiom` true keeps its top in view, false (the founder's words) follows the end. */
    newest: (axiom: boolean) => (e: LayoutChangeEvent) => { anchor.current = axiom ? e.nativeEvent.layout.y : null; follow(); },
  };
}
