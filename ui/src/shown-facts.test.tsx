// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Pending, PendingEntry } from '../../src/core/pending.ts';
import { AppTestProvider, useApp } from './app/context.tsx';
import { attentionTitle } from './attention.ts';
import type { SecretaryView } from './conversation.ts';
import { ago, item, NOW } from './derive/fixtures.ts';
import { useAttention } from './hooks.ts';
import { setLanguage } from './i18n/i18n.ts';
import { waitingCount } from './pending.ts';
import { TabBar } from './phone/TabBar.tsx';
import { Rail } from './shell/Rail.tsx';
import { testApp } from './shell/test-app.ts';
import { type Mounted, mount, settle } from './test-dom.tsx';
import type { CollectionView } from './types.ts';
import { TeEspera } from './views/hablar/TeEspera.tsx';
import { TocaView } from './views/toca/TocaView.tsx';

// The owner's rule: what Otea shows must be true, and one inconsistency (a number here and another
// there for the same thing) costs the trust of the whole product. Every surface of the desk and the
// phone that says how many things wait for the person, or where the secretary stands, is drawn here
// from one state, and says what the one selector says (docs/internal/shown-facts.md).

const board = { name: 'Errores', icon: null, types: [] } as unknown as CollectionView;

const entry = (o: Partial<PendingEntry> & Pick<PendingEntry, 'kind' | 'ref'>): PendingEntry => ({
  title: o.ref,
  since: ago(30),
  ...o,
});

// What waits: two reviews, an item that asks, one gone quiet, a question on a note, one of the
// secretary's, an agent's report and a board nobody works; plus a question of the secretary about a
// review that already waits (the same thing, counted once) and a lapse of an agent still there
// (waits for no one).
const items = [
  item({ id: 'E-1', turn: 'human' }),
  item({ id: 'E-2', turn: 'human' }),
  item({
    id: 'E-3',
    turn: 'human',
    asks: {
      question: 1,
      by: 'kiln',
      at: ago(20),
      text: '¿Liso o musgoso?',
      options: ['Liso', 'Musgoso'],
    },
  }),
  item({
    id: 'E-4',
    turn: 'agent',
    state: 'fixing',
    expiredLease: { holder: 'ghost', expiresAt: ago(40) },
  }),
  item({
    id: 'E-5',
    turn: 'agent',
    state: 'fixing',
    expiredLease: { holder: 'mender', expiresAt: ago(5), connected: true },
  }),
  item({ id: 'E-6', turn: 'none', state: 'fixed' }),
];

const entries: PendingEntry[] = [
  entry({ kind: 'bandeja', ref: 'B-1', text: '¿Qué pantalla?', options: ['Te toca', 'Hablar'] }),
  entry({ kind: 'secretary', ref: '7', text: '¿Qué día?', options: ['Lun', 'Mar'], turn: 7 }),
  entry({
    kind: 'secretary',
    ref: '8',
    text: '¿Lo devuelvo?',
    options: ['Sí', 'No'],
    about: 'E-1',
    turn: 8,
  }),
  entry({ kind: 'escalation', ref: 'E-2', signal: 3, by: 'kiln', text: 'el build está rojo' }),
  entry({ kind: 'worker', ref: 'Errores', items: ['E-4'], text: 'nadie trabaja el tablero' }),
];

// The server counts the same state with core/waiting.ts; what Te toca counts is 4 items (E-1, E-2,
// E-3 and the stuck E-4) and 4 more that are no item: 8, with the covered question once.
const WAITING = 8;

const pending: Pending = {
  count: WAITING,
  entries,
  blocks: [],
  queues: [],
  secretary: null,
};

const secretary = (o: Partial<SecretaryView> = {}): SecretaryView => ({
  name: 'sol',
  state: 'listening',
  since: null,
  pending: 0,
  waiting: { count: 0, since: null, messages: 0, notes: 0, reports: 0 },
  ...o,
});

let page: Mounted | undefined;
beforeEach(() => {
  setLanguage('en');
  vi.stubGlobal('requestAnimationFrame', () => 0);
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    const body = String(input instanceof Request ? input.url : input).endsWith('/api/boards')
      ? '{"boards":[]}'
      : '[]';
    return new Response(body, { status: 200, headers: { 'content-type': 'application/json' } });
  });
});
afterEach(() => {
  page?.unmount();
  page = undefined;
  vi.unstubAllGlobals();
  setLanguage('en');
});

const appOf = (o: Parameters<typeof testApp>[0] = {}) =>
  testApp({
    now: NOW,
    all: items,
    collections: [board],
    pending,
    secretary: secretary(),
    ...o,
  });

async function draw(node: React.ReactNode, o: Parameters<typeof testApp>[0] = {}) {
  page?.unmount();
  page = mount(<AppTestProvider value={appOf(o)}>{node}</AppTestProvider>);
  await settle();
  return page.root;
}

// The tab's title, as App.tsx draws it from the app's items and what Otea counted.
function Title() {
  const app = useApp();
  return <p>{attentionTitle(useAttention(app.all, app.pending), { project: 'repo' })}</p>;
}

const num = (text: string | null | undefined) => Number(/\d+/.exec(text ?? '')?.[0]);

describe('what waits for you, on every surface', () => {
  it('is one number: the selector, the rail, the tab bar, the title, Te toca and Hablar’s strip', async () => {
    expect(waitingCount({ all: items, now: NOW, pending })).toBe(WAITING);

    // The rail (desk) and its badge.
    const rail = await draw(<Rail />);
    expect(num(rail.querySelector('.nrow[data-k="toca"] .badge')?.textContent)).toBe(WAITING);

    // The tab bar (phone).
    const tabs = await draw(<TabBar />, { phone: true });
    expect(num(tabs.querySelector('.tbadge')?.textContent)).toBe(WAITING);

    // The tab's title.
    const title = await draw(<Title />);
    expect(title.textContent).toBe(`Otea · repo (${WAITING})`);

    // Te toca: the dek says it in words, and the sections add up to it.
    const toca = await draw(<TocaView />);
    const sections = [...toca.querySelectorAll('.sec')].filter((sec) =>
      ['atasco', 'preguntas', 'revisiones', 'propios', 'avisos', 'sinagente'].includes(
        sec.getAttribute('data-k')?.replace('sec:', '') ?? '',
      ),
    );
    const sum = sections.reduce(
      (n, sec) => n + Number(sec.querySelector('.nv')?.getAttribute('data-v')),
      0,
    );
    expect(sum).toBe(WAITING);
    expect(toca.querySelector('.dek')?.textContent).toContain('Eight things are waiting for you');

    // Hablar's «Te espera» strip counts what Te toca counts, the covered question once.
    const strip = await draw(<TeEspera pending={pending} onJump={() => undefined} />);
    expect(num(strip.querySelector('.hb-te-n')?.textContent)).toBe(WAITING);
  });

  it('keeps a report and a board with no agent out of «Questions for you»', async () => {
    const toca = await draw(<TocaView />);
    const questions = toca
      .querySelector('.sec[data-k="sec:preguntas"] .nv')
      ?.getAttribute('data-v');
    // E-3 asks, B-1 and the secretary's message 7 ask: three questions; the report and the board are
    // under headings of their own.
    expect(Number(questions)).toBe(3);
    expect(toca.querySelector('.sec[data-k="sec:avisos"] .nv')?.getAttribute('data-v')).toBe('1');
    expect(toca.querySelector('.sec[data-k="sec:sinagente"] .nv')?.getAttribute('data-v')).toBe(
      '1',
    );
  });

  it('lists the secretary’s question about a review with the review, not as a second thing', async () => {
    const toca = await draw(<TocaView />);
    const keys = [...toca.querySelectorAll('.row')].map((row) => row.getAttribute('data-k'));
    expect(keys).toContain('E-1');
    expect(keys).not.toContain('msg:8');
    expect(keys).toContain('msg:7');
  });

  it('counts the rail’s board pair the same way: what waits on the board, stuck included', async () => {
    const rail = await draw(<Rail />);
    const pair = rail.querySelector('.nrow[data-k="board:Errores"] .pair')?.textContent ?? '';
    // E-1, E-2, E-3 and the stuck E-4 wait on the board (the lapse of an agent still there does not).
    expect(num(pair)).toBe(4);
  });
});

describe('the secretary, on every surface', () => {
  const away = secretary({
    state: 'offline',
    since: ago(50),
    waiting: { count: 3, since: ago(45), messages: 1, notes: 1, reports: 1 },
  });

  it('is offline everywhere at once, and says what waits for it by what each is', async () => {
    const rail = await draw(<Rail />, { secretary: away });
    expect(rail.querySelector('.nrow[data-k="hablar"] .sec-dot')?.getAttribute('data-state')).toBe(
      'offline',
    );

    const toca = await draw(<TocaView />, { secretary: away });
    expect(toca.querySelector('.secoff h4')?.textContent).toBe('sol is offline');
    expect(toca.querySelector('.secoff p')?.textContent).toBe(
      '1 message, 1 note, and 1 report from an agent waiting for it.',
    );
  });

  it('is offline nowhere while it is there', async () => {
    const rail = await draw(<Rail />, { secretary: secretary() });
    expect(rail.querySelector('.nrow[data-k="hablar"] .sec-dot')?.getAttribute('data-state')).toBe(
      'listening',
    );
    const toca = await draw(<TocaView />, { secretary: secretary() });
    expect(toca.querySelector('.secoff')).toBeNull();
  });
});

describe('«agents» means the same agents everywhere', () => {
  it('never reads «no agent» in a notice while the pill counts the secretary as one', async () => {
    const { agentRows, agentCounts } = await import('./shell/topbar-model.ts');
    const { noAgents, workersOf } = await import('./listening.ts');
    const agents = [
      {
        name: 'sol',
        harness: null,
        profile: null,
        role: 'secretary',
        status: 'listening',
        waiting: true,
        live: true,
        holding: [],
        lastSeen: new Date(NOW).toISOString(),
      },
    ] as never;
    // The pill and its menu are made of the workers; with none, the notices say none.
    expect(agentCounts(agentRows(workersOf(agents), [], NOW)).live).toBe(0);
    expect(noAgents(agents)).toBe(true);
  });
});
