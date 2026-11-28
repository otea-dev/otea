// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

  // Field study 3: «backoff» found no item after a consultation about backoff; consultations live
  // in Hablar, and the search looked only at items.
  it('finds a consultation in Hablar and opens it at its moment', async () => {
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      const url = new URL(String(input instanceof Request ? input.url : input), 'http://x');
      const search = url.searchParams.get('search');
      const messages =
        search === 'backoff'
          ? [
              {
                id: 7,
                root: 7,
                author: 'person',
                by: 'tú',
                kind: 'consultation',
                text: '¿Conviene un backoff exponencial para los reintentos?',
                at: ago(30),
                attachments: [],
                links: [],
              },
            ]
          : [];
      return new Response(JSON.stringify({ messages, more: false, assistant: null }), {
        headers: { 'content-type': 'application/json' },
      });
    });
    const went: unknown[] = [];
    const here = { ...app, go: (route: unknown) => void went.push(route) } as unknown as App;
    const view = mount(
      <AppTestProvider value={here}>
        <SearchSheet />
      </AppTestProvider>,
    );
    await settle();
    openSearch();
    await settle();
    await typeInto(field(), 'backoff');
    await vi.waitFor(() => expect(document.querySelector('.srow.talk')).not.toBeNull());
    const hit = document.querySelector('.srow.talk');
    expect(hit?.textContent).toContain('backoff exponencial');
    expect(hit?.textContent).toContain('consultation');
    await press(hit);
    expect(went).toEqual([{ view: 'hablar', turn: 7 }]);
    vi.unstubAllGlobals();
    view.unmount();
  });

  // G3: the line a screen reader hears when the results change counted the items alone.
  it('counts what it found in Hablar in the line it reads out, with the items', async () => {
    vi.stubGlobal('fetch', async () => {
      const said = {
        id: 7,
        root: 7,
        author: 'person',
        by: 'tú',
        kind: 'consultation',
        text: '¿Y si el login falla?',
        at: ago(30),
        attachments: [],
        links: [],
      };
      return new Response(JSON.stringify({ messages: [said], more: false, assistant: null }), {
        headers: { 'content-type': 'application/json' },
      });
    });
    const view = mount(
      <AppTestProvider value={app}>
        <SearchSheet />
      </AppTestProvider>,
    );
    await settle();
    openSearch();
    await settle();
    await typeInto(field(), 'login');
    await vi.waitFor(() => expect(document.querySelector('.srow.talk')).not.toBeNull());

    expect(document.querySelector('.srch-count')?.textContent).toBe('1 item · 1 in Talk');

    // Only a hit in Hablar: the line is there too, naming it.
    await typeInto(field(), 'falla');
    await vi.waitFor(() => expect(document.querySelector('.srow.talk')).not.toBeNull());
    expect(document.querySelector('.srch-count')?.textContent).toBe('1 in Talk');
    vi.unstubAllGlobals();
    view.unmount();
  });
});
