import type { Actor } from '../item.ts';

// What an agent tells the person about a delivery that waits for their review (s-real2 D-00b356):
// the secretary recommends sending it back, or the agent that delivered it doubts it. It is advice
// and never a block: the pages that offer Aprobar say it beside the button, in plain words, and the
// person's act stays theirs. It is about one delivery: a new handoff (the item came back and was
// handed in again) leaves it behind.

export const ADVICE = 'advice';

export const ADVICE_KINDS = ['send_back', 'doubt'] as const;
export type AdviceKind = (typeof ADVICE_KINDS)[number];

export function isAdviceKind(value: unknown): value is AdviceKind {
  return typeof value === 'string' && (ADVICE_KINDS as readonly string[]).includes(value);
}

// One short line: a reason the person reads beside the button, never a report.
export const MAX_ADVICE_CHARS = 400;

export type Advice = {
  kind: AdviceKind;
  note: string;
  // The agent that said it, and whether it is the project's secretary (the desk says «la secretaria»
  // for it and the agent's own name for any other).
  by: string;
  secretary: boolean;
  at: string;
};

type Event = { type: string; actor: Actor; at: string; data: Record<string, unknown> };

// The latest advice given after the last handoff, if any. Whether the item waits for the person is
// the caller's to ask.
export function adviceAfterHandoff(events: readonly Event[]): Advice | undefined {
  const handoff = events.findLastIndex(({ type }) => type === 'transitioned');
  const given = events.slice(handoff + 1).findLast(({ type }) => type === ADVICE);
  if (given === undefined || !isAdviceKind(given.data.kind)) return undefined;
  return {
    kind: given.data.kind,
    note: String(given.data.note ?? ''),
    by: given.actor.name,
    secretary: given.data.secretary === true,
    at: given.at,
  };
}
