import { isClosed, positionOf } from '../core/board/engine.ts';
import { DONE } from '../core/board/model.ts';
import { messageSnippet } from '../core/conversation.ts';
import { activeLease } from '../core/lease.ts';
import {
  type BoardQueue,
  type Pending,
  type PendingDone,
  type PendingEnded,
  type PendingEntry,
  type PendingKind,
  pendingCounts,
  type QueueBlock,
} from '../core/pending.ts';
import { quoteAgent } from '../core/quote.ts';
import { timeText } from '../core/time.ts';
import { selectOpenQuestions } from '../store/conversation.ts';
import { selectEvents, selectStateEntries } from '../store/queries.ts';
import { selectOpenEscalations } from '../store/secretary.ts';
import { listBandeja } from './bandeja.ts';
import { workerLimitOf, workersByBoard } from './board-workers.ts';
import type { Context } from './context.ts';
import { escalationShown, parseEscalation } from './escalate.ts';
import { type Clock, type Item, listItems, systemClock, workflowOf } from './items.ts';
import { landWaitOf, liveBoardOf, liveBoards } from './next.ts';
import { scanned } from './overlap.ts';
import { listAgents, sessionEnded } from './presence.ts';
import { secretaryStatus } from './secretary.ts';
import { secretaryWaiting } from './secretary-waiting.ts';
import { stepFactsOf } from './step-facts.ts';

// What waits for the person, read from the records as they stand now (F4): the items on their turn
// (a question to answer, a review, a step of their own), the ones an agent left stuck, the
// questions a refiner asked on a Bandeja note and the ones the secretary asked in Hablar, and which
// review holds the rest of a board's queue. The desk (Te toca, Hablar's «Te espera») and the
// secretary (`otea pending`) read this one answer, so neither depends on what anyone remembers.

// How the person should look at them: what holds an agent up first, then what they decide.
const ORDER: readonly PendingKind[] = [
  'question',
  'bandeja',
  'secretary',
  'escalation',
  'stuck',
  'worker',
  'review',
  'step',
];

// How long a board's work may wait with nobody on it before it is the person's to open a worker: the
// secretary launches one within moments when it can.
export const OPEN_WORKER_AFTER_MS = 3 * 60_000;

// The step of a board the person does themselves is theirs to do; a preset item they created and
// that has not moved is the same. Every other item on their turn is a review.
function kindOfTurn(ctx: Context, item: Item): 'step' | 'review' {
  const board = liveBoardOf(ctx, item.collection);
  if (board) {
    const at = positionOf(item.state);
    return 'phase' in at && at.phase === 'doing' ? 'step' : 'review';
  }
  return item.createdBy.kind === 'human' && item.state === workflowOf(ctx, item).initial
    ? 'step'
    : 'review';
}

// Whether the secretary is away: none declared, or offline. What an agent escalated is the person's
// to read only then; with the secretary at work it relays it itself.
function secretaryAway(ctx: Context, now: Clock): boolean {
  const state = secretaryStatus(ctx.db, now)?.state;
  return state === undefined || state === 'offline';
}

// What waits for the person that no list of items holds: a refiner's question on a note, the
// secretary's own questions, and what agents escalated while the secretary is away. Cheap: the
// project's overview of every project reads it (server/projects.ts).
export function offItemOf(ctx: Context, now: Clock = systemClock): PendingEntry[] {
  const at = now();
  const out: PendingEntry[] = [];
  const notes = listBandeja(ctx, {}, () => at);
  for (const entry of notes) {
    const { asking } = entry;
    if (!asking) continue;
    out.push({
      kind: 'bandeja',
      ref: entry.ref,
      title: messageSnippet(entry.text),
      since: asking.at,
      by: asking.by,
      text: asking.text,
      ...(asking.options === undefined ? {} : { options: asking.options }),
      ...(asking.recommended === undefined ? {} : { recommended: asking.recommended }),
    });
  }
  for (const message of selectOpenQuestions(ctx.db)) {
    out.push({
      kind: 'secretary',
      ref: String(message.id),
      title: messageSnippet(message.text),
      since: message.at,
      by: message.by,
      text: message.text,
      options: message.options,
      ...(message.recommended === null ? {} : { recommended: message.recommended }),
      turn: message.root,
    });
  }
  // What agents escalated: the person's own while the secretary is away, and once it was delivered
  // twice or waited a while unacted, even with the secretary connected (never lost to a wait whose
  // output nobody read).
  const away = secretaryAway(ctx, now);
  const nowMs = Date.parse(at);
  const escalated = selectOpenEscalations(ctx.db).filter((kept) =>
    escalationShown(kept, away, nowMs),
  );
  if (escalated.length > 0) {
    const titles = new Map(listItems(ctx, {}, now).map((item) => [item.id, item.title]));
    for (const entry of notes) titles.set(entry.ref, messageSnippet(entry.text));
    for (const kept of escalated) {
      const { by, text } = parseEscalation(kept.text);
      const ref = kept.ref ?? '';
      out.push({
        kind: 'escalation',
        signal: kept.id,
        ref,
        title: titles.get(ref) ?? ref,
        since: kept.at,
        ...(by === '' ? {} : { by }),
        text,
      });
    }
  }
  return out;
}

function sortEntries(entries: PendingEntry[]): PendingEntry[] {
  return entries.sort(
    (a, b) =>
      ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind) || (a.since ?? '').localeCompare(b.since ?? ''),
  );
}

function entriesOf(ctx: Context, items: readonly Item[], now: Clock): PendingEntry[] {
  const entered = selectStateEntries(ctx.db);
  const out: PendingEntry[] = [];
  for (const item of items) {
    const since = entered.get(item.id) ?? item.createdAt;
    if (item.turn === 'human') {
      const { asks } = item;
      if (asks) {
        out.push({
          kind: 'question',
          ref: item.id,
          title: item.title,
          since: asks.at,
          by: asks.by,
          text: asks.text,
          ...(asks.options === undefined ? {} : { options: asks.options }),
          ...(asks.recommended === undefined ? {} : { recommended: asks.recommended }),
        });
      } else {
        out.push({ kind: kindOfTurn(ctx, item), ref: item.id, title: item.title, since });
      }
    } else if (
      item.turn === 'agent' &&
      item.expiredLease &&
      !item.expiredLease.connected &&
      !item.lease
    ) {
      out.push({
        kind: 'stuck',
        ref: item.id,
        title: item.title,
        since: item.expiredLease.expiresAt,
        by: item.expiredLease.holder,
      });
    }
  }
  return sortEntries([...out, ...offItemOf(ctx, now)]);
}

// The items that wait behind one the person has not settled: a board that works straight on its
// base (or lands in it) takes one change at a time, so one in review holds the others up, and
// nothing in the lists says why they do not start.
// Working out which item an item waits for asks git about each branch, so the answer is kept for
// BLOCKS_KEPT_MS and across calls while what it depends on is as it was: the items that wait, the
// ones that hold them up, and their states (a change of any is a new key). Branch tips move without
// that, so the answer is never kept long.
const BLOCKS_KEPT_MS = 20_000;
const kept = new WeakMap<object, { key: string; at: number; behind: [string, string[]][] }>();

export type PendingOptions = {
  // Without the queue blocks (the cheap count the secretary's wait and reading end with).
  blocks?: boolean;
  // Which item an item waits for (tests count the questions asked of git).
  landWait?: typeof landWaitOf;
};

function blocksOf(
  ctx: Context,
  items: readonly Item[],
  entries: readonly PendingEntry[],
  now: Clock,
  landWait: typeof landWaitOf,
): QueueBlock[] {
  const theirs = new Map(
    entries
      .filter(({ kind }) => kind === 'review' || kind === 'question')
      .map((entry) => [entry.ref, entry]),
  );
  if (theirs.size === 0) return [];
  const queued = items.filter((item) => item.turn === 'agent' && !item.lease);
  const key = JSON.stringify([
    [...theirs.keys()].sort(),
    queued.map(({ id, state, collection }) => [id, state, collection]),
  ]);
  const at = now();
  const last = kept.get(ctx.db);
  let found =
    last && last.key === key && Date.parse(at) - last.at < BLOCKS_KEPT_MS ? last : undefined;
  if (!found) {
    const scan = scanned(ctx);
    const behind = new Map<string, string[]>();
    for (const item of queued) {
      const first = landWait(scan, item, at)?.first;
      if (first === undefined || !theirs.has(first)) continue;
      behind.set(first, [...(behind.get(first) ?? []), item.id]);
    }
    found = { key, at: Date.parse(at), behind: [...behind] };
    kept.set(ctx.db, found);
  }
  return found.behind.flatMap(([first, waiting]) => {
    const entry = theirs.get(first);
    return entry === undefined
      ? []
      : [
          {
            first,
            title: entry.title,
            waitsFor: entry.kind === 'question' ? ('answer' as const) : ('review' as const),
            since: entry.since,
            waiting,
          },
        ];
  });
}

// Each board with items that wait for an agent nobody holds: who works it and how many it takes, so
// the secretary launches a second worker by itself when two wait and the board has room.
function queuesOf(ctx: Context, items: readonly Item[], now: Clock): BoardQueue[] {
  const at = now();
  const waiting = items.filter(
    ({ turn, lease, state, collection }) =>
      turn === 'agent' &&
      activeLease(lease, at) === null &&
      isDoing(state) &&
      liveBoardOf(ctx, collection) !== undefined,
  );
  if (waiting.length === 0) return [];
  const workers = workersByBoard(ctx.db, items, listAgents(ctx.db, now), at);
  return liveBoards(ctx).flatMap(({ collection, def }) => {
    const mine = waiting.filter((item) => item.collection === collection);
    const ids = mine.map(({ id }) => id);
    if (ids.length === 0) return [];
    // Approved is not landed, and a bounce says why (src/app/step-facts.ts).
    const facts = mine.map((item) => ({
      id: item.id,
      ...stepFactsOf(def, item, selectEvents(ctx.db, item.id)),
    }));
    const landing = facts.filter(({ landing: yes }) => yes).map(({ id }) => id);
    const bounced = facts.flatMap(({ id, bounced: back }) =>
      back ? [{ id, reason: back.reason }] : [],
    );
    return [
      {
        board: collection,
        waiting: ids,
        workers: (workers.get(collection) ?? []).map(({ name }) => name),
        limit: workerLimitOf(def),
        ...(landing.length === 0 ? {} : { landing }),
        ...(bounced.length === 0 ? {} : { bounced }),
      },
    ];
  });
}

const isDoing = (state: string): boolean => {
  const at = positionOf(state);
  return !isClosed(at) && at.phase === 'doing';
};

// A board whose work has waited for an agent for a while with nobody working it: the person opens a
// session for it (U3, field study 4: the secretary had no way to launch one, and nothing said they
// had to).
function workerEntries(
  ctx: Context,
  queues: readonly BoardQueue[],
  items: readonly Item[],
  now: Clock,
): PendingEntry[] {
  const at = Date.parse(now());
  const entered = selectStateEntries(ctx.db);
  const sinceOf = new Map(items.map((item) => [item.id, entered.get(item.id) ?? item.createdAt]));
  return queues.flatMap((queue) => {
    if (queue.workers.length > 0) return [];
    const since = queue.waiting
      .map((id) => sinceOf.get(id))
      .filter((time): time is string => time !== undefined)
      .sort()[0];
    if (since === undefined || at - Date.parse(since) < OPEN_WORKER_AFTER_MS) return [];
    return [
      {
        kind: 'worker' as const,
        items: [...queue.waiting],
        ref: queue.board,
        title: queue.board,
        since,
        text: `${queue.waiting.length} ${queue.waiting.length === 1 ? 'item waits' : 'items wait'} (${queue.waiting.join(', ')}) and nobody works this board: open a session and paste the worker text (otea prompt --role worker --board ${queue.board})`,
      },
    ];
  });
}

// How far back «what got done» looks.
const DONE_FOR_MS = 24 * 60 * 60_000;

function doneOf(ctx: Context, items: readonly Item[], now: Clock): PendingDone[] {
  const since = Date.parse(now()) - DONE_FOR_MS;
  const entered = selectStateEntries(ctx.db);
  return items
    .flatMap((item) => {
      const position = positionOf(item.state);
      const at = entered.get(item.id) ?? item.createdAt;
      return isClosed(position) && position.closed === DONE && Date.parse(at) >= since
        ? [{ id: item.id, title: item.title, at }]
        : [];
    })
    .sort((a, b) => a.at.localeCompare(b.at));
}

// The items an agent holds while its session is over: nobody works them, whatever the lease says.
function endedOf(ctx: Context, items: readonly Item[], now: Clock): PendingEnded[] {
  const at = now();
  return items.flatMap((item) =>
    item.turn === 'agent' && item.lease && sessionEnded(ctx.db, item.lease.holder, () => at)
      ? [{ id: item.id, title: item.title, holder: item.lease.holder }]
      : [],
  );
}

export function pendingOf(
  ctx: Context,
  now: Clock = systemClock,
  options: PendingOptions = {},
): Pending {
  const items = listItems(ctx, {}, now);
  const queues = queuesOf(ctx, items, now);
  const entries = sortEntries([
    ...entriesOf(ctx, items, now),
    ...workerEntries(ctx, queues, items, now),
  ]);
  const status = secretaryStatus(ctx.db, now);
  const ended = options.blocks === false ? [] : endedOf(ctx, items, now);
  return {
    count: entries.length,
    entries,
    blocks:
      options.blocks === false
        ? []
        : blocksOf(ctx, items, entries, now, options.landWait ?? landWaitOf),
    queues: options.blocks === false ? [] : queues,
    ...(options.blocks === false ? {} : { done: doneOf(ctx, items, now) }),
    ...(ended.length === 0 ? {} : { ended }),
    secretary: status
      ? {
          name: status.name,
          state: status.state,
          since: status.since,
          waiting: secretaryWaiting(ctx.db),
        }
      : null,
  };
}

// The line at the foot of the secretary's wait and reading: how many wait for the person, and the
// command that says which. Empty while nothing waits.
export function pendingLine(pending: Pending, agent?: string): string {
  const { count } = pending;
  if (count === 0) return '';
  const as = agent === undefined ? '' : ` --as ${agent}`;
  return `${count} ${count === 1 ? 'thing waits' : 'things wait'} for the person (otea pending${as} lists them): tell them what is new, never from memory.`;
}

const ago = (since: string | null): string => (since === null ? '' : ` (since ${timeText(since)})`);

function lineOf(entry: PendingEntry): string {
  // Titles, questions and escalations were written by agents: quoted as data, on one line.
  const quoted = (text: string) => quoteAgent(text, 160);
  const options =
    entry.options === undefined || entry.options.length === 0
      ? ''
      : ` Options: ${entry.options.map((each, i) => `${i + 1}) ${each}${entry.recommended === i + 1 ? ' (recommended)' : ''}`).join(' · ')}`;
  switch (entry.kind) {
    case 'question':
      return `${entry.ref} ${quoted(entry.title)}: ${entry.by ?? 'an agent'} asks ${quoted(entry.text ?? '')}${options}${ago(entry.since)}`;
    case 'bandeja':
      return `${entry.ref} (note ${quoted(entry.title)}): ${entry.by ?? 'a refiner'} asks ${quoted(entry.text ?? '')}${options}${ago(entry.since)}`;
    case 'secretary':
      return `your question in message ${entry.ref} ${quoted(entry.text ?? entry.title)}${options}${ago(entry.since)}`;
    case 'escalation':
      return `${entry.ref} ${quoted(entry.title)}: ${entry.by ?? 'an agent'} says ${quoted(entry.text ?? '')}${ago(entry.since)}`;
    case 'stuck':
      return `${entry.ref} ${quoted(entry.title)}: ${entry.by ?? 'its agent'} went quiet${ago(entry.since)}`;
    case 'worker':
      return `board ${quoted(entry.title)}: ${entry.text ?? 'nobody works it'}${ago(entry.since)}. If you cannot launch a worker yourself, give them the worker text as a numbered block (rule 8).`;
    case 'review':
      return `${entry.ref} ${quoted(entry.title)} waits for their review${ago(entry.since)}`;
    case 'step':
      return `${entry.ref} ${quoted(entry.title)} is a step of their own${ago(entry.since)}`;
  }
}

// A board's queue for a worker, and what the secretary does about it: nobody works it, launch one;
// one works it, two items wait and the board takes another, launch the second without asking.
function queueLine({ board, waiting, workers, limit, landing, bounced }: BoardQueue): string {
  const who = workers.length === 0 ? 'no worker' : `worked by ${workers.join(', ')}`;
  // Approved is not done: say which wait to land, and which came back after approval and why, in
  // plain words, so the person is never told they are done or lost.
  const notes = [
    ...(landing ?? []).map(
      (id) =>
        ` ${id} approved, waiting to land (an agent merges it into main; it is not done yet).`,
    ),
    ...(bounced ?? []).map(
      ({ id, reason }) =>
        ` ${id} came back after approval: it conflicted with a change that landed first${reason ? ` (${quoteAgent(reason)})` : ''}, so an agent merges main into it and it goes through review again.`,
    ),
  ].join('');
  const head = `${board}: ${waiting.length} waiting for an agent (${waiting.join(', ')}), ${who}; the board takes ${limit === 1 ? 'one worker' : `${limit} workers`}.${notes}`;
  if (workers.length === 0)
    return `${head} Launch its worker: otea prompt --role worker --board ${board}.`;
  if (workers.length < limit && waiting.length >= 2)
    return `${head} Launch a second worker on your own, no need to ask: otea prompt --role worker --board ${board} (its own name).`;
  return head;
}

const GROUPS: readonly { kinds: readonly PendingKind[]; head: string }[] = [
  { kinds: ['question', 'bandeja', 'secretary'], head: 'Questions' },
  { kinds: ['escalation'], head: 'Escalated by agents' },
  { kinds: ['stuck'], head: 'Stuck' },
  { kinds: ['worker'], head: 'Boards with nobody on them' },
  { kinds: ['review'], head: 'Reviews' },
  { kinds: ['step'], head: 'Their own steps' },
];

// What closed as Done in the last day, counted by Otea: the secretary answers «what got done?» from
// this list, whole, never from memory (field study 4, U6: it said none, then 11 of 12).
function doneLine(done: readonly PendingDone[]): string[] {
  if (done.length === 0) return [];
  const list = done.map(({ id, title, at }) => `${id} ${quoteAgent(title, 80)} (${timeText(at)})`);
  return [
    `Done in the last 24 hours (${done.length}): ${list.join('; ')}. This is the whole list, counted now: when the person asks what got done, answer from it, say the count it gives, and name items from it only.`,
  ];
}

// The items nobody works though an agent holds them: said apart from what waits for the person, so
// the secretary never reports a worker on an item whose session is over.
function endedLines(ended: readonly PendingEnded[]): string[] {
  if (ended.length === 0) return [];
  const list = ended.map(
    ({ id, title, holder }) => `${id} ${quoteAgent(title, 80)} (${holder}'s session ended)`,
  );
  return [
    `Held by an agent whose session ended, so nobody is working on it now: ${list.join('; ')}. Do not tell the person someone is working on these: read each one (otea show <id>), and launch another worker if its board needs one.`,
  ];
}

// What `otea pending` prints, for the secretary: the count, each thing with what it waits for and
// since when, what holds a board's queue, and what to do with it.
export function pendingText(pending: Pending): string {
  const { count, entries, blocks, queues } = pending;
  const loads = queues.map(queueLine);
  const finished = [...endedLines(pending.ended ?? []), ...doneLine(pending.done ?? [])];
  if (count === 0) {
    return [
      'Nothing waits for the person: no review, question or step of their own. Do not say otherwise from memory.',
      ...loads,
      ...finished,
    ].join('\n');
  }
  const counts = pendingCounts(entries);
  const sum = [
    ...GROUPS.map(
      ({ kinds, head }) => [head, kinds.reduce((n, kind) => n + counts[kind], 0)] as const,
    ),
  ]
    .filter(([, n]) => n > 0)
    .map(([head, n]) => `${head.toLowerCase()} ${n}`)
    .join(', ');
  const sections = GROUPS.flatMap(({ kinds, head }) => {
    const mine = entries.filter(({ kind }) => kinds.includes(kind));
    return mine.length === 0 ? [] : [`${head}:`, ...mine.map((entry) => `  ${lineOf(entry)}`)];
  });
  const holds = blocks.map(
    ({ first, waitsFor, waiting }) =>
      `${first} holds the queue: it waits for their ${waitsFor}, and ${waiting.join(', ')} ${waiting.length === 1 ? 'waits' : 'wait'} behind it (the board takes one change at a time). Tell them.`,
  );
  return [
    `${count} ${count === 1 ? 'thing waits' : 'things wait'} for the person (${sum}).`,
    ...sections,
    ...holds,
    ...loads,
    ...finished,
    'This is the whole list, computed now: say it as it is, never add or drop one from memory. News they have not read goes as a notice (otea say "<text>" --links <ids>, no --reply-to).',
  ].join('\n');
}
