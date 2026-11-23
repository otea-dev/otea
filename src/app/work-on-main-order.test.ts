import { describe, expect, it } from 'vitest';
import { instantiate, requireTemplate } from '../core/board/templates.ts';
import { updateItemState } from '../store/queries.ts';
import { createItem } from './items.ts';
import { claimItem } from './leases.ts';
import { nextFor } from './next.ts';
import { setOrder } from './priority.ts';
import { memoryContext, publishAs } from './testing.ts';

const you = { kind: 'human' as const, name: 'fede' };
const agent = (name: string) => ({ kind: 'agent' as const, name });
let tick = 0;
const now = () => new Date(Date.UTC(2026, 10, 19, 9, 0, tick++)).toISOString();

// P1-F2: the Code on main board has every agent work straight on main with no branch, while a
// second agent in the same checkout was told to make its own worktree: three agents committing at
// once, one index.lock, a commit that was another agent's. Everyone commits on main, so the board
// takes one agent at a time on main, in the person's order, like the landing, and says so.
describe('working straight on main, one agent at a time', () => {
  function board() {
    const ctx = memoryContext();
    const def = instantiate(requireTemplate('mainline'), 'es', {}, undefined, { keep: true });
    publishAs(ctx, def, 'bmain', now);
    const doing = (title: string) => {
      const { id } = createItem(
        ctx,
        { collection: def.name, title, fields: { want: 'x' }, actor: you },
        now,
      );
      updateItemState(ctx.db, id, 'doit', now());
      return id;
    };
    return { ctx, def, doing };
  }

  it('refuses a second agent a change on main while another works on one, saying why', () => {
    const { ctx, def, doing } = board();
    const first = doing('first');
    const second = doing('second');
    claimItem(ctx, { id: first, actor: agent('claude-b') }, now);
    setOrder(ctx, { collection: def.name, ids: [first, second], actor: you }, now);

    expect(() => claimItem(ctx, { id: second, actor: agent('quill') }, now)).toThrow(
      `${second} not claimed: claude-b works on main with ${first} now, and ${second} waits for it: this board works straight on main, so one agent at a time, in the person's order, or two would change the same files. Take other work meanwhile: otea next.`,
    );
    const idle = nextFor(ctx, 'quill', {}, now);
    expect(idle).toMatchObject({ item: null, idle: true });
    expect(idle.text).toContain(
      `${second} waits to work on main: claude-b works on ${first} there now`,
    );

    // The one that is done with main lets the next one start.
    updateItemState(ctx.db, first, 'done', now());
    expect(claimItem(ctx, { id: second, actor: agent('quill') }, now).lease?.holder).toBe('quill');
  });

  it('offers the first in the person order, and refuses the one behind it', () => {
    const { ctx, def, doing } = board();
    const behind = doing('behind');
    const top = doing('top');
    setOrder(ctx, { collection: def.name, ids: [top, behind], actor: you }, now);

    expect(nextFor(ctx, 'quill', {}, now).item).toBe(top);
    expect(() => claimItem(ctx, { id: behind, actor: agent('quill') }, now)).toThrow(
      `${top} goes first on main (order 1), then ${behind}`,
    );
  });
});
