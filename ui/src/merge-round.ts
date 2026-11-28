import type { ItemEvent } from './types.ts';

// A round that only merges main into work the person approved (src/app/merge-only.ts) is no
// send-back: nobody sent anything back, an agent took the approved item back to bring main in (or to
// merge a clash) and handed it off again. Otea records it on the handoff (`merge`, the commits the
// merge is worked out from) and the agent's return on the move (`waited`, the items that landed
// first); both are read from the item's own events, never stored again.

type Moved = Pick<ItemEvent, 'id' | 'type' | 'at' | 'actor' | 'data'>;

const isMerge = (value: unknown): boolean =>
  value !== null &&
  typeof value === 'object' &&
  Array.isArray((value as { files?: unknown }).files);

const byAgent = (e: Moved): boolean => e.actor.kind === 'agent' && typeof e.data.via !== 'string';

// Whether the handoff into the review the item is in (`state`) recorded that the round only merges.
export function handedAsMerge(events: readonly Moved[], state: string): boolean {
  const last = events.findLast((e) => e.type === 'transitioned' && e.data.to === state);
  return last !== undefined && isMerge(last.data.merge);
}

// The moments of the agent's returns that were a merge: the approved item taken back to bring in what
// landed first (`waited`), or the one that a handoff recording a merge-only round followed. The
// dips and rounds the route draws are keyed by these moments.
export function mergeReturnTimes(events: readonly Moved[]): Set<string> {
  const moves = events.filter((e) => e.type === 'transitioned').sort((a, b) => a.id - b.id);
  const out = new Set<string>();
  for (const [i, move] of moves.entries()) {
    if (byAgent(move) && Array.isArray(move.data.waited) && move.data.waited.length > 0)
      out.add(move.at);
    const back = moves[i - 1];
    if (isMerge(move.data.merge) && back && byAgent(back) && !isMerge(back.data.merge))
      out.add(back.at);
  }
  return out;
}
