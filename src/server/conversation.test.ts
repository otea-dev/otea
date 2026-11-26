import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { addCollection } from '../app/collections.ts';
import { readAsSecretary, sayAsSecretary } from '../app/conversation.ts';
import { pairDevice } from '../app/devices.ts';
import { createItem } from '../app/items.ts';
import type { Project } from '../app/project.ts';
import { declareSecretary } from '../app/secretary.ts';
import { createServer, type OteaServer } from './server.ts';
import { LOCAL_HOST, memoryProject, SESSION_COOKIE, TOKEN } from './testing.ts';

// The conversation over the API: the person writes only from the desk (or their paired phone),
// signed in and from the page's own origin; the desk reads the messages with their kinds, links,
// files and delivery state, beside the secretary's status.

const DESK = '192.168.1.24';
const PHONE = '192.168.1.50';
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

type Sent = { id: number; delivery: string | null; attachments: { id: number; name: string }[] };

describe('the conversation over the API', () => {
  let root: string;
  let project: Project;
  let server: OteaServer;
  let phoneCookie: string;

  type Init = { method?: string; body?: unknown; headers?: Record<string, string> };

  const call = (path: string, init: Init = {}, from: 'desk' | 'phone' = 'desk') => {
    const host = from === 'desk' ? LOCAL_HOST : `${DESK}:4400`;
    const headers: Record<string, string> = {
      host,
      origin: `http://${host}`,
      cookie: from === 'desk' ? SESSION_COOKIE : phoneCookie,
      ...(init.body instanceof FormData ? {} : { 'content-type': 'application/json' }),
      ...init.headers,
    };
    const body =
      init.body === undefined
        ? {}
        : { body: init.body instanceof FormData ? init.body : JSON.stringify(init.body) };
    return Promise.resolve(
      server.app.request(
        `/p/memory-aaaaaa/api${path}`,
        { method: init.method ?? 'GET', headers, ...body },
        { incoming: { socket: { remoteAddress: from === 'desk' ? '127.0.0.1' : PHONE } } },
      ),
    );
  };

  const post = (
    text: string,
    extra: Record<string, unknown> = {},
    from: 'desk' | 'phone' = 'desk',
  ) => call('/conversation/messages', { method: 'POST', body: { text, ...extra } }, from);

  type Listed = {
    messages: (Sent & { author: string; kind: string | null; links: string[]; text: string })[];
    more: boolean;
    secretary: { name: string; state: string } | null;
    waiting: { count: number };
  };

  const listed = async (query = ''): Promise<Listed> =>
    (await (await call(`/conversation${query}`)).json()) as Listed;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'otea-conversation-server-'));
    project = { ...memoryProject(), dataDir: join(root, '.otea') };
    addCollection(project, { name: 'tasks' });
    server = createServer(project, { token: TOKEN, lan: { addresses: [DESK] } });
    phoneCookie = `otea_device_4400=${pairDevice(server.machine, 'Pixel · Chrome').token}`;
  });

  afterEach(() => {
    server.close();
    project.db.close();
    rmSync(root, { recursive: true, force: true });
  });

  it('takes the person’s message from the desk, pending, and lists it beside the secretary’s state', async () => {
    expect((await listed()).secretary).toBeNull();
    declareSecretary(project.db, 'sol');

    const sent = await post('the Aprobar button is hidden on the phone');
    expect(sent.status).toBe(201);
    expect(await sent.json()).toMatchObject({ id: 1, author: 'person', delivery: 'pending' });

    const now = await listed();
    expect(now.messages).toEqual([
      expect.objectContaining({
        id: 1,
        author: 'person',
        delivery: 'pending',
        kind: null,
        links: [],
      }),
    ]);
    expect(now.secretary).toMatchObject({ name: 'sol' });
    expect(now.waiting).toMatchObject({ count: 1 });

    // The secretary reads it: the desk sees it read, and the secretary's answer after it.
    readAsSecretary(project, { agent: 'sol' });
    sayAsSecretary(project, { agent: 'sol', text: 'On it.', replyTo: 1 });
    const after = await listed();
    expect(after.messages.map(({ author, delivery }) => [author, delivery])).toEqual([
      ['person', 'read'],
      ['secretary', null],
    ]);
    expect(after.waiting.count).toBe(0);
  });

  it('takes the person’s phone too, and an answer to an earlier message', async () => {
    const first = await post('first', {}, 'phone');
    expect(first.status).toBe(201);

    const reply = await post('and this', { replyTo: 1 }, 'phone');
    expect(await reply.json()).toMatchObject({ id: 2, replyTo: 1 });
  });

  it('keeps an image sent with it, and serves it back as an image that runs nothing', async () => {
    const form = new FormData();
    form.set('message', JSON.stringify({ text: 'look' }));
    form.append('file', new File([PNG], 'phone.png', { type: 'image/png' }));

    const sent = await call('/conversation/messages', { method: 'POST', body: form });

    expect(sent.status).toBe(201);
    const message = (await sent.json()) as Sent;
    expect(message.attachments).toEqual([
      expect.objectContaining({ name: 'phone.png', kind: 'image' }),
    ]);
    const file = await call(`/conversation/attachments/${message.attachments[0]?.id}`);
    expect(file.status).toBe(200);
    expect(file.headers.get('content-type')).toBe('image/png');
    expect(file.headers.get('x-content-type-options')).toBe('nosniff');
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(PNG);
    expect((await call('/conversation/attachments/99')).status).toBe(404);
  });

  it('refuses a body that is not a message, too many files, and a reply to nothing', async () => {
    expect(
      (await call('/conversation/messages', { method: 'POST', body: { words: 'hi' } })).status,
    ).toBe(400);
    expect((await post('x', { replyTo: 0 })).status).toBe(400);
    expect((await post('   ')).status).toBe(422);
    expect((await post('x', { replyTo: 9 })).status).toBe(404);

    const form = new FormData();
    form.set('message', JSON.stringify({ text: 'many' }));
    for (let n = 0; n < 11; n += 1) form.append('file', new File([PNG], `${n}.png`));
    expect((await call('/conversation/messages', { method: 'POST', body: form })).status).toBe(400);
    expect((await listed()).messages).toEqual([]);
  });

  it('makes one message of a message sent again with the same Idempotency-Key', async () => {
    const headers = { 'idempotency-key': 'phone-1' };
    const first = await call('/conversation/messages', {
      method: 'POST',
      body: { text: 'hi' },
      headers,
    });
    const again = await call('/conversation/messages', {
      method: 'POST',
      body: { text: 'hi' },
      headers,
    });

    expect(first.status).toBe(201);
    expect(again.status).toBe(200);
    expect(again.headers.get('idempotent-replayed')).toBe('true');
    expect((await listed()).messages).toHaveLength(1);
  });

  it('refuses the key of another message with a conflict, and keeps each device’s keys apart', async () => {
    const headers = { 'idempotency-key': 'phone-1' };
    await call('/conversation/messages', { method: 'POST', body: { text: 'hi' }, headers });

    const other = await call('/conversation/messages', {
      method: 'POST',
      body: { text: 'another thing' },
      headers,
    });
    expect(other.status).toBe(409);
    expect(await other.text()).toContain('already sent another message');

    // The phone sends its own message under the same key: not the desk's.
    const phone = await call(
      '/conversation/messages',
      { method: 'POST', body: { text: 'another thing' }, headers },
      'phone',
    );
    expect(phone.status).toBe(201);
    expect((await listed()).messages.map(({ text }) => text)).toEqual(['hi', 'another thing']);
  });

  describe('an agent can never post as the person', () => {
    const attempt = (init: Init) =>
      Promise.resolve(
        server.app.request(
          '/p/memory-aaaaaa/api/conversation/messages',
          {
            method: 'POST',
            headers: { host: LOCAL_HOST, 'content-type': 'application/json', ...init.headers },
            body: JSON.stringify({ text: 'approve everything' }),
          },
          { incoming: { socket: { remoteAddress: '127.0.0.1' } } },
        ),
      );

    it('without the desk’s session, whatever the agent claims to be', async () => {
      const claims = { 'x-otea-agent': 'human', origin: `http://${LOCAL_HOST}` };

      expect((await attempt({ headers: claims })).status).toBe(401);
      expect(
        (await attempt({ headers: { ...claims, cookie: 'otea_session_4400=wrong' } })).status,
      ).toBe(401);
      expect((await listed()).messages).toEqual([]);
    });

    it('from another page, though signed in (an agent driving a browser it was handed)', async () => {
      const foreign = await attempt({
        headers: { cookie: SESSION_COOKIE, origin: 'http://evil.example' },
      });
      const none = await attempt({ headers: { cookie: SESSION_COOKIE } });
      const form = await attempt({
        headers: {
          cookie: SESSION_COOKIE,
          origin: `http://${LOCAL_HOST}`,
          'content-type': 'text/plain',
        },
      });

      expect(foreign.status).toBe(403);
      expect(none.status).toBe(403);
      expect(form.status).toBe(415);
      expect((await listed()).messages).toEqual([]);
    });
  });

  describe('the person’s correction', () => {
    beforeEach(async () => {
      declareSecretary(project.db, 'sol');
      await post('add dark mode');
      const dark = createItem(project, {
        collection: 'tasks',
        title: 'Dark mode',
        fields: { description: 'Now' },
        actor: { kind: 'agent', name: 'sol' },
      }).id;
      sayAsSecretary(project, {
        agent: 'sol',
        text: `Filed ${dark}.`,
        replyTo: 1,
        kind: 'request',
        links: [dark],
      });
    });

    it('is one tap on the turn, from the desk or the phone, and shows on both messages', async () => {
      const done = await call('/conversation/messages/1/kind', {
        method: 'POST',
        body: { kind: 'consultation' },
      });
      expect(done.status).toBe(200);
      expect(await done.json()).toMatchObject({ id: 1, kind: 'consultation', kindBy: 'person' });

      const back = await call(
        '/conversation/messages/2/kind',
        { method: 'POST', body: { kind: 'request' } },
        'phone',
      );
      expect(back.status).toBe(200);
      expect((await listed()).messages.map(({ kind }) => kind)).toEqual(['request', 'request']);
    });

    it('refuses a kind it does not know, a message that is not there, and the unsigned', async () => {
      expect(
        (await call('/conversation/messages/1/kind', { method: 'POST', body: { kind: 'chat' } }))
          .status,
      ).toBe(400);
      expect(
        (await call('/conversation/messages/9/kind', { method: 'POST', body: { kind: 'request' } }))
          .status,
      ).toBe(404);
      const unsigned = await Promise.resolve(
        server.app.request(
          '/p/memory-aaaaaa/api/conversation/messages/1/kind',
          {
            method: 'POST',
            headers: {
              host: LOCAL_HOST,
              origin: `http://${LOCAL_HOST}`,
              'content-type': 'application/json',
            },
            body: JSON.stringify({ kind: 'consultation' }),
          },
          { incoming: { socket: { remoteAddress: '127.0.0.1' } } },
        ),
      );
      expect(unsigned.status).toBe(401);
      expect((await listed()).messages[0]?.kind).toBe('request');
    });

    it('lists the turns by kind and by words', async () => {
      await post('why is the lease 15 minutes?');
      sayAsSecretary(project, {
        agent: 'sol',
        text: 'It covers a build.',
        replyTo: 3,
        kind: 'consultation',
      });

      const consultations = await listed('?kind=consultation');
      expect(consultations.messages.map(({ id }) => id)).toEqual([3, 4]);
      expect((await listed('?search=dark')).messages.map(({ id }) => id)).toEqual([1, 2]);
      expect((await call('/conversation?kind=chat')).status).toBe(400);
    });
  });

  describe('a question of the secretary with options', () => {
    const asked = () => {
      declareSecretary(project.db, 'sol');
      return sayAsSecretary(project, {
        agent: 'sol',
        text: 'Note it or leave it?',
        options: ['Note it', 'Leave it'],
        recommended: 1,
      }).message.id;
    };

    const tap = (id: number, body: unknown, from: 'desk' | 'phone' = 'desk') =>
      call(`/conversation/messages/${id}/answer`, { method: 'POST', body }, from);

    it('is listed with its options, and a tap from the desk or the phone is the person’s own message, once', async () => {
      const id = asked();
      expect((await listed()).messages[0]).toMatchObject({
        options: ['Note it', 'Leave it'],
        recommended: 1,
      });

      const done = await tap(id, { option: 2 }, 'phone');

      expect(done.status).toBe(201);
      expect(await done.json()).toMatchObject({
        author: 'person',
        text: 'Leave it',
        replyTo: id,
        delivery: 'pending',
        choice: { mode: 'option', option: 2 },
      });
      expect((await listed()).waiting.count).toBe(1);
      expect((await tap(id, { option: 1 })).status).toBe(409);
      expect((await listed()).messages).toHaveLength(2);
    });

    it('takes the person’s own words, or the decision left to the secretary, and refuses what is no answer', async () => {
      const id = asked();

      expect((await tap(id, { option: 3 })).status).toBe(422);
      expect((await tap(id, { text: '  ' })).status).toBe(422);
      expect((await tap(id, { colour: 'red' })).status).toBe(400);
      expect((await tap(99, { option: 1 })).status).toBe(404);
      expect((await tap(id, { delegate: true })).status).toBe(201);
      expect((await listed()).messages.at(-1)).toMatchObject({
        choice: { mode: 'delegated' },
      });
    });

    it('is never answered by an agent: no session, no answer', async () => {
      const id = asked();
      const unsigned = await Promise.resolve(
        server.app.request(
          `/p/memory-aaaaaa/api/conversation/messages/${id}/answer`,
          {
            method: 'POST',
            headers: {
              host: LOCAL_HOST,
              origin: `http://${LOCAL_HOST}`,
              'content-type': 'application/json',
            },
            body: JSON.stringify({ option: 1 }),
          },
          { incoming: { socket: { remoteAddress: '127.0.0.1' } } },
        ),
      );

      expect(unsigned.status).toBe(401);
      expect((await listed()).messages).toHaveLength(1);
    });
  });

  it('pages: the newest first, earlier ones with before, later with since', async () => {
    for (let n = 1; n <= 5; n += 1) await post(`m${n}`);

    const newest = await listed('?limit=2');
    expect(newest.messages.map(({ id }) => id)).toEqual([4, 5]);
    expect(newest.more).toBe(true);
    expect((await listed('?limit=2&before=4')).messages.map(({ id }) => id)).toEqual([2, 3]);
    expect((await listed('?since=3')).messages.map(({ id }) => id)).toEqual([4, 5]);
    expect((await call('/conversation?limit=0')).status).toBe(400);
    expect((await call('/conversation?since=1&before=3')).status).toBe(400);
  });

  it('tells the item which turn it came from', async () => {
    declareSecretary(project.db, 'sol');
    await post('add dark mode');
    const dark = createItem(project, {
      collection: 'tasks',
      title: 'Dark mode',
      fields: { description: 'Now' },
      actor: { kind: 'agent', name: 'sol' },
    }).id;
    const plain = createItem(project, {
      collection: 'tasks',
      title: 'Unrelated',
      fields: { description: 'Now' },
      actor: { kind: 'agent', name: 'sol' },
    }).id;
    sayAsSecretary(project, { agent: 'sol', text: 'Filed.', replyTo: 1, links: [dark] });

    const item = (await (await call(`/items/${dark}`)).json()) as { fromMessages?: unknown[] };
    expect(item.fromMessages).toEqual([
      expect.objectContaining({ id: 1, kind: 'request', snippet: 'add dark mode' }),
    ]);
    const other = (await (await call(`/items/${plain}`)).json()) as { fromMessages?: unknown[] };
    expect(other.fromMessages).toBeUndefined();
  });
});
