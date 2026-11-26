import type { DatabaseSync } from 'node:sqlite';
import { messageSnippet } from '../core/conversation.ts';
import { REPLY_WINDOW_MS, type SecretaryFacts } from '../core/notify/signals.ts';
import { countPending, selectRepliesSince } from '../store/conversation.ts';
import { type Clock, systemClock } from './items.ts';
import { secretaryStatus } from './secretary.ts';

// What the notifier needs to know of the secretary (notifications, 0.8): its state, what it said
// to the person lately and what has waited for it unattended.

export type Waiting = { count: number; since: string | null };

// What else waits for the secretary besides the person's messages: the Bandeja registers its
// captures not taken yet here, so an offline secretary with only captures waiting is told too.
export type WaitingSource = (db: DatabaseSync) => Waiting;

const sources: WaitingSource[] = [];

export function addWaitingSource(source: WaitingSource): () => void {
  sources.push(source);
  return () => {
    const at = sources.indexOf(source);
    if (at >= 0) sources.splice(at, 1);
  };
}

export function secretaryWaiting(db: DatabaseSync): Waiting {
  const all = [countPending(db), ...sources.map((source) => source(db))];
  const since = all
    .map((each) => each.since)
    .filter((at): at is string => at !== null)
    .sort()[0];
  return { count: all.reduce((n, each) => n + each.count, 0), since: since ?? null };
}

// Undefined while the project has no secretary.
export function secretaryFacts(
  db: DatabaseSync,
  now: Clock = systemClock,
): SecretaryFacts | undefined {
  const status = secretaryStatus(db, now);
  if (!status) return undefined;
  const from = new Date(Date.parse(now()) - REPLY_WINDOW_MS).toISOString();
  return {
    name: status.name,
    state: status.state,
    since: status.since,
    replies: selectRepliesSince(db, from).map(({ id, root, by, text }) => ({
      id,
      turn: root,
      by,
      text: messageSnippet(text, 140),
    })),
    waiting: secretaryWaiting(db),
  };
}
