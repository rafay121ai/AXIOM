import type { AxiomApi, DrawerSituation, DueReport, Home, HomeItem, Target } from '../api/types';
import { copy } from '../copy';

// The rules of the home screen that are not drawing: which rows the menu lists, and where a tap leads.

/** One line in the menu. `dot` marks something still to do; `small` is the quiet text under it. */
export type MenuRow = { key: string; label: string; dot: boolean; target?: Target; situationId?: string };

export type MenuRows = { open: MenuRow[]; history: MenuRow[]; paused: MenuRow[] };

/**
 * What the menu lists. "What's open" is everything still to do, then any other open situation by its title.
 * History is the most recent few. Paused situations bring up their page, where they can be brought back.
 */
export function menuRows({ to_do, open, paused, recent }: Home['drawer']): MenuRows {
  const covered = new Set(to_do.map((i: HomeItem) => i.target.situation_id));
  const title = (t: string | null) => t ?? copy.home.untitled;
  const situation = (s: DrawerSituation): MenuRow => ({
    key: s.id,
    label: title(s.title),
    dot: true,
    ...(s.stage ? { target: { stage: s.stage, situation_id: s.id } } : { situationId: s.id }),
  });
  return {
    open: [
      ...to_do.map((i, n): MenuRow => ({ key: `${i.kind}-${n}`, label: i.label, dot: true, target: i.target })),
      ...open.filter((s) => !covered.has(s.id)).map(situation),
    ],
    history: recent.map((r) => ({ key: r.id, label: title(r.title), dot: false, situationId: r.id })),
    paused: paused.map((s) => ({ key: s.id, label: title(s.title), dot: false, situationId: s.id })),
  };
}

export type MoveSource = { learnId: string } | { moveId: string };

/** Where a tap on an item, a menu row or a history action leads. */
export type Destination =
  | { kind: 'situation' | 'read' | 'learn'; situationId: string }
  | { kind: 'move'; source: MoveSource }
  | { kind: 'report'; report: DueReport; next: DueReport[] }
  | { kind: 'home' };

/**
 * Turns the server's target into a screen. A move shown without its id (a history page) is found through its
 * lesson, which the server returns unchanged when asked again. A check-in shown without its id is the one
 * waiting, if only one is.
 */
export async function destinationOf(api: Pick<AxiomApi, 'getDueReports' | 'startLearn'>, t: Target): Promise<Destination> {
  switch (t.stage) {
    case 'situation':
    case 'read':
    case 'learn':
      return { kind: t.stage, situationId: t.situation_id };
    case 'move':
      return { kind: 'move', source: t.move_id ? { moveId: t.move_id } : { learnId: (await api.startLearn(t.situation_id)).learn_id } };
    case 'report': {
      const due = (await api.getDueReports()).filter((r) => r.due);
      const found = t.move_id ? due.find((r) => r.move_id === t.move_id) : due.length === 1 ? due[0] : undefined;
      return found ? { kind: 'report', report: found, next: due.filter((r) => r !== found) } : { kind: 'home' };
    }
  }
}
