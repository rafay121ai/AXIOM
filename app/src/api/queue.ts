import type { Answer, Screened } from './types';

/**
 * A failed request. `status` is missing when the network itself failed; `code` is the server's short error name;
 * `line` is the sentence the server wrote for the founder, when it sent one.
 */
export class HttpError extends Error {
  constructor(readonly status?: number, readonly code?: string, readonly line?: string) {
    super(line ?? `Request failed${status ? ` (${status})` : ''}`);
  }
}

/** The server says today's limit is used up. Trying again changes nothing. */
export const isDailyLimit = (e: unknown): boolean => e instanceof HttpError && e.status === 429 && e.code === 'daily_limit';

/** Worth trying again: no network, a server fault, a rate limit, or a sign-in that has just lapsed. */
export const isRetryable = (e: unknown): boolean => {
  const status = e instanceof HttpError ? e.status : undefined;
  return !isDailyLimit(e) && (status === undefined || status >= 500 || status === 429 || status === 401);
};

type Entry = { answer: Answer; waiters: { resolve: (r: Screened) => void; reject: (e: unknown) => void }[] };

type Options = {
  send: (key: string, answer: Answer) => Promise<Screened>;
  /** Milliseconds to wait before retry number `attempt` (1, 2, 3 ...). */
  retryDelay?: (attempt: number) => number;
};

const backoff = (attempt: number) => Math.min(2000 * 2 ** (attempt - 1), 15000);

/**
 * Answers are saved in the order they were given. A save that cannot reach the server
 * stays in the queue and is retried, so the founder never waits on a bad connection.
 * A newer answer to the same question replaces the one still waiting. The promise from
 * `save` settles when that answer has reached the server: with the care screening, or
 * a rejection if the server refuses it for good.
 */
export function createSaveQueue({ send, retryDelay = backoff }: Options) {
  const pending = new Map<string, Entry>();
  const inflight = new Set<Promise<unknown>>();
  let running = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  async function run() {
    if (running) return;
    running = true;
    let attempt = 0;
    while (pending.size > 0) {
      const [key, entry] = pending.entries().next().value!;
      // Take the waiters that this attempt covers; a newer answer may join the entry while it is sent.
      const waiters = entry.waiters.splice(0);
      try {
        const result = await send(key, entry.answer);
        if (entry.waiters.length === 0) pending.delete(key);
        attempt = 0;
        waiters.forEach((w) => w.resolve(result));
      } catch (e) {
        if (isRetryable(e)) {
          entry.waiters.unshift(...waiters);
          attempt += 1;
          await new Promise<void>((resume) => { timer = setTimeout(resume, retryDelay(attempt)); });
          continue;
        }
        if (entry.waiters.length === 0) pending.delete(key);
        waiters.forEach((w) => w.reject(e));
      }
    }
    running = false;
  }

  function save(key: string, answer: Answer): Promise<Screened> {
    const promise = new Promise<Screened>((resolve, reject) => {
      const waiter = { resolve, reject };
      const entry = pending.get(key);
      if (entry) {
        entry.answer = answer;
        entry.waiters.push(waiter);
      } else {
        pending.set(key, { answer, waiters: [waiter] });
      }
    });
    inflight.add(promise);
    const done = () => inflight.delete(promise);
    promise.then(done, done);
    void run();
    return promise;
  }

  /** Resolves when nothing is left waiting to be saved. */
  async function drain() {
    while (inflight.size > 0) await Promise.allSettled([...inflight]);
  }

  /** Stops the pending retry timer. For tests and sign-out. */
  function stop() {
    clearTimeout(timer);
  }

  return { save, drain, stop };
}
