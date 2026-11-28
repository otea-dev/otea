// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Pending } from '../../../../src/core/pending.ts';
import { AppTestProvider } from '../../app/context.tsx';
import type { AssistantView } from '../../conversation.ts';
import { ago, item, NOW } from '../../derive/fixtures.ts';
import { setLanguage } from '../../i18n/i18n.ts';
import { testApp } from '../../shell/test-app.ts';
import { type Mounted, mount, settle } from '../../test-dom.tsx';
import { TocaView } from './TocaView.tsx';

// Field study 5 (D2): on a phone, Te toca had the install card lying over its rows, and, with the PC
// out of reach, a card about the assistant being away: the last it knew, said as if it were now.

let page: Mounted | undefined;

beforeEach(() => {
  setLanguage('es');
  vi.stubGlobal('navigator', {
    ...navigator,
    userAgent: 'Mozilla/5.0 (Linux; Android 14) Chrome/120',
    maxTouchPoints: 5,
  });
  vi.stubGlobal(
    'fetch',
    async () =>
      new Response('{}', { status: 404, headers: { 'content-type': 'application/json' } }),
  );
});
afterEach(() => {
  page?.unmount();
  page = undefined;
  vi.unstubAllGlobals();
  localStorage.clear();
  setLanguage('en');
});

const waiting: Pending = {
  count: 0,
  entries: [],
  blocks: [],
  queues: [],
  assistant: null,
};

const away: AssistantView = {
  name: 'sol',
  state: 'offline',
  since: ago(60),
  pending: 0,
  waiting: { count: 1, since: ago(30), messages: 1, notes: 0, reports: 0 },
};

async function open(o: Parameters<typeof testApp>[0] = {}) {
  page = mount(
    <AppTestProvider
      value={testApp({
        now: NOW,
        phone: true,
        all: [item({ id: 'CAM-2', title: 'Modo oscuro', turn: 'human' })],
        pending: waiting,
        assistant: away,
        ...o,
      })}
    >
      <TocaView />
    </AppTestProvider>,
  );
  await settle();
  return page.root;
}

describe('Te toca on a phone', () => {
  it('holds the install note in its header, never over the rows', async () => {
    const root = await open();
    const note = root.querySelector('.install-banner');
    expect(note).not.toBeNull();
    expect(note?.closest('header')).not.toBeNull();
    expect(note?.textContent).toContain('Instalar Otea');
  });

  it('has no install note on the desk', async () => {
    const root = await open({ phone: false });
    expect(root.querySelector('.install-banner')).toBeNull();
  });

  it('says the assistant is away while the PC answers', async () => {
    const root = await open();
    expect(root.querySelector('.assistant-off')?.textContent).toContain('sol está desconectado');
  });

  it('says nothing of the assistant without the PC: what it kept may be old, the offline line speaks', async () => {
    const root = await open({ sync: { offline: true, syncedAt: NOW } });
    expect(root.querySelector('.assistant-off')).toBeNull();
    // The desk has the room, and keeps its card.
    page?.unmount();
    const desk = await open({ phone: false, sync: { offline: true, syncedAt: NOW } });
    expect(desk.querySelector('.assistant-off')).not.toBeNull();
  });
});
