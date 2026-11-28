// @vitest-environment happy-dom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { creatures, tareasDeRepo } from '../../../../src/core/board/testing.ts';
import { type App, AppTestProvider } from '../../app/context.tsx';
import { TriCard } from '../../components/Triage.tsx';
import { setLanguage } from '../../i18n/i18n.ts';
import { testApp } from '../../shell/test-app.ts';
import { type Mounted, mount, press, stubServer } from '../../test-dom.tsx';
import type { CollectionView, Evidence, ItemEvent, ItemView } from '../../types.ts';
import type { StudioBoard } from '../board/studio-board.tsx';
import { ItemSheet } from './ItemSheet.tsx';

// s-real2 D-13751d, D-00b356 and n6: every page that offers Aprobar on an item in review says, beside
// it, what the person should know before they approve it: that the attached diff is not what lands,
// and what the assistant or the delivering agent advised. Said from one source (reviewNotices), in
// plain words, with the technical detail one tap away; advice never blocks the move.

const seen = vi.hoisted(() => ({ board: null as StudioBoard | null }));
vi.mock('../board/studio-board.tsx', async (actual) => ({
  ...(await actual<typeof import('../board/studio-board.tsx')>()),
  useStudioBoard: () => seen.board,
}));

const def = creatures();
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
        body: [{ module: 'images', id: 'eart', label: 'Arte conceptual' }],
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

const file: Evidence = {
  id: 1,
  itemId: 'CRI-1',
  role: 'single',
  module: 'eart',
  kind: 'image',
  filename: 'a.png',
  contentType: 'image/png',
  size: 12,
  sha256: 'sha-1',
  caption: null,
  createdAt: at(10),
  actor: quill,
  channel: 'cli',
};

const review = (extra: Partial<ItemView> = {}): ItemView =>
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
    evidence: [file],
    relations: [],
    ...extra,
  }) as unknown as ItemView;

// The same delivery on a board that protects a branch: the attached diff is checked against it.
const branched = (): ItemView => {
  seen.board = { id: 'b-cri', version: 1, changed: false, live: tareasDeRepo() };
  return review({
    state: 'simpl__review',
    fields: { title: 'Tortuga', frepo: 'api', fbranch: 'change/CRI-1' },
    transitions: [
      { to: 'done', by: 'human', reasonRequired: false, turn: 'none', closes: 'done' },
      { to: 'simpl', by: 'human', reasonRequired: true, turn: 'agent' },
    ],
  } as Partial<ItemView>);
};

const MISMATCH = { mismatch: { diff: ['a.go'], landed: ['a.go', 'b.go'] } };
const advice = (kind: 'send_back' | 'doubt', assistant = true) => ({
  kind,
  note: 'The page never loads the file it adds.',
  by: assistant ? 'sol' : 'quill',
  assistant,
  at: at(13),
});

let page: Mounted | undefined;
let made: string[];

// The server as the page reaches it, answering the attached diff's check with `diffFiles`.
const serve = (diffFiles: unknown = { mismatch: null }) =>
  stubServer((path) => (path.endsWith('/diff-files') ? diffFiles : undefined));

beforeEach(() => {
  setLanguage('en');
  made = [];
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

function sheet(item: ItemView, phone: boolean) {
  page = mount(
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
  return page;
}

const approve = (root: ParentNode) =>
  [...root.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.classList.contains('primary') && /approve/i.test(b.textContent ?? ''),
  );
const notice = (root: ParentNode, key: string) =>
  root.querySelector<HTMLElement>(`[data-notice="${key}"]`);

describe('the attached diff does not match what lands', () => {
  it('is said beside Aprobar on the desk page, in plain words, the technical detail inside a fold', async () => {
    serve(MISMATCH);
    const { root } = sheet(branched(), false);
    await vi.waitFor(() => expect(notice(root, 'diff')).not.toBeNull());

    const said = notice(root, 'diff') as HTMLElement;
    // Plain: what it means for the person and what to do; the file names live in the fold.
    expect(said.textContent).toMatch(/may not be what goes in/i);
    expect(said.querySelector('details')?.textContent).toMatch(/names a\.go/);
    expect(said.querySelector('details')?.hasAttribute('open')).toBe(false);
    // Said once: the branch line no longer repeats the technical sentence.
    expect(root.textContent?.match(/names a\.go/g)).toHaveLength(1);
  });

  it('is said in the phone’s page too, outside «Detalles técnicos»', async () => {
    serve(MISMATCH);
    const { root } = sheet(branched(), true);
    await vi.waitFor(() => expect(notice(root, 'diff')).not.toBeNull());

    expect(notice(root, 'diff')?.closest('details.tech')).toBeNull();
  });

  it('is said on the Triage card that offers Aprobar, and Aprobar still goes through', async () => {
    serve(MISMATCH);
    const decisions: string[] = [];
    const into = document.createElement('div');
    document.body.append(into);
    const { createRoot } = await import('react-dom/client');
    const root = createRoot(into);
    const view = review();
    await act(async () =>
      root.render(
        <TriCard
          item={view}
          under={false}
          view={view}
          round={{
            figures: [],
            fields: [],
            files: [],
            gate: undefined,
            pending: false,
            caution: null,
          }}
          words={{ agent: 'quill', say: '', round: 1 }}
          state="Concepto"
          phone={false}
          wordOf={(state) => state}
          register={() => undefined}
          onDecide={(kind) => decisions.push(kind)}
          onOpen={() => undefined}
        />,
      ),
    );
    await vi.waitFor(() => expect(notice(into, 'diff')).not.toBeNull());

    expect(notice(into, 'diff')?.textContent).toMatch(/may not be what goes in/i);
    const button = [...into.querySelectorAll('button')].find((b) => b.textContent === 'Approve');
    expect(button?.getAttribute('aria-describedby') ?? '').toContain(
      notice(into, 'diff')?.id ?? 'none',
    );
    await act(async () => button?.click());
    expect(decisions).toEqual(['approve']);
    act(() => root.unmount());
    into.remove();
  });

  it('says it in Spanish, plainly: what it means and what to do', async () => {
    setLanguage('es');
    serve(MISMATCH);
    const { root } = sheet(branched(), true);
    await vi.waitFor(() => expect(notice(root, 'diff')).not.toBeNull());

    const text = notice(root, 'diff')?.textContent ?? '';
    expect(text).toMatch(/puede no ser lo que entra/i);
    expect(text).toMatch(/pregúntale a tu asistente/i);
    // The agent's own file is no longer the jargon the person met.
    expect(text).not.toMatch(/archivo del agente, no el de la rama/i);
  });
});

describe('what the assistant or the delivering agent advised', () => {
  it('is said beside Aprobar on the desk and the phone, and never blocks it', async () => {
    serve();
    for (const phone of [false, true]) {
      made = [];
      const { root, unmount } = sheet(review({ advice: advice('send_back') }), phone);
      await vi.waitFor(() => expect(notice(root, 'advice')).not.toBeNull());

      const said = notice(root, 'advice') as HTMLElement;
      expect(said.dataset.kind).toBe('send_back');
      expect(said.textContent).toMatch(/The assistant recommends sending it back/);
      expect(said.textContent).toContain('The page never loads the file it adds.');
      const button = approve(root);
      expect(button?.disabled).toBe(false);
      await press(button);
      expect(made).toEqual(['sanimate']);
      unmount();
      page = undefined;
    }
  });

  it('says a doubt as a doubt, and names an agent that is no assistant by its name', async () => {
    serve();
    const { root } = sheet(review({ advice: advice('doubt', false) }), false);
    await vi.waitFor(() => expect(notice(root, 'advice')).not.toBeNull());

    const said = notice(root, 'advice') as HTMLElement;
    expect(said.dataset.kind).toBe('doubt');
    expect(said.textContent).toMatch(/quill has a doubt/);
  });

  it('is said in the Triage card as well', async () => {
    serve();
    const into = document.createElement('div');
    document.body.append(into);
    const { createRoot } = await import('react-dom/client');
    const root = createRoot(into);
    const view = review({ advice: advice('send_back') });
    await act(async () =>
      root.render(
        <TriCard
          item={view}
          under={false}
          view={view}
          round={{
            figures: [],
            fields: [],
            files: [],
            gate: undefined,
            pending: false,
            caution: null,
          }}
          words={{ agent: 'quill', say: '', round: 1 }}
          state="Concepto"
          phone
          wordOf={(state) => state}
          register={() => undefined}
          onDecide={() => undefined}
          onOpen={() => undefined}
        />,
      ),
    );
    expect(notice(into, 'advice')?.dataset.kind).toBe('send_back');
    act(() => root.unmount());
    into.remove();
  });

  it('is said inside the reader too, beside the Aprobar it holds', async () => {
    setLanguage('es');
    serve();
    const { root } = sheet(review({ advice: advice('send_back') }), false);
    const opener = [...root.querySelectorAll('button')].find((b) =>
      /leer uno a uno/i.test(b.textContent ?? ''),
    );
    await press(opener);

    const dialog = document.querySelector('.rd-dialog');
    expect(dialog?.querySelector('[data-rvn]')?.textContent).toMatch(/recomienda devolverlo/);
  });
});
