import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { creatures } from '../core/board/testing.ts';
import { updateItemState } from '../store/queries.ts';
import { attachEvidence } from './evidence.ts';
import { createItem, moveItem, updateItem } from './items.ts';
import { claimItem } from './leases.ts';
import { dropItem, handoffItem } from './next.ts';
import { leaveNote, replyNote } from './notes.ts';
import { waitBeat } from './presence.ts';
import type { Project } from './project.ts';
import { tickPoint } from './proofs.ts';
import { askQuestion } from './questions.ts';
import { memoryContext, projectOf, publishAs } from './testing.ts';

const ana = { kind: 'human' as const, name: 'ana' };
const claude = { kind: 'agent' as const, name: 'claude' };
const codex = { kind: 'agent' as const, name: 'codex' };
const T0 = '2026-01-01T00:00:00.000Z';
const T20 = '2026-01-01T00:20:00.000Z';
const at = (time: string) => () => time;

// A lease that ran out while its holder's session runs is still its holder's: nobody takes the item
// over (P1-R3-6). A write was another way over it: ask, reply, tick, drop, move, update, attach and
// handoff only looked at the active lease, so a second agent wrote over the first one's work.
describe('a write on an item whose lease ran out under an agent whose session runs', () => {
  let project: Project;
  let id: string;
  const as = { actor: codex, channel: 'cli' as const };
  const still =
    /is still claude's: its lease ran out at 2026-01-01 00:15 UTC, but its session runs/;
  // claude is heard through a listener that runs (this test's process stands for its wait).
  const listens = (time: string) =>
    waitBeat(project.db, { agent: 'claude', channel: 'cli', waiter: process.pid }, at(time)).run();

  beforeEach(() => {
    const ctx = memoryContext();
    publishAs(ctx, creatures(), 'bcri', at(T0));
    project = projectOf('/nowhere', ctx);
    id = createItem(
      project,
      { collection: 'Criaturas', title: 'Rana', fields: { fdesc: 'Lenta' }, actor: ana },
      at(T0),
    ).id;
    updateItemState(project.db, id, 'sanimate', T0);
    listens(T0);
    claimItem(project, { id, actor: claude }, at(T0));
    listens(T20);
  });

  afterEach(() => project.db.close());

  it('refuses ask, tick, drop, move, update and handoff, as the claim does', () => {
    expect(() => claimItem(project, { id, actor: codex }, at(T20))).toThrow(still);
    expect(() => askQuestion(project, { id, text: 'why?', ...as }, at(T20))).toThrow(still);
    expect(() => tickPoint(project, { id, point: 'Silueta', source: {}, ...as }, at(T20))).toThrow(
      still,
    );
    expect(() => dropItem(project, { id, reason: 'no', ...as }, at(T20))).toThrow(still);
    expect(() => moveItem(project, { id, to: 'done', ...as }, at(T20))).toThrow(still);
    expect(() =>
      updateItem(project, { id, fields: { fdesc: 'x' }, actor: codex }, at(T20)),
    ).toThrow(still);
    expect(() =>
      attachEvidence(project, { id, path: fileURLToPath(import.meta.url), ...as }, at(T20)),
    ).toThrow(still);
    expect(() => handoffItem(project, { id, ...as }, at(T20))).toThrow(still);
  });

  it('refuses a reply to a note of the person, as the claim does', () => {
    const note = leaveNote(project, { id, text: 'más barro', actor: ana, channel: 'ui' }, at(T0));
    expect(() =>
      replyNote(project, { id, note: note.note, text: 'hecho', ...as }, at(T20)),
    ).toThrow(still);
  });

  it('lets the holder itself write on once it claims again, and the person at any time', () => {
    claimItem(project, { id, actor: claude }, at(T20));
    expect(
      updateItem(project, { id, fields: { fdesc: 'x' }, actor: claude }, at(T20)).fields,
    ).toMatchObject({
      fdesc: 'x',
    });
    expect(
      updateItem(project, { id, fields: { fdesc: 'y' }, actor: ana }, at(T20)).fields,
    ).toMatchObject({
      fdesc: 'y',
    });
  });
});
