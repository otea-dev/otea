import { describe, expect, it } from 'vitest';
import { addCollection } from '../app/collections.ts';
import { createItem, moveItem } from '../app/items.ts';
import { claimItem } from '../app/leases.ts';
import { seeAgent } from '../app/presence.ts';
import { addTopic, answerTopic, setTopicsOn } from '../app/topics.ts';
import type { Actor } from '../core/item.ts';
import { countsOf } from './projects.ts';
import { memoryProject } from './testing.ts';

const bot: Actor = { kind: 'agent', name: 'claude' };

// The projects page's «Te espera» and the count beside the switcher say the same as Te toca: an
// item whose agent went quiet (its lease ran out) waits for you to restart or reassign it. It was
// counted with the agents' and missing from «Te espera» (ONB3-5).
describe('what waits for you in a project', () => {
  it('lists an item whose agent went quiet with what waits for you, not with the agents', () => {
    const project = memoryProject();
    addCollection(project, { name: 'tasks' });
    const made = (title: string) =>
      createItem(project, { collection: 'tasks', title, fields: { description: 'x' }, actor: bot })
        .id;
    const review = made('To review');
    const quiet = made('Gone quiet');
    made('Queued for an agent');
    moveItem(project, { id: review, to: 'in_progress', actor: bot, channel: 'cli' });
    moveItem(project, { id: review, to: 'review', actor: bot, channel: 'cli' });
    claimItem(project, { id: quiet, actor: bot, ttlMs: 1 }, () => '2020-01-01T00:00:00.000Z');

    const counts = countsOf(project);
    expect(counts.waiting.map((item) => item.title)).toEqual(['To review', 'Gone quiet']);
    expect(counts.withAgents).toBe(1);
    expect(counts.open).toBe(3);
  });

  // «Todos los proyectos» lists the topics an agent answered: your turn too, though never work.
  it('lists the topics an agent answered, the oldest first, and leaves them out of the items', () => {
    const project = memoryProject();
    setTopicsOn(project, true);
    addTopic(
      project,
      { question: '¿ESM o CommonJS?', actor: bot },
      () => '2026-11-17T10:00:00.000Z',
    );
    addTopic(project, { question: '¿Qué licencia?', actor: bot }, () => '2026-11-17T10:01:00.000Z');
    addTopic(project, { question: 'Sin responder', actor: bot }, () => '2026-11-17T10:02:00.000Z');
    answerTopic(
      project,
      { id: 'TEM-2', summary: 'MIT.', actor: bot },
      () => '2026-11-17T11:00:00.000Z',
    );
    answerTopic(
      project,
      { id: 'TEM-1', summary: 'ESM.', actor: bot },
      () => '2026-11-17T12:00:00.000Z',
    );

    const counts = countsOf(project);
    expect(counts.topics).toEqual([
      {
        id: 'TEM-2',
        title: '¿Qué licencia?',
        summary: 'MIT.',
        agent: 'claude',
        updatedAt: '2026-11-17T11:00:00.000Z',
      },
      {
        id: 'TEM-1',
        title: '¿ESM o CommonJS?',
        summary: 'ESM.',
        agent: 'claude',
        updatedAt: '2026-11-17T12:00:00.000Z',
      },
    ]);
    expect(counts.waiting).toEqual([]);
  });
});

// P6-F7: the switcher says what each project has going on: which agents are there and what each
// is doing, in the server's own words (status), never derived by the page.
describe('the agents of a project, as the switcher says them', () => {
  it('lists the agents that are not away with the server’s status, and none for a quiet project', () => {
    const project = memoryProject();
    expect(countsOf(project).agents).toEqual([]);

    addCollection(project, { name: 'tasks' });
    const { id } = createItem(project, {
      collection: 'tasks',
      title: 'Work',
      fields: { description: 'x' },
      actor: bot,
    });
    seeAgent(project.db, { agent: 'claude', channel: 'cli', call: true });
    claimItem(project, { id, actor: bot });

    expect(countsOf(project).agents).toEqual([{ name: 'claude', status: 'working', holding: 1 }]);
  });

  // P6-F1: an agent whose lease ran out is `away` in the API and was dropped here, so «Todos los
  // proyectos» lost it while its own project listed it. It stays, with the same status, while it
  // has an item stuck; an away agent that left nothing behind is still left out.
  it('keeps an away agent that left an item stuck, and leaves out one that left nothing', () => {
    const project = memoryProject();
    addCollection(project, { name: 'tasks' });
    const { id } = createItem(project, {
      collection: 'tasks',
      title: 'Stuck',
      fields: { description: 'x' },
      actor: bot,
    });
    const past = () => '2020-01-01T00:00:00.000Z';
    seeAgent(project.db, { agent: 'claude', channel: 'cli', call: true }, past);
    seeAgent(project.db, { agent: 'ghost', channel: 'cli', call: true }, past);
    claimItem(project, { id, actor: bot, ttlMs: 1 }, past);

    expect(countsOf(project).agents).toEqual([{ name: 'claude', status: 'away', holding: 0 }]);
  });
});
