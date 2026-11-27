import { describe, expect, it } from 'vitest';
import { sequenceIds } from '../core/board/ids.ts';
import { creatures } from '../core/board/testing.ts';
import { createBoard, publishBoard, saveDraft } from './boards.ts';
import type { Context } from './context.ts';
import { createItem, listItems } from './items.ts';
import { claimItem } from './leases.ts';
import { pendingOf } from './pending.ts';
import { seeAgent } from './presence.ts';
import { memoryContext } from './testing.ts';

const you = { kind: 'human' as const, name: 'fede' };
const kiln = { kind: 'agent' as const, name: 'kiln' };

const T0 = '2026-11-12T09:00:00.000Z';
// The default lease is 15 minutes: twenty later it has run out.
const LATER = '2026-11-12T09:20:00.000Z';
const at = (time: string) => () => time;

function claimed(ctx: Context): string {
  const def = creatures();
  const record = createBoard(ctx, { name: def.name, lang: 'es' }, at(T0), sequenceIds());
  saveDraft(ctx, record.id, { definition: def, baseVersion: null }, at(T0));
  publishBoard(ctx, record.id, { moves: {}, by: you }, at(T0));
  const id = createItem(
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
  claimItem(ctx, { id, actor: kiln }, at(T0));
  return id;
}

// Field study 5, V2: `claim --ttl 1m`, let it lapse, run any otea command as the same agent: the
// desk said «Atasco · reserva vencida» in red, and `pending` listed it as stuck, while the panel
// said the agent was connected. A lease that ran out under an agent that is there only sends the
// item back to the queue.
describe('a lease that ran out', () => {
  it('under a connected agent is marked so, and is no stuck item for the person', () => {
    const ctx = memoryContext();
    const id = claimed(ctx);
    seeAgent(ctx.db, { agent: 'kiln', channel: 'cli' }, at(LATER));

    const item = listItems(ctx, {}, at(LATER)).find((each) => each.id === id);

    expect(item?.lease).toBeNull();
    expect(item?.expiredLease).toMatchObject({ holder: 'kiln', connected: true });
    expect(pendingOf(ctx, at(LATER)).entries.filter(({ kind }) => kind === 'stuck')).toEqual([]);
  });

  it('under an agent that went quiet is the stuck item it always was', () => {
    const ctx = memoryContext();
    const id = claimed(ctx);
    const later = '2026-11-12T12:00:00.000Z';

    const item = listItems(ctx, {}, at(later)).find((each) => each.id === id);

    expect(item?.expiredLease?.connected).toBeUndefined();
    expect(pendingOf(ctx, at(later)).entries.filter(({ kind }) => kind === 'stuck')).toMatchObject([
      { ref: id, by: 'kiln' },
    ]);
  });
});
