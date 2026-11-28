import { beforeEach, describe, expect, it } from 'vitest';
import { isLandStep, stateOf } from '../core/board/engine.ts';
import { instantiate, requireTemplate } from '../core/board/templates.ts';
import type { Actor } from '../core/item.ts';
import { appendEvent, updateItemState } from '../store/queries.ts';
import type { Context } from './context.ts';
import { createItem } from './items.ts';
import { liveBoardOf } from './next.ts';
import { pendingOf, pendingText } from './pending.ts';
import { memoryContext, publishAs } from './testing.ts';

const you = { kind: 'human' as const, name: 'fede' };
const quill = { kind: 'agent' as const, name: 'quill' };
let tick = 0;
const now = () => new Date(Date.UTC(2026, 10, 27, 9, 0, tick++)).toISOString();

// U1 (field study 4): approved was read as done, and an item that came back because it conflicted
// said nothing of why. The assistant reads `otea pending`, so it says both.
describe('what the queue says of approved and bounced items', () => {
  let ctx: Context;
  let landing: string;
  let bounced: string;

  beforeEach(() => {
    ctx = memoryContext();
    const def = instantiate(requireTemplate('changes'), 'es', {}, undefined, { keep: true });
    publishAs(ctx, def, 'bcam', now);
    const make = (title: string) =>
      createItem(
        ctx,
        {
          collection: def.name,
          title,
          fields: { want: 'x', branch: `cambio/${title}` },
          actor: you,
        },
        now,
      ).id;
    const board = liveBoardOf(ctx, def.name)?.def;
    if (!board) throw new Error('no board');
    const doing = board.steps.find((s) => !isLandStep(board, s.id) && s.reviewer === 'you')?.id;
    const land = board.steps.find((s) => isLandStep(board, s.id))?.id;
    if (!doing || !land) throw new Error('no steps');
    const [DOIT, REVIEW, LAND] = [
      stateOf({ step: doing, phase: 'doing' }),
      stateOf({ step: doing, phase: 'review' }),
      stateOf({ step: land, phase: 'doing' }),
    ];
    const move = (id: string, from: string, to: string, actor: Actor, reason?: string) => {
      updateItemState(ctx.db, id, to, now());
      appendEvent(ctx.db, {
        itemId: id,
        type: 'transitioned',
        actor,
        at: now(),
        data: { from, to, ...(reason === undefined ? {} : { reason }) },
      });
    };
    landing = make('regar');
    move(landing, REVIEW, LAND, you);
    bounced = make('podar');
    move(bounced, REVIEW, LAND, you);
    move(bounced, LAND, DOIT, quill, 'main moved: conflicts with CAM-1 in src/lista.py');
  });

  it('lists the approved item as waiting to land and the bounced one with its reason', () => {
    const pending = pendingOf(ctx, now, { blocks: true });

    expect(pending.queues[0]).toMatchObject({
      landing: [landing],
      bounced: [{ id: bounced, reason: 'main moved: conflicts with CAM-1 in src/lista.py' }],
    });
    const text = pendingText(pending);
    expect(text).toContain(`${landing} approved, waiting to land`);
    expect(text).toContain(`${bounced} came back after approval`);
    expect(text).toContain('conflicts with CAM-1');
  });
});
