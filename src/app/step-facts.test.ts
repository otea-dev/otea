import { beforeEach, describe, expect, it } from 'vitest';
import { instantiate, requireTemplate } from '../core/board/templates.ts';
import type { Actor } from '../core/item.ts';
import { appendEvent, updateItemState } from '../store/queries.ts';
import type { Context } from './context.ts';
import { createItem, getItem } from './items.ts';
import { liveBoardOf } from './next.ts';
import { stepFactsOf } from './step-facts.ts';
import { memoryContext, publishAs } from './testing.ts';

const you = { kind: 'human' as const, name: 'fede' };
const quill = { kind: 'agent' as const, name: 'quill' };
let tick = 0;
const now = () => new Date(Date.UTC(2026, 10, 19, 9, 0, tick++)).toISOString();

// U1 (field study 4): approved was read as done, and an item that came back to its step because it
// conflicted with another that landed first said nothing of why. The facts the cards read.
describe('what a card says of an approved item', () => {
  let ctx: Context;
  let id: string;

  beforeEach(() => {
    ctx = memoryContext();
    const def = instantiate(requireTemplate('changes'), 'es', {}, undefined, { keep: true });
    publishAs(ctx, def, 'bcam', now);
    id = createItem(
      ctx,
      {
        collection: def.name,
        title: 'Regar',
        fields: { want: 'x', branch: 'cambio/regar' },
        actor: you,
      },
      now,
    ).id;
  });

  const facts = () => {
    const item = getItem(ctx, id, now);
    const def = liveBoardOf(ctx, item.collection)?.def;
    return stepFactsOf(def, item, item.events);
  };
  const move = (from: string, to: string, actor: Actor = quill, reason?: string) => {
    updateItemState(ctx.db, id, to, now());
    appendEvent(ctx.db, {
      itemId: id,
      type: 'transitioned',
      actor,
      at: now(),
      data: { from, to, ...(reason === undefined ? {} : { reason }) },
    });
  };

  it('says it is landing while an agent has yet to merge what you approved', () => {
    move('doit__review', 'land', you);

    expect(facts()).toEqual({ landing: true });
  });

  it('says it came back, and why, once an agent took it back from landing', () => {
    move('doit__review', 'land', you);
    move('land', 'doit', quill, 'main moved: src/server.ts conflicts with CAM-2');

    expect(facts()).toEqual({
      bounced: expect.objectContaining({
        by: 'quill',
        reason: 'main moved: src/server.ts conflicts with CAM-2',
      }),
    });
  });

  it('says nothing of a fresh item, or once it was handed in again', () => {
    expect(facts()).toEqual({});

    move('doit__review', 'land', you);
    move('land', 'doit', quill, 'conflict');
    move('doit', 'doit__review', quill);
    expect(facts()).toEqual({});
  });
});
