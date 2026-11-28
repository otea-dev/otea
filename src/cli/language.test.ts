import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { listBoardSummaries } from '../app/boards.ts';
import { listItems } from '../app/items.ts';
import { rememberLanguage } from '../app/language.ts';
import { openMachine } from '../app/machine.ts';
import { openProject } from '../app/project.ts';
import { startProject } from '../app/start.ts';
import { createServer } from '../server/server.ts';
import { LOCAL_HOST, memoryProject, SESSION_COOKIE, TOKEN } from '../server/testing.ts';
import { type Cli, cliAt, tempGitRepo } from './testing.ts';

// What Otea makes with no desk to ask is in the project's language, fixed when the project was made
// from the language the person used then: the desk's, as the server last heard it, else this
// computer's, else English. The desk changing its own does not move it; projects lang does.
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

  // P8-F2: two otea start runs with the same arguments said "Language: English" and then "Language:
  // Spanish" because the desk had changed language in between.
  it('starts in the same language twice, whatever language the desk moved to in between', async () => {
    await switchDeskTo('en');
    const first = await startProject(repo.dir, {});

    await switchDeskTo('es');
    const second = await startProject(repo.dir, {});

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(first.lang).toBe('en');
    expect(second.lang).toBe('en');
    expect(second.prompt).toBe(first.prompt);
    expect(second.prompt).toBe((await person('prompt', '--lang', 'en')).out.trimEnd());
  });

  it('is English for a board added to a project made while the desk was in English', async () => {
    await switchDeskTo('en');
    await person('init', '--local');

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
    // What is made from now on is in the project's language, which the desk's does not move.
    const bugs = (await person('board', 'Bugs')).out;
    expect(bugs).toContain('Bugs: steps for each Bug');
    expect(bugs).not.toContain('Pasos para reproducirlo');
  });

  // The boards that exist follow the project (project-relanguage.test.ts): D-867c82.
  it('changes what is made from then on with projects lang, and the boards that exist follow', async () => {
    await switchDeskTo('en');
    await person('init', '--local', '--template', 'changes');
    expect((await person('projects', 'lang')).out).toContain('English (en)');

    expect((await person('projects', 'lang', 'es')).out).toContain('Spanish (es)');
    expect((await person('projects', 'lang')).out).toContain('Spanish (es)');
    await person('board', 'add', 'Bugs', '--template', 'bugs');

    expect((await person('board', 'Bugs')).out).toContain('Pasos para reproducirlo');
    expect(boardNames()).toContain('Cambios');
    expect(boardNames()).not.toContain('Changes');
    expect((await person('projects', 'lang', 'fr')).code).not.toBe(0);
  });

  it('leaves changing the project language to the person: an agent may read it, not set it', async () => {
    await switchDeskTo('en');
    await person('init', '--local', '--template', 'none');
    const agent = cliAt(repo.dir, { OTEA_AGENT: 'claude' });

    const refused = await agent('projects', 'lang', 'es');

    expect(refused.code).not.toBe(0);
    expect(refused.err).toContain("the person's choice");
    expect((await agent('projects', 'lang')).out).toContain('English (en)');
    expect((await person('projects', 'lang')).out).toContain('English (en)');
  });

  it('puts the Pedido of a board an agent drafts in the project language, not the desk one', async () => {
    await switchDeskTo('es');
    await person('init', '--local', '--template', 'none');
    await switchDeskTo('en');
    const agent = cliAt(repo.dir, { OTEA_AGENT: 'claude' });

    await agent('board', 'draft', '--new', 'Criaturas', '--why', 'Criaturas del pantano');

    const project = openProject(repo.dir);
    try {
      expect(listItems(project, {}).map(({ title }) => title)).toEqual([
        'Esbozar el tablero Criaturas',
      ]);
    } finally {
      project.db.close();
    }
  });

  // A project from before the language was stored takes the one its Pedidos board was made in.
  it('reads the language of a project with none stored from its Pedidos board, and keeps it', async () => {
    await switchDeskTo('es');
    await person('init', '--local', '--template', 'none');
    const project = openProject(repo.dir);
    try {
      project.db.exec('UPDATE project SET lang = NULL');
    } finally {
      project.db.close();
    }

    await switchDeskTo('en');
    expect((await person('projects', 'lang')).out).toContain('Spanish (es)');
    await switchDeskTo('es');
    await person('board', 'add', 'Cosas', '--template', 'changes');
    expect((await person('board', 'Cosas')).out).toContain('Aclarar');
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

  it('writes otea prompt in the project language, whatever the desk is in', async () => {
    await switchDeskTo('en');
    await person('init', '--local');
    const english = (await person('prompt', 'design')).out;

    await switchDeskTo('es');

    expect((await person('prompt', 'design')).out).toBe(english);
    expect(english).toBe((await person('prompt', 'design', '--lang', 'en')).out);
    const spanish = (await person('prompt', 'design', '--lang', 'es')).out;
    expect(spanish).not.toBe(english);
    // Changing the project's language changes it.
    await person('projects', 'lang', 'es');
    expect((await person('prompt', 'design')).out).toBe(spanish);
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
