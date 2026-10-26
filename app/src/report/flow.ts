import type { ConsentQuestion, ConsentState, DueReport } from '../api/types';
import type { MarkName } from '../components/RoundMark';
import { copy } from '../copy';

// The rules of the Report that are not drawing: what each tap shows, and which sharing question is asked.

export const OUTCOME_MARK: Record<DueReport['outcomes'][number], MarkName> = { done: 'tick', couldnt: 'pause', didnt: 'dash' };

export const outcomeLabel = (o: DueReport['outcomes'][number]): string => copy.report.outcome[o];

/**
 * The sharing question to ask now, with its wording version, or null when the server did not ask (shared automatically,
 * or the check-in cannot be shared). After the founder has seen a story the server's "after story" wording is the one asked.
 */
export function consentQuestion(consent: ConsentState, sawStory: boolean): ConsentQuestion | null {
  if (!consent.ask) return null;
  return sawStory && consent.question_after_story ? consent.question_after_story : consent.question;
}
