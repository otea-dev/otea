import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { creatures } from '../core/board/testing.ts';
import { OteaError } from '../core/errors.ts';
import { insertEvidence } from '../store/queries.ts';
import { createItem, getItem, updateItem } from './items.ts';
import { approveItem, handoffItem, sendBackItem } from './next.ts';
import type { Project } from './project.ts';
import { updateAndTell } from './relay-change.ts';
import { declareSecretary } from './secretary.ts';
import { memoryContext, projectOf, publishAs } from './testing.ts';

const you = { kind: 'human' as const, name: 'human' };
const agent = (name: string) => ({ kind: 'agent' as const, name });
const T0 = Date.parse('2026-11-27T10:00:00.000Z');

// S2, P1 (final red-team run): `otea update <id> --field ... --as <any name>` rewrote a field of an
// item that waited for the person's review, and the desk only warned afterwards. Nothing an agent
// runs changes the request or the handed fields while the person's review is open; the person's own
// edit on the desk stays.
describe('an item that waits for the person’s review is not changed by an agent', () => {
  let project: Project;
  let id: string;
  let tick = 0;
  const now = () => new Date(T0 + 1000 * ++tick).toISOString();

  const attach = (module: string, kind: 'image' | 'video', who: string) =>
    insertEvidence(project.db, {
      itemId: id,
      role: 'after',
      module,
      kind,
      filename: `${module}.bin`,
      contentType: kind === 'video' ? 'video/mp4' : 'image/png',
      size: 1,
      sha256: 'a'.repeat(64),
      caption: null,
      createdAt: now(),
      actor: agent(who),
      channel: 'cli',
    });

  beforeEach(() => {
    const ctx = memoryContext();
    const board = creatures();
    // A field the board lets be filled at any time (an estimate, as Changes' impact and effort).
    board.anytime.push('fbiome');
    publishAs(ctx, board, 'bcri', now);
    project = projectOf('/nowhere', ctx);
    id = createItem(
      project,
      { collection: 'Criaturas', title: 'Rana', fields: { fdesc: 'Lenta' }, actor: you },
      now,
    ).id;
    declareSecretary(project.db, 'sol', now);
    attach('eart', 'image', 'quill');
    handoffItem(project, { id, actor: agent('quill'), channel: 'cli' }, now);
  });

  afterEach(() => project.db.close());

  const refusal = (run: () => unknown) => {
    try {
      run();
    } catch (error) {
      if (error instanceof OteaError) return error;
      throw error;
    }
    return undefined;
  };

  it.each([
    ['the worker that handed it in', 'quill'],
    ['a refiner', 'refiner'],
    ['an agent that holds nothing', 'intruso'],
  ])('refuses %s, with the item and who decides', (_who, name) => {
    const refused = refusal(() =>
      updateItem(project, { id, actor: agent(name), fields: { fdesc: 'Rápida' } }, now),
    );

    expect(refused?.code).toBe('forbidden');
    expect(refused?.message).toContain(`${id} waits for the person's review`);
    expect(refused?.message).toMatch(/send it back|ask them/);
    expect(getItem(project, id).fields.fdesc).toBe('Lenta');
  });

  it('refuses a new title too, and a checklist tick', () => {
    const title = refusal(() =>
      updateItem(project, { id, actor: agent('intruso'), title: 'Sapo' }, now),
    );
    const tick1 = refusal(() =>
      updateItem(project, { id, actor: agent('intruso'), fields: { fsteps: 'Silueta' } }, now),
    );

    expect(title?.code).toBe('forbidden');
    expect(tick1?.code).toBe('forbidden');
    expect(getItem(project, id).title).toBe('Rana');
  });

  it('points the secretary to the card that sends it back', () => {
    const refused = refusal(() =>
      updateItem(project, { id, actor: agent('sol'), fields: { fdesc: 'Rápida' } }, now),
    );

    expect(refused?.message).toContain(`--send-back ${id}`);
    expect(getItem(project, id).fields.fdesc).toBe('Lenta');
  });

  it('refuses the secretary’s update with a tell as well', () => {
    const refused = refusal(() =>
      updateAndTell(
        project,
        { id, actor: agent('sol'), fields: { fdesc: 'Rápida' }, tell: 'cambió' },
        now,
      ),
    );

    expect(refused?.message).toContain(`--send-back ${id}`);
    expect(getItem(project, id).fields.fdesc).toBe('Lenta');
  });

  it('lets the person edit it on the desk', () => {
    updateItem(project, { id, actor: you, fields: { fdesc: 'Rápida' } }, now);

    expect(getItem(project, id).fields.fdesc).toBe('Rápida');
  });

  // What the board lets be filled at any time is neither the request nor handed in: an agent still
  // estimates it while the person reviews, but not along with the request.
  it('lets an agent fill a field the board takes at any time, and refuses it with the request', () => {
    updateItem(project, { id, actor: agent('intruso'), fields: { fbiome: 'Pantano' } }, now);
    expect(getItem(project, id).fields.fbiome).toBe('cswamp');

    const mixed = refusal(() =>
      updateItem(
        project,
        { id, actor: agent('intruso'), fields: { fbiome: 'Bosque', fdesc: 'Rápida' } },
        now,
      ),
    );

    expect(mixed?.code).toBe('forbidden');
    expect(getItem(project, id).fields.fbiome).toBe('cswamp');
    expect(getItem(project, id).fields.fdesc).toBe('Lenta');
  });

  it('lets an agent change it again once the person sent it back', () => {
    sendBackItem(project, { id, actor: you, channel: 'ui', reason: 'again' }, now);

    updateItem(project, { id, actor: agent('quill'), fields: { fdesc: 'Rápida' } }, now);

    expect(getItem(project, id).fields.fdesc).toBe('Rápida');
  });

  // The review of an agent (the next step's, by another agent) is not the person's: its worker
  // still fills the form it was given.
  it('leaves an item in an agent’s review to the agents', () => {
    approveItem(project, { id, actor: you, channel: 'ui' }, now);
    attach('eanim', 'video', 'quill');
    updateItem(project, { id, actor: agent('quill'), fields: { fsteps: 'Silueta, Paleta' } }, now);
    handoffItem(project, { id, actor: agent('quill'), channel: 'cli' }, now);

    updateItem(project, { id, actor: agent('reviewer'), fields: { fdesc: 'Rápida' } }, now);

    expect(getItem(project, id).fields.fdesc).toBe('Rápida');
  });
});
