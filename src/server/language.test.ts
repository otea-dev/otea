import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { storedLanguage } from '../app/language.ts';
import { memoryMachine } from '../app/machine.ts';
import type { Project } from '../app/project.ts';
import { startPrompt } from '../core/agent-prompts.ts';
import { createServer, type OteaServer } from './server.ts';
import { LOCAL_HOST, memoryProject, SESSION_COOKIE, TOKEN } from './testing.ts';

// The desk tells the server its language when the person switches it, and once on opening while the
// server has none: what Otea makes without a desk (the CLI, the agent prompt) follows it.
describe('the person language on the server', () => {
  let project: Project;
  let server: OteaServer;
  let machine: ReturnType<typeof memoryMachine>;

  const call = async (path: string, body?: unknown, cookie: string | null = SESSION_COOKIE) => {
    const headers: Record<string, string> = { host: LOCAL_HOST };
    if (cookie !== null) headers.cookie = cookie;
    if (body !== undefined) {
      headers['content-type'] = 'application/json';
      headers.origin = `http://${LOCAL_HOST}`;
    }
    const response = await server.app.request(path, {
      method: body === undefined ? 'GET' : 'POST',
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  };

  beforeEach(() => {
    project = memoryProject();
    machine = memoryMachine();
    server = createServer(project, { token: TOKEN, machine });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    server.close();
    project.db.close();
    machine.close();
  });

  it('knows none until a desk says one, then keeps what it was told', async () => {
    expect(await call('/api/language')).toEqual({ status: 200, body: { language: null } });

    expect(await call('/api/language', { lang: 'en' })).toEqual({
      status: 200,
      body: { language: 'en' },
    });
    expect(storedLanguage(machine)).toBe('en');
    expect((await call('/api/language')).body).toEqual({ language: 'en' });
    expect((await call('/p/memory-aaaaaa/api/language')).body).toEqual({ language: 'en' });
  });

  it('is filled by a desk that just opened only while it has none, and changed by a switch', async () => {
    await call('/api/language', { lang: 'es', onlyIfUnset: true });
    expect(storedLanguage(machine)).toBe('es');

    expect((await call('/api/language', { lang: 'en', onlyIfUnset: true })).body).toEqual({
      language: 'es',
    });
    expect(storedLanguage(machine)).toBe('es');

    await call('/api/language', { lang: 'en' });
    expect(storedLanguage(machine)).toBe('en');
  });

  it('refuses a language it does not speak and a visitor who is not signed in', async () => {
    expect((await call('/api/language', { lang: 'fr' })).status).toBe(400);
    expect((await call('/api/language', {}, SESSION_COOKIE)).status).toBe(400);
    expect((await call('/api/language', { lang: 'en' }, null)).status).toBe(401);
    expect(storedLanguage(machine)).toBeUndefined();
  });

  it('writes the agent prompt in the desk language when none is asked, and in the one asked', async () => {
    vi.stubEnv('LC_ALL', 'es_ES.UTF-8');
    expect((await call('/p/memory-aaaaaa/api/agent-prompt')).body.prompt).toBe(
      startPrompt('es', false),
    );

    await call('/api/language', { lang: 'en' });

    expect((await call('/p/memory-aaaaaa/api/agent-prompt')).body.prompt).toBe(
      startPrompt('en', false),
    );
    expect((await call('/p/memory-aaaaaa/api/agent-prompt?lang=es')).body.prompt).toBe(
      startPrompt('es', false),
    );
  });
});
