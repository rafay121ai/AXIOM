import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { openBrowserAsync } from 'expo-web-browser';
import type { Connectors, Toolkit } from '../api/types';
import { connectLine, connectTool, type ConnectorsApi } from './flow';

// The rows and the switch, kept in step with the server. Coming back from the browser (or to the app) reads them again.
export function useConnectors(api: ConnectorsApi, first: Connectors | null = null) {
  const [data, setData] = useState<Connectors | null>(first);
  const [waiting, setWaiting] = useState<Toolkit | null>(null);
  const [line, setLine] = useState<string | null>(null);
  const live = useRef(true);
  useEffect(() => () => { live.current = false; }, []);

  const refresh = useCallback(async () => {
    try {
      const c = await api.getConnectors();
      if (live.current) setData(c);
    } catch { /* the rows stay as they were */ }
  }, [api]);
  useEffect(() => { if (!first) void refresh(); }, [first, refresh]);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => s === 'active' && void refresh());
    return () => sub.remove();
  }, [refresh]);

  // Runs one change; a refusal shows the server's line.
  const attempt = useCallback(async (run: () => Promise<void>, done?: string) => {
    setLine(null);
    try {
      await run();
      if (live.current && done) setLine(done);
    } catch (e) {
      if (live.current) setLine(connectLine(e));
    }
  }, []);

  const connect = useCallback(async (toolkit: Toolkit) => {
    setWaiting(toolkit);
    await attempt(async () => { const c = await connectTool(api, toolkit, openBrowserAsync); if (live.current) setData(c); });
    if (live.current) setWaiting(null);
  }, [api, attempt]);

  const setLearn = useCallback((on: boolean) => attempt(async () => {
    const r = await api.setLearnHowIWork(on);
    if (live.current) setData((d) => d && { ...d, learn_how_i_work: r.learn_how_i_work });
  }), [api, attempt]);

  return { data, waiting, line, attempt, connect, setLearn, refresh };
}
