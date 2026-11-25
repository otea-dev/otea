import { describe, expect, it } from 'vitest';
import { instantiate, requireTemplate } from '../core/board/templates.ts';
import { updateItemState } from '../store/queries.ts';
import { createItem } from './items.ts';
import { claimItem, releaseItem } from './leases.ts';
import { nextFor } from './next.ts';
import { setOrder } from './priority.ts';
import { reassignItem } from './restart.ts';
import { memoryContext, publishAs } from './testing.ts';

const you = { kind: 'human' as const, name: 'fede' };
const agent = (name: string) => ({ kind: 'agent' as const, name });
let tick = 0;
const now = () => new Date(Date.UTC(2026, 10, 24, 10, 0, tick++)).toISOString();

// The next to land is the one highest in the person's order. An item no agent can take now held
// nothing up, so a second one landed past it, and the first, back again, met the second's change
// on main: a conflict and another review round (field study: one item took five). An item in
// flight that the second overlaps (left for another agent, waiting for an answer) now holds it, and
// the line says what it waits for and the way out. An item set aside for later is parked: it holds
// nothing up, whatever files it shares.
describe('landing in order when two approved items change the same files', () => {
  function pair(second: string[], park: 'left' | 'aside') {
    const ctx = memoryContext();
    const def = instantiate(requireTemplate('changes'), 'es', {}, undefined, { keep: true });
    publishAs(ctx, def, 'bcam', now);
    // What each branch changes over main, as pushed.
    const pushed: Record<string, string[]> = {
      'cambio/first': ['src/shared.ts'],
      'cambio/second': second,
    };
    ctx.changed = (branch) => pushed[branch];
    const approved = (title: string) => {
      const { id } = createItem(
        ctx,
        {
          collection: def.name,
          title,
          fields: { want: 'x', branch: `cambio/${title}` },
          actor: you,
        },
        now,
      );
      updateItemState(ctx.db, id, 'land', now());
      return id;
    };
    const first = approved('first');
    const next = approved('second');
    setOrder(ctx, { collection: def.name, ids: [first, next], actor: you }, now);
    if (park === 'aside') {
      claimItem(ctx, { id: first, actor: agent('claude-b') }, now);
      releaseItem(ctx, { id: first, actor: agent('claude-b'), later: true }, now);
    } else {
      claimItem(ctx, { id: first, actor: agent('claude-b'), ttlMs: 1000 }, now);
      tick += 5;
      reassignItem(ctx, { id: first, agent: 'kiln', actor: you, channel: 'ui' }, now);
    }
    return { ctx, first, next };
  }

  it('waits for an overlapping item left for another agent, saying why and the way out', () => {
    const { ctx, first, next } = pair(['src/shared.ts', 'src/own.ts'], 'left');

    const idle = nextFor(ctx, 'claude-b', {}, now);
    expect(idle).toMatchObject({ item: null, idle: true });
    expect(idle.text).toContain(
      `${next} waits to land in main: ${first} lands there first (order 1; both change src/shared.ts; ${first} was left for kiln: move ${next} above ${first} on the Matrix, or have kiln set it aside)`,
    );
    expect(() => claimItem(ctx, { id: next, actor: agent('claude-b') }, now)).toThrow(
      `${next} not claimed: ${first} lands in main first (order 1; both change src/shared.ts; ${first} was left for kiln`,
    );

    updateItemState(ctx.db, first, 'done', now());
    expect(nextFor(ctx, 'claude-b', {}, now).item).toBe(next);
  });

  it('lands the second past it when they share no file', () => {
    const { ctx, next } = pair(['src/own.ts'], 'left');

    expect(nextFor(ctx, 'claude-b', {}, now).item).toBe(next);
  });

  it('never waits for one set aside for later, shared files or not', () => {
    const { ctx, next } = pair(['src/shared.ts'], 'aside');

    expect(nextFor(ctx, 'claude-b', {}, now).item).toBe(next);
  });
});
