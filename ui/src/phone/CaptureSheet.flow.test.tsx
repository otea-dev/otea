// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type App, AppTestProvider } from '../app/context.tsx';
import { setLanguage } from '../i18n/i18n.ts';
import { mount, press, settle, typeInto } from '../test-dom.tsx';
import type { CollectionView, FieldView, Layout, TypeView } from '../types.ts';
import { CaptureSheet } from './CaptureSheet.tsx';
import { closeCapture, openCapture } from './capture.ts';

vi.mock('../board-studio/home/boards-store.ts', () => ({
  useBoards: () => ({ status: 'ready', boards: [] }),
  boardsOf: () => [],
  boardOfCollection: () => undefined,
}));

// P7-F5 and its review: the words of a save that failed come back when the sheet opens again, and
// never after a save that went through.

const LAYOUT: Layout = {
  header: [],
  evidence: [],
  body: [],
  side: [],
  row: [],
  phone: [],
  intake: [],
};
const title: FieldView = { name: 'title', module: 'text', required: 'create' };
const type = {
  name: 'item',
  label: 'Item',
  initial: 'todo',
  incomplete: 'Completar',
  states: [],
  fields: [title],
  layout: LAYOUT,
} as unknown as TypeView;
const pedidos = {
  name: 'Pedidos',
  prefix: 'PED',
  preset: 'Pedidos',
  types: [type],
  view: { kind: 'list' },
  icon: null,
} as unknown as CollectionView;

const app = {
  connection: 'live',
  version: 1,
  now: 0,
  session: { canWrite: true, canConfigure: true, canManageDevices: true },
  all: [],
  collections: [pedidos],
  collectionOf: () => pedidos,
  agents: [],
  feed: [],
  route: { view: 'toca' },
  project: { id: 'p1', name: 'P' },
  sync: { offline: false, syncedAt: 1 },
  phone: true,
  canCapture: true,
} as unknown as App;

const store = new Map<string, string>();
let answers: ('fail' | 'ok')[] = [];

beforeEach(() => {
  setLanguage('en');
  store.clear();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => store.set(k, v),
    removeItem: (k: string) => store.delete(k),
  });
  vi.stubGlobal('fetch', async () => {
    const next = answers.shift();
    return next === 'ok'
      ? new Response(JSON.stringify({ id: 'PED-1' }), {
          headers: { 'content-type': 'application/json' },
        })
      : new Response(JSON.stringify({ error: 'boom' }), {
          status: 400,
          headers: { 'content-type': 'application/json' },
        });
  });
});
afterEach(() => {
  closeCapture();
  vi.unstubAllGlobals();
});

const field = () => document.querySelector<HTMLInputElement>('input.ftitle');
const save = () => document.querySelector<HTMLButtonElement>('button[type=submit]');

async function openSheet() {
  await settle();
  openCapture();
  await settle();
}

describe('the capture sheet after a failed save', () => {
  it('brings the words back when opened again, and never after a save that went through', async () => {
    const view = mount(
      <AppTestProvider value={app}>
        <CaptureSheet />
      </AppTestProvider>,
    );
    await openSheet();
    await typeInto(field(), 'Primera versión');
    answers = ['fail'];
    await press(save());
    expect(document.querySelector('.cap-err')).not.toBeNull();

    // Closed and opened again: the words are back, as written.
    closeCapture();
    await settle();
    await openSheet();
    expect(field()?.value).toBe('Primera versión');

    // Edited and saved this time: it went through.
    await typeInto(field(), 'Segunda versión');
    answers = ['ok'];
    await press(save());
    await settle();

    // Opened once more: blank, no stale draft.
    await openSheet();
    expect(field()?.value).toBe('');
    view.unmount();
  });
});
