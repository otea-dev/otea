import { type AgentChannel, authorizeRelay, relayableMoves } from '../core/authority.ts';
import { isClosed, positionOf, stateOf } from '../core/board/engine.ts';
import { DROPPED, stepById } from '../core/board/model.ts';
import { OteaError } from '../core/errors.ts';
import { assertCanLeave } from '../core/fields.ts';
import type { Actor } from '../core/item.ts';
import { activeLease } from '../core/lease.ts';
import { closesOf, stateLabel, transitionsBetween, type Workflow } from '../core/workflow.ts';
import { selectMessage } from '../store/conversation.ts';
import { transaction } from '../store/database.ts';
import { type EventRecord, type ItemRecord, selectEvents } from '../store/queries.ts';
import { typeOfItem } from './collections.ts';
import type { Context } from './context.ts';
import { type Item, landMove, requireWritableItem, systemClock } from './items.ts';
import {
  approves,
  assertMoveHandsOff,
  boardState,
  liveBoardOf,
  motiveByName,
  relayAllowed,
  roundWorkersOf,
} from './next.ts';
import { assertMayEnter } from './relations.ts';
import { secretaryName } from './secretary.ts';

// The human a relayed decision belongs to: the same actor the web UI records.
export const RELAYED_HUMAN: Actor = { kind: 'human', name: 'human' };

// `via` names the agent relaying what the human decided in conversation, `channel` the one it
// used; `quote` is what the human said.
export type RelayInput = {
  id: string;
  to: string;
  via: string;
  channel: AgentChannel;
  quote: string;
  reason?: string;
  // On a board with motives, the motive of a relayed discard, by its name (any case) or its id.
  motive?: string;
  // The message of the person's in Hablar the quote comes from. A project with a secretary takes a
  // relay only from it and only with this message, which must contain the quote.
  fromMessage?: number;
};

// Words compared as a reader would: case, accents' case and the spaces between words do not tell
// two sentences apart.
const plainWords = (text: string) => text.toLocaleLowerCase().replace(/\s+/g, ' ').trim();

// What a relay stands on once the project has a secretary (field study 4, U8: any process could drop
// an item with a sentence nobody said): the secretary, with the person's own message, which says
// what is quoted. Returns the message. Without a secretary there is no conversation to check
// against and a relay is the agent's word, as it was.
function assertSaidInHablar(
  ctx: Context,
  input: RelayInput,
  quote: string,
  at: string,
): number | undefined {
  const secretary = secretaryName(ctx.db);
  if (secretary === undefined) return undefined;
  if (input.via !== secretary) {
    throw new OteaError(
      'forbidden',
      `Not relayed: only the secretary (${secretary}) relays what the person said, and only words they wrote in Talk.${input.via} asks them instead: otea ask ${input.id} "<your question>"`,
    );
  }
  const refer = `relay it with --from-message <id of the person's message in Talk (otea conversation shows them)> and --quote words that message contains`;
  if (input.fromMessage === undefined) {
    throw new OteaError('quote_required', `Not relayed: ${refer}`);
  }
  const message = selectMessage(ctx.db, input.fromMessage);
  if (message === undefined) {
    throw new OteaError('quote_required', `Not relayed: there is no message ${input.fromMessage}`);
  }
  if (message.author !== 'person') {
    throw new OteaError(
      'quote_required',
      `Not relayed: message ${message.id} is not the person's: ${refer}`,
    );
  }
  // What they typed, not what they tapped: a tap on a card's option is the secretary's own words.
  if (message.choice !== null) {
    throw new OteaError(
      'quote_required',
      `Not relayed: message ${message.id} is a tap on a question, not words the person wrote: ${refer}`,
    );
  }
  if (Date.parse(at) - Date.parse(message.at) > RELAY_MESSAGE_MS) {
    throw new OteaError(
      'quote_required',
      `Not relayed: message ${message.id} is more than a day old (words of the person's from the last 24 hours only): ${refer}`,
    );
  }
  if (!plainWords(message.text).includes(plainWords(quote))) {
    throw new OteaError(
      'quote_required',
      `Not relayed: message ${message.id} does not contain that quote: ${refer}`,
    );
  }
  return message.id;
}

// How long a message of the person's may be quoted by a relay.
const RELAY_MESSAGE_MS = 24 * 3600_000;

// A message of the person's backs one relay on an item: said once, it is not a standing order.
function assertMessageUnused(ctx: Context, item: ItemRecord, message: number): void {
  const used = selectEvents(ctx.db, item.id).some(
    (event) => event.type === 'transitioned' && event.data.message === message,
  );
  if (used) {
    throw new OteaError(
      'quote_required',
      `Not relayed: message ${message} was already relayed on ${item.id}; a message backs one relay of an item. Ask the person again.`,
    );
  }
}

// What a relay may never do, with a secretary or without one (adversarial review of S): drop,
// finish or approve. Words an agent says the person said cannot do what is the person's alone or
// cannot be taken back; the person taps a card (otea say --drop) or decides on the desk.
function assertNotDestructive(
  ctx: Context,
  item: ItemRecord,
  workflow: Workflow,
  to: string,
): void {
  const board = liveBoardOf(ctx, item.collection);
  const target = positionOf(to);
  const from = positionOf(item.state);
  const closes = isClosed(target) || closesOf(workflow, to) !== undefined;
  const approving = board !== undefined && approves(board.def, from, target);
  if (!closes && !approving) return;
  throw new OteaError(
    'forbidden',
    `Not relayed: ${closes ? 'dropping or finishing' : 'approving'} ${item.id} is the person's alone, by their own tap, never by words relayed through an agent. Ask them: otea ask ${item.id} "<your question>"${closes ? ' (the secretary offers a card with otea say --drop)' : ''}, or they decide it on the desk or the phone.`,
  );
}

// An item that waits for the person's review leaves it by their own tap (the desk's Devolver,
// Descartar, Aprobar, or a card of the secretary's they tap), never by words an agent relays.
function assertNotInReview(ctx: Context, item: ItemRecord): void {
  const board = liveBoardOf(ctx, item.collection);
  const position = positionOf(item.state);
  if (!board || isClosed(position) || position.phase !== 'review') return;
  throw new OteaError(
    'forbidden',
    `Not relayed: ${item.id} waits for your review, and an item leaves the person's review only by their own tap, never by a relayed sentence. Ask them in Talk with a card they tap: otea say "<text>" --drop ${item.id} --note "<why>" --option "Drop ${item.id}" --option "Leave it" (or --send-back ${item.id}), or they decide it on the desk.`,
  );
}

// Where a relayed decision moves the item: the state named, or, with a motive, the discard with
// that motive (`otea relay ERR-2 Dropped --motive Duplicado`).
function relayedState(ctx: Context, collection: string, to: string, motive?: string): string {
  const state = boardState(ctx, collection, to);
  if (motive === undefined) return state;
  const board = liveBoardOf(ctx, collection);
  const target = positionOf(state);
  if (!board || !isClosed(target) || target.closed !== DROPPED)
    throw new OteaError('invalid_fields', '--motive goes only with a discard on a board: Dropped');
  const id = motiveByName(board.def, motive);
  if (id === undefined) {
    const names = board.def.drop.motives.map(({ name }) => name).join('|');
    throw new OteaError(
      'invalid_fields',
      names
        ? `${board.def.name} has no motive "${motive}": --motive "${names}"`
        : `${board.def.name} has no motives`,
    );
  }
  return stateOf({ closed: DROPPED, motive: id });
}

// A decision the human made in conversation, recorded by an agent. It is the human's, so like a
// move in the web UI it is not bound by another agent's lease, and it is always marked as relayed.
export function relayDecision(ctx: Context, input: RelayInput, now = systemClock): Item {
  const quote = input.quote.trim();
  if (!quote) {
    throw new OteaError(
      'quote_required',
      'A relayed decision needs a quote of what the human said',
    );
  }
  if (quote.split(/\s+/).length < 2) {
    throw new OteaError(
      'quote_required',
      'A relayed decision needs a quote of two words or more: what the human said, not a bare yes',
    );
  }
  const { db } = ctx;
  return transaction(db, () => {
    const item = requireWritableItem(db, input.id);
    assertRelayOn(ctx, item);
    const message = assertSaidInHablar(ctx, input, quote, now());
    if (message !== undefined) assertNotInReview(ctx, item);
    const type = typeOfItem(ctx, item);
    const { workflow } = type;
    const { reason, via, channel } = input;
    const to = relayedState(ctx, item.collection, input.to, input.motive);
    // An item still in its agent's hands has no decision to relay: said first, with what to do.
    assertRelayable(workflow, item, to);
    assertNotDestructive(ctx, item, workflow, to);
    if (message !== undefined) assertMessageUnused(ctx, item, message);
    // On a board the engine says first: an approval whose parts are not finished.
    const note = assertMoveHandsOff(ctx, item, to, RELAYED_HUMAN, {
      ...(reason === undefined ? {} : { reason }),
      via: 'relay',
    });
    authorizeRelay(workflow, item.state, to, reason);
    assertCanLeave(type, item.state, to, item.fields);
    const at = now();
    assertMayEnter(ctx, item, workflow, to, at);
    assertNotOwnStep(ctx, item, via);
    const board = liveBoardOf(ctx, item.collection) !== undefined;
    const move = { to, actor: RELAYED_HUMAN, at, lease: activeLease(item.lease, at), board };
    const data = {
      ...(reason ? { reason } : {}),
      ...(note ? { note } : {}),
      channel,
      quote,
      source: 'conversation',
      ...(message === undefined ? {} : { message }),
    };
    return landMove(ctx, workflow, item, move, data, { via });
  });
}

// A decision the person gives while they review a step: an approval, a send-back. An item still in
// its agent's hands has none to relay, and "Cannot move from X to X" said nothing of why (P8-F5).
function assertRelayable(workflow: Workflow, item: ItemRecord, to: string): void {
  if (transitionsBetween(workflow, item.state, to).length > 0) return;
  const position = positionOf(item.state);
  if (isClosed(position) || position.phase !== 'doing') return;
  const at = stateLabel(workflow, item.state);
  // A drop with motives is several states with one name.
  const names = [
    ...new Set(
      relayableMoves(workflow, item.state).map(({ to: target }) => stateLabel(workflow, target)),
    ),
  ];
  const only =
    names.length === 0
      ? 'nothing can be relayed on it now'
      : `a relay can only move it to ${names.join(', ')} now`;
  throw new OteaError(
    'invalid_transition',
    `Not relayed: ${item.id} is not in review, it is at ${at}, where its agent works: a send-back or an approval is relayed only while the person reviews it. It reaches review when its agent hands it off (otea handoff ${item.id}); until then ${only}.`,
    { kind: 'move', why: 'no_move', from: item.state, to },
  );
}

// A board may turn relay off, because Otea cannot check that the person said what the agent quotes.
function assertRelayOn(ctx: Context, item: ItemRecord): void {
  if (relayAllowed(ctx, item.collection)) return;
  const board = liveBoardOf(ctx, item.collection)?.def.name ?? item.collection;
  throw new OteaError(
    'forbidden',
    `Not relayed: ${board} does not take decisions relayed through an agent, so the person decides ${item.id} themselves on the desk. Ask them with otea ask ${item.id} "<your question>" and wait for them; never record their decision for them.`,
  );
}

// A move the agent made itself, not one it relayed (a relayed move is the human's).
function movedBy(event: EventRecord, agent: string): boolean {
  const { type, actor } = event;
  return type === 'transitioned' && actor.kind === 'agent' && actor.name === agent;
}

// The step `agent` did itself in the round the item is in. On a board: one of the agents that did
// the step in its current round (next.ts roundWorkersOf). Off a board: the state it left with the move
// that brought the item where it is.
function ownStep(ctx: Context, item: ItemRecord, agent: string): string | undefined {
  const events = selectEvents(ctx.db, item.id);
  const board = liveBoardOf(ctx, item.collection);
  if (!board) {
    const last = events.findLast(({ type }) => type === 'transitioned');
    return last && movedBy(last, agent) ? String(last.data.from) : undefined;
  }
  const position = positionOf(item.state);
  if (isClosed(position) || !roundWorkersOf(ctx, item, board.def).includes(agent)) return undefined;
  return stepById(board.def, position.step)?.name ?? position.step;
}

// An agent relays the human's decisions, never one on its own work: the human makes that one in
// the web UI, where nobody speaks for them.
function assertNotOwnStep(ctx: Context, item: ItemRecord, via: string): void {
  const step = ownStep(ctx, item, via);
  if (step === undefined) return;
  throw new OteaError(
    'forbidden',
    `Not relayed: ${via} did ${step} on ${item.id} in this round, so it may not relay the decision on its own work; the person makes it in the web UI.`,
    { kind: 'own_step', item: item.id, step, who: via },
  );
}
