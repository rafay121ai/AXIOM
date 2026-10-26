// The contract between the screens and the server. The real API client will
// implement AxiomApi; until then src/api/fake.ts does. The app never reads or
// writes Supabase tables: Supabase is for sign-in only.

export type SingleQuestion = {
  type: 'single';
  key: string;
  title: string;
  sub?: string;
  options: string[];
  /** The option that opens a typed answer, if any. */
  otherOption?: string;
};

export type WhereQuestion = {
  type: 'where';
  key: string;
  title: string;
  sub?: string;
  countryLabel: string;
  countryPlaceholder: string;
  countries: string[];
  customerLabel: string;
  customers: string[];
};

export type GoalQuestion = {
  type: 'goal';
  key: string;
  title: string;
  sub?: string;
  goals: string[];
  whenLabel: string;
  whens: string[];
  /** The "when" option that asks for a date. */
  dateOption: string;
};

export type TwoQuestion = {
  type: 'two';
  key: string;
  title: string;
  sub?: string;
  groups: [{ label: string; options: string[] }, { label: string; options: string[] }];
};

export type MultiQuestion = {
  type: 'multi';
  key: string;
  title: string;
  sub?: string;
  options: string[];
  /** Picking this clears every other option, and the other way round. */
  exclusive?: string;
};

export type TextQuestion = {
  type: 'text';
  key: string;
  title: string;
  sub?: string;
  placeholder: string;
  minLength: number;
  shortHint: string;
};

export type Question =
  | SingleQuestion
  | WhereQuestion
  | GoalQuestion
  | TwoQuestion
  | MultiQuestion
  | TextQuestion;

export type SingleAnswer = { value: string; other?: string };
export type WhereAnswer = { country?: string; customers?: string };
export type GoalAnswer = { goal?: string; when?: string; date?: string };
export type TwoAnswer = { a: string[]; b: string[] };
export type MultiAnswer = string[];
export type TextAnswer = string;

export type Answer = SingleAnswer | WhereAnswer | GoalAnswer | TwoAnswer | MultiAnswer | TextAnswer;

/** One line of real help for the founder's country. The server sends these; the app never holds numbers. */
export type HelpLine = { label: string; value: string };

/** Clear distress: show the care screen. No lesson, no move. */
export type CareClear = { care: 'clear'; message: string; help: HelpLine[] };
/** Unclear or slang: Axiom answers softly in the chat. No lesson, no move this turn. */
export type CareUnclear = { care: 'unclear'; reply: string };
/** Every text the founder sends is screened first. No `care` field means carry on. */
export type Screened<T = object> = (T & { care?: undefined }) | CareClear | CareUnclear;

/** The first reading, written from the sign-up answers. At most 2 underlines, each a phrase that is in the body. */
export type FirstReading = { headline: string; body: string; underlines: string[] };

/** Where a situation turn stands. `ready` means Axiom has enough and the Read comes next. */
export type SituationStatus = 'follow_up' | 'ready' | 'say_more';

/** Axiom's reply to one situation turn. `situation_id` is null while the first text was too thin to start one. */
export type SituationReply = {
  situation_id: string | null;
  status: SituationStatus;
  /** The follow-up question or "Say a bit more."; null when status is `ready`. */
  reply: string | null;
  follow_up_count: number;
  follow_ups_left: number;
  /** The text started a new situation, because it was about something else. */
  started_new?: boolean;
};

/** The Read: a headline, a short body (paragraphs split by blank lines) and one closing question. No underlines. */
export type Read = { headline: string; body: string; closing_question: string; answered: boolean; skipped: boolean };

/** What the founder does with the closing question: answers in words, or skips. */
export type ReadAnswer = { text: string } | { skip: true };

/** `say_more`: the reply was too thin to count. `stored`: it counted, and Learn is next. */
export type ReadAnswerResult = { status: 'say_more'; reply: string } | { status: 'stored'; skipped: boolean; next: 'learn' };

/** A source named under a lesson: always author and book. A quote is there only when the server checked it word for word. */
export type LearnSource = { author: string; book: string; quote?: string };

/** The fixed picture library. The server fills and checks every number; the app only draws what it is given. */
export type Picture = { derived: { rule: string; inputs: number[]; value: number }[]; interactive: boolean } & (
  | { type: 'split_bar'; data: { title?: string; unit?: string; parts: { label: string; value: number }[] } }
  | { type: 'before_after_bars'; data: { title?: string; unit?: string; items: { label: string; before: number; after: number }[] } }
  | { type: 'side_by_side_table'; data: { title?: string; columns: string[]; rows: { label: string; cells: string[] }[] } }
  | { type: 'timeline'; data: { title?: string; events: { when: string; label: string }[] } }
  | { type: 'two_by_two'; data: { title?: string; x: { low: string; high: string }; y: { low: string; high: string }; quadrants: { label: string }[] } }
);

/** One Axiom turn in the Learn conversation. A tapped follow-up's answer says which turn and which suggestion it answers. */
export type LearnTurn = {
  id: string;
  kind: 'lesson' | 'reply' | 'followup';
  text: string;
  sources: LearnSource[];
  picture: Picture | null;
  /** Suggestions to tap. Tapping one never posts a founder message. */
  follow_ups: string[];
  for_turn_id?: string;
  followup_index?: number;
};

/** The card in the chat that says the move is ready. The whole card is tappable; there are no buttons. */
export type MoveNotice = { kind: 'first' | 'second'; kicker: string; text: string };

/**
 * Axiom's answer in the Learn conversation. `say_more` means the reply was too thin to count (`turn` is null and
 * `reply` is the line to show). `move_notice` is set only when the server offers the move on this answer.
 */
export type LearnReply = {
  learn_id: string;
  situation_id: string;
  status: 'reply' | 'say_more';
  turn: LearnTurn | null;
  reply?: string;
  move_offer: 'none' | 'first' | 'second';
  move_notice: MoveNotice | null;
};

/** One verified quote for the loading hint, with the book name only. */
export type LoadingQuote = { book: string; quote: string };

export interface AxiomApi {
  /** Starts Google sign-in. Resolves when the founder is signed in. */
  signInWithGoogle(): Promise<void>;
  /** The onboarding questions, in order. */
  getQuestions(): Promise<Question[]>;
  /** Saves one answer as soon as it is given, so an interrupted founder can resume. Typed answers are screened. */
  saveAnswer(key: string, answer: Answer): Promise<Screened>;
  /** The first reading. Resolves once every saved answer has reached the server and the reading is written. */
  getFirstReading(): Promise<FirstReading>;
  /**
   * Starts a situation from the founder's text. `turnId` is a uuid made once per send; sending it again is safe.
   * Screened before anything else happens.
   */
  startSituation(text: string, turnId: string): Promise<Screened<SituationReply>>;
  /** The next text in a situation. Same turn id rules as startSituation. A new topic comes back with `started_new`. */
  sendTurn(situationId: string, text: string, turnId: string): Promise<Screened<SituationReply>>;
  /** The Read for a situation. The same Read comes back every time it is asked for. */
  getRead(situationId: string): Promise<Read>;
  /** The founder's reply to the Read's closing question, or a skip. Typed replies are screened. */
  answerRead(situationId: string, answer: ReadAnswer): Promise<Screened<ReadAnswerResult>>;
  /** The lesson for a situation whose Read has been answered or skipped. Asking again returns the same lesson. */
  startLearn(situationId: string): Promise<LearnReply>;
  /** The founder's reply in Learn. `turnId` is a uuid made once per send; sending it again is safe. Screened first. */
  sendLearnTurn(learnId: string, text: string, turnId: string): Promise<Screened<LearnReply>>;
  /** The founder tapped suggestion `index` under Axiom's turn `turnId`. Axiom's own text: not screened, no founder message. */
  tapFollowUp(learnId: string, turnId: string, index: number): Promise<LearnReply>;
  /** One verified quote and its book while an answer is on its way, or null when nothing fits. Never throws for the screen. */
  getLoadingHint(seed: string): Promise<LoadingQuote | null>;
}
