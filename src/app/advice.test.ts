import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { creatures } from '../core/board/testing.ts';
import { insertEvidence } from '../store/queries.ts';
import { adviseOnItem } from './advice.ts';
import { createItem, showItem } from './items.ts';
import { handoffItem, sendBackItem } from './next.ts';
import type { Project } from './project.ts';
import { declareSecretary } from './secretary.ts';
import { memoryContext, projectOf, publishAs } from './testing.ts';

const you = { kind: 'human' as const, name: 'human' };
const quill = { kind: 'agent' as const, name: 'quill' };
const T0 = Date.parse('2026-11-28T10:00:00.000Z');
let tick = 0;
const now = () => new Date(T0 + 1000 * ++tick).toISOString();

// D-00b356 / D-d92910 (s-real2): the secretary told the person in Hablar it recommended sending an
// item back; the item's own page, where they approved it, said nothing. The advice is recorded on
// the item, structured, for the delivery it is about: the pages that offer Aprobar read it from there.
describe('an agent advises the person on an item in their review', () => {
  let project: Project;
  let id: string;

  const handIn = () => {
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
    handoffItem(project, { id, actor: quill, channel: 'cli', note: 'Done' }, now);
  };
  const view = () => showItem(project, id, { actor: you, channel: 'ui' }, now);

  beforeEach(() => {
    const ctx = memoryContext();
    publishAs(ctx, creatures(), 'bcri', now);
    project = projectOf('/nowhere', ctx);
    id = createItem(
      project,
      { collection: 'Criaturas', title: 'Rana', fields: { fdesc: 'Lenta' }, actor: you },
      now,
    ).id;
    handIn();
    declareSecretary(project.db, 'sol', now);
  });

  afterEach(() => project.db.close());

  it('shows on the item as a recommendation to send it back, with its reason and who said it', () => {
    expect(view().advice).toBeUndefined();

    adviseOnItem(
      project,
      { id, agent: 'sol', kind: 'send_back', note: 'The page never loads the file it adds.' },
      now,
    );

    expect(view().advice).toMatchObject({
      kind: 'send_back',
      note: 'The page never loads the file it adds.',
      by: 'sol',
      secretary: true,
    });
  });

  it('says a doubt as a doubt, and the agent that delivered it is no secretary', () => {
    adviseOnItem(project, { id, agent: 'quill', kind: 'doubt', note: 'I could not run it.' }, now);

    expect(view().advice).toMatchObject({ kind: 'doubt', by: 'quill', secretary: false });
  });

  it('keeps the latest advice, and drops it when the item is handed in again', () => {
    adviseOnItem(project, { id, agent: 'sol', kind: 'doubt', note: 'Not sure.' }, now);
    adviseOnItem(project, { id, agent: 'sol', kind: 'send_back', note: 'Send it back.' }, now);
    expect(view().advice).toMatchObject({ kind: 'send_back', note: 'Send it back.' });

    sendBackItem(project, { id, actor: you, channel: 'ui', reason: 'Redo it.' }, now);
    handIn();

    // A new delivery: what was said of the earlier one is not about this.
    expect(view().advice).toBeUndefined();
  });

  it('refuses advice on an item that is not waiting for the person, and an empty reason', () => {
    expect(() =>
      adviseOnItem(project, { id, agent: 'sol', kind: 'doubt', note: '  ' }, now),
    ).toThrow(/reason/i);
    sendBackItem(project, { id, actor: you, channel: 'ui', reason: 'Redo it.' }, now);
    expect(() =>
      adviseOnItem(project, { id, agent: 'sol', kind: 'send_back', note: 'Back.' }, now),
    ).toThrow(/not waiting for your review/);
  });
});
