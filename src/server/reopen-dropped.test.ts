import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createItem, getItem } from '../app/items.ts';
import { dropItem } from '../app/next.ts';
import type { Project } from '../app/project.ts';
import { publishAs } from '../app/testing.ts';
import { creatures } from '../core/board/testing.ts';
import { createServer, type OteaServer } from './server.ts';
import { LOCAL_HOST, memoryProject, SESSION_COOKIE, TOKEN } from './testing.ts';

const you = { kind: 'human' as const, name: 'human' };
const HEADERS = {
  host: LOCAL_HOST,
  origin: `http://${LOCAL_HOST}`,
  cookie: SESSION_COOKIE,
  'content-type': 'application/json',
};

// U8 (field study 4): a discard nobody could take back. The desk's Reabrir returns the item to the
// state it left, as the person, whenever they see the drop was wrong.
describe('reopening a discarded item on the desk', () => {
  let project: Project;
  let server: OteaServer;

  const reopen = () =>
    Promise.resolve(
      server.app.request('/p/memory-aaaaaa/api/items/CRI-1/reopen-dropped', {
        method: 'POST',
        body: '{}',
        headers: HEADERS,
      }),
    );

  beforeEach(() => {
    project = memoryProject();
    publishAs(project, creatures(), 'bcri');
    const { id } = createItem(
      project,
      { collection: 'Criaturas', title: 'Rana', fields: { fdesc: 'Lenta' }, actor: you },
      () => '2026-11-27T10:00:00.000Z',
    );
    expect(id).toBe('CRI-1');
    dropItem(project, { id, actor: you, channel: 'ui', via: 'page', reason: 'no' });
    server = createServer(project, { token: TOKEN });
  });

  afterEach(() => {
    server.close();
    project.db.close();
  });

  it('puts the item back where it was, as the person, and refuses an item that is not dropped', async () => {
    expect(getItem(project, 'CRI-1').state).toBe('dropped');

    const reopened = await reopen();

    expect(reopened.status).toBe(200);
    expect(getItem(project, 'CRI-1').state).not.toBe('dropped');
    expect(getItem(project, 'CRI-1').events.at(-1)).toMatchObject({
      actor: you,
      data: { reopened: true, channel: 'ui' },
    });
    const again = await reopen();
    expect(again.status).toBe(409);
  });
});
