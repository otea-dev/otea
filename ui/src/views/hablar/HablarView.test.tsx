// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type App, AppTestProvider } from '../../app/context.tsx';
import type { ConversationView, Message } from '../../conversation.ts';
import { ago, item, NOW } from '../../derive/fixtures.ts';
import { setLanguage } from '../../i18n/i18n.ts';
import { testApp } from '../../shell/test-app.ts';
import { type Mounted, mount, press, settle, typeInto } from '../../test-dom.tsx';
import { FromTurns } from './FromTurns.tsx';
import { HablarView } from './HablarView.tsx';

// Hablar as a person meets it: the conversation on two lanes, the branch of items a request
// produced, a question to answer in place, a long reply folded, the composer, «Lo que salió», the
// secretary away, and no secretary at all.

let seq = 0;
function say(o: Partial<Message> & { author: Message['author'] }): Message {
  seq += 1;
  const id = o.id ?? seq;
  return {
    id,
    by: o.author === 'person' ? 'tú' : 'quill',
    text: 'hola',
    at: ago(30),
    replyTo: null,
    root: id,
    kind: null,
    kindBy: null,
    links: [],
    attachments: [],
    delivery: o.author === 'person' ? 'read' : null,
    readAt: null,
    topic: null,
    ...o,
  };
}

const LISTENING = { name: 'quill', state: 'listening', since: null, pending: 0 } as const;

const conversation = (o: Partial<ConversationView> = {}): ConversationView => ({
  messages: [],
  more: false,
  secretary: LISTENING,
  waiting: { count: 0, since: null },
  ...o,
});

type Call = { method: string; url: string; headers: Record<string, string>; body: unknown };

// The server as the page reaches it: the conversation it reads, and every write it makes with the
// headers it sent. `failures` is how many sends it refuses before it hears one.
function server(view: ConversationView, o: { failures?: number } = {}) {
  const calls: Call[] = [];
  let failures = o.failures ?? 0;
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input instanceof Request ? input.url : input);
    const method = (init.method ?? 'GET').toUpperCase();
    const json = (value: unknown, status = 200) =>
      new Response(JSON.stringify(value), {
        status,
        headers: { 'content-type': 'application/json' },
      });
    const path = new URL(url, 'http://127.0.0.1').pathname;
    if (method === 'GET') {
      if (path.endsWith('/conversation')) return json(view);
      if (path.endsWith('/secretary')) return json({ secretary: view.secretary });
      return json({ error: { code: 'not_found' } }, 404);
    }
    const body =
      typeof init.body === 'string' ? (JSON.parse(init.body) as unknown) : (init.body as unknown);
    calls.push({
      method,
      url: path,
      headers: (init.headers ?? {}) as Record<string, string>,
      body,
    });
    if (failures > 0) {
      failures -= 1;
      return json({ error: { code: 'down' } }, 503);
    }
    return json({ id: 99 }, 201);
  });
  return calls;
}

let page: Mounted | undefined;

beforeEach(() => {
  setLanguage('es');
});
afterEach(() => {
  page?.unmount();
  page = undefined;
  vi.unstubAllGlobals();
  setLanguage('en');
});

async function open(view: ConversationView, app: Partial<App> = {}, route = {}) {
  const calls = server(view);
  const value = testApp({ now: NOW, ...app });
  page = mount(
    <AppTestProvider value={value}>
      <HablarView {...route} />
    </AppTestProvider>,
  );
  await settle();
  return { root: page.root, calls, app: value };
}

const q = <T extends Element = HTMLElement>(root: HTMLElement, selector: string) =>
  root.querySelector<T>(selector);
const all = (root: HTMLElement, selector: string) => [
  ...root.querySelectorAll<HTMLElement>(selector),
];
const text = (el: Element | null | undefined) => el?.textContent?.replace(/\s+/g, ' ').trim();

// A request: what the person said, what the secretary answered, and the items it linked.
const request = (links: string[] = ['CAM-12', 'CAM-13']) => [
  say({
    id: 1,
    author: 'person',
    text: 'El botón Aprobar queda tapado en el celu',
    kind: 'request',
    links,
  }),
  say({
    id: 2,
    author: 'secretary',
    replyTo: 1,
    root: 1,
    kind: 'request',
    links,
    text: 'Lo anoté en Cambios y ya lo tomó un trabajador.',
  }),
];

const working = item({
  id: 'CAM-12',
  title: 'La barra fija tapa Aprobar',
  turn: 'agent',
  lease: { holder: 'worker', expiresAt: new Date(NOW + 600_000).toISOString() },
});
const queued = item({ id: 'CAM-13', title: 'Test visual a 390 px', turn: 'agent' });
const asking = item({
  id: 'CAM-14',
  title: 'Probar en tablet',
  turn: 'human',
  asks: {
    question: 2,
    by: 'worker',
    text: '¿Lo pruebo también en tablet?',
    at: ago(3),
    options: ['Solo celular y escritorio', 'Celular, tablet y escritorio'],
    recommended: 1,
  },
});

describe('the conversation on the two lanes', () => {
  it('puts what you said on your lane and the secretary on its own, the secretary’s lane named first', async () => {
    const { root } = await open(conversation({ messages: request() }));

    const rows = all(root, '.hb-row');
    expect(rows.map((row) => (row.classList.contains('you') ? 'you' : 'secretary'))).toEqual([
      'you',
      'secretary',
    ]);
    expect(rows[0]?.style.getPropertyValue('--x')).toBe('40.5px');
    expect(rows[1]?.style.getPropertyValue('--x')).toBe('16.5px');
    expect(q(rows[0] as HTMLElement, '.nd')).not.toBeNull();
    expect(text(rows[0])).toContain('El botón Aprobar queda tapado en el celu');
    expect(text(rows[1])).toContain('secretario');
    expect(text(rows[1])).toContain('Lo anoté en Cambios');
    const heads = all(root, '.lane-head span').map((span) => text(span));
    expect(heads).toEqual(['sec', 'tú']);
  });

  it('hangs a branch of chips from a request, each with its item’s look, and opens the item on a tap', async () => {
    const openItem = vi.fn();
    const { root } = await open(
      conversation({ messages: request(['CAM-12', 'CAM-13', 'CAM-14']) }),
      {
        all: [working, queued, asking],
        openItem,
      },
    );

    const chips = all(root, '.hb-branch .hb-chip');
    expect(chips.map((chip) => text(chip))).toEqual([
      // The agent holding it is its mark («wo»), then the state.
      'CAM-12La barra fija tapa Aprobarwoen curso',
      'CAM-13Test visual a 390 pxen cola',
      'CAM-14Probar en tablette pregunta',
    ]);
    // A working item turns an orbit; a queued one is a quiet ring.
    expect(q(chips[0] as HTMLElement, '.orb')).not.toBeNull();
    expect(q(chips[1] as HTMLElement, '.orb')).toBeNull();

    await press(chips[1]);
    expect(openItem).toHaveBeenCalledWith('CAM-13');
  });

  it('shows an agent’s question on a linked item with its options, and answers it in place', async () => {
    const answer = vi.fn(async () => undefined);
    const { root } = await open(conversation({ messages: request(['CAM-14']) }), {
      all: [asking],
      answer,
    });

    const card = q(root, '.hb-ask');
    expect(text(q(card as HTMLElement, '.hb-q'))).toBe('¿Lo pruebo también en tablet?');
    const options = all(card as HTMLElement, '.hb-opt');
    expect(options.map((o) => text(o))).toEqual([
      'Solo celular y escritoriorecomendada',
      'Celular, tablet y escritorio',
    ]);

    await press(options[1]);

    // It says which question the tap is for, as the item page does.
    expect(answer).toHaveBeenCalledWith('CAM-14', { option: 2, question: 2 }, expect.any(String));
  });
});

describe('a long reply', () => {
  const long = [
    'Listo: lo dejé en tres pasos.',
    'Primero revisé la barra de abajo.',
    'Luego medí el botón a 390 px.',
    'Después probé el modo oscuro.',
    'Y por último el modo claro.',
    'Quedó todo anotado en el ítem.',
  ].join('\n');

  it('keeps its first line and folds the rest behind «ver más»', async () => {
    const { root } = await open(
      conversation({
        messages: [
          say({ id: 1, author: 'person' }),
          say({ id: 2, author: 'secretary', replyTo: 1, root: 1, text: long }),
        ],
      }),
    );

    expect(text(q(root, '.hb-bluf'))).toBe('Listo: lo dejé en tres pasos.');
    const fold = q(root, '.hb-fold') as HTMLElement;
    expect(fold.hasAttribute('data-open')).toBe(false);
    expect(q(fold, '.hb-more')?.hasAttribute('inert')).toBe(true);
    const toggle = q(root, '.hb-toggle') as HTMLElement;
    expect(text(toggle)).toBe('ver más');

    await press(toggle);

    expect(fold.hasAttribute('data-open')).toBe(true);
    expect(q(fold, '.hb-more')?.hasAttribute('inert')).toBe(false);
    expect(text(toggle)).toBe('ver menos');
  });

  it('shows a short rest without folding it', async () => {
    const { root } = await open(
      conversation({
        messages: [
          say({ id: 1, author: 'person' }),
          say({ id: 2, author: 'secretary', replyTo: 1, root: 1, text: 'Hecho.\nUna nota más.' }),
        ],
      }),
    );
    expect(q(root, '.hb-fold')).toBeNull();
    expect(text(q(root, '.hb-more-open'))).toBe('Una nota más.');
  });
});

describe('the secretary thinking', () => {
  const read = [say({ id: 1, author: 'person', delivery: 'read', text: '¿Tailscale o el relay?' })];

  it('says «pensando…» on its lane while it holds a turn it read and has not answered', async () => {
    const { root } = await open(conversation({ messages: read }));
    expect(text(q(root, '.hb-thinking'))).toBe('pensando…');
    expect(q(root, '.nd.secretary[data-busy]')).not.toBeNull();
  });

  it('does not while it is away: the banner says so instead', async () => {
    const { root } = await open(
      conversation({
        messages: read,
        secretary: { name: 'quill', state: 'offline', since: ago(240), pending: 1 },
      }),
    );
    expect(q(root, '.hb-thinking')).toBeNull();
    expect(q(root, '.hb-away')).not.toBeNull();
  });

  it('marks a message it has not read yet as waiting', async () => {
    const { root } = await open(
      conversation({ messages: [say({ id: 1, author: 'person', delivery: 'pending' })] }),
    );
    expect(text(q(root, '.hb-who .hb-pend'))).toBe('esperando');
    expect(q(root, '.hb-thinking')).toBeNull();
  });
});

describe('the composer', () => {
  it('sends what you wrote under an Idempotency-Key, and again under the same key after a failure', async () => {
    const view = conversation();
    const calls = server(view, { failures: 1 });
    page = mount(
      <AppTestProvider value={testApp({ now: NOW })}>
        <HablarView />
      </AppTestProvider>,
    );
    await settle();
    const root = page.root;
    const field = q<HTMLTextAreaElement>(root, '.hb-input textarea');
    await typeInto(field, 'El botón Aprobar queda tapado');
    const send = q(root, '.hb-send');

    await press(send);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('/api/conversation/messages');
    const key = calls[0]?.headers['idempotency-key'];
    expect(key).toMatch(/^[A-Za-z0-9_-]{1,128}$/);
    expect(calls[0]?.body).toEqual({ text: 'El botón Aprobar queda tapado' });
    // It was not heard: the words stay and the failure says so.
    expect(field?.value).toBe('El botón Aprobar queda tapado');
    expect(q(root, '.hb-err')).not.toBeNull();

    await press(send);

    expect(calls).toHaveLength(2);
    expect(calls[1]?.headers['idempotency-key']).toBe(key);
    expect(field?.value).toBe('');

    // A new message is a new send, under a new key.
    await typeInto(field, 'Otra cosa');
    await press(send);
    expect(calls).toHaveLength(3);
    expect(calls[2]?.headers['idempotency-key']).not.toBe(key);
  });

  it('sends files with the words as a form, and shows each one before it goes', async () => {
    const calls = server(conversation());
    page = mount(
      <AppTestProvider value={testApp({ now: NOW })}>
        <HablarView />
      </AppTestProvider>,
    );
    await settle();
    const root = page.root;
    const input = q<HTMLInputElement>(root, '.hb-input input[type="file"]') as HTMLInputElement;
    const shot = new File(['x'], 'captura-390.png', { type: 'image/png' });
    Object.defineProperty(input, 'files', { value: [shot], configurable: true });
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();

    expect(text(q(root, '.hb-drafts'))).toContain('captura-390.png');
    await typeInto(q<HTMLTextAreaElement>(root, '.hb-input textarea'), 'mirá');
    await press(q(root, '.hb-send'));

    const form = calls[0]?.body as FormData;
    expect(form).toBeInstanceOf(FormData);
    expect(JSON.parse(String(form.get('message')))).toEqual({ text: 'mirá' });
    expect(form.getAll('file').map((file) => (file as File).name)).toEqual(['captura-390.png']);
    expect(calls[0]?.headers['idempotency-key']).toBeDefined();
  });

  it('offers three suggestions that fill the box, and sends nothing until you do', async () => {
    const { root, calls } = await open(conversation());
    const suggestions = all(root, '.hb-sugg').map((button) => text(button));
    expect(suggestions).toEqual([
      '¿Qué me espera hoy?',
      'Resúmeme lo que se hizo',
      'Arma un tablero para…',
    ]);

    await press(all(root, '.hb-sugg')[1]);

    expect(q<HTMLTextAreaElement>(root, '.hb-input textarea')?.value).toBe(
      'Resúmeme lo que se hizo',
    );
    expect(calls).toHaveLength(0);
  });

  it('does not send while the PC does not answer, and says so', async () => {
    const { root } = await open(conversation(), { sync: { offline: true, syncedAt: null } });
    await typeInto(q<HTMLTextAreaElement>(root, '.hb-input textarea'), 'hola');
    expect(q<HTMLButtonElement>(root, '.hb-send')?.disabled).toBe(true);
    expect(text(q(root, '.hb-note'))).toContain('Sin conexión con tu equipo');
  });
});

describe('correcting what a turn is', () => {
  it('turns a request into a consultation with one tap on its label', async () => {
    const { root, calls } = await open(conversation({ messages: request() }));
    const label = q(root, '.hb-kind') as HTMLElement;
    expect(text(label)).toBe('pedido');

    await press(label);

    expect(calls).toEqual([
      expect.objectContaining({
        method: 'POST',
        url: '/api/conversation/messages/1/kind',
        body: { kind: 'consultation' },
      }),
    ]);
    // It shows as the person set it at once, before the server says so too.
    expect(text(q(root, '.hb-kind'))).toBe('consulta');
  });
});

describe('the secretary away, or never there', () => {
  it('says since when it is away, that the messages wait, and how many', async () => {
    const { root } = await open(
      conversation({
        messages: [say({ id: 1, author: 'person', delivery: 'pending' })],
        secretary: { name: 'quill', state: 'offline', since: ago(240), pending: 2 },
        waiting: { count: 2, since: ago(120) },
      }),
    );
    const banner = text(q(root, '.hb-away')) ?? '';
    expect(banner).toMatch(/^Tu secretario está desconectado desde .+\. Tus mensajes lo esperan\./);
    expect(banner).toContain('2 mensajes esperando');
  });

  it('explains how to start one when the project has none, and still lets you write', async () => {
    const { root } = await open(conversation({ secretary: null }));
    const none = q(root, '.hb-nosec') as HTMLElement;
    expect(text(none)).toContain('Pídele a tu agente que sea el secretario de este proyecto');
    expect(text(q(none, 'code'))).toBe('otea profile --role secretary');
    expect(q<HTMLTextAreaElement>(root, '.hb-input textarea')?.disabled).toBe(false);
  });

  it('says nothing about a secretary that is there and has not been spoken to yet', async () => {
    const { root } = await open(conversation());
    expect(q(root, '.hb-nosec')).toBeNull();
    expect(q(root, '.hb-away')).toBeNull();
    expect(text(q(root, '.hb-pane'))).toContain('Todavía no hay nada dicho');
  });
});

describe('«Lo que salió»', () => {
  const messages = [
    ...request(),
    say({ id: 3, author: 'person', text: '¿Un tablero por cliente?', kind: 'consultation' }),
    say({
      id: 4,
      author: 'secretary',
      replyTo: 3,
      root: 3,
      kind: 'consultation',
      text: 'Sí, si cada cliente revisa distinto.\nDepende de cómo revisen.',
    }),
  ];

  it('has a card per request, with its items, and per consultation, with its answer', async () => {
    const { root } = await open(conversation({ messages }), { all: [working, queued] });
    const cards = all(root, '.hb-card');
    expect(cards.map((card) => card.dataset.kind)).toEqual(['consultation', 'request']);
    expect(text(cards[0])).toContain('¿Un tablero por cliente?');
    expect(text(cards[0])).toContain('Sí, si cada cliente revisa distinto.');
    expect(all(cards[1] as HTMLElement, '.hb-kid').map((kid) => text(kid))).toEqual([
      'CAM-12woen curso',
      'CAM-13en cola',
    ]);
  });

  it('filters them: Todo, Pedidos, Consultas', async () => {
    const { root } = await open(conversation({ messages }), { all: [working, queued] });
    const filters = all(root, '.hb-filter button');
    expect(filters.map((button) => text(button))).toEqual(['Todo2', 'Pedidos1', 'Consultas1']);

    await press(filters[2]);
    expect(all(root, '.hb-card').map((card) => card.dataset.kind)).toEqual(['consultation']);
    await press(filters[1]);
    expect(all(root, '.hb-card').map((card) => card.dataset.kind)).toEqual(['request']);
    await press(filters[0]);
    expect(all(root, '.hb-card')).toHaveLength(2);
  });

  it('takes you to the turn a card came from', async () => {
    const { root } = await open(conversation({ messages }), { all: [working, queued] });
    expect(q(root, '#hb-turn-1')?.hasAttribute('data-found')).toBe(false);

    await press(q(all(root, '.hb-card')[1] as HTMLElement, '.hb-ct'));

    expect(q(root, '#hb-turn-1')?.hasAttribute('data-found')).toBe(true);
  });

  it('opens the conversation at the turn a link asks for', async () => {
    const { root } = await open(
      conversation({ messages }),
      { all: [working, queued] },
      { turn: 3 },
    );
    expect(q(root, '#hb-turn-3')?.hasAttribute('data-found')).toBe(true);
    expect(q(root, '#hb-turn-1')?.hasAttribute('data-found')).toBe(false);
  });
});

describe('the way back from an item', () => {
  it('says the item came out of Hablar, quotes the turn and opens Hablar at it', () => {
    page = mount(
      <FromTurns
        turns={[
          {
            id: 7,
            at: ago(5),
            author: 'person',
            kind: 'request',
            snippet: 'El botón queda tapado',
          },
          { id: 9, at: ago(2), author: 'person', kind: 'request', snippet: 'Otro' },
        ]}
      />,
    );
    const link = q<HTMLAnchorElement>(page.root, 'a');
    expect(link?.getAttribute('href')).toBe('#/hablar/7');
    expect(link?.textContent).toBe('salió de Hablar · «El botón queda tapado»');
    expect(text(q(page.root, '.hb-turns'))).toBe('+ 1 turno más');
  });

  it('says nothing for an item that did not come from a conversation', () => {
    page = mount(<FromTurns turns={undefined} />);
    expect(page.root.textContent).toBe('');
  });
});
