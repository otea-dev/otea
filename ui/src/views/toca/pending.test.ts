import { createElement, type FunctionComponent } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Pending, PendingEntry } from '../../../../src/core/pending.ts';
import { type App, AppTestProvider } from '../../app/context.tsx';
import type { SecretaryView } from '../../conversation.ts';
import { item, NOW } from '../../derive/fixtures.ts';
import type { CollectionView } from '../../types.ts';
import { TocaView } from './TocaView.tsx';

const Provider = AppTestProvider as unknown as FunctionComponent<{ value: App }>;
const errores = { name: 'Errores', preset: 'bug-triage', prefix: 'ERR', types: [] };

const at = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();

const note: PendingEntry = {
  kind: 'bandeja',
  ref: 'B-1',
  title: 'the Aprobar button is hidden',
  since: at(40),
  by: 'lia',
  text: 'Which screen?',
  options: ['Te toca', 'Hablar'],
};
const asked: PendingEntry = {
  kind: 'secretary',
  ref: '14',
  title: 'What do I do with it?',
  since: at(15),
  by: 'sol',
  text: 'What do I do with it?',
  options: ['Write it down', 'Leave it'],
  turn: 9,
};

const waiting = (entries: PendingEntry[], over: Partial<Pending> = {}): Pending => ({
  count: entries.length,
  entries,
  blocks: [],
  queues: [],
  secretary: null,
  ...over,
});

const fake = (o: Partial<App>): App =>
  ({
    now: NOW,
    feed: [],
    agents: [{ name: 'kiln', harness: null, holding: [], lastSeen: 'x', live: true }],
    route: { view: 'toca' },
    project: { id: 'h', name: 'Hollowmere' },
    session: { canWrite: true, canConfigure: true, canManageDevices: true },
    items: { status: 'ready', value: o.all ?? [] },
    collections: [errores as unknown as CollectionView],
    collectionOf: () => undefined,
    presets: [],
    go: () => undefined,
    openItem: () => undefined,
    closeItem: () => undefined,
    openConnect: () => undefined,
    ...o,
  }) as unknown as App;

const render = (app: App) =>
  renderToStaticMarkup(createElement(Provider, { value: app }, createElement(TocaView)));

// F4 (field study 3): four personas waited 15 to 40 minutes on a question of the Bandeja while
// Te toca said «Nothing is waiting for you» (the desk) and «no questions for you» (the phone).
describe('Te toca counts what is no item', () => {
  // A project with work, none of it on the person's turn.
  const working = item({ id: 'ERR-2', turn: 'agent', state: 'fixing' });

  for (const phone of [false, true]) {
    const where = phone ? 'phone' : 'desk';

    it(`lists a Bandeja question under the questions for you, never saying nothing waits (${where})`, () => {
      const html = render(fake({ all: [working], phone, pending: waiting([note]) }));

      expect(html).toContain('B-1');
      expect(html).toContain('the Aprobar button is hidden');
      expect(html).toContain('<b>lia</b> asks');
      expect(html).not.toContain('Nothing is waiting for you.');
      expect(html).not.toContain('no questions for you');
      expect(html).not.toContain('No questions.');
      // The row is a note's: it opens Hablar at the note, not an item.
      expect(html).toContain('data-k="B-1"');
    });

    it(`lists a question of the secretary the same way (${where})`, () => {
      const html = render(fake({ all: [working], phone, pending: waiting([asked]) }));

      expect(html).toContain('What do I do with it?');
      expect(html).toContain('<b>sol</b> asks');
      expect(html).not.toContain('Nothing is waiting for you.');
    });
  }

  // F4 review round: what an agent escalated while the secretary is away is the person's to read.
  it('shows what an agent reports while the secretary is away, as a notice rather than a question', () => {
    const report: PendingEntry = {
      kind: 'escalation',
      ref: 'ERR-2',
      title: 'Sort by recent',
      since: at(12),
      by: 'kiln',
      text: 'I pushed change/CHA-5-v2 by mistake',
    };
    const html = render(fake({ all: [working], pending: waiting([report]) }));

    expect(html).toContain('I pushed change/CHA-5-v2 by mistake');
    expect(html).toContain('<b>kiln</b> reports');
    expect(html).not.toContain('<b>kiln</b> asks');
    expect(html).not.toContain('Nothing is waiting for you.');
  });

  it('says how many wait, items and notes together, in the dek', () => {
    const review = item({ id: 'ERR-1' });
    const html = render(fake({ all: [review, working], pending: waiting([note, asked]) }));

    expect(html).toContain('Three things are waiting for you');
  });

  it('says nothing about them while Otea has not told yet', () => {
    const html = render(fake({ all: [working] }));

    expect(html).toContain('Nothing is waiting for you.');
  });
});

describe('Te toca with the secretary offline', () => {
  const working = item({ id: 'ERR-2', turn: 'agent', state: 'fixing' });
  const offline = (messages: number, notes = 0): SecretaryView => ({
    name: 'sol',
    state: 'offline',
    since: at(50),
    pending: 0,
    waiting: { count: messages + notes, since: at(45), messages, notes, reports: 0 },
  });

  for (const phone of [false, true]) {
    it(`says so with how many things wait for it, and links to Hablar (${phone ? 'phone' : 'desk'})`, () => {
      const html = render(fake({ all: [working], phone, secretary: offline(3) }));

      expect(html).toContain('sol is offline');
      expect(html).toContain('3 messages waiting for it');
      expect(html).toContain('href="#/hablar"');
    });
  }

  // s-real2, D-fbe122: «2 messages are waiting for it» was a note and a report, not messages.
  it('names what waits for it by what each is, never as messages', () => {
    const html = render(fake({ all: [working], secretary: offline(1, 2) }));
    expect(html).toContain('1 message and 2 notes waiting for it');
  });

  it('is silent when it is offline with nothing waiting for it', () => {
    expect(render(fake({ all: [working], secretary: offline(0) }))).not.toContain('is offline');
  });

  it('is silent while the secretary is connected', () => {
    const connected: SecretaryView = {
      name: 'sol',
      state: 'connected',
      since: null,
      pending: 0,
      waiting: { count: 2, since: null, messages: 2, notes: 0, reports: 0 },
    };
    expect(render(fake({ all: [working], secretary: connected }))).not.toContain('is offline');
  });
});
