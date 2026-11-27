// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type App, AppTestProvider } from '../app/context.tsx';
import { setLanguage } from '../i18n/i18n.ts';
import { testApp } from '../shell/test-app.ts';
import { mount, press, settle, typeInto } from '../test-dom.tsx';
import type { CollectionView } from '../types.ts';
import { CaptureSheet } from './CaptureSheet.tsx';
import { captureNow, closeCapture, openCapture, startMode } from './capture.ts';

const toasts = vi.hoisted(
  () => [] as { msg: unknown; action?: { label: string; run: () => void } }[],
);
vi.mock('../kit/pop/toast.tsx', async (actual) => ({
  ...(await actual<typeof import('../kit/pop/toast.tsx')>()),
  toast: (options: (typeof toasts)[number]) => void toasts.push(options),
}));
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

  // Field study 3: after «Anotar» nothing said where the note went; it lives in Hablar's «Lo que
  // salió», which the phone's Panel does not name.
  it('says where the note went, with a link to its row in the Bandeja', async () => {
    const went: unknown[] = [];
    const here = testApp({
      phone: true,
      collections: [pedidos],
      route: { view: 'toca' },
      go: (route: unknown) => void went.push(route),
    });
    const view = mount(
      <AppTestProvider value={here}>
        <CaptureSheet />
      </AppTestProvider>,
    );
    await settle();
    openCapture();
    await settle();
    await typeInto(document.querySelector<HTMLTextAreaElement>('.bn-text'), 'una nota');
    await press(document.querySelector('.bn-save'));
    await settle();
    const shown = toasts.at(-1);
    expect(shown?.action?.label).toBe('See it in the Inbox');
    shown?.action?.run();
    expect(went).toEqual([{ view: 'hablar', bandeja: 'B-1' }]);
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
    // The note is put aside (its words are kept: see below), the board's form is what shows.
    expect(document.querySelector('.bn-text')?.closest('[hidden]')).not.toBeNull();
    expect(document.querySelector('input.ftitle')).not.toBeNull();
    await press(document.querySelectorAll<HTMLButtonElement>('.bn-mode button')[0]);
    expect(document.querySelector('.bn-text')?.closest('[hidden]')).toBeNull();
    expect(document.querySelector('input.ftitle')).toBeNull();
    view.unmount();
  });

  // G3: looking at the board's form unmounted the note, and what was typed went with it.
  it('keeps the note while the board’s form is looked at', async () => {
    const view = mount(
      <AppTestProvider value={app}>
        <CaptureSheet />
      </AppTestProvider>,
    );
    await settle();
    openCapture();
    await settle();
    await typeInto(document.querySelector<HTMLTextAreaElement>('.bn-text'), 'una idea a medias');

    const modes = () => [...document.querySelectorAll<HTMLButtonElement>('.bn-mode button')];
    await press(modes()[1]);
    await press(modes()[0]);

    expect(document.querySelector<HTMLTextAreaElement>('.bn-text')?.value).toBe(
      'una idea a medias',
    );
    view.unmount();
  });
});
