import { describe, expect, it } from 'vitest';
import { instantiate, requireTemplate } from '../core/board/templates.ts';
import { appendEvent } from '../store/queries.ts';
import { createItem } from './items.ts';
import { memoryContext, publishAs } from './testing.ts';
import { repeatedRound, repeatsLastRound, type Tip } from './tips.ts';

const you = { kind: 'human' as const, name: 'fede' };
const quill = { kind: 'agent' as const, name: 'quill' };
let tick = 0;
const now = () => new Date(Date.UTC(2026, 10, 19, 9, 0, tick++)).toISOString();

const tip = (commit: string, tree: string, branch = 'cambio/1-regar'): Tip => ({
  branch,
  commit,
  tree,
});

// P5-F2: a handoff whose work holds the same files as the round it answers. The handoffs are
// recorded as the CLI records them: a move from the step the agent did into its review, with the
// tip of the branch.
describe('a round that repeats the last one', () => {
  function item() {
    const ctx = memoryContext();
    const def = instantiate(requireTemplate('mainline'), 'es', {}, undefined, { keep: true });
    publishAs(ctx, def, 'bmain', now);
    const { id } = createItem(
      ctx,
      { collection: def.name, title: 'Regar', fields: { want: 'x' }, actor: you },
      now,
    );
    const handoff = (from: string, to: string, recorded?: Tip) =>
      appendEvent(ctx.db, {
        itemId: id,
        type: 'transitioned',
        actor: quill,
        at: now(),
        data: { from, to, ...(recorded ? { tip: recorded } : {}) },
      });
    return { ctx, id, handoff };
  }

  it('says nothing for the first round', () => {
    const { ctx, id, handoff } = item();
    handoff('doit', 'doit__review', tip('a1', 'tree-1'));
    expect(repeatedRound(ctx, id)).toBeUndefined();
  });

  it('names the earlier round when the same step hands off the same tree again', () => {
    const { ctx, id, handoff } = item();
    handoff('doit', 'doit__review', tip('a1', 'tree-1'));
    handoff('doit', 'doit__review', tip('b2', 'tree-1'));
    expect(repeatedRound(ctx, id)).toMatchObject({ commit: 'a1', round: 1 });
  });

  it('says nothing when the round changed a file', () => {
    const { ctx, id, handoff } = item();
    handoff('doit', 'doit__review', tip('a1', 'tree-1'));
    handoff('doit', 'doit__review', tip('b2', 'tree-2'));
    expect(repeatedRound(ctx, id)).toBeUndefined();
  });

  // The landing step hands the tree it was given: that is not a round that changed nothing.
  it('never compares the handoffs of two different steps', () => {
    const { ctx, id, handoff } = item();
    handoff('doit', 'doit__review', tip('a1', 'tree-1'));
    handoff('land', 'land__review', tip('a1', 'tree-1'));
    expect(repeatedRound(ctx, id)).toBeUndefined();
  });

  it('never compares the tips of two different branches', () => {
    const { ctx, id, handoff } = item();
    handoff('doit', 'doit__review', tip('a1', 'tree-1', 'cambio/1-regar'));
    handoff('doit', 'doit__review', tip('b2', 'tree-1', 'cambio/2-otro'));
    expect(repeatedRound(ctx, id)).toBeUndefined();
  });

  it('is told before the handoff is recorded, from the step the agent is doing', () => {
    const { ctx, id, handoff } = item();
    handoff('doit', 'doit__review', tip('a1', 'tree-1'));
    expect(repeatsLastRound(ctx, id, 'doit', tip('b2', 'tree-1'))).toMatchObject({
      commit: 'a1',
      round: 1,
    });
    expect(repeatsLastRound(ctx, id, 'land', tip('b2', 'tree-1'))).toBeUndefined();
    expect(repeatsLastRound(ctx, id, 'doit', tip('b2', 'tree-2'))).toBeUndefined();
    expect(repeatsLastRound(ctx, id, 'doit', tip('b2', 'tree-1', 'cambio/2-otro'))).toBeUndefined();
  });
});
