import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { creatures } from '../core/board/testing.ts';
import { updateItemState } from '../store/queries.ts';
import { attachEvidence } from './evidence.ts';
import { createItem, requireItem } from './items.ts';
import { boardBlockOf, handoffItem, itemNextText } from './next.ts';
import type { Project } from './project.ts';
import { memoryContext, projectOf, publishAs } from './testing.ts';

const you = { kind: 'human' as const, name: 'fede' };
const quill = { kind: 'agent' as const, name: 'quill' };
let tick = 0;
const now = () => new Date(Date.UTC(2026, 10, 17, 9, 0, tick++)).toISOString();

// A board whose Animar step asks for a report always, and for at least one of a recording, a
// screenshot or a log, whichever fits what was done.
describe('"at least N of" groups of evidence', () => {
  let root: string;
  let project: Project;
  let id: string;

  const file = (name: string, content: string) => {
    const path = join(root, name);
    writeFileSync(path, content);
    return path;
  };
  const attach = (name: string, content: string, module?: string) =>
    attachEvidence(
      project,
      {
        id,
        path: file(name, content),
        ...(module ? { module } : {}),
        actor: quill,
        channel: 'cli',
      },
      now,
    );
  const hand = () => handoffItem(project, { id, actor: quill, channel: 'cli' }, now);
  const readNext = () => itemNextText(project, requireItem(project.db, id), 'quill', now) ?? '';

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'otea-groups-'));
    const def = creatures();
    for (const [part, name, kind] of [
      ['efile', 'Informe', 'file'],
      ['eshot', 'Captura', 'images'],
      ['elog', 'Salida', 'log'],
    ] as const) {
      def.parts[part] = {
        id: part,
        name,
        kind,
        hint: '',
        options: [],
        ...(kind === 'images' ? { show: 'gallery' } : {}),
      };
    }
    const animar = def.steps[1];
    if (!animar) throw new Error('no step');
    animar.hand = [
      { ref: 'efile', req: 'always', fresh: false },
      { ref: 'eanim', req: 'no', fresh: false },
      { ref: 'eshot', req: 'no', fresh: false },
      { ref: 'elog', req: 'no', fresh: false },
    ];
    animar.groups = [{ id: 'gproof', name: 'Prueba', parts: ['eanim', 'eshot', 'elog'], min: 1 }];
    const ctx = memoryContext();
    publishAs(ctx, def, 'bgrp', now);
    project = projectOf(root, ctx);
    id = createItem(
      project,
      { collection: 'Criaturas', title: 'Rana', fields: { fdesc: 'Lenta' }, actor: you },
      now,
    ).id;
    updateItemState(project.db, id, 'sanimate', now());
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('refuses a handoff with none of the group, naming it, and passes with one', () => {
    attach('informe.zip', 'zip', 'efile');
    expect(hand).toThrowError(
      /Not handed off .*: missing Prueba \(at least 1 of Animación, Captura, Salida; 0 attached\)/,
    );
    const block = boardBlockOf(project, requireItem(project.db, id));
    expect(block?.missing.map(({ ref, reason }) => ({ ref, reason }))).toEqual([
      { ref: 'group:gproof', reason: 'group' },
    ]);

    attach('salida.log', 'ok', 'elog');
    expect(hand).not.toThrow();
  });

  it('says where the group stands in what an agent reads', () => {
    attach('informe.zip', 'zip', 'efile');
    const text = readNext();
    expect(text).toContain('✗ Prueba: at least 1 of Animación, Captura, Salida (0 attached)');
    expect(text).toContain(
      'groups: {"Prueba":{"min":1,"have":0,"parts":["Animación","Captura","Salida"],"held":[]}}',
    );
    expect(text).toContain('Prueba: attach at least 1 of Animación, Captura, Salida');

    attach('salida.log', 'ok', 'elog');
    expect(readNext()).toContain(
      '✓ Prueba: at least 1 of Animación, Captura, Salida (1 attached: Salida)',
    );
  });

  it('refuses a file with no bytes for required evidence and for a member of the group', () => {
    expect(() => attach('informe.zip', '', 'efile')).toThrowError(
      /informe\.zip is empty \(0 bytes\)/,
    );
    expect(() => attach('salida.log', '', 'elog')).toThrowError(/salida\.log is empty \(0 bytes\)/);
    // Nothing was stored: the group still lacks its file.
    attach('informe.zip', 'zip', 'efile');
    expect(hand).toThrowError(/missing Prueba/);
  });

  it('lists what the part takes when the extension is wrong, and takes a log where a file goes', () => {
    expect(() => attach('clip.zip', 'zip', 'eanim')).toThrowError(
      /"Animación" \(recording, frames\) takes \.mp4 \.webm \.mov, not clip\.zip/,
    );
    expect(() => attach('salida.png', 'png', 'elog')).toThrowError(
      /"Salida" \(log\) takes \.log \.txt \.xml \.json, not salida\.png/,
    );
    expect(attach('trace.log', 'a log in a file part', 'efile').module).toBe('efile');
  });
});
