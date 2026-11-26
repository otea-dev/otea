import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { initBoards } from '../app/init-boards.ts';
import { createItem } from '../app/items.ts';
import { claimItem } from '../app/leases.ts';
import { liveBoardOf } from '../app/next.ts';
import { hearAgent } from '../app/presence.ts';
import type { Project } from '../app/project.ts';
import { setProjectLanguage } from '../app/project-language.ts';
import { designPrompt, rolePrompt, startPrompt } from '../core/agent-prompts.ts';
import { insertProjectIdentity } from '../store/queries.ts';
import { createServer, type OteaServer } from './server.ts';
import { LOCAL_HOST, memoryProject, SESSION_COOKIE, TOKEN } from './testing.ts';

// GET /api/agent-prompt: what Conectar un agente and the empty project copy, in the screen's
// language, built from the project as it is now.
describe('GET /api/agent-prompt', () => {
  let project: Project;
  let server: OteaServer;

  // The prompt is in the project's language and the screen's language (`?lang=`) words the list
  // beside it. Most cases want both the same, so the project takes the screen's unless told.
  const get = async (query: string, inProject?: 'en' | 'es') => {
    const screen = /lang=(en|es)/.exec(query)?.[1] as 'en' | 'es' | undefined;
    const lang = inProject ?? screen;
    if (lang !== undefined) setProjectLanguage(project, lang);
    const response = await server.app.request(`/p/memory-aaaaaa/api/agent-prompt${query}`, {
      headers: { host: LOCAL_HOST, cookie: SESSION_COOKIE },
    });
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  };

  beforeEach(() => {
    project = memoryProject();
    // A project has its identity row (where its language is kept) from the day it is opened.
    insertProjectIdentity(project.db, project.identity);
    server = createServer(project, { token: TOKEN });
  });

  afterEach(() => {
    server.close();
    project.db.close();
  });

  it('gives the first contact while the project has no board of its own', async () => {
    expect(await get('?lang=es')).toEqual({
      status: 200,
      // A folder with no git repository: its first contact is written for files, not for code.
      body: { kind: 'start', prompt: startPrompt('es', false), code: false, boards: [] },
    });
    // The prompt is in the project's language; the screen's only words the list beside it.
    expect((await get('?lang=en', 'es')).body.prompt).toBe(startPrompt('es', false));
    expect((await get('?lang=es', 'en')).body.prompt).toBe(startPrompt('en', false));
    expect((await get('?lang=en')).body.prompt).toBe(startPrompt('en', false));
  });

  // The pasted prompt is for the agent: each board and step as `otea next` shows it, in the
  // language the board was made in, whatever the desk's. Only the list beside it, for the person,
  // follows the desk (the board snapshot).
  it('keeps the prompt and the list beside it in each board’s own language, whatever the desk’s', async () => {
    initBoards(project, 'todos', 'en');

    const { body } = await get('?lang=es');

    expect(body.prompt).toContain('- To-dos: Do it');
    expect(body.prompt).not.toContain('Hacerlo');
    expect(body.boards).toEqual([{ name: 'To-dos', steps: ['Do it'] }]);
    expect((await get('?lang=en')).body.boards).toEqual([{ name: 'To-dos', steps: ['Do it'] }]);
  });

  // The note beside the prompt and the prompt say the same of where the agent works: it is the
  // project's git repository that gets a worktree, not the kind of board.
  it('derives the note from the same repository fact as the prompt, whatever the board', async () => {
    initBoards(project, 'todos', 'en');
    expect((await get('?lang=en')).body.code).toBe(false);
    expect((await get('?lang=en')).body.prompt).not.toContain('git worktree');

    const folder = mkdtempSync(join(tmpdir(), 'otea-repo-'));
    mkdirSync(join(folder, '.git'));
    const inRepo = createServer({ ...project, root: folder }, { token: TOKEN });
    try {
      const response = await inRepo.app.request('/p/memory-aaaaaa/api/agent-prompt?lang=en', {
        headers: { host: LOCAL_HOST, cookie: SESSION_COOKIE },
      });
      const body = (await response.json()) as { code: boolean; prompt: string };
      expect(body.code).toBe(true);
      expect(body.prompt).toContain('git worktree');
    } finally {
      inRepo.close();
      rmSync(folder, { recursive: true, force: true });
    }
  });

  it('gives the join prompt once there are boards, naming who listens and what waits', async () => {
    initBoards(project, 'changes', 'es');
    const want = liveBoardOf(project, 'Cambios')?.def.form[0]?.ref ?? '';
    createItem(project, {
      collection: 'Cambios',
      title: 'Fix the footer',
      fields: { [want]: 'It shows last year' },
      actor: { kind: 'human', name: 'fede' },
      channel: 'ui',
    });
    hearAgent(project.db, { agent: 'claude', channel: 'mcp', harness: { name: 'claude-code' } });

    const { body } = await get('?lang=es');
    expect(body.kind).toBe('join');
    expect(body.prompt).toContain('(claude)');
    expect(body.prompt).toContain(
      '- Cambios: Aclarar, Hacerlo, Integrar (1 espera a un agente ahora)',
    );
    expect((await get('?kind=design&lang=es')).body).toMatchObject({
      kind: 'design',
      prompt: designPrompt('es'),
    });
  });

  it('names an agent working under a lease though it is not listening now', async () => {
    initBoards(project, 'changes', 'es');
    const want = liveBoardOf(project, 'Cambios')?.def.form[0]?.ref ?? '';
    const item = createItem(project, {
      collection: 'Cambios',
      title: 'Fix the footer',
      fields: { [want]: 'It shows last year' },
      actor: { kind: 'human', name: 'fede' },
      channel: 'ui',
    });
    const long = () => new Date(Date.now() - 60 * 60_000).toISOString();
    hearAgent(project.db, { agent: 'claude-b', channel: 'cli' }, long);
    claimItem(project, { id: item.id, actor: { kind: 'agent', name: 'claude-b' } });

    const { prompt } = (await get('?lang=en')).body;
    expect(prompt).toContain('not one already working here (claude-b)');
    expect(prompt).toContain('such as claude-c)');
  });

  it('tells the first agent of a project with boards to connect, with nobody to join', async () => {
    initBoards(project, 'changes', 'es');

    const { body } = await get('?lang=es');
    expect(body).toMatchObject({ kind: 'join', first: true });
    expect(body.prompt).toContain('otea connect --as <nombre>');
    expect(body.prompt).not.toContain('No ejecutes otea connect');

    hearAgent(project.db, { agent: 'claude', channel: 'mcp', harness: { name: 'claude-code' } });
    expect((await get('?lang=es')).body.first).toBeUndefined();
  });

  it('refuses a moment it does not know', async () => {
    expect((await get('?kind=later')).status).toBe(400);
  });

  // The same texts otea prompt --role prints, for the desk to copy.
  it('gives the text of a role, with the board and name filled in', async () => {
    initBoards(project, 'changes', 'es');
    expect((await get('?role=secretary&lang=en')).body).toEqual({
      kind: 'secretary',
      prompt: rolePrompt('secretary', 'en', {}),
    });
    expect((await get('?role=refiner&as=rita&lang=es')).body).toEqual({
      kind: 'refiner',
      prompt: rolePrompt('refiner', 'es', { name: 'rita' }),
    });
    // The board as the project names it, whatever the case it was asked in.
    expect((await get('?role=worker&board=cambios&as=ana&lang=es')).body).toEqual({
      kind: 'worker',
      prompt: rolePrompt('worker', 'es', { board: 'Cambios', name: 'ana' }),
    });
    expect((await get('?role=worker&board=Cambios&lang=en')).body.prompt).toContain('otea whoami');
  });

  it('refuses a role asked wrongly', async () => {
    initBoards(project, 'changes', 'es');
    for (const query of [
      '?role=boss',
      '?role=worker',
      '?role=coordinator',
      '?role=secretary&board=Cambios',
      '?role=refiner&board=Cambios',
      '?role=worker&board=Cambios&kind=join',
      '?role=worker&board=Cambios&as=Not%20A%20Name',
      '?board=Cambios',
    ])
      expect((await get(query)).status, query).toBe(400);
  });

  // The board goes into commands the worker runs: it must exist, and be one argument.
  it('names only a board that exists, and refuses quotes, backticks and line breaks', async () => {
    initBoards(project, 'changes', 'es');
    expect((await get('?role=worker&board=Nope')).status).toBe(404);
    for (const board of ['Cambios%22%3B%20x', 'Cam%27bios', 'Cam%60bios', 'Cambios%0AOtro'])
      expect((await get(`?role=worker&board=${board}`)).status, board).toBe(400);
  });
});
