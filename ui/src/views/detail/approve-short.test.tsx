// @vitest-environment happy-dom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { creatures } from '../../../../src/core/board/testing.ts';
import { type App, AppTestProvider } from '../../app/context.tsx';
import { setLanguage } from '../../i18n/i18n.ts';
import { testApp } from '../../shell/test-app.ts';
import { buttonNamed, type Mounted, mount, press, settle, stubServer } from '../../test-dom.tsx';
import type { CollectionView, Evidence, ItemEvent, ItemView } from '../../types.ts';
import type { StudioBoard } from '../board/studio-board.tsx';
import { holdFor } from './caution.ts';
import { ItemSheet } from './ItemSheet.tsx';

// P5-F5: Aprobar approved at once with an "at least N of" group short. It asks once, on the desk,
// on the phone and from inside the reader; a second press for the same line approves, and anything
// that changes what is short (a file attached meanwhile) asks again. Pressed through the real
// ItemSheet and its buttons; what is asserted is the state (a move made or not, an alert shown),
// never the words.

const seen = vi.hoisted(() => ({ board: null as StudioBoard | null }));
vi.mock('../board/studio-board.tsx', async (actual) => ({
  ...(await actual<typeof import('../board/studio-board.tsx')>()),
  useStudioBoard: () => seen.board,
}));

// Concepto asks for at least 2 of a concept art or a swamp reference; the person reviews it.
const def = creatures();
const concept = def.steps[0];
if (!concept) throw new Error('no step');
concept.hand = [
  { ref: 'eart', req: 'no', fresh: false },
  { ref: 'eswamp', req: 'no', fresh: false },
];
concept.groups = [{ id: 'gshots', name: 'Pruebas', parts: ['eart', 'eswamp'], min: 2 }];

const criaturas = {
  name: 'Criaturas',
  prefix: 'CRI',
  types: [
    {
      name: 'item',
      label: 'Criatura',
      initial: 'sconcept',
      states: [],
      fields: [{ name: 'title', module: 'text', required: 'create' }],
      layout: {
        header: [],
        evidence: [],
        body: [
          { module: 'images', id: 'eart', label: 'Arte conceptual' },
          { module: 'images', id: 'eswamp', label: 'Barro' },
        ],
        side: [],
        row: [],
        phone: [],
        intake: [],
      },
    },
  ],
} as unknown as CollectionView;

const you = { kind: 'human', name: 'fede' } as const;
const quill = { kind: 'agent', name: 'quill' } as const;
const at = (minutes: number) => new Date(Date.UTC(2026, 10, 17, 9, minutes)).toISOString();
const ev = (id: number, type: string, actor: ItemEvent['actor'], data: object, m: number) =>
  ({ id, type, actor, at: at(m), data }) as ItemEvent;

const file = (id: number, module: string, filename: string): Evidence => ({
  id,
  itemId: 'CRI-1',
  role: 'single',
  module,
  kind: 'image',
  filename,
  contentType: 'image/png',
  size: 12,
  sha256: `sha-${id}`,
  caption: null,
  createdAt: at(10),
  actor: quill,
  channel: 'cli',
});

// The delivery of Concepto, waiting for your verdict, with the files given.
const review = (evidence: Evidence[]): ItemView =>
  ({
    id: 'CRI-1',
    collection: 'Criaturas',
    type: 'item',
    title: 'Tortuga',
    fields: { title: 'Tortuga' },
    presetVersion: 1,
    state: 'sconcept__review',
    turn: 'human',
    createdAt: at(0),
    updatedAt: at(12),
    createdBy: you,
    lease: null,
    events: [
      ev(1, 'created', you, { state: 'sconcept' }, 0),
      ev(2, 'claimed', quill, { holder: 'quill' }, 5),
      ev(3, 'transitioned', quill, { from: 'sconcept', to: 'sconcept__review', note: 'Listo' }, 12),
    ],
    transitions: [
      { to: 'sanimate', by: 'human', reasonRequired: false, turn: 'agent' },
      { to: 'sconcept', by: 'human', reasonRequired: true, turn: 'agent' },
    ],
    relayable: [],
    missing: [],
    evidence,
    relations: [],
  }) as unknown as ItemView;

let page: Mounted | undefined;
let made: string[];

beforeEach(() => {
  setLanguage('es');
  made = [];
  stubServer();
  seen.board = { id: 'b-cri', version: 1, changed: false, live: def };
});
afterEach(() => {
  page?.unmount();
  vi.unstubAllGlobals();
  setLanguage('en');
});

const app = (phone: boolean): App =>
  testApp({
    collections: [criaturas],
    phone,
    route: { view: 'toca', item: 'CRI-1' },
    move: async (_id, to) => {
      made.push(to);
    },
  });

function draw(shown: ItemView, phone: boolean) {
  return (
    <AppTestProvider value={app(phone)}>
      <ItemSheet
        item={shown}
        full={false}
        nav={{ prev: false, next: false }}
        onNav={() => undefined}
        onFull={() => undefined}
        onClose={() => undefined}
      />
    </AppTestProvider>
  );
}

function open(item: ItemView, phone = false) {
  page = mount(draw(item, phone));
  return page.root;
}

const primary = (root: ParentNode) =>
  [...root.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.classList.contains('primary') && /aprobar/i.test(b.textContent ?? ''),
  );
const alertIn = (root: ParentNode) => root.querySelector('[role="alert"]');

describe('holding a move for a second press', () => {
  it('holds a line once, lets the same line through, and asks again when the line changes', () => {
    const key = 'CRI-1:sconcept__review:t1:1';
    expect(holdFor(null, key, 'sanimate', null)).toBeNull();
    expect(holdFor(null, key, 'sanimate', 'short')).toBe('short');
    const asked = { key, to: 'sanimate', line: 'short' };
    expect(holdFor(asked, key, 'sanimate', 'short')).toBeNull();
    // Another item as it stands, another move, or another line: asked afresh.
    expect(holdFor(asked, `${key}2`, 'sanimate', 'short')).toBe('short');
    expect(holdFor(asked, key, 'sconcept', 'short')).toBe('short');
    expect(holdFor(asked, key, 'sanimate', 'shorter')).toBe('shorter');
  });
});

describe('approving on the desk with a group short', () => {
  it('asks once with an alert, and the second press approves', async () => {
    const root = open(review([file(1, 'eart', 'a.png')]));
    await press(primary(root));
    expect(made).toEqual([]);
    expect(alertIn(root)).not.toBeNull();

    await press(primary(root));
    expect(made).toEqual(['sanimate']);
  });

  it('approves at the first press when the group is met', async () => {
    const root = open(review([file(1, 'eart', 'a.png'), file(2, 'eswamp', 'b.png')]));
    await press(primary(root));
    expect(made).toEqual(['sanimate']);
  });

  it('asks again when a file is attached after it asked, and approves once nothing is short', async () => {
    const root = open(review([file(1, 'eart', 'a.png')]));
    await press(primary(root));
    expect(alertIn(root)).not.toBeNull();

    // A file attached meanwhile does not update the item; what was asked no longer holds (the same
    // part, one more file: still short, another count), so the press asks again.
    page?.unmount();
    page = mount(draw(review([file(1, 'eart', 'a.png'), file(2, 'eart', 'a2.png')]), false));
    await press(primary(page.root));
    expect(made).toEqual([]);
    expect(alertIn(page.root)).not.toBeNull();

    // With the second part held the group is met: nothing to ask.
    page.unmount();
    page = mount(draw(review([file(1, 'eart', 'a.png'), file(3, 'eswamp', 'b.png')]), false));
    await press(primary(page.root));
    expect(made).toEqual(['sanimate']);
  });

  it('asks again after another move was pressed in between', async () => {
    const root = open(review([file(1, 'eart', 'a.png')]));
    await press(primary(root));
    await press(buttonNamed(root, 'Devolver…'));
    await press(primary(root));
    expect(made).toEqual([]);
    expect(alertIn(root)).not.toBeNull();
  });
});

describe('approving from the reader with a group short', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] });
  });
  afterEach(() => vi.useRealTimers());

  it('says it inside the reader, which stays open, and the second press approves', async () => {
    const root = open(review([file(1, 'eart', 'a.png')]));
    const opener = [...root.querySelectorAll('button')].find((b) =>
      /leer uno a uno/i.test(b.textContent ?? ''),
    );
    await press(opener);
    const dialog = () => document.querySelector('.rd-dialog');
    expect(dialog()).not.toBeNull();
    const inReader = () => primary(dialog() ?? document.body);

    await press(inReader());
    // The reader is still there and says it, where the person is.
    expect(made).toEqual([]);
    expect(dialog()).not.toBeNull();
    expect(alertIn(dialog() as Element)).not.toBeNull();

    await press(inReader());
    // The second press closes the reader and the page's own button goes through without asking:
    // frames and the clock advance only when the test says so.
    for (let frame = 0; frame < 12; frame++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(20);
      });
      await settle();
    }
    expect(dialog()).toBeNull();
    expect(made).toEqual(['sanimate']);
  });
});

describe('approving on the phone with a group short', () => {
  it('asks once, and the second press approves', async () => {
    const root = open(review([file(1, 'eart', 'a.png')]), true);
    // The phone's own page, its dock holding the moves.
    expect(root.querySelector('.p-dock')).not.toBeNull();
    await press(primary(root));
    expect(made).toEqual([]);
    expect(alertIn(root)).not.toBeNull();

    await press(primary(root));
    expect(made).toEqual(['sanimate']);
  });
});
