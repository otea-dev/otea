import { isClosed, positionOf } from '../core/board/engine.ts';
import { insertSignal, selectRoles } from '../store/secretary.ts';
import type { Context } from './context.ts';

// An item that just reached the person's review (a handoff, a second round after a send-back)
// wakes the project's secretary, so it tells them at once instead of at its next wait for another
// reason. A nudge, never the record: what waits for the person is pendingOf. Nothing is kept for a
// project with no secretary (one that comes later would be woken for a review long gone). Kept
// apart from app/secretary.ts, which reads items: moving an item needs this, so it must not need
// that.
export function signalReview(
  ctx: Context,
  item: { id: string; title: string },
  move: { to: string; turn: string; board: boolean },
  at: string,
): void {
  if (move.turn !== 'human') return;
  // On a board the person's own step is theirs to do, not a review (pendingOf: kind `step`).
  if (move.board) {
    const position = positionOf(move.to);
    if (isClosed(position) || position.phase === 'doing') return;
  }
  if (![...selectRoles(ctx.db).values()].includes('secretary')) return;
  insertSignal(ctx.db, { kind: 'ready_for_review', ref: item.id, text: item.title }, at);
}

// An item an agent closed as Done (landed, for work with code) is news the person may have missed:
// they were away, or never looked at the board. It wakes the secretary, whose wait returns every
// landing since it last spoke as one (app/secretary.ts), so it says in one line what landed since
// the person's last message. A nudge, never the record; nothing is kept for a project with no
// secretary. Only for an agent's move: the person knows what they did themselves.
export function signalLanded(
  ctx: Context,
  item: { id: string; title: string },
  closes: 'done' | 'discarded' | undefined,
  at: string,
): void {
  if (closes !== 'done') return;
  if (![...selectRoles(ctx.db).values()].includes('secretary')) return;
  insertSignal(ctx.db, { kind: 'landed', ref: item.id, text: item.title }, at);
}
