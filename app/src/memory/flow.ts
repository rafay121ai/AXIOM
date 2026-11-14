import type { MemoryGroup, MemoryItem, MemoryReason } from '../api/types';
import { copy } from '../copy';

/** The sections in the order the founder sees them (tasks/design/memory.md). */
export const GROUP_ORDER: MemoryGroup[] = ['decide', 'work', 'business', 'people', 'open'];

export type MemorySection = { group: MemoryGroup; label: string; items: MemoryItem[] };

const at = (i: MemoryItem) => (i.receipt ? Date.parse(i.receipt.at) : -Infinity);

/** Sections in order, newest receipt first inside each, a section with no lines left out. Lines with no receipt come last. */
export function sectionsOf(items: MemoryItem[]): MemorySection[] {
  return GROUP_ORDER.map((group) => ({
    group,
    label: copy.memory.sections[group],
    items: items.filter((i) => i.group === group).sort((a, b) => at(b) - at(a)),
  })).filter((s) => s.items.length > 0);
}

/** The lines in the order they are shown, top to bottom. */
export const shownOrder = (items: MemoryItem[]): MemoryItem[] => sectionsOf(items).flatMap((s) => s.items);

/** The summary sentence split around the number, so the number can count. */
export function summaryParts(n: number): [string, string] {
  const [before, after] = (n === 1 ? copy.memory.summaryOne : copy.memory.summaryMany).split('{n}');
  return [before, after];
}

export const summaryText = (n: number): string => summaryParts(n).join(String(n));

/** "3 Nov", and "3 Nov 2025" when the year is not this one. */
export function receiptDate(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', ...(d.getFullYear() !== now.getFullYear() && { year: 'numeric' }) });
}

/** Where focus goes after a removal: the next line, else the previous, else nothing (the back arrow). */
export function focusAfter(items: MemoryItem[], removedId: string): string | null {
  const order = shownOrder(items);
  const i = order.findIndex((x) => x.id === removedId);
  return (order[i + 1] ?? order[i - 1])?.id ?? null;
}

export type Removal = { items: MemoryItem[]; failure?: unknown };

/** Sends the removal first. If it fails the list is returned as it was, so the line stays and nothing is lost silently. */
export async function removeLine(
  items: MemoryItem[], id: string, reason: MemoryReason, send: (item: MemoryItem, reason: MemoryReason) => Promise<void>,
): Promise<Removal> {
  const line = items.find((i) => i.id === id);
  if (!line) return { items };
  try {
    await send(line, reason);
  } catch (failure) {
    return { items, failure };
  }
  return { items: items.filter((i) => i.id !== id) };
}
