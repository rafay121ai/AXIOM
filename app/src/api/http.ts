import type { Auth } from './auth';
import { createSaveQueue, HttpError } from './queue';
import type { AccountRequest, AxiomApi, Commitment, ConsentResult, DueReport, FirstReading, HistoryPage, HistoryRow, Home, LearnReply, LoadingQuote, MoveView, Read, ReadAnswerResult, ReportResult, Screened, Settings, Signup, SituationReply, Story, SwapResult } from './types';

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
    async getSignup() {
      const { questions, answers, complete } = await request<Signup>('GET', '/api/signup');
      return { questions, answers, complete };
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
    async openMove(learnId) {
      return (await request<{ move: MoveView }>('POST', `/api/learn/${learnId}/move`)).move;
    },
    commitMove: (moveId, timezone) => request<Commitment>('POST', `/api/moves/${moveId}/commit`, { timezone }),
    swapMove: (moveId, reason) => request<Screened<SwapResult>>('POST', `/api/moves/${moveId}/swap`, { reason }),
    // The hint is only a nicety: any failure means no quote.
    async getLoadingHint(seed) {
      try {
        return (await request<{ hint: LoadingQuote | null }>('GET', `/api/loading-hint?seed=${encodeURIComponent(seed)}`)).hint;
      } catch {
        return null;
      }
    },
    async getMove(moveId) {
      return (await request<{ move: MoveView }>('GET', `/api/moves/${moveId}`)).move;
    },
    async getDueReports() {
      return (await request<{ reports: DueReport[] }>('GET', '/api/reports/due')).reports;
    },
    sendReport: (moveId, outcome, note, turnId) =>
      request<Screened<ReportResult>>('POST', `/api/moves/${moveId}/report`, { outcome, note, client_turn_id: turnId }),
    async getStory(reportId) {
      return (await request<{ story: Story | null }>('GET', `/api/reports/${reportId}/story`)).story;
    },
    setConsent: (reportId, share, wordingVersion) =>
      request<ConsentResult>('POST', `/api/reports/${reportId}/consent`, { share, wording_version: wordingVersion }),
    getHome: (timeZone) => request<Home>('GET', `/api/home?time_zone=${encodeURIComponent(timeZone)}`),
    sendCheckIn: (text) => request<Screened<{ ok: true }>>('POST', '/api/home/checkin', { text }),
    async getHistory(q) {
      return (await request<{ items: HistoryRow[] }>('GET', `/api/history?q=${encodeURIComponent(q)}`)).items;
    },
    getHistoryPage: (id) => request<HistoryPage>('GET', `/api/history/${id}`),
    getSettings: () => request<Settings>('GET', '/api/settings'),
    updateSettings: (patch) => request<Settings>('PUT', '/api/settings', patch),
    requestExport: () => request<AccountRequest>('POST', '/api/account/export'),
    requestDelete: () => request<AccountRequest>('DELETE', '/api/account'),
    signOut: () => auth.signOut(),
    async registerPushToken(token, platform, timeZone) {
      await request('POST', '/api/push/token', { token, platform, timezone: timeZone });
    },
    async removePushToken(token) {
      await request('DELETE', '/api/push/token', { token });
    },
  };
}
