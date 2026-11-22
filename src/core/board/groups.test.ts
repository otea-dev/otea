import { describe, expect, it } from 'vitest';
import { groupRef, groupStates, handoffCheck } from './engine.ts';
import { creatures } from './testing.ts';

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
const facts = (evidence: { part: string; at: string; size?: number }[]) => ({
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
});
