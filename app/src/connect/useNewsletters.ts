import { useCallback, useEffect, useRef, useState } from 'react';
import { HttpError } from '../api/queue';
import type { Newsletter } from '../api/types';
import { connectLine, type ConnectorsApi, newsletterSaver } from './flow';

/** Settings' newsletter list while Gmail is connected. `list` stays null when the server has none to offer (off, unreachable); a refusal (care, account deleting) sets `line` instead. A tap saves at once; saves run one after another, and if the last one fails the list goes back to what the server last confirmed. */
export function useNewsletters(api: ConnectorsApi, gmailOn: boolean) {
  const [list, setList] = useState<Newsletter[] | null>(null);
  const [line, setLine] = useState<string | null>(null);
  const live = useRef(true);
  const current = useRef(list);
  current.current = list;
  const save = useRef<ReturnType<typeof newsletterSaver> | null>(null);
  useEffect(() => () => { live.current = false; }, []);
  useEffect(() => {
    if (!gmailOn) { setList(null); setLine(null); return; }
    api.getNewsletters().then(
      (l) => {
        if (!live.current) return;
        setList(l);
        if (l) save.current = newsletterSaver(api, l, { onSaved: (v) => live.current && setList(v), onFailed: (v, e) => { if (live.current) { setList(v); setLine(connectLine(e)); } } });
      },
      (e) => { if (live.current && e instanceof HttpError && e.line) setLine(e.line); },
    );
  }, [api, gmailOn]);

  const toggle = useCallback((id: string) => {
    const before = current.current;
    if (!before) return;
    const next = before.map((n) => (n.id === id ? { ...n, watching: !n.watching } : n));
    setList(next);
    setLine(null);
    save.current?.(next.filter((n) => n.watching).map((n) => n.id));
  }, []);

  return { list, line, toggle };
}
