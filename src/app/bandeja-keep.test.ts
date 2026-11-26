import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BANDEJA_HANDOVER_MS, BANDEJA_LEASE_MS } from '../core/bandeja.ts';
import {
  askOnBandeja,
  captureToBandeja,
  closeBandeja,
  fileBandeja,
  keepHeldEntries,
  listBandeja,
  reopenBandeja,
  requireEntry,
  takeBandeja,
  takeNextBandeja,
} from './bandeja.ts';
import { addCollection } from './collections.ts';
import { createItem } from './items.ts';
import type { Project } from './project.ts';
import { declareSecretary, secretaryWake, startSecretaryWait } from './secretary.ts';
import { secretaryWaiting } from './secretary-waiting.ts';
import { memoryContext, projectOf } from './testing.ts';

// The Bandeja when no refiner is there (field study 3, S4/S5): a note taken for a refiner that
// never shows must come back to the secretary, a duplicate must be closable, and one refiner takes
// the notes in turn instead of one launched per note.
const T0 = Date.parse('2026-11-26T10:00:00.000Z');
const clock = (offsetMs: number) => () => new Date(T0 + offsetMs).toISOString();
const MIN = 60_000;

describe('the Bandeja without a refiner session', () => {
  let root: string;
  let project: Project;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'otea-bandeja-keep-'));
    project = projectOf(root, memoryContext());
    addCollection(project, { name: 'tasks' });
    declareSecretary(project.db, 'sol', clock(0));
  });

  afterEach(() => {
    project.db.close();
    rmSync(root, { recursive: true, force: true });
  });

  const capture = (text: string, at = 1000) => captureToBandeja(project, { text }, clock(at)).entry;
  const wake = (at: number) => secretaryWake(project, startSecretaryWait(clock(at)), clock(at));

  describe('a note taken for a refiner that never shows', () => {
    it('comes back to the secretary after the handover, not after the whole lease', () => {
      capture('an idea');
      takeBandeja(project, { id: 1, agent: 'sol', on: 'sol-refiner' }, clock(1000));
      expect(wake(1000 + MIN)).toBeUndefined();

      expect(wake(1000 + BANDEJA_HANDOVER_MS)).toMatchObject({
        kind: 'bandeja_item',
        ref: 'B-1',
      });
      expect(requireEntry(project, 1, clock(1000 + BANDEJA_HANDOVER_MS))).toMatchObject({
        state: 'waiting',
        claimedBy: null,
      });
      expect(BANDEJA_HANDOVER_MS).toBeLessThan(BANDEJA_LEASE_MS);
    });

    it('is kept for the whole lease once the refiner itself calls otea', () => {
      capture('an idea');
      takeBandeja(project, { id: 1, agent: 'sol', on: 'sol-refiner' }, clock(1000));

      keepHeldEntries(project, 'sol-refiner', clock(MIN));

      expect(requireEntry(project, 1, clock(MIN)).claimUntil).toBe(
        new Date(T0 + MIN + BANDEJA_LEASE_MS).toISOString(),
      );
      expect(wake(1000 + BANDEJA_HANDOVER_MS + MIN)).toBeUndefined();
    });

    it('lets the secretary refine it itself once it came back', () => {
      capture('an idea');
      takeBandeja(project, { id: 1, agent: 'sol', on: 'sol-refiner' }, clock(1000));

      const late = 1000 + BANDEJA_HANDOVER_MS;
      const mine = takeBandeja(project, { id: 1, agent: 'sol' }, clock(late));

      expect(mine.entry).toMatchObject({ state: 'refining', claimedBy: 'sol' });
      expect(mine.entry.claimUntil).toBe(new Date(T0 + late + BANDEJA_LEASE_MS).toISOString());
    });
  });

  describe('one refiner for the whole Bandeja', () => {
    it('takes the oldest note nobody holds, one after another', () => {
      capture('first', 1000);
      capture('second', 2000);

      const one = takeNextBandeja(project, { agent: 'lia' }, clock(3000));
      expect(one?.entry).toMatchObject({ ref: 'B-1', claimedBy: 'lia' });
      // It still holds the first: that one comes back to it, not a second.
      expect(takeNextBandeja(project, { agent: 'lia' }, clock(3500))?.entry.ref).toBe('B-1');

      askOnBandeja(
        project,
        { id: 1, agent: 'lia', text: 'Which?', options: ['a', 'b'] },
        clock(4000),
      );
      const two = takeNextBandeja(project, { agent: 'lia' }, clock(5000));
      expect(two?.entry).toMatchObject({ ref: 'B-2', claimedBy: 'lia' });
    });

    it('takes a note again once the person answered its question, and nothing while none waits', () => {
      capture('make it better');
      takeNextBandeja(project, { agent: 'lia' }, clock(2000));
      askOnBandeja(
        project,
        { id: 1, agent: 'lia', text: 'Better how?', options: ['Faster', 'Prettier'] },
        clock(3000),
      );
      // Asked and not answered: nothing waits for it.
      expect(takeNextBandeja(project, { agent: 'lia' }, clock(4000))).toBeUndefined();
    });

    it('never takes a note another refiner holds, nor a closed or filed one', () => {
      capture('held', 1000);
      capture('free', 1100);
      takeBandeja(project, { id: 1, agent: 'max' }, clock(1200));

      const next = takeNextBandeja(project, { agent: 'lia' }, clock(1300));
      expect(next?.entry.ref).toBe('B-2');
      expect(takeNextBandeja(project, { agent: 'sol' }, clock(1400))).toBeUndefined();
    });
  });

  describe('closing a note', () => {
    it('is the secretary’s or the holder’s, with a reason, and ends the wait', () => {
      capture('a duplicate of CAM-1');

      expect(() =>
        closeBandeja(project, { id: 1, agent: 'lia', reason: 'dup' }, clock(2000)),
      ).toThrow(/secretary/);
      expect(() =>
        closeBandeja(project, { id: 1, agent: 'sol', reason: ' ' }, clock(2000)),
      ).toThrow(/reason/);

      const closed = closeBandeja(
        project,
        { id: 1, agent: 'sol', reason: 'the same as CAM-1' },
        clock(2000),
      );

      expect(closed).toMatchObject({
        state: 'closed',
        closeReason: 'the same as CAM-1',
        closedBy: 'sol',
      });
      expect(wake(3000)).toBeUndefined();
      expect(secretaryWaiting(project.db).count).toBe(0);
      expect(listBandeja(project, {}, clock(3000))).toEqual([]);
      expect(listBandeja(project, { filed: 10 }, clock(3000))).toEqual([
        expect.objectContaining({ ref: 'B-1', state: 'closed' }),
      ]);
      expect(() => takeBandeja(project, { id: 1, agent: 'lia' }, clock(4000))).toThrow(/closed/);
    });

    it('lets the refiner that holds it close it, and frees its hold', () => {
      capture('nothing to do');
      takeBandeja(project, { id: 1, agent: 'lia' }, clock(1500));

      const closed = closeBandeja(
        project,
        { id: 1, agent: 'lia', reason: 'not a task' },
        clock(2000),
      );

      expect(closed).toMatchObject({ state: 'closed', claimedBy: null });
    });

    it('is refused for a note already filed under an item', () => {
      capture('make it');
      takeBandeja(project, { id: 1, agent: 'lia' }, clock(1500));
      const item = createItem(project, {
        collection: 'tasks',
        title: 'Made',
        fields: { description: 'What I want: it. How I check it: so.' },
        actor: { kind: 'agent', name: 'lia' },
      });
      fileBandeja(project, { id: 1, agent: 'lia', item: item.id }, clock(1700));

      expect(() =>
        closeBandeja(project, { id: 1, agent: 'sol', reason: 'dup' }, clock(2000)),
      ).toThrow(/filed already/);
    });

    it('is reopened by the person: it waits for the secretary again', () => {
      capture('a duplicate of CAM-1');
      closeBandeja(project, { id: 1, agent: 'sol', reason: 'the same as CAM-1' }, clock(2000));

      const reopened = reopenBandeja(project, { id: 1 }, clock(3000));

      expect(reopened).toMatchObject({ state: 'waiting', closeReason: null, closedBy: null });
      expect(wake(4000)).toMatchObject({ kind: 'bandeja_item', ref: 'B-1' });
      expect(() => reopenBandeja(project, { id: 1 }, clock(5000))).toThrow(/not closed/);
    });
  });
});
