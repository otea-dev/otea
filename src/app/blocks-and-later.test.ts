import { describe, expect, it } from 'vitest';
import { sequenceIds } from '../core/board/ids.ts';
import { creatures } from '../core/board/testing.ts';
import { OteaError } from '../core/errors.ts';
import { insertEvidence } from '../store/queries.ts';
import { createBoard, publishBoard, saveDraft } from './boards.ts';
import type { Context } from './context.ts';
import { createItem, requireItem } from './items.ts';
import { claimItem, releaseItem } from './leases.ts';
import { approveItem, handoffItem, itemNextText, nextFor } from './next.ts';
import { linkItems } from './relations.ts';
import { memoryContext } from './testing.ts';

// Field study G7 day 2: `otea link PRE-5 blocks PIE-6` did not stop an agent taking PIE-6, though
// the desk said it waited.

const you = { kind: 'human' as const, name: 'fede' };
const kiln = { kind: 'agent' as const, name: 'kiln' };
const quill = { kind: 'agent' as const, name: 'quill' };

let tick = 0;
const now = () => new Date(Date.UTC(2026, 10, 19, 9, 0, tick++)).toISOString();

// Criaturas as it is: no step declares that it waits for blockers.
function plainBoard(ctx: Context) {
  const def = creatures();
  const record = createBoard(ctx, { name: def.name, lang: 'es' }, now, sequenceIds());
  saveDraft(ctx, record.id, { definition: def, baseVersion: null }, now);
  publishBoard(ctx, record.id, { moves: {}, by: you }, now);
}

function creature(ctx: Context, title: string) {
  return createItem(
    ctx,
    { collection: 'Criaturas', title, fields: { fdesc: 'Lenta' }, actor: you, channel: 'ui' },
    now,
  );
}

// An item standing in Animar's doing, the agents' work.
function animating(ctx: Context, title: string) {
  const item = creature(ctx, title);
  insertEvidence(ctx.db, {
    itemId: item.id,
    role: 'after',
    module: 'eart',
    kind: 'image',
    filename: 'a.png',
    contentType: 'image/png',
    size: 1,
    sha256: 'a'.repeat(64),
    caption: null,
    createdAt: now(),
    actor: quill,
    channel: 'cli',
  });
  handoffItem(ctx, { id: item.id, actor: quill, channel: 'cli' }, now);
  approveItem(ctx, { id: item.id, actor: you, channel: 'ui' }, now);
  return item;
}

function refusal(run: () => unknown): OteaError {
  try {
    run();
  } catch (error) {
    if (error instanceof OteaError) return error;
    throw error;
  }
  throw new Error('not refused');
}

describe('an item that something open blocks', () => {
  it('is not offered, claimed or shown as the agent’s turn, and names what it waits for', () => {
    const ctx = memoryContext();
    plainBoard(ctx);
    const blocker = creature(ctx, 'Antes');
    const blocked = animating(ctx, 'Despues');
    linkItems(
      ctx,
      { id: blocker.id, kind: 'blocks', other: blocked.id, actor: you, channel: 'ui' },
      now,
    );

    const answer = nextFor(ctx, 'kiln', { claim: true }, now);
    expect(answer.item).not.toBe(blocked.id);
    const refused = refusal(() => claimItem(ctx, { id: blocked.id, actor: kiln }, now));
    expect(refused.code).toBe('not_claimable');
    expect(refused.message).toContain(blocker.id);
    const shown = itemNextText(ctx, requireItem(ctx.db, blocked.id), 'kiln', now) ?? '';
    expect(shown).toContain(blocker.id);
    expect(shown).not.toContain('Your turn');
  });
});

describe('a block linked after an agent took the item', () => {
  it('lets the holder keep working, with a note, and refuses new claims', () => {
    const ctx = memoryContext();
    plainBoard(ctx);
    const blocker = creature(ctx, 'Antes');
    const held = animating(ctx, 'En curso');
    claimItem(ctx, { id: held.id, actor: kiln }, now);
    linkItems(
      ctx,
      { id: blocker.id, kind: 'blocks', other: held.id, actor: you, channel: 'ui' },
      now,
    );

    expect(nextFor(ctx, 'kiln', {}, now).item).toBe(held.id);
    expect(() => claimItem(ctx, { id: held.id, actor: kiln }, now)).not.toThrow();
    const shown = itemNextText(ctx, requireItem(ctx.db, held.id), 'kiln', now) ?? '';
    expect(shown).toContain('Your turn');
    expect(shown).toContain(`${blocker.id} blocks it`);
    const refused = refusal(() => claimItem(ctx, { id: held.id, actor: quill }, now));
    expect(refused.message).toContain(`otea unlink ${blocker.id} blocks ${held.id}`);
  });

  it('is refused as a link that would close a cycle', () => {
    const ctx = memoryContext();
    plainBoard(ctx);
    const a = creature(ctx, 'A');
    const b = creature(ctx, 'B');
    linkItems(ctx, { id: a.id, kind: 'blocks', other: b.id, actor: you, channel: 'ui' }, now);

    const refused = refusal(() =>
      linkItems(ctx, { id: b.id, kind: 'blocks', other: a.id, actor: you, channel: 'ui' }, now),
    );

    expect(refused.code).toBe('relation_cycle');
  });

  it('says so when every blocker is set aside, and how to bring it back or unlink', () => {
    const ctx = memoryContext();
    plainBoard(ctx);
    const blocker = animating(ctx, 'Antes');
    const blocked = animating(ctx, 'Despues');
    claimItem(ctx, { id: blocker.id, actor: kiln }, now);
    releaseItem(ctx, { id: blocker.id, actor: kiln, later: true }, now);
    linkItems(
      ctx,
      { id: blocker.id, kind: 'blocks', other: blocked.id, actor: you, channel: 'ui' },
      now,
    );

    const shown = itemNextText(ctx, requireItem(ctx.db, blocked.id), 'quill', now) ?? '';

    expect(shown).toContain(`${blocker.id} is set aside for later`);
    expect(shown).toContain(`otea claim ${blocker.id}`);
    expect(shown).toContain(`otea unlink ${blocker.id} blocks ${blocked.id}`);
  });
});

describe('a step that declares it waits for blockers', () => {
  it('keeps its own message, not the general one', () => {
    const ctx = memoryContext();
    const def = creatures();
    def.steps = def.steps.map((s) =>
      s.id === 'sanimate' ? { ...s, waits: ['blockers' as const] } : s,
    );
    const record = createBoard(ctx, { name: def.name, lang: 'es' }, now, sequenceIds());
    saveDraft(ctx, record.id, { definition: def, baseVersion: null }, now);
    publishBoard(ctx, record.id, { moves: {}, by: you }, now);
    const blocker = creature(ctx, 'Antes');
    const blocked = animating(ctx, 'Despues');
    linkItems(
      ctx,
      { id: blocker.id, kind: 'blocks', other: blocked.id, actor: you, channel: 'ui' },
      now,
    );

    const shown = itemNextText(ctx, requireItem(ctx.db, blocked.id), 'kiln', now) ?? '';

    expect(shown).not.toContain('Not yet');
    expect(shown).toContain(blocker.id);
  });
});

// G2 day 2: an item set aside with release --later vanished from every agent's next.
describe('an item set aside for later', () => {
  it('stays out of the queue but next says how many are set aside and how to bring one back', () => {
    const ctx = memoryContext();
    plainBoard(ctx);
    const aside = animating(ctx, 'Para luego');
    const other = animating(ctx, 'Ahora');
    claimItem(ctx, { id: aside.id, actor: kiln }, now);
    releaseItem(ctx, { id: aside.id, actor: kiln, later: true }, now);

    const answer = nextFor(ctx, 'kiln', {}, now);

    expect(answer.item).toBe(other.id);
    expect(answer.text).toContain(`1 set aside for later (${aside.id})`);
    expect(answer.text).toContain(`otea claim ${aside.id}`);
  });
});
