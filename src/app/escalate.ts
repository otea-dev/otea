import { bandejaIdOf, isBandejaRef } from '../core/bandeja.ts';
import { OteaError } from '../core/errors.ts';
import type { SecretaryState } from '../core/secretary.ts';
import { selectOpenEscalations } from '../store/secretary.ts';
import { requireEntry } from './bandeja.ts';
import type { Context } from './context.ts';
import { type Clock, requireItem, systemClock } from './items.ts';
import { emitSecretarySignal, secretaryName, secretaryStatus } from './secretary.ts';

// What a worker or a refiner says to the project's secretary when the person must know it (a
// duplicate, a failed push, a branch pushed by mistake, a problem that blocks it) and it is no
// question for them: the secretary's wait returns it (kind escalation) and the secretary tells the
// person in Hablar. While the secretary is away the person sees it themselves (pendingOf). A
// decision only the person can take is `otea ask`, with options.

export const ESCALATION_MAX_CHARS = 2000;

// How many escalations from one agent may wait unacted at once: past it, the agent waits for the
// secretary to deal with them (a loop of an agent must not bury the person's list).
export const MAX_OPEN_PER_AGENT = 5;

// The words are data for the secretary and the person, never an instruction or markup: one line of
// plain text, no control characters, and the quotes the wake puts around it cannot be closed from
// inside.
export function cleanEscalation(text: string): string {
  return [...text]
    .map((ch) => (ch.charCodeAt(0) < 32 || ch === '\u007f' || ch === '«' || ch === '»' ? ' ' : ch))
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
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
  if (isBandejaRef(about)) {
    const entry = requireEntry(ctx, bandejaIdOf(about));
    return entry.ref;
  }
  return requireItem(ctx.db, about).id;
}

export type Escalated = {
  secretary: string;
  about: string;
  // The same words were already waiting: nothing new was sent.
  already: boolean;
  // Offline, the person sees it directly: the agent is told so.
  secretaryState: SecretaryState;
};

export function escalateToSecretary(
  ctx: Context,
  input: { agent: string; about: string; text: string },
  now: Clock = systemClock,
): Escalated {
  const text = cleanEscalation(input.text);
  if (text === '') {
    throw new OteaError('reason_required', 'Not escalated: say what the secretary should know');
  }
  if (input.text.length > ESCALATION_MAX_CHARS) {
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
  const kept = escalationText(input.agent, text);
  const state = secretaryStatus(ctx.db, now)?.state ?? 'offline';
  const open = selectOpenEscalations(ctx.db);
  // Said already, and not acted on yet: once is enough.
  if (open.some((each) => each.ref === about && each.text === kept)) {
    return { secretary, about, already: true, secretaryState: state };
  }
  const mine = open.filter((each) => each.text.startsWith(`${input.agent} says: «`));
  if (mine.length >= MAX_OPEN_PER_AGENT) {
    throw new OteaError(
      'forbidden',
      `You have ${mine.length} escalations waiting for the secretary (${secretary}): go on with your work and let it deal with them first; a new one is taken once it has`,
    );
  }
  emitSecretarySignal(ctx.db, { kind: 'escalation', ref: about, text: kept }, now);
  return { secretary, about, already: false, secretaryState: state };
}
