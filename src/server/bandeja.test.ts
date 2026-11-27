import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { askOnBandeja, closeBandeja, fileBandeja, takeBandeja } from '../app/bandeja.ts';
import { addCollection } from '../app/collections.ts';
import { pairDevice } from '../app/devices.ts';
import { escalateToSecretary } from '../app/escalate.ts';
import { createItem } from '../app/items.ts';
import type { Project } from '../app/project.ts';
import { declareSecretary } from '../app/secretary.ts';
import { createServer, type OteaServer } from './server.ts';
import { LOCAL_HOST, memoryProject, SESSION_COOKIE, TOKEN } from './testing.ts';

// The Bandeja over the API: the person captures and answers only from the desk (or their paired
// phone), signed in and from the page's own origin; the desk reads the entries with their state, and
// an item says which entry it was refined from.

const DESK = '192.168.1.24';
const PHONE = '192.168.1.50';
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

type Entry = {
  id: number;
  ref: string;
  text: string;
  state: string;
  item: string | null;
  attachments: { id: number; name: string; kind: string }[];
  asking: { question: number; text: string; options?: string[] } | null;
  questions: { answer?: { text: string; mode: string } }[];
};

describe('the Bandeja over the API', () => {
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

  const capture = (text: string, extra: Init = {}, from: 'desk' | 'phone' = 'desk') =>
    call('/bandeja', { method: 'POST', body: { text }, ...extra }, from);

  const listed = async (query = ''): Promise<Entry[]> =>
    ((await (await call(`/bandeja${query}`)).json()) as { entries: Entry[] }).entries;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'otea-bandeja-server-'));
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

  it('takes a capture from the desk and from the phone, waiting for the secretary', async () => {
    const desk = await capture('dark mode somewhere');
    expect(desk.status).toBe(201);
    expect(await desk.json()).toMatchObject({ id: 1, ref: 'B-1', state: 'waiting' });

    const phone = await capture('the Aprobar button is hidden', {}, 'phone');
    expect(phone.status).toBe(201);

    expect((await listed()).map(({ ref, text, state }) => [ref, text, state])).toEqual([
      ['B-1', 'dark mode somewhere', 'waiting'],
      ['B-2', 'the Aprobar button is hidden', 'waiting'],
    ]);
  });

  // F4: Te toca counted items only, so a question on a note waited with "Nada espera por ti".
  it('says on /pending that a question on a note waits for the person, until they answer it', async () => {
    declareSecretary(project.db, 'sol');
    await capture('the Aprobar button is hidden');
    takeBandeja(project, { id: 1, agent: 'lia' });
    askOnBandeja(project, {
      id: 1,
      agent: 'lia',
      text: 'Which screen?',
      options: ['Te toca', 'Hablar'],
    });

    const pending = (await (await call('/pending')).json()) as {
      count: number;
      entries: { kind: string; ref: string; text: string }[];
      secretary: { name: string } | null;
    };
    expect(pending.count).toBe(1);
    expect(pending.entries).toMatchObject([{ kind: 'bandeja', ref: 'B-1', text: 'Which screen?' }]);
    expect(pending.secretary).toMatchObject({ name: 'sol' });

    await call('/bandeja/1/answer', { method: 'POST', body: { question: 1, option: 1 } });
    expect(((await (await call('/pending')).json()) as { count: number }).count).toBe(0);
  });

  // F4 review round: every open desk reads /pending on each change; what it says is kept until a
  // change is announced (the stream tells every desk), never worked out again for nothing.
  it('keeps /pending until a change is announced', async () => {
    declareSecretary(project.db, 'sol');
    await capture('first note');
    takeBandeja(project, { id: 1, agent: 'lia' });
    const count = async () => ((await (await call('/pending')).json()) as { count: number }).count;
    expect(await count()).toBe(0);

    // Written behind the server's back (no announcement): the kept answer stands.
    askOnBandeja(project, { id: 1, agent: 'lia', text: 'Which?', options: ['a', 'b'] });
    expect(await count()).toBe(0);

    // Any announced change reads it again.
    await capture('second note');
    expect(await count()).toBe(1);
  });

  // G1: a secretary that went quiet writes nothing; the kept answer must not hide it for 3 s.
  it('reads /pending again when the secretary’s liveness changed with no write announced', async () => {
    declareSecretary(project.db, 'sol');
    const state = async () =>
      ((await (await call('/pending')).json()) as { secretary: { state: string } }).secretary.state;
    expect(await state()).not.toBe('offline');

    const longAgo = new Date(Date.now() - 45 * 60_000).toISOString();
    project.db
      .prepare(
        "UPDATE agents SET last_seen = ?, acted_at = ?, listening_at = NULL WHERE name = 'sol'",
      )
      .run(longAgo, longAgo);

    expect(await state()).toBe('offline');
  });

  // G1: what an agent flagged to an absent secretary is the person's, who can set it aside.
  it('lets the person dismiss an escalation, once', async () => {
    declareSecretary(project.db, 'sol');
    const item = createItem(project, {
      collection: 'tasks',
      title: 'Retry',
      fields: { description: 'D' },
      actor: { kind: 'agent', name: 'kiln' },
    }).id;
    escalateToSecretary(project, { agent: 'kiln', about: item, text: 'The push failed.' });
    const longAgo = new Date(Date.now() - 45 * 60_000).toISOString();
    project.db
      .prepare(
        "UPDATE agents SET last_seen = ?, acted_at = ?, listening_at = NULL WHERE name = 'sol'",
      )
      .run(longAgo, longAgo);
    const read = async () =>
      (await (await call('/pending')).json()) as { entries: { kind: string; signal?: number }[] };
    const [shown] = (await read()).entries;
    expect(shown).toMatchObject({ kind: 'escalation' });

    const dismissed = await call(`/escalations/${shown?.signal}/dismiss`, { method: 'POST' });

    expect(dismissed.status).toBe(200);
    expect((await read()).entries).toEqual([]);
    expect((await call(`/escalations/${shown?.signal}/dismiss`, { method: 'POST' })).status).toBe(
      404,
    );
  });

  it('keeps the images and files sent with it, and serves them back as what they are', async () => {
    const form = new FormData();
    form.set('message', JSON.stringify({ text: 'look' }));
    form.append('file', new File([PNG], 'phone.png', { type: 'image/png' }));
    form.append('file', new File(['notes'], 'notes.txt', { type: 'text/plain' }));

    const sent = await call('/bandeja', { method: 'POST', body: form });

    expect(sent.status).toBe(201);
    const entry = (await sent.json()) as Entry;
    expect(entry.attachments.map(({ name, kind }) => [name, kind])).toEqual([
      ['phone.png', 'image'],
      ['notes.txt', 'log'],
    ]);
    const file = await call(`/bandeja/attachments/${entry.attachments[0]?.id}`);
    expect(file.status).toBe(200);
    expect(file.headers.get('content-type')).toBe('image/png');
    expect(file.headers.get('x-content-type-options')).toBe('nosniff');
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(PNG);
    expect((await call('/bandeja/attachments/99')).status).toBe(404);
  });

  it('refuses a body that is not a capture, an empty one and too many files', async () => {
    expect((await call('/bandeja', { method: 'POST', body: { words: 'hi' } })).status).toBe(400);
    expect((await capture('   ')).status).toBe(422);

    const form = new FormData();
    form.set('message', JSON.stringify({ text: 'many' }));
    for (let n = 0; n < 11; n += 1) form.append('file', new File([PNG], `${n}.png`));
    expect((await call('/bandeja', { method: 'POST', body: form })).status).toBe(400);
    expect(await listed()).toEqual([]);
  });

  it('makes one entry of a capture sent again with the same Idempotency-Key', async () => {
    const headers = { 'idempotency-key': 'phone-1' };
    const first = await capture('hi', { headers }, 'phone');
    const again = await capture('hi', { headers }, 'phone');
    const other = await capture('another thing', { headers }, 'phone');

    expect(first.status).toBe(201);
    expect(again.status).toBe(200);
    expect(again.headers.get('idempotent-replayed')).toBe('true');
    expect(other.status).toBe(409);
    expect(await listed()).toHaveLength(1);
  });

  describe('an agent can never capture or answer as the person', () => {
    const attempt = (path: string, body: unknown, headers: Record<string, string>) =>
      Promise.resolve(
        server.app.request(
          `/p/memory-aaaaaa/api${path}`,
          {
            method: 'POST',
            headers: { host: LOCAL_HOST, 'content-type': 'application/json', ...headers },
            body: JSON.stringify(body),
          },
          { incoming: { socket: { remoteAddress: '127.0.0.1' } } },
        ),
      );

    it('without the desk’s session, whatever the agent claims to be', async () => {
      const claims = { 'x-otea-agent': 'human', origin: `http://${LOCAL_HOST}` };

      expect((await attempt('/bandeja', { text: 'file this' }, claims)).status).toBe(401);
      expect(
        (
          await attempt(
            '/bandeja',
            { text: 'file this' },
            { ...claims, cookie: 'otea_session_4400=x' },
          )
        ).status,
      ).toBe(401);
      expect((await attempt('/bandeja/1/answer', { question: 1, option: 1 }, claims)).status).toBe(
        401,
      );
      expect(await listed()).toEqual([]);
    });

    it('from another page, though signed in (an agent driving a browser it was handed)', async () => {
      const foreign = await attempt(
        '/bandeja',
        { text: 'file this' },
        { cookie: SESSION_COOKIE, origin: 'http://evil.example' },
      );
      const none = await attempt('/bandeja', { text: 'file this' }, { cookie: SESSION_COOKIE });

      expect(foreign.status).toBe(403);
      expect(none.status).toBe(403);
      expect(await listed()).toEqual([]);
    });
  });

  describe('a question on an entry', () => {
    beforeEach(async () => {
      declareSecretary(project.db, 'sol');
      await capture('make it better');
      takeBandeja(project, { id: 1, agent: 'lia' });
      askOnBandeja(project, {
        id: 1,
        agent: 'lia',
        text: 'Better how?',
        options: ['Faster', 'Prettier'],
      });
    });

    it('shows with its options, and is answered with one tap from the desk or the phone', async () => {
      const [asking] = await listed();
      expect(asking).toMatchObject({
        state: 'asking',
        asking: { question: 1, text: 'Better how?', options: ['Faster', 'Prettier'] },
      });

      const answered = await call('/bandeja/1/answer', {
        method: 'POST',
        body: { question: 1, option: 2 },
      });
      expect(answered.status).toBe(200);
      expect(await answered.json()).toMatchObject({ state: 'waiting' });
      expect((await listed())[0]?.questions[0]?.answer).toMatchObject({
        text: 'Prettier',
        mode: 'option',
      });

      // Answered once: a second tap (the phone's) finds nothing waiting.
      const again = await call(
        '/bandeja/1/answer',
        { method: 'POST', body: { question: 1, option: 1 } },
        'phone',
      );
      expect(again.status).toBe(409);
    });

    it('refuses a tap on a question that changed, a body that is no answer, and an unknown entry', async () => {
      expect(
        (await call('/bandeja/1/answer', { method: 'POST', body: { question: 4, option: 1 } }))
          .status,
      ).toBe(409);
      expect(
        (await call('/bandeja/1/answer', { method: 'POST', body: { option: 1 } })).status,
      ).toBe(400);
      expect(
        (await call('/bandeja/9/answer', { method: 'POST', body: { question: 1, option: 1 } }))
          .status,
      ).toBe(404);
      expect((await listed())[0]?.state).toBe('asking');
    });

    // G1: an answer is a few words; megabytes would flood what the refiner and the secretary read.
    it('refuses an answer far past a message’s size, and a kind correction with a body of megabytes', async () => {
      const huge = 'x'.repeat(2_000_000);
      const answer = await call('/bandeja/1/answer', {
        method: 'POST',
        body: { question: 1, text: huge },
      });
      expect(answer.status).toBe(413);
      const justOver = await call('/bandeja/1/answer', {
        method: 'POST',
        body: { question: 1, text: 'x'.repeat(20_001) },
      });
      expect(justOver.status).toBe(400);
      const kind = await call('/conversation/messages/1/kind', {
        method: 'POST',
        body: { kind: 'request', pad: huge },
      });
      expect(kind.status).toBe(413);
      expect((await listed())[0]?.state).toBe('asking');
    });

    it('takes the person’s own words, or the decision left to the refiner', async () => {
      const own = await call('/bandeja/B-1/answer', {
        method: 'POST',
        body: { question: 1, text: 'the colours' },
      });
      expect(own.status).toBe(200);
      expect((await listed())[0]?.questions[0]?.answer).toMatchObject({
        text: 'the colours',
        mode: 'text',
      });
    });
  });

  // Field study 3, S4: the secretary could not close a duplicate; the person sees why and may
  // reopen it, from the desk or their paired phone.
  it('shows a closed entry with its reason, and lets the person reopen it', async () => {
    declareSecretary(project.db, 'sol');
    await capture('a duplicate of CAM-1');
    closeBandeja(project, { id: 1, agent: 'sol', reason: 'the same as CAM-1' });

    expect(await listed('?filed=0')).toEqual([]);
    expect(await listed()).toMatchObject([
      { ref: 'B-1', state: 'closed', closeReason: 'the same as CAM-1', closedBy: 'sol' },
    ]);

    const reopened = await call('/bandeja/1/reopen', { method: 'POST' }, 'phone');
    expect(reopened.status).toBe(200);
    expect(await reopened.json()).toMatchObject({ ref: 'B-1', state: 'waiting' });
    expect(await listed('?filed=0')).toMatchObject([{ ref: 'B-1', state: 'waiting' }]);
    // Not closed any more: nothing to reopen.
    expect((await call('/bandeja/1/reopen', { method: 'POST' })).status).toBe(409);
  });

  it('lists the entries not filed first, then the filed ones, and tells the item where it came from', async () => {
    await capture('one');
    await capture('two');
    takeBandeja(project, { id: 1, agent: 'lia' });
    const made = createItem(project, {
      collection: 'tasks',
      title: 'Dark mode',
      fields: { description: 'Now' },
      actor: { kind: 'agent', name: 'lia' },
    }).id;
    const other = createItem(project, {
      collection: 'tasks',
      title: 'Unrelated',
      fields: { description: 'Now' },
      actor: { kind: 'agent', name: 'lia' },
    }).id;
    fileBandeja(project, { id: 1, agent: 'lia', item: made });

    expect((await listed()).map(({ ref, state, item }) => [ref, state, item])).toEqual([
      ['B-2', 'waiting', null],
      ['B-1', 'filed', made],
    ]);
    expect((await listed('?filed=0')).map(({ ref }) => ref)).toEqual(['B-2']);

    const item = (await (await call(`/items/${made}`)).json()) as { fromBandeja?: unknown };
    expect(item.fromBandeja).toEqual(
      expect.objectContaining({ id: 1, ref: 'B-1', snippet: 'one' }),
    );
    const unrelated = (await (await call(`/items/${other}`)).json()) as { fromBandeja?: unknown };
    expect(unrelated.fromBandeja).toBeUndefined();
  });
});
