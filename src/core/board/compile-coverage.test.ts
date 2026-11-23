import { describe, expect, it } from 'vitest';
import { compileBoard } from './compile.ts';
import { isLandStep, stateOf } from './engine.ts';
import { sequenceIds } from './ids.ts';
import { type BoardDefinition, DONE, type Part } from './model.ts';
import {
  instantiate,
  instantiateSet,
  requireSet,
  requireTemplate,
  TEMPLATE_SETS,
  TEMPLATES,
} from './templates.ts';
import { errores, step } from './testing.ts';

const moves = (def = errores()) =>
  compileBoard('berr', 1, def).workflow.transitions.map(
    ({ from, to, by, reasonRequired }) => `${from}>${to}:${by}${reasonRequired ? '!' : ''}`,
  );

describe('compileBoard, the later settings', () => {
  it('lets the doer take an item back to an earlier step, with a reason', () => {
    const all = moves();
    expect(all).toContain('sfix>striage:agent!');
    // The person's own step gives it back (Devolver a Completar), with a note.
    expect(all).toContain('striage>sfill:human!');
  });

  it('asks a reason on the handoff of a step that wants a note', () => {
    const all = moves();
    expect(all).toContain('sfix>sfix__review:agent!');
    expect(all).toContain('sfill>striage:agent');
  });

  it('closes a discard in a state per motive, from the page only, besides plain Descartado', () => {
    const preset = compileBoard('berr', 1, errores());
    const states = preset.workflow.states.filter(({ turn }) => turn === 'none');
    expect(states.map(({ name, closes }) => `${name}:${closes}`)).toEqual([
      'done:done',
      'dropped:discarded',
      'dropped__rejected:discarded',
      'dropped__duplicate:discarded',
    ]);
    const all = moves();
    expect(all).toContain('striage>dropped__duplicate:human-ui!');
    expect(all).toContain('sfix__review>dropped__rejected:human-ui!');
    expect(all).not.toContain('striage>dropped__duplicate:human!');
    expect(preset.types[0]?.labels?.es?.states.dropped__duplicate).toBe('Duplicado');
  });

  it('lets an agent drop from the doing phase of a step that allows it, saying why', () => {
    const all = moves();
    expect(all).toContain('sfix>dropped__rejected:agent!');
    expect(all).not.toContain('sfill>dropped__rejected:agent!');
    const anyone = errores();
    anyone.drop = { by: 'anyone', motives: [] };
    expect(moves(anyone)).toContain('striage>dropped:human!');
  });

  it('gates the protected branch: push while its steps are done, merge at Hecho', () => {
    const { gates } = compileBoard('berr', 1, errores()).workflow;
    expect(gates).toEqual({ push: ['sfix'], merge: ['done'] });
  });

  it('gives a field its start value, and draws the list as a table grouped as asked', () => {
    const def = errores();
    def.parts.fcat = { ...(def.parts.fcat as Part), initial: 'cgame' };
    def.form = [{ ref: 'fcat', required: false }];
    def.row = ['fcat'];
    def.list = { as: 'table', group: 'fcat' };
    const preset = compileBoard('berr', 1, def);
    expect(preset.fields.fcat?.default).toBe('cgame');
    expect(preset.view).toEqual({
      kind: 'grid',
      groupBy: 'fcat',
      // The column it groups by is not repeated in every row.
      columns: ['id', 'title', 'state', 'who', 'age'],
    });
    def.list = { as: 'list', group: 'step' };
    expect(compileBoard('berr', 1, def).view.groupBy).toBe('state');
  });

  it('places the rounds and the parts where Acomodar put them', () => {
    const def = errores();
    def.layout = { rounds: 'main', parts: 'side' };
    def.split = { board: 'same', always: false };
    const layout = compileBoard('berr', 1, def).types[0]?.layout;
    expect(layout?.body).toContainEqual({ module: 'rounds' });
    expect(layout?.side).toContainEqual({ module: 'children' });
    // Without a split, there are no parts to place.
    delete def.split;
    expect(compileBoard('berr', 1, def).types[0]?.layout.side).not.toContainEqual({
      module: 'children',
    });
  });
});

describe('compileBoard, the template sets', () => {
  it('compiles every board of every set', () => {
    for (const set of TEMPLATE_SETS) {
      for (const lang of ['en', 'es'] as const) {
        const ids = set.boards.map((_, index) => ({ id: `b${index}` }));
        for (const def of instantiateSet(set, lang, ids)) {
          expect(() => compileBoard('bset', 1, def), `${set.key} ${def.name}`).not.toThrow();
        }
      }
    }
  });

  // P1-F1: an agent could relay an invented approval into the land step. What lands on main or
  // closes the item is the person's, on the desk or the phone, in every shipped board; send-backs
  // and drops stay `human`, so chat can still make them.
  // The land steps of a board, and every move the person makes that chat can relay (`human`) whose
  // target is one of them or Hecho.
  const relayableLandings = (def: BoardDefinition) => {
    const landing = new Set(
      def.steps
        .filter(({ id }) => isLandStep(def, id))
        .map(({ id }) => stateOf({ step: id, phase: 'doing' })),
    );
    const { transitions } = compileBoard('bset', 1, def).workflow;
    const relayable = transitions
      .filter(({ by, to }) => by === 'human' && (landing.has(to) || to === DONE))
      .map(({ from, to }) => `${from}>${to}`);
    return { lands: landing.size, relayable };
  };

  it('makes the approval into a land step or Hecho human-ui in every board, never a send-back', () => {
    let lands = 0;
    for (const lang of ['en', 'es'] as const) {
      const boards = [
        // Every template of the catalogue, the retired ones and the coverage ones too.
        ...TEMPLATES.map((template) => ({
          where: `${template.key} ${lang}`,
          def: instantiate(template, lang, {}, sequenceIds()),
        })),
        ...TEMPLATE_SETS.flatMap((set) => {
          const ids = set.boards.map((_, index) => ({ id: `b${index}` }));
          return instantiateSet(set, lang, ids).map((def) => ({
            where: `${set.key} ${def.name} ${lang}`,
            def,
          }));
        }),
      ];
      for (const { where, def } of boards) {
        const found = relayableLandings(def);
        lands += found.lands;
        expect(found.relayable, `${where}: a relayable move into a land step or Hecho`).toEqual([]);
      }
    }
    expect(lands).toBeGreaterThan(0);
  });

  // A later step whose review sends back INTO the land step: a send-back is relayable, and it put
  // the item in the land step with no approval of the person's, which an agent then landed.
  it('makes a send-back from a later step into the land step human-ui on a custom board', () => {
    const def = instantiate(requireTemplate('changes'), 'en', {}, sequenceIds());
    const land = def.steps.find((each) => each.name === 'Land');
    if (!land) throw new Error('no Land');
    land.ways = [DONE];
    def.steps.push(step('sverify', 'Verify', { doer: 'any', reviewer: 'you', back: land.id }));
    expect(isLandStep(def, land.id)).toBe(true);
    const doing = stateOf({ step: land.id, phase: 'doing' });
    const all = moves(def);
    expect(all).toContain(`${stateOf({ step: 'sverify', phase: 'review' })}>${doing}:human-ui!`);
    expect(relayableLandings(def).relayable).toEqual([]);
  });

  it('keeps a send-back from the person’s review relayable, and its approval into the land step human-ui', () => {
    const def = instantiate(requireTemplate('changes'), 'en', {}, sequenceIds());
    const step = (name: string) => def.steps.find((each) => each.name === name)?.id ?? '';
    const review = stateOf({ step: step('Do it'), phase: 'review' });
    const doing = (name: string) => stateOf({ step: step(name), phase: 'doing' });
    const all = moves(def);
    expect(all).toContain(`${review}>${doing('Do it')}:human!`);
    expect(all).toContain(`${review}>${doing('Land')}:human-ui`);
    expect(all).toContain(`${doing('Land')}>${DONE}:agent`);
  });

  it('compiles the protected branch of Entregas into its gates', () => {
    const [, tasks] = instantiateSet(
      requireSet('repos'),
      'es',
      [{ id: 'b1' }, { id: 'b2' }],
      sequenceIds(),
    );
    const preset = compileBoard('b2', 1, tasks as BoardDefinition);
    const implement = tasks?.steps[0]?.id ?? '';
    expect(preset.workflow.gates).toEqual({ push: [implement], merge: ['done'] });
  });
});
