import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createItem, moveItem } from '../app/items.ts';
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

  it('says on the row of an approved item which one lands first and why', async () => {
    const at = new Date().toISOString();
    updateItemState(project.db, 'CAM-1', 'land', at);
    updateItemState(project.db, 'CAM-2', 'land', at);
    const response = await server.app.request(
      '/p/memory-aaaaaa/api/items',
      { headers: { host: LOCAL_HOST, cookie: SESSION_COOKIE } },
      { incoming: { socket: { remoteAddress: '127.0.0.1' } } },
    );
    const rows = (await response.json()) as { id: string; landsAfter?: unknown }[];

    expect(rows.find(({ id }) => id === 'CAM-1')?.landsAfter).toBeUndefined();
    expect(rows.find(({ id }) => id === 'CAM-2')?.landsAfter).toEqual({
      first: 'CAM-1',
      text: "CAM-2 waits to land in main: CAM-1 lands there first (approved before it; both change src/y.ts); one agent lands at a time on main, in the person's order.",
      // They change the same files: the approval waits (R3), the desk says «espera a CAM-1».
      overlap: true,
    });
  });

  it('says on the item page, which the phone reads, what an approved item waits for', async () => {
    for (const id of ['CAM-1', 'CAM-2']) {
      updateItemState(project.db, id, 'doit__review', new Date().toISOString());
      moveItem(project, { id, to: 'land', actor: you, channel: 'ui' });
    }
    const response = await server.app.request(
      '/p/memory-aaaaaa/api/items/CAM-2',
      { headers: { host: LOCAL_HOST, cookie: SESSION_COOKIE } },
      { incoming: { socket: { remoteAddress: '127.0.0.1' } } },
    );
    const page = (await response.json()) as { landing?: true; landsAfter?: unknown };

    expect(page.landing).toBe(true);
    expect(page.landsAfter).toMatchObject({ first: 'CAM-1', overlap: true });
  });

  it('says on the row of the item that waited that it merges main after the other landed', async () => {
    const at = new Date().toISOString();
    for (const id of ['CAM-1', 'CAM-2']) {
      updateItemState(project.db, id, 'doit__review', at);
      moveItem(project, { id, to: 'land', actor: you, channel: 'ui' });
    }
    updateItemState(project.db, 'CAM-1', 'done', new Date().toISOString());
    const response = await server.app.request(
      '/p/memory-aaaaaa/api/items',
      { headers: { host: LOCAL_HOST, cookie: SESSION_COOKIE } },
      { incoming: { socket: { remoteAddress: '127.0.0.1' } } },
    );
    const rows = (await response.json()) as {
      id: string;
      landing?: true;
      merging?: unknown;
      bounced?: unknown;
    }[];

    expect(rows.find(({ id }) => id === 'CAM-2')).toMatchObject({
      landing: true,
      merging: { after: ['CAM-1'] },
    });
    expect(rows.find(({ id }) => id === 'CAM-2')?.bounced).toBeUndefined();
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
