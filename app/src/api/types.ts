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

export interface AxiomApi {
  /** Starts Google sign-in. Resolves when the founder is signed in. */
  signInWithGoogle(): Promise<void>;
  /** The onboarding questions, in order. */
  getQuestions(): Promise<Question[]>;
  /** Saves one answer as soon as it is given, so an interrupted founder can resume. */
  saveAnswer(key: string, answer: Answer): Promise<void>;
}
