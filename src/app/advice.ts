import { ADVICE, type AdviceKind, MAX_ADVICE_CHARS } from '../core/board/advice.ts';
import { OteaError } from '../core/errors.ts';
import { plainLine } from '../core/quote.ts';
import { appendEvent } from '../store/queries.ts';
import { assertInReview } from './conversation-act.ts';
import { type Clock, systemClock } from './items.ts';
import type { Project } from './project.ts';
import { secretaryName } from './secretary.ts';

// An agent tells the person, on the item itself, what it thinks of a delivery that waits for their
// review (s-real2 D-00b356): the secretary recommends sending it back, or the agent that delivered it
// doubts it. The pages that offer Aprobar say it beside the button. It is advice: it moves nothing,
// blocks nothing, and the person's act stays theirs. Refused for an item that is not in their
// review now; the latest advice stands, and a new handoff leaves it behind.
export type AdviseInput = { id: string; agent: string; kind: AdviceKind; note: string };

export function adviseOnItem(project: Project, input: AdviseInput, now: Clock = systemClock) {
  const note = plainLine(input.note, MAX_ADVICE_CHARS);
  if (note === '') {
    throw new OteaError(
      'reason_required',
      'Not recorded: say the reason in one line, in plain words, as the person reads it beside Aprobar',
    );
  }
  assertInReview(project, input.id);
  const secretary = secretaryName(project.db) === input.agent;
  appendEvent(project.db, {
    itemId: input.id,
    type: ADVICE,
    actor: { kind: 'agent', name: input.agent },
    at: now(),
    data: { kind: input.kind, note, secretary },
  });
  return { id: input.id, kind: input.kind, note, secretary };
}
