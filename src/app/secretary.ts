import type { DatabaseSync } from 'node:sqlite';
import { OteaError } from '../core/errors.ts';
import { settleUnheard, unheardKey } from '../core/notify/signals.ts';
import {
  SECRETARY_SIGNALS,
  type SecretarySignalKind,
  type SecretaryStatus,
  type SecretaryWakeKind,
} from '../core/secretary.ts';
import { transaction } from '../store/database.ts';
import { selectEvents } from '../store/queries.ts';
import {
  countPendingSignals,
  deleteStretch,
  insertSignal,
  insertStretch,
  saveRole,
  selectNextSignal,
  selectRoles,
  selectStretches,
  takeSignal,
  tellStretch,
} from '../store/secretary.ts';
import type { Context } from './context.ts';
import { type Clock, listItems, systemClock } from './items.ts';
import { boardRoundOf, liveBoards } from './next.ts';
import { listAgents, processAlive } from './presence.ts';
import { setAsideOf } from './set-aside.ts';
import { unheardOf } from './unheard.ts';

// The project's secretary (0.8): one agent with the role `secretary`, which talks with the person
// and keeps the workers running. It waits with `otea wait --secretary`, which returns for what it
// has to act on (secretaryWake). The desk and the notifier never count it as listening on the
// boards (AgentPresence.waiting is false for it), so «nadie escucha» keeps working while it waits.

// The agent that declared the secretary role, if any. At most one: declareSecretary keeps it so.
export function secretaryName(db: DatabaseSync): string | undefined {
  return [...selectRoles(db)].find(([, role]) => role === 'secretary')?.[0];
}

export type SecretaryDeclared = { agent: string; role: 'secretary'; replaced: string | null };

// Makes `agent` the project's secretary (otea profile --role secretary, otea connect --role
// secretary). A second one is refused while the first is connected; one that is gone (its session
// ended and it was not heard for a while) is replaced, so a restart under a new name takes over.
export function declareSecretary(
  db: DatabaseSync,
  agent: string,
  now: Clock = systemClock,
  processes: (pid: number) => boolean = processAlive,
): SecretaryDeclared {
  return transaction(db, () => {
    const current = secretaryName(db);
    let replaced: string | null = null;
    if (current !== undefined && current !== agent) {
      const there = listAgents(db, now, processes).find(({ name }) => name === current);
      if (there && there.status !== 'away') {
        throw new OteaError(
          'secretary_taken',
          `${current} is this project's secretary and is connected (${there.status}): a project has one. If that is your own earlier session under another name, wait until it is gone (a few minutes) or use ${current}; otherwise ask the person`,
        );
      }
      saveRole(db, current, null, now());
      replaced = current;
    }
    saveRole(db, agent, 'secretary', now());
    return { agent, role: 'secretary', replaced };
  });
}

// The secretary as the desk and the CLI show it: connected, listening (in its wait) or offline since
// the last time it was heard. Undefined while the project has none.
export function secretaryStatus(
  db: DatabaseSync,
  now: Clock = systemClock,
  processes: (pid: number) => boolean = processAlive,
): SecretaryStatus | undefined {
  const name = secretaryName(db);
  if (name === undefined) return undefined;
  const agent = listAgents(db, now, processes).find((each) => each.name === name);
  const pending = countPendingSignals(db);
  if (!agent?.live) {
    return { name, state: 'offline', since: agent?.lastSeen ?? null, pending };
  }
  return { name, state: agent.attending ? 'listening' : 'connected', since: null, pending };
}

// `otea wait --secretary` is only for the project's secretary: another agent waiting that way would
// take the person's messages from it.
export function requireSecretary(db: DatabaseSync, agent: string): void {
  const secretary = secretaryName(db);
  if (secretary === agent) return;
  const declare = `otea profile --role secretary --as ${agent}`;
  throw new OteaError(
    'forbidden',
    secretary === undefined
      ? `${agent} is not this project's secretary: the project has none yet. Declare the role first: ${declare}`
      : `${agent} is not this project's secretary (${secretary} is). Only the secretary waits with --secretary`,
  );
}

export type SecretarySignalInput = {
  kind: SecretarySignalKind;
  ref?: string | undefined;
  text?: string | undefined;
};

// The one way anything wakes the secretary besides unheard board work: the conversation emits
// person_message when the person posts (M2), the Bandeja bandeja_item when a capture arrives (M5),
// and an escalated question escalation. The secretary's wait returns each signal once, oldest
// first. A signal is a nudge, never the record of the thing: a message keeps its own state, so a
// signal lost (a wait killed after it returned) only means the secretary reads the conversation.
export function emitSecretarySignal(
  db: DatabaseSync,
  signal: SecretarySignalInput,
  now: Clock = systemClock,
): number {
  if (!(SECRETARY_SIGNALS as readonly string[]).includes(signal.kind)) {
    throw new OteaError(
      'invalid_fields',
      `Unknown secretary signal ${signal.kind}: one of ${SECRETARY_SIGNALS.join(', ')}`,
    );
  }
  return insertSignal(db, signal, now());
}

export type SecretaryWake = {
  kind: SecretaryWakeKind;
  // What it is about: the message, the capture, or the item of the question.
  ref?: string;
  // The items that wait for an agent nobody brings (kind unheard).
  items?: string[];
  text: string;
};

const SIGNAL_TEXT: Readonly<Record<SecretarySignalKind, (ref?: string, text?: string) => string>> =
  {
    person_message: (ref, text) =>
      `The person wrote to you${ref ? ` (${ref})` : ''}${text ? `: ${text}` : ''}. Read the conversation and answer.`,
    bandeja_item: (ref, text) =>
      `The person captured a note in the Bandeja${ref ? ` (${ref})` : ''}${text ? `: ${text}` : ''}. Refine it, or hand it to a refiner.`,
    escalation: (ref, text) =>
      `A question is escalated to you${ref ? ` on ${ref}` : ''}${text ? `: ${text}` : ''}. Answer it, or ask the person.`,
  };

// The items that wait for an agent nobody brings, by the key their stretch is counted under.
function unheardNow(
  ctx: Context,
  now: Clock,
  processes: (pid: number) => boolean,
): Map<string, string> {
  const at = now();
  const agents = listAgents(ctx.db, now, processes);
  const boards = liveBoards(ctx);
  const keys = new Map<string, string>();
  for (const item of listItems(ctx, {}, now)) {
    const setAside = item.turn === 'agent' ? setAsideOf(selectEvents(ctx.db, item.id)) : undefined;
    if (!unheardOf(item, agents, at, setAside !== undefined)) continue;
    const round = boardRoundOf(ctx, item, boards);
    const facts = { id: item.id, state: item.state, ...(round === undefined ? {} : { round }) };
    keys.set(unheardKey(facts), item.id);
  }
  return keys;
}

// Keeps when each unheard stretch began (in the database, so the grace holds across waits, whatever
// their timeout) and returns the stretches that passed the grace and were not told yet.
function settleStretches(
  ctx: Context,
  unheard: ReadonlyMap<string, string>,
  nowMs: number,
): string[] {
  const known = selectStretches(ctx.db);
  const since = new Map<string, number | null>(
    [...known].map(([key, { since: began }]) => [key, began]),
  );
  const past = settleUnheard(since, new Set(unheard.keys()), nowMs, false);
  for (const key of known.keys()) if (!since.has(key)) deleteStretch(ctx.db, key);
  for (const [key, began] of since) {
    if (!known.has(key) && began !== null) insertStretch(ctx.db, key, began);
  }
  return [...past].filter((key) => known.get(key)?.told !== true);
}

// What the secretary's wait returns now, or undefined while nothing needs it: a signal waiting
// (oldest first), else board work that stayed unheard for the grace (the notifier's, core/notify
// UNHEARD_GRACE_MS), counted once per stretch. Returning a signal or a stretch takes it.
export function secretaryWake(
  ctx: Context,
  now: Clock = systemClock,
  processes: (pid: number) => boolean = processAlive,
): SecretaryWake | undefined {
  const nowMs = Date.parse(now());
  const unheard = unheardNow(ctx, now, processes);
  const told = settleStretches(ctx, unheard, nowMs);
  const signal = selectNextSignal(ctx.db);
  if (signal) {
    takeSignal(ctx.db, signal.id, now());
    const { kind, ref, text } = signal;
    return {
      kind,
      ...(ref === null ? {} : { ref }),
      text: SIGNAL_TEXT[kind](ref ?? undefined, text ?? undefined),
    };
  }
  if (told.length === 0) return undefined;
  for (const key of told) tellStretch(ctx.db, key, now());
  const items = [...new Set(told.map((key) => unheard.get(key)).filter((id) => id !== undefined))];
  return {
    kind: 'unheard',
    items,
    text: `${items.join(', ')} ${items.length === 1 ? 'waits' : 'wait'} for an agent and nobody is listening. Wake or launch a worker for the board, or tell the person.`,
  };
}
