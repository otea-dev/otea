import { positionOf } from '../core/board/engine.ts';
import { messageSnippet } from '../core/conversation.ts';
import {
  type Pending,
  type PendingEntry,
  type PendingKind,
  pendingCounts,
  type QueueBlock,
} from '../core/pending.ts';
import { timeText } from '../core/time.ts';
import { selectOpenQuestions } from '../store/conversation.ts';
import { selectStateEntries } from '../store/queries.ts';
import { listBandeja } from './bandeja.ts';
import type { Context } from './context.ts';
import { type Clock, type Item, listItems, systemClock, workflowOf } from './items.ts';
import { landWaitOf, liveBoardOf } from './next.ts';
import { scanned } from './overlap.ts';
import { secretaryStatus } from './secretary.ts';
import { secretaryWaiting } from './secretary-waiting.ts';

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
  'stuck',
  'review',
  'step',
];

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

function entriesOf(ctx: Context, items: readonly Item[], now: Clock): PendingEntry[] {
  const at = now();
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
    } else if (item.turn === 'agent' && item.expiredLease && !item.lease) {
      out.push({
        kind: 'stuck',
        ref: item.id,
        title: item.title,
        since: item.expiredLease.expiresAt,
        by: item.expiredLease.holder,
      });
    }
  }
  for (const entry of listBandeja(ctx, {}, () => at)) {
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
  return out.sort(
    (a, b) =>
      ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind) || (a.since ?? '').localeCompare(b.since ?? ''),
  );
}

// The items that wait behind one the person has not settled: a board that works straight on its
// base (or lands in it) takes one change at a time, so one in review holds the others up, and
// nothing in the lists says why they do not start.
function blocksOf(
  ctx: Context,
  items: readonly Item[],
  entries: readonly PendingEntry[],
  now: Clock,
): QueueBlock[] {
  const theirs = new Map(
    entries
      .filter(({ kind }) => kind === 'review' || kind === 'question')
      .map((entry) => [entry.ref, entry]),
  );
  if (theirs.size === 0) return [];
  const scan = scanned(ctx);
  const at = now();
  const behind = new Map<string, string[]>();
  for (const item of items) {
    if (item.turn !== 'agent' || item.lease) continue;
    const first = landWaitOf(scan, item, at)?.first;
    if (first === undefined || !theirs.has(first)) continue;
    behind.set(first, [...(behind.get(first) ?? []), item.id]);
  }
  return [...behind].flatMap(([first, waiting]) => {
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

export function pendingOf(ctx: Context, now: Clock = systemClock): Pending {
  const items = listItems(ctx, {}, now);
  const entries = entriesOf(ctx, items, now);
  const status = secretaryStatus(ctx.db, now);
  return {
    count: entries.length,
    entries,
    blocks: blocksOf(ctx, items, entries, now),
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
  const quoted = (text: string) => `"${messageSnippet(text, 160)}"`;
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
    case 'stuck':
      return `${entry.ref} ${quoted(entry.title)}: ${entry.by ?? 'its agent'} went quiet${ago(entry.since)}`;
    case 'review':
      return `${entry.ref} ${quoted(entry.title)} waits for their review${ago(entry.since)}`;
    case 'step':
      return `${entry.ref} ${quoted(entry.title)} is a step of their own${ago(entry.since)}`;
  }
}

const GROUPS: readonly { kinds: readonly PendingKind[]; head: string }[] = [
  { kinds: ['question', 'bandeja', 'secretary'], head: 'Questions' },
  { kinds: ['stuck'], head: 'Stuck' },
  { kinds: ['review'], head: 'Reviews' },
  { kinds: ['step'], head: 'Their own steps' },
];

// What `otea pending` prints, for the secretary: the count, each thing with what it waits for and
// since when, what holds a board's queue, and what to do with it.
export function pendingText(pending: Pending): string {
  const { count, entries, blocks } = pending;
  if (count === 0) {
    return 'Nothing waits for the person: no review, question or step of their own. Do not say otherwise from memory.';
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
    'This is the whole list, computed now: say it as it is, never add or drop one from memory. News they have not read goes as a notice (otea say "<text>" --links <ids>, no --reply-to).',
  ].join('\n');
}
