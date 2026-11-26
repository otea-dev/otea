import { describe, expect, it } from 'vitest';
import { sequenceIds } from '../core/board/ids.ts';
import { creatures } from '../core/board/testing.ts';
import { OteaError } from '../core/errors.ts';
import { selectMessages, selectPending } from '../store/conversation.ts';
import { insertEvidence, selectEvents } from '../store/queries.ts';
import { askingItem } from './asking.ts';
import { createBoard, publishBoard, saveDraft } from './boards.ts';
import type { Context } from './context.ts';
import { createItem, getItem, listItems, moveItem, showItem } from './items.ts';
import { claimItem, releaseItem } from './leases.ts';
import {
  approveItem,
  handoffItem,
  itemNextText,
  itemOnBoard,
  liveBoardOf,
  nextFor,
} from './next.ts';
import { endProcess, endWaiter, seeAgent, waitBeat } from './presence.ts';
import { answerQuestion, answerWaiting, askQuestion, noteChatAnswer } from './questions.ts';
import { restartItem } from './restart.ts';
import { memoryContext } from './testing.ts';
import { undoMove } from './undo.ts';

const you = { kind: 'human' as const, name: 'fede' };
const kiln = { kind: 'agent' as const, name: 'kiln' };
const scout = { kind: 'agent' as const, name: 'scout' };

let tick = 0;
const now = () => new Date(Date.UTC(2026, 10, 13, 13, 0, tick++)).toISOString();

function refusal(run: () => unknown): OteaError {
  try {
    run();
  } catch (error) {
    if (error instanceof OteaError) return error;
    throw error;
  }
  throw new Error('not refused');
}

// A creature kiln claimed in Concepto, on a published board.
function working(ctx: Context) {
  const def = creatures();
  const record = createBoard(ctx, { name: def.name, lang: 'es' }, now, sequenceIds());
  saveDraft(ctx, record.id, { definition: def, baseVersion: null }, now);
  publishBoard(ctx, record.id, { moves: {}, by: you }, now);
  const item = createItem(
    ctx,
    { collection: 'Criaturas', title: 'Tortuga', fields: { fdesc: 'Lenta' }, actor: you },
    now,
  );
  claimItem(ctx, { id: item.id, actor: kiln }, now);
  return item;
}

// The Arte conceptual Concepto asks for, so kiln may hand it off.
function attach(ctx: Context, id: string) {
  insertEvidence(ctx.db, {
    itemId: id,
    role: 'after',
    module: 'eart',
    kind: 'image',
    filename: 'a.png',
    contentType: 'image/png',
    size: 1,
    sha256: 'a'.repeat(64),
    caption: null,
    createdAt: now(),
    actor: kiln,
    channel: 'cli',
  });
}

const ask = (ctx: Context, id: string, text = '¿Caparazón liso o con musgo?') =>
  askQuestion(ctx, { id, text, actor: kiln, channel: 'cli' }, now);

// kiln waits in otea wait (this test's process stands for it): its session is alive.
const waits = (ctx: Context) =>
  waitBeat(ctx.db, { agent: 'kiln', channel: 'cli', waiter: process.pid }, now).run();

describe('an agent asks the person', () => {
  it('hands the turn to the person and moves nothing: step, round and lease stay', () => {
    const ctx = memoryContext();
    const item = working(ctx);
    const before = getItem(ctx, item.id, now);

    const asked = ask(ctx, item.id);

    expect(asked.question).toMatchObject({
      question: 1,
      text: '¿Caparazón liso o con musgo?',
      by: 'kiln',
      step: 'sconcept',
      stepName: 'Concepto',
      round: 1,
    });
    expect(asked.text).toContain('the turn is theirs until they answer');
    const after = getItem(ctx, item.id, now);
    expect(after.state).toBe(before.state);
    expect(after.lease?.holder).toBe('kiln');
    expect(after.turn).toBe('human');
    expect(after.asks).toEqual({
      question: 1,
      by: 'kiln',
      text: '¿Caparazón liso o con musgo?',
      at: asked.question.at,
    });
    expect(listItems(ctx, { turn: 'human' }).map(({ id }) => id)).toEqual([item.id]);
    expect(listItems(ctx, { turn: 'agent' })).toEqual([]);
    expect(selectEvents(ctx.db, item.id).at(-1)).toMatchObject({
      type: 'question_asked',
      actor: kiln,
      data: { question: 1, step: 'sconcept', round: 1, channel: 'cli' },
    });
  });

  it('is the agent’s alone, with words, on a step an agent is doing, one question at a time', () => {
    const ctx = memoryContext();
    const item = working(ctx);
    const by =
      (actor: typeof you | typeof kiln, text = '¿A?') =>
      () =>
        askQuestion(ctx, { id: item.id, text, actor, channel: 'ui' }, now);
    expect(refusal(by(you)).code).toBe('forbidden');
    expect(refusal(by(kiln, '  ')).code).toBe('reason_required');
    expect(refusal(by(scout)).code).toBe('lease_held');
    ask(ctx, item.id);
    expect(refusal(by(kiln)).message).toContain('already waits for the person');
  });

  it('is refused off a step an agent is doing', () => {
    const ctx = memoryContext();
    const item = working(ctx);
    attach(ctx, item.id);
    handoffItem(ctx, { id: item.id, actor: kiln, channel: 'cli' }, now);
    const error = refusal(() => ask(ctx, item.id));
    expect(error.code).toBe('invalid_transition');
    expect(error.message).toContain('ask only while you do a step');
  });

  it('keeps the agent from handing off and other agents off the item until answered', () => {
    const ctx = memoryContext();
    const item = working(ctx);
    attach(ctx, item.id);
    ask(ctx, item.id);
    const error = refusal(() =>
      handoffItem(ctx, { id: item.id, actor: kiln, channel: 'cli' }, now),
    );
    expect(error.code).toBe('invalid_transition');
    expect(error.message).toContain('waits for their answer');
    // P4-R2-2: an answer given in the chat goes on the question, in their words.
    expect(error.message).toContain(
      `if they answered in the chat, put their words on it: otea answer ${item.id} "<their words>"`,
    );
    expect(nextFor(ctx, 'scout', {}, now).item).toBeNull();
    expect(itemNextText(ctx, getItem(ctx, item.id, now), 'kiln', now)).toContain(
      'Waiting for the person to answer your question: "¿Caparazón liso o con musgo?"',
    );
  });
});

describe('the person answers', () => {
  it('leaves what they chose in the conversation, read at once, waking nobody', () => {
    const ctx = memoryContext();
    const item = working(ctx);
    askQuestion(
      ctx,
      {
        id: item.id,
        text: '¿Caparazón liso o con musgo?',
        options: ['Liso', 'Con musgo'],
        recommended: 2,
        actor: kiln,
        channel: 'cli',
      },
      now,
    );

    answerQuestion(ctx, { id: item.id, option: 2, actor: you, channel: 'ui' }, now);

    expect(selectMessages(ctx.db, { limit: 10 }).messages).toEqual([
      expect.objectContaining({
        author: 'person',
        text: 'Con musgo',
        delivery: 'read',
        choice: {
          mode: 'option',
          option: 2,
          about: item.id,
          asked: '¿Caparazón liso o con musgo?',
        },
      }),
    ]);
    expect(selectPending(ctx.db)).toEqual([]);
  });

  it('gives the answer back to the agent that asked, waiting, though its lease ran out meanwhile', () => {
    const ctx = memoryContext();
    const item = working(ctx);
    ask(ctx, item.id);
    tick += 20 * 60;
    expect(refusal(() => claimItem(ctx, { id: item.id, actor: scout }, now)).message).toBe(
      `${item.id} waits for the person to answer kiln's question; claim only what is yours (otea next)`,
    );
    waits(ctx);

    answerQuestion(ctx, { id: item.id, text: 'Con musgo', actor: you, channel: 'ui' }, now);

    expect(getItem(ctx, item.id, now).lease?.holder).toBe('kiln');
    expect(nextFor(ctx, 'scout', {}, now).item).toBeNull();
    expect(nextFor(ctx, 'kiln', {}, now).item).toBe(item.id);
  });

  it('keeps the item for the agent that asked, waiting, while it has not read the answer, though its lease ran out', () => {
    const ctx = memoryContext();
    const item = working(ctx);
    ask(ctx, item.id);
    answerQuestion(ctx, { id: item.id, text: 'Con musgo', actor: you, channel: 'ui' }, now);
    tick += 20 * 60;
    waits(ctx);

    expect(nextFor(ctx, 'scout', {}, now).item).toBeNull();
    expect(refusal(() => claimItem(ctx, { id: item.id, actor: scout }, now)).message).toBe(
      `${item.id} waits for kiln to read the person's answer to its question; claim only what is yours (otea next)`,
    );
    expect(nextFor(ctx, 'kiln', {}, now).item).toBe(item.id);
    claimItem(ctx, { id: item.id, actor: kiln }, now);
  });

  it('frees an answered item for any agent once the person puts it back in the queue', () => {
    const ctx = memoryContext();
    const item = working(ctx);
    ask(ctx, item.id);
    answerQuestion(ctx, { id: item.id, text: 'Con musgo', actor: you, channel: 'ui' }, now);
    tick += 20 * 60;

    restartItem(ctx, { id: item.id, actor: you, channel: 'ui' }, now);

    expect(nextFor(ctx, 'scout', {}, now).item).toBe(item.id);
  });

  it('gives the turn back to the agent in the same round, which reads the answer', () => {
    const ctx = memoryContext();
    const item = working(ctx);
    attach(ctx, item.id);
    ask(ctx, item.id);
    expect(answerWaiting(ctx, 'kiln')).toBeUndefined();

    const answered = answerQuestion(
      ctx,
      { id: item.id, text: 'Con musgo', actor: you, channel: 'ui' },
      now,
    );

    expect(answered.answer).toMatchObject({ text: 'Con musgo', by: 'fede' });
    const after = getItem(ctx, item.id, now);
    expect(after.turn).toBe('agent');
    expect(after.asks).toBeUndefined();
    expect(after.lease?.holder).toBe('kiln');
    const text = itemNextText(ctx, after, 'kiln', now) ?? '';
    expect(text).toContain('Concepto, round 1');
    expect(text).toContain('You asked the person: "¿Caparazón liso o con musgo?"');
    expect(text).toContain('The person answered: "Con musgo"');
    expect(showItem(ctx, item.id, { actor: kiln, channel: 'cli' }, now).board?.questions).toEqual([
      expect.objectContaining({
        question: 1,
        answer: expect.objectContaining({ text: 'Con musgo' }),
      }),
    ]);
    expect(answerWaiting(ctx, 'kiln')).toEqual({
      item: item.id,
      question: 1,
      text: `${item.id}: the person answered your question. Read it: otea show ${item.id}`,
    });
    expect(answerWaiting(ctx, 'scout')).toBeUndefined();
    handoffItem(ctx, { id: item.id, actor: kiln, channel: 'cli' }, now);
    expect(answerWaiting(ctx, 'kiln')).toBeUndefined();
  });

  // P4-R2-2: the person answered in the chat; otea reply failed twice and the agent asked them to
  // paste the answer into Otea.
  it('in the chat, noted on the question by an agent as theirs', () => {
    const ctx = memoryContext();
    const item = working(ctx);
    attach(ctx, item.id);
    ask(ctx, item.id);
    tick += 20 * 60;

    const noted = noteChatAnswer(
      ctx,
      { id: item.id, text: 'Con musgo', actor: kiln, channel: 'cli' },
      now,
    );

    expect(noted.question.answer).toMatchObject({ text: 'Con musgo', by: 'human', via: 'kiln' });
    expect(noted.text).toContain(`Noted the person's answer on ${item.id}`);
    const after = getItem(ctx, item.id, now);
    expect([after.turn, after.asks, after.lease?.holder]).toEqual(['agent', undefined, 'kiln']);
    const event = selectEvents(ctx.db, item.id).findLast(
      ({ type }) => type === 'question_answered',
    );
    expect(event?.actor).toEqual({ kind: 'human', name: 'human' });
    expect(event?.data).toMatchObject({ via: 'kiln', source: 'conversation', channel: 'cli' });
    expect(itemNextText(ctx, after, 'kiln', now)).toContain('The person answered: "Con musgo"');
    // The agent that noted it knows it already: its wait does not wake on it.
    expect(answerWaiting(ctx, 'kiln')).toBeUndefined();
  });

  // P3C-R3-11: kiln asked, set the item aside for later, and its session ended. scout noted the
  // person's chat answer, and Otea claimed the item for kiln again for 15 minutes: the desk said
  // kiln was doing it, and scout's claim was refused until the person freed it (Liberar). An item
  // whose question waits for the person can no longer be set aside (P7-R3-1): kiln lets go of it.
  describe('once the session of the agent that asked ended', () => {
    const ends = (ctx: Context) => endProcess(ctx.db, process.pid);

    // P7-R3-11: kiln worked at the command line, and its last wait ended on its own (it found
    // work), so nothing of it was left running; 16 minutes after its session ended, the person's
    // answer claimed the item for it: the desk said kiln was doing it, and the next day's session
    // was handed another name.
    it('claims nothing for an agent quiet past the listening window, with nothing of it running', () => {
      const ctx = memoryContext();
      const item = working(ctx);
      waits(ctx);
      ask(ctx, item.id);
      endWaiter(ctx.db, 'kiln', process.pid);
      tick += 16 * 60;

      answerQuestion(ctx, { id: item.id, text: 'Con musgo', actor: you, channel: 'ui' }, now);

      expect(getItem(ctx, item.id, now).lease).toBeNull();
      expect(nextFor(ctx, 'scout', {}, now).item).toBe(item.id);
    });

    it('noted from the chat by another agent, claims the item for nobody: that agent takes it', () => {
      const ctx = memoryContext();
      const item = working(ctx);
      waits(ctx);
      ask(ctx, item.id);
      releaseItem(ctx, { id: item.id, actor: kiln }, now);
      ends(ctx);

      const noted = noteChatAnswer(
        ctx,
        { id: item.id, text: 'Con musgo', actor: scout, channel: 'cli' },
        now,
      );

      expect(getItem(ctx, item.id, now).lease).toBeNull();
      expect(noted.text).toContain(
        `kiln, which asked, is gone (its session ended): claim it to carry on: otea claim ${item.id}`,
      );
      expect(nextFor(ctx, 'scout', {}, now).item).toBe(item.id);
      expect(claimItem(ctx, { id: item.id, actor: scout }, now).lease?.holder).toBe('scout');
    });

    // F2 (field study 3): the person answered a few minutes after the question, with the asker's
    // lease about to run out, and the card turned «atascado» in red right after the tap, while the
    // asker was about to pick the answer up.
    it('answered while its lease is about to run out, gives it a lease to pick the answer up with', () => {
      const ctx = memoryContext();
      const item = working(ctx);
      waits(ctx);
      ask(ctx, item.id);
      tick += 14 * 60;
      // It called Otea a moment ago (a step with no lease renewal of its own): its session is there.
      seeAgent(ctx.db, { agent: 'kiln', channel: 'cli', call: true }, now);

      answerQuestion(ctx, { id: item.id, text: 'Con musgo', actor: you, channel: 'ui' }, now);
      tick += 3 * 60;

      const after = getItem(ctx, item.id, now);
      expect(after.lease?.holder).toBe('kiln');
      expect(after.expiredLease).toBeUndefined();
    });

    it('answered with plenty of its lease left, writes no new lease', () => {
      const ctx = memoryContext();
      const item = working(ctx);
      ask(ctx, item.id);
      const before = getItem(ctx, item.id, now).lease;
      tick += 2 * 60;
      seeAgent(ctx.db, { agent: 'kiln', channel: 'cli', call: true }, now);

      answerQuestion(ctx, { id: item.id, text: 'Con musgo', actor: you, channel: 'ui' }, now);

      expect(getItem(ctx, item.id, now).lease?.expiresAt).toBe(before?.expiresAt);
    });

    it('answered in Otea, leaves it to whichever agent claims it', () => {
      const ctx = memoryContext();
      const item = working(ctx);
      waits(ctx);
      ask(ctx, item.id);
      tick += 20 * 60;
      ends(ctx);

      answerQuestion(ctx, { id: item.id, text: 'Con musgo', actor: you, channel: 'ui' }, now);

      expect(getItem(ctx, item.id, now).lease).toBeNull();
      expect(nextFor(ctx, 'scout', {}, now).item).toBe(item.id);
    });

    it('while its session runs, still gives it back to it', () => {
      const ctx = memoryContext();
      const item = working(ctx);
      waits(ctx);
      ask(ctx, item.id);
      releaseItem(ctx, { id: item.id, actor: kiln }, now);

      noteChatAnswer(ctx, { id: item.id, text: 'Con musgo', actor: scout, channel: 'cli' }, now);

      expect(getItem(ctx, item.id, now).lease?.holder).toBe('kiln');
    });
  });

  it('noted from the chat only by an agent, with the person’s words, while a question waits', () => {
    const ctx = memoryContext();
    const item = working(ctx);
    const note =
      (actor: typeof you | typeof kiln, text = 'Sí') =>
      () =>
        noteChatAnswer(ctx, { id: item.id, text, actor, channel: 'cli' }, now);
    expect(refusal(note(kiln)).message).toContain('no question waits');
    ask(ctx, item.id);
    expect(refusal(note(you)).code).toBe('forbidden');
    expect(refusal(note(kiln, ' ')).code).toBe('reason_required');
  });

  it('is the person’s alone, with words, and only while a question waits', () => {
    const ctx = memoryContext();
    const item = working(ctx);
    const answer =
      (actor: typeof you | typeof kiln, text = 'Sí') =>
      () =>
        answerQuestion(ctx, { id: item.id, text, actor, channel: 'ui' }, now);
    expect(refusal(answer(you)).message).toContain('no question waits');
    ask(ctx, item.id);
    expect(refusal(answer(kiln)).code).toBe('forbidden');
    expect(refusal(answer(you, ' ')).code).toBe('reason_required');
    answer(you)();
    expect(refusal(answer(you)).message).toContain('no question waits');
  });
});

describe('a question after a move the person took back', () => {
  it('still waits, and the person answers it', () => {
    const ctx = memoryContext();
    const item = working(ctx);
    ask(ctx, item.id);
    const before = getItem(ctx, item.id, now).state;
    moveItem(ctx, { id: item.id, to: 'dropped', actor: you, channel: 'ui', reason: 'no' }, now);
    undoMove(ctx, { id: item.id, from: before, actor: you, channel: 'ui' }, now);

    answerQuestion(ctx, { id: item.id, text: 'Con musgo', actor: you, channel: 'ui' }, now);

    expect(askingItem(ctx.db, item.id)).toBeUndefined();
    expect(getItem(ctx, item.id, now).state).toBe(before);
  });

  it('forgets a question asked inside the round the person took back', () => {
    const ctx = memoryContext();
    const item = working(ctx);
    attach(ctx, item.id);
    handoffItem(ctx, { id: item.id, actor: kiln, channel: 'cli' }, now);
    const review = getItem(ctx, item.id, now).state;
    approveItem(ctx, { id: item.id, actor: you, channel: 'ui' }, now);
    claimItem(ctx, { id: item.id, actor: kiln }, now);
    ask(ctx, item.id, '¿Bucle corto o largo?');
    expect(askingItem(ctx.db, item.id)?.text).toBe('¿Bucle corto o largo?');

    undoMove(ctx, { id: item.id, from: review, actor: you, channel: 'ui' }, now);

    expect(askingItem(ctx.db, item.id)).toBeUndefined();
    approveItem(ctx, { id: item.id, actor: you, channel: 'ui' }, now);
    expect(askingItem(ctx.db, item.id)).toBeUndefined();
    const board = liveBoardOf(ctx, item.collection);
    const on = board && itemOnBoard(ctx, getItem(ctx, item.id), board.def);
    expect(on?.questions).toEqual([]);
  });
});

// A question the agent asks with options to pick with one tap (2 to 4, one maybe recommended).
describe('a question with options', () => {
  const OPTIONS = ['Liso', 'Con musgo', 'Con hongos'];
  const askWith = (ctx: Context, id: string, options?: string[], recommended?: number) =>
    askQuestion(
      ctx,
      {
        id,
        text: '¿Caparazón?',
        ...(options === undefined ? {} : { options }),
        ...(recommended === undefined ? {} : { recommended }),
        actor: kiln,
        channel: 'cli',
      },
      now,
    );
  const refusedWith = (options?: string[], recommended?: number) => {
    const ctx = memoryContext();
    const item = working(ctx);
    const error = refusal(() => askWith(ctx, item.id, options, recommended));
    expect(askingItem(ctx.db, item.id)).toBeUndefined();
    return error;
  };

  it('keeps the options and the recommendation with the question, for the desk to read', () => {
    const ctx = memoryContext();
    const item = working(ctx);

    const asked = askWith(ctx, item.id, ['  Liso ', 'Con musgo'], 2);

    expect(asked.question).toMatchObject({ options: ['Liso', 'Con musgo'], recommended: 2 });
    expect(getItem(ctx, item.id, now).asks).toMatchObject({
      options: ['Liso', 'Con musgo'],
      recommended: 2,
    });
    expect(askingItem(ctx.db, item.id)?.options).toEqual(['Liso', 'Con musgo']);
  });

  it('keeps a question with no options in words only', () => {
    const ctx = memoryContext();
    const item = working(ctx);
    const asked = askWith(ctx, item.id);
    expect(asked.question.options).toBeUndefined();
    expect(getItem(ctx, item.id, now).asks).not.toHaveProperty('options');
  });

  it('refuses a count outside 2 to 4, an empty or long option, a repeat, and a recommendation out of range', () => {
    expect(refusedWith(['Solo uno']).message).toContain('2 to 4 options');
    expect(refusedWith(['a', 'b', 'c', 'd', 'e']).message).toContain('2 to 4 options');
    expect(refusedWith(['a', '  ']).message).toContain('empty');
    expect(refusedWith(['a', 'x'.repeat(121)]).message).toContain('120 characters');
    expect(refusedWith(['Liso', ' liso ']).message).toContain('same');
    expect(refusedWith(['a', 'b'], 3).message).toContain('from 1 to 2');
    expect(refusedWith(['a', 'b'], 0).message).toContain('from 1 to 2');
    expect(refusedWith(undefined, 1).message).toContain('needs options');
    expect(refusedWith(['a', 'b'], 1.5).code).toBe('invalid_fields');
  });

  it('is answered by one tap on an option: its words are the answer, and the agent reads which', () => {
    const ctx = memoryContext();
    const item = working(ctx);
    askWith(ctx, item.id, OPTIONS, 2);

    const answered = answerQuestion(
      ctx,
      { id: item.id, option: 3, actor: you, channel: 'ui' },
      now,
    );

    expect(answered.answer).toMatchObject({ mode: 'option', option: 3, text: 'Con hongos' });
    const text = itemNextText(ctx, getItem(ctx, item.id, now), 'kiln', now) ?? '';
    expect(text).toContain('The person chose option 3: "Con hongos"');
    expect(text).not.toContain('left the decision');
  });

  it('is answered in the person’s own words, which the agent reads as none of its options', () => {
    const ctx = memoryContext();
    const item = working(ctx);
    askWith(ctx, item.id, OPTIONS, 2);

    const answered = answerQuestion(
      ctx,
      { id: item.id, text: 'Pintado a mano', actor: you, channel: 'ui' },
      now,
    );

    expect(answered.answer).toMatchObject({ mode: 'text', text: 'Pintado a mano' });
    expect(itemNextText(ctx, getItem(ctx, item.id, now), 'kiln', now)).toContain(
      'The person answered in their own words: "Pintado a mano"',
    );
  });

  it('is left to the agent, which reads its own recommendation back', () => {
    const ctx = memoryContext();
    const item = working(ctx);
    askWith(ctx, item.id, OPTIONS, 2);

    const answered = answerQuestion(
      ctx,
      { id: item.id, delegate: true, actor: you, channel: 'ui' },
      now,
    );

    expect(answered.answer).toMatchObject({ mode: 'delegated', text: 'delegated' });
    const after = getItem(ctx, item.id, now);
    expect(after.turn).toBe('agent');
    expect(itemNextText(ctx, after, 'kiln', now)).toContain(
      'left the decision to you: go with your recommendation, option 2 "Con musgo"',
    );
  });

  it('is left to an agent that recommended nothing, which reads that it decides', () => {
    const ctx = memoryContext();
    const item = working(ctx);
    askWith(ctx, item.id, OPTIONS);

    answerQuestion(ctx, { id: item.id, delegate: true, actor: you, channel: 'ui' }, now);

    expect(itemNextText(ctx, getItem(ctx, item.id, now), 'kiln', now)).toContain(
      'left the decision to you (you recommended nothing): decide it yourself',
    );
  });

  it('keeps an option to one line: control characters and line breaks become a space', () => {
    const ctx = memoryContext();
    const item = working(ctx);

    const asked = askWith(ctx, item.id, ['Liso\n  - Con musgo', 'Con\u0007 hongos‮'], 1);

    expect(asked.question.options).toEqual(['Liso - Con musgo', 'Con hongos']);
    const text = itemNextText(ctx, getItem(ctx, item.id, now), 'kiln', now) ?? '';
    expect(text).toContain('Options: 1. Liso - Con musgo (recommended) · 2. Con hongos');
    expect(text).not.toContain('\u0007');
    expect(text).not.toContain('‮');
  });

  it('refuses an option that is only control characters', () => {
    expect(refusedWith(['a', '\u0007\n\t']).message).toContain('empty');
    expect(refusedWith(['Liso', 'Liso\n']).message).toContain('same');
  });

  it('records a chat answer that says an option, by its words or its number, as that option', () => {
    const ctx = memoryContext();
    const item = working(ctx);
    const note = (text: string) =>
      noteChatAnswer(ctx, { id: item.id, text, actor: kiln, channel: 'cli' }, now).question.answer;

    askWith(ctx, item.id, OPTIONS);
    expect(note('Con musgo')).toMatchObject({
      mode: 'option',
      option: 2,
      text: 'Con musgo',
      via: 'kiln',
    });

    askWith(ctx, item.id, OPTIONS);
    expect(note('3')).toMatchObject({ mode: 'option', option: 3, text: 'Con hongos' });

    askWith(ctx, item.id, OPTIONS);
    expect(note('con musgo, pero más claro')).toMatchObject({ mode: 'text' });

    askWith(ctx, item.id, OPTIONS);
    expect(note('4')).toMatchObject({ mode: 'text', text: '4' });
  });

  it('refuses an option the question does not have, and keeps the question open', () => {
    const ctx = memoryContext();
    const item = working(ctx);
    askWith(ctx, item.id, OPTIONS);

    const error = refusal(() =>
      answerQuestion(ctx, { id: item.id, option: 4, actor: you, channel: 'ui' }, now),
    );

    expect(error.message).toContain('no option 4');
    expect(askingItem(ctx.db, item.id)).toBeDefined();
    const none = refusal(() => {
      const plain = memoryContext();
      const other = working(plain);
      askWith(plain, other.id);
      answerQuestion(plain, { id: other.id, option: 1, actor: you, channel: 'ui' }, now);
    });
    expect(none.message).toContain('no option 1');
  });
});
