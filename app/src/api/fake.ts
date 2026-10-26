import { HttpError } from './queue';
import type { AxiomApi, Commitment, ConsentResult, DueReport, FirstReading, LearnReply, LearnTurn, MoveView, Outcome, Question, Read, ReadAnswerResult, ReportResult, Screened, SituationReply, Story, SwapResult } from './types';

// Fixture questions, word for word from tasks/design/mock-onboarding-v2.html.
const QUESTIONS: Question[] = [
  { type: 'single', key: 'stage', title: 'Where are you with it right now?', sub: 'Pick what is true today, not where you hope to be.',
    options: ['Just an idea', "I'm talking to people about it", "I'm building it and nobody pays yet", 'Someone is paying me', "It's growing"] },
  { type: 'single', key: 'months_in', title: 'How long have you been on it?',
    options: ['Under 3 months', '3 to 6 months', '6 to 12 months', '1 to 2 years', 'More than 2 years'] },
  { type: 'single', key: 'commitment', title: 'How much of your week goes into it?',
    options: ['Full time', 'Part time, 15 hours or more', 'Evenings and weekends, under 15 hours', 'On and off'] },
  { type: 'single', key: 'business_model', title: 'Who pays you, or would?',
    options: ['Businesses', 'Consumers', 'Both sides of a marketplace', 'Clients, for services', 'No one yet'] },
  { type: 'where', key: 'where', title: 'Where are you, and where are your customers?', sub: 'They are often not in the same place.',
    countryLabel: "I'm based in", countryPlaceholder: 'Start typing a country',
    countries: ['Pakistan', 'India', 'United States', 'United Kingdom', 'United Arab Emirates', 'Saudi Arabia', 'Canada', 'Nigeria', 'Kenya', 'Egypt', 'Bangladesh', 'Germany', 'Singapore', 'Australia', 'Brazil'],
    customerLabel: 'My customers are', customers: ['Mostly in my own country', 'Mostly abroad', 'Both'] },
  { type: 'single', key: 'team', title: 'Who is building it with you?',
    options: ['Just me', 'A cofounder or two', 'A small team of 2 to 5', 'Six or more'] },
  { type: 'goal', key: 'goal', title: 'What are you aiming for, and by when?',
    goals: ['My first customer', 'My first 10 customers', 'A revenue number', 'Raise money', 'Ship it'],
    whenLabel: 'By when?', whens: ['This month', 'In 3 months', 'In 6 months', 'Pick a date'], dateOption: 'Pick a date' },
  { type: 'single', key: 'background', title: 'What did you do before this?', otherOption: 'Other',
    options: ['I worked in tech', 'I worked in something else', "I'm a student", 'I ran a business before', 'Other'] },
  { type: 'single', key: 'why', title: 'Why are you doing this?', sub: 'Pick the one that is most true, even if it is not flattering.',
    options: ["To get out of a job I don't want", "I've lived this problem myself", 'I see a big opportunity', 'To prove something', 'Freedom, money, or something that matters'] },
  { type: 'two', key: 'strengths', title: 'Be honest about yourself.', sub: 'Pick as many as are true.',
    groups: [
      { label: 'Better than most people at', options: ['Building the product', 'Selling', 'Numbers and planning', 'Leading people', 'Not quitting'] },
      { label: 'What I avoid most', options: ['Talking to customers', 'Asking for money', 'Pricing', 'Hard talks with the team', 'Launching'] },
    ] },
  { type: 'multi', key: 'tried', title: 'What have you already tried?', sub: 'Tick everything that applies.',
    options: ['Talked to customers', 'Built a prototype', 'Launched it', 'Tried to sell or raise', 'None of it yet'], exclusive: 'None of it yet' },
  { type: 'text', key: 'building', title: 'What are you building, and for whom?', sub: 'A sentence or two is enough.',
    placeholder: 'I am building…', minLength: 12, shortHint: 'A little more, so Axiom has something real to work with.' },
  { type: 'text', key: 'stuck', title: 'What are you most stuck on, or putting off? And what have you tried on it?', sub: 'Numbers help.',
    placeholder: 'The thing I keep avoiding is…', minLength: 20, shortHint: 'A little more, so Axiom has something real to work with.' },
];

// Fixture first reading, from the sample answers in the mock (every quote is the sample founder's own words).
const READING: FirstReading = {
  headline: 'You keep building when you should be asking.',
  body: [
    'You have spent 6 to 12 months on “A scheduling tool for dental clinics”, evenings and weekends. Nobody pays yet.',
    'You wrote “I keep adding features instead of showing it to clinics”, and the thing you said you avoid most is talking to customers.',
    'That is one problem told twice: you keep doing the work nobody can say no to.',
    'You want your first customer in 3 months.',
    'We begin with the last time you put it in front of someone.',
  ].join(' '),
  underlines: ['I keep adding features instead of showing it to clinics', 'talking to customers'],
};

// What the fake screening returns, so each route can be seen: 'none' carries on.
export type CareSim = 'none' | 'clear' | 'unclear';

// Placeholder lines. The real server sends verified lines for the founder's country.
const CLEAR: Screened = {
  care: 'clear',
  message: [
    'What you just wrote matters more than the business.',
    "I'm not going to give you a lesson or a move right now.",
    "If you might hurt yourself, or you're in danger, please call your local emergency number now.",
    'Placeholder: a line inviting the founder to tell someone near them.',
    'Placeholder: a line saying Axiom is an assistant, and is here if they want to keep talking.',
  ].join('\n\n'),
  help: [
    { label: 'If you are in danger right now', value: 'Emergency number for your country' },
    { label: 'Talk to someone trained to listen', value: 'A helpline for your country' },
    { label: 'More help near you', value: 'findahelpline.com' },
  ],
};
const UNCLEAR: Screened = { care: 'unclear', reply: 'That sounded heavy. What is going on?' };

// The follow-up questions and the Read, word for word from the mock (sample founder).
const FOLLOW_UPS = ['When was the last time you showed it to someone, and what did they say?', 'And what did you do after that?'];
const MAX_FOLLOW_UPS = 2;
const SAY_MORE = 'Say a bit more.';
const FAKE_READ: Read = {
  headline: 'Nobody has actually said yes or no to this yet.',
  body: [
    "Two clinics saw it and said they'd think about it. That is not an answer. It is a way of not answering.",
    'Since then you have added features instead of going back to ask. The more you add, the longer you can avoid hearing the real answer.',
  ].join('\n\n'),
  closing_question: 'Have you gone back to either of those clinics since?',
  answered: false,
  skipped: false,
};

// The Learn lesson and replies, from the Learn mock (sample founder: a customer asking for a discount).
// The move notice words are the server's own, as a placeholder.
const VOSS = { author: 'Chris Voss', book: 'Never Split the Difference' };
const LESSON: LearnTurn = {
  id: 'fake-learn-turn-1',
  kind: 'lesson',
  text: [
    'Your biggest customer is 40% of your revenue and wants 30% off at renewal. That discount takes 12% of everything you earn.',
    'Chris Voss, in Never Split the Difference, says the strongest answer to a demand like this is not a harder no. It is a question that puts the problem back on them: “How am I supposed to make that work?” A “how” or “what” question keeps you steering while they do the explaining.',
    "What are you actually trying to get out of this renewal: keep them at today's price, or are you open to giving something?",
  ].join('\n\n'),
  sources: [VOSS],
  picture: {
    type: 'split_bar',
    data: { title: 'From your numbers', unit: '%', parts: [{ label: 'What the discount costs you', value: 12 }, { label: 'The rest of what you earn', value: 88 }] },
    derived: [{ rule: 'percent_of', inputs: [12, 100], value: 12 }],
    interactive: false,
  },
  follow_ups: ['What if they say no?', 'Give me the exact words to use'],
};
const FOLLOW_UP_ANSWERS = [
  'If they say no, you have lost nothing you had this morning. Ask the same question again, slower, and wait for them to fill the silence.',
  'Say: “How am I supposed to make that work?” Then stop talking until they answer.',
];
const FAKE_LEARN_ID = 'fake-learn-1';
const FAKE_HINT = { book: 'Never Split the Difference', quote: '“No” feels like salvation, like an oasis.' };

// The Move sheet, word for word from the mock (sample founder). The changed move is a placeholder:
// the mock shows no second move, and its swap example is "I only have their email".
const FAKE_MOVE: MoveView = {
  id: 'fake-move-1', learn_id: FAKE_LEARN_ID, situation_id: 'fake-situation-1', status: 'draft',
  title: 'Ask both clinics for one concrete next step.',
  mission: 'Message both clinics today and ask for a 20-minute follow-up call in the next 3 days.',
  success: 'Both give you a day and time. Yes or no.',
  words: "I'd like to show you what has changed since we last spoke. Can we book 20 minutes in the next 3 days?",
  checklist: ['Open the last message from each clinic', 'Paste the wording and change one word to sound like you', 'Send it to both'],
  prediction: 'My read: at least one of them will not answer. That is also an answer. Tonight tells us.',
  start_minutes: 10, can_swap: true, swapped_from: null, committed_at: null, report_due_at: null, report_time_local: null,
  time_zone: null, created_at: '2026-10-26T09:00:00.000Z',
};
const FAKE_SWAPPED: MoveView = {
  ...FAKE_MOVE, id: 'fake-move-2', swapped_from: FAKE_MOVE.id, can_swap: false,
  title: 'Email both clinics and ask for one concrete next step.',
  mission: 'Email both clinics today and ask for a 20-minute follow-up call in the next 3 days.',
  words: "I'd like to show you what has changed since we last spoke. Can we book 20 minutes in the next 3 days?",
  checklist: ['Find the email of each clinic', 'Paste the wording and change one word to sound like you', 'Send it to both'],
};
const FAKE_REPORT_TIME = '20:00';
const NEED_REASON = '"I\'m busy" isn\'t a reason I can work with. What makes this the wrong move?';

// The Report, word for word from the mock (sample founder). The server's own wording lives in server/journey/report/wording.js.
const FAKE_DUE: DueReport = {
  move_id: FAKE_MOVE.id,
  title: 'Ask both clinics for a call within the next 3 days',
  due: true,
  report_due_at: '2026-10-26T20:00:00.000Z',
  opening: 'Your move was to ask both clinics for a call within the next 3 days. I said at least one would not answer. What happened?',
  prediction: 'at least one would not answer',
  outcomes: ['done', 'couldnt', 'didnt'],
  questions: { done: 'What did they say?', couldnt: 'What got in the way?', didnt: 'What stopped you?' },
};
const REPORT_REPLIES: Record<Outcome, string> = {
  done: 'That is a real answer. One clinic gave you a time, and one did not reply. I said at least one would not answer. I was right, which helps nobody. You sent it anyway, and that is the part that counts. Your next move: send the clinic that replied a message confirming the time.',
  couldnt: 'That is fine, things changed. Here is a smaller version: message only the clinic that is easiest to reach, and ask for a 10-minute call.',
  didnt: 'That happens. What stopped you matters more than the message. Was it not knowing what to write, or not wanting to send it?',
};
const STORY_OFFER = 'A founder who was in your spot shared what went wrong and what worked. Want to see it?';
const FAKE_STORY: Story = {
  story: 'Their first two demos ended with "we\'ll think about it". They spent the next month adding features. They got their first customer when they asked each clinic to book a call. Looking back, they say the features never mattered; the first real ask did.',
  lesson: null,
  outcome: 'done',
  stage: null,
};
const ASK_ALONE = { text: 'One last thing: can I share what happened, with no name, to help founders behind you?', wording_version: 'share-alone-v1' };
const ASK_AFTER_STORY = { text: 'They shared theirs so it could help you. Would you share yours the same way, with no name?', wording_version: 'share-after-story-v1' };
const SHARED_LINE = 'Thank you. That opens more founder stories for you.';
const KEPT_PRIVATE_LINE = 'Kept private. You can change this any time in settings.';

// The mock's rule for "ok": fewer than 3 words that say something is not an answer.
const FILLER = new Set('ok okay k yes yeah yep yup no nope sure fine hmm hm mm um uh thanks thank you thx cool got it i see makes sense right true alright maybe idk good nice lol so well kinda'.split(' '));
const isReal = (t: string) => t.toLowerCase().replace(/[^a-z0-9%$\s']/g, ' ').split(/\s+/).filter((w) => w && !FILLER.has(w)).length >= 3;
// The mock's "enough": a described situation with one concrete detail.
const isEnough = (t: string) => t.split(/\s+/).length >= 8 && /\d|\b(one|two|three|four|five|six|seven|eight|nine|ten|twice|once|yesterday)\b/i.test(t);

// `latencyMs` makes the Learn calls take a while, so the loading hint can be seen.
// `reportDue` puts the mock's check-in waiting, as it is on the evening of a committed move.
export function createFakeApi(sim: CareSim = 'none', latencyMs = 0, reportDue = false): AxiomApi {
  const wait = () => (latencyMs > 0 ? new Promise<void>((r) => setTimeout(r, latencyMs)) : undefined);
  const screen = async (): Promise<Screened> => (sim === 'clear' ? CLEAR : sim === 'unclear' ? UNCLEAR : {});

  // Situations kept in memory, so a turn id sent twice gets the same answer, like the server.
  let nextId = 1;
  const situations = new Map<string, { asked: number; said: string[] }>();
  const replies = new Map<string, SituationReply>();
  const turn = async (situationId: string | null, text: string, turnId: string): Promise<Screened<SituationReply>> => {
    const flagged = await screen();
    if (flagged.care) return flagged;
    const seen = replies.get(turnId);
    if (seen) return seen;
    const state = situationId ? situations.get(situationId) : undefined;
    const asked = state?.asked ?? 0;
    const counts = (n: number) => ({ follow_up_count: n, follow_ups_left: MAX_FOLLOW_UPS - n });
    let reply: SituationReply;
    if (!isReal(text)) {
      reply = { situation_id: situationId, status: 'say_more', reply: SAY_MORE, ...counts(asked) };
    } else {
      const id = situationId ?? `fake-situation-${nextId++}`;
      const said = [...(state?.said ?? []), text];
      const done = asked >= MAX_FOLLOW_UPS || isEnough(said.join(' '));
      situations.set(id, { asked: done ? asked : asked + 1, said });
      reply = done
        ? { situation_id: id, status: 'ready', reply: null, ...counts(asked) }
        : { situation_id: id, status: 'follow_up', reply: FOLLOW_UPS[asked], ...counts(asked + 1) };
    }
    replies.set(turnId, reply);
    return reply;
  };

  // Learn, kept in memory so a turn id sent twice gets the same answer, like the server.
  const learnReplies = new Map<string, Screened<LearnReply>>();
  let realReplies = 0;
  let nextLearnTurn = 2;
  const learnReply = (extra: Partial<LearnReply>): LearnReply => ({
    learn_id: FAKE_LEARN_ID, situation_id: 'fake-situation-1', status: 'reply', turn: null, move_offer: 'none', move_notice: null, ...extra,
  });
  const learnTurn = (kind: LearnTurn['kind'], text: string, extra: Partial<LearnTurn> = {}): LearnTurn => ({
    id: `fake-learn-turn-${nextLearnTurn++}`, kind, text, sources: [], picture: null, follow_ups: [], ...extra,
  });

  // The move, kept in memory: asking again returns the same one, a commit twice is one commit, a swap twice is one swap.
  let move = FAKE_MOVE;
  let swapped: SwapResult | null = null;

  // The report, kept in memory: a move is reported once, and sending it again returns the stored answer.
  let reported: Extract<ReportResult, { status: 'reported' }> | null = null;

  return {
    async signInWithGoogle() {},
    async getQuestions() {
      return QUESTIONS;
    },
    saveAnswer: screen,
    async getFirstReading() {
      return READING;
    },
    startSituation: (text, turnId) => turn(null, text, turnId),
    sendTurn: (situationId, text, turnId) => turn(situationId, text, turnId),
    async getRead() {
      return FAKE_READ;
    },
    async answerRead(_situationId, answer): Promise<Screened<ReadAnswerResult>> {
      if ('skip' in answer) return { status: 'stored', skipped: true, next: 'learn' };
      const flagged = await screen();
      if (flagged.care) return flagged;
      return isReal(answer.text) ? { status: 'stored', skipped: false, next: 'learn' } : { status: 'say_more', reply: SAY_MORE };
    },
    async startLearn() {
      await wait();
      return learnReply({ turn: LESSON });
    },
    async sendLearnTurn(_learnId, text, turnId) {
      await wait();
      const flagged = await screen();
      if (flagged.care) return flagged;
      const seen = learnReplies.get(turnId);
      if (seen) return seen;
      let res: LearnReply;
      if (!isReal(text)) {
        res = learnReply({ status: 'say_more', reply: SAY_MORE });
      } else {
        realReplies += 1;
        const offered = realReplies === 2;
        res = learnReply({
          turn: learnTurn('reply', offered ? 'Keep hold of that. The first thing they say after your question will tell you more than the number itself.' : 'That is the position to protect, and the question should serve it: it gets them explaining why 30%, not you defending your price.'),
          ...(offered ? { move_offer: 'first' as const, move_notice: { kind: 'first' as const, kicker: 'Your move', text: 'Your move is ready.' } } : {}),
        });
      }
      learnReplies.set(turnId, res);
      return res;
    },
    async tapFollowUp(_learnId, turnId, index) {
      await wait();
      return learnReply({ turn: learnTurn('followup', FOLLOW_UP_ANSWERS[index] ?? FOLLOW_UP_ANSWERS[0], { for_turn_id: turnId, followup_index: index }) });
    },
    async openMove() {
      await wait();
      return move;
    },
    async commitMove(moveId, timezone): Promise<Commitment> {
      if (moveId !== move.id) throw new HttpError(404, 'Not found');
      if (move.status !== 'committed') {
        move = { ...move, status: 'committed', committed_at: '2026-10-26T09:05:00.000Z', report_time_local: FAKE_REPORT_TIME, time_zone: timezone };
      }
      return { move, report: { due_at: '2026-10-26T20:00:00.000Z', local_time: move.report_time_local ?? FAKE_REPORT_TIME, time_zone: move.time_zone ?? timezone } };
    },
    async swapMove(moveId, reason): Promise<Screened<SwapResult>> {
      const flagged = await screen();
      if (flagged.care) return flagged;
      if (swapped && moveId === FAKE_MOVE.id) return swapped;
      if (moveId !== move.id) throw new HttpError(404, 'Not found');
      if (!move.can_swap) throw new HttpError(409, 'swap_used');
      if (!isReal(reason)) return { status: 'need_reason', reply: NEED_REASON };
      swapped = { status: 'swapped', replaced_id: move.id, move: FAKE_SWAPPED };
      move = FAKE_SWAPPED;
      return swapped;
    },
    async getLoadingHint() {
      return FAKE_HINT;
    },
    async getDueReports() {
      return reportDue && !reported ? [FAKE_DUE] : [];
    },
    async sendReport(moveId, outcome, note): Promise<Screened<ReportResult>> {
      if (moveId !== FAKE_DUE.move_id) throw new HttpError(404, 'Not found');
      if (reported) return reported;
      const flagged = await screen();
      if (flagged.care) return flagged;
      if (!isReal(note)) return { status: 'need_more', reply: SAY_MORE };
      reported = {
        status: 'reported',
        report: { id: 'fake-report-1', outcome },
        reply: REPORT_REPLIES[outcome],
        story_offer: { text: STORY_OFFER },
        consent: { ask: true, state: 'asked', question: ASK_ALONE, question_after_story: ASK_AFTER_STORY, choices: ['share', 'keep_private'] },
        unlock: { granted: true },
      };
      return reported;
    },
    async getStory() {
      return FAKE_STORY;
    },
    async setConsent(_reportId, share): Promise<ConsentResult> {
      return {
        consent: { ask: false, state: share ? 'shared' : 'private', automatic: false },
        reply: share ? SHARED_LINE : KEPT_PRIVATE_LINE,
      };
    },
  };
}
