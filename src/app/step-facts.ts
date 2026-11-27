import { isClosed, isLandStep, positionOf } from '../core/board/engine.ts';
import type { BoardDefinition } from '../core/board/model.ts';
import type { EventRecord } from '../store/queries.ts';

// Two things an approved item's card must say and did not (U1, field study 4): that approving is
// not landing («aprobado · falta integrar» until an agent has merged it), and that an item which
// came back to its doing step after it was approved came back because it conflicted with another
// change that landed first, once, in plain words, whatever surface shows it.
export type StepFacts = {
  // Approved by the person and waiting for an agent to land it in its base.
  landing?: true;
  // It was on its way to land (or Done, unmerged) and an agent took it back to its doing step.
  bounced?: { by: string; at: string; reason: string | null };
  // An item approved together with overlapping ones, whose agent brings main into it before it
  // lands because they landed first (src/app/approval-wait.ts): not a bounce. Its merge comes back
  // to the person's review once.
  merging?: { after: string[] };
};

const idsOf = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [];

// `landedAhead`: the items that landed ahead of an item still on its land step, which it merges
// main with first (src/app/approval-wait.ts landedAhead).
export function stepFactsOf(
  def: BoardDefinition | undefined,
  item: { state: string; turn: string },
  events: readonly Pick<EventRecord, 'type' | 'actor' | 'at' | 'data'>[],
  landedAhead: readonly string[] = [],
): StepFacts {
  if (!def || item.turn !== 'agent') return {};
  const here = positionOf(item.state);
  if (isClosed(here) || here.phase !== 'doing') return {};
  if (isLandStep(def, here.step))
    return {
      landing: true,
      ...(landedAhead.length > 0 ? { merging: { after: [...landedAhead] } } : {}),
    };
  const last = events.findLast(({ type }) => type === 'transitioned');
  if (last?.actor.kind !== 'agent' || last.data.to !== item.state) return {};
  const from = typeof last.data.from === 'string' ? positionOf(last.data.from) : undefined;
  if (!from) return {};
  // From the land step, or from Done: taken back by an agent, never a handoff forward.
  const back = isClosed(from) || (from.phase === 'doing' && isLandStep(def, from.step));
  if (!back) return {};
  // Taken back to merge what landed ahead of it, which it waited for: no bounce.
  const waited = idsOf(last.data.waited);
  if (waited.length > 0) return { merging: { after: waited } };
  const reason = typeof last.data.reason === 'string' ? last.data.reason.trim() : '';
  return { bounced: { by: last.actor.name, at: last.at, reason: reason === '' ? null : reason } };
}
