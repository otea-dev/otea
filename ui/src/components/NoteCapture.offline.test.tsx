// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppTestProvider } from '../app/context.tsx';
import { setLanguage } from '../i18n/i18n.ts';
import type { QueuedCapture } from '../offline/capture-queue.ts';
import { testApp } from '../shell/test-app.ts';
import { type Mounted, mount, press, settle, typeInto } from '../test-dom.tsx';
import { NoteCapture } from './NoteCapture.tsx';

// The phone's quick note must not be lost when the PC does not answer: it waits in the offline queue
// (files too) and goes when the PC is back; a send that is refused keeps the words, on the phone,
// for the next time the sheet opens.

const queue = vi.hoisted(() => ({
  available: true,
  full: false as false | 'full' | 'storage',
  kept: [] as QueuedCapture[],
}));

vi.mock('../offline/queue-store.ts', () => ({
  queueAvailable: () => queue.available,
  enqueue: async (capture: QueuedCapture) => {
    if (queue.full) return { ok: false, reason: queue.full };
    queue.kept.push(capture);
    return { ok: true };
  },
}));

const store = new Map<string, string>();
let reaches: 'yes' | 'down' | 'refuses' = 'yes';
let posts = 0;
let page: Mounted | undefined;

beforeEach(() => {
  setLanguage('es');
  store.clear();
  queue.available = true;
  queue.full = false;
  queue.kept = [];
  reaches = 'yes';
  posts = 0;
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => store.set(k, v),
    removeItem: (k: string) => store.delete(k),
  });
  vi.stubGlobal('fetch', async () => {
    posts += 1;
    if (reaches === 'down') throw new TypeError('network');
    return reaches === 'refuses'
      ? new Response(JSON.stringify({ error: { message: 'no' } }), {
          status: 400,
          headers: { 'content-type': 'application/json' },
        })
      : new Response(JSON.stringify({ id: 4 }), {
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

async function open(offline: boolean, onSent = vi.fn()) {
  page = mount(
    <AppTestProvider
      value={testApp({
        phone: true,
        project: { id: 'p1', name: 'P', icon: null },
        sync: { offline, syncedAt: 1 },
        // As the app gives it while the PC does not answer: the session reads as read-only, and
        // the capture goes to the queue (app/data.ts).
        session: { canWrite: !offline, canConfigure: true, canManageDevices: true },
        canCapture: queue.available,
      })}
    >
      <NoteCapture onSent={onSent} />
    </AppTestProvider>,
  );
  await settle();
  return { root: page.root, onSent };
}

const box = (root: HTMLElement) => root.querySelector<HTMLTextAreaElement>('.bn-text');
const save = (root: HTMLElement) => root.querySelector<HTMLButtonElement>('.bn-save');

describe('a quick note while the PC does not answer', () => {
  it('waits in the queue, files included, with the key it would have sent under, and says so', async () => {
    const { root, onSent } = await open(true);
    expect(root.querySelector('.bn-hint')?.textContent).toContain('queda en cola');
    await typeInto(box(root), 'el botón Aprobar queda tapado');
    const input = root.querySelector<HTMLInputElement>('input[type=file]');
    Object.defineProperty(input, 'files', {
      value: [new File(['png-bytes'], 'captura.png', { type: 'image/png' })],
    });
    input?.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();

    await press(save(root));

    // Nothing was sent: it was kept, as a note for the Bandeja.
    expect(posts).toBe(0);
    expect(queue.kept).toHaveLength(1);
    const [kept] = queue.kept;
    expect(kept).toMatchObject({
      project: 'p1',
      board: '',
      note: { text: 'el botón Aprobar queda tapado' },
    });
    expect(kept?.id).toMatch(/\S+/);
    expect(kept?.note?.files.map(({ name, type }) => [name, type])).toEqual([
      ['captura.png', 'image/png'],
    ]);
    expect(kept?.note?.files[0]?.bytes.byteLength).toBe(9);
    expect(onSent).toHaveBeenCalledWith('queued');
    expect(box(root)?.value).toBe('');
  });

  it('keeps it too when the PC stops answering as it sends', async () => {
    reaches = 'down';
    const { root, onSent } = await open(false);
    await typeInto(box(root), 'una idea');

    await press(save(root));

    expect(posts).toBe(1);
    expect(queue.kept.map(({ note }) => note?.text)).toEqual(['una idea']);
    expect(onSent).toHaveBeenCalledWith('queued');
  });

  it('does not queue what the PC refused: the words stay, and come back when the sheet opens again', async () => {
    reaches = 'refuses';
    const { root, onSent } = await open(false);
    await typeInto(box(root), 'una idea que no entró');

    await press(save(root));

    expect(queue.kept).toEqual([]);
    expect(onSent).not.toHaveBeenCalled();
    expect(root.querySelector('.bn-err')?.textContent).toContain('no');
    expect(box(root)?.value).toBe('una idea que no entró');
    page?.unmount();

    // Opened again, a reload too: the words are back, until a send goes through.
    const again = await open(false);
    expect(box(again.root)?.value).toBe('una idea que no entró');
    reaches = 'yes';
    await press(save(again.root));
    expect(again.onSent).toHaveBeenCalledWith('sent');
    page?.unmount();
    const after = await open(false);
    expect(box(after.root)?.value).toBe('');
  });

  it('says so and keeps the words when the queue is full or the browser will not store it', async () => {
    queue.full = 'full';
    const { root, onSent } = await open(true);
    await typeInto(box(root), 'una idea');

    await press(save(root));

    expect(onSent).not.toHaveBeenCalled();
    expect(root.querySelector('.bn-err')?.textContent).toContain('La cola está llena');
    expect(box(root)?.value).toBe('una idea');
    expect(store.get('otea.capture.note:p1')).toBe('una idea');

    queue.full = 'storage';
    await press(save(root));
    expect(root.querySelector('.bn-err')?.textContent).toContain('no deja guardar');
  });

  it('is sent straight away where there is no queue (a plain page): the failure is said, nothing is lost', async () => {
    queue.available = false;
    reaches = 'down';
    // The PC stops answering as it sends: the app has not noticed yet, so it still reads writable.
    const { root, onSent } = await open(false);
    await typeInto(box(root), 'una idea');

    await press(save(root));

    expect(queue.kept).toEqual([]);
    expect(onSent).not.toHaveBeenCalled();
    expect(root.querySelector('.bn-err')).not.toBeNull();
    expect(box(root)?.value).toBe('una idea');
  });
});
