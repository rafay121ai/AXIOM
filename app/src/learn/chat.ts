import type { FounderCase, LearnReply, LearnSource, LearnTurn, MoveNotice } from '../api/types';

// The conversation on the Learn screen, kept as plain data so its rules can be tested without drawing anything.

export type LearnItem =
  | { key: number; who: 'ax'; turn: LearnTurn }
  | { key: number; who: 'say'; text: string }
  | { key: number; who: 'case'; case: FounderCase }
  | { key: number; who: 'card'; notice: MoveNotice }
  | { key: number; who: 'me'; text: string; turnId: string; state: 'sent' | 'waiting' | 'failed' };

export type LearnChat = { learnId: string | null; items: LearnItem[]; nextKey: number };

export const newLearnChat = (): LearnChat => ({ learnId: null, items: [], nextKey: 1 });

/** Adds Axiom's answer: a thin reply becomes one plain line, a real one becomes a turn, and the move card follows it. */
export function applyLearnReply(chat: LearnChat, reply: LearnReply): LearnItem[] {
  chat.learnId = reply.learn_id;
  const added: LearnItem[] = [];
  if (reply.status === 'say_more' && reply.reply) added.push({ key: chat.nextKey++, who: 'say', text: reply.reply });
  if (reply.turn) added.push({ key: chat.nextKey++, who: 'ax', turn: reply.turn });
  if (reply.founder_case) added.push({ key: chat.nextKey++, who: 'case', case: reply.founder_case });
  if (reply.founder_lessons) added.push({ key: chat.nextKey++, who: 'say', text: reply.founder_lessons.notice.text });
  if (reply.move_notice) added.push({ key: chat.nextKey++, who: 'card', notice: reply.move_notice });
  return [...chat.items, ...added];
}

/** The newest Axiom turn that offers suggestions: the only one whose suggestions are shown. */
export function suggestionTurn(items: LearnItem[]): LearnTurn | null {
  for (let n = items.length - 1; n >= 0; n -= 1) {
    const i = items[n];
    if (i.who === 'ax' && i.turn.kind !== 'followup' && i.turn.follow_ups.length > 0) return i.turn;
  }
  return null;
}

/** The suggestions under a turn that already have an answer in the chat. */
export function tappedIndexes(items: LearnItem[], turnId: string): number[] {
  return items.flatMap((i) => (i.who === 'ax' && i.turn.for_turn_id === turnId && i.turn.followup_index !== undefined ? [i.turn.followup_index] : []));
}

/** The line under a lesson: each author and book once, "Chris Voss · Never Split the Difference". */
export function sourceLines(sources: LearnSource[]): string[] {
  return [...new Set(sources.map((s) => `${s.author} · ${s.book}`))];
}

/** A lesson's text as paragraphs. */
export const lessonParagraphs = (text: string): string[] => text.split(/\n+/).map((p) => p.trim()).filter(Boolean);
