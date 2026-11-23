import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { creatures } from '../core/board/testing.ts';
import { OteaError } from '../core/errors.ts';
import { saveProfile } from '../store/queries.ts';
import type { Context } from './context.ts';
import { createItem } from './items.ts';
import { approveItem, handoffItem, sendBackItem } from './next.ts';
import { performanceAcross, performanceOf } from './performance.ts';
import { memoryContext, publishAs } from './testing.ts';

const you = { kind: 'human' as const, name: 'fede' };
const quill = { kind: 'agent' as const, name: 'quill' };

let tick = 0;
const clock = () => new Date(Date.UTC(2026, 10, 1, 9, tick++)).toISOString();

describe('performanceOf: how each model performs on the project’s boards', () => {
  let ctx: Context;

  beforeEach(() => {
    tick = 0;
    ctx = memoryContext();
    // Concepto with nothing to attach, so a handoff goes through on its own.
    const def = creatures();
    for (const step of def.steps) step.hand = [];
    publishAs(ctx, def, 'bcri', clock);
    saveProfile(
      ctx.db,
      'quill',
      { harness: 'claude-code', model: 'claude-sonnet-5', effort: 'medium' },
      { at: clock(), channel: 'cli', confirmed: true },
    );
  });

  afterEach(() => ctx.db.close());

  function walk() {
    const item = createItem(
      ctx,
      { collection: 'Criaturas', title: 'Rana', fields: { fdesc: 'verde' }, actor: you },
      clock,
    );
    const by = { id: item.id, channel: 'cli' as const };
    handoffItem(ctx, { ...by, actor: quill }, clock);
    sendBackItem(ctx, { ...by, actor: you, channel: 'ui', reason: 'Más barro' }, clock);
    handoffItem(ctx, { ...by, actor: quill, note: 'Con barro' }, clock);
    approveItem(ctx, { ...by, actor: you, channel: 'ui' }, clock);
    return item.id;
  }

  it('reads every live board’s items with the profile on each handoff', () => {
    walk();

    const report = performanceOf(ctx, {}, clock);

    expect(report.rows).toEqual([
      expect.objectContaining({
        family: 'sonnet',
        effort: 'medium',
        handoffs: 2,
        sentBack: 1,
        finishedSteps: 1,
        rounds: 2,
      }),
    ]);
    expect(report.boards).toEqual(['Criaturas']);
  });

  it('keeps to the board named, in any case, and refuses one there is not', () => {
    walk();

    expect(performanceOf(ctx, { board: 'criaturas' }, clock).rows).toHaveLength(1);
    expect(() => performanceOf(ctx, { board: 'Nada' }, clock)).toThrow(OteaError);
  });
});

// P6-F3: Rendimiento read over every project, so a model's numbers are one row.
describe('performanceAcross: the same report over several projects', () => {
  const contexts: Context[] = [];
  afterEach(() => {
    for (const ctx of contexts.splice(0)) ctx.db.close();
  });

  function project(name: string) {
    const ctx = memoryContext();
    contexts.push(ctx);
    const def = creatures();
    for (const step of def.steps) step.hand = [];
    publishAs(ctx, def, 'bcri', clock);
    saveProfile(
      ctx.db,
      'quill',
      { harness: 'claude-code', model: 'claude-sonnet-5', effort: 'medium' },
      { at: clock(), channel: 'cli', confirmed: true },
    );
    // The same item id in each project: one walk, handed off, sent back, handed off, approved.
    const item = createItem(
      ctx,
      { collection: 'Criaturas', title: 'Rana', fields: { fdesc: 'verde' }, actor: you },
      clock,
    );
    const by = { id: item.id, channel: 'cli' as const };
    handoffItem(ctx, { ...by, actor: quill }, clock);
    sendBackItem(ctx, { ...by, actor: you, channel: 'ui', reason: 'Más barro' }, clock);
    handoffItem(ctx, { ...by, actor: quill, note: 'Con barro' }, clock);
    approveItem(ctx, { ...by, actor: you, channel: 'ui' }, clock);
    return { id: `${name}-abc123`, name, ctx };
  }

  it('adds the projects into one row per model, and names a board with its project', () => {
    const projects = [project('Alfa'), project('Beta')];

    const alone = performanceOf(projects[0]?.ctx as Context, {}, clock);
    const report = performanceAcross(projects, {}, clock);

    expect(alone.rows[0]?.handoffs).toBe(2);
    expect(report.rows).toEqual([
      expect.objectContaining({
        family: 'sonnet',
        effort: 'medium',
        handoffs: 4,
        sentBack: 2,
        // One step finished per project, though the two items share an id.
        finishedSteps: 2,
      }),
    ]);
    expect(report.boards).toEqual(['Alfa / Criaturas', 'Beta / Criaturas']);
  });

  it('refuses a period it cannot read, as one project does', () => {
    expect(() => performanceAcross([project('Alfa')], { since: 'soon' }, clock)).toThrow(OteaError);
  });
});
