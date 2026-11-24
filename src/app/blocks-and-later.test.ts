import { describe, expect, it } from 'vitest';
import { sequenceIds } from '../core/board/ids.ts';
import { creatures } from '../core/board/testing.ts';
import { OteaError } from '../core/errors.ts';
import { insertEvidence } from '../store/queries.ts';
import { createBoard, publishBoard, saveDraft } from './boards.ts';
import type { Context } from './context.ts';
import { createItem, requireItem } from './items.ts';
import { claimItem } from './leases.ts';
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
