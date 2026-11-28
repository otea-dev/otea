import { describe, expect, it } from 'vitest';
import { sequenceIds } from '../core/board/ids.ts';
import { creatures } from '../core/board/testing.ts';
import { createBoard, publishBoard, saveDraft } from './boards.ts';
import type { Context } from './context.ts';
import { createItem } from './items.ts';
import { claimItem } from './leases.ts';
import { nextFor, offerableTo } from './next.ts';
import { endProcess, waitBeat } from './presence.ts';
import { memoryContext } from './testing.ts';

const you = { kind: 'human' as const, name: 'fede' };
const kiln = { kind: 'agent' as const, name: 'kiln' };

const T0 = '2026-11-12T09:00:00.000Z';
const at = (time: string) => () => time;

function boardWithOneItem(ctx: Context): string {
  const def = creatures();
  const record = createBoard(ctx, { name: def.name, lang: 'es' }, at(T0), sequenceIds());
  saveDraft(ctx, record.id, { definition: def, baseVersion: null }, at(T0));
  publishBoard(ctx, record.id, { moves: {}, by: you }, at(T0));
  return createItem(
    ctx,
    {
      collection: 'Criaturas',
      title: 'Tortuga',
      fields: { fdesc: 'Lenta' },
      actor: you,
      channel: 'ui',
    },
    at(T0),
  ).id;
}

// T1a (0.8 adversarial test, concurrency and liveness): a worker killed with its harness leaves its
// item under a lease of 15 minutes. `claim` already takes such an item over (its session ended), but
// `next` and `wait` kept saying "never work on an item another agent holds" for the whole lease: the
// desk read the worker «away» at once while the other worker had nothing to take.
describe('an item held by a worker whose session ended', () => {
  const holdsAndEnds = (ctx: Context) => {
    const id = boardWithOneItem(ctx);
    // kiln waits (this test's process stands for its session) and holds the item.
    waitBeat(ctx.db, { agent: 'kiln', channel: 'cli', waiter: process.pid }, at(T0)).run();
    claimItem(ctx, { id, actor: kiln }, at(T0));
    return id;
  };

  it('is not offered while its holder session runs', () => {
    const ctx = memoryContext();
    const id = holdsAndEnds(ctx);

    expect(nextFor(ctx, 'scout', {}, at(T0)).item).toBeNull();
    expect(offerableTo(ctx, 'scout', at(T0))({ id, collection: 'Criaturas' })).toBe(false);
  });

  it('is offered to the next worker once that session ended, and the claim takes it over', () => {
    const ctx = memoryContext();
    const id = holdsAndEnds(ctx);
    endProcess(ctx.db, process.pid);

    expect(offerableTo(ctx, 'scout', at(T0))({ id, collection: 'Criaturas' })).toBe(true);
    const taken = nextFor(ctx, 'scout', { claim: true }, at(T0));

    expect(taken.item).toBe(id);
    expect(taken.lease?.holder).toBe('scout');
  });
});
