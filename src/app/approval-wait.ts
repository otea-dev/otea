import { backWaysOf, isClosed, isLandStep, positionOf } from '../core/board/engine.ts';
import { type BoardDefinition, stepById } from '../core/board/model.ts';
import type { Actor } from '../core/item.ts';
import {
  type EventRecord,
  findItem,
  type ItemRecord,
  selectEvents,
  selectMovesWith,
} from '../store/queries.ts';
import type { Context } from './context.ts';
import { overlapPeers } from './land-order.ts';
import { liveBoardOf } from './next.ts';

// Approvals that overlap (field studies 4 and 5: API-7 reviewed three times, the same README three
// times). Items whose branches change the same files, approved together, landed one after the
// other, and each landing conflicted with what had landed before it: a bounce back to review, again
// and again. The rule: an item approved while an overlapping one is still to land waits for it (the
// land order holds it, src/app/land-order.ts); once that one has landed, the item's agent merges
// main into it first and the person reviews that merge once, as a merge-only round
// (src/app/merge-only.ts), then it lands; if the merge conflicts the agent resolves it and the
// round comes back once with the resolution. Nothing the person sees is a bounce.
//
// What this keeps is on the moves themselves: the person's approval carries `waits` (the
// overlapping items still to land then), the agent's return carries `waited` (the ones that
// landed ahead of it). Both are plain facts of the record, read again whenever they are needed.

const idsOf = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [];

function landsAt(def: BoardDefinition, state: string): boolean {
  const at = positionOf(state);
  return !isClosed(at) && at.phase === 'doing' && isLandStep(def, at.step);
}

// The person's approval that put the item on its land step, when it is on one: when, and the
// overlapping items it found still to land.
function approvalOf(
  def: BoardDefinition,
  item: { state: string },
  events: readonly EventRecord[],
): { at: string; waits: string[] } | undefined {
  if (!landsAt(def, item.state)) return undefined;
  const last = events.findLast(
    ({ type, data }) => type === 'transitioned' && data.to === item.state,
  );
  if (last?.actor.kind !== 'human') return undefined;
  return { at: last.at, waits: idsOf(last.data.waits) };
}

const isDone = (ctx: Context, id: string): boolean => {
  const found = findItem(ctx.db, id);
  const at = found && positionOf(found.state);
  return at !== undefined && isClosed(at) && at.closed === 'done';
};

// The items that landed ahead of an approved item it overlaps, since its approval: the ones it
// waited for, and the ones approved later that its own order put first. They are why its agent
// merges main into it before it lands. Empty for an approval that overlapped nothing, or whose
// overlapping items were sent back or dropped instead of landing.
export function landedAhead(
  ctx: Context,
  item: { id: string; state: string; collection: string },
): string[] {
  const board = liveBoardOf(ctx, item.collection);
  if (!board || !landsAt(board.def, item.state)) return [];
  const approval = approvalOf(board.def, item, selectEvents(ctx.db, item.id));
  if (!approval) return [];
  const waited = approval.waits.filter((id) => isDone(ctx, id));
  const later = selectMovesWith(ctx.db, 'waits').flatMap(({ itemId, data, at }) =>
    itemId !== item.id &&
    at >= approval.at &&
    idsOf(data.waits).includes(item.id) &&
    isDone(ctx, itemId)
      ? [itemId]
      : [],
  );
  return [...new Set([...waited, ...later])];
}

// What an approved item that came back to merge main waited for, while it is on its way to the
// person's review of that merge: until then it still comes before whatever overlaps it, or that
// would land past it and meet its change. Undefined once the person took it back to work (a
// send-back with comments), it landed or was dropped, or when it is no such return.
export function mergeReturn(
  def: BoardDefinition,
  item: { state: string },
  events: readonly EventRecord[],
): string[] | undefined {
  if (isClosed(positionOf(item.state))) return undefined;
  const at = events.findLastIndex(
    ({ type, data }) =>
      type === 'transitioned' && landsAt(def, String(data.from)) && !landsAt(def, String(data.to)),
  );
  const back = events[at];
  if (back?.actor.kind !== 'agent') return undefined;
  const waited = idsOf(back.data.waited);
  if (waited.length === 0) return undefined;
  // The person approving the merge again (into the land step) keeps it; anything else they did
  // with it (a send-back with comments) takes it back to work.
  const taken = events
    .slice(at + 1)
    .some(
      ({ type, actor, data }) =>
        type === 'transitioned' && actor.kind === 'human' && !landsAt(def, String(data.to)),
    );
  return taken ? undefined : waited;
}

// The items that came back to merge main (and are not landed yet), each with what landed ahead.
export function mergeReturns(ctx: Context): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const id of new Set(selectMovesWith(ctx.db, 'waited').map(({ itemId }) => itemId))) {
    const item = findItem(ctx.db, id);
    const board = item && liveBoardOf(ctx, item.collection);
    const waited = board && mergeReturn(board.def, item, selectEvents(ctx.db, id));
    if (waited) found.set(id, waited);
  }
  return found;
}

// What a move of an item records of this rule: the person's approval into a land step names the
// overlapping items still to land (`waits`); an agent taking it back from the land step after
// they landed names them (`waited`), which is what tells that return from a bounce.
export function approvalData(
  ctx: Context,
  item: ItemRecord,
  to: string,
  actor: Actor,
): Record<string, unknown> {
  const board = liveBoardOf(ctx, item.collection);
  if (!board) return {};
  const from = landsAt(board.def, item.state);
  const into = landsAt(board.def, to);
  if (actor.kind === 'human' && into && !from) {
    const waits = overlapPeers(ctx, { ...item, state: to });
    return waits.length === 0 ? {} : { waits };
  }
  if (actor.kind === 'agent' && from && !into && !isClosed(positionOf(to))) {
    const waited = landedAhead(ctx, item);
    return waited.length === 0 ? {} : { waited };
  }
  return {};
}

const listOf = (ids: readonly string[]): string =>
  ids.length < 2 ? (ids[0] ?? '') : `${ids.slice(0, -1).join(', ')} and ${ids.at(-1)}`;

// What the agent that takes an approved item is told when overlapping items landed ahead of it:
// the merge first, then one review of it, never the landing as it is.
export function mergeAfterText(
  ctx: Context,
  item: { id: string; state: string; collection: string },
  ahead: readonly string[],
): string {
  const board = liveBoardOf(ctx, item.collection);
  const landing = positionOf(item.state);
  const way = board && !isClosed(landing) ? backWaysOf(board.def, landing.step).at(-1) : undefined;
  const name = (way && board && stepById(board.def, way)?.name) || '<the step before>';
  const who = listOf(ahead);
  return `${item.id}: ${who} landed first and changes files ${item.id} changes too, so ${item.id} does not land as it is: merge main into its branch first (git fetch origin, then git merge origin/main; never a rebase), resolve any conflict, run the checks, push the branch, and take it back for one review of that merge with otea handoff ${item.id} --way "${name}" --reason "merged main after ${who}". The person reviews only what the merge itself changed, once; approving it lands ${item.id}. Never land it before that review.`;
}

// The same, for an item an agent is offered or reads: nothing when no overlapping item landed
// ahead of it.
export function mergeFirstLines(
  ctx: Context,
  item: { id: string; state: string; collection: string },
): string[] {
  const ahead = landedAhead(ctx, item);
  return ahead.length === 0 ? [] : [mergeAfterText(ctx, item, ahead)];
}
