import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createBoard, publishBoard, saveDraft } from '../app/boards.ts';
import { createItem } from '../app/items.ts';
import type { Project } from '../app/project.ts';
import { creatures } from '../core/board/testing.ts';
import { createServer, type OteaServer } from './server.ts';
import { LOCAL_HOST, memoryProject, SESSION_COOKIE, TOKEN } from './testing.ts';

// The person waives a file a step asks for from the desk (POST /api/items/:id/waive): it is
// recorded as theirs, and the item's board block says so.

describe('POST /api/items/:id/waive', () => {
  let project: Project;
  let server: OteaServer;

  const call = (path: string, body?: unknown) =>
    Promise.resolve(
      server.app.request(
        `/p/memory-aaaaaa/api${path}`,
        {
          method: body === undefined ? 'GET' : 'POST',
          headers: {
            host: LOCAL_HOST,
            origin: `http://${LOCAL_HOST}`,
            cookie: SESSION_COOKIE,
            'content-type': 'application/json',
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        },
        { incoming: { socket: { remoteAddress: '127.0.0.1' } } },
      ),
    );

  beforeEach(() => {
    project = memoryProject();
    const record = createBoard(project, { name: 'Criaturas', lang: 'es' });
    saveDraft(project, record.id, { definition: creatures(), baseVersion: null });
    publishBoard(project, record.id, { moves: {}, by: { kind: 'human', name: 'fede' } });
    createItem(project, {
      collection: 'Criaturas',
      title: 'Tortuga',
      fields: { fdesc: 'Lenta' },
      actor: { kind: 'agent', name: 'kiln' },
      channel: 'cli',
    });
    server = createServer(project, { token: TOKEN });
  });

  afterEach(() => {
    server.close();
    project.db.close();
  });

  it('records the person’s waiver and shows it on the item', async () => {
    const response = await call('/items/CRI-1/waive', {
      part: 'Arte conceptual',
      reason: 'sin navegador',
    });
    expect(response.status).toBe(200);
    const item = (await (await call('/items/CRI-1')).json()) as { board: { waived: unknown[] } };
    expect(item.board.waived).toEqual([
      expect.objectContaining({ name: 'Arte conceptual', by: 'human', reason: 'sin navegador' }),
    ]);
  });

  it('refuses a part the board has no file for', async () => {
    const response = await call('/items/CRI-1/waive', { part: 'Nada' });
    expect(response.status).toBe(404);
  });
});
