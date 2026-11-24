import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { creatures } from '../core/board/testing.ts';
import type { Actor } from '../core/item.ts';
import { createItem, requireItem } from './items.ts';
import { claimItem } from './leases.ts';
import { boardBlockOf, handoffItem } from './next.ts';
import type { Project } from './project.ts';
import { memoryContext, projectOf, publishAs } from './testing.ts';
import { waiveEvidence } from './waive.ts';

// A step that asks for a file (here Concepto asks for the concept art) cannot be handed off
// without it. An agent with no way to make one (no browser for a screenshot) is stuck, so the
// person may waive that file for the item: the handoff then passes, and it shows the person did.

const you = { kind: 'human' as const, name: 'fede' };
const quill = { kind: 'agent' as const, name: 'quill' };
let tick = 0;
const now = () => new Date(Date.UTC(2026, 10, 24, 9, 0, tick++)).toISOString();

describe('waiving a required file', () => {
  let root: string;
  let project: Project;
  let id: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'otea-waive-'));
    const def = creatures();
    const concept = def.steps[0];
    if (!concept) throw new Error('no step');
    concept.hand = [{ ref: 'eart', req: 'always', fresh: false }];
    const ctx = memoryContext();
    publishAs(ctx, def, 'bwaive', now);
    project = projectOf(root, ctx);
    id = createItem(
      project,
      { collection: 'Criaturas', title: 'Rana', fields: { fdesc: 'Lenta' }, actor: you },
      now,
    ).id;
    claimItem(project, { id, actor: quill }, now);
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  const hand = () => handoffItem(project, { id, actor: quill, channel: 'cli', note: 'Listo' }, now);
  const waive = (actor: Actor = you) =>
    waiveEvidence(
      project,
      { id, part: 'Arte conceptual', reason: 'no browser', actor, channel: 'cli' },
      now,
    );

  it('refuses a handoff without the file, and passes it once the person waived it', () => {
    expect(() => hand()).toThrowError(/missing Arte conceptual/);
    const waived = waive();
    expect(waived.text).toMatch(/Arte conceptual/);
    hand();
    expect(requireItem(project.db, id).state).toMatch(/__review$/);
    const block = boardBlockOf(project, requireItem(project.db, id));
    expect(block?.waived).toEqual([
      expect.objectContaining({ name: 'Arte conceptual', by: 'fede', reason: 'no browser' }),
    ]);
  });

  it('is never the agent who waives it', () => {
    expect(() => waive(quill)).toThrowError(expect.objectContaining({ code: 'forbidden' }));
    expect(() => hand()).toThrowError(/missing Arte conceptual/);
  });
});
