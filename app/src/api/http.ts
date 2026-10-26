import type { Auth } from './auth';
import { createSaveQueue, HttpError } from './queue';
import type { AxiomApi, FirstReading, Question, Screened } from './types';

type Options = { baseUrl: string; auth: Auth; fetch?: typeof fetch };

// The real client. Care-screened routes answer 200 with a `care` field; anything else is carry on.
export function createHttpApi({ baseUrl, auth, fetch: doFetch = globalThis.fetch.bind(globalThis) }: Options): AxiomApi {
  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await doFetch(`${baseUrl}${path}`, {
      method,
      headers: { Authorization: `Bearer ${await auth.getToken()}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }).catch(() => {
      throw new HttpError();
    });
    if (!res.ok) throw new HttpError(res.status);
    return res.json() as Promise<T>;
  }

  const queue = createSaveQueue({
    async send(key, answer) {
      const res = await request<Screened>('PUT', `/api/signup/answers/${encodeURIComponent(key)}`, { answer });
      return res.care ? res : {};
    },
  });

  return {
    signInWithGoogle: () => auth.signInWithGoogle(),
    async getQuestions() {
      return (await request<{ questions: Question[] }>('GET', '/api/signup')).questions;
    },
    saveAnswer: (key, answer) => queue.save(key, answer),
    async getFirstReading() {
      await queue.drain();
      return request<FirstReading>('POST', '/api/first-reading');
    },
    async sendMessage() {
      throw new Error('The server has no route for free messages yet');
    },
  };
}
