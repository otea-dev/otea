import { describe, expect, it } from 'vitest';
import { compileBoard } from '../../../../src/core/board/compile.ts';
import { problemsOf } from '../../../../src/core/board/problems.ts';
import { parseDefinition } from '../../../../src/core/board/schema.ts';
import { creatures } from '../../../../src/core/board/testing.ts';
import {
  addGroup,
  groupable,
  removeGroup,
  removePart,
  renameGroup,
  setGroupMin,
  setRequirement,
  toggleGroupPart,
} from './edits.ts';

// A board whose Animar step hands a recording, a screenshot and a log, none of them required.
function board() {
  const def = creatures();
  def.parts.eshot = { id: 'eshot', name: 'Captura', kind: 'images', hint: '', options: [] };
  def.parts.elog = { id: 'elog', name: 'Salida', kind: 'log', hint: '', options: [] };
  const animar = def.steps[1];
  if (!animar) throw new Error('no step');
  animar.hand = [
    { ref: 'eanim', req: 'no', fresh: false },
    { ref: 'eshot', req: 'no', fresh: false },
    { ref: 'elog', req: 'no', fresh: false },
    { ref: 'fdesc', req: 'always', fresh: false },
  ];
  return { def, animar };
}

describe('a group of evidence built in Studio', () => {
  it('is built from the optional evidence the step hands, and is read back as it was written', () => {
    const { def, animar } = board();
    expect(groupable(def, animar)).toEqual(['eanim', 'eshot', 'elog']);

    const id = addGroup(def, 'sanimate', 'Prueba');
    expect(id).toBeDefined();
    if (!id) return;
    renameGroup(def, 'sanimate', id, 'Prueba del trabajo');
    toggleGroupPart(def, 'sanimate', id, 'eanim');
    setGroupMin(def, 'sanimate', id, 2);
    expect(animar.groups).toEqual([
      { id, name: 'Prueba del trabajo', parts: ['eshot', 'elog'], min: 2 },
    ]);

    // Saved and loaded again (what the draft API and a published version do), nothing is lost.
    const reading = parseDefinition(JSON.parse(JSON.stringify(def)));
    expect(reading.ok && reading.definition.steps[1]?.groups).toEqual(animar.groups);
    expect(problemsOf(def, {}).filter(({ code }) => code.startsWith('group_'))).toEqual([]);
    expect(() => compileBoard('bgroups', 1, def)).not.toThrow();
  });

  it('keeps a minimum between one and what it has, and a group of something', () => {
    const { def, animar } = board();
    const id = addGroup(def, 'sanimate', 'Prueba') ?? '';
    setGroupMin(def, 'sanimate', id, 9);
    expect(animar.groups?.[0]?.min).toBe(3);
    toggleGroupPart(def, 'sanimate', id, 'elog');
    expect(animar.groups?.[0]).toMatchObject({ parts: ['eanim', 'eshot'], min: 2 });
    toggleGroupPart(def, 'sanimate', id, 'eanim');
    toggleGroupPart(def, 'sanimate', id, 'eshot');
    expect(animar.groups?.[0]?.parts).toEqual(['eshot']);
    removeGroup(def, 'sanimate', id);
    expect(animar.groups).toBeUndefined();
  });

  it('lets go of a part that leaves the step or becomes required', () => {
    const { def, animar } = board();
    addGroup(def, 'sanimate', 'Prueba');
    removePart(def, { type: 'step', step: 'sanimate' }, 'elog');
    setRequirement(def, 'sanimate', 'eanim', 'always');
    expect(animar.groups?.[0]?.parts).toEqual(['eshot']);
    removePart(def, { type: 'step', step: 'sanimate' }, 'eshot');
    expect(animar.groups).toBeUndefined();
  });

  it('is refused by the board when it asks for more than it has, or names no optional evidence', () => {
    const { def, animar } = board();
    animar.groups = [{ id: 'gone', name: 'Prueba', parts: ['eanim', 'fdesc'], min: 3 }];
    expect(problemsOf(def, {}).map(({ code }) => code)).toEqual(['group_small', 'group_member']);
    expect(() => compileBoard('bgroups', 1, def)).toThrowError(/group "Prueba" of step "Animar"/);
  });
});
