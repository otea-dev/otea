// @vitest-environment happy-dom
import { IDBFactory as FakeIndexedDb } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppTestProvider } from '../app/context.tsx';
import { setLanguage } from '../i18n/i18n.ts';
import { ToastHost } from '../kit/pop/toast.tsx';
import { testApp } from '../shell/test-app.ts';
import { type Mounted, mount, press, settle, typeInto } from '../test-dom.tsx';
import { NoteCapture } from './NoteCapture.tsx';

// Field study 6 (D-dd3b69): «Descartar» in a quick note emptied what was written with one tap, and
// there was no way back. It is a tap that can be taken back: Deshacer puts the words back.

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
  // The first send fails and keeps the words, which is what offers «Descartar».
  vi.stubGlobal(
    'fetch',
    async () =>
      new Response(JSON.stringify({ error: { message: 'sin red' } }), {
        status: 500,
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
      <ToastHost />
    </AppTestProvider>,
  );
  await settle();
  return page.root;
}

const box = () => document.querySelector<HTMLTextAreaElement>('.bn-text');
const undo = () => document.querySelector<HTMLButtonElement>('[data-undo]');

describe('«Descartar» in a quick note', () => {
  it('empties the note, and Deshacer puts the words back', async () => {
    const root = await open();
    await typeInto(box(), 'una idea que no quiero perder');
    await press(root.querySelector('.bn-save'));
    expect(root.querySelector('.bn-err')).not.toBeNull();

    await press(root.querySelector('.bn-discard'));
    expect(box()?.value).toBe('');
    expect(undo()?.hidden).toBe(false);

    await press(undo());
    expect(box()?.value).toBe('una idea que no quiero perder');
    // And it is the kept note again: a reload finds it, and Descartar is still on offer.
    expect(store.size).toBeGreaterThan(0);
    expect(root.querySelector('.bn-discard')).not.toBeNull();
  });
});
