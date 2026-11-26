// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type App, AppTestProvider } from '../app/context.tsx';
import { setLanguage } from '../i18n/i18n.ts';
import { testApp } from '../shell/test-app.ts';
import { mount, press, settle, typeInto } from '../test-dom.tsx';
import type { CollectionView } from '../types.ts';
import { CaptureSheet } from './CaptureSheet.tsx';
import { captureNow, closeCapture, openCapture, startMode } from './capture.ts';

vi.mock('../board-studio/home/boards-store.ts', () => ({
  useBoards: () => ({ status: 'ready', boards: [] }),
  boardsOf: () => [],
  boardOfCollection: () => undefined,
}));

// The phone's Nuevo ítem opens on a free note: just the words and files, no board form. It lands in
// the project's Bandeja; the board's form is one tap away.

const pedidos = { name: 'Pedidos', prefix: 'PED', types: [] } as unknown as CollectionView;
const app: App = testApp({ phone: true, collections: [pedidos], route: { view: 'toca' } });

let writes: { path: string; body: unknown; key: string | undefined }[] = [];

beforeEach(() => {
  setLanguage('en');
  writes = [];
  vi.stubGlobal('localStorage', {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
  });
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input instanceof Request ? input.url : input), 'http://x');
    const headers = (init.headers ?? {}) as Record<string, string>;
    writes.push({
      path: url.pathname,
      body: typeof init.body === 'string' ? JSON.parse(init.body) : init.body,
      key: headers['idempotency-key'],
    });
    return new Response(JSON.stringify({ id: 1, ref: 'B-1' }), {
      status: 201,
      headers: { 'content-type': 'application/json' },
    });
  });
});
afterEach(() => {
  closeCapture();
  vi.unstubAllGlobals();
});

describe('which way the sheet opens', () => {
  it('on a note, unless a board asked for it or the way is given', () => {
    expect(startMode({})).toBe('note');
    expect(startMode({ board: 'Tareas' })).toBe('board');
    expect(startMode({ mode: 'note', board: 'Tareas' })).toBe('note');
    expect(startMode({ mode: 'board' })).toBe('board');
  });
});

describe('the phone’s quick note', () => {
  it('opens on the note, saves it to the Bandeja with a key, and closes with no board chosen', async () => {
    const view = mount(
      <AppTestProvider value={app}>
        <CaptureSheet />
      </AppTestProvider>,
    );
    await settle();
    openCapture();
    await settle();

    // A note: no title field, no board chip.
    expect(document.querySelector('input.ftitle')).toBeNull();
    expect(document.querySelector('.boardpick')).toBeNull();
    const box = document.querySelector<HTMLTextAreaElement>('.bn-text');
    expect(document.activeElement).toBe(box);
    await typeInto(box, 'el botón Aprobar queda tapado en el celu');
    await press(document.querySelector('.bn-save'));

    expect(writes).toEqual([
      {
        path: '/api/bandeja',
        body: { text: 'el botón Aprobar queda tapado en el celu' },
        key: expect.stringMatching(/\S+/),
      },
    ]);
    await settle();
    expect(captureNow().open).toBe(false);
    view.unmount();
  });

  it('goes to the board’s form with one tap, and back', async () => {
    const view = mount(
      <AppTestProvider value={app}>
        <CaptureSheet />
      </AppTestProvider>,
    );
    await settle();
    openCapture();
    await settle();

    const modes = [...document.querySelectorAll<HTMLButtonElement>('.bn-mode button')];
    expect(modes.map((button) => button.textContent)).toEqual(['Quick note', 'With a board']);
    await press(modes[1]);
    expect(document.querySelector('.bn-text')).toBeNull();
    await press(document.querySelectorAll<HTMLButtonElement>('.bn-mode button')[0]);
    expect(document.querySelector('.bn-text')).not.toBeNull();
    view.unmount();
  });
});
