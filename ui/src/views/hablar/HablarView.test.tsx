// @vitest-environment happy-dom
import { act, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Pending } from '../../../../src/core/pending.ts';
import { type App, AppTestProvider } from '../../app/context.tsx';
import type { ConversationView, Message } from '../../conversation.ts';
import { ago, item, NOW } from '../../derive/fixtures.ts';
import { setLanguage } from '../../i18n/i18n.ts';
import { seenAtMount } from '../../kit/pop/toast.tsx';
import { testApp } from '../../shell/test-app.ts';
import { buttonNamed, type Mounted, mount, press, settle, typeInto } from '../../test-dom.tsx';
import type { Item } from '../../types.ts';
import { AskCard } from './Branch.tsx';
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
    action: null,
    unverified: false,
    optionText: [],
    closed: null,
    choice: null,
    heardAt: null,
    kindNews: false,
    ...o,
  };
}

const LISTENING = { name: 'quill', state: 'listening', since: null, pending: 0 } as const;

// What waits for the person: two reviews.
const yours: Pending = {
  count: 2,
  entries: [
    { kind: 'review', ref: 'CAM-2', title: 'Modo oscuro', since: ago(30) },
    { kind: 'review', ref: 'CAM-3', title: 'Borrar tarea', since: ago(20) },
  ],
  blocks: [],
  queues: [],
  secretary: null,
};

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
        // As the server does (store/conversation.ts): a turn holds all the words, in any of its messages.
        const words = search.toLowerCase().split(/\s+/);
        const turns = new Set(
          view.messages
            .filter((m) =>
              words.every((word) =>
                view.messages.some(
                  (other) => other.root === m.root && other.text.toLowerCase().includes(word),
                ),
              ),
            )
            .map((m) => m.root),
        );
        return json({ ...view, messages: view.messages.filter((m) => turns.has(m.root)) });
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

  // Field study 4 (design): «sec» and «tú» scrolled away with the first message, and the lanes
  // stopped mid-pane. The names stand over the thread, outside what scrolls.
  it('keeps the lanes’ names over the thread, outside what scrolls', async () => {
    const { root } = await open(conversation({ messages: request() }));

    const head = q(root, '.hb-head') as HTMLElement;
    expect(text(head)).toBe('sectú');
    expect(head.closest('.hb-chat')).toBeNull();
    expect(q(root, '.hb-chat .lane-head')).toBeNull();
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

  // U1 (field study 4): the chip that corrects a turn's kind sat on the secretary's answer once it
  // had answered, so it read as the answer's own. It is on what the person said, always.
  it('keeps the kind label on the person’s own message, never on the secretary’s reply', async () => {
    const { root } = await open(conversation({ messages: thread() }), { all: [working, queued] });

    expect(all(root, '.hb-row.you .hb-kind')).toHaveLength(2);
    expect(all(root, '.hb-row.secretary .hb-kind')).toHaveLength(0);
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

// U4 (field study 4): a change of mind on an item in review is one tap in Hablar, never a trip to
// the board: the card shows the note it will go back with, and the person's tap sends it.
describe('a card that sends an item back', () => {
  const card = () => [
    say({ id: 1, author: 'person', text: 'cambié de idea: déjalo en 404' }),
    say({
      id: 2,
      author: 'secretary',
      replyTo: 1,
      root: 1,
      text: '¿Devuelvo CAM-7 con tu cambio?',
      options: ['Devolver CAM-7', 'No'],
      action: {
        kind: 'send_back',
        item: 'CAM-7',
        note: 'Que dé 404 y solo cambie el mensaje.',
        round: 1,
        to: 'Hacerlo',
      },
    }),
  ];

  // What the first button does is said by Otea from the stored action, never by the label the
  // secretary gave it: a label written under an injected instruction cannot mislead.
  it('says what the first button does in Otea’s own words, from the action and not its label', async () => {
    const { root } = await open(
      conversation({
        messages: [
          say({ id: 1, author: 'person', text: 'cambié de idea' }),
          say({
            id: 2,
            author: 'secretary',
            replyTo: 1,
            root: 1,
            text: '¿Seguimos?',
            options: ['Aprobar CAM-9 ya', 'No'],
            action: { kind: 'send_back', item: 'CAM-7', note: 'x', round: 1, to: 'Hacerlo' },
          }),
        ],
      }),
    );

    expect(text(q(root, '.hb-does'))).toBe('Devuelve CAM-7 a Hacerlo con esta nota');
  });

  it('shows the note it goes back with, taps once to send it back, and never offers to leave the decision to the secretary', async () => {
    const { root, calls } = await open(conversation({ messages: card() }));

    expect(text(q(root, '.hb-note'))).toBe('Que dé 404 y solo cambie el mensaje.');
    expect(buttonNamed(root, 'Decide tú')).toBeUndefined();

    await press(all(root, '.hb-row.secretary .hb-opt')[0]);

    expect(calls.map(({ method, url, body }) => [method, url, body])).toEqual([
      ['POST', '/api/conversation/messages/2/answer', { option: 1 }],
    ]);
  });

  it('lets you edit the note first, and sends it back with your words', async () => {
    const { root, calls } = await open(conversation({ messages: card() }));

    await press(buttonNamed(root, 'Editar nota') as HTMLElement);
    const field = q(root, '.hb-own textarea') as HTMLTextAreaElement;
    expect(field.value).toBe('Que dé 404 y solo cambie el mensaje.');
    await typeInto(field, 'Mejor 410.');
    await press(buttonNamed(root, 'Devolver CAM-7 con esta nota') as HTMLElement);

    expect(calls.map(({ method, url, body }) => [method, url, body])).toEqual([
      ['POST', '/api/conversation/messages/2/answer', { option: 1, note: 'Mejor 410.' }],
    ]);
  });
});

// U8 (field study 4, the red-team persona): what the desk shows about what the secretary asks.
describe('a question that needs your words, a question that is over, a secretary that is silent', () => {
  const asked = (extra: Partial<Message> = {}) => [
    say({ id: 1, author: 'person', text: '¿qué hago con la cancha?' }),
    say({
      id: 2,
      author: 'secretary',
      replyTo: 1,
      root: 1,
      text: '¿Qué hago con la cancha?',
      options: ['Anótala', 'La explico al responder', 'Déjala'],
      optionText: [2],
      ...extra,
    }),
  ];

  it('opens the text box for an option that needs your words, and sends them with the option', async () => {
    const { root, calls } = await open(conversation({ messages: asked() }));

    await press(all(root, '.hb-row.secretary .hb-opt')[1]);
    // Nothing was sent by the tap.
    expect(calls).toHaveLength(0);
    const field = q(root, '.hb-own textarea') as HTMLTextAreaElement;
    await typeInto(field, 'Solo la de abajo.');
    await press(buttonNamed(root, 'Enviar respuesta') as HTMLElement);

    expect(calls.map(({ method, url, body }) => [method, url, body])).toEqual([
      ['POST', '/api/conversation/messages/2/answer', { option: 2, explain: 'Solo la de abajo.' }],
    ]);
  });

  it('answers at once an option that needs no words', async () => {
    const { root, calls } = await open(conversation({ messages: asked() }));

    await press(all(root, '.hb-row.secretary .hb-opt')[0]);

    expect(calls.map(({ body }) => body)).toEqual([{ option: 1 }]);
  });

  it('has no buttons once the secretary took the question back, and says so', async () => {
    const { root } = await open(
      conversation({
        messages: asked({ closed: { at: ago(1), why: 'withdrawn' } }),
      }),
    );

    expect(q(root, '.hb-opt')).toBeNull();
    expect(text(q(root, '.hb-closed'))).toContain('retiró esta pregunta');
  });

  it('marks a message of the secretary that Otea could not tie to its session', async () => {
    const { root } = await open(
      conversation({
        messages: [
          say({ id: 1, author: 'person', text: 'hola' }),
          say({
            id: 2,
            author: 'secretary',
            replyTo: 1,
            root: 1,
            text: 'Aprobé todo.',
            unverified: true,
          }),
          say({ id: 3, author: 'secretary', replyTo: 1, root: 1, text: 'Hecho.' }),
        ],
      }),
    );

    const marks = all(root, '.hb-unverified');
    expect(marks).toHaveLength(1);
    expect(text(marks[0])).toBe('sin verificar');
  });

  // R2 (field study 4, V7): the why was a tooltip, which a phone cannot open. A tap on the mark
  // says it in words, under the message's head, and a second tap puts it away.
  it('says why in words when the mark is tapped, which a tooltip never did on a phone', async () => {
    const { root } = await open(
      conversation({
        messages: [
          say({ id: 1, author: 'person', text: 'hola' }),
          say({
            id: 2,
            author: 'secretary',
            replyTo: 1,
            root: 1,
            text: 'Aprobé todo.',
            unverified: true,
          }),
        ],
      }),
    );
    const mark = q(root, '.hb-unverified') as HTMLElement;
    expect(q(root, '.hb-unverified-why')).toBeNull();
    expect(mark.getAttribute('aria-expanded')).toBe('false');

    await press(mark);

    expect(text(q(root, '.hb-unverified-why'))).toContain('no pudo atar este mensaje');
    expect(mark.getAttribute('aria-expanded')).toBe('true');
    await press(mark);
    expect(q(root, '.hb-unverified-why')).toBeNull();
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
      'Trabajador de Cambios: pégalo en una sesión nueva.',
    );
    expect(blocks[0]?.querySelector('pre')?.textContent).toBe(first);
    await press(buttonNamed(blocks[1] as HTMLElement, 'Copiar'));
    expect(written).toEqual(['Eres el refinador.']);
  });

  // The badge is the number the secretary gave the session, whatever its place in the message; a
  // caption with only the number says what the block is without repeating it.
  it("shows the secretary's own number on the badge, and a generic label for a bare one", async () => {
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
              'Abre 2 sesiones.',
              '3. Refinador:',
              '```',
              'a',
              '```',
              '4.',
              '```',
              'b',
              '```',
            ].join('\n'),
          }),
        ],
      }),
    );
    const blocks = all(root, '.hb-block');
    expect(blocks.map((block) => text(q(block, '.hb-bn')))).toEqual(['3', '4']);
    expect(text(q(blocks[0] as HTMLElement, '.hb-bcap'))).toBe('Refinador:');
    expect(text(q(blocks[1] as HTMLElement, '.hb-bcap'))).toBe('Texto para pegar');
  });

  // Field study 3 review: a snippet in an ordinary reply is its code, with the lead sentence kept.
  it('keeps the lead sentence of a reply with code, and draws the code as code', async () => {
    const { root } = await open(
      conversation({
        messages: [
          say({ id: 1, author: 'person' }),
          say({
            id: 2,
            author: 'secretary',
            replyTo: 1,
            root: 1,
            text: 'Corre esto y dime qué sale:\n```sh\nnpm test\n```',
          }),
        ],
      }),
    );
    expect(text(q(root, '.hb-bluf'))).toBe('Corre esto y dime qué sale:');
    expect(all(root, '.hb-block')).toHaveLength(0);
    expect(text(q(root, 'pre.hb-code'))).toBe('npm test');
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
  const read = [
    say({
      id: 1,
      author: 'person',
      delivery: 'read',
      readAt: ago(0),
      text: '¿Tailscale o el relay?',
    }),
  ];

  // At work between two waits: it is not in its wait, so it may be holding the message.
  const working = { name: 'quill', state: 'connected' as const, since: null, pending: 0 };

  it('says «leído · pensando…» on its lane while it holds a turn it read and has not answered', async () => {
    const { root } = await open(conversation({ messages: read, secretary: working }));
    expect(text(q(root, '.hb-thinking'))).toBe('leído · pensando…');
    expect(q(root, '.nd.secretary[data-busy]')).not.toBeNull();
  });

  // U6 (field study 4): «escuchando» and «leído · pensando…» for twenty minutes. A secretary in its
  // wait holds nothing: its wait brings the message back, and if it has not, the desk says so.
  it('never says «pensando…» to a secretary that listens, and says it has not answered once it stays', async () => {
    const listening = { name: 'quill', state: 'listening' as const, since: null, pending: 0 };
    const { root } = await open(
      conversation({
        messages: [
          say({
            id: 1,
            author: 'person',
            delivery: 'read',
            readAt: ago(0.5),
            heardAt: ago(0.5),
            text: '¿Tailscale o el relay?',
          }),
        ],
        secretary: listening,
      }),
    );
    expect(q(root, '.hb-thinking .bar')).toBeNull();
    expect(text(q(root, '.hb-silent'))).toContain('El secretario no ha respondido aún.');
  });

  // The secretary's wait returned the message: the person sees it arrived at once, before it is read.
  it('says it at once when the wait only heard the message, without calling it waiting', async () => {
    const { root } = await open(
      conversation({
        messages: [say({ id: 1, author: 'person', delivery: 'pending', heardAt: ago(0) })],
        secretary: working,
      }),
    );
    expect(text(q(root, '.hb-thinking'))).toBe('leído · pensando…');
    expect(q(root, '.hb-who .hb-pend')).toBeNull();
  });

  // U8 (field study 4): ten minutes of «pensando…» on an answer that never came.
  it('says it has not answered yet, and what to do, once it held the message for a few minutes', async () => {
    const { root } = await open(
      conversation({
        messages: [
          say({
            id: 1,
            author: 'person',
            delivery: 'read',
            readAt: ago(9),
            text: '¿Qué me espera hoy?',
          }),
        ],
      }),
    );

    expect(text(q(root, '.hb-silent'))).toContain('El secretario no ha respondido aún.');
    expect(text(q(root, '.hb-silent'))).toContain('Tu mensaje se guarda');
    expect(q(root, '.hb-thinking .bar')).toBeNull();
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
    const away = q(root, '.hb-away') as HTMLElement;
    await press(q(away, '.hb-away-toggle'));
    expect(text(away)).toContain('otea wait --secretary --as quill');
    expect(text(away)).toContain('otea prompt --role secretary --as quill');
  });

  // H3 (field study 4, U2 and U7 on the phone): the notice gave a terminal command and no way to
  // copy what restarts it. The restart is on the computer: say so plainly, give the text to copy
  // (the one the first run has), keep the commands as the second way, and say the messages wait.
  it('says the restart is on the computer, copies the secretary text, and keeps the commands behind a fold', async () => {
    const written: string[] = [];
    vi.stubGlobal('navigator', {
      ...navigator,
      clipboard: { writeText: async (words: string) => void written.push(words) },
    });
    const { root } = await open(
      conversation({
        messages: read,
        secretary: { name: 'quill', state: 'offline', since: ago(240), pending: 1 },
        waiting: { count: 1, since: ago(120) },
      }),
    );
    const away = q(root, '.hb-away') as HTMLElement;

    // The line has «Copiar» (the text that brings it back) without opening anything.
    await press(buttonNamed(away, 'Copiar'));
    expect(written).toEqual(['Eres el secretario de este proyecto.']);
    // Where it restarts, and the commands as the second way, folded: words first.
    expect(text(away)).not.toContain('en tu equipo');
    await press(q(away, '.hb-away-toggle'));
    expect(text(away)).toContain('en tu equipo');
    expect(text(away)).toContain('Tus mensajes se guardan');
    expect(q(away, 'details')?.hasAttribute('open')).toBe(false);
  });

  // Field study 6 (D-e1d814): a button that only changes its own words is not heard to have worked.
  // The copy is said in a live region beside it.
  it('says in a live region that the secretary text was copied', async () => {
    vi.stubGlobal('navigator', {
      ...navigator,
      clipboard: { writeText: async () => undefined },
    });
    const { root } = await open(
      conversation({
        messages: read,
        secretary: { name: 'quill', state: 'offline', since: ago(240), pending: 1 },
        waiting: { count: 1, since: ago(120) },
      }),
    );
    const away = q(root, '.hb-away') as HTMLElement;
    const say = () => text(q(away, '[role="status"].hb-copied'));
    expect(say()).toBe('');

    await press(buttonNamed(away, 'Copiar'));
    expect(say()).toBe('Copiado');
  });

  // Field study 4 (design): a card for the secretary, another for what waits and a sliver of chat.
  // The two are one quiet line over the lanes, on the desk and on the phone alike: a dot, one
  // sentence, «Copiar», and what waits for you; a tap opens the rest under it.
  it('is one quiet line on the desk and the phone, holding «Te espera» under it', async () => {
    const view = conversation({
      messages: read,
      secretary: { name: 'quill', state: 'offline', since: ago(240), pending: 2 },
      waiting: { count: 2, since: ago(120) },
    });
    for (const phone of [false, true]) {
      const { root } = await open(view, { phone, pending: yours });
      const away = q(root, '.hb-away') as HTMLElement;
      const toggle = q<HTMLButtonElement>(away, '.hb-away-toggle') as HTMLButtonElement;
      expect(q(root, '.hb-te')).toBeNull();
      expect(text(q(away, '.hb-away-full'))).toBe(
        'Tu secretario está desconectado · 2 mensajes esperan',
      );
      expect(toggle.getAttribute('aria-expanded')).toBe('false');
      expect(buttonNamed(away, 'Copiar')).toBeDefined();
      expect(q(away, '.hb-te-row')).toBeNull();
      // What waits for you is counted on the line, listed once it opens.
      expect(text(q(away, '.hb-te-n'))).toContain('2');
      await press(toggle);
      expect(toggle.getAttribute('aria-expanded')).toBe('true');
      expect(text(away)).toContain('Modo oscuro');
      page?.unmount();
    }
  });

  // Field study 5 (D2): a phone with no PC and the secretary away showed the pill, a card saying so,
  // «sol está conectado» (the last it had kept, for a PC out of reach), the secretary's strip and a
  // footnote under the composer, and «queda en cola» beside «podrás escribir cuando vuelva». The
  // offline line over the page (the app's, not this view's) says it; nothing here repeats it or
  // says what the phone cannot know.
  it('on a phone without the PC says nothing about the secretary, and nothing twice', async () => {
    const view = conversation({
      messages: read,
      secretary: { name: 'quill', state: 'offline', since: ago(240), pending: 2 },
      waiting: { count: 2, since: ago(120) },
    });
    const offline = { offline: true, syncedAt: NOW };

    const phone = await open(view, { phone: true, pending: yours, sync: offline });
    expect(q(phone.root, '.hb-away')).toBeNull();
    expect(q(phone.root, '.hb-status')).toBeNull();
    // The writing box says it is closed, in its own words; no note under it.
    expect(q<HTMLTextAreaElement>(phone.root, '.hb-input textarea')?.placeholder).toBe(
      'Podrás escribir al volver',
    );
    expect(q(phone.root, '.hb-note')).toBeNull();
    // What waits for you is still there (it is read, not written, so it works from what was kept).
    expect(q(phone.root, '.hb-te')).not.toBeNull();
    page?.unmount();

    // The desk has room for both lines and keeps them.
    const desk = await open(view, { phone: false, pending: yours, sync: offline });
    expect(q(desk.root, '.hb-away')).not.toBeNull();
    expect(text(q(desk.root, '.hb-note'))).toContain('podrás escribir cuando vuelva');
  });

  it('says the secretary is connected only while the PC answers, on the phone', async () => {
    const view = conversation({
      messages: read,
      secretary: { name: 'quill', state: 'connected', since: null, pending: 0 },
    });
    const live = await open(view, { phone: true });
    expect(text(q(live.root, '.hb-status'))).toContain('quill está conectado');
    page?.unmount();
    const kept = await open(view, { phone: true, sync: { offline: true, syncedAt: NOW } });
    expect(q(kept.root, '.hb-status')).toBeNull();
  });

  // R2 (field study 4, V4): the desk told a person already at the computer that the secretary
  // «se reinicia en tu equipo, no desde aquí». That is for the phone; the desk says where to paste.
  it('says where the secretary restarts in words that fit where you are', async () => {
    const view = conversation({
      messages: read,
      secretary: { name: 'quill', state: 'offline', since: ago(240), pending: 2 },
      waiting: { count: 2, since: ago(120) },
    });
    const how = async (phone: boolean) => {
      const { root } = await open(view, { phone, pending: yours });
      await press(q(root, '.hb-away-toggle') as HTMLElement);
      const words = text(q(root, '.hb-back'));
      page?.unmount();
      return words;
    };
    expect(await how(true)).toContain('no desde aquí');
    const desk = await how(false);
    // Still the computer's, since that is where it restarts; never «not from here», which is where
    // the person already is.
    expect(desk).not.toContain('no desde aquí');
    expect(desk).toContain('en tu equipo');
    expect(desk).toContain('pégale este texto');
  });

  it('is the line «Te espera» alone while the secretary is there', async () => {
    const { root } = await open(conversation({ messages: read }), { pending: yours });
    expect(q(root, '.hb-away')).toBeNull();
    expect(q(root, '.hb-te')).not.toBeNull();
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

  // Field study 7: on the phone the keyboard stayed up after Enviar and covered the nav and the
  // composer. A send that landed puts the keyboard away on a touch device, and keeps the focus on
  // the desk, where the next message is typed at once.
  it.each([
    [true, false],
    [false, true],
  ])('after a send that landed, phone %s: the field keeps the focus %s', async (phone, kept) => {
    server(conversation());
    page = mount(
      <AppTestProvider value={testApp({ now: NOW, phone })}>
        <HablarView />
      </AppTestProvider>,
    );
    await settle();
    const root = page.root;
    const field = q<HTMLTextAreaElement>(root, '.hb-input textarea') as HTMLTextAreaElement;
    await typeInto(field, 'Hola');
    field.focus();
    expect(document.activeElement).toBe(field);

    await press(q(root, '.hb-send'));

    expect(field.value).toBe('');
    expect(document.activeElement === field).toBe(kept);
  });

  it('keeps the focus, and the keyboard, when the send failed: the words are still there', async () => {
    server(conversation(), { failures: 1 });
    page = mount(
      <AppTestProvider value={testApp({ now: NOW, phone: true })}>
        <HablarView />
      </AppTestProvider>,
    );
    await settle();
    const root = page.root;
    const field = q<HTMLTextAreaElement>(root, '.hb-input textarea') as HTMLTextAreaElement;
    await typeInto(field, 'Hola');
    field.focus();

    await press(q(root, '.hb-send'));

    expect(field.value).toBe('Hola');
    expect(document.activeElement).toBe(field);
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
    expect(text(q(root, '.hb-note'))).toContain('Sin conexión: podrás escribir cuando vuelva');
  });
});

// Field study 6 (D-6c3c31): the label flipped a request into a consultation with one tap on a chip
// the size of a word. A tap on it opens the two kinds; the change is the choice, never the tap.
const menuItem = (word: string) =>
  [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
    (el) => el.textContent?.trim() === word,
  );
async function pickKind(label: Element | null | undefined, word: string) {
  await press(label);
  await press(menuItem(word));
}

describe('correcting what a turn is', () => {
  it('asks which kind on a tap on its label, and changes nothing until one is chosen', async () => {
    const { root, calls } = await open(conversation({ messages: request() }));
    const label = q(root, '.hb-kind') as HTMLElement;
    expect(label.getAttribute('aria-haspopup')).toBe('menu');

    await press(label);

    expect(calls).toEqual([]);
    expect(text(q(root, '.hb-kind'))).toBe('pedido');
    expect(menuItem('pedido')?.classList.contains('on')).toBe(true);
    expect(menuItem('consulta')).toBeDefined();

    // Choosing the kind it already is leaves it as it was.
    await press(menuItem('pedido'));
    expect(calls).toEqual([]);
  });

  it('turns a request into a consultation by choosing it from the label’s menu', async () => {
    const { root, calls } = await open(conversation({ messages: request() }));
    const label = q(root, '.hb-kind') as HTMLElement;
    expect(text(label)).toBe('pedido');

    await pickKind(label, 'consulta');

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

    await pickKind(labels[1], 'pedido');

    expect(seenAtMount()).toBeGreaterThan(before);
  });
});

// R2 (field study 4, U3): a turn the secretary answered without classifying it stayed out of «Lo que
// salió»; it shows there as «sin clasificar», titled by what the person said, and one tap says what it is.
describe('a turn nobody classified', () => {
  const unsorted = () => [
    say({ id: 1, author: 'person', text: 'Dime cuánto tarda el envío a Mendoza' }),
    say({ id: 2, author: 'secretary', replyTo: 1, root: 1, text: 'Dos días hábiles.' }),
  ];

  it('is in «Lo que salió» with its words, and a tap on «pedido» marks it', async () => {
    const { root, calls } = await open(conversation({ messages: unsorted() }));
    const card = q(root, '.hb-card') as HTMLElement;
    expect(text(q(card, '.hb-kind.static'))).toBe('sin clasificar');
    expect(text(q(card, '.hb-ct'))).toBe('Dime cuánto tarda el envío a Mendoza');

    await press(q(card, '.hb-sort .hb-kind[data-kind="request"]'));

    expect(calls).toEqual([
      expect.objectContaining({
        method: 'POST',
        url: '/api/conversation/messages/1/kind',
        body: { kind: 'request' },
      }),
    ]);
    // It shows as the person set it at once: the sort buttons are gone, the label says request.
    expect(q(root, '.hb-card .hb-sort')).toBeNull();
    expect(text(q(root, '.hb-card .hb-kind.static'))).toBe('pedido');
  });
});

describe('the secretary away, or never there', () => {
  it('says that it is away, how many messages wait, and since when', async () => {
    const { root } = await open(
      conversation({
        messages: [say({ id: 1, author: 'person', delivery: 'pending' })],
        secretary: { name: 'quill', state: 'offline', since: ago(240), pending: 2 },
        waiting: { count: 2, since: ago(120) },
      }),
    );
    expect(text(q(root, '.hb-away-full'))).toBe(
      'Tu secretario está desconectado · 2 mensajes esperan',
    );
    // Since when, and that the messages are kept, once the line is opened.
    await press(q(root, '.hb-away-toggle'));
    expect(text(q(root, '.hb-away-since'))).toMatch(
      /^Tu secretario está desconectado desde .+\. Tus mensajes se guardan hasta que vuelva\./,
    );
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
    await typeInto(q(root, '.hb-search input'), 'tablero cliente');
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

  // H3 (field study 4, U5): a message that was only a screenshot read «salió de Hablar · «»».
  it('names a turn that was only an attachment, never empty quotes', () => {
    page = mount(
      <FromTurns turns={[{ id: 7, at: ago(5), author: 'person', kind: 'request', snippet: '' }]} />,
    );
    const link = q<HTMLAnchorElement>(page.root, 'a');
    expect(link?.textContent).toBe('salió de Hablar · tu archivo adjunto');
    expect(link?.textContent).not.toContain('«»');
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

// The page reads the conversation again at most every 1.5 s as the project changes: a second change
// waits for the window.
const pastTheWindow = () => act(async () => new Promise((resolve) => setTimeout(resolve, 1600)));

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
    await pickKind(q(page.root, '.hb-kind'), 'consulta');

    expect(calls).toHaveLength(1);
    expect(text(q(page.root, '.hb-kind'))).toBe('pedido');
  });

  it('stops overriding once the server says the same, so its later change shows', async () => {
    const view = conversation({ messages: request() });
    server(view);
    const ctl = mountLive();
    await settle();
    await pickKind(q(page?.root as HTMLElement, '.hb-kind'), 'consulta');
    expect(text(q(page?.root as HTMLElement, '.hb-kind'))).toBe('consulta');

    const setKind = (kind: 'request' | 'consultation') => {
      for (const message of view.messages) message.kind = kind;
    };
    setKind('consultation');
    await change(ctl);
    expect(text(q(page?.root as HTMLElement, '.hb-kind'))).toBe('consulta');

    // Someone else puts it back: the old tap no longer hides that.
    setKind('request');
    await pastTheWindow();
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

// G3 (cold review of the desk): the conversation's page-by-page reads, the search, the composer's
// suggestions, a question card that is asked twice, and the tabs.

// A server whose conversation has earlier pages (`more`), a `before` read that can fail, and a
// search that holds or fails: every GET of the conversation recorded with its query.
function paged(
  view: ConversationView,
  o: {
    before?: 'fail';
    search?: (words: string) => Message[] | 'fail' | Promise<Message[]>;
  } = {},
) {
  const reads: URLSearchParams[] = [];
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    const url = new URL(String(input instanceof Request ? input.url : input), 'http://x');
    const json = (value: unknown, status = 200) =>
      new Response(JSON.stringify(value), {
        status,
        headers: { 'content-type': 'application/json' },
      });
    if (!url.pathname.endsWith('/conversation')) return json({ error: { code: 'not_found' } }, 404);
    reads.push(url.searchParams);
    const words = url.searchParams.get('search');
    if (words !== null) {
      const found = await o.search?.(words);
      if (found === 'fail') return json({ error: { code: 'down' } }, 500);
      return json({ ...view, messages: found ?? [] });
    }
    if (url.searchParams.has('before') && o.before === 'fail') {
      return json({ error: { code: 'down' } }, 500);
    }
    return json(view);
  });
  return reads;
}

describe('a link to a turn that is on an earlier page', () => {
  it('reads the earlier page once, gives up when it fails, and leaves the button to try again', async () => {
    const reads = paged(conversation({ messages: request(), more: true }), { before: 'fail' });
    const ctl: Live = { bump: () => undefined, went: [] };
    page = mount(<Live ctl={ctl} route={{ turn: 999 }} app={{}} />);
    await settle();
    await settle();

    expect(reads.filter((read) => read.has('before'))).toHaveLength(1);
    // The address is the conversation's again, and the person can ask for the page themselves.
    expect(ctl.went).toEqual([{ view: 'hablar' }]);
    expect(q(page.root, '.hb-earlier')?.hasAttribute('disabled')).toBe(false);
  });
});

describe('searching what was said', () => {
  const old = say({ id: 50, author: 'person', text: 'un backoff exponencial para los reintentos' });

  it('opens a hit that is on an earlier page through the turn’s address, so the page is read', async () => {
    paged(conversation({ messages: request(), more: true }), { search: () => [old] });
    const ctl: Live = { bump: () => undefined, went: [] };
    page = mount(<Live ctl={ctl} route={{}} app={{}} />);
    await settle();

    await typeInto(q(page.root, '.hb-search input'), 'backoff');
    await vi.waitFor(() => expect(all(page?.root as HTMLElement, '.hb-hit')).toHaveLength(1));
    await press(q(page.root, '.hb-hit button'));

    expect(ctl.went).toEqual([{ view: 'hablar', turn: 50 }]);
  });

  it('says it is searching while the answer is on its way, never that nothing says it', async () => {
    let release: (found: Message[]) => void = () => undefined;
    paged(conversation({ messages: request() }), {
      search: () =>
        new Promise<Message[]>((resolve) => {
          release = resolve;
        }),
    });
    page = mount(
      <AppTestProvider value={testApp({ now: NOW })}>
        <HablarView />
      </AppTestProvider>,
    );
    await settle();
    await typeInto(q(page.root, '.hb-search input'), 'backoff');
    await act(async () => new Promise((resolve) => setTimeout(resolve, 400)));

    expect(text(q(page.root, '.hb-none'))).toBe('Buscando…');

    release([old]);
    await vi.waitFor(() => expect(all(page?.root as HTMLElement, '.hb-hit')).toHaveLength(1));
    expect(q(page.root, '.hb-none')).toBeNull();
  });

  it('says the search failed when the PC refuses it, and that nothing was said when it answers none', async () => {
    paged(conversation({ messages: request() }), { search: () => 'fail' });
    page = mount(
      <AppTestProvider value={testApp({ now: NOW })}>
        <HablarView />
      </AppTestProvider>,
    );
    await settle();
    await typeInto(q(page.root, '.hb-search input'), 'backoff');
    await vi.waitFor(() =>
      expect(text(q(page?.root as HTMLElement, '.hb-none'))).toContain('No se pudo buscar'),
    );
    expect(text(q(page.root, '.hb-none'))).not.toContain('Nada de lo dicho');
    page.unmount();

    paged(conversation({ messages: request() }), { search: () => [] });
    page = mount(
      <AppTestProvider value={testApp({ now: NOW })}>
        <HablarView />
      </AppTestProvider>,
    );
    await settle();
    await typeInto(q(page.root, '.hb-search input'), 'backoff');
    await vi.waitFor(() =>
      expect(text(q(page?.root as HTMLElement, '.hb-none'))).toContain('Nada de lo dicho'),
    );
  });
});

describe('the composer’s suggestions', () => {
  it('add to what you were writing instead of wiping it', async () => {
    const { root } = await open(conversation());
    const field = q<HTMLTextAreaElement>(root, '.hb-input textarea');
    await typeInto(field, 'Mañana revisamos el tablero');

    await press(all(root, '.hb-sugg')[1]);

    expect(field?.value).toBe('Mañana revisamos el tablero Resúmeme lo que se hizo');
  });
});

// An agent's question card whose item the test replaces: the feed brings a new question.
function Asked({ first, ctl }: { first: Item; ctl: { next: (it: Item) => void } }) {
  const [it, setIt] = useState(first);
  ctl.next = setIt;
  return <AskCard item={it} />;
}

describe('a question of an agent that is asked again', () => {
  const ask = (question: number, text: string) =>
    item({
      id: 'CAM-14',
      turn: 'human',
      asks: { question, by: 'worker', text, at: ago(3), options: ['Sí', 'No'], recommended: 1 },
    });

  it('shows its buttons again for the new question, not what you answered before', async () => {
    const ctl: { next: (it: Item) => void } = { next: () => undefined };
    page = mount(
      <AppTestProvider value={testApp({ now: NOW })}>
        <Asked first={ask(2, '¿Lo pruebo en tablet?')} ctl={ctl} />
      </AppTestProvider>,
    );
    await settle();
    await press(q(page.root, '.hb-opt'));
    expect(text(q(page.root, '.hb-said'))).toContain('Respondiste: Sí');

    await act(async () => ctl.next(ask(3, '¿Y en un celular chico?')));

    expect(q(page.root, '.hb-said')).toBeNull();
    expect(all(page.root, '.hb-opt')).toHaveLength(2);
  });
});

describe('the kind of a turn whose last message says none', () => {
  it('stops overriding once the server says the same for the messages that carry a kind', async () => {
    const view = conversation({
      messages: [
        ...request(),
        // A follow-up the person wrote has no kind of its own: the turn's kind is the last one set.
        say({ id: 3, author: 'person', root: 1, replyTo: 2, kind: null }),
      ],
    });
    server(view);
    const ctl = mountLive();
    await settle();
    await pickKind(q(page?.root as HTMLElement, '.hb-kind'), 'consulta');
    expect(text(q(page?.root as HTMLElement, '.hb-kind'))).toBe('consulta');

    for (const message of view.messages) if (message.kind !== null) message.kind = 'consultation';
    await change(ctl);
    // Someone else puts it back: the old tap no longer hides that.
    for (const message of view.messages) if (message.kind !== null) message.kind = 'request';
    await pastTheWindow();
    await change(ctl);
    expect(text(q(page?.root as HTMLElement, '.hb-kind'))).toBe('pedido');
  });
});

describe('the tabs of Hablar', () => {
  it('move with the arrow keys, and each names the part it shows', async () => {
    const { root } = await open(conversation());
    const [chat, out] = all(root, '[role=tab]') as [HTMLElement, HTMLElement];
    for (const tab of [chat, out]) {
      const target = tab.getAttribute('aria-controls');
      expect(target).not.toBeNull();
      expect(document.getElementById(target ?? '')).not.toBeNull();
    }
    expect(chat.getAttribute('tabindex')).toBe('0');
    expect(out.getAttribute('tabindex')).toBe('-1');

    await act(async () => {
      chat.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    });
    expect(out.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(out);

    await act(async () => {
      out.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    });
    expect(chat.getAttribute('aria-selected')).toBe('true');
  });
});

describe('reading the conversation again', () => {
  it('follows a burst of changes with one read, like the pending list', async () => {
    const reads = paged(conversation({ messages: request() }));
    const ctl: Live = { bump: () => undefined, went: [] };
    page = mount(<Live ctl={ctl} route={{}} app={{}} />);
    await settle();
    const first = reads.length;

    for (let i = 0; i < 5; i += 1) await change(ctl);

    // The first change goes through at once; the rest wait for the window and land as one.
    expect(reads.length - first).toBeLessThanOrEqual(1);
  });
});

// Pilot 1 (a1, a2): Hablar read by a screen reader and driven by the keys alone.
describe('Hablar for assistive technology', () => {
  const longReply = [
    'Listo: lo dejé en tres pasos.',
    'Primero revisé la barra de abajo.',
    'Luego medí el botón a 390 px.',
    'Después probé el modo oscuro.',
    'Y por último el modo claro.',
  ].join('\n');

  it('sets each message as an article whose heading says who spoke and when', async () => {
    const { root } = await open(conversation({ messages: request() }));

    const articles = all(root, 'article.hb-turn');
    expect(articles).toHaveLength(2);
    const names = articles.map((article) => {
      const heading = q(article, 'h2');
      expect(heading?.id).toBeTruthy();
      expect(article.getAttribute('aria-labelledby')).toBe(heading?.id);
      return text(heading);
    });
    expect(names[0]).toMatch(/^tú, /);
    expect(names[1]).toMatch(/^secretario, /);
  });

  it('tells two questions of the same words apart by the item they are about', async () => {
    const same = (id: string) =>
      item({
        id,
        title: `Paso ${id}`,
        turn: 'human',
        asks: {
          question: 2,
          by: 'worker',
          text: '¿Cómo seguimos?',
          at: ago(3),
          options: ['Así', 'Asá'],
        },
      });
    const { root } = await open(conversation({ messages: request(['CAM-3', 'CAM-4']) }), {
      all: [same('CAM-3'), same('CAM-4')],
    });

    const names = all(root, 'fieldset.hb-ask').map((card) => card.getAttribute('aria-label'));
    expect(names).toEqual(['¿Cómo seguimos? · CAM-3', '¿Cómo seguimos? · CAM-4']);
  });

  it('says what each «ver más» opens', async () => {
    const { root } = await open(
      conversation({
        messages: [
          say({ id: 1, author: 'person' }),
          say({ id: 2, author: 'secretary', replyTo: 1, root: 1, text: longReply }),
          say({ id: 3, author: 'person', text: 'otra' }),
          say({
            id: 4,
            author: 'secretary',
            replyTo: 3,
            root: 3,
            text: `Otra respuesta.\n${longReply}`,
          }),
        ],
      }),
    );

    const toggles = all(root, '.hb-toggle');
    expect(toggles.map((toggle) => toggle.getAttribute('aria-label'))).toEqual([
      'ver más: Listo: lo dejé en tres pasos.',
      'ver más: Otra respuesta.',
    ]);
    // What a sighted person reads stays the two words.
    expect(toggles.map((toggle) => text(toggle))).toEqual(['ver más', 'ver más']);
  });

  // The secretary going away and coming back is said, once and politely, by a status the page keeps.
  it('keeps one polite status that says whether the secretary is there', async () => {
    const away = await open(
      conversation({
        messages: request(),
        secretary: { name: 'quill', state: 'offline', since: ago(5), pending: 0 },
      }),
    );
    const status = (root: HTMLElement) =>
      all(root, '.hb-main > [role="status"]').map((el) => text(el));
    expect(status(away.root)).toEqual(['quill está desconectado']);
    page?.unmount();

    const back = await open(conversation({ messages: request() }));
    // Listening and working are both «connected»: only going and coming are news.
    expect(status(back.root)).toEqual(['quill está conectado']);
  });
});
