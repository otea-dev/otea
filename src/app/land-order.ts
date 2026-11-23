import { isClosed, isLandStep, positionOf } from '../core/board/engine.ts';
import { guardedBranch, stepById, workedBase } from '../core/board/model.ts';
import { activeLease } from '../core/lease.ts';
import { type ItemRecord, selectItems, selectStateEntries } from '../store/queries.ts';
import type { Context } from './context.ts';
import { type LiveBoard, leftFor, liveBoardOf, liveBoards } from './next.ts';
import { sessionEnded, sessionRuns } from './presence.ts';
import { type Priority, priorityOf } from './priority.ts';
import { approvedTipOf } from './tips.ts';

// One agent lands at a time on a base branch, and the next to land is the item highest in the
// person's order (P1-R3-2): approved items raced into main, the lower and unordered ones landed
// first, and the ones on top conflicted again and again, each conflict another review round. It
// holds on any board's land step (the step an agent integrates what the person approved in,
// however the board names it), across the boards that land in the same base of the same repo.
// The person still moves anything by hand: they reorder the Matrix, put an item on top, move an
// item themselves or leave it for one agent (Reasignar), which lands it when it takes it.

// Where an item stands on a land step: the base it lands in, and the key of that base in its repo
// (boards whose guard reads the repo from a field keep each repo apart). Undefined anywhere else.
// On a board that works straight on its base (Código en main), the step that does the work is on
// the same footing (`work`): every agent commits on the one checkout of main, so two at once
// change each other's files and fight over the git index (P1-F2).
function landingIn(
  board: LiveBoard,
  item: ItemRecord,
): { key: string; base: string; work: boolean } | undefined {
  const position = positionOf(item.state);
  if (isClosed(position) || position.phase !== 'doing') return undefined;
  const guard = guardedBranch(board.def);
  if (!guard) return undefined;
  const lands = isLandStep(board.def, position.step);
  const works =
    !lands &&
    workedBase(board.def) !== undefined &&
    stepById(board.def, position.step)?.hand.some(({ ref }) => ref === guard.id) === true;
  if (!lands && !works) return undefined;
  const base = guard.guard.base ?? 'the base';
  const repo = guard.guard.repo === undefined ? '' : item.fields[guard.guard.repo];
  return {
    key: `${typeof repo === 'string' ? repo.toLowerCase() : ''}\0${base}`,
    base,
    work: works,
  };
}

// An item of a board that works straight on its base that is committed there and waits for the
// person's review (or, once approved, for the push that lands it): until then its commits are on
// the base, so the next one starting would ride along in the push. It holds the base like work in
// progress does. An item that made no commit (its handoff recorded no code change) holds nothing.
function holdsBase(
  ctx: Context,
  board: LiveBoard,
  item: ItemRecord,
): { key: string; base: string } | undefined {
  const position = positionOf(item.state);
  if (isClosed(position)) return undefined;
  const guard = guardedBranch(board.def);
  if (!guard || workedBase(board.def) === undefined) return undefined;
  const branch = String(item.fields[guard.id] ?? '').trim();
  const tip = approvedTipOf(ctx, item.id, branch);
  if (tip?.unchanged) return undefined;
  // Until it is Done, in every phase: in review, being landed (with or without an agent holding
  // it), or sent back for another round after it was handed off once. A fresh item, never handed
  // off, has committed nothing yet.
  const landing = position.phase === 'doing' && isLandStep(board.def, position.step);
  const reviewed =
    position.phase !== 'doing' &&
    stepById(board.def, position.step)?.hand.some(({ ref }) => ref === guard.id) === true;
  const again = position.phase === 'doing' && tip !== undefined;
  if (!landing && !reviewed && !again) return undefined;
  const base = guard.guard.base ?? 'the base';
  const repo = guard.guard.repo === undefined ? '' : item.fields[guard.guard.repo];
  return { key: `${typeof repo === 'string' ? repo.toLowerCase() : ''}\0${base}`, base };
}

// Why an item comes first in the person's order: what they put on top, their order on the
// Matrix, else that it was approved first.
function placeText(priority: Priority | undefined, work: boolean): string {
  if (priority?.pin !== undefined) return `on top ${priority.pin}`;
  if (priority?.rank !== undefined) return `order ${priority.rank}`;
  return work ? 'asked before it' : 'approved before it';
}

// What lands before the item: `holder` lands `first` now, or `first` lands next (its `place` in
// the person's order says why). `work`: the item does its work on the base, not lands in it;
// `review`: `first` is committed on the base and waits for its review or its push.
export type LandsFirst = { first: string; base: string; work?: true } & (
  | { holder: string }
  | { place: string }
  | { review: true }
);

// What lands in the item's base before it, for the agent asking; undefined when the item is not on
// a land step, or its turn to land is now. `takeable` says whether the agent could take another
// item now, leaving this order aside: an item no agent can take (a question waits for the person)
// never holds up the ones after it.
export function landsFirst(
  ctx: Context,
  item: ItemRecord,
  agent: string,
  at: string,
  takeable: (board: LiveBoard, item: ItemRecord) => boolean,
): LandsFirst | undefined {
  const board = liveBoardOf(ctx, item.collection);
  const own = board && landingIn(board, item);
  if (!own) return undefined;
  // The person left it for this agent: their say goes.
  if (leftFor(ctx, item.id) === agent) return undefined;
  // Its landing began with this agent, whose lease may have run out meanwhile: it goes on with it.
  if (item.lease?.holder === agent) return undefined;
  // A landing never waits for someone else's work in progress on the base (it could take hours,
  // with approved work held back); work waits for landings and for other work.
  const waiting = liveBoards(ctx).flatMap((each) =>
    selectItems(ctx.db, { collection: each.collection }).flatMap((other) => {
      const there = other.id === item.id ? undefined : landingIn(each, other);
      return there?.key === own.key && (own.work || !there.work)
        ? [{ item: other, board: each }]
        : [];
    }),
  );
  // A landing under way: another item of the base an agent holds, unless that agent's session
  // ended (a claim takes its lease over then, P3C-R3-11). A lease that ran out while its holder's
  // session runs is still its holder's: it may be at work on a long step with no otea call.
  const landing = waiting.flatMap(({ item: other }) => {
    const lease = activeLease(other.lease, at);
    const holder =
      lease && !sessionEnded(ctx.db, lease.holder, () => at)
        ? lease.holder
        : !lease && other.lease && sessionRuns(ctx.db, other.lease.holder, () => at)
          ? other.lease.holder
          : undefined;
    return holder === undefined
      ? []
      : [
          {
            first: other.id,
            base: own.base,
            holder,
            ...(own.work ? { work: true as const } : {}),
          },
        ];
  });
  if (landing[0]) return landing[0];
  // Work on the base waits until what is committed there has landed: an item in review, or
  // approved and waiting for its push, still holds it.
  if (own.work) {
    for (const each of liveBoards(ctx)) {
      for (const other of selectItems(ctx.db, { collection: each.collection })) {
        const held = other.id === item.id ? undefined : holdsBase(ctx, each, other);
        if (held?.key === own.key) {
          return { first: other.id, base: own.base, work: true, review: true };
        }
      }
    }
  }
  const priority = priorityOf(ctx.db);
  const entered = selectStateEntries(ctx.db);
  const key = (each: ItemRecord) => [
    priority.get(each.id)?.pin ?? Number.POSITIVE_INFINITY,
    priority.get(each.id)?.rank ?? Number.POSITIVE_INFINITY,
  ];
  const since = (each: ItemRecord) => entered.get(each.id) ?? each.createdAt;
  const before = (a: ItemRecord, b: ItemRecord) => {
    const [pa = 0, ra = 0] = key(a);
    const [pb = 0, rb = 0] = key(b);
    if (pa !== pb) return pa < pb;
    if (ra !== rb) return ra < rb;
    const [sa, sb] = [since(a), since(b)];
    return sa !== sb ? sa < sb : a.createdAt < b.createdAt;
  };
  const ahead = waiting
    .filter(({ item: other, board: each }) => takeable(each, other) && before(other, item))
    .map(({ item: other }) => other);
  const first = ahead.reduce<ItemRecord | undefined>(
    (best, other) => (best === undefined || before(other, best) ? other : best),
    undefined,
  );
  if (!first) return undefined;
  return {
    first: first.id,
    base: own.base,
    place: placeText(priority.get(first.id), own.work),
    ...(own.work ? { work: true as const } : {}),
  };
}

// Why a claim of the item is refused while another lands first, in one line.
export function landsFirstText(id: string, first: LandsFirst): string {
  const { base } = first;
  if (first.work) {
    if ('review' in first) {
      return `${id} not claimed: ${first.first} is committed on ${base} and waits for its review and its push, and ${id} waits for it: this board works straight on ${base}, so one change at a time until it has landed, or the next one's commits would ride along in that push. Take other work meanwhile: otea next.`;
    }
    const ahead =
      'holder' in first
        ? `${first.holder} works on ${base} with ${first.first} now, and ${id} waits for it`
        : `${first.first} goes first on ${base} (${first.place}), then ${id}`;
    return `${id} not claimed: ${ahead}: this board works straight on ${base}, so one agent at a time, in the person's order, or two would change the same files. Take other work meanwhile: otea next.`;
  }
  const ahead =
    'holder' in first
      ? `${first.holder} lands ${first.first} in ${base} now; ${id} lands after it`
      : `${first.first} lands in ${base} first (${'place' in first ? first.place : ''}), then ${id}`;
  return `${id} not claimed: ${ahead}: one agent lands at a time on ${base}, in the person's order, so no landing conflicts with another under way. Take other work meanwhile: otea next.`;
}

// What next says, with nothing to offer, of the items that wait for their turn to land.
export function landsFirstLine(id: string, first: LandsFirst): string {
  const { base } = first;
  if (first.work) {
    const waits =
      'review' in first
        ? `${first.first} is committed there and waits for its review and its push`
        : 'holder' in first
          ? `${first.holder} works on ${first.first} there now`
          : `${first.first} goes first there (${first.place})`;
    return `${id} waits to work on ${base}: ${waits}; one agent at a time works straight on ${base}, in the person's order.`;
  }
  const ahead =
    'holder' in first
      ? `${first.holder} lands ${first.first} there now`
      : `${first.first} lands there first (${'place' in first ? first.place : ''})`;
  return `${id} waits to land in ${base}: ${ahead}; one agent lands at a time on ${base}, in the person's order.`;
}
