import { describe, expect, it } from 'vitest';
import { declareAssistant } from './assistant.ts';
import { captureToBandeja, takeBandeja } from './bandeja.ts';
import { addCollection } from './collections.ts';
import { createItem } from './items.ts';
import { claimItem } from './leases.ts';
import { listAgents, noteHarness, seeAgent } from './presence.ts';
import { memoryContext, projectOf } from './testing.ts';

const T0 = Date.parse('2026-11-27T10:00:00.000Z');
const at = (ms: number) => () => new Date(T0 + ms).toISOString();

// U7/U8 (field study 4): with the assistant's session dead the top bar still said «1 trabajando»:
// what the assistant holds (an item it made and claimed, a note it refines itself) is never the work
// the person counts, whatever its session or its lease say.
describe('the assistant is never counted as working', () => {
  it('reads away or connected, never working, while it holds an item and its harness runs', () => {
    const project = projectOf('/nowhere', memoryContext());
    addCollection(project, { name: 'tasks' });
    seeAgent(project.db, { agent: 'sol', channel: 'cli', call: true }, at(0));
    declareAssistant(project.db, 'sol', at(0));
    createItem(
      project,
      {
        collection: 'tasks',
        title: 'T',
        fields: { description: 'D' },
        actor: { kind: 'agent', name: 'sol' },
      },
      at(0),
    );
    claimItem(project, { id: 'TASKS-1', actor: { kind: 'agent', name: 'sol' } }, at(0));
    takeBandeja(
      project,
      { id: captureToBandeja(project, { text: 'una idea' }, at(0)).entry.id, agent: 'sol' },
      at(0),
    );
    noteHarness(project.db, 'sol', process.pid, at(0), true);

    const statusAt = (minutes: number) =>
      listAgents(project.db, at(minutes * 60_000)).find(({ name }) => name === 'sol');
    // Its lease is live at minute 1, which makes any other agent «working».
    expect(statusAt(1)?.holding).toEqual(['TASKS-1']);
    for (const minutes of [1, 20, 40]) expect(statusAt(minutes)?.status).not.toBe('working');
  });
});
