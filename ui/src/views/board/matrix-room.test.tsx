// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BoardDefinition } from '../../../../src/core/board/model.ts';
import { creatures } from '../../../../src/core/board/testing.ts';
import { setLanguage } from '../../i18n/i18n.ts';
import { mount } from '../../test-dom.tsx';
import type { Item } from '../../types.ts';
import { MatrixView } from './Matrix.tsx';

// The tray docks over the foot of the page; the Matrix's axis words sit at the foot of its grid.
// Picking the first item brings them up clear of the tray, and the room it needs is in the CSS.

function weighed(): BoardDefinition {
  const def = creatures();
  def.parts.feffort = {
    id: 'feffort',
    name: 'Effort',
    kind: 'choice',
    hint: '',
    options: [
      { id: 'cs', name: 'S' },
      { id: 'cl', name: 'L' },
    ],
  };
  def.parts.frisk = { id: 'frisk', name: 'Risk', kind: 'level', hint: '', options: [] };
  def.analysis = { effort: 'feffort', risk: 'frisk' };
  return def;
}

const items = [
  { id: 'A', title: 'A', fields: { feffort: 'cl', frisk: 'high' } } as unknown as Item,
];

const scrolled = vi.fn();

beforeEach(() => {
  setLanguage('en');
  Element.prototype.scrollIntoView = function scrollIntoView(this: Element, ...args: unknown[]) {
    scrolled(this.className, ...args);
  };
});
afterEach(() => scrolled.mockReset());

describe('the Matrix under the tray', () => {
  it('scrolls the grid and its axis words into view when the first item is ticked', () => {
    const show = (ticked: string[]) => (
      <MatrixView
        collection="x"
        def={weighed()}
        items={items}
        ticked={ticked}
        onTick={() => undefined}
        onOpen={() => undefined}
      />
    );
    const page = mount(show([]));
    expect(scrolled).not.toHaveBeenCalled();
    page.unmount();

    mount(show(['A'])).unmount();

    expect(scrolled).toHaveBeenCalledTimes(1);
    expect(scrolled.mock.calls[0]?.[0]).toBe('mx-wrap');
    expect(scrolled.mock.calls[0]?.[1]).toMatchObject({ block: 'nearest' });
  });
});
