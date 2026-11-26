// @vitest-environment happy-dom
import { act, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type App, AppTestProvider } from '../../app/context.tsx';
import type { ConversationView, Message } from '../../conversation.ts';
import { ago, item, NOW } from '../../derive/fixtures.ts';
import { setLanguage } from '../../i18n/i18n.ts';
import { seenAtMount } from '../../kit/pop/toast.tsx';
import { testApp } from '../../shell/test-app.ts';
import { buttonNamed, type Mounted, mount, press, settle, typeInto } from '../../test-dom.tsx';
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
    options: [],
    recommended: null,
    choice: null,
    heardAt: null,
    kindNews: false,
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
// `hold`: a promise the server waits for before it answers a write (a send on its way).
function server(view: ConversationView, o: { failures?: number; hold?: Promise<void> } = {}) {
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
      if (path.endsWith('/conversation')) {
        const search = new URL(url, 'http://127.0.0.1').searchParams.get('search');
        if (search === null) return json(view);
        const words = search.toLowerCase().split(/\s+/);
        return json({
          ...view,
          messages: view.messages.filter((m) =>
            words.some((word) => m.text.toLowerCase().includes(word)),
          ),
        });
      }
      if (path.endsWith('/secretary')) return json({ secretary: view.secretary });
      if (path.endsWith('/agent-prompt'))
        return json({ kind: 'secretary', prompt: 'Eres el secretario de este proyecto.' });
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
    await o.hold;
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

describe('the conversation as a thread in time', () => {
  const thread = () => [
    ...request(['CAM-12']),
    say({ id: 3, author: 'person', text: '¿Y los reintentos con backoff?', kind: 'consultation' }),
    say({
      id: 4,
      author: 'secretary',
      replyTo: 3,
      root: 3,
      kind: 'consultation',
      text: 'Conviene, con tope.',
    }),
    // The secretary's news about the first request, said later with --reply-to.
    say({
      id: 5,
      author: 'secretary',
      replyTo: 1,
      root: 1,
      kind: 'request',
      links: ['CAM-12'],
      text: 'CAM-12 ya está para revisar.',
    }),
    // And news of its own, with no message it answers.
    say({
      id: 6,
      author: 'secretary',
      links: ['CAM-13'],
      text: 'CAM-13 también espera tu revisión.',
    }),
  ];

  it('puts each message where it was said, the news at the foot, a late reply naming what it answers', async () => {
    const { root } = await open(conversation({ messages: thread() }), { all: [working, queued] });

    const rows = all(root, '.hb-row');
    expect(rows.map((row) => text(row)?.includes('ya está para revisar'))).toEqual([
      false,
      false,
      false,
      false,
      true,
      false,
    ]);
    expect(text(rows[5])).toContain('CAM-13 también espera tu revisión.');
    const reference = q(rows[4] as HTMLElement, '.hb-re');
    expect(text(reference)).toContain('El botón Aprobar queda tapado en el celu');
    // The next reply right below its message says nothing of what it answers.
    expect(q(rows[1] as HTMLElement, '.hb-re')).toBeNull();
    // The notice points at its own items, and the first request keeps its own branch.
    expect(all(rows[5] as HTMLElement, '.hb-branch .hb-chip').map((chip) => text(chip))).toEqual([
      expect.stringContaining('CAM-13'),
    ]);
    expect(all(rows[1] as HTMLElement, '.hb-branch .hb-chip')).toHaveLength(1);
    // The consultation stays a consultation.
    expect(all(root, '.hb-row .hb-kind').map((label) => label.dataset.kind)).toEqual([
      'request',
      'consultation',
    ]);
  });

  it('shows an agent’s question at the foot of the conversation, below what was said after it', async () => {
    const messages = [
      ...request(['CAM-14']),
      say({ id: 3, author: 'person', text: 'y otra cosa' }),
    ];
    const { root } = await open(conversation({ messages }), { all: [asking] });

    const card = q(root, '.hb-ask') as HTMLElement;
    const last = all(root, '.hb-row.you').at(-1) as HTMLElement;
    expect(text(last)).toContain('y otra cosa');
    expect(last.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('keeps what you chose in the thread, as your own row', async () => {
    const messages = [
      ...request(['CAM-14']),
      say({
        id: 3,
        author: 'person',
        text: 'Celular, tablet y escritorio',
        choice: {
          mode: 'option',
          option: 2,
          about: 'CAM-14',
          asked: '¿Lo pruebo también en tablet?',
        },
      }),
    ];
    const { root } = await open(conversation({ messages }));

    const chose = q(root, '.hb-row.you .hb-chose') as HTMLElement;
    expect(text(chose)).toContain('Elegiste: Celular, tablet y escritorio');
    expect(text(chose)).toContain('CAM-14');
    // A trace is no message waiting for the secretary.
    expect(q(root, '.hb-thinking')).toBeNull();
  });
});

describe('a question of the secretary', () => {
  const question = () => [
    say({ id: 1, author: 'person', text: '¿no estaría bueno un jefe en el piso 3?' }),
    say({
      id: 2,
      author: 'secretary',
      replyTo: 1,
      root: 1,
      text: '¿Qué hago con esto?',
      options: ['Anotarlo', 'Dejarlo como idea'],
      recommended: 1,
    }),
  ];

  it('comes with buttons, the recommended one marked, and a tap goes back to the secretary', async () => {
    const { root, calls } = await open(conversation({ messages: question() }));

    const options = all(root, '.hb-row.secretary .hb-opt');
    expect(options.map((option) => text(option))).toEqual([
      'Anotarlorecomendada',
      'Dejarlo como idea',
    ]);

    await press(options[1]);

    expect(calls.map(({ method, url, body }) => [method, url, body])).toEqual([
      ['POST', '/api/conversation/messages/2/answer', { option: 2 }],
    ]);
  });

  it('offers its buttons as a group named by the question, so a screen reader hears what they answer', async () => {
    const { root } = await open(conversation({ messages: question() }));

    // A fieldset is a group, named here by the question.
    const group = q(root, '.hb-row.secretary fieldset') as HTMLElement;
    expect(group).not.toBeNull();
    expect(group.getAttribute('aria-label')).toContain('¿Qué hago con esto?');
    expect(all(group, '.hb-opt')).toHaveLength(2);
  });

  it('has no buttons once you answered it, and your answer is in the thread', async () => {
    const messages = [
      ...question(),
      say({
        id: 3,
        author: 'person',
        replyTo: 2,
        text: 'Dejarlo como idea',
        choice: { mode: 'option', option: 2, about: null, asked: null },
      }),
    ];
    const { root } = await open(conversation({ messages }));

    expect(q(root, '.hb-opt')).toBeNull();
    expect(text(q(root, '.hb-chose'))).toContain('Elegiste: Dejarlo como idea');
    // It is waiting for the secretary, as any message of yours.
    expect(q(root, '.hb-thinking')).not.toBeNull();
  });
});

describe('a one-paragraph reply', () => {
  it('sets only its first sentence as the conclusion, the rest in body text', async () => {
    const paragraph =
      'Lo anoté en Cambios. Ya lo tomó un trabajador y está probando a 390 px. Te aviso cuando haya algo para revisar.';
    const { root } = await open(
      conversation({
        messages: [
          say({ id: 1, author: 'person' }),
          say({ id: 2, author: 'secretary', replyTo: 1, root: 1, text: paragraph }),
        ],
      }),
    );

    expect(text(q(root, '.hb-bluf'))).toBe('Lo anoté en Cambios.');
    expect(text(q(root, '.hb-more-open'))).toBe(
      'Ya lo tomó un trabajador y está probando a 390 px. Te aviso cuando haya algo para revisar.',
    );
  });
});

describe('a kind you corrected', () => {
  it('stays in «Lo que salió» with no items yet, saying the secretary is taking it', async () => {
    const messages = [
      say({ id: 1, author: 'person', text: '¿Vale la pena exportar a Markdown?' }),
      say({
        id: 2,
        author: 'secretary',
        replyTo: 1,
        root: 1,
        kind: 'request',
        kindBy: 'person',
        kindNews: true,
        text: 'Lo tomo como una consulta.',
      }),
    ];
    const { root } = await open(conversation({ messages }));

    const card = q(root, '.hb-card') as HTMLElement;
    expect(text(card)).toContain('¿Vale la pena exportar a Markdown?');
    expect(text(q(card, '.hb-taking'))).toBe('el secretario lo está tomando');
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

  // Field study 3 (S4): no subagents, so the secretary pastes the text of each session to open. It
  // was one plain text with no Copy; each is now a numbered block with its own button, in view.
  it('draws a text to paste as a numbered block with a Copy button, never folded', async () => {
    const written: string[] = [];
    vi.stubGlobal('navigator', {
      ...navigator,
      clipboard: { writeText: async (words: string) => void written.push(words) },
    });
    const first = 'Eres un trabajador del tablero Cambios.\n1. Declara tu perfil.\n2. Trabaja.';
    const { root } = await open(
      conversation({
        messages: [
          say({ id: 1, author: 'person' }),
          say({
            id: 2,
            author: 'secretary',
            replyTo: 1,
            root: 1,
            text: [
              'Abre 2 sesiones más.',
              '1. Trabajador de Cambios: pégalo en una sesión nueva.',
              '```',
              first,
              '```',
              '2. Refinador:',
              '```',
              'Eres el refinador.',
              '```',
            ].join('\n'),
          }),
        ],
      }),
    );
    expect(text(q(root, '.hb-bluf'))).toBe('Abre 2 sesiones más.');
    const blocks = all(root, '.hb-block');
    expect(blocks).toHaveLength(2);
    expect(q(root, '.hb-fold')).toBeNull();
    expect(text(q(blocks[0] as HTMLElement, '.hb-bcap'))).toBe(
      '1. Trabajador de Cambios: pégalo en una sesión nueva.',
    );
    expect(blocks[0]?.querySelector('pre')?.textContent).toBe(first);
    await press(buttonNamed(blocks[1] as HTMLElement, 'Copiar'));
    expect(written).toEqual(['Eres el refinador.']);
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

  // The secretary's rule (its role text): the conclusion, then at most 3 short lines. A reply that
  // keeps it shows whole; one longer than that folds behind «ver más».
  const rule = ['Listo.', 'Primera.', 'Segunda.', 'Tercera.'];
  const reply = (lines: string[]) =>
    conversation({
      messages: [
        say({ id: 1, author: 'person' }),
        say({ id: 2, author: 'secretary', replyTo: 1, root: 1, text: lines.join('\n') }),
      ],
    });

  it('shows a conclusion and 3 short lines whole', async () => {
    const { root } = await open(reply(rule));
    expect(q(root, '.hb-fold')).toBeNull();
    expect(text(q(root, '.hb-more-open'))).toBe('Primera. Segunda. Tercera.');
  });

  it('folds a message with a fourth line behind «ver más»', async () => {
    const { root } = await open(reply([...rule, 'Cuarta.']));
    expect(q(root, '.hb-fold')).not.toBeNull();
    expect(text(q(root, '.hb-toggle'))).toBe('ver más');
  });
});

describe('the secretary thinking', () => {
  const read = [say({ id: 1, author: 'person', delivery: 'read', text: '¿Tailscale o el relay?' })];

  it('says «leído · pensando…» on its lane while it holds a turn it read and has not answered', async () => {
    const { root } = await open(conversation({ messages: read }));
    expect(text(q(root, '.hb-thinking'))).toBe('leído · pensando…');
    expect(q(root, '.nd.secretary[data-busy]')).not.toBeNull();
  });

  // The secretary's wait returned the message: the person sees it arrived at once, before it is read.
  it('says it at once when the wait only heard the message, without calling it waiting', async () => {
    const { root } = await open(
      conversation({
        messages: [say({ id: 1, author: 'person', delivery: 'pending', heardAt: ago(0) })],
      }),
    );
    expect(text(q(root, '.hb-thinking'))).toBe('leído · pensando…');
    expect(q(root, '.hb-who .hb-pend')).toBeNull();
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

  // F2 (field study 3): the offline notice said it was away and gave no way back.
  it('tells the person how to bring it back, by its own name, when it is away', async () => {
    const { root } = await open(
      conversation({
        messages: read,
        secretary: { name: 'quill', state: 'offline', since: ago(240), pending: 1 },
      }),
    );
    const away = q(root, '.hb-away');
    expect(text(away)).toContain('otea wait --secretary --as quill');
    expect(text(away)).toContain('otea prompt --role secretary --as quill');
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

  // Several turns can be marked at once: each label says which message it is for, and a tap says
  // what happens next, with a way back.
  it('names the message each label is for, and says what a tap does, with a way back', async () => {
    const messages = [
      ...request(),
      say({ id: 3, author: 'person', text: '¿Un tablero por cliente?', kind: 'consultation' }),
      say({
        id: 4,
        author: 'secretary',
        replyTo: 3,
        root: 3,
        kind: 'consultation',
        text: 'Sí.',
      }),
    ];
    const { root } = await open(conversation({ messages }));

    const labels = all(root, '.hb-row .hb-kind');
    // Each name carries its own message, whatever the rest of the wording.
    const names = labels.map((label) => label.getAttribute('aria-label') ?? '');
    expect(names[0]).toContain('El botón Aprobar queda tapado en el celu');
    expect(names[1]).toContain('¿Un tablero por cliente?');
    expect(names[0]).not.toContain('Un tablero por cliente');
    const before = seenAtMount();

    await press(labels[1]);

    expect(seenAtMount()).toBeGreaterThan(before);
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

  // Field study 3: the empty state gave `otea profile --role secretary`, which only declares a role
  // and brings none of the instructions. What makes an agent a secretary is its text.
  it('gives the secretary text to copy when the project has none, and still lets you write', async () => {
    const written: string[] = [];
    vi.stubGlobal('navigator', {
      ...navigator,
      clipboard: { writeText: async (words: string) => void written.push(words) },
    });
    const { root } = await open(conversation({ secretary: null }));
    const none = q(root, '.hb-nosec') as HTMLElement;
    expect(text(none)).toContain('Abre la sesión de un agente y pégale este texto');
    expect(text(q(none, 'code'))).toBe('otea prompt --role secretary');
    expect(text(none)).not.toContain('otea profile');
    await press(buttonNamed(none, 'Copiar el texto del secretario'));
    expect(written).toEqual(['Eres el secretario de este proyecto.']);
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
      'CAM-12La barra fija tapa Aprobarwoen curso',
      'CAM-13Test visual a 390 pxen cola',
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

  // Field study 3: consultations were hard to find again; the search looked only at items.
  it('searches what was said, consultations included, and takes you to the turn', async () => {
    const { root } = await open(conversation({ messages }), { all: [working, queued] });
    await typeInto(q(root, '.hb-search input'), 'cliente');
    await vi.waitFor(() => expect(all(root, '.hb-hit').length).toBeGreaterThan(0));
    expect(all(root, '.hb-card')).toHaveLength(0);
    const hits = all(root, '.hb-hit');
    expect(hits.map((hit) => text(hit))).toEqual([
      expect.stringContaining('Un tablero por cliente'),
    ]);
    expect(text(hits[0])).toContain('consulta');
    await press(q(hits[0] as HTMLElement, 'button'));
    expect(q(root, '#hb-turn-3')?.hasAttribute('data-found')).toBe(true);
    // Cleared, the cards are back.
    await typeInto(q(root, '.hb-search input'), '');
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

// A page whose live feed the test drives: `bump` is a change of the project (the desk's stream),
// `went` what the page asked the router for.
type Live = { bump: () => void; went: unknown[] };

function Live({ ctl, route, app }: { ctl: Live; route: { turn?: number }; app: Partial<App> }) {
  const [version, setVersion] = useState(1);
  const [at, setAt] = useState(route);
  ctl.bump = () => setVersion((n) => n + 1);
  return (
    <AppTestProvider
      value={testApp({
        now: NOW,
        version,
        go: (to) => {
          ctl.went.push(to);
          setAt({});
        },
        ...app,
      })}
    >
      <HablarView {...at} />
    </AppTestProvider>
  );
}

function mountLive(app: Partial<App> = {}, route: { turn?: number } = {}): Live {
  const ctl: Live = { bump: () => undefined, went: [] };
  page = mount(<Live ctl={ctl} route={route} app={app} />);
  return ctl;
}

const change = async (ctl: { bump: () => void }) => {
  await act(async () => ctl.bump());
  await settle();
};

const enter = (field: Element | null | undefined, init: KeyboardEventInit, keyCode = 13) => {
  const event = new KeyboardEvent('keydown', {
    key: 'Enter',
    bubbles: true,
    cancelable: true,
    ...init,
  });
  Object.defineProperty(event, 'keyCode', { value: keyCode });
  return act(async () => {
    field?.dispatchEvent(event);
  });
};

describe('Enter in the composer', () => {
  it('sends on the desk, but never an Enter that confirms an IME candidate', async () => {
    const { root, calls } = await open(conversation());
    const field = q<HTMLTextAreaElement>(root, '.hb-input textarea');
    await typeInto(field, 'こんにちは');

    // Mid-composition, and Safari's way of saying it (the composition ended, keyCode 229).
    await enter(field, { isComposing: true });
    await enter(field, { isComposing: false }, 229);
    await settle();
    expect(calls).toHaveLength(0);

    await enter(field, { isComposing: false });
    await settle();
    expect(calls).toHaveLength(1);
  });
});

describe('a send on its way', () => {
  it('clears only what was sent: words typed meanwhile stay, and go under a key of their own', async () => {
    let release: () => void = () => undefined;
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const calls = server(conversation(), { hold });
    page = mount(
      <AppTestProvider value={testApp({ now: NOW })}>
        <HablarView />
      </AppTestProvider>,
    );
    await settle();
    const root = page.root;
    const field = q<HTMLTextAreaElement>(root, '.hb-input textarea');
    await typeInto(field, 'primero');
    await press(q(root, '.hb-send'));
    expect(calls).toHaveLength(1);

    await typeInto(field, 'primero y algo más');
    release();
    await settle();

    expect(field?.value).toBe('primero y algo más');
    await press(q(root, '.hb-send'));
    expect(calls).toHaveLength(2);
    expect(calls[1]?.body).toEqual({ text: 'primero y algo más' });
    expect(calls[1]?.headers['idempotency-key']).not.toBe(calls[0]?.headers['idempotency-key']);
  });
});

describe('the kind you set, and the server’s word', () => {
  it('goes back to what the turn was when the server refuses the change', async () => {
    const calls = server(conversation({ messages: request() }), { failures: 1 });
    page = mount(
      <AppTestProvider value={testApp({ now: NOW })}>
        <HablarView />
      </AppTestProvider>,
    );
    await settle();
    await press(q(page.root, '.hb-kind'));

    expect(calls).toHaveLength(1);
    expect(text(q(page.root, '.hb-kind'))).toBe('pedido');
  });

  it('stops overriding once the server says the same, so its later change shows', async () => {
    const view = conversation({ messages: request() });
    server(view);
    const ctl = mountLive();
    await settle();
    await press(q(page?.root as HTMLElement, '.hb-kind'));
    expect(text(q(page?.root as HTMLElement, '.hb-kind'))).toBe('consulta');

    const setKind = (kind: 'request' | 'consultation') => {
      for (const message of view.messages) message.kind = kind;
    };
    setKind('consultation');
    await change(ctl);
    expect(text(q(page?.root as HTMLElement, '.hb-kind'))).toBe('consulta');

    // Someone else puts it back: the old tap no longer hides that.
    setKind('request');
    await change(ctl);
    expect(text(q(page?.root as HTMLElement, '.hb-kind'))).toBe('pedido');
  });
});

describe('following the foot after a link to a turn', () => {
  it('takes the link once, gives the address back, and then goes to a new message', async () => {
    window.localStorage.setItem('otea.motion', 'reduced');
    const grow = vi
      .spyOn(HTMLElement.prototype, 'scrollHeight', 'get')
      .mockImplementation(function (this: HTMLElement) {
        return this.classList.contains('hb-chat') ? 500 : 0;
      });
    const room = vi
      .spyOn(HTMLElement.prototype, 'clientHeight', 'get')
      .mockImplementation(function (this: HTMLElement) {
        return this.classList.contains('hb-chat') ? 500 : 0;
      });
    try {
      const view = conversation({
        messages: [
          say({ id: 1, author: 'person' }),
          say({ id: 2, author: 'secretary', root: 1, replyTo: 1 }),
        ],
      });
      server(view);
      const ctl = mountLive({}, { turn: 1 });
      await settle();
      expect(ctl.went).toEqual([{ view: 'hablar' }]);
      expect(q(page?.root as HTMLElement, '#hb-turn-1')?.hasAttribute('data-found')).toBe(true);
      const chat = q(page?.root as HTMLElement, '.hb-chat') as HTMLElement;
      expect(chat.scrollTop).toBe(0);

      // Once it has arrived the person is at the foot of a short talk: a new message follows.
      await act(async () => new Promise((resolve) => setTimeout(resolve, 1200)));
      view.messages.push(say({ id: 3, author: 'person' }));
      await change(ctl);
      expect(chat.scrollTop).toBe(500);
    } finally {
      grow.mockRestore();
      room.mockRestore();
      window.localStorage.removeItem('otea.motion');
    }
  });
});
