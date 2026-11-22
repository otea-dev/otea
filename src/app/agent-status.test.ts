import { describe, expect, it } from 'vitest';
import { sequenceIds } from '../core/board/ids.ts';
import { creatures } from '../core/board/testing.ts';
import { insertEvidence } from '../store/queries.ts';
import { createBoard, publishBoard, saveDraft } from './boards.ts';
import type { Context } from './context.ts';
import { createItem } from './items.ts';
import { claimItem } from './leases.ts';
import { handoffItem } from './next.ts';
import { listAgents, seeAgent } from './presence.ts';
import { answerQuestion, askQuestion } from './questions.ts';
import { memoryContext } from './testing.ts';

// The server's one status per agent, through the real paths: a board handoff, a question, a lease.

const you = { kind: 'human' as const, name: 'fede' };
const kiln = { kind: 'agent' as const, name: 'kiln' };

const T0 = Date.UTC(2026, 10, 13, 13, 0, 0);
const at = (seconds: number) => () => new Date(T0 + seconds * 1000).toISOString();
const iso = (seconds: number) => new Date(T0 + seconds * 1000).toISOString();

// A creature kiln claimed at second 0, on a published board, with the art Concepto asks for.
function working(ctx: Context) {
  const def = creatures();
  const record = createBoard(ctx, { name: def.name, lang: 'es' }, at(0), sequenceIds());
  saveDraft(ctx, record.id, { definition: def, baseVersion: null }, at(0));
  publishBoard(ctx, record.id, { moves: {}, by: you }, at(0));
  const item = createItem(
    ctx,
    { collection: 'Criaturas', title: 'Tortuga', fields: { fdesc: 'Lenta' }, actor: you },
    at(0),
  );
  seeAgent(ctx.db, { agent: 'kiln', channel: 'cli', call: true }, at(0));
  claimItem(ctx, { id: item.id, actor: kiln }, at(0));
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
    createdAt: iso(0),
    actor: kiln,
    channel: 'cli',
  });
  return item;
}

const statusAt = (ctx: Context, seconds: number) =>
  listAgents(ctx.db, at(seconds), () => true).find((a) => a.name === 'kiln')?.status;

describe('an agent that hands off on a board', () => {
  it('is connected, not working, right after the handoff, though it called a moment ago', () => {
    const ctx = memoryContext();
    const item = working(ctx);
    // Its command is noted as an act as it starts, then the handoff lands a second later.
    seeAgent(ctx.db, { agent: 'kiln', channel: 'cli', call: true }, at(40));
    handoffItem(ctx, { id: item.id, actor: kiln, channel: 'cli' }, at(41));

    expect(statusAt(ctx, 42)).toBe('connected');
    expect(listAgents(ctx.db, at(42), () => true)[0]?.holding).toEqual([]);
  });

  // The call that hands off is noted at the same millisecond the release is written: that tie is
  // the handoff itself, not a new act after it.
  it('counts a call in the very millisecond of the release as part of the handoff', () => {
    const ctx = memoryContext();
    const item = working(ctx);
    seeAgent(ctx.db, { agent: 'kiln', channel: 'cli', call: true }, at(40));
    handoffItem(ctx, { id: item.id, actor: kiln, channel: 'cli' }, at(40));

    expect(statusAt(ctx, 41)).toBe('connected');
  });

  it('works again once it calls after the handoff', () => {
    const ctx = memoryContext();
    const item = working(ctx);
    seeAgent(ctx.db, { agent: 'kiln', channel: 'cli', call: true }, at(40));
    handoffItem(ctx, { id: item.id, actor: kiln, channel: 'cli' }, at(41));
    seeAgent(ctx.db, { agent: 'kiln', channel: 'cli', call: true }, at(100));

    expect(statusAt(ctx, 101)).toBe('working');
  });
});

describe('an agent whose question waits for the person', () => {
  it('is not working while it holds the item, and is again once the answer comes', () => {
    const ctx = memoryContext();
    const item = working(ctx);
    expect(statusAt(ctx, 5)).toBe('working');

    askQuestion(
      ctx,
      { id: item.id, text: '¿Liso o con musgo?', actor: kiln, channel: 'cli' },
      at(6),
    );
    expect(listAgents(ctx.db, at(7), () => true)[0]?.holding).toEqual([item.id]);
    expect(statusAt(ctx, 7)).toBe('connected');

    answerQuestion(ctx, { id: item.id, text: 'Liso', actor: you, channel: 'ui' }, at(20));
    expect(statusAt(ctx, 21)).toBe('working');
  });
});

describe('a lease that runs out', () => {
  // It called Otea inside the listening window, so it is still at work, whatever its lease did.
  it('leaves an agent that called within 150 seconds working', () => {
    const ctx = memoryContext();
    const item = working(ctx);
    claimItem(ctx, { id: item.id, actor: kiln, ttlMs: 30_000 }, at(1));
    seeAgent(ctx.db, { agent: 'kiln', channel: 'cli', call: true }, at(60));

    const [kilnNow] = listAgents(ctx.db, at(100), () => true);
    expect(kilnNow?.holding).toEqual([]);
    expect(kilnNow?.status).toBe('working');
  });

  it('leaves one that did not call for a while away, holding nothing', () => {
    const ctx = memoryContext();
    const item = working(ctx);
    claimItem(ctx, { id: item.id, actor: kiln, ttlMs: 30_000 }, at(1));

    const [kilnLater] = listAgents(ctx.db, at(600), () => true);
    expect(kilnLater).toMatchObject({ live: false, holding: [], status: 'away' });
  });
});
