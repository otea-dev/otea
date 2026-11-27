import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  captureToBandeja,
  listBandeja,
  noteRefiner,
  takeBandeja,
  takeNextBandeja,
} from './bandeja.ts';
import { addCollection } from './collections.ts';
import { endProcess, waitBeat } from './presence.ts';
import type { Project } from './project.ts';
import { declareSecretary, secretaryWake, startSecretaryWait } from './secretary.ts';
import { memoryContext, projectOf } from './testing.ts';

const T0 = Date.parse('2026-11-27T10:00:00.000Z');
const clock = (offsetMs: number) => () => new Date(T0 + offsetMs).toISOString();

// T1a (0.8 adversarial test): a refiner killed with its harness held its note for the whole lease of
// 30 minutes: another refiner was told «none is free», the secretary's wait said nothing, and the
// desk read «refining». A hold whose holder's session ended is no hold.
describe('a Bandeja note held by a refiner whose session ended', () => {
  let project: Project;

  beforeEach(() => {
    project = projectOf('/nowhere', memoryContext());
    addCollection(project, { name: 'tasks' });
    declareSecretary(project.db, 'sol', clock(0));
    captureToBandeja(project, { text: 'a rough note' }, clock(1000));
    // lia waits for notes (this test's process stands for her session) and holds B-1.
    waitBeat(
      project.db,
      { agent: 'lia', channel: 'cli', waiter: process.pid },
      clock(2000),
      false,
    ).run();
    noteRefiner(project, 'lia', clock(2000));
    takeBandeja(project, { id: 1, agent: 'lia' }, clock(2000));
  });

  afterEach(() => project.db.close());

  const wake = (at: number) => secretaryWake(project, startSecretaryWait(clock(at)), clock(at));

  it('stays held while her session runs', () => {
    expect(listBandeja(project, {}, clock(3000))[0]).toMatchObject({
      state: 'refining',
      claimedBy: 'lia',
    });
    expect(takeNextBandeja(project, { agent: 'ana' }, clock(3000))).toBeUndefined();
    expect(wake(3000)).toBeUndefined();
  });

  it('is free at once: another refiner takes it and the secretary is woken for it', () => {
    endProcess(project.db, process.pid);

    expect(listBandeja(project, {}, clock(3000))[0]).toMatchObject({
      state: 'waiting',
      claimedBy: null,
    });
    expect(wake(3000)).toMatchObject({ kind: 'bandeja_item', ref: 'B-1' });
    const taken = takeNextBandeja(project, { agent: 'ana' }, clock(3000));
    expect(taken?.entry).toMatchObject({ ref: 'B-1', state: 'refining', claimedBy: 'ana' });
  });
});
