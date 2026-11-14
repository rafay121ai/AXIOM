import type { Auth } from './auth';
import { createOutbox, type KeyValueStore, memoryStore } from './outbox';
import { createSaveQueue, HttpError } from './queue';
import type { AccountExport, AccountRequest, AxiomApi, Commitment, ConsentResult, ConsentState, DueReport, FirstReading, HistoryPage, HistoryRow, Home, LearnReply, LoadingQuote, MemoryItem, MoveView, Read, ReadAnswerResult, ReportResult, Screened, Settings, Signup, SituationReply, SituationView, StoryReply, SwapResult } from './types';

const CODE_NAME = /^[a-z]+(_[a-z]+)*$/;

type Options = {
  baseUrl: string;
  auth: Auth;
  fetch?: typeof fetch;
  /** Where unsent answers, messages and check-ins are kept while the app is closed. */
  store?: KeyValueStore;
};

// The real client. Care-screened routes answer 200 with a `care` field; anything else is carry on.
export function createHttpApi({ baseUrl, auth, fetch: doFetch = globalThis.fetch.bind(globalThis), store = memoryStore() }: Options): AxiomApi {
  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await doFetch(`${baseUrl}${path}`, {
      method,
      headers: { Authorization: `Bearer ${await auth.getToken()}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }).catch(() => {
      throw new HttpError();
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { code?: unknown; error?: unknown; message?: unknown; line?: unknown };
      // Every refusal the app acts on carries `code`; the daily limit names itself in `error`.
      const code = typeof body?.code === 'string' ? body.code : typeof body?.error === 'string' && CODE_NAME.test(body.error) ? body.error : undefined;
      const line = typeof body?.line === 'string' ? body.line : typeof body?.message === 'string' ? body.message : undefined;
      throw new HttpError(res.status, code, line);
    }
    return res.json() as Promise<T>;
  }

  // Everything the founder types is written down before it is sent, so it survives the app being closed.
  const outbox = createOutbox({ store, send: ({ method, path, body }) => request(method, path, body) });
  const sendWritten = <T>(id: string, method: string, path: string, body?: unknown) => outbox.deliver<T>({ id, method, path, body });

  const queue = createSaveQueue({
    async send(key, answer) {
      const res = await sendWritten<Screened>(`answer:${key}`, 'PUT', `/api/signup/answers/${encodeURIComponent(key)}`, { answer });
      return res.care ? res : {};
    },
  });

  return {
    signInWithGoogle: () => auth.signInWithGoogle(),
    isSignedIn: () => auth.isSignedIn(),
    async getSignup() {
      const { questions, answers, next, complete, total } = await request<Signup>('GET', '/api/signup');
      return { questions, answers, next, complete, total };
    },
    getSignInName: () => auth.getName(),
    saveName: (name) => sendWritten<Screened>('name', 'PUT', '/api/signup/name', { name }),
    async saveBirthday(month, day) {
      await sendWritten('birthday', 'PUT', '/api/signup/birthday', { month, day });
    },
    saveAnswer: (key, answer) => queue.save(key, answer),
    async getFirstReading() {
      await queue.drain();
      return request<FirstReading>('POST', '/api/first-reading');
    },
    startSituation: (text, turnId) => sendWritten<Screened<SituationReply>>(`turn:${turnId}`, 'POST', '/api/situations', { text, client_turn_id: turnId }),
    sendTurn: (situationId, text, turnId) =>
      sendWritten<Screened<SituationReply>>(`turn:${turnId}`, 'POST', `/api/situations/${situationId}/turn`, { text, client_turn_id: turnId }),
    getSituation: (situationId) => request<SituationView>('GET', `/api/situations/${situationId}`),
    getRead: (situationId) => request<Read>('POST', `/api/situations/${situationId}/read`),
    answerRead: (situationId, answer) =>
      request<Screened<ReadAnswerResult>>('POST', `/api/situations/${situationId}/read/answer`, answer),
    startLearn: (situationId) => request<LearnReply>('POST', `/api/situations/${situationId}/learn`),
    sendLearnTurn: (learnId, text, turnId) =>
      sendWritten<Screened<LearnReply>>(`turn:${turnId}`, 'POST', `/api/learn/${learnId}/turn`, { text, client_turn_id: turnId }),
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
      sendWritten<Screened<ReportResult>>(`turn:${turnId}`, 'POST', `/api/moves/${moveId}/report`, { outcome, note, client_turn_id: turnId }),
    async getStory(reportId) {
      const res = await request<Partial<StoryReply>>('GET', `/api/reports/${reportId}/story`);
      return { story: res.story ?? null, founder_lessons: res.founder_lessons };
    },
    setConsent: (reportId, share, wordingVersion) =>
      request<ConsentResult>('POST', `/api/reports/${reportId}/consent`, { share, wording_version: wordingVersion }),
    withdrawShare: (reportId) => request<{ consent: ConsentState; reply: string | null }>('POST', `/api/reports/${reportId}/withdraw`),
    getHome: (timeZone) => request<Home>('GET', `/api/home?time_zone=${encodeURIComponent(timeZone)}`),
    sendCheckIn: (text) => sendWritten<Screened<{ ok: true }>>('checkin', 'POST', '/api/home/checkin', { text }),
    async getHistory(q) {
      return (await request<{ items: HistoryRow[] }>('GET', `/api/history?q=${encodeURIComponent(q)}`)).items;
    },
    getHistoryPage: (id) => request<HistoryPage>('GET', `/api/history/${id}`),
    async getMemory() {
      return (await request<{ items: MemoryItem[] }>('GET', '/api/memory')).items;
    },
    async markWrong(table, id, reason) {
      // Direct, not through the outbox: a failed removal must never be retried and complete later, after the screen said it failed.
      await request('POST', `/api/memory/${table}/${id}/wrong`, { reason });
    },
    getSettings: () => request<Settings>('GET', '/api/settings'),
    updateSettings: (patch) => request<Settings>('PUT', '/api/settings', patch),
    requestExport: () => request<AccountExport>('POST', '/api/account/export'),
    requestDelete: () => request<AccountRequest>('DELETE', '/api/account', { confirm: 'DELETE' }),
    cancelDelete: () => request<AccountRequest>('DELETE', '/api/account', { cancel: true }),
    resumeUnsent: () => outbox.resume(),
    async signOut() {
      await outbox.clear();
      await auth.signOut();
    },
    async registerPushToken(token, platform, timeZone) {
      await request('POST', '/api/push/token', { token, platform, timezone: timeZone });
    },
    async removePushToken(token) {
      await request('DELETE', '/api/push/token', { token });
    },
  };
}
