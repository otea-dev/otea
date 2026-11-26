import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BANDEJA_LEASE_MS, isBandejaRef } from '../core/bandeja.ts';
import { saveRole } from '../store/secretary.ts';
import {
  answerBandeja,
  askOnBandeja,
  bandejaOfItem,
  bandejaPaths,
  captureToBandeja,
  entryText,
  fileBandeja,
  keepHeldEntries,
  listBandeja,
  requireBandejaHold,
  requireEntry,
  takeBandeja,
} from './bandeja.ts';
import { addCollection } from './collections.ts';
import { listConversation, postPersonMessage } from './conversation.ts';
import { createItem } from './items.ts';
import type { Project } from './project.ts';
import { declareSecretary, secretaryWake, startSecretaryWait } from './secretary.ts';
import { secretaryWaiting } from './secretary-waiting.ts';
import { memoryContext, projectOf } from './testing.ts';

const T0 = Date.parse('2026-11-26T10:00:00.000Z');
const clock = (offsetMs: number) => () => new Date(T0 + offsetMs).toISOString();
const MIN = 60_000;

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');

describe('the Bandeja', () => {
  let root: string;
  let project: Project;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'otea-bandeja-'));
    project = projectOf(root, memoryContext());
    addCollection(project, { name: 'tasks' });
    declareSecretary(project.db, 'sol', clock(0));
  });

  afterEach(() => {
    project.db.close();
    rmSync(root, { recursive: true, force: true });
  });

  const capture = (
    text: string,
    at = 1000,
    extra: Partial<Parameters<typeof captureToBandeja>[1]> = {},
  ) => captureToBandeja(project, { text, ...extra }, clock(at)).entry;

  const wake = (at: number) => secretaryWake(project, startSecretaryWait(clock(at)), clock(at));

  describe('a capture', () => {
    it('waits for the secretary, from the entries’ own state, until a refiner takes it', () => {
      const entry = capture('the Aprobar button is hidden on the phone');
      expect(entry).toMatchObject({ ref: 'B-1', state: 'waiting', by: 'human', item: null });

      const woke = wake(2000);
      expect(woke).toMatchObject({ kind: 'bandeja_item', ref: 'B-1' });
      expect(woke?.text).toContain('Aprobar button is hidden');
      // A state, not a signal: every look finds it until it is taken.
      expect(wake(3000)?.ref).toBe('B-1');

      takeBandeja(project, { id: 1, agent: 'lia' }, clock(4000));
      expect(wake(5000)).toBeUndefined();
    });

    it('wakes the secretary again when the refiner that took it never acted and its lease ran out', () => {
      capture('an idea');
      takeBandeja(project, { id: 1, agent: 'lia' }, clock(1000));
      expect(wake(1000 + BANDEJA_LEASE_MS - 1)).toBeUndefined();

      expect(wake(1000 + BANDEJA_LEASE_MS)).toMatchObject({ kind: 'bandeja_item', ref: 'B-1' });
      expect(requireEntry(project, 1, clock(1000 + BANDEJA_LEASE_MS))).toMatchObject({
        state: 'waiting',
        claimedBy: null,
      });
    });

    it('returns the entries oldest first and says how many more wait', () => {
      capture('first', 1000);
      capture('second', 2000);
      capture('third', 3000);

      const woke = wake(4000);
      expect(woke?.ref).toBe('B-1');
      expect(woke?.text).toContain('first');
      expect(woke?.text).toContain('and 2 more');
    });

    it('keeps the files, stored once, with a path an agent can open', () => {
      const entry = captureToBandeja(
        project,
        { text: 'see the screenshot', files: [{ filename: 'C:\\shots\\boton.png', bytes: PNG }] },
        clock(1000),
      ).entry;
      expect(entry.attachments).toEqual([
        expect.objectContaining({ name: 'boton.png', kind: 'image', size: PNG.length }),
      ]);

      const { paths, problems } = bandejaPaths(project, [entry]);
      expect(problems.size).toBe(0);
      const [path] = [...paths.values()];
      expect(readFileSync(path ?? '')).toEqual(PNG);
      expect(entryText(entry, paths, problems)).toContain(
        `attached: boton.png (image, ${PNG.length} B): ${path}`,
      );
    });

    it('takes a note of only files, refuses an empty one, and a replay is the same entry', () => {
      expect(() => capture('   ')).toThrow(/some text or a file/);
      const filesOnly = captureToBandeja(
        project,
        { text: '', files: [{ filename: 'a.png', bytes: PNG }] },
        clock(1000),
      );
      expect(filesOnly.entry.attachments).toHaveLength(1);

      const key = { scope: 'device:1', key: 'k1' };
      const first = captureToBandeja(project, { text: 'once', clientKey: key }, clock(2000));
      const again = captureToBandeja(project, { text: 'once', clientKey: key }, clock(3000));
      expect(first.replayed).toBe(false);
      expect(again).toMatchObject({ replayed: true, entry: { id: first.entry.id } });
      expect(listBandeja(project, {}, clock(4000))).toHaveLength(2);
      expect(() =>
        captureToBandeja(project, { text: 'another', clientKey: key }, clock(5000)),
      ).toThrow(/already sent another capture/);
    });
  });

  describe('the id B-3', () => {
    it('is never an item: no board may take the prefix B, whatever its name', () => {
      for (const name of ['B', 'b', 'B!', ' b ']) {
        expect(() => addCollection(project, { name }), name).toThrow(/keeps for its entries/);
      }
      // A longer name that starts with it is fine.
      expect(addCollection(project, { name: 'Bugs' }).prefix).toBe('BUGS');
      expect(isBandejaRef('B-3')).toBe(true);
      expect(isBandejaRef('BUGS-3')).toBe(false);
    });
  });

  describe('while the secretary is away', () => {
    it('counts the captures nobody took among what waits for it, beside the person’s messages', () => {
      // Real time: the notifier asks at the moment it looks.
      const first = captureToBandeja(project, { text: 'one' }).entry;
      captureToBandeja(project, { text: 'two' });
      postPersonMessage(project, { text: 'hello' });
      expect(secretaryWaiting(project.db)).toEqual({ count: 3, since: expect.any(String) });
      // The oldest of what waits.
      expect(secretaryWaiting(project.db).since).toBe(first.at);

      // A refiner holds one: the secretary has nothing to do with it.
      takeBandeja(project, { id: 1, agent: 'lia' });
      expect(secretaryWaiting(project.db).count).toBe(2);

      // Asked and unanswered: the person's turn. Answered: the secretary's again.
      askOnBandeja(project, { id: 1, agent: 'lia', text: 'Which?', options: ['a', 'b'] });
      expect(secretaryWaiting(project.db).count).toBe(2);
      answerBandeja(project, { id: 1, option: 1 });
      expect(secretaryWaiting(project.db).count).toBe(3);

      takeBandeja(project, { id: 1, agent: 'lia' });
      fileBandeja(project, {
        id: 1,
        agent: 'lia',
        item: createItem(project, {
          collection: 'tasks',
          title: 'One',
          fields: { description: 'Now' },
          actor: { kind: 'agent', name: 'lia' },
        }).id,
      });
      expect(secretaryWaiting(project.db).count).toBe(2);
    });
  });

  describe('taking an entry', () => {
    it('is held by one refiner at a time: a second is refused naming the first', () => {
      capture('an idea');
      const held = takeBandeja(project, { id: 1, agent: 'lia' }, clock(1000));
      expect(held.entry).toMatchObject({ state: 'refining', claimedBy: 'lia' });

      expect(() => takeBandeja(project, { id: 1, agent: 'max' }, clock(2000))).toThrow(
        /held by lia until/,
      );
      // The holder taking it again only starts its lease over.
      const again = takeBandeja(project, { id: 1, agent: 'lia' }, clock(2000 + 10 * MIN));
      expect(again.renewed).toBe(true);
      expect(() =>
        takeBandeja(project, { id: 1, agent: 'max' }, clock(1000 + BANDEJA_LEASE_MS)),
      ).toThrow(/held by lia/);
    });

    it('is kept by any call of the refiner, never taken back once it ran out', () => {
      capture('an idea');
      takeBandeja(project, { id: 1, agent: 'lia' }, clock(1000));

      keepHeldEntries(project, 'max', clock(20 * MIN));
      expect(requireEntry(project, 1, clock(20 * MIN)).claimUntil).toBe(
        new Date(T0 + 1000 + BANDEJA_LEASE_MS).toISOString(),
      );
      keepHeldEntries(project, 'lia', clock(20 * MIN));
      expect(requireEntry(project, 1, clock(20 * MIN)).claimUntil).toBe(
        new Date(T0 + 20 * MIN + BANDEJA_LEASE_MS).toISOString(),
      );

      // Run out: a late call does not revive the hold; another refiner may take it.
      const late = 20 * MIN + BANDEJA_LEASE_MS + MIN;
      keepHeldEntries(project, 'lia', clock(late));
      expect(requireEntry(project, 1, clock(late))).toMatchObject({ state: 'waiting' });
      expect(takeBandeja(project, { id: 1, agent: 'max' }, clock(late)).entry.claimedBy).toBe(
        'max',
      );
    });

    it('goes to another refiner once the lease ran out', () => {
      capture('an idea');
      takeBandeja(project, { id: 1, agent: 'lia' }, clock(1000));

      const later = takeBandeja(project, { id: 1, agent: 'max' }, clock(1000 + BANDEJA_LEASE_MS));

      expect(later.entry).toMatchObject({ state: 'refining', claimedBy: 'max' });
    });

    it('lets the secretary take it for the refiner it launches, and nobody else', () => {
      capture('an idea');
      expect(() => takeBandeja(project, { id: 1, agent: 'max', on: 'lia' }, clock(1000))).toThrow(
        /Only the project's secretary takes an entry for a refiner/,
      );

      // For a refiner that is no agent here (a typo, or one that never called otea), nothing is held.
      expect(() => takeBandeja(project, { id: 1, agent: 'sol', on: 'lia' }, clock(1500))).toThrow(
        /lia is not an agent of this project \(it has not called otea\) nor your subagent \(sol-<role>\)/,
      );
      expect(requireEntry(project, 1, clock(1500)).state).toBe('waiting');
      // The person's name is no refiner at all.
      expect(() => takeBandeja(project, { id: 1, agent: 'sol', on: 'human' }, clock(1500))).toThrow(
        /human/,
      );
      expect(() =>
        takeBandeja(project, { id: 1, agent: 'sol', on: 'Not A Name' }, clock(1500)),
      ).toThrow();
      expect(requireEntry(project, 1, clock(1500))).toMatchObject({
        state: 'waiting',
        claimedBy: null,
      });

      // A subagent of the secretary (sol-<role>) has not called otea yet when the entry is taken for
      // it: that is allowed, and it takes the entry itself when it starts.
      const held = takeBandeja(project, { id: 1, agent: 'sol', on: 'sol-refiner' }, clock(2000));
      expect(held.entry.claimedBy).toBe('sol-refiner');
      expect(wake(3000)).toBeUndefined();
      expect(takeBandeja(project, { id: 1, agent: 'sol-refiner' }, clock(4000)).renewed).toBe(true);
    });

    it('lets the secretary take it for an agent already known here', () => {
      capture('an idea');
      saveRole(project.db, 'lia', null, clock(1600)());

      const held = takeBandeja(project, { id: 1, agent: 'sol', on: 'lia' }, clock(2000));

      expect(held.entry.claimedBy).toBe('lia');
    });

    it('is refused for an entry that is not there', () => {
      expect(() => takeBandeja(project, { id: 9, agent: 'lia' }, clock(1000))).toThrow(
        /B-9 is not in the Bandeja/,
      );
    });
  });

  describe('refining it into an item', () => {
    const itemFor = (agent: string) =>
      createItem(project, {
        collection: 'tasks',
        title: 'Aprobar hidden on the phone',
        fields: { description: 'What I want: it visible. How I check it: at 390.' },
        actor: { kind: 'agent', name: agent },
      });

    it('files the entry under the item, which links back, and ends its wait', () => {
      capture('the Aprobar button is hidden on the phone');
      takeBandeja(project, { id: 1, agent: 'lia' }, clock(1000));
      requireBandejaHold(project, 1, 'lia', clock(1500));
      const item = itemFor('lia');

      const filed = fileBandeja(project, { id: 1, agent: 'lia', item: item.id }, clock(2000));

      expect(filed).toMatchObject({
        state: 'filed',
        item: item.id,
        filedBy: 'lia',
        claimedBy: null,
      });
      expect(bandejaOfItem(project, item.id)).toEqual({
        id: 1,
        ref: 'B-1',
        at: new Date(T0 + 1000).toISOString(),
        snippet: 'the Aprobar button is hidden on the phone',
      });
      expect(bandejaOfItem(project, 'tasks-99')).toBeUndefined();
      expect(wake(3000)).toBeUndefined();
      expect(() => takeBandeja(project, { id: 1, agent: 'max' }, clock(4000))).toThrow(
        /filed already, as/,
      );
    });

    it('is refused to an agent that does not hold the entry, or whose lease ran out', () => {
      capture('an idea');
      const item = itemFor('max');
      expect(() =>
        fileBandeja(project, { id: 1, agent: 'max', item: item.id }, clock(1000)),
      ).toThrow(/You do not hold B-1: take it first/);

      takeBandeja(project, { id: 1, agent: 'lia' }, clock(1000));
      expect(() =>
        fileBandeja(project, { id: 1, agent: 'max', item: item.id }, clock(2000)),
      ).toThrow(/\(lia does\)/);
      expect(() =>
        fileBandeja(
          project,
          { id: 1, agent: 'lia', item: item.id },
          clock(1000 + BANDEJA_LEASE_MS),
        ),
      ).toThrow(/You do not hold B-1/);
      expect(requireEntry(project, 1, clock(2000)).state).toBe('refining');
    });

    it('lists the open entries first and the filed ones after, newest first', () => {
      capture('one', 1000);
      capture('two', 2000);
      capture('three', 3000);
      for (const id of [1, 3]) {
        takeBandeja(project, { id, agent: 'lia' }, clock(4000));
        fileBandeja(project, { id, agent: 'lia', item: itemFor('lia').id }, clock(4000));
      }

      const now = clock(5000);
      expect(listBandeja(project, {}, now).map(({ ref }) => ref)).toEqual(['B-2']);
      expect(listBandeja(project, { filed: 5 }, now).map(({ ref, state }) => [ref, state])).toEqual(
        [
          ['B-2', 'waiting'],
          ['B-3', 'filed'],
          ['B-1', 'filed'],
        ],
      );
    });
  });

  describe('asking the person on an entry', () => {
    const ask = () => {
      capture('make it better');
      takeBandeja(project, { id: 1, agent: 'lia' }, clock(1000));
      return askOnBandeja(
        project,
        {
          id: 1,
          agent: 'lia',
          text: 'Better how?',
          options: ['Faster', 'Prettier', 'Smaller'],
          recommended: 2,
        },
        clock(2000),
      );
    };

    it('waits for the person with the options to tap, lets go of the hold, and wakes nobody', () => {
      const { entry, question } = ask();

      expect(question).toMatchObject({
        question: 1,
        text: 'Better how?',
        by: 'lia',
        options: ['Faster', 'Prettier', 'Smaller'],
        recommended: 2,
      });
      expect(entry).toMatchObject({ state: 'asking', claimedBy: null, asking: { question: 1 } });
      // Nothing for the secretary to do until the person answers; nobody may take it meanwhile.
      expect(wake(3000)).toBeUndefined();
      expect(() => takeBandeja(project, { id: 1, agent: 'max' }, clock(3000))).toThrow(
        /waits for the person's answer/,
      );
    });

    it('records a tapped option, hands the entry back and wakes the secretary with the answer', () => {
      ask();

      const answered = answerBandeja(project, { id: 1, question: 1, option: 2 }, clock(5000));

      expect(answered.state).toBe('waiting');
      expect(answered.questions[0]?.answer).toMatchObject({
        mode: 'option',
        option: 2,
        text: 'Prettier',
      });
      const woke = wake(6000);
      expect(woke).toMatchObject({ kind: 'bandeja_item', ref: 'B-1' });
      expect(woke?.text).toContain('the person answered your question');

      // The refiner reads the talk when it takes the entry again.
      const taken = takeBandeja(project, { id: 1, agent: 'lia' }, clock(7000)).entry;
      const text = entryText(taken, new Map(), new Map(), 'lia');
      expect(text).toContain(
        'lia asked: "Better how?" Options: 1. Faster · 2. Prettier (recommended) · 3. Smaller',
      );
      expect(text).toContain('The person chose option 2: "Prettier"');
    });

    it('leaves the answer in the conversation as the person’s own message, read, about the note', () => {
      ask();
      answerBandeja(project, { id: 1, question: 1, option: 2 }, clock(5000));

      const [trace] = listConversation(project).messages;
      expect(trace).toMatchObject({
        author: 'person',
        text: 'Prettier',
        delivery: 'read',
        choice: { mode: 'option', option: 2, about: 'B-1', asked: 'Better how?' },
      });
    });

    it('takes the person’s own words, or the decision left to the refiner', () => {
      ask();
      answerBandeja(project, { id: 1, text: '  the colours  ' }, clock(5000));
      expect(requireEntry(project, 1, clock(5000)).questions[0]?.answer).toMatchObject({
        mode: 'text',
        text: 'the colours',
      });

      takeBandeja(project, { id: 1, agent: 'lia' }, clock(6000));
      askOnBandeja(project, { id: 1, agent: 'lia', text: 'Which board?' }, clock(7000));
      const delegated = answerBandeja(project, { id: 1, question: 2, delegate: true }, clock(8000));
      expect(delegated.questions[1]?.answer).toMatchObject({ mode: 'delegated' });
      takeBandeja(project, { id: 1, agent: 'lia' }, clock(9000));
      expect(entryText(requireEntry(project, 1, clock(9000)), new Map(), new Map())).toContain(
        'The person left the decision to you',
      );
    });

    it('refuses an answer to a question that changed, an unknown option, none open, and a second asking', () => {
      ask();
      expect(() => answerBandeja(project, { id: 1, question: 7, option: 1 }, clock(3000))).toThrow(
        /question 7 is no longer the one that waits \(it is question 1\)/,
      );
      expect(() => answerBandeja(project, { id: 1, question: 1, option: 9 }, clock(3000))).toThrow(
        /no option 9/,
      );
      expect(() => answerBandeja(project, { id: 1, text: ' ' }, clock(3000))).toThrow(
        /say your answer/,
      );
      answerBandeja(project, { id: 1, question: 1, option: 1 }, clock(4000));
      expect(() => answerBandeja(project, { id: 1, question: 1, option: 1 }, clock(5000))).toThrow(
        /no question waits for you/,
      );
    });

    it('is asked only by the refiner that holds the entry, with options that check', () => {
      capture('an idea');
      expect(() =>
        askOnBandeja(project, { id: 1, agent: 'lia', text: 'What?' }, clock(1000)),
      ).toThrow(/take it first/);
      takeBandeja(project, { id: 1, agent: 'lia' }, clock(1000));
      expect(() =>
        askOnBandeja(project, { id: 1, agent: 'max', text: 'What?' }, clock(2000)),
      ).toThrow(/\(lia does\)/);
      expect(() => askOnBandeja(project, { id: 1, agent: 'lia', text: ' ' }, clock(2000))).toThrow(
        /say your question/,
      );
      expect(() =>
        askOnBandeja(
          project,
          { id: 1, agent: 'lia', text: 'What?', options: ['only one'] },
          clock(2000),
        ),
      ).toThrow(/give 2 to 4 options/);
    });
  });
});
