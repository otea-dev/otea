import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { listBoardSummaries } from '../app/boards.ts';
import { rememberLanguage } from '../app/language.ts';
import { openMachine } from '../app/machine.ts';
import { openProject } from '../app/project.ts';
import { createServer } from '../server/server.ts';
import { LOCAL_HOST, memoryProject, SESSION_COOKIE, TOKEN } from '../server/testing.ts';
import { type Cli, cliAt, tempGitRepo } from './testing.ts';

// What Otea makes with no desk to ask takes the language the person uses: the desk's, as the
// server last heard it, else this computer's, else English. It stays as it was made.
describe('the language of what the CLI makes', () => {
  let repo: ReturnType<typeof tempGitRepo>;
  let person: Cli;

  const boardNames = () => {
    const project = openProject(repo.dir);
    try {
      return listBoardSummaries(project).map(({ name }) => name);
    } finally {
      project.db.close();
    }
  };

  // The person switches the desk's language: the UI tells the server, as it does on every switch.
  const switchDeskTo = async (lang: 'en' | 'es') => {
    const project = memoryProject();
    const machine = openMachine();
    const server = createServer(project, { token: TOKEN, machine });
    try {
      const response = await server.app.request('/api/language', {
        method: 'POST',
        headers: {
          host: LOCAL_HOST,
          cookie: SESSION_COOKIE,
          'content-type': 'application/json',
          origin: `http://${LOCAL_HOST}`,
        },
        body: JSON.stringify({ lang }),
      });
      expect(response.status).toBe(200);
    } finally {
      server.close();
      project.db.close();
      machine.close();
    }
  };

  const clearDeskLanguage = () => {
    const machine = openMachine();
    machine.exec('DELETE FROM preferences');
    machine.close();
  };

  beforeEach(() => {
    repo = tempGitRepo();
    person = cliAt(repo.dir);
  });

  afterEach(() => {
    clearDeskLanguage();
    vi.unstubAllEnvs();
    repo.remove();
  });

  it('is English for a board added after the desk was switched to English', async () => {
    await person('init', '--local');
    await switchDeskTo('en');

    expect((await person('board', 'add', 'Bugs', '--template', 'bugs')).code).toBe(0);

    const bugs = (await person('board', 'Bugs')).out;
    expect(bugs).toContain('Bugs: steps for each Bug');
    expect(bugs).not.toContain('Pasos para reproducirlo');
  });

  it('names the template boards of init, and its Requests board, in the desk language', async () => {
    await switchDeskTo('en');

    expect((await person('init', '--local', '--template', 'changes')).code).toBe(0);

    expect(boardNames()).toContain('Changes');
    expect(boardNames()).toContain('Requests');
    expect(boardNames()).not.toContain('Cambios');
    expect(boardNames()).not.toContain('Pedidos');
  });

  it('keeps what exists as it was made when the desk switches language later', async () => {
    await switchDeskTo('en');
    await person('init', '--local', '--template', 'changes');
    const before = (await person('board', 'Changes')).out;

    await switchDeskTo('es');
    await person('board', 'add', 'Bugs', '--template', 'bugs');

    expect(boardNames()).toEqual(expect.arrayContaining(['Changes', 'Requests', 'Bugs']));
    expect(boardNames()).not.toContain('Cambios');
    expect((await person('board', 'Changes')).out).toBe(before);
    // What is made from now on is in the language now used.
    expect((await person('board', 'Bugs')).out).toContain('Pasos para reproducirlo');
  });

  it('follows the language of the computer while no desk has said one', async () => {
    vi.stubEnv('LC_ALL', 'en_US.UTF-8');
    await person('init', '--local', '--template', 'changes');
    expect(boardNames()).toContain('Changes');

    const other = tempGitRepo();
    try {
      vi.stubEnv('LC_ALL', 'es_ES.UTF-8');
      await cliAt(other.dir)('init', '--local', '--template', 'changes');
      const project = openProject(other.dir);
      try {
        expect(listBoardSummaries(project).map(({ name }) => name)).toContain('Cambios');
      } finally {
        project.db.close();
      }
    } finally {
      other.remove();
    }
  });

  it('lets --lang on a board or a prompt override it once, and init takes no --lang', async () => {
    await switchDeskTo('en');
    await person('init', '--local');

    await person('board', 'add', 'Cosas', '--template', 'changes', '--lang', 'es');
    expect((await person('board', 'Cosas')).out).toContain('Cosas: steps for each');
    expect((await person('prompt', 'design', '--lang', 'es')).out).not.toBe(
      (await person('prompt', 'design')).out,
    );

    const refused = await person('init', '--lang', 'en');
    expect(refused.code).not.toBe(0);
  });

  it('writes otea prompt in the desk language', async () => {
    await person('init', '--local');
    await switchDeskTo('en');
    const english = (await person('prompt', 'design')).out;

    await switchDeskTo('es');
    const spanish = (await person('prompt', 'design')).out;

    expect(english).not.toBe(spanish);
    expect(english).toBe((await person('prompt', 'design', '--lang', 'en')).out);
    expect(spanish).toBe((await person('prompt', 'design', '--lang', 'es')).out);
  });

  it('writes the first-contact prompt of a folder with no project in the desk language too', async () => {
    const machine = openMachine();
    rememberLanguage(machine, 'en');
    machine.close();

    const { out } = await person('prompt');

    expect(out).toBe((await person('prompt', '--lang', 'en')).out);
    expect(out).not.toBe((await person('prompt', '--lang', 'es')).out);
  });
});
