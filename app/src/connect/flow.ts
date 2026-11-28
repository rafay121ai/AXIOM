import type { KeyValueStore } from '../api/outbox';
import { HttpError } from '../api/queue';
import type { AxiomApi, Connectors, Newsletter, Toolkit } from '../api/types';
import { copy, failureLine } from '../copy';

export type ConnectorsApi = Pick<AxiomApi, 'getConnectors' | 'connectConnector' | 'disconnectConnector' | 'forgetConnector' | 'setLearnHowIWork' | 'getNewsletters' | 'setNewsletters'>;

export const TOOLKITS: Toolkit[] = ['gmail', 'googlecalendar', 'notion'];
export const toolName = (t: Toolkit) => copy.connect.tools[t].name;

/** The server's own line when it sent one (a refusal), else the app's plain line. Never a raw error. */
export const connectLine = (e: unknown): string => (e instanceof HttpError && e.line) || failureLine(e, 'save').text;

export const anyConnected = (c: Connectors | null) => !!c?.connectors.some((x) => x.status === 'active');

// One founder sees the connect screen once, right after the first reading. Sign-out clears the flag so the next founder on this phone is not skipped.
const SHOWN = 'connect_shown';
const PICKED = 'newsletters_shown';
export const clearShown = async (store: KeyValueStore) => { await store.removeItem(SHOWN); await store.removeItem(PICKED); };

/** The connectors to show on the connect screen, or null when it must be skipped: switched off (404), already shown, or the server could not be reached in a few seconds. Marks it shown. */
export async function connectGate(api: Pick<AxiomApi, 'getConnectors'>, store: KeyValueStore, timeoutMs = 4000): Promise<Connectors | null> {
  if (await store.getItem(SHOWN)) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const slow = new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), timeoutMs); });
  const c = await Promise.race([api.getConnectors().catch(() => null), slow]);
  clearTimeout(timer);
  if (c) await store.setItem(SHOWN, '1');
  return c;
}

/** Opens the tool's sign-in link, and when the founder comes back reads the rows again. A row is Connected only when the server says active. */
export async function connectTool(api: ConnectorsApi, toolkit: Toolkit, open: (url: string) => Promise<unknown>): Promise<Connectors | null> {
  const { url } = await api.connectConnector(toolkit);
  await open(url);
  return api.getConnectors();
}

export const newsletterSub = (n: Newsletter) => `${copy.newsletters.perWeek.replace('{n}', String(n.per_week))} · ${copy.newsletters.opens[n.opens]}`;

/** The newsletters to offer right after Gmail first connects, or null to skip silently: already offered on this device, none found, or the lookup failed. Marked offered only when there is a list to show. */
export async function newsletterGate(api: Pick<AxiomApi, 'getNewsletters'>, store: KeyValueStore): Promise<Newsletter[] | null> {
  if (await store.getItem(PICKED)) return null;
  const list = await api.getNewsletters().catch(() => null);
  if (!list?.length) return null;
  await store.setItem(PICKED, '1');
  return list;
}
