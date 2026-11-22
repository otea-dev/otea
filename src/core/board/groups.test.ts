import { describe, expect, it } from 'vitest';
import { groupRef, groupStates, handoffCheck, initialPosition } from './engine.ts';
import { groupFaults } from './problems.ts';
import { creatures, step } from './testing.ts';

// Animar hands its report always, and asks for at least two of a recording, a screenshot or a log.
const def = creatures();
def.parts.eshot = { id: 'eshot', name: 'Captura', kind: 'images', hint: '', options: [] };
def.parts.elog = { id: 'elog', name: 'Salida', kind: 'log', hint: '', options: [] };
const animar = def.steps[1];
if (!animar) throw new Error('no step');
animar.hand = [
  { ref: 'eanim', req: 'no', fresh: true },
  { ref: 'eshot', req: 'no', fresh: false },
  { ref: 'elog', req: 'no', fresh: false },
];
animar.groups = [{ id: 'gproof', name: 'Prueba', parts: ['eanim', 'eshot', 'elog'], min: 2 }];

const at = (minutes: number) => new Date(Date.UTC(2026, 10, 12, 10, minutes)).toISOString();
const facts = (evidence: { part: string; at: string; size?: number; sha256?: string }[]) => ({
  fields: {},
  evidence,
  roundStartedAt: at(10),
});

describe('an "at least N of" group', () => {
  it('holds the handoff until enough of its parts have a file, whichever they are', () => {
    const none = handoffCheck(def, 'sanimate', facts([]));
    expect(none.ok).toBe(false);
    expect(none.missing).toEqual([
      {
        ref: groupRef('gproof'),
        name: 'Prueba',
        reason: 'group',
        fresh: false,
        group: {
          min: 2,
          have: 0,
          parts: ['Animación', 'Captura', 'Salida'],
          held: [],
        },
      },
    ]);
    const one = handoffCheck(def, 'sanimate', facts([{ part: 'elog', at: at(5) }]));
    expect(one.missing[0]?.group).toMatchObject({ have: 1, held: ['Salida'] });
    const two = handoffCheck(
      def,
      'sanimate',
      facts([
        { part: 'elog', at: at(5) },
        { part: 'eshot', at: at(6) },
      ]),
    );
    expect(two).toEqual({ ok: true, missing: [] });
  });

  it('counts a part once, however many files it holds', () => {
    const states = groupStates(
      def,
      animar,
      facts([
        { part: 'elog', at: at(5) },
        { part: 'elog', at: at(6) },
      ]),
    );
    expect(states[0]?.state.have).toBe(1);
  });

  it('counts neither a file with no bytes nor, for a part new each round, an older round', () => {
    const states = groupStates(
      def,
      animar,
      facts([
        { part: 'elog', at: at(5), size: 0 },
        { part: 'eanim', at: at(5), size: 10 },
        { part: 'eshot', at: at(12), size: 10 },
      ]),
    );
    expect(states[0]?.state).toMatchObject({ have: 1, held: ['Captura'] });
  });

  // "Each part counts once" must hold against a file attached twice and a part listed twice.
  it('counts one file attached to two parts once, and two different files twice', () => {
    const same = groupStates(
      def,
      animar,
      facts([
        { part: 'elog', at: at(11), sha256: 'abc' },
        { part: 'eshot', at: at(12), sha256: 'abc' },
      ]),
    )[0]?.state;
    expect(same?.have).toBe(1);
    const two = groupStates(
      def,
      animar,
      facts([
        { part: 'elog', at: at(11), sha256: 'abc' },
        { part: 'eshot', at: at(12), sha256: 'def' },
      ]),
    )[0]?.state;
    expect(two?.have).toBe(2);
    // A file one part could give the group, another part holds more of: both count.
    const spare = groupStates(
      def,
      animar,
      facts([
        { part: 'elog', at: at(11), sha256: 'abc' },
        { part: 'eshot', at: at(12), sha256: 'abc' },
        { part: 'eshot', at: at(13), sha256: 'def' },
      ]),
    )[0]?.state;
    expect(spare?.have).toBe(2);
    const refused = handoffCheck(
      def,
      'sanimate',
      facts([
        { part: 'elog', at: at(11), sha256: 'abc' },
        { part: 'eshot', at: at(12), sha256: 'abc' },
      ]),
    );
    expect(refused.ok).toBe(false);
  });

  it('refuses a group that names a part twice, and counts it once if it gets there', () => {
    const twice = structuredClone(def);
    const group = twice.steps[1]?.groups?.[0];
    if (group) group.parts = ['elog', 'elog'];
    expect(groupFaults(twice, twice.steps[1] ?? animar).map(({ code }) => code)).toEqual([
      'group_duplicate',
      'group_small',
    ]);
    const state = groupStates(
      twice,
      twice.steps[1] ?? animar,
      facts([{ part: 'elog', at: at(11) }]),
    )[0]?.state;
    expect(state).toMatchObject({ have: 1, parts: ['Salida'] });
  });

  // The Studio's part for a group: optional evidence is new each round as a member of a group.
  it('wants a new file each round from a member the editor made new each round', () => {
    const old = handoffCheck(
      def,
      'sanimate',
      facts([
        { part: 'eanim', at: at(5), sha256: 'a' },
        { part: 'elog', at: at(5), sha256: 'b' },
      ]),
    );
    // The recording is from an earlier round and the step asks for it new: only the log counts.
    expect(old.ok).toBe(false);
    expect(old.missing[0]?.group).toMatchObject({ have: 1, held: ['Salida'] });
  });
});

describe('an item created with everything its first step asks for', () => {
  // A first step nobody reviews that skips when ready: an unmet group keeps the item there.
  const board = creatures();
  board.parts.eshot = { id: 'eshot', name: 'Captura', kind: 'images', hint: '', options: [] };
  board.parts.elog = { id: 'elog', name: 'Salida', kind: 'log', hint: '', options: [] };
  board.steps[0] = step('sconcept', 'Concepto', {
    reviewer: 'none',
    skipWhenReady: true,
    hand: [
      { ref: 'eshot', req: 'no', fresh: false },
      { ref: 'elog', req: 'no', fresh: false },
    ],
    ways: [],
  });

  it('is skipped past the step while nothing asks for more', () => {
    expect(initialPosition(board, { fields: {}, evidence: [] }).skipped).toBe(true);
  });

  it('is not skipped past a step whose group is not met', () => {
    const first = board.steps[0];
    if (!first) throw new Error('no step');
    const grouped = structuredClone(board);
    const gs = grouped.steps[0];
    if (gs) gs.groups = [{ id: 'gproof', name: 'Prueba', parts: ['eshot', 'elog'], min: 1 }];
    expect(initialPosition(grouped, { fields: {}, evidence: [] })).toEqual({
      position: { step: 'sconcept', phase: 'doing' },
      skipped: false,
    });
    expect(
      initialPosition(grouped, { fields: {}, evidence: [{ part: 'elog', at: at(1) }] }).skipped,
    ).toBe(true);
  });
});
