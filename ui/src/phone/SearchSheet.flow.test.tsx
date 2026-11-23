// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type App, AppTestProvider } from '../app/context.tsx';
import { ago, item } from '../derive/fixtures.ts';
import { setLanguage } from '../i18n/i18n.ts';
import { mount, press, settle, typeInto } from '../test-dom.tsx';
import { SearchSheet } from './SearchSheet.tsx';
import { closeSearch, openSearch } from './search-open.ts';

// P7-F2: the phone searches its items: type, see them as rows, open one.

const opened: string[] = [];
const app = {
  now: Date.parse(ago(0)),
  all: [
    item({ id: 'CAM-1', collection: 'Cambios', title: 'Corregir el login' }),
    item({ id: 'CAM-2', collection: 'Cambios', title: 'Añadir modo oscuro' }),
  ],
  collectionOf: () => undefined,
  route: { view: 'toca' },
  phone: true,
  openItem: (id: string) => opened.push(id),
} as unknown as App;

beforeEach(() => {
  setLanguage('en');
  opened.length = 0;
});
afterEach(() => closeSearch());

const field = () => document.querySelector<HTMLInputElement>('input.srch-input');
const rows = () => [...document.querySelectorAll('.srow')].map((row) => row.textContent);

describe('the phone search sheet', () => {
  it('finds items by their words and opens the one pressed, blank on each opening', async () => {
    const view = mount(
      <AppTestProvider value={app}>
        <SearchSheet />
      </AppTestProvider>,
    );
    await settle();
    openSearch();
    await settle();
    expect(rows()).toEqual([]);

    await typeInto(field(), 'anadir');
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toContain('Añadir modo oscuro');
    expect(rows()[0]).toContain('CAM-2');

    await typeInto(field(), 'zzzz');
    expect(document.querySelector('.srch-note')?.textContent).toContain('zzzz');

    await typeInto(field(), 'login');
    await press(document.querySelector('.srow'));
    expect(opened).toEqual(['CAM-1']);

    // Opened again: blank, nothing left from the last search.
    openSearch();
    await settle();
    expect(field()?.value).toBe('');
    view.unmount();
  });
});
