// @vitest-environment happy-dom
import { IDBFactory as FakeIndexedDb } from 'fake-indexeddb';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppTestProvider } from '../app/context.tsx';
import { setLanguage } from '../i18n/i18n.ts';
import { testApp } from '../shell/test-app.ts';
import { type Mounted, mount, settle, typeInto } from '../test-dom.tsx';
import { NoteCapture } from './NoteCapture.tsx';

// Field study 6 (D-33d880): Ctrl+Enter did not send a quick note. Enter alone still writes a new
// line.

let page: Mounted | undefined;
const sent: unknown[] = [];

beforeEach(() => {
  setLanguage('es');
  sent.length = 0;
  globalThis.indexedDB = new FakeIndexedDb();
  vi.stubGlobal('fetch', async (_url: unknown, init: RequestInit = {}) => {
    sent.push(init.body);
    return new Response(JSON.stringify({ ref: 'B-1' }), {
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

async function open(onSent = vi.fn()) {
  page = mount(
    <AppTestProvider
      value={testApp({ project: { id: 'p1', name: 'P', icon: null }, canCapture: true })}
    >
      <NoteCapture onSent={onSent} />
    </AppTestProvider>,
  );
  await settle();
  return page.root.querySelector<HTMLTextAreaElement>('.bn-text') as HTMLTextAreaElement;
}

async function key(box: HTMLElement, init: KeyboardEventInit) {
  await act(async () => {
    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, ...init }));
  });
  await settle();
}

describe('sending a quick note from the keys', () => {
  it('sends on Ctrl+Enter, and on Cmd+Enter', async () => {
    for (const mod of [{ ctrlKey: true }, { metaKey: true }]) {
      sent.length = 0;
      const onSent = vi.fn();
      const box = await open(onSent);
      await typeInto(box, 'una idea');
      await key(box, mod);
      expect(sent).toHaveLength(1);
      expect(onSent).toHaveBeenCalledWith('sent', 'B-1');
      page?.unmount();
    }
  });

  it('leaves Enter alone for a new line, and sends nothing for an empty note', async () => {
    const box = await open();
    await typeInto(box, 'una idea');
    await key(box, {});
    expect(sent).toHaveLength(0);

    await typeInto(box, '');
    await key(box, { ctrlKey: true });
    expect(sent).toHaveLength(0);
  });
});
