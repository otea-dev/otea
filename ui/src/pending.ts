import {
  counted,
  OFF_ITEM,
  type Pending,
  type PendingAssistant,
  type PendingEntry,
  type PendingKind,
  type QueueBlock,
} from '../../src/core/pending.ts';
import { countedOff, waitsForPerson } from '../../src/core/waiting.ts';
import type { AssistantView } from './conversation.ts';
import { hablarHash, type ViewRoute } from './selection.ts';
import type { Item } from './types.ts';

// What waits for the person, as Otea counts it (src/app/pending.ts, GET /api/pending): Te toca adds
// what is no item to its lists (a question on a Bandeja note, a question of the assistant), Hablar
// pins the whole of it, and the board says what holds its queue.

export type { Pending, PendingAssistant, PendingEntry, PendingKind, QueueBlock };
export { counted };

// What the screens read to count: the items as the desk holds them live, the time, and what Otea
// counted of what is no item (GET /api/pending).
export type WaitItem = Pick<Item, 'id' | 'turn' | 'lease'> & Partial<Pick<Item, 'expiredLease'>>;

export type Waiting = {
  all: readonly WaitItem[];
  now: number;
  pending?: Pending | null | undefined;
};

// What waits for the person that no list of items holds: the Bandeja's and the assistant's
// questions, what agents escalated, a board nobody works. Te toca shows each under its own heading
// and counts them with the rest. A question of the assistant's about an item that waits for them on
// its own is that item, not another thing: it is left out here (core/waiting.ts isCovered).
export function offItemEntries({ pending, all, now }: Waiting): PendingEntry[] {
  const off = (pending?.entries ?? []).filter(({ kind }) => OFF_ITEM.includes(kind));
  const theirs = all.filter((item) => waitsForPerson(item, now)).map(({ id }) => id);
  return countedOff(off, new Set(theirs));
}

// How many notes of the Bandeja wait for the person's answer: the number on «Lo que salió». It is
// read from the same pending the rest of the desk counts with, never from the Bandeja's own list,
// which is another read and may be a tick behind or ahead (docs/internal/shown-facts.md, fact 21).
export function bandejaAsking(pending: Pending | null | undefined): number {
  return (pending?.entries ?? []).filter(({ kind }) => kind === 'bandeja').length;
}

// How many of them, for the number of Your turn.
export const offItemCount = (waiting: Waiting): number => offItemEntries(waiting).length;

// The number of Te toca, the one number every surface shows for what waits for the person: the
// items on their turn, what got stuck, and what is no item (the rail, the tab bar, the tab's title,
// the project menu, the dek, the tray).
export function waitingCount(waiting: Waiting): number {
  return waitingTotal(waiting.all, waiting.now, offItemCount(waiting));
}

// The formula, once: the items on their turn or stuck, and what is no item.
export function waitingTotal(items: readonly WaitItem[], now: number, off: number): number {
  return items.filter((item) => waitsForPerson(item, now)).length + off;
}

// The oldest of the entries that are no item, for «waiting since».
export function oldestOffItem(waiting: Waiting): string | null {
  const times = offItemEntries(waiting).flatMap(({ since }) => (since === null ? [] : [since]));
  return times.sort()[0] ?? null;
}

// Where an entry that is no item is answered: the Bandeja note, or the turn of the assistant's
// question, in Hablar.
export function entryRoute(entry: PendingEntry): ViewRoute {
  if (entry.kind === 'bandeja') return { view: 'hablar', bandeja: entry.ref };
  if (entry.kind === 'assistant' && entry.turn !== undefined) {
    return { view: 'hablar', turn: entry.turn };
  }
  return { view: 'hablar' };
}

export function entryHash(entry: PendingEntry): string {
  const route = entryRoute(entry);
  return route.view === 'hablar' ? hablarHash(route) : hablarHash();
}

// The key of the row of Te toca that stands for an entry that is no item (a note, a message, a
// report). A report names the item it is about, which may be a row of its own: its key never is the
// item's.
export const rowKeyOf = (entry: PendingEntry): string =>
  entry.kind === 'assistant'
    ? `msg:${entry.ref}`
    : entry.kind === 'escalation'
      ? `esc:${entry.ref}:${entry.signal ?? ''}`
      : entry.kind === 'worker'
        ? `worker:${entry.ref}`
        : entry.ref;

// The assistant shown offline with something waiting for it: Te toca says so, with a way to Hablar.
export function offlineWithWaiting(
  assistant: AssistantView | null | undefined,
): AssistantView | null {
  return assistant?.state === 'offline' && assistant.waiting.count > 0 ? assistant : null;
}
