import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openProject, type Project } from '../app/project.ts';
import { type Cli, cliAt, declareProfiles, type TempRepo, tempGitRepo } from '../cli/testing.ts';
import { type Listening, listen } from '../server/listen.ts';
import { createServer } from '../server/server.ts';
import { sessionCookie } from '../server/session.ts';
import { TOKEN } from '../server/testing.ts';

// The 0.8 end-to-end check (SPEC section 6): a real server on a random port, a throwaway git repo
// and a temp OTEA_HOME, with the person on the desk's API (signed in, from its own origin) and the
// agents as real CLI commands. One story, in order: a request with an image, a worker's question
// answered by option, a Bandeja capture refined and filed, the secretary away while the person
// writes, and every link between the conversation, the items and the Bandeja read back from the
// API.
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

type Message = {
  id: number;
  author: string;
  text: string;
  kind: string | null;
  links: string[];
  delivery: string | null;
  replyTo: number | null;
  attachments: { id: number; name: string; kind: string }[];
};
type Conversation = {
  messages: Message[];
  secretary: { name: string; state: string } | null;
  waiting: { count: number };
};

describe('the secretary, end to end', () => {
  let repo: TempRepo;
  let home: string;
  let project: Project;
  let listening: Listening;
  let otea: Cli;
  let base: string;

  // The person: the desk's own signed-in session, from its own origin.
  const desk = (path: string, init: { method?: string; body?: unknown } = {}) => {
    const headers: Record<string, string> = {
      cookie: `${sessionCookie(listening.port)}=${TOKEN}`,
      origin: listening.url,
    };
    let body: FormData | string | undefined;
    if (init.body instanceof FormData) body = init.body;
    else if (init.body !== undefined) {
      headers['content-type'] = 'application/json';
      body = JSON.stringify(init.body);
    }
    return fetch(`${base}${path}`, {
      method: init.method ?? 'GET',
      headers,
      ...(body ? { body } : {}),
    });
  };
  const json = async <T>(response: Response): Promise<T> => (await response.json()) as T;
  const conversation = async () => json<Conversation>(await desk('/conversation'));

  // An agent: a CLI command named with --as, its output as JSON.
  const agent = async <T = Record<string, unknown>>(name: string, ...argv: string[]) => {
    const result = await otea(...argv, '--as', name, '--json');
    if (result.code !== 0) throw new Error(`otea ${argv.join(' ')} (${name}): ${result.err}`);
    return JSON.parse(result.out) as T;
  };
  const said = async (name: string, ...argv: string[]) => {
    const result = await otea(...argv, '--as', name);
    if (result.code !== 0) throw new Error(`otea ${argv.join(' ')} (${name}): ${result.err}`);
    return result.out;
  };

  beforeAll(async () => {
    repo = tempGitRepo();
    home = mkdtempSync(join(tmpdir(), 'otea-e2e-home-'));
    const env = { OTEA_HOME: home };
    otea = cliAt(repo.dir, env);
    for (const argv of [
      ['init', '--local', '--template', 'none'],
      ['board', 'add', 'Cambios', '--template', 'changes'],
    ]) {
      const result = await otea(...argv);
      if (result.code !== 0) throw new Error(`otea ${argv.join(' ')}: ${result.err}`);
    }
    declareProfiles(repo.dir, 'sol', 'ana', 'rita');
    await said('sol', 'profile', '--role', 'secretary');

    project = openProject(repo.dir, env);
    listening = await listen(createServer(project, { token: TOKEN, env }), 0);
    base = `${listening.url}/p/${project.identity.id}/api`;
  }, 60_000);

  afterAll(async () => {
    await listening?.close();
    project?.db.close();
    repo?.remove();
    if (home) rmSync(home, { recursive: true, force: true });
  });

  it('runs the whole way: request, worker question, Bandeja, away and back, links both ways', async () => {
    // 1. The secretary listens; the person posts a request with an image from the desk.
    const waiting = otea('wait', '--secretary', '--as', 'sol', '--timeout', '30s', '--json');
    const form = new FormData();
    form.set('message', JSON.stringify({ text: 'the Aprobar button is hidden on the phone' }));
    form.append('file', new File([PNG], 'phone.png', { type: 'image/png' }));
    const sent = await desk('/conversation/messages', { method: 'POST', body: form });
    expect(sent.status).toBe(201);
    const first = await json<Message>(sent);
    expect(first).toMatchObject({ author: 'person', delivery: 'pending' });

    const woke = await waiting;
    expect(woke.code, woke.err).toBe(0);
    expect(JSON.parse(woke.out)).toMatchObject({ kind: 'person_message' });

    // 2. It reads the conversation (the image comes with a path it can open), makes the item from
    // the message and answers it as a request linked to the item.
    const read = await agent<{ messages: { id: number; attachments: { path?: string }[] }[] }>(
      'sol',
      'conversation',
    );
    const asked = read.messages.find(({ id }) => id === first.id);
    expect(asked?.attachments[0]?.path).toBeTruthy();
    const item = await agent<{ id: string }>(
      'sol',
      'create',
      '--collection',
      'Cambios',
      '--title',
      'Aprobar is hidden on the phone',
      '--field',
      'Qué quiero=The Aprobar button visible on the phone',
      '--field',
      'Cómo lo valido=At 390 px the button shows without scrolling',
      '--from-message',
      String(first.id),
    );
    await said(
      'sol',
      'say',
      `Made ${item.id}: the button is hidden at 390 px.`,
      '--reply-to',
      String(first.id),
      '--request',
      '--links',
      item.id,
    );

    // The desk shows the turn as a request that produced the item, read, with the answer.
    const afterSay = await conversation();
    expect(afterSay.messages.map(({ author, delivery }) => [author, delivery])).toEqual([
      ['person', 'read'],
      ['secretary', null],
    ]);
    expect(afterSay.messages[1]).toMatchObject({ kind: 'request', links: [item.id] });
    expect(afterSay.messages[0]?.attachments).toEqual([
      expect.objectContaining({ name: 'phone.png', kind: 'image' }),
    ]);

    // 3. A worker takes the item and asks, with options; the person answers by option.
    const took = await said('ana', 'next', '--collection', 'Cambios', '--claim');
    expect(took).toContain(item.id);
    await said(
      'ana',
      'ask',
      item.id,
      'Where should the button go?',
      '--option',
      'In the header',
      '--option',
      'Above the keyboard',
      '--recommend',
      '2',
    );
    const asking = await json<{ turn: string; board: { asking: { question: number } } }>(
      await desk(`/items/${item.id}`),
    );
    expect(asking.turn).toBe('human');
    const answered = await desk(`/items/${item.id}/answer`, {
      method: 'POST',
      body: { question: asking.board.asking.question, option: 2 },
    });
    expect(answered.status).toBe(200);
    expect(await json<{ turn: string }>(answered)).toMatchObject({ turn: 'agent' });

    // 4. A rough capture lands in the Bandeja; the secretary hears it, takes it for a refiner, and
    // the refiner files it as an item with its fields filled.
    const captured = await desk('/bandeja', {
      method: 'POST',
      body: { text: 'the footer shows last year' },
    });
    expect(captured.status).toBe(201);
    const entry = await json<{ ref: string }>(captured);
    const heard = await agent<{ kind: string; ref?: string }>(
      'sol',
      'wait',
      '--secretary',
      '--timeout',
      '30s',
    );
    expect(heard).toMatchObject({ kind: 'bandeja_item', ref: entry.ref });
    await said('sol', 'bandeja', 'take', entry.ref, '--for', 'rita');
    await said('rita', 'bandeja', 'take', entry.ref);
    const refined = await agent<{ id: string }>(
      'rita',
      'create',
      '--collection',
      'Cambios',
      '--title',
      'The footer shows last year',
      '--field',
      'Qué quiero=The footer shows the current year',
      '--field',
      'Cómo lo valido=Open the page in January and read the footer',
      '--from-bandeja',
      entry.ref,
    );
    const filed = await json<{ entries: { ref: string; state: string; item: string }[] }>(
      await desk('/bandeja?filed=10'),
    );
    expect(filed.entries).toEqual([
      expect.objectContaining({ ref: entry.ref, state: 'filed', item: refined.id }),
    ]);

    // 5. The secretary goes away (its last sign is long past, nothing listens); the person writes;
    // Hablar says it is offline and the message waits.
    const longAgo = new Date(Date.now() - 45 * 60_000).toISOString();
    project.db
      .prepare(
        "UPDATE agents SET last_seen = ?, acted_at = ?, listening_at = NULL WHERE name = 'sol'",
      )
      .run(longAgo, longAgo);
    const away = await json<{ secretary: { state: string; since: string } }>(
      await desk('/secretary'),
    );
    expect(away.secretary).toMatchObject({ state: 'offline', since: longAgo });
    const late = await json<Message>(
      await desk('/conversation/messages', {
        method: 'POST',
        body: { text: 'and the footer too, please' },
      }),
    );
    const waits = await conversation();
    expect(waits.waiting.count).toBe(1);
    expect(waits.messages.at(-1)).toMatchObject({ id: late.id, delivery: 'pending' });

    // 6. It comes back: its wait returns for that message, it reads it, and the desk sees it read.
    const back = await agent<{ kind: string }>('sol', 'wait', '--secretary', '--timeout', '30s');
    expect(back.kind).toBe('person_message');
    await agent('sol', 'conversation');
    const delivered = await conversation();
    expect(delivered.waiting.count).toBe(0);
    expect(delivered.messages.at(-1)).toMatchObject({ id: late.id, delivery: 'read' });
    expect(delivered.secretary?.state).not.toBe('offline');

    // 7. The links resolve both ways: the item names its message, the message its item, and the
    // refined item its Bandeja entry.
    const shown = await json<{
      fromMessages: { id: number }[];
      board: { questions: { answer?: { text: string } }[] };
    }>(await desk(`/items/${item.id}`));
    expect(shown.fromMessages.map(({ id }) => id)).toContain(first.id);
    expect(shown.board.questions[0]?.answer).toMatchObject({ text: 'Above the keyboard' });
    const root = delivered.messages.find(({ id }) => id === first.id);
    expect(root?.links).toContain(item.id);
    const fromBandeja = await json<{ fromBandeja: { ref: string } }>(
      await desk(`/items/${refined.id}`),
    );
    expect(fromBandeja.fromBandeja.ref).toBe(entry.ref);
  }, 60_000);
});
