import { describe, expect, it } from 'vitest';
import { compileBoard } from '../../../../src/core/board/compile.ts';
import { handoffCheck } from '../../../../src/core/board/engine.ts';
import { groupFresh } from '../../../../src/core/board/model.ts';
import { problemsOf } from '../../../../src/core/board/problems.ts';
import { parseDefinition } from '../../../../src/core/board/schema.ts';
import { creatures } from '../../../../src/core/board/testing.ts';
import {
  addGroup,
  groupable,
  removeGroup,
  removePart,
  renameGroup,
  setFresh,
  setGroupFresh,
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

  it('is refused when it names a part twice', () => {
    const { def, animar } = board();
    animar.groups = [{ id: 'gone', name: 'Prueba', parts: ['eshot', 'eshot', 'elog'], min: 2 }];
    expect(problemsOf(def, {}).map(({ code }) => code)).toEqual(['group_duplicate']);
    expect(() => compileBoard('bgroups', 1, def)).toThrowError(/names "Captura" twice/);
  });

  // A group that wants new files each round, built only with what the editor offers.
  it('lets a member be new each round, and only while it is a member', () => {
    const { def, animar } = board();
    const hand = (ref: string) => animar.hand.find((entry) => entry.ref === ref);
    setFresh(def, 'sanimate', 'eshot', true);
    expect(hand('eshot')?.fresh).toBe(false);

    const id = addGroup(def, 'sanimate', 'Prueba') ?? '';
    setFresh(def, 'sanimate', 'eshot', true);
    expect(hand('eshot')?.fresh).toBe(true);
    // Optional stays optional, and new each round with it.
    setRequirement(def, 'sanimate', 'eshot', 'no');
    expect(hand('eshot')?.fresh).toBe(true);
    expect(problemsOf(def, {})).toEqual([]);

    toggleGroupPart(def, 'sanimate', id, 'eshot');
    expect(hand('eshot')?.fresh).toBe(false);
    removeGroup(def, 'sanimate', id);
    expect(animar.groups).toBeUndefined();
  });

  // P5-F2: a new group starts new in each round, so a send-back is not answered with what the first
  // round attached; one switch turns the whole group, never a mix of this round's files and last's.
  it('starts new in each round, turns as a whole, and lends its way to a part that joins', () => {
    const { def, animar } = board();
    const fresh = (ref: string) => animar.hand.find((entry) => entry.ref === ref)?.fresh;
    const id = addGroup(def, 'sanimate', 'Prueba') ?? '';
    const group = animar.groups?.[0];
    if (!group) throw new Error('no group');
    expect([fresh('eanim'), fresh('eshot'), fresh('elog')]).toEqual([true, true, true]);
    expect(groupFresh(animar, group)).toBe(true);

    setGroupFresh(def, 'sanimate', id, false);
    expect([fresh('eanim'), fresh('eshot'), fresh('elog')]).toEqual([false, false, false]);
    expect(groupFresh(animar, group)).toBe(false);
    // The required description is not the group's: it keeps its own way.
    expect(fresh('fdesc')).toBe(false);

    // A part that leaves and comes back takes the way of the group it joins.
    toggleGroupPart(def, 'sanimate', id, 'elog');
    setGroupFresh(def, 'sanimate', id, true);
    toggleGroupPart(def, 'sanimate', id, 'elog');
    expect(fresh('elog')).toBe(true);
    expect(problemsOf(def, {})).toEqual([]);
  });

  // A part belongs to at most one group, so its way of counting is one; another group's parts are
  // never touched by a group that is added or turned.
  it('keeps a part in one group, and leaves another group’s parts as they are', () => {
    const { def, animar } = board();
    def.parts.efoto = { id: 'efoto', name: 'Foto', kind: 'images', hint: '', options: [] };
    animar.hand.splice(3, 0, { ref: 'efoto', req: 'no', fresh: false });
    const hand = (ref: string) => animar.hand.find((entry) => entry.ref === ref);

    const first = addGroup(def, 'sanimate', 'Prueba') ?? '';
    // The first group takes what is free; toggled off, a part leaves it carried over.
    toggleGroupPart(def, 'sanimate', first, 'efoto');
    toggleGroupPart(def, 'sanimate', first, 'elog');
    setGroupFresh(def, 'sanimate', first, false);
    expect(animar.groups?.[0]?.parts).toEqual(['eanim', 'eshot']);
    // A deliberate «carries over» on a part outside any group stays: only a member is new.
    setRequirement(def, 'sanimate', 'efoto', 'no', false);

    const second = addGroup(def, 'sanimate', 'Otra') ?? '';
    const [one, two] = animar.groups ?? [];
    expect(one?.parts).toEqual(['eanim', 'eshot']);
    expect(two?.parts).toEqual(['elog', 'efoto']);
    // Only the new group's parts became new; the first group's kept its way.
    expect([hand('eanim')?.fresh, hand('eshot')?.fresh]).toEqual([false, false]);
    expect([hand('efoto')?.fresh, hand('elog')?.fresh]).toEqual([true, true]);

    // Turning one group moves nobody else's part, and a part of another group cannot join.
    setGroupFresh(def, 'sanimate', second, false);
    expect([hand('eanim')?.fresh, hand('eshot')?.fresh]).toEqual([false, false]);
    setGroupFresh(def, 'sanimate', first, true);
    expect([hand('efoto')?.fresh, hand('elog')?.fresh]).toEqual([false, false]);
    expect(groupable(def, animar, first)).toEqual(['eanim', 'eshot']);
    toggleGroupPart(def, 'sanimate', first, 'efoto');
    expect(animar.groups?.[0]?.parts).toEqual(['eanim', 'eshot']);
    // Nothing is free for a third group.
    expect(addGroup(def, 'sanimate', 'Tercera')).toBeUndefined();
    expect(problemsOf(def, {})).toEqual([]);
  });

  it('refuses a board whose groups share a part', () => {
    const { def, animar } = board();
    animar.groups = [
      { id: 'g1', name: 'Una', parts: ['eanim', 'eshot'], min: 1 },
      { id: 'g2', name: 'Otra', parts: ['eshot', 'elog'], min: 1 },
    ];
    const problems = problemsOf(def, {});
    expect(problems.map(({ code }) => code)).toEqual(['group_overlap']);
    expect(problems[0]).toMatchObject({
      level: 'error',
      params: { group: 'Otra', other: 'Una', part: 'Captura' },
    });
    expect(() => compileBoard('boverlap', 1, def)).toThrowError(/another group of the step/);
  });

  it('asks the handoff for a new file from a member made new each round', () => {
    const { def, animar } = board();
    addGroup(def, 'sanimate', 'Prueba');
    setFresh(def, 'sanimate', 'eshot', true);
    setFresh(def, 'sanimate', 'elog', true);
    const stale = new Date(Date.UTC(2026, 10, 12, 10, 5)).toISOString();
    const facts = {
      fields: { fdesc: 'Lenta' },
      evidence: [{ part: 'eshot', at: stale, size: 4, sha256: 'a' }],
      roundStartedAt: new Date(Date.UTC(2026, 10, 12, 10, 10)).toISOString(),
    };
    expect(animar.hand.find(({ ref }) => ref === 'eshot')?.fresh).toBe(true);
    expect(handoffCheck(def, 'sanimate', facts).missing.map(({ reason }) => reason)).toEqual([
      'group',
    ]);
    const now = { ...facts, evidence: [{ ...facts.evidence[0], at: facts.roundStartedAt }] };
    expect(handoffCheck(def, 'sanimate', now as typeof facts).ok).toBe(true);
  });
});
