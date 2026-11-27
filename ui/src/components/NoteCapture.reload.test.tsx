// @vitest-environment happy-dom
import { IDBFactory as FakeIndexedDb } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppTestProvider } from '../app/context.tsx';
import { setLanguage } from '../i18n/i18n.ts';
import { testApp } from '../shell/test-app.ts';
import { type Mounted, mount, press, settle, typeInto } from '../test-dom.tsx';
import { NoteCapture } from './NoteCapture.tsx';

// E1: the installed app updates itself and reloads the page while the camera, another app, has
// the front. A quick note written until then, words and pictures, was gone when the page came back.
// The note is kept as it is written; a send that lands (or Descartar) empties it.

const store = new Map<string, string>();
let page: Mounted | undefined;

beforeEach(() => {
  setLanguage('es');
  store.clear();
  globalThis.indexedDB = new FakeIndexedDb();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => store.set(k, v),
    removeItem: (k: string) => store.delete(k),
  });
  vi.stubGlobal(
    'fetch',
    async () =>
      new Response(JSON.stringify({ ref: 'B-1' }), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      }),
  );
});
afterEach(() => {
  page?.unmount();
  page = undefined;
  vi.unstubAllGlobals();
  setLanguage('en');
});

async function open() {
  page = mount(
    <AppTestProvider
      value={testApp({
        phone: true,
        project: { id: 'p1', name: 'P', icon: null },
        canCapture: true,
      })}
    >
      <NoteCapture onSent={vi.fn()} />
    </AppTestProvider>,
  );
  await settle();
  return page.root;
}

// What the page is when it loads again: a new mount, the browser's storage the same.
async function reload(from: HTMLElement) {
  void from;
  page?.unmount();
  page = undefined;
  return open();
}

const box = (root: HTMLElement) => root.querySelector<HTMLTextAreaElement>('.bn-text');
const save = (root: HTMLElement) => root.querySelector<HTMLButtonElement>('.bn-save');
const names = (root: HTMLElement) =>
  [...root.querySelectorAll('.hb-dname > span')].map((each) => each.textContent);

async function pick(root: HTMLElement, name: string) {
  const input = root.querySelector<HTMLInputElement>('input[type=file]');
  Object.defineProperty(input, 'files', {
    value: [new File(['png-bytes'], name, { type: 'image/png' })],
    configurable: true,
  });
  input?.dispatchEvent(new Event('change', { bubbles: true }));
  await settle();
  // The copy kept in IndexedDB is written after the file is read.
  await new Promise((done) => setTimeout(done, 20));
}

describe('a quick note when the page reloads under it', () => {
  it('comes back with its words and its pictures', async () => {
    const root = await open();
    await typeInto(box(root), 'el botón Aprobar queda tapado');
    await pick(root, 'captura.png');
    expect(names(root)).toHaveLength(1);

    const again = await reload(root);
    await new Promise((done) => setTimeout(done, 30));
    await settle();

    expect(box(again)?.value).toBe('el botón Aprobar queda tapado');
    expect(names(again)).toHaveLength(1);
    expect(again.textContent).toContain('captura');
  });

  it('is gone after it was sent: a reload then shows an empty box', async () => {
    const root = await open();
    await typeInto(box(root), 'una nota');
    await pick(root, 'captura.png');
    await press(save(root));
    await new Promise((done) => setTimeout(done, 30));

    const again = await reload(root);
    await new Promise((done) => setTimeout(done, 30));
    await settle();

    expect(box(again)?.value).toBe('');
    expect(names(again)).toHaveLength(0);
  });
});
