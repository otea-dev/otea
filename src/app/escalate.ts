import type { AssistantState } from '../core/assistant.ts';
import { bandejaIdOf } from '../core/bandeja.ts';
import { OteaError } from '../core/errors.ts';
import { plainLine } from '../core/quote.ts';
import { dismissEscalation, escalationExists, selectOpenEscalations } from '../store/assistant.ts';
import { transaction } from '../store/database.ts';
import {
  assistantName,
  assistantStatus,
  emitAssistantSignal,
  MAX_DELIVERIES,
} from './assistant.ts';
import { isBandejaTarget, requireEntry } from './bandeja.ts';
import type { Context } from './context.ts';
import { type Clock, requireItem, systemClock } from './items.ts';

// What a worker or a refiner says to the project's assistant when the person must know it (a
// duplicate, a failed push, a branch pushed by mistake, a problem that blocks it) and it is no
// question for them: the assistant's wait returns it (kind escalation) and the assistant tells the
// person in Hablar. While the assistant is away the person sees it themselves (pendingOf). A
// decision only the person can take is `otea ask`, with options.

export const ESCALATION_MAX_CHARS = 2000;

// How many escalations from one agent may wait unacted at once: past it, the agent waits for the
// assistant to deal with them (a loop of an agent must not bury the person's list).
export const MAX_OPEN_PER_AGENT = 5;

// The words are data for the assistant and the person, never an instruction or markup: one line of
// plain text, no control characters, and the quotes the wake puts around it cannot be closed from
// inside.
export const cleanEscalation = (text: string): string => plainLine(text, Number.POSITIVE_INFINITY);

// An escalation the assistant has not acted on is shown to the person themselves, even while the
// assistant is connected, once it was returned MAX_DELIVERIES times or waited this long: the
// assistant may be busy or its wait lost, and what an agent flagged is never left to rot unseen.
export const ESCALATION_SHOWN_AFTER_MS = 10 * 60_000;

// Whether the person is shown an escalation that is still open: always while the assistant is away,
// else once it was delivered twice or waited ESCALATION_SHOWN_AFTER_MS.
export function escalationShown(
  kept: { at: string; deliveries: number },
  assistantAway: boolean,
  nowMs: number,
): boolean {
  return (
    assistantAway ||
    kept.deliveries >= MAX_DELIVERIES ||
    nowMs - Date.parse(kept.at) >= ESCALATION_SHOWN_AFTER_MS
  );
}

// The person sets an escalation aside (the row in Te toca): it is done with.
export function dismissOpenEscalation(ctx: Context, id: number, now: Clock = systemClock): void {
  // Done with already (a second tap, the assistant's ack, a prune that came first): no error, the
  // person's tap has what it asked for. Only a number that was never an escalation is refused.
  if (dismissEscalation(ctx.db, id, now()) || escalationExists(ctx.db, id)) return;
  throw new OteaError('not_found', `There is no escalation ${id}`);
}

// How an escalation is kept: who said it and what, the words quoted as data.
export const escalationText = (agent: string, words: string): string => `${agent} says: «${words}»`;

// Who said it and what, back from what is kept.
export function parseEscalation(kept: string): { by: string; text: string } {
  const match = /^(\S+) says: «([\s\S]*)»$/.exec(kept);
  return match ? { by: match[1] ?? '', text: match[2] ?? '' } : { by: '', text: kept };
}

// The item or Bandeja note it is about, checked, as its id.
function aboutOf(ctx: Context, given: string): string {
  const about = given.trim();
  if (isBandejaTarget(ctx, about)) {
    const entry = requireEntry(ctx, bandejaIdOf(about));
    return entry.ref;
  }
  return requireItem(ctx.db, about).id;
}

export type Escalated = {
  assistant: string;
  about: string;
  // The same words were already waiting: nothing new was sent.
  already: boolean;
  // Offline, the person sees it directly: the agent is told so.
  assistantState: AssistantState;
};

export function escalateToAssistant(
  ctx: Context,
  input: { agent: string; about: string; text: string },
  now: Clock = systemClock,
): Escalated {
  const text = cleanEscalation(input.text);
  if (text === '') {
    throw new OteaError('reason_required', 'Not escalated: say what the assistant should know');
  }
  if (input.text.length > ESCALATION_MAX_CHARS) {
    throw new OteaError(
      'invalid_fields',
      `Not escalated: ${ESCALATION_MAX_CHARS} characters at most, the conclusion first; the rest goes on the item (otea update) or in a file`,
    );
  }
  const assistant = assistantName(ctx.db);
  if (assistant === undefined) {
    throw new OteaError(
      'invalid_transition',
      'The project has no assistant to escalate to. If the person must decide, ask them: otea ask <id> "<question>" --option "<a>" --option "<b>"; if they only need to know, say it in your handoff note',
    );
  }
  if (assistant === input.agent) {
    throw new OteaError(
      'forbidden',
      'You are the assistant: tell the person with otea say "<text>" --links <ids>, no escalation needed',
    );
  }
  const about = aboutOf(ctx, input.about);
  const kept = escalationText(input.agent, text);
  const state = assistantStatus(ctx.db, now)?.state ?? 'offline';
  // The cap is checked and the signal inserted in one transaction: two calls at once cannot both
  // pass the check.
  return transaction(ctx.db, () => {
    const open = selectOpenEscalations(ctx.db);
    // Said already, and not acted on yet: once is enough.
    if (open.some((each) => each.ref === about && each.text === kept)) {
      return { assistant, about, already: true, assistantState: state };
    }
    const mine = open.filter((each) => each.text.startsWith(`${input.agent} says: «`));
    if (mine.length >= MAX_OPEN_PER_AGENT) {
      throw new OteaError(
        'forbidden',
        `You have ${mine.length} escalations waiting for the assistant (${assistant}): go on with your work and let it deal with them first; a new one is taken once it has`,
      );
    }
    emitAssistantSignal(ctx.db, { kind: 'escalation', ref: about, text: kept }, now);
    return { assistant, about, already: false, assistantState: state };
  });
}
