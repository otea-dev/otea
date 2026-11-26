import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { compileBoard } from '../../../../src/core/board/compile.ts';
import { instantiate, requireTemplate } from '../../../../src/core/board/templates.ts';
import { typeViews } from '../../../../src/core/views.ts';
import { type App, AppTestProvider } from '../../app/context.tsx';
import { ago, NOW } from '../../derive/fixtures.ts';
import { setLanguage } from '../../i18n/i18n.ts';
import type { CollectionView, ItemEvent, ItemView } from '../../types.ts';
import type { StudioBoard } from '../board/studio-board.tsx';
import { ItemSheet } from './ItemSheet.tsx';

// Field study 3 (S3 P1): on the phone the Decidir step of a decision showed its title, what to
// decide and where it came from, and nothing of the findings, the options or the sources the agent
// had researched: they sat in a closed «Lo pedido». The desk draws them all.
const seen = vi.hoisted(() => ({ board: null as StudioBoard | null }));
vi.mock('../board/studio-board.tsx', async (actual) => ({
  ...(await actual<typeof import('../board/studio-board.tsx')>()),
  useStudioBoard: () => seen.board,
}));

const live = instantiate(requireTemplate('decisions'), 'es', {}, undefined, { keep: true });
const type = typeViews(compileBoard('b-dec', 1, live).types)[0];
if (!type) throw new Error('fixture');
const decisiones = {
  name: 'decisiones',
  prefix: 'DEC',
  preset: 'b-dec',
  types: [type],
} as unknown as CollectionView;
const you = { kind: 'human', name: 'fede' } as const;
const scout = { kind: 'agent', name: 'scout' } as const;
const ev = (id: number, kind: string, actor: ItemEvent['actor'], data: object, m: number) =>
  ({ id, type: kind, actor, at: ago(m), data }) as ItemEvent;

const deciding = {
  id: 'DEC-1',
  collection: 'decisiones',
  type: type.name,
  title: 'Reintentos de entregas: ¿cola en disco con bbolt?',
  fields: {
    fq: 'Cómo reintentar las entregas fallidas de avisod',
    ffind: 'Hallazgo: bbolt escribe en una sola transacción por lote.',
    fsrc: 'https://pkg.go.dev/go.etcd.io/bbolt',
    fopts:
      '## A. Cola en disco con bbolt\nGana: sobrevive a reinicios.\n\n## B. Cola en memoria\nCuesta: pierde lo pendiente.',
  },
  presetVersion: 1,
  state: 'sdecide',
  turn: 'human',
  createdAt: ago(90),
  updatedAt: ago(20),
  createdBy: you,
  lease: null,
  events: [
    ev(1, 'created', you, { state: 'sdig' }, 90),
    ev(2, 'claimed', scout, { holder: 'scout' }, 80),
    ev(3, 'transitioned', scout, { from: 'sdig', to: 'sdecide' }, 20),
  ],
  transitions: [],
  relayable: [],
  missing: [],
  evidence: [],
  relations: [],
} as unknown as ItemView;

const app = {
  connection: 'live',
  version: 1,
  now: NOW,
  session: { canWrite: true, canConfigure: true, canManageDevices: true },
  all: [],
  collections: [decisiones],
  collectionOf: (n: string) => (n === 'decisiones' ? decisiones : undefined),
  agents: [],
  feed: [],
  route: { view: 'toca', item: 'DEC-1' },
  phone: true,
} as unknown as App;

beforeEach(() => {
  seen.board = { id: 'b-dec', version: 1, changed: false, live };
});
afterEach(() => setLanguage('en'));

describe('the Decidir step on the phone', () => {
  it('shows what the agent researched, outside the closed «Lo pedido»', () => {
    setLanguage('es');
    const html = renderToStaticMarkup(
      <AppTestProvider value={app}>
        <ItemSheet
          item={deciding}
          full={false}
          nav={{ prev: false, next: false }}
          onNav={() => undefined}
          onFull={() => undefined}
          onClose={() => undefined}
        />
      </AppTestProvider>,
    );
    // The fold of the request is closed here, so whatever is inside it is not in the markup.
    expect(html).toContain('Hallazgo: bbolt escribe');
    expect(html).toContain('Cola en memoria');
    expect(html).toContain('pkg.go.dev/go.etcd.io/bbolt');
    // Before the folds (Detalles, Lo pedido): the person reads it before deciding.
    expect(html.indexOf('Hallazgo: bbolt')).toBeLessThan(html.indexOf('>Detalles<'));
  });
});
