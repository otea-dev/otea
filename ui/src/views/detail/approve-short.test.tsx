// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type App, AppTestProvider } from '../../app/context.tsx';
import { officialType } from '../../derive/fixtures.ts';
import { setLanguage } from '../../i18n/i18n.ts';
import { testApp } from '../../shell/test-app.ts';
import { buttonNamed, type Mounted, mount, press } from '../../test-dom.tsx';
import type { ItemView } from '../../types.ts';
import { Acts } from './Acts.tsx';
import { shortGroupCaution } from './board-item.ts';
import type { Facts } from './facts.ts';
import { planMoves } from './moves.ts';

// P5-F5: Aprobar approved at once with an "at least N of" group in red, with nothing to say. It
// asks once, in a line under the buttons, and the second press approves.

const bug = officialType('bug-triage');
const moves = [
  { to: 'fixed', by: 'human-ui', reasonRequired: false, turn: 'none', closes: 'done' },
  { to: 'fixing', by: 'human', reasonRequired: true, turn: 'agent' },
] as ItemView['transitions'];
const item = {
  id: 'ERR-1',
  collection: 'Errores',
  type: bug.name,
  title: 'Los lobos',
  fields: {},
  state: 'verify',
  turn: 'human',
  createdAt: '2026-11-17T08:00:00.000Z',
  updatedAt: '2026-11-17T08:30:00.000Z',
  lease: null,
  events: [],
  transitions: moves,
  relayable: [],
  missing: [],
  evidence: [],
  relations: [],
} as unknown as ItemView;
const facts: Facts = {
  agent: 'Mender',
  left: false,
  handed: null,
  round: 2,
  question: false,
  own: false,
  mine: null,
  answered: null,
  visited: [],
  sentBack: [],
};
const short = [{ id: 'gproof', name: 'Evidencia', min: 2, have: 1, parts: ['Captura', 'GIF'] }];

let page: Mounted | undefined;
let made: string[];
beforeEach(() => {
  setLanguage('es');
  made = [];
});
afterEach(() => {
  page?.unmount();
  setLanguage('en');
});

function open(caution: (label: string) => string | null) {
  const plan = planMoves(moves, { own: false, word: (state) => state });
  const app: App = testApp({
    move: async (_id, to) => {
      made.push(to);
    },
  });
  page = mount(
    <AppTestProvider value={app}>
      <Acts
        item={item}
        type={bug}
        facts={facts}
        look="yours"
        plan={plan}
        mode="moves"
        word={(state) => state}
        notesOpen={null}
        onNotes={() => undefined}
        caution={(choice) => (choice.kind === 'approve' ? caution(choice.label) : null)}
      />
    </AppTestProvider>,
  );
  return page.root;
}

describe('approving with a group short', () => {
  it('asks once, and approves on the second press', async () => {
    const root = open((action) => shortGroupCaution(short, action));
    await press(buttonNamed(root, 'Aprobar'));
    expect(made).toEqual([]);
    expect(root.querySelector('.said.warn')?.textContent).toBe(
      'Evidencia (1 de 2) no llega a lo que pide el paso. Pulsa Aprobar otra vez para aprobar igualmente.',
    );

    await press(buttonNamed(root, 'Aprobar'));
    expect(made).toEqual(['fixed']);
  });

  it('approves at the first press when no group is short', async () => {
    const root = open((action) => shortGroupCaution([], action));
    await press(buttonNamed(root, 'Aprobar'));
    expect(made).toEqual(['fixed']);
  });

  it('names every short group, in the plural', () => {
    const two = [...short, { id: 'gb', name: 'Registro', min: 1, have: 0, parts: ['Log'] }];
    expect(shortGroupCaution(two, 'Aprobar')).toBe(
      'Evidencia (1 de 2) y Registro (0 de 1) no llegan a lo que pide el paso. Pulsa Aprobar otra vez para aprobar igualmente.',
    );
  });
});
