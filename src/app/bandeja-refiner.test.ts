import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { assistantWake, declareAssistant, startAssistantWait } from './assistant.ts';
import { captureToBandeja, noteRefiner, takeBandeja } from './bandeja.ts';
import { addCollection } from './collections.ts';
import { seeAgent } from './presence.ts';
import type { Project } from './project.ts';
import { memoryContext, projectOf } from './testing.ts';

const T0 = Date.parse('2026-11-27T10:00:00.000Z');
const MIN = 60_000;
const clock = (offsetMs: number) => () => new Date(T0 + offsetMs).toISOString();

// U6 (field study 4, wave 2b): with a refiner opened by hand and busy on B-1, the assistant took B-2
// and B-3 itself. A note waits for the assistant only when no refiner is there, or after the
// refiner has left it a while.
describe('a Bandeja note waits for the assistant only when no refiner is there to take it', () => {
  let project: Project;

  beforeEach(() => {
    project = projectOf('/nowhere', memoryContext());
    addCollection(project, { name: 'tasks' });
    declareAssistant(project.db, 'sol', clock(0));
  });

  afterEach(() => project.db.close());

  const wake = (at: number) => assistantWake(project, startAssistantWait(clock(at)), clock(at));

  it('leaves the next notes to a live refiner busy on one, and wakes for them once it is gone', () => {
    captureToBandeja(project, { text: 'first' }, clock(1000));
    seeAgent(project.db, { agent: 'lia', channel: 'cli', call: true }, clock(2000));
    noteRefiner(project, 'lia', clock(2000));
    takeBandeja(project, { id: 1, agent: 'lia' }, clock(2000));
    captureToBandeja(project, { text: 'second' }, clock(3000));
    captureToBandeja(project, { text: 'third' }, clock(4000));

    // The refiner holds B-1 and gave a sign: B-2 and B-3 are its next.
    seeAgent(project.db, { agent: 'lia', channel: 'cli', call: true }, clock(MIN));
    expect(wake(MIN + 1000)).toBeUndefined();

    // It left them for long, or is gone: they are the assistant's.
    expect(wake(12 * MIN)).toMatchObject({ kind: 'bandeja_item', ref: 'B-2' });
  });

  it('wakes at once when no refiner was ever there', () => {
    captureToBandeja(project, { text: 'first' }, clock(1000));
    expect(wake(2000)).toMatchObject({ kind: 'bandeja_item', ref: 'B-1' });
  });
});
