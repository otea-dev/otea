import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { step, tareasDeRepo } from '../../../../src/core/board/testing.ts';
import { type App, AppTestProvider } from '../../app/context.tsx';
import { ago, NOW } from '../../derive/fixtures.ts';
import { setLanguage } from '../../i18n/i18n.ts';
import type { CollectionView, ItemEvent, ItemView } from '../../types.ts';
import type { StudioBoard } from '../board/studio-board.tsx';
import { ItemSheet } from './ItemSheet.tsx';

// P5-F11: a Done item opened on the phone showed its route and a collapsed Detalles, with no
// evidence and no rounds, when it closed from a last step that never handed anything off: the
// rounds were read for that last step, not for the one that was reviewed.
const seen = vi.hoisted(() => ({ board: null as StudioBoard | null }));
vi.mock('../board/studio-board.tsx', async (actual) => ({
  ...(await actual<typeof import('../board/studio-board.tsx')>()),
  useStudioBoard: () => seen.board,
}));

const tareas = { name: 'Tareas', prefix: 'TAR', types: [] } as unknown as CollectionView;
const you = { kind: 'human', name: 'fede' } as const;
const kiln = { kind: 'agent', name: 'kiln' } as const;
const ev = (id: number, type: string, actor: ItemEvent['actor'], data: object, m: number) =>
  ({ id, type, actor, at: ago(m), data }) as ItemEvent;

const shot = {
  id: 1,
  itemId: 'TAR-9',
  role: 'single' as const,
  module: null,
  kind: 'image' as const,
  filename: 'parpadeo-despues.png',
  contentType: 'image/png',
  size: 10,
  sha256: '',
  caption: null,
  createdAt: ago(31),
  actor: kiln,
};

// Implementar was handed off, with no note, and approved; Integrar (an agent's step, nobody reviews) closed it.
const done = {
  id: 'TAR-9',
  collection: 'Tareas',
  type: 'Tarea de repo',
  title: 'Quitar el parpadeo',
  fields: {},
  presetVersion: 1,
  state: 'done',
  turn: 'none',
  createdAt: ago(90),
  updatedAt: ago(5),
  createdBy: you,
  lease: null,
  events: [
    ev(1, 'created', you, { state: 'sprop' }, 90),
    ev(2, 'transitioned', you, { from: 'sprop', to: 'simpl' }, 80),
    ev(3, 'claimed', kiln, { holder: 'kiln' }, 70),
    ev(4, 'evidence_added', kiln, { id: 1 }, 31),
    ev(5, 'transitioned', kiln, { from: 'simpl', to: 'simpl__review' }, 30),
    ev(6, 'transitioned', you, { from: 'simpl__review', to: 'sint' }, 20),
    ev(7, 'transitioned', kiln, { from: 'sint', to: 'done' }, 10),
  ],
  transitions: [],
  relayable: [],
  missing: [],
  evidence: [shot],
  relations: [],
} as unknown as ItemView;

const app = {
  connection: 'live',
  version: 1,
  now: NOW,
  session: { canWrite: true, canConfigure: true, canManageDevices: true },
  all: [],
  collections: [tareas],
  collectionOf: (n: string) => (n === 'Tareas' ? tareas : undefined),
  agents: [],
  feed: [],
  route: { view: 'toca', item: 'TAR-9' },
  phone: true,
} as unknown as App;

beforeEach(() => {
  const live = tareasDeRepo();
  live.steps = [...live.steps, step('sint', 'Integrar', { reviewer: 'none' })];
  seen.board = { id: 'b-tareas', version: 1, changed: false, live };
});
afterEach(() => setLanguage('en'));

describe('a closed item on the phone', () => {
  it('shows what the last reviewed round delivered, with its evidence', () => {
    const html = renderToStaticMarkup(
      <AppTestProvider value={app}>
        <ItemSheet
          item={done}
          full={false}
          nav={{ prev: false, next: false }}
          onNav={() => undefined}
          onFull={() => undefined}
          onClose={() => undefined}
        />
      </AppTestProvider>,
    );
    expect(html).toContain('What it delivered');
    expect(html).toContain('parpadeo-despues.png');
  });
});
