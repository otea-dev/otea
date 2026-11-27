// @vitest-environment happy-dom
import { act, StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type App, AppTestProvider } from '../../app/context.tsx';
import type { BandejaEntry } from '../../bandeja.ts';
import { NoteCapture } from '../../components/NoteCapture.tsx';
import { ago, item, NOW } from '../../derive/fixtures.ts';
import { setLanguage } from '../../i18n/i18n.ts';
import { testApp } from '../../shell/test-app.ts';
import { type Mounted, mount, press, settle, typeInto } from '../../test-dom.tsx';
import { Bandeja, useBandeja } from './Bandeja.tsx';
import { FromBandeja } from './FromBandeja.tsx';
import { HablarView } from './HablarView.tsx';

// The Bandeja as a person meets it: the quick note (text and files, no board form) that lands in
// it, and the list beside «Lo que salió» with each note's state, a question answered with a tap,
// and the item a note became.

function entry(o: Partial<BandejaEntry> & { id: number }): BandejaEntry {
  return {
    ref: `B-${o.id}`,
    text: 'El botón Aprobar queda tapado en el celu',
    at: ago(30),
    by: 'human',
    attachments: [],
    state: 'waiting',
    claimedBy: null,
    claimUntil: null,
    questions: [],
    asking: null,
    item: null,
    filedBy: null,
    filedAt: null,
    closedBy: null,
    closedAt: null,
    closeReason: null,
    ...o,
  };
}

// The Bandeja as Hablar draws it: its notes read by the page that holds it.
function Live({ lit }: { lit?: string }) {
  const notes = useBandeja();
  return <Bandeja {...notes} lit={lit} />;
}

type Call = { method: string; path: string; headers: Record<string, string>; body: unknown };

// The server as the page reaches it: the entries it reads, and every write with its headers.
// `failures`: how many sends it refuses before it hears one.
function server(entries: BandejaEntry[], o: { failures?: number } = {}) {
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
        return json({
          messages: [],
          more: false,
          secretary: null,
          waiting: { count: 0, since: null },
        });
      }
      return path.endsWith('/bandeja')
        ? json({ entries })
        : json({ error: { code: 'not_found' } }, 404);
    }
    calls.push({
      method,
      path,
      headers: (init.headers ?? {}) as Record<string, string>,
      body: init.body instanceof FormData ? init.body : JSON.parse(String(init.body)),
    });
    if (failures > 0) {
      failures -= 1;
      return json({ error: { code: 'down' } }, 503);
    }
    return json(entry({ id: 9 }), 201);
  });
  return calls;
}

let page: Mounted | undefined;

beforeEach(() => setLanguage('es'));
afterEach(() => {
  page?.unmount();
  page = undefined;
  vi.unstubAllGlobals();
  setLanguage('en');
});

const q = <T extends Element = HTMLElement>(root: HTMLElement, selector: string) =>
  root.querySelector<T>(selector);
const all = (root: HTMLElement, selector: string) => [
  ...root.querySelectorAll<HTMLElement>(selector),
];
const text = (el: Element | null | undefined) => el?.textContent?.replace(/\s+/g, ' ').trim();

async function show(node: React.ReactNode, app: Partial<App> = {}) {
  page = mount(<AppTestProvider value={testApp({ now: NOW, ...app })}>{node}</AppTestProvider>);
  await settle();
  return page.root;
}

describe('the quick note', () => {
  it('sends the words alone as JSON and clears the box, with a key that makes a resend one entry', async () => {
    const calls = server([]);
    const sent = vi.fn();
    const root = await show(<NoteCapture onSent={sent} />);

    // Nothing to send yet.
    expect(q<HTMLButtonElement>(root, '.bn-save')?.disabled).toBe(true);
    await typeInto(q(root, '.bn-text'), '  agregar modo oscuro  ');
    await press(q(root, '.bn-save'));

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      method: 'POST',
      path: '/api/bandeja',
      body: { text: 'agregar modo oscuro' },
    });
    expect(calls[0]?.headers['idempotency-key']).toMatch(/\S+/);
    expect(sent).toHaveBeenCalledTimes(1);
    expect(q<HTMLTextAreaElement>(root, '.bn-text')?.value).toBe('');
  });

  it('sends pictures and files with it as a form, and takes only what fits', async () => {
    const calls = server([]);
    const root = await show(<NoteCapture onSent={() => undefined} />);

    const input = q<HTMLInputElement>(root, 'input[type=file]');
    const files = [
      new File(['png'], 'captura.png', { type: 'image/png' }),
      new File(['pdf'], 'plan.pdf', { type: 'application/pdf' }),
    ];
    Object.defineProperty(input, 'files', { value: files });
    input?.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    expect(all(root, '.hb-drafts li').map((li) => text(li))).toEqual([
      expect.stringContaining('captura.png'),
      expect.stringContaining('plan.pdf'),
    ]);
    // Files alone are a capture.
    expect(q<HTMLButtonElement>(root, '.bn-save')?.disabled).toBe(false);
    await press(q(root, '.bn-save'));

    const body = calls[0]?.body as FormData;
    expect(body).toBeInstanceOf(FormData);
    expect(JSON.parse(String(body.get('message')))).toEqual({ text: '' });
    expect(body.getAll('file').map((file) => (file as File).name)).toEqual([
      'captura.png',
      'plan.pdf',
    ]);
  });

  it('keeps what you wrote when the send fails, says so, and sends again under the same key', async () => {
    const calls = server([], { failures: 1 });
    const sent = vi.fn();
    const root = await show(<NoteCapture onSent={sent} />);
    await typeInto(q(root, '.bn-text'), 'una idea');

    await press(q(root, '.bn-save'));
    expect(q(root, '.bn-err')?.textContent).toContain('No se anotó');
    expect(q<HTMLTextAreaElement>(root, '.bn-text')?.value).toBe('una idea');
    expect(sent).not.toHaveBeenCalled();

    await press(q(root, '.bn-save'));
    expect(sent).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(2);
    expect(calls[1]?.headers['idempotency-key']).toBe(calls[0]?.headers['idempotency-key']);
  });

  // G3: the words a failed send kept came back every time, with no way to be rid of them.
  it('lets you throw away what a failed send kept, and it does not come back', async () => {
    server([], { failures: 1 });
    let root = await show(<NoteCapture onSent={vi.fn()} />);
    await typeInto(q(root, '.bn-text'), 'una idea');
    await press(q(root, '.bn-save'));
    expect(q(root, '.bn-err')).not.toBeNull();

    // Closed and opened again: the words are back, and so is the way to discard them.
    page?.unmount();
    root = await show(<NoteCapture onSent={vi.fn()} />);
    expect(q<HTMLTextAreaElement>(root, '.bn-text')?.value).toBe('una idea');
    await press(q(root, '.bn-discard'));

    expect(q<HTMLTextAreaElement>(root, '.bn-text')?.value).toBe('');
    expect(q(root, '.bn-discard')).toBeNull();
    page?.unmount();
    root = await show(<NoteCapture onSent={vi.fn()} />);
    expect(q<HTMLTextAreaElement>(root, '.bn-text')?.value).toBe('');
  });

  it('still finishes a send under StrictMode, which mounts, unmounts and mounts it again', async () => {
    const calls = server([]);
    const sent = vi.fn();
    // StrictMode at the root, as main.tsx has it: React replays a mounted effect only from there.
    page = mount(
      <StrictMode>
        <AppTestProvider value={testApp({ now: NOW })}>
          <NoteCapture onSent={sent} />
        </AppTestProvider>
      </StrictMode>,
    );
    await settle();
    const root = page.root;
    await typeInto(q(root, '.bn-text'), 'una idea');

    await press(q(root, '.bn-save'));

    expect(calls).toHaveLength(1);
    // With the note's own id, for the toast that says where it went.
    expect(sent).toHaveBeenCalledWith('sent', 'B-9');
    expect(q<HTMLTextAreaElement>(root, '.bn-text')?.value).toBe('');
    expect(q<HTMLButtonElement>(root, '.bn-save')?.getAttribute('aria-busy')).not.toBe('true');
  });

  it('does not write for a browser that may only read', async () => {
    const calls = server([]);
    const root = await show(<NoteCapture onSent={() => undefined} />, {
      session: { canWrite: false, canConfigure: false, canManageDevices: false },
      // The field follows canCapture since a7a796d1 (a note goes to the queue while the computer
      // does not answer): a browser that may only read can capture nothing either.
      canCapture: false,
    });

    expect(q<HTMLTextAreaElement>(root, '.bn-text')?.disabled).toBe(true);
    expect(q<HTMLButtonElement>(root, '.bn-save')?.disabled).toBe(true);
    expect(calls).toEqual([]);
  });
});

describe('the Bandeja beside what came out', () => {
  const list = [
    entry({ id: 1, state: 'waiting', text: 'dark mode somewhere' }),
    entry({ id: 2, state: 'refining', claimedBy: 'lia', text: 'tablet layout' }),
    entry({
      id: 3,
      state: 'asking',
      text: 'make it better',
      asking: {
        question: 1,
        by: 'lia',
        at: ago(3),
        text: '¿Mejor en qué?',
        options: ['Más rápido', 'Más lindo'],
        recommended: 2,
      },
    }),
    entry({ id: 4, state: 'filed', item: 'CAM-12', text: 'Aprobar tapado' }),
  ];

  it('shows each note with its state: waiting, being refined, asking you, filed with a link to the item', async () => {
    server(list);
    const openItem = vi.fn();
    const root = await show(<Live />, { openItem, all: [item({ id: 'CAM-12' })] });

    const rows = all(root, '.bn-row');
    // What asks you comes first.
    expect(rows.map((row) => row.dataset.state)).toEqual([
      'asking',
      'waiting',
      'refining',
      'filed',
    ]);
    expect(text(q(rows[1] as HTMLElement, '.bn-st'))).toBe('esperando al secretario');
    expect(text(q(rows[2] as HTMLElement, '.bn-st'))).toBe('refinando · lia');
    expect(text(q(rows[0] as HTMLElement, '.bn-st'))).toBe('te pregunta');
    expect(text(q(rows[3] as HTMLElement, '.bn-st'))).toBe('archivado en CAM-12');

    await press(q(rows[3] as HTMLElement, 'button.bn-link'));
    expect(openItem).toHaveBeenCalledWith('CAM-12');
  });

  it('answers a question on a note with one tap on its option, and says what you answered', async () => {
    const calls = server(list);
    const root = await show(<Live />);

    const options = all(root, '.bn-row[data-state="asking"] .hb-opt');
    expect(options.map((option) => text(option))).toEqual(['Más rápido', 'Más lindorecomendada']);
    await press(options[1]);

    expect(calls).toEqual([
      expect.objectContaining({
        method: 'POST',
        path: '/api/bandeja/3/answer',
        body: { option: 2, question: 1 },
      }),
    ]);
    expect(text(q(root, '.bn-row[data-state="asking"] .hb-said'))).toContain(
      'Respondiste: Más lindo',
    );
  });

  // Field study 5, V2: an option that says «lo escribo en la respuesta» was sent as it read.
  it('opens the box for an option the refiner marked, or one that promises your words, and answers with both', async () => {
    const calls = server([
      entry({
        id: 6,
        state: 'asking',
        text: 'fechas',
        asking: {
          question: 1,
          by: 'lia',
          at: ago(3),
          text: '¿Qué fechas?',
          options: ['Las de siempre', 'Te escribo las fechas', 'Otra cosa'],
          optionText: [3],
        },
      }),
    ]);
    const root = await show(<Live />);

    const options = () => all(root, '.bn-row[data-state="asking"] .hb-opt');
    // The one the refiner marked: nothing is sent, the box opens.
    await press(options()[2]);
    expect(calls).toEqual([]);
    expect(all(root, '.bn-row textarea')).toHaveLength(1);
    await press(all(root, '.bn-row .hb-own .hb-foot button')[1]);
    // The one that only reads «te escribo…»: the same.
    await press(options()[1]);
    expect(calls).toEqual([]);
    await typeInto(q(root, '.bn-row textarea'), 'el 3 y el 4');
    await press(all(root, '.bn-row .hb-own .hb-foot button')[0]);
    expect(calls.at(-1)?.body).toMatchObject({ text: 'Te escribo las fechas — el 3 y el 4' });
  });

  it('leaves the decision to the refiner, or takes your own words', async () => {
    const calls = server(list);
    const root = await show(<Live />);

    await press(all(root, '.bn-row[data-state="asking"] .hb-foot button')[1]);

    expect(calls[0]?.body).toEqual({ delegate: true, question: 1 });
  });

  // Field study 3, S4: a duplicate the secretary closed says why, and you can reopen it.
  it('shows a closed note with the reason it was closed for, and reopens it with one tap', async () => {
    const calls = server([
      entry({ id: 1, state: 'waiting', text: 'dark mode somewhere' }),
      entry({
        id: 5,
        state: 'closed',
        text: 'el botón otra vez',
        closedBy: 'sol',
        closedAt: ago(5),
        closeReason: 'es lo mismo que CAM-1',
      }),
    ]);
    const root = await show(<Live />);

    const closed = q(root, '.bn-row[data-state="closed"]');
    expect(text(q(closed as HTMLElement, '.bn-st'))).toBe('cerrada: es lo mismo que CAM-1');
    await press(q(closed as HTMLElement, '.bn-reopen'));

    expect(calls).toEqual([
      expect.objectContaining({ method: 'POST', path: '/api/bandeja/5/reopen' }),
    ]);
  });

  it('is not there while the Bandeja is empty', async () => {
    server([]);
    const root = await show(<Live />);

    expect(q(root, '.bn-box')).toBeNull();
  });
});

describe('Hablar with the Bandeja', () => {
  const asking = entry({
    id: 3,
    state: 'asking',
    text: 'make it better',
    asking: { question: 1, by: 'lia', at: ago(3), text: '¿Mejor en qué?', options: ['a', 'b'] },
  });

  it('counts the notes that wait for your answer in the tab of what came out', async () => {
    server([entry({ id: 1 }), asking, entry({ id: 4, state: 'filed', item: 'CAM-1' })]);
    const root = await show(<HablarView />);

    const tabs = all(root, '[role=tab]').map((tab) => text(tab));
    // Nothing came out of the conversation yet; one note asks you. Waiting and filed notes do not
    // call for you.
    expect(tabs).toEqual(['Conversación', 'Lo que salió · 1']);
  });

  // F4 review round: one question, one place to answer it. The thread's foot is where you answer
  // while the thread shows; the list beside it only says where the question stands.
  it('answers a note’s question in the thread, and the list only points down to it', async () => {
    server([asking]);
    const root = await show(<HablarView />);

    expect(all(root, '.hb-turn[data-k="note-asks"] .hb-opt')).toHaveLength(2);
    expect(all(root, '.bn-row .hb-opt')).toHaveLength(0);
    expect(text(q(root, '.bn-row'))).toContain('te pregunta');
    expect(text(q(root, '.bn-row'))).toContain('responde abajo');
  });

  it('never has two forms for one question: with the thread hidden the list holds the form', async () => {
    server([asking]);
    const root = await show(<HablarView bandeja="B-3" />);

    // Opened at the note (the narrow tab of what came out): the thread is not what shows.
    expect(all(root, '.hb-turn[data-k="note-asks"]')).toHaveLength(0);
    expect(all(root, '.bn-row .hb-opt')).toHaveLength(2);
    expect(text(q(root, '.bn-row'))).not.toContain('responde abajo');
  });

  it('opens at a note a notice linked to: the tab that holds it shows, and the note lights', async () => {
    server([entry({ id: 1 }), asking]);
    const root = await show(<HablarView bandeja="B-3" />);

    expect(q(root, '.hb')?.getAttribute('data-tab')).toBe('out');
    expect(q(root, '#bn-B-3')?.hasAttribute('data-lit')).toBe(true);
    expect(q(root, '#bn-B-1')?.hasAttribute('data-lit')).toBe(false);
  });
});

// G3: a link to a note's question on a wide screen goes to the question at the foot of the thread,
// whichever of the two reads (the notes, the conversation) comes first; the light always goes out.
describe('a link to a question on a note, on a wide screen', () => {
  const asking = entry({
    id: 3,
    state: 'asking',
    text: 'make it better',
    asking: { question: 1, by: 'lia', at: ago(3), text: '¿Mejor en qué?', options: ['a', 'b'] },
  });

  // The window's width as a test sets it: a media query holds while `wide` says so.
  function widths(initial: boolean) {
    const state = { wide: initial, listeners: new Set<() => void>() };
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('1240') && state.wide,
      addEventListener: (_: string, listener: () => void) => state.listeners.add(listener),
      removeEventListener: (_: string, listener: () => void) => state.listeners.delete(listener),
    }));
    return {
      set(wide: boolean) {
        state.wide = wide;
        for (const listener of state.listeners) listener();
      },
    };
  }

  // The notes arrive at once; the conversation only when the test lets it.
  function slowConversation(entries: BandejaEntry[]) {
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      const path = new URL(String(input instanceof Request ? input.url : input), 'http://x')
        .pathname;
      const json = (value: unknown, status = 200) =>
        new Response(JSON.stringify(value), {
          status,
          headers: { 'content-type': 'application/json' },
        });
      if (path.endsWith('/bandeja')) return json({ entries });
      if (path.endsWith('/conversation')) {
        await held;
        return json({
          messages: [],
          more: false,
          secretary: null,
          waiting: { count: 0, since: null },
        });
      }
      return json({ error: { code: 'not_found' } }, 404);
    });
    return release;
  }

  it('waits for the conversation, then goes to the question and lights it', async () => {
    widths(true);
    const release = slowConversation([asking]);
    await show(<HablarView bandeja="B-3" />);
    // The notes are there, the thread is not: the page does not settle for the note's row.
    expect(page?.root.querySelector('#hb-ask-B-3')).toBeNull();

    release();
    await settle();

    await vi.waitFor(() =>
      expect(page?.root.querySelector('#hb-ask-B-3')?.hasAttribute('data-lit')).toBe(true),
    );
  });

  it('puts the note’s light out after a moment, even when the window changes meanwhile', async () => {
    const media = widths(false);
    slowConversation([asking])();
    const root = await show(<HablarView bandeja="B-3" />);
    expect(q(root, '#bn-B-3')?.hasAttribute('data-lit')).toBe(true);

    media.set(true);
    await settle();
    await act(async () => new Promise((resolve) => setTimeout(resolve, 2600)));

    expect(q(root, '#bn-B-3')?.hasAttribute('data-lit')).toBe(false);
  });
});

// G3: a second tap on «Reabrir» while the first is on its way is the same tap.
describe('reopening a closed note', () => {
  it('sends once however many times it is tapped before the PC answers', async () => {
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let reopens = 0;
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const path = new URL(String(input instanceof Request ? input.url : input), 'http://x')
        .pathname;
      const json = (value: unknown, status = 200) =>
        new Response(JSON.stringify(value), {
          status,
          headers: { 'content-type': 'application/json' },
        });
      if ((init.method ?? 'GET').toUpperCase() === 'POST') {
        reopens += 1;
        await held;
        return json(entry({ id: 5 }), 201);
      }
      if (path.endsWith('/bandeja')) {
        return json({
          entries: [entry({ id: 5, state: 'closed', closedBy: 'sol', closeReason: 'duplicada' })],
        });
      }
      return json({ error: { code: 'not_found' } }, 404);
    });
    const root = await show(<Live />);
    const button = q(root, '.bn-reopen');

    await press(button);
    await press(button);
    release();
    await settle();

    expect(reopens).toBe(1);
  });
});

describe('the way back from an item', () => {
  it('says the item came out of the Bandeja with the note’s first words, and says nothing otherwise', async () => {
    const root = await show(
      <FromBandeja
        from={{ id: 3, ref: 'B-3', at: ago(10), snippet: 'El botón Aprobar queda tapado' }}
      />,
    );
    expect(text(root)).toBe('salió de la Bandeja · «El botón Aprobar queda tapado»');
    page?.unmount();

    const none = await show(<FromBandeja from={undefined} />);
    expect(text(none)).toBe('');
  });
});
