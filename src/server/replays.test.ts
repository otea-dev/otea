import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { askOnBandeja, closeBandeja, takeBandeja } from '../app/bandeja.ts';
import { addCollection } from '../app/collections.ts';
import { sayAsSecretary } from '../app/conversation.ts';
import { listItems } from '../app/items.ts';
import type { Project } from '../app/project.ts';
import { declareSecretary } from '../app/secretary.ts';
import { createServer, type OteaServer } from './server.ts';
import { LOCAL_HOST, memoryProject, SESSION_COOKIE, TOKEN } from './testing.ts';

// Field study 4, T1b: the person's phone sends a tap again until it hears back; the same
// Idempotency-Key must give the first result (200, idempotent-replayed), not a 409 that reads as a
// failure, and nothing is applied twice. A key reused for other content is refused, as the
// Bandeja's and Hablar's captures refuse it.
describe('a write sent again under the same Idempotency-Key', () => {
  let root: string;
  let project: Project;
  let server: OteaServer;

  const call = (path: string, body?: unknown, key?: string) =>
    Promise.resolve(
      server.app.request(
        `/p/memory-aaaaaa/api${path}`,
        {
          method: 'POST',
          headers: {
            host: LOCAL_HOST,
            origin: `http://${LOCAL_HOST}`,
            cookie: SESSION_COOKIE,
            'content-type': 'application/json',
            ...(key === undefined ? {} : { 'idempotency-key': key }),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        },
        { incoming: { socket: { remoteAddress: '127.0.0.1' } } },
      ),
    );

  const messages = () =>
    project.db
      .prepare("SELECT COUNT(*) AS n FROM conversation_messages WHERE author = 'person'")
      .get()?.n;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'otea-replays-'));
    project = { ...memoryProject(), dataDir: join(root, '.otea') };
    addCollection(project, { name: 'tasks' });
    server = createServer(project, { token: TOKEN });
    declareSecretary(project.db, 'sol');
  });

  afterEach(() => {
    server.close();
    project.db.close();
    rmSync(root, { recursive: true, force: true });
  });

  it('gives a tap on the secretary’s question the first result, and records one answer', async () => {
    const id = sayAsSecretary(project, {
      agent: 'sol',
      text: 'Note it or leave it?',
      options: ['Note it', 'Leave it'],
    }).message.id;

    const first = await call(`/conversation/messages/${id}/answer`, { option: 2 }, 'tap-1');
    const again = await call(`/conversation/messages/${id}/answer`, { option: 2 }, 'tap-1');

    expect(first.status).toBe(201);
    expect(again.status).toBe(200);
    expect(again.headers.get('idempotent-replayed')).toBe('true');
    expect(await again.json()).toEqual(await first.json());
    expect(messages()).toBe(1);
    // Another key is another tap: the question is answered already.
    expect((await call(`/conversation/messages/${id}/answer`, { option: 1 }, 'tap-2')).status).toBe(
      409,
    );
  });

  it('refuses the same key for another answer', async () => {
    const id = sayAsSecretary(project, {
      agent: 'sol',
      text: 'Note it or leave it?',
      options: ['Note it', 'Leave it'],
    }).message.id;

    await call(`/conversation/messages/${id}/answer`, { option: 2 }, 'tap-1');
    const other = await call(`/conversation/messages/${id}/answer`, { option: 1 }, 'tap-1');

    expect(other.status).toBe(409);
    expect(other.headers.get('idempotent-replayed')).toBeNull();
  });

  it('gives an undo the first result when it is sent again', async () => {
    const id = sayAsSecretary(project, {
      agent: 'sol',
      text: 'Note it or leave it?',
      options: ['Note it', 'Leave it'],
    }).message.id;
    await call(`/conversation/messages/${id}/answer`, { option: 2 });

    const first = await call(`/conversation/messages/${id}/unanswer`, undefined, 'undo-1');
    const again = await call(`/conversation/messages/${id}/unanswer`, undefined, 'undo-1');

    expect(first.status).toBe(200);
    expect(again.status).toBe(200);
    expect(again.headers.get('idempotent-replayed')).toBe('true');
    expect(await again.json()).toEqual(await first.json());
  });

  it('gives an answer to a refiner’s question on a note the first result', async () => {
    await call('/bandeja', { text: 'make it better' });
    takeBandeja(project, { id: 1, agent: 'lia' });
    askOnBandeja(project, { id: 1, agent: 'lia', text: 'Which?', options: ['a', 'b'] });

    const first = await call('/bandeja/1/answer', { question: 1, option: 1 }, 'ans-1');
    const again = await call('/bandeja/1/answer', { question: 1, option: 1 }, 'ans-1');

    expect(first.status).toBe(200);
    expect(again.status).toBe(200);
    expect(again.headers.get('idempotent-replayed')).toBe('true');
    expect(await again.json()).toEqual(await first.json());
  });

  it('gives a reopen of a closed note the first result', async () => {
    await call('/bandeja', { text: 'a duplicate' });
    closeBandeja(project, { id: 1, agent: 'sol', reason: 'the same as CAM-1' });

    const first = await call('/bandeja/1/reopen', undefined, 'reopen-1');
    const again = await call('/bandeja/1/reopen', undefined, 'reopen-1');

    expect(first.status).toBe(200);
    expect(again.status).toBe(200);
    expect(again.headers.get('idempotent-replayed')).toBe('true');
    expect(await again.json()).toMatchObject({ ref: 'B-1', state: 'waiting' });
    // Without the key, a second reopen is still refused: nothing is closed.
    expect((await call('/bandeja/1/reopen')).status).toBe(409);
  });

  it('refuses an item create under a key that made another item, and creates nothing', async () => {
    const create = (title: string) =>
      call('/items', { collection: 'tasks', fields: { title } }, 'cap-1');

    const first = await create('Ship');
    const same = await create('Ship');
    const other = await create('Something else');

    expect(first.status).toBe(201);
    expect(same.status).toBe(200);
    expect(other.status).toBe(409);
    expect(listItems(project).map((item) => item.title)).toEqual(['Ship']);
  });
});
