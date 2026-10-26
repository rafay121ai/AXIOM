import type { HelpLine, Screened } from '../api/types';

// Where a screened response sends the founder. One rule for every text-sending call.
export type CareRoute =
  | { kind: 'care'; message: string; help: HelpLine[] }
  | { kind: 'unclear'; reply: string }
  | { kind: 'carry' };

export function routeScreened(res: Screened): CareRoute {
  if (res.care === 'clear') return { kind: 'care', message: res.message, help: res.help };
  if (res.care === 'unclear') return { kind: 'unclear', reply: res.reply };
  return { kind: 'carry' };
}

/** The care message is one human message: the first paragraph is the heading, the rest is body. */
export function careParagraphs(message: string): { heading: string; body: string[] } {
  const [heading = '', ...body] = message.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  return { heading, body };
}
