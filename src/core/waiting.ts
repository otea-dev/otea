import type { PendingEntry } from './pending.ts';

// What waits for the person, defined once. The server (`otea pending`, the projects overview, the
// notifier) and every screen (the rail, the tab bar, the title, Te toca, the desktop tray) read these
// two rules and no others, so a number on one surface can never differ from the same number on
// another (docs/internal/shown-facts.md).

type LeaseFacts = { holder: string; expiresAt: string };

// What an item says about itself that the rules need, as /api/items serves it.
export type WaitFacts = {
  turn: 'human' | 'agent' | 'none';
  lease?: LeaseFacts | null | undefined;
  // A lease that ran out with nobody releasing it; `connected`: its holder is still there.
  expiredLease?: (LeaseFacts & { connected?: true | boolean | undefined }) | null | undefined;
};

// An agent's lease ran out with nobody releasing it and nobody took the item again: the work is
// stuck. A lapsed lease of an agent that is still connected is no stuck item: it went back to the
// queue (field study 5, V2).
export function isStuck<T extends WaitFacts>(
  item: T,
  now: number,
): item is T & { expiredLease: NonNullable<T['expiredLease']> } {
  if (item.turn !== 'agent' || !item.expiredLease || item.expiredLease.connected) return false;
  return !(item.lease && Date.parse(item.lease.expiresAt) > now);
}

// An item is the person's to act on: it is on their turn, or it is stuck.
export function waitsForPerson(item: WaitFacts, now: number): boolean {
  return item.turn === 'human' || isStuck(item, now);
}

// A question of the secretary's about an item that waits for the person on its own (a card offering
// to send it back, a reminder) is that same thing, not another one: it is listed with the item and
// counted once (s-real2, D-3c918d). `waiting`: the refs of the items that wait for the person.
export function isCovered(
  entry: Pick<PendingEntry, 'kind' | 'about'>,
  waiting: ReadonlySet<string>,
): boolean {
  return entry.kind === 'secretary' && entry.about !== undefined && waiting.has(entry.about);
}

// The entries that are no item and not already an item's own: what the person counts beside their
// items (Te toca's number, the rail, the tab's title).
export function countedOff<T extends Pick<PendingEntry, 'kind' | 'about'>>(
  off: readonly T[],
  waiting: ReadonlySet<string>,
): T[] {
  return off.filter((entry) => !isCovered(entry, waiting));
}
