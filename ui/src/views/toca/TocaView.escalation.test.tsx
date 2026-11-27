// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Pending, PendingEntry } from '../../../../src/core/pending.ts';
import { type App, AppTestProvider } from '../../app/context.tsx';
import { ago, item, NOW } from '../../derive/fixtures.ts';
import { setLanguage } from '../../i18n/i18n.ts';
import { testApp } from '../../shell/test-app.ts';
import { type Mounted, mount, press, settle } from '../../test-dom.tsx';
import { TocaView } from './TocaView.tsx';

// G3: an agent's report names the item it is about, and that item may be on your turn too. The two
// rows are different things: a tap on the item opens the item, a tap on the report opens Hablar.

let page: Mounted | undefined;
afterEach(() => {
  page?.unmount();
  page = undefined;
  vi.unstubAllGlobals();
  setLanguage('en');
});

const report: PendingEntry = {
  kind: 'escalation',
  ref: 'ERR-2',
  title: 'Sort by recent',
  since: ago(12),
  by: 'kiln',
  text: 'I pushed change/CHA-5-v2 by mistake',
};

const pending: Pending = {
  count: 1,
  entries: [report],
  blocks: [],
  secretary: null,
};

describe('Te toca, a report about an item that is also yours to review', () => {
  it('opens the item from the item’s row and Hablar from the report’s', async () => {
    const opened: string[] = [];
    const went: unknown[] = [];
    const app: App = testApp({
      now: NOW,
      all: [item({ id: 'ERR-2', title: 'Tidy the sidebar', turn: 'human' })],
      pending,
      openItem: (id: string) => void opened.push(id),
      go: (route) => void went.push(route),
    });
    vi.stubGlobal(
      'fetch',
      async () =>
        new Response('{}', { status: 404, headers: { 'content-type': 'application/json' } }),
    );
    page = mount(
      <AppTestProvider value={app}>
        <TocaView />
      </AppTestProvider>,
    );
    await settle();
    const rows = [...page.root.querySelectorAll<HTMLElement>('[data-k]')];
    const own = rows.find((row) => row.textContent?.includes('Tidy the sidebar'));
    const news = rows.find((row) => row.textContent?.includes('I pushed change/CHA-5-v2'));
    expect(own).toBeDefined();
    expect(news).toBeDefined();
    expect(own?.dataset.k).not.toBe(news?.dataset.k);

    await press(own);
    expect(opened).toEqual(['ERR-2']);
    expect(went).toEqual([]);

    await press(news);
    expect(went).toEqual([{ view: 'hablar' }]);
  });
});
