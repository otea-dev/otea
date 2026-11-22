import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Project } from '../app/project.ts';
import { createServer, type OteaServer } from './server.ts';
import { anonymous, LOCAL_HOST, memoryProject, request, TOKEN } from './testing.ts';

const PROJECT = 'memory-aaaaaa';

// What answers over the loopback socket without a session or a device token: who the caller is,
// and the sign-in and pairing calls. Everything else under an API path needs one.
const OPEN_READS = new Set([`/p/${PROJECT}/api/session`]);

describe('reads over the loopback socket', () => {
  let project: Project;
  let server: OteaServer;

  beforeEach(() => {
    project = memoryProject();
    server = createServer(project, { token: TOKEN });
  });

  afterEach(() => {
    server.close();
    project.db.close();
  });

  // Every GET the API has, found in the router: a route added later is held to the same rule
  // without a line here.
  const reads = () =>
    server
      .routesOf(PROJECT)
      .filter(({ method, path }) => method === 'GET' && !path.includes('*'))
      .map(({ path }) => path.replace(/:[A-Za-z]+/g, 'x'));

  it('knows the reads it checks', () => {
    const found = reads();

    expect(found).toContain(`/p/${PROJECT}/api/items`);
    expect(found).toContain(`/p/${PROJECT}/api/evidence/x/file`);
    expect(found).toContain(`/p/${PROJECT}/api/stream`);
    expect(found).toContain(`/p/${PROJECT}/api/session`);
  });

  it('refuses every read of the API without the session, with 401', async () => {
    const unsigned = reads().filter((path) => !OPEN_READS.has(path));
    expect(unsigned.length).toBeGreaterThan(20);

    for (const path of unsigned) {
      const response = await anonymous(server, path);

      expect(response.status, path).toBe(401);
      expect(await response.json(), path).toMatchObject({ error: { code: 'unauthorized' } });
    }
  });

  it('refuses a read that sends a wrong session, with 401', async () => {
    const response = await server.app.request(`/p/${PROJECT}/api/items`, {
      headers: { host: LOCAL_HOST, cookie: 'otea_session_4400=wrong' },
    });

    expect(response.status).toBe(401);
  });

  it('refuses the machine-wide reads and the live streams too', async () => {
    for (const path of ['/api/items', '/api/lan', '/api/language', `/p/${PROJECT}/api/notify`]) {
      expect((await anonymous(server, path)).status, path).toBe(401);
    }
  });

  it('answers every read of the API once signed in', async () => {
    for (const path of reads().filter((each) => !each.endsWith('/stream'))) {
      expect((await request(server, path)).status, path).not.toBe(401);
    }
    expect((await request(server, `/p/${PROJECT}/api/items`)).status).toBe(200);
  });

  it('still says who the caller is without the session, so the page can ask to sign in', async () => {
    const response = await anonymous(server, `/p/${PROJECT}/api/session`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      canWrite: false,
      canManageDevices: false,
      canConfigure: false,
    });
  });

  it('refuses every read when the server has no token to sign in with', async () => {
    const closed = createServer(project);
    try {
      expect((await request(closed, `/p/${PROJECT}/api/items`)).status).toBe(401);
    } finally {
      closed.close();
    }
  });

  // The cookie is SameSite=Strict, so a rebinding page never sends it; the host check is the
  // second lock, and a request that names another host is refused before the session is read.
  it('refuses a rebinding-style host even with the session', async () => {
    const response = await request(server, `/p/${PROJECT}/api/items`, 'evil.example:4400');

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: 'forbidden_host' } });
  });

  it('keeps the sign-in itself open: it is how a browser gets the session', async () => {
    expect((await anonymous(server, `/auth?token=${TOKEN}`)).status).toBe(302);
    expect((await anonymous(server, '/auth?token=wrong')).status).toBe(401);
  });
});
