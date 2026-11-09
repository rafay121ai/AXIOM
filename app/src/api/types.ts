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

/** Help as the server's care check sends it: one line and the website that lists helplines for every country. No phone numbers. */
export type CareHelp = { line: string; url: string };

/** Clear distress: show the care screen. No lesson, no move. */
export type CareClear = { care: 'clear'; message: string; help: CareHelp };
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

/** One earlier line of a situation, oldest first. Filler turns the server left out are not here. */
export type SituationTurn = { role: 'founder' | 'axiom'; text: string; created_at: string };

/** A situation as it stands, for picking it up again: what was said so far, and the Read if there is one. */
export type SituationView = {
  situation: { id: string; title: string | null; status: string; follow_up_count: number; created_at: string };
  turns: SituationTurn[];
  read: Read | null;
};

/** The Read: a headline, a short body (paragraphs split by blank lines) and one closing question. No underlines.
 * `answered`: the talk after the question is over and Learn is next. `talk`: what was said since the question, to resume it. */
export type Read = { headline: string; body: string; closing_question: string; answered: boolean; skipped: boolean; talk?: { role: 'founder' | 'axiom'; text: string }[] };

/** What the founder does with the closing question: answers in words, or skips. */
export type ReadAnswer = { text: string } | { skip: true };

/** `say_more`: the reply was too thin to count. `talk`: Axiom replies and asks one more question (1 to 5 in all). `stored`: Learn is next. */
export type ReadAnswerResult = { status: 'say_more' | 'talk'; reply: string } | { status: 'stored'; skipped: boolean; next: 'learn' };

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
  /** A real founder's approved case, when the server sends one on this answer. No author line: it is not from a book. */
  founder_case?: FounderCase | null;
  founder_lessons?: FounderLessons;
};

/** One move, as the server shows it. `words` is the suggested wording, if the move needs any. */
export type MoveView = {
  id: string;
  learn_id: string;
  situation_id: string;
  /** `draft` until committed; the server has more states after that. */
  status: string;
  title: string;
  mission: string;
  success: string;
  words: string | null;
  checklist: string[];
  prediction: string;
  start_minutes: number;
  /** False once the one change has been used. */
  can_swap: boolean;
  swapped_from: string | null;
  committed_at: string | null;
  report_due_at: string | null;
  /** 'HH:MM' in the founder's time zone. */
  report_time_local: string | null;
  time_zone: string | null;
  created_at: string;
};

/** Committing a move schedules its report. `local_time` is when Axiom will remind the founder, as 'HH:MM'. */
export type Commitment = { move: MoveView; report: { due_at: string; local_time: string; time_zone: string } };

/** `need_reason`: the reason was not a real one, `reply` is Axiom's line. `swapped`: `move` is the new draft. */
export type SwapResult = { status: 'swapped'; replaced_id: string; move: MoveView } | { status: 'need_reason'; reply: string };

/** One verified quote for the loading hint, with the book name only. */
export type LoadingQuote = { book: string; quote: string };

/** The three ways a check-in can go. Nothing else can be reported, and none of them costs the founder anything. */
export type Outcome = 'done' | 'couldnt' | 'didnt';

/** A move waiting for its check-in. `opening` is Axiom's first line, `questions` the plain question after each tap. */
export type DueReport = {
  move_id: string;
  title: string;
  /** False while the move is still open and its evening has not come. */
  due: boolean;
  report_due_at: string | null;
  opening: string;
  prediction: string;
  outcomes: Outcome[];
  questions: Record<Outcome, string>;
};

/** One sharing question. The wording version is sent back with the answer, so the log holds the words the founder saw. */
export type ConsentQuestion = { text: string; wording_version: string };

/** Asked at every check-in unless the founder turned on sharing automatically. Nothing is pre-selected. */
export type ConsentState =
  | { ask: true; state: 'asked'; question: ConsentQuestion; question_after_story: ConsentQuestion | null; choices: ['share', 'keep_private'] }
  | { ask: false; state: string; automatic: boolean };

/** `need_more`: the note was too thin to count, `reply` is Axiom's line. `reported`: stored once; sending it again returns the same. */
export type ReportResult =
  | { status: 'need_more'; reply: string }
  | {
      status: 'reported';
      report: { id: string; outcome: Outcome };
      reply: string;
      /** Set only when an approved founder story fits. */
      story_offer: { text: string } | null;
      consent: ConsentState;
      unlock: { granted: boolean };
    };

/** A founder story that was shared with consent and approved by a person. */
export type Story = { story: string; lesson: string | null; outcome: string; stage: string | null };
/** A founder case in the Learn chat. */
export type FounderCase = { story: string; lesson?: string | null; outcome: string };
/** Sent once, on the one response that tells the founder founder lessons are closed. The text is the server's. */
export type FounderLessons = { state: 'closed_notice'; notice: { text: string; wording_version: string } };
/** `GET /api/reports/:id/story`: the story if one fits, and the closed notice when it is due. */
export type StoryReply = { story: Story | null; founder_lessons?: FounderLessons };

/** After the founder shares or keeps private: the server's own confirmation line. */
export type ConsentResult = { consent: ConsentState; reply: string };

/** Where the screens a home item or a history action leads: the stage, the situation, and the move when there is one. */
export type Target = { stage: 'situation' | 'read' | 'learn' | 'move' | 'report'; situation_id: string; move_id?: string };

/** One thing still to do. `stays` is true when it must not fade (the founder asked, or no phone can ring). */
export type HomeItem = { kind: 'report' | 'move' | 'situation'; label: string; title: string | null; stays: boolean; target: Target };

/** A situation listed in the menu. `stage` is where it stands, null once it has no live screen. */
export type DrawerSituation = { id: string; title: string | null; stage: Target['stage'] | null; last_activity_at: string };

/**
 * The home screen. Axiom's greeting comes from the server, as does every label. While a care event is open
 * (`care_check_in`) the greeting is the gentle check-in line and there is nothing else.
 */
export type Home = {
  greeting: { kind: string; text: string };
  care_check_in: boolean;
  /** At most 2, shown above the bar and faded after `fade_after_ms`, except those that stay. */
  items: HomeItem[];
  fade_after_ms: number;
  drawer: { to_do: HomeItem[]; open: DrawerSituation[]; paused: DrawerSituation[]; recent: { id: string; title: string | null; status: string }[] };
  due_reports: { move_id: string; situation_id: string; title: string | null; report_due_at: string }[];
};

/** One row of History: a plain title and one quiet status word, `status_label`, as the server words it. */
export type HistoryRow = { id: string; title: string | null; status: 'open' | 'done' | 'couldnt' | 'didnt' | 'paused'; status_label: string; last_activity_at: string };

/** A past situation, read only. A section is null when that part was never reached. `action` is the one thing to do from here. */
export type HistoryPage = {
  id: string;
  title: string | null;
  status: HistoryRow['status'];
  status_label: string;
  what_i_read: { headline: string; body: string; closing_question: string; your_answer: string | null } | null;
  what_you_learned: { text: string; sources: LearnSource[] } | null;
  your_move: { title: string; mission: string; success: string } | null;
  how_it_went: { report_id: string; outcome: Outcome; note: string | null; reply: string; prediction: { text: string; check: string | null }; sharing: 'shared' | 'private' } | null;
  action: { kind: 'pick_up' | 'bring_back' | 'talk_again'; label: string; target: Target };
};

export type LockScreen = 'full' | 'short' | 'hidden';
export type MentorStyle = 'calm' | 'direct' | 'hard';

/** Settings, as one page. The words under "share automatically" (`privacy.text`) are the server's. */
export type Settings = {
  you: { name: string | null; email: string | null; country: string | null; timezone: string | null };
  signup_answers: Record<string, Answer>;
  /** Where Privacy and Terms open; null when there is none yet. */
  links: { privacy: string | null; terms: string | null };
  reminders: {
    /** 'HH:MM' in the founder's time zone. */
    checkin_time: string;
    morning_on: boolean;
    evening_on: boolean;
    lock_screen: LockScreen;
    quiet_hours: { start: string; end: string };
    /** False when no phone can ring: the check-in then waits on the home screen. */
    push_registered: boolean;
  };
  mentor_style: MentorStyle;
  keep_items: boolean;
  privacy: { share_automatically: boolean; text: string };
  /** A deletion waiting out its grace period, with the server's own sentence. Absent or null when none. */
  pending_deletion?: { delete_after: string; message: string } | null;
  /** What deleting removes and what happens to shared stories, shown before the founder confirms. */
  deletion: { would_remove: string[]; shared_outcomes: string };
};

/** Any of these can be saved on their own. The answer is the whole page again. */
export type SettingsPatch = Partial<Pick<Settings, 'mentor_style' | 'keep_items'> & Settings['reminders']> & { share_automatically?: boolean };

/** The server's answer to a delete or a cancel. `message` is its own sentence (it already names the date); the app adds none. */
export type AccountRequest = { status: 'recorded' | 'pending_deletion' | 'cancelled' | 'none'; message: string; delete_after?: string };

/** The export: the data file itself. `message` is the server's "ready" line; the rest is shared as it came. */
export type AccountExport = { message: string } & Record<string, unknown>;

/** The sign-up as it stands: the questions, what the founder has answered, the key of the first unanswered one (null when all are), and whether every one is answered. */
export type Signup = { questions: Question[]; answers: Record<string, Answer>; next: string | null; complete: boolean };

/** The kind of phone a reminder token belongs to. */
export type PushPlatform = 'ios' | 'android';

export interface AxiomApi {
  /** Starts Google sign-in. Resolves when the founder is signed in. */
  signInWithGoogle(): Promise<void>;
  /** True when this device already has a sign-in saved. */
  isSignedIn(): Promise<boolean>;
  /** The onboarding questions in order, with the founder's saved answers. */
  getSignup(): Promise<Signup>;
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
  /** A situation with what was said in it so far: how the app picks a situation up again. */
  getSituation(situationId: string): Promise<SituationView>;
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
  /** The move behind a Learn conversation's card. Asking again returns the same move. */
  openMove(learnId: string): Promise<MoveView>;
  /** Commits a move and schedules its report in the phone's time zone (`timezone`, IANA). Safe to send again. */
  commitMove(moveId: string, timezone: string): Promise<Commitment>;
  /** Changes a move once, with the founder's reason. Screened first. Sending the same swap again returns the new move. */
  swapMove(moveId: string, reason: string): Promise<Screened<SwapResult>>;
  /** One verified quote and its book while an answer is on its way, or null when nothing fits. Never throws for the screen. */
  getLoadingHint(seed: string): Promise<LoadingQuote | null>;
  /** One move by id: the sheet behind a home item. */
  getMove(moveId: string): Promise<MoveView>;
  /** Moves waiting for a check-in, the one due first. Empty while the care screen is open. */
  getDueReports(): Promise<DueReport[]>;
  /**
   * The founder's check-in on a move: which outcome, and what happened in their words. `turnId` is a uuid made once per send;
   * sending it again is safe, and a move is reported once. Screened first.
   */
  sendReport(moveId: string, outcome: Outcome, note: string, turnId: string): Promise<Screened<ReportResult>>;
  /** The founder story offered after a report, or null when none fits. */
  getStory(reportId: string): Promise<StoryReply>;
  /** Share or keep private, with the wording version of the question the founder saw. Sending the same answer again is safe. */
  setConsent(reportId: string, share: boolean, wordingVersion: string): Promise<ConsentResult>;
  /** Takes a shared check-in down. The reply is the server's line, or null when nothing was shared. Safe to repeat. */
  withdrawShare(reportId: string): Promise<{ consent: ConsentState; reply: string | null }>;
  /** The home screen. `timeZone` is the phone's, used when the founder has none saved. Each call picks a new greeting. */
  getHome(timeZone: string): Promise<Home>;
  /** The answer to the care check-in. Screened first; `{ ok: true }` means it was read and home is normal again. */
  sendCheckIn(text: string): Promise<Screened<{ ok: true }>>;
  /** Tells the server this phone can get the evening reminder. Safe to send again. */
  registerPushToken(token: string, platform: PushPlatform, timeZone: string): Promise<void>;
  /** Past situations, newest first. `q` searches titles, what the founder said and the Read's headline. */
  getHistory(q: string): Promise<HistoryRow[]>;
  /** One past situation. */
  getHistoryPage(id: string): Promise<HistoryPage>;
  /** The settings page. */
  getSettings(): Promise<Settings>;
  /** Saves some settings and returns the page as it now stands. */
  updateSettings(patch: SettingsPatch): Promise<Settings>;
  /** Everything Axiom holds, as the server's data file. */
  requestExport(): Promise<AccountExport>;
  /** Asks to delete everything; sends the confirmation word. The server starts a grace period (or only records it while deletion is off). */
  requestDelete(): Promise<AccountRequest>;
  /** Cancels a deletion waiting in its grace period. */
  cancelDelete(): Promise<AccountRequest>;
  /**
   * Sends what was left unsent when the app was last closed. Resolves when it is all sent, or at the first send that
   * has to wait for the connection (the rest keeps going in the background). Safe to call again; sign-out forgets it.
   */
  resumeUnsent(): Promise<void>;
  /** Signs out of this phone. */
  signOut(): Promise<void>;
  /** This phone no longer gets reminders for this founder. */
  removePushToken(token: string): Promise<void>;
}
