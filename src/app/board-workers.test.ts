import { beforeEach, describe, expect, it } from 'vitest';
import { SILENT_AFTER_MS } from '../core/agent-status.ts';
import { cambios, tareasDeRepo } from '../core/board/testing.ts';
import { appendEvent, updateItemState } from '../store/queries.ts';
import { BETWEEN_ITEMS_MS } from './board-workers.ts';
import type { Context } from './context.ts';
import { createItem } from './items.ts';
import { claimItem, releaseItem } from './leases.ts';
import { nextFor } from './next.ts';
import { seeAgent } from './presence.ts';
import { declareSecretary } from './secretary.ts';
import { memoryContext, publishAs } from './testing.ts';

const T0 = Date.parse('2026-11-26T10:00:00.000Z');
const at = (ms: number) => () => new Date(T0 + ms).toISOString();
const you = { kind: 'human' as const, name: 'fede' };
const agent = (name: string) => ({ kind: 'agent' as const, name });
const running = () => true;

// F2 (field study 3): the secretary launched a second worker beside a live one on the same board;
// both did the same item and a branch was pushed that no item owned.
describe('one live worker per board', () => {
  let ctx: Context;

  beforeEach(() => {
    ctx = memoryContext();
    publishAs(ctx, tareasDeRepo(), 'brt', at(0));
    publishAs(ctx, cambios(), 'bcam', at(0));
  });

  const change = (title: string) =>
    createItem(
      ctx,
      { collection: 'Cambios', title, fields: { fwhat: title }, actor: you, channel: 'ui' },
      at(0),
    ).id;

  // Each Tarea de repo is part of a Cambio.
  const repoTask = (title: string, branch: string) => {
    const { id } = createItem(
      ctx,
      {
        collection: 'Tareas de repo',
        title,
        fields: { frepo: 'api', fbranch: branch },
        parent: change(`Whole of ${title}`),
        actor: you,
        channel: 'ui',
      },
      at(0),
    );
    updateItemState(ctx.db, id, 'simpl', at(0)());
    return id;
  };

  // The agent is at work: seen now, holding what it claimed.
  const claim = (name: string, id: string, ms = 1000) => {
    seeAgent(ctx.db, { agent: name, channel: 'cli', call: true }, at(ms));
    return claimItem(ctx, { id, actor: agent(name) }, at(ms));
  };

  it('refuses a second worker an item while a live one holds another of the board', () => {
    declareSecretary(ctx.db, 'sol', at(0), running);
    const [first, second] = [change('A'), change('B')] as [string, string];
    claim('ana-cambios', first);

    expect(() => claim('bea-cambios', second, 2000)).toThrow(
      expect.objectContaining({
        code: 'not_claimable',
        message: expect.stringContaining('already works the board Cambios'),
      }),
    );
  });

  it('lets the worker that is there take its next item, and any worker once it is gone', () => {
    declareSecretary(ctx.db, 'sol', at(0), running);
    const [first, second] = [change('A'), change('B')] as [string, string];
    claim('ana-cambios', first);
    releaseItem(ctx, { id: first, actor: agent('ana-cambios') }, at(1500));

    expect(claim('ana-cambios', second, 2000).lease?.holder).toBe('ana-cambios');
    releaseItem(ctx, { id: second, actor: agent('ana-cambios') }, at(2500));
    // Quiet past the time between two items and its window: the board has no worker.
    const later = BETWEEN_ITEMS_MS + 10 * 60_000;
    expect(claim('bea-cambios', second, later).lease?.holder).toBe('bea-cambios');
  });

  it('says who holds the board, until when, and what to run to wait for it', () => {
    declareSecretary(ctx.db, 'sol', at(0), running);
    const [first, second] = [change('A'), change('B')] as [string, string];
    claim('ana-cambios', first);

    expect(() => claim('bea-cambios', second, 2000)).toThrow(
      expect.objectContaining({
        message: expect.stringMatching(
          /ana-cambios \(until 2026-11-26 10:15 UTC\) already works the board Cambios.*otea wait --turn agent --unclaimed --as bea-cambios/,
        ),
      }),
    );
  });

  // A CLI worker that crashed leaves a lease and no process: the board is free once it has given no
  // sign for SILENT_AFTER_MS, not when the (longer) lease runs out.
  it('frees the board of a crashed CLI worker once it gave no sign for the silent time', () => {
    declareSecretary(ctx.db, 'sol', at(0), running);
    const [first, second] = [change('A'), change('B')] as [string, string];
    claimItem(ctx, { id: first, actor: agent('ana-cambios'), ttlMs: 60 * 60_000 }, at(0));
    seeAgent(ctx.db, { agent: 'ana-cambios', channel: 'cli', call: true }, at(0));

    expect(() => claim('bea-cambios', second, SILENT_AFTER_MS - 60_000)).toThrow(
      expect.objectContaining({ code: 'not_claimable' }),
    );
    expect(claim('bea-cambios', second, SILENT_AFTER_MS + 60_000).lease?.holder).toBe(
      'bea-cambios',
    );
  });

  it('does not count an agent that only reviewed or sent back: that is no worker of the board', () => {
    declareSecretary(ctx.db, 'sol', at(0), running);
    const [first, second] = [change('A'), change('B')] as [string, string];
    // A reviewer, connected, whose last move was out of a review step (a send-back).
    seeAgent(ctx.db, { agent: 'rita-review', channel: 'cli', call: true }, at(1000));
    appendEvent(ctx.db, {
      itemId: first,
      type: 'transitioned',
      actor: agent('rita-review'),
      at: at(1000)(),
      data: { from: 'sanalyse__review', to: 'sanalyse' },
    });

    expect(claim('bea-cambios', second, 2000).lease?.holder).toBe('bea-cambios');
  });

  it('counts an agent that just handed a doing step off, though it holds nothing now', () => {
    declareSecretary(ctx.db, 'sol', at(0), running);
    const [first, second] = [change('A'), change('B')] as [string, string];
    seeAgent(ctx.db, { agent: 'ana-cambios', channel: 'cli', call: true }, at(1000));
    appendEvent(ctx.db, {
      itemId: first,
      type: 'transitioned',
      actor: agent('ana-cambios'),
      at: at(1000)(),
      data: { from: 'sanalyse', to: 'sanalyse__review' },
    });

    expect(() => claim('bea-cambios', second, 2000)).toThrow(
      expect.objectContaining({ code: 'not_claimable' }),
    );
  });

  it('takes no stand in a project with no secretary: agents are free to share a board', () => {
    const [first, second] = [change('A'), change('B')] as [string, string];
    claim('ana-cambios', first);

    expect(claim('bea-cambios', second, 2000).lease?.holder).toBe('bea-cambios');
  });

  it('offers a second worker the next item of another board, not the one it would be refused', () => {
    declareSecretary(ctx.db, 'sol', at(0), running);
    const [first] = [change('A'), change('B')] as [string, string];
    const task = repoTask('C', 'feat/c');
    claim('ana-cambios', first);
    seeAgent(ctx.db, { agent: 'bea-repo', channel: 'cli', call: true }, at(2000));

    const offered = nextFor(ctx, 'bea-repo', { claim: true }, at(2000));

    expect(offered.item).toBe(task);
  });

  it('allows two on a board that merges code, and no third', () => {
    declareSecretary(ctx.db, 'sol', at(0), running);
    const [a, b, c] = [
      repoTask('A', 'feat/a'),
      repoTask('B', 'feat/b'),
      repoTask('C', 'feat/c'),
    ] as [string, string, string];
    claim('ana-repo', a);
    claim('bea-repo', b, 2000);

    expect(() => claim('cleo-repo', c, 3000)).toThrow(
      expect.objectContaining({ code: 'not_claimable' }),
    );
  });

  it('says so, and takes nothing, when it offers work to a second worker through next --claim', () => {
    declareSecretary(ctx.db, 'sol', at(0), running);
    const [first] = [change('A'), change('B')] as [string, string];
    claim('ana-cambios', first);
    seeAgent(ctx.db, { agent: 'bea-cambios', channel: 'cli', call: true }, at(2000));

    const offered = nextFor(ctx, 'bea-cambios', { claim: true }, at(2000));

    expect(offered.item).toBeNull();
    expect(offered.text).toContain('already works the board Cambios');
  });
});
