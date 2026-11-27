import { beforeEach, describe, expect, it } from 'vitest';
import { instantiate, requireTemplate } from '../core/board/templates.ts';
import type { Context } from './context.ts';
import { createItem } from './items.ts';
import { claimItem } from './leases.ts';
import { pendingOf, pendingText } from './pending.ts';
import { seeAgent } from './presence.ts';
import { memoryContext, publishAs } from './testing.ts';

const you = { kind: 'human' as const, name: 'fede' };
const T0 = Date.parse('2026-11-27T09:00:00.000Z');
const at = (minutes: number) => () => new Date(T0 + minutes * 60_000).toISOString();

// U3 (field study 4, wave 2b): with the secretary unable to launch workers, «open a session and
// paste text N» is the person's to do, and nothing said so: Te espera, Te toca and `otea pending`
// read «nothing waits for you» while three items waited for a session only they could open.
describe('a board with work and nobody on it waits for the person to open a worker', () => {
  let ctx: Context;
  let board: string;
  let ids: string[];

  beforeEach(() => {
    ctx = memoryContext();
    const def = instantiate(requireTemplate('changes'), 'es', {}, undefined, { keep: true });
    publishAs(ctx, def, 'bcam', at(0));
    board = def.name;
    ids = ['regar', 'podar', 'abonar'].map(
      (title) =>
        createItem(
          ctx,
          {
            collection: board,
            title,
            fields: { want: 'x', branch: `cambio/${title}` },
            actor: you,
          },
          at(0),
        ).id,
    );
  });

  it('is an entry of its own once it has waited a few minutes, and goes with the worker', () => {
    expect(pendingOf(ctx, at(1)).entries.filter(({ kind }) => kind === 'worker')).toEqual([]);

    const later = pendingOf(ctx, at(5));
    expect(later.entries).toContainEqual(
      expect.objectContaining({ kind: 'worker', ref: board, since: at(0)() }),
    );
    expect(later.count).toBe(1);
    expect(pendingText(later)).toContain(`otea prompt --role worker --board ${board}`);

    // A worker takes one of them: the board is worked, nothing waits for the person.
    seeAgent(ctx.db, { agent: 'quill', channel: 'cli', call: true }, at(6));
    claimItem(ctx, { id: ids[0] ?? '', actor: { kind: 'agent', name: 'quill' } }, at(6));
    expect(pendingOf(ctx, at(7)).entries.filter(({ kind }) => kind === 'worker')).toEqual([]);
  });
});
