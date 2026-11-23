// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

  it('forgets what it asked once the group is met, and asks again if it falls short again', () => {
    setLanguage('es');
    const { into, render } = draw(LINE);
    act(() => approve(into)?.click());
    expect(into.querySelector('.tc-caution')).not.toBeNull();
    render(null);
    expect(into.querySelector('.tc-caution')).toBeNull();
    render(LINE);
    expect(into.querySelector('.tc-caution')).toBeNull();
    act(() => approve(into)?.click());
    expect(decisions).toEqual([]);
    expect(into.querySelector('.tc-caution')?.textContent).toContain(LINE);
  });
});

// A swipe right is a gesture, not a press: past the threshold the card used to be thrown out. With a
// group short the first swipe comes home and says the line, and the second goes through.
describe('a swipe to approve on a Triage card with a group short', () => {
  const swipe = (card: HTMLElement, dx: number) => {
    const fire = (type: string, x: number) =>
      act(() => {
        card.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            pointerId: 1,
            button: 0,
            clientX: 100 + x,
            clientY: 300,
          }),
        );
      });
    fire('pointerdown', 0);
    fire('pointermove', dx / 2);
    fire('pointermove', dx);
    fire('pointerup', dx);
  };
  const cardOf = (el: HTMLElement) => el.querySelector('article.tcard') as HTMLElement;

  beforeEach(() => {
    // happy-dom lays nothing out: the card is 360 wide, so the threshold is 108.
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(360);
    HTMLElement.prototype.setPointerCapture ??= () => undefined;
  });
  afterEach(() => vi.restoreAllMocks());

  it('holds the first swipe and says the line, and the second swipe approves', () => {
    setLanguage('es');
    const { into } = draw(LINE);
    swipe(cardOf(into), 220);
    expect(decisions).toEqual([]);
    expect(into.querySelector('.tc-caution')?.textContent).toContain(LINE);
    swipe(cardOf(into), 220);
    expect(decisions).toEqual(['approve']);
  });

  it('swipes out at once when nothing is short', () => {
    setLanguage('es');
    const { into } = draw(null);
    swipe(cardOf(into), 220);
    expect(decisions).toEqual(['approve']);
  });
});
