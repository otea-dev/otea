import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { creatures } from '../core/board/testing.ts';
import { attachEvidence } from './evidence.ts';
import { createItem, requireItem } from './items.ts';
import { claimItem } from './leases.ts';
import { boardBlockOf, handoffItem, itemNextText, sendBackItem } from './next.ts';
import type { Project } from './project.ts';
import { memoryContext, projectOf, publishAs } from './testing.ts';

const you = { kind: 'human' as const, name: 'fede' };
const quill = { kind: 'agent' as const, name: 'quill' };
let tick = 0;
const now = () => new Date(Date.UTC(2026, 10, 17, 9, 0, tick++)).toISOString();

// Concepto asks for at least one of a concept art or a swamp reference, and the person reviews it:
// a send-back returns it to Concepto for a second round. `fresh` says whether the group is new in
// each round (P5-F2: a returned round was handed off with nothing new, as the first round's files
// still filled the group).
function setup(fresh: boolean, grouped = true) {
  const root = mkdtempSync(join(tmpdir(), 'otea-rounds-'));
  const def = creatures();
  const concept = def.steps[0];
  if (!concept) throw new Error('no step');
  if (grouped) {
    concept.hand = [
      { ref: 'eart', req: 'no', fresh },
      { ref: 'eswamp', req: 'no', fresh },
    ];
    concept.groups = [{ id: 'gshots', name: 'Pruebas', parts: ['eart', 'eswamp'], min: 1 }];
  } else {
    concept.hand = [{ ref: 'eart', req: 'always', fresh }];
  }
  const ctx = memoryContext();
  publishAs(ctx, def, 'bround', now);
  const project = projectOf(root, ctx);
  const id = createItem(
    project,
    { collection: 'Criaturas', title: 'Rana', fields: { fdesc: 'Lenta' }, actor: you },
    now,
  ).id;
  return { root, project, id };
}

describe('a returned round and the evidence new in each round', () => {
  let root: string;
  let project: Project;
  let id: string;
  let files = 0;

  const attach = (module: string, content = `bytes ${files++}`) => {
    const path = join(root, `${module}-${files}.png`);
    writeFileSync(path, content);
    return attachEvidence(project, { id, path, module, actor: quill, channel: 'cli' }, now);
  };
  const hand = () => handoffItem(project, { id, actor: quill, channel: 'cli', note: 'Listo' }, now);
  const returned = () => {
    attach('eart');
    hand();
    sendBackItem(project, { id, actor: you, channel: 'ui', reason: 'Otra vez' }, now);
    claimItem(project, { id, actor: quill }, now);
  };
  const readNext = () => itemNextText(project, requireItem(project.db, id), 'quill', now) ?? '';

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  describe('a group new in each round', () => {
    beforeEach(() => {
      ({ root, project, id } = setup(true));
    });

    it('is handed off again only with a new file in the group', () => {
      returned();
      expect(() => hand()).toThrowError(
        /missing Pruebas \(at least 1 of Arte conceptual, Barro, each new this round; 0 attached\)/,
      );
      const missing = boardBlockOf(project, requireItem(project.db, id))?.missing ?? [];
      expect(missing.find(({ ref }) => ref === 'group:gshots')).toMatchObject({
        reason: 'group',
        group: { have: 0, fresh: true },
      });
      attach('eswamp');
      expect(hand).not.toThrow();
    });

    it('says what new means: an earlier file does not count, even unchanged', () => {
      returned();
      expect(() => hand()).toThrowError(/a file from an earlier round does not count/);
      const text = readNext();
      expect(text).toContain(
        '✗ Pruebas: at least 1 of Arte conceptual, Barro, each new this round',
      );
      expect(text).toContain(
        'a file from an earlier round does not count, even when it did not change',
      );
    });

    it('counts the file attached again, with the same bytes, as new', () => {
      attach('eart', 'the same bytes');
      hand();
      sendBackItem(project, { id, actor: you, channel: 'ui', reason: 'Otra vez' }, now);
      claimItem(project, { id, actor: quill }, now);
      expect(() => hand()).toThrowError(/missing Pruebas/);
      attach('eart', 'the same bytes');
      expect(hand).not.toThrow();
    });
  });

  // P7-F8: a part marked new each round must be attached again after a send-back, even unchanged;
  // the step says so, in what the agent reads and in the refusal.
  describe('a required part new in each round', () => {
    beforeEach(() => {
      ({ root, project, id } = setup(true, false));
    });

    it('says to attach it again, unchanged or not, and takes the same file as new', () => {
      attach('eart', 'the same bytes');
      hand();
      sendBackItem(project, { id, actor: you, channel: 'ui', reason: 'Otra vez' }, now);
      claimItem(project, { id, actor: quill }, now);
      expect(readNext()).toContain('a file from an earlier round does not count');
      expect(() => hand()).toThrowError(
        /missing Arte conceptual \(new this round\)[\s\S]*attach it again/,
      );
      attach('eart', 'the same bytes');
      expect(hand).not.toThrow();
    });
  });

  describe('a group that carries over', () => {
    beforeEach(() => {
      ({ root, project, id } = setup(false));
    });

    it('is handed off again with what the first round attached, and says nothing of new files', () => {
      returned();
      expect(readNext()).not.toContain('does not count');
      expect(hand).not.toThrow();
    });
  });
});
