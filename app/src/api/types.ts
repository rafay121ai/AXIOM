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

export interface AxiomApi {
  /** Starts Google sign-in. Resolves when the founder is signed in. */
  signInWithGoogle(): Promise<void>;
  /** The onboarding questions, in order. */
  getQuestions(): Promise<Question[]>;
  /** Saves one answer as soon as it is given, so an interrupted founder can resume. Typed answers are screened. */
  saveAnswer(key: string, answer: Answer): Promise<Screened>;
  /** The first reading. Resolves once every saved answer has reached the server and the reading is written. */
  getFirstReading(): Promise<FirstReading>;
  /** Sends something the founder typed. Screened before anything else happens. */
  sendMessage(text: string): Promise<Screened>;
}
