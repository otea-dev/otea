// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppTestProvider } from '../app/context.tsx';
import { item } from '../derive/fixtures.ts';
import { setLanguage } from '../i18n/i18n.ts';
import { type Mounted, mount, press, settle } from '../test-dom.tsx';
import type { CollectionView } from '../types.ts';
import { Rail } from './Rail.tsx';
import { testApp } from './test-app.ts';

// Pilot 1 (a1): the rail read as «se Hablar», «Te toca 1 1», and a board's row was a button with
// another button inside it. A row is one control, named by its words and what waits in it, and its
// «+» is a control beside it.

let page: Mounted | undefined;
beforeEach(() => {
  setLanguage('es');
  vi.stubGlobal(
    'fetch',
    async () =>
      new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } }),
  );
});
afterEach(() => {
  page?.unmount();
  page = undefined;
  vi.unstubAllGlobals();
  setLanguage('en');
});

const board = (name: string) => ({ name, icon: null, types: [] }) as unknown as CollectionView;

// What a screen reader says of a node: its words, less what is hidden from it.
const heard = (el: Element): string =>
  [...el.childNodes]
    .map((node) =>
      node instanceof Element
        ? node.getAttribute('aria-hidden') === 'true' || node.hasAttribute('hidden')
          ? ''
          : heard(node)
        : (node.textContent ?? ''),
    )
    .join('')
    .replace(/\s+/g, ' ')
    .trim();

const open = async (go = vi.fn()) => {
  page = mount(
    <AppTestProvider
      value={testApp({
        go,
        all: [item({ id: 'E1', collection: 'Errores', turn: 'human' })],
        collections: [board('Errores')],
        route: { view: 'toca' },
      })}
    >
      <Rail />
    </AppTestProvider>,
  );
  await settle();
  return page.root;
};

describe('the rail for a screen reader', () => {
  it('reads each row as its words and what waits in it, nothing doubled', async () => {
    const root = await open();
    const row = (k: string) => root.querySelector(`.nrow[data-k="${k}"]`) as HTMLElement;
    expect(heard(row('hablar'))).toBe('Hablar');
    expect(heard(row('toca'))).toBe('Te toca, 1 pendiente');
    expect(heard(row('atasco'))).toBe('Atasco');
    expect(heard(row('board:Errores'))).toContain('Errores');
    expect(heard(row('board:Errores'))).not.toMatch(/\d \/ \d/);
  });

  it('has no control inside another: a row is one button, and its «+» stands beside it', async () => {
    const root = await open();
    for (const row of root.querySelectorAll('.nrow')) {
      expect(row.hasAttribute('role'), row.getAttribute('data-k') ?? '').toBe(false);
      expect(row.querySelectorAll('button, a[href]').length).toBeGreaterThanOrEqual(1);
    }
    expect(root.querySelectorAll('[role="button"] button, [role="button"] a')).toHaveLength(0);
    const errores = root.querySelector('.nrow[data-k="board:Errores"]') as HTMLElement;
    const names = [...errores.querySelectorAll('button')].map(
      (b) => heard(b) || b.getAttribute('aria-label'),
    );
    expect(names).toHaveLength(2);
    expect(names[1]).toBe('Nuevo ítem en Errores');
  });

  it('goes to the view with the row’s button, and marks the one in view', async () => {
    const go = vi.fn();
    const root = await open(go);
    const toca = root.querySelector('.nrow[data-k="toca"] button') as HTMLElement;
    expect(toca.getAttribute('aria-current')).toBe('page');
    await press(root.querySelector('.nrow[data-k="hablar"] button'));
    expect(go).toHaveBeenCalledWith({ view: 'hablar' });
  });
});
