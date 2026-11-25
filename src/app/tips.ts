import { isClosed, positionOf } from '../core/board/engine.ts';
import { selectEvents } from '../store/queries.ts';
import type { Context } from './context.ts';

// The commit and tree of a branch an agent handed off for review (recorded with its handoff): what
// the person approved, which is all the branch may bring in once it is approved. `unchanged`: a
// main-only item handed off with nothing on the base the remote lacks, no code change (P2S-R3-3).
export type Tip = { branch: string; commit: string; tree: string; unchanged?: true };

function isTip(value: unknown): value is Tip {
  if (value === null || typeof value !== 'object') return false;
  const { branch, commit, tree } = value as Record<string, unknown>;
  return typeof branch === 'string' && typeof commit === 'string' && typeof tree === 'string';
}

// What the person approved of an item's branch: the tip its last handoff into a review recorded
// (P3C-R2-1). A later handoff that recorded none (made outside the repo) leaves nothing to hold the
// branch to, never an older round's tip; a tip of another branch holds nothing either.
export function approvedTipOf(ctx: Context, id: string, branch: string): Tip | undefined {
  const tip = lastHandoff(ctx, id)?.data.tip;
  return isTip(tip) && tip.branch === branch ? tip : undefined;
}

// The item's moves into a review (its handoffs), oldest first.
function handoffs(ctx: Context, id: string) {
  return selectEvents(ctx.db, id)
    .filter(({ type }) => type === 'transitioned')
    .filter(({ data }) => {
      const to = positionOf(String(data.to));
      return !isClosed(to) && to.phase !== 'doing';
    });
}

// The item's last move into a review: its last handoff.
function lastHandoff(ctx: Context, id: string) {
  return handoffs(ctx, id).at(-1);
}

// A round whose work holds the same files as the round it answers (P5-F2): `commit` is the tip of
// that earlier round, `round` its number among the handoffs made from the same step.
export type SameRound = { commit: string; round: number };

// Whether `tip`, handed off from the step `from`, holds the files the previous handoff from that
// step held: same branch, same tree, whatever commits (an empty one) came between. Handoffs from
// another step are never compared (a landing step hands the tree it was given, not a new one), so
// only a later round of the same step is. `before` counts only the first handoffs; none: all.
function sameAsEarlier(
  ctx: Context,
  id: string,
  from: string,
  tip: Tip,
  before?: number,
): SameRound | undefined {
  if (tip.unchanged) return undefined;
  const earlier = handoffs(ctx, id)
    .slice(0, before)
    .filter(({ data }) => data.from === from);
  const previous = earlier.at(-1)?.data.tip;
  return isTip(previous) && previous.branch === tip.branch && previous.tree === tip.tree
    ? { commit: previous.commit, round: earlier.length }
    : undefined;
}

// The round the item's last handoff into a review repeats, undefined when it repeats none (and while
// the item is in no review, or its handoff recorded no tip).
export function repeatedRound(ctx: Context, id: string): (SameRound & { tip: Tip }) | undefined {
  const all = handoffs(ctx, id);
  const last = all.at(-1);
  const tip = last?.data.tip;
  if (!last || !isTip(tip)) return undefined;
  const same = sameAsEarlier(ctx, id, String(last.data.from), tip, all.length - 1);
  return same && { ...same, tip };
}

// The same for a handoff about to be made from `from`, the step the item is doing, whose tip is not
// recorded yet.
export function repeatsLastRound(
  ctx: Context,
  id: string,
  from: string,
  tip: Tip,
): SameRound | undefined {
  return sameAsEarlier(ctx, id, from, tip);
}

// The tip the person approved, when the review the item is in now answers a bounce from the land
// step: it was approved, an agent met a conflict landing it and took it back to the step before
// (otea handoff --way), and this handoff is that step's next round. `approved` is the tip of the
// review that was approved, `now` the tip of this one, of the same branch. `lands` tells the state of
// a step an agent lands in. Undefined for any other round: a send-back by the person with comments,
// a first review, a round that never went through the land step.
export function approvedBeforeBounce(
  ctx: Context,
  id: string,
  lands: (state: string) => boolean,
): { approved: Tip; now: Tip } | undefined {
  const events = selectEvents(ctx.db, id).filter(({ type }) => type === 'transitioned');
  const reviews = handoffs(ctx, id);
  const [last, before] = [reviews.at(-1), reviews.at(-2)];
  const [now, approved] = [last?.data.tip, before?.data.tip];
  if (!last || !before || !isTip(now) || !isTip(approved) || now.branch !== approved.branch)
    return undefined;
  if (now.unchanged || approved.unchanged) return undefined;
  const bounced = events
    .filter(({ id: at }) => at > before.id && at < last.id)
    .some(({ data }) => lands(String(data.from)) && !lands(String(data.to)));
  return bounced ? { approved, now } : undefined;
}

// Whether the item was ever handed off into a review: from then on its branch on the remote holds
// what a review read.
export function handedOff(ctx: Context, id: string): boolean {
  return lastHandoff(ctx, id) !== undefined;
}
