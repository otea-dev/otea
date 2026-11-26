import { bandejaIdOf, isBandejaRef } from '../core/bandeja.ts';
import { OteaError } from '../core/errors.ts';
import { requireEntry } from './bandeja.ts';
import type { Context } from './context.ts';
import { type Clock, requireItem, systemClock } from './items.ts';
import { emitSecretarySignal, secretaryName } from './secretary.ts';

// What a worker or a refiner says to the project's secretary when the person must know it (a
// duplicate, a failed push, a branch it should not have pushed, a problem that blocks it) and it
// is no question for them: the secretary's wait returns it (kind escalation) and the secretary
// tells the person in Hablar. A decision only the person can take is `otea ask`, with options.

export const ESCALATION_MAX_CHARS = 2000;

// The item or Bandeja note it is about, checked, as its id.
function aboutOf(ctx: Context, given: string): string {
  const about = given.trim();
  if (isBandejaRef(about)) {
    const entry = requireEntry(ctx, bandejaIdOf(about));
    return entry.ref;
  }
  return requireItem(ctx.db, about).id;
}

export function escalateToSecretary(
  ctx: Context,
  input: { agent: string; about: string; text: string },
  now: Clock = systemClock,
): { secretary: string; about: string } {
  const text = input.text.trim();
  if (text === '') {
    throw new OteaError('reason_required', 'Not escalated: say what the secretary should know');
  }
  if (text.length > ESCALATION_MAX_CHARS) {
    throw new OteaError(
      'invalid_fields',
      `Not escalated: ${ESCALATION_MAX_CHARS} characters at most, the conclusion first; the rest goes on the item (otea update) or in a file`,
    );
  }
  const secretary = secretaryName(ctx.db);
  if (secretary === undefined) {
    throw new OteaError(
      'invalid_transition',
      'The project has no secretary to escalate to. If the person must decide, ask them: otea ask <id> "<question>" --option "<a>" --option "<b>"; if they only need to know, say it in your handoff note',
    );
  }
  if (secretary === input.agent) {
    throw new OteaError(
      'forbidden',
      'You are the secretary: tell the person with otea say "<text>" --links <ids>, no escalation needed',
    );
  }
  const about = aboutOf(ctx, input.about);
  emitSecretarySignal(
    ctx.db,
    { kind: 'escalation', ref: about, text: `${input.agent} says: ${text}` },
    now,
  );
  return { secretary, about };
}
