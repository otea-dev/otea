import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createItem } from '../app/items.ts';
import type { Project } from '../app/project.ts';
import { publishAs } from '../app/testing.ts';
import { instantiate, requireTemplate } from '../core/board/templates.ts';
import { updateItemState } from '../store/queries.ts';
import { createServer, type OteaServer } from './server.ts';
import { LOCAL_HOST, memoryProject, SESSION_COOKIE, TOKEN } from './testing.ts';

// The review of an item says which other open item's pushed branch changes the same files, so the
// person knows that whichever lands second meets a conflict before they approve.
describe('the desk review of an item that shares files with another', () => {
  let project: Project;
  let server: OteaServer;
  const you = { kind: 'human' as const, name: 'fede' };

  const overlaps = async (id: string) => {
    const response = await server.app.request(
      `/p/memory-aaaaaa/api/items/${id}/overlaps`,
      { headers: { host: LOCAL_HOST, cookie: SESSION_COOKIE } },
      { incoming: { socket: { remoteAddress: '127.0.0.1' } } },
    );
    expect(response.status).toBe(200);
    return ((await response.json()) as { overlaps: unknown }).overlaps;
  };

  beforeEach(() => {
    project = memoryProject();
    const def = instantiate(requireTemplate('changes'), 'es', {}, undefined, { keep: true });
    publishAs(project, def, 'bcam');
    const pushed: Record<string, string[]> = {
      'cambio/a': ['src/x.ts', 'src/y.ts'],
      'cambio/b': ['src/y.ts'],
    };
    project.changed = (branch) => pushed[branch];
    for (const title of ['a', 'b']) {
      const branch = `cambio/${title}`;
      createItem(
        project,
        { collection: def.name, title, fields: { want: 'x', branch }, actor: you },
        undefined,
      );
    }
    server = createServer(project, { token: TOKEN });
  });

  afterEach(() => {
    server.close();
    project.db.close();
  });

  it('names the other item, the files and whether it lands first', async () => {
    expect(await overlaps('CAM-1')).toEqual([
      { id: 'CAM-2', title: 'b', files: ['src/y.ts'], landing: false },
    ]);

    updateItemState(project.db, 'CAM-2', 'land', new Date().toISOString());
    expect(await overlaps('CAM-1')).toEqual([
      { id: 'CAM-2', title: 'b', files: ['src/y.ts'], landing: true },
    ]);
  });
});
