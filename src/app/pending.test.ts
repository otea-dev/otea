import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sequenceIds } from '../core/board/ids.ts';
import { instantiate, requireTemplate } from '../core/board/templates.ts';
import { creatures } from '../core/board/testing.ts';
import { appendEvent, updateItemState } from '../store/queries.ts';
import { answerBandeja, askOnBandeja, captureToBandeja, takeBandeja } from './bandeja.ts';
import { createBoard, publishBoard, saveDraft } from './boards.ts';
import { addCollection } from './collections.ts';
import { answerSecretaryQuestion, postPersonMessage, sayAsSecretary } from './conversation.ts';
import { createItem } from './items.ts';
import { claimItem } from './leases.ts';
import { landWaitOf } from './next.ts';
import { pendingOf, pendingText } from './pending.ts';
import { seeAgent } from './presence.ts';
import type { Project } from './project.ts';
import { askQuestion } from './questions.ts';
import { declareSecretary } from './secretary.ts';
import { memoryContext, projectOf, publishAs, REVIEWS } from './testing.ts';

const T0 = Date.parse('2026-11-26T10:00:00.000Z');
const clock = (offsetMs: number) => () => new Date(T0 + offsetMs).toISOString();
const MIN = 60_000;
const you = { kind: 'human' as const, name: 'fede' };
const agent = (name: string) => ({ kind: 'agent' as const, name });

// F4 (field study 3): four personas waited 15 to 40 minutes on a question of the Bandeja that Te
// toca never counted, and the secretary's «what waits for me» left a review out because it came
// from its memory. Otea says what waits for the person, from the records.
describe('what waits for the person', () => {
  let root: string;
  let project: Project;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'otea-pending-'));
    project = projectOf(root, memoryContext(REVIEWS));
    addCollection(project, { name: 'reviews', preset: 'reviews' });
    declareSecretary(project.db, 'sol', clock(0));
  });

  afterEach(() => {
    project.db.close();
    rmSync(root, { recursive: true, force: true });
  });

  const note = (text: string, at: number) =>
    captureToBandeja(project, { text }, clock(at)).entry.id;

  it('says nothing waits for a project with nothing in it', () => {
    expect(pendingOf(project, clock(MIN))).toMatchObject({ count: 0, entries: [], blocks: [] });
  });

  it('counts a question a refiner asked on a Bandeja note, with its options', () => {
    const id = note('the Aprobar button is hidden on the phone', 1000);
    takeBandeja(project, { id, agent: 'lia' }, clock(2000));
    askOnBandeja(
      project,
      {
        id,
        agent: 'lia',
        text: 'On which screen?',
        options: ['Te toca', 'Hablar'],
        recommended: 1,
      },
      clock(3000),
    );

    const pending = pendingOf(project, clock(MIN));
    expect(pending.count).toBe(1);
    expect(pending.entries).toEqual([
      expect.objectContaining({
        kind: 'bandeja',
        ref: 'B-1',
        title: 'the Aprobar button is hidden on the phone',
        by: 'lia',
        text: 'On which screen?',
        options: ['Te toca', 'Hablar'],
        recommended: 1,
      }),
    ]);

    answerBandeja(project, { id, option: 1 }, clock(2 * MIN));
    expect(pendingOf(project, clock(3 * MIN)).count).toBe(0);
  });

  it('counts a question of the secretary with options until the person answers it', () => {
    const wrote = postPersonMessage(
      project,
      { text: 'should the idea of the boss wait?' },
      clock(1000),
    ).message;
    const said = sayAsSecretary(
      project,
      {
        agent: 'sol',
        text: 'What do I do with it?',
        replyTo: wrote.id,
        options: ['Write it down', 'Leave it as an idea'],
        recommended: 1,
      },
      clock(2000),
    ).message;

    const pending = pendingOf(project, clock(MIN));
    expect(pending.entries).toEqual([
      expect.objectContaining({
        kind: 'secretary',
        ref: String(said.id),
        by: 'sol',
        text: 'What do I do with it?',
        options: ['Write it down', 'Leave it as an idea'],
        recommended: 1,
        turn: wrote.root,
      }),
    ]);

    answerSecretaryQuestion(project, said.id, { option: 1 }, clock(2 * MIN));
    expect(pendingOf(project, clock(3 * MIN)).count).toBe(0);
  });

  it('counts a review and a step of the person apart, oldest first', () => {
    const make = (title: string, actor: typeof you | ReturnType<typeof agent>, at: number) =>
      createItem(project, { collection: 'reviews', title, actor }, clock(at)).id;
    const review = make('CSS review', agent('kiln'), 1000);
    const own = make('Call the bank', you, 2000);

    expect(pendingOf(project, clock(MIN)).entries.map(({ kind, ref }) => [kind, ref])).toEqual([
      ['review', review],
      ['step', own],
    ]);
  });

  it('counts the question an agent asked on an item, with its options', () => {
    const def = creatures();
    const record = createBoard(project, { name: def.name, lang: 'es' }, clock(1), sequenceIds());
    saveDraft(project, record.id, { definition: def, baseVersion: null }, clock(1));
    publishBoard(project, record.id, { moves: {}, by: you }, clock(1));
    const item = createItem(
      project,
      { collection: 'Criaturas', title: 'Tortuga', fields: { fdesc: 'Lenta' }, actor: you },
      clock(2),
    );
    claimItem(project, { id: item.id, actor: agent('kiln') }, clock(3));
    askQuestion(
      project,
      {
        id: item.id,
        text: 'Smooth or mossy?',
        options: ['Smooth', 'Mossy'],
        actor: agent('kiln'),
        channel: 'cli',
      },
      clock(4),
    );

    expect(pendingOf(project, clock(MIN)).entries).toEqual([
      expect.objectContaining({
        kind: 'question',
        ref: item.id,
        title: 'Tortuga',
        by: 'kiln',
        text: 'Smooth or mossy?',
        options: ['Smooth', 'Mossy'],
      }),
    ]);
  });

  it('lists the questions first, then what they decide', () => {
    createItem(
      project,
      { collection: 'reviews', title: 'old review', actor: agent('kiln') },
      clock(1000),
    );
    const id = note('a note', 2000);
    takeBandeja(project, { id, agent: 'lia' }, clock(3000));
    askOnBandeja(project, { id, agent: 'lia', text: 'Which one?' }, clock(4000));

    expect(pendingOf(project, clock(MIN)).entries.map(({ kind }) => kind)).toEqual([
      'bandeja',
      'review',
    ]);
  });

  // The field: «CAM-2 listo; CAM-3, 4 y 5 se integran después» and nothing said in Hablar.
  it('says a review holds the rest of the queue of a board that works on main', () => {
    let tick = 0;
    const now = () => new Date(Date.UTC(2026, 10, 19, 9, 0, tick++)).toISOString();
    const def = instantiate(requireTemplate('mainline'), 'es', {}, undefined, { keep: true });
    publishAs(project, def, 'bmain', now);
    const doing = (title: string) => {
      const { id } = createItem(
        project,
        { collection: def.name, title, fields: { want: 'x' }, actor: you },
        now,
      );
      updateItemState(project.db, id, 'doit', now());
      return id;
    };
    const first = doing('first');
    const second = doing('second');
    const third = doing('third');
    appendEvent(project.db, {
      itemId: first,
      type: 'transitioned',
      actor: agent('claude-b'),
      at: now(),
      data: {
        to: 'doit__review',
        tip: { branch: 'main', commit: 'a'.repeat(40), tree: 'b'.repeat(40) },
      },
    });
    updateItemState(project.db, first, 'doit__review', now());

    const pending = pendingOf(project, now);
    expect(pending.entries.map(({ kind, ref }) => [kind, ref])).toEqual([['review', first]]);
    expect(pending.blocks).toEqual([
      expect.objectContaining({
        first,
        title: 'first',
        waitsFor: 'review',
        waiting: [second, third],
      }),
    ]);
    expect(pendingText(pending)).toContain(`${first} holds the queue`);
  });

  // F4 review round: the desk reads this on every change; git is asked about the branches once
  // while nothing that decides who waits for whom has changed.
  it('asks git which item the waiting ones wait for once, while nothing changed', () => {
    let tick = 0;
    const now = () => new Date(Date.UTC(2026, 10, 19, 9, 0, tick++)).toISOString();
    const def = instantiate(requireTemplate('mainline'), 'es', {}, undefined, { keep: true });
    publishAs(project, def, 'bmain', now);
    const make = (title: string) => {
      const { id } = createItem(
        project,
        { collection: def.name, title, fields: { want: 'x' }, actor: you },
        now,
      );
      updateItemState(project.db, id, 'doit', now());
      return id;
    };
    const first = make('first');
    make('second');
    updateItemState(project.db, first, 'doit__review', now());
    let asked = 0;
    const landWait: typeof landWaitOf = (ctx, item, at) => {
      asked += 1;
      return landWaitOf(ctx, item, at);
    };

    const one = pendingOf(project, now, { landWait });
    const after = asked;
    const two = pendingOf(project, now, { landWait });

    expect(one.blocks).toHaveLength(1);
    expect(after).toBeGreaterThan(0);
    expect(asked).toBe(after);
    expect(two.blocks).toEqual(one.blocks);
    // A change of what decides it (the review is settled) is a new look, not the kept one.
    updateItemState(project.db, first, 'done', now());
    expect(pendingOf(project, now, { landWait }).blocks).toEqual([]);
  });

  it('can leave the queue blocks out: the cheap count at the foot of a wait', () => {
    let asked = 0;
    createItem(project, { collection: 'reviews', title: 'CSS', actor: agent('kiln') }, clock(1000));

    const pending = pendingOf(project, clock(MIN), {
      blocks: false,
      landWait: () => {
        asked += 1;
        return undefined;
      },
    });

    expect(pending.count).toBe(1);
    expect(pending.blocks).toEqual([]);
    expect(asked).toBe(0);
  });

  // F3 left a question open until a message replies to it: the person's own words in reply close it.
  it('closes a question of the secretary the person answers in their own words', () => {
    const wrote = postPersonMessage(project, { text: 'idea?' }, clock(1000)).message;
    const said = sayAsSecretary(
      project,
      { agent: 'sol', text: 'Write it down?', replyTo: wrote.id, options: ['Yes', 'No'] },
      clock(2000),
    ).message;
    expect(pendingOf(project, clock(MIN)).count).toBe(1);

    answerSecretaryQuestion(project, said.id, { text: 'Not now, maybe next week' }, clock(2 * MIN));

    expect(pendingOf(project, clock(3 * MIN)).count).toBe(0);
  });

  it('says the secretary is offline and how many things wait for it', () => {
    postPersonMessage(project, { text: 'hello?' }, clock(1000));
    const pending = pendingOf(project, clock(90 * MIN));
    expect(pending.secretary).toMatchObject({
      name: 'sol',
      state: 'offline',
      waiting: { count: 1 },
    });
  });

  it('reads as plain text for the secretary: what waits and how long', () => {
    const id = note('a note', 1000);
    takeBandeja(project, { id, agent: 'lia' }, clock(2000));
    askOnBandeja(
      project,
      { id, agent: 'lia', text: 'Which one?', options: ['a', 'b'] },
      clock(3000),
    );
    createItem(
      project,
      { collection: 'reviews', title: 'CSS review', actor: agent('kiln') },
      clock(4000),
    );

    const text = pendingText(pendingOf(project, clock(MIN)));
    expect(text).toContain('2 things wait for the person');
    expect(text).toContain('B-1');
    expect(text).toContain('Which one?');
    expect(text).toContain('CSS review');
  });

  it('says plainly that nothing waits', () => {
    expect(pendingText(pendingOf(project, clock(MIN)))).toContain('Nothing waits for the person');
  });

  // U4 (field study 4): with approved work waiting behind the only worker, the secretary started no
  // second one until asked. Otea says how many wait for an agent on each board, who works it and how
  // many the board takes, so the secretary reads it instead of guessing.
  describe('the queue of each board for a worker', () => {
    let tick = 0;
    const now = () => new Date(Date.UTC(2026, 10, 19, 9, 0, tick++)).toISOString();
    let board: string;
    const waiting = (title: string) => {
      const { id } = createItem(
        project,
        { collection: board, title, fields: { want: 'x' }, actor: you },
        now,
      );
      updateItemState(project.db, id, 'doit', now());
      return id;
    };

    beforeEach(() => {
      const def = instantiate(requireTemplate('mainline'), 'es', {}, undefined, { keep: true });
      publishAs(project, def, 'bmain', now);
      board = def.name;
    });

    it('lists the items waiting for an agent, the workers on the board and the room for another', () => {
      const first = waiting('first');
      const second = waiting('second');
      const third = waiting('third');
      claimItem(project, { id: first, actor: agent('ana') }, now);
      seeAgent(project.db, { agent: 'ana', channel: 'cli', call: true }, now);

      const { queues } = pendingOf(project, now, { blocks: true });

      expect(queues).toEqual([
        { board, waiting: [second, third], workers: ['ana'], limit: expect.any(Number) },
      ]);
      const limit = queues[0]?.limit ?? 0;
      const text = pendingText(pendingOf(project, now, { blocks: true }));
      expect(text).toContain(`${board}: 2 waiting for an agent`);
      expect(text).toContain('ana');
      // The board takes a second worker only when it merges code: the text says to launch one then.
      expect(text.includes('Launch a second worker')).toBe(limit > 1);
    });

    it('says nothing of a board nobody waits on, and leaves it out of the cheap count', () => {
      const only = waiting('only');
      claimItem(project, { id: only, actor: agent('ana') }, now);

      expect(pendingOf(project, now).queues).toEqual([]);
      expect(pendingOf(project, now, { blocks: false }).queues).toEqual([]);
    });
  });
});
