import type { Auth } from './auth';
import { createSaveQueue, HttpError } from './queue';
import type { AxiomApi, FirstReading, LearnReply, LoadingQuote, Question, Read, ReadAnswerResult, Screened, SituationReply } from './types';

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
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: unknown };
      throw new HttpError(res.status, typeof body?.error === 'string' ? body.error : undefined);
    }
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
    startSituation: (text, turnId) => request<Screened<SituationReply>>('POST', '/api/situations', { text, client_turn_id: turnId }),
    sendTurn: (situationId, text, turnId) =>
      request<Screened<SituationReply>>('POST', `/api/situations/${situationId}/turn`, { text, client_turn_id: turnId }),
    getRead: (situationId) => request<Read>('POST', `/api/situations/${situationId}/read`),
    answerRead: (situationId, answer) =>
      request<Screened<ReadAnswerResult>>('POST', `/api/situations/${situationId}/read/answer`, answer),
    startLearn: (situationId) => request<LearnReply>('POST', `/api/situations/${situationId}/learn`),
    sendLearnTurn: (learnId, text, turnId) =>
      request<Screened<LearnReply>>('POST', `/api/learn/${learnId}/turn`, { text, client_turn_id: turnId }),
    tapFollowUp: (learnId, turnId, index) => request<LearnReply>('POST', `/api/learn/${learnId}/followup/${index}`, { turn_id: turnId }),
    // The hint is only a nicety: any failure means no quote.
    async getLoadingHint(seed) {
      try {
        return (await request<{ hint: LoadingQuote | null }>('GET', `/api/loading-hint?seed=${encodeURIComponent(seed)}`)).hint;
      } catch {
        return null;
      }
    },
  };
}
