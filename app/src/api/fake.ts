import type { AxiomApi, FirstReading, Question, Read, ReadAnswerResult, Screened, SituationReply } from './types';

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

// The mock's rule for "ok": fewer than 3 words that say something is not an answer.
const FILLER = new Set('ok okay k yes yeah yep yup no nope sure fine hmm hm mm um uh thanks thank you thx cool got it i see makes sense right true alright maybe idk good nice lol so well kinda'.split(' '));
const isReal = (t: string) => t.toLowerCase().replace(/[^a-z0-9%$\s']/g, ' ').split(/\s+/).filter((w) => w && !FILLER.has(w)).length >= 3;
// The mock's "enough": a described situation with one concrete detail.
const isEnough = (t: string) => t.split(/\s+/).length >= 8 && /\d|\b(one|two|three|four|five|six|seven|eight|nine|ten|twice|once|yesterday)\b/i.test(t);

export function createFakeApi(sim: CareSim = 'none'): AxiomApi {
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
  };
}
