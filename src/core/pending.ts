import type { SecretaryState } from './secretary.ts';

// What waits for the person, computed by Otea from the records themselves (F4, field study 3): the
// desk's Te toca and Hablar's «Te espera» strip show it, and the secretary reads it with `otea
// pending` instead of remembering what it told. Every kind is a thing only the person can settle:
//   question   an agent asks them on an item (otea ask)
//   bandeja    a refiner asks them what a Bandeja note lacks (otea ask B-3)
//   secretary  the secretary asks them something with options to tap (otea say --option)
//   review     an item reached their review (or a step they decide)
//   step       a step of their own on a board: theirs to do
//   stuck      an agent's lease ran out and nobody took the item again
//   escalation an agent told the secretary something the person must know (otea escalate) and the
//              secretary is away: the person reads it themselves
export const PENDING_KINDS = [
  'question',
  'bandeja',
  'secretary',
  'escalation',
  'review',
  'step',
  'stuck',
] as const;

export type PendingKind = (typeof PENDING_KINDS)[number];

export type PendingEntry = {
  kind: PendingKind;
  // The item (CAM-4), the Bandeja note (B-2) or the secretary's message (its number).
  ref: string;
  // The item's title, or the first line of the note or the question.
  title: string;
  // Since when it waits for them.
  since: string | null;
  // Who asks or handed it over.
  by?: string;
  // The question, with the options to tap and the one recommended.
  text?: string;
  options?: string[];
  recommended?: number;
  // A secretary question: the turn of Hablar it sits in.
  turn?: number;
};

// A review that holds the rest of a board's queue: the board works straight on its base (or lands in
// one), so what comes after waits until the person has settled `first`.
export type QueueBlock = {
  first: string;
  title: string;
  // What `first` waits for from them: their review, or their answer.
  waitsFor: 'review' | 'answer';
  since: string | null;
  // The items that wait behind it.
  waiting: string[];
};

export type PendingSecretary = {
  name: string;
  state: SecretaryState;
  // When it was last heard, while offline.
  since: string | null;
  // What waits for it unattended: the person's messages not read and the notes nobody took.
  waiting: { count: number; since: string | null };
};

export type Pending = {
  // How many things wait for the person.
  count: number;
  // In the order the person should look at them: what holds an agent up (questions) first, then
  // what they decide, oldest first.
  entries: PendingEntry[];
  blocks: QueueBlock[];
  // The project's secretary, undefined (null) while it has none.
  secretary: PendingSecretary | null;
};

// The per-kind count, for lines and badges.
export function pendingCounts(entries: readonly PendingEntry[]): Record<PendingKind, number> {
  const counts = Object.fromEntries(PENDING_KINDS.map((kind) => [kind, 0])) as Record<
    PendingKind,
    number
  >;
  for (const { kind } of entries) counts[kind]++;
  return counts;
}

// What waits for them that is no item: the Bandeja's and the secretary's questions. The desk adds
// them to the items on its own turn (Te toca's number).
export const OFF_ITEM: readonly PendingKind[] = ['bandeja', 'secretary', 'escalation'];

export function offItem(entries: readonly PendingEntry[]): PendingEntry[] {
  return entries.filter(({ kind }) => OFF_ITEM.includes(kind));
}
