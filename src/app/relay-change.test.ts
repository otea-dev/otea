import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { creatures } from '../core/board/testing.ts';
import { insertEvidence } from '../store/queries.ts';
import { addCollection } from './collections.ts';
import { createItem, getItem, updateItem } from './items.ts';
import { claimItem } from './leases.ts';
import { handoffItem } from './next.ts';
import { agentNotes, noteWaiting } from './notes.ts';
import { waitBeat } from './presence.ts';
import type { Project } from './project.ts';
import { updateAndTell } from './relay-change.ts';
import { declareSecretary } from './secretary.ts';
import { memoryContext, projectOf, publishAs } from './testing.ts';

const you = { kind: 'human' as const, name: 'human' };
const quill = { kind: 'agent' as const, name: 'quill' };
const sol = { kind: 'agent' as const, name: 'sol' };
const T0 = Date.parse('2026-11-26T10:00:00.000Z');
let tick = 0;
const now = () => new Date(T0 + 1000 * ++tick).toISOString();

// U1 and U4 (field study 4): a change of mind about an item not yet in review reached the item (or a
// worker already on it) only when the secretary got round to it, behind the newer messages. The
// secretary reshapes the item itself and the worker on it is told at once, in the same answer it
// reads its notes in; the worker answers before it hands off.
describe('the secretary reshapes an item and tells the worker on it', () => {
  let project: Project;
  let id: string;

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

  it('changes what a worker holds and tells it at once, where its waits and calls hear it', () => {
    claimItem(project, { id, actor: quill }, now);
    expect(() => updateItem(project, { id, fields: { fdesc: 'Ágil' }, actor: sol }, now)).toThrow(
      /held by quill|lease/i,
    );

    updateAndTell(
      project,
      { id, fields: { fdesc: 'Ágil' }, tell: 'The person wants it quick, not slow.', actor: sol },
      now,
    );

    expect(getItem(project, id).fields.fdesc).toBe('Ágil');
    const heard = noteWaiting(project, 'quill');
    expect(heard?.item).toBe(id);
    expect(heard?.text).toContain('The person wants it quick, not slow.');
    expect(agentNotes(project, id)?.text).toContain('The person wants it quick, not slow.');
  });

  it('changes an item nobody holds too, and the note waits for whoever takes it', () => {
    updateAndTell(
      project,
      { id, title: 'Rana veloz', tell: 'The person wants it quick.', actor: sol },
      now,
    );

    expect(getItem(project, id).title).toBe('Rana veloz');
    claimItem(project, { id, actor: quill }, now);
    expect(agentNotes(project, id)?.text).toContain('The person wants it quick.');
  });

  // A change that cannot be told is not made: an item on no board has no note to leave its worker.
  it('refuses to change what a worker holds on an item of no board, since it cannot tell it', () => {
    addCollection(project, { name: 'tasks' });
    const plain = createItem(
      project,
      {
        collection: 'tasks',
        title: 'Plain',
        fields: { description: 'Now' },
        actor: { kind: 'agent', name: 'sol' },
      },
      now,
    ).id;
    claimItem(project, { id: plain, actor: quill }, now);

    expect(() =>
      updateAndTell(
        project,
        { id: plain, fields: { description: 'Later' }, tell: 'The person changed it.', actor: sol },
        now,
      ),
    ).toThrow(/quill/);
    expect(getItem(project, plain).fields.description).toBe('Now');
  });

  // The lease is the one check the secretary goes over: another agent whose lease ran out but whose
  // session runs still owns the item, and the secretary writes no more over it than anyone.
  it('still refuses what the other write checks refuse: an item whose holder runs', () => {
    const at = (offset: number) => () => new Date(T0 + offset).toISOString();
    claimItem(project, { id, actor: quill }, at(0));
    waitBeat(
      project.db,
      { agent: 'quill', channel: 'cli', waiter: process.pid },
      at(21 * 60_000),
    ).run();

    expect(() =>
      updateAndTell(
        project,
        { id, fields: { fdesc: 'Ágil' }, tell: 'Quick.', actor: sol },
        at(21 * 60_000),
      ),
    ).toThrow(/still quill's/);
    expect(getItem(project, id).fields.fdesc).toBe('Lenta');
  });

  it('is the secretary’s alone', () => {
    claimItem(project, { id, actor: quill }, now);

    expect(() =>
      updateAndTell(
        project,
        { id, fields: { fdesc: 'x' }, tell: 'x', actor: { kind: 'agent', name: 'luna' } },
        now,
      ),
    ).toThrow(/not this project's secretary/);
    expect(getItem(project, id).fields.fdesc).toBe('Lenta');
  });

  it('refuses an item already in the person’s review and says to ask them with a card', () => {
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
    handoffItem(project, { id, actor: quill, channel: 'cli' }, now);

    expect(() =>
      updateAndTell(project, { id, fields: { fdesc: 'x' }, tell: 'x', actor: sol }, now),
    ).toThrow(/--send-back/);
    expect(getItem(project, id).fields.fdesc).toBe('Lenta');
  });
});
