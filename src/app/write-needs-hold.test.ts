import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { instantiate, requireTemplate } from '../core/board/templates.ts';
import { updateItemState } from '../store/queries.ts';
import { attachEvidence, detachEvidence } from './evidence.ts';
import { createItem, updateItem } from './items.ts';
import { claimItem } from './leases.ts';
import { handoffItem } from './next.ts';
import { setOrder } from './priority.ts';
import { memoryContext, projectOf, publishAs } from './testing.ts';

const you = { kind: 'human' as const, name: 'fede' };
const agent = (name: string) => ({ kind: 'agent' as const, name });
let tick = 0;
const now = () => new Date(Date.UTC(2026, 10, 19, 9, 0, tick++)).toISOString();

// P1-F1: two items waiting to land in main, the second one's claim refused ("claude-b lands CAM-1
// now"); the agent went on with update and handoff, which only looked at who else held the item,
// and landed it anyway. Every write on an item is the holder's: no claim, no write.
describe('a write on an item waits its turn as the claim does', () => {
  function two() {
    const ctx = memoryContext();
    const def = instantiate(requireTemplate('changes'), 'es', {}, undefined, { keep: true });
    publishAs(ctx, def, 'bcam', now);
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
    const second = approved('second');
    claimItem(ctx, { id: first, actor: agent('claude-b') }, now);
    return { ctx, first, second };
  }

  it('refuses update, attach and handoff after a claim the landing queue refused', () => {
    const { ctx, first, second } = two();
    const quill = agent('quill');
    const dir = mkdtempSync(join(tmpdir(), 'otea-hold-'));
    const file = join(dir, 'a.txt');
    writeFileSync(file, 'x');
    expect(() => claimItem(ctx, { id: second, actor: quill }, now)).toThrow(/not claimed/);

    const held = new RegExp(`${second} not claimed: claude-b lands ${first} in main now`);
    const project = projectOf(dir, ctx);
    const as = { actor: quill, channel: 'cli' as const };
    expect(() =>
      updateItem(ctx, { id: second, fields: { commit: 'abc1234' }, actor: quill }, now),
    ).toThrow(held);
    expect(() => attachEvidence(project, { id: second, ...as, path: file }, now)).toThrow(held);
    expect(() => detachEvidence(project, { id: second, evidence: 1, ...as }, now)).toThrow(held);
    expect(() => handoffItem(ctx, { id: second, ...as }, now)).toThrow(held);
    expect(ctx.db.prepare('SELECT state FROM items WHERE id = ?').get(second)).toMatchObject({
      state: 'land',
    });
  });

  // Decided: an agent that holds no lease writes what it could claim (the item first in line), as
  // the flows built on next and offers do; what is behind another in the queue it may not.
  it('lets a lease-less agent write the item first in line, and not the one behind it', () => {
    const ctx = memoryContext();
    const def = instantiate(requireTemplate('changes'), 'es', {}, undefined, { keep: true });
    publishAs(ctx, def, 'bcam', now);
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
    const top = approved('top');
    const behind = approved('behind');
    setOrder(ctx, { collection: def.name, ids: [top, behind], actor: you }, now);
    const quill = agent('quill');

    expect(
      updateItem(ctx, { id: top, fields: { commit: 'abc1234' }, actor: quill }, now).fields,
    ).toMatchObject({ commit: 'abc1234' });
    expect(() =>
      updateItem(ctx, { id: behind, fields: { commit: 'abc1234' }, actor: quill }, now),
    ).toThrow(`${behind} not claimed: ${top} lands in main first (order 1), then ${behind}`);
  });

  // The queue check is the agents': the same write on the item behind claude-b's landing is the
  // person's to make, and an agent's to be refused.
  it('never binds the person to the queue an agent waits in', () => {
    const { ctx, first, second } = two();
    const write = (actor: ReturnType<typeof agent> | typeof you) =>
      updateItem(ctx, { id: second, fields: { commit: 'abc1234' }, actor }, now);
    expect(() => write(agent('quill'))).toThrow(`${second} not claimed: claude-b lands ${first}`);
    expect(write(you).fields).toMatchObject({ commit: 'abc1234' });
  });
});
