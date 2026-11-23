// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import '../test-dom.tsx';
import { ago, item } from '../derive/fixtures.ts';
import { setLanguage } from '../i18n/i18n.ts';
import type { ItemView, Move } from '../types.ts';
import { TriCard } from './Triage.tsx';

// P5-F1: approving from the phone's Triage did not ask when an "at least N of" group of the
// delivery was short, as the item's page does (P5-F5): the card went out on the first approval.
// The card asks once, and a second approval for the same line goes through.

const plan: Move = { to: 'splanit__doing', by: 'human', reasonRequired: false, turn: 'agent' };
const adr = item({ id: 'IDE-2', collection: 'Ideas', title: 'ADR: dónde se guardan los datos' });
const view: ItemView = {
  ...adr,
  state: 'sdesign__review',
  events: [],
  transitions: [plan],
  relayable: [],
  missing: [],
  evidence: [],
  relations: [],
  createdAt: ago(60),
};
const LINE = 'Pruebas tiene 0 de 1';

let root: ReturnType<typeof createRoot> | undefined;
const decisions: string[] = [];

function draw(caution: string | null) {
  const into = document.createElement('div');
  document.body.append(into);
  root = createRoot(into);
  const render = (line: string | null) =>
    act(() =>
      root?.render(
        <TriCard
          item={adr}
          under={false}
          view={view}
          round={{
            figures: [],
            fields: [],
            files: [],
            gate: undefined,
            pending: false,
            caution: line,
          }}
          words={{ agent: 'Mender', say: '', round: 1 }}
          state="Diseñar"
          phone
          wordOf={(state) => state}
          register={() => undefined}
          onDecide={(kind) => decisions.push(kind)}
          onOpen={() => undefined}
        />,
      ),
    );
  render(caution);
  return { into, render };
}

const approve = (el: HTMLElement) =>
  [...el.querySelectorAll('button')].find((b) => b.textContent === 'Aprobar');

afterEach(() => {
  act(() => root?.unmount());
  document.body.innerHTML = '';
  decisions.length = 0;
  setLanguage('en');
});

describe('Aprobar on a Triage card with a group short', () => {
  it('asks once with the line, and the second press approves', () => {
    setLanguage('es');
    const { into } = draw(LINE);
    act(() => approve(into)?.click());
    expect(decisions).toEqual([]);
    expect(into.querySelector('.tc-caution')?.textContent).toContain(LINE);
    act(() => approve(into)?.click());
    expect(decisions).toEqual(['approve']);
  });

  it('asks again when what was short changed meanwhile', () => {
    setLanguage('es');
    const { into, render } = draw(LINE);
    act(() => approve(into)?.click());
    render('Pruebas tiene 1 de 2');
    act(() => approve(into)?.click());
    expect(decisions).toEqual([]);
  });

  it('approves at once when nothing is short', () => {
    setLanguage('es');
    const { into } = draw(null);
    act(() => approve(into)?.click());
    expect(decisions).toEqual(['approve']);
  });
});
