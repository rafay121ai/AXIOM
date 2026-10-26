import { HttpError } from './queue';

/** A fresh uuid for one send. Made once per message and reused on every retry, so the server counts it once. */
export function newTurnId(): string {
  const c = globalThis.crypto;
  if (typeof c?.randomUUID === 'function') return c.randomUUID();
  const bytes = Uint8Array.from({ length: 16 }, () => Math.floor(Math.random() * 256));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** No connection, or a sign-in that has just lapsed: the message waits and goes by itself. */
export const isOffline = (e: unknown): boolean => {
  return e instanceof HttpError && (e.status === undefined || e.status === 401);
};

const backoff = (attempt: number) => Math.min(2000 * 2 ** (attempt - 1), 15000);

type Options = {
  /** Called with true when a try fails for lack of a connection, and false when it goes through. */
  onWaiting?: (waiting: boolean) => void;
  /** Return true to stop trying (the screen has gone). */
  cancelled?: () => boolean;
  retryDelay?: (attempt: number) => number;
};

/**
 * Runs one send until it reaches the server. Without a connection it waits and tries again with the same
 * request (so the same turn id). Any other failure is thrown for the screen to explain.
 */
export async function sendUntilDelivered<T>(attempt: () => Promise<T>, { onWaiting, cancelled, retryDelay = backoff }: Options = {}): Promise<T> {
  for (let n = 1; ; n += 1) {
    try {
      const result = await attempt();
      onWaiting?.(false);
      return result;
    } catch (e) {
      if (!isOffline(e) || cancelled?.()) {
        onWaiting?.(false);
        throw e;
      }
      onWaiting?.(true);
      await new Promise((resume) => setTimeout(resume, retryDelay(n)));
    }
  }
}
