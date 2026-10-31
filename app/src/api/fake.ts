import { HttpError } from './queue';
import type { AccountExport, AccountRequest, AxiomApi, Commitment, ConsentResult, DueReport, FirstReading, HistoryPage, HistoryRow, Home, HomeItem, FounderLessons, LearnReply, LearnTurn, MoveView, Outcome, Question, Read, ReadAnswerResult, ReportResult, Screened, Settings, SituationReply, SituationView, Story, StoryReply, SwapResult } from './types';

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
  help: { country: null, emergency: null, lines: [], fallback: 'More help near you: findahelpline.com', needs_verification: true },
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
const FAKE_CASE = {
  story: 'They had two demos booked and kept offering a discount before anyone asked. The third time, they asked what the clinic would need to say yes, and held the price.',
  lesson: 'Ask what yes needs before you move the number.',
  outcome: 'done',
};
const FAKE_CLOSED: FounderLessons = { state: 'closed_notice', notice: { text: 'That was the second founder lesson. More open when you share what happened on a move.', wording_version: 'fake-closed-v1' } };
const ASK_ALONE = { text: 'One last thing: can I share what happened, with no name, to help founders behind you?', wording_version: 'share-alone-v1' };
const ASK_AFTER_STORY = { text: 'They shared theirs so it could help you. Would you share yours the same way, with no name?', wording_version: 'share-after-story-v1' };
const SHARED_LINE = 'Thank you. That opens more founder stories for you.';
const KEPT_PRIVATE_LINE = 'Kept private. You can change this any time in settings.';

// The home screen, from the mock (sample founder). The words are the server's own (server/journey/home/wording.js):
// the mock's "Tonight: tell me how it went" is "Tell me how it went" there. Which items show follows the mock's states.
export type FounderSim = 'closed';
export type HomeSim = 'morning' | 'report' | 'evening' | 'nothing' | 'care';

const FAKE_SITUATION = 'fake-situation-1';
const TODAY_ITEM: HomeItem = { kind: 'move', label: 'Today: ask the clinics for a call', title: FAKE_DUE.title, stays: false, target: { stage: 'move', situation_id: FAKE_SITUATION, move_id: FAKE_MOVE.id } };
const STILL_ITEM: HomeItem = { ...TODAY_ITEM, label: 'Still to do: ask the clinics for a call' };
const REPORT_ITEM: HomeItem = { kind: 'report', label: 'Tell me how it went', title: FAKE_DUE.title, stays: false, target: { stage: 'report', situation_id: FAKE_SITUATION, move_id: FAKE_DUE.move_id } };
const DUE_REPORT = { move_id: FAKE_DUE.move_id, situation_id: FAKE_SITUATION, title: FAKE_DUE.title, report_due_at: '2026-10-26T20:00:00.000Z' };
const FAKE_PAUSED = { id: 'fake-situation-5', title: 'Hiring plan', stage: null, last_activity_at: '2026-10-10T09:00:00.000Z' };
const FAKE_RECENT = [
  { id: FAKE_SITUATION, title: 'Asking the two clinics for a call', status: 'open' },
  { id: 'fake-situation-2', title: 'Whether to charge for the pilot', status: 'done' },
  { id: 'fake-situation-3', title: 'Which feature to cut first', status: 'couldnt' },
  { id: 'fake-situation-4', title: 'Why nobody replies to my emails', status: 'didnt' },
];

// History and a past situation, from the mock's sample rows (placeholder authors, as the mock says).
const HISTORY: { row: HistoryRow; page: Omit<HistoryPage, 'id' | 'title' | 'status' | 'status_label' | 'action'> }[] = [
  { row: { id: FAKE_SITUATION, title: 'Asking the two clinics for a call', status: 'open', status_label: 'Open', last_activity_at: '2026-10-26T09:00:00.000Z' },
    page: { what_i_read: { headline: 'Nobody has actually said yes or no to this yet.', body: '', closing_question: '', your_answer: null },
      what_you_learned: { text: '', sources: [{ author: 'Rob Fitzpatrick', book: 'The Mom Test' }] },
      your_move: { title: 'Ask the clinics', mission: 'Message both clinics today and ask for a 20-minute call in the next 3 days.', success: 'Both give you a day and time.' }, how_it_went: null } },
  { row: { id: 'fake-situation-2', title: 'Whether to charge for the pilot', status: 'done', status_label: 'Done', last_activity_at: '2026-10-25T09:00:00.000Z' },
    page: { what_i_read: { headline: 'You are afraid a price will end the conversation.', body: '', closing_question: '', your_answer: null },
      what_you_learned: { text: '', sources: [{ author: 'Alex Hormozi', book: '$100M Offers' }] },
      your_move: { title: 'Quote a paid pilot', mission: 'Quote a paid pilot to one clinic before the call ends.', success: 'They name a yes or a no.' },
      how_it_went: { report_id: 'fake-report-1', outcome: 'done', note: 'The clinic asked for a day to think, then said yes to a smaller pilot.', reply: '', prediction: { text: '', check: null }, sharing: 'shared' } } },
  { row: { id: 'fake-situation-3', title: 'Which feature to cut first', status: 'couldnt', status_label: "Couldn't", last_activity_at: '2026-10-23T09:00:00.000Z' },
    page: { what_i_read: { headline: 'You keep every feature because cutting one feels like admitting it was wrong.', body: '', closing_question: '', your_answer: null },
      what_you_learned: { text: '', sources: [{ author: 'Eric Ries', book: 'The Lean Startup' }] },
      your_move: { title: 'List the features', mission: 'List every feature and mark the one nobody asked for.', success: 'One feature is marked.' },
      how_it_went: { report_id: 'fake-report-2', outcome: 'couldnt', note: 'The clinic closed for the holiday. A smaller version was offered.', reply: '', prediction: { text: '', check: null }, sharing: 'private' } } },
  { row: { id: 'fake-situation-4', title: 'Why nobody replies to my emails', status: 'didnt', status_label: "Didn't", last_activity_at: '2026-10-22T09:00:00.000Z' },
    page: { what_i_read: { headline: 'Your emails ask for a lot before they give anything.', body: '', closing_question: '', your_answer: null },
      what_you_learned: { text: '', sources: [{ author: 'Chris Voss', book: 'Never Split the Difference' }] },
      your_move: { title: 'Rewrite the email', mission: 'Rewrite the first email so it asks one small question.', success: 'The email asks one question.' },
      how_it_went: { report_id: 'fake-report-3', outcome: 'didnt', note: 'I did not know what to write.', reply: '', prediction: { text: '', check: null }, sharing: 'private' } } },
  { row: { id: 'fake-situation-5', title: 'Hiring plan', status: 'paused', status_label: 'Paused', last_activity_at: '2026-10-10T09:00:00.000Z' },
    page: { what_i_read: { headline: 'You are planning a hire before you have a customer.', body: '', closing_question: '', your_answer: null },
      what_you_learned: null, your_move: null, how_it_went: null } },
];
const HISTORY_ACTION = { open: ['pick_up', 'Pick it up'], paused: ['bring_back', 'Bring it back'], done: ['talk_again', 'Talk about this again'], couldnt: ['talk_again', 'Talk about this again'], didnt: ['talk_again', 'Talk about this again'] } as const;

// Settings, from the mock's sample values. The two lines under "share automatically" are the server's own
// (server/journey/report/wording.js), and the account lines are server/journey/home/wording.js.
const SHARE_TEXT = {
  on: 'On. What happens in your check-ins is shared with other founders, with no name, without asking each time. Turn it off any time.',
  off: 'Off. After each check-in I ask if you want to share what happened, with no name. Nothing is shared unless you say yes.',
};
const FAKE_SETTINGS: Settings = {
  you: { name: 'Rafay', email: 'rafay@example.com', country: 'Pakistan', timezone: 'Asia/Karachi' },
  signup_answers: {
    stage: { value: "I'm building it and nobody pays yet" },
    where: { country: 'Pakistan', customers: 'Mostly abroad' },
    building: 'A scheduling tool for dental clinics',
  },
  links: { privacy: 'https://example.com/privacy', terms: 'https://example.com/terms' },
  reminders: { checkin_time: '20:00', morning_on: true, evening_on: true, lock_screen: 'short', quiet_hours: { start: '22:00', end: '06:00' }, push_registered: true },
  mentor_style: 'direct',
  keep_items: false,
  privacy: { share_automatically: false, text: SHARE_TEXT.off },
};
export type AccountSim = 'pending' | 'off';
// The account lines are ACCOUNT_COPY in server/journey/home/wording.js; the server puts the day in {date}.
const ACCOUNT = {
  exportReady: 'Here is everything Axiom holds about you. It is yours to keep.',
  recorded: 'I have your request. Nothing has been deleted. Deleting everything Axiom knows about you is not switched on yet, and I will not guess with your history.',
  waiting: 'Your deletion is waiting. On {date} I will delete everything Axiom holds about you. Until then you can cancel and nothing changes. After that it cannot be undone.',
  pending: 'Done. On {date} I will delete everything Axiom holds about you. Until then you can cancel and nothing changes. After that it cannot be undone.',
  cancelled: 'Cancelled. Nothing was deleted. Everything is still here.',
  nothing: 'There is no deletion waiting.',
};
// The server refuses a check-in time inside quiet hours.
const inQuiet = (t: string, q: { start: string; end: string }) => (q.start < q.end ? t >= q.start && t < q.end : t >= q.start || t < q.end);

// The mock's greeting for the hour. The server picks one from its approved set; these are the mock's own six.
function fakeGreeting(now: Date): { kind: string; text: string } {
  const h = now.getHours();
  const day = now.getDay();
  if (day === 6 || day === 0) return { kind: 'weekend', text: "Saturday, Rafay. Nobody's watching. What are you building?" };
  if (h >= 4 && h < 7) return { kind: 'early', text: "6 am, Rafay. Most people aren't up. Their loss. What's the plan?" };
  if (h < 12) return { kind: 'morning', text: "78 days to your first customer, Rafay. No pressure. Some pressure. What's the move?" };
  if (h < 17) return { kind: 'midday', text: "Midday, Rafay. Coffee doesn't count as progress. What have you moved?" };
  if (h < 22) return { kind: 'evening', text: "Day's nearly done, Rafay. What got done besides email?" };
  return { kind: 'late', text: 'Still up, Rafay? Make it count, or go to sleep.' };
}

function fakeHome(state: HomeSim, now: Date): Home {
  const drawer = (to_do: HomeItem[]): Home['drawer'] => ({
    to_do,
    open: to_do.length > 0 ? [{ id: FAKE_SITUATION, title: 'Asking the two clinics for a call', stage: to_do[0].target.stage, last_activity_at: '2026-10-26T09:00:00.000Z' }] : [],
    paused: [FAKE_PAUSED],
    recent: FAKE_RECENT,
  });
  if (state === 'care') {
    return { greeting: { kind: 'care_check_in', text: 'How are you doing today?' }, care_check_in: true, items: [], fade_after_ms: 8000, drawer: { to_do: [], open: [], paused: [], recent: [] }, due_reports: [] };
  }
  const to_do = { morning: [TODAY_ITEM], report: [REPORT_ITEM], evening: [STILL_ITEM, REPORT_ITEM], nothing: [] }[state];
  return {
    greeting: fakeGreeting(now),
    care_check_in: false,
    items: to_do,
    fade_after_ms: 8000,
    drawer: drawer(to_do),
    due_reports: state === 'report' || state === 'evening' ? [DUE_REPORT] : [],
  };
}

// The mock's rule for "ok": fewer than 3 words that say something is not an answer.
const FILLER = new Set('ok okay k yes yeah yep yup no nope sure fine hmm hm mm um uh thanks thank you thx cool got it i see makes sense right true alright maybe idk good nice lol so well kinda'.split(' '));
const isReal = (t: string) => t.toLowerCase().replace(/[^a-z0-9%$\s']/g, ' ').split(/\s+/).filter((w) => w && !FILLER.has(w)).length >= 3;
// The mock's "enough": a described situation with one concrete detail.
const isEnough = (t: string) => t.split(/\s+/).length >= 8 && /\d|\b(one|two|three|four|five|six|seven|eight|nine|ten|twice|once|yesterday)\b/i.test(t);

// `latencyMs` makes the Learn calls take a while, so the loading hint can be seen.
// `reportDue` puts the mock's check-in waiting, as it is on the evening of a committed move.
// `home` makes the fake a founder who has signed up already, landing on that home state.
export function createFakeApi(sim: CareSim = 'none', latencyMs = 0, reportDue = false, home?: HomeSim, founder?: FounderSim, account?: AccountSim): AxiomApi {
  // 'pending' starts with a deletion already waiting, as for a founder who closed the app.
  let deleteAfter: string | null = account === 'pending' ? new Date(Date.now() + 7 * 864e5).toISOString() : null;
  const day = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  const withPending = (s: Settings): Settings => ({ ...s, pending_deletion: deleteAfter ? { delete_after: deleteAfter, message: ACCOUNT.waiting.replace('{date}', day(deleteAfter)) } : null });
  const homeState: HomeSim | undefined = reportDue ? 'evening' : home;
  let checkedIn = false;
  let settings = FAKE_SETTINGS;
  const wait = () => (latencyMs > 0 ? new Promise<void>((r) => setTimeout(r, latencyMs)) : undefined);
  const screen = async (): Promise<Screened> => (sim === 'clear' ? CLEAR : sim === 'unclear' ? UNCLEAR : {});

  // Situations kept in memory, so a turn id sent twice gets the same answer, like the server.
  let nextId = 1;
  const situations = new Map<string, { asked: number; said: string[]; turns: SituationView['turns'] }>();
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
    const at = () => new Date().toISOString();
    if (!isReal(text)) {
      reply = { situation_id: situationId, status: 'say_more', reply: SAY_MORE, ...counts(asked) };
    } else {
      const id = situationId ?? `fake-situation-${nextId++}`;
      const said = [...(state?.said ?? []), text];
      const done = asked >= MAX_FOLLOW_UPS || isEnough(said.join(' '));
      reply = done
        ? { situation_id: id, status: 'ready', reply: null, ...counts(asked) }
        : { situation_id: id, status: 'follow_up', reply: FOLLOW_UPS[asked], ...counts(asked + 1) };
      const turns: SituationView['turns'] = [...(state?.turns ?? []), { role: 'founder', text, created_at: at() }, ...(reply.reply ? [{ role: 'axiom' as const, text: reply.reply, created_at: at() }] : [])];
      situations.set(id, { asked: done ? asked : asked + 1, said, turns });
    }
    replies.set(turnId, reply);
    return reply;
  };

  // Learn, kept in memory so a turn id sent twice gets the same answer, like the server.
  const learnReplies = new Map<string, Screened<LearnReply>>();
  let realReplies = 0;
  // Closed founder lessons: the notice rides one response, the first of the second Learn reply and the story.
  let noticeSent = false;
  const closedNotice = (): Pick<StoryReply, 'founder_lessons'> => {
    if (founder !== 'closed' || noticeSent) return {};
    noticeSent = true;
    return { founder_lessons: FAKE_CLOSED };
  };
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
    async getSignup() {
      const complete = homeState !== undefined;
      return { questions: QUESTIONS, answers: complete ? settings.signup_answers : {}, next: complete ? null : QUESTIONS[0].key, complete };
    },
    saveAnswer: screen,
    async getFirstReading() {
      return READING;
    },
    startSituation: (text, turnId) => turn(null, text, turnId),
    sendTurn: (situationId, text, turnId) => turn(situationId, text, turnId),
    async getSituation(id): Promise<SituationView> {
      const state = situations.get(id);
      if (!state) throw new HttpError(404);
      return { situation: { id, title: null, status: 'open', follow_up_count: state.asked, created_at: state.turns[0].created_at }, turns: state.turns, read: null };
    },
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
          ...(offered ? { founder_case: founder === 'closed' ? null : FAKE_CASE, ...closedNotice(), move_offer: 'first' as const, move_notice: { kind: 'first' as const, kicker: 'Your move', text: 'Your move is ready.' } } : {}),
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
      if (moveId !== move.id) throw new HttpError(404);
      if (move.status !== 'committed') {
        move = { ...move, status: 'committed', committed_at: '2026-10-26T09:05:00.000Z', report_time_local: FAKE_REPORT_TIME, time_zone: timezone };
      }
      return { move, report: { due_at: '2026-10-26T20:00:00.000Z', local_time: move.report_time_local ?? FAKE_REPORT_TIME, time_zone: move.time_zone ?? timezone } };
    },
    async swapMove(moveId, reason): Promise<Screened<SwapResult>> {
      const flagged = await screen();
      if (flagged.care) return flagged;
      if (swapped && moveId === FAKE_MOVE.id) return swapped;
      if (moveId !== move.id) throw new HttpError(404);
      if (!move.can_swap) throw new HttpError(409, 'swap_used');
      if (!isReal(reason)) return { status: 'need_reason', reply: NEED_REASON };
      swapped = { status: 'swapped', replaced_id: move.id, move: FAKE_SWAPPED };
      move = FAKE_SWAPPED;
      return swapped;
    },
    async getLoadingHint() {
      return FAKE_HINT;
    },
    async getMove(moveId) {
      if (moveId !== move.id) throw new HttpError(404);
      return move;
    },
    async getDueReports() {
      return (homeState === 'evening' || homeState === 'report') && !reported ? [FAKE_DUE] : [];
    },
    async sendReport(moveId, outcome, note): Promise<Screened<ReportResult>> {
      if (moveId !== FAKE_DUE.move_id) throw new HttpError(404);
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
      return { story: FAKE_STORY, ...closedNotice() };
    },
    async setConsent(_reportId, share): Promise<ConsentResult> {
      return {
        consent: { ask: false, state: share ? 'shared' : 'private', automatic: false },
        reply: share ? SHARED_LINE : KEPT_PRIVATE_LINE,
      };
    },
    async withdrawShare() {
      return { consent: { ask: false, state: 'withdrawn', automatic: false }, reply: 'Taken down. Nothing from this check-in is shared.' };
    },
    async getHome() {
      const settled = (homeState === 'care' && checkedIn) || (reported && (homeState === 'evening' || homeState === 'report'));
      return fakeHome(settled ? 'nothing' : homeState ?? 'nothing', new Date());
    },
    async sendCheckIn(): Promise<Screened<{ ok: true }>> {
      const flagged = await screen();
      if (flagged.care) return flagged;
      checkedIn = true;
      return { ok: true };
    },
    async getHistory(q) {
      const needle = q.trim().toLowerCase();
      const hay = (h: (typeof HISTORY)[number]) => `${h.row.title} ${h.page.what_i_read?.headline ?? ''} ${h.page.what_you_learned?.sources.map((x) => `${x.author} ${x.book}`).join(' ') ?? ''}`.toLowerCase();
      return HISTORY.filter((h) => !needle || hay(h).includes(needle)).map((h) => h.row);
    },
    async getHistoryPage(id): Promise<HistoryPage> {
      const h = HISTORY.find((x) => x.row.id === id);
      if (!h) throw new HttpError(404);
      const [kind, label] = HISTORY_ACTION[h.row.status];
      return { ...h.page, id, title: h.row.title, status: h.row.status, status_label: h.row.status_label, action: { kind, label, target: { stage: h.row.status === 'open' ? 'move' : 'learn', situation_id: id } } };
    },
    async getSettings() {
      return withPending(settings);
    },
    async updateSettings(patch) {
      const { share_automatically, keep_items, mentor_style, ...reminders } = patch;
      const next: Settings = { ...settings, reminders: { ...settings.reminders, ...reminders } };
      if (inQuiet(next.reminders.checkin_time, next.reminders.quiet_hours)) throw new HttpError(400, 'quiet_hours_clash');
      if (keep_items !== undefined) next.keep_items = keep_items;
      if (mentor_style) next.mentor_style = mentor_style;
      if (share_automatically !== undefined) next.privacy = { share_automatically, text: share_automatically ? SHARE_TEXT.on : SHARE_TEXT.off };
      settings = next;
      return withPending(settings);
    },
    async requestExport(): Promise<AccountExport> {
      return { message: ACCOUNT.exportReady, exported_at: new Date().toISOString(), account: { email: FAKE_SETTINGS.you.email, first_name: FAKE_SETTINGS.you.name }, situations: [] };
    },
    async requestDelete(): Promise<AccountRequest> {
      if (account === 'off') return { status: 'recorded', message: ACCOUNT.recorded };
      deleteAfter ??= new Date(Date.now() + 7 * 864e5).toISOString();
      return { status: 'pending_deletion', message: ACCOUNT.pending.replace('{date}', day(deleteAfter)), delete_after: deleteAfter };
    },
    async cancelDelete(): Promise<AccountRequest> {
      if (!deleteAfter) return { status: 'none', message: ACCOUNT.nothing };
      deleteAfter = null;
      return { status: 'cancelled', message: ACCOUNT.cancelled };
    },
    async resumeUnsent() {},
    async signOut() {},
    async registerPushToken() {},
    async removePushToken() {},
  };
}
