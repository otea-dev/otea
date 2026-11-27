import {
  OFF_ITEM,
  type Pending,
  type PendingEntry,
  type PendingKind,
  type PendingSecretary,
  type QueueBlock,
} from '../../src/core/pending.ts';
import { hablarHash, type ViewRoute } from './selection.ts';

// What waits for the person, as Otea counts it (src/app/pending.ts, GET /api/pending): Te toca adds
// what is no item to its lists (a question on a Bandeja note, a question of the secretary), Hablar
// pins the whole of it, and the board says what holds its queue.

export type { Pending, PendingEntry, PendingKind, PendingSecretary, QueueBlock };

// What waits for the person that no list of items holds: the Bandeja's and the secretary's
// questions. Te toca shows them with the questions for you and counts them with the rest.
export function offItemEntries(pending: Pending | null | undefined): PendingEntry[] {
  return (pending?.entries ?? []).filter(({ kind }) => OFF_ITEM.includes(kind));
}

// How many of them, for the number of Your turn.
export const offItemCount = (pending: Pending | null | undefined): number =>
  offItemEntries(pending).length;

// The oldest of them, for «waiting since».
export function oldestOffItem(pending: Pending | null | undefined): string | null {
  const times = offItemEntries(pending).flatMap(({ since }) => (since === null ? [] : [since]));
  return times.sort()[0] ?? null;
}

// Where an entry that is no item is answered: the Bandeja note, or the turn of the secretary's
// question, in Hablar.
export function entryRoute(entry: PendingEntry): ViewRoute {
  if (entry.kind === 'bandeja') return { view: 'hablar', bandeja: entry.ref };
  if (entry.kind === 'secretary' && entry.turn !== undefined) {
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
  entry.kind === 'secretary'
    ? `msg:${entry.ref}`
    : entry.kind === 'escalation'
      ? `esc:${entry.ref}:${entry.signal ?? ''}`
      : entry.ref;

// The secretary shown offline with something waiting for it: Te toca says so, with a way to Hablar.
export function offlineWithWaiting(pending: Pending | null | undefined): PendingSecretary | null {
  const secretary = pending?.secretary;
  return secretary?.state === 'offline' && secretary.waiting.count > 0 ? secretary : null;
}
