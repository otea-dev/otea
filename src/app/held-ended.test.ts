import { describe, expect, it } from 'vitest';
import { sequenceIds } from '../core/board/ids.ts';
import { creatures } from '../core/board/testing.ts';
import { createBoard, publishBoard, saveDraft } from './boards.ts';
import type { Context } from './context.ts';
import { createItem, requireItem } from './items.ts';
import { claimItem } from './leases.ts';
import { itemNextText } from './next.ts';
import { pendingOf, pendingText } from './pending.ts';
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

// Field study 5, V7: a restarted assistant said «un trabajador lo tiene en marcha» about an item
// whose worker had died: `otea show` only gave «Held by <agent> until <time>», and nothing told
// the assistant the session was over. Both say it now.
describe('an item held by an agent whose session ended', () => {
  const held = (ctx: Context) => {
    const id = boardWithOneItem(ctx);
    // kiln waits (this test's process stands for its session) and holds the item.
    waitBeat(ctx.db, { agent: 'kiln', channel: 'cli', waiter: process.pid }, at(T0)).run();
    claimItem(ctx, { id, actor: kiln }, at(T0));
    return id;
  };
  const shown = (ctx: Context, id: string) =>
    itemNextText(ctx, requireItem(ctx.db, id), 'sol', at(T0)) ?? '';

  it('reads held by it while its session runs, with nothing said of an end', () => {
    const ctx = memoryContext();
    const id = held(ctx);

    expect(shown(ctx, id)).toMatch(/Held by kiln until /);
    expect(shown(ctx, id)).not.toContain('session ended');
    expect(pendingText(pendingOf(ctx, at(T0))).toLowerCase()).not.toContain('session ended');
  });

  it('is said by show: kiln’s session ended, so nobody is working on it', () => {
    const ctx = memoryContext();
    const id = held(ctx);
    endProcess(ctx.db, process.pid);

    const text = shown(ctx, id);

    expect(text).toContain("kiln's session ended");
    expect(text).toContain('nobody is working on it');
  });

  it('is said by pending, apart from what waits for the person', () => {
    const ctx = memoryContext();
    const id = held(ctx);
    endProcess(ctx.db, process.pid);

    const pending = pendingOf(ctx, at(T0));

    expect(pending.ended).toEqual([{ id, title: 'Tortuga', holder: 'kiln' }]);
    expect(pendingText(pending)).toContain(`${id} «Tortuga» (kiln's session ended)`);
    expect(pendingText(pending)).toMatch(/nobody is working on it/);
  });
});
