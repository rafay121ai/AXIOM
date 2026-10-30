import { newTurnId } from '../api/delivery';
import type { Screened, SituationReply, SituationTurn } from '../api/types';

// The conversation on the Situation screen. It lives outside the screen so it survives a trip to
// the care screen and back, and so the rules of a turn can be tested without drawing anything.

export type ChatItem =
  | { id: number; who: 'ax'; text: string }
  | { id: number; who: 'me'; text: string; turnId: string; state: 'sent' | 'waiting' | 'failed' };

/** `pending` is a text the founder typed on the home screen: the screen sends it as its first message, once. */
export type Chat = { situationId: string | null; items: ChatItem[]; nextId: number; pending: string | null };

/** A new conversation, or one picked up again (`situationId`), optionally starting with what was typed at home. */
export const newChat = ({ situationId = null, pending = null }: { situationId?: string | null; pending?: string | null } = {}): Chat =>
  ({ situationId, items: [], nextId: 1, pending });

/** A situation picked up again: the lines said so far, Axiom's and the founder's, in order. */
export function chatFromTurns(situationId: string, turns: SituationTurn[]): Chat {
  const chat = newChat({ situationId });
  chat.items = turns.map((t): ChatItem =>
    t.role === 'axiom'
      ? { id: chat.nextId++, who: 'ax', text: t.text }
      : { id: chat.nextId++, who: 'me', text: t.text, turnId: newTurnId(), state: 'sent' });
  return chat;
}

/** Sends one founder text: the first starts a situation, later ones continue it. */
export type SendTurn = (situationId: string | null, text: string, turnId: string) => Promise<Screened<SituationReply>>;

/** A pause after "ready" so the screen does not jump; Axiom says nothing in between. */
export const HAND_OFF_MS = 1200;

/**
 * Applies Axiom's reply to the chat and returns the new items, with the founder's text now marked sent.
 * A new topic starts a fresh conversation holding only that text.
 */
export function applyReply(chat: Chat, reply: SituationReply, sent: ChatItem): ChatItem[] {
  chat.situationId = reply.situation_id;
  const base = reply.started_new ? [sent] : chat.items.map((i) => (i.id === sent.id ? sent : i));
  if (reply.reply === null) return base;
  return [...base, { id: chat.nextId++, who: 'ax', text: reply.reply }];
}
