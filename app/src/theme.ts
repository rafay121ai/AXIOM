import { SourceSerif4_400Regular, SourceSerif4_500Medium } from '@expo-google-fonts/source-serif-4';
import { Platform } from 'react-native';

// Every colour, type size and spacing value lives here.
// Source: DESIGN.md and tasks/design/mock-onboarding-v2.html.

export const ink = (alpha: number) => `rgba(234,236,238,${alpha})`;
export const gold = (alpha: number) => `rgba(205,178,126,${alpha})`;

export const colors = {
  base: '#050505',
  ink: 'rgb(234,236,238)',
  inkBright: '#f1f2f3',
  goldFrom: 'rgb(205,178,126)',
  goldTo: 'rgb(168,142,94)',
  onGold: '#0a0806',
  // Writing levels from DESIGN.md: 0.9 body, 0.7 secondary, 0.5 labels, 0.35 hints
  body: ink(0.9),
  secondary: ink(0.7),
  label: ink(0.5),
  hint: ink(0.35),
  line: ink(0.12),
} as const;

export const goldGradient = [colors.goldFrom, colors.goldTo] as const;

// One free serif (Source Serif 4, OFL), loaded in App.tsx, so Axiom's words look the same everywhere.
export const serifFiles = { SourceSerif4_400Regular, SourceSerif4_500Medium };

export const fonts = {
  serif: 'SourceSerif4_400Regular',
  serifMedium: 'SourceSerif4_500Medium',
  sans: Platform.select({
    web: '-apple-system, "SF Pro Text", "Inter", system-ui, "Segoe UI", sans-serif',
    default: undefined,
  }) as string | undefined,
};

export const type = {
  question: { fontFamily: fonts.serif, fontSize: 27, lineHeight: 34, color: colors.ink, letterSpacing: -0.1 },
  sub: { fontFamily: fonts.sans, fontSize: 14, lineHeight: 21, color: colors.label },
  option: { fontFamily: fonts.sans, fontSize: 16, lineHeight: 22 },
  chip: { fontFamily: fonts.sans, fontSize: 14.5 },
  label: { fontFamily: fonts.sans, fontSize: 10, letterSpacing: 2, textTransform: 'uppercase' as const, color: ink(0.42) },
  field: { fontFamily: fonts.sans, fontSize: 17, color: colors.ink },
  big: { fontFamily: fonts.serif, fontSize: 19, lineHeight: 29, color: colors.ink },
  button: { fontFamily: fonts.sans, fontSize: 15.5 },
  legal: { fontFamily: fonts.sans, fontSize: 11.5, lineHeight: 18, color: ink(0.42) },
  careHead: { fontFamily: fonts.serifMedium, fontSize: 25, lineHeight: 32.5, color: '#f1f1ef' },
  care: { fontFamily: fonts.serif, fontSize: 17.5, lineHeight: 27, color: colors.body },
  readingHead: { fontFamily: fonts.serifMedium, fontSize: 25, lineHeight: 32.5, color: colors.inkBright },
  reading: { fontFamily: fonts.serif, fontSize: 19.5, lineHeight: 28.5, letterSpacing: -0.04, color: ink(0.96) },
  readBody: { fontFamily: fonts.serif, fontSize: 18.5, lineHeight: 27.5, color: ink(0.96) },
  readNext: { fontFamily: fonts.serif, fontSize: 19, lineHeight: 28, color: '#f4f4f2' },
  readSay: { fontFamily: fonts.serif, fontSize: 17, lineHeight: 25, color: ink(0.96) },
  founder: { fontFamily: fonts.sans, fontSize: 14.5, lineHeight: 21.75, color: ink(0.7) },
  waitLine: { fontFamily: fonts.serif, fontSize: 21, lineHeight: 31.5, color: ink(0.85), textAlign: 'center' as const },
};

export const space = { screenX: 26, qTop: 34, bar: 14 };

// Glass: frosted, a bright top edge, a faint tint (mock: --blur 42, --tint .1, --edge .2)
export const glass = { blurIntensity: 60, tint: 0.1, edge: 0.2 };

export const motion = {
  swapOut: 240,
  screenOut: 280,
  screenIn: 500,
  progress: 500,
  autoAdvance: 380,
  drawCycle: 3600,
};
