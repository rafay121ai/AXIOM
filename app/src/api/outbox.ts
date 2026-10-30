import { isRetryable } from './queue';

/** Where unsent things are kept while the app is closed. AsyncStorage is one; tests pass their own. */
export type KeyValueStore = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
};

export function memoryStore(): KeyValueStore {
  const data = new Map<string, string>();
  return {
    getItem: async (key) => data.get(key) ?? null,
    setItem: async (key, value) => void data.set(key, value),
    removeItem: async (key) => void data.delete(key),
  };
}

/**
 * One request the founder made that has not reached the server yet. The body already holds the turn id, so
 * sending it again after a restart counts once. A newer request with the same `id` (a newer answer to the same
 * question, a check-in typed again) replaces the older one.
 */
export type Unsent = { id: string; method: string; path: string; body?: unknown };

type Options = {
  store: KeyValueStore;
  send: (request: Unsent) => Promise<unknown>;
  /** Milliseconds to wait before retry number `attempt` (1, 2, 3 ...). */
  retryDelay?: (attempt: number) => number;
};

const KEY = 'axiom.unsent.v1';
const backoff = (attempt: number) => Math.min(2000 * 2 ** (attempt - 1), 15000);

const isUnsent = (v: unknown): v is Unsent =>
  typeof v === 'object' && v !== null && typeof (v as Unsent).id === 'string' && typeof (v as Unsent).method === 'string' && typeof (v as Unsent).path === 'string';

/**
 * What the founder sent is written down before the first try and crossed off when the server has it (or refuses
 * it for good). Nothing is lost if the app is closed or the phone restarts: `resume` sends what is left.
 */
export function createOutbox({ store, send, retryDelay = backoff }: Options) {
  let entries: Unsent[] = [];
  const loaded = store.getItem(KEY).then((raw) => {
    const found: unknown = raw ? JSON.parse(raw) : [];
    // Anything that does not read back as a list of requests is dropped, never sent.
    entries = Array.isArray(found) ? found.filter(isUnsent) : [];
  }).catch(() => {});
  let writes: Promise<unknown> = loaded;
  let resuming: Promise<void> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let wake: (() => void) | undefined;
  let stopped = false;

  // Writes are one after another so the last list written is the latest. A failed write leaves the founder's
  // request still going out this session; it only loses the protection of a restart.
  const save = () => {
    const snapshot = JSON.stringify(entries);
    writes = writes.then(() => store.setItem(KEY, snapshot)).catch(() => {});
    return writes;
  };

  const same = (a: Unsent, b: Unsent | undefined) => !!b && JSON.stringify(a) === JSON.stringify(b);

  async function put(request: Unsent) {
    await loaded;
    const at = entries.findIndex((e) => e.id === request.id);
    if (at === -1) entries.push(request);
    else entries[at] = request;
    await save();
  }

  // Crosses off this request, unless a newer one with the same id has taken its place.
  async function cross(request: Unsent) {
    if (!same(request, entries.find((e) => e.id === request.id))) return;
    entries = entries.filter((e) => e.id !== request.id);
    await save();
  }

  /** Sends one request, written down first. A refusal for good, or success, crosses it off; a failure worth retrying keeps it. */
  async function deliver<T>(request: Unsent): Promise<T> {
    await put(request);
    try {
      const result = (await send(request)) as T;
      await cross(request);
      return result;
    } catch (e) {
      if (!isRetryable(e)) await cross(request);
      throw e;
    }
  }

  /**
   * Sends what an earlier run left behind, oldest first, waiting out a bad connection. The promise settles when
   * everything is sent, or at the first failure worth retrying (which then keeps being retried in the background), so
   * the caller can read the server's state after it. Safe to call again.
   */
  function resume(): Promise<void> {
    stopped = false;
    if (!resuming) {
      let firstPass!: () => void;
      const passed = new Promise<void>((resolve) => { firstPass = resolve; });
      resuming = passed;
      void (async () => {
        await loaded;
        let attempt = 0;
        while (entries.length > 0 && !stopped) {
          const next = entries[0];
          try {
            await send(next);
            attempt = 0;
          } catch (e) {
            if (isRetryable(e)) {
              firstPass();
              attempt += 1;
              await new Promise<void>((resolve) => { wake = resolve; timer = setTimeout(resolve, retryDelay(attempt)); });
              continue;
            }
          }
          await cross(next);
        }
        firstPass();
        resuming = undefined;
      })();
    }
    return resuming;
  }

  /** Forgets everything unsent and stops sending. For sign-out: these belong to the founder who left. */
  async function clear() {
    stopped = true;
    clearTimeout(timer);
    wake?.();
    await loaded;
    entries = [];
    writes = writes.then(() => store.removeItem(KEY)).catch(() => {});
    await writes;
  }

  return { deliver, resume, clear };
}
