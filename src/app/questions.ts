import type { Channel } from '../core/authority.ts';
import { isClosed, positionOf } from '../core/board/engine.ts';
import { stepById } from '../core/board/model.ts';
import { NOTE_LEFT } from '../core/board/notes.ts';
import {
  askedText,
  chatAnswerText,
  checkOptions,
  DELEGATED,
  type ItemQuestion,
  QUESTION_ANSWERED,
  QUESTION_ASKED,
  questionsOf,
  waitAnswerText,
} from '../core/board/questions.ts';
import { OteaError } from '../core/errors.ts';
import type { Actor } from '../core/item.ts';
import { activeLease, DEFAULT_LEASE_TTL_MS } from '../core/lease.ts';
import { transaction } from '../store/database.ts';
import {
  appendEvent,
  type ItemRecord,
  selectEvents,
  selectEventsOfTypes,
  selectRelationsOf,
  selectStateEntries,
} from '../store/queries.ts';
import { askingItems } from './asking.ts';
import type { Context } from './context.ts';
import { traceAnswer } from './conversation.ts';
import { requireItem, requireWritableItem, systemClock } from './items.ts';
import { assertMayWriteItem, takeItem } from './lease-take.ts';
import { itemOnBoard, type LiveBoard, liveBoardOf, relayAllowed } from './next.ts';
import { sessionAlive } from './presence.ts';
import { assertSaidInHablar, RELAYED_HUMAN } from './relay.ts';
import { secretaryName } from './secretary.ts';
import { liftSetAside, SET_ASIDE_LIFTED } from './set-aside.ts';

// An agent's question to the person (core/board/questions.ts): the agent asks while it does a step,
// and the turn is the person's until they answer; the answer hands it back to the agent in the same
// round. Neither moves the item. The person's notes (notes.ts) are another thread, which changes
// no turn: an agent's doubts go here.

type Why =
  | 'not_agent'
  | 'not_person'
  | 'empty'
  | 'too_long'
  | 'not_working'
  | 'asking'
  | 'none_open'
  | 'options'
  | 'option_text'
  | 'no_option'
  | 'not_asker'
  | 'stale';

function refuse(
  code: 'forbidden' | 'reason_required' | 'invalid_transition' | 'invalid_fields',
  id: string,
  why: Why,
  message: string,
): never {
  throw new OteaError(code, message, { kind: 'question', item: id, why });
}

// `options`: 2 to 4 short answers the person picks with one tap; `recommended`: the number (from 1)
// of the one the agent would choose.
export type AskInput = {
  id: string;
  text: string;
  options?: readonly string[];
  recommended?: number;
  // The numbers (from 1) of the options that need the person's own words (ask --option-text).
  optionText?: readonly number[];
  actor: Actor;
  channel: Channel;
};

export type AskResult = { question: ItemQuestion; text: string };

// A question is read by the person, the secretary and the next agent: a few lines, never a wall.
export const MAX_QUESTION_CHARS = 2000;

// The board and the step an agent is doing on the item, or the refusal of a question on it.
function doing(ctx: Context, item: ItemRecord): { board: LiveBoard; step: string } {
  const board = liveBoardOf(ctx, item.collection);
  const position = positionOf(item.state);
  const step =
    board && !isClosed(position) && position.phase === 'doing'
      ? stepById(board.def, position.step)
      : undefined;
  if (!board || !step || step.doer === 'you')
    refuse(
      'invalid_transition',
      item.id,
      'not_working',
      `Not asked on ${item.id}: ask only while you do a step on a board`,
    );
  return { board, step: step.id };
}

// The options marked as needing the person's own words: numbers of options that exist, once each.
export function checkedOptionText(
  given: readonly number[] | undefined,
  count: number,
  id: string,
): number[] {
  const numbers = [...new Set(given ?? [])].sort((a, b) => a - b);
  for (const number of numbers) {
    if (!Number.isInteger(number) || number < 1 || number > count) {
      refuse(
        'invalid_fields',
        id,
        'option_text',
        `Not asked on ${id}: --option-text ${number} names no option (${count} given, numbered from 1)`,
      );
    }
  }
  return numbers;
}

// The agent doing the item's step asks the person: one question at a time, while no other agent
// holds the item. The question keeps the step and round it was asked in.
export function askQuestion(ctx: Context, input: AskInput, now = systemClock): AskResult {
  const { id } = input;
  if (input.actor.kind !== 'agent')
    refuse('forbidden', id, 'not_agent', `Not asked: only an agent asks the person on ${id}`);
  const text = input.text.trim();
  if (text === '') refuse('reason_required', id, 'empty', `Not asked on ${id}: say your question`);
  if (text.length > MAX_QUESTION_CHARS)
    refuse(
      'invalid_fields',
      id,
      'too_long',
      `Not asked on ${id}: ${MAX_QUESTION_CHARS} characters at most, the question first; the rest goes on the item`,
    );
  const checked = checkOptions(input.options, input.recommended);
  if ('problem' in checked)
    refuse('invalid_fields', id, 'options', `Not asked on ${id}: ${checked.problem}`);
  const optionText = checkedOptionText(input.optionText, checked.options.length, id);
  return transaction(ctx.db, () => {
    const item = requireWritableItem(ctx.db, id);
    const at = now();
    assertMayWriteItem(ctx, item, input.actor, at);
    const { board, step } = doing(ctx, item);
    const on = itemOnBoard(ctx, item, board.def);
    if (on.asking)
      refuse(
        'invalid_transition',
        item.id,
        'asking',
        `Not asked on ${item.id}: a question already waits for the person ("${on.asking.text}")`,
      );
    const question = Math.max(0, ...on.questions.map(({ question: n }) => n)) + 1;
    appendEvent(ctx.db, {
      itemId: item.id,
      type: QUESTION_ASKED,
      actor: input.actor,
      at,
      data: {
        question,
        text,
        step,
        stepName: stepById(board.def, step)?.name ?? step,
        round: on.round,
        channel: input.channel,
        ...(checked.options.length === 0
          ? {}
          : {
              options: checked.options,
              ...(checked.recommended === undefined ? {} : { recommended: checked.recommended }),
              ...(optionText.length === 0 ? {} : { optionText }),
            }),
      },
    });
    const asked = questionsOf(selectEvents(ctx.db, item.id)).find(
      (each) => each.question === question,
    );
    if (!asked) throw new Error(`question ${question} on ${item.id} was not kept`);
    return { question: asked, text: askedText(item.id) };
  });
}

export type AnswerInput = { id: string; text: string; actor: Actor; channel: Channel };

// What the person gives: their own words, the number (from 1) of one of the question's options, or
// the decision left to the agent. Exactly one. `question`: the number of the question it answers;
// the desk always says it, so a tap made on a question that has since changed is refused rather
// than recorded on the new one.
export type PersonAnswer = { id: string; actor: Actor; channel: Channel; question?: number } & (
  | { text: string; option?: never; delegate?: never }
  | { option: number; text?: never; delegate?: never }
  | { delegate: true; text?: never; option?: never }
);

// The person answers the question that waits: the turn goes back to the agent, in the same round.
export function answerQuestion(ctx: Context, input: PersonAnswer, now = systemClock): ItemQuestion {
  const { id } = input;
  if (input.actor.kind !== 'human')
    refuse('forbidden', id, 'not_person', `Not answered: the person answers questions on ${id}`);
  const base = {
    id,
    actor: input.actor,
    channel: input.channel,
    ...(input.question === undefined ? {} : { question: input.question }),
  };
  const answered = answeredQuestion(ctx, input, base, now);
  // What they chose stays in the conversation, where they will look for it.
  const { answer } = answered;
  if (answer)
    traceAnswer(
      ctx,
      {
        about: id,
        asked: answered.text,
        text: answer.text,
        mode: answer.mode,
        option: answer.option,
        by: input.actor.name,
      },
      now,
    );
  return answered;
}

function answeredQuestion(
  ctx: Context,
  input: PersonAnswer,
  base: Omit<AnswerInput, 'text'> & { question?: number },
  now: () => string,
): ItemQuestion {
  const { id } = input;
  if (input.delegate)
    return recordAnswer(ctx, { ...base, text: DELEGATED }, {}, now, () => ({
      text: DELEGATED,
      data: { mode: 'delegated' },
    })).question;
  if (input.option !== undefined) {
    const { option } = input;
    return recordAnswer(ctx, { ...base, text: '' }, {}, now, (open) => {
      const text = open.options?.[option - 1];
      if (text === undefined)
        refuse(
          'invalid_fields',
          id,
          'no_option',
          `Not answered on ${id}: the question has no option ${option}`,
        );
      return { text, data: { mode: 'option', option } };
    }).question;
  }
  const text = (input.text ?? '').trim();
  if (text === '') refuse('reason_required', id, 'empty', `Not answered on ${id}: say your answer`);
  return recordAnswer(ctx, { ...base, text }, {}, now, () => ({ text, data: { mode: 'text' } }))
    .question;
}

// The option a relayed answer says: its exact words, or its number, on a question with options.
function optionSaid(open: ItemQuestion, text: string): number | undefined {
  const options = open.options ?? [];
  const byWords = options.indexOf(text);
  if (byWords >= 0) return byWords + 1;
  const number = /^\d+$/.test(text) ? Number(text) : undefined;
  return number !== undefined && number >= 1 && number <= options.length ? number : undefined;
}

export type ChatAnswerResult = { question: ItemQuestion; text: string };

// The answer the person gave in the chat instead of in Otea, put on the question by an agent (otea
// answer, P4-R2-2): it is the person's, as a relayed decision is, marked as noted by that agent,
// and hands the turn back as an answer given in Otea does. Only the agent that asked notes it (the
// person is in its chat), or the secretary with the person's own message from Talk: any other agent
// would be answering in the person's name (D-816632).
export function noteChatAnswer(
  ctx: Context,
  input: AnswerInput & { fromMessage?: number },
  now = systemClock,
): ChatAnswerResult {
  const { id, actor } = input;
  if (actor.kind !== 'agent')
    refuse(
      'forbidden',
      id,
      'not_agent',
      `Not noted: the person answers on the item page; an agent notes an answer they gave in the chat`,
    );
  const text = input.text.trim();
  if (text === '')
    refuse('reason_required', id, 'empty', `Not noted on ${id}: give the person's words`);
  // Otea cannot check the person said it, so a board may turn the relay of their words off.
  const collection = requireItem(ctx.db, id).collection;
  if (!relayAllowed(ctx, collection))
    throw new OteaError(
      'forbidden',
      `Not noted: ${liveBoardOf(ctx, collection)?.def.name ?? collection} does not take answers noted through an agent, so the person answers ${id} themselves on the desk. Ask them with otea ask ${id} "<your question>" and wait for them; never record their answer for them.`,
    );
  const data = { via: actor.name, source: 'conversation' };
  // What they said matches one of the options: it is that option, as if they had tapped it.
  const { question, gone } = recordAnswer(
    ctx,
    { ...input, text, actor: RELAYED_HUMAN },
    data,
    now,
    (open) => {
      if (open.by !== actor.name) {
        if (secretaryName(ctx.db) !== actor.name)
          refuse(
            'forbidden',
            id,
            'not_asker',
            `Not noted on ${id}: only ${open.by}, who asked it, notes what the person said in its chat; they answer it on the desk or the phone, or tell the secretary in Talk. Never answer for the person.`,
          );
        // The secretary notes only words the person wrote in Talk, as a relay does.
        const from = input.fromMessage === undefined ? {} : { fromMessage: input.fromMessage };
        assertSaidInHablar(ctx, { id, via: actor.name, ...from }, text, now());
      }
      const option = optionSaid(open, text);
      return option === undefined
        ? { text, data: { mode: 'text' } }
        : { text: open.options?.[option - 1] ?? text, data: { mode: 'option', option } };
    },
  );
  const asker = question.by === actor.name ? undefined : { name: question.by, gone };
  return { question, text: chatAnswerText(id, asker) };
}

// The question answered, and whether the session of the agent that asked it ended (`gone`).
function recordAnswer(
  ctx: Context,
  input: AnswerInput & { question?: number },
  extra: Record<string, string>,
  now: () => string,
  // The words and the way it was answered (option, text, delegated), read off the question that
  // waits.
  resolve: (open: ItemQuestion) => { text: string; data: Record<string, string | number> },
): { question: ItemQuestion; gone: boolean } {
  const { id } = input;
  return transaction(ctx.db, () => {
    const item = requireWritableItem(ctx.db, id);
    const board = liveBoardOf(ctx, item.collection);
    const open = board ? itemOnBoard(ctx, item, board.def).asking : undefined;
    if (!open)
      refuse(
        'invalid_transition',
        item.id,
        'none_open',
        `${item.id}: no question waits for ${extra.via ? 'the person' : 'you'}`,
      );
    // The desk answers the question it showed: a tap on one that has since been answered and
    // asked again is not an answer to the new one.
    if (input.question !== undefined && input.question !== open.question)
      refuse(
        'invalid_transition',
        item.id,
        'stale',
        `${item.id}: question ${input.question} is no longer the one that waits (it is question ${open.question}): read it again`,
      );
    const chosen = resolve(open);
    appendEvent(ctx.db, {
      itemId: item.id,
      type: QUESTION_ANSWERED,
      actor: input.actor,
      at: now(),
      data: {
        question: open.question,
        text: chosen.text,
        channel: input.channel,
        ...extra,
        ...chosen.data,
      },
    });
    const answered = questionsOf(selectEvents(ctx.db, item.id)).find(
      (each) => each.question === open.question,
    );
    if (!answered) throw new Error(`question ${open.question} on ${item.id} was not kept`);
    // The person's answer takes up an item set aside for later (P7-R3-1).
    const cause = 'answer' as const;
    liftSetAside(ctx.db, { id: item.id, actor: input.actor, at: now(), cause }, extra);
    // The answer goes back to the agent that asked: its lease, run out while the person thought,
    // is taken again for it, unless another agent holds the item now, or its session is no longer
    // alive (P7-R3-11): then the item waits for whichever agent claims it (P3C-R3-11).
    const at = now();
    const lease = activeLease(item.lease, at);
    // The agent that asked, noting the answer from its own chat, is at work this moment.
    const gone = extra.via !== open.by && !sessionAlive(ctx.db, open.by, () => at);
    // A lease it still holds with less than a third of a default lease left is renewed too: the
    // answer comes back to it, and a lease that ends right after the tap would turn the item
    // «atascado» while it picks it up. One with more left is left alone (no write per answer).
    const renew =
      lease?.holder === open.by &&
      Date.parse(lease.expiresAt) - Date.parse(at) < DEFAULT_LEASE_TTL_MS / 3;
    if ((!lease || renew) && !gone) takeItem(ctx.db, item, { kind: 'agent', name: open.by }, at);
    return { question: answered, gone };
  });
}

export type AnswerWaiting = { item: string; question: number; text: string };

// An answer this agent has not acted on yet: to a question it asked in the round of the step still
// being done, with nothing done by it on the item since. otea wait stops on it.
export function answerWaiting(ctx: Context, agent: string): AnswerWaiting | undefined {
  const asked = new Set(
    selectEventsOfTypes(ctx.db, [QUESTION_ASKED])
      .filter(({ actor }) => actor.kind === 'agent' && actor.name === agent)
      .map(({ itemId }) => itemId),
  );
  for (const id of asked) {
    const item = requireItem(ctx.db, id);
    const board = liveBoardOf(ctx, item.collection);
    const position = positionOf(item.state);
    if (!board || isClosed(position) || position.phase !== 'doing') continue;
    const on = itemOnBoard(ctx, item, board.def);
    const answered = on.roundQuestions.findLast((q) => q.by === agent && q.answer);
    const at = answered?.answer?.at;
    // An answer it noted from the chat itself is one it knows.
    if (!answered || at === undefined || answered.answer?.via === agent) continue;
    const acted = selectEvents(ctx.db, item.id).some(
      (event) => event.at > at && event.actor.kind === 'agent' && event.actor.name === agent,
    );
    if (!acted)
      return { item: item.id, question: answered.question, text: waitAnswerText(item.id) };
  }
  return undefined;
}

// The items where a question this agent asked still waits for the person, oldest first. While one
// does, otea wait keeps the agent on its answer: other free work would wake it only for it to end
// its turn there, and the answer would go unread.
export function askedByAgent(ctx: Context, agent: string): string[] {
  return [...askingItems(ctx.db)]
    .filter(([, open]) => open.by === agent)
    .sort(([, a], [, b]) => a.at.localeCompare(b.at))
    .map(([id]) => id);
}

// While a question this agent asked waits for the person, the agent work that still wakes its wait
// (P4-R2-1): an item sent back that it worked on, and work that reached its state after it first
// asked. Work already free when it asked does not: it would wake the agent at once, only for it to
// end its turn there with the answer unread. Undefined while no question of its waits.
export function wakesWhileAsking(
  ctx: Context,
  agent: string,
): ((item: { id: string; createdAt: string }) => boolean) | undefined {
  const asking = askingItems(ctx.db);
  const asked = [...asking.values()]
    .filter((open) => open.by === agent)
    .map(({ at }) => at)
    .sort()[0];
  if (asked === undefined) return undefined;
  const entered = selectStateEntries(ctx.db);
  return (item) => {
    // An item a question waits on is the person's until they answer it.
    if (asking.has(item.id)) return false;
    if ((entered.get(item.id) ?? item.createdAt) > asked) return true;
    const record = requireItem(ctx.db, item.id);
    const events = selectEvents(ctx.db, item.id);
    const mine = ({ actor }: { actor: Actor }) => actor.kind === 'agent' && actor.name === agent;
    // What happened since it asked, while it did nothing on the item after it (P7-R3-9): the
    // person took the item up (a note, Retomar, any act of theirs that lifted a set-aside), or,
    // on an item it holds, the parts or blockers it waited for closed: its work again.
    const since = (at: string | undefined) =>
      at !== undefined && at > asked && !events.some((event) => event.at > at && mine(event));
    if (since(events.findLast(tookUp)?.at)) return true;
    if (record.lease?.holder === agent && since(waitsClosedAt(ctx, item.id))) return true;
    const board = liveBoardOf(ctx, record.collection);
    if (!board || itemOnBoard(ctx, record, board.def).sentBack === undefined) return false;
    return events.some(mine);
  };
}

// The person's own acts that take an item up: a note, or what lifted a set-aside (P7-R3-9).
function tookUp({ type, actor }: { type: string; actor: Actor }): boolean {
  return actor.kind === 'human' && (type === NOTE_LEFT || type === SET_ASIDE_LIFTED);
}

// When the last of the item's parts and blockers closed, while every one of them is closed;
// undefined while one is open or it has none.
function waitsClosedAt(ctx: Context, id: string): string | undefined {
  let last: string | undefined;
  for (const relation of selectRelationsOf(ctx.db, id)) {
    if (relation.to !== id || (relation.kind !== 'parent' && relation.kind !== 'blocks')) continue;
    const other = requireItem(ctx.db, relation.from);
    if (!isClosed(positionOf(other.state))) return undefined;
    const closed = selectEvents(ctx.db, other.id).findLast(({ type }) => type === 'transitioned');
    if (closed && (last === undefined || closed.at > last)) last = closed.at;
  }
  return last;
}
