import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { creatures } from '../../../../src/core/board/testing.ts';
import { type App, AppTestProvider } from '../../app/context.tsx';
import { ago, NOW } from '../../derive/fixtures.ts';
import { setLanguage } from '../../i18n/i18n.ts';
import type { CollectionView, ItemEvent, ItemView, TypeView } from '../../types.ts';
import type { StudioBoard } from '../board/studio-board.tsx';
import { ItemSheet } from './ItemSheet.tsx';

// R2 (field study 4, wave 2b): a draft under review sat below the outline approved before it, and
// on the phone inside «Detalles técnicos», closed. What the step under review handed in is read
// first, on the desk and on the phone; what was settled in an earlier step follows.
const seen = vi.hoisted(() => ({ board: null as StudioBoard | null }));
vi.mock('../board/studio-board.tsx', async (actual) => ({
  ...(await actual<typeof import('../board/studio-board.tsx')>()),
  useStudioBoard: () => seen.board,
}));

// A board's type as the server compiles it: its fields go by their part's id, in the main column.
const EMPTY = { header: [], evidence: [], body: [], side: [], row: [], phone: [], intake: [] };
const type = {
  name: 'Criatura',
  label: 'Criatura',
  initial: 'sconcept',
  states: [],
  fields: [
    { name: 'title', module: 'text', required: 'create' },
    { name: 'fdesc', label: 'Descripción', module: 'markdown' },
    { name: 'fguion', label: 'Guion', module: 'markdown' },
  ],
  layout: {
    ...EMPTY,
    body: [
      { module: 'markdown', field: 'fdesc' },
      { module: 'markdown', field: 'fguion' },
    ],
  },
} as unknown as TypeView;
const criaturas = { name: 'Criaturas', prefix: 'CRE', types: [type] } as unknown as CollectionView;
const you = { kind: 'human', name: 'fede' } as const;
const kiln = { kind: 'agent', name: 'kiln' } as const;
const ev = (id: number, type: string, actor: ItemEvent['actor'], data: object, m: number) =>
  ({ id, type, actor, at: ago(m), data }) as ItemEvent;

// Concepto approved with its Descripción; Animar handed in its Guion and waits for your review.
const item = {
  id: 'CRE-4',
  collection: 'Criaturas',
  type: 'Criatura',
  title: 'Tortuga musgosa',
  fields: {
    fdesc: 'Una tortuga con musgo en el caparazón, aprobada ayer.',
    fguion: 'El guion nuevo: la tortuga cruza el pantano en tres tiempos.',
  },
  presetVersion: 1,
  state: 'sanimate__review',
  turn: 'human',
  createdAt: ago(90),
  updatedAt: ago(5),
  createdBy: you,
  lease: null,
  events: [
    ev(1, 'created', you, { state: 'sconcept' }, 90),
    ev(2, 'claimed', kiln, { holder: 'kiln' }, 80),
    ev(3, 'transitioned', kiln, { from: 'sconcept', to: 'sconcept__review' }, 70),
    ev(4, 'transitioned', you, { from: 'sconcept__review', to: 'sanimate' }, 60),
    ev(5, 'claimed', kiln, { holder: 'kiln' }, 20),
    ev(6, 'transitioned', kiln, { from: 'sanimate', to: 'sanimate__review' }, 5),
  ],
  transitions: [],
  relayable: [],
  missing: [],
  evidence: [],
  relations: [],
} as unknown as ItemView;

const app = (phone: boolean) =>
  ({
    connection: 'live',
    version: 1,
    now: NOW,
    session: { canWrite: true, canConfigure: true, canManageDevices: true },
    all: [],
    collections: [criaturas],
    collectionOf: (n: string) => (n === 'Criaturas' ? criaturas : undefined),
    agents: [],
    feed: [],
    route: { view: 'toca', item: 'CRE-4' },
    phone,
  }) as unknown as App;

const render = (phone: boolean) =>
  renderToStaticMarkup(
    <AppTestProvider value={app(phone)}>
      <ItemSheet
        item={item}
        full={false}
        nav={{ prev: false, next: false }}
        onNav={() => undefined}
        onFull={() => undefined}
        onClose={() => undefined}
      />
    </AppTestProvider>,
  );

beforeEach(() => {
  const live = creatures();
  live.parts.fguion = { id: 'fguion', name: 'Guion', kind: 'long', hint: '', options: [] };
  const [concept, animate] = live.steps;
  if (!concept || !animate) throw new Error('fixture');
  concept.hand = [...concept.hand, { ref: 'fdesc', req: 'always', fresh: false }];
  animate.reviewer = 'you';
  animate.hand = [{ ref: 'fguion', req: 'always', fresh: true }];
  seen.board = { id: 'b-criaturas', version: 1, changed: false, live };
});
afterEach(() => setLanguage('en'));

describe('what the step under review handed in comes first', () => {
  it('on the phone, reads the Guion in the open, before the earlier Descripción', () => {
    const html = render(true);
    const guion = html.indexOf('El guion nuevo');
    expect(guion).toBeGreaterThan(-1);
    // Not folded away behind Detalles técnicos.
    const fold = html.indexOf('Technical details');
    expect(fold === -1 || guion < fold).toBe(true);
    const earlier = html.indexOf('Una tortuga con musgo');
    expect(earlier === -1 || guion < earlier).toBe(true);
  });

  it('on the desk, puts the Guion before the Descripción approved earlier', () => {
    const html = render(false);
    const guion = html.indexOf('El guion nuevo');
    const earlier = html.indexOf('Una tortuga con musgo');
    expect(guion).toBeGreaterThan(-1);
    expect(earlier).toBeGreaterThan(-1);
    expect(guion).toBeLessThan(earlier);
  });
});
