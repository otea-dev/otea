// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppTestProvider } from '../app/context.tsx';
import { setLanguage } from '../i18n/i18n.ts';
import { testApp } from '../shell/test-app.ts';
import { type Mounted, mount, press, settle, typeInto } from '../test-dom.tsx';
import { NewItemForm } from './NewItemForm.tsx';

vi.mock('../board-studio/home/boards-store.ts', () => ({
  useBoards: () => ({ status: 'ready', boards: [] }),
  boardsOf: () => [],
  boardOfCollection: () => undefined,
}));

// Nuevo ítem on the desk and on the phone: the board's form, or a free note that lands in the
// Bandeja. The desk starts on the form, the phone on the note; a child of an item is always a form.

let page: Mounted | undefined;
let posted: { path: string; body: unknown }[] = [];

beforeEach(() => {
  setLanguage('es');
  posted = [];
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init: RequestInit = {}) => {
    posted.push({
      path: new URL(String(input instanceof Request ? input.url : input), 'http://x').pathname,
      body: typeof init.body === 'string' ? JSON.parse(init.body) : init.body,
    });
    return new Response(JSON.stringify({ id: 1 }), {
      status: 201,
      headers: { 'content-type': 'application/json' },
    });
  });
});
afterEach(() => {
  page?.unmount();
  page = undefined;
  vi.unstubAllGlobals();
  setLanguage('en');
});

const open = async (phone: boolean, props: Parameters<typeof NewItemForm>[0]) => {
  page = mount(
    <AppTestProvider value={testApp({ phone })}>
      <NewItemForm {...props} />
    </AppTestProvider>,
  );
  await settle();
  return page.root;
};
const modes = (root: HTMLElement) => [
  ...root.querySelectorAll<HTMLButtonElement>('.bn-mode button'),
];

describe('Nuevo ítem', () => {
  // D-37e7ce: the quick note hid behind a board's form on the desk, and a person who only wanted to
  // jot something down had to find the switch. It is the first and the chosen way, on the desk too.
  it('starts on the quick note on the desk, which lands in the Bandeja, and a tap writes with a board instead', async () => {
    const onCancel = vi.fn();
    const root = await open(false, { onCancel, onCreated: vi.fn() });

    expect(modes(root).map((button) => button.textContent)).toEqual(['Nota rápida', 'Con tablero']);
    expect(modes(root)[0]?.classList.contains('on')).toBe(true);
    expect(root.querySelector('.bn-text')).not.toBeNull();

    await typeInto(root.querySelector('.bn-text'), 'agregar modo oscuro');
    await press(root.querySelector('.bn-save'));

    expect(posted).toEqual([{ path: '/api/bandeja', body: { text: 'agregar modo oscuro' } }]);
    // The sheet closes: the note is written down.
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  // G3: a look at the board's form threw away the note that was being typed.
  it('keeps the note that was typed while the board’s form is looked at', async () => {
    const root = await open(false, { onCancel: vi.fn(), onCreated: vi.fn() });

    await typeInto(root.querySelector('.bn-text'), 'una idea a medias');
    await press(modes(root)[1]);
    await press(modes(root)[0]);

    expect(root.querySelector<HTMLTextAreaElement>('.bn-text')?.value).toBe('una idea a medias');
  });

  it('starts on the note on the phone and the desk, unless a board or a parent asked for the form', async () => {
    const root = await open(true, { onCancel: vi.fn(), onCreated: vi.fn() });
    expect(modes(root)[0]?.classList.contains('on')).toBe(true);
    expect(root.querySelector('.bn-text')).not.toBeNull();
    page?.unmount();

    const desk = await open(false, { board: 'Pedidos', onCancel: vi.fn(), onCreated: vi.fn() });
    expect(modes(desk)[1]?.classList.contains('on')).toBe(true);
    expect(desk.querySelector('.bn-text')).toBeNull();
    page?.unmount();

    const board = await open(true, { board: 'Pedidos', onCancel: vi.fn(), onCreated: vi.fn() });
    expect(board.querySelector('.bn-text')).toBeNull();
    page?.unmount();

    const child = await open(true, {
      parent: { id: 'PED-1', title: 'Padre', type: 'item', collection: 'Pedidos' },
      onCancel: vi.fn(),
      onCreated: vi.fn(),
    });
    expect(modes(child)).toEqual([]);
    expect(child.querySelector('.bn-text')).toBeNull();
  });
});
