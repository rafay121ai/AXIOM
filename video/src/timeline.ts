// The whole 4:30 cut. Times in seconds. Each product scene plays public/clips/<clip>.mp4,
// cut from the live recording by capture/cut.mjs to exactly the scene's length.
export const FPS = 30

export type Product = {
  kind: 'product'
  clip: string
  step: string
  title: string
  body: string
  chips: string[]
}
export type Scene = { from: number; dur: number } & (
  | { kind: 'intro' }
  | { kind: 'journey' }
  | Product
  | { kind: 'value' }
  | { kind: 'outro' }
)

export const SCENES: Scene[] = [
  { from: 0, dur: 24, kind: 'intro' },
  { from: 24, dur: 14, kind: 'journey' },
  { from: 38, dur: 30, kind: 'product', clip: 'onboarding', step: 'Sign up',
    title: '13 short questions.',
    body: 'Stage, goal, what they avoid. Axiom reads every later situation through these answers.',
    chips: ['Eleven taps, two sentences of their own'] },
  { from: 68, dur: 28, kind: 'product', clip: 'situation', step: 'Situation',
    title: 'In their own words.',
    body: 'A competitor went free. Three of 31 bakeries asked about switching. The price decision is due Friday.',
    chips: ['At most 2 follow-up questions, enforced in code', 'Here it needed none'] },
  { from: 96, dur: 30, kind: 'product', clip: 'read', step: 'Read',
    title: 'What is really going on.',
    body: 'The price cut is coming from pressure, not from what the bakeries said. Every quote is the founder’s own words.',
    chips: ['Quotes checked against what the founder typed'] },
  { from: 126, dur: 50, kind: 'product', clip: 'learn', step: 'Learn',
    title: 'Taught from named books.',
    body: 'Reid Hoffman, Blitzscaling. Andrew Chen, The Cold Start Problem. Author and book come from the library, not the model’s memory.',
    chips: ['No invented quotes', 'Every reply builds on a real passage'] },
  { from: 176, dur: 34, kind: 'product', clip: 'move', step: 'Move',
    title: 'One move for today.',
    body: 'Ask the three bakeries if they would stay at $49, and what they would miss. Starts in 10 minutes. It works or it doesn’t.',
    chips: ['The founder is the only one acting', 'Success is yes or no'] },
  { from: 210, dur: 38, kind: 'product', clip: 'report', step: 'Report',
    title: 'That evening: how did it go?',
    body: 'Done, Couldn’t or Didn’t. Axiom checks its own prediction against what happened and sets up the next move.',
    chips: ['No streaks, no guilt', 'Sharing is asked every time. This one stayed private'] },
  { from: 248, dur: 14, kind: 'value' },
  { from: 262, dur: 8, kind: 'outro' },
]

export const TOTAL_SECONDS = 270
