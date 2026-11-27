import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { creatures } from '../core/board/testing.ts';
import { insertEvidence } from '../store/queries.ts';
import { createItem, showItem, updateItem } from './items.ts';
import { handoffItem, sendBackItem } from './next.ts';
import type { Project } from './project.ts';
import { declareSecretary, secretaryWake, startSecretaryWait } from './secretary.ts';
import { memoryContext, projectOf, publishAs } from './testing.ts';

const you = { kind: 'human' as const, name: 'human' };
const quill = { kind: 'agent' as const, name: 'quill' };
const sol = { kind: 'agent' as const, name: 'sol' };
const T0 = Date.parse('2026-11-26T10:00:00.000Z');

// U5 (field study 4): the request was rewritten while its delivery waited for review, and the review
// said nothing: the title and the request read JSON, the diff and the branch were CSV, and Approve
// was enabled. The item says its delivery predates the change, and what changed.
describe('a request that changed after its delivery was handed in', () => {
  let project: Project;
  let id: string;
  let tick = 0;
  const now = () => new Date(T0 + 1000 * ++tick).toISOString();

  const deliver = (note?: string) => {
    insertEvidence(project.db, {
      itemId: id,
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
    handoffItem(project, { id, actor: quill, channel: 'cli', ...(note ? { note } : {}) }, now);
  };
  const rewrite = (title: string, desc: string, actor = sol) =>
    updateItem(project, { id, actor, title, fields: { fdesc: desc } }, now);
  const shown = () => showItem(project, id, { actor: you, channel: 'ui' }, now);

  beforeEach(() => {
    const ctx = memoryContext();
    publishAs(ctx, creatures(), 'bcri', now);
    project = projectOf('/nowhere', ctx);
    id = createItem(
      project,
      { collection: 'Criaturas', title: 'Rana', fields: { fdesc: 'Lenta' }, actor: you },
      now,
    ).id;
    declareSecretary(project.db, 'sol', now);
  });

  afterEach(() => project.db.close());

  it('says so on the item, with who changed it and what it said before and after', () => {
    deliver();
    expect(shown().requestChanged).toBeUndefined();

    rewrite('Sapo', 'Rápido');

    expect(shown().requestChanged).toMatchObject({
      by: 'sol',
      changes: expect.arrayContaining([
        { field: 'title', from: 'Rana', to: 'Sapo' },
        { field: expect.stringMatching(/desc/i), from: 'Lenta', to: 'Rápido' },
      ]),
    });
  });

  it('says nothing for a change made before the delivery, or once a new round was handed in', () => {
    rewrite('Sapo', 'Rápido');
    deliver();
    expect(shown().requestChanged).toBeUndefined();

    rewrite('Rana', 'Lenta');
    expect(shown().requestChanged).toBeDefined();
    sendBackItem(project, { id, actor: you, channel: 'ui', reason: 'again' }, now);
    deliver('as you rewrote it');

    expect(shown().requestChanged).toBeUndefined();
  });

  it('tells the secretary in the wake for the delivery', () => {
    deliver();
    rewrite('Sapo', 'Rápido');

    const woke = secretaryWake(project, startSecretaryWait(now), now);

    expect(woke).toMatchObject({ kind: 'ready_for_review', ref: id });
    expect(woke?.text).toMatch(/request changed after/i);
    expect(woke?.text).toContain('Sapo');
  });
});
