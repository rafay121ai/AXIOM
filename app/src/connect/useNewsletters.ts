import { useCallback, useEffect, useRef, useState } from 'react';
import type { Newsletter } from '../api/types';
import { connectLine, type ConnectorsApi } from './flow';

/** Settings' newsletter list while Gmail is connected. `list` stays null when the server has none to offer (off, refused, unreachable): then no Newsletters action shows. A tap saves at once and goes back if it does not save. */
export function useNewsletters(api: ConnectorsApi, gmailOn: boolean) {
  const [list, setList] = useState<Newsletter[] | null>(null);
  const [line, setLine] = useState<string | null>(null);
  const live = useRef(true);
  const current = useRef(list);
  current.current = list;
  useEffect(() => () => { live.current = false; }, []);
  useEffect(() => {
    if (!gmailOn) { setList(null); return; }
    api.getNewsletters().then((l) => live.current && setList(l), () => {});
  }, [api, gmailOn]);

  const toggle = useCallback(async (id: string) => {
    const before = current.current;
    if (!before) return;
    const next = before.map((n) => (n.id === id ? { ...n, watching: !n.watching } : n));
    setList(next);
    setLine(null);
    try {
      const saved = await api.setNewsletters(next.filter((n) => n.watching).map((n) => n.id));
      if (live.current) setList(saved);
    } catch (e) {
      if (!live.current) return;
      setList(before);
      setLine(connectLine(e));
    }
  }, [api]);

  return { list, line, toggle };
}
