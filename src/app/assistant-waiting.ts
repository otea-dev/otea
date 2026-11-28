import type { DatabaseSync } from 'node:sqlite';
import type { AssistantView, AssistantWaiting } from '../core/assistant.ts';
import { messageSnippet } from '../core/conversation.ts';
import { type AssistantFacts, REPLY_WINDOW_MS } from '../core/notify/signals.ts';
import { selectOpenEscalations } from '../store/assistant.ts';
import { countPending, selectOpenQuestions, selectRepliesSince } from '../store/conversation.ts';
import { assistantStatus } from './assistant.ts';
import { type Clock, systemClock } from './items.ts';

// What the notifier needs to know of the assistant (notifications, 0.8): its state, what it said
// to the person lately and what has waited for it unattended.

export type Waiting = { count: number; since: string | null };

// What else waits for the assistant besides the person's messages: the Bandeja registers its
// captures not taken yet here, so an offline assistant with only captures waiting is told too.
export type WaitingSource = (db: DatabaseSync) => Waiting;

const sources: WaitingSource[] = [];

export function addWaitingSource(source: WaitingSource): () => void {
  sources.push(source);
  return () => {
    const at = sources.indexOf(source);
    if (at >= 0) sources.splice(at, 1);
  };
}

// What agents escalated and the assistant has not acted on waits for it as well: an absent
// assistant is told («te esperan N»), and the person sees the escalations themselves.
function escalated(db: DatabaseSync): Waiting {
  const open = selectOpenEscalations(db);
  return { count: open.length, since: open[0]?.at ?? null };
}

export function assistantWaiting(db: DatabaseSync): AssistantWaiting {
  const messages = countPending(db);
  const reports = escalated(db);
  const notes = sources.map((source) => source(db));
  const all = [messages, reports, ...notes];
  const since = all
    .map((each) => each.since)
    .filter((at): at is string => at !== null)
    .sort()[0];
  return {
    count: all.reduce((n, each) => n + each.count, 0),
    since: since ?? null,
    messages: messages.count,
    notes: notes.reduce((n, each) => n + each.count, 0),
    reports: reports.count,
  };
}

// The assistant as the desk, the conversation and `otea pending` show it: its status and what waits
// for it, one answer for all of them. Undefined while the project has none.
export function assistantView(
  db: DatabaseSync,
  now: Clock = systemClock,
  agents?: Parameters<typeof assistantStatus>[3],
): AssistantView | undefined {
  const status = assistantStatus(db, now, undefined, agents);
  return status ? { ...status, waiting: assistantWaiting(db) } : undefined;
}

// Undefined while the project has no assistant.
export function assistantFacts(
  db: DatabaseSync,
  now: Clock = systemClock,
): AssistantFacts | undefined {
  const status = assistantStatus(db, now);
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
    // A question with options is told as a question (an `ask`), never also as a reply
    // (selectRepliesSince leaves it out).
    questions: selectOpenQuestions(db).map(({ id, root, by, text, options }) => ({
      id,
      turn: root,
      by,
      text: messageSnippet(text, 140),
      options,
    })),
    waiting: assistantWaiting(db),
  };
}
