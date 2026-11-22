import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { attachEvidence } from '../app/evidence.ts';
import { createItem } from '../app/items.ts';
import type { Project } from '../app/project.ts';
import { memoryContext, projectOf, publishAs } from '../app/testing.ts';
import { creatures } from '../core/board/testing.ts';
import { createServer, type OteaServer } from './server.ts';
import { LOCAL_HOST, SESSION_COOKIE, TOKEN } from './testing.ts';

// A board's File part takes any file, so whatever an agent attaches there is served from the app's
// own origin: nothing in it may run there, whatever its name or its bytes say it is.
describe('files attached to a part that takes any file', () => {
  let project: Project;
  let server: OteaServer;
  let tick = 0;
  const now = () => new Date(Date.UTC(2026, 10, 17, 9, 0, tick++)).toISOString();

  beforeEach(() => {
    const ctx = memoryContext();
    const def = creatures();
    def.parts.eany = { id: 'eany', name: 'Cualquiera', kind: 'file', hint: '', options: [] };
    def.steps[0]?.hand.push({ ref: 'eany', req: 'no', fresh: false });
    publishAs(ctx, def, 'bany', now);
    project = projectOf(mkdtempSync(join(tmpdir(), 'otea-any-file-')), ctx);
    createItem(
      project,
      {
        collection: 'Criaturas',
        title: 'Rana',
        fields: { fdesc: 'Lenta' },
        actor: { kind: 'human', name: 'fede' },
      },
      now,
    );
    server = createServer(project, { token: TOKEN });
  });

  afterEach(() => {
    server.close();
    project.db.close();
    rmSync(project.root, { recursive: true, force: true });
  });

  const served = async (name: string, content: string) => {
    const path = join(project.root, name);
    writeFileSync(path, content);
    const entry = attachEvidence(
      project,
      {
        id: 'CRI-1',
        path,
        module: 'eany',
        actor: { kind: 'agent', name: 'quill' },
        channel: 'cli',
      },
      now,
    );
    expect(entry.module).toBe('eany');
    return server.app.request(`/p/memory-aaaaaa/api/evidence/${entry.id}/file`, {
      headers: { host: LOCAL_HOST, cookie: SESSION_COOKIE },
    });
  };

  it.each([
    ['page.html', '<script>alert(1)</script>', 'application/octet-stream'],
    ['page.htm', '<script>alert(1)</script>', 'application/octet-stream'],
    ['icon.svg', '<svg onload="alert(1)"/>', 'image/svg+xml'],
    ['app.js', 'alert(1)', 'application/octet-stream'],
  ])(
    'serves %s as a sandboxed download, never rendered in the app origin',
    async (name, body, type) => {
      const response = await served(name, body);

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe(type);
      expect(response.headers.get('content-disposition')).toMatch(/^attachment;/);
      expect(response.headers.get('x-content-type-options')).toBe('nosniff');
      expect(response.headers.get('content-security-policy')).toBe('sandbox');
    },
  );

  it('serves a log or a text file as plain text, with the same protections', async () => {
    const response = await served('notes.txt', '<script>alert(1)</script>');

    expect(response.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('content-security-policy')).toBe('sandbox');
  });
});
