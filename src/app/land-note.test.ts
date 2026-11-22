import { describe, expect, it } from 'vitest';
import { cambios, step, tareasDeRepo } from '../core/board/testing.ts';
import { updateItemState } from '../store/queries.ts';
import { createItem } from './items.ts';
import { claimItem } from './leases.ts';
import { handoffItem } from './next.ts';
import { leaveNote, replyNote, roundNotesOf } from './notes.ts';
import { memoryContext, publishAs } from './testing.ts';

const you = { kind: 'human' as const, name: 'fede' };
const agent = { kind: 'agent' as const, name: 'quill' };
let tick = 0;
const now = () => new Date(Date.UTC(2026, 10, 18, 9, 0, tick++)).toISOString();

// An item an agent lands in Integrar (the land step), which may take it back to Implementar.
function landing() {
  const ctx = memoryContext();
  const def = tareasDeRepo();
  def.steps.push(step('sland', 'Integrar', { reviewer: 'none', ways: ['simpl'] }));
  publishAs(ctx, def, 'brt', now);
  publishAs(ctx, cambios(), 'bcam', now);
  const parent = createItem(
    ctx,
    { collection: 'Cambios', title: 'Nube', fields: { fwhat: 'x' }, actor: you },
    now,
  );
  const task = createItem(
    ctx,
    {
      collection: 'Tareas de repo',
      title: 'API',
      fields: { frepo: 'api', fbranch: 'feat/x' },
      parent: parent.id,
      actor: you,
    },
    now,
  );
  updateItemState(ctx.db, task.id, 'sland', now());
  claimItem(ctx, { id: task.id, actor: agent }, now);
  return { ctx, id: task.id };
}

describe('a note left while the item is in its land step', () => {
  it('is not lost when the agent takes the item back: it is answered first, or it goes with it', () => {
    const { ctx, id } = landing();
    leaveNote(ctx, { id, text: 'Falta el caso vacío', actor: you, channel: 'ui' }, now);

    const back = () =>
      handoffItem(
        ctx,
        { id, way: 'simpl', reason: 'conflicto', actor: agent, channel: 'cli' },
        now,
      );
    // Going back waits until the note is answered, so it is never left behind unread.
    expect(back).toThrow(/note/i);
    replyNote(ctx, { id, note: 1, text: 'Lo miro', actor: agent, channel: 'cli' }, now);
    expect(back).not.toThrow();
    expect(roundNotesOf(ctx, id)).toEqual([]);
  });
});
